import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ErrorNotice } from '@/components/state-views';
import { Field, SELECT } from '@/components/field-row';
import { fromLocalInput, num } from '@/lib/format';
import type { Buyer, BuyerVerificationInput, BuyerVerificationInputCurrentBuyingStatus } from '@workspace/api-client-react';

export function BuyerVerificationForm({ buyer, disabled, pending, error, onSubmit }: {
  buyer: Buyer; disabled: boolean; pending: boolean; error: unknown; onSubmit: (d: BuyerVerificationInput, done: () => void) => void;
}) {
  const [idUrl, setIdUrl] = useState('');
  const [fundUrl, setFundUrl] = useState('');
  const [note, setNote] = useState('');
  const [funds, setFunds] = useState('');
  const [at, setAt] = useState('');
  const [until, setUntil] = useState('');
  const [bStatus, setBStatus] = useState<BuyerVerificationInputCurrentBuyingStatus | ''>('');
  const [bUrl, setBUrl] = useState(''); const [bAt, setBAt] = useState(''); const [cUrl, setCUrl] = useState('');
  const [vSrc, setVSrc] = useState(''); const [conf, setConf] = useState('');
  const [local, setLocal] = useState<string | null>(null);

  const submit = () => {
    const a = fromLocalInput(at); const u = fromLocalInput(until); const f = num(funds);
    const needFunds = (buyer.destinationKind ?? 'BUYER') === 'BUYER';
    const b = fromLocalInput(bAt); const cf = num(conf);
    if (idUrl.trim().length < 8) return setLocal('Identity evidence link is required.');
    if (needFunds && fundUrl.trim().length < 8) return setLocal('Funding evidence link is required for an actual buyer.');
    if (!bStatus) return setLocal('Select the current buying status.');
    if (bUrl.trim().length < 8 || cUrl.trim().length < 8) return setLocal('Buying and criteria evidence links are required.');
    if (vSrc.trim().length < 3) return setLocal('Name the verification source.');
    if (!Number.isFinite(cf) || cf < 0 || cf > 1) return setLocal('Confidence is between 0 and 1.');
    if (!b || new Date(b).getTime() > Date.now()) return setLocal('Buying evidence time is required and cannot be in the future.');
    if (note.trim().length < 10) return setLocal('Describe what you reviewed (10+ characters).');
    if (needFunds && (!Number.isFinite(f) || f <= 0)) return setLocal('Enter the funds shown in the evidence.');
    if (!a || !u) return setLocal('Set when the evidence was captured and how long it is valid.');
    const days = (new Date(u).getTime() - new Date(a).getTime()) / 86_400_000;
    if (new Date(a).getTime() > Date.now()) return setLocal('Evidence capture time cannot be in the future.');
    const bd = (new Date(u).getTime() - new Date(b).getTime()) / 86_400_000;
    if (bd <= 0 || bd > 30) return setLocal('Valid-until must be within 30 days of the buying evidence as well.');
    if (days <= 0 || days > 30) return setLocal('Verification may last at most 30 days after the evidence was captured.');
    setLocal(null);
    onSubmit({ version: buyer.version, identityEvidenceUrl: idUrl.trim(), ...(fundUrl.trim() ? { fundingEvidenceUrl: fundUrl.trim() } : {}), verificationNote: note.trim(), ...(Number.isFinite(f) ? { availableFunds: f } : {}), evidenceAt: a, validUntil: u, currentBuyingStatus: bStatus, buyingEvidenceUrl: bUrl.trim(), buyingEvidenceAt: b, criteriaEvidenceUrl: cUrl.trim(), verificationSource: vSrc.trim(), confidence: cf },
      () => { setIdUrl(''); setFundUrl(''); setNote(''); setFunds(''); setAt(''); setUntil(''); setBStatus(''); setBUrl(''); setBAt(''); setCUrl(''); setVSrc(''); setConf(''); });
  };

  return (
    <div className="space-y-3" data-testid="form-buyer-verification">
      <p className="text-xs text-muted-foreground">This records a person's review of evidence you obtained. It is not a bank or API check, and the system does not contact the buyer or any institution.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Identity evidence link"><Input value={idUrl} disabled={disabled} onChange={(e) => setIdUrl(e.target.value)} data-testid="input-verify-identity" /></Field>
        <Field label="Current buying status"><select className={SELECT} value={bStatus} disabled={disabled} onChange={(e) => setBStatus(e.target.value as BuyerVerificationInputCurrentBuyingStatus)} data-testid="select-verify-buying"><option value="">Select</option><option value="BUYING">Buying</option><option value="PAUSED">Paused</option><option value="NOT_BUYING">Not buying</option></select></Field>
        <Field label="Buying evidence link"><Input value={bUrl} disabled={disabled} onChange={(e) => setBUrl(e.target.value)} data-testid="input-verify-buying-url" /></Field>
        <Field label="Buying evidence captured"><Input type="datetime-local" value={bAt} disabled={disabled} onChange={(e) => setBAt(e.target.value)} data-testid="input-verify-buying-at" /></Field>
        <Field label="Criteria evidence link"><Input value={cUrl} disabled={disabled} onChange={(e) => setCUrl(e.target.value)} data-testid="input-verify-criteria-url" /></Field>
        <Field label="Verification source"><Input value={vSrc} disabled={disabled} onChange={(e) => setVSrc(e.target.value)} data-testid="input-verify-source" /></Field>
        <Field label="Confidence 0 to 1" hint="Approval needs 0.65 or more"><Input inputMode="decimal" value={conf} disabled={disabled} onChange={(e) => setConf(e.target.value)} data-testid="input-verify-confidence" /></Field>
        <Field label={(buyer.destinationKind ?? 'BUYER') === 'BUYER' ? 'Funding evidence link' : 'Funding evidence link (optional)'}><Input value={fundUrl} disabled={disabled} onChange={(e) => setFundUrl(e.target.value)} data-testid="input-verify-funding" /></Field>
        <Field label={(buyer.destinationKind ?? 'BUYER') === 'BUYER' ? 'Available funds' : 'Available funds (optional)'}><Input inputMode="decimal" value={funds} disabled={disabled} onChange={(e) => setFunds(e.target.value)} data-testid="input-verify-funds" /></Field>
        <div />
        <Field label="Evidence captured"><Input type="datetime-local" value={at} disabled={disabled} onChange={(e) => setAt(e.target.value)} data-testid="input-verify-at" /></Field>
        <Field label="Valid until" hint="No more than 30 days after capture"><Input type="datetime-local" value={until} disabled={disabled} onChange={(e) => setUntil(e.target.value)} data-testid="input-verify-until" /></Field>
      </div>
      <Field label="Review note"><Textarea rows={3} value={note} disabled={disabled} onChange={(e) => setNote(e.target.value)} data-testid="input-verify-note" /></Field>
      {local && <p className="text-sm text-destructive" data-testid="text-verify-error">{local}</p>}
      {error != null && <ErrorNotice error={error} />}
      <Button onClick={submit} disabled={disabled || pending} data-testid="button-verify-buyer">{pending ? 'Recording...' : 'Record human verification'}</Button>
      {disabled && <p className="text-xs text-muted-foreground">Only the owner can verify buyers.</p>}
    </div>
  );
}
