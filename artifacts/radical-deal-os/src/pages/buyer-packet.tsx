import { useEffect, useState } from 'react';
import type { BuyerPortalDeal } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Logo } from '@/components/logo';
import { fmtDate, money } from '@/lib/format';

type BuyerResponseAction = 'INTERESTED' | 'ACCEPTED' | 'DECLINED';

interface PendingBuyerResponse {
  eventKey: string;
  action: BuyerResponseAction;
  note: string;
}

const buyerTokenStorageKey = 'radical-deal-os:buyer-portal-token';
const pendingResponseStorageKey = (tokenDigest: string) => `radical-deal-os:buyer-portal-pending:${tokenDigest}`;

async function readJson(response: Response) {
  try { return await response.json() as Record<string, unknown>; }
  catch { return {}; }
}

async function getPendingStorageKey(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return pendingResponseStorageKey(hex);
}

function parsePendingResponse(raw: string): PendingBuyerResponse | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value.eventKey !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.eventKey)) return null;
    if (!['INTERESTED', 'ACCEPTED', 'DECLINED'].includes(String(value.action))) return null;
    if (typeof value.note !== 'string' || value.note.length > 2000) return null;
    return value as unknown as PendingBuyerResponse;
  } catch {
    return null;
  }
}

export default function BuyerPacketPage() {
  const [token, setToken] = useState<string | null>(null);
  const [pendingStorageKey, setPendingStorageKey] = useState<string | null>(null);
  const [sessionStorageReady, setSessionStorageReady] = useState(false);
  const [retryStorageError, setRetryStorageError] = useState<string | null>(null);
  const [deal, setDeal] = useState<BuyerPortalDeal | null>(null);
  const [note, setNote] = useState('');
  const [pendingResponse, setPendingResponse] = useState<PendingBuyerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const initializePortal = async () => {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const capability = fragment.get('token');
      let activeToken = capability;
      let tokenStored = false;

      if (capability) {
        try {
          window.sessionStorage.setItem(buyerTokenStorageKey, capability);
          tokenStored = true;
          window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
        } catch {
          // Keep the fragment available for this page load if tab storage is unavailable.
        }
      } else {
        try {
          activeToken = window.sessionStorage.getItem(buyerTokenStorageKey);
          tokenStored = Boolean(activeToken);
        } catch {
          // Without a token in the URL or tab storage, the portal cannot be opened.
        }
      }

      if (!activeToken) {
        if (!cancelled) {
          setError('This page needs the private buyer link. Open the complete link you received.');
          setLoading(false);
        }
        return;
      }

      if (!cancelled) setToken(activeToken);
      let storageKey: string | null = null;
      let restoredResponse: PendingBuyerResponse | null = null;

      if (tokenStored) {
        try {
          storageKey = await getPendingStorageKey(activeToken);
          if (cancelled) return;
          const raw = window.sessionStorage.getItem(storageKey);
          if (raw) {
            restoredResponse = parsePendingResponse(raw);
            if (restoredResponse) {
              setPendingResponse(restoredResponse);
              setNote(restoredResponse.note);
            } else {
              window.sessionStorage.removeItem(storageKey);
            }
          }
          setPendingStorageKey(storageKey);
          setSessionStorageReady(true);
        } catch {
          if (!cancelled) {
            setSessionStorageReady(false);
            setRetryStorageError('This browser cannot safely save and resume responses. Your response buttons are disabled in this tab. Open the original buyer link in a browser with tab storage enabled.');
          }
        }
      } else if (!cancelled) {
        setRetryStorageError('This browser cannot safely save and resume responses. Your response buttons are disabled in this tab. Open the original buyer link in a browser with tab storage enabled.');
      }

      try {
        const response = await fetch('/api/portal/deal', {
          headers: { 'X-Portal-Token': activeToken },
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
        });
        const data = await readJson(response);
        if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'This buyer link is invalid or no longer active.');
        if (!cancelled) {
          const loadedDeal = data as unknown as BuyerPortalDeal;
          setDeal(loadedDeal);
          if (restoredResponse && loadedDeal.events.some((event) => event.eventKey === restoredResponse?.eventKey)) {
            try {
              if (storageKey) window.sessionStorage.removeItem(storageKey);
            } catch {
              // The server event is authoritative; a stale tab copy is harmless and will be reconciled again.
            }
            setPendingResponse(null);
            setNote('');
          }
        }
      } catch (cause: unknown) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'The deal packet could not be loaded.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void initializePortal();
    return () => { cancelled = true; };
  }, []);

  const respond = async (action: BuyerResponseAction) => {
    if (!token || !sessionStorageReady || !pendingStorageKey) return;
    const intent = pendingResponse ?? { eventKey: crypto.randomUUID(), action, note: note.trim() };
    if (intent.action !== action || (pendingResponse && intent.note !== note.trim())) return;

    if (!pendingResponse) {
      try {
        window.sessionStorage.setItem(pendingStorageKey, JSON.stringify(intent));
      } catch {
        setSessionStorageReady(false);
        setRetryStorageError('This browser could not save the response for a safe retry, so nothing was sent. Enable tab storage and reopen the original buyer link.');
        return;
      }
      setPendingResponse(intent);
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/portal/deal/response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Portal-Token': token },
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        body: JSON.stringify(intent),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Your response could not be recorded.');
      const updatedDeal = data as unknown as BuyerPortalDeal;
      setDeal(updatedDeal);
      if (updatedDeal.events.some((event) => event.eventKey === intent.eventKey)) {
        try {
          window.sessionStorage.removeItem(pendingStorageKey);
        } catch {
          // The server event is authoritative; a stale tab copy is reconciled on the next load.
        }
        setPendingResponse(null);
        setNote('');
      } else {
        setError('The server did not confirm this response. Keep the saved response and retry it to check the same event.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your response could not be recorded.');
    } finally {
      setBusy(false);
    }
  };

  const packet = deal?.packet;
  return <main className="min-h-[100dvh] bg-background px-4 py-8 text-foreground sm:px-6">
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center gap-3"><Logo /><div><p className="eyebrow">Private buyer portal</p><p className="text-xs text-muted-foreground">Capability link access · do not forward</p></div></div>
      {loading && <section className="ledger p-5" role="status">Loading the authorized deal packet…</section>}
      {!loading && error && !packet && <section className="ledger border-l-4 border-l-destructive p-5" role="alert">
        <h1 className="text-xl font-semibold">Unable to open this deal</h1><p className="mt-2 text-sm text-muted-foreground">{error}</p>
      </section>}
      {packet && deal && <>
        <header className="ledger space-y-3 border-t-4 border-t-signal p-5 sm:p-7">
          <p className="eyebrow">Off-market opportunity · {packet.location.city}, {packet.location.state}</p>
          <h1 className="font-serif text-3xl sm:text-4xl">{packet.property.propertyType.replace(/_/g, ' ')}</h1>
          <p className="text-sm text-muted-foreground">{packet.location.county} County · {packet.location.zip} · Street address shared after owner review</p>
          <div className="grid gap-3 border-y border-border py-4 sm:grid-cols-3">
            <div><p className="eyebrow">Buyer price</p><p className="font-mono text-2xl">{money(packet.economics.buyerPrice)}</p></div>
            <div><p className="eyebrow">ARV range</p><p className="font-mono">{money(packet.underwriting.arv.low)} – {money(packet.underwriting.arv.high)}</p></div>
            <div><p className="eyebrow">Gross spread · expected</p><p className="font-mono">{money(packet.underwriting.grossProfitPotential.expected)}</p></div>
          </div>
          <p className="text-sm">{packet.disclosure}</p>
        </header>
        <section className="ledger space-y-4 p-5 sm:p-7">
          <div><h2 className="eyebrow mb-2">Property facts</h2>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div><dt className="text-muted-foreground">Beds</dt><dd>{packet.property.beds}</dd></div>
              <div><dt className="text-muted-foreground">Baths</dt><dd>{packet.property.baths}</dd></div>
              <div><dt className="text-muted-foreground">Square feet</dt><dd>{packet.property.sqft.toLocaleString()}</dd></div>
              <div><dt className="text-muted-foreground">Units</dt><dd>{packet.property.units}</dd></div>
              {packet.property.askingPrice != null && <div><dt className="text-muted-foreground">Current ask</dt><dd>{money(packet.property.askingPrice)}</dd></div>}
              <div><dt className="text-muted-foreground">Closing deadline</dt><dd>{fmtDate(packet.closeBy)}</dd></div>
            </dl>
          </div>
          <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
            <div><h2 className="eyebrow mb-2">Locked economics</h2>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between gap-3"><dt>Acquisition</dt><dd className="font-mono">{money(packet.economics.acquisitionPrice)}</dd></div>
                <div className="flex justify-between gap-3"><dt>Authorized assignment fee</dt><dd className="font-mono">{money(packet.economics.authorizedAssignmentFee)}</dd></div>
                <div className="flex justify-between gap-3 border-t border-border pt-1 font-semibold"><dt>Buyer price</dt><dd className="font-mono">{money(packet.economics.buyerPrice)}</dd></div>
              </dl>
              <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">Seller-contract contingencies: {packet.contingencies}</p>
            </div>
            <div><h2 className="eyebrow mb-2">Underwriting snapshot</h2>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between gap-3"><dt>Repairs · low / expected / high</dt><dd className="font-mono">{money(packet.underwriting.repairs.low)} / {money(packet.underwriting.repairs.expected)} / {money(packet.underwriting.repairs.high)}</dd></div>
                <div className="flex justify-between gap-3"><dt>Gross potential · conservative</dt><dd className="font-mono">{money(packet.underwriting.grossProfitPotential.low)}</dd></div>
              </dl>
              <p className="mt-2 text-xs text-muted-foreground">{packet.underwriting.grossProfitPotential.caveat}</p>
              <p className="mt-1 text-xs text-muted-foreground">Snapshot as of {fmtDate(packet.underwriting.calculatedAt)}.</p>
            </div>
          </div>
          <div className="border-t border-border pt-4">
            <h2 className="eyebrow mb-2">Property media</h2>
            {packet.media.length ? <div className="grid grid-cols-2 gap-2">{packet.media.map((media, index) =>
              typeof media.url === 'string' ? <a key={index} href={media.url} target="_blank" rel="noreferrer" className="underline">View source media {index + 1}</a> : null)}</div> :
              <p className="text-sm text-muted-foreground">{packet.mediaNotice}</p>}
          </div>
          <div className="border-t border-border pt-4">
            <h2 className="eyebrow mb-1">Respond to the opportunity</h2>
            <p className="mb-3 text-xs text-muted-foreground">All selected buyers receive the same locked economics. Interest and acceptance are non-binding; other qualified buyers may still respond. Only the first valid commitment with current qualification and owner-reviewed evidence closes distribution.</p>
            {deal.recipientStatus === 'ACCEPTED' && <p className="mb-3 border-l-2 border-signal pl-3 text-sm font-semibold">Your acceptance is recorded as intent, not a commitment. The deal remains open to other qualified buyers until a valid commitment is reviewed.</p>}
            {deal.unavailableReason && <p className="mb-3 text-sm text-muted-foreground">{deal.unavailableReason}</p>}
            <label className="mb-3 block text-sm">Optional note
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} className="mt-1" placeholder="Questions or requested diligence" disabled={busy || Boolean(pendingResponse) || !sessionStorageReady} />
            </label>
          {retryStorageError && <p className="mb-3 text-sm text-destructive" role="alert">{retryStorageError}</p>}
          {pendingResponse && <div className="mb-3 space-y-2 rounded-md border border-signal/40 bg-signal/5 p-3">
            <p className="text-sm" role="status">Your {pendingResponse.action.toLowerCase()} response is saved in this tab but not yet confirmed. Retrying uses the same response and event key, so it will not create a duplicate.</p>
            <Button variant="outline" disabled={busy || !sessionStorageReady} onClick={() => void respond(pendingResponse.action)}>
              {busy ? 'Checking response…' : `Retry saved ${pendingResponse.action.toLowerCase()} response`}
            </Button>
          </div>}
            {error && <p className="mb-3 text-sm text-destructive" role="alert">{error}</p>}
            {!pendingResponse && <div className="flex flex-wrap gap-2">
              {deal.recipientStatus !== 'ACCEPTED' && <Button variant="outline" disabled={busy || !sessionStorageReady} onClick={() => void respond('INTERESTED')}>{busy ? 'Saving…' : 'Express interest'}</Button>}
              {deal.canAccept && <Button disabled={busy || !sessionStorageReady} onClick={() => void respond('ACCEPTED')}>{busy ? 'Saving…' : `Accept stated terms · ${money(packet.economics.buyerPrice)}`}</Button>}
              {deal.recipientStatus !== 'DECLINED' && <Button variant="ghost" disabled={busy || !sessionStorageReady} onClick={() => void respond('DECLINED')}>Decline</Button>}
            </div>}
          </div>
          {deal.events.length > 0 && <div className="border-t border-border pt-4">
            <h2 className="eyebrow mb-2">Your response history</h2>
            <ul className="space-y-1 text-xs text-muted-foreground">{deal.events.map((event) =>
              <li key={event.eventKey}>{event.action} · {fmtDate(event.recordedAt)}{event.note ? ` · ${event.note}` : ''}</li>)}</ul>
          </div>}
        </section>
      </>}
      <p className="pb-5 text-center text-[11px] text-muted-foreground">Private link access is recorded. Contact the deal owner for diligence, documentation, or media not included here.</p>
    </div>
  </main>;
}
