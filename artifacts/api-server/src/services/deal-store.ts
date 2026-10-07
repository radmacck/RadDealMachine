import { eq, desc, sql } from "drizzle-orm";
import { queueJob } from "./operations-records";
import {
  db, leadsTable, intelligenceTable, analysesTable, callsTable, transitionsTable,
  auditTable, settingsTable, contractsTable, propertyDiscoveriesTable, type LeadRow,
} from "@workspace/db";
import {
  analyzeDeal, allowedTransitions, buildCallBrief, prioritizeCallQueue, validateProvenance,
  validateTransition, validateAssumptions, assertTransitionPermission, DEFAULT_ASSUMPTIONS, DomainError,
  type Lead, type LeadInput, type LeadDetail, type Intelligence, type IntelligenceInput,
  type UnderwritingInput, type Assumptions, type TransitionInput, type CallInput, type Analysis, type Stage, type OfferActor,
  evidenceReviewedAnalysis, buildDealWorkGuidance,
  repairMarketKey,
} from "@workspace/deal-domain";
import { CreateLeadResponse, GetLeadResponse, AddIntelligenceResponse, GetAssumptionsResponse } from "@workspace/api-zod";
import { offersForLead, invalidateOffers, invalidateOffersForPolicyChange } from "./offer-records";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const jsonRecord = (value: object): Record<string, unknown> => ({ ...value });
const iso = (d: Date) => d.toISOString();
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
export async function lockedLead(tx: Tx, id: string, version?: number) {
  const [row] = await tx.select().from(leadsTable).where(eq(leadsTable.id,id)).for("update");
  if (!row) throw new DomainError("Property lead not found.", 404);
  if (version != null && row.version !== version) throw new DomainError("This lead changed in another session. Reload before saving.", 409);
  if (row.stage === "DEAD_DEAL" || row.stage === "CLOSED") throw new DomainError("This lead is terminal and cannot be changed.", 409);
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
  await audit(tx, actor, "DEAL_TRANSITION", row.id, `${row.stage} → ${to}: ${reason}. Next: ${nextAction}`);
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
  const offers = await offersForLead(database,id,{
    lead,intelligence,analysis,analysisSnapshotId:row.analysisSnapshotId,
    currentPolicy:await getAssumptions(database),conversationLogged:calls.some(c => c.payload.outcome === "CONNECTED"),now,
  });
  const detail = {
    lead, intelligence, analysis, analysisSnapshotId:row.analysisSnapshotId, underwriting:row.underwriting as UnderwritingInput|null, offers,
    transitions:transitions.map(e => ({...e, createdAt:iso(e.createdAt)})),
    calls:calls.map(e => ({...e.payload as CallInput,id:e.id,actor:e.actor,createdAt:iso(e.createdAt)})),
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
    const [row] = await tx.insert(leadsTable).values({
      payload:jsonRecord(payload), nextAction:action, createdAt:now, updatedAt:now,
    }).returning();
    if (!row) throw new Error("Lead insert failed");
    await audit(tx,actor,"LEAD_CREATED",row.id,`${input.address}: ${action}`);
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
export async function recordCall(id: string, input: CallInput, actor: string, now = new Date()): Promise<LeadDetail> {
  return db.transaction(async tx => {
    const row = await lockedLead(tx,id,input.version);
    const executed = ["UNDER_CONTRACT","BUYER_MATCHED","BUYER_INTERESTED","BUYER_COMMITTED","CLOSING"].includes(row.stage);
    if (!["CALL_READY","CONTACTED","CONVERSATION","OFFER_READY","OFFER_SENT","NEGOTIATING","CONTRACT_PENDING"].includes(row.stage)&&!executed) throw new DomainError("Calls can only be recorded for call-ready or active seller/closing conversations.");
    if (row.stage === "CALL_READY") {
      const current = await leadDetail(id,tx,now);
      if (!current.analysis || current.analysis.blockers.length) {
        throw new DomainError("CALL READY evidence is stale or incomplete. Refresh the seller phone source and underwriting before recording outreach.",409);
      }
    }
    if (executed&&input.outcome==="NOT_INTERESTED") throw new DomainError("A phone response cannot cancel an executed contract. Record the conversation with a follow-up and use the owner-reviewed external cancellation evidence workflow.",409);
    const followUpAt = followupDate(input.followUpAt,now);
    if (input.outcome !== "NOT_INTERESTED" && !followUpAt) throw new DomainError("Set a future follow-up so the seller conversation does not become a dead end.");
    const stage: Stage = input.outcome === "NOT_INTERESTED" ? "DEAD_DEAL" : input.outcome === "CONNECTED" ? "CONVERSATION" : "CONTACTED";
    await tx.insert(callsTable).values({leadId:id,payload:jsonRecord(input),actor,createdAt:now});
    // A connected first call must preserve CONTACTED before CONVERSATION.
    if (row.stage === "CALL_READY" && stage === "CONVERSATION") {
      await move(tx,row,"CONTACTED","Seller answered the call","Continue the seller conversation.",actor,now);
    }
    // No-answer followups cannot regress an existing CONVERSATION.
    const nextStage: Stage = (executed || ["CONVERSATION","OFFER_READY","OFFER_SENT","NEGOTIATING","CONTRACT_PENDING"].includes(row.stage)) && stage !== "DEAD_DEAL" ? toLead(row).stage : stage;
    if (nextStage === "DEAD_DEAL") await invalidateOffers(tx,id,actor,"Seller is not interested; deal closed and offer authorization invalidated.",now);
    if (nextStage==="DEAD_DEAL") {
      const [draft] = await tx.select().from(contractsTable).where(eq(contractsTable.leadId,id)).for("update");
      if (draft?.payload.status==="DRAFT") await tx.update(contractsTable).set({
        payload:{...draft.payload,status:"CANCELLED",outcomeNote:"Unexecuted draft abandoned following the recorded seller decline. No executed agreement or legal obligation was cancelled."},
        version:draft.version+1,updatedAt:now,
      }).where(eq(contractsTable.id,draft.id));
    }
    await move(tx,row,nextStage,`Call outcome: ${input.outcome}. ${input.notes}`,input.nextAction,actor,now);
    await tx.update(leadsTable).set({stage:row.stage,nextAction:input.nextAction,followUpAt,version:row.version+1,updatedAt:now}).where(eq(leadsTable.id,id));
    await audit(tx,actor,"CALL_RECORDED",id,`${input.outcome}; follow-up ${followUpAt?.toISOString() ?? "none (terminal)"}; next: ${input.nextAction}`);
    if (input.outcome==="CONNECTED") await queueJob(tx,"PREPARE_BRIEF",id,`conversation-brief:${id}:${row.version+1}`,actor);
    return leadDetail(id,tx,now);
  });
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
    return buildCallBrief(detail.lead,detail.intelligence,detail.analysis,approved,now);
  }));
  return prioritizeCallQueue(briefs.filter((b): b is NonNullable<typeof b> => b != null),now);
}
export async function listAudit(limit = 100) {
  return (await db.select().from(auditTable).orderBy(desc(auditTable.createdAt)).limit(limit)).map(e => ({...e,createdAt:iso(e.createdAt)}));
}
export async function dashboard(now = new Date()) {
  const [leads,queue,recentActivity] = await Promise.all([listLeads(),callQueue(now),listAudit(12)]);
  const active = leads.filter(l => !["DEAD_DEAL","CLOSED"].includes(l.stage));
  const counts = new Map<string,number>();
  leads.forEach(l => counts.set(l.stage,(counts.get(l.stage) ?? 0)+1));
  return {
    total:leads.length,callReady:queue.length,
    needsResearch:active.filter(l => ["DISCOVERED","ENRICHING","ANALYZED"].includes(l.stage)).length,
    overdue:active.filter(l => l.followUpAt && Date.parse(l.followUpAt) < now.getTime()).length,
    strong:counts.get("STRONG") ?? 0,negotiable:counts.get("NEGOTIABLE") ?? 0,pass:counts.get("PASS") ?? 0,
    stages:[...counts].map(([stage,count]) => ({stage,count})),recentActivity,
  };
}