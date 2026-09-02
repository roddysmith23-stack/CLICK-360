// Complements the offline tax/resize UI regression with real authenticated
// server writes. No SDK/write-gate mock and no production connection.
import {spawn} from 'node:child_process';
import path from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc} from 'firebase/firestore';
process.env.CLICK360_R38_CORE_HTTP_PORT='4799';
process.env.CLICK360_R38_CORE_FIRESTORE_PORT='48099';
process.env.CLICK360_R38_CORE_AUTH_PORT='49109';
process.env.CLICK360_R38_CORE_PROJECT='demo-click360-r38-restaurant';
const h=await import('./r38-emulator-support.mjs');
const config=h.writeEmulatorConfig();
const emulators=spawn(path.join(h.root,'node_modules/.bin/firebase'),['emulators:start','--only','firestore,auth','--project',h.projectId,'--config',config],{cwd:path.dirname(config),detached:true,stdio:'ignore',env:{...process.env,PATH:`${h.javaDirs.join(':')}:${process.env.PATH}`}});
const server=spawn(process.execPath,[path.join(h.root,'node_modules/http-server/bin/http-server'),'.','-p',String(h.port),'-c-1'],{cwd:h.root,detached:true,stdio:'ignore'});
let env,browser,page,uid,device,stage='startup';
try{
  await h.waitForUrl(`http://127.0.0.1:${h.firestorePort}/`,'Firestore');await h.waitForUrl(`http://127.0.0.1:${h.authPort}/`,'Auth');await h.waitForUrl(h.url,'HTTP');
  env=await initializeTestEnvironment({projectId:h.projectId,firestore:{host:'127.0.0.1',port:h.firestorePort,rules:h.rules}});
  uid=await h.createEmulatorUser();const data=h.largeTenantData(uid),date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Guayaquil',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  data.businesses[0].type='restaurante';data.businesses[0].settings={tax:{enabled:true,rate:12,priceMode:'excluded'}};
  data.products[0]={...data.products[0],price:10,cardPrice:10,stock:20,qty:20,taxMode:'inherit'};
  data.sales=[];data.auditLogs=[];data.notifications=[];
  data.cashSessions=[{id:'synthetic-cash',businessId:uid,date,status:'open',openingAmount:50,openedBy:'Synthetic QA',openedAt:new Date().toISOString()}];
  data.movements=[{id:'synthetic-aperture',businessId:uid,date,kind:'apertura',amount:50,cashSessionId:'synthetic-cash'}];
  data.tables=[{id:'synthetic-table',businessId:uid,name:'Mesa sintética',status:'free',layout:{x:10,y:10,width:18,height:18}}];
  await h.seed(env,async db=>{await setDoc(doc(db,'accountAccess',uid),h.accountAccess(uid));await setDoc(doc(db,'businesses',uid,'state','main'),h.stateDocument(uid,Date.now(),data));});
  stage='login';browser=await chromium.launch();device=await h.openSignedIn(browser,{width:1280,height:900});page=device.page;
  stage='open-table';
  await page.evaluate(()=>window.click360Route('tables'));await page.locator('#tableMap [data-table-open="synthetic-table"]').click();
  // Opening a free table is itself a persisted operation. Do not overlap the
  // item mutation with that preceding write; confirm it on the server, then
  // reopen the now-occupied table exactly as an operator would.
  await page.waitForFunction(()=>window.click360SyncStatus?.status==='synced'&&window.click360DebugCriticalActionGate().size===0);
  for(let attempt=0;attempt<60;attempt+=1){if((await h.readCloud(env,uid)).payload.data.tableOrders.length===1)break;if(attempt===59)throw new Error('table open was not authoritative');await new Promise(resolve=>setTimeout(resolve,250));}
  await page.evaluate(()=>window.click360Route('tables'));await page.locator('#tableMap [data-table-open="synthetic-table"]').click();
  stage='add-product';await page.locator('#tableProduct').selectOption(data.products[0].id);await page.locator('#tableQty').fill('1');
  // The handler intentionally rebuilds the modal synchronously after submit;
  // dispatch through the form and prove the resulting item instead of making
  // Playwright wait for the original button node to remain attached.
  await page.locator('#tableAddItemForm').evaluate(form=>form.requestSubmit());
  await page.waitForFunction(id=>window.click360GetTenantState().tableOrders.some(order=>order.items.some(item=>item.productId===id&&item.qty===1)),data.products[0].id);
  await page.waitForFunction(()=>window.click360SyncStatus?.status==='synced'&&window.click360WriteGate?.().allowed===true);
  for(let attempt=0;attempt<60;attempt+=1){const order=(await h.readCloud(env,uid)).payload.data.tableOrders[0];if(order?.items?.length===1)break;if(attempt===59)throw new Error('table item was not authoritative');await new Promise(resolve=>setTimeout(resolve,250));}
  stage='checkout';
  await page.locator('#tableChargeBtn').click();await page.locator('#tableCheckoutForm').waitFor({state:'visible'});
  h.assert((await page.locator('#tableCheckoutTotal').innerText()).includes('11.20'),'actual tax-inclusive checkout total');
  await page.locator('#tableCheckoutTendered').fill('10');await page.locator('#tableCheckoutForm button[type="submit"]').click();
  h.assert((await h.readCloud(env,uid)).payload.data.sales.length===0,'under-tender never writes a sale');
  await page.locator('#tableCheckoutTendered').fill('11.20');
  await page.evaluate(()=>{const form=document.querySelector('#tableCheckoutForm');for(let i=0;i<5;i++)form.requestSubmit();});
  await page.waitForFunction(()=>window.click360GetTenantState().sales.length===1&&window.click360SyncStatus?.status==='synced'&&window.click360DebugCriticalActionGate().size===0,null,{timeout:60000});
  const cloud=(await h.readCloud(env,uid)).payload.data,sale=cloud.sales[0],movements=cloud.movements.filter(m=>m.saleId===sale.id),product=cloud.products.find(p=>p.id===data.products[0].id);
  h.assert(cloud.sales.length===1&&Math.abs(sale.total-11.2)<0.001,'authoritative one tax-inclusive sale');
  h.assert(movements.length===1&&Math.abs(movements[0].amount-11.2)<0.001,'authoritative one exact cash movement');
  h.assert(product.stock===19&&product.qty===19,'authoritative one stock decrement');
  h.assert(cloud.tables[0].status==='free'&&cloud.tableOrders[0].status==='paid','authoritative table/order lifecycle');
  h.assert(device.pageErrors.length===0,JSON.stringify(device.pageErrors));
  console.log('PASS authenticated Restaurant emulator: under-tender denied, five submits => one sale11.20/one movement/stock19/paid order/free table; production requests0');
}catch(error){
  const diagnostics={stage,error:String(error.stack||error),pageErrors:device?.pageErrors};
  if(page)diagnostics.browser=await page.evaluate(()=>({toast:document.querySelector('#toast')?.textContent,modal:document.querySelector('.modal')?.textContent,gate:window.click360WriteGate?.(),sync:window.click360SyncStatus,trace:window.R38_SYNC_TRACE,tables:window.click360GetTenantState?.().tables,orders:window.click360GetTenantState?.().tableOrders})).catch(()=>null);
  if(env&&uid)diagnostics.cloud=await h.readCloud(env,uid).catch(()=>null);
  const dir=path.join(h.root,'output/playwright/r38-restaurant');mkdirSync(dir,{recursive:true});writeFileSync(path.join(dir,'failure.json'),JSON.stringify(diagnostics,null,2));
  throw error;
}finally{await browser?.close();await env?.cleanup();h.stopProcessTree(server);h.stopProcessTree(emulators);}
