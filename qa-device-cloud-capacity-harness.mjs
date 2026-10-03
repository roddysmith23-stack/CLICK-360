import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// Execute the deployed save implementation, not a reimplementation of its guard.
const app = await readFile('app.js', 'utf8');
const saveSource = app.slice(app.indexOf('  function save(options'), app.indexOf('  function restoreCriticalSnapshot'));
const criticalSource = app.slice(app.indexOf('  async function commitCriticalMutation('),app.indexOf('  // Action Guardian:'));
for (const size of [840000, 860000, 900000, 1200000, 3000000, 7000000, 8 * 1024 * 1024 + 1000]) {
  const before = { products: [], updatedAtMs: 1 };
  const context = { authUid: 'owner', ownerId: 'owner', businessId: 'alpha', tenantKey: 'owner:alpha' };
  const sandbox = {
    state: { ...before, padding: 'x'.repeat(size - 300) }, lastPersistedState: structuredClone(before), activeTenantContext: context,
    lastSavePersistence: null, indexedTenantCacheMeta: null, deviceSavePending: false,
    MAX_LOCAL_TENANT_STATE_BYTES: 850000, MAX_LOCAL_ONLY_TENANT_STATE_BYTES: 8 * 1024 * 1024,
    storageState: { indexedDbReady: true, mode: 'indexeddb_cache' }, navigator: { onLine: true },
    window: { click360DebugSyncIdentity: () => ({ revision: 42 }) }, localStorage: { setItem() {} },
    stateStorageKey: () => 'owner:alpha', writeGateStatus: () => ({ allowed: true }),
    publishSaveFailure() {}, lastWriteBlock: null, lastSaveFailure: null,
    cloneState: structuredClone, isOwnerUser: () => true, tenantIdentity: () => context,
    stateSizeBytes: value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value)),
    localOnlyPersistenceMode: () => false, writeCacheMeta() {}, publishStorageState() {},
    uid: () => 'op', rememberPersistedState() {}, dispatchLocalStateSaved() {}, toast() {},
    queueIndexedSnapshot: async () => true, console: { error() {}, warn() {} },
    onlineOnlyCommitCheckpoints: new Map(), commitCheckpointKey: () => 'op'
  };
  vm.createContext(sandbox);
  vm.runInContext(saveSource + '\nresult = save({deferSync:true});', sandbox);
  const expected = size <= 8 * 1024 * 1024;
  assert.equal(sandbox.result, expected, `${size} bytes: device guard must be independent from cloud guard`);
  if (expected && size > 850000) {
    assert.equal(sandbox.lastSavePersistence.cloudCapacityBlocked, true);
    assert.equal(await sandbox.lastSavePersistence.indexedPromise, true);
  }
  if (!expected) assert.equal(sandbox.state.padding, undefined, 'oversize rejected without damaging prior state');
  if (expected && size > 850000) {
    for (const online of [false,true]) {
      sandbox.state = { ...before,padding:'x'.repeat(size - 300) };
      sandbox.navigator.onLine=online;
      sandbox.window.click360SyncNow = () => {throw Error('OVERSIZED_CLOUD_PUSH_FORBIDDEN');};
      sandbox.window.click360RefreshNow = () => {throw Error('PENDING_REMOTE_HYDRATION_FORBIDDEN');};
      sandbox.acquireCriticalAction=()=>({acquired:true,release(){}});
      sandbox.lastAutoSaveHash='';
      sandbox.restoreCriticalSnapshot=()=>{throw Error('DURABLE_CAPACITY_ROLLBACK_FORBIDDEN');};
      vm.runInContext(criticalSource+'\ncriticalResult=commitCriticalMutation(lastPersistedState,"sale",()=>false);',sandbox);
      const critical = await sandbox.criticalResult;
      assert.equal(critical.ok,true);
      assert.equal(critical.pending,true);
      assert.equal(critical.cloudCapacityBlocked,true);
    }
    sandbox.state={...before,padding:'x'.repeat(size - 300)};
    sandbox.navigator.onLine=true;
    sandbox.queueIndexedSnapshot=async()=>false;
    vm.runInContext('failed=commitCriticalMutation(lastPersistedState,"sale",()=>false);',sandbox);
    assert.equal((await sandbox.failed).ok,false,'no durable commit means no critical success');
    assert.equal(sandbox.state.padding,undefined,'IDB failure preserves preceding state');
    sandbox.storageState.indexedDbReady=false;
    sandbox.state={...before,padding:'x'.repeat(size - 300)};
    vm.runInContext('unavailable=save();',sandbox);
    assert.equal(sandbox.unavailable,false,'no cloud fallback when device storage unavailable');
  }
}
console.log('PASS actual save(): 840KB, 860KB, 900KB, 1.2MB, 3MB, 7MB and safe rejection above 8MiB');
