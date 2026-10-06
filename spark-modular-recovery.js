(function(root){
  'use strict';
  // Separate immutable recovery database. Never opens, upgrades, clears or
  // replaces the production tenantSnapshots database or operation journal.
  async function open({ownerUid,resolveUser,databaseName='click360-spark-migration-recovery-v1'}={}){
    const api=root.CLICK360_SPARK_MIGRATION;
    if(!api||!root.indexedDB||typeof ownerUid!=='string'||!ownerUid||ownerUid.includes(':')
      ||typeof resolveUser!=='function')throw Error('SPARK_RECOVERY_IDENTITY_REQUIRED');
    const context=()=>{if(resolveUser()?.uid!==ownerUid)throw Error('SPARK_RECOVERY_OWNER_CONTEXT_CHANGED');};
    context();
    const db=await new Promise((resolve,reject)=>{
      const r=root.indexedDB.open(databaseName,1);
      r.onupgradeneeded=()=>r.result.createObjectStore('snapshots',{keyPath:'key'});
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
      r.onblocked=()=>reject(Error('SPARK_RECOVERY_DATABASE_BLOCKED'));
    });
    db.onversionchange=()=>db.close();
    const key=hash=>{if(!/^[a-f0-9]{64}$/.test(hash))throw Error('SPARK_RECOVERY_INVALID_HASH');return `${ownerUid}:${hash}`;};
    async function read(sourceHash){
      context();
      const row=await new Promise((resolve,reject)=>{
        const tx=db.transaction('snapshots','readonly');let value;
        tx.objectStore('snapshots').get(key(sourceHash)).onsuccess=e=>{value=e.target.result;};
        tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(tx.error||Error('SPARK_RECOVERY_READ_FAILED'));
      });
      context();if(!row)return null;
      if(row.ownerUid!==ownerUid||row.sourceHash!==sourceHash||await api.hash(row.snapshot)!==sourceHash
        ||await api.hash(row.content)!==row.contentHash)throw Error('SPARK_RECOVERY_INTEGRITY_FAILURE');
      return {...structuredClone(row.content),snapshot:structuredClone(row.snapshot),durable:true};
    }
    async function pin(input){
      context();const candidate=structuredClone(input);
      if(await api.hash(candidate.snapshot)!==candidate.sourceHash)throw Error('SPARK_RECOVERY_SOURCE_HASH_MISMATCH');
      if(api.byteLength(candidate)>8*1024*1024)throw Error('SPARK_RECOVERY_DEVICE_CAPACITY_EXCEEDED');
      const {snapshot,...content}=candidate;
      const row={key:key(candidate.sourceHash),ownerUid,sourceHash:candidate.sourceHash,snapshot,content,contentHash:await api.hash(content)};
      await new Promise((resolve,reject)=>{
        const tx=db.transaction('snapshots','readwrite');const store=tx.objectStore('snapshots');let failure;
        store.get(row.key).onsuccess=e=>{
          try{context();const previous=e.target.result;
            if(previous){if(api.canonicalJson(previous)!==api.canonicalJson(row))throw Error('SPARK_RECOVERY_PIN_CONFLICT');}
            else store.add(row);
          }catch(error){failure=error;tx.abort();}
        };
        tx.oncomplete=()=>resolve();tx.onabort=()=>reject(failure||tx.error||Error('SPARK_RECOVERY_WRITE_FAILED'));
      });
      // A completed write alone is not enough: independently read and hash it.
      return read(candidate.sourceHash);
    }
    return Object.freeze({pin,read,close:()=>db.close()});
  }
  root.CLICK360_SPARK_RECOVERY=Object.freeze({open});
})(typeof window==='undefined'?globalThis:window);
