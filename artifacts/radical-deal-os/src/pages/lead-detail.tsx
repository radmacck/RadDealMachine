import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, PhoneCall } from 'lucide-react';
import {
  getGetLeadQueryKey, useAddIntelligence, useIntakePropertyEvidence, useGetLead, useSaveUnderwriting, useTransitionLead, useUpdateLead, useRecordCall,
  type LeadDetail, type ProvenanceClass,
} from '@workspace/api-client-react';
import { ErrorNotice, RowsSkeleton } from '@/components/state-views';
import { StageBadge } from '@/components/stage-badge';
import { AnalysisPanel } from '@/components/analysis-panel';
import { ProvenanceSections } from '@/components/provenance-sections';
import { IntelligenceForm } from '@/components/intelligence-form';
import { LeadForm } from '@/components/lead-form';
import { UnderwritingEditor } from '@/components/underwriting-editor';
import { SourceResearchPanel } from '@/components/source-research';
import { EvidenceIntake } from '@/components/evidence-intake';
import { OffersPanel } from '@/components/offers-panel';
import { DealOperationsPanel } from '@/components/deal-operations-panel';
import { CallLogForm } from '@/components/call-log-form';
import { TransitionPanel } from '@/components/transition-panel';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAccess } from '@/hooks/use-access';
import { useInvalidateWork } from '@/hooks/use-invalidate';
import { useToast } from '@/hooks/use-toast';
import { ago, fmtDate, isOverdue, money } from '@/lib/format';

const KEEP = 'data-[state=inactive]:hidden mt-4';

