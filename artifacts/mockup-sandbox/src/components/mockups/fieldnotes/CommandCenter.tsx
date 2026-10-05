import { useMemo, useState } from 'react';
import {
  ArrowRight, Bell, Building2, CalendarClock, Check, ChevronDown,
  CircleDollarSign, ClipboardCheck, Clock3, Compass, Gauge,
  HandCoins, Headphones, House, Leaf, ListChecks, MapPin, Plus, Radar,
  Search, Settings2, ShieldCheck, Sparkles, UsersRound, WalletCards, Zap,
} from 'lucide-react';
import './commandcenter.css';

type Action = { id: string; kind: string; title: string; reason: string; due: string; cta: string };

const initialActions: Action[] = [
  { id: 'a1', kind: 'Follow up', title: 'Check in with Marisol Vega', reason: 'Seller asked for a call after her contractor visit', due: 'Today · 2:30 PM', cta: 'Open follow-up' },
  { id: 'a2', kind: 'Call', title: 'Review the Alder Street numbers', reason: 'Owner-approved offer range is ready to discuss', due: 'Today · 4:00 PM', cta: 'Open call brief' },
  { id: 'a3', kind: 'Research', title: 'Verify county record for 1842 Juniper Rd', reason: 'One ownership detail needs a second source', due: 'Tomorrow', cta: 'Continue research' },
];

const nav = [
  { label: 'Command center', icon: Gauge, count: '' },
  { label: 'Call next', icon: Headphones, count: '2' },
  { label: 'Deal inventory', icon: ClipboardCheck, count: '' },
  { label: 'Sources', icon: Radar, count: '' },
  { label: 'Buyers', icon: UsersRound, count: '' },
  { label: 'Workers', icon: Settings2, count: '' },
  { label: 'Audit trail', icon: ListChecks, count: '' },
];

