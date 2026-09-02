/** Offline comparison only. No merging, no invented deletes, no cloud writes. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {hash,fieldsData,assert} from './restore-core.mjs';
const [candidatePath,acquisitionPath,outputPath]=process.argv.slice(2);
assert(candidatePath&&acquisitionPath&&outputPath,'candidate acquisition output required');
const candidate=JSON.parse(await readFile(resolve(candidatePath),'utf8'));
const acquisition=JSON.parse(await readFile(resolve(acquisitionPath),'utf8'));
const historical=fieldsData(candidate.proposedHistoricalDocument.fields);
const states=[];
function visit(value,source,depth=0,inherited={}){
  if(depth>60||!value||typeof value!=='object')return;
  const context={identity:value.identity||inherited.identity,revision:value.revision??inherited.revision,pending:value.pendingRemoteSync===true||inherited.pending};
  if(Array.isArray(value.products)&&Array.isArray(value.sales)&&Array.isArray(value.movements))states.push({state:value,source,context});
  if(value.fields&&value.name?.includes('/state/main'))visit(fieldsData(value.fields),source,depth+1,context);
  for(const v of Object.values(value))if(v&&typeof v==='object')visit(v,source,depth+1,context);
}
for(const source of acquisition.records||[])visit(source.value,source);
const domains=['products','sales','movements','layaways','cashSessions','dailyReports','deletedProducts','operationLedger','settings.labelTemplates','settings.labelProfiles'];
const rows=(state,domain)=>{
  const value=domain.split('.').reduce((value,key)=>value?.[key],state);
  assert(value===undefined||Array.isArray(value),'MALFORMED_COLLECTION:'+domain);
  const list=value||[],ids=new Set();
  for(const row of list){const id=row?.id??row?.operationId;assert(typeof id==='string'&&id&&!ids.has(id),'MISSING_OR_DUPLICATE_ENTITY_ID:'+domain);ids.add(id);}
  return list;
};
const seen=new Set();
const results=[];
for(const {state,source,context}of states){
  const digest=hash(state),identity=context.identity||{};
  const identityValid=identity.ownerUid===candidate.scope.ownerUid&&identity.ownerId===candidate.scope.ownerUid&&identity.businessId===candidate.scope.businessId&&identity.tenantKey===candidate.scope.tenantKey;
  const differences=Object.fromEntries(domains.map(domain=>{
    const old=new Map(rows(historical.payload.data,domain).map(v=>[v.id??v.operationId,v]));
    const next=new Map(rows(state,domain).map(v=>[v.id??v.operationId,v]));
    return[domain,{add:[...next].filter(([id])=>!old.has(id)).map(([id])=>id),update:[...next].filter(([id,v])=>old.has(id)&&hash(v)!==hash(old.get(id))).map(([id])=>id),absentNotProvenDeleted:[...old.keys()].filter(id=>!next.has(id))}];
  }));
  let classification='UNKNOWN';
  if(seen.has(digest)||hash(state)===hash(historical.payload.data))classification='DUPLICATE';
  else if(source.classification==='LOCAL-PENDING'||context.pending)classification='LOCAL-PENDING';
  else if(Number(context.revision)>0&&Number(context.revision)<historical.revision)classification='STALE';
  // Never promote cached data to SERVER-COMMITTED from a count or timestamp.
  results.push({source:{kind:source.kind,key:source.key,rawValueHash:source.rawValueHash},hash:digest,identityValid,classification,differences,
    eligibleForAutomaticMerge:false,reason:identityValid?'Needs commit/pending-operation correlation and full validation':'TENANT_IDENTITY_UNRESOLVED'});
  seen.add(digest);
}
await writeFile(resolve(outputPath),JSON.stringify({mode:'OFFLINE_NO_MERGE',candidateHash:hash(candidate),acquisitionHash:hash(acquisition),sources:results,productionWrites:0},null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({candidateStates:results.length,identityVerified:results.filter(r=>r.identityValid).length,autoMerged:0,productionWrites:0}));
