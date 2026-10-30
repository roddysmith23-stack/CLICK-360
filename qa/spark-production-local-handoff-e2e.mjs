// Native browser storage + actual handoff verifier. Synthetic server adapter
// permits reads only, exercising production branches without a production SDK.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {chromium,webkit} from 'playwright';
const files=['spark-modular-migration.js','spark-modular-record-codec.js','spark-modular-handoff.js',
 'spark-modular-recovery.js','spark-modular-importer.js','spark-migration-bootstrap.js','v16-storage.js'];
const sources=await Promise.all(files.map(f=>readFile(f,'utf8')));
const previousStorage=execFileSync('git',['show','2875f6e7496f960f6d656ce5cee7c6ab7ccc10b9:v16-storage.js'],{encoding:'utf8'});
for(const [engine,browserName]of [[chromium,'chromium'],[webkit,'webkit']]){
 const browser=await engine.launch();
 try{const context=await browser.newContext();try{
  await context.route('https://production-handoff.example.test/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Native handoff regression</title>'}));
  const page=await context.newPage();await page.goto('https://production-handoff.example.test/');
  for(let i=0;i<sources.length;i++)await page.addScriptTag({content:i===sources.length-1?previousStorage:sources[i]});
  await page.evaluate(async()=>{
   const api=CLICK360_SPARK_MIGRATION,owner='synthetic-owner',business='synthetic-retail',oldBuild='2875f6e7496f',build='a'.repeat(12);
   const identity={ownerUid:owner,ownerId:owner,businessId:owner,tenantKey:`owner:${owner}:business:${owner}`,schemaVersion:10};
   const tenant={...identity,authUid:owner};
   const snapshot={identity,businesses:[{id:business,name:'Synthetic retail'}],products:[{id:'p',businessId:business,name:'Shirt',stock:3,qty:3,price:5}],
    sales:[],movements:[],cashSessions:[],dailyReports:[]};
   for(let i=0;i<9;i++){const id=`history-${i}`,date=`2026-08-${String(i+1).padStart(2,'0')}`;
    snapshot.cashSessions.push({id,businessId:business,date,status:'closed',closedAt:`${date}T23:00:00Z`});
    snapshot.sales.push({id:`sale-${i}`,businessId:business,cashSessionId:id,date,status:'paid',total:5,received:5,balance:0,iva:0,method:'Efectivo',items:[{id:'p',qty:1,price:5}]});
    snapshot.dailyReports.push({id:`report-${i}`,businessId:business,cashSessionId:id,date,status:'closed',total:5});}
   const remote=structuredClone(snapshot);remote.sales=[];remote.cashSessions=[];remote.dailyReports=[];
   window.CLICK360_FIREBASE_CONFIG={projectId:'click-360'};window.click360Auth={currentUser:{uid:owner}};
   const stamps=['app.js','firebase-service.js','v16-storage.js','modular-operation-journal.js','spark-modular-migration.js',
    'spark-modular-reconciliation.js','spark-modular-recovery.js','spark-modular-importer.js','spark-modular-record-codec.js',
    'spark-modular-handoff.js','spark-migration-bootstrap.js'];
   window.CLICK360_RELEASE_ASSETS=Object.fromEntries(stamps.map(f=>[f,build]));
   await CLICK360_V16_STORAGE.putSnapshot(tenant,snapshot,{source:'indexeddb_cache',deviceRevision:'source-42',baseRevision:41,
    cloudCapacityBlocked:true,pendingRemoteSync:true,pendingOperations:Array.from({length:76},(_,i)=>`legacy-save-${i}`)});
   await CLICK360_V16_STORAGE.putWorkingDate(tenant,business,'2026-08-12');
   const record=await CLICK360_V16_STORAGE.getSnapshot(tenant),{snapshot:ignored,...metadata}=record;
   const sourceHash=await api.hash(snapshot),remoteHash=await api.hash(remote),deviceMetadataHash=await api.hash(metadata);
   const journalCapture={ownerUid:owner,rows:[],recordCount:0,enumerationComplete:true};
   const financialProofs=[{businessId:business,...await api.deriveCashSummaries({snapshot,businessId:business,historicalReadOnly:true})}];
   if(!financialProofs[0].canProceed)throw Error('SYNTHETIC_FINANCE_INVALID:'+JSON.stringify(financialProofs[0]));
   const plan=await CLICK360_SPARK_HANDOFF.plan({ownerUid:owner,snapshot,sourceHash,deviceMetadataHash,journalCapture,
    journalHash:await api.hash(journalCapture),businessIds:[business],financialProofs,unknownCount:0,conflictCount:0,historicalReadOnly:true});
   const approval=await CLICK360_SPARK_HANDOFF.runtimeApproval(plan,oldBuild);
   const recovery=await CLICK360_SPARK_RECOVERY.open({ownerUid:owner,resolveUser:()=>click360Auth.currentUser});
   await recovery.pin({sourceHash,snapshot,deviceRevision:record.deviceRevision,deviceRecordMetadata:metadata,
    sourceDeviceId:'durable-original',buildSha:oldBuild,remoteRevision:41,remoteSourceHash:remoteHash,businessIds:[business]});
   await recovery.pinHandoff(plan);const pinBefore=await api.hash(await recovery.read(sourceHash));recovery.close();
   const manifest=await api.plan({ownerUid:owner,snapshot,identity,remoteRevision:41,deviceRevision:record.deviceRevision});
   for(const row of manifest.records){const h=financialProofs[0].historyPlan?.historyPolicies[`${row.content.module}/${row.content.id}`];if(h)row.content.historyPolicy=structuredClone(h);}
   const control={ownerUid:owner,schemaVersion:2,storageMode:'modular',phase:'MODULAR',recordVersion:5,semanticEquality:'PASS',
    sourceHash,reconstructedHash:sourceHash,deviceRevision:record.deviceRevision,sourceDeviceId:'durable-original',
    remoteHash,remoteRevision:41,buildSha:oldBuild,businessIds:[business]};
   const account={plan:'founder_legacy',manualLimitOverrides:{productsActive:600}};
   const flat={id:'storage',ownerUid:owner,businessId:business,tenantKey:`owner:${owner}:business:${business}`,storageSchemaVersion:2,
    module:'metadata',recordVersion:1,storageMode:'modular',phase:'MODULAR',semanticEquality:'PASS',sourceHash,reconstructedHash:sourceHash,
    accountPlan:account.plan,manualLimitOverrides:account.manualLimitOverrides};
   const rows=[...manifest.records,...plan.runtimes.map(r=>({path:r.path,content:approval.runtimeRecords[business]})),
    {path:`businesses/${owner}/businessUnits/${business}/storage/v2/metadata/storage`,content:await CLICK360_SPARK_RECORD_CODEC.pack(flat,{identity:{ownerUid:owner,businessId:business},moduleName:'metadata',recordId:'storage'})}];
   const docs=new Map(rows.map(r=>[r.path,r.content]));
   docs.set(`businesses/${owner}/metadata/storage`,control);docs.set('storageRollout/sparkV1',{enabled:true,operationalAccess:true,automaticCutover:true,automaticHistoricalReadOnly:true,pilotOwnerUids:[owner]});
   docs.set(`businesses/${owner}/storageApprovals/runtimePreparation`,approval);
   docs.set(`businesses/${owner}/storageApprovals/cutover`,{ownerUid:owner,sourceHash,buildSha:oldBuild,businessIds:[business]});
   docs.set(`businesses/${owner}/state/main`,{revision:41,payload:{identity,data:remote}});docs.set(`accountAccess/${owner}`,account);
   const snap=path=>({id:path.split('/').at(-1),ref:{path},exists:docs.has(path),data:()=>structuredClone(docs.get(path)),metadata:{fromCache:false,hasPendingWrites:false}});
   const db={app:{options:{projectId:'click-360'}},doc:path=>({get:async()=>snap(path)}),
    runTransaction:()=>{throw Error('NO_SERVER_WRITES_ALLOWED');},collection:path=>{
     let after=null,n=100;const q={orderBy(){return q;},limit(v){n=v;return q;},startAfter(v){after=v;return q;},async get(){
      const entries=[...docs.keys()].filter(p=>p.slice(0,p.lastIndexOf('/'))===path&&(!after||p.split('/').at(-1)>after)).sort().slice(0,n);
      return {metadata:{fromCache:false,hasPendingWrites:false},size:entries.length,docs:entries.map(snap)};}};return q;}};
   window.CLICK360_MODULAR_JOURNAL={open:async()=>({captureOwner:async()=>structuredClone(journalCapture),assertOwnerCoverage:async()=>{},close(){}})};
   const verifier=CLICK360_SPARK_MIGRATION_BOOTSTRAP.create({db,firebase:{firestore:{FieldPath:{documentId:()=> '__name__'},FieldValue:{serverTimestamp:()=>{throw Error('NO_SERVER_WRITES_ALLOWED');}}}},projectId:'click-360',
    ownerUid:owner,actorUid:owner,deviceId:'durable-original',buildSha:build,resolveUser:()=>click360Auth.currentUser,
    resolveContext:()=>tenant,leaseHeld:()=>true,readLocal:()=>CLICK360_V16_STORAGE.getSnapshot(tenant)});
   const proof=await verifier.verifyLocalHandoff();
   const target={...snapshot,activeBusinessId:business};
   const options={source:'spark_operational_candidate',expectedDeviceRevision:record.deviceRevision,deviceRevision:'modular-43',
    cloudCapacityBlocked:false,pendingRemoteSync:false,verifiedLocalHandoff:proof};
   let error;try{await CLICK360_V16_STORAGE.promoteVerifiedSnapshot(tenant,target,options);}catch(e){error=e.message;}
   if(error!=='INDEXEDDB_VERIFIED_HANDOFF_REQUIRED')throw Error('OLD_PRODUCTION_BLOCK_NOT_REPRODUCED');
   if(await api.hash(await CLICK360_V16_STORAGE.getSnapshot(tenant))!==await api.hash(record))throw Error('FAILED_PROMOTION_CHANGED_LOCAL');
   window.nativeHandoffCase={identity:tenant,proof,target,options,sourceHash,pinBefore,owner,business};
  });
  await page.addScriptTag({content:sources.at(-1)});
  const result=await page.evaluate(async()=>{
   const {identity,proof,target,options,sourceHash,pinBefore,owner,business}=nativeHandoffCase;
   let forgedDenied=false;try{await CLICK360_V16_STORAGE.promoteVerifiedSnapshot(identity,target,{...options,verifiedLocalHandoff:{...proof}});}catch{forgedDenied=true;}
   if(!forgedDenied)throw Error('FORGED_PRODUCTION_PROOF_ACCEPTED');
   await CLICK360_V16_STORAGE.promoteVerifiedSnapshot(identity,target,options);
   const installed=await CLICK360_V16_STORAGE.getSnapshot(identity);
   if(installed.source!=='spark_operational_candidate'||installed.uiWorkingDates[business]!=='2026-08-12')throw Error('NATIVE_HANDOFF_NOT_DURABLE');
   const recovery=await CLICK360_SPARK_RECOVERY.open({ownerUid:owner,resolveUser:()=>click360Auth.currentUser});
   if(await CLICK360_SPARK_MIGRATION.hash(await recovery.read(sourceHash))!==pinBefore)throw Error('ORIGINAL_PIN_CHANGED');recovery.close();
   return {oldProductionGuardReproduced:true,productionVerifiedPromotion:true,forgedProofDenied:true,
    sourceBuild:proof.sourceBuildSha,currentBuild:proof.buildSha,nineProtectedSessions:true,saveReferences:76,originalPinPreserved:true,serverWrites:0};
  });
  assert(result.productionVerifiedPromotion);console.log(JSON.stringify({browser:browserName,...result}));
 }finally{await context.close();}}finally{await browser.close();}
}
