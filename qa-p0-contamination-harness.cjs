const assert = require('assert');

(async () => {
  const core = await import('./scripts/lib/click360-data-core.mjs');
  const fixture = await import('node:fs/promises').then((fs) => fs.readFile('./fixtures/firebase-audit-fixture.json', 'utf8')).then(JSON.parse);
  const categories = fixture.tenants.map((tenant) => core.classifyTenant(tenant, fixture.approvedUsers, fixture.authUsers || []).category);
  assert(categories.includes('CLEAN_V10'), 'clean v10 classified');
  assert(categories.includes('LEGACY_CLEAR_OWNER'), 'clear legacy classified');
  assert(categories.includes('CROSS_TENANT_SUSPECT'), 'foreign writer classified');
  assert(categories.includes('ORPHANED'), 'orphan classified');
  const staleProfileLegacy = {
    pathBusinessId: 'owner-b', businessId: 'owner-b', updatedBy: 'owner-b', updatedByEmail: 'actual@example.test',
    localStorage: { click360_mvp_qa_final_state_v1: '{"businesses":[],"products":[],"sales":[],"movements":[],"invoices":[],"dailyReports":[],"settings":{"workers":[],"labelTemplates":[]}}' }
  };
  const staleProfileOwner = [{ uid: 'owner-b', email: 'historical@example.test' }];
  const staleProfileAuth = [{ uid: 'owner-b', email: 'actual@example.test' }];
  const staleResult = core.classifyTenant(staleProfileLegacy, staleProfileOwner, staleProfileAuth);
  assert.strictEqual(staleResult.category, 'LEGACY_CLEAR_OWNER', 'Auth UID/email takes priority over stale profile email');
  assert(staleResult.observations.includes('approved_user_email_stale'), 'stale profile email is retained as an observation');
  console.log('PASS P0 contamination classification fixture');
})();
