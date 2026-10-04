import { useMemo, useState, type ReactNode } from 'react';
import { useClerk } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, ShieldAlert } from 'lucide-react';
import { getGetAccessQueryKey, useClaimWorkspace, useGetAccess } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/logo';
import { ErrorNotice, RowsSkeleton } from '@/components/state-views';
import { AccessContext } from '@/hooks/use-access';
import { useToast } from '@/hooks/use-toast';

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-4">
      <div className="ledger rise w-full max-w-lg space-y-4 p-6">{children}</div>
    </div>
  );
}

export function AccessGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { signOut } = useClerk();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const q = useGetAccess({ query: { queryKey: getGetAccessQueryKey(), staleTime: 20_000, refetchInterval: 20_000 } });
  const claim = useClaimWorkspace();
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');

  const value = useMemo(() => {
    const a = q.data;
    if (!a) return null;
    return { access: a, canResearch: a.role === 'OWNER' || a.role === 'ANALYST', canCall: a.role === 'OWNER' || a.role === 'OPERATOR', isOwner: a.role === 'OWNER' };
  }, [q.data]);

  if (q.isLoading) return <Centered><Logo /><RowsSkeleton rows={3} /></Centered>;
  if (q.isError || !q.data || !value) {
    return <Centered><Logo /><ErrorNotice error={q.error} onRetry={() => q.refetch()} /></Centered>;
  }
  const a = q.data;

  if (a.unclaimed) {
    return (
      <Centered>
        <Logo />
        <p className="eyebrow">First-time setup</p>
        <h1 className="text-3xl font-semibold">This workspace has no owner</h1>
        <div className="flex gap-3 border border-signal bg-signal/10 p-3 text-sm" data-testid="notice-setup">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
          <p><b>Claim first owner before sharing this link.</b> Whoever claims becomes the only owner. Every person who signs in after that waits as pending until the owner approves them.</p>
        </div>
        {claim.isError && <ErrorNotice error={claim.error} />}
        <Button className="w-full" disabled={claim.isPending} data-testid="button-claim-workspace"
          onClick={() => claim.mutate(undefined, { onSuccess: (r) => { qc.setQueryData(getGetAccessQueryKey(), r); toast({ title: 'Workspace claimed', description: 'You are the owner.' }); } })}>
          <KeyRound className="mr-2 h-4 w-4" />{claim.isPending ? 'Claiming' : 'Claim workspace as owner'}
        </Button>
      </Centered>
    );
  }

  if (a.role === 'PENDING') {
    return (
      <Centered>
        <Logo />
        <p className="eyebrow">Access pending</p>
        <h1 className="text-3xl font-semibold">Waiting for the owner to approve you</h1>
        <p className="text-sm text-muted-foreground">You are signed in, but this workspace holds real seller information. Send the owner your user ID below. This page checks again every few seconds.</p>
        <div className="flex items-center justify-between gap-2 border border-dashed border-border bg-muted/50 p-3">
          <code className="break-all font-mono text-sm" data-testid="text-user-id">{a.userId}</code>
          <Button size="sm" variant="outline" data-testid="button-copy-user-id" onClick={() => { navigator.clipboard?.writeText(a.userId); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            <Copy className="mr-1 h-3.5 w-3.5" />{copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <Button variant="ghost" onClick={() => signOut({ redirectUrl: base || '/' })} data-testid="button-pending-signout">Sign out</Button>
      </Centered>
    );
  }

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}
