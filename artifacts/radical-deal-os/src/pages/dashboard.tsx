import { Link } from 'wouter';
import { ArrowRight } from 'lucide-react';
import { getGetDashboardQueryKey, useGetDashboard } from '@workspace/api-client-react';
import { PageHeader } from '@/components/page-header';
import { ErrorNotice, RowsSkeleton } from '@/components/state-views';
import { NextSlices } from '@/components/next-slices';
import { StageBadge } from '@/components/stage-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ago } from '@/lib/format';

function Stat({ label, value, tone, tid }: { label: string; value: number; tone?: string; tid: string }) {
  return (
    <div className="ledger p-4">
      <p className="eyebrow">{label}</p>
      <p className={`font-display text-5xl font-semibold ${tone ?? ''}`} data-testid={tid}>{value}</p>
    </div>
  );
}

export default function Dashboard() {
  const q = useGetDashboard({ query: { queryKey: getGetDashboardQueryKey(), staleTime: 10_000, refetchInterval: 20_000 } });
  const d = q.data;
  const steps: { to: string; text: string }[] = [];
  if (d) {
    if (d.callReady > 0) steps.push({ to: '/calls', text: `${d.callReady} seller${d.callReady === 1 ? ' is' : 's are'} ready to call. Open the call queue.` });
    if (d.overdue > 0) steps.push({ to: '/calls', text: `${d.overdue} follow-up${d.overdue === 1 ? ' is' : 's are'} overdue.` });
    if (d.needsResearch > 0) steps.push({ to: '/leads', text: `${d.needsResearch} lead${d.needsResearch === 1 ? ' needs' : 's need'} research or underwriting before anyone can call.` });
    if (d.total === 0) steps.push({ to: '/leads', text: 'No leads yet. Add the first real seller lead.' });
  }
  return (
    <div>
      <PageHeader eyebrow="Today" title="The desk" />
      {q.isError && <ErrorNotice error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>}
      {d && (
        <div className="space-y-6">
          <section className="ledger border-l-4 border-l-signal p-4" data-testid="panel-next-steps">
            <p className="eyebrow mb-2">Next steps</p>
            {steps.length === 0 ? <p className="text-sm text-muted-foreground">Nothing is waiting. Queue is clear.</p> : (
              <ul className="space-y-1.5">{steps.map((s, i) => (
                <li key={i}><Link href={s.to} className="group flex items-center justify-between text-base hover:text-signal" data-testid={`link-step-${i}`}>{s.text}<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></Link></li>))}</ul>
            )}
          </section>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Call ready" value={d.callReady} tone="text-signal" tid="stat-call-ready" />
            <Stat label="Needs research" value={d.needsResearch} tid="stat-needs-research" />
            <Stat label="Overdue follow-ups" value={d.overdue} tone={d.overdue ? 'text-destructive' : ''} tid="stat-overdue" />
            <Stat label="Total leads" value={d.total} tid="stat-total" />
          </div>
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            <section className="ledger p-4" data-testid="panel-stages">
              <p className="eyebrow mb-3">Underwriting verdicts</p>
              <div className="mb-4 grid grid-cols-3 gap-2 text-center">
                <div className="tone-go border p-2"><p className="font-display text-3xl" data-testid="stat-strong">{d.strong}</p><p className="eyebrow !text-inherit">Strong</p></div>
                <div className="tone-warn border p-2"><p className="font-display text-3xl" data-testid="stat-negotiable">{d.negotiable}</p><p className="eyebrow !text-inherit">Negotiable</p></div>
                <div className="tone-stop border p-2"><p className="font-display text-3xl" data-testid="stat-pass">{d.pass}</p><p className="eyebrow !text-inherit">Pass</p></div>
              </div>
              <p className="eyebrow mb-2">By stage</p>
              {d.stages.length === 0 ? <p className="text-sm text-muted-foreground">No leads in any stage.</p> : (
                <ul className="space-y-1.5">{d.stages.map((s) => (
                  <li key={s.stage} className="flex items-center gap-3"><div className="w-36"><StageBadge stage={s.stage} /></div>
                    <div className="h-2 flex-1 bg-muted"><div className="h-full bg-primary" style={{ width: `${d.total ? (s.count / d.total) * 100 : 0}%` }} /></div>
                    <span className="w-6 text-right font-mono text-sm">{s.count}</span></li>))}</ul>
              )}
            </section>
            <section className="ledger p-4" data-testid="panel-activity">
              <p className="eyebrow mb-3">Recent activity</p>
              {d.recentActivity.length === 0 ? <p className="text-sm text-muted-foreground">No activity recorded.</p> : (
                <ul className="divide-y divide-border">{d.recentActivity.map((e) => (
                  <li key={e.id} className="py-2 text-sm"><p><span className="font-mono text-xs text-signal">{e.action}</span> {e.detail}</p><p className="font-mono text-[11px] text-muted-foreground">{e.actor} / {ago(e.createdAt)}</p></li>))}</ul>
              )}
            </section>
          </div>
          <NextSlices />
        </div>
      )}
      {q.isLoading && <div className="mt-6"><RowsSkeleton rows={2} /></div>}
    </div>
  );
}
