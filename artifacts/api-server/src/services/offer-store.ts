import { eq, and, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db, offersTable, leadsTable, sellerOfferPortalsTable, sellerOfferPortalEventsTable, type OfferRow } from "@workspace/db";
import {
  DomainError, assertOfferPermission, validateOfferDraft, validateOfferApproval, offerReviewSnapshotJson,
  validateOfferCommunication, validateOfferWithdrawal,
  type OfferActor, type OfferContext, type OfferDraftInput, type OfferApprovalInput,
  type OfferCommunicationInput, type OfferWithdrawalInput, type LeadDetail,
} from "@workspace/deal-domain";
import { lockedLead, leadDetail, toLead, getAssumptions, move, audit, followupDate } from "./deal-store";
import { toStoredOffer } from "./offer-records";
import { queueJob } from "./operations-records";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function context(tx: Tx, detail: LeadDetail, now: Date): Promise<OfferContext> {
  return {
    lead:detail.lead,analysis:detail.analysis,analysisSnapshotId:detail.analysisSnapshotId,
    intelligence:detail.intelligence,currentPolicy:await getAssumptions(tx),
    conversationLogged:detail.calls.some(c => c.outcome === "CONNECTED"),now,
  };
}
async function lockedOffer(tx: Tx, leadId: string, offerId: string) {
  const [row] = await tx.select().from(offersTable).where(and(eq(offersTable.id,offerId),eq(offersTable.leadId,leadId))).for("update");
  if (!row) throw new DomainError("Offer not found for this lead.",404);
  return row;
}
async function saveOffer(tx: Tx,row: OfferRow,status: string,changes: Record<string,unknown>,now: Date) {
  const [updated] = await tx.update(offersTable).set({status,payload:{...row.payload,...changes},updatedAt:now}).where(eq(offersTable.id,row.id)).returning();
  if (!updated) throw new Error("Offer update failed");
}
export async function createOfferDraft(id: string,input: OfferDraftInput,actor: OfferActor,now = new Date()) {
  assertOfferPermission("DRAFT",actor.role);
  return db.transaction(async tx => {
    if(input.parentOfferId){
      const [locked]=await tx.select().from(leadsTable).where(eq(leadsTable.id,id)).for("update");
      if(!locked)throw new DomainError("Lead not found.",404);
      const previous=await tx.select().from(offersTable).where(eq(offersTable.leadId,id));
      const prior=previous.find(row=>row.payload.idempotencyKey===input.idempotencyKey);
      if(prior){
        if(prior.payload.idempotencyHash!==createHash("sha256").update(JSON.stringify(input)).digest("hex")||prior.createdBy!==actor.id)
          throw new DomainError("Idempotency key was already used for different terms or another actor.",409);
        return leadDetail(id,tx,now);
      }
    }
    const lead = await lockedLead(tx,id,input.version);
    const detail = await leadDetail(id,tx,now);
    let responseEventId:string|null=null;
    if(input.parentOfferId){
      const parent=await lockedOffer(tx,id,input.parentOfferId);
      if(parent.status!=="COMMUNICATED"||parent.analysisSnapshotId!==detail.analysisSnapshotId)
        throw new DomainError("Counteroffer must reference a communicated offer on the current economics snapshot.",409);
      if(input.sellerResponseSource==="SELLER_PORTAL"){
        const [event]=await tx.select({id:sellerOfferPortalEventsTable.id,payload:sellerOfferPortalEventsTable.payload}).from(sellerOfferPortalEventsTable)
          .innerJoin(sellerOfferPortalsTable,eq(sellerOfferPortalsTable.id,sellerOfferPortalEventsTable.portalId))
          .where(and(eq(sellerOfferPortalsTable.offerId,parent.id),eq(sellerOfferPortalEventsTable.eventKey,input.sellerResponseEventKey!),eq(sellerOfferPortalEventsTable.kind,"COUNTERED")));
        if(!event)throw new DomainError("No provider-backed counteroffer response exists for that communicated offer.",409);
        if(event.payload.identityVerification!=="VERIFIED_ONE_TIME_CODE"||!event.payload.counterTerms)
          throw new DomainError("The portal response lacks verified route control or recorded counter terms.",409);
        responseEventId=event.id;
      }
    }
    const draftExpiresAt=input.draftExpiresAt??new Date(now.getTime()+48*3_600_000).toISOString();
    const prepared={...input,draftExpiresAt};
    const offerContext=await context(tx,detail,now);
    validateOfferDraft(prepared,offerContext);
    const {version:_,...terms} = prepared;
    const reviewSnapshotJson=offerReviewSnapshotJson(prepared,offerContext);
    const reviewSnapshotHash=createHash("sha256").update(reviewSnapshotJson).digest("hex");
    const [offer] = await tx.insert(offersTable).values({
      leadId:id,analysisSnapshotId:detail.analysisSnapshotId!,createdBy:actor.id,createdAt:now,updatedAt:now,
      payload:{
          ...terms,reviewSnapshotJson,reviewSnapshotHash,
          ...(input.parentOfferId?{idempotencyKey:input.idempotencyKey,idempotencyHash:createHash("sha256").update(JSON.stringify(input)).digest("hex"),parentOfferId:input.parentOfferId,responseEventId}:{}),
          maximumApprovedAcquisitionPrice:null,authorityEvidenceId:null,
        approvedBy:null,approvedAt:null,approvalReason:null,expiresAt:null,
        communicatedBy:null,communicatedAt:null,communicatedAmount:null,channel:null,evidence:null,withdrawalReason:null,
      },
    }).returning();
    if (!offer) throw new Error("Offer draft insert failed");
    if(input.parentOfferId){
      const parent=await lockedOffer(tx,id,input.parentOfferId);
      await saveOffer(tx,parent,"REVOKED",{authorityEndedAt:now.toISOString(),
        withdrawalReason:`Seller counteroffer recorded; replaced by immutable negotiation version ${offer.id}. Prior communication is retained.`},now);
    }
    await tx.update(leadsTable).set({version:lead.version+1,updatedAt:now}).where(eq(leadsTable.id,id));
    await audit(tx,actor.id,"OFFER_DRAFT_CREATED",id,JSON.stringify({offerId:offer.id,actor:actor.id,at:now.toISOString(),leadVersion:lead.version+1,
       terms:{amount:prepared.amount,earnestMoney:prepared.earnestMoney,closingDays:prepared.closingDays,contingencies:prepared.contingencies,assignmentIntent:prepared.assignmentIntent,draftExpiresAt,parentOfferId:input.parentOfferId??null,responseEventId,sellerResponseSource:input.sellerResponseSource??null,sellerResponseEvidence:input.sellerResponseEvidence??null},
      analysisSnapshotId:detail.analysisSnapshotId,reviewSnapshotHash,reason:prepared.reason,status:"DRAFT_NOT_AN_OFFER_NOT_SENT"}));
    return leadDetail(id,tx,now);
  });
}
export async function authorizeOffer(id: string,offerId: string,input: OfferApprovalInput,actor: OfferActor,now = new Date()) {
  assertOfferPermission("AUTHORIZE",actor.role);
  return db.transaction(async tx => {
    const lead = await lockedLead(tx,id,input.version);
    const offer = await lockedOffer(tx,id,offerId);
    const detail = await leadDetail(id,tx,now);
    validateOfferApproval(toStoredOffer(offer),input,await context(tx,detail,now));
    // Exactly one live approval per lead. Superseding does not erase a past communication.
    const older = await tx.select().from(offersTable).where(and(eq(offersTable.leadId,id),inArray(offersTable.status,["AUTHORIZED","COMMUNICATED"])));
    for (const old of older) {
      await saveOffer(tx,old,"REVOKED",{authorityEndedAt:now.toISOString(),withdrawalReason:`Superseded by owner-approved offer ${offerId}; prior seller communication is not recalled.`},now);
      await audit(tx,actor.id,"OFFER_SUPERSEDED",id,`Offer ${old.id} superseded by ${offerId}. Prior communications retained.`);
    }
    await saveOffer(tx,offer,"AUTHORIZED",{
      maximumApprovedAcquisitionPrice:input.maximumApprovedAcquisitionPrice,
      authorityEvidenceId:input.authorityEvidenceId,approvedBy:actor.id,approvedAt:now.toISOString(),
      approvalReason:input.reason,expiresAt:input.expiresAt,
    },now);
    await move(tx,lead,"OFFER_READY",`Owner approved offer ${offerId}: ${input.reason}`,input.nextAction,actor.id,now);
    await tx.update(leadsTable).set({
      stage:lead.stage,nextAction:lead.nextAction,followUpAt:followupDate(input.followUpAt,now),
      version:lead.version+1,updatedAt:now,
    }).where(eq(leadsTable.id,id));
     await audit(tx,actor.id,"OFFER_AUTHORIZED",id,JSON.stringify({offerId,actor:actor.id,approvedAt:now.toISOString(),leadVersion:lead.version+1,
       exactTerms:{amount:offer.payload.amount,earnestMoney:offer.payload.earnestMoney,closingDays:offer.payload.closingDays,contingencies:offer.payload.contingencies,assignmentIntent:offer.payload.assignmentIntent},
       reviewSnapshotHash:offer.payload.reviewSnapshotHash,maximumApprovedAcquisitionPrice:input.maximumApprovedAcquisitionPrice,
       expiresAt:input.expiresAt,analysisSnapshotId:offer.analysisSnapshotId,authorityEvidenceId:input.authorityEvidenceId,
       status:"AUTHORIZED_NOT_SENT_NOT_A_CONTRACT"}));
    return leadDetail(id,tx,now);
  });
}
export async function getOfferReview(id:string,offerId:string) {
  const row=await db.select().from(offersTable).where(and(eq(offersTable.id,offerId),eq(offersTable.leadId,id))).then(rows=>rows[0]);
  if(!row) throw new DomainError("Offer not found for this lead.",404);
  const payload=row.payload as Record<string,unknown>;
  if(typeof payload.reviewSnapshotJson!=="string"||typeof payload.reviewSnapshotHash!=="string"||typeof payload.draftExpiresAt!=="string")
    throw new DomainError("This historical offer has no prepared review packet; create a new draft.",409);
  return {offerId,draftExpiresAt:payload.draftExpiresAt,reviewSnapshotJson:payload.reviewSnapshotJson,reviewSnapshotHash:payload.reviewSnapshotHash};
}
export async function communicateOffer(id: string,offerId: string,input: OfferCommunicationInput,actor: OfferActor,now = new Date()) {
  assertOfferPermission("COMMUNICATE",actor.role);
  return db.transaction(async tx => {
    const lead = await lockedLead(tx,id,input.version);
    const offer = await lockedOffer(tx,id,offerId);
    const detail = await leadDetail(id,tx,now);
    validateOfferCommunication(toStoredOffer(offer),input,await context(tx,detail,now));
    await saveOffer(tx,offer,"COMMUNICATED",{
      communicatedBy:actor.id,communicatedAt:now.toISOString(),communicatedAmount:input.amount,
      channel:input.channel,evidence:input.evidence,
    },now);
    await move(tx,lead,"OFFER_SENT",`Human communication recorded for offer ${offerId} via ${input.channel}: ${input.evidence}`,input.nextAction,actor.id,now);
    await tx.update(leadsTable).set({
      stage:lead.stage,nextAction:lead.nextAction,followUpAt:followupDate(input.followUpAt,now),
      version:lead.version+1,updatedAt:now,
    }).where(eq(leadsTable.id,id));
    await audit(tx,actor.id,"OFFER_COMMUNICATION_RECORDED",id,`Offer ${offerId}, exact amount $${input.amount}, channel ${input.channel}, evidence: ${input.evidence}. Human attestation only; system sent nothing and executed no contract.`);
    await queueJob(tx,"EVALUATE_DECISION",id,`decision:${id}:offer-communication:${offerId}`,actor.id,
      {trigger:"OFFER_COMMUNICATION_RECORDED",offerId,analysisSnapshotId:offer.analysisSnapshotId});
    return leadDetail(id,tx,now);
  });
}
export async function withdrawOffer(id: string,offerId: string,input: OfferWithdrawalInput,actor: OfferActor,now = new Date()) {
  return db.transaction(async tx => {
    const lead = await lockedLead(tx,id,input.version);
    const offer = await lockedOffer(tx,id,offerId);
    assertOfferPermission("WITHDRAW",actor.role,toStoredOffer(offer));
    if (actor.role === "ANALYST" && offer.createdBy !== actor.id) {
      throw new DomainError("Analysts may cancel only their own drafts; ask the owner to withdraw this draft.",403);
    }
    validateOfferWithdrawal(toStoredOffer(offer),input,now);
    await saveOffer(tx,offer,"REVOKED",{authorityEndedAt:offer.payload.authorityEndedAt??now.toISOString(),withdrawalReason:input.reason},now);
    const newStage = offer.status === "DRAFT" ? toLead(lead).stage : "CONVERSATION";
    await move(tx,lead,newStage,`Offer ${offerId} withdrawn internally: ${input.reason}. Prior communications are not recalled.`,input.nextAction,actor.id,now);
    await tx.update(leadsTable).set({
      stage:lead.stage,nextAction:lead.nextAction,followUpAt:followupDate(input.followUpAt,now),
      version:lead.version+1,updatedAt:now,
    }).where(eq(leadsTable.id,id));
    await audit(tx,actor.id,"OFFER_WITHDRAWN",id,`Offer ${offerId}, previously ${offer.status}: ${input.reason}. Approval revoked; no automatic seller notification and no recall of earlier communications.`);
    return leadDetail(id,tx,now);
  });
}