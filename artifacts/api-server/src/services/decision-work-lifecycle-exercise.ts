import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  auditTable,
  db,
  dealDecisionWorkEventsTable,
  dealDecisionWorkItemsTable,
  leadsTable,
} from "@workspace/db";
import { createLead } from "./deal-store";
import { evaluateLeadDecision } from "./intelligence-decision-store";
import {
  claimDecisionWorkItem,
  completeDecisionWorkItem,
  decisionWorkRetryDelayMs,
  expireDecisionWorkItem,
  failDecisionWorkItem,
  maintainDecisionWorkLifecycle,
  runDecisionWorkOnce,
} from "./decision-work-lifecycle";
import { canTransitionDecisionWork } from "./decision-work-state";

const startedAt = new Date("2026-10-08T17:00:00.000Z");
const syntheticLabel = "SYNTHETIC isolated decision-work lifecycle exercise; not a real property, seller, buyer, offer, or external action.";
let sequence = 0;
const nowAt = (offsetMs = 0) => new Date(startedAt.getTime() + offsetMs + ++sequence);
const operator = "synthetic:decision-work-exercise";

assert.equal(canTransitionDecisionWork("READY", "IN_PROGRESS"), true);
assert.equal(canTransitionDecisionWork("IN_PROGRESS", "FAILED"), true);
assert.equal(canTransitionDecisionWork("COMPLETED", "READY"), false);
assert.equal(canTransitionDecisionWork("EXPIRED", "IN_PROGRESS"), false);

async function seed(label: string) {
  const lead = await createLead({
    address: `SYNTHETIC ${label.toUpperCase()} ADDRESS`,
    city: "Synthetic City",
    county: "Synthetic County",
    state: "PA",
    zip: "19000",
    propertyType: "SINGLE_FAMILY",
    sqft: 1200,
    beds: 3,
    baths: 1,
    units: 1,
    sellerName: `SYNTHETIC ${label}; no real owner`,
    source: "SYNTHETIC decision-work lifecycle exercise",
    nextAction: `${syntheticLabel} review persisted work state.`,
  }, operator, nowAt());
  const [createdLead] = await db.select({ payload: leadsTable.payload }).from(leadsTable)
    .where(eq(leadsTable.id, lead.id));
  await db.update(leadsTable).set({
    payload: { ...(createdLead?.payload ?? {}), synthetic: true, syntheticExercise: syntheticLabel },
  }).where(eq(leadsTable.id, lead.id));
  const decision = await evaluateLeadDecision(lead.id, operator, nowAt());
  const workItemId = decision.recommendedAction?.workItemId;
  assert.ok(workItemId, `${label}: evaluator produced a persisted next action`);
  const [workItem] = await db.select().from(dealDecisionWorkItemsTable)
    .where(eq(dealDecisionWorkItemsTable.id, workItemId));
  assert.ok(workItem, `${label}: work item persisted`);
  assert.equal(workItem.status, "READY");
  assert.equal(workItem.payload.synthetic, true,
    "the persisted source lead explicitly labels the isolated fixture synthetic");
  return { leadId: lead.id, workItem };
}

function autoCodes(item: { actionCode: string }) {
  return [item.actionCode];
}

// Two concurrent workers compete for one persisted item; only one receives a lease.
const concurrent = await seed("concurrent claim");
const parallelClaims = await Promise.all([
  claimDecisionWorkItem(concurrent.workItem.id, "synthetic:worker-A", autoCodes(concurrent.workItem), nowAt()),
  claimDecisionWorkItem(concurrent.workItem.id, "synthetic:worker-B", autoCodes(concurrent.workItem), nowAt()),
]);
const winningClaims = parallelClaims.filter((claim): claim is NonNullable<typeof claim> => claim !== null);
assert.equal(winningClaims.length, 1, "FOR UPDATE SKIP LOCKED permits exactly one concurrent claim");
const winningClaim = winningClaims[0]!;
assert.equal(winningClaim.workItem.status, "IN_PROGRESS");
assert.equal(winningClaim.workItem.attempts, 1);

// Completion is evidence/version checked and idempotent under a stable command key.
const eventCountBeforeComplete = await db.select().from(dealDecisionWorkEventsTable)
  .where(and(eq(dealDecisionWorkEventsTable.workItemId, concurrent.workItem.id),
    eq(dealDecisionWorkEventsTable.eventType, "COMPLETED")));
