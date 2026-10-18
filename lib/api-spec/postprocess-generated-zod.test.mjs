import assert from "node:assert/strict";
import test from "node:test";
import { rewriteCommandCenterResponse } from "./postprocess-generated-zod.mjs";

const generated = [
  "import * as zod from 'zod';",
  "",
  "export const GetCommandCenterResponse = zod.object({",
  "  decisions: zod.array(zod.object({ id: zod.string() })),",
  "});",
].join("\n");

test("command-center schema receives its generated interface type and retains decision element parsing", () => {
  const result = rewriteCommandCenterResponse(generated);
  assert.match(result, /import type \{ CommandCenter \} from '\.\/types\/commandCenter';/);
  assert.match(result, /zod\.ZodType<CommandCenter>/);
  assert.match(result, /shape: \{ decisions: zod\.ZodArray<zod\.ZodType<CommandCenter\['decisions'\]\[number\]>> \}/);
});

test("postprocessing generated output is idempotent", () => {
  const result = rewriteCommandCenterResponse(generated);
  assert.equal(rewriteCommandCenterResponse(result), result);
});

test("unrecognized generator output fails explicitly", () => {
  assert.throws(() => rewriteCommandCenterResponse("export const SomethingElse = zod.object({});"),
    /Expected generated Zod imports or GetCommandCenterResponse declaration/);
});
