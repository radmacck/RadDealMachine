import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeContactResearchEvidenceReference } from './contact-research-evidence';

test('contact research requires a precise evidence reference and preserves its trimmed value', () => {
  assert.equal(normalizeContactResearchEvidenceReference(''), null);
  assert.equal(normalizeContactResearchEvidenceReference('   '), null);
  assert.equal(normalizeContactResearchEvidenceReference('ab'), null);
  assert.equal(normalizeContactResearchEvidenceReference('  parcel-page-42  '), 'parcel-page-42');
});
