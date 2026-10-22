import test from 'node:test';
import assert from 'node:assert/strict';
import type { Buyer, PropertyDiscovery } from '@workspace/api-client-react';
import { matchSavedBuyersToProperty, type PropertyBuyerSubject } from './property-buyer-matching';
import { discoverBuyerPropertyCandidates } from './buyer-property-discovery';

const now = new Date('2026-10-22T12:00:00Z');
const criteria = {
  states: ['PA'], cities: ['Philadelphia'], zipCodes: ['19104'], counties: ['Philadelphia'],
  excludedCounties: [], excludedCities: [], excludedZipCodes: [], propertyTypes: ['SINGLE_FAMILY'],
  minPurchasePrice: 100000, maxPurchasePrice: 250000, minSqft: 600, maxSqft: 1800,
  minBeds: 2, maxBeds: 4, minBaths: 1, maxBaths: 3, maxRepairs: 50000,
} as NonNullable<Buyer['criteria']>;
const property: PropertyBuyerSubject = {
  state: 'PA', city: 'Philadelphia', county: 'Philadelphia', zip: '19104',
  propertyType: 'SINGLE_FAMILY', sqft: 1000, beds: 3, baths: 2, askingPrice: 200000,
};

function buyer(overrides: Partial<Buyer> = {}): Buyer {
  return {
    id: 'buyer-1', name: 'Synthetic Buyer Name', email: '', phone: '', source: 'owner-entered',
    status: 'ACTIVE', criteria, version: 1, verificationStatus: 'VERIFIED',
    approvalStatus: 'APPROVED', currentBuyingStatus: 'BUYING',
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
    criteriaEvidenceUrl: 'https://example.com/buyer-criteria',
    buyingEvidenceAt: now.toISOString(), validUntil: '2026-11-01T00:00:00Z',
    ...overrides,
  } as Buyer;
}

function discoveryRecord(): PropertyDiscovery {
  return {
    id: 'discovery-synthetic', marketKey: 'PHILADELPHIA_PA', status: 'RELEVANT_CANDIDATE',
    property: {
      id: 'property-synthetic', provider: 'Synthetic source', classification: 'OBSERVED',
      address: '123 Synthetic St', city: 'Philadelphia', county: 'Philadelphia', state: 'PA', zip: '19104',
      propertyType: 'SINGLE_FAMILY', sqft: 1000, beds: 3, baths: 2, recordedOwner: null,
      entityCandidate: false, assessedValue: 100000, lastSalePrice: 120000, lastSaleAt: null,
      interiorCondition: null, exteriorCondition: null, lat: null, lng: null,
      contactPaths: [], sourceUrl: 'https://example.com/property', capturedAt: now.toISOString(),
    },
    sourceObservations: [{
      id: 'observation-synthetic', sourceKey: 'SYNTHETIC', sourceId: 'synthetic-1',
      sourceName: 'Synthetic source', sourceUrl: 'https://example.com/property',
      firstObservedAt: now.toISOString(), lastObservedAt: now.toISOString(), seenCount: 1,
      state: 'CURRENT', recordCount: 1, recordIdentities: ['synthetic-1'], latestSourceEventAt: null,
      classification: 'OBSERVED', confidence: 1, evidenceRef: 'synthetic regression fixture', history: [],
    }],
    missingInformation: [], leadId: null,
  } as unknown as PropertyDiscovery;
}

test('known complete property and criteria produce strong criteria alignment only', () => {
  const result = matchSavedBuyersToProperty(property, [buyer()], now)[0]!;
  assert.equal(result.state, 'STRONG_MATCH');
  assert.ok(result.matched.some(item => item.includes('Type SINGLE_FAMILY')));
  assert.ok(!result.unknown.some(item => /funding|intent/i.test(item)));
});

test('missing core property facts produce incomplete alignment and unknown optional price', () => {
  const result = matchSavedBuyersToProperty({ ...property, sqft: null, askingPrice: null }, [buyer()], now)[0]!;
  assert.equal(result.state, 'INCOMPLETE_PROPERTY');
  assert.ok(result.unknown.some(item => item.includes('square footage')));
  assert.ok(result.unknown.some(item => item.includes('budget fit is unknown')));
});

test('known criteria conflicts produce no match with unmet reasons', () => {
  const result = matchSavedBuyersToProperty({ ...property, state: 'NJ', propertyType: 'CONDO' }, [buyer()], now)[0]!;
  assert.equal(result.state, 'NO_MATCH');
  assert.ok(result.unmet.some(item => item.includes('outside saved states')));
  assert.ok(result.unmet.some(item => item.includes('outside saved property types')));
});

test('absent or incomplete buyer criteria are not treated as a match', () => {
  assert.equal(matchSavedBuyersToProperty(property, [buyer({ criteria: null })], now)[0]?.state, 'MISSING_CRITERIA');
  assert.equal(matchSavedBuyersToProperty(property, [buyer({ criteria: { ...criteria, states: [] } })], now)[0]?.state, 'MISSING_CRITERIA');
});

test('stale buyer evidence blocks a strong label while preserving fit explanation', () => {
  const result = matchSavedBuyersToProperty(property, [buyer({ verificationStatus: 'STALE', approvalStatus: 'REVERIFICATION_REQUIRED' })], now)[0]!;
  assert.equal(result.state, 'STALE_BUYER');
  assert.ok(result.matched.length > 0);
  assert.ok(result.unknown.some(item => item.includes('stale')));
});

