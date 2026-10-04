import { useState } from 'react';
import { Link } from 'wouter';
import { RotateCw } from 'lucide-react';
import { getGetWorkerCapabilitiesQueryKey, getListLeadsQueryKey, getListWorkerJobsQueryKey, useListLeads, useGetWorkerCapabilities, useListWorkerJobs, useSubmitWorkerJob, type WorkerJob, type WorkerJobInputKind } from '@workspace/api-client-react';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorNotice, RowsSkeleton } from '@/components/state-views';
import { Field, SELECT } from '@/components/field-row';
import { Button } from '@/components/ui/button';
import { useAccess } from '@/hooks/use-access';
import { useInvalidateWork } from '@/hooks/use-invalidate';
import { useToast } from '@/hooks/use-toast';
import { ago, fmtDate } from '@/lib/format';

const KIND: Record<WorkerJobInputKind, string> = {
  MATCH_BUYERS:'Match buyers to deals',REVIEW_DEADLINES:'Review contract deadlines',
  BUYER_DISCOVERY:'Discover corporate-owner buyer prospects',REVIEW_BUYER_POOL:'Review buyer pool freshness',
  ENRICH_PROPERTY:'Check public address geography',PREPARE_BRIEF:'Prepare AI hypotheses and seller questions',
};
const STATE_TONE: Record<WorkerJob['state'], string> = { QUEUED: 'tone-muted', RUNNING: 'tone-warn', SUCCEEDED: 'tone-go', FAILED: 'tone-stop' };
const newKey = () => `ui-${crypto.randomUUID()}`;

