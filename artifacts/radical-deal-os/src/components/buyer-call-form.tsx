import { useState } from 'react';

type BuyerOption = { id: string; label: string };
type BuyerCallInput = {
  version: number; buyerId: string; idempotencyKey: string;
  outcome: 'NO_ANSWER'|'VOICEMAIL'|'CONNECTED'|'NOT_INTERESTED';
  notes: string; nextAction: string; followUpAt: string; operatorConfidence: number; occurredAt?: string;
};

export function BuyerCallForm({ version, buyers, disabled, pending, onSubmit }: {
  version: number; buyers: BuyerOption[]; disabled: boolean; pending: boolean;
  onSubmit: (data: BuyerCallInput) => void;
}) {
  const [buyerId,setBuyerId]=useState('');
  const [outcome,setOutcome]=useState<BuyerCallInput['outcome']>('CONNECTED');
  const [notes,setNotes]=useState('');
  const [nextAction,setNextAction]=useState('');
  const [operatorConfidence,setOperatorConfidence]=useState<number|null>(null);
  const [followUpAt,setFollowUpAt]=useState(()=>new Date(Date.now()+86_400_000).toISOString().slice(0,16));
  const [key,setKey]=useState(()=>crypto.randomUUID());
  const submit=(event:React.FormEvent)=>{
    event.preventDefault();
    if(!buyerId||!notes.trim()||nextAction.trim().length<3||operatorConfidence===null||Date.parse(followUpAt)<=Date.now()) return;
    onSubmit({version,buyerId,idempotencyKey:key,outcome,notes:notes.trim(),nextAction:nextAction.trim(),followUpAt:new Date(followUpAt).toISOString(),operatorConfidence});
    setNotes('');setNextAction('');setKey(crypto.randomUUID());
  };
  return <form className="space-y-3 border-t border-border pt-3" onSubmit={submit} data-testid="form-buyer-call">
    <h3 className="text-sm font-semibold">Log buyer call</h3>
    <p className="text-xs text-muted-foreground">This records a human call and buyer-specific follow-up only. It does not establish buyer eligibility, interest approval, commitment, or delivery.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs">Buyer
        <select className="mt-1 h-10 w-full border bg-background px-2" value={buyerId} onChange={e=>setBuyerId(e.target.value)} disabled={disabled||pending} required>
          <option value="">Select a persisted buyer match</option>{buyers.map(b=><option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
      </label>
      <label className="text-xs">Call outcome
        <select className="mt-1 h-10 w-full border bg-background px-2" value={outcome} onChange={e=>setOutcome(e.target.value as BuyerCallInput['outcome'])} disabled={disabled||pending}>
          <option value="CONNECTED">Connected</option><option value="NO_ANSWER">No answer</option><option value="VOICEMAIL">Voicemail</option><option value="NOT_INTERESTED">Not interested</option>
        </select>
      </label>
      <label className="text-xs sm:col-span-2">Original call note
        <textarea className="mt-1 min-h-20 w-full border bg-background p-2 text-sm" value={notes} onChange={e=>setNotes(e.target.value)} maxLength={10000} required />
      </label>
      <label className="text-xs">Next action
        <input className="mt-1 h-10 w-full border bg-background px-2" value={nextAction} onChange={e=>setNextAction(e.target.value)} maxLength={1000} minLength={3} required />
      </label>
      <label className="text-xs">Buyer follow-up due
        <input type="datetime-local" className="mt-1 h-10 w-full border bg-background px-2" value={followUpAt} onChange={e=>setFollowUpAt(e.target.value)} required />
      </label>
      <label className="text-xs">Operator confidence in the call summary
        <select className="mt-1 h-10 w-full border bg-background px-2" value={operatorConfidence ?? ''} onChange={e=>setOperatorConfidence(e.target.value===''?null:Number(e.target.value))} required>
          <option value="">Select confidence</option><option value="0.5">50% · uncertain</option><option value="0.75">75% · likely accurate</option><option value="1">100% · confident</option>
        </select>
      </label>
    </div>
    <button type="submit" disabled={disabled||pending||buyers.length===0} className="border border-signal px-3 py-2 text-sm font-semibold disabled:opacity-50">{pending?'Saving…':'Save buyer call'}</button>
    {!buyers.length&&<p className="text-xs text-muted-foreground">No persisted buyer matches are available to attach to this deal.</p>}
  </form>;
}
