import test from "node:test";
import assert from "node:assert/strict";
import { buildDealTimeline, type DealTimelineEvent } from "./deal-timeline";

const event = (id: string, at: string, category: DealTimelineEvent["category"] = "SELLER"): DealTimelineEvent => ({
  id, at, category, title: id, detail: "redacted safe summary", evidence: "Evidence reference: source record",
});

test("timeline is newest-first, stable for tied timestamps, and ignores invalid dates", () => {
  const result = buildDealTimeline([
    event("later", "2026-10-15T10:00:00Z"), event("tie-b", "2026-10-15T09:00:00Z"),
    event("tie-a", "2026-10-15T09:00:00Z"), event("bad", "unknown"),
  ]);
  assert.deepEqual(result.map(item => item.id), ["later", "tie-a", "tie-b"]);
});

test("source event identity makes retries idempotent; first persisted event wins", () => {
  const original = event("call:source-id", "2026-10-15T10:00:00Z");
  const replay = { ...original, detail: "button click does not create a second persisted call" };
  const result = buildDealTimeline([original, replay]);
  assert.deepEqual(result, [original]);
});

test("category filter returns only matching persisted event types", () => {
  const result = buildDealTimeline([
    event("call:1", "2026-10-15T10:00:00Z", "SELLER"),
    event("milestone:1", "2026-10-15T11:00:00Z", "TRANSACTION"),
  ], "TRANSACTION");
  assert.deepEqual(result.map(item => item.id), ["milestone:1"]);
});

test("missing evidence is explicit and no synthetic completion is inferred", () => {
  const missing = { ...event("outcome:1", "2026-10-15T10:00:00Z", "CLOSING"), evidence: "Evidence reference: not recorded" };
  assert.equal(buildDealTimeline([missing])[0]?.evidence, "Evidence reference: not recorded");
});
