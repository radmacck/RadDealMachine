import { createHash } from "node:crypto";

export type QualityRecord = {
  id: string;
  entity: "PROPERTY" | "LEAD" | "CONTACT" | "BUYER" | "UNDERWRITING" | "OUTREACH" | "PACKAGE" | "DEAL";
  identityKey?: string | null;
  provenanceRefs?: string[] | null;
  references?: Array<{ entity: QualityRecord["entity"]; id: string }>;
  evidenceExpiresAt?: string | null;
  currentSnapshotHash?: string | null;
  sourceSnapshotHash?: string | null;
  stage?: string | null;
  stageHistory?: Array<{ from: string; to: string }>;
};

export type QualityIssue = {
  key: string;
  code: "DUPLICATE_IDENTITY" | "MISSING_PROVENANCE" | "ORPHAN_REFERENCE" | "STALE_EVIDENCE" | "STALE_SNAPSHOT" | "IMPOSSIBLE_TRANSITION";
  entity: QualityRecord["entity"];
  recordIds: string[];
  severity: "REVIEW_REQUIRED" | "BLOCKING";
  detail: string;
};

/** Read-only deterministic scan. Ambiguous identity clusters are never auto-merged. */
export function buildDataQualityReport(
  records: QualityRecord[],
  now = new Date(),
  expectedCounts?: Partial<Record<QualityRecord["entity"], number>>,
  allowedLeadTransitions?: readonly string[],
) {
  const ids = new Map<string, Set<string>>();
  for (const record of records) {
    const bucket = ids.get(record.entity) ?? new Set<string>();
    bucket.add(record.id);
    ids.set(record.entity, bucket);
  }
  const issues: QualityIssue[] = [];
  const duplicateBuckets = new Map<string, string[]>();
  for (const record of records) {
    if (record.identityKey?.trim()) {
      const key = `${record.entity}:${record.identityKey.trim().toLocaleLowerCase()}`;
      duplicateBuckets.set(key, [...(duplicateBuckets.get(key) ?? []), record.id]);
    }
  }
  for (const [key, recordIds] of duplicateBuckets) if (recordIds.length > 1) {
    issues.push({ key: `duplicate:${key}`, code: "DUPLICATE_IDENTITY", entity: key.split(":")[0] as QualityRecord["entity"],
      recordIds, severity: "REVIEW_REQUIRED", detail: "Possible duplicate identity; preserve every record and source history pending human resolution." });
  }
  for (const record of records) {
    if (!record.provenanceRefs?.length) issues.push({
      key: `provenance:${record.entity}:${record.id}`, code: "MISSING_PROVENANCE", entity: record.entity,
      recordIds: [record.id], severity: "BLOCKING", detail: "No source provenance is recorded; do not infer or backfill a source.",
    });
    for (const ref of record.references ?? []) if (!ids.get(ref.entity)?.has(ref.id)) issues.push({
      key: `orphan:${record.entity}:${record.id}:${ref.entity}:${ref.id}`, code: "ORPHAN_REFERENCE",
      entity: record.entity, recordIds: [record.id], severity: "BLOCKING",
      detail: `Reference to ${ref.entity} ${ref.id} does not resolve in this snapshot.`,
    });
    if (record.evidenceExpiresAt && Number.isFinite(Date.parse(record.evidenceExpiresAt)) &&
      Date.parse(record.evidenceExpiresAt) <= now.getTime()) issues.push({
      key: `stale-evidence:${record.entity}:${record.id}`, code: "STALE_EVIDENCE", entity: record.entity,
      recordIds: [record.id], severity: "BLOCKING", detail: "Evidence is expired as of the report time; refresh/review it before relying on the record.",
    });
    if (record.sourceSnapshotHash && record.currentSnapshotHash && record.sourceSnapshotHash !== record.currentSnapshotHash) issues.push({
      key: `stale-snapshot:${record.entity}:${record.id}`, code: "STALE_SNAPSHOT", entity: record.entity,
      recordIds: [record.id], severity: "BLOCKING", detail: "The dependent snapshot differs from its recorded source snapshot.",
    });
    for (const edge of record.stageHistory ?? []) {
      const key = `${edge.from}:${edge.to}`;
      if (record.entity === "LEAD" && allowedLeadTransitions && !allowedLeadTransitions.includes(key)) issues.push({
        key: `transition:${record.id}:${key}`, code: "IMPOSSIBLE_TRANSITION", entity: record.entity,
        recordIds: [record.id], severity: "BLOCKING", detail: `Transition ${key} is not in the allowed lead-stage history.`,
      });
    }
  }
  const actualCounts = Object.fromEntries([...new Set(records.map(record => record.entity))]
    .map(entity => [entity, records.filter(record => record.entity === entity).length]));
  const expected = expectedCounts ?? {};
  const countReconciliation = Object.fromEntries(Object.keys(expected).map(entity => [
    entity, { expected: expected[entity as QualityRecord["entity"]], actual: actualCounts[entity] ?? 0,
      matches: expected[entity as QualityRecord["entity"]] === (actualCounts[entity] ?? 0) },
  ]));
  issues.sort((a, b) => a.key.localeCompare(b.key));
  const snapshotHash = createHash("sha256").update(JSON.stringify({
    records: [...records].sort((a, b) => `${a.entity}:${a.id}`.localeCompare(`${b.entity}:${b.id}`)),
    expectedCounts: expected,
    reportTime: now.toISOString(),
  })).digest("hex");
  return { dryRun: true as const, snapshotHash, reportTime: now.toISOString(), recordCount: records.length,
    actualCounts, countReconciliation, issues, repairsApplied: 0 as const };
}
