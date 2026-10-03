// Offline planning only. No Firebase SDK, credentials, transport or apply mode.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const [input, output] = process.argv.slice(2);
if (!input || !output || process.argv.includes('--apply')) throw new Error('Usage: modular-shadow-readonly.mjs VERIFIED_BACKUP_DIRECTORY PRIVATE_OUTPUT_DIRECTORY');
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])) : v;
const hash = v => createHash('sha256').update(typeof v === 'string' || Buffer.isBuffer(v) ? v : JSON.stringify(canonical(v))).digest('hex');
const bytes = await readFile(path.join(input,'firestore-native-backup.private.json'));
const manifest = JSON.parse(await readFile(path.join(input,'manifest.private.json'),'utf8'));
if (hash(bytes) !== manifest.backupSha256) throw new Error('BACKUP_HASH_MISMATCH');
const backup = JSON.parse(bytes);
const fields = backup.documents.stateMain.fields;
if (hash(fields) !== manifest.documentHashes.stateMainFieldsSha256) throw new Error('NATIVE_FIELDS_HASH_MISMATCH');
const data = fields.payload?.mapValue?.fields?.data?.mapValue?.fields;
if (!data) throw new Error('LEGACY_SCHEMA_UNSUPPORTED');
const mapping = {products:'products',sales:'sales',movements:'movements',cashSessions:'cashSessions',dailyReports:'dailyReports',auditLogs:'auditEvents'};
const modules = {};
const rebuilt = structuredClone(data);
for (const [sourceKey,module] of Object.entries(mapping)) {
  const raw = data[sourceKey];
  if (raw && !raw.arrayValue) throw new Error(`MODULE_TYPE_MISMATCH:${sourceKey}`);
  const seen = new Set();
  modules[module] = (raw?.arrayValue?.values || []).map((nativeValue,sourceIndex)=>{
    const record = nativeValue.mapValue?.fields;
    if (!record) throw new Error(`RECORD_TYPE_MISMATCH:${sourceKey}`);
    const legacyId = record.id?.stringValue || '';
    const businessId = record.businessId?.stringValue || backup.tenant.matchedBusinessIds[0];
    const idKey = `${businessId}:${legacyId}`;
    if (legacyId && seen.has(idKey)) throw new Error(`DUPLICATE_LEGACY_ID:${sourceKey}`);
    seen.add(idKey);
    return {recordId:`legacy-${hash({sourcePathSha256:manifest.sourcePathSha256,module,businessId,legacyId:legacyId || sourceIndex}).slice(0,48)}`,
      businessId,sourceKey,sourceIndex,nativeValue,nativeSha256:hash(nativeValue)};
  });
  if (raw) rebuilt[sourceKey] = {...raw,arrayValue:{...raw.arrayValue,
    ...(Object.hasOwn(raw.arrayValue,'values') ? {values:modules[module].map(row=>row.nativeValue)} : {})}};
}
modules.config = [{recordId:'main',nativeFields:Object.fromEntries(Object.entries(data).filter(([key])=>!mapping[key]))}];
// Independent roundtrip: reconstruct every original field, retaining native
// Timestamp/int64/bytes/reference/geopoint tags without JSON type coercion.
const equivalent = hash(rebuilt) === hash(data);
if (!equivalent) throw new Error('SHADOW_ROUNDTRIP_DIVERGENCE');
const evidence = {mode:'OFFLINE_NATIVE_SHADOW_ONLY',productionWrites:0,sourceRevision:manifest.sourceRevision,
  sourceUpdateTime:manifest.sourceUpdateTime,sourcePathSha256:manifest.sourcePathSha256,backupSha256:manifest.backupSha256,
  sourceFieldsSha256:manifest.documentHashes.stateMainFieldsSha256,legacyDataSha256:hash(data),reconstructedDataSha256:hash(rebuilt),
  equivalent,modules:Object.fromEntries(Object.entries(modules).map(([name,records])=>[name,{count:records.length,sha256:hash(records)}])),
  cutoverEligible:false,reason:'Device outbox reconciliation, remote shadow, rules, write fence and separate owner approval still required'};
await mkdir(output,{recursive:true,mode:0o700});
await writeFile(path.join(output,'native-shadow.private.json'),JSON.stringify({evidence,modules},null,2),{mode:0o600});
await writeFile(path.join(output,'manifest.private.json'),JSON.stringify(evidence,null,2),{mode:0o600});
console.log(JSON.stringify(evidence,null,2));
