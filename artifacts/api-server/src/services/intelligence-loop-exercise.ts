import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db, dealDecisionEvaluationsTable, dealDecisionWorkItemsTable, jobsTable, leadsTable, propertyDiscoveriesTable,
} from "@workspace/db";
import type { AcquisitionQueueItem, IntelligenceLoopInput, LeadDetail } from "@workspace/deal-domain";
import { persistIntelligenceDecision } from "./intelligence-decision-store";
import { queueJob } from "./operations-records";
import { runWorkerOnce } from "./workers";

const now = new Date("2026-10-08T15:00:00.000Z");
const syntheticPrefix = "SYNTHETIC INTELLIGENCE LOOP EXERCISE — not a real property, seller, offer, buyer, or transaction.";

async function seedLead(stage = "ANALYZED") {
  const id = randomUUID();
  const [row] = await db.insert(leadsTable).values({
    id,
    stage,
    version: 1,
    nextAction: `${syntheticPrefix} review persisted decision evidence.`,
    payload: {
      address: `${id.slice(0, 8)} Synthetic Avenue`,
      city: "Synthetic City",
      county: "Synthetic County",
      state: "PA",
      zip: "19000",
      propertyType: "SINGLE_FAMILY",
      sqft: 1200,
      beds: 3,
      baths: 2,
      units: 1,
      sellerName: "Synthetic seller",
      source: "SYNTHETIC isolated exercise",
      synthetic: true,
    },
    createdAt: now,
    updatedAt: now,
  }).returning();
  if (!row) throw new Error("Could not create isolated synthetic lead.");
  return row.id;
}

function makeDetail(id: string, options: {
  stage?: string;
  analysis?: Record<string, unknown> | null;
  intelligence?: Array<Record<string, unknown>>;
  calls?: Array<Record<string, unknown>>;
} = {}) {
  return ({
    lead: {
      id,
      stage: options.stage ?? "ANALYZED",
      sellerName: "Synthetic seller",
      address: "Synthetic Avenue",
      city: "Synthetic City",
      county: "Synthetic County",
      state: "PA",
      zip: "19000",
      propertyType: "SINGLE_FAMILY",
      units: 1,
      nextAction: `${syntheticPrefix} review current evidence.`,
      version: 1,
      updatedAt: now.toISOString(),
      propertyQualification: { discoveryId: null, missingInformation: [], signals: [] },
    },
    intelligence: options.intelligence ?? [],
    analysis: options.analysis === undefined ? null : options.analysis,
    analysisSnapshotId: options.analysis ? randomUUID() : null,
    underwriting: null,
    offers: [],
    transitions: [],
    calls: options.calls ?? [],
    workGuidance: null,
  }) as unknown as LeadDetail;
}

function makeAcquisition(id: string, options: {
  decision?: string;
  blockerCode?: string | null;
  blocker?: string | null;
  directRouteStatus?: string;
} = {}) {
  return ({
    lead: { id },
    decision: options.decision ?? "BLOCKED",
    rank: 1,
    evidenceScore: 0,
    rankingReason: `${syntheticPrefix} decision test only.`,
    propertySignals: [],
    contactReadiness: {
      directRouteStatus: options.directRouteStatus ?? "NO_DIRECT_ROUTE",
      contactPaths: [],
      selectedPhonePath: null,
      selectedEmailPath: null,
    },
    blockerCode: options.blockerCode === undefined ? "CONTACT_NO_DIRECT_ROUTE" : options.blockerCode,
    blocker: options.blocker === undefined ? `${syntheticPrefix} no direct route.` : options.blocker,
    nextAction: "Resolve the synthetic test blocker.",
    callBrief: null,
  }) as unknown as AcquisitionQueueItem;
}

function inputFor(
  id: string,
  detail: LeadDetail,
  acquisition: AcquisitionQueueItem | null,
  overrides: Partial<Extract<IntelligenceLoopInput, { subjectType: "LEAD" }>> = {},
): IntelligenceLoopInput {
  return {
    subjectType: "LEAD",
    subjectId: id,
    leadId: id,
    discoveryId: null,
    detail,
    acquisition,
    operations: null,
    synthetic: true,
    now,
    ...overrides,
  };
}

