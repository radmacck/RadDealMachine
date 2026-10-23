import type { Buyer, PropertyDiscovery } from '@workspace/api-client-react';
import { buyerEvidenceStatus, describeBuyerPropertyFacts, evaluateBuyerPropertyFit, hasIncompleteCorePropertyFacts, type BuyerEvidenceContext } from './buyer-property-fit';

export type BuyerPropertyCandidate = {
  discovery: PropertyDiscovery;
  state: 'STRONG_MATCH' | 'WEAK_MATCH' | 'NO_MATCH' | 'STALE_SOURCE' | 'STALE_BUYER' | 'INCOMPLETE_PROPERTY' | 'UNAVAILABLE';
  matched: string[];
  missed: string[];
  missingFacts: string[];
  lastObservedAt: string | null;
  explanation: {
    criteriaUsed: string[];
    buyerVersion: number | null;
    criteriaEvidenceUrl: string | null;
    buyingEvidenceAt: string | null;
    buyerUpdatedAt: string | null;
    propertyFactsUsed: string[];
    provenanceUsed: string[];
    assumptions: string[];
  };
};

export type BuyerPropertyDiscoveryResult = {
  state: 'MISSING_CRITERIA' | 'UNAVAILABLE' | 'NO_MATCH' | 'PARTIAL_POOL' | 'MATCHES';
  candidates: BuyerPropertyCandidate[];
  note: string;
};

export function buyerPropertyCandidateStateLabel(state: BuyerPropertyCandidate['state']) {
  switch (state) {
    case 'STRONG_MATCH': return 'Potential criteria fit';
    case 'WEAK_MATCH': return 'Possible fit · facts missing';
    case 'NO_MATCH': return 'Does not fit saved criteria';
    case 'STALE_SOURCE': return 'Source data is stale';
    case 'STALE_BUYER': return 'Buyer evidence is stale';
    case 'INCOMPLETE_PROPERTY': return 'Property details are incomplete';
    case 'UNAVAILABLE': return 'Not a current candidate';
  }
}

