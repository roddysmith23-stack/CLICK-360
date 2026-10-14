import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium,webkit,firefox} from 'playwright';
const sources=await Promise.all(['spark-modular-migration.js','spark-modular-recovery.js'].map(file=>readFile(file,'utf8')));
for(const [name,engine]of Object.entries({chromium,webkit,firefox})){
  const browser=await engine.launch();
  try{
    const context=await browser.newContext();
    try{
      const page=await context.newPage();
      await context.route('https://spark-recovery.example.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic recovery</title>'}));
      await page.goto('https://spark-recovery.example.test/');
      for(const content of sources)await page.addScriptTag({content});
      const initial=await page.evaluate(async()=>{
        const snapshot={products:[{id:'p',stock:1,qty:1}],sales:[{id:'sale-existing',total:30}],padding:'x'.repeat(900000)};
        const sourceHash=await CLICK360_SPARK_MIGRATION.hash(snapshot);
        const input={sourceHash,snapshot,deviceRevision:'device-43',remoteRevision:42,pendingOperations:[{operationId:'existing-persist-op',state:'unknown'}],buildSha:'21409a1d2dc7'};
        // Upgrade an actual V1 recovery database with an existing immutable pin.
        const {snapshot:oldSnapshot,...content}=input;
        const old=await new Promise((resolve,reject)=>{
          const r=indexedDB.open('click360-spark-migration-recovery-v1',1);
          r.onupgradeneeded=()=>r.result.createObjectStore('snapshots',{keyPath:'key'});
          r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
        });
        const legacyRow={key:`synthetic-owner:${sourceHash}`,ownerUid:'synthetic-owner',sourceHash,snapshot:oldSnapshot,
          content,contentHash:await CLICK360_SPARK_MIGRATION.hash(content)};
        await new Promise((resolve,reject)=>{const tx=old.transaction('snapshots','readwrite');
          tx.objectStore('snapshots').add(legacyRow);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});old.close();
        const recovery=await CLICK360_SPARK_RECOVERY.open({ownerUid:'synthetic-owner',resolveUser:()=>({uid:'synthetic-owner'})});
        const device=await recovery.deviceIdentity('initial-device-id');
        const same=await recovery.deviceIdentity('volatile-local-storage-id');
        if(device.deviceId!==same.deviceId||!device.durable)throw Error('DURABLE_DEVICE_IDENTITY_REQUIRED');
        await recovery.pin(input);await recovery.pin(input);
        const journalCapture={ownerUid:'synthetic-owner',enumerationComplete:true,recordCount:101,
          rows:Array.from({length:101},(_,i)=>({operationId:`op-${i}`,state:i===100?'unknown':'confirmed',payloadHash:'a'.repeat(64)}))};
        const captured=await recovery.captureDevice({record:{snapshot,identity:{ownerUid:'synthetic-owner'},deviceRevision:'device-43'},
          journalCapture,deviceId:device.deviceId,buildSha:input.buildSha});
        if(!captured.durable||captured.capture.journalCapture.rows[100].state!=='unknown')throw Error('RECOVERY_UNKNOWN_CAPTURE_MISSING');
        // Real IndexedDB and recovery implementation; deliberately synthetic
        // RPC transport. Actual client Rules/served PWA have separate gates.
        const cloudSizes=[];
        for(const bytes of [850000,860000,1024*1024,Math.ceil(1.2*1024*1024),3*1024*1024,7*1024*1024]){
          const remote={revision:41,payload:{data:{businesses:[{id:'alpha'}],sales:[]}}};
          const source={businesses:[{id:'alpha'},{id:'beta'}],sales:[{id:'sale-existing',total:30}],padding:'x'.repeat(bytes)};
          const copy=await recovery.captureDevice({record:{snapshot:source,identity:{ownerUid:'synthetic-owner'},deviceRevision:`size-${bytes}`},
            journalCapture,deviceId:device.deviceId,buildSha:input.buildSha,
            remoteReference:{source:'server',revision:41,hash:await CLICK360_SPARK_MIGRATION.hash(remote.payload.data)}});
          const rows=new Map([['businesses/synthetic-owner/state/main',remote]]);let commits=0,lostReply=bytes===860000;
          const snap=(path)=>({exists:rows.has(path),data:()=>structuredClone(rows.get(path)),metadata:{fromCache:false,hasPendingWrites:false}});
          const cloud={app:{options:{projectId:'demo-click360-spark-modular'}},doc:path=>({path,get:async()=>snap(path)}),
            collection:path=>{
              let after=-1,limit=100;
              const q={orderBy:()=>q,limit:n=>{limit=n;return q;},startAfter:p=>{after=p;return q;},get:async()=>({
                metadata:{fromCache:false,hasPendingWrites:false},docs:[...rows.entries()].filter(([p,r])=>p.startsWith(path+'/')&&r.position>after)
                  .sort((a,b)=>a[1].position-b[1].position).slice(0,limit).map(([p])=>({id:p.split('/').at(-1),data:()=>structuredClone(rows.get(p))}))})};return q;
            },runTransaction:async callback=>{
              const writes=[];const value=await callback({get:async ref=>snap(ref.path),
                set:(ref,data)=>writes.push([ref.path,structuredClone(data)]),
                update:(ref,data)=>writes.push([ref.path,{...rows.get(ref.path),...structuredClone(data)}])});
              for(const [path,data]of writes)rows.set(path,data);
              if(++commits===2&&lostReply){lostReply=false;throw Object.assign(Error('Synthetic lost response'),{code:'unavailable'});}
              return value;
            }};
          const args={captureHash:copy.captureHash,db:cloud,firebase:{firestore:{FieldValue:{serverTimestamp:()=> 'SYNTHETIC_SERVER_TIMESTAMP'}}},
            projectId:'demo-click360-spark-modular',assertStable:async()=>{}};
          if(bytes===860000){
            let stopped=false;try{await recovery.preserveCloud(args);}catch(error){stopped=error.code==='unavailable';}
            if(!stopped||rows.get(`businesses/synthetic-owner/recoveryCopies/${copy.captureHash}`).state!=='UPLOADING')throw Error('PARTIAL_COPY_FALSE_COMPLETE');
          }
          const first=await recovery.preserveCloud(args),count=rows.size;
          const second=await recovery.preserveCloud(args);
          if(first.status!=='RECOVERY_COPY_CLIENT_VERIFIED'||second.captureHash!==first.captureHash
            ||rows.size!==count||first.operationalCloudConfirmed!==false)throw Error('COPY_RETRY_NOT_IDEMPOTENT');
          const partPath=`businesses/synthetic-owner/recoveryCopies/${copy.captureHash}/parts/p0`,original=structuredClone(rows.get(partPath));
          rows.set(partPath,{...original,content:original.content+'corrupt'});
          let corruptDenied=false;try{await recovery.preserveCloud(args);}catch(error){corruptDenied=error.message==='SPARK_RECOVERY_REMOTE_PART_CONFLICT';}
          if(!corruptDenied)throw Error('CORRUPT_COPY_CONFIRMED');rows.set(partPath,original);
          let driftDenied=false;try{await recovery.preserveCloud({...args,assertStable:async()=>{throw Error('DEVICE_DRIFT');}});}
          catch(error){driftDenied=error.message==='DEVICE_DRIFT';}
          if(!driftDenied)throw Error('DRIFTED_SOURCE_CONFIRMED');
          if(JSON.stringify(rows.get('businesses/synthetic-owner/state/main'))!==JSON.stringify(remote))throw Error('COPY_WROTE_LEGACY');
          cloudSizes.push({bytes,parts:first.partCount,idempotent:true,corruptDenied,driftDenied});
        }
        let conflict=false;try{await recovery.pin({...input,pendingOperations:[]});}catch{conflict=true;}
        let oversizedRejected=false;
        const oversized={padding:'x'.repeat(8*1024*1024)};
        try{await recovery.pin({...input,snapshot:oversized,sourceHash:await CLICK360_SPARK_MIGRATION.hash(oversized)});}catch(error){oversizedRejected=error.message==='SPARK_RECOVERY_DEVICE_CAPACITY_EXCEEDED';}
        // The copy is not mutable by callers after enqueueing it.
        input.snapshot.products[0].stock=999;
        const row=await recovery.read(sourceHash);recovery.close();
        return {sourceHash,stock:row.snapshot.products[0].stock,pending:row.pendingOperations,conflict,oversizedRejected,deviceId:device.deviceId,captureHash:captured.captureHash,cloudSizes};
      });
      assert.equal(initial.stock,1);assert.equal(initial.conflict,true);
      assert.equal(initial.oversizedRejected,true);
      assert.equal(initial.cloudSizes.length,6);
      console.log(JSON.stringify({browser:name,scope:'native_IDB_with_synthetic_RPC',cloudSizes:initial.cloudSizes}));
      await page.close();
      const reopened=await context.newPage();await reopened.goto('https://spark-recovery.example.test/');
      for(const content of sources)await reopened.addScriptTag({content});
      const restored=await reopened.evaluate(async({hash,captureHash})=>{
        const recovery=await CLICK360_SPARK_RECOVERY.open({ownerUid:'synthetic-owner',resolveUser:()=>({uid:'synthetic-owner'})});
        const row=await recovery.read(hash),device=await recovery.deviceIdentity('changed-id-after-restart');
        const captured=await recovery.readCapture(captureHash);if(captured?.capture.journalCapture.rows[100].state!=='unknown')throw Error('RECOVERY_CAPTURE_RESTART_LOSS');recovery.close();
        const other=await CLICK360_SPARK_RECOVERY.open({ownerUid:'synthetic-other',resolveUser:()=>({uid:'synthetic-other'})});
        const isolated=await other.read(hash);other.close();
        return {stock:row.snapshot.products[0].stock,sale:row.snapshot.sales[0].id,pending:row.pendingOperations,durable:row.durable,isolated:isolated===null,deviceId:device.deviceId};
      },{hash:initial.sourceHash,captureHash:initial.captureHash});
      assert.deepEqual(restored,{stock:1,sale:'sale-existing',pending:initial.pending,durable:true,isolated:true,deviceId:initial.deviceId});
      console.log(JSON.stringify({browser:name,status:'PASS',pageCloseReopen:true,bytes:900000,immutable:true,pendingUnknownPreserved:true,
        ownerIsolation:true,recoveryV1UpgradePreservesPin:true,durableDeviceIdentity:true,productionWrites:0}));
    }finally{await context.close();}
  }finally{await browser.close();}
}
