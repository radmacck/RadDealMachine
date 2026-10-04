import { useState } from 'react';
import { Link } from 'wouter';
import { RefreshCw } from 'lucide-react';
import {
  getGetDealOperationsQueryKey, useCreateContract, useExecuteContract, useGetDealOperations, useRecordBuyerResponse,
  useRecordClosingMilestone, useRecordDealOutcome, useRefreshMatches,
  type BuyerMatch, type BuyerResponseInputStatus, type ClosingMilestoneInputKind, type DealContract, type DealOutcomeInputOutcome, type LeadDetail,
} from '@workspace/api-client-react';
import { ErrorNotice, RowsSkeleton } from '@/components/state-views';
import { EvidenceLink, Field, SELECT } from '@/components/field-row';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAccess } from '@/hooks/use-access';
import { useInvalidateWork } from '@/hooks/use-invalidate';
import { useToast } from '@/hooks/use-toast';
import { ago, fmtDate, fromLocalInput, isOverdue, money, num } from '@/lib/format';

const MILESTONES: { k: ClosingMilestoneInputKind; label: string }[] = [
  { k: 'TITLE_CLEARED', label: 'Title cleared' }, { k: 'EARNEST_MONEY_CONFIRMED', label: 'Earnest money confirmed' },
  { k: 'ASSIGNMENT_SIGNED', label: 'Assignment signed' }, { k: 'FUNDS_CONFIRMED', label: 'Funds confirmed' },
];
const STATUS_TONE: Record<DealContract['status'], string> = { DRAFT: 'tone-warn', UNDER_CONTRACT: 'tone-go', CLOSING: 'tone-signal', CLOSED: 'tone-ink', CANCELLED: 'tone-stop' };
const STATUS_LABEL: Record<DealContract['status'], string> = { DRAFT: 'Draft, not under contract', UNDER_CONTRACT: 'Under contract', CLOSING: 'Closing', CLOSED: 'Closed', CANCELLED: 'Cancelled' };

function Block({ title, children, tid }: { title: string; children: React.ReactNode; tid: string }) {
  return <section className="ledger p-4" data-testid={tid}><p className="eyebrow mb-3">{title}</p>{children}</section>;
}

function CreateContract({ detail, onDone }: { detail: LeadDetail; onDone: () => void }) {
  const { canCall, isOwner } = useAccess();
  const create = useCreateContract();
  const { toast } = useToast();
  const offer = detail.offers.find((o) => o.effectiveStatus === 'COMMUNICATED');
  const [at, setAt] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  if (!offer) return <p className="text-sm text-muted-foreground" data-testid="text-contract-blocked">Blocked: a contract can only be drafted from the current offer that was recorded as communicated to the seller. Record that on the Offers tab or from the call screen first.</p>;
  const submit = () => {
    const iso = fromLocalInput(at);
    if (!iso || new Date(iso).getTime() <= Date.now()) return setLocal('Choose a future closing date.');
    if (new Date(iso).getTime() > Date.now() + offer.closingDays * 86_400_000) return setLocal(`Closing cannot be more than ${offer.closingDays} days out, the limit in the approved offer.`);
    setLocal(null);
    create.mutate({ id: detail.lead.id, data: { version: detail.lead.version, offerId: offer.id, closingAt: iso } }, { onSuccess: () => { onDone(); toast({ title: 'Contract drafted', description: 'It is not under contract until executed evidence is recorded.' }); } });
  };
  return (
    <div className="space-y-3" data-testid="form-create-contract">
      <p className="text-sm">Drafting copies the communicated offer exactly: {money(offer.amount)} price, {money(offer.earnestMoney)} deposit, {offer.assignmentIntent ? 'assignment intended' : 'no assignment'}, contingencies as approved. Terms cannot be edited afterwards.</p>
      <Field label="Closing date" hint={`At most ${offer.closingDays} days from today`}><Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} disabled={!(canCall || isOwner)} data-testid="input-contract-closing" /></Field>
      {local && <p className="text-sm text-destructive">{local}</p>}
      {create.error != null && <ErrorNotice error={create.error} />}
      <Button disabled={!(canCall || isOwner) || create.isPending} onClick={submit} data-testid="button-create-contract">{create.isPending ? 'Drafting...' : 'Draft contract record'}</Button>
    </div>
  );
}

