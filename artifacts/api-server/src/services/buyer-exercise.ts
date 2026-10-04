import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import { db,pool,buyersTable,auditTable,jobsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { createBuyer, updateBuyer, verifyBuyer } from "./buyer-store";
import { getBuyerRecord } from "./operations-records";
import { reviewBuyerPool } from "./buyer-pool";
const actor = {id:`synthetic-buyer-exercise:${randomUUID()}`,role:"OWNER"};
let id: string|undefined;
try {
  const buyer = await createBuyer({name:"SYNTHETIC BUYER EXERCISE ONLY",email:"synthetic@example.com",phone:"",
    source:"Synthetic database exercise, not real proof",status:"ACTIVE",
    criteria:{states:["TX"],cities:["Synthetic City"],zipCodes:[],propertyTypes:["SINGLE_FAMILY"],
      maxPurchasePrice:200000,maxRepairs:50000,minBeds:2,minSqft:500,maxSqft:2000,closingDays:3,
      counties:[],excludedCounties:[],excludedCities:[],excludedZipCodes:[],minPurchasePrice:0,minUnits:1,maxUnits:1,
      minBaths:1,rehabTolerance:"HEAVY",strategies:["FLIP"],fundingTypes:["CASH"],maxConcurrentDeals:2}},actor);
  id = buyer.id;
  assert.equal(buyer.verificationStatus,"UNVERIFIED");
  assert.equal((await getBuyerRecord(id)).name,buyer.name);
  const now = new Date();
  const verification = {version:buyer.version,identityEvidenceUrl:"https://example.com/synthetic-identity",
    fundingEvidenceUrl:"https://example.com/synthetic-funds",verificationNote:"SYNTHETIC TEST only, not actual proof.",
    availableFunds:200000,evidenceAt:now.toISOString(),validUntil:new Date(now.getTime()+10*86400000).toISOString(),
    currentBuyingStatus:"BUYING" as const,buyingEvidenceAt:now.toISOString(),buyingEvidenceUrl:"https://example.com/synthetic-buying",
    criteriaEvidenceUrl:"https://example.com/synthetic-criteria",verificationSource:"Synthetic reviewed response",confidence:0.9};
  await assert.rejects(verifyBuyer(id,verification,{...actor,role:"OPERATOR"},now),e=>(e as {status:number}).status===403);
  const verified = await verifyBuyer(id,verification,actor,now);
  assert.equal(verified.verificationStatus,"VERIFIED");
  assert.equal(verified.approvalStatus,"APPROVED");
  assert.equal(verified.verificationHistory?.length,1);
  await assert.rejects(verifyBuyer(id,verification,actor,now),e=>(e as {status:number}).status===409);
  assert.equal((await getBuyerRecord(id,db,new Date(now.getTime()+11*86400000))).verificationStatus,"STALE");
  const unchanged = await updateBuyer(id,{...buyer,version:verified.version,criteria:{...buyer.criteria!,minCapRate:null}},actor);
  assert.equal(unchanged.approvalStatus,"APPROVED","Unchanged JSONB criteria must not cause repetitive qualification");
  await reviewBuyerPool(new Date(now.getTime()+11*86400000));
  const stale = await getBuyerRecord(id,db,new Date(now.getTime()+11*86400000));
  assert.equal(stale.approvalStatus,"REVERIFICATION_REQUIRED");
  assert.equal(stale.qualificationTask?.kind,"REVERIFY");
  assert.equal(stale.qualificationTask?.state,"WAITING_EXTERNAL");
  await reviewBuyerPool(new Date(now.getTime()+11*86400000));
  assert.equal((await getBuyerRecord(id)).version,stale.version,"Repeated review must not duplicate waiting tasks");
  const changed = await updateBuyer(id,{...buyer,version:stale.version,criteria:{...buyer.criteria!,maxPurchasePrice:210000}},actor);
  assert.equal(changed.approvalStatus,"QUALIFICATION_REQUIRED");
  assert.equal(changed.currentBuyingStatus,"UNKNOWN");
  assert.equal(changed.verificationHistory?.length,1,"Prior evidence must remain readable after criteria changes");
  const renewed = await verifyBuyer(id,{...verification,version:changed.version},actor,now);
  assert.equal(renewed.approvalStatus,"APPROVED"); assert.equal(renewed.verificationHistory?.length,2);
  const updated = await updateBuyer(id,{...buyer,version:renewed.version,name:"SYNTHETIC REVISED IDENTITY"},actor);
  assert.equal(updated.verificationStatus,"UNVERIFIED");
  assert.ok((await db.select().from(jobsTable).where(eq(jobsTable.requestedBy,actor.id))).length>=3);
  logger.info({checks:"create/reload, owner-only verification, dated funding, stale evidence, version conflict, identity invalidation, queued matching"},"Buyer persistence exercise PASSED (synthetic data)");
} finally {
  if (id) await db.delete(buyersTable).where(eq(buyersTable.id,id));
  await db.delete(jobsTable).where(eq(jobsTable.requestedBy,actor.id));
  await db.delete(auditTable).where(eq(auditTable.actor,actor.id));
  await pool.end();
}