import assert from "node:assert/strict";
import { db, leadsTable } from "@workspace/db";
import { buildDataQualityReport } from "./data-quality-report";

const now = new Date("2026-10-15T12:00:00.000Z");
const [row] = await db.insert(leadsTable).values({
  payload: { address: "SYNTHETIC DQ PROPERTY", source: "synthetic fixture" },
  stage: "DISCOVERED", version: 1, nextAction: "SYNTHETIC quality scan only.",
}).returning();
assert.ok(row);
const before = { payload: structuredClone(row.payload), stage: row.stage, version: row.version };
const record = {
  id: row.id, entity: "LEAD" as const, identityKey: String(row.payload.address),
  provenanceRefs: [], stage: row.stage,
};
const first = buildDataQualityReport([record], now, { LEAD: 1 });
const replay = buildDataQualityReport([record], now, { LEAD: 1 });
assert.equal(first.dryRun, true);
assert.equal(first.repairsApplied, 0);
assert.equal(first.snapshotHash, replay.snapshotHash);
assert.equal(first.countReconciliation.LEAD?.matches, true);
assert.ok(first.issues.some(issue => issue.code === "MISSING_PROVENANCE"));
const [after] = await db.select().from(leadsTable);
assert.deepEqual({ payload: after!.payload, stage: after!.stage, version: after!.version }, before,
  "A dry-run report must not modify persisted records.");
console.log(JSON.stringify({ exercise: "synthetic-isolated-data-quality-dry-run", status: "passed",
  records: first.recordCount, issues: first.issues.length, countReconciled: true, changedRows: 0 }));
