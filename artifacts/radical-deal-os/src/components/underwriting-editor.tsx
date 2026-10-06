import type { ReactNode } from 'react';
import { useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ErrorNotice } from '@/components/state-views';
import type { Comp, CompCondition, Intelligence, Repair, RepairObservation, UnderwritingInput } from '@workspace/api-client-react';
import { PROPERTY_TYPES, REPAIR_CATEGORIES, money, num, toDateInput } from '@/lib/format';
import { SELECT } from '@/components/field-row';
import { useBaseVersion } from '@/hooks/use-base-version';

interface CompD { id: string; address: string; salePrice: string; sqft: string; soldAt: string; distanceMiles: string; propertyType: string; condition: CompCondition; source: string; verified: boolean; saleEv: string; condEv: string }
interface RepD { key: string; category: string; low: string; expected: string; high: string; confidence: string; source: string; ev: string }
interface ObsD { key: string; category: string; severity: RepairObservation['severity']; quantity: string; unit: RepairObservation['unit']; ev: string }

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()).slice(2));
const compToD = (c: Comp): CompD => ({ id: c.id, address: c.address, salePrice: String(c.salePrice), sqft: String(c.sqft), soldAt: toDateInput(c.soldAt), distanceMiles: String(c.distanceMiles), propertyType: c.propertyType, condition: c.condition, source: c.source, verified: c.verified, saleEv: c.saleEvidenceId ?? '', condEv: c.conditionEvidenceId ?? '' });
const repToD = (r: Repair): RepD => ({ key: uid(), category: r.category, low: String(r.low), expected: String(r.expected), high: String(r.high), confidence: String(Math.round(r.confidence * 100)), source: r.source, ev: r.evidenceId ?? '' });
const observationToD = (o: RepairObservation): ObsD => ({ key: uid(), category: o.category, severity: o.severity, quantity: String(o.quantity), unit: o.unit, ev: o.evidenceId });

