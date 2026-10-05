import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useClerk, useUser } from '@clerk/react';
import { Bell, ClipboardCheck, Gauge, Headphones, House, ListChecks, LogOut, Radar, Search, Settings2, Sparkles, UsersRound } from 'lucide-react';
import { getGetCommandCenterQueryKey, useGetCommandCenter } from '@workspace/api-client-react';
import { useAccess } from '@/hooks/use-access';
import { WorkspaceSearchContext } from '@/components/workspace-search';
import '@/field-desk.css';

const NAV = [
  { href: '/dashboard', label: 'Command center', icon: Gauge },
  { href: '/calls', label: 'Call next', icon: Headphones },
  { href: '/leads', label: 'Deal inventory', icon: ClipboardCheck },
  { href: '/sources', label: 'Sources', icon: Radar },
  { href: '/buyers', label: 'Buyers', icon: UsersRound },
  { href: '/workers', label: 'Workers', icon: Settings2 },
  { href: '/audit', label: 'Audit trail', icon: ListChecks },
  { href: '/settings', label: 'Settings', icon: Settings2 },
];

export function AppShell({ children }: { children: ReactNode }) {
  const [loc, setLocation] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();
  const { access } = useAccess();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dash = useGetCommandCenter({ query: { queryKey: getGetCommandCenterQueryKey(), staleTime: 20_000, refetchInterval: 30_000 } });
  const ready = dash.data?.calls.length ?? 0;
  const failedJobs = dash.data?.jobs.filter((job) => job.state === 'FAILED').length ?? 0;
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const mainNav = NAV.filter((item) => item.href !== '/settings');
  const settingsNav = NAV.find((item) => item.href === '/settings')!;
  const currentPage = NAV.find((item) => loc === item.href || loc.startsWith(`${item.href}/`));
  const pageLabel = loc.startsWith('/deals/') ? 'Deal detail' : currentPage?.label ?? 'Workspace';
  const displayName = user?.fullName || user?.primaryEmailAddress?.emailAddress || 'Workspace account';
  const initials = displayName.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'RD';
  const role = access.role.replace(/_/g, ' ').toLowerCase();
  const status = dash.isError ? 'Connection issue' : dash.isLoading ? 'Loading workspace' : 'Workspace live';
  const toggleWorkspaceSearch = () => {
    if (loc !== '/dashboard') {
      setLocation('/dashboard');
      setSearchOpen(true);
      return;
    }
    if (searchOpen) setSearchQuery('');
    setSearchOpen(!searchOpen);
  };

  return (
    <div className="field-desk">
      <div className="fd-shell">
        <aside className="fd-sidebar">
          <Link href="/dashboard" className="fd-brand" data-testid="link-home">
            <span className="fd-mark"><House size={18} strokeWidth={2.5} /></span>
            <span><div className="fd-brand-title">radical</div><div className="fd-brand-sub">deal operations</div></span>
          </Link>
          <div className="fd-workspace">
            <span className="fd-workspace-mark">RD</span>
            <span><div className="fd-workspace-name">Deal workspace</div><div className="fd-workspace-loc">Owner-controlled operations</div></span>
          </div>
          <div className="fd-nav-label">Workspace</div>
          <nav className="fd-nav" aria-label="Main navigation">
            {mainNav.map((item) => {
              const active = loc === item.href || loc.startsWith(`${item.href}/`) || (item.href === '/dashboard' && loc.startsWith('/deals/'));
              return (
                <Link key={item.href} href={item.href} data-testid={`nav-${item.href === '/audit' ? 'audit' : item.label.toLowerCase().replace(/ /g, '-')}`}
                  className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
                  <item.icon size={15} strokeWidth={1.9} />
                  <span>{item.label}</span>
                  {item.href === '/calls' && ready > 0 && <span className="fd-nav-count" data-testid="badge-call-ready">{ready}</span>}
                </Link>
              );
            })}
          </nav>
          <div className="fd-sidebar-bottom">
            <div className="fd-nav-label">Workspace</div>
            <nav className="fd-nav" aria-label="Workspace settings">
              <Link href={settingsNav.href} data-testid="nav-settings" className={loc === settingsNav.href ? 'active' : ''}>
                <settingsNav.icon size={15} strokeWidth={1.9} /><span>{settingsNav.label}</span>
              </Link>
            </nav>
            <div className="fd-sidebar-note">
              <div className="fd-note-top"><Sparkles size={13} /> Owner-reviewed operations</div>
              <div className="fd-note-copy">{ready > 0 ? `${ready} seller${ready === 1 ? '' : 's'} currently clear for outreach.` : 'Call permission and commercial approvals remain owner-reviewed.'} Your approvals stay yours.</div>
            </div>
            <button className="fd-profile fd-profile-button" type="button" onClick={() => signOut({ redirectUrl: base || '/' })} data-testid="button-sign-out" aria-label={`Sign out ${displayName}`}>
              <span className="fd-avatar">{initials}</span>
              <span className="min-w-0 flex-1"><div className="fd-profile-name truncate" data-testid="text-user-email">{displayName}</div><div className="fd-profile-role" data-testid="text-user-role">{role}</div></span>
              <LogOut size={14} aria-hidden="true" />
            </button>
          </div>
        </aside>
        <div className="fd-main">
          <header className="fd-topbar">
            <div className="fd-breadcrumb">Radical Deal OS <span style={{ padding: '0 7px', color: '#bac8be' }}>/</span><strong>{pageLabel}</strong></div>
            <div className="fd-top-actions">
              <div className={`fd-status ${dash.isError ? 'fd-status-issue' : ''}`} role="status"><span className="fd-status-dot" />{status}</div>
              <span className="fd-date">{new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}</span>
              <button className="fd-icon-button" type="button" onClick={toggleWorkspaceSearch} aria-label={searchOpen ? 'Close workspace search' : 'Search workspace'} aria-expanded={searchOpen} title="Search workspace"><Search size={15} /></button>
              <Link className="fd-icon-button" href="/audit" aria-label={failedJobs ? `Open audit trail, ${failedJobs} failed worker jobs` : 'Open audit trail'} title="Open audit trail">
                <Bell size={15} />{failedJobs > 0 && <i className="fd-notice-dot" />}
              </Link>
              <button className="fd-icon-button fd-mobile-logout" type="button" onClick={() => signOut({ redirectUrl: base || '/' })} data-testid="button-sign-out-mobile" aria-label="Sign out"><LogOut size={15} /></button>
            </div>
          </header>
          <main className="fd-content">
            <WorkspaceSearchContext.Provider value={{ open: searchOpen, query: searchQuery, setQuery: setSearchQuery }}>
              {children}
            </WorkspaceSearchContext.Provider>
          </main>
        </div>
      </div>
    </div>
  );
}
