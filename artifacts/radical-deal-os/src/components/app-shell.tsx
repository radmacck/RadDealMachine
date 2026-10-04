import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useClerk, useUser } from '@clerk/react';
import { ClipboardList, Cog, Gauge, History, LogOut, PhoneCall, Settings, Users } from 'lucide-react';
import { getGetDashboardQueryKey, useGetDashboard } from '@workspace/api-client-react';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { useAccess } from '@/hooks/use-access';

const NAV = [
  { href: '/dashboard', label: 'Command center', icon: Gauge },
  { href: '/calls', label: 'Call next', icon: PhoneCall },
  { href: '/leads', label: 'Deal inventory', icon: ClipboardList },
  { href: '/buyers', label: 'Buyers', icon: Users },
  { href: '/workers', label: 'Workers', icon: Cog },
  { href: '/audit', label: 'Audit', icon: History },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();
  const { access } = useAccess();
  const dash = useGetDashboard({ query: { queryKey: getGetDashboardQueryKey(), staleTime: 20_000, refetchInterval: 30_000 } });
  const ready = dash.data?.callReady ?? 0;
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');

  return (
    <div className="min-h-[100dvh] md:pl-60">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-sidebar p-4 text-sidebar-foreground md:flex">
        <Link href="/dashboard" data-testid="link-home"><Logo light /></Link>
        <nav className="mt-8 space-y-1">
          {NAV.map((n) => {
            const active = loc === n.href || loc.startsWith(`${n.href}/`) || (n.href === '/dashboard' && loc.startsWith('/deals/'));
            return (
              <Link key={n.href} href={n.href} data-testid={`nav-${n.label.toLowerCase().replace(/ /g, '-')}`}
                className={`flex items-center gap-3 border-l-2 px-3 py-2 text-sm transition-colors ${active ? 'border-sidebar-primary bg-sidebar-accent text-sidebar-accent-foreground' : 'border-transparent hover:bg-sidebar-accent/60'}`}>
                <n.icon className="h-4 w-4" />
                <span className="flex-1">{n.label}</span>
                {n.href === '/calls' && ready > 0 && <span className="bg-sidebar-primary px-1.5 font-mono text-xs font-semibold text-sidebar-primary-foreground" data-testid="badge-call-ready">{ready}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-4">
          <div className="border-t border-sidebar-border pt-3 text-xs">
            <p className="truncate" data-testid="text-user-email">{user?.primaryEmailAddress?.emailAddress ?? access.userId}</p>
            <p className="font-mono text-[10px] uppercase tracking-wider text-sidebar-primary" data-testid="text-user-role">{access.role}</p>
            <Button variant="ghost" size="sm" className="-ml-2 mt-1 text-sidebar-foreground hover:text-sidebar-accent-foreground" onClick={() => signOut({ redirectUrl: base || '/' })} data-testid="button-sign-out"><LogOut className="mr-1.5 h-3.5 w-3.5" />Sign out</Button>
          </div>
        </div>
      </aside>
      <div className="sticky top-0 z-30 bg-sidebar px-3 py-2 text-sidebar-foreground md:hidden">
        <div className="flex items-center justify-between"><Logo light />
          <Button variant="ghost" size="sm" className="text-sidebar-foreground" onClick={() => signOut({ redirectUrl: base || '/' })} data-testid="button-sign-out-mobile"><LogOut className="h-4 w-4" /></Button></div>
        <nav className="mt-2 flex gap-1 overflow-x-auto">
          {NAV.map((n) => {
            const active = loc === n.href || loc.startsWith(`${n.href}/`) || (n.href === '/dashboard' && loc.startsWith('/deals/'));
            return <Link key={n.href} href={n.href} data-testid={`nav-m-${n.label.toLowerCase().replace(/ /g, '-')}`} className={`whitespace-nowrap px-3 py-1.5 text-xs ${active ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'bg-sidebar-accent'}`}>{n.label}</Link>;
          })}
        </nav>
      </div>
      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
