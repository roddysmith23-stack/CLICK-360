// Existing CLICK360 UI and built assets; real Auth/Web SDK/Rules emulators.
// This is partial operational integration, NOT full migration certification.
import {spawn} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync,createWriteStream} from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {failureReason} from '../qa-spark-emulator-health.mjs';
import {chromium,webkit} from 'playwright';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDocFromServer} from 'firebase/firestore';
import '../spark-modular-migration.js';
import '../spark-modular-record-codec.js';
import {root,port,firestorePort,authPort,projectId,javaDirs,url,assert,stopProcessTree,waitForUrl,createEmulatorUser,
  seed,readCloud,openSignedIn,largeTenantData,stateDocument,accountAccess,writeEmulatorConfig} from './r38-emulator-support.mjs';
assert(projectId==='demo-click360-spark-modular','Exact synthetic project required');
const rules=readFileSync(path.join(root,'firestore.spark.rules'),'utf8');
const output=path.join(root,'output/playwright/spark-operational-ui');mkdirSync(output,{recursive:true});
const config=writeEmulatorConfig(),log=createWriteStream(path.join(output,`emulators-${Date.now()}.log`),{flags:'wx'});
const emulators=spawn(path.join(root,'node_modules/.bin/firebase'),['emulators:start','--only','firestore,auth','--project',projectId,'--config',config],
  {cwd:path.dirname(config),detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PATH:`${javaDirs.join(':')}:${process.env.PATH}`}});
