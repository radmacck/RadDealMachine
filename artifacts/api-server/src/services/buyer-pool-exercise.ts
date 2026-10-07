import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db,pool,buyersTable,auditTable } from "@workspace/db";
import { discoverBuyer, qualificationTask, reviewBuyerPool } from "./buyer-pool";
import { submitWorkerJob, runWorkerOnce } from "./workers";
import { allBuyerRecords } from "./operations-records";
import { getBuyerRecord } from "./operations-records";
import { createBuyerQualificationPortalInvite, getBuyerQualificationPortal, respondToBuyerQualificationPortal } from "./buyer-qualification-portal";
import { updateBuyer } from "./buyer-store";
import app from "../app";
import { matchBuyer, type DealContract, type LeadDetail } from "@workspace/deal-domain";
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
  assert.equal(b.qualificationTask?.outreachReadiness?.deliveryStatus,"NOT_SENT");
  assert.equal(b.qualificationTask?.outreachReadiness?.providerStatus,"NOT_CONNECTED");
  assert.equal(b.qualificationTask?.outreachReadiness?.contactRouteStatus,"NONE");
  assert.deepEqual(b.qualificationTask?.outreachReadiness?.availableChannels,[]);
  assert.ok(b.qualificationTask?.outreachReadiness?.missingCapabilities.some(x=>x.includes("No direct buyer email or phone route")));
  assert.ok(b.qualificationTask?.outreachReadiness?.missingCapabilities.some(x=>x.includes("No permitted email/SMS/voice outreach provider")));
  assert.match(b.qualificationTask?.preparedMessage ?? "",/No structured buying criteria are on file yet/);
  assert.equal(b.availableFunds,undefined);
  const knownProfileTask = qualificationTask({...b,criteria:{
    states:["PA"],cities:["Philadelphia"],zipCodes:["19104"],propertyTypes:["SINGLE_FAMILY"],
    maxPurchasePrice:250000,maxRepairs:60000,minBeds:2,minSqft:800,maxSqft:2800,closingDays:21,
    counties:["Philadelphia"],excludedCounties:["Chester"],excludedCities:["Norristown"],excludedZipCodes:["19001"],
    minPurchasePrice:50000,minArv:300000,maxArv:450000,minUnits:1,maxUnits:2,minBaths:1,maxBeds:4,maxBaths:3,
    rehabTolerance:"MODERATE",strategies:["FLIP"],fundingTypes:["CASH"],maxConcurrentDeals:2,minSpread:30000,minCapRate:0.08,
  }},"QUALIFY",now);
  assert.match(knownProfileTask.preparedMessage,/Philadelphia/);
  assert.match(knownProfileTask.preparedMessage,/\$50,000–\$250,000/);
  assert.match(knownProfileTask.preparedMessage,/Funding types stated: CASH/);
  assert.match(knownProfileTask.preparedMessage,/Please confirm or correct only what has changed/);
  const [persistedProspect] = await db.select({payload:buyersTable.payload}).from(buyersTable)
    .where(eq(buyersTable.id,b.id));
  const persistedTask = persistedProspect?.payload.qualificationTask as {
    outreachReadiness?: { deliveryStatus?: string };
  } | undefined;
  assert.equal(persistedTask?.outreachReadiness?.deliveryStatus,"NOT_SENT",
    "The provider block and not-sent delivery state must be persisted with the prospect's qualification task.");
  await assert.rejects(discoverBuyer(input,{...actor,role:"OPERATOR"},now),e=>(e as {status:number}).status===403);
  await assert.rejects(discoverBuyer({...input,capturedAt:new Date(now.getTime()+86400000).toISOString()},actor,now),/future/);
  const portalCriteria = {
    states:["PA"],cities:["Philadelphia"],zipCodes:["19104"],propertyTypes:["SINGLE_FAMILY"],
    maxPurchasePrice:250000,maxRepairs:60000,minBeds:2,minSqft:800,maxSqft:2800,closingDays:21,
    counties:["Philadelphia"],excludedCounties:["Chester"],excludedCities:["Norristown"],excludedZipCodes:["19001"],
    minPurchasePrice:50000,minArv:300000,maxArv:450000,minUnits:1,maxUnits:2,minBaths:1,maxBeds:4,maxBaths:3,
    rehabTolerance:"MODERATE",strategies:["FLIP"],fundingTypes:["CASH"],maxConcurrentDeals:2,minSpread:30000,minCapRate:0.08,
  };
  const invite = await createBuyerQualificationPortalInvite(b.id,{version:b.version},actor,now);
  assert.equal(invite.notSent,true,"Creating a self-service link must never be represented as outreach delivery.");
  await assert.rejects(createBuyerQualificationPortalInvite(b.id,{version:b.version},{...actor,role:"ANALYST"},now),e=>(e as {status:number}).status===403);
  await assert.rejects(getBuyerQualificationPortal("x".repeat(43),now),/invalid or no longer active/);
  const apiServer = app.listen(0,"127.0.0.1");
  await new Promise<void>((resolve) => apiServer.once("listening",resolve));
  const address = apiServer.address();
  if (!address || typeof address==="string") throw new Error("Isolated HTTP exercise did not bind an ephemeral API port.");
  const portalUrl = `http://127.0.0.1:${address.port}/api/portal/buyer-qualification`;
  const invalidTokenHttp = await fetch(portalUrl,{headers:{"X-Qualification-Portal-Token":"x".repeat(43)}});
  assert.equal(invalidTokenHttp.status,404,"The public HTTP route must reject an invalid capability.");
  const getResponse = await fetch(portalUrl,{headers:{"X-Qualification-Portal-Token":invite.token}});
  assert.equal(getResponse.status,200);
  assert.equal(getResponse.headers.get("cache-control"),"no-store");
  assert.equal(getResponse.headers.get("referrer-policy"),"no-referrer");
  const initialPortal = await getResponse.json() as {invitationId:string;criteria:unknown};
  assert.equal(initialPortal.invitationId,invite.invitationId);
  assert.equal(initialPortal.criteria,null,"The private portal may prefill only criteria actually on the buyer record.");
  const portalResponseInput = {
    responseId:randomUUID(),currentBuyingStatus:"BUYING" as const,
    criteria:portalCriteria,confirmedCurrent:true as const,note:"Synthetic buyer self-report only.",
  };
  const postResponse = await fetch(`${portalUrl}/response`,{
    method:"POST",
    headers:{"Content-Type":"application/json","X-Qualification-Portal-Token":invite.token},
    body:JSON.stringify(portalResponseInput),
  });
  assert.equal(postResponse.status,200,"Actual API route must persist a valid profile response.");
  const portalReceipt = await postResponse.json() as {status:string;receivedAt:string;ownerReviewRequired:boolean};
  assert.equal(portalReceipt.status,"RECEIVED_PENDING_OWNER_REVIEW");
  assert.equal(portalReceipt.ownerReviewRequired,true);
  assert.deepEqual(await respondToBuyerQualificationPortal(invite.token,portalResponseInput,now),portalReceipt,
    "A transport retry with the same response id and exact payload must be idempotent.");
  await assert.rejects(respondToBuyerQualificationPortal(invite.token,
    {...portalResponseInput,responseId:randomUUID()},now),/already received a different response/);
  await assert.rejects(getBuyerQualificationPortal(invite.token,now),/already used/);
  let selfReported = await getBuyerRecord(b.id,db,now);
  assert.deepEqual(selfReported.criteria,portalCriteria);
  assert.equal(selfReported.qualificationPortalSelfReport?.classification,"INDICATED");
  assert.equal(selfReported.qualificationPortalSelfReport?.identityVerified,false);
  assert.equal(selfReported.qualificationPortalSelfReport?.contactPermissionVerified,false);
  assert.equal(selfReported.qualificationTask?.state,"WAITING_REVIEW");
  assert.equal(selfReported.approvalStatus,"DISCOVERED","A profile self-report does not become an owner-reviewed qualification.");
  assert.equal(selfReported.currentBuyingStatus,"UNKNOWN","A buyer's self-claim of current buying cannot qualify the buyer.");
  assert.equal(selfReported.validUntil,null,"Self-reported criteria invalidate previous approval until the owner reviews evidence.");
  const syntheticContract: DealContract = {
    id:"synthetic-portal-contract",leadId:b.id,offerId:"synthetic-authorized-offer",version:1,status:"UNDER_CONTRACT",
    purchasePrice:100000,assignmentTarget:15000,earnestMoney:1000,assignmentAllowed:true,
    closingAt:new Date(now.getTime()+30*24*60*60*1000).toISOString(),contingencies:"Synthetic exercise only.",
    milestones:[],createdAt:now.toISOString(),
  };
  const syntheticDetail = {
    lead:{
      id:b.id,address:"SYNTHETIC SUBJECT",city:"Philadelphia",state:"PA",county:"Philadelphia",zip:"19104",
      propertyType:"SINGLE_FAMILY",beds:3,baths:2,sqft:1000,units:1,sellerName:"Synthetic only",
      source:"Synthetic fixture",stage:"UNDER_CONTRACT",version:1,nextAction:"Synthetic verification only.",
      createdAt:now.toISOString(),updatedAt:now.toISOString(),
    },
    underwriting:{version:1,conditionConfirmed:true,repairsComplete:true},
  } as LeadDetail;
  const selfReportMatch = matchBuyer(selfReported,syntheticDetail,syntheticContract,now);
  assert.equal(selfReportMatch.eligible,false,"The persisted self-report must not enter eligible buyer matching.");
  assert.ok(selfReportMatch.mismatches.some((reason)=>reason.toLowerCase().includes("identity/funding review is missing or stale")));
  assert.ok(selfReportMatch.mismatches.some((reason)=>reason.toLowerCase().includes("current buying/accepting status has not been verified")));
  const [storedBuyer] = await db.select({payload:buyersTable.payload}).from(buyersTable).where(eq(buyersTable.id,b.id));
  const storedInvite = storedBuyer?.payload.qualificationPortalInvite as {tokenDigest?:string}|undefined;
  assert.equal(storedInvite?.tokenDigest?.length,64,"Only the SHA-256 digest of the bearer token may persist.");
  assert.equal(JSON.stringify(storedBuyer?.payload).includes(invite.token),false,"The raw one-time link token must not persist in the buyer row.");
  const portalAudit = await db.select({action:auditTable.action}).from(auditTable).where(eq(auditTable.entityId,b.id));
  assert.ok(portalAudit.some((event)=>event.action==="BUYER_QUALIFICATION_LINK_CREATED"));
  assert.ok(portalAudit.some((event)=>event.action==="BUYER_SELF_REPORTED_PROFILE_RECEIVED"));

  const staleInvite = await createBuyerQualificationPortalInvite(b.id,{version:selfReported.version},actor,now);
  const afterInvite = await getBuyerRecord(b.id,db,now);
  const afterOrdinaryEdit = await updateBuyer(b.id,{
    version:afterInvite.version,name:afterInvite.name,email:afterInvite.email,phone:afterInvite.phone,
    source:afterInvite.source,criteria:afterInvite.criteria,status:afterInvite.status,
    destinationKind:afterInvite.destinationKind,qualifiedDealFee:afterInvite.qualifiedDealFee??null,
    feeTermsSource:afterInvite.feeTermsSource??"",
  },actor);
  await assert.rejects(getBuyerQualificationPortal(staleInvite.token,now),/profile changed after the link was created/);
  const replacedInvite = await createBuyerQualificationPortalInvite(b.id,{version:afterOrdinaryEdit.version},actor,now);
  const newestInvite = await createBuyerQualificationPortalInvite(b.id,{version:afterOrdinaryEdit.version+1},actor,now);
  await assert.rejects(getBuyerQualificationPortal(replacedInvite.token,now),/invalid or no longer active/);
  await assert.rejects(getBuyerQualificationPortal(newestInvite.token,new Date(Date.parse(newestInvite.expiresAt)+1)),/has expired/);
  await new Promise<void>((resolve,reject) => apiServer.close((error) => error ? reject(error) : resolve()));
  console.log("Synthetic buyer qualification portal exercise PASSED (persisted one-time link, owner gate, criteria carry-forward, replay/stale/replace/expiry, no automatic approval).");

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
    if (p.id===b.id) continue; // This synthetic portal subject deliberately submitted criteria above.
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
  const versionBeforePoolReview = (await getBuyerRecord(b.id,db,now)).version;
  await reviewBuyerPool(now);
  assert.equal((await allBuyerRecords(db,now)).find(p=>p.id===b.id)?.version,versionBeforePoolReview,"Pending qualification is not re-created every tick");
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