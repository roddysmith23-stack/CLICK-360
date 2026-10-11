(function(root){
  'use strict';
  // Transport only. Not loaded by the public app and never enables cutover.
  // Operational Rules and domain adapters must certify each business mutation.
  const modules=new Set(['products','sales','movements','cashSessions','dailyReports','auditEvents','customers','operationLedger','config','metadata','layaways']);
  function copyProjection(value){
    const data={...value},native={};
    for(const field of ['createdAt','updatedAt','closedAt'])if(Object.hasOwn(data,field)){native[field]=data[field];delete data[field];}
    return {...structuredClone(data),...native};
  }
  function create({db,projectId,ownerUid,businessId,actorUid=ownerUid,resolveUser,maxRecords=40}){
    const codec=root.CLICK360_SPARK_RECORD_CODEC;
    if(!codec||!db?.doc||!db?.runTransaction||typeof resolveUser!=='function')throw Error('SPARK_TRANSACTION_TRANSPORT_INCOMPLETE');
    if(!['demo-click360-spark-modular','click360-staging-7620168025'].includes(projectId)
      ||db.app?.options?.projectId!==projectId)throw Error('SPARK_TRANSACTION_NONPRODUCTION_ONLY');
    if(![ownerUid,businessId,actorUid].every(v=>typeof v==='string'&&v.length&&v!=='..'&&v!=='.'&&!v.includes('/'))
      ||!Number.isSafeInteger(maxRecords)||maxRecords<1||maxRecords>40)throw Error('SPARK_TRANSACTION_SCOPE_INVALID');
    const identity={ownerUid,businessId},unit=`businesses/${ownerUid}/businessUnits/${businessId}/storage/v2`;
    const control=db.doc(`businesses/${ownerUid}/metadata/storage`);
    function context(){if(resolveUser()?.uid!==actorUid)throw Error('SPARK_TRANSACTION_AUTH_CHANGED');}
    function scope(moduleName,recordId){
      if(!modules.has(moduleName)||typeof recordId!=='string'||!recordId||recordId.includes('/')||['.','..'].includes(recordId))throw Error('SPARK_TRANSACTION_RECORD_SCOPE_INVALID');
      return {identity,moduleName,recordId};
    }
    async function run(callback){
      context();if(typeof callback!=='function')throw Error('SPARK_TRANSACTION_CALLBACK_REQUIRED');
      return db.runTransaction(async tx=>{
        context();
        if(actorUid===ownerUid){
          const snapshot=await tx.get(control);context();const c=snapshot.exists?snapshot.data():null;
          if(c?.ownerUid!==ownerUid||c.schemaVersion!==2||c.storageMode!=='modular'||c.phase!=='MODULAR'
            ||c.semanticEquality!=='PASS'||c.reconstructedHash!==c.sourceHash||!Array.isArray(c.businessIds)
            ||!c.businessIds.includes(businessId))throw Error('SPARK_TRANSACTION_CUTOVER_NOT_VERIFIED');
        }
        // Staff cannot read owner-wide migration metadata for other units.
        // Their scoped reads and immutable-ledger CREATE are authorized by
        // client Rules, which enforce modular mode and membership at commit.
        const reads=new Map(),writes=new Map();let writing=false,active=true;
        function live(){context();if(!active)throw Error('SPARK_TRANSACTION_SCOPE_EXPIRED');}
        async function get(moduleName,recordId){
          live();if(writing)throw Error('SPARK_TRANSACTION_READ_AFTER_WRITE');
          const s=scope(moduleName,recordId),key=`${moduleName}/${recordId}`;
          if(!reads.has(key)){
            if(reads.size>=maxRecords)throw Error('SPARK_TRANSACTION_RECORD_BUDGET');
            const ref=db.doc(`${unit}/${key}`),snap=await tx.get(ref);live();
            const raw=snap.exists?snap.data():null;
            const value=raw?await codec.unpack(raw,s):null;live();
            reads.set(key,{ref,raw,value,scope:s});
          }
          return reads.get(key).value?copyProjection(reads.get(key).value):null;
        }
        function stage(moduleName,recordId,value,kind){
          live();const s=scope(moduleName,recordId),key=`${moduleName}/${recordId}`,read=reads.get(key);
          if(!read)throw Error('SPARK_TRANSACTION_PRIOR_READ_REQUIRED');
          if(writes.has(key))throw Error('SPARK_TRANSACTION_DUPLICATE_WRITE');
          if(kind==='create'?read.raw!==null:read.raw===null)throw Error('SPARK_TRANSACTION_EXISTENCE_CONFLICT');
          writing=true;writes.set(key,{...read,scope:s,value:copyProjection(value)});
        }
        let result;
        try{
          result=await callback(Object.freeze({get,create:(m,id,v)=>stage(m,id,v,'create'),update:(m,id,v)=>stage(m,id,v,'update')}));
          live();
          // Validate/hash every write before queuing any SDK write. No partial
          // mutation survives a failed codec/identity/version check.
          const packed=[];
          for(const w of writes.values()){packed.push({ref:w.ref,data:await codec.pack(w.value,{...w.scope,previous:w.raw})});live();}
          for(const w of packed)tx.set(w.ref,w.data);
          return result;
        }finally{active=false;}
      });
    }
    async function readPage(moduleName,{limit=50,afterId=null}={}){
      context();
      // Paths and ordering are constructed here, not supplied by the UI.
      // Bound histories independently of their total number of records.
      if(!Number.isSafeInteger(limit)||limit<1||limit>100||typeof db.collection!=='function')throw Error('SPARK_PAGE_CONFIGURATION_INVALID');
      scope(moduleName,afterId===null?'page-scope':afterId);
      await run(async()=>true);
      context();
      let query=db.collection(`${unit}/${moduleName}`).orderBy('__name__').limit(limit);
      if(afterId!==null)query=query.startAfter(afterId);
      const snapshot=await query.get({source:'server'});context();
      if(snapshot.metadata?.fromCache!==false||snapshot.metadata?.hasPendingWrites!==false
        ||!Array.isArray(snapshot.docs)||snapshot.docs.length>limit)throw Error('SPARK_PAGE_NOT_SERVER_CONFIRMED');
      const records=[];let prior=afterId;
      for(const document of snapshot.docs){
        scope(moduleName,document.id);
        if(prior!==null&&document.id<=prior)throw Error('SPARK_PAGE_ORDER_CONFLICT');
        if(document.ref?.path!==`${unit}/${moduleName}/${document.id}`)throw Error('SPARK_PAGE_SCOPE_CONFLICT');
        records.push(await codec.unpack(document.data(),{identity,moduleName,recordId:document.id}));
        context();prior=document.id;
      }
      return {source:'server',identity:{...identity},records,
        nextCursor:records.length===limit?prior:null};
    }
    return Object.freeze({run,readPage});
  }
  root.CLICK360_SPARK_TRANSACTION_TRANSPORT=Object.freeze({create});
})(typeof window==='undefined'?globalThis:window);
