import assert from "node:assert/strict";
import test from "node:test";
import { rankPropertyAcquisitionQueue, type AcquisitionQueueRecord } from "./property-acquisition-queue";

const now = new Date("2026-10-15T12:00:00.000Z");
function item(overrides: Partial<AcquisitionQueueRecord> = {}): AcquisitionQueueRecord {
  return {
    id: "raw-a",
    status: "DISCOVERED_PROPERTY",
    score: 30,
    priorityScore: 30,
    confidence: 0.6,
    lastObservedAt: "2026-10-14T12:00:00.000Z",
    property: { address: "10 Example St", contactPaths: [] },
    sourceObservations: [{ sourceName: "Public property feed", lastObservedAt: "2026-10-14T12:00:00.000Z", classification: "OBSERVED" }],
    promotionBlockers: ["Human qualification is required."],
    missingInformation: [],
    nextAction: "Review source evidence and determine relevance.",
    leadId: null,
    ...overrides,
  };
}

test("queue ranking is deterministic, lexicographic, and uses stable address/ID tie-breaking", () => {
  const records = [
    item({ id: "z", property: { address: "Same St", contactPaths: [] } }),
    item({ id: "b", property: { address: "Same St", contactPaths: [] } }),
    item({ id: "qualified", status: "QUALIFIED_LEAD", score: 1 }),
  ];
  const first = rankPropertyAcquisitionQueue(records, now).map(record => record.id);
  const reversed = rankPropertyAcquisitionQueue([...records].reverse(), now).map(record => record.id);
  assert.deepEqual(first, ["qualified", "b", "z"]);
  assert.deepEqual(reversed, first);
});

test("stale source evidence gets an explicit refresh task and ranks behind equally qualified fresh evidence", () => {
  const fresh = item({ id: "fresh", status: "QUALIFIED_LEAD" });
  const stale = item({
    id: "stale",
    status: "QUALIFIED_LEAD",
    sourceObservations: [{ sourceName: "Old record", lastObservedAt: "2026-08-01T12:00:00.000Z", classification: "OBSERVED" }],
  });
  const ranked = rankPropertyAcquisitionQueue([stale, fresh], now);
  assert.deepEqual(ranked.map(record => record.id), ["fresh", "stale"]);
  assert.ok(ranked[1]!.acquisitionPriority.tasks.some(task => /Refresh stale source evidence/.test(task)));
});

test("missing seller contact and source evidence become actionable tasks", () => {
  const missing = item({ id: "missing", sourceObservations: [] });
  const [ranked] = rankPropertyAcquisitionQueue([missing], now);
  assert.ok(ranked!.acquisitionPriority.tasks.some(task => /permitted direct seller contact route/.test(task)));
  assert.ok(ranked!.acquisitionPriority.tasks.some(task => /no source observation is linked/.test(task)));
});

test("raw observations are never promoted and ranking does not mutate deal economics", () => {
  const raw = {
    ...item({
    status: "DISCOVERED_PROPERTY",
    leadId: null,
    promotionBlockers: ["Two independent evidence groups are required."],
    }),
    economics: { arv: 210_000, repairs: 40_000, mao: 100_000, assignmentFee: 15_000 },
  };
  const before = structuredClone(raw);
  const ranked = rankPropertyAcquisitionQueue([raw], now);
  assert.equal(ranked[0]!.status, "DISCOVERED_PROPERTY");
  assert.equal(ranked[0]!.leadId, null);
  assert.deepEqual(ranked[0]!.economics, before.economics);
  assert.deepEqual(raw, before);
  assert.match(ranked[0]!.acquisitionPriority.explanation, /not a claim of seller motivation or profit/);
});

test("underwriting classification can rank viability but dollar economics do not affect the queue", () => {
  const record = item({ id: "economic", status: "QUALIFIED_LEAD" });
  const first = rankPropertyAcquisitionQueue([record], now, () => "UNKNOWN")[0]!;
  const withEconomics = {
    ...record, economics: { arv: 9999999, repairs: 0, mao: 9999999 },
  };
  const second = rankPropertyAcquisitionQueue([withEconomics], now, () => "UNKNOWN")[0]!;
  assert.equal(first.acquisitionPriority.viability, "UNKNOWN");
  assert.equal(first.acquisitionPriority.rank, second.acquisitionPriority.rank);
  assert.equal(first.acquisitionPriority.explanation, second.acquisitionPriority.explanation);
});
