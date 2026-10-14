import { useState } from 'react';
import { Link } from 'wouter';
import { Download, FileText, RefreshCw } from 'lucide-react';
import {
  getGetDealOperationsQueryKey, useCreateContract, useExecuteContract, useGetDealOperations, useGetTransactionDocumentReadiness, usePreparePurchaseReviewDocument, useTransitionTransactionDocument, useRecordBuyerResponse, useRecordDestinationActivity,
  useCreateClauseReviewRequest, useGetClauseReviewRequests,
  useRecordClosingMilestone, useRecordDealOutcome, useRecordTransactionDeadlineSchedule, useRecordTransactionException, useRefreshMatches,
  type BuyerMatch, type BuyerResponseInputStatus, type ClosingMilestoneInputKind, type ClosingMilestoneInputEvidenceKind,
  type TransactionMilestoneDeadlineItemKind, type TransactionMilestoneDeadlineItemDisposition, type DealContract, type DealOutcomeInputOutcome,
  type DestinationActivityEvent, type DestinationActivityInputKind, type TransactionExceptionInputKind, type LeadDetail,
} from '@workspace/api-client-react';
import { ErrorNotice, RowsSkeleton } from '@/components/state-views';
import { EvidenceLink, Field, SELECT } from '@/components/field-row';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAccess } from '@/hooks/use-access';
import { useInvalidateWork } from '@/hooks/use-invalidate';
import { useToast } from '@/hooks/use-toast';
import { ago, fmtDate, fromLocalInput, isOverdue, money, num, toLocalInput } from '@/lib/format';
import { DistributionPanel } from '@/components/distribution-panel';

const MILESTONES: { k: ClosingMilestoneInputKind; label: string }[] = [
  { k: 'TITLE_CLEARED', label: 'Title cleared' }, { k: 'INSPECTION_COMPLETED', label: 'Inspection completed' },
  { k: 'EARNEST_MONEY_CONFIRMED', label: 'Earnest money confirmed' },
  { k: 'ASSIGNMENT_SIGNED', label: 'Assignment signed' }, { k: 'FUNDS_CONFIRMED', label: 'Funds confirmed' },
];
const CLAUSE_CATEGORIES = ['ASSIGNMENT','INSPECTION','ACCESS','EARNEST_MONEY','CLOSING','TITLE','DEFAULT_REMEDIES','OTHER'] as const;
const CLAUSE_TERMS = [...CLAUSE_CATEGORIES.slice(0,7),'PRICE','OTHER'] as const;
const CLAUSE_SCOPES = ['SELLER','BUYER','BOTH','INTERNAL_REVIEW'] as const;
const requiredMilestones = (contract: DealContract) =>
  MILESTONES.filter((m) =>
    (m.k !== 'EARNEST_MONEY_CONFIRMED' || contract.earnestMoney > 0) &&
    (m.k !== 'INSPECTION_COMPLETED' || contract.deadlineSchedule?.items.find((item) => item.kind === m.k)?.disposition !== 'NOT_APPLICABLE' &&
      contract.deadlineSchedule?.items.some((item) => item.kind === m.k)));
const STATUS_TONE: Record<DealContract['status'], string> = { DRAFT: 'tone-warn', UNDER_CONTRACT: 'tone-go', CLOSING: 'tone-signal', CLOSED: 'tone-ink', CANCELLED: 'tone-stop' };
const STATUS_LABEL: Record<DealContract['status'], string> = { DRAFT: 'Draft, not under contract', UNDER_CONTRACT: 'Under contract', CLOSING: 'Closing', CLOSED: 'Closed', CANCELLED: 'Cancelled' };

function Block({ title, children, tid }: { title: string; children: React.ReactNode; tid: string }) {
  return <section className="ledger p-4" data-testid={tid}><p className="eyebrow mb-3">{title}</p>{children}</section>;
}

function CreateContract({ detail, onDone }: { detail: LeadDetail; onDone: () => void }) {
  const { canCall, isOwner } = useAccess();
  const create = useCreateContract();
  const { toast } = useToast();
  const offer = detail.offers.find((o) => o.effectiveStatus === 'COMMUNICATED');
  const [at, setAt] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  if (!offer) return <p className="text-sm text-muted-foreground" data-testid="text-contract-blocked">Blocked: a contract can only be drafted from the current offer that was recorded as communicated to the seller. Record that on the Offers tab or from the call screen first.</p>;
  const submit = () => {
    const iso = fromLocalInput(at);
    if (!iso || new Date(iso).getTime() <= Date.now()) return setLocal('Choose a future closing date.');
    if (new Date(iso).getTime() > Date.now() + offer.closingDays * 86_400_000) return setLocal(`Closing cannot be more than ${offer.closingDays} days out, the limit in the approved offer.`);
    setLocal(null);
    create.mutate({ id: detail.lead.id, data: { version: detail.lead.version, offerId: offer.id, closingAt: iso } }, { onSuccess: () => { onDone(); toast({ title: 'Contract drafted', description: 'It is not under contract until executed evidence is recorded.' }); } });
  };
  return (
    <div className="space-y-3" data-testid="form-create-contract">
      <p className="text-sm">Drafting copies the communicated offer exactly: {money(offer.amount)} price, {money(offer.earnestMoney)} deposit, {offer.assignmentIntent ? 'assignment intended' : 'no assignment'}, contingencies as approved. Terms cannot be edited afterwards.</p>
      <Field label="Closing date" hint={`At most ${offer.closingDays} days from today`}><Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} disabled={!(canCall || isOwner)} data-testid="input-contract-closing" /></Field>
      {local && <p className="text-sm text-destructive">{local}</p>}
      {create.error != null && <ErrorNotice error={create.error} />}
      <Button disabled={!(canCall || isOwner) || create.isPending} onClick={submit} data-testid="button-create-contract">{create.isPending ? 'Drafting...' : 'Draft contract record'}</Button>
    </div>
  );
}

