export type WorkspaceRole = 'OWNER' | 'ANALYST' | 'OPERATOR' | 'VIEWER' | 'PENDING' | string;

export const FOUNDER_WORKSPACE_AREAS = [
  {
    key: 'properties',
    href: '/sources',
    title: 'Properties',
    description: 'Review permitted source observations, discovery records, provenance, and missing facts.',
  },
  {
    key: 'buyers',
    href: '/buyers',
    title: 'Buyers',
    description: 'Review saved buyer records, criteria, and their current verification status.',
  },
  {
    key: 'matching',
    href: '/leads',
    title: 'Buyer matching',
    description: 'Open a seller record to review available buyer matches and the criteria behind them.',
  },
  {
    key: 'deal-tracking',
    href: '/deals',
    title: 'Deal tracking',
    description: 'Review existing transaction records, milestones, and next actions.',
  },
] as const;

export function founderWorkspaceAreasForRole(role: WorkspaceRole) {
  return FOUNDER_WORKSPACE_AREAS.filter((area) => area.key !== 'buyers' || role === 'OWNER');
}

export const FOUNDER_WORKSPACE_UNAVAILABLE = [
  {
    key: 'seller-messaging',
    title: 'Seller messaging',
    description: 'Not available: there is no authenticated seller conversation flow or verified SMS provider.',
  },
  {
    key: 'real-authorization',
    title: 'Real seller authorization',
    description: 'Not verified: real seller identity, permission, and a current direct route still require Owner review.',
  },
  {
    key: 'signature-delivery',
    title: 'E-signature and document delivery',
    description: 'Not available: no signing or delivery provider is connected, and prepared documents remain unsigned.',
  },
] as const;

export function canAccessFounderWorkspace(role: WorkspaceRole): boolean {
  return role === 'OWNER' || role === 'ANALYST' || role === 'OPERATOR';
}

export function showWorkspaceNavigationItem(href: string, role: WorkspaceRole): boolean {
  if (href === '/workspace') return canAccessFounderWorkspace(role);
  if (href === '/buyers') return role === 'OWNER';
  return true;
}
