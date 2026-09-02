/** Authenticated synthetic staging. Never production/customer data. */
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium,webkit} from 'playwright';
import {connectAdmin,connectAuth} from './lib/firebase-admin-connect.mjs';
import {largeTenantData,stateDocument,accountAccess,submitProduct,assertProduct} from '../qa/r38-emulator-support.mjs';
import {commerceFlows} from '../qa/r38-commerce-flows.mjs';
const PROJECT='click360-staging-7620168025',URL='https://click360-staging-7620168025.web.app/';
const directory=resolve('artifacts/full-mvp-20260831/staging');
const credentialsPath=join(directory,'synthetic-credentials.private.json');
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return i<0?[v,true]:[v.slice(0,i),v.slice(i+1)];}));
function stagingFixture(){
  const data=largeTenantData(credentials.uid);data.sales=[];data.movements=[];data.auditLogs=[];data.notifications=[];
  data.businesses[0].name='CLICK360 SYNTHETIC MVP QA';
  // Explicit synthetic stock, design and physically plausible media. This is
  // not a copied SHARY template or a mutation of a customer print profile.
  const template=data.settings.labelTemplates[0];template.name='SYNTHETIC TWO COLUMN QA';
  template.mediaWidthMm=100;template.universalDocument.paper.mediaWidthMm=100;
  template.universalDocument.objects.find(o=>o.type==='name').xMm=2;
  template.universalDocument.objects.find(o=>o.type==='name').yMm=25;
  template.universalDocument.objects.find(o=>o.type==='price').xMm=2;
  return data;
}
assert(args['--prepare-synthetic']||args['--verify-sha'],'Use --prepare-synthetic or --verify-sha=<exact commit>');
await mkdir(directory,{recursive:true,mode:0o700});
const db=await connectAdmin(PROJECT,'r38-synthetic-staging'),auth=await connectAuth(PROJECT);
let credentials;
try{credentials=JSON.parse(await readFile(credentialsPath,'utf8'));}catch(error){
  if(error.code!=='ENOENT'||!args['--prepare-synthetic'])throw error;
  const uid='qa-mvp-r38-'+randomUUID();
  credentials={uid,email:uid+'@click360-qa.invalid',password:randomBytes(36).toString('base64url'),projectId:PROJECT};
  await writeFile(credentialsPath,JSON.stringify(credentials),{flag:'wx',mode:0o600});
}
assert(credentials.projectId===PROJECT&&credentials.uid.startsWith('qa-mvp-r38-')&&credentials.email===credentials.uid+'@click360-qa.invalid','QA_IDENTITY_SCOPE');
const assertOwnedFixture=async()=>{
  const [user,access]=await Promise.all([auth.getUser(credentials.uid),db.doc(`accountAccess/${credentials.uid}`).get()]);
  assert(user.email===credentials.email&&access.exists&&access.data().source==='qa_fixture_r38'
    &&access.data().ownerId===credentials.uid&&access.data().businessId===credentials.uid,'SYNTHETIC_FIXTURE_OWNERSHIP_REQUIRED');
};
if(args['--prepare-synthetic']){
  let user;try{user=await auth.getUser(credentials.uid);}catch(error){if(error.code!=='auth/user-not-found')throw error;}
  if(user)assert(user.email===credentials.email,'EXISTING_QA_UID_MISMATCH');
  else await auth.createUser({uid:credentials.uid,email:credentials.email,password:credentials.password,displayName:'CLICK360 SYNTHETIC MVP QA',emailVerified:true});
  const ref=db.doc(`businesses/${credentials.uid}/state/main`),old=await ref.get();
  if(!old.exists){
    const data=stagingFixture();
    const batch=db.batch();
    batch.create(ref,{...stateDocument(credentials.uid,Date.now(),data),qaFixture:'CLICK360_SYNTHETIC_MVP_R38'});
    batch.create(db.doc(`accountAccess/${credentials.uid}`),{...accountAccess(credentials.uid),email:credentials.email,source:'qa_fixture_r38'});
    await batch.commit();
  }else {
    await assertOwnedFixture();
    if(args['--reset-owned-synthetic']){
      await writeFile(join(directory,'synthetic-before-reset-'+Date.now()+'.json'),JSON.stringify(old.data()),{flag:'wx',mode:0o600});
      const data=stagingFixture();
      await ref.update({...stateDocument(credentials.uid,Date.now(),data),qaFixture:'CLICK360_SYNTHETIC_MVP_R38'},{lastUpdateTime:old.updateTime});
    }
  }
  console.log('STAGING_SYNTHETIC_TENANT_PREPARED: 436 fixture products; no production writes; credentials private');
}else{
  const expected=args['--verify-sha'];assert(/^[a-f0-9]{7,40}$/.test(expected),'EXACT_SHA_REQUIRED');
  const response=await fetch(URL+'release-manifest.json',{cache:'no-store'}),manifest=await response.json();
  assert(manifest.buildSha===expected||expected.startsWith(manifest.buildSha),'STAGING_BUILD_SHA_MISMATCH');
  const artifact=[];
  for(const file of ['index.html','app.js','firebase-service.js','smart-print-core.js','safe-update.js','styles.css','service-worker.js','release-manifest.json']){
    const res=await fetch(URL+file,{cache:'no-store'});assert(res.ok,'STAGING_ASSET_'+file);
    const remote=Buffer.from(await res.arrayBuffer()),local=await readFile(resolve('dist',file));
    assert(remote.equals(local),'STAGING_ARTIFACT_BYTE_MISMATCH_'+file);
    const cache=res.headers.get('cache-control')||'';assert(cache.includes('no-cache'),'STAGING_CACHE_'+file);
    if(['index.html','service-worker.js','release-manifest.json'].includes(file))assert(cache.includes('no-store'),'STAGING_NO_STORE_'+file);
    artifact.push({file,sha256:createHash('sha256').update(remote).digest('hex'),cache});
  }
  const results=[],ref=db.doc(`businesses/${credentials.uid}/state/main`);
  await assertOwnedFixture();
  // Normal tenant saves may omit unknown envelope fields such as qaFixture.
  // Ownership comes from our private generated identity + Auth + accountAccess,
  // not from requiring the application to preserve test-only metadata.
  const cloud=async()=>{const snap=await ref.get();const data=snap.data();assert(snap.exists&&data.ownerUid===credentials.uid&&data.businessId===credentials.uid&&data.payload?.identity?.ownerUid===credentials.uid,'STAGING_SCOPE_CHANGED');return data;};
  const flows=commerceFlows({cloud,submitProduct,assertProduct,results,writePattern:'https://firestore.googleapis.com/**'});
  let browser;
  try{
    browser=await chromium.launch();
    const open=async(targetBrowser)=>{
      const context=await targetBrowser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
      page.setDefaultTimeout(60000);page.on('dialog',dialog=>dialog.accept());
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(URL,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>typeof window.click360Auth?.signInWithEmailAndPassword==='function');
      assert(await page.evaluate(()=>window.CLICK360_FIREBASE_CONFIG.projectId)===PROJECT,'APP_NOT_STAGING');
      await page.evaluate(({email,password})=>window.click360Auth.signInWithEmailAndPassword(email,password),credentials);
      await page.waitForFunction(()=>window.click360IsTenantDataHydrated?.()===true&&window.click360SyncStatus?.status==='synced');
      await flows.route(page,'inventory');return {context,page,errors};
    };
    const a=await open(browser),initial=await cloud();
    assert(initial.payload.data.products.length===436,'FRESH_436_FIXTURE_REQUIRED');
    await submitProduct(a.page,{code:'R38-CORE',name:'Producto R38 sintético',stock:10});
    const product=(await cloud()).payload.data.products.find(p=>p.code==='R38-CORE');assert(product,'AUTHORITATIVE_CREATE_REQUIRED');
    await flows.searchAndEdit(a.page,product.code,product.name);
    for(const stock of [17,25,31])await flows.editStock(a.page,product,stock);
    await flows.editStock(a.page,product,30);
    await a.page.locator('#productSearch').fill(product.code);await a.page.locator(`[data-edit="${product.id}"]`).click();
    await a.context.setOffline(true);await a.page.locator('#pQty').fill('31');await a.page.locator('#productForm button[type="submit"]').click();
    await a.page.locator('#productForm').waitFor({state:'detached'});
    assertProduct(await cloud(),product.id,30,'staging offline cannot mutate server');
    await a.context.setOffline(false);await flows.cloudUntil(d=>d.products.some(p=>p.id===product.id&&p.stock===31&&p.qty===31),'staging offline reconnection');await flows.sync(a.page);
    await flows.route(a.page,'inventory');await a.page.locator('#productSearch').fill(product.code);
    await a.page.evaluate(()=>{window.R38_PRINT_CALLS=0;window.print=()=>{window.R38_PRINT_CALLS++;};});
    await a.page.locator(`[data-label="${product.id}"]`).click();
    await a.page.locator('#quickLabelHomeQuantity').fill('4');await a.page.locator('#quickLabelHomePrint').click();
    await a.page.waitForFunction(()=>window.R38_PRINT_CALLS===1);
    const print=await a.page.evaluate(()=>({calls:window.R38_PRINT_CALLS,filled:document.querySelectorAll('#click360PrintPortal .labelPrintCell.filled').length,
      patterns:[...document.querySelectorAll('#click360PrintPortal .labelPrintPage')].map(p=>[...p.querySelectorAll('.labelPrintCell')].map(c=>c.classList.contains('filled')?'X':' ').join('')),
      css:document.querySelector('#click360-print-page-style')?.textContent}));
    assert(print.calls===1&&print.filled===4&&JSON.stringify(print.patterns)===JSON.stringify(['XX','XX']),'STAGING_PRINT_QUANTITY_COLUMNS');
    assert(print.css.includes('@page{size:100mm 64mm;margin:0'),'STAGING_PRINT_PHYSICAL_PAGE');
    await a.page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));await flows.sync(a.page);
    await a.page.reload({waitUntil:'domcontentloaded'});
    await a.page.waitForFunction(()=>window.click360IsTenantDataHydrated?.()===true&&window.click360SyncStatus?.status==='synced');
    assertProduct(await cloud(),product.id,31,'staging reload');
    const bBrowser=await webkit.launch();
    try{const b=await open(bBrowser);await b.page.waitForFunction(id=>window.click360GetTenantState().products.some(p=>p.id===id&&p.stock===31&&p.qty===31),product.id);assert(b.errors.length===0,'WEBKIT_ERRORS');await b.context.close();}finally{await bBrowser.close();}
    await flows.commerce(a.page,'authenticated-staging');
    if(await a.page.locator('#modalRoot .modalHeader [data-close]').count())await a.page.locator('#modalRoot .modalHeader [data-close]').click();
    for(const route of ['home','inventory','sell','cash','debtors','workers','tables','logistics','help']){
      await flows.route(a.page,route);assert(await a.page.locator('#app').innerText().then(t=>t.trim().length>20),'EMPTY_ROUTE_'+route);
    }
    assert(a.errors.length===0,'STAGING_BROWSER_ERRORS: '+JSON.stringify(a.errors));
    const final=await cloud();
    await writeFile(join(directory,'authenticated-results-'+Date.now()+'.json'),JSON.stringify({status:'PASS',sha:expected,manifest,artifact,print,results,products:final.payload.data.products.length,serverRevision:final.revision,productionWrites:0},null,2),{flag:'wx',mode:0o600});
    console.log('CLICK360_STAGING_CORE_PASS: exact artifact/cache, authoritative inventory A/B/offline, checkout, transfers, layaway lifecycle, cash voucher, print handoff, route smoke');
  }finally{await browser?.close();}
}
