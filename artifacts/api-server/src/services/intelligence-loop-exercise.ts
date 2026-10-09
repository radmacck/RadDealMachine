import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db, dealDecisionEvaluationsTable, dealDecisionWorkItemsTable, jobsTable, leadsTable,
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
    { id: randomUUID(), category: "occupancy", sourceType: "SELLER", classification: "INDICATED", statement: `${syntheticPrefix} conflicting seller statement.`, createdAt: now.toISOString(), reconciliation: { state: "CONFLICT_REVIEW" } },
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

const rows = await db.select().from(dealDecisionEvaluationsTable);
const work = await db.select().from(dealDecisionWorkItemsTable);
assert.equal(rows.length, 9, "A-H persist eight scenarios, with C retaining both before/after snapshots");
assert.ok(work.length >= 9, "each decision scenario persists idempotent action/outcome work");
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
  },
  scenarioEvaluations: rows.length,
  workerEvaluations: workerEvaluations.length,
  workerState: workerJob.state,
  workItems: work.length,
  syntheticLabels: rows.every(row => row.payload.synthetic === true) && work.every(item => item.payload.synthetic === true),
  pass: true,
}));
