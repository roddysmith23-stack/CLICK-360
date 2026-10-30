import assert from 'node:assert/strict';
import {newAppContext,url,emulatorOwnerEmail,emulatorPassword} from './r38-emulator-support.mjs';
// Existing served PWA, Auth SDK, Firestore SDK and Rules. Faults are confined
// to this synthetic browser's read/identity boundary, never server data.
export async function certifyStartupAuth({browser,uid,label,output}){
 for(const scenario of ['pending_account_read','identity_exception']){
  const context=await newAppContext(browser,{width:390,height:844});
  try{
   const page=await context.newPage();await page.goto(url,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.click360Auth&&window.click360SetTenantContext&&window.CLICK360_RELEASE_ASSETS);
   await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
   await page.evaluate(({uid,scenario})=>{
    if(scenario==='pending_account_read'){
     const ref=click360Db.doc(`accountAccess/${uid}`),proto=Object.getPrototypeOf(ref),get=proto.get;
     let held=true;window.QA_ACCOUNT_READS=0;
     proto.get=function(options){
      if(this.path===ref.path&&held){window.QA_ACCOUNT_READS++;return new Promise((resolve,reject)=>{
       window.QA_RELEASE_ACCOUNT=()=>{held=false;get.call(this,options).then(resolve,reject);};});}
      return get.call(this,options);
     };
    }else{
     const original=click360SetTenantContext;
     window.click360SetTenantContext=(context,...args)=>{
      if(context?.authUid===uid)throw Object.assign(Error('synthetic-identity-failed'),{code:'identity-setup-failed'});
      return original(context,...args);
     };
    }
   },{uid,scenario});
   await page.evaluate(({email,password})=>click360Auth.signInWithEmailAndPassword(email,password),
    {email:emulatorOwnerEmail,password:emulatorPassword});
   if(scenario==='pending_account_read'){
    await page.waitForFunction(()=>window.click360StartupDiagnostic?.phase==='WAITING',null,{timeout:25000});
    assert.match(await page.locator('#c360-startup-support').innerText(),/STARTUP_WAIT_ACCOUNT_SERVER_READ/);
    assert.equal(await page.evaluate(()=>!!window.click360SparkOperationalSession),false);
    assert.equal(await page.evaluate(()=>QA_ACCOUNT_READS),1,'No retry/polling while the original read is pending');
    await page.screenshot({path:`${output}/startup-${label}-waiting.png`});
    await page.evaluate(()=>QA_RELEASE_ACCOUNT());
    await page.waitForFunction(()=>click360SparkBootstrapState?.phase==='READY'&&window.click360SparkOperationalSession);
    assert.equal(await page.evaluate(()=>click360StartupDiagnostic.phase),'READY');
    assert.equal(await page.evaluate(()=>click360SparkBootstrapState.operationalCloudConfirmed),true);
    assert(await page.evaluate(()=>click360GetTenantState().products.length>0));
   }else{
    await page.waitForFunction(()=>window.click360StartupDiagnostic?.phase==='FAILED');
    assert.match(await page.locator('#c360-startup-support').innerText(),/STARTUP_APPLY_IDENTITY_identity-setup-failed/);
    assert.equal(await page.evaluate(()=>click360AccessUiState.state),'recoverable_error');
    assert.equal(await page.evaluate(()=>!!window.click360SparkOperationalSession),false);
    await page.screenshot({path:`${output}/startup-${label}-identity-failed.png`});
   }
   console.log(JSON.stringify({status:'AUTHENTICATED_STARTUP_DIAGNOSTIC_PASS',browser:label,scenario,
    stageVisibleWithoutInspector:true,noTimedRetry:true,noEarlyWriter:true,productionWrites:0}));
  }finally{await context.close();}
 }
}
