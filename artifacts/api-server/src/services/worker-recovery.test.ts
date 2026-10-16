import assert from "node:assert/strict";
import { test } from "node:test";
import { workerFailureDisposition, workerLeaseExpired, workerRecoveryMessage, workerRetryDelayMs } from "./worker-recovery";

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

test("stale leases are recovered only for running jobs after the exact lease timeout", () => {
  const now = new Date("2026-10-14T12:05:00.000Z");
  assert.equal(workerLeaseExpired("RUNNING",new Date(now.getTime()-180_000),now),true);
  assert.equal(workerLeaseExpired("RUNNING",new Date(now.getTime()-179_999),now),false);
  assert.equal(workerLeaseExpired("SUCCEEDED",new Date(now.getTime()-500_000),now),false);
});
