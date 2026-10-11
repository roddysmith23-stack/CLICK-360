import {watch} from 'node:fs';
import {readFile} from 'node:fs/promises';

export function failureReason(log){
  if(/ternary operator predicate is always boolean|java\.lang\.IllegalStateException/i.test(log))return 'SPARK_RULES_INTERNAL_EVALUATOR_FAILURE';
  if(/maximum of 1000 expressions|maximum.*document access|too many.*(access|calls)/i.test(log))return 'SPARK_RULES_EVALUATION_BUDGET_EXCEEDED';
  return null;
}

// Emulator-only QA lifecycle guard. No cloud polling or application hook.
// Abort a failed evaluator instead of allowing Web SDK UNKNOWN-RPC retries
// to keep the suite alive indefinitely. The Firebase CLI owns teardown.
export async function runClientSuite(files){
  if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:48944')throw Error('EXACT_SPARK_DEMO_EMULATOR_REQUIRED');
  let rejectFatal,busy=false,dirty=false,failed=false;
  const fatal=new Promise((_,reject)=>{rejectFatal=reject;});
  const check=async()=>{
    if(failed)return;
    dirty=true;
    if(busy)return;
    busy=true;
    try{
      // Coalesce filesystem notifications without dropping an append that
      // arrives while a previous read is in progress. No polling timer.
      do{
        dirty=false;
        const reason=failureReason(await readFile('firestore-debug.log','utf8'));
        if(reason){failed=true;rejectFatal(Error(reason));}
      }while(dirty&&!failed);
    }catch(error){failed=true;rejectFatal(error);}finally{busy=false;}
  };
  const watcher=watch('firestore-debug.log',()=>{void check();});
  const suite=async()=>{
    await check();
    for(const file of files){
      if(failed)throw Error('SPARK_RULES_SUITE_FAILED');
      await import(file);
      await check();
    }
  };
  try{return await Promise.race([suite(),fatal]);}finally{watcher.close();}
}
