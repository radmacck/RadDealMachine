import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db, leadsTable, callsTable, contractsTable, outcomeObservationsTable,
  outcomeCalibrationReviewsTable, dealDecisionWorkItemsTable, jobsTable,
} from "@workspace/db";
import { RecordOutcomeActualsBody } from "@workspace/api-zod";
import type { IntelligenceLoopInput, LeadDetail, OfferActor } from "@workspace/deal-domain";
import {
  getOutcomeLearningReport, persistSyntheticCalibrationPreviewForExercise,
  reconcileCanonicalOutcomeObservations, recordOutcomeActuals, reviewOutcomeCalibration,
} from "./outcome-learning-store";
import { persistIntelligenceDecision } from "./intelligence-decision-store";

const now = new Date("2026-10-09T15:00:00.000Z");
const syntheticActor: OfferActor = { id: "synthetic-outcome-exercise", role: "OWNER" };
const exerciseMark = "SYNTHETIC TEST FIXTURE — not a real seller, buyer, deal, closing, estimate, or financial outcome.";

async function seedLead(stage = "ANALYZED") {
  const id = randomUUID();
  const analysisSnapshotId = randomUUID();
  const analysis = {
    arv: { expected: 210000, low: 195000, high: 225000 },
    repairEstimate: { total: { low: 18000, expected: 25000, high: 34000 } },
    calculatedAt: now.toISOString(),
    synthetic: true,
  };
  await db.insert(leadsTable).values({
    id, stage, version: 1, analysisSnapshotId, analysis,
    nextAction: `${exerciseMark} verify outcome evidence.`,
    payload: { address: `${id.slice(0, 8)} Synthetic Street`, city: "Synthetic City", county: "Synthetic County", state: "PA", zip: "19000", source: "isolated synthetic exercise", synthetic: true },
    createdAt: now, updatedAt: now,
  });
  return { id, analysisSnapshotId, analysis };
}

function decisionInput(id: string, stage: string): IntelligenceLoopInput {
  const detail = {
    lead: {
      id, stage, sellerName: "Synthetic seller", address: "Synthetic Street",
      city: "Synthetic City", county: "Synthetic County", state: "PA", zip: "19000",
      propertyType: "SINGLE_FAMILY", units: 1,
      nextAction: `${exerciseMark} verify evidence.`, version: 1, updatedAt: now.toISOString(),
      propertyQualification: { discoveryId: null, missingInformation: [], signals: [] },
    },
    intelligence: [], analysis: null, analysisSnapshotId: null,
    underwriting: null, offers: [], transitions: [], calls: [], workGuidance: null,
  } as unknown as LeadDetail;
  return {
    subjectType: "LEAD", subjectId: id, leadId: id, discoveryId: null,
    detail, acquisition: null, operations: null, synthetic: true, now,
  };
}

const seeded = await seedLead();
const occurredAt = new Date(now.getTime() - 60_000);
await db.insert(callsTable).values({
  leadId: seeded.id, actor: syntheticActor.id, createdAt: now,
  payload: {
    outcome: "CONNECTED", occurredAt: occurredAt.toISOString(), notes: exerciseMark,
    operatorConfidence: 0.8,
    sellerAnswers: {
      motivationStatement: "Synthetic seller reports relocation.",
      askingPrice: 185000,
      conditionByCategory: { roof: "Synthetic reported leak" },
    },
  },
});
const firstProjectionCount = await reconcileCanonicalOutcomeObservations(now);
const afterFirstProjection = await db.select().from(outcomeObservationsTable).where(eq(outcomeObservationsTable.leadId, seeded.id));
const secondProjectionCount = await reconcileCanonicalOutcomeObservations(now);
const afterReplay = await db.select().from(outcomeObservationsTable).where(eq(outcomeObservationsTable.leadId, seeded.id));
assert.equal(secondProjectionCount, 0, "source projection replay is idempotent");
assert.equal(afterReplay.length, afterFirstProjection.length);
assert.ok(firstProjectionCount >= 4, "call plus structured seller statements were projected");
const callEvent = afterReplay.find(row => row.eventType === "SELLER_CONNECTED");
assert.equal(callEvent?.occurredAt?.toISOString(), occurredAt.toISOString(), "occurred-at is distinct from recorded-at");
assert.equal(callEvent?.recordedAt.toISOString(), now.toISOString());
assert.equal(callEvent?.isSynthetic, true, "synthetic call is segregated");
assert.ok(afterReplay.some(row => row.eventType === "SELLER_PRICE_REPORTED" && row.verificationState === "SELLER_REPORTED_NOT_INDEPENDENTLY_VERIFIED"));

