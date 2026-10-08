export const CONTACT_ENRICHMENT_CHANNELS = ["PHONE", "EMAIL", "WEB", "OTHER"] as const;
export type ContactEnrichmentChannel = typeof CONTACT_ENRICHMENT_CHANNELS[number];

export const CONTACT_PROVIDER_STATES = [
  "AVAILABLE_AND_EXERCISED",
  "CONFIGURED_BUT_UNEXERCISED",
  "UNAVAILABLE",
  "BLOCKED_BY_POLICY",
  "BLOCKED_BY_TERMS",
] as const;
export type ContactProviderState = typeof CONTACT_PROVIDER_STATES[number];

export type ContactEpistemicStatus = "OBSERVED" | "INDICATED" | "AI_HYPOTHESIS";
export type ContactPermissionAssessment = "SUPPORTS_ALLOWED" | "UNKNOWN" | "BLOCKED";
export type ContactIdentityEvidenceStatus = "NONE" | "CLAIMED" | "SUPPORTING_RECORD";

export interface ContactProviderCapability {
  providerId: string;
  name: string;
  state: ContactProviderState;
  channels: ContactEnrichmentChannel[];
  reason: string;
  policyReference?: string | null;
  termsReviewedAt?: string | null;
  lastExercisedAt?: string | null;
}

export interface ContactEnrichmentRegistryStatus {
  state: ContactProviderState;
  providers: ContactProviderCapability[];
  reason: string;
}

export interface ContactEnrichmentRequestContext {
  leadId: string;
  leadVersion: number;
  idempotencyKey: string;
  requestedAt: string;
  channels: ContactEnrichmentChannel[];
}

export interface ContactEnrichmentObservation {
  channel: ContactEnrichmentChannel;
  routeValue: string;
  recipient: string | null;
  recipientRole: "RECORDED_OWNER" | "SELLER_SELF_IDENTIFIED" | "AUTHORIZED_AGENT_CLAIM" | "DIRECTORY_CONTACT" | "UNKNOWN";
  epistemicStatus: ContactEpistemicStatus;
  confidence: number;
  source: {
    id: string;
    name: string;
    type: "PUBLIC_RECORD" | "PUBLIC_PAGE" | "PERMITTED_LISTING";
    recordId: string;
    url: string;
  };
  observedAt: string;
  freshUntilAt: string;
  permission: {
    assessment: ContactPermissionAssessment;
    legalBasis: "CONSENT" | "PUBLIC_SOURCE_TERMS" | "PUBLIC_DATA_REUSE" | "OTHER_DOCUMENTED" | "UNKNOWN";
    scope: string;
    evidenceUrl: string | null;
  };
  identityEvidence: {
    status: ContactIdentityEvidenceStatus;
    reference: string | null;
  };
}

export type ContactProviderResult =
  | { outcome: "RESULTS"; observations: ContactEnrichmentObservation[] }
  | { outcome: "NO_RESULT"; observations: [] }
  | { outcome: "BLOCKED_BY_POLICY"; observations: []; reason: string };

export interface SellerContactEnrichmentProvider {
  capability: ContactProviderCapability;
  enrich(request: ContactEnrichmentRequestContext, signal?: AbortSignal): Promise<ContactProviderResult>;
}

export class ContactProviderError extends Error {
  constructor(
    readonly code: "RATE_LIMITED" | "TEMPORARY_FAILURE" | "AUTH_REQUIRED" | "TERMS_CHANGED" | "INVALID_RESPONSE",
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(code);
    this.name = "ContactProviderError";
  }
}

