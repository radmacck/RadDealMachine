import { createHash } from "node:crypto";

export type BuyerOutreachChannel = "EMAIL" | "SMS" | "VOICE";
export type BuyerOutreachState = "DRAFT" | "APPROVED" | "QUEUED" | "SENT" | "CONFIRMED" | "FAILED";
export type BuyerContactPermission = {
  status: "GRANTED" | "OPTED_OUT" | "UNKNOWN";
  channels: BuyerOutreachChannel[];
  evidenceUrl?: string;
  source?: string;
  capturedAt?: string;
  validUntil?: string | null;
};

const outreachTransitions: Record<BuyerOutreachState, readonly BuyerOutreachState[]> = {
  DRAFT: ["APPROVED"],
  APPROVED: ["QUEUED"],
  QUEUED: ["SENT", "FAILED"],
  SENT: ["CONFIRMED", "FAILED"],
  CONFIRMED: [],
  FAILED: [],
};

export function assertBuyerOutreachTransition(from: BuyerOutreachState, to: BuyerOutreachState) {
  if (!outreachTransitions[from].includes(to)) throw new Error(`Invalid buyer outreach transition: ${from} → ${to}.`);
}

export function buyerOutreachPermissionBlocker(
  permission: BuyerContactPermission | null | undefined,
  channel: BuyerOutreachChannel,
  now = new Date(),
) {
  if (!permission || permission.status !== "GRANTED") return "Explicit current buyer contact permission is not recorded.";
  if (!permission.channels.includes(channel)) return `Permission does not cover ${channel}.`;
  if (!permission.evidenceUrl || !permission.source || !permission.capturedAt || !permission.validUntil) {
    return "Permission needs evidence, source, capture time, and expiry.";
  }
  const captured = Date.parse(permission.capturedAt);
  const expiry = Date.parse(permission.validUntil);
  if (!Number.isFinite(captured) || captured > now.getTime() || !Number.isFinite(expiry) || expiry <= now.getTime()) {
    return "Permission evidence is stale or has an invalid timestamp.";
  }
  return null;
}

export interface BuyerOutreachRequest {
  buyerId: string;
  channel: BuyerOutreachChannel;
  recipient: string;
  message: string;
  idempotencyKey: string;
  contactPermissionEvidenceUrl: string;
}

export interface BuyerOutreachReceipt {
  providerMessageId: string;
  acceptedAt: string;
}

export type DistributionDeliveryState =
  | "DRAFT" | "QUEUED" | "ATTEMPTED" | "PROVIDER_ACCEPTED" | "DELIVERED" | "INTERESTED" | "COMMITTED" | "FAILED" | "UNKNOWN";
export type DistributionProviderEvent = {
  eventId: string;
  providerId: string;
  providerMessageId: string;
  state: "PROVIDER_ACCEPTED" | "DELIVERED" | "FAILED" | "UNKNOWN";
  occurredAt: string;
};
export type ExactMessageApproval = {
  buyerId: string;
  channel: "EMAIL" | "SMS";
  packetVersion: number;
  packetSnapshotHash: string;
  recipientRouteHash: string;
  redactionLevel: "REDACTED" | "ADDRESS_DISCLOSED";
  packageAuthorizationId: string;
  consentSnapshotHash: string;
  expiresAt: string;
  exactMessageHash: string;
  approvedBy: string;
  approvedAt: string;
  approvalHash: string;
};

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const recipientRouteHash = (route: string) => sha256(route.trim().toLowerCase());
export function buyerConsentSnapshotHash(permission: BuyerContactPermission | null | undefined) {
  if (!permission) return sha256("missing-consent");
  return sha256(JSON.stringify({
    status: permission.status,
    channels: [...permission.channels].sort(),
    evidenceUrl: permission.evidenceUrl ?? null,
    source: permission.source ?? null,
    capturedAt: permission.capturedAt ?? null,
    validUntil: permission.validUntil ?? null,
  }));
}

