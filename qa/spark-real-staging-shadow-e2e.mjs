// Real Spark staging, explicitly synthetic. Certifies preparation/readback only,
// not operational cutover, client recovery or production activation.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
import {connectAdmin,connectAuth} from '../scripts/lib/firebase-admin-connect.mjs';
import {getDeployedFirestoreRules} from '../scripts/lib/firestore-rules-remote.mjs';
import {largeTenantData,stateDocument,accountAccess,identity} from './r38-emulator-support.mjs';
import '../spark-modular-migration.js';
const PROJECT='click360-staging-7620168025',URL=`https://${PROJECT}.web.app/`;
const args=Object.fromEntries(process.argv.slice(2).map(s=>s.split('=')));
const recoveryOnly=args['--recovery-only']==='true';
assert.equal(args['--project'],PROJECT);assert.match(args['--sha']||'',/^[a-f0-9]{40}$/);
for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST'])assert(!process.env[key]);
const digest=value=>createHash('sha256').update(value).digest('hex');
const release=await fetch(URL+'release-manifest.json',{cache:'no-store'}).then(r=>r.json());
assert(args['--sha'].startsWith(release.buildSha),'SERVED_SHA_MISMATCH');
for(const file of ['index.html','app.js','firebase-service.js','service-worker.js','spark-migration-bootstrap.js',
  'spark-modular-importer.js','spark-modular-reconciliation.js','spark-modular-recovery.js']){
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
    local.cashSessions.push({id:'historical-session',businessId:uid,businessDate:'2026-09-03',status:'open'});
    local.sales.push({id:'local-sale',operationId:'local-sale',businessId:uid,cashSessionId:'historical-session',
      businessDate:'2026-09-03',total:30,items:[{id:local.products[0].id,qty:1,price:30}]});
    local.movements.push({id:'local-payment',businessId:uid,cashSessionId:'historical-session',saleId:'local-sale',amount:30});
    const sourceHash=await CLICK360_SPARK_MIGRATION.hash(local);assert(CLICK360_SPARK_MIGRATION.byteLength(local)>850000);
    // Admin is used ONLY to create private synthetic fixtures/policy. Every
    // migration write and comparison below is performed by the actual PWA SDK.
    const batch=admin.batch();batch.create(admin.doc(`accountAccess/${uid}`),{...accountAccess(uid),email,source:'qa_spark_staging'});
    batch.create(admin.doc(`businesses/${uid}/state/main`),envelope);await batch.commit();
    await admin.runTransaction(async tx=>{
      const ref=admin.doc('storageRollout/sparkV1'),snap=await tx.get(ref),p=snap.data();
      assert(!p||Array.isArray(p.pilotOwnerUids)&&p.pilotOwnerUids.every(id=>id.startsWith('qa-spark-staging-')),
        'STAGING_POLICY_HAS_NON_FIXTURE_PILOTS_STOP');
      tx.set(ref,{...(p||{}),enabled:true,automaticShadow:!recoveryOnly,automaticRecoveryCopy:recoveryOnly,
        pilotOwnerUids:[...new Set([...(p?.pilotOwnerUids||[]),uid])]});
    });
    browser=await engine.launch();const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.addInitScript(()=>{
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
        await page.waitForFunction(()=>{
          const c=window.click360SparkBootstrapState;
          if(c?.phase==='BLOCKED'&&c.reason!=='SPARK_BOOTSTRAP_SHADOW_VERIFIED_CUTOVER_DISABLED')throw Error(c.reason);
          return c?.reason==='SPARK_BOOTSTRAP_SHADOW_VERIFIED_CUTOVER_DISABLED';
        },null,{timeout:30000});
        assert.deepEqual(await page.evaluate(tenant=>CLICK360_V16_STORAGE.getSnapshot(tenant),tenant),before);
        assert.equal(await page.evaluate(()=>!!window.click360SparkOperationalSession),false);
        const control=(await admin.doc(`businesses/${uid}/metadata/storage`).get()).data();
        assert.equal(control.storageMode,'migrating');assert.equal(control.phase,'READY_TO_CUTOVER');
        assert.equal(control.sourceHash,sourceHash);assert.equal(control.reconstructedHash,sourceHash);assert.equal(control.semanticEquality,'PASS');
        assert.deepEqual(control.businessIds,[uid,second]);
        assert.deepEqual((await admin.doc(`businesses/${uid}/state/main`).get()).data(),envelope);
      };
      const first=await verify();await page.close();page=await context.newPage();await page.goto(URL,{waitUntil:'domcontentloaded'});const resumed=await verify();
      if(recoveryOnly)assert.equal(first.captureHash,resumed.captureHash,'No new recovery copy on cold restart');
      results.push({browser:name,sourceHash,reconstructedHash:sourceHash,bytes:CLICK360_SPARK_MIGRATION.byteLength(local),
        ...(recoveryOnly?{captureHash:resumed.captureHash,journalHash:resumed.journalHash,partCount:resumed.partCount,
          status:resumed.status,pending:100,unknown:1,operationalCloudConfirmed:false}:{}),
        localSnapshotUnchanged:true,legacyUnchanged:true,coldRestartResume:true,localStorageDeviceIdFailureRecovered:true,businesses:2,cutover:false});
      console.log(JSON.stringify({stage:'REAL_SHADOW_PREPARATION_PASS',...results.at(-1)}));
    }finally{await context.close();await browser.close();browser=null;}
  }
  const result={status:'PASS',scope:recoveryOnly?'REAL_STAGING_RECOVERY_COPY_CLIENT_VERIFIED_ONLY':'REAL_STAGING_SHADOW_PREPARATION_ONLY',buildSha:release.buildSha,projectId:PROJECT,
    rulesHash,results,productionWrites:0,operationalCutover:false};
  await writeFile(directory+'/result.json',JSON.stringify(result),{mode:0o600,flag:'wx'});console.log(JSON.stringify(result));
}finally{await browser?.close();await admin.terminate();}