function ExecuteContract({ contract, onDone }: { contract: DealContract; onDone: () => void }) {
  const { isOwner } = useAccess();
  const run = useExecuteContract();
  const { toast } = useToast();
  const [url, setUrl] = useState(''); const [seller, setSeller] = useState(''); const [acq, setAcq] = useState(''); const [note, setNote] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const submit = () => {
    const s = fromLocalInput(seller); const a = fromLocalInput(acq);
    if (url.trim().length < 8) return setLocal('Link the executed document.');
    if (!s || !a) return setLocal('Enter when each party signed.');
    if (new Date(s).getTime() > Date.now() || new Date(a).getTime() > Date.now()) return setLocal('Signature times must be in the past.');
    if (!note.trim()) return setLocal('Add your review note.');
    setLocal(null);
    run.mutate({ id: contract.leadId, data: { version: contract.version, executedDocumentUrl: url.trim(), sellerSignedAt: s, acquisitionSignedAt: a, reviewNote: note.trim() } }, { onSuccess: () => { onDone(); toast({ title: 'Execution recorded', description: 'Buyer matching has been queued.' }); } });
  };
  return (
    <div className="space-y-3" data-testid="form-execute-contract">
      <p className="text-sm text-muted-foreground">Signatures happen outside this system. Record the evidence of a document that is already signed by both sides.</p>
      <Field label="Executed document link"><Input value={url} onChange={(e) => setUrl(e.target.value)} disabled={!isOwner} data-testid="input-exec-url" /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Seller signed"><Input type="datetime-local" value={seller} onChange={(e) => setSeller(e.target.value)} disabled={!isOwner} data-testid="input-exec-seller" /></Field>
        <Field label="Our side signed"><Input type="datetime-local" value={acq} onChange={(e) => setAcq(e.target.value)} disabled={!isOwner} data-testid="input-exec-acq" /></Field>
      </div>
      <Field label="Review note"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={!isOwner} data-testid="input-exec-note" /></Field>
      {local && <p className="text-sm text-destructive">{local}</p>}
      {run.error != null && <ErrorNotice error={run.error} />}
      <Button disabled={!isOwner || run.isPending} onClick={submit} data-testid="button-execute-contract">{run.isPending ? 'Recording...' : 'Record executed contract'}</Button>
      {!isOwner && <p className="text-xs text-muted-foreground">Only the owner can record execution.</p>}
    </div>
  );
}