const MAX_SOURCE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const compareText = (a: string, b: string) => a.localeCompare(b);
export function discoverBuyerPropertyCandidates(
  criteria: Buyer['criteria'],
  records: PropertyDiscovery[],
  now: Date,
  options: { loading?: boolean; unavailable?: boolean; hasMore?: boolean; marketSupported?: boolean; marketPartial?: boolean; buyerContext?: BuyerEvidenceContext } = {},
): BuyerPropertyDiscoveryResult {
  if (!criteria) return { state: 'MISSING_CRITERIA', candidates: [], note: 'This buyer has no saved purchase criteria. Add and review criteria before searching properties.' };
  if (options.loading) return { state: 'UNAVAILABLE', candidates: [], note: 'Loading the available source-backed property pool.' };
  if (options.unavailable) return { state: 'UNAVAILABLE', candidates: [], note: 'The property source pool is currently unavailable. No match result can be determined.' };
  if (options.marketSupported === false) return { state: 'UNAVAILABLE', candidates: [], note: 'The available discovery source pool currently covers Philadelphia, PA only; this buyer’s saved markets are outside that pool.' };
  if (!criteria.states.length || !criteria.propertyTypes.length || !Number.isFinite(criteria.maxPurchasePrice) || criteria.maxPurchasePrice <= 0) {
    return { state: 'MISSING_CRITERIA', candidates: [], note: 'Required state, property type, or maximum price criteria are missing. Complete and review the buyer criteria first.' };
  }

  const candidates = records
    .map((discovery): BuyerPropertyCandidate => {
      const property = discovery.property;
      const sourceObservations = discovery.sourceObservations ?? [];
      const latest = sourceObservations.map(item => item.lastObservedAt).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
      const age = latest ? now.getTime() - Date.parse(latest) : Number.POSITIVE_INFINITY;
      const fit = evaluateBuyerPropertyFit(criteria, {
        state: property.state, city: property.city, county: property.county, zip: property.zip,
        propertyType: property.propertyType, sqft: property.sqft, beds: property.beds, baths: property.baths,
        askingPrice: null, units: null, rehabCondition: null, address: property.address,
        assessedValue: property.assessedValue, lastSalePrice: property.lastSalePrice,
      });
      const buyerEvidence = options.buyerContext ? buyerEvidenceStatus(options.buyerContext, now) : { stale: false, unknown: [] };
      const matched = fit.matched;
      const missed = fit.unmet;
      const missingFacts = [...new Set([...(discovery.missingInformation ?? []), ...fit.unknown, ...buyerEvidence.unknown])];
      const propertyFactsUsed = describeBuyerPropertyFacts({
        address: property.address, state: property.state, city: property.city, county: property.county, zip: property.zip,
        propertyType: property.propertyType, sqft: property.sqft, beds: property.beds, baths: property.baths,
        askingPrice: null, assessedValue: property.assessedValue, lastSalePrice: property.lastSalePrice,
      });
      const provenanceUsed = [...sourceObservations]
        .sort((a, b) => compareText(a.sourceName, b.sourceName) ||
          compareText(a.sourceUrl, b.sourceUrl) || compareText(a.lastObservedAt, b.lastObservedAt) ||
          compareText(a.evidenceRef ?? '', b.evidenceRef ?? '') || compareText(a.id, b.id))
        .map(item => `${item.sourceName} · ${item.lastObservedAt} · ${item.classification ?? 'unclassified'} · ${item.sourceUrl} · ref ${item.evidenceRef ?? 'not recorded'}`);
      const assumptions = [
        'Current asking/acquisition price is unknown and is not inferred from assessment or prior sale.',
        'Potential match is criteria alignment only; not availability, profitability, suitability, funding, or closing assurance.',
      ];
      const explanation = {
        criteriaUsed: fit.criteriaUsed, buyerVersion: options.buyerContext?.version ?? null,
        criteriaEvidenceUrl: options.buyerContext?.criteriaEvidenceUrl ?? null,
        buyingEvidenceAt: options.buyerContext?.buyingEvidenceAt ?? null,
        buyerUpdatedAt: options.buyerContext?.updatedAt ?? null,
        propertyFactsUsed, provenanceUsed, assumptions,
      };

      if (discovery.status === 'DISQUALIFIED' || discovery.leadId) {
        return { discovery, state: 'UNAVAILABLE', matched, missed, missingFacts: [
          discovery.leadId ? 'Already linked to an acquisition lead; not an available discovery candidate.' : 'This property discovery was disqualified.',
        ], lastObservedAt: latest, explanation };
      }

      if (!sourceObservations.length || !latest || !Number.isFinite(Date.parse(latest))) {
        return { discovery, state: 'UNAVAILABLE', matched, missed, missingFacts: ['No dated source observation is available.'], lastObservedAt: latest, explanation };
      }
      if (age < 0 || age > MAX_SOURCE_AGE_MS) {
        return { discovery, state: 'STALE_SOURCE', matched, missed, missingFacts: ['Source observation is older than 30 days or has a future timestamp; refresh before relying on it.'], lastObservedAt: latest, explanation };
      }

      // Public-record assessed value and prior sale price are not current asking prices.
      const state = buyerEvidence.stale ? 'STALE_BUYER' : missed.length ? 'NO_MATCH'
        : hasIncompleteCorePropertyFacts({
          state: property.state, city: property.city, county: property.county, zip: property.zip,
          propertyType: property.propertyType, sqft: property.sqft, beds: property.beds, baths: property.baths,
          askingPrice: null, units: null, rehabCondition: null, address: property.address,
        }) ? 'INCOMPLETE_PROPERTY'
          : fit.unknown.length || buyerEvidence.unknown.length || (discovery.missingInformation?.length ?? 0) ? 'WEAK_MATCH' : 'STRONG_MATCH';
      return { discovery, state, matched, missed, missingFacts, lastObservedAt: latest, explanation };
    });

  const potentials = candidates.filter(item => ['STRONG_MATCH', 'WEAK_MATCH', 'INCOMPLETE_PROPERTY'].includes(item.state));
  const partial = options.hasMore || options.marketPartial;
  const state = potentials.length ? (partial ? 'PARTIAL_POOL' : 'MATCHES')
    : partial ? 'PARTIAL_POOL' : 'NO_MATCH';
  const note = state === 'MATCHES'
    ? 'Potential matches align with the known criteria only. Unknown price and property facts remain unresolved; this is not a suitability, profitability, or availability guarantee.'
    : state === 'PARTIAL_POOL'
      ? 'The loaded source pool is incomplete. Results are provisional; no all-pool no-match conclusion is available.'
      : 'No available source-backed property in the completed pool fits the known criteria. This is not a statement about unsearched markets or listings.';
  return { state, candidates, note };
}
