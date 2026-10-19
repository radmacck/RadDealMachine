import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, jobsTable, leadsTable, propertyDiscoveriesTable, propertySourceObservationsTable } from "@workspace/db";
import { GetPropertySourceCoverageResponse } from "@workspace/api-zod";
import { getPropertySourceCoverage } from "./property-source-store";
import { recordPropertyObservation } from "./property-discovery-store";
import { PROPERTY_SOURCE_POLICY_VERSION } from "./property-source-connectors";

const now = new Date("2026-10-16T12:00:00.000Z");
const actor = "SYNTHETIC source coverage exercise";
const getOpa = async (at: Date) => GetPropertySourceCoverageResponse.parse(await getPropertySourceCoverage(at))
  .operations.find(source => source.id === "phila-opa")!;
const base = {
  kind: "DISCOVER_PROPERTIES", leadId: null, requestedBy: actor, attempts: 1,
  payload: { termsReviewed: true, sourcePolicyVersion: PROPERTY_SOURCE_POLICY_VERSION, recurringPropertyDiscovery: true },
};

const never = await getOpa(now);
assert.equal(never.enabled, true);
assert.equal(never.state, "ENABLED_NOT_RUN");
assert.equal(never.lastSuccessfulAt, null);
assert.equal(never.resultCount, null, "No execution evidence is not a zero-result refresh.");
assert.equal(never.freshness, "NEVER_RUN");
assert.match(never.manualNextStep, /no source refresh is claimed/i);
assert.ok((await GetPropertySourceCoverageResponse.parse(await getPropertySourceCoverage(now))).notConnectedProviders
  .every(provider => provider.status === "NOT_CONNECTED"));

const successAt = new Date(now.getTime() - 60 * 60_000);
await db.insert(jobsTable).values({
  ...base, state: "SUCCEEDED", idempotencyKey: `${actor}:success`,
  message: "Registered discovery connector results: phila-opa: 4 property record(s), 2 unmatched observation(s). All registered source operations completed.",
  createdAt: successAt, updatedAt: successAt,
});
const success = await getOpa(now);
assert.equal(success.state, "SUCCEEDED");
assert.equal(success.termsStatus, "REVIEWED_AT_QUEUE");
assert.equal(success.resultCount, 6);
assert.equal(success.lastSuccessfulAt, successAt.toISOString());
assert.equal(success.freshness, "CURRENT");
assert.ok(success.nextEligibleAt, "Recurring source opt-in shows only the next eligibility boundary, not a claimed queued run.");
assert.match(success.resultCountBasis, /not qualified leads/i);

const failureAt = new Date(now.getTime() + 60_000);
await db.insert(jobsTable).values({
  ...base, state: "PARTIAL", idempotencyKey: `${actor}:rate-limited`,
  message: "Registered discovery connector results: phila-opa: 4 property record(s), 2 unmatched observation(s). Source-specific partial failures (1): phila-opa/DISCOVER: HTTP 429 rate limit exceeded.",
  createdAt: failureAt, updatedAt: failureAt,
});
const limited = await getOpa(new Date(now.getTime() + 120_000));
assert.equal(limited.state, "RATE_LIMITED");
assert.match(limited.error ?? "", /429/);
assert.equal(limited.lastSuccessfulAt, successAt.toISOString(), "A rate-limited attempt does not replace the last successful check.");
assert.match(limited.manualNextStep, /wait.*retry window/i);
const stale = await getOpa(new Date(now.getTime() + 8 * 60 * 60_000));
assert.equal(stale.freshness, "STALE");
assert.equal(stale.state, "RATE_LIMITED", "An error remains visible even when the last success is stale.");

