/** Explicit, gated CLI. Default status is offline and never connects to Firestore. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';
import { MARKER,hash,firestoreFieldsHash,assert,assertReady,assertCurrent,buildReplacement,applyRecovery,conditionalRollback } from './restore-core.mjs';

const options = Object.fromEntries(process.argv.slice(2).map(arg => {const at=arg.indexOf('=');return at<0?[arg.replace(/^--/,''),true]:[arg.slice(0,at).replace(/^--/,''),arg.slice(at+1)];}));
assert(options.candidate,'--candidate=<private file> required');
const candidate = JSON.parse(await readFile(resolve(options.candidate),'utf8'));
const mode = options.mode || 'status';
if (mode === 'status') {
  console.log(JSON.stringify({marker:MARKER,mode:'OFFLINE',candidateHash:hash(candidate),restoreEligible:candidate.restoreEligible===true,productionWrites:0}));
} else {
  assert(['backup','restore','rollback'].includes(mode),'UNKNOWN_MODE');
  assert(options.attestation && options.directory,'ATTESTATION_AND_PRIVATE_DIRECTORY_REQUIRED');
  const attestation = JSON.parse(await readFile(resolve(options.attestation),'utf8'));
  assertReady(candidate,attestation);
  // The CLI is production-only; emulator regression injects a loopback client
  // into restore-core. Never send a demo project through real ADC/Google APIs.
  assert(candidate.scope.projectId === 'click-360','CLI_PRODUCTION_SCOPE_REQUIRED');
  // Evidence must exist and be byte-identical before any network mutation.
  for (const evidence of attestation.evidence) {
    const digest=createHash('sha256').update(await readFile(resolve(evidence.path))).digest('hex');
    assert(digest===evidence.sha256,'EVIDENCE_FILE_HASH_MISMATCH');
  }
  assert(options.apply === MARKER,'EXPLICIT_APPLY_MARKER_REQUIRED');
  const directory = resolve(options.directory);
  const auth = new GoogleAuth({scopes:['https://www.googleapis.com/auth/datastore']});
  const transport=await auth.getClient();
  const dbRoot=`projects/${candidate.scope.projectId}/databases/(default)`;
  const api='https://firestore.googleapis.com/v1/';
  const client={get:async name=>(await transport.request({url:api+name,method:'GET'})).data,
    commit:async writes=>(await transport.request({url:api+dbRoot+'/documents:commit',method:'POST',data:{writes}})).data};
  const save=async(name,value)=>writeFile(join(directory,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
  if(mode==='backup'){
    const current=await client.get(candidate.proposedHistoricalDocument.name);
    assertCurrent(candidate,attestation,current);
    await mkdir(directory,{mode:0o700}); // Never reuse/overwrite a preimage directory.
    const now=Date.now(),replacement=buildReplacement(candidate,current,attestation.operationId,now);
    const backup={before:current,beforeHash:firestoreFieldsHash(current.fields),candidateHash:hash(candidate),expectedAfterHash:firestoreFieldsHash(replacement.fields),plannedAtMs:now,managedBackupVerified:false};
    await save('production-before-restore.json',current);
    await save('recovery-candidate.json',candidate);
    await save('attestation.json',attestation);
    const related={};
    for(const path of [`accountAccess/${candidate.scope.ownerUid}`,`businesses/${candidate.scope.businessId}`]){
      try{related[path]=await client.get(dbRoot+'/documents/'+path);}catch(error){if(error.response?.status===404)related[path]={exists:false};else throw error;}
    }
    // Explicit extra document manifest must be SHARY-owned, never a collection
    // wildcard. Include every modular/print document identified during acquisition.
    for(const path of attestation.relatedDocumentPaths||[]){
      assert(typeof path==='string'&&path.startsWith(`businesses/${candidate.scope.businessId}/`)
        &&path.split('/').length%2===0&&path.split('/').every(segment=>/^[A-Za-z0-9_-]{1,128}$/.test(segment)),'RELATED_SCOPE_DENIED');
      related[path]=await client.get(dbRoot+'/documents/'+path);
    }
    await save('related-documents.json',related);
    await save('metadata.json',{operationId:attestation.operationId,updateTime:current.updateTime,revision:attestation.expectedRevision,readAt:new Date().toISOString(),relatedReadsAreSequential:true});
    await save('dry-run.json',{beforeHash:backup.beforeHash,afterHash:backup.expectedAfterHash,target:candidate.scope.documentPath,changedRootFields:['payload','schemaVersion','revision','baseRevision','updatedAtMs','updatedAt','reason','recoveryMarker','recoveryOperationId']});
    const dryRunEvidence=attestation.evidence.find(e=>e.kind==='dry-run');
    assert(dryRunEvidence,'ENTITY_LEVEL_DRY_RUN_EVIDENCE_REQUIRED');
    await writeFile(join(directory,'dry-run.md'),await readFile(resolve(dryRunEvidence.path)),{flag:'wx',mode:0o600});
    const managedName=dbRoot+'/documents/adminBackups/'+attestation.operationId;
    await client.commit([{update:{name:managedName,fields:{action:{stringValue:'shary_data_recovery'},targetPath:{stringValue:candidate.scope.documentPath},ownerUid:{stringValue:candidate.scope.ownerUid},beforeHash:{stringValue:backup.beforeHash},beforeState:{mapValue:{fields:current.fields}},createdAt:{stringValue:new Date(now).toISOString()}}},currentDocument:{exists:false}}]);
    const managed=await client.get(managedName);
    assert(firestoreFieldsHash(managed.fields.beforeState.mapValue.fields)===backup.beforeHash,'MANAGED_BACKUP_VERIFY_FAILED');
    backup.managedBackupVerified=true; backup.managedBackupName=managedName;
    await save('backup-control.json',backup);
    const files={};
    for(const name of ['production-before-restore.json','recovery-candidate.json','attestation.json','related-documents.json','metadata.json','dry-run.json','dry-run.md','backup-control.json']){
      files[name]=createHash('sha256').update(await readFile(join(directory,name))).digest('hex');
    }
    await save('hashes.json',{before:backup.beforeHash,candidate:backup.candidateHash,expectedAfter:backup.expectedAfterHash,files});
    await writeFile(join(directory,'hashes.txt'),Object.entries(files).map(([name,digest])=>`${digest}  ${name}`).join('\n')+'\n',{flag:'wx',mode:0o600});
    console.log('PRE_RESTORE_BACKUP_VERIFIED');
  }else{
    const hashes=JSON.parse(await readFile(join(directory,'hashes.json'),'utf8'));
    for(const name of ['production-before-restore.json','recovery-candidate.json','attestation.json','related-documents.json','metadata.json','dry-run.json','dry-run.md','backup-control.json']){
      assert(createHash('sha256').update(await readFile(join(directory,name))).digest('hex')===hashes.files?.[name],'BACKUP_FILE_HASH_MISMATCH_'+name);
    }
    const backup=JSON.parse(await readFile(join(directory,'backup-control.json'),'utf8'));
    assert(backup.managedBackupName===dbRoot+'/documents/adminBackups/'+attestation.operationId,'MANAGED_BACKUP_SCOPE_MISMATCH');
    const managed=await client.get(backup.managedBackupName);
    assert(firestoreFieldsHash(managed.fields.beforeState.mapValue.fields)===backup.beforeHash,'MANAGED_BACKUP_VERIFY_FAILED');
    if(mode==='restore'){
      const result=await applyRecovery({client,candidate,attestation,backup,now:backup.plannedAtMs});
      await save('restore-result-'+Date.now()+'.json',result);
      if(result.status==='VERIFY_FAILED_REQUIRES_CONDITIONAL_ROLLBACK'){
        const rollback=await conditionalRollback({client,candidate,backup,expectedPostUpdateTime:result.second.updateTime});
        await save('rollback-result-'+Date.now()+'.json',rollback);
        throw new Error('RESTORE_NOT_VERIFIED_CONDITIONAL_ROLLBACK_EXECUTED');
      }
      console.log(result.status);
    }else{
      assert(options['post-update-time'],'EXACT_POST_UPDATE_TIME_REQUIRED');
      const result=await conditionalRollback({client,candidate,backup,expectedPostUpdateTime:options['post-update-time']});
      await save('rollback-result-'+Date.now()+'.json',result);
      console.log(result.status);
    }
  }
}
