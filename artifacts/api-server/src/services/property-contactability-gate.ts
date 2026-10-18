import { reconcileContactPaths, type PropertyContactPath } from "@workspace/property-sources";

export type SellerContactabilityEvidence = {
  status: "OPEN" | "EVIDENCE_RECORDED" | "NO_DIRECT_ROUTE_FOUND" | "NEEDS_REVIEW" | "BLOCKED";
  sourceName: string;
  sourceType: "PUBLIC_RECORD" | "PUBLIC_PAGE" | "OWNER_SUPPLIED" | "SELLER_PROVIDED" | "MANUAL_RESEARCH" | "INFERRED" | "OTHER";
  sourceUrl: string | null;
  observedAt: string;
  confidence: number;
  identityMatch: "UNKNOWN" | "RECORDED_OWNER_ONLY" | "SELLER_SELF_IDENTIFIED" | "CONFLICTING" | "NOT_MATCHED";
  permissionBasis: "UNKNOWN" | "PUBLIC_SOURCE_TERMS" | "CONSENT" | "OTHER_DOCUMENTED" | "PROHIBITED";
  evidenceReference: string | null;
  synthetic: boolean;
  candidateRoutes?: PropertyContactPath[];
};

const SELLER_CONTACT_STAGES = new Set([
  "STRONG", "NEGOTIABLE", "CALL_READY", "CONTACTED", "CONVERSATION", "OFFER_READY", "OFFER_SENT",
  "NEGOTIATING", "CONTRACT_PENDING",
]);

export function requiresCurrentSellerContactabilityEvidence(stage: string): boolean {
  return SELLER_CONTACT_STAGES.has(stage);
}

export function evaluatePropertyContactabilityGate(caseRecord: SellerContactabilityEvidence, now: Date): string[] {
  const routes = reconcileContactPaths(caseRecord.candidateRoutes ?? [], now);
  const phones = routes.filter(path => path.channel === "PHONE");
  const gaps: string[] = [];
  if (!["PUBLIC_RECORD", "PUBLIC_PAGE", "OWNER_SUPPLIED", "SELLER_PROVIDED", "MANUAL_RESEARCH", "INFERRED", "OTHER"].includes(caseRecord.sourceType))
    gaps.push("Select a recognized evidence source type.");
  if (!["UNKNOWN", "PUBLIC_SOURCE_TERMS", "CONSENT", "OTHER_DOCUMENTED", "PROHIBITED"].includes(caseRecord.permissionBasis))
    gaps.push("Document a recognized permission basis before using the route.");
  const requiresPublicUrl = caseRecord.sourceType === "PUBLIC_RECORD" || caseRecord.sourceType === "PUBLIC_PAGE";
  if (!caseRecord.sourceName.trim() || !caseRecord.evidenceReference?.trim() || (requiresPublicUrl && !caseRecord.sourceUrl))
    gaps.push("Add the exact ownership/identity source record and evidence reference; public records/pages also require their source URL.");
  const observedAt = Date.parse(caseRecord.observedAt);
  if (!Number.isFinite(observedAt) || observedAt > now.getTime() || now.getTime() - observedAt > 180 * 24 * 60 * 60_000)
    gaps.push("Refresh ownership/identity evidence; its observation is missing, future-dated, or older than 180 days.");
  if (caseRecord.confidence < 0.85)
    gaps.push("Obtain stronger source-backed identity evidence; confidence must be at least 0.85.");
  if (caseRecord.sourceType === "INFERRED")
    gaps.push("Inferred identity is a hypothesis, not ownership or seller evidence; replace it with a cited record or seller-provided evidence.");
  if (caseRecord.permissionBasis === "UNKNOWN")
    gaps.push("Document the source terms or other lawful basis for this research before relying on it.");
  if (caseRecord.permissionBasis === "PROHIBITED")
    gaps.push("This source/use is prohibited; stop using its contact information and research through a permitted source.");
  if (caseRecord.identityMatch === "RECORDED_OWNER_ONLY")
    gaps.push("Recorded ownership does not establish that the owner is the seller or has signing authority.");
  if (caseRecord.identityMatch === "CONFLICTING")
    gaps.push("Resolve conflicting ownership or seller identity claims while retaining each source record.");
  if (caseRecord.identityMatch === "UNKNOWN" || caseRecord.identityMatch === "NOT_MATCHED")
    gaps.push("Match the seller to the property with current, source-backed identity evidence; inferred guesses do not qualify.");
  if (caseRecord.synthetic)
    gaps.push("Replace synthetic or fixture evidence with real, permitted, source-backed evidence.");
  if (!phones.length) gaps.push("No direct phone route candidate is recorded; postal addresses do not enable CALL NEXT.");
  if (phones.some(path => path.freshnessStatus !== "CURRENT" || Date.parse(path.freshUntilAt) <= now.getTime()))
    gaps.push("A phone route is stale; refresh it from a permitted source.");
  if (phones.some(path => path.identityConflictStatus === "MULTIPLE_RECIPIENTS" || path.identityConflictStatus === "MULTIPLE_ROLES") ||
    phones.filter(path => path.permissionStatus === "PERMITTED" && path.routeVerificationStatus === "CONFIRMED").length > 1)
    gaps.push("Phone routes or recipient identities conflict; resolve the conflict before use.");
  if (phones.some(path => path.permissionStatus !== "PERMITTED" || path.permissionEvidenceStatus !== "SUPPORTS_ALLOWED"))
    gaps.push("Document owner-reviewed permission evidence and permitted scope for the route.");
  if (phones.some(path => path.routeVerificationStatus !== "CONFIRMED" || path.classification !== "VERIFIED"))
    gaps.push("Owner must confirm the route with a written verification note.");
  if (caseRecord.identityMatch !== "SELLER_SELF_IDENTIFIED" ||
    phones.some(path => path.recipientRole !== "SELLER_SELF_IDENTIFIED" || path.recipientIdentityEvidenceStatus !== "SUPPORTING_RECORD"))
    gaps.push("Match the route recipient to the seller with supporting identity evidence.");
  if (phones.some(path => path.confidence < 0.85))
    gaps.push("Route confidence must be at least 0.85 for owner confirmation.");
  return [...new Set(gaps)];
}

export function hasLegitimateSellerCallRoute(
  caseRecord: SellerContactabilityEvidence | null | undefined,
  now: Date,
): boolean {
  return !!caseRecord && caseRecord.status === "EVIDENCE_RECORDED" &&
    evaluatePropertyContactabilityGate(caseRecord, now).length === 0;
}
