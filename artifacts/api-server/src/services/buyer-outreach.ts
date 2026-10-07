export type BuyerOutreachChannel = "EMAIL" | "SMS" | "VOICE";

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
  status: "NO_CONTACT_ROUTE" | "CONTACT_PERMISSION_REQUIRED" | "NO_CONNECTED_PROVIDER" | "READY";
  contactRouteStatus: "NONE" | "PRESENT_UNVERIFIED";
  providerStatus: "NOT_CONNECTED" | "CONNECTED";
  deliveryStatus: "NOT_SENT";
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
  buyer: { email?: string | null; phone?: string | null },
  now = new Date(),
): BuyerOutreachReadiness {
  const routes: Partial<Record<BuyerOutreachChannel, string>> = {};
  if (buyer.email?.trim()) routes.EMAIL = buyer.email.trim();
  if (buyer.phone?.trim()) {
    routes.SMS = buyer.phone.trim();
    routes.VOICE = buyer.phone.trim();
  }
  const routeMethods = Object.keys(routes) as BuyerOutreachChannel[];
  const connected = [...providers.values()].filter(provider => provider.connected);
  const availableChannels = routeMethods.filter(channel =>
    connected.some(provider => provider.channels.includes(channel)),
  );
  const contactRouteStatus = routeMethods.length ? "PRESENT_UNVERIFIED" : "NONE";
  const providerStatus = connected.length ? "CONNECTED" : "NOT_CONNECTED";
  const missingCapabilities: string[] = [];
  if (!routeMethods.length) missingCapabilities.push("No direct buyer email or phone route is recorded.");
  else missingCapabilities.push("The contact route has no source/provenance and permission evidence reviewed for this exact channel.");
  if (!connected.length) missingCapabilities.push("No permitted email/SMS/voice outreach provider is connected; the system cannot send a verification request.");
  else if (!availableChannels.length) missingCapabilities.push("Connected providers do not support the buyer's recorded contact route.");
  missingCapabilities.push("Current buying, identity, criteria, and funding evidence still requires a real buyer response and owner review.");

  const status = !routeMethods.length
    ? "NO_CONTACT_ROUTE"
    : !connected.length || !availableChannels.length
      ? "NO_CONNECTED_PROVIDER"
      : "CONTACT_PERMISSION_REQUIRED";
  const nextAction = !routeMethods.length
    ? "No direct route is on file. Obtain a legitimate contact route with provenance and permission evidence; public ownership or a directory entry is not buyer identity or contact permission."
    : "No automated request has been sent. Review the exact route and permission evidence, then use a permitted human channel and record the actual contact or reply. A response is not approval.";
  return {
    status,
    contactRouteStatus,
    providerStatus,
    deliveryStatus: "NOT_SENT",
    availableChannels,
    missingCapabilities,
    nextAction,
    checkedAt: now.toISOString(),
  };
}