const completion = await completeDecisionWorkItem(
  concurrent.workItem.id,
  winningClaim.leaseToken,
  "synthetic:complete:concurrent",
  "synthetic:worker-A",
  { reason: `${syntheticLabel} executor completed a non-external test action.`, metadata: { synthetic: true } },
  nowAt(),
);
assert.equal(completion.item.status, "COMPLETED");
const replay = await completeDecisionWorkItem(
  concurrent.workItem.id,
  winningClaim.leaseToken,
  "synthetic:complete:concurrent",
  "synthetic:worker-A",
  { reason: "idempotent replay", metadata: { synthetic: true } },
  nowAt(),
);
assert.equal(replay.idempotentReplay, true);
const eventCountAfterComplete = await db.select().from(dealDecisionWorkEventsTable)
  .where(and(eq(dealDecisionWorkEventsTable.workItemId, concurrent.workItem.id),
    eq(dealDecisionWorkEventsTable.eventType, "COMPLETED")));
assert.equal(eventCountBeforeComplete.length, 0);
assert.equal(eventCountAfterComplete.length, 1, "completion replay creates no duplicate transition or side effect");

// Retryable failure is bounded, scheduled with backoff, and can succeed on retry.
const retry = await seed("retry success");
const retryClaim1 = await claimDecisionWorkItem(retry.workItem.id, "synthetic:retry-worker", autoCodes(retry.workItem), nowAt());
assert.ok(retryClaim1);
const failureAt = nowAt();
const failedRetry = await failDecisionWorkItem(retry.workItem.id, retryClaim1.leaseToken,
  "synthetic:retry-worker", { reason: `${syntheticLabel} transient adapter timeout.`, retryable: true, failureCode: "SYNTHETIC_TIMEOUT" }, failureAt);
assert.equal(failedRetry.status, "FAILED");
assert.equal(failedRetry.retryable, true);
assert.equal(failedRetry.attempts, 1);
assert.equal(failedRetry.nextAttemptAt?.getTime(), failureAt.getTime() + decisionWorkRetryDelayMs(1));
const retryReady = await maintainDecisionWorkLifecycle(new Date(failedRetry.nextAttemptAt!.getTime() + 1));
assert.equal(retryReady.retriesReleased, 1);
const retryClaim2 = await claimDecisionWorkItem(retry.workItem.id, "synthetic:retry-worker", autoCodes(retry.workItem),
  new Date(failedRetry.nextAttemptAt!.getTime() + 2));
assert.ok(retryClaim2);
assert.equal(retryClaim2.workItem.attempts, 2);
const retryCompleted = await completeDecisionWorkItem(
  retry.workItem.id,
  retryClaim2.leaseToken,
  "synthetic:retry-success",
  "synthetic:retry-worker",
  { reason: `${syntheticLabel} the second attempt completed.`, metadata: { synthetic: true } },
  new Date(failedRetry.nextAttemptAt!.getTime() + 3),
);
assert.equal(retryCompleted.item.status, "COMPLETED");

// Retries stop after the persisted maximum; terminal failures have no timer.
const bounded = await seed("bounded retry budget");
let boundedTime = nowAt();
for (let attempt = 1; attempt <= bounded.workItem.maxAttempts; attempt++) {
  const claim = await claimDecisionWorkItem(bounded.workItem.id, "synthetic:bounded-worker",
    autoCodes(bounded.workItem), boundedTime);
  assert.ok(claim, `bounded retry attempt ${attempt} claimed`);
  const failedAt = new Date(boundedTime.getTime() + 1);
  const failed = await failDecisionWorkItem(bounded.workItem.id, claim.leaseToken, "synthetic:bounded-worker", {
    reason: `${syntheticLabel} controlled failure ${attempt}.`,
    retryable: true,
    failureCode: "SYNTHETIC_RETRY",
  }, failedAt);
  assert.equal(failed.status, "FAILED");
  if (attempt < bounded.workItem.maxAttempts) {
    assert.equal(failed.retryable, true);
    assert.ok(failed.nextAttemptAt);
    await maintainDecisionWorkLifecycle(new Date(failed.nextAttemptAt!.getTime() + 1));
    boundedTime = new Date(failed.nextAttemptAt!.getTime() + 2);
  } else {
    assert.equal(failed.retryable, false);
    assert.equal(failed.nextAttemptAt, null);
    boundedTime = new Date(failedAt.getTime() + 24 * 60 * 60 * 1000);
  }
}
await maintainDecisionWorkLifecycle(boundedTime);
const [boundedFinal] = await db.select().from(dealDecisionWorkItemsTable)
  .where(eq(dealDecisionWorkItemsTable.id, bounded.workItem.id));
assert.equal(boundedFinal?.status, "FAILED");
assert.equal(boundedFinal?.attempts, bounded.workItem.maxAttempts);
assert.equal(boundedFinal?.retryable, false);

// Evidence version changes while the lease is active block stale completion.
const stale = await seed("stale during execution");
const staleClaim = await claimDecisionWorkItem(stale.workItem.id, "synthetic:stale-worker",
  autoCodes(stale.workItem), nowAt());
