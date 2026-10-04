import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ErrorNotice } from '@/components/state-views';
import type { Lead, LeadInput, LeadInputPropertyType, LeadInputUrgency } from '@workspace/api-client-react';
import { PROPERTY_TYPES, num } from '@/lib/format';
import { useBaseVersion } from '@/hooks/use-base-version';

const URGENCY: LeadInputUrgency[] = ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH'];

export function LeadForm({
  lead, pending, error, disabled, submitLabel, onSubmit, onDiscard, onCancel,
}: {
  lead?: Lead; pending: boolean; error: unknown; disabled?: boolean; submitLabel: string;
  onSubmit: (d: LeadInput, baseVersion: number) => void; onDiscard?: () => void; onCancel?: () => void;
}) {
  const { base, stale, rebase } = useBaseVersion(lead?.version ?? 1);
  const [v, setV] = useState({
    address: lead?.address ?? '', city: lead?.city ?? '', state: lead?.state ?? '', county: lead?.county ?? '',
    zip: lead?.zip ?? '', sqft: String(lead?.sqft ?? ''), beds: String(lead?.beds ?? ''), baths: String(lead?.baths ?? ''),
    units: String(lead?.units ?? '1'), askingPrice: lead?.askingPrice != null ? String(lead.askingPrice) : '',
    sellerName: lead?.sellerName ?? '', sellerPhone: lead?.sellerPhone ?? '', sellerEmail: lead?.sellerEmail ?? '',
    sellerDescription: lead?.sellerDescription ?? '', sellingReason: lead?.sellingReason ?? '',
    source: lead?.source ?? '', nextAction: lead?.nextAction ?? '',
  });
  const [ptype, setPtype] = useState<LeadInputPropertyType>(lead?.propertyType ?? 'SINGLE_FAMILY');
  const [urgency, setUrgency] = useState<LeadInputUrgency>(lead?.urgency ?? 'UNKNOWN');
  const [local, setLocal] = useState<string | null>(null);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));

  const submit = () => {
    const nums = { sqft: num(v.sqft), beds: num(v.beds), baths: num(v.baths), units: num(v.units) };
    if (Object.values(nums).some(Number.isNaN)) return setLocal('Square feet, beds, baths and units must be numbers.');
    const asking = v.askingPrice.trim() === '' ? null : Number(v.askingPrice);
    if (asking !== null && Number.isNaN(asking)) return setLocal('Asking price must be a number or blank.');
    setLocal(null);
    const opt = (s: string) => (s.trim() ? s.trim() : undefined);
    onSubmit({
      address: v.address.trim(), city: v.city.trim(), state: v.state.trim().toUpperCase(), county: v.county.trim(), zip: v.zip.trim(),
      propertyType: ptype, ...nums, askingPrice: asking, sellerName: v.sellerName.trim(), sellerPhone: opt(v.sellerPhone),
      sellerEmail: opt(v.sellerEmail), sellerDescription: opt(v.sellerDescription), sellingReason: opt(v.sellingReason),
      urgency, source: v.source.trim(), nextAction: opt(v.nextAction),
    }, base);
  };

  const F = ({ k, label, cls = '', type = 'text', ph }: { k: keyof typeof v; label: string; cls?: string; type?: string; ph?: string }) => (
    <div className={`space-y-1.5 ${cls}`}>
      <Label htmlFor={`lead-${k}`}>{label}</Label>
      <Input id={`lead-${k}`} type={type} value={v[k]} onChange={set(k)} placeholder={ph} disabled={disabled} data-testid={`input-lead-${k}`} />
    </div>
  );

  return (
    <div className="space-y-4" data-testid="form-lead">
      {stale && lead && (
        <div className="border border-signal bg-card p-3 text-sm" data-testid="notice-lead-stale">
          This lead moved to version {lead.version} while you were editing (you started from {base}). Your draft is kept.
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="outline" onClick={rebase} data-testid="button-lead-rebase">Keep my draft, save over latest</Button>
            {onDiscard && <Button size="sm" variant="ghost" onClick={onDiscard} data-testid="button-lead-discard">Discard draft, load latest</Button>}
          </div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-6">
        {F({k: 'address', label: 'Street address', cls: 'sm:col-span-6'})}
        {F({k: 'city', label: 'City', cls: 'sm:col-span-2'})}
        {F({k: 'state', label: 'State (2 letters)', cls: 'sm:col-span-1'})}
        {F({k: 'county', label: 'County', cls: 'sm:col-span-2'})}
        {F({k: 'zip', label: 'ZIP', cls: 'sm:col-span-1'})}
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Property type</Label>
          <Select value={ptype} onValueChange={(x) => setPtype(x as LeadInputPropertyType)} disabled={disabled}>
            <SelectTrigger data-testid="select-property-type"><SelectValue /></SelectTrigger>
            <SelectContent>{PROPERTY_TYPES.map((p) => <SelectItem key={p} value={p}>{p.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {F({k: 'sqft', label: 'Square feet', type: 'number'})}
        {F({k: 'beds', label: 'Beds', type: 'number'})}
        {F({k: 'baths', label: 'Baths', type: 'number'})}
        {F({k: 'units', label: 'Units', type: 'number'})}
        {F({k: 'askingPrice', label: 'Asking price (USD)', type: 'number', cls: 'sm:col-span-2', ph: 'blank if unknown'})}
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Seller urgency (as stated)</Label>
          <Select value={urgency} onValueChange={(x) => setUrgency(x as LeadInputUrgency)} disabled={disabled}>
            <SelectTrigger data-testid="select-urgency"><SelectValue /></SelectTrigger>
            <SelectContent>{URGENCY.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {F({k: 'sellerName', label: 'Seller name', cls: 'sm:col-span-2'})}
        {F({k: 'sellerPhone', label: 'Seller phone', cls: 'sm:col-span-2'})}
        {F({k: 'sellerEmail', label: 'Seller email', cls: 'sm:col-span-2'})}
        {F({k: 'source', label: 'Where this lead came from', cls: 'sm:col-span-4'})}
        {F({k: 'nextAction', label: 'Next action', cls: 'sm:col-span-6'})}
        <div className="space-y-1.5 sm:col-span-3"><Label>What the seller said about the property</Label>
          <Textarea rows={3} value={v.sellerDescription} onChange={set('sellerDescription')} disabled={disabled} data-testid="input-lead-sellerDescription" /></div>
        <div className="space-y-1.5 sm:col-span-3"><Label>Why they are selling</Label>
          <Textarea rows={3} value={v.sellingReason} onChange={set('sellingReason')} disabled={disabled} data-testid="input-lead-sellingReason" /></div>
      </div>
      {local && <p className="text-sm text-destructive" data-testid="text-lead-local-error">{local}</p>}
      {error != null && <ErrorNotice error={error} />}
      <div className="flex justify-end gap-2">
        {onCancel && <Button variant="ghost" onClick={onCancel} data-testid="button-lead-cancel">Cancel</Button>}
        <Button onClick={submit} disabled={pending || disabled} data-testid="button-lead-save">{pending ? 'Saving' : submitLabel}</Button>
      </div>
    </div>
  );
}
