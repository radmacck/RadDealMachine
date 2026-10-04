import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db,pool,contractsTable,jobsTable,matchesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import * as seller from "./deal-store";
import * as offers from "./offer-store";
import * as transactions from "./transaction-store";
import * as buyers from "./buyer-store";
import { dealOperations,refreshMatches } from "./matching-store";
import { submitWorkerJob,runWorkerOnce } from "./workers";
import { commandCenter } from "./command-center";
import { CLOSING_MILESTONES } from "@workspace/deal-domain";
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
  await assert.rejects(transactions.createContract(id,{version:detail.lead.version,offerId,closingAt:future(31)},operator,now),/approved closing/);
  let op = await transactions.createContract(id,{version:detail.lead.version,offerId,closingAt:future(20)},operator,now);
  assert.equal(op.contract?.status,"DRAFT"); assert.equal(op.contract?.purchasePrice,110000);
  const execute = {version:op.contract!.version,executedDocumentUrl:"https://example.com/synthetic-contract",
    sellerSignedAt:now.toISOString(),acquisitionSignedAt:now.toISOString(),reviewNote:"Synthetic owner verification, not real signatures."};
  await assert.rejects(transactions.executeContract(id,execute,operator,now),e=>(e as {status:number}).status===403);
  await assert.rejects(transactions.executeContract(id,{...execute,sellerSignedAt:future(1)},actor,now),/future/);
  op = await transactions.executeContract(id,execute,actor,now);
  assert.equal(op.contract?.status,"UNDER_CONTRACT");
  assert.equal((await seller.leadDetail(id)).lead.stage,"UNDER_CONTRACT");
  let buyer = await buyers.createBuyer({name:"SYNTHETIC QUALIFIED BUYER",email:"synthetic@example.com",phone:"",
    source:"Synthetic service exercise",status:"ACTIVE",criteria:{states:["TX"],cities:["Synthetic City"],zipCodes:[],
      propertyTypes:["SINGLE_FAMILY"],maxPurchasePrice:200000,maxRepairs:50000,minBeds:2,minSqft:500,maxSqft:2000,closingDays:3}},actor);
  op = await refreshMatches(id,now);
  assert.equal(op.matches.find(m=>m.buyerId===buyer.id)?.eligible,false);
  buyer = await buyers.verifyBuyer(buyer.id,{version:buyer.version,identityEvidenceUrl:"https://example.com/synthetic-id",
    fundingEvidenceUrl:"https://example.com/synthetic-funds",availableFunds:200000,verificationNote:"Synthetic review, not real bank proof.",
    evidenceAt:now.toISOString(),validUntil:future(25)},actor,now);
  const job = await submitWorkerJob({kind:"MATCH_BUYERS",leadId:id,idempotencyKey:"synthetic-matching-once"},actor);
  assert.equal((await submitWorkerJob({kind:"MATCH_BUYERS",leadId:id,idempotencyKey:"synthetic-matching-once"},actor)).id,job.id);
  const races = await Promise.all([runWorkerOnce(now,false,job.id),runWorkerOnce(now,false,job.id)]);
  assert.equal(races.filter(Boolean).length,1);
  assert.equal(races.find(Boolean)?.state,"SUCCEEDED");
  assert.equal((await db.select().from(jobsTable).where(eq(jobsTable.id,job.id)))[0]?.attempts,1);
  op = await dealOperations(id,now);
  assert.equal(op.matches.find(m=>m.buyerId===buyer.id)?.eligible,true);
  assert.equal((await seller.leadDetail(id)).lead.stage,"BUYER_MATCHED");
  op = await transactions.recordBuyerResponse(id,buyer.id,{version:op.contract!.version,buyerVersion:buyer.version,status:"INTERESTED",evidence:"Synthetic actual-interest attestation."},operator,now);
  const commitment = {version:op.contract!.version,buyerVersion:buyer.version,status:"COMMITTED" as const,
    evidence:"Synthetic owner commitment review.",commitmentEvidenceUrl:"https://example.com/synthetic-assignment",agreedPrice:130000};
  await assert.rejects(transactions.recordBuyerResponse(id,buyer.id,commitment,operator,now),e=>(e as {status:number}).status===403);
  await assert.rejects(transactions.recordBuyerResponse(id,buyer.id,{...commitment,agreedPrice:100000},actor,now));
  op = await transactions.recordBuyerResponse(id,buyer.id,commitment,actor,now);
  assert.equal(op.contract?.agreedBuyerPrice,130000);
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
  op = await transactions.recordDealOutcome(id,{...outcome,version:op.contract!.version},actor,now);
  assert.equal(op.contract?.status,"CLOSED"); assert.equal(op.contract?.netProceeds,18000);
  assert.equal((await seller.leadDetail(id)).lead.stage,"CLOSED");
  assert.ok(!(await commandCenter("OWNER",now)).actions.some(a=>a.leadId===id));
  await assert.rejects(transactions.recordDealOutcome(id,{...outcome,version:op.contract!.version},actor,now));
  const deadline = await submitWorkerJob({kind:"REVIEW_DEADLINES",idempotencyKey:"synthetic-deadlines-once"},actor);
  assert.equal((await runWorkerOnce(now,false,deadline.id))?.state,"SUCCEEDED");
  const fail = await submitWorkerJob({kind:"MATCH_BUYERS",leadId:id,idempotencyKey:"synthetic-terminal-failure"},actor);
  assert.equal((await runWorkerOnce(now,false,fail.id))?.state,"FAILED");
  logger.info({checks:"approved terms → draft → recorded signatures → real matching; duplicate-job/concurrent-claim safety; interest → owner commitment; research refresh preserves lifecycle; four milestones; settlement fee reconciliation; terminal history; persistent worker success/failure"},"Full lifecycle persistence exercise PASSED (isolated synthetic schema)");
} finally { await pool.end(); }