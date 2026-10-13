// Explicit synthetic real-staging gate. No emulators, Functions or production.
// Operational certification only; seeded modular mode is NOT migration proof.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
import {connectAdmin,connectAuth} from '../scripts/lib/firebase-admin-connect.mjs';
import {getDeployedFirestoreRules} from '../scripts/lib/firestore-rules-remote.mjs';
import {largeTenantData,stateDocument,accountAccess} from './r38-emulator-support.mjs';
import '../spark-modular-migration.js';
import '../spark-modular-record-codec.js';
const PROJECT='click360-staging-7620168025',URL=`https://${PROJECT}.web.app/`;
const args=Object.fromEntries(process.argv.slice(2).map(s=>s.split('=')));
assert.equal(args['--project'],PROJECT,'EXPLICIT_SYNTHETIC_STAGING_REQUIRED');
assert.match(args['--sha']||'',/^[a-f0-9]{40}$/,'EXACT_SOURCE_SHA_REQUIRED');
for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST'])assert(!process.env[key],'REAL_STAGING_MUST_NOT_USE_EMULATOR');
const digest=b=>createHash('sha256').update(b).digest('hex');
const manifest=await fetch(URL+'release-manifest.json',{cache:'no-store'}).then(r=>r.json());
assert(args['--sha'].startsWith(manifest.buildSha),'STAGING_RELEASE_MISMATCH');
const assets=[];
for(const file of ['index.html','app.js','firebase-service.js','spark-operational-bootstrap.js','service-worker.js','tenant-quota-overrides.js','release-manifest.json']){
  const response=await fetch(URL+file,{cache:'no-store'});assert(response.ok);
  const bytes=Buffer.from(await response.arrayBuffer());assert(bytes.equals(await readFile('dist/'+file)),`SERVED_BUILD_MISMATCH:${file}`);
  assets.push({file,sha256:digest(bytes)});
}
const deployed=await getDeployedFirestoreRules(PROJECT);
assert.equal(digest(deployed.content),digest(await readFile('firestore.spark.rules')),'DEPLOYED_RULES_MISMATCH');
const directory='output/private/spark-real-staging-'+Date.now();await mkdir(directory,{recursive:true,mode:0o700});
const admin=await connectAdmin(PROJECT,'spark-synthetic-staging'),auth=await connectAuth(PROJECT);
assert.equal(admin.projectId,PROJECT,'ADMIN_FIXTURE_PROJECT_MISMATCH');
const results=[];let browser;
try{
  for(const [engine,name]of [[chromium,'chromium'],[webkit,'webkit']]){
    console.log(JSON.stringify({stage:'START',engine:name,project:PROJECT}));
    const uid='qa-spark-staging-'+randomUUID(),email=uid+'@click360-qa.invalid',password=randomBytes(32).toString('base64url');
    assert(uid.startsWith('qa-spark-staging-'));
    await auth.createUser({uid,email,password,emailVerified:true,displayName:'Synthetic Spark QA'});
    await writeFile(`${directory}/${name}-credentials.json`,JSON.stringify({projectId:PROJECT,uid,email,password}),{flag:'wx',mode:0o600});
    const data=largeTenantData(uid);data.products=data.products.slice(0,8);data.sales=[];data.movements=[];data.auditLogs=[];data.notifications=[];
    // The large state fixture intentionally has an invalid 40mm two-column
    // media. Use physically valid synthetic artwork for the PRINT journey;
    // never suppress the application's 92mm minimum geometry validation.
    const template=data.settings.labelTemplates[0];template.mediaWidthMm=100;
    template.universalDocument.paper.mediaWidthMm=100;
    Object.assign(template.universalDocument.objects.find(o=>o.type==='name'),{xMm:2,yMm:25});
    template.universalDocument.objects.find(o=>o.type==='price').xMm=2;
    Object.assign(data.products[0],{code:'STAGE-SPARK',price:30,cardPrice:30,stock:8,qty:8});
    const otherBusiness='other-'+uid;
    data.businesses.push({id:otherBusiness,name:'Second synthetic business',status:'activo',type:'ropa',settings:{}});
    data.products.push({id:'isolated-product',businessId:otherBusiness,code:'ISOLATED',name:'Isolated inventory',stock:7,qty:7,price:5,cardPrice:5,cost:1});
    const identity={ownerUid:uid,businessId:uid},envelope=stateDocument(uid,1,data);
    const plan=await CLICK360_SPARK_MIGRATION.plan({ownerUid:uid,snapshot:data,identity:envelope.payload.identity,remoteRevision:1});
    // Fixture initialization only. All business operations below use the PWA
    // client SDK and deployed Rules, never this administrative connection.
    const seedRows=[{path:`accountAccess/${uid}`,content:{...accountAccess(uid),source:'qa_spark_staging',manualLimitOverrides:{businesses:1,workers:1,productsActive:600}}},
      {path:`businesses/${uid}/state/main`,content:envelope},...plan.records,
      {path:`businesses/${uid}/metadata/storage`,content:{ownerUid:uid,schemaVersion:2,storageMode:'modular',phase:'MODULAR',semanticEquality:'PASS',sourceHash:plan.sourceHash,reconstructedHash:plan.sourceHash,businessIds:[uid,otherBusiness]}},
      {path:`businesses/${uid}/businessUnits/${uid}/storage/v2/metadata/runtime`,content:await CLICK360_SPARK_RECORD_CODEC.pack({id:'runtime',ownerUid:uid,businessId:uid,tenantKey:`owner:${uid}:business:${uid}`,storageSchemaVersion:2,module:'metadata',recordVersion:1,summaryVersion:1,openCashSessionId:''},{identity,moduleName:'metadata',recordId:'runtime'})}];
    const otherIdentity={ownerUid:uid,businessId:otherBusiness};
    seedRows.push({path:`businesses/${uid}/businessUnits/${otherBusiness}/storage/v2/metadata/runtime`,
      content:await CLICK360_SPARK_RECORD_CODEC.pack({id:'runtime',...otherIdentity,tenantKey:`owner:${uid}:business:${otherBusiness}`,
        storageSchemaVersion:2,module:'metadata',recordVersion:1,summaryVersion:1,openCashSessionId:''},
        {identity:otherIdentity,moduleName:'metadata',recordId:'runtime'})});
    for(let offset=0;offset<seedRows.length;offset+=25){const batch=admin.batch();for(const row of seedRows.slice(offset,offset+25))batch.create(admin.doc(row.path),row.content);await batch.commit();}
    const legacyBefore=(await admin.doc(`businesses/${uid}/state/main`).get()).data();
    browser=await engine.launch();
    const open=async(existingContext=null,login={email,password})=>{
      const context=existingContext||await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
      const trace=[];
      page.on('requestfailed',request=>{
        if(request.url().includes('firestore.googleapis.com'))trace.push(JSON.stringify({firestore:'request_failed',error:request.failure()?.errorText}));
      });
      page.on('console',message=>{if(message.type()==='error'||/label flow failed/.test(message.text()))trace.push(message.text().replace(/\?[^\s"']+/g,'?[redacted]'));});
      page.on('dialog',d=>d.accept());await page.goto(URL,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>typeof click360Auth?.signInWithEmailAndPassword==='function');
      assert.equal(await page.evaluate(()=>CLICK360_FIREBASE_CONFIG.projectId),PROJECT);
      // A document restart retains IndexedDB, not window event listeners.
      // Install the probe in EVERY new document, including the recovered one.
      await page.evaluate(()=>{
        window.QA_SPARK_STATUS=null;
        window.addEventListener('click360-spark-operation-status',e=>{window.QA_SPARK_STATUS=e.detail;});
      });
      if(!existingContext)await page.evaluate(({email,password})=>click360Auth.signInWithEmailAndPassword(email,password),login);
      try{await page.waitForFunction(()=>{
        if(window.click360SparkBootstrapState?.phase==='BLOCKED')throw Error(click360SparkBootstrapState.reason);
        return window.click360SparkBootstrapState?.phase==='READY'&&!!window.click360SparkOperationalSession;
      });}catch(error){
        const diagnostic=await page.evaluate(async()=>({
          authPresent:!!window.click360Auth?.currentUser,userPresent:!!window.click360User,
          phase:window.click360SparkBootstrapState?.phase,reason:window.click360SparkBootstrapState?.reason,
          coordinatorPresent:!!window.click360SparkCoordinator,sessionPresent:!!window.click360SparkOperationalSession,
          hydrated:window.click360IsTenantDataHydrated?.(),online:navigator.onLine,
          syncStatus:window.click360SyncStatus?.status,criticalActions:window.click360DebugCriticalActionGate?.().size,
          health:await window.click360SparkOperationalSession?.health(),
          recordSource:(await window.CLICK360_V16_STORAGE?.getSnapshot(window.click360TenantContext).catch(()=>null))?.source
        }));
        await writeFile(`${directory}/${name}-bootstrap-failure.json`,JSON.stringify({diagnostic,trace},null,2),{flag:'wx',mode:0o600});
        console.error(JSON.stringify({stage:'BOOTSTRAP_FAILED',engine:name,diagnostic,trace}));throw error;
      }
      console.log(JSON.stringify({stage:'BOOTSTRAP_READY',engine:name}));
      return {context,page};
    };
    let {context,page}=await open();
    await page.evaluate(()=>{location.hash='#cash';});
    await page.locator('#apertureAmountInput').fill('0');await page.locator('#startDayBtnCash').click();
    await page.waitForFunction(()=>window.QA_SPARK_STATUS?.status==='CONFIRMED');
    const cash=await page.evaluate(()=>click360GetTenantState().cashSessions.find(s=>s.status==='open'));
    await page.evaluate(()=>{window.QA_SPARK_STATUS=null;location.hash='#sell';});
    await page.locator('#manualCode').fill('STAGE-SPARK');await page.locator('#addCode').click();await page.locator('#payMethod').selectOption('Transferencia');
    await page.locator('#chargeBtn').click();await page.waitForFunction(()=>window.QA_SPARK_STATUS?.status==='CONFIRMED');
    const sale=await page.evaluate(()=>click360GetTenantState().sales.at(-1));
    const base=`businesses/${uid}/businessUnits/${uid}/storage/v2`;
    const record=async(module,id)=>{const snap=await admin.doc(`${base}/${module}/${id}`).get();assert(snap.exists);return CLICK360_SPARK_RECORD_CODEC.unpack(snap.data(),{identity,moduleName:module,recordId:id});};
    assert.equal((await record('products',data.products[0].id)).stock,7);
    assert.equal((await record('sales',sale.operationId)).cashSessionId,cash.id);
    assert.equal((await record('movements',sale.operationId)).amount,30);
    assert.equal((await record('operationLedger',sale.operationId)).status,'committed');
    await page.locator('#doneSaleBtn').click();
    await page.evaluate(()=>{
      window.QA_PRINT_CALLS=0;window.print=()=>window.QA_PRINT_CALLS++;
      location.hash='#inventory';
    });
    await page.locator('#productSearch').fill('STAGE-SPARK');await page.locator(`[data-label="${data.products[0].id}"]`).click();
    await page.locator('#quickLabelHomeQuantity').fill('1');await page.locator('#quickLabelHomePrint').click();
    await page.waitForFunction(()=>window.QA_PRINT_CALLS===1);
    assert.equal(await page.locator('#click360PrintPortal .labelPrintCell.filled').count(),1,'Print quantity must not equal stock');
    await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
    const close=page.locator('#modalRoot .modalHeader [data-close]');if(await close.count())await close.click();
    await page.waitForFunction(()=>!click360SparkOperationalSession.isBusy()&&!click360SparkCoordinator.isBusy());
    await context.setOffline(true);await page.waitForFunction(()=>navigator.onLine===false);
    await page.evaluate(()=>{location.hash='#sell';});
    const offlineIds=[];
    for(let n=0;n<2;n++){
      await page.locator('#manualCode').fill('STAGE-SPARK');await page.locator('#addCode').click();await page.locator('#payMethod').selectOption('Transferencia');
      await page.evaluate(()=>window.QA_SPARK_STATUS=null);await page.locator('#chargeBtn').click();await page.locator('#doneSaleBtn').waitFor({state:'visible'});
      assert.equal(await page.evaluate(()=>window.QA_SPARK_STATUS?.status),'PENDING');
      offlineIds.push(await page.evaluate(()=>click360GetTenantState().sales.at(-1).operationId));
      await page.locator('#doneSaleBtn').click();
    }
    const pending=await page.evaluate(()=>click360SparkOperationalSession.health());assert.equal(pending.pendingCount,2);assert.equal(pending.unknownCount,0);
    assert.equal((await record('products',data.products[0].id)).stock,7,'Offline commands cannot claim server confirmation');
    await page.close();await context.setOffline(false);({page}=await open(context));
    assert(await page.evaluate(id=>click360GetTenantState().sales.some(s=>s.operationId===id),sale.operationId));
    const recovered=await page.evaluate(()=>click360SparkOperationalSession.health());
    assert.equal(recovered.pendingCount+recovered.unknownCount+recovered.projectionPendingCount,0);
    for(const id of offlineIds){assert.equal((await record('movements',id)).amount,30);assert.equal((await record('operationLedger',id)).status,'committed');
      assert.equal(await page.evaluate(id=>click360GetTenantState().sales.filter(s=>s.operationId===id).length,id),1);}
    assert.equal((await record('products',data.products[0].id)).stock,5);
    assert.equal((await record('cashSessions',cash.id)).saleCount,3);
    const second=await open();
    assert.equal(await second.page.evaluate(id=>click360GetTenantState().products.find(p=>p.id===id).stock,data.products[0].id),5);
    await second.context.close();
    // Publish the scoped authority through the actual OWNER client Rules.
    await page.evaluate(async ownerUid=>{
      const root=(await click360Db.doc(`businesses/${ownerUid}/metadata/storage`).get({source:'server'})).data();
      const account=(await click360Db.doc(`accountAccess/${ownerUid}`).get({source:'server'})).data();
      const identity={ownerUid,businessId:ownerUid},flat={id:'storage',...identity,tenantKey:`owner:${ownerUid}:business:${ownerUid}`,
        storageSchemaVersion:2,module:'metadata',recordVersion:1,storageMode:'modular',phase:'MODULAR',semanticEquality:'PASS',
        sourceHash:root.sourceHash,reconstructedHash:root.reconstructedHash,accountPlan:account.plan,manualLimitOverrides:account.manualLimitOverrides||{}};
      await click360Db.doc(`businesses/${ownerUid}/businessUnits/${ownerUid}/storage/v2/metadata/storage`)
        .set(await CLICK360_SPARK_RECORD_CODEC.pack(flat,{identity,moduleName:'metadata',recordId:'storage'}));
    },uid);
    const workerUid='qa-spark-staging-'+randomUUID(),workerEmail=workerUid+'@click360-qa.invalid',workerPassword=randomBytes(32).toString('base64url');
    await auth.createUser({uid:workerUid,email:workerEmail,password:workerPassword,emailVerified:true,displayName:'Synthetic worker'});
    await writeFile(`${directory}/${name}-worker-credentials.json`,JSON.stringify({projectId:PROJECT,uid:workerUid,email:workerEmail,password:workerPassword}),{flag:'wx',mode:0o600});
    const permissions={products:{read:true,create:true,update:true},sales:{read:true,create:true},cashSessions:{read:true,create:true,close:true},
      movements:{read:true,create:true},customers:{read:true,create:true,update:true},settings:{read:true},layaways:{read:true,payment:true}};
    const member={uid:workerUid,ownerUid:uid,businessId:uid,tenantKey:`owner:${uid}:business:${uid}`,boundarySchemaVersion:1,status:'active',role:'cashier',permissions};
    const batch=admin.batch();
    batch.create(admin.doc(`businesses/${uid}/featureFlags/workers`),{enabled:true});
    batch.create(admin.doc(`businesses/${uid}/businessUnits/${uid}/members/${workerUid}`),member);
    batch.create(admin.doc(`approvedUsers/${workerUid}`),{uid:workerUid,ownerId:uid,businessUnitId:uid,role:'cashier',approved:true,status:'active',email:workerEmail,name:'Synthetic worker',permissions});
    batch.create(admin.doc(`workerAccessRequests/${uid}_${workerUid}`),{ownerId:uid,uid:workerUid,businessUnitId:uid,status:'approved'});
    await batch.commit();
    const worker=await open(null,{email:workerEmail,password:workerPassword});
    assert(await worker.page.evaluate(()=>CLICK360_TENANT_QUOTA.planEntitlements(CLICK360_V16_DOMAIN,click360User.access.plan,click360User.manualLimitOverrides).limits.productsActive===2000));
    // Keep these denials inside the authenticated worker's REAL PWA session.
    // Read-only transactions use authoritative RPC reads, not temporary Watch
    // targets, and cannot grant access or mutate the tested documents. The
    // separate watch diagnostic retains the failing forbidden-target sequence.
    assert(await worker.page.evaluate(async owner=>{
      try{await click360Db.runTransaction(tx=>tx.get(click360Db.doc(`businesses/${owner}/metadata/storage`)));return false;}catch(e){return e.code==='permission-denied';}
    },uid),'Worker must not read owner-wide authority');
    assert(await worker.page.evaluate(async({owner,other})=>{
      try{await click360Db.runTransaction(tx=>tx.get(click360Db.doc(`businesses/${owner}/businessUnits/${other}/storage/v2/products/isolated-product`)));return false;}
      catch(e){return e.code==='permission-denied';}
    },{owner:uid,other:otherBusiness}),'Worker must not read an unassigned business');
    await worker.page.evaluate(()=>{window.addEventListener('click360-spark-operation-status',e=>window.QA_WORKER_STATUS=e.detail);location.hash='#sell';});
    await worker.page.locator('#manualCode').fill('STAGE-SPARK');await worker.page.locator('#addCode').click();await worker.page.locator('#payMethod').selectOption('Transferencia');
    await worker.page.locator('#chargeBtn').click();await worker.page.waitForFunction(()=>window.QA_WORKER_STATUS?.status==='CONFIRMED');
    const workerSale=await worker.page.evaluate(()=>click360GetTenantState().sales.at(-1));
    assert.equal((await record('sales',workerSale.operationId)).createdBy,workerUid);assert.equal((await record('products',data.products[0].id)).stock,4);
    assert.equal((await record('cashSessions',cash.id)).saleCount,4);
    const workerContext=await worker.page.evaluate(()=>click360TenantContext);
    const workerSnapshot=await worker.page.evaluate(ctx=>CLICK360_V16_STORAGE.getSnapshot(ctx),workerContext);
    assert(workerSnapshot?.snapshot?.sales.some(s=>s.operationId===workerSale.operationId));
    const watchRequests=[];
    worker.page.on('requestfinished',request=>{
      if(request.url().includes('Firestore/Listen/'))watchRequests.push({event:'finished',timing:request.timing().responseEnd});
    });
    worker.page.on('requestfailed',request=>{
      if(request.url().includes('Firestore/Listen/'))watchRequests.push({event:'failed',error:request.failure()?.errorText});
    });
    await worker.page.evaluate(({owner,actor})=>{
      window.QA_MEMBER_EVENTS=[];
      window.QA_MEMBER_STOP=click360Db.doc(`businesses/${owner}/businessUnits/${owner}/members/${actor}`)
        .onSnapshot({includeMetadataChanges:true},snap=>QA_MEMBER_EVENTS.push({status:snap.data()?.status,cache:snap.metadata.fromCache}),
          error=>QA_MEMBER_EVENTS.push({error:error.code}));
    },{owner:uid,actor:workerUid});
    // The observer must be subscribed to a server-confirmed active record
    // before the fixture changes it. Registration alone is not a watch barrier.
    await worker.page.waitForFunction(()=>window.QA_MEMBER_EVENTS?.some(e=>e.status==='active'&&e.cache===false));
    await admin.doc(`businesses/${uid}/businessUnits/${uid}/members/${workerUid}`).update({status:'revoked'});
    try{await worker.page.waitForFunction(()=>!window.click360User&&!window.click360SparkOperationalSession);}
    catch(error){
      const diagnostic=await worker.page.evaluate(()=>({
        userPresent:!!window.click360User,sessionPresent:!!window.click360SparkOperationalSession,
        contextPresent:!!window.click360TenantContext,access:window.click360SparkAccessGate?.(),
        phase:window.click360SparkBootstrapState?.phase,memberEvents:window.QA_MEMBER_EVENTS
      }));
      console.error(JSON.stringify({stage:'REVOCATION_FAILED',engine:name,diagnostic,watchRequests}));
      await writeFile(`${directory}/${name}-revocation-failure.json`,JSON.stringify(diagnostic,null,2),{flag:'wx',mode:0o600});throw error;
    }
    assert.deepEqual(await worker.page.evaluate(ctx=>CLICK360_V16_STORAGE.getSnapshot(ctx),workerContext),workerSnapshot,'Revocation must preserve the durable worker snapshot');
    await worker.context.close();
    await page.locator('#businessPickerTop').click();await page.locator(`[data-business-switch="${otherBusiness}"]`).click();
    await page.waitForFunction(id=>click360GetActiveBusinessId()===id&&click360SparkBootstrapState?.phase==='READY',otherBusiness);
    assert(await page.evaluate(id=>click360SparkOperationalSession.identity.businessId===id
      &&click360GetTenantState().products.some(p=>p.id==='isolated-product'&&p.businessId===id&&p.stock===7)
      &&!click360GetTenantState().sales.some(s=>s.businessId===id),otherBusiness));
    await page.locator('#businessPickerTop').click();await page.locator(`[data-business-switch="${uid}"]`).click();
    await page.waitForFunction(id=>click360GetActiveBusinessId()===id&&click360SparkBootstrapState?.phase==='READY',uid);
    assert.equal(await page.evaluate(id=>click360GetTenantState().sales.filter(s=>s.businessId===id).length,uid),4);
    assert.equal(await page.evaluate(id=>click360GetTenantState().products.find(p=>p.id===id).stock,data.products[0].id),4);
    const resetStatus=async()=>{
      await page.waitForFunction(()=>!click360SparkOperationalSession.isBusy()&&!click360SparkCoordinator.isBusy());
      await page.evaluate(()=>{window.QA_SPARK_STATUS=null;});
    };
    const confirmed=async()=>{
      try{await page.waitForFunction(()=>window.QA_SPARK_STATUS?.status==='CONFIRMED');}
      catch(error){
        const diagnostic=await page.evaluate(async()=>({status:window.QA_SPARK_STATUS,
          phase:window.click360SparkBootstrapState?.phase,health:await click360SparkOperationalSession?.health(),
          toasts:document.querySelector('#toast')?.textContent}));
        console.error(JSON.stringify({stage:'COMMERCIAL_CONFIRMATION_FAILED',engine:name,diagnostic}));
        await writeFile(`${directory}/${name}-commercial-failure.json`,JSON.stringify(diagnostic,null,2),{flag:'wx',mode:0o600});throw error;
      }
    };
    const closeSession=async()=>{
      await page.evaluate(()=>{location.hash='#cash';});
      const session=await page.evaluate(()=>click360GetTenantState().cashSessions.find(s=>s.status==='open'));
      await page.locator('#closeDayBtn').click();await page.locator('#efectivoFisico').fill('0');
      await resetStatus();await page.locator('#closeDaySubmitBtn').click();await confirmed();
      const closed=await record('cashSessions',session.id),report=await record('dailyReports',closed.reportId);
      assert.equal(closed.status,'closed');assert.equal(report.cashSessionId,session.id);
      await page.locator('#modalRoot [data-close]').first().click();return {closed,report};
    };
    const originalClose=await closeSession();
    assert.equal(originalClose.report.total,120);assert.equal(originalClose.report.saleCount,4);
    page.removeAllListeners('dialog');
    page.on('dialog',d=>d.accept(d.type()==='prompt'?'Continuar jornada sintética':undefined));
    await resetStatus();await page.locator('#reopenCashBtn').click();await confirmed();
    const successor=await page.evaluate(()=>click360GetTenantState().cashSessions.find(s=>s.status==='open'));
    assert.notEqual(successor.id,cash.id);assert.equal(successor.date,cash.date);
    assert.deepEqual(await record('cashSessions',cash.id),originalClose.closed);
    const successorClose=await closeSession();
    assert.equal(successorClose.report.total,0);assert.equal(successorClose.report.saleCount,0);
    assert.equal((await record('products',data.products[0].id)).stock,4,'Close/reopen cannot repeat stock deductions');
    await page.locator('#workingDateInput').fill('2026-09-03');await page.locator('#workingDateInput').dispatchEvent('change');
    await page.locator('#apertureAmountInput').fill('0');await resetStatus();await page.locator('#startDayBtnCash').click();await confirmed();
    const historical=await page.evaluate(()=>click360GetTenantState().cashSessions.find(s=>s.status==='open'));
    assert.equal(historical.date,'2026-09-03');assert.notEqual(historical.id,cash.id);
    await page.evaluate(()=>{location.hash='#sell';});
    for(const method of ['Transferencia','Apartado','Pendiente']){
      await page.locator('#manualCode').fill('STAGE-SPARK');await page.locator('#addCode').click();await page.locator('#payMethod').selectOption(method);
      if(method!=='Transferencia'){
        await page.locator('#customer').fill('Cliente sintético');await page.locator('#customerPhone').fill('0000000000');
        await page.locator('#customerCedula').fill('SYNTHETIC-ONLY');
      }
      if(method==='Apartado'){
        await page.locator('#layawayDueDate').fill('2026-12-31');await page.locator('#layawayTermsAccepted').check();
        await page.locator('#layawayInitialMethod').selectOption('Transferencia');await page.locator('#cashReceived').fill('2');
      }
      await resetStatus();await page.locator('#chargeBtn').click();await confirmed();
      const sale=await page.evaluate(()=>click360GetTenantState().sales.at(-1));
      const remote=await record('sales',sale.operationId),receipt=await record('movements',sale.operationId);
      assert.equal(remote.date,'2026-09-03');assert.equal(remote.cashSessionId,historical.id);
      assert.equal(receipt.cashSessionId,historical.id);assert.equal(remote.total,30);
      assert.equal(receipt.amount,method==='Transferencia'?30:method==='Apartado'?2:0);
      await page.locator('#doneSaleBtn').click();
    }
    assert.equal((await record('products',data.products[0].id)).stock,1);
    await page.evaluate(()=>{location.hash='#debtors';});
    for(const [method,amount]of [['Apartado',3],['Pendiente',4]]){
      const receivable=await page.evaluate(method=>click360GetTenantState().sales.find(s=>s.method===method),method);
      await page.locator(`button[onclick*="payLayaway('${receivable.id}')"]`).click();
      await page.locator('#layawayPaymentAmount').fill(String(amount));await page.locator('#layawayPaymentMethod').selectOption('Transferencia');
      await resetStatus();await page.locator('#confirmLayawayPayment').click();await confirmed();
      const remote=await record('sales',receivable.storageRecordId);
      assert.equal(remote.balance,receivable.balance-amount);
      const local=await page.evaluate(id=>click360GetTenantState().sales.find(s=>s.id===id),receivable.id);
      const receipt=await record('movements',local.payments.at(-1).operationId);
      assert.equal(receipt.amount,amount);assert.equal(receipt.cashSessionId,historical.id);
      if(method==='Apartado')assert.equal((await record('layaways',receivable.layawayId)).balance,remote.balance);
    }
    assert.equal((await record('products',data.products[0].id)).stock,1,'Payments must not consume stock again');
    assert.equal((await record('cashSessions',historical.id)).saleCount,3,'Payments must not recount sales');
    const historicalClose=await closeSession();assert.equal(historicalClose.report.total,90);assert.equal(historicalClose.report.saleCount,3);
    assert.equal((await record('dailyReports',originalClose.closed.reportId)).total,120);
    await page.evaluate(()=>{location.hash='#crm';});await page.locator('#newCustomerBtn').click();
    await page.locator('#customerName').fill('Cliente staging integral');await page.locator('#customerPhoneCrm').fill('000');
    await resetStatus();await page.locator('#customerForm button[type="submit"]').click();await confirmed();
    const customer=await page.evaluate(()=>click360GetTenantState().settings.customers.find(c=>c.name==='Cliente staging integral'));
    await page.locator(`[data-customer-edit="${customer.id}"]`).click();await page.locator('#customerNotes').fill('Edición sintética');
    await resetStatus();await page.locator('#customerForm button[type="submit"]').click();await confirmed();
    assert.equal((await record('customers',customer.id)).notes,'Edición sintética');
    await page.evaluate(()=>{location.hash='#inventory';});await page.locator('#newProduct').click();
    await page.locator('#pCode').fill('STAGE-NEW');await page.locator('#pName').fill('Nuevo sintético');
    await page.locator('#pQty').fill('10');await page.locator('#pCost').fill('2');await page.locator('#pPrice').fill('12');await page.locator('#pCardPrice').fill('12');
    await resetStatus();await page.locator('#productForm button[type="submit"]').click();await confirmed();
    const created=await page.evaluate(()=>click360GetTenantState().products.find(p=>p.code==='STAGE-NEW'));
    assert.equal((await record('products',created.id)).stock,10);
    await page.locator('#productSearch').fill('STAGE-NEW');await page.locator(`[data-edit="${created.id}"]`).click();
    await page.locator('#pName').fill('Edición y stock atómicos');await page.locator('#pQty').fill('11');
    await resetStatus();await page.locator('#productForm button[type="submit"]').click();await confirmed();
    const edited=await record('products',created.id);assert.equal(edited.stock,11);assert.equal(edited.name,'Edición y stock atómicos');
    assert.equal((await record('movements',edited.lastOperationId)).quantityDelta,1);
    const finalHealth=await page.evaluate(()=>click360SparkOperationalSession.health());
    assert.equal(finalHealth.pendingCount+finalHealth.unknownCount+finalHealth.projectionPendingCount,0);
    await page.close();({page}=await open(context));
    for(const current of [page,(await open()).page]){
      const observed=await current.evaluate(({productId,createdId,customerId,businessId})=>{
        const s=click360GetTenantState();return {
          stock:s.products.find(p=>p.id===productId)?.stock,createdStock:s.products.find(p=>p.id===createdId)?.stock,
          notes:s.settings.customers.find(c=>c.id===customerId)?.notes,
          sales:s.sales.filter(s=>s.businessId===businessId).length,
          saleIds:new Set(s.sales.filter(s=>s.businessId===businessId).map(s=>s.operationId)).size,
          reports:s.dailyReports.filter(r=>r.businessId===businessId).length
        };
      },{productId:data.products[0].id,createdId:created.id,customerId:customer.id,businessId:uid});
      assert.deepEqual(observed,{stock:1,createdStock:11,notes:'Edición sintética',sales:7,saleIds:7,reports:3});
      if(current!==page)await current.context().close();
    }
    await page.evaluate(()=>{location.hash='#cash';});
    assert.equal(await page.locator('#workingDateInput').inputValue(),'2026-09-03');
    assert.deepEqual((await admin.doc(`businesses/${uid}/state/main`).get()).data(),legacyBefore,'LEGACY_STATE_MUST_REMAIN_UNCHANGED');
    results.push({engine:name,bootstrap:true,opening:true,sale:true,stock:1,ledgerOnce:true,coldRestart:true,indexedDBPreserved:true,
      twoOfflineSalesRecovered:true,pendingCount:0,unknownCount:0,printQuantityOne:true,secondDevice:true,legacyUnchanged:true,
      workerBootstrap:true,workerSale:true,workerFounderFloor:true,workerOwnerProofDenied:true,workerRevocationPreservesIndexedDB:true,
      twoBusinessSwitch:true,workerForeignBusinessDenied:true,otherBusinessStockUnchanged:true,
      exactCashClose:true,successorSession:true,historicalSales:true,layawayDeposit:true,receivablePayments:true,
      paymentsDoNotRepeatStockOrSales:true,customerCreateEdit:true,productCreateCompoundInventoryEdit:true,
      fullJourneyRestart:true,finalSecondDevice:true,historicalWorkingDatePreserved:true,
      seededSourceHash:plan.sourceHash,fixtureWrites:seedRows.length,migrationCertified:false});
    console.log(JSON.stringify({stage:'RETAIL_JOURNEY_PASS',engine:name}));
    await context.close();await browser.close();browser=null;
  }
  const evidence={status:'PASS',scope:'REAL_STAGING_RETAIL_JOURNEY_ONLY',buildSha:manifest.buildSha,projectId:PROJECT,url:URL,rulesSha256:digest(deployed.content),assets,results,productionWrites:0,commercialCutover:false};
  await writeFile(`${directory}/results.json`,JSON.stringify(evidence,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify(evidence));
}finally{await browser?.close();await admin.terminate();}
