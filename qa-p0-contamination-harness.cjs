const assert = require('assert');

(async () => {
  const core = await import('./scripts/lib/click360-data-core.mjs');
  const fixture = await import('node:fs/promises').then((fs) => fs.readFile('./fixtures/firebase-audit-fixture.json', 'utf8')).then(JSON.parse);
  const categories = fixture.tenants.map((tenant) => core.classifyTenant(tenant, fixture.approvedUsers).category);
  assert(categories.includes('CLEAN_V10'), 'clean v10 classified');
  assert(categories.includes('LEGACY_CLEAR_OWNER'), 'clear legacy classified');
  assert(categories.includes('CROSS_TENANT_SUSPECT'), 'foreign writer classified');
  assert(categories.includes('ORPHANED'), 'orphan classified');
  console.log('PASS P0 contamination classification fixture');
})();