export function UnderwritingEditor({
  leadVersion, server, intelligence, pending, error, disabled, onSave, onDiscard,
}: {
  leadVersion: number; server: UnderwritingInput | null; intelligence: Intelligence[]; pending: boolean; error: unknown; disabled: boolean;
  onSave: (d: UnderwritingInput, done: () => void) => void; onDiscard: () => void;
}) {
  const { base, stale, rebase } = useBaseVersion(leadVersion);
  const [comps, setComps] = useState<CompD[]>(() => (server?.comps ?? []).map(compToD));
  const [repairs, setRepairs] = useState<RepD[]>(() => (server?.repairObservations?.length ? [] : (server?.repairs ?? []).map(repToD)));
  const [observations, setObservations] = useState<ObsD[]>(() => (server?.repairObservations ?? []).map(observationToD));
  const [repairsComplete, setRC] = useState(server?.repairsComplete ?? false);
  const [conditionConfirmed, setCC] = useState(server?.conditionConfirmed ?? false);
  const [subjEv, setSubjEv] = useState(server?.subjectEvidenceId ?? '');
  const [condEv, setCondEv] = useState(server?.conditionEvidenceId ?? '');
  const [contEv, setContEv] = useState(server?.sellerContactEvidenceId ?? '');
  const [problems, setProblems] = useState<string[]>([]);
  const snapshot = useRef(JSON.stringify([comps, repairs.map(({ key: _k, ...r }) => r), observations.map(({key:_k,...o})=>o), repairsComplete, conditionConfirmed, subjEv, condEv, contEv]));
  const dirty = JSON.stringify([comps, repairs.map(({ key: _k, ...r }) => r), observations.map(({key:_k,...o})=>o), repairsComplete, conditionConfirmed, subjEv, condEv, contEv]) !== snapshot.current;

  const sum = useMemo(() => repairs.reduce((a, r) => ({ low: a.low + (num(r.low) || 0), exp: a.exp + (num(r.expected) || 0), high: a.high + (num(r.high) || 0) }), { low: 0, exp: 0, high: 0 }), [repairs]);

  const upC = (i: number, p: Partial<CompD>) => setComps((l) => l.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const upR = (i: number, p: Partial<RepD>) => setRepairs((l) => l.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const upO = (i: number, p: Partial<ObsD>) => setObservations((l) => l.map((o, j) => {
    if (j !== i) return o;
    const next = { ...o, ...p };
    if (p.severity === 'NO_REPAIR') next.quantity = '0';
    else if (p.severity && o.severity === 'NO_REPAIR') next.quantity = '1';
    if (p.category && p.category !== o.category) next.ev = '';
    return next;
  }));
  const addComp = () => setComps((l) => [...l, { id: uid(), address: '', salePrice: '', sqft: '', soldAt: '', distanceMiles: '', propertyType: 'SINGLE_FAMILY', condition: 'UNKNOWN', source: '', verified: false, saleEv: '', condEv: '' }]);
  const addRepair = (category = '') => setRepairs((l) => [...l, { key: uid(), category, low: '', expected: '', high: '', confidence: '60', source: '', ev: '' }]);
  const addObservation = () => setObservations((l) => [...l, { key: uid(), category: REPAIR_CATEGORIES[0] ?? '', severity: 'MODERATE', quantity: '1', unit: 'EACH', ev: '' }]);
  const missing = REPAIR_CATEGORIES.filter((c) => !repairs.some((r) => r.category.toLowerCase() === c.toLowerCase()));

  const save = () => {
    const errs: string[] = [];
    const outComps: Comp[] = comps.map((c, i) => {
      const n = `Comp ${i + 1}`;
      const sp = num(c.salePrice), sq = num(c.sqft), di = num(c.distanceMiles);
      if (c.address.trim().length < 3) errs.push(`${n}: address needs at least 3 characters.`);
      if (!(sp > 0)) errs.push(`${n}: sale price must be above 0.`);
      if (!(sq > 0)) errs.push(`${n}: square feet must be above 0.`);
      if (!c.soldAt) errs.push(`${n}: sold date is required.`);
      if (Number.isNaN(di) || di < 0) errs.push(`${n}: distance must be 0 or more.`);
      if (!c.source.trim()) errs.push(`${n}: source is required.`);
      return { id: c.id, address: c.address.trim(), salePrice: sp, sqft: sq, soldAt: c.soldAt, distanceMiles: di, propertyType: c.propertyType, condition: c.condition, source: c.source.trim(), verified: c.verified, ...(c.saleEv ? { saleEvidenceId: c.saleEv } : {}), ...(c.condEv ? { conditionEvidenceId: c.condEv } : {}) };
    });
    const outRep: Repair[] = observations.length ? [] : repairs.map((r, i) => {
      const n = `Repair ${i + 1}`;
      const lo = num(r.low), ex = num(r.expected), hi = num(r.high), cf = num(r.confidence) / 100;
      if (!r.category.trim()) errs.push(`${n}: category is required.`);
      if ([lo, ex, hi].some((x) => Number.isNaN(x) || x < 0)) errs.push(`${n}: low, expected and high must be 0 or more.`);
      else if (!(lo <= ex && ex <= hi)) errs.push(`${n}: low must be at most expected, expected at most high.`);
      if (Number.isNaN(cf) || cf < 0 || cf > 1) errs.push(`${n}: confidence must be 0 to 100.`);
      if (!r.source.trim()) errs.push(`${n}: source is required.`);
      return { category: r.category.trim(), low: lo, expected: ex, high: hi, confidence: cf, source: r.source.trim(), ...(r.ev ? { evidenceId: r.ev } : {}) };
    });
    const outObs: RepairObservation[] = observations.map((o, i) => {
      const n = `Condition observation ${i + 1}`;
      const quantity = num(o.quantity);
      if (!o.category.trim()) errs.push(`${n}: category is required.`);
      if (Number.isNaN(quantity) || quantity < 0) errs.push(`${n}: measured quantity must be 0 or more.`);
      if (o.severity === 'NO_REPAIR' && quantity !== 0) errs.push(`${n}: NO_REPAIR requires quantity 0.`);
      if (o.severity !== 'NO_REPAIR' && quantity <= 0) errs.push(`${n}: positive measured quantity is required.`);
      if (o.unit === 'LUMP_SUM' && o.severity !== 'NO_REPAIR' && quantity !== 1) errs.push(`${n}: LUMP_SUM quantity must be 1.`);
      if (!o.ev) errs.push(`${n}: link reviewed inspection evidence for this category.`);
      return { category: o.category.trim(), severity: o.severity, quantity, unit: o.unit, evidenceId: o.ev };
    });
    setProblems(errs);
    if (errs.length) return;
    onSave({ version: base, comps: outComps, repairs: outObs.length ? [] : outRep, ...(outObs.length ? { repairObservations: outObs } : {}), repairsComplete, conditionConfirmed, ...(subjEv ? { subjectEvidenceId: subjEv } : {}), ...(condEv ? { conditionEvidenceId: condEv } : {}), ...(contEv ? { sellerContactEvidenceId: contEv } : {}) }, () => {
      rebase();
      snapshot.current = JSON.stringify([comps, repairs.map(({ key: _k, ...r }) => r), observations.map(({key:_k,...o})=>o), repairsComplete, conditionConfirmed, subjEv, condEv, contEv]);
    });
  };

  const evSel = (value: string, set: (v: string) => void, tid: string) => (
    <select className={SELECT} value={value} disabled={disabled} onChange={(e) => set(e.target.value)} data-testid={tid}>
      <option value="">No evidence linked</option>
      {value && !intelligence.some((x) => x.id === value) && <option value={value}>{value} (not in this deal)</option>}
      {intelligence.map((x) => <option key={x.id} value={x.id}>{x.classification.replace(/_/g, ' ')} / {x.category} / {x.statement.slice(0, 60)}</option>)}
    </select>);
  const repairEvSel = (category: string, value: string, set: (v: string) => void, tid: string) => {
    const matches = intelligence.filter((entry) => entry.category.trim().toLowerCase() === `repair_scope:${category.trim().toLowerCase()}`);
    const eligible = matches.filter((entry) => entry.sourceType === 'INSPECTION' && entry.classification === 'VERIFIED_FACTS' && Boolean(entry.sourceUrl && entry.verificationNote));
    return (
      <select className={SELECT} value={value} disabled={disabled} onChange={(e) => set(e.target.value)} data-testid={tid}>
        <option value="">Choose reviewed inspection evidence</option>
        {value && !eligible.some((entry) => entry.id === value) && <option value={value}>Previously linked evidence — review required</option>}
        {eligible.map((entry) => <option key={entry.id} value={entry.id}>{entry.capturedAt.slice(0,10)} / {entry.source} / {entry.statement.slice(0,60)}</option>)}
      </select>
    );
  };
  const cell = (label: string, el: ReactNode, cls = '') => (<div className={`space-y-1 ${cls}`}><Label className="text-[11px] text-muted-foreground">{label}</Label>{el}</div>);

  return (
    <div className="space-y-6" data-testid="underwriting-editor">
      {stale && (
        <div className="border border-signal bg-card p-3 text-sm" data-testid="notice-uw-stale">
          This lead is now at version {leadVersion}; your draft started from {base}. Nothing you typed has been touched.
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="outline" onClick={rebase} data-testid="button-uw-rebase">Keep draft, save over latest</Button>
            <Button size="sm" variant="ghost" onClick={onDiscard} data-testid="button-uw-discard">Discard draft, load latest</Button>
          </div>
        </div>
      )}
      <section className="ledger space-y-2 p-3" data-testid="section-uw-evidence">
        <h3 className="text-xl font-semibold">Evidence links</h3>
        <p className="text-xs text-muted-foreground">Link existing statements. Linking does not mark anything reviewed; the backend decides whether each record qualifies.</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {cell('Subject property record', evSel(subjEv, setSubjEv, 'select-uw-subject-evidence'))}
          {cell('Condition evidence', evSel(condEv, setCondEv, 'select-uw-condition-evidence'))}
          {cell('Seller contact evidence', evSel(contEv, setContEv, 'select-uw-contact-evidence'))}
        </div>
      </section>
      <section>
        <div className="mb-2 flex items-center justify-between">
          <div><h3 className="text-xl font-semibold">Comparable sales <span className="font-mono text-sm text-muted-foreground">{comps.length}</span></h3>
            <p className="text-xs text-muted-foreground">Mark a comp verified only if you checked the sale against a public record.</p></div>
          <Button size="sm" variant="outline" onClick={addComp} disabled={disabled} data-testid="button-add-comp"><Plus className="mr-1 h-3.5 w-3.5" />Add comp</Button>
        </div>
        {comps.length === 0 && <p className="border border-dashed border-border p-4 text-sm text-muted-foreground" data-testid="empty-comps">No comps yet. The engine needs the configured minimum before it will rate this lead.</p>}
        <div className="space-y-2">
          {comps.map((c, i) => (
            <div key={c.id} className="ledger grid gap-2 p-3 sm:grid-cols-12" data-testid={`row-comp-${i}`}>
              {cell('Address', <Input value={c.address} disabled={disabled} onChange={(e) => upC(i, { address: e.target.value })} data-testid={`input-comp-address-${i}`} />, 'sm:col-span-5')}
              {cell('Sale price (USD)', <Input type="number" value={c.salePrice} disabled={disabled} onChange={(e) => upC(i, { salePrice: e.target.value })} data-testid={`input-comp-price-${i}`} />, 'sm:col-span-2')}
              {cell('Sq ft', <Input type="number" value={c.sqft} disabled={disabled} onChange={(e) => upC(i, { sqft: e.target.value })} data-testid={`input-comp-sqft-${i}`} />, 'sm:col-span-2')}
              {cell('Sold on', <Input type="date" value={c.soldAt} disabled={disabled} onChange={(e) => upC(i, { soldAt: e.target.value })} data-testid={`input-comp-sold-${i}`} />, 'sm:col-span-3')}
              {cell('Distance (miles)', <Input type="number" step="0.1" value={c.distanceMiles} disabled={disabled} onChange={(e) => upC(i, { distanceMiles: e.target.value })} data-testid={`input-comp-distance-${i}`} />, 'sm:col-span-2')}
              {cell('Property type', (
                <Select value={PROPERTY_TYPES.includes(c.propertyType as never) ? c.propertyType : 'OTHER'} onValueChange={(v) => upC(i, { propertyType: v })} disabled={disabled}>
                  <SelectTrigger data-testid={`select-comp-type-${i}`}><SelectValue /></SelectTrigger>
                  <SelectContent>{PROPERTY_TYPES.map((p) => <SelectItem key={p} value={p}>{p.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
                </Select>), 'sm:col-span-3')}
              {cell('Condition vs. subject', (
                <Select value={c.condition} onValueChange={(v) => upC(i, { condition: v as CompCondition })} disabled={disabled}>
                  <SelectTrigger data-testid={`select-comp-condition-${i}`}><SelectValue /></SelectTrigger>
                  <SelectContent>{['RENOVATED', 'SIMILAR', 'UNKNOWN'].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>), 'sm:col-span-3')}
              {cell('Source', <Input value={c.source} disabled={disabled} onChange={(e) => upC(i, { source: e.target.value })} data-testid={`input-comp-source-${i}`} />, 'sm:col-span-2')}
              {cell('Sale evidence', evSel(c.saleEv, (v) => upC(i, { saleEv: v }), `select-comp-sale-evidence-${i}`), 'sm:col-span-6')}
              {cell('Condition evidence', evSel(c.condEv, (v) => upC(i, { condEv: v }), `select-comp-condition-evidence-${i}`), 'sm:col-span-6')}
              <div className="flex items-end justify-between gap-2 sm:col-span-12">
                <label className="flex items-center gap-2 text-sm"><Switch checked={c.verified} disabled={disabled} onCheckedChange={(v) => upC(i, { verified: v })} data-testid={`switch-comp-verified-${i}`} />Verified against public record</label>
                <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setComps((l) => l.filter((_, j) => j !== i))} data-testid={`button-remove-comp-${i}`}><Trash2 className="mr-1 h-3.5 w-3.5" />Remove</Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="ledger space-y-3 p-3" data-testid="section-repair-observations">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold">Condition observations → automatic repair estimate</h3>
            <p className="max-w-3xl text-xs text-muted-foreground">Record measured condition from reviewed inspection evidence. Saving calculates and persists low / expected / high from the active market cost catalog. Raw assessor codes, seller statements, and AI hypotheses cannot establish scope or price.</p>
          </div>
          <Button size="sm" variant="outline" onClick={addObservation} disabled={disabled} data-testid="button-add-repair-observation"><Plus className="mr-1 h-3.5 w-3.5" />Add observed scope</Button>
        </div>
        {observations.length === 0 && <p className="border border-dashed border-border p-3 text-sm text-muted-foreground">No condition observations recorded. Use the manual quote section below only when a sourced contractor or inspector estimate already provides ranges.</p>}
        <div className="space-y-2">
          {observations.map((o, i) => (
            <div key={o.key} className="grid gap-2 border border-border p-3 sm:grid-cols-12" data-testid={`row-repair-observation-${i}`}>
              {cell('Repair category', <Input list="repair-cats" value={o.category} disabled={disabled} onChange={e=>upO(i,{category:e.target.value})} data-testid={`input-observation-category-${i}`} />, 'sm:col-span-3')}
              {cell('Observed condition', <Select value={o.severity} onValueChange={v=>upO(i,{severity:v as RepairObservation['severity']})} disabled={disabled}><SelectTrigger data-testid={`select-observation-severity-${i}`}><SelectValue /></SelectTrigger><SelectContent>{['NO_REPAIR','COSMETIC','MODERATE','MAJOR','REPLACEMENT'].map(v=><SelectItem key={v} value={v}>{v.replace(/_/g,' ')}</SelectItem>)}</SelectContent></Select>, 'sm:col-span-3')}
              {cell('Measured quantity', <Input type="number" min="0" step="any" value={o.quantity} disabled={disabled || o.severity==='NO_REPAIR'} onChange={e=>upO(i,{quantity:e.target.value})} data-testid={`input-observation-quantity-${i}`} />, 'sm:col-span-2')}
              {cell('Unit', <Select value={o.unit} onValueChange={v=>upO(i,{unit:v as RepairObservation['unit']})} disabled={disabled}><SelectTrigger data-testid={`select-observation-unit-${i}`}><SelectValue /></SelectTrigger><SelectContent>{['SQFT','LINEAR_FT','EACH','LUMP_SUM'].map(v=><SelectItem key={v} value={v}>{v.replace(/_/g,' ')}</SelectItem>)}</SelectContent></Select>, 'sm:col-span-2')}
              {cell('Reviewed inspection evidence', repairEvSel(o.category,o.ev,v=>upO(i,{ev:v}),`select-observation-evidence-${i}`), 'sm:col-span-10')}
              <div className="flex items-end justify-end sm:col-span-2"><Button size="sm" variant="ghost" disabled={disabled} onClick={()=>setObservations(list=>list.filter((_,j)=>j!==i))} data-testid={`button-remove-observation-${i}`}><Trash2 className="mr-1 h-3.5 w-3.5" />Remove</Button></div>
            </div>
          ))}
        </div>
        {server?.repairEstimate && server.repairEstimate.status !== 'NOT_USED' && (
          <div className={`border p-3 text-sm ${server.repairEstimate.status==='BLOCKED'?'border-destructive/40 bg-destructive/5':'border-border'}`} data-testid="saved-repair-estimate">
            <p className="font-semibold">Saved estimate: {server.repairEstimate.status} · {server.repairEstimate.marketKey} · cost catalog v{server.repairEstimate.catalogVersion}</p>
            {server.repairEstimate.total && <p className="mt-1 font-mono">{money(server.repairEstimate.total.low)} / {money(server.repairEstimate.total.expected)} / {money(server.repairEstimate.total.high)} USD</p>}
            {server.repairEstimate.lines.map((line,index)=><p key={`${line.evidenceId}-${index}`} className="mt-1 text-xs">{line.category}: {line.source} · evidence {line.evidenceId}</p>)}
            {server.repairEstimate.blockers.map((blocker,index)=><p key={index} className="mt-1 text-xs text-destructive">{blocker}</p>)}
          </div>
        )}
      </section>

      {observations.length===0 && <section>
        <div className="mb-2 flex items-center justify-between">
          <div><h3 className="text-xl font-semibold">Manual quote lines</h3>
            <p className="text-xs text-muted-foreground">Only use these when a current sourced quote already gives low / expected / high. These amounts are not automatically inferred from condition.</p></div>
          <Button size="sm" variant="outline" onClick={() => addRepair()} disabled={disabled} data-testid="button-add-repair"><Plus className="mr-1 h-3.5 w-3.5" />Custom line</Button>
        </div>
        {missing.length > 0 && !disabled && (
          <div className="mb-2 flex flex-wrap gap-1.5" data-testid="chips-repair-categories">
            {missing.map((m) => <button key={m} type="button" onClick={() => addRepair(m)} className="tag tone-muted hover:tone-ink" data-testid={`chip-repair-${m}`}>+ {m}</button>)}
          </div>
        )}
        <div className="space-y-2">
          {repairs.map((r, i) => (
            <div key={r.key} className="ledger grid gap-2 p-3 sm:grid-cols-12" data-testid={`row-repair-${i}`}>
              {cell('Category', <Input list="repair-cats" value={r.category} disabled={disabled} onChange={(e) => upR(i, { category: e.target.value })} data-testid={`input-repair-category-${i}`} />, 'sm:col-span-3')}
              {cell('Low', <Input type="number" value={r.low} disabled={disabled} onChange={(e) => upR(i, { low: e.target.value })} data-testid={`input-repair-low-${i}`} />, 'sm:col-span-2')}
              {cell('Expected', <Input type="number" value={r.expected} disabled={disabled} onChange={(e) => upR(i, { expected: e.target.value })} data-testid={`input-repair-expected-${i}`} />, 'sm:col-span-2')}
              {cell('High', <Input type="number" value={r.high} disabled={disabled} onChange={(e) => upR(i, { high: e.target.value })} data-testid={`input-repair-high-${i}`} />, 'sm:col-span-2')}
              {cell('Confidence %', <Input type="number" min={0} max={100} value={r.confidence} disabled={disabled} onChange={(e) => upR(i, { confidence: e.target.value })} data-testid={`input-repair-confidence-${i}`} />, 'sm:col-span-3')}
              {cell('Source of estimate', <Input value={r.source} disabled={disabled} onChange={(e) => upR(i, { source: e.target.value })} data-testid={`input-repair-source-${i}`} />, 'sm:col-span-9')}
              {cell('Repair evidence', evSel(r.ev, (v) => upR(i, { ev: v }), `select-repair-evidence-${i}`), 'sm:col-span-9')}
              <div className="flex items-end justify-end sm:col-span-3"><Button size="sm" variant="ghost" disabled={disabled} onClick={() => setRepairs((l) => l.filter((_, j) => j !== i))} data-testid={`button-remove-repair-${i}`}><Trash2 className="mr-1 h-3.5 w-3.5" />Remove</Button></div>
            </div>
          ))}
          <datalist id="repair-cats">{REPAIR_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        {repairs.length > 0 && <p className="mt-2 font-mono text-xs text-muted-foreground" data-testid="text-repair-sum">Draft line sums: {money(sum.low)} / {money(sum.exp)} / {money(sum.high)}. The engine adds contingency; its figure is the one that counts.</p>}
      </section>}

      <section className="ledger space-y-3 p-3">
        <h3 className="text-xl font-semibold">Completeness</h3>
        <label className="flex items-start gap-3 text-sm"><Switch checked={repairsComplete} disabled={disabled} onCheckedChange={setRC} data-testid="switch-repairs-complete" /><span>The repair list covers the whole scope of work.</span></label>
        <label className="flex items-start gap-3 text-sm"><Switch checked={conditionConfirmed} disabled={disabled} onCheckedChange={setCC} data-testid="switch-condition-confirmed" /><span>Condition of the property has been confirmed by photos, inspection, or a visit, not only the seller's words.</span></label>
      </section>

      {problems.length > 0 && <div className="border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive" data-testid="list-uw-problems"><ul className="list-disc pl-5">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul></div>}
      {error != null && <ErrorNotice error={error} />}
      <div className="sticky bottom-0 -mx-1 flex items-center justify-between gap-3 border-t border-border bg-background/95 px-1 py-3 backdrop-blur">
        <p className="text-xs text-muted-foreground" data-testid="text-uw-dirty">{dirty ? 'Unsaved changes. Background refresh will not overwrite them.' : 'Saved state shown.'}</p>
        <Button onClick={save} disabled={pending || disabled} data-testid="button-save-underwriting">{pending ? 'Calculating' : 'Save and calculate'}</Button>
      </div>
    </div>
  );
}
