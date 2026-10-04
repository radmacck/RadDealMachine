import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ErrorNotice } from '@/components/state-views';
import type { Assumptions } from '@workspace/api-client-react';

type Num = Exclude<keyof Assumptions, 'approvalRequired'>;
interface Field { key: Num; label: string; unit: '$' | '%' | 'months' | 'days' | 'miles' | 'count'; hint: string }
const GROUPS: { title: string; fields: Field[] }[] = [
  { title: 'Value', fields: [
    { key: 'arvMultiplier', label: 'ARV haircut: use this share of ARV', unit: '%', hint: '10 to 100' },
    { key: 'sellingCostPct', label: 'Selling cost', unit: '%', hint: 'Percent of ARV, 0 to 50' },
    { key: 'contingencyPct', label: 'Repair contingency', unit: '%', hint: 'Percent added to repairs, 0 to 100' } ] },
  { title: 'Costs and margin', fields: [
    { key: 'acquisitionCost', label: 'Acquisition and closing cost', unit: '$', hint: 'USD per deal' },
    { key: 'holdingMonthly', label: 'Holding cost per month', unit: '$', hint: 'USD' },
    { key: 'holdingMonths', label: 'Holding period', unit: 'months', hint: '0 to 120' },
    { key: 'assignmentTarget', label: 'Assignment fee target', unit: '$', hint: 'USD' },
    { key: 'strongMargin', label: 'Margin needed to rate STRONG', unit: '$', hint: 'USD' } ] },
  { title: 'Opening range', fields: [
    { key: 'openingLowPct', label: 'Opening low', unit: '%', hint: 'Percent of MAO' },
    { key: 'openingHighPct', label: 'Opening high', unit: '%', hint: 'Percent of MAO' } ] },
  { title: 'Comp rules', fields: [
    { key: 'maxCompAgeDays', label: 'Oldest usable comp', unit: 'days', hint: '1 to 1095' },
    { key: 'maxDistanceMiles', label: 'Farthest usable comp', unit: 'miles', hint: 'Up to 100' },
    { key: 'maxSqftDifferencePct', label: 'Largest size difference', unit: '%', hint: 'Percent of subject sqft' },
    { key: 'minComps', label: 'Minimum comps', unit: 'count', hint: '3 to 20' },
    { key: 'minConfidence', label: 'Minimum confidence to call', unit: '%', hint: '30 to 100' } ] },
];
const PCT: Num[] = ['arvMultiplier', 'sellingCostPct', 'contingencyPct', 'openingLowPct', 'openingHighPct', 'maxSqftDifferencePct', 'minConfidence'];
const show = (k: Num, n: number) => String(PCT.includes(k) ? Math.round(n * 10000) / 100 : n);

export function AssumptionsForm({ value, pending, error, canEdit, onSave }: {
  value: Assumptions; pending: boolean; error: unknown; canEdit: boolean; onSave: (a: Assumptions) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(GROUPS.flatMap((g) => g.fields).map((f) => [f.key, show(f.key, value[f.key])])));
  const [local, setLocal] = useState<string | null>(null);
  const ref = useRef(value);
  ref.current = value;

  const save = () => {
    const out = { ...ref.current } as Assumptions;
    for (const f of GROUPS.flatMap((g) => g.fields)) {
      const n = draft[f.key].trim() === '' ? NaN : Number(draft[f.key]);
      if (Number.isNaN(n)) return setLocal(`${f.label}: enter a number.`);
      out[f.key] = PCT.includes(f.key) ? n / 100 : n;
    }
    out.approvalRequired = true;
    setLocal(null);
    onSave(out);
  };

  return (
    <div className="space-y-5" data-testid="form-assumptions">
      {GROUPS.map((g) => (
        <section key={g.title} className="ledger p-4">
          <h3 className="mb-3 text-lg font-semibold">{g.title}</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.fields.map((f) => (
              <div key={f.key} className="space-y-1">
                <Label htmlFor={`as-${f.key}`} className="text-xs">{f.label}</Label>
                <div className="flex items-center border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
                  {f.unit === '$' && <span className="pl-2 font-mono text-sm text-muted-foreground">$</span>}
                  <Input id={`as-${f.key}`} type="number" step="any" className="border-0 shadow-none focus-visible:ring-0" value={draft[f.key]} disabled={!canEdit}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} data-testid={`input-assumption-${f.key}`} />
                  {f.unit !== '$' && <span className="pr-2 font-mono text-xs text-muted-foreground">{f.unit}</span>}
                </div>
                <p className="text-[11px] text-muted-foreground">{f.hint}</p>
              </div>
            ))}
          </div>
        </section>
      ))}
      <section className="ledger flex items-center justify-between gap-3 p-4">
        <div><p className="font-semibold">Approval required before any offer</p><p className="text-xs text-muted-foreground">Locked on. Offer authorization is not built in this slice, and approvals cannot be turned off.</p></div>
        <Switch checked disabled data-testid="switch-approval-required" />
      </section>
      {local && <p className="text-sm text-destructive" data-testid="text-assumption-local-error">{local}</p>}
      {error != null && <ErrorNotice error={error} />}
      {canEdit
        ? <div className="flex justify-end"><Button onClick={save} disabled={pending} data-testid="button-save-assumptions">{pending ? 'Saving' : 'Save assumptions'}</Button></div>
        : <p className="text-sm text-muted-foreground" data-testid="text-assumptions-readonly">Only the owner can change assumptions.</p>}
    </div>
  );
}
