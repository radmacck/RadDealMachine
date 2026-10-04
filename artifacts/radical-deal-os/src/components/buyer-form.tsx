import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorNotice } from '@/components/state-views';
import { Field, SELECT } from '@/components/field-row';
import { PROPERTY_TYPES, num } from '@/lib/format';
import type { Buyer, BuyerCriteria, BuyerInput, BuyerInputDestinationKind, BuyerInputStatus } from '@workspace/api-client-react';

const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const j = (a?: string[]) => (a ?? []).join(', ');
const s = (n?: number | null) => (n == null ? '' : String(n));
const REHAB = ['NONE', 'LIGHT', 'MODERATE', 'HEAVY', 'ANY'] as const;
const STRATS = ['FLIP', 'RENTAL', 'BRRRR', 'WHOLESALE', 'DEVELOPMENT', 'OTHER'] as const;
const FUNDS = ['CASH', 'HARD_MONEY', 'PRIVATE_LENDING', 'CONVENTIONAL', 'OTHER'] as const;

function Toggles<T extends string>({ items, value, onChange, disabled, tid }: { items: readonly T[]; value: T[]; onChange: (v: T[]) => void; disabled?: boolean; tid: string }) {
  return <div className="flex flex-wrap gap-2">{items.map((t) => {
    const on = value.includes(t);
    return <button key={t} type="button" disabled={disabled} onClick={() => onChange(on ? value.filter((x) => x !== t) : [...value, t])} aria-pressed={on} data-testid={`toggle-${tid}-${t}`}
      className={`border px-2.5 py-1 text-xs ${on ? 'border-signal bg-card font-semibold ring-1 ring-signal/40' : 'border-border text-muted-foreground'}`}>{t.replace(/_/g, ' ')}</button>;
  })}</div>;
}

