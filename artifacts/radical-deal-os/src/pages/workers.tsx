import { useState } from 'react';
import { Link } from 'wouter';
import { RotateCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { getListHandoffsQueryKey, useListHandoffs, useRecordHandoffEvent, type HumanHandoff, type HandoffEventInput, getGetWorkerCapabilitiesQueryKey, getListLeadsQueryKey, getListWorkerJobsQueryKey, useListLeads, useGetWorkerCapabilities, useListWorkerJobs, useSubmitWorkerJob, type WorkerJob, type WorkerJobInputKind } from '@workspace/api-client-react';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorNotice, RowsSkeleton } from '@/components/state-views';
import { Field, SELECT } from '@/components/field-row';
import { Button } from '@/components/ui/button';
import { useAccess } from '@/hooks/use-access';
import { useInvalidateWork } from '@/hooks/use-invalidate';
import { useToast } from '@/hooks/use-toast';
import { ago, fmtDate } from '@/lib/format';

const KIND: Record<WorkerJobInputKind, string> = {
  REVIEW_HANDOFFS:'Review overdue human handoffs',
  MATCH_BUYERS:'Match buyers to deals',REVIEW_DEADLINES:'Review contract deadlines',
  BUYER_DISCOVERY:'Discover corporate-owner buyer prospects',REVIEW_BUYER_POOL:'Review buyer pool freshness',
  ENRICH_PROPERTY:'Check public address geography',PREPARE_BRIEF:'Prepare AI hypotheses and seller questions',
};
const STATE_TONE: Record<WorkerJob['state'], string> = { QUEUED: 'tone-muted', RUNNING: 'tone-warn', SUCCEEDED: 'tone-go', FAILED: 'tone-stop' };
const JOB_LABEL = (k: WorkerJob['kind']) => k === 'HUMAN_HANDOFF' ? 'Human handoff (prepared message)' : KIND[k];
const HSTATE: Record<HumanHandoff['state'], { label: string; tone: string }> = {
  WAITING_CONTACT: { label: 'Pending contact', tone: 'tone-warn' }, WAITING_REPLY: { label: 'Waiting for reply', tone: 'tone-signal' },
  REPLIED: { label: 'Replied', tone: 'tone-go' }, CANCELLED: { label: 'Cancelled', tone: 'tone-muted' },
};
type EvKind = HandoffEventInput['kind'];
const EV_KINDS: EvKind[] = ['ROUTE_REVIEWED', 'CONTACTED', 'REPLIED', 'NO_RESPONSE', 'FAILED', 'CANCELLED'];
const allowed = (k: EvKind, st: HumanHandoff['state'], events: HumanHandoff['events']) => {
  if (st === 'CANCELLED') return k === 'REPLIED' && events.some(e => e.kind === 'CONTACTED') && !events.some(e => e.kind === 'REPLIED');
  if (st === 'REPLIED') return false;
  if (k === 'ROUTE_REVIEWED') return st === 'WAITING_CONTACT';
  if (k === 'CONTACTED') return st === 'WAITING_CONTACT' && events.some(e => e.kind === 'ROUTE_REVIEWED');
  if (k === 'REPLIED') return st === 'WAITING_REPLY' || (st === 'WAITING_CONTACT' && events.some(e => e.kind === 'CONTACTED'));
  if (k === 'NO_RESPONSE') return st === 'WAITING_REPLY';
  return true;
};
const toIso = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
const INPUT = 'w-full rounded border border-input bg-background px-2 py-1.5 text-sm';

