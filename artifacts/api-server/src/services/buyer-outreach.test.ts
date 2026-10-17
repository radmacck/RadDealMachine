import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBuyerOutreachTransition,
  buyerOutreachPermissionBlocker,
  buyerOutreachReadiness,
  buyerConsentSnapshotHash,
  registerBuyerOutreachProvider,
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

test("verified route and current permission cannot make a disconnected provider ready", t => {
  const now = new Date("2026-10-16T12:00:00.000Z");
  const unregister = registerBuyerOutreachProvider({
    id: "synthetic-disconnected-provider",
    connected: false,
    channels: ["EMAIL"],
    async send() { throw new Error("Disconnected provider must never be invoked."); },
  });
  t.after(unregister);
  const readiness = buyerOutreachReadiness({
    email: "buyer@example.invalid",
    contactRouteVerified: true,
    contactPermission: {
      status: "GRANTED", channels: ["EMAIL"], evidenceUrl: "https://example.invalid/synthetic-consent",
      source: "synthetic owner-reviewed permission", capturedAt: "2026-10-16T10:00:00Z",
      validUntil: "2026-10-20T10:00:00Z",
    },
  }, now);
  assert.equal(readiness.status, "NO_CONNECTED_PROVIDER");
  assert.equal(readiness.deliveryStatus, "NOT_SENT");
  assert.equal(readiness.workflowState, "DRAFT");
  assert.deepEqual(readiness.availableChannels, []);
  assert.ok(readiness.missingCapabilities.some(reason => reason.includes("provider")));
});

test("buyer outreach readiness distinguishes unavailable provider, missing permission, and ready exact channel", t => {
  const now = new Date("2026-10-15T12:00:00Z");
  const buyer = {
    email: "buyer@example.invalid",
    contactRouteVerified: true,
    contactPermission: {
      status: "GRANTED" as const,
      channels: ["EMAIL" as const],
      evidenceUrl: "https://example.invalid/synthetic-consent",
      source: "synthetic fixture",
      capturedAt: "2026-10-15T10:00:00Z",
      validUntil: "2026-10-20T10:00:00Z",
    },
  };
  const readyProvider = {
    id: "synthetic-outreach-provider",
    connected: true,
    channels: ["EMAIL" as const],
    async send() {
      throw new Error("Fixture sender must never be invoked by readiness checks.");
    },
  };
  const unregister = registerBuyerOutreachProvider(readyProvider);
  t.after(unregister);

  const ready = buyerOutreachReadiness(buyer, now);
  assert.equal(ready.status, "READY");
  assert.deepEqual(ready.availableChannels, ["EMAIL"]);
  assert.equal(ready.deliveryStatus, "NOT_SENT");
  assert.equal(ready.workflowState, "DRAFT");

  const permissionBlocked = buyerOutreachReadiness({
    ...buyer,
    contactPermission: { ...buyer.contactPermission, status: "UNKNOWN" },
  }, now);
  assert.equal(permissionBlocked.status, "CONTACT_PERMISSION_REQUIRED");
  assert.ok(!permissionBlocked.missingCapabilities.some(reason => /do not support/i.test(reason)));

  const unsupported = buyerOutreachReadiness({
    phone: "5550100",
    contactRouteVerified: true,
    contactPermission: { ...buyer.contactPermission, channels: ["SMS"] },
  }, now);
  assert.equal(unsupported.status, "NO_CONNECTED_PROVIDER");
  assert.ok(unsupported.missingCapabilities.some(reason => /do not support/i.test(reason)));
});

test("source and consent do not substitute for independent recipient-route verification", t => {
  const unregister = registerBuyerOutreachProvider({
    id: "synthetic-route-check-provider",
    connected: true,
    channels: ["EMAIL"],
    async send() { throw new Error("No fixture sends are permitted."); },
  });
  t.after(unregister);
  const readiness = buyerOutreachReadiness({
    email: "buyer@example.invalid",
    contactPermission: {
      status: "GRANTED", channels: ["EMAIL"], evidenceUrl: "https://example.invalid/consent",
      source: "synthetic", capturedAt: "2026-10-15T10:00:00Z", validUntil: "2026-10-20T10:00:00Z",
    },
  }, new Date("2026-10-15T12:00:00Z"));
  assert.equal(readiness.status, "CONTACT_ROUTE_UNVERIFIED");
  assert.equal(readiness.contactRouteStatus, "PRESENT_UNVERIFIED");
  assert.deepEqual(readiness.availableChannels, []);
  assert.equal(readiness.deliveryStatus, "NOT_SENT");
});