export function createContactEnrichmentRegistry(providers: SellerContactEnrichmentProvider[]) {
  const ids = providers.map(({ capability }) => capability.providerId);
  if (ids.some(id => !id.trim()) || new Set(ids).size !== ids.length) {
    throw new Error("Seller-contact provider IDs must be non-empty and unique.");
  }
  for (const { capability } of providers) {
    const hasReadinessEvidence = typeof capability.policyReference === "string" &&
      capability.policyReference.trim().length > 0 &&
      typeof capability.termsReviewedAt === "string" &&
      Number.isFinite(Date.parse(capability.termsReviewedAt)) &&
      typeof capability.lastExercisedAt === "string" &&
      Number.isFinite(Date.parse(capability.lastExercisedAt)) &&
      Date.parse(capability.termsReviewedAt) <= Date.parse(capability.lastExercisedAt);
    if (capability.state === "AVAILABLE_AND_EXERCISED" && !hasReadinessEvidence) {
      throw new Error("An available seller-contact provider requires a terms/policy reference, review timestamp, and successful exercise timestamp.");
    }
    if (new Set(capability.channels).size !== capability.channels.length ||
      capability.channels.some(channel => !CONTACT_ENRICHMENT_CHANNELS.includes(channel))) {
      throw new Error(`Seller-contact provider ${capability.providerId} declares duplicate or unsupported route types.`);
    }
  }
  const ordered = [...providers].sort((a, b) => a.capability.providerId.localeCompare(b.capability.providerId));
  const capabilities = ordered.map(provider => ({
    ...provider.capability,
    policyReference: provider.capability.policyReference ?? null,
    termsReviewedAt: provider.capability.termsReviewedAt ?? null,
    lastExercisedAt: provider.capability.lastExercisedAt ?? null,
  }));
  const state: ContactProviderState = capabilities.some(item => item.state === "AVAILABLE_AND_EXERCISED")
    ? "AVAILABLE_AND_EXERCISED"
    : capabilities.some(item => item.state === "CONFIGURED_BUT_UNEXERCISED")
      ? "CONFIGURED_BUT_UNEXERCISED"
      : capabilities.some(item => item.state === "BLOCKED_BY_POLICY")
        ? "BLOCKED_BY_POLICY"
        : capabilities.some(item => item.state === "BLOCKED_BY_TERMS")
          ? "BLOCKED_BY_TERMS"
          : "UNAVAILABLE";
  const reason = capabilities.length
    ? capabilities.map(item => `${item.name}: ${item.reason}`).join(" ")
    : "No permitted seller-contact enrichment provider is configured in this workspace. No external contact lookup or outreach is available.";
  return {
    providers: ordered,
    status: (): ContactEnrichmentRegistryStatus => ({ state, providers: capabilities, reason }),
    executableProviders: () => ordered.filter(provider =>
      provider.capability.state === "AVAILABLE_AND_EXERCISED"),
  };
}

export const sellerContactEnrichmentRegistry = createContactEnrichmentRegistry([]);

export function validateContactEnrichmentObservation(
  observation: ContactEnrichmentObservation,
  now = new Date(),
  maxFreshnessMs = 30 * 24 * 60 * 60 * 1000,
) {
  const required = (value: string | null | undefined) => typeof value === "string" && value.trim().length > 0;
  if (!CONTACT_ENRICHMENT_CHANNELS.includes(observation.channel) ||
    !required(observation.routeValue) || !Number.isFinite(observation.confidence) ||
    observation.confidence < 0 || observation.confidence > 1 ||
    !["OBSERVED", "INDICATED", "AI_HYPOTHESIS"].includes(observation.epistemicStatus) ||
    !["RECORDED_OWNER", "SELLER_SELF_IDENTIFIED", "AUTHORIZED_AGENT_CLAIM", "DIRECTORY_CONTACT", "UNKNOWN"].includes(observation.recipientRole) ||
    (observation.recipient !== null && typeof observation.recipient !== "string")) {
    throw new ContactProviderError("INVALID_RESPONSE", false);
  }
  if (!required(observation.source?.id) || !required(observation.source?.name) ||
    !required(observation.source?.recordId) ||
    !["PUBLIC_RECORD", "PUBLIC_PAGE", "PERMITTED_LISTING"].includes(observation.source.type) ||
    !required(observation.source?.type) ||
    !observation.source.url?.startsWith("https://")) {
    throw new ContactProviderError("INVALID_RESPONSE", false);
  }
  const observedAt = Date.parse(observation.observedAt);
  const freshUntilAt = Date.parse(observation.freshUntilAt);
  if (!Number.isFinite(observedAt) || !Number.isFinite(freshUntilAt) ||
    observedAt > now.getTime() || freshUntilAt <= observedAt ||
    freshUntilAt - observedAt > maxFreshnessMs) {
    throw new ContactProviderError("INVALID_RESPONSE", false);
  }
  if (!observation.permission ||
    !["SUPPORTS_ALLOWED", "UNKNOWN", "BLOCKED"].includes(observation.permission.assessment) ||
    !["CONSENT", "PUBLIC_SOURCE_TERMS", "PUBLIC_DATA_REUSE", "OTHER_DOCUMENTED", "UNKNOWN"].includes(observation.permission.legalBasis) ||
    !required(observation.permission.scope) || observation.permission.scope.length > 1000 ||
    (observation.permission.evidenceUrl !== null && !observation.permission.evidenceUrl.startsWith("https://"))) {
    throw new ContactProviderError("INVALID_RESPONSE", false);
  }
  if (!observation.identityEvidence ||
    !["NONE", "CLAIMED", "SUPPORTING_RECORD"].includes(observation.identityEvidence.status) ||
    (observation.identityEvidence.status !== "NONE" && !required(observation.identityEvidence.reference)) ||
    (observation.identityEvidence.reference !== null && !required(observation.identityEvidence.reference))) {
    throw new ContactProviderError("INVALID_RESPONSE", false);
  }
  return observation;
}