/** Create only at an explicit human approval action; bind approval to exact text, recipient, channel and packet snapshot. */
export function approveExactDistributionMessage(input: {
  buyerId: string; channel: "EMAIL" | "SMS"; packetVersion: number; packetSnapshotHash: string;
  recipientRoute: string; redactionLevel: "REDACTED" | "ADDRESS_DISCLOSED";
  packageAuthorizationId: string; consentSnapshotHash: string;
  exactMessage: string; approvedBy: string; approvedAt: string; expiresAt: string;
}): ExactMessageApproval {
  if (!input.buyerId || !input.approvedBy || !input.exactMessage.trim() || input.packetVersion < 1 ||
    !/^[a-f0-9]{64}$/.test(input.packetSnapshotHash) || !/^[a-f0-9]{64}$/.test(input.consentSnapshotHash) ||
    !input.recipientRoute.trim() || !input.packageAuthorizationId || !Number.isFinite(Date.parse(input.approvedAt)) ||
    !Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= Date.parse(input.approvedAt)) {
    throw new Error("Exact-message approval requires recipient route, redaction, package authorization, current consent, packet snapshot, approver, non-empty message, and a future expiry.");
  }
  const exactMessageHash = sha256(input.exactMessage);
  const bound = {
    buyerId: input.buyerId, channel: input.channel, packetVersion: input.packetVersion,
    packetSnapshotHash: input.packetSnapshotHash, recipientRouteHash: recipientRouteHash(input.recipientRoute),
    redactionLevel: input.redactionLevel, packageAuthorizationId: input.packageAuthorizationId,
    consentSnapshotHash: input.consentSnapshotHash, exactMessageHash, approvedBy: input.approvedBy,
    approvedAt: input.approvedAt, expiresAt: input.expiresAt,
  };
  return { ...bound, approvalHash: sha256(JSON.stringify(bound)) };
}

export function assertExactDistributionApprovalCurrent(
  approval: ExactMessageApproval,
  current: {
    buyerId: string; channel: "EMAIL" | "SMS"; packetVersion: number; packetSnapshotHash: string;
    recipientRoute: string; redactionLevel: "REDACTED" | "ADDRESS_DISCLOSED";
    packageAuthorizationId: string; consentSnapshotHash: string; exactMessage: string; expiresAt: string;
  },
) {
  const expected = approveExactDistributionMessage({
    ...current, approvedBy: approval.approvedBy, approvedAt: approval.approvedAt,
  });
  if (approval.buyerId !== expected.buyerId || approval.channel !== expected.channel ||
    approval.packetVersion !== expected.packetVersion || approval.packetSnapshotHash !== expected.packetSnapshotHash ||
    approval.recipientRouteHash !== expected.recipientRouteHash || approval.redactionLevel !== expected.redactionLevel ||
    approval.packageAuthorizationId !== expected.packageAuthorizationId ||
    approval.consentSnapshotHash !== expected.consentSnapshotHash ||
    approval.expiresAt !== expected.expiresAt ||
    approval.exactMessageHash !== expected.exactMessageHash || approval.approvalHash !== expected.approvalHash) {
    throw new Error("Exact-message approval is stale or does not match the current recipient route, channel, package version/redaction/authorization, consent, and message.");
  }
}

