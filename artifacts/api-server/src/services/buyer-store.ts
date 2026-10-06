import { eq } from "drizzle-orm";
import type { z } from "zod";
import { db, buyersTable } from "@workspace/db";
import { CreateBuyerBody, UpdateBuyerBody, VerifyBuyerBody } from "@workspace/api-zod";
import { assertOperationsRole, criteriaSignature, criteriaBlockers, validateCriteria, evidenceUrl, pastInstant, DAY, DomainError, type OfferActor } from "@workspace/deal-domain";
import { buyerRecord, queueJob } from "./operations-records";
import { audit } from "./deal-store";

function normalize(input: z.infer<typeof CreateBuyerBody>) {
  const parsed = CreateBuyerBody.parse(input);
  if (parsed.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.email)) throw new DomainError("Enter a valid buyer email.");
  validateCriteria(parsed.criteria);
  return {...parsed,name:parsed.name.trim(),source:parsed.source.trim(),destinationKind:parsed.destinationKind??"BUYER",criteria:parsed.criteria?{...parsed.criteria,
    states:parsed.criteria.states.map(s=>s.trim().toUpperCase()),cities:parsed.criteria.cities.map(s=>s.trim())}:null};
}
export async function createBuyer(input: z.infer<typeof CreateBuyerBody>, actor: OfferActor) {
  assertOperationsRole(actor,["OWNER","ANALYST"]);
  const payload = normalize(input);
  return db.transaction(async tx=>{
    const [row] = await tx.insert(buyersTable).values({payload}).returning();
    if (!row) throw new Error("Buyer insert failed.");
    await audit(tx,actor.id,"BUYER_CREATED",row.id,"Criteria recorded. Identity and funding remain unverified.");
    await queueJob(tx,"MATCH_BUYERS",null,`buyer:${row.id}:${row.version}`,actor.id);
    await queueJob(tx,"REVIEW_BUYER_POOL",null,`buyer-demand:${row.id}:${row.version}`,actor.id);
    return buyerRecord(row);
  });
}
export async function updateBuyer(id: string, input: z.infer<typeof UpdateBuyerBody>, actor: OfferActor) {
  assertOperationsRole(actor,["OWNER","ANALYST"]);
  const parsed = UpdateBuyerBody.parse(input), payload = normalize(parsed);
  return db.transaction(async tx=>{
    const [row] = await tx.select().from(buyersTable).where(eq(buyersTable.id,id)).for("update");
    if (!row) throw new DomainError("Buyer not found.",404);
    if (row.version!==parsed.version) throw new DomainError("Buyer changed. Reload before saving.",409);
    const identityChanged = ["name","phone","email"].some(key=>row.payload[key]!==payload[key as "name"|"phone"|"email"]);
    const criteriaChanged = criteriaSignature(buyerRecord(row).criteria)!==criteriaSignature(payload.criteria) || (row.payload.destinationKind??"BUYER")!==payload.destinationKind;
    const verification = identityChanged?{verifiedBy:null,verifiedAt:null,evidenceAt:null,validUntil:null,
      identityEvidenceUrl:null,fundingEvidenceUrl:null,verificationNote:null,availableFunds:null}:{};
    const currentBuying = identityChanged||criteriaChanged ? {currentBuyingStatus:"UNKNOWN",buyingVerifiedAt:null,
      buyingEvidenceAt:null,buyingEvidenceUrl:null,criteriaEvidenceUrl:null,verificationSource:null,confidence:null}: {};
    const [saved] = await tx.update(buyersTable).set({payload:{...row.payload,...payload,...verification,...currentBuying},version:row.version+1,updatedAt:new Date()}).where(eq(buyersTable.id,id)).returning();
    if (!saved) throw new Error("Buyer update failed.");
    await audit(tx,actor.id,"BUYER_UPDATED",id,identityChanged?"Identity changed; verification invalidated. Matching queued.":"Criteria/status revised; matching queued.");
    await queueJob(tx,"MATCH_BUYERS",null,`buyer:${id}:${saved.version}`,actor.id);
    await queueJob(tx,"REVIEW_BUYER_POOL",null,`buyer-demand:${id}:${saved.version}`,actor.id);
    return buyerRecord(saved);
  });
}
export async function verifyBuyer(id: string, input: z.infer<typeof VerifyBuyerBody>, actor: OfferActor, now = new Date()) {
  assertOperationsRole(actor,["OWNER"]);
  const parsed = VerifyBuyerBody.parse(input);
  evidenceUrl(parsed.identityEvidenceUrl); evidenceUrl(parsed.buyingEvidenceUrl); evidenceUrl(parsed.criteriaEvidenceUrl);
  if (parsed.fundingEvidenceUrl) evidenceUrl(parsed.fundingEvidenceUrl);
  const at = pastInstant(parsed.evidenceAt,now,"Evidence capture"), until = Date.parse(parsed.validUntil);
  const buyingAt = pastInstant(parsed.buyingEvidenceAt,now,"Current buying evidence");
  if (at+30*DAY<=now.getTime() || buyingAt+30*DAY<=now.getTime() || !Number.isFinite(until) ||
    until<=now.getTime() || until>Math.min(at,buyingAt)+30*DAY) throw new DomainError("Verification must expire within 30 days of both current evidence captures.");
  return db.transaction(async tx=>{
    const [row] = await tx.select().from(buyersTable).where(eq(buyersTable.id,id)).for("update");
    if (!row) throw new DomainError("Buyer not found.",404);
    if (row.version!==parsed.version) throw new DomainError("Buyer changed. Reload before verifying.",409);
    const buyer = buyerRecord(row,now);
    if (buyingAt<Date.parse(buyer.lastOutreachReplyAt??"1970-01-01"))
      throw new DomainError("Current buying evidence must account for the newer actual outreach reply; earlier evidence cannot clear this review.");
    if (parsed.currentBuyingStatus==="BUYING") {
      if (!buyer.email.trim()&&!buyer.phone.trim()) throw new DomainError("Record a permitted email/phone contact route before approving a current buyer/destination.");
      const missing = criteriaBlockers(buyer.criteria);
      if (missing.length) throw new DomainError(missing.join("; "));
      if (parsed.confidence<0.65) throw new DomainError("Review confidence must meet the 0.65 current-buying qualification threshold.");
      if (buyer.destinationKind==="BUYER"&&(!parsed.fundingEvidenceUrl||!parsed.availableFunds)) throw new DomainError("An acquisition buyer requires reviewed funding evidence and positive available funds.");
      if (buyer.destinationKind==="BUYER"&&!parsed.verifiedFundingTypes?.length) throw new DomainError("Record actual evidenced funding methods before approving an acquisition buyer. Do not infer them from the buy box.");
    }
    const {version:_,...evidence} = parsed;
    const history = Array.isArray(row.payload.verificationHistory)?row.payload.verificationHistory:[];
    const task = buyer.qualificationTask;
    const [saved] = await tx.update(buyersTable).set({payload:{...row.payload,...evidence,verifiedBy:actor.id,verifiedAt:now.toISOString(),
      buyingVerifiedAt:now.toISOString(),verificationHistory:[...history,{...evidence,reviewedBy:actor.id,reviewedAt:now.toISOString(),criteria:buyer.criteria,destinationKind:buyer.destinationKind}],
      ...(task?{qualificationTask:{...task,state:"COMPLETED",updatedAt:now.toISOString()}}:{})},
      version:row.version+1,updatedAt:now}).where(eq(buyersTable.id,id)).returning();
    if (!saved) throw new Error("Buyer verification failed.");
    await audit(tx,actor.id,"BUYER_VERIFIED",id,`Owner reviewed dated identity, criteria and current ${parsed.currentBuyingStatus} evidence; source ${parsed.verificationSource}; confidence ${parsed.confidence}. Review is not an automated bank/identity check. History preserved.`);
    await queueJob(tx,"MATCH_BUYERS",null,`buyer:${id}:${saved.version}`,actor.id);
    await queueJob(tx,"REVIEW_BUYER_POOL",null,`buyer-demand:${id}:${saved.version}`,actor.id);
    return buyerRecord(saved,now);
  });
}