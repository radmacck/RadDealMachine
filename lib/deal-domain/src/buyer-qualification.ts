import type { Buyer } from "./buyers";
import { DAY, verificationStatus } from "./buyers";
import { DomainError } from "./types";

export function criteriaBlockers(c: Buyer["criteria"]): string[] {
  if (!c) return ["Structured buying criteria have not been qualified."];
  const missing = ["counties","excludedCounties","excludedCities","excludedZipCodes","minPurchasePrice","minUnits",
    "maxUnits","minBaths","rehabTolerance","strategies","fundingTypes","maxConcurrentDeals"].filter(k=>(c as Record<string,unknown>)[k]===undefined);
  const reasons = missing.length ? [`Explicit criteria required: ${missing.join(", ")}.`] : [];
  if ((c.minPurchasePrice??0)>c.maxPurchasePrice || c.minSqft>c.maxSqft ||
    (c.minUnits??0)>(c.maxUnits??0) || (c.minArv!=null&&c.maxArv!=null&&c.minArv>c.maxArv) ||
    (c.maxBeds!=null&&c.minBeds>c.maxBeds) || (c.maxBaths!=null&&(c.minBaths??0)>c.maxBaths)) reasons.push("Criteria ranges must have minimum ≤ maximum.");
  return reasons;
}
export function validateCriteria(c: Buyer["criteria"]) {
  if (c) {
    const ranges = criteriaBlockers(c).filter(s=>s.startsWith("Criteria ranges"));
    if (ranges.length) throw new DomainError(ranges.join("; "));
  }
}
/** JSONB/key order and ordering of criterion sets cannot revoke unchanged evidence. */
export function criteriaSignature(c: Buyer["criteria"]): string {
  const canonical = (value:unknown):unknown => {
    if (Array.isArray(value)) return value.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
    if (typeof value==="string") return value.trim().toLowerCase();
    if (value && typeof value==="object") return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,canonical(v)]));
    return value;
  };
  return JSON.stringify(canonical(c?{...c,minArv:c.minArv??null,maxArv:c.maxArv??null,maxBeds:c.maxBeds??null,maxBaths:c.maxBaths??null,minSpread:c.minSpread??null,minCapRate:c.minCapRate??null}:null));
}
export function buyerQualification(b: Buyer, now: Date) {
  const blockers = criteriaBlockers(b.criteria);
  const status = verificationStatus(b,now);
  if (b.status!=="ACTIVE") blockers.push("Buyer/destination is paused.");
  if (!b.email.trim()&&!b.phone.trim()) blockers.push("A permitted contact route has not been recorded.");
  if (status!=="VERIFIED") blockers.push("Identity/funding review is missing or stale.");
  if (!b.identityEvidenceUrl) blockers.push("Reviewed identity evidence is missing.");
  if ((b.destinationKind??"BUYER")==="BUYER" && (!b.fundingEvidenceUrl || !(b.availableFunds && b.availableFunds>0))) blockers.push("An acquisition buyer requires current documented available funds.");
  if ((b.destinationKind??"BUYER")==="BUYER" && !b.verifiedFundingTypes?.length) blockers.push("An acquisition buyer requires documented, owner-reviewed funding methods; preferences are not verification.");
  if (b.currentBuyingStatus!=="BUYING") blockers.push("Current buying/accepting status has not been verified as active.");
  if (!b.buyingVerifiedAt || !b.buyingEvidenceUrl || !b.buyingEvidenceAt || !b.criteriaEvidenceUrl || !b.verificationSource) blockers.push("Current buying and criteria require dated evidence, source and reviewer.");
  if (b.confidence==null || b.confidence<0.65) blockers.push("Reviewer confidence is below the 0.65 qualification threshold; it is not a probability guarantee.");
  const at = Date.parse(b.buyingEvidenceAt??""), reviewed = Date.parse(b.buyingVerifiedAt??"");
  const stale = status==="STALE" || (b.buyingVerifiedAt!=null &&
    (!Number.isFinite(at)||!Number.isFinite(reviewed)||at>now.getTime()||reviewed>now.getTime()||at+30*DAY<=now.getTime()));
  if (stale) blockers.push("Current-buying evidence is stale; re-verification is required.");
  const approvalStatus: NonNullable<Buyer["approvalStatus"]> = !b.verifiedBy ? "DISCOVERED" :
    stale ? "REVERIFICATION_REQUIRED" : blockers.length ? "QUALIFICATION_REQUIRED" : "APPROVED";
  return {approvalStatus,qualificationBlockers:[...new Set(blockers)]};
}