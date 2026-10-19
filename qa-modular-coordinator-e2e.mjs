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
      const recovered = (await coordinator.replay())[0];
      const afterLost = sends;
      await coordinator.process('sale-2');
      const noResend = sends === afterLost;
      if((await journal.listPending(identity)).length!==0)throw Error('CONFIRMED_OPERATIONS_REPLAYED');
      // An exhausted server cannot provide a second authoritative read in the
      // same attempt. Keep the unknown command intact; reconnect must still
      // check its ledger BEFORE committing anything.
      let quota=true, quotaReads=0, quotaCommits=0;
      const quotaEvents=[];
      const quotaTransport={...repository,
        lookupOperation:async(...args)=>{
          quotaReads++;quotaEvents.push('lookup');
          if(quota)throw Object.assign(Error('Synthetic exhausted quota'),{code:'resource-exhausted'});
          return repository.lookupOperation(...args);
        },
        commitSale:async input=>{quotaCommits++;quotaEvents.push('commit');return repository.commitSale(input);}
      };
      let quotaCoordinator=CLICK360_MODULAR_COORDINATOR.create({journal,repository:quotaTransport,deviceId:'device-b'});
      const quotaPinned=await quotaCoordinator.enqueue('sale',sale('sale-quota',8,3));
      const quotaFailure=await quotaCoordinator.process('sale-quota');
      if(quotaReads!==1||quotaCommits!==0)throw Error('QUOTA_EXHAUSTION_REDUNDANT_SERVER_REQUEST');
      journal.close();journal=await CLICK360_MODULAR_JOURNAL.open();
      const quotaPreserved=await journal.get(identity,'sale-quota');
      if(quotaPreserved.state!=='unknown'||quotaPreserved.payloadHash!==quotaPinned.payloadHash)
        throw Error('QUOTA_EXHAUSTION_LOST_DURABLE_COMMAND');
      quota=false;quotaEvents.length=0;
      quotaCoordinator=CLICK360_MODULAR_COORDINATOR.create({journal,repository:quotaTransport,deviceId:'device-c'});
      const quotaRecovered=await quotaCoordinator.process('sale-quota');
      if(quotaEvents[0]!=='lookup'||quotaEvents.filter(event=>event==='commit').length!==1)
        throw Error('QUOTA_REPLAY_WITHOUT_AUTHORITATIVE_RECONCILIATION');
      await quotaCoordinator.process('sale-quota');
      if(quotaCommits!==1)throw Error('QUOTA_REPLAY_DUPLICATE_COMMIT');
      const quotaEvidence={failure:quotaFailure.status,cause:quotaFailure.reason,
        survived:quotaPreserved.state,recovered:quotaRecovered.status,commits:quotaCommits};
      // Even a quota error received AFTER a successful commit is not a retry
      // grant. Simulate that uncertainty and prove a cold restart confirms the
      // existing ledger without a second sale or stock decrement.
      let uncertainCommits=0;
      const uncertainTransport={...repository,commitSale:async input=>{
        uncertainCommits++;
        await repository.commitSale(input);
        throw Object.assign(Error('Synthetic lost confirmation'),{code:'firestore/resource-exhausted'});
      }};
      let uncertainCoordinator=CLICK360_MODULAR_COORDINATOR.create({journal,repository:uncertainTransport,deviceId:'device-c'});
      await uncertainCoordinator.enqueue('sale',sale('sale-quota-response',7,4));
      const uncertainResult=await uncertainCoordinator.process('sale-quota-response');
      const stockAfterUncertain=db.store.get(paths.record('products','p')).stock;
      journal.close();journal=await CLICK360_MODULAR_JOURNAL.open();
      uncertainCoordinator=CLICK360_MODULAR_COORDINATOR.create({journal,repository:uncertainTransport,deviceId:'device-d'});
      const uncertainRecovered=await uncertainCoordinator.process('sale-quota-response');
      if(uncertainCommits!==1||db.store.get(paths.record('products','p')).stock!==stockAfterUncertain)
        throw Error('QUOTA_LOST_CONFIRMATION_DUPLICATED_SALE');
      const uncertainEvidence={failure:uncertainResult.status,recovered:uncertainRecovered.status,commits:uncertainCommits};
      coordinator=CLICK360_MODULAR_COORDINATOR.create({journal,repository:transport,deviceId:'device-c'});
      await coordinator.enqueue('cash_close', { operationId:'close-1', cashSessionId:'cash',
        report:{ date:'2026-09-03', saleIds:['sale-1','sale-2','sale-quota','sale-quota-response'], total:120 } });
      const closed = await coordinator.process('close-1');
      await coordinator.process('close-1');
      const count = module => [...db.store.keys()].filter(k => k.startsWith(paths.collection(module)+'/')).length;
      const output = { hashMatches, first:first.status, pending:pending.status, preserved:preserved.state,
        recovered:recovered.status, noResend, quotaEvidence, uncertainEvidence, closed:closed.status, stock:db.store.get(paths.record('products','p')).stock,
        sales:count('sales'), movements:count('movements'), reports:count('dailyReports'), legacy:db.store.get(paths.legacyState) };
      journal.close();
      return output;
    });
    assert.deepEqual(result, { hashMatches:true, first:'confirmed', pending:'unknown', preserved:'unknown', recovered:'confirmed', noResend:true,
      quotaEvidence:{failure:'unknown',cause:'resource-exhausted',survived:'unknown',recovered:'confirmed',commits:1},
      uncertainEvidence:{failure:'unknown',recovered:'confirmed',commits:1},
      closed:'confirmed', stock:6, sales:4, movements:4, reports:1, legacy:{ revision:12, sentinel:'KEEP' } });
    await context.close();
    console.log(`PASS ${name} native IDB + actual modular coordinator/repository (fake transactional transport): offline/reconnect, exhausted quota, cold recovery, quota after commit, response-loss server confirmation, duplicate sale/close, unchanged legacy`);
  } finally { await browser.close(); }
}
