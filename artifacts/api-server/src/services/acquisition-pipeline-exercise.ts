import assert from "node:assert/strict";
import { db, propertyDiscoveriesTable, transitionsTable, leadsTable } from "@workspace/db";
import { dashboard } from "./deal-store";

const before = await dashboard(new Date("2026-10-16T12:00:00.000Z"));
assert.equal(before.acquisitionStages.reduce((sum,item)=>sum+item.count,0),0);
await db.insert(propertyDiscoveriesTable).values({
  identityKey: "pipeline-exercise:parcel-1", marketKey: "PHILADELPHIA_PA",
  status: "DISCOVERED_PROPERTY", score: 0, confidence: 0, version: 1, leadId: null,
  payload: { property: { id:"parcel-1", address:"100 TEST AVE", city:"Philadelphia", state:"PA", zip:"19103", provider:"PUBLIC_CITY_ASSESSMENT" }, signals: [] },
  createdAt: new Date("2026-10-16T11:00:00.000Z"), updatedAt: new Date("2026-10-16T11:00:00.000Z"),
});
const counts = await dashboard(new Date("2026-10-16T12:00:00.000Z"));
const normalized = counts.acquisitionStages.find(item => item.stage === "NORMALIZED");
assert.equal(normalized?.count, 1, "A persisted normalized discovery enters only the normalized stage.");
assert.equal(counts.acquisitionStages.reduce((sum,item)=>sum+item.count,0),
  (await db.select().from(leadsTable)).length + (await db.select().from(propertyDiscoveriesTable)).filter(row=>!row.leadId).length,
  "Stage counts reconcile to unique leads plus unlinked persisted discoveries.");
const transitionsBefore = await db.select().from(transitionsTable);
const repeated = await dashboard(new Date("2026-10-16T12:00:00.000Z"));
assert.deepEqual(repeated.acquisitionStages, counts.acquisitionStages, "Repeated projection is idempotent and does not backfill progress.");
assert.equal((await db.select().from(transitionsTable)).length, transitionsBefore.length,
  "A derived stage never fabricates or rewrites transition history.");
console.log("PASS SYNTHETIC persisted acquisition pipeline: stage definitions reconcile to source records; repeat calculation is idempotent and non-mutating.");
