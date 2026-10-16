import { useState } from 'react';
import { addDays, addHours, set as setDate } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ErrorNotice } from '@/components/state-views';
import type { CallInput, CallInputOutcome, Lead } from '@workspace/api-client-react';
import { fromLocalInput, toLocalInput } from '@/lib/format';
import { reuseSellerAnswerDraft } from '@/lib/seller-answer-reuse';
import { editSellerConversationField, extractSellerConversationFields, type SellerConversationField } from '@workspace/deal-domain';

const OUTCOMES: { v: CallInputOutcome; label: string }[] = [
  { v: 'NO_ANSWER', label: 'No answer' }, { v: 'VOICEMAIL', label: 'Left voicemail' },
  { v: 'CONNECTED', label: 'Spoke with seller' }, { v: 'NOT_INTERESTED', label: 'Not interested' },
];
const CONDITION_CATEGORIES = ['ROOF', 'KITCHEN', 'BATH', 'HVAC', 'ELECTRICAL', 'PLUMBING', 'FLOORING', 'EXTERIOR', 'FOUNDATION', 'WINDOWS', 'OTHER'] as const;

export function CallLogForm({ lead, disabled, pending, error, onSubmit, priorAnswers }: {
  lead: Lead; disabled: boolean; pending: boolean; error: unknown; onSubmit: (d: CallInput, done: () => void) => void;
  priorAnswers?: CallInput['sellerAnswers'];
}) {
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [occurredAt, setOccurredAt] = useState(() => toLocalInput(new Date().toISOString()));
  const [outcome, setOutcome] = useState<CallInputOutcome | null>(null);
  const [notes, setNotes] = useState('');
  const [next, setNext] = useState('');
  const [fu, setFu] = useState('');
  const [motivation, setMotivation] = useState('');
  const [urgency, setUrgency] = useState('');
  const [condition, setCondition] = useState('');
  const [conditionsByCategory, setConditionsByCategory] = useState<Record<string, string>>({});
  const [timing, setTiming] = useState('');
  const [askingPrice, setAskingPrice] = useState('');
  const [occupancy, setOccupancy] = useState('');
  const [repairsCompleted, setRepairsCompleted] = useState('');
  const [knownDefects, setKnownDefects] = useState('');
  const [titleTenantIssues, setTitleTenantIssues] = useState('');
  const [accessConstraints, setAccessConstraints] = useState('');
  const [willingnessToAcceptTerms, setWillingnessToAcceptTerms] = useState('');
  const [otherMaterialStatements, setOtherMaterialStatements] = useState('');
  const [sellerNextStep, setSellerNextStep] = useState('');
  const [operatorConfidence, setOperatorConfidence] = useState('0.5');
  const [clarificationStatus, setClarificationStatus] = useState<NonNullable<CallInput['clarificationStatus']>>('UNREVIEWED');
  const [structuredFields, setStructuredFields] = useState<SellerConversationField[]>([]);
  const [extractMessage, setExtractMessage] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const tomorrow = () => setDate(addDays(new Date(), 1), { hours: 9, minutes: 0, seconds: 0 });
  const reusePriorAnswers = () => {
    if (!priorAnswers) return;
    const draft = reuseSellerAnswerDraft(priorAnswers);
    setMotivation(draft.motivation); setUrgency(draft.urgency); setCondition(draft.condition);
    setConditionsByCategory(draft.conditionsByCategory); setTiming(draft.timing);
    setAskingPrice(draft.askingPrice); setOccupancy(draft.occupancy);
    setRepairsCompleted(draft.repairsCompleted); setKnownDefects(draft.knownDefects);
    setTitleTenantIssues(draft.titleTenantIssues); setAccessConstraints(draft.accessConstraints);
    setWillingnessToAcceptTerms(draft.willingnessToAcceptTerms); setSellerNextStep(draft.sellerNextStep);
    setOtherMaterialStatements(draft.otherMaterialStatements);
  };

  const submit = () => {
    if (!outcome) return setLocal('Choose what happened on the call.');
    if (!notes.trim()) return setLocal('Write a note, even one line.');
    if (next.trim().length < 3) return setLocal('Say what happens next (3+ characters).');
    const iso = fromLocalInput(fu);
    if (outcome !== 'NOT_INTERESTED' && (!iso || new Date(iso).getTime() <= Date.now())) return setLocal('Set a future follow-up so this conversation always has a next step.');
    const actualCallAt = fromLocalInput(occurredAt);
    if (!actualCallAt || new Date(actualCallAt).getTime() > Date.now()) return setLocal('Enter when the call actually happened; it cannot be in the future.');
    setLocal(null);
    const price = askingPrice.trim() ? Number(askingPrice) : undefined;
    if (price !== undefined && (!Number.isFinite(price) || price < 0)) return setLocal('Enter a valid non-negative asking price, or leave it blank.');
    const conditionByCategory = Object.entries(conditionsByCategory)
      .filter(([, statement]) => statement.trim())
      .map(([category, statement]) => ({ category: category as typeof CONDITION_CATEGORIES[number], statement: statement.trim() }));
    const extracted = Object.fromEntries(structuredFields.filter(item => item.attribution === 'SELLER_REPORTED').map(item => [item.field, item.value]));
    const priceMatch = String(extracted.DESIRED_PRICE ?? '').match(/\$\s?([\d,]+)/);
    const sellerAnswers = {
      ...(motivation.trim() || extracted.SITUATION ? { motivationStatement: motivation.trim() || extracted.SITUATION } : {}),
      ...(urgency.trim() ? { urgency: urgency.trim() } : {}),
      ...(condition.trim() || extracted.CONDITION ? { conditionDescription: condition.trim() || extracted.CONDITION } : {}),
      ...(conditionByCategory.length ? { conditionByCategory } : {}),
      ...(timing.trim() || extracted.TIMELINE ? { timing: timing.trim() || extracted.TIMELINE } : {}),
      ...(price !== undefined ? { askingPrice: price } : priceMatch ? { askingPrice: Number(priceMatch[1]!.replaceAll(',', '')) } : {}),
      ...(occupancy.trim() || extracted.OCCUPANCY ? { occupancy: occupancy.trim() || extracted.OCCUPANCY } : {}),
      ...(repairsCompleted.trim() ? { repairsCompleted: repairsCompleted.trim() } : {}),
      ...(knownDefects.trim() ? { knownDefects: knownDefects.trim() } : {}),
      ...(titleTenantIssues.trim() ? { titleTenantIssues: titleTenantIssues.trim() } : {}),
      ...(accessConstraints.trim() || extracted.ACCESS ? { accessConstraints: accessConstraints.trim() || extracted.ACCESS } : {}),
      ...(willingnessToAcceptTerms.trim() ? { willingnessToAcceptTerms: willingnessToAcceptTerms.trim() } : {}),
      ...(sellerNextStep.trim() || extracted.FOLLOW_UP ? { nextStepOutcome: sellerNextStep.trim() || extracted.FOLLOW_UP } : {}),
      ...((otherMaterialStatements.trim() || extracted.DECISION_AUTHORITY || extracted.OBJECTIONS) ? { otherMaterialStatements: [otherMaterialStatements, extracted.DECISION_AUTHORITY && `Decision authority: ${extracted.DECISION_AUTHORITY}`, extracted.OBJECTIONS && `Objection: ${extracted.OBJECTIONS}`].filter(Boolean).join('\n') } : {}),
    };
    if (Object.keys(sellerAnswers).length && !['CONNECTED', 'NOT_INTERESTED'].includes(outcome)) {
      return setLocal('Seller answers can only be saved after a connected conversation. For no answer or voicemail, keep notes limited to the call attempt.');
    }
    onSubmit({
      version: lead.version, idempotencyKey, occurredAt: actualCallAt, outcome, notes: notes.trim(), nextAction: next.trim(), followUpAt: iso,
      ...(Object.keys(sellerAnswers).length ? { sellerAnswers } : {}),
      operatorConfidence: Number(operatorConfidence),
      clarificationStatus,
      ...(structuredFields.length ? { structuredFieldsJson: JSON.stringify(structuredFields) } : {}),
    }, () => {
      setIdempotencyKey(crypto.randomUUID()); setOccurredAt(toLocalInput(new Date().toISOString()));
      setOutcome(null); setNotes(''); setNext(''); setFu('');
      setMotivation(''); setUrgency(''); setCondition(''); setConditionsByCategory({}); setTiming(''); setAskingPrice('');
      setOccupancy(''); setRepairsCompleted(''); setKnownDefects(''); setTitleTenantIssues('');
      setAccessConstraints(''); setWillingnessToAcceptTerms(''); setOtherMaterialStatements('');
      setSellerNextStep(''); setOperatorConfidence('0.5'); setClarificationStatus('UNREVIEWED');
       setStructuredFields([]); setExtractMessage('');
    });
  };

  return (
    <div className="space-y-3" data-testid="form-call-log">
      <div className="space-y-1.5"><Label>When did the call happen?</Label>
        <Input type="datetime-local" value={occurredAt} disabled={disabled} onChange={(e) => setOccurredAt(e.target.value)} data-testid="input-call-occurred-at" />
        <p className="text-xs text-muted-foreground">This records your entered call time. The system does not place calls.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {OUTCOMES.map((o) => (
          <button key={o.v} type="button" disabled={disabled} onClick={() => setOutcome(o.v)} data-testid={`button-outcome-${o.v}`}
            className={`border px-3 py-3 text-sm font-medium transition-transform active:scale-[.97] ${outcome === o.v ? 'border-signal bg-signal/15 ring-2 ring-signal/40' : 'border-border bg-card hover:border-foreground/40'}`}>{o.label}</button>
        ))}
      </div>
      <div className="space-y-1.5"><Label>What did you learn?</Label><Textarea rows={4} value={notes} disabled={disabled} onChange={(e) => setNotes(e.target.value)} data-testid="input-call-notes" /></div>
      <Button type="button" variant="outline" disabled={disabled || !notes.trim() || !['CONNECTED', 'NOT_INTERESTED'].includes(outcome ?? '')}
        onClick={() => { const found = extractSellerConversationFields(notes.trim()); setStructuredFields(found); setExtractMessage(found.length ? `Found ${found.length} editable note-backed field(s). Review every item before saving.` : 'No clearly attributable seller statements found. Complete fields manually or ask follow-up questions.'); }}
        data-testid="button-extract-seller-fields">Extract seller details from notes</Button>
      {extractMessage && <p className="text-xs text-muted-foreground" role="status">{extractMessage} Extraction is a draft, not verified fact.</p>}
      {structuredFields.length > 0 && <div className="space-y-2 rounded border p-3" data-testid="seller-structured-fields">
        <b className="text-sm">Editable conversation capture</b>
        {structuredFields.map((field, index) => <div key={`${field.field}-${index}`} className="rounded border-l-2 border-signal pl-3 text-xs">
          <Label>{field.field.replaceAll('_', ' ')} · {field.attribution.replaceAll('_', ' ')} · confidence {Math.round(field.confidence * 100)}%</Label>
          <Input value={field.value} disabled={disabled} onChange={e => setStructuredFields(current => current.map((item, i) => i === index ? editSellerConversationField(item, e.target.value) : item))} />
          <p className="text-muted-foreground">Source note: “{field.sourceQuote}” · characters {field.sourceStart}–{field.sourceEnd}{field.edited ? ` · edited from: ${field.originalValue}` : ''}</p>
        </div>)}
      </div>}
      <details className="rounded-sm border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">Capture seller answers separately</summary>
         <p className="my-2 text-xs text-muted-foreground">Seller statements are timestamped INDICATED evidence linked to this call, not independently verified facts. Material answers flag the current analysis and offer authority for review; they never rewrite authorized economics.</p>
         {priorAnswers && <div className="mb-3 border-l-2 border-signal pl-3">
           <p className="text-xs">Prior call answers are available. Copying is optional; review and edit them to reflect what the seller says on this call. The prior call remains unchanged.</p>
           <Button type="button" size="sm" variant="outline" className="mt-2" disabled={disabled || pending}
             onClick={reusePriorAnswers} data-testid="button-reuse-seller-answers">Reuse prior answers</Button>
         </div>}
        <div className="space-y-2">
          <div className="space-y-1"><Label>Seller's stated motivation</Label><Textarea rows={2} value={motivation} disabled={disabled} onChange={(e) => setMotivation(e.target.value)} /></div>
           <div className="space-y-1"><Label>Urgency or deadline</Label><Input value={urgency} disabled={disabled} onChange={(e) => setUrgency(e.target.value)} /></div>
          <div className="space-y-1"><Label>Condition described by seller</Label><Textarea rows={2} value={condition} disabled={disabled} onChange={(e) => setCondition(e.target.value)} /></div>
           <div className="grid gap-2 sm:grid-cols-2">
             {CONDITION_CATEGORIES.map((category) => <div key={category} className="space-y-1">
               <Label>{category.charAt(0) + category.slice(1).toLowerCase()}</Label>
               <Input value={conditionsByCategory[category] ?? ''} disabled={disabled} onChange={(e) => setConditionsByCategory((current) => ({ ...current, [category]: e.target.value }))} />
             </div>)}
           </div>
          <div className="space-y-1"><Label>Seller's timing</Label><Input value={timing} disabled={disabled} onChange={(e) => setTiming(e.target.value)} /></div>
          <div className="space-y-1"><Label>Seller's stated asking price</Label><Input type="number" min="0" step="1" value={askingPrice} disabled={disabled} onChange={(e) => setAskingPrice(e.target.value)} /></div>
           <div className="space-y-1"><Label>Occupancy</Label><Input value={occupancy} disabled={disabled} onChange={(e) => setOccupancy(e.target.value)} placeholder="Seller-reported; not independently confirmed" /></div>
           <div className="space-y-1"><Label>Repairs already completed</Label><Textarea rows={2} value={repairsCompleted} disabled={disabled} onChange={(e) => setRepairsCompleted(e.target.value)} /></div>
           <div className="space-y-1"><Label>Known defects or problems</Label><Textarea rows={2} value={knownDefects} disabled={disabled} onChange={(e) => setKnownDefects(e.target.value)} /></div>
           <div className="space-y-1"><Label>Liens, title, or tenant issues</Label><Textarea rows={2} value={titleTenantIssues} disabled={disabled} onChange={(e) => setTitleTenantIssues(e.target.value)} /></div>
           <div className="space-y-1"><Label>Access, showing, or inspection constraints</Label><Textarea rows={2} value={accessConstraints} disabled={disabled} onChange={(e) => setAccessConstraints(e.target.value)} /></div>
           <div className="space-y-1"><Label>Willingness to accept terms</Label><Textarea rows={2} value={willingnessToAcceptTerms} disabled={disabled} onChange={(e) => setWillingnessToAcceptTerms(e.target.value)} /></div>
          <div className="space-y-1"><Label>Seller's stated next-step outcome</Label><Textarea rows={2} value={sellerNextStep} disabled={disabled} onChange={(e) => setSellerNextStep(e.target.value)} /></div>
           <div className="space-y-1"><Label>Other material statements</Label><Textarea rows={2} value={otherMaterialStatements} disabled={disabled} onChange={(e) => setOtherMaterialStatements(e.target.value)} /></div>
           <div className="grid gap-2 sm:grid-cols-2">
             <div className="space-y-1"><Label>Operator confidence</Label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={operatorConfidence} disabled={disabled} onChange={(e) => setOperatorConfidence(e.target.value)}><option value="0.3">Low · 0.30</option><option value="0.5">Moderate · 0.50</option><option value="0.75">High · 0.75</option></select></div>
             <div className="space-y-1"><Label>Clarification state</Label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={clarificationStatus} disabled={disabled} onChange={(e) => setClarificationStatus(e.target.value as NonNullable<CallInput['clarificationStatus']>)}><option value="UNREVIEWED">Needs review</option><option value="FOLLOW_UP_REQUIRED">Follow-up required</option><option value="SELLER_CLARIFIED">Seller clarified</option></select></div>
           </div>
        </div>
      </details>
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
