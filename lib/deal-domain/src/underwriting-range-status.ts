import type { Analysis } from "./types";

export type UnderwritingRangeMetric = "arv" | "repairs";
export type UnderwritingRangeStatus = "AVAILABLE" | "MISSING" | "INCOMPLETE" | "LOW_CONFIDENCE";

/** Prevent unsupported zeroes and partial ranges from looking like complete estimates. */
export function underwritingRangeStatus(
  analysis: Analysis,
  metric: UnderwritingRangeMetric,
): UnderwritingRangeStatus {
  if (metric === "arv") {
    if (!analysis.compDecisions.some((decision) => decision.included)) return "MISSING";
    return analysis.arv.confidence < analysis.assumptions.minConfidence ? "LOW_CONFIDENCE" : "AVAILABLE";
  }

  if (analysis.repairEstimate.status === "BLOCKED" ||
    analysis.blockers.some((blocker) =>
      /complete a sourced repair scope|property condition must be confirmed/i.test(blocker))) {
    return "INCOMPLETE";
  }
  return analysis.repairs.confidence < analysis.assumptions.minConfidence ? "LOW_CONFIDENCE" : "AVAILABLE";
}
