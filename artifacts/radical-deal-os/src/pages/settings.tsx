import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getGetAssumptionsQueryKey, getListAuditQueryKey, useGetAssumptions, useUpdateAssumptions } from '@workspace/api-client-react';
import { PageHeader } from '@/components/page-header';
import { ErrorNotice, RowsSkeleton } from '@/components/state-views';
import { AssumptionsForm } from '@/components/assumptions-form';
import { MembersTable } from '@/components/members-table';
import { useAccess } from '@/hooks/use-access';
import { useInvalidateWork } from '@/hooks/use-invalidate';
import { useToast } from '@/hooks/use-toast';

type SetupState = {
  sourceTermsReviewedIds: string[];
  contactResearchMethod: 'NONE' | 'MANUAL' | 'PROVIDER';
  contactResearchProvider: string;
  emailProvider: 'NONE' | 'MANUAL' | 'SENDGRID' | 'MAILGUN' | 'TWILIO' | 'DOCUSIGN' | 'ADOBE_SIGN';
  smsProvider: 'NONE' | 'MANUAL' | 'SENDGRID' | 'MAILGUN' | 'TWILIO' | 'DOCUSIGN' | 'ADOBE_SIGN';
  signatureProvider: 'NONE' | 'MANUAL' | 'SENDGRID' | 'MAILGUN' | 'TWILIO' | 'DOCUSIGN' | 'ADOBE_SIGN';
  closingMode: 'MANUAL' | 'TITLE_PARTNER';
  closingPartnerName: string;
  states: string[];
  counties: string[];
  zipCodes: string[];
  notifications: { staleEvidence: boolean; callFollowups: boolean; contractDeadlines: boolean; providerFailures: boolean };
};
type SetupResponse = { setup: SetupState; sources: { id: string; name: string; coverage: string; termsUrl: string; status: string; detail: string; nextAction: string }[]; settings: { id: string; label?: string; provider: string; status: string; detail: string; nextAction: string }[] };
const setupQueryKey = ['/api/workspace-setup'];
async function fetchSetup(): Promise<SetupResponse> {
  const response = await fetch('/api/workspace-setup', { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Setup could not be loaded (${response.status}).`);
  return response.json();
}
async function saveSetup(data: SetupState): Promise<SetupState> {
  const response = await fetch('/api/workspace-setup', {
    method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? body.message ?? `Setup could not be saved (${response.status}).`);
  }
  return response.json();
}

function StatusTag({ status }: { status: string }) {
  const style = status === 'VERIFIED' ? 'bg-green-100 text-green-900' : status === 'INVALID' ? 'bg-red-100 text-red-900' : status === 'CONFIGURED' ? 'bg-blue-100 text-blue-900' : 'bg-amber-100 text-amber-900';
  return <span className={`inline-flex rounded px-2 py-1 text-xs font-semibold ${style}`}>{status}</span>;
}

function OperationalSetup({ isOwner }: { isOwner: boolean }) {
  const q = useQuery({ queryKey: setupQueryKey, queryFn: fetchSetup });
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState<SetupState>();
  const mutation = useMutation({
    mutationFn: saveSetup,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: setupQueryKey });
      toast({ title: 'Operational setup saved' });
    },
  });
  useEffect(() => { if (q.data) setDraft(q.data.setup); }, [q.data]);
  const update = (patch: Partial<SetupState>) => setDraft(value => value ? { ...value, ...patch } : value);
  const split = (value: string) => value.split(/[,\n]/).map(item => item.trim()).filter(Boolean);
  if (q.isLoading) return <section className="ledger p-4 text-sm">Loading setup status…</section>;
  if (q.isError || !q.data || !draft) return <section className="ledger p-4 text-sm" role="alert">Setup is unavailable: {(q.error as Error)?.message ?? 'No setup response.'} <button className="underline" onClick={() => void q.refetch()}>Retry</button></section>;
  const fieldClass = 'w-full rounded border bg-background px-3 py-2 text-sm';
  const labelClass = 'mb-1 block text-sm font-medium';
  return (
    <section className="space-y-5" data-testid="operational-setup">
      <div>
        <h2 className="mb-1 text-2xl font-semibold">Operational setup</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">Set workspace coverage and workflow preferences. A selection is not a connected provider: status changes to VERIFIED only after a real successful check. Never enter passwords or API keys here.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {q.data.settings.map(item => <article className="ledger p-4" key={item.id} data-testid={`setup-status-${item.id}`}>
          <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{item.label ?? item.id}</h3><StatusTag status={item.status} /></div>
          <p className="mt-2 text-sm text-muted-foreground">{item.detail}</p><p className="mt-2 text-xs"><b>Next:</b> {item.nextAction}</p>
        </article>)}
      </div>
      <div className="ledger space-y-5 p-4">
        <h3 className="text-lg font-semibold">Providers and operating methods</h3>
        <p className="text-xs text-muted-foreground">This form stores provider names only. Credentials must be added through workspace Secrets; this setup screen cannot verify or reveal them.</p>
        <div className="grid gap-4 md:grid-cols-2">
          <label><span className={labelClass}>Seller contact research</span><select className={fieldClass} value={draft.contactResearchMethod} disabled={!isOwner} onChange={e => update({ contactResearchMethod: e.target.value as SetupState['contactResearchMethod'] })}>
            <option value="NONE">Not configured</option><option value="MANUAL">Manual, permission-reviewed route capture</option><option value="PROVIDER">External provider (not connected)</option>
          </select></label>
          {draft.contactResearchMethod === 'PROVIDER' && <label><span className={labelClass}>Research provider name</span><input className={fieldClass} maxLength={80} value={draft.contactResearchProvider} disabled={!isOwner} onChange={e => update({ contactResearchProvider: e.target.value })} placeholder="Provider name only" /></label>}
          <label><span className={labelClass}>Email provider</span><select className={fieldClass} value={draft.emailProvider} disabled={!isOwner} onChange={e => update({ emailProvider: e.target.value as SetupState['emailProvider'] })}>
            <option value="NONE">Not configured</option><option value="SENDGRID">SendGrid (credentials and health check missing)</option><option value="MAILGUN">Mailgun (credentials and health check missing)</option>
          </select></label>
          <label><span className={labelClass}>Text messaging provider</span><select className={fieldClass} value={draft.smsProvider} disabled={!isOwner} onChange={e => update({ smsProvider: e.target.value as SetupState['smsProvider'] })}>
            <option value="NONE">Not configured</option><option value="TWILIO">Twilio (credentials and health check missing)</option>
          </select></label>
          <label><span className={labelClass}>Document/signature provider</span><select className={fieldClass} value={draft.signatureProvider} disabled={!isOwner} onChange={e => update({ signatureProvider: e.target.value as SetupState['signatureProvider'] })}>
            <option value="NONE">Not configured</option><option value="DOCUSIGN">DocuSign (credentials and health check missing)</option><option value="ADOBE_SIGN">Adobe Acrobat Sign (credentials and health check missing)</option>
          </select></label>
          <label><span className={labelClass}>Closing coordination</span><select className={fieldClass} value={draft.closingMode} disabled={!isOwner} onChange={e => update({ closingMode: e.target.value as SetupState['closingMode'] })}>
            <option value="MANUAL">Manual, evidence-linked tracking</option><option value="TITLE_PARTNER">Named title/closing partner</option>
          </select></label>
          {draft.closingMode === 'TITLE_PARTNER' && <label><span className={labelClass}>Title/closing partner name</span><input className={fieldClass} value={draft.closingPartnerName} disabled={!isOwner} maxLength={120} onChange={e => update({ closingPartnerName: e.target.value })} /></label>}
        </div>
      </div>
      <div className="ledger space-y-4 p-4">
        <h3 className="text-lg font-semibold">Permitted property sources</h3>
        <p className="text-sm text-muted-foreground">Open and review source terms before selecting. Selection records review only; it does not enable scraping or verify availability.</p>
        {q.data.sources.length === 0 && <p className="text-sm">No permitted source adapters are registered.</p>}
        <div className="grid gap-3 md:grid-cols-2">{q.data.sources.map(source => <label className="rounded border p-3" key={source.id}>
          <span className="flex items-start gap-2"><input type="checkbox" checked={draft.sourceTermsReviewedIds.includes(source.id)} disabled={!isOwner} onChange={e => update({ sourceTermsReviewedIds: e.target.checked ? [...draft.sourceTermsReviewedIds, source.id] : draft.sourceTermsReviewedIds.filter(id => id !== source.id) })} />
            <span><span className="font-medium">{source.name}</span> <StatusTag status={source.status} /><span className="mt-1 block text-xs text-muted-foreground">{source.coverage}</span>
              <a className="mt-1 inline-block text-xs underline" href={source.termsUrl} target="_blank" rel="noopener noreferrer">Review source terms</a>
              <span className="mt-1 block text-xs">{source.detail} Next: {source.nextAction}</span></span></span>
        </label>)}</div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="ledger space-y-3 p-4">
          <h3 className="text-lg font-semibold">Geographic coverage</h3>
          <label><span className={labelClass}>States (two-letter codes)</span><input className={fieldClass} value={draft.states.join(', ')} disabled={!isOwner} placeholder="PA, NJ" onChange={e => update({ states: split(e.target.value).map(v => v.toUpperCase()) })} /></label>
          <label><span className={labelClass}>Counties or cities</span><textarea className={fieldClass} rows={2} value={draft.counties.join(', ')} disabled={!isOwner} onChange={e => update({ counties: split(e.target.value) })} /></label>
          <label><span className={labelClass}>ZIP codes</span><textarea className={fieldClass} rows={2} value={draft.zipCodes.join(', ')} disabled={!isOwner} placeholder="19103, 19104" onChange={e => update({ zipCodes: split(e.target.value) })} /></label>
          <p className="text-xs text-muted-foreground">Coverage is used as workspace guidance. It does not establish legal authority or provider coverage.</p>
        </div>
        <div className="ledger space-y-3 p-4">
          <h3 className="text-lg font-semibold">Notifications</h3>
          {([
            ['staleEvidence', 'Stale property or buyer evidence'],
            ['callFollowups', 'Call follow-ups'],
            ['contractDeadlines', 'Contract deadlines'],
            ['providerFailures', 'Provider/setup failures'],
          ] as const).map(([key, title]) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.notifications[key]} disabled={!isOwner} onChange={e => update({ notifications: { ...draft.notifications, [key]: e.target.checked } })} />{title}</label>)}
          <p className="text-xs text-muted-foreground">These preferences are saved; actual notification delivery still depends on a verified channel.</p>
        </div>
      </div>
      {mutation.isError && <p role="alert" className="text-sm text-red-700">{(mutation.error as Error).message}</p>}
      {isOwner ? <button className="rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={mutation.isPending} onClick={() => mutation.mutate(draft)}>{mutation.isPending ? 'Saving…' : 'Save operational setup'}</button>
        : <p className="text-sm text-muted-foreground">Only the workspace owner can change setup.</p>}
    </section>
  );
}

export default function Settings() {
  const { isOwner, access } = useAccess();
  const qc = useQueryClient();
  const { toast } = useToast();
  const invalidate = useInvalidateWork();
  const q = useGetAssumptions({ query: { queryKey: getGetAssumptionsQueryKey(), staleTime: 30_000 } });
  const save = useUpdateAssumptions();
  return (
    <div className="space-y-10">
      <PageHeader eyebrow="Workspace" title="Settings" />
      <OperationalSetup isOwner={isOwner} />
      <section>
        <h2 className="mb-1 text-2xl font-semibold">Underwriting assumptions</h2>
        <p className="mb-4 max-w-2xl text-sm text-muted-foreground">These feed the deterministic engine. Changing them affects the next calculation of every lead. Past results keep the assumptions they used.</p>
        {q.isLoading && <RowsSkeleton rows={4} />}
        {q.isError && <ErrorNotice error={q.error} onRetry={() => q.refetch()} />}
        {q.data && (
          <AssumptionsForm value={q.data} canEdit={isOwner} pending={save.isPending} error={save.error}
            onSave={(a) => save.mutate({ data: a }, { onSuccess: (r) => { qc.setQueryData(getGetAssumptionsQueryKey(), r); qc.invalidateQueries({ queryKey: getListAuditQueryKey() }); invalidate(); toast({ title: 'Assumptions saved' }); } })} />
        )}
      </section>
      <section>
        <h2 className="mb-1 text-2xl font-semibold">Members</h2>
        <p className="mb-4 max-w-2xl text-sm text-muted-foreground">New sign-ins arrive as pending. Approve them by user ID. Owner: research and calls plus this page. Analyst: research and underwriting. Operator: calls. Viewer: read only.</p>
        {isOwner ? <MembersTable selfId={access.userId} /> : <p className="ledger p-4 text-sm text-muted-foreground" data-testid="text-members-owner-only">Only the owner can see or change membership.</p>}
      </section>
    </div>
  );
}
