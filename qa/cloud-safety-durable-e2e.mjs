import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium,webkit,firefox,devices} from 'playwright';
const sources={};
for(const file of ['v16-storage.js','cloud-safety-backup.js'])sources[`/${file}`]=await readFile(file,'utf8');
const server=createServer((req,res)=>{
  const source=sources[req.url];res.setHeader('Content-Type',source?'application/javascript':'text/html');
  res.end(source||'<!doctype html><script src="/v16-storage.js"></script><script src="/cloud-safety-backup.js"></script>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
  for(const [name,engine,options] of [['iPhone WebKit',webkit,devices['iPhone 15']],['Android Chromium',chromium,devices['Pixel 7']],['desktop Chromium',chromium,{}],['desktop Firefox',firefox,{}]]){
    const browser=await engine.launch();
    try{
      const context=await browser.newContext(options),page=await context.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const first=await page.evaluate(async()=>{
        const storage=window.CLICK360_V16_STORAGE,api=window.CLICK360_CLOUD_SAFETY;
        const ctx={authUid:'synthetic-owner',ownerId:'synthetic-owner',businessId:'synthetic-owner',tenantKey:'owner:synthetic-owner:business:synthetic-owner'};
        const snapshot={identity:{ownerUid:ctx.ownerId,tenantKey:ctx.tenantKey},businesses:[{id:'alpha'},{id:'beta'}],products:[{id:'p',businessId:'alpha',stock:12}],settings:{padding:'x'.repeat(1200000)}};
        await storage.putSnapshot(ctx,snapshot,{cloudCapacityBlocked:true,deviceRevision:'operation-1',pendingOperations:['operation-1','unknown-op']});
        const captured=await storage.getSnapshot(ctx),key=await api.sha(api.json(captured));
        const metadata=await storage.allocateSafetyMetadata(ctx,captured,key);
        const again=await storage.allocateSafetyMetadata(ctx,captured,key);
        const prepared=await api.prepare(ctx,captured,{buildSha:'21409a1d2dc7',deviceId:metadata.deviceId,sequence:metadata.sequence});
        const reconstructed=await api.reconstruct(prepared.manifest,prepared.chunks);
        if(api.json(reconstructed)!==api.json(captured))throw Error('reconstruction changed snapshot');
        await storage.confirmSafetyMetadata(ctx,key,{status:'COMPLETE',payloadSha256:key,backupId:prepared.manifest.backupId,completedAt:'2026-10-05T00:00:00Z'},captured);
        const after=await storage.getSnapshot(ctx);
        if(api.json(after)!==api.json(captured))throw Error('backup metadata mutated snapshot/outbox');
        return {ctx,key,metadata,again,backupId:prepared.manifest.backupId};
      });
      assert.deepEqual(first.metadata,first.again);
      await page.reload();
      const second=await page.evaluate(async({ctx,key})=>{
        const storage=window.CLICK360_V16_STORAGE,api=window.CLICK360_CLOUD_SAFETY;
        const old=await storage.getSnapshot(ctx),confirmed=await storage.getSafetyMetadata(ctx);
        await storage.putSnapshot(ctx,{...old.snapshot,newOperation:'not-lost'},{cloudCapacityBlocked:true,expectedDeviceRevision:'operation-1',deviceRevision:'operation-2',pendingOperations:['operation-1','unknown-op','operation-2']});
        let stale=false;
        try{await storage.allocateSafetyMetadata(ctx,old,key);}catch(e){stale=e.code==='safety-capture-stale';}
        const current=await storage.getSnapshot(ctx),newKey=await api.sha(api.json(current));
        const allocated=await storage.allocateSafetyMetadata(ctx,current,newKey);
        const staleConfirmation=await storage.confirmSafetyMetadata(ctx,key,{status:'COMPLETE',payloadSha256:key,backupId:'old',completedAt:'old'},old);
        const other=await storage.getSafetyMetadata({...ctx,authUid:'other-owner',ownerId:'other-owner',tenantKey:'owner:other-owner:business:other-owner'});
        return {confirmed,stale,allocated,staleConfirmation,other,pending:current.pendingOperations,stock:current.snapshot.products[0].stock};
      },first);
      assert.equal(second.confirmed.status,'COMPLETE');assert.equal(second.confirmed.backupId,first.backupId);
      assert.equal(second.stale,true);assert.equal(second.staleConfirmation,false);assert.equal(second.other,null);
      assert.equal(second.allocated.sequence,2);assert.equal(second.allocated.deviceId,first.metadata.deviceId);
      assert.deepEqual(second.pending,['operation-1','unknown-op','operation-2']);assert.equal(second.stock,12);
      console.log(`PASS ${name}: real durable IDB backup capture/reconstruction, cold restart, sequence CAS, stale confirmation rejection, journal and stock preserved`);
    }finally{await browser.close();}
  }
}finally{await new Promise(resolve=>server.close(resolve));}
