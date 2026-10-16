import test from "node:test";
import assert from "node:assert/strict";
import type { Lead, UnderwritingInput } from "./types";
import { analyzeDeal, DEFAULT_ASSUMPTIONS } from "./underwriting";

const now = new Date("2026-10-14T12:00:00.000Z");
const lead: Lead = {
  id: "00000000-0000-4000-8000-000000000017",
  address: "SYNTHETIC SUBJECT 100 TEST STREET",
  city: "Philadelphia",
  state: "PA",
  county: "Philadelphia County",
  zip: "19100",
  propertyType: "SINGLE_FAMILY",
  sqft: 1000,
  beds: 3,
  baths: 2,
  units: 1,
  askingPrice: 100000,
  sellerName: "SYNTHETIC ONLY",
  sellerPhone: "000-000-0000",
  source: "SYNTHETIC underwriting test",
  urgency: "MEDIUM",
  stage: "ANALYZED",
  version: 1,
  nextAction: "Synthetic test only.",
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  followUpAt: null,
};

const comp = (id: string, salePrice: number, soldAt = "2026-09-30") => ({
  id,
  address: `SYNTHETIC COMP ${id} TEST ROAD`,
  salePrice,
  sqft: 1000,
  soldAt,
  distanceMiles: 0.5,
  propertyType: "SINGLE_FAMILY",
  condition: "RENOVATED" as const,
  source: "SYNTHETIC verified fixture",
  verified: true,
});

const input: UnderwritingInput = {
  version: 1,
  comps: [comp("a", 290000), comp("b", 300000), comp("c", 310000)],
  repairs: [{
    category: "Synthetic repair scope",
    low: 10000,
    expected: 12000,
    high: 15000,
    confidence: 0.8,
    source: "SYNTHETIC inspection fixture",
  }],
  repairsComplete: true,
  conditionConfirmed: true,
};

test("underwriting formula is deterministic and never grants offer authority", () => {
  const policy = structuredClone(DEFAULT_ASSUMPTIONS);
  const result = analyzeDeal(lead, input, policy, now);
  const costs = policy.acquisitionCost + policy.holdingMonthly * policy.holdingMonths;
  const buyerCeiling = result.arv.low * policy.arvMultiplier -
    result.arv.low * policy.sellingCostPct -
    result.repairs.high * (1 + policy.contingencyPct) - costs;

  assert.equal(result.arv.low, 290000);
  assert.equal(result.arv.expected, 300000);
  assert.equal(result.arv.high, 310000);
  assert.equal(result.mao, Math.max(0, Math.round((buyerCeiling - policy.assignmentTarget) * 100) / 100));
  assert.equal(result.mao, 147250);
  assert.equal(result.classification, "STRONG");
  assert.equal(result.maximumApprovedAcquisitionPrice, null);
  policy.assignmentTarget = 0;
  assert.equal(result.mao, 147250, "Saved analysis is an immutable calculation snapshot.");
  assert.equal(result.assumptions.assignmentTarget, 15000);
});

test("stale and contradictory comps fail the configured evidence threshold", () => {
  const stale = analyzeDeal(lead, {
    ...input,
    comps: input.comps.map(c => ({ ...c, soldAt: "2025-01-01" })),
  }, DEFAULT_ASSUMPTIONS, now);
  assert.ok(stale.blockers.some(item => /eligible, verified, renovated comps/i.test(item)));
  assert.equal(stale.classification, "INCOMPLETE");

  const policy = { ...DEFAULT_ASSUMPTIONS, minComps: 3 };
  const contradictory = analyzeDeal(lead, {
    ...input,
    comps: [...input.comps, comp("outlier", 700000)],
  }, policy, now);
  assert.ok(contradictory.compDecisions.find(decision => decision.id === "outlier")?.reasons
    .some(reason => /differs >30%/i.test(reason)));
  assert.ok(contradictory.blockers.some(item => /material price\/sqft conflict/i.test(item)));
  assert.equal(contradictory.maximumApprovedAcquisitionPrice, null);
});

test("non-positive conservative economics floor at zero and cannot be used as authority", () => {
  const result = analyzeDeal(lead, input, {
    ...DEFAULT_ASSUMPTIONS,
    assignmentTarget: 1_000_000,
  }, now);
  assert.equal(result.mao, 0);
  assert.equal(result.classification, "PASS");
  assert.equal(result.maximumApprovedAcquisitionPrice, null);
});