function PurchaseReviewDocuments({ contract, onDone }: { contract: DealContract; onDone: () => void }) {
  const { canCall, isOwner } = useAccess();
  const prepare = usePreparePurchaseReviewDocument();
  const transition = useTransitionTransactionDocument();
  const readiness = useGetTransactionDocumentReadiness({ leadId: contract.leadId });
  const { toast } = useToast();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [documentReasons, setDocumentReasons] = useState<Record<string, string>>({});
  const [clauseCategory, setClauseCategory] = useState<(typeof CLAUSE_CATEGORIES)[number]>('OTHER');
  const [clausePurpose, setClausePurpose] = useState('');
  const [clauseText, setClauseText] = useState('');
  const [clauseTerms, setClauseTerms] = useState<(typeof CLAUSE_TERMS)[number]>('OTHER');
  const [clauseScope, setClauseScope] = useState<(typeof CLAUSE_SCOPES)[number]>('INTERNAL_REVIEW');
  const [clauseSourceRef, setClauseSourceRef] = useState('');
  const [clauseConflicts, setClauseConflicts] = useState('');
  const clauseRequests = useGetClauseReviewRequests(contract.leadId);
  const createClauseRequest = useCreateClauseReviewRequest();
  const documents = contract.documents ?? [];
  const currentAttempt = contract.attemptNumber ?? 1;
  const preparedReviewCopy = documents.find((document) =>
    document.kind === 'PURCHASE_TERMS_REVIEW' && document.attemptNumber === currentAttempt
      && document.status === 'PREPARED_FOR_REVIEW');
  const signedEvidenceRecorded = Boolean(
    contract.executedDocumentUrl && contract.sellerSignedAt && contract.acquisitionSignedAt,
  );
  const earnestEvidence = contract.milestones.find((milestone) => milestone.kind === 'EARNEST_MONEY_CONFIRMED');
  const deadlineSchedule = contract.deadlineSchedule;
  const createReviewCopy = () => prepare.mutate(
    { id: contract.leadId, data: { version: contract.version } },
    {
      onSuccess: () => {
        onDone();
        toast({ title: 'Review PDF prepared', description: 'The fillable PDF is saved as a terms snapshot. It is not a legal contract or signature.' });
      },
    },
  );
  const transitionDocument = (documentId: string, targetStatus: 'REJECTED' | 'VOID') => {
    const reason = documentReasons[documentId]?.trim() ?? '';
    if (reason.length < 10) return;
    transition.mutate(
      { id: contract.leadId, documentId, data: { version: contract.version, targetStatus, reason } },
      { onSuccess: () => { onDone(); toast({ title: `Document ${targetStatus.toLowerCase()}`, description: 'The lifecycle event is recorded; no signature or delivery is implied.' }); } },
    );
  };
  const downloadReviewCopy = async (documentId: string, fileName: string, url: string) => {
    setDownloading(documentId);
    setDownloadError(null);
    try {
      const response = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/pdf' } });
      if (!response.ok) {
        let message = `Download failed (${response.status}).`;
        try {
          const body = await response.json() as { message?: string; error?: string };
          message = body.message || body.error || message;
        } catch { /* keep the HTTP status message */ }
        throw new Error(message);
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = window.document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Could not retrieve this review copy.');
    } finally {
      setDownloading(null);
    }
  };

  const submitClauseRequest = () => {
    if (!readiness.data?.jurisdiction || clausePurpose.trim().length < 10) return;
    createClauseRequest.mutate({ id: contract.leadId, data: {
      idempotencyKey: crypto.randomUUID(), category: clauseCategory, purpose: clausePurpose.trim(),
      jurisdiction: readiness.data.jurisdiction, partyScope: clauseScope,
      affectedTerms: [clauseTerms], ...(clauseText.trim() ? { proposedText: clauseText.trim() } : {}),
      ...(clauseSourceRef.trim() ? { sourceTemplateRef: clauseSourceRef.trim() } : {}),
      ...(clauseConflicts.trim() ? { conflictsWith: clauseConflicts.split('\n').map(item => item.trim()).filter(Boolean) } : {}),
    } }, { onSuccess: () => {
      setClausePurpose(''); setClauseText(''); setClauseSourceRef(''); setClauseConflicts(''); void clauseRequests.refetch();
      toast({ title: 'Clause review request recorded', description: 'It remains unreviewed and was not added to a contract or packet.' });
    } });
  };
  return <section className="space-y-3 border-t border-border pt-4" data-testid="panel-purchase-review-documents">
    <div className="rounded border border-border p-3" data-testid="panel-contract-readiness-tracker">
      <h3 className="text-sm font-semibold">Contract readiness · attempt {currentAttempt} · version {contract.version}</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Locked terms from offer {contract.offerId}: purchase {money(contract.purchasePrice)} · earnest money {money(contract.earnestMoney)} · assignment {contract.assignmentAllowed ? money(contract.assignmentTarget) : 'not authorized'}.
        This snapshot is not editable here.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="border-l-2 border-signal pl-2 text-xs">
          <b>Legal template review</b>
          <p>{readiness.isLoading ? 'Loading jurisdiction and template evidence…'
            : readiness.isError ? 'Unavailable; do not infer legal approval.'
              : readiness.data?.canSendLegalDocuments ? 'Readiness checks passed for the currently approved template set.'
                : `${readiness.data?.templates.filter((item) => item.status !== 'APPROVED_LEGAL').length ?? 'Unknown'} required template(s) remain unapproved or unavailable.`}</p>
        </div>
        <div className="border-l-2 border-signal pl-2 text-xs">
          <b>Document preparation</b>
          <p>{preparedReviewCopy
            ? `Review worksheet ${preparedReviewCopy.id} prepared at ${fmtDate(preparedReviewCopy.generatedAt)}. It is not a legal contract or signature request.`
            : 'No current-attempt review worksheet is prepared. Missing approved templates still block a sendable legal document.'}</p>
        </div>
        <div className="border-l-2 border-warn pl-2 text-xs">
          <b>Buyer terms</b>
          <p>{contract.committedBuyerId && contract.agreedBuyerPrice != null
            ? `Owner-reviewed buyer commitment recorded for buyer ${contract.committedBuyerId} at ${money(contract.agreedBuyerPrice)}. Assignment signature remains a separate milestone.`
            : 'No owner-reviewed buyer commitment is recorded. A match or interest response is not buyer approval, signature, or commitment.'}</p>
        </div>
        <div className="border-l-2 border-warn pl-2 text-xs">
          <b>Signature request</b>
          <p>{readiness.data?.signingProvider.status === 'CONNECTED'
            ? 'Provider is connected, but no request is treated as sent without a persisted provider receipt.'
            : readiness.data?.signingProvider.status === 'NOT_CONNECTED'
              ? 'NOT_CONNECTED · no signature request was sent. Signatures are recorded only from independently reviewed evidence.'
              : 'Provider status is unavailable; no signature request or delivery is claimed.'}</p>
        </div>
        <div className="border-l-2 border-warn pl-2 text-xs">
          <b>Executed signatures</b>
          <p>{signedEvidenceRecorded
            ? `Both party timestamps and executed-document evidence are recorded: seller ${fmtDate(contract.sellerSignedAt!)} · acquisition ${fmtDate(contract.acquisitionSignedAt!)}.`
            : 'Not recorded as complete. A prepared worksheet, click, or provider connection is not signature evidence.'}</p>
        </div>
        <div className="border-l-2 border-warn pl-2 text-xs">
          <b>Earnest money</b>
          <p>{contract.earnestMoney <= 0
            ? 'Not required by the locked terms.'
            : earnestEvidence
              ? `${money(earnestEvidence.amount ?? 0)} evidence recorded at ${fmtDate(earnestEvidence.effectiveAt ?? earnestEvidence.recordedAt)} · ${earnestEvidence.evidenceKind?.replaceAll('_', ' ') ?? 'evidence type not recorded'}.`
              : `${money(contract.earnestMoney)} required by the locked terms; no confirmed evidence is recorded.`}</p>
          {earnestEvidence?.evidenceUrl && <EvidenceLink url={earnestEvidence.evidenceUrl} label="earnest-money evidence" />}
        </div>
        <div className="border-l-2 border-warn pl-2 text-xs">
          <b>Closing deadlines</b>
          <p>{deadlineSchedule
            ? `Reviewed schedule v${deadlineSchedule.version} · ${deadlineSchedule.items.filter((item) => item.disposition === 'DUE_DATE').length} dated milestone(s) · source ${deadlineSchedule.sourceEvidenceUrl}.`
            : 'No current owner-reviewed milestone schedule is recorded; review title, inspection, earnest-money, assignment, and funds dates against the executed terms.'}</p>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Special clauses remain review-only until a qualified reviewer approves the jurisdiction-compatible language. No legal approval, signature request, transfer, or closing is inferred.
      </p>
    </div>
    <div className="flex items-start gap-3">
      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
      <div>
        <h3 className="text-sm font-semibold">Purchase terms review PDF</h3>
        <p className="mt-1 text-xs text-muted-foreground">Creates a persisted, fillable copy of the exact authorized terms, with unverified or missing legal details left blank. This worksheet is not a contract and cannot be signed here.</p>
      </div>
    </div>
    {readiness.error && <ErrorNotice error={readiness.error} />}
    {readiness.data && !readiness.data.canSendLegalDocuments && <div className="border border-signal/40 bg-signal/5 p-3 text-xs" role="status" data-testid="transaction-document-readiness">
      <p className="font-semibold">Legal transaction documents are not ready to send or sign.</p>
      <p className="mt-1 text-muted-foreground">
        {readiness.data.jurisdiction
          ? `Checklist scope from this property's saved location: ${readiness.data.jurisdiction}. Legal applicability still requires approved local templates. `
          : 'Open a deal with a saved property location to evaluate jurisdiction-specific requirements. '}
        {readiness.data.templates.filter((item) => item.status === 'MISSING_APPROVED_TEMPLATE').length} approved jurisdiction-specific templates are missing.
        {` `}{readiness.data.signingProvider.status === 'NOT_CONNECTED' ? 'No signing provider is connected.' : ''}
        {` `}{readiness.data.storage.status === 'PRIVATE_FILE_STORE_UNAVAILABLE' ? 'Private file storage is unavailable; review-copy bytes use the protected database fallback.' : ''}
      </p>
      {readiness.data.templates.some((item) => item.status === 'MISSING_APPROVED_TEMPLATE') && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground" data-testid="list-missing-jurisdiction-templates">
          {readiness.data.templates.filter((item) => item.status === 'MISSING_APPROVED_TEMPLATE').map((item) => (
            <li key={`${item.key}:${item.jurisdiction}`}>
              {item.documentKind.replaceAll('_', ' ')} · {item.jurisdiction}: {item.missingReason}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-muted-foreground">Next: provide approved templates, configure private file storage, and connect a signing provider. The worksheet below is not a contract and cannot be signed here.</p>
    </div>}
    <div className="space-y-2 border border-border p-3" data-testid="panel-clause-review-requests">
      <h4 className="text-sm font-semibold">Special clause / addendum review</h4>
      <p className="text-xs text-muted-foreground">Owner-entered request only. Proposed text is unreviewed; no clause is generated, approved, or inserted here. Jurisdiction-approved templates and qualified review are required.</p>
      {isOwner && <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Clause category"><select className={SELECT} value={clauseCategory} onChange={e => setClauseCategory(e.target.value as typeof clauseCategory)} data-testid="select-clause-category">
          {CLAUSE_CATEGORIES.map(v => <option key={v} value={v}>{v.replaceAll('_',' ')}</option>)}
        </select></Field>
        <Field label="Affected term"><select className={SELECT} value={clauseTerms} onChange={e => setClauseTerms(e.target.value as typeof clauseTerms)} data-testid="select-clause-term">
          {CLAUSE_TERMS.map(v => <option key={v} value={v}>{v.replaceAll('_',' ')}</option>)}
        </select></Field>
        <Field label="Party scope"><select className={SELECT} value={clauseScope} onChange={e => setClauseScope(e.target.value as typeof clauseScope)} data-testid="select-clause-party-scope">
          {CLAUSE_SCOPES.map(v => <option key={v} value={v}>{v.replaceAll('_',' ')}</option>)}
        </select></Field>
        <Field label="Template/source reference (not approval)"><Input value={clauseSourceRef} onChange={e => setClauseSourceRef(e.target.value)} maxLength={500} data-testid="input-clause-source-reference" /></Field>
        <Field label="Purpose / issue"><Textarea value={clausePurpose} onChange={e => setClausePurpose(e.target.value)} maxLength={2000} data-testid="input-clause-purpose" /></Field>
        <Field label="Optional owner-supplied proposed text (unreviewed)"><Textarea value={clauseText} onChange={e => setClauseText(e.target.value)} maxLength={5000} data-testid="input-clause-proposed-text" /></Field>
        <Field label="Known conflicts with existing clauses"><Textarea value={clauseConflicts} onChange={e => setClauseConflicts(e.target.value)} maxLength={3000} data-testid="input-clause-conflicts" /></Field>
        <Button type="button" size="sm" disabled={!isOwner || !readiness.data?.jurisdiction || clausePurpose.trim().length < 10 || createClauseRequest.isPending}
          onClick={submitClauseRequest} data-testid="button-submit-clause-review">{createClauseRequest.isPending ? 'Recording…' : 'Record for qualified review'}</Button>
      </div>}
      {createClauseRequest.error && <ErrorNotice error={createClauseRequest.error} />}
      {clauseRequests.error && <ErrorNotice error={clauseRequests.error} />}
      {!clauseRequests.isLoading && !clauseRequests.data?.length && <p className="text-xs text-muted-foreground">No special clause requests recorded for this deal.</p>}
      <ul className="space-y-2">{clauseRequests.data?.map((request) => <li key={request.id} className="border-t border-border pt-2 text-xs">
        <p className="font-semibold">{request.category.replaceAll('_',' ')} · {request.status.replaceAll('_',' ')}</p>
        <p>{request.purpose}</p><p className="text-muted-foreground">{request.blocker} Next: {request.nextAction}</p>
        <p className="text-muted-foreground">Proposed text: {request.proposedTextStatus.replaceAll('_',' ')}; qualified review: {request.qualifiedReviewStatus.replaceAll('_',' ')}.</p>
      </li>)}</ul>
    </div>
    {contract.status === 'DRAFT' && canCall && <Button size="sm" onClick={createReviewCopy} disabled={prepare.isPending} data-testid="button-prepare-purchase-review-pdf">
      <FileText className="mr-2 h-4 w-4" />{prepare.isPending ? 'Preparing…' : 'Prepare fillable review PDF'}
    </Button>}
    {prepare.error && <ErrorNotice error={prepare.error} />}
    {downloadError && <p className="text-xs text-destructive" role="alert" data-testid="text-review-pdf-download-error">{downloadError} The saved PDF remains in history; do not use a stale copy.</p>}
    <p className="text-[11px] text-muted-foreground">Downloads are revalidated against the current terms snapshot. An amended or withdrawn offer cannot be downloaded as current.</p>
    {documents.length === 0 ? <p className="text-xs text-muted-foreground">No PDF has been prepared for this transaction.</p> : (
      <ul className="space-y-2" data-testid="list-purchase-review-documents">
        {documents.map((document) => <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 border border-border p-2" data-testid={`transaction-review-document-${document.id}`}>
          <div>
            <p className="text-xs font-semibold">{document.fileName} · {(document.status ?? 'PREPARED_FOR_REVIEW').replace(/_/g, ' ').toLowerCase()}</p>
            <p className="text-[11px] text-muted-foreground">Attempt {document.attemptNumber} · transaction version {document.sourceContractVersion} · generated {fmtDate(document.generatedAt)} · terms {document.snapshotHash.slice(0, 12)}…</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => void downloadReviewCopy(document.id,document.fileName,document.downloadUrl)}
              disabled={downloading!==null || ['REJECTED','VOID','EXPIRED','REPLACED','STALE'].includes(document.status ?? '')} data-testid={`button-download-transaction-review-document-${document.id}`}>
              <Download className="mr-2 h-3.5 w-3.5" />{downloading===document.id?'Checking…':'Download'}
            </Button>
          </div>
          {document.status === 'STALE' && <div role="alert" className="mt-2 w-full text-sm text-destructive">
            <p>{document.staleReason || 'The source snapshot changed after preparation.'}</p>
            <p>Next: {document.nextAction || 'Reconcile the evidence and prepare a new version after renewed authorization.'}</p>
          </div>}
          {document.status === 'PREPARED_FOR_REVIEW' && <div className="mt-2 w-full space-y-2">
            <Input value={documentReasons[document.id] ?? ''} onChange={(event) => setDocumentReasons((current) => ({ ...current, [document.id]: event.target.value }))}
              placeholder="Reason required (at least 10 characters)" aria-label={`Reason for changing document ${document.fileName}`}
              data-testid={`input-document-transition-reason-${document.id}`} />
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" disabled={(documentReasons[document.id]?.trim().length ?? 0) < 10 || transition.isPending}
                onClick={() => transitionDocument(document.id, 'REJECTED')} data-testid={`button-reject-transaction-document-${document.id}`}>Reject review copy</Button>
              {isOwner && <Button type="button" size="sm" variant="ghost" disabled={(documentReasons[document.id]?.trim().length ?? 0) < 10 || transition.isPending}
                onClick={() => transitionDocument(document.id, 'VOID')} data-testid={`button-void-transaction-document-${document.id}`}>Void review copy</Button>}
            </div>
          </div>}
        </li>)}
      </ul>
    )}
    {transition.error && <ErrorNotice error={transition.error} />}
  </section>;
}

function ExecuteContract({ contract, onDone }: { contract: DealContract; onDone: () => void }) {
  const { isOwner } = useAccess();
  const run = useExecuteContract();
  const { toast } = useToast();
  const [url, setUrl] = useState(''); const [seller, setSeller] = useState(''); const [acq, setAcq] = useState(''); const [note, setNote] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const submit = () => {
    const s = fromLocalInput(seller); const a = fromLocalInput(acq);
    if (url.trim().length < 8) return setLocal('Link the executed document.');
    if (!s || !a) return setLocal('Enter when each party signed.');
    if (new Date(s).getTime() > Date.now() || new Date(a).getTime() > Date.now()) return setLocal('Signature times must be in the past.');
    if (!note.trim()) return setLocal('Add your review note.');
    setLocal(null);
    run.mutate({ id: contract.leadId, data: { version: contract.version, executedDocumentUrl: url.trim(), sellerSignedAt: s, acquisitionSignedAt: a, reviewNote: note.trim() } }, { onSuccess: () => { onDone(); toast({ title: 'Execution recorded', description: 'Buyer matching has been queued.' }); } });
  };
  return (
    <div className="space-y-3" data-testid="form-execute-contract">
      <p className="text-sm text-muted-foreground">Signatures happen outside this system. Record the evidence of a document that is already signed by both sides. The original offer approval and source proof are checked as of the actual signature times; approval cannot be backdated.</p>
      <Field label="Executed document link"><Input value={url} onChange={(e) => setUrl(e.target.value)} disabled={!isOwner} data-testid="input-exec-url" /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Seller signed"><Input type="datetime-local" value={seller} onChange={(e) => setSeller(e.target.value)} disabled={!isOwner} data-testid="input-exec-seller" /></Field>
        <Field label="Our side signed"><Input type="datetime-local" value={acq} onChange={(e) => setAcq(e.target.value)} disabled={!isOwner} data-testid="input-exec-acq" /></Field>
      </div>
      <Field label="Review note"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={!isOwner} data-testid="input-exec-note" /></Field>
      {local && <p className="text-sm text-destructive">{local}</p>}
      {run.error != null && <ErrorNotice error={run.error} />}
      <Button disabled={!isOwner || run.isPending} onClick={submit} data-testid="button-execute-contract">{run.isPending ? 'Recording...' : 'Record executed contract'}</Button>
      {!isOwner && <p className="text-xs text-muted-foreground">Only the owner can record execution.</p>}
    </div>
  );
}

function RespondForm({ contract, match, onDone }: { contract: DealContract; match: BuyerMatch; onDone: () => void }) {
  const { canCall, isOwner } = useAccess();
  const rec = useRecordBuyerResponse();
  const { toast } = useToast();
  const [status, setStatus] = useState<BuyerResponseInputStatus>('INTERESTED');
  const [evidence, setEvidence] = useState(''); const [url, setUrl] = useState(''); const [price, setPrice] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const floor = contract.purchasePrice + contract.assignmentTarget;
  const isBuyer = (match.destinationKind ?? 'BUYER') === 'BUYER';
  const commit = status === 'COMMITTED' && isBuyer;
  const submit = () => {
    if (evidence.trim().length < 10) return setLocal('Describe the response with evidence (10+ characters).');
    const p = num(price);
    if (commit) {
      if (url.trim().length < 8) return setLocal('Link the buyer commitment evidence.');
      if (!Number.isFinite(p) || p < floor) return setLocal(`Agreed price must be at least ${money(floor)} (purchase price plus assignment target).`);
    }
    setLocal(null);
    rec.mutate({ id: contract.leadId, buyerId: match.buyerId, data: { version: contract.version, buyerVersion: match.buyerVersion, status, evidence: evidence.trim(), ...(commit ? { commitmentEvidenceUrl: url.trim(), agreedPrice: p } : {}) } },
      { onSuccess: () => { onDone(); toast({ title: 'Buyer response recorded', description: `${match.buyerName}: ${status.toLowerCase()}` }); } });
  };
  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3" data-testid={`form-response-${match.buyerId}`}>
      <Field label="Response"><select className={SELECT} value={status} onChange={(e) => setStatus(e.target.value as BuyerResponseInputStatus)} data-testid={`select-response-${match.buyerId}`}>
        <option value="INTERESTED">Interested</option><option value="COMMITTED" disabled={!isOwner || !isBuyer}>{isBuyer ? 'Committed (owner only)' : 'Commitment unavailable for this destination'}</option><option value="DECLINED">Declined</option></select></Field>
      <Field label="What the buyer said or sent"><Textarea rows={2} value={evidence} onChange={(e) => setEvidence(e.target.value)} disabled={!(canCall || isOwner)} data-testid={`input-response-evidence-${match.buyerId}`} /></Field>
      {commit && <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Commitment evidence link"><Input value={url} onChange={(e) => setUrl(e.target.value)} data-testid={`input-response-url-${match.buyerId}`} /></Field>
        <Field label="Agreed price" hint={`At least ${money(floor)}; also capped by the buyer's reviewed funds and budget`}><Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} data-testid={`input-response-price-${match.buyerId}`} /></Field></div>}
      {local && <p className="text-sm text-destructive">{local}</p>}
      {rec.error != null && <ErrorNotice error={rec.error} />}
      <Button size="sm" disabled={!(canCall || isOwner) || rec.isPending} onClick={submit} data-testid={`button-submit-response-${match.buyerId}`}>{rec.isPending ? 'Recording...' : 'Record response'}</Button>
    </div>
  );
}

function MilestoneForm({ contract, onDone }: { contract: DealContract; onDone: () => void }) {
  const { isOwner } = useAccess();
  const rec = useRecordClosingMilestone();
  const { toast } = useToast();
  const open = requiredMilestones(contract).filter((m) => !contract.milestones.some((x) => x.kind === m.k));
  const [kind, setKind] = useState<ClosingMilestoneInputKind | ''>('');
  const [url, setUrl] = useState(''); const [note, setNote] = useState('');
  const [amount, setAmount] = useState(() => open[0]?.k === 'EARNEST_MONEY_CONFIRMED'
    ? String(contract.earnestMoney)
    : open[0]?.k === 'FUNDS_CONFIRMED' && contract.commitmentSnapshot?.buyer.availableFunds != null
      ? String(contract.commitmentSnapshot.buyer.availableFunds) : '');
  const [evidenceKind, setEvidenceKind] = useState<ClosingMilestoneInputEvidenceKind | ''>('');
  const [counterpartyName, setCounterpartyName] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [effectiveAt, setEffectiveAt] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const k = kind || open[0]?.k;
  if (!k) return <p className="text-sm text-muted-foreground">All applicable closing milestones are recorded.</p>;
  const financial = k === 'EARNEST_MONEY_CONFIRMED' || k === 'FUNDS_CONFIRMED';
  const evidenceKinds: ClosingMilestoneInputEvidenceKind[] = k === 'EARNEST_MONEY_CONFIRMED'
    ? ['ESCROW_RECEIPT', 'WIRE_CONFIRMATION']
    : ['BANK_CONFIRMATION', 'LENDER_LETTER', 'REDACTED_STATEMENT', 'ESCROW_RECEIPT'];
  const submit = () => {
    if (url.trim().length < 8 || note.trim().length < 10) return setLocal('Evidence link and a note of at least 10 characters are required.');
    const amountValue = num(amount);
    const effective = fromLocalInput(effectiveAt);
    if (!effective) return setLocal('Enter when the milestone actually occurred; the system records occurrence time separately from when you save it.');
    if (financial && (!Number.isFinite(amountValue) || amountValue < 0 || !evidenceKind ||
      counterpartyName.trim().length < 2 || paymentReference.trim().length < 3))
      return setLocal('Financial evidence requires its actual amount, evidence type, counterparty, and masked reference.');
    if (financial && /\b\d{9,}\b/.test(paymentReference))
      return setLocal('Use a masked receipt reference only; do not enter account, card, or payment credentials.');
    setLocal(null);
    rec.mutate({ id: contract.leadId, data: {
      version: contract.version, kind: k, evidenceUrl: url.trim(), note: note.trim(), effectiveAt: effective,
      ...(financial ? {
        amount: amountValue, currency: 'USD' as const, evidenceKind: evidenceKind as ClosingMilestoneInputEvidenceKind,
        counterpartyName: counterpartyName.trim(), paymentReference: paymentReference.trim(),
      } : {}),
    } }, { onSuccess: () => {
      const next = open[open.findIndex((m) => m.k === k) + 1];
      setUrl(''); setNote(''); setKind(''); setAmount(next?.k === 'EARNEST_MONEY_CONFIRMED'
        ? String(contract.earnestMoney)
        : next?.k === 'FUNDS_CONFIRMED' && contract.commitmentSnapshot?.buyer.availableFunds != null
          ? String(contract.commitmentSnapshot.buyer.availableFunds) : '');
      setEvidenceKind('');
      setCounterpartyName(''); setPaymentReference(''); setEffectiveAt('');
      onDone(); toast({ title: 'Milestone recorded' });
    } });
  };
  return (
    <div className="space-y-3" data-testid="form-milestone">
      <Field label="Milestone"><select className={SELECT} value={k} onChange={(e) => {
        const next = e.target.value as ClosingMilestoneInputKind;
        setKind(next); setEvidenceKind(''); setEffectiveAt(''); setCounterpartyName(''); setPaymentReference('');
        setAmount(next === 'EARNEST_MONEY_CONFIRMED' ? String(contract.earnestMoney)
          : next === 'FUNDS_CONFIRMED' && contract.commitmentSnapshot?.buyer.availableFunds != null
            ? String(contract.commitmentSnapshot.buyer.availableFunds) : '');
      }} disabled={!isOwner} data-testid="select-milestone">{open.map((m) => <option key={m.k} value={m.k}>{m.label}</option>)}</select></Field>
      <Field label="Evidence link"><Input value={url} onChange={(e) => setUrl(e.target.value)} disabled={!isOwner} data-testid="input-milestone-url" /></Field>
      <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} disabled={!isOwner} data-testid="input-milestone-note" /></Field>
      {financial && <>
        <p className="text-xs text-muted-foreground">{k === 'EARNEST_MONEY_CONFIRMED'
          ? `Confirm the escrow receipt shows the authorized acquisition deposit of ${money(contract.earnestMoney)}.`
          : `Confirm current buyer funds evidence. The amount is prefilled from the current verified profile (${money(contract.commitmentSnapshot?.buyer.availableFunds ?? 0)}); stale or mismatched evidence is rejected.`}
          {' '}No bank or escrow system is connected; this records owner review of the linked evidence only.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount shown by evidence"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!isOwner} data-testid="input-milestone-amount" /></Field>
          <Field label="Evidence type"><select className={SELECT} value={evidenceKind} onChange={(e) => setEvidenceKind(e.target.value as ClosingMilestoneInputEvidenceKind | '')} disabled={!isOwner} data-testid="select-milestone-evidence-kind">
            <option value="">Select evidence</option>{evidenceKinds.map((value) => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
          </select></Field>
          <Field label={k === 'EARNEST_MONEY_CONFIRMED' ? 'Escrow / title holder' : 'Funding institution / escrow'}><Input value={counterpartyName} onChange={(e) => setCounterpartyName(e.target.value)} disabled={!isOwner} data-testid="input-milestone-counterparty" /></Field>
          <Field label="Masked receipt/reference" hint="Do not enter account/card numbers or credentials"><Input value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} disabled={!isOwner} data-testid="input-milestone-reference" /></Field>
        </div>
      </>}
      <Field label="When it actually occurred" hint="Recorded separately from the time this evidence is entered">
        <Input type="datetime-local" value={effectiveAt} onChange={(e) => setEffectiveAt(e.target.value)} disabled={!isOwner} data-testid="input-milestone-effective-at" />
      </Field>
      {local && <p className="text-sm text-destructive">{local}</p>}
      {rec.error != null && <ErrorNotice error={rec.error} />}
      <Button size="sm" disabled={!isOwner || rec.isPending} onClick={submit} data-testid="button-record-milestone">{rec.isPending ? 'Recording...' : 'Record milestone'}</Button>
      {!isOwner && <p className="text-xs text-muted-foreground">Only the owner can record closing milestones.</p>}
    </div>
  );
}

const DEADLINE_MILESTONES: { kind: TransactionMilestoneDeadlineItemKind; label: string }[] = [
  { kind: 'TITLE_CLEARED', label: 'Title clearance' },
  { kind: 'INSPECTION_COMPLETED', label: 'Inspection completion' },
  { kind: 'EARNEST_MONEY_CONFIRMED', label: 'Acquisition earnest money' },
  { kind: 'ASSIGNMENT_SIGNED', label: 'Buyer assignment' },
  { kind: 'FUNDS_CONFIRMED', label: 'Buyer funds evidence' },
];
type DeadlineDraft = {
  kind: TransactionMilestoneDeadlineItemKind;
  disposition: TransactionMilestoneDeadlineItemDisposition | '';
  dueDate: string;
  basisNote: string;
};
function latestDeadlineSource(contract: DealContract) {
  const latestAmendment = [...(contract.history ?? [])]
    .filter((item) => item.kind === 'AMEND_CLOSING' && !!item.evidenceUrl)
    .sort((a, b) => Date.parse(a.effectiveAt) - Date.parse(b.effectiveAt))
    .at(-1);
  return latestAmendment?.evidenceUrl ?? contract.executedDocumentUrl ?? '';
}
function MilestoneDeadlineScheduleForm({ contract, onDone }: { contract: DealContract; onDone: () => void }) {
  const { isOwner } = useAccess();
  const save = useRecordTransactionDeadlineSchedule();
  const { toast } = useToast();
  const current = contract.deadlineSchedule;
  const [sourceEvidenceUrl, setSourceEvidenceUrl] = useState(() => latestDeadlineSource(contract));
  const [timeZone, setTimeZone] = useState(() =>
    current?.items.find((item) => item.timeZone)?.timeZone ?? '');
  const [reviewNote, setReviewNote] = useState('');
  const [requestKey, setRequestKey] = useState(() => globalThis.crypto.randomUUID());
  const [local, setLocal] = useState<string | null>(null);
  const [items, setItems] = useState<DeadlineDraft[]>(() => DEADLINE_MILESTONES.map(({ kind }) => {
    const prior = current?.items.find((item) => item.kind === kind);
    return {
      kind,
      disposition: prior?.disposition ?? '',
      dueDate: prior?.dueDate ?? '',
      basisNote: prior?.basisNote ?? '',
    };
  }));
  const updateItem = (kind: TransactionMilestoneDeadlineItemKind, patch: Partial<DeadlineDraft>) =>
    setItems((previous) => previous.map((item) => item.kind === kind ? { ...item, ...patch } : item));
  const submit = () => {
    if (!isOwner) return;
    if (sourceEvidenceUrl.trim().length < 8 || reviewNote.trim().length < 10)
      return setLocal('Link the current executed agreement/amendment and add a review note.');
    if (items.some((item) => !item.disposition || item.basisNote.trim().length < 10))
      return setLocal('Review all five milestones and explain the disposition for each.');
    if (items.some((item) => item.disposition === 'DUE_DATE' && (!item.dueDate || !timeZone.trim())))
      return setLocal('A scheduled calendar date needs the exact date and the time zone stated or confirmed from the contract.');
    setLocal(null);
    save.mutate({
      id: contract.leadId,
      data: {
        version: contract.version,
        deadlineScheduleVersion: contract.deadlineScheduleVersion ?? 0,
        idempotencyKey: requestKey,
        sourceEvidenceUrl: sourceEvidenceUrl.trim(),
        reviewNote: reviewNote.trim(),
        items: items.map((item) => ({
          kind: item.kind,
          disposition: item.disposition as TransactionMilestoneDeadlineItemDisposition,
          dueDate: item.disposition === 'DUE_DATE' ? item.dueDate : null,
          timeZone: item.disposition === 'DUE_DATE' ? timeZone.trim() : null,
          basisNote: item.basisNote.trim(),
        })),
      },
    }, {
      onSuccess: () => {
        setRequestKey(globalThis.crypto.randomUUID());
        setReviewNote('');
        onDone();
        toast({ title: 'Deadline schedule reviewed', description: 'This records due-date interpretation only; it does not complete a milestone or amend the contract.' });
      },
    });
  };
  return (
    <div className="space-y-3" data-testid="form-milestone-deadlines">
      <div>
        <p className="text-sm font-semibold">Milestone due dates</p>
        <p className="mt-1 text-xs text-muted-foreground">Review the executed terms. Each milestone must be given a due date, marked as having no fixed date, or explicitly marked not applicable. This is a schedule review, not proof of completion or a contract amendment.</p>
      </div>
      {current && <p className="text-xs text-muted-foreground" data-testid="text-deadline-schedule-version">
        Schedule v{current.version} · reviewed {fmtDate(current.recordedAt)} · source event {fmtDate(current.sourceEffectiveAt)} · terms {current.termsHash.slice(0, 12)}
      </p>}
      <Field label="Current executed agreement or latest amendment reference"><Input value={sourceEvidenceUrl} onChange={(e) => setSourceEvidenceUrl(e.target.value)} disabled={!isOwner} data-testid="input-deadline-source" /></Field>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.kind} className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2" data-testid={`row-deadline-${item.kind}`}>
            <Field label={DEADLINE_MILESTONES.find((m) => m.kind === item.kind)?.label ?? item.kind}>
              <select className={SELECT} value={item.disposition} disabled={!isOwner} onChange={(e) => updateItem(item.kind, {
                disposition: e.target.value as TransactionMilestoneDeadlineItemDisposition | '',
                dueDate: e.target.value === 'DUE_DATE' ? item.dueDate : '',
              })}>
                <option value="">Review executed terms</option>
                <option value="DUE_DATE">Has a specific due date</option>
                <option value="NO_FIXED_DATE">No fixed date stated</option>
                <option value="NOT_APPLICABLE">Not applicable under these terms</option>
              </select>
            </Field>
            {item.disposition === 'DUE_DATE' && <Field label={`Due date (${timeZone || 'time zone required'})`}>
              <Input type="date" value={item.dueDate} onChange={(e) => updateItem(item.kind, { dueDate: e.target.value })} disabled={!isOwner} />
            </Field>}
            <Field label="Reason from the executed terms" hint="For example: clause or page; do not infer a missing date">
              <Input value={item.basisNote} onChange={(e) => updateItem(item.kind, { basisNote: e.target.value })} disabled={!isOwner} />
            </Field>
          </div>
        ))}
      </div>
      {items.some((item) => item.disposition === 'DUE_DATE') && <Field label="Time zone explicitly confirmed from the agreement">
        <Input value={timeZone} onChange={(e) => setTimeZone(e.target.value)} placeholder="e.g. America/New_York" disabled={!isOwner} data-testid="input-deadline-time-zone" />
      </Field>}
      <Field label="Review note"><Textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} disabled={!isOwner} data-testid="input-deadline-review-note" /></Field>
      {local && <p className="text-sm text-destructive">{local}</p>}
      {save.error != null && <ErrorNotice error={save.error} />}
      {isOwner ? <Button size="sm" disabled={save.isPending} onClick={submit} data-testid="button-save-deadline-schedule">
        {save.isPending ? 'Saving review...' : 'Save reviewed schedule'}
      </Button> : <p className="text-xs text-muted-foreground">Only the owner can record this schedule review.</p>}
      {current && <ul className="space-y-1 text-xs text-muted-foreground" data-testid="list-current-deadlines">
        {current.items.map((item) => <li key={item.kind}>{item.kind.replace(/_/g, ' ')}: {item.disposition.replace(/_/g, ' ')}
          {item.disposition === 'DUE_DATE' ? ` — ${item.dueDate} (${item.timeZone})` : ''}. {item.basisNote}</li>)}
      </ul>}
    </div>
  );
}

