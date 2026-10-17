import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
const sources=await Promise.all(['spark-modular-migration.js','spark-modular-handoff.js','spark-modular-recovery.js','v16-storage.js'].map(file=>readFile(file,'utf8')));
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
        const approval=await CLICK360_SPARK_HANDOFF.runtimeApproval(plan,'a'.repeat(40));
        if(approval.captureHash!==stored.captureHash)throw Error('ADMIN_APPROVAL_CAPTURE_NOT_BOUND');
        recovery.close();return {sourceHash,captureHash:stored.captureHash,planHash:plan.planHash,original,approval};
      });
      await page.close();page=await open();
      const resumed=await page.evaluate(async proof=>{
        const ownerUid='synthetic-handoff-owner',recovery=await CLICK360_SPARK_RECOVERY.open({ownerUid,resolveUser:()=>({uid:ownerUid})});
        const preserved=await recovery.readHandoff(proof.captureHash),original=await recovery.read(proof.sourceHash);
        if(preserved.plan.planHash!==proof.planHash||!preserved.durable)throw Error('HANDOFF_COLD_RESTART_LOSS');
        if(await CLICK360_SPARK_MIGRATION.hash(original)!==await CLICK360_SPARK_MIGRATION.hash(proof.original))throw Error('ORIGINAL_PIN_CHANGED');
        const approval=await CLICK360_SPARK_HANDOFF.runtimeApproval(preserved.plan,'a'.repeat(40));
        if(await CLICK360_SPARK_MIGRATION.hash(approval)!==await CLICK360_SPARK_MIGRATION.hash(proof.approval))throw Error('RUNTIME_APPROVAL_RESTART_DRIFT');
        recovery.close();
        const other=await CLICK360_SPARK_RECOVERY.open({ownerUid:'other-owner',resolveUser:()=>({uid:'other-owner'})});
        if(await other.readHandoff(proof.captureHash)!==null)throw Error('HANDOFF_OWNER_LEAK');other.close();
        return {durable:true,sourceUnchanged:true,ownerIsolated:true,cutoverAllowed:preserved.plan.cutoverAllowed};
      },proof);
      assert.equal(resumed.cutoverAllowed,false);console.log(JSON.stringify({status:'PASS',scope:'native_readonly_handoff_pin',browser:name,...resumed}));
      const promotion=await page.evaluate(async()=>{
        const ownerUid='synthetic-promotion-owner',api=CLICK360_SPARK_MIGRATION,buildSha='a'.repeat(40);
        const context={authUid:ownerUid,ownerUid,ownerId:ownerUid,businessId:ownerUid,tenantKey:`owner:${ownerUid}:business:${ownerUid}`,schemaVersion:10};
        const snapshot={identity:context,businesses:[{id:ownerUid}],sales:[],movements:[],cashSessions:[],dailyReports:[]};
        window.CLICK360_FIREBASE_CONFIG={projectId:'demo-click360-spark-modular'};
        window.CLICK360_RELEASE_ASSETS={'app.js':buildSha};window.click360Auth={currentUser:{uid:ownerUid}};
        await CLICK360_V16_STORAGE.putSnapshot(context,snapshot,{cloudCapacityBlocked:true,pendingRemoteSync:true,
          pendingOperations:['legacy-save'],source:'indexeddb_cache',deviceRevision:'source-42'});
        await CLICK360_V16_STORAGE.putWorkingDate(context,ownerUid,'2026-09-03');
        const current=await CLICK360_V16_STORAGE.getSnapshot(context),{snapshot:ignored,...deviceRecordMetadata}=current;
        const sourceHash=await api.hash(snapshot),deviceMetadataHash=await api.hash(deviceRecordMetadata);
        const journalCapture={ownerUid,enumerationComplete:true,recordCount:0,rows:[]};
        const plan=await CLICK360_SPARK_HANDOFF.plan({ownerUid,snapshot,sourceHash,deviceMetadataHash,
          journalCapture,journalHash:await api.hash(journalCapture),businessIds:[ownerUid],unknownCount:0,conflictCount:0,
          financialProofs:[{businessId:ownerUid,...await api.deriveCashSummaries({snapshot,businessId:ownerUid})}]});
        const recovery=await CLICK360_SPARK_RECOVERY.open({ownerUid,resolveUser:()=>click360Auth.currentUser});
        await recovery.pin({sourceHash,snapshot,deviceRevision:'source-42',deviceRecordMetadata,buildSha});
        const pin=await recovery.read(sourceHash),handoff=await recovery.pinHandoff(plan);
        const proof={verified:true,status:'LOCAL_HANDOFF_VERIFIED',buildSha,sourceHash,deviceMetadataHash,
          deviceRevision:'source-42',captureHash:handoff.captureHash,assertStable:async()=>{}};
        const metadata={source:'spark_operational_candidate',cloudCapacityBlocked:false,pendingRemoteSync:false,
          deviceRevision:'modular-43',expectedDeviceRevision:'source-42',verifiedLocalHandoff:proof};
        const denied=async action=>{let rejected=false;try{await action();}catch{rejected=true;}if(!rejected)throw Error('PROMOTION_SHOULD_REJECT');};
        await denied(()=>CLICK360_V16_STORAGE.putSnapshot(context,snapshot,{...metadata,modularPromotion:{},allowVerifiedModularPromotion:true}));
        await denied(()=>CLICK360_V16_STORAGE.promoteVerifiedSnapshot(context,snapshot,{...metadata,verifiedLocalHandoff:{...proof,captureHash:'f'.repeat(64)}}));
        await denied(()=>CLICK360_V16_STORAGE.promoteVerifiedSnapshot(context,{...snapshot,identity:{...context,ownerId:'other',ownerUid:'other'}},metadata));
        CLICK360_FIREBASE_CONFIG.projectId='click-360';
        await denied(()=>CLICK360_V16_STORAGE.promoteVerifiedSnapshot(context,snapshot,metadata));
        CLICK360_FIREBASE_CONFIG.projectId='demo-click360-spark-modular';
        await denied(()=>CLICK360_V16_STORAGE.promoteVerifiedSnapshot(context,snapshot,{...metadata,verifiedLocalHandoff:{...proof,
          assertStable:()=>CLICK360_V16_STORAGE.putWorkingDate(context,ownerUid,'2026-09-04')}}));
        const changed=await CLICK360_V16_STORAGE.getSnapshot(context);
        if(changed.source!=='indexeddb_cache'||!changed.cloudCapacityBlocked||changed.deviceRevision!=='source-42')throw Error('PROMOTION_CAS_LOST_SOURCE');
        await CLICK360_V16_STORAGE.putWorkingDate(context,ownerUid,'2026-09-03');
        await CLICK360_V16_STORAGE.promoteVerifiedSnapshot(context,snapshot,metadata);
        const installed=await CLICK360_V16_STORAGE.getSnapshot(context);
        if(installed.source!=='spark_operational_candidate'||installed.cloudCapacityBlocked||installed.uiWorkingDates[ownerUid]!=='2026-09-03')throw Error('PROMOTION_NOT_DURABLE');
        if(await api.hash(await recovery.read(sourceHash))!==await api.hash(pin))throw Error('PROMOTION_CHANGED_SOURCE_PIN');
        await denied(()=>CLICK360_V16_STORAGE.putSnapshot(context,snapshot,{source:'remote_snapshot',expectedDeviceRevision:'modular-43'}));
        recovery.close();return {verifiedPromotion:true,originalPinPreserved:true,workingDatePreserved:true,
          forgedFlagDenied:true,concurrentMetadataDriftDenied:true,productionDenied:true,legacyDowngradeDenied:true};
      });
      console.log(JSON.stringify({status:'PASS',scope:'native_verified_local_handoff_promotion',browser:name,...promotion}));
    }finally{await context.close();}
  }finally{await browser.close();}
}
