import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const typed=x=>x===null?{nullValue:null}:Array.isArray(x)?{arrayValue:{values:x.map(typed)}}:typeof x==='object'?{mapValue:{fields:Object.fromEntries(Object.entries(x).map(([k,v])=>[k,typed(v)]))}}:typeof x==='string'?{stringValue:x}:typeof x==='boolean'?{booleanValue:x}:{integerValue:String(x)};
function fixture(){
  const directory=mkdtempSync(join(tmpdir(),'click360-offline-recovery-test-')),ownerUid='synthetic-recovery-owner',businessId='synthetic-logical-business';
  const scope={projectId:'demo-click360-recovery',databaseId:'(default)',ownerUid,businessId:ownerUid,tenantKey:`owner:${ownerUid}:business:${ownerUid}`,documentPath:`businesses/${ownerUid}/state/main`};
  const identity={schemaVersion:10,ownerUid,ownerId:ownerUid,businessId:ownerUid,tenantKey:scope.tenantKey};
  const data={businesses:[{id:businessId,name:'Synthetic'}],activeBusinessId:businessId,products:[{id:'p1',code:'P1',businessId,stock:17,qty:17,price:10,cost:5,cardPrice:10}],sales:[],movements:[],layaways:[],cashSessions:[],dailyReports:[],invoices:[],deletedProducts:[],auditLogs:[],operationLedger:[{operationId:'op1',businessId}],settings:{workers:[],labelTemplates:[],labelProfiles:[]}};
  const document={name:`projects/${scope.projectId}/databases/(default)/documents/${scope.documentPath}`,fields:typed({...identity,revision:9,payload:{schemaVersion:10,identity,data}}).mapValue.fields,updateTime:'2026-08-31T00:00:00Z'};
  const candidate={scope,restoreEligible:false,proposedHistoricalDocument:document};
  const save=(name,value)=>{const p=join(directory,name);writeFileSync(p,JSON.stringify(value),{flag:'wx'});return p;};
  return {directory,scope,identity,data,document,candidate,save};
}
const run=(script,args)=>spawnSync(process.execPath,['scripts/recovery/'+script,...args],{encoding:'utf8'});
test('offline classifier inherits authoritative envelope identity without promoting cached writes',()=>{
  const f=fixture(),candidate=f.save('candidate.json',f.candidate),changed=structuredClone(f.data);changed.products[0].stock=18;changed.products[0].qty=18;changed.operationLedger.push({operationId:'op2',businessId:changed.activeBusinessId});
  const acquisition=f.save('acquisition.json',{records:[
    {kind:'idb',value:{payload:{identity:f.identity,data:f.data},revision:9}},
    {kind:'pending',value:{payload:{identity:f.identity,data:changed},revision:10,pendingRemoteSync:true}},
    {kind:'cache',value:{payload:{identity:f.identity,data:changed},revision:11}}
  ]});
  const out=join(f.directory,'classification.json'),result=run('classify-client-candidates.mjs',[candidate,acquisition,out]);
  assert.equal(result.status,0,result.stderr);const parsed=JSON.parse(readFileSync(out));
  assert.deepEqual(parsed.sources.map(s=>s.classification),['DUPLICATE','LOCAL-PENDING','DUPLICATE']);
  assert(parsed.sources.every(s=>s.identityValid&&!s.eligibleForAutomaticMerge));
  assert.deepEqual(parsed.sources[1].differences['operationLedger'].add,['op2']);
  assert.equal(parsed.productionWrites,0);
  assert.notEqual(run('classify-client-candidates.mjs',[candidate,acquisition,out]).status,0,'existing evidence cannot be overwritten');
});
test('malformed/duplicate cached entities fail closed instead of collapsing a Map',()=>{
  const f=fixture();f.data.products.push(structuredClone(f.data.products[0]));
  const result=run('classify-client-candidates.mjs',[f.save('candidate.json',f.candidate),f.save('acquisition.json',{records:[{value:{identity:f.identity,data:f.data}}]}),join(f.directory,'out.json')]);
  assert.notEqual(result.status,0);assert.match(result.stderr,/MISSING_OR_DUPLICATE_ENTITY_ID/);
});
test('offline dry run displays every product change, absence and scalar null distinction',()=>{
  const f=fixture(),before=structuredClone(f.document),after=structuredClone(f.data);
  after.products[0].stock=18;after.products[0].qty=18;after.products.push({...after.products[0],id:'p2',code:'P2'});after.optional=null;
  before.fields.payload.mapValue.fields.data.mapValue.fields.products=typed([...f.data.products,{...f.data.products[0],id:'deleted',code:'DEL'}]);
  f.candidate.proposedHistoricalDocument.fields.payload.mapValue.fields.data=typed(after);
  const out=join(f.directory,'dry-run.md'),result=run('dry-run.mjs',[f.save('candidate.json',f.candidate),f.save('current.json',before),out]);
  assert.equal(result.status,0,result.stderr);const report=readFileSync(out,'utf8');
  for(const text of ['UPDATE "p1"','ADD "p2"','DELETE "deleted"','optional: before=undefined; after=null','Restore eligible: false','Production writes: 0'])assert(report.includes(text),text);
});
