import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import {
  auditTable, db, intelligenceTable, leadsTable, sellerContactEnrichmentRequestsTable,
} from "@workspace/db";
import {
  GetSellerContactEnrichmentResponse, RequestSellerContactEnrichmentResponse,
} from "@workspace/api-zod";
import {
  ContactProviderError, createContactEnrichmentRegistry,
  type ContactEnrichmentObservation, type ContactEnrichmentRequestContext,
  type ContactProviderResult, type ContactProviderState, type SellerContactEnrichmentProvider,
} from "@workspace/property-sources";
import { createLead } from "./deal-store";
import {
  getSellerContactEnrichment, requestSellerContactEnrichment, runSellerContactEnrichmentOnce,
} from "./seller-contact-enrichment";
import { getSellerContactPaths } from "./seller-contact-store";

const start = new Date("2026-10-08T16:00:00.000Z");
const owner = { id: "synthetic-contact-enrichment-owner", role: "OWNER" as const };
const analyst = { id: "synthetic-contact-enrichment-analyst", role: "ANALYST" as const };
let sequence = 0;
const nowAt = (offsetMs = 0) => new Date(start.getTime() + offsetMs + ++sequence);

async function leadFixture(label: string) {
  const lead = await createLead({
    address: `SYNTHETIC ${label.toUpperCase()} TEST PROPERTY`,
    city: "Philadelphia",
    state: "PA",
    county: "Philadelphia",
    zip: "19103",
    propertyType: "SINGLE_FAMILY",
    sqft: 1200,
    beds: 3,
    baths: 1,
    units: 1,
    sellerName: `SYNTHETIC ${label} subject; not a real owner`,
    source: "SYNTHETIC seller contact enrichment service exercise",
    nextAction: "Synthetic exercise only; no external contact.",
  }, owner.id, nowAt());
  await db.update(leadsTable).set({
    stage: "UNDER_CONTRACT",
    nextAction: "Synthetic authorized transaction action must remain unchanged.",
    analysis: { synthetic: true, economicsVersion: 7, locked: true },
    underwriting: { synthetic: true, arv: 200000, repairs: 30000, wholesaleFee: 10000 },
  }).where(eq(leadsTable.id, lead.id));
  return lead.id;
}

function observation(
  providerId: string,
  suffix: string,
  now: Date,
  overrides: Partial<ContactEnrichmentObservation> = {},
): ContactEnrichmentObservation {
  const observedAt = new Date(now.getTime() - 60_000);
  return {
    channel: "PHONE",
    routeValue: "(215) 555-0101",
    recipient: "SYNTHETIC directory contact; not a real person",
    recipientRole: "DIRECTORY_CONTACT",
    epistemicStatus: "INDICATED",
    confidence: 0.61,
    source: {
      id: providerId,
      name: `SYNTHETIC ${providerId} provider fixture; not a real source`,
      type: "PUBLIC_PAGE",
      recordId: `SYNTHETIC-${providerId}-${suffix}`,
      url: `https://example.invalid/synthetic/${providerId}/${suffix}`,
    },
    observedAt: observedAt.toISOString(),
    freshUntilAt: new Date(now.getTime() + 10 * 86_400_000).toISOString(),
    permission: {
      assessment: "SUPPORTS_ALLOWED",
      legalBasis: "PUBLIC_SOURCE_TERMS",
      scope: "SYNTHETIC test fixture only; it is not evidence about a real person or source.",
      evidenceUrl: "https://example.invalid/synthetic/terms",
    },
    identityEvidence: { status: "CLAIMED", reference: `SYNTHETIC-IDENTITY-${suffix}` },
    ...overrides,
  };
}

