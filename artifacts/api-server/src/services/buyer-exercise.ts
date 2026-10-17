import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import { db,pool,buyersTable,auditTable,jobsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { GetBuyerContactResearchResponse } from "@workspace/api-zod";
import { createBuyer, recordBuyerContactPermission, updateBuyer, verifyBuyer } from "./buyer-store";
import { getBuyerContactResearchRecord, getBuyerRecord } from "./operations-records";
import { reviewBuyerPool } from "./buyer-pool";
const actor = {id:`synthetic-buyer-exercise:${randomUUID()}`,role:"OWNER"};
let id: string|undefined;
let otherId: string|undefined;
try {
  const contactObservedAt=new Date().toISOString();
  const buyer = await createBuyer({name:"SYNTHETIC BUYER EXERCISE ONLY",email:"synthetic@example.com",phone:"+1 (555) 010-0123",
    source:"Synthetic database exercise, not real proof",contactSourceUrl:"https://example.com/synthetic-buyer-contact",
    contactObservedAt,contactConfidence:0.82,status:"ACTIVE",
    criteria:{states:["TX"],cities:["Synthetic City"],zipCodes:[],propertyTypes:["SINGLE_FAMILY"],
      maxPurchasePrice:200000,maxRepairs:50000,minBeds:2,minSqft:500,maxSqft:2000,closingDays:3,
      counties:[],excludedCounties:[],excludedCities:[],excludedZipCodes:[],minPurchasePrice:0,minUnits:1,maxUnits:1,
      minBaths:1,rehabTolerance:"HEAVY",strategies:["FLIP"],fundingTypes:["CASH"],maxConcurrentDeals:2}},actor);
  id = buyer.id;
  assert.equal(buyer.syntheticFixture,true,"Synthetic service records must carry an explicit persisted fixture marker.");
  assert.equal((await getBuyerContactResearchRecord(id)).contactObservedAt,contactObservedAt);
  assert.equal((await getBuyerContactResearchRecord(id)).contactConfidence,0.82);
  const other=await createBuyer({name:"SYNTHETIC SECOND BUYER",email:"other-synthetic@example.com",phone:"",
    source:"Synthetic duplicate-update test",status:"ACTIVE",criteria:buyer.criteria},actor);
  otherId=other.id;
  await assert.rejects(createBuyer({name:"SYNTHETIC PHONE DUPLICATE",email:"phone-duplicate@example.com",phone:"5550100123",
    source:"Synthetic normalized-phone conflict test",status:"ACTIVE",criteria:buyer.criteria},actor),e=>(e as {status:number}).status===409,
    "Phone routes with and without a leading country code must be recognized as one identity conflict.");
  await assert.rejects(updateBuyer(other.id,{...other,email:buyer.email},actor),e=>(e as {status:number}).status===409,
    "Editing a buyer cannot attach another buyer's contact route to a conflicting identity.");
  await assert.rejects(
    createBuyer({name:"SYNTHETIC BUYER EXERCISE ONLY",email:"synthetic@example.com",phone:"",
      source:"Synthetic duplicate test",status:"ACTIVE",criteria:buyer.criteria},actor),
    (error) => (error as {status:number}).status === 409,
    "Exact contact-route duplicates must be reviewed rather than inserted twice.",
  );
  await assert.rejects(
    createBuyer({name:"DIFFERENT SYNTHETIC IDENTITY",email:"synthetic@example.com",phone:"",
      source:"Synthetic conflicting identity test",status:"ACTIVE",criteria:buyer.criteria},actor),
    (error) => (error as {status:number}).status === 409,
    "A shared route with a conflicting identity must not be auto-merged.",
  );
  assert.equal(buyer.verificationStatus,"UNVERIFIED");
  assert.equal((await getBuyerRecord(id)).name,buyer.name);
  const now = new Date();
  const verification = {version:buyer.version,identityEvidenceUrl:"https://example.com/synthetic-identity",
    fundingEvidenceUrl:"https://example.com/synthetic-funds",verificationNote:"SYNTHETIC TEST only, not actual proof.",
    availableFunds:200000,evidenceAt:now.toISOString(),validUntil:new Date(now.getTime()+10*86400000).toISOString(),
    currentBuyingStatus:"BUYING" as const,buyingEvidenceAt:now.toISOString(),buyingEvidenceUrl:"https://example.com/synthetic-buying",
    criteriaEvidenceUrl:"https://example.com/synthetic-criteria",verificationSource:"Synthetic reviewed response",confidence:0.9};
  await assert.rejects(verifyBuyer(id,verification,{...actor,role:"OPERATOR"},now),e=>(e as {status:number}).status===403);
  const verificationWithFundingMethods={...verification,verifiedFundingTypes:["CASH" as const]};
  await assert.rejects(verifyBuyer(id,{...verificationWithFundingMethods,fundingEvidenceUrl:undefined},actor,now),/funding evidence/i,
    "A buyer-reported funding preference or an available-funds number without a source cannot pass capacity verification.");
  const {verifiedFundingTypes:_,...withoutVerifiedMethod}=verificationWithFundingMethods;
  await assert.rejects(verifyBuyer(id,withoutVerifiedMethod,actor,now),/funding methods/i,
    "The declared buy-box funding method cannot substitute for an evidence-reviewed funding method.");
  const verified = await verifyBuyer(id,verificationWithFundingMethods,actor,now);
  assert.equal(verified.verificationStatus,"VERIFIED");
  assert.equal(verified.syntheticFixture,true);
  assert.equal(verified.approvalStatus,"QUALIFICATION_REQUIRED",
    "Even fully populated synthetic test proof must not approve a real-buyer record.");
  assert.ok(verified.qualificationBlockers.some(reason=>/Synthetic fixture is not a real buyer/.test(reason)));
  assert.equal(verified.verificationHistory?.length,1);
  await assert.rejects(verifyBuyer(id,verification,actor,now),e=>(e as {status:number}).status===409);
  assert.equal((await getBuyerRecord(id,db,new Date(now.getTime()+11*86400000))).verificationStatus,"STALE");
  const unchanged = await updateBuyer(id,{...buyer,version:verified.version,criteria:{...buyer.criteria!,minCapRate:null}},actor);
  assert.equal(unchanged.approvalStatus,"QUALIFICATION_REQUIRED",
    "A synthetic buyer must remain ineligible even when an unchanged criteria edit is replayed.");
  assert.ok(unchanged.qualificationBlockers.some(reason=>/Synthetic fixture is not a real buyer/.test(reason)));
  await reviewBuyerPool(new Date(now.getTime()+11*86400000));
  const stale = await getBuyerRecord(id,db,new Date(now.getTime()+11*86400000));
  assert.equal(stale.approvalStatus,"REVERIFICATION_REQUIRED");
  assert.equal(stale.qualificationTask?.kind,"REVERIFY");
  assert.equal(stale.qualificationTask?.state,"WAITING_EXTERNAL");
  await reviewBuyerPool(new Date(now.getTime()+11*86400000));
  assert.equal((await getBuyerRecord(id)).version,stale.version,"Repeated review must not duplicate waiting tasks");
  const changed = await updateBuyer(id,{...buyer,version:stale.version,criteria:{...buyer.criteria!,maxPurchasePrice:210000}},actor);
  assert.equal(changed.approvalStatus,"REVERIFICATION_REQUIRED",
    "criteria edits cannot requalify a buyer whose buying evidence has also expired");
  assert.equal(changed.currentBuyingStatus,"UNKNOWN");
  assert.equal(changed.verificationHistory?.length,1,"Prior evidence must remain readable after criteria changes");
  const renewed = await verifyBuyer(id,{...verificationWithFundingMethods,version:changed.version},actor,now);
  assert.equal(renewed.approvalStatus,"QUALIFICATION_REQUIRED",
    "Fresh synthetic evidence must not requalify a synthetic buyer as real.");
  assert.ok(renewed.qualificationBlockers.some(reason=>/Synthetic fixture is not a real buyer/.test(reason)));
  assert.equal(renewed.verificationHistory?.length,2);
  const updated = await updateBuyer(id,{...buyer,version:renewed.version,name:"SYNTHETIC REVISED IDENTITY"},actor);
  assert.equal(updated.verificationStatus,"UNVERIFIED");
  const permissionInput = {version:updated.version,status:"GRANTED" as const,channels:["EMAIL" as const],
    source:"Synthetic owner-reviewed consent fixture",evidenceUrl:"https://example.com/synthetic-consent",
    capturedAt:now.toISOString(),validUntil:new Date(now.getTime()+30*86400000).toISOString()};
  await assert.rejects(recordBuyerContactPermission(id,permissionInput,{...actor,role:"OPERATOR"},now),
    e=>(e as {status:number}).status===403,"Only the owner may record buyer contact permission.");
  const permission = await recordBuyerContactPermission(id,permissionInput,actor,now);
  assert.equal(permission.status,"GRANTED");
  assert.equal(permission.channels[0],"EMAIL");
  const [reloaded] = await db.select().from(buyersTable).where(eq(buyersTable.id,id));
  assert.equal((reloaded.payload.contactPermission as {status:string}).status,"GRANTED",
    "Permission evidence must persist and reload with the buyer.");
  assert.equal((reloaded.payload.contactPermissionHistory as unknown[]).length,1,
    "Permission provenance history persists separately from profile routes.");
  const research=GetBuyerContactResearchResponse.parse(await getBuyerContactResearchRecord(id));
  assert.equal(research.contactPermissionHistory[0]?.source,permissionInput.source);
  assert.match(research.nextAction,/identity conflicts|permission/i);
  await assert.rejects(recordBuyerContactPermission(id,permissionInput,actor,now),
    e=>(e as {status:number}).status===409,"Permission writes must reject stale buyer versions.");
  const optedOut = await recordBuyerContactPermission(id,{...permissionInput,version:reloaded.version,
    status:"OPTED_OUT",channels:[],validUntil:null},actor,now);
  assert.equal(optedOut.status,"OPTED_OUT");
  assert.deepEqual(optedOut.channels,[]);
  await assert.rejects(recordBuyerContactPermission(id,{...permissionInput,version:reloaded.version,
    capturedAt:new Date(now.getTime()-31*86400000).toISOString()},actor,now));
  assert.ok((await db.select().from(jobsTable).where(eq(jobsTable.requestedBy,actor.id))).length>=3);
  logger.info({checks:"create/reload, owner-only verification, dated funding, stale evidence, version conflict, identity invalidation, queued matching"},"Buyer persistence exercise PASSED (synthetic data)");
} finally {
  if (id) await db.delete(buyersTable).where(eq(buyersTable.id,id));
  if (otherId) await db.delete(buyersTable).where(eq(buyersTable.id,otherId));
  await db.delete(jobsTable).where(eq(jobsTable.requestedBy,actor.id));
  await db.delete(auditTable).where(eq(auditTable.actor,actor.id));
  await pool.end();
}