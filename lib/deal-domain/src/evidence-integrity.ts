export type EvidenceClass =
  | "OBSERVED" | "SELLER_REPORTED" | "BUYER_REPORTED" | "PROVIDER_CONFIRMED"
  | "INFERRED" | "ESTIMATED" | "UNKNOWN";
export type EvidenceFreshness = "CURRENT" | "STALE" | "UNKNOWN";

export type EvidenceRecord = {
  ref: string;
  factKey: string;
  value: string;
  source: string | null;
  evidenceRef?: string | null;
  observedAt: string | null;
  validUntil?: string | null;
  confidence?: number | null;
  evidenceClass: EvidenceClass;
};

export function classifyEvidenceFreshness(
  record: Pick<EvidenceRecord, "source" | "evidenceRef" | "observedAt" | "validUntil">,
  now: Date,
  maxAgeMs?: number,
): EvidenceFreshness {
  const observedAt = record.observedAt ? Date.parse(record.observedAt) : Number.NaN;
  if (!Number.isFinite(observedAt) || observedAt > now.getTime()
    || !record.source?.trim() || !record.evidenceRef?.trim()) return "UNKNOWN";
  const validUntil = record.validUntil ? Date.parse(record.validUntil) : Number.NaN;
  if (record.validUntil && (!Number.isFinite(validUntil) || validUntil <= now.getTime())) return "STALE";
  if (maxAgeMs !== undefined && now.getTime() - observedAt >= maxAgeMs) return "STALE";
  return "CURRENT";
}

export function assessEvidenceConfidence(confidence: number | null | undefined, minimum: number) {
  if (!Number.isFinite(minimum) || minimum < 0 || minimum > 1) throw new Error("Confidence minimum must be between 0 and 1.");
  if (confidence == null || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return "UNKNOWN" as const;
  return confidence < minimum ? "BELOW_THRESHOLD" as const : "ACCEPTED" as const;
}

/** Retains every source record; conflicts are reported as refs and never erase prior evidence. */
export function conflictingEvidence(records: EvidenceRecord[]): EvidenceRecord[] {
  const grouped = new Map<string, EvidenceRecord[]>();
  for (const item of records) {
    if (!item.factKey.trim() || !item.value.trim()) continue;
    const values = grouped.get(item.factKey) ?? [];
    values.push(item);
    grouped.set(item.factKey, values);
  }
  const refs = new Set<string>();
  for (const values of grouped.values()) {
    if (new Set(values.map(item => item.value.trim().toLocaleLowerCase())).size > 1) {
      for (const item of values) refs.add(item.ref);
    }
  }
  return records.filter(item => refs.has(item.ref)).sort((a, b) => a.ref.localeCompare(b.ref));
}

export function evidenceResolutionAction(
  staleCount: number,
  conflictCount: number,
  unknownProvenanceCount: number,
): string | null {
  if (conflictCount) return "Reconcile conflicting source records and save a dated reviewer resolution; retain all prior evidence.";
  if (staleCount) return "Re-verify expired evidence from a permitted current source before relying on it.";
  if (unknownProvenanceCount) return "Attach a source, evidence reference, and observed time before relying on this value.";
  return null;
}
