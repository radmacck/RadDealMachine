import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, buyersTable } from "@workspace/db";
import { DiscoverBuyerBody, RequestBuyerQualificationBody } from "@workspace/api-zod";
import { assertOperationsRole, DomainError, evidenceUrl, pastInstant, qualificationMaintenanceKind, type OfferActor, type Buyer } from "@workspace/deal-domain";
import { searchPublicProperties } from "./property-source-store";
import { audit } from "./deal-store";
import { allBuyerRecords, buyerRecord, queueJob } from "./operations-records";
type Prospect = ReturnType<typeof DiscoverBuyerBody.parse>;
export function qualificationTask(b: Pick<Buyer,"name"|"criteria"|"destinationKind">, kind:"QUALIFY"|"REVERIFY", now:Date) {
  const market = b.criteria?.cities.length ? ` in ${b.criteria.cities.join(", ")}` : "";
  const destination = b.destinationKind && b.destinationKind!=="BUYER";
  return {id:randomUUID(),kind,state:"WAITING_EXTERNAL" as const,
    reason:kind==="REVERIFY"?"Dated buying/criteria or identity/funding evidence expired. Approval and matching are blocked.":"Discovery is not approval. Confirm identity, contact permission, current buying/accepting status and structured criteria.",
    preparedMessage:`We are updating our investor criteria. Are you currently ${destination?"accepting qualified deals":"buying"}${market}? If so, which states/counties/cities/ZIPs, property types, units, price and ARV ranges, size, beds/baths, rehab scope and strategies fit? Please confirm funding arrangements, closing speed/capacity and exclusions. ${destination?"Please also confirm any fee terms and who can act as the acquisition buyer.":"Current dated identity/funding evidence is required before approval."}`,
    dueAt:now.toISOString(),updatedAt:now.toISOString()};
}
export async function discoverBuyer(input: Prospect, actor: OfferActor, now = new Date(), sourceKey?:string) {
  assertOperationsRole(actor,["OWNER","ANALYST"]);
  const p = DiscoverBuyerBody.parse(input);
  evidenceUrl(p.sourceUrl); pastInstant(p.capturedAt,now,"Discovery observation");
  const key = sourceKey??createHash("sha256").update(`${p.sourceUrl}|${p.name.trim().toLowerCase()}`).digest("hex");
  return db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(current_schema() || ${`prospect:${key}`},0))`);
    const [existing] = await tx.select().from(buyersTable).where(sql`${buyersTable.payload}->>'discoveryKey' = ${key}`);
    if (existing) return buyerRecord(existing,now);
    const payload = {name:p.name.trim(),email:p.email??"",phone:p.phone??"",source:p.source,
      destinationKind:p.destinationKind??"BUYER",criteria:null,status:"PAUSED",currentBuyingStatus:"UNKNOWN",discoveryKey:key,
      discoveryEvidence:{classification:"OBSERVED",source:p.source,sourceUrl:p.sourceUrl,capturedAt:p.capturedAt,confidence:p.confidence}};
    const [row] = await tx.insert(buyersTable).values({payload:{...payload,qualificationTask:qualificationTask(payload,"QUALIFY",now)},createdAt:now,updatedAt:now}).returning();
    if (!row) throw new Error("Prospect insert failed.");
    await audit(tx,actor.id,"BUYER_DISCOVERED",row.id,"Observed source lead only; no contact permission, criteria, funding or current buying inferred. Qualification waits for evidence; no communication was sent.");
    return buyerRecord(row,now);
  });
}
export async function discoverPublicBuyers(now = new Date()) {
  const feed = await searchPublicProperties(undefined,"buyer_candidates",now);
  let reviewed = 0;
  for (const record of feed.records) {
    if (!record.recordedOwner || record.recordedOwner.length>200) continue;
    const key = createHash("sha256").update(`phila-opa-tax-owner:${record.recordedOwner.trim().toUpperCase()}`).digest("hex");
    await discoverBuyer({name:record.recordedOwner,source:`Philadelphia OPA corporate-owner record ${record.id}. Not current buying intent or seller/title verification.`,
      sourceUrl:record.sourceUrl,capturedAt:record.capturedAt,confidence:0.55}, {id:"system:buyer-discovery",role:"ANALYST"},now,key);
    reviewed++;
  }
  return `${reviewed} actual public corporate-owner observations reviewed as unverified prospects. No criteria, contact, current intent, funding or approval inferred. Geography is Philadelphia only.`;
}
export async function reviewBuyerPool(now = new Date()) {
  const rows = await allBuyerRecords(db,now);
  let created = 0;
  for (const b of rows) {
    if (!qualificationMaintenanceKind(b,now)) continue;
    await db.transaction(async tx=>{
      const [row] = await tx.select().from(buyersTable).where(eq(buyersTable.id,b.id)).for("update");
      const current = buyerRecord(row!,now);
      const kind = qualificationMaintenanceKind(current,now);
      if (!kind) return;
      const task = qualificationTask(current,kind,now);
      await tx.update(buyersTable).set({payload:{...row!.payload,qualificationTask:task},version:row!.version+1,updatedAt:now}).where(eq(buyersTable.id,b.id));
      await audit(tx,"system:buyer-pool","BUYER_QUALIFICATION_QUEUED",b.id,`${task.kind}: ${task.reason} External execution is pending, not sent.`);
      created++;
    });
  }
  return `${created} durable qualification/reverification tasks prepared; current approval is computed from dated evidence. No messages sent.`;
}
export async function requestBuyerQualification(id:string,input:unknown,actor:OfferActor,now = new Date()) {
  assertOperationsRole(actor,["OWNER","ANALYST"]);
  const p = RequestBuyerQualificationBody.parse(input);
  return db.transaction(async tx=>{
    const [row] = await tx.select().from(buyersTable).where(eq(buyersTable.id,id)).for("update");
    if (!row) throw new DomainError("Buyer not found.",404);
    if (row.version!==p.version) throw new DomainError("Buyer changed. Reload before requesting additional evidence.",409);
    const b = buyerRecord(row,now);
    if (b.qualificationTask&&["WAITING_EXTERNAL","PENDING_EXECUTION"].includes(b.qualificationTask.state))
      throw new DomainError("An outreach/evidence request is already pending. Use its current handoff.",409);
    const task = qualificationTask(b,b.approvalStatus==="REVERIFICATION_REQUIRED"?"REVERIFY":"QUALIFY",now);
    task.reason = `Explicit additional-evidence request: ${p.note}. Approval remains subject to owner evidence review.`;
    const history = Array.isArray(row.payload.qualificationTaskHistory)?row.payload.qualificationTaskHistory:[];
    const [saved] = await tx.update(buyersTable).set({payload:{...row.payload,qualificationTask:task,
      qualificationTaskHistory:[...history,...(b.qualificationTask?[b.qualificationTask]:[])]},version:row.version+1,updatedAt:now})
      .where(eq(buyersTable.id,id)).returning();
    if (!saved) throw new Error("Qualification request failed.");
    await queueJob(tx,"REVIEW_HANDOFFS",null,`qualification-request:${id}:${saved.version}`,actor.id);
    await queueJob(tx,"MATCH_BUYERS",null,`qualification-block:${id}:${saved.version}`,actor.id);
    await audit(tx,actor.id,"BUYER_MORE_EVIDENCE_REQUESTED",id,`${p.note}; informational qualification request only, no message sent or approval granted.`);
    return buyerRecord(saved,now);
  });
}