/** Provider submit is forbidden unless the exact approval, current channel permission, and provider are all present. */
export function assertDistributionSubmissionReady(
  approval: ExactMessageApproval | null,
  current: {
    buyerId: string; channel: "EMAIL" | "SMS"; packetVersion: number; packetSnapshotHash: string;
    recipientRoute: string; redactionLevel: "REDACTED" | "ADDRESS_DISCLOSED";
    packageAuthorizationId: string; consentSnapshotHash: string; exactMessage: string;
    expiresAt: string;
  },
  permission: BuyerContactPermission | null | undefined,
  channel: "EMAIL" | "SMS",
  provider: BuyerOutreachProvider | undefined,
  now = new Date(),
  contactRouteVerified = false,
  recipientIdentityVerified = false,
) {
  if (!approval || approval.channel !== channel) throw new Error("Exact recipient message approval is required before provider submission.");
  if (current.consentSnapshotHash !== buyerConsentSnapshotHash(permission)) {
    throw new Error("Contact consent changed after approval; exact-message approval is stale.");
  }
  if (!Number.isFinite(Date.parse(current.expiresAt)) || Date.parse(current.expiresAt) <= now.getTime()) {
    throw new Error("Exact-message approval or package has expired; reauthorize before submission.");
  }
  assertExactDistributionApprovalCurrent(approval, current);
  if (current.redactionLevel === "ADDRESS_DISCLOSED" && !recipientIdentityVerified) {
    throw new Error("Address-disclosing package requires independently verified recipient identity; submission is blocked.");
  }
  if (!contactRouteVerified) throw new Error("The recipient route is not independently verified; message remains unsent.");
  const permissionBlock = buyerOutreachPermissionBlocker(permission, channel, now);
  if (permissionBlock) throw new Error(permissionBlock);
  if (!provider?.connected || !provider.channels.includes(channel)) throw new Error("No connected provider supports this channel; message remains unsent.");
}

/** Provider callback reducer: idempotent by event id and never equates acceptance with delivery. */
export function applyDistributionProviderEvent(
  events: DistributionProviderEvent[],
  incoming: DistributionProviderEvent,
): DistributionProviderEvent[] {
  if (!incoming.eventId || !incoming.providerId || !incoming.providerMessageId ||
    !Number.isFinite(Date.parse(incoming.occurredAt))) throw new Error("Provider event is missing its identity or timestamp.");
  const duplicate = events.find(event => event.eventId === incoming.eventId);
  if (duplicate) {
    if (JSON.stringify(duplicate) !== JSON.stringify(incoming)) throw new Error("Provider event id was replayed with different content.");
    return events;
  }
  const messageHistory = events.filter(event => event.providerMessageId === incoming.providerMessageId);
  if (messageHistory.some(event => event.providerId !== incoming.providerId)) {
    throw new Error("Provider message id is already bound to a different provider.");
  }
  if (messageHistory.some(event => event.state === "DELIVERED" || event.state === "FAILED")) {
    throw new Error("Provider message is already terminal; retry must use a distinct provider message id.");
  }
  const accepted = events.some(event => event.providerId === incoming.providerId &&
    event.providerMessageId === incoming.providerMessageId &&
    event.state === "PROVIDER_ACCEPTED");
  if (incoming.state === "DELIVERED" && !accepted) throw new Error("Delivery requires a matching provider-accepted submission.");
  if (incoming.state === "PROVIDER_ACCEPTED" && accepted) {
    throw new Error("Provider message already has an acceptance event; callback replay must retain the same event id.");
  }
  return [...events, incoming];
}

/**
 * Replaceable boundary for a permitted buyer-contact channel.
 * A provider must enforce its own authorization, consent, rate-limit, terms and
 * delivery rules. Its `send` result must identify an actual accepted delivery.
 */
export interface BuyerOutreachProvider {
  id: string;
  connected: boolean;
  channels: readonly BuyerOutreachChannel[];
  send(request: BuyerOutreachRequest): Promise<BuyerOutreachReceipt>;
}

export type BuyerOutreachReadiness = {
  status: "NO_CONTACT_ROUTE" | "CONTACT_ROUTE_UNVERIFIED" | "CONTACT_PERMISSION_REQUIRED" | "NO_CONNECTED_PROVIDER" | "READY";
  contactRouteStatus: "NONE" | "PRESENT_UNVERIFIED" | "VERIFIED";
  providerStatus: "NOT_CONNECTED" | "CONNECTED";
  deliveryStatus: "NOT_SENT";
  workflowState: BuyerOutreachState;
  permissionStatus: string;
  availableChannels: BuyerOutreachChannel[];
  missingCapabilities: string[];
  nextAction: string;
  checkedAt: string;
};

// Providers are registered by their own integration adapter at server startup.
// The current workspace has no permitted buyer-outreach provider registered.
const providers = new Map<string, BuyerOutreachProvider>();

