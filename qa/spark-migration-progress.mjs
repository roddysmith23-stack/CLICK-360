// Harness-only observation of bounded importer work. No application retry,
// sleep or authority substitution. Each distinct completed chunk/scope gets
// the same existing deadline; repeated phases/heartbeats cannot extend it.
export async function waitForMigrationOutcome(page,{expectedReason,maxProgressEvents=512}={}){
  const seen=[];
  for(let event=0;event<=maxProgressEvents;event++){
    const handle=await page.waitForFunction(({seen,expectedReason})=>{
      const state=window.click360SparkBootstrapState;
      if(state?.phase==='BLOCKED'){
        if(state.reason!==expectedReason)throw Error(state.reason);
        return {done:true};
      }
      const p=window.click360SparkMigrationState;
      if(!p?.phase)return false;
      const key=JSON.stringify([p.phase,p.completed??null,p.completedScopes??null,p.stage??null,p.businessId??null]);
      return !seen.includes(key)?{done:false,key}:false;
    },{seen,expectedReason},{timeout:30000,polling:100});
    try{
      const result=await handle.jsonValue();
      if(result.done)return;
      seen.push(result.key);
    }finally{await handle.dispose();}
  }
  throw Error('QA_MIGRATION_PROGRESS_BOUND_EXCEEDED');
}
