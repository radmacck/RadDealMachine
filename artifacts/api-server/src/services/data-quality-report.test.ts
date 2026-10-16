import assert from "node:assert/strict";
import test from "node:test";
import { buildDataQualityReport, type QualityRecord } from "./data-quality-report";

const now = new Date("2026-10-15T12:00:00.000Z");
const records: QualityRecord[] = [
  { id: "p1", entity: "PROPERTY", identityKey: "123 MAIN ST", provenanceRefs: ["deed:1"] },
  { id: "p2", entity: "PROPERTY", identityKey: "123 main st", provenanceRefs: ["listing:2"] },
  { id: "l1", entity: "LEAD", identityKey: "123 main st", provenanceRefs: [], references: [{ entity: "PROPERTY", id: "missing" }],
    evidenceExpiresAt: "2026-10-14T12:00:00.000Z", currentSnapshotHash: "new", sourceSnapshotHash: "old",
    stageHistory: [{ from: "CLOSED", to: "CALL_READY" }] },
];

test("dry-run report is deterministic, reconciles counts, and retains duplicate conflicts", () => {
  const first = buildDataQualityReport(records, now, { PROPERTY: 2, LEAD: 1 }, ["DISCOVERED:QUALIFIED"]);
  const replay = buildDataQualityReport(records, now, { PROPERTY: 2, LEAD: 1 }, ["DISCOVERED:QUALIFIED"]);
  assert.equal(first.dryRun, true);
  assert.equal(first.repairsApplied, 0);
  assert.equal(first.snapshotHash, replay.snapshotHash);
  assert.deepEqual(first.countReconciliation, { PROPERTY: { expected: 2, actual: 2, matches: true }, LEAD: { expected: 1, actual: 1, matches: true } });
  assert.deepEqual(first.issues.find(issue => issue.code === "DUPLICATE_IDENTITY")?.recordIds, ["p1", "p2"]);
  assert.ok(first.issues.some(issue => issue.code === "MISSING_PROVENANCE" && issue.recordIds[0] === "l1"));
  assert.ok(first.issues.some(issue => issue.code === "ORPHAN_REFERENCE"));
  assert.ok(first.issues.some(issue => issue.code === "STALE_EVIDENCE"));
  assert.ok(first.issues.some(issue => issue.code === "STALE_SNAPSHOT"));
  assert.ok(first.issues.some(issue => issue.code === "IMPOSSIBLE_TRANSITION"));
});

test("ambiguous duplicate identities are reported for review and never merged or rewritten", () => {
  const before = structuredClone(records);
  const report = buildDataQualityReport(records, now);
  assert.equal(report.issues.find(issue => issue.code === "DUPLICATE_IDENTITY")?.severity, "REVIEW_REQUIRED");
  assert.deepEqual(records, before);
});
