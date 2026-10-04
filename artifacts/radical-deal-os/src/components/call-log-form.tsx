import { useState } from 'react';
import { addDays, addHours, set as setDate } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ErrorNotice } from '@/components/state-views';
import type { CallInput, CallInputOutcome, Lead } from '@workspace/api-client-react';
import { fromLocalInput, toLocalInput } from '@/lib/format';

const OUTCOMES: { v: CallInputOutcome; label: string }[] = [
  { v: 'NO_ANSWER', label: 'No answer' }, { v: 'VOICEMAIL', label: 'Left voicemail' },
  { v: 'CONNECTED', label: 'Spoke with seller' }, { v: 'NOT_INTERESTED', label: 'Not interested' },
];

export function CallLogForm({ lead, disabled, pending, error, onSubmit }: {
  lead: Lead; disabled: boolean; pending: boolean; error: unknown; onSubmit: (d: CallInput, done: () => void) => void;
}) {
  const [outcome, setOutcome] = useState<CallInputOutcome | null>(null);
  const [notes, setNotes] = useState('');
  const [next, setNext] = useState('');
  const [fu, setFu] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const tomorrow = () => setDate(addDays(new Date(), 1), { hours: 9, minutes: 0, seconds: 0 });

  const submit = () => {
    if (!outcome) return setLocal('Choose what happened on the call.');
    if (!notes.trim()) return setLocal('Write a note, even one line.');
    if (next.trim().length < 3) return setLocal('Say what happens next (3+ characters).');
    const iso = fromLocalInput(fu);
    if (outcome !== 'NOT_INTERESTED' && (!iso || new Date(iso).getTime() <= Date.now())) return setLocal('Set a future follow-up so this conversation always has a next step.');
    setLocal(null);
    onSubmit({ version: lead.version, outcome, notes: notes.trim(), nextAction: next.trim(), followUpAt: iso }, () => { setOutcome(null); setNotes(''); setNext(''); setFu(''); });
  };

  return (
    <div className="space-y-3" data-testid="form-call-log">
      <div className="grid grid-cols-2 gap-2">
        {OUTCOMES.map((o) => (
          <button key={o.v} type="button" disabled={disabled} onClick={() => setOutcome(o.v)} data-testid={`button-outcome-${o.v}`}
            className={`border px-3 py-3 text-sm font-medium transition-transform active:scale-[.97] ${outcome === o.v ? 'border-signal bg-signal/15 ring-2 ring-signal/40' : 'border-border bg-card hover:border-foreground/40'}`}>{o.label}</button>
        ))}
      </div>
      <div className="space-y-1.5"><Label>What did you learn?</Label><Textarea rows={4} value={notes} disabled={disabled} onChange={(e) => setNotes(e.target.value)} data-testid="input-call-notes" /></div>
      <div className="space-y-1.5"><Label>What happens next?</Label><Input value={next} disabled={disabled} onChange={(e) => setNext(e.target.value)} placeholder="Call back after he talks to his sister" data-testid="input-call-next" /></div>
      <div className="space-y-1.5">
        <Label>Follow up{outcome !== 'NOT_INTERESTED' ? ' (required)' : ''}</Label>
        <Input type="datetime-local" value={fu} disabled={disabled} onChange={(e) => setFu(e.target.value)} data-testid="input-call-followup" />
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="tag tone-muted" onClick={() => setFu(toLocalInput(addHours(new Date(), 4).toISOString()))} data-testid="button-fu-4h">In 4 hours</button>
          <button type="button" className="tag tone-muted" onClick={() => setFu(toLocalInput(tomorrow().toISOString()))} data-testid="button-fu-tomorrow">Tomorrow 9 am</button>
          <button type="button" className="tag tone-muted" onClick={() => setFu(toLocalInput(setDate(addDays(new Date(), 3), { hours: 9, minutes: 0 }).toISOString()))} data-testid="button-fu-3d">In 3 days</button>
        </div>
      </div>
      {local && <p className="text-sm text-destructive" data-testid="text-call-local-error">{local}</p>}
      {error != null && <ErrorNotice error={error} />}
      {disabled && <p className="text-xs text-muted-foreground">Your role can read call briefs but not log calls.</p>}
      <Button className="w-full" onClick={submit} disabled={disabled || pending} data-testid="button-save-call">{pending ? 'Saving call' : 'Save call'}</Button>
    </div>
  );
}
