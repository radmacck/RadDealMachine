import { buyerIdentityConflicts, DomainError, type Buyer, type BuyerMatch } from "@workspace/deal-domain";

export function assertBuyerResponseIdentityClear(
  buyer: Buyer,
  pool: Buyer[],
  status: BuyerMatch["status"],
) {
  if (status === "DECLINED") return;
  const conflicts = buyerIdentityConflicts(buyer,pool);
  if (conflicts.length) throw new DomainError(conflicts.join("; "),409);
}
