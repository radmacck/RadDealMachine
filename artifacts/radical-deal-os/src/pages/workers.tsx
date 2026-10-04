import { useState } from 'react';
import { Link } from 'wouter';
import { RotateCw } from 'lucide-react';
import { getListLeadsQueryKey, getListWorkerJobsQueryKey, useListLeads, useListWorkerJobs, useSubmitWorkerJob, type WorkerJob, type WorkerJobInputKind } from '@workspace/api-client-react';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorNotice, RowsSkeleton } from '@/components/state-views';
import { Field, SELECT } from '@/components/field-row';
import { Button } from '@/components/ui/button';
import { useAccess } from '@/hooks/use-access';
import { useInvalidateWork } from '@/hooks/use-invalidate';
import { useToast } from '@/hooks/use-toast';
import { ago, fmtDate } from '@/lib/format';

const KIND: Record<WorkerJobInputKind, string> = { MATCH_BUYERS: 'Match buyers to deals', REVIEW_DEADLINES: 'Review contract deadlines' };
const STATE_TONE: Record<WorkerJob['state'], string> = { QUEUED: 'tone-muted', RUNNING: 'tone-warn', SUCCEEDED: 'tone-go', FAILED: 'tone-stop' };
const newKey = () => `ui-${crypto.randomUUID()}`;

export default function Workers() {
  const { canResearch, canCall, isOwner } = useAccess();
  const can = canResearch || isOwner;
  const { toast } = useToast();
  const invalidate = useInvalidateWork();
  const [kind, setKind] = useState<WorkerJobInputKind>('MATCH_BUYERS');
  const [leadId, setLeadId] = useState('');
  const [key, setKey] = useState(newKey);
  const q = useListWorkerJobs({ query: { queryKey: getListWorkerJobsQueryKey(), staleTime: 3_000, refetchInterval: 5_000 } });
  const leads = useListLeads({ query: { queryKey: getListLeadsQueryKey(), staleTime: 30_000 } });
  const submit = useSubmitWorkerJob();

  const queue = (k: WorkerJobInputKind, lead: string | null, idem: string, retry = false) =>
    submit.mutate({ data: { kind: k, idempotencyKey: idem, ...(lead ? { leadId: lead } : {}) } }, {
      onSuccess: () => { invalidate(lead ?? undefined); if (!retry) setKey(newKey()); toast({ title: retry ? 'Retry queued' : 'Job queued', description: KIND[k] }); },
    });

  return (
    <div>
      <PageHeader eyebrow="Background work" title="Worker activity" />
      <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_22rem]">
        <section className="ledger p-4" data-testid="panel-worker-scope">
          <p className="eyebrow mb-2">What runs today</p>
          <p className="text-sm">Buyer matching and contract deadline review run against the deal data in this system. Jobs persist, show attempts and results, and can be queued by hand here.</p>
          <p className="mt-2 border-l-2 border-dashed border-border pl-3 text-sm text-muted-foreground" data-testid="text-unsupported">Not supported: scraping outside sources, listing discovery, and AI research. No job here contacts a seller, a buyer, or any external site.</p>
        </section>
        <section className="ledger p-4" data-testid="panel-queue-job">
          <p className="eyebrow mb-3">Queue a job</p>
          <div className="space-y-3">
            <Field label="Job"><select className={SELECT} value={kind} onChange={(e) => setKind(e.target.value as WorkerJobInputKind)} data-testid="select-job-kind">{(Object.keys(KIND) as WorkerJobInputKind[]).map((k) => <option key={k} value={k}>{KIND[k]}</option>)}</select></Field>
            <Field label="Scope" hint="Leave on all deals unless you need one property."><select className={SELECT} value={leadId} onChange={(e) => setLeadId(e.target.value)} data-testid="select-job-lead"><option value="">All deals</option>{(leads.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.address}</option>)}</select></Field>
            {submit.error != null && <ErrorNotice error={submit.error} />}
            <Button disabled={!can || submit.isPending} onClick={() => queue(kind, leadId || null, key)} data-testid="button-queue-job">{submit.isPending ? 'Queuing...' : 'Queue job'}</Button>
          </div>
        </section>
      </div>
      <p className="eyebrow mb-3">Recent jobs</p>
      {q.isLoading && <RowsSkeleton />}
      {q.isError && <ErrorNotice error={q.error} onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && <EmptyState title="No jobs have run" body="Jobs appear when buyer criteria change, a contract is executed, or you queue one above." />}
      {q.data && q.data.length > 0 && (
        <ul className="space-y-2" data-testid="list-jobs">{q.data.map((j) => (
          <li key={j.id} className="ledger flex flex-wrap items-center gap-3 p-3" data-testid={`job-${j.id}`}>
            <span className={`tag ${STATE_TONE[j.state]}`}>{j.state}</span>
            <div className="min-w-0 flex-1"><p className="font-semibold">{KIND[j.kind]}</p><p className="text-sm text-muted-foreground">{j.message || 'No result message yet.'}</p>
              <p className="font-mono text-[11px] text-muted-foreground">{j.attempts} attempt{j.attempts === 1 ? '' : 's'} / by {j.requestedBy} / {fmtDate(j.createdAt)} / updated {ago(j.updatedAt)}</p></div>
            {j.leadId && <Link href={`/deals/${j.leadId}?work=transaction`} className="text-sm underline" data-testid={`link-job-deal-${j.id}`}>Open deal</Link>}
            {j.state === 'FAILED' && <Button size="sm" variant="outline" disabled={!can || submit.isPending} onClick={() => queue(j.kind, j.leadId, newKey(), true)} data-testid={`button-retry-job-${j.id}`}><RotateCw className="mr-1.5 h-3.5 w-3.5" />Queue retry</Button>}
          </li>))}</ul>
      )}
    </div>
  );
}
