// Served staging application + REAL demo Auth/Firestore emulators. No production transport.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {request} from 'node:http';
import {createServer} from 'node:https';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium,webkit} from 'playwright';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc} from 'firebase/firestore';
import {root,port,firestorePort,authPort,projectId,javaDirs,url,rules,stopProcessTree,waitForUrl,createEmulatorUser,seed,readCloud,openSignedIn,largeTenantData,stateDocument,accountAccess,writeEmulatorConfig} from './r38-emulator-support.mjs';
assert(url.startsWith('https://click360-staging-7620168025')||url.startsWith('http://127.0.0.1:'),'Only isolated staging or local built artifact allowed');
process.env.CLICK360_R38_ALLOW_CAPACITY_PENDING='1';
const server=url.startsWith('http:')?spawn(process.execPath,[path.join(root,'node_modules/http-server/bin/http-server'),'dist','-p',String(port),'-c-1'],{cwd:root,detached:true,stdio:'ignore'}):null;
let proxy;
if(url.startsWith('https:')){
  const tlsDirectory=await mkdtemp(path.join(os.tmpdir(),'click360-demo-tls-'));
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(tlsDirectory,'key.pem'),'-out',path.join(tlsDirectory,'cert.pem'),'-days','1','-subj','/CN=127.0.0.1'],{stdio:'ignore'});
  proxy=createServer({key:await readFile(path.join(tlsDirectory,'key.pem')),cert:await readFile(path.join(tlsDirectory,'cert.pem'))},(req,res)=>{
    const targetPort=/^\/(identitytoolkit|securetoken)\.googleapis\.com\//.test(req.url)?authPort:firestorePort;
    const upstream=request({hostname:'127.0.0.1',port:targetPort,path:req.url,method:req.method,headers:req.headers},response=>{
      const headers={...response.headers,'access-control-allow-origin':req.headers.origin||new URL(url).origin,'access-control-allow-credentials':'true','access-control-allow-private-network':'true'};
      res.writeHead(response.statusCode,headers);response.pipe(res);
    });
    upstream.on('error',()=>{res.statusCode=502;res.end();});req.pipe(upstream);res.on('close',()=>upstream.destroy());
  });
  await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  process.env.CLICK360_R38_EMULATOR_ORIGIN=`https://127.0.0.1:${proxy.address().port}`;
}
const config=writeEmulatorConfig();
const emulators=spawn(path.join(root,'node_modules/.bin/firebase'),['emulators:start','--only','firestore,auth','--project',projectId,'--config',config],{cwd:path.dirname(config),detached:true,stdio:'ignore',env:{...process.env,PATH:`${javaDirs.join(':')}:${process.env.PATH}`}});
let env;
const results=[];
try{
  await waitForUrl(`http://127.0.0.1:${firestorePort}/`,'demo Firestore'); await waitForUrl(`http://127.0.0.1:${authPort}/`,'demo Auth');
  await waitForUrl(url,'served build');
  env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:firestorePort,rules}});
  const uid=await createEmulatorUser();
  for(const [name,engine]of [['WebKit mobile',webkit],['Chromium mobile',chromium]]){
    const data=largeTenantData(uid);data.sales=[];data.movements=[];data.cashSessions=[];data.dailyReports=[];
    await seed(env,async db=>{await setDoc(doc(db,'accountAccess',uid),{...accountAccess(uid),manualLimitOverrides:{businesses:1,workers:1,productsActive:600}});await setDoc(doc(db,'businesses',uid,'state','main'),stateDocument(uid,Date.now(),data));});
    const directory=await mkdtemp(path.join(os.tmpdir(),'click360-hosted-founder-'));
    const adapter={newContext:async options=>engine.launchPersistentContext(directory,options)};
    let device=await openSignedIn(adapter,{width:390,height:844});
    try{
      const original=await readCloud(env,uid);
      await device.page.evaluate(async()=>{
        const state=window.click360GetTenantState();state.settings.capacityFixture='x'.repeat(1200000);
        window.click360ApplyTenantState(state,window.click360TenantContext);
        if(!window.click360PersistTenantState())throw Error('durable fixture save refused');
      });
      await device.page.waitForFunction(()=>window.click360GetCapacityStatus().cloudCapacityBlocked&&!window.click360GetCapacityStatus().deviceSavePending);
      assert.deepEqual(await device.page.evaluate(()=>window.click360GetClientReadiness().effectiveLimits),{businesses:2,workers:2,productsActive:2000});
      await device.page.evaluate(()=>window.click360Route('cash'));
      await device.page.locator('#apertureAmountInput').fill('0');await device.page.locator('#startDayBtnCash').click();
      await device.page.waitForFunction(()=>window.click360GetTenantState().cashSessions.some(s=>s.status==='open')&&!window.click360GetCapacityStatus().deviceSavePending);
      const cashId=await device.page.evaluate(()=>window.click360GetTenantState().cashSessions.find(s=>s.status==='open').id);
      await device.context.close();
      device=await openSignedIn(adapter,{width:390,height:844});
      assert.equal(await device.page.evaluate(id=>window.click360GetTenantState().cashSessions.find(s=>s.id===id)?.status,cashId),'open');
      await device.page.evaluate(()=>window.click360Route('inventory'));
      await device.page.locator('#newProduct').click();
      for(const [id,value]of [['pCode','FOUNDER-HOSTED'],['pName','Synthetic hosted product'],['pQty','5'],['pCost','4'],['pPrice','12'],['pCardPrice','12.5']])await device.page.locator('#'+id).fill(value);
      await device.page.locator('#productForm button[type="submit"]').click();
      await device.page.waitForFunction(()=>window.click360GetTenantState().products.some(p=>p.code==='FOUNDER-HOSTED')&&!window.click360GetCapacityStatus().deviceSavePending);
      const product=await device.page.evaluate(()=>window.click360GetTenantState().products.find(p=>p.code==='FOUNDER-HOSTED'));
      await device.page.locator('#productSearch').fill('FOUNDER-HOSTED'); await device.page.locator(`[data-edit="${product.id}"]`).click();
      await device.page.locator('#pQty').fill('6');await device.page.locator('#productForm button[type="submit"]').click();
      await device.page.waitForFunction(id=>window.click360GetTenantState().products.find(p=>p.id===id)?.stock===6&&!window.click360GetCapacityStatus().deviceSavePending,product.id);
      await device.page.evaluate(()=>window.click360Route('sell'));
      await device.page.locator('#manualCode').fill('FOUNDER-HOSTED');await device.page.locator('#addCode').click();await device.page.locator('#payMethod').selectOption('Transferencia');
      await device.page.locator('#chargeBtn').evaluate(button=>{button.click();button.click();});
      await device.page.waitForFunction(()=>window.click360GetTenantState().sales.length===1&&!window.click360GetCapacityStatus().deviceSavePending);
      const final=await device.page.evaluate(()=>({state:window.click360GetTenantState(),readiness:window.click360GetClientReadiness(),sync:window.click360GetSyncState()}));
      assert.equal(final.state.products.find(p=>p.id===product.id).stock,5);assert.equal(final.state.sales.length,1);
      assert.equal(final.state.movements.filter(m=>m.kind!=='apertura').length,1);assert.equal(final.state.movements.filter(m=>m.kind==='apertura').length,1);
      assert.equal(final.readiness.cloudCapacityBlocked,true);assert.notEqual(final.sync.status,'clean');
      assert.deepEqual(await readCloud(env,uid),original,'all oversized operations remain local; legacy server document is unchanged');
      await device.page.evaluate(()=>window.click360Route('backup'));assert.equal(await device.page.getByText('Nube sincronizada',{exact:false}).count(),0);
      results.push({platform:name,result:'PASS',auth:'real demo emulator',bytes:final.readiness.payloadBytes,openingOnce:true,coldRestart:true,productCRUD:true,saleOnce:true,stockExact:true,legacyUnchanged:true});
      console.log('PASS hosted '+name+': real Auth, old override600->2000, durable opening/cold restart/product create-edit/sale/stock; cloud pending truthfully');
    }finally{await device.context.close();}
  }
  await mkdir(path.join(root,'output/playwright'),{recursive:true});await writeFile(path.join(root,'output/playwright/founder-hosted-commerce.json'),JSON.stringify({url,results},null,2));
}finally{await env?.cleanup();stopProcessTree(emulators);stopProcessTree(server);proxy?.closeAllConnections();if(proxy)await new Promise(resolve=>proxy.close(resolve));}
