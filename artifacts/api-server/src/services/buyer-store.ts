import { eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { db, buyersTable } from "@workspace/db";
import { CreateBuyerBody, RecordBuyerContactPermissionBody, UpdateBuyerBody, VerifyBuyerBody } from "@workspace/api-zod";
import { assertOperationsRole, criteriaSignature, criteriaBlockers, validateCriteria, evidenceUrl, pastInstant, DAY, DomainError, normalizeBuyerPhone, isSyntheticBuyerSource, type OfferActor } from "@workspace/deal-domain";
import { buyerRecord, queueJob } from "./operations-records";
import { audit } from "./deal-store";

function normalize(input: z.infer<typeof CreateBuyerBody>) {
  const parsed = CreateBuyerBody.parse(input);
  if (!parsed.name.trim() || !parsed.source.trim()) {
    throw new DomainError("Buyer name and source are required.");
  }
  if (parsed.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.email)) throw new DomainError("Enter a valid buyer email.");
  if (parsed.contactSourceUrl && !/^https:\/\//i.test(parsed.contactSourceUrl)) throw new DomainError("Buyer contact evidence URL must use HTTPS.");
  if (parsed.contactObservedAt && (!Number.isFinite(Date.parse(parsed.contactObservedAt)) || Date.parse(parsed.contactObservedAt) > Date.now())) {
    throw new DomainError("Buyer contact observation time must be valid and cannot be in the future.");
  }
  validateCriteria(parsed.criteria);
  return {...parsed,name:parsed.name.trim(),source:parsed.source.trim(),destinationKind:parsed.destinationKind??"BUYER",criteria:parsed.criteria?{...parsed.criteria,
    states:parsed.criteria.states.map(s=>s.trim().toUpperCase()),cities:parsed.criteria.cities.map(s=>s.trim())}:null};
}
function buyerProfileFingerprint(input: {
  name?: unknown; email?: unknown; phone?: unknown; source?: unknown; status?: unknown;
  destinationKind?: unknown; criteria?: unknown; qualifiedDealFee?: unknown; feeTermsSource?: unknown;
  contactSourceUrl?: unknown; contactObservedAt?: unknown; contactConfidence?: unknown;
}) {
  return JSON.stringify({
    name: String(input.name ?? "").trim().toLowerCase().replace(/\s+/g, " "),
    email: String(input.email ?? "").trim().toLowerCase(),
    phone: normalizeBuyerPhone(String(input.phone ?? "")),
    source: String(input.source ?? "").trim().toLowerCase().replace(/\s+/g, " "),
    status: input.status ?? "ACTIVE",
    destinationKind: input.destinationKind ?? "BUYER",
    criteria: input.criteria ?? null,
    qualifiedDealFee: input.qualifiedDealFee ?? null,
    feeTermsSource: String(input.feeTermsSource ?? "").trim().toLowerCase(),
    contactSourceUrl: input.contactSourceUrl ?? null,
    contactObservedAt: input.contactObservedAt ?? null,
    contactConfidence: input.contactConfidence ?? null,
  });
}
export async function createBuyer(input: z.infer<typeof CreateBuyerBody>, actor: OfferActor) {
  assertOperationsRole(actor,["OWNER"]);
  const payload = normalize(input);
  return db.transaction(async tx=>{
    const routeKeys = [
      payload.email ? `email:${payload.email.trim().toLowerCase()}` : "",
      payload.phone ? `phone:${normalizeBuyerPhone(payload.phone)}` : "",
      `profile:${buyerProfileFingerprint(payload)}`,
    ].filter(Boolean).sort();
    for (const key of routeKeys) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(current_schema() || ${`buyer-route:${key}`},0))`);
    }
    {
      const existing = await tx.select().from(buyersTable);
      const profileConflict = existing.find(row => buyerProfileFingerprint(row.payload) === buyerProfileFingerprint(payload));
      if (profileConflict) {
        throw new DomainError(`An identical buyer profile already exists (record ${profileConflict.id}). Review the existing record; records are not automatically merged.`,409);
      }
       const digits = normalizeBuyerPhone(payload.phone);
      const email = payload.email.trim().toLowerCase();
      const name = payload.name.trim().toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
      const conflict = existing.find(row => {
        const prior = buyerRecord(row);
         const priorDigits = normalizeBuyerPhone(prior.phone ?? "");
        return (!!email && (prior.email ?? "").trim().toLowerCase() === email) ||
          (!!digits && priorDigits === digits && digits.length >= 7);
      });
      if (conflict) {
        const prior = buyerRecord(conflict);
        const priorName = prior.name.trim().toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
        const kind = priorName === name ? "A buyer with this contact route already exists" : "This contact route is attached to a different buyer identity";
        throw new DomainError(`${kind} (record ${conflict.id}). Review the existing record; records are not automatically merged.`,409);
      }
    }
     const [row] = await tx.insert(buyersTable).values({payload:{...payload,syntheticFixture:isSyntheticBuyerSource(payload.source)}}).returning();
    if (!row) throw new Error("Buyer insert failed.");
    await audit(tx,actor.id,"BUYER_CREATED",row.id,"Criteria recorded. Identity and funding remain unverified.");
    await queueJob(tx,"MATCH_BUYERS",null,`buyer:${row.id}:${row.version}`,actor.id);
    await queueJob(tx,"REVIEW_BUYER_POOL",null,`buyer-demand:${row.id}:${row.version}`,actor.id);
    await queueJob(tx,"EVALUATE_DECISION",null,`decision:buyer:${row.id}:${row.version}`,actor.id,{trigger:"BUYER_PROFILE_CREATED",buyerId:row.id});
    return buyerRecord(row);
  });
}
export async function updateBuyer(id: string, input: z.infer<typeof UpdateBuyerBody>, actor: OfferActor) {
  assertOperationsRole(actor,["OWNER"]);
  const parsed = UpdateBuyerBody.parse(input), payload = normalize(parsed);
  return db.transaction(async tx=>{
    const [row] = await tx.select().from(buyersTable).where(eq(buyersTable.id,id)).for("update");
    if (!row) throw new DomainError("Buyer not found.",404);
    if (row.version!==parsed.version) throw new DomainError("Buyer changed. Reload before saving.",409);
    const routeKeys=[
      payload.email?`email:${payload.email.trim().toLowerCase()}`:"",
      payload.phone?`phone:${normalizeBuyerPhone(payload.phone)}`:"",
      `profile:${buyerProfileFingerprint(payload)}`,
    ].filter(Boolean).sort();
    for(const key of routeKeys) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(current_schema() || ${`buyer-route:${key}`},0))`);
    const others=await tx.select().from(buyersTable);
    const profileConflict=others.find(other=>other.id!==id&&buyerProfileFingerprint(other.payload)===buyerProfileFingerprint(payload));
    if(profileConflict) throw new DomainError(`An identical buyer profile already exists (${profileConflict.id}). Review identity evidence; records are not automatically merged.`,409);
    const email=payload.email.trim().toLowerCase(),digits=normalizeBuyerPhone(payload.phone);
    const conflict=others.find(other=>{
      if(other.id===id)return false;
      const prior=buyerRecord(other), priorDigits=normalizeBuyerPhone(prior.phone??"");
      return (!!email&&(prior.email??"").trim().toLowerCase()===email)||
        (!!digits&&digits.length>=7&&priorDigits===digits);
    });
    if(conflict) throw new DomainError(`This contact route is attached to another buyer record (${conflict.id}). Review identity evidence; records are not automatically merged.`,409);
    const identityChanged = ["name","phone","email"].some(key=>row.payload[key]!==payload[key as "name"|"phone"|"email"]);
    const criteriaChanged = criteriaSignature(buyerRecord(row).criteria)!==criteriaSignature(payload.criteria) || (row.payload.destinationKind??"BUYER")!==payload.destinationKind;
    const verification = identityChanged?{verifiedBy:null,verifiedAt:null,evidenceAt:null,validUntil:null,
      identityEvidenceUrl:null,fundingEvidenceUrl:null,verificationNote:null,availableFunds:null}:{};
    const currentBuying = identityChanged||criteriaChanged ? {currentBuyingStatus:"UNKNOWN",buyingVerifiedAt:null,
      buyingEvidenceAt:null,buyingEvidenceUrl:null,criteriaEvidenceUrl:null,verificationSource:null,confidence:null}: {};
    const savedPayload={...row.payload,...payload,...verification,...currentBuying};
    if(identityChanged&&(!payload.contactSourceUrl||!payload.contactObservedAt)){
      delete savedPayload.contactSourceUrl;delete savedPayload.contactObservedAt;delete savedPayload.contactConfidence;
    }
    const updatedAt = new Date(Math.max(Date.now(),row.updatedAt.getTime()+1));
    const [saved] = await tx.update(buyersTable).set({payload:savedPayload,version:row.version+1,updatedAt}).where(eq(buyersTable.id,id)).returning();
    if (!saved) throw new Error("Buyer update failed.");
    await audit(tx,actor.id,"BUYER_UPDATED",id,identityChanged?"Identity changed; verification invalidated. Matching queued.":"Criteria/status revised; matching queued.");
    await queueJob(tx,"MATCH_BUYERS",null,`buyer:${id}:${saved.version}`,actor.id);
    await queueJob(tx,"REVIEW_BUYER_POOL",null,`buyer-demand:${id}:${saved.version}`,actor.id);
    await queueJob(tx,"EVALUATE_DECISION",null,`decision:buyer:${id}:${saved.version}`,actor.id,{trigger:"BUYER_PROFILE_UPDATED",buyerId:id});
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
    await queueJob(tx,"EVALUATE_DECISION",null,`decision:buyer:${id}:${saved.version}`,actor.id,{trigger:"BUYER_VERIFICATION_REVIEWED",buyerId:id});
    return buyerRecord(saved,now);
  });
}

