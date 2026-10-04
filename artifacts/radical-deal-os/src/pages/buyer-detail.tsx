import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { getGetBuyerQueryKey, useGetBuyer, useUpdateBuyer, useVerifyBuyer } from '@workspace/api-client-react';
import { ErrorNotice, RowsSkeleton } from '@/components/state-views';
import { BuyerForm } from '@/components/buyer-form';
import { BuyerVerificationForm } from '@/components/buyer-verification-form';
import { VerificationTag, isQualified } from '@/components/buyer-status';
import { EvidenceLink } from '@/components/field-row';
import { useAccess } from '@/hooks/use-access';
import { useInvalidateWork } from '@/hooks/use-invalidate';
import { useToast } from '@/hooks/use-toast';
import { fmtDate, money } from '@/lib/format';

export default function BuyerDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const { canResearch, isOwner } = useAccess();
  const { toast } = useToast();
  const invalidate = useInvalidateWork();
  const [epoch, setEpoch] = useState(0);
  const q = useGetBuyer(id, { query: { queryKey: getGetBuyerQueryKey(id), enabled: !!id, staleTime: 5_000, refetchInterval: 20_000 } });
  const update = useUpdateBuyer();
  const verify = useVerifyBuyer();

  if (q.isLoading) return <RowsSkeleton rows={6} />;
  if (q.isError || !q.data) return <div className="space-y-3"><Link href="/buyers" className="text-sm underline" data-testid="link-back-buyers">Back to buyers</Link><ErrorNotice error={q.error} onRetry={() => q.refetch()} /></div>;
  const b = q.data;

  return (
    <div className="space-y-6">
      <Link href="/buyers" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-buyers"><ArrowLeft className="h-4 w-4" />Buyers</Link>
      <header className="rise flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div><p className="eyebrow mb-2">Buyer / version {b.version}</p><h1 className="text-3xl font-semibold md:text-4xl" data-testid="text-buyer-name">{b.name}</h1>
          <p className="text-sm text-muted-foreground">{[b.email, b.phone].filter(Boolean).join(' / ')} / source: {b.source}</p></div>
        <div className="flex gap-1.5"><VerificationTag buyer={b} /><span className="tag tone-ink">{b.status}</span></div>
      </header>

      <section className={`ledger border-l-4 p-4 ${isQualified(b) ? 'border-l-signal' : 'border-l-border'}`} data-testid="panel-buyer-qualification">
        <p className="eyebrow mb-2">Qualification</p>
        {b.verificationStatus === 'UNVERIFIED' && <p className="text-sm">Not qualified. This buyer can be matched on criteria but cannot be recorded as committed until the owner records a human review.</p>}
        {b.verificationStatus === 'STALE' && <p className="text-sm">Verification expired {fmtDate(b.validUntil)}. Re-review the evidence before this buyer can commit.</p>}
        {b.verificationStatus === 'VERIFIED' && <p className="text-sm">Reviewed by {b.verifiedBy} on {fmtDate(b.verifiedAt)}. Funds reviewed {money(b.availableFunds)}, valid until {fmtDate(b.validUntil)}.</p>}
        {b.verificationNote && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{b.verificationNote}</p>}
        <p className="mt-2 flex gap-4 text-sm"><EvidenceLink url={b.identityEvidenceUrl} label="Identity evidence" /><EvidenceLink url={b.fundingEvidenceUrl} label="Funding evidence" /></p>
        {b.evidenceAt && <p className="font-mono text-[11px] text-muted-foreground">Evidence captured {fmtDate(b.evidenceAt)}</p>}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="ledger p-4" data-testid="panel-buyer-criteria">
          <p className="eyebrow mb-3">Contact and buy box</p>
          <BuyerForm key={`${b.id}:${b.version}:${epoch}`} buyer={b} disabled={!canResearch} submitLabel="Save buyer" pending={update.isPending} error={update.error} onCancel={() => setEpoch((e) => e + 1)}
            onSubmit={(data) => update.mutate({ id, data: { ...data, version: b.version } }, { onSuccess: () => { invalidate(); setEpoch((e) => e + 1); toast({ title: 'Buyer saved', description: 'Matching queued against open deals.' }); } })} />
        </section>
        <section className="ledger h-fit p-4" data-testid="panel-buyer-verification">
          <p className="eyebrow mb-3">Human verification</p>
          <BuyerVerificationForm key={`${b.id}:${b.version}`} buyer={b} disabled={!isOwner} pending={verify.isPending} error={verify.error}
            onSubmit={(data, done) => verify.mutate({ id, data }, { onSuccess: () => { invalidate(); done(); toast({ title: 'Verification recorded' }); } })} />
        </section>
      </div>
    </div>
  );
}