test('missing buyer evidence dates and references remain unknown, not current', () => {
  const result = matchSavedBuyersToProperty(property, [buyer({ criteriaEvidenceUrl: null, buyingEvidenceAt: null, validUntil: null })], now)[0]!;
  assert.equal(result.state, 'WEAK_MATCH');
  assert.ok(result.unknown.some(item => item.includes('criteria evidence reference is missing')));
  assert.ok(result.unknown.some(item => item.includes('validity date is missing')));
});

test('incomplete property identity facts remain an incomplete state', () => {
  const result = matchSavedBuyersToProperty({ ...property, state: null, propertyType: null }, [buyer()], now)[0]!;
  assert.equal(result.state, 'INCOMPLETE_PROPERTY');
  assert.ok(result.unknown.some(item => item.includes('Property state is missing')));
});

test('buyer-first and property-first evaluations have identical fit, unknowns, and criteria snapshots', () => {
  const buyerRecord = buyer();
  const propertyFirst = matchSavedBuyersToProperty({ ...property, askingPrice: null }, [buyerRecord], now)[0]!;
  const propertyWithProvenance = {
    ...property, askingPrice: null, address: '123 Synthetic St', assessedValue: 100000, lastSalePrice: 120000,
    provenanceUsed: ['Synthetic source · 2026-10-22T12:00:00.000Z · OBSERVED · https://example.com/property · ref synthetic regression fixture'],
  };
  const propertyFirstWithEvidence = matchSavedBuyersToProperty(propertyWithProvenance, [buyerRecord], now)[0]!;
  const buyerFirst = discoverBuyerPropertyCandidates(
    buyerRecord.criteria, [discoveryRecord()], now, { marketSupported: true, buyerContext: buyerRecord },
  ).candidates[0]!;

  assert.equal(propertyFirst.state, buyerFirst.state);
  assert.deepEqual(propertyFirst.matched, buyerFirst.matched);
  assert.deepEqual(propertyFirst.unmet, buyerFirst.missed);
  assert.deepEqual(propertyFirst.unknown, buyerFirst.missingFacts);
  assert.deepEqual(propertyFirstWithEvidence.criteriaUsed, buyerFirst.explanation.criteriaUsed);
  assert.deepEqual(propertyFirstWithEvidence.propertyFactsUsed, buyerFirst.explanation.propertyFactsUsed);
  assert.deepEqual(propertyFirstWithEvidence.provenanceUsed, buyerFirst.explanation.provenanceUsed);
  assert.equal(propertyFirstWithEvidence.buyer.version, buyerFirst.explanation.buyerVersion);
  assert.equal(propertyFirstWithEvidence.buyer.criteriaEvidenceUrl, buyerFirst.explanation.criteriaEvidenceUrl);

  // The matching explanation is computed from current inputs; this round-trip
  // checks serialized record-shaped data, not durable database persistence.
  const reloadedBuyer = JSON.parse(JSON.stringify(buyerRecord)) as Buyer;
  const reloadedProperty = JSON.parse(JSON.stringify(discoveryRecord())) as PropertyDiscovery;
  const reloadedFirst = matchSavedBuyersToProperty(propertyWithProvenance, [reloadedBuyer], now)[0]!;
  const reloadedSecond = discoverBuyerPropertyCandidates(
    reloadedBuyer.criteria, [reloadedProperty], now, { marketSupported: true, buyerContext: reloadedBuyer },
  ).candidates[0]!;
  assert.deepEqual(reloadedFirst.criteriaUsed, propertyFirst.criteriaUsed);
  assert.deepEqual(reloadedSecond.explanation.provenanceUsed, buyerFirst.explanation.provenanceUsed);
  assert.deepEqual(reloadedFirst.matched, reloadedSecond.matched);
});

test('criteria edits and stale buyer evidence affect both matching directions consistently', () => {
  const currentBuyer = buyer();
  const record = discoveryRecord();
  const changedBuyer = buyer({ criteria: { ...criteria, cities: ['Camden'], zipCodes: ['08002'] } });
  const propertyFirstChanged = matchSavedBuyersToProperty({ ...property, askingPrice: null }, [changedBuyer], now)[0]!;
  const buyerFirstChanged = discoverBuyerPropertyCandidates(
    changedBuyer.criteria, [record], now, { marketSupported: true, buyerContext: changedBuyer },
  ).candidates[0]!;
  assert.equal(propertyFirstChanged.state, buyerFirstChanged.state);
  assert.deepEqual(propertyFirstChanged.unmet, buyerFirstChanged.missed);
  assert.deepEqual(propertyFirstChanged.criteriaUsed, buyerFirstChanged.explanation.criteriaUsed);
  assert.equal(propertyFirstChanged.state, 'NO_MATCH');

  const staleBuyer = buyer({ verificationStatus: 'STALE', approvalStatus: 'REVERIFICATION_REQUIRED' });
  const propertyFirstStale = matchSavedBuyersToProperty({ ...property, askingPrice: null }, [staleBuyer], now)[0]!;
  const buyerFirstStale = discoverBuyerPropertyCandidates(
    staleBuyer.criteria, [record], now, { marketSupported: true, buyerContext: staleBuyer },
  ).candidates[0]!;
  assert.equal(propertyFirstStale.state, buyerFirstStale.state);
  assert.deepEqual(propertyFirstStale.unknown, buyerFirstStale.missingFacts);
  assert.equal(propertyFirstStale.state, 'STALE_BUYER');
  assert.ok(propertyFirstStale.unknown.some(item => item.includes('stale')));
  assert.ok(currentBuyer.criteria);
});
