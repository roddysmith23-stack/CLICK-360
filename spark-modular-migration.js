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
    const identityKeys=['ownerUid','ownerId','businessId','tenantKey','schemaVersion'];
    if(!isPlain(identity)||Object.keys(identity).some(key=>!identityKeys.includes(key)))throw Error('MIGRATION_SOURCE_IDENTITY_MISMATCH');
    if(!identity||identity.ownerUid!==ownerUid||identity.ownerId!==ownerUid
      ||identity.businessId!==ownerUid||identity.tenantKey!==`owner:${ownerUid}:business:${ownerUid}`
      ||identity.schemaVersion!==10)throw Error('MIGRATION_SOURCE_IDENTITY_MISMATCH');
    // Published snapshots normally keep identity in payload.identity, outside
    // payload.data. Never inject it into data just to satisfy migration hashes.
    if(source?.identity&&(!isPlain(source.identity)||Object.keys(source.identity).some(key=>!identityKeys.includes(key))||identityKeys.some(key=>source.identity[key]!==identity[key])))throw Error('MIGRATION_SOURCE_IDENTITY_MISMATCH');
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
    // The legacy writer/fence is owner-wide. A filtered one-business device
    // snapshot cannot authorize fencing a different business still in remote
    // legacy. Preserve both sources and stop; never silently drop/restore it.
    if(remoteBusinesses.some(businessId=>!localBusinesses.includes(businessId)))
      throw Error('MIGRATION_OWNER_BUSINESS_COVERAGE_STOP');
    const localHash=await hash(local.snapshot);
    // Only the fully validated transport identity may move between envelope and
    // snapshot. Preserve both original snapshots/hashes for recovery and CAS;
    // never ignore any commercial field when deciding material equivalence.
    const material=value=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='identity'));
    const remoteMaterialHash=await hash(material(remote.snapshot));
    const localMaterialHash=await hash(material(local.snapshot));
    const pending=local.pendingRemoteSync===true||local.cloudCapacityBlocked===true||(local.pendingOperations||[]).length>0;
    if(localHash===remoteHash)return {snapshot:clone(local.snapshot),identity:clone(local.identity||local.snapshot.identity),source:'device_equal',remoteRevision:remote.revision,remoteHash,sourceHash:localHash,businessIds:localBusinesses,pendingOperations:[...(local.pendingOperations||[])],deviceRevision:local.deviceRevision};
    if(localMaterialHash===remoteMaterialHash)return {snapshot:clone(local.snapshot),identity:clone(local.identity||local.snapshot.identity),source:'device_identity_equivalent',remoteRevision:remote.revision,remoteHash,sourceHash:localHash,remoteMaterialHash,localMaterialHash,businessIds:localBusinesses,pendingOperations:[...local.pendingOperations],deviceRevision:local.deviceRevision};
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
  function recordBusiness(snapshot,row){
    const businessIds=snapshot.businesses.map(b=>b.id);
    const businessId=row.businessId||snapshot.settings?.legacyDataBusinessId||(businessIds.length===1?businessIds[0]:'');
    if(!businessIds.includes(businessId))throw Error('MIGRATION_AMBIGUOUS_BUSINESS_STOP');
    return businessId;
  }
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
      return recordBusiness(snapshot,row);
    }
    async function record(module,businessId,recordId,data,sourcePath){
      const key=`${businessId}/${module}/${recordId}`;
      if(seen.has(key))throw Error('MIGRATION_DUPLICATE_RECORD_ID');
      seen.add(key);
      const content={id:recordId,ownerUid,businessId,schemaVersion:SCHEMA_VERSION,module,
        sourceHash,sourcePath:clone(sourcePath),data:clone(data),dataHash:await hash(data)};
      if(bytes(content)>MAX_RECORD_BYTES)throw Error('MIGRATION_RECORD_TOO_LARGE_STOP');
      records.push({path:businessId===null?`businesses/${ownerUid}/legacyConfig/${recordId}`
        :`businesses/${ownerUid}/businessUnits/${businessId}/storage/v2/${module}/${recordId}`,content});
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
  async function historicalPlan(snapshot,businessId,sourceHash,proof){
    if(sourceHash!==await hash(snapshot))throw Error('MIGRATION_HISTORY_SOURCE_HASH_MISMATCH');
    const modules=['cashSessions','sales','movements','dailyReports','layaways'];
    const rows=new Map(),links=new Map(),failures=[];
    for(const module of modules)for(const row of snapshot[module]||[])if(recordBusiness(snapshot,row)===businessId){
      const key=`${module}/${id(row.id)}`;
      if(rows.has(key))throw Error('MIGRATION_HISTORY_DUPLICATE_ID');
      rows.set(key,{module,row});links.set(key,new Set());
    }
    const connect=(from,module,target)=>{
      if(target===undefined||target===null||target==='')return;
      const key=`${module}/${target}`;
      if(!rows.has(key)){links.get(from).add(`missing:${key}`);return;}
      links.get(from).add(key);links.get(key).add(from);
    };
    for(const [key,{module,row}]of rows){
      connect(key,'cashSessions',row.cashSessionId);connect(key,'sales',row.saleId);
      connect(key,'dailyReports',row.reportId);connect(key,'layaways',row.layawayId);
      if(module==='dailyReports'&&Array.isArray(row.saleIds))for(const saleId of row.saleIds)connect(key,'sales',saleId);
    }
    // Legacy opening movements can omit cashSessionId. The financial proof
    // associates only their exact stable opening operation, never their date.
    // Keep those proven relationships in the immutable-history closure too.
    for(const [sessionId,history]of Object.entries(proof.unverifiedHistory)){
      const key=`cashSessions/${sessionId}`;
      for(const [module,ids]of [['sales',history.saleIds],['movements',history.movementIds],['dailyReports',history.reportIds]])
        for(const target of ids)connect(key,module,target);
    }
    const selected=new Set(),queue=[...Object.keys(proof.unverifiedHistory).map(sessionId=>`cashSessions/${sessionId}`),
      ...Object.keys(proof.unverifiedStandaloneHistory||{})];
    while(queue.length){const key=queue.pop();if(selected.has(key))continue;selected.add(key);
      if(!rows.has(key)){failures.push({reason:'MIGRATION_HISTORY_RELATIONSHIP_UNKNOWN'});continue;}
      for(const linked of links.get(key))queue.push(linked);
    }
    const historyPolicies={};
    for(const key of selected){
      const entry=rows.get(key);if(!entry)continue;
      const {module,row}=entry;
      if(module==='cashSessions'&&(row.status!=='closed'||typeof row.closedAt!=='string'||!row.closedAt))
        failures.push({record:key,reason:'MIGRATION_HISTORY_OPEN_SESSION_STOP'});
      if(module==='sales'&&(!Number.isFinite(row.total)||!Number.isFinite(row.received)||row.total<0||row.received<row.total
        ||(row.balance!==undefined&&row.balance!==0)||['layaway','pending_payment'].includes(row.status)))
        failures.push({record:key,reason:'MIGRATION_HISTORY_ACTIVE_RECEIVABLE_STOP'});
      if(module==='layaways'&&(!['picked_up','cancelled','refunded'].includes(row.status)||row.balance!==0))
        failures.push({record:key,reason:'MIGRATION_HISTORY_ACTIVE_LAYAWAY_STOP'});
      historyPolicies[key]={version:1,mode:'CLOSED_READ_ONLY',sourceHash,recordHash:await hash(row),
        reason:'MIGRATION_CASH_HISTORICAL_COMPONENT_UNVERIFIED'};
    }
    return {canProceed:proof.historicalPreservationReady&&failures.length===0,sourceHash,historyPolicies,failures};
  }
  async function historicalReadOnlyPlan({snapshot,businessId,sourceHash}){
    return historicalPlan(snapshot,businessId,sourceHash,await deriveCashSummaries({snapshot,businessId}));
  }
  async function deriveCashSummaries({snapshot,businessId,historicalReadOnly=false}){
    if(!snapshot?.businesses?.some(b=>b.id===businessId))throw Error('MIGRATION_CASH_BUSINESS_REQUIRED');
    const scoped=name=>(snapshot[name]||[]).filter(row=>recordBusiness(snapshot,row)===businessId);
    const sessions=scoped('cashSessions'),sales=scoped('sales'),movements=scoped('movements'),reports=scoped('dailyReports');
    const unique=rows=>{const ids=new Set();for(const row of rows){if(!row.id||ids.has(row.id))throw Error('MIGRATION_CASH_DUPLICATE_ID');ids.add(row.id);}return ids;};
    const sessionIds=unique(sessions);unique(sales);unique(movements);unique(reports);
    const cents=value=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0
      ||Math.abs(value*100-Math.round(value*100))>0.00001)throw Error('MIGRATION_CASH_AMOUNT_UNVERIFIED');return Math.round(value*100);};
    const saleById=new Map(sales.map(row=>[row.id,row])),verified={},failures=[],unverifiedHistory={},unverifiedStandaloneHistory={};
    // Enumerating sessions is insufficient if an orphan financial record has
    // a different date. Preserve that record, but do not certify counters that
    // silently omit it or attach it to another session by date.
    for(const row of sales)if(!sessionIds.has(row.cashSessionId))
      failures.push({cashSessionId:null,recordId:row.id,reason:'MIGRATION_CASH_ORPHAN_SALE_STOP'});
    for(const row of reports)if(!sessionIds.has(row.cashSessionId))
      failures.push({cashSessionId:null,recordId:row.id,reason:'MIGRATION_CASH_ORPHAN_REPORT_STOP'});
    for(const row of movements)if(['apertura','ingreso','egreso','retiro','compra'].includes(row.kind)&&!sessionIds.has(row.cashSessionId)){
      const exactOpening=row.kind==='apertura'&&row.operationId
        &&sessions.filter(session=>session.operationId===row.operationId).length===1;
      if(!exactOpening){
        // Some published legacy versions retained zero-valued expense/withdraw
        // notes with no session. They affect no balance and cannot be attached
        // by date. Preserve them ONLY as explicit immutable history; a receipt,
        // nonzero amount or dangling session reference never gets this path.
        const zeroHistory=['egreso','retiro'].includes(row.kind)&&row.amount===0&&!row.cashSessionId
          &&!row.saleId&&!row.productId&&!row.operationId&&/^\d{4}-\d{2}-\d{2}$/.test(row.date||'');
        if(zeroHistory)unverifiedStandaloneHistory[`movements/${row.id}`]={recordHash:await hash(row),
          operational:false,reason:'MIGRATION_CASH_ZERO_UNASSIGNED_HISTORY'};
        failures.push({cashSessionId:null,recordId:row.id,
          reason:zeroHistory?'MIGRATION_CASH_ZERO_UNASSIGNED_HISTORY':'MIGRATION_CASH_ORPHAN_MOVEMENT_STOP'});
      }
    }
    // Preservation and financial verification are deliberately different
    // contracts. Legacy records may contain corrupted payment-method objects,
    // reconciliation-only closures, or old reports reused by another session.
    // Preserve those original bytes/relationships, but never invent counters
    // or grant permission to reopen, receive money or close them again.
    const historySourceHash=await hash({businessId,cashSessions:sessions,sales,movements,dailyReports:reports});
    for(const session of sessions){
      try{
        if(!['open','closed'].includes(session.status)||!session.date)throw Error('MIGRATION_CASH_STATE_UNVERIFIED');
        // Date is only an ambiguity detector, NEVER an association key.
        if(sales.some(row=>row.date===session.date&&(!row.cashSessionId||!sessionIds.has(row.cashSessionId)))
          ||movements.some(row=>row.date===session.date&&!row.cashSessionId
            &&!(row.kind==='apertura'&&row.operationId&&row.operationId===session.operationId)))
          throw Error('MIGRATION_CASH_SESSION_ASSOCIATION_UNVERIFIED');
        const linkedSales=sales.filter(row=>row.cashSessionId===session.id&&row.status!=='cancelled');
        const linkedMoves=movements.filter(row=>row.cashSessionId===session.id
          ||(!row.cashSessionId&&row.kind==='apertura'&&row.operationId&&row.operationId===session.operationId)).filter(row=>row.status!=='cancelled');
        const linkedReports=reports.filter(row=>row.cashSessionId===session.id);
        if(linkedSales.some(row=>row.date!==session.date)||linkedMoves.some(row=>row.date!==session.date)
          ||linkedReports.some(row=>row.date!==session.date))throw Error('MIGRATION_CASH_DATE_CONFLICT');
        const opening=cents(session.openingAmount),openMoves=linkedMoves.filter(row=>row.kind==='apertura');
        if(openMoves.length!==1||cents(openMoves[0].amount)!==opening)throw Error('MIGRATION_CASH_OPENING_UNVERIFIED');
        let total=0,tax=0,items=0,cash=opening,income=0,expense=0,saleCount=0;
        const payments={cash:0,card:0,transfer:0,receivablePayments:0},verifiedInitial=new Set();
        for(const sale of linkedSales){
          total+=cents(sale.total);tax+=cents(sale.iva);saleCount++;
          if(!Array.isArray(sale.items)||!sale.items.length)throw Error('MIGRATION_CASH_ITEMS_UNVERIFIED');
          for(const line of sale.items){if(!Number.isSafeInteger(line.qty)||line.qty<1)throw Error('MIGRATION_CASH_ITEMS_UNVERIFIED');items+=line.qty;}
          const receipts=linkedMoves.filter(row=>row.saleId===sale.id);
          const received=cents(sale.received);
          let initialReceived=received;
          // The live UI accumulates sale.received after every abono. It is
          // not the initial deposit. Prove each subsequent receipt by its
          // stable operation, including receipts in a later exact session.
          if(Array.isArray(sale.payments)){
            unique(sale.payments);
            const initialPayments=sale.payments.filter(row=>!row.operationId||row.operationId===sale.operationId);
            if(initialPayments.length>1||sale.payments.reduce((sum,row)=>sum+cents(row.amount),0)!==received)
              throw Error('MIGRATION_CASH_PAYMENT_UNVERIFIED');
            initialReceived=initialPayments.reduce((sum,row)=>sum+cents(row.amount),0);
            const paymentOperations=new Set();
            for(const payment of sale.payments){
              if(!['Efectivo','Tarjeta','Transferencia'].includes(payment.method))throw Error('MIGRATION_CASH_PAYMENT_UNVERIFIED');
              if(!payment.operationId||payment.operationId===sale.operationId)continue;
              if(paymentOperations.has(payment.operationId))throw Error('MIGRATION_CASH_PAYMENT_UNVERIFIED');
              paymentOperations.add(payment.operationId);
              const matches=movements.filter(row=>row.status!=='cancelled'&&row.operationId===payment.operationId);
              if(matches.length!==1||matches[0].saleId!==sale.id||matches[0].kind!=='ingreso'
                ||matches[0].paymentType!=='receivable_payment'||matches[0].paymentMethod!==payment.method
                ||cents(matches[0].amount)!==cents(payment.amount)||!sessionIds.has(matches[0].cashSessionId)
                ||(payment.date!==undefined&&matches[0].date!==payment.date))throw Error('MIGRATION_CASH_PAYMENT_UNVERIFIED');
            }
          }
          const initial=receipts.filter(row=>row.operationId===sale.operationId
            ||(!row.operationId&&receipts.length===1&&(!sale.payments?.length||initialReceived>0)));
          if(!sale.operationId||(initialReceived>0?(initial.length!==1||cents(initial[0].amount)!==initialReceived):initial.some(row=>cents(row.amount)!==0)))
            throw Error('MIGRATION_CASH_SALE_RECEIPT_UNVERIFIED');
          const initialPayment=sale.payments?.find(row=>!row.operationId||row.operationId===sale.operationId);
          if(initialPayment&&initial.length===1&&initial[0].paymentMethod!==undefined
            &&initial[0].paymentMethod!==initialPayment.method)throw Error('MIGRATION_CASH_PAYMENT_UNVERIFIED');
          if(initial.length===1)verifiedInitial.add(initial[0].id);
        }
        for(const movement of linkedMoves){
          const amount=cents(movement.amount);
          if(movement.kind==='apertura')continue;
          if(movement.saleId){
            const sale=saleById.get(movement.saleId);
            if(!sale||sale.status==='cancelled')throw Error('MIGRATION_CASH_PAYMENT_UNVERIFIED');
            // Old initial receipts can omit paymentType/operationId. A unique
            // exact saleId receipt already verified above may supply that
            // provenance; never infer from date, note text or report amounts.
            const legacyInitial=verifiedInitial.has(movement.id);
            const type=movement.paymentType||(legacyInitial?(sale.method==='Apartado'?'receivable_payment':'sale'):null);
            const paymentMethod=movement.paymentMethod||(legacyInitial?sale.payments?.[0]?.method||sale.method:null);
            if(!['sale','receivable_payment'].includes(type))throw Error('MIGRATION_CASH_PAYMENT_UNVERIFIED');
            if(legacyInitial||movement.operationId===sale.operationId){
              if(sale.cashSessionId!==session.id||!verifiedInitial.has(movement.id))throw Error('MIGRATION_CASH_PAYMENT_UNVERIFIED');
            }else{
              const matchedPayments=(sale.payments||[]).filter(row=>row.operationId&&row.operationId===movement.operationId);
              if(type!=='receivable_payment'||matchedPayments.length!==1
                ||cents(matchedPayments[0].amount)!==amount||matchedPayments[0].method!==paymentMethod)
                throw Error('MIGRATION_CASH_PAYMENT_UNVERIFIED');
            }
            const method={Efectivo:'cash',Tarjeta:'card',Transferencia:'transfer'}[paymentMethod];
            if(!method&&amount>0)throw Error('MIGRATION_CASH_PAYMENT_UNVERIFIED');
            if(method)payments[method]+=amount;
            if(method==='cash')cash+=amount;
            if(type==='receivable_payment')payments.receivablePayments+=amount;
          }else if(movement.kind==='ingreso'){cash+=amount;income+=amount;}
          else if(['egreso','retiro','compra'].includes(movement.kind)){cash-=amount;expense+=amount;}
          else throw Error('MIGRATION_CASH_MOVEMENT_UNVERIFIED');
        }
        const activeReports=linkedReports.filter(row=>row.status!=='reopened');
        if(session.status==='closed'&&activeReports.length!==1)throw Error('MIGRATION_CASH_REPORT_UNVERIFIED');
        if(session.status==='open'&&activeReports.length)throw Error('MIGRATION_CASH_REPORT_STATE_CONFLICT');
        if(activeReports.length){
          const report=activeReports[0];
          if(Object.hasOwn(report,'total')){
            if(cents(report.total)!==total||report.saleCount!==saleCount
              ||typeof report.theoreticalCash!=='number'||Math.round(report.theoreticalCash*100)!==cash)
              throw Error('MIGRATION_CASH_REPORT_TOTAL_CONFLICT');
          }else{
            // Published v1 close stores saleIds/productQuantity/expectedCash,
            // not v2 total/saleCount/theoreticalCash. Verify that exact schema
            // against records; never manufacture absent counters as zero.
            const ids=report.saleIds;
            if(!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.length!==linkedSales.length
              ||ids.some(id=>!linkedSales.some(sale=>sale.id===id))||report.productQuantity!==items
              ||cents(report.taxTotal)!==tax||typeof report.expectedCash!=='number'
              ||Math.round(report.expectedCash*100)!==cash||cents(report.openingAmount)!==opening
              ||cents(report.income)!==cash-opening+expense||cents(report.expenses)!==expense)
              throw Error('MIGRATION_CASH_REPORT_TOTAL_CONFLICT');
            const expected={cash:0,card:0,transfer:0,layawayPayments:payments.receivablePayments};
            for(const sale of linkedSales){const key={Efectivo:'cash',Tarjeta:'card',Transferencia:'transfer'}[sale.method];if(key)expected[key]+=cents(sale.total);}
            if(!report.paymentTotals||Object.entries(expected).some(([key,value])=>cents(report.paymentTotals[key])!==value))
              throw Error('MIGRATION_CASH_REPORT_PAYMENT_CONFLICT');
          }
        }
        const summary={summaryVersion:1,saleCount,salesTotal:total/100,itemCount:items,taxTotal:tax/100,cashBalance:cash/100,
          openingAmount:opening/100,incomeCash:income/100,expenseCash:expense/100,
          paymentTotals:Object.fromEntries(Object.entries(payments).map(([key,value])=>[key,value/100])),
          closeCycle:1+linkedReports.filter(row=>row.status==='reopened').length};
        verified[session.id]={summary,summaryHash:await hash(summary),saleIds:linkedSales.map(row=>row.id),
          movementIds:linkedMoves.map(row=>row.id),reportIds:linkedReports.map(row=>row.id)};
      }catch(error){
        failures.push({cashSessionId:session.id,reason:error.message});
        if(session.status==='closed'&&typeof session.closedAt==='string'&&session.closedAt){
          unverifiedHistory[session.id]={
            status:'HISTORICAL_CLOSED_UNVERIFIED',businessId,cashSessionId:session.id,
            sourceHash:historySourceHash,sessionHash:await hash(session),reason:error.message,
            financiallyVerified:false,operational:false,reopenAllowed:false,
            saleIds:sales.filter(row=>row.cashSessionId===session.id).map(row=>row.id),
            movementIds:movements.filter(row=>row.cashSessionId===session.id
              ||(!row.cashSessionId&&row.kind==='apertura'&&row.operationId&&row.operationId===session.operationId)).map(row=>row.id),
            reportIds:reports.filter(row=>row.cashSessionId===session.id).map(row=>row.id)
          };
        }
      }
    }
    // Opt-in is only for a coordinator that installs the source-bound immutable
    // history policy enforced by Rules. No operational summary is granted.
    const historicalPreservationReady=failures.every(row=>Object.hasOwn(unverifiedHistory,row.cashSessionId)
      ||(row.reason==='MIGRATION_CASH_ZERO_UNASSIGNED_HISTORY'&&Object.hasOwn(unverifiedStandaloneHistory,`movements/${row.recordId}`)));
    const proof={verified,failures,unverifiedHistory,unverifiedStandaloneHistory,historicalPreservationReady};
    const historyPlan=historicalReadOnly===true?await historicalPlan(snapshot,businessId,await hash(snapshot),proof):null;
    return {canProceed:failures.length===0||(historicalReadOnly===true&&historyPlan.canProceed),verified,failures,unverifiedHistory,unverifiedStandaloneHistory,
      historyPlan,
      historicalPreservationReady,
      requiresHistoricalReadOnlyFence:Object.keys(unverifiedHistory).length>0||Object.keys(unverifiedStandaloneHistory).length>0};
  }
  root.CLICK360_SPARK_MIGRATION=Object.freeze({SCHEMA_VERSION,MAX_RECORD_BYTES,arrays,canonicalJson:json,byteLength:bytes,hash,selectSource,plan,compare,deriveCashSummaries,historicalReadOnlyPlan});
})(typeof window==='undefined'?globalThis:window);
