// Diagnostic against an existing synthetic staging identity, including one
// explicitly synthetic UI sale. Never use a customer's commercial fixture.
// Never accepts production or real users. A synthetic UI sale is opt-in.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {connectAdmin} from '../scripts/lib/firebase-admin-connect.mjs';
const project='click360-staging-7620168025';
const directory=process.argv[2];
assert(/^output\/private\/spark-real-staging-\d+$/.test(directory));
const owner=JSON.parse(await readFile(`${directory}/chromium-credentials.json`));
const worker=JSON.parse(await readFile(`${directory}/chromium-worker-credentials.json`));
assert.equal(owner.projectId,project);assert.equal(worker.projectId,project);
assert(owner.uid.startsWith('qa-spark-staging-'));assert(worker.uid.startsWith('qa-spark-staging-'));
assert(owner.email.endsWith('@click360-qa.invalid'));assert(worker.email.endsWith('@click360-qa.invalid'));
const runSale=process.env.WATCH_SYNTHETIC_SALE==='true';
const admin=await connectAdmin(project,'watch-diagnostic');
const member=admin.doc(`businesses/${owner.uid}/businessUnits/${owner.uid}/members/${worker.uid}`);
const original=(await member.get()).data();
assert.equal(original.uid,worker.uid);
const browser=await chromium.launch();
try {
  for(const persistent of [false,true]) {
    await member.update({status:'active'});
    const page=await browser.newPage();
    await page.goto(`https://${project}.web.app/`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!window.click360Db);
    await page.evaluate(async ({owner,worker,persistent})=>{
      const app=firebase.initializeApp(CLICK360_FIREBASE_CONFIG,'watch-isolation');
      const db=app.firestore();
      window.WATCH_DB=db;
      db.settings({experimentalForceLongPolling:true,experimentalAutoDetectLongPolling:false});
      if(persistent)await db.enablePersistence({synchronizeTabs:true});
      await app.auth().signInWithEmailAndPassword(worker.email,worker.password);
      window.WATCH_EVENTS=[];
      db.doc(`businesses/${owner.uid}/businessUnits/${owner.uid}/members/${worker.uid}`)
        .onSnapshot({includeMetadataChanges:true},s=>WATCH_EVENTS.push({status:s.data()?.status,cache:s.metadata.fromCache}),
          e=>WATCH_EVENTS.push({error:e.code}));
    },{owner,worker,persistent});
    await page.waitForFunction(()=>WATCH_EVENTS.some(e=>e.status==='active'&&!e.cache));
    if(process.env.WATCH_BASELINE_DENIALS==='true'){
      await page.evaluate(async owner=>{
        for(const path of [`businesses/${owner}/metadata/storage`,
          `businesses/${owner}/businessUnits/other-${owner}/storage/v2/products/isolated-product`]){
          try{await WATCH_DB.doc(path).get({source:'server'});throw Error('EXPECTED_DENIAL');}
          catch(e){if(e.code!=='permission-denied')throw e;}
        }
      },owner.uid);
    }
    await member.update({status:'revoked'});
    try {await page.waitForFunction(()=>WATCH_EVENTS.some(e=>e.status==='revoked'&&!e.cache||e.error));}
    catch { /* Report a failed watch, never count it as a success. */ }
    console.log(JSON.stringify({persistent,denials:process.env.WATCH_BASELINE_DENIALS==='true',events:await page.evaluate(()=>WATCH_EVENTS)}));
    await page.close();
  }
  if(process.env.WATCH_ONLY_BASELINE!=='true'){
  await member.update({status:'active'});
  const page=await browser.newPage();
  const transport=process.argv[3]==='auto'?'auto':'served';
  const sdkVersion=transport==='auto'?null:process.argv[3];
  if(transport==='auto'){
    const source=await fetch(`https://${project}.web.app/firebase-service.js`).then(r=>r.text());
    const before='experimentalForceLongPolling:true, experimentalAutoDetectLongPolling:false';
    assert(source.includes(before));
    await page.route('**/firebase-service.js*',route=>route.fulfill({status:200,contentType:'application/javascript',
      body:source.replace(before,'experimentalForceLongPolling:false, experimentalAutoDetectLongPolling:true')}));
  }
  if(sdkVersion){
    assert(['10.14.1','12.14.0'].includes(sdkVersion));
    for(const name of ['app','auth','firestore']){
      const response=await fetch(`https://www.gstatic.com/firebasejs/${sdkVersion}/firebase-${name}-compat.js`);
      assert(response.ok,'OFFICIAL_SDK_FETCH_FAILED');const body=await response.text();
      await page.route(`**/vendor/firebase-${name}-compat.js*`,route=>route.fulfill({status:200,contentType:'application/javascript',body}));
    }
  }
  const network=[];
  page.on('requestfailed',r=>{if(r.url().includes('firestore.googleapis.com'))network.push({error:r.failure()?.errorText});});
  await page.goto(`https://${project}.web.app/`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.click360Auth);
  await page.evaluate(w=>click360Auth.signInWithEmailAndPassword(w.email,w.password),worker);
  await page.waitForFunction(()=>click360SparkBootstrapState?.phase==='READY');
  const denialCase=process.env.WATCH_DENIAL_CASE||'both';
  assert(['owner','foreign','both'].includes(denialCase));
  await page.evaluate(async ({owner,denialCase})=>{
    const paths=[];
    if(denialCase!=='foreign')paths.push(`businesses/${owner}/metadata/storage`);
    if(denialCase!=='owner')paths.push(`businesses/${owner}/businessUnits/other-${owner}/storage/v2/products/isolated-product`);
    for(const path of paths) {
      try{await click360Db.doc(path).get({source:'server'});throw Error('EXPECTED_DENIAL');}
      catch(e){if(e.code!=='permission-denied')throw e;}
    }
  },{owner:owner.uid,denialCase});
  if(runSale){
  await page.evaluate(()=>{
    window.addEventListener('click360-spark-operation-status',e=>window.WATCH_SALE_STATUS=e.detail);
    location.hash='#sell';
  });
  await page.locator('#manualCode').fill('STAGE-SPARK');
  await page.locator('#addCode').click();
  await page.locator('#payMethod').selectOption('Transferencia');
  await page.locator('#chargeBtn').click();
  await page.waitForFunction(()=>window.WATCH_SALE_STATUS?.status==='CONFIRMED');
  }
  await page.evaluate(({owner,worker})=>{
    window.WATCH_EVENTS=[];
    click360Db.doc(`businesses/${owner.uid}/businessUnits/${owner.uid}/members/${worker.uid}`)
      .onSnapshot({includeMetadataChanges:true},s=>WATCH_EVENTS.push({status:s.data()?.status,cache:s.metadata.fromCache}),
        e=>WATCH_EVENTS.push({error:e.code}));
  },{owner,worker});
  await page.waitForFunction(()=>WATCH_EVENTS.some(e=>e.status==='active'&&!e.cache));
  await member.update({status:'revoked'});
  try{await page.waitForFunction(()=>!window.click360User&&!window.click360SparkOperationalSession);}catch{}
  console.log(JSON.stringify({pwa:true,denialCase,sale:runSale,transport,sdkVersion:sdkVersion||'served',events:await page.evaluate(()=>WATCH_EVENTS),writerPresent:await page.evaluate(()=>!!window.click360SparkOperationalSession),network}));
  await page.close();
  }
} finally {
  await member.update({status:original.status});
  await browser.close();await admin.terminate();
}
