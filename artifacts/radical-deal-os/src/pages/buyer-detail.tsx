import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { getGetBuyerQueryKey, useGetBuyer, useUpdateBuyer, useVerifyBuyer, useRequestBuyerQualification, type Buyer } from '@workspace/api-client-react';
import { ErrorNotice, RowsSkeleton } from '@/components/state-views';
import { BuyerForm } from '@/components/buyer-form';
import { BuyerVerificationForm } from '@/components/buyer-verification-form';
import { ApprovalTag, VerificationTag, isQualified } from '@/components/buyer-status';
import { Button } from '@/components/ui/button';
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
  const requestEvidence = useRequestBuyerQualification();
  const [requestNote, setRequestNote] = useState('');
  const [formBuyer,setFormBuyer] = useState<Buyer|null>(null);
  useEffect(()=>{if(q.data && formBuyer?.id!==q.data.id) setFormBuyer(q.data);},[q.data,formBuyer?.id]);

  if (q.isLoading) return <RowsSkeleton rows={6} />;
  if (q.isError || !q.data) return <div className="space-y-3"><Link href="/buyers" className="text-sm underline" data-testid="link-back-buyers">Back to buyers</Link><ErrorNotice error={q.error} onRetry={() => q.refetch()} /></div>;
  const b = q.data;
  const editing = formBuyer?.id===b.id ? formBuyer : b;
  const reloadForms = () => {setFormBuyer(b);setEpoch(e=>e+1);};

  return (
    <div className="space-y-6">
      <Link href="/buyers" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-buyers"><ArrowLeft className="h-4 w-4" />Buyers</Link>
      <header className="rise flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div><p className="eyebrow mb-2">Buyer / version {b.version}</p><h1 className="text-3xl font-semibold md:text-4xl" data-testid="text-buyer-name">{b.name}</h1>
          <p className="text-sm text-muted-foreground">{[b.email, b.phone].filter(Boolean).join(' / ') || 'no contact on file'} / source: {b.source}</p></div>
        <div className="flex gap-1.5"><ApprovalTag buyer={b} /><VerificationTag buyer={b} /><span className="tag tone-ink">{b.status}</span></div>
      </header>

      <section className="ledger p-4" data-testid="panel-qualification-task">
        <p className="eyebrow mb-2">Qualification work</p>
        <p className="text-sm">Destination {(b.destinationKind ?? 'BUYER').replace('_', ' ').toLowerCase()} / current buying {(b.currentBuyingStatus ?? 'UNKNOWN').replace('_', ' ').toLowerCase()}{b.qualifiedDealFee != null ? ` / quoted fee ${money(b.qualifiedDealFee)}${b.feeTermsSource ? ` (${b.feeTermsSource})` : ''}` : ''}{b.confidence != null ? ` / confidence ${b.confidence}` : ''}</p>
        {(b.qualificationBlockers ?? []).length > 0 && <ul className="mt-2 list-disc pl-4 text-sm" data-testid="list-blockers">{b.qualificationBlockers!.map((x, i) => <li key={i}>{x}</li>)}</ul>}
        {(b.qualificationBlockers ?? []).length === 0 && b.approvalStatus !== 'APPROVED' && <p className="mt-2 text-sm text-muted-foreground">No blockers listed; record verification to approve.</p>}
        {b.qualificationTask && b.qualificationTask.state!=='COMPLETED' && <div className="mt-3 border-t border-border pt-3" data-testid="panel-task">
          <p className="text-sm"><span className="tag tone-muted mr-2">{b.qualificationTask.kind}</span><span className="tag tone-warn mr-2">{b.qualificationTask.state.replace(/_/g, ' ')}</span>{b.qualificationTask.reason}</p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">Due {fmtDate(b.qualificationTask.dueAt)} / updated {fmtDate(b.qualificationTask.updatedAt)}</p>
          <p className="eyebrow mt-3 mb-1">Prepared outreach (draft)</p>
          <p className="whitespace-pre-wrap border border-dashed border-border p-2 text-sm" data-testid="text-prepared-message">{b.qualificationTask.preparedMessage}</p>
          <p className="mt-2 text-xs text-muted-foreground" data-testid="text-no-provider">The system has not sent this message. <Link href="/workers" className="underline">Review the pending handoff and record actual contact/reply evidence</Link>; owner-reviewed qualification remains separate.</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => { void navigator.clipboard?.writeText(b.qualificationTask!.preparedMessage).then(() => toast({ title: 'Message copied' }), () => toast({ title: 'Copy failed', variant: 'destructive' })); }} data-testid="button-copy-message"><Copy className="mr-1.5 h-3.5 w-3.5" />Copy text</Button>
          {b.qualificationTask.state === 'WAITING_REVIEW' && (isOwner || canResearch) && <div className="mt-3 space-y-2">
            <p className="text-xs text-muted-foreground">Review the reply through owner verification. If it lacks needed evidence, explicitly request another qualification handoff; no automatic resend occurs.</p>
            <input className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm" aria-label="Reason for additional evidence" placeholder="What evidence is still missing?" value={requestNote} onChange={e => setRequestNote(e.target.value)} />
            <Button size="sm" variant="outline" disabled={requestEvidence.isPending || requestNote.trim().length < 3} onClick={() => requestEvidence.mutate({ id, data: { version: b.version, note: requestNote.trim() } }, {
              onSuccess: (saved) => { setFormBuyer(saved); setEpoch(e => e + 1); invalidate(); setRequestNote(''); toast({ title: 'Additional evidence requested', description: 'A pending handoff was queued. Nothing was sent or approved.' }); },
            })}>Request additional evidence</Button>
            {requestEvidence.isError && <ErrorNotice error={requestEvidence.error} />}
          </div>}
        </div>}
      </section>
      {b.lastOutreachReplyAt && <section className="border border-border p-3 text-sm" data-testid="panel-latest-outreach-reply">
        Latest actual outreach reply: {fmtDate(b.lastOutreachReplyAt)}. A reply is not buyer approval; current buying evidence must account for this date.
        {b.lastOutreachReplyEvidenceUrl && <a className="ml-2 underline" href={b.lastOutreachReplyEvidenceUrl} target="_blank" rel="noopener noreferrer">Review reply evidence</a>}
      </section>}

      {b.discoveryEvidence && <section className="ledger p-4 text-sm" data-testid="panel-discovery-evidence">
        <p className="eyebrow mb-2">Observed discovery evidence — not buying approval</p>
        <p>{b.discoveryEvidence.source}</p><p className="font-mono text-xs text-muted-foreground">Captured {fmtDate(b.discoveryEvidence.capturedAt)} / source confidence {b.discoveryEvidence.confidence}</p>
        <EvidenceLink url={b.discoveryEvidence.sourceUrl} label="Original discovery source" />
      </section>}
      <section className={`ledger border-l-4 p-4 ${isQualified(b) ? 'border-l-signal' : 'border-l-border'}`} data-testid="panel-buyer-qualification">
        <p className="eyebrow mb-2">Qualification</p>
        {b.verificationStatus === 'UNVERIFIED' && <p className="text-sm">Discovery is not approval. This profile is excluded from eligible matching until current buying, criteria and required evidence are reviewed.</p>}
        {b.verificationStatus === 'STALE' && <p className="text-sm">Verification expired {fmtDate(b.validUntil)}. Re-review the evidence before this buyer can commit.</p>}
        {b.verificationStatus === 'VERIFIED' && <p className="text-sm">Reviewed by {b.verifiedBy} on {fmtDate(b.verifiedAt)}. {b.destinationKind==='BUYER' ? `Funds reviewed ${money(b.availableFunds)}.` : 'Destination review is not acquisition funding assurance.'} Valid until {fmtDate(b.validUntil)}. Current matching also requires approved buying and criteria evidence.</p>}
        <p className="mt-2 text-sm" data-testid="text-verified-funding">Verified funding methods: {b.verifiedFundingTypes?.length ? b.verifiedFundingTypes.map((t) => t.replace(/_/g, ' ')).join(', ') : 'none recorded'}. Criteria methods: {b.criteria?.fundingTypes?.length ? b.criteria.fundingTypes.map((t) => t.replace(/_/g, ' ')).join(', ') : 'none stated'}. {b.verifiedFundingTypes?.includes('CASH') && b.criteria?.fundingTypes?.includes('CASH') ? 'CASH is in both, so native matching can use this buyer.' : 'Native matching requires CASH in both lists; other methods are excluded pending financing adapters.'}</p>
        {b.verificationNote && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{b.verificationNote}</p>}
        <p className="mt-2 flex gap-4 text-sm"><EvidenceLink url={b.identityEvidenceUrl} label="Identity evidence" /><EvidenceLink url={b.fundingEvidenceUrl} label="Funding evidence" /><EvidenceLink url={b.buyingEvidenceUrl} label="Buying evidence" /><EvidenceLink url={b.criteriaEvidenceUrl} label="Criteria evidence" /></p>
        {b.evidenceAt && <p className="font-mono text-[11px] text-muted-foreground">Evidence captured {fmtDate(b.evidenceAt)}</p>}
      </section>

      {!!b.verificationHistory?.length && <section className="ledger p-4" data-testid="panel-verification-history">
        <p className="eyebrow mb-3">Preserved verification history</p>
        <div className="space-y-3">{[...b.verificationHistory].reverse().map((h,i)=><details key={`${h.reviewedAt}:${i}`} className="border-t border-border pt-2">
          <summary className="cursor-pointer text-sm">{fmtDate(h.reviewedAt)} / {h.currentBuyingStatus} / {h.destinationKind??'BUYER'}</summary>
          <p className="mt-2 text-sm">{h.verificationSource} — {h.verificationNote}</p>
          <p className="text-xs text-muted-foreground">Reviewer {h.reviewedBy}; confidence {h.confidence}; buying evidence {fmtDate(h.buyingEvidenceAt)}; valid until {fmtDate(h.validUntil)}</p>
          <p className="mt-1 flex flex-wrap gap-3 text-sm"><EvidenceLink url={h.buyingEvidenceUrl} label="Buying evidence" /><EvidenceLink url={h.criteriaEvidenceUrl} label="Reviewed criteria" /><EvidenceLink url={h.fundingEvidenceUrl} label="Funding evidence" /></p>
          {h.criteria && <p className="mt-2 text-xs">Reviewed buy box: {h.criteria.states.join(', ')}; {h.criteria.propertyTypes.join(', ')}; up to {money(h.criteria.maxPurchasePrice)}; {h.criteria.minUnits}–{h.criteria.maxUnits} units.</p>}
        </details>)}</div>
      </section>}
      {editing.version!==b.version && <div className="ledger p-3 text-sm" data-testid="text-buyer-changed">This profile changed while you were editing. Unsaved input is preserved; saving the old version will be rejected. <Button variant="outline" size="sm" onClick={reloadForms}>Reload forms (discard unsaved input)</Button></div>}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="ledger p-4" data-testid="panel-buyer-criteria">
          <p className="eyebrow mb-3">Contact, destination and buy box</p>
          <BuyerForm key={`${b.id}:${epoch}`} buyer={editing} disabled={!canResearch} submitLabel="Save buyer" pending={update.isPending} error={update.error} onCancel={reloadForms}
            onSubmit={(data) => update.mutate({ id, data: { ...data, version: editing.version } }, { onSuccess: (saved) => { setFormBuyer(saved);invalidate(); setEpoch((e) => e + 1); toast({ title: 'Buyer saved', description: 'Matching queued against open deals.' }); } })} />
        </section>
        <section className="ledger h-fit p-4" data-testid="panel-buyer-verification">
          <p className="eyebrow mb-3">Human verification</p>
          <BuyerVerificationForm key={`${b.id}:${epoch}`} buyer={editing} disabled={!isOwner} pending={verify.isPending} error={verify.error}
            onSubmit={(data, done) => verify.mutate({ id, data }, { onSuccess: (saved) => {setFormBuyer(saved);setEpoch(e=>e+1);invalidate(); done(); toast({ title: 'Verification recorded' }); } })} />
        </section>
      </div>
    </div>
  );
}