export default function CommandCenter() {
  const [activeNav, setActiveNav] = useState('Command center');
  const [done, setDone] = useState<string[]>([]);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [toast, setToast] = useState('');
  const [lastRefresh, setLastRefresh] = useState('just now');
  const [showAll, setShowAll] = useState(false);
  const [called, setCalled] = useState(false);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2200);
  };
  const actions = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    const filtered = initialActions.filter((item) => !query || `${item.title} ${item.reason} ${item.kind}`.toLowerCase().includes(query));
    return showAll ? filtered : filtered.slice(0, 3);
  }, [searchText, showAll]);

  return (
    <div className="field-desk">
      <div className="fd-shell">
        <aside className="fd-sidebar">
          <div className="fd-brand">
            <span className="fd-mark"><House size={18} strokeWidth={2.5} /></span>
            <span><div className="fd-brand-title">radical</div><div className="fd-brand-sub">deal operations</div></span>
          </div>
          <div className="fd-workspace">
            <span className="fd-workspace-mark">NW</span>
            <span><div className="fd-workspace-name">Northwind Acquisitions</div><div className="fd-workspace-loc">Pacific Northwest</div></span>
            <ChevronDown size={14} style={{ marginLeft: 'auto', color: '#b5ccc0' }} />
          </div>
          <div className="fd-nav-label">Workspace</div>
          <nav className="fd-nav" aria-label="Main navigation">
            {nav.map(({ label, icon: Icon, count }) => (
              <button key={label} type="button" className={activeNav === label ? 'active' : ''} onClick={() => setActiveNav(label)}>
                <Icon size={15} strokeWidth={1.9} /><span>{label}</span>{count && <span className="fd-nav-count">{count}</span>}
              </button>
            ))}
          </nav>
          <div className="fd-sidebar-bottom">
            <div className="fd-nav-label">Workspace</div>
            <nav className="fd-nav">
              <button type="button" className={activeNav === 'Settings' ? 'active' : ''} onClick={() => setActiveNav('Settings')}><Settings2 size={15} /><span>Settings</span></button>
            </nav>
            <div className="fd-sidebar-note">
              <div className="fd-note-top"><Sparkles size={13} /> Your desk, in sync</div>
              <div className="fd-note-copy">Next record check runs at 3:15 PM. Your approvals stay yours.</div>
            </div>
            <div className="fd-profile">
              <span className="fd-avatar">AM</span>
              <span><div className="fd-profile-name">Alex Morgan</div><div className="fd-profile-role">Workspace owner</div></span>
              <ChevronDown size={14} style={{ marginLeft: 'auto', color: '#a9c3b8' }} />
            </div>
          </div>
        </aside>

        <main className="fd-main">
          <div className="fd-topbar">
            <div className="fd-breadcrumb">Northwind Acquisitions <span style={{ padding: '0 7px', color: '#bac8be' }}>/</span><strong>{activeNav}</strong></div>
            <div className="fd-top-actions">
              <div className="fd-status"><span className="fd-status-dot" /> All systems steady</div>
              <span className="fd-date">MON, MAY 19</span>
              <button className="fd-icon-button" type="button" aria-label="Search workspace" onClick={() => { setSearchOpen((open) => !open); setSearchText(''); }}><Search size={15} /></button>
              <button className="fd-icon-button" type="button" aria-label="Notifications" onClick={() => setNoticeOpen((open) => !open)}><Bell size={15} /><i className="fd-notice-dot" /></button>
            </div>
          </div>
          {noticeOpen && <div className="fd-toast" role="status">One buyer verification needs a fresh check.</div>}
          <div className="fd-content">
            <header className="fd-page-head">
              <div>
                <div className="fd-eyebrow"><span className="fd-eyebrow-mark" /> Monday field notes <span style={{ color: '#bdc9be' }}>·</span> Live / updated {lastRefresh}</div>
                <h1 className="fd-title">Command center</h1>
                <p className="fd-subtitle">A clear view of what moves your deals forward today.</p>
              </div>
              <div className="fd-head-buttons">
                <button className="fd-button" type="button" onClick={() => { setLastRefresh('a moment ago'); showToast('Everything is up to date.'); }}><Zap size={14} /> Refresh desk</button>
                <button className="fd-button fd-button-primary" type="button" onClick={() => showToast('New lead intake is ready.') }><Plus size={15} /> Add a lead</button>
              </div>
            </header>

            {searchOpen && <div style={{ marginBottom: 15 }}>
              <label htmlFor="fd-search" className="fd-eyebrow" style={{ marginBottom: 7 }}>Search your workspace</label>
              <input id="fd-search" value={searchText} onChange={(event) => setSearchText(event.target.value)} autoFocus placeholder="Try an address, seller, or task…" style={{ width: '100%', padding: '11px 13px', border: '1px solid #dce8df', borderRadius: 11, background: '#fffefa', color: '#183c37', outlineColor: '#a3b98a', font: '12px DM Sans, sans-serif' }} />
            </div>}

            <section className="fd-metrics" aria-label="Portfolio snapshot">
              <div className="fd-metric"><span className="fd-metric-icon"><Building2 size={17} /></span><span><div className="fd-metric-value">12</div><div className="fd-metric-label">Active opportunities</div></span></div>
              <div className="fd-metric"><span className="fd-metric-icon"><Headphones size={17} /></span><span><div className="fd-metric-value">2</div><div className="fd-metric-label">Sellers ready to call</div></span></div>
              <div className="fd-metric"><span className="fd-metric-icon"><HandCoins size={17} /></span><span><div className="fd-metric-value">4</div><div className="fd-metric-label">Deals in motion</div></span></div>
              <div className="fd-metric"><span className="fd-metric-icon"><CalendarClock size={17} /></span><span><div className="fd-metric-value">1</div><div className="fd-metric-label">Closing this month</div></span></div>
            </section>

            <section className="fd-actions-section">
              <div className="fd-section-head">
                <div className="fd-section-title"><Compass size={16} /> Do next <small>{actions.length}</small></div>
                <button className="fd-text-link" type="button" onClick={() => showToast('Official county and municipal sources are ready to explore.')}>Find properties from official records <ArrowRight size={12} style={{ verticalAlign: 'middle', marginLeft: 3 }} /></button>
              </div>
              {actions.length === 0 ? <div className="fd-empty">No tasks match that search. Try a different name or address.</div> :
                <div className="fd-action-list">
                  {actions.map((action) => {
                    const isDone = done.includes(action.id);
                    return <article key={action.id} className={`fd-action ${isDone ? 'fd-done' : ''}`}>
                      <span className="fd-action-stripe" />
                      <span className="fd-action-tag">{isDone ? 'Done' : action.kind}</span>
                      <div><div className="fd-action-title">{action.title}</div><div className="fd-action-reason">{action.reason}</div></div>
                      <span className="fd-due"><Clock3 size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />{action.due}</span>
                      <button type="button" className="fd-action-link" onClick={() => {
                        if (action.kind === 'Call') setCalled(true);
                        else setDone((current) => isDone ? current.filter((id) => id !== action.id) : [...current, action.id]);
                        showToast(isDone ? 'Task moved back to your list.' : action.kind === 'Call' ? 'Call brief opened. Your offer guardrails are in view.' : 'Task marked complete.');
                      }}>{isDone ? <><Check size={14} /> Completed</> : <>{action.cta}<ArrowRight size={13} /></>}</button>
                    </article>;
                  })}
                </div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 7 }}>
                <button className="fd-text-link" type="button" onClick={() => setShowAll((current) => !current)}>{showAll ? 'Show the essentials' : 'View all tasks'} <ArrowRight size={12} style={{ verticalAlign: 'middle', marginLeft: 3 }} /></button>
              </div>
            </section>

            <div className="fd-grid">
              <section className="fd-panel">
                <div className="fd-section-head"><div className="fd-section-title"><Headphones size={15} /> Call-ready sellers <small>2</small></div><button className="fd-text-link" type="button" onClick={() => setActiveNav('Call next')}>Call queue</button></div>
                <div className="fd-list">
                  <article className="fd-row">
                    <div className="fd-row-top"><div><div className="fd-row-name">Marisol Vega</div><div className="fd-row-meta">910 Alder Street · Tacoma, WA</div></div><button className={`fd-pill ${called ? '' : 'fd-pill-coral'}`} type="button" onClick={() => { setCalled((value) => !value); showToast(called ? 'Call marked as not started.' : 'Call brief opened with owner-approved terms.'); }}>{called ? <><Check size={11} /> Brief ready</> : 'Call next'}</button></div>
                    <div className="fd-row-copy">Wants to talk through timing after contractor visit.</div>
                    <div className="fd-row-foot"><ShieldCheck size={11} style={{ verticalAlign: 'middle', marginRight: 5 }} />Owner-approved ceiling $184,000 · not a quote</div>
                  </article>
                  <article className="fd-row">
                    <div className="fd-row-top"><div><div className="fd-row-name">Daniel &amp; Ren Ito</div><div className="fd-row-meta">42 Willow Bend · Olympia, WA</div></div><span className="fd-pill">Research cleared</span></div>
                    <div className="fd-row-copy">Asked about a flexible close; seller's preferred window is June.</div>
                    <div className="fd-row-foot"><ShieldCheck size={11} style={{ verticalAlign: 'middle', marginRight: 5 }} />Call permission confirmed · last checked today</div>
                  </article>
                </div>
              </section>

              <section className="fd-panel">
                <div className="fd-section-head"><div className="fd-section-title"><House size={15} /> Live deals <small>4</small></div><button className="fd-text-link" type="button" onClick={() => setActiveNav('Deal inventory')}>Deal inventory</button></div>
                <div className="fd-list">
                  <article className="fd-deal-row"><div><div className="fd-row-name">1842 Juniper Road</div><div className="fd-row-meta">Portland, OR · Next: confirm title contact</div></div><span className="fd-stage">Underwrite</span></article>
                  <article className="fd-deal-row"><div><div className="fd-row-name">77 Beacon Avenue</div><div className="fd-row-meta">Vancouver, WA · Next: share revised terms</div></div><span className="fd-stage">Negotiation</span></article>
                  <article className="fd-deal-row"><div><div className="fd-row-name">910 Alder Street</div><div className="fd-row-meta">Tacoma, WA · Next: seller conversation</div></div><span className="fd-stage">Call ready</span></article>
                </div>
              </section>

              <section className="fd-panel">
                <div className="fd-section-head"><div className="fd-section-title"><WalletCards size={15} /> Contracts &amp; closing <small>2</small></div></div>
                <div className="fd-list">
                  <article className="fd-row">
                    <div className="fd-row-top"><div className="fd-row-name">306 Fernhill Loop</div><span className="fd-pill">In review</span></div>
                    <div className="fd-contract-meta"><span>$238,500</span><span>2 / 4 milestones</span><span>1 committed buyer</span></div>
                    <div className="fd-row-copy">Waiting for title review before sharing next-step dates.</div>
                  </article>
                  <article className="fd-row">
                    <div className="fd-row-top"><div className="fd-row-name">19 Orchard Lane</div><span className="fd-pill fd-pill-coral">Draft only</span></div>
                    <div className="fd-contract-meta"><span>$196,000</span><span>Not executed</span><span>0 commitments</span></div>
                  </article>
                </div>
              </section>

              <section className="fd-panel">
                <div className="fd-section-head"><div className="fd-section-title"><CalendarClock size={15} /> Closing deadlines <small>1</small></div></div>
                <div className="fd-list">
                  <div className="fd-deadline"><span className="fd-deadline-date">306 Fernhill Loop <span style={{ color: '#9aa69e', fontWeight: 400 }}>· Clark County</span></span><span className="fd-deadline-count">May 28 <span style={{ color: '#6d905e' }}>· 9 days</span></span></div>
                  <div className="fd-empty" style={{ padding: 12 }}>No urgent dates. Keep the title review moving and this stays on track.</div>
                </div>
              </section>

              <section className="fd-panel">
                <div className="fd-section-head"><div className="fd-section-title"><UsersRound size={15} /> Qualified buyers <small>3 of 8</small></div><button className="fd-text-link" type="button" onClick={() => setActiveNav('Buyers')}>All buyers</button></div>
                <div className="fd-list">
                  <article className="fd-deal-row"><div><div className="fd-row-name">Cedar &amp; Stone Partners</div><div className="fd-row-meta">OR, WA · up to $320,000</div></div><span className="fd-pill">Qualified</span></article>
                  <article className="fd-deal-row"><div><div className="fd-row-name">Nia Brooks</div><div className="fd-row-meta">Pierce County · criteria on file</div></div><span className="fd-pill">Qualified</span></article>
                  <article className="fd-deal-row"><div><div className="fd-row-name">Evergreen Homes LLC</div><div className="fd-row-meta">WA · refresh evidence</div></div><span className="fd-pill fd-pill-coral">Review due</span></article>
                </div>
              </section>

              <section className="fd-panel">
                <div className="fd-section-head"><div className="fd-section-title"><Zap size={15} /> Worker activity <small>3</small></div><button className="fd-text-link" type="button" onClick={() => setActiveNav('Workers')}>Open workers</button></div>
                <div className="fd-list">
                  <div className="fd-worker-row"><span className="fd-pill">Complete</span><span className="fd-worker-label">Public record check · 1842 Juniper Road</span><span className="fd-date">2m</span></div>
                  <div className="fd-worker-row"><span className="fd-pill fd-pill-dark">Running</span><span className="fd-worker-label">Buyer criteria refresh</span><span className="fd-date">8m</span></div>
                  <div className="fd-worker-row"><span className="fd-pill">Complete</span><span className="fd-worker-label">Deadline monitor · 4 records reviewed</span><span className="fd-date">1h</span></div>
                </div>
              </section>
            </div>

            <section className="fd-opps">
              <div className="fd-section-head"><div className="fd-section-title"><CircleDollarSign size={15} /> Opportunities to work up <small>2</small></div><button className="fd-text-link" type="button" onClick={() => showToast('Showing opportunities that need research.')}>See research queue</button></div>
              <div className="fd-opp-grid">
                <article className="fd-opp"><div className="fd-row-top"><div className="fd-row-name">58 Alder Court · Salem, OR</div><span className="fd-stage">New lead</span></div><div className="fd-opp-info"><MapPin size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />2 evidence items · not underwritten · Verify parcel owner</div></article>
                <article className="fd-opp"><div className="fd-row-top"><div className="fd-row-name">1206 S Junett Street · Tacoma, WA</div><span className="fd-stage">Research</span></div><div className="fd-opp-info"><Leaf size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />4 evidence items · review needed · Confirm occupancy</div></article>
              </div>
            </section>
          </div>
        </main>
      </div>
      {toast && !noticeOpen && <div className="fd-toast" role="status">{toast}</div>}
    </div>
  );
}