async function evaluate(input: IntelligenceLoopInput, label: string, expectedCode: string | null) {
  const result = await persistIntelligenceDecision(input, `synthetic:${label}`, now);
  assert.equal(result.recommendedAction?.code ?? null, expectedCode, `${label}: recommended action`);
  const [evaluation] = await db.select().from(dealDecisionEvaluationsTable).where(and(
    eq(dealDecisionEvaluationsTable.subjectType, "LEAD"),
    eq(dealDecisionEvaluationsTable.subjectId, input.subjectId),
    eq(dealDecisionEvaluationsTable.snapshotHash, result.snapshotHash),
  ));
  assert.ok(evaluation, `${label}: evaluation was persisted`);
  assert.equal(evaluation.payload.synthetic, true, `${label}: persisted evaluation is labelled synthetic`);
  const items = await db.select().from(dealDecisionWorkItemsTable)
    .where(eq(dealDecisionWorkItemsTable.subjectId, input.subjectId));
  assert.ok(items.every(item => item.payload.synthetic === true), `${label}: all persisted work is labelled synthetic`);
  return { result, evaluation, items };
}

const noRoute = (id: string) => makeAcquisition(id);
const callable = (id: string) => makeAcquisition(id, {
  decision: "CALL_NEXT",
  blockerCode: null,
  blocker: null,
  directRouteStatus: "CALL_READY",
});
const currentAnalysis = { classification: "STRONG", calculatedAt: now.toISOString(), blockers: [], mao: 100000 };

const aId = await seedLead();
const a = await evaluate(inputFor(aId, makeDetail(aId), noRoute(aId)), "A-no-contact", "RESEARCH_CONTACT");
assert.ok(a.result.blockedActions.some(item => item.code === "CALL_NEXT" && item.status === "BLOCKED"));
const beforeRetry = await db.select().from(dealDecisionEvaluationsTable)
  .where(eq(dealDecisionEvaluationsTable.subjectId, aId));
await persistIntelligenceDecision(inputFor(aId, makeDetail(aId), noRoute(aId)), "synthetic:A-idempotent-retry", now);
const afterRetry = await db.select().from(dealDecisionEvaluationsTable)
  .where(eq(dealDecisionEvaluationsTable.subjectId, aId));
assert.equal(afterRetry.length, beforeRetry.length, "same synthetic evidence snapshot is idempotent");

const discoveryId = randomUUID();
await db.insert(propertyDiscoveriesTable).values({
  id: discoveryId, identityKey: `synthetic-discovery:${discoveryId}`, ownerKey: null,
  marketKey: "SYNTHETIC_TEST", status: "DISCOVERED_PROPERTY", score: 60, confidence: 0.9,
  version: 1, leadId: null,
  payload: { synthetic: true, property: { address: "SYNTHETIC CONTACT TASK ONLY" } },
  createdAt: now, updatedAt: now,
});
const discoveryInput: Extract<IntelligenceLoopInput, { subjectType: "DISCOVERY" }> = {
  subjectType: "DISCOVERY", subjectId: discoveryId, discoveryId, leadId: null, synthetic: true, now,
  discovery: {
    id: discoveryId, status: "DISCOVERED_PROPERTY", leadId: null, address: "SYNTHETIC CONTACT TASK ONLY",
    reason: `${syntheticPrefix} no seller route exists.`,
    nextAction: "Research permitted contactability.", observedAt: now.toISOString(),
    missingInformation: [], signalRefs: [`synthetic-source:${discoveryId}`], contactRouteEstablished: false,
  },
};
const noRouteDecision = await persistIntelligenceDecision(discoveryInput, "synthetic:discovery-no-route", now);
assert.equal(noRouteDecision.recommendedAction?.code, "RESEARCH_CONTACT");
assert.ok(noRouteDecision.eligibleActions.some(item => item.code === "QUALIFY_DISCOVERY"),
  "Raw source discoveries retain a separate relevance review while contact research is actionable.");
