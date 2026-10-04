// Emulator-only incremental shadow transport. Never activates live modules.
import {createHash} from 'node:crypto';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'
  ?Object.fromEntries(Object.keys(v).filter(k=>k!=='valueType'||typeof v.valueType!=='string'||!Object.hasOwn(v,v.valueType)).sort().map(k=>[k,canonical(v[k])])):v;
export const nativeHash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const safe=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(s);
const modules={products:'products',sales:'sales',movements:'movements',cashSessions:'cashSessions',dailyReports:'dailyReports',auditLogs:'auditEvents',customers:'customers'};
export function planShadow({ownerUid,businessId,revision,data}) {
  if(!safe(ownerUid)||!safe(businessId)||!Number.isSafeInteger(revision))throw Error('INVALID_SOURCE_IDENTITY_REVISION');
  const records=[],seen=new Set();
  for(const [sourceKey,module]of Object.entries(modules)) {
    const array=data[sourceKey];if(array&&!array.arrayValue)throw Error('UNSUPPORTED_MODULE_TYPE');
    for(const [index,nativeValue]of (array?.arrayValue?.values||[]).entries()){
      const fields=nativeValue.mapValue?.fields;if(!fields)throw Error('INVALID_NATIVE_RECORD');
      const recordBusiness=fields.businessId?.stringValue;
      if(recordBusiness!==businessId)throw Error('EXPLICIT_BUSINESS_PARTITION_REQUIRED');
      const legacyId=fields.id?.stringValue||'';
      if(legacyId&&seen.has(`${module}:${legacyId}`))throw Error('DUPLICATE_SOURCE_ID');
      if(legacyId)seen.add(`${module}:${legacyId}`);
      const id=nativeHash({ownerUid,businessId,module,legacyId:legacyId||index});
      records.push({module,id,index,sourceKey,nativeValue:canonical(nativeValue)});
    }
  }
  // One record per remaining field, rather than another unbounded config/main.
  for(const [key,value]of Object.entries(data).filter(([key])=>!modules[key]))records.push({module:'configFields',id:nativeHash(key),sourceKey:key,nativeValue:canonical(value)});
  const sourceHash=nativeHash(data);
  for(const record of records){
    if(/data:(?:image|video|audio)\//.test(JSON.stringify(record.nativeValue)))throw Error('INLINE_MEDIA_REQUIRES_SEPARATE_ASSET_PLAN');
    record.hash=nativeHash(record.nativeValue);
    record.bytes=Buffer.byteLength(JSON.stringify(record));
    if(record.bytes>800000)throw Error(`SHADOW_RECORD_TOO_LARGE:${record.module}`);
  }
  return {ownerUid,businessId,revision,sourceHash,records};
}
export function createEmulatorShadowTransport({projectId,host}) {
  if(!/^demo-[a-z0-9-]+$/.test(projectId)||host!=='127.0.0.1:48940')throw Error('EXACT_DEMO_LOOPBACK_REQUIRED');
  const base=`http://${host}/v1/projects/${projectId}/databases/(default)/documents`;
  const call=async(url,options={})=>{
    // Same emulator-only admin marker used by @google-cloud/firestore SDK.
    // This is not a real credential and can only go to the fixed demo loopback.
    const response=await fetch(url,{...options,redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer owner'}});
    const body=await response.json();if(!response.ok)throw Object.assign(Error(body.error?.message||'SHADOW_TRANSPORT_FAILED'),{status:response.status});return body;
  };
  return Object.freeze({kind:'emulator-shadow-only',
    async list(relative){let documents=[],token='';do{const page=await call(`${base}/${relative}?pageSize=1000&pageToken=${encodeURIComponent(token)}`);documents.push(...(page.documents||[]));token=page.nextPageToken||'';}while(token);return documents;},
    async read(relative){try{return await call(`${base}/${relative}`)}catch(e){if(e.status===404)return null;throw e;}},
    async create(relative,fields){return call(`${base}:commit`,{method:'POST',body:JSON.stringify({writes:[{update:{name:`projects/${projectId}/databases/(default)/documents/${relative}`,fields},currentDocument:{exists:false}}]})});}
  });
}
export async function importShadow({plan,transport,readSource,offset=0,limit=25}) {
  if(transport.kind!=='emulator-shadow-only')throw Error('EMULATOR_TRANSPORT_REQUIRED');
  if(!Number.isSafeInteger(offset)||offset<0||offset>plan.records.length||!Number.isInteger(limit)||limit<1||limit>100)throw Error('INVALID_SHADOW_CURSOR');
  const source=await readSource();
  if(source.revision!==plan.revision||nativeHash(source.data)!==plan.sourceHash)throw Error('SOURCE_CHANGED_STOP_SHADOW');
  const root=`businesses/${plan.ownerUid}/businessUnits/${plan.businessId}/migrationShadows/${plan.sourceHash}`;
  const end=Math.min(offset+limit,plan.records.length);
  for(const record of plan.records.slice(offset,end)){
    const relative=`${root}/modules/${record.module}/records/${record.id}`;
    const fields={sourceHash:{stringValue:plan.sourceHash},recordHash:{stringValue:record.hash},ownerUid:{stringValue:plan.ownerUid},businessId:{stringValue:plan.businessId},sourceKey:{stringValue:record.sourceKey},sourceIndex:{integerValue:String(record.index??-1)},nativeValue:record.nativeValue};
    let existing=await transport.read(relative);
    if(!existing){
      try{await transport.create(relative,fields)}catch(e){existing=await transport.read(relative);if(!existing)throw e;}
    }
    if(existing&&nativeHash(existing.fields)!==nativeHash(fields))throw Error('SHADOW_EXISTING_RECORD_CONFLICT');
  }
  const after=await readSource();
  if(after.revision!==plan.revision||nativeHash(after.data)!==plan.sourceHash)throw Error('SOURCE_CHANGED_STOP_SHADOW');
  return {nextOffset:end,done:end===plan.records.length,recordsImported:end,sourceHash:plan.sourceHash,cutoverEligible:false};
}
