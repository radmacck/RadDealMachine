import test from "node:test";
import assert from "node:assert/strict";
import {
  acquisitionEvidenceScore,
  compareAcquisitionQueue,
  contactBlockerCode,
} from "./acquisition-queue";

const now = new Date("2026-10-08T12:00:00.000Z");

test("queue score ignores hypotheses and future or malformed evidence", () => {
  assert.equal(acquisitionEvidenceScore([
    { classification: "VERIFIED", scoreContribution: 24, capturedAt: "2026-10-01T00:00:00Z" },
    { classification: "INDICATED", scoreContribution: 18, capturedAt: "2026-10-02T00:00:00Z" },
    { classification: "AI_HYPOTHESIS", scoreContribution: 100, capturedAt: "2026-10-03T00:00:00Z" },
    { classification: "OBSERVED", scoreContribution: 80, capturedAt: "2026-10-09T00:00:00Z" },
    { classification: "OBSERVED", scoreContribution: 40, capturedAt: "not-a-date" },
  ], now), 42);
});

test("queue ranking is stable and places callable opportunities before blocked ones", () => {
  const items = [
    { decision: "BLOCKED" as const, evidenceScore: 90, followUpAt: null, createdAt: "2026-10-01", id: "blocked" },
    { decision: "CALL_NEXT" as const, evidenceScore: 40, followUpAt: null, createdAt: "2026-10-01", id: "b" },
    { decision: "CALL_NEXT" as const, evidenceScore: 40, followUpAt: null, createdAt: "2026-10-01", id: "a" },
    { decision: "CALL_NEXT" as const, evidenceScore: 20, followUpAt: "2026-10-07", createdAt: "2026-10-01", id: "due" },
  ];
  const sort = () => [...items].sort(compareAcquisitionQueue).map(item => item.id);
  assert.deepEqual(sort(), ["a", "b", "due", "blocked"]);
  assert.deepEqual(sort(), sort());
});

test("contact route states map to one fail-closed queue blocker", () => {
  assert.equal(contactBlockerCode("PHONE_ROUTE_AVAILABLE"), null);
  assert.equal(contactBlockerCode("POSTAL_ONLY"), "CONTACT_NO_DIRECT_ROUTE");
  assert.equal(contactBlockerCode("NO_DIRECT_ROUTE"), "CONTACT_NO_DIRECT_ROUTE");
  assert.equal(contactBlockerCode("STALE_ROUTE"), "CONTACT_STALE");
  assert.equal(contactBlockerCode("CONFLICTING_ROUTE"), "CONTACT_CONFLICT");
  assert.equal(contactBlockerCode("NEEDS_REVIEW"), "CONTACT_REVIEW");
});
