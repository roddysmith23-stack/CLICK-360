(function(root){
  'use strict';
  // One lifecycle owner for the existing UI. Production enrollment is
  // administrative/default-off; exact-source activation is delegated to the
  // independently approved coordinator, never self-authorized here.
  const projects=new Set(['demo-click360-spark-modular','click360-staging-7620168025','click-360']);
  const authorities=new WeakMap();
  function assertAuthority(token,scope){
    const proof=token&&authorities.get(token);
    if(!proof||!/^[a-f0-9]{12,40}$/.test(proof.buildSha||'')||Object.entries(scope).some(([key,value])=>proof[key]!==value)
      ||proof.buildSha!==root.CLICK360_RELEASE_ASSETS?.['app.js'])throw Error('SPARK_OPERATIONAL_AUTHORITY_REQUIRED');
    proof.assertCurrent();return true;
  }
  async function watchApprovalWake({db,projectId,ownerUid,actorUid,expected,resolveUser,resolveContext,recover,isBusy=()=>false}){
    const initialContext=resolveContext(),stops=[],values=new Map();let closed=false;
    const current=()=>!closed&&actorUid===ownerUid&&resolveUser()?.uid===ownerUid
      &&resolveContext()===initialContext&&initialContext?.authUid===ownerUid
      &&(initialContext.ownerUid||initialContext.ownerId)===ownerUid;
    const close=()=>{closed=true;while(stops.length)stops.pop()();};
    const coverage=value=>Array.isArray(value)&&new Set(value).size===value.length
      &&JSON.stringify([...value].sort())===JSON.stringify([...expected.businessIds].sort());
    if(!projects.has(projectId)||db.app?.options?.projectId!==projectId||!current()
      ||expected?.ownerUid!==ownerUid||!/^[a-f0-9]{64}$/.test(expected.sourceHash||'')
      ||!/^[a-f0-9]{64}$/.test(expected.captureHash||'')||!/^[a-f0-9]{64}$/.test(expected.planHash||'')
      ||!/^[a-f0-9]{12,40}$/.test(expected.buildSha||'')||!Array.isArray(expected.businessIds)||!expected.businessIds.length)
      return {close};
    const refs=[db.doc('storageRollout/sparkV1'),db.doc(`businesses/${ownerUid}/storageApprovals/runtimePreparation`),
      db.doc(`businesses/${ownerUid}/storageApprovals/cutover`)];
    function examine(){
      if(!current()){close();return;}
      const p=values.get(0),r=values.get(1),c=values.get(2);
      if(!values.has(0))return;
      if(p?.enabled!==true||p.operationalAccess!==true||!Array.isArray(p.pilotOwnerUids)||!p.pilotOwnerUids.includes(ownerUid)){close();return;}
      if(p.automaticShadow!==true||p.automaticMigration!==true||p.automaticRuntimePreparation!==true||p.automaticCutover!==true
        ||!r||!c||r.ownerUid!==ownerUid||c.ownerUid!==ownerUid||r.sourceHash!==expected.sourceHash||c.sourceHash!==expected.sourceHash
        ||r.buildSha!==expected.buildSha||c.buildSha!==expected.buildSha||r.captureHash!==expected.captureHash||r.planHash!==expected.planHash
        ||!coverage(r.businessIds)||!coverage(c.businessIds)||isBusy())return;
      // One event-driven wake, never a commercial retry. Closing first avoids
      // duplicate snapshots racing the authoritative coordinator singleflight.
      close();Promise.resolve().then(()=>recover()).catch(()=>{});
    }
    try{
      // Initial authoritative reads close the failed-run/subscription gap.
      // Initial server snapshots subsequently close read/subscription races.
      for(let i=0;i<refs.length;i++){
        const s=await refs[i].get({source:'server'});
        if(!current()){close();return {close};}
        if(s.metadata?.fromCache!==false||s.metadata?.hasPendingWrites!==false){close();return {close};}
        values.set(i,s.exists?s.data():null);
        if(i===0){const p=values.get(0);if(p?.enabled!==true||p.operationalAccess!==true
          ||!Array.isArray(p.pilotOwnerUids)||!p.pilotOwnerUids.includes(ownerUid)){close();return {close};}}
      }
      const p=values.get(0);
      if(p?.enabled!==true||p.operationalAccess!==true||!p.pilotOwnerUids?.includes(ownerUid)){close();return {close};}
      for(let i=0;i<refs.length;i++){
        const stop=refs[i].onSnapshot({includeMetadataChanges:true},s=>{
          if(!current()){close();return;}
          if(s.metadata?.fromCache===false&&s.metadata?.hasPendingWrites===false){values.set(i,s.exists?s.data():null);examine();}
        },close);
        if(closed)stop();else stops.push(stop);
      }
      examine();return {close};
    }catch{close();return {close};}
  }
  function retailAccumulator({businessId,from,to}){
    const money=value=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0
      ||Math.abs(value*100-Math.round(value*100))>0.00001)throw Error('SPARK_REPORT_AMOUNT_UNVERIFIED');return Math.round(value*100);};
    const totals={tickets:0,sold:0,collected:0,pending:0,cancelled:0},counts=new Map(),days=new Map(),unknown=new Set();let protectedHistory=false;
    return {add(module,row){
      if(row.businessId!==businessId||typeof row.date!=='string'||row.date<from||row.date>to)throw Error('SPARK_REPORT_RECORD_SCOPE_INVALID');
      protectedHistory ||=row.storageHistoryReadOnly===true;
      if(module==='sales'){
        if(row.status==='cancelled'){totals.cancelled++;return;}
        totals.tickets++;try{totals.sold+=money(row.total);}catch{unknown.add('soldTotal');}
        if(row.balance===undefined&&row.status==='paid'&&typeof row.total==='number'&&Number.isFinite(row.total)&&row.received===row.total)totals.pending+=0;
        else try{totals.pending+=money(row.balance);}catch{unknown.add('pendingTotal');}
        if(!Array.isArray(row.items)){unknown.add('top');return;}
        for(const line of row.items){if(!Number.isSafeInteger(line.qty)||line.qty<1){unknown.add('top');continue;}
          const name=String(line.name||line.code||line.productId||line.id||'Producto');counts.set(name,(counts.get(name)||0)+line.qty);}
      }else if(module==='movements'&&row.saleId&&['ingreso','sale_cancellation'].includes(row.kind)&&row.status!=='cancelled'){
        if(row.kind==='sale_cancellation'&&row.compensationSign!==-1)throw Error('SPARK_REPORT_COMPENSATION_UNVERIFIED');
        if(row.compensationSign!==undefined&&row.compensationSign!==-1)throw Error('SPARK_REPORT_COMPENSATION_UNVERIFIED');
        let amount;try{amount=money(row.amount)*(row.compensationSign===-1?-1:1);}catch{unknown.add('collectedTotal');return;}
        totals.collected+=amount;days.set(row.date,(days.get(row.date)||0)+amount);
      }
    },finish(){return {tickets:totals.tickets,soldTotal:unknown.has('soldTotal')?null:totals.sold/100,collectedTotal:unknown.has('collectedTotal')?null:totals.collected/100,
      pendingTotal:unknown.has('pendingTotal')?null:totals.pending/100,cancelledCount:totals.cancelled,protectedHistory,
      unknownFields:[...unknown].sort(),financiallyVerified:!protectedHistory&&unknown.size===0,
      top:[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])),
      collectionDays:[...days].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,cents])=>[date,cents/100])};}};
  }
  function create(options){
    const {projectId,db,ownerUid,actorUid,deviceId,resolveUser,resolveContext,resolveBusiness,
      restoreLocal,readLocal,installView,installBusiness,onPhase=()=>{},onProgress=()=>{}}=options;
    if(!projects.has(projectId)||db.app?.options?.projectId!==projectId)throw Error('SPARK_BOOTSTRAP_NONPRODUCTION_ONLY');
    if([restoreLocal,readLocal,installView,installBusiness,resolveContext,resolveBusiness,resolveUser].some(f=>typeof f!=='function'))
      throw Error('SPARK_BOOTSTRAP_CALLBACKS_REQUIRED');
    const api=root.CLICK360_SPARK_MIGRATION,codec=root.CLICK360_SPARK_RECORD_CODEC;
    let closed=false,flight=null,epoch=0,session=null,phase='CHECKING',deferred=false,releaseLease=null,authorityEpoch=0;
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
      if(projectId==='click-360'&&!/^[a-f0-9]{12,40}$/.test(root.CLICK360_RELEASE_ASSETS?.['app.js']||''))
        throw Error('SPARK_OPERATIONAL_AUTHORITY_REQUIRED');
      context();publish('CHECKING');let control=await mode();
      await restoreLocal();context();
      const local=await readLocal();context();
      let productionEnrolled=true;
      if(projectId==='click-360'){
        const p=(await server(db.doc('storageRollout/sparkV1'),'operational_enrollment')).data();
        productionEnrolled=p?.enabled===true&&p.operationalAccess===true&&Array.isArray(p.pilotOwnerUids)&&p.pilotOwnerUids.includes(ownerUid);
        if(!productionEnrolled&&control.storageMode!=='legacy')throw Error('SPARK_BOOTSTRAP_OPERATIONAL_ENROLLMENT_REQUIRED');
      }
      if(productionEnrolled&&actorUid===ownerUid&&['legacy','migrating'].includes(control.storageMode)&&typeof options.prepareMigration==='function'){
        await acquireLease();context();publish('MIGRATION_PREPARING');
        const shadow=await options.prepareMigration({leaseHeld:()=>!!releaseLease&&!closed});context();
        if(shadow?.cutoverPerformed===true){
          control=await mode();context();
          if(control.storageMode!=='modular'||control.sourceHash!==shadow.sourceHash)
            throw Error('SPARK_BOOTSTRAP_ACTIVATION_NOT_CONFIRMED');
        }else if(shadow?.prepared){
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
      let localHandoff=null;
      if(local&&local.source!=='spark_operational_candidate'){
        if(actorUid!==ownerUid||typeof options.verifyLocalHandoff!=='function')
          throw Error('SPARK_BOOTSTRAP_LEGACY_LOCAL_RECONCILIATION_REQUIRED');
        await acquireLease();context();
        localHandoff=await options.verifyLocalHandoff({leaseHeld:()=>!!releaseLease&&!closed});context();
        if(localHandoff?.verified!==true||localHandoff.status!=='LOCAL_HANDOFF_VERIFIED'
          ||localHandoff.sourceHash!==control.sourceHash||typeof localHandoff.assertStable!=='function'
          ||api.canonicalJson(localHandoff.businessIds)!==api.canonicalJson(control.businessIds))
          throw Error('SPARK_BOOTSTRAP_LOCAL_HANDOFF_NOT_VERIFIED');
      }
      // Hold one browser-managed lease for the coordinator's complete life,
      // including UI commits and replay. Another tab cannot install a writer.
      await acquireLease();context();
      const businessId=preferredBusiness||(control.businessIds.includes(resolveBusiness())?resolveBusiness():control.businessIds[0]);
      if(!control.businessIds.includes(businessId))throw Error('SPARK_BOOTSTRAP_BUSINESS_NOT_VERIFIED');
      if(session&&session.identity.businessId!==businessId){await drain();context();}
      const p=await permissions(businessId),configuration=await configs(control,p);context();
      if(localHandoff){
        await localHandoff.assertStable();context();
        const current=await readLocal();context();
        const metadata=current&&Object.fromEntries(Object.entries(current).filter(([key])=>key!=='snapshot'));
        if(!current||current.deviceRevision!==localHandoff.deviceRevision
          ||await api.hash(current.snapshot)!==localHandoff.sourceHash
          ||await api.hash(metadata)!==localHandoff.deviceMetadataHash)
          throw Error('SPARK_BOOTSTRAP_LOCAL_HANDOFF_DEVICE_DRIFT_STOP');
        context();
      }
      await installBusiness({businessId,configuration,...(localHandoff?{verifiedLocalHandoff:localHandoff}:{})});context();
      if(session){session.close();session=null;root.click360SparkOperationalSession=null;}
      // Opaque in-realm authority, issued only after authoritative mode,
      // membership, complete replay/source gates and durable handoff. It is
      // not a server permission: Rules still authorize EVERY financial write.
      let operationalAuthority;
      if(projectId==='click-360'){
        if(!/^[a-f0-9]{12,40}$/.test(root.CLICK360_RELEASE_ASSETS?.['app.js']||''))throw Error('SPARK_OPERATIONAL_AUTHORITY_REQUIRED');
        const current=await mode();context();
        if(current.storageMode!=='modular'||api.canonicalJson(JSON.parse(JSON.stringify(current)))!==api.canonicalJson(JSON.parse(JSON.stringify(control))))
          throw Error('SPARK_BOOTSTRAP_AUTHORITY_CONTROL_DRIFT');
        const token=Object.freeze({}),generation=++authorityEpoch;
        authorities.set(token,{projectId,ownerUid,businessId,actorUid,buildSha:root.CLICK360_RELEASE_ASSETS?.['app.js'],
          assertCurrent:()=>{context();if(!releaseLease||generation!==authorityEpoch||resolveBusiness()!==businessId)
            throw Error('SPARK_OPERATIONAL_AUTHORITY_REVOKED');}});
        operationalAuthority=token;
      }
      session=await root.CLICK360_SPARK_OPERATIONAL_UI.create({projectId,db,ownerUid,businessId,actorUid,deviceId,
        onReadProgress:detail=>{context();onProgress({phase:'VERIFYING_CURRENT_CASH',transaction:detail});},
        ...(projectId==='click-360'?{operationalAuthority}:{syntheticCertification:true}),
        resolveUser,resolveIdentity:()=>root.CLICK360_MODULAR_PERSISTENCE.identity(ownerUid,resolveBusiness()),
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
      const views=await Promise.allSettled(Array.from({length:Math.min(8,modules.length)},async()=>{
        try{
          while(!failed&&nextModule<modules.length){
            context();const [source,module]=modules[nextModule++];let next=null;
            activeModules.add(module);progress();
            do{
              const result=await page(businessId,module,{after:next});context();records[source].push(...result.records);next=result.next;
            }while(module==='products'&&next);
            context();cursors.set(source,{module,businessId,next});
            activeModules.delete(module);completedModules++;if(!failed)progress();
          }
        }catch(error){failed=true;throw error;}
      }));
      const viewFailure=views.find(result=>result.status==='rejected');
      if(viewFailure)throw viewFailure.reason;
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
      async readRetailReport({from,to,maxRecords=12000,includeInvoices=false}){
        context();if(flight||phase!=='READY'||session?.isBusy())throw Error('SPARK_REPORT_COORDINATOR_BUSY');
        if(!/^\d{4}-\d{2}-\d{2}$/.test(from||'')||!/^\d{4}-\d{2}-\d{2}$/.test(to||'')||from>to
          ||!Number.isSafeInteger(maxRecords)||maxRecords<100||maxRecords>12000||typeof includeInvoices!=='boolean')throw Error('SPARK_REPORT_RANGE_INVALID');
        const businessId=resolveBusiness(),token=++epoch;
        const check=()=>{context();if(resolveBusiness()!==businessId||token!==epoch)throw Error('SPARK_REPORT_CONTEXT_CHANGED');};
        const guard=async()=>{
          check();const runtime=await server(db.doc(`businesses/${ownerUid}/businessUnits/${businessId}/storage/v2/metadata/runtime`),'report_runtime');
          const r=await codec.unpack(runtime.data(),{identity:{ownerUid,businessId},moduleName:'metadata',recordId:'runtime'});
          let cash=null;if(r.openCashSessionId){const s=await server(db.doc(`businesses/${ownerUid}/businessUnits/${businessId}/storage/v2/cashSessions/${r.openCashSessionId}`),'report_cash');
            cash=await codec.unpack(s.data(),{identity:{ownerUid,businessId},moduleName:'cashSessions',recordId:r.openCashSessionId});}
          check();return api.hash({runtime:{recordVersion:r.recordVersion,openCashSessionId:r.openCashSessionId,lastOperationId:r.lastOperationId??null},
            cash:cash?{id:cash.id,date:cash.date,status:cash.status,recordVersion:cash.recordVersion,lastOperationId:cash.lastOperationId??null}:null});
        };
        publish('READING_REPORT');
        flight=(async()=>{
          const health=await session.health();check();
          if(health.pendingCount||health.unknownCount||health.projectionPendingCount)throw Error('SPARK_REPORT_PENDING_RECONCILIATION');
          const startGuard=await guard(),acc=retailAccumulator({businessId,from,to}),sales=[],movements=[],invoices=[];
          let readCount=0,pages=0;
          for(const module of ['sales','movements',...(includeInvoices?['supplierInvoices']:[])]){
            let after=null;
            do{
              check();let q=db.collection(`businesses/${ownerUid}/businessUnits/${businessId}/storage/v2/${module}`)
                .where('data.date','>=',from).where('data.date','<=',to).orderBy('data.date','desc').orderBy('__name__','desc').limit(100);
              if(after)q=q.startAfter(...after);
              const page=await server(q,'report_'+module);check();pages++;
              if(readCount+page.docs.length>maxRecords)throw Error('SPARK_REPORT_READ_BUDGET');
              let prior=after;
              for(const document of page.docs){
                const row=await codec.unpack(document.data(),{identity:{ownerUid,businessId},moduleName:module,recordId:document.id});
                if(prior&&(row.date>prior[0]||(row.date===prior[0]&&document.id>=prior[1])))throw Error('SPARK_REPORT_CURSOR_CONFLICT');
                prior=[row.date,document.id];
                check();acc.add(module,row);readCount++;
                if(module==='sales')sales.push(row);
                else if(module==='movements')movements.push(row);
                else invoices.push(row);
              }
              const last=page.docs.at(-1);after=page.docs.length===100?[last.data().data.date,last.id]:null;
              onProgress({phase:'READING_REPORT',pages,readCount});
            }while(after);
          }
          if(await guard()!==startGuard)throw Error('SPARK_REPORT_CONCURRENT_WRITE');
          check();return {source:'server',complete:true,businessId,ownerUid,actorUid,from,to,...acc.finish(),sales,movements,invoices,
            readCount,pages,confirmedAt:new Date().toISOString(),guardHash:startGuard};
        })().finally(()=>{if(token===epoch){flight=null;publish('READY');}});
        return flight;
      },async loadMore(source){
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
  root.CLICK360_SPARK_BOOTSTRAP=Object.freeze({create,retailAccumulator,assertAuthority,watchApprovalWake});
})(typeof window==='undefined'?globalThis:window);
