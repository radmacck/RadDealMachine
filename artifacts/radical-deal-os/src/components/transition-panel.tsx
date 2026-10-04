import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ErrorNotice } from '@/components/state-views';
import { StageBadge } from '@/components/stage-badge';
import type { DealStage, LeadDetail, TransitionInput } from '@workspace/api-client-react';
import { ago, fmtDate, fromLocalInput, isDownstream } from '@/lib/format';
import { useAccess } from '@/hooks/use-access';
import { useBaseVersion } from '@/hooks/use-base-version';

export function TransitionPanel({
  detail, pending, error, disabled, onTransition,
}: { detail: LeadDetail; pending: boolean; error: unknown; disabled: boolean; onTransition: (d: TransitionInput, done: () => void) => void }) {
  const [to, setTo] = useState<DealStage | null>(null);
  const [reason, setReason] = useState('');
  const [next, setNext] = useState('');
  const [fu, setFu] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const { lead, allowedTransitions, transitions } = detail;
  const { canResearch, canCall } = useAccess();
  const { base, stale, rebase } = useBaseVersion(lead.version);
  const choices = allowedTransitions.filter(s => canResearch || (canCall && ['CONTACTED','CONVERSATION','NEGOTIATING','DEAD_DEAL'].includes(s)));
  const needsFollowup = !!to && ['CONTACTED','CONVERSATION','NEGOTIATING'].includes(to);

  const submit = () => {
    if (!to) return;
    if (stale) return setLocal('The lead changed. Review the current stage, then explicitly use the latest version before saving.');
    if (reason.trim().length < 3 || next.trim().length < 3) return setLocal('Reason and next action each need at least 3 characters.');
    const followUpAt = fromLocalInput(fu) ?? (needsFollowup ? lead.followUpAt : null);
    if (needsFollowup && (!followUpAt || Date.parse(followUpAt) <= Date.now())) return setLocal('Seller conversations and negotiation need a future follow-up.');
    setLocal(null);
    onTransition({ version: base, to, reason: reason.trim(), nextAction: next.trim(), followUpAt }, () => { setTo(null); setReason(''); setNext(''); setFu(''); rebase(); });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="ledger p-4" data-testid="panel-transition">
        <p className="eyebrow mb-1">Move stage</p>
        <p className="mb-3 flex items-center gap-2 text-sm">Currently <StageBadge stage={lead.stage} /></p>
        {choices.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-no-transitions">The server allows no stage changes from here right now. Complete the missing research or underwriting inputs first.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {choices.map((s) => (
              <button key={s} type="button" disabled={disabled} onClick={() => { setTo(s); rebase(); setLocal(null); }} data-testid={`button-transition-${s}`}
                className={`border px-2.5 py-1.5 text-left transition-transform active:scale-95 ${to === s ? 'border-signal ring-2 ring-signal/40' : 'border-border hover:border-foreground/40'}`}>
                <StageBadge stage={s} />
              </button>
            ))}
          </div>
        )}
        {choices.some(isDownstream) && <p className="mt-2 text-xs text-muted-foreground">Dashed stages are labels the server accepts. Contracts and closing are later slices and have no screens here.</p>}
        {to && (
          <div className="mt-4 space-y-3 border-t border-border pt-3">
            <p className="flex items-center gap-2 text-sm font-semibold"><StageBadge stage={lead.stage} /><ArrowRight className="h-4 w-4" /><StageBadge stage={to} /></p>
            <div className="space-y-1.5"><Label>Reason</Label><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-transition-reason" /></div>
            <div className="space-y-1.5"><Label>Next action</Label><Input value={next} onChange={(e) => setNext(e.target.value)} data-testid="input-transition-next" /></div>
            <div className="space-y-1.5"><Label>{needsFollowup ? 'Future follow-up (blank keeps the existing date)' : 'Follow up (optional)'}</Label><Input type="datetime-local" value={fu} onChange={(e) => setFu(e.target.value)} data-testid="input-transition-followup" /></div>
            {stale && <div className="border border-destructive p-3 text-sm">This lead changed while you were editing. Review the latest stage and your entries.
              <Button variant="outline" onClick={() => { rebase(); setLocal(null); }} data-testid="button-transition-rebase">Keep entries, use latest version</Button>
            </div>}
            {local && <p className="text-sm text-destructive">{local}</p>}
            {error != null && <ErrorNotice error={error} />}
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setTo(null)} data-testid="button-transition-cancel">Cancel</Button>
              <Button onClick={submit} disabled={pending || disabled || stale || !choices.includes(to)} data-testid="button-transition-confirm">{pending ? 'Moving' : 'Confirm move'}</Button></div>
          </div>
        )}
      </section>
      <section className="ledger p-4" data-testid="panel-history">
        <p className="eyebrow mb-2">Stage history</p>
        {transitions.length === 0 ? <p className="text-sm text-muted-foreground">No transitions recorded.</p> : (
          <ol className="space-y-3 border-l border-border pl-4">
            {[...transitions].reverse().map((t) => (
              <li key={t.id} className="relative" data-testid={`history-${t.id}`}>
                <span className="absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full bg-signal" />
                <p className="flex flex-wrap items-center gap-1.5 text-sm"><span className="tag tone-muted">{t.from.replace(/_/g, ' ')}</span><ArrowRight className="h-3 w-3" /><span className="tag tone-ink">{t.to.replace(/_/g, ' ')}</span></p>
                <p className="mt-1 text-sm">{t.reason}</p>
                <p className="text-xs text-muted-foreground">Next: {t.nextAction}</p>
                <p className="font-mono text-[11px] text-muted-foreground">{t.actor} / {fmtDate(t.createdAt)} ({ago(t.createdAt)})</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
