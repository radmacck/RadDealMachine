import { eq } from "drizzle-orm";
import { intelligenceTable, leadsTable } from "@workspace/db";
import { sellerHandoffReplyEvidence, type HumanHandoff, type HandoffEventInput, type OfferActor } from "@workspace/deal-domain";
import { audit } from "./deal-store";
import { queueJob, type Tx } from "./operations-records";

/** Called inside the event transaction: evidence, queued reviews and audit are atomic. */
export async function retainSellerHandoffReply(tx: Tx,h: HumanHandoff,event: HandoffEventInput,actor: OfferActor,now: Date) {
  const evidence = sellerHandoffReplyEvidence(h,event,now);
  const [saved] = await tx.insert(intelligenceTable).values({leadId:h.subjectId,payload:{...evidence},
    createdBy:actor.id,createdAt:now}).returning();
  if (!saved) throw new Error("Seller reply evidence persistence failed.");
  const [lead] = await tx.select().from(leadsTable).where(eq(leadsTable.id,h.subjectId));
  if (lead&&!["CLOSED","DEAD_DEAL"].includes(lead.stage)) {
    await queueJob(tx,"MATCH_BUYERS",lead.id,`seller-reply:matching:${h.id}:${event.eventKey}`,actor.id);
    await queueJob(tx,"REVIEW_DEADLINES",null,`seller-reply:deadlines:${h.id}:${event.eventKey}`,actor.id);
  }
  // Raw coordination is append-only. Deliberately do not call financial evidence
  // mutation commands, change stages, invalidate offers or infer new deal terms.
  await audit(tx,actor.id,"SELLER_REPLY_EVIDENCE_RETAINED",h.subjectId,
    `Handoff ${h.id}; event ${event.eventKey}; intelligence ${saved.id}; actual ${event.occurredAt}; recorded ${now.toISOString()}. INDICATED only; reviewed financial evidence and external commitments unchanged.`);
}