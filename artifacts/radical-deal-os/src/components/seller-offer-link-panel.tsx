import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Link2, RotateCw } from 'lucide-react';
import {
  getGetLeadQueryKey, getGetSellerOfferPortalControlQueryKey, useGetSellerOfferPortalControl,
  useIssueSellerOfferPortal, type Lead, type Offer,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/state-views';
import { fmtDate, money } from '@/lib/format';

export function SellerOfferLinkPanel({ lead, offer, isOwner }: { lead: Lead; offer: Offer; isOwner: boolean }) {
  const queryClient = useQueryClient();
  const controlKey = getGetSellerOfferPortalControlQueryKey(lead.id, offer.id);
  const control = useGetSellerOfferPortalControl(lead.id, offer.id, {
    query: { queryKey: controlKey, enabled: !!offer.communicatedAt },
  });
  const issue = useIssueSellerOfferPortal();
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const eligible = offer.effectiveStatus === 'COMMUNICATED';
  const current = control.data?.current;
  const canIssue = eligible && current?.status !== 'RESPONDED'
    && !(current?.status === 'ACTIVE' && !current.canRespond);

  const issueLink = () => {
    if (!isOwner || !canIssue) return;
    issue.mutate({ id: lead.id, offerId: offer.id, data: { version: lead.version } }, {
      onSuccess: (result) => {
        const destination = new URL(`${import.meta.env.BASE_URL}seller-offer`, window.location.origin);
        destination.hash = `token=${encodeURIComponent(result.token)}`;
        setIssuedUrl(destination.toString());
        setCopied(false);
        setCopyError(false);
        setConfirmRotate(false);
        void queryClient.invalidateQueries({ queryKey: controlKey });
        void queryClient.invalidateQueries({ queryKey: getGetLeadQueryKey(lead.id) });
      },
    });
  };

  const copyLink = async () => {
    if (!issuedUrl) return;
    try {
      await navigator.clipboard.writeText(issuedUrl);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  };

  return (
    <section className="mt-3 border-t border-border pt-3" data-testid={`seller-offer-link-${offer.id}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center border border-border bg-muted"><Link2 className="h-4 w-4" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Seller response link</p>
          <p className="mt-1 text-xs text-muted-foreground">Private, one-time link for recording a seller’s stated intent. No message is sent.</p>
          {!isOwner && <p className="mt-2 text-xs text-muted-foreground">Only the owner can issue or rotate this link.</p>}
          {!offer.communicatedAt && <p className="mt-2 text-xs text-muted-foreground">Record that the exact authorized terms were communicated before issuing a seller link.</p>}
          {offer.communicatedAt && <>
            {control.isLoading && <div className="mt-3 h-10 animate-pulse border border-border bg-muted/70" role="status" aria-label="Loading link status" />}
            {control.isError && <div className="mt-3"><ErrorNotice error={control.error} /><Button className="mt-2" size="sm" variant="outline" onClick={() => void control.refetch()}>Retry status</Button></div>}
            {current && !control.isError && <div className="mt-2 space-y-2" data-testid={`seller-link-status-${offer.id}`}>
              <p className="text-xs">
              <span className={`tag ${current.status === 'ACTIVE' ? 'tone-go' : current.status === 'RESPONDED' ? 'tone-ink' : 'tone-muted'}`}>{current.status}</span>
              <span className="ml-2 text-muted-foreground">Prepared {fmtDate(current.snapshot.preparedAt)} · expires {fmtDate(current.expiresAt)}</span>
              </p>
              {current.unavailableReason && <p className="text-xs text-muted-foreground">{current.unavailableReason}</p>}
              {current.events.length > 0 && <ol className="space-y-2 border-l-2 border-signal pl-3" data-testid={`seller-link-events-${offer.id}`}>
                {current.events.map((event) => <li key={event.eventKey} className="text-xs" data-testid={`seller-link-event-${event.eventKey}`}>
                  <p className="font-semibold">{event.action} · {fmtDate(event.occurredAt)}</p>
                  <p className="text-muted-foreground">Self-reported by {event.respondentName}</p>
                  {event.note && <p className="mt-1 whitespace-pre-wrap">{event.note}</p>}
                  {event.counterTerms && <p className="mt-1 text-muted-foreground">
                    Proposed {money(event.counterTerms.amount)} · {event.counterTerms.closingDays} day close · owner review required; authorized offer unchanged.
                  </p>}
                </li>)}
              </ol>}
            </div>}
            {current?.status === 'RESPONDED' && <p className="mt-3 text-xs font-semibold" role="status">A seller response is recorded. Create and authorize new exact terms before issuing another link.</p>}
            {isOwner && !eligible && current?.status !== 'RESPONDED' && <p className="mt-3 text-xs text-muted-foreground">A new link is available only while this exact offer is current, unexpired, and recorded as communicated.</p>}
            {isOwner && canIssue && issuedUrl ? (
              <div className="mt-3 space-y-2" data-testid={`seller-link-issued-${offer.id}`}>
                <p className="text-xs font-semibold">Private link issued. Copy it now; it will not be shown again after you leave this view.</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input aria-label="New seller private link" readOnly value={issuedUrl} className="min-w-0 flex-1 border border-input bg-card px-3 py-2 font-mono text-xs text-foreground" onFocus={(event) => event.currentTarget.select()} data-testid={`input-seller-link-${offer.id}`} />
                  <Button type="button" size="sm" onClick={() => void copyLink()} data-testid={`button-copy-seller-link-${offer.id}`}><Copy className="mr-2 h-4 w-4" />{copied ? 'Copied' : 'Copy link'}</Button>
                </div>
                <p className="text-[11px] text-muted-foreground">Issuing this link revokes any earlier seller link. Copying does not send it.</p>
                {copyError && <p className="text-xs text-destructive" role="alert">Clipboard access was unavailable. Select and copy the link above.</p>}
              </div>
            ) : isOwner && canIssue ? (
              <div className="mt-3">
                {confirmRotate ? (
                  <div className="border border-signal/60 bg-signal/5 p-3">
                    <p className="text-sm font-semibold">Replace the current private link?</p>
                    <p className="mt-1 text-xs text-muted-foreground">Rotation immediately revokes every older link. The new link is shown once and is not sent to the seller.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" onClick={issueLink} disabled={issue.isPending} data-testid={`button-confirm-rotate-seller-link-${offer.id}`}>{issue.isPending ? 'Issuing…' : 'Rotate link'}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmRotate(false)} data-testid={`button-cancel-rotate-seller-link-${offer.id}`}>Keep current link</Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant={current?.status === 'ACTIVE' ? 'outline' : 'default'} disabled={!isOwner || issue.isPending || control.isLoading || control.isError} onClick={() => current?.status === 'ACTIVE' ? setConfirmRotate(true) : issueLink()} data-testid={`button-issue-seller-link-${offer.id}`}>
                    {current?.status === 'ACTIVE' ? <><RotateCw className="mr-2 h-4 w-4" />Rotate private link</> : issue.isPending ? 'Issuing…' : 'Issue private link'}
                  </Button>
                )}
              </div>
            ) : null}
            {isOwner && issue.error && <div className="mt-2"><ErrorNotice error={issue.error} /><Button size="sm" variant="outline" className="mt-2" disabled={!canIssue} onClick={issueLink}>Retry issuance</Button></div>}
          </>}
        </div>
      </div>
    </section>
  );
}