assert.equal(noRouteDecision.blockedActions.find(item => item.code === "CALL_NEXT")?.eligible, false);
const [contactTask] = await db.select().from(dealDecisionWorkItemsTable)
  .where(and(eq(dealDecisionWorkItemsTable.discoveryId, discoveryId), eq(dealDecisionWorkItemsTable.actionCode, "RESEARCH_CONTACT")));
assert.ok(contactTask, "A persisted actionable contact research task must be created for a route-less candidate.");
assert.equal(contactTask.status, "READY");
assert.equal(contactTask.payload.synthetic, true);
const routeResolvedDecision = await persistIntelligenceDecision({
  ...discoveryInput,
  discovery: { ...discoveryInput.discovery, contactRouteEstablished: true },
}, "synthetic:discovery-route-resolved", now);
assert.ok(!routeResolvedDecision.eligibleActions.some(item => item.code === "RESEARCH_CONTACT"));
const [expiredContactTask] = await db.select().from(dealDecisionWorkItemsTable)
  .where(eq(dealDecisionWorkItemsTable.id, contactTask.id));
assert.equal(expiredContactTask?.status, "EXPIRED", "A later fully gated route resolves the old research task without making the discovery call-ready.");
assert.equal((await db.select().from(leadsTable)).length, 1,
  "Discovery-to-contact research must not create a lead or falsely promote the source record.");

const bId = await seedLead();
await evaluate(inputFor(bId, makeDetail(bId, { analysis: currentAnalysis }), callable(bId)), "B-callable", "CALL_NEXT");

const cId = await seedLead();
const cBaseline = await evaluate(inputFor(cId, makeDetail(cId, { analysis: currentAnalysis }), callable(cId)), "C-before-seller-change", "CALL_NEXT");
const cEvidenceId = randomUUID();
const cAfterCall = makeDetail(cId, {
  intelligence: [{
    id: cEvidenceId,
    category: "condition_roof",
    sourceType: "SELLER",
    classification: "INDICATED",
    statement: `${syntheticPrefix} seller reports roof leak; independently unverified.`,
    source: "Synthetic seller interview",
    sourceRecordId: "synthetic:roof-interview",
    capturedAt: now.toISOString(),
    createdAt: new Date(now.getTime() + 1_000).toISOString(),
    confidence: 0.8,
  }],
  calls: [{ id: randomUUID(), outcome: "CONNECTED", createdAt: new Date(now.getTime() + 1_000).toISOString(), notes: syntheticPrefix }],
});
const cUpdated = await evaluate(inputFor(cId, cAfterCall, makeAcquisition(cId, {
  decision: "BLOCKED", blockerCode: "UNDERWRITING_STALE",
  blocker: `${syntheticPrefix} prior analysis is stale after seller-reported condition evidence.`,
  directRouteStatus: "CALL_READY",
})), "C-condition-changed", "GATHER_REPAIR_EVIDENCE");
assert.ok(cUpdated.result.known.some(item => item.epistemicStatus === "INDICATED"));
const cCallWork = cUpdated.items.find(item => item.gapKey.endsWith(":call-next"));
assert.equal(cCallWork?.status, "COMPLETED", "call work is completed only after a synthetic call evidence event is recorded");
assert.ok(cBaseline.evaluation.id !== cUpdated.evaluation.id, "material seller evidence creates a new persisted evaluation snapshot");

const dId = await seedLead();
const d = await evaluate(inputFor(dId, makeDetail(dId, {
  intelligence: [{
    id: randomUUID(),
    category: "asking_price",
    sourceType: "SELLER",
    classification: "INDICATED",
    statement: `${syntheticPrefix} seller stated a different asking price.`,
    source: "Synthetic seller interview",
    sourceRecordId: "synthetic:price-interview",
    capturedAt: now.toISOString(),
    createdAt: new Date(now.getTime() + 1_000).toISOString(),
    confidence: 0.8,
  }],
}), makeAcquisition(dId, { blockerCode: "UNDERWRITING_STALE", directRouteStatus: "CALL_READY" })),
"D-price-change", "RECALCULATE_UNDERWRITING");
assert.ok(d.result.recommendedAction?.requiresHumanAuthorization === false,
  "a recalculation recommendation does not authorize a changed offer");

