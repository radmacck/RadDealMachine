import assert from "node:assert/strict";
import test from "node:test";
import {
  ContactProviderError,
  createContactEnrichmentRegistry,
  sellerContactEnrichmentRegistry,
  validateContactEnrichmentObservation,
  type ContactEnrichmentObservation,
  type SellerContactEnrichmentProvider,
} from "./contact-enrichment";

const now = new Date("2026-10-08T16:00:00.000Z");
const observation = (overrides: Partial<ContactEnrichmentObservation> = {}): ContactEnrichmentObservation => ({
  channel: "PHONE",
  routeValue: "+12155550123",
  recipient: "SYNTHETIC test recipient",
  recipientRole: "DIRECTORY_CONTACT",
  epistemicStatus: "INDICATED",
  confidence: 0.6,
  source: {
    id: "synthetic-provider",
    name: "Synthetic provider fixture (not a real source)",
    type: "PUBLIC_PAGE",
    recordId: "SYNTHETIC-REC-1",
    url: "https://example.invalid/synthetic-record/1",
  },
  observedAt: new Date(now.getTime() - 60_000).toISOString(),
  freshUntilAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
  permission: {
    assessment: "UNKNOWN",
    legalBasis: "UNKNOWN",
    scope: "SYNTHETIC exercise only; no real person or contact data.",
    evidenceUrl: null,
  },
  identityEvidence: { status: "CLAIMED", reference: "SYNTHETIC-IDENTITY-REF-1" },
  ...overrides,
});

const provider = (state: SellerContactEnrichmentProvider["capability"]["state"], id = "synthetic-provider"): SellerContactEnrichmentProvider => ({
  capability: {
    providerId: id,
    name: `Synthetic provider ${id} (exercise only)`,
    state,
    channels: ["PHONE", "EMAIL"],
    reason: `Synthetic provider state ${state}; no external service is contacted.`,
    policyReference: "SYNTHETIC exercise only",
    termsReviewedAt: state === "AVAILABLE_AND_EXERCISED" ? now.toISOString() : null,
    lastExercisedAt: state === "AVAILABLE_AND_EXERCISED" ? now.toISOString() : null,
  },
  async enrich() {
    return { outcome: "NO_RESULT", observations: [] };
  },
});

test("production registry explicitly has no configured direct-contact provider", () => {
  const status = sellerContactEnrichmentRegistry.status();
  assert.equal(status.state, "UNAVAILABLE");
  assert.deepEqual(status.providers, []);
  assert.match(status.reason, /No permitted seller-contact enrichment provider is configured/);
  assert.equal(sellerContactEnrichmentRegistry.executableProviders().length, 0);
});

test("replaceable registry exposes provider readiness and only exercised providers are runnable", () => {
  const registry = createContactEnrichmentRegistry([
    provider("CONFIGURED_BUT_UNEXERCISED", "not-exercised"),
    provider("AVAILABLE_AND_EXERCISED", "ready"),
    provider("BLOCKED_BY_TERMS", "terms-blocked"),
    provider("BLOCKED_BY_POLICY", "policy-blocked"),
    provider("UNAVAILABLE", "unavailable"),
  ]);
  assert.equal(registry.status().state, "AVAILABLE_AND_EXERCISED");
  assert.deepEqual(registry.executableProviders().map(item => item.capability.providerId), ["ready"]);
  assert.equal(registry.status().providers[0]?.termsReviewedAt, null);
  assert.throws(() => createContactEnrichmentRegistry([
    provider("UNAVAILABLE", "duplicate"), provider("UNAVAILABLE", "duplicate"),
  ]), /unique/);
  const unprovenAvailable = provider("AVAILABLE_AND_EXERCISED", "not-proven");
  unprovenAvailable.capability.lastExercisedAt = null;
  assert.throws(() => createContactEnrichmentRegistry([unprovenAvailable]), /successful exercise timestamp/);
});

test("provider evidence contract retains provenance, epistemic status, permission basis, identity evidence and freshness", () => {
  const valid = observation();
  assert.equal(validateContactEnrichmentObservation(valid, now), valid);
  const stale = observation({
    observedAt: new Date(now.getTime() - 40 * 86_400_000).toISOString(),
    freshUntilAt: new Date(now.getTime() - 10 * 86_400_000).toISOString(),
  });
  assert.equal(validateContactEnrichmentObservation(stale, now), stale, "expired observations may be preserved but remain stale downstream");
});

test("malformed or unsupported provider claims fail validation without becoming evidence", () => {
  const reject = (value: ContactEnrichmentObservation) =>
    assert.throws(() => validateContactEnrichmentObservation(value, now), (error: unknown) =>
      error instanceof ContactProviderError && error.code === "INVALID_RESPONSE" && !error.retryable);
  reject(observation({ confidence: 1.1 }));
  reject(observation({ observedAt: new Date(now.getTime() + 1).toISOString() }));
  reject(observation({ freshUntilAt: new Date(now.getTime() + 40 * 86_400_000).toISOString() }));
  reject(observation({ source: { ...observation().source, url: "http://not-permitted.invalid/" } }));
  reject(observation({ identityEvidence: { status: "SUPPORTING_RECORD", reference: null } }));
  reject(observation({ permission: { ...observation().permission, scope: "" } }));
});
