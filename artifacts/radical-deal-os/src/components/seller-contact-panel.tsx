import { useState } from 'react';
import {
  getGetSellerContactEnrichmentQueryKey, getGetSellerContactPathsQueryKey,
  useGetSellerContactEnrichment, useGetSellerContactPaths, useRecordSellerContactObservation,
  useRequestSellerContactEnrichment,
  type SellerContactObservationInput, type SellerContactReadiness, type SellerContactEnrichmentStatus,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ErrorNotice, RowsSkeleton } from '@/components/state-views';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

const ROLE_OPTIONS = ['RECORDED_OWNER', 'SELLER_SELF_IDENTIFIED', 'AUTHORIZED_AGENT_CLAIM', 'DIRECTORY_CONTACT', 'UNKNOWN'] as const;
const SOURCE_TYPES = ['PUBLIC_RECORD', 'PUBLIC_PAGE', 'PERMITTED_LISTING', 'SELLER', 'ANALYST'] as const;
const localDateTime = (value = new Date()) => new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const empty = {
  channel: 'PHONE' as 'PHONE' | 'EMAIL' | 'WEB' | 'OTHER',
  routeValue: '',
  recipient: '',
  recipientRole: 'UNKNOWN' as typeof ROLE_OPTIONS[number],
  classification: 'OBSERVED' as 'OBSERVED' | 'VERIFIED',
  confidence: '0.5',
  sourceType: 'PUBLIC_PAGE' as typeof SOURCE_TYPES[number],
  sourceId: '',
  sourceName: '',
  sourceRecordId: '',
  sourceUrl: '',
  permissionStatus: 'NOT_REVIEWED' as 'NOT_REVIEWED' | 'PERMITTED' | 'PROHIBITED',
  contactPermissionEvidenceUrl: '',
  routeVerificationStatus: 'UNREVIEWED' as 'UNREVIEWED' | 'CONFIRMED' | 'REJECTED',
  verificationNote: '',
  capturedAt: localDateTime(),
};

function Status({ data }: { data: SellerContactReadiness }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="seller-contact-status">
      <div className="rounded border border-border p-3">
        <p className="eyebrow mb-1">Direct route state</p>
        <p className="font-semibold">{data.directRouteStatus.replaceAll('_', ' ')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{data.nextAction}</p>
      </div>
      <div className="rounded border border-border p-3">
        <p className="eyebrow mb-1">Source capability</p>
        <p className="font-semibold">{data.contactSourceProviderStatus.replaceAll('_', ' ')} · {data.contactSourceProviderCount} connected</p>
        <p className="mt-1 text-sm text-muted-foreground">This screen records evidence already obtained through a permitted source. It does not search directories, send messages, or place calls.</p>
      </div>
    </div>
  );
}

