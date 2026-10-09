import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { db,pool,analysesTable,contractsTable,jobsTable,matchesTable,buyersTable,leadsTable,transactionDocumentBlobsTable,transactionReadinessExceptionsTable,dealDecisionWorkItemsTable } from "@workspace/db";
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
import { CLOSING_MILESTONES, closingBlockers } from "@workspace/deal-domain";
import { recordTransactionException } from "./transaction-exceptions";
import { reviewHandoffs, listHandoffs, recordHandoffEvent } from "./handoffs";
import { getBuyerRecord } from "./operations-records";
import { requestBuyerQualification } from "./buyer-pool";
import {
  authorizeDealDistribution, getBuyerPortalDeal, getDealDistribution,
  respondToBuyerPortalDeal, shareDistributionRecipients,
} from "./distribution-store";
import { getTransactionDocumentReadiness } from "./transaction-document-registry";
import { evaluateAllTransactionReadiness, getTransactionReadinessReport } from "./transaction-readiness";
const actor = {id:`synthetic-transaction:${randomUUID()}`,role:"OWNER"};
const operator = {...actor,role:"OPERATOR"};
const now = new Date();
const future = (days:number)=>new Date(now.getTime()+days*86400000).toISOString();
let readinessSummary: Record<string,unknown> = {};
let readinessDeadlineKeys: {upcoming:string;overdue:string}|null = null;
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
  await seller.addIntelligence(id,{classification:"AI_HYPOTHESIS",category:"prepared_questions",
    statement:"Synthetic call-preparation hypothesis only; not a seller fact.",
    source:"Synthetic command-center exercise",sourceType:"MODEL",confidence:0.4,capturedAt:now.toISOString(),
    question:"What is your preferred closing timeline?",action:"Ask the seller and record the actual answer."},actor.id,now);
  detail = await seller.leadDetail(id);
  detail = await seller.transitionLead(id,{version:detail.lead.version,to:"CALL_READY",reason:"Synthetic research complete.",nextAction:"Synthetic call."},actor.id,now);
  const liveDesk = await commandCenter("OWNER",now);
  const callBrief = liveDesk.calls.find(item=>item.lead.id===id);
  assert.ok(callBrief,"A persisted CALL_READY lead with a phone route and current underwriting must appear in CALL NEXT.");
  assert.equal(callBrief.lead.address,"SYNTHETIC COMPLETE DEAL");
  assert.equal(callBrief.lead.sellerPhone,"000-000-0000");
  assert.ok(callBrief.analysis.arv,"The call brief carries current ARV evidence.");
  assert.ok(callBrief.analysis.repairs,"The call brief carries current repair assumptions.");
  assert.ok(callBrief.intelligence.some(item=>item.classification==="VERIFIED_FACTS"));
  assert.ok(callBrief.intelligence.some(item=>item.classification==="AI_HYPOTHESIS"),
    "Call preparation must preserve hypothesis status instead of presenting it as a seller fact.");
  assert.ok(callBrief.questions.includes("What is your preferred closing timeline?"),
    "The seller's next question is carried into the call brief without re-entry.");
  const callAction = liveDesk.actions.find(action=>action.leadId===id);
  assert.equal(callAction?.href,`/calls?lead=${id}`);
  assert.ok(callAction?.workGuidance?.humanMustDo);
  assert.match(callAction?.workGuidance?.currentState??"",/call[_ ]ready/i);
  detail = await seller.recordCall(id,{version:detail.lead.version,outcome:"CONNECTED",notes:"Synthetic conversation, no external call.",nextAction:"Review terms.",followUpAt:future(1)},actor.id,now);
  detail = await offers.createOfferDraft(id,{version:detail.lead.version,amount:110000,earnestMoney:1000,closingDays:30,
    contingencies:"Synthetic title and diligence",assignmentIntent:true,reason:"Synthetic terms"},actor,now);
  const offerId = detail.offers[0]!.id;
  detail = await offers.authorizeOffer(id,offerId,{version:detail.lead.version,maximumApprovedAcquisitionPrice:120000,
    authorityEvidenceId:authority.id,expiresAt:future(2),reason:"Synthetic owner review",nextAction:"Synthetic exact terms",followUpAt:future(1)},actor,now);
  detail = await offers.communicateOffer(id,offerId,{version:detail.lead.version,amount:110000,channel:"PHONE",
    evidence:"Synthetic human communication only.",nextAction:"Prepare contract.",followUpAt:future(1)},operator,now);
  const approvedSnapshot = detail.analysisSnapshotId;
  assert.ok(approvedSnapshot,"The communicated offer must remain bound to a persisted analysis snapshot.");
  await seller.addIntelligence(id,{classification:"AI_HYPOTHESIS",category:"prepared_questions",statement:"The seller may value clear coordination.",
    source:"Synthetic model-only test",sourceType:"MODEL",confidence:0.4,capturedAt:now.toISOString(),
    question:"What coordination would help?",action:"Ask the seller and record the actual answer."},actor.id,now);
  detail = await seller.leadDetail(id);
  assert.equal(detail.analysisSnapshotId,approvedSnapshot);
  assert.equal(detail.offers[0]?.effectiveStatus,"COMMUNICATED");
  await assert.rejects(transactions.createContract(id,{version:detail.lead.version,offerId,closingAt:future(31)},operator,now),/approved closing/);
  let op = await transactions.createContract(id,{version:detail.lead.version,offerId,closingAt:future(20)},operator,now);
  assert.equal(op.contract?.status,"DRAFT"); assert.equal(op.contract?.purchasePrice,110000);
  assert.match(op.nextAction,/Prepare the fillable terms-review PDF/);
  await assert.rejects(
    transactions.preparePurchaseReviewDocument(id,{version:op.contract!.version},{id:"synthetic-analyst",role:"ANALYST"},now),
    (error:unknown)=>(error as {status?:number}).status===403,
    "transaction PDFs are owner/operator-only",
  );
  op = await transactions.preparePurchaseReviewDocument(id,{version:op.contract!.version},operator,now);
  const reviewDocument = op.contract?.documents?.[0];
  assert.ok(reviewDocument);
  assert.equal(reviewDocument.status,"PREPARED_FOR_REVIEW");
  assert.equal(reviewDocument.kind,"PURCHASE_TERMS_REVIEW");
  assert.equal(reviewDocument.sourceOfferId,offerId);
  assert.equal(reviewDocument.sourceAnalysisSnapshotId,approvedSnapshot);
  assert.match(reviewDocument.economicsSnapshotHash??"",/^[a-f0-9]{64}$/);
  assert.equal(op.contract?.status,"DRAFT","preparing a review worksheet must never imply execution");
  assert.equal(op.contract?.executedDocumentUrl??null,null);
  assert.match(op.nextAction,/Review the saved fillable terms PDF/);
  assert.equal((await seller.leadDetail(id)).offers.find(item=>item.id===offerId)?.effectiveStatus,"COMMUNICATED",
    "preparing paperwork must not invalidate the exact communicated approval");
  assert.match(reviewDocument.snapshotHash,/^[a-f0-9]{64}$/);
  assert.match(reviewDocument.contentHash,/^[a-f0-9]{64}$/);
  assert.equal(reviewDocument.templateKey,"PURCHASE_TERMS_REVIEW");
  assert.equal(reviewDocument.templateStatus,"REVIEW_COPY_ONLY");
  assert.equal(reviewDocument.storageMode,"PERSISTENT_DATABASE_BLOB");
  assert.deepEqual(reviewDocument.events?.map(event=>event.to),["DRAFT","PREPARED_FOR_REVIEW"]);
  const registryState = await getTransactionDocumentReadiness(actor,id);
  assert.equal(registryState.canSendLegalDocuments,false);
  assert.equal(registryState.leadId,id);
  assert.equal(registryState.jurisdiction,"US/TX/SYNTHETIC-COUNTY",
    "Readiness must use the persisted deal property's state/county rather than an unspecified global registry.");
  assert.equal(registryState.signingProvider.status,"NOT_CONNECTED");
  assert.equal(registryState.storage.status,"PRIVATE_FILE_STORE_UNAVAILABLE");
  assert.ok(registryState.templates.some(item=>item.key==="PURCHASE_AGREEMENT"&&item.status==="MISSING_APPROVED_TEMPLATE"&&
    item.jurisdiction==="US/TX/SYNTHETIC-COUNTY"));
  assert.ok(registryState.templates.some(item=>item.key==="ASSIGNMENT_AGREEMENT"&&item.status==="MISSING_APPROVED_TEMPLATE"&&
    item.jurisdiction==="US/TX/SYNTHETIC-COUNTY"));
  assert.ok(registryState.blockers.some(reason=>reason.includes("US/TX/SYNTHETIC-COUNTY")),
    "Absent legal templates must explicitly block the subject transaction in its property jurisdiction.");
  await assert.rejects(getTransactionDocumentReadiness({id:"synthetic-analyst",role:"ANALYST"},id),
    (error:unknown)=>(error as {status?:number}).status===403,
    "jurisdiction and document readiness are not exposed to research-only roles");
  await assert.rejects(transactions.downloadPurchaseReviewDocument(id,reviewDocument.id,
    {id:"synthetic-analyst",role:"ANALYST"},now),
    (error:unknown)=>(error as {status?:number}).status===403,
    "private document bytes must only be retrieved through an authorized operator route");
  const reviewFile = await transactions.downloadPurchaseReviewDocument(id,reviewDocument.id,operator,now);
  assert.equal(reviewFile.bytes.subarray(0,5).toString(),"%PDF-");
  const parsedPdf = await PDFDocument.load(reviewFile.bytes);
  const fillableNames = parsedPdf.getForm().getFields().map(field=>field.getName());
  assert.ok(fillableNames.includes("seller_legal_name"));
  assert.ok(fillableNames.includes("parcel_legal_description"));
  assert.ok(fillableNames.includes("additional_terms_for_review"));
  const [persistedContract] = await db.select().from(contractsTable).where(eq(contractsTable.leadId,id));
  const persistedArtifacts = persistedContract?.payload.documentArtifacts as Array<Record<string,unknown>>|undefined;
  assert.equal(persistedArtifacts?.length,1);
  assert.equal(persistedArtifacts?.[0]?.contentHash,reviewDocument.contentHash);
  assert.equal(persistedArtifacts?.[0]?.pdfBase64,undefined,"new document binaries must not be embedded in contract JSON");
  const [persistedBlob] = await db.select().from(transactionDocumentBlobsTable)
    .where(eq(transactionDocumentBlobsTable.documentId,reviewDocument.id));
  assert.ok(persistedBlob);
  assert.equal(persistedBlob?.contentHash,reviewDocument.contentHash);
  assert.equal(persistedBlob?.sizeBytes,reviewDocument.sizeBytes);
  assert.equal(Buffer.from(persistedBlob!.content).subarray(0,5).toString(),"%PDF-");
  assert.equal(JSON.stringify(op.contract).includes(Buffer.from(persistedBlob!.content).toString("base64")),false,
    "private PDF bytes must never appear in ordinary deal API responses");
  const [currentLeadRow] = await db.select().from(leadsTable).where(eq(leadsTable.id,id));
  assert.ok(currentLeadRow);
  await db.update(leadsTable).set({payload:{...currentLeadRow!.payload,sellerName:"Changed synthetic party"}}).where(eq(leadsTable.id,id));
  await assert.rejects(transactions.downloadPurchaseReviewDocument(id,reviewDocument.id,operator,now),
    /Seller identity\/contact fields changed/,"a changed seller party must stale the prepared document");
  await db.update(leadsTable).set({payload:currentLeadRow!.payload}).where(eq(leadsTable.id,id));
  const versionAfterPdf = op.contract!.version;
  op = await transactions.preparePurchaseReviewDocument(id,{version:versionAfterPdf},operator,now);
  assert.equal(op.contract?.version,versionAfterPdf,"same authorized snapshot must be idempotent");
  assert.equal(op.contract?.documents?.length,1);
  const execute = {version:op.contract!.version,executedDocumentUrl:"https://example.com/synthetic-contract",
    sellerSignedAt:now.toISOString(),acquisitionSignedAt:now.toISOString(),reviewNote:"Synthetic owner verification, not real signatures."};
  await assert.rejects(transactions.executeContract(id,execute,operator,now),e=>(e as {status:number}).status===403);
  await assert.rejects(transactions.executeContract(id,{...execute,sellerSignedAt:future(1)},actor,now),/future/);
  // Recording after approval expiry is allowed ONLY for historically valid signatures.
  op = await transactions.executeContract(id,execute,actor,new Date(now.getTime()+3*86400000));
  assert.equal(op.contract?.status,"UNDER_CONTRACT");
  assert.equal(op.contract?.documents?.[0]?.id,reviewDocument.id,"contract updates must retain the immutable review artifact");
   const executedReviewArtifact = op.contract?.documents?.find(document=>document.id===reviewDocument.id);
   assert.equal(executedReviewArtifact?.status,"PREPARED_FOR_REVIEW",
     "executing a separately evidenced agreement must not mark the generated review worksheet as signed");
   assert.equal(executedReviewArtifact?.events?.some(event=>event.to==="SIGNED"||event.to==="EXECUTED"),false);
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
  const lockedAnalysis=(await seller.leadDetail(id,undefined,now)).analysis;
  assert.ok(lockedAnalysis,"The exact approved analysis remains available before buyer distribution.");
  assert.equal(lockedAnalysis.assumptions.assignmentTarget,15000);
  const [approvedAnalysisRow] = await db.select().from(analysesTable).where(eq(analysesTable.id,approvedSnapshot));
  assert.ok(approvedAnalysisRow,"The communicated offer's approved analysis snapshot remains persisted.");
  const [mismatchSnapshotRow] = await db.insert(analysesTable).values({
    leadId:id,snapshot:approvedAnalysisRow.snapshot,createdBy:actor.id,createdAt:new Date(now.getTime()+1),
  }).returning({id:analysesTable.id});
  assert.ok(mismatchSnapshotRow);
  await db.update(leadsTable).set({analysisSnapshotId:mismatchSnapshotRow.id}).where(eq(leadsTable.id,id));
  await assert.rejects(authorizeDealDistribution(id,{version:op.contract!.version,
    reason:"SYNTHETIC snapshot mismatch rejection exercise."},actor,now),
    /Refresh and verify complete, current underwriting tied to the communicated offer/,
    "A current lead pointer that no longer matches the communicated offer must block distribution.");
  assert.equal((await getDealDistribution(id)).packetId,null,
    "A stale/mismatched economics authorization must not persist a buyer packet.");
  await db.update(leadsTable).set({analysisSnapshotId:approvedSnapshot}).where(eq(leadsTable.id,id));
  await db.delete(analysesTable).where(eq(analysesTable.id,mismatchSnapshotRow.id));
    const distribution = await authorizeDealDistribution(id,{version:op.contract!.version,
      reason:"Synthetic owner authorization for isolated distribution exercise."},actor,now);
    assert.ok(distribution.packetId);
    assert.equal(op.contract?.purchasePrice,110000);
    assert.equal(op.contract?.assignmentTarget,15000);
    const expectedBuyerPrice=op.contract!.purchasePrice+op.contract!.assignmentTarget;
    assert.equal(distribution.packet?.economics.buyerPrice,expectedBuyerPrice);
    assert.equal(distribution.packet?.economics.authorizedAssignmentFee,15000);
    assert.equal(distribution.packet?.economics.buyerPrice,125000);
    assert.deepEqual(distribution.packet?.underwriting.arv,lockedAnalysis.arv);
    assert.deepEqual(distribution.packet?.underwriting.repairs,lockedAnalysis.repairs);
     assert.equal(distribution.packet?.economics.economicsSnapshotHash,reviewDocument.economicsSnapshotHash,
       "The buyer packet and prepared transaction worksheet must carry the same locked economics hash.");
     assert.equal(distribution.packet?.economics.sourceAnalysisSnapshotId,reviewDocument.sourceAnalysisSnapshotId);
     assert.equal(distribution.packet?.evidence.sourceAnalysisSnapshotId,reviewDocument.sourceAnalysisSnapshotId);
     assert.equal(distribution.packet?.evidence.comparables.filter(comp=>comp.included).length,3);
     const syntheticRepairEvidenceId=(uw as {repairs:Array<{evidenceId?:string}>}).repairs[0]?.evidenceId;
     assert.ok(distribution.packet?.evidence.repairs.lines.some(line=>line.evidenceId===syntheticRepairEvidenceId));
     const unverifiedBuyer = await buyers.createBuyer({name:"SYNTHETIC UNVERIFIED BUYER",email:"unverified@example.com",phone:"",
       source:"Synthetic fixture only; no current buyer evidence",status:"ACTIVE",criteria:buyer.criteria},actor);
     let staleBuyer = await buyers.createBuyer({name:"SYNTHETIC STALE BUYER",email:"stale@example.com",phone:"",
       source:"Synthetic fixture only; evidence deliberately expires before distribution",status:"ACTIVE",criteria:buyer.criteria},actor);
     const olderEvidenceAt = new Date(now.getTime()-29*86400000);
     staleBuyer = await buyers.verifyBuyer(staleBuyer.id,{...verificationInput,version:staleBuyer.version,
       evidenceAt:olderEvidenceAt.toISOString(),buyingEvidenceAt:olderEvidenceAt.toISOString(),
       validUntil:new Date(olderEvidenceAt.getTime()+30*86400000).toISOString()},actor,now);
     const afterExpiry = new Date(olderEvidenceAt.getTime()+30*86400000+1000);
     const expiredBuyer = await getBuyerRecord(staleBuyer.id,db,afterExpiry);
     assert.equal(expiredBuyer.approvalStatus,"REVERIFICATION_REQUIRED");
     await assert.rejects(shareDistributionRecipients(distribution.packetId!,{
       version:distribution.version,buyerIds:[unverifiedBuyer.id],
     },operator,now),/no longer qualified/i,
     "An unverified prospect cannot receive an authorized multi-buyer packet.");
     await assert.rejects(shareDistributionRecipients(distribution.packetId!,{
       version:distribution.version,buyerIds:[staleBuyer.id],
     },operator,afterExpiry),/no longer qualified/i,
     "A buyer whose current verification expired cannot receive a packet.");
     assert.equal((await getDealDistribution(id)).recipients.length,0,
       "Failed stale/unverified recipient checks must not persist distribution links.");
    const shared = await shareDistributionRecipients(distribution.packetId!,{version:distribution.version,buyerIds:[buyer.id,competitor.id]},operator,now);
    assert.equal(shared.links.length,2);
     let readinessRuns = await evaluateAllTransactionReadiness(now);
     assert.equal(readinessRuns.length,1);
     assert.equal(readinessRuns[0]?.synthetic,true,"The isolated persisted transaction must remain labelled synthetic.");
     let readinessReport = await getTransactionReadinessReport(now);
     assert.equal(readinessReport.realTransactionCount,0,"Synthetic fixtures must never count as real transaction evidence.");
     assert.equal(readinessReport.syntheticTransactionCount,1);
     assert.ok(readinessReport.exceptions.some(item=>item.issueKey==="SIGNING_PROVIDER_UNAVAILABLE"&&item.status==="OPEN"));
     assert.ok(readinessReport.exceptions.some(item=>item.issueKey==="LEGAL_TEMPLATE_UNAVAILABLE:PURCHASE_AGREEMENT"&&item.status==="OPEN"));
     assert.ok(readinessReport.exceptions.some(item=>item.issueKey==="MILESTONE_MISSING:EARNEST_MONEY_CONFIRMED"&&item.status==="OPEN"));
     assert.ok(readinessReport.exceptions.some(item=>item.issueKey.startsWith("DELIVERY_UNCONFIRMED:")&&item.status==="OPEN"),
       "An INVITED recipient without provider receipt must remain explicitly unconfirmed.");
     const persistedReadinessRows = await db.select().from(transactionReadinessExceptionsTable)
       .where(eq(transactionReadinessExceptionsTable.contractId,op.contract!.id));
     const firstIssueIds = new Set(persistedReadinessRows.map(item=>item.id));
     assert.ok(persistedReadinessRows.every(item=>item.synthetic===true&&item.firstObservedAt instanceof Date));
     const onceExceptionCount = persistedReadinessRows.length;
     await evaluateAllTransactionReadiness(now);
     const replayReadinessRows = await db.select().from(transactionReadinessExceptionsTable)
       .where(eq(transactionReadinessExceptionsTable.contractId,op.contract!.id));
     assert.equal(replayReadinessRows.length,onceExceptionCount,"Readiness reevaluation must not duplicate an unresolved issue.");
     assert.ok(replayReadinessRows.every(item=>firstIssueIds.has(item.id)),"Readiness replay must preserve issue identities.");
     const [readinessContractRow] = await db.select().from(contractsTable).where(eq(contractsTable.id,op.contract!.id));
     assert.ok(readinessContractRow);
     const originalContractPayload = readinessContractRow!.payload;
     const readinessUpcomingClose = future(2);
     const readinessOverdueClose = new Date(now.getTime()-86400000).toISOString();
     readinessDeadlineKeys = {
       upcoming:`CLOSING_DEADLINE_UPCOMING:${readinessUpcomingClose}`,
       overdue:`CLOSING_DEADLINE_OVERDUE:${readinessOverdueClose}`,
     };
     await db.update(contractsTable).set({payload:{...originalContractPayload,closingAt:readinessUpcomingClose}})
       .where(eq(contractsTable.id,op.contract!.id));
     await evaluateAllTransactionReadiness(now);
     readinessReport = await getTransactionReadinessReport(now);
     assert.ok(readinessReport.exceptions.some(item=>item.issueKey.startsWith("CLOSING_DEADLINE_UPCOMING:")&&item.status==="OPEN"),
       "A persisted closing date within seven days must create a deterministic upcoming exception.");
     await db.update(contractsTable).set({payload:{...originalContractPayload,closingAt:readinessOverdueClose}})
       .where(eq(contractsTable.id,op.contract!.id));
     await evaluateAllTransactionReadiness(now);
     readinessReport = await getTransactionReadinessReport(now);
     assert.ok(readinessReport.exceptions.some(item=>item.issueKey.startsWith("CLOSING_DEADLINE_OVERDUE:")&&item.status==="OPEN"),
       "A persisted past closing date must create an overdue exception; the evaluator never extends it.");
     await db.update(contractsTable).set({payload:originalContractPayload}).where(eq(contractsTable.id,op.contract!.id));
     await evaluateAllTransactionReadiness(now);
    const portalToken = shared.links.find(link=>link.buyerId===buyer.id)!.token;
   const competitorPortalToken = shared.links.find(link=>link.buyerId===competitor.id)!.token;
    const portal = await getBuyerPortalDeal(portalToken,now);
   const competitorPortal = await getBuyerPortalDeal(competitorPortalToken,now);
    assert.equal(portal.packet.economics.buyerPrice,expectedBuyerPrice);
   assert.deepEqual(competitorPortal.packet,portal.packet,"Every selected buyer must receive the same immutable authorized packet.");
   assert.equal(competitorPortal.canAccept,true,"A second currently qualified buyer can accept after another buyer's soft response.");
    assert.equal(JSON.stringify(portal).includes(detail.lead.address),false,"The public buyer packet must not expose the street address.");
    assert.equal(JSON.stringify(portal).includes(detail.lead.sellerName),false,"The public buyer packet must not expose seller identity.");
    const repeatedPortalAccess = await getBuyerPortalDeal(portalToken,now);
    assert.equal(repeatedPortalAccess.recipientStatus,"INVITED","Opening a packet must not change recipient qualification or response state.");
    assert.equal(repeatedPortalAccess.canAccept,true);
    assert.equal(repeatedPortalAccess.events.filter(event=>event.action==="PORTAL_ACCESSED").length,2,
      "Each valid private-packet access is persisted as access evidence, not as buyer intent.");
    assert.ok(repeatedPortalAccess.events.filter(event=>event.action==="PORTAL_ACCESSED")
      .every(event=>event.note.includes("does not establish the reader's identity")));
    const afterViews = await getDealDistribution(id);
    const viewedRecipients = afterViews.recipients as Array<{
      buyerId:string;status:string;events:Array<{action:string}>;
    }>;
    assert.equal(viewedRecipients.find(recipient=>recipient.buyerId===buyer.id)?.status,"INVITED");
    assert.equal(viewedRecipients.find(recipient=>recipient.buyerId===buyer.id)?.events
      .filter(event=>event.action==="PORTAL_ACCESSED").length,2,
      "The operator distribution view receives persisted portal-access history.");
    assert.equal(afterViews.acceptedBuyerId,null,"Portal access alone cannot mark interest, acceptance, or commitment.");
    const accessCountBeforeRejectedReads = repeatedPortalAccess.events.filter(event=>event.action==="PORTAL_ACCESSED").length;
    await assert.rejects(getBuyerPortalDeal(portalToken,new Date(Date.parse(distribution.expiresAt!)+1000)),/no longer available/);
    await assert.rejects(getBuyerPortalDeal("x".repeat(43),now),/invalid or no longer active/);
    const afterRejectedReads = await getDealDistribution(id);
    const afterRejectedRecipients = afterRejectedReads.recipients as Array<{
      buyerId:string;events:Array<{action:string}>;
    }>;
    assert.equal(afterRejectedRecipients.find(recipient=>recipient.buyerId===buyer.id)?.events
      .filter(event=>event.action==="PORTAL_ACCESSED").length,accessCountBeforeRejectedReads,
      "Expired and nonexistent capabilities must not create access events.");
   const interest = {eventKey:"synthetic-portal-interest",action:"INTERESTED" as const,note:"Synthetic interest, no external contact."};
   let portalResult = await respondToBuyerPortalDeal(portalToken,interest,now);
    assert.equal(portalResult.recipientStatus,"INTERESTED");
   portalResult = await respondToBuyerPortalDeal(portalToken,interest,now);
     assert.equal(portalResult.events.filter(event=>event.eventKey===interest.eventKey).length,1,
       "An identical portal response retry must not duplicate interest activity.");
    await assert.rejects(respondToBuyerPortalDeal(portalToken,{...interest,action:"DECLINED"},now),/different response/);
   portalResult = await respondToBuyerPortalDeal(portalToken,{eventKey:"synthetic-portal-accept",action:"ACCEPTED"},now);
    assert.equal(portalResult.recipientStatus,"ACCEPTED");
    assert.equal(portalResult.canAccept,false);
   const secondAcceptance = await respondToBuyerPortalDeal(competitorPortalToken,
     {eventKey:"synthetic-competitor-accept",action:"ACCEPTED"},now);
   assert.equal(secondAcceptance.recipientStatus,"ACCEPTED","A prior soft acceptance must not block a second qualified buyer's response.");
    const afterPortalAcceptance = await dealOperations(id,now);
    assert.equal(afterPortalAcceptance.matches.find(m=>m.buyerId===buyer.id)?.status,"INTERESTED",
      "Portal interest/acceptance must propagate to the persisted buyer match without re-entry.");
   assert.equal(afterPortalAcceptance.matches.find(m=>m.buyerId===competitor.id)?.status,"INTERESTED",
     "A second buyer's soft acceptance is independently persisted as interest.");
    assert.equal((await seller.leadDetail(id)).lead.stage,"BUYER_INTERESTED");
    assert.ok(!(await dealOperations(id,now)).contract?.committedBuyerId,
      "A portal acceptance is intent only; it must not create a buyer commitment.");
   let openDistribution = await getDealDistribution(id);
   assert.equal(openDistribution.status,"ACTIVE","A soft acceptance must not close or reserve the distribution.");
   assert.equal(openDistribution.acceptedBuyerId,buyer.id,"The earliest response is informational only.");
   const lateQualified = await buyers.createBuyer({name:"SYNTHETIC LATE QUALIFIED BUYER",email:"late@example.com",phone:"",
     source:"Synthetic post-acceptance distribution fixture",status:"ACTIVE",criteria:buyer.criteria},actor);
   const lateVerified = await buyers.verifyBuyer(lateQualified.id,{...verificationInput,version:lateQualified.version,
     identityEvidenceUrl:"https://example.com/synthetic-late-id",fundingEvidenceUrl:"https://example.com/synthetic-late-funds",
     buyingEvidenceUrl:"https://example.com/synthetic-late-buying",criteriaEvidenceUrl:"https://example.com/synthetic-late-criteria"},actor,now);
   await refreshMatches(id,now);
   openDistribution = await getDealDistribution(id);
   const thirdShare = await shareDistributionRecipients(openDistribution.packetId!,{
     version:openDistribution.version,buyerIds:[lateVerified.id],
   },operator,now);
   assert.equal(thirdShare.links.length,1,"The owner/operator can add a new qualified buyer after soft acceptances.");
   const latePortal = await getBuyerPortalDeal(thirdShare.links[0]!.token,now);
   assert.deepEqual(latePortal.packet,portal.packet,"Later recipients receive the same frozen authorized package.");
   const lateInterest = await respondToBuyerPortalDeal(thirdShare.links[0]!.token,{
     eventKey:"synthetic-late-buyer-interest",action:"INTERESTED",note:"Synthetic third-buyer interest.",
   },now);
   assert.equal(lateInterest.recipientStatus,"INTERESTED");
   op = await dealOperations(id,now);
   assert.equal(op.matches.find(m=>m.buyerId===competitor.id)?.status,"INTERESTED");
   await assert.rejects(transactions.recordBuyerResponse(id,competitor.id,{
     version:op.contract!.version,buyerVersion:competitor.version,status:"COMMITTED",
     evidence:"Synthetic second buyer commitment; owner reviewed signed assignment evidence.",agreedPrice:130000,
     commitmentEvidenceUrl:"https://example.com/synthetic-second-assignment",
   },operator,now),(error:unknown)=>(error as {status?:number}).status===403);
   await assert.rejects(transactions.recordBuyerResponse(id,competitor.id,{
     version:op.contract!.version,buyerVersion:competitor.version,status:"COMMITTED",
     evidence:"Synthetic below-floor attempt; should not win.",agreedPrice:100000,
     commitmentEvidenceUrl:"https://example.com/synthetic-below-floor-assignment",
   },actor,now),/below the frozen acquisition/);
   const sameContractVersion = op.contract!.version;
   const commitRace = await Promise.allSettled([
     transactions.recordBuyerResponse(id,competitor.id,{
       version:sameContractVersion,buyerVersion:competitor.version,status:"COMMITTED",
       evidence:"Synthetic second buyer commitment; owner reviewed signed assignment evidence.",agreedPrice:130000,
       commitmentEvidenceUrl:"https://example.com/synthetic-second-assignment",
     },actor,now),
     transactions.recordBuyerResponse(id,lateVerified.id,{
       version:sameContractVersion,buyerVersion:lateVerified.version,status:"COMMITTED",
       evidence:"Synthetic third buyer commitment; owner reviewed signed assignment evidence.",agreedPrice:130000,
       commitmentEvidenceUrl:"https://example.com/synthetic-third-assignment",
     },actor,now),
   ]);
   const winners = commitRace.filter((result)=>result.status==="fulfilled");
   const losers = commitRace.filter((result)=>result.status==="rejected");
   assert.equal(winners.length,1,"Concurrent valid commitments must produce exactly one winner.");
   assert.equal(losers.length,1,"The competing commitment must fail after the contract lock is won.");
   const loser = losers[0];
   assert.ok(loser?.status==="rejected");
   assert.equal((loser.reason as {status?:number}).status,409);
   const winner = winners[0];
   if (!winner || winner.status!=="fulfilled") throw new Error("The first valid commitment race did not produce a winner.");
   op = winner.value;
   const winnerBuyerId = op.contract?.committedBuyerId;
   assert.ok(winnerBuyerId && [competitor.id,lateVerified.id].includes(winnerBuyerId));
   assert.equal(op.contract?.committedBuyerId,winnerBuyerId,
      "A valid owner-reviewed commitment wins even though another buyer accepted earlier.");
   const committedDistribution=await getDealDistribution(id);
   assert.equal(committedDistribution.status,"CLOSED");
   assert.equal(committedDistribution.acceptedBuyerId,buyer.id,"Soft acceptance history must not overwrite the actual commitment winner.");
   for (const selectedBuyer of [buyer,competitor,lateVerified]) {
     assert.equal(committedDistribution.recipients.find(r=>r.buyerId===selectedBuyer.id)?.status,
       selectedBuyer.id===winnerBuyerId?"COMMITTED":"EXPIRED");
     assert.equal(op.matches.find(m=>m.buyerId===selectedBuyer.id)?.status,
       selectedBuyer.id===winnerBuyerId?"COMMITTED":"EXPIRED");
   }
   const closedRecipient = committedDistribution.recipients.find(r=>r.buyerId===lateVerified.id);
   const closedAccessCount = closedRecipient?.events.filter(event=>event.action==="PORTAL_ACCESSED").length;
   await assert.rejects(getBuyerPortalDeal(thirdShare.links[0]!.token,now),/no longer available/);
   const afterClosedAccess = await getDealDistribution(id);
   assert.equal(afterClosedAccess.recipients.find(r=>r.buyerId===lateVerified.id)?.events
     .filter(event=>event.action==="PORTAL_ACCESSED").length,closedAccessCount,
     "A committed/closed link rejection must not record another portal access.");
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
    assert.equal(op.contract?.committedBuyerId,winnerBuyerId);
    assert.equal((await seller.leadDetail(id)).lead.stage,"BUYER_COMMITTED","Destination activity must not alter the separately committed acquisition buyer.");
   assert.equal(op.matches.find(m=>m.buyerId===destination.id)?.status,"MATCHED");
   await assert.rejects(transactions.recordBuyerResponse(id,destination.id,{version:op.contract!.version,buyerVersion:destination.version,
     status:"INTERESTED",evidence:"Synthetic destination interest must not use buyer response."},operator,now),/separate destination history/);
   await assert.rejects(transactions.recordBuyerResponse(id,destination.id,{version:op.contract!.version,buyerVersion:destination.version,
     status:"COMMITTED",evidence:"Synthetic attempt to commit a non-acquisition destination.",agreedPrice:130000,
     commitmentEvidenceUrl:"https://example.com/synthetic-invalid-destination-commitment"},actor,now),/separate destination history/);
  assert.equal(op.contract?.agreedBuyerPrice,130000);
   assert.equal(op.matches.find(m=>m.buyerId===winnerBuyerId)?.status,"COMMITTED");
   assert.equal(op.matches.find(m=>m.buyerId===buyer.id)?.status,"EXPIRED");
   assert.equal(committedDistribution.status,"CLOSED");
   assert.equal(committedDistribution.recipients.find(r=>r.buyerId===winnerBuyerId)?.status,"COMMITTED");
   assert.equal(committedDistribution.recipients.find(r=>r.buyerId===buyer.id)?.status,"EXPIRED");
  const amend = {version:op.contract!.version,kind:"AMEND_CLOSING" as const,effectiveAt:now.toISOString(),
    newClosingAt:future(4),evidenceUrl:"https://example.com/synthetic-amendment",note:"SYNTHETIC signed date amendment, no real agreement."};
  await assert.rejects(recordTransactionException(id,amend,operator,now),e=>(e as {status:number}).status===403);
  await assert.rejects(recordTransactionException(id,amend,actor,now),/buyer consent/);
  op = await recordTransactionException(id,{...amend,buyerConsentEvidenceUrl:"https://example.com/synthetic-buyer-consent"},actor,now);
  assert.equal(op.contract?.closingAt,future(4)); assert.equal(op.contract?.purchasePrice,110000);
  assert.equal(op.contract?.history?.[0]?.previousState.closingAt,future(20));
   await evaluateAllTransactionReadiness(now);
   readinessReport = await getTransactionReadinessReport(now);
   assert.ok(readinessReport.exceptions.some(item=>item.issueKey===readinessDeadlineKeys?.upcoming&&item.status==="RESOLVED"),
     "An evidence-backed closing-date amendment resolves the prior upcoming-deadline exception.");
   assert.ok(readinessReport.exceptions.some(item=>item.issueKey===readinessDeadlineKeys?.overdue&&item.status==="RESOLVED"),
     "An evidence-backed closing-date amendment resolves the prior overdue-deadline exception.");
   assert.ok(readinessReport.exceptions.some(item=>item.issueKey===`CLOSING_DEADLINE_UPCOMING:${future(4)}`&&item.status==="OPEN"),
     "The amended persisted closing date gets a new active deadline exception rather than deleting history.");
  await assert.rejects(
    transactions.downloadPurchaseReviewDocument(id,reviewDocument.id,operator,now),
    (error:unknown)=>(error as {status?:number}).status===409,
    "a closing amendment must make a prior terms PDF unavailable for current use",
  );
  op = await transactions.recordClosingMilestone(id,{version:op.contract!.version,kind:"ASSIGNMENT_SIGNED",
    evidenceUrl:"https://example.com/synthetic-old-assignment",note:"SYNTHETIC former buyer assignment."},actor,now);
    const oldBuyerId = winnerBuyerId;
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
   const replacementCommitment = {version:op.contract!.version,buyerVersion:buyer.version,status:"COMMITTED" as const,
     evidence:"Synthetic owner-reviewed replacement commitment.",agreedPrice:130000,
     commitmentEvidenceUrl:"https://example.com/synthetic-replacement-assignment"};
   op = await transactions.recordBuyerResponse(id,buyer.id,replacementCommitment,actor,now);
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
  const earnestEvidence = {
    kind:"EARNEST_MONEY_CONFIRMED" as const,evidenceUrl:"https://example.com/synthetic-escrow-receipt",
    note:"Synthetic escrow receipt reviewed; no real deposit occurred.",amount:op.contract!.earnestMoney,
    currency:"USD" as const,evidenceKind:"ESCROW_RECEIPT" as const,counterpartyName:"SYNTHETIC ESCROW",
    paymentReference:"SYN-ESCROW-001",effectiveAt:now.toISOString(),
  };
   await assert.rejects(transactions.recordClosingMilestone(id,{...earnestEvidence,version:op.contract!.version},operator,now),
     (error:unknown)=>(error as {status?:number}).status===403,
     "An operator without owner authority cannot attest EMD completion.");
  await assert.rejects(transactions.recordClosingMilestone(id,{...earnestEvidence,amount:earnestEvidence.amount+1,
    version:op.contract!.version},actor,now),/equal the earnest money/);
  const buyerFundsEvidence = {
    kind:"FUNDS_CONFIRMED" as const,evidenceUrl:buyer.fundingEvidenceUrl!,
    note:"Synthetic current funding evidence reviewed; no real funds moved.",amount:buyer.availableFunds!,
    currency:"USD" as const,evidenceKind:"BANK_CONFIRMATION" as const,counterpartyName:"SYNTHETIC BANK",
    paymentReference:"SYN-FUNDS-001",effectiveAt:now.toISOString(),
  };
  await assert.rejects(transactions.recordClosingMilestone(id,{...buyerFundsEvidence,
    evidenceUrl:"https://example.com/synthetic-stale-funds",version:op.contract!.version},actor,now),
  /current owner-reviewed funding evidence/);
  const legacySparseContract = {...op.contract!,status:"CLOSING" as const,milestones:[
    {kind:"EARNEST_MONEY_CONFIRMED" as const,evidenceUrl:"https://example.com/synthetic-old-emd",
      note:"Legacy evidence link only.",recordedBy:actor.id,recordedAt:now.toISOString()},
    {kind:"FUNDS_CONFIRMED" as const,evidenceUrl:"https://example.com/synthetic-old-funds",
      note:"Legacy evidence link only.",recordedBy:actor.id,recordedAt:now.toISOString()},
  ]};
  const legacyBlockers = closingBlockers(legacySparseContract,undefined);
  assert.ok(legacyBlockers.some(x=>/Acquisition earnest-money evidence is incomplete/.test(x)),
    "Legacy generic EMD links cannot satisfy the structured closing gate.");
  assert.ok(legacyBlockers.some(x=>/Buyer-funds evidence is incomplete/.test(x)),
    "Legacy generic funds links cannot satisfy the current-funds evidence gate.");
  for (const kind of CLOSING_MILESTONES) {
    const details = kind==="EARNEST_MONEY_CONFIRMED" ? earnestEvidence
      : kind==="FUNDS_CONFIRMED" ? buyerFundsEvidence
        : {kind,evidenceUrl:`https://example.com/synthetic-${kind.toLowerCase()}`,note:"Synthetic reviewed evidence, no actual escrow activity."};
    op = await transactions.recordClosingMilestone(id,{version:op.contract!.version,...details},actor,now);
  }
  const recordedEarnest = op.contract?.milestones.find(m=>m.kind==="EARNEST_MONEY_CONFIRMED");
  const recordedFunds = op.contract?.milestones.find(m=>m.kind==="FUNDS_CONFIRMED");
  assert.equal(recordedEarnest?.amount,op.contract?.earnestMoney);
  assert.equal(recordedEarnest?.effectiveAt,now.toISOString());
  assert.equal(recordedFunds?.amount,buyer.availableFunds);
  assert.equal(recordedFunds?.evidenceUrl,buyer.fundingEvidenceUrl);
   readinessRuns = await evaluateAllTransactionReadiness(now);
   readinessReport = await getTransactionReadinessReport(now);
   assert.ok(readinessReport.exceptions.some(item=>item.issueKey==="CONTRACT_ECONOMICS_CONFLICT"&&item.status==="OPEN"),
     "A newly changed analysis version remains visibly inconsistent with the existing authorized contract terms.");
   assert.ok(readinessReport.exceptions.some(item=>item.issueKey.startsWith("STALE_DOCUMENT:")&&item.status==="OPEN"),
     "Prepared documents whose contract/economics snapshot changed remain blocked.");
   const [readinessEvidenceRow] = await db.select().from(contractsTable).where(eq(contractsTable.id,op.contract!.id));
   assert.ok(readinessEvidenceRow);
   const readinessBaselinePayload = readinessEvidenceRow!.payload;
   const baselineArtifacts = (readinessBaselinePayload.documentArtifacts ?? []) as Array<Record<string,unknown>>;
   const damagedArtifacts = baselineArtifacts.map(artifact => artifact.id === reviewDocument.id
     ? { ...artifact, economicsSnapshotHash:"f".repeat(64) }
     : artifact);
   await db.update(contractsTable).set({payload:{
     ...readinessBaselinePayload,documentArtifacts:damagedArtifacts,
   }}).where(eq(contractsTable.id,op.contract!.id));
   await evaluateAllTransactionReadiness(now);
   readinessReport = await getTransactionReadinessReport(now);
   assert.ok(readinessReport.exceptions.some(item=>item.issueKey==="MILESTONE_MISSING:EARNEST_MONEY_CONFIRMED"&&item.status==="RESOLVED"),
     "Actual persisted, correctly matched synthetic escrow evidence resolves the earlier missing-EMD exception.");
   assert.ok(readinessReport.exceptions.some(item=>item.issueKey===`STALE_DOCUMENT:${reviewDocument.id}`&&item.status==="OPEN"),
     "A changed economics hash is persisted as a stale-document exception.");
   const baselineMilestones = (readinessBaselinePayload.milestones ?? []) as unknown as Array<Record<string,unknown>>;
   const mismatchedMilestones = baselineMilestones.map(milestone =>
     milestone.kind === "EARNEST_MONEY_CONFIRMED" ? { ...milestone, amount:Number(milestone.amount)+1 } :
     milestone.kind === "FUNDS_CONFIRMED" ? { ...milestone, evidenceUrl:"https://example.com/SYNTHETIC-stale-funds" } :
     milestone);
   await db.update(contractsTable).set({payload:{
     ...readinessBaselinePayload,documentArtifacts:damagedArtifacts,milestones:mismatchedMilestones,
   }}).where(eq(contractsTable.id,op.contract!.id));
   await evaluateAllTransactionReadiness(now);
   readinessReport = await getTransactionReadinessReport(now);
   assert.ok(readinessReport.exceptions.some(item=>item.issueKey==="MILESTONE_INVALID:EARNEST_MONEY_CONFIRMED"&&item.status==="OPEN"),
     "Persisted EMD amount mismatch is detected even if the legacy row exists.");
   assert.ok(readinessReport.exceptions.some(item=>item.issueKey==="MILESTONE_INVALID:FUNDS_CONFIRMED"&&item.status==="OPEN"),
     "Persisted buyer-funds evidence with a stale reference is blocked.");
   await db.update(contractsTable).set({payload:readinessBaselinePayload}).where(eq(contractsTable.id,op.contract!.id));
   await evaluateAllTransactionReadiness(now);
   readinessReport = await getTransactionReadinessReport(now);
   assert.ok(readinessReport.exceptions.some(item=>item.issueKey==="MILESTONE_INVALID:EARNEST_MONEY_CONFIRMED"&&item.status==="RESOLVED"),
     "Valid persisted escrow evidence resolves its prior EMD mismatch with a referenced resolution.");
   readinessSummary = {
     syntheticTransactions: readinessReport.syntheticTransactionCount,
     realTransactions: readinessReport.realTransactionCount,
     capabilities: readinessReport.capabilities,
     persistedExceptions: readinessReport.exceptions.length,
     openExceptions: readinessReport.openExceptionCount,
     exercised: ["idempotent-re-evaluation", "upcoming-and-overdue-close", "amended-deadline-resolution",
       "packet-delivery-unconfirmed", "missing-template-signing-provider-and-private-storage",
       "stale-document-economics", "mismatched-emd-and-buyer-funds",
       "owner-only-financial-evidence", "resolution-from-persisted-emd-evidence"],
   };
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
   await evaluateAllTransactionReadiness(new Date(now.getTime()+5*86400000));
   readinessReport = await getTransactionReadinessReport(new Date(now.getTime()+5*86400000));
   const terminalExceptions = readinessReport.exceptions.filter(item=>item.contractId===op.contract!.id);
   assert.ok(terminalExceptions.length>0);
   assert.ok(terminalExceptions.every(item=>item.status==="RESOLVED"),
     "Terminal closure must resolve every open transaction exception with terminal-state evidence.");
   const terminalWork = await db.select().from(dealDecisionWorkItemsTable).where(eq(dealDecisionWorkItemsTable.leadId,id));
   assert.ok(terminalWork.every(item=>["COMPLETED","FAILED","EXPIRED"].includes(item.status)),
     "A closed deal must not retain runnable decision work.");
   readinessSummary = {
     ...readinessSummary,
     terminalOpenExceptions:terminalExceptions.filter(item=>item.status==="OPEN").length,
     terminalRunnableDecisionWork:terminalWork.filter(item=>!["COMPLETED","FAILED","EXPIRED"].includes(item.status)).length,
     terminalClosureResolution:terminalExceptions.filter(item=>item.status==="RESOLVED").length,
   };
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
   restarted = await transactions.preparePurchaseReviewDocument(nextId,{version:restarted.contract!.version},operator,now);
   const firstReviewCopy = restarted.contract!.documents!.at(-1)!;
   restarted = await transactions.transitionTransactionDocument(nextId,firstReviewCopy.id,{
     version:restarted.contract!.version,targetStatus:"REJECTED",reason:"SYNTHETIC review found an unresolved party-field issue."},operator,now);
   assert.equal(restarted.contract?.documents?.find(doc=>doc.id===firstReviewCopy.id)?.status,"REJECTED");
   assert.ok(restarted.contract?.documents?.find(doc=>doc.id===firstReviewCopy.id)?.events?.some(event=>event.to==="REJECTED"));
   restarted = await transactions.preparePurchaseReviewDocument(nextId,{version:restarted.contract!.version},operator,now);
   const voidReviewCopy = restarted.contract!.documents!.at(-1)!;
   await assert.rejects(transactions.transitionTransactionDocument(nextId,voidReviewCopy.id,{
     version:restarted.contract!.version,targetStatus:"VOID",reason:"SYNTHETIC owner void test."},operator,now),
     (error:unknown)=>(error as {status?:number}).status===403);
   restarted = await transactions.transitionTransactionDocument(nextId,voidReviewCopy.id,{
     version:restarted.contract!.version,targetStatus:"VOID",reason:"SYNTHETIC owner void test."},actor,now);
   assert.equal(restarted.contract?.documents?.find(doc=>doc.id===voidReviewCopy.id)?.status,"VOID");
   assert.ok(restarted.contract?.documents?.find(doc=>doc.id===voidReviewCopy.id)?.events?.some(event=>event.to==="VOID"));
   restarted = await transactions.preparePurchaseReviewDocument(nextId,{version:restarted.contract!.version},operator,now);
   const activeReviewCopy = restarted.contract!.documents!.at(-1)!;
   assert.equal(activeReviewCopy.status,"PREPARED_FOR_REVIEW");
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
   restarted = await transactions.preparePurchaseReviewDocument(nextId,{version:restarted.contract!.version},operator,now);
   assert.equal(restarted.contract?.documents?.find(doc=>doc.id===activeReviewCopy.id)?.status,"REPLACED",
     "a review copy from the cancelled attempt remains historical and is explicitly replaced by the new attempt's copy");
   assert.ok(restarted.contract?.documents?.find(doc=>doc.id===activeReviewCopy.id)?.events?.some(event=>event.to==="REPLACED"));
   assert.equal(restarted.contract?.documents?.at(-1)?.status,"PREPARED_FOR_REVIEW");
  async function verifyPreExecutionRevisionInvalidation() {
    const staleLead = await seller.createLead({address:"SYNTHETIC PRE-EXEC REVISION",city:"Synthetic City",state:"TX",county:"Synthetic County",zip:"75001",
      propertyType:"SINGLE_FAMILY",sqft:1000,beds:3,baths:2,units:1,askingPrice:100000,sellerName:"SYNTHETIC ONLY",sellerPhone:"000-000-0000",
      source:"SYNTHETIC stale-document exercise"},actor.id,now);
    const staleId = staleLead.id;
    let staleDetail = await seller.leadDetail(staleId);
    const staleAuthority = await seller.addIntelligence(staleId,{classification:"VERIFIED_FACTS",category:"ownership",
      statement:"SYNTHETIC owner authority evidence fixture",source:"SYNTHETIC public record",sourceType:"PUBLIC_RECORD",
      sourceUrl:"https://example.com/synthetic-preexec-owner",confidence:0.9,capturedAt:now.toISOString(),
      verificationNote:"SYNTHETIC isolated test data only."},actor.id,now);
    staleDetail = await seller.leadDetail(staleId);
    const staleBase = {
      version:staleDetail.lead.version,
      comps:[290000,300000,310000].map((salePrice,index)=>({id:`preexec-comp-${randomUUID()}`,
        address:`SYNTHETIC PREEXEC COMP ${index}`,sqft:1000,salePrice,
        soldAt:new Date(now.getTime()-10*86400000).toISOString().slice(0,10),distanceMiles:0.5,
        propertyType:"SINGLE_FAMILY" as const,condition:"RENOVATED" as const,
        source:"SYNTHETIC stale-document comp",verified:true})),
      repairs:[{category:"Synthetic repairs",low:10000,expected:20000,high:30000,confidence:0.8,source:"SYNTHETIC inspection"}],
      repairsComplete:true,conditionConfirmed:true,
    };
    const staleUnderwriting = await exerciseEvidence(staleId,staleBase,actor.id,now);
    staleDetail = await seller.saveUnderwriting(staleId,staleUnderwriting,actor.id,now);
    staleDetail = await seller.transitionLead(staleId,{version:staleDetail.lead.version,to:"CALL_READY",
      reason:"SYNTHETIC complete source fixture.",nextAction:"Synthetic call."},actor.id,now);
    staleDetail = await seller.recordCall(staleId,{version:staleDetail.lead.version,outcome:"CONNECTED",notes:"SYNTHETIC only.",
      nextAction:"Review terms.",followUpAt:future(1)},actor.id,now);
    staleDetail = await offers.createOfferDraft(staleId,{version:staleDetail.lead.version,amount:110000,earnestMoney:1000,
      closingDays:30,contingencies:"SYNTHETIC review",assignmentIntent:true,reason:"SYNTHETIC revision test"},actor,now);
    const staleOfferId = staleDetail.offers[0]!.id;
    staleDetail = await offers.authorizeOffer(staleId,staleOfferId,{version:staleDetail.lead.version,
      maximumApprovedAcquisitionPrice:120000,authorityEvidenceId:staleAuthority.id,expiresAt:future(2),
      reason:"SYNTHETIC approval only.",nextAction:"Record communication.",followUpAt:future(1)},actor,now);
    staleDetail = await offers.communicateOffer(staleId,staleOfferId,{version:staleDetail.lead.version,amount:110000,
      channel:"PHONE",evidence:"SYNTHETIC communication fixture; no call occurred.",
      nextAction:"Prepare review copy.",followUpAt:future(1)},operator,now);
    let staleOps = await transactions.createContract(staleId,{version:staleDetail.lead.version,
      offerId:staleOfferId,closingAt:future(20)},operator,now);
    staleOps = await transactions.preparePurchaseReviewDocument(staleId,{version:staleOps.contract!.version},operator,now);
    const prepared = staleOps.contract!.documents![0]!;
    assert.equal(prepared.status,"PREPARED_FOR_REVIEW");
    assert.equal(staleOps.contract?.status,"DRAFT");

    await seller.addIntelligence(staleId,{classification:"OBSERVED",category:"subject_condition",
      statement:"SYNTHETIC material change: newly documented condition evidence.",source:"SYNTHETIC inspection update",
      sourceType:"INSPECTION",sourceUrl:"https://example.com/synthetic-preexec-condition",
      confidence:0.8,capturedAt:now.toISOString()},actor.id,now);
    const changed = await seller.leadDetail(staleId);
    assert.equal(changed.analysis,null,"Material new evidence invalidates the saved analysis.");
    assert.equal(changed.offers.find(item=>item.id===staleOfferId)?.effectiveStatus,"INVALIDATED");
    await assert.rejects(transactions.downloadPurchaseReviewDocument(staleId,prepared.id,operator,now),
      /source offer is stale or revoked/);
    staleOps = await dealOperations(staleId,now);
    assert.equal(staleOps.contract?.status,"DRAFT");
    assert.equal(staleOps.contract?.documents?.[0]?.status,"PREPARED_FOR_REVIEW",
      "Stale prepared bytes remain historical review artifacts, not current or signed documents.");
    assert.equal(staleOps.contract?.sellerSignedAt??null,null);
    assert.equal(staleOps.contract?.acquisitionSignedAt??null,null);
    assert.equal(staleOps.contract?.executedDocumentUrl??null,null);
     staleOps = await transactions.transitionTransactionDocument(staleId,prepared.id,{
       version:staleOps.contract!.version,targetStatus:"EXPIRED",reason:"SYNTHETIC expiry after the source offer deadline."},
     actor,new Date(now.getTime()+3*86400000));
     assert.equal(staleOps.contract?.documents?.find(doc=>doc.id===prepared.id)?.status,"EXPIRED",
       "an elapsed authorized-offer deadline is recorded as persisted document expiry");
     assert.ok(staleOps.contract?.documents?.find(doc=>doc.id===prepared.id)?.events?.some(event=>event.to==="EXPIRED"));
     await assert.rejects(transactions.downloadPurchaseReviewDocument(staleId,prepared.id,operator,new Date(now.getTime()+3*86400000)),
       /expired and cannot be downloaded/);
  }
  await verifyPreExecutionRevisionInvalidation();
  logger.info("Cancellation/restart PASSED: owner-only, fresh underwriting/approval/communication, distinct attempt, original cancellation/signatures/terms/buyer history retained; CLOSED cannot reopen.");
    logger.info({checks:"persisted document registry and missing-template/private-storage/signing blockers; review PDF bytes separated into protected blob table; party/economic changes stale artifacts; persisted DRAFT → PREPARED → REJECTED/VOID/EXPIRED/REPLACED paths; separately evidenced execution never marks a review worksheet SIGNED; immutable economics hash shared with redacted packet; deadline/evidence exception persistence and terminal work cleanup",readinessSummary},"Full lifecycle persistence exercise PASSED (isolated synthetic schema)");
} finally { await pool.end(); }
