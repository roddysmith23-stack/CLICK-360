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
import {root,port,firestorePort,authPort,projectId,javaDirs,url,rules,stopProcessTreeAndWait,waitForUrl,createEmulatorUser,seed,readCloud,openSignedIn,largeTenantData,stateDocument,accountAccess,writeEmulatorConfig} from './r38-emulator-support.mjs';
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
    let phase='protect-existing-snapshot';
    try{
      const original=await readCloud(env,uid);
      await device.page.evaluate(async()=>{
        const state=window.click360GetTenantState();state.settings.capacityFixture='x'.repeat(1200000);
        window.click360ApplyTenantState(state,window.click360TenantContext);
        if(!window.click360PersistTenantState())throw Error('durable fixture save refused');
      });
      await device.page.waitForFunction(()=>window.click360GetCapacityStatus().cloudCapacityBlocked&&!window.click360GetCapacityStatus().deviceSavePending);
      assert.deepEqual(await device.page.evaluate(()=>window.click360GetClientReadiness().effectiveLimits),{businesses:2,workers:2,productsActive:2000});
      phase='opening';
      await device.page.evaluate(()=>window.click360Route('cash'));
      await device.page.locator('#apertureAmountInput').fill('0');await device.page.locator('#startDayBtnCash').click();
      await device.page.waitForFunction(()=>window.click360GetTenantState().cashSessions.some(s=>s.status==='open')&&!window.click360GetCapacityStatus().deviceSavePending);
      const cashId=await device.page.evaluate(()=>window.click360GetTenantState().cashSessions.find(s=>s.status==='open').id);
      await device.context.close();
      phase='cold-restart';
      device=await openSignedIn(adapter,{width:390,height:844});
      assert.equal(await device.page.evaluate(id=>window.click360GetTenantState().cashSessions.find(s=>s.id===id)?.status,cashId),'open');
      await device.page.evaluate(()=>window.click360Route('inventory'));
      phase='product-create';
      await device.page.locator('#newProduct').click();
      for(const [id,value]of [['pCode','FOUNDER-HOSTED'],['pName','Synthetic hosted product'],['pQty','5'],['pCost','4'],['pPrice','12'],['pCardPrice','12.5']])await device.page.locator('#'+id).fill(value);
      await observeProductSubmit(device.page);
      await device.page.locator('#productForm button[type="submit"]').click();
      await awaitProductSubmit(device.page);
      await device.page.waitForFunction(()=>window.click360GetTenantState().products.some(p=>p.code==='FOUNDER-HOSTED')&&!window.click360GetCapacityStatus().deviceSavePending);
      const product=await device.page.evaluate(()=>window.click360GetTenantState().products.find(p=>p.code==='FOUNDER-HOSTED'));
      phase='product-edit-identical-rehydration';
      await device.page.locator('#productSearch').fill('FOUNDER-HOSTED'); await device.page.locator(`[data-edit="${product.id}"]`).click();
      await device.page.locator('#pQty').fill('6');
      assert.equal(await device.page.locator('#pQty').inputValue(),'6');
      await observeProductSubmit(device.page);
      await rehydrateAtSubmit(device.page);
      await device.page.locator('#productForm button[type="submit"]').click();
      await awaitProductSubmit(device.page);
      assert.equal(await device.page.evaluate(()=>window.FOUNDER_REHYDRATIONS),1);
      try{
        await device.page.waitForFunction(id=>window.click360GetTenantState().products.find(p=>p.id===id)?.stock===6&&!window.click360GetCapacityStatus().deviceSavePending,product.id);
      }catch(error){
        console.error('FOUNDER_EDIT_FAILURE',JSON.stringify(await device.page.evaluate(id=>{
          const product=window.click360GetTenantState().products.find(p=>p.id===id);
          return {stock:product?.stock,qty:product?.qty,readiness:window.click360GetClientReadiness(),
            confirmation:window.CLICK360_LAST_CONFIRMATION_DIAGNOSTICS,
            toast:document.querySelector('#toast')?.textContent,modalPresent:!!document.querySelector('#productForm'),
            criticalGate:window.click360DebugCriticalActionGate?.()};
        },product.id)));
        throw error;
      }
      phase='sale-double-click';
      await device.page.evaluate(()=>window.click360Route('sell'));
      await device.page.locator('#manualCode').fill('FOUNDER-HOSTED');await device.page.locator('#addCode').click();await device.page.locator('#payMethod').selectOption('Transferencia');
      await device.page.locator('#chargeBtn').evaluate(button=>{button.click();button.click();});
      await device.page.waitForFunction(()=>window.click360GetTenantState().sales.length===1&&!window.click360GetCapacityStatus().deviceSavePending);
      const final=await device.page.evaluate(()=>({state:window.click360GetTenantState(),readiness:window.click360GetClientReadiness(),sync:window.click360GetSyncState()}));
      assert.equal(final.state.products.find(p=>p.id===product.id).stock,5);assert.equal(final.state.sales.length,1);
      assert.equal(final.state.movements.filter(m=>m.kind!=='apertura').length,1);assert.equal(final.state.movements.filter(m=>m.kind==='apertura').length,1);
      assert.equal(final.readiness.cloudCapacityBlocked,true);assert.notEqual(final.sync.status,'clean');
      assert.deepEqual(await readCloud(env,uid),original,'all oversized operations remain local; legacy server document is unchanged');
      // Simulated concurrent material rehydration must not be mistaken for
      // an unchanged baseline, even though IndexedDB can persist the payload.
      phase='concurrent-edit-rejection';
      await device.page.evaluate(()=>window.click360Route('inventory'));
      await device.page.locator('#productSearch').fill('FOUNDER-HOSTED');
      await device.page.locator(`[data-edit="${product.id}"]`).click();
      await device.page.locator('#pQty').fill('6');
      await observeProductSubmit(device.page);
      await rehydrateAtSubmit(device.page,{productId:product.id,concurrentStock:7});
      await device.page.locator('#productForm button[type="submit"]').click();
      await awaitProductSubmit(device.page);
      const conflict=await device.page.evaluate(id=>({
        state:window.click360GetTenantState(),baseline:window.FOUNDER_REHYDRATED_STATE,
        diagnostics:window.CLICK360_LAST_CONFIRMATION_DIAGNOSTICS,
        stock:window.click360GetTenantState().products.find(p=>p.id===id).stock
      }),product.id);
      assert.equal(conflict.stock,7,'a real concurrent stock edit is never overwritten');
      assert.equal(conflict.diagnostics.outcome,'safe_conflict');
      assert.deepEqual(conflict.state,conflict.baseline,'rejected edit adds no sale/movement/audit or other material mutation');
      assert.deepEqual(await readCloud(env,uid),original,'conflict test never writes the legacy server document');
      await device.page.evaluate(()=>window.click360Route('backup'));assert.equal(await device.page.getByText('Nube sincronizada',{exact:false}).count(),0);
      results.push({platform:name,result:'PASS',auth:'real demo emulator',bytes:final.readiness.payloadBytes,openingOnce:true,coldRestart:true,productCRUD:true,saleOnce:true,stockExact:true,legacyUnchanged:true,identicalRehydrationEdit:true,concurrentEditRejected:true});
      console.log('PASS hosted '+name+': real Auth, old override600->2000, durable opening/cold restart/product create-edit/sale/stock; cloud pending truthfully');
    }catch(error){
      const evidence=await device.page.evaluate(()=>{
        const state=window.click360GetTenantState?.();
        const product=state?.products?.find(p=>p.code==='FOUNDER-HOSTED');
        return {stock:product?.stock,qty:product?.qty,sales:state?.sales?.length,movements:state?.movements?.length,
          readiness:window.click360GetClientReadiness?.(),confirmation:window.CLICK360_LAST_CONFIRMATION_DIAGNOSTICS,
          submitCount:window.FOUNDER_PRODUCT_SUBMITS,submitSettled:window.FOUNDER_PRODUCT_SETTLED,
          submitError:window.FOUNDER_PRODUCT_ERROR,toast:document.querySelector('#toast')?.textContent};
      }).catch(()=>null);
      console.error('FOUNDER_HOSTED_FAILURE',JSON.stringify({platform:name,phase,evidence}));
      throw error;
    }finally{await device.context.close();}
  }
  await mkdir(path.join(root,'output/playwright'),{recursive:true});await writeFile(path.join(root,'output/playwright/founder-hosted-commerce.json'),JSON.stringify({url,results},null,2));
}finally{await env?.cleanup();await Promise.all([stopProcessTreeAndWait(emulators),stopProcessTreeAndWait(server)]);proxy?.closeAllConnections();if(proxy)await new Promise(resolve=>proxy.close(resolve));}

