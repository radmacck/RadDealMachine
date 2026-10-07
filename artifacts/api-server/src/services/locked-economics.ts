import { createHash } from "node:crypto";
import { DomainError, type Analysis } from "@workspace/deal-domain";

export const DEAL_ECONOMICS_VERSION = "deal-economics/1" as const;

export type LockedEconomicsSnapshot = {
  sourceAnalysisSnapshotId: string;
  version: typeof DEAL_ECONOMICS_VERSION;
  acquisitionPrice: number;
  authorizedAssignmentFee: number;
  buyerPrice: number;
  economicsSnapshotHash: string;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item=>item===undefined?"null":canonical(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([,item])=>item!==undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value)??"null";
}

/**
 * Binds the seller purchase price and automatic assignment target to the exact
 * deterministic underwriting snapshot. The same digest is carried by the
 * review worksheet and every buyer packet.
 */
export function lockDealEconomics(
  sourceAnalysisSnapshotId: string,
  offerId: string,
  analysis: Analysis,
  acquisitionPrice: number,
): LockedEconomicsSnapshot {
  const authorizedAssignmentFee = analysis.assumptions.assignmentTarget;
  const buyerPrice = Math.round((acquisitionPrice + authorizedAssignmentFee) * 100) / 100;
  if (!sourceAnalysisSnapshotId || !offerId || analysis.blockers.length ||
    !Number.isFinite(acquisitionPrice) || acquisitionPrice < 0 ||
    !Number.isFinite(authorizedAssignmentFee) || authorizedAssignmentFee < 0 ||
    !Number.isFinite(buyerPrice)) {
    throw new DomainError("A complete, blocker-free underwriting snapshot and finite non-negative authorized economics are required.", 409);
  }
  const economics = {
    sourceAnalysisSnapshotId,
    offerId,
    version: DEAL_ECONOMICS_VERSION,
    engineVersion: analysis.engineVersion,
    calculatedAt: analysis.calculatedAt,
    acquisitionPrice,
    authorizedAssignmentFee,
    buyerPrice,
    arv: analysis.arv,
    repairs: analysis.repairs,
    repairEstimate: analysis.repairEstimate,
    compDecisions: analysis.compDecisions,
    assumptions: analysis.assumptions,
  };
  const economicsSnapshotHash = createHash("sha256").update(canonical(economics)).digest("hex");
  return {
    sourceAnalysisSnapshotId,
    version: DEAL_ECONOMICS_VERSION,
    acquisitionPrice,
    authorizedAssignmentFee,
    buyerPrice,
    economicsSnapshotHash,
  };
}