test("distribution approval is bound to exact buyer, channel, packet version, snapshot and text", () => {
  const consent = {
    status: "GRANTED" as const, channels: ["EMAIL" as const],
    evidenceUrl: "https://example.com/consent", source: "synthetic owner-reviewed consent",
    capturedAt: "2026-10-15T10:00:00.000Z", validUntil: "2026-10-20T10:00:00.000Z",
  };
  const current = {
    buyerId: "buyer-1", channel: "EMAIL" as const, packetVersion: 4,
    packetSnapshotHash: "a".repeat(64), exactMessage: "Approved terms; redacted link.",
    recipientRoute: "BUYER@example.com", redactionLevel: "REDACTED" as const,
    packageAuthorizationId: "packet-auth-1", consentSnapshotHash: buyerConsentSnapshotHash(consent),
    expiresAt: "2026-10-20T10:00:00.000Z",
  };
  const approval = approveExactDistributionMessage({
    ...current, approvedBy: "owner-1", approvedAt: "2026-10-15T12:00:00.000Z",
  });
  assertExactDistributionApprovalCurrent(approval, current);
  assert.throws(() => assertExactDistributionApprovalCurrent(approval, { ...current, exactMessage: "Changed terms." }), /stale/);
  assert.throws(() => assertExactDistributionApprovalCurrent(approval, {
    ...current, expiresAt: "2026-10-19T10:00:00.000Z",
  }), /stale/, "A changed approval/package expiry invalidates the exact-message authorization.");
  assert.throws(() => assertExactDistributionApprovalCurrent(approval, { ...current, packetVersion: 5 }), /stale/);
  assert.throws(() => assertExactDistributionApprovalCurrent(approval, { ...current, packetSnapshotHash: "b".repeat(64) }), /stale/);
  assert.throws(() => assertExactDistributionApprovalCurrent(approval, { ...current, buyerId: "buyer-2" }), /stale/);
  assert.throws(() => assertExactDistributionApprovalCurrent(approval, { ...current, channel: "SMS" }), /stale/);
  assert.throws(() => assertExactDistributionApprovalCurrent(approval, { ...current, recipientRoute: "other@example.com" }), /stale/);
  assert.throws(() => assertExactDistributionApprovalCurrent(approval, { ...current, redactionLevel: "ADDRESS_DISCLOSED" }), /stale/);
  assert.throws(() => assertExactDistributionApprovalCurrent(approval, { ...current, packageAuthorizationId: "new-packet-auth" }), /stale/);
  assert.throws(() => assertExactDistributionApprovalCurrent(approval, {
    ...current, consentSnapshotHash: buyerConsentSnapshotHash({ ...consent, status: "OPTED_OUT" }),
  }), /stale/);
});