export function BuyerForm({ buyer, disabled, pending, error, submitLabel, onSubmit, onCancel }: {
  buyer?: Partial<Buyer>; disabled?: boolean; pending: boolean; error: unknown; submitLabel: string;
  onSubmit: (d: BuyerInput) => void; onCancel?: () => void;
}) {
  const c = buyer?.criteria ?? undefined;
  const [name, setName] = useState(buyer?.name ?? '');
  const [email, setEmail] = useState(buyer?.email ?? '');
  const [phone, setPhone] = useState(buyer?.phone ?? '');
  const [source, setSource] = useState(buyer?.source ?? '');
  const [status, setStatus] = useState<BuyerInputStatus>(buyer?.status ?? 'ACTIVE');
  const [dest, setDest] = useState<BuyerInputDestinationKind>(buyer?.destinationKind ?? 'BUYER');
  const [fee, setFee] = useState(s(buyer?.qualifiedDealFee));
  const [feeSrc, setFeeSrc] = useState(buyer?.feeTermsSource ?? '');
  const [noCrit, setNoCrit] = useState(!!buyer && !buyer.criteria);
  const [f, setF] = useState<Record<string, string>>({
    states: j(c?.states), counties: j(c?.counties), cities: j(c?.cities), zips: j(c?.zipCodes),
    exCounties: j(c?.excludedCounties), exCities: j(c?.excludedCities), exZips: j(c?.excludedZipCodes),
    minPrice: s(c?.minPurchasePrice), maxPrice: s(c?.maxPurchasePrice), minArv: s(c?.minArv), maxArv: s(c?.maxArv),
    minUnits: s(c?.minUnits), maxUnits: s(c?.maxUnits), minSqft: s(c?.minSqft), maxSqft: s(c?.maxSqft),
    minBeds: s(c?.minBeds), maxBeds: s(c?.maxBeds), minBaths: s(c?.minBaths), maxBaths: s(c?.maxBaths),
    maxRepairs: s(c?.maxRepairs), closing: s(c?.closingDays), conc: s(c?.maxConcurrentDeals), spread: s(c?.minSpread),
    cap: c?.minCapRate == null ? '' : String(+(c.minCapRate * 100).toFixed(3)),
  });
  const [types, setTypes] = useState<string[]>(c?.propertyTypes ?? []);
  const [rehab, setRehab] = useState<string>(c?.rehabTolerance ?? '');
  const [strats, setStrats] = useState<string[]>(c?.strategies ?? []);
  const [fund, setFund] = useState<string[]>(c?.fundingTypes ?? []);
  const [local, setLocal] = useState<string | null>(null);
  const set = (k: string) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const inp = (k: string, tid: string, ph?: string) => <Input inputMode="decimal" placeholder={ph} value={f[k]} disabled={disabled || noCrit} onChange={set(k)} data-testid={`input-buyer-${tid}`} />;
  const nul = (k: string) => (f[k].trim() === '' ? null : Number(f[k]));

  const submit = () => {
    if (!name.trim() || !source.trim()) return setLocal('Name and source are required.');
    const feeN = fee.trim() === '' ? null : Number(fee);
    if (feeN != null && (!Number.isFinite(feeN) || feeN < 0)) return setLocal('Quoted fee must be zero or more.');
    const base = { name: name.trim(), email: email.trim(), phone: phone.trim(), source: source.trim(), status, destinationKind: dest, qualifiedDealFee: feeN, feeTermsSource: feeSrc.trim() };
    if (noCrit) { setLocal(null); return onSubmit({ ...base, criteria: null }); }
    const st = csv(f.states).map((x) => x.toUpperCase());
    if (st.length === 0 || st.some((x) => x.length !== 2)) return setLocal('Enter at least one two-letter state.');
    const zipBad = [...csv(f.zips), ...csv(f.exZips)].some((z) => !/^\d{5}$/.test(z));
    if (zipBad) return setLocal('ZIP codes must be five digits.');
    if (types.length === 0 || !rehab || strats.length === 0 || fund.length === 0) return setLocal('Select property types, rehab tolerance, strategies and funding types.');
    const req = ['minPrice', 'maxPrice', 'minUnits', 'maxUnits', 'minSqft', 'maxSqft', 'minBeds', 'minBaths', 'maxRepairs', 'closing', 'conc'];
    if (req.some((k) => !Number.isFinite(num(f[k])))) return setLocal('Minimum price, units, square feet, beds, baths, repairs, closing days and capacity must be entered explicitly. Use 0 where the buyer has no floor.');
    const opt = ['minArv', 'maxArv', 'maxBeds', 'maxBaths', 'spread', 'cap'];
    if (opt.some((k) => f[k].trim() !== '' && !Number.isFinite(Number(f[k])))) return setLocal('Optional bounds must be numbers or blank.');
    if (num(f.maxPrice) <= 0 || num(f.maxSqft) <= 0) return setLocal('Maximum price and square feet must be above zero.');
    if (num(f.minPrice) > num(f.maxPrice) || num(f.minUnits) > num(f.maxUnits) || num(f.minSqft) > num(f.maxSqft)) return setLocal('A minimum exceeds its maximum.');
    setLocal(null);
    const capN = nul('cap');
    const criteria: BuyerCriteria = {
      states: st, counties: csv(f.counties), cities: csv(f.cities), zipCodes: csv(f.zips),
      excludedCounties: csv(f.exCounties), excludedCities: csv(f.exCities), excludedZipCodes: csv(f.exZips),
      propertyTypes: types as BuyerCriteria['propertyTypes'], minPurchasePrice: num(f.minPrice), maxPurchasePrice: num(f.maxPrice),
      minArv: nul('minArv'), maxArv: nul('maxArv'), minUnits: num(f.minUnits), maxUnits: num(f.maxUnits),
      minSqft: num(f.minSqft), maxSqft: num(f.maxSqft), minBeds: num(f.minBeds), maxBeds: nul('maxBeds'), minBaths: num(f.minBaths), maxBaths: nul('maxBaths'),
      maxRepairs: num(f.maxRepairs), rehabTolerance: rehab as BuyerCriteria['rehabTolerance'], strategies: strats as BuyerCriteria['strategies'],
      fundingTypes: fund as BuyerCriteria['fundingTypes'], closingDays: num(f.closing), maxConcurrentDeals: num(f.conc),
      minSpread: nul('spread'), minCapRate: capN == null ? null : capN / 100,
    };
    onSubmit({ ...base, criteria });
  };

  return (
    <div className="space-y-4" data-testid="form-buyer">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><Input value={name} disabled={disabled} onChange={(e) => setName(e.target.value)} data-testid="input-buyer-name" /></Field>
        <Field label="Source" hint="Where this record came from."><Input value={source} disabled={disabled} onChange={(e) => setSource(e.target.value)} data-testid="input-buyer-source" /></Field>
        <Field label="Email"><Input type="email" value={email} disabled={disabled} onChange={(e) => setEmail(e.target.value)} data-testid="input-buyer-email" /></Field>
        <Field label="Phone"><Input value={phone} disabled={disabled} onChange={(e) => setPhone(e.target.value)} data-testid="input-buyer-phone" /></Field>
        <Field label="Status"><select className={SELECT} value={status} disabled={disabled} onChange={(e) => setStatus(e.target.value as BuyerInputStatus)} data-testid="select-buyer-status"><option value="ACTIVE">Active</option><option value="PAUSED">Paused</option></select></Field>
        <Field label="Destination" hint="Only an actual buyer can commit to a deal."><select className={SELECT} value={dest} disabled={disabled} onChange={(e) => setDest(e.target.value as BuyerInputDestinationKind)} data-testid="select-buyer-destination"><option value="BUYER">Buyer</option><option value="DEAL_FINDER">Deal finder</option><option value="GURU">Guru</option></select></Field>
        <Field label="Quoted qualified-deal fee" hint="Blank if none quoted"><Input inputMode="decimal" value={fee} disabled={disabled} onChange={(e) => setFee(e.target.value)} data-testid="input-buyer-fee" /></Field>
        <Field label="Fee terms source"><Input value={feeSrc} disabled={disabled} onChange={(e) => setFeeSrc(e.target.value)} data-testid="input-buyer-fee-source" /></Field>
      </div>
      <div>
        <p className="eyebrow mb-2">Buy box</p>
        <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={noCrit} disabled={disabled} onChange={(e) => setNoCrit(e.target.checked)} data-testid="check-no-criteria" />Criteria not collected yet. Nothing is assumed and the buyer cannot be approved.</label>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="States" hint="Two letters, comma separated">{inp('states', 'states')}</Field>
          <Field label="Counties">{inp('counties', 'counties')}</Field>
          <Field label="Cities" hint="Blank means any">{inp('cities', 'cities')}</Field>
          <Field label="ZIP codes">{inp('zips', 'zips')}</Field>
          <Field label="Excluded counties">{inp('exCounties', 'ex-counties')}</Field>
          <Field label="Excluded cities">{inp('exCities', 'ex-cities')}</Field>
          <Field label="Excluded ZIPs">{inp('exZips', 'ex-zips')}</Field>
        </div>
        <div className="mt-3 space-y-3">
          <div><p className="mb-1 text-xs text-muted-foreground">Property types</p><Toggles items={PROPERTY_TYPES} value={types} onChange={setTypes} disabled={disabled || noCrit} tid="type" /></div>
          <div><p className="mb-1 text-xs text-muted-foreground">Strategies</p><Toggles items={STRATS} value={strats} onChange={setStrats} disabled={disabled || noCrit} tid="strategy" /></div>
          <div><p className="mb-1 text-xs text-muted-foreground">Funding types</p><Toggles items={FUNDS} value={fund} onChange={setFund} disabled={disabled || noCrit} tid="funding" /></div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="Rehab tolerance"><select className={SELECT} value={rehab} disabled={disabled || noCrit} onChange={(e) => setRehab(e.target.value)} data-testid="select-buyer-rehab"><option value="">Select</option>{REHAB.map((r) => <option key={r} value={r}>{r}</option>)}</select></Field>
          <Field label="Min purchase price">{inp('minPrice', 'min-price')}</Field>
          <Field label="Max purchase price">{inp('maxPrice', 'max-price')}</Field>
          <Field label="Min ARV" hint="Blank clears">{inp('minArv', 'min-arv')}</Field>
          <Field label="Max ARV" hint="Blank clears">{inp('maxArv', 'max-arv')}</Field>
          <Field label="Max repairs">{inp('maxRepairs', 'max-repairs')}</Field>
          <Field label="Min units">{inp('minUnits', 'min-units')}</Field>
          <Field label="Max units">{inp('maxUnits', 'max-units')}</Field>
          <Field label="Closing days">{inp('closing', 'closing')}</Field>
          <Field label="Min beds">{inp('minBeds', 'min-beds')}</Field>
          <Field label="Max beds" hint="Blank clears">{inp('maxBeds', 'max-beds')}</Field>
          <Field label="Max concurrent deals">{inp('conc', 'concurrent')}</Field>
          <Field label="Min baths">{inp('minBaths', 'min-baths')}</Field>
          <Field label="Max baths" hint="Blank clears">{inp('maxBaths', 'max-baths')}</Field>
          <Field label="Min sqft">{inp('minSqft', 'min-sqft')}</Field>
          <Field label="Max sqft">{inp('maxSqft', 'max-sqft')}</Field>
          <Field label="Min spread" hint="Policy buyer ceiling minus buyer price. Blank clears.">{inp('spread', 'spread')}</Field>
          <Field label="Min cap rate, %" hint="Blank clears; no evidence blocks match">{inp('cap', 'cap')}</Field>
        </div>
      </div>
      {buyer?.id && <p className="text-xs text-muted-foreground">Saving criteria queues a fresh matching run against every open deal.</p>}
      {local && <p className="text-sm text-destructive" data-testid="text-buyer-form-error">{local}</p>}
      {error != null && <ErrorNotice error={error} />}
      <div className="flex gap-2">
        <Button onClick={submit} disabled={disabled || pending} data-testid="button-save-buyer">{pending ? 'Saving...' : submitLabel}</Button>
        {onCancel && <Button variant="outline" onClick={onCancel} data-testid="button-cancel-buyer">Cancel</Button>}
      </div>
    </div>
  );
}

