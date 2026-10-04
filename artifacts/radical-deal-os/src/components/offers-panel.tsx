import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetLeadQueryKey, useAuthorizeOffer, useCommunicateOffer, useCreateOfferDraft, useWithdrawOffer,
  type Intelligence, type LeadDetail, type Lead, type Offer, type OfferCommunicationInput, type OfferCommunicationInputChannel,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ErrorNotice } from '@/components/state-views';
import { useAccess } from '@/hooks/use-access';
import { useBaseVersion } from '@/hooks/use-base-version';
import { useInvalidateWork } from '@/hooks/use-invalidate';
import { useToast } from '@/hooks/use-toast';
import { ago, fmtDate, money, num } from '@/lib/format';

const AUTH_CATS = ['ownership', 'seller_authority', 'owner_authority'];
const CHANNELS: OfferCommunicationInputChannel[] = ['PHONE', 'IN_PERSON', 'EMAIL', 'SMS'];
const iso = (local: string) => (local ? new Date(local).toISOString() : '');
const future = (local: string) => !!local && new Date(local).getTime() > Date.now();
const STATUS_TONE: Record<string, string> = { DRAFT: 'tone-muted', AUTHORIZED: 'tone-go', COMMUNICATED: 'tone-ink', REVOKED: 'tone-stop', INVALIDATED: 'tone-stop', EXPIRED: 'tone-warn' };

export const authorityEvidence = (items: Intelligence[]) =>
  items.filter((i) => {
    const age = Date.now() - Date.parse(i.capturedAt);
    return i.classification === 'VERIFIED_FACTS' && i.sourceType === 'PUBLIC_RECORD'
      && AUTH_CATS.includes(i.category.trim().toLowerCase()) && !!i.verificationNote?.trim()
      && Number.isFinite(age) && age >= 0 && age <= 30 * 86_400_000;
  });

function Stale({ lead, base, onRebase, onDiscard }: { lead: number; base: number; onRebase: () => void; onDiscard: () => void }) {
  return (
    <div className="border border-signal bg-card p-3 text-sm" data-testid="notice-offer-stale">
      This lead is now at version {lead}; this form started from {base}. Your entries are kept.
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="outline" onClick={onRebase} data-testid="button-offer-rebase">Keep draft, save over latest</Button>
        <Button size="sm" variant="ghost" onClick={onDiscard} data-testid="button-offer-discard">Discard draft, load latest</Button>
      </div>
    </div>
  );
}

function Terms({ o }: { o: Offer }) {
  return (
    <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5" data-testid={`terms-${o.id}`}>
      <div><dt className="eyebrow">Amount</dt><dd className="font-mono font-semibold">{money(o.amount)}</dd></div>
      <div><dt className="eyebrow">Earnest money</dt><dd className="font-mono">{money(o.earnestMoney)}</dd></div>
      <div><dt className="eyebrow">Closing</dt><dd className="font-mono">{o.closingDays} days</dd></div>
      <div><dt className="eyebrow">Assignment</dt><dd>{o.assignmentIntent ? 'Intended' : 'Not intended'}</dd></div>
      <div className="col-span-2 sm:col-span-5"><dt className="eyebrow">Contingencies</dt><dd>{o.contingencies}</dd></div>
    </dl>
  );
}

export function ApprovedTerms({ offer }: { offer: Offer }) {
  return (
    <div className="space-y-2" data-testid="approved-terms">
      <Terms o={offer} />
      <p className="text-sm">Authorized ceiling <b className="font-mono">{money(offer.maximumApprovedAcquisitionPrice)}</b>, expires {offer.expiresAt ? `${fmtDate(offer.expiresAt)} (${ago(offer.expiresAt)})` : 'not set'}. Approved by {offer.approvedBy}.</p>
    </div>
  );
}

const NOTICE = 'This app never sends anything. No message is sent and no contract is executed. Record only what a person actually communicated.';

export function CommunicateForm({ offer, lead, pending, error, disabled, onSubmit, onDiscard }: {
  offer: Offer; lead: Lead; pending: boolean; error: unknown; disabled?: boolean;
  onSubmit: (d: OfferCommunicationInput, done: () => void) => void; onDiscard?: () => void;
}) {
  const { base, stale, rebase } = useBaseVersion(lead.version);
  const [channel, setChannel] = useState<OfferCommunicationInputChannel>('PHONE');
  const [evidence, setEv] = useState('');
  const [next, setNext] = useState('');
  const [fu, setFu] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const submit = () => {
    if (evidence.trim().length < 3) return setLocal('Evidence needs at least 3 characters: a reference or a factual note of what was said.');
    if (next.trim().length < 3) return setLocal('Next action needs at least 3 characters.');
    if (!future(fu)) return setLocal('Follow-up must be in the future.');
    setLocal(null);
    onSubmit({ version: base, amount: offer.amount, channel, evidence: evidence.trim(), nextAction: next.trim(), followUpAt: iso(fu) }, () => { rebase(); setEv(''); setNext(''); setFu(''); });
  };
  return (
    <div className="space-y-3" data-testid="form-communicate">
      {stale && <Stale lead={lead.version} base={base} onRebase={rebase} onDiscard={onDiscard ?? (() => { setChannel('PHONE'); setEv(''); setNext(''); setFu(''); setLocal(null); rebase(); })} />}
      <div className="border border-dashed border-border bg-muted/50 p-3">
        <p className="eyebrow mb-1">Approved terms to be recorded (immutable)</p>
        <ApprovedTerms offer={offer} />
      </div>
      <p className="text-xs font-semibold" data-testid="text-no-send">{NOTICE}</p>
      <div className="space-y-1.5"><Label>Channel used</Label>
        <Select value={channel} onValueChange={(v) => setChannel(v as OfferCommunicationInputChannel)} disabled={disabled}>
          <SelectTrigger data-testid="select-offer-channel"><SelectValue /></SelectTrigger>
          <SelectContent>{CHANNELS.map((c) => <SelectItem key={c} value={c}>{c.replace('_', ' ')}</SelectItem>)}</SelectContent>
        </Select></div>
      <div className="space-y-1.5"><Label>Evidence of the communication</Label><Textarea rows={3} value={evidence} disabled={disabled} onChange={(e) => setEv(e.target.value)} placeholder="Spoke with seller at 2:10 pm, stated the amount, he will confer with his sister." data-testid="input-offer-evidence" /></div>
      <div className="space-y-1.5"><Label>Next action</Label><Input value={next} disabled={disabled} onChange={(e) => setNext(e.target.value)} data-testid="input-offer-comm-next" /></div>
      <div className="space-y-1.5"><Label>Follow up (required, future)</Label><Input type="datetime-local" value={fu} disabled={disabled} onChange={(e) => setFu(e.target.value)} data-testid="input-offer-comm-followup" /></div>
      {local && <p className="text-sm text-destructive" data-testid="text-offer-comm-local-error">{local}</p>}
      {error != null && <ErrorNotice error={error} />}
      {disabled && <p className="text-xs text-muted-foreground">Only the owner or operator can record a communicated offer.</p>}
      <Button className="w-full" onClick={submit} disabled={disabled || pending} data-testid="button-record-communicated">{pending ? 'Recording' : 'Record communicated offer'}</Button>
    </div>
  );
}

export function useOfferCommunicate() {
  const qc = useQueryClient();
  const invalidate = useInvalidateWork();
  const { toast } = useToast();
  const m = useCommunicateOffer();
  const run = (lead: Lead, offer: Offer, data: OfferCommunicationInput, done: () => void) =>
    m.mutate({ id: lead.id, offerId: offer.id, data }, { onSuccess: (d) => { qc.setQueryData(getGetLeadQueryKey(lead.id), d); invalidate(lead.id); done(); toast({ title: 'Communication recorded', description: `${money(offer.amount)} by ${data.channel.replace('_', ' ').toLowerCase()}` }); } });
  return { run, pending: m.isPending, error: m.error };
}

export function OffersPanel({ detail, onGoIntel }: { detail: LeadDetail; onGoIntel: () => void }) {
  const { access, canResearch, isOwner, canCall } = useAccess();
  const qc = useQueryClient();
  const invalidate = useInvalidateWork();
  const { toast } = useToast();
  const { lead, analysis, offers, intelligence } = detail;
  const [mode, setMode] = useState<{ kind: 'draft' } | { kind: 'approve' | 'communicate' | 'withdraw'; offer: Offer } | null>(null);
  const [epoch, setEpoch] = useState(0);
  const create = useCreateOfferDraft();
  const approve = useAuthorizeOffer();
  const withdraw = useWithdrawOffer();
  const comm = useOfferCommunicate();
  const evid = authorityEvidence(intelligence);

  const ok = (d: LeadDetail, title: string) => { qc.setQueryData(getGetLeadQueryKey(lead.id), d); invalidate(lead.id); setMode(null); toast({ title }); };
  const open = (m: NonNullable<typeof mode>) => { create.reset(); approve.reset(); withdraw.reset(); setEpoch((e) => e + 1); setMode(m); };
  const sorted = [...offers].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const draftStages = ['CONVERSATION', 'NEGOTIATING', 'OFFER_READY', 'OFFER_SENT'];
  const fresh = !!analysis && Date.now() - Date.parse(analysis.calculatedAt) < 7 * 86_400_000;
  const conversationLogged = detail.calls.some(c => c.outcome === 'CONNECTED');
  const canDraftNow = canResearch && draftStages.includes(lead.stage) && fresh && conversationLogged && !!analysis && ['STRONG', 'NEGOTIABLE'].includes(analysis.classification) && !!detail.analysisSnapshotId;
  const draftWhy = !canResearch ? 'Your role cannot draft offers.' : !draftStages.includes(lead.stage) || !conversationLogged ? 'Drafting opens after a logged, connected seller conversation.' : !analysis || !detail.analysisSnapshotId ? 'No current complete underwriting.' : !fresh ? 'Underwriting is over seven days old; refresh before drafting or approving.' : !['STRONG', 'NEGOTIABLE'].includes(analysis.classification) ? `Underwriting says ${analysis.classification}; only Strong or Negotiable leads can be drafted.` : null;

  return (
    <div className="space-y-4" data-testid="panel-offers">
      <div className="ledger border-l-4 border-l-signal p-3 text-sm">
        <p><b>How this works.</b> An analyst drafts terms. Terms never change after saving. Only the owner authorizes a ceiling, backed by verified authority evidence. A person then makes the offer and records it here. Approval is not title clearance, not a contract, and not a message sent.</p>
        <p className="mt-1 text-xs text-muted-foreground">Research analysis ceiling stays "Not authorized". Authorization lives on the offer below, separate from the research snapshot.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xl font-semibold">Offers ({offers.length})</h3>
        <Button onClick={() => open({ kind: 'draft' })} disabled={!canDraftNow} data-testid="button-new-offer-draft">New offer draft</Button>
      </div>
      {draftWhy && <p className="text-xs text-muted-foreground" data-testid="text-draft-blocked">{draftWhy}</p>}

      {mode?.kind === 'draft' && <DraftForm key={`d${epoch}`} lead={lead} pending={create.isPending} error={create.error} onCancel={() => setMode(null)}
        onSubmit={(data) => create.mutate({ id: lead.id, data }, { onSuccess: (d) => ok(d, 'Draft saved') })} />}

      {offers.length === 0 && !mode && <p className="border border-dashed border-border p-4 text-sm text-muted-foreground" data-testid="empty-offers">No offers on this lead yet.</p>}

      <ol className="space-y-3">
        {sorted.map((o, idx) => {
          const st = o.effectiveStatus;
          const stale = st !== o.status;
          const active = mode && 'offer' in mode && mode.offer.id === o.id ? mode : null;
          return (
            <li key={o.id} className={`ledger p-4 ${idx > 0 && ['REVOKED', 'INVALIDATED', 'EXPIRED'].includes(st) ? 'opacity-90' : ''}`} data-testid={`offer-${o.id}`}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className={`tag ${STATUS_TONE[st] ?? 'tone-muted'}`} data-testid={`status-offer-${o.id}`}>{st}</span>
                {stale && <span className="tag tone-muted">Recorded as {o.status}</span>}
                <span className="font-mono text-xs text-muted-foreground">drafted by {o.createdBy}, {fmtDate(o.createdAt)}</span>
              </div>
              <Terms o={o} />
              <p className="mt-2 text-xs text-muted-foreground">Draft reason: {o.reason}</p>
              {o.approvedAt && <p className="mt-1 text-sm" data-testid={`approval-${o.id}`}>Owner approval by {o.approvedBy}, {fmtDate(o.approvedAt)}: ceiling <b className="font-mono">{money(o.maximumApprovedAcquisitionPrice)}</b>, expires {o.expiresAt ? fmtDate(o.expiresAt) : 'n/a'}. {o.approvalReason}{o.authorityEvidenceId && <span className="text-xs text-muted-foreground"> Authority evidence {o.authorityEvidenceId.slice(0, 8)}.</span>}</p>}
              {o.communicatedAt && <p className="mt-1 text-sm" data-testid={`communication-${o.id}`}>Communicated {money(o.communicatedAmount)} by {o.channel?.replace('_', ' ').toLowerCase()} per {o.communicatedBy}, {fmtDate(o.communicatedAt)}. Evidence: {o.evidence}</p>}
              {o.withdrawalReason && <p className="mt-1 text-sm text-destructive">Withdrawn or revoked: {o.withdrawalReason}</p>}
              {o.blockers.length > 0 && <ul className="mt-2 list-disc border border-signal/60 bg-signal/5 p-2 pl-6 text-xs" data-testid={`blockers-${o.id}`}>{o.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>}
              {st === 'EXPIRED' && <p className="mt-1 text-xs font-semibold">Expired. This is not an authorized offer.</p>}
              {st === 'INVALIDATED' && <p className="mt-1 text-xs font-semibold">Invalidated because the facts it relied on changed. Not authorized.</p>}
              {st === 'COMMUNICATED' && <p className="mt-1 text-xs text-muted-foreground">Revoking internal approval does not recall an offer already communicated to the seller.</p>}

              <div className="mt-3 flex flex-wrap gap-2">
                {st === 'DRAFT' && <Button size="sm" onClick={() => open({ kind: 'approve', offer: o })} disabled={!isOwner} title={isOwner ? undefined : 'Owner only'} data-testid={`button-authorize-${o.id}`}>Authorize as owner</Button>}
                {st === 'DRAFT' && <Button size="sm" variant="outline" onClick={() => open({ kind: 'withdraw', offer: o })} disabled={!(isOwner || (canResearch && o.createdBy === access.userId))} data-testid={`button-cancel-draft-${o.id}`}>Cancel draft</Button>}
                {st === 'AUTHORIZED' && <Button size="sm" onClick={() => open({ kind: 'communicate', offer: o })} disabled={!(isOwner || canCall)} data-testid={`button-open-communicate-${o.id}`}>Record communicated offer</Button>}
                {['AUTHORIZED','COMMUNICATED'].includes(o.status) && <Button size="sm" variant="outline" onClick={() => open({ kind: 'withdraw', offer: o })} disabled={!isOwner} title={isOwner ? undefined : 'Owner only'} data-testid={`button-revoke-${o.id}`}>Revoke approval</Button>}
              </div>
              {st === 'DRAFT' && !isOwner && <p className="mt-1 text-xs text-muted-foreground">Waiting on owner authorization.</p>}

              {active?.kind === 'approve' && <div className="mt-3 border-t border-border pt-3"><fieldset disabled={!isOwner || st !== 'DRAFT'}><ApproveForm key={`a${epoch}`} offer={o} detail={detail} evid={evid} onGoIntel={onGoIntel} pending={approve.isPending} error={approve.error} onCancel={() => setMode(null)}
                onSubmit={(data) => approve.mutate({ id: lead.id, offerId: o.id, data }, { onSuccess: (d) => ok(d, 'Offer authorized') })} /></fieldset>{st !== 'DRAFT' && <Button variant="ghost" onClick={() => setMode(null)}>Close unavailable approval</Button>}</div>}
              {active?.kind === 'communicate' && <div className="mt-3 border-t border-border pt-3"><CommunicateForm key={`c${epoch}`} offer={o} lead={lead} disabled={!(canCall || isOwner) || st !== 'AUTHORIZED'} pending={comm.pending} error={comm.error} onDiscard={() => open({ kind: 'communicate', offer: o })}
                onSubmit={(data, done) => comm.run(lead, o, data, () => { done(); setMode(null); })} /></div>}
              {active?.kind === 'withdraw' && <div className="mt-3 border-t border-border pt-3"><WithdrawForm key={`w${epoch}`} offer={o} lead={lead} pending={withdraw.isPending} error={withdraw.error} onCancel={() => setMode(null)}
                onDiscard={() => open({ kind: 'withdraw', offer: o })}
                onSubmit={(data) => withdraw.mutate({ id: lead.id, offerId: o.id, data }, { onSuccess: (d) => ok(d, st === 'DRAFT' ? 'Draft cancelled' : 'Approval revoked') })} /></div>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function DraftForm({ lead, pending, error, onSubmit, onCancel }: {
  lead: Lead; pending: boolean; error: unknown; onSubmit: (d: import('@workspace/api-client-react').OfferDraftInput) => void; onCancel: () => void;
}) {
  const { base, stale, rebase } = useBaseVersion(lead.version);
  const [v, setV] = useState({ amount: '', earnest: '', days: '30', cont: '', reason: '' });
  const [assign, setAssign] = useState(false);
  const [local, setLocal] = useState<string | null>(null);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  const submit = () => {
    const amount = num(v.amount), earnest = num(v.earnest), days = num(v.days);
    if (!(amount > 0)) return setLocal('Amount must be above 0.');
    if (Number.isNaN(earnest) || earnest < 0 || earnest > amount) return setLocal('Earnest money must be 0 up to the amount.');
    if (!Number.isInteger(days) || days < 1 || days > 180) return setLocal('Closing days must be a whole number from 1 to 180.');
    if (v.cont.trim().length < 3 || v.reason.trim().length < 3) return setLocal('Contingencies and reason each need at least 3 characters.');
    setLocal(null);
    onSubmit({ version: base, amount, earnestMoney: earnest, closingDays: days, contingencies: v.cont.trim(), assignmentIntent: assign, reason: v.reason.trim() });
  };
  return (
    <div className="ledger space-y-3 p-4" data-testid="form-offer-draft">
      <p className="eyebrow">New immutable draft</p>
      <p className="text-xs text-muted-foreground">Saved terms cannot be edited. To change them, cancel the draft and write a new one.</p>
      {stale && <Stale lead={lead.version} base={base} onRebase={rebase} onDiscard={onCancel} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5"><Label>Amount (USD)</Label><Input type="number" value={v.amount} onChange={set('amount')} data-testid="input-draft-amount" /></div>
        <div className="space-y-1.5"><Label>Earnest money (USD)</Label><Input type="number" value={v.earnest} onChange={set('earnest')} data-testid="input-draft-earnest" /></div>
        <div className="space-y-1.5"><Label>Closing days (1 to 180)</Label><Input type="number" value={v.days} onChange={set('days')} data-testid="input-draft-days" /></div>
      </div>
      <div className="space-y-1.5"><Label>Contingencies</Label><Textarea rows={2} value={v.cont} onChange={set('cont')} data-testid="input-draft-contingencies" /></div>
      <label className="flex items-center gap-3 text-sm"><Switch checked={assign} onCheckedChange={setAssign} data-testid="switch-draft-assignment" />We intend to assign this contract</label>
      <div className="space-y-1.5"><Label>Reason for these terms</Label><Textarea rows={2} value={v.reason} onChange={set('reason')} data-testid="input-draft-reason" /></div>
      {local && <p className="text-sm text-destructive" data-testid="text-draft-local-error">{local}</p>}
      {error != null && <ErrorNotice error={error} />}
      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onCancel} data-testid="button-draft-cancel">Cancel</Button><Button onClick={submit} disabled={pending} data-testid="button-draft-save">{pending ? 'Saving' : 'Save draft'}</Button></div>
    </div>
  );
}

function ApproveForm({ offer, detail, evid, onGoIntel, pending, error, onSubmit, onCancel }: {
  offer: Offer; detail: LeadDetail; evid: Intelligence[]; onGoIntel: () => void; pending: boolean; error: unknown;
  onSubmit: (d: import('@workspace/api-client-react').OfferApprovalInput) => void; onCancel: () => void;
}) {
  const { lead, analysis } = detail;
  const { base, stale, rebase } = useBaseVersion(lead.version);
  const [max, setMax] = useState('');
  const [exp, setExp] = useState('');
  const [ev, setEv] = useState(evid[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const [next, setNext] = useState('');
  const [fu, setFu] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  if (!analysis) return <p className="text-sm">No current underwriting.</p>;
  const limit = new Date(analysis.calculatedAt).getTime() + 7 * 86400000;
  const submit = () => {
    const m = num(max);
    if (!(m >= offer.amount) || m > analysis.mao) return setLocal(`Ceiling must be between the draft amount (${money(offer.amount)}) and the MAO (${money(analysis.mao)}).`);
    if (!future(exp) || new Date(exp).getTime() > limit) return setLocal(`Expiry must be in the future and no later than ${fmtDate(new Date(limit).toISOString())} (7 days after the analysis).`);
    if (!ev) return setLocal('Select authority evidence.');
    if (reason.trim().length < 3 || next.trim().length < 3) return setLocal('Reason and next action each need at least 3 characters.');
    if (!future(fu)) return setLocal('Follow-up must be in the future.');
    setLocal(null);
    onSubmit({ version: base, maximumApprovedAcquisitionPrice: m, expiresAt: iso(exp), authorityEvidenceId: ev, reason: reason.trim(), nextAction: next.trim(), followUpAt: iso(fu) });
  };
  return (
    <div className="space-y-3" data-testid="form-offer-approve">
      <p className="eyebrow">Owner authorization</p>
      <p className="text-xs text-muted-foreground">This authorizes the ceiling for a human to offer. It is not title clearance, a contract, or a sent message.</p>
      {stale && <Stale lead={lead.version} base={base} onRebase={rebase} onDiscard={onCancel} />}
      {evid.length === 0 ? (
        <div className="border border-destructive/50 bg-destructive/5 p-3 text-sm" data-testid="notice-no-authority">
          No qualifying authority evidence. Authorization needs a verified fact from a public record, categorised ownership, seller_authority or owner_authority, with a verification note.
          <div className="mt-2"><Button size="sm" variant="outline" onClick={onGoIntel} data-testid="button-go-intelligence">Open Intelligence tab to add evidence</Button></div>
        </div>
      ) : (
        <div className="space-y-1.5"><Label>Authority evidence</Label>
          <Select value={ev} onValueChange={setEv}><SelectTrigger data-testid="select-authority-evidence"><SelectValue /></SelectTrigger>
            <SelectContent>{evid.map((e) => <SelectItem key={e.id} value={e.id}>{e.category}: {e.statement.slice(0, 70)}</SelectItem>)}</SelectContent></Select></div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><Label>Maximum approved price (USD)</Label><Input type="number" value={max} onChange={(e) => setMax(e.target.value)} data-testid="input-approve-max" /><p className="text-[11px] text-muted-foreground">Between {money(offer.amount)} and MAO {money(analysis.mao)}.</p></div>
        <div className="space-y-1.5"><Label>Expires</Label><Input type="datetime-local" value={exp} onChange={(e) => setExp(e.target.value)} data-testid="input-approve-expires" /><p className="text-[11px] text-muted-foreground">Within 7 days of the analysis ({fmtDate(new Date(limit).toISOString())}).</p></div>
      </div>
      <div className="space-y-1.5"><Label>Reason</Label><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-approve-reason" /></div>
      <div className="space-y-1.5"><Label>Next action</Label><Input value={next} onChange={(e) => setNext(e.target.value)} data-testid="input-approve-next" /></div>
      <div className="space-y-1.5"><Label>Follow up (future)</Label><Input type="datetime-local" value={fu} onChange={(e) => setFu(e.target.value)} data-testid="input-approve-followup" /></div>
      {local && <p className="text-sm text-destructive" data-testid="text-approve-local-error">{local}</p>}
      {error != null && <ErrorNotice error={error} />}
      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onCancel} data-testid="button-approve-cancel">Cancel</Button><Button onClick={submit} disabled={pending || evid.length === 0} data-testid="button-approve-confirm">{pending ? 'Authorizing' : 'Authorize offer'}</Button></div>
    </div>
  );
}

function WithdrawForm({ offer, lead, pending, error, onSubmit, onCancel, onDiscard }: {
  offer: Offer; lead: Lead; pending: boolean; error: unknown;
  onSubmit: (d: import('@workspace/api-client-react').OfferWithdrawalInput) => void; onCancel: () => void; onDiscard: () => void;
}) {
  const { base, stale, rebase } = useBaseVersion(lead.version);
  const [reason, setReason] = useState('');
  const [next, setNext] = useState('');
  const [fu, setFu] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const draft = offer.effectiveStatus === 'DRAFT';
  const submit = () => {
    if (reason.trim().length < 3 || next.trim().length < 3) return setLocal('Reason and next action each need at least 3 characters.');
    if (!future(fu)) return setLocal('Follow-up must be in the future.');
    setLocal(null);
    onSubmit({ version: base, reason: reason.trim(), nextAction: next.trim(), followUpAt: iso(fu) });
  };
  return (
    <div className="space-y-3" data-testid="form-offer-withdraw">
      <p className="eyebrow">{draft ? 'Cancel draft' : 'Revoke internal approval'}</p>
      {!draft && <p className="text-xs font-semibold">Revoking internal approval does not recall an offer already communicated to the seller. If it was communicated, contact the seller yourself.</p>}
      {stale && <Stale lead={lead.version} base={base} onRebase={rebase} onDiscard={onDiscard} />}
      <div className="space-y-1.5"><Label>Reason</Label><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-withdraw-reason" /></div>
      <div className="space-y-1.5"><Label>Next action</Label><Input value={next} onChange={(e) => setNext(e.target.value)} data-testid="input-withdraw-next" /></div>
      <div className="space-y-1.5"><Label>Follow up (future)</Label><Input type="datetime-local" value={fu} onChange={(e) => setFu(e.target.value)} data-testid="input-withdraw-followup" /></div>
      {local && <p className="text-sm text-destructive" data-testid="text-withdraw-local-error">{local}</p>}
      {error != null && <ErrorNotice error={error} />}
      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onCancel} data-testid="button-withdraw-cancel">Back</Button><Button variant="destructive" onClick={submit} disabled={pending} data-testid="button-withdraw-confirm">{pending ? 'Saving' : draft ? 'Cancel draft' : 'Revoke approval'}</Button></div>
    </div>
  );
}
