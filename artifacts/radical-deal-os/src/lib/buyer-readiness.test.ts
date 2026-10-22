import test from 'node:test';
import assert from 'node:assert/strict';
import type { Buyer } from '@workspace/api-client-react';
import { buyerReadiness } from './buyer-readiness';

const base = {
  id: 'buyer-readiness-test',
  version: 1,
  name: 'Synthetic readiness test',
  email: '',
  phone: '',
  source: 'Owner-reviewed profile',
  status: 'ACTIVE',
  verificationStatus: 'UNVERIFIED',
  approvalStatus: 'DISCOVERED',
  currentBuyingStatus: 'UNKNOWN',
  qualificationBlockers: ['Identity/funding review is missing or stale.'],
} as unknown as Buyer;

test('absent evidence is labeled unverified and includes the missing evidence', () => {
  const state = buyerReadiness(base);
  assert.equal(state.label, 'Unverified · evidence missing');
  assert.match(state.detail, /missing or stale/);
});

test('stale evidence requires re-review instead of appearing verified', () => {
  const state = buyerReadiness({ ...base, verificationStatus: 'STALE', approvalStatus: 'REVERIFICATION_REQUIRED' });
  assert.equal(state.label, 'Evidence stale · re-review required');
  assert.equal(state.tone, 'warn');
});

test('contradictory or newer information blocks readiness and shows its reason', () => {
  const state = buyerReadiness({
    ...base,
    currentBuyingStatus: 'BUYING',
    qualificationBlockers: ['A newer actual outreach reply requires owner review of current buying/criteria evidence before matching or closing.'],
  });
  assert.equal(state.label, 'Conflicting information · blocked');
  assert.match(state.detail, /newer actual outreach reply/);
});

test('synthetic fixtures are excluded even when their verification fields look current', () => {
  const state = buyerReadiness({
    ...base,
    source: 'Owner-reviewed buyer profile',
    syntheticFixture: true,
    verificationStatus: 'VERIFIED',
    approvalStatus: 'APPROVED',
  } as Buyer & { syntheticFixture: boolean });
  assert.equal(state.label, 'Synthetic test data · excluded');
  assert.equal(state.tone, 'stop');
});

test('verified readiness describes current evidence without guaranteeing a closing', () => {
  const state = buyerReadiness({
    ...base,
    verificationStatus: 'VERIFIED',
    approvalStatus: 'APPROVED',
    qualificationBlockers: [],
  });
  assert.equal(state.label, 'Owner-reviewed evidence · current');
  assert.match(state.detail, /not a guarantee of closing/);
});

test('verified referral destinations are not presented as funded acquisition buyers', () => {
  const state = buyerReadiness({
    ...base,
    destinationKind: 'DEAL_FINDER',
    verificationStatus: 'VERIFIED',
    approvalStatus: 'APPROVED',
    qualificationBlockers: [],
  });
  assert.equal(state.label, 'Destination evidence current · not funding proof');
  assert.match(state.detail, /does not verify end-buyer funding/);
});

test('self-reported buying interest is not presented as independent verification', () => {
  const state = buyerReadiness({ ...base, currentBuyingStatus: 'BUYING' });
  assert.equal(state.label, 'Reported interest · not independently verified');
});
