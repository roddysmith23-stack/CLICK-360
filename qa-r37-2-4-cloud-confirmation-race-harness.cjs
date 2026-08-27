const fs = require('node:fs');
const assert = require('node:assert/strict');

const app = fs.readFileSync('app.js', 'utf8');
const firebase = fs.readFileSync('firebase-service.js', 'utf8');

const commitStart = app.indexOf('async function commitCriticalMutation');
const commitEnd = app.indexOf('// Action Guardian:', commitStart);
const commit = app.slice(commitStart, commitEnd);
assert(commitStart >= 0 && commitEnd > commitStart, 'critical mutation implementation must be present');
assert(!commit.includes("if (synced) return { ok: true, pending: false };"), 'scheduler success alone must not confirm a critical mutation');
assert(commit.includes("synced && typeof remoteApplied !== 'function'"), 'non-material critical calls may retain the existing fast path');
assert(commit.includes('readbackConfirmed: true'), 'material critical calls must identify server-readback confirmation');
assert(commit.indexOf('window.click360RefreshNow') < commit.indexOf('readbackConfirmed: true'), 'server readback must happen before material success');

const schedulerStart = firebase.indexOf("async function pushLocalToFirestore(reason = 'auto'");
const schedulerEnd = firebase.indexOf('async function pullRemoteOnce', schedulerStart);
const scheduler = firebase.slice(schedulerStart, schedulerEnd);
assert(schedulerStart >= 0 && schedulerEnd > schedulerStart, 'legacy owner scheduler must be present');
assert(scheduler.includes('})().finally(() => {'), 'scheduler cleanup must be chained to the registered promise');
assert(scheduler.includes('PUSH_SCHEDULERS.get(schedulerKey) === scheduler'), 'cleanup must only remove its own tenant scheduler');
assert(!scheduler.includes('try { return await scheduler.promise; }'), 'no fulfilled inner promise may remain registered during outer cleanup');

async function simulateCriticalCommit({ syncResult, remoteAfter }) {
  const synced = await Promise.resolve(syncResult);
  if (synced && typeof remoteAfter !== 'function') return { ok: true };
  const state = await remoteAfter();
  if (state.expected === true) return { ok: true, readbackConfirmed: true };
  return { ok: false };
}

(async () => {
  const staleSchedulerSuccess = await simulateCriticalCommit({
    syncResult: true,
    remoteAfter: async () => ({ expected: false }),
  });
  assert.equal(staleSchedulerSuccess.ok, false, 'an older scheduler success cannot confirm absent remote material');

  const confirmed = await simulateCriticalCommit({
    syncResult: true,
    remoteAfter: async () => ({ expected: true }),
  });
  assert.deepEqual(confirmed, { ok: true, readbackConfirmed: true });
  console.log('CLICK 360 r37.2.4 cloud confirmation race harness PASS.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
