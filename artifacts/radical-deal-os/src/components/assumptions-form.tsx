import { useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ErrorNotice } from '@/components/state-views';
import type { Assumptions, RepairRateCard } from '@workspace/api-client-react';

type Num = Exclude<keyof Assumptions, 'approvalRequired' | 'repairRates' | 'repairRateCatalogVersion'>;
type RateDraft = Omit<RepairRateCard, 'lowRate' | 'expectedRate' | 'highRate' | 'confidence' | 'version'> & {
  lowRate: string; expectedRate: string; highRate: string; confidence: string; version: number;
};
const uid = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `rate-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const rateKey = (rate: Pick<RepairRateCard, 'marketKey' | 'category' | 'severity' | 'unit'>) =>
  [rate.marketKey.trim().toLowerCase(), rate.category.trim().toLowerCase(), rate.severity, rate.unit].join('|');
const rateDraft = (rate: RepairRateCard): RateDraft => ({
  ...rate, lowRate: String(rate.lowRate), expectedRate: String(rate.expectedRate),
  highRate: String(rate.highRate), confidence: String(Math.round(rate.confidence * 100)),
});
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
  const [rates, setRates] = useState<RateDraft[]>(() => value.repairRates.map(rateDraft));
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
    const versions = new Map<string, number>();
    for (const old of ref.current.repairRates) versions.set(rateKey(old), Math.max(versions.get(rateKey(old)) ?? 0, old.version));
    const outRates: RepairRateCard[] = [];
    for (const [index, card] of rates.entries()) {
      const n = `Rate card ${index + 1}`;
      const lowRate = card.lowRate.trim() === '' ? NaN : Number(card.lowRate);
      const expectedRate = card.expectedRate.trim() === '' ? NaN : Number(card.expectedRate);
      const highRate = card.highRate.trim() === '' ? NaN : Number(card.highRate);
      const confidence = card.confidence.trim() === '' ? NaN : Number(card.confidence) / 100;
      if (!card.marketKey.trim() || !card.category.trim() || !card.source.trim() || !card.sourceUrl.trim() || !card.capturedOn || !card.validThrough) {
        return setLocal(`${n}: market, category, source, source link and both dates are required.`);
      }
      if ([lowRate, expectedRate, highRate, confidence].some(Number.isNaN) || lowRate < 0 || !(lowRate <= expectedRate && expectedRate <= highRate) || confidence < 0 || confidence > 1) {
        return setLocal(`${n}: enter non-negative rates in low ≤ expected ≤ high order and confidence from 0 to 100.`);
      }
      if (!/^https?:\/\//i.test(card.sourceUrl.trim()) || card.validThrough < card.capturedOn) {
        return setLocal(`${n}: use an http(s) source and a validity date on or after the source date.`);
      }
      const group = rateKey(card);
      const existing = ref.current.repairRates.find(old => old.id === card.id);
      const version = existing?.version ?? (versions.get(group) ?? 0) + 1;
      versions.set(group, version);
      outRates.push({
        ...card, version, marketKey: card.marketKey.trim().toUpperCase(),
        category: card.category.trim(), source: card.source.trim(), sourceUrl: card.sourceUrl.trim(),
        lowRate, expectedRate, highRate, confidence,
      });
    }
    out.repairRates = outRates;
    out.approvalRequired = true;
    setLocal(null);
    setRates(outRates.map(rateDraft));
    onSave(out);
  };

  const addRate = () => setRates(current => [...current, {
    id: uid(), version: 0, marketKey: '', category: '', severity: 'MODERATE', unit: 'SQFT',
    lowRate: '', expectedRate: '', highRate: '', confidence: '', source: '', sourceUrl: '',
    capturedOn: '', validThrough: '', active: false,
  }]);
  const updateRate = (index: number, patch: Partial<RateDraft>) => setRates(current => current.map((rate, i) => {
    if (i !== index) return rate;
    const updated = { ...rate, ...patch };
    if (patch.active) {
      return updated;
    }
    return updated;
  }));
  const activateRate = (index: number, active: boolean) => setRates(current => {
    const selected = current[index];
    if (!selected) return current;
    return current.map((rate, i) => i !== index && active && rateKey(rate) === rateKey(selected)
      ? { ...rate, active: false }
      : i === index ? { ...rate, active } : rate);
  });

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
      <section className="ledger space-y-3 p-4" data-testid="section-repair-rate-catalog">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Sourced repair cost catalog</h3>
            <p className="max-w-3xl text-xs text-muted-foreground">
              Catalog v{value.repairRateCatalogVersion}. There are no default prices. Add dated local quotes or other reviewable cost sources; old cards stay in history and are deactivated, not overwritten.
            </p>
          </div>
          {canEdit && <Button size="sm" variant="outline" onClick={addRate} disabled={pending} data-testid="button-add-repair-rate"><Plus className="mr-1 h-3.5 w-3.5" />Add sourced rate</Button>}
        </div>
        {rates.length === 0 && <p className="border border-dashed border-border p-3 text-sm text-muted-foreground" data-testid="empty-repair-rate-catalog">No sourced repair rates configured. Automatic estimates will stay blocked until an owner adds applicable, current market rates.</p>}
        <div className="space-y-3">
          {rates.map((rate, index) => {
            const persisted = value.repairRates.some(item => item.id === rate.id);
            const editable = canEdit && !pending && !persisted;
            return (
              <div key={rate.id} className="border border-border p-3" data-testid={`repair-rate-card-${index}`}>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-1"><Label className="text-[11px]">Market key</Label><Input value={rate.marketKey} disabled={!editable} placeholder="PHILADELPHIA-PA" onChange={e => updateRate(index,{marketKey:e.target.value})} /></div>
                  <div className="space-y-1"><Label className="text-[11px]">Repair category</Label><Input value={rate.category} disabled={!editable} placeholder="Roof" onChange={e => updateRate(index,{category:e.target.value})} /></div>
                  <div className="space-y-1"><Label className="text-[11px]">Condition severity</Label><select className="h-9 w-full rounded border bg-background px-2 text-sm" value={rate.severity} disabled={!editable} onChange={e => updateRate(index,{severity:e.target.value as RateDraft['severity']})}><option value="COSMETIC">COSMETIC</option><option value="MODERATE">MODERATE</option><option value="MAJOR">MAJOR</option><option value="REPLACEMENT">REPLACEMENT</option></select></div>
                  <div className="space-y-1"><Label className="text-[11px]">Unit</Label><select className="h-9 w-full rounded border bg-background px-2 text-sm" value={rate.unit} disabled={!editable} onChange={e => updateRate(index,{unit:e.target.value as RateDraft['unit']})}><option value="SQFT">SQFT</option><option value="LINEAR_FT">LINEAR_FT</option><option value="EACH">EACH</option><option value="LUMP_SUM">LUMP_SUM</option></select></div>
                  <div className="space-y-1"><Label className="text-[11px]">Low rate / unit (USD)</Label><Input type="number" min="0" value={rate.lowRate} disabled={!editable} onChange={e => updateRate(index,{lowRate:e.target.value})} /></div>
                  <div className="space-y-1"><Label className="text-[11px]">Expected rate / unit (USD)</Label><Input type="number" min="0" value={rate.expectedRate} disabled={!editable} onChange={e => updateRate(index,{expectedRate:e.target.value})} /></div>
                  <div className="space-y-1"><Label className="text-[11px]">High rate / unit (USD)</Label><Input type="number" min="0" value={rate.highRate} disabled={!editable} onChange={e => updateRate(index,{highRate:e.target.value})} /></div>
                  <div className="space-y-1"><Label className="text-[11px]">Rate confidence (%)</Label><Input type="number" min="0" max="100" value={rate.confidence} disabled={!editable} onChange={e => updateRate(index,{confidence:e.target.value})} /></div>
                  <div className="space-y-1 sm:col-span-2"><Label className="text-[11px]">Source / quote reference</Label><Input value={rate.source} disabled={!editable} onChange={e => updateRate(index,{source:e.target.value})} /></div>
                  <div className="space-y-1 sm:col-span-2"><Label className="text-[11px]">Source URL</Label><Input type="url" value={rate.sourceUrl} disabled={!editable} placeholder="https://…" onChange={e => updateRate(index,{sourceUrl:e.target.value})} /></div>
                  <div className="space-y-1"><Label className="text-[11px]">Source date</Label><Input type="date" value={rate.capturedOn} disabled={!editable} onChange={e => updateRate(index,{capturedOn:e.target.value})} /></div>
                  <div className="space-y-1"><Label className="text-[11px]">Valid through</Label><Input type="date" value={rate.validThrough} disabled={!editable} onChange={e => updateRate(index,{validThrough:e.target.value})} /></div>
                  <div className="flex items-end justify-between gap-3 sm:col-span-2">
                    <label className="flex items-center gap-2 text-sm"><Switch checked={rate.active} disabled={!canEdit || pending} onCheckedChange={active=>activateRate(index,active)} />Active rate v{rate.version || 'new'}</label>
                    {canEdit && !persisted && <Button type="button" size="sm" variant="ghost" onClick={()=>setRates(list=>list.filter((_,i)=>i!==index))}><Trash2 className="mr-1 h-3.5 w-3.5" />Remove draft</Button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
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
