import { Link } from 'wouter';
import { ArrowRight, PhoneCall } from 'lucide-react';
import { getGetCommandCenterQueryKey, useGetCommandCenter, type CommandAction } from '@workspace/api-client-react';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorNotice, RowsSkeleton } from '@/components/state-views';
import { isQualified } from '@/components/buyer-status';
import { StageBadge } from '@/components/stage-badge';
import { ago, fmtDate, isOverdue, money } from '@/lib/format';

const LABEL: Record<CommandAction['category'], string> = {
  RESEARCH: 'Research', CALL: 'Call', FOLLOW_UP: 'Follow up', OFFER_APPROVAL: 'Awaiting owner approval', NEGOTIATION: 'Negotiate',
  CONTRACT: 'Contract', BUYER_MATCH: 'Buyer match', BUYER_VERIFICATION: 'Verify buyer', DEADLINE: 'Deadline', CLOSING: 'Closing', WORKER: 'Worker',
};
const TONE: Record<CommandAction['category'], string> = {
  RESEARCH: 'tone-muted', CALL: 'tone-signal', FOLLOW_UP: 'tone-warn', OFFER_APPROVAL: 'tone-ink', NEGOTIATION: 'tone-go',
  CONTRACT: 'tone-ink', BUYER_MATCH: 'tone-go', BUYER_VERIFICATION: 'tone-warn', DEADLINE: 'tone-stop', CLOSING: 'tone-signal', WORKER: 'tone-muted',
};

