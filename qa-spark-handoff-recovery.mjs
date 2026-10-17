import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
const sources=await Promise.all(['spark-modular-migration.js','spark-modular-handoff.js','spark-modular-recovery.js'].map(file=>readFile(file,'utf8')));
for(const [engine,name]of [[chromium,'chromium'],[webkit,'webkit']]){
  const browser=await engine.launch();
  try{
    const context=await browser.newContext();
    try{
      await context.route('https://handoff-recovery.example.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic handoff</title>'}));
      const open=async()=>{const page=await context.newPage();await page.goto('https://handoff-recovery.example.test/');
        for(const content of sources)await page.addScriptTag({content});return page;};
      let page=await open();
      const proof=await page.evaluate(async()=>{
        const api=CLICK360_SPARK_MIGRATION,ownerUid='synthetic-handoff-owner',businessIds=['a','b'];
        const snapshot={businesses:businessIds.map(id=>({id})),cashSessions:[],movements:[],sales:[],dailyReports:[]};
        const sourceHash=await api.hash(snapshot),journalCapture={ownerUid,enumerationComplete:true,recordCount:0,rows:[]};
        const plan=await CLICK360_SPARK_HANDOFF.plan({ownerUid,snapshot,sourceHash,deviceMetadataHash:await api.hash({deviceRevision:'device-42'}),
          journalCapture,journalHash:await api.hash(journalCapture),businessIds,unknownCount:0,conflictCount:0,
          financialProofs:await Promise.all(businessIds.map(async businessId=>({businessId,...await api.deriveCashSummaries({snapshot,businessId})})))});
        const recovery=await CLICK360_SPARK_RECOVERY.open({ownerUid,resolveUser:()=>({uid:ownerUid})});
        await recovery.pin({sourceHash,snapshot,deviceRevision:'device-42',pendingOperations:['legacy-save']});
        const original=await recovery.read(sourceHash),stored=await recovery.pinHandoff(plan);
        const again=await recovery.pinHandoff(plan);
        if(stored.captureHash!==again.captureHash)throw Error('HANDOFF_RETRY_NOT_IDEMPOTENT');
        if(await api.hash(await recovery.read(sourceHash))!==await api.hash(original))throw Error('HANDOFF_CHANGED_SOURCE_PIN');
        let denied=false;try{await recovery.pinHandoff({...plan,cutoverAllowed:true});}catch{denied=true;}
        if(!denied)throw Error('HANDOFF_MUTATION_NOT_DENIED');
        recovery.close();return {sourceHash,captureHash:stored.captureHash,planHash:plan.planHash,original};
      });
      await page.close();page=await open();
      const resumed=await page.evaluate(async proof=>{
        const ownerUid='synthetic-handoff-owner',recovery=await CLICK360_SPARK_RECOVERY.open({ownerUid,resolveUser:()=>({uid:ownerUid})});
        const preserved=await recovery.readHandoff(proof.captureHash),original=await recovery.read(proof.sourceHash);
        if(preserved.plan.planHash!==proof.planHash||!preserved.durable)throw Error('HANDOFF_COLD_RESTART_LOSS');
        if(await CLICK360_SPARK_MIGRATION.hash(original)!==await CLICK360_SPARK_MIGRATION.hash(proof.original))throw Error('ORIGINAL_PIN_CHANGED');
        recovery.close();
        const other=await CLICK360_SPARK_RECOVERY.open({ownerUid:'other-owner',resolveUser:()=>({uid:'other-owner'})});
        if(await other.readHandoff(proof.captureHash)!==null)throw Error('HANDOFF_OWNER_LEAK');other.close();
        return {durable:true,sourceUnchanged:true,ownerIsolated:true,cutoverAllowed:preserved.plan.cutoverAllowed};
      },proof);
      assert.equal(resumed.cutoverAllowed,false);console.log(JSON.stringify({status:'PASS',scope:'native_readonly_handoff_pin',browser:name,...resumed}));
    }finally{await context.close();}
  }finally{await browser.close();}
}
