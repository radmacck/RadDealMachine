import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { db, contractsTable, leadsTable, matchesTable } from "@workspace/db";
import { RecordTransactionExceptionBody } from "@workspace/api-zod";
import { assertOperationsRole, DomainError, evidenceUrl, pastInstant, type OfferActor } from "@workspace/deal-domain";
import { audit, lockedLead, move } from "./deal-store";
import { invalidateOffers } from "./offer-records";
import { contractRecord, queueJob } from "./operations-records";
import { lockedContract, save, saveLead } from "./transaction-store";
import { dealOperations } from "./matching-store";

export async function recordTransactionException(id: string, input: z.infer<typeof RecordTransactionExceptionBody>, actor: OfferActor, now = new Date()) {
  assertOperationsRole(actor,["OWNER"]);
  const p = RecordTransactionExceptionBody.parse(input);
  evidenceUrl(p.evidenceUrl);
  const effective = pastInstant(p.effectiveAt,now,"External event time");
  if (p.buyerConsentEvidenceUrl) evidenceUrl(p.buyerConsentEvidenceUrl);
  await db.transaction(async tx=>{
    if (p.kind==="RESTART_CANCELLED") {
      const [lead] = await tx.select().from(leadsTable).where(eq(leadsTable.id,id)).for("update");
      const [row] = await tx.select().from(contractsTable).where(eq(contractsTable.leadId,id)).for("update");
      if (!lead||!row) throw new DomainError("Cancelled transaction not found.",404);
      if (row.version!==p.version) throw new DomainError("Transaction changed; reload.",409);
      if (lead.stage!=="DEAD_DEAL"||row.payload.status!=="CANCELLED") throw new DomainError("Only an evidenced cancelled deal can restart. Closed settlements are immutable.",409);
      const c = contractRecord(row);
      if (c.cancelledAt&&effective<Date.parse(c.cancelledAt)) throw new DomainError("Restart cannot precede the recorded external cancellation.");
      c.history = [...(c.history??[]),{kind:p.kind,recordedAt:now.toISOString(),recordedBy:actor.id,effectiveAt:p.effectiveAt,
        evidenceUrl:p.evidenceUrl,note:p.note,previousState:{stage:lead.stage,status:c.status,attemptNumber:c.attemptNumber??1}}];
      await save(tx,row,c,now);
      await invalidateOffers(tx,id,actor.id,"New attempt requires fresh research and separate exact-term authorization.",now);
      await move(tx,lead,"ENRICHING",p.note,"Reconfirm seller availability/authority and current evidence, refresh underwriting and obtain a new exact approved offer.",actor.id,now);
      await tx.update(leadsTable).set({stage:lead.stage,nextAction:lead.nextAction,analysis:null,analysisSnapshotId:null,
        followUpAt:null,version:lead.version+1,updatedAt:now}).where(eq(leadsTable.id,id));
      await queueJob(tx,"ENRICH_PROPERTY",id,`restart:${id}:${lead.version+1}`,actor.id);
    } else {
      const lead = await lockedLead(tx,id), {row,contract:c} = await lockedContract(tx,id,p.version);
      if (c.status==="DRAFT") throw new DomainError("External transaction exceptions require an executed agreement.",409);
      if (effective<Math.max(Date.parse(c.sellerSignedAt??""),Date.parse(c.acquisitionSignedAt??""))) throw new DomainError("An amendment/release cannot precede agreement execution.");
      const latest = Math.max(0,...(c.history??[]).filter(h=>["AMEND_CLOSING","RELEASE_BUYER","RESTART_CANCELLED"].includes(h.kind)).map(h=>Date.parse(h.effectiveAt)));
      if (effective<latest) throw new DomainError("An older event cannot overwrite a later applied transaction exception. Review the retained history.");
      const {history:_,...previousState} = c;
      if (p.kind==="AMEND_CLOSING") {
        const deadline = Date.parse(p.newClosingAt??"");
        if (!Number.isFinite(deadline)||deadline<=effective) throw new DomainError("The evidenced amended closing deadline must follow the amendment's effective time.");
        if (c.committedBuyerId&&!p.buyerConsentEvidenceUrl) throw new DomainError("Changing a committed closing requires separately reviewed buyer consent evidence.");
        c.closingAt = new Date(deadline).toISOString();
        Object.assign(previousState,{buyerConsentEvidenceUrl:p.buyerConsentEvidenceUrl});
        lead.nextAction = "Review matching and coordination against the externally amended deadline; price and deposit remain frozen.";
      } else {
        if (!c.committedBuyerId||p.buyerId!==c.committedBuyerId) throw new DomainError("Release must identify the exact currently committed buyer.",409);
        if (c.buyerCommittedAt&&effective<Date.parse(c.buyerCommittedAt)) throw new DomainError("Buyer release cannot precede commitment.");
        const [match] = await tx.select().from(matchesTable).where(and(eq(matchesTable.leadId,id),eq(matchesTable.buyerId,p.buyerId))).for("update");
        if (!match||match.payload.status!=="COMMITTED") throw new DomainError("Current buyer commitment record is missing.",409);
        Object.assign(previousState,{buyerResponse:match.payload});
        c.committedBuyerId = null; c.agreedBuyerPrice = null; c.buyerCommittedAt = null; c.commitmentSnapshot = null;
        c.milestones = c.milestones.filter(m=>!["ASSIGNMENT_SIGNED","FUNDS_CONFIRMED"].includes(m.kind));
        c.status = "UNDER_CONTRACT";
        await tx.update(matchesTable).set({payload:{...match.payload,status:"DECLINED",eligible:false,
          evidence:p.note,mismatches:["Owner recorded external buyer release. Prior commitment and milestones retained in transaction history."]},updatedAt:now}).where(eq(matchesTable.id,match.id));
        await move(tx,lead,"UNDER_CONTRACT",p.note,"Qualify replacement buyers; record new actual interest, new commitment and buyer-specific assignment/funds evidence.",actor.id,now);
      }
      c.history = [...(c.history??[]),{kind:p.kind,recordedAt:now.toISOString(),recordedBy:actor.id,effectiveAt:p.effectiveAt,
        evidenceUrl:p.evidenceUrl,note:p.note,previousState}];
      await save(tx,row,c,now); await saveLead(tx,lead,now);
      await queueJob(tx,"MATCH_BUYERS",id,`exception:${id}:${row.version+1}`,actor.id);
    }
    await audit(tx,actor.id,p.kind,id,`${p.note}; external event ${p.effectiveAt}, recorded ${now.toISOString()}. Evidence ${p.evidenceUrl}. No legal release, signature or payment performed by software.`);
  });
  return dealOperations(id,now);
}