function OutcomeForm({ contract, onDone }: { contract: DealContract; onDone: () => void }) {
  const { isOwner } = useAccess();
  const rec = useRecordDealOutcome();
  const { toast } = useToast();
  const [outcome, setOutcome] = useState<DealOutcomeInputOutcome>('CLOSED');
  const [url, setUrl] = useState(''); const [note, setNote] = useState(''); const [fee, setFee] = useState(''); const [costs, setCosts] = useState(''); const [relUrl, setRelUrl] = useState(''); const [occ, setOcc] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const expected = contract.agreedBuyerPrice != null ? contract.agreedBuyerPrice - contract.purchasePrice : null;
  const missing = requiredMilestones(contract).filter((m) => !contract.milestones.some((x) => x.kind === m.k));
  const submit = () => {
    if (url.trim().length < 8 || note.trim().length < 3) return setLocal('Evidence link and a note are required.');
    const f = num(fee); const c = num(costs);
    const oc = fromLocalInput(occ);
    if (!oc || new Date(oc).getTime() > Date.now()) return setLocal('Enter when the outcome actually happened outside this system; it cannot be in the future.');
    if (outcome === 'CLOSED') {
      if (missing.length) return setLocal(`Cannot close: missing ${missing.map((m) => m.label.toLowerCase()).join(', ')}.`);
      if (!contract.committedBuyerId) return setLocal('Cannot close without a committed, currently qualified buyer.');
      if (!Number.isFinite(f) || !Number.isFinite(c)) return setLocal('Enter the actual assignment fee received and closing costs.');
      if (expected != null && Math.abs(f - expected) > 0.005) return setLocal(`Fee received must equal agreed price minus purchase price: ${money(expected)}.`);
    }
    if (outcome === 'CANCELLED' && contract.committedBuyerId && relUrl.trim().length < 8) return setLocal('A committed buyer exists: link the external evidence of that buyer\'s release.');
    setLocal(null);
    rec.mutate({ id: contract.leadId, data: { version: contract.version, outcome, evidenceUrl: url.trim(), note: note.trim(), occurredAt: oc, ...(outcome === 'CANCELLED' && contract.committedBuyerId ? { buyerReleaseEvidenceUrl: relUrl.trim() } : {}), ...(outcome === 'CLOSED' ? { assignmentFeeReceived: f, closingCosts: c } : {}) } }, { onSuccess: () => { onDone(); toast({ title: outcome === 'CLOSED' ? 'Deal closed' : 'Deal cancelled' }); } });
  };
  return (
    <div className="space-y-3" data-testid="form-outcome">
      <Field label="Outcome"><select className={SELECT} value={outcome} onChange={(e) => setOutcome(e.target.value as DealOutcomeInputOutcome)} disabled={!isOwner} data-testid="select-outcome"><option value="CLOSED">Closed</option><option value="CANCELLED">Cancelled</option></select></Field>
      <Field label="Evidence link"><Input value={url} onChange={(e) => setUrl(e.target.value)} disabled={!isOwner} data-testid="input-outcome-url" /></Field>
      <Field label="When it actually happened"><Input type="datetime-local" value={occ} onChange={(e) => setOcc(e.target.value)} disabled={!isOwner} data-testid="input-outcome-occurred" /></Field>
      <p className="text-xs text-muted-foreground">Late recording is allowed only when the retained eligibility snapshot predates this event and no financial, source or buyer change before the event contradicts it. Current snapshots are sealed as you record milestones; originals stay in history as ELIGIBILITY REVIEW.</p>
      <Field label="Note"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={!isOwner} data-testid="input-outcome-note" /></Field>
      {outcome === 'CANCELLED' && contract.committedBuyerId && <Field label="Buyer release evidence link" hint="External evidence the committed buyer was released"><Input value={relUrl} onChange={(e) => setRelUrl(e.target.value)} disabled={!isOwner} data-testid="input-outcome-release-url" /></Field>}
      {outcome === 'CLOSED' && <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Assignment fee received" hint={expected != null ? `Must equal ${money(expected)}` : 'Needs a committed buyer'}><Input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} disabled={!isOwner} data-testid="input-outcome-fee" /></Field>
        <Field label="Closing costs paid"><Input inputMode="decimal" value={costs} onChange={(e) => setCosts(e.target.value)} disabled={!isOwner} data-testid="input-outcome-costs" /></Field></div>}
      {local && <p className="text-sm text-destructive" data-testid="text-outcome-error">{local}</p>}
      {rec.error != null && <ErrorNotice error={rec.error} />}
      <Button size="sm" variant={outcome === 'CANCELLED' ? 'destructive' : 'default'} disabled={!isOwner || rec.isPending} onClick={submit} data-testid="button-record-outcome">{rec.isPending ? 'Recording...' : outcome === 'CLOSED' ? 'Record closing' : 'Record cancellation'}</Button>
      {!isOwner && <p className="text-xs text-muted-foreground">Only the owner can record the outcome.</p>}
    </div>
  );
}

