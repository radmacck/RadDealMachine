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
import {
  authorizeDealDistribution, getBuyerPortalDeal, getDealDistribution,
  releaseDistributionAcceptance, respondToBuyerPortalDeal, shareDistributionRecipients,
} from "./distribution-store";
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
   let qualificationHandoff = (await listHandoffs()).find(h=>h.subjectId===buyer.id)!;
   qualificationHandoff = await recordHandoffEvent(qualificationHandoff.id,{version:qualificationHandoff.version,eventKey:"synthetic-qualification-route",
     kind:"ROUTE_REVIEWED",occurredAt:now.toISOString(),evidenceUrl:"https://example.com/synthetic-permission",note:"SYNTHETIC permitted route fixture.",
     channel:"EMAIL",routeValue:"synthetic@example.com",permissionEvidenceUrl:"https://example.com/synthetic-permission"},operator,now);
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
  let competitor = await buyers.createBuyer({name:"SYNTHETIC SECOND QUALIFIED BUYER",email:"synthetic-second@example.com",phone:"",
    source:"Synthetic first-commitment ordering fixture",status:"ACTIVE",criteria:buyer.criteria},actor);
  competitor = await buyers.verifyBuyer(competitor.id,{...verificationInput,version:competitor.version},actor,now);
  op = await refreshMatches(id,now);
  assert.equal(op.matches.find(m=>m.buyerId===competitor.id)?.eligible,true);
    const distribution = await authorizeDealDistribution(id,{version:op.contract!.version,
      reason:"Synthetic owner authorization for isolated distribution exercise."},actor,now);
    assert.ok(distribution.packetId);
    const expectedBuyerPrice=op.contract!.purchasePrice+op.contract!.assignmentTarget;
    assert.equal(distribution.packet?.economics.buyerPrice,expectedBuyerPrice);
    const shared = await shareDistributionRecipients(distribution.packetId!,{version:distribution.version,buyerIds:[buyer.id,competitor.id]},operator,now);
    assert.equal(shared.links.length,2);
    const portalToken = shared.links.find(link=>link.buyerId===buyer.id)!.token;
    const portal = await getBuyerPortalDeal(portalToken,now);
    assert.equal(portal.packet.economics.buyerPrice,expectedBuyerPrice);
    assert.equal(JSON.stringify(portal).includes(detail.lead.address),false,"The public buyer packet must not expose the street address.");
    assert.equal(JSON.stringify(portal).includes(detail.lead.sellerName),false,"The public buyer packet must not expose seller identity.");
    const interest = {eventKey:"synthetic-portal-interest",action:"INTERESTED" as const,note:"Synthetic interest, no external contact."};
    let portalResult = await respondToBuyerPortalDeal(portalToken,interest,now);
    assert.equal(portalResult.recipientStatus,"INTERESTED");
    portalResult = await respondToBuyerPortalDeal(portalToken,interest,now);
    assert.equal(portalResult.events.length,1,"An identical portal event retry must not duplicate activity.");
    await assert.rejects(respondToBuyerPortalDeal(portalToken,{...interest,action:"DECLINED"},now),/different response/);
    portalResult = await respondToBuyerPortalDeal(portalToken,{eventKey:"synthetic-portal-accept",action:"ACCEPTED"},now);
    assert.equal(portalResult.recipientStatus,"ACCEPTED");
    assert.equal(portalResult.canAccept,false);
    const afterPortalAcceptance = await dealOperations(id,now);
    assert.equal(afterPortalAcceptance.matches.find(m=>m.buyerId===buyer.id)?.status,"INTERESTED",
      "Portal interest/acceptance must propagate to the persisted buyer match without re-entry.");
    assert.equal((await seller.leadDetail(id)).lead.stage,"BUYER_INTERESTED");
    assert.ok(!(await dealOperations(id,now)).contract?.committedBuyerId,
      "A portal acceptance is intent only; it must not create a buyer commitment.");
    const held = await getDealDistribution(id);
    assert.equal(held.status,"FIRST_ACCEPTED");
    op=await transactions.recordBuyerResponse(id,competitor.id,{version:afterPortalAcceptance.contract!.version,
      buyerVersion:competitor.version,status:"INTERESTED",evidence:"Synthetic second buyer response."},operator,now);
    await assert.rejects(transactions.recordBuyerResponse(id,competitor.id,{
      version:op.contract!.version,buyerVersion:competitor.version,status:"COMMITTED",
      evidence:"Synthetic attempt to bypass first qualified acceptance.",agreedPrice:130000,
      commitmentEvidenceUrl:"https://example.com/synthetic-second-assignment",
    },actor,now),/different qualified buyer accepted the current package first/);
    await releaseDistributionAcceptance(id,{version:held.version,reason:"Synthetic owner review completed without assignment."},actor,now);
    assert.equal((await getDealDistribution(id)).status,"ACTIVE");
  let destination = await buyers.createBuyer({name:"SYNTHETIC GURU DESTINATION",email:"synthetic-guru@example.com",phone:"",
    source:"Synthetic destination exercise",status:"ACTIVE",destinationKind:"GURU",qualifiedDealFee:500,feeTermsSource:"Synthetic quoted terms, not receipt",
    criteria:buyer.criteria},actor);
  destination = await buyers.verifyBuyer(destination.id,{version:destination.version,identityEvidenceUrl:"https://example.com/synthetic-guru-id",
    verificationNote:"Synthetic destination identity/criteria review; no bank or payment claim.",evidenceAt:now.toISOString(),validUntil:future(25),
    currentBuyingStatus:"BUYING",buyingEvidenceAt:now.toISOString(),buyingEvidenceUrl:"https://example.com/synthetic-guru-accepting",
    criteriaEvidenceUrl:"https://example.com/synthetic-guru-criteria",verificationSource:"Synthetic reviewed destination",confidence:0.9},actor,now);
  assert.equal(destination.approvalStatus,"APPROVED");
   const destinationSubmission = {version:op.contract!.version,buyerVersion:destination.version,eventKey:"synthetic-guru-submission",
     kind:"SUBMITTED" as const,occurredAt:now.toISOString(),evidenceUrl:"https://example.com/synthetic-guru-submission",
     note:"SYNTHETIC opportunity submission; no external message sent by the system."};
   op = await transactions.recordDestinationActivity(id,destination.id,destinationSubmission,operator,now);
   assert.equal(op.contract?.destinationActivityHistory?.length,1);
   assert.equal(op.contract?.destinationActivityHistory?.[0]?.feeAmount,null,"A profile quote is not a recorded receipt.");
   const submittedVersion = op.contract!.version;
   op = await transactions.recordDestinationActivity(id,destination.id,destinationSubmission,operator,now);
   assert.equal(op.contract?.version,submittedVersion,"An identical event-key retry must not append or re-version.");
   await assert.rejects(transactions.recordDestinationActivity(id,destination.id,{...destinationSubmission,note:"SYNTHETIC changed command on reused event key."},operator,now),/different destination activity/);
   await assert.rejects(transactions.recordDestinationActivity(id,destination.id,{...destinationSubmission,eventKey:"synthetic-stale-event",
     version:submittedVersion-1},operator,now),e=>(e as {status:number}).status===409);
   const acknowledgement = {version:op.contract!.version,buyerVersion:destination.version,eventKey:"synthetic-guru-ack",
     kind:"ACKNOWLEDGED" as const,occurredAt:now.toISOString(),evidenceUrl:"https://example.com/synthetic-guru-ack",
     note:"SYNTHETIC destination confirmed receipt.",relatedEventKey:destinationSubmission.eventKey};
   op = await transactions.recordDestinationActivity(id,destination.id,acknowledgement,operator,now);
   const termsReview = {version:op.contract!.version,buyerVersion:destination.version,eventKey:"synthetic-guru-terms-reviewed",
     kind:"TERMS_REVIEWED" as const,occurredAt:now.toISOString(),evidenceUrl:"https://example.com/synthetic-guru-terms",
     note:"SYNTHETIC owner reviewed exact referral terms.",exactTerms:"USD 500 only if the evidenced referral results in the described transaction.",
     relatedEventKey:acknowledgement.eventKey};
   await assert.rejects(transactions.recordDestinationActivity(id,destination.id,termsReview,operator,now),e=>(e as {status:number}).status===403);
   op = await transactions.recordDestinationActivity(id,destination.id,termsReview,actor,now);
   const termsAccepted = {version:op.contract!.version,buyerVersion:destination.version,eventKey:"synthetic-guru-terms-accepted",
     kind:"TERMS_ACCEPTED" as const,occurredAt:now.toISOString(),evidenceUrl:"https://example.com/synthetic-guru-terms-acceptance",
     note:"SYNTHETIC exact referral terms accepted with owner review.",exactTerms:termsReview.exactTerms,
     relatedEventKey:termsReview.eventKey};
   op = await transactions.recordDestinationActivity(id,destination.id,termsAccepted,actor,now);
   assert.equal(op.contract?.destinationActivityHistory?.length,4);
   const feeReceivedDetails = {buyerVersion:destination.version,eventKey:"synthetic-guru-fee-received",kind:"FEE_RECEIVED" as const,
     occurredAt:future(3),evidenceUrl:"https://example.com/synthetic-guru-fee-receipt",
     note:"SYNTHETIC evidenced receipt after acquisition closing for isolated exercise only.",feeAmount:500,currency:"USD",
     relatedEventKey:termsAccepted.eventKey};
   await assert.rejects(transactions.recordDestinationActivity(id,destination.id,{...feeReceivedDetails,version:op.contract!.version},operator,
     new Date(future(5))),e=>(e as {status:number}).status===403);
   assert.equal(op.contract?.assignmentFeeReceived??null,null,"A quoted fee is not automatically recorded as received.");
   assert.equal(op.contract?.committedBuyerId??null,null);
   assert.equal((await seller.leadDetail(id)).lead.stage,"BUYER_INTERESTED","Destination activity must not alter the separately recorded buyer portal interest.");
   assert.equal(op.matches.find(m=>m.buyerId===destination.id)?.status,"MATCHED");
   await assert.rejects(transactions.recordBuyerResponse(id,destination.id,{version:op.contract!.version,buyerVersion:destination.version,
     status:"INTERESTED",evidence:"Synthetic destination interest must not use buyer response."},operator,now),/separate destination history/);
   await assert.rejects(transactions.recordBuyerResponse(id,destination.id,{version:op.contract!.version,buyerVersion:destination.version,
     status:"COMMITTED",evidence:"Synthetic attempt to commit a non-acquisition destination.",agreedPrice:130000,
     commitmentEvidenceUrl:"https://example.com/synthetic-invalid-destination-commitment"},actor,now),/separate destination history/);
  assert.equal(op.matches.find(m=>m.buyerId===buyer.id)?.status,"INTERESTED","The portal response already created the buyer-interest record; no duplicate manual entry is needed.");
  const commitment = {version:op.contract!.version,buyerVersion:buyer.version,status:"COMMITTED" as const,
    evidence:"Synthetic owner commitment review.",commitmentEvidenceUrl:"https://example.com/synthetic-assignment",agreedPrice:130000};
  await assert.rejects(transactions.recordBuyerResponse(id,buyer.id,commitment,operator,now),e=>(e as {status:number}).status===403);
  await assert.rejects(transactions.recordBuyerResponse(id,buyer.id,{...commitment,agreedPrice:100000},actor,now));
  op = await transactions.recordBuyerResponse(id,buyer.id,commitment,actor,now);
  assert.equal(op.contract?.agreedBuyerPrice,130000);
  const committedDistribution=await getDealDistribution(id);
  assert.equal(committedDistribution.status,"CLOSED");
  assert.equal(committedDistribution.recipients.find(r=>r.buyerId===buyer.id)?.status,"COMMITTED");
  assert.equal(committedDistribution.recipients.find(r=>r.buyerId===competitor.id)?.status,"EXPIRED");
  assert.equal(op.matches.find(m=>m.buyerId===competitor.id)?.status,"EXPIRED");
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
   await assert.rejects(transactions.recordDestinationActivity(id,destination.id,{version:op.contract!.version,buyerVersion:destination.version,
     eventKey:"synthetic-invalid-post-close-submission",kind:"SUBMITTED",occurredAt:future(3),
     evidenceUrl:"https://example.com/synthetic-post-close-submission",note:"SYNTHETIC submission after terminal close is not valid."},actor,new Date(future(6))),
     /actually occurred before closing/);
   op = await transactions.recordDestinationActivity(id,destination.id,{...feeReceivedDetails,version:op.contract!.version},actor,new Date(future(6)));
   assert.equal(op.contract?.status,"CLOSED");
   assert.equal(op.contract?.closedAt,future(2));
   assert.equal(op.contract?.assignmentFeeReceived,20000);
   assert.equal(op.contract?.netProceeds,18000);
   assert.equal(op.contract?.destinationActivityHistory?.at(-1)?.occurredAt,future(3));
   assert.equal(op.contract?.destinationActivityHistory?.at(-1)?.recordedAt,future(6));
   const lateDispute = {version:op.contract!.version,buyerVersion:destination.version,eventKey:"synthetic-guru-fee-disputed",
     kind:"FEE_DISPUTED" as const,occurredAt:future(4),evidenceUrl:"https://example.com/synthetic-guru-fee-dispute",
     note:"SYNTHETIC post-close fee dispute, retained outside acquisition closing state.",feeAmount:500,currency:"USD",
     relatedEventKey:feeReceivedDetails.eventKey};
   op = await transactions.recordDestinationActivity(id,destination.id,lateDispute,actor,new Date(future(7)));
   const lateWaiver = {version:op.contract!.version,buyerVersion:destination.version,eventKey:"synthetic-guru-fee-waived",
     kind:"FEE_WAIVED" as const,occurredAt:future(5),evidenceUrl:"https://example.com/synthetic-guru-fee-waiver",
     note:"SYNTHETIC post-close owner-recorded fee waiver following the dispute.",feeAmount:500,currency:"USD",
     relatedEventKey:lateDispute.eventKey};
   op = await transactions.recordDestinationActivity(id,destination.id,lateWaiver,actor,new Date(future(8)));
   assert.equal(op.contract?.destinationActivityHistory?.length,7);
   assert.equal(op.contract?.status,"CLOSED");
   assert.equal((await seller.leadDetail(id)).lead.stage,"CLOSED");
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
   logger.info({checks:"approved terms → draft → historically authorized late execution → matching; append-only deal-finder submission, exact terms, and post-close fee receipt/dispute/waiver isolated from buyer commitment and closing; leases; owner/buyer-consented amendment; evidenced release archives old assignment → verified replacement → commitment; refreshed research preserves lifecycle; four milestones; late evidenced settlement preserves actual/recorded times; reconciliation and terminal guards"},"Full lifecycle persistence exercise PASSED (isolated synthetic schema)");
} finally { await pool.end(); }
