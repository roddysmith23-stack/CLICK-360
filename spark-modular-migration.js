(function(root) {
  'use strict';
  // Planning and comparison only. This file never starts a migration or writes
  // to Firestore. The coordinator must supply authenticated, fresh reads.
  const SCHEMA_VERSION = 2;
  const MAX_RECORD_BYTES = 800000;
  const arrays = Object.freeze({
    products:'products', sales:'sales', movements:'movements', cashSessions:'cashSessions',
    dailyReports:'dailyReports', auditLogs:'auditEvents', deletedProducts:'deletedProducts',
    invoices:'supplierInvoices', layaways:'layaways', tables:'tables', tableOrders:'tableOrders',
    restaurantPayments:'restaurantPayments', restaurantPrintHistory:'restaurantPrintHistory',
    restaurantEvents:'restaurantEvents', restaurantRecipes:'restaurantRecipes',
    labelPrintHistory:'labelPrintHistory', operationLedger:'legacyOperationLedger',
    'settings.customers':'customers', 'settings.labelTemplates':'labelTemplates',
    'settings.labelProfiles':'labelProfiles', 'settings.reminders':'reminders',
    'logistics.vehicles':'logisticsVehicles', 'logistics.routes':'logisticsRoutes',
    'logistics.loadSheets':'logisticsLoadSheets', 'logistics.routeSales':'logisticsRouteSales',
    'logistics.collections':'logisticsCollections', 'logistics.returns':'logisticsReturns',
    'logistics.routeSettlements':'logisticsSettlements', 'logistics.routeExpenses':'logisticsRouteExpenses',
    'logistics.routeCustomers':'logisticsRouteCustomers', 'logistics.events':'logisticsEvents',
    'logistics.printHistory':'logisticsPrintHistory', 'finance.payments':'financePayments',
    'finance.loans':'financeLoans', 'finance.envelopes':'financeEnvelopes', 'finance.goals':'financeGoals'
  });
  const clone = value => structuredClone(value);
  const isPlain = value => value && Object.getPrototypeOf(value) === Object.prototype;
  function canonical(value) {
    if(value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if(typeof value === 'number' && Number.isFinite(value)) return value;
    if(Array.isArray(value)) return value.map(canonical);
    if(isPlain(value)) return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
    throw Error('MIGRATION_EXPLICIT_JSON_TYPES_REQUIRED');
  }
  const json = value => JSON.stringify(canonical(value));
  const bytes = value => new TextEncoder().encode(json(value)).length;
  async function hash(value) {
    const digest=await root.crypto.subtle.digest('SHA-256',new TextEncoder().encode(json(value)));
    return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
  }
  function id(value) {
    if(typeof value!=='string'||!value||value.length>120||value==='.'||value==='..'||value.includes('/'))throw Error('MIGRATION_INVALID_ID');
    return value;
  }
  function assertSource(ownerUid, source, envelopeIdentity) {
    id(ownerUid);
    const identity=envelopeIdentity||source?.identity;
    if(!identity||identity.ownerUid!==ownerUid||identity.ownerId!==ownerUid
      ||identity.businessId!==ownerUid||identity.tenantKey!==`owner:${ownerUid}:business:${ownerUid}`
      ||identity.schemaVersion!==10)throw Error('MIGRATION_SOURCE_IDENTITY_MISMATCH');
    // Published snapshots normally keep identity in payload.identity, outside
    // payload.data. Never inject it into data just to satisfy migration hashes.
    if(source?.identity&&['ownerUid','ownerId','businessId','tenantKey','schemaVersion'].some(key=>source.identity[key]!==identity[key]))throw Error('MIGRATION_SOURCE_IDENTITY_MISMATCH');
    if(!Array.isArray(source.businesses)||!source.businesses.length)throw Error('MIGRATION_NO_BUSINESSES');
    const businessIds=source.businesses.map(b=>id(b.id));
    if(new Set(businessIds).size!==businessIds.length)throw Error('MIGRATION_DUPLICATE_BUSINESS');
    canonical(source);
    return businessIds;
  }
  async function selectSource({ownerUid,remote,local,unknownOperations}) {
    if(!remote||remote.source!=='server'||!Number.isSafeInteger(remote.revision))throw Error('MIGRATION_FRESH_SERVER_SOURCE_REQUIRED');
    if(!Number.isSafeInteger(unknownOperations)||unknownOperations!==0)throw Error('MIGRATION_UNKNOWN_OPERATIONS_STOP');
    const remoteBusinesses=assertSource(ownerUid,remote.snapshot,remote.identity);
    const remoteHash=await hash(remote.snapshot);
    if(!local)return {snapshot:clone(remote.snapshot),identity:clone(remote.identity||remote.snapshot.identity),source:'server',remoteRevision:remote.revision,remoteHash,sourceHash:remoteHash,businessIds:remoteBusinesses,pendingOperations:[]};
    if(local.durable!==true||typeof local.deviceRevision!=='string'||!local.deviceRevision)throw Error('MIGRATION_DURABLE_DEVICE_REQUIRED');
    if(!Array.isArray(local.pendingOperations)||local.pendingOperations.some(row=>['unknown','inflight'].includes(row?.state)))throw Error('MIGRATION_UNKNOWN_OPERATIONS_STOP');
    const localBusinesses=assertSource(ownerUid,local.snapshot,local.identity);
    const localHash=await hash(local.snapshot);
    const pending=local.pendingRemoteSync===true||local.cloudCapacityBlocked===true||(local.pendingOperations||[]).length>0;
    if(localHash===remoteHash)return {snapshot:clone(local.snapshot),identity:clone(local.identity||local.snapshot.identity),source:'device_equal',remoteRevision:remote.revision,remoteHash,sourceHash:localHash,businessIds:localBusinesses,pendingOperations:[...(local.pendingOperations||[])],deviceRevision:local.deviceRevision};
    if(pending){
      // Wall-clock timestamps cannot authorize selecting a conflicting fork.
      if(local.baseRevision!==remote.revision)throw Error('MIGRATION_REMOTE_DRIFT_STOP');
      return {snapshot:clone(local.snapshot),identity:clone(local.identity||local.snapshot.identity),source:'durable_pending_device',remoteRevision:remote.revision,remoteHash,sourceHash:localHash,businessIds:localBusinesses,pendingOperations:[...(local.pendingOperations||[])],deviceRevision:local.deviceRevision};
    }
    // A clean but materially different copy is not proof of safety. Preserve it
    // and require reconciliation rather than silently fetching over it.
    throw Error('MIGRATION_CLEAN_HASH_CONTRADICTION_STOP');
  }
  function at(object,path){return path.reduce((v,k)=>v?.[k],object);}
  function assign(object,path,value){
    let current=object;
    for(let i=0;i<path.length-1;i++){
      const key=path[i],next=path[i+1];
      if(current[key]===undefined)current[key]=typeof next==='number'?[]:{};
      current=current[key];
    }
    const key=path.at(-1);
    if(Object.hasOwn(current,key))throw Error('MIGRATION_DUPLICATE_SOURCE_PATH');
    current[key]=value;
  }
  function stats(source,businessIds){
    const output={};
    for(const businessId of businessIds){
      const belongs=row=>row.businessId===businessId||(!row.businessId&&businessIds.length===1);
      const sales=(source.sales||[]).filter(belongs);
      const products=(source.products||[]).filter(belongs);
      output[businessId]={products:products.length,sales:sales.length,
        movements:(source.movements||[]).filter(belongs).length,
        cashSessions:(source.cashSessions||[]).filter(belongs).length,
        dailyReports:(source.dailyReports||[]).filter(belongs).length,
        auditEvents:(source.auditLogs||[]).filter(belongs).length,
        salesTotal:sales.reduce((n,row)=>n+Number(row.total||0),0),
        stock:products.reduce((n,row)=>n+Number(row.stock??row.qty??0),0)};
    }
    return output;
  }
  async function plan({ownerUid,snapshot,identity,remoteRevision,deviceRevision=''}) {
    const businessIds=assertSource(ownerUid,snapshot,identity);
    if(!Number.isSafeInteger(remoteRevision)||remoteRevision<0)throw Error('MIGRATION_INVALID_REVISION');
    const sourceHash=await hash(snapshot),records=[],seen=new Set();
    function partition(row){
      const businessId=row.businessId||snapshot.settings?.legacyDataBusinessId||(businessIds.length===1?businessIds[0]:'');
      if(!businessIds.includes(businessId))throw Error('MIGRATION_AMBIGUOUS_BUSINESS_STOP');
      return businessId;
    }
    async function record(module,businessId,recordId,data,sourcePath){
      const key=`${businessId}/${module}/${recordId}`;
      if(seen.has(key))throw Error('MIGRATION_DUPLICATE_RECORD_ID');
      seen.add(key);
      const content={id:recordId,ownerUid,businessId,schemaVersion:SCHEMA_VERSION,module,
        sourceHash,sourcePath:clone(sourcePath),data:clone(data),dataHash:await hash(data)};
      if(bytes(content)>MAX_RECORD_BYTES)throw Error('MIGRATION_RECORD_TOO_LARGE_STOP');
      records.push({path:businessId===null?`businesses/${ownerUid}/legacyConfig/${recordId}`
        :`businesses/${ownerUid}/businessUnits/${businessId}/${module}/${recordId}`,content});
    }
    async function visit(value,path){
      const module=arrays[path.join('.')];
      if(module){
        if(!Array.isArray(value))throw Error('MIGRATION_MODULE_NOT_ARRAY');
        if(!value.length){await record('configEntries',null,await hash(path),[],path);return;}
        for(let i=0;i<value.length;i++){
          const row=value[i];if(!isPlain(row))throw Error('MIGRATION_ROW_NOT_OBJECT');
          const businessId=partition(row);
          const recordId=row.id||row.operationId||await hash({module,path,index:i,row});
          id(recordId);
          if(module==='products'&&row.stock!==undefined&&row.qty!==undefined&&Number(row.stock)!==Number(row.qty))throw Error('MIGRATION_STOCK_MIRROR_MISMATCH');
          await record(module,businessId,recordId,row,[...path,i]);
        }
      }else if(path.length===1&&path[0]==='businesses'){
        for(let i=0;i<value.length;i++)await record('config',id(value[i].id),'main',value[i],[...path,i]);
      }else if(Array.isArray(value)){
        if(!value.length)await record('configEntries',null,await hash(path),[],path);
        else for(let i=0;i<value.length;i++)await visit(value[i],[...path,i]);
      }else if(isPlain(value)){
        const entries=Object.entries(value);
        if(!entries.length)await record('configEntries',null,await hash(path),{},path);
        else for(const [key,item]of entries)await visit(item,[...path,key]);
      }else await record('configEntries',null,await hash(path),value,path);
    }
    for(const [key,value]of Object.entries(snapshot))await visit(value,[key]);
    const moduleHashes={};
    for(const scope of new Set(records.map(r=>`${r.content.businessId}/${r.content.module}`))){
      moduleHashes[scope]=await hash(records.filter(r=>`${r.content.businessId}/${r.content.module}`===scope).map(r=>({id:r.content.id,hash:r.content.dataHash})).sort((a,b)=>a.id.localeCompare(b.id)));
    }
    return {schemaVersion:SCHEMA_VERSION,ownerUid,identity:clone(identity||snapshot.identity),businessIds,sourceHash,remoteRevision,deviceRevision,
      counts:stats(snapshot,businessIds),records,moduleHashes,recordCount:records.length,payloadBytes:bytes(snapshot)};
  }
  // Deliberately independent of the planner's record traversal: remote records
  // must recreate the source, not merely repeat the planner's expected objects.
  async function compare({manifest,remoteRecords,source}){
    assertSource(manifest.ownerUid,source,manifest.identity);
    if(!Array.isArray(remoteRecords)||remoteRecords.length!==manifest.recordCount)throw Error('MIGRATION_REMOTE_COUNT_MISMATCH');
    const rebuilt={},seen=new Set(),actualModules={};
    const expectedPaths=new Set(manifest.records.map(r=>r.path));
    for(const row of remoteRecords){
      const c=row.content;
      if(!expectedPaths.has(row.path)||seen.has(row.path))throw Error('MIGRATION_REMOTE_ID_MISMATCH');
      seen.add(row.path);
      if(c.ownerUid!==manifest.ownerUid||c.sourceHash!==manifest.sourceHash||c.schemaVersion!==SCHEMA_VERSION
        ||c.dataHash!==await hash(c.data))throw Error('MIGRATION_REMOTE_INTEGRITY_MISMATCH');
      if(c.businessId!==null&&!manifest.businessIds.includes(c.businessId))throw Error('MIGRATION_REMOTE_BUSINESS_MISMATCH');
      if(!Array.isArray(c.sourcePath)||!c.sourcePath.length||c.sourcePath.some(k=>typeof k!=='string'&&(!Number.isSafeInteger(k)||k<0)))throw Error('MIGRATION_INVALID_SOURCE_PATH');
      // Prevent object-prototype pollution from a forged remote config path.
      if(c.sourcePath.some(k=>['__proto__','prototype','constructor'].includes(k)))throw Error('MIGRATION_UNSAFE_SOURCE_PATH');
      assign(rebuilt,c.sourcePath,clone(c.data));
      const scope=`${c.businessId}/${c.module}`;
      (actualModules[scope]??=[]).push({id:c.id,hash:c.dataHash});
    }
    const sourceHash=await hash(source),reconstructedHash=await hash(rebuilt);
    if(sourceHash!==manifest.sourceHash||reconstructedHash!==sourceHash)throw Error('MIGRATION_SEMANTIC_DIVERGENCE');
    const moduleHashes={};
    for(const [scope,rows]of Object.entries(actualModules))moduleHashes[scope]=await hash(rows.sort((a,b)=>a.id.localeCompare(b.id)));
    if(json(moduleHashes)!==json(manifest.moduleHashes)||json(stats(rebuilt,manifest.businessIds))!==json(manifest.counts))throw Error('MIGRATION_REMOTE_MODULE_MISMATCH');
    return {status:'SEMANTIC_EQUALITY_PASS',sourceHash,reconstructedHash,counts:stats(rebuilt,manifest.businessIds),moduleHashes,recordCount:remoteRecords.length};
  }
  root.CLICK360_SPARK_MIGRATION=Object.freeze({SCHEMA_VERSION,MAX_RECORD_BYTES,arrays,canonicalJson:json,byteLength:bytes,hash,selectSource,plan,compare});
})(typeof window==='undefined'?globalThis:window);