function RespondForm({ contract, match, onDone }: { contract: DealContract; match: BuyerMatch; onDone: () => void }) {
  const { canCall, isOwner } = useAccess();
  const rec = useRecordBuyerResponse();
  const { toast } = useToast();
  const [status, setStatus] = useState<BuyerResponseInputStatus>('INTERESTED');
  const [evidence, setEvidence] = useState(''); const [url, setUrl] = useState(''); const [price, setPrice] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const floor = contract.purchasePrice + contract.assignmentTarget;
  const isBuyer = (match.destinationKind ?? 'BUYER') === 'BUYER';
  const commit = status === 'COMMITTED' && isBuyer;
  const submit = () => {
    if (evidence.trim().length < 10) return setLocal('Describe the response with evidence (10+ characters).');
    const p = num(price);
    if (commit) {
      if (url.trim().length < 8) return setLocal('Link the buyer commitment evidence.');
      if (!Number.isFinite(p) || p < floor) return setLocal(`Agreed price must be at least ${money(floor)} (purchase price plus assignment target).`);
    }
    setLocal(null);
    rec.mutate({ id: contract.leadId, buyerId: match.buyerId, data: { version: contract.version, buyerVersion: match.buyerVersion, status, evidence: evidence.trim(), ...(commit ? { commitmentEvidenceUrl: url.trim(), agreedPrice: p } : {}) } },
      { onSuccess: () => { onDone(); toast({ title: 'Buyer response recorded', description: `${match.buyerName}: ${status.toLowerCase()}` }); } });
  };
  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3" data-testid={`form-response-${match.buyerId}`}>
      <Field label="Response"><select className={SELECT} value={status} onChange={(e) => setStatus(e.target.value as BuyerResponseInputStatus)} data-testid={`select-response-${match.buyerId}`}>
        <option value="INTERESTED">Interested</option><option value="COMMITTED" disabled={!isOwner || !isBuyer}>{isBuyer ? 'Committed (owner only)' : 'Commitment unavailable for this destination'}</option><option value="DECLINED">Declined</option></select></Field>
      <Field label="What the buyer said or sent"><Textarea rows={2} value={evidence} onChange={(e) => setEvidence(e.target.value)} disabled={!(canCall || isOwner)} data-testid={`input-response-evidence-${match.buyerId}`} /></Field>
      {commit && <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Commitment evidence link"><Input value={url} onChange={(e) => setUrl(e.target.value)} data-testid={`input-response-url-${match.buyerId}`} /></Field>
        <Field label="Agreed price" hint={`At least ${money(floor)}; also capped by the buyer's reviewed funds and budget`}><Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} data-testid={`input-response-price-${match.buyerId}`} /></Field></div>}
      {local && <p className="text-sm text-destructive">{local}</p>}
      {rec.error != null && <ErrorNotice error={rec.error} />}
      <Button size="sm" disabled={!(canCall || isOwner) || rec.isPending} onClick={submit} data-testid={`button-submit-response-${match.buyerId}`}>{rec.isPending ? 'Recording...' : 'Record response'}</Button>
    </div>
  );
}

function MilestoneForm({ contract, onDone }: { contract: DealContract; onDone: () => void }) {
  const { isOwner } = useAccess();
  const rec = useRecordClosingMilestone();
  const { toast } = useToast();
  const open = MILESTONES.filter((m) => !contract.milestones.some((x) => x.kind === m.k));
  const [kind, setKind] = useState<ClosingMilestoneInputKind | ''>('');
  const [url, setUrl] = useState(''); const [note, setNote] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const k = kind || open[0]?.k;
  if (!k) return <p className="text-sm text-muted-foreground">All four milestones are recorded.</p>;
  const submit = () => {
    if (url.trim().length < 8 || note.trim().length < 3) return setLocal('Evidence link and a note are required.');
    setLocal(null);
    rec.mutate({ id: contract.leadId, data: { version: contract.version, kind: k, evidenceUrl: url.trim(), note: note.trim() } }, { onSuccess: () => { setUrl(''); setNote(''); setKind(''); onDone(); toast({ title: 'Milestone recorded' }); } });
  };
  return (
    <div className="space-y-3" data-testid="form-milestone">
      <Field label="Milestone"><select className={SELECT} value={k} onChange={(e) => setKind(e.target.value as ClosingMilestoneInputKind)} disabled={!isOwner} data-testid="select-milestone">{open.map((m) => <option key={m.k} value={m.k}>{m.label}</option>)}</select></Field>
      <Field label="Evidence link"><Input value={url} onChange={(e) => setUrl(e.target.value)} disabled={!isOwner} data-testid="input-milestone-url" /></Field>
      <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} disabled={!isOwner} data-testid="input-milestone-note" /></Field>
      {local && <p className="text-sm text-destructive">{local}</p>}
      {rec.error != null && <ErrorNotice error={rec.error} />}
      <Button size="sm" disabled={!isOwner || rec.isPending} onClick={submit} data-testid="button-record-milestone">{rec.isPending ? 'Recording...' : 'Record milestone'}</Button>
      {!isOwner && <p className="text-xs text-muted-foreground">Only the owner can record closing milestones.</p>}
    </div>
  );
}

