import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium, firefox, webkit, devices } from 'playwright';

const app = await readFile('app.js', 'utf8');
const save = app.slice(app.indexOf('  function save(options'), app.indexOf('  function restoreCriticalSnapshot'));
const storage = await readFile('v16-storage.js', 'utf8');
const server = createServer((_, response) => response.end('<!doctype html><title>Synthetic capacity QA</title>'));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
try {
  for (const [name, engine, options] of [
    ['iPhone WebKit', webkit, devices['iPhone 15']],
    ['Android Chromium', chromium, devices['Pixel 7']],
    ['desktop Chromium', chromium, {}], ['desktop Firefox', firefox, {}]
  ]) {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext(options);
      const page = await context.newPage();
      await page.goto(url);
      await page.addScriptTag({ content:storage });
      for (const bytes of [900000, 1200000, 3000000, 7000000]) {
        const result = await page.evaluate(async ({ save, bytes }) => {
          const ctx = { authUid:'synthetic-owner', ownerId:'synthetic-owner', businessId:`b-${bytes}`, tenantKey:`synthetic:${bytes}` };
          await window.CLICK360_V16_STORAGE.probe();
          const parameters = {
            state:{ products:[{id:'p',stock:2,qty:2}], padding:'x'.repeat(bytes) }, lastPersistedState:{products:[{id:'p',stock:3,qty:3}]},
            activeTenantContext:ctx, lastSavePersistence:null, indexedTenantCacheMeta:null, deviceSavePending:false,
            MAX_LOCAL_TENANT_STATE_BYTES:850000, MAX_LOCAL_ONLY_TENANT_STATE_BYTES:8*1024*1024,
            storageState:{indexedDbReady:true,mode:'indexeddb_cache'}, lastWriteBlock:null, lastSaveFailure:null,
            cloneState:structuredClone, stateStorageKey:()=>`synthetic-${bytes}`, writeGateStatus:()=>({allowed:true}),
            publishSaveFailure(){}, isOwnerUser:()=>true, tenantIdentity:()=>ctx,
            stateSizeBytes:v=>new TextEncoder().encode(typeof v==='string'?v:JSON.stringify(v)).length,
            localOnlyPersistenceMode:()=>false, writeCacheMeta(){}, publishStorageState(){}, uid:()=>`op-${bytes}`,
            rememberPersistedState(){}, dispatchLocalStateSaved(){}, toast(){},
            queueIndexedSnapshot:async (snapshot,metadata)=>{ await window.CLICK360_V16_STORAGE.putSnapshot(ctx,snapshot,metadata); return true; }
          };
          const run = new Function(...Object.keys(parameters), `${save};
            const ok=save({deferSync:true}); return {ok, persistence:lastSavePersistence, getState:()=>state};`);
          const outcome = run(...Object.values(parameters));
          const durable = await outcome.persistence.indexedPromise;
          const record = await window.CLICK360_V16_STORAGE.getSnapshot(ctx);
          return { ok:outcome.ok,durable, cloudCapacityBlocked:record.cloudCapacityBlocked,
            pendingOperations:record.pendingOperations.length, deviceRevision:record.deviceRevision, stock:record.snapshot.products[0].stock,
            ctx };
        }, { save, bytes });
        assert.equal(result.ok, true);
        assert.equal(result.durable, true);
        assert.equal(result.cloudCapacityBlocked, true);
        assert.equal(result.pendingOperations, 1);
        assert.equal(result.stock, 2);
        // Cold page restart, no LS snapshot: recover solely from real IndexedDB.
        await page.reload();
        await page.addScriptTag({ content:storage });
        const restart = await page.evaluate(async ctx => {
          const api=window.CLICK360_V16_STORAGE;
          const record=await api.getSnapshot(ctx);
          let fenced=false;
          try { await api.putSnapshot(ctx,{products:[]},{source:'cloud_confirmed'}); } catch { fenced=true; }
          let raced=false;
          try { await api.putSnapshot(ctx,record.snapshot,{cloudCapacityBlocked:true,expectedDeviceRevision:'stale',deviceRevision:'other-tab'}); } catch { raced=true; }
          const after=await api.getSnapshot(ctx);
          return {fenced,raced, stock:after.snapshot.products[0].stock,pending:after.pendingOperations.length};
        },result.ctx);
        assert.deepEqual(restart,{fenced:true,raced:true,stock:2,pending:1});
      }
      console.log(`PASS ${name}: actual save + native IDB 900KB/1.2MB/3MB/7MB, cold restart, stale-tab CAS, cloud-mirror fence`);
    } finally { await browser.close(); }
  }
} finally { await new Promise(resolve=>server.close(resolve)); }
