import { useEffect, useState } from 'react';
import { AlertTriangle, PhoneCall } from 'lucide-react';
import { Link } from 'wouter';
import {
  getGetAcquisitionQueueQueryKey, useGetAcquisitionQueue, useRecordAcquisitionQueueSelection,
  useStartCallSession, useRecordCall,
} from '@workspace/api-client-react';
import { PageHeader } from '@/components/page-header';
import { ErrorNotice, EmptyState, RowsSkeleton } from '@/components/state-views';
import { CallBriefCard } from '@/components/call-brief-card';
import { SellerPlaybookPanel } from '@/components/seller-playbook-panel';
import { AcquisitionQueueCard } from '@/components/acquisition-queue-card';
import { CallLogForm } from '@/components/call-log-form';
import { CommunicateForm, useOfferCommunicate } from '@/components/offers-panel';
import { useAccess } from '@/hooks/use-access';
import { useInvalidateWork } from '@/hooks/use-invalidate';
import { useToast } from '@/hooks/use-toast';
import { ago, isOverdue, money } from '@/lib/format';

export default function Calls() {
  const { canCall, isOwner } = useAccess();
  const comm = useOfferCommunicate();
  const { toast } = useToast();
  const invalidate = useInvalidateWork();
  const [sel, setSel] = useState<string | null>(() => new URLSearchParams(window.location.search).get('lead'));
  const [startedSession, setStartedSession] = useState<string | null>(null);
  const q = useGetAcquisitionQueue({ query: { queryKey: getGetAcquisitionQueueQueryKey(), staleTime: 15_000, refetchInterval: 30_000 } });
  const rec = useRecordCall();
  const selection = useRecordAcquisitionQueueSelection();
  const startSession = useStartCallSession();
  const queue = q.data?.items ?? [];
  const current = queue.find((item) => item.lead.id === sel) ?? queue[0];
  const sessionKey = current ? `${current.lead.id}:${current.lead.version}` : null;
  const sessionReady = !!sessionKey && startedSession === sessionKey;

  useEffect(() => {
    if (current && (current.lead.id !== sel || !sel)) setSel(current.lead.id);
  }, [current?.lead.id, sel]);

  useEffect(() => {
    if (!current) return;
    selection.mutate({ id: current.lead.id, data: { version: current.lead.version } });
    // The selection is an explicit queue-opening event; log once for this record version per page visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.lead.id, current?.lead.version]);

  return (
    <div>
      <PageHeader eyebrow="Seller acquisition · ranked work" title="Call next" />
      {q.isLoading && <RowsSkeleton />}
      {q.isError && <ErrorNotice error={q.error} onRetry={() => q.refetch()} />}
      {selection.error && <ErrorNotice error={selection.error} />}
      {q.data && queue.length === 0 && (
        <EmptyState title="No qualified seller opportunity is ready for this queue" body="Raw discoveries stay outside the active lead queue. Review relevant candidates or complete qualification, current contact evidence, and underwriting before CALL NEXT."
          action={<Link href="/leads" className="text-sm underline" data-testid="link-empty-leads">Go to leads</Link>} />
      )}
      {current && (
        <div className="grid gap-5 lg:grid-cols-[17rem_1fr_21rem]">
          <ol className="space-y-2 lg:sticky lg:top-6 lg:self-start" data-testid="list-call-queue">
            {queue.map((item) => (
              <li key={item.lead.id}>
                <button type="button" onClick={() => setSel(item.lead.id)} data-testid={`button-queue-${item.lead.id}`}
                  className={`w-full border p-3 text-left transition-all hover:-translate-y-0.5 ${item.lead.id === current.lead.id ? 'border-signal bg-card ring-2 ring-signal/30' : 'border-border bg-card/70'}`}>
                  <div className="flex items-center justify-between"><span className={`tag ${item.decision === 'CALL_NEXT' ? 'tone-signal' : 'tone-warn'}`}>
                    {item.decision === 'CALL_NEXT' ? 'Call next' : `Blocked · #${item.rank}`}
                  </span>{isOverdue(item.lead.followUpAt) && <span className="tag tone-stop">Overdue</span>}</div>
                  <p className="mt-1.5 font-semibold">{item.lead.address}</p>
                  <p className="truncate text-xs text-muted-foreground">{item.lead.sellerName}</p>
                  <p className="mt-1 text-xs">{item.evidenceScore}/100 source-backed relevance</p>
                  {item.blocker && <p className="mt-1 text-xs text-destructive">{item.blocker}</p>}
                </button>
              </li>
            ))}
          </ol>
          <div className="space-y-4">
            <AcquisitionQueueCard item={current} />
            {current.callBrief && (
              <>
                <CallBriefCard brief={current.callBrief} />
                <SellerPlaybookPanel leadId={current.lead.id} />
              </>
            )}
          </div>
          <aside className="ledger h-fit p-4 lg:sticky lg:top-6" data-testid="panel-log-call">
            {current.decision === 'BLOCKED' ? (
              <div role="status">
                <p className="eyebrow mb-2 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" />Call work blocked</p>
                <p className="text-sm font-semibold">{current.blocker}</p>
                <p className="mt-2 text-sm text-muted-foreground"><b>Next:</b> {current.nextAction}</p>
                <Link href={`/leads/${current.lead.id}`} className="mt-3 inline-block text-sm underline">Open persisted lead evidence</Link>
              </div>
            ) : (
              <>
                <p className="eyebrow mb-3 flex items-center gap-1.5"><PhoneCall className="h-3.5 w-3.5" />Call work session</p>
                {!sessionReady ? (
                  <button type="button" className="button w-full" disabled={!canCall || startSession.isPending}
                    onClick={() => startSession.mutate({ id: current.lead.id, data: { version: current.lead.version } }, {
                      onSuccess: () => setStartedSession(sessionKey),
                    })} data-testid="button-start-call-session">
                    {startSession.isPending ? 'Rechecking readiness' : 'Start call work'}
                  </button>
                ) : <p className="mb-3 rounded-sm border border-signal/40 bg-signal/5 p-2 text-xs" role="status">
                  Readiness was rechecked and this work session is audited. No call was placed by the system.
                </p>}
                {startSession.error != null && <ErrorNotice error={startSession.error} />}
                <CallLogForm key={current.lead.id} lead={current.lead} disabled={!canCall || !sessionReady} pending={rec.isPending} error={rec.error}
                  onSubmit={(data, done) => rec.mutate({ id: current.lead.id, data }, { onSuccess: () => { invalidate(current.lead.id); done(); toast({ title: 'Call result saved', description: `${current.lead.address}: operator-entered evidence and follow-up recorded.` }); } })} />
                {!sessionReady && <p className="mt-2 text-xs text-muted-foreground">Start call work first; this rechecks direct phone evidence and underwriting. Telephony is not connected.</p>}
              </>
            )}
            {current.callBrief?.authorizedOffer && current.callBrief.authorizedOffer.effectiveStatus === 'AUTHORIZED' && (
              <div className="mt-5 border-t border-border pt-4" data-testid="panel-record-offer">
                <p className="eyebrow mb-3">Record communicated offer</p>
                <CommunicateForm key={current.callBrief.authorizedOffer.id} offer={current.callBrief.authorizedOffer} lead={current.lead} disabled={!(canCall || isOwner) || !sessionReady} pending={comm.pending} error={comm.error}
                  onSubmit={(data, done) => comm.run(current.lead, current.callBrief!.authorizedOffer!, data, done)} />
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
