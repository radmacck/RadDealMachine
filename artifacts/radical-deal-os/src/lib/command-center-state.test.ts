import assert from "node:assert/strict";
import { test } from "node:test";
import type { Buyer } from "@workspace/api-client-react";
import {
  buyerDistributionSummary,
  classifyApiViewState,
  isEmptyCommandCenter,
  isCurrentApprovedBuyer,
  discoveryOrigin,
  discoveryContactState,
  filterAndSortDiscoveryPreview,
  acquisitionQueueActionHref,
  buyerIntakeHref,
  buyerIntakeState,
  sellerContactReviewHref,
} from "./command-center-state";

const emptyDesk = {
  actions: [],
  calls: [],
  acquisitionQueue: [],
  deals: [],
  operations: [],
  buyers: [],
  jobs: [],
  propertyDiscoveries: { counts: { DISCOVERED: 0, RELEVANT_CANDIDATE: 0, QUALIFIED_LEAD: 0, CALL_READY: 0 } },
};

test("command-center query state distinguishes loading, empty, authenticated data, and service error", () => {
  assert.equal(classifyApiViewState({ isLoading: true, isError: false, data: undefined, error: null }), "LOADING");
  assert.equal(classifyApiViewState({ isLoading: false, isError: false, data: emptyDesk, error: null }, isEmptyCommandCenter), "EMPTY");
  assert.equal(classifyApiViewState({ isLoading: false, isError: false, data: { ...emptyDesk, actions: [{}] }, error: null }, isEmptyCommandCenter), "READY");
  assert.equal(classifyApiViewState({ isLoading: false, isError: true, data: undefined, error: { status: 503 } }), "ERROR");
});

test("401 and 403 deny cached private command-center data instead of rendering it", () => {
  assert.equal(classifyApiViewState({ isLoading: false, isError: true, data: emptyDesk, error: { status: 401 } }), "UNAUTHENTICATED");
  assert.equal(classifyApiViewState({ isLoading: false, isError: true, data: emptyDesk, error: { status: 403 } }), "FORBIDDEN");
});

test("a failed refresh with cached data is explicitly stale, not current", () => {
  assert.equal(classifyApiViewState({ isLoading: false, isError: true, data: emptyDesk, error: new Error("network failed") }), "STALE");
});

test("discovery provenance labels only exercised source IDs as live and never relabels unknown records", () => {
  assert.equal(discoveryOrigin([{ sourceId: "phila-opa", sourceName: "OPA", lastObservedAt: "2026-10-13T00:00:00Z" }]), "LIVE_PUBLIC_SOURCE");
  assert.equal(discoveryOrigin([{ sourceId: "synthetic-fixture", sourceName: "Fixture", lastObservedAt: "2026-10-13T00:00:00Z" }]), "SYNTHETIC_EXERCISE");
  assert.equal(discoveryOrigin([{ sourceId: "unknown", sourceName: "Unknown", lastObservedAt: "2026-10-13T00:00:00Z" }]), "SOURCE_NOT_VERIFIED");
  assert.equal(discoveryOrigin([]), "NO_SOURCE_PROVENANCE");
});

test("discovery card fails closed for postal-only, stale, unpermitted, and non-CALL_READY routes", () => {
  const postal = { channel: "POSTAL", classification: "OBSERVED", permissionStatus: "PERMITTED", permissionEvidenceStatus: "SUPPORTS_ALLOWED", freshnessStatus: "CURRENT" };
  const phone = { channel: "PHONE", routeValue: "555-0100", classification: "VERIFIED", permissionStatus: "PERMITTED", permissionEvidenceStatus: "SUPPORTS_ALLOWED", freshnessStatus: "CURRENT" };
  assert.equal(discoveryContactState("QUALIFIED_LEAD", [postal]), "POSTAL_ONLY");
  assert.equal(discoveryContactState("CALL_READY", [phone]), "CALL_READY");
  assert.equal(discoveryContactState("CALL_READY", [{ ...phone, freshnessStatus: "STALE" }]), "DIRECT_ROUTE_NEEDS_REVIEW");
  assert.equal(discoveryContactState("CALL_READY", [{ ...phone, classification: "OBSERVED" }]), "DIRECT_ROUTE_NEEDS_REVIEW");
  assert.equal(discoveryContactState("CALL_READY", [{ ...phone, permissionEvidenceStatus: "UNKNOWN" }]), "DIRECT_ROUTE_NEEDS_REVIEW");
  assert.equal(discoveryContactState("CALL_READY", [{ ...phone, permissionStatus: "NOT_REVIEWED" }]), "DIRECT_ROUTE_NEEDS_REVIEW");
  assert.equal(discoveryContactState("QUALIFIED_LEAD", [phone]), "DIRECT_ROUTE_NEEDS_REVIEW");
  assert.equal(discoveryContactState("DISCOVERED_PROPERTY", []), "NO_DIRECT_ROUTE");
});

test("discovery preview search, status filter, and sort are deterministic over explicitly synthetic records", () => {
  const rows = [
    { status: "DISCOVERED_PROPERTY", score: 12, confidence: 0.5, lastObservedAt: "2026-10-01T00:00:00Z", property: { address: "Synthetic 3 Main St", recordedOwner: null }, reason: "synthetic raw", rankingReasons: [], nextAction: "research", sourceObservations: [{ sourceName: "Synthetic fixture" }] },
    { status: "QUALIFIED_LEAD", score: 80, confidence: 0.8, lastObservedAt: "2026-10-02T00:00:00Z", property: { address: "Synthetic 2 Main St", recordedOwner: "Synthetic owner" }, reason: "synthetic qualified", rankingReasons: ["strong synthetic signal"], nextAction: "review", sourceObservations: [{ sourceName: "Synthetic exercise" }] },
    { status: "QUALIFIED_LEAD", score: 80, confidence: 0.9, lastObservedAt: "2026-10-03T00:00:00Z", property: { address: "Synthetic 1 Main St", recordedOwner: null }, reason: "synthetic qualified", rankingReasons: ["strong synthetic signal"], nextAction: "review", sourceObservations: [{ sourceName: "Synthetic exercise" }] },
  ];
  assert.deepEqual(filterAndSortDiscoveryPreview(rows, "QUALIFIED_LEAD", "synthetic exercise", "RELEVANCE").map((row) => row.property.address),
    ["Synthetic 1 Main St", "Synthetic 2 Main St"]);
  assert.deepEqual(filterAndSortDiscoveryPreview(rows, "ALL", "", "FRESHEST").map((row) => row.property.address),
    ["Synthetic 1 Main St", "Synthetic 2 Main St", "Synthetic 3 Main St"]);
  assert.deepEqual(filterAndSortDiscoveryPreview(rows, "ALL", "", "ADDRESS").map((row) => row.property.address),
    ["Synthetic 1 Main St", "Synthetic 2 Main St", "Synthetic 3 Main St"]);
  assert.deepEqual(filterAndSortDiscoveryPreview(rows, "CALL_READY", "", "RELEVANCE"), []);
});

test("buyer readiness counts only current approved records and separates stale, unverified, and synthetic exclusions", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  const valid = {
    id: "buyer-current",
    name: "Current buyer",
    status: "ACTIVE",
    destinationKind: "BUYER",
    approvalStatus: "APPROVED",
    verificationStatus: "VERIFIED",
    currentBuyingStatus: "BUYING",
    validUntil: "2026-10-20T12:00:00Z",
    buyingVerifiedAt: "2026-10-08T12:00:00Z",
    qualificationBlockers: [],
    source: "owner-reviewed evidence",
  } as unknown as Buyer;
  const stale = { ...valid, id: "buyer-stale", verificationStatus: "STALE" } as Buyer;
  const unverified = { ...valid, id: "buyer-unverified", approvalStatus: "DISCOVERED", verificationStatus: "UNVERIFIED" } as Buyer;
  const synthetic = { ...valid, id: "buyer-synthetic", source: "synthetic exercise fixture" } as Buyer;
  assert.equal(isCurrentApprovedBuyer(valid, now), true);
  assert.equal(isCurrentApprovedBuyer({ ...valid, validUntil: "2026-10-01T12:00:00Z" }, now), false);
  assert.deepEqual(buyerDistributionSummary([valid, stale, unverified, synthetic], now), {
    approvedCurrentCount: 1,
    staleExcludedCount: 1,
    unverifiedExcludedCount: 1,
    syntheticExcludedCount: 1,
  });
});

test("blocked acquisition actions route to the actual contact or underwriting review, never into CALL NEXT", () => {
  const lead = { id: "synthetic-lead-1" };
  assert.equal(acquisitionQueueActionHref({ decision: "BLOCKED", blockerCode: "CONTACT_NO_DIRECT_ROUTE", lead }),
    "/deals/synthetic-lead-1?work=contact");
  assert.equal(acquisitionQueueActionHref({ decision: "BLOCKED", blockerCode: "UNDERWRITING_MISSING", lead }),
    "/deals/synthetic-lead-1?work=uw");
  assert.equal(acquisitionQueueActionHref({ decision: "CALL_NEXT", blockerCode: null, lead }),
    "/calls?lead=synthetic-lead-1");
});

test("dashboard buyer intake opens the existing unverified prospect workflow", () => {
  assert.equal(buyerIntakeHref(), "/buyers?tab=prospects&new=prospect");
  assert.deepEqual(buyerIntakeState("?tab=prospects&new=prospect"), { tab: "prospects", openProspect: true });
  assert.deepEqual(buyerIntakeState("?tab=pool"), { tab: "pool", openProspect: false });
});

test("missing seller contact routes directly to the lead's persisted contact-evidence workflow", () => {
  assert.equal(sellerContactReviewHref("lead / 123"), "/deals/lead%20%2F%20123?work=contact");
});

