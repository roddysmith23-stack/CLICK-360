(function(root){
  'use strict';
  // Transport only. Not loaded by the public app and never enables cutover.
  // Operational Rules and domain adapters must certify each business mutation.
  const modules=new Set(['products','sales','movements','cashSessions','dailyReports','auditEvents','customers','operationLedger','config']);
  function copyProjection(value){
    const data={...value},native={};
    for(const field of ['createdAt','updatedAt','closedAt'])if(Object.hasOwn(data,field)){native[field]=data[field];delete data[field];}
    return {...structuredClone(data),...native};
  }
  function create({db,projectId,ownerUid,businessId,resolveUser,maxRecords=40}){
    const codec=root.CLICK360_SPARK_RECORD_CODEC;
    if(!codec||!db?.doc||!db?.runTransaction||typeof resolveUser!=='function')throw Error('SPARK_TRANSACTION_TRANSPORT_INCOMPLETE');
    if(!['demo-click360-spark-modular','click360-staging-7620168025'].includes(projectId)
      ||db.app?.options?.projectId!==projectId)throw Error('SPARK_TRANSACTION_NONPRODUCTION_ONLY');
    if(![ownerUid,businessId].every(v=>typeof v==='string'&&v.length&&v!=='..'&&v!=='.'&&!v.includes('/'))
      ||!Number.isSafeInteger(maxRecords)||maxRecords<1||maxRecords>40)throw Error('SPARK_TRANSACTION_SCOPE_INVALID');
    const identity={ownerUid,businessId},unit=`businesses/${ownerUid}/businessUnits/${businessId}`;
    const control=db.doc(`businesses/${ownerUid}/metadata/storage`);
    function context(){if(resolveUser()?.uid!==ownerUid)throw Error('SPARK_TRANSACTION_AUTH_CHANGED');}
    function scope(moduleName,recordId){
      if(!modules.has(moduleName)||typeof recordId!=='string'||!recordId||recordId.includes('/')||['.','..'].includes(recordId))throw Error('SPARK_TRANSACTION_RECORD_SCOPE_INVALID');
      return {identity,moduleName,recordId};
    }
    async function run(callback){
      context();if(typeof callback!=='function')throw Error('SPARK_TRANSACTION_CALLBACK_REQUIRED');
      return db.runTransaction(async tx=>{
        context();const snapshot=await tx.get(control);context();const c=snapshot.exists?snapshot.data():null;
        if(c?.ownerUid!==ownerUid||c.schemaVersion!==2||c.storageMode!=='modular'||c.phase!=='MODULAR'
          ||c.semanticEquality!=='PASS'||c.reconstructedHash!==c.sourceHash||!Array.isArray(c.businessIds)
          ||!c.businessIds.includes(businessId))throw Error('SPARK_TRANSACTION_CUTOVER_NOT_VERIFIED');
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
    return Object.freeze({run});
  }
  root.CLICK360_SPARK_TRANSACTION_TRANSPORT=Object.freeze({create});
})(typeof window==='undefined'?globalThis:window);
