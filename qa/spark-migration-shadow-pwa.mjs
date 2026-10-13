import {doc,setDoc,getDocFromServer} from 'firebase/firestore';
import {assert,identity,newAppContext,largeTenantData,stateDocument,accountAccess,seed,url,emulatorOwnerEmail,emulatorPassword} from './r38-emulator-support.mjs';
// Called inside the existing served-UI suite and emulator lifecycle. No separate
// runtime injection, financial replay or production project is involved.
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
  local.cashSessions.push({id:sessionId,businessId:uid,businessDate:'2026-09-03',status:'open'});
  local.sales.push({id:'local-historical-sale',operationId:'local-historical-sale',businessId:uid,cashSessionId:sessionId,
    businessDate:'2026-09-03',total:30,items:[{id:local.products[0].id,qty:1,price:30}]});
  local.movements.push({id:'local-historical-movement',businessId:uid,cashSessionId:sessionId,saleId:'local-historical-sale',amount:30});
  local.identity=identity(uid);
  const sourceHash=await CLICK360_SPARK_MIGRATION.hash(local);
  assert(CLICK360_SPARK_MIGRATION.byteLength(local)>850000,'Oversized durable device source required');
  await seed(env,async db=>{
    await setDoc(doc(db,`accountAccess/${uid}`),accountAccess(uid));
    await setDoc(doc(db,`businesses/${uid}/state/main`),envelope);
    await setDoc(doc(db,'storageRollout/sparkV1'),{enabled:true,automaticShadow:true,pilotOwnerUids:[uid]});
  });
  const context=await newAppContext(browser,{width:390,height:844});
  try{
    let page=await context.newPage();await page.goto(url,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!window.click360Auth?.signInWithEmailAndPassword&&!!window.CLICK360_V16_STORAGE);
    const tenant={...identity(uid),authUid:uid};
    const before=await page.evaluate(async({tenant,local})=>{
      await CLICK360_V16_STORAGE.putSnapshot(tenant,local,{source:'indexeddb_cache',deviceRevision:'device-newer-42',
        baseRevision:41,revision:41,cloudCapacityBlocked:true,pendingRemoteSync:true,pendingOperations:['legacy-capacity-save']});
      return CLICK360_V16_STORAGE.getSnapshot(tenant);
    },{tenant,local});
    await page.evaluate(({email,password})=>click360Auth.signInWithEmailAndPassword(email,password),{email:emulatorOwnerEmail,password:emulatorPassword});
    // UID belongs to the default emulator owner created by the parent suite.
    try{
      await page.waitForFunction(()=>window.click360SparkBootstrapState?.phase==='BLOCKED'
        &&window.click360SparkBootstrapState.reason==='SPARK_BOOTSTRAP_SHADOW_VERIFIED_CUTOVER_DISABLED',null,{timeout:60000});
    }catch(error){
      console.log(JSON.stringify({stage:'SHADOW_PREPARATION_DIAGNOSTIC',browser:label,
        state:await page.evaluate(()=>({bootstrap:window.click360SparkBootstrapState,progress:window.click360SparkMigrationState,
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
    await page.waitForFunction(()=>window.click360SparkBootstrapState?.reason==='SPARK_BOOTSTRAP_SHADOW_VERIFIED_CUTOVER_DISABLED',null,{timeout:60000});
    await verify();
    console.log(JSON.stringify({stage:'CONNECTED_SHADOW_PREPARATION_PASS',browser:label,sourceHash,reconstructedHash:sourceHash,
      localBytes:CLICK360_SPARK_MIGRATION.byteLength(local),businesses:2,localHistoricalSalePreserved:true,
      coldRestartResume:true,legacyUnchanged:true,cutover:false,productionWrites:0}));
  }finally{await context.close();}
}
