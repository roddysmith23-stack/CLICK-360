// Real Spark staging, explicitly synthetic. Certifies preparation/readback only,
// not operational cutover, client recovery or production activation.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
import {connectAdmin,connectAuth} from '../scripts/lib/firebase-admin-connect.mjs';
import {getDeployedFirestoreRules} from '../scripts/lib/firestore-rules-remote.mjs';
import {largeTenantData,stateDocument,accountAccess,identity} from './r38-emulator-support.mjs';
import {waitForMigrationOutcome} from './spark-migration-progress.mjs';
import '../spark-modular-migration.js';
import '../spark-modular-handoff.js';
const PROJECT='click360-staging-7620168025',URL=`https://${PROJECT}.web.app/`;
const args=Object.fromEntries(process.argv.slice(2).map(s=>s.split('=')));
assert(args['--browser']===undefined||['chromium','webkit'].includes(args['--browser']),'UNSUPPORTED_FOCUSED_BROWSER');
assert(!args['--browser']||process.env.CI!=='true','FOCUSED_RUN_CANNOT_REPLACE_REQUIRED_MATRIX');
const recoveryOnly=args['--recovery-only']==='true';
assert(args['--runtime-preparation']===undefined||['true','false'].includes(args['--runtime-preparation']));
const runtimePreparation=!recoveryOnly&&args['--runtime-preparation']!=='false';
assert(args['--local-handoff']===undefined||['true','false'].includes(args['--local-handoff']));
const localHandoff=args['--local-handoff']==='true';
assert(!localHandoff||runtimePreparation,'LOCAL_HANDOFF_REQUIRES_RUNTIME_PREPARATION');
assert(args['--automatic-cutover']===undefined||['true','false'].includes(args['--automatic-cutover']));
const automaticCutover=args['--automatic-cutover']==='true';
assert(!automaticCutover||localHandoff,'AUTOMATIC_CUTOVER_REQUIRES_VERIFIED_HANDOFF');
assert.equal(args['--project'],PROJECT);assert.match(args['--sha']||'',/^[a-f0-9]{40}$/);
for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST'])assert(!process.env[key]);
const digest=value=>createHash('sha256').update(value).digest('hex');
const release=await fetch(URL+'release-manifest.json',{cache:'no-store'}).then(r=>r.json());
assert(args['--sha'].startsWith(release.buildSha),'SERVED_SHA_MISMATCH');
for(const file of ['index.html','app.js','firebase-service.js','service-worker.js','spark-migration-bootstrap.js',
  'spark-modular-importer.js','spark-modular-reconciliation.js','spark-modular-recovery.js','spark-modular-handoff.js']){
  const r=await fetch(URL+file,{cache:'no-store'});assert(r.ok);
  assert(Buffer.from(await r.arrayBuffer()).equals(await readFile('dist/'+file)),`SERVED_BYTES_MISMATCH:${file}`);
}
const rules=await getDeployedFirestoreRules(PROJECT),rulesHash=digest(rules.content);
assert.equal(rulesHash,digest(await readFile('firestore.spark.rules')));
const directory=`output/private/spark-real-shadow-${Date.now()}`;await mkdir(directory,{recursive:true,mode:0o700});
const admin=await connectAdmin(PROJECT,'spark-shadow-synthetic-staging'),auth=await connectAuth(PROJECT);
assert.equal(admin.projectId,PROJECT);
let browser;const results=[];
try{
  for(const [engine,name]of [[chromium,'chromium'],[webkit,'webkit']]){
    if(args['--browser']&&args['--browser']!==name)continue;
    console.log(JSON.stringify({stage:'REAL_SHADOW_START',engine:name,recoveryOnly,projectId:PROJECT}));
    const uid='qa-spark-staging-'+randomUUID(),email=uid+'@click360-qa.invalid',password=randomBytes(32).toString('base64url');
    assert(uid.startsWith('qa-spark-staging-'));await auth.createUser({uid,email,password,emailVerified:true});
    await writeFile(directory+'/'+name+'.private.json',JSON.stringify({projectId:PROJECT,uid,email,password}),{mode:0o600,flag:'wx'});
    const data=largeTenantData(uid),second='other-'+uid;
    data.products=data.products.slice(0,3);for(const p of data.products)p.notes='short';
    for(const key of ['sales','movements','cashSessions','dailyReports','auditLogs','notifications','labelPrintHistory'])data[key]=[];
    data.settings.labelTemplates=[];data.businesses.push({id:second,name:'Second synthetic',type:'ropa',status:'activo',settings:{}});
    data.products.push({id:'isolated-product',businessId:second,stock:7,qty:7,price:5,cost:1});
    const envelope=stateDocument(uid,41,data),local=structuredClone(data);
    for(const p of local.products)if(p.businessId===uid)p.notes='x'.repeat(300000);
    local.identity=identity(uid);local.products[0].stock--;local.products[0].qty--;
    local.cashSessions.push({id:'historical-session',operationId:'local-opening',businessId:uid,
      date:'2026-09-03',businessDate:'2026-09-03',status:'open',openingAmount:0});
    local.sales.push({id:'local-sale',operationId:'local-sale',businessId:uid,cashSessionId:'historical-session',
      date:'2026-09-03',businessDate:'2026-09-03',total:30,received:30,iva:0,method:'Transferencia',
      items:[{id:local.products[0].id,qty:1,price:30}]});
    local.movements.push({id:'local-opening',operationId:'local-opening',businessId:uid,
      cashSessionId:'historical-session',date:'2026-09-03',kind:'apertura',amount:0},
      {id:'local-payment',operationId:'local-sale',businessId:uid,cashSessionId:'historical-session',
        saleId:'local-sale',date:'2026-09-03',kind:'ingreso',paymentType:'sale',paymentMethod:'Transferencia',amount:30});
    if(automaticCutover){
      // Actual published legacy shape: the reservation points to its sale,
      // while the sale has NO forward layawayId. Keep both original records.
      local.products[0].stock--;local.products[0].qty--;
      const oldPayments=[{id:'legacy-deposit',amount:1,method:'Transferencia'}];
      local.cashSessions.push({id:'legacy-receivable-session',operationId:'legacy-receivable-opening',businessId:uid,
        date:'2026-08-01',status:'closed',openingAmount:0,closedAt:'2026-08-02T00:00:00Z',reportId:'legacy-receivable-report'});
      local.sales.push({id:'legacy-receivable-sale',operationId:'legacy-receivable-sale',businessId:uid,
        cashSessionId:'legacy-receivable-session',date:'2026-08-01',total:6,received:1,balance:5,iva:0,
        method:'Apartado',status:'layaway',payments:structuredClone(oldPayments),customer:'Synthetic legacy customer',
        dueDate:'2026-12-31',items:[{id:local.products[0].id,qty:1,price:6}]});
      local.layaways.push({id:'legacy-reservation',businessId:uid,saleId:'legacy-receivable-sale',
        total:6,paid:1,balance:5,status:'partially_paid',payments:structuredClone(oldPayments)});
      local.movements.push({id:'legacy-receivable-opening',operationId:'legacy-receivable-opening',businessId:uid,
        cashSessionId:'legacy-receivable-session',date:'2026-08-01',kind:'apertura',amount:0},
        {id:'legacy-deposit',operationId:'legacy-receivable-sale',businessId:uid,cashSessionId:'legacy-receivable-session',
          saleId:'legacy-receivable-sale',date:'2026-08-01',kind:'ingreso',paymentType:'receivable_payment',paymentMethod:'Transferencia',amount:1});
      local.dailyReports.push({id:'legacy-receivable-report',businessId:uid,cashSessionId:'legacy-receivable-session',
        date:'2026-08-01',status:'closed',total:6,saleCount:1,theoreticalCash:0});
      // Incomplete CLOSED historical counters must stay immutable, never be
      // invented as zero to make a later independent opening possible.
      local.cashSessions.push({id:'immutable-closed-session',businessId:uid,date:'2026-08-30',status:'closed',closedAt:'2026-08-31T00:00:00Z',reportId:'immutable-closed-report'});
      local.dailyReports.push({id:'immutable-closed-report',businessId:uid,date:'2026-08-30',cashSessionId:'immutable-closed-session',total:8});
    }
    const cashProof=await CLICK360_SPARK_MIGRATION.deriveCashSummaries({snapshot:local,businessId:uid,historicalReadOnly:automaticCutover});
    assert(cashProof.canProceed,'Staging shadow source must contain a financially provable historical session');
    const sourceHash=await CLICK360_SPARK_MIGRATION.hash(local);assert(CLICK360_SPARK_MIGRATION.byteLength(local)>850000);
    // Admin is used ONLY to create private synthetic fixtures/policy. Every
    // migration write and comparison below is performed by the actual PWA SDK.
    const batch=admin.batch();batch.create(admin.doc(`accountAccess/${uid}`),{...accountAccess(uid),email,source:'qa_spark_staging',
      manualLimitOverrides:{businesses:1,workers:1,productsActive:600}});
    batch.create(admin.doc(`businesses/${uid}/state/main`),envelope);await batch.commit();
    await admin.runTransaction(async tx=>{
      const ref=admin.doc('storageRollout/sparkV1'),snap=await tx.get(ref),p=snap.data();
      assert(!p||Array.isArray(p.pilotOwnerUids)&&p.pilotOwnerUids.every(id=>id.startsWith('qa-spark-staging-')),
        'STAGING_POLICY_HAS_NON_FIXTURE_PILOTS_STOP');
      tx.set(ref,{...(p||{}),enabled:true,automaticShadow:!recoveryOnly,automaticRecoveryCopy:recoveryOnly,
        automaticHistoricalReadOnly:automaticCutover,
        automaticRuntimePreparation:false,automaticCutover:false,automaticMigration:false,
        pilotOwnerUids:[...new Set([...(p?.pilotOwnerUids||[]),uid])]});
    });
    console.log(JSON.stringify({stage:'REAL_SHADOW_FIXTURE_READY',engine:name,recoveryOnly}));
    browser=await engine.launch();const context=await browser.newContext({viewport:{width:390,height:844}});
    // Observe existing state publication without changing the coordinator or
    // its authority. A timeout must retain the exact last completed gate.
    context.on('page',page=>page.on('console',message=>{
      if(message.text().startsWith('SPARK_STAGE_GATE '))console.log(message.text());
    }));
    await context.addInitScript(()=>{
      for(const key of ['click360SparkMigrationState','click360SparkBootstrapState']){
        let state;
        Object.defineProperty(window,key,{configurable:true,get:()=>state,set:value=>{
          state=value;console.log('SPARK_STAGE_GATE '+JSON.stringify({key,phase:value?.phase,
            reason:value?.reason,at:Date.now()}));
        }});
      }
      const original=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){
        if(String(key).startsWith('CLICK360:V16:DEVICE:'))throw new DOMException('Synthetic device identity quota failure','QuotaExceededError');
        return original.call(this,key,value);
      };
    });
    try{
      let page=await context.newPage();await page.goto(URL,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>!!window.click360Auth?.signInWithEmailAndPassword&&!!window.CLICK360_V16_STORAGE);
      assert.equal(await page.evaluate(()=>CLICK360_FIREBASE_CONFIG.projectId),PROJECT);
      const tenant={...identity(uid),authUid:uid};
      const before=await page.evaluate(async({tenant,local,recoveryOnly,second})=>{
        await CLICK360_V16_STORAGE.putSnapshot(tenant,local,{source:'indexeddb_cache',deviceRevision:'device-newer-42',
          revision:41,baseRevision:41,cloudCapacityBlocked:true,pendingRemoteSync:true,pendingOperations:['capacity-snapshot-save']});
        if(recoveryOnly){
          const journal=await CLICK360_MODULAR_JOURNAL.open();
          for(let i=0;i<101;i++)await journal.enqueue({ownerUid:tenant.ownerUid,businessId:i===100?second:tenant.ownerUid},`retained-${i}`,
            {actorUid:tenant.ownerUid,kind:'retained-unknown-command',sequence:i});
          const row=await journal.claim({ownerUid:tenant.ownerUid,businessId:second},'retained-100','old-device');
          await journal.markUnknown({ownerUid:tenant.ownerUid,businessId:second},'retained-100',row.revision);journal.close();
        }
        return CLICK360_V16_STORAGE.getSnapshot(tenant);
      },{tenant,local,recoveryOnly,second});
      await page.evaluate(({email,password})=>click360Auth.signInWithEmailAndPassword(email,password),{email,password});
      console.log(JSON.stringify({stage:'REAL_SHADOW_AUTHENTICATED',engine:name,recoveryOnly}));
      const verify=async()=>{
        if(recoveryOnly){
          await page.waitForFunction(()=>{
            if(window.click360SparkBootstrapState?.phase==='BLOCKED')throw Error(window.click360SparkBootstrapState.reason);
            return window.click360SparkRecoveryCopy?.status==='RECOVERY_COPY_CLIENT_VERIFIED';
          },null,{timeout:30000});
          const copy=await page.evaluate(async({uid,sourceHash})=>{
            const copy=click360SparkRecoveryCopy;
            const path=`businesses/${uid}/recoveryCopies/${copy.captureHash}`;
            const m=await click360Db.doc(path).get({source:'server'}),parts=await click360Db.collection(`${path}/parts`).orderBy('position').get({source:'server'});
            if(m.metadata.fromCache||parts.metadata.fromCache||m.data().state!=='CLIENT_VERIFIED')throw Error('COPY_NOT_AUTHORITATIVE');
            const restored=JSON.parse(parts.docs.map(d=>d.data().content).join(''));
            if(await CLICK360_SPARK_MIGRATION.hash(restored)!==copy.captureHash
              ||await CLICK360_SPARK_MIGRATION.hash(restored.record.snapshot)!==sourceHash)throw Error('COPY_RECONSTRUCTION_MISMATCH');
            const journal=await CLICK360_MODULAR_JOURNAL.open(),current=await journal.captureOwner(uid);journal.close();
            if(await CLICK360_SPARK_MIGRATION.hash(current)!==copy.journalHash
              ||current.recordCount!==101||current.rows.filter(r=>r.state==='unknown').length!==1)throw Error('COPY_LOST_OUTBOX');
            if(window.click360SparkOperationalSession||copy.operationalCloudConfirmed!==false)throw Error('COPY_FALSE_OPERATIONAL_SYNC');
            return copy;
          },{uid,sourceHash});
          assert.deepEqual(await page.evaluate(tenant=>CLICK360_V16_STORAGE.getSnapshot(tenant),tenant),before);
          assert.equal((await admin.doc(`businesses/${uid}/metadata/storage`).get()).exists,false);
          assert.deepEqual((await admin.doc(`businesses/${uid}/state/main`).get()).data(),envelope);
          return copy;
        }
        await waitForMigrationOutcome(page,{expectedReason:'SPARK_BOOTSTRAP_SHADOW_VERIFIED_CUTOVER_DISABLED'});
        assert.deepEqual(await page.evaluate(tenant=>CLICK360_V16_STORAGE.getSnapshot(tenant),tenant),before);
        assert.equal(await page.evaluate(()=>!!window.click360SparkOperationalSession),false);
        const control=(await admin.doc(`businesses/${uid}/metadata/storage`).get()).data();
        assert.equal(control.storageMode,'migrating');assert.equal(control.phase,'READY_TO_CUTOVER');
        assert.equal(control.sourceHash,sourceHash);assert.equal(control.reconstructedHash,sourceHash);assert.equal(control.semanticEquality,'PASS');
        assert.deepEqual(control.businessIds,[uid,second]);
        assert.deepEqual((await admin.doc(`businesses/${uid}/state/main`).get()).data(),envelope);
        return page.evaluate(async ownerUid=>{
          const detail=window.click360SparkMigrationState;
          if(!['READ_ONLY_HANDOFF_PREPARED','RUNTIME_PREPARED'].includes(detail?.phase)||!detail.captureHash)
            throw Error('SAME_DEVICE_HANDOFF_PROGRESS_REQUIRED');
          const recovery=await CLICK360_SPARK_RECOVERY.open({ownerUid,resolveUser:()=>click360Auth.currentUser});
          try{
            const pinned=await recovery.readHandoff(detail.captureHash);
            if(!pinned?.durable||pinned.plan.planHash!==detail.planHash
              ||pinned.plan.operationalActivationAllowed!==false||pinned.plan.cutoverAllowed!==false)
              throw Error('SAME_DEVICE_HANDOFF_PIN_NOT_VERIFIED');
            return {captureHash:pinned.captureHash,plan:pinned.plan,phase:detail.phase};
          }finally{recovery.close();}
        },uid);
      };
      const first=await verify();await page.close();page=await context.newPage();await page.goto(URL,{waitUntil:'domcontentloaded'});const resumed=await verify();
      if(recoveryOnly)assert.equal(first.captureHash,resumed.captureHash,'No new recovery copy on cold restart');
      let runtimeEvidence=null,handoffEvidence=null;
      if(runtimePreparation){
        assert.equal(first.captureHash,resumed.captureHash,'Unchanged handoff must survive the original browser partition restart');
        const approval=await CLICK360_SPARK_HANDOFF.runtimeApproval(resumed.plan,release.buildSha);
        assert.equal(approval.ownerUid,uid);assert.equal(approval.captureHash,resumed.captureHash);
        assert(uid.startsWith('qa-spark-staging-'),'RUNTIME_ADMIN_APPROVAL_SYNTHETIC_ONLY');
        for(const row of resumed.plan.runtimes)assert.equal((await admin.doc(row.path).get()).exists,false);
        // Administrative fixture approval is private to this synthetic owner.
        // The PWA, not Admin, creates and rereads the actual derived runtimes.
        await admin.doc(`businesses/${uid}/storageApprovals/runtimePreparation`).create(approval);
        await admin.runTransaction(async tx=>{
          const ref=admin.doc('storageRollout/sparkV1'),snap=await tx.get(ref),policy=snap.data();
          assert(policy?.pilotOwnerUids?.every(id=>id.startsWith('qa-spark-staging-')),
            'RUNTIME_POLICY_NON_SYNTHETIC_STOP');
          assert(policy.pilotOwnerUids.includes(uid));
          tx.update(ref,{automaticRuntimePreparation:true,automaticCutover:false,automaticMigration:false});
        });
        const runtimeHashes={};
        for(let restart=0;restart<2;restart++){
          await page.close();page=await context.newPage();await page.goto(URL,{waitUntil:'domcontentloaded'});
          const prepared=await verify();assert.equal(prepared.captureHash,resumed.captureHash);
          assert.equal(prepared.phase,'RUNTIME_PREPARED');
          for(const row of resumed.plan.runtimes){
            const document=await admin.doc(row.path).get();assert(document.exists);
            const hash=await CLICK360_SPARK_MIGRATION.hash(document.data());
            assert.equal(hash,approval.preparedRuntimeHashes[row.content.businessId]);
            assert.deepEqual(document.data(),approval.runtimeRecords[row.content.businessId]);
            runtimeHashes[row.content.businessId]=hash;
          }
          assert.equal(await page.evaluate(()=>!!window.click360SparkOperationalSession),false);
        }
        assert.equal(Object.keys(runtimeHashes).length,2);
        assert.equal(approval.runtimeRecords[uid].data.openCashSessionId,'historical-session');
        assert.equal(approval.runtimeRecords[second].data.openCashSessionId,'');
        runtimeEvidence={status:'RUNTIME_PREPARED',planHash:approval.planHash,captureHash:approval.captureHash,
          runtimeCount:2,runtimeHashes:Object.values(runtimeHashes).sort(),repeatedRestart:true,
          approvedDerivedRuntimeResume:true,operationalCloudConfirmed:false,cutover:false};
        if(localHandoff){
          assert(uid.startsWith('qa-spark-staging-'),'LOCAL_HANDOFF_SYNTHETIC_OWNER_REQUIRED');
          const cutoverBusinessIds=(await admin.doc(`businesses/${uid}/metadata/storage`).get()).data().businessIds;
          assert.deepEqual([...cutoverBusinessIds].sort(),[...approval.businessIds].sort());
          await admin.doc(`businesses/${uid}/storageApprovals/cutover`).create({ownerUid:uid,
            sourceHash,buildSha:release.buildSha,businessIds:cutoverBusinessIds});
          await admin.runTransaction(async tx=>{
            const ref=admin.doc('storageRollout/sparkV1'),snap=await tx.get(ref),policy=snap.data();
            assert(policy?.pilotOwnerUids?.every(id=>id.startsWith('qa-spark-staging-')));
            tx.update(ref,{automaticCutover:true,automaticMigration:automaticCutover});
          });
          // The authenticated owner SDK, with deployed Rules, performs this
          // explicitly approved synthetic transition. Admin never bypasses it.
          if(!automaticCutover)await page.evaluate(async uid=>{
            const ref=click360Db.doc(`businesses/${uid}/metadata/storage`);
            await click360Db.runTransaction(async tx=>{
              const snap=await tx.get(ref),control=snap.data();
              const account=(await tx.get(click360Db.doc(`accountAccess/${uid}`))).data();
              if(snap.metadata.fromCache||control.storageMode!=='migrating'
                ||control.phase!=='READY_TO_CUTOVER')throw Error('SYNTHETIC_CUTOVER_SOURCE_REQUIRED');
              const proofs=[];
              for(const businessId of control.businessIds){
                const identity={ownerUid:uid,businessId},flat={id:'storage',...identity,
                  tenantKey:`owner:${uid}:business:${businessId}`,storageSchemaVersion:2,module:'metadata',recordVersion:1,
                  storageMode:'modular',phase:'MODULAR',semanticEquality:'PASS',sourceHash:control.sourceHash,
                  reconstructedHash:control.reconstructedHash,accountPlan:account.plan,manualLimitOverrides:account.manualLimitOverrides||{}};
                proofs.push({ref:click360Db.doc(`businesses/${uid}/businessUnits/${businessId}/storage/v2/metadata/storage`),
                  data:await CLICK360_SPARK_RECORD_CODEC.pack(flat,{identity,moduleName:'metadata',recordId:'storage'})});
              }
              tx.update(ref,{storageMode:'modular',phase:'MODULAR',recordVersion:control.recordVersion+1,
                updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
              for(const proof of proofs)tx.set(proof.ref,proof.data);
            });
          },uid);
          await page.close();page=await context.newPage();await page.goto(URL,{waitUntil:'domcontentloaded'});
          if(automaticCutover)for(const phase of ['ACTIVATION_VERIFYING','ACTIVATION_SOURCE_VERIFIED']){
            await page.waitForFunction(expected=>{
              const c=window.click360SparkBootstrapState;if(c?.phase==='BLOCKED')throw Error(c.reason);
              const stages=['ACTIVATION_VERIFYING','ACTIVATION_SOURCE_VERIFIED',
                'ACTIVATION_COMMITTED_VERIFYING','CUTOVER_COMMITTED'];
              return stages.indexOf(window.click360SparkMigrationState?.phase)>=stages.indexOf(expected);
            },phase);
          }
          if(automaticCutover)await page.waitForFunction(()=>{
            const c=window.click360SparkBootstrapState;if(c?.phase==='BLOCKED')throw Error(c.reason);
            // Distinct bounded stages, not a larger catch-all timeout. This
            // marker is emitted only after authoritative control confirmation;
            // the following READY gate separately proves native/view recovery.
            return window.click360SparkMigrationState?.phase==='CUTOVER_COMMITTED';
          });
          await page.waitForFunction(()=>{
            const c=window.click360SparkBootstrapState;
            if(c?.phase==='BLOCKED')throw Error(c.reason);
            return c?.phase==='READY'&&!!window.click360SparkOperationalSession;
          });
          const installed=await page.evaluate(async({uid,tenant,sourceHash,captureHash})=>{
            const recovery=await CLICK360_SPARK_RECOVERY.open({ownerUid:uid,resolveUser:()=>click360Auth.currentUser});
            try{
              const pin=await recovery.read(sourceHash),handoff=await recovery.readHandoff(captureHash);
              if(!pin?.durable||!handoff?.durable||await CLICK360_SPARK_MIGRATION.hash(pin.snapshot)!==sourceHash)
                throw Error('LOCAL_HANDOFF_ORIGINAL_PIN_LOST');
              const local=await CLICK360_V16_STORAGE.getSnapshot(tenant);
              if(local.source!=='spark_operational_candidate')throw Error('LOCAL_HANDOFF_NOT_INSTALLED');
              const state=click360GetTenantState(),health=await click360SparkOperationalSession.health();
              if(health.pendingCount||health.unknownCount||health.projectionPendingCount)throw Error('LOCAL_HANDOFF_UNRESOLVED_JOURNAL');
              return {snapshot:pin.snapshot,businesses:state.businesses.map(b=>b.id).sort(),sales:state.sales,
                products:state.products,health};
            }finally{recovery.close();}
          },{uid,tenant,sourceHash,captureHash:resumed.captureHash});
          assert.deepEqual(installed.snapshot,local);
          assert.deepEqual(installed.businesses,[uid,second].sort());
          assert.equal(installed.sales.filter(s=>s.id==='local-sale').length,1);
          assert.equal(installed.products.find(p=>p.id===local.products[0].id).stock,local.products[0].stock);
          page.on('dialog',d=>d.accept());
          await page.evaluate(()=>{location.hash='#cash';});
          await page.locator('#workingDateInput').fill('2026-09-03');
          await page.locator('#workingDateInput').dispatchEvent('change');
          await page.locator('#closeDayBtn').click();await page.locator('#efectivoFisico').fill('0');
          await page.evaluate(()=>{
            window.QA_HANDOFF_CLOSE=null;
            window.addEventListener('click360-spark-operation-status',e=>{window.QA_HANDOFF_CLOSE=e.detail;});
          });
          await page.locator('#closeDaySubmitBtn').click();
          await page.waitForFunction(()=>window.QA_HANDOFF_CLOSE?.status==='CONFIRMED');
          const session=(await admin.doc(`businesses/${uid}/businessUnits/${uid}/storage/v2/cashSessions/historical-session`).get()).data();
          const report=(await admin.doc(`businesses/${uid}/businessUnits/${uid}/storage/v2/dailyReports/${session.data.reportId}`).get()).data();
          assert.equal(session.data.status,'closed');assert.equal(report.data.cashSessionId,'historical-session');
          assert.equal(report.data.total,30);assert.equal(report.data.saleCount,1);
          const operationId=await page.evaluate(()=>window.QA_HANDOFF_CLOSE.operationId);
          const ledgerRecord=(await admin.doc(`businesses/${uid}/businessUnits/${uid}/storage/v2/operationLedger/${operationId}`).get()).data();
          assert.equal(ledgerRecord.ownerUid,uid);assert.equal(ledgerRecord.businessId,uid);
          assert.equal(ledgerRecord.id,operationId);assert.equal(ledgerRecord.module,'operationLedger');
          const ledger=ledgerRecord.data;
          assert.equal(ledger.kind,'cash_close');assert.equal(ledger.status,'committed');
          assert.equal(ledger.result.cashSessionId,'historical-session');
          assert.deepEqual((await admin.doc(`businesses/${uid}/state/main`).get()).data(),envelope);
          await page.close();page=await context.newPage();await page.goto(URL,{waitUntil:'domcontentloaded'});
          await page.waitForFunction(()=>{
            const c=window.click360SparkBootstrapState;if(c?.phase==='BLOCKED')throw Error(c.reason);
            return c?.phase==='READY'&&!!window.click360SparkOperationalSession;
          });
          assert.equal(await page.evaluate(()=>click360GetTenantState().cashSessions.find(s=>s.id==='historical-session')?.status),'closed');
          assert.equal(await page.evaluate(()=>click360GetTenantState().sales.filter(s=>s.id==='local-sale').length),1);
          assert.equal(await page.evaluate(id=>click360GetTenantState().products.find(p=>p.id===id)?.stock,local.products[0].id),local.products[0].stock);
          let workerAutomaticAuthority=false;
          if(automaticCutover){
            const historyBase=`businesses/${uid}/businessUnits/${uid}/storage/v2`;
            const protectedBefore=await Promise.all(['cashSessions/immutable-closed-session','dailyReports/immutable-closed-report']
              .map(path=>admin.doc(`${historyBase}/${path}`).get().then(s=>s.data())));
            assert(protectedBefore.every(row=>row?.historyPolicy),'Unproven closed history must be protected before using the new-session UI');
            await page.evaluate(()=>{location.hash='#cash';});
            await page.locator('#workingDateInput').fill('2026-08-30');await page.locator('#workingDateInput').dispatchEvent('change');
            await page.locator('#independentCashOpenBtn').click();
            assert.equal(await page.locator('#independentCashAmount').inputValue(),'','Never propose an inferred historical opening fund');
            await page.locator('#independentCashAmount').fill('0');
            await page.evaluate(()=>{
              // This is a new document after the restart above. The old
              // document's close observer does not survive a PWA reopen.
              window.QA_HANDOFF_CLOSE=null;
              window.addEventListener('click360-spark-operation-status',event=>{window.QA_HANDOFF_CLOSE=event.detail;});
            });
            await page.locator('#independentCashConfirm').click();
            await page.waitForFunction(()=>window.QA_HANDOFF_CLOSE?.status==='CONFIRMED');
            const independent=await page.evaluate(()=>({operationId:window.QA_HANDOFF_CLOSE.operationId,
              session:click360GetTenantState().cashSessions.find(s=>s.date==='2026-08-30'&&s.status==='open')}));
            assert(independent.session?.id&&independent.session.id!=='immutable-closed-session');
            const independentLedger=(await admin.doc(`${historyBase}/operationLedger/${independent.operationId}`).get()).data();
            assert.equal(independentLedger.data.kind,'cash_open');assert.equal(independentLedger.data.result.cashSessionId,independent.session.id);
            await page.evaluate(()=>{location.hash='#debtors';});
            await page.locator(`button[onclick*="payLayaway('legacy-receivable-sale')"]`).click();
            await page.locator('#layawayPaymentAmount').fill('5');await page.locator('#layawayPaymentMethod').selectOption('Transferencia');
            await page.evaluate(()=>{window.QA_HANDOFF_CLOSE=null;});
            await page.locator('#confirmLayawayPayment').click();
            await page.waitForFunction(()=>window.QA_HANDOFF_CLOSE?.status==='CONFIRMED');
            const importedReceiptId=await page.evaluate(()=>window.QA_HANDOFF_CLOSE.operationId);
            const paidImport=(await admin.doc(`${historyBase}/sales/legacy-receivable-sale`).get()).data();
            const reservation=(await admin.doc(`${historyBase}/layaways/legacy-reservation`).get()).data();
            assert.equal(paidImport.data.balance,0);assert.equal(paidImport.data.received,6);assert.equal(paidImport.data.payments.length,2);
            assert(!Object.hasOwn(paidImport.data,'layawayId'),'Do not normalize away the original missing forward link');
            assert.equal(reservation.data.saleId,'legacy-receivable-sale');assert.equal(reservation.data.balance,0);
            assert.equal((await admin.doc(`${historyBase}/movements/${importedReceiptId}`).get()).data().data.amount,5);
            assert.equal((await admin.doc(`${historyBase}/operationLedger/${importedReceiptId}`).get()).data().data.kind,'receivable_payment');
            assert.equal((await admin.doc(`${historyBase}/cashSessions/${independent.session.id}`).get()).data().operational.saleCount,0);
            assert.equal((await admin.doc(`${historyBase}/products/${local.products[0].id}`).get()).data().data.stock,local.products[0].stock);
            assert.deepEqual(await Promise.all(['cashSessions/immutable-closed-session','dailyReports/immutable-closed-report']
              .map(path=>admin.doc(`${historyBase}/${path}`).get().then(s=>s.data()))),protectedBefore);
            assert.deepEqual((await admin.doc(`businesses/${uid}/state/main`).get()).data(),envelope);
            // The coordinator, not this fixture, must have published both
            // scoped authorities atomically with the owner-wide activation.
            for(const businessId of [uid,second]){
              const scoped=(await admin.doc(`businesses/${uid}/businessUnits/${businessId}/storage/v2/metadata/storage`).get()).data();
              assert.equal(scoped?.data?.sourceHash,sourceHash);assert.equal(scoped.businessId,businessId);
              assert.equal(scoped.data.accountPlan,'founder_legacy');
            }
            const workerUid='qa-spark-staging-'+randomUUID(),workerEmail=workerUid+'@click360-qa.invalid',workerPassword=randomBytes(32).toString('base64url');
            await auth.createUser({uid:workerUid,email:workerEmail,password:workerPassword,emailVerified:true});
            await writeFile(`${directory}/${name}-worker.private.json`,JSON.stringify({uid:workerUid,email:workerEmail,password:workerPassword}),{flag:'wx',mode:0o600});
            const permissions={products:{read:true},sales:{read:true},cashSessions:{read:true},movements:{read:true},customers:{read:true},settings:{read:true},layaways:{read:true}};
            const workerBatch=admin.batch();
            workerBatch.create(admin.doc(`businesses/${uid}/featureFlags/workers`),{enabled:true});
            workerBatch.create(admin.doc(`businesses/${uid}/businessUnits/${uid}/members/${workerUid}`),{
              uid:workerUid,ownerUid:uid,businessId:uid,tenantKey:`owner:${uid}:business:${uid}`,boundarySchemaVersion:1,status:'active',role:'cashier',permissions});
            workerBatch.create(admin.doc(`approvedUsers/${workerUid}`),{uid:workerUid,ownerId:uid,businessUnitId:uid,role:'cashier',approved:true,status:'active',email:workerEmail,name:'Synthetic worker',permissions});
            workerBatch.create(admin.doc(`workerAccessRequests/${uid}_${workerUid}`),{ownerId:uid,uid:workerUid,businessUnitId:uid,status:'approved'});
            await workerBatch.commit();
            const workerContext=await browser.newContext({viewport:{width:390,height:844}});
            try{
              const workerPage=await workerContext.newPage();await workerPage.goto(URL,{waitUntil:'domcontentloaded'});
              await workerPage.waitForFunction(()=>!!window.click360Auth?.signInWithEmailAndPassword);
              await workerPage.evaluate(({email,password})=>click360Auth.signInWithEmailAndPassword(email,password),{email:workerEmail,password:workerPassword});
              await workerPage.waitForFunction(()=>{
                const state=window.click360SparkBootstrapState;if(state?.phase==='BLOCKED')throw Error(state.reason);
                return state?.phase==='READY'&&!!window.click360SparkOperationalSession;
              });
              assert.equal(await workerPage.evaluate(id=>click360GetTenantState().products.find(p=>p.id===id)?.stock,local.products[0].id),local.products[0].stock);
              assert.equal(await workerPage.evaluate(()=>click360GetTenantState().sales.filter(s=>s.id==='local-sale').length),1);
              assert.equal(await workerPage.evaluate(()=>CLICK360_TENANT_QUOTA.planEntitlements(CLICK360_V16_DOMAIN,click360User.access.plan,click360User.manualLimitOverrides).limits.productsActive),2000);
              assert.equal(await workerPage.evaluate(async owner=>{
                try{await click360Db.runTransaction(tx=>tx.get(click360Db.doc(`businesses/${owner}/metadata/storage`)));return false;}
                catch(error){return error.code==='permission-denied';}
              },uid),true,'Scoped proof must not expose owner-wide authority to a worker');
              workerAutomaticAuthority=true;
            }finally{await workerContext.close();}
          }
          handoffEvidence={status:'LOCAL_HANDOFF_VERIFIED',syntheticApprovedTransition:true,
            automaticCoordinator:automaticCutover,
            workerAutomaticAuthority,
            importedReverseReceivableCollectedExactlyOnce:automaticCutover,
            independentProtectedHistoryOpening:automaticCutover,
            originalSourcePinUnchanged:true,ownerWideBusinesses:2,importedSaleOnce:true,stockPreserved:true,
            importedSessionClosed:true,reportTotal:30,reportSaleCount:1,closeLedgerConfirmed:true,
            postCloseRestart:true,productionWrites:0};
        }
      }
      results.push({browser:name,sourceHash,reconstructedHash:sourceHash,bytes:CLICK360_SPARK_MIGRATION.byteLength(local),
        ...(recoveryOnly?{captureHash:resumed.captureHash,journalHash:resumed.journalHash,partCount:resumed.partCount,
          status:resumed.status,pending:100,unknown:1,operationalCloudConfirmed:false}:{}),
        ...(runtimeEvidence?{runtimePreparation:runtimeEvidence}:{}),
        ...(handoffEvidence?{localHandoff:handoffEvidence}:{}),
        localSnapshotUnchanged:!localHandoff,originalSourcePreserved:true,legacyUnchanged:true,coldRestartResume:true,localStorageDeviceIdFailureRecovered:true,businesses:2,cutover:localHandoff});
      console.log(JSON.stringify({stage:'REAL_SHADOW_PREPARATION_PASS',...results.at(-1)}));
    }catch(error){
      const diagnostics=[];
      const failedControl=(await admin.doc(`businesses/${uid}/metadata/storage`).get()).data();
      for(const page of context.pages()){
        diagnostics.push(await page.evaluate(()=>({
          phase:window.click360SparkBootstrapState?.phase,
          reason:window.click360SparkBootstrapState?.reason,
          progress:window.click360SparkBootstrapProgress,
          recoveryStatus:window.click360SparkRecoveryCopy?.status,
          recoveryReason:window.click360SparkRecoveryCopy?.reason,
          migrationPhase:window.click360SparkMigrationState?.phase,
          visibility:document.visibilityState,
          online:navigator.onLine,
          authenticated:!!window.click360Auth?.currentUser
        })).catch(()=>({pageUnavailable:true})));
      }
      await writeFile(`${directory}/${name}-failure.private.json`,JSON.stringify({diagnostics,error:String(error)}),{mode:0o600,flag:'wx'});
      console.error(JSON.stringify({stage:'REAL_SHADOW_FAILED',engine:name,recoveryOnly,diagnostics,
        serverControl:failedControl?{storageMode:failedControl.storageMode,phase:failedControl.phase,
          recordVersion:failedControl.recordVersion}:null}));
      throw error;
    }finally{
      await context.close();await browser.close();browser=null;
      if(runtimePreparation)await admin.runTransaction(async tx=>{
        const ref=admin.doc('storageRollout/sparkV1'),snap=await tx.get(ref),policy=snap.data();
        assert(policy?.pilotOwnerUids?.every(id=>id.startsWith('qa-spark-staging-')),'RUNTIME_POLICY_NON_SYNTHETIC_STOP');
        tx.update(ref,{automaticRuntimePreparation:false,automaticCutover:false,automaticMigration:false,automaticHistoricalReadOnly:false});
      });
    }
  }
  const result={status:'PASS',scope:automaticCutover?'REAL_STAGING_SYNTHETIC_AUTOMATIC_APPROVED_MIGRATION':localHandoff?'REAL_STAGING_SYNTHETIC_APPROVED_LOCAL_HANDOFF':recoveryOnly?'REAL_STAGING_RECOVERY_COPY_CLIENT_VERIFIED_ONLY':runtimePreparation
    ?'REAL_STAGING_SHADOW_AND_RUNTIME_PREPARATION_ONLY':'REAL_STAGING_SHADOW_PREPARATION_ONLY',buildSha:release.buildSha,projectId:PROJECT,
    rulesHash,results,focusedBrowser:args['--browser']||null,fullBrowserMatrix:!args['--browser'],productionWrites:0,operationalCutover:localHandoff,automaticCoordinatorCutover:automaticCutover,realCustomerCutover:false};
  await writeFile(directory+'/result.json',JSON.stringify(result),{mode:0o600,flag:'wx'});console.log(JSON.stringify(result));
}finally{await browser?.close();await admin.terminate();}
