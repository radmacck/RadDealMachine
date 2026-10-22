import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAccessFounderWorkspace,
  founderWorkspaceAreasForRole,
  FOUNDER_WORKSPACE_AREAS,
  FOUNDER_WORKSPACE_UNAVAILABLE,
  showWorkspaceNavigationItem,
} from './founder-workspace-navigation';

test('only approved internal workspace roles see the founder entry point', () => {
  assert.equal(canAccessFounderWorkspace('OWNER'), true);
  assert.equal(canAccessFounderWorkspace('ANALYST'), true);
  assert.equal(canAccessFounderWorkspace('OPERATOR'), true);
  assert.equal(canAccessFounderWorkspace('VIEWER'), false);
  assert.equal(canAccessFounderWorkspace('PENDING'), false);
  assert.equal(canAccessFounderWorkspace('UNKNOWN'), false);
  assert.equal(showWorkspaceNavigationItem('/workspace', 'OWNER'), true);
  assert.equal(showWorkspaceNavigationItem('/workspace', 'ANALYST'), true);
  assert.equal(showWorkspaceNavigationItem('/workspace', 'OPERATOR'), true);
  assert.equal(showWorkspaceNavigationItem('/workspace', 'VIEWER'), false);
  assert.equal(showWorkspaceNavigationItem('/workspace', 'PENDING'), false);
  assert.equal(showWorkspaceNavigationItem('/buyers', 'OWNER'), true);
  assert.equal(showWorkspaceNavigationItem('/buyers', 'ANALYST'), false);
  assert.equal(showWorkspaceNavigationItem('/buyers', 'OPERATOR'), false);
  assert.equal(showWorkspaceNavigationItem('/buyers', 'VIEWER'), false);
  assert.equal(showWorkspaceNavigationItem('/sources', 'VIEWER'), true,
    'The founder-only buyer filter must not unexpectedly alter other navigation visibility.');
});

test('workspace cards only link to existing property, buyer, matching, and deal routes', () => {
  assert.deepEqual(
    FOUNDER_WORKSPACE_AREAS.map(({ key, href }) => [key, href]),
    [
      ['properties', '/sources'],
      ['buyers', '/buyers'],
      ['matching', '/leads'],
      ['deal-tracking', '/deals'],
    ],
  );
  assert.deepEqual(founderWorkspaceAreasForRole('OWNER').map(({ key }) => key), [
    'properties', 'buyers', 'matching', 'deal-tracking',
  ]);
  assert.deepEqual(founderWorkspaceAreasForRole('ANALYST').map(({ key }) => key), [
    'properties', 'matching', 'deal-tracking',
  ]);
});

test('unavailable flows are labeled and do not expose links or provider actions', () => {
  assert.deepEqual(FOUNDER_WORKSPACE_UNAVAILABLE.map(({ key }) => key), [
    'seller-messaging',
    'real-authorization',
    'signature-delivery',
  ]);
  for (const item of FOUNDER_WORKSPACE_UNAVAILABLE) {
    assert.equal('href' in item, false);
    assert.match(item.description, /^Not (available|verified):/);
  }
});
