import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { extractListingDescriptionIntelligence } from "./listing-description-intelligence";

const now = new Date("2026-10-08T15:00:00.000Z");
const base = {
  sourceName: "SYNTHETIC permitted-listing adapter",
  sourceRecordId: randomUUID(),
  sourceUrl: "https://example.invalid/synthetic-listing/record-1",
  capturedAt: "2026-10-08T14:00:00.000Z",
  description: "SYNTHETIC listing remarks: roof leaks, motivated seller, new windows, finished basement; investor special.",
  retentionPolicy: "FULL_TEXT_PERMITTED" as const,
};

test("listing extraction preserves permitted-source provenance and leaves claims indicated", () => {
  const result = extractListingDescriptionIntelligence(base, now);
  assert.equal(result.status, "EXTRACTED");
  assert.ok(result.intelligence.some(item => item.category === "listing_description" && item.statement === base.description));
  assert.ok(result.intelligence.some(item => item.category === "condition_roof" && item.classification === "INDICATED"));
  assert.ok(result.intelligence.some(item => item.category === "listing_motivation_claim" && item.classification === "INDICATED"));
  assert.ok(result.intelligence.some(item => item.category === "listing_upgrade_claim" && item.classification === "INDICATED"));
  assert.ok(result.intelligence.some(item => item.category === "listing_feature_claim" && item.classification === "INDICATED"));
  assert.ok(result.intelligence.some(item => item.category === "listing_marketing_hypothesis" && item.classification === "AI_HYPOTHESIS"));
  assert.ok(result.intelligence.every(item =>
    item.sourceRecordId === base.sourceRecordId && item.sourceUrl === base.sourceUrl && item.capturedAt === base.capturedAt));
  assert.ok(result.relevanceSignals.every(signal => signal.classification === "INDICATED"));
  assert.equal(result.relevanceSignals.filter(signal => signal.group === "CONDITION").length, 1,
    "Several condition phrases in one listing must not masquerade as independent source corroboration.");
  assert.ok(result.intelligence.some(item => item.question?.includes("roof condition")),
    "Extracted marketing text becomes a question for the operator, not a property fact.");
});

test("hash-only retention stores a digest and derived phrases, never raw remarks", () => {
  const description = "SYNTHETIC remarks say fixer-upper and quick close.";
  const digest = createHash("sha256").update(description).digest("hex");
  const result = extractListingDescriptionIntelligence({
    ...base, description, retentionPolicy: "HASH_ONLY", contentDigest: digest,
  }, now);
  assert.equal(result.status, "EXTRACTED");
  assert.equal(result.contentDigest, digest);
  assert.ok(result.intelligence.some(item => item.category === "listing_description_digest" && item.statement.includes(digest)));
  assert.ok(result.intelligence.every(item => !item.statement.includes(description)));
  assert.ok(result.intelligence.some(item => item.classification === "AI_HYPOTHESIS"));
});

test("stale and source-prohibited listing remarks fail closed without extracted claims", () => {
  const stale = extractListingDescriptionIntelligence({
    ...base, capturedAt: "2026-08-01T00:00:00.000Z",
  }, now);
  assert.equal(stale.status, "STALE_SOURCE");
  assert.deepEqual(stale.intelligence, []);

  const blocked = extractListingDescriptionIntelligence({
    ...base, retentionPolicy: "NOT_PERMITTED",
  }, now);
  assert.equal(blocked.status, "BLOCKED_BY_RETENTION");
  assert.deepEqual(blocked.intelligence, []);
});

test("hash-only policy requires a digest and non-HTTPS references are rejected", () => {
  assert.throws(() => extractListingDescriptionIntelligence({
    ...base, retentionPolicy: "HASH_ONLY",
  }, now), /SHA-256/);
  assert.throws(() => extractListingDescriptionIntelligence({
    ...base, sourceUrl: "http://example.invalid/remarks",
  }, now), /HTTPS/);
});
