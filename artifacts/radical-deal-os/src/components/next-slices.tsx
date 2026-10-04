const SLICES = [
  { name: 'Buyers', note: 'Buyer discovery, qualification, verification and matching' },
  { name: 'Contracts and closing', note: 'Everything from contract onward' },
  { name: 'Recurring workers', note: 'Scheduled sourcing and refresh jobs' },
];

export function NextSlices({ dark = false }: { dark?: boolean }) {
  return (
    <div data-testid="panel-next-slices">
      <p className={`eyebrow mb-2 ${dark ? '!text-sidebar-foreground/60' : ''}`}>Later slices, not built</p>
      <ul className="space-y-1.5">
        {SLICES.map((s) => (
          <li key={s.name} aria-disabled="true" title={`${s.note}. No functional screen exists yet.`} className={`flex items-center justify-between gap-2 border border-dashed px-2.5 py-1.5 text-xs ${dark ? 'border-sidebar-border text-sidebar-foreground/60' : 'border-border text-muted-foreground'}`} data-testid={`slice-${s.name.split(',')[0].toLowerCase()}`}>
            <span>{s.name}</span><span className="font-mono text-[10px] uppercase tracking-wider">next</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
