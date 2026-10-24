import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buyerPropertyDiscoveryListLimit,
  buyerPropertyHandoffHref,
  propertyBuyerProfileHref,
} from './buyer-property-handoff';

test('unpromoted buyer-first candidate opens its existing source qualification review', () => {
  assert.equal(
    buyerPropertyHandoffHref({ id: 'discovery / 1', leadId: null }),
    '/sources?discovery=discovery%20%2F%201',
  );
});

test('already-promoted candidate opens its canonical existing deal', () => {
  assert.equal(
    buyerPropertyHandoffHref({ id: 'discovery-1', leadId: 'lead/one' }),
    '/deals/lead%2Fone',
  );
});

test('opening a selected discovery loads the same bounded pool used by buyer-first search', () => {
  assert.equal(buyerPropertyDiscoveryListLimit(undefined, 25), 25);
  assert.equal(buyerPropertyDiscoveryListLimit('discovery-1', 25), 100);
});

test('property-first matching opens the existing buyer profile with an encoded ID', () => {
  assert.equal(propertyBuyerProfileHref('buyer / 1'), '/buyers/buyer%20%2F%201');
});
