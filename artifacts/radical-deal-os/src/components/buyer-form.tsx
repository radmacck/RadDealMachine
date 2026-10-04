import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorNotice } from '@/components/state-views';
import { Field, SELECT } from '@/components/field-row';
import { PROPERTY_TYPES, num } from '@/lib/format';
import type { Buyer, BuyerCriteriaPropertyTypesItem, BuyerInput, BuyerInputStatus } from '@workspace/api-client-react';

const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

export function BuyerForm({ buyer, disabled, pending, error, submitLabel, onSubmit, onCancel }: {
  buyer?: Buyer; disabled?: boolean; pending: boolean; error: unknown; submitLabel: string;
  onSubmit: (d: BuyerInput) => void; onCancel?: () => void;
}) {
  const c = buyer?.criteria;
  const [name, setName] = useState(buyer?.name ?? '');
  const [email, setEmail] = useState(buyer?.email ?? '');
  const [phone, setPhone] = useState(buyer?.phone ?? '');
  const [source, setSource] = useState(buyer?.source ?? '');
  const [status, setStatus] = useState<BuyerInputStatus>(buyer?.status ?? 'ACTIVE');
  const [states, setStates] = useState(c?.states.join(', ') ?? '');
  const [cities, setCities] = useState(c?.cities.join(', ') ?? '');
  const [zips, setZips] = useState(c?.zipCodes.join(', ') ?? '');
  const [types, setTypes] = useState<BuyerCriteriaPropertyTypesItem[]>(c?.propertyTypes ?? []);
  const [maxPrice, setMaxPrice] = useState(c ? String(c.maxPurchasePrice) : '');
  const [maxRepairs, setMaxRepairs] = useState(c ? String(c.maxRepairs) : '');
  const [minBeds, setMinBeds] = useState(c ? String(c.minBeds) : '0');
  const [minSqft, setMinSqft] = useState(c ? String(c.minSqft) : '0');
  const [maxSqft, setMaxSqft] = useState(c ? String(c.maxSqft) : '');
  const [closing, setClosing] = useState(c ? String(c.closingDays) : '30');
  const [local, setLocal] = useState<string | null>(null);

  const submit = () => {
    const st = csv(states).map((s) => s.toUpperCase());
    const n = { maxPrice: num(maxPrice), maxRepairs: num(maxRepairs), minBeds: num(minBeds), minSqft: num(minSqft), maxSqft: num(maxSqft), closing: num(closing) };
    if (!name.trim() || !source.trim()) return setLocal('Name and source are required.');
    if (!email.trim() && !phone.trim()) return setLocal('Give an email or a phone number.');
    if (st.length === 0 || st.some((s) => s.length !== 2)) return setLocal('Enter at least one two-letter state, comma separated.');
    if (types.length === 0) return setLocal('Select at least one property type.');
    if (Object.values(n).some((v) => !Number.isFinite(v))) return setLocal('Every number field is required.');
    if (n.maxPrice <= 0 || n.maxSqft <= 0) return setLocal('Maximum price and maximum square feet must be above zero.');
    setLocal(null);
    onSubmit({
      name: name.trim(), email: email.trim(), phone: phone.trim(), source: source.trim(), status,
      criteria: { states: st, cities: csv(cities), zipCodes: csv(zips), propertyTypes: types, maxPurchasePrice: n.maxPrice, maxRepairs: n.maxRepairs, minBeds: n.minBeds, minSqft: n.minSqft, maxSqft: n.maxSqft, closingDays: n.closing },
    });
  };

  return (
    <div className="space-y-4" data-testid="form-buyer">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Buyer name"><Input value={name} disabled={disabled} onChange={(e) => setName(e.target.value)} data-testid="input-buyer-name" /></Field>
        <Field label="Source" hint="Where this buyer came from, for example a referral or closing file."><Input value={source} disabled={disabled} onChange={(e) => setSource(e.target.value)} data-testid="input-buyer-source" /></Field>
        <Field label="Email"><Input type="email" value={email} disabled={disabled} onChange={(e) => setEmail(e.target.value)} data-testid="input-buyer-email" /></Field>
        <Field label="Phone"><Input value={phone} disabled={disabled} onChange={(e) => setPhone(e.target.value)} data-testid="input-buyer-phone" /></Field>
        <Field label="Status"><select className={SELECT} value={status} disabled={disabled} onChange={(e) => setStatus(e.target.value as BuyerInputStatus)} data-testid="select-buyer-status"><option value="ACTIVE">Active</option><option value="PAUSED">Paused</option></select></Field>
      </div>
      <div>
        <p className="eyebrow mb-2">Buy box</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="States" hint="Two letters, comma separated"><Input value={states} disabled={disabled} onChange={(e) => setStates(e.target.value)} data-testid="input-buyer-states" /></Field>
          <Field label="Cities" hint="Blank means any city"><Input value={cities} disabled={disabled} onChange={(e) => setCities(e.target.value)} data-testid="input-buyer-cities" /></Field>
          <Field label="ZIP codes" hint="Blank means any ZIP"><Input value={zips} disabled={disabled} onChange={(e) => setZips(e.target.value)} data-testid="input-buyer-zips" /></Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {PROPERTY_TYPES.map((t) => {
            const on = types.includes(t);
            return <button key={t} type="button" disabled={disabled} onClick={() => setTypes(on ? types.filter((x) => x !== t) : [...types, t])} aria-pressed={on} data-testid={`toggle-type-${t}`}
              className={`border px-2.5 py-1 text-xs ${on ? 'border-signal bg-card font-semibold ring-1 ring-signal/40' : 'border-border text-muted-foreground'}`}>{t.replace(/_/g, ' ')}</button>;
          })}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="Max purchase price"><Input inputMode="decimal" value={maxPrice} disabled={disabled} onChange={(e) => setMaxPrice(e.target.value)} data-testid="input-buyer-max-price" /></Field>
          <Field label="Max repairs"><Input inputMode="decimal" value={maxRepairs} disabled={disabled} onChange={(e) => setMaxRepairs(e.target.value)} data-testid="input-buyer-max-repairs" /></Field>
          <Field label="Closing days"><Input inputMode="numeric" value={closing} disabled={disabled} onChange={(e) => setClosing(e.target.value)} data-testid="input-buyer-closing" /></Field>
          <Field label="Min beds"><Input inputMode="numeric" value={minBeds} disabled={disabled} onChange={(e) => setMinBeds(e.target.value)} data-testid="input-buyer-min-beds" /></Field>
          <Field label="Min sqft"><Input inputMode="numeric" value={minSqft} disabled={disabled} onChange={(e) => setMinSqft(e.target.value)} data-testid="input-buyer-min-sqft" /></Field>
          <Field label="Max sqft"><Input inputMode="numeric" value={maxSqft} disabled={disabled} onChange={(e) => setMaxSqft(e.target.value)} data-testid="input-buyer-max-sqft" /></Field>
        </div>
      </div>
      {buyer && <p className="text-xs text-muted-foreground">Saving criteria queues a fresh matching run against every open deal.</p>}
      {local && <p className="text-sm text-destructive" data-testid="text-buyer-form-error">{local}</p>}
      {error != null && <ErrorNotice error={error} />}
      <div className="flex gap-2">
        <Button onClick={submit} disabled={disabled || pending} data-testid="button-save-buyer">{pending ? 'Saving...' : submitLabel}</Button>
        {onCancel && <Button variant="outline" onClick={onCancel} data-testid="button-cancel-buyer">Cancel</Button>}
      </div>
    </div>
  );
}
