import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBuyerOutreachTransition,
  buyerOutreachPermissionBlocker,
  buyerOutreachReadiness,
} from "./buyer-outreach";

test("outreach transitions are ordered and terminal receipts cannot be replayed as sends", () => {
  assertBuyerOutreachTransition("DRAFT", "APPROVED");
  assertBuyerOutreachTransition("APPROVED", "QUEUED");
  assertBuyerOutreachTransition("QUEUED", "SENT");
  assertBuyerOutreachTransition("SENT", "CONFIRMED");
  assertBuyerOutreachTransition("QUEUED", "FAILED");
  assert.throws(() => assertBuyerOutreachTransition("DRAFT", "SENT"), /Invalid buyer outreach transition/);
  assert.throws(() => assertBuyerOutreachTransition("CONFIRMED", "QUEUED"), /Invalid buyer outreach transition/);
  assert.throws(() => assertBuyerOutreachTransition("FAILED", "SENT"), /Invalid buyer outreach transition/);
});

test("contact permission must be explicit, channel-specific, evidenced, and current", () => {
  const now = new Date("2026-10-14T12:00:00.000Z");
  assert.match(buyerOutreachPermissionBlocker(undefined, "EMAIL", now)!, /not recorded/);
  assert.match(buyerOutreachPermissionBlocker({
    status: "OPTED_OUT", channels: ["EMAIL"], source: "test",
    evidenceUrl: "https://example.com/optout", capturedAt: "2026-10-14T10:00:00Z",
    validUntil: "2026-11-01T00:00:00Z",
  }, "EMAIL", now)!, /not recorded/);
  assert.match(buyerOutreachPermissionBlocker({
    status: "GRANTED", channels: ["SMS"], source: "owner-reviewed test record",
    evidenceUrl: "https://example.com/consent", capturedAt: "2026-10-14T10:00:00Z",
    validUntil: "2026-11-01T00:00:00Z",
  }, "EMAIL", now)!, /does not cover EMAIL/);
  assert.match(buyerOutreachPermissionBlocker({
    status: "GRANTED", channels: ["EMAIL"], source: "owner-reviewed test record",
    evidenceUrl: "https://example.com/consent", capturedAt: "2026-09-01T10:00:00Z",
    validUntil: "2026-10-01T00:00:00Z",
  }, "EMAIL", now)!, /stale/);
  assert.equal(buyerOutreachPermissionBlocker({
    status: "GRANTED", channels: ["EMAIL"], source: "synthetic exercise only",
    evidenceUrl: "https://example.com/consent", capturedAt: "2026-10-14T10:00:00Z",
    validUntil: "2026-11-01T00:00:00Z",
  }, "EMAIL", now), null);
});

test("unconnected buyer outreach remains explicitly not sent and permission-blocked", () => {
  const readiness = buyerOutreachReadiness({ email: "buyer@example.com" }, new Date("2026-10-14T12:00:00Z"));
  assert.equal(readiness.workflowState, "DRAFT");
  assert.equal(readiness.deliveryStatus, "NOT_SENT");
  assert.equal(readiness.providerStatus, "NOT_CONNECTED");
  assert.deepEqual(readiness.availableChannels, []);
  assert.ok(readiness.missingCapabilities.some(reason => reason.includes("permission")));
  assert.ok(readiness.missingCapabilities.some(reason => reason.includes("provider")));
});