function ExceptionForm({ contract, reopened, onDone }: { contract: DealContract; reopened: boolean; onDone: () => void }) {
  const { isOwner } = useAccess();
  const rec = useRecordTransactionException();
  const { toast } = useToast();
  const live = contract.status === 'UNDER_CONTRACT' || contract.status === 'CLOSING';
  const kinds: { k: TransactionExceptionInputKind; label: string }[] = [
    ...(live ? [{ k: 'AMEND_CLOSING' as const, label: 'Signed closing-date amendment' }] : []),
    ...(live && contract.committedBuyerId ? [{ k: 'RELEASE_BUYER' as const, label: 'Release committed buyer (externally evidenced)' }] : []),
    ...(contract.status === 'CANCELLED' && !reopened ? [{ k: 'RESTART_CANCELLED' as const, label: 'Restart cancelled deal for a new reviewed attempt' }] : []),
  ];
  const [kind, setKind] = useState<TransactionExceptionInputKind | ''>(kinds[0]?.k ?? '');
  const [url, setUrl] = useState(''); const [note, setNote] = useState(''); const [eff, setEff] = useState(''); const [newAt, setNewAt] = useState(''); const [consent, setConsent] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  if (kinds.length === 0) return <p className="text-sm text-muted-foreground">No exception applies to this contract state. A closed deal cannot be restarted, and a cancelled deal that is already reopened cannot be restarted again.</p>;
  const submit = () => {
    const e = fromLocalInput(eff); const n = fromLocalInput(newAt);
    if (!kind) return setLocal('Select the exception.');
    if (url.trim().length < 8) return setLocal('Evidence link is required.');
    if (note.trim().length < 10) return setLocal('A note of at least 10 characters is required.');
    if (!e || new Date(e).getTime() > Date.now()) return setLocal('Effective time is when it actually happened and cannot be in the future.');
    if (kind === 'AMEND_CLOSING') {
      if (!n) return setLocal('Enter the new closing date from the signed amendment.');
      if (contract.committedBuyerId && consent.trim().length < 8) return setLocal('A buyer is committed: separate buyer consent evidence is required.');
    }
    setLocal(null);
    rec.mutate({ id: contract.leadId, data: { version: contract.version, kind, evidenceUrl: url.trim(), note: note.trim(), effectiveAt: e,
      ...(kind === 'AMEND_CLOSING' && n ? { newClosingAt: n } : {}),
      ...(kind === 'AMEND_CLOSING' && contract.committedBuyerId ? { buyerConsentEvidenceUrl: consent.trim() } : {}),
      ...(kind === 'RELEASE_BUYER' && contract.committedBuyerId ? { buyerId: contract.committedBuyerId } : {}) } },
      { onSuccess: () => { onDone(); setUrl(''); setNote(''); setEff(''); setNewAt(''); setConsent(''); toast({ title: 'Exception recorded' }); } });
  };
  return (
    <div className="space-y-3" data-testid="form-exception">
      <p className="text-xs text-muted-foreground">Recorded server time is set automatically. Earlier dates, commitments and prior states stay in history. An effective time cannot overwrite a later exception. Price, deposit and assignment terms are preserved.</p>
      <Field label="Exception"><select className={SELECT} value={kind} onChange={(e) => setKind(e.target.value as TransactionExceptionInputKind)} disabled={!isOwner} data-testid="select-exception-kind">{kinds.map((x) => <option key={x.k} value={x.k}>{x.label}</option>)}</select></Field>
      <Field label="Evidence link"><Input value={url} onChange={(e) => setUrl(e.target.value)} disabled={!isOwner} data-testid="input-exception-url" /></Field>
      <Field label="When it actually took effect"><Input type="datetime-local" value={eff} onChange={(e) => setEff(e.target.value)} disabled={!isOwner} data-testid="input-exception-effective" /></Field>
      {kind === 'AMEND_CLOSING' && <Field label="New closing date"><Input type="datetime-local" value={newAt} onChange={(e) => setNewAt(e.target.value)} disabled={!isOwner} data-testid="input-exception-new-closing" /></Field>}
      {kind === 'AMEND_CLOSING' && contract.committedBuyerId && <Field label="Buyer consent evidence link" hint="Separate from the amendment"><Input value={consent} onChange={(e) => setConsent(e.target.value)} disabled={!isOwner} data-testid="input-exception-consent" /></Field>}
      <Field label="Note"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={!isOwner} data-testid="input-exception-note" /></Field>
      {local && <p className="text-sm text-destructive" data-testid="text-exception-error">{local}</p>}
      {rec.error != null && <ErrorNotice error={rec.error} />}
      <Button size="sm" disabled={!isOwner || rec.isPending} onClick={submit} data-testid="button-record-exception">{rec.isPending ? 'Recording...' : 'Record exception'}</Button>
      {!isOwner && <p className="text-xs text-muted-foreground">Only the owner can amend closing dates, release a committed buyer or restart a cancelled deal. Other roles can read the history below.</p>}
    </div>
  );
}

