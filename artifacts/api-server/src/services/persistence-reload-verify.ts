import assert from "node:assert/strict";
import { pool } from "@workspace/db";

const encoded = process.env.PERSISTENCE_EXPECTED;
if (!encoded) throw new Error("Expected isolated persistence snapshot is required.");
const expected = JSON.parse(encoded) as Record<string,{count:string;fingerprint:string}>;
for (const [table, snapshot] of Object.entries(expected)) {
  if (!/^re_[a-z_]+$/.test(table)) throw new Error("Unexpected table identifier.");
  const result = await pool.query<{count:string;fingerprint:string}>(`
    SELECT count(*)::text AS count,
      md5(coalesce(string_agg(to_jsonb(row_data)::text, E'\\n' ORDER BY to_jsonb(row_data)::text),'')) AS fingerprint
    FROM "${table}" AS row_data
  `);
  assert.deepEqual(result.rows[0], snapshot, `Persisted rows in ${table} must match after a fresh process reload.`);
}
console.log(JSON.stringify({
  persistenceReload: "PASS",
  isolatedTablesReconciled: Object.keys(expected).length,
  rowCountsAndFingerprintsStable: true,
}));
await pool.end();
