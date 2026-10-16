import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBuyerOutreachTransition,
  buyerOutreachPermissionBlocker,
  buyerOutreachReadiness,
  approveExactDistributionMessage,
  assertExactDistributionApprovalCurrent,
  assertDistributionSubmissionReady,
  applyDistributionProviderEvent,
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

test("distribution approval is bound to exact buyer, channel, packet version, snapshot and text", () => {
  const current = {
    buyerId: "buyer-1", channel: "EMAIL" as const, packetVersion: 4,
    packetSnapshotHash: "a".repeat(64), exactMessage: "Approved terms; redacted link.",
  };
  const approval = approveExactDistributionMessage({
    ...current, approvedBy: "owner-1", approvedAt: "2026-10-15T12:00:00.000Z",
  });
  assertExactDistributionApprovalCurrent(approval, current);
  assert.throws(() => assertExactDistributionApprovalCurrent(approval, { ...current, exactMessage: "Changed terms." }), /stale/);
  assert.throws(() => assertExactDistributionApprovalCurrent(approval, { ...current, packetVersion: 5 }), /stale/);
  assert.throws(() => assertExactDistributionApprovalCurrent(approval, { ...current, packetSnapshotHash: "b".repeat(64) }), /stale/);
  assert.throws(() => assertExactDistributionApprovalCurrent(approval, { ...current, buyerId: "buyer-2" }), /stale/);
  assert.throws(() => assertExactDistributionApprovalCurrent(approval, { ...current, channel: "SMS" }), /stale/);
});

test("provider submission is blocked before exact approval, current channel permission, or connected provider", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const permission = {
    status: "GRANTED" as const, channels: ["EMAIL" as const, "SMS" as const],
    evidenceUrl: "https://example.com/consent", source: "synthetic consent fixture",
    capturedAt: "2026-10-15T10:00:00Z", validUntil: "2026-10-20T10:00:00Z",
  };
  assert.throws(() => assertDistributionSubmissionReady(null, permission, "EMAIL", undefined, now), /approval is required/);
  const approval = approveExactDistributionMessage({
    buyerId: "buyer-1", channel: "EMAIL", packetVersion: 1, packetSnapshotHash: "a".repeat(64),
    exactMessage: "Exact approved test text.", approvedBy: "owner-1", approvedAt: now.toISOString(),
  });
  assert.throws(() => assertDistributionSubmissionReady(approval, permission, "EMAIL", undefined, now), /remains unsent/);
  assert.throws(() => assertDistributionSubmissionReady(approval, { ...permission, status: "OPTED_OUT" }, "EMAIL", undefined, now), /not recorded/);
});

test("provider acceptance, delivery, duplicate callbacks, and conflicts preserve delivery truth", () => {
  const accepted = {
    eventId: "evt-1", providerId: "test-provider", providerMessageId: "msg-1",
    state: "PROVIDER_ACCEPTED" as const, occurredAt: "2026-10-15T12:00:00Z",
  };
  const delivered = { ...accepted, eventId: "evt-2", state: "DELIVERED" as const, occurredAt: "2026-10-15T12:01:00Z" };
  assert.throws(() => applyDistributionProviderEvent([], delivered), /requires a matching provider-accepted/);
  const events = applyDistributionProviderEvent([], accepted);
  assert.deepEqual(applyDistributionProviderEvent(events, accepted), events);
  assert.throws(() => applyDistributionProviderEvent(events, { ...accepted, state: "FAILED" }), /different content/);
  const withDelivery = applyDistributionProviderEvent(events, delivered);
  assert.deepEqual(withDelivery.map(event => event.state), ["PROVIDER_ACCEPTED", "DELIVERED"]);
  assert.equal(withDelivery.length, 2, "Provider delivery receipts cannot create portal interest or commitment events.");
});
