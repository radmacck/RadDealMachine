import test from 'node:test';
import assert from 'node:assert/strict';
import type { Buyer, PropertyDiscovery } from '@workspace/api-client-react';
import { discoverBuyerPropertyCandidates } from './buyer-property-discovery';

const now = new Date('2026-10-22T12:00:00Z');
const criteria = {
  states: ['PA'], cities: ['Philadelphia'], zipCodes: ['19104'], propertyTypes: ['SINGLE_FAMILY'],
  maxPurchasePrice: 250000, maxRepairs: 50000, minBeds: 2, minSqft: 600, maxSqft: 1800, closingDays: 30,
} as Buyer['criteria'];

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: 'discovery-1', marketKey: 'PHILADELPHIA_PA', status: 'RELEVANT_CANDIDATE',
    property: { id: 'opa-1', provider: 'OPA', classification: 'OBSERVED', address: '123 Synthetic St',
      city: 'Philadelphia', county: 'Philadelphia', state: 'PA', zip: '19104', propertyType: 'SINGLE_FAMILY',
      sqft: 1000, beds: 3, baths: 2, recordedOwner: null, entityCandidate: false, assessedValue: 100000,
      lastSalePrice: 120000, lastSaleAt: '2024-01-01', interiorCondition: null, exteriorCondition: null,
      lat: null, lng: null, contactPaths: [], sourceUrl: 'https://example.com/parcel', capturedAt: now.toISOString() },
    sourceObservations: [{ id: 'obs-1', sourceKey: 'OPA', sourceId: 'OPA', sourceName: 'Synthetic source',
      sourceUrl: 'https://example.com/parcel', firstObservedAt: now.toISOString(), lastObservedAt: now.toISOString(),
      seenCount: 1, state: 'CURRENT', recordCount: 1, recordIdentities: ['OPA-1'], latestSourceEventAt: null,
      classification: 'OBSERVED', confidence: 0.9, evidenceRef: 'Synthetic exercise', history: [] }],
    missingInformation: [], leadId: null,
    ...overrides,
  } as unknown as PropertyDiscovery;
}

test('source-backed property with matching known facts is only a potential match', () => {
  const result = discoverBuyerPropertyCandidates(criteria, [record()], now, { marketSupported: true });
  assert.equal(result.state, 'MATCHES');
  assert.equal(result.candidates[0]?.state, 'WEAK_MATCH');
  assert.ok(result.candidates[0]?.matched.some(item => item.includes('City/ZIP')));
  assert.ok(result.candidates[0]?.missingFacts.some(item => item.includes('asking/acquisition price')));
  assert.ok(result.candidates[0]?.explanation.criteriaUsed.some(item => item.includes('Purchase price: 0–250000')));
  assert.ok(result.candidates[0]?.explanation.propertyFactsUsed.some(item => item.includes('Beds: 3')));
  assert.ok(result.candidates[0]?.explanation.provenanceUsed.some(item => item.includes('Synthetic source')));
  assert.match(result.note, /not a suitability, profitability, or availability guarantee/i);
});

test('known criteria mismatch returns an explicit no-match state', () => {
  const item = record({ property: { ...record().property, state: 'NJ' } });
  const result = discoverBuyerPropertyCandidates(criteria, [item], now, { marketSupported: true });
  assert.equal(result.state, 'NO_MATCH');
  assert.ok(result.candidates[0]?.missed.some(reason => reason.includes('State NJ is outside saved states')));
});

test('stale or undated source observations cannot produce a potential match', () => {
  const stale = record({ sourceObservations: [{ ...record().sourceObservations[0], lastObservedAt: '2026-09-01T00:00:00Z' }] });
  const result = discoverBuyerPropertyCandidates(criteria, [stale], now, { marketSupported: true });
  assert.equal(result.candidates[0]?.state, 'STALE_SOURCE');
  const absent = record({ sourceObservations: [] });
  assert.equal(discoverBuyerPropertyCandidates(criteria, [absent], now, { marketSupported: true }).candidates[0]?.state, 'UNAVAILABLE');
});

test('incomplete property facts stay visible as incomplete and never count as a confirmed match', () => {
  const incomplete = record({ property: { ...record().property, beds: null, sqft: null } });
  const result = discoverBuyerPropertyCandidates(criteria, [incomplete], now, { marketSupported: true });
  assert.equal(result.candidates[0]?.state, 'INCOMPLETE_PROPERTY');
  assert.ok(result.candidates[0]?.missingFacts.some(item => /bedroom count is unknown/i.test(item)));
  assert.ok(result.candidates[0]?.explanation.propertyFactsUsed.some(item => item === 'Beds: unknown'));
});

test('criteria changes alter the explanation and the evaluated result', () => {
  const candidate = record();
  const before = discoverBuyerPropertyCandidates(criteria, [candidate], now, { marketSupported: true }).candidates[0]!;
  const changedCriteria = { ...criteria, cities: ['Camden'], zipCodes: ['08002'] };
  const after = discoverBuyerPropertyCandidates(changedCriteria, [candidate], now, { marketSupported: true }).candidates[0]!;
  assert.equal(before.state, 'WEAK_MATCH');
  assert.equal(after.state, 'NO_MATCH');
  assert.notDeepEqual(before.explanation.criteriaUsed, after.explanation.criteriaUsed);
  assert.ok(after.missed.some(reason => reason.includes('outside saved markets')));
});

test('identical inputs produce repeatable, ordered explanations', () => {
  const candidate = record({ sourceObservations: [
    { ...record().sourceObservations[0], sourceName: 'Z Source', sourceUrl: 'https://example.com/z' },
    { ...record().sourceObservations[0], id: 'obs-2', sourceName: 'A Source', sourceUrl: 'https://example.com/a' },
  ] });
  const first = discoverBuyerPropertyCandidates(criteria, [candidate], now, { marketSupported: true }).candidates[0]!;
  const second = discoverBuyerPropertyCandidates(criteria, [candidate], now, { marketSupported: true }).candidates[0]!;
  assert.deepEqual(first.explanation, second.explanation);
  assert.match(first.explanation.provenanceUsed[0]!, /^A Source/);
});

test('missing criteria, unsupported market, and partial pool are not reported as complete no-match', () => {
  assert.equal(discoverBuyerPropertyCandidates(null, [record()], now).state, 'MISSING_CRITERIA');
  assert.equal(discoverBuyerPropertyCandidates(criteria, [], now, { marketSupported: false }).state, 'UNAVAILABLE');
  assert.equal(discoverBuyerPropertyCandidates(criteria, [], now, { marketSupported: true, hasMore: true }).state, 'PARTIAL_POOL');
  assert.equal(discoverBuyerPropertyCandidates(criteria, [], now, { marketSupported: true, marketPartial: true }).state, 'PARTIAL_POOL');
});
