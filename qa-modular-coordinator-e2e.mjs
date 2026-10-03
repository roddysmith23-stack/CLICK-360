import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, webkit, firefox } from 'playwright';
const harness = await readFile('qa-modular-persistence-v2-harness.cjs', 'utf8');
const fakeDb = harness.slice(harness.indexOf('function clone('), harness.indexOf('function baseRecord('));
const sources = await Promise.all(['modular-persistence.js', 'modular-operation-journal.js', 'modular-operation-coordinator.js'].map(f => readFile(f, 'utf8')));
for (const [name, engine] of Object.entries({ chromium, webkit, firefox })) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('https://coordinator.example.test/**', route => route.fulfill({ contentType:'text/html', body:'<!doctype html><title>Synthetic coordinator</title>' }));
    await page.goto('https://coordinator.example.test/');
    for (const source of [...sources, fakeDb]) await page.addScriptTag({ content:source });
    const result = await page.evaluate(async () => {
      const api = CLICK360_MODULAR_PERSISTENCE;
      const identity = api.identity('synthetic-owner', 'alpha');
      const paths = api.paths(identity.ownerUid, identity.businessId);
      const seed = {
        [paths.featureFlag]:{ enabled:true, writeMode:'modular', schemaVersion:2, businessIds:['alpha'] },
        [paths.root]:{ ...identity, status:'CUTOVER_VERIFIED', legacyWriteFence:api.LEGACY_WRITE_FENCE },
        [paths.record('products','p')]:{ ...identity, stock:10, qty:10, recordVersion:1 },
        [paths.record('cashSessions','cash')]:{ ...identity, status:'open', date:'2026-09-03', recordVersion:1 },
        [paths.legacyState]:{ revision:12, sentinel:'KEEP' }
      };
      const db = createDb(seed);
      const repository = api.createFirestoreRepository({ db, firebase:{ firestore:{ FieldValue:{ serverTimestamp:()=> 'SERVER_TIMESTAMP' } } },
        user:{ uid:identity.ownerUid }, ownerUid:identity.ownerUid, businessId:identity.businessId, projectId:'demo-click360-coordinator' });
      let offline = false, loseReply = false, sends = 0;
      const transport = { ...repository,
        lookupOperation:(...args) => { if (offline) throw Error('OFFLINE'); return repository.lookupOperation(...args); },
        commitSale:async input => { sends++; const response = await repository.commitSale(input); if (loseReply) throw Error('RESPONSE_LOST'); return response; }
      };
      const sale = (operationId, stock, version) => ({ operationId,
        sale:{ date:'2026-09-03', cashSessionId:'cash', total:30, items:[{ productId:'p', qty:1, price:30 }] },
        movement:{ date:'2026-09-03', cashSessionId:'cash', amount:30, kind:'ingreso' },
        productChanges:[{ productId:'p', quantity:1, expectedStock:stock, expectedRecordVersion:version }] });
      let journal = await CLICK360_MODULAR_JOURNAL.open();
      let coordinator = CLICK360_MODULAR_COORDINATOR.create({ journal, repository:transport, deviceId:'device-a' });
      const queued = await coordinator.enqueue('sale', sale('sale-1',10,1));
      const prepared = await repository.prepareOperation('sale', sale('sale-1',10,1));
      const hashMatches = queued.payloadHash === prepared.payloadSha256;
      await Promise.all([coordinator.process('sale-1'), coordinator.process('sale-1')]);
      const first = await coordinator.process('sale-1');
      offline = true;
      await coordinator.enqueue('sale', sale('sale-2',9,2));
      const pending = await coordinator.process('sale-2');
      journal.close();
      journal = await CLICK360_MODULAR_JOURNAL.open();
      coordinator = CLICK360_MODULAR_COORDINATOR.create({ journal, repository:transport, deviceId:'device-b' });
      const preserved = await journal.get(identity,'sale-2');
      offline = false; loseReply = true;
      const recovered = await coordinator.process('sale-2');
      const afterLost = sends;
      await coordinator.process('sale-2');
      const noResend = sends === afterLost;
      await coordinator.enqueue('cash_close', { operationId:'close-1', cashSessionId:'cash',
        report:{ date:'2026-09-03', saleIds:['sale-1','sale-2'], total:60 } });
      const closed = await coordinator.process('close-1');
      await coordinator.process('close-1');
      const count = module => [...db.store.keys()].filter(k => k.startsWith(paths.collection(module)+'/')).length;
      const output = { hashMatches, first:first.status, pending:pending.status, preserved:preserved.state,
        recovered:recovered.status, noResend, closed:closed.status, stock:db.store.get(paths.record('products','p')).stock,
        sales:count('sales'), movements:count('movements'), reports:count('dailyReports'), legacy:db.store.get(paths.legacyState) };
      journal.close();
      return output;
    });
    assert.deepEqual(result, { hashMatches:true, first:'confirmed', pending:'unknown', preserved:'unknown', recovered:'confirmed', noResend:true,
      closed:'confirmed', stock:8, sales:2, movements:2, reports:1, legacy:{ revision:12, sentinel:'KEEP' } });
    await context.close();
    console.log(`PASS ${name} native IDB + actual modular coordinator/repository (fake transactional transport): offline/reconnect, response-loss server confirmation, duplicate sale/close, unchanged legacy`);
  } finally { await browser.close(); }
}
