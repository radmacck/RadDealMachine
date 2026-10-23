import React, { type ReactNode } from 'react';
import { Link } from 'wouter';
import { AlertTriangle, Inbox } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errInfo } from '@/lib/format';

export function ErrorNotice({ error, onRetry, retryLabel, title }: { error: unknown; onRetry?: () => void; retryLabel?: string; title?: string }) {
  const { status, message, details } = errInfo(error);
  const head =
    title ??
    (status === 401 ? 'Session not recognised'
      : status === 403 ? 'Your role cannot do this'
      : status === 409 ? 'Someone changed this record first'
      : status === 400 || status === 422 ? 'Please fix these inputs'
      : 'Request failed');
  return (
    <Alert variant="destructive" data-testid="notice-error" className="bg-card">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{head}</AlertTitle>
      <AlertDescription>
        <p>{message}</p>
        {details.length > 0 && (
          <ul className="mt-1 list-disc pl-5 text-xs">{details.map((d, i) => <li key={i}>{d}</li>)}</ul>
        )}
        {status === 401 && (
          <Link href="/sign-in" className="mt-2 inline-block underline" data-testid="link-resignin">Sign in again</Link>
        )}
        {status === 409 && <p className="mt-1 text-xs">Your draft is kept. Review the latest record, then save again.</p>}
        {onRetry && (
          <Button size="sm" variant="outline" className="mt-2" onClick={onRetry} data-testid="button-retry">{retryLabel ?? 'Retry'}</Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 border border-dashed border-border bg-card/60 p-6" data-testid="empty-state">
      <Inbox className="h-5 w-5 text-muted-foreground" />
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="max-w-prose text-sm text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

export function RowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" data-testid="skeleton-rows" role="status" aria-live="polite">
      <span className="sr-only">Loading records</span>
      <div aria-hidden="true">
        {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    </div>
  );
}
