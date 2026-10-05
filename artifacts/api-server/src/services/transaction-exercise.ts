import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db,pool,contractsTable,jobsTable,matchesTable,buyersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import * as seller from "./deal-store";
import { exerciseEvidence } from "./exercise-evidence";
import * as offers from "./offer-store";
import * as transactions from "./transaction-store";
import * as buyers from "./buyer-store";
import { dealOperations,refreshMatches } from "./matching-store";
import { submitWorkerJob,runWorkerOnce } from "./workers";
import { commandCenter } from "./command-center";
import { CLOSING_MILESTONES } from "@workspace/deal-domain";
import { recordTransactionException } from "./transaction-exceptions";
import { reviewHandoffs, listHandoffs, recordHandoffEvent } from "./handoffs";
import { getBuyerRecord } from "./operations-records";
import { requestBuyerQualification } from "./buyer-pool";
const actor = {id:`synthetic-transaction:${randomUUID()}`,role:"OWNER"};
const operator = {...actor,role:"OPERATOR"};
const now = new Date();
const future = (days:number)=>new Date(now.getTime()+days*86400000).toISOString();
try {
  // All these writes are isolated by the harness's connection-wide search path.
  let lead = await seller.createLead({address:"SYNTHETIC COMPLETE DEAL",city:"Synthetic City",state:"TX",county:"Synthetic County",zip:"75001",
    propertyType:"SINGLE_FAMILY",sqft:1000,beds:3,baths:2,units:1,askingPrice:100000,
    sellerName:"SYNTHETIC ONLY",sellerPhone:"000-000-0000",source:"Synthetic service exercise, not a real deal"},actor.id,now);
  const id = lead.id;
  const authority = await seller.addIntelligence(id,{classification:"VERIFIED_FACTS",category:"ownership",
    statement:"Synthetic record owner",source:"Synthetic public-record test fixture",sourceType:"PUBLIC_RECORD",confidence:0.9,
    capturedAt:now.toISOString(),verificationNote:"Synthetic comparison only, not actual ownership evidence."},actor.id,now);
  let detail = await seller.leadDetail(id);
  const uw = {version:detail.lead.version,repairsComplete:true,conditionConfirmed:true,
    comps:[290000,300000,310000].map((salePrice,i)=>({id:`synthetic-comp-${i}`,address:`SYNTHETIC COMP ${i}`,sqft:1000,
      salePrice,soldAt:new Date(now.getTime()-10*86400000).toISOString().slice(0,10),distanceMiles:0.5,
      propertyType:"SINGLE_FAMILY" as const,condition:"RENOVATED" as const,source:"Synthetic sold-property fixture",verified:true})),
    repairs:[{category:"Synthetic repairs",low:10000,expected:20000,high:30000,confidence:0.8,source:"Synthetic repair scope"}]};
  Object.assign(uw,await exerciseEvidence(id,uw,actor.id,now));
  detail = await seller.saveUnderwriting(id,uw,actor.id,now);
  detail = await seller.transitionLead(id,{version:detail.lead.version,to:"CALL_READY",reason:"Synthetic research complete.",nextAction:"Synthetic call."},actor.id,now);
  detail = await seller.recordCall(id,{version:detail.lead.version,outcome:"CONNECTED",notes:"Synthetic conversation, no external call.",nextAction:"Review terms.",followUpAt:future(1)},actor.id,now);
  detail = await offers.createOfferDraft(id,{version:detail.lead.version,amount:110000,earnestMoney:1000,closingDays:30,
    contingencies:"Synthetic title and diligence",assignmentIntent:true,reason:"Synthetic terms"},actor,now);
  const offerId = detail.offers[0]!.id;
  detail = await offers.authorizeOffer(id,offerId,{version:detail.lead.version,maximumApprovedAcquisitionPrice:120000,
    authorityEvidenceId:authority.id,expiresAt:future(2),reason:"Synthetic owner review",nextAction:"Synthetic exact terms",followUpAt:future(1)},actor,now);
  detail = await offers.communicateOffer(id,offerId,{version:detail.lead.version,amount:110000,channel:"PHONE",
    evidence:"Synthetic human communication only.",nextAction:"Prepare contract.",followUpAt:future(1)},operator,now);
  const approvedSnapshot = detail.analysisSnapshotId;
  await seller.addIntelligence(id,{classification:"AI_HYPOTHESIS",category:"prepared_questions",statement:"The seller may value clear coordination.",
    source:"Synthetic model-only test",sourceType:"MODEL",confidence:0.4,capturedAt:now.toISOString(),
    question:"What coordination would help?",action:"Ask the seller and record the actual answer."},actor.id,now);
  detail = await seller.leadDetail(id);
  assert.equal(detail.analysisSnapshotId,approvedSnapshot);
  assert.equal(detail.offers[0]?.effectiveStatus,"COMMUNICATED");
  await assert.rejects(transactions.createContract(id,{version:detail.lead.version,offerId,closingAt:future(31)},operator,now),/approved closing/);
  let op = await transactions.createContract(id,{version:detail.lead.version,offerId,closingAt:future(20)},operator,now);
  assert.equal(op.contract?.status,"DRAFT"); assert.equal(op.contract?.purchasePrice,110000);
  const execute = {version:op.contract!.version,executedDocumentUrl:"https://example.com/synthetic-contract",
    sellerSignedAt:now.toISOString(),acquisitionSignedAt:now.toISOString(),reviewNote:"Synthetic owner verification, not real signatures."};
  await assert.rejects(transactions.executeContract(id,execute,operator,now),e=>(e as {status:number}).status===403);
  await assert.rejects(transactions.executeContract(id,{...execute,sellerSignedAt:future(1)},actor,now),/future/);
  // Recording after approval expiry is allowed ONLY for historically valid signatures.
  op = await transactions.executeContract(id,execute,actor,new Date(now.getTime()+3*86400000));
  assert.equal(op.contract?.status,"UNDER_CONTRACT");
  assert.equal((await seller.leadDetail(id)).lead.stage,"UNDER_CONTRACT");
  detail = await seller.leadDetail(id);
  await assert.rejects(seller.recordCall(id,{version:detail.lead.version,outcome:"NOT_INTERESTED",notes:"Synthetic only.",nextAction:"Try to cancel.",followUpAt:future(1)},actor.id,now),/cannot cancel/);
  detail = await seller.recordCall(id,{version:detail.lead.version,outcome:"CONNECTED",notes:"Synthetic closing coordination; no external call.",
    nextAction:"Confirm escrow status.",followUpAt:future(1)},actor.id,now);
  assert.equal(detail.lead.stage,"UNDER_CONTRACT");
  assert.equal((await dealOperations(id,now)).contract?.purchasePrice,110000);
  let buyer = await buyers.createBuyer({name:"SYNTHETIC QUALIFIED BUYER",email:"synthetic@example.com",phone:"",
    source:"Synthetic service exercise",status:"ACTIVE",criteria:{states:["TX"],cities:["Synthetic City"],zipCodes:[],
      propertyTypes:["SINGLE_FAMILY"],maxPurchasePrice:200000,maxRepairs:50000,minBeds:2,minSqft:500,maxSqft:2000,closingDays:3,
      counties:[],excludedCounties:[],excludedCities:[],excludedZipCodes:[],minPurchasePrice:0,minUnits:1,maxUnits:1,
      minBaths:1,rehabTolerance:"HEAVY",strategies:["FLIP"],fundingTypes:["CASH"],maxConcurrentDeals:2}},actor);
  op = await refreshMatches(id,now);
  assert.equal(op.matches.find(m=>m.buyerId===buyer.id)?.eligible,false);
   await reviewHandoffs(now);
   buyer = await getBuyerRecord(buyer.id,db,now);
   const qualificationHandoff = (await listHandoffs()).find(h=>h.subjectId===buyer.id)!;
   await recordHandoffEvent(qualificationHandoff.id,{version:qualificationHandoff.version,eventKey:"synthetic-qualification-contact",
     kind:"CONTACTED",occurredAt:now.toISOString(),evidenceUrl:"https://example.com/synthetic-contact",note:"SYNTHETIC contact fixture, no message sent.",
     channel:"EMAIL",routeValue:"synthetic@example.com",permissionEvidenceUrl:"https://example.com/synthetic-permission",followUpAt:future(1)},operator,now);
   const verificationInput = {version:buyer.version,verifiedFundingTypes:["CASH" as const],identityEvidenceUrl:"https://example.com/synthetic-id",
    fundingEvidenceUrl:"https://example.com/synthetic-funds",availableFunds:200000,verificationNote:"Synthetic review, not real bank proof.",
     evidenceAt:now.toISOString(),validUntil:future(25),currentBuyingStatus:"BUYING" as const,buyingEvidenceAt:new Date(now.getTime()-1000).toISOString(),
    buyingEvidenceUrl:"https://example.com/synthetic-buying",criteriaEvidenceUrl:"https://example.com/synthetic-criteria",
     verificationSource:"Synthetic investor response",confidence:0.9};
   buyer = await buyers.verifyBuyer(buyer.id,verificationInput,actor,now);
  const job = await submitWorkerJob({kind:"MATCH_BUYERS",leadId:id,idempotencyKey:"synthetic-matching-once"},actor);
  assert.equal((await submitWorkerJob({kind:"MATCH_BUYERS",leadId:id,idempotencyKey:"synthetic-matching-once"},actor)).id,job.id);
  const races = await Promise.all([runWorkerOnce(now,false,job.id),runWorkerOnce(now,false,job.id)]);
  assert.equal(races.filter(Boolean).length,1);
  assert.equal(races.find(Boolean)?.state,"SUCCEEDED");
  assert.equal((await db.select().from(jobsTable).where(eq(jobsTable.id,job.id)))[0]?.attempts,1);
  op = await dealOperations(id,now);
  assert.equal(op.matches.find(m=>m.buyerId===buyer.id)?.eligible,true);
  assert.equal((await seller.leadDetail(id)).lead.stage,"BUYER_MATCHED");
   await reviewHandoffs(now);
   const stoppedQualification = (await listHandoffs()).find(h=>h.id===qualificationHandoff.id)!;
   assert.equal(stoppedQualification.state,"CANCELLED");
   buyer = await requestBuyerQualification(buyer.id,{version:buyer.version,note:"SYNTHETIC explicit additional evidence before committing."},actor,now);
   await reviewHandoffs(now);
   const replacementTaskId = buyer.qualificationTask!.id;
   assert.ok((await listHandoffs()).some(h=>h.subjectId===buyer.id&&h.contextKey===replacementTaskId&&h.state==="WAITING_CONTACT"));
   const retainedReply = await recordHandoffEvent(stoppedQualification.id,{version:stoppedQualification.version,eventKey:"synthetic-new-buying-reply",
     kind:"REPLIED",occurredAt:now.toISOString(),evidenceUrl:"https://example.com/synthetic-new-reply",
     note:"SYNTHETIC newer actual-response fixture, requires current evidence review."},operator,now);
   assert.equal(retainedReply.state,"CANCELLED","Late reply must not reactivate stopped outreach.");
   buyer = await getBuyerRecord(buyer.id,db,now);
   assert.equal(buyer.approvalStatus,"QUALIFICATION_REQUIRED");
   assert.equal(buyer.qualificationTask?.id,replacementTaskId);
   assert.equal(buyer.qualificationTask?.state,"WAITING_REVIEW","Late reply to older outreach must pause the current evidence request.");
   await reviewHandoffs(now);
   assert.equal((await getBuyerRecord(buyer.id,db,now)).qualificationTask?.state,"WAITING_REVIEW");
   op = await refreshMatches(id,now);
   assert.equal(op.matches.find(m=>m.buyerId===buyer.id)?.eligible,false);
   assert.equal(op.contract?.purchasePrice,110000);
   await assert.rejects(buyers.verifyBuyer(buyer.id,{...verificationInput,version:buyer.version},actor,now),/newer actual outreach reply/);
   buyer = await buyers.verifyBuyer(buyer.id,{...verificationInput,version:buyer.version,buyingEvidenceAt:now.toISOString()},actor,now);
   op = await refreshMatches(id,now);
   assert.equal(op.matches.find(m=>m.buyerId===buyer.id)?.eligible,true);
  let destination = await buyers.createBuyer({name:"SYNTHETIC GURU DESTINATION",email:"synthetic-guru@example.com",phone:"",
    source:"Synthetic destination exercise",status:"ACTIVE",destinationKind:"GURU",qualifiedDealFee:500,feeTermsSource:"Synthetic quoted terms, not receipt",
    criteria:buyer.criteria},actor);
  destination = await buyers.verifyBuyer(destination.id,{version:destination.version,identityEvidenceUrl:"https://example.com/synthetic-guru-id",
    verificationNote:"Synthetic destination identity/criteria review; no bank or payment claim.",evidenceAt:now.toISOString(),validUntil:future(25),
    currentBuyingStatus:"BUYING",buyingEvidenceAt:now.toISOString(),buyingEvidenceUrl:"https://example.com/synthetic-guru-accepting",
    criteriaEvidenceUrl:"https://example.com/synthetic-guru-criteria",verificationSource:"Synthetic reviewed destination",confidence:0.9},actor,now);
  assert.equal(destination.approvalStatus,"APPROVED");
  op = await transactions.recordBuyerResponse(id,destination.id,{version:op.contract!.version,buyerVersion:destination.version,
    status:"INTERESTED",evidence:"Synthetic destination interest, not end-buyer commitment."},operator,now);
  assert.equal((await seller.leadDetail(id)).lead.stage,"BUYER_MATCHED","Destination interest must not impersonate buyer interest");
  await assert.rejects(transactions.recordBuyerResponse(id,destination.id,{version:op.contract!.version,buyerVersion:destination.version,
    status:"COMMITTED",evidence:"Synthetic attempt to commit a non-acquisition destination.",agreedPrice:130000,
    commitmentEvidenceUrl:"https://example.com/synthetic-invalid-destination-commitment"},actor,now),/cannot commit/);
  op = await transactions.recordBuyerResponse(id,buyer.id,{version:op.contract!.version,buyerVersion:buyer.version,status:"INTERESTED",evidence:"Synthetic actual-interest attestation."},operator,now);
  const commitment = {version:op.contract!.version,buyerVersion:buyer.version,status:"COMMITTED" as const,
    evidence:"Synthetic owner commitment review.",commitmentEvidenceUrl:"https://example.com/synthetic-assignment",agreedPrice:130000};
  await assert.rejects(transactions.recordBuyerResponse(id,buyer.id,commitment,operator,now),e=>(e as {status:number}).status===403);
  await assert.rejects(transactions.recordBuyerResponse(id,buyer.id,{...commitment,agreedPrice:100000},actor,now));
  op = await transactions.recordBuyerResponse(id,buyer.id,commitment,actor,now);
  assert.equal(op.contract?.agreedBuyerPrice,130000);
  const amend = {version:op.contract!.version,kind:"AMEND_CLOSING" as const,effectiveAt:now.toISOString(),
    newClosingAt:future(4),evidenceUrl:"https://example.com/synthetic-amendment",note:"SYNTHETIC signed date amendment, no real agreement."};
  await assert.rejects(recordTransactionException(id,amend,operator,now),e=>(e as {status:number}).status===403);
  await assert.rejects(recordTransactionException(id,amend,actor,now),/buyer consent/);
  op = await recordTransactionException(id,{...amend,buyerConsentEvidenceUrl:"https://example.com/synthetic-buyer-consent"},actor,now);
  assert.equal(op.contract?.closingAt,future(4)); assert.equal(op.contract?.purchasePrice,110000);
  assert.equal(op.contract?.history?.[0]?.previousState.closingAt,future(20));
  op = await transactions.recordClosingMilestone(id,{version:op.contract!.version,kind:"ASSIGNMENT_SIGNED",
    evidenceUrl:"https://example.com/synthetic-old-assignment",note:"SYNTHETIC former buyer assignment."},actor,now);
  const oldBuyerId = buyer.id;
  op = await recordTransactionException(id,{version:op.contract!.version,kind:"RELEASE_BUYER",buyerId:oldBuyerId,
    effectiveAt:now.toISOString(),evidenceUrl:"https://example.com/synthetic-release",note:"SYNTHETIC externally reviewed release only."},actor,now);
  assert.equal(op.contract?.committedBuyerId,null);
  assert.ok(!op.contract?.milestones.some(m=>m.kind==="ASSIGNMENT_SIGNED"));
  assert.ok(op.contract?.history?.some(h=>h.kind==="RELEASE_BUYER"&&h.previousState.committedBuyerId===oldBuyerId));
  buyer = await buyers.createBuyer({name:"SYNTHETIC REPLACEMENT",email:"replacement@example.com",phone:"",
    source:"SYNTHETIC replacement fixture",status:"ACTIVE",criteria:buyer.criteria},actor);
  buyer = await buyers.verifyBuyer(buyer.id,{version:buyer.version,verifiedFundingTypes:["CASH"],identityEvidenceUrl:"https://example.com/synthetic-replacement-id",
    fundingEvidenceUrl:"https://example.com/synthetic-replacement-funds",availableFunds:200000,verificationNote:"SYNTHETIC replacement review only.",
    evidenceAt:now.toISOString(),validUntil:future(25),currentBuyingStatus:"BUYING",buyingEvidenceAt:now.toISOString(),
    buyingEvidenceUrl:"https://example.com/synthetic-replacement-buying",criteriaEvidenceUrl:"https://example.com/synthetic-replacement-criteria",
    verificationSource:"SYNTHETIC response",confidence:0.9},actor,now);
  op = await transactions.recordBuyerResponse(id,buyer.id,{version:op.contract!.version,buyerVersion:buyer.version,status:"INTERESTED",
    evidence:"SYNTHETIC replacement actual-interest fixture."},operator,now);
  op = await transactions.recordBuyerResponse(id,buyer.id,{...commitment,version:op.contract!.version,buyerVersion:buyer.version,
    commitmentEvidenceUrl:"https://example.com/synthetic-replacement-assignment"},actor,now);
  assert.equal(op.contract?.committedBuyerId,buyer.id);
  const before = await seller.leadDetail(id);
  await seller.addIntelligence(id,{classification:"OBSERVED",category:"condition",statement:"Synthetic new research",
    source:"Synthetic independent observation",sourceType:"INSPECTION",confidence:0.8,capturedAt:now.toISOString()},actor.id,now);
  detail = await seller.leadDetail(id);
  assert.equal(detail.lead.stage,"BUYER_COMMITTED");
  assert.equal(detail.analysis,null);
  assert.equal((await dealOperations(id,now)).matches.find(m=>m.buyerId===buyer.id)?.eligible,false);
  detail = await seller.saveUnderwriting(id,{...uw,version:detail.lead.version},actor.id,now);
  assert.equal(detail.lead.stage,"BUYER_COMMITTED");
  assert.equal((await dealOperations(id,now)).contract?.purchasePrice,110000);
  const outcome = {version:op.contract!.version,outcome:"CLOSED" as const,evidenceUrl:"https://example.com/synthetic-settlement",
    note:"Synthetic reconciliation only, not actual funds.",assignmentFeeReceived:20000,closingCosts:2000};
  await assert.rejects(transactions.recordDealOutcome(id,outcome,actor,now),/Missing evidence/);
  for (const kind of CLOSING_MILESTONES) {
    op = await transactions.recordClosingMilestone(id,{version:op.contract!.version,kind,
      evidenceUrl:`https://example.com/synthetic-${kind.toLowerCase()}`,note:"Synthetic reviewed evidence, no actual escrow activity."},actor,now);
  }
  await assert.rejects(transactions.recordDealOutcome(id,{...outcome,version:op.contract!.version,assignmentFeeReceived:19999},actor,now),/reconcile/);
   // An actual response can predate settlement even when entered afterwards.
   // A recorded-time-only check must not ignore that contradiction.
   const [beforeLateReply] = await db.select().from(buyersTable).where(eq(buyersTable.id,buyer.id));
   assert.ok(beforeLateReply);
   await db.update(buyersTable).set({payload:{...beforeLateReply.payload,lastOutreachReplyAt:future(1),
     lastOutreachReplyEvidenceUrl:"https://example.com/synthetic-late-entered-reply"},
     version:beforeLateReply.version+1,updatedAt:new Date(future(5))}).where(eq(buyersTable.id,buyer.id));
   await assert.rejects(transactions.recordDealOutcome(id,{...outcome,version:op.contract!.version,occurredAt:future(2)},
     actor,new Date(future(5))),/reply predating settlement/);
   await db.update(buyersTable).set({payload:beforeLateReply.payload,version:beforeLateReply.version,updatedAt:beforeLateReply.updatedAt})
     .where(eq(buyersTable.id,buyer.id));
  op = await transactions.recordDealOutcome(id,{...outcome,version:op.contract!.version,occurredAt:future(2)},actor,new Date(now.getTime()+5*86400000));
  assert.equal(op.contract?.status,"CLOSED"); assert.equal(op.contract?.netProceeds,18000);
  assert.equal(op.contract?.closedAt,future(2)); assert.equal(op.contract?.outcomeRecordedAt,future(5));
  assert.equal((await seller.leadDetail(id)).lead.stage,"CLOSED");
  assert.ok(!(await commandCenter("OWNER",now)).actions.some(a=>a.leadId===id));
  await assert.rejects(transactions.recordDealOutcome(id,{...outcome,version:op.contract!.version},actor,now));
  const deadline = await submitWorkerJob({kind:"REVIEW_DEADLINES",idempotencyKey:"synthetic-deadlines-once"},actor);
  assert.equal((await runWorkerOnce(now,false,deadline.id))?.state,"SUCCEEDED");
  const fail = await submitWorkerJob({kind:"MATCH_BUYERS",leadId:id,idempotencyKey:"synthetic-terminal-failure"},actor);
  assert.equal((await runWorkerOnce(now,false,fail.id))?.state,"FAILED");
  const restart = {version:op.contract!.version,kind:"RESTART_CANCELLED" as const,effectiveAt:now.toISOString(),
    evidenceUrl:"https://example.com/synthetic-restart",note:"SYNTHETIC reviewed attempt restart only."};
  await assert.rejects(recordTransactionException(id,restart,actor,now),/Only an evidenced cancelled/);
  // A separate cancelled agreement restarts through real authority/underwriting
  // commands, never by deleting prior contracts or reusing its old authorization.
  let next = await seller.createLead({address:"SYNTHETIC CANCELLED ATTEMPT",city:"Synthetic City",state:"TX",county:"Synthetic County",zip:"75001",
    propertyType:"SINGLE_FAMILY",sqft:1000,beds:3,baths:2,units:1,askingPrice:100000,sellerName:"SYNTHETIC ONLY",sellerPhone:"000-000-0000",
    source:"SYNTHETIC restart exercise"},actor.id,now);
  const nextId = next.id;
  const nextAuthority = await seller.addIntelligence(nextId,{classification:"VERIFIED_FACTS",category:"ownership",
    statement:"SYNTHETIC owner fixture",source:"SYNTHETIC public record",sourceType:"PUBLIC_RECORD",confidence:0.9,
    sourceUrl:"https://example.com/synthetic-owner",capturedAt:now.toISOString(),verificationNote:"SYNTHETIC fixture only."},actor.id,now);
  const newUw = await exerciseEvidence(nextId,{...uw,version:(await seller.leadDetail(nextId)).lead.version},actor.id,now);
  async function prepareNewAttempt() {
    let d = await seller.leadDetail(nextId,undefined,now);
    d = await seller.saveUnderwriting(nextId,{...newUw,version:d.lead.version},actor.id,now);
    d = await seller.transitionLead(nextId,{version:d.lead.version,to:"CALL_READY",reason:"SYNTHETIC refreshed evidence",nextAction:"Synthetic call."},actor.id,now);
    d = await seller.recordCall(nextId,{version:d.lead.version,outcome:"CONNECTED",notes:"SYNTHETIC new-attempt conversation.",
      nextAction:"Review fresh exact terms.",followUpAt:future(1)},actor.id,now);
    d = await offers.createOfferDraft(nextId,{version:d.lead.version,amount:110000,earnestMoney:1000,closingDays:30,
      contingencies:"SYNTHETIC review",assignmentIntent:true,reason:"SYNTHETIC separate new offer"},actor,now);
    const newOffer = d.offers.find(o=>o.status==="DRAFT")!;
    d = await offers.authorizeOffer(nextId,newOffer.id,{version:d.lead.version,maximumApprovedAcquisitionPrice:120000,authorityEvidenceId:nextAuthority.id,
      expiresAt:future(2),reason:"SYNTHETIC new approval",nextAction:"Record new exact communication.",followUpAt:future(1)},actor,now);
    d = await offers.communicateOffer(nextId,newOffer.id,{version:d.lead.version,amount:110000,channel:"PHONE",
      evidence:"SYNTHETIC communication, not actual outreach.",nextAction:"Record agreement.",followUpAt:future(1)},operator,now);
    return transactions.createContract(nextId,{version:d.lead.version,offerId:newOffer.id,closingAt:future(20)},operator,now);
  }
  let restarted = await prepareNewAttempt();
  restarted = await transactions.executeContract(nextId,{...execute,version:restarted.contract!.version},actor,now);
  const priorOfferId = restarted.contract!.offerId;
  restarted = await transactions.recordDealOutcome(nextId,{version:restarted.contract!.version,outcome:"CANCELLED",
    evidenceUrl:"https://example.com/synthetic-cancel",note:"SYNTHETIC externally documented cancellation."},actor,now);
  assert.equal((await seller.leadDetail(nextId)).lead.stage,"DEAD_DEAL");
  await assert.rejects(recordTransactionException(nextId,{...restart,version:restarted.contract!.version},operator,now),e=>(e as {status:number}).status===403);
  restarted = await recordTransactionException(nextId,{...restart,version:restarted.contract!.version},actor,now);
  assert.equal((await seller.leadDetail(nextId)).lead.stage,"ENRICHING");
  assert.equal(restarted.contract?.status,"CANCELLED");
  assert.equal((await seller.leadDetail(nextId)).analysis,null);
  const retained = restarted.contract!.history?.length;
  restarted = await prepareNewAttempt();
  assert.equal(restarted.contract?.attemptNumber,2);
  assert.notEqual(restarted.contract?.offerId,priorOfferId);
  assert.ok(restarted.contract?.history!.length!>retained!);
  assert.ok(restarted.contract?.history?.some(h=>h.kind==="CANCELLED_ATTEMPT"&&h.previousState.outcomeEvidenceUrl==="https://example.com/synthetic-cancel"));
  assert.equal((await db.select().from(contractsTable).where(eq(contractsTable.leadId,nextId))).length,1);
  assert.equal((await seller.leadDetail(nextId)).offers.length,2);
  logger.info("Cancellation/restart PASSED: owner-only, fresh underwriting/approval/communication, distinct attempt, original cancellation/signatures/terms/buyer history retained; CLOSED cannot reopen.");
  logger.info({checks:"approved terms → draft → historically authorized late execution → matching; leases; owner/buyer-consented amendment; evidenced release archives old assignment → verified replacement → commitment; refreshed research preserves lifecycle; four milestones; late evidenced settlement preserves actual/recorded times; reconciliation and terminal guards"},"Full lifecycle persistence exercise PASSED (isolated synthetic schema)");
} finally { await pool.end(); }