const actuals = RecordOutcomeActualsBody.parse({
  idempotencyKey: `synthetic-outcome-${seeded.id}`,
  analysisSnapshotId: seeded.analysisSnapshotId,
  occurredAt: occurredAt.toISOString(),
  source: "PAID_REPAIR_INVOICE",
  actualArv: 205000,
  actualRepairsByCategory: { roof: 14000, kitchen: 11000 },
  evidenceRefs: [`synthetic-document:${seeded.id}:invoice`, `synthetic-document:${seeded.id}:appraisal`],
  confidence: 0.9,
  causeCategories: ["HIDDEN_CONDITION", "DOCUMENTED_EXTERNAL_CAUSE"],
  note: exerciseMark,
});
const beforeLead = (await db.select().from(leadsTable).where(eq(leadsTable.id, seeded.id)))[0]!;
const [actualRow, concurrentReplay] = await Promise.all([
  recordOutcomeActuals(seeded.id, actuals, syntheticActor, now),
  recordOutcomeActuals(seeded.id, actuals, syntheticActor, now),
]);
assert.equal(actualRow.synthetic, true);
assert.equal(concurrentReplay.id, actualRow.id, "concurrent replay shares the same persisted outcome");
assert.equal((actualRow.predicted as { arvExpected: number }).arvExpected, 210000);
assert.equal((actualRow.actual as { repairsTotal: number }).repairsTotal, 25000);
assert.equal((actualRow.delta as { arv: number }).arv, -5000);
assert.equal((actualRow.delta as { repairs: number }).repairs, 0);
const replayedActual = await recordOutcomeActuals(seeded.id, actuals, syntheticActor, now);
assert.equal(replayedActual.id, actualRow.id, "replaying actuals does not duplicate the record");
const afterLead = (await db.select().from(leadsTable).where(eq(leadsTable.id, seeded.id)))[0]!;
assert.equal(afterLead.analysisSnapshotId, beforeLead.analysisSnapshotId);
assert.deepEqual(afterLead.analysis, beforeLead.analysis, "actual outcome cannot rewrite the original prediction");
assert.equal((await db.select().from(outcomeObservationsTable).where(and(
  eq(outcomeObservationsTable.leadId, seeded.id),
  eq(outcomeObservationsTable.eventType, "ACTUALS_REVIEW"),
))).length, 1);
const reevaluationJob = await db.select().from(jobsTable)
  .where(eq(jobsTable.idempotencyKey, `decision:${seeded.id}:outcome:${actualRow.id}`));
assert.equal(reevaluationJob.length, 1, "actual evidence queues canonical decision reevaluation exactly once");

await assert.rejects(
  () => recordOutcomeActuals(seeded.id, { ...actuals, idempotencyKey: `synthetic-stale-${seeded.id}`, analysisSnapshotId: randomUUID() }, syntheticActor, now),
  /snapshot is missing or changed/,
  "stale prediction snapshots cannot be used for comparison",
);
const beforeReport = await getOutcomeLearningReport(now);
assert.equal(beforeReport.realOutcomeCount, 0, "synthetic records never count as real outcomes");
assert.ok(beforeReport.syntheticOutcomeCount > 0);
assert.equal(beforeReport.calibrationStatus, "INSUFFICIENT_EVIDENCE");
assert.ok(beforeReport.recommendations.some(item => item.metricKey === "ARV" && item.status === "INSUFFICIENT_EVIDENCE"));
assert.ok(beforeReport.recommendations.some(item => item.metricKey === "REPAIRS" && item.status === "INSUFFICIENT_EVIDENCE"));
assert.equal(beforeReport.liveRulesChanged, false);
assert.ok(beforeReport.missingData.some(item => item.includes("ARV calibration needs")));