export default function Workers() {
  const { canResearch, canCall, isOwner } = useAccess();
  const can = canResearch || isOwner;
  const { toast } = useToast();
  const invalidate = useInvalidateWork();
  const [kind, setKind] = useState<WorkerJobInputKind>('MATCH_BUYERS');
  const [leadId, setLeadId] = useState('');
  const [terms, setTerms] = useState(false);
  const [recurring, setRecurring] = useState(false);
  const [key, setKey] = useState(newKey);
  const q = useListWorkerJobs({ query: { queryKey: getListWorkerJobsQueryKey(), staleTime: 3_000, refetchInterval: 5_000 } });
  const leads = useListLeads({ query: { queryKey: getListLeadsQueryKey(), staleTime: 30_000 } });
  const submit = useSubmitWorkerJob();
  const caps = useGetWorkerCapabilities({ query: { queryKey: getGetWorkerCapabilitiesQueryKey(), staleTime: 30_000 } });

  const queue = (k: WorkerJobInputKind, lead: string | null, idem: string, retry = false) =>
    submit.mutate({ data: { kind: k, idempotencyKey: idem, ...(lead ? { leadId: lead } : {}), ...(k === 'BUYER_DISCOVERY' ? { termsReviewed: terms, recurringDiscovery: recurring } : {}) } }, {
      onSuccess: () => { invalidate(lead ?? undefined); if (!retry) setKey(newKey()); toast({ title: retry ? 'Retry queued' : 'Job queued', description: KIND[k] }); },
    });

  return (
    <div>
      <PageHeader eyebrow="Background work" title="Worker activity" />
      <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_22rem]">
        <section className="ledger p-4" data-testid="panel-worker-scope">
          <p className="eyebrow mb-2">What runs today</p>
          <p className="text-sm">Matching and deadline checks recur every five minutes. New intake queues a public Census address check. Reviewed underwriting and connected seller calls queue AI hypotheses, questions and human verification actions. Jobs persist, show attempts and results, and failed work can be retried.</p>
          <p className="mt-2 text-sm text-muted-foreground">OpenAI runs use Replit AI Integrations and are billed to your credits. Prepared briefs are capped at six jobs per deal per UTC day. Model output remains AI HYPOTHESIS, never verified facts or permission to quote.</p>
          <p className="mt-2 border-l-2 border-dashed border-border pl-3 text-sm text-muted-foreground" data-testid="text-unsupported">Official Philadelphia public-property and sale-candidate research is available in Sources. Corporate-owner discovery produces unverified prospects, not active buyers. Nationwide listing/comparable feeds, verified title ownership and restricted-site scraping are not connected. No job sends messages, signs documents or transfers funds.</p>
        </section>
        <section className="ledger p-4" data-testid="panel-queue-job">
          <p className="eyebrow mb-3">Queue a job</p>
          <div className="space-y-3">
            <Field label="Job"><select className={SELECT} value={kind} onChange={(e) => setKind(e.target.value as WorkerJobInputKind)} data-testid="select-job-kind">{(Object.keys(KIND) as WorkerJobInputKind[]).map((k) => <option key={k} value={k}>{KIND[k]}</option>)}</select></Field>
            <Field label="Scope" hint={['BUYER_DISCOVERY','REVIEW_BUYER_POOL'].includes(kind) ? 'Buyer-pool work, not one seller property.' : ['ENRICH_PROPERTY','PREPARE_BRIEF'].includes(kind) ? 'Select one deal for this research job.' : 'All deals, or select one property.'}><select className={SELECT} disabled={['BUYER_DISCOVERY','REVIEW_BUYER_POOL'].includes(kind)} value={['BUYER_DISCOVERY','REVIEW_BUYER_POOL'].includes(kind) ? '' : leadId} onChange={(e) => setLeadId(e.target.value)} data-testid="select-job-lead"><option value="">All deals / buyer pool</option>{(leads.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.address}</option>)}</select></Field>
            {kind === 'BUYER_DISCOVERY' && <div className="space-y-2 text-sm">
              <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 h-4 w-4" checked={terms} onChange={(e) => setTerms(e.target.checked)} data-testid="check-worker-terms" />I reviewed the source terms. Found prospects are unverified and never auto-approved.</label>
              <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 h-4 w-4" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} data-testid="check-worker-recurring" />Repeat every 6 hours. The latest manual run with this unchecked turns recurrence off.</label></div>}
            {kind === 'REVIEW_BUYER_POOL' && <p className="text-xs text-muted-foreground">Also runs automatically on a recurring schedule.</p>}
            {submit.error != null && <ErrorNotice error={submit.error} />}
            <Button disabled={!can || submit.isPending || (['ENRICH_PROPERTY','PREPARE_BRIEF'].includes(kind) && !leadId) || (kind === 'BUYER_DISCOVERY' && !terms)} onClick={() => queue(kind, ['BUYER_DISCOVERY','REVIEW_BUYER_POOL'].includes(kind) ? null : leadId || null, key)} data-testid="button-queue-job">{submit.isPending ? 'Queuing...' : 'Queue job'}</Button>
          </div>
        </section>
      </div>
      <section className="ledger mb-6 p-4" data-testid="panel-capabilities">
        <p className="eyebrow mb-3">Capabilities</p>
        {caps.isLoading && <RowsSkeleton rows={2} />}
        {caps.isError && <ErrorNotice error={caps.error} onRetry={() => caps.refetch()} />}
        <ul className="space-y-2 text-sm">{(caps.data ?? []).map((c) => (
          <li key={c.id} data-testid={`capability-${c.id}`}><span className={`tag mr-2 ${c.state === 'AVAILABLE' ? 'tone-go' : 'tone-warn'}`}>{c.state === 'AVAILABLE' ? 'Available' : 'Pending connection'}</span><b>{c.capability}</b><p className="text-muted-foreground">{c.reason}</p><p className="text-xs">Next: {c.nextAction}</p></li>))}</ul>
      </section>
      <p className="eyebrow mb-3">Recent jobs</p>
      {q.isLoading && <RowsSkeleton />}
      {q.isError && <ErrorNotice error={q.error} onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && <EmptyState title="No jobs have run" body="Jobs appear when buyer criteria change, a contract is executed, or you queue one above." />}
      {q.data && q.data.length > 0 && (
        <ul className="space-y-2" data-testid="list-jobs">{q.data.map((j) => (
          <li key={j.id} className="ledger flex flex-wrap items-center gap-3 p-3" data-testid={`job-${j.id}`}>
            <span className={`tag ${STATE_TONE[j.state]}`}>{j.state}</span>
            <div className="min-w-0 flex-1"><p className="font-semibold">{KIND[j.kind]}{j.recurringDiscovery ? <span className="tag tone-signal ml-2">6-hour recurrence requested</span> : null}</p><p className="text-sm text-muted-foreground">{j.message || 'No result message yet.'}</p>
              <p className="font-mono text-[11px] text-muted-foreground">{j.attempts} attempt{j.attempts === 1 ? '' : 's'} / by {j.requestedBy} / {fmtDate(j.createdAt)} / updated {ago(j.updatedAt)}</p></div>
            {j.leadId && <Link href={`/deals/${j.leadId}?work=transaction`} className="text-sm underline" data-testid={`link-job-deal-${j.id}`}>Open deal</Link>}
            {j.state === 'FAILED' && <Button size="sm" variant="outline" disabled={!can || submit.isPending} onClick={() => queue(j.kind, j.leadId, newKey(), true)} data-testid={`button-retry-job-${j.id}`}><RotateCw className="mr-1.5 h-3.5 w-3.5" />Queue retry</Button>}
          </li>))}</ul>
      )}
    </div>
  );
}
