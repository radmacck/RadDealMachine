import { DomainError } from "./types";
import type { DealContract, BuyerMatch } from "./buyers";

export const CLOSING_MILESTONES = ["TITLE_CLEARED","INSPECTION_COMPLETED","EARNEST_MONEY_CONFIRMED","ASSIGNMENT_SIGNED","FUNDS_CONFIRMED"] as const;
export function wholeDollars(value: number, label: string) {
  if (!Number.isFinite(value) || value<0 || Math.abs(value*100-Math.round(value*100))>0.00001) throw new DomainError(`${label} must be a nonnegative amount in whole cents.`);
}
export function closingBlockers(contract: DealContract, match: BuyerMatch|undefined) {
  const errors: string[] = [];
  if (contract.status!=="CLOSING") errors.push("Start closing with a qualified committed buyer and evidence milestones.");
  if (!contract.executedDocumentUrl || !contract.sellerSignedAt || !contract.acquisitionSignedAt) errors.push("Executed acquisition document and both recorded signatures are required.");
  if (!contract.assignmentAllowed) errors.push("Recorded contract does not permit assignment.");
  if (!contract.committedBuyerId || !match?.eligible || match.status!=="COMMITTED") errors.push("A currently qualified, verified, committed buyer is required.");
  for (const kind of CLOSING_MILESTONES) {
    if (kind==="INSPECTION_COMPLETED") {
      const inspection = contract.deadlineSchedule?.items.find(item=>item.kind==="INSPECTION_COMPLETED");
      if (!inspection || inspection.disposition==="NOT_APPLICABLE") continue;
    }
    if (kind==="EARNEST_MONEY_CONFIRMED"&&contract.earnestMoney<=0) continue;
    const milestone=contract.milestones.find(m=>m.kind===kind);
    if (!milestone) {
      errors.push(`Missing evidence: ${kind.replace(/_/g," ").toLowerCase()}.`);
      continue;
    }
    if (!milestone.evidenceUrl || !milestone.effectiveAt || !Number.isFinite(Date.parse(milestone.effectiveAt)) ||
        !milestone.recordedAt || !Number.isFinite(Date.parse(milestone.recordedAt))) {
      errors.push(`${kind.replace(/_/g," ").toLowerCase()} requires linked evidence and distinct actual-event and recorded timestamps.`);
    }
    if (kind==="EARNEST_MONEY_CONFIRMED") {
      const complete=milestone.currency==="USD"&&milestone.evidenceKind!==undefined&&
        ["ESCROW_RECEIPT","WIRE_CONFIRMATION"].includes(milestone.evidenceKind)&&
        milestone.amount!=null&&Math.abs(milestone.amount-contract.earnestMoney)<=0.005&&
        !!milestone.counterpartyName?.trim()&&!!milestone.paymentReference?.trim()&&
        !!milestone.effectiveAt&&Number.isFinite(Date.parse(milestone.effectiveAt))&&
        !!contract.sellerSignedAt&&!!contract.acquisitionSignedAt&&
        Date.parse(milestone.effectiveAt)>=Math.max(Date.parse(contract.sellerSignedAt),Date.parse(contract.acquisitionSignedAt));
      if (!complete) errors.push("Acquisition earnest-money evidence is incomplete or does not match the authorized amount, dated signatures, escrow/wire proof, counterparty and masked reference.");
    }
    if (kind==="FUNDS_CONFIRMED") {
      const buyer=contract.commitmentSnapshot?.buyer;
      const complete=milestone.currency==="USD"&&milestone.evidenceKind!==undefined&&
        ["BANK_CONFIRMATION","LENDER_LETTER","REDACTED_STATEMENT","ESCROW_RECEIPT"].includes(milestone.evidenceKind)&&
        milestone.amount!=null&&buyer?.availableFunds!=null&&Math.abs(milestone.amount-buyer.availableFunds)<=0.005&&
        milestone.evidenceUrl===buyer?.fundingEvidenceUrl&&!!milestone.counterpartyName?.trim()&&
        !!milestone.paymentReference?.trim()&&!!milestone.effectiveAt&&Number.isFinite(Date.parse(milestone.effectiveAt))&&
        !!buyer?.evidenceAt&&Date.parse(milestone.effectiveAt)>=Date.parse(buyer.evidenceAt)&&
        !!contract.buyerCommittedAt&&Date.parse(milestone.effectiveAt)>=Date.parse(contract.buyerCommittedAt);
      if (!complete) errors.push("Buyer-funds evidence is incomplete, stale, or does not match the committed buyer's current verified funding amount and evidence.");
    }
  }
  const inspection = contract.deadlineSchedule?.items.find(item=>item.kind==="INSPECTION_COMPLETED");
  if (inspection && inspection.disposition!=="NOT_APPLICABLE") {
    const milestone = contract.milestones.find(item=>item.kind==="INSPECTION_COMPLETED");
    if (!milestone || !milestone.evidenceUrl || !milestone.effectiveAt || !Number.isFinite(Date.parse(milestone.effectiveAt)) ||
        !milestone.recordedAt || !Number.isFinite(Date.parse(milestone.recordedAt))) {
      errors.push("Missing evidence: contract-required inspection completion must have linked evidence and separate actual-event/recorded timestamps.");
    }
  }
  return errors;
}