function ExceptionHistory({ contract }: { contract: DealContract }) {
  const h = contract.history ?? [];
  return (
    <div data-testid="panel-exception-history">
      <p className="eyebrow mb-2">Attempt {contract.attemptNumber ?? 1} / retained history ({h.length})</p>
      {h.length === 0 ? <p className="text-sm text-muted-foreground">No amendments, releases or restarts recorded.</p> : (
        <ol className="space-y-2">{[...h].reverse().map((x, i) => (
          <li key={`${x.recordedAt}:${i}`} className="border-t border-border pt-2 text-sm">
            <p><span className="tag tone-ink mr-2">{x.kind.replace(/_/g, ' ')}</span><span className="font-mono text-xs text-muted-foreground">effective {fmtDate(x.effectiveAt)} / recorded {fmtDate(x.recordedAt)} by {x.recordedBy}</span></p>
            <p className="whitespace-pre-wrap">{x.note} <EvidenceLink url={x.evidenceUrl} label="evidence" /></p>
            <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Previous state</summary>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono">{JSON.stringify(x.previousState, null, 2)}</pre></details>
          </li>))}</ol>
      )}
    </div>
  );
}

const DESTINATION_ACTIVITY_KINDS: { kind: DestinationActivityInputKind; label: string; ownerOnly?: boolean }[] = [
  { kind: 'SUBMITTED', label: 'Opportunity already submitted' },
  { kind: 'ACKNOWLEDGED', label: 'Submission acknowledged' },
  { kind: 'DECLINED', label: 'Destination declined' },
  { kind: 'TERMS_REVIEWED', label: 'Exact referral terms reviewed', ownerOnly: true },
  { kind: 'TERMS_ACCEPTED', label: 'Exact referral terms accepted', ownerOnly: true },
  { kind: 'FEE_RECEIVED', label: 'Referral fee actually received', ownerOnly: true },
  { kind: 'FEE_DISPUTED', label: 'Referral fee disputed', ownerOnly: true },
  { kind: 'FEE_WAIVED', label: 'Referral fee waived', ownerOnly: true },
];
const LINKED_ACTIVITY_KINDS: Partial<Record<DestinationActivityInputKind, DestinationActivityEvent['kind'][]>> = {
  ACKNOWLEDGED: ['SUBMITTED'],
  DECLINED: ['SUBMITTED'],
  TERMS_REVIEWED: ['SUBMITTED', 'ACKNOWLEDGED'],
  TERMS_ACCEPTED: ['TERMS_REVIEWED'],
  FEE_RECEIVED: ['TERMS_ACCEPTED'],
  FEE_DISPUTED: ['TERMS_ACCEPTED', 'FEE_RECEIVED'],
  FEE_WAIVED: ['TERMS_ACCEPTED', 'FEE_RECEIVED', 'FEE_DISPUTED'],
};
const newDestinationEventKey = () => globalThis.crypto?.randomUUID?.() ?? `destination-${Date.now()}-${Math.random()}`;

