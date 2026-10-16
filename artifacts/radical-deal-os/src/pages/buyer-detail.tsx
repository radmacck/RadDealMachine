import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { getGetBuyerQueryKey, getGetBuyerContactResearchQueryKey, useGetBuyerContactResearch, useGetBuyer, useUpdateBuyer, useVerifyBuyer, useRequestBuyerQualification, useCreateBuyerQualificationPortalInvite, useRecordBuyerContactPermission, type Buyer } from '@workspace/api-client-react';
import { ErrorNotice, RowsSkeleton } from '@/components/state-views';
import { BuyerForm } from '@/components/buyer-form';
import { BuyerVerificationForm } from '@/components/buyer-verification-form';
import { ApprovalTag, VerificationTag, isQualified } from '@/components/buyer-status';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EvidenceLink } from '@/components/field-row';
import { useAccess } from '@/hooks/use-access';
import { useInvalidateWork } from '@/hooks/use-invalidate';
import { useToast } from '@/hooks/use-toast';
import { fmtDate, money } from '@/lib/format';

const localDateTime = (value = new Date()) => new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
export default function BuyerDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const { canResearch, isOwner } = useAccess();
  const { toast } = useToast();
  const invalidate = useInvalidateWork();
  const [epoch, setEpoch] = useState(0);
  const q = useGetBuyer(id, { query: { queryKey: getGetBuyerQueryKey(id), enabled: !!id, staleTime: 5_000, refetchInterval: 20_000 } });
  const contactResearch = useGetBuyerContactResearch(id,{query:{queryKey:getGetBuyerContactResearchQueryKey(id),enabled:!!id,refetchInterval:20_000}});
  const contactData=contactResearch.data;
  const permissionHistory=contactData?.contactPermissionHistory??[];
  const update = useUpdateBuyer();
  const verify = useVerifyBuyer();
  const requestEvidence = useRequestBuyerQualification();
  const createProfileLink = useCreateBuyerQualificationPortalInvite();
  const saveContactPermission = useRecordBuyerContactPermission();
  const [requestNote, setRequestNote] = useState('');
  const [permissionSource, setPermissionSource] = useState('');
  const [permissionEvidence, setPermissionEvidence] = useState('');
  const [permissionCapturedAt, setPermissionCapturedAt] = useState(localDateTime());
  const [permissionChannel, setPermissionChannel] = useState<'EMAIL'|'SMS'|'VOICE'>('EMAIL');
  const [permissionStatus, setPermissionStatus] = useState<'GRANTED'|'OPTED_OUT'>('GRANTED');
  const [qualificationLink, setQualificationLink] = useState('');
  const [qualificationLinkExpiresAt, setQualificationLinkExpiresAt] = useState('');
  const [formBuyer,setFormBuyer] = useState<Buyer|null>(null);
  useEffect(()=>{if(q.data && formBuyer?.id!==q.data.id) setFormBuyer(q.data);},[q.data,formBuyer?.id]);

  if (q.isLoading) return <RowsSkeleton rows={6} />;
  if (q.isError || !q.data) return <div className="space-y-3"><Link href="/buyers" className="text-sm underline" data-testid="link-back-buyers">Back to buyers</Link><ErrorNotice error={q.error} onRetry={() => q.refetch()} /></div>;
  const b = q.data;
  const editing = formBuyer?.id===b.id ? formBuyer : b;
  const reloadForms = () => {setFormBuyer(b);setEpoch(e=>e+1);};
  const syntheticFixture=/^synthetic fixture:/i.test(b.source.trim());
  const permission=contactData?.contactPermission;
  const permissionFresh=!!permission&&permission.status==='GRANTED'&&permission.channels.length>0&&!!permission.validUntil&&
    Date.parse(permission.capturedAt)<=Date.now()&&Date.parse(permission.capturedAt)+30*86400000>Date.now()&&Date.parse(permission.validUntil)>Date.now();
  const buyerCurrent=b.destinationKind!=='DEAL_FINDER'&&b.destinationKind!=='GURU';
  const evidenceChecklist=[
    {label:'Identity',ready:b.verificationStatus==='VERIFIED'&&!!b.identityEvidenceUrl,detail:b.identityEvidenceUrl?'Independent identity evidence recorded.':'No reviewed identity evidence.',next:'Owner: review identity evidence and record the source, review date, and expiry.'},
    {label:'Current buy box',ready:b.approvalStatus==='APPROVED'&&!!b.criteriaEvidenceUrl,detail:`${b.criteria?.states.join(', ')||'No market'} · ${b.criteria?.propertyTypes.join(', ')||'no property types'} · ${b.criteria?money(b.criteria.minPurchasePrice)+'–'+money(b.criteria.maxPurchasePrice):'no price band'} · ${b.criteria?.rehabTolerance||'no condition tolerance'} · ${b.criteria?.closingDays??'no'} closing days.`,next:'Owner: compare target markets, property types, price band, condition, and timeline to current dated criteria evidence.'},
    {label:'Current buying intent',ready:b.currentBuyingStatus==='BUYING'&&b.approvalStatus==='APPROVED'&&!!b.buyingEvidenceUrl&&!!b.buyingEvidenceAt,detail:`${b.currentBuyingStatus??'UNKNOWN'} · evidence ${b.buyingEvidenceAt?fmtDate(b.buyingEvidenceAt):'missing'}.`,next:'Owner: confirm current buying status from dated evidence; account for any newer reply.'},
    {label:'Proof of funds/capacity',ready:!buyerCurrent||!!b.fundingEvidenceUrl&&!!b.availableFunds&&b.availableFunds>0&&!!b.verifiedFundingTypes?.length,detail:buyerCurrent?`${b.availableFunds?money(b.availableFunds):'No verified capacity'} · methods evidenced: ${b.verifiedFundingTypes?.join(', ')||'none'} · buyer-stated methods: ${(b.criteria?.fundingTypes??[]).join(', ')||'none'}.`:'Not applicable to this destination.',next:'Owner: review current proof and record the amount and methods it actually supports; preferences alone are not capacity.'},
    {label:'Contact permission · separate from qualification',ready:permissionFresh,detail:permission?`${permission.status} · ${permission.channels.join(', ')||'no channels'} · valid until ${permission.validUntil?fmtDate(permission.validUntil):'not set'}.`:'No permission evidence recorded.',next:'Owner: record current channel-specific permission or opt-out before outreach.'},
    {label:'Evidence expiration',ready:b.verificationStatus==='VERIFIED'&&!!b.validUntil&&Date.parse(b.validUntil)>Date.now(),detail:b.validUntil?`Verification expires ${fmtDate(b.validUntil)}.`:'No current expiry recorded.',next:'Reverify identity, criteria, current intent, and capacity before the evidence expires.'},
  ];

  return (
    <div className="space-y-6">
      <Link href="/buyers" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-buyers"><ArrowLeft className="h-4 w-4" />Buyers</Link>
      <header className="rise flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div><p className="eyebrow mb-2">Buyer / version {b.version}</p><h1 className="text-3xl font-semibold md:text-4xl" data-testid="text-buyer-name">{b.name}</h1>
          <p className="text-sm text-muted-foreground">{[b.email, b.phone].filter(Boolean).join(' / ') || 'no contact on file'} / source: {b.source}</p></div>
         <div className="flex gap-1.5">{syntheticFixture&&<span className="tag tone-stop" data-testid="tag-synthetic-buyer">SYNTHETIC FIXTURE · excluded</span>}<ApprovalTag buyer={b} /><VerificationTag buyer={b} /><span className="tag tone-ink">{b.status}</span></div>
      </header>

      <section className="ledger p-4" data-testid="panel-qualification-task">
        <p className="eyebrow mb-2">Qualification work</p>
        <p className="text-sm">Destination {(b.destinationKind ?? 'BUYER').replace('_', ' ').toLowerCase()} / current buying {(b.currentBuyingStatus ?? 'UNKNOWN').replace('_', ' ').toLowerCase()}{b.qualifiedDealFee != null ? ` / quoted fee ${money(b.qualifiedDealFee)}${b.feeTermsSource ? ` (${b.feeTermsSource})` : ''}` : ''}{b.confidence != null ? ` / confidence ${b.confidence}` : ''}</p>
        {(b.destinationKind ?? 'BUYER') !== 'BUYER' && <p className="mt-1 text-xs text-muted-foreground" data-testid="text-destination-fee-boundary">Any fee shown on this profile is a quote/reference only, not a received payment. Record evidenced terms and actual receipt, dispute, or waiver in the deal&apos;s destination activity history.</p>}
        {(b.qualificationBlockers ?? []).length > 0 && <ul className="mt-2 list-disc pl-4 text-sm" data-testid="list-blockers">{b.qualificationBlockers!.map((x, i) => <li key={i}>{x}</li>)}</ul>}
        {(b.qualificationBlockers ?? []).length === 0 && b.approvalStatus !== 'APPROVED' && <p className="mt-2 text-sm text-muted-foreground">No blockers listed; record verification to approve.</p>}
         <div className="mt-4 border-t border-border pt-3" data-testid="panel-buyer-verification-checklist">
           <p className="eyebrow mb-2">Reported profile vs. independent verification</p>
           <p className="mb-2 text-xs text-muted-foreground">The buy box is buyer-reported until an owner reviews dated criteria evidence. Contact permission is an independent outreach gate; it does not establish buyer identity or qualification.</p>
           <div className="grid gap-2 sm:grid-cols-2">{evidenceChecklist.map(step=><article key={step.label} className="border border-border p-2 text-xs">
             <p className="font-semibold">{step.label} · {step.ready?'CURRENT':'MISSING / REVIEW'}</p><p>{step.detail}</p>{!step.ready&&<p className="mt-1"><b>Next step:</b> {step.next}</p>}
           </article>)}</div>
           {b.criteriaEvidenceUrl&&<p className="mt-2 text-sm"><EvidenceLink url={b.criteriaEvidenceUrl} label="Owner-reviewed criteria evidence" /></p>}
         </div>
        {isOwner && <div className="mt-3 border-t border-border pt-3" data-testid="panel-buyer-profile-link">
          <p className="text-sm font-medium">Get current criteria from the buyer</p>
          <p className="mt-1 text-xs text-muted-foreground">Create a one-time link, then share it yourself through a permitted channel. Creating or copying it does not send a message. A response is self-reported and pauses matching approval until you review dated evidence.</p>
          <Button size="sm" variant="outline" className="mt-2" disabled={createProfileLink.isPending}
            onClick={() => createProfileLink.mutate({ id, data: { version: b.version } }, {
              onSuccess: (invite) => {
                const base = new URL(import.meta.env.BASE_URL, window.location.origin);
                const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
                const target = new URL(`${basePath}portal/buyer-qualification`, window.location.origin);
                target.hash = `t=${invite.token}`;
                setQualificationLink(target.toString());
                setQualificationLinkExpiresAt(invite.expiresAt);
                setFormBuyer({ ...b, version: b.version + 1 });
                setEpoch((e) => e + 1);
                invalidate();
                toast({ title: 'Private buyer link created', description: 'It expires in 14 days. No message was sent.' });
              },
            })}>{createProfileLink.isPending ? 'Creating link…' : 'Create buyer response link'}</Button>
          {createProfileLink.isError && <div className="mt-2"><ErrorNotice error={createProfileLink.error} /></div>}
          {qualificationLink && <div className="mt-3 space-y-2">
            <p className="text-xs">Expires {fmtDate(qualificationLinkExpiresAt)}. This link is shown once here; creating another replaces it.</p>
            <div className="flex flex-wrap gap-2">
              <Input readOnly value={qualificationLink} aria-label="Private buyer response link" data-testid="input-buyer-qualification-link" />
              <Button size="sm" variant="outline" onClick={async () => {
                if (!navigator.clipboard?.writeText) {
                  toast({ title: 'Copy unavailable', description: 'Select and copy the link field manually.', variant: 'destructive' });
                  return;
                }
                try {
                  await navigator.clipboard.writeText(qualificationLink);
                  toast({ title: 'Link copied', description: 'It was not sent.' });
                } catch {
                  toast({ title: 'Copy failed', description: 'Select and copy the link manually.', variant: 'destructive' });
                }
              }} data-testid="button-copy-buyer-qualification-link"><Copy className="mr-1.5 h-3.5 w-3.5" />Copy link</Button>
            </div>
          </div>}
        </div>}
        {b.qualificationTask && b.qualificationTask.state!=='COMPLETED' && <div className="mt-3 border-t border-border pt-3" data-testid="panel-task">
          <p className="text-sm"><span className="tag tone-muted mr-2">{b.qualificationTask.kind}</span><span className="tag tone-warn mr-2">{b.qualificationTask.state.replace(/_/g, ' ')}</span>{b.qualificationTask.reason}</p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">Due {fmtDate(b.qualificationTask.dueAt)} / updated {fmtDate(b.qualificationTask.updatedAt)}</p>
          <p className="eyebrow mt-3 mb-1">Prepared outreach (draft)</p>
          <p className="whitespace-pre-wrap border border-dashed border-border p-2 text-sm" data-testid="text-prepared-message">{b.qualificationTask.preparedMessage}</p>
           {b.qualificationTask.outreachReadiness && <div className="mt-3 rounded border border-border bg-background/60 p-3 text-sm" data-testid="panel-outreach-readiness">
             <p className="font-medium">Outreach: {b.qualificationTask.outreachReadiness.workflowState} · delivery: {b.qualificationTask.outreachReadiness.deliveryStatus.replace(/_/g, ' ')}</p>
             <p className="mt-1 text-xs text-muted-foreground">Contact route: {b.qualificationTask.outreachReadiness.contactRouteStatus.replace(/_/g, ' ').toLowerCase()} / permission: {b.qualificationTask.outreachReadiness.permissionStatus.replace(/_/g, ' ').toLowerCase()} / provider: {b.qualificationTask.outreachReadiness.providerStatus.replace(/_/g, ' ').toLowerCase()} / checked {fmtDate(b.qualificationTask.outreachReadiness.checkedAt)}</p>
             {!!b.qualificationTask.outreachReadiness.missingCapabilities.length && <ul className="mt-2 list-disc pl-4 text-xs" data-testid="list-outreach-blockers">{b.qualificationTask.outreachReadiness.missingCapabilities.map((item,i)=><li key={i}>{item}</li>)}</ul>}
             <p className="mt-2 text-xs" data-testid="text-outreach-next-action">{b.qualificationTask.outreachReadiness.nextAction}</p>
           </div>}
           <p className="mt-2 text-xs text-muted-foreground" data-testid="text-no-provider">The system has not sent this message. <Link href="/workers" className="underline">Review the pending handoff and record actual contact/reply evidence</Link>; owner-reviewed qualification remains separate.</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => { void navigator.clipboard?.writeText(b.qualificationTask!.preparedMessage).then(() => toast({ title: 'Message copied' }), () => toast({ title: 'Copy failed', variant: 'destructive' })); }} data-testid="button-copy-message"><Copy className="mr-1.5 h-3.5 w-3.5" />Copy text</Button>
          {b.qualificationTask.state === 'WAITING_REVIEW' && (isOwner || canResearch) && <div className="mt-3 space-y-2">
            <p className="text-xs text-muted-foreground">Review the reply through owner verification. If it lacks needed evidence, explicitly request another qualification handoff; no automatic resend occurs.</p>
            <input className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm" aria-label="Reason for additional evidence" placeholder="What evidence is still missing?" value={requestNote} onChange={e => setRequestNote(e.target.value)} />
            <Button size="sm" variant="outline" disabled={requestEvidence.isPending || requestNote.trim().length < 3} onClick={() => requestEvidence.mutate({ id, data: { version: b.version, note: requestNote.trim() } }, {
              onSuccess: (saved) => { setFormBuyer(saved); setEpoch(e => e + 1); invalidate(); setRequestNote(''); toast({ title: 'Additional evidence requested', description: 'A pending handoff was queued. Nothing was sent or approved.' }); },
            })}>Request additional evidence</Button>
            {requestEvidence.isError && <ErrorNotice error={requestEvidence.error} />}
          </div>}
        </div>}
        {isOwner && <div className="mt-4 grid gap-2 border-t border-border pt-3 sm:grid-cols-2" data-testid="panel-buyer-contact-permission">
          <p className="text-sm font-medium sm:col-span-2">Record contact permission or opt-out. Evidence is required; saving this never sends a message.</p>
          <Input aria-label="Permission evidence source" placeholder="Source / how permission was obtained" value={permissionSource} onChange={e=>setPermissionSource(e.target.value)} />
          <Input aria-label="Permission evidence URL" placeholder="Evidence URL" value={permissionEvidence} onChange={e=>setPermissionEvidence(e.target.value)} />
          <label className="grid gap-1 text-xs">When was permission observed?<Input type="datetime-local" value={permissionCapturedAt} onChange={e=>setPermissionCapturedAt(e.target.value)} /></label>
          <select className="h-9 border border-border bg-background px-2 text-sm" value={permissionStatus} onChange={e=>setPermissionStatus(e.target.value as 'GRANTED'|'OPTED_OUT')} aria-label="Permission status">
            <option value="GRANTED">Granted for selected channel</option><option value="OPTED_OUT">Opted out (all channels)</option>
          </select>
          <select className="h-9 border border-border bg-background px-2 text-sm" value={permissionChannel} onChange={e=>setPermissionChannel(e.target.value as 'EMAIL'|'SMS'|'VOICE')} aria-label="Permission channel">
            <option value="EMAIL">Email</option><option value="SMS">SMS</option><option value="VOICE">Voice</option>
          </select>
          <Button size="sm" variant="outline" className="sm:col-span-2" disabled={saveContactPermission.isPending || !permissionSource.trim() || !permissionEvidence.trim()}
            onClick={()=>{
              const capturedAt=new Date(permissionCapturedAt);
              if (!Number.isFinite(capturedAt.getTime()) || capturedAt.getTime() > Date.now()) {
                toast({title:'Invalid observation time',description:'Use a valid observed timestamp that is not in the future.',variant:'destructive'});
                return;
              }
              saveContactPermission.mutate({id,data:{version:b.version,status:permissionStatus,channels:permissionStatus==='GRANTED'?[permissionChannel]:[],
                source:permissionSource.trim(),evidenceUrl:permissionEvidence.trim(),capturedAt:capturedAt.toISOString(),
                validUntil:permissionStatus==='GRANTED'?new Date(capturedAt.getTime()+30*86400000).toISOString():null}},
                {onSuccess:()=>{invalidate();void contactResearch.refetch();toast({title:'Contact permission evidence saved',description:'No message was sent.'});setPermissionSource('');setPermissionEvidence('');}});
            }}>{saveContactPermission.isPending?'Saving…':permissionStatus==='GRANTED'?'Save permission evidence':'Save opt-out'}</Button>
          {saveContactPermission.isError && <div className="sm:col-span-2"><ErrorNotice error={saveContactPermission.error} /></div>}
        </div>}
      </section>
      {b.lastOutreachReplyAt && <section className="border border-border p-3 text-sm" data-testid="panel-latest-outreach-reply">
        Latest actual outreach reply: {fmtDate(b.lastOutreachReplyAt)}. A reply is not buyer approval; current buying evidence must account for this date.
        {b.lastOutreachReplyEvidenceUrl && <a className="ml-2 underline" href={b.lastOutreachReplyEvidenceUrl} target="_blank" rel="noopener noreferrer">Review reply evidence</a>}
      </section>}
      <section className="ledger space-y-3 p-4" data-testid="panel-buyer-contact-research">
        <p className="eyebrow">Contact research status</p>
        <p className="text-sm">Profile routes are not property facts. Source: {b.source || 'not recorded'}; observed {contactResearch.data?.contactObservedAt ? fmtDate(contactResearch.data.contactObservedAt) : 'not recorded'}; confidence {contactResearch.data?.contactConfidence == null ? 'not recorded' : `${Math.round(contactResearch.data.contactConfidence*100)}%`}.</p>
        {contactResearch.data?.contactSourceUrl && <a className="text-sm underline" href={contactResearch.data.contactSourceUrl} target="_blank" rel="noopener noreferrer">Review contact source evidence</a>}
        {contactResearch.data?.contactPermission && <p className="text-sm" data-testid="buyer-contact-permission-current">
          Permission: {contactResearch.data.contactPermission.status} ({contactResearch.data.contactPermission.channels.join(', ') || 'all channels'}) · observed {fmtDate(contactResearch.data.contactPermission.capturedAt)} · valid until {contactResearch.data.contactPermission.validUntil ? fmtDate(contactResearch.data.contactPermission.validUntil) : 'not applicable'}
        </p>}
        {permissionHistory.length>0&&<details className="text-xs"><summary>Permission history ({permissionHistory.length})</summary>
          {permissionHistory.map((entry,index)=><p key={`${entry.reviewedAt}-${index}`}>{entry.status} · {entry.channels.join(', ')||'all channels'} · {fmtDate(entry.capturedAt)} · {entry.source}</p>)}</details>}
        <p className="text-sm">Identity: {b.verificationStatus.replaceAll('_',' ').toLowerCase()} · route does not establish recipient identity or consent.</p>
        <p className="text-xs text-muted-foreground">Consent is separate from route provenance and buyer identity. The owner-only evidence form below stores channel, source, observed time, review time, and expiry; it never sends a message.</p>
        <p className="border-l-2 border-signal pl-3 text-sm" data-testid="buyer-contact-next-action">
          {contactResearch.data?.nextAction ?? 'Loading current contact research…'}
        </p>
      </section>
      {b.qualificationPortalSelfReport && <section className="ledger border-l-4 border-l-signal p-4" data-testid="panel-buyer-self-report">
        <p className="eyebrow mb-2">Buyer self-report · INDICATED · not verified</p>
        <p className="text-sm">Received {fmtDate(b.qualificationPortalSelfReport.receivedAt)} through invitation {b.qualificationPortalSelfReport.invitationId}. The link does not prove who responded or grant contact permission.</p>
        <p className="mt-2 text-sm">Declared current buying status: {b.qualificationPortalSelfReport.currentBuyingStatus.replace(/_/g, ' ')}. Owner review of current identity, activity, criteria and funding evidence is required. Matching approval was cleared.</p>
        {!!b.qualificationPortalSelfReport.note && <p className="mt-2 whitespace-pre-wrap text-sm">{b.qualificationPortalSelfReport.note}</p>}
      </section>}

      {b.discoveryEvidence && <section className="ledger p-4 text-sm" data-testid="panel-discovery-evidence">
        <p className="eyebrow mb-2">Observed discovery evidence — not buying approval</p>
        <p>{b.discoveryEvidence.source}</p><p className="font-mono text-xs text-muted-foreground">Captured {fmtDate(b.discoveryEvidence.capturedAt)} / source confidence {b.discoveryEvidence.confidence}</p>
        <EvidenceLink url={b.discoveryEvidence.sourceUrl} label="Original discovery source" />
      </section>}
      {!!b.sourceObservations?.length && <section className="ledger p-4" data-testid="panel-buyer-source-observations">
        <p className="eyebrow mb-1">Public-source history · not buyer approval</p>
        <p className="mb-3 text-xs text-muted-foreground">These records explain why the entity was discovered. They do not establish current intent, identity, funding, criteria, or matching eligibility.</p>
        <div className="space-y-3">{[...b.sourceObservations].sort((a,b)=>Date.parse(b.lastObservedAt)-Date.parse(a.lastObservedAt)).map((source)=>(
          <article key={source.sourceId} className="border-t border-border pt-2 text-sm">
            <p className="font-medium">{source.source}</p>
            <p>{source.statement}</p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">Record IDs: {source.recordIdentities.length ? source.recordIdentities.join(', ') : 'none supplied'} / source activity count {source.activityCount}{source.eventAt ? ` / latest source event ${fmtDate(source.eventAt)}` : ''}</p>
            <p className="font-mono text-[11px] text-muted-foreground">First observed {fmtDate(source.firstObservedAt)} / last observed {fmtDate(source.lastObservedAt)} / {source.seenCount} captures / confidence {source.confidence}</p>
            <EvidenceLink url={source.sourceUrl} label="Source dataset and terms" />
            {!!source.history.length && <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-muted-foreground">Prior source versions ({source.history.length})</summary>
              <ul className="mt-1 space-y-1 pl-3">
                {source.history.map((prior, index) => <li key={`${prior.capturedAt}-${index}`}>
                  {fmtDate(prior.capturedAt)} · {prior.activityCount} public transaction(s) · {prior.recordIdentities.join(', ') || 'no record IDs'} · confidence {prior.confidence}{prior.eventAt ? ` · latest event ${fmtDate(prior.eventAt)}` : ''}
                </li>)}
              </ul>
            </details>}
          </article>
        ))}</div>
      </section>}
      <section className={`ledger border-l-4 p-4 ${isQualified(b) ? 'border-l-signal' : 'border-l-border'}`} data-testid="panel-buyer-qualification">
        <p className="eyebrow mb-2">Qualification</p>
        {b.verificationStatus === 'UNVERIFIED' && <p className="text-sm">Discovery is not approval. This profile is excluded from eligible matching until current buying, criteria and required evidence are reviewed.</p>}
        {b.verificationStatus === 'STALE' && <p className="text-sm">Verification expired {fmtDate(b.validUntil)}. Re-review the evidence before this buyer can commit.</p>}
        {b.verificationStatus === 'VERIFIED' && <p className="text-sm">Reviewed by {b.verifiedBy} on {fmtDate(b.verifiedAt)}. {b.destinationKind==='BUYER' ? `Funds reviewed ${money(b.availableFunds)}.` : 'Destination review is not acquisition funding assurance.'} Valid until {fmtDate(b.validUntil)}. Current matching also requires approved buying and criteria evidence.</p>}
        <p className="mt-2 text-sm" data-testid="text-verified-funding">Verified funding methods: {b.verifiedFundingTypes?.length ? b.verifiedFundingTypes.map((t) => t.replace(/_/g, ' ')).join(', ') : 'none recorded'}. Criteria methods: {b.criteria?.fundingTypes?.length ? b.criteria.fundingTypes.map((t) => t.replace(/_/g, ' ')).join(', ') : 'none stated'}. {b.verifiedFundingTypes?.includes('CASH') && b.criteria?.fundingTypes?.includes('CASH') ? 'CASH is in both, so native matching can use this buyer.' : 'Native matching requires CASH in both lists; other methods are excluded pending financing adapters.'}</p>
        {b.verificationNote && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{b.verificationNote}</p>}
        <p className="mt-2 flex gap-4 text-sm"><EvidenceLink url={b.identityEvidenceUrl} label="Identity evidence" /><EvidenceLink url={b.fundingEvidenceUrl} label="Funding evidence" /><EvidenceLink url={b.buyingEvidenceUrl} label="Buying evidence" /><EvidenceLink url={b.criteriaEvidenceUrl} label="Criteria evidence" /></p>
        {b.evidenceAt && <p className="font-mono text-[11px] text-muted-foreground">Evidence captured {fmtDate(b.evidenceAt)}</p>}
      </section>

      {!!b.verificationHistory?.length && <section className="ledger p-4" data-testid="panel-verification-history">
        <p className="eyebrow mb-3">Preserved verification history</p>
        <div className="space-y-3">{[...b.verificationHistory].reverse().map((h,i)=><details key={`${h.reviewedAt}:${i}`} className="border-t border-border pt-2">
          <summary className="cursor-pointer text-sm">{fmtDate(h.reviewedAt)} / {h.currentBuyingStatus} / {h.destinationKind??'BUYER'}</summary>
          <p className="mt-2 text-sm">{h.verificationSource} — {h.verificationNote}</p>
          <p className="text-xs text-muted-foreground">Reviewer {h.reviewedBy}; confidence {h.confidence}; buying evidence {fmtDate(h.buyingEvidenceAt)}; valid until {fmtDate(h.validUntil)}</p>
          <p className="mt-1 flex flex-wrap gap-3 text-sm"><EvidenceLink url={h.buyingEvidenceUrl} label="Buying evidence" /><EvidenceLink url={h.criteriaEvidenceUrl} label="Reviewed criteria" /><EvidenceLink url={h.fundingEvidenceUrl} label="Funding evidence" /></p>
          {h.criteria && <p className="mt-2 text-xs">Reviewed buy box: {h.criteria.states.join(', ')}; {h.criteria.propertyTypes.join(', ')}; up to {money(h.criteria.maxPurchasePrice)}; {h.criteria.minUnits}–{h.criteria.maxUnits} units.</p>}
        </details>)}</div>
      </section>}
      {editing.version!==b.version && <div className="ledger p-3 text-sm" data-testid="text-buyer-changed">This profile changed while you were editing. Unsaved input is preserved; saving the old version will be rejected. <Button variant="outline" size="sm" onClick={reloadForms}>Reload forms (discard unsaved input)</Button></div>}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="ledger p-4" data-testid="panel-buyer-criteria">
          <p className="eyebrow mb-3">Contact, destination and buy box</p>
          <BuyerForm key={`${b.id}:${epoch}`} buyer={editing?{...editing,...(contactResearch.data??{})}:editing} disabled={!canResearch} submitLabel="Save buyer" pending={update.isPending} error={update.error} onCancel={reloadForms}
            onSubmit={(data) => update.mutate({ id, data: { ...data, version: editing.version } }, { onSuccess: (saved) => { setFormBuyer(saved);invalidate(); setEpoch((e) => e + 1); toast({ title: 'Buyer saved', description: 'Matching queued against open deals.' }); } })} />
        </section>
        <section className="ledger h-fit p-4" data-testid="panel-buyer-verification">
          <p className="eyebrow mb-3">Human verification</p>
          <BuyerVerificationForm key={`${b.id}:${epoch}`} buyer={editing} disabled={!isOwner} pending={verify.isPending} error={verify.error}
            onSubmit={(data, done) => verify.mutate({ id, data }, { onSuccess: (saved) => {setFormBuyer(saved);setEpoch(e=>e+1);invalidate(); done(); toast({ title: 'Verification recorded' }); } })} />
        </section>
      </div>
    </div>
  );
}