export default function Dashboard() {
  const q = useGetCommandCenter({ query: { queryKey: getGetCommandCenterQueryKey(), refetchInterval: 15000 } });
  const d = q.data;
  const actions = d ? [...d.actions].sort((a, b) => b.priority - a.priority) : [];
  const contracts = d ? d.operations.filter((o) => o.contract) : [];
  const deadlines = contracts.filter((o) => o.contract!.status !== 'CLOSED' && o.contract!.status !== 'CANCELLED').sort((a, b) => a.contract!.closingAt.localeCompare(b.contract!.closingAt));
  const qualified = d ? d.buyers.filter(isQualified) : [];
  return (
    <div>
      <PageHeader eyebrow={d ? `Live / updated ${ago(d.generatedAt)}` : 'Live'} title="Command center" />
      {q.isError && <ErrorNotice error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading && <RowsSkeleton rows={5} />}
      {d && (
        <div className="space-y-8">
          <section data-testid="panel-actions">
            <p className="eyebrow mb-3">Do next ({actions.length})</p>
            {actions.length === 0 ? (
              <EmptyState title="Nothing is waiting on you" body="New work appears here as leads are researched, approved and followed up."
                action={<Link href="/leads" className="text-sm underline" data-testid="link-empty-inventory">Open deal inventory</Link>} />
            ) : (
              <ol className="space-y-2">{actions.map((a, i) => (
                <li key={a.id} className="rise" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
                  <Link href={a.href} className={`ledger group flex flex-wrap items-center gap-3 p-3 hover:border-signal ${i === 0 ? 'border-l-4 border-l-signal' : ''}`} data-testid={`action-${a.id}`}>
                    <span className={`tag ${TONE[a.category]}`}>{LABEL[a.category]}</span>
                    <div className="min-w-0 flex-1"><p className="font-semibold">{a.title}</p><p className="text-sm text-muted-foreground">{a.reason}</p></div>
                    {a.dueAt && <span className="font-mono text-xs text-muted-foreground">due {ago(a.dueAt)}</span>}
                    <span className="flex items-center gap-1 text-sm font-semibold group-hover:text-signal">{a.cta}<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></span>
                  </Link>
                </li>))}</ol>
            )}
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section data-testid="panel-calls">
              <p className="eyebrow mb-3 flex items-center gap-1.5"><PhoneCall className="h-3.5 w-3.5" />Call-ready sellers ({d.calls.length})</p>
              {d.calls.length === 0 ? <p className="ledger p-4 text-sm text-muted-foreground">No seller is cleared to call.</p> : (
                <ul className="space-y-2">{d.calls.map((b) => (
                  <li key={b.lead.id} className="ledger p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div><p className="font-semibold">{b.lead.sellerName}</p><p className="text-xs text-muted-foreground">{b.lead.address}</p></div>
                      <Link href={`/calls?lead=${b.lead.id}`} className="tag tone-signal" data-testid={`link-call-${b.lead.id}`}>Call</Link>
                    </div>
                    <p className="mt-1 text-sm">{b.objective}</p>
                    <p className="mt-1 font-mono text-xs">{b.authorizedOffer ? `Authorized: ${money(b.authorizedOffer.amount)}` : `Research only. Opening range ${money(b.analysis.openingLow)} to ${money(b.analysis.openingHigh)}, not authorized to quote`}</p>
                  </li>))}</ul>
              )}
            </section>

            <section data-testid="panel-deals">
              <p className="eyebrow mb-3">Live deals ({d.deals.length})</p>
              {d.deals.length === 0 ? <p className="ledger p-4 text-sm text-muted-foreground">No deals past the first conversation.</p> : (
                <ul className="space-y-2">{d.deals.map((x) => (
                  <li key={x.lead.id}><Link href={`/deals/${x.lead.id}`} className="ledger flex items-center justify-between gap-2 p-3 hover:border-signal" data-testid={`link-deal-${x.lead.id}`}>
                    <div className="min-w-0"><p className="truncate font-semibold">{x.lead.address}</p><p className="truncate text-xs text-muted-foreground">Next: {x.lead.nextAction || 'none recorded'}</p></div>
                    <StageBadge stage={x.lead.stage} /></Link></li>))}</ul>
              )}
            </section>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section data-testid="panel-contracts">
              <p className="eyebrow mb-3">Contracts and closing ({contracts.length})</p>
              {contracts.length === 0 ? <p className="ledger p-4 text-sm text-muted-foreground">No contract has been drafted.</p> : (
                <ul className="space-y-2">{contracts.map((o) => { const c = o.contract!; const dl = d.deals.find((x) => x.lead.id === o.leadId) ?? d.opportunities.find((x) => x.lead.id === o.leadId);
                  return (
                  <li key={c.id}><Link href={`/deals/${o.leadId}?work=transaction`} className="ledger block p-3 hover:border-signal" data-testid={`link-contract-${c.id}`}>
                    <div className="flex items-center justify-between gap-2"><p className="truncate font-semibold">{dl?.lead.address ?? 'Deal'}</p><span className={`tag ${c.status === 'DRAFT' ? 'tone-warn' : c.status === 'CANCELLED' ? 'tone-stop' : 'tone-go'}`}>{c.status === 'DRAFT' ? 'Draft, not executed' : c.status.replace(/_/g, ' ')}</span></div>
                    <p className="font-mono text-xs">{money(c.purchasePrice)} / {c.milestones.length} of 4 milestones / {o.matches.filter((m) => m.status === 'COMMITTED').length} committed buyer(s)</p>
                    <p className="text-xs text-muted-foreground">{o.nextAction}</p></Link></li>); })}</ul>
              )}
            </section>
            <section data-testid="panel-deadlines">
              <p className="eyebrow mb-3">Closing deadlines ({deadlines.length})</p>
              {deadlines.length === 0 ? <p className="ledger p-4 text-sm text-muted-foreground">No open contract has a closing date.</p> : (
                <ul className="space-y-2">{deadlines.map((o) => (
                  <li key={o.leadId}><Link href={`/deals/${o.leadId}?work=transaction`} className="ledger flex items-center justify-between p-3 hover:border-signal"><span className="text-sm">{fmtDate(o.contract!.closingAt)}</span>
                    <span className={`font-mono text-xs ${isOverdue(o.contract!.closingAt) ? 'font-semibold text-destructive' : ''}`}>{ago(o.contract!.closingAt)}</span></Link></li>))}</ul>
              )}
            </section>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section data-testid="panel-buyers">
              <div className="mb-3 flex items-center justify-between"><p className="eyebrow">Qualified buyers ({qualified.length} of {d.buyers.length})</p><Link href="/buyers" className="text-xs underline" data-testid="link-buyers">All buyers</Link></div>
              {d.buyers.length === 0 ? <p className="ledger p-4 text-sm text-muted-foreground">No buyers entered. Qualification is a human review; nothing is sourced automatically.</p> : (
                <ul className="space-y-2">{d.buyers.slice(0, 8).map((b) => (
                  <li key={b.id}><Link href={`/buyers/${b.id}`} className="ledger flex items-center justify-between gap-2 p-3 hover:border-signal" data-testid={`link-buyer-${b.id}`}>
                    <div className="min-w-0"><p className="truncate font-semibold">{b.name}</p><p className="font-mono text-xs text-muted-foreground">{b.criteria.states.join(', ')} / up to {money(b.criteria.maxPurchasePrice)}</p></div>
                    <span className={`tag ${isQualified(b) ? 'tone-go' : b.verificationStatus === 'STALE' ? 'tone-warn' : 'tone-muted'}`}>{isQualified(b) ? 'Qualified' : b.verificationStatus === 'STALE' ? 'Stale' : b.status === 'PAUSED' ? 'Paused' : 'Unverified'}</span></Link></li>))}</ul>
              )}
            </section>
            <section data-testid="panel-jobs">
              <div className="mb-3 flex items-center justify-between"><p className="eyebrow">Worker activity ({d.jobs.length})</p><Link href="/workers" className="text-xs underline" data-testid="link-workers">Open workers</Link></div>
              {d.jobs.length === 0 ? <p className="ledger p-4 text-sm text-muted-foreground">No jobs yet. Matching and deadline review only; no external scraping or AI runs.</p> : (
                <ul className="space-y-2">{d.jobs.slice(0, 6).map((j) => (
                  <li key={j.id} className="ledger flex items-center gap-2 p-3 text-sm"><span className={`tag ${j.state === 'FAILED' ? 'tone-stop' : j.state === 'SUCCEEDED' ? 'tone-go' : 'tone-muted'}`}>{j.state}</span><span className="min-w-0 flex-1 truncate">{j.message || j.kind.replace(/_/g, ' ').toLowerCase()}</span><span className="font-mono text-[11px] text-muted-foreground">{ago(j.updatedAt)}</span></li>))}</ul>
              )}
            </section>
          </div>

          <section data-testid="panel-opportunities">
            <p className="eyebrow mb-3">Opportunities to work up ({d.opportunities.length})</p>
            {d.opportunities.length === 0 ? <p className="ledger p-4 text-sm text-muted-foreground">No opportunities waiting for research.</p> : (
              <div className="grid gap-2 md:grid-cols-2">{d.opportunities.map((o) => (
                <Link key={o.lead.id} href={`/deals/${o.lead.id}?work=uw`} className="ledger p-3 hover:border-signal" data-testid={`link-opp-${o.lead.id}`}>
                  <div className="flex items-center justify-between gap-2"><p className="truncate font-semibold">{o.lead.address}</p><StageBadge stage={o.lead.stage} /></div>
                  <p className="text-xs text-muted-foreground">{o.intelligence.length} evidence item{o.intelligence.length === 1 ? '' : 's'} / {o.analysis ? o.analysis.classification : 'not underwritten'}</p>
                  {o.analysis?.blockers[0] && <p className="mt-1 text-sm">Blocked: {o.analysis.blockers[0]}</p>}
                </Link>))}</div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
