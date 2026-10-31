// Exercise the support button in the actual served PWA. Fixtures are synthetic.
import assert from 'node:assert/strict';
export async function certifyDeviceHealthUI({page,label,output}){
  await page.evaluate(()=>{location.hash='#backup';});
  const button=page.getByRole('button',{name:'Verificar este iPhone (solo lectura)',exact:true});
  await button.waitFor({state:'visible'});
  const capture=()=>page.evaluate(async()=>{
    const names=(await indexedDB.databases()).filter(d=>d.name==='click360-modular-outbox-v1');
    if(names.length!==1)throw Error('ACTUAL_JOURNAL_REQUIRED');
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(names[0].name);
      r.onupgradeneeded=()=>{r.transaction.abort();reject(Error('NO_UPGRADE'));};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    try{return {schema:db.version,rows:await new Promise((resolve,reject)=>{const tx=db.transaction('operations','readonly');const r=tx.objectStore('operations').getAll();r.onsuccess=()=>resolve(r.result);tx.onabort=()=>reject(tx.error);}),legacyConflict:window.QA_RETAINED_LEGACY_CONFLICT?.value,storedConflict:window.QA_RETAINED_LEGACY_CONFLICT?localStorage.getItem(window.QA_RETAINED_LEGACY_CONFLICT.key):null};}
    finally{db.close();}
  });
  const before=await capture();
  await button.click();
  await page.waitForFunction(()=>{try{return JSON.parse(document.getElementById('c360-device-health-output').textContent)?.result;}catch{return false;}});
  let report=JSON.parse(await page.locator('#c360-device-health-output').textContent());
  assert.equal(report.result,'NO_GO_REVIEW_REQUIRED','A normal browser tab must not attest the original installed iPhone');
  assert.equal(report.runtimeAfter.standalone,false);
  assert.equal(report.journal.enumerationComplete,true);
  // Only this synthetic context emulates the installed display-mode signal.
  // This is UI coverage, never evidence of physical iPhone acceptance.
  await page.evaluate(()=>Object.defineProperty(navigator,'standalone',{value:true,configurable:true}));
  await button.click();
  await page.waitForFunction(()=>{try{return JSON.parse(document.getElementById('c360-device-health-output').textContent)?.result==='SUPERVISED_GO_CANDIDATE';}catch{return false;}});
  report=JSON.parse(await page.locator('#c360-device-health-output').textContent());
  assert.equal(report.localPreflightReady,true);
  assert.equal(report.journal.unknown+report.journal.queued+report.journal.inflight+report.journal.projectionPending,0);
  assert.equal(report.contextStable,true);assert.equal(report.journal.stable,true);
  assert.equal(report.runtimeAfter.writerInstalled,true);assert.equal(report.runtimeAfter.workerBuild,report.runtimeAfter.build);
  assert.equal(report.reviewedBuild,report.runtimeAfter.build,'The new support asset is included in the immutable release stamp');
  assert.equal(report.networkRequests,0);
  assert.deepEqual(await capture(),before,'UI inspection must preserve every journal row/schema and legacy conflict');
  // Copy is owner-initiated and returns exactly the sanitized technical report.
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.QA_HEALTH_COPIED=value;}},configurable:true});});
  await page.getByRole('button',{name:'Copiar resultado para soporte',exact:true}).click();
  assert.equal(await page.evaluate(()=>JSON.parse(window.QA_HEALTH_COPIED).journal.enumerationComplete),true);
  await page.screenshot({path:`${output}/device-health-${label}.png`,fullPage:true});
  // Existing view render events attach once even after leaving/re-entering.
  await page.evaluate(()=>{location.hash='#inventory';});await page.locator('#productSearch').waitFor({state:'visible'});
  await page.evaluate(()=>{location.hash='#backup';});await button.waitFor({state:'visible'});
  assert.equal(await page.locator('#c360-device-health-readonly').count(),1);
  console.log(JSON.stringify({status:'DEVICE_HEALTH_SERVED_UI_PASS',browser:label,completeJournal:true,readOnly:true,normalTabRefused:true,installedSignalSynthetic:true,realDeviceAcceptance:false}));
}
