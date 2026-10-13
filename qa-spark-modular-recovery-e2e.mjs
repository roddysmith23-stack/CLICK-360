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
        let conflict=false;try{await recovery.pin({...input,pendingOperations:[]});}catch{conflict=true;}
        let oversizedRejected=false;
        const oversized={padding:'x'.repeat(8*1024*1024)};
        try{await recovery.pin({...input,snapshot:oversized,sourceHash:await CLICK360_SPARK_MIGRATION.hash(oversized)});}catch(error){oversizedRejected=error.message==='SPARK_RECOVERY_DEVICE_CAPACITY_EXCEEDED';}
        // The copy is not mutable by callers after enqueueing it.
        input.snapshot.products[0].stock=999;
        const row=await recovery.read(sourceHash);recovery.close();
        return {sourceHash,stock:row.snapshot.products[0].stock,pending:row.pendingOperations,conflict,oversizedRejected,deviceId:device.deviceId};
      });
      assert.equal(initial.stock,1);assert.equal(initial.conflict,true);
      assert.equal(initial.oversizedRejected,true);
      await page.close();
      const reopened=await context.newPage();await reopened.goto('https://spark-recovery.example.test/');
      for(const content of sources)await reopened.addScriptTag({content});
      const restored=await reopened.evaluate(async hash=>{
        const recovery=await CLICK360_SPARK_RECOVERY.open({ownerUid:'synthetic-owner',resolveUser:()=>({uid:'synthetic-owner'})});
        const row=await recovery.read(hash),device=await recovery.deviceIdentity('changed-id-after-restart');recovery.close();
        const other=await CLICK360_SPARK_RECOVERY.open({ownerUid:'synthetic-other',resolveUser:()=>({uid:'synthetic-other'})});
        const isolated=await other.read(hash);other.close();
        return {stock:row.snapshot.products[0].stock,sale:row.snapshot.sales[0].id,pending:row.pendingOperations,durable:row.durable,isolated:isolated===null,deviceId:device.deviceId};
      },initial.sourceHash);
      assert.deepEqual(restored,{stock:1,sale:'sale-existing',pending:initial.pending,durable:true,isolated:true,deviceId:initial.deviceId});
      console.log(JSON.stringify({browser:name,status:'PASS',pageCloseReopen:true,bytes:900000,immutable:true,pendingUnknownPreserved:true,
        ownerIsolation:true,recoveryV1UpgradePreservesPin:true,durableDeviceIdentity:true,productionWrites:0}));
    }finally{await context.close();}
  }finally{await browser.close();}
}