await db.insert(jobsTable).values({
  ...base, payload: { ...base.payload, recurringPropertyDiscovery: false },
  state: "SUCCEEDED", idempotencyKey: `${actor}:no-source-evidence`,
  message: "Other connector completed. No source-specific result was recorded.",
  createdAt: new Date(now.getTime() + 3 * 60_000), updatedAt: new Date(now.getTime() + 3 * 60_000),
});
const noEvidence = await getOpa(new Date(now.getTime() + 4 * 60_000));
assert.equal(noEvidence.lastAttemptAt, failureAt.toISOString());
assert.equal(noEvidence.resultCount, 6);
assert.equal(noEvidence.nextEligibleAt, null, "A later explicit recurrence opt-out must not inherit an older schedule.");
const property = {
  id: "SYNTHETIC-COVERAGE-PARCEL", parcelId: "SYNTHETIC-COVERAGE-PARCEL", provider: "SYNTHETIC_SOURCE",
  classification: "OBSERVED", address: "100 SYNTHETIC COVERAGE ST", city: "Philadelphia",
  county: "Philadelphia", state: "PA", zip: "19103", propertyType: "SINGLE_FAMILY",
  sqft: 1200, beds: 3, baths: 2, units: 1, recordedOwner: null, entityCandidate: false,
  assessedValue: null, lastSalePrice: null, lastSaleAt: null, interiorCondition: null,
  exteriorCondition: null, lat: null, lng: null, contactPaths: [],
  sourceUrl: "https://example.invalid/synthetic-coverage", capturedAt: now.toISOString(),
} as Parameters<typeof recordPropertyObservation>[0];
const firstObservation = await recordPropertyObservation(property, "synthetic-coverage:parcel", actor, now);
assert.match(firstObservation.reason, /Identity basis: exact parcel identifier/i);
const duplicateObservation = await recordPropertyObservation(
  { ...property, capturedAt: new Date(now.getTime() + 60_000).toISOString() },
  "synthetic-coverage:parcel", actor, new Date(now.getTime() + 60_000),
);
assert.equal(firstObservation.id, duplicateObservation.id, "Duplicate source ingestion retains one discovery identity.");
assert.equal(duplicateObservation.leadId, null, "Raw source observations remain distinct from active seller leads.");
const secondFeed = await recordPropertyObservation({
  ...property, id: "SYNTHETIC-COVERAGE-SECOND-SOURCE", provider: "SYNTHETIC_SECOND_FEED",
  address: "100 synthetic coverage street.", sourceUrl: "https://example.invalid/synthetic-second-feed",
}, "synthetic-second-feed:parcel", actor, new Date(now.getTime() + 120_000));
assert.equal(secondFeed.id, firstObservation.id, "A second feed for the exact parcel merges into the same normalized discovery.");
const sourceTrail = await db.select().from(propertySourceObservationsTable)
  .where(eq(propertySourceObservationsTable.discoveryId, firstObservation.id));
assert.deepEqual(new Set(sourceTrail.map(row => row.sourceKey)), new Set([
  "synthetic-coverage:parcel", "synthetic-second-feed:parcel",
]), "Property deduplication must retain provenance from each independent source feed.");
const fallbackIdentity = await recordPropertyObservation({
  ...property, id: "SYNTHETIC-COVERAGE-ADDRESS-ONE", parcelId: "",
  address: "200 Synthetic Avenue", sourceUrl: "https://example.invalid/address-one",
}, "synthetic-address-feed:one", actor, new Date(now.getTime() + 180_000));
assert.match(fallbackIdentity.reason, /normalized address fallback; this is not a parcel-confirmed identity/i);
const normalizedAddressDuplicate = await recordPropertyObservation({
  ...property, id: "SYNTHETIC-COVERAGE-ADDRESS-TWO", parcelId: "",
  address: "200 synthetic avenue.", zip: "19103-1234", sourceUrl: "https://example.invalid/address-two",
}, "synthetic-address-feed:two", actor, new Date(now.getTime() + 240_000));
assert.equal(normalizedAddressDuplicate.id, fallbackIdentity.id,
  "Address fallback identity normalizes case, punctuation, and ZIP+4 without merging different street numbers.");
const differentStreetNumber = await recordPropertyObservation({
  ...property, id: "SYNTHETIC-COVERAGE-ADDRESS-DIFFERENT-NUMBER", parcelId: "",
  address: "202 Synthetic Avenue", sourceUrl: "https://example.invalid/address-different-number",
}, "synthetic-address-feed:different-number", actor, new Date(now.getTime() + 270_000));
assert.notEqual(differentStreetNumber.id, fallbackIdentity.id,
  "Distinct street numbers remain separate address-fallback discoveries.");
const addressObservationsBeforeConflict = (await db.select().from(propertySourceObservationsTable)
  .where(eq(propertySourceObservationsTable.discoveryId, fallbackIdentity.id))).length;
await assert.rejects(recordPropertyObservation({
  ...property, id: "SYNTHETIC-COVERAGE-ADDRESS-CONFLICT", parcelId: "",
  address: "200 Synthetic Avenue", propertyType: "TOWNHOUSE", sqft: 2400,
  sourceUrl: "https://example.invalid/address-conflict",
}, "synthetic-address-feed:conflict", actor, new Date(now.getTime() + 300_000)),
/conflicting property attributes/i, "A normalized-address match must not silently merge materially conflicting property attributes.");
assert.equal((await db.select().from(propertySourceObservationsTable)
  .where(eq(propertySourceObservationsTable.discoveryId, fallbackIdentity.id))).length, addressObservationsBeforeConflict,
"A rejected conflicting address match must not attach an observation to the existing discovery.");
await assert.rejects(recordPropertyObservation({
  ...property, id: "SYNTHETIC-COVERAGE-INCOMPLETE", parcelId: "",
  address: "   ", city: "", sourceUrl: "https://example.invalid/incomplete-address",
}, "synthetic-address-feed:incomplete", actor, new Date(now.getTime() + 360_000)),
/exact parcel or a complete address/i, "Incomplete identity fields must not generate a shared fallback match key.");
assert.equal((await db.select().from(propertyDiscoveriesTable)).length, 3);
assert.equal((await db.select().from(leadsTable)).length, 0, "Coverage reporting never promotes raw observations to active leads.");
console.log("PASS SYNTHETIC persisted source coverage: no false check/zero, terms version, exact connector counts, rate limits, stale data, schedule eligibility and raw/lead separation.");
