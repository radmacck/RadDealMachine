import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetDealDistributionQueryKey, useAuthorizeDealDistribution, useGetDealDistribution,
  useRecordBuyerResponse, useReleaseDistributionAcceptance, useShareDistributionRecipients,
  type BuyerMatch, type DealContract, type LeadDetail,
} from '@workspace/api-client-react';
import { ErrorNotice } from '@/components/state-views';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAccess } from '@/hooks/use-access';
import { useToast } from '@/hooks/use-toast';
import { fmtDate, money } from '@/lib/format';

export function DistributionPanel({ detail, contract, matches, onChanged }: {
  detail: LeadDetail; contract: DealContract | null; matches: BuyerMatch[]; onChanged: () => void;
}) {
  const leadId = detail.lead.id;
  const queryClient = useQueryClient();
  const { isOwner, canCall } = useAccess();
  const { toast } = useToast();
  const q = useGetDealDistribution(leadId, {
    query: { queryKey: getGetDealDistributionQueryKey(leadId), enabled: !!contract, refetchInterval: 10_000 },
  });
  const authorize = useAuthorizeDealDistribution();
  const share = useShareDistributionRecipients();
  const release = useReleaseDistributionAcceptance();
  const recordBuyer = useRecordBuyerResponse();
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [releasedReason, setReleasedReason] = useState('');
  const [links, setLinks] = useState<{ buyerId: string; buyerName: string; token: string }[]>([]);
  const canShare = isOwner || canCall;
  const qualified = useMemo(() => matches.filter((match) =>
    match.eligible && (match.destinationKind ?? 'BUYER') === 'BUYER'), [matches]);
  const distribution = q.data;

  if (!contract || contract.status === 'DRAFT') {
    return <section className="ledger p-4" data-testid="panel-distribution"><p className="eyebrow mb-2">Buyer distribution</p>
      <p className="text-sm text-muted-foreground">Distribution opens only for an executed, active, assignable acquisition contract with no committed buyer.</p></section>;
  }
  if (q.isLoading) return <section className="ledger p-4"><p className="eyebrow mb-2">Buyer distribution</p><p className="text-sm">Loading authorized packet…</p></section>;
  if (q.isError || !distribution) return <section className="ledger p-4"><p className="eyebrow mb-2">Buyer distribution</p><ErrorNotice error={q.error} onRetry={() => q.refetch()} /></section>;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getGetDealDistributionQueryKey(leadId) });
    onChanged();
  };
  const lifecycleOpen = contract.status === 'UNDER_CONTRACT' || contract.status === 'CLOSING';
  const shareSelected = () => {
    if (!distribution.packetId || !selected.length) return;
    share.mutate({ id: distribution.packetId, data: { version: distribution.version, buyerIds: selected } }, {
      onSuccess: (result) => {
        setLinks(result.links);
        setSelected([]);
        refresh();
        toast({ title: 'Private buyer links created', description: 'No email or message was sent. Share each link through your approved channel.' });
      },
    });
  };
  const linkFor = (token: string) => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    return `${window.location.origin}${base}/buyer-packet#token=${encodeURIComponent(token)}`;
  };

  return <section className="ledger space-y-4 p-4" data-testid="panel-distribution">
    <div>
      <p className="eyebrow mb-1">Buyer distribution</p>
      <p className="text-sm text-muted-foreground">The owner authorizes one frozen buyer price from the executed contract. Operators can then create private links for currently qualified acquisition buyers. Referral contacts are excluded.</p>
    </div>
    {!distribution.packetId ? (
      <div className="space-y-3">
        <div className="border-l-2 border-signal pl-3 text-sm">
          <p>Proposed locked economics: acquisition {money(contract.purchasePrice)} + assignment target {money(contract.assignmentTarget)} = buyer price {money(contract.purchasePrice + contract.assignmentTarget)}.</p>
          <p className="mt-1 text-xs text-muted-foreground">The fee is not editable here; authorization is bound to the communicated offer and its underwriting snapshot.</p>
        </div>
        <label className="block text-sm">Owner authorization note
          <Textarea className="mt-1" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this executed deal is approved for buyer distribution" disabled={!isOwner} />
        </label>
        {authorize.error && <ErrorNotice error={authorize.error} />}
        {isOwner ? <Button disabled={reason.trim().length < 3 || authorize.isPending} onClick={() => authorize.mutate({
          id: leadId, data: { version: contract.version, reason: reason.trim() },
        }, { onSuccess: () => { refresh(); toast({ title: 'Distribution economics authorized' }); } })}>
          {authorize.isPending ? 'Authorizing…' : 'Authorize locked buyer economics'}
        </Button> : <p className="text-xs text-muted-foreground">Only the owner can authorize the buyer packet.</p>}
      </div>
    ) : (
      <>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><p className="eyebrow">Buyer price</p><p className="font-mono text-lg">{money(distribution.packet?.economics.buyerPrice)}</p></div>
          <div><p className="eyebrow">Authorized at</p><p className="text-sm">{fmtDate(distribution.authorizedAt)}</p></div>
          <div><p className="eyebrow">Link expiry</p><p className="text-sm">{fmtDate(distribution.expiresAt)}</p></div>
        </div>
        <div className="space-y-1 border-l-2 border-signal pl-3 text-sm">
          <p><b>Packet is frozen.</b> Street address and seller contact details are excluded. Every recipient sees the same terms.</p>
          <p className="text-xs text-muted-foreground">{distribution.packet?.mediaNotice}</p>
          <p className="text-xs text-muted-foreground">Authorized by {distribution.authorizedBy}; no notification has been sent.</p>
        </div>
        {distribution.status === 'FIRST_ACCEPTED' && (
          <div className="border border-warn p-3" data-testid="panel-first-acceptance">
            <p className="font-semibold">{contract.committedBuyerId
              ? contract.committedBuyerId === distribution.acceptedBuyerId ? 'Accepted buyer is now committed' : 'A different buyer is now committed'
              : 'First qualified acceptance recorded'}</p>
            <p className="mt-1 text-sm">{distribution.recipients.find((r) => r.buyerId === distribution.acceptedBuyerId)?.buyerName ?? 'Buyer'} · {fmtDate(distribution.acceptedAt)}</p>
            <p className="mt-1 text-sm text-muted-foreground">{contract.committedBuyerId
              ? 'The separate owner-reviewed transaction workflow records commitment and closing evidence.'
              : 'This is a soft hold for owner review, not a buyer commitment or executed assignment.'}</p>
            {isOwner && lifecycleOpen && !contract.committedBuyerId && <div className="mt-3 space-y-2">
              <Input value={releasedReason} onChange={(e) => setReleasedReason(e.target.value)} placeholder="Reason to release this soft hold" />
              {release.error && <ErrorNotice error={release.error} />}
              <Button size="sm" variant="outline" disabled={releasedReason.trim().length < 3 || release.isPending} onClick={() => release.mutate({
                id: leadId, data: { version: distribution.version, reason: releasedReason.trim() },
              }, { onSuccess: () => { setReleasedReason(''); refresh(); toast({ title: 'Soft acceptance released' }); } })}>
                Release acceptance hold
              </Button>
            </div>}
          </div>
        )}
        {canShare && lifecycleOpen && !contract.committedBuyerId && new Date(contract.closingAt).getTime() > Date.now() && distribution.status === 'ACTIVE' && (
          <div className="space-y-3">
            <p className="eyebrow">Share with qualified buyers</p>
            {qualified.length === 0 ? <p className="text-sm text-muted-foreground">No currently qualified acquisition buyers are available. Refresh matching after buyer evidence or criteria changes.</p> :
              <div className="grid gap-2 sm:grid-cols-2">{qualified.map((match) => {
                const recipient = distribution.recipients.find((r) => r.buyerId === match.buyerId);
                return <label key={match.buyerId} className="flex items-start gap-2 border border-border p-2 text-sm">
                  <input type="checkbox" className="mt-1 accent-signal" checked={selected.includes(match.buyerId)}
                    onChange={(e) => setSelected((old) => e.target.checked ? [...old, match.buyerId] : old.filter((id) => id !== match.buyerId))} />
                  <span><b>{match.buyerName}</b><span className="block text-xs text-muted-foreground">{recipient ? `Existing link: ${recipient.status.toLowerCase()} (select to rotate if still invited)` : 'Qualified acquisition buyer'}</span></span>
                </label>;
              })}</div>}
            {share.error && <ErrorNotice error={share.error} />}
            <Button size="sm" disabled={!selected.length || share.isPending} onClick={shareSelected}>
              {share.isPending ? 'Creating…' : `Create private link${selected.length === 1 ? '' : 's'}${selected.length ? ` (${selected.length})` : ''}`}
            </Button>
          </div>
        )}
        {links.length > 0 && <div className="space-y-2 border-t border-border pt-3" data-testid="list-distribution-links">
          <p className="text-sm font-semibold">Copy these private links now</p>
          <p className="text-xs text-muted-foreground">They are returned once and cannot be recovered later. Creating a replacement invalidates the prior link. The system has not sent them.</p>
          {links.map((link) => <div key={link.buyerId} className="flex flex-col gap-2 border border-border p-2 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{link.buyerName}</p><p className="break-all font-mono text-[11px] text-muted-foreground">{linkFor(link.token)}</p></div>
            <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(linkFor(link.token))}>Copy link</Button>
          </div>)}
        </div>}
        {distribution.recipients.length > 0 && <div className="space-y-2 border-t border-border pt-3">
          <p className="eyebrow">Buyer responses</p>
          {distribution.recipients.map((recipient) => <div key={recipient.buyerId} className="border border-border p-2 text-sm">
            <div className="flex flex-wrap justify-between gap-2"><b>{recipient.buyerName}</b><span className="tag tone-muted">{recipient.status}</span></div>
            {recipient.events.map((event) => <div key={event.eventKey} className="mt-1 text-xs text-muted-foreground">
              <p>{event.action} / {fmtDate(event.recordedAt)}{event.note ? ` / ${event.note}` : ''}</p>
              {['INTERESTED', 'ACCEPTED'].includes(event.action) && (() => {
                const match = matches.find((m) => m.buyerId === recipient.buyerId);
                if (!match || match.status === 'INTERESTED' || match.status === 'COMMITTED' || !match.eligible || !(isOwner || canCall) || !lifecycleOpen || contract.committedBuyerId) {
                  return match?.status === 'INTERESTED' || match?.status === 'COMMITTED'
                    ? <p className="mt-1 font-semibold">Native buyer status: {match.status.toLowerCase()}</p> : null;
                }
                return <Button size="sm" variant="outline" className="mt-1" disabled={recordBuyer.isPending} onClick={() => recordBuyer.mutate({
                  id: leadId,
                  buyerId: recipient.buyerId,
                  data: {
                    version: contract.version,
                    buyerVersion: match.buyerVersion,
                    status: 'INTERESTED',
                    evidence: `Private portal ${event.action.toLowerCase()} recorded at ${event.recordedAt}; response event ${event.eventKey}. Human review required; this does not create commitment.`,
                  },
                }, { onSuccess: () => { refresh(); toast({ title: 'Buyer interest added to the deal workflow' }); } })}>
                  Review &amp; record as buyer interest
                </Button>;
              })()}
            </div>)}
          </div>)}
        </div>}
        {contract.committedBuyerId && <p className="border-t border-border pt-3 text-xs text-muted-foreground">An acquisition buyer is now committed through the existing owner-reviewed transaction workflow. Distribution links no longer accept responses.</p>}
      </>
    )}
  </section>;
}
