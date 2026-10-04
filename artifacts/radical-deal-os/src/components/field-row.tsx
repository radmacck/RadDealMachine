import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';

export const SELECT = 'h-9 w-full border border-input bg-background px-2 text-sm';

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`space-y-1 ${className ?? ''}`}>
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function safeUrl(u?: string | null) {
  return u && /^https?:\/\//i.test(u) ? u : null;
}

export function EvidenceLink({ url, label }: { url?: string | null; label: string }) {
  const href = safeUrl(url);
  if (!url) return <span className="text-muted-foreground">{label}: none</span>;
  return href
    ? <a href={href} target="_blank" rel="noopener noreferrer" className="underline hover:text-signal">{label}</a>
    : <span>{label}: {url}</span>;
}
