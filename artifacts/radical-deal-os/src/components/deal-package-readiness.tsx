import { Link } from 'wouter';
import { getGetDealDistributionQueryKey, useGetDealDistribution, type BuyerMatch, type DealContract } from '@workspace/api-client-react';
import { errInfo, fmtDate, money } from '@/lib/format';
import { packageDeliveryDisplay } from '@/lib/command-center-display';

export function DealPackageReadiness({
  leadId,
  address,
  contract,
  matches,
  deliveryProviderStatus,
  deliveryStatus,
}: {
  leadId: string;
  address: string;
  contract: DealContract;
  matches: BuyerMatch[];
  deliveryProviderStatus: string;
  deliveryStatus: string;
}) {
  const distributionQuery = useGetDealDistribution(leadId, {
    query: { queryKey: getGetDealDistributionQueryKey(leadId), refetchInterval: 15_000 },
  });
  const qualifiedBuyerCount = matches.filter((match) =>
    match.eligible && (match.destinationKind ?? 'BUYER') === 'BUYER').length;
  const href = `/deals/${leadId}?work=transaction`;
  const eligibleContract = ['UNDER_CONTRACT', 'CLOSING'].includes(contract.status)
    && contract.assignmentAllowed && !contract.committedBuyerId;

  if (distributionQuery.isLoading) {
    return <article className="fd-readiness-item" data-testid={`package-readiness-${leadId}`}><b>{address}</b><p>Loading persisted package state…</p></article>;
  }
  if (distributionQuery.isError || !distributionQuery.data) {
    return <article className="fd-readiness-item" data-testid={`package-readiness-${leadId}`}><b>{address}</b><p>Package state unavailable; do not infer authorization or delivery. {errInfo(distributionQuery.error).message}</p></article>;
  }

  const distribution = distributionQuery.data;
  const packet = distribution.packet;
  const deliveryDisplay = packageDeliveryDisplay(deliveryProviderStatus, deliveryStatus);
  return (
    <article className="fd-readiness-item" data-testid={`package-readiness-${leadId}`}>
      <b>{address}</b>
      {!eligibleContract ? (
        <p>Package distribution is blocked by contract state ({contract.status}), assignment permission, or an existing buyer commitment.</p>
      ) : !distribution.packetId || !packet ? (
        <>
          <p>No immutable buyer package is authorized for this contract.</p>
          <p>{qualifiedBuyerCount
            ? `${qualifiedBuyerCount} current qualified buyer match(es); an owner must authorize the frozen package before links can be created.`
            : 'No current qualified buyer match. Next: review buyer evidence and refresh matching; do not manufacture buyer demand.'}</p>
        </>
      ) : (
        <>
          <p>Packet {distribution.status ?? 'status unavailable'} · buyer price {money(packet.economics.buyerPrice)} · {packet.addressRedacted ? 'street address redacted' : 'address-disclosing snapshot'}.</p>
          <p>{distribution.recipients.length} persisted recipient record(s) · expires {distribution.expiresAt ? fmtDate(distribution.expiresAt) : 'not recorded'}.</p>
          <p>Delivery: {deliveryDisplay.status} · {deliveryDisplay.explanation}</p>
        </>
      )}
      <Link href={href} className="underline">Open package and transaction controls</Link>
    </article>
  );
}
