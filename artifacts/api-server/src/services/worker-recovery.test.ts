import assert from "node:assert/strict";
import { test } from "node:test";
import { workerFailureDisposition, workerFailureIsRetryable, workerLeaseExpired, workerRecoveryMessage, workerRetryDelayMs } from "./worker-recovery";

test("worker failures back off with a bounded retry schedule and dead-letter on the final attempt", () => {
  const now = new Date("2026-10-14T12:00:00.000Z");
  const first = workerFailureDisposition(1,now);
  const second = workerFailureDisposition(2,now);
  const final = workerFailureDisposition(3,now);
  assert.equal(first.state,"QUEUED");
  assert.equal(first.retryAt?.getTime(),now.getTime()+15_000);
  assert.equal(second.retryAt?.getTime(),now.getTime()+30_000);
  assert.equal(final.state,"FAILED");
  assert.equal(final.retryAt,null);
  assert.equal(first.nextAction,"WAIT_FOR_SCHEDULED_RETRY");
  assert.equal(final.nextAction,"OPERATOR_REVIEW_AND_QUEUE_NEW_IDEMPOTENCY_KEY");
  assert.match(workerRecoveryMessage(final,"system:scheduler"),/Human owner: UNASSIGNED/);
  assert.match(workerRecoveryMessage(first,"operator-123"),/Accountable requestor: operator-123/);
  assert.match(final.message,/Dead-lettered/);
  assert.equal(workerRetryDelayMs(99),5*60_000);
});

test("permanent domain failures stop immediately while provider outages remain bounded-retryable", () => {
  const now = new Date("2026-10-14T12:00:00.000Z");
  assert.equal(workerFailureIsRetryable({status:409}),false);
  assert.equal(workerFailureIsRetryable({status:422}),false);
  assert.equal(workerFailureIsRetryable({status:429}),true);
  assert.equal(workerFailureIsRetryable({status:503}),true);
  assert.equal(workerFailureIsRetryable(new Error("socket timeout")),true);
  const permanent = workerFailureDisposition(1,now,false);
  assert.equal(permanent.state,"FAILED");
  assert.equal(permanent.retryAt,null);
  assert.equal(permanent.nextAction,"OPERATOR_REVIEW_AND_QUEUE_NEW_IDEMPOTENCY_KEY");
});

test("stale leases are recovered only for running jobs after the exact lease timeout", () => {
  const now = new Date("2026-10-14T12:05:00.000Z");
  assert.equal(workerLeaseExpired("RUNNING",new Date(now.getTime()-180_000),now),true);
  assert.equal(workerLeaseExpired("RUNNING",new Date(now.getTime()-179_999),now),false);
  assert.equal(workerLeaseExpired("SUCCEEDED",new Date(now.getTime()-500_000),now),false);
});