function DestinationActivityForm({ contract, destinations, history, onDone }: {
  contract: DealContract;
  destinations: BuyerMatch[];
  history: DestinationActivityEvent[];
  onDone: () => void;
}) {
  const { canResearch, canCall, isOwner } = useAccess();
  const record = useRecordDestinationActivity();
  const { toast } = useToast();
  const [destinationId, setDestinationId] = useState(destinations[0]?.buyerId ?? '');
  const [kind, setKind] = useState<DestinationActivityInputKind>('SUBMITTED');
  const [eventKey, setEventKey] = useState(newDestinationEventKey);
  const [occurredAt, setOccurredAt] = useState(() => toLocalInput(new Date().toISOString()));
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [note, setNote] = useState('');
  const [exactTerms, setExactTerms] = useState('');
  const [feeAmount, setFeeAmount] = useState('');
  const [currency, setCurrency] = useState('');
  const [relatedEventKey, setRelatedEventKey] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const selected = destinations.find((d) => d.buyerId === destinationId);
  const linkKinds = LINKED_ACTIVITY_KINDS[kind] ?? [];
  const relatedChoices = history.filter((e) => e.destinationId === destinationId && linkKinds.includes(e.kind));
  const needsTerms = kind === 'TERMS_REVIEWED' || kind === 'TERMS_ACCEPTED';
  const needsFee = ['FEE_RECEIVED', 'FEE_DISPUTED', 'FEE_WAIVED'].includes(kind);
  const needsRelated = kind !== 'SUBMITTED';
  const canWrite = canResearch || canCall || isOwner;
  const reset = () => {
    setEventKey(newDestinationEventKey()); setOccurredAt(toLocalInput(new Date().toISOString()));
    setEvidenceUrl(''); setNote(''); setExactTerms(''); setFeeAmount(''); setCurrency(''); setRelatedEventKey('');
  };
  const submit = () => {
    if (!selected) return setLocal('Choose a deal-finder or guru destination.');
    const actualAt = fromLocalInput(occurredAt);
    if (!actualAt || new Date(actualAt).getTime() > Date.now()) return setLocal('Enter when the event actually happened; it cannot be in the future.');
    if (evidenceUrl.trim().length < 8) return setLocal('Link the evidence for this event.');
    if (note.trim().length < 10) return setLocal('Add a note of at least 10 characters.');
    if (needsRelated && !relatedChoices.some((e) => e.eventKey === relatedEventKey)) return setLocal('Link this event to a prior event for the same destination.');
    if (needsTerms && exactTerms.trim().length < 10) return setLocal('Record the exact terms from the evidence.');
    const amount = num(feeAmount);
    if (needsFee && (!Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency.trim()))) return setLocal('Enter the evidenced fee amount and its three-letter currency.');
    setLocal(null);
    record.mutate({
      id: contract.leadId, buyerId: selected.buyerId,
      data: {
        version: contract.version, buyerVersion: selected.buyerVersion, eventKey, kind, occurredAt: actualAt,
        evidenceUrl: evidenceUrl.trim(), note: note.trim(),
        ...(needsTerms ? { exactTerms: exactTerms.trim() } : {}),
        ...(needsFee ? { feeAmount: amount, currency: currency.trim() } : {}),
        ...(needsRelated ? { relatedEventKey } : {}),
      },
    }, { onSuccess: () => { reset(); onDone(); toast({ title: 'Destination activity recorded', description: 'No message was sent and buyer/closing state was not changed.' }); } });
  };
  if (!destinations.length) return <p className="text-sm text-muted-foreground">No deal-finder or guru destinations are recorded for this deal.</p>;
  return (
    <div className="space-y-3" data-testid="form-destination-activity">
      <p className="text-xs text-muted-foreground">Record only an event that already happened outside this system. This form does not send a submission, negotiate terms, approve a buyer, or change closing state. Profile fee amounts are quotes, not receipts.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Destination"><select className={SELECT} value={destinationId} onChange={(e) => { setDestinationId(e.target.value); setRelatedEventKey(''); }} disabled={!canWrite} data-testid="select-destination-activity-destination">{destinations.map((d) => <option key={d.buyerId} value={d.buyerId}>{d.buyerName} / {(d.destinationKind ?? '').replace('_', ' ')}</option>)}</select></Field>
        <Field label="Event"><select className={SELECT} value={kind} onChange={(e) => { setKind(e.target.value as DestinationActivityInputKind); setRelatedEventKey(''); }} disabled={!canWrite} data-testid="select-destination-activity-kind">{DESTINATION_ACTIVITY_KINDS.map((item) => <option key={item.kind} value={item.kind} disabled={!!item.ownerOnly && !isOwner}>{item.label}{item.ownerOnly ? ' (owner only)' : ''}</option>)}</select></Field>
        <Field label="When it actually happened"><Input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} disabled={!canWrite} data-testid="input-destination-activity-occurred" /></Field>
        {needsRelated && <Field label="Related prior event"><select className={SELECT} value={relatedEventKey} onChange={(e) => setRelatedEventKey(e.target.value)} disabled={!canWrite || !relatedChoices.length} data-testid="select-destination-activity-related"><option value="">Select linked event</option>{relatedChoices.map((event) => <option key={event.eventKey} value={event.eventKey}>{event.kind.replace(/_/g, ' ')} / {fmtDate(event.occurredAt)} / {event.eventKey}</option>)}</select></Field>}
        {needsFee && <div className="grid grid-cols-2 gap-3"><Field label="Exact fee amount"><Input inputMode="decimal" value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)} disabled={!canWrite || !isOwner} data-testid="input-destination-activity-fee" /></Field><Field label="Currency"><Input maxLength={3} placeholder="e.g. USD" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} disabled={!canWrite || !isOwner} data-testid="input-destination-activity-currency" /></Field></div>}
      </div>
      {needsTerms && <Field label={kind === 'TERMS_ACCEPTED' ? 'Exact accepted terms' : 'Exact terms reviewed'}><Textarea rows={3} value={exactTerms} onChange={(e) => setExactTerms(e.target.value)} disabled={!canWrite || !isOwner} data-testid="input-destination-activity-terms" /></Field>}
      <Field label="Evidence link"><Input value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)} disabled={!canWrite} data-testid="input-destination-activity-evidence" /></Field>
      <Field label="What happened"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={!canWrite} data-testid="input-destination-activity-note" /></Field>
      {needsRelated && !relatedChoices.length && <p className="text-xs text-muted-foreground">A matching prior submission, terms review, or fee event must be recorded first.</p>}
      {local && <p className="text-sm text-destructive">{local}</p>}
      {record.error != null && <ErrorNotice error={record.error} />}
      <Button size="sm" disabled={!canWrite || record.isPending || (needsRelated && !relatedChoices.length)} onClick={submit} data-testid="button-record-destination-activity">{record.isPending ? 'Recording...' : 'Record activity'}</Button>
      {!isOwner && <p className="text-xs text-muted-foreground">Only the owner can record reviewed/accepted terms or referral-fee outcomes.</p>}
    </div>
  );
}

