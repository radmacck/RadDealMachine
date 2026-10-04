import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ErrorNotice } from '@/components/state-views';
import { Field } from '@/components/field-row';
import { fromLocalInput, num } from '@/lib/format';
import type { Buyer, BuyerVerificationInput } from '@workspace/api-client-react';

export function BuyerVerificationForm({ buyer, disabled, pending, error, onSubmit }: {
  buyer: Buyer; disabled: boolean; pending: boolean; error: unknown; onSubmit: (d: BuyerVerificationInput, done: () => void) => void;
}) {
  const [idUrl, setIdUrl] = useState('');
  const [fundUrl, setFundUrl] = useState('');
  const [note, setNote] = useState('');
  const [funds, setFunds] = useState('');
  const [at, setAt] = useState('');
  const [until, setUntil] = useState('');
  const [local, setLocal] = useState<string | null>(null);

  const submit = () => {
    const a = fromLocalInput(at); const u = fromLocalInput(until); const f = num(funds);
    if (idUrl.trim().length < 8 || fundUrl.trim().length < 8) return setLocal('Both evidence links are required.');
    if (note.trim().length < 10) return setLocal('Describe what you reviewed (10+ characters).');
    if (!Number.isFinite(f) || f <= 0) return setLocal('Enter the funds shown in the evidence.');
    if (!a || !u) return setLocal('Set when the evidence was captured and how long it is valid.');
    const days = (new Date(u).getTime() - new Date(a).getTime()) / 86_400_000;
    if (new Date(a).getTime() > Date.now()) return setLocal('Evidence capture time cannot be in the future.');
    if (days <= 0 || days > 30) return setLocal('Verification may last at most 30 days after the evidence was captured.');
    setLocal(null);
    onSubmit({ version: buyer.version, identityEvidenceUrl: idUrl.trim(), fundingEvidenceUrl: fundUrl.trim(), verificationNote: note.trim(), availableFunds: f, evidenceAt: a, validUntil: u },
      () => { setIdUrl(''); setFundUrl(''); setNote(''); setFunds(''); setAt(''); setUntil(''); });
  };

  return (
    <div className="space-y-3" data-testid="form-buyer-verification">
      <p className="text-xs text-muted-foreground">This records a person's review of evidence you obtained. It is not a bank or API check, and the system does not contact the buyer or any institution.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Identity evidence link"><Input value={idUrl} disabled={disabled} onChange={(e) => setIdUrl(e.target.value)} data-testid="input-verify-identity" /></Field>
        <Field label="Funding evidence link"><Input value={fundUrl} disabled={disabled} onChange={(e) => setFundUrl(e.target.value)} data-testid="input-verify-funding" /></Field>
        <Field label="Available funds"><Input inputMode="decimal" value={funds} disabled={disabled} onChange={(e) => setFunds(e.target.value)} data-testid="input-verify-funds" /></Field>
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