const eId = await seedLead();
const e = await evaluate(inputFor(eId, makeDetail(eId, {
  intelligence: [
    { id: randomUUID(), category: "occupancy", sourceType: "SELLER", classification: "INDICATED",
      statement: `${syntheticPrefix} conflicting seller statement.`, source: "Synthetic seller interview",
      sourceRecordId: "synthetic:conflict-interview", confidence: 0.8, capturedAt: now.toISOString(),
      createdAt: now.toISOString(), reconciliation: { state: "CONFLICT_REVIEW" } },
  ],
}), makeAcquisition(eId, { blockerCode: "EVIDENCE_CONFLICT", directRouteStatus: "CALL_READY" })),
"E-conflicting-evidence", "RECONCILE_EVIDENCE");

const fId = await seedLead();
const f = await evaluate(inputFor(fId, makeDetail(fId), null, {
  operations: { contract: { id: randomUUID(), status: "UNDER_CONTRACT", committedBuyerId: null }, matches: [], nextAction: "Review buyer demand." },
}), "F-contract-no-current-buyer", "BUYER_DEMAND");

const gId = await seedLead();
await evaluate(inputFor(gId, makeDetail(gId), null, {
  operations: { contract: { id: randomUUID(), status: "UNDER_CONTRACT", committedBuyerId: randomUUID() }, matches: [{ buyerId: randomUUID(), eligible: true }], nextAction: "Continue transaction." },
}), "G-valid-commitment-next-transaction", "TRANSACTION_NEXT");

const hId = await seedLead("CLOSED");
const h = await evaluate(inputFor(hId, makeDetail(hId, { stage: "CLOSED" }), null), "H-terminal-outcome", null);
assert.ok(h.result.outcomeRecord?.includes("CLOSED"));
assert.ok(h.items.some(item => item.status === "COMPLETED"), "terminal outcome is preserved as completed persisted work");
assert.ok(h.items.every(item => !["READY", "IN_PROGRESS"].includes(item.status)), "terminal deal has no stale actionable work");

const iId = await seedLead();
const expiredAt = new Date(now.getTime() - 30 * 86_400_000).toISOString();
const i = await evaluate(inputFor(iId, makeDetail(iId, {
  intelligence: [{
    id: randomUUID(), category: "occupancy", sourceType: "SELLER", classification: "INDICATED",
    statement: `${syntheticPrefix} seller claim is expired.`,
    source: "Synthetic seller interview", sourceRecordId: "synthetic:old-interview", confidence: 0.8,
    capturedAt: expiredAt, createdAt: expiredAt,
  }],
}), callable(iId)), "I-expired-seller-evidence", "REFRESH_SOURCE_EVIDENCE");
assert.ok(i.result.staleEvidence.some(item => item.freshness === "STALE"), "expired seller evidence is visible in the persisted decision");
assert.ok(i.items.some(item => item.gapKey.includes("stale-evidence")), "re-verification is persisted as actionable work");

const jId = await seedLead();
const j = await evaluate(inputFor(jId, makeDetail(jId, {
  intelligence: [
    { id: randomUUID(), category: "occupancy", sourceType: "PUBLIC_RECORD", classification: "OBSERVED",
      statement: `${syntheticPrefix} public record reports occupied.`, source: "Synthetic public record",
      sourceRecordId: "synthetic:public-record", confidence: 0.9, capturedAt: now.toISOString(), createdAt: now.toISOString() },
    { id: randomUUID(), category: "occupancy", sourceType: "SELLER", classification: "INDICATED",
      statement: `${syntheticPrefix} seller reports vacant.`, source: "Synthetic seller interview",
      sourceRecordId: "synthetic:seller-interview", confidence: 0.8, capturedAt: now.toISOString(), createdAt: now.toISOString() },
  ],
}), callable(jId)), "J-conflicting-seller-and-public", "RECONCILE_EVIDENCE");
assert.equal(j.result.conflicts.length, 2, "both contradictory source records remain in the persisted decision");
assert.ok(j.items.some(item => item.gapKey.endsWith(":evidence-conflict")), "reviewer reconciliation is persisted as actionable work");

