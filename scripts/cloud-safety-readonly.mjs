#!/usr/bin/env node
// Read-only support tool. No restore, replay, cleanup or commercial writes.
import {mkdir,writeFile,chmod} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {connectAdmin} from './lib/firebase-admin-connect.mjs';
import '../cloud-safety-backup.js';
const args=Object.fromEntries(process.argv.slice(2).map(arg=>{const [key,...value]=arg.replace(/^--/,'').split('=');return [key,value.join('=')||true];}));
if(args['read-only']!==true||!args.project||!args.owner)throw Error('Required: --read-only --project=<project> --owner=<owner>.');
const db=await connectAdmin(String(args.project),'cloud-safety-readonly'),owner=db.collection('businesses').doc(String(args.owner));
const hash=value=>createHash('sha256').update(value).digest('hex');
const archives=await owner.collection('safetyBackups').get();
const list=archives.docs.map(doc=>{
  const data=doc.data();return {backupId:doc.id,status:data.status,payloadBytes:data.payloadBytes,
    payloadSha256:data.payloadSha256,canonicalMaterialHash:data.canonicalMaterialHash,
    buildSha:data.buildSha,partCount:data.partCount,sequence:data.sequence,
    completedAt:data.completedAt?.toDate?.().toISOString()||null,pendingOperationsCount:data.pendingOperationsCount,
    unknownOperationsCount:data.unknownOperationsCount};
});
if(!args.backup){console.log(JSON.stringify({mode:'READ_ONLY',tenantRef:hash(owner.path).slice(0,16),backups:list},null,2));}
else{
  if(!/^[a-f0-9]{64}$/.test(String(args.backup))||!args.out)throw Error('Reconstruction requires a valid --backup and private --out directory.');
  const captured=archives.docs.find(doc=>doc.id===args.backup),manifest=captured?.data();
  if(!manifest||manifest.status!=='COMPLETE'||manifest.verifiedBy!=='server-sha256-v1'||!manifest.completedAt)throw Error('Not a server-verified COMPLETE backup.');
  const parts=await captured.ref.collection('parts').get();
  const reconstructed=await globalThis.CLICK360_CLOUD_SAFETY.reconstruct(manifest,parts.docs.map(doc=>doc.data()));
  if(reconstructed.ownerId!==String(args.owner))throw Error('Owner identity mismatch.');
  const output=path.resolve(String(args.out));await mkdir(output,{recursive:true,mode:0o700});await chmod(output,0o700);
  const content=globalThis.CLICK360_CLOUD_SAFETY.json(reconstructed);
  await writeFile(path.join(output,'reconstructed-durable-record.json'),content,{mode:0o600,flag:'wx'});
  const evidence={mode:'READ_ONLY_VERIFIED',backupId:captured.id,payloadSha256:hash(content),payloadBytes:Buffer.byteLength(content),
    canonicalMaterialHash:manifest.canonicalMaterialHash,legacyUntouched:true,restoreImplemented:false};
  await writeFile(path.join(output,'verification.json'),JSON.stringify(evidence,null,2),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify(evidence,null,2));
}