function OutcomeForm({ contract, onDone }: { contract: DealContract; onDone: () => void }) {
  const { isOwner } = useAccess();
  const rec = useRecordDealOutcome();
  const { toast } = useToast();
  const [outcome, setOutcome] = useState<DealOutcomeInputOutcome>('CLOSED');
  const [url, setUrl] = useState(''); const [note, setNote] = useState(''); const [fee, setFee] = useState(''); const [costs, setCosts] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const expected = contract.agreedBuyerPrice != null ? contract.agreedBuyerPrice - contract.purchasePrice : null;
  const missing = MILESTONES.filter((m) => !contract.milestones.some((x) => x.kind === m.k));
  const submit = () => {
    if (url.trim().length < 8 || note.trim().length < 3) return setLocal('Evidence link and a note are required.');
    const f = num(fee); const c = num(costs);
    if (outcome === 'CLOSED') {
      if (missing.length) return setLocal(`Cannot close: missing ${missing.map((m) => m.label.toLowerCase()).join(', ')}.`);
      if (!contract.committedBuyerId) return setLocal('Cannot close without a committed, currently qualified buyer.');
      if (!Number.isFinite(f) || !Number.isFinite(c)) return setLocal('Enter the actual assignment fee received and closing costs.');
      if (expected != null && Math.abs(f - expected) > 0.005) return setLocal(`Fee received must equal agreed price minus purchase price: ${money(expected)}.`);
    }
    setLocal(null);
    rec.mutate({ id: contract.leadId, data: { version: contract.version, outcome, evidenceUrl: url.trim(), note: note.trim(), ...(outcome === 'CLOSED' ? { assignmentFeeReceived: f, closingCosts: c } : {}) } }, { onSuccess: () => { onDone(); toast({ title: outcome === 'CLOSED' ? 'Deal closed' : 'Deal cancelled' }); } });
  };
  return (
    <div className="space-y-3" data-testid="form-outcome">
      <Field label="Outcome"><select className={SELECT} value={outcome} onChange={(e) => setOutcome(e.target.value as DealOutcomeInputOutcome)} disabled={!isOwner} data-testid="select-outcome"><option value="CLOSED">Closed</option><option value="CANCELLED">Cancelled</option></select></Field>
      <Field label="Evidence link"><Input value={url} onChange={(e) => setUrl(e.target.value)} disabled={!isOwner} data-testid="input-outcome-url" /></Field>
      <Field label="Note"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={!isOwner} data-testid="input-outcome-note" /></Field>
      {outcome === 'CLOSED' && <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Assignment fee received" hint={expected != null ? `Must equal ${money(expected)}` : 'Needs a committed buyer'}><Input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} disabled={!isOwner} data-testid="input-outcome-fee" /></Field>
        <Field label="Closing costs paid"><Input inputMode="decimal" value={costs} onChange={(e) => setCosts(e.target.value)} disabled={!isOwner} data-testid="input-outcome-costs" /></Field></div>}
      {local && <p className="text-sm text-destructive" data-testid="text-outcome-error">{local}</p>}
      {rec.error != null && <ErrorNotice error={rec.error} />}
      <Button size="sm" variant={outcome === 'CANCELLED' ? 'destructive' : 'default'} disabled={!isOwner || rec.isPending} onClick={submit} data-testid="button-record-outcome">{rec.isPending ? 'Recording...' : outcome === 'CLOSED' ? 'Record closing' : 'Record cancellation'}</Button>
      {!isOwner && <p className="text-xs text-muted-foreground">Only the owner can record the outcome.</p>}
    </div>
  );
}