const kId = await seedLead();
const kPriorAt = new Date(now.getTime() - 31 * 86_400_000).toISOString();
const k = await evaluate(inputFor(kId, makeDetail(kId, {
  intelligence: [
    { id: randomUUID(), category: "occupancy", sourceType: "SELLER", classification: "INDICATED",
      statement: `${syntheticPrefix} seller says vacant.`, source: "Synthetic prior interview",
      sourceRecordId: "synthetic:prior-interview", confidence: 0.8, capturedAt: kPriorAt, createdAt: kPriorAt },
    { id: randomUUID(), category: "occupancy", sourceType: "SELLER", classification: "INDICATED",
      statement: `${syntheticPrefix} seller says vacant.`, source: "Synthetic current interview",
      sourceRecordId: "synthetic:current-interview", confidence: 0.9, capturedAt: now.toISOString(), createdAt: now.toISOString() },
  ],
}), callable(kId)), "K-reverified-seller-evidence", "CALL_NEXT");
assert.equal(k.result.staleEvidence.length, 0, "newer same-valued seller evidence clears the stale block");
assert.ok(k.result.known.some(item => item.summary.includes("historical evidence retained")),
  "re-verification retains the prior record as historical evidence");

const rows = await db.select().from(dealDecisionEvaluationsTable);
const work = await db.select().from(dealDecisionWorkItemsTable);
assert.equal(rows.length, 14, "A-K persist eleven lead scenarios plus two route-task lifecycle snapshots");
assert.ok(work.length >= 12, "each decision scenario persists idempotent action/outcome work");
const workerLeadId = await seedLead();
const workerKey = `synthetic:decision-worker:${workerLeadId}`;
await queueJob(db, "EVALUATE_DECISION", workerLeadId, workerKey, "synthetic:worker-test", {
  synthetic: true,
  reason: `${syntheticPrefix} exercise the real queued decision worker.`,
});
await runWorkerOnce(now, false);
const [workerJob] = await db.select().from(jobsTable).where(eq(jobsTable.idempotencyKey, workerKey));
if (workerJob?.state !== "SUCCEEDED") console.error(JSON.stringify({
  exercise: "SYNTHETIC GAP-AWARE INTELLIGENCE LOOP",
  workerState: workerJob?.state,
  workerError: workerJob?.message,
}));
assert.equal(workerJob?.state, "SUCCEEDED", "the queued decision worker completes without external actions");
const workerEvaluations = await db.select().from(dealDecisionEvaluationsTable)
  .where(eq(dealDecisionEvaluationsTable.leadId, workerLeadId));
assert.ok(workerEvaluations.length, "worker evaluation is persisted for the linked synthetic lead");
assert.equal(workerEvaluations[0]?.payload.synthetic, true,
  "a persisted fixture marked synthetic remains labelled synthetic when evaluated by the real worker");
console.log(JSON.stringify({
  exercise: "SYNTHETIC GAP-AWARE INTELLIGENCE LOOP",
  scenarios: {
    A: a.result.recommendedAction?.code,
    B: "CALL_NEXT",
    C: cUpdated.result.recommendedAction?.code,
    D: d.result.recommendedAction?.code,
    E: e.result.recommendedAction?.code,
    F: f.result.recommendedAction?.code,
    G: "TRANSACTION_NEXT",
    H: h.result.outcomeRecord,
    I: i.result.recommendedAction?.code,
    J: j.result.recommendedAction?.code,
    K: k.result.recommendedAction?.code,
  },
  scenarioEvaluations: rows.length,
  workerEvaluations: workerEvaluations.length,
  workerState: workerJob.state,
  workItems: work.length,
  syntheticLabels: rows.every(row => row.payload.synthetic === true) && work.every(item => item.payload.synthetic === true),
  pass: true,
}));