assert.ok(staleClaim);
const [staleLead] = await db.select().from(leadsTable).where(eq(leadsTable.id, stale.leadId));
assert.ok(staleLead);
await db.update(leadsTable).set({
  version: staleLead.version + 1,
  updatedAt: nowAt(),
  nextAction: `${syntheticLabel} material evidence version changed while work was running.`,
}).where(eq(leadsTable.id, stale.leadId));
const staleCompletion = await completeDecisionWorkItem(
  stale.workItem.id,
  staleClaim.leaseToken,
  "synthetic:stale-complete",
  "synthetic:stale-worker",
  { reason: "must not complete stale work", metadata: { synthetic: true } },
  nowAt(),
);
assert.equal(staleCompletion.stale, true);
assert.equal(staleCompletion.item.status, "BLOCKED");
const staleCompletions = await db.select().from(dealDecisionWorkEventsTable).where(and(
  eq(dealDecisionWorkEventsTable.workItemId, stale.workItem.id),
  eq(dealDecisionWorkEventsTable.eventType, "COMPLETED"),
));
assert.equal(staleCompletions.length, 0, "stale execution did not produce a completion event");

// A material evidence change also cancels a retry that was waiting for backoff.
const staleRetry = await seed("stale retry invalidation");
const staleRetryClaim = await claimDecisionWorkItem(staleRetry.workItem.id, "synthetic:stale-retry-worker",
  autoCodes(staleRetry.workItem), nowAt());
assert.ok(staleRetryClaim);
const staleRetryFailedAt = nowAt();
const staleRetryFailure = await failDecisionWorkItem(
  staleRetry.workItem.id,
  staleRetryClaim.leaseToken,
  "synthetic:stale-retry-worker",
  { reason: `${syntheticLabel} retry is waiting when new evidence arrives.`, retryable: true },
  staleRetryFailedAt,
);
assert.equal(staleRetryFailure.retryable, true);
const [staleRetryLead] = await db.select().from(leadsTable).where(eq(leadsTable.id, staleRetry.leadId));
assert.ok(staleRetryLead);
await db.update(leadsTable).set({
  version: staleRetryLead.version + 1,
  updatedAt: nowAt(),
  nextAction: `${syntheticLabel} new version invalidates the pending retry.`,
}).where(eq(leadsTable.id, staleRetry.leadId));
await evaluateLeadDecision(staleRetry.leadId, operator, nowAt());
const [staleRetryAfterRefresh] = await db.select().from(dealDecisionWorkItemsTable)
  .where(eq(dealDecisionWorkItemsTable.id, staleRetry.workItem.id));
assert.equal(staleRetryAfterRefresh?.status, "EXPIRED");
await maintainDecisionWorkLifecycle(new Date(staleRetryFailure.nextAttemptAt!.getTime() + 1));
const [staleRetryAfterDue] = await db.select().from(dealDecisionWorkItemsTable)
  .where(eq(dealDecisionWorkItemsTable.id, staleRetry.workItem.id));
assert.equal(staleRetryAfterDue?.status, "EXPIRED", "old evidence cannot requeue a superseded retry");

// A human-authorized action remains READY and records a denial, never a worker claim.
const gated = await seed("authorization denied");
const gatedDecision = await evaluateLeadDecision(gated.leadId, operator, nowAt());
const gatedItemId = randomUUID();
const [gatedItem] = await db.insert(dealDecisionWorkItemsTable).values({
  id: gatedItemId,
  subjectType: "LEAD",
  subjectId: gated.leadId,
  leadId: gated.leadId,
  discoveryId: null,
  evaluationId: gatedDecision.evaluationId,
  actionCode: "CALL_NEXT",
  gapKey: "synthetic:human-approval",
  idempotencyKey: `synthetic:${gated.leadId}:CALL_NEXT:${gatedDecision.snapshotHash}`,
  status: "READY",
  reason: `${syntheticLabel} protected communication action.`,
  evidenceRefs: gatedDecision.evidenceRefs,
  payload: {
    code: "CALL_NEXT",
    requiresHumanAuthorization: true,
    synthetic: true,
  },
  evidenceSnapshotHash: gatedDecision.snapshotHash,
  subjectVersion: Number((await db.select({ version: leadsTable.version }).from(leadsTable)
    .where(eq(leadsTable.id, gated.leadId)))[0]?.version ?? 0),
  attempts: 0,
  maxAttempts: 3,
  retryable: false,
  stateVersion: 1,
  createdBy: operator,
  createdAt: nowAt(),
  updatedAt: nowAt(),
}).returning();
assert.ok(gatedItem);
const deniedClaim = await claimDecisionWorkItem(gatedItemId, "synthetic:unauthorized-worker", ["CALL_NEXT"], nowAt());
assert.equal(deniedClaim, null);
const [gatedAfter] = await db.select().from(dealDecisionWorkItemsTable).where(eq(dealDecisionWorkItemsTable.id, gatedItemId));
assert.equal(gatedAfter?.status, "READY");
assert.equal(gatedAfter?.attempts, 0, "a denied claim does not increment attempts or acquire a lease");
const deniedEvents = await db.select().from(dealDecisionWorkEventsTable).where(and(
  eq(dealDecisionWorkEventsTable.workItemId, gatedItemId),
  eq(dealDecisionWorkEventsTable.eventType, "CLAIM_DENIED_AUTHORIZATION"),
));
assert.equal(deniedEvents.length, 1);

