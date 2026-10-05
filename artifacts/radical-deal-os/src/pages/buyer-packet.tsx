import { useEffect, useState } from 'react';
import type { BuyerPortalDeal } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Logo } from '@/components/logo';
import { fmtDate, money } from '@/lib/format';

async function readJson(response: Response) {
  try { return await response.json() as Record<string, unknown>; }
  catch { return {}; }
}

export default function BuyerPacketPage() {
  const [token, setToken] = useState<string | null>(null);
  const [deal, setDeal] = useState<BuyerPortalDeal | null>(null);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const capability = fragment.get('token');
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
    if (!capability) {
      setError('This page needs the private buyer link. Open the complete link you received.');
      setLoading(false);
      return;
    }
    setToken(capability);
    let cancelled = false;
    void fetch('/api/portal/deal', {
      headers: { 'X-Portal-Token': capability },
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    }).then(async (response) => {
      const data = await readJson(response);
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'This buyer link is invalid or no longer active.');
      if (!cancelled) setDeal(data as unknown as BuyerPortalDeal);
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'The deal packet could not be loaded.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const respond = async (action: 'INTERESTED' | 'ACCEPTED' | 'DECLINED') => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/portal/deal/response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Portal-Token': token },
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        body: JSON.stringify({ eventKey: crypto.randomUUID(), action, note: note.trim() }),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Your response could not be recorded.');
      setDeal(data as unknown as BuyerPortalDeal);
      setNote('');
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
            <p className="mb-3 text-xs text-muted-foreground">All selected buyers receive the same locked economics. The first currently qualified acceptance is held for owner review. This portal does not create an assignment, buyer commitment, or funds transfer.</p>
            {deal.recipientStatus === 'ACCEPTED' && <p className="mb-3 border-l-2 border-signal pl-3 text-sm font-semibold">Your acceptance is recorded for owner review. You are not committed until separate documents are executed and confirmed.</p>}
            {deal.unavailableReason && <p className="mb-3 text-sm text-muted-foreground">{deal.unavailableReason}</p>}
            <label className="mb-3 block text-sm">Optional note
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} className="mt-1" placeholder="Questions or requested diligence" disabled={busy} />
            </label>
            {error && <p className="mb-3 text-sm text-destructive" role="alert">{error}</p>}
            <div className="flex flex-wrap gap-2">
              {deal.recipientStatus !== 'ACCEPTED' && <Button variant="outline" disabled={busy} onClick={() => void respond('INTERESTED')}>{busy ? 'Saving…' : 'Express interest'}</Button>}
              {deal.canAccept && <Button disabled={busy} onClick={() => void respond('ACCEPTED')}>{busy ? 'Saving…' : `Accept stated terms · ${money(packet.economics.buyerPrice)}`}</Button>}
              {deal.recipientStatus !== 'DECLINED' && <Button variant="ghost" disabled={busy} onClick={() => void respond('DECLINED')}>Decline</Button>}
            </div>
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
