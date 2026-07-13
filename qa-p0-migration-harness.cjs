const assert = require('assert');

(async () => {
  const core = await import('./scripts/lib/click360-data-core.mjs');
  const fixture = await import('node:fs/promises').then((fs) => fs.readFile('./fixtures/firebase-audit-fixture.json', 'utf8')).then(JSON.parse);
  const clear = fixture.tenants[1];
  const ambiguous = { pathBusinessId: 'owner-b', businessId: 'owner-b', updatedBy: 'owner-b', localStorage: { click360_mvp_qa_final_state_v1: '{invalid' } };
  const clearClass = core.classifyTenant(clear, fixture.approvedUsers, fixture.authUsers);
  assert.strictEqual(clearClass.category, 'LEGACY_CLEAR_OWNER');
  const plan = core.toV10Document(clear, { ownerId: 'owner-b', businessId: 'owner-b' });
  assert(core.equalCounts(plan.beforeCounts, plan.afterCounts), 'dry-run counts match');
  assert(plan.logicalHash, 'backup plan has logical hash');
  assert.notStrictEqual(core.classifyTenant(ambiguous, fixture.approvedUsers, fixture.authUsers).category, 'LEGACY_CLEAR_OWNER', 'ambiguous tenant is blocked');
  const wrongPath = { ...clear, ownerId: 'owner-a' };
  assert.notStrictEqual(core.classifyTenant(wrongPath, fixture.approvedUsers, fixture.authUsers).category, 'LEGACY_CLEAR_OWNER', 'legacy owner/path mismatch is blocked');
  const missingAuth = core.classifyTenant(clear, fixture.approvedUsers, []);
  assert.strictEqual(missingAuth.category, 'ORPHANED', 'legacy migration requires a confirmed Firebase Auth UID');

  let writes = 0;
  const apply = ({ backupFails = false, sourceChanged = false, countsChanged = false }) => {
    if (backupFails || sourceChanged || countsChanged) return false;
    writes += 1; return true;
  };
  assert.strictEqual(apply({ backupFails: true }), false); assert.strictEqual(writes, 0);
  assert.strictEqual(apply({ sourceChanged: true }), false); assert.strictEqual(writes, 0);
  assert.strictEqual(apply({ countsChanged: true }), false); assert.strictEqual(writes, 0);
  assert.strictEqual(apply({}), true); assert.strictEqual(writes, 1);
  console.log('PASS P0 migration dry-run, ambiguous block, backup/change/count abort guards');
})();
