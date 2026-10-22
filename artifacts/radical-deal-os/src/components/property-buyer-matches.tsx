import type { Buyer } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { matchSavedBuyersToProperty, type PropertyBuyerSubject } from '@/lib/property-buyer-matching';

export function PropertyBuyerMatches({
  property, buyers, now, loading, error, onRetry,
}: {
  property: PropertyBuyerSubject;
  buyers: Buyer[];
  now: Date;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const matches = matchSavedBuyersToProperty(property, buyers, now).slice(0, 12);
  return <section className="mt-3 rounded border border-border bg-background p-3" data-testid="property-first-buyer-matches">
    <p className="text-xs font-semibold uppercase tracking-wide">Property-first buyer criteria · Owner only</p>
    <p className="mt-1 text-xs text-muted-foreground">Advisory criteria comparison only. It does not establish buyer intent, funding, availability, or a likely closing. Buyer record status is shown separately.</p>
    {error ? <div className="mt-2 flex items-center justify-between gap-2 text-xs"><p>Saved buyer records are unavailable; no property-first match can be determined.</p><Button variant="outline" size="sm" onClick={onRetry}>Retry</Button></div>
      : loading ? <p className="mt-2 text-xs text-muted-foreground">Loading saved buyer criteria…</p>
      : matches.length ? <ul className="mt-2 space-y-2">{matches.map(match => <li key={match.buyer.id} className="border-t border-border pt-2" data-testid={`property-buyer-match-${match.buyer.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{match.buyer.name}</span>
        <span className="tag tone-muted">{match.state.replaceAll('_', ' ')}</span>
      </div>
      <p className="text-xs text-muted-foreground">Profile: {match.buyer.status} · review: {match.buyer.approvalStatus ?? 'not recorded'}</p>
      <p className="text-xs text-muted-foreground">
        Criteria evidence: {match.buyer.criteriaEvidenceUrl
          ? <a className="underline" href={match.buyer.criteriaEvidenceUrl} target="_blank" rel="noreferrer">source record</a>
          : 'missing'}
        {' · '}buying evidence date: {match.buyer.buyingEvidenceAt ?? 'missing'}
        {' · '}valid through: {match.buyer.validUntil ?? 'unknown'}
        {' · '}buyer record v{match.buyer.version} · updated {match.buyer.updatedAt}
      </p>
      {match.matched.length > 0 && <p className="mt-1 text-xs">Matched: {match.matched.join(' · ')}</p>}
      {match.unmet.length > 0 && <p className="mt-1 text-xs text-destructive">Unmet: {match.unmet.join(' · ')}</p>}
      {match.unknown.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Unknown: {match.unknown.join(' · ')}</p>}
      {match.criteriaUsed.length > 0 && <details className="mt-1 text-xs">
        <summary className="cursor-pointer font-medium">Saved criteria used</summary>
        <ul className="list-disc pl-4">{match.criteriaUsed.map(value => <li key={value}>{value}</li>)}</ul>
      </details>}
      <details className="mt-1 text-xs">
        <summary className="cursor-pointer font-medium">Property facts and source provenance</summary>
        <ul className="list-disc pl-4">{match.propertyFactsUsed.map(value => <li key={value}>{value}</li>)}</ul>
        {match.provenanceUsed.length
          ? <ul className="mt-1 list-disc pl-4">{match.provenanceUsed.map(value => <li key={value}>{value}</li>)}</ul>
          : <p className="text-muted-foreground">No source provenance was supplied to this comparison.</p>}
      </details>
    </li>)}</ul> : <p className="mt-2 text-xs text-muted-foreground">No saved buyer records are available for comparison.</p>}
  </section>;
}
