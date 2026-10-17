import { eq, desc, sql, and } from "drizzle-orm";
import { createHash } from "node:crypto";
import { queueJob } from "./operations-records";
import {
  db, leadsTable, intelligenceTable, analysesTable, callsTable, buyersTable, transitionsTable,
  auditTable, settingsTable, contractsTable, propertyDiscoveriesTable, propertyQualificationCriteriaTable, type LeadRow,
} from "@workspace/db";
import {
  analyzeDeal, allowedTransitions, buildCallBrief, prioritizeCallQueue, validateProvenance,
  validateTransition, validateAssumptions, assertTransitionPermission, DEFAULT_ASSUMPTIONS, DomainError,
  type Lead, type LeadInput, type LeadDetail, type Intelligence, type IntelligenceInput,
  type UnderwritingInput, type Assumptions, type TransitionInput, type CallInput, type Analysis, type Stage, type OfferActor,
  evidenceReviewedAnalysis, buildDealWorkGuidance,
  repairMarketKey, DEFAULT_PROPERTY_QUALIFICATION_CRITERIA, evaluatePropertyRelevance,
  type PropertyQualificationCriteria, type PropertyRelevanceSignal,
  validateSellerConversationFields, type SellerConversationField, unresolvedSellerConversationQuestions,
  ACQUISITION_STAGE_ENTRY_EVIDENCE, ACQUISITION_STAGE_EXIT_EVIDENCE,
  deriveAcquisitionPipelineStage, deriveAcquisitionPipelineCounts,
  type AcquisitionPipelineStage,
} from "@workspace/deal-domain";
import { CreateLeadResponse, GetLeadResponse, AddIntelligenceResponse, GetAssumptionsResponse } from "@workspace/api-zod";
import { offersForLead, invalidateOffers, invalidateOffersForPolicyChange } from "./offer-records";
import { getSellerContactPaths } from "./seller-contact-store";
import { versionedStageTransition } from "./canonical-deal-state";
import { evaluatePropertyContactabilityGate, type SellerContactabilityEvidence } from "./property-contactability-gate";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const jsonRecord = (value: object): Record<string, unknown> => ({ ...value });
const iso = (d: Date) => d.toISOString();
function canonicalLeadIdentity(input: Pick<LeadInput, "address" | "city" | "state" | "zip">) {
  return [
    input.city.trim().toUpperCase(),
    input.state.trim().toUpperCase(),
    input.zip.slice(0, 5),
    input.address.toUpperCase().replace(/[^A-Z0-9]/g, ""),
  ].join(":");
}
export async function lockCanonicalLeadIdentity(
  tx: Tx,
  input: Pick<LeadInput, "address" | "city" | "state" | "zip">,
) {
  const identity = canonicalLeadIdentity(input);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(current_schema() || ${identity},0))`);
}
export function toLead(row: LeadRow): Lead {
  const qualification = row.payload.propertyQualification;
  const responsePayload = qualification && typeof qualification === "object"
    ? {
        ...row.payload,
        propertyQualification: {
          ...(qualification as Record<string, unknown>),
          nextAction: row.nextAction,
        },
      }
    : row.payload;
  return CreateLeadResponse.parse({
    ...responsePayload, id: row.id, stage: row.stage, version: row.version,
    nextAction: row.nextAction, followUpAt: row.followUpAt?.toISOString() ?? null,
    createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
  });
}
export async function audit(tx: Tx, actor: string, action: string, entityId: string, detail: string) {
  await tx.insert(auditTable).values({ actor, action, entityId, detail });
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key,item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
function callSubmissionHash(input: CallInput) {
  return createHash("sha256").update(stableJson(input)).digest("hex");
}
export async function lockedLead(tx: Tx, id: string, version?: number, allowTerminal = false) {
  const [row] = await tx.select().from(leadsTable).where(eq(leadsTable.id,id)).for("update");
  if (!row) throw new DomainError("Property lead not found.", 404);
  if (version != null && row.version !== version) throw new DomainError("This lead changed in another session. Reload before saving.", 409);
  if (!allowTerminal && (row.stage === "DEAD_DEAL" || row.stage === "CLOSED")) throw new DomainError("This lead is terminal and cannot be changed.", 409);
  return row;
}
export async function move(tx: Tx, row: LeadRow, to: Stage, reason: string, nextAction: string, actor: string, now: Date) {
  // Refresh research without pretending an already executed transaction ceased to exist.
  if (["UNDER_CONTRACT","BUYER_MATCHED","BUYER_INTERESTED","BUYER_COMMITTED","CLOSING"].includes(row.stage)
    && ["ENRICHING","ANALYZED","STRONG","NEGOTIABLE","PASS","CONTACTED","CONVERSATION","NEGOTIATING"].includes(to)) {
    await audit(tx,actor,"TRANSACTION_RESEARCH_REVIEW",row.id,`${reason}. Executed lifecycle preserved; ${nextAction}`);
    row.nextAction = nextAction;
    return;
  }
  await tx.insert(transitionsTable).values({ leadId: row.id, from: row.stage, to, reason, nextAction, actor, createdAt: now });
  await audit(tx, actor, "DEAL_TRANSITION", row.id, JSON.stringify(versionedStageTransition({
    leadId: row.id,
    priorVersion: row.version,
    priorStage: row.stage,
    nextStage: to,
    actor,
    occurredAt: now,
    reason,
    nextAction,
    analysisSnapshotId: row.analysisSnapshotId,
  })));
  await queueJob(tx,"EVALUATE_DECISION",row.id,
    `decision:${row.id}:transition:${row.version+1}:${row.stage}:${to}`,
    actor,{trigger:"DEAL_TRANSITION",from:row.stage,to});
  row.stage = to;
  row.nextAction = nextAction;
}

export async function listLeads() {
  const rows = await db.select().from(leadsTable).orderBy(desc(leadsTable.updatedAt));
  return rows
    .filter((row) => {
      const sourceKey = row.payload.sourceKey;
      if (typeof sourceKey !== "string" || !sourceKey.startsWith("phila-opa:")) return true;
      if (row.payload.propertyQualification) return true;
      // Older direct imports had no qualification record. Keep progressed seller conversations visible,
      // but do not continue presenting untouched public-record rows as active acquisition leads.
      return !["DISCOVERED", "ENRICHING", "ANALYZED", "STRONG", "NEGOTIABLE", "PASS"].includes(row.stage);
    })
    .map(toLead);
}

export async function leadDetail(id: string, database: typeof db | Tx = db, now = new Date()): Promise<LeadDetail> {
  if (database === db) {
    return db.transaction(tx => leadDetail(id,tx,now), {isolationLevel:"repeatable read",accessMode:"read only"});
  }
  const [row] = await database.select().from(leadsTable).where(eq(leadsTable.id,id));
  if (!row) throw new DomainError("Property lead not found.", 404);
  // Transaction clients share a connection: do not submit concurrent queries.
  const intel = await database.select().from(intelligenceTable).where(eq(intelligenceTable.leadId,id)).orderBy(desc(intelligenceTable.createdAt));
  const transitions = await database.select().from(transitionsTable).where(eq(transitionsTable.leadId,id)).orderBy(transitionsTable.createdAt);
  const calls = await database.select().from(callsTable).where(eq(callsTable.leadId,id)).orderBy(desc(callsTable.createdAt));
  const lead = toLead(row);
  const intelligence = intel.map(e => AddIntelligenceResponse.parse({
    ...e.payload, id:e.id, leadId:e.leadId, createdBy:e.createdBy, createdAt:iso(e.createdAt),
  }));
  const storedAnalysis = row.analysis as Analysis|null;
  const legacySafeAnalysis = storedAnalysis ? {
    ...storedAnalysis,
    assumptions:{
      ...DEFAULT_ASSUMPTIONS,
      ...storedAnalysis.assumptions,
      repairRateCatalogVersion:storedAnalysis.assumptions?.repairRateCatalogVersion ?? 0,
      repairRates:Array.isArray(storedAnalysis.assumptions?.repairRates)?storedAnalysis.assumptions.repairRates:[],
    },
    repairEstimate:storedAnalysis.repairEstimate ?? {
      status:"NOT_USED" as const,marketKey:repairMarketKey(lead.city,lead.state),catalogVersion:0,
      calculatedAt:storedAnalysis.calculatedAt,lines:[],total:null,blockers:[],
    },
    preliminaryRepairEstimate:storedAnalysis.preliminaryRepairEstimate ?? {
      status:"NOT_USED" as const,marketKey:repairMarketKey(lead.city,lead.state),catalogVersion:0,
      calculatedAt:storedAnalysis.calculatedAt,hypotheses:[],lines:[],total:null,blockers:[],
      sourceWarnings:["Legacy analysis predates source-linked condition hypotheses; no repair clue was inferred."],
    },
  } : null;
  const analysis = evidenceReviewedAnalysis(legacySafeAnalysis,lead,row.underwriting as UnderwritingInput|null,intelligence,now);
  const [snapshotRow] = row.analysisSnapshotId
    ? await database.select().from(analysesTable).where(and(eq(analysesTable.id,row.analysisSnapshotId),eq(analysesTable.leadId,id))).limit(1)
    : [];
  const snapshotPayload = snapshotRow?.snapshot as {lead?:Lead;input?:UnderwritingInput;analysis?:Analysis}|undefined;
  const underwritingSnapshot = snapshotRow && snapshotPayload?.lead && snapshotPayload.input && snapshotPayload.analysis
    ? {id:snapshotRow.id,lead:snapshotPayload.lead,input:snapshotPayload.input,analysis:snapshotPayload.analysis}
    : null;
  const offers = await offersForLead(database,id,{
    lead,intelligence,analysis,analysisSnapshotId:row.analysisSnapshotId,underwriting:row.underwriting as UnderwritingInput|null,
    underwritingSnapshot,
    currentPolicy:await getAssumptions(database),conversationLogged:calls.some(c => c.payload.outcome === "CONNECTED"),now,
  });
  const detail = {
    lead, intelligence, analysis, analysisSnapshotId:row.analysisSnapshotId, underwriting:row.underwriting as UnderwritingInput|null, offers,
    transitions:transitions.map(e => ({...e, createdAt:iso(e.createdAt)})),
    calls:calls.map(e => ({
      ...e.payload as CallInput,
      id:e.id,
      actor:e.actor,
      createdAt:iso(e.createdAt),
      occurredAt:(e.payload as CallInput).occurredAt ?? iso(e.createdAt),
    })),
    allowedTransitions:allowedTransitions(lead,analysis,now),
  };
  return GetLeadResponse.parse({...detail,workGuidance:buildDealWorkGuidance(detail,now)});
}

export async function getAssumptions(database: typeof db | Tx = db): Promise<Assumptions> {
  const [row] = await database.select().from(settingsTable).where(eq(settingsTable.id,1));
  const saved = row?.assumptions ?? {};
  return GetAssumptionsResponse.parse({
    ...DEFAULT_ASSUMPTIONS,
    ...saved,
    repairRateCatalogVersion:typeof saved.repairRateCatalogVersion==="number"?saved.repairRateCatalogVersion:0,
    repairRates:Array.isArray(saved.repairRates)?saved.repairRates:[],
  });
}
export async function saveAssumptions(input: Assumptions, actor: string) {
  return db.transaction(async tx => {
    const now = new Date();
    const previous = await getAssumptions(tx);
    const priorById = new Map(previous.repairRates.map(rate=>[rate.id,rate]));
    const nextById = new Map(input.repairRates.map(rate=>[rate.id,rate]));
    for (const oldRate of previous.repairRates) {
      const nextRate = nextById.get(oldRate.id);
      if (!nextRate) throw new DomainError(`Repair rate card ${oldRate.id} is part of immutable catalog history; deactivate it instead of deleting it.`,409);
      const oldTerms=[oldRate.version,oldRate.marketKey,oldRate.category,oldRate.severity,oldRate.unit,
        oldRate.lowRate,oldRate.expectedRate,oldRate.highRate,oldRate.confidence,oldRate.source,
        oldRate.sourceUrl,oldRate.capturedOn,oldRate.validThrough];
      const nextTerms=[nextRate.version,nextRate.marketKey,nextRate.category,nextRate.severity,nextRate.unit,
        nextRate.lowRate,nextRate.expectedRate,nextRate.highRate,nextRate.confidence,nextRate.source,
        nextRate.sourceUrl,nextRate.capturedOn,nextRate.validThrough];
      if (JSON.stringify(oldTerms)!==JSON.stringify(nextTerms)) {
        throw new DomainError(`Repair rate card ${oldRate.id} is immutable. Add a new version and deactivate the old card.`,409);
      }
      if (!oldRate.active && nextRate.active && nextRate.validThrough < now.toISOString().slice(0,10)) {
        throw new DomainError(`Expired repair rate card ${oldRate.id} cannot be reactivated.`,409);
      }
    }
    for (const rate of input.repairRates) {
      if (priorById.has(rate.id)) continue;
      const matchingHistory = previous.repairRates.filter(old=>
        old.marketKey.toLowerCase()===rate.marketKey.toLowerCase() &&
        old.category.trim().toLowerCase()===rate.category.trim().toLowerCase() &&
        old.severity===rate.severity && old.unit===rate.unit,
      );
      const expectedVersion = matchingHistory.reduce((max,old)=>Math.max(max,old.version),0)+1;
      if (rate.version!==expectedVersion) throw new DomainError(`Repair rate card ${rate.id} must use version ${expectedVersion} for this market/category/severity/unit.`,409);
    }
    const catalogChanged = JSON.stringify(previous.repairRates)!==JSON.stringify(input.repairRates);
    const saved = {
      ...input,
      repairRateCatalogVersion:catalogChanged?previous.repairRateCatalogVersion+1:previous.repairRateCatalogVersion,
    };
    validateAssumptions(saved,now);
    await tx.insert(settingsTable).values({ id:1, assumptions:jsonRecord(saved) })
      .onConflictDoUpdate({target:settingsTable.id,set:{assumptions:jsonRecord(saved),updatedAt:now}});
    await invalidateOffersForPolicyChange(tx,actor,now);
    await audit(tx,actor,"ASSUMPTIONS_CHANGED","workspace",`Updated deterministic underwriting policy and source-backed repair catalog v${saved.repairRateCatalogVersion}. Existing snapshots remain immutable; live offers invalidated. Refresh underwriting and obtain new approval under the new policy.`);
    return saved;
  });
}

export async function createLead(input: LeadInput, actor: string, now = new Date(), transaction?: Tx): Promise<Lead> {
  const write = async (tx: Tx) => {
    const action = input.nextAction?.trim() || "Research ownership, confirm property characteristics and collect sourced comps and repair scope.";
    const payload = { ...input, state:input.state.toUpperCase() };
    await lockCanonicalLeadIdentity(tx, input);
    const [existing] = await tx.select({ id: leadsTable.id }).from(leadsTable).where(sql`
      upper(${leadsTable.payload}->>'state') = ${input.state.toUpperCase()}
      AND upper(${leadsTable.payload}->>'city') = ${input.city.toUpperCase()}
      AND left(${leadsTable.payload}->>'zip',5) = ${input.zip.slice(0,5)}
      AND regexp_replace(upper(${leadsTable.payload}->>'address'),'[^A-Z0-9]','','g') =
        regexp_replace(upper(${input.address}),'[^A-Z0-9]','','g')
    `).limit(1);
    if (existing) throw new DomainError("A deal already exists for this property identity. Reopen the canonical deal instead of creating a duplicate.", 409);
    const [row] = await tx.insert(leadsTable).values({
      payload:jsonRecord(payload), nextAction:action, createdAt:now, updatedAt:now,
    }).returning();
    if (!row) throw new Error("Lead insert failed");
    await audit(tx,actor,"LEAD_CREATED",row.id,`${input.address}: ${action}`);
    await queueJob(tx,"EVALUATE_DECISION",row.id,`decision:${row.id}:created:${row.version}`,actor,{trigger:"LEAD_CREATED"});
    const sellerStatements = [
      ["seller_description", input.sellerDescription], ["selling_reason",input.sellingReason],
    ].filter((pair): pair is [string,string] => Boolean(pair[1]?.trim()));
    for (const [category, statement] of sellerStatements) {
      await tx.insert(intelligenceTable).values({
        leadId:row.id, createdBy:actor, createdAt:now,
        payload:{
          classification:"INDICATED", category, statement, source:input.source, sourceType:"SELLER",
          confidence:0.5, capturedAt:iso(now), question:`Please confirm: ${statement}`,
          action:"Ask the seller; corroborate independently where appropriate.",
        },
      });
    }
    await queueJob(tx,"ENRICH_PROPERTY",row.id,`address:${row.id}:${row.version}`,actor);
    return toLead(row);
  };
  return transaction ? write(transaction) : db.transaction(write);
}
export async function updateLead(id: string, input: LeadInput & {version:number}, actor: string, now = new Date(), transaction?: Tx) {
  const write = async (tx: Tx) => {
    const row = await lockedLead(tx,id,input.version);
    const {version:_,...submitted} = input;
    const identityChanged = ["address","city","state","zip"].some(k=>row.payload[k]!== (submitted as Record<string,unknown>)[k]);
    if (row.payload.propertyQualification && identityChanged) {
      throw new DomainError("This lead is tied to a source-backed qualification. Resolve the linked discovery and requalify before changing its property identity.",409);
    }
    const qualification = row.payload.propertyQualification;
    const sourceKey = row.payload.sourceKey;
    const payload = {
      ...row.payload,
      ...submitted,
      ...(typeof sourceKey === "string" ? {sourceKey} : {}),
      ...(qualification && typeof qualification === "object" ? {propertyQualification:qualification} : {}),
    };
    if (["UNDER_CONTRACT","BUYER_MATCHED","BUYER_INTERESTED","BUYER_COMMITTED","CLOSING"].includes(row.stage) &&
      ["address","city","state","zip","propertyType","units"].some(k=>row.payload[k]!== (payload as Record<string,unknown>)[k])) {
      throw new DomainError("Executed agreement subject identity is frozen. Do not attach new property evidence to another signed transaction.",409);
    }
    const nextAction = "Property information changed. Reconfirm sources and refresh underwriting before calling.";
    await invalidateOffers(tx,id,actor,"Property inputs changed; previous offer authorization is no longer valid.",now);
    await move(tx,row,"ENRICHING","Property inputs changed; previous underwriting invalidated",nextAction,actor,now);
    const [saved] = await tx.update(leadsTable).set({
      payload:jsonRecord({...payload,state:payload.state.toUpperCase()}), analysis:null,analysisSnapshotId:null,
      stage:row.stage,nextAction:row.nextAction,version:row.version+1,updatedAt:now,
    }).where(eq(leadsTable.id,id)).returning();
    await audit(tx,actor,"LEAD_UPDATED",id,"Saved revised property/seller inputs. Previous analysis retained in snapshots; not call-ready until refreshed.");
    await queueJob(tx,"EVALUATE_DECISION",id,`decision:${id}:lead-update:${saved.version}`,actor,{trigger:"LEAD_UPDATED"});
    if (!saved) throw new Error("Lead update failed");
    if (["address","city","state","zip"].some(k=>row.payload[k]!==saved.payload[k])) {
      await queueJob(tx,"ENRICH_PROPERTY",id,`address:${id}:${saved.version}`,actor);
    }
    // Revised seller descriptions remain indicated, not facts.
    for (const [category, field] of [["seller_description","sellerDescription"],["selling_reason","sellingReason"]] as const) {
      const statement = payload[field];
      if (statement?.trim() && statement !== row.payload[field]) {
        await tx.insert(intelligenceTable).values({
          leadId:id,createdBy:actor,createdAt:now,
          payload:{classification:"INDICATED",category,statement,source:payload.source,sourceType:"SELLER",confidence:0.5,capturedAt:iso(now),question:`Please confirm: ${statement}`,action:"Ask seller and corroborate."},
        });
      }
    }
    return toLead(saved);
  };
  return transaction ? write(transaction) : db.transaction(write);
}
export async function addIntelligence(id: string, input: IntelligenceInput, actor: string, now = new Date()): Promise<Intelligence> {
  validateProvenance(input,now);
  return db.transaction(async tx => {
    const row = await lockedLead(tx,id);
    const supplemental = input.classification==="AI_HYPOTHESIS";
    if (!supplemental) await invalidateOffers(tx,id,actor,"New intelligence requires refreshed underwriting and new owner approval.",now);
    const [entry] = await tx.insert(intelligenceTable).values({
      leadId:id,payload:jsonRecord(input),createdBy:actor,createdAt:now,
    }).returning();
    if (!entry) throw new Error("Intelligence insert failed");
    if ((!supplemental && row.analysis) || row.stage === "DISCOVERED") {
      await move(tx,row,"ENRICHING","New sourced intelligence requires underwriting review","Review new evidence and refresh underwriting.",actor,now);
    }
    await tx.update(leadsTable).set({
      stage:row.stage,...(supplemental?{}:{analysis:null,analysisSnapshotId:null}),nextAction:row.nextAction,version:row.version+1,updatedAt:now,
    }).where(eq(leadsTable.id,id));
    await audit(tx,actor,"INTELLIGENCE_ADDED",id,`${input.classification} / ${input.category}; source: ${input.source}; confidence: ${input.confidence}. Append-only, no promotion.`);
    await queueJob(tx,"EVALUATE_DECISION",id,`decision:${id}:intelligence:${entry.id}`,actor,{trigger:"INTELLIGENCE_ADDED",evidenceId:entry.id});
    return AddIntelligenceResponse.parse({...entry.payload,id:entry.id,leadId:id,createdBy:actor,createdAt:iso(now)});
  });
}
export async function saveUnderwriting(id: string, input: UnderwritingInput, actor: string, now = new Date(), transaction?: Tx): Promise<LeadDetail> {
  const write = async (tx: Tx) => {
    const row = await lockedLead(tx,id,input.version);
    const lead = toLead(row);
    const assumptions = await getAssumptions(tx);
    const intelligence = (await tx.select().from(intelligenceTable).where(eq(intelligenceTable.leadId,id))).map(e=>AddIntelligenceResponse.parse({...e.payload,id:e.id,leadId:id,createdBy:e.createdBy,createdAt:iso(e.createdAt)}));
    const {repairEstimate:_untrustedEstimate,...withoutClientEstimate}=input;
    const calculationInput = (withoutClientEstimate.repairObservations?.length ?? 0) > 0
      ? {...withoutClientEstimate,repairs:[]}
      : withoutClientEstimate;
    const rawAnalysis = analyzeDeal(lead,calculationInput,assumptions,now,intelligence);
    const persistedInput:UnderwritingInput = (calculationInput.repairObservations?.length ?? 0) > 0
      ? {
          ...calculationInput,
          repairs:rawAnalysis.repairEstimate.status==="CALCULATED"
            ? rawAnalysis.repairEstimate.lines.map(line=>({
                category:line.category,low:line.low,expected:line.expected,high:line.high,
                confidence:line.confidence,source:line.source,evidenceId:line.evidenceId,
              }))
            : [],
          repairEstimate:rawAnalysis.repairEstimate,
        }
      : calculationInput;
    const analysis = evidenceReviewedAnalysis(rawAnalysis,lead,persistedInput,intelligence,now)!;
    const [snapshot] = await tx.insert(analysesTable).values({
      leadId:id,createdBy:actor,createdAt:now,snapshot:jsonRecord({lead,input:persistedInput,analysis}),
    }).returning({id:analysesTable.id});
    if (!snapshot) throw new Error("Analysis snapshot insert failed");
    await invalidateOffers(tx,id,actor,"Underwriting refreshed; offers must bind to the new snapshot and be approved again.",now);
    if (analysis.classification === "INCOMPLETE") {
      await move(tx,row,"ENRICHING","Underwriting incomplete",analysis.blockers.join("; "),actor,now);
    } else {
      await move(tx,row,"ANALYZED","Deterministic underwriting passed completeness gates","Review classification and call-readiness.",actor,now);
      const action = analysis.classification === "PASS" ? "Do not call for an offer. Revisit with new sourced information or close the lead."
        : lead.sellerPhone?.trim() ? "Review seller brief and mark CALL READY." : "Obtain permitted seller contact details before CALL READY.";
      await move(tx,row,analysis.classification,"Classification calculated by deterministic underwriting engine",action,actor,now);
    }
    await tx.update(leadsTable).set({
      underwriting:jsonRecord(persistedInput),analysis:jsonRecord(analysis),analysisSnapshotId:snapshot.id,stage:row.stage,
      nextAction:row.nextAction,version:row.version+1,updatedAt:now,
    }).where(eq(leadsTable.id,id));
    await audit(tx,actor,"UNDERWRITING_SAVED",id,`${analysis.engineVersion}: ${analysis.classification}; MAO $${analysis.mao}. Snapshot preserves inputs, policy, excluded comps and calculation time. No offer authorized.`);
    await queueJob(tx,"EVALUATE_DECISION",id,`decision:${id}:analysis:${snapshot.id}`,actor,{trigger:"UNDERWRITING_SAVED",analysisSnapshotId:snapshot.id});
    if (["STRONG","NEGOTIABLE"].includes(analysis.classification)) await queueJob(tx,"PREPARE_BRIEF",id,`brief:${id}:${snapshot.id}`,actor);
    return leadDetail(id,tx,now);
  };
  return transaction ? write(transaction) : db.transaction(write);
}

export function followupDate(value: string | null | undefined, now: Date): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= now.getTime()) throw new DomainError("Follow-up must be a valid future date.");
  return date;
}
export async function transitionLeadForActor(id: string, input: TransitionInput, actor: OfferActor, now = new Date()): Promise<LeadDetail> {
  assertTransitionPermission(actor.role,input.to);
  return transitionLead(id,input,actor.id,now);
}
export async function transitionLead(id: string, input: TransitionInput, actor: string, now = new Date()): Promise<LeadDetail> {
  return db.transaction(async tx => {
    const row = await lockedLead(tx,id,input.version);
    const detail = await leadDetail(id,tx,now);
    if (input.to === "CALL_READY") {
      const [linkedDiscovery] = await tx.select().from(propertyDiscoveriesTable)
        .where(eq(propertyDiscoveriesTable.leadId, id)).for("update");
      if (linkedDiscovery) {
        const contactCase = linkedDiscovery.payload.contactResearchCase;
        if (!contactCase || typeof contactCase !== "object") {
          throw new DomainError("CALL_READY is blocked: source-backed ownership/identity review and a permitted seller route are required.", 409);
        }
        const blockers = evaluatePropertyContactabilityGate(contactCase as SellerContactabilityEvidence, now);
        if (blockers.length) throw new DomainError(`CALL_READY is blocked: ${blockers.join(" ")}`, 409);
      }
    }
    validateTransition(toLead(row),detail.analysis,input,now);
    if (["ENRICHING","DEAD_DEAL"].includes(input.to)) await invalidateOffers(tx,id,actor,`Deal moved to ${input.to}; offer approval invalidated.`,now);
    const followUpAt = input.followUpAt === undefined ? row.followUpAt : followupDate(input.followUpAt,now);
    if (["CONTACTED","CONVERSATION","NEGOTIATING"].includes(input.to) && (!followUpAt || followUpAt.getTime() <= now.getTime())) {
      throw new DomainError("Active seller conversations and negotiation require a future follow-up.");
    }
    await move(tx,row,input.to,input.reason,input.nextAction,actor,now);
    const qualification = row.payload.propertyQualification;
    const qualifiedPayload = qualification && typeof qualification === "object"
      ? {
          ...row.payload,
          propertyQualification: {
            ...(qualification as Record<string, unknown>),
            status: input.to === "CALL_READY"
              ? "CALL_READY"
              : ["PASS", "DEAD_DEAL"].includes(input.to)
                ? "DISQUALIFIED"
                : (qualification as Record<string, unknown>).status,
            nextAction: row.nextAction,
          },
        }
      : row.payload;
    await tx.update(leadsTable).set({
      payload: qualifiedPayload,
      stage:row.stage,nextAction:row.nextAction,followUpAt,version:row.version+1,updatedAt:now,
      ...(input.to === "ENRICHING" ? {analysis:null,analysisSnapshotId:null} : {}),
    }).where(eq(leadsTable.id,id));
    const [discovery] = await tx.select().from(propertyDiscoveriesTable)
      .where(eq(propertyDiscoveriesTable.leadId,id)).for("update");
    if (discovery && (input.to === "CALL_READY" || input.to === "PASS" || input.to === "DEAD_DEAL")) {
      const payload = { ...discovery.payload };
      const nextStatus = input.to === "CALL_READY" ? "CALL_READY" : "DISQUALIFIED";
      if (nextStatus === "DISQUALIFIED") {
        payload.disposition = {
          actor, at: now.toISOString(),
          reason: `Linked lead moved to ${input.to}: ${input.reason}`,
        };
      }
      await tx.update(propertyDiscoveriesTable).set({
        status:nextStatus,payload,version:discovery.version+1,updatedAt:now,
      }).where(eq(propertyDiscoveriesTable.id,discovery.id));
    }
    return leadDetail(id,tx,now);
  });
}
type SellerEvidenceTopic = "MOTIVATION" | "CONDITION" | "OCCUPANCY" | "ASKING_PRICE" | "TITLE_TENANT" | "TIMING" | "OTHER";

function sellerEvidenceTopic(category: string, statement: string): SellerEvidenceTopic {
  const text = `${category} ${statement}`.toLowerCase();
  if (/\b(?:motivation|reason for selling|seller_motivation)\b/.test(text)) return "MOTIVATION";
  if (/\b(?:condition|roof|kitchen|bath|hvac|electrical|plumbing|floor|exterior|foundation|repair|defect|damage)\b/.test(text)) return "CONDITION";
  if (/\b(?:occupancy|vacan|tenant|occupied|unoccupied)\b/.test(text)) return "OCCUPANCY";
  if (/\b(?:asking[_ ]?price|seller[_ ]?price)\b/.test(text)) return "ASKING_PRICE";
  if (/\b(?:title|lien|tenant)\b/.test(text)) return "TITLE_TENANT";
  if (/\b(?:timing|urgency|closing date|move date)\b/.test(text)) return "TIMING";
  return "OTHER";
}

function explicitConditionIssue(value: string) {
  return /\b(?:leak|leaking|failed|not working|needs? replacement|needs? repair|crack|damage|mold|rott?en|outdated|dated|missing|broken|water intrusion|flood)\b/i.test(value);
}

function explicitMotivation(value: string) {
  return /\b(?:reason for selling|selling because|motivated|must sell|needs? to sell|relocat|inherited|estate sale|vacant|behind on (?:mortgage|payments)|foreclosure|urgent)\b/i.test(value);
}

function contradiction(topic: SellerEvidenceTopic, a: string, b: string): boolean {
  if (topic === "OCCUPANCY") {
    const occupancy = (value: string) => ({
      vacant: /\b(?:vacant|unoccupied|empty)\b/i.test(value),
      occupied: /\b(?:occupied|tenant|rented|leased)\b/i.test(value),
    });
    const first = occupancy(a);
    const second = occupancy(b);
    return (first.vacant && second.occupied) || (first.occupied && second.vacant);
  }
  if (topic !== "CONDITION") return false;
  const negative = (value: string) =>
    /\bno\b.{0,25}\b(?:leak|damage|issue|crack|problem|defect)\b|\bnot\b.{0,20}\b(?:leaking|damaged|cracked|broken|failed|needed)\b|\bwithout\b.{0,20}\b(?:leak|damage|issue|crack|defect)\b|\b(?:sound|good condition|recently replaced)\b/i.test(value);
  return (explicitConditionIssue(a) && negative(b)) || (explicitConditionIssue(b) && negative(a));
}

async function qualificationCriteriaFor(tx: Tx, marketKey: string): Promise<PropertyQualificationCriteria> {
  const [row] = await tx.select().from(propertyQualificationCriteriaTable)
    .where(eq(propertyQualificationCriteriaTable.marketKey, marketKey));
  const stored = row ? row.criteria as Record<string, unknown> : {};
  const storedRules = Array.isArray(stored.signalRules)
    ? stored.signalRules as PropertyQualificationCriteria["signalRules"] : [];
  const storedKeys = new Set(storedRules.map(rule => rule.key));
  return {
    ...(row ? stored : DEFAULT_PROPERTY_QUALIFICATION_CRITERIA),
    marketKey,
    version: row?.version ?? DEFAULT_PROPERTY_QUALIFICATION_CRITERIA.version,
    signalRules: row
      ? [...storedRules, ...DEFAULT_PROPERTY_QUALIFICATION_CRITERIA.signalRules.filter(rule => !storedKeys.has(rule.key))]
      : DEFAULT_PROPERTY_QUALIFICATION_CRITERIA.signalRules,
  } as PropertyQualificationCriteria;
}

function makeSellerRelevanceSignals(input: CallInput, callId: string, capturedAt: string): PropertyRelevanceSignal[] {
  if (!["CONNECTED", "NOT_INTERESTED"].includes(input.outcome)) return [];
  const answers = input.sellerAnswers;
  const confidence = input.operatorConfidence ?? 0.5;
  const signals: PropertyRelevanceSignal[] = [];
  const motivation = answers?.motivationStatement?.trim() ||
    (explicitMotivation(input.notes) ? input.notes.trim() : "");
  if (motivation) signals.push({
    id: `seller-call:${callId}:motivation`, key: "SELLER_MOTIVATION", group: "MOTIVATION",
    classification: "INDICATED", sourceType: "SELLER",
    statement: `Seller-reported reason/intent: ${motivation}`,
    source: "Operator-recorded seller call", sourceUrl: null,
    evidenceRef: `seller-call:${callId}:motivation`, capturedAt, confidence,
  });
  const conditionStatements = [
    answers?.conditionDescription,
    ...(answers?.conditionByCategory ?? []).map(item => `${item.category}: ${item.statement}`),
    answers?.knownDefects,
  ].filter((value): value is string => !!value?.trim());
  if (conditionStatements.some(explicitConditionIssue)) signals.push({
    id: `seller-call:${callId}:condition`, key: "REPORTED_POOR_CONDITION", group: "CONDITION",
    classification: "INDICATED", sourceType: "SELLER",
    statement: "Seller-call answers indicate a condition or repair issue; this is not an inspection finding.",
    source: "Operator-recorded seller call", sourceUrl: null,
    evidenceRef: `seller-call:${callId}:condition`, capturedAt, confidence,
  });
  const occupancy = answers?.occupancy?.trim();
  if (occupancy && /\b(?:vacant|unoccupied|empty)\b/i.test(occupancy) &&
    !/\b(?:not vacant|occupied)\b/i.test(occupancy)) signals.push({
    id: `seller-call:${callId}:vacancy`, key: "VACANCY", group: "VACANCY",
    classification: "INDICATED", sourceType: "SELLER",
    statement: `Seller-reported occupancy: ${occupancy}`,
    source: "Operator-recorded seller call", sourceUrl: null,
    evidenceRef: `seller-call:${callId}:vacancy`, capturedAt, confidence,
  });
  return signals;
}

function sellerCallEvidence(input: CallInput, callId: string, now: Date, existing: Intelligence[]) {
  const sellerContacted = ["CONNECTED", "NOT_INTERESTED"].includes(input.outcome);
  const sourceType = sellerContacted ? "SELLER" as const : "ANALYST" as const;
  const classification = sellerContacted ? "INDICATED" as const : "OBSERVED" as const;
  const confidence = input.operatorConfidence ?? 0.5;
  const clarificationStatus = input.clarificationStatus ?? "UNREVIEWED";
  const confidenceBasis = input.operatorConfidence === undefined
    ? "UNASSESSED_CONSERVATIVE_DEFAULT" as const : "OPERATOR_ASSESSED" as const;
  const specs: Array<{ field: string; category: string; statement: string }> = [{
    field: "notes", category: sellerContacted ? "seller_call_note" : "call_attempt_note",
    statement: input.notes.trim(),
  }];
  const answers = input.sellerAnswers;
  if (answers) {
    if (answers.motivationStatement?.trim()) specs.push({ field: "motivationStatement", category: "seller_call_motivation", statement: answers.motivationStatement.trim() });
    if (answers.urgency?.trim()) specs.push({ field: "urgency", category: "seller_call_urgency", statement: answers.urgency.trim() });
    if (answers.timing?.trim()) specs.push({ field: "timing", category: "seller_call_timing", statement: answers.timing.trim() });
    if (answers.conditionDescription?.trim()) specs.push({ field: "conditionDescription", category: "seller_call_condition", statement: answers.conditionDescription.trim() });
    for (const item of answers.conditionByCategory ?? []) specs.push({
      field: `conditionByCategory.${item.category}`,
      category: `seller_call_condition_${item.category.toLowerCase()}`,
      statement: `Seller reported ${item.category.toLowerCase()} condition: ${item.statement.trim()}`,
    });
    if (answers.askingPrice != null) specs.push({
      field: "askingPrice", category: "seller_call_asking_price",
      statement: `Seller stated an asking price of $${answers.askingPrice.toLocaleString("en-US")}. This report has not been reconciled into underwriting.`,
    });
    for (const [field, category, label] of [
      ["occupancy", "seller_call_occupancy", "Seller-reported occupancy"],
      ["repairsCompleted", "seller_call_repairs_completed", "Seller-reported completed repairs"],
      ["knownDefects", "seller_call_known_defects", "Seller-reported defects"],
      ["titleTenantIssues", "seller_call_title_tenant_issues", "Seller-reported title or tenant issues"],
      ["accessConstraints", "seller_call_access_constraints", "Seller-reported access constraints"],
      ["willingnessToAcceptTerms", "seller_call_terms", "Seller-reported terms flexibility"],
      ["nextStepOutcome", "seller_call_next_step", "Seller-reported next-step outcome"],
      ["otherMaterialStatements", "seller_call_other_statement", "Other seller-reported material statement"],
    ] as const) {
      const value = answers[field];
      if (typeof value === "string" && value.trim()) specs.push({ field, category, statement: `${label}: ${value.trim()}` });
    }
  }
  return specs.map(spec => {
    const topic = sellerEvidenceTopic(spec.category, spec.statement);
    const comparable = existing.filter(item =>
      item.sourceType !== "MODEL" && item.sourceType !== "ANALYST" &&
      sellerEvidenceTopic(item.category, item.statement) === topic && topic !== "OTHER");
    const conflicts = comparable.filter(item => contradiction(topic, item.statement, spec.statement));
    const conflict = conflicts.length > 0;
    const conflictQuestion: Partial<IntelligenceInput> = topic === "CONDITION" ? {
      question: "The seller's statement conflicts with or supplements earlier condition evidence—what current inspection or source can resolve it?",
      action: "Keep both records; review the conflict and obtain current inspection evidence before using a repair amount.",
    } : topic === "OCCUPANCY" ? {
      question: "The seller's occupancy statement differs from prior evidence—who currently occupies the property?",
      action: "Keep both records and reconcile occupancy before marketing or underwriting.",
    } : {};
    const entry: IntelligenceInput = {
      classification, category: spec.category, statement: spec.statement,
      source: sellerContacted ? "Operator-recorded seller conversation" : "Operator-recorded call attempt",
      sourceType, confidence, capturedAt: now.toISOString(), sourceRecordId: callId,
      confidenceBasis, clarificationStatus,
      ...(conflictQuestion),
      reconciliation: {
        state: conflict ? "CONFLICT_REVIEW" : comparable.length ? "NO_CONFLICT_FOUND" : "NO_COMPARABLE_EVIDENCE",
        comparedEvidenceIds: comparable.slice(0, 50).map(item => item.id),
        reason: conflict
          ? "The new operator-recorded statement contradicts comparable older evidence. Neither statement replaces the other."
          : comparable.length
            ? "Comparable evidence was checked; no explicit contradiction was detected."
            : "No comparable earlier evidence was found; this statement remains uncorroborated.",
      },
    };
    return { field: spec.field, topic, entry };
  });
}

async function persistCallRelevance(
  tx: Tx, row: LeadRow, signals: PropertyRelevanceSignal[], material: boolean, executed: boolean, actor: string, now: Date,
) {
  if (!signals.length && !material) return row.payload;
  const prior = row.payload.propertyQualification;
  if (!prior || typeof prior !== "object" || Array.isArray(prior)) return row.payload;
  const qualification = prior as Record<string, unknown>;
  const city = String(row.payload.city ?? "UNKNOWN").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const state = String(row.payload.state ?? "XX").trim().toUpperCase();
  const marketKey = typeof qualification.marketKey === "string"
    ? qualification.marketKey : city === "PHILADELPHIA" ? "PHILADELPHIA_PA" : `${city}_${state}`;
  const criteria = await qualificationCriteriaFor(tx, marketKey);
  const storedSignals = Array.isArray(qualification.signals) ? qualification.signals as PropertyRelevanceSignal[] : [];
  const byId = new Map([...storedSignals, ...signals].map(signal => [signal.id, signal]));
  const evaluation = evaluatePropertyRelevance([...byId.values()], criteria);
  const status = material && !executed && qualification.status === "CALL_READY"
    ? "QUALIFIED_LEAD" : qualification.status;
  const nextQualification = {
    ...qualification, status, score: evaluation.score, confidence: evaluation.confidence,
    criteriaVersion: criteria.version, reason: evaluation.reason,
    signals: evaluation.scoredSignals.map(({ points, ...signal }) => ({ ...signal, scoreContribution: points })),
    missingInformation: [...new Set([
      ...(Array.isArray(qualification.missingInformation)
        ? qualification.missingInformation.filter((item): item is string => typeof item === "string") : []),
      ...evaluation.missingInformation,
      ...(material ? ["Seller-call evidence requires review before refreshed underwriting or another offer."] : []),
    ])],
    ...(material ? { evidenceReviewRequired: true, evidenceReviewAt: now.toISOString(), evidenceReviewBy: actor } : {}),
  };
  const payload = { ...row.payload, propertyQualification: nextQualification };
  if (typeof qualification.discoveryId === "string") {
    const [discovery] = await tx.select().from(propertyDiscoveriesTable)
      .where(eq(propertyDiscoveriesTable.id, qualification.discoveryId)).for("update");
    if (discovery) {
      const discoveryPayload = discovery.payload as Record<string, unknown>;
      const sourceSignals = Array.isArray(discoveryPayload.signals) ? discoveryPayload.signals as PropertyRelevanceSignal[] : [];
      const discoveryById = new Map([...sourceSignals, ...signals].map(signal => [signal.id, signal]));
      const discoveryEvaluation = evaluatePropertyRelevance([...discoveryById.values()], criteria);
      await tx.update(propertyDiscoveriesTable).set({
        status: material && !executed && discovery.status === "CALL_READY" ? "QUALIFIED_LEAD" : discovery.status,
        score: discoveryEvaluation.score, confidence: discoveryEvaluation.confidence,
        payload: jsonRecord({ ...discoveryPayload, signals: [...discoveryById.values()] }),
        version: discovery.version + 1, updatedAt: now,
      }).where(eq(propertyDiscoveriesTable.id, discovery.id));
    }
  }
  return payload;
}

export async function recordCall(id: string, input: CallInput, actor: string, now = new Date()): Promise<LeadDetail> {
  let structuredFields: SellerConversationField[] = [];
  if (input.occurredAt) {
    const occurred = Date.parse(input.occurredAt);
    if (!Number.isFinite(occurred) || occurred > now.getTime()) {
      throw new DomainError("Actual call time must be a valid timestamp no later than the recorded call result.", 400);
    }
  }
  return db.transaction(async tx => {
    const row = await lockedLead(tx,id,undefined,true);
    if (input.idempotencyKey) {
      const priorCalls = await tx.select().from(callsTable).where(eq(callsTable.leadId,id));
      const prior = priorCalls.find(call => call.payload.idempotencyKey === input.idempotencyKey);
      if (prior) {
        if (prior.actor !== actor || prior.payload.submissionHash !== callSubmissionHash(input)) {
          throw new DomainError("Call submission key was already used for different content or by another operator.",409);
        }
        return leadDetail(id,tx,now);
      }
    }
    if (input.structuredFieldsJson) {
      try { structuredFields = validateSellerConversationFields(input.notes, input.structuredFieldsJson); }
      catch (error) { throw new DomainError(error instanceof Error ? error.message : "Invalid structured seller fields.", 400); }
    }
    if (row.version !== input.version) throw new DomainError("This lead changed in another session. Reload before saving.",409);
    if (row.stage === "DEAD_DEAL" || row.stage === "CLOSED") throw new DomainError("This lead is terminal and cannot be changed.",409);
    const executed = ["UNDER_CONTRACT","BUYER_MATCHED","BUYER_INTERESTED","BUYER_COMMITTED","CLOSING"].includes(row.stage);
    if (!["CALL_READY","CONTACTED","CONVERSATION","OFFER_READY","OFFER_SENT","NEGOTIATING","CONTRACT_PENDING"].includes(row.stage)&&!executed) throw new DomainError("Calls can only be recorded for call-ready or active seller/closing conversations.");
    const before = await leadDetail(id,tx,now);
    if (row.stage === "CALL_READY") {
      if (!before.analysis || before.analysis.blockers.length) {
        throw new DomainError("CALL READY evidence is stale or incomplete. Refresh the seller phone source and underwriting before recording outreach.",409);
      }
      const contact = await getSellerContactPaths(id,now,tx);
      if (contact.directRouteStatus !== "PHONE_ROUTE_AVAILABLE" || !contact.selectedPhonePath?.routeValue) {
        throw new DomainError(`${contact.nextAction} CALL READY remains blocked.`,409);
      }
    }
    if (executed&&input.outcome==="NOT_INTERESTED") throw new DomainError("A phone response cannot cancel an executed contract. Record the conversation with a follow-up and use the owner-reviewed external cancellation evidence workflow.",409);
    const sellerContacted = ["CONNECTED", "NOT_INTERESTED"].includes(input.outcome);
    const sellerAnswersPresent = !!input.sellerAnswers && Object.values(input.sellerAnswers)
      .some(value => value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0));
    if (sellerAnswersPresent && !sellerContacted) {
      throw new DomainError("Seller answers can only be captured after a connected seller response. Record a no-answer/voicemail as an operator call observation.");
    }
    const followUpAt = followupDate(input.followUpAt,now);
    if (input.outcome !== "NOT_INTERESTED" && !followUpAt) throw new DomainError("Set a future follow-up so the seller conversation does not become a dead end.");
    const stage: Stage = input.outcome === "NOT_INTERESTED" ? "DEAD_DEAL" : input.outcome === "CONNECTED" ? "CONVERSATION" : "CONTACTED";
    const [savedCall] = await tx.insert(callsTable)
      .values({leadId:id,payload:jsonRecord(input.idempotencyKey
        ? {...input,submissionHash:callSubmissionHash(input)}
        : input),actor,createdAt:now})
      .returning({id:callsTable.id});
    if (!savedCall) throw new Error("Call result persistence failed.");
    const evidenceEvents = sellerCallEvidence(input,savedCall.id,now,before.intelligence);
    const evidenceIds: string[] = [];
    for (const { entry } of evidenceEvents) {
      validateProvenance(entry,now);
      const [savedEvidence] = await tx.insert(intelligenceTable).values({
        leadId:id,payload:jsonRecord(entry),createdBy:actor,createdAt:now,
      }).returning({id:intelligenceTable.id});
      if (savedEvidence) evidenceIds.push(savedEvidence.id);
    }
    const materialFields = new Set([
      "motivationStatement","urgency","timing","askingPrice","conditionDescription","conditionByCategory",
      "occupancy","repairsCompleted","knownDefects","titleTenantIssues","accessConstraints",
      "willingnessToAcceptTerms","otherMaterialStatements",
    ]);
    const structuredMaterial = Object.keys(input.sellerAnswers ?? {}).some(field => materialFields.has(field));
    const materialNote = sellerContacted && /\b(?:motivat|reason for selling|selling because|must sell|relocat|inherit|vacant|tenant|occupied|lien|title|roof|kitchen|bath|hvac|electrical|plumb|floor|foundation|repair|defect|damage|as[- ]is|price|asking|urgenc|deadline|access|inspection|foreclosure|tax|closing)\b/i.test(input.notes);
    const materialEvidence = sellerContacted && (structuredMaterial || materialNote);
    const conflictFields = evidenceEvents.filter(item => item.entry.reconciliation?.state === "CONFLICT_REVIEW").map(item => item.field);
    const relevanceSignals = makeSellerRelevanceSignals(input,savedCall.id,now.toISOString());
    const updatedPayload = await persistCallRelevance(tx,row,relevanceSignals,materialEvidence,executed,actor,now);
    const effectiveNextAction = materialEvidence && !executed
      ? conflictFields.length
        ? "Reconcile conflicting seller-call and source evidence, then refresh underwriting before another offer."
        : "Review the new seller-reported evidence and refresh current underwriting before another seller action."
      : executed && materialEvidence
        ? `${input.nextAction} Review seller-reported evidence against the active agreement; preserve executed terms unless a separately authorized, evidenced amendment is completed.`
        : input.nextAction;
    const analysisInvalidated = materialEvidence && !executed && (!!row.analysisSnapshotId || !!row.analysis);
    if (materialEvidence && !executed) {
      await invalidateOffers(tx,id,actor,
        "Material seller-call evidence requires reconciliation and fresh underwriting; prior offer authority and distribution artifacts are stale.",now);
      const [draft] = await tx.select().from(contractsTable).where(eq(contractsTable.leadId,id)).for("update");
      if (draft?.payload.status==="DRAFT") {
        const history = Array.isArray(draft.payload.history) ? draft.payload.history : [];
        await tx.update(contractsTable).set({
          payload:{
            ...draft.payload,
            status:"CANCELLED",
            cancelledAt:now.toISOString(),
            history:[...history,{
              kind:"CANCELLED_ATTEMPT",recordedAt:now.toISOString(),effectiveAt:now.toISOString(),recordedBy:actor,
              note:"Unexecuted draft abandoned because new seller-call evidence made its underwriting snapshot stale. No signature or external cancellation is asserted.",
              previousState:{status:"DRAFT",offerId:draft.payload.offerId ?? null,purchasePrice:draft.payload.purchasePrice ?? null},
            }],
          },
          version:draft.version+1,updatedAt:now,
        }).where(eq(contractsTable.id,draft.id));
      }
      await audit(tx,actor,"SELLER_CALL_EVIDENCE_INVALIDATED_AUTHORITY",id,
        `Call ${savedCall.id}; material indicated seller evidence captured. Old analysis snapshots remain immutable; live analysis pointer and any unexecuted authorization are invalidated; seller answer values were not copied into economics.`);
    }
    if (executed && materialEvidence) {
      await audit(tx,actor,"SELLER_CALL_EVIDENCE_POST_EXECUTION_REVIEW",id,
        `Call ${savedCall.id}; material seller-reported evidence retained for review. Executed terms, locked economics, and transaction state were preserved.`);
    }
    if (conflictFields.length) {
      await audit(tx,actor,"SELLER_CALL_EVIDENCE_CONFLICT_REVIEW",id,
        `Call ${savedCall.id}; conflicting evidence topics: ${conflictFields.join(", ")}. Both source histories were retained; no fact was overwritten.`);
    }
    const persistedCall = {
      ...input,
      ...(input.idempotencyKey ? { submissionHash: callSubmissionHash(input) } : {}),
      evidenceSource: sellerContacted ? "OPERATOR_ENTERED_SELLER_CONVERSATION" as const : "OPERATOR_CALL_ATTEMPT" as const,
      evidenceClassification: sellerContacted ? "INDICATED" as const : "OBSERVED" as const,
      ...(sellerContacted ? { sellerAnswersCapturedAt: iso(now) } : {}),
      evidenceIds,
      materialEvidence,
      analysisInvalidated,
    };
    await tx.update(callsTable).set({payload:jsonRecord(persistedCall)}).where(eq(callsTable.id,savedCall.id));
    if (evidenceIds.length) {
      await audit(tx, actor, "CALL_RESULT_EVIDENCE_CAPTURED", id,
        `Call ${savedCall.id}; ${evidenceIds.length} append-only call evidence event(s) persisted with source record linkage at ${iso(now)}. ${materialEvidence ? "Material evidence invalidated pre-execution analysis/authority, but did not rewrite economics." : "No economic input was changed."}`);
    }
    if (structuredFields.length) await audit(tx, actor, "SELLER_CONVERSATION_FIELDS_CAPTURED", id,
      JSON.stringify({ callId: savedCall.id, fieldKeys: structuredFields.map(field => field.field),
        editedFields: structuredFields.filter(field => field.edited).map(field => field.field),
        attributions: structuredFields.map(field => field.attribution),
        noteAnchorsValidated: true, underwritingChanged: false }));
    // A connected first call must preserve CONTACTED before CONVERSATION.
    if (row.stage === "CALL_READY" && stage === "CONVERSATION") {
      await move(tx,row,"CONTACTED","Seller answered the call","Continue the seller conversation.",actor,now);
    }
    // No-answer followups cannot regress an existing CONVERSATION.
    const nextStage: Stage = (executed || ["CONVERSATION","OFFER_READY","OFFER_SENT","NEGOTIATING","CONTRACT_PENDING"].includes(row.stage)) && stage !== "DEAD_DEAL" ? toLead(row).stage : stage;
    if (nextStage === "DEAD_DEAL" && !materialEvidence) await invalidateOffers(tx,id,actor,"Seller is not interested; deal closed and offer authorization invalidated.",now);
    if (nextStage==="DEAD_DEAL") {
      const [draft] = await tx.select().from(contractsTable).where(eq(contractsTable.leadId,id)).for("update");
      if (draft?.payload.status==="DRAFT") await tx.update(contractsTable).set({
        payload:{...draft.payload,status:"CANCELLED",outcomeNote:"Unexecuted draft abandoned following the recorded seller decline. No executed agreement or legal obligation was cancelled."},
        version:draft.version+1,updatedAt:now,
      }).where(eq(contractsTable.id,draft.id));
    }
    await move(tx,row,nextStage,`Call outcome: ${input.outcome}. ${input.notes}`,effectiveNextAction,actor,now);
    await tx.update(leadsTable).set({
      stage:row.stage,nextAction:effectiveNextAction,followUpAt,version:row.version+1,updatedAt:now,
      payload:updatedPayload,
      ...(analysisInvalidated ? {analysis:null,analysisSnapshotId:null} : {}),
    }).where(eq(leadsTable.id,id));
    await audit(tx,actor,"CALL_RECORDED",id,`${input.outcome}; follow-up ${followUpAt?.toISOString() ?? "none (terminal)"}; next: ${input.nextAction}`);
    await queueJob(tx,"EVALUATE_DECISION",id,`decision:${id}:call:${row.version+1}`,actor,{trigger:"SELLER_CALL_RECORDED",leadVersion:row.version+1});
    if (input.outcome==="CONNECTED") await queueJob(tx,"PREPARE_BRIEF",id,`conversation-brief:${id}:${row.version+1}`,actor);
    return leadDetail(id,tx,now);
  });
}

export async function recordBuyerCall(id: string, input: {
  version:number; buyerId:string; idempotencyKey:string; outcome:CallInput["outcome"];
  notes:string; nextAction:string; occurredAt?:string; followUpAt:string; operatorConfidence:number;
}, actor:string, now = new Date()):Promise<LeadDetail> {
  const occurredAt=input.occurredAt ? new Date(input.occurredAt) : now;
  const dueAt=new Date(input.followUpAt);
  if (!Number.isFinite(occurredAt.getTime()) || occurredAt.getTime()>now.getTime()) throw new DomainError("Call time must be valid and no later than recording time.",400);
  if (!Number.isFinite(dueAt.getTime()) || dueAt.getTime()<=now.getTime()) throw new DomainError("Buyer follow-up must have a future due date.",400);
  const fingerprint=createHash("sha256").update(stableJson(input)).digest("hex");
  return db.transaction(async tx=>{
    const row=await lockedLead(tx,id,undefined,true);
    const priorRows=await tx.select().from(callsTable).where(eq(callsTable.leadId,id));
    const prior=priorRows.find(call=>call.payload.idempotencyKey===input.idempotencyKey);
    if(prior){
      if(prior.actor!==actor||prior.payload.submissionHash!==fingerprint) throw new DomainError("Call submission key was already used for different content or by another operator.",409);
      return leadDetail(id,tx,now);
    }
    if(row.version!==input.version) throw new DomainError("Deal changed in another session. Reload before recording this call.",409);
    const [buyer]=await tx.select().from(buyersTable).where(eq(buyersTable.id,input.buyerId));
    if(!buyer) throw new DomainError("Buyer record not found.",404);
    if(buyer.payload.synthetic===true) throw new DomainError("Synthetic buyer fixtures cannot be recorded as real calls.",409);
    const record={version:input.version,counterpartyKind:"BUYER" as const,buyerId:input.buyerId,
      idempotencyKey:input.idempotencyKey,submissionHash:fingerprint,outcome:input.outcome,
      notes:input.notes,nextAction:input.nextAction,occurredAt:occurredAt.toISOString(),followUpAt:dueAt.toISOString(),operatorConfidence:input.operatorConfidence,
      actor,evidenceSource:"OPERATOR_ENTERED_BUYER_CALL",evidenceClassification:"OBSERVED",
      buyerFollowUpStatus:"OPEN",buyerFollowUpNote:"Follow-up scheduled with the buyer.",
      buyerFollowUpHistory:[{status:"OPEN",actor,at:now.toISOString(),note:"Follow-up scheduled with the buyer.",dueAt:dueAt.toISOString()}]};
    const [saved]=await tx.insert(callsTable).values({leadId:id,actor,payload:jsonRecord(record)}).returning({id:callsTable.id});
    await tx.update(callsTable).set({payload:{...record,id:saved.id}}).where(eq(callsTable.id,saved.id));
    await tx.update(leadsTable).set({version:row.version+1,updatedAt:now}).where(eq(leadsTable.id,id));
    await audit(tx,actor,"BUYER_CALL_RECORDED",id,JSON.stringify({callId:saved.id,buyerId:input.buyerId,outcome:input.outcome,dueAt:dueAt.toISOString(),dealVersion:row.version+1,offerAuthorityChanged:false,sellerFollowUpChanged:false}));
    return leadDetail(id,tx,now);
  });
}

export async function updateBuyerCallFollowUp(id:string,callId:string,input:{version:number;status:"OPEN"|"COMPLETED";note:string;dueAt?:string|null},actor:string,now=new Date()):Promise<LeadDetail>{
  return db.transaction(async tx=>{
    const row=await lockedLead(tx,id,undefined,true);
    if(row.version!==input.version) throw new DomainError("Deal changed in another session. Reload before updating this follow-up.",409);
    const [call]=await tx.select().from(callsTable).where(eq(callsTable.id,callId)).for("update");
    if(!call||call.leadId!==id||call.payload.counterpartyKind!=="BUYER") throw new DomainError("Buyer call follow-up not found.",404);
    const due=input.dueAt ? new Date(input.dueAt) : call.payload.followUpAt ? new Date(String(call.payload.followUpAt)) : null;
    if(input.status==="OPEN"&&(!due||!Number.isFinite(due.getTime())||due.getTime()<=now.getTime())) throw new DomainError("An open buyer follow-up needs a future due date.",400);
    if(call.payload.buyerFollowUpStatus===input.status&&call.payload.buyerFollowUpNote===input.note
      &&String(call.payload.followUpAt??"")===String(due?.toISOString()??"")) return leadDetail(id,tx,now);
    const priorHistory=Array.isArray(call.payload.buyerFollowUpHistory)?call.payload.buyerFollowUpHistory:[];
    const history=[...priorHistory,{status:input.status,actor,at:now.toISOString(),note:input.note,dueAt:due?.toISOString()??null}];
    await tx.update(callsTable).set({payload:{...call.payload,buyerFollowUpStatus:input.status,buyerFollowUpNote:input.note,buyerFollowUpHistory:history,followUpAt:due?.toISOString()??null}}).where(eq(callsTable.id,callId));
    await tx.update(leadsTable).set({version:row.version+1,updatedAt:now}).where(eq(leadsTable.id,id));
    await audit(tx,actor,"BUYER_CALL_FOLLOW_UP_UPDATED",id,JSON.stringify({callId,status:input.status,note:input.note,dueAt:due?.toISOString()??null,historyCount:history.length}));
    return leadDetail(id,tx,now);
  });
}

export async function listBuyerCallFollowUps(now=new Date()) {
  const [calls,leads]=await Promise.all([db.select().from(callsTable),db.select().from(leadsTable)]);
  const leadById=new Map(leads.map(lead=>[lead.id,lead]));
  return {generatedAt:now.toISOString(),items:calls.flatMap(call=>{
    const p=call.payload,lead=leadById.get(call.leadId);
    if(p.counterpartyKind!=="BUYER"||p.buyerFollowUpStatus!=="OPEN"||!lead||typeof p.buyerId!=="string"||typeof p.followUpAt!=="string") return [];
    return [{leadId:lead.id,callId:call.id,buyerId:p.buyerId,address:`${lead.payload.city}, ${lead.payload.state}`,
      outcome:p.outcome as CallInput["outcome"],notes:String(p.notes??""),nextAction:String(p.nextAction??""),
      dueAt:p.followUpAt,status:"OPEN" as const,actor:call.actor,
      updatedAt:typeof p.buyerFollowUpHistory==="object"&&Array.isArray(p.buyerFollowUpHistory)
        ? String((p.buyerFollowUpHistory.at(-1) as {at?:string})?.at??call.createdAt.toISOString()) : call.createdAt.toISOString(),
      updatedBy:typeof p.buyerFollowUpHistory==="object"&&Array.isArray(p.buyerFollowUpHistory)
        ? String((p.buyerFollowUpHistory.at(-1) as {actor?:string})?.actor??call.actor) : call.actor}];
  }).sort((a,b)=>Date.parse(a.dueAt)-Date.parse(b.dueAt))};
}
export async function callQueue(now = new Date()) {
  const rows = await db.select().from(leadsTable).where(sql`${leadsTable.stage} in ('CALL_READY','CONTACTED','CONVERSATION','OFFER_READY','OFFER_SENT','NEGOTIATING','CONTRACT_PENDING')`);
  const briefs = await Promise.all(rows.map(async row => {
    const detail = await leadDetail(row.id,db,now);
    const approved = detail.offers.find(o => ["AUTHORIZED","COMMUNICATED"].includes(o.effectiveStatus)) ?? null;
    if (!detail.analysis) return null;
    const contactBlocked = detail.analysis.blockers.some(blocker => blocker.toLowerCase().includes("seller contact"));
    if (contactBlocked) return null;
    if (detail.lead.stage === "CALL_READY" && detail.analysis.blockers.length > 0) return null;
    const brief = buildCallBrief(detail.lead,detail.intelligence,detail.analysis,approved,now);
    const savedCallRows = await db.select().from(callsTable).where(eq(callsTable.leadId, row.id)).orderBy(desc(callsTable.createdAt));
    const capture = (savedCallRows[0]?.payload as Record<string, unknown> | undefined)?.structuredFieldsJson;
    let unresolved: string[] = [];
    if (typeof capture === "string") {
      try { unresolved = unresolvedSellerConversationQuestions(JSON.parse(capture) as SellerConversationField[]); } catch { /* corrupt legacy capture remains visible in call history */ }
    }
    return { ...brief, questions: [...new Set([...brief.questions, ...unresolved])].slice(0, 12) };
  }));
  return prioritizeCallQueue(briefs.filter((b): b is NonNullable<typeof b> => b != null),now);
}
export async function listAudit(limit = 100) {
  return (await db.select().from(auditTable).orderBy(desc(auditTable.createdAt)).limit(limit)).map(e => ({...e,createdAt:iso(e.createdAt)}));
}
export async function dashboard(now = new Date()) {
  const [leads,queue,recentActivity,leadRows,discoveryRows,callRows] = await Promise.all([
    listLeads(),callQueue(now),listAudit(12),
    db.select().from(leadsTable),db.select().from(propertyDiscoveriesTable),db.select().from(callsTable),
  ]);
  const active = leads.filter(l => !["DEAD_DEAL","CLOSED"].includes(l.stage));
  const counts = new Map<string,number>();
  leads.forEach(l => counts.set(l.stage,(counts.get(l.stage) ?? 0)+1));
  const callsByLead = new Map<string,typeof callRows>();
  for (const call of callRows) callsByLead.set(call.leadId,[...(callsByLead.get(call.leadId) ?? []),call]);
  const currentlyCallableIds = new Set(queue
    .filter(brief => brief.lead.stage === "CALL_READY")
    .map(brief => brief.lead.id));
  const discoveryByLead = new Map(discoveryRows.filter(row => row.leadId).map(row => [row.leadId!,row]));
  const pipelineStages: AcquisitionPipelineStage[] = [];
  let excludedSyntheticCount = 0;
  for (const row of leadRows) {
    const sourceLabel = String(row.payload.source ?? "");
    if (row.payload.synthetic === true || /synthetic|fixture|exercise/i.test(sourceLabel)) {
      excludedSyntheticCount++;
      continue;
    }
    const history = (callsByLead.get(row.id) ?? []).sort((a,b) => b.createdAt.getTime()-a.createdAt.getTime());
    const latest = history[0]?.payload ?? {};
    const outcome = ["CONNECTED","NO_ANSWER","VOICEMAIL","BUSY","NOT_INTERESTED"].includes(String(latest.outcome))
      ? latest.outcome as "CONNECTED"|"NO_ANSWER"|"VOICEMAIL"|"BUSY"|"NOT_INTERESTED" : null;
    const answers = latest.sellerAnswers && typeof latest.sellerAnswers === "object"
      ? Object.entries(latest.sellerAnswers as Record<string,unknown>).filter(([,value]) => value !== null && value !== "" && value !== undefined)
      : [];
    const leadStage = row.stage;
    const discovery = discoveryByLead.get(row.id);
    const contactResearched = !!discovery?.payload.contactResearchCase ||
      (Array.isArray(row.payload.contactPaths) && row.payload.contactPaths.length > 0);
    const closed = leadStage === "CLOSED" ? "CLOSED" : ["DEAD_DEAL","PASS"].includes(leadStage) ? "LOST" : null;
    const analysis = row.analysis && typeof row.analysis === "object" && !Array.isArray(row.analysis)
      ? row.analysis as Record<string,unknown> : null;
    const calculatedAt = typeof analysis?.calculatedAt === "string" ? Date.parse(analysis.calculatedAt) : Number.NaN;
    const underwritingReady = !!row.analysisSnapshotId && !!analysis &&
      Array.isArray(analysis.blockers) && analysis.blockers.length === 0 &&
      Number.isFinite(calculatedAt) && calculatedAt <= now.getTime() &&
      now.getTime() - calculatedAt < 7 * 86_400_000;
    pipelineStages.push(deriveAcquisitionPipelineStage({
      discovered:true,normalized:true,qualifiedForResearch:true,contactRouteResearched:contactResearched,
      callReady:leadStage === "CALL_READY" && currentlyCallableIds.has(row.id),humanCallOutcome:outcome,
      nurtureFollowUpValid:!!row.followUpAt && row.followUpAt.getTime() > now.getTime(),
      sellerQualified:outcome === "CONNECTED" && answers.length >= 2,
      underwritingReady,
      offerReady:leadStage === "OFFER_READY" && underwritingReady,terminal:closed,
    }));
  }
  for (const row of discoveryRows.filter(item => !item.leadId)) {
    const payload = row.payload as Record<string,unknown>;
    const property = payload.property && typeof payload.property === "object" ? payload.property as Record<string,unknown> : {};
    if (payload.synthetic === true || /synthetic|fixture|exercise/i.test(String(property.provider ?? ""))) {
      excludedSyntheticCount++;
      continue;
    }
    const normalized = typeof property.address === "string" && typeof property.city === "string" &&
      typeof property.state === "string" && typeof property.zip === "string";
    const discoveryStatus = row.status;
    pipelineStages.push(deriveAcquisitionPipelineStage({
      discovered:true,normalized,
      qualifiedForResearch:["RELEVANT_CANDIDATE","QUALIFIED_LEAD","CALL_READY"].includes(discoveryStatus),
      contactRouteResearched:!!payload.contactResearchCase,
      callReady:discoveryStatus === "CALL_READY",humanCallOutcome:null,nurtureFollowUpValid:false,sellerQualified:false,
      underwritingReady:false,offerReady:false,
      terminal:discoveryStatus === "DISQUALIFIED" ? "LOST" : null,
    }));
  }
  const acquisitionStages = deriveAcquisitionPipelineCounts(pipelineStages).map(item => ({
    ...item,definition:ACQUISITION_STAGE_ENTRY_EVIDENCE[item.stage],
    exitEvidence:ACQUISITION_STAGE_EXIT_EVIDENCE[item.stage],
  }));
  return {
    total:leads.length,callReady:queue.length,
    needsResearch:active.filter(l => ["DISCOVERED","ENRICHING","ANALYZED"].includes(l.stage)).length,
    overdue:active.filter(l => l.followUpAt && Date.parse(l.followUpAt) < now.getTime()).length,
    strong:counts.get("STRONG") ?? 0,negotiable:counts.get("NEGOTIABLE") ?? 0,pass:counts.get("PASS") ?? 0,
    acquisitionStages,
    excludedSyntheticCount,
    stages:[...counts].map(([stage,count]) => ({stage,count})),recentActivity,
  };
}