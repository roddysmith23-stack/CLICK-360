(function(root){
  'use strict';
  // Explicit transport, not loaded/started by production. Uses only the client
  // Firestore SDK. Recovery must independently read back an IndexedDB pin.
  function create({db,firebase,projectId,ownerUid,buildSha,deviceId,resolveUser,readSource,readGuard,recovery,onProgress=()=>{}}){
    const api=root.CLICK360_SPARK_MIGRATION;
    if(!api||!db?.runTransaction||!db?.collection||!firebase?.firestore?.FieldValue
      ||typeof resolveUser!=='function'||typeof readSource!=='function'||typeof readGuard!=='function'||!recovery?.pin||!recovery?.read)throw Error('SPARK_IMPORTER_INCOMPLETE');
    // Production activation is deliberately unavailable until the UI/Rules
    // operational contract is certified; a staging result cannot enable it.
    if(!['demo-click360-spark-modular','click360-staging-7620168025'].includes(projectId)
      ||db.app?.options?.projectId!==projectId)throw Error('SPARK_IMPORTER_NONPRODUCTION_ONLY');
    if(!/^[a-f0-9]{12,40}$/.test(buildSha)||!deviceId)throw Error('SPARK_IMPORTER_RELEASE_REQUIRED');
    const controlRef=db.doc(`businesses/${ownerUid}/metadata/storage`);
    const legacyRef=db.doc(`businesses/${ownerUid}/state/main`);
    const stamp=()=>firebase.firestore.FieldValue.serverTimestamp();
    function context(){if(resolveUser()?.uid!==ownerUid)throw Error('SPARK_IMPORTER_OWNER_CONTEXT_CHANGED');}
    async function source(){context();const candidate=await readSource();context();return api.selectSource({ownerUid,...candidate});}
    async function assertPinned(manifest){
      await assertGuard(manifest);
      const pinned=await recovery.read(manifest.sourceHash);context();
      if(pinned?.durable!==true||pinned.deviceRevision!==manifest.deviceRevision
        ||await api.hash(pinned.snapshot)!==manifest.sourceHash)throw Error('SPARK_RECOVERY_PIN_NOT_VERIFIED');
      const current=await source();
      if(current.sourceHash!==manifest.sourceHash||current.remoteRevision!==manifest.remoteRevision
        ||(current.deviceRevision||'')!==manifest.deviceRevision)throw Error('SPARK_IMPORT_SOURCE_CHANGED_STOP');
    }
    async function assertGuard(manifest){
      context();const guard=await readGuard();context();
      // Cheap durable metadata guard between chunks, not a full source read or
      // hash per batch. Full server/local hashes are verified at phase changes.
      if(guard?.ownerUid!==ownerUid||guard.deviceRevision!==manifest.deviceRevision
        ||guard.unknownOperations!==0||guard.mutationLockHeld!==true)throw Error('SPARK_IMPORT_DEVICE_GUARD_CHANGED_STOP');
    }
    async function transition(phase,manifest,equality=null){
      await assertPinned(manifest);
      await db.runTransaction(async tx=>{
        context();const snap=await tx.get(controlRef);const c=snap.data();
        if(!snap.exists||c.sourceHash!==manifest.sourceHash||c.deviceRevision!==manifest.deviceRevision
          ||c.remoteRevision!==manifest.remoteRevision||c.buildSha!==buildSha||c.sourceDeviceId!==deviceId)throw Error('SPARK_IMPORT_CONTROL_CONFLICT');
        if(c.phase===phase)return;
        tx.update(controlRef,{phase,recordVersion:c.recordVersion+1,updatedAt:stamp(),
          ...(equality?{semanticEquality:'PASS',reconstructedHash:equality.reconstructedHash}:{})});
      });
      context();onProgress({phase});
    }
    async function begin(manifest,selected){
      await assertPinned(manifest);
      return db.runTransaction(async tx=>{
        context();const existing=await tx.get(controlRef);const legacy=await tx.get(legacyRef);
        if(!legacy.exists||legacy.data().revision!==selected.remoteRevision
          ||await api.hash(legacy.data().payload?.data)!==selected.remoteHash)throw Error('SPARK_IMPORT_REMOTE_DRIFT_STOP');
        if(existing.exists){
          const c=existing.data();
          if(c.sourceHash!==manifest.sourceHash||c.remoteHash!==selected.remoteHash||c.deviceRevision!==manifest.deviceRevision
            ||c.buildSha!==buildSha||c.sourceDeviceId!==deviceId||c.storageMode!=='migrating')throw Error('SPARK_IMPORT_ALREADY_CLAIMED');
          return c.phase;
        }
        tx.set(controlRef,{ownerUid,schemaVersion:2,storageMode:'migrating',phase:'MIGRATION_PREPARING',
          sourceHash:manifest.sourceHash,remoteHash:selected.remoteHash,remoteRevision:selected.remoteRevision,
          deviceRevision:manifest.deviceRevision,sourceDeviceId:deviceId,businessIds:manifest.businessIds,
          recordCount:manifest.recordCount,payloadBytes:manifest.payloadBytes,recordVersion:1,
          semanticEquality:'PENDING',reconstructedHash:'',buildSha,createdAt:stamp(),updatedAt:stamp(),updatedBy:ownerUid});
        return 'MIGRATION_PREPARING';
      });
    }
    async function writeShadow(manifest){
      for(let offset=0;offset<manifest.records.length;offset+=25){
        await assertGuard(manifest);
        const rows=manifest.records.slice(offset,offset+25);
        await db.runTransaction(async tx=>{
          context();const control=await tx.get(controlRef);
          if(control.data()?.phase!=='SHADOW_WRITING'||control.data()?.sourceHash!==manifest.sourceHash)throw Error('SPARK_SHADOW_PHASE_CONFLICT');
          const existing=[];
          for(const row of rows)existing.push(await tx.get(db.doc(row.path)));
          for(let i=0;i<rows.length;i++){
            if(existing[i].exists){
              if(api.canonicalJson(existing[i].data())!==api.canonicalJson(rows[i].content))throw Error('SPARK_SHADOW_EXISTING_RECORD_CONFLICT');
            }else tx.set(db.doc(rows[i].path),rows[i].content);
          }
        });
        context();onProgress({phase:'SHADOW_WRITING',completed:Math.min(offset+25,manifest.recordCount),total:manifest.recordCount});
      }
    }
    async function readShadow(manifest){
      const scopes=new Set(manifest.records.map(row=>row.path.slice(0,row.path.lastIndexOf('/'))));
      // Also query modules empty in the source. Reading expected IDs only can
      // miss stale/orphan records and falsely certify semantic equality.
      for(const businessId of manifest.businessIds){
        for(const moduleName of new Set([...Object.values(api.arrays),'config'])){
          scopes.add(`businesses/${ownerUid}/businessUnits/${businessId}/${moduleName}`);
        }
      }
      scopes.add(`businesses/${ownerUid}/legacyConfig`);
      const rows=[];
      for(const scope of scopes){
        let cursor=null;
        do{
          context();let q=db.collection(scope).orderBy(firebase.firestore.FieldPath.documentId()).limit(100);
          if(cursor)q=q.startAfter(cursor);
          const page=await q.get({source:'server'});context();
          if(page.metadata.fromCache)throw Error('SPARK_SERVER_READ_REQUIRED');
          for(const doc of page.docs)rows.push({path:doc.ref.path,content:doc.data()});
          cursor=page.size===100?page.docs.at(-1).id:null;
        }while(cursor);
      }
      return rows;
    }
    async function prepareShadow(){
      const selected=await source();
      const manifest=await api.plan({ownerUid,snapshot:selected.snapshot,identity:selected.identity,remoteRevision:selected.remoteRevision,deviceRevision:selected.deviceRevision||''});
      await assertGuard(manifest);
      await recovery.pin({sourceHash:manifest.sourceHash,snapshot:selected.snapshot,identity:selected.identity,deviceRevision:manifest.deviceRevision,
        remoteRevision:selected.remoteRevision,pendingOperations:selected.pendingOperations,buildSha});
      await assertPinned(manifest);
      let phase=await begin(manifest,selected);
      if(phase==='MIGRATION_PREPARING'){await transition('SHADOW_WRITING',manifest);phase='SHADOW_WRITING';}
      if(phase==='SHADOW_WRITING'){await writeShadow(manifest);await transition('SHADOW_VERIFYING',manifest);phase='SHADOW_VERIFYING';}
      if(!['SHADOW_VERIFYING','READY_TO_CUTOVER'].includes(phase))throw Error('SPARK_IMPORT_PHASE_UNSUPPORTED');
      const remoteRecords=await readShadow(manifest);
      const equality=await api.compare({manifest,remoteRecords,source:selected.snapshot});
      await assertPinned(manifest);
      if(phase==='SHADOW_VERIFYING')await transition('READY_TO_CUTOVER',manifest,equality);
      // No implicit cutover: operational adapters, role Rules and real PWA
      // must be certified first. This module only prepares verified shadow.
      return {phase:'READY_TO_CUTOVER',manifest,equality,cutoverPerformed:false};
    }
    return Object.freeze({prepareShadow});
  }
  root.CLICK360_SPARK_IMPORTER=Object.freeze({create});
})(typeof window==='undefined'?globalThis:window);
