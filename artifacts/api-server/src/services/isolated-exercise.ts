/**
 * Run real service exercises against empty cloned PostgreSQL tables, never user
 * records. The subprocess's PGOPTIONS applies the isolated search path to EVERY
 * connection (including concurrent transactions). Secrets are neither printed
 * nor copied into files.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pool } from "@workspace/db";
const allowed = new Set(["handoff-exercise.ts","evidence-intake-exercise.ts","seller-exercise.ts","repair-estimate-exercise.ts","offer-exercise.ts","seller-offer-portal-exercise.ts","buyer-exercise.ts","buyer-pool-exercise.ts","transaction-exercise.ts","research-exercise.ts","research-lifecycle-exercise.ts","property-source-exercise.ts","command-center-exercise.ts","seller-contact-exercise.ts","seller-contact-enrichment-exercise.ts","acquisition-queue-exercise.ts","intelligence-loop-exercise.ts","decision-work-lifecycle-exercise.ts","outcome-learning-exercise.ts","seller-playbook-exercise.ts"]);
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
  // PostgreSQL LIKE INCLUDING ALL does not include foreign keys. Reproduce
  // them explicitly, redirecting every internal reference into the clone.
  const foreignKeys = await pool.query<{tablename:string;name:string;definition:string}>(`
    SELECT t.relname AS tablename,c.conname AS name,pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname LIKE 're_%' AND c.contype='f'
  `);
  const names = new Set(tables.rows.map(t=>t.tablename));
  for (const fk of foreignKeys.rows) {
    if (!names.has(fk.tablename)||!/^[a-z_]+$/.test(fk.name)) throw new Error("Unexpected foreign-key identifier.");
    const redirected = fk.definition.replace(/REFERENCES (?:public\.)?"?(re_[a-z_]+)"?/g,(_match,target:string)=>{
      if (!names.has(target)) throw new Error("Foreign key target is outside the isolated clone.");
      return `REFERENCES "${schema}"."${target}"`;
    });
    if (redirected===fk.definition) throw new Error("Foreign key could not be safely redirected into the isolated clone.");
    await pool.query(`ALTER TABLE "${schema}"."${fk.tablename}" ADD CONSTRAINT "${fk.name}" ${redirected}`);
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