export function ProspectForm({ pending, error, onSubmit, onCancel }: { pending: boolean; error: unknown; onSubmit: (d: { name: string; source: string; sourceUrl: string; capturedAt: string; confidence: number; email?: string; phone?: string; destinationKind: BuyerInputDestinationKind }) => void; onCancel: () => void }) {
  const [v, setV] = useState({ name: '', source: '', sourceUrl: '', at: '', conf: '0.5', email: '', phone: '' });
  const [dest, setDest] = useState<BuyerInputDestinationKind>('BUYER');
  const [local, setLocal] = useState<string | null>(null);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  const submit = () => {
    const t = new Date(v.at);
    const conf = Number(v.conf);
    if (!v.name.trim() || !v.source.trim()) return setLocal('Name and source are required.');
    if (v.sourceUrl.trim().length < 8) return setLocal('Source link is required.');
    if (!v.at || isNaN(t.getTime()) || t.getTime() > Date.now()) return setLocal('Enter a past capture time.');
    if (!Number.isFinite(conf) || conf < 0 || conf > 1) return setLocal('Confidence is between 0 and 1.');
    setLocal(null);
    onSubmit({ name: v.name.trim(), source: v.source.trim(), sourceUrl: v.sourceUrl.trim(), capturedAt: t.toISOString(), confidence: conf, destinationKind: dest, ...(v.email.trim() ? { email: v.email.trim() } : {}), ...(v.phone.trim() ? { phone: v.phone.trim() } : {}) });
  };
  return (
    <div className="space-y-3" data-testid="form-prospect">
      <p className="text-xs text-muted-foreground">Records a prospect with provenance only. No criteria, funds or buying intent are assumed; qualification is required before approval.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><Input value={v.name} onChange={set('name')} data-testid="input-prospect-name" /></Field>
        <Field label="Destination"><select className={SELECT} value={dest} onChange={(e) => setDest(e.target.value as BuyerInputDestinationKind)} data-testid="select-prospect-destination"><option value="BUYER">Buyer</option><option value="DEAL_FINDER">Deal finder</option><option value="GURU">Guru</option></select></Field>
        <Field label="Source description"><Input value={v.source} onChange={set('source')} data-testid="input-prospect-source" /></Field>
        <Field label="Source link"><Input value={v.sourceUrl} onChange={set('sourceUrl')} data-testid="input-prospect-url" /></Field>
        <Field label="Captured at"><Input type="datetime-local" value={v.at} onChange={set('at')} data-testid="input-prospect-at" /></Field>
        <Field label="Confidence 0 to 1"><Input inputMode="decimal" value={v.conf} onChange={set('conf')} data-testid="input-prospect-confidence" /></Field>
        <Field label="Email (only if published)"><Input value={v.email} onChange={set('email')} data-testid="input-prospect-email" /></Field>
        <Field label="Phone (only if published)"><Input value={v.phone} onChange={set('phone')} data-testid="input-prospect-phone" /></Field>
      </div>
      {local && <p className="text-sm text-destructive" data-testid="text-prospect-error">{local}</p>}
      {error != null && <ErrorNotice error={error} />}
      <div className="flex gap-2"><Button onClick={submit} disabled={pending} data-testid="button-save-prospect">{pending ? 'Saving...' : 'Add unverified prospect'}</Button><Button variant="outline" onClick={onCancel}>Cancel</Button></div>
    </div>
  );
}