function adapter(
  id: string,
  state: ContactProviderState,
  execute: (request: ContactEnrichmentRequestContext) => Promise<ContactProviderResult>,
): SellerContactEnrichmentProvider {
  return {
    capability: {
      providerId: id,
      name: `SYNTHETIC ${id} adapter; no external provider`,
      state,
      channels: ["PHONE", "EMAIL", "WEB", "OTHER"],
      reason: `SYNTHETIC exercise state ${state}; no real provider was contacted.`,
      policyReference: "SYNTHETIC ONLY",
      termsReviewedAt: state === "AVAILABLE_AND_EXERCISED" ? start.toISOString() : null,
      lastExercisedAt: state === "AVAILABLE_AND_EXERCISED" ? start.toISOString() : null,
    },
    async enrich(request) {
      return execute(request);
    },
  };
}

async function request(
  leadId: string,
  idempotencyKey: string,
  registry: ReturnType<typeof createContactEnrichmentRegistry>,
  at = nowAt(),
) {
  return requestSellerContactEnrichment(
    leadId, { idempotencyKey, channels: ["PHONE", "EMAIL"] }, analyst, at, registry,
  );
}

async function status(leadId: string, registry: ReturnType<typeof createContactEnrichmentRegistry>, at = nowAt()) {
  return getSellerContactEnrichment(leadId, at, registry.status());
}

// Production-configuration boundary: no provider is connected, so the request is
// persisted with a truthful unavailable reason and no lookup is attempted.
const productionLead = await leadFixture("production unavailable");
const beforeProduction = await db.select().from(leadsTable).where(eq(leadsTable.id, productionLead));
const productionRequest = await requestSellerContactEnrichment(
  productionLead,
  { idempotencyKey: "synthetic-no-provider-request", channels: ["PHONE", "EMAIL"] },
  analyst,
  nowAt(),
);
RequestSellerContactEnrichmentResponse.parse(productionRequest);
assert.equal(productionRequest.registry.state, "UNAVAILABLE");
assert.equal(productionRequest.requests[0]?.status, "UNAVAILABLE");
assert.equal(productionRequest.requests[0]?.operationState, "NOT_CONFIGURED");
assert.equal(productionRequest.requests[0]?.attemptHistory.length, 0);
assert.match(productionRequest.requests[0]?.reason ?? "", /No permitted seller-contact enrichment provider is configured/);
const sameRequest = await requestSellerContactEnrichment(
  productionLead,
  { idempotencyKey: "synthetic-no-provider-request", channels: ["PHONE", "EMAIL"] },
  analyst,
  nowAt(),
);
RequestSellerContactEnrichmentResponse.parse(sameRequest);
assert.equal(sameRequest.requests.length, 1, "Idempotent retry reuses the persisted request.");
assert.equal(sameRequest.requests[0]?.id, productionRequest.requests[0]?.id);
const productionAfter = await db.select().from(leadsTable).where(eq(leadsTable.id, productionLead));
assert.deepEqual(
  {
    stage: productionAfter[0]?.stage, analysis: productionAfter[0]?.analysis,
    underwriting: productionAfter[0]?.underwriting, nextAction: productionAfter[0]?.nextAction,
  },
  {
    stage: beforeProduction[0]?.stage, analysis: beforeProduction[0]?.analysis,
    underwriting: beforeProduction[0]?.underwriting, nextAction: beforeProduction[0]?.nextAction,
  },
  "A request without a provider cannot alter transaction/economics state.",
);

// Provider capability states are persisted as explicit non-runnable outcomes.
for (const [state, id, expected] of [
  ["UNAVAILABLE", "synthetic-unavailable", "UNAVAILABLE"],
  ["CONFIGURED_BUT_UNEXERCISED", "synthetic-unexercised", "BLOCKED_BY_PROVIDER_READINESS"],
  ["BLOCKED_BY_POLICY", "synthetic-policy-blocked", "BLOCKED_BY_POLICY"],
  ["BLOCKED_BY_TERMS", "synthetic-terms-blocked", "BLOCKED_BY_TERMS"],
] as const) {
  const leadId = await leadFixture(id);
  let called = false;
  const registry = createContactEnrichmentRegistry([adapter(id, state, async () => {
    called = true;
    return { outcome: "NO_RESULT", observations: [] };
  })]);
  const created = await request(leadId, `request-${id}`, registry);
  assert.equal(created.requests[0]?.status, expected);
  assert.equal(called, false, `${state} must never call a provider.`);
  await runSellerContactEnrichmentOnce(nowAt(), registry);
  const after = await status(leadId, registry);
  assert.equal(after.requests[0]?.status, expected);
  assert.equal(after.requests[0]?.attempts, 0, `${state} does not claim a provider execution.`);
}

