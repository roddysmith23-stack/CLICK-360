/** Real Chromium storage serialization, synthetic local browser only. */
import {chromium} from 'playwright';
import {mkdtemp,writeFile,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const directory=await mkdtemp(join(tmpdir(),'click360-parser-synthetic-'));
const profile=join(directory,'profile');
const context=await chromium.launchPersistentContext(profile,{headless:true});
try{
  await context.route('**/*',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Synthetic storage fixture</title>'}));
  const page=await context.newPage();await page.goto('https://synthetic.invalid');
  await page.evaluate(async()=>{
    const identity={ownerId:'synthetic_owner',ownerUid:'synthetic_owner',businessId:'synthetic_business',tenantKey:'owner:synthetic_owner:business:synthetic_business'};
    const state={identity,products:[{id:'synthetic-p',businessId:identity.businessId,stock:17,qty:17}],sales:[],movements:[],settings:{labelTemplates:[{id:'synthetic-template'}]},password:'EXCLUDE_SENTINEL'};
    localStorage.setItem('CLICK360:V16:STATE:synthetic_owner:'+identity.tenantKey,JSON.stringify(state));
    localStorage.setItem('firebase:authUser:synthetic','EXCLUDE_SENTINEL');
    await new Promise((resolve,reject)=>{
      const open=indexedDB.open('CLICK360_V16_DB',1);
      open.onupgradeneeded=()=>open.result.createObjectStore('tenantSnapshots');
      open.onerror=()=>reject(open.error);
      open.onsuccess=()=>{
        const db=open.result,transaction=db.transaction('tenantSnapshots','readwrite');
        const store=transaction.objectStore('tenantSnapshots');
        store.put({state,pendingRemoteSync:true},identity.tenantKey);
        let randomSeed=617,noise='synthetic-large-';
        for(let i=0;i<600000;i++){randomSeed=(Math.imul(randomSeed,1664525)+1013904223)>>>0;noise+=String.fromCharCode(33+(randomSeed%90));}
        store.put({state:{...state,notes:noise},pendingRemoteSync:true},identity.tenantKey+':large');
        transaction.oncomplete=()=>{db.close();resolve();};transaction.onerror=()=>reject(transaction.error);
      };
    });
  });
}finally{await context.close();}
const config=join(directory,'config.json'),out=join(directory,'parsed.json');
await writeFile(config,JSON.stringify({ownerUid:'synthetic_owner',businessId:'synthetic_business',tenantKey:'owner:synthetic_owner:business:synthetic_business',origins:['https://synthetic.invalid']}));
const result=spawnSync(process.env.CLICK360_RECOVERY_PYTHON||'python3',['scripts/recovery/parse_client.py',profile,config,out],{encoding:'utf8',cwd:resolve(import.meta.dirname,'..')});
assert.equal(result.status,0,result.stderr);
const parsed=JSON.parse(await readFile(out,'utf8'));
assert(!JSON.stringify(parsed).includes('EXCLUDE_SENTINEL'),'secret sentinel leaked');
assert(parsed.records.some(r=>r.kind==='localStorage'&&r.value.products[0].stock===17),'localStorage actual serialization not recovered');
assert(parsed.records.some(r=>r.kind==='tenantSnapshots'),'IndexedDB actual serialization not recovered');
assert(parsed.records.some(r=>r.kind==='tenantSnapshots'&&JSON.stringify(r.value).includes('synthetic-large-')),'IndexedDB external blob was not decoded');
assert.equal(parsed.errors.length,0,JSON.stringify(parsed.errors));
await mkdir('output/playwright/recovery-parser',{recursive:true});
await writeFile('output/playwright/recovery-parser/result.json',JSON.stringify({status:'PASS',records:parsed.records.length,actualChromium:true,localStorage:true,indexedDB:true,largeBlob:true,credentialsExcluded:true,productionWrites:0},null,2));
console.log('PASS actual Chromium localStorage, IndexedDB, large external blob, secret exclusion; source fixture private');