export default function LeadDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { canResearch, canCall } = useAccess();
  const qc = useQueryClient();
  const { toast } = useToast();
  const invalidate = useInvalidateWork();
  const [addClass, setAddClass] = useState<ProvenanceClass | null>(null);
  const work = new URLSearchParams(window.location.search).get('work');
  const [tab, setTab] = useState(work === 'source' ? 'source' : work === 'record' ? 'record' : work === 'uw' ? 'uw' : work === 'stage' ? 'stage' : work === 'offers' ? 'offers' : work === 'call' ? 'calls' : work === 'transaction' ? 'tx' : 'intel');
  const [leadEpoch, setLeadEpoch] = useState(0);
  const [uwEpoch, setUwEpoch] = useState(0);

  const q = useGetLead(id, { query: { queryKey: getGetLeadQueryKey(id), enabled: !!id, staleTime: 5_000, refetchInterval: 15_000 } });
  const updateLead = useUpdateLead();
  const addIntel = useAddIntelligence();
  const intake = useIntakePropertyEvidence();
  const saveUw = useSaveUnderwriting();
  const transition = useTransitionLead();
  const recordCall = useRecordCall();

  const loaded = !!q.data;
  useEffect(() => {
    if (!loaded || !work) return;
    setTab(work === 'source' ? 'source' : work === 'record' ? 'record' : work === 'uw' ? 'uw' : work === 'stage' ? 'stage' : work === 'offers' ? 'offers' : work === 'call' ? 'calls' : work === 'transaction' ? 'tx' : 'intel');
    document.getElementById('workflow')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [loaded, work]);

  if (q.isLoading) return <RowsSkeleton rows={6} />;
  if (q.isError || !q.data) {
    return <div className="space-y-3"><Link href="/leads" className="text-sm underline" data-testid="link-back-leads">Back to leads</Link><ErrorNotice error={q.error} onRetry={() => q.refetch()} /></div>;
  }
  const d = q.data;
  const lead = d.lead;
  const coordination = ['CONTRACT_PENDING','UNDER_CONTRACT','BUYER_MATCHED','BUYER_INTERESTED','BUYER_COMMITTED','CLOSING'].includes(lead.stage);
  const blockers = [...(d.analysis?.blockers ?? []), ...d.offers.filter((o) => o.effectiveStatus === 'DRAFT').flatMap((o) => o.blockers)];
  const authorized = d.offers.find((o) => o.effectiveStatus === 'AUTHORIZED' || o.effectiveStatus === 'COMMUNICATED');
  const contactEvidenceBlocked = (d.analysis?.blockers ?? []).some((item) => item.toLowerCase().includes('seller contact'));
  const sellerConversationStage = ['CALL_READY','CONTACTED','CONVERSATION','OFFER_READY','OFFER_SENT','NEGOTIATING'].includes(lead.stage);
  const directCallReady = sellerConversationStage && !!lead.sellerPhone?.trim() && !!d.analysis &&
    !contactEvidenceBlocked && (lead.stage !== 'CALL_READY' || d.analysis.blockers.length === 0);
  const contactRouteHref = !lead.sellerPhone?.trim() && lead.propertyQualification?.discoveryId
    ? `/sources?discovery=${encodeURIComponent(lead.propertyQualification.discoveryId)}`
    : `/deals/${lead.id}?work=${lead.sellerPhone?.trim() ? 'intel' : 'record'}`;
  const patch = (fn: (o: LeadDetail) => LeadDetail) => qc.setQueryData<LeadDetail>(getGetLeadQueryKey(id), (o) => (o ? fn(o) : o));

  return (
    <div className="space-y-5">
      <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-leads"><ArrowLeft className="h-4 w-4" />Command center</Link>
      <header className="rise flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <p className="eyebrow mb-2">Lead / version {lead.version}</p>
          <h1 className="text-3xl font-semibold md:text-4xl" data-testid="text-lead-address">{lead.address}</h1>
          <p className="text-sm text-muted-foreground">{lead.city}, {lead.state} {lead.zip} / {lead.county} County / seller {lead.sellerName}{lead.sellerPhone ? `, ${lead.sellerPhone}` : ', no phone'}</p>
        </div>
        <div className="text-right text-sm">
          <StageBadge stage={lead.stage} />
          <p className="mt-1 font-mono">Asking {money(lead.askingPrice)}</p>
          <p className={`text-xs ${isOverdue(lead.followUpAt) ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>Follow up: {lead.followUpAt ? `${fmtDate(lead.followUpAt)} (${ago(lead.followUpAt)})` : 'none set'}</p>
        </div>
      </header>
      {d.workGuidance ? (
        <section className="ledger space-y-3 border-l-4 border-l-signal p-4" data-testid="panel-current-work">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="eyebrow mb-1">Current next action · {d.workGuidance.responsibleRole}</p>
              <h2 className="text-lg font-semibold" data-testid="text-next-action">{d.workGuidance.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{d.workGuidance.currentState}</p>
            </div>
            <Link href={d.workGuidance.href} className="inline-flex items-center gap-2 border border-signal px-3 py-2 text-sm font-semibold hover:bg-card" data-testid="link-current-work">
              {d.workGuidance.cta}<ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <p className="text-sm"><b>Why this matters:</b> {d.workGuidance.why}</p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded border border-border p-3">
              <p className="eyebrow mb-1">Known</p>
              <ul className="list-disc space-y-1 pl-4 text-sm">{d.workGuidance.knownFacts.map((fact, index) => <li key={index}>{fact}</li>)}</ul>
            </div>
            <div className="rounded border border-border p-3">
              <p className="eyebrow mb-1">Missing / blocked</p>
              {d.workGuidance.missingFacts.length
                ? <ul className="list-disc space-y-1 pl-4 text-sm">{d.workGuidance.missingFacts.map((fact, index) => <li key={index}>{fact}</li>)}</ul>
                : <p className="text-sm">No missing prerequisite is currently recorded.</p>}
            </div>
          </div>
          <div className="grid gap-3 text-sm md:grid-cols-2">
            <p><b>System can do:</b> {d.workGuidance.systemCanDo}</p>
            <p><b>You must do:</b> {d.workGuidance.humanMustDo}</p>
          </div>
          <p className="text-sm"><b>Evidence to record:</b> {d.workGuidance.requiredEvidence.join(' · ')}</p>
          <p className="border-t border-border pt-2 text-xs text-muted-foreground">
            <b>Due:</b> {d.workGuidance.dueAt ? `${d.workGuidance.dueLabel} · ${fmtDate(d.workGuidance.dueAt)}` : d.workGuidance.dueLabel}
            {' · '}<b>Completion is recorded in:</b> {d.workGuidance.completionRecord}
          </p>
        </section>
      ) : (
        <p className="ledger border-l-4 border-l-signal p-3 text-sm" data-testid="text-next-action">
          <b>Next action:</b> {lead.nextAction || 'No current action. This deal is closed.'}
        </p>
      )}
      <section className="grid gap-3 md:grid-cols-3" data-testid="panel-deal-status">
        <div className="ledger p-3"><p className="eyebrow mb-1">Blocked</p>
          {blockers.length === 0 ? <p className="text-sm">Nothing blocking the numbers.</p> : <ul className="list-disc space-y-0.5 pl-4 text-sm">{blockers.slice(0, 5).map((b, i) => <li key={i}>{b}</li>)}</ul>}</div>
        <div className="ledger p-3"><p className="eyebrow mb-1">Authorization (separate from research)</p>
          <p className="text-sm" data-testid="text-authorization">{authorized ? `Owner-approved offer: ${money(authorized.amount)}, ceiling ${money(authorized.maximumApprovedAcquisitionPrice)}.` : 'No owner-approved offer. Research and underwriting do not authorize any number to be quoted.'}</p></div>
        <div className="ledger p-3"><p className="eyebrow mb-1">Seller situation</p>
          <p className="text-sm">{lead.sellingReason || lead.sellerDescription || 'No seller statement yet.'}</p>
          <p className="mt-1 text-xs text-muted-foreground">Urgency {lead.urgency ?? 'UNKNOWN'} / {d.calls.length} call{d.calls.length === 1 ? '' : 's'} logged</p></div>
      </section>
      {lead.propertyQualification && (
        <section className="ledger space-y-3 border-l-4 border-l-signal p-4" data-testid="panel-property-qualification">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="eyebrow mb-1">Acquisition qualification · {lead.propertyQualification.status.replaceAll('_', ' ')}</p>
              <h2 className="text-lg font-semibold">Why this property entered the acquisition queue</h2>
            </div>
            <span className="rounded border px-2 py-1 text-sm font-semibold">
              {lead.propertyQualification.score}/100 · {Math.round(lead.propertyQualification.confidence * 100)}% evidence confidence
            </span>
          </div>
          <p className="text-sm">{lead.propertyQualification.reason}</p>
          <p className="text-xs text-muted-foreground"><b>Operator review:</b> {lead.propertyQualification.reviewReason} · Criteria v{lead.propertyQualification.criteriaVersion}</p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded border border-border p-3">
              <p className="eyebrow mb-2">Source-backed signals</p>
              <ul className="space-y-2">
                {lead.propertyQualification.signals.map((signal) => (
                  <li key={signal.id} className="text-sm">
                    <b>{signal.key.replaceAll('_', ' ')} · {signal.classification.replaceAll('_', ' ')}</b>
                    <span className="ml-2 text-xs text-muted-foreground">+{signal.scoreContribution} points</span>
                    <p>{signal.statement}</p>
                    <p className="text-xs text-muted-foreground">
                      {signal.sourceType.replaceAll('_', ' ')} · {signal.source}
                      {signal.evidenceRef ? ` · ${signal.evidenceRef}` : ''}
                    </p>
                    {signal.sourceUrl && <a className="text-xs underline" href={signal.sourceUrl} target="_blank" rel="noreferrer">Open source</a>}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded border border-border p-3">
              <p className="eyebrow mb-2">Still missing</p>
              <ul className="list-disc space-y-1 pl-4 text-sm">{lead.propertyQualification.missingInformation.map((item, index) => <li key={index}>{item}</li>)}</ul>
            </div>
          </div>
          <p className="border-t border-border pt-2 text-sm"><b>Next action:</b> {lead.propertyQualification.nextAction}</p>
        </section>
      )}
      <div className="flex flex-wrap gap-2 text-sm" id="workflow" data-testid="bar-workflow">
        {([['intel', 'Evidence'], ['uw', 'Underwriting'], ['offers', 'Offers'], ['tx', 'Transaction'], ['stage', 'Lifecycle']] as const).map(([v, l]) => (
          <button key={v} type="button" onClick={() => setTab(v)} className={`border px-3 py-1.5 ${tab === v ? 'border-signal bg-card font-semibold' : 'border-border'}`} data-testid={`button-focus-${v}`}>{l}</button>))}
        {coordination ? <button type="button" onClick={() => setTab('calls')} className="inline-flex items-center gap-1.5 border border-signal px-3 py-1.5 font-semibold hover:bg-card" data-testid="link-call-seller"><PhoneCall className="h-3.5 w-3.5" />Log seller / closing follow-up</button> :
          directCallReady
            ? <Link href={`/calls?lead=${lead.id}`} className="inline-flex items-center gap-1.5 border border-signal px-3 py-1.5 font-semibold hover:bg-card" data-testid="link-call-seller"><PhoneCall className="h-3.5 w-3.5" />Open call brief</Link>
            : <Link href={contactRouteHref} className="inline-flex items-center gap-1.5 border border-warn px-3 py-1.5 font-semibold hover:bg-card" data-testid="link-call-seller">
                Review best available contact route
              </Link>}
      </div>
      <AnalysisPanel analysis={d.analysis} comps={d.underwriting?.comps} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto flex-wrap justify-start" data-testid="tabs-lead">
          <TabsTrigger value="intel" data-testid="tab-intel">Intelligence ({d.intelligence.length})</TabsTrigger>
          <TabsTrigger value="uw" data-testid="tab-underwriting">Underwriting</TabsTrigger>
          <TabsTrigger value="source" data-testid="tab-source">Source research</TabsTrigger>
          <TabsTrigger value="offers" data-testid="tab-offers">Offers ({d.offers.length})</TabsTrigger>
          <TabsTrigger value="tx" data-testid="tab-transaction">Transaction</TabsTrigger>
          <TabsTrigger value="record" data-testid="tab-record">Lead record</TabsTrigger>
          <TabsTrigger value="stage" data-testid="tab-stage">Stage and history</TabsTrigger>
          <TabsTrigger value="calls" data-testid="tab-calls">Calls ({d.calls.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="intel" forceMount className={KEEP}>
          <ProvenanceSections items={d.intelligence} onAdd={canResearch ? setAddClass : undefined} />
          <EvidenceIntake detail={d} disabled={!canResearch} pending={intake.isPending} error={intake.error} onSubmit={(data, done) => intake.mutate({ id, data }, { onSuccess: (detail) => { qc.setQueryData(getGetLeadQueryKey(id), detail); invalidate(id); setUwEpoch((e) => e + 1); setLeadEpoch((e) => e + 1); done(); toast({ title: 'Evidence packet accepted' }); } })} />
          {!canResearch && <p className="mt-3 text-xs text-muted-foreground">Your role can read research but not add to it.</p>}
        </TabsContent>

        <TabsContent value="uw" forceMount className={KEEP}>
          <UnderwritingEditor key={`${id}:${uwEpoch}`} leadVersion={lead.version} server={d.underwriting} intelligence={d.intelligence} disabled={!canResearch} pending={saveUw.isPending} error={saveUw.error}
            onDiscard={() => setUwEpoch((e) => e + 1)}
            onSave={(data, done) => saveUw.mutate({ id, data }, { onSuccess: (detail) => { qc.setQueryData(getGetLeadQueryKey(id), detail); invalidate(id); done(); toast({ title: 'Underwriting calculated', description: detail.analysis ? `Result: ${detail.analysis.classification}` : undefined }); } })} />
        </TabsContent>

        <TabsContent value="source" forceMount className={KEEP}>
          <SourceResearchPanel leadId={id} version={lead.version} terminal={lead.stage === 'CLOSED' || lead.stage === 'DEAD_DEAL'} canResearch={canResearch} onAdded={() => { setUwEpoch((e) => e + 1); setTab('uw'); }} />
        </TabsContent>

        <TabsContent value="offers" forceMount className={KEEP}>
          <OffersPanel detail={d} onGoIntel={() => setTab('intel')} />
        </TabsContent>

        <TabsContent value="tx" forceMount className={KEEP}>
          <DealOperationsPanel detail={d} />
        </TabsContent>

        <TabsContent value="record" forceMount className={KEEP}>
          <LeadForm key={`${id}:${leadEpoch}`} lead={lead} disabled={!canResearch} submitLabel="Save lead" pending={updateLead.isPending} error={updateLead.error}
            onDiscard={() => setLeadEpoch((e) => e + 1)}
            onSubmit={(data, version) => updateLead.mutate({ id, data: { ...data, version } }, { onSuccess: (l) => { patch((o) => ({ ...o, lead: l })); invalidate(id); setLeadEpoch((e) => e + 1); toast({ title: 'Lead saved' }); } })} />
        </TabsContent>

        <TabsContent value="stage" forceMount className={KEEP}>
          <TransitionPanel detail={d} disabled={!(canResearch || canCall)} pending={transition.isPending} error={transition.error}
            onTransition={(data, done) => transition.mutate({ id, data }, { onSuccess: () => { invalidate(id); done(); toast({ title: 'Stage updated', description: `Now ${data.to.replace(/_/g, ' ')}` }); } })} />
        </TabsContent>

        <TabsContent value="calls" forceMount className={KEEP}>
          {coordination && <section className="ledger mb-4 p-4">
            <p className="eyebrow mb-2">Seller / closing follow-up</p>
            <p className="mb-3 text-sm text-muted-foreground">Record coordination and the next follow-up. This does not alter executed terms or authorize a new price. A phone response cannot cancel a signed agreement.</p>
            {lead.sellerPhone && <a className="mb-3 inline-block font-semibold underline" href={`tel:${lead.sellerPhone.replace(/[^+\d]/g,'')}`}>Call {lead.sellerName}: {lead.sellerPhone}</a>}
            <CallLogForm lead={lead} disabled={!canCall} pending={recordCall.isPending} error={recordCall.error}
              onSubmit={(data, done) => recordCall.mutate({id, data}, {onSuccess:() => {invalidate(id); done(); toast({title:'Follow-up recorded'});}})} />
          </section>}
          {d.calls.length === 0 ? <p className="ledger p-4 text-sm text-muted-foreground" data-testid="empty-calls">No calls logged for this seller. Calls are logged from the Call next screen.</p> : (
            <ol className="space-y-2">{[...d.calls].reverse().map((c) => (
              <li key={c.id} className="ledger p-3" data-testid={`call-${c.id}`}>
                <p className="flex flex-wrap items-center gap-2"><span className="tag tone-ink">{c.outcome.replace(/_/g, ' ')}</span><span className="font-mono text-xs text-muted-foreground">{fmtDate(c.createdAt)} / {c.actor}</span></p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{c.notes}</p>
                <p className="text-xs text-muted-foreground">Next: {c.nextAction}{c.followUpAt ? ` / follow up ${fmtDate(c.followUpAt)}` : ''}</p>
              </li>))}</ol>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={addClass !== null} onOpenChange={(o) => { if (!o) setAddClass(null); }}>
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>Record a statement</DialogTitle><DialogDescription>Filed under {addClass?.replace(/_/g, ' ').toLowerCase()}. Saved statements cannot be edited.</DialogDescription></DialogHeader>
          {addClass && <IntelligenceForm initialClass={addClass} pending={addIntel.isPending} error={addIntel.error} onCancel={() => setAddClass(null)}
            onSubmit={(data) => addIntel.mutate({ id, data }, { onSuccess: () => { invalidate(id); setAddClass(null); toast({ title: 'Statement recorded' }); } })} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
