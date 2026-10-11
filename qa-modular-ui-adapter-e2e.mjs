import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium,webkit,firefox} from 'playwright';
import './qa-spark-live-command-adapters.mjs';
const harness=await readFile('qa-modular-persistence-v2-harness.cjs','utf8');
const fakeDb=harness.slice(harness.indexOf('function clone('),harness.indexOf('function baseRecord('));
const sources=await Promise.all(['modular-persistence.js','modular-operation-journal.js','modular-operation-coordinator.js','modular-ui-adapter.js','spark-modular-reconciliation.js'].map(file=>readFile(file,'utf8')));
for(const [name,engine] of Object.entries({chromium,webkit,firefox})){
  const browser=await engine.launch();
  try{
    const page=await browser.newPage();
    await page.route('https://modular-ui.example.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><button id="sale">Venta sintética</button><output id="status"></output>'}));
    await page.goto('https://modular-ui.example.test/');
    for(const source of [...sources,fakeDb])await page.addScriptTag({content:source});
    const result=await page.evaluate(async()=>{
      const api=CLICK360_MODULAR_PERSISTENCE,identity=api.identity('synthetic-owner','alpha'),paths=api.paths(identity.ownerUid,identity.businessId);
      const db=createDb({
        [paths.featureFlag]:{enabled:true,writeMode:'modular',schemaVersion:2,businessIds:['alpha']},
        [paths.root]:{...identity,status:'CUTOVER_VERIFIED',legacyWriteFence:api.LEGACY_WRITE_FENCE},
        [paths.record('products','p')]:{...identity,stock:10,qty:10,recordVersion:1},
        [paths.record('cashSessions','cash')]:{...identity,status:'open',date:'2026-09-03',recordVersion:1}
      });
      const repository=api.createFirestoreRepository({db,firebase:{firestore:{FieldValue:{serverTimestamp:()=> 'SERVER_TIMESTAMP'}}},
        user:{uid:identity.ownerUid},ownerUid:identity.ownerUid,businessId:identity.businessId,projectId:'demo-click360-ui'});
      const input=(id,stock,version)=>({operationId:id,sale:{date:'2026-09-03',cashSessionId:'cash',total:30,items:[{productId:'p',qty:1,price:30}]},
        movement:{date:'2026-09-03',cashSessionId:'cash',amount:30,kind:'ingreso'},productChanges:[{productId:'p',quantity:1,expectedStock:stock,expectedRecordVersion:version}]});
      let journal=await CLICK360_MODULAR_JOURNAL.open(),online=true,active=identity,unavailable=false,lookups=0;
      const views=new Map(),statuses=[];
      const transport={...repository,lookupOperation:async(...args)=>{lookups++;if(unavailable)throw Error('NETWORK');return repository.lookupOperation(...args);}};
      const create=()=>CLICK360_MODULAR_UI_ADAPTER.create({repository:transport,journal,deviceId:'synthetic-device',resolveIdentity:()=>active,isOnline:()=>online,
        onStatus:detail=>{statuses.push(detail);document.querySelector('#status').textContent=detail.status;},
        onConfirmed:async receipt=>{views.set(receipt.operationId,receipt);}});
      let adapter=create();
      const clicks=[];document.querySelector('#sale').onclick=()=>clicks.push(adapter.submit('sale',input('sale-ui-1',10,1)));
      document.querySelector('#sale').click();document.querySelector('#sale').click();
      const double=await Promise.all(clicks);
      const once=db.store.get(paths.record('products','p')).stock;
      const confirmedLookups=lookups;
      await adapter.submit('sale',input('sale-ui-1',10,1));
      const rechecked=lookups>confirmedLookups;
      online=false;
      const pending=await adapter.submit('sale',input('sale-ui-2',9,2));
      const health=await adapter.health();
      journal.close();journal=await CLICK360_MODULAR_JOURNAL.open();adapter=create();
      const survived=await journal.get(identity,'sale-ui-2');
      online=true;const replay=await adapter.replay({limit:1});
      unavailable=true;const unknown=await adapter.submit('sale',input('sale-ui-3',8,3));
      const uncertain=await journal.get(identity,'sale-ui-3');
      unavailable=false;
      const recovered=await adapter.replay({limit:1});
      const projected=views.size;
      active=api.identity('another-owner','alpha');let isolated=false;
      try{await adapter.submit('sale',input('wrong-tenant',7,4));}catch(error){isolated=error.message==='MODULAR_UI_CONTEXT_CHANGED';}
      // A migration guard must not mistake a truncated replay page for an
      // empty/clean outbox. Count directly through the scoped IDB index.
      for(let i=0;i<101;i++)await journal.enqueue(identity,`count-${i}`,{test:'count-only',index:i});
      const claimed=await journal.claim(identity,'count-100','synthetic-device');
      await journal.markUnknown(identity,'count-100',claimed.revision);
      const counts=await journal.countPending(identity);
      const foreignCounts=await journal.countPending(active);
      active=identity;
      const largeHealth=await adapter.health();
      const enumeration=[];
      for(const size of [99,100,101,250,1000]){
        const scoped={ownerUid:identity.ownerUid,businessId:`enumeration-${size}`};
        for(let i=0;i<size;i++)await journal.enqueue(scoped,`row-${String(i).padStart(4,'0')}`,{index:i});
        const tail=`row-${String(size-1).padStart(4,'0')}`;
        const inflight=await journal.claim(scoped,tail,'enumeration-device');
        await journal.markUnknown(scoped,tail,inflight.revision);
        const exact=await journal.countPending(scoped),all=[];let after=null,pages=0;
        do{
          const page=await journal.listPendingPage(scoped,{limit:100,after});
          if(page.rows.length>100)throw Error('UNBOUNDED_OUTBOX_PAGE');
          all.push(...page.rows);after=page.next;pages++;
          if(page.complete!==!after)throw Error('INCONSISTENT_OUTBOX_COMPLETENESS');
        }while(after);
        if(all.length!==size || new Set(all.map(row=>row.key)).size!==size
          || all.filter(row=>row.state==='unknown').length!==1)throw Error('INCOMPLETE_OUTBOX_ENUMERATION');
        const reconciled=await CLICK360_SPARK_RECONCILIATION.reconcileJournal({identity:scoped,journal,pageSize:100,
          assertSourceStable:async()=>{},lookupOperation:async row=>{
            if(row.operationId===tail)throw Error('SERVER_LEDGER_UNAVAILABLE');
            return {source:'server',exists:false};
          }});
        if(!reconciled.enumerationComplete||reconciled.canProceed||reconciled.unknownCount!==1
          ||reconciled.localPendingCount!==size-1)throw Error('HIDDEN_UNKNOWN_AFTER_PAGE_100');
        enumeration.push({size,total:exact.total,unknown:exact.unknownCount,pages});
      }
      journal.close();
      return {double:double.map(value=>value.status),once,rechecked,pending:pending.status,pendingCount:health.pendingCount,
        survived:survived.state,replay:replay[0].status,unknown:unknown.status,uncertain:uncertain.state,recovered:recovered[0].status,
        finalStock:db.store.get(paths.record('products','p')).stock,projected,isolated,
        falseConfirmation:statuses.some(detail=>detail.status!=='CONFIRMED'&&detail.operationalCloudConfirmed),counts,foreignCounts,largeHealth,enumeration};
    });
    assert.deepEqual(result,{double:['CONFIRMED','CONFIRMED'],once:9,rechecked:true,pending:'PENDING',pendingCount:1,survived:'queued',
      replay:'CONFIRMED',unknown:'UNKNOWN',uncertain:'unknown',recovered:'CONFIRMED',finalStock:7,projected:3,isolated:true,falseConfirmation:false,
      counts:{pendingCount:100,unknownCount:1,total:101,countIsBounded:false},foreignCounts:{pendingCount:0,unknownCount:0,total:0,countIsBounded:false},
      largeHealth:{pendingCount:100,unknownCount:1,total:101,countIsBounded:false,online:true,activeRequests:0},
      enumeration:[99,100,101,250,1000].map(size=>({size,total:size,unknown:1,pages:Math.ceil(size/100)}))});
    console.log(`PASS ${name} DEV UI adapter + real IndexedDB: button double click, durable pending/reopen, fresh server evidence, bounded replay, UNKNOWN preservation, tenant switch denied (synthetic transactional transport)`);
  }finally{await browser.close();}
}
