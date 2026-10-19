// Read-only timing diagnostic using an EXISTING synthetic staging account.
// No seeding, commercial commands, policy writes, retries or timeout changes.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
const project='click360-staging-7620168025';
const credential=JSON.parse(await readFile(process.argv[2],'utf8'));
assert.equal(credential.projectId,project);
assert(credential.uid.startsWith('qa-spark-staging-'));
assert(credential.email.endsWith('@click360-qa.invalid'));
const engine=process.argv[3]||'chromium';assert(['chromium','webkit'].includes(engine));
const browser=await ({chromium,webkit})[engine].launch();
try{
  const context=await browser.newContext();
  for(let restart=0;restart<2;restart++){
    const page=await context.newPage();
    page.on('console',m=>{if(m.text().startsWith('QA_QUERY_TIMING:'))console.log(m.text().slice(16));});
    await page.goto(`https://${project}.web.app/`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!window.click360Auth);
    await page.evaluate(()=>{
      if(CLICK360_FIREBASE_CONFIG.projectId!=='click360-staging-7620168025')throw Error('STAGING_REQUIRED');
      window.QA_QUERY_TIMINGS=[];
      const proto=firebase.firestore.Query.prototype,get=proto.get;
      proto.get=async function(...args){
        const start=performance.now(),module=this._delegate?._query?.path?.lastSegment?.()||'unknown';
        try{
          const result=await get.apply(this,args);
          const event={module,ms:Math.round(performance.now()-start),count:result.size,cache:result.metadata.fromCache};
          QA_QUERY_TIMINGS.push(event);console.log('QA_QUERY_TIMING:'+JSON.stringify(event));return result;
        }catch(error){
          const event={module,ms:Math.round(performance.now()-start),error:error.code||'unknown'};
          QA_QUERY_TIMINGS.push(event);console.log('QA_QUERY_TIMING:'+JSON.stringify(event));throw error;
        }
      };
    });
    if(restart===0)await page.evaluate(c=>click360Auth.signInWithEmailAndPassword(c.email,c.password),credential);
    let status='PASS';
    try{await page.waitForFunction(()=>{
      const s=window.click360SparkBootstrapState;
      if(s?.phase==='BLOCKED')throw Error(s.reason);
      return s?.phase==='READY';
    },null,{timeout:30000});}catch{status='FAIL';}
    console.log(JSON.stringify({engine,restart,status,diagnostic:await page.evaluate(async()=>({
      phase:window.click360SparkBootstrapState?.phase,
      reason:window.click360SparkBootstrapState?.reason,
      progress:window.click360SparkBootstrapProgress,
      health:await window.click360SparkOperationalSession?.health(),
      queries:window.QA_QUERY_TIMINGS
    }))}));
    await page.close();if(status==='FAIL')process.exitCode=1;
  }
}finally{await browser.close();}
