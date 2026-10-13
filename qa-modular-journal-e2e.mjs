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
    const coverage=await page.evaluate(async()=>{
      const journal=await CLICK360_MODULAR_JOURNAL.open({databaseName:'synthetic-owner-coverage'});
      const identity={ownerUid:'census-owner',businessId:'covered-business'};
      for(let i=0;i<100;i++)await journal.enqueue(identity,`op-${i}`,{actorUid:'census-owner',type:'cash_open'});
      await journal.enqueue({...identity,businessId:'omitted-business'},'tail-unknown',{actorUid:'census-owner',type:'cash_open'});
      const omitted={...identity,businessId:'omitted-business'};
      const uncertain=await journal.claim(omitted,'tail-unknown','census-device');
      await journal.markUnknown(omitted,'tail-unknown',uncertain.revision);
      await journal.enqueue({ownerUid:'different-owner',businessId:'foreign-business'},'foreign-op',{actorUid:'different-owner'});
      let stopped=false;try{await journal.assertOwnerCoverage(identity.ownerUid,[identity.businessId]);}
      catch(error){stopped=error.message==='OWNER_OUTBOX_BUSINESS_COVERAGE_REQUIRED';}
      const full=await journal.assertOwnerCoverage(identity.ownerUid,[identity.businessId,'omitted-business']);
      journal.close();return {stopped,full};
    });
    assert.equal(coverage.stopped,true,'An omitted business beyond the first 100 rows must block owner-wide migration');
    assert.deepEqual(coverage.full,{enumerationComplete:true,recordCount:101});
    for(const oldVersion of [1,2,3,4]){
    const upgrade=await page.evaluate(async oldVersion=>{
      const oldRow={key:'old-owner:old-business:old-op',ownerUid:'old-owner',businessId:'old-business',operationId:'old-op',state:'unknown',revision:9,payload:{total:30},payloadHash:'preserve-exact-hash',createdAt:1};
      await new Promise((resolve,reject)=>{
        const request=indexedDB.open(`synthetic-v${oldVersion}-upgrade`,oldVersion);
        request.onupgradeneeded=()=>{const store=request.result.createObjectStore('operations',{keyPath:'key'});
          if(oldVersion>=2)store.createIndex('tenantState',['ownerUid','businessId','state']);
          if(oldVersion>=3)store.createIndex('tenantProjection',['ownerUid','businessId','projectionState']);};
        request.onsuccess=()=>{const db=request.result;const tx=db.transaction('operations','readwrite');const store=tx.objectStore('operations');store.put(oldRow);
          store.put({...oldRow,key:'old-owner:old-business:confirmed-op',operationId:'confirmed-op',state:'confirmed'});
          tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>reject(tx.error);};
        request.onerror=()=>reject(request.error);
      });
      const journal=await CLICK360_MODULAR_JOURNAL.open({databaseName:`synthetic-v${oldVersion}-upgrade`});
      const identity={ownerUid:'old-owner',businessId:'old-business'};
      const row=await journal.get(identity,'old-op');const pending=await journal.listPending(identity);
      const confirmed=await journal.get(identity,'confirmed-op'),projectionCount=await journal.countProjectionPending(identity);
      journal.close();return {row,pending,confirmed,projectionCount};
    },oldVersion);
    assert.equal(upgrade.row.payloadHash,'preserve-exact-hash');assert.equal(upgrade.row.revision,9);
    assert.equal(upgrade.row.state,'unknown');assert.equal(upgrade.pending.length,1);
    assert.equal(upgrade.confirmed.state,'confirmed');assert.equal(upgrade.confirmed.revision,9);
    assert.equal(upgrade.confirmed.payloadHash,'preserve-exact-hash');
    assert.equal(upgrade.confirmed.projectionState,'pending');assert.equal(upgrade.projectionCount,1);
    }
    const actors=await page.evaluate(async()=>{
      const identity={ownerUid:'shared-owner',businessId:'shared-business'},databaseName='synthetic-actor-isolation';
      const all=await CLICK360_MODULAR_JOURNAL.open({databaseName});
      await all.enqueue(identity,'owner-pending',{actorUid:'shared-owner',total:30});
      await all.enqueue(identity,'worker-pending',{actorUid:'worker-a',total:10});
      await all.enqueue(identity,'second-worker-pending',{actorUid:'worker-b',total:20});
      all.close();
      const worker=await CLICK360_MODULAR_JOURNAL.open({databaseName,actorUid:'worker-a'});
      const count=await worker.countPending(identity),page=await worker.listPendingPage(identity);
      let foreignRead=false,foreignClaim=false,forgedIssuer=false;
      try{await worker.get(identity,'owner-pending');}catch(e){foreignRead=e.message==='OUTBOX_ACTOR_RECONCILIATION_REQUIRED';}
      try{await worker.claim(identity,'second-worker-pending','device');}catch(e){foreignClaim=e.message==='OUTBOX_ACTOR_RECONCILIATION_REQUIRED';}
      try{await worker.enqueue(identity,'forged',{actorUid:'worker-b',total:1});}catch(e){forgedIssuer=e.message==='OUTBOX_ACTOR_RECONCILIATION_REQUIRED';}
      worker.close();
      const census=await CLICK360_MODULAR_JOURNAL.open({databaseName});
      const preserved=await census.countPending(identity);
      await census.enqueue(identity,'issuer-unknown',{actorUid:42,total:99});census.close();
      const reopened=await CLICK360_MODULAR_JOURNAL.open({databaseName,actorUid:'worker-a'});
      let unknownStops=false;try{await reopened.countPending(identity);}catch(e){unknownStops=e.message==='OUTBOX_UNATTRIBUTED_RECONCILIATION_REQUIRED';}
      reopened.close();
      return {count:count.total,ids:page.rows.map(r=>r.operationId),complete:page.complete,
        foreignRead,foreignClaim,forgedIssuer,preserved:preserved.total,unknownStops};
    });
    assert.deepEqual(actors,{count:1,ids:['worker-pending'],complete:true,foreignRead:true,foreignClaim:true,
      forgedIssuer:true,preserved:3,unknownStops:true});
    const causalOrder=await page.evaluate(async()=>{
      const databaseName='synthetic-causal-order',identity={ownerUid:'fifo-owner',businessId:'fifo-business'};
      let journal=await CLICK360_MODULAR_JOURNAL.open({databaseName});
      const realNow=Date.now,expected=[];
      try{
        Date.now=()=>100;
        for(let i=120;i>=0;i--){const id=`op-${String(i).padStart(3,'0')}`;expected.push(id);await journal.enqueue(identity,id,{index:i});}
        journal.close();journal=await CLICK360_MODULAR_JOURNAL.open({databaseName});
        Date.now=()=>1;expected.push('clock-rollback');await journal.enqueue(identity,'clock-rollback',{index:-1});
        const rows=await journal.listPending(identity,100);
        return {actual:rows.map(r=>r.operationId),expected:expected.slice(0,100),
          strictlyOrdered:rows.every((r,i)=>i===0||r.createdAt>rows[i-1].createdAt),total:(await journal.countPending(identity)).total};
      }finally{Date.now=realNow;journal.close();}
    });
    assert.deepEqual(causalOrder.actual,causalOrder.expected,'Bounded replay uses enqueue chronology, not lexical operation IDs');
    assert.equal(causalOrder.strictlyOrdered,true);assert.equal(causalOrder.total,122);
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
      const projectionPending=await journal.countProjectionPending(a);
      let projectionHashDenied=false,projectionScopeDenied=false;
      try{await journal.markProjected(a,'op-sale','wrong-hash');}catch{projectionHashDenied=true;}
      try{await journal.markProjected({...a,businessId:'business-b'},'op-sale',row.payloadHash);}catch{projectionScopeDenied=true;}
      await journal.markProjected(a,'op-sale',row.payloadHash);
      const projected=await journal.get(a,'op-sale');
      const duplicateProjection=await journal.markProjected(a,'op-sale',row.payloadHash);
      if(projectionPending!==1||!projectionHashDenied||!projectionScopeDenied
        ||projected.projectionState!=='complete'||duplicateProjection.revision!==projected.revision
        ||await journal.countProjectionPending(a)!==0)throw Error('PROJECTION_RECOVERY_INTEGRITY_FAILED');
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
