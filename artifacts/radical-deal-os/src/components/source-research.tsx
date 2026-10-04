import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetLeadQueryKey, getGetSourceResearchQueryKey, useAddSourceComps, useGetSourceResearch, useListPropertySources, useRefreshSourceResearch,
  type LeadDetail, type PublicProperty,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { ErrorNotice, RowsSkeleton } from '@/components/state-views';
import { useInvalidateWork } from '@/hooks/use-invalidate';
import { useToast } from '@/hooks/use-toast';
import { ago, fmtDate, money } from '@/lib/format';

export function RecordFacts({ r }: { r: PublicProperty }) {
  return (
    <dl className="grid gap-x-4 gap-y-1 font-mono text-xs sm:grid-cols-2">
      <div>Provenance: {r.classification} public record; verify current facts independently</div>
      <div>Type: {r.propertyType.replace(/_/g, ' ')} / {r.sqft ?? 'sqft n/a'} sqft / {r.beds ?? '?'} bd / {r.baths ?? '?'} ba</div>
      <div>Recorded owner (not the seller): {r.recordedOwner ?? 'not reported'}</div>
      <div>Assessed value (not ARV): {r.assessedValue == null ? 'not reported' : money(r.assessedValue)}</div>
      <div>Last reported sale (not asking): {r.lastSalePrice == null ? 'none reported' : `${money(r.lastSalePrice)}${r.lastSaleAt ? ` on ${fmtDate(r.lastSaleAt, false)}` : ''}`}</div>
      <div>Conditions: interior {r.interiorCondition ?? 'not reported'} / exterior {r.exteriorCondition ?? 'not reported'}</div>
      <div>Captured {ago(r.capturedAt)} / <a className="underline" href={r.sourceUrl} target="_blank" rel="noopener noreferrer">official record</a></div>
    </dl>
  );
}

export function SourceResearchPanel({ leadId, version, terminal, canResearch, onAdded }: {
  leadId: string; version: number; terminal: boolean; canResearch: boolean; onAdded: () => void;
}) {
  const qc = useQueryClient();
  const invalidate = useInvalidateWork();
  const { toast } = useToast();
  const [terms, setTerms] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const q = useGetSourceResearch(leadId, { query: { queryKey: getGetSourceResearchQueryKey(leadId), enabled: !!leadId, refetchInterval: 20_000 } });
  const sources = useListPropertySources();
  const refresh = useRefreshSourceResearch();
  const add = useAddSourceComps();
  const r = q.data?.research ?? null;
  const src = r?.source ?? sources.data?.[0];
  const readOnly = !canResearch || terminal;
  const after = () => { invalidate(leadId); qc.invalidateQueries({ queryKey: getGetSourceResearchQueryKey(leadId) }); };

  return (
    <section className="space-y-4" data-testid="panel-source-research">
      <div className="ledger p-4 text-sm">
        <p className="eyebrow mb-2">Official source research</p>
        <p>OBSERVED tax-record reports for this property and sale records nearby. They prepare underwriting; they do not set a price, identify the seller, confirm title, or establish ARV, repairs or any buyer's intent.</p>
        {src && <p className="mt-2 text-xs text-muted-foreground">{src.name}: {src.coverage} <a className="underline" href={src.termsUrl} target="_blank" rel="noopener noreferrer" data-testid="link-source-terms">Source terms</a></p>}
        {src && src.limitations.length > 0 && <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">{src.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>}
      </div>
      {q.isLoading && <RowsSkeleton rows={3} />}
      {q.isError && <ErrorNotice error={q.error} onRetry={() => q.refetch()} />}
      {q.data && !r && <p className="ledger p-4 text-sm text-muted-foreground" data-testid="empty-source-research">No source research is saved for this lead. Import a property from Sources, or refresh below if the address is covered.</p>}
      {r && (
        <>
          <div className="ledger p-4"><p className="eyebrow mb-1">Subject record / saved {ago(r.capturedAt)}</p><p className="mb-2 font-semibold">{r.subject.address}, {r.subject.city} {r.subject.zip}</p><RecordFacts r={r.subject} />
            {r.limitations.length > 0 && <ul className="mt-2 list-disc pl-4 text-xs text-muted-foreground">{r.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>}</div>
          <div>
            <p className="eyebrow mb-2">Sold-record candidates ({r.candidates.length})</p>
            {r.candidates.length === 0 ? <p className="ledger p-3 text-sm text-muted-foreground">The source returned no usable sold records.</p> : (
              <ul className="space-y-2">{r.candidates.map((c) => {
                const on = picked.includes(c.record.id);
                return (
                  <li key={c.record.id} className={`ledger p-3 ${on ? 'border-signal' : ''}`} data-testid={`candidate-${c.record.id}`}>
                    <label className="flex items-start gap-3">
                      <input type="checkbox" className="mt-1 h-4 w-4" checked={on} disabled={readOnly} onChange={() => setPicked(on ? picked.filter((x) => x !== c.record.id) : [...picked, c.record.id].slice(0, 30))} data-testid={`check-candidate-${c.record.id}`} />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2"><b>{c.comp.address}</b><span className="tag tone-warn">Unverified</span><span className="tag tone-muted">Condition UNKNOWN</span></span>
                        <span className="block font-mono text-xs">{money(c.comp.salePrice)} / {c.comp.sqft} sqft / {c.comp.distanceMiles.toFixed(2)} mi / sold {fmtDate(c.comp.soldAt, false)}</span>
                        {c.reasons.length > 0 && <span className="block text-xs text-muted-foreground">{c.reasons.join('; ')}</span>}
                      </span>
                    </label>
                  </li>);
              })}</ul>
            )}
          </div>
          <div className="ledger space-y-2 border-l-4 border-l-signal p-3 text-sm">
            <p>Adding selected records saves them as comps with verified = false and condition = UNKNOWN, recalculates the underwriting review snapshot, and may invalidate an existing offer approval. It does not make ARV call-ready; a person must still verify comps and confirm condition.</p>
            {add.error != null && <ErrorNotice error={add.error} />}
            <Button disabled={readOnly || picked.length === 0 || add.isPending} data-testid="button-add-source-comps"
              onClick={() => add.mutate({ id: leadId, data: { version, recordIds: picked } }, { onSuccess: (detail: LeadDetail) => { qc.setQueryData(getGetLeadQueryKey(leadId), detail); after(); setPicked([]); onAdded(); toast({ title: 'Source comps added', description: 'Unverified, condition unknown. Review underwriting.' }); } })}>
              {add.isPending ? 'Adding...' : `Add ${picked.length} selected as unverified comps`}</Button>
          </div>
        </>
      )}
      <div className="ledger space-y-2 p-3 text-sm">
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 h-4 w-4" checked={terms} disabled={readOnly} onChange={(e) => setTerms(e.target.checked)} data-testid="check-refresh-terms" />I reviewed the source terms and will use this data accordingly.</label>
        {refresh.error != null && <ErrorNotice error={refresh.error} />}
        <Button variant="outline" disabled={readOnly || !terms || refresh.isPending} data-testid="button-refresh-source"
          onClick={() => refresh.mutate({ id: leadId, data: { version, termsReviewed: terms } }, { onSuccess: () => { after(); toast({ title: 'Source research refreshed' }); } })}>{refresh.isPending ? 'Refreshing...' : 'Refresh from source'}</Button>
        {readOnly && <p className="text-xs text-muted-foreground">{terminal ? 'This deal is closed or dead, so source research is read-only.' : 'Your role can read source research but not change it.'}</p>}
      </div>
    </section>
  );
}
