/** Entity-level offline diff; never an authorization or a cloud operation. */
import {readFile,writeFile} from 'node:fs/promises';
import {assert,hash,fieldsData,assertScope} from './restore-core.mjs';
import {validateRecoveredData} from './validate-candidate.mjs';
const [candidatePath,currentPath,outputPath]=process.argv.slice(2);
assert(candidatePath&&currentPath&&outputPath,'candidate current output.md required');
const candidate=JSON.parse(await readFile(candidatePath,'utf8')),current=JSON.parse(await readFile(currentPath,'utf8'));
const before=assertScope(candidate.scope,current).payload.data,after=fieldsData(candidate.proposedHistoricalDocument.fields).payload.data;
assertScope(candidate.scope,candidate.proposedHistoricalDocument);
const validation=validateRecoveredData(after,{production:candidate.scope.projectId==='click-360'});
const lines=['# SHARY_RECOVERY_DRY_RUN','',`Mode: OFFLINE. Production writes: 0. Restore eligible: ${candidate.restoreEligible===true}.`,
  `Candidate SHA-256: ${hash(candidate)}`,`Current updateTime: ${current.updateTime}`,`Intrinsic validation: ${validation.valid?'PASS':'FAIL'}`,`Unresolved validation codes: ${validation.errors.join(', ')||'none'}`,'',
  'Absence is shown as DELETE, not silently interpreted as an intentional deletion. Every DELETE/UPDATE requires provenance and newer-write reconciliation before restore.',''];
const paths=[...new Set([...Object.keys(before),...Object.keys(after)])];
for(const field of paths){
  if(field==='settings')continue;
  if(Array.isArray(before[field])&&Array.isArray(after[field]))diff(field,before[field],after[field]);
  else scalar(field,before[field],after[field]);
}
for(const field of new Set([...Object.keys(before.settings||{}),...Object.keys(after.settings||{})])){
  const a=before.settings?.[field],b=after.settings?.[field];
  if(Array.isArray(a)&&Array.isArray(b))diff('settings.'+field,a,b);else scalar('settings.'+field,a,b);
}
function scalar(field,a,b){lines.push(`- ${JSON.stringify(a)===JSON.stringify(b)?'KEEP':'UPDATE'} ${field}: before=${JSON.stringify(a)}; after=${JSON.stringify(b)}`);}
function diff(field,a,b){
  const old=new Map(a.map((row,index)=>[row?.id??`[index:${index}]`,row])),next=new Map(b.map((row,index)=>[row?.id??`[index:${index}]`,row]));
  lines.push(`## ${field}`, '',`CURRENT: ${a.length}; CANDIDATE: ${b.length}.`,'');
  for(const id of new Set([...old.keys(),...next.keys()])){
    const left=old.get(id),right=next.get(id),status=!old.has(id)?'ADD':!next.has(id)?'DELETE':hash(left)===hash(right)?'KEEP':'UPDATE';
    lines.push(`### ${status} ${JSON.stringify(id)}`,'');
    if(status==='KEEP')lines.push(`SHA-256: ${hash(right)}`,'');
    else lines.push('```json',JSON.stringify({before:left??null,after:right??null},null,2),'```','');
  }
}
await writeFile(outputPath,lines.join('\n')+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({mode:'OFFLINE',intrinsicPass:validation.valid,productionWrites:0,outputPrivate:true}));
