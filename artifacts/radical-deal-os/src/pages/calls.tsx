import { useState } from 'react';
import { PhoneCall } from 'lucide-react';
import { Link } from 'wouter';
import { getGetCallQueueQueryKey, useGetCallQueue, useRecordCall } from '@workspace/api-client-react';
import { PageHeader } from '@/components/page-header';
import { ErrorNotice, EmptyState, RowsSkeleton } from '@/components/state-views';
import { CallBriefCard } from '@/components/call-brief-card';
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
  const [sel, setSel] = useState<string | null>(null);
  const q = useGetCallQueue({ query: { queryKey: getGetCallQueueQueryKey(), staleTime: 15_000, refetchInterval: 30_000 } });
  const rec = useRecordCall();
  const queue = q.data ?? [];
  const current = queue.find((b) => b.lead.id === sel) ?? queue[0];

  return (
    <div>
      <PageHeader eyebrow="Operator desk" title="Call next" />
      {q.isLoading && <RowsSkeleton />}
      {q.isError && <ErrorNotice error={q.error} onRetry={() => q.refetch()} />}
      {q.data && queue.length === 0 && (
        <EmptyState title="No one to call right now" body="A lead appears here once it has a phone number, a completed underwriting analysis, and acceptable confidence. Analysts can finish research from the lead list."
          action={<Link href="/leads" className="text-sm underline" data-testid="link-empty-leads">Go to leads</Link>} />
      )}
      {current && (
        <div className="grid gap-5 lg:grid-cols-[17rem_1fr_21rem]">
          <ol className="space-y-2 lg:sticky lg:top-6 lg:self-start" data-testid="list-call-queue">
            {queue.map((b, i) => (
              <li key={b.lead.id}>
                <button type="button" onClick={() => setSel(b.lead.id)} data-testid={`button-queue-${b.lead.id}`}
                  className={`w-full border p-3 text-left transition-all hover:-translate-y-0.5 ${b.lead.id === current.lead.id ? 'border-signal bg-card ring-2 ring-signal/30' : 'border-border bg-card/70'}`}>
                  <div className="flex items-center justify-between"><span className={`tag ${i === 0 ? 'tone-signal' : 'tone-muted'}`}>{i === 0 ? 'Call next' : `#${i + 1}`}</span>
                    {isOverdue(b.lead.followUpAt) && <span className="tag tone-stop">Overdue</span>}</div>
                  <p className="mt-1.5 font-semibold">{b.lead.sellerName}</p>
                  <p className="truncate text-xs text-muted-foreground">{b.lead.address}</p>
                  <p className="mt-1 font-mono text-xs">{b.analysis.classification} / opens {money(b.analysis.openingLow)}</p>
                  {b.lead.followUpAt && <p className="font-mono text-[11px] text-muted-foreground">due {ago(b.lead.followUpAt)}</p>}
                </button>
              </li>
            ))}
          </ol>
          <CallBriefCard brief={current} />
          <aside className="ledger h-fit p-4 lg:sticky lg:top-6" data-testid="panel-log-call">
            <p className="eyebrow mb-3 flex items-center gap-1.5"><PhoneCall className="h-3.5 w-3.5" />Log this call</p>
            <CallLogForm key={current.lead.id} lead={current.lead} disabled={!canCall} pending={rec.isPending} error={rec.error}
              onSubmit={(data, done) => rec.mutate({ id: current.lead.id, data }, { onSuccess: () => { invalidate(current.lead.id); done(); toast({ title: 'Call saved', description: `${current.lead.sellerName}: follow-up recorded.` }); } })} />
            {current.authorizedOffer && current.authorizedOffer.effectiveStatus === 'AUTHORIZED' && (
              <div className="mt-5 border-t border-border pt-4" data-testid="panel-record-offer">
                <p className="eyebrow mb-3">Record communicated offer</p>
                <CommunicateForm key={current.authorizedOffer.id} offer={current.authorizedOffer} lead={current.lead} disabled={!(canCall || isOwner)} pending={comm.pending} error={comm.error}
                  onSubmit={(data, done) => comm.run(current.lead, current.authorizedOffer!, data, done)} />
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
