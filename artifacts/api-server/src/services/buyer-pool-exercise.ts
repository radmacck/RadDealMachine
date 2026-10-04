import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db,pool,buyersTable } from "@workspace/db";
import { discoverBuyer, reviewBuyerPool } from "./buyer-pool";
import { submitWorkerJob, runWorkerOnce } from "./workers";
import { allBuyerRecords } from "./operations-records";
import { logger } from "../lib/logger";
const actor = {id:`synthetic-pool:${randomUUID()}`,role:"OWNER"};
const now = new Date();
try {
  const input = {name:"SYNTHETIC UNKNOWN PROSPECT",source:"Synthetic public-post observation, not actual buying intent",
    sourceUrl:"https://example.com/synthetic-observation",capturedAt:now.toISOString(),confidence:0.55};
  const concurrent = await Promise.all([discoverBuyer(input,actor,now),discoverBuyer(input,actor,now)]);
  assert.equal(concurrent[0].id,concurrent[1].id,"Atomic source identity must deduplicate simultaneous discovery");
  const b = concurrent[0];
  assert.equal(b.criteria,null); assert.equal(b.email,""); assert.equal(b.phone,"");
  assert.equal(b.approvalStatus,"DISCOVERED"); assert.equal(b.currentBuyingStatus,"UNKNOWN");
  assert.equal(b.discoveryEvidence?.classification,"OBSERVED");
  assert.equal(b.qualificationTask?.state,"WAITING_EXTERNAL");
  assert.equal(b.availableFunds,undefined);
  await assert.rejects(discoverBuyer(input,{...actor,role:"OPERATOR"},now),e=>(e as {status:number}).status===403);
  await assert.rejects(discoverBuyer({...input,capturedAt:new Date(now.getTime()+86400000).toISOString()},actor,now),/future/);
  await assert.rejects(submitWorkerJob({kind:"BUYER_DISCOVERY",idempotencyKey:"synthetic-no-permission"},actor),/terms/);
  const manual = {kind:"BUYER_DISCOVERY" as const,idempotencyKey:"synthetic-permitted-discovery",termsReviewed:true,recurringDiscovery:true};
  const job = await submitWorkerJob(manual,actor);
  assert.equal((await submitWorkerJob(manual,actor)).id,job.id);
  await assert.rejects(submitWorkerJob({...manual,recurringDiscovery:false},actor),e=>(e as {status:number}).status===409);
  const raced = await Promise.all([runWorkerOnce(now,false,job.id),runWorkerOnce(now,false,job.id)]);
  assert.equal(raced.filter(Boolean).length,1);
  assert.equal(raced.find(Boolean)?.state,"SUCCEEDED","Actual official source fetch must succeed, not a mock provider");
  const first = await allBuyerRecords(db,now);
  assert.ok(first.length>1,"Actual feed must contribute real observed prospects to the isolated database");
  for (const p of first) {
    assert.equal(p.approvalStatus,"DISCOVERED"); assert.equal(p.criteria,null);
    assert.equal(p.currentBuyingStatus,"UNKNOWN"); assert.equal(p.qualificationTask?.state,"WAITING_EXTERNAL");
    assert.equal(p.discoveryEvidence?.classification,"OBSERVED");
  }
  const again = await submitWorkerJob({...manual,idempotencyKey:"synthetic-refresh",recurringDiscovery:false},actor);
  assert.equal((await runWorkerOnce(now,false,again.id))?.state,"SUCCEEDED");
  assert.equal((await allBuyerRecords(db,now)).length,first.length,"Repeated actual feed must be idempotent");
  await reviewBuyerPool(now);
  assert.equal((await allBuyerRecords(db,now)).find(p=>p.id===b.id)?.version,b.version,"Pending qualification is not re-created every tick");
  // The latest permitted manual job disables six-hour discovery; native reviews still recur.
  await runWorkerOnce(now,true);
  const {jobsTable} = await import("@workspace/db");
  const jobs = await db.select().from(jobsTable);
  assert.ok(jobs.some(j=>j.kind==="REVIEW_BUYER_POOL"&&j.idempotencyKey.startsWith("scheduled:")));
  assert.equal(jobs.some(j=>j.kind==="BUYER_DISCOVERY"&&j.idempotencyKey.startsWith("scheduled:")),false);
  const enabled = await submitWorkerJob({...manual,idempotencyKey:"synthetic-enable-again"},actor);
  await runWorkerOnce(new Date(now.getTime()+300000),true);
  const recurring = await db.select().from(jobsTable);
  assert.equal(recurring.filter(j=>j.kind==="BUYER_DISCOVERY"&&j.idempotencyKey.startsWith("scheduled:")).length,1);
  logger.info({observedProspects:first.length-1,checks:"real official feed→isolated PostgreSQL; source identity concurrency; no invented data or approval; durable tasks; leased execution; recurring opt-in/disable"},
    "Buyer pool exercise PASSED. No real workspace prospect seeded and no communication sent.");
} finally { await pool.end(); }