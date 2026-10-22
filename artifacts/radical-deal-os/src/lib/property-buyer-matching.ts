import type { Buyer } from '@workspace/api-client-react';
import { buyerEvidenceStatus, describeBuyerPropertyFacts, evaluateBuyerPropertyFit, hasIncompleteCorePropertyFacts, type BuyerPropertyFacts } from './buyer-property-fit';
export type PropertyBuyerSubject = BuyerPropertyFacts;

export type PropertyBuyerMatch = {
  buyer: Buyer;
  state: 'STRONG_MATCH' | 'WEAK_MATCH' | 'NO_MATCH' | 'MISSING_CRITERIA' | 'STALE_BUYER' | 'INCOMPLETE_PROPERTY' | 'SYNTHETIC';
  matched: string[];
  unmet: string[];
  unknown: string[];
  criteriaUsed: string[];
  propertyFactsUsed: string[];
  provenanceUsed: string[];
};

const synthetic = (buyer: Buyer) => (buyer as Buyer & { syntheticFixture?: boolean }).syntheticFixture === true ||
  /^(?:synthetic|fixture|test fixture|demo fixture)(?:\b|:)/i.test(buyer.source.trim());

export function matchSavedBuyersToProperty(subject: PropertyBuyerSubject, buyers: Buyer[], now: Date): PropertyBuyerMatch[] {
  return buyers.map((buyer) => {
    const propertyFactsUsed = describeBuyerPropertyFacts(subject);
    const provenanceUsed = [...(subject.provenanceUsed ?? [])].sort((a, b) => a.localeCompare(b));
    const criteria = buyer.criteria;
    if (!criteria) return { buyer, state: 'MISSING_CRITERIA', matched: [], unmet: [], unknown: ['No saved purchase criteria.'], criteriaUsed: [], propertyFactsUsed, provenanceUsed };
    if (synthetic(buyer)) return { buyer, state: 'SYNTHETIC', matched: [], unmet: [], unknown: ['Synthetic test record is not a real buyer.'], criteriaUsed: [], propertyFactsUsed, provenanceUsed };
    if (!criteria.states.length || !criteria.propertyTypes.length || !Number.isFinite(criteria.maxPurchasePrice)) {
      return { buyer, state: 'MISSING_CRITERIA', matched: [], unmet: [], unknown: ['Required state, property type, or maximum purchase price criteria are missing.'], criteriaUsed: [], propertyFactsUsed, provenanceUsed };
    }

    const fit = evaluateBuyerPropertyFit(criteria, subject);
    const { matched, unmet } = fit;
    const evidence = buyerEvidenceStatus(buyer, now);
    const unknown = [...fit.unknown, ...evidence.unknown];
    const incompleteProperty = hasIncompleteCorePropertyFacts(subject);
    const state = evidence.stale ? 'STALE_BUYER'
      : unmet.length ? 'NO_MATCH'
        : incompleteProperty ? 'INCOMPLETE_PROPERTY'
          : unknown.some(value => /missing|unknown|unavailable/i.test(value)) ? 'WEAK_MATCH' : 'STRONG_MATCH';
    return { buyer, state, matched, unmet, unknown, criteriaUsed: fit.criteriaUsed, propertyFactsUsed, provenanceUsed };
  });
}