export async function recordBuyerContactPermission(
  id: string,
  input: z.infer<typeof RecordBuyerContactPermissionBody>,
  actor: OfferActor,
  now = new Date(),
) {
  assertOperationsRole(actor, ["OWNER"]);
  const parsed = RecordBuyerContactPermissionBody.parse(input);
  evidenceUrl(parsed.evidenceUrl);
  const capturedAt = pastInstant(parsed.capturedAt, now, "Contact permission evidence");
  const validUntil = parsed.validUntil ? Date.parse(parsed.validUntil) : null;
  if (parsed.status === "GRANTED" && (
    !parsed.channels.length || capturedAt + 30 * DAY <= now.getTime() ||
    !Number.isFinite(validUntil) || validUntil! <= now.getTime() ||
    validUntil! > capturedAt + 30 * DAY
  )) throw new DomainError("Granted contact permission requires at least one channel and current evidence expiring within 30 days.");
  if (!parsed.source.trim()) throw new DomainError("Record where the contact permission or opt-out evidence came from.");
  return db.transaction(async tx => {
    const [row] = await tx.select().from(buyersTable).where(eq(buyersTable.id, id)).for("update");
    if (!row) throw new DomainError("Buyer not found.", 404);
    if (row.version !== parsed.version) throw new DomainError("Buyer changed. Reload before recording permission.", 409);
    const permission = { ...parsed, reviewedBy: actor.id, reviewedAt: now.toISOString() };
    const history = Array.isArray(row.payload.contactPermissionHistory) ? row.payload.contactPermissionHistory : [];
    const [saved] = await tx.update(buyersTable).set({
      payload: { ...row.payload, contactPermission: permission, contactPermissionHistory: [...history, permission] },
      version: row.version + 1, updatedAt: now,
    }).where(eq(buyersTable.id, id)).returning();
    if (!saved) throw new Error("Buyer contact permission was not saved.");
    await audit(tx, actor.id, "BUYER_CONTACT_PERMISSION_RECORDED", id,
      `${parsed.status} permission evidence saved for ${parsed.channels.join(", ") || "all channels suppressed"}.`);
    return permission;
  });
}