// Explicit expiry is idempotent and terminal; a lease timeout uses bounded retry instead.
const expiring = await seed("explicit expiry");
const expiry = await expireDecisionWorkItem(
  expiring.workItem.id,
  "synthetic:expiry-reviewer",
  `${syntheticLabel} superseded by a synthetic terminal decision.`,
  nowAt(),
);
assert.equal(expiry.item.status, "EXPIRED");
assert.equal((await expireDecisionWorkItem(expiring.workItem.id, "synthetic:expiry-reviewer", "replay", nowAt())).idempotentReplay, true);

const leaseExpired = await seed("lease expiry");
const shortClaim = await claimDecisionWorkItem(leaseExpired.workItem.id, "synthetic:lease-worker",
  autoCodes(leaseExpired.workItem), nowAt(), 1_000);
assert.ok(shortClaim);
const leaseRecovery = await maintainDecisionWorkLifecycle(new Date(shortClaim.leaseExpiresAt.getTime() + 1));
assert.equal(leaseRecovery.leasesRecovered, 1);
const [leaseFailed] = await db.select().from(dealDecisionWorkItemsTable)
  .where(eq(dealDecisionWorkItemsTable.id, leaseExpired.workItem.id));
assert.equal(leaseFailed?.status, "FAILED");
assert.equal(leaseFailed?.retryable, true);
assert.ok(leaseFailed?.nextAttemptAt);

// The actual worker dispatcher accepts a replaceable synthetic executor but never
// sends calls or communications; it only completes the explicitly registered task.
const workerFixture = await seed("worker dispatch");
const noExecutorRun = await runDecisionWorkOnce(new Map(), nowAt(), "synthetic:no-executor");
assert.ok(noExecutorRun);
const [unconfiguredWork] = await db.select().from(dealDecisionWorkItemsTable)
  .where(eq(dealDecisionWorkItemsTable.id, workerFixture.workItem.id));
assert.equal(unconfiguredWork?.status, "READY");
assert.equal(unconfiguredWork?.attempts, 0, "unconfigured work is not claimed or falsely completed");
const workerRun = await runDecisionWorkOnce(new Map([
  [workerFixture.workItem.actionCode, async () => ({
    reason: `${syntheticLabel} registered local test executor completed.`,
    evidenceRefs: workerFixture.workItem.evidenceRefs,
    metadata: { synthetic: true, externalAction: false },
  })],
]), nowAt(), "synthetic:dispatcher");
assert.ok(workerRun.completed >= 1);
const [workerCompleted] = await db.select().from(dealDecisionWorkItemsTable)
  .where(eq(dealDecisionWorkItemsTable.id, workerFixture.workItem.id));
assert.equal(workerCompleted?.status, "COMPLETED");

const eventRows = await db.select().from(dealDecisionWorkEventsTable);
const auditRows = await db.select().from(auditTable);
assert.ok(eventRows.length >= 20, "all tested lifecycle transitions and denials persisted as events");
assert.ok(auditRows.some(row => row.action === "DECISION_WORK_CLAIMED"));
assert.ok(auditRows.some(row => row.action === "DECISION_WORK_TERMINAL_FAILURE"));
assert.ok(auditRows.every(row => row.entityId.length > 0));

console.log(JSON.stringify({
  exercise: "SYNTHETIC PERSISTED DECISION-WORK LIFECYCLE — no real property or external action",
  checks: {
    concurrentClaim: winningClaims.length,
    completionReplayIdempotent: replay.idempotentReplay,
    retrySuccess: retryCompleted.item.status,
    boundedAttempts: boundedFinal?.attempts,
    terminalFailure: boundedFinal?.retryable === false,
    staleEvidenceBlocksCompletion: staleCompletion.item.status,
    staleRetryInvalidated: staleRetryAfterRefresh?.status,
    authorizationDenied: deniedEvents.length,
    explicitExpiry: expiry.item.status,
    leaseExpiryRecovery: leaseFailed?.status,
    workerDispatcherCompletion: workerCompleted?.status,
    workEvents: eventRows.length,
    auditRows: auditRows.length,
  },
  pass: true,
}));
