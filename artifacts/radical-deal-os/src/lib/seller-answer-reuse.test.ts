import test from 'node:test';
import assert from 'node:assert/strict';
import { reuseSellerAnswerDraft, sellerAnswersFromEvidence } from './seller-answer-reuse';

test('a prior call can seed a new editable answer draft without mutating its persisted source', () => {
  const prior = {
    occupancy: 'Seller says vacant',
    askingPrice: 175000,
    conditionByCategory: [{ category: 'ROOF' as const, statement: 'Seller reports a leak' }],
  };
  const draft = reuseSellerAnswerDraft(prior);
  draft.conditionsByCategory.ROOF = 'New call: seller says repaired';
  assert.equal(prior.conditionByCategory[0]?.statement, 'Seller reports a leak');
  assert.equal(draft.occupancy, 'Seller says vacant');
  assert.equal(draft.askingPrice, '175000');
  assert.equal(draft.conditionsByCategory.ROOF, 'New call: seller says repaired');
});

test('structured answers are reconstructed only from the latest seller-call evidence group', () => {
  const answers = sellerAnswersFromEvidence([
    { category: 'seller_call_occupancy', statement: 'Seller-reported occupancy: old statement', sourceType: 'SELLER', sourceRecordId: 'call:old', capturedAt: '2026-10-01T10:00:00Z' },
    { category: 'seller_call_occupancy', statement: 'Seller-reported occupancy: vacant', sourceType: 'SELLER', sourceRecordId: 'call:new', capturedAt: '2026-10-02T10:00:00Z' },
    { category: 'seller_call_condition_roof', statement: 'Seller reported roof condition: leak', sourceType: 'SELLER', sourceRecordId: 'call:new', capturedAt: '2026-10-02T10:00:00Z' },
    { category: 'seller_call_asking_price', statement: 'Seller stated an asking price of $175,000. This report has not been reconciled into underwriting.', sourceType: 'SELLER', sourceRecordId: 'call:new', capturedAt: '2026-10-02T10:00:00Z' },
    { category: 'seller_call_occupancy', statement: 'Not seller evidence', sourceType: 'MODEL', sourceRecordId: 'call:model', capturedAt: '2026-10-03T10:00:00Z' },
  ]);
  assert.equal(answers?.occupancy, 'vacant');
  assert.equal(answers?.askingPrice, 175000);
  assert.deepEqual(answers?.conditionByCategory, [{ category: 'ROOF', statement: 'leak' }]);
});
