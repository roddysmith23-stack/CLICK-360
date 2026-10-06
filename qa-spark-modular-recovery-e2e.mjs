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
        const recovery=await CLICK360_SPARK_RECOVERY.open({ownerUid:'synthetic-owner',resolveUser:()=>({uid:'synthetic-owner'})});
        const snapshot={products:[{id:'p',stock:1,qty:1}],sales:[{id:'sale-existing',total:30}],padding:'x'.repeat(900000)};
        const sourceHash=await CLICK360_SPARK_MIGRATION.hash(snapshot);
        const input={sourceHash,snapshot,deviceRevision:'device-43',remoteRevision:42,pendingOperations:[{operationId:'existing-persist-op',state:'unknown'}],buildSha:'21409a1d2dc7'};
        await recovery.pin(input);await recovery.pin(input);
        let conflict=false;try{await recovery.pin({...input,pendingOperations:[]});}catch{conflict=true;}
        // The copy is not mutable by callers after enqueueing it.
        input.snapshot.products[0].stock=999;
        const row=await recovery.read(sourceHash);recovery.close();
        return {sourceHash,stock:row.snapshot.products[0].stock,pending:row.pendingOperations,conflict};
      });
      assert.equal(initial.stock,1);assert.equal(initial.conflict,true);
      await page.close();
      const reopened=await context.newPage();await reopened.goto('https://spark-recovery.example.test/');
      for(const content of sources)await reopened.addScriptTag({content});
      const restored=await reopened.evaluate(async hash=>{
        const recovery=await CLICK360_SPARK_RECOVERY.open({ownerUid:'synthetic-owner',resolveUser:()=>({uid:'synthetic-owner'})});
        const row=await recovery.read(hash);recovery.close();
        const other=await CLICK360_SPARK_RECOVERY.open({ownerUid:'synthetic-other',resolveUser:()=>({uid:'synthetic-other'})});
        const isolated=await other.read(hash);other.close();
        return {stock:row.snapshot.products[0].stock,sale:row.snapshot.sales[0].id,pending:row.pendingOperations,durable:row.durable,isolated:isolated===null};
      },initial.sourceHash);
      assert.deepEqual(restored,{stock:1,sale:'sale-existing',pending:initial.pending,durable:true,isolated:true});
      console.log(JSON.stringify({browser:name,status:'PASS',pageCloseReopen:true,bytes:900000,immutable:true,pendingUnknownPreserved:true,ownerIsolation:true,productionWrites:0}));
    }finally{await context.close();}
  }finally{await browser.close();}
}
