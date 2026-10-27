import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ErrorNotice, EmptyState, RowsSkeleton } from '@/components/state-views';
import {
  getGetAccessQueryKey, getListAuditQueryKey, getListMembersQueryKey, getListBuyersQueryKey,
  useListMembers, useListBuyers, useUpdateMember,
  type MemberUpdateRole,
} from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { fmtDate } from '@/lib/format';

const ROLES: MemberUpdateRole[] = ['OPERATOR', 'ANALYST', 'VIEWER', 'FINDER', 'PENDING'];
const HELP: Record<string, string> = { OWNER: 'Everything, including members', OPERATOR: 'Logs calls', ANALYST: 'Edits research and underwriting', VIEWER: 'Read only', FINDER: 'Own finder submissions only', PENDING: 'No access' };

export function MembersTable({ selfId }: { selfId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useListMembers({ query: { queryKey: getListMembersQueryKey(), staleTime: 10_000, refetchInterval: 20_000 } });
  const buyers = useListBuyers({ query: { queryKey: getListBuyersQueryKey() } });
  const upd = useUpdateMember();
  const [finderIds, setFinderIds] = useState<Record<string,string>>({});
  const finderProfiles = (buyers.data ?? []).filter(b => ['DEAL_FINDER','GURU'].includes(b.destinationKind ?? ''));

  const setRole = (id: string, role: MemberUpdateRole, finderId?: string) =>
    upd.mutate({ id, data: { role, ...(role === 'FINDER' ? { finderId } : {}) } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListMembersQueryKey() });
        qc.invalidateQueries({ queryKey: getListAuditQueryKey() });
        qc.invalidateQueries({ queryKey: getGetAccessQueryKey() });
        toast({ title: 'Role updated', description: `${id} is now ${role}.` });
      },
    });

  if (q.isLoading) return <RowsSkeleton rows={3} />;
  if (q.isError) return <ErrorNotice error={q.error} onRetry={() => q.refetch()} />;
  const rows = [...(q.data ?? [])].sort((a, b) => Number(b.role === 'PENDING') - Number(a.role === 'PENDING'));
  if (rows.length === 0) return <EmptyState title="No members yet" body="People appear here after they sign in. Newcomers start as pending." />;

  return (
    <div className="space-y-2" data-testid="table-members">
      {upd.isError && <ErrorNotice error={upd.error} />}
      {rows.map((m) => (
        <div key={m.id} className={`ledger flex flex-wrap items-center justify-between gap-3 p-3 ${m.role === 'PENDING' ? 'border-signal' : ''}`} data-testid={`row-member-${m.id}`}>
          <div className="min-w-0">
            <p className="truncate font-mono text-sm">{m.id}{m.id === selfId && <span className="ml-2 tag tone-muted">you</span>}</p>
            <p className="text-xs text-muted-foreground">Joined {fmtDate(m.createdAt, false)} / {HELP[m.role]}</p>
          </div>
          {m.role === 'OWNER' ? <span className="tag tone-ink" data-testid={`role-${m.id}`}>OWNER</span> : (
            <div className="flex items-center gap-2">
              {m.role === 'PENDING' && (
                <>
                  <Button size="sm" disabled={upd.isPending} onClick={() => setRole(m.id, 'OPERATOR')} data-testid={`button-approve-operator-${m.id}`}>Approve as operator</Button>
                  <Button size="sm" variant="outline" disabled={upd.isPending} onClick={() => setRole(m.id, 'ANALYST')} data-testid={`button-approve-analyst-${m.id}`}>Analyst</Button>
                  <div className="flex items-center gap-1">
                    <Select value={finderIds[m.id] ?? ''} onValueChange={v => setFinderIds(old => ({...old,[m.id]:v}))}>
                      <SelectTrigger className="w-44"><SelectValue placeholder="Finder profile" /></SelectTrigger>
                      <SelectContent>{finderProfiles.map(f => <SelectItem key={f.id} value={f.id}>{f.name} · {f.destinationKind}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button size="sm" variant="outline" disabled={upd.isPending || !(finderIds[m.id])} onClick={() => setRole(m.id, 'FINDER', finderIds[m.id])}>Approve finder</Button>
                  </div>
                </>
              )}
              {m.role === 'FINDER' && <Select value={finderIds[m.id] ?? m.finderId ?? ''} onValueChange={v => {setFinderIds(old => ({...old,[m.id]:v})); setRole(m.id,'FINDER',v);}} disabled={upd.isPending}>
                <SelectTrigger className="w-44"><SelectValue placeholder="Bound finder" /></SelectTrigger>
                <SelectContent>{finderProfiles.map(f => <SelectItem key={f.id} value={f.id}>{f.name} · {f.destinationKind}</SelectItem>)}</SelectContent>
              </Select>}
              <Select value={m.role} onValueChange={(v) => v === 'FINDER' ? undefined : setRole(m.id, v as MemberUpdateRole)} disabled={upd.isPending}>
                <SelectTrigger className="w-32" data-testid={`select-role-${m.id}`}><SelectValue /></SelectTrigger>
                <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
