import {doc,setDoc,getDocFromServer} from 'firebase/firestore';
import {waitForMigrationOutcome} from './spark-migration-progress.mjs';
import '../qa-spark-migration-progress.mjs';
import {assert,identity,newAppContext,largeTenantData,stateDocument,accountAccess,seed,url,emulatorOwnerEmail,emulatorPassword} from './r38-emulator-support.mjs';
// Called inside the existing served-UI suite and emulator lifecycle. No separate
// runtime injection, financial replay or production project is involved.
export async function certifyDevicePreflight({browser,env,uid,label}){
  await env.clearFirestore();
  const data=largeTenantData(uid);data.products=data.products.slice(0,2);
  for(const key of ['sales','movements','cashSessions','dailyReports','auditLogs','layaways','notifications','labelPrintHistory'])data[key]=[];
  const envelope=stateDocument(uid,41,data),local=structuredClone(data);local.identity=identity(uid);
  for(const p of local.products)p.notes='p'.repeat(460000);
  await seed(env,async db=>{
    await setDoc(doc(db,`accountAccess/${uid}`),accountAccess(uid));
    await setDoc(doc(db,`businesses/${uid}/state/main`),envelope);
    await setDoc(doc(db,'storageRollout/sparkV1'),{enabled:true,automaticShadow:false,automaticRecoveryCopy:true,pilotOwnerUids:[uid]});
  });
  const context=await newAppContext(browser,{width:390,height:844});
  try{
    let page=await context.newPage();page.setDefaultTimeout(60000);await page.goto(url,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!window.click360Auth?.signInWithEmailAndPassword&&!!window.CLICK360_V16_STORAGE);
    const tenant={...identity(uid),authUid:uid};
    await page.evaluate(async({tenant,local})=>{
      await CLICK360_V16_STORAGE.putSnapshot(tenant,local,{source:'indexeddb_cache',deviceRevision:'p0d-42',baseRevision:41,revision:41,
        cloudCapacityBlocked:true,pendingRemoteSync:true,pendingOperations:['legacy-save-preserved']});
    },{tenant,local});
    await page.evaluate(({email,password})=>click360Auth.signInWithEmailAndPassword(email,password),{email:emulatorOwnerEmail,password:emulatorPassword});
    await page.waitForFunction(()=>window.click360DevicePreflight?.status==='DISABLED');
    const before=await page.evaluate(async({tenant})=>{
      const copy=click360SparkRecoveryCopy,manifest=await click360Db.doc(`businesses/${tenant.ownerUid}/recoveryCopies/${copy.captureHash}`).get({source:'server'});
      return {copy,buildSha:CLICK360_RELEASE_ASSETS['app.js'],deviceIdHash:await CLICK360_SPARK_MIGRATION.hash(manifest.data().deviceId),
        local:await CLICK360_V16_STORAGE.getSnapshot(tenant)};
    },{tenant});
    await seed(env,db=>setDoc(doc(db,`businesses/${uid}/recoveryPreflightPolicy/main`),{enabled:true,ownerUid:uid,
      buildSha:before.buildSha,baselineCaptureHash:before.copy.captureHash,baselineSourceHash:before.copy.sourceHash,
      deviceIdHash:before.deviceIdHash,businessIds:[uid]}));
    // An installed PWA can resume while Auth and connectivity stay unchanged.
    // Exercise the real lifecycle listener, not reload or a direct coordinator.
    await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForFunction(()=>window.click360DevicePreflight?.status==='CLIENT_PREFLIGHT_READY');
    before.local=await page.evaluate(async({tenant})=>{
      const record=await CLICK360_V16_STORAGE.getSnapshot(tenant),snapshot=structuredClone(record.snapshot);
      snapshot.products[0].name='Cambio local después de la copia inicial';
      const {snapshot:ignored,...metadata}=record;
      await CLICK360_V16_STORAGE.putSnapshot(tenant,snapshot,{...metadata,
        expectedDeviceRevision:record.deviceRevision,deviceRevision:'p0d-foreground-43'});
      window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
      return CLICK360_V16_STORAGE.getSnapshot(tenant);
    },{tenant});
    await page.waitForFunction(old=>window.click360DevicePreflight?.status==='CLIENT_PREFLIGHT_READY'
      &&window.click360DevicePreflight.sourceHash!==old,before.copy.sourceHash);
    let first;
    for(let pass=0;pass<2;pass++){
      await page.close();page=await context.newPage();page.setDefaultTimeout(60000);await page.goto(url,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.click360DevicePreflight?.status==='CLIENT_PREFLIGHT_READY'||window.click360DevicePreflight?.status==='BLOCKED');
      const proof=await page.evaluate(async({uid,tenant})=>{
        const result=click360DevicePreflight;if(result.status!=='CLIENT_PREFLIGHT_READY')throw Error(JSON.stringify(result));
        const report=await click360Db.doc(`businesses/${uid}/recoveryPreflights/${result.reportId}`).get({source:'server'});
        if(report.metadata.fromCache||report.data().sourceHash!==report.data().reconstructedHash||report.data().changedRecords!==1)throw Error('P0D_TEST_REPORT_INVALID');
        if(window.click360SparkOperationalSession||(await click360Db.doc(`businesses/${uid}/metadata/storage`).get({source:'server'})).exists)throw Error('P0D_TEST_WRITER_ACTIVATED');
        return {reportId:result.reportId,report:report.data(),local:await CLICK360_V16_STORAGE.getSnapshot(tenant)};
      },{uid,tenant});
      assert(JSON.stringify(proof.local)===JSON.stringify(before.local),'Automatic preflight cannot change the durable source');
      if(first)assert(JSON.stringify(proof.report)===JSON.stringify(first.report),'Restart reuses the immutable receipt');first=proof;
    }
    await seed(env,async db=>assert(JSON.stringify((await getDocFromServer(doc(db,`businesses/${uid}/state/main`))).data())===JSON.stringify(envelope)));
    console.log(JSON.stringify({stage:'AUTOMATIC_DEVICE_PREFLIGHT_PASS',browser:label,sourceHash:first.report.sourceHash,
      reconstructedHash:first.report.reconstructedHash,sourceAndJournalPreserved:true,coldRestart:true,idempotent:true,commercialWrites:0,cutover:false}));
  }finally{await context.close();}
}
export async function certifyRecoveryCopy({browser,env,uid,label}){
  await env.clearFirestore();
  const data=largeTenantData(uid);
  data.products=data.products.slice(0,3);
  for(const key of ['sales','movements','cashSessions','dailyReports','auditLogs','notifications','labelPrintHistory'])data[key]=[];
  const second=`recovery-second-${uid}`;
  data.businesses.push({id:second,name:'Segundo negocio protegido',type:'ropa',status:'activo',settings:{}});
  const envelope=stateDocument(uid,41,data),local=structuredClone(data);local.identity=identity(uid);
  for(const p of local.products)p.notes='x'.repeat(300000)+'🙂';
  local.products[0].stock--;local.products[0].qty--;
  local.sales.push({id:'local-recovery-sale',businessId:uid,total:30,date:'2026-09-03'});
  await seed(env,async db=>{
    await setDoc(doc(db,`accountAccess/${uid}`),accountAccess(uid));
    await setDoc(doc(db,`businesses/${uid}/state/main`),envelope);
    await setDoc(doc(db,'storageRollout/sparkV1'),{enabled:true,automaticShadow:false,automaticRecoveryCopy:true,pilotOwnerUids:[uid]});
  });
  const context=await newAppContext(browser,{width:390,height:844});
  try{
    let page=await context.newPage();await page.goto(url,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!window.click360Auth?.signInWithEmailAndPassword&&!!window.CLICK360_V16_STORAGE);
    const tenant={...identity(uid),authUid:uid};
    const before=await page.evaluate(async({tenant,local,second})=>{
      await CLICK360_V16_STORAGE.putSnapshot(tenant,local,{source:'indexeddb_cache',deviceRevision:'recovery-42',
        baseRevision:41,revision:41,cloudCapacityBlocked:true,pendingRemoteSync:true,pendingOperations:['capacity-persist-id']});
      const journal=await CLICK360_MODULAR_JOURNAL.open();
      for(let i=0;i<101;i++)await journal.enqueue({ownerUid:tenant.ownerUid,businessId:i===100?second:tenant.ownerUid},`capture-${i}`,
        {actorUid:tenant.ownerUid,kind:'retained-unknown-command',sequence:i});
      const row=await journal.claim({ownerUid:tenant.ownerUid,businessId:second},'capture-100','old-device');
      await journal.markUnknown({ownerUid:tenant.ownerUid,businessId:second},'capture-100',row.revision);
      const captured=await journal.captureOwner(tenant.ownerUid);journal.close();
      return {record:await CLICK360_V16_STORAGE.getSnapshot(tenant),journal:captured};
    },{tenant,local,second});
    // Lose exactly one response AFTER a real Firestore transaction committed
    // the first fragment batch. No fake successful server evidence is supplied.
    await page.evaluate(()=>{
      const original=click360Db.runTransaction.bind(click360Db);let commits=0;
      click360Db.runTransaction=async(...args)=>{
        const result=await original(...args);
        if(++commits===2){window.RECOVERY_RESPONSE_LOST_INJECTED=true;throw Object.assign(Error('SYNTHETIC_RECOVERY_RESPONSE_LOST'),{code:'unavailable'});}
        return result;
      };
    });
    await page.evaluate(({email,password})=>click360Auth.signInWithEmailAndPassword(email,password),{email:emulatorOwnerEmail,password:emulatorPassword});
    await page.waitForFunction(()=>window.RECOVERY_RESPONSE_LOST_INJECTED&&window.click360SparkRecoveryCopy?.reason==='unavailable');
    const interruptedHash=await page.evaluate(()=>click360SparkMigrationState.captureHash);
    await seed(env,async db=>{
      const m=(await getDocFromServer(doc(db,`businesses/${uid}/recoveryCopies/${interruptedHash}`))).data();
      assert(m?.state==='UPLOADING','An uncertain fragment response must never mark a partial copy verified');
    });
    await page.close();page=await context.newPage();await page.goto(url,{waitUntil:'domcontentloaded'});
    const verify=async()=>{
      try{
        await page.waitForFunction(()=>{
          if(window.click360SparkBootstrapState?.phase==='BLOCKED')throw Error(window.click360SparkBootstrapState.reason);
          return window.click360SparkMigrationState?.phase==='RECOVERY_COPY_CLIENT_VERIFIED';
        },null,{timeout:60000});
      }catch(error){
        console.log(JSON.stringify({stage:'RECOVERY_COPY_DIAGNOSTIC',browser:label,
          state:await page.evaluate(()=>({bootstrap:window.click360SparkBootstrapState,progress:window.click360SparkMigrationState}))}));
        throw error;
      }
      return page.evaluate(async({tenant,before})=>{
        const copy=click360SparkMigrationState;
        if(copy.operationalCloudConfirmed!==false||window.click360SparkOperationalSession)throw Error('RECOVERY_COPY_FALSE_OPERATIONAL_SYNC');
        const journal=await CLICK360_MODULAR_JOURNAL.open(),after=await journal.captureOwner(tenant.ownerUid);journal.close();
        if(JSON.stringify(after)!==JSON.stringify(before.journal)
          ||JSON.stringify(await CLICK360_V16_STORAGE.getSnapshot(tenant))!==JSON.stringify(before.record))throw Error('RECOVERY_COPY_SOURCE_MUTATED');
        const path=`businesses/${tenant.ownerUid}/recoveryCopies/${copy.captureHash}`;
        const manifest=await click360Db.doc(path).get({source:'server'});
        const parts=await click360Db.collection(`${path}/parts`).orderBy('position').get({source:'server'});
        if(manifest.metadata.fromCache||parts.metadata.fromCache||manifest.data().state!=='CLIENT_VERIFIED')throw Error('RECOVERY_COPY_NOT_REMOTE');
        const reconstructed=JSON.parse(parts.docs.map(d=>d.data().content).join(''));
        if(await CLICK360_SPARK_MIGRATION.hash(reconstructed)!==copy.captureHash
          ||await CLICK360_SPARK_MIGRATION.hash(reconstructed.record)!==await CLICK360_SPARK_MIGRATION.hash(before.record)
          ||JSON.stringify(reconstructed.journalCapture)!==CLICK360_SPARK_MIGRATION.canonicalJson(before.journal))throw Error('RECOVERY_COPY_HASH_MISMATCH');
        const control=await click360Db.doc(`businesses/${tenant.ownerUid}/metadata/storage`).get({source:'server'});
        if(control.exists)throw Error('RECOVERY_COPY_ACTIVATED_FENCE');
        return {captureHash:copy.captureHash,sourceHash:copy.sourceHash,journalHash:copy.journalHash,partCount:copy.partCount,
          pending:reconstructed.journalCapture.rows.filter(r=>r.state==='queued').length,
          unknown:reconstructed.journalCapture.rows.filter(r=>r.state==='unknown').length};
      },{tenant,before});
    };
    const copy=await verify();await page.close();page=await context.newPage();await page.goto(url,{waitUntil:'domcontentloaded'});
    const resumed=await verify();assert(copy.captureHash===resumed.captureHash,'Cold resume must reuse the immutable capture');
    assert(copy.captureHash===interruptedHash,'A lost reply must resume the original capture, not upload a second generation');
    const partPath=`businesses/${uid}/recoveryCopies/${copy.captureHash}/parts/p0`;let originalPart;
    await seed(env,async db=>{
      originalPart=(await getDocFromServer(doc(db,partPath))).data();
      await setDoc(doc(db,partPath),{...originalPart,content:originalPart.content+'corrupted'});
    });
    try{
      const rejected=await page.evaluate(async({uid,captureHash})=>{
        const r=await CLICK360_P0A_RECOVERY.open({ownerUid:uid,resolveUser:()=>click360Auth.currentUser});
        try{await r.preserveCloud({captureHash,db:click360Db,firebase,projectId:click360Db.app.options.projectId,assertStable:async()=>{}});return {denied:false,reason:'unexpected_success'};}
        catch(error){return {denied:error.message==='SPARK_RECOVERY_REMOTE_PART_CONFLICT',reason:String(error.code||error.message)};}finally{r.close();}
      },{uid,captureHash:copy.captureHash});
      assert(rejected.denied,'A previously client-verified flag cannot hide a corrupt fragment on independent re-verification: '+rejected.reason);
    }finally{await seed(env,db=>setDoc(doc(db,partPath),originalPart));}
    await seed(env,async db=>assert(JSON.stringify((await getDocFromServer(doc(db,`businesses/${uid}/state/main`))).data())===JSON.stringify(envelope)));
    console.log(JSON.stringify({stage:'RECOVERY_COPY_CLIENT_VERIFIED',browser:label,...copy,coldRestart:true,
      interruptedResume:true,lostResponseNoNewGeneration:true,corruptPartRejected:true,legacyUnchanged:true,operationalCloudConfirmed:false,cutover:false}));
  }finally{await context.close();}
}
export async function certifyShadowPreparation({browser,env,uid,label}){
  await env.clearFirestore();
  const data=largeTenantData(uid);data.sales=[];data.movements=[];data.cashSessions=[];data.dailyReports=[];data.auditLogs=[];
  const second=`shadow-second-${uid}`;
  data.businesses.push({id:second,name:'Segundo negocio preservado',type:'ropa',status:'activo',settings:{}});
  data.products.push({id:'second-product',businessId:second,stock:7,qty:7,price:5,cost:1});
  const envelope=stateDocument(uid,41,data),local=structuredClone(data);
  for(const product of local.products)if(product.businessId===uid)product.notes='x'.repeat(1900);
  local.products[0].stock--;local.products[0].qty--;
  const sessionId='local-historical-session';
  local.cashSessions.push({id:sessionId,operationId:'local-opening',businessId:uid,
    date:'2026-09-03',businessDate:'2026-09-03',status:'open',openingAmount:0});
  local.sales.push({id:'local-historical-sale',operationId:'local-historical-sale',businessId:uid,cashSessionId:sessionId,
    date:'2026-09-03',businessDate:'2026-09-03',total:30,received:30,iva:0,method:'Transferencia',
    items:[{id:local.products[0].id,qty:1,price:30}]});
  local.movements.push({id:'local-opening',operationId:'local-opening',businessId:uid,
    cashSessionId:sessionId,date:'2026-09-03',kind:'apertura',amount:0},
    {id:'local-historical-movement',operationId:'local-historical-sale',businessId:uid,
      cashSessionId:sessionId,saleId:'local-historical-sale',date:'2026-09-03',kind:'ingreso',
      paymentType:'sale',paymentMethod:'Transferencia',amount:30});
  local.identity=identity(uid);
  const cashProof=await CLICK360_SPARK_MIGRATION.deriveCashSummaries({snapshot:local,businessId:uid});
  assert(cashProof.canProceed,'The served shadow fixture must contain a financially provable historical session');
  const sourceHash=await CLICK360_SPARK_MIGRATION.hash(local);
  assert(CLICK360_SPARK_MIGRATION.byteLength(local)>850000,'Oversized durable device source required');
  await seed(env,async db=>{
    await setDoc(doc(db,`accountAccess/${uid}`),accountAccess(uid));
    await setDoc(doc(db,`businesses/${uid}/state/main`),envelope);
    await setDoc(doc(db,'storageRollout/sparkV1'),{enabled:true,automaticShadow:true,pilotOwnerUids:[uid]});
  });
  const context=await newAppContext(browser,{width:390,height:844});
  await context.addInitScript(()=>{
    const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){
      if(String(key).startsWith('CLICK360:V16:DEVICE:'))throw new DOMException('Synthetic device-id quota failure','QuotaExceededError');
      return original.call(this,key,value);
    };
  });
  try{
    let page=await context.newPage();await page.goto(url,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!window.click360Auth?.signInWithEmailAndPassword&&!!window.CLICK360_V16_STORAGE);
    const tenant={...identity(uid),authUid:uid};
    const before=await page.evaluate(async({tenant,local})=>{
      await CLICK360_V16_STORAGE.putSnapshot(tenant,local,{source:'indexeddb_cache',deviceRevision:'device-newer-42',
        baseRevision:41,revision:41,cloudCapacityBlocked:true,pendingRemoteSync:true,pendingOperations:['legacy-capacity-save']});
      return CLICK360_V16_STORAGE.getSnapshot(tenant);
    },{tenant,local});
    // Diagnose the actual client transport rather than treating a deadline as
    // successful migration. No query, source, Rules or timeout is substituted.
    await page.evaluate(()=>{
      window.QA_SHADOW_QUERY_TIMINGS=[];
      window.QA_SHADOW_PHASE_TIMINGS=[];
      const startedAt=performance.now();
      let current=window.click360SparkMigrationState;
      Object.defineProperty(window,'click360SparkMigrationState',{configurable:true,
        get:()=>current,set:value=>{
          current=value;
          window.QA_SHADOW_PHASE_TIMINGS.push({elapsedMs:Math.round(performance.now()-startedAt),...value});
        }});
      const original=firebase.firestore.Query.prototype.get;
      firebase.firestore.Query.prototype.get=async function(...args){
        const started=performance.now();
        try{
          const result=await original.apply(this,args);
          window.QA_SHADOW_QUERY_TIMINGS.push({durationMs:Math.round(performance.now()-started),rows:result.size,fromCache:result.metadata.fromCache});
          return result;
        }catch(error){window.QA_SHADOW_QUERY_TIMINGS.push({durationMs:Math.round(performance.now()-started),error:String(error.code||error.message)});throw error;}
      };
    });
    await page.evaluate(({email,password})=>click360Auth.signInWithEmailAndPassword(email,password),{email:emulatorOwnerEmail,password:emulatorPassword});
    // UID belongs to the default emulator owner created by the parent suite.
    try{
      await waitForMigrationOutcome(page,{expectedReason:'SPARK_BOOTSTRAP_SHADOW_VERIFIED_CUTOVER_DISABLED'});
    }catch(error){
      console.log(JSON.stringify({stage:'SHADOW_PREPARATION_DIAGNOSTIC',browser:label,
        state:await page.evaluate(()=>({bootstrap:window.click360SparkBootstrapState,progress:window.click360SparkMigrationState,
          queryTimings:window.QA_SHADOW_QUERY_TIMINGS,
          phaseTimings:window.QA_SHADOW_PHASE_TIMINGS,
          gate:document.querySelector('#click360-auth-gate')?.textContent?.slice(0,300)}))}));
      throw error;
    }
    const verify=async()=>{
      const after=await page.evaluate(tenant=>CLICK360_V16_STORAGE.getSnapshot(tenant),tenant);
      assert(JSON.stringify(after)===JSON.stringify(before),'Shadow preparation must preserve the complete original IDB record');
      const state=await page.evaluate(()=>({session:!!window.click360SparkOperationalSession,cloud:window.click360SparkBootstrapState.operationalCloudConfirmed}));
      assert(!state.session&&!state.cloud,'Shadow must never install a writer or claim operational sync');
      await seed(env,async db=>{
        const c=(await getDocFromServer(doc(db,`businesses/${uid}/metadata/storage`))).data();
        assert(c.phase==='READY_TO_CUTOVER'&&c.storageMode==='migrating'&&c.semanticEquality==='PASS');
        assert(c.sourceHash===sourceHash&&c.reconstructedHash===sourceHash);
        assert(c.businessIds.length===2&&c.businessIds.includes(second));
        assert(JSON.stringify((await getDocFromServer(doc(db,`businesses/${uid}/state/main`))).data())===JSON.stringify(envelope));
      });
    };
    await verify();await page.close();page=await context.newPage();await page.goto(url,{waitUntil:'domcontentloaded'});
    await waitForMigrationOutcome(page,{expectedReason:'SPARK_BOOTSTRAP_SHADOW_VERIFIED_CUTOVER_DISABLED'});
    await verify();
    console.log(JSON.stringify({stage:'CONNECTED_SHADOW_PREPARATION_PASS',browser:label,sourceHash,reconstructedHash:sourceHash,
      localBytes:CLICK360_SPARK_MIGRATION.byteLength(local),businesses:2,localHistoricalSalePreserved:true,
      coldRestartResume:true,legacyUnchanged:true,cutover:false,productionWrites:0}));
  }finally{await context.close();}
}
