import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PROPERTY_QUALIFICATION_CRITERIA,
  evaluatePropertyRelevance,
  type PropertyRelevanceSignal,
} from "./lead-qualification";

const signal = (key: PropertyRelevanceSignal["key"], group: PropertyRelevanceSignal["group"],
  classification: PropertyRelevanceSignal["classification"] = "OBSERVED",
  confidence = 0.9): PropertyRelevanceSignal => ({
  id: `${key.toLowerCase()}-${classification.toLowerCase()}`,
  key, group, classification, sourceType: "PUBLIC_RECORD", confidence,
  statement: `${key} evidence recorded for synthetic property`,
  source: "Synthetic exercise source",
  sourceUrl: "https://example.com/evidence",
  evidenceRef: `${key}:${classification}`,
  capturedAt: "2026-10-05T12:00:00.000Z",
});

test("a property record with no relevance signals remains a discovery, not a lead", () => {
  const result = evaluatePropertyRelevance([], DEFAULT_PROPERTY_QUALIFICATION_CRITERIA);
  assert.equal(result.status, "DISCOVERED_PROPERTY");
  assert.equal(result.score, 0);
  assert.equal(result.canPromote, false);
  assert.match(result.reason, /public property record by itself is not a lead/i);
});

test("weak or ownership-only evidence stays out of the active acquisition workflow", () => {
  const oneWeak = evaluatePropertyRelevance([
    signal("ENTITY_OWNER", "OWNERSHIP_CONTEXT", "INDICATED", 0.55),
  ], DEFAULT_PROPERTY_QUALIFICATION_CRITERIA);
  assert.equal(oneWeak.status, "DISCOVERED_PROPERTY");
  assert.equal(oneWeak.canPromote, false);

  const possibleCandidate = evaluatePropertyRelevance([
    signal("ENTITY_OWNER", "OWNERSHIP_CONTEXT", "INDICATED", 0.9),
    signal("LONG_TERM_HOLD", "OWNERSHIP_CONTEXT", "INDICATED", 0.9),
  ], DEFAULT_PROPERTY_QUALIFICATION_CRITERIA);
  assert.equal(possibleCandidate.status, "RELEVANT_CANDIDATE");
  assert.equal(possibleCandidate.canPromote, false);
  assert.ok(possibleCandidate.promotionBlockers.some((item) => /motivation|distress|listing-pressure|vacancy/i.test(item)));
});

test("two sourced acquisition signals plus independent support can qualify a lead", () => {
  const result = evaluatePropertyRelevance([
    signal("SELLER_MOTIVATION", "MOTIVATION", "VERIFIED", 0.95),
    signal("REPORTED_POOR_CONDITION", "CONDITION", "OBSERVED", 0.9),
    signal("TAX_DELINQUENCY", "DISTRESS", "OBSERVED", 0.85),
  ], DEFAULT_PROPERTY_QUALIFICATION_CRITERIA);
  assert.equal(result.status, "RELEVANT_CANDIDATE");
  assert.equal(result.canPromote, true);
  assert.equal(result.score, 66);
  assert.equal(result.scoredSignals.length, 3);
});

test("repeated references do not multiply score or count as independent evidence", () => {
  const first = { ...signal("SELLER_MOTIVATION", "MOTIVATION"), evidenceRef: "same-record:1" };
  const duplicate = { ...first, id: "duplicate-entry" };
  const sameSourceSecondSignal = {
    ...signal("TAX_DELINQUENCY", "DISTRESS"),
    evidenceRef: "same-record:1",
  };
  const result = evaluatePropertyRelevance(
    [first, duplicate, sameSourceSecondSignal],
    DEFAULT_PROPERTY_QUALIFICATION_CRITERIA,
  );
  assert.equal(result.score, 50);
  assert.equal(result.canPromote, false);
  assert.ok(result.promotionBlockers.some((item) => /independent signal groups/i.test(item)));
});

test("AI hypotheses never add qualification points or independently satisfy lead gates", () => {
  const result = evaluatePropertyRelevance([
    signal("SELLER_MOTIVATION", "MOTIVATION", "AI_HYPOTHESIS", 1),
    signal("TAX_DELINQUENCY", "DISTRESS", "AI_HYPOTHESIS", 1),
  ], DEFAULT_PROPERTY_QUALIFICATION_CRITERIA);
  assert.equal(result.score, 0);
  assert.equal(result.canPromote, false);
  assert.ok(result.missingInformation.some((item) => /AI hypotheses.*add no qualification points/i.test(item)));
});

test("market-specific thresholds and disabled weights change scores deterministically", () => {
  const criteria = {
    ...DEFAULT_PROPERTY_QUALIFICATION_CRITERIA,
    marketKey: "TEST_MARKET",
    candidateThreshold: 100,
    signalRules: DEFAULT_PROPERTY_QUALIFICATION_CRITERIA.signalRules.map((rule) =>
      rule.key === "ENTITY_OWNER" ? { ...rule, enabled: false } : rule),
  };
  const result = evaluatePropertyRelevance([
    signal("ENTITY_OWNER", "OWNERSHIP_CONTEXT", "VERIFIED", 1),
    signal("LONG_TERM_HOLD", "OWNERSHIP_CONTEXT", "OBSERVED", 0.8),
  ], criteria);
  assert.equal(result.score, 5);
  assert.equal(result.status, "DISCOVERED_PROPERTY");
});
