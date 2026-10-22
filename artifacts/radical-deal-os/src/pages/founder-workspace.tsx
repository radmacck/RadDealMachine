import { ArrowRight, Building2, GitMerge, ListChecks, MessageSquareText, UsersRound, FileSignature } from 'lucide-react';
import { Link } from 'wouter';
import { PageHeader } from '@/components/page-header';
import { useAccess } from '@/hooks/use-access';
import {
  canAccessFounderWorkspace,
  founderWorkspaceAreasForRole,
  FOUNDER_WORKSPACE_UNAVAILABLE,
} from '@/lib/founder-workspace-navigation';

const AREA_ICON = {
  properties: Building2,
  buyers: UsersRound,
  matching: GitMerge,
  'deal-tracking': ListChecks,
} as const;

const UNAVAILABLE_ICON = {
  'seller-messaging': MessageSquareText,
  'real-authorization': Building2,
  'signature-delivery': FileSignature,
} as const;

export default function FounderWorkspace() {
  const { access } = useAccess();
  const areas = founderWorkspaceAreasForRole(access.role);

  if (!canAccessFounderWorkspace(access.role)) {
    return (
      <section className="ledger max-w-2xl space-y-3 p-6" data-testid="founder-workspace-denied">
        <p className="eyebrow">Private workspace</p>
        <h1 className="font-display text-2xl font-semibold">Access not available</h1>
        <p className="text-sm text-muted-foreground">This workspace is limited to approved Owner, Analyst, and Operator roles.</p>
      </section>
    );
  }

  return (
    <div className="space-y-7" data-testid="founder-workspace">
      <PageHeader eyebrow="Private workspace" title="Founder workspace" />
      <p className="max-w-3xl text-sm text-muted-foreground">
        A private entry point to the existing acquisition and deal tools. This shell adds navigation only; matching remains advisory, and evidence gates still control consequential actions.
      </p>

      <section aria-label="Available work areas" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {areas.map((area) => {
          const Icon = AREA_ICON[area.key];
          return (
            <Link
              key={area.key}
              href={area.href}
              className="ledger group flex min-h-48 flex-col justify-between p-4 transition-colors hover:border-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
              data-testid={`founder-area-${area.key}`}
            >
              <div>
                <span className="mb-4 inline-flex h-9 w-9 items-center justify-center border border-border bg-muted/50 text-signal">
                  <Icon size={18} aria-hidden="true" />
                </span>
                <h2 className="font-display text-lg font-semibold">{area.title}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{area.description}</p>
              </div>
              <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold">
                Open existing tool <ArrowRight size={14} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          );
        })}
      </section>

      <section aria-labelledby="founder-unavailable-title" className="space-y-3">
        <div>
          <p className="eyebrow">Not available yet</p>
          <h2 id="founder-unavailable-title" className="font-display text-xl font-semibold">Flows that still need proof or infrastructure</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {FOUNDER_WORKSPACE_UNAVAILABLE.map((item) => {
            const Icon = UNAVAILABLE_ICON[item.key];
            return (
              <article key={item.key} className="ledger flex gap-3 p-4" data-testid={`founder-unavailable-${item.key}`}>
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center border border-border bg-muted/50 text-muted-foreground">
                  <Icon size={17} aria-hidden="true" />
                </span>
                <div>
                  <h3 className="font-semibold">{item.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                </div>
              </article>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          No public marketplace, automatic offer, seller message, or external provider action is started from this page.
        </p>
      </section>
    </div>
  );
}
