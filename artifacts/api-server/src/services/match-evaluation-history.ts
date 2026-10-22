import { createHash } from "node:crypto";

export type MatchEvaluationSnapshot = {
  leadId: string;
  buyerId: string;
  buyerVersion: number;
  buyerSource: string;
  criteriaEvidenceRef: string | null;
  verificationEvidenceRefs: string[];
  contactPermission: {
    status: string | null;
    source: string | null;
    evidenceRef: string | null;
    capturedAt: string | null;
    validUntil: string | null;
  };
  propertySourceKey: string | null;
  propertyDiscoveryId: string | null;
  propertyEvidenceRefs: string[];
  analysisSnapshotId: string | null;
  status: string;
  eligible: boolean;
  score: number;
  reasons: string[];
  mismatches: string[];
};

export type MatchEvaluationHistoryEntry = MatchEvaluationSnapshot & {
  snapshotHash: string;
  recordedAt: string;
};

export function appendMatchEvaluationHistory(
  prior: unknown,
  snapshot: MatchEvaluationSnapshot,
  recordedAt: string,
): MatchEvaluationHistoryEntry[] {
  const history = Array.isArray(prior) ? prior : [];
  const snapshotHash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  const last = history.at(-1);
  if (last && typeof last === "object" && !Array.isArray(last) &&
    (last as MatchEvaluationHistoryEntry).snapshotHash === snapshotHash) {
    return history as MatchEvaluationHistoryEntry[];
  }
  return [...history, { ...snapshot, snapshotHash, recordedAt }] as MatchEvaluationHistoryEntry[];
}
