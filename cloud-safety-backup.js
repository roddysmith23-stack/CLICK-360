(function(root){
  'use strict';
  // Disaster protection ONLY. No operational replay, stock mutation or restore.
  const FORMAT='click360-cloud-safety-v1',LIMIT=8*1024*1024,PART_BYTES=180000;
  const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
  const fail=code=>{throw Object.assign(new Error(code),{code});};
  function canonical(value){
    if(['undefined','function','symbol','bigint'].includes(typeof value))fail('unsupported_snapshot_value');
    if(Array.isArray(value))return value.map(canonical);
    if(value&&typeof value==='object'){
      if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('unsupported_snapshot_object_type');
      return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
    }
    if(typeof value==='number'&&!Number.isFinite(value))fail('unsupported_nonfinite_value');
    return value;
  }
  const json=value=>JSON.stringify(canonical(value));
  async function sha(value){
    const bytes=typeof value==='string'?encoder.encode(value):value;
    return Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  }
  function base64(bytes){
    let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return root.btoa(text);
  }
  const unbase64=text=>Uint8Array.from(root.atob(text),c=>c.charCodeAt(0));
  function identity(context,record){
    const ownerUid=context.ownerUid||context.ownerId;
    if(!ownerUid||context.authUid!==ownerUid||!context.tenantKey||!context.businessId)fail('backup_owner_identity_required');
    if(record.authUid!==context.authUid||record.ownerId!==ownerUid||record.tenantKey!==context.tenantKey||record.businessId!==context.businessId)fail('backup_durable_identity_mismatch');
    const i=record.snapshot?.identity;
    if(!i||String(i.ownerUid||i.ownerId)!==ownerUid||i.tenantKey!==context.tenantKey)fail('backup_snapshot_identity_mismatch');
    return ownerUid;
  }
  // Preserve the COMPLETE durable record, including pending/unknown metadata.
  // Business rows are physically separated; tenant-shared fields are owner-only.
  function partition(record){
    const businessIds=[...new Set((record.snapshot.businesses||[]).map(b=>String(b.id)))].sort();
    if(!businessIds.length||businessIds.some(id=>!id||id==='undefined'))fail('backup_business_identity_missing');
    const shared={recordMetadata:{...record},snapshotFields:Object.create(null),arrayLengths:Object.create(null),rows:Object.create(null)};
    delete shared.recordMetadata.snapshot;
    const scopes=Object.fromEntries(businessIds.map(id=>[id,{businessId:id,rows:{}}]));
    for(const [key,value]of Object.entries(record.snapshot)){
      if(!Array.isArray(value)){shared.snapshotFields[key]=value;continue;}
      shared.arrayLengths[key]=value.length;
      value.forEach((row,index)=>{
        const bid=key==='businesses'?String(row.id):String(row?.businessId||'');
        const bucket=Object.hasOwn(scopes,bid)?scopes[bid]:shared;
        (bucket.rows[key]||=[]).push({index,value:row});
      });
    }
    return {businessIds,shared,scopes};
  }
  function assemble(shared,scopes){
    const snapshot={...shared.snapshotFields};
    for(const [key,length]of Object.entries(shared.arrayLengths)){
      if(!Number.isSafeInteger(length)||length<0)fail('backup_invalid_array_length');
      const rows=new Array(length),seen=new Set();
      for(const bucket of [shared,...Object.values(scopes)])for(const entry of bucket.rows[key]||[]){
        if(!Number.isSafeInteger(entry.index)||entry.index<0||entry.index>=length||seen.has(entry.index))fail('backup_duplicate_or_invalid_row');
        seen.add(entry.index);rows[entry.index]=entry.value;
      }
      if(seen.size!==length)fail('backup_missing_row');
      snapshot[key]=rows;
    }
    return {...shared.recordMetadata,snapshot};
  }
  async function prepare(context,record,{buildSha,deviceId,sequence}={}){
    const ownerUid=identity(context,record);
    if(!/^[a-f0-9]{12,40}$/.test(buildSha||'')||!deviceId||!Number.isSafeInteger(sequence)||sequence<1)fail('backup_release_device_metadata_required');
    const normalized=JSON.parse(json(record)),payload=json(normalized),payloadBytes=encoder.encode(payload).length;
    // The device budget covers state; the immutable envelope needs bounded metadata headroom.
    if(encoder.encode(json(normalized.snapshot)).length>LIMIT||payloadBytes>LIMIT+128*1024)fail('backup_device_limit_exceeded');
    const payloadSha256=await sha(payload),materialHash=await sha(json(normalized.snapshot));
    const split=partition(normalized),chunks=[],scopeManifest=[];
    for(const [businessId,data]of [['',split.shared],...Object.entries(split.scopes)]){
      const scopeId=businessId?await sha(businessId):'tenant-shared';
      const bytes=encoder.encode(json(data)),parts=[];
      for(let offset=0,index=0;offset<bytes.length;offset+=PART_BYTES,index++){
        const raw=bytes.slice(offset,offset+PART_BYTES),text=base64(raw),id=`${scopeId}-${String(index).padStart(4,'0')}`;
        const part={id,scopeId,index,text,bytes:raw.length,sha256:await sha(raw)};
        chunks.push(part);parts.push({id,index,bytes:raw.length,sha256:part.sha256});
      }
      scopeManifest.push({scopeId,businessId,bytes:bytes.length,sha256:await sha(bytes),parts});
    }
    const backupId=await sha(json({ownerUid,tenantKey:context.tenantKey,deviceId,sequence,payloadSha256}));
    const manifest={format:FORMAT,backupId,ownerUid,tenantKey:context.tenantKey,contextBusinessId:context.businessId,businessIds:split.businessIds,deviceId,sequence,buildSha,schemaVersion:normalized.schemaVersion,snapshotRevision:String(normalized.deviceRevision||normalized.operationId||''),baseRevision:Number(normalized.baseRevision||0),payloadBytes,payloadSha256,canonicalMaterialHash:materialHash,partCount:chunks.length,scopes:scopeManifest,scopeIds:scopeManifest.map(s=>s.scopeId),pendingOperationsCount:(normalized.pendingOperations||[]).length,unknownOperationsCount:null};
    if(chunks.length>96||encoder.encode(json(manifest)).length>60000)fail('backup_manifest_limit_exceeded');
    return {manifest,chunks};
  }
  async function reconstruct(manifest,chunks){
    const {createdAt,completedAt,...boundedManifest}=manifest;
    if(!Number.isSafeInteger(manifest.payloadBytes)||manifest.payloadBytes<1||manifest.payloadBytes>LIMIT+128*1024
      ||!Number.isSafeInteger(manifest.partCount)||manifest.partCount<1||manifest.partCount>96
      ||!Array.isArray(manifest.scopes)||manifest.scopes.length>16
      ||encoder.encode(json(boundedManifest)).length>60000)fail('backup_manifest_limit_exceeded');
    if(json(manifest.scopeIds)!==json(manifest.scopes.map(s=>s.scopeId))
      ||new Set(manifest.scopeIds).size!==manifest.scopeIds.length)fail('backup_scope_list_mismatch');
    if(manifest.format!==FORMAT||!Array.isArray(chunks)||chunks.length!==manifest.partCount)fail('backup_missing_or_extra_part');
    const ids=new Map(chunks.map(part=>[part.id,part]));
    if(ids.size!==chunks.length)fail('backup_duplicate_part');
    let shared;const scopes=Object.create(null);
    for(const scope of manifest.scopes){
      const buffers=[];
      for(const expected of scope.parts){
        const part=ids.get(expected.id);
        if(!part||part.scopeId!==scope.scopeId||part.index!==expected.index)fail('backup_scope_or_index_mismatch');
        const raw=unbase64(part.text);
        if(raw.length!==expected.bytes||part.bytes!==expected.bytes||raw.length>PART_BYTES
          ||await sha(raw)!==expected.sha256||part.sha256!==expected.sha256)fail('backup_part_hash_mismatch');
        buffers.push(raw);ids.delete(expected.id);
      }
      const bytes=new Uint8Array(buffers.reduce((n,b)=>n+b.length,0));let offset=0;
      for(const buffer of buffers){bytes.set(buffer,offset);offset+=buffer.length;}
      if(bytes.length!==scope.bytes||await sha(bytes)!==scope.sha256)fail('backup_scope_hash_mismatch');
      const data=JSON.parse(decoder.decode(bytes));
      if(scope.businessId){if(data.businessId!==scope.businessId||await sha(scope.businessId)!==scope.scopeId)fail('backup_business_scope_mismatch');scopes[scope.businessId]=data;}
      else {if(shared||scope.scopeId!=='tenant-shared')fail('backup_shared_scope_mismatch');shared=data;}
    }
    if(ids.size||!shared)fail('backup_extra_part');
    const record=assemble(shared,scopes),payload=json(record);
    if(encoder.encode(payload).length!==manifest.payloadBytes||await sha(payload)!==manifest.payloadSha256||await sha(json(record.snapshot))!==manifest.canonicalMaterialHash)fail('backup_reconstruction_mismatch');
    identity({authUid:manifest.ownerUid,ownerUid:manifest.ownerUid,businessId:manifest.contextBusinessId,tenantKey:manifest.tenantKey},record);
    if(json(Object.keys(scopes).sort())!==json(manifest.businessIds))fail('backup_business_list_mismatch');
    if(record.schemaVersion!==manifest.schemaVersion||(record.pendingOperations||[]).length!==manifest.pendingOperationsCount||String(record.deviceRevision||record.operationId||'')!==manifest.snapshotRevision||Number(record.baseRevision||0)!==manifest.baseRevision)fail('backup_journal_metadata_mismatch');
    return record;
  }
  // Transport must enforce create-only data, authenticated scope, server verification
  // and timestamped completion. A lost response is read/reconciled, never replayed.
  async function upload(prepared,transport){
    const {manifest,chunks}=prepared;
    const existing=await transport.getManifest(manifest.backupId);
    if(existing&&['payloadSha256','ownerUid','tenantKey','deviceId','sequence','canonicalMaterialHash'].some(key=>existing[key]!==manifest[key]))fail('backup_id_conflict');
    if(existing?.status==='COMPLETE'){
      await reconstruct(existing,await transport.getParts(manifest.backupId));return existing;
    }
    // An interrupted upload may have been created by a prior certified build.
    // Resume its immutable manifest, never rewrite release provenance.
    if(!existing)await transport.begin(manifest);
    for(const chunk of chunks){
      const prior=await transport.getPart(manifest.backupId,chunk.id);
      if(prior){if(json(prior)!==json(chunk))fail('backup_immutable_part_conflict');}
      else await transport.createPart(manifest.backupId,chunk);
    }
    const readback=await transport.getParts(manifest.backupId);
    await reconstruct(existing||manifest,readback);
    try{await transport.complete(manifest.backupId);}catch(error){
      const outcome=await transport.getManifest(manifest.backupId);
      if(outcome?.status!=='COMPLETE')throw error;
    }
    const confirmed=await transport.getManifest(manifest.backupId);
    if(confirmed?.status!=='COMPLETE'||!confirmed.completedAt)fail('backup_server_confirmation_missing');
    await reconstruct(confirmed,await transport.getParts(manifest.backupId));
    return confirmed;
  }
  root.CLICK360_CLOUD_SAFETY=Object.freeze({FORMAT,LIMIT,PART_BYTES,canonical,json,sha,identity,partition,assemble,prepare,reconstruct,upload});
})(globalThis);