// Success only adds a provenance-backed, unreviewed observation. It cannot
// establish permission/identity/signing authority or CALL READY.
const successLead = await leadFixture("success");
const successRegistry = createContactEnrichmentRegistry([adapter(
  "synthetic-success", "AVAILABLE_AND_EXERCISED",
  async requestContext => ({
    outcome: "RESULTS",
    observations: [observation("synthetic-success", requestContext.idempotencyKey, new Date(requestContext.requestedAt))],
  }),
)]);
await request(successLead, "success-request", successRegistry);
await runSellerContactEnrichmentOnce(nowAt(), successRegistry);
const successStatus = await status(successLead, successRegistry);
GetSellerContactEnrichmentResponse.parse(successStatus);
assert.equal(successStatus.requests[0]?.status, "SUCCEEDED");
assert.equal(successStatus.requests[0]?.resultCount, 1);
const successContact = await getSellerContactPaths(successLead, nowAt());
assert.equal(successContact.directRouteStatus, "NEEDS_REVIEW");
assert.equal(successContact.selectedPhonePath, null);
assert.equal(successContact.contactPaths[0]?.classification, "OBSERVED");
assert.equal(successContact.contactPaths[0]?.epistemicStatus, "INDICATED");
assert.equal(successContact.contactPaths[0]?.permissionStatus, "NOT_REVIEWED");
assert.equal(successContact.contactPaths[0]?.routeVerificationStatus, "UNREVIEWED");
assert.equal(successContact.contactPaths[0]?.identityStatus, "UNVERIFIED");
assert.equal(successContact.contactPaths[0]?.signingAuthorityStatus, "NOT_ESTABLISHED");
assert.equal(successContact.contactPaths[0]?.providerId, "synthetic-success");
assert.equal(successContact.contactPaths[0]?.legalBasis, "PUBLIC_SOURCE_TERMS");

// A permitted provider may return no result; no route is synthesized.
const noneLead = await leadFixture("no result");
const noneRegistry = createContactEnrichmentRegistry([adapter(
  "synthetic-no-result", "AVAILABLE_AND_EXERCISED",
  async () => ({ outcome: "NO_RESULT", observations: [] }),
)]);
await request(noneLead, "no-result-request", noneRegistry);
await runSellerContactEnrichmentOnce(nowAt(), noneRegistry);
const noneStatus = await status(noneLead, noneRegistry);
GetSellerContactEnrichmentResponse.parse(noneStatus);
assert.equal(noneStatus.requests[0]?.status, "NO_RESULT");
assert.equal((await getSellerContactPaths(noneLead, nowAt())).contactPaths.length, 0);

// Old evidence may be retained with provenance, but expires immediately and
// cannot be selected or treated as a call route.
const staleLead = await leadFixture("stale result");
const staleRegistry = createContactEnrichmentRegistry([adapter(
  "synthetic-stale", "AVAILABLE_AND_EXERCISED",
  async requestContext => {
    const runAt = new Date(requestContext.requestedAt);
    const observedAt = new Date(runAt.getTime() - 40 * 86_400_000);
    return {
      outcome: "RESULTS",
      observations: [observation("synthetic-stale", "old-record", runAt, {
        observedAt: observedAt.toISOString(),
        freshUntilAt: new Date(runAt.getTime() - 10 * 86_400_000).toISOString(),
      })],
    };
  },
)]);
await request(staleLead, "stale-request", staleRegistry);
await runSellerContactEnrichmentOnce(nowAt(), staleRegistry);
assert.equal((await status(staleLead, staleRegistry)).requests[0]?.status, "STALE_RESULT");
const staleContact = await getSellerContactPaths(staleLead, nowAt());
assert.equal(staleContact.directRouteStatus, "STALE_ROUTE");
assert.equal(staleContact.selectedPhonePath, null);

