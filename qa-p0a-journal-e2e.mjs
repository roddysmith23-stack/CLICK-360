import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium,webkit,firefox} from 'playwright';
const source=await readFile('p0a-journal-reader.js','utf8');
for(const [name,engine] of Object.entries({chromium,webkit,firefox})){
  const browser=await engine.launch();
  try{
    const page=await browser.newPage();
    await page.route('https://p0a-journal.example.test/**',r=>r.fulfill({body:'<!doctype html><title>P0A</title>',contentType:'text/html'}));
    await page.goto('https://p0a-journal.example.test/');
    await page.addScriptTag({content:source});
    const result=await page.evaluate(async()=>{
      const reader=await CLICK360_P0A_JOURNAL.open();
      if((await reader.captureOwner('owner')).recordCount!==0)throw Error('Expected absent journal');
      const db=await new Promise((resolve,reject)=>{
        const r=indexedDB.open('click360-modular-outbox-v1',1);
        r.onupgradeneeded=()=>r.result.createObjectStore('operations',{keyPath:'key'});
        r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
      });
      const rows=Array.from({length:1000},(_,i)=>({key:'owner:b:op-'+i,ownerUid:'owner',businessId:'b',
        operationId:'op-'+i,state:i===999?'unknown':'queued',payload:{actorUid:'original-worker',sequence:i}}));
      await new Promise((resolve,reject)=>{const tx=db.transaction('operations','readwrite'),store=tx.objectStore('operations');
        for(const row of rows)store.add(row);store.add({key:'other:b:op',ownerUid:'other',businessId:'b',operationId:'op'});
        tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
      const capture=await reader.captureOwner('owner');reader.close();
      const reopened=await new Promise((resolve,reject)=>{const r=indexedDB.open('click360-modular-outbox-v1');
        r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const version=reopened.version;reopened.close();
      if(capture.recordCount!==1000||!capture.enumerationComplete||capture.rows.filter(r=>r.state==='unknown').length!==1)
        throw Error('Truncated journal');
      const sort=r=>[...r].sort((a,b)=>a.key.localeCompare(b.key));
      if(JSON.stringify(sort(rows))!==JSON.stringify(sort(capture.rows)))throw Error('Journal mutated');
      return {version,count:capture.recordCount,unknown:1};
    });
    assert.deepEqual(result,{version:1,count:1000,unknown:1});
    console.log(JSON.stringify({browser:name,status:'PASS',readOnlyOldSchema:true,lateJournalDetected:true,...result}));
  }finally{await browser.close();}
}