function HandoffCard({ h, can }: { h: HumanHandoff; can: boolean }) {
  const qc = useQueryClient();
  const invalidate = useInvalidateWork();
  const { toast } = useToast();
  const rec = useRecordHandoffEvent();
  const terminal = !EV_KINDS.some(k => allowed(k, h.state, h.events));
  const first = EV_KINDS.find((k) => allowed(k, h.state, h.events)) ?? 'CANCELLED';
  const [kind, setKind] = useState<EvKind>(first);
  const [eventKey, setEventKey] = useState(() => crypto.randomUUID());
  const [formVersion, setFormVersion] = useState(h.version);
  const [at, setAt] = useState('');
  const [evidence, setEvidence] = useState('');
  const [note, setNote] = useState('');
  const initialRoute = h.events.filter(e => e.kind === 'ROUTE_REVIEWED').at(-1);
  const [channel, setChannel] = useState<'PHONE' | 'EMAIL' | 'OTHER'>(initialRoute?.channel ?? 'PHONE');
  const [route, setRoute] = useState(initialRoute?.routeValue ?? '');
  const [perm, setPerm] = useState(initialRoute?.permissionEvidenceUrl ?? '');
  const [follow, setFollow] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const activeKind = allowed(kind, h.state, h.events) ? kind : first;
  const reviewedRoute = h.events.filter(e => e.kind === 'ROUTE_REVIEWED').at(-1);
  const needFollow = activeKind === 'CONTACTED' || activeKind === 'NO_RESPONSE' || activeKind === 'FAILED';
  const href = h.subjectType === 'BUYER' ? `/buyers/${h.subjectId}` : `/deals/${h.subjectId}`;
  const due = new Date(h.dueAt);

  const submit = () => {
    setErr(null);
    if (formVersion !== h.version) return setErr('This handoff changed while the form was open. Review the latest events and reload the form; your event will not be silently changed.');
    const occurredAt = toIso(at);
    if (!occurredAt) return setErr('Enter when this actually happened.');
    if (evidence.trim().length < 8) return setErr('Evidence URL needs at least 8 characters.');
    if (note.trim().length < 3) return setErr('Add a note.');
    const data: HandoffEventInput = { version: h.version, eventKey, kind: activeKind, occurredAt, evidenceUrl: evidence.trim(), note: note.trim() };
    if (activeKind === 'CONTACTED' || activeKind === 'ROUTE_REVIEWED') {
      if (!route.trim()) return setErr('Route value (phone or email used) is required.');
      if (perm.trim().length < 8) return setErr('Permission evidence URL is required.');
      data.channel = channel; data.routeValue = route.trim(); data.permissionEvidenceUrl = perm.trim();
    }
    if (needFollow) {
      const f = toIso(follow);
      if (!f || new Date(f).getTime() <= Date.now()) return setErr('Follow-up must be a future date and time.');
      data.followUpAt = f;
    }
    rec.mutate({ id: h.id, data }, {
      onSuccess: (saved) => {
        qc.setQueryData<HumanHandoff[]>(getListHandoffsQueryKey(), old => old?.map(item => item.id === saved.id ? saved : item));
        qc.invalidateQueries({ queryKey: getListHandoffsQueryKey() });
        invalidate();
        setFormVersion(saved.version);
        setKind(saved.events.at(-1)?.kind === 'ROUTE_REVIEWED' ? 'CONTACTED' : EV_KINDS.find(k => allowed(k, saved.state, saved.events)) ?? 'CANCELLED');
        setEventKey(crypto.randomUUID()); setAt(''); setEvidence(''); setNote('');
        const reviewed = saved.events.filter(e => e.kind === 'ROUTE_REVIEWED').at(-1);
        setRoute(reviewed?.routeValue ?? ''); setPerm(reviewed?.permissionEvidenceUrl ?? '');
        if (reviewed?.channel) setChannel(reviewed.channel);
        setFollow(''); setErr(null);
        rec.reset();
        toast({ title: 'Event recorded', description: activeKind });
      },
    });
  };

  return (
    <li className="ledger space-y-3 p-4" data-testid={`handoff-${h.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`tag ${HSTATE[h.state].tone}`} data-testid={`handoff-state-${h.id}`}>{HSTATE[h.state].label}</span>
        <Link href={href} className="font-semibold underline" data-testid={`link-handoff-subject-${h.id}`}>{h.recipient}</Link>
        <span className="tag tone-muted">{h.subjectType === 'BUYER' ? 'Buyer' : 'Seller'}</span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">Due {fmtDate(h.dueAt)}{!terminal && due.getTime() < Date.now() ? ' / overdue' : ''} / v{h.version}</span>
      </div>
      <p className="whitespace-pre-wrap rounded border border-dashed border-border bg-background/60 p-2 text-sm" data-testid={`handoff-message-${h.id}`}>{h.preparedMessage}</p>
      <p className="text-xs text-muted-foreground">{h.nextAction} No message has been sent by the system. {h.subjectType === 'BUYER' ? 'A reply alone does not qualify a buyer; verification is separate.' : 'Replies are retained as INDICATED intelligence on the property. Review them through its call/evidence workflows; matching and deadlines are rechecked without changing financial authority or deal stage.'}</p>
      {h.events.length > 0 && <ul className="space-y-1 border-l-2 border-border pl-3 text-xs" data-testid={`handoff-events-${h.id}`}>{h.events.map((e) => (
        <li key={e.eventKey}><b>{e.kind}</b>{e.channel ? ` via ${e.channel}` : ''} / happened {fmtDate(e.occurredAt)} / recorded {fmtDate(e.recordedAt)} by {e.recordedBy}{e.followUpAt ? ` / follow-up ${fmtDate(e.followUpAt)}` : ''}<br /><span className="text-muted-foreground">{e.note} </span><a className="underline" href={e.evidenceUrl} target="_blank" rel="noopener noreferrer">evidence</a></li>))}</ul>}
      {formVersion !== h.version && <div className="border border-border p-2 text-xs">
        Handoff changed in another session or worker review. Review its latest events before continuing.
        <Button size="sm" variant="outline" className="ml-2" onClick={() => {
          setFormVersion(h.version); setKind(first); setEventKey(crypto.randomUUID()); setAt(''); setEvidence(''); setNote('');
          setRoute(reviewedRoute?.routeValue ?? ''); setPerm(reviewedRoute?.permissionEvidenceUrl ?? '');
          if (reviewedRoute?.channel) setChannel(reviewedRoute.channel);
          setFollow(''); setErr(null); rec.reset();
        }}>Reload event form</Button>
      </div>}
      <p className="text-xs text-muted-foreground">{reviewedRoute
        ? `Reviewed route: ${reviewedRoute.channel} / ${reviewedRoute.routeValue}. Contact must match the latest review.`
        : 'No permitted route reviewed yet. Record ROUTE_REVIEWED with recipient-route permission evidence before performing contact. Preparation is not sending.'}</p>
      <fieldset disabled={!can || terminal || rec.isPending || formVersion !== h.version} className="grid gap-2 border-t border-border pt-3 sm:grid-cols-2">
        <Field label="Event"><select className={SELECT} value={activeKind} onChange={(e) => setKind(e.target.value as EvKind)} data-testid={`select-event-kind-${h.id}`}>{EV_KINDS.map((k) => <option key={k} value={k} disabled={!allowed(k, h.state, h.events)}>{k}</option>)}</select></Field>
        <Field label="Actually happened"><input type="datetime-local" className={INPUT} value={at} onChange={(e) => setAt(e.target.value)} data-testid={`input-event-at-${h.id}`} /></Field>
        <Field label="Evidence URL"><input className={INPUT} value={evidence} onChange={(e) => setEvidence(e.target.value)} data-testid={`input-event-evidence-${h.id}`} /></Field>
        <Field label="Note"><input className={INPUT} value={note} onChange={(e) => setNote(e.target.value)} data-testid={`input-event-note-${h.id}`} /></Field>
        {(activeKind === 'CONTACTED' || activeKind === 'ROUTE_REVIEWED') && <>
          <Field label="Channel"><select className={SELECT} value={channel} onChange={(e) => setChannel(e.target.value as 'PHONE' | 'EMAIL' | 'OTHER')} data-testid={`select-event-channel-${h.id}`}><option>PHONE</option><option>EMAIL</option><option>OTHER</option></select></Field>
          <Field label="Route value"><input className={INPUT} value={route} onChange={(e) => setRoute(e.target.value)} data-testid={`input-event-route-${h.id}`} /></Field>
          <Field label="Permission evidence URL"><input className={INPUT} value={perm} onChange={(e) => setPerm(e.target.value)} data-testid={`input-event-permission-${h.id}`} /></Field></>}
        {needFollow && <Field label="Follow-up (required, future)"><input type="datetime-local" className={INPUT} value={follow} onChange={(e) => setFollow(e.target.value)} data-testid={`input-event-followup-${h.id}`} /></Field>}
      </fieldset>
      {(err || rec.error != null) && (err ? <p className="text-sm text-destructive" role="alert" data-testid={`error-handoff-${h.id}`}>{err}</p> : <ErrorNotice error={rec.error} />)}
      <Button size="sm" disabled={!can || terminal || rec.isPending} onClick={submit} data-testid={`button-record-event-${h.id}`}>{terminal ? 'Closed' : rec.isPending ? 'Recording...' : 'Record event'}</Button>
    </li>
  );
}

function HumanHandoffs({ can }: { can: boolean }) {
  const q = useListHandoffs({ query: { queryKey: getListHandoffsQueryKey(), staleTime: 3_000, refetchInterval: 5_000 } });
  return (
    <section className="mb-6" data-testid="panel-handoffs">
      <p className="eyebrow mb-2">Human handoffs</p>
      <p className="mb-3 text-sm text-muted-foreground">A SUCCEEDED Human handoff job means the message was prepared only. Nothing was sent. Record what a person actually did below; no reply qualifies a buyer.</p>
      {q.isLoading && <RowsSkeleton rows={2} />}
      {q.isError && <ErrorNotice error={q.error} onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && <EmptyState title="No handoffs yet" body="Prepared outreach appears here for a person to send and record." />}
      {q.data && q.data.length > 0 && <ul className="space-y-3">{q.data.map((h) => <HandoffCard key={h.id} h={h} can={can} />)}</ul>}
    </section>
  );
}

const newKey = () => `ui-${crypto.randomUUID()}`;

export default function Workers() {
  const { canResearch, canCall, isOwner } = useAccess();
  const can = canResearch || isOwner;
  const canHandoff = canResearch || canCall || isOwner;
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
      <HumanHandoffs can={canHandoff} />
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
            <div className="min-w-0 flex-1"><p className="font-semibold">{JOB_LABEL(j.kind)}{j.recurringDiscovery ? <span className="tag tone-signal ml-2">6-hour recurrence requested</span> : null}</p><p className="text-sm text-muted-foreground">{j.message || 'No result message yet.'}</p>
              <p className="font-mono text-[11px] text-muted-foreground">{j.attempts} attempt{j.attempts === 1 ? '' : 's'} / by {j.requestedBy} / {fmtDate(j.createdAt)} / updated {ago(j.updatedAt)}</p></div>
            {j.leadId && <Link href={`/deals/${j.leadId}?work=transaction`} className="text-sm underline" data-testid={`link-job-deal-${j.id}`}>Open deal</Link>}
            {j.kind === 'HUMAN_HANDOFF' && <span className="text-xs text-muted-foreground">Output only</span>}
            {j.state === 'FAILED' && j.kind !== 'HUMAN_HANDOFF' && <Button size="sm" variant="outline" disabled={!can || submit.isPending} onClick={() => queue(j.kind as WorkerJobInputKind, j.leadId, newKey(), true)} data-testid={`button-retry-job-${j.id}`}><RotateCw className="mr-1.5 h-3.5 w-3.5" />Queue retry</Button>}
          </li>))}</ul>
      )}
    </div>
  );
}
