import assert from "node:assert/strict";
import test from "node:test";
import { reconcileContactPaths, type PropertyContactPath } from "./index";

const now = new Date("2026-10-08T12:00:00.000Z");
const path = (overrides: Partial<PropertyContactPath> = {}): PropertyContactPath => ({
  id: "path-a",
  channel: "PHONE",
  recipient: "Owner of record",
  routeValue: "(215) 555-0142",
  postalCode: null,
  classification: "OBSERVED",
  confidence: 0.7,
  sourceId: "directory-a",
  sourceName: "Public directory",
  sourceRecordId: "record-a",
  sourceUrl: "https://example.invalid/contact/1",
  capturedAt: now.toISOString(),
  freshUntilAt: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString(),
  freshnessStatus: "CURRENT",
  permissionStatus: "PERMITTED",
  contactPermissionEvidenceUrl: "https://example.invalid/terms",
  permissionReviewedAt: now.toISOString(),
  routeVerificationStatus: "CONFIRMED",
  routeReviewedAt: now.toISOString(),
  identityStatus: "UNVERIFIED",
  signingAuthorityStatus: "NOT_ESTABLISHED",
  ...overrides,
});

test("normalizes duplicate phone formats but retains supporting-observation count", () => {
  const result = reconcileContactPaths([
    path(),
    path({
      id: "path-b", routeValue: "215.555.0142", sourceId: "directory-b",
      sourceName: "Second directory", sourceRecordId: "record-b", confidence: 0.9,
      permissionStatus: "NOT_REVIEWED", contactPermissionEvidenceUrl: null,
      permissionReviewedAt: null, routeVerificationStatus: "UNREVIEWED", routeReviewedAt: null,
    }),
  ], now);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.supportingObservationCount, 2);
  assert.equal(result[0]?.permissionStatus, "PERMITTED");
  assert.equal(result[0]?.routeVerificationStatus, "CONFIRMED");
  assert.equal(result[0]?.identityStatus, "UNVERIFIED");
  assert.equal(result[0]?.signingAuthorityStatus, "NOT_ESTABLISHED");
});

test("a later explicit prohibition and rejection supersede an older permission/confirmation", () => {
  const earlier = path();
  const later = path({
    id: "path-later",
    sourceId: "owner-review",
    sourceName: "Owner review",
    sourceRecordId: "review-2",
    capturedAt: new Date(now.getTime() + 1_000).toISOString(),
    permissionStatus: "PROHIBITED",
    contactPermissionEvidenceUrl: null,
    permissionReviewedAt: new Date(now.getTime() + 1_000).toISOString(),
    routeVerificationStatus: "REJECTED",
    routeReviewedAt: new Date(now.getTime() + 1_000).toISOString(),
  });
  const result = reconcileContactPaths([earlier, later], new Date(now.getTime() + 2_000));
  assert.equal(result.length, 1);
  assert.equal(result[0]?.permissionStatus, "PROHIBITED");
  assert.equal(result[0]?.routeVerificationStatus, "REJECTED");
  assert.equal(result[0]?.freshnessStatus, "CURRENT");
});

test("expired route evidence stays visible but cannot be current", () => {
  const stale = path({
    freshUntilAt: new Date(now.getTime() - 1_000).toISOString(),
    permissionReviewedAt: new Date(now.getTime() - 1_000).toISOString(),
    routeReviewedAt: new Date(now.getTime() - 1_000).toISOString(),
  });
  const result = reconcileContactPaths([stale], now);
  assert.equal(result[0]?.freshnessStatus, "STALE");
  assert.equal(result[0]?.permissionStatus, "PERMITTED");
});
