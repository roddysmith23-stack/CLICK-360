import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, webkit, firefox } from 'playwright';
const source = await readFile('modular-operation-journal.js', 'utf8');
for (const [name, engine] of Object.entries({ chromium, webkit, firefox })) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('https://journal.example.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic journal only</title>' }));
    await page.goto('https://journal.example.test/');
    await page.addScriptTag({ content: source });
    const upgrade=await page.evaluate(async()=>{
      const oldRow={key:'old-owner:old-business:old-op',ownerUid:'old-owner',businessId:'old-business',operationId:'old-op',state:'unknown',revision:9,payload:{total:30},payloadHash:'preserve-exact-hash',createdAt:1};
      await new Promise((resolve,reject)=>{
        const request=indexedDB.open('synthetic-v1-upgrade',1);
        request.onupgradeneeded=()=>request.result.createObjectStore('operations',{keyPath:'key'});
        request.onsuccess=()=>{const db=request.result;const tx=db.transaction('operations','readwrite');tx.objectStore('operations').put(oldRow);tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>reject(tx.error);};
        request.onerror=()=>reject(request.error);
      });
      const journal=await CLICK360_MODULAR_JOURNAL.open({databaseName:'synthetic-v1-upgrade'});
      const identity={ownerUid:'old-owner',businessId:'old-business'};
      const row=await journal.get(identity,'old-op');const pending=await journal.listPending(identity);
      journal.close();return {row,pending};
    });
    assert.equal(upgrade.row.payloadHash,'preserve-exact-hash');assert.equal(upgrade.row.revision,9);
    assert.equal(upgrade.row.state,'unknown');assert.equal(upgrade.pending.length,1);
    const first = await page.evaluate(async () => {
      const journal = await CLICK360_MODULAR_JOURNAL.open();
      const a = { ownerUid: 'owner-a', businessId: 'business-a' };
      const b = { ownerUid: 'owner-a', businessId: 'business-b' };
      const payload = { type: 'sale', items: [{ id: 'p', qty: 1 }], total: 30 };
      const row = await journal.enqueue(a, 'op-sale', payload);
      payload.total = 999; // Caller changes cannot alter the durable request.
      const duplicate = await journal.enqueue(a, 'op-sale', row.payload);
      const rejects = async task => { try { await task(); return false; } catch { return true; } };
      const conflict = await rejects(() => journal.enqueue(a, 'op-sale', payload));
      const typedDenied = await rejects(() => journal.enqueue(a, 'bad-types', { timestamp: new Date() }));
      const scoped = await journal.enqueue({ ...a, key: 'owner-a:business-b:poison', state: 'confirmed' }, 'safe-key', { type: 'cash_open' });
      const scopePinned = scoped.key === 'owner-a:business-a:safe-key' && scoped.state === 'queued';
      const race = await Promise.allSettled([journal.claim(a, 'op-sale', 'device-a'), journal.claim(a, 'op-sale', 'device-b')]);
      const inflight = await journal.get(a, 'op-sale');
      await journal.markUnknown(a, 'op-sale', inflight.revision);
      const unknown = await journal.get(a, 'op-sale');
      const retryDenied = await rejects(() => journal.claim(a, 'op-sale', 'device-b'));
      const cachedDenied = await rejects(() => journal.reconcile(a, 'op-sale', unknown.revision, { source: 'cache', exists: false }));
      const otherBusiness = await journal.get(b, 'op-sale');
      await journal.enqueue(b, 'op-sale', { type: 'cash_close', cashSessionId: 's' });
      const pending=await journal.listPending(a,25);
      if(pending.some(row=>row.businessId!==a.businessId)||pending.length!==2)throw Error('PENDING_QUERY_TENANT_ISOLATION');
      journal.close();
      return { hash: row.payloadHash, duplicateRevision: duplicate.revision, conflict, winners: race.filter(r => r.status === 'fulfilled').length,
        retryDenied, cachedDenied, typedDenied, scopePinned, isolated: !otherBusiness };
    });
    assert.equal(first.duplicateRevision, 1);
    for (const k of ['conflict', 'retryDenied', 'cachedDenied', 'typedDenied', 'scopePinned', 'isolated']) assert.equal(first[k], true, k);
    assert.equal(first.winners, 1);
    await page.reload();
    await page.addScriptTag({ content: source });
    const after = await page.evaluate(async () => {
      const journal = await CLICK360_MODULAR_JOURNAL.open();
      const a = { ownerUid: 'owner-a', businessId: 'business-a' };
      const row = await journal.get(a, 'op-sale');
      let mismatchDenied = false;
      try { await journal.reconcile(a, 'op-sale', row.revision, { source: 'server', exists: true,
        record: { ...a, operationId: 'op-sale', payloadHash: 'different' } }); } catch { mismatchDenied = true; }
      const confirmed = await journal.reconcile(a, 'op-sale', row.revision, { source: 'server', exists: true,
        record: { ...a, operationId: 'op-sale', payloadHash: row.payloadHash } });
      let replayDenied = false;
      try { await journal.claim(a, 'op-sale', 'device-c'); } catch { replayDenied = true; }
      await journal.enqueue(a, 'op-open', { type: 'cash_open' });
      const leased = await journal.claim(a, 'op-open', 'device-a', 1);
      const expired = await journal.claim(a, 'op-open', 'device-b', 60002);
      const ready = await journal.reconcile(a, 'op-open', expired.revision, { source: 'server', exists: false });
      journal.close();
      return { restored: row.state, total: row.payload.total, mismatchDenied, confirmed: confirmed.state, replayDenied,
        attempts: leased.attempts, expired: expired.state, ready: ready.state };
    });
    assert.deepEqual(after, { restored: 'unknown', total: 30, mismatchDenied: true, confirmed: 'confirmed', replayDenied: true,
      attempts: 1, expired: 'unknown', ready: 'queued' });
    await context.close();
    console.log(`PASS ${name} native IndexedDB modular journal: cold restart, duplicate, claim race, tenant isolation, uncertain response, authoritative reconciliation`);
  } finally { await browser.close(); }
}