function DestinationActivityHistory({ events }: { events: DestinationActivityEvent[] }) {
  return (
    <div data-testid="list-destination-activity-history">
      <p className="eyebrow mb-2">Append-only event history ({events.length})</p>
      {!events.length ? <p className="text-sm text-muted-foreground">No deal-finder/guru activity recorded.</p> : (
        <ol className="space-y-2">{[...events].reverse().map((event) => (
          <li key={event.eventKey} className="border-t border-border pt-2 text-sm">
            <p><span className="tag tone-signal mr-2">{event.kind.replace(/_/g, ' ')}</span><span className="font-semibold">{event.destinationName}</span></p>
            <p className="font-mono text-xs text-muted-foreground">Actual {fmtDate(event.occurredAt)} / recorded {fmtDate(event.recordedAt)} by {event.recordedBy}</p>
            {event.exactTerms && <p className="mt-1 whitespace-pre-wrap"><b>Exact terms:</b> {event.exactTerms}</p>}
            {event.feeAmount != null && <p className="font-mono">{event.kind.replace(/_/g, ' ')}: {event.feeAmount.toLocaleString()} {event.currency ?? 'currency not recorded'}</p>}
            <p className="whitespace-pre-wrap">{event.note} <EvidenceLink url={event.evidenceUrl} label="evidence" /></p>
            {event.relatedEventKey && <p className="font-mono text-[11px] text-muted-foreground">Linked event: {event.relatedEventKey}</p>}
          </li>))}</ol>
      )}
    </div>
  );
}

