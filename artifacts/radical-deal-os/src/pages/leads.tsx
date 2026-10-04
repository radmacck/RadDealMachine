import { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Plus, Search } from 'lucide-react';
import { getListLeadsQueryKey, useCreateLead, useListLeads } from '@workspace/api-client-react';
import { PageHeader } from '@/components/page-header';
import { ErrorNotice, EmptyState, RowsSkeleton } from '@/components/state-views';
import { StageBadge } from '@/components/stage-badge';
import { LeadForm } from '@/components/lead-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAccess } from '@/hooks/use-access';
import { useInvalidateWork } from '@/hooks/use-invalidate';
import { useToast } from '@/hooks/use-toast';
import { fmtDate, isOverdue, money } from '@/lib/format';

export default function Leads() {
  const { canResearch } = useAccess();
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [, nav] = useLocation();
  const { toast } = useToast();
  const invalidate = useInvalidateWork();
  const q = useListLeads({ query: { queryKey: getListLeadsQueryKey(), staleTime: 10_000, refetchInterval: 30_000 } });
  const create = useCreateLead();

  const rows = useMemo(() => {
    const t = term.trim().toLowerCase();
    const all = q.data ?? [];
    if (!t) return all;
    return all.filter((l) => [l.address, l.city, l.zip, l.county, l.sellerName, l.sellerPhone ?? '', l.stage].join(' ').toLowerCase().includes(t));
  }, [q.data, term]);

  return (
    <div>
      <PageHeader eyebrow="Properties" title="Leads">
        <Button onClick={() => setOpen(true)} disabled={!canResearch} title={canResearch ? undefined : 'Owner or analyst role required'} data-testid="button-new-lead"><Plus className="mr-1.5 h-4 w-4" />New lead</Button>
      </PageHeader>
      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search address, city, ZIP, seller, stage" value={term} onChange={(e) => setTerm(e.target.value)} data-testid="input-search-leads" />
      </div>
      {q.isLoading && <RowsSkeleton />}
      {q.isError && <ErrorNotice error={q.error} onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && <EmptyState title="No leads yet" body="Add a real seller lead to start. Nothing on this screen is sample data." action={canResearch ? <Button onClick={() => setOpen(true)} data-testid="button-empty-new-lead">Add first lead</Button> : undefined} />}
      {q.data && q.data.length > 0 && rows.length === 0 && <EmptyState title="No match" body={`Nothing matches "${term}".`} />}
      {rows.length > 0 && (
        <div className="ledger overflow-x-auto" data-testid="table-leads">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="border-b border-border text-left"><th className="eyebrow p-3">Property</th><th className="eyebrow p-3">Seller</th><th className="eyebrow p-3">Stage</th><th className="eyebrow p-3 text-right">Asking</th><th className="eyebrow p-3">Follow up</th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="cursor-pointer border-b border-border/70 transition-colors last:border-0 hover:bg-accent/50" onClick={() => nav(`/deals/${l.id}`)} data-testid={`row-lead-${l.id}`}>
                  <td className="p-3"><Link href={`/deals/${l.id}`} className="font-semibold hover:text-signal" onClick={(e) => e.stopPropagation()} data-testid={`link-lead-${l.id}`}>{l.address}</Link><p className="text-xs text-muted-foreground">{l.city}, {l.state} {l.zip} / {l.beds}bd {l.baths}ba {l.sqft.toLocaleString()} sf</p></td>
                  <td className="p-3">{l.sellerName}<p className="font-mono text-xs text-muted-foreground">{l.sellerPhone ?? 'no phone'}</p></td>
                  <td className="p-3"><StageBadge stage={l.stage} /></td>
                  <td className="p-3 text-right font-mono">{money(l.askingPrice)}</td>
                  <td className={`p-3 text-xs ${isOverdue(l.followUpAt) ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>{l.followUpAt ? fmtDate(l.followUpAt) : 'none'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>New lead</DialogTitle><DialogDescription>Seller statements entered here are recorded as indicated, never verified.</DialogDescription></DialogHeader>
          <LeadForm pending={create.isPending} error={create.error} submitLabel="Create lead" onCancel={() => setOpen(false)}
            onSubmit={(data) => create.mutate({ data }, { onSuccess: (lead) => { invalidate(); setOpen(false); toast({ title: 'Lead created', description: lead.address }); nav(`/deals/${lead.id}`); } })} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
