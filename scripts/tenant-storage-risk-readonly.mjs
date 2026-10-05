#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {connectAdmin} from './lib/firebase-admin-connect.mjs';
const args=Object.fromEntries(process.argv.slice(2).map(arg=>{const [key,...value]=arg.replace(/^--/,'').split('=');return [key,value.join('=')||true];}));
if(args['read-only']!==true||!args.project)throw Error('Required: --read-only --project=<authorized-project>.');
const db=await connectAdmin(String(args.project),'tenant-storage-risk-readonly');
const rows=(await db.collectionGroup('state').get()).docs.filter(doc=>doc.id==='main'&&doc.ref.parent.parent?.parent.id==='businesses');
const report=[];
for(const doc of rows){
  const parent=doc.ref.parent.parent,ownerId=parent.id,legacy=doc.data(),state=legacy.payload?.data||{};
  const [access,health,heads]=await Promise.all([db.collection('accountAccess').doc(ownerId).get(),db.collection('customerHealth').doc(ownerId).get(),parent.collection('safetyBackupHeads').get()]);
  const payloadBytes=Buffer.byteLength(JSON.stringify(legacy.payload||{}));
  // Device-only changes cannot be inferred from a clean remote legacy snapshot.
  const device=health.exists?health.data():{};
  const pending=Number.isFinite(device.pendingOperations)?device.pendingOperations:null;
  const unknown=Number.isFinite(device.unknownOperations)?device.unknownOperations:null;
  const capacityBlocked=payloadBytes>850000||device.cloudCapacityBlocked===true;
  const criticalWithoutBackup=payloadBytes>=850000*.95&&heads.empty;
  const invalidLegacy=!legacy.payload?.data||!Array.isArray(state.businesses);
  const risk=capacityBlocked||criticalWithoutBackup||invalidLegacy?'RED':payloadBytes>=850000*.8?'YELLOW':'GREEN';
  const counts=Object.fromEntries(['products','sales','movements','cashSessions','dailyReports','auditLogs'].map(key=>[key,Array.isArray(state[key])?state[key].length:0]));
  report.push({tenantRef:createHash('sha256').update(parent.path).digest('hex').slice(0,16),plan:access.data()?.planId||access.data()?.plan||'UNKNOWN',
    risk,payloadBytes,legacyLimitBytes:850000,revision:legacy.revision||null,counts,
    storageArchitecture:'legacy',cloudCapacityBlocked:capacityBlocked,pendingOperations:null,unknownOperations:null,
    lastReportedPendingOperations:pending,lastReportedUnknownOperations:unknown,
    criticalWithoutBackup,invalidLegacy,
    deviceStatusAuthoritative:false,deviceObservationAvailable:health.exists,
    latestCompleteBackups:heads.docs.map(head=>({payloadSha256:head.data().payloadSha256,completedAt:head.data().completedAt?.toDate?.().toISOString()||null}))});
}
console.log(JSON.stringify({mode:'READ_ONLY',capturedAt:new Date().toISOString(),tenantCount:report.length,
  note:'GREEN classifies observed legacy capacity only; device-only pending/unknown operations remain unknown unless independently reconciled.',tenants:report},null,2));