emulators.stdout.pipe(log);emulators.stderr.pipe(log);
const server=spawn(process.execPath,[path.join(root,'node_modules/http-server/bin/http-server'),'dist','-p',String(port),'-c-1'],{cwd:root,detached:true,stdio:'ignore'});
let env,browsers=[],device;const results=[];
try{
  await Promise.race([(async()=>{await waitForUrl(`http://127.0.0.1:${firestorePort}/`,'Firestore');await waitForUrl(`http://127.0.0.1:${authPort}/`,'Auth');await waitForUrl(url,'HTTP');})(),
    new Promise((_,reject)=>emulators.once('exit',code=>reject(Error(`Emulator exited ${code}`))))]);
  env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:firestorePort,rules}});
  const uid=await createEmulatorUser(),base=`businesses/${uid}/businessUnits/${uid}/storage/v2`,identity={ownerUid:uid,businessId:uid};
  const record=async(moduleName,id)=>{
    let data;await seed(env,async db=>{const snap=await getDocFromServer(doc(db,`${base}/${moduleName}/${id}`));assert(!snap.metadata.fromCache,'Fresh server required');data=snap.data();});
    return data?globalThis.CLICK360_SPARK_RECORD_CODEC.unpack(data,{identity,moduleName,recordId:id}):null;
  };
  browsers=[await chromium.launch(),await webkit.launch()];
  for(const [i,browser]of browsers.entries()){
    const label=i?'webkit':'chromium';console.log(`START served Spark UI ${label}`);
    await env.clearFirestore();
    const data=largeTenantData(uid);data.sales=[];data.movements=[];data.cashSessions=[];data.auditLogs=[];
    data.products[0]={...data.products[0],code:'SPARK-LIVE',price:30,cardPrice:30,stock:2,qty:2};
    await seed(env,async db=>{await setDoc(doc(db,'accountAccess',uid),accountAccess(uid));await setDoc(doc(db,'businesses',uid,'state','main'),stateDocument(uid,1,data));});
    device=await openSignedIn(browser,{width:390,height:844});
    const page=device.page;
    const legacyBefore=await readCloud(env,uid);
    await seed(env,async db=>{
      await setDoc(doc(db,`businesses/${uid}/metadata/storage`),{ownerUid:uid,schemaVersion:2,storageMode:'modular',phase:'MODULAR',semanticEquality:'PASS',sourceHash:'a'.repeat(64),reconstructedHash:'a'.repeat(64),businessIds:[uid]});
      for(const [moduleName,id,extra]of [['metadata','runtime',{summaryVersion:1,openCashSessionId:''}],['products',data.products[0].id,data.products[0]]]){
        const flat={...extra,id,ownerUid:uid,businessId:uid,tenantKey:`owner:${uid}:business:${uid}`,storageSchemaVersion:2,module:moduleName,recordVersion:1};
        await setDoc(doc(db,`${base}/${moduleName}/${id}`),await globalThis.CLICK360_SPARK_RECORD_CODEC.pack(flat,{identity,moduleName,recordId:id}));
      }
    });
    await page.evaluate(async({projectId,uid})=>{
      const identity=CLICK360_MODULAR_PERSISTENCE.identity(uid,uid);
      window.click360SparkOperationalSession=await CLICK360_SPARK_OPERATIONAL_UI.create({projectId,db:firebase.firestore(),ownerUid:uid,businessId:uid,actorUid:uid,
        syntheticCertification:true,deviceId:'served-ui-device',resolveUser:()=>firebase.auth().currentUser,resolveIdentity:()=>identity,
        serverTimestamp:()=>firebase.firestore.FieldValue.serverTimestamp(),persistCandidate:window.click360PersistSparkCandidate,
        projectConfirmed:window.click360ProjectSparkOperation,onStatus:status=>{window.SPARK_UI_STATUS=status;}});
      const session=window.click360SparkOperationalSession;
      window.click360SparkOperationalSession={...session,commit:async request=>{
        try{const result=await session.commit(request);window.SPARK_UI_COMMIT=result;return result;}
        catch(error){window.SPARK_UI_COMMIT={error:error.message};throw error;}
      }};
    },{projectId,uid});
    const resetStatus=()=>page.evaluate(()=>{window.SPARK_UI_STATUS=null;window.SPARK_UI_COMMIT=null;});
    const confirmed=async()=>{
      await page.waitForFunction(()=>window.SPARK_UI_STATUS?.status==='CONFIRMED'||window.SPARK_UI_COMMIT);
      assert(await page.evaluate(()=>window.SPARK_UI_STATUS?.status==='CONFIRMED'),JSON.stringify(await page.evaluate(()=>window.SPARK_UI_COMMIT)));
    };
    // These are the existing product editor/stock fields, not a demonstration UI.
    await page.locator('#newProduct').click();await page.locator('#pCode').fill('SPARK-NEW');await page.locator('#pName').fill('Nuevo sintético modular');
    await page.locator('#pQty').fill('10');await page.locator('#pCost').fill('2');await page.locator('#pPrice').fill('12');await page.locator('#pCardPrice').fill('12');
    await resetStatus();await page.locator('#productForm button[type="submit"]').click();await confirmed();
    const created=await page.evaluate(()=>click360GetTenantState().products.find(p=>p.code==='SPARK-NEW'));
    assert((await record('products',created.id)).stock===10,'Product opening stock persisted once');
    await page.locator('#productSearch').fill('SPARK-NEW');await page.locator(`[data-edit="${created.id}"]`).click();
    await page.locator('#pName').fill('Editado sintético modular');await resetStatus();await page.locator('#productForm button[type="submit"]').click();await confirmed();
    assert((await record('products',created.id)).name==='Editado sintético modular','Product metadata edit committed');
    await page.locator('#productSearch').fill('SPARK-NEW');await page.locator(`[data-edit="${created.id}"]`).click();
    await page.locator('#pQty').fill('11');await resetStatus();await page.locator('#productForm button[type="submit"]').click();await confirmed();
    assert((await record('products',created.id)).stock===11,'Inventory adjustment exact');
    await resetStatus();
    await page.evaluate(()=>{location.hash='#cash';});await page.locator('#startDayBtnCash').waitFor();
    await page.locator('#apertureAmountInput').fill('0');await page.locator('#startDayBtnCash').click();
    await confirmed();
    const session=await page.evaluate(()=>window.click360GetTenantState().cashSessions.find(s=>s.status==='open'));
    assert(session?.id,'Existing UI opened exact session');assert((await record('cashSessions',session.id)).openingAmount===0,'Server opening confirmed');
    await page.evaluate(()=>{location.hash='#sell';});await page.locator('#manualCode').waitFor();
    await page.locator('#manualCode').fill('SPARK-LIVE');await page.locator('#addCode').click();
    await page.locator('#payMethod').selectOption('Transferencia');
    await resetStatus();await page.locator('#chargeBtn').click();await confirmed();
    const sale=await page.evaluate(()=>window.click360GetTenantState().sales.at(-1));
    assert(sale?.operationId,'Existing UI created sale command');
    const serverSale=await record('sales',sale.operationId),movement=await record('movements',sale.operationId),product=await record('products',data.products[0].id);
    assert(serverSale.total===30&&movement.amount===30&&product.stock===1&&product.qty===1,'Exact atomic sale/movement/stock');
    assert(serverSale.cashSessionId===session.id,'Exact session');
    await page.locator('#doneSaleBtn').waitFor({state:'visible'});await page.locator('#doneSaleBtn').click();
    for(const method of ['Apartado','Pendiente']){
      await page.locator('#manualCode').fill('SPARK-NEW');await page.locator('#addCode').click();await page.locator('#payMethod').selectOption(method);
      await page.locator('#customer').fill('Cliente sintético');await page.locator('#customerPhone').fill('0000000000');
      await page.locator('#customerCedula').fill('SYNTHETIC-ONLY');
      if(method==='Apartado'){
        await page.locator('#layawayDueDate').fill('2026-12-31');
        await page.locator('#layawayTermsAccepted').check();await page.locator('#layawayInitialMethod').selectOption('Transferencia');await page.locator('#cashReceived').fill('2');
      }
      await resetStatus();await page.locator('#chargeBtn').click();await confirmed();
      const createdSale=await page.evaluate(()=>click360GetTenantState().sales.at(-1));
      const saleRecord=await record('sales',createdSale.operationId),receipt=await record('movements',createdSale.operationId);
      assert(saleRecord.total===12&&saleRecord.received===(method==='Apartado'?2:0)&&receipt.amount===saleRecord.received,'Deposit/zero payment is not full sale amount');
      if(method==='Apartado'){
        const local=await page.evaluate(id=>click360GetTenantState().layaways.find(l=>l.saleId===id),createdSale.id);
        const remote=await record('layaways',local.id);
        assert(remote.saleId===createdSale.operationId&&remote.balance===10,'Exact local/remote reservation relationships');
      }
      await page.locator('#doneSaleBtn').waitFor({state:'visible'});await page.locator('#doneSaleBtn').click();
    }
    assert((await record('products',created.id)).stock===9,'Reservation and pending sale each decrement exactly once');
    assert((await record('cashSessions',session.id)).paymentTotals.transfer===32,'Only actual receipts counted in session');
    await page.evaluate(()=>{location.hash='#cash';});await page.locator('#newMove').click();
    await page.locator('#mKind').selectOption('ingreso');await page.locator('#mAmount').fill('5');await page.locator('#mNote').fill('Ingreso sintético Spark');
    await resetStatus();await page.locator('#moveForm button[type="submit"]').click();await confirmed();
    const cashSession=await record('cashSessions',session.id);
    assert(cashSession.cashBalance===5&&cashSession.incomeCash===5,'Cash movement/session atomic delta');
    await page.locator('#closeDayBtn').click();await page.locator('#efectivoFisico').fill('5');
    await resetStatus();await page.locator('#closeDaySubmitBtn').click();await confirmed();
    const closed=await record('cashSessions',session.id),closeReport=await record('dailyReports',closed.reportId);
    assert(closed.status==='closed'&&closeReport.cashSessionId===session.id,'Exact cash session/report closed');
    assert(closeReport.saleCount===3&&closeReport.total===54&&closeReport.totalItems===3
      &&closeReport.paymentTotals.transfer===32&&closeReport.theoreticalCash===5&&closeReport.declaredCash===5,'Authoritative close counters');
    assert((await record('products',created.id)).stock===9&&(await record('products',data.products[0].id)).stock===1,'Cash close cannot decrement stock again');
    const localReport=await page.evaluate(id=>click360GetTenantState().dailyReports.find(r=>r.id===id),closed.reportId);
    assert(localReport.productQuantity===3&&localReport.paymentTotals.transfer===32&&!localReport.html,'Derived report uses authoritative compact data');
    const existingClose=await page.evaluate(target=>window.click360SparkOperationalSession.verifyCashClose(target),
      {businessId:uid,cashSessionId:session.id,date:session.date});
    assert(existingClose.closed&&existingClose.source==='server'&&existingClose.reportId===closed.reportId,'Retry preflight recognizes and durably projects existing close');
    assert((await record('dailyReports',closed.reportId)).operationId===existingClose.operationId,'Recovery cannot create another close');
    const health=await page.evaluate(()=>window.click360SparkOperationalSession.health());
    assert(health.pendingCount===0&&health.unknownCount===0&&health.projectionPendingCount===0,'Durable local projection completed');
    assert(JSON.stringify(await readCloud(env,uid))===JSON.stringify(legacyBefore),'No legacy overwrite');
    const runtime=await page.evaluate(()=>({global:!!CLICK360_SPARK_OPERATIONAL_UI,hash:CLICK360_RELEASE_ASSETS['app.js'],sale:click360GetTenantState().sales.at(-1).id}));
    assert(runtime.sale,'Existing receipt ID preserved');
    results.push({browser:label,source:'served-built-PWA+Web-SDK+Auth/Firestore-emulators',productCreate:true,productEdit:true,inventoryAdjust:true,cashOpeningZero:true,cashClose:true,authoritativeReport:true,sale:true,initialLayaway:true,pendingPaymentSale:true,cashMovement:true,stockOnce:true,legacyUnchanged:true,
      durableProjection:true,fullOperationalUI:false,migration:false,physicalAcceptance:false,productionWrites:0});
    assert(device.pageErrors.length===0,JSON.stringify({pageErrors:device.pageErrors}));
    await device.context.close();device=null;console.log(`PASS served Spark UI ${label}`);
  }
  const budgetFailure=failureReason(readFileSync(path.join(path.dirname(config),'firestore-debug.log'),'utf8'));
  assert(!budgetFailure,budgetFailure);
  const text=JSON.stringify({status:'PASS',sourceCommitSha:process.env.CLICK360_QA_SOURCE_SHA||execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    sourceDirty:!!execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:root,encoding:'utf8'}).trim(),rulesBudgetErrors:0,results},null,2);
  writeFileSync(path.join(output,'results.json'),text);writeFileSync(path.join(output,`results-${Date.now()}.json`),text);console.log(text);
}catch(error){
  if(device?.page)console.log(JSON.stringify(await device.page.evaluate(()=>({status:window.SPARK_UI_STATUS,toast:document.querySelector('#toast')?.textContent,
    commit:window.SPARK_UI_COMMIT,lastFailure:window.click360LastSaveFailure,gate:window.click360WriteGate?.(),state:click360GetTenantState()?.cashSessions})).catch(()=>null)));
  if(device)console.log(JSON.stringify({pageErrors:device.pageErrors}));
  throw error;
}finally{
  await device?.context.close();for(const browser of browsers)await browser.close();await env?.cleanup();stopProcessTree(server);stopProcessTree(emulators);log.end();
}
