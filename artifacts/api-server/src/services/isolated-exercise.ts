/**
 * Run real service exercises against empty cloned PostgreSQL tables, never user
 * records. The subprocess's PGOPTIONS applies the isolated search path to EVERY
 * connection (including concurrent transactions). Secrets are neither printed
 * nor copied into files.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pool } from "@workspace/db";
const allowed = new Set(["seller-exercise.ts","offer-exercise.ts","buyer-exercise.ts","transaction-exercise.ts"]);
const file = process.argv[2];
if (!file || !allowed.has(file)) throw new Error("Choose a registered service exercise.");
const schema = `exercise_${randomUUID().replaceAll("-","")}`;
let created = false;
try {
  await pool.query(`CREATE SCHEMA "${schema}"`); created = true;
  const tables = await pool.query<{tablename:string}>("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 're_%'");
  for (const {tablename} of tables.rows) {
    if (!/^[a-z_]+$/.test(tablename)) throw new Error("Unexpected table identifier.");
    await pool.query(`CREATE TABLE "${schema}"."${tablename}" (LIKE public."${tablename}" INCLUDING ALL)`);
  }
  const run = spawnSync("pnpm",["exec","tsx",`src/services/${file}`],{
    cwd:process.cwd(),env:{...process.env,PGOPTIONS:`-c search_path=${schema}`},stdio:"inherit",
  });
  if (run.error) throw run.error;
  if (run.status!==0) process.exitCode=run.status??1;
} finally {
  if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
  await pool.end();
}