import { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Plus, Search } from 'lucide-react';
import { getGetBuyerCapacityQueryKey, getListBuyersQueryKey, useCreateBuyer, useDiscoverBuyer, useGetBuyerCapacity, useListBuyers } from '@workspace/api-client-react';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorNotice, RowsSkeleton } from '@/components/state-views';
import { BuyerForm, ProspectForm } from '@/components/buyer-form';
import { ApprovalTag, VerificationTag } from '@/components/buyer-status';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAccess } from '@/hooks/use-access';
import { useInvalidateWork } from '@/hooks/use-invalidate';
import { useToast } from '@/hooks/use-toast';
import { ago, money } from '@/lib/format';
import { buyerIntakeState } from '@/lib/command-center-state';
import { buyerPoolCoverage } from '@workspace/deal-domain';

export default function Buyers() {
  const { canResearch } = useAccess();
  const [, nav] = useLocation();
  const { toast } = useToast();
  const invalidate = useInvalidateWork();
  const intake = buyerIntakeState(window.location.search);
  const [open, setOpen] = useState(false);
  const [prospectOpen, setProspectOpen] = useState(intake.openProspect && canResearch);
  const [tab, setTab] = useState<'pool' | 'prospects'>(intake.tab);
  const [term, setTerm] = useState('');
  const q = useListBuyers({ query: { queryKey: getListBuyersQueryKey(), staleTime: 10_000, refetchInterval: 20_000 } });
  const capacity = useGetBuyerCapacity({query:{queryKey:getGetBuyerCapacityQueryKey(),staleTime:10_000,refetchInterval:20_000}});
  const create = useCreateBuyer();
  const discover = useDiscoverBuyer();
  const rows = useMemo(() => {
    const t = term.trim().toLowerCase();
    return (q.data ?? []).filter((b) => (tab === 'pool') === (b.approvalStatus === 'APPROVED')).filter((b) => !t || [b.name, b.email, b.phone, b.criteria?.states.join(' '), b.criteria?.cities.join(' '), b.criteria?.zipCodes.join(' ')].join(' ').toLowerCase().includes(t));
  }, [q.data, term, tab]);
  const coverage = useMemo(() => {
    const reserved=new Map((capacity.data??[]).map(item=>[item.buyerId,item]));
    return buyerPoolCoverage((q.data??[]).map(b=>({...b,...reserved.get(b.id)})),new Date());
  },[q.data,capacity.data]);
  const gaps = coverage.filter(item=>item.eligibleBuyerCount===0);
  const reverifyTasks = [...new Map(coverage.flatMap(g=>g.tasks.filter(t=>t.kind==="REVERIFY"&&t.buyerId).map(t=>[t.buyerId!,t] as const))).values()];

  return (
    <div>
      <PageHeader eyebrow="Disposition" title="Buyers">
        <Button variant="outline" onClick={() => setProspectOpen(true)} disabled={!canResearch} data-testid="button-new-prospect">Add prospect</Button>
        <Button onClick={() => setOpen(true)} disabled={!canResearch} title={canResearch ? undefined : 'Owner or analyst role required'} data-testid="button-new-buyer"><Plus className="mr-1.5 h-4 w-4" />New buyer</Button>
      </PageHeader>
      <p className="mb-4 max-w-3xl text-sm text-muted-foreground">Buyers are entered by a person. A buyer only counts as qualified after the owner records a human review of identity and funding evidence, and only while it has not expired. Prospects from sources are unverified and carry no criteria until qualified.</p>
      {q.data && <section className="mb-5 border border-border bg-card p-4" data-testid="buyer-pool-coverage">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="eyebrow">Verified buyer coverage</p><h2 className="font-display text-xl">Where the real pool is thin</h2>
            <p className="max-w-3xl text-xs text-muted-foreground">Only current owner-approved identity, intent, criteria and funding proof counts. Active contract commitments are deducted from available capacity. Prospects and synthetic fixtures never fill coverage.</p>
          </div>
          <span className="tag tone-ink">{coverage.filter(c=>c.eligibleBuyerCount>0).length} covered boxes / {coverage.length} observed boxes</span>
        </div>
        {reverifyTasks.length>0 && <div className="mt-3 border-l-2 border-amber-500 pl-3">
          <p className="text-sm font-semibold">Reverification work</p>
          {reverifyTasks.slice(0,5).map(task=><p key={task.buyerId} className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span>{task.action}: {task.reason}</span><Button variant="outline" size="sm" onClick={()=>nav(`/buyers/${task.buyerId}`)}>Review buyer</Button>
          </p>)}
        </div>}
        {gaps.length>0 ? <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {gaps.slice(0,12).map(gap=><article key={`${gap.market}:${gap.propertyType}:${gap.priceBand}`} className="border border-border/70 p-3">
            <p className="text-sm font-semibold">{gap.market.replace(/^(STATE:|CITY:|ZIP:)/,"")} · {gap.propertyType} · ${gap.priceBand}</p>
            <p className="text-xs text-muted-foreground">Eligible buyers: 0 · prospects: {gap.prospectCount} · stale proof: {gap.staleProofCount}</p>
            <p className="mt-1 text-xs">{gap.blockers.slice(0,2).join(" ") || "No verified buyer covers this box."}</p>
            <p className="mt-1 text-xs text-muted-foreground">Condition coverage (Light / Moderate / Heavy): {gap.conditionCoverage.LIGHT}/{gap.conditionCoverage.MODERATE}/{gap.conditionCoverage.HEAVY} · closing ≤14/30/60d: {gap.closingSpeedCoverage["≤14d"]}/{gap.closingSpeedCoverage["≤30d"]}/{gap.closingSpeedCoverage["≤60d"]}</p>
            <div className="mt-2 flex gap-2"><Button variant="outline" size="sm" disabled={!canResearch} onClick={()=>{setTab("prospects");setProspectOpen(true);}}>Add real prospect</Button>
              {gap.tasks.some(t=>t.kind==="REVERIFY")&&<Button variant="outline" size="sm" onClick={()=>nav(`/buyers?tab=prospects`)}>Review stale proof</Button>}</div>
          </article>)}
        </div> : coverage.length>0 ? <p className="mt-3 text-sm">Every currently observed market/type/price box has at least one eligible buyer. Condition, closing speed and capacity remain listed by box.</p>
          : <p className="mt-3 text-sm text-muted-foreground">No market criteria recorded yet. Add real buyer prospects to define coverage gaps; no buyer will be fabricated.</p>}
        {coverage.filter(c=>c.eligibleBuyerCount>0).slice(0,8).map(c=><p key={`covered:${c.market}:${c.propertyType}:${c.priceBand}`} className="mt-1 text-xs text-muted-foreground">
          Covered · {c.market} / {c.propertyType} / ${c.priceBand}: {c.eligibleBuyerCount} eligible · condition L/M/H {c.conditionCoverage.LIGHT}/{c.conditionCoverage.MODERATE}/{c.conditionCoverage.HEAVY} · close ≤14/30/60d {c.closingSpeedCoverage["≤14d"]}/{c.closingSpeedCoverage["≤30d"]}/{c.closingSpeedCoverage["≤60d"]}
        </p>)}
      </section>}
      <div className="mb-4 flex gap-2 text-sm">{([['pool', 'Approved pool'], ['prospects', 'Prospects and qualification']] as const).map(([v, l]) => (
        <button key={v} type="button" onClick={() => setTab(v)} aria-pressed={tab === v} className={`border px-3 py-1.5 ${tab === v ? 'border-signal bg-card font-semibold' : 'border-border'}`} data-testid={`tab-buyers-${v}`}>{l} ({(q.data ?? []).filter((b) => (v === 'pool') === (b.approvalStatus === 'APPROVED')).length})</button>))}</div>
      <div className="relative mb-4 max-w-md"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search name, contact, state, city, ZIP" value={term} onChange={(e) => setTerm(e.target.value)} data-testid="input-search-buyers" /></div>
      {q.isLoading && <RowsSkeleton />}
      {q.isError && <ErrorNotice error={q.error} onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && <EmptyState title="No buyers yet" body="Add a buyer you actually work with, including the buy box. Matching runs against every open deal as soon as you save." action={canResearch ? <Button onClick={() => setOpen(true)} data-testid="button-empty-new-buyer">Add first buyer</Button> : undefined} />}
      {q.data && q.data.length > 0 && rows.length === 0 && !term.trim() && <p className="text-sm text-muted-foreground" data-testid="empty-buyers-tab">{tab === 'pool' ? 'No approved buyers yet. Qualify a prospect to bring it here.' : 'No prospects awaiting qualification.'}</p>}
      {q.data && q.data.length > 0 && rows.length === 0 && term.trim() && <p className="text-sm text-muted-foreground">No buyer matches that search.</p>}
      {rows.length > 0 && (
        <div className="ledger overflow-x-auto" data-testid="table-buyers">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-left"><th className="eyebrow p-3">Buyer</th><th className="eyebrow p-3">Buy box</th><th className="eyebrow p-3">Funds reviewed</th><th className="eyebrow p-3">Status</th></tr></thead>
            <tbody>{rows.map((b) => (
              <tr key={b.id} className="cursor-pointer border-b border-border/70 last:border-0 hover:bg-accent/50" onClick={() => nav(`/buyers/${b.id}`)} data-testid={`row-buyer-${b.id}`}>
                <td className="p-3"><Link href={`/buyers/${b.id}`} className="font-semibold hover:text-signal" onClick={(e) => e.stopPropagation()} data-testid={`link-buyer-${b.id}`}>{b.name}</Link><p className="text-xs text-muted-foreground">{b.email || b.phone || 'no contact on file'} / {(b.destinationKind ?? 'BUYER').replace('_', ' ').toLowerCase()}</p></td>
                <td className="p-3 text-xs">{b.criteria ? <>{b.criteria.states.join(', ')}{b.criteria.cities.length ? ` / ${b.criteria.cities.slice(0, 2).join(', ')}` : ''}<p className="text-muted-foreground">up to {money(b.criteria.maxPurchasePrice)} / {b.criteria.propertyTypes.length} type{b.criteria.propertyTypes.length === 1 ? '' : 's'}</p></> : <span className="text-muted-foreground">Criteria not collected</span>}</td>
                <td className="p-3 font-mono text-xs">{b.availableFunds ? money(b.availableFunds) : 'not reviewed'}{b.validUntil && <p className="text-muted-foreground">until {ago(b.validUntil)}</p>}</td>
                <td className="p-3"><div className="flex flex-wrap gap-1"><ApprovalTag buyer={b} /><VerificationTag buyer={b} /><span className={`tag ${b.status === 'ACTIVE' ? 'tone-ink' : 'tone-muted'}`}>{b.status}</span></div></td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      <Dialog open={prospectOpen} onOpenChange={setProspectOpen}>
        <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>Add prospect</DialogTitle><DialogDescription>Unverified, no criteria assumed.</DialogDescription></DialogHeader>
          <ProspectForm pending={discover.isPending} error={discover.error} onCancel={() => setProspectOpen(false)}
            onSubmit={(data) => discover.mutate({ data }, { onSuccess: (b) => { invalidate(); setProspectOpen(false); toast({ title: 'Prospect recorded', description: b.name }); nav(`/buyers/${b.id}`); } })} />
        </DialogContent>
      </Dialog>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>New buyer</DialogTitle><DialogDescription>Saving queues matching against open deals. The buyer starts unverified.</DialogDescription></DialogHeader>
          <BuyerForm submitLabel="Create buyer" pending={create.isPending} error={create.error} onCancel={() => setOpen(false)}
            onSubmit={(data) => create.mutate({ data }, { onSuccess: (b) => { invalidate(); setOpen(false); toast({ title: 'Buyer created', description: b.name }); nav(`/buyers/${b.id}`); } })} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
