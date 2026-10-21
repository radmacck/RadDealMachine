import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { AddressInfo } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { db,pool,analysesTable,auditTable,contractsTable,jobsTable,matchesTable,buyersTable,leadsTable,transitionsTable,distributionPacketsTable,distributionRecipientsTable,transactionDocumentBlobsTable,transactionReadinessExceptionsTable,dealDecisionWorkItemsTable,transactionDocumentTemplatesTable,evidencePacketExportsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import * as seller from "./deal-store";
import { exerciseEvidence } from "./exercise-evidence";
import { assertSyntheticCallReadyBlocked, seedSyntheticPostGateContacted } from "./synthetic-post-gate-fixture";
import * as offers from "./offer-store";
import { authorizeReviewedOffer } from "./offer-exercise-helpers";
import * as transactions from "./transaction-store";
import * as buyers from "./buyer-store";
import { dealOperations,refreshMatches } from "./matching-store";
import { submitWorkerJob,runWorkerOnce } from "./workers";
import { commandCenter } from "./command-center";
import { CLOSING_MILESTONES, closingBlockers } from "@workspace/deal-domain";
import { buildTransactionReadinessChecklist } from "@workspace/deal-domain";
import { recordTransactionException } from "./transaction-exceptions";
import { reviewHandoffs, listHandoffs, recordHandoffEvent } from "./handoffs";
import { getBuyerRecord } from "./operations-records";
import { requestBuyerQualification } from "./buyer-pool";
import {
  authorizeDealDistribution, getBuyerPortalDeal, getDealDistribution,
  getDistributionPreferences, updateDistributionPreferences, downloadBuyerPacketPdf,
  respondToBuyerPortalDeal, shareDistributionRecipients,
} from "./distribution-store";
import { getTransactionDocumentReadiness } from "./transaction-document-registry";
import { propagateStaleTransactionDocuments } from "./transaction-store";
import { exportDealEvidencePacket } from "./evidence-packet";
import { createTransactionTemplateReviewRouter } from "../routes/operations";
import { publicBuyerPortalRouter } from "../routes/distribution";
import { evaluateAllTransactionReadiness, getTransactionReadinessReport } from "./transaction-readiness";
import {
  approveExactDistributionMessage, assertExactDistributionApprovalCurrent, buyerConsentSnapshotHash,
  assertDistributionSubmissionReady, applyDistributionProviderEvent,
} from "./buyer-outreach";
const actor = {id:`synthetic-transaction:${randomUUID()}`,role:"OWNER"};
const operator = {...actor,role:"OPERATOR"};
const now = new Date();
const future = (days:number)=>new Date(now.getTime()+days*86400000).toISOString();
const dateOnly = (days:number)=>future(days).slice(0,10);
let readinessSummary: Record<string,unknown> = {};
let readinessDeadlineKeys: {upcoming:string;overdue:string}|null = null;
try {
  // All these writes are isolated by the harness's connection-wide search path.
  let lead = await seller.createLead({address:"SYNTHETIC COMPLETE DEAL",city:"Synthetic City",state:"TX",county:"Synthetic County",zip:"75001",
    propertyType:"SINGLE_FAMILY",sqft:1000,beds:3,baths:2,units:1,askingPrice:100000,
    sellerName:"SYNTHETIC ONLY",sellerPhone:"000-000-0000",source:"Synthetic service exercise, not a real deal"},actor.id,now);
  const id = lead.id;
  const [syntheticLeadRow] = await db.select().from(leadsTable).where(eq(leadsTable.id,id));
  await db.update(leadsTable).set({payload:{...syntheticLeadRow!.payload,synthetic:true}}).where(eq(leadsTable.id,id));
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
  await assertSyntheticCallReadyBlocked(id, actor.id, now);
  logger.info("EXPECTED SECURITY BLOCK: CALL_READY returned 409; CALL NEXT and gate-success assertions are skipped for this synthetic record.");
  detail = await seedSyntheticPostGateContacted(id, actor.id, now);
  detail = await seller.recordCall(id,{version:detail.lead.version,outcome:"CONNECTED",notes:"Synthetic conversation, no external call.",nextAction:"Review terms.",followUpAt:future(1)},actor.id,now);
  assert.equal(detail.lead.stage,"CONVERSATION","Downstream transaction checks run only from an explicitly seeded synthetic post-gate state.");
  logger.info("SYNTHETIC POST-GATE FIXTURE: downstream transaction assertions may proceed; no authorization success or real contact is claimed.");
  detail = await offers.createOfferDraft(id,{version:detail.lead.version,amount:110000,earnestMoney:1000,closingDays:30,
    contingencies:"Synthetic title and diligence",assignmentIntent:true,reason:"Synthetic terms"},actor,now);
  const offerId = detail.offers[0]!.id;
  detail = await authorizeReviewedOffer(id,offerId,{version:detail.lead.version,maximumApprovedAcquisitionPrice:120000,
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
  await assert.rejects(transactions.createContract(id,{version:detail.lead.version,offerId:randomUUID(),closingAt:future(20)},operator,now),
    /current owner-approved, actually communicated exact-term offer/i,
    "A transaction cannot be assembled from an offer without persisted approval and communication.");
  let op = await transactions.createContract(id,{version:detail.lead.version,offerId,closingAt:future(20)},operator,now);
  assert.equal(op.contract?.status,"DRAFT"); assert.equal(op.contract?.purchasePrice,110000);
  const partyChecklist=buildTransactionReadinessChecklist(detail,op.contract!,now);
  assert.equal(partyChecklist.find(item=>item.key==="party_identity")?.status,"NEEDS_EVIDENCE");
  assert.equal(partyChecklist.find(item=>item.key==="signatures")?.status,"NEEDS_EVIDENCE");
  assert.equal(partyChecklist.find(item=>item.key==="disclosures")?.status,"REVIEW_REQUIRED");
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
  const [reviewTemplate] = await db.select().from(transactionDocumentTemplatesTable)
    .where(and(eq(transactionDocumentTemplatesTable.jurisdiction,"US/TX/SYNTHETIC-COUNTY"),
      eq(transactionDocumentTemplatesTable.templateKey,"AMENDMENT")));
  assert.ok(reviewTemplate,"A persisted jurisdiction template registry entry is required for review.");
  const reviewInput = {
    expectedVersion:reviewTemplate.version,decision:"APPROVED" as const,
    sourceRef:"SYNTHETIC:approved-template-source",sourceProvenance:{synthetic:true,source:"exercise-only"},
    templateStorageRef:"SYNTHETIC:template-bytes-not-present",templateHash:"a".repeat(64),
    reviewerIdentity:"synthetic-qualified-reviewer",reviewerQualificationRef:"SYNTHETIC:reviewer-qualification",
    reviewEvidenceRef:"SYNTHETIC:review-approval-evidence",effectiveAt:now.toISOString(),
    supportedDealTypes:["PURCHASE"],reason:"SYNTHETIC persisted qualified-review path exercise.",
  };
  const beforeReview = await seller.leadDetail(id);
  const economicsBeforeReview = {
    analysisSnapshotId:beforeReview.analysisSnapshotId,
    arv:beforeReview.analysis?.arv,repairs:beforeReview.analysis?.repairs,
    mao:beforeReview.analysis?.mao,
    authorized:beforeReview.offers.filter(item=>["AUTHORIZED","COMMUNICATED"].includes(item.effectiveStatus))
      .map(({id:offerId,amount,maximumApprovedAcquisitionPrice,analysisSnapshotId:snapshot})=>({offerId,amount,maximumApprovedAcquisitionPrice,snapshot})),
  };
  const reviewApp=express();
  reviewApp.use(express.json());
  reviewApp.use(createTransactionTemplateReviewRouter(
    (req,res,next)=>{res.locals.actor=req.get("x-test-actor")??"";next();},
    (req,res,next)=>{res.locals.role=req.get("x-test-role")??"PENDING";next();},
  ));
  reviewApp.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
    const status=Number((error as {status?:number})?.status)||500;
    res.status(status).json({error:(error as Error)?.message??"Synthetic route failure."});
  });
  const reviewServer=reviewApp.listen(0,"127.0.0.1");
  await once(reviewServer,"listening");
  const reviewAddress=reviewServer.address() as AddressInfo;
  let ownerReviewResponse:Response;
  try {
    const reviewUrl=`http://127.0.0.1:${reviewAddress.port}/transaction-document-templates/${reviewTemplate.id}/review`;
    const denied=await fetch(reviewUrl,{method:"POST",headers:{"content-type":"application/json","x-test-actor":operator.id,"x-test-role":"OPERATOR"},body:JSON.stringify(reviewInput)});
    assert.equal(denied.status,403,"Actual review endpoint must reject non-owner roles.");
    ownerReviewResponse=await fetch(reviewUrl,{method:"POST",headers:{"content-type":"application/json","x-test-actor":actor.id,"x-test-role":"OWNER"},body:JSON.stringify(reviewInput)});
    assert.equal(ownerReviewResponse.status,200,"Owner session must reach and persist the actual review endpoint.");
    const staleReview=await fetch(reviewUrl,{method:"POST",headers:{"content-type":"application/json","x-test-actor":actor.id,"x-test-role":"OWNER"},body:JSON.stringify(reviewInput)});
    assert.equal(staleReview.status,409,"Stale template revision must be rejected over HTTP.");
  } finally {
    await new Promise<void>((resolve,reject)=>reviewServer.close(error=>error?reject(error):resolve()));
  }
  const reviewedTemplate=await ownerReviewResponse!.json() as {status:string;version:number;reviewState:string;sourceProvenance:{synthetic?:boolean}};
  assert.equal(reviewedTemplate.status,"APPROVED_LEGAL");
  assert.equal(reviewedTemplate.version,reviewTemplate.version+1);
  assert.equal(reviewedTemplate.reviewState,"APPROVED");
  assert.equal(reviewedTemplate.sourceProvenance.synthetic,true,"Synthetic review evidence must remain explicitly synthetic.");
  const afterReview=await seller.leadDetail(id);
  assert.deepEqual({
    analysisSnapshotId:afterReview.analysisSnapshotId,
    arv:afterReview.analysis?.arv,repairs:afterReview.analysis?.repairs,
    mao:afterReview.analysis?.mao,
    authorized:afterReview.offers.filter(item=>["AUTHORIZED","COMMUNICATED"].includes(item.effectiveStatus))
      .map(({id:offerId,amount,maximumApprovedAcquisitionPrice,analysisSnapshotId:snapshot})=>({offerId,amount,maximumApprovedAcquisitionPrice,snapshot})),
  },economicsBeforeReview,"Template review must not change deterministic underwriting or authorized offer limits.");
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
  const unrelatedLead = await seller.createLead({
    address:"SYNTHETIC UNRELATED RECORD",city:"Synthetic City",state:"TX",county:"Synthetic County",zip:"75002",
    propertyType:"SINGLE_FAMILY",sqft:900,beds:2,baths:1,units:1,askingPrice:0,
    sellerName:"SYNTHETIC ONLY",sellerPhone:"000-000-0000",source:"Synthetic cross-record access test",
  },actor.id,now);
  await assert.rejects(
    transactions.downloadPurchaseReviewDocument(unrelatedLead.id,reviewDocument.id,operator,now),
    (error:unknown)=>(error as {status?:number}).status===404,
    "a document ID from one property must not disclose bytes when paired with another property ID",
  );
  const parsedPdf = await PDFDocument.load(reviewFile.bytes);
  assert.equal(parsedPdf.getPageCount(),2,"Review PDF includes both the frozen terms and contract-data assembly checklist.");
  const fillableNames = parsedPdf.getForm().getFields().map(field=>field.getName());
  assert.ok(fillableNames.includes("seller_legal_name"));
  assert.ok(fillableNames.includes("parcel_legal_description"));
  assert.ok(fillableNames.includes("additional_terms_for_review"));
  const [persistedContract] = await db.select().from(contractsTable).where(eq(contractsTable.leadId,id));
  const persistedArtifacts = persistedContract?.payload.documentArtifacts as Array<Record<string,unknown>>|undefined;
  assert.equal(persistedArtifacts?.length,1);
  assert.equal(persistedArtifacts?.[0]?.contentHash,reviewDocument.contentHash);
  const assembly=persistedArtifacts?.[0]?.dataAssembly as {
    version:number;snapshotHash:string;sourceLinks:Array<{sourceId:string;status:string}>;
    jurisdiction:{checklistScope:string;purchaseTemplateStatus:string};
    signatureRouting:{status:string;blockers:string[]};missingRequiredData:string[];
     clauseNotice:string;
  }|undefined;
  assert.equal(assembly?.version,1);
  assert.match(assembly?.snapshotHash??"",/^[a-f0-9]{64}$/);
  assert.ok(assembly?.sourceLinks.some(source=>source.sourceId===reviewDocument.sourceOfferId&&source.status==="AUTHORIZED"));
  assert.equal(assembly?.jurisdiction.checklistScope,"US/TX/SYNTHETIC-COUNTY");
  assert.equal(assembly?.signatureRouting.status,"BLOCKED");
  assert.ok(assembly?.missingRequiredData.some(item=>item.includes("Seller legal identity")));
   assert.match(assembly?.clauseNotice??"",/not generated or inserted/i,
     "Special clauses stay outside the assembled contract data until qualified review and separate human approval.");
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
    /source offer is stale|Seller identity\/contact fields changed/,"a changed seller party must invalidate the exact offer/document snapshot");
  await db.update(leadsTable).set({payload:currentLeadRow!.payload}).where(eq(leadsTable.id,id));
  const versionAfterPdf = op.contract!.version;
  op = await transactions.preparePurchaseReviewDocument(id,{version:versionAfterPdf},operator,now);
  assert.equal(op.contract?.version,versionAfterPdf,"same authorized snapshot must be idempotent");
  assert.equal(op.contract?.documents?.length,1);
  const execute = {version:op.contract!.version,executedDocumentUrl:"https://example.com/synthetic-contract",
    sellerSignedAt:now.toISOString(),acquisitionSignedAt:now.toISOString(),reviewNote:"Synthetic owner verification, not real signatures."};
  await assert.rejects(transactions.executeContract(id,execute,operator,now),e=>(e as {status:number}).status===403);
  await assert.rejects(transactions.executeContract(id,{...execute,sellerSignedAt:future(1)},actor,now),/future/);
  const offerExpiry=detail.offers.find(item=>item.id===offerId)?.expiresAt;
  assert.ok(offerExpiry,"The communicated offer carries its persisted approval expiry.");
  const afterOfferExpiry=new Date(Date.parse(offerExpiry!)+1000);
  await assert.rejects(transactions.executeContract(id,{
    ...execute,sellerSignedAt:afterOfferExpiry.toISOString(),acquisitionSignedAt:afterOfferExpiry.toISOString(),
  },actor,new Date(afterOfferExpiry.getTime()+1000)),/precede its expiry/i,
  "Signatures after exact offer approval expiry cannot execute the transaction.");
  // Recording after approval expiry is allowed ONLY for historically valid signatures.
  // Evaluate after the title due date's local end-of-day boundary; the deadline engine
  // intentionally does not mark a due-date milestone overdue before its local day ends.
  const executionNow = new Date(now.getTime()+4*86400000);
  op = await transactions.executeContract(id,execute,actor,executionNow);
  const initialDeadlineSchedule = {
    version:op.contract!.version,deadlineScheduleVersion:op.contract!.deadlineScheduleVersion,
    idempotencyKey:"synthetic-deadline-review-initial",sourceEvidenceUrl:execute.executedDocumentUrl,
    reviewNote:"SYNTHETIC schedule exercise only; the fixture is not a real transaction or date.",
    items:[
      {kind:"TITLE_CLEARED" as const,disposition:"DUE_DATE" as const,dueDate:dateOnly(2),timeZone:"America/New_York",basisNote:"SYNTHETIC contract clause 4 title target."},
      {kind:"INSPECTION_COMPLETED" as const,disposition:"DUE_DATE" as const,dueDate:dateOnly(4),timeZone:"America/New_York",basisNote:"SYNTHETIC contract clause 6 inspection date."},
      {kind:"EARNEST_MONEY_CONFIRMED" as const,disposition:"DUE_DATE" as const,dueDate:dateOnly(6),timeZone:"America/New_York",basisNote:"SYNTHETIC contract clause 2 escrow deadline."},
      {kind:"ASSIGNMENT_SIGNED" as const,disposition:"NO_FIXED_DATE" as const,dueDate:null,timeZone:null,basisNote:"SYNTHETIC agreement has no fixed assignment date."},
      {kind:"FUNDS_CONFIRMED" as const,disposition:"NOT_APPLICABLE" as const,dueDate:null,timeZone:null,basisNote:"SYNTHETIC no buyer was committed at this review."},
    ],
  };
  await evaluateAllTransactionReadiness(executionNow);
  let deadlineReport = await getTransactionReadinessReport(executionNow);
  assert.ok(deadlineReport.exceptions.some(item=>
    item.contractId===op.contract?.id&&item.issueKey==="MILESTONE_SCHEDULE_REVIEW_REQUIRED"&&item.status==="OPEN"),
    "An active executed transaction without a reviewed milestone schedule is explicitly blocked.");
  await assert.rejects(
    transactions.recordTransactionDeadlineSchedule(id,initialDeadlineSchedule,operator,executionNow),
    (error:unknown)=>(error as {status?:number}).status===403,
    "Only the owner can schedule contractual milestones.",
  );
  await assert.rejects(
    transactions.recordTransactionDeadlineSchedule(id,{...initialDeadlineSchedule,
      sourceEvidenceUrl:"https://example.com/synthetic-stale-contract"},actor,executionNow),
    /latest executed agreement or amendment only/,
    "A schedule must cite the current executed agreement.",
  );
   const contractVersionBeforeSchedule = op.contract!.version;
   op = await transactions.recordTransactionDeadlineSchedule(id,initialDeadlineSchedule,actor,executionNow);
  assert.equal(op.contract?.deadlineScheduleVersion,1);
   assert.equal(op.contract?.version,contractVersionBeforeSchedule+1,
     "A saved deadline schedule is a contract revision and invalidates stale contract-version commands.");
   await assert.rejects(transactions.recordTransactionDeadlineSchedule(id,{...initialDeadlineSchedule,
     idempotencyKey:"synthetic-stale-contract-version",deadlineScheduleVersion:1},actor,executionNow),/Transaction changed/,
     "A fresh schedule command cannot use the contract version from before the prior schedule revision.");
  const ownerCalendar=await commandCenter("OWNER",executionNow);
  const titleCalendarId=`CALENDAR:MILESTONE:${op.contract!.id}:1:TITLE_CLEARED`;
  assert.equal(ownerCalendar.actions.filter(action=>action.id===titleCalendarId).length,1,
    "The unified calendar projects a persisted milestone once with a stable schedule-version key.");
  assert.equal(ownerCalendar.actions.find(action=>action.id===titleCalendarId)?.dueAt,dateOnly(2));
  const closingCalendarId=`CALENDAR:CLOSING:${op.contract!.id}:1:${op.contract!.closingAt}`;
  assert.equal(ownerCalendar.actions.filter(action=>action.id===closingCalendarId).length,1,
    "The recorded closing term appears exactly once in the calendar.");
  assert.equal(ownerCalendar.actions.find(action=>action.id===closingCalendarId)?.dueAt,op.contract!.closingAt);
  const analystCalendar=await commandCenter("ANALYST",executionNow);
  assert.equal(analystCalendar.actions.some(action=>action.id.startsWith("CALENDAR:")),false,
    "Calendar reminders containing deal dates are not exposed to analyst-only roles.");
  const deadlineHistoryCount = op.contract?.deadlineScheduleHistory.length;
   const contractVersionBeforeReplay = op.contract?.version;
  op = await transactions.recordTransactionDeadlineSchedule(id,initialDeadlineSchedule,actor,executionNow);
  assert.equal(op.contract?.deadlineScheduleHistory.length,deadlineHistoryCount,"Idempotent schedule replay must not append a second revision.");
   assert.equal(op.contract?.version,contractVersionBeforeReplay,"An exact idempotent schedule replay must not create another contract revision.");
  assert.equal(op.contract?.milestones.length,0,"Recording due dates must not record milestone completion.");
  await evaluateAllTransactionReadiness(executionNow);
  deadlineReport = await getTransactionReadinessReport(executionNow);
  assert.ok(deadlineReport.exceptions.some(item=>
    item.contractId===op.contract?.id&&item.issueKey===`MILESTONE_DEADLINE_OVERDUE:TITLE_CLEARED:${dateOnly(2)}`&&item.status==="OPEN"),
    `An overdue title date is persisted as a distinct, evidence-linked transaction exception. Observed: ${JSON.stringify(deadlineReport.exceptions.filter(item=>item.contractId===op.contract?.id).map(item=>({key:item.issueKey,status:item.status,reason:item.reason})))}`);
  assert.ok(deadlineReport.exceptions.some(item=>
    item.contractId===op.contract?.id&&item.issueKey===`MILESTONE_DEADLINE_UPCOMING:INSPECTION_COMPLETED:${dateOnly(4)}`&&item.status==="OPEN"),
    "A persisted contract review creates an upcoming inspection exception from its calendar date and reviewed time zone.");
  assert.ok(deadlineReport.exceptions.some(item=>
    item.contractId===op.contract?.id&&item.issueKey==="MILESTONE_SCHEDULE_REVIEW_REQUIRED"&&item.status==="RESOLVED"),
    "The owner-reviewed schedule resolves the missing-schedule exception without recording milestone completion.");
  op = await transactions.recordClosingMilestone(id,{version:op.contract!.version,kind:"INSPECTION_COMPLETED",
    evidenceUrl:"https://example.com/synthetic-inspection-report",
    note:"SYNTHETIC inspection evidence only; no real property was inspected.",effectiveAt:now.toISOString()},actor,executionNow);
  await evaluateAllTransactionReadiness(executionNow);
  deadlineReport = await getTransactionReadinessReport(executionNow);
  assert.ok(deadlineReport.exceptions.some(item=>
    item.contractId===op.contract?.id&&item.issueKey===`MILESTONE_DEADLINE_UPCOMING:INSPECTION_COMPLETED:${dateOnly(4)}`&&item.status==="RESOLVED"),
    "A separately persisted inspection event with distinct event/record times resolves the due-date exception.");
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
   const operationsBeforeBuyerMatch=await dealOperations(id,now);
   assert.equal(operationsBeforeBuyerMatch.contract?.purchasePrice,110000);
   const economicsBeforeBuyerMatch = {
     purchasePrice:operationsBeforeBuyerMatch.contract?.purchasePrice,
     assignmentTarget:operationsBeforeBuyerMatch.contract?.assignmentTarget,
     earnestMoney:operationsBeforeBuyerMatch.contract?.earnestMoney,
     analysisSnapshotId:detail.analysisSnapshotId,
     mao:detail.analysis?.mao,
   };
   let buyer = await buyers.createBuyer({name:"SYNTHETIC QUALIFIED BUYER",email:"synthetic@example.com",phone:"",
     source:"Owner-reviewed qualification scenario (isolated exercise)",status:"ACTIVE",criteria:{states:["TX"],cities:["Synthetic City"],zipCodes:[],
      propertyTypes:["SINGLE_FAMILY"],maxPurchasePrice:200000,maxRepairs:50000,minBeds:2,minSqft:500,maxSqft:2000,closingDays:3,
      counties:[],excludedCounties:[],excludedCities:[],excludedZipCodes:[],minPurchasePrice:0,minUnits:1,maxUnits:1,
      minBaths:1,rehabTolerance:"HEAVY",strategies:["FLIP"],fundingTypes:["CASH"],maxConcurrentDeals:2}},actor);
   op = await refreshMatches(id,now);
   const unverifiedMatch=op.matches.find(m=>m.buyerId===buyer.id)!;
   assert.equal(unverifiedMatch.eligible,false);
   assert.ok(unverifiedMatch.mismatches.some(reason=>/identity\/funding review is missing or stale/i.test(reason)),
     `Match exclusions must explain the persisted buyer-proof gap; got: ${JSON.stringify(unverifiedMatch.mismatches)}`);
   const initialBuyerDemandWork = await db.select().from(dealDecisionWorkItemsTable)
     .where(and(eq(dealDecisionWorkItemsTable.leadId,id),eq(dealDecisionWorkItemsTable.actionCode,"BUYER_DEMAND")));
   assert.ok(initialBuyerDemandWork.some(item=>item.status==="READY"),
     "No eligible acquisition buyer creates a durable buyer-demand work item.");
   assert.equal(initialBuyerDemandWork.find(item=>item.status==="READY")?.payload.synthetic,true,
     "Synthetic transaction fixtures remain visibly synthetic and cannot count as real demand.");
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
   const economicsAfterBuyerMatch = await seller.leadDetail(id,db,now);
   assert.deepEqual({
     purchasePrice:op.contract?.purchasePrice,
     assignmentTarget:op.contract?.assignmentTarget,
     earnestMoney:op.contract?.earnestMoney,
     analysisSnapshotId:economicsAfterBuyerMatch.analysisSnapshotId,
     mao:economicsAfterBuyerMatch.analysis?.mao,
   },economicsBeforeBuyerMatch,"Buyer match evaluation must not change persisted deal economics or its approved analysis snapshot.");
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
     await buyers.recordBuyerContactPermission(buyer.id,{version:buyer.version,status:"GRANTED",channels:["EMAIL"],
      source:"SYNTHETIC transaction fixture permission",evidenceUrl:"https://example.com/synthetic-buyer-permission",
      capturedAt:now.toISOString(),validUntil:future(10)},actor,now);
     buyer = await getBuyerRecord(buyer.id,db,now);
   op = await refreshMatches(id,now);
   assert.equal(op.matches.find(m=>m.buyerId===buyer.id)?.eligible,true);
   const workspaceDetail = await seller.leadDetail(id,db,now);
   const workspaceOperations = await dealOperations(id,now);
   assert.equal(workspaceDetail.lead.id,id);
   assert.ok(workspaceDetail.calls.some(call=>call.outcome==="CONNECTED"),
     "Workspace call history must load persisted seller outcomes rather than infer a call from a stage.");
   const workspaceOffer=workspaceDetail.offers.find(item=>item.id===offerId);
   assert.equal(workspaceOffer?.effectiveStatus,"INVALIDATED",
     "The workspace must expose the backend's stale approval state after linked evidence changed.");
   assert.equal(workspaceOffer?.analysisSnapshotId,approvedSnapshot,
     "The invalidated offer must retain its original underwriting snapshot lineage.");
   assert.equal(workspaceOperations.contract?.leadId,id);
   assert.equal(workspaceOperations.matches.find(item=>item.buyerId===buyer.id)?.eligible,true);
   assert.ok(workspaceOperations.jobs.some(item=>item.kind==="MATCH_BUYERS"&&item.state==="SUCCEEDED"),
     "Workspace eligibility and job status must reflect persisted backend records.");
   let competitor = await buyers.createBuyer({name:"SYNTHETIC SECOND QUALIFIED BUYER",email:"synthetic-second@example.com",phone:"",
     source:"Owner-reviewed competing qualification scenario (isolated exercise)",status:"ACTIVE",criteria:buyer.criteria},actor);
  competitor = await buyers.verifyBuyer(competitor.id,{...verificationInput,version:competitor.version},actor,now);
    await buyers.recordBuyerContactPermission(competitor.id,{version:competitor.version,status:"GRANTED",channels:["EMAIL"],
     source:"SYNTHETIC transaction fixture permission",evidenceUrl:"https://example.com/synthetic-second-buyer-permission",
     capturedAt:now.toISOString(),validUntil:future(10)},actor,now);
    competitor = await getBuyerRecord(competitor.id,db,now);
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
     await assert.rejects(updateDistributionPreferences({redactAddress:false},operator),/cannot perform this operation/i);
     const savedPreference = await updateDistributionPreferences({redactAddress:false},actor);
     assert.equal(savedPreference.redactAddress,false,"Owner's disclosure preference must persist.");
     assert.equal((await getDistributionPreferences()).redactAddress,false,"Preference must reload from persistent storage.");
     await updateDistributionPreferences({redactAddress:true},actor);
     let distribution = await authorizeDealDistribution(id,{version:op.contract!.version,
      reason:"Synthetic owner authorization for isolated distribution exercise."},actor,now);
    assert.ok(distribution.packetId);
     assert.equal(distribution.packet?.addressRedacted,true);
     assert.equal(distribution.packet?.location.streetAddress,null);
      const packetHash=createHash("sha256").update(JSON.stringify(distribution.packet)).digest("hex");
      const exactBuyerMessage="SYNTHETIC exercise only: review this redacted buyer packet.";
       const approvedConsent=buyer.contactPermission!;
       const approvedRecipientRoute=buyer.email!;
       const approvalBinding={
         recipientRoute:approvedRecipientRoute,redactionLevel:"REDACTED" as const,
         packageAuthorizationId:distribution.packetId!,
         consentSnapshotHash:buyerConsentSnapshotHash(approvedConsent),
          expiresAt:distribution.expiresAt!,
       };
      const messageApproval=approveExactDistributionMessage({
        buyerId:buyer.id,channel:"EMAIL",packetVersion:distribution.version,packetSnapshotHash:packetHash,
         ...approvalBinding,exactMessage:exactBuyerMessage,approvedBy:actor.id,approvedAt:now.toISOString(),
      });
      assertExactDistributionApprovalCurrent(messageApproval,{
        buyerId:buyer.id,channel:"EMAIL",packetVersion:distribution.version,
         packetSnapshotHash:packetHash,...approvalBinding,exactMessage:exactBuyerMessage,
      });
      assert.throws(()=>assertExactDistributionApprovalCurrent(messageApproval,{
        buyerId:buyer.id,channel:"EMAIL",packetVersion:distribution.version+1,
         packetSnapshotHash:packetHash,...approvalBinding,exactMessage:exactBuyerMessage,
      }),/stale/,"A changed packet version invalidates message approval.");
       assert.throws(()=>assertDistributionSubmissionReady(messageApproval,{
         buyerId:buyer.id,channel:"EMAIL",packetVersion:distribution.version,
          packetSnapshotHash:packetHash,...approvalBinding,exactMessage:exactBuyerMessage,
        },approvedConsent,"EMAIL",undefined,now,true),
         /provider/,"No connected provider means no outbound submission even with current consent.");
      const acceptedEvent={eventId:"synthetic-provider-accept",providerId:"synthetic-provider",
        providerMessageId:"synthetic-message",state:"PROVIDER_ACCEPTED" as const,occurredAt:now.toISOString()};
      assert.throws(()=>applyDistributionProviderEvent([],{
        ...acceptedEvent,eventId:"synthetic-provider-delivered",state:"DELIVERED",
      }),/requires a matching provider-accepted/,"Delivery cannot be asserted from a portal access or draft.");
      const providerEvents=applyDistributionProviderEvent([],acceptedEvent);
      assert.deepEqual(applyDistributionProviderEvent(providerEvents,acceptedEvent),providerEvents,
        "Exact duplicate provider callbacks are idempotent.");
      const deliveredEvents=applyDistributionProviderEvent(providerEvents,{
        ...acceptedEvent,eventId:"synthetic-provider-delivered",state:"DELIVERED",
      });
      assert.deepEqual(deliveredEvents.map(event=>event.state),["PROVIDER_ACCEPTED","DELIVERED"]);
      assert.equal((await getDealDistribution(id)).packet?.economics.economicsSnapshotHash,
        distribution.packet?.economics.economicsSnapshotHash,"Message approval and provider receipts do not alter locked buyer economics.");
     await updateDistributionPreferences({redactAddress:false},actor);
     const stillFrozen = await getDealDistribution(id);
     assert.equal(stillFrozen.packet?.addressRedacted,true,
       "Changing the workspace preference must not mutate an already-authorized packet.");
     assert.equal(stillFrozen.packet?.location.streetAddress,null);
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
     source:"Owner-reviewed qualification scenario (isolated expiry test)",status:"ACTIVE",criteria:buyer.criteria},actor);
     const olderEvidenceAt = new Date(now.getTime()-29*86400000);
     staleBuyer = await buyers.verifyBuyer(staleBuyer.id,{...verificationInput,version:staleBuyer.version,
       evidenceAt:olderEvidenceAt.toISOString(),buyingEvidenceAt:olderEvidenceAt.toISOString(),
       validUntil:new Date(olderEvidenceAt.getTime()+30*86400000).toISOString()},actor,now);
     const afterExpiry = new Date(olderEvidenceAt.getTime()+30*86400000+1000);
     const expiredBuyer = await getBuyerRecord(staleBuyer.id,db,afterExpiry);
     assert.equal(expiredBuyer.approvalStatus,"REVERIFICATION_REQUIRED");
      await assert.rejects(shareDistributionRecipients(distribution.packetId!,{
        version:distribution.version,buyerIds:[staleBuyer.id],
      },operator,now),/cannot perform this operation/i,
      "Operators cannot authorize a capability link for external sharing.");
      await assert.rejects(shareDistributionRecipients(distribution.packetId!,{
        version:distribution.version,buyerIds:[staleBuyer.id],
      },actor,now),/contact permission/i,
      "A verified buyer without current channel-specific permission cannot receive a capability link.");
      await buyers.recordBuyerContactPermission(staleBuyer.id,{version:staleBuyer.version,status:"GRANTED",channels:["EMAIL"],
        source:"SYNTHETIC stale-buyer permission fixture",evidenceUrl:"https://example.com/synthetic-stale-buyer-permission",
        capturedAt:now.toISOString(),validUntil:future(10)},actor,now);
      staleBuyer = await getBuyerRecord(staleBuyer.id,db,now);
     await assert.rejects(shareDistributionRecipients(distribution.packetId!,{
       version:distribution.version,buyerIds:[unverifiedBuyer.id],
     },actor,now),/no longer qualified/i,
     "An unverified prospect cannot receive an authorized multi-buyer packet.");
     await assert.rejects(shareDistributionRecipients(distribution.packetId!,{
       version:distribution.version,buyerIds:[staleBuyer.id],
     },actor,afterExpiry),/no longer qualified/i,
     "A buyer whose current verification expired cannot receive a packet.");
     assert.equal((await getDealDistribution(id)).recipients.length,0,
       "Failed stale/unverified recipient checks must not persist distribution links.");
      const staleAccessShare = await shareDistributionRecipients(distribution.packetId!,{
        version:distribution.version,buyerIds:[staleBuyer.id],
       },actor,now);
       assert.equal(staleAccessShare.links.length,1,"The owner may issue a capability after current eligibility and permission checks.");
       const [linkAuthorizationRow] = await db.select().from(distributionRecipientsTable).where(and(
         eq(distributionRecipientsTable.packetId,distribution.packetId!),eq(distributionRecipientsTable.buyerId,staleBuyer.id)));
       const linkAuthorization=linkAuthorizationRow?.payload.linkAuthorization as {
         kind:string; packetId:string; buyerId:string; contentHash:string; economicsSnapshotHash:string;
         redactionLevel:string; recipientRouteHash:string; consentSnapshotHash:string; expiresAt:string; approvedBy:string;
       }|undefined;
       assert.equal(linkAuthorization?.kind,"LINK_ISSUANCE_ONLY");
       assert.equal(linkAuthorization?.packetId,distribution.packetId);
       assert.equal(linkAuthorization?.buyerId,staleBuyer.id);
       assert.equal(linkAuthorization?.economicsSnapshotHash,distribution.packet?.economics.economicsSnapshotHash);
       assert.equal(linkAuthorization?.redactionLevel,"REDACTED");
       assert.match(linkAuthorization?.contentHash??"",/^[a-f0-9]{64}$/);
       assert.match(linkAuthorization?.recipientRouteHash??"",/^[a-f0-9]{64}$/);
       assert.match(linkAuthorization?.consentSnapshotHash??"",/^[a-f0-9]{64}$/);
       assert.equal(linkAuthorization?.expiresAt,distribution.expiresAt);
       assert.equal(linkAuthorization?.approvedBy,actor.id);
       const authorizationPayload=linkAuthorizationRow!.payload;
       await db.update(distributionRecipientsTable).set({payload:{
         ...authorizationPayload,
         linkAuthorization:{...linkAuthorization!,contentHash:"f".repeat(64)},
       }}).where(eq(distributionRecipientsTable.id,linkAuthorizationRow!.id));
       await assert.rejects(getBuyerPortalDeal(staleAccessShare.links[0]!.token,now),/owner authorization is stale/i,
         "A changed frozen packet hash must invalidate a previously authorized recipient link.");
       await db.update(distributionRecipientsTable).set({payload:authorizationPayload})
         .where(eq(distributionRecipientsTable.id,linkAuthorizationRow!.id));
       const [staleBuyerRow] = await db.select().from(buyersTable).where(eq(buyersTable.id,staleBuyer.id));
       await db.update(buyersTable).set({payload:{...staleBuyerRow!.payload,email:"changed-route@example.com"}})
         .where(eq(buyersTable.id,staleBuyer.id));
       await assert.rejects(getBuyerPortalDeal(staleAccessShare.links[0]!.token,now),/owner authorization is stale/i,
         "Changing the recipient route must invalidate the prior owner authorization.");
       await db.update(buyersTable).set({payload:staleBuyerRow!.payload}).where(eq(buyersTable.id,staleBuyer.id));
       const [permissionBoundRecipient] = await db.select().from(distributionRecipientsTable).where(and(
         eq(distributionRecipientsTable.packetId,distribution.packetId!),eq(distributionRecipientsTable.buyerId,staleBuyer.id)));
       const permissionSnapshot = permissionBoundRecipient?.payload.contactPermissionSnapshot as {channels?:string[];checkedAt?:string}|undefined;
       assert.deepEqual(permissionSnapshot?.channels,["EMAIL"],"The link records the exact channel consent used at creation.");
       assert.equal(permissionSnapshot?.checkedAt,now.toISOString(),"Consent evidence is snapshotted at package-link creation.");
       await buyers.recordBuyerContactPermission(staleBuyer.id,{version:staleBuyer.version,status:"OPTED_OUT",channels:[],
         source:"SYNTHETIC post-invitation opt-out fixture",evidenceUrl:"https://example.com/synthetic-buyer-opt-out",
         capturedAt:now.toISOString(),validUntil:null},actor,now);
       await assert.rejects(getBuyerPortalDeal(staleAccessShare.links[0]!.token,now),/contact permission/i,
         "A current opt-out blocks access through an already-issued bearer link.");
       staleBuyer = await getBuyerRecord(staleBuyer.id,db,now);
       await buyers.recordBuyerContactPermission(staleBuyer.id,{version:staleBuyer.version,status:"GRANTED",channels:["EMAIL"],
         source:"SYNTHETIC renewed buyer permission fixture",evidenceUrl:"https://example.com/synthetic-renewed-buyer-permission",
         capturedAt:now.toISOString(),validUntil:future(10)},actor,now);
       staleBuyer = await getBuyerRecord(staleBuyer.id,db,now);
       const [contractBeforeStalePacketCheck] = await db.select().from(contractsTable).where(eq(contractsTable.leadId,id));
       assert.ok(contractBeforeStalePacketCheck);
       const accessEventsBeforeStalePacketCheck = ((await getDealDistribution(id)).recipients as unknown as Array<{buyerId:string;events:unknown[]}>)
         .find(recipient=>recipient.buyerId===staleBuyer.id)?.events.length ?? 0;
       await db.update(contractsTable).set({
         payload:{...contractBeforeStalePacketCheck.payload,
           purchasePrice:Number(contractBeforeStalePacketCheck.payload.purchasePrice)+1},
         version:contractBeforeStalePacketCheck.version+1,
       }).where(eq(contractsTable.id,contractBeforeStalePacketCheck.id));
       await assert.rejects(getBuyerPortalDeal(staleAccessShare.links[0]!.token,now),/owner authorization is stale|package is stale against current contract terms/i,
         "A changed executed price must stale the immutable buyer package and block existing links.");
       await db.update(contractsTable).set({
         payload:contractBeforeStalePacketCheck.payload,version:contractBeforeStalePacketCheck.version,
       }).where(eq(contractsTable.id,contractBeforeStalePacketCheck.id));
       const eventsAfterStalePacketCheck = ((await getDealDistribution(id)).recipients as unknown as Array<{buyerId:string;events:unknown[]}>)
         .find(recipient=>recipient.buyerId===staleBuyer.id)?.events.length ?? 0;
       assert.equal(eventsAfterStalePacketCheck,accessEventsBeforeStalePacketCheck,
         "A stale-package rejection must not record a successful portal access.");
      distribution = await getDealDistribution(id);
       await assert.rejects(getBuyerPortalDeal(staleAccessShare.links[0]!.token,afterExpiry),/owner authorization is stale|no longer current|no longer available/i,
        "A buyer whose funding/qualification evidence expires after invitation cannot reopen the packet.");
       await assert.rejects(downloadBuyerPacketPdf(staleAccessShare.links[0]!.token,afterExpiry),/owner authorization is stale|no longer current|no longer available/i,
        "A stale buyer cannot download the packet after invitation.");
      const staleReadRecipients = distribution.recipients as Array<{buyerId:string;events:Array<unknown>}>;
      assert.equal(staleReadRecipients.find((item) => item.buyerId === staleBuyer.id)?.events.length,0,
        "Rejected stale reads do not create portal access events.");
      const recipientCountBeforeAddressDisclosure = distribution.recipients.length;
      await db.update(distributionPacketsTable).set({snapshot:{
        ...distribution.packet!, addressRedacted:false,
        location:{...distribution.packet!.location,streetAddress:detail.lead.address},
      }}).where(eq(distributionPacketsTable.id,distribution.packetId!));
      await assert.rejects(shareDistributionRecipients(distribution.packetId!,{
        version:distribution.version,buyerIds:[buyer.id],
      },actor,now),/recipient identity is not verified/i,
      "Address-disclosing packets must not be exposed through bearer-only buyer links.");
      assert.equal((await getDealDistribution(id)).recipients.length,recipientCountBeforeAddressDisclosure,
        "Blocked address-disclosing access must not create recipients.");
      await db.update(distributionPacketsTable).set({snapshot:distribution.packet as unknown as Record<string,unknown>})
        .where(eq(distributionPacketsTable.id,distribution.packetId!));
    const shared = await shareDistributionRecipients(distribution.packetId!,{version:distribution.version,buyerIds:[buyer.id,competitor.id]},actor,now);
    assert.equal(shared.links.length,2);
     const linkAudit = await db.select().from(auditTable)
       .where(and(eq(auditTable.entityId,id),eq(auditTable.action,"DISTRIBUTION_LINKS_CREATED")));
     assert.ok(linkAudit.some(row=>row.actor===actor.id&&/Created or rotated 2 private capability link/.test(row.detail)),
       "Recipient link creation retains actor and exact operation in audit history.");
     const issuedRecipients = await db.select().from(distributionRecipientsTable)
       .where(eq(distributionRecipientsTable.packetId,distribution.packetId!));
     assert.ok(issuedRecipients.length>=2);
     assert.ok(issuedRecipients.every(row=>{
       const history=row.payload.linkHistory as Array<{actor?:string;recordedAt?:string}>|undefined;
       const permissionSnapshot=row.payload.contactPermissionSnapshot as {checkedAt?:string;channels?:string[]}|undefined;
       return history?.some(event=>event.actor===operator.id&&event.recordedAt===now.toISOString())
         && permissionSnapshot?.checkedAt===now.toISOString()
         && permissionSnapshot.channels?.includes("EMAIL");
     }),"Each issued recipient capability retains actor/time history and the consent snapshot used.");
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
    const buyerPacketPdf = await downloadBuyerPacketPdf(portalToken,now);
    assert.match(buyerPacketPdf.subarray(0,5).toString(),/^%PDF-/,"Capability-authorized buyer download must be a PDF.");
    assert.equal(buyerPacketPdf.includes(Buffer.from(detail.lead.address)),false,"Downloaded packet must not include the street address.");
    assert.equal(buyerPacketPdf.includes(Buffer.from(detail.lead.sellerName)),false,"Downloaded packet must not include seller identity.");
    const buyerPortalApp = express();
    buyerPortalApp.use("/api", publicBuyerPortalRouter);
    const buyerPortalServer = buyerPortalApp.listen(0,"127.0.0.1");
    await once(buyerPortalServer,"listening");
    const buyerPortalUrl = `http://127.0.0.1:${(buyerPortalServer.address() as AddressInfo).port}/api/portal/deal/download`;
    try {
      const httpDownload = await fetch(buyerPortalUrl,{headers:{"X-Portal-Token":portalToken}});
      assert.equal(httpDownload.status,200,"The actual HTTP download route must serve a valid buyer capability.");
      assert.match(httpDownload.headers.get("content-type")??"",/application\/pdf/i);
      assert.match(httpDownload.headers.get("content-disposition")??"",/attachment; filename="buyer-deal-packet\.pdf"/);
      const httpPdf=Buffer.from(await httpDownload.arrayBuffer());
      assert.match(httpPdf.subarray(0,5).toString(),/^%PDF-/);
      assert.equal(httpPdf.includes(Buffer.from(detail.lead.address)),false);
      assert.equal(httpPdf.includes(Buffer.from(detail.lead.sellerName)),false);
    } finally {
      await new Promise<void>((resolve,reject)=>buyerPortalServer.close((error)=>error?reject(error):resolve()));
    }
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
     assert.equal(repeatedPortalAccess.events.filter(event=>event.action==="PORTAL_ACCESSED").length,4,
       "Two portal opens and both valid PDF downloads are persisted as access evidence, not buyer intent.");
    assert.ok(repeatedPortalAccess.events.filter(event=>event.action==="PORTAL_ACCESSED")
      .every(event=>event.note.includes("does not establish the reader's identity")));
    const afterViews = await getDealDistribution(id);
    const viewedRecipients = afterViews.recipients as Array<{
      buyerId:string;status:string;events:Array<{action:string}>;
    }>;
    assert.equal(viewedRecipients.find(recipient=>recipient.buyerId===buyer.id)?.status,"INVITED");
    assert.equal(viewedRecipients.find(recipient=>recipient.buyerId===buyer.id)?.events
       .filter(event=>event.action==="PORTAL_ACCESSED").length,4,
       "The operator distribution view receives persisted portal and PDF access history.");
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
     source:"Owner-reviewed post-acceptance qualification scenario (isolated exercise)",status:"ACTIVE",criteria:buyer.criteria},actor);
   const lateVerified = await buyers.verifyBuyer(lateQualified.id,{...verificationInput,version:lateQualified.version,
     identityEvidenceUrl:"https://example.com/synthetic-late-id",fundingEvidenceUrl:"https://example.com/synthetic-late-funds",
     buyingEvidenceUrl:"https://example.com/synthetic-late-buying",criteriaEvidenceUrl:"https://example.com/synthetic-late-criteria"},actor,now);
    await buyers.recordBuyerContactPermission(lateVerified.id,{version:lateVerified.version,status:"GRANTED",channels:["EMAIL"],
      source:"SYNTHETIC late-buyer permission fixture",evidenceUrl:"https://example.com/synthetic-late-permission",
      capturedAt:now.toISOString(),validUntil:future(10)},actor,now);
   await refreshMatches(id,now);
   openDistribution = await getDealDistribution(id);
   const thirdShare = await shareDistributionRecipients(openDistribution.packetId!,{
     version:openDistribution.version,buyerIds:[lateVerified.id],
   },actor,now);
   assert.equal(thirdShare.links.length,1,"The owner can add a new qualified buyer after soft acceptances.");
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
    const afterClosedRecipients = afterClosedAccess.recipients as Array<{buyerId:string;events:Array<{action:string}>}>;
    assert.equal(afterClosedRecipients.find(r=>r.buyerId===lateVerified.id)?.events
     .filter(event=>event.action==="PORTAL_ACCESSED").length,closedAccessCount,
     "A committed/closed link rejection must not record another portal access.");
  let destination = await buyers.createBuyer({name:"SYNTHETIC GURU DESTINATION",email:"synthetic-guru@example.com",phone:"",
     source:"Owner-reviewed destination scenario (isolated exercise)",status:"ACTIVE",destinationKind:"GURU",qualifiedDealFee:500,feeTermsSource:"Synthetic quoted terms, not receipt",
    criteria:buyer.criteria},actor);
  destination = await buyers.verifyBuyer(destination.id,{version:destination.version,identityEvidenceUrl:"https://example.com/synthetic-guru-id",
    verificationNote:"Synthetic destination identity/criteria review; no bank or payment claim.",evidenceAt:now.toISOString(),validUntil:future(25),
    currentBuyingStatus:"BUYING",buyingEvidenceAt:now.toISOString(),buyingEvidenceUrl:"https://example.com/synthetic-guru-accepting",
     criteriaEvidenceUrl:"https://example.com/synthetic-guru-criteria",verificationSource:"Owner-reviewed isolated destination scenario",confidence:0.9},actor,now);
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
  const amendedScheduleReport = await getTransactionReadinessReport(now);
  assert.ok(amendedScheduleReport.exceptions.some(item=>
    item.contractId===op.contract?.id&&item.issueKey==="MILESTONE_SCHEDULE_STALE"&&item.status==="OPEN"),
    "An executed closing-date amendment invalidates the prior milestone schedule.");
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
    evidenceUrl:"https://example.com/synthetic-old-assignment",note:"SYNTHETIC former buyer assignment.",effectiveAt:now.toISOString()},actor,now);
    const oldBuyerId = winnerBuyerId;
  op = await recordTransactionException(id,{version:op.contract!.version,kind:"RELEASE_BUYER",buyerId:oldBuyerId,
    effectiveAt:now.toISOString(),evidenceUrl:"https://example.com/synthetic-release",note:"SYNTHETIC externally reviewed release only."},actor,now);
  assert.equal(op.contract?.committedBuyerId,null);
  assert.ok(!op.contract?.milestones.some(m=>m.kind==="ASSIGNMENT_SIGNED"));
  assert.ok(op.contract?.history?.some(h=>h.kind==="RELEASE_BUYER"&&h.previousState.committedBuyerId===oldBuyerId));
  buyer = await buyers.createBuyer({name:"SYNTHETIC REPLACEMENT",email:"replacement@example.com",phone:"",
    source:"Owner-reviewed replacement qualification scenario (isolated exercise)",status:"ACTIVE",criteria:buyer.criteria},actor);
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
  assert.equal(detail.offers.find(item=>item.id===offerId)?.effectiveStatus,"INVALIDATED",
    "A material linked evidence update must invalidate the approval status returned to the workspace.");
  assert.equal((await dealOperations(id,now)).matches.find(m=>m.buyerId===buyer.id)?.eligible,false);
  const staleWorkspaceOperations=await dealOperations(id,now);
  assert.equal(staleWorkspaceOperations.contract?.status,"UNDER_CONTRACT",
    "Stale underwriting invalidates dependent approval/matching without rewriting executed contract terms.");
  assert.equal(staleWorkspaceOperations.matches.find(m=>m.buyerId===buyer.id)?.eligible,false);
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
      note:"Legacy evidence link only.",effectiveAt:now.toISOString(),recordedBy:actor.id,recordedAt:now.toISOString()},
    {kind:"FUNDS_CONFIRMED" as const,evidenceUrl:"https://example.com/synthetic-old-funds",
      note:"Legacy evidence link only.",effectiveAt:now.toISOString(),recordedBy:actor.id,recordedAt:now.toISOString()},
  ]};
  const legacyBlockers = closingBlockers(legacySparseContract,undefined);
  assert.ok(legacyBlockers.some(x=>/Acquisition earnest-money evidence is incomplete/.test(x)),
    "Legacy generic EMD links cannot satisfy the structured closing gate.");
  assert.ok(legacyBlockers.some(x=>/Buyer-funds evidence is incomplete/.test(x)),
    "Legacy generic funds links cannot satisfy the current-funds evidence gate.");
  for (const kind of CLOSING_MILESTONES) {
    if (op.contract?.milestones.some(milestone=>milestone.kind===kind)) continue;
    const details = kind==="EARNEST_MONEY_CONFIRMED" ? earnestEvidence
      : kind==="FUNDS_CONFIRMED" ? buyerFundsEvidence
        : {kind,evidenceUrl:`https://example.com/synthetic-${kind.toLowerCase()}`,note:"Synthetic reviewed evidence, no actual escrow activity.",effectiveAt:now.toISOString()};
    op = await transactions.recordClosingMilestone(id,{version:op.contract!.version,...details},actor,now);
  }
  const recordedEarnest = op.contract?.milestones.find(m=>m.kind==="EARNEST_MONEY_CONFIRMED");
  const recordedFunds = op.contract?.milestones.find(m=>m.kind==="FUNDS_CONFIRMED");
  assert.equal(recordedEarnest?.amount,op.contract?.earnestMoney);
  assert.equal(recordedEarnest?.effectiveAt,now.toISOString());
  assert.equal(recordedFunds?.amount,buyer.availableFunds);
  assert.equal(recordedFunds?.evidenceUrl,buyer.fundingEvidenceUrl);
  const latestAmendmentForSchedule = [...(op.contract!.history??[])]
    .filter(item=>item.kind==="AMEND_CLOSING"&&!!item.evidenceUrl)
    .sort((a,b)=>Date.parse(a.effectiveAt)-Date.parse(b.effectiveAt)).at(-1);
  const currentScheduleSource = latestAmendmentForSchedule?.evidenceUrl??op.contract!.executedDocumentUrl!;
  op = await transactions.recordTransactionDeadlineSchedule(id,{
    version:op.contract!.version,deadlineScheduleVersion:op.contract!.deadlineScheduleVersion,
    idempotencyKey:"synthetic-deadline-review-after-amendment-and-buyer",
    sourceEvidenceUrl:currentScheduleSource,
    reviewNote:"SYNTHETIC revised schedule after evidenced amendment and replacement buyer; no real transaction.",
    items:[
      {kind:"TITLE_CLEARED" as const,disposition:"DUE_DATE" as const,dueDate:dateOnly(5),timeZone:"America/New_York",basisNote:"SYNTHETIC latest terms title review date."},
      {kind:"INSPECTION_COMPLETED" as const,disposition:"DUE_DATE" as const,dueDate:dateOnly(4),timeZone:"America/New_York",basisNote:"SYNTHETIC inspection was recorded separately with actual occurrence evidence."},
      {kind:"EARNEST_MONEY_CONFIRMED" as const,disposition:"DUE_DATE" as const,dueDate:dateOnly(6),timeZone:"America/New_York",basisNote:"SYNTHETIC escrow term in current reviewed agreement."},
      {kind:"ASSIGNMENT_SIGNED" as const,disposition:"DUE_DATE" as const,dueDate:dateOnly(7),timeZone:"America/New_York",basisNote:"SYNTHETIC replacement-buyer assignment timing."},
      {kind:"FUNDS_CONFIRMED" as const,disposition:"DUE_DATE" as const,dueDate:dateOnly(7),timeZone:"America/New_York",basisNote:"SYNTHETIC replacement-buyer funding timing."},
    ],
  },actor,now);
  assert.equal(op.contract?.deadlineScheduleVersion,2,"The re-reviewed schedule is an append-only revision after material party/term changes.");
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
    const milestoneDeadlineExceptions = readinessReport.exceptions.filter(item=>
      item.contractId===op.contract!.id&&item.issueKey.startsWith("MILESTONE_"));
    assert.deepEqual(op.contract?.deadlineScheduleHistory.map(schedule=>schedule.version),[1,2],
      "The initial review and post-amendment/party review remain as two immutable schedule versions.");
    assert.ok(milestoneDeadlineExceptions.some(item=>item.issueKey==="MILESTONE_SCHEDULE_STALE"&&item.status==="RESOLVED"),
      "A fresh review tied to the latest party/terms snapshot resolves the stale-schedule exception without deleting history.");
    assert.ok(!milestoneDeadlineExceptions.some(item=>item.status==="OPEN"),
      "No milestone deadline/schedule exception remains open once the synthetic milestones and current schedule are evidenced.");
   readinessSummary = {
     syntheticTransactions: readinessReport.syntheticTransactionCount,
     realTransactions: readinessReport.realTransactionCount,
     capabilities: readinessReport.capabilities,
     persistedExceptions: readinessReport.exceptions.length,
     openExceptions: readinessReport.openExceptionCount,
      milestoneDeadlineSchedule: {
        syntheticOnly:true,
        scheduleVersions:op.contract?.deadlineScheduleHistory.map(schedule=>schedule.version)??[],
        currentTermsHash:op.contract?.deadlineSchedule?.termsHash,
        currentSourceEvidenceUrl:op.contract?.deadlineSchedule?.sourceEvidenceUrl,
        recordedMilestones:op.contract?.milestones.map(milestone=>({
          kind:milestone.kind,effectiveAt:milestone.effectiveAt??null,recordedAt:milestone.recordedAt,
        }))??[],
        milestoneExceptions:milestoneDeadlineExceptions.map(item=>({issueKey:item.issueKey,status:item.status,severity:item.severity})),
        asserted:[
          "missing-schedule-blocks-active-transaction","owner-only-schedule-review","source-reference-must-match-executed-terms",
          "separate-calendar-date-and-time-zone","overdue-and-upcoming-milestones",
          "schedule-does-not-complete-milestones","event-time-distinct-from-record-time",
          "idempotent-replay","amendment-stales-schedule","buyer-party-change-stales-schedule",
          "append-only-review-version","evidence-resolves-deadline","current-schedule-required-for-settlement",
        ],
      },
     exercised: ["idempotent-re-evaluation", "upcoming-and-overdue-close", "amended-deadline-resolution",
        "milestone-deadline-schedule-review-and-stale-protection",
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
   await assert.rejects(transactions.recordClosingMilestone(id,{version:op.contract!.version,kind:"TITLE_CLEARED",
     evidenceUrl:"https://example.com/synthetic-post-close-title",note:"SYNTHETIC post-close mutation attempt.",
     effectiveAt:future(2)},actor,new Date(future(6))),/terminal and cannot be changed/i,
     "A closed transaction cannot be rewritten by a later milestone command.");
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
    const terminalFailure = await runWorkerOnce(now,false,fail.id);
    assert.equal(terminalFailure?.state,"FAILED","A deterministic terminal-deal conflict must not be retried.");
    assert.equal(terminalFailure?.attempts,1);
   const [persistedFailure] = await db.select().from(jobsTable).where(eq(jobsTable.id,fail.id));
   const failureRecovery = persistedFailure?.payload.recovery as Record<string,unknown>;
    assert.equal(failureRecovery?.nextAttemptAt,null);
    assert.equal(failureRecovery?.nextAction,"OPERATOR_REVIEW_AND_QUEUE_NEW_IDEMPOTENCY_KEY");
   assert.equal((failureRecovery?.history as unknown[]).length,1);
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
    await assertSyntheticCallReadyBlocked(nextId,actor.id,now);
    d = await seedSyntheticPostGateContacted(nextId,actor.id,now);
    d = await seller.recordCall(nextId,{version:d.lead.version,outcome:"CONNECTED",notes:"SYNTHETIC new-attempt conversation.",
      nextAction:"Review fresh exact terms.",followUpAt:future(1)},actor.id,now);
    d = await offers.createOfferDraft(nextId,{version:d.lead.version,amount:110000,earnestMoney:1000,closingDays:30,
      contingencies:"SYNTHETIC review",assignmentIntent:true,reason:"SYNTHETIC separate new offer"},actor,now);
    const newOffer = d.offers.find(o=>o.status==="DRAFT")!;
     d = await authorizeReviewedOffer(nextId,newOffer.id,{version:d.lead.version,maximumApprovedAcquisitionPrice:120000,authorityEvidenceId:nextAuthority.id,
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
    await assertSyntheticCallReadyBlocked(staleId,actor.id,now);
    staleDetail = await seedSyntheticPostGateContacted(staleId,actor.id,now);
    staleDetail = await seller.recordCall(staleId,{version:staleDetail.lead.version,outcome:"CONNECTED",notes:"SYNTHETIC only.",
      nextAction:"Review terms.",followUpAt:future(1)},actor.id,now);
    staleDetail = await offers.createOfferDraft(staleId,{version:staleDetail.lead.version,amount:110000,earnestMoney:1000,
      closingDays:30,contingencies:"SYNTHETIC review",assignmentIntent:true,reason:"SYNTHETIC revision test"},actor,now);
    const staleOfferId = staleDetail.offers[0]!.id;
     staleDetail = await authorizeReviewedOffer(staleId,staleOfferId,{version:staleDetail.lead.version,
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
     const economicStateAfterEvidence={
       analysisSnapshotId:changed.analysisSnapshotId,
       analysis:changed.analysis,
       offer:changed.offers.find(item=>item.id===staleOfferId)&&{
         amount:changed.offers.find(item=>item.id===staleOfferId)!.amount,
         maximumApprovedAcquisitionPrice:changed.offers.find(item=>item.id===staleOfferId)!.maximumApprovedAcquisitionPrice,
         effectiveStatus:changed.offers.find(item=>item.id===staleOfferId)!.effectiveStatus,
       },
     };
     assert.equal(await propagateStaleTransactionDocuments(staleId,now),1,
       "A relevant source-evidence write immediately persists the affected document as stale.");
     assert.equal(await propagateStaleTransactionDocuments(staleId,now),0,
       "Repeated freshness reconciliation is idempotent and does not duplicate stale events.");
    staleOps = await dealOperations(staleId,now);
    assert.equal(staleOps.contract?.status,"DRAFT");
     assert.equal(staleOps.contract?.documents?.[0]?.status,"STALE");
     assert.match(staleOps.contract?.documents?.[0]?.staleReason??"",/Underwriting snapshot changed|Source offer is no longer/);
     assert.ok(staleOps.contract?.documents?.[0]?.events?.some(event=>event.to==="STALE"));
    assert.equal(staleOps.contract?.sellerSignedAt??null,null);
    assert.equal(staleOps.contract?.acquisitionSignedAt??null,null);
    assert.equal(staleOps.contract?.executedDocumentUrl??null,null);
     await assert.rejects(transactions.downloadPurchaseReviewDocument(staleId,prepared.id,operator,now),/document is stale/);
     await assert.rejects(transactions.transitionTransactionDocument(staleId,prepared.id,{
       version:staleOps.contract!.version,targetStatus:"SENT",reason:"SYNTHETIC stale send attempt."},
     actor,new Date(now.getTime()+3*86400000)),/terminal|stale|cannot transition/i);
     const afterStaleTransition=await seller.leadDetail(staleId);
     assert.deepEqual({
       analysisSnapshotId:afterStaleTransition.analysisSnapshotId,analysis:afterStaleTransition.analysis,
       offer:afterStaleTransition.offers.find(item=>item.id===staleOfferId)&&{
         amount:afterStaleTransition.offers.find(item=>item.id===staleOfferId)!.amount,
         maximumApprovedAcquisitionPrice:afterStaleTransition.offers.find(item=>item.id===staleOfferId)!.maximumApprovedAcquisitionPrice,
         effectiveStatus:afterStaleTransition.offers.find(item=>item.id===staleOfferId)!.effectiveStatus,
       },
     },economicStateAfterEvidence,"Document staling cannot change underwriting or authorized offer limits.");
     staleOps = await dealOperations(staleId,new Date(now.getTime()+3*86400000));
     const staleArtifact = staleOps.contract?.documents?.find(doc=>doc.id===prepared.id);
     assert.equal(staleArtifact?.status,"STALE","material source change must persistently stale an unsigned artifact before send");
     assert.match(staleArtifact?.staleReason??"",/offer is no longer currently authorized/);
     assert.match(staleArtifact?.nextAction??"",/fresh owner authorization/);
     assert.ok(staleArtifact?.events?.some(event=>event.to==="STALE"),"stale transition must remain in document audit history");
     await assert.rejects(transactions.downloadPurchaseReviewDocument(staleId,prepared.id,operator,new Date(now.getTime()+3*86400000)),
       /document is stale/);
  }
  await verifyPreExecutionRevisionInvalidation();
   const [packetLead]=await db.select().from(leadsTable).where(eq(leadsTable.id,id));
   await db.update(leadsTable).set({payload:{...packetLead!.payload,synthetic:true}}).where(eq(leadsTable.id,id));
   const fullPacket=await exportDealEvidencePacket(id,actor,"OWNER_AUDIT",true);
   assert.equal((fullPacket as any).deal.recordClass,"SYNTHETIC");
   assert.equal((fullPacket as any).deal.version,(await seller.leadDetail(id)).lead.version);
   assert.ok((fullPacket as any).sections.underwriting.snapshots.length>0);
   assert.ok((fullPacket as any).sections.sellerNotes.calls.length>0);
   assert.ok((fullPacket as any).sections.offers.length>0);
   assert.ok((fullPacket as any).sections.contracts.length>0);
   const firstPacketRow=(await db.select().from(evidencePacketExportsTable).where(eq(evidencePacketExportsTable.id,(fullPacket as any).export.id)))[0]!;
   const frozenSnapshot=JSON.stringify(firstPacketRow.snapshot);
   const redactedPacket=await exportDealEvidencePacket(id,{id:operator.id,role:"OPERATOR"},"TITLE_HANDOFF",true);
   const redactedJson=JSON.stringify(redactedPacket);
   assert.ok(!redactedJson.includes("SYNTHETIC COMPLETE DEAL"));
   assert.ok(!redactedJson.includes("000-000-0000"));
   await assert.rejects(exportDealEvidencePacket(id,{id:"viewer",role:"VIEWER"},"INTERNAL_REVIEW"),/Not authorized/);
   const firstPacketAgain=(await db.select().from(evidencePacketExportsTable).where(eq(evidencePacketExportsTable.id,(fullPacket as any).export.id)))[0]!;
   assert.equal(JSON.stringify(firstPacketAgain.snapshot),frozenSnapshot,"later exports cannot mutate prior packet versions");
   assert.equal((redactedPacket as any).export.version,(fullPacket as any).export.version+1);
   assert.match((fullPacket as any).export.contentHash,/^[a-f0-9]{64}$/);
   const buyerCallLead=await seller.createLead({address:"SYNTHETIC BUYER CALL FOLLOW-UP",city:"Synthetic City",state:"TX",county:"Synthetic County",zip:"75001",
     propertyType:"SINGLE_FAMILY",sqft:900,beds:2,baths:1,units:1,askingPrice:80000,sellerName:"Synthetic seller",
     source:"Synthetic buyer-call regression fixture; no real contact."},actor.id,now);
   let buyerCallDetail=await seller.leadDetail(buyerCallLead.id);
   const originalSellerDue=buyerCallDetail.lead.followUpAt;
   const buyerCallInput={version:buyerCallDetail.lead.version,buyerId:buyer.id,idempotencyKey:`synthetic-buyer-call:${buyerCallLead.id}`,
     outcome:"CONNECTED" as const,notes:"SYNTHETIC buyer call; no actual outreach.",nextAction:"Review the buyer's indicated timing.",
      followUpAt:future(1),operatorConfidence:0.8};
   const concurrentBuyerCallReplays=await Promise.all([
     seller.recordBuyerCall(buyerCallLead.id,buyerCallInput,actor.id,now),
     seller.recordBuyerCall(buyerCallLead.id,buyerCallInput,actor.id,now),
   ]);
   buyerCallDetail=concurrentBuyerCallReplays[0]!;
   const persistedBuyerCall=buyerCallDetail.calls.find(call=>call.counterpartyKind==="BUYER");
   assert.ok(persistedBuyerCall?.id);
   assert.equal(concurrentBuyerCallReplays[1]!.calls.filter(call=>call.counterpartyKind==="BUYER").length,1,
     "concurrent exact retries must resolve to one persisted buyer call");
   assert.equal(buyerCallDetail.lead.followUpAt,originalSellerDue,"buyer follow-up must not overwrite the shared seller schedule");
   assert.equal(persistedBuyerCall?.buyerFollowUpStatus,"OPEN");
   assert.equal(persistedBuyerCall?.operatorConfidence,0.8,"operator confidence is retained with the original call record");
   assert.equal(buyerCallDetail.offers.length,0,"logging a buyer call cannot create or authorize an offer");
   const followups=await seller.listBuyerCallFollowUps(now);
   assert.ok(followups.items.some(item=>item.callId===persistedBuyerCall?.id));
    const overdueBuyerFollowUps=await seller.listBuyerCallFollowUps(new Date(new Date(future(1)).getTime()+60_000));
    const overdueBuyerFollowUp=overdueBuyerFollowUps.items.find(item=>item.callId===persistedBuyerCall?.id);
    assert.ok(overdueBuyerFollowUp&&Date.parse(overdueBuyerFollowUp.dueAt)<Date.parse(overdueBuyerFollowUps.generatedAt),
      "an open buyer-call event remains individually visible after its due time so the dashboard can mark it overdue");
   const deskWithBuyerFollowUp=await commandCenter("OWNER",now);
   assert.ok(deskWithBuyerFollowUp.actions.some(action=>action.id===`BUYER_CALL_FOLLOW_UP:${persistedBuyerCall?.id}`),
     "open buyer follow-up appears in the command-center next-action queue");
   const replayedBuyerCall=await seller.recordBuyerCall(buyerCallLead.id,buyerCallInput,actor.id,now);
   assert.equal(replayedBuyerCall.calls.filter(call=>call.counterpartyKind==="BUYER").length,1,"exact replay remains idempotent");
   await assert.rejects(seller.recordBuyerCall(buyerCallLead.id,{...buyerCallInput,notes:"Changed replay"},actor.id,now),/already used/);
   buyerCallDetail=await seller.updateBuyerCallFollowUp(buyerCallLead.id,persistedBuyerCall!.id,
     {version:buyerCallDetail.lead.version,status:"COMPLETED",note:"SYNTHETIC follow-up reviewed; no commitment recorded."},actor.id,now);
   const completedBuyerCall=buyerCallDetail.calls.find(call=>call.id===persistedBuyerCall!.id);
   assert.equal(completedBuyerCall?.buyerFollowUpStatus,"COMPLETED");
   assert.equal(completedBuyerCall?.buyerFollowUpHistory?.length,2,"follow-up status change is append-only and auditable");
   assert.equal(buyerCallDetail.lead.followUpAt,originalSellerDue);
   const repeatedCompletion=await seller.updateBuyerCallFollowUp(buyerCallLead.id,persistedBuyerCall!.id,
     {version:buyerCallDetail.lead.version,status:"COMPLETED",note:"SYNTHETIC follow-up reviewed; no commitment recorded."},actor.id,now);
   assert.equal(repeatedCompletion.calls.find(call=>call.id===persistedBuyerCall!.id)?.buyerFollowUpHistory?.length,2,
     "identical completion retries cannot duplicate follow-up history");
   await assert.rejects(seller.updateBuyerCallFollowUp(buyerCallLead.id,persistedBuyerCall!.id,
     {version:buyerCallDetail.lead.version-1,status:"OPEN",note:"Stale edit",dueAt:future(2)},actor.id,now),/changed in another session/);
   assert.equal((await seller.listBuyerCallFollowUps(now)).items.some(item=>item.callId===persistedBuyerCall?.id),false);
  logger.info("Cancellation/restart PASSED: owner-only, fresh underwriting/approval/communication, distinct attempt, original cancellation/signatures/terms/buyer history retained; CLOSED cannot reopen.");
    logger.info({checks:"persisted document registry and missing-template/private-storage/signing blockers; review PDF bytes separated into protected blob table; party/economic changes stale artifacts; persisted DRAFT → PREPARED → REJECTED/VOID/EXPIRED/REPLACED paths; separately evidenced execution never marks a review worksheet SIGNED; immutable economics hash shared with redacted packet; deadline/evidence exception persistence and terminal work cleanup",readinessSummary},"Full lifecycle persistence exercise PASSED (isolated synthetic schema)");
} finally { await pool.end(); }
