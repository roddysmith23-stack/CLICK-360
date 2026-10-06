import {createHash} from 'node:crypto';
const plans=new Set(['founder_legacy','basic','pro','business','enterprise']);
export function storageHealth({ownerUid,state,access={},control=null,local=null}){
  if(typeof ownerUid!=='string'||!ownerUid)throw Error('STORAGE_HEALTH_OWNER_REQUIRED');
  const data=state?.payload?.data;
  const valid=data&&typeof data==='object'&&!Array.isArray(data);
  const payloadBytes=valid?Buffer.byteLength(JSON.stringify(data)):null;
  const mode=['legacy','migrating','modular','frozen'].includes(control?.storageMode)?control.storageMode:'legacy';
  const counts=Object.fromEntries(['products','sales','movements','cashSessions','dailyReports','auditLogs'].map(k=>[k,valid&&Array.isArray(data[k])?data[k].length:null]));
  const requestedPlan=access.planId??access.plan??access.mode;
  const plan=plans.has(requestedPlan)?requestedPlan:'unverified';
  const pending=Number.isSafeInteger(local?.pendingCount)&&local.pendingCount>=0?local.pendingCount:null;
  const unknown=Number.isSafeInteger(local?.unknownCount)&&local.unknownCount>=0?local.unknownCount:null;
  const capacityBlocked=payloadBytes===null?null:payloadBytes>850000;
  const reasons=[];
  let risk='GREEN';
  if(payloadBytes===null){risk='RED';reasons.push('legacy_source_not_recognized_requires_review');}
  else if(mode!=='modular'&&capacityBlocked){risk='RED';reasons.push('legacy_cloud_ceiling_exceeded');}
  else if(mode!=='modular'&&payloadBytes>=680000){risk='YELLOW';reasons.push('approaching_legacy_ceiling');}
  if(mode==='migrating'||mode==='frozen'){risk='RED';reasons.push('storage_transition_requires_attention');}
  if(local?.cloudCapacityBlocked===true||(unknown!==null&&unknown>0)){risk='RED';reasons.push('device_pending_or_unknown');}
  return {tenantRef:createHash('sha256').update(`click360-storage-health:${ownerUid}`).digest('hex'),plan,
    storageArchitecture:mode,payloadBytes,cloudLegacyLimitBytes:850000,legacyCloudCapacityBlocked:capacityBlocked,
    counts,sourceRevision:Number.isSafeInteger(state?.revision)?state.revision:null,risk,reasons,
    deviceStatus:local?'provided_not_server_observed':'not_observable_from_server',pendingOperations:pending,unknownOperations:unknown,
    // No safety backup route is deployed; never infer COMPLETE from a local flag.
    latestVerifiedSafetyBackup:'not_observed',modularUsageBytes:null,countsScope:'legacy_snapshot_only'};
}
