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

/**
 * Open the existing Owner-only buyer profile from a property-first match.
 * This is navigation only; it does not imply buyer approval or commitment.
 */
export function propertyBuyerProfileHref(buyerId: string) {
  return `/buyers/${encodeURIComponent(buyerId)}`;
}

export function propertyDiscoveryElementId(discoveryId: string) {
  return `property-discovery-${discoveryId}`;
}

type ScrollTarget = Pick<HTMLElement, 'scrollIntoView'>;

export function scrollPropertyDiscoveryIntoView(
  discoveryId: string,
  getElementById: (elementId: string) => ScrollTarget | null,
) {
  const target = getElementById(propertyDiscoveryElementId(discoveryId));
  if (!target) return false;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return true;
}