async function observeProductSubmit(page){
  // Observe the REAL async handler; a visible persisted row is not proof its
  // modal cleanup/critical-action release finished. No extra submit/retry.
  await page.locator('#productForm').evaluate(form=>{
    const handler=form.onsubmit;
    if(typeof handler!=='function')throw new Error('Product submit handler not ready');
    window.FOUNDER_PRODUCT_COMPLETION=null;
    window.FOUNDER_PRODUCT_SUBMITS=0;
    window.FOUNDER_PRODUCT_SETTLED=false;
    window.FOUNDER_PRODUCT_ERROR=null;
    form.onsubmit=function(event){
      window.FOUNDER_PRODUCT_SUBMITS++;
      return window.FOUNDER_PRODUCT_COMPLETION=Promise.resolve(handler.call(this,event)).then(
        ()=>{window.FOUNDER_PRODUCT_SETTLED=true;},
        error=>{window.FOUNDER_PRODUCT_ERROR=String(error?.message||error);window.FOUNDER_PRODUCT_SETTLED=true;}
      );
    };
  });
}

async function awaitProductSubmit(page){
  // The existing bounded page deadline still applies if the real handler
  // never settles; page.evaluate(async ...) alone has no such deadline.
  await page.waitForFunction(()=>window.FOUNDER_PRODUCT_SETTLED===true);
  await page.evaluate(()=>{
    if(window.FOUNDER_PRODUCT_SUBMITS!==1||!window.FOUNDER_PRODUCT_COMPLETION)throw new Error('Expected exactly one real product submit');
    if(window.FOUNDER_PRODUCT_ERROR)throw new Error(window.FOUNDER_PRODUCT_ERROR);
  });
}

async function rehydrateAtSubmit(page,change={}){
  // Deterministic equivalent of state replacement immediately before the
  // existing editor submits. Synthetic fixture only, never production data.
  await page.locator('#productForm').evaluate((form,change)=>{
    window.FOUNDER_REHYDRATIONS=0;
    form.addEventListener('submit',()=>{
      const snapshot=window.click360GetTenantState();
      if(change.productId){
        const product=snapshot.products.find(p=>p.id===change.productId);
        product.stock=product.qty=change.concurrentStock;
      }
      window.click360ApplyTenantState(snapshot,window.click360TenantContext);
      window.FOUNDER_REHYDRATED_STATE=window.click360GetTenantState();
      window.FOUNDER_REHYDRATIONS++;
    },{capture:true,once:true});
  },change);
}
