import { eq, and, inArray } from "drizzle-orm";
import { db, offersTable, leadsTable, type OfferRow } from "@workspace/db";
import {
  DomainError, assertOfferPermission, validateOfferDraft, validateOfferApproval,
  validateOfferCommunication, validateOfferWithdrawal,
  type OfferActor, type OfferContext, type OfferDraftInput, type OfferApprovalInput,
  type OfferCommunicationInput, type OfferWithdrawalInput, type LeadDetail,
} from "@workspace/deal-domain";
import { lockedLead, leadDetail, toLead, getAssumptions, move, audit, followupDate } from "./deal-store";
import { toStoredOffer } from "./offer-records";

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
    const lead = await lockedLead(tx,id,input.version);
    const detail = await leadDetail(id,tx,now);
    validateOfferDraft(input,await context(tx,detail,now));
    const {version:_,...terms} = input;
    const [offer] = await tx.insert(offersTable).values({
      leadId:id,analysisSnapshotId:detail.analysisSnapshotId!,createdBy:actor.id,createdAt:now,updatedAt:now,
      payload:{
        ...terms,maximumApprovedAcquisitionPrice:null,authorityEvidenceId:null,
        approvedBy:null,approvedAt:null,approvalReason:null,expiresAt:null,
        communicatedBy:null,communicatedAt:null,communicatedAmount:null,channel:null,evidence:null,withdrawalReason:null,
      },
    }).returning();
    if (!offer) throw new Error("Offer draft insert failed");
    await tx.update(leadsTable).set({version:lead.version+1,updatedAt:now}).where(eq(leadsTable.id,id));
    await audit(tx,actor.id,"OFFER_DRAFT_CREATED",id,`Draft ${offer.id}, $${input.amount}, analysis ${detail.analysisSnapshotId}. Immutable terms; not approved, not communicated, not a contract. Reason: ${input.reason}`);
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
      await saveOffer(tx,old,"REVOKED",{withdrawalReason:`Superseded by owner-approved offer ${offerId}; prior seller communication is not recalled.`},now);
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
    await audit(tx,actor.id,"OFFER_AUTHORIZED",id,`Offer ${offerId}; exact approved amount $${offer.payload.amount}; ceiling $${input.maximumApprovedAcquisitionPrice}; expires ${input.expiresAt}; analysis ${offer.analysisSnapshotId}; public-record authority ${input.authorityEvidenceId}. Not title clearance, communication or contract.`);
    return leadDetail(id,tx,now);
  });
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
    await saveOffer(tx,offer,"REVOKED",{withdrawalReason:input.reason},now);
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