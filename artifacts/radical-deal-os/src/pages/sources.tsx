import { useState } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetSourceResearchQueryKey, getSearchPublicPropertiesQueryKey, useDiscoverBuyer, useImportPublicProperty, useListPropertySources, useSearchPublicProperties,
  type PublicProperty, type SearchPublicPropertiesParams,
} from '@workspace/api-client-react';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorNotice, RowsSkeleton } from '@/components/state-views';
import { RecordFacts } from '@/components/source-research';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAccess } from '@/hooks/use-access';
import { useInvalidateWork } from '@/hooks/use-invalidate';
import { useToast } from '@/hooks/use-toast';

type Lane = 'properties' | 'buyer_candidates';

export default function Sources() {
  const { canResearch } = useAccess();
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const invalidate = useInvalidateWork();
  const { toast } = useToast();
  const [lane, setLane] = useState<Lane>('properties');
  const [zipIn, setZipIn] = useState('');
  const [zip, setZip] = useState('');
  const [terms, setTerms] = useState(false);
  const sources = useListPropertySources();
  const params: SearchPublicPropertiesParams = { lane, ...(zip ? { zip } : {}) };
  const search = useSearchPublicProperties(params, { query: { queryKey: getSearchPublicPropertiesQueryKey(params), staleTime: 30_000 } });
  const imp = useImportPublicProperty();
  const discover = useDiscoverBuyer();
  const src = search.data?.source ?? sources.data?.[0];
  const record = (r: PublicProperty) => discover.mutate({ data: { name: r.recordedOwner ?? '', source: `Philadelphia official tax record ${r.id} (${r.address}); recorded owner ${r.recordedOwner ?? 'n/a'}. OBSERVED corporate-owner research; not title, ownership of a buy box, or buying intent.`, sourceUrl: r.sourceUrl, capturedAt: r.capturedAt, confidence: 0.55 } }, {
    onSuccess: (b) => { invalidate(); toast({ title: 'Unverified prospect recorded', description: b.name }); nav(`/buyers/${b.id}`); },
  });
  const zipOk = zipIn === '' || /^191\d{2}$/.test(zipIn);

  const doImport = (r: PublicProperty) => imp.mutate({ recordId: r.id, data: { termsReviewed: terms } }, {
    onSuccess: (res) => {
      invalidate(res.leadId);
      qc.invalidateQueries({ queryKey: getGetSourceResearchQueryKey(res.leadId) });
      toast({ title: res.created ? 'Lead created from public record' : 'Already imported, opened existing lead', description: r.address });
      nav(`/deals/${res.leadId}`);
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Discovery" title="Sources" />
      <section className="ledger p-4 text-sm" data-testid="panel-sources">
        {sources.isLoading && <RowsSkeleton rows={1} />}
        {sources.isError && <ErrorNotice error={sources.error} onRetry={() => sources.refetch()} />}
        {sources.data?.length === 0 && <p>No sources are supported.</p>}
        {sources.data?.map((s) => (
          <div key={s.id} className="mb-2"><p className="font-semibold">{s.name}</p><p className="text-muted-foreground">{s.coverage}</p>
            <p className="font-mono text-xs">Capabilities: {s.capabilities.join(', ')}</p>
            <ul className="list-disc pl-4 text-xs text-muted-foreground">{s.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
            <a className="text-xs underline" href={s.termsUrl} target="_blank" rel="noopener noreferrer" data-testid={`link-terms-${s.id}`}>Read source terms</a></div>))}
        <p className="mt-2 text-xs text-muted-foreground">Records are public tax facts only. No asking price, seller identity or contact, availability, title authority, ARV, repairs, buyer intent or funding is inferred.</p>
      </section>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-2 text-sm">{([['properties', 'Properties'], ['buyer_candidates', 'Corporate-owner research']] as const).map(([v, l]) => (
          <button key={v} type="button" onClick={() => setLane(v)} aria-pressed={lane === v} className={`border px-3 py-1.5 ${lane === v ? 'border-signal bg-card font-semibold' : 'border-border'}`} data-testid={`button-lane-${v}`}>{l}</button>))}</div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (zipOk) setZip(zipIn); }}>
          <Input className="w-32" inputMode="numeric" placeholder="ZIP (optional)" value={zipIn} onChange={(e) => setZipIn(e.target.value)} data-testid="input-source-zip" />
          <Button type="submit" variant="outline" disabled={!zipOk} data-testid="button-search-sources">Search</Button>
        </form>
      </div>
      {!zipOk && <p className="text-sm text-destructive">Only Philadelphia ZIP codes (191xx) are supported; leave blank to search the supported city.</p>}
      <label className="ledger flex items-start gap-2 p-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={terms} onChange={(e) => setTerms(e.target.checked)} data-testid="check-import-terms" />I reviewed the source terms{src ? ` for ${src.name}` : ''} and understand the coverage and limits above. Required before importing records or creating research candidates.</label>
      {lane === 'buyer_candidates' && <p className="ledger border-l-4 border-l-signal p-3 text-sm">Corporate-owner research only. These are not approved buyers: current buying intent, criteria, contact and funds are unknown until you verify them.</p>}
      {imp.error != null && <ErrorNotice error={imp.error} />}
      {discover.error != null && <ErrorNotice error={discover.error} />}
      {search.isLoading && <RowsSkeleton rows={5} />}
      {search.isError && <ErrorNotice error={search.error} onRetry={() => search.refetch()} />}
      {search.data && search.data.records.length === 0 && <EmptyState title="No records returned" body="Try another ZIP inside the stated coverage, or clear the ZIP filter." />}
      {search.data && search.data.records.length > 0 && (
        <ul className="space-y-2" data-testid="list-source-records">{search.data.records.map((r) => (
          <li key={r.id} className="ledger space-y-2 p-3" data-testid={`record-${r.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{r.address}, {r.city} {r.state} {r.zip} {r.entityCandidate && <span className="tag tone-muted ml-2">Entity owner</span>}</p>
              {lane === 'properties'
                ? <Button size="sm" disabled={!canResearch || !terms || imp.isPending} onClick={() => doImport(r)} data-testid={`button-import-${r.id}`}>{imp.isPending ? 'Importing...' : 'Import as lead'}</Button>
                : <Button size="sm" variant="outline" disabled={!canResearch || !terms || !r.recordedOwner || discover.isPending} onClick={() => record(r)} data-testid={`button-candidate-${r.id}`}>Record as unverified prospect</Button>}
            </div>
            <RecordFacts r={r} />
          </li>))}</ul>
      )}
      {!canResearch && <p className="text-xs text-muted-foreground">Your role can view source records but not import or record candidates.</p>}
    </div>
  );
}
