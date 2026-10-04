import { DomainError } from "./types";
import type { DealContract, BuyerMatch } from "./buyers";

export const CLOSING_MILESTONES = ["TITLE_CLEARED","EARNEST_MONEY_CONFIRMED","ASSIGNMENT_SIGNED","FUNDS_CONFIRMED"] as const;
export function wholeDollars(value: number, label: string) {
  if (!Number.isFinite(value) || value<0 || Math.abs(value*100-Math.round(value*100))>0.00001) throw new DomainError(`${label} must be a nonnegative amount in whole cents.`);
}
export function closingBlockers(contract: DealContract, match: BuyerMatch|undefined) {
  const errors: string[] = [];
  if (contract.status!=="CLOSING") errors.push("Start closing with a qualified committed buyer and evidence milestones.");
  if (!contract.executedDocumentUrl || !contract.sellerSignedAt || !contract.acquisitionSignedAt) errors.push("Executed acquisition document and both recorded signatures are required.");
  if (!contract.assignmentAllowed) errors.push("Recorded contract does not permit assignment.");
  if (!contract.committedBuyerId || !match?.eligible || match.status!=="COMMITTED") errors.push("A currently qualified, verified, committed buyer is required.");
  for (const kind of CLOSING_MILESTONES) if (!contract.milestones.some(m=>m.kind===kind)) errors.push(`Missing evidence: ${kind.replace(/_/g," ").toLowerCase()}.`);
  return errors;
}