import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ErrorNotice } from '@/components/state-views';
import type { IntelligenceInput, IntelligenceInputSourceType, ProvenanceClass } from '@workspace/api-client-react';
import { fromLocalInput, num, toLocalInput } from '@/lib/format';
import type { IntelligenceInputContactPermissionStatus } from '@workspace/api-client-react';

const ALLOWED: Record<ProvenanceClass, IntelligenceInputSourceType[]> = {
  VERIFIED_FACTS: ['PUBLIC_RECORD', 'INSPECTION'],
  OBSERVED: ['PUBLIC_RECORD', 'PERMITTED_LISTING', 'SELLER', 'PUBLIC_PAGE', 'ANALYST', 'INSPECTION'],
  INDICATED: ['SELLER', 'ANALYST', 'PUBLIC_PAGE', 'PERMITTED_LISTING'],
  AI_HYPOTHESIS: ['MODEL', 'ANALYST'],
};

export function IntelligenceForm({
  initialClass, pending, error, onSubmit, onCancel,
}: {
  initialClass: ProvenanceClass; pending: boolean; error: unknown;
  onSubmit: (d: IntelligenceInput) => void; onCancel: () => void;
}) {
  const [cls, setCls] = useState<ProvenanceClass>(initialClass);
  const [sourceType, setSourceType] = useState<IntelligenceInputSourceType>(ALLOWED[initialClass][0]);
  const [category, setCategory] = useState('');
  const [statement, setStatement] = useState('');
  const [source, setSource] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [conf, setConf] = useState(initialClass === 'VERIFIED_FACTS' ? '95' : '60');
  const [captured, setCaptured] = useState(toLocalInput(new Date().toISOString()));
  const [note, setNote] = useState('');
  const [contactPermissionStatus, setContactPermissionStatus] = useState<IntelligenceInputContactPermissionStatus>('NOT_REVIEWED');
  const [contactPermissionEvidenceUrl, setContactPermissionEvidenceUrl] = useState('');
  const [question, setQuestion] = useState('');
  const [action, setAction] = useState('');
  const [local, setLocal] = useState<string | null>(null);

  const changeClass = (c: ProvenanceClass) => {
    setCls(c);
    if (!ALLOWED[c].includes(sourceType)) setSourceType(ALLOWED[c][0]);
  };

  const submit = () => {
    const c = num(conf) / 100;
    if (!category.trim() || !statement.trim() || !source.trim()) return setLocal('Category, statement and source are required.');
    if (Number.isNaN(c) || c < 0 || c > 1) return setLocal('Confidence must be between 0 and 100.');
    if (cls === 'VERIFIED_FACTS' && !note.trim()) return setLocal('A verified fact needs a verification note.');
    if (category.trim().toLowerCase() === 'seller_contact' && contactPermissionStatus === 'PERMITTED' &&
      !/^https:\/\//i.test(contactPermissionEvidenceUrl.trim())) {
      return setLocal('A permitted contact route needs a source link documenting permission.');
    }
    if (cls === 'AI_HYPOTHESIS' && (!question.trim() || !action.trim())) return setLocal('A hypothesis needs a question to ask and an action to take.');
    if (cls === 'AI_HYPOTHESIS' && c >= 1) return setLocal('A hypothesis must have confidence below 100%.');
    const at = fromLocalInput(captured);
    if (!at) return setLocal('Captured time is required.');
    setLocal(null);
    onSubmit({
      classification: cls, category: category.trim(), statement: statement.trim(), source: source.trim(),
      sourceUrl: sourceUrl.trim() || undefined, sourceType, confidence: c, capturedAt: at,
      verificationNote: cls === 'VERIFIED_FACTS' ? note.trim() : undefined,
      ...(category.trim().toLowerCase() === 'seller_contact' ? {
        contactPermissionStatus,
        contactPermissionEvidenceUrl: contactPermissionEvidenceUrl.trim(),
      } : {}),
      question: cls === 'AI_HYPOTHESIS' ? question.trim() : undefined,
      action: cls === 'AI_HYPOTHESIS' ? action.trim() : undefined,
    });
  };

  return (
    <div className="space-y-3" data-testid="form-intelligence">
      <p className="text-xs text-muted-foreground">Statements are permanent once saved. Add a new one to correct an old one.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Classification</Label>
          <Select value={cls} onValueChange={(v) => changeClass(v as ProvenanceClass)}>
            <SelectTrigger data-testid="select-classification"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(ALLOWED) as ProvenanceClass[]).map((k) => <SelectItem key={k} value={k}>{k.replace(/_/g, ' ')}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Source type</Label>
          <Select value={sourceType} onValueChange={(v) => setSourceType(v as IntelligenceInputSourceType)}>
            <SelectTrigger data-testid="select-source-type"><SelectValue /></SelectTrigger>
            <SelectContent>{ALLOWED[cls].map((k) => <SelectItem key={k} value={k}>{k.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5"><Label>Category</Label><Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Roof, tax status, occupancy" data-testid="input-intel-category" /></div>
        <div className="space-y-1.5"><Label>Confidence (%)</Label><Input type="number" min={0} max={100} value={conf} onChange={(e) => setConf(e.target.value)} data-testid="input-intel-confidence" /></div>
      </div>
      <div className="space-y-1.5"><Label>Statement</Label><Textarea rows={3} value={statement} onChange={(e) => setStatement(e.target.value)} data-testid="input-intel-statement" /></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><Label>Source (who or what)</Label><Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="County assessor parcel page" data-testid="input-intel-source" /></div>
        <div className="space-y-1.5"><Label>Source URL (optional)</Label><Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} data-testid="input-intel-url" /></div>
        <div className="space-y-1.5"><Label>Captured at</Label><Input type="datetime-local" value={captured} onChange={(e) => setCaptured(e.target.value)} data-testid="input-intel-captured" /></div>
      </div>
      {cls === 'VERIFIED_FACTS' && (
        <div className="space-y-1.5"><Label>Verification note</Label><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="How exactly was this checked?" data-testid="input-intel-note" /></div>
      )}
      {category.trim().toLowerCase() === 'seller_contact' && (
        <div className="grid gap-3 rounded border border-warn p-3 sm:grid-cols-2" data-testid="seller-contact-permission">
          <div className="space-y-1.5">
            <Label>Contact permission status</Label>
            <Select value={contactPermissionStatus} onValueChange={(value) => setContactPermissionStatus(value as IntelligenceInputContactPermissionStatus)}>
              <SelectTrigger data-testid="select-contact-permission"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NOT_REVIEWED">Not reviewed</SelectItem>
                <SelectItem value="PERMITTED">Permitted — evidence required</SelectItem>
                <SelectItem value="PROHIBITED">Prohibited</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Permission evidence URL (required if permitted)</Label>
            <Input value={contactPermissionEvidenceUrl} onChange={(event) => setContactPermissionEvidenceUrl(event.target.value)}
              placeholder="https://…" data-testid="input-contact-permission-evidence" />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Public availability is not permission. Keep unreviewed or prohibited routes in the evidence history, but only a permitted route with its evidence can make a lead CALL READY.
          </p>
        </div>
      )}
      {cls === 'AI_HYPOTHESIS' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Question to ask the seller</Label><Textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} data-testid="input-intel-question" /></div>
          <div className="space-y-1.5"><Label>Action to confirm it</Label><Textarea rows={2} value={action} onChange={(e) => setAction(e.target.value)} data-testid="input-intel-action" /></div>
        </div>
      )}
      {local && <p className="text-sm text-destructive" data-testid="text-intel-local-error">{local}</p>}
      {error != null && <ErrorNotice error={error} />}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} data-testid="button-intel-cancel">Cancel</Button>
        <Button onClick={submit} disabled={pending} data-testid="button-intel-save">{pending ? 'Saving' : 'Record statement'}</Button>
      </div>
    </div>
  );
}
