import { eq } from "drizzle-orm";
import type { z } from "zod";
import { db, buyersTable } from "@workspace/db";
import { CreateBuyerBody, UpdateBuyerBody, VerifyBuyerBody } from "@workspace/api-zod";
import { assertOperationsRole, evidenceUrl, pastInstant, DAY, DomainError, type OfferActor } from "@workspace/deal-domain";
import { buyerRecord, queueJob } from "./operations-records";
import { audit } from "./deal-store";

function normalize(input: z.infer<typeof CreateBuyerBody>) {
  const parsed = CreateBuyerBody.parse(input);
  if (!parsed.email.trim()&&!parsed.phone.trim()) throw new DomainError("A buyer needs an email address or phone number.");
  if (parsed.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.email)) throw new DomainError("Enter a valid buyer email.");
  if (parsed.criteria.minSqft>parsed.criteria.maxSqft) throw new DomainError("Minimum square footage cannot exceed maximum.");
  return {...parsed,name:parsed.name.trim(),source:parsed.source.trim(),criteria:{...parsed.criteria,
    states:parsed.criteria.states.map(s=>s.trim().toUpperCase()),cities:parsed.criteria.cities.map(s=>s.trim())}};
}
export async function createBuyer(input: z.infer<typeof CreateBuyerBody>, actor: OfferActor) {
  assertOperationsRole(actor,["OWNER","ANALYST"]);
  const payload = normalize(input);
  return db.transaction(async tx=>{
    const [row] = await tx.insert(buyersTable).values({payload}).returning();
    if (!row) throw new Error("Buyer insert failed.");
    await audit(tx,actor.id,"BUYER_CREATED",row.id,"Criteria recorded. Identity and funding remain unverified.");
    await queueJob(tx,"MATCH_BUYERS",null,`buyer:${row.id}:${row.version}`,actor.id);
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
    const verification = identityChanged?{verifiedBy:null,verifiedAt:null,evidenceAt:null,validUntil:null,
      identityEvidenceUrl:null,fundingEvidenceUrl:null,verificationNote:null,availableFunds:null}:{};
    const [saved] = await tx.update(buyersTable).set({payload:{...row.payload,...payload,...verification},version:row.version+1,updatedAt:new Date()}).where(eq(buyersTable.id,id)).returning();
    if (!saved) throw new Error("Buyer update failed.");
    await audit(tx,actor.id,"BUYER_UPDATED",id,identityChanged?"Identity changed; verification invalidated. Matching queued.":"Criteria/status revised; matching queued.");
    await queueJob(tx,"MATCH_BUYERS",null,`buyer:${id}:${saved.version}`,actor.id);
    return buyerRecord(saved);
  });
}
export async function verifyBuyer(id: string, input: z.infer<typeof VerifyBuyerBody>, actor: OfferActor, now = new Date()) {
  assertOperationsRole(actor,["OWNER"]);
  const parsed = VerifyBuyerBody.parse(input);
  evidenceUrl(parsed.identityEvidenceUrl); evidenceUrl(parsed.fundingEvidenceUrl);
  const at = pastInstant(parsed.evidenceAt,now,"Evidence capture"), until = Date.parse(parsed.validUntil);
  if (at+30*DAY<=now.getTime() || !Number.isFinite(until) || until<=now.getTime() || until>at+30*DAY) throw new DomainError("Verification must expire within 30 days of current evidence.");
  return db.transaction(async tx=>{
    const [row] = await tx.select().from(buyersTable).where(eq(buyersTable.id,id)).for("update");
    if (!row) throw new DomainError("Buyer not found.",404);
    if (row.version!==parsed.version) throw new DomainError("Buyer changed. Reload before verifying.",409);
    const {version:_,...evidence} = parsed;
    const [saved] = await tx.update(buyersTable).set({payload:{...row.payload,...evidence,verifiedBy:actor.id,verifiedAt:now.toISOString()},
      version:row.version+1,updatedAt:now}).where(eq(buyersTable.id,id)).returning();
    if (!saved) throw new Error("Buyer verification failed.");
    await audit(tx,actor.id,"BUYER_VERIFIED",id,"Owner attested review of dated identity/funding evidence. This is not an automated bank or identity-provider check.");
    await queueJob(tx,"MATCH_BUYERS",null,`buyer:${id}:${saved.version}`,actor.id);
    return buyerRecord(saved,now);
  });
}