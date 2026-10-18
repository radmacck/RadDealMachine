import { DomainError, wholeDollars } from "@workspace/deal-domain";

const FEE_EVENT_KINDS = new Set(["FEE_RECEIVED", "FEE_DISPUTED", "FEE_WAIVED"]);

export function validateDestinationFeeFields(
  kind: string,
  feeAmount: number | null | undefined,
  currency: string | null | undefined,
) {
  const isFeeEvent = FEE_EVENT_KINDS.has(kind);
  if (isFeeEvent && (feeAmount == null || !currency)) {
    throw new DomainError("Fee outcomes need the exact evidenced amount and currency; no quoted fee is assumed.");
  }
  if (!isFeeEvent && (feeAmount != null || currency)) {
    throw new DomainError("Fee amount and currency belong on a fee outcome.");
  }
}

export function reconcileSettlementProceeds(expectedFee: number, feeReceived: number, closingCosts: number) {
  wholeDollars(feeReceived, "Received fee");
  wholeDollars(closingCosts, "Closing costs");
  if (feeReceived !== expectedFee) {
    throw new DomainError("Received assignment fee must reconcile to the frozen committed price minus acquisition price.");
  }
  return Math.round((feeReceived - closingCosts) * 100) / 100;
}