// A property/source revision between request and job execution marks the request
// stale before the provider runs, preventing results from attaching to changed evidence.
const changedLead = await leadFixture("changed while queued");
let changedProviderCalled = false;
const changedRegistry = createContactEnrichmentRegistry([adapter(
  "synthetic-changed", "AVAILABLE_AND_EXERCISED",
  async () => {
    changedProviderCalled = true;
    return { outcome: "NO_RESULT", observations: [] };
  },
)]);
await request(changedLead, "changed-request", changedRegistry);
const beforeChange = (await db.select({ version: leadsTable.version }).from(leadsTable)
  .where(eq(leadsTable.id, changedLead)))[0]!;
await db.update(leadsTable).set({ version: beforeChange.version + 1 })
  .where(eq(leadsTable.id, changedLead));
await runSellerContactEnrichmentOnce(nowAt(), changedRegistry);
assert.equal((await status(changedLead, changedRegistry)).requests[0]?.status, "STALE_RESULT");
assert.equal(changedProviderCalled, false);
assert.equal((await getSellerContactPaths(changedLead, nowAt())).contactPaths.length, 0);

// Normalized duplicate evidence merges to one route but retains all observations;
// conflicting recipient claims remain visible and block route selection.
const duplicateLead = await leadFixture("duplicate and conflict");
const duplicateRegistry = createContactEnrichmentRegistry([adapter(
  "synthetic-duplicate", "AVAILABLE_AND_EXERCISED",
  async requestContext => {
    const at = new Date(requestContext.requestedAt);
    return {
      outcome: "RESULTS",
      observations: [
        observation("synthetic-duplicate", "duplicate-a", at),
        observation("synthetic-duplicate", "duplicate-b", at, {
          routeValue: "+1 215 555 0101",
          confidence: 0.7,
        }),
        observation("synthetic-duplicate", "conflict-c", at, {
          routeValue: "215.555.0101",
          recipient: "SYNTHETIC different claimant; not a real person",
        }),
      ],
    };
  },
)]);
await request(duplicateLead, "duplicate-request", duplicateRegistry);
await runSellerContactEnrichmentOnce(nowAt(), duplicateRegistry);
const conflictContact = await getSellerContactPaths(duplicateLead, nowAt());
assert.equal(conflictContact.directRouteStatus, "CONFLICTING_ROUTE");
assert.equal(conflictContact.selectedPhonePath, null);
assert.equal(conflictContact.contactPaths.length, 1);
assert.equal(conflictContact.contactPaths[0]?.supportingObservationCount, 3);
assert.equal(conflictContact.contactPaths[0]?.identityConflictStatus, "MULTIPLE_RECIPIENTS");
assert.equal((await db.select().from(intelligenceTable).where(eq(intelligenceTable.leadId, duplicateLead))).length, 3);

