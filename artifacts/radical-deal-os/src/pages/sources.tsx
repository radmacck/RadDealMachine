import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetCommandCenterQueryKey, getListPropertyDiscoveriesQueryKey, getSearchPublicPropertiesQueryKey,
  useAddPropertyRelevanceSignal, useDisqualifyPropertyDiscovery, useDiscoverBuyer, useListPropertyDiscoveries,
  useGetPropertySourceCoverage, usePromotePropertyDiscovery, useRecordPublicPropertyDiscovery,
  useSavePropertyDiscoveryCriteria, useSearchPublicProperties,
  type PropertyEvidenceClassification, type PropertyEvidenceSourceType, type PropertySignalKey,
  type PropertyDiscoveryStatus, type PropertySignalGroup, type PublicProperty, type SearchPublicPropertiesParams,
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
  const { canResearch, access } = useAccess();
  const canReviewDiscovery = ['OWNER', 'OPERATOR', 'ANALYST'].includes(access.role);
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const invalidate = useInvalidateWork();
  const { toast } = useToast();
  const [lane, setLane] = useState<Lane>('properties');
  const [zipIn, setZipIn] = useState('');
  const [zip, setZip] = useState('');
  const [terms, setTerms] = useState(false);
  const [statusFilter, setStatusFilter] = useState<PropertyDiscoveryStatus | 'ALL'>(() =>
    new URLSearchParams(window.location.search).get('discovery') ? 'ALL' : 'RELEVANT_CANDIDATE');
  const [openDiscoveryId, setOpenDiscoveryId] = useState(() => new URLSearchParams(window.location.search).get('discovery') ?? '');
  const [signalKey, setSignalKey] = useState<PropertySignalKey>('SELLER_MOTIVATION');
  const [signalClassification, setSignalClassification] = useState<PropertyEvidenceClassification>('INDICATED');
  const [signalSourceType, setSignalSourceType] = useState<PropertyEvidenceSourceType>('SELLER');
  const [signalStatement, setSignalStatement] = useState('');
  const [signalSource, setSignalSource] = useState('');
  const [signalSourceUrl, setSignalSourceUrl] = useState('');
  const [signalEvidenceRef, setSignalEvidenceRef] = useState('');
  const [signalConfidence, setSignalConfidence] = useState('0.7');
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const [passReasons, setPassReasons] = useState<Record<string, string>>({});
  const [candidateThreshold, setCandidateThreshold] = useState('');
  const [qualifiedThreshold, setQualifiedThreshold] = useState('');
  const [minimumGroups, setMinimumGroups] = useState('2');
  const [longHoldYears, setLongHoldYears] = useState('10');
  const [requiredGroups, setRequiredGroups] = useState<PropertySignalGroup[]>([]);
  const [signalRules, setSignalRules] = useState<Array<{ key: PropertySignalKey; points: number; enabled: boolean }>>([]);
  const sourceCoverage = useGetPropertySourceCoverage();
  const params: SearchPublicPropertiesParams = { lane, ...(zip ? { zip } : {}) };
  const search = useSearchPublicProperties(params, { query: { queryKey: getSearchPublicPropertiesQueryKey(params), staleTime: 30_000 } });
  const discoveryParams = { marketKey: 'PHILADELPHIA_PA', limit: 100, ...(statusFilter !== 'ALL' ? { status: statusFilter } : {}) };
  const discoveries = useListPropertyDiscoveries(discoveryParams);
  const recordDiscovery = useRecordPublicPropertyDiscovery();
  const addSignal = useAddPropertyRelevanceSignal();
  const promoteDiscovery = usePromotePropertyDiscovery();
  const passDiscovery = useDisqualifyPropertyDiscovery();
  const saveCriteria = useSavePropertyDiscoveryCriteria();
  const discover = useDiscoverBuyer();
  const src = search.data?.source ?? sourceCoverage.data?.registeredSources[0];
  const criterion = discoveries.data?.criteria;
  useEffect(() => {
    if (criterion) {
      setCandidateThreshold(String(criterion.candidateThreshold));
      setQualifiedThreshold(String(criterion.qualifiedLeadThreshold));
      setMinimumGroups(String(criterion.minimumIndependentSignalGroups));
      setLongHoldYears(String(criterion.longHoldYears));
      setRequiredGroups(criterion.requiredLeadGroupAnyOf);
      setSignalRules(criterion.signalRules);
    }
  }, [criterion?.version, criterion?.candidateThreshold, criterion?.qualifiedLeadThreshold]);
  const invalidateDiscoveries = () => {
    invalidate();
    qc.invalidateQueries({ queryKey: getListPropertyDiscoveriesQueryKey({ marketKey: 'PHILADELPHIA_PA', limit: 100 }) });
    qc.invalidateQueries({ queryKey: getGetCommandCenterQueryKey() });
  };
  const record = (r: PublicProperty) => discover.mutate({ data: { name: r.recordedOwner ?? '', source: `Philadelphia official tax record ${r.id} (${r.address}); recorded owner ${r.recordedOwner ?? 'n/a'}. OBSERVED corporate-owner research; not title, ownership of a buy box, or buying intent.`, sourceUrl: r.sourceUrl, capturedAt: r.capturedAt, confidence: 0.55 } }, {
    onSuccess: (b) => { invalidate(); toast({ title: 'Unverified prospect recorded', description: b.name }); nav(`/buyers/${b.id}`); },
  });
  const zipOk = zipIn === '' || /^191\d{2}$/.test(zipIn);

  const doSaveDiscovery = (r: PublicProperty) => recordDiscovery.mutate({ recordId: r.id, data: { termsReviewed: terms } }, {
    onSuccess: (res) => {
      invalidateDiscoveries();
      setOpenDiscoveryId(res.id);
      toast({ title: 'Source observation saved', description: `${r.address} remains a ${res.status.replaceAll('_', ' ').toLowerCase()}, not an active lead.` });
    },
  });
  const addEvidence = (id: string, version: number) => addSignal.mutate({
    id,
    data: {
      version, key: signalKey, group: ({
        ENTITY_OWNER: 'OWNERSHIP_CONTEXT', LONG_TERM_HOLD: 'OWNERSHIP_CONTEXT', REPORTED_POOR_CONDITION: 'CONDITION',
        OPEN_CODE_VIOLATION: 'CONDITION', UNSAFE_BUILDING_RECORD: 'DISTRESS',
        SELLER_MOTIVATION: 'MOTIVATION', TAX_DELINQUENCY: 'DISTRESS', FORECLOSURE: 'DISTRESS', PROBATE: 'DISTRESS',
        ABSENTEE_OWNER: 'OWNERSHIP_CONTEXT', STALE_LISTING: 'LISTING_PRESSURE', REPEATED_PRICE_REDUCTION: 'LISTING_PRESSURE',
        BELOW_MARKET: 'FINANCIAL_OPPORTUNITY', VACANCY: 'VACANCY', EQUITY_OPPORTUNITY: 'FINANCIAL_OPPORTUNITY',
        MARKET_FIT: 'MARKET_FIT',
      } satisfies Record<PropertySignalKey, PropertySignalGroup>)[signalKey],
      classification: signalClassification, sourceType: signalSourceType,
      statement: signalStatement, source: signalSource,
      sourceUrl: signalSourceUrl.trim() || null, evidenceRef: signalEvidenceRef.trim() || null,
      capturedAt: new Date().toISOString(), confidence: Number(signalConfidence),
    },
  }, {
    onSuccess: () => {
      invalidateDiscoveries();
      setSignalStatement('');
      toast({ title: 'Evidence saved', description: 'The relevance score and qualification blockers were recalculated.' });
    },
  });
  const promote = (id: string, version: number) => promoteDiscovery.mutate({
    id,
    data: { version, reviewReason: reviewReasons[id] ?? '' },
  }, {
    onSuccess: (result) => {
      invalidateDiscoveries();
      toast({ title: 'Qualified lead created', description: 'It is now in the seller-side acquisition queue; call readiness remains separate.' });
      nav(`/deals/${result.leadId}`);
    },
  });
  const pass = (id: string, version: number) => passDiscovery.mutate({
    id, data: { version, reason: passReasons[id] ?? '' },
  }, {
    onSuccess: () => {
      invalidateDiscoveries();
      toast({ title: 'Discovery passed', description: 'The raw source observation remains available; no active lead was created.' });
    },
  });
  const saveMarketCriteria = () => {
    if (!criterion) return;
    saveCriteria.mutate({
      marketKey: 'PHILADELPHIA_PA',
      data: {
        candidateThreshold: Number(candidateThreshold),
        qualifiedLeadThreshold: Number(qualifiedThreshold),
        minimumIndependentSignalGroups: Number(minimumGroups),
        requiredLeadGroupAnyOf: requiredGroups,
        longHoldYears: Number(longHoldYears),
        signalRules,
      },
    }, {
      onSuccess: () => { invalidateDiscoveries(); toast({ title: 'Philadelphia criteria saved' }); },
    });
  };

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Discovery" title="Sources" />
      <section className="ledger p-4 text-sm" data-testid="panel-sources">
        {sourceCoverage.isLoading && <RowsSkeleton rows={1} />}
        {sourceCoverage.isError && <ErrorNotice error={sourceCoverage.error} onRetry={() => sourceCoverage.refetch()} />}
        {sourceCoverage.data?.registeredSources.length === 0 && <p>No property source adapters are registered.</p>}
        <h2 className="font-semibold">Connected source adapters</h2>
        <p className="mb-3 text-xs text-muted-foreground">These adapters are wired to real source operations; an individual run can still fail and its result is reported separately.</p>
        {sourceCoverage.data?.registeredSources.map((s) => (
          <div key={s.id} className="mb-2"><p className="font-semibold">{s.name}</p><p className="text-muted-foreground">{s.coverage}</p>
            <p className="font-mono text-xs">Capabilities: {s.capabilities.join(', ')}</p>
            <ul className="list-disc pl-4 text-xs text-muted-foreground">{s.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
            <a className="text-xs underline" href={s.termsUrl} target="_blank" rel="noopener noreferrer" data-testid={`link-terms-${s.id}`}>Read source terms</a></div>))}
        <div className="mt-4 border-t pt-3" data-testid="panel-unconnected-source-capabilities">
          <h2 className="font-semibold">Not connected — not polled</h2>
          <p className="mb-3 text-xs text-muted-foreground">These are explicit coverage gaps, not active feeds or connector promises. No collection is attempted until a permitted access route is verified.</p>
          {sourceCoverage.data?.notConnectedProviders.map((provider) => (
            <article key={provider.id} className="mb-3 rounded border p-3" data-testid={`unconnected-source-${provider.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium">{provider.name}</h3>
                <span className="tag tone-muted">{provider.status.replaceAll('_', ' ')}</span>
                <span className="text-xs text-muted-foreground">{provider.category.replaceAll('_', ' ')}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{provider.coverage}</p>
              <p className="mt-1 text-xs">{provider.reason}</p>
              <p className="mt-1 text-xs text-muted-foreground">Next: {provider.nextAction}</p>
            </article>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Each source is an observation, not a verified seller, buyer, condition or opportunity. No tax delinquency is inferred from geographically aggregated tax balances; no asking price, contact permission, availability, title authority, repair cost, ARV, buyer intent or funding is inferred.</p>
      </section>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-2 text-sm">{([['properties', 'Property records'], ['buyer_candidates', 'Buyer activity signals']] as const).map(([v, l]) => (
          <button key={v} type="button" onClick={() => { setLane(v); setTerms(false); }} aria-pressed={lane === v} className={`border px-3 py-1.5 ${lane === v ? 'border-signal bg-card font-semibold' : 'border-border'}`} data-testid={`button-lane-${v}`}>{l}</button>))}</div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (zipOk) setZip(zipIn); }}>
          <Input className="w-32" inputMode="numeric" placeholder="ZIP (optional)" value={zipIn} onChange={(e) => setZipIn(e.target.value)} data-testid="input-source-zip" />
          <Button type="submit" variant="outline" disabled={!zipOk} data-testid="button-search-sources">Search</Button>
        </form>
      </div>
      {!zipOk && <p className="text-sm text-destructive">Only Philadelphia ZIP codes (191xx) are supported; leave blank to search the supported city.</p>}
      <label className="ledger flex items-start gap-2 p-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={terms} onChange={(e) => setTerms(e.target.checked)} data-testid="check-import-terms" /><span>I reviewed the terms linked above for the source(s) I am using and understand their limits. Saving a property runs exact-parcel L&amp;I/unsafe-building/vacancy checks; results remain source observations and do not automatically create an active lead.</span></label>
      <section className="ledger space-y-4 p-4" data-testid="panel-discovery-queue">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Seller acquisition · Philadelphia</p>
            <h2 className="text-xl font-semibold">Property qualification queue</h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">A source record is only a discovery. Evidence moves it to candidate, a human-reviewed qualification creates a lead, and existing authority and contact gates still control call readiness.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs" aria-label="Property discovery counts">
            {discoveries.data && Object.entries(discoveries.data.counts).map(([key, value]) => (
              <span key={key} className="tag tone-muted">{key.replaceAll('_', ' ')} · {value}</span>
            ))}
          </div>
        </div>
        {criterion && canReviewDiscovery && (
          <details className="rounded border p-3">
            <summary className="cursor-pointer text-sm font-medium">Market criteria · version {criterion.version}</summary>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="grid gap-1 text-xs">Candidate score
                <Input type="number" min={1} max={100} value={candidateThreshold} onChange={(e) => setCandidateThreshold(e.target.value)} className="w-28" />
              </label>
              <label className="grid gap-1 text-xs">Qualified lead score
                <Input type="number" min={1} max={100} value={qualifiedThreshold} onChange={(e) => setQualifiedThreshold(e.target.value)} className="w-28" />
              </label>
              <label className="grid gap-1 text-xs">Independent groups
                <Input type="number" min={2} max={8} value={minimumGroups} onChange={(e) => setMinimumGroups(e.target.value)} className="w-28" />
              </label>
              <label className="grid gap-1 text-xs">Long-hold years
                <Input type="number" min={1} max={100} value={longHoldYears} onChange={(e) => setLongHoldYears(e.target.value)} className="w-28" />
              </label>
              <span className="max-w-md text-xs text-muted-foreground">A lead needs the score threshold, the chosen independent evidence groups, and at least one selected opportunity group.</span>
              <div className="basis-full">
                <p className="mb-1 text-xs font-medium">A qualified lead must include at least one of these evidence groups:</p>
                <div className="flex flex-wrap gap-3">
                  {(['MOTIVATION', 'DISTRESS', 'LISTING_PRESSURE', 'VACANCY', 'OWNERSHIP_CONTEXT', 'CONDITION', 'FINANCIAL_OPPORTUNITY', 'MARKET_FIT'] as PropertySignalGroup[]).map((group) => (
                    <label key={group} className="flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={requiredGroups.includes(group)} onChange={(e) => setRequiredGroups((current) => e.target.checked ? [...current, group] : current.filter((item) => item !== group))} />
                      {group.replaceAll('_', ' ').toLowerCase()}
                    </label>
                  ))}
                </div>
              </div>
              <details className="basis-full rounded border p-3">
                <summary className="cursor-pointer text-xs font-medium">Signal weights and active signals</summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {signalRules.map((rule, index) => (
                    <label key={rule.key} className="flex items-center justify-between gap-3 rounded border p-2 text-xs">
                      <span className="flex items-center gap-2">
                        <input type="checkbox" checked={rule.enabled} onChange={(e) => setSignalRules((current) => current.map((item, i) => i === index ? { ...item, enabled: e.target.checked } : item))} />
                        {rule.key.replaceAll('_', ' ').toLowerCase()}
                      </span>
                      <span className="flex items-center gap-1">points
                        <Input type="number" min={0} max={100} value={rule.points} className="h-8 w-20" onChange={(e) => setSignalRules((current) => current.map((item, i) => i === index ? { ...item, points: Number(e.target.value) } : item))} />
                      </span>
                    </label>
                  ))}
                </div>
              </details>
              <Button type="button" variant="outline" disabled={!candidateThreshold || !qualifiedThreshold || Number(candidateThreshold) >= Number(qualifiedThreshold) || Number(minimumGroups) < 2 || Number(longHoldYears) < 1 || requiredGroups.length === 0 || saveCriteria.isPending} onClick={saveMarketCriteria}>
                {saveCriteria.isPending ? 'Saving…' : 'Save market criteria'}
              </Button>
            </div>
            {saveCriteria.error && <ErrorNotice error={saveCriteria.error} />}
          </details>
        )}
        {!!discoveries.data?.unmatchedSourceObservations.length && (
          <section className="rounded border border-dashed p-3" data-testid="panel-unmatched-source-observations">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h3 className="font-semibold">Unmatched public-source records</h3>
                <p className="text-sm text-muted-foreground">
                  {discoveries.data.unmatchedSourceObservations.length} raw record(s) have no exact residential OPA match. They remain evidence only—not property candidates or leads.
                </p>
              </div>
              <span className="tag tone-muted">Not in acquisition queue</span>
            </div>
            <div className="mt-3 space-y-2">
              {discoveries.data.unmatchedSourceObservations.map((observation) => (
                <article key={observation.id} className="rounded border bg-background p-3 text-sm" data-testid={`unmatched-source-${observation.id}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{observation.sourceName} · OPA account {observation.propertyId}</p>
                      <p className="text-xs text-muted-foreground">
                        {observation.recordCount} source record(s) · {observation.classification ?? 'Unclassified'} · confidence {observation.confidence === null ? 'not assigned' : `${Math.round(observation.confidence * 100)}%`}
                      </p>
                    </div>
                    <a className="text-xs underline" href={observation.sourceUrl} target="_blank" rel="noopener noreferrer">Open public source</a>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Source record IDs: {observation.recordIdentities.length ? observation.recordIdentities.join(', ') : 'none supplied'} · first seen {new Date(observation.firstObservedAt).toLocaleDateString()} · last seen {new Date(observation.lastObservedAt).toLocaleDateString()} · seen {observation.seenCount} time(s)
                  </p>
                  <p className="mt-2 text-xs">{observation.nextAction} The system retries exact matching on the next discovery refresh.</p>
                  {observation.history.length > 0 && (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer">Prior source observations ({observation.history.length})</summary>
                      <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
                        {observation.history.map((version, index) => (
                          <li key={`${version.observedAt}-${index}`}>{new Date(version.observedAt).toLocaleString()} · {version.state} · {version.recordCount} record(s) · {version.classification ?? 'unclassified'}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="grid gap-1 text-xs">Show
            <select className="h-9 rounded border bg-background px-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as PropertyDiscoveryStatus | 'ALL')} data-testid="select-discovery-status">
              <option value="RELEVANT_CANDIDATE">Relevant candidates</option>
              <option value="DISCOVERED_PROPERTY">Raw discoveries</option>
              <option value="QUALIFIED_LEAD">Qualified leads</option>
              <option value="CALL_READY">Call ready</option>
              <option value="DISQUALIFIED">Passed</option>
              <option value="ALL">All qualification states</option>
            </select>
          </label>
          <span className="text-xs text-muted-foreground">Owner-linked properties remain separate parcels. Repeated source records attach to one property discovery.</span>
        </div>
        {discoveries.isLoading && <RowsSkeleton rows={2} />}
        {discoveries.isError && <ErrorNotice error={discoveries.error} onRetry={() => discoveries.refetch()} />}
        {recordDiscovery.error && <ErrorNotice error={recordDiscovery.error} />}
        {addSignal.error && <ErrorNotice error={addSignal.error} />}
        {promoteDiscovery.error && <ErrorNotice error={promoteDiscovery.error} />}
        {passDiscovery.error && <ErrorNotice error={passDiscovery.error} />}
        {discoveries.data && discoveries.data.records.length === 0 && (
          <EmptyState
            title={statusFilter === 'RELEVANT_CANDIDATE' ? 'No relevant candidates to review' : 'No properties in this state'}
            body={statusFilter === 'RELEVANT_CANDIDATE'
              ? `There are ${discoveries.data.counts.DISCOVERED_PROPERTY} raw discoveries and ${discoveries.data.counts.RELEVANT_CANDIDATE} candidates. Save a source observation from below; do not promote a record without sourced motivation, distress, listing pressure, or vacancy evidence.`
              : 'Properties only appear here after their source observation has been saved.'}
          />
        )}
        {discoveries.data && discoveries.data.records.length > 0 && (
          <ol className="space-y-3" data-testid="list-property-discoveries">
            {discoveries.data.records.map((item) => (
              <li key={item.id} className="rounded border p-3" data-testid={`discovery-${item.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{item.property.address}, {item.property.city} {item.property.state} {item.property.zip}</h3>
                      <span className={`tag ${item.status === 'QUALIFIED_LEAD' || item.status === 'CALL_READY' ? 'tone-go' : item.status === 'RELEVANT_CANDIDATE' ? 'tone-warn' : item.status === 'DISQUALIFIED' ? 'tone-muted' : 'tone-ink'}`}>{item.status.replaceAll('_', ' ')}</span>
                      <span className="tag tone-muted">{item.score}/100 · {Math.round(item.confidence * 100)}% confidence</span>
                    </div>
                    <p className="mt-1 text-sm">{item.reason}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Next: {item.nextAction}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Source observations: {item.sourceObservationCount} · properties with recorded owner: {item.relatedOwnerPropertyCount} · first seen {new Date(item.firstObservedAt).toLocaleDateString()} · last seen {new Date(item.lastObservedAt).toLocaleDateString()}</p>
                  </div>
                  {item.leadId && <Button size="sm" variant="outline" onClick={() => nav(`/deals/${item.leadId}`)}>Open active lead</Button>}
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="rounded bg-muted/40 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide">Evidence and signals</p>
                    {item.signals.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">No relevance signals. The property remains a raw discovery.</p> : (
                      <ul className="mt-1 space-y-1 text-sm">
                        {item.signals.map((signal) => <li key={signal.id}>
                          <b>{signal.key.replaceAll('_', ' ')}</b> · {signal.classification.replaceAll('_', ' ')} · {signal.group.replaceAll('_', ' ')} · +{signal.scoreContribution}
                          <span className="block text-xs text-muted-foreground">{signal.statement} — {signal.source}{signal.evidenceRef ? ` · ${signal.evidenceRef}` : ''} · confidence {signal.confidence} · captured {new Date(signal.capturedAt).toLocaleString()}{signal.sourceUrl && <> · <a className="underline" href={signal.sourceUrl} target="_blank" rel="noopener noreferrer">source record</a></>}</span>
                        </li>)}
                      </ul>
                    )}
                  </div>
                  <div className="rounded bg-muted/40 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide">Known and missing</p>
                    <p className="mt-1 text-xs">Observed: {item.property.propertyType}; recorded owner {item.property.recordedOwner ?? 'not present'}; source assessment {item.property.assessedValue == null ? 'not present' : `$${item.property.assessedValue.toLocaleString()}`} (not ARV).</p>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">{item.missingInformation.slice(0, 5).map((missing) => <li key={missing}>{missing}</li>)}</ul>
                    {item.promotionBlockers.length > 0 && <p className="mt-2 text-xs text-destructive">Promotion blocked: {item.promotionBlockers.join(' ')}</p>}
                    <div className="mt-3 border-t border-border pt-3" data-testid={`contact-path-${item.id}`}>
                      <p className="text-xs font-semibold uppercase tracking-wide">Best available contact path</p>
                      {item.property.contactPaths[0] ? (() => {
                        const path = item.property.contactPaths[0]!;
                        const route = path.channel === 'POSTAL'
                          ? [path.recipient, ...(path.addressLines ?? []), path.cityState, path.postalCode].filter(Boolean).join(' · ')
                          : path.routeValue ?? 'Route value not supplied';
                        return <>
                          <p className="mt-1 text-sm">{route}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {path.channel} route · {path.classification} · confidence {path.confidence} ·
                            {" "}{path.freshnessStatus} through {new Date(path.freshUntilAt).toLocaleDateString()} ·
                            {" "}contact permission {path.permissionStatus.replaceAll("_", " ").toLowerCase()}.
                            {path.channel === 'POSTAL'
                              ? " This is a mailing route only; it cannot be used as a phone or email route and does not establish signing authority."
                              : " Public availability does not establish signing authority or permission to contact."}
                          </p>
                          <a className="text-xs underline" href={path.sourceUrl} target="_blank" rel="noopener noreferrer">
                            {path.sourceName} record {path.sourceRecordId}
                          </a>
                        </>;
                      })() : <p className="mt-1 text-xs text-muted-foreground">No contact route is present in this source observation. Do not infer seller identity, signing authority, or contact permission.</p>}
                    </div>
                  </div>
                </div>
                <div className="mt-3 rounded bg-muted/40 p-3" data-testid={`buyer-demand-${item.id}`}>
                  <p className="text-xs font-semibold uppercase tracking-wide">Current buyer demand · early coverage, not a deal match</p>
                  <p className="mt-1 text-sm">
                    {item.demandFit.alignedBuyerCount} current approved buyer profile(s) align with known market/property fields
                    {" "}({item.demandFit.currentQualifiedBuyerCount} current approved in the buyer network).
                    {" "}Demand bonus +{item.demandFit.priorityBonus} affects discovery ranking only; seller qualification score and promotion gates are unchanged.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{item.demandFit.reason}</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                    {item.demandFit.missingInformation.slice(0, 4).map((missing) => <li key={missing}>{missing}</li>)}
                  </ul>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.demandFit.snapshotFresh ? "Saved demand snapshot matches current buyer evidence." : "Live buyer evidence is used here; the saved ranking snapshot is waiting for the durable refresh worker."}
                  </p>
                </div>
                <div className="mt-3 rounded bg-muted/40 p-3" data-testid={`source-observations-${item.id}`}>
                  <p className="text-xs font-semibold uppercase tracking-wide">Source refresh trail</p>
                  <ul className="mt-1 space-y-2 text-xs">
                    {item.sourceObservations.map((observation) => (
                      <li key={observation.id} className="border-t border-border pt-2">
                        <b>{observation.sourceName}</b> · {observation.state.replaceAll('_', ' ').toLowerCase()} · {observation.recordCount} record(s) · {observation.seenCount} capture(s)
                        {observation.classification && ` · ${observation.classification.replaceAll('_', ' ')}${observation.confidence != null ? ` · confidence ${observation.confidence}` : ''}`}
                        <span className="block text-muted-foreground">IDs: {observation.recordIdentities.join(', ') || 'none returned'}{observation.latestSourceEventAt ? ` · latest source event ${new Date(observation.latestSourceEventAt).toLocaleDateString()}` : ''} · first {new Date(observation.firstObservedAt).toLocaleString()} · last {new Date(observation.lastObservedAt).toLocaleString()}</span>
                        <a className="underline" href={observation.sourceUrl} target="_blank" rel="noopener noreferrer">Source page / terms</a>
                        {!!observation.history.length && <details className="mt-1">
                          <summary className="cursor-pointer text-muted-foreground">Prior source versions ({observation.history.length})</summary>
                          <ul className="mt-1 space-y-1 pl-3">
                            {observation.history.map((prior, index) => <li key={`${prior.observedAt}-${index}`}>
                              {new Date(prior.observedAt).toLocaleString()} · {prior.state.replaceAll('_', ' ').toLowerCase()} · {prior.recordCount} record(s) · {prior.recordIdentities.join(', ') || 'no record IDs'}
                              {prior.classification && ` · ${prior.classification.replaceAll('_', ' ')}${prior.confidence != null ? ` · confidence ${prior.confidence}` : ''}`}
                            </li>)}
                          </ul>
                        </details>}
                      </li>
                    ))}
                  </ul>
                </div>
                {canReviewDiscovery && !['QUALIFIED_LEAD', 'CALL_READY', 'DISQUALIFIED'].includes(item.status) && (
                  <details className="mt-3 rounded border p-3" open={openDiscoveryId === item.id} onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) setOpenDiscoveryId(item.id); }}>
                    <summary className="cursor-pointer text-sm font-medium">Add sourced evidence or decide this candidate</summary>
                    <div className="mt-3 space-y-3">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="grid gap-1 text-xs">Signal
                          <select className="h-9 rounded border bg-background px-2 text-sm" value={signalKey} onChange={(e) => setSignalKey(e.target.value as PropertySignalKey)}>
                            {(['ENTITY_OWNER', 'LONG_TERM_HOLD', 'REPORTED_POOR_CONDITION', 'OPEN_CODE_VIOLATION', 'UNSAFE_BUILDING_RECORD', 'SELLER_MOTIVATION', 'TAX_DELINQUENCY', 'FORECLOSURE', 'PROBATE', 'ABSENTEE_OWNER', 'STALE_LISTING', 'REPEATED_PRICE_REDUCTION', 'BELOW_MARKET', 'VACANCY', 'EQUITY_OPPORTUNITY', 'MARKET_FIT'] as PropertySignalKey[]).map((key) => <option key={key} value={key}>{key.replaceAll('_', ' ')}</option>)}
                          </select>
                        </label>
                        <label className="grid gap-1 text-xs">Evidence source type
                          <select className="h-9 rounded border bg-background px-2 text-sm" value={signalSourceType} onChange={(e) => setSignalSourceType(e.target.value as PropertyEvidenceSourceType)}>
                            {(['PUBLIC_RECORD', 'PERMITTED_LISTING', 'SELLER', 'INSPECTION', 'PUBLIC_PAGE', 'ANALYST', 'MODEL'] as PropertyEvidenceSourceType[]).map((sourceType) => <option key={sourceType} value={sourceType}>{sourceType.replaceAll('_', ' ')}</option>)}
                          </select>
                        </label>
                        <label className="grid gap-1 text-xs">Evidence classification
                          <select className="h-9 rounded border bg-background px-2 text-sm" value={signalClassification} onChange={(e) => setSignalClassification(e.target.value as PropertyEvidenceClassification)}>
                            {(['VERIFIED', 'OBSERVED', 'INDICATED', 'AI_HYPOTHESIS'] as PropertyEvidenceClassification[]).map((classification) => <option key={classification} value={classification}>{classification.replaceAll('_', ' ')}</option>)}
                          </select>
                        </label>
                        <label className="grid gap-1 text-xs">Confidence (0–1)
                          <Input type="number" min="0" max="1" step="0.05" value={signalConfidence} onChange={(e) => setSignalConfidence(e.target.value)} />
                        </label>
                      </div>
                      <label className="grid gap-1 text-xs">What does the evidence actually say?
                        <textarea className="min-h-20 rounded border bg-background p-2 text-sm" value={signalStatement} onChange={(e) => setSignalStatement(e.target.value)} placeholder="Record the source statement without adding assumptions." />
                      </label>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <label className="grid gap-1 text-xs">Source name<Input value={signalSource} onChange={(e) => setSignalSource(e.target.value)} placeholder="Public record, seller call, inspection…" /></label>
                        <label className="grid gap-1 text-xs">Source URL<Input type="url" value={signalSourceUrl} onChange={(e) => setSignalSourceUrl(e.target.value)} placeholder="https://…" /></label>
                        <label className="grid gap-1 text-xs">Specific evidence reference<Input value={signalEvidenceRef} onChange={(e) => setSignalEvidenceRef(e.target.value)} placeholder="Document/page/call reference" /></label>
                      </div>
                      <Button type="button" variant="outline" disabled={!signalStatement.trim() || !signalSource.trim() || (!signalSourceUrl.trim() && !signalEvidenceRef.trim()) || addSignal.isPending} onClick={() => addEvidence(item.id, item.version)}>
                        {addSignal.isPending ? 'Saving evidence…' : 'Save and recalculate relevance'}
                      </Button>
                      {item.canPromote && <div className="rounded border border-signal/40 p-3">
                        <p className="text-sm font-semibold">Qualification gate passed. Human review is still required.</p>
                        <label className="mt-2 grid gap-1 text-xs">Why should this enter active acquisition work?
                          <textarea className="min-h-16 rounded border bg-background p-2 text-sm" value={reviewReasons[item.id] ?? ''} onChange={(e) => setReviewReasons((current) => ({ ...current, [item.id]: e.target.value }))} />
                        </label>
                        <Button className="mt-2" type="button" disabled={(reviewReasons[item.id] ?? '').trim().length < 8 || promoteDiscovery.isPending} onClick={() => promote(item.id, item.version)}>
                          {promoteDiscovery.isPending ? 'Promoting…' : 'Promote to qualified lead'}
                        </Button>
                      </div>}
                      <details className="rounded border p-3">
                        <summary className="cursor-pointer text-sm">Pass this property</summary>
                        <label className="mt-2 grid gap-1 text-xs">Reason for exclusion
                          <textarea className="min-h-16 rounded border bg-background p-2 text-sm" value={passReasons[item.id] ?? ''} onChange={(e) => setPassReasons((current) => ({ ...current, [item.id]: e.target.value }))} />
                        </label>
                        <Button className="mt-2" type="button" variant="outline" disabled={(passReasons[item.id] ?? '').trim().length < 8 || passDiscovery.isPending} onClick={() => pass(item.id, item.version)}>
                          {passDiscovery.isPending ? 'Saving…' : 'Pass and preserve source record'}
                        </Button>
                      </details>
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}
        {!canReviewDiscovery && <p className="text-xs text-muted-foreground">Your role can view the qualification queue but cannot add evidence, promote, pass, or change market rules.</p>}
      </section>
      {lane === 'buyer_candidates' && <p className="ledger border-l-4 border-l-signal p-3 text-sm">Corporate-owner research only. These are not approved buyers: current buying intent, criteria, contact and funds are unknown until you verify them.</p>}
      {discover.error != null && <ErrorNotice error={discover.error} />}
      {recordDiscovery.error != null && <ErrorNotice error={recordDiscovery.error} />}
      {search.isLoading && <RowsSkeleton rows={5} />}
      {search.isError && <ErrorNotice error={search.error} onRetry={() => search.refetch()} />}
      {search.data && search.data.records.length === 0 && <EmptyState title="No records returned" body="Try another ZIP inside the stated coverage, or clear the ZIP filter." />}
      {search.data && search.data.records.length > 0 && (
        <ul className="space-y-2" data-testid="list-source-records">{search.data.records.map((r) => (
          <li key={r.id} className="ledger space-y-2 p-3" data-testid={`record-${r.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{r.address}, {r.city} {r.state} {r.zip} {r.entityCandidate && <span className="tag tone-muted ml-2">Entity owner</span>}</p>
              {lane === 'properties'
                ? <Button size="sm" disabled={!canReviewDiscovery || !terms || recordDiscovery.isPending} onClick={() => doSaveDiscovery(r)} data-testid={`button-discovery-${r.id}`}>{recordDiscovery.isPending ? 'Saving…' : 'Save as discovery'}</Button>
                : <Button size="sm" variant="outline" disabled={!canResearch || !terms || !r.recordedOwner || discover.isPending} onClick={() => record(r)} data-testid={`button-candidate-${r.id}`}>Record as unverified prospect</Button>}
            </div>
            <RecordFacts r={r} />
          </li>))}</ul>
      )}
      {!canReviewDiscovery && !canResearch && <p className="text-xs text-muted-foreground">Your role can view source records but not save discoveries or record buyer prospects.</p>}
    </div>
  );
}
