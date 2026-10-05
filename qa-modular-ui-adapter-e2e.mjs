import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium,webkit,firefox} from 'playwright';
const harness=await readFile('qa-modular-persistence-v2-harness.cjs','utf8');
const fakeDb=harness.slice(harness.indexOf('function clone('),harness.indexOf('function baseRecord('));
const sources=await Promise.all(['modular-persistence.js','modular-operation-journal.js','modular-operation-coordinator.js','modular-ui-adapter.js'].map(file=>readFile(file,'utf8')));
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
      journal.close();
      return {double:double.map(value=>value.status),once,rechecked,pending:pending.status,pendingCount:health.pendingCount,
        survived:survived.state,replay:replay[0].status,unknown:unknown.status,uncertain:uncertain.state,recovered:recovered[0].status,
        finalStock:db.store.get(paths.record('products','p')).stock,projected,isolated,
        falseConfirmation:statuses.some(detail=>detail.status!=='CONFIRMED'&&detail.operationalCloudConfirmed)};
    });
    assert.deepEqual(result,{double:['CONFIRMED','CONFIRMED'],once:9,rechecked:true,pending:'PENDING',pendingCount:1,survived:'queued',
      replay:'CONFIRMED',unknown:'UNKNOWN',uncertain:'unknown',recovered:'CONFIRMED',finalStock:7,projected:3,isolated:true,falseConfirmation:false});
    console.log(`PASS ${name} DEV UI adapter + real IndexedDB: button double click, durable pending/reopen, fresh server evidence, bounded replay, UNKNOWN preservation, tenant switch denied (synthetic transactional transport)`);
  }finally{await browser.close();}
}
