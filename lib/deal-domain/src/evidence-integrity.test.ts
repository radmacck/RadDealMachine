import test from "node:test";
import assert from "node:assert/strict";
import {
  assessEvidenceConfidence, classifyEvidenceFreshness, conflictingEvidence, evidenceResolutionAction, type EvidenceRecord,
} from "./evidence-integrity";

const now = new Date("2026-10-14T12:00:00.000Z");
const evidence = (overrides: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  ref: "source:1", factKey: "seller.phone", value: "5550100", source: "permitted source",
  evidenceRef: "record:1", observedAt: "2026-10-14T11:00:00.000Z", evidenceClass: "OBSERVED",
  ...overrides,
});

test("freshness treats exact expiry and max-age boundaries as stale; future and missing provenance stay unknown", () => {
  assert.equal(classifyEvidenceFreshness(evidence({ validUntil: now.toISOString() }), now), "STALE");
  assert.equal(classifyEvidenceFreshness(evidence({ observedAt: new Date(now.getTime() - 1000).toISOString() }), now, 1000), "STALE");
  assert.equal(classifyEvidenceFreshness(evidence({ observedAt: new Date(now.getTime() + 1).toISOString() }), now), "UNKNOWN");
  assert.equal(classifyEvidenceFreshness(evidence({ source: null, evidenceRef: null }), now), "UNKNOWN");
  assert.equal(classifyEvidenceFreshness(evidence(), now), "CURRENT");
});

test("conflicting sources remain individually addressable and produce a re-verification resolution step", () => {
  const first = evidence();
  const second = evidence({ ref: "source:2", evidenceRef: "record:2", value: "5550199", evidenceClass: "SELLER_REPORTED" });
  const conflict = conflictingEvidence([first, second]);
  assert.deepEqual(conflict.map(item => item.ref), ["source:1", "source:2"]);
  assert.equal(evidenceResolutionAction(0, conflict.length, 0),
    "Reconcile conflicting source records and save a dated reviewer resolution; retain all prior evidence.");
  assert.equal(evidenceResolutionAction(1, 0, 0),
    "Re-verify expired evidence from a permitted current source before relying on it.");
});

test("reverification action reports missing provenance before stale or current evidence can be relied on", () => {
  assert.match(evidenceResolutionAction(0, 0, 1) ?? "", /Attach a source, evidence reference, and observed time/);
  assert.equal(evidenceResolutionAction(0, 0, 0), null);
});

test("confidence is retained as unknown or compared only against an explicit policy threshold", () => {
  assert.equal(assessEvidenceConfidence(undefined,0.65),"UNKNOWN");
  assert.equal(assessEvidenceConfidence(0.64,0.65),"BELOW_THRESHOLD");
  assert.equal(assessEvidenceConfidence(0.65,0.65),"ACCEPTED");
});