// Transient failure is durably scheduled with deterministic exponential backoff;
// a later retry succeeds without resending outreach or changing deal economics.
const retryLead = await leadFixture("retry");
let retryCount = 0;
const retryRegistry = createContactEnrichmentRegistry([adapter(
  "synthetic-retry", "AVAILABLE_AND_EXERCISED",
  async requestContext => {
    retryCount++;
    if (retryCount === 1) throw new ContactProviderError("RATE_LIMITED", true, 10_000);
    const at = new Date(requestContext.requestedAt);
    return {
      outcome: "RESULTS",
      observations: [observation("synthetic-retry", "retry-result", at)],
    };
  },
)]);
const retryCreatedAt = nowAt();
await request(retryLead, "retry-request", retryRegistry, retryCreatedAt);
await runSellerContactEnrichmentOnce(new Date(retryCreatedAt.getTime() + 1_000), retryRegistry);
let retryStatus = await status(retryLead, retryRegistry, new Date(retryCreatedAt.getTime() + 1_001));
assert.equal(retryStatus.requests[0]?.status, "RETRY_WAIT");
assert.equal(retryStatus.requests[0]?.attempts, 1);
assert.equal(retryStatus.requests[0]?.lastFailureCode, "RATE_LIMITED");
assert.equal(retryStatus.requests[0]?.attemptHistory[0]?.state, "SUBMITTED");
assert.equal(retryStatus.requests[0]?.attemptHistory[1]?.state, "RATE_LIMITED");
assert.equal(
  retryStatus.requests[0]?.nextAttemptAt,
  new Date(retryCreatedAt.getTime() + 31_000).toISOString(),
  "Backoff uses max(exponential 30s, provider retry-after 10s).",
);
await runSellerContactEnrichmentOnce(new Date(retryCreatedAt.getTime() + 31_000), retryRegistry);
retryStatus = await status(retryLead, retryRegistry, new Date(retryCreatedAt.getTime() + 31_001));
assert.equal(retryStatus.requests[0]?.status, "SUCCEEDED");
assert.equal(retryStatus.requests[0]?.attempts, 2);
await runSellerContactEnrichmentOnce(new Date(retryCreatedAt.getTime() + 60_000), retryRegistry);
assert.equal((await status(retryLead, retryRegistry)).requests[0]?.attempts, 2,
  "A duplicate worker callback cannot dispatch a terminal request again.");
const retryAfter = await db.select().from(leadsTable).where(eq(leadsTable.id, retryLead));
assert.equal(retryAfter[0]?.stage, "UNDER_CONTRACT");
assert.deepEqual(retryAfter[0]?.analysis, { synthetic: true, economicsVersion: 7, locked: true });
assert.deepEqual(retryAfter[0]?.underwriting, { synthetic: true, arv: 200000, repairs: 30000, wholesaleFee: 10000 });
assert.equal(retryAfter[0]?.nextAction, "Synthetic authorized transaction action must remain unchanged.");
assert.equal((await getSellerContactPaths(retryLead, nowAt())).directRouteStatus, "NEEDS_REVIEW");

// A timeout is persisted as UNKNOWN, then safely retried with the same idempotency
// key; no result is ever reported as delivered or confirmed while the call is in doubt.
const timeoutLead = await leadFixture("timeout recovery");
let timeoutCalls = 0;
const timeoutRegistry = createContactEnrichmentRegistry([adapter(
  "synthetic-timeout", "AVAILABLE_AND_EXERCISED",
  async () => {
    timeoutCalls++;
    if (timeoutCalls === 1) throw new Error("PROVIDER_TIMEOUT");
    return { outcome: "NO_RESULT", observations: [] };
  },
)]);
const timeoutCreatedAt = nowAt();
await request(timeoutLead, "timeout-recovery-request", timeoutRegistry, timeoutCreatedAt);
await runSellerContactEnrichmentOnce(new Date(timeoutCreatedAt.getTime() + 1_000), timeoutRegistry);
let timeoutStatus = await status(timeoutLead, timeoutRegistry, new Date(timeoutCreatedAt.getTime() + 1_001));
assert.equal(timeoutStatus.requests[0]?.status, "RETRY_WAIT");
assert.equal(timeoutStatus.requests[0]?.operationState, "UNKNOWN");
assert.equal(timeoutStatus.requests[0]?.attemptHistory.at(-1)?.state, "UNKNOWN");
await runSellerContactEnrichmentOnce(new Date(timeoutCreatedAt.getTime() + 31_000), timeoutRegistry);
timeoutStatus = await status(timeoutLead, timeoutRegistry, new Date(timeoutCreatedAt.getTime() + 31_001));
assert.equal(timeoutStatus.requests[0]?.status, "NO_RESULT");
assert.equal(timeoutStatus.requests[0]?.operationState, "CONFIRMED");
assert.equal(timeoutStatus.requests[0]?.attempts, 2);
assert.equal(timeoutCalls, 2);

