(function(root){
  'use strict';
  // One lifecycle owner for the existing UI. Never enables migration/cutover.
  const projects=new Set(['demo-click360-spark-modular','click360-staging-7620168025']);
  function create(options){
    const {projectId,db,ownerUid,actorUid,deviceId,resolveUser,resolveContext,resolveBusiness,
      restoreLocal,readLocal,installView,installBusiness,onPhase=()=>{},onProgress=()=>{}}=options;
    if(!projects.has(projectId)||db.app?.options?.projectId!==projectId)throw Error('SPARK_BOOTSTRAP_NONPRODUCTION_ONLY');
    if([restoreLocal,readLocal,installView,installBusiness,resolveContext,resolveBusiness,resolveUser].some(f=>typeof f!=='function'))
      throw Error('SPARK_BOOTSTRAP_CALLBACKS_REQUIRED');
    const api=root.CLICK360_SPARK_MIGRATION,codec=root.CLICK360_SPARK_RECORD_CODEC;
    let closed=false,flight=null,epoch=0,session=null,phase='CHECKING',deferred=false,releaseLease=null;
    const cursors=new Map();
    function context(){
      const c=resolveContext();
      if(closed||resolveUser()?.uid!==actorUid||c?.authUid!==actorUid||(c.ownerUid||c.ownerId)!==ownerUid)
        throw Error('SPARK_BOOTSTRAP_CONTEXT_CHANGED');
    }
    function publish(value,reason=null){context();phase=value;onPhase({phase:value,reason,operationalCloudConfirmed:value==='READY'});}
    async function acquireLease(){
      if(releaseLease)return;
      if(!root.navigator.locks?.request)throw Error('SPARK_BOOTSTRAP_DEVICE_LOCK_UNAVAILABLE');
      await new Promise((resolve,reject)=>{
        // Web Locks are already scoped to this browser storage partition.
        // Do not depend on a localStorage device ID: full/disabled LS can
        // generate a different ID in every tab while IndexedDB remains shared.
        root.navigator.locks.request(`click360-spark:${projectId}:${ownerUid}:${actorUid}`,{ifAvailable:true},async lock=>{
          if(!lock){reject(Error('SPARK_BOOTSTRAP_DEVICE_ALREADY_ACTIVE'));return;}
          if(closed){reject(Error('SPARK_BOOTSTRAP_CONTEXT_CHANGED'));return;}
          const held=new Promise(release=>releaseLease=release);
          resolve();await held;
        }).catch(reject);
      });
      context();
    }
    async function server(ref,stage='server_read'){
      context();let snap;
      try{snap=await ref.get({source:'server'});}catch(error){error.sparkStage=stage;throw error;}
      context();
      if(snap.metadata?.fromCache!==false||snap.metadata?.hasPendingWrites!==false)throw Error('SPARK_BOOTSTRAP_SERVER_REQUIRED');
      return snap;
    }
    async function mode(){
      const path=actorUid===ownerUid?`businesses/${ownerUid}/metadata/storage`
        :`businesses/${ownerUid}/businessUnits/${resolveBusiness()}/storage/v2/metadata/storage`;
      const snap=await server(db.doc(path),'storage_mode');
      if(!snap.exists)return {storageMode:'legacy'};
      const raw=snap.data(),c=actorUid===ownerUid?raw:await codec.unpack(raw,
        {identity:{ownerUid,businessId:resolveBusiness()},moduleName:'metadata',recordId:'storage'});
      if(raw.ownerUid!==ownerUid||raw.schemaVersion!==2||!['legacy','migrating','modular','frozen'].includes(c?.storageMode))
        throw Error('SPARK_BOOTSTRAP_CONTROL_INVALID');
      if(actorUid!==ownerUid&&(raw.businessId!==resolveBusiness()||raw.id!=='storage'))throw Error('SPARK_BOOTSTRAP_CONTROL_INVALID');
      if(c.storageMode==='modular'&&(c.phase!=='MODULAR'||c.semanticEquality!=='PASS'
        ||c.sourceHash!==c.reconstructedHash||(actorUid===ownerUid&&(!Array.isArray(c.businessIds)||!c.businessIds.length))))throw Error('SPARK_BOOTSTRAP_CUTOVER_NOT_VERIFIED');
      return {...c,businessIds:actorUid===ownerUid?c.businessIds:[resolveBusiness()]};
    }
    async function permissions(businessId){
      if(actorUid===ownerUid)return null;
      const snap=await server(db.doc(`businesses/${ownerUid}/businessUnits/${businessId}/members/${actorUid}`),'membership'),p=snap.data();
      if(!snap.exists||p.uid!==actorUid||p.ownerUid!==ownerUid||p.businessId!==businessId||p.status!=='active')
        throw Error('SPARK_BOOTSTRAP_MEMBERSHIP_INVALID');
      if(!p.permissions||typeof p.permissions!=='object'||Array.isArray(p.permissions))throw Error('SPARK_BOOTSTRAP_MEMBERSHIP_INVALID');
      // UI permission projection comes from the same scoped server membership
      // enforced by Rules, not stale approvedUsers/cache permissions.
      root.click360User.permissions=structuredClone(p.permissions);
      return p.permissions;
    }
    function readable(module,p){
      if(!p)return true;
      const key=['config','labelTemplates','labelProfiles','reminders'].includes(module)?'settings'
        :['metadata','cashSessions','dailyReports'].includes(module)?'cashSessions':module;
      return p[key]?.read===true||module==='auditEvents';
    }
    async function page(businessId,module,{after=null,limit=100}={}){
      context();
      if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Object.values(api.arrays).includes(module))throw Error('SPARK_BOOTSTRAP_PAGE_INVALID');
      const identity={ownerUid,businessId};
      let q=db.collection(`businesses/${ownerUid}/businessUnits/${businessId}/storage/v2/${module}`).orderBy('__name__').limit(limit);
      if(actorUid!==ownerUid&&module==='auditEvents')q=q.where('createdBy','==',actorUid);
      if(after)q=q.startAfter(after);
      const snap=await server(q,`module_${module}`),records=[];
      for(const document of snap.docs){records.push(await codec.unpack(document.data(),{identity,moduleName:module,recordId:document.id}));context();}
      return {records,next:records.length===limit?snap.docs.at(-1).id:null};
    }
    async function configs(control,p){
      const businesses=[];
      for(const businessId of control.businessIds){
        if(!readable('config',p)){
          // No settings permission means no config read. The assigned path ID
          // is sufficient for selection; do not expose private owner settings.
          businesses.push({id:businessId,name:'Negocio',status:'activo'});continue;
        }
        const s=await server(db.doc(`businesses/${ownerUid}/businessUnits/${businessId}/storage/v2/config/main`),'business_config');
        if(!s.exists)throw Error('SPARK_BOOTSTRAP_BUSINESS_CONFIG_REQUIRED');
        businesses.push(await codec.unpack(s.data(),{identity:{ownerUid,businessId},moduleName:'config',recordId:'main'}));
      }
      const entries=[];
      if(actorUid===ownerUid){
        // Read only configuration consumed by the PWA. Unrelated flattened
        // notification/history leaves must not be reloaded on every startup.
        for(const sourceRoot of ['settings','finance','logistics','legalAcceptances']){
        let after=null;
        do{
          let q=db.collection(`businesses/${ownerUid}/legacyConfig`).where('sourcePath','array-contains',sourceRoot)
            .orderBy('__name__').limit(100);if(after)q=q.startAfter(after);
          const s=await server(q);
          for(const d of s.docs){const r=d.data();
            if(r.ownerUid!==ownerUid||r.businessId!==null||r.schemaVersion!==2||r.module!=='configEntries'
              ||await api.hash(r.data)!==r.dataHash||!Array.isArray(r.sourcePath)
              ||r.sourcePath.some(k=>['__proto__','constructor','prototype'].includes(k)))throw Error('SPARK_BOOTSTRAP_CONFIG_INTEGRITY');
            if(r.sourcePath[0]===sourceRoot)entries.push(r);
          }
          after=s.size===100?s.docs.at(-1).id:null;
        }while(after);
        }
      }
      return {businesses,entries};
    }
    async function drain(){
      for(;;){
        context();const before=await session.health();context();
        const total=before.pendingCount+before.unknownCount+before.projectionPendingCount;
        if(!total)return;
        const result=await session.replay();context();
        if(result.some(r=>r.status!=='CONFIRMED'&&r.reason!=='confirmed_waiting_for_pending_operations'))
          throw Error('SPARK_BOOTSTRAP_RECONCILIATION_REQUIRED');
        const after=await session.health();context();
        const financialBefore=before.pendingCount+before.unknownCount,financialAfter=after.pendingCount+after.unknownCount;
        if(financialAfter>financialBefore||(financialAfter===financialBefore&&after.projectionPendingCount>=before.projectionPendingCount))
          throw Error('SPARK_BOOTSTRAP_REPLAY_NO_PROGRESS');
        // No timer, polling, blind retry or truncated "zero UNKNOWN" claim.
      }
    }
    async function run(preferredBusiness){
      context();publish('CHECKING');const control=await mode();
      await restoreLocal();context();
      const local=await readLocal();context();
      if(actorUid===ownerUid&&['legacy','migrating'].includes(control.storageMode)&&typeof options.prepareMigration==='function'){
        await acquireLease();context();publish('MIGRATION_PREPARING');
        const shadow=await options.prepareMigration({leaseHeld:()=>!!releaseLease&&!closed});context();
        if(shadow?.prepared){
          // Shadow equality is not operational activation. Never fall through
          // to a legacy writer or present a verified backup as sync completion.
          throw Error('SPARK_BOOTSTRAP_SHADOW_VERIFIED_CUTOVER_DISABLED');
        }
      }
      if(control.storageMode==='legacy'){
        if(local?.source==='spark_operational_candidate')throw Error('SPARK_BOOTSTRAP_LEGACY_DOWNGRADE_BLOCKED');
        publish('LEGACY');return {handled:false};
      }
      if(control.storageMode!=='modular')throw Error('SPARK_BOOTSTRAP_MIGRATION_NOT_READY');
      // "Clean" legacy metadata is not proof that the device has no newer
      // records. Require an explicit reconciled handoff, never infer it from
      // pending flags before replacing a pre-modular device snapshot.
      if(local&&local.source!=='spark_operational_candidate')
        throw Error('SPARK_BOOTSTRAP_LEGACY_LOCAL_RECONCILIATION_REQUIRED');
      // Hold one browser-managed lease for the coordinator's complete life,
      // including UI commits and replay. Another tab cannot install a writer.
      await acquireLease();context();
      const businessId=preferredBusiness||(control.businessIds.includes(resolveBusiness())?resolveBusiness():control.businessIds[0]);
      if(!control.businessIds.includes(businessId))throw Error('SPARK_BOOTSTRAP_BUSINESS_NOT_VERIFIED');
      if(session&&session.identity.businessId!==businessId){await drain();context();}
      const p=await permissions(businessId),configuration=await configs(control,p);context();
      await installBusiness({businessId,configuration});context();
      if(session){session.close();session=null;root.click360SparkOperationalSession=null;}
      session=await root.CLICK360_SPARK_OPERATIONAL_UI.create({projectId,db,ownerUid,businessId,actorUid,deviceId,
        syntheticCertification:true,resolveUser,resolveIdentity:()=>root.CLICK360_MODULAR_PERSISTENCE.identity(ownerUid,resolveBusiness()),
        isOnline:()=>root.navigator.onLine,serverTimestamp:()=>root.firebase.firestore.FieldValue.serverTimestamp(),
        persistCandidate:root.click360PersistSparkCandidate,projectConfirmed:root.click360ProjectSparkOperation});
      context();root.click360SparkOperationalSession=session;publish('RECOVERING');await drain();context();
      const records={};cursors.clear();
      publish('LOADING_SERVER_VIEW');
      // Independent bounded views do not need one serialized network round
      // trip per collection. Keep the SAME queries/pages and server proof,
      // and install nothing until all workers complete. Product pagination
      // remains sequential within its own module, never an unbounded fanout.
      const modules=Object.entries(api.arrays).filter(([,module])=>readable(module,p));
      for(const [source]of modules)records[source]=[];
      let nextModule=0,completedModules=0,failed=false;const activeModules=new Set();
      const progress=()=>{context();onProgress({phase:'LOADING_SERVER_VIEW',completedModules,totalModules:modules.length,
        activeModules:[...activeModules]});};
      await Promise.all(Array.from({length:Math.min(3,modules.length)},async()=>{
        try{
          while(!failed&&nextModule<modules.length){
            context();const [source,module]=modules[nextModule++];let next=null;
            activeModules.add(module);progress();
            do{
              const result=await page(businessId,module,{after:next});context();records[source].push(...result.records);next=result.next;
            }while(module==='products'&&next);
            context();cursors.set(source,{module,businessId,next});
            activeModules.delete(module);completedModules++;progress();
          }
        }catch(error){failed=true;throw error;}
      }));
      context();
      if(readable('cashSessions',p)){
        onProgress({phase:'VERIFYING_CURRENT_CASH',completedModules,totalModules:modules.length,activeModules:[]});
        // The active session is not a history page. Read its exact runtime
        // pointer and summary in one server transaction, even beyond row 100.
        const current=await session.currentCash();context();
        if(current.source!=='server'||current.identity?.ownerUid!==ownerUid||current.identity.businessId!==businessId)
          throw Error('SPARK_BOOTSTRAP_CURRENT_CASH_NOT_VERIFIED');
        if(current.session){
          records.cashSessions=(records.cashSessions||[]).filter(row=>row.id!==current.session.id).concat(current.session);
        }
      }
      await installView({source:'server',businessId,configuration,records});context();
      publish('READY');
      root.dispatchEvent?.(new CustomEvent('click360-spark-view-ready',{detail:{businessId,source:'server'}}));
      return {handled:true,businessId};
    }
    function recover(businessId){
      context();if(flight)return flight;
      if(session?.isBusy()){deferred=true;return Promise.resolve({handled:true,deferred:true});}
      const token=++epoch;
      flight=run(businessId).catch(error=>{if(!closed&&token===epoch)publish('BLOCKED',String(error.code||error.message)+(error.sparkStage?`:${error.sparkStage}`:''));throw error;})
        .finally(()=>{if(token===epoch)flight=null;});
      return flight;
    }
    const resume=()=>{
      if(closed||root.click360SparkCoordinator!==controller||root.navigator.onLine===false)return;
      recover().catch(()=>{}); // BLOCKED status is emitted; no retry timer.
    };
    const idle=()=>{if(deferred){deferred=false;resume();}};
    root.addEventListener('online',resume);root.addEventListener('click360-spark-idle',idle);
    const visible=()=>{if(root.document.visibilityState==='visible')resume();};
    root.document.addEventListener('visibilitychange',visible);
    const controller=Object.freeze({recover,isBusy:()=>!!flight,phase:()=>phase,
      close:()=>{closed=true;epoch++;session?.close();session=null;releaseLease?.();releaseLease=null;
        root.removeEventListener('online',resume);root.removeEventListener('click360-spark-idle',idle);root.document.removeEventListener('visibilitychange',visible);},
      async loadMore(source){
        context();if(flight||phase!=='READY'||session?.isBusy())throw Error('SPARK_BOOTSTRAP_RECOVERY_BUSY');
        const cursor=cursors.get(source);if(!cursor?.next)return false;
        // Share the same lifecycle flight with recovery. A page cannot replace
        // a candidate while a financial commit or business switch is active.
        const token=++epoch;publish('LOADING_HISTORY');
        flight=(async()=>{
          const result=await page(cursor.businessId,cursor.module,{after:cursor.next});context();
          await installView({source:'server',businessId:cursor.businessId,records:{[source]:result.records},append:true});
          context();cursor.next=result.next;publish('READY');return !!cursor.next;
        })().catch(error=>{if(!closed&&token===epoch)publish('BLOCKED',String(error.code||error.message));throw error;})
          .finally(()=>{if(token===epoch)flight=null;});
        return flight;
      },hasMore:source=>!!cursors.get(source)?.next});
    return controller;
  }
  root.CLICK360_SPARK_BOOTSTRAP=Object.freeze({create});
})(typeof window==='undefined'?globalThis:window);
