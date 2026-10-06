import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile('cloud-safety-backup.js','utf8');
const assemble=source.slice(source.indexOf('  function assemble('),source.indexOf('  async function prepare('));
let allocations=0;
const guardedArray=new Proxy(Array,{construct(target,args){
  allocations++;
  assert(args[0]<=2,'Untrusted declared length reached the allocation sink');
  return Reflect.construct(target,args);
}});
const sandbox={Array:guardedArray,fail:code=>{throw Object.assign(new Error(code),{code});}};
vm.runInNewContext(`${assemble}; globalThis.assemble=assemble;`,sandbox);
assert.throws(()=>sandbox.assemble({snapshotFields:{},recordMetadata:{},arrayLengths:{sales:10000000},rows:{sales:[]}},{}),/backup_missing_row/);
assert.equal(allocations,0,'Missing rows must be rejected before ANY array allocation');
const valid=sandbox.assemble({snapshotFields:{},recordMetadata:{},arrayLengths:{sales:2},rows:{sales:[{index:1,value:{id:'b'}}]}},
  {business:{rows:{sales:[{index:0,value:{id:'a'}}]}}});
assert.equal(allocations,1);
assert.equal(JSON.stringify(valid.snapshot.sales),'[{"id":"a"},{"id":"b"}]');
console.log('PASS reconstruction resource guard: huge declared length rejected before allocation; legitimate scoped rows preserve exact order');
