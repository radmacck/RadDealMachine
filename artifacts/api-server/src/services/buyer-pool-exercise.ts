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
  const discoveredSources = first.filter(p=>p.id!==b.id).flatMap(p=>p.sourceObservations??[]);
  assert.ok(discoveredSources.some(source=>source.sourceId.startsWith("phila-opa-owner:")),
    "The public OPA corporate-owner channel must retain source identity and sampled parcel IDs.");
  assert.ok(discoveredSources.some(source=>source.sourceId.startsWith("phila-transfer-grantee:")),
    "Repeated recorded grantees must be found and preserved as a separate discovery channel.");
  assert.ok(discoveredSources.every(source=>source.classification==="OBSERVED"&&source.sourceUrl&&source.lastObservedAt&&source.recordIdentities.length>0),
    "Buyer evidence must remain attributed and dated, never silently upgraded to verified intent.");
  const rawBuyerRows = await db.select({payload:buyersTable.payload}).from(buyersTable);
  const entityKeys = rawBuyerRows.map(row=>row.payload.discoveryIdentityKey)
    .filter((key):key is string=>typeof key==="string");
  assert.equal(entityKeys.length,new Set(entityKeys).size,"Cross-channel public entities must be deduplicated.");
  const crossChannelInput = {
    name:"Cross Channel Holdings LLC",source:"Observed in a public parcel-owner sample",
    sourceUrl:"https://example.com/opa",capturedAt:now.toISOString(),confidence:0.5,
  };
  const channelOne = await discoverBuyer(crossChannelInput,actor,now,"exercise:opa-owner",{
    sourceId:"phila-opa-owner:exercise",recordIdentities:["parcel-a"],activityCount:1,eventAt:null,
  });
  const channelTwo = await discoverBuyer({...crossChannelInput,source:"Observed in a recorded-deed sample",
    sourceUrl:"https://example.com/deeds",confidence:0.6},actor,now,"exercise:deed-grantee",{
    sourceId:"phila-transfer-grantee:exercise",recordIdentities:["deed-a","deed-b"],activityCount:2,
    eventAt:new Date(now.getTime()-86400000).toISOString(),
  });
  assert.equal(channelOne.id,channelTwo.id,"The same normalized public entity must merge across independent source keys.");
  assert.equal(channelTwo.sourceObservations?.length,2,"Cross-channel dedupe must retain both source trails.");
  assert.equal(channelTwo.currentBuyingStatus,"UNKNOWN","Cross-source evidence does not bypass current buyer qualification.");
  const historyInput = {
    name:"History Test Capital LLC",source:"Repeated deed-grantee test; no current intent claimed",
    sourceUrl:"https://example.com/recorded-transfers",capturedAt:now.toISOString(),confidence:0.45,
  };
  await discoverBuyer(historyInput,actor,now,"history-test-entity",{
    sourceId:"transfer-history:test-entity",recordIdentities:["deed-before"],activityCount:1,
    eventAt:new Date(now.getTime()-86400000).toISOString(),
  });
  const laterCapture = new Date(now.getTime()+86400000);
  const historyUpdated = await discoverBuyer({...historyInput,capturedAt:laterCapture.toISOString(),confidence:0.55},
    actor,laterCapture,"history-test-entity",{
      sourceId:"transfer-history:test-entity",recordIdentities:["deed-after"],activityCount:2,
      eventAt:new Date(laterCapture.getTime()-3600000).toISOString(),
    });
  const retainedHistory = historyUpdated.sourceObservations?.find(source=>source.sourceId==="transfer-history:test-entity");
  assert.equal(retainedHistory?.history.length,1,"A material change to public source evidence must preserve its prior version.");
  assert.deepEqual(retainedHistory?.history[0]?.recordIdentities,["deed-before"]);
  assert.deepEqual(retainedHistory?.recordIdentities,["deed-after"]);
  assert.equal(historyUpdated.currentBuyingStatus,"UNKNOWN","Changed public source observations still do not establish current buying intent.");
  const countBeforeRepeat = (await allBuyerRecords(db,now)).length;
  const again = await submitWorkerJob({...manual,idempotencyKey:"synthetic-refresh",recurringDiscovery:false},actor);
  assert.equal((await runWorkerOnce(now,false,again.id))?.state,"SUCCEEDED");
  assert.equal((await allBuyerRecords(db,now)).length,countBeforeRepeat,"Repeated actual feed must be idempotent.");
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
  logger.info({observedProspects:first.length-1,sourceObservationCount:discoveredSources.length,
    checks:"real OPA and recorded-transfer feeds→isolated PostgreSQL; cross-channel source evidence; public entity dedupe; no invented current intent or approval; durable tasks; leased execution; recurring opt-in/disable"},
    "Buyer pool exercise PASSED. No real workspace prospect seeded and no communication sent.");
} finally { await pool.end(); }