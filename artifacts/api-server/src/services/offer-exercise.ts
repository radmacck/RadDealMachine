/**
 * Actual PostgreSQL-backed offer exercise. Synthetic records are isolated by
 * generated lead ID and removed in finally. This does not authenticate a real
 * user, test signed-in rendering, communicate externally or verify a real deal.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db, pool, leadsTable, offersTable, analysesTable, auditTable, callsTable } from "@workspace/db";
import { analyzeDealScenarios, buildOfferReadinessScorecard, type LeadInput, type UnderwritingInput, type OfferApprovalInput, type OfferReadinessInput, type OfferReadinessKey } from "@workspace/deal-domain";
import { logger } from "../lib/logger";
import * as store from "./deal-store";
import { exerciseEvidence } from "./exercise-evidence";
import * as offers from "./offer-store";
import { authorizeReviewedOffer } from "./offer-exercise-helpers";
import { recordSellerContactObservation } from "./seller-contact-store";

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
    const underwritingPriorVersion = detail.lead.version;
    const underwritingPriorStage = detail.lead.stage;
    detail = await store.saveUnderwriting(id,await exerciseEvidence(id,underwriting,actorId,now),actorId,now);
    assert.ok(detail.analysisSnapshotId);
    const underwritingTransitionAudits = await db.select().from(auditTable)
      .where(and(eq(auditTable.entityId,id),eq(auditTable.action,"DEAL_TRANSITION")));
    const underwritingEdges = underwritingTransitionAudits.map(row => JSON.parse(row.detail) as Record<string,unknown>)
      .filter(event => event.eventType === "CANONICAL_STAGE_TRANSITION"
        && Number(event.priorVersion) >= underwritingPriorVersion
        && Number(event.resultingVersion) <= detail.lead.version);
    assert.deepEqual(underwritingEdges.map(event => [
      event.priorVersion,event.resultingVersion,event.priorStage,event.resultingStage,
    ]),[
      [underwritingPriorVersion,underwritingPriorVersion+1,underwritingPriorStage,"ANALYZED"],
      [underwritingPriorVersion+1,underwritingPriorVersion+2,"ANALYZED",detail.lead.stage],
    ],"A multi-stage underwriting save must persist a contiguous canonical version chain.");
    assert.equal(detail.lead.version,underwritingPriorVersion+2);
    const savedSnapshotId = detail.analysisSnapshotId;
    const savedAnalysis = structuredClone(detail.analysis);
    const savedAnalysisCount = (await db.select().from(analysesTable).where(eq(analysesTable.leadId,id))).length;
    const [initialSnapshotRow]=await db.select().from(analysesTable).where(eq(analysesTable.id,savedSnapshotId));
    const immutableSnapshotBefore=structuredClone(initialSnapshotRow?.snapshot);
    const scenarioResult = analyzeDealScenarios(detail.analysis!,20);
    assert.equal(scenarioResult.scenarios.length,3);
    assert.equal(scenarioResult.calculationAvailable,true);
    assert.equal(detail.analysisSnapshotId,savedSnapshotId);
    assert.deepEqual(detail.analysis,savedAnalysis,"Scenario calculations must not overwrite the authoritative analysis.");
    assert.equal((await db.select().from(analysesTable).where(eq(analysesTable.leadId,id))).length,savedAnalysisCount,
      "Scenario calculations must not create an underwriting snapshot.");
    const draftInput = {
      version:detail.lead.version,amount:110000,earnestMoney:1000,closingDays:30,
      contingencies:"Subject to diligence, title and executed contract.",assignmentIntent:true,reason:"Synthetic proposal exercise.",
    };
    await assert.rejects(offers.createOfferDraft(id,draftInput,analyst,now),/conversation/i);
    detail = await store.transitionLead(id,{version:detail.lead.version,to:"CALL_READY",reason:"Synthetic research reviewed.",nextAction:"Run synthetic conversation."},actorId,now);
    const callPriorVersion = detail.lead.version;
    const callInput = {
      version:callPriorVersion,outcome:"CONNECTED" as const,notes:"Synthetic seller conversation logged.",
      nextAction:"Review synthetic offer.",followUpAt:future(1),idempotencyKey:`synthetic-call:${randomUUID()}`,
    };
    detail = await store.recordCall(id,callInput,actorId,now);
    const callTransitionAudits = await db.select().from(auditTable)
      .where(and(eq(auditTable.entityId,id),eq(auditTable.action,"DEAL_TRANSITION")));
    const callEdges = callTransitionAudits.map(row => JSON.parse(row.detail) as Record<string,unknown>)
      .filter(event => event.eventType === "CANONICAL_STAGE_TRANSITION"
        && Number(event.priorVersion) >= callPriorVersion
        && Number(event.resultingVersion) <= detail.lead.version);
    assert.deepEqual(callEdges.map(event => [
      event.priorVersion,event.resultingVersion,event.priorStage,event.resultingStage,
    ]),[
      [callPriorVersion,callPriorVersion+1,"CALL_READY","CONTACTED"],
      [callPriorVersion+1,callPriorVersion+2,"CONTACTED","CONVERSATION"],
    ],"A connected call's intermediate CONTACTED state must not share a canonical version with CONVERSATION.");
    assert.equal(detail.lead.version,callPriorVersion+2);
    const callsBeforeReplay = (await db.select().from(callsTable).where(eq(callsTable.leadId,id))).length;
    const versionBeforeReplay = detail.lead.version;
    const replayedCall = await store.recordCall(id,callInput,actorId,now);
    assert.equal(replayedCall.lead.version,versionBeforeReplay,"An exact call replay must not advance canonical deal state.");
    assert.equal((await db.select().from(callsTable).where(eq(callsTable.leadId,id))).length,callsBeforeReplay,
      "An exact call replay must not append a second call record.");
    const transitionsBeforeInvalid = (await db.select().from(auditTable)
      .where(and(eq(auditTable.entityId,id),eq(auditTable.action,"DEAL_TRANSITION")))).length;
    await assert.rejects(store.transitionLead(id,{version:detail.lead.version,to:"OFFER_READY",reason:"Attempt stage bypass.",nextAction:"Must remain blocked."},actorId,now),/not available/);
    const afterInvalidTransition = await store.leadDetail(id);
    assert.equal(afterInvalidTransition.lead.stage,"CONVERSATION");
    assert.equal(afterInvalidTransition.lead.version,versionBeforeReplay,"Rejected transitions must not mutate canonical stage/version.");
    assert.equal((await db.select().from(auditTable)
      .where(and(eq(auditTable.entityId,id),eq(auditTable.action,"DEAL_TRANSITION")))).length,transitionsBeforeInvalid,
      "Rejected transitions must not append a canonical audit edge.");
    detail = afterInvalidTransition;
    await assert.rejects(offers.createOfferDraft(id,{...draftInput,version:detail.lead.version},operator,now),e => (e as {status:number}).status===403);
    const analysisBeforeDraft=structuredClone(detail.analysis);
    detail = await offers.createOfferDraft(id,{...draftInput,version:detail.lead.version},analyst,now);
    const firstId = detail.offers[0]!.id;
    assert.equal(detail.offers[0]!.effectiveStatus,"DRAFT",JSON.stringify(detail.offers[0]!.blockers));
    assert.deepEqual(detail.analysis,analysisBeforeDraft,"Draft preparation must not alter deterministic underwriting.");
    const firstReview=await offers.getOfferReview(id,firstId);
    const reviewJson=JSON.parse(firstReview.reviewSnapshotJson) as {
      purchasePrice:number;assignment:{legalStatus:string};analysisSnapshotId:string;
      underwritingSnapshot:{id:string;input:UnderwritingInput;analysis:unknown};
      sourceEvidence:Array<{id:string;confidence:number}>;missingEvidence:string[];
      downsideScenario:{name:string;mao:number};
    };
    assert.equal(reviewJson.purchasePrice,draftInput.amount);
    assert.equal(reviewJson.assignment.legalStatus,"NOT_ASSESSED");
    assert.equal(reviewJson.analysisSnapshotId,detail.analysisSnapshotId);
    assert.equal(reviewJson.underwritingSnapshot.id,savedSnapshotId);
    assert.deepEqual(reviewJson.underwritingSnapshot.input,detail.underwriting,
      "Offer packet must contain the exact persisted deterministic underwriting input.");
    assert.deepEqual(reviewJson.underwritingSnapshot.analysis,detail.analysis,
      "Offer packet must contain the immutable analysis result referenced by its snapshot id.");
    const [persistedSnapshot]=await db.select().from(analysesTable).where(eq(analysesTable.id,savedSnapshotId));
    const persistedSnapshotContent=persistedSnapshot?.snapshot as {input:UnderwritingInput}|undefined;
    assert.deepEqual(reviewJson.underwritingSnapshot.input,persistedSnapshotContent?.input,
      "Offer review content must match the immutable analysis row, not a separately reconstructed calculation.");
    assert.ok(reviewJson.sourceEvidence.length>=7,"Offer packet should resolve source evidence linked to subject, comps and repair scope.");
    assert.equal(reviewJson.missingEvidence.length,0,"Ready synthetic exercise inputs have no missing evidence.");
    assert.equal(reviewJson.downsideScenario.name,"LOW");
    await assert.rejects(offers.communicateOffer(id,firstId,{
      version:detail.lead.version,amount:110000,channel:"PHONE",evidence:"Must not succeed before approval.",
      nextAction:"Blocked before approval.",followUpAt:future(1),
    },operator,now),/not currently authorized/);
    let approval: OfferApprovalInput = {
      version:detail.lead.version,maximumApprovedAcquisitionPrice:120000,expiresAt:future(48),
      authorityEvidenceId:evidence.id,reason:"Synthetic terms and economics reviewed.",nextAction:"Communicate exact approved proposal.",followUpAt:future(1),
    };
    await assert.rejects(offers.authorizeOffer(id,firstId,{...approval,version:detail.lead.version-1,reviewSnapshotHash:firstReview.reviewSnapshotHash},owner,now),/changed in another session/);
    await assert.rejects(offers.authorizeOffer(id,firstId,approval,owner,now),/exact current review packet/);
    await assert.rejects(offers.authorizeOffer(id,firstId,approval,analyst,now),e => (e as {status:number}).status===403);
    await assert.rejects(authorizeReviewedOffer(id,firstId,{...approval,maximumApprovedAcquisitionPrice:detail.analysis!.mao+1},owner,now),/MAO/);
    await assert.rejects(authorizeReviewedOffer(id,firstId,{...approval,authorityEvidenceId:randomUUID()},owner,now),/authority/i);
    // Two approvals with the same optimistic version: exactly one may win.
    detail = await offers.createOfferDraft(id,{...draftInput,version:detail.lead.version,amount:111000},analyst,now);
    const secondId = detail.offers.find(o => o.id !== firstId)!.id;
    approval = {...approval,version:detail.lead.version};
    const results = await Promise.allSettled([
      authorizeReviewedOffer(id,firstId,approval,owner,now),
      authorizeReviewedOffer(id,secondId,approval,owner,now),
    ]);
    assert.equal(results.filter(r => r.status === "fulfilled").length,1);
    assert.equal(results.filter(r => r.status === "rejected").length,1);
    detail = await store.leadDetail(id);
    assert.equal(detail.lead.stage,"OFFER_READY");
    assert.equal(detail.offers.filter(o => o.effectiveStatus === "AUTHORIZED").length,1);
    const approved = detail.offers.find(o => o.effectiveStatus === "AUTHORIZED")!;
    const approvalAudits=await db.select().from(auditTable).where(and(eq(auditTable.entityId,id),eq(auditTable.action,"OFFER_AUTHORIZED")));
    assert.ok(approvalAudits.some(a=>{const x=JSON.parse(a.detail);return x.actor===owner.id&&x.reviewSnapshotHash&&x.exactTerms?.amount===approved.amount&&x.approvedAt;}),"Approval audit must preserve actor, timestamp, hash, exact terms, and approved amount.");
    const authorizedVersion = detail.lead.version;
    await assert.rejects(authorizeReviewedOffer(id,approved.id,approval,owner,now),/changed in another session/);
    const afterApprovalReplay = await store.leadDetail(id);
    assert.equal(afterApprovalReplay.lead.version,authorizedVersion,"Replaying an approval against its old deal version must not advance state.");
    assert.equal((await db.select().from(auditTable).where(and(eq(auditTable.entityId,id),eq(auditTable.action,"OFFER_AUTHORIZED")))).length,
      approvalAudits.length,"A stale approval replay must not append another approval event.");
    detail = afterApprovalReplay;
    const contactResearchSnapshot = {
      analysis:structuredClone(detail.analysis),
      analysisSnapshotId:detail.analysisSnapshotId,
      underwriting:structuredClone(detail.underwriting),
      stage:detail.lead.stage,
      nextAction:detail.lead.nextAction,
      authorizedOffer:structuredClone(approved),
    };
    const contactResearch = await recordSellerContactObservation(id,{
      version:detail.lead.version,channel:"OTHER",routeValue:"SYNTHETIC review-only route note",
      recipient:"SYNTHETIC exercise seller",recipientRole:"UNKNOWN",classification:"OBSERVED",confidence:0.2,
      sourceType:"ANALYST",sourceId:"synthetic-contact-research",sourceName:"SYNTHETIC review-only source",
      sourceRecordId:"SYNTHETIC-CONTACT-RESEARCH-001",permissionStatus:"NOT_REVIEWED",
      routeVerificationStatus:"UNREVIEWED",verificationNote:"SYNTHETIC evidence only; no communication occurred.",
    },owner,now);
    detail = await store.leadDetail(id);
    assert.equal(contactResearch.directRouteStatus,"PHONE_ROUTE_AVAILABLE");
    assert.deepEqual(detail.analysis,contactResearchSnapshot.analysis);
    assert.equal(detail.analysisSnapshotId,contactResearchSnapshot.analysisSnapshotId);
    assert.deepEqual(detail.underwriting,contactResearchSnapshot.underwriting);
    assert.equal(detail.lead.stage,contactResearchSnapshot.stage);
    assert.equal(detail.lead.nextAction,contactResearchSnapshot.nextAction);
    assert.deepEqual(detail.offers.find(o => o.id === approved.id),contactResearchSnapshot.authorizedOffer,
      "Contact research must not change or revoke an already owner-authorized offer.");
    const persistedReady=(state:"READY"|"REVIEW"|"BLOCKED",evidence:string[],missingEvidence:string[]=[])=>({
      state,evidence,missingEvidence,remedy:state==="READY"?"Recheck before use.":"Add or review the named evidence before relying on this criterion.",
    });
    const persistedAuthority=detail.intelligence.some(i=>i.classification==="VERIFIED_FACTS"&&i.sourceType==="PUBLIC_RECORD"&&["ownership","owner_authority","seller_authority"].includes(i.category.toLowerCase())&&!!i.verificationNote);
    const readinessInput:OfferReadinessInput={
      hardStopKeys:["PROPERTY_IDENTITY","SELLER_AUTHORITY","CONTACTABILITY","COMPS_ARV","REPAIR_ASSUMPTIONS","DETERMINISTIC_MAO","LEGAL_STRATEGY","CURRENT_APPROVAL"],
      PROPERTY_IDENTITY:persistedReady(detail.lead.address&&detail.lead.city&&detail.lead.state&&detail.lead.zip?"READY":"BLOCKED",[detail.lead.address]),
      SELLER_AUTHORITY:persistedReady(persistedAuthority?"READY":"BLOCKED",persistedAuthority?["verified public-record authority evidence"]:[],persistedAuthority?[]:["current verified authority record"]),
      CONTACTABILITY:persistedReady("BLOCKED",[],["route permission remains NOT_REVIEWED"]),
      COMPS_ARV:persistedReady(detail.analysis&&detail.analysis.compDecisions.some(c=>c.included)?"READY":"BLOCKED",[`${detail.analysis?.compDecisions.filter(c=>c.included).length??0} included comps`]),
      REPAIR_ASSUMPTIONS:persistedReady(detail.analysis?.repairEstimate.blockers.length===0&&!!detail.analysis.repairEstimate.total?"READY":"BLOCKED",["persisted repair estimate"]),
      TRANSACTION_COSTS:persistedReady(detail.analysis?"READY":"BLOCKED",["persisted cost assumptions"]),
      DETERMINISTIC_MAO:persistedReady(detail.analysis&&detail.analysis.mao>0&&!!detail.analysisSnapshotId?"READY":"BLOCKED",[detail.analysis?`MAO ${detail.analysis.mao}`:"No analysis"]),
      LEGAL_STRATEGY:persistedReady("REVIEW",[],["deal-specific qualified legal review"]),
      CURRENT_APPROVAL:persistedReady(approved.effectiveStatus==="AUTHORIZED"&&!approved.blockers.length?"READY":"BLOCKED",[approved.effectiveStatus]),
    };
    const readiness=buildOfferReadinessScorecard(readinessInput);
    assert.equal(readiness.authorizesOffer,false);
    assert.ok(readiness.hardStops.some(c=>c.key==="CONTACTABILITY"),"Persisted unreviewed contact permission remains a hard stop.");
    assert.ok(readiness.hardStops.some(c=>c.key==="LEGAL_STRATEGY"),"Unreviewed legal strategy remains a hard stop despite owner approval.");
    assert.equal(readiness.score,buildOfferReadinessScorecard(readinessInput).score,"Persisted score calculation is repeatable.");
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
    const counterInput={
      ...draftInput,version:detail.lead.version,amount:109500,parentOfferId:approved.id,
      sellerResponseSource:"HUMAN_ENTERED" as const,
      sellerResponseEvidence:"Synthetic exercise: seller verbally proposed changed price during a connected call; operator recorded this response explicitly.",
      idempotencyKey:randomUUID(),
    };
    const competingInput={...counterInput,amount:109400,idempotencyKey:randomUUID()};
    const outcomes=await Promise.allSettled([
      offers.createOfferDraft(id,counterInput,analyst,now),
      offers.createOfferDraft(id,competingInput,analyst,now),
    ]);
    assert.equal(outcomes.filter(o=>o.status==="fulfilled").length,1,"Only one competing counteroffer may win a lead-version race.");
    assert.equal(outcomes.filter(o=>o.status==="rejected").length,1);
    const winningInput=outcomes[0].status==="fulfilled"?counterInput:competingInput;
    const counterA=outcomes[0].status==="fulfilled"?outcomes[0].value:(outcomes[1] as PromiseFulfilledResult<Awaited<ReturnType<typeof offers.createOfferDraft>>>).value;
    const counter=counterA.offers.find(o=>o.amount===winningInput.amount)!;
    const retry=await offers.createOfferDraft(id,winningInput,analyst,now);
    assert.equal(retry.offers.length,counterA.offers.length,"Same-key replay must be idempotent after concurrent submission.");
    assert.equal(counter.status,"DRAFT","Seller response creates a draft only, never an accepted offer.");
    assert.equal(counterA.offers.find(o=>o.id===approved.id)!.status,"REVOKED","A seller counteroffer ends prior internal authority without erasing communication.");
    const counterReview=await offers.getOfferReview(id,counter.id);
    const lineage=JSON.parse(counterReview.reviewSnapshotJson).negotiationLineage;
    assert.equal(lineage.parentOfferId,approved.id);
    assert.equal(lineage.responseSource,"HUMAN_ENTERED");
    assert.deepEqual(counterA.analysis,savedAnalysis,"Negotiation versioning must not change deterministic underwriting.");
    const counterAudit=(await db.select().from(auditTable).where(eq(auditTable.entityId,id)))
      .find(row=>row.action==="OFFER_DRAFT_CREATED"&&row.detail.includes(counter.id));
    assert.ok(counterAudit,"Counteroffer terms and provenance must be in the durable audit history.");
    assert.match(counterAudit!.detail,/sellerResponseEvidence/);
    await assert.rejects(offers.createOfferDraft(id,{...winningInput,amount:109600},analyst,now),/Idempotency key/);
    await assert.rejects(offers.communicateOffer(id,counter.id,{...communication,version:counterA.lead.version,amount:109500},operator,now),/not currently authorized/);
    detail=counterA;
    await assert.rejects(offers.communicateOffer(id,approved.id,{...communication,version:detail.lead.version},operator,now),/counteroffer recorded/);
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
    detail = await authorizeReviewedOffer(id,revised.id,{...approval,version:detail.lead.version},owner,now);
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
    detail = await authorizeReviewedOffer(id,finalId,{...approval,version:detail.lead.version},owner,now);
    const rowVersion = detail.lead.version;
    await store.updateLead(id,{...payload,version:rowVersion,askingPrice:101000},actorId,now);
    detail = await store.leadDetail(id);
    assert.equal(detail.analysis,null);
    assert.equal(detail.analysisSnapshotId,null);
    assert.equal(detail.lead.stage,"ENRICHING");
    assert.equal(detail.offers.find(o => o.id === finalId)!.status,"INVALIDATED");
    const [oldSnapshotAfterInputChange]=await db.select().from(analysesTable).where(eq(analysesTable.id,savedSnapshotId));
    assert.deepEqual(oldSnapshotAfterInputChange?.snapshot,immutableSnapshotBefore,
      "A material property change invalidates the active approval without rewriting its immutable underwriting snapshot.");
    await assert.rejects(offers.communicateOffer(id,finalId,{...communication,amount:108000,version:detail.lead.version},operator,now),e => (e as {status:number}).status===409);
    assert.equal((await db.select().from(analysesTable).where(eq(analysesTable.leadId,id))).length,1);
    assert.equal((await db.select().from(offersTable).where(eq(offersTable.leadId,id))).length,5);
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