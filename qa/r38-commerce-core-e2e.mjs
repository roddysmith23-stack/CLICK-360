// Real app + real Auth/Firestore emulators. No Firebase SDK mocks or remote tenant.
import {spawn} from 'node:child_process';
import {commerceFlows} from './r38-commerce-flows.mjs';
import {mkdirSync,writeFileSync,createWriteStream} from 'node:fs';
import path from 'node:path';
import {chromium,webkit} from 'playwright';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc} from 'firebase/firestore';
import {root,outputDir,port,firestorePort,authPort,projectId,javaDirs,url,rules,assert,stopProcessTree,waitForUrl,createEmulatorUser,seed,readCloud,openSignedIn,submitProduct,assertProduct,largeTenantData,stateDocument,accountAccess,writeEmulatorConfig} from './r38-emulator-support.mjs';
assert(projectId.startsWith('demo-'),'Emulator-only project required');
mkdirSync(outputDir,{recursive:true});
const results=[];
let testEnv,uid,activeDevice;
const cloud=()=>readCloud(testEnv,uid);
const {cloudUntil,sync,route,searchAndEdit,editStock,commerce}=commerceFlows({cloud,submitProduct,assertProduct,results,writePattern:`http://127.0.0.1:${firestorePort}/**`});
const emulatorConfig=writeEmulatorConfig();
const emulatorLog=createWriteStream(path.join(outputDir,'emulators-'+Date.now()+'.log'),{flags:'wx'});
const emulators=spawn(path.join(root,'node_modules/.bin/firebase'),['emulators:start','--only','firestore,auth','--project',projectId,'--config',emulatorConfig],{cwd:path.dirname(emulatorConfig),detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PATH:`${javaDirs.join(':')}:${process.env.PATH}`}});
emulators.stdout.pipe(emulatorLog);emulators.stderr.pipe(emulatorLog);
const server=spawn(process.execPath,[path.join(root,'node_modules/http-server/bin/http-server'),'.','-p',String(port),'-c-1'],{cwd:root,detached:true,stdio:'ignore'});
let browsers=[];
try{
  await Promise.race([
    (async()=>{await waitForUrl(`http://127.0.0.1:${firestorePort}/`,'Firestore');await waitForUrl(`http://127.0.0.1:${authPort}/`,'Auth');await waitForUrl(url,'HTTP');})(),
    new Promise((_,reject)=>emulators.once('exit',(code)=>reject(new Error('Emulators exited before ready: '+code))))
  ]);
  testEnv=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:firestorePort,rules}});uid=await createEmulatorUser();
  browsers=[await chromium.launch(),await webkit.launch()];
  for(const [browserIndex,browser]of browsers.entries())for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
    const label=`${browserIndex?'webkit':'chromium'}-${viewport.width}`;console.log('START '+label);
    if(process.env.R38_BROWSER_FILTER&&!label.includes(process.env.R38_BROWSER_FILTER))continue;
    const data=largeTenantData(uid);data.sales=[];data.movements=[];data.auditLogs=[];data.notifications=[];
    await seed(testEnv,async db=>{await setDoc(doc(db,'accountAccess',uid),accountAccess(uid));await setDoc(doc(db,'businesses',uid,'state','main'),stateDocument(uid,Date.now(),data));});
    let device=await openSignedIn(browser,viewport);activeDevice=device;
    await submitProduct(device.page,{code:'R38-CORE',name:'Producto R38 sintético',stock:10});
    const created=(await cloud()).payload.data.products.find(p=>p.code==='R38-CORE');assert(created,'create authoritative');
    await searchAndEdit(device.page,created.code,created.name);
    for(const stock of [17,25,31])await editStock(device.page,created,stock);
    console.log('PASS '+label+' authoritative stock 10→17→25→31');
    await editStock(device.page,created,30);
    await device.page.locator('#productSearch').fill(created.code);
    await device.page.locator('[data-edit="'+created.id+'"]').click();
    await device.context.setOffline(true);
    await device.page.locator('#pQty').fill('31');await device.page.locator('#productForm button[type="submit"]').click();
    await device.page.waitForFunction(id=>window.click360GetTenantState().products.some(p=>p.id===id&&p.stock===31&&p.qty===31),created.id);
    await device.page.locator('#productForm').waitFor({state:'detached'});
    assertProduct(await cloud(),created.id,30,'offline cannot mutate server');
    const offlineToast=await device.page.locator('#toast').innerText();assert(!/confirmado en la nube/.test(offlineToast),'offline is never falsely server-confirmed');
    await device.context.setOffline(false);
    await cloudUntil(data=>data.products.some(p=>p.id===created.id&&p.stock===31&&p.qty===31),'offline inventory converges online');
    await sync(device.page);
    console.log('PASS '+label+' decrease + offline→online');
    await device.context.close();device=await openSignedIn(browser,viewport);activeDevice=device;
    await device.page.waitForFunction(id=>window.click360GetTenantState().products.some(p=>p.id===id&&p.stock===31&&p.qty===31),created.id);
    const deviceB=await openSignedIn(browsers[1-browserIndex],viewport);
    await deviceB.page.waitForFunction(id=>window.click360GetTenantState().products.some(p=>p.id===id&&p.stock===31&&p.qty===31),created.id);
    assert(deviceB.pageErrors.length===0,'Device B errors: '+JSON.stringify(deviceB.pageErrors));await deviceB.context.close();
    await commerce(device.page,label);
    await device.page.screenshot({path:path.join(outputDir,label+'.png')});
    assert(device.pageErrors.length===0,'Unexpected browser errors '+JSON.stringify(device.pageErrors));await device.context.close();
    console.log('PASS '+label);
  }
  writeFileSync(path.join(outputDir,'results.json'),JSON.stringify({status:'PASS',source:'real app + Auth/Firestore emulators',results},null,2));
  console.log('R38 commercial core browser matrix PASS '+JSON.stringify(results));
}catch(error){
  if(activeDevice?.page&&!activeDevice.page.isClosed()){
    const diagnostic=await activeDevice.page.evaluate(()=>({search:document.querySelector('#productSearch')?.value,cards:document.querySelectorAll('#productList [data-pid]').length,searchTrace:window.R38_SEARCH_TRACE,toast:document.querySelector('#toast')?.textContent,sync:window.click360SyncStatus,gate:window.click360WriteGate?.(),confirmation:window.CLICK360_LAST_CONFIRMATION_DIAGNOSTICS,product:window.click360GetTenantState?.()?.products?.find(p=>p.code==='R38-CORE'),modal:document.querySelector('#modalRoot')?.innerText})).catch(()=>null);
    const syncTrace=await activeDevice.page.evaluate(()=>window.R38_SYNC_TRACE).catch(()=>null);
    const authoritative=await cloud().then(d=>({revision:d.revision,products:d.payload.data.products.length,product:d.payload.data.products.find(p=>p.code==='R38-CORE')})).catch(()=>null);
    writeFileSync(path.join(outputDir,'failure-'+Date.now()+'.json'),JSON.stringify({error:error.message,diagnostic,syncTrace,authoritative},null,2));
  }
  throw error;
}finally{for(const browser of browsers)await browser.close().catch(()=>{});await testEnv?.cleanup().catch(()=>{});stopProcessTree(server);stopProcessTree(emulators);}
