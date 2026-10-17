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
  assert.equal(result.engineVersion, "deterministic-underwriting/1.2");
  assert.equal(result.maximumApprovedAcquisitionPrice, null);
  policy.assignmentTarget = 0;
  assert.equal(result.mao, 147250, "Saved analysis is an immutable calculation snapshot.");
  assert.equal(result.assumptions.assignmentTarget, 15000);
});

test("each cost component moves MAO by the documented amount while margin changes classification only", () => {
  const policy = structuredClone(DEFAULT_ASSUMPTIONS);
  const baseline = analyzeDeal(lead, input, policy, now);
  const recalculate = (override: Partial<typeof policy>) =>
    analyzeDeal(lead, input, { ...policy, ...override }, now);

  assert.equal(recalculate({ acquisitionCost: policy.acquisitionCost + 500 }).mao, baseline.mao - 500);
  assert.equal(recalculate({ holdingMonthly: policy.holdingMonthly + 100 }).mao,
    baseline.mao - 100 * policy.holdingMonths);
  assert.equal(recalculate({ assignmentTarget: policy.assignmentTarget + 1_000 }).mao, baseline.mao - 1_000);
  assert.equal(recalculate({ sellingCostPct: policy.sellingCostPct + 0.01 }).mao,
    baseline.mao - baseline.arv.low * 0.01);
  assert.equal(recalculate({ contingencyPct: policy.contingencyPct + 0.1 }).mao,
    baseline.mao - input.repairs[0]!.high * 0.1);
  assert.equal(recalculate({ arvMultiplier: policy.arvMultiplier + 0.01 }).mao,
    baseline.mao + baseline.arv.low * 0.01);

  const strongBoundary = analyzeDeal({ ...lead, askingPrice: baseline.mao - policy.strongMargin }, input, policy, now);
  const aboveStrongBoundary = analyzeDeal({ ...lead, askingPrice: baseline.mao - policy.strongMargin + 0.01 }, input, policy, now);
  assert.equal(strongBoundary.classification, "STRONG", "The configured strong-margin boundary is inclusive.");
  assert.equal(aboveStrongBoundary.classification, "NEGOTIABLE");
  const largerMargin = recalculate({ strongMargin: policy.strongMargin + 1_000 });
  assert.equal(largerMargin.mao, baseline.mao, "Margin is a classification rule, not an extra cost or MAO deduction.");
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

test("comparable filters include exact configured boundaries and reject values just beyond them", () => {
  const boundaryNow = new Date("2026-10-14T00:00:00.000Z");
  const onBoundary = analyzeDeal(lead, {
    ...input,
    comps: [
      comp("age", 290000, "2026-04-17"),
      {...comp("distance", 300000), distanceMiles: 1},
      {...comp("size", 310000), sqft: 1200},
    ],
  }, DEFAULT_ASSUMPTIONS, boundaryNow);
  assert.ok(onBoundary.compDecisions.every(item => item.included),
    "max age, distance and size tolerance are inclusive boundaries");

  const outside = analyzeDeal(lead, {
    ...input,
    comps: [
      comp("age-outside", 290000, "2026-04-16"),
      {...comp("distance-outside", 300000), distanceMiles: 1.0001},
      {...comp("size-outside", 310000), sqft: 1201},
    ],
  }, DEFAULT_ASSUMPTIONS, boundaryNow);
  assert.ok(outside.compDecisions.every(item => !item.included));
  assert.ok(outside.blockers.some(item => /eligible, verified, renovated comps/i.test(item)));
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