const testOnlyRecommendation = await persistSyntheticCalibrationPreviewForExercise(now);
assert.ok(testOnlyRecommendation);
assert.equal(testOnlyRecommendation?.isSynthetic, true);
assert.equal(testOnlyRecommendation?.status, "TEST_ONLY_NOT_DEPLOYABLE");
await assert.rejects(
  () => reviewOutcomeCalibration(testOnlyRecommendation!.id, "APPROVE_FOR_SEPARATE_CHANGE_REVIEW", "Synthetic preview must not be approved.", syntheticActor, now),
  /Test-only calibration previews cannot be reviewed/,
);
await assert.rejects(
  () => recordOutcomeActuals(seeded.id, { ...actuals, idempotencyKey: `synthetic-analyst-${seeded.id}` }, { id: "synthetic-analyst", role: "ANALYST" }, now),
  /cannot perform this operation/,
);
const reportAfterPreview = await getOutcomeLearningReport(now);
assert.ok(reportAfterPreview.recommendations.every(item => !item.synthetic), "synthetic threshold-path preview is excluded from live recommendations");
assert.equal(reportAfterPreview.liveRulesChanged, false, "threshold path never changes active rules");
assert.equal((await db.select().from(outcomeCalibrationReviewsTable).where(eq(outcomeCalibrationReviewsTable.isSynthetic, true))).length, 1);

const lifecycleLead = await seedLead("ANALYZED");
const firstDecision = await persistIntelligenceDecision(decisionInput(lifecycleLead.id, "ANALYZED"), "synthetic:outcome-open", now);
const beforeTerminal = await db.select().from(dealDecisionWorkItemsTable)
  .where(eq(dealDecisionWorkItemsTable.subjectId, lifecycleLead.id));
assert.ok(beforeTerminal.some(item => ["READY", "BLOCKED", "IN_PROGRESS", "FAILED"].includes(item.status)));
const signedAt = new Date(now.getTime() - 3 * 86_400_000);
const plannedCloseAt = new Date(now.getTime() - 86_400_000);
await db.insert(contractsTable).values({
  leadId: lifecycleLead.id,
  createdAt: signedAt,
  updatedAt: now,
  payload: {
    status: "CLOSED", acquisitionSignedAt: signedAt.toISOString(),
    closingAt: plannedCloseAt.toISOString(), closedAt: now.toISOString(),
    assignmentTarget: 18000, assignmentFeeReceived: 17500, closingCosts: 1200,
    netProceeds: 16300, outcomeRecordedAt: now.toISOString(),
    outcomeRecordedBy: syntheticActor.id, outcomeNote: exerciseMark,
    outcomeEvidenceUrl: `synthetic-document:${lifecycleLead.id}:closing`,
    exerciseMode: "SYNTHETIC_TEST_FIXTURE",
  },
});
await reconcileCanonicalOutcomeObservations(now);
const closedOutcome = (await db.select().from(outcomeObservationsTable).where(and(
  eq(outcomeObservationsTable.leadId, lifecycleLead.id),
  eq(outcomeObservationsTable.eventType, "DEAL_CLOSED"),
)))[0];
assert.ok(closedOutcome, "terminal close is retained as a typed synthetic outcome");
assert.equal((closedOutcome.delta as { timeToCloseDays: number }).timeToCloseDays, 1);
assert.equal(closedOutcome.isSynthetic, true);
await persistIntelligenceDecision(decisionInput(lifecycleLead.id, "CLOSED"), "synthetic:outcome-terminal", new Date(now.getTime() + 1000));
const afterTerminal = await db.select().from(dealDecisionWorkItemsTable)
  .where(eq(dealDecisionWorkItemsTable.subjectId, lifecycleLead.id));
assert.ok(afterTerminal.some(item => item.evaluationId !== firstDecision.evaluationId));
assert.ok(afterTerminal.filter(item => ["READY", "BLOCKED", "IN_PROGRESS", "FAILED"].includes(item.status)).length === 0,
  "terminal close cancels/supersedes obsolete runnable work");

console.log(JSON.stringify({
  slice: "P11 outcome-learning",
  environment: "isolated persisted schema; every record is explicitly synthetic",
  projectedSourceEvents: afterReplay.length,
  projectionReplayInserted: secondProjectionCount,
  occurredAtRecordedAtDistinct: callEvent?.occurredAt?.getTime() !== callEvent?.recordedAt.getTime(),
  actualsPredictionDelta: actualRow.delta,
  actualsReplayIdempotent: replayedActual.id === actualRow.id,
  staleSnapshotRejected: true,
  syntheticExcludedFromRealCounts: beforeReport.realOutcomeCount === 0,
  noLiveRuleChange: reportAfterPreview.liveRulesChanged === false,
  thresholdPath: testOnlyRecommendation?.status,
  canonicalReevaluationJobs: reevaluationJob.length,
  syntheticDealCloseTimeToCloseDeltaDays: (closedOutcome.delta as { timeToCloseDays: number }).timeToCloseDays,
  terminalOpenWorkItems: afterTerminal.filter(item => ["READY", "BLOCKED", "IN_PROGRESS", "FAILED"].includes(item.status)).length,
}, null, 2));