export function DealOperationsPanel({ detail }: { detail: LeadDetail }) {
  const id = detail.lead.id;
  const invalidate = useInvalidateWork();
  const { canResearch, canCall, isOwner } = useAccess();
  const { toast } = useToast();
  const [respondTo, setRespondTo] = useState<string | null>(null);
  const q = useGetDealOperations(id, { query: { queryKey: getGetDealOperationsQueryKey(id), enabled: !!id, staleTime: 5_000, refetchInterval: 10_000 } });
  const refresh = useRefreshMatches();
  const done = () => { invalidate(id); setRespondTo(null); };

  if (q.isLoading) return <RowsSkeleton rows={4} />;
  if (q.isError || !q.data) return <ErrorNotice error={q.error} onRetry={() => q.refetch()} />;
  const ops = q.data;
  const c = ops.contract;
  const live = c && (c.status === 'UNDER_CONTRACT' || c.status === 'CLOSING');
  const eligible = ops.matches.filter((m) => m.eligible);
  const excluded = ops.matches.filter((m) => !m.eligible);

  return (
    <div className="space-y-4" data-testid="panel-deal-operations">
      <div className="ledger border-l-4 border-l-signal p-3 text-sm" data-testid="text-ops-next"><b>Next action:</b> {ops.nextAction || 'none recorded'}</div>

      <Block title="Contract" tid="panel-contract">
        {!c ? <CreateContract detail={detail} onDone={done} /> : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2"><span className={`tag ${STATUS_TONE[c.status]}`} data-testid="tag-contract-status">{STATUS_LABEL[c.status]}</span>
              <span className={`font-mono text-xs ${isOverdue(c.closingAt) && c.status !== 'CLOSED' && c.status !== 'CANCELLED' ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>Closing {fmtDate(c.closingAt)} ({ago(c.closingAt)})</span></div>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4" data-testid="list-contract-terms">
              <div><dt className="eyebrow">Purchase price</dt><dd className="font-mono">{money(c.purchasePrice)}</dd></div>
              <div><dt className="eyebrow">Earnest money</dt><dd className="font-mono">{money(c.earnestMoney)}</dd></div>
              <div><dt className="eyebrow">Assignment target</dt><dd className="font-mono">{money(c.assignmentTarget)}</dd></div>
              <div><dt className="eyebrow">Assignment</dt><dd>{c.assignmentAllowed ? 'Allowed' : 'Not allowed'}</dd></div>
              <div className="sm:col-span-2 lg:col-span-4"><dt className="eyebrow">Contingencies</dt><dd className="whitespace-pre-wrap">{c.contingencies}</dd></div>
            </dl>
            {c.status === 'DRAFT' && <ExecuteContract key={c.version} contract={c} onDone={done} />}
            {c.executedDocumentUrl && <p className="text-sm"><EvidenceLink url={c.executedDocumentUrl} label="Executed document" /> / seller signed {fmtDate(c.sellerSignedAt)} / our side signed {fmtDate(c.acquisitionSignedAt)}{c.reviewNote ? ` / ${c.reviewNote}` : ''}</p>}
          </div>
        )}
      </Block>

      <Block title="Buyers for this deal" tid="panel-matches">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-xl text-sm text-muted-foreground">Matching compares buyer criteria with this property. A match is not a commitment, and only a human-verified buyer can commit.</p>
          <Button size="sm" variant="outline" disabled={!(canResearch || canCall || isOwner) || refresh.isPending} onClick={() => refresh.mutate({ id }, { onSuccess: () => { invalidate(id); toast({ title: 'Matching refreshed' }); } })} data-testid="button-refresh-matches"><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refresh.isPending ? 'animate-spin' : ''}`} />Refresh matches</Button>
        </div>
        {refresh.error != null && <div className="mb-3"><ErrorNotice error={refresh.error} /></div>}
        {ops.matches.length === 0 && <p className="text-sm text-muted-foreground" data-testid="empty-matches">No buyers evaluated yet. <Link href="/buyers" className="underline">Add a buyer</Link> or refresh matching.</p>}
        <ul className="space-y-2">{eligible.map((m) => (
          <li key={m.buyerId} className="border border-border p-3" data-testid={`match-${m.buyerId}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link href={`/buyers/${m.buyerId}`} className="font-semibold hover:text-signal">{m.buyerName}</Link>
              <span className="flex items-center gap-2"><span className="font-mono text-xs">score {m.score}</span><span className={`tag ${m.status === 'COMMITTED' ? 'tone-go' : m.status === 'INTERESTED' ? 'tone-warn' : m.status === 'DECLINED' ? 'tone-stop' : 'tone-muted'}`}>{m.status}</span></span></div>
            <ul className="mt-1 list-disc pl-4 text-sm text-muted-foreground">{m.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            {m.mismatches.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Watch: {m.mismatches.join('; ')}</p>}
            {m.status === 'COMMITTED' && m.agreedPrice != null && <p className="mt-1 font-mono text-xs">Agreed {money(m.agreedPrice)}</p>}
            {m.evidence && <p className="mt-1 text-xs">Evidence: {m.evidence}</p>}
            {(m.destinationKind ?? 'BUYER') !== 'BUYER' && <p className="mt-1 text-xs" data-testid={`text-destination-${m.buyerId}`}><span className="tag tone-signal mr-1">{(m.destinationKind ?? '').replace('_', ' ')}</span>Not an end buyer. Interest here is a referral route, not a purchase commitment.</p>}
            {live && c && (respondTo === m.buyerId ? <RespondForm key={`${c.version}:${m.buyerVersion}`} contract={c} match={m} onDone={done} /> :
              <Button size="sm" variant="outline" className="mt-2" onClick={() => setRespondTo(m.buyerId)} data-testid={`button-respond-${m.buyerId}`}>Record buyer response</Button>)}
          </li>))}</ul>
        {!live && eligible.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Buyer responses can be recorded once the contract is executed.</p>}
        {excluded.length > 0 && (
          <details className="mt-3" data-testid="list-excluded"><summary className="cursor-pointer text-sm text-muted-foreground">{excluded.length} buyer{excluded.length === 1 ? '' : 's'} excluded</summary>
            <ul className="mt-2 space-y-1 text-sm">{excluded.map((m) => <li key={m.buyerId}><span className="font-semibold">{m.buyerName}</span>: {m.mismatches.join('; ') || 'does not fit'}</li>)}</ul></details>
        )}
      </Block>

      <Block title="Closing" tid="panel-closing">
        {!c || c.status === 'DRAFT' ? <p className="text-sm text-muted-foreground">Closing work opens after the contract is executed.</p> : (
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <ul className="space-y-1.5" data-testid="list-milestones">{MILESTONES.map((m) => {
                const x = c.milestones.find((y) => y.kind === m.k);
                return <li key={m.k} className="flex items-start justify-between gap-2 text-sm"><span className={x ? 'font-semibold' : 'text-muted-foreground'}>{m.label}</span>
                  {x ? <span className="text-right text-xs"><EvidenceLink url={x.evidenceUrl} label="evidence" /> / {x.recordedBy} / {fmtDate(x.recordedAt)}</span> : <span className="tag tone-future">open</span>}</li>;
              })}</ul>
              {c.status === 'CLOSED' || c.status === 'CANCELLED' ? (
                <div className="mt-4 border-t border-border pt-3 text-sm" data-testid="panel-outcome">
                  <p className="font-semibold">{c.status === 'CLOSED' ? 'Closed' : 'Cancelled'} {fmtDate(c.closedAt)}</p>
                  {c.status === 'CLOSED' && <p className="font-mono text-xs">Fee {money(c.assignmentFeeReceived)} / costs {money(c.closingCosts)} / net {money(c.netProceeds)}</p>}
                  <p className="text-muted-foreground">{c.outcomeNote} <EvidenceLink url={c.outcomeEvidenceUrl} label="evidence" /></p></div>
              ) : <div className="mt-4 border-t border-border pt-3"><MilestoneForm key={c.version} contract={c} onDone={done} /></div>}
            </div>
            {c.status !== 'CLOSED' && c.status !== 'CANCELLED' && <div className="border-border lg:border-l lg:pl-5"><p className="eyebrow mb-3">Record outcome</p><OutcomeForm key={c.version} contract={c} onDone={done} /></div>}
          </div>
        )}
      </Block>

      {ops.jobs.length > 0 && (
        <Block title="Worker activity on this deal" tid="panel-ops-jobs">
          <ul className="space-y-1 text-sm">{ops.jobs.slice(0, 5).map((j) => <li key={j.id}><span className="tag tone-muted mr-2">{j.state}</span>{j.kind.replace(/_/g, ' ').toLowerCase()}: {j.message || 'pending'} <span className="font-mono text-[11px] text-muted-foreground">{ago(j.updatedAt)}</span></li>)}</ul>
          <Link href="/workers" className="mt-2 inline-block text-xs underline">All worker activity</Link>
        </Block>
      )}
    </div>
  );
}
