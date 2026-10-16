import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

test("database scripts expose no force-push schema operation", async () => {
  const manifest = JSON.parse(await readFile(resolve(process.cwd(), "../../lib/db/package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const scripts = manifest.scripts ?? {};
  assert.equal(scripts["push-force"], undefined, "Destructive force-push must not be exposed as a routine database script.");
  assert.equal(scripts.push, "drizzle-kit push --config ./drizzle.config.ts");
  assert.ok(!Object.values(scripts).some(command => /drizzle-kit\s+push\s+--force/.test(command)),
    "No database script may bypass schema-diff review.");
});
