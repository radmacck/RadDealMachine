import assert from "node:assert/strict";
import { test } from "node:test";
import type { Buyer } from "@workspace/api-client-react";
import {
  buyerDistributionSummary,
  classifyApiViewState,
  isEmptyCommandCenter,
  isCurrentApprovedBuyer,
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

