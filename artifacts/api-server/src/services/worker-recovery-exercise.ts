import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, jobsTable, pool } from "@workspace/db";
import { queueJob } from "./operations-records";
import { runWorkerOnce } from "./workers";

const key = `synthetic-worker-recovery:${randomUUID()}`;
const now = new Date();
try {
  const queued = await queueJob(db,"DISCOVER_PROPERTIES",null,key,"synthetic:recovery-test",{termsReviewed:false});
  const replay = await queueJob(db,"DISCOVER_PROPERTIES",null,key,"synthetic:recovery-test",{termsReviewed:false});
  assert.equal(replay.id,queued.id,"duplicate idempotency keys must resolve to one durable worker job");
  const racingClaims = await Promise.all([runWorkerOnce(now,false,queued.id),runWorkerOnce(now,false,queued.id)]);
  const resultClaims = racingClaims.filter(Boolean);
  assert.equal(resultClaims.length,1,"concurrent workers must claim one durable job at most once");
  let result = resultClaims[0]!;
  assert.equal(result?.state,"QUEUED","first retryable failure must remain queued, not falsely complete or dead-letter");
  assert.equal(result?.attempts,1);
  let [persisted] = await db.select().from(jobsTable).where(eq(jobsTable.id,queued.id));
  let recovery = persisted?.payload.recovery as Record<string,unknown>;
  assert.equal(Array.isArray(recovery.history),true);
  assert.equal((recovery.history as unknown[]).length,1);
  assert.equal(typeof recovery.nextAttemptAt,"string");

  for (const expectedAttempt of [2,3]) {
    await db.update(jobsTable).set({payload:{...persisted!.payload,recovery:{...recovery,nextAttemptAt:new Date(0).toISOString()}}})
      .where(eq(jobsTable.id,queued.id));
    const retried = await runWorkerOnce(new Date(now.getTime()+expectedAttempt*60_000),false,queued.id);
    assert.ok(retried);
    result = retried;
    assert.equal(result?.attempts,expectedAttempt);
    assert.equal(result?.state,expectedAttempt===3?"FAILED":"QUEUED");
    [persisted] = await db.select().from(jobsTable).where(eq(jobsTable.id,queued.id));
    recovery = persisted!.payload.recovery as Record<string,unknown>;
  }
  assert.equal(typeof recovery.deadLetteredAt,"string","terminal failures must retain a durable dead-letter timestamp");
  assert.equal((recovery.history as unknown[]).length,3,"recovery history records each failed attempt");
  assert.equal(recovery.ownerActorId,"synthetic:recovery-test");
  assert.equal(recovery.ownerKind,"REQUESTER");
  assert.equal(recovery.nextAction,"OPERATOR_REVIEW_AND_QUEUE_NEW_IDEMPOTENCY_KEY");
  assert.equal(await runWorkerOnce(new Date(now.getTime()+10*60_000),false,queued.id),null,
    "dead-letter replay must not execute again or create duplicate work");

  const staleLeaseJob = await queueJob(db,"DISCOVER_PROPERTIES",null,`${key}:stale-lease`,"system:scheduler",{termsReviewed:false});
  await db.update(jobsTable).set({state:"RUNNING",attempts:2,updatedAt:new Date(now.getTime()-4*60_000)})
    .where(eq(jobsTable.id,staleLeaseJob.id));
  assert.equal(await runWorkerOnce(now,false,staleLeaseJob.id),null,"expired lease requeues with bounded delay instead of being falsely completed");
  const [recoveredLease] = await db.select().from(jobsTable).where(eq(jobsTable.id,staleLeaseJob.id));
  assert.equal(recoveredLease?.state,"QUEUED");
  assert.equal((recoveredLease?.payload.recovery as Record<string,unknown>).ownerKind,"SYSTEM_REQUEST_UNASSIGNED_TO_HUMAN");
  console.log(JSON.stringify({status:"PASS",synthetic:true,attempts:persisted?.attempts,history:(recovery.history as unknown[]).length,
    finalState:persisted?.state,deadLetteredAt:recovery.deadLetteredAt,duplicateReplaySafe:true,concurrentClaimSafe:true,
    staleLeaseRecovered:recoveredLease?.state}));
} finally {
  await pool.end();
}
