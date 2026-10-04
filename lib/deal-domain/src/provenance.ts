import { DomainError, type IntelligenceInput, type Intelligence } from "./types";
import { AddIntelligenceBody } from "@workspace/api-zod";

export const PROVENANCE_CLASSES = ["VERIFIED_FACTS", "OBSERVED", "INDICATED", "AI_HYPOTHESIS"] as const;

/** No conversion or automatic promotion: each statement is append-only. */
export function validateProvenance(entry: IntelligenceInput, now: Date): void {
  const parsed = AddIntelligenceBody.safeParse(entry);
  if (!parsed.success) throw new DomainError(`Invalid provenance record: ${parsed.error.message}`);
  const captured = Date.parse(entry.capturedAt);
  if (!Number.isFinite(captured) || captured > now.getTime() + 60_000) {
    throw new DomainError("Captured date must be valid and cannot be in the future.");
  }
  if (entry.sourceUrl && !/^https?:\/\//i.test(entry.sourceUrl)) {
    throw new DomainError("A source link must be an HTTP(S) URL.");
  }
  if (entry.sourceType === "MODEL" && entry.classification !== "AI_HYPOTHESIS") {
    throw new DomainError("Model output must remain AI HYPOTHESIS, never facts, observations or indications.");
  }
  if (entry.sourceType === "SELLER" && entry.classification === "VERIFIED_FACTS") {
    throw new DomainError("A seller statement alone is not a verified fact. Record it as INDICATED.");
  }
  if (entry.classification === "VERIFIED_FACTS") {
    if (!["PUBLIC_RECORD", "INSPECTION"].includes(entry.sourceType) || !entry.verificationNote?.trim()) {
      throw new DomainError("Verified facts need a public record or inspection source and a verification note.");
    }
  }
  if (entry.classification === "AI_HYPOTHESIS") {
    if (!entry.question?.trim() || !entry.action?.trim() || entry.confidence >= 1) {
      throw new DomainError("Every AI hypothesis needs confidence below 100%, a seller question and an action.");
    }
  }
}

export function groupIntelligence(entries: Intelligence[]) {
  return Object.fromEntries(PROVENANCE_CLASSES.map(section => [
    section, entries.filter(e => e.classification === section),
  ])) as Record<(typeof PROVENANCE_CLASSES)[number], Intelligence[]>;
}