import { useQueryClient } from '@tanstack/react-query';
import { getGetAssumptionsQueryKey, getListAuditQueryKey, useGetAssumptions, useUpdateAssumptions } from '@workspace/api-client-react';
import { PageHeader } from '@/components/page-header';
import { ErrorNotice, RowsSkeleton } from '@/components/state-views';
import { AssumptionsForm } from '@/components/assumptions-form';
import { MembersTable } from '@/components/members-table';
import { useAccess } from '@/hooks/use-access';
import { useInvalidateWork } from '@/hooks/use-invalidate';
import { useToast } from '@/hooks/use-toast';

export default function Settings() {
  const { isOwner, access } = useAccess();
  const qc = useQueryClient();
  const { toast } = useToast();
  const invalidate = useInvalidateWork();
  const q = useGetAssumptions({ query: { queryKey: getGetAssumptionsQueryKey(), staleTime: 30_000 } });
  const save = useUpdateAssumptions();
  return (
    <div className="space-y-10">
      <PageHeader eyebrow="Workspace" title="Settings" />
      <section>
        <h2 className="mb-1 text-2xl font-semibold">Underwriting assumptions</h2>
        <p className="mb-4 max-w-2xl text-sm text-muted-foreground">These feed the deterministic engine. Changing them affects the next calculation of every lead. Past results keep the assumptions they used.</p>
        {q.isLoading && <RowsSkeleton rows={4} />}
        {q.isError && <ErrorNotice error={q.error} onRetry={() => q.refetch()} />}
        {q.data && (
          <AssumptionsForm value={q.data} canEdit={isOwner} pending={save.isPending} error={save.error}
            onSave={(a) => save.mutate({ data: a }, { onSuccess: (r) => { qc.setQueryData(getGetAssumptionsQueryKey(), r); qc.invalidateQueries({ queryKey: getListAuditQueryKey() }); invalidate(); toast({ title: 'Assumptions saved' }); } })} />
        )}
      </section>
      <section>
        <h2 className="mb-1 text-2xl font-semibold">Members</h2>
        <p className="mb-4 max-w-2xl text-sm text-muted-foreground">New sign-ins arrive as pending. Approve them by user ID. Owner: research and calls plus this page. Analyst: research and underwriting. Operator: calls. Viewer: read only.</p>
        {isOwner ? <MembersTable selfId={access.userId} /> : <p className="ledger p-4 text-sm text-muted-foreground" data-testid="text-members-owner-only">Only the owner can see or change membership.</p>}
      </section>
    </div>
  );
}