export function registerBuyerOutreachProvider(provider: BuyerOutreachProvider) {
  if (!provider.id.trim()) throw new Error("Buyer outreach provider requires an id.");
  if (providers.has(provider.id)) throw new Error(`Buyer outreach provider ${provider.id} is already registered.`);
  providers.set(provider.id, provider);
  return () => providers.delete(provider.id);
}

export function buyerOutreachReadiness(
  buyer: { email?: string | null; phone?: string | null; contactPermission?: BuyerContactPermission | null; contactRouteVerified?: boolean },
  now = new Date(),
): BuyerOutreachReadiness {
  const routes: Partial<Record<BuyerOutreachChannel, string>> = {};
  if (buyer.email?.trim()) routes.EMAIL = buyer.email.trim();
  if (buyer.phone?.trim()) {
    routes.SMS = buyer.phone.trim();
    routes.VOICE = buyer.phone.trim();
  }
  const routeMethods = Object.keys(routes) as BuyerOutreachChannel[];
  const contactRouteVerified = buyer.contactRouteVerified === true;
  const connected = [...providers.values()].filter(provider => provider.connected);
  const availableChannels = routeMethods.filter(channel =>
    contactRouteVerified &&
    !buyerOutreachPermissionBlocker(buyer.contactPermission, channel, now) &&
    connected.some(provider => provider.channels.includes(channel)),
  );
  const contactRouteStatus = !routeMethods.length ? "NONE" : contactRouteVerified ? "VERIFIED" : "PRESENT_UNVERIFIED";
  const providerStatus = connected.length ? "CONNECTED" : "NOT_CONNECTED";
  const providerSupportsRoute = routeMethods.some(channel =>
    connected.some(provider => provider.channels.includes(channel)),
  );
  const missingCapabilities: string[] = [];
  if (!routeMethods.length) missingCapabilities.push("No direct buyer email or phone route is recorded.");
  else if (!contactRouteVerified) missingCapabilities.push("The recipient route is present but not independently verified; source presence and consent do not prove control of the route.");
  else missingCapabilities.push("The contact route has no source/provenance and permission evidence reviewed for this exact channel.");
  const permissionBlock = routeMethods.map(channel => buyerOutreachPermissionBlocker(buyer.contactPermission, channel, now)).find(Boolean);
  if (permissionBlock) missingCapabilities.push(permissionBlock);
  if (!connected.length) missingCapabilities.push("No permitted email/SMS/voice outreach provider is connected; the system cannot send a verification request.");
  else if (!providerSupportsRoute) missingCapabilities.push("Connected providers do not support the buyer's recorded contact route.");
  missingCapabilities.push("Current buying, identity, criteria, and funding evidence still requires a real buyer response and owner review.");

  const status = !routeMethods.length
    ? "NO_CONTACT_ROUTE"
    : !contactRouteVerified
      ? "CONTACT_ROUTE_UNVERIFIED"
      : !connected.length || !providerSupportsRoute
        ? "NO_CONNECTED_PROVIDER"
        : !availableChannels.length
          ? "CONTACT_PERMISSION_REQUIRED"
          : "READY";
  const nextAction = !routeMethods.length
    ? "No direct route is on file. Obtain a legitimate contact route with provenance and permission evidence; public ownership or a directory entry is not buyer identity or contact permission."
    : !contactRouteVerified
      ? "Independently verify control of this exact recipient route and retain the evidence; source presence or consent alone does not prove route ownership. No request has been sent."
    : "No automated request has been sent. Review the exact route and permission evidence, then use a permitted human channel and record the actual contact or reply. A response is not approval.";
  return {
    status,
    contactRouteStatus,
    providerStatus,
    deliveryStatus: "NOT_SENT",
    workflowState: "DRAFT",
    permissionStatus: !buyer.contactPermission
      ? "NOT_RECORDED"
      : buyer.contactPermission.status === "OPTED_OUT"
        ? "OPTED_OUT"
        : permissionBlock ? "STALE_OR_INCOMPLETE" : "GRANTED",
    availableChannels,
    missingCapabilities,
    nextAction,
    checkedAt: now.toISOString(),
  };
}

