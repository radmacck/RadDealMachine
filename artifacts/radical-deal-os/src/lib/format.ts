import { format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns';
import type { DealStage } from '@workspace/api-client-react';

export const money = (n?: number | null) =>
  n == null || Number.isNaN(n)
    ? '\u2014'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

export const pct = (n?: number | null, d = 0) => (n == null ? '\u2014' : `${(n * 100).toFixed(d)}%`);

export function fmtDate(s?: string | null, withTime = true) {
  if (!s) return '\u2014';
  const d = parseISO(s);
  return isValid(d) ? format(d, withTime ? 'MMM d, yyyy h:mm a' : 'MMM d, yyyy') : s;
}

export function ago(s?: string | null) {
  if (!s) return '';
  const d = parseISO(s);
  return isValid(d) ? `${formatDistanceToNowStrict(d)} ${d.getTime() > Date.now() ? 'from now' : 'ago'}` : '';
}

export const isOverdue = (s?: string | null) => !!s && parseISO(s).getTime() < Date.now();

export function toLocalInput(iso?: string | null) {
  if (!iso) return '';
  const d = parseISO(iso);
  return isValid(d) ? format(d, "yyyy-MM-dd'T'HH:mm") : '';
}
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isValid(d) ? d.toISOString() : null;
}
export const toDateInput = (iso?: string | null) => (iso ? iso.slice(0, 10) : '');
export const fromDateInput = (v: string) => new Date(`${v}T12:00:00Z`).toISOString();

export const num = (s: string) => (s.trim() === '' ? NaN : Number(s));

export interface ErrInfo {
  status: number | null;
  message: string;
  details: string[];
}
export function errInfo(e: unknown): ErrInfo {
  const err = e as { status?: number; data?: unknown; message?: string } | null;
  const status = typeof err?.status === 'number' ? err.status : null;
  const data = err?.data as Record<string, unknown> | null | undefined;
  let message = err?.message ?? 'Something went wrong.';
  const details: string[] = [];
  if (data && typeof data === 'object') {
    if (typeof data.error === 'string') message = data.error;
    else if (typeof data.message === 'string') message = data.message;
    const list = (data.details ?? data.issues ?? data.errors) as unknown;
    if (Array.isArray(list)) {
      for (const it of list) {
        if (typeof it === 'string') details.push(it);
        else if (it && typeof it === 'object') {
          const o = it as { path?: unknown; message?: string };
          const p = Array.isArray(o.path) ? o.path.join('.') : o.path ? String(o.path) : '';
          details.push(`${p ? `${p}: ` : ''}${o.message ?? JSON.stringify(it)}`);
        }
      }
    }
  }
  return { status, message, details };
}

export const stageLabel = (s: string) => s.replace(/_/g, ' ');

const DOWNSTREAM: string[] = [
  'OFFER_READY', 'OFFER_SENT', 'NEGOTIATING', 'CONTRACT_PENDING', 'UNDER_CONTRACT',
  'BUYER_MATCHED', 'BUYER_INTERESTED', 'BUYER_COMMITTED', 'CLOSING', 'CLOSED',
];
export const isDownstream = (s: string) => DOWNSTREAM.includes(s);

export function stageTone(s: DealStage | string) {
  if (isDownstream(s)) return 'tone-future';
  switch (s) {
    case 'STRONG': return 'tone-go';
    case 'NEGOTIABLE': return 'tone-warn';
    case 'PASS': case 'DEAD_DEAL': return 'tone-stop';
    case 'CALL_READY': return 'tone-signal';
    case 'ANALYZED': case 'CONTACTED': case 'CONVERSATION': return 'tone-ink';
    default: return 'tone-muted';
  }
}

export const PROPERTY_TYPES = ['SINGLE_FAMILY', 'MULTIFAMILY', 'CONDO', 'TOWNHOUSE', 'LAND', 'OTHER'] as const;
export const REPAIR_CATEGORIES = [
  'Roof', 'Foundation / structure', 'HVAC', 'Electrical', 'Plumbing', 'Kitchen',
  'Bathrooms', 'Flooring', 'Interior paint / drywall', 'Windows / doors', 'Exterior / landscaping', 'Permits / other',
];
