export function Logo({ light = false }: { light?: boolean }) {
  const base = import.meta.env.BASE_URL;
  return (
    <span className="inline-flex items-center gap-2.5" data-testid="logo">
      <img src={`${base}logo.svg`} alt="" className="h-8 w-8" />
      <span className={`font-display text-lg font-semibold leading-none ${light ? 'text-sidebar-accent-foreground' : ''}`}>
        Radical Deal <span className="text-signal">OS</span>
      </span>
    </span>
  );
}