export function DealOperationsPanel({ detail }: { detail: LeadDetail }) {
  const id = detail.lead.id;
  const invalidate = useInvalidateWork();
  const { canResearch, canCall, isOwner } = useAccess();
  const { toast } = useToast();
  const [respondTo, setRespondTo] = useState<string | null>(null);
  const q = useGetDealOperations(id, { query: { queryKey: getGetDealOperationsQueryKey(id), enabled: !!id, staleTime: 5_000, refetchInterval: 10_000 } });
  const refresh = useRefreshMatches();
  const done = () => { invalidate(id); setRespondTo(null); };

  if (q.isLoading) return <RowsSkeleton rows={4} />;
  if (q.isError || !q.data) return <ErrorNotice error={q.error} onRetry={() => q.refetch()} />;
  const ops = q.data;
  const c = ops.contract;
  const live = c && (c.status === 'UNDER_CONTRACT' || c.status === 'CLOSING');
  const eligible = ops.matches.filter((m) => m.eligible);
  const excluded = ops.matches.filter((m) => !m.eligible);
  const destinations = ops.matches.filter((m) => (m.destinationKind ?? 'BUYER') !== 'BUYER');
  const destinationActivity = c?.destinationActivityHistory ?? [];
  const timeline: { at: string; title: string; detail: string; evidence: string; href?: string }[] = [
    ...detail.transitions.map((event) => ({
      at: event.createdAt, title: `${event.from} → ${event.to}`,
      detail: `${event.reason} Next: ${event.nextAction}`,
      evidence: `Stage transition recorded by ${event.actor}.`,
    })),
    ...detail.calls.map((event) => ({
      at: event.createdAt, title: `Seller call: ${event.outcome.replaceAll('_', ' ')}`,
      detail: event.notes || event.nextAction,
      evidence: event.evidenceClassification === 'OBSERVED'
        ? 'Operator-recorded call observation; not an external recording.'
        : 'Seller-reported/indicated content; not independently verified.',
    })),
    ...ops.matches.map((match) => ({
      at: match.updatedAt, title: `Buyer state: ${match.status.replaceAll('_', ' ')} · ${match.buyerName}`,
      detail: match.eligible ? 'Currently eligible match; this is not a commitment.'
        : match.reasons.concat(match.mismatches).join('; ') || 'Not eligible under current criteria.',
      evidence: match.status === 'COMMITTED'
        ? 'Response record exists; binding terms/signatures and settlement remain separate evidence.'
        : 'Matching/interest state only; no buyer approval or commitment is inferred.',
    })),
    ...(c?.history ?? []).map((event) => ({
      at: event.recordedAt, title: `Transaction: ${event.kind.replaceAll('_', ' ')}`,
      detail: event.note, evidence: `Operator/audit history; effective ${event.effectiveAt}. ${event.evidenceUrl}`,
    })),
    ...destinationActivity.map((event) => ({
      at: event.recordedAt, title: `Distribution record: ${event.kind.replaceAll('_', ' ')} · ${event.destinationName}`,
      detail: event.note,
      evidence: `Recorded ${event.recordedAt}; provider delivery is not inferred from this event. ${event.evidenceUrl}`,
    })),
    ...(c?.deadlineSchedule ? [{
      at: c.deadlineSchedule.recordedAt,
      title: `Owner-reviewed deadline schedule v${c.deadlineSchedule.version}`,
      detail: c.deadlineSchedule.items.map((item) => `${item.kind.replaceAll('_', ' ')}: ${item.disposition.replaceAll('_', ' ')}${item.dueDate ? ` ${item.dueDate} (${item.timeZone})` : ''}`).join('; '),
      evidence: `Terms hash ${c.deadlineSchedule.termsHash}; source ${c.deadlineSchedule.sourceEvidenceUrl}. A schedule is not completion evidence.`,
    }] : []),
    ...(c?.documents ?? []).map((event) => ({
      at: event.generatedAt, title: `Document: ${event.status.replaceAll('_', ' ')}`,
      detail: `${event.fileName} · version ${event.sourceContractVersion}`,
      evidence: 'Prepared document record; does not establish sending, signature, or legal approval.',
    })),
    ...(c?.milestones ?? []).map((event) => ({
      at: event.recordedAt, title: `Closing milestone: ${event.kind.replaceAll('_', ' ')}`,
      detail: event.note,
      evidence: `Operator-recorded evidence reference; occurred ${event.effectiveAt ?? 'time not recorded'}. ${event.evidenceUrl}`,
    })),
    ...(c?.outcomeRecordedAt ? [{
      at: c.outcomeRecordedAt, title: c.status === 'CLOSED' ? 'Closing outcome recorded' : `Outcome recorded: ${c.status}`,
      detail: `${c.outcomeNote ?? 'No outcome note recorded.'}${c.assignmentFeeReceived != null ? ` Assignment fee recorded: ${money(c.assignmentFeeReceived)}.` : ''}${c.closingCosts != null ? ` Closing costs recorded: ${money(c.closingCosts)}.` : ''}${c.netProceeds != null ? ` Net proceeds recorded: ${money(c.netProceeds)}.` : ''}`,
      evidence: `Operator-entered outcome claim; settlement reference ${c.outcomeEvidenceUrl ?? 'missing'}. Not provider-verified.`,
    }] : []),
  ].filter((event) => Number.isFinite(Date.parse(event.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return (
    <div className="space-y-4" data-testid="panel-deal-operations">
      <div className="ledger border-l-4 border-l-signal p-3 text-sm" data-testid="text-ops-next"><b>Next action:</b> {ops.nextAction || 'none recorded'}</div>
      <Block title="Deal timeline & next action" tid="panel-deal-timeline">
        <p className="text-xs text-muted-foreground">
          Chronological persisted records across stage changes, seller calls, buyer matching, distribution, documents, funds, deadlines and closing. Operator-entered references are not provider verification; unresolved hypotheses remain hypotheses and unsupported evidence stays a blocker.
        </p>
        <div className="grid gap-2 border-y border-border py-2 text-xs sm:grid-cols-2 lg:grid-cols-4" data-testid="deal-lifecycle-coverage">
          <p><b>Acquisition:</b> {detail.lead.stage} · {detail.transitions.length} persisted stage changes</p>
          <p><b>Underwriting:</b> {detail.analysisSnapshotId ? `snapshot ${detail.analysisSnapshotId}` : 'no current analysis snapshot'}</p>
          <p><b>Seller contact:</b> {detail.calls.length} operator call records. The persisted route gate—not a call note—must prove permission and identity before calling.</p>
          <p><b>Buyer verification:</b> {eligible.length} currently eligible matches of {ops.matches.length}; interest is not commitment.</p>
          <p><b>Distribution:</b> {destinationActivity.length} recorded destination events; delivery requires provider confirmation.</p>
          <p><b>Contract/funds:</b> {c ? `${c.status}; ${c.milestones.length} milestone records` : 'no transaction record'}</p>
          <p><b>Closing:</b> {c?.outcomeRecordedAt ? 'outcome claim recorded' : 'no closing outcome recorded'}</p>
          <p><b>Post-deal learning:</b> actual outcomes inform recommendations only; economics and authority are never changed automatically.</p>
        </div>
        {detail.workGuidance && (
          <div className="my-2 border-l-2 border-signal pl-3 text-sm" data-testid="timeline-next-action">
            <b>{detail.workGuidance.title}</b> · {detail.workGuidance.currentState}
            <p className="text-xs text-muted-foreground">{detail.workGuidance.why} Next: {detail.workGuidance.cta}. Responsible: {detail.workGuidance.responsibleRole}; due {fmtDate(detail.workGuidance.dueAt ?? null)}.</p>
            {detail.workGuidance.missingFacts.length > 0 && <p className="mt-1 text-xs text-destructive">Blockers: {detail.workGuidance.missingFacts.join('; ')}</p>}
          </div>
        )}
        {timeline.length === 0 ? <p className="text-sm text-muted-foreground">No persisted lifecycle events are available for this deal yet. Current next action: {ops.nextAction || 'review acquisition evidence'}.</p> : (
          <ol className="max-h-96 space-y-2 overflow-auto border-l border-border pl-3" data-testid="list-deal-timeline">
            {timeline.map((event, index) => <li key={`${event.at}-${event.title}-${index}`} className="border-b border-border pb-2 text-xs">
              <p className="font-semibold">{event.title} <span className="font-normal text-muted-foreground">· {fmtDate(event.at)}</span></p>
              <p className="whitespace-pre-wrap">{event.detail}</p>
              <p className="text-muted-foreground">{event.evidence}</p>
            </li>)}
          </ol>
        )}
      </Block>

      <Block title="Contract" tid="panel-contract">
        {!c ? <CreateContract detail={detail} onDone={done} /> : (
          <div className="space-y-4">
            {c.status === 'CANCELLED' && detail.lead.stage !== 'DEAD_DEAL' && (
              <div className="border border-signal p-3" data-testid="panel-new-attempt">
                <p className="eyebrow mb-2">New attempt {(c.attemptNumber ?? 1) + 1}</p>
                <p className="mb-2 text-xs text-muted-foreground">The cancelled contract below is retained. Drafting archives that attempt and starts the next one.</p>
                <CreateContract detail={detail} onDone={done} />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2"><span className={`tag ${STATUS_TONE[c.status]}`} data-testid="tag-contract-status">{STATUS_LABEL[c.status]}</span>
              <span className={`font-mono text-xs ${isOverdue(c.closingAt) && c.status !== 'CLOSED' && c.status !== 'CANCELLED' ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>Closing {fmtDate(c.closingAt)} ({ago(c.closingAt)})</span></div>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4" data-testid="list-contract-terms">
              <div><dt className="eyebrow">Purchase price</dt><dd className="font-mono">{money(c.purchasePrice)}</dd></div>
              <div><dt className="eyebrow">Earnest money</dt><dd className="font-mono">{money(c.earnestMoney)}</dd></div>
              <div><dt className="eyebrow">Assignment target</dt><dd className="font-mono">{money(c.assignmentTarget)}</dd></div>
              <div><dt className="eyebrow">Assignment</dt><dd>{c.assignmentAllowed ? 'Allowed' : 'Not allowed'}</dd></div>
              <div className="sm:col-span-2 lg:col-span-4"><dt className="eyebrow">Contingencies</dt><dd className="whitespace-pre-wrap">{c.contingencies}</dd></div>
            </dl>
            <PurchaseReviewDocuments contract={c} onDone={done} />
            {c.status === 'DRAFT' && <ExecuteContract key={c.version} contract={c} onDone={done} />}
            {c.executedDocumentUrl && <p className="text-sm"><EvidenceLink url={c.executedDocumentUrl} label="Executed document" /> / seller signed {fmtDate(c.sellerSignedAt)} / our side signed {fmtDate(c.acquisitionSignedAt)}{c.reviewNote ? ` / ${c.reviewNote}` : ''}</p>}
          </div>
        )}
      </Block>

      <DistributionPanel detail={detail} contract={c ?? null} matches={ops.matches} onChanged={done} />

      <Block title="Buyers for this deal" tid="panel-matches">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-xl text-sm text-muted-foreground">Matching compares buyer criteria with this property. A match is not a commitment, and only a human-verified buyer can commit.</p>
          <Button size="sm" variant="outline" disabled={!(canResearch || canCall || isOwner) || refresh.isPending} onClick={() => refresh.mutate({ id }, { onSuccess: () => { invalidate(id); toast({ title: 'Matching refreshed' }); } })} data-testid="button-refresh-matches"><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refresh.isPending ? 'animate-spin' : ''}`} />Refresh matches</Button>
        </div>
        {refresh.error != null && <div className="mb-3"><ErrorNotice error={refresh.error} /></div>}
        {ops.matches.length === 0 && <p className="text-sm text-muted-foreground" data-testid="empty-matches">No buyers evaluated yet. <Link href="/buyers" className="underline">Add a buyer</Link> or refresh matching.</p>}
        <ul className="space-y-2">{eligible.map((m) => (
          <li key={m.buyerId} className="border border-border p-3" data-testid={`match-${m.buyerId}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link href={`/buyers/${m.buyerId}`} className="font-semibold hover:text-signal">{m.buyerName}</Link>
              <span className="flex items-center gap-2"><span className="font-mono text-xs">score {m.score}</span><span className={`tag ${m.status === 'COMMITTED' ? 'tone-go' : m.status === 'INTERESTED' ? 'tone-warn' : m.status === 'DECLINED' ? 'tone-stop' : 'tone-muted'}`}>{m.status}</span></span></div>
            <ul className="mt-1 list-disc pl-4 text-sm text-muted-foreground">{m.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            {m.mismatches.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Watch: {m.mismatches.join('; ')}</p>}
            {m.status === 'COMMITTED' && m.agreedPrice != null && <p className="mt-1 font-mono text-xs">Agreed {money(m.agreedPrice)}</p>}
            {m.evidence && <p className="mt-1 text-xs">Evidence: {m.evidence}</p>}
            {(m.destinationKind ?? 'BUYER') !== 'BUYER' && <div className="mt-1 text-xs" data-testid={`text-destination-${m.buyerId}`}><p><span className="tag tone-signal mr-1">{(m.destinationKind ?? '').replace('_', ' ')}</span>Referral route only. Destination replies and fees are not acquisition-buyer interest, commitment, or closing.</p>{m.legacyDestinationResponse && <p className="mt-1 border-l-2 border-warn pl-2">Previous buyer-workflow entry ({m.legacyDestinationResponse.status.replace(/_/g, ' ')}): {m.legacyDestinationResponse.evidence || 'no note'}. It has no retained destination-event time or actor; it is not part of the verified destination history.</p>}</div>}
            {live && c && (m.destinationKind ?? 'BUYER') === 'BUYER' && (respondTo === m.buyerId ? <RespondForm key={`${c.version}:${m.buyerVersion}`} contract={c} match={m} onDone={done} /> :
              <Button size="sm" variant="outline" className="mt-2" onClick={() => setRespondTo(m.buyerId)} data-testid={`button-respond-${m.buyerId}`}>Record buyer response</Button>)}
          </li>))}</ul>
        {!live && eligible.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Buyer responses can be recorded once the contract is executed.</p>}
        {excluded.length > 0 && (
          <details className="mt-3" data-testid="list-excluded"><summary className="cursor-pointer text-sm text-muted-foreground">{excluded.length} buyer{excluded.length === 1 ? '' : 's'} excluded</summary>
            <ul className="mt-2 space-y-1 text-sm">{excluded.map((m) => <li key={m.buyerId}><span className="font-semibold">{m.buyerName}</span>: {m.mismatches.join('; ') || 'does not fit'}
              {m.legacyDestinationResponse && <p className="mt-1 border-l-2 border-warn pl-2 text-xs">Prior buyer-workflow response ({m.legacyDestinationResponse.status.replace(/_/g, ' ')}): {m.legacyDestinationResponse.evidence || 'no note'}. It has no retained destination-event time or actor; it is not verified destination activity.</p>}
            </li>)}</ul></details>
        )}
      </Block>

      {c && (
        <Block title="Deal-finder submissions & referral fees" tid="panel-destination-activity">
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              {c.status === 'DRAFT' ? <p className="text-sm text-muted-foreground">Destination activity is recorded after the acquisition agreement is executed.</p> :
                <DestinationActivityForm key={`${c.version}:${destinations.map((d) => d.buyerId).join(',')}`} contract={c} destinations={destinations} history={destinationActivity} onDone={done} />}
            </div>
            <div className="border-border lg:border-l lg:pl-5"><DestinationActivityHistory events={destinationActivity} /></div>
          </div>
        </Block>
      )}

      <Block title="Closing" tid="panel-closing">
        {!c || c.status === 'DRAFT' ? <p className="text-sm text-muted-foreground">Closing work opens after the contract is executed.</p> : (
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <ul className="space-y-1.5" data-testid="list-milestones">{requiredMilestones(c).map((m) => {
                const x = c.milestones.find((y) => y.kind === m.k);
                return <li key={m.k} className="flex items-start justify-between gap-2 text-sm"><span className={x ? 'font-semibold' : 'text-muted-foreground'}>{m.label}</span>
                  {x ? <span className="text-right text-xs">
                    {x.amount != null && <span className="block">{money(x.amount)} {x.currency} / {x.evidenceKind?.replace(/_/g, ' ')} / {x.counterpartyName} / actual {x.effectiveAt ? fmtDate(x.effectiveAt) : 'date missing'}</span>}
                    {x.paymentReference && <span className="block font-mono">{x.paymentReference}</span>}
                    <EvidenceLink url={x.evidenceUrl} label="evidence" /> / {x.recordedBy} / recorded {fmtDate(x.recordedAt)}
                  </span> : <span className="tag tone-future">open</span>}</li>;
              })}</ul>
              {c.earnestMoney <= 0 && <p className="mt-2 text-xs text-muted-foreground">Authorized purchase terms set acquisition earnest money to $0; no deposit receipt is required for this deal.</p>}
              {c.status === 'CLOSED' || c.status === 'CANCELLED' ? (
                <div className="mt-4 border-t border-border pt-3 text-sm" data-testid="panel-outcome">
                  <p className="font-semibold">{c.status === 'CLOSED' ? 'Closed' : 'Cancelled'}: actual outcome {fmtDate(c.status === 'CLOSED' ? c.closedAt : c.cancelledAt)}</p>
                  <p className="text-xs text-muted-foreground">Recorded in this system: {fmtDate(c.outcomeRecordedAt)}. History and milestone entries have their own recording times.</p>
                  {c.status === 'CLOSED' && <p className="font-mono text-xs">Fee {money(c.assignmentFeeReceived)} / costs {money(c.closingCosts)} / net {money(c.netProceeds)}</p>}
                  <p className="text-muted-foreground">{c.outcomeNote} <EvidenceLink url={c.outcomeEvidenceUrl} label="evidence" /></p></div>
              ) : <>
                <div className="mt-4 border-t border-border pt-3">
                  <MilestoneDeadlineScheduleForm key={`${c.version}:${c.deadlineScheduleVersion}`} contract={c} onDone={done} />
                </div>
                <div className="mt-4 border-t border-border pt-3"><MilestoneForm key={c.version} contract={c} onDone={done} /></div>
              </>}
            </div>
            {c.status !== 'CLOSED' && c.status !== 'CANCELLED' && <div className="border-border lg:border-l lg:pl-5"><p className="eyebrow mb-3">Record outcome</p><OutcomeForm key={c.version} contract={c} onDone={done} /></div>}
          </div>
        )}
      </Block>

        {c && c.status !== 'DRAFT' && (
        <Block title="Exceptions and history" tid="panel-exceptions">
          <div className="grid gap-5 lg:grid-cols-2">
            <ExceptionForm key={`${c.version}:${c.status}:${detail.lead.stage === 'DEAD_DEAL'}`} reopened={detail.lead.stage !== 'DEAD_DEAL'} contract={c} onDone={done} />
            <div className="border-border lg:border-l lg:pl-5"><ExceptionHistory contract={c} /></div>
          </div>
        </Block>
      )}

      {ops.jobs.length > 0 && (
        <Block title="Worker activity on this deal" tid="panel-ops-jobs">
          <ul className="space-y-1 text-sm">{ops.jobs.slice(0, 5).map((j) => <li key={j.id}><span className="tag tone-muted mr-2">{j.state}</span>{j.kind.replace(/_/g, ' ').toLowerCase()}: {j.message || 'pending'} <span className="font-mono text-[11px] text-muted-foreground">{ago(j.updatedAt)}</span></li>)}</ul>
          <Link href="/workers" className="mt-2 inline-block text-xs underline">All worker activity</Link>
        </Block>
      )}
    </div>
  );
}
