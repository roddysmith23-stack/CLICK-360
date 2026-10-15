// Independent reader/roundtrip; never writes, never grants cutover authority.
import {createHash} from 'node:crypto';
const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).filter(k=>k!=='valueType'||typeof v.valueType!=='string'||!Object.hasOwn(v,v.valueType)).sort().map(k=>[k,sorted(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(sorted(v))).digest('hex');
export async function compareShadow({plan,transport,sourceData}) {
  const rebuilt={},counts={};
  for(const module of new Set(plan.records.map(r=>r.module))){
    const prefix=`businesses/${plan.ownerUid}/businessUnits/${plan.businessId}/migrationShadows/${plan.sourceHash}/modules/${module}/records`;
    const expectedIds=plan.records.filter(r=>r.module===module).map(r=>r.id).sort();
    const actualIds=(await transport.list(prefix)).map(d=>d.name.split('/').at(-1)).sort();
    if(JSON.stringify(actualIds)!==JSON.stringify(expectedIds))throw Error('REMOTE_SHADOW_COUNT_ID_MISMATCH');
  }
  for(const record of plan.records){
    const relative=`businesses/${plan.ownerUid}/businessUnits/${plan.businessId}/migrationShadows/${plan.sourceHash}/modules/${record.module}/records/${record.id}`;
    const document=await transport.read(relative);const f=document?.fields;
    if(!f||f.ownerUid?.stringValue!==plan.ownerUid||f.businessId?.stringValue!==plan.businessId||f.sourceHash?.stringValue!==hash(sourceData)||f.recordHash?.stringValue!==hash(f.nativeValue))throw Error('REMOTE_SHADOW_INTEGRITY_MISMATCH');
    const key=f.sourceKey?.stringValue;const index=Number(f.sourceIndex?.integerValue);
    if(key!==record.sourceKey||index!==(record.index??-1))throw Error('REMOTE_SHADOW_ORDER_MISMATCH');
    counts[record.module]=(counts[record.module]||0)+1;
    if(record.module==='configFields')rebuilt[key]=f.nativeValue;
    else {rebuilt[key]??={arrayValue:{values:[]}};if(rebuilt[key].arrayValue.values[index])throw Error('REMOTE_SHADOW_DUPLICATE_INDEX');rebuilt[key].arrayValue.values[index]=f.nativeValue;}
  }
  // Preserve explicitly empty arrays and native wire wrappers from the source.
  for(const [key,value]of Object.entries(sourceData))if(value.arrayValue&&!rebuilt[key])rebuilt[key]=value;
  if(hash(rebuilt)!==hash(sourceData))throw Error('REMOTE_SHADOW_SEMANTIC_DIVERGENCE');
  return {equivalent:true,sourceHash:hash(sourceData),reconstructedHash:hash(rebuilt),counts,cutoverEligible:false};
}

