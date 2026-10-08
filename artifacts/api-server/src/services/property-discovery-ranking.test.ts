import assert from "node:assert/strict";
import test from "node:test";
import {
  comparePropertyDiscoveriesByRank,
  propertyDiscoveryRankingReasons,
} from "./property-discovery-ranking";

test("property ranking is deterministic across input order and uses score, recency, then stable ID", () => {
  const rows = [
    { id: "b", score: 20, updatedAt: "2026-10-08T10:00:00.000Z" },
    { id: "c", score: 25, updatedAt: "2026-10-07T10:00:00.000Z" },
    { id: "a", score: 20, updatedAt: "2026-10-08T10:00:00.000Z" },
  ];
  const first = [...rows].sort(comparePropertyDiscoveriesByRank).map(row => row.id);
  const second = [...rows].reverse().sort(comparePropertyDiscoveriesByRank).map(row => row.id);
  assert.deepEqual(first, ["c", "a", "b"]);
  assert.deepEqual(second, first);
});

test("ranking explanations preserve evidence classification and exclude hypotheses", () => {
  const reasons = propertyDiscoveryRankingReasons(18, [
    {
      id: "observed",
      key: "OPEN_CODE_VIOLATION",
      classification: "OBSERVED",
      statement: "A dated permit record is present.",
      source: "synthetic exercise only",
      confidence: 0.8,
      points: 8,
    },
    {
      id: "indicated",
      key: "SELLER_MOTIVATION",
      classification: "INDICATED",
      statement: "Seller-reported motivation needs confirmation.",
      source: "synthetic exercise only",
      confidence: 0.5,
      points: 3,
    },
    {
      id: "hypothesis",
      key: "VACANCY",
      classification: "AI_HYPOTHESIS",
      statement: "May be vacant.",
      source: "model hypothesis",
      confidence: 0.9,
      points: 0,
    },
  ]);
  assert.ok(reasons.some(reason => reason.includes("OBSERVED")));
  assert.ok(reasons.some(reason => reason.includes("INDICATED")));
  assert.ok(reasons.some(reason => reason.includes("AI_HYPOTHESIS") && reason.includes("zero ranking points")));
  assert.ok(!reasons.some(reason => reason.includes("AI_HYPOTHESIS VACANCY:")));
  assert.ok(!reasons.some(reason => reason.includes("VERIFIED VACANCY")));
});