// Provider authorization/configuration errors fail closed and are never retried.
const authFailureLead = await leadFixture("provider auth failure");
const authFailureRegistry = createContactEnrichmentRegistry([adapter(
  "synthetic-auth-failure", "AVAILABLE_AND_EXERCISED",
  async () => { throw new ContactProviderError("AUTH_REQUIRED", false); },
)]);
await request(authFailureLead, "auth-failure-request", authFailureRegistry, nowAt());
await runSellerContactEnrichmentOnce(nowAt(), authFailureRegistry);
const authFailureStatus = await status(authFailureLead, authFailureRegistry);
assert.equal(authFailureStatus.requests[0]?.status, "FAILED");
assert.equal(authFailureStatus.requests[0]?.attempts, 1);

const revokedTermsLead = await leadFixture("revoked provider terms");
const revokedTermsRegistry = createContactEnrichmentRegistry([adapter(
  "synthetic-revoked-terms", "AVAILABLE_AND_EXERCISED",
  async () => { throw new ContactProviderError("TERMS_CHANGED", false); },
)]);
await request(revokedTermsLead, "revoked-terms-request", revokedTermsRegistry, nowAt());
await runSellerContactEnrichmentOnce(nowAt(), revokedTermsRegistry);
const revokedTermsStatus = await status(revokedTermsLead, revokedTermsRegistry);
assert.equal(revokedTermsStatus.requests[0]?.status, "FAILED");
assert.equal(revokedTermsStatus.requests[0]?.attempts, 1,
  "A revoked/changed provider permission is terminal and is not retried.");

// Exhausted transient failures become a terminal FAILED request with no retry timer.
const failedLead = await leadFixture("retry exhausted");
let failedAttempts = 0;
const failedRegistry = createContactEnrichmentRegistry([adapter(
  "synthetic-exhausted", "AVAILABLE_AND_EXERCISED",
  async () => {
    failedAttempts++;
    throw new ContactProviderError("TEMPORARY_FAILURE", true);
  },
)]);
const failedCreatedAt = nowAt();
await request(failedLead, "exhausted-request", failedRegistry, failedCreatedAt);
await runSellerContactEnrichmentOnce(new Date(failedCreatedAt.getTime() + 1), failedRegistry);
await runSellerContactEnrichmentOnce(new Date(failedCreatedAt.getTime() + 30_001), failedRegistry);
await runSellerContactEnrichmentOnce(new Date(failedCreatedAt.getTime() + 90_001), failedRegistry);
const failedStatus = await status(failedLead, failedRegistry, new Date(failedCreatedAt.getTime() + 90_002));
assert.equal(failedStatus.requests[0]?.status, "FAILED");
assert.equal(failedStatus.requests[0]?.attempts, 3);
assert.equal(failedStatus.requests[0]?.nextAttemptAt, null);
assert.equal(failedAttempts, 3);
assert.equal((await getSellerContactPaths(failedLead, nowAt())).contactPaths.length, 0);

await assert.rejects(
  requestSellerContactEnrichment(
    successLead,
    { idempotencyKey: "unauthorized", channels: ["PHONE"] },
    { id: "synthetic-operator", role: "OPERATOR" },
    nowAt(),
    successRegistry,
  ),
  /role cannot perform this operation/i,
  "Operational contact enrichment is role-gated.",
);
const events = await db.select().from(auditTable);
assert.ok(events.some(event => event.action === "SELLER_CONTACT_ENRICHMENT_REQUESTED"));
assert.ok(events.some(event => event.action === "SELLER_CONTACT_ENRICHMENT_STARTED"));
assert.ok(events.some(event => event.action === "SELLER_CONTACT_ENRICHMENT_RETRY_SCHEDULED"));
const persistedRequests = await db.select().from(sellerContactEnrichmentRequestsTable);
assert.ok(persistedRequests.length >= 9, "Synthetic request rows and lifecycle states were persisted in the isolated database.");

console.log(
  `PASS SYNTHETIC persisted seller-contact provider exercise: ${persistedRequests.length} requests; actual production registry UNAVAILABLE; no-provider idempotency; unavailable/unexercised/policy/terms blocks; successful unreviewed evidence; no-result; stale result; duplicate route reconciliation plus recipient conflict; retry/backoff/recovery; role/audit and economics/stage/next-action preservation; no outreach.`,
);
