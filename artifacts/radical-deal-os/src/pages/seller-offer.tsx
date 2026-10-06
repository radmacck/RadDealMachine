import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { AlertTriangle, FileCheck2, ShieldCheck } from 'lucide-react';
import {
  getGetSellerOfferPortalQueryKey, getRespondToSellerOfferPortalMutationOptions, useGetSellerOfferPortal,
  type OfferTerms, type SellerOfferPortal, type SellerOfferPortalResponseInput,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Logo } from '@/components/logo';
import { ErrorNotice } from '@/components/state-views';
import { fmtDate, money } from '@/lib/format';

type Action = SellerOfferPortalResponseInput['action'];
type ResponseFields = {
  respondentName: string;
  verificationCode: string;
  note: string;
  amount: string;
  earnestMoney: string;
  closingDays: string;
  contingencies: string;
  assignmentIntent: boolean;
};
const initialValues: ResponseFields = {
  respondentName: '', verificationCode: '', note: '', amount: '', earnestMoney: '', closingDays: '30',
  contingencies: '', assignmentIntent: false,
};
const sellerTokenStorageKey = 'radical-deal-os:seller-offer-token';
const pendingResponseStorageKey = (portalId: string) => `radical-deal-os:seller-offer-pending:${portalId}`;

function parseStoredResponse(raw: string): SellerOfferPortalResponseInput | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value.eventKey !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.eventKey)) return null;
    if (!['ACCEPTED', 'REJECTED', 'COUNTERED'].includes(String(value.action))) return null;
    if (typeof value.respondentName !== 'string' || !value.respondentName.trim()) return null;
    if (value.verificationCode !== undefined && typeof value.verificationCode !== 'string') return null;
    if (value.note !== undefined && typeof value.note !== 'string') return null;
    if (value.action === 'COUNTERED') {
      const terms = value.counterTerms as Record<string, unknown> | undefined;
      if (!terms || typeof terms.amount !== 'number' || typeof terms.earnestMoney !== 'number'
        || typeof terms.closingDays !== 'number' || typeof terms.contingencies !== 'string'
        || typeof terms.assignmentIntent !== 'boolean') return null;
    } else if (value.counterTerms !== undefined) {
      return null;
    }
    return { ...value, verificationCode: '' } as unknown as SellerOfferPortalResponseInput;
  } catch {
    return null;
  }
}

function Notice({ title, detail, tone = 'muted' }: { title: string; detail: string; tone?: 'muted' | 'stop' | 'go' }) {
  return <section className={`ledger border-l-4 p-5 ${tone === 'stop' ? 'border-l-destructive' : tone === 'go' ? 'border-l-signal' : 'border-l-border'}`} role="status">
    <p className="eyebrow">Seller offer portal</p><h1 className="mt-2 font-serif text-2xl">{title}</h1><p className="mt-2 text-sm text-muted-foreground">{detail}</p>
  </section>;
}

