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
import {certifyShadowPreparation,certifyRecoveryCopy} from './spark-migration-shadow-pwa.mjs';
import {root,port,firestorePort,authPort,projectId,javaDirs,url,assert,stopProcessTree,waitForUrl,createEmulatorUser,
  seed,readCloud,openSignedIn,largeTenantData,stateDocument,accountAccess,writeEmulatorConfig} from './r38-emulator-support.mjs';
assert(projectId==='demo-click360-spark-modular','Exact synthetic project required');
const rules=readFileSync(path.join(root,'firestore.spark.rules'),'utf8');
if(process.env.CLICK360_SPARK_UI_WORKER_ONLY==='1'&&process.env.CI==='true')throw Error('FOCUSED_DIAGNOSTIC_CANNOT_REPLACE_REQUIRED_CI');
if(process.env.CLICK360_SPARK_UI_SHADOW_ONLY==='1'&&process.env.CI==='true')throw Error('FOCUSED_DIAGNOSTIC_CANNOT_REPLACE_REQUIRED_CI');
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
  const workerEmail=`spark-worker-${Date.now()}@example.test`,workerUid=await createEmulatorUser(workerEmail);
  const record=async(moduleName,id)=>{
    let data;await seed(env,async db=>{const snap=await getDocFromServer(doc(db,`${base}/${moduleName}/${id}`));assert(!snap.metadata.fromCache,'Fresh server required');data=snap.data();});
    return data?globalThis.CLICK360_SPARK_RECORD_CODEC.unpack(data,{identity,moduleName,recordId:id}):null;
  };
  browsers=[await chromium.launch(),await webkit.launch()];
  for(const [i,browser]of browsers.entries()){
    const label=i?'webkit':'chromium';console.log(`START served Spark UI ${label}`);
    await certifyRecoveryCopy({browser,env,uid,label});
    await certifyShadowPreparation({browser,env,uid,label});
    if(process.env.CLICK360_SPARK_UI_SHADOW_ONLY==='1'){
      results.push({browser:label,shadowPreparation:true,fullOperationalUI:false,cutover:false,productionWrites:0});continue;
    }
    await env.clearFirestore();
    const data=largeTenantData(uid);data.sales=[];data.movements=[];data.cashSessions=[];data.auditLogs=[];
    data.products[0]={...data.products[0],code:'SPARK-LIVE',price:30,cardPrice:30,stock:2,qty:2};
    const otherBusiness=`second-${uid}`;
    data.businesses.push({id:otherBusiness,name:'Segundo negocio sintético',status:'activo',type:'ropa',settings:{}});
    data.products.push({id:'other-product',businessId:otherBusiness,code:'OTHER-BUSINESS',name:'Producto aislado',stock:7,qty:7,price:5,cardPrice:5,cost:1});
    await seed(env,async db=>{await setDoc(doc(db,'accountAccess',uid),{...accountAccess(uid),manualLimitOverrides:{businesses:1,workers:1,productsActive:600}});await setDoc(doc(db,'businesses',uid,'state','main'),stateDocument(uid,1,data));});
    const manifest=await globalThis.CLICK360_SPARK_MIGRATION.plan({ownerUid:uid,snapshot:data,
      identity:stateDocument(uid,1,data).payload.identity,remoteRevision:1});
    await seed(env,async db=>{
      for(const row of manifest.records)await setDoc(doc(db,row.path),row.content);
      await setDoc(doc(db,`businesses/${uid}/metadata/storage`),{ownerUid:uid,schemaVersion:2,storageMode:'modular',phase:'MODULAR',semanticEquality:'PASS',sourceHash:manifest.sourceHash,reconstructedHash:manifest.sourceHash,businessIds:[uid,otherBusiness]});
      for(const [moduleName,id,extra]of [['metadata','runtime',{summaryVersion:1,openCashSessionId:''}]]){
        const flat={...extra,id,ownerUid:uid,businessId:uid,tenantKey:`owner:${uid}:business:${uid}`,storageSchemaVersion:2,module:moduleName,recordVersion:1};
        await setDoc(doc(db,`${base}/${moduleName}/${id}`),await globalThis.CLICK360_SPARK_RECORD_CODEC.pack(flat,{identity,moduleName,recordId:id}));
        const otherIdentity={ownerUid:uid,businessId:otherBusiness};
        await setDoc(doc(db,`businesses/${uid}/businessUnits/${otherBusiness}/storage/v2/${moduleName}/${id}`),
          await globalThis.CLICK360_SPARK_RECORD_CODEC.pack({...flat,businessId:otherBusiness,tenantKey:`owner:${uid}:business:${otherBusiness}`},
            {identity:otherIdentity,moduleName,recordId:id}));
      }
    });
    device=await openSignedIn(browser,{width:390,height:844});
    const page=device.page;
    const workerProof=await page.evaluate(()=>({controlled:!!navigator.serviceWorker.controller,
      sameRelease:click360ServiceWorkerRelease.buildSha===CLICK360_RELEASE_ASSETS['app.js']}));
    assert(workerProof.controlled&&workerProof.sameRelease,'Actual installed worker must match the served app before signing in');
    assert(await page.evaluate(()=>window.click360FirestoreTransport==='long_polling'),'Use the real app SDK transport, never a harness-only override');
    assert(await page.evaluate(()=>!!window.click360SparkOperationalSession&&window.click360SparkBootstrapState?.phase==='READY'),'Authentication automatically connects the modular PWA before any commercial action');
    assert(await page.evaluate(()=>click360GetTenantState().legalAcceptances?.some(a=>a.id==='legal-qa')),
      'Restore existing consent from its actual configuration source path; do not waive the legal gate');
    const legacyBefore=await readCloud(env,uid);
    let restarted=page;
    if(process.env.CLICK360_SPARK_UI_WORKER_ONLY!=='1'){
    await page.evaluate(async({projectId,uid})=>{
      window.addEventListener('click360-spark-operation-status',event=>{window.SPARK_UI_STATUS=event.detail;});
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
    await page.evaluate(()=>{location.hash='#settings';});
    await page.locator('#bizName').fill('Negocio modular configurado');
    await page.locator('#bizRuc').fill('0000000000');await resetStatus();await page.locator('#saveBiz').click();await confirmed();
    assert((await record('config','main')).name==='Negocio modular configurado','Actual business profile saves config/main, not legacy');
    assert((await record('config','main')).settings.ruc==='0000000000','Actual fiscal profile survives authoritative projection');
    assert((await readCloud(env,uid)).revision===legacyBefore.revision,'Business settings do not write legacy');
    await page.evaluate(()=>{location.hash='#crm';});await page.locator('#newCustomerBtn').click();
    await page.locator('#customerName').fill('Cliente modular sintético');await page.locator('#customerPhoneCrm').fill('000');
    await page.locator('#customerNotes').fill('Solo fixture');await resetStatus();await page.locator('#customerForm button[type="submit"]').click();await confirmed();
    const customer=await page.evaluate(()=>click360GetTenantState().settings.customers.find(c=>c.name==='Cliente modular sintético'));
    assert((await record('customers',customer.id)).name===customer.name,'Real customer form persists individual record');
    await page.locator(`[data-customer-edit="${customer.id}"]`).click();await page.locator('#customerNotes').fill('Edición sintética');
    await resetStatus();await page.locator('#customerForm button[type="submit"]').click();await confirmed();
    assert((await record('customers',customer.id)).notes==='Edición sintética'&&(await record('customers',customer.id)).recordVersion===2,'Real edit preserves identity and advances revision');
    await resetStatus();await page.locator(`[data-customer-delete="${customer.id}"]`).click();await confirmed();
    const deletedCustomer=await record('customers',customer.id);
    assert(deletedCustomer.deleted===true&&deletedCustomer.recordVersion===3&&deletedCustomer.notes==='Edición sintética','Real delete preserves historical fields in an individual tombstone');
    assert(await page.evaluate(id=>click360GetTenantState().settings.customers.some(c=>c.id===id&&c.deleted===true),customer.id),'Tombstone remains durable locally');
    assert(await page.locator(`[data-customer-delete="${customer.id}"]`).count()===0,'Deleted customer disappears from actual list, not historical storage');
    await page.evaluate(()=>{location.hash='#inventory';});await page.locator('#newProduct').waitFor();
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
    await page.locator('#pQty').fill('11');await page.locator('#pName').fill('Edición y stock atómicos');
    await resetStatus();await page.locator('#productForm button[type="submit"]').click();await confirmed();
    const compoundProduct=await record('products',created.id);
    assert(compoundProduct.stock===11&&compoundProduct.name==='Edición y stock atómicos','Same form commits metadata and stock atomically');
    const compoundOp=await page.evaluate(()=>click360GetTenantState().products.find(p=>p.code==='SPARK-NEW').lastOperationId);
    assert((await record('movements',compoundOp)).quantityDelta===1,'Compound form produces one exact adjustment movement');
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
    await page.evaluate(()=>{location.hash='#debtors';});
    for(const [method,amount]of [['Apartado',3],['Pendiente',4]]){
      const receivable=await page.evaluate(method=>click360GetTenantState().sales.find(s=>s.method===method),method);
      await page.locator(`button[onclick*="payLayaway('${receivable.id}')"]`).click();
      await page.locator('#layawayPaymentAmount').fill(String(amount));await page.locator('#layawayPaymentMethod').selectOption('Transferencia');
      await resetStatus();await page.locator('#confirmLayawayPayment').click();await confirmed();
      const remote=await record('sales',receivable.storageRecordId),local=await page.evaluate(id=>click360GetTenantState().sales.find(s=>s.id===id),receivable.id);
      assert(remote.balance===receivable.balance-amount&&local.balance===remote.balance,'Actual payment modal commits the exact outstanding balance');
      const operation=local.payments.at(-1).operationId,receipt=await record('movements',operation);
      assert(receipt.amount===amount&&receipt.cashSessionId===session.id&&receipt.saleId===receivable.storageRecordId,'Receipt belongs to exact payment session, not original sale replay');
      if(method==='Apartado')assert((await record('layaways',receivable.layawayId)).balance===remote.balance,'Reservation and sale balances atomic');
    }
    assert((await record('products',created.id)).stock===9,'Subsequent payments must never discount stock');
    assert((await record('cashSessions',session.id)).saleCount===3,'Subsequent payments must never recount sales');
    await page.evaluate(()=>{location.hash='#cash';});await page.locator('#newMove').click();
    await page.locator('#mKind').selectOption('ingreso');await page.locator('#mAmount').fill('5');await page.locator('#mNote').fill('Ingreso sintético Spark');
    await resetStatus();await page.locator('#moveForm button[type="submit"]').click();await confirmed();
    const cashSession=await record('cashSessions',session.id);
    assert(cashSession.cashBalance===5&&cashSession.incomeCash===5,'Cash movement/session atomic delta');
    // Real financial commit succeeds under client Rules; lose only its
    // response and all immediate confirmation reads. No server state is faked.
    await page.evaluate(reportId=>{
      const db=firebase.firestore(),original=db.runTransaction.bind(db);let responseLost=false;
      window.SPARK_RESTORE_TRANSACTION_TRANSPORT=()=>{db.runTransaction=original;};
      db.runTransaction=async(...args)=>{
        if(responseLost)throw Object.assign(Error('SYNTHETIC_CONFIRMATION_UNAVAILABLE'),{code:'unavailable'});
        const result=await original(...args);
        if(result?.operationId===reportId&&result.status==='committed'){
          responseLost=true;throw Object.assign(Error('SYNTHETIC_RESPONSE_LOST_AFTER_REAL_COMMIT'),{code:'unavailable'});
        }
        return result;
      };
    },`report-${session.id}-${cashSession.closeCycle}`);
    await page.locator('#closeDayBtn').click();await page.locator('#efectivoFisico').fill('5');
    await resetStatus();await page.locator('#closeDaySubmitBtn').click();
    await page.waitForFunction(()=>window.SPARK_UI_COMMIT);
    assert(await page.evaluate(()=>SPARK_UI_COMMIT.pending&&!SPARK_UI_COMMIT.operationalCloudConfirmed
      &&SPARK_UI_STATUS.status==='UNKNOWN'),'Lost response cannot be called cloud confirmed');
    const closed=await record('cashSessions',session.id),closeReport=await record('dailyReports',closed.reportId);
    assert(closed.status==='closed'&&closeReport.cashSessionId===session.id,'Exact cash session/report closed');
    assert((await page.evaluate(()=>click360SparkOperationalSession.health())).unknownCount===1,'Complete durable journal retains uncertain close');
    await page.evaluate(()=>SPARK_RESTORE_TRANSACTION_TRANSPORT());
    await page.evaluate(target=>click360SparkOperationalSession.verifyCashClose(target),{businessId:uid,cashSessionId:session.id,date:session.date});
    await confirmed();
    assert(closeReport.saleCount===3&&closeReport.total===54&&closeReport.totalItems===3
      &&closeReport.paymentTotals.transfer===39&&closeReport.paymentTotals.receivablePayments===9&&closeReport.theoreticalCash===5&&closeReport.declaredCash===5,'Authoritative close counters');
    assert((await record('products',created.id)).stock===9&&(await record('products',data.products[0].id)).stock===1,'Cash close cannot decrement stock again');
    const localReport=await page.evaluate(id=>click360GetTenantState().dailyReports.find(r=>r.id===id),closed.reportId);
    assert(localReport.productQuantity===3&&localReport.paymentTotals.transfer===39&&localReport.paymentTotals.receivablePayments===9&&!localReport.html,'Derived report uses authoritative compact data');
    const existingClose=await page.evaluate(target=>window.click360SparkOperationalSession.verifyCashClose(target),
      {businessId:uid,cashSessionId:session.id,date:session.date});
    assert(existingClose.closed&&existingClose.source==='server'&&existingClose.reportId===closed.reportId,'Retry preflight recognizes and durably projects existing close');
    assert((await record('dailyReports',closed.reportId)).operationId===existingClose.operationId,'Recovery cannot create another close');
    const closeAudit=await record('auditEvents',`audit-${existingClose.operationId}`);
    assert(closeAudit.action==='cash_close'&&closeAudit.operationId===existingClose.operationId,'Lost-response recovery reconstructs audit from ledger');
    await page.locator('#modalRoot [data-close]').first().click();
    await page.evaluate(()=>{location.hash='#cash';});
    await page.locator('#reopenCashBtn').waitFor({state:'visible'});
    page.removeAllListeners('dialog');
    page.on('dialog',dialog=>dialog.accept(dialog.type()==='prompt'?'Continuar jornada sintética':undefined).catch(()=>{}));
    await resetStatus();await page.locator('#reopenCashBtn').click();await confirmed();
    const successor=await page.evaluate(()=>click360GetTenantState().cashSessions.find(s=>s.status==='open'));
    assert(successor.id!==session.id&&successor.date===session.date&&successor.openingAmount===5
      &&successor.saleCount===0&&successor.salesTotal===0,'Actual reopen creates a separate session from the exact declared closing cash');
    assert(JSON.stringify(await record('cashSessions',session.id))===JSON.stringify(closed),'New session cannot alter the preceding closed session');
    assert((await record('dailyReports',closed.reportId)).status==='reopened'
      &&(await record('dailyReports',closed.reportId)).total===54,'Previous report retains its financial totals');
    const previousCloseAgain=await page.evaluate(target=>click360SparkOperationalSession.verifyCashClose(target),
      {businessId:uid,cashSessionId:session.id,date:session.date});
    assert(previousCloseAgain.closed&&previousCloseAgain.operationId===existingClose.operationId,
      'A reopened historical report cannot cause a confirmed preceding close to be repeated');
    assert((await record('movements',successor.operationId||successor.lastOperationId)).amount===5,'Exactly one new opening movement');
    await page.locator('#closeDayBtn').click();await page.locator('#efectivoFisico').fill('5');await resetStatus();
    await page.locator('#closeDaySubmitBtn').click();await confirmed();
    const successorClosed=await record('cashSessions',successor.id),successorReport=await record('dailyReports',successorClosed.reportId);
    assert(successorReport.saleCount===0&&successorReport.total===0&&successorReport.declaredCash===5,
      'Closing a successor does not recount preceding sales');
    assert((await record('products',created.id)).stock===9&&(await record('products',data.products[0].id)).stock===1,
      'Reopening and closing never repeat inventory deductions');
    await page.locator('#modalRoot [data-close]').first().click();
    // The existing working-date control, not a DEV-only domain command.
    await page.locator('#workingDateInput').fill('2026-09-03');
    await page.locator('#workingDateInput').dispatchEvent('change');
    await page.locator('#apertureAmountInput').fill('0');await resetStatus();await page.locator('#startDayBtnCash').click();await confirmed();
    const historical=await page.evaluate(()=>click360GetTenantState().cashSessions.find(s=>s.status==='open'));
    assert(historical.id!==session.id&&historical.date==='2026-09-03','Historical working date opens a different exact session');
    await page.evaluate(()=>{location.hash='#sell';});await page.locator('#manualCode').fill('SPARK-LIVE');await page.locator('#addCode').click();
    await page.locator('#payMethod').selectOption('Transferencia');await resetStatus();await page.locator('#chargeBtn').click();await confirmed();
    const historicalSale=await page.evaluate(()=>click360GetTenantState().sales.at(-1));
    const historicalSaleRecord=await record('sales',historicalSale.operationId),historicalMove=await record('movements',historicalSale.operationId);
    assert(historicalSaleRecord.date==='2026-09-03'&&historicalMove.date==='2026-09-03'
      &&historicalSaleRecord.cashSessionId===historical.id&&historicalMove.cashSessionId===historical.id,'Historical sale/movement use exact date and session');
    await page.locator('#doneSaleBtn').click();await page.evaluate(()=>{location.hash='#cash';});
    await page.locator('#closeDayBtn').click();await page.locator('#efectivoFisico').fill('0');await resetStatus();
    await page.locator('#closeDaySubmitBtn').click();await confirmed();
    const historicalClosed=await record('cashSessions',historical.id),historicalReport=await record('dailyReports',historicalClosed.reportId);
    assert(historicalReport.saleCount===1&&historicalReport.total===30&&historicalReport.cashSessionId===historical.id
      &&historicalReport.date==='2026-09-03','Historical close excludes sales from the other session');
    assert((await record('products',data.products[0].id)).stock===0&&(await record('dailyReports',closed.reportId)).total===54,'Historical operation changes stock once and preserves earlier report');
    await page.evaluate(()=>{location.hash='#inventory';});await page.locator('#productSearch').fill('SPARK-NEW');
    await resetStatus();await page.locator(`[data-del="${created.id}"]`).click();await confirmed();
    const deletedProduct=await record('products',created.id);
    assert(deletedProduct.deleted===true&&deletedProduct.stock===9,'Actual delete preserves stock after the two previously confirmed sales');
    assert(await page.evaluate(id=>!click360GetTenantState().products.some(p=>p.id===id)
      &&click360GetTenantState().deletedProducts.some(p=>p.id===id&&p.deleted===true),created.id),'Existing catalog hides the deleted record and durably retains its tombstone');
    const health=await page.evaluate(()=>window.click360SparkOperationalSession.health());
    assert(health.pendingCount===0&&health.unknownCount===0&&health.projectionPendingCount===0,'Durable local projection completed');
    assert(JSON.stringify(await readCloud(env,uid))===JSON.stringify(legacyBefore),'No legacy overwrite');
    await page.evaluate(()=>{location.hash='#cash';});
    await page.locator('#workingDateInput').fill('2026-09-04');await page.locator('#workingDateInput').dispatchEvent('change');
    await page.locator('#apertureAmountInput').fill('0');await resetStatus();await page.locator('#startDayBtnCash').click();await confirmed();
    const activeBeforeRestart=await page.evaluate(()=>click360GetTenantState().cashSessions.find(s=>s.status==='open').id);
    // These explicitly empty historical sessions sort before the real active
    // session. Their matching reports are fixtures, never customer repairs.
    await seed(env,async db=>{
      for(let index=0;index<101;index++){
        const id=`a-history-${String(index).padStart(3,'0')}`,reportId=`report-${id}`;
        const common={ownerUid:uid,businessId:uid,tenantKey:`owner:${uid}:business:${uid}`,storageSchemaVersion:2,recordVersion:1};
        const session={...common,id,module:'cashSessions',status:'closed',date:'2026-08-01',reportId,summaryVersion:1,
          openingAmount:0,cashBalance:0,saleCount:0,salesTotal:0,itemCount:0,taxTotal:0,incomeCash:0,expenseCash:0,
          paymentTotals:{cash:0,card:0,transfer:0,receivablePayments:0},closeCycle:1};
        const report={...common,id:reportId,module:'dailyReports',cashSessionId:id,date:session.date,status:'closed',
          openingAmount:0,declaredCash:0,theoreticalCash:0,difference:0,saleCount:0,total:0,totalItems:0,totalIva:0,
          incomeCash:0,expenseCash:0,paymentTotals:session.paymentTotals,closeCycle:1};
        for(const [moduleName,record]of [['cashSessions',session],['dailyReports',report]])
          await setDoc(doc(db,`${base}/${moduleName}/${record.id}`),
            await globalThis.CLICK360_SPARK_RECORD_CODEC.pack(record,{identity,moduleName,recordId:record.id}));
        for(const [moduleName,fields]of [['customers',{name:`Cliente sintético ${index}`,phone:'',notes:''}],
          ['auditEvents',{action:'synthetic_history',createdBy:uid,when:'2026-08-01'}]]){
          const recordId=`a-${moduleName}-${String(index).padStart(3,'0')}`;
          await setDoc(doc(db,`${base}/${moduleName}/${recordId}`),
            await globalThis.CLICK360_SPARK_RECORD_CODEC.pack({...common,...fields,id:recordId,module:moduleName},
              {identity,moduleName,recordId}));
        }
      }
    });
    const runtime=await page.evaluate(()=>({global:!!CLICK360_SPARK_OPERATIONAL_UI,hash:CLICK360_RELEASE_ASSETS['app.js'],sale:click360GetTenantState().sales.at(-1).id}));
    assert(runtime.sale,'Existing receipt ID preserved');
    const contender=await device.context.newPage();
    try{
      await contender.goto(url,{waitUntil:'domcontentloaded'});
      await contender.waitForFunction(()=>window.click360SparkBootstrapState?.phase==='BLOCKED');
      assert(await contender.evaluate(()=>click360SparkBootstrapState.reason==='SPARK_BOOTSTRAP_DEVICE_ALREADY_ACTIVE'),
        'A second tab cannot start another coordinator for the same device');
      assert(await page.evaluate(()=>click360SparkAccessGate().allowed===true),'The active tab remains authorized');
    }finally{await contender.close();}
    // Destroy the document, not IndexedDB. The next document must rebuild the
    // same operational UI automatically; no test-created repository/session.
    const durableBefore=await page.evaluate(async()=>{
      const state=click360GetTenantState();
      return {business:state.activeBusinessId,sales:state.sales.map(s=>s.operationId).sort(),
        stock:state.products.map(p=>[p.id,p.stock]).sort(),deleted:state.deletedProducts.map(p=>p.id).sort()};
    });
    await page.close();
    restarted=await device.context.newPage();device.page=restarted;
    await restarted.goto(url,{waitUntil:'domcontentloaded'});
    await restarted.waitForFunction(()=>{
      if(window.click360SparkBootstrapState?.phase==='BLOCKED')throw Error(window.click360SparkBootstrapState.reason);
      return window.click360SparkBootstrapState?.phase==='READY'&&!!window.click360SparkOperationalSession;
    });
    const durableAfter=await restarted.evaluate(()=>{
      const state=click360GetTenantState();
      return {business:state.activeBusinessId,sales:state.sales.map(s=>s.operationId).sort(),
        stock:state.products.map(p=>[p.id,p.stock]).sort(),deleted:state.deletedProducts.map(p=>p.id).sort()};
    });
    assert(JSON.stringify(durableAfter)===JSON.stringify(durableBefore),'Automatic cold document restart preserves sales, stock and tombstones');
    assert(await restarted.evaluate(()=>click360SparkAccessGate().allowed===true),'Actual authorization remains valid after restart');
    assert(await restarted.evaluate(id=>click360GetTenantState().cashSessions.some(s=>s.id===id&&s.status==='open'),activeBeforeRestart),
      'Exact active cash session survives outside the first hundred historical rows');
    await restarted.evaluate(()=>{location.hash='#cash';});
    assert(await restarted.locator('#workingDateInput').inputValue()==='2026-09-04','Historical working date survives document restart');
    const reportPage=restarted.locator('[data-spark-history="dailyReports"]');
    await reportPage.waitFor({state:'visible'});
    assert(await reportPage.count()===1,'Actual cash history exposes bounded server pagination');
    await reportPage.click();
    await restarted.waitForFunction(()=>click360SparkCoordinator.phase()==='READY'
      &&!click360SparkCoordinator.hasMore('dailyReports'));
    assert(await restarted.evaluate(id=>click360GetTenantState().dailyReports.filter(r=>r.businessId===id).length===104,uid),
      'Next server page includes all 101 synthetic historical reports and three operational closes');
    assert(await restarted.locator('[data-spark-history="dailyReports"]').count()===0,'Exhausted history cannot issue repeated page reads');
    const afterHistory=await restarted.evaluate(()=>{
      const state=click360GetTenantState();
      return {business:state.activeBusinessId,sales:state.sales.map(s=>s.operationId).sort(),
        stock:state.products.map(p=>[p.id,p.stock]).sort(),deleted:state.deletedProducts.map(p=>p.id).sort()};
    });
    assert(JSON.stringify(afterHistory)===JSON.stringify(durableAfter),'Reading history cannot change sales or stock');
    for(const [route,source,recordId]of [['crm','settings.customers','a-customers-100'],['activity','auditLogs','a-auditEvents-100']]){
      await restarted.evaluate(route=>{location.hash=`#${route}`;},route);
      const nextPage=restarted.locator(`[data-spark-history="${source}"]`);await nextPage.waitFor({state:'visible'});
      await nextPage.click();
      await restarted.waitForFunction(source=>click360SparkCoordinator.phase()==='READY'
        &&!click360SparkCoordinator.hasMore(source),source);
      assert(await restarted.evaluate(({source,recordId})=>{
        const state=click360GetTenantState(),rows=source==='auditLogs'?state.auditLogs:state.settings.customers;
        return rows.some(row=>row.id===recordId);
      },{source,recordId}),`Actual ${route} UI loads beyond row 100 without a legacy reader`);
    }
    await restarted.evaluate(()=>{location.hash='#cash';});
    await restarted.locator('#closeDayBtn').waitFor({state:'visible'});
    assert(JSON.stringify(await readCloud(env,uid))===JSON.stringify(legacyBefore),'Restart cannot write legacy');
    const secondDevice=await openSignedIn(browser,{width:1280,height:800});
    try{
      const observed=await secondDevice.page.evaluate(()=>{
        const state=click360GetTenantState();
        return {business:state.activeBusinessId,sales:state.sales.map(s=>s.operationId).sort(),
          stock:state.products.map(p=>[p.id,p.stock]).sort(),deleted:state.deletedProducts.map(p=>p.id).sort()};
      });
      assert(JSON.stringify(observed)===JSON.stringify(durableAfter),'An independent browser storage context sees the same authoritative commerce');
    }finally{await secondDevice.context.close();}
    await restarted.locator('#businessPickerTop').click();
    await restarted.locator(`[data-business-switch="${otherBusiness}"]`).click();
    await restarted.waitForFunction(id=>click360GetActiveBusinessId()===id
      &&click360SparkCoordinator.phase()==='READY',otherBusiness);
    assert(await restarted.evaluate(id=>click360SparkOperationalSession.identity.businessId===id
      &&click360GetTenantState().products.some(p=>p.id==='other-product'&&p.businessId===id&&p.stock===7),otherBusiness),
      'Actual business switch installs the right repository without losing the other business');
    await restarted.evaluate(()=>{location.hash='#cash';});
    assert(await restarted.locator('#workingDateInput').inputValue()!=='2026-09-04','Working date cannot leak from the other business');
    await restarted.locator('#businessPickerTop').click();await restarted.locator(`[data-business-switch="${uid}"]`).click();
    await restarted.waitForFunction(id=>click360GetActiveBusinessId()===id&&click360SparkCoordinator.phase()==='READY',uid);
    assert(await restarted.evaluate(id=>click360GetTenantState().sales.filter(s=>s.businessId===id).length===4,uid),
      'Returning to the original business recovers its four unique financial sales');
    assert(await restarted.locator('#workingDateInput').inputValue()==='2026-09-04','Returning restores this business own historical date');
    assert(JSON.stringify(await readCloud(env,uid))===JSON.stringify(legacyBefore),'Both business switches leave the shared legacy document intact');
    results.push({browser:label,source:'served-built-PWA+Web-SDK+Auth/Firestore-emulators',productCreate:true,productEdit:true,productDeletePreservesHistory:true,compoundProductAndStock:true,inventoryAdjust:true,cashOpeningZero:true,cashClose:true,lostCloseResponseRecovered:true,authoritativeReport:true,sale:true,historicalSaleAndClose:true,initialLayaway:true,pendingPaymentSale:true,subsequentReceipts:true,cashMovement:true,stockOnce:true,legacyUnchanged:true,
      automaticAuthBootstrap:true,automaticColdRestart:true,secondDeviceAuthoritativeRead:true,twoBusinessRepositorySwitch:true,
      duplicateTabCoordinatorDenied:true,
      exactActiveCashBeyondHistoryPage:true,
      durableWorkingDatePerBusiness:true,
      cashHistoryServerPagination:true,
      customerAndActivityServerPagination:true,
      reopenCreatesExactNewSession:true,
      durableProjection:true,serviceWorkerControlled:workerProof.controlled,serviceWorkerMatchesBuild:workerProof.sameRelease,
      appFirestoreTransport:'long_polling',customerCreateAndEdit:true,customerDeletePreservesHistory:true,
      fullOperationalUI:false,migration:false,physicalAcceptance:false,productionWrites:0});
    assert(device.pageErrors.length===0,JSON.stringify({pageErrors:device.pageErrors}));
    }
    // Publish the business-only mode proof with the OWNER WEB SDK/Rules, not
    // disabled Rules. A worker must never read the private owner root proof.
    await restarted.evaluate(async({ownerUid,businessId})=>{
      const proof=(await click360Db.doc(`businesses/${ownerUid}/metadata/storage`).get({source:'server'})).data();
      const account=(await click360Db.doc(`accountAccess/${ownerUid}`).get({source:'server'})).data();
      const flat={id:'storage',ownerUid,businessId,tenantKey:`owner:${ownerUid}:business:${businessId}`,
        storageSchemaVersion:2,module:'metadata',recordVersion:1,storageMode:'modular',phase:'MODULAR',semanticEquality:'PASS',
        sourceHash:proof.sourceHash,reconstructedHash:proof.reconstructedHash,
        accountPlan:account.plan,manualLimitOverrides:account.manualLimitOverrides||{}};
      const raw=await CLICK360_SPARK_RECORD_CODEC.pack(flat,{identity:{ownerUid,businessId},moduleName:'metadata',recordId:'storage'});
      await click360Db.doc(`businesses/${ownerUid}/businessUnits/${businessId}/storage/v2/metadata/storage`).set(raw);
    },{ownerUid:uid,businessId:uid});
    if(process.env.CLICK360_SPARK_UI_WORKER_ONLY!=='1'){
      await restarted.waitForFunction(()=>!click360SparkOperationalSession.isBusy()&&!click360SparkCoordinator.isBusy()
        &&click360DebugCriticalActionGate().size===0);
      await restarted.evaluate(()=>{location.hash='#cash';});await restarted.locator('#closeDayBtn').click();
      await restarted.locator('#efectivoFisico').fill('0');
      await restarted.evaluate(()=>{window.FINAL_OWNER_CLOSE=null;window.addEventListener('click360-spark-operation-status',e=>window.FINAL_OWNER_CLOSE=e.detail);});
      await restarted.locator('#closeDaySubmitBtn').click();await restarted.waitForFunction(()=>window.FINAL_OWNER_CLOSE?.status==='CONFIRMED');
      assert(!(await restarted.evaluate(()=>click360GetTenantState().cashSessions.some(s=>s.status==='open'))),'Owner leaves no orphan open session before the worker journey');
    }
    await device.context.close();device=null;console.log(`PASS served Spark UI ${label}`);
    const workerPermissions={products:{read:true,create:true,update:true},sales:{read:true,create:true},
      cashSessions:{read:true,create:true,close:true},movements:{read:true,create:true},customers:{read:true,create:true,update:true},
      settings:{read:true},layaways:{read:true,payment:true}};
    await seed(env,async db=>{
      await setDoc(doc(db,`businesses/${uid}/featureFlags/workers`),{enabled:true});
      await setDoc(doc(db,`businesses/${uid}/businessUnits/${uid}/members/${workerUid}`),{
        uid:workerUid,ownerUid:uid,businessId:uid,tenantKey:`owner:${uid}:business:${uid}`,boundarySchemaVersion:1,
        status:'active',role:'cashier',permissions:workerPermissions});
      await setDoc(doc(db,`approvedUsers/${workerUid}`),{uid:workerUid,ownerId:uid,businessUnitId:uid,role:'cashier',
        approved:true,status:'active',email:workerEmail,name:'Trabajador sintético',permissions:workerPermissions});
      await setDoc(doc(db,`workerAccessRequests/${uid}_${workerUid}`),{ownerId:uid,uid:workerUid,businessUnitId:uid,status:'approved'});
    });
    device=await openSignedIn(browser,{width:390,height:844},workerEmail);
    let wp=device.page;
    const workerLifecycle=device.workerLifecycle=[];
    let workerStage='worker_started';
    const mark=stage=>{workerStage=stage;workerLifecycle.push({at:Date.now(),stage});};
    const observeWorkerPage=p=>{
      p.on('crash',()=>workerLifecycle.push({at:Date.now(),stage:workerStage,event:'page_crash'}));
      p.on('close',()=>workerLifecycle.push({at:Date.now(),stage:workerStage,event:'page_close'}));
    };
    observeWorkerPage(wp);
    device.context.on('close',()=>workerLifecycle.push({at:Date.now(),stage:workerStage,event:'context_close'}));
    browser.on('disconnected',()=>workerLifecycle.push({at:Date.now(),stage:workerStage,event:'browser_disconnected'}));
    await wp.evaluate(()=>{
      window.SPARK_WORKER_STATUS=null;
      window.addEventListener('click360-spark-operation-status',e=>{window.SPARK_WORKER_STATUS=e.detail;});
    });
    assert(await wp.evaluate(({ownerUid,actorUid})=>click360SparkOperationalSession.identity.ownerUid===ownerUid
      &&click360User.uid===actorUid&&click360GetTenantState().businesses.length===1,{ownerUid:uid,actorUid:workerUid}),
      'Actual worker login installs only the authorized business and actor');
    const denial=await wp.evaluate(async({ownerUid,otherBusiness})=>{
      const denied=async path=>{try{await click360Db.doc(path).get({source:'server'});return false;}catch(e){return e.code==='permission-denied';}};
      return {root:await denied(`businesses/${ownerUid}/metadata/storage`),
        foreignBusiness:await denied(`businesses/${ownerUid}/businessUnits/${otherBusiness}/storage/v2/products/other-product`)};
    },{ownerUid:uid,otherBusiness});
    assert(denial.root&&denial.foreignBusiness,'Worker cannot read owner-wide proof or another business');
    assert(await wp.evaluate(()=>click360User.access.plan==='founder_legacy'
      &&CLICK360_TENANT_QUOTA.planEntitlements(CLICK360_V16_DOMAIN,click360User.access.plan,click360User.manualLimitOverrides).limits.productsActive===2000),
      'Worker inherits the owner contract; a historical override 600 does not become Basic 150');
    await wp.locator('#newProduct').click();await wp.locator('#pCode').fill('WORKER-NEW');await wp.locator('#pName').fill('Producto de trabajador');
    await wp.locator('#pQty').fill('3');await wp.locator('#pCost').fill('1');await wp.locator('#pPrice').fill('5');await wp.locator('#pCardPrice').fill('5');
    await wp.locator('#productForm button[type="submit"]').click();await wp.waitForFunction(()=>window.SPARK_WORKER_STATUS?.status==='CONFIRMED');
    const workerProduct=await wp.evaluate(()=>click360GetTenantState().products.find(p=>p.code==='WORKER-NEW'));
    assert((await record('products',workerProduct.id)).stock===3,'Worker product creates one opening inventory record');
    await wp.locator('#productSearch').fill('WORKER-NEW');await wp.locator(`[data-edit="${workerProduct.id}"]`).click();
    await wp.locator('#pQty').fill('4');await wp.evaluate(()=>{window.SPARK_WORKER_STATUS=null;});await wp.locator('#productForm button[type="submit"]').click();
    await wp.waitForFunction(()=>window.SPARK_WORKER_STATUS?.status==='CONFIRMED');
    assert((await record('products',workerProduct.id)).stock===4,'Worker adjustment adds exactly one stock unit');
    await wp.evaluate(()=>{location.hash='#crm';});await wp.locator('#newCustomerBtn').click();
    await wp.locator('#customerName').fill('Cliente de trabajador');await wp.evaluate(()=>{window.SPARK_WORKER_STATUS=null;});
    await wp.locator('#customerForm button[type="submit"]').click();await wp.waitForFunction(()=>window.SPARK_WORKER_STATUS?.status==='CONFIRMED');
    const workerCustomer=await wp.evaluate(()=>click360GetTenantState().settings.customers.find(c=>c.name==='Cliente de trabajador'));
    assert((await record('customers',workerCustomer.id)).createdBy===workerUid,'Worker customer persists with actor identity');
    assert(await wp.evaluate(()=>click360SparkMutationGate({kind:'product_delete'}).allowed===false),'Worker UI refuses a missing delete permission');
    const deniedDelete=await wp.evaluate(async({ownerUid,productId})=>{
      try{await click360Db.doc(`businesses/${ownerUid}/businessUnits/${ownerUid}/storage/v2/products/${productId}`).delete();return false;}
      catch(e){return e.code==='permission-denied';}
    },{ownerUid:uid,productId:workerProduct.id});
    assert(deniedDelete&&(await record('products',workerProduct.id)).stock===4,'Client Rules reject deletion without altering inventory');
    await wp.waitForFunction(()=>!click360SparkOperationalSession.isBusy()&&!click360SparkCoordinator.isBusy()
      &&click360DebugCriticalActionGate().size===0);
    await wp.evaluate(()=>{location.hash='#cash';});
    // The owner's journey already closed today's session. Do not reopen it
    // as a worker or mistake that legitimate restriction for a boot failure.
    await wp.locator('#workingDateInput').fill('2026-09-05');await wp.locator('#workingDateInput').dispatchEvent('change');
    await wp.locator('#apertureAmountInput').fill('0');
    await wp.evaluate(()=>{window.SPARK_WORKER_STATUS=null;});
    await wp.locator('#startDayBtnCash').click();
    await wp.waitForFunction(()=>window.SPARK_WORKER_STATUS?.status==='CONFIRMED');
    const ws=await wp.evaluate(()=>click360GetTenantState().cashSessions.find(s=>s.status==='open'));
    assert((await record('cashSessions',ws.id)).createdBy===workerUid,'Worker opens exact session through actual UI and Rules');
    await wp.evaluate(()=>{location.hash='#sell';});await wp.locator('#manualCode').fill('WORKER-NEW');await wp.locator('#addCode').click();
    await wp.locator('#payMethod').selectOption('Transferencia');await wp.evaluate(()=>{window.SPARK_WORKER_STATUS=null;});await wp.locator('#chargeBtn').click();
    await wp.waitForFunction(()=>window.SPARK_WORKER_STATUS?.status==='CONFIRMED');
    const workerSale=await wp.evaluate(()=>click360GetTenantState().sales.at(-1));
    assert((await record('sales',workerSale.operationId)).createdBy===workerUid,'Worker sale confirmed by server with original actor');
    assert((await record('products',workerProduct.id)).stock===3&&(await record('movements',workerSale.operationId)).amount===5,
      'Worker sale consumes exactly one unit of the active product and one exact receipt');
    await wp.waitForFunction(()=>!click360SparkOperationalSession.isBusy()&&!click360SparkCoordinator.isBusy()
      &&click360DebugCriticalActionGate().size===0);
    // Reload the served application with its original native databases intact.
    // Auth, mode and member permissions must install the worker writer again,
    // without adopting an owner journal or replaying the confirmed sale.
    await wp.reload();
    await wp.waitForFunction(()=>!!window.click360SparkOperationalSession&&!!window.click360SparkCoordinator
      &&!click360SparkCoordinator.isBusy());
    assert(await wp.evaluate(({actorUid,sessionId,operationId,productId})=>click360User.uid===actorUid
      &&click360GetTenantState().businesses.length===1
      &&click360GetTenantState().cashSessions.some(s=>s.id===sessionId&&s.status==='open')
      &&click360GetTenantState().sales.filter(s=>s.operationId===operationId).length===1
      &&click360GetTenantState().products.find(p=>p.id===productId)?.stock===3,
      {actorUid:workerUid,sessionId:ws.id,operationId:workerSale.operationId,productId:workerProduct.id}),
      'Worker native bootstrap restores the exact session, sale and stock after reload');
    mark('first_offline');await device.context.setOffline(true);
    await wp.waitForFunction(()=>navigator.onLine===false);
    assert(await wp.evaluate(()=>!!click360SparkOperationalSession),'Temporary disconnection does not delete the authenticated worker journal');
    // Idle can still be the PRE-online state: arm a fresh event before
    // reconnect, then require its actual server recovery to finish. Do not
    // immediately interrupt that flight with the next offline transition.
    await wp.evaluate(()=>{
      window.WORKER_RECONNECT_PROOF=false;
      window.addEventListener('click360-spark-view-ready',()=>{window.WORKER_RECONNECT_PROOF=true;},{once:true});
    });
    mark('reconnecting');
    await device.context.setOffline(false);
    await wp.waitForFunction(()=>window.WORKER_RECONNECT_PROOF===true
      &&click360SparkBootstrapState?.phase==='READY'&&!!window.click360SparkCoordinator&&!click360SparkCoordinator.isBusy());
    mark('fresh_reconnect_complete');
    const workerHealth=await wp.evaluate(()=>click360SparkOperationalSession.health());
    assert(workerHealth.pendingCount+workerHealth.unknownCount+workerHealth.projectionPendingCount===0,
      'Worker reload and reconnect leave no unconfirmed journal or projection');
    assert((await record('products',workerProduct.id)).stock===3
      &&(await record('sales',workerSale.operationId)).createdBy===workerUid,
      'Worker reconnect preserves one confirmed operation and its exact stock');
    mark('second_offline');await device.context.setOffline(true);
    await wp.waitForFunction(()=>navigator.onLine===false);
    await wp.evaluate(()=>{
      location.hash='#sell';
      window.addEventListener('click360-spark-operation-status',e=>{window.SPARK_WORKER_STATUS=e.detail;});
    });
    const offlineIds=[];
    for(let i=0;i<2;i++){
      mark(`offline_sale_${i+1}`);
      await wp.locator('#manualCode').fill('WORKER-NEW');await wp.locator('#addCode').click();
      await wp.locator('#payMethod').selectOption('Transferencia');await wp.evaluate(()=>{window.SPARK_WORKER_STATUS=null;});
      await wp.locator('#chargeBtn').click();await wp.locator('#doneSaleBtn').waitFor({state:'visible'});
      offlineIds.push(await wp.evaluate(()=>click360GetTenantState().sales.at(-1).operationId));
      assert(await wp.evaluate(()=>window.SPARK_WORKER_STATUS?.status==='PENDING'),
        'A known offline sale remains pending, never falsely cloud-confirmed');
      await wp.locator('#doneSaleBtn').click();
    }
    const pendingWorker=await wp.evaluate(()=>click360SparkOperationalSession.health());
    assert(pendingWorker.pendingCount===2&&pendingWorker.unknownCount===0,'Both actual offline UI commands are durable');
    assert(await wp.evaluate(id=>click360GetTenantState().products.find(p=>p.id===id).stock===1,workerProduct.id),
      'Optimistic projection retains both offline stock deductions');
    assert((await record('products',workerProduct.id)).stock===3,'Offline candidates do not pretend to have changed server stock');
    mark('intentional_document_close');await wp.close();
    await device.context.setOffline(false);
    wp=await device.context.newPage();device.page=wp;
    observeWorkerPage(wp);mark('cold_online_recovery');
    await wp.goto(url,{waitUntil:'domcontentloaded'});
    await wp.waitForFunction(()=>{
      if(window.click360SparkBootstrapState?.phase==='BLOCKED')throw Error(click360SparkBootstrapState.reason);
      return window.click360SparkBootstrapState?.phase==='READY'&&!!window.click360SparkOperationalSession;
    });
    const replayedWorker=await wp.evaluate(()=>click360SparkOperationalSession.health());
    assert(replayedWorker.pendingCount+replayedWorker.unknownCount+replayedWorker.projectionPendingCount===0,
      'Cold document recovery drains the whole actor queue and durable projections');
    for(const id of offlineIds){
      assert((await record('sales',id)).createdBy===workerUid&&(await record('movements',id)).amount===5,
        'Each offline sale becomes one server sale and one exact payment movement');
      assert(await wp.evaluate(id=>click360GetTenantState().sales.filter(s=>s.operationId===id).length===1,id),
        'Server projection preserves the operation once in the actual UI');
    }
    assert((await record('products',workerProduct.id)).stock===1&&(await record('cashSessions',ws.id)).saleCount===3,
      'Restart replay applies the two stock deltas and cash counters exactly once');
    const nativeBefore=await wp.evaluate(()=>CLICK360_V16_STORAGE.getSnapshot(click360TenantContext));
    await seed(env,async db=>{await setDoc(doc(db,`businesses/${uid}/businessUnits/${uid}/members/${workerUid}`),{
      uid:workerUid,ownerUid:uid,businessId:uid,tenantKey:`owner:${uid}:business:${uid}`,boundarySchemaVersion:1,
      status:'revoked',role:'cashier',permissions:workerPermissions});});
    await wp.waitForFunction(()=>!click360User&& !click360SparkOperationalSession);
    assert(nativeBefore?.snapshot?.sales?.some(s=>s.operationId===workerSale.operationId),'Confirmed worker sale is durable before revocation');
    assert(JSON.stringify(await readCloud(env,uid))===JSON.stringify(legacyBefore),'Worker does not write the legacy monolith');
    if(process.env.CLICK360_SPARK_UI_WORKER_ONLY==='1')results.push({browser:label,workerFocusedDiagnostic:true,fullOperationalUI:false,migration:false,productionWrites:0});
    results.at(-1).workerNativeBootstrap=true;results.at(-1).workerCashAndSale=true;
    results.at(-1).workerBusinessIsolation=true;results.at(-1).workerRevocation=true;
    results.at(-1).workerProductAndInventory=true;results.at(-1).workerCustomer=true;results.at(-1).workerFounderFloor=true;
    results.at(-1).workerReloadRecovery=true;results.at(-1).workerReconnect=true;
    results.at(-1).workerTwoOfflineSalesColdRecovery=true;
    await device.context.close();device=null;console.log(`PASS served Spark worker ${label}`);
  }
  const budgetFailure=failureReason(readFileSync(path.join(path.dirname(config),'firestore-debug.log'),'utf8'));
  assert(!budgetFailure,budgetFailure);
  const text=JSON.stringify({status:'PASS',sourceCommitSha:process.env.CLICK360_QA_SOURCE_SHA||execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    sourceDirty:!!execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:root,encoding:'utf8'}).trim(),rulesBudgetErrors:0,results},null,2);
  writeFileSync(path.join(output,'results.json'),text);writeFileSync(path.join(output,`results-${Date.now()}.json`),text);console.log(text);
}catch(error){
  if(device?.page)console.log(JSON.stringify(await device.page.evaluate(()=>({status:window.SPARK_UI_STATUS,toast:document.querySelector('#toast')?.textContent,
    commit:window.SPARK_UI_COMMIT,lastFailure:window.click360LastSaveFailure,gate:window.click360WriteGate?.(),
    bootstrap:window.click360SparkBootstrapState,accessGate:window.click360SparkAccessGate?.(),
    gateText:document.querySelector('#click360-auth-gate')?.textContent,state:click360GetTenantState()?.cashSessions})).catch(()=>null)));
  if(device)console.log(JSON.stringify({pageErrors:device.pageErrors,workerLifecycle:device.workerLifecycle||[]}));
  throw error;
}finally{
  await device?.context.close();for(const browser of browsers)await browser.close();await env?.cleanup();stopProcessTree(server);stopProcessTree(emulators);log.end();
}
