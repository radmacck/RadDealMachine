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
let missingCriteriaId: string|undefined;
let partialCriteriaId: string|undefined;
try {
  const contactObservedAt=new Date().toISOString();
  const buyer = await createBuyer({name:"SYNTHETIC BUYER EXERCISE ONLY",email:"synthetic@example.com",phone:"+1 (555) 010-0123",
    source:"Synthetic database exercise, not real proof",contactSourceUrl:"https://example.com/synthetic-buyer-contact",
    contactObservedAt,contactConfidence:0.82,status:"ACTIVE",
     criteria:{states:["TX"],cities:["Synthetic City"],zipCodes:["77001"],propertyTypes:["SINGLE_FAMILY","TOWNHOUSE"],
       minPurchasePrice:120000,maxPurchasePrice:200000,minArv:150000,maxArv:260000,maxRepairs:50000,
       minBeds:2,maxBeds:4,minBaths:1,maxBaths:3,minSqft:500,maxSqft:2000,closingDays:3,
       counties:["Synthetic County"],excludedCounties:[],excludedCities:[],excludedZipCodes:[],minUnits:1,maxUnits:1,
       rehabTolerance:"HEAVY",strategies:["FLIP"],fundingTypes:["CASH"],maxConcurrentDeals:2,minSpread:15000,minCapRate:0.08}},actor);
  id = buyer.id;
  assert.equal(buyer.syntheticFixture,true,"Synthetic service records must carry an explicit persisted fixture marker.");
   const persistedProfile = await getBuyerRecord(id);
   assert.equal(persistedProfile.source,buyer.source,"The buyer/profile source must persist with its criteria.");
   assert.ok(Number.isFinite(Date.parse(persistedProfile.updatedAt)),"The persisted buyer record must expose its update time.");
   assert.deepEqual(persistedProfile.criteria?.states,["TX"]);
   assert.deepEqual(persistedProfile.criteria?.zipCodes,["77001"]);
   assert.deepEqual(persistedProfile.criteria?.propertyTypes,["SINGLE_FAMILY","TOWNHOUSE"]);
   assert.equal(persistedProfile.criteria?.minPurchasePrice,120000);
   assert.equal(persistedProfile.criteria?.maxPurchasePrice,200000);
   assert.equal(persistedProfile.criteria?.minCapRate,0.08,"Optional preferences must persist without being promoted to verification.");
  assert.equal((await getBuyerContactResearchRecord(id)).contactObservedAt,contactObservedAt);
  assert.equal((await getBuyerContactResearchRecord(id)).contactConfidence,0.82);
   const missingCriteria=await createBuyer({name:"SYNTHETIC CRITERIA NOT COLLECTED",email:"",phone:"",
     source:"Synthetic missing-criteria test",status:"ACTIVE",criteria:null},actor);
   missingCriteriaId=missingCriteria.id;
   const missingReload=await getBuyerRecord(missingCriteria.id);
   assert.equal(missingReload.criteria,null);
   assert.ok(missingReload.qualificationBlockers.some(reason=>/Structured buying criteria have not been qualified/i.test(reason)),
     "A missing buy box must remain visible as a qualification blocker.");
   const partialCriteria=await createBuyer({name:"SYNTHETIC OPTIONAL PREFERENCES OMITTED",email:"",phone:"",
     source:"Synthetic partial-criteria test",status:"ACTIVE",criteria:{states:["PA"],cities:[],zipCodes:[],
       propertyTypes:["SINGLE_FAMILY"],maxPurchasePrice:180000,maxRepairs:40000,minBeds:1,minSqft:400,maxSqft:1800,closingDays:30}},actor);
   partialCriteriaId=partialCriteria.id;
   const partialReload=await getBuyerRecord(partialCriteria.id);
   assert.equal(partialReload.criteria?.maxPurchasePrice,180000);
   assert.equal(partialReload.criteria?.minPurchasePrice,undefined);
   assert.equal(partialReload.criteria?.rehabTolerance,undefined);
   assert.equal(partialReload.criteria?.strategies?.length,undefined);
   assert.ok(partialReload.qualificationBlockers.some(reason=>/Explicit criteria required/.test(reason)),
     "Unrecorded optional preferences remain missing and block approval rather than being invented.");
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
  const unchanged = await updateBuyer(id,{...buyer,version:verified.version,criteria:{...buyer.criteria!,minCapRate:0.08}},actor);
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
   assert.equal(changed.criteria?.maxPurchasePrice,210000);
   assert.equal(changed.verificationHistory?.[0]?.criteria?.maxPurchasePrice,200000,
     "The prior owner-reviewed criteria snapshot must remain available after an edit.");
    assert.ok(Date.parse(changed.updatedAt)>Date.parse(stale.updatedAt),"Criteria edits must advance the persisted record update time.");
   const criteriaAudit = await db.select({action:auditTable.action,detail:auditTable.detail}).from(auditTable)
     .where(and(eq(auditTable.actor,actor.id),eq(auditTable.entityId,id)));
   assert.ok(criteriaAudit.some(event=>event.action==="BUYER_UPDATED"&&/Criteria\/status revised/.test(event.detail)),
     "Criteria edits must append an audit event.");
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
  if (missingCriteriaId) await db.delete(buyersTable).where(eq(buyersTable.id,missingCriteriaId));
  if (partialCriteriaId) await db.delete(buyersTable).where(eq(buyersTable.id,partialCriteriaId));
  await db.delete(jobsTable).where(eq(jobsTable.requestedBy,actor.id));
  await db.delete(auditTable).where(eq(auditTable.actor,actor.id));
  await pool.end();
}