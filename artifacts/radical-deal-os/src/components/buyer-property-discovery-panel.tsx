import { getListPropertyDiscoveriesQueryKey, useListPropertyDiscoveries, type Buyer, type ListPropertyDiscoveriesParams } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { ErrorNotice, RowsSkeleton } from '@/components/state-views';
import { Link } from 'wouter';
import { fmtDate } from '@/lib/format';
import { classifyApiViewState } from '@/lib/command-center-state';
import { buyerPropertyCandidateStateLabel, discoverBuyerPropertyCandidates } from '@/lib/buyer-property-discovery';
import { buyerPropertyHandoffHref } from '@/lib/buyer-property-handoff';

const params: ListPropertyDiscoveriesParams = { marketKey: 'PHILADELPHIA_PA', limit: 100 };

export function BuyerPropertyDiscoveryPanel({ buyer, isOwner }: { buyer: Buyer; isOwner: boolean }) {
  const pool = useListPropertyDiscoveries(params, {
    query: { queryKey: getListPropertyDiscoveriesQueryKey(params), enabled: isOwner, staleTime: 30_000, refetchInterval: 60_000 },
  });
  const poolState = classifyApiViewState(pool);
  const poolCurrent = poolState === 'READY' || poolState === 'EMPTY';
  const result = discoverBuyerPropertyCandidates(buyer.criteria, pool.data?.records ?? [], new Date(), {
    loading: poolState === 'LOADING',
    unavailable: pool.isError,
    hasMore: pool.data?.hasMore,
    marketSupported: buyer.criteria?.states.some(state => state.toUpperCase() === 'PA'),
    marketPartial: buyer.criteria?.states.some(state => state.toUpperCase() !== 'PA'),
    buyerContext: buyer,
  });
  const displayed = result.candidates.slice(0, 12);
  if (!isOwner) return null;
  return <section className="ledger p-4" data-testid="panel-buyer-property-discovery">
    <p className="eyebrow mb-1">Buyer-first property discovery</p>
    <h2 className="font-display text-xl">Source-backed candidate properties</h2>
    <p className="mb-3 text-xs text-muted-foreground">Philadelphia, PA discovery pool only. These are public-record property candidates, not verified listings or guaranteed available homes. Criteria alignment is advisory; it does not establish price fit, profitability, or suitability.</p>
      <p className="mb-3 text-xs text-muted-foreground">Buyer criteria v{buyer.version} · updated {buyer.updatedAt} · criteria evidence {buyer.criteriaEvidenceUrl ? <a className="underline" href={buyer.criteriaEvidenceUrl} target="_blank" rel="noreferrer">source</a> : 'missing'} · buying evidence {buyer.buyingEvidenceAt ?? 'missing'} · valid through {buyer.validUntil ?? 'unknown'}</p>
    {poolState === 'LOADING' && <div role="status" aria-label="Loading property candidates"><RowsSkeleton /></div>}
    {poolState === 'REFRESHING' && <p className="mb-3 border-l-2 border-amber-500 pl-3 text-sm" role="status" data-testid="buyer-property-refreshing">Refreshing the property source pool. Previous results are hidden until the request finishes.</p>}
    {pool.isError && <div className="space-y-2">
      <ErrorNotice error={pool.error} onRetry={() => { void pool.refetch(); }} />
      {poolState === 'STALE' && <p className="text-xs text-muted-foreground" role="status" data-testid="buyer-property-stale">The last successful source pool is not used for a match or no-match result.</p>}
    </div>}
    {poolCurrent && <>
      <p className="mb-3 border-l-2 border-signal pl-3 text-sm" role="status" data-testid={`buyer-property-state-${result.state.toLowerCase()}`}>{result.note}</p>
      {result.candidates.length > 0 && <p className="mb-2 text-xs text-muted-foreground">{displayed.length} of {result.candidates.length} evaluated properties shown · source pool observed through {pool.data?.records.reduce((latest, item) => item.lastObservedAt > latest ? item.lastObservedAt : latest, '') || 'no timestamp'}{pool.data?.hasMore ? ' · additional pool pages remain' : ''}{buyer.criteria?.states.some(state => state.toUpperCase() !== 'PA') ? ' · additional buyer markets are not searched' : ''}</p>}
      {displayed.length > 0 ? <div className="space-y-2">{displayed.map(candidate => {
        const item = candidate.discovery;
        const property = item.property;
        return <article key={item.id} className="border border-border p-3" data-testid={`buyer-property-${item.id}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">{property.address || 'Address incomplete'} · {property.city || 'city unknown'}, {property.state || 'state unknown'} {property.zip || ''}</p>
             <span className={`tag ${candidate.state === 'STRONG_MATCH' ? 'tone-go' : candidate.state === 'UNAVAILABLE' ? 'tone-muted' : 'tone-warn'}`}>{buyerPropertyCandidateStateLabel(candidate.state)}</span>
          </div>
          <p className="mt-1 text-xs">Known fit: {candidate.matched.join(' · ') || 'none recorded'}</p>
          {candidate.missed.length > 0 && <p className="mt-1 text-xs text-destructive">Missed: {candidate.missed.join(' · ')}</p>}
          {candidate.missingFacts.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Missing/unknown: {candidate.missingFacts.join(' · ')}</p>}
          <p className="mt-2 text-xs text-muted-foreground">
            Provenance: {item.sourceObservations.map(source => source.sourceName).filter(Boolean).join(', ') || property.provider || 'source unavailable'}
            {' · '}last observed {candidate.lastObservedAt ? fmtDate(candidate.lastObservedAt) : 'unknown'}
            {' · '}status {item.status}
          </p>
          <p className="mt-1 text-xs"><a href={property.sourceUrl} target="_blank" rel="noreferrer" className="underline">View source record</a></p>
           <p className="mt-2">
             <Link
               className="inline-flex min-h-9 items-center border border-border px-3 text-xs font-semibold underline-offset-4 hover:underline"
               href={buyerPropertyHandoffHref(item)}
               data-testid={`link-buyer-property-handoff-${item.id}`}
             >
               {item.leadId ? 'Open existing deal' : 'Review source & qualification'}
             </Link>
           </p>
          <details className="mt-2 border-t border-border pt-2" data-testid={`buyer-property-explanation-${item.id}`}>
            <summary className="cursor-pointer text-xs font-semibold">Auditable explanation · criteria, facts, sources</summary>
            <div className="mt-2 grid gap-3 text-xs sm:grid-cols-2">
              <div><p className="font-semibold">Saved buyer criteria used</p><ul className="list-disc pl-4">{candidate.explanation.criteriaUsed.map(value => <li key={value}>{value}</li>)}</ul></div>
              <div><p className="font-semibold">Property facts used</p><ul className="list-disc pl-4">{candidate.explanation.propertyFactsUsed.map(value => <li key={value}>{value}</li>)}</ul></div>
              <div><p className="font-semibold">Source observations used</p>{candidate.explanation.provenanceUsed.length
                ? <ul className="list-disc pl-4">{candidate.explanation.provenanceUsed.map(value => <li key={value}>{value}</li>)}</ul>
                : <p>No source observation was available.</p>}</div>
              <div><p className="font-semibold">Assumptions / limits</p><ul className="list-disc pl-4">{candidate.explanation.assumptions.map(value => <li key={value}>{value}</li>)}</ul></div>
            </div>
          </details>
        </article>;
      })}</div> : result.state !== 'NO_MATCH' && <p className="text-sm text-muted-foreground">No displayable candidate records in the loaded page.</p>}
    </>}
  </section>;
}