function EnrichmentStatus({ data, canResearch, onRequest, isPending }: {
  data: SellerContactEnrichmentStatus | undefined;
  canResearch: boolean;
  onRequest: () => void;
  isPending: boolean;
}) {
  if (!data) return <p className="text-sm text-muted-foreground">Loading enrichment provider state…</p>;
  const canRun = data.registry.state === 'AVAILABLE_AND_EXERCISED' &&
    data.registry.providers.some(provider => provider.state === 'AVAILABLE_AND_EXERCISED');
  return (
    <div className="space-y-3 rounded border border-border p-3" data-testid="seller-contact-enrichment">
      <div>
        <p className="eyebrow mb-1">Replaceable contact-source capability</p>
        <p className="font-semibold">{data.registry.state.replaceAll('_', ' ')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{data.registry.reason}</p>
      </div>
      {data.registry.providers.map(provider => (
        <div key={provider.providerId} className="rounded bg-muted/40 p-2 text-sm">
          <b>{provider.name}: {provider.state.replaceAll('_', ' ')}</b>
          <p className="text-muted-foreground">{provider.reason}</p>
          <p className="text-xs text-muted-foreground">Routes: {provider.channels.join(', ') || 'none'} · terms/policy reference: {provider.policyReference || 'not supplied'}</p>
        </div>
      ))}
      {canRun && canResearch && (
        <Button onClick={onRequest} disabled={isPending} data-testid="button-request-contact-enrichment">
          {isPending ? 'Queueing permitted lookup…' : 'Check permitted contact sources'}
        </Button>
      )}
      {!canRun && (
        <p className="text-xs text-muted-foreground" data-testid="text-contact-provider-unavailable">
          No lookup or outreach will run. Add and exercise a provider that is permitted for the intended use, or record independently obtained evidence below.
        </p>
      )}
      <p className="text-xs text-muted-foreground">This capability only researches contact evidence. It never calls, emails, messages, changes deal economics, authorizes an offer, or changes transaction state.</p>
      {data.requests.length > 0 && (
        <div className="space-y-2" data-testid="seller-contact-enrichment-history">
          <p className="eyebrow">Recent lookup requests</p>
          {data.requests.map(request => (
            <article key={request.id} className="rounded border border-border p-2 text-xs">
              <div className="flex flex-wrap justify-between gap-2">
                <b>{request.status.replaceAll('_', ' ')}</b>
                <span>{request.attempts}/{request.maxAttempts} attempts · {request.resultCount} new observation(s)</span>
              </div>
              <p className="mt-1 text-muted-foreground">{request.reason}</p>
              {request.nextAttemptAt && <p className="text-muted-foreground">Next retry: {new Date(request.nextAttemptAt).toLocaleString()}</p>}
              {request.providerResults.map(result => (
                <p key={result.providerId} className="text-muted-foreground">{result.providerId}: {result.status.replaceAll('_', ' ')} — {result.reason}</p>
              ))}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function SellerContactPanel({ leadId, canResearch, onSaved }: {
  leadId: string; canResearch: boolean; onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const queryKey = getGetSellerContactPathsQueryKey(leadId);
  const enrichmentQueryKey = getGetSellerContactEnrichmentQueryKey(leadId);
  const query = useGetSellerContactPaths(leadId, {
    query: { queryKey, enabled: !!leadId, staleTime: 5_000, refetchInterval: 15_000 },
  });
  const enrichmentQuery = useGetSellerContactEnrichment(leadId, {
    query: { queryKey: enrichmentQueryKey, enabled: !!leadId, staleTime: 5_000, refetchInterval: 15_000 },
  });
  const mutation = useRecordSellerContactObservation();
  const enrichmentMutation = useRequestSellerContactEnrichment();
  const [form, setForm] = useState(empty);
  const [localError, setLocalError] = useState<string | null>(null);
  const set = (key: keyof typeof empty) => (value: string) => setForm(current => ({ ...current, [key]: value } as typeof empty));

  if (query.isLoading) return <section className="ledger mt-4 p-4" data-testid="panel-seller-contact"><RowsSkeleton rows={3} /></section>;
  if (query.isError || !query.data) return <section className="ledger mt-4 p-4" data-testid="panel-seller-contact"><ErrorNotice error={query.error} onRetry={() => query.refetch()} /></section>;
  const data = query.data;
  const paths = data.contactPaths;
  const requestEnrichment = () => {
    enrichmentMutation.mutate({
      id: leadId,
      data: { idempotencyKey: crypto.randomUUID(), channels: ['PHONE', 'EMAIL', 'WEB', 'OTHER'] },
    }, {
      onSuccess: result => {
        queryClient.setQueryData(enrichmentQueryKey, result);
        void queryClient.invalidateQueries({ queryKey });
        toast({
          title: 'Contact-source request recorded',
          description: result.requests[0]?.reason ?? 'Provider state was checked; no outreach was sent.',
        });
      },
    });
  };
  const submit = () => {
    const confidence = Number(form.confidence);
    if (!form.routeValue.trim() || !form.sourceId.trim() || !form.sourceName.trim() || !form.sourceRecordId.trim()) {
      setLocalError('Enter the route and its source record identity. No contact attempt is made.');
      return;
    }
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      setLocalError('Confidence must be from 0 to 1.');
      return;
    }
    const observedAt = new Date(form.capturedAt);
    if (!Number.isFinite(observedAt.getTime()) || observedAt.getTime() > Date.now()) {
      setLocalError('Observed time must be a valid date and cannot be in the future.');
      return;
    }
    if (['PUBLIC_RECORD', 'PUBLIC_PAGE', 'PERMITTED_LISTING'].includes(form.sourceType) && !form.sourceUrl.startsWith('https://')) {
      setLocalError('Public-source observations require the HTTPS page or record URL.');
      return;
    }
    if (form.channel === 'WEB' && !form.routeValue.startsWith('https://')) {
      setLocalError('Web/contact-form routes must use HTTPS. No message will be sent.');
      return;
    }
    if (form.permissionStatus === 'PERMITTED' && !form.contactPermissionEvidenceUrl.startsWith('https://')) {
      setLocalError('A permitted route requires HTTPS evidence for the source and intended use.');
      return;
    }
    if (form.routeVerificationStatus !== 'UNREVIEWED' && form.verificationNote.trim().length < 8) {
      setLocalError('Owner route confirmation/rejection requires an evidence note of at least 8 characters.');
      return;
    }
    const body: SellerContactObservationInput = {
      version: data.leadVersion,
      channel: form.channel,
      routeValue: form.routeValue.trim(),
      recipient: form.recipient.trim() || null,
      recipientRole: form.recipientRole,
      classification: form.classification,
      confidence,
      sourceType: form.sourceType,
      sourceId: form.sourceId.trim(),
      sourceName: form.sourceName.trim(),
      sourceRecordId: form.sourceRecordId.trim(),
      ...(form.sourceUrl.trim() ? { sourceUrl: form.sourceUrl.trim() } : {}),
      permissionStatus: form.permissionStatus,
      ...(form.contactPermissionEvidenceUrl.trim() ? { contactPermissionEvidenceUrl: form.contactPermissionEvidenceUrl.trim() } : {}),
      routeVerificationStatus: form.routeVerificationStatus,
      capturedAt: observedAt.toISOString(),
      ...(form.verificationNote.trim() ? { verificationNote: form.verificationNote.trim() } : {}),
    };
    setLocalError(null);
    mutation.mutate({ id: leadId, data: body }, {
      onSuccess: result => {
        queryClient.setQueryData(queryKey, result);
        setForm(empty);
        setLocalError(null);
        onSaved();
        toast({ title: 'Contact evidence recorded', description: 'No call or message was sent.' });
      },
    });
  };

  return (
    <section className="ledger mt-4 space-y-4 p-4" data-testid="panel-seller-contact">
      <div>
        <p className="eyebrow mb-1">Seller contact intelligence</p>
        <h3 className="text-lg font-semibold">Best supported contact route</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Recorded ownership is not verified seller identity. A route does not establish signing authority. No automatic phone/email provider is connected.
        </p>
      </div>
      <Status data={data} />
      {enrichmentQuery.isError
        ? <ErrorNotice error={enrichmentQuery.error} onRetry={() => enrichmentQuery.refetch()} />
        : <EnrichmentStatus
            data={enrichmentQuery.data}
            canResearch={canResearch}
            onRequest={requestEnrichment}
            isPending={enrichmentMutation.isPending}
          />}
      {enrichmentMutation.isError && <ErrorNotice error={enrichmentMutation.error} />}
      {paths.length ? (
        <div className="space-y-2" data-testid="seller-contact-path-list">
          {paths.map(path => (
            <article key={`${path.channel}:${path.id}`} className="rounded border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <b>{path.channel}: {path.routeValue || [ ...(path.addressLines ?? []), path.cityState, path.postalCode ].filter(Boolean).join(', ')}</b>
                <span className="tag tone-ink">{path.freshnessStatus} · {path.permissionStatus} · {path.routeVerificationStatus ?? 'UNREVIEWED'}</span>
              </div>
              <p className="mt-1 text-muted-foreground">
                {path.sourceName} · record {path.sourceRecordId} · {path.classification} · {Math.round(path.confidence * 100)}% confidence · {path.supportingObservationCount ?? 1} observation(s)
              </p>
              <p className="text-xs text-muted-foreground">
                Recipient role: {path.recipientRole ?? 'UNKNOWN'} · identity {path.identityStatus ?? 'UNVERIFIED'} · signing authority {path.signingAuthorityStatus ?? 'NOT_ESTABLISHED'}
              </p>
              {path.providerId && <p className="text-xs text-muted-foreground" data-testid="contact-provider-evidence">
                Provider {path.providerId} · evidence {path.epistemicStatus ?? 'OBSERVED'} · provider permission assessment {path.permissionEvidenceStatus ?? 'UNKNOWN'} · legal basis {path.legalBasis ?? 'UNKNOWN'} · recipient identity evidence {path.recipientIdentityEvidenceStatus ?? 'NONE'}.
                {path.legalBasisScope ? ` Scope: ${path.legalBasisScope}` : ''}
              </p>}
              {path.sourceUrl && <a className="text-xs underline" href={path.sourceUrl} target="_blank" rel="noreferrer">Open source record</a>}
               {path.identityConflictStatus && path.identityConflictStatus !== 'NONE' && (
                 <p className="mt-1 text-xs text-destructive" data-testid="contact-identity-conflict">
                   Conflicting identity claims: {path.identityConflictStatus.replaceAll('_', ' ').toLowerCase()} · {path.recipientIdentityClaimCount ?? 0} claim(s). This blocks route selection.
                 </p>
               )}
               {path.rankingReasons?.length ? (
                 <ul className="mt-2 space-y-1 text-xs text-muted-foreground" data-testid="contact-ranking-reasons">
                   {path.rankingReasons.map(reason => <li key={reason}>{reason}</li>)}
                 </ul>
               ) : null}
               {path.supportingObservations && path.supportingObservations.length > 1 && (
                 <details className="mt-2 text-xs" data-testid="contact-supporting-observations">
                   <summary className="cursor-pointer font-medium">Source observations ({path.supportingObservations.length})</summary>
                   <ul className="mt-1 space-y-1">
                     {path.supportingObservations.map(observation => (
                       <li key={`${observation.sourceId}:${observation.sourceRecordId}:${observation.id}`}>
                         {observation.sourceName} · {observation.sourceRecordId} · {observation.recipient ?? 'recipient not stated'} ({observation.recipientRole}) · {observation.classification} · captured {new Date(observation.capturedAt).toLocaleDateString()}
                          {observation.providerId && ` · provider ${observation.providerId} · ${observation.epistemicStatus ?? 'OBSERVED'} · ${observation.legalBasis ?? 'legal basis unknown'} · permission evidence ${observation.permissionEvidenceStatus ?? 'unknown'}`}
                       </li>
                     ))}
                   </ul>
                 </details>
               )}
               {path.verificationNote && <p className="mt-1 text-xs">Review note: {path.verificationNote}</p>}
            </article>
          ))}
        </div>
      ) : <p className="rounded border border-border p-3 text-sm" data-testid="empty-contact-paths">No direct phone or email route is on file. A public mailing address is not a call route.</p>}
      {data.selectedPhonePath && <p className="border-l-2 border-signal pl-3 text-sm" data-testid="selected-contact-phone">
        Ranked phone route: <b>{data.selectedPhonePath.routeValue}</b> from {data.selectedPhonePath.sourceName}.
        {data.selectedPhonePath.rankingReasons?.[0] ? ` ${data.selectedPhonePath.rankingReasons[0]}` : ''}
        Confirm the person and authority in conversation; this is not a legal-identity check.
      </p>}
      <div className="border-t border-border pt-3">
        <p className="eyebrow mb-2">Record a route you already obtained</p>
         <p className="mb-3 text-xs text-muted-foreground">This is an evidence-intake form, not a search or outreach control. Phone, email, web/contact-form, other and postal evidence remain distinct. This system never submits a web form or sends messages. Public-source terms and intended-use permission must be checked before marking a route permitted. Only an owner can confirm validity or permission. Contact routes expire after 30 days unless re-observed.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Route type</Label><Select value={form.channel} onValueChange={v => set('channel')(v as typeof form.channel)} disabled={!canResearch || mutation.isPending}>
             <SelectTrigger data-testid="select-contact-channel"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="PHONE">Phone</SelectItem><SelectItem value="EMAIL">Email</SelectItem><SelectItem value="WEB">Web/contact form</SelectItem><SelectItem value="OTHER">Other</SelectItem></SelectContent>
          </Select></div>
           <div className="space-y-1.5"><Label>{form.channel === 'PHONE' ? 'Phone route' : form.channel === 'EMAIL' ? 'Email route' : form.channel === 'WEB' ? 'HTTPS web/contact-form URL' : 'Other route details'}</Label>
             <Input type={form.channel === 'PHONE' ? 'tel' : form.channel === 'EMAIL' ? 'email' : form.channel === 'WEB' ? 'url' : 'text'} value={form.routeValue} onChange={e => set('routeValue')(e.target.value)} disabled={!canResearch || mutation.isPending} data-testid="input-contact-route" /></div>
          <div className="space-y-1.5"><Label>Recipient name (if observed)</Label>
            <Input value={form.recipient} onChange={e => set('recipient')(e.target.value)} disabled={!canResearch || mutation.isPending} data-testid="input-contact-recipient" /></div>
          <div className="space-y-1.5"><Label>Reported recipient role</Label><Select value={form.recipientRole} onValueChange={v => set('recipientRole')(v as typeof form.recipientRole)} disabled={!canResearch || mutation.isPending}>
            <SelectTrigger data-testid="select-contact-role"><SelectValue /></SelectTrigger><SelectContent>{ROLE_OPTIONS.map(v => <SelectItem key={v} value={v}>{v.replaceAll('_', ' ')}</SelectItem>)}</SelectContent>
          </Select></div>
          <div className="space-y-1.5"><Label>Source type</Label><Select value={form.sourceType} onValueChange={v => set('sourceType')(v as typeof form.sourceType)} disabled={!canResearch || mutation.isPending}>
            <SelectTrigger data-testid="select-contact-source-type"><SelectValue /></SelectTrigger><SelectContent>{SOURCE_TYPES.map(v => <SelectItem key={v} value={v}>{v.replaceAll('_', ' ')}</SelectItem>)}</SelectContent>
          </Select></div>
          <div className="space-y-1.5"><Label>Confidence (0–1)</Label>
            <Input type="number" min="0" max="1" step="0.05" value={form.confidence} onChange={e => set('confidence')(e.target.value)} disabled={!canResearch || mutation.isPending} data-testid="input-contact-confidence" /></div>
          <div className="space-y-1.5"><Label>Source ID</Label>
            <Input value={form.sourceId} onChange={e => set('sourceId')(e.target.value)} placeholder="Connector or source identifier" disabled={!canResearch || mutation.isPending} data-testid="input-contact-source-id" /></div>
          <div className="space-y-1.5"><Label>Source name</Label>
            <Input value={form.sourceName} onChange={e => set('sourceName')(e.target.value)} disabled={!canResearch || mutation.isPending} data-testid="input-contact-source-name" /></div>
          <div className="space-y-1.5"><Label>Source record identity</Label>
            <Input value={form.sourceRecordId} onChange={e => set('sourceRecordId')(e.target.value)} disabled={!canResearch || mutation.isPending} data-testid="input-contact-source-record" /></div>
           <div className="space-y-1.5"><Label>When was this route observed?</Label>
             <Input type="datetime-local" value={form.capturedAt} onChange={e => set('capturedAt')(e.target.value)} disabled={!canResearch || mutation.isPending} data-testid="input-contact-observed-at" /></div>
          <div className="space-y-1.5"><Label>Source URL (HTTPS for public sources)</Label>
            <Input type="url" value={form.sourceUrl} onChange={e => set('sourceUrl')(e.target.value)} disabled={!canResearch || mutation.isPending} data-testid="input-contact-source-url" /></div>
          <div className="space-y-1.5"><Label>Contact-use permission</Label><Select value={form.permissionStatus} onValueChange={v => set('permissionStatus')(v as typeof form.permissionStatus)} disabled={!canResearch || mutation.isPending}>
            <SelectTrigger data-testid="select-contact-permission"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="NOT_REVIEWED">Not reviewed</SelectItem><SelectItem value="PERMITTED">Permitted (owner review)</SelectItem><SelectItem value="PROHIBITED">Prohibited (owner review)</SelectItem></SelectContent>
          </Select></div>
          <div className="space-y-1.5"><Label>Permission evidence URL (required when permitted)</Label>
            <Input type="url" value={form.contactPermissionEvidenceUrl} onChange={e => set('contactPermissionEvidenceUrl')(e.target.value)} disabled={!canResearch || mutation.isPending} data-testid="input-contact-permission-evidence" /></div>
          <div className="space-y-1.5"><Label>Route review</Label><Select value={form.routeVerificationStatus} onValueChange={v => set('routeVerificationStatus')(v as typeof form.routeVerificationStatus)} disabled={!canResearch || mutation.isPending}>
            <SelectTrigger data-testid="select-contact-review"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="UNREVIEWED">Unreviewed candidate</SelectItem><SelectItem value="CONFIRMED">Confirmed by owner review</SelectItem><SelectItem value="REJECTED">Rejected by owner review</SelectItem></SelectContent>
          </Select></div>
          <div className="space-y-1.5"><Label>Evidence note (required for confirm/reject)</Label>
            <Input value={form.verificationNote} onChange={e => set('verificationNote')(e.target.value)} disabled={!canResearch || mutation.isPending} data-testid="input-contact-review-note" /></div>
        </div>
        {localError && <p className="mt-3 text-sm text-destructive" role="alert" data-testid="text-contact-local-error">{localError}</p>}
        {mutation.isError && <div className="mt-3"><ErrorNotice error={mutation.error} /></div>}
        <Button className="mt-3" onClick={submit} disabled={!canResearch || mutation.isPending} data-testid="button-record-contact-route">
          {mutation.isPending ? 'Recording evidence…' : 'Record contact evidence'}
        </Button>
        {!canResearch && <p className="mt-2 text-xs text-muted-foreground">Only owners and analysts can record route evidence; owner decisions are required to confirm the route or its use permission.</p>}
      </div>
    </section>
  );
}
