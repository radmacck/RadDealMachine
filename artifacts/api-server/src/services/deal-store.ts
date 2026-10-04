import { eq, desc, sql } from "drizzle-orm";
import { queueJob } from "./operations-records";
import {
  db, leadsTable, intelligenceTable, analysesTable, callsTable, transitionsTable,
  auditTable, settingsTable, contractsTable, type LeadRow,
} from "@workspace/db";
import {
  analyzeDeal, allowedTransitions, buildCallBrief, prioritizeCallQueue, validateProvenance,
  validateTransition, validateAssumptions, assertTransitionPermission, DEFAULT_ASSUMPTIONS, DomainError,
  type Lead, type LeadInput, type LeadDetail, type Intelligence, type IntelligenceInput,
  type UnderwritingInput, type Assumptions, type TransitionInput, type CallInput, type Analysis, type Stage, type OfferActor,
  evidenceReviewedAnalysis,
} from "@workspace/deal-domain";
import { CreateLeadResponse, GetLeadResponse, AddIntelligenceResponse, GetAssumptionsResponse } from "@workspace/api-zod";
import { offersForLead, invalidateOffers, invalidateOffersForPolicyChange } from "./offer-records";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const jsonRecord = (value: object): Record<string, unknown> => ({ ...value });
const iso = (d: Date) => d.toISOString();
export function toLead(row: LeadRow): Lead {
  return CreateLeadResponse.parse({
    ...row.payload, id: row.id, stage: row.stage, version: row.version,
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
  return (await db.select().from(leadsTable).orderBy(desc(leadsTable.updatedAt))).map(toLead);
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
  const analysis = evidenceReviewedAnalysis(row.analysis as Analysis|null,lead,row.underwriting as UnderwritingInput|null,intelligence,now);
  const offers = await offersForLead(database,id,{
    lead,intelligence,analysis,analysisSnapshotId:row.analysisSnapshotId,
    currentPolicy:await getAssumptions(database),conversationLogged:calls.some(c => c.payload.outcome === "CONNECTED"),now,
  });
  return GetLeadResponse.parse({
    lead, intelligence, analysis, analysisSnapshotId:row.analysisSnapshotId, underwriting:row.underwriting, offers,
    transitions:transitions.map(e => ({...e, createdAt:iso(e.createdAt)})),
    calls:calls.map(e => ({...e.payload,id:e.id,actor:e.actor,createdAt:iso(e.createdAt)})),
    allowedTransitions:allowedTransitions(lead,analysis,now),
  });
}

export async function getAssumptions(database: typeof db | Tx = db): Promise<Assumptions> {
  const [row] = await database.select().from(settingsTable).where(eq(settingsTable.id,1));
  return GetAssumptionsResponse.parse(row?.assumptions ?? DEFAULT_ASSUMPTIONS);
}
export async function saveAssumptions(input: Assumptions, actor: string) {
  validateAssumptions(input);
  return db.transaction(async tx => {
    await tx.insert(settingsTable).values({ id:1, assumptions:jsonRecord(input) })
      .onConflictDoUpdate({target:settingsTable.id,set:{assumptions:jsonRecord(input),updatedAt:new Date()}});
    await invalidateOffersForPolicyChange(tx,actor,new Date());
    await audit(tx,actor,"ASSUMPTIONS_CHANGED","workspace","Updated assumptions. Existing snapshots remain immutable; live offers invalidated. Refresh underwriting and obtain new approval under the new policy.");
    return input;
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
    const {version:_,...payload} = input;
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
    const analysis = evidenceReviewedAnalysis(analyzeDeal(lead,input,assumptions,now),lead,input,intelligence,now)!;
    const [snapshot] = await tx.insert(analysesTable).values({
      leadId:id,createdBy:actor,createdAt:now,snapshot:jsonRecord({lead,input,analysis}),
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
      underwriting:jsonRecord(input),analysis:jsonRecord(analysis),analysisSnapshotId:snapshot.id,stage:row.stage,
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
    await tx.update(leadsTable).set({
      stage:row.stage,nextAction:row.nextAction,followUpAt,version:row.version+1,updatedAt:now,
      ...(input.to === "ENRICHING" ? {analysis:null,analysisSnapshotId:null} : {}),
    }).where(eq(leadsTable.id,id));
    return leadDetail(id,tx,now);
  });
}
export async function recordCall(id: string, input: CallInput, actor: string, now = new Date()): Promise<LeadDetail> {
  return db.transaction(async tx => {
    const row = await lockedLead(tx,id,input.version);
    const executed = ["UNDER_CONTRACT","BUYER_MATCHED","BUYER_INTERESTED","BUYER_COMMITTED","CLOSING"].includes(row.stage);
    if (!["CALL_READY","CONTACTED","CONVERSATION","OFFER_READY","OFFER_SENT","NEGOTIATING","CONTRACT_PENDING"].includes(row.stage)&&!executed) throw new DomainError("Calls can only be recorded for call-ready or active seller/closing conversations.");
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
    return detail.analysis ? buildCallBrief(detail.lead,detail.intelligence,detail.analysis,approved,now) : null;
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