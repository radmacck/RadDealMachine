import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const generatedApiPath = path.resolve(packageDir, "../api-zod/src/generated/api.ts");
const zodImport = "import * as zod from 'zod';";
const commandCenterImport = "import type { CommandCenter } from './types/commandCenter';";
const inferredDeclaration = "export const GetCommandCenterResponse = zod.object({";
const typedDeclaration = [
  "export const GetCommandCenterResponse:",
  "  zod.ZodType<CommandCenter> & {",
  "    shape: { decisions: zod.ZodArray<zod.ZodType<CommandCenter['decisions'][number]>> }",
  "  } = zod.object({",
].join("\n");

export function rewriteCommandCenterResponse(source) {
  if (source.includes(typedDeclaration)) return source;
  if (!source.includes(zodImport) || !source.includes(inferredDeclaration)) {
    throw new Error("Expected generated Zod imports or GetCommandCenterResponse declaration were not found.");
  }

  return source
    .replace(zodImport, `${zodImport}\n${commandCenterImport}`)
    .replace(inferredDeclaration, typedDeclaration);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = await readFile(generatedApiPath, "utf8");
  const rewritten = rewriteCommandCenterResponse(source);
  if (rewritten !== source) await writeFile(generatedApiPath, rewritten);
}
