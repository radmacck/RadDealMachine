import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePropertyContactabilityGate, hasLegitimateSellerCallRoute } from "./property-contactability-gate";

const now = new Date("2026-10-16T12:00:00Z");
const route = (overrides: Record<string, unknown> = {}) => ({
  id: "route-1", channel: "PHONE", recipient: "Seller A", routeValue: "2155550100",
  postalCode: null, classification: "VERIFIED", confidence: 0.95, sourceId: "manual",
  sourceName: "Owner-reviewed call", sourceRecordId: "record-1", sourceUrl: "https://example.invalid/evidence",
  capturedAt: "2026-10-15T12:00:00Z", freshUntilAt: "2026-11-14T12:00:00Z",
  freshnessStatus: "CURRENT", permissionStatus: "PERMITTED", permissionEvidenceStatus: "SUPPORTS_ALLOWED",
  legalBasis: "CONSENT", legalBasisScope: "Seller call", legalBasisEvidenceUrl: "https://example.invalid/consent",
  recipientRole: "SELLER_SELF_IDENTIFIED", recipientIdentityEvidenceStatus: "SUPPORTING_RECORD",
  recipientIdentityEvidenceRef: "call-note-1", routeVerificationStatus: "CONFIRMED",
  identityConflictStatus: "NONE", epistemicStatus: "OBSERVED",
  ...overrides,
});
const evidence = (overrides: Record<string, unknown> = {}) => ({
  status: "EVIDENCE_RECORDED", version: 1, confidence: 0.95, sourceName: "Philadelphia tax record",
  sourceType: "PUBLIC_RECORD", sourceUrl: "https://example.invalid/parcel",
  observedAt: "2026-10-15T12:00:00Z", identityMatch: "SELLER_SELF_IDENTIFIED",
  permissionBasis: "PUBLIC_SOURCE_TERMS", evidenceReference: "OPA parcel 123",
  note: "Seller identity cross-checked against current parcel record.", missingRequirements: [],
  nextAction: "", auditHistory: [], synthetic: false, candidateRoutes: [route()],
  ...overrides,
}) as Parameters<typeof evaluatePropertyContactabilityGate>[0];

test("ownership owner-of-record alone, stale evidence, and weak inferred identity stay blocked", () => {
  const ownerOnly = evaluatePropertyContactabilityGate(evidence({ identityMatch: "RECORDED_OWNER_ONLY" }), now);
  assert.ok(ownerOnly.some(item => /does not establish.*seller/i.test(item)));
  const stale = evaluatePropertyContactabilityGate(evidence({ observedAt: "2025-01-01T00:00:00Z" }), now);
  assert.ok(stale.some(item => /older than 180 days/i.test(item)));
  const weak = evaluatePropertyContactabilityGate(evidence({ identityMatch: "UNKNOWN", confidence: 0.4 }), now);
  assert.ok(weak.some(item => /inferred guesses do not qualify/i.test(item)));
  assert.ok(weak.some(item => /confidence must be at least 0.85/i.test(item)));
  const inferred = evaluatePropertyContactabilityGate(evidence({ sourceType: "INFERRED" }), now);
  assert.ok(inferred.some(item => /hypothesis, not ownership or seller evidence/i.test(item)));
});

test("prohibited permission, conflicting owner identity, and duplicate recipient claims remain blocked", () => {
  const prohibited = evaluatePropertyContactabilityGate(evidence({ permissionBasis: "PROHIBITED" }), now);
  assert.ok(prohibited.some(item => /source\/use is prohibited/i.test(item)));
  const conflict = evaluatePropertyContactabilityGate(evidence({ identityMatch: "CONFLICTING" }), now);
  assert.ok(conflict.some(item => /resolve conflicting ownership/i.test(item)));
  const duplicates = evaluatePropertyContactabilityGate(evidence({
    candidateRoutes: [route(), route({ id: "route-2", recipient: "Different Person", sourceRecordId: "record-2" })],
  }), now);
  assert.ok(duplicates.some(item => /conflict/i.test(item)));
});

test("route permission and freshness are separate gates from owner/identity evidence", () => {
  const noPermission = evaluatePropertyContactabilityGate(evidence({
    candidateRoutes: [route({ permissionStatus: "NOT_REVIEWED", permissionEvidenceStatus: "UNKNOWN" })],
  }), now);
  assert.ok(noPermission.some(item => /permission evidence/i.test(item)));
  const staleRoute = evaluatePropertyContactabilityGate(evidence({
    candidateRoutes: [route({ freshnessStatus: "STALE", freshUntilAt: "2026-10-01T00:00:00Z" })],
  }), now);
  assert.ok(staleRoute.some(item => /phone route is stale/i.test(item)));
  const missingRoute = evaluatePropertyContactabilityGate(evidence({ candidateRoutes: [] }), now);
  assert.ok(missingRoute.some(item => /No direct phone route/i.test(item)));
});

test("a source-only discovery with no reviewed contact case cannot qualify for CALL NEXT", () => {
  const gaps = evaluatePropertyContactabilityGate(evidence({
    sourceName: "Philadelphia public property discovery",
    sourceType: "PUBLIC_RECORD",
    identityMatch: "UNKNOWN",
    permissionBasis: "UNKNOWN",
    evidenceReference: null,
    candidateRoutes: [],
  }), now);

  assert.ok(gaps.some(item => /Match the seller to the property with current, source-backed identity evidence/i.test(item)));
  assert.ok(gaps.some(item => /Document the source terms or other lawful basis/i.test(item)));
  assert.ok(gaps.some(item => /No direct phone route candidate/i.test(item)));
});

test("seller-provided evidence uses its cited conversation record without requiring a public URL", () => {
  const gaps = evaluatePropertyContactabilityGate(evidence({
    sourceType: "SELLER_PROVIDED",
    sourceUrl: null,
    evidenceReference: "seller-call-note-2026-10-15",
  }), now);
  assert.ok(!gaps.some(item => /public records\/pages also require their source URL/i.test(item)));
});

test("only a fresh, permission-backed, identity-matched, conflict-free route is legitimate for seller calling", () => {
  assert.equal(hasLegitimateSellerCallRoute(evidence(), now), true);
  assert.equal(hasLegitimateSellerCallRoute(evidence({ identityMatch: "RECORDED_OWNER_ONLY" }), now), false);
  assert.equal(hasLegitimateSellerCallRoute(evidence({ observedAt: "2025-01-01T00:00:00Z" }), now), false);
  assert.equal(hasLegitimateSellerCallRoute(evidence({ permissionBasis: "UNKNOWN" }), now), false);
  assert.equal(hasLegitimateSellerCallRoute(evidence({ identityMatch: "CONFLICTING" }), now), false);
  assert.equal(hasLegitimateSellerCallRoute(evidence({ candidateRoutes: [] }), now), false);
});
