import { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Plus, Search } from 'lucide-react';
import { getListBuyersQueryKey, useCreateBuyer, useListBuyers } from '@workspace/api-client-react';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorNotice, RowsSkeleton } from '@/components/state-views';
import { BuyerForm } from '@/components/buyer-form';
import { VerificationTag } from '@/components/buyer-status';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAccess } from '@/hooks/use-access';
import { useInvalidateWork } from '@/hooks/use-invalidate';
import { useToast } from '@/hooks/use-toast';
import { ago, money } from '@/lib/format';

export default function Buyers() {
  const { canResearch } = useAccess();
  const [, nav] = useLocation();
  const { toast } = useToast();
  const invalidate = useInvalidateWork();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const q = useListBuyers({ query: { queryKey: getListBuyersQueryKey(), staleTime: 10_000, refetchInterval: 20_000 } });
  const create = useCreateBuyer();
  const rows = useMemo(() => {
    const t = term.trim().toLowerCase();
    return (q.data ?? []).filter((b) => !t || [b.name, b.email, b.phone, b.criteria.states.join(' '), b.criteria.cities.join(' '), b.criteria.zipCodes.join(' ')].join(' ').toLowerCase().includes(t));
  }, [q.data, term]);

  return (
    <div>
      <PageHeader eyebrow="Disposition" title="Buyers">
        <Button onClick={() => setOpen(true)} disabled={!canResearch} title={canResearch ? undefined : 'Owner or analyst role required'} data-testid="button-new-buyer"><Plus className="mr-1.5 h-4 w-4" />New buyer</Button>
      </PageHeader>
      <p className="mb-4 max-w-3xl text-sm text-muted-foreground">Buyers are entered by a person. A buyer only counts as qualified after the owner records a human review of identity and funding evidence, and only while it has not expired. Buyer discovery from outside sources is not supported.</p>
      <div className="relative mb-4 max-w-md"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search name, contact, state, city, ZIP" value={term} onChange={(e) => setTerm(e.target.value)} data-testid="input-search-buyers" /></div>
      {q.isLoading && <RowsSkeleton />}
      {q.isError && <ErrorNotice error={q.error} onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && <EmptyState title="No buyers yet" body="Add a buyer you actually work with, including the buy box. Matching runs against every open deal as soon as you save." action={canResearch ? <Button onClick={() => setOpen(true)} data-testid="button-empty-new-buyer">Add first buyer</Button> : undefined} />}
      {q.data && q.data.length > 0 && rows.length === 0 && <p className="text-sm text-muted-foreground">No buyer matches that search.</p>}
      {rows.length > 0 && (
        <div className="ledger overflow-x-auto" data-testid="table-buyers">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-left"><th className="eyebrow p-3">Buyer</th><th className="eyebrow p-3">Buy box</th><th className="eyebrow p-3">Funds reviewed</th><th className="eyebrow p-3">Status</th></tr></thead>
            <tbody>{rows.map((b) => (
              <tr key={b.id} className="cursor-pointer border-b border-border/70 last:border-0 hover:bg-accent/50" onClick={() => nav(`/buyers/${b.id}`)} data-testid={`row-buyer-${b.id}`}>
                <td className="p-3"><Link href={`/buyers/${b.id}`} className="font-semibold hover:text-signal" onClick={(e) => e.stopPropagation()} data-testid={`link-buyer-${b.id}`}>{b.name}</Link><p className="text-xs text-muted-foreground">{b.email || b.phone}</p></td>
                <td className="p-3 text-xs">{b.criteria.states.join(', ')}{b.criteria.cities.length ? ` / ${b.criteria.cities.slice(0, 2).join(', ')}` : ''}<p className="text-muted-foreground">up to {money(b.criteria.maxPurchasePrice)} / {b.criteria.propertyTypes.length} type{b.criteria.propertyTypes.length === 1 ? '' : 's'}</p></td>
                <td className="p-3 font-mono text-xs">{b.availableFunds ? money(b.availableFunds) : 'not reviewed'}{b.validUntil && <p className="text-muted-foreground">until {ago(b.validUntil)}</p>}</td>
                <td className="p-3"><div className="flex flex-wrap gap-1"><VerificationTag buyer={b} /><span className={`tag ${b.status === 'ACTIVE' ? 'tone-ink' : 'tone-muted'}`}>{b.status}</span></div></td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
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