export default function SellerOfferPage() {
  const [token, setToken] = useState<string | null>(null);
  const [missingToken, setMissingToken] = useState(false);
  const [sessionStorageReady, setSessionStorageReady] = useState(false);
  const [localError, setLocalError] = useState('');
  const [pendingResponse, setPendingResponse] = useState<SellerOfferPortalResponseInput | null>(null);
  const form = useForm<ResponseFields>({ defaultValues: initialValues });
  const queryClient = useQueryClient();

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const capability = fragment.get('token');
    if (capability) {
      setToken(capability);
      try {
        window.sessionStorage.setItem(sellerTokenStorageKey, capability);
        setSessionStorageReady(true);
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
      } catch {
        // Keep the fragment in the URL if tab storage is unavailable; it is never sent in an HTTP request.
      }
      return;
    }
    try {
      const saved = window.sessionStorage.getItem(sellerTokenStorageKey);
      if (saved) {
        setToken(saved);
        setSessionStorageReady(true);
        return;
      }
    } catch {
      // Without the original fragment or tab storage, no capability is available.
    }
    setMissingToken(true);
  }, []);

  const portalQueryKey = [...getGetSellerOfferPortalQueryKey(), 'capability', token] as const;
  const portalQuery = useGetSellerOfferPortal({
    query: { queryKey: portalQueryKey, enabled: !!token },
    request: { headers: token ? { 'X-Seller-Offer-Token': token } : {} },
  });
  const portal = portalQuery.data;
  const response = useMutation(getRespondToSellerOfferPortalMutationOptions({
    request: { headers: token ? { 'X-Seller-Offer-Token': token } : {} },
    mutation: {
      onError: (cause) => {
        const status = (cause as Error & { status?: number }).status;
        if (status === 404 || status === 409 || status === 410 || status === 429) void portalQuery.refetch();
        setPendingResponse((pending) => pending ? { ...pending, verificationCode: '' } : null);
        form.setValue('verificationCode', '');
        if (status === 404 || status === 410 || status === 429) {
          try {
            if (portal) window.sessionStorage.removeItem(pendingResponseStorageKey(portal.id));
          } catch {
            // A stale pending response is harmless; the API remains authoritative.
          }
          setPendingResponse(null);
        }
      },
    },
  }));

  useEffect(() => {
    if (!portal) return;
    const storageKey = pendingResponseStorageKey(portal.id);
    try {
      if (portal.status !== 'ACTIVE' || !portal.canRespond) {
        window.sessionStorage.removeItem(storageKey);
        setPendingResponse(null);
        return;
      }
      const raw = window.sessionStorage.getItem(storageKey);
      const saved = raw ? parseStoredResponse(raw) : null;
      if (raw && !saved) window.sessionStorage.removeItem(storageKey);
      if (saved) {
        setPendingResponse(saved);
        form.reset({
          ...initialValues,
          respondentName: saved.respondentName,
          note: saved.note ?? '',
          ...(saved.counterTerms ? {
            amount: String(saved.counterTerms.amount),
            earnestMoney: String(saved.counterTerms.earnestMoney),
            closingDays: String(saved.counterTerms.closingDays),
            contingencies: saved.counterTerms.contingencies,
            assignmentIntent: saved.counterTerms.assignmentIntent,
          } : {}),
        });
        return;
      }
      form.reset({ ...initialValues, respondentName: portal.snapshot.sellerName });
    } catch {
      setLocalError('This browser could not restore a pending response. Check the response status with the deal owner before submitting again.');
    }
  }, [portal?.id, portal?.status, portal?.canRespond]);

  const persistAndSend = (input: SellerOfferPortalResponseInput, portalId: string) => {
    try {
      const { verificationCode: _code, ...retryIntent } = input;
      window.sessionStorage.setItem(pendingResponseStorageKey(portalId), JSON.stringify(retryIntent));
    } catch {
      setLocalError('This browser cannot preserve a safe retry for this response, so nothing was sent. Enable tab storage and try again.');
      return;
    }
    setPendingResponse(input);
    setLocalError('');
    response.mutate({ data: input }, {
      onSuccess: (updated) => {
        queryClient.setQueryData(portalQueryKey, updated);
        try {
          window.sessionStorage.removeItem(pendingResponseStorageKey(portalId));
        } catch {
          // The recorded event is authoritative even if the tab cannot clear its local retry copy.
        }
        setPendingResponse(null);
        form.reset(initialValues);
      },
    });
  };

  const sendResponse = (action: Action) => {
    if (!portal || !token || !sessionStorageReady) return;
    if (pendingResponse) {
      if (pendingResponse.action === action) void form.handleSubmit((values) => {
        const verificationCode = values.verificationCode.trim();
        if (!/^\d{6}$/.test(verificationCode)) {
          form.setError('verificationCode', { type: 'validate', message: 'Enter the 6-digit code supplied separately by the deal owner.' });
          return;
        }
        persistAndSend({ ...pendingResponse, verificationCode }, portal.id);
      })();
      return;
    }
    void form.handleSubmit((values) => {
      const respondentName = values.respondentName.trim();
      if (!respondentName) {
        form.setError('respondentName', { type: 'validate', message: 'Enter the name of the person responding.' });
        return;
      }
      let counterTerms: OfferTerms | undefined;
      if (action === 'COUNTERED') {
        const amount = Number(values.amount);
        const earnestMoney = Number(values.earnestMoney || 0);
        const closingDays = Number(values.closingDays);
        if (!values.amount.trim() || !Number.isFinite(amount) || amount <= 0) {
          form.setError('amount', { type: 'validate', message: 'Enter a counter amount above zero.' });
          return;
        }
        if (!Number.isFinite(earnestMoney) || earnestMoney < 0 || earnestMoney > amount) {
          form.setError('earnestMoney', { type: 'validate', message: 'Earnest money must be between zero and the proposed amount.' });
          return;
        }
        if (!Number.isInteger(closingDays) || closingDays < 1 || closingDays > 180) {
          form.setError('closingDays', { type: 'validate', message: 'Choose a closing window from 1 to 180 days.' });
          return;
        }
        if (values.contingencies.trim().length < 3) {
          form.setError('contingencies', { type: 'validate', message: 'Describe the proposed contingencies.' });
          return;
        }
        counterTerms = {
          amount, earnestMoney, closingDays, contingencies: values.contingencies.trim(),
          assignmentIntent: values.assignmentIntent,
        };
      }
      const input: SellerOfferPortalResponseInput = {
        eventKey: crypto.randomUUID(),
        action,
        respondentName,
        verificationCode: values.verificationCode.trim(),
        note: values.note.trim() || undefined,
        ...(counterTerms ? { counterTerms } : {}),
      };
      persistAndSend(input, portal.id);
    })();
  };

  const responseError = response.error as (Error & { status?: number }) | null;
  const responseErrorStatus = responseError?.status;
  const queryErrorStatus = (portalQuery.error as (Error & { status?: number }) | null)?.status;
  const terminalResponseError = responseErrorStatus === 404 || responseErrorStatus === 409 || responseErrorStatus === 410 || responseErrorStatus === 429;
  const unavailableTitle = queryErrorStatus === 404 || queryErrorStatus === 410 ? 'This private link is no longer available' : 'Offer details could not be loaded';

  return <main className="min-h-[100dvh] bg-background px-4 py-6 text-foreground sm:px-6 sm:py-10" data-testid="page-seller-offer">
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <Logo /><div className="text-right"><p className="eyebrow">Private seller response</p><p className="text-[11px] text-muted-foreground">Offer terms are an approved snapshot</p></div>
      </header>
      {!token && !missingToken && <section className="ledger animate-pulse space-y-3 p-5" role="status" aria-label="Opening private offer"><div className="h-3 w-32 bg-muted" /><div className="h-7 w-2/3 bg-muted" /><div className="h-20 bg-muted" /></section>}
      {missingToken && <Notice title="A private link is required" detail="Open the complete private seller link provided by the deal owner. No offer details are available without it." tone="stop" />}
      {token && portalQuery.isLoading && <section className="ledger space-y-4 p-5" role="status" aria-label="Loading offer">
        <div className="h-3 w-36 animate-pulse bg-muted" /><div className="h-8 w-2/3 animate-pulse bg-muted" /><div className="h-32 animate-pulse bg-muted" />
      </section>}
      {token && portalQuery.isError && <section className="space-y-3">
        <Notice title={unavailableTitle} detail={portalQuery.error instanceof Error ? portalQuery.error.message : 'The link may have expired, been revoked, or replaced by a newer link.'} tone="stop" />
        <Button variant="outline" onClick={() => void portalQuery.refetch()} disabled={portalQuery.isFetching} data-testid="button-retry-seller-offer">{portalQuery.isFetching ? 'Checking link…' : 'Retry opening link'}</Button>
      </section>}
      {portal && <>
        {(portal.status === 'REVOKED' || !portal.canRespond) && <Notice
          title={portal.status === 'RESPONDED' ? 'A response is already recorded' : 'This offer is no longer current'}
          detail={portal.unavailableReason || (portal.status === 'RESPONDED' ? 'This private link has already recorded a response.' : 'The link may have expired, been revoked, or the offer is no longer current. Contact the deal owner for an update.')}
          tone={portal.status === 'RESPONDED' ? 'go' : 'stop'} />}
        {terminalResponseError && <Notice title={responseErrorStatus === 429 ? 'Contact verification is locked' : responseErrorStatus === 409 ? 'This response can no longer be submitted' : 'This private link is no longer current'} detail={responseError?.message || 'The offer may have been responded to, expired, revoked, or replaced. Refreshing the current link state.'} tone="stop" />}
        {portal.status === 'ACTIVE' && portal.canRespond && !terminalResponseError && <>
          <section className="ledger overflow-hidden" data-testid="seller-offer-summary">
            <div className="border-b border-border border-t-4 border-t-signal px-5 py-5 sm:px-7">
              <p className="eyebrow">Offer for {portal.snapshot.sellerName}</p>
              <h1 className="mt-2 break-words font-serif text-3xl leading-tight sm:text-4xl">{portal.snapshot.propertyAddress}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{portal.snapshot.city}, {portal.snapshot.state} {portal.snapshot.zip} · {portal.snapshot.county} County</p>
               <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 text-signal" />Authorized by the owner · prepared {fmtDate(portal.snapshot.preparedAt)} · expires {fmtDate(portal.expiresAt)}</p>
               <p className="mt-2 text-xs text-muted-foreground">A one-time code is required and must be provided separately by the owner via {portal.snapshot.verificationDeliveryMethod === 'PHONE' ? 'phone' : 'in person'}. If you do not have it, contact the owner.</p>
            </div>
            <div className="grid grid-cols-2 gap-4 px-5 py-5 sm:grid-cols-4 sm:px-7">
              <div className="col-span-2"><p className="eyebrow">Offer amount</p><p className="mt-1 font-mono text-3xl font-semibold">{money(portal.snapshot.terms.amount)}</p></div>
              <div><p className="eyebrow">Earnest money</p><p className="mt-1 font-mono text-lg">{money(portal.snapshot.terms.earnestMoney)}</p></div>
              <div><p className="eyebrow">Closing</p><p className="mt-1 font-mono text-lg">{portal.snapshot.terms.closingDays} days</p></div>
              <div className="col-span-2 border-t border-border pt-3 sm:col-span-4"><p className="eyebrow">Contingencies</p><p className="mt-1 whitespace-pre-wrap text-sm">{portal.snapshot.terms.contingencies}</p></div>
              <div className="col-span-2 text-sm sm:col-span-4">Assignment intent: <b>{portal.snapshot.terms.assignmentIntent ? 'Intended' : 'Not intended'}</b></div>
            </div>
          </section>
          <Form {...form}>
          <form className="ledger space-y-4 p-5 sm:p-7" data-testid="seller-response-form" noValidate onSubmit={(event) => event.preventDefault()}>
            <div className="flex items-start gap-3"><FileCheck2 className="mt-0.5 h-5 w-5 shrink-0 text-signal" /><div><h2 className="font-serif text-2xl">Your stated response</h2><p className="mt-1 text-sm text-muted-foreground">Choose accept, reject, or offer different terms. The code verifies control of the contact route; your name and authority remain self-reported.</p></div></div>
             <aside className="border border-signal/50 bg-signal/5 p-3 text-xs leading-relaxed" data-testid="notice-response-authority">
               <div className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-signal" /><p><b>Important:</b> The code confirms control of the contact route the owner said they verified; the name remains self-reported and legal authority is not established. A response does not change the communicated offer, authorize counter terms, create a contract, or sign documents.</p></div>
            </aside>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="seller-respondent-name">Your name</Label>
                <Input id="seller-respondent-name" {...form.register('respondentName', { required: 'Enter the name of the person responding.', maxLength: { value: 200, message: 'Use 200 characters or fewer.' } })} disabled={response.isPending || !!pendingResponse} autoComplete="name" data-testid="input-seller-respondent-name" />
                {form.formState.errors.respondentName?.message && <p className="text-xs text-destructive" role="alert">{form.formState.errors.respondentName.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="seller-verification-code">6-digit verification code</Label>
                <Input id="seller-verification-code" type="password" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                  {...form.register('verificationCode', { required: 'Enter the 6-digit code supplied separately by the deal owner.', pattern: { value: /^\d{6}$/, message: 'Enter exactly 6 digits.' } })}
                  disabled={response.isPending} data-testid="input-seller-verification-code" />
                {form.formState.errors.verificationCode?.message && <p className="text-xs text-destructive" role="alert">{form.formState.errors.verificationCode.message}</p>}
                <p className="text-[11px] text-muted-foreground">Enter the code provided separately by the owner. It is not saved in browser storage.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="seller-response-note">Note (optional)</Label>
                <Textarea id="seller-response-note" {...form.register('note', { maxLength: { value: 2000, message: 'Use 2,000 characters or fewer.' } })} disabled={response.isPending || !!pendingResponse} maxLength={2000} rows={2} placeholder="Add context for the deal owner" data-testid="input-seller-response-note" />
                {form.formState.errors.note?.message && <p className="text-xs text-destructive" role="alert">{form.formState.errors.note.message}</p>}
              </div>
            </div>
            <div className="space-y-3 border-t border-border pt-4">
              <h3 className="eyebrow">Counter terms, if applicable</h3>
              <p className="text-xs text-muted-foreground">A counter is a request for review only. It does not update or replace the approved offer.</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5"><Label htmlFor="counter-amount">Amount (USD)</Label><Input id="counter-amount" type="number" min="1" {...form.register('amount')} disabled={response.isPending || !!pendingResponse} data-testid="input-counter-amount" />{form.formState.errors.amount?.message && <p className="text-xs text-destructive" role="alert">{form.formState.errors.amount.message}</p>}</div>
                <div className="space-y-1.5"><Label htmlFor="counter-earnest">Earnest money (USD)</Label><Input id="counter-earnest" type="number" min="0" {...form.register('earnestMoney')} disabled={response.isPending || !!pendingResponse} data-testid="input-counter-earnest" />{form.formState.errors.earnestMoney?.message && <p className="text-xs text-destructive" role="alert">{form.formState.errors.earnestMoney.message}</p>}</div>
                <div className="space-y-1.5"><Label htmlFor="counter-days">Closing days</Label><Input id="counter-days" type="number" min="1" max="180" {...form.register('closingDays')} disabled={response.isPending || !!pendingResponse} data-testid="input-counter-days" />{form.formState.errors.closingDays?.message && <p className="text-xs text-destructive" role="alert">{form.formState.errors.closingDays.message}</p>}</div>
              </div>
              <div className="space-y-1.5"><Label htmlFor="counter-contingencies">Contingencies</Label><Textarea id="counter-contingencies" rows={2} {...form.register('contingencies')} disabled={response.isPending || !!pendingResponse} data-testid="input-counter-contingencies" />{form.formState.errors.contingencies?.message && <p className="text-xs text-destructive" role="alert">{form.formState.errors.contingencies.message}</p>}</div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...form.register('assignmentIntent')} disabled={response.isPending || !!pendingResponse} data-testid="check-counter-assignment" />Assignment is intended</label>
            </div>
            {localError && <p className="text-sm text-destructive" role="alert" data-testid="text-seller-response-local-error">{localError}</p>}
            {!sessionStorageReady && <p className="text-sm text-destructive" role="alert">This browser cannot preserve a safe retry, so responses are disabled.</p>}
            {response.error && <div className="space-y-2" role="alert"><ErrorNotice error={response.error} /><p className="text-xs text-muted-foreground">Retrying reuses the same event key and response details saved for this tab.</p></div>}
            <div className="grid gap-2 sm:grid-cols-3">
              <Button type="button" className="w-full" disabled={!portal.canRespond || !sessionStorageReady || response.isPending || (!!pendingResponse && pendingResponse.action !== 'ACCEPTED')} onClick={() => sendResponse('ACCEPTED')} data-testid="button-seller-accept">{response.isPending && pendingResponse?.action === 'ACCEPTED' ? 'Recording…' : pendingResponse?.action === 'ACCEPTED' ? 'Retry acceptance' : 'Accept stated offer'}</Button>
              <Button type="button" className="w-full" variant="outline" disabled={!portal.canRespond || !sessionStorageReady || response.isPending || (!!pendingResponse && pendingResponse.action !== 'REJECTED')} onClick={() => sendResponse('REJECTED')} data-testid="button-seller-reject">{response.isPending && pendingResponse?.action === 'REJECTED' ? 'Recording…' : pendingResponse?.action === 'REJECTED' ? 'Retry rejection' : 'Reject offer'}</Button>
              <Button type="button" className="w-full" variant="secondary" disabled={!portal.canRespond || !sessionStorageReady || response.isPending || (!!pendingResponse && pendingResponse.action !== 'COUNTERED')} onClick={() => sendResponse('COUNTERED')} data-testid="button-seller-counter">{response.isPending && pendingResponse?.action === 'COUNTERED' ? 'Recording…' : pendingResponse?.action === 'COUNTERED' ? 'Retry counter' : 'Submit counter terms'}</Button>
            </div>
            {pendingResponse && <p className="text-xs text-muted-foreground">A response attempt is pending. Retry the same action to reuse the original event key and response details.</p>}
          </form>
          </Form>
        </>}
        {portal.events.length > 0 && <section className="ledger p-5" data-testid="seller-response-history">
          <h2 className="eyebrow mb-3">Recorded response history</h2>
          <ol className="space-y-3">{portal.events.map((event) => <li key={event.eventKey} className="border-l-2 border-signal pl-3 text-sm" data-testid={`seller-response-event-${event.eventKey}`}>
            <p className="font-semibold">{event.action} · {fmtDate(event.occurredAt)}</p><p className="text-xs text-muted-foreground">Respondent {event.respondentName} · {event.identityVerification === 'VERIFIED_ONE_TIME_CODE' ? 'contact code verified' : 'legacy response; contact not verified'}</p>
            {event.note && <p className="mt-1 whitespace-pre-wrap text-xs">{event.note}</p>}
            {event.counterTerms && <p className="mt-1 text-xs text-muted-foreground">Counter requested: {money(event.counterTerms.amount)} · {event.counterTerms.closingDays} day close. Subject to owner review; the approved offer remains unchanged.</p>}
          </li>)}</ol>
        </section>}
      </>}
      <footer className="border-t border-border pt-4 text-center text-[11px] leading-relaxed text-muted-foreground">This portal records a response only. A code confirms control of the owner-confirmed contact route, not legal identity or authority. It does not transmit an offer, create a contract, or execute an agreement. Contact the deal owner about documentation or next steps.</footer>
    </div>
  </main>;
}
