(function(root){
  'use strict';
  // One record contract between preserved shadow data and the audited DEV
  // transaction kernel. No transport, migration activation or commercial write.
  const metadata=['recordVersion','createdAt','updatedAt','closedAt','createdBy','updatedBy'];
  const identityFields=['id','ownerUid','businessId','tenantKey','schemaVersion','storageSchemaVersion','module'];
  const domainId=(identity,moduleName,recordId)=>moduleName==='config'&&recordId==='main'?identity.businessId:recordId;
  function stockMirror(data,moduleName){
    if(moduleName!=='products')return;
    for(const field of ['stock','qty'])if(Object.hasOwn(data,field)
      &&(!['number','string'].includes(typeof data[field])||String(data[field]).trim()===''||!Number.isFinite(Number(data[field]))))throw Error('SPARK_CODEC_STOCK_INVALID');
    if(Object.hasOwn(data,'stock')&&Object.hasOwn(data,'qty')&&Number(data.stock)!==Number(data.qty))throw Error('SPARK_CODEC_STOCK_MIRROR_MISMATCH');
  }
  function check(expected,moduleName,recordId){
    if(!expected?.ownerUid||!expected?.businessId||!moduleName||!recordId||[expected.ownerUid,expected.businessId,moduleName,recordId].some(v=>typeof v!=='string'||v.includes('/')))throw Error('SPARK_CODEC_IDENTITY_REQUIRED');
    return `owner:${expected.ownerUid}:business:${expected.businessId}`;
  }
  async function unpack(raw,{identity,moduleName,recordId}){
    const tenantKey=check(identity,moduleName,recordId);
    const api=root.CLICK360_SPARK_MIGRATION;
    if(!api||raw?.schemaVersion!==2||raw.ownerUid!==identity.ownerUid||raw.businessId!==identity.businessId
      ||raw.module!==moduleName||raw.id!==recordId)throw Error('SPARK_CODEC_RECORD_IDENTITY_MISMATCH');
    if(raw.data===null||typeof raw.data!=='object'||Array.isArray(raw.data))throw Error('SPARK_CODEC_OPERATIONAL_OBJECT_REQUIRED');
    if(await api.hash(raw.data)!==raw.dataHash)throw Error('SPARK_CODEC_RECORD_HASH_MISMATCH');
    stockMirror(raw.data,moduleName);
    if(raw.data.businessId!==undefined&&raw.data.businessId!==identity.businessId)throw Error('SPARK_CODEC_PAYLOAD_BUSINESS_MISMATCH');
    if(raw.data.id!==undefined&&raw.data.id!==domainId(identity,moduleName,recordId))throw Error('SPARK_CODEC_PAYLOAD_ID_MISMATCH');
    const flat=structuredClone(raw.data);
    Object.assign(flat,{id:domainId(identity,moduleName,recordId),ownerUid:identity.ownerUid,businessId:identity.businessId,tenantKey,storageSchemaVersion:2,module:moduleName});
    // Initial shadow has no operational metadata: the first mutation starts
    // at version 1. Server timestamps stay native outside material JSON.
    for(const field of metadata)if(Object.hasOwn(raw,field))flat[field]=raw[field];
    flat.recordVersion=raw.recordVersion??1;
    if(!Number.isSafeInteger(flat.recordVersion)||flat.recordVersion<1)throw Error('SPARK_CODEC_RECORD_VERSION_INVALID');
    return flat;
  }
  async function pack(flat,{identity,moduleName,recordId,previous=null}){
    const tenantKey=check(identity,moduleName,recordId),api=root.CLICK360_SPARK_MIGRATION;
    if(!api||flat?.id!==domainId(identity,moduleName,recordId)||flat.ownerUid!==identity.ownerUid||flat.businessId!==identity.businessId
      ||flat.tenantKey!==tenantKey||flat.module!==moduleName||flat.storageSchemaVersion!==2)throw Error('SPARK_CODEC_RECORD_IDENTITY_MISMATCH');
    if(!Number.isSafeInteger(flat.recordVersion)||flat.recordVersion<1)throw Error('SPARK_CODEC_RECORD_VERSION_INVALID');
    if(previous){
      await unpack(previous,{identity,moduleName,recordId});
      if(flat.recordVersion!==(previous.recordVersion??1)+1)throw Error('SPARK_CODEC_REVISION_CONFLICT');
    }else if(flat.recordVersion!==1)throw Error('SPARK_CODEC_INITIAL_VERSION_INVALID');
    const data=previous?structuredClone(previous.data):{};
    for(const [key,value]of Object.entries(flat))if(!metadata.includes(key)&&!identityFields.includes(key))data[key]=structuredClone(value);
    // Preserve original embedded IDs/scopes in imported rows; newly created
    // records also expose these fields to legacy-compatible projections.
    data.id=domainId(identity,moduleName,recordId);data.businessId=identity.businessId;
    stockMirror(data,moduleName);
    const raw={id:recordId,ownerUid:identity.ownerUid,businessId:identity.businessId,schemaVersion:2,module:moduleName,
      data,dataHash:await api.hash(data)};
    for(const field of metadata)if(Object.hasOwn(flat,field))raw[field]=flat[field];
    // New operational records have no legacy origin. Do not manufacture
    // undefined fields on their second edit: Firestore rejects undefined.
    if(previous){
      if(Object.hasOwn(previous,'sourceHash'))raw.sourceHash=previous.sourceHash;
      if(Object.hasOwn(previous,'sourcePath'))raw.sourcePath=structuredClone(previous.sourcePath);
    }
    if(api.byteLength(data)>api.MAX_RECORD_BYTES)throw Error('SPARK_CODEC_RECORD_TOO_LARGE');
    return raw;
  }
  root.CLICK360_SPARK_RECORD_CODEC=Object.freeze({unpack,pack});
})(typeof window==='undefined'?globalThis:window);