test("provider submission is blocked before exact approval, current channel permission, or connected provider", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const permission = {
    status: "GRANTED" as const, channels: ["EMAIL" as const, "SMS" as const],
    evidenceUrl: "https://example.com/consent", source: "synthetic consent fixture",
    capturedAt: "2026-10-15T10:00:00Z", validUntil: "2026-10-20T10:00:00Z",
  };
  const current = {
    buyerId: "buyer-1", channel: "EMAIL" as const, packetVersion: 1,
    packetSnapshotHash: "a".repeat(64), exactMessage: "Exact approved test text.",
    recipientRoute: "buyer@example.com", redactionLevel: "REDACTED" as const,
    packageAuthorizationId: "packet-auth-1", consentSnapshotHash: buyerConsentSnapshotHash(permission),
    expiresAt: "2026-10-20T10:00:00.000Z",
  };
  assert.throws(() => assertDistributionSubmissionReady(null, current, permission, "EMAIL", undefined, now, true), /approval is required/);
  const approval = approveExactDistributionMessage({
    ...current, approvedBy: "owner-1", approvedAt: now.toISOString(),
  });
  assert.throws(() => assertDistributionSubmissionReady(approval, { ...current, exactMessage: "Changed after approval." },
    permission, "EMAIL", undefined, now, true), /stale/);
  assert.throws(() => assertDistributionSubmissionReady(approval, current, permission, "EMAIL", undefined, now), /route is not independently verified/);
  assert.throws(() => assertDistributionSubmissionReady(approval, current, { ...permission, status: "OPTED_OUT" }, "EMAIL", undefined, now, true), /consent changed/);
  assert.throws(() => assertDistributionSubmissionReady(approval, {
    ...current, redactionLevel: "ADDRESS_DISCLOSED",
  }, permission, "EMAIL", {
    id: "fixture", connected: true, channels: ["EMAIL"], async send() { throw new Error("Not invoked."); },
  }, now, false), /stale/);
  const addressApproval = approveExactDistributionMessage({
    ...current, redactionLevel: "ADDRESS_DISCLOSED", approvedBy: "owner-1", approvedAt: now.toISOString(),
  });
  assert.throws(() => assertDistributionSubmissionReady(addressApproval, {
    ...current, redactionLevel: "ADDRESS_DISCLOSED",
  }, permission, "EMAIL", {
    id: "fixture", connected: true, channels: ["EMAIL"], async send() { throw new Error("Not invoked."); },
  }, now, true, false), /recipient identity/,
  "Verifying control of an email route does not by itself verify recipient identity for address disclosure.");
  let sends = 0;
  const provider = {
    id: "fixture", connected: true, channels: ["EMAIL" as const], async send() { sends++; throw new Error("Not invoked."); },
  };
  assert.doesNotThrow(() => assertDistributionSubmissionReady(approval, current, permission, "EMAIL", provider, now, true));
  assert.equal(sends, 0, "The readiness guard validates eligibility only and never submits a message.");
  assert.throws(() => assertDistributionSubmissionReady(
    approval, current, permission, "EMAIL", provider, new Date("2026-10-21T12:00:00Z"), true,
  ), /expired/i, "An otherwise-current exact approval cannot be submitted after its bound expiry.");
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
  assert.throws(() => applyDistributionProviderEvent(events, {
    ...delivered, eventId: "foreign-provider-delivery", providerId: "other-provider",
  }), /already bound to a different provider/);
  const withDelivery = applyDistributionProviderEvent(events, delivered);
  assert.deepEqual(withDelivery.map(event => event.state), ["PROVIDER_ACCEPTED", "DELIVERED"]);
  assert.equal(withDelivery.length, 2, "Provider delivery receipts cannot create portal interest or commitment events.");
  assert.throws(() => applyDistributionProviderEvent(withDelivery, {
    ...accepted, eventId: "evt-late-failure", state: "FAILED",
  }), /already terminal/);
  assert.throws(() => applyDistributionProviderEvent(events, {
    ...accepted, eventId: "evt-duplicate-acceptance",
  }), /already has an acceptance event/);
});

test("failed provider attempt can be retried only as a distinct provider message; duplicate callbacks remain idempotent", () => {
  const failed = {
    eventId: "evt-failed", providerId: "test-provider", providerMessageId: "msg-attempt-1",
    state: "FAILED" as const, occurredAt: "2026-10-15T12:00:00Z",
  };
  const acceptedRetry = {
    eventId: "evt-retry-accepted", providerId: "test-provider", providerMessageId: "msg-attempt-2",
    state: "PROVIDER_ACCEPTED" as const, occurredAt: "2026-10-15T12:05:00Z",
  };
  const deliveredRetry = {
    ...acceptedRetry, eventId: "evt-retry-delivered", state: "DELIVERED" as const,
    occurredAt: "2026-10-15T12:06:00Z",
  };
  const history = applyDistributionProviderEvent([], failed);
  const withRetry = applyDistributionProviderEvent(history, acceptedRetry);
  const withReceipt = applyDistributionProviderEvent(withRetry, deliveredRetry);
  assert.deepEqual(withReceipt.map(event => event.state), ["FAILED", "PROVIDER_ACCEPTED", "DELIVERED"]);
  assert.deepEqual(applyDistributionProviderEvent(withReceipt, deliveredRetry), withReceipt);
  assert.throws(() => applyDistributionProviderEvent(withReceipt, {
    ...deliveredRetry, eventId: "evt-retry-delivered", state: "FAILED",
  }), /different content/);
});
