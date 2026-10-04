import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import {
  getGetLeadQueryKey, useAddIntelligence, useGetLead, useSaveUnderwriting, useTransitionLead, useUpdateLead,
  type LeadDetail, type ProvenanceClass,
} from '@workspace/api-client-react';
import { ErrorNotice, RowsSkeleton } from '@/components/state-views';
import { StageBadge } from '@/components/stage-badge';
import { AnalysisPanel } from '@/components/analysis-panel';
import { ProvenanceSections } from '@/components/provenance-sections';
import { IntelligenceForm } from '@/components/intelligence-form';
import { LeadForm } from '@/components/lead-form';
import { UnderwritingEditor } from '@/components/underwriting-editor';
import { OffersPanel } from '@/components/offers-panel';
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
  const [tab, setTab] = useState('intel');
  const [leadEpoch, setLeadEpoch] = useState(0);
  const [uwEpoch, setUwEpoch] = useState(0);

  const q = useGetLead(id, { query: { queryKey: getGetLeadQueryKey(id), enabled: !!id, staleTime: 5_000, refetchInterval: 15_000 } });
  const updateLead = useUpdateLead();
  const addIntel = useAddIntelligence();
  const saveUw = useSaveUnderwriting();
  const transition = useTransitionLead();

  if (q.isLoading) return <RowsSkeleton rows={6} />;
  if (q.isError || !q.data) {
    return <div className="space-y-3"><Link href="/leads" className="text-sm underline" data-testid="link-back-leads">Back to leads</Link><ErrorNotice error={q.error} onRetry={() => q.refetch()} /></div>;
  }
  const d = q.data;
  const lead = d.lead;
  const patch = (fn: (o: LeadDetail) => LeadDetail) => qc.setQueryData<LeadDetail>(getGetLeadQueryKey(id), (o) => (o ? fn(o) : o));

  return (
    <div className="space-y-5">
      <Link href="/leads" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-leads"><ArrowLeft className="h-4 w-4" />Leads</Link>
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
      <p className="ledger border-l-4 border-l-signal p-3 text-sm" data-testid="text-next-action"><b>Next action:</b> {lead.nextAction || 'none recorded'}</p>
      <AnalysisPanel analysis={d.analysis} comps={d.underwriting?.comps} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto flex-wrap justify-start" data-testid="tabs-lead">
          <TabsTrigger value="intel" data-testid="tab-intel">Intelligence ({d.intelligence.length})</TabsTrigger>
          <TabsTrigger value="uw" data-testid="tab-underwriting">Underwriting</TabsTrigger>
          <TabsTrigger value="offers" data-testid="tab-offers">Offers ({d.offers.length})</TabsTrigger>
          <TabsTrigger value="record" data-testid="tab-record">Lead record</TabsTrigger>
          <TabsTrigger value="stage" data-testid="tab-stage">Stage and history</TabsTrigger>
          <TabsTrigger value="calls" data-testid="tab-calls">Calls ({d.calls.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="intel" forceMount className={KEEP}>
          <ProvenanceSections items={d.intelligence} onAdd={canResearch ? setAddClass : undefined} />
          {!canResearch && <p className="mt-3 text-xs text-muted-foreground">Your role can read research but not add to it.</p>}
        </TabsContent>

        <TabsContent value="uw" forceMount className={KEEP}>
          <UnderwritingEditor key={`${id}:${uwEpoch}`} leadVersion={lead.version} server={d.underwriting} disabled={!canResearch} pending={saveUw.isPending} error={saveUw.error}
            onDiscard={() => setUwEpoch((e) => e + 1)}
            onSave={(data, done) => saveUw.mutate({ id, data }, { onSuccess: (detail) => { qc.setQueryData(getGetLeadQueryKey(id), detail); invalidate(id); done(); toast({ title: 'Underwriting calculated', description: detail.analysis ? `Result: ${detail.analysis.classification}` : undefined }); } })} />
        </TabsContent>

        <TabsContent value="offers" forceMount className={KEEP}>
          <OffersPanel detail={d} onGoIntel={() => setTab('intel')} />
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
