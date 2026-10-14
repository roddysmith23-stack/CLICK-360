(function(root){
  'use strict';
  // Separate immutable recovery database. Never opens, upgrades, clears or
  // replaces the production tenantSnapshots database or operation journal.
  async function open({ownerUid,resolveUser,databaseName='click360-spark-migration-recovery-v1'}={}){
    const api=root.CLICK360_P0A_CANONICAL;
    if(!api||!root.indexedDB||typeof ownerUid!=='string'||!ownerUid||ownerUid.includes(':')
      ||typeof resolveUser!=='function')throw Error('SPARK_RECOVERY_IDENTITY_REQUIRED');
    const context=()=>{if(resolveUser()?.uid!==ownerUid)throw Error('SPARK_RECOVERY_OWNER_CONTEXT_CHANGED');};
    context();
    const db=await new Promise((resolve,reject)=>{
      const r=root.indexedDB.open(databaseName,3);
      r.onupgradeneeded=()=>{
        if(!r.result.objectStoreNames.contains('snapshots'))r.result.createObjectStore('snapshots',{keyPath:'key'});
        if(!r.result.objectStoreNames.contains('deviceIdentities'))r.result.createObjectStore('deviceIdentities',{keyPath:'ownerUid'});
        if(!r.result.objectStoreNames.contains('captures'))r.result.createObjectStore('captures',{keyPath:'key'});
      };
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
      r.onblocked=()=>reject(Error('SPARK_RECOVERY_DATABASE_BLOCKED'));
    });
    db.onversionchange=()=>db.close();
    const key=hash=>{if(!/^[a-f0-9]{64}$/.test(hash))throw Error('SPARK_RECOVERY_INVALID_HASH');return `${ownerUid}:${hash}`;};
    async function deviceIdentity(preferredDeviceId=''){
      context();
      const valid=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(value);
      const deviceId=await new Promise((resolve,reject)=>{
        const tx=db.transaction('deviceIdentities','readwrite'),store=tx.objectStore('deviceIdentities');let value,failure;
        store.get(ownerUid).onsuccess=e=>{
          try{
            context();const row=e.target.result;
            if(row){
              if(row.ownerUid!==ownerUid||!valid(row.deviceId))throw Error('SPARK_RECOVERY_DEVICE_IDENTITY_INVALID');
              value=row.deviceId;
            }else{
              value=valid(preferredDeviceId)?preferredDeviceId:`device_${root.crypto.randomUUID()}`;
              store.add({ownerUid,deviceId:value});
            }
          }catch(error){failure=error;tx.abort();}
        };
        tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(failure||tx.error||Error('SPARK_RECOVERY_DEVICE_IDENTITY_FAILED'));
      });
      context();
      // Independent read after the transaction commits, not an in-memory ID.
      const stored=await new Promise((resolve,reject)=>{
        const tx=db.transaction('deviceIdentities','readonly');let row;
        tx.objectStore('deviceIdentities').get(ownerUid).onsuccess=e=>row=e.target.result;
        tx.oncomplete=()=>resolve(row);tx.onabort=()=>reject(tx.error||Error('SPARK_RECOVERY_DEVICE_IDENTITY_FAILED'));
      });
      context();if(stored?.ownerUid!==ownerUid||stored.deviceId!==deviceId)throw Error('SPARK_RECOVERY_DEVICE_IDENTITY_INVALID');
      return {ownerUid,deviceId,durable:true};
    }
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
      if(api.byteLength(candidate.snapshot)>8*1024*1024)throw Error('SPARK_RECOVERY_DEVICE_CAPACITY_EXCEEDED');
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
    async function readCapture(captureHash){
      context();const row=await new Promise((resolve,reject)=>{
        const tx=db.transaction('captures','readonly');let result;
        tx.objectStore('captures').get(key(captureHash)).onsuccess=e=>result=e.target.result;
        tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error||Error('SPARK_RECOVERY_CAPTURE_READ_FAILED'));
      });
      context();if(!row)return null;
      if(row.ownerUid!==ownerUid||row.captureHash!==captureHash||await api.hash(row.capture)!==captureHash)
        throw Error('SPARK_RECOVERY_CAPTURE_INTEGRITY_FAILURE');
      return {captureHash,capture:structuredClone(row.capture),durable:true};
    }
    async function captureDevice({record,journalCapture,deviceId,buildSha,remoteReference=null}){
      context();
      const identity=record?.identity||record?.snapshot?.identity;
      if((identity?.ownerUid||identity?.ownerId)!==ownerUid||!record.snapshot
        ||typeof record.deviceRevision!=='string'||!record.deviceRevision
        ||journalCapture?.ownerUid!==ownerUid||journalCapture.enumerationComplete!==true
        ||!Array.isArray(journalCapture.rows)||journalCapture.rows.length!==journalCapture.recordCount
        ||!deviceId||typeof buildSha!=='string'||!/^[a-f0-9]{12,40}$/.test(buildSha))
        throw Error('SPARK_RECOVERY_COMPLETE_CAPTURE_REQUIRED');
      if(api.byteLength(record.snapshot)>8*1024*1024)throw Error('SPARK_RECOVERY_DEVICE_CAPACITY_EXCEEDED');
      const capture=structuredClone({ownerUid,schemaVersion:2,deviceId,buildSha,record,journalCapture,remoteReference});
      const captureHash=await api.hash(capture),row={key:key(captureHash),ownerUid,captureHash,capture};
      await new Promise((resolve,reject)=>{
        const tx=db.transaction('captures','readwrite'),store=tx.objectStore('captures');let failure;
        store.get(row.key).onsuccess=e=>{
          try{context();const previous=e.target.result;
            if(previous&&api.canonicalJson(previous)!==api.canonicalJson(row))throw Error('SPARK_RECOVERY_CAPTURE_CONFLICT');
            if(!previous)store.add(row);
          }catch(error){failure=error;tx.abort();}
        };
        tx.oncomplete=resolve;tx.onabort=()=>reject(failure||tx.error||Error('SPARK_RECOVERY_CAPTURE_WRITE_FAILED'));
      });
      return readCapture(captureHash);
    }
    async function preserveCloud({captureHash,db:cloud,firebase,projectId,assertStable,productionRecoveryOnly=false}){
      context();
      if((!['demo-click360-spark-modular','click360-staging-7620168025'].includes(projectId)
          &&!(projectId==='click-360'&&productionRecoveryOnly===true))
        ||cloud?.app?.options?.projectId!==projectId||typeof assertStable!=='function')
        throw Error('SPARK_RECOVERY_COPY_NONPRODUCTION_ONLY');
      const saved=await readCapture(captureHash);
      if(saved?.durable!==true)throw Error('SPARK_RECOVERY_CAPTURE_REQUIRED');
      const capture=saved.capture,text=api.canonicalJson(capture),parts=[];
      if(capture.remoteReference?.source!=='server'||!Number.isSafeInteger(capture.remoteReference.revision)
        ||!/^[a-f0-9]{64}$/.test(capture.remoteReference.hash||''))throw Error('SPARK_RECOVERY_FRESH_REMOTE_REFERENCE_REQUIRED');
      // Bounded recovery envelope, not a product quota or legacy-doc limit.
      if(api.byteLength(capture)>16*1024*1024)throw Error('SPARK_RECOVERY_CAPTURE_TRANSPORT_CAPACITY');
      // 48k UTF-16 characters are at most 192k UTF-8 bytes. No snapshot or
      // journal command is ever placed in one oversized Firestore document.
      for(let offset=0;offset<text.length;){
        // Never split a surrogate pair: hashing each part must reconstruct
        // exactly the same Unicode input, including emoji in product notes.
        let end=Math.min(offset+48000,text.length);
        if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;
        const content=text.slice(offset,end),position=parts.length;
        parts.push({ownerUid,captureHash,schemaVersion:2,position,content,contentHash:await api.hash(content)});
        offset=end;
      }
      if(!parts.length||parts.length>1024)throw Error('SPARK_RECOVERY_CAPTURE_TRANSPORT_CAPACITY');
      const path=`businesses/${ownerUid}/recoveryCopies/${captureHash}`,ref=cloud.doc(path);
      const core={ownerUid,captureHash,schemaVersion:2,sourceHash:await api.hash(capture.record.snapshot),
        journalHash:await api.hash(capture.journalCapture),deviceRevision:capture.record.deviceRevision,
        deviceId:capture.deviceId,buildSha:capture.buildSha,payloadBytes:api.byteLength(capture),partCount:parts.length,
        remoteRevision:capture.remoteReference.revision,remoteHash:capture.remoteReference.hash};
      const stamp=()=>firebase.firestore.FieldValue.serverTimestamp();
      const sameManifest=value=>Object.entries(core).every(([k,v])=>value?.[k]===v);
      await assertStable();context();
      await cloud.runTransaction(async tx=>{
        context();const s=await tx.get(ref);context();
        if(s.exists){if(!sameManifest(s.data())||!['UPLOADING','CLIENT_VERIFIED'].includes(s.data().state))
          throw Error('SPARK_RECOVERY_REMOTE_MANIFEST_CONFLICT');}
        else tx.set(ref,{...core,state:'UPLOADING',createdAt:stamp()});
      });
      // Fixed small batches; all existing records are read before any write.
      // A lost reply resumes the same deterministic IDs, never commercial ops.
      for(let offset=0;offset<parts.length;offset+=5){
        await assertStable();context();
        const batch=parts.slice(offset,offset+5);
        await cloud.runTransaction(async tx=>{
          const m=await tx.get(ref);if(!sameManifest(m.data()))throw Error('SPARK_RECOVERY_REMOTE_MANIFEST_CONFLICT');
          const old=[];for(const p of batch)old.push(await tx.get(cloud.doc(`${path}/parts/p${p.position}`)));
          context();
          for(let i=0;i<batch.length;i++){
            if(old[i].exists){if(api.canonicalJson(old[i].data())!==api.canonicalJson(batch[i]))throw Error('SPARK_RECOVERY_REMOTE_PART_CONFLICT');}
            else tx.set(cloud.doc(`${path}/parts/p${batch[i].position}`),batch[i]);
          }
        });
      }
      let after=null;const remote=[];
      do{
        context();let q=cloud.collection(`${path}/parts`).orderBy('position').limit(100);if(after!==null)q=q.startAfter(after);
        const page=await q.get({source:'server'});context();
        if(page.metadata?.fromCache!==false||page.metadata?.hasPendingWrites!==false)throw Error('SPARK_RECOVERY_SERVER_READ_REQUIRED');
        for(const d of page.docs){
          const p=d.data(),position=remote.length;
          if(d.id!==`p${position}`||p.position!==position||!parts[position]
            ||api.canonicalJson(p)!==api.canonicalJson(parts[position])||await api.hash(p.content)!==p.contentHash)
            throw Error('SPARK_RECOVERY_REMOTE_RECONSTRUCTION_MISMATCH');
          remote.push(p);
        }
        after=page.docs.length===100?remote.at(-1).position:null;
      }while(after!==null);
      const reconstructed=remote.map(p=>p.content).join('');
      if(remote.length!==core.partCount||reconstructed!==text||await api.hash(JSON.parse(reconstructed))!==captureHash)
        throw Error('SPARK_RECOVERY_REMOTE_RECONSTRUCTION_MISMATCH');
      await assertStable();context();
      const legacy=await cloud.doc(`businesses/${ownerUid}/state/main`).get({source:'server'});context();
      if(legacy.metadata?.fromCache!==false||legacy.metadata?.hasPendingWrites!==false
        ||legacy.data()?.revision!==core.remoteRevision||await api.hash(legacy.data()?.payload?.data)!==core.remoteHash)
        throw Error('SPARK_RECOVERY_REMOTE_DRIFT_STOP');
      await cloud.runTransaction(async tx=>{
        const s=await tx.get(ref);context();
        if(!sameManifest(s.data()))throw Error('SPARK_RECOVERY_REMOTE_MANIFEST_CONFLICT');
        if(s.data().state!=='CLIENT_VERIFIED')tx.update(ref,{state:'CLIENT_VERIFIED',clientVerifiedAt:stamp()});
      });
      const final=await ref.get({source:'server'});context();
      if(final.metadata?.fromCache!==false||final.metadata?.hasPendingWrites!==false
        ||!sameManifest(final.data())||final.data().state!=='CLIENT_VERIFIED')throw Error('SPARK_RECOVERY_SERVER_READ_REQUIRED');
      return {status:'RECOVERY_COPY_CLIENT_VERIFIED',captureHash,sourceHash:core.sourceHash,journalHash:core.journalHash,
        partCount:parts.length,payloadBytes:core.payloadBytes,operationalCloudConfirmed:false,cutoverPerformed:false};
    }
    return Object.freeze({pin,read,deviceIdentity,captureDevice,readCapture,preserveCloud,close:()=>db.close()});
  }
  root.CLICK360_SPARK_RECOVERY=Object.freeze({open});
})(typeof window==='undefined'?globalThis:window);

