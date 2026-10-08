export type AcquisitionEvidenceSignal = {
  classification: string;
  scoreContribution: number;
  capturedAt: string;
};

export type AcquisitionQueueRankInput = {
  decision: "CALL_NEXT" | "BLOCKED";
  evidenceScore: number;
  followUpAt: string | null;
  createdAt: string;
  id: string;
};

/**
 * Uses only persisted, non-hypothetical relevance points. AI hypotheses and
 * malformed/future-dated signals are visible evidence, but never ranking points.
 */
export function acquisitionEvidenceScore(signals: AcquisitionEvidenceSignal[], now: Date): number {
  const points = signals.reduce((total, signal) => {
    if (!["VERIFIED", "VERIFIED_FACT", "VERIFIED_FACTS", "OBSERVED", "INDICATED"].includes(signal.classification)) return total;
    const captured = Date.parse(signal.capturedAt);
    if (!Number.isFinite(captured) || captured > now.getTime()) return total;
    if (!Number.isFinite(signal.scoreContribution) || signal.scoreContribution <= 0) return total;
    return total + Math.floor(signal.scoreContribution);
  }, 0);
  return Math.max(0, Math.min(100, points));
}

/** Stable order: callable first, then source-backed relevance, then due time, age and ID. */
export function compareAcquisitionQueue(a: AcquisitionQueueRankInput, b: AcquisitionQueueRankInput): number {
  const dueA = a.followUpAt ? Date.parse(a.followUpAt) : Number.POSITIVE_INFINITY;
  const dueB = b.followUpAt ? Date.parse(b.followUpAt) : Number.POSITIVE_INFINITY;
  const safeDueA = Number.isFinite(dueA) ? dueA : Number.POSITIVE_INFINITY;
  const safeDueB = Number.isFinite(dueB) ? dueB : Number.POSITIVE_INFINITY;
  return Number(b.decision === "CALL_NEXT") - Number(a.decision === "CALL_NEXT")
    || b.evidenceScore - a.evidenceScore
    || safeDueA - safeDueB
    || a.createdAt.localeCompare(b.createdAt)
    || a.id.localeCompare(b.id);
}

export type AcquisitionBlockerCode =
  | "PROPERTY_RELEVANCE_REVIEW"
  | "CONTACT_NO_DIRECT_ROUTE"
  | "CONTACT_STALE"
  | "CONTACT_CONFLICT"
  | "CONTACT_REVIEW"
  | "UNDERWRITING_MISSING"
  | "UNDERWRITING_STALE"
  | "UNDERWRITING_BLOCKED"
  | "CALL_READY_TRANSITION"
  | "FOLLOW_UP_NOT_DUE"
  | "OPERATOR_AUTH_REQUIRED";

export function contactBlockerCode(status: string): AcquisitionBlockerCode | null {
  if (status === "PHONE_ROUTE_AVAILABLE") return null;
  if (status === "NO_DIRECT_ROUTE" || status === "POSTAL_ONLY") return "CONTACT_NO_DIRECT_ROUTE";
  if (status === "STALE_ROUTE") return "CONTACT_STALE";
  if (status === "CONFLICTING_ROUTE") return "CONTACT_CONFLICT";
  return "CONTACT_REVIEW";
}
