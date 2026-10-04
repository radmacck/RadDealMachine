import { eq, and, inArray, asc } from "drizzle-orm";
import { db, offersTable, auditTable, leadsTable, transitionsTable, type OfferRow } from "@workspace/db";
import { evaluateOffer, type StoredOffer, type OfferContext } from "@workspace/deal-domain";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export function toStoredOffer(row: OfferRow): StoredOffer {
  return {
    ...row.payload,id:row.id,leadId:row.leadId,analysisSnapshotId:row.analysisSnapshotId,status:row.status,
    createdBy:row.createdBy,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString(),
  } as StoredOffer;
}
export async function offersForLead(tx: typeof db|Tx, id: string, context: OfferContext) {
  const rows = await tx.select().from(offersTable).where(eq(offersTable.leadId,id)).orderBy(asc(offersTable.createdAt),asc(offersTable.id));
  return rows.map(row => evaluateOffer(toStoredOffer(row),context));
}
/** Terms and original approval/communication metadata are never overwritten by invalidation. */
export async function invalidateOffers(tx: Tx, id: string, actor: string, reason: string, now: Date) {
  const rows = await tx.select().from(offersTable).where(and(eq(offersTable.leadId,id),inArray(offersTable.status,["DRAFT","AUTHORIZED","COMMUNICATED"])));
  for (const row of rows) {
    await tx.update(offersTable).set({status:"INVALIDATED",payload:{...row.payload,authorityEndedAt:now.toISOString(),withdrawalReason:reason},updatedAt:now}).where(eq(offersTable.id,row.id));
    await tx.insert(auditTable).values({actor,action:"OFFER_INVALIDATED",entityId:id,detail:`Offer ${row.id}: ${reason}. Historical seller communications are not recalled.`,createdAt:now});
  }
}
export async function invalidateOffersForPolicyChange(tx: Tx,actor: string,now: Date) {
  const rows = await tx.selectDistinct({leadId:offersTable.leadId}).from(offersTable)
    .where(inArray(offersTable.status,["DRAFT","AUTHORIZED","COMMUNICATED"])).orderBy(asc(offersTable.leadId));
  for (const {leadId} of rows) {
    const [lead] = await tx.select().from(leadsTable).where(eq(leadsTable.id,leadId)).for("update");
    if (!lead) continue;
    const reason = "Workspace assumptions changed. Refresh underwriting and obtain new owner approval.";
    await invalidateOffers(tx,leadId,actor,reason,now);
    const stage = ["OFFER_READY","OFFER_SENT","NEGOTIATING"].includes(lead.stage) ? "CONVERSATION" : lead.stage;
    await tx.insert(transitionsTable).values({leadId,from:lead.stage,to:stage,reason,nextAction:reason,actor,createdAt:now});
    await tx.update(leadsTable).set({stage,nextAction:reason,version:lead.version+1,updatedAt:now}).where(eq(leadsTable.id,leadId));
  }
}