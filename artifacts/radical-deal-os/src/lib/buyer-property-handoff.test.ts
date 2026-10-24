import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buyerPropertyDiscoveryListLimit,
  buyerPropertyHandoffHref,
  propertyDiscoveryElementId,
  propertyBuyerProfileHref,
  scrollPropertyDiscoveryIntoView,
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

test('selected buyer-first source review targets the matching discovery card', () => {
  assert.equal(propertyDiscoveryElementId('discovery-1'), 'property-discovery-discovery-1');
});

test('selected source review smoothly scrolls the matching card into view', () => {
  let receivedId = '';
  let receivedOptions: ScrollIntoViewOptions | undefined;
  const found = scrollPropertyDiscoveryIntoView('discovery-1', (id) => {
    receivedId = id;
    return { scrollIntoView: options => { receivedOptions = options; } };
  });
  assert.equal(found, true);
  assert.equal(receivedId, 'property-discovery-discovery-1');
  assert.deepEqual(receivedOptions, { behavior: 'smooth', block: 'center' });
  assert.equal(scrollPropertyDiscoveryIntoView('missing', () => null), false);
});
