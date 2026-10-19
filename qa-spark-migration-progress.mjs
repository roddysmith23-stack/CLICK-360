import assert from 'node:assert/strict';
import vm from 'node:vm';
import {waitForMigrationOutcome} from './qa/spark-migration-progress.mjs';
const expectedReason='EXPECTED_CUTOVER_DISABLED';
function fake(states){
  let index=0,disposed=0;
  return {get disposed(){return disposed;},waitForFunction:async(fn,args,options)=>{
    assert.equal(options.timeout,30000);assert.equal(options.polling,100);
    const state=states[Math.min(index++,states.length-1)];
    const value=vm.runInNewContext(`(${fn.toString()})(args)`,{window:state,args});
    if(!value)throw Error('SIMULATED_NO_PROGRESS_TIMEOUT');
    return {jsonValue:async()=>value,dispose:async()=>disposed++};
  }};
}
const progress=(phase,completed)=>({click360SparkMigrationState:{phase,completed}});
{
  const page=fake([progress('SHADOW_WRITING',100),progress('SHADOW_WRITING',200),
    progress('SHADOW_VERIFYING',200),{click360SparkBootstrapState:{phase:'BLOCKED',reason:expectedReason}}]);
  await waitForMigrationOutcome(page,{expectedReason});assert.equal(page.disposed,4);
}
await assert.rejects(waitForMigrationOutcome(fake([progress('SHADOW_WRITING',100)]),{expectedReason}),/NO_PROGRESS_TIMEOUT/);
await assert.rejects(waitForMigrationOutcome(fake([progress('A',1),progress('B',1),progress('A',1)]),{expectedReason}),/NO_PROGRESS_TIMEOUT/);
await assert.rejects(waitForMigrationOutcome(fake([progress('A',1),progress('B',1)]),{expectedReason,maxProgressEvents:0}),/PROGRESS_BOUND_EXCEEDED/);
await assert.rejects(waitForMigrationOutcome(fake([{click360SparkBootstrapState:{phase:'BLOCKED',reason:'CONFLICT'}}]),{expectedReason}),/CONFLICT/);
console.log('PASS bounded migration observation: completed work advances, stall/repeated heartbeat/oscillation/conflict never authorize success');
