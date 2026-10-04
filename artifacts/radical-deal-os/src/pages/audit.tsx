import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Search } from 'lucide-react';
import { getListAuditQueryKey, useListAudit } from '@workspace/api-client-react';
import { PageHeader } from '@/components/page-header';
import { ErrorNotice, EmptyState, RowsSkeleton } from '@/components/state-views';
import { Input } from '@/components/ui/input';
import { fmtDate } from '@/lib/format';

export default function Audit() {
  const [term, setTerm] = useState('');
  const q = useListAudit({ query: { queryKey: getListAuditQueryKey(), staleTime: 10_000, refetchInterval: 30_000 } });
  const rows = useMemo(() => {
    const t = term.trim().toLowerCase();
    return (q.data ?? []).filter((e) => !t || [e.action, e.actor, e.detail, e.entityId].join(' ').toLowerCase().includes(t));
  }, [q.data, term]);
  return (
    <div>
      <PageHeader eyebrow="Append-only history" title="Audit" />
      <div className="relative mb-4 max-w-md"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Filter by action, person, or detail" value={term} onChange={(e) => setTerm(e.target.value)} data-testid="input-search-audit" /></div>
      {q.isLoading && <RowsSkeleton />}
      {q.isError && <ErrorNotice error={q.error} onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && <EmptyState title="Nothing recorded" body="Every create, edit, stage move, and call is logged here as it happens." />}
      {q.data && q.data.length > 0 && rows.length === 0 && <EmptyState title="No match" body="No events match that filter." />}
      {rows.length > 0 && (
        <div className="ledger overflow-x-auto" data-testid="table-audit">
          <table className="w-full min-w-[680px] text-sm"><thead><tr className="border-b border-border text-left"><th className="eyebrow p-3">When</th><th className="eyebrow p-3">Action</th><th className="eyebrow p-3">Detail</th><th className="eyebrow p-3">Who</th></tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={e.id} className="border-b border-border/70 align-top last:border-0" data-testid={`row-audit-${e.id}`}>
                <td className="whitespace-nowrap p-3 font-mono text-xs text-muted-foreground">{fmtDate(e.createdAt)}</td>
                <td className="p-3"><span className="tag tone-muted">{e.action}</span></td>
                <td className="p-3">{e.detail} {e.entityId && <Link href={`/leads/${e.entityId}`} className="font-mono text-xs underline" data-testid={`link-audit-entity-${e.id}`}>open</Link>}</td>
                <td className="p-3 font-mono text-xs">{e.actor}</td></tr>))}</tbody></table>
        </div>
      )}
    </div>
  );
}
