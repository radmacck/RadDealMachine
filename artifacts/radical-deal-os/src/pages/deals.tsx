import { Link } from 'wouter';
import { getListLeadsQueryKey, useListLeads } from '@workspace/api-client-react';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorNotice, RowsSkeleton } from '@/components/state-views';
import { StageBadge } from '@/components/stage-badge';

const ORCHESTRATION_STAGES = new Set([
  'CONTRACT_PENDING',
  'UNDER_CONTRACT',
  'BUYER_MATCHED',
  'BUYER_INTERESTED',
  'BUYER_COMMITTED',
  'CLOSING',
]);

export default function Deals() {
  const query = useListLeads({
    query: {
      queryKey: getListLeadsQueryKey(),
      staleTime: 10_000,
      refetchInterval: 30_000,
    },
  });
  const deals = (query.data ?? []).filter((lead) => ORCHESTRATION_STAGES.has(lead.stage));

  return (
    <div>
      <PageHeader eyebrow="Deal orchestration" title="Active transactions" />
      <p className="mb-5 max-w-3xl text-sm text-muted-foreground">
        This work list begins when an exact, owner-approved and communicated seller offer enters transaction preparation.
        Seller acquisition, buyer commitment, deal-finder activity and closing remain separate records connected here by the deal lifecycle.
      </p>

      {query.isLoading && <RowsSkeleton rows={5} />}
      {query.isError && <ErrorNotice error={query.error} onRetry={() => query.refetch()} />}
      {query.data && deals.length === 0 && (
        <EmptyState
          title="No active transactions"
          body="A deal appears here when it enters contract preparation or an active closing stage. This view does not create or advance lifecycle states."
          action={<Link className="text-sm font-semibold underline" href="/leads">Open seller records</Link>}
        />
      )}
      {deals.length > 0 && (
        <div className="ledger overflow-x-auto" data-testid="table-active-transactions">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="eyebrow p-3">Property / seller</th>
                <th className="eyebrow p-3">Deal state</th>
                <th className="eyebrow p-3">Next action</th>
                <th className="eyebrow p-3 text-right">Workspace</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((deal) => (
                <tr key={deal.id} className="border-b border-border/70 last:border-0">
                  <td className="p-3">
                    <Link className="font-semibold hover:text-signal" href={`/deals/${deal.id}?work=transaction`} data-testid={`link-active-deal-${deal.id}`}>
                      {deal.address}
                    </Link>
                    <p className="text-xs text-muted-foreground">{deal.city}, {deal.state} {deal.zip} / {deal.sellerName}</p>
                  </td>
                  <td className="p-3"><StageBadge stage={deal.stage} /></td>
                  <td className="max-w-md p-3 text-sm text-muted-foreground">{deal.nextAction || 'Review the current transaction record.'}</td>
                  <td className="p-3 text-right">
                    <Link className="font-semibold underline underline-offset-2" href={`/deals/${deal.id}?work=transaction`}>
                      Open transaction
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
