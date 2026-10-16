(function(root){
  'use strict';
  // Read existing journal at its installed version. No schema upgrade, write,
  // claim, confirmation or replay. An absent journal is not created.
  async function open(){
    if(!root.indexedDB)throw Error('P0A_DURABLE_JOURNAL_UNAVAILABLE');
    const existing=()=>new Promise((resolve,reject)=>{
      const r=root.indexedDB.open('click360-modular-outbox-v1');let absent=false;
      r.onupgradeneeded=()=>{absent=true;r.transaction.abort();};
      r.onsuccess=()=>resolve(r.result);
      r.onerror=()=>absent?resolve(null):reject(r.error);
      r.onblocked=()=>reject(Error('P0A_JOURNAL_BLOCKED'));
    });
    let db=await existing();
    if(db)db.onversionchange=()=>db.close();
    async function captureOwner(ownerUid){
      if(typeof ownerUid!=='string'||!ownerUid||/[/:.]/.test(ownerUid))throw Error('P0A_JOURNAL_IDENTITY_REQUIRED');
      const rows=[];
      // A journal absent at boot may be created by another same-origin tab.
      // Recheck absence; never report the earlier empty census as current.
      if(!db){db=await existing();if(db)db.onversionchange=()=>db.close();}
      if(db){
        if(!db.objectStoreNames.contains('operations'))throw Error('P0A_JOURNAL_SCHEMA_UNKNOWN');
        await new Promise((resolve,reject)=>{
          const tx=db.transaction('operations','readonly');let failure;
          const r=tx.objectStore('operations').openCursor(root.IDBKeyRange.bound(`${ownerUid}:`,`${ownerUid};`,false,true));
          r.onsuccess=()=>{
            const c=r.result;if(!c)return;
            try{
              const row=c.value;
              if(row.ownerUid!==ownerUid||!row.businessId||!row.operationId
                ||`${ownerUid}:${row.businessId}:${row.operationId}`!==row.key)throw Error('P0A_JOURNAL_ROW_IDENTITY_INVALID');
              rows.push(structuredClone(row));c.continue();
            }catch(e){failure=e;tx.abort();}
          };
          tx.oncomplete=resolve;tx.onabort=()=>reject(failure||tx.error||Error('P0A_JOURNAL_READ_FAILED'));
        });
      }
      return {ownerUid,rows,recordCount:rows.length,enumerationComplete:true};
    }
    return Object.freeze({captureOwner,close:()=>db?.close()});
  }
  root.CLICK360_P0A_JOURNAL=Object.freeze({open});
})(typeof window==='undefined'?globalThis:window);
