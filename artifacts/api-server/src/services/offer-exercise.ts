/**
 * Actual PostgreSQL-backed offer exercise. Synthetic records are isolated by
 * generated lead ID and removed in finally. This does not authenticate a real
 * user, test signed-in rendering, communicate externally or verify a real deal.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db, pool, leadsTable, offersTable, analysesTable, auditTable } from "@workspace/db";
import { type LeadInput, type UnderwritingInput, type OfferApprovalInput } from "@workspace/deal-domain";
import { logger } from "../lib/logger";
import * as store from "./deal-store";
import { exerciseEvidence } from "./exercise-evidence";
import * as offers from "./offer-store";

async function exercise() {
  const actorId = `synthetic-offer-exercise:${randomUUID()}`;
  const owner = {id:actorId,role:"OWNER"};
  const analyst = {id:actorId,role:"ANALYST"};
  const operator = {id:actorId,role:"OPERATOR"};
  const now = new Date();
  const future = (hours: number) => new Date(now.getTime()+hours*3_600_000).toISOString();
  const payload: LeadInput = {
    address:`SYNTHETIC OFFER TEST ${randomUUID()} Example Lane`,city:"Synthetic City",state:"TX",
    county:"Synthetic County",zip:"75001",propertyType:"SINGLE_FAMILY",sqft:1000,beds:3,baths:2,units:1,
    askingPrice:100000,sellerName:"SYNTHETIC EXERCISE ONLY",sellerPhone:"000-000-0000",
    source:"Synthetic automated offer exercise, no real property",
  };
  let id: string|null = null;
  try {
    const created = await store.createLead(payload,actorId,now);
    id = created.id;
    const evidence = await store.addIntelligence(id,{
      classification:"VERIFIED_FACTS",category:"ownership",statement:"Synthetic exercise seller is record owner.",
      source:"Synthetic public-record fixture only",sourceType:"PUBLIC_RECORD",confidence:0.9,
      capturedAt:now.toISOString(),verificationNote:"Synthetic comparison to deed fixture; not real title evidence.",
    },actorId,now);
    let detail = await store.leadDetail(id);
    const underwriting: UnderwritingInput = {
      version:detail.lead.version,repairsComplete:true,conditionConfirmed:true,
      comps:[290000,300000,310000].map((salePrice,i) => ({
        id:`synthetic-offer-comp-${i}`,address:`SYNTHETIC OFFER COMP ${i}`,salePrice,sqft:1000,
        soldAt:new Date(now.getTime()-10*86_400_000).toISOString().slice(0,10),
        distanceMiles:0.5,propertyType:"SINGLE_FAMILY",condition:"RENOVATED",
        source:"Synthetic verified-sale fixture",verified:true,
      })),
      repairs:[{category:"Whole synthetic scope",low:10000,expected:20000,high:30000,confidence:0.8,source:"Synthetic repair quote"}],
    };
    detail = await store.saveUnderwriting(id,await exerciseEvidence(id,underwriting,actorId,now),actorId,now);
    assert.ok(detail.analysisSnapshotId);
    const draftInput = {
      version:detail.lead.version,amount:110000,earnestMoney:1000,closingDays:30,
      contingencies:"Subject to diligence, title and executed contract.",assignmentIntent:true,reason:"Synthetic proposal exercise.",
    };
    await assert.rejects(offers.createOfferDraft(id,draftInput,analyst,now),/conversation/i);
    detail = await store.transitionLead(id,{version:detail.lead.version,to:"CALL_READY",reason:"Synthetic research reviewed.",nextAction:"Run synthetic conversation."},actorId,now);
    detail = await store.recordCall(id,{version:detail.lead.version,outcome:"CONNECTED",notes:"Synthetic seller conversation logged.",nextAction:"Review synthetic offer.",followUpAt:future(1)},actorId,now);
    await assert.rejects(store.transitionLead(id,{version:detail.lead.version,to:"OFFER_READY",reason:"Attempt stage bypass.",nextAction:"Must remain blocked."},actorId,now),/not available/);
    await assert.rejects(offers.createOfferDraft(id,{...draftInput,version:detail.lead.version},operator,now),e => (e as {status:number}).status===403);
    detail = await offers.createOfferDraft(id,{...draftInput,version:detail.lead.version},analyst,now);
    const firstId = detail.offers[0]!.id;
    assert.equal(detail.offers[0]!.effectiveStatus,"DRAFT");
    await assert.rejects(offers.communicateOffer(id,firstId,{
      version:detail.lead.version,amount:110000,channel:"PHONE",evidence:"Must not succeed before approval.",
      nextAction:"Blocked before approval.",followUpAt:future(1),
    },operator,now),/not currently authorized/);
    let approval: OfferApprovalInput = {
      version:detail.lead.version,maximumApprovedAcquisitionPrice:120000,expiresAt:future(48),
      authorityEvidenceId:evidence.id,reason:"Synthetic terms and economics reviewed.",nextAction:"Communicate exact approved proposal.",followUpAt:future(1),
    };
    await assert.rejects(offers.authorizeOffer(id,firstId,approval,analyst,now),e => (e as {status:number}).status===403);
    await assert.rejects(offers.authorizeOffer(id,firstId,{...approval,maximumApprovedAcquisitionPrice:detail.analysis!.mao+1},owner,now),/MAO/);
    await assert.rejects(offers.authorizeOffer(id,firstId,{...approval,authorityEvidenceId:randomUUID()},owner,now),/authority/i);
    // Two approvals with the same optimistic version: exactly one may win.
    detail = await offers.createOfferDraft(id,{...draftInput,version:detail.lead.version,amount:111000},analyst,now);
    const secondId = detail.offers.find(o => o.id !== firstId)!.id;
    approval = {...approval,version:detail.lead.version};
    const results = await Promise.allSettled([
      offers.authorizeOffer(id,firstId,approval,owner,now),
      offers.authorizeOffer(id,secondId,approval,owner,now),
    ]);
    assert.equal(results.filter(r => r.status === "fulfilled").length,1);
    assert.equal(results.filter(r => r.status === "rejected").length,1);
    detail = await store.leadDetail(id);
    assert.equal(detail.lead.stage,"OFFER_READY");
    assert.equal(detail.offers.filter(o => o.effectiveStatus === "AUTHORIZED").length,1);
    const approved = detail.offers.find(o => o.effectiveStatus === "AUTHORIZED")!;
    assert.equal(detail.analysis!.maximumApprovedAcquisitionPrice,null);
    const expired = await store.leadDetail(id,db,new Date(now.getTime()+49*3_600_000));
    assert.equal(expired.offers.find(o => o.id === approved.id)!.effectiveStatus,"EXPIRED");
    const brief = (await store.callQueue(new Date(now.getTime()+2*3_600_000))).find(b => b.lead.id === id)!;
    assert.equal(brief.authorizedOffer?.id,approved.id);
    assert.match(brief.boundaries,/Owner-approved proposal/);
    const communication = {
      version:detail.lead.version,amount:approved.amount,channel:"PHONE" as const,
      evidence:"Synthetic operator attestation that exact approved terms were discussed; no external contact.",
      nextAction:"Await synthetic seller reply.",followUpAt:future(1),
    };
    await assert.rejects(offers.communicateOffer(id,approved.id,{...communication,amount:approved.amount+1},operator,now),/exact approved/);
    detail = await offers.communicateOffer(id,approved.id,communication,operator,now);
    assert.equal(detail.lead.stage,"OFFER_SENT");
    assert.equal(detail.offers.find(o => o.id === approved.id)!.communicatedAmount,approved.amount);
    await assert.rejects(offers.communicateOffer(id,approved.id,{...communication,version:detail.lead.version},operator,now),/already been communicated/);
    await assert.rejects(offers.withdrawOffer(id,approved.id,{version:detail.lead.version,reason:"Analyst must not revoke approval.",nextAction:"Blocked.",followUpAt:future(1)},analyst,now),e => (e as {status:number}).status===403);
    detail = await store.recordCall(id,{version:detail.lead.version,outcome:"NO_ANSWER",notes:"Synthetic follow-up attempt.",nextAction:"Continue follow-up.",followUpAt:future(1)},actorId,now);
    assert.equal(detail.lead.stage,"OFFER_SENT","Routine follow-up must not regress offer stage.");
    await assert.rejects(store.transitionLead(id,{version:detail.lead.version,to:"NEGOTIATING",reason:"Synthetic next stage.",nextAction:"Discuss seller response.",followUpAt:null},actorId,now),/future follow-up/);
    await assert.rejects(store.transitionLeadForActor(id,{version:detail.lead.version,to:"ENRICHING",reason:"Operator research bypass attempt.",nextAction:"Must remain blocked."},operator,now),e => (e as {status:number}).status===403);
    detail = await store.transitionLeadForActor(id,{version:detail.lead.version,to:"NEGOTIATING",reason:"Synthetic seller wishes to discuss terms.",nextAction:"Prepare revised terms.",followUpAt:future(1)},operator,now);
    await assert.rejects(store.transitionLead(id,{version:detail.lead.version,to:"UNDER_CONTRACT",reason:"Contract bypass attempt.",nextAction:"Must remain blocked."},actorId,now),/not available/);
    // Owner approval supersedes rather than edits an earlier communicated proposal.
    detail = await offers.createOfferDraft(id,{...draftInput,version:detail.lead.version,amount:109000},analyst,now);
    const revised = detail.offers.find(o => o.amount === 109000)!;
    detail = await offers.authorizeOffer(id,revised.id,{...approval,version:detail.lead.version},owner,now);
    const earlier = detail.offers.find(o => o.id === approved.id)!;
    assert.equal(earlier.status,"REVOKED");
    assert.equal(earlier.communicatedAmount,approved.amount);
    assert.equal(earlier.evidence,communication.evidence);
    assert.equal(detail.offers.filter(o => o.effectiveStatus === "AUTHORIZED").length,1);
    detail = await offers.withdrawOffer(id,revised.id,{
      version:detail.lead.version,reason:"Synthetic owner revocation.",nextAction:"Review seller needs before making another proposal.",followUpAt:future(1),
    },owner,now);
    assert.equal(detail.lead.stage,"CONVERSATION");
    assert.equal(detail.offers.find(o => o.id === revised.id)!.effectiveStatus,"REVOKED");
    assert.equal((await store.callQueue(new Date(now.getTime()+2*3_600_000))).find(b => b.lead.id === id)!.authorizedOffer,null);
    // New property inputs invalidate every live draft/approval but preserve history.
    detail = await offers.createOfferDraft(id,{...draftInput,version:detail.lead.version,amount:108000},analyst,now);
    const finalId = detail.offers.find(o => o.amount === 108000)!.id;
    detail = await offers.authorizeOffer(id,finalId,{...approval,version:detail.lead.version},owner,now);
    const rowVersion = detail.lead.version;
    await store.updateLead(id,{...payload,version:rowVersion,askingPrice:101000},actorId,now);
    detail = await store.leadDetail(id);
    assert.equal(detail.analysis,null);
    assert.equal(detail.analysisSnapshotId,null);
    assert.equal(detail.lead.stage,"ENRICHING");
    assert.equal(detail.offers.find(o => o.id === finalId)!.status,"INVALIDATED");
    await assert.rejects(offers.communicateOffer(id,finalId,{...communication,amount:108000,version:detail.lead.version},operator,now),e => (e as {status:number}).status===409);
    assert.equal((await db.select().from(analysesTable).where(eq(analysesTable.leadId,id))).length,1);
    assert.equal((await db.select().from(offersTable).where(eq(offersTable.leadId,id))).length,4);
    assert.deepEqual(await store.leadDetail(id),detail);
    logger.info({checks:"draft persistence, owner-only approval, MAO/authority/expiry guards, concurrency conflicts, approved call brief, exact-term human communication, supersession, revocation, followup preservation, evidence/snapshot invalidation"},"Seller offer persistence exercise PASSED (synthetic data; nothing externally communicated)");
  } finally {
    if (id) {
      await db.transaction(async tx => {
        await tx.delete(leadsTable).where(eq(leadsTable.id,id!));
        await tx.delete(auditTable).where(and(eq(auditTable.entityId,id!),eq(auditTable.actor,actorId)));
      });
      assert.equal((await db.select().from(offersTable).where(eq(offersTable.leadId,id))).length,0);
    }
    await pool.end();
  }
}
exercise().catch(error => {
  logger.error({err:error},"Seller offer persistence exercise FAILED");
  process.exitCode = 1;
});