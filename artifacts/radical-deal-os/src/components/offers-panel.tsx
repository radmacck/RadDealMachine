import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetLeadQueryKey, useAuthorizeOffer, useCommunicateOffer, useCreateOfferDraft, useWithdrawOffer, useGetOfferReview,
  useGetSellerContactPaths, type Intelligence, type LeadDetail, type Lead, type Offer, type OfferCommunicationInput, type OfferCommunicationInputChannel,
} from '@workspace/api-client-react';
import { buildOfferReadinessScorecard, type OfferReadinessInput } from '@workspace/deal-domain';
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
import { SellerOfferLinkPanel } from '@/components/seller-offer-link-panel';
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
  const contactQuery=useGetSellerContactPaths(lead.id);
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
  const assess=(state:'READY'|'REVIEW'|'BLOCKED',evidence:string[],missingEvidence:string[],remedy:string)=>({state,evidence,missingEvidence,remedy});
  const propertyFact=intelligence.find(i=>i.classification==='VERIFIED_FACTS'&&i.sourceType==='PUBLIC_RECORD'&&!!i.sourceUrl&&!!i.sourceRecordId&&!!i.verificationNote&&Date.now()-Date.parse(i.capturedAt)>=0&&Date.now()-Date.parse(i.capturedAt)<=30*86_400_000);
  const ownerEvidence=evid[0];
  const route=contactQuery.data?.selectedPhonePath;
  const includedComps=analysis?.compDecisions.filter(c=>c.included).length??0;
  const requiredComps=analysis?.assumptions.minComps??3;
  const hasCosts=!!analysis&&[analysis.assumptions.sellingCostPct,analysis.assumptions.acquisitionCost,analysis.assumptions.holdingMonthly,analysis.assumptions.holdingMonths,analysis.assumptions.assignmentTarget,analysis.assumptions.contingencyPct].every(v=>Number.isFinite(v)&&v>=0);
  const approvalCurrent=offers.some(o=>o.effectiveStatus==='AUTHORIZED'&&!o.blockers.length&&o.analysisSnapshotId===detail.analysisSnapshotId);
  const assessments:OfferReadinessInput={
    hardStopKeys:['PROPERTY_IDENTITY','SELLER_AUTHORITY','CONTACTABILITY','COMPS_ARV','REPAIR_ASSUMPTIONS','DETERMINISTIC_MAO','LEGAL_STRATEGY','CURRENT_APPROVAL'],
    PROPERTY_IDENTITY:propertyFact&&lead.address&&lead.city&&lead.state&&lead.zip?assess('READY',[`${propertyFact.source} · ${propertyFact.sourceRecordId}`],[],`Keep the verified property record attached to this lead.`):assess('BLOCKED',[],['Complete property address and a verified source-linked public-record property fact.'],'Link and review a current public-record fact that identifies this parcel and property.'),
    SELLER_AUTHORITY:ownerEvidence?assess('READY',[`${ownerEvidence.source} · ${ownerEvidence.sourceRecordId}`],[],`Recheck public-record authority evidence before approval.`):assess('BLOCKED',[],['Current verified public-record seller/owner authority evidence with verification note (30-day limit).'],'Review a current public record for seller authority; do not infer signing authority from a contact route.'),
    CONTACTABILITY:route&&contactQuery.data?.directRouteStatus==='PHONE_ROUTE_AVAILABLE'&&route.freshnessStatus==='CURRENT'&&route.permissionStatus==='PERMITTED'&&route.routeVerificationStatus==='CONFIRMED'?assess('READY',[`${route.sourceName} · ${route.sourceRecordId} · observed ${fmtDate(route.capturedAt)}`],[],`Reconfirm permission and recipient identity before contact.`):assess('BLOCKED',[],[contactQuery.isLoading?'Contact evidence is loading.':`Current permitted, confirmed phone route is unavailable (${contactQuery.data?.directRouteStatus??'not checked'}).`],'Record or refresh a permitted phone route, then review recipient identity and permission.'),
    COMPS_ARV:analysis&&fresh&&includedComps>=requiredComps&&analysis.arv.confidence>=analysis.assumptions.minConfidence&&!analysis.blockers.some(b=>/comp|arv/i.test(b))?assess('READY',[`${includedComps} included comps; ARV confidence ${Math.round(analysis.arv.confidence*100)}%; calculated ${fmtDate(analysis.calculatedAt)}`],[],`Recheck comp freshness and source links before any approval.`):assess('BLOCKED',[],[`Current, non-stale comps/ARV evidence: ${includedComps}/${requiredComps} included comps; ${analysis?.blockers.filter(b=>/comp|arv/i.test(b)).join('; ')||'confidence or freshness requirement not met'}.`],'Replace or verify comps, resolve listed comp/ARV blockers, then recalculate underwriting.'),
    REPAIR_ASSUMPTIONS:analysis&&analysis.repairEstimate.blockers.length===0&&!!analysis.repairEstimate.total&&analysis.repairs.confidence>=analysis.assumptions.minConfidence?assess('READY',[`Repair range ${money(analysis.repairEstimate.total.low)}–${money(analysis.repairEstimate.total.high)}; confidence ${Math.round(analysis.repairs.confidence*100)}%.`],[],`Reconcile new condition evidence before approval.`):assess('BLOCKED',[],analysis?.repairEstimate.blockers.length?analysis.repairEstimate.blockers:['Complete current, source-linked repair assumptions and confidence requirements.'],'Review condition evidence and repair lines; clear estimate blockers and recalculate.'),
    TRANSACTION_COSTS:hasCosts?assess('READY',['Selling, acquisition, holding, contingency and assignment cost assumptions are present.'],[],`Review cost assumptions against current deal strategy.`):assess('BLOCKED',[],['One or more cost assumptions are missing or invalid.'],'Complete and review the current transaction-cost assumptions.'),
    DETERMINISTIC_MAO:analysis&&detail.analysisSnapshotId&&fresh&&analysis.blockers.length===0&&analysis.mao>0?assess('READY',[`Deterministic MAO ${money(analysis.mao)} · snapshot ${detail.analysisSnapshotId.slice(0,8)}.`],[],`Recalculate after any material evidence, cost, policy, or property change.`):assess('BLOCKED',[],analysis?.blockers.length?analysis.blockers:['Current immutable underwriting snapshot and positive deterministic MAO are required.'],'Resolve underwriting blockers and refresh the current analysis snapshot; the score does not authorize a price.'),
    LEGAL_STRATEGY:assess('REVIEW',[],['Deal-specific assignment/transaction strategy has no qualified legal review recorded.'],'Obtain qualified jurisdiction-specific review of strategy, assignment constraints, contract terms, and disclosures before communicating terms.'),
    CURRENT_APPROVAL:approvalCurrent?assess('READY',['Current exact-version owner approval is active.'],[],`Recheck the approved snapshot and expiry immediately before communication.`):assess('BLOCKED',[],['No active owner approval of the exact current offer version.'],'Owner must review and approve the exact draft version; approval is separate from this scorecard.'),
  };
  const scorecard=buildOfferReadinessScorecard(assessments);

  return (
    <div className="space-y-4" data-testid="panel-offers">
      <div className="ledger border-l-4 border-l-signal p-3 text-sm">
        <p><b>How this works.</b> An analyst drafts terms. Terms never change after saving. Only the owner authorizes a ceiling, backed by verified authority evidence. A person then makes the offer and records it here. Approval is not title clearance, not a contract, and not a message sent.</p>
        <p className="mt-1 text-xs text-muted-foreground">Research analysis ceiling stays "Not authorized". Authorization lives on the offer below, separate from the research snapshot.</p>
      </div>
      <section className="ledger space-y-3 p-4" data-testid="panel-offer-readiness-scorecard">
        <div className="flex items-center justify-between gap-3"><div><p className="eyebrow">Offer readiness · evidence scorecard</p><p className="text-xs text-muted-foreground">Deterministic checklist only; never an offer, approval, or substitute for hard gates.</p></div>
          <b className="font-mono text-xl" data-testid="text-offer-readiness-score">{scorecard.score}/100</b></div>
        <p className="text-sm font-medium" data-testid="text-offer-readiness-status">{scorecard.status.replaceAll('_',' ')}</p>
        <ul className="grid gap-2 md:grid-cols-2">{scorecard.criteria.map(item=><li key={item.key} className="rounded border p-2 text-xs" data-testid={`criterion-${item.key}`}>
          <div className="flex justify-between gap-2"><b>{item.key.replaceAll('_',' ')}</b><span>{item.state} · {item.points}/{item.weight}</span></div>
          {item.evidence.map((line,i)=><p key={`e${i}`}>Evidence: {line}</p>)}
          {item.missingEvidence.map((line,i)=><p className="text-destructive" key={`m${i}`}>Missing/stale: {line}</p>)}
          {item.state!=='READY'&&<p><b>Remedy:</b> {item.remedy}</p>}
          {item.hardStop&&<p className="font-semibold text-destructive">Hard stop; no offer action is authorized.</p>}
        </li>)}</ul>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xl font-semibold">Offers ({offers.length})</h3>
        <Button onClick={() => open({ kind: 'draft' })} disabled={!canDraftNow} data-testid="button-new-offer-draft">New offer draft</Button>
      </div>
      {draftWhy && <p className="text-xs text-muted-foreground" data-testid="text-draft-blocked">{draftWhy}</p>}

       {mode?.kind === 'draft' && <DraftForm key={`d${epoch}`} detail={detail} lead={lead} pending={create.isPending} error={create.error} onCancel={() => setMode(null)}
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
              {(st === 'AUTHORIZED' || !!o.communicatedAt) && <SellerOfferLinkPanel
                lead={lead} offer={o} isOwner={isOwner} identityEvidence={authorityEvidence(detail.intelligence)}
              />}

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

function DraftForm({ detail, lead, pending, error, onSubmit, onCancel }: {
  detail: LeadDetail; lead: Lead; pending: boolean; error: unknown; onSubmit: (d: import('@workspace/api-client-react').OfferDraftInput) => void; onCancel: () => void;
}) {
  const analysis = detail.analysis!;
  const { base, stale, rebase } = useBaseVersion(lead.version);
  const [v, setV] = useState({ amount: String(analysis.openingLow), earnest: '', days: '30', cont: 'Subject to inspection, title review, and owner-approved contract terms.', reason: 'Prepared from current underwriting; seller terms require explicit owner review.' });
  const [assign, setAssign] = useState(false);
  const [expiry, setExpiry] = useState(() => { const d = new Date(Date.now()+48*3600000); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,16); });
  const [local, setLocal] = useState<string | null>(null);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  const submit = () => {
    const amount = num(v.amount), earnest = num(v.earnest), days = num(v.days);
    if (!(amount > 0)) return setLocal('Amount must be above 0.');
    if (Number.isNaN(earnest) || earnest < 0 || earnest > amount) return setLocal('Earnest money must be 0 up to the amount.');
    if (!Number.isInteger(days) || days < 1 || days > 180) return setLocal('Closing days must be a whole number from 1 to 180.');
    if (v.cont.trim().length < 3 || v.reason.trim().length < 3) return setLocal('Contingencies and reason each need at least 3 characters.');
    if (!future(expiry)) return setLocal('Draft expiry must be in the future.');
    setLocal(null);
    onSubmit({ version: base, amount, earnestMoney: earnest, closingDays: days, contingencies: v.cont.trim(), assignmentIntent: assign, reason: v.reason.trim(), draftExpiresAt: iso(expiry) });
  };
  return (
    <div className="ledger space-y-3 p-4" data-testid="form-offer-draft">
      <p className="eyebrow">New immutable draft</p>
      <p className="text-xs font-semibold">Internal proposal draft only — not an offer, not approved, and not sent. Saved versions cannot be edited.</p>
      <div className="rounded border p-3 text-sm" data-testid="offer-preparation-summary">
        <p className="font-semibold">Deterministic preparation basis</p>
        <p>Suggested opening {money(analysis.openingLow)}–{money(analysis.openingHigh)}; MAO {money(analysis.mao)}. ARV low/expected/high: {money(analysis.arv.low)} / {money(analysis.arv.expected)} / {money(analysis.arv.high)}.</p>
        <p>Costs: selling {money(analysis.arv.low*analysis.assumptions.sellingCostPct)}, repairs {money(analysis.repairs.expected)}, acquisition {money(analysis.assumptions.acquisitionCost)}, holding {money(analysis.assumptions.holdingMonthly*analysis.assumptions.holdingMonths)}, contingency {money(analysis.repairs.high*analysis.assumptions.contingencyPct)}, assignment target {money(assign?analysis.assumptions.assignmentTarget:0)}.</p>
        <p>Assignment strategy is only contemplated subject to local law and contract permission; legality is not assessed.</p>
        <p>Assumptions: {analysis.assumptions.arvMultiplier} ARV multiplier; {analysis.assumptions.sellingCostPct*100}% selling costs; {analysis.assumptions.holdingMonths} holding months. Risks: {analysis.risks.join('; ')||'none recorded'}.</p>
        <p>Verified supporting evidence: {detail.intelligence.filter(i=>i.classification==='VERIFIED_FACTS').map(i=>`${i.category} (${i.id.slice(0,8)}): ${i.statement}`).join(' · ')||'Verified comps are referenced by the underwriting snapshot.'}</p>
      </div>
      {stale && <Stale lead={lead.version} base={base} onRebase={rebase} onDiscard={onCancel} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5"><Label>Amount (USD)</Label><Input type="number" value={v.amount} onChange={set('amount')} data-testid="input-draft-amount" /></div>
        <div className="space-y-1.5"><Label>Earnest money (USD)</Label><Input type="number" value={v.earnest} onChange={set('earnest')} data-testid="input-draft-earnest" /></div>
        <div className="space-y-1.5"><Label>Closing days (1 to 180)</Label><Input type="number" value={v.days} onChange={set('days')} data-testid="input-draft-days" /></div>
      </div>
      <div className="space-y-1.5"><Label>Internal draft expiry</Label><Input type="datetime-local" value={expiry} onChange={e=>setExpiry(e.target.value)} data-testid="input-draft-expiry" /></div>
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
  const review = useGetOfferReview(lead.id, offer.id);
  const { base, stale, rebase } = useBaseVersion(lead.version);
  const [max, setMax] = useState('');
  const [exp, setExp] = useState('');
  const [ev, setEv] = useState(evid[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const [next, setNext] = useState('');
  const [fu, setFu] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  if (!analysis) return <p className="text-sm">No current underwriting.</p>;
  const limit = new Date(analysis.calculatedAt).getTime() + 7 * 86400000;
  const submit = () => {
    const m = num(max);
    if (!(m >= offer.amount) || m > analysis.mao) return setLocal(`Ceiling must be between the draft amount (${money(offer.amount)}) and the MAO (${money(analysis.mao)}).`);
    if (!future(exp) || new Date(exp).getTime() > limit) return setLocal(`Expiry must be in the future and no later than ${fmtDate(new Date(limit).toISOString())} (7 days after the analysis).`);
    if (!ev) return setLocal('Select authority evidence.');
    if (reason.trim().length < 3 || next.trim().length < 3) return setLocal('Reason and next action each need at least 3 characters.');
    if (!future(fu)) return setLocal('Follow-up must be in the future.');
    if (!review.data || !confirmed) return setLocal('Review and confirm the exact prepared version before authorizing.');
    setLocal(null);
    onSubmit({ version: base, reviewSnapshotHash: review.data.reviewSnapshotHash, maximumApprovedAcquisitionPrice: m, expiresAt: iso(exp), authorityEvidenceId: ev, reason: reason.trim(), nextAction: next.trim(), followUpAt: iso(fu) });
  };
  return (
    <div className="space-y-3" data-testid="form-offer-approve">
      <p className="eyebrow">Owner authorization</p>
      <p className="text-xs text-muted-foreground">This authorizes the ceiling for a human to offer. It is not title clearance, a contract, or a sent message.</p>
      {review.data && <details open className="max-h-64 overflow-auto rounded border p-3 text-xs" data-testid="offer-review-packet"><summary>Exact version packet · expires {fmtDate(review.data.draftExpiresAt)} · {review.data.reviewSnapshotHash.slice(0,12)}</summary><pre className="whitespace-pre-wrap">{JSON.stringify(JSON.parse(review.data.reviewSnapshotJson),null,2)}</pre></details>}
      {review.error && <ErrorNotice error={review.error} />}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} data-testid="checkbox-confirm-offer-version" />I reviewed and approve this exact proposal version and its evidence.</label>
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
       <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onCancel} data-testid="button-approve-cancel">Cancel</Button><Button onClick={submit} disabled={pending || evid.length === 0 || !review.data || !confirmed} data-testid="button-approve-confirm">{pending ? 'Authorizing' : 'Authorize exact version'}</Button></div>
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
