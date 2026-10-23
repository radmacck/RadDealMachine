import type { PropertyDiscovery } from '@workspace/api-client-react';

export const BUYER_PROPERTY_HANDOFF_POOL_LIMIT = 100;

export function buyerPropertyDiscoveryListLimit(openDiscoveryId: string | null | undefined, defaultLimit: number) {
  return openDiscoveryId ? BUYER_PROPERTY_HANDOFF_POOL_LIMIT : defaultLimit;
}

/**
 * Continue from a buyer-first candidate into the existing owner-reviewed
 * property workflow. This only navigates; qualification and promotion remain
 * behind their existing evidence and authorization gates.
 */
export function buyerPropertyHandoffHref(discovery: Pick<PropertyDiscovery, 'id' | 'leadId'>) {
  return discovery.leadId
    ? `/deals/${encodeURIComponent(discovery.leadId)}`
    : `/sources?discovery=${encodeURIComponent(discovery.id)}`;
}
