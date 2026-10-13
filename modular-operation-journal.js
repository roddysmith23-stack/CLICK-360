// DEV repository component. Not loaded by the production application.
// Each operation is durable independently; an uncertain response requires a
// ledger lookup before any retry. No transport or credentials live here.
(function (root) {
  'use strict';
  const canonical = value => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return value.map(canonical);
    if (value && Object.getPrototypeOf(value) === Object.prototype) {
      return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
    }
    // Do not silently hash Date/Timestamp/bytes as {} or drop undefined fields.
    // The adapter must explicitly encode typed values before journaling them.
    throw Error('JOURNAL_PAYLOAD_REQUIRES_EXPLICIT_JSON_TYPES');
  };
  async function digest(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
    return [...new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function key(identity, operationId) {
    for (const value of [identity.ownerUid, identity.businessId, operationId]) {
      if (typeof value !== 'string' || !value || value.length > 120 || /[/:.]/.test(value)) throw Error('INVALID_JOURNAL_IDENTITY');
    }
    return `${identity.ownerUid}:${identity.businessId}:${operationId}`;
  }
  async function open(options = {}) {
    if (!root.indexedDB) throw Error('DURABLE_JOURNAL_UNAVAILABLE');
    const actorUid=options.actorUid??null;
    if(actorUid!==null&&(typeof actorUid!=='string'||!actorUid||actorUid.length>128))throw Error('INVALID_JOURNAL_ACTOR');
    const actorCheck=row=>{if(actorUid&&row&&row.payload?.actorUid!==actorUid)throw Error('OUTBOX_ACTOR_RECONCILIATION_REQUIRED');};
    const indexName=type=>actorUid?`tenantActor${type}`:`tenant${type}`;
    const range=(identity,state)=>root.IDBKeyRange.only(actorUid
      ?[identity.ownerUid,identity.businessId,actorUid,state]:[identity.ownerUid,identity.businessId,state]);
    const replayRange=(identity,state)=>{
      const prefix=actorUid?[identity.ownerUid,identity.businessId,actorUid,state]:[identity.ownerUid,identity.businessId,state];
      return root.IDBKeyRange.bound([...prefix,0],[...prefix,Number.MAX_SAFE_INTEGER]);
    };
    const db = await new Promise((resolve, reject) => {
      const request = root.indexedDB.open(options.databaseName || 'click360-modular-outbox-v1', 5);
      request.onupgradeneeded = () => {
        const store=request.result.objectStoreNames.contains('operations')
          ?request.transaction.objectStore('operations'):request.result.createObjectStore('operations', { keyPath:'key' });
        if(!store.indexNames.contains('tenantState'))store.createIndex('tenantState',['ownerUid','businessId','state']);
        if(!store.indexNames.contains('tenantProjection'))store.createIndex('tenantProjection',['ownerUid','businessId','projectionState']);
        if(!store.indexNames.contains('tenantActorState'))store.createIndex('tenantActorState',['ownerUid','businessId','actorUid','state']);
        if(!store.indexNames.contains('tenantActorProjection'))store.createIndex('tenantActorProjection',['ownerUid','businessId','actorUid','projectionState']);
        if(!store.indexNames.contains('tenantReplay'))store.createIndex('tenantReplay',['ownerUid','businessId','state','createdAt']);
        if(!store.indexNames.contains('tenantActorReplay'))store.createIndex('tenantActorReplay',['ownerUid','businessId','actorUid','state','createdAt']);
        const clocks=request.result.objectStoreNames.contains('enqueueClocks')
          ?request.transaction.objectStore('enqueueClocks'):request.result.createObjectStore('enqueueClocks');
        const maxima=new Map();
        // Old confirmation proves the server commit, not that its local view
        // finished durably. Preserve every request and recover conservatively.
        const cursor=store.openCursor();
        cursor.onsuccess=()=>{
          const row=cursor.result;
          if(!row){for(const [scope,value]of maxima)clocks.put(value,scope);return;}
          const scope=`${row.value.ownerUid}:${row.value.businessId}`;
          maxima.set(scope,Math.max(maxima.get(scope)||0,row.value.createdAt||0));
          row.update({...row.value,actorUid:typeof row.value.payload?.actorUid==='string'?row.value.payload.actorUid:'',
            ...(row.value.state==='confirmed'&&!row.value.projectionState?{projectionState:'pending'}:{})});
          row.continue();
        };
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(Error('JOURNAL_UPGRADE_BLOCKED'));
    });
    db.onversionchange = () => db.close();
    const change = (id, mutate) => new Promise((resolve, reject) => {
      const tx = db.transaction('operations', 'readwrite');
      const store = tx.objectStore('operations');
      let result, failure;
      const request = store.get(id);
      request.onsuccess = () => {
        try { actorCheck(request.result);result = mutate(request.result); if (result) store.put(result); }
        catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure || tx.error || Error('JOURNAL_TRANSACTION_ABORTED'));
      tx.onerror = () => {}; // onabort is the authoritative failure signal.
    });
    const read = id => new Promise((resolve, reject) => {
      const tx = db.transaction('operations', 'readonly');
      const request = tx.objectStore('operations').get(id);
      let row;
      request.onsuccess = () => { row = request.result; };
      tx.oncomplete = () => {try{actorCheck(row);resolve(row);}catch(error){reject(error);}};
      tx.onabort = () => reject(tx.error || Error('JOURNAL_READ_ABORTED'));
    });
    const guardUnattributed=identity=>{
      if(!actorUid)return Promise.resolve();
      // Preserve old issuer-less rows and fail closed. They remain fully
      // visible to the unscoped recovery census; never manufacture zero UNKNOWN.
      return new Promise((resolve,reject)=>{
        const tx=db.transaction('operations','readonly'),store=tx.objectStore('operations');let count=0;
        for(const state of ['queued','unknown','inflight']){
          const request=store.index('tenantActorState').count(root.IDBKeyRange.only([identity.ownerUid,identity.businessId,'',state]));
          request.onsuccess=()=>{count+=request.result;};
        }
        const projection=store.index('tenantActorProjection').count(root.IDBKeyRange.only([identity.ownerUid,identity.businessId,'','pending']));
        projection.onsuccess=()=>{count+=projection.result;};
        tx.oncomplete=()=>count?reject(Error('OUTBOX_UNATTRIBUTED_RECONCILIATION_REQUIRED')):resolve();
        tx.onabort=()=>reject(tx.error||Error('JOURNAL_READ_ABORTED'));
      });
    };
    return Object.freeze({
      close: () => db.close(),
      get: (identity, operationId) => read(key(identity, operationId)),
      async assertOwnerCoverage(ownerUid,businessIds) {
        if(actorUid!==null||!Array.isArray(businessIds)||!businessIds.length)throw Error('UNSCOPED_OWNER_CENSUS_REQUIRED');
        key({ownerUid,businessId:businessIds[0]},'owner-coverage');
        const allowed=new Set(businessIds),prefix=`${ownerUid}:`;
        // Primary-key owner prefix also catches malformed rows missing fields
        // from secondary indices. This readonly census never claims a row.
        return new Promise((resolve,reject)=>{
          const tx=db.transaction('operations','readonly');let failure,count=0;
          const request=tx.objectStore('operations').openCursor(root.IDBKeyRange.bound(prefix,`${ownerUid};`,false,true));
          request.onsuccess=()=>{
            const cursor=request.result;if(!cursor)return;
            try{
              const row=cursor.value;
              if(row.ownerUid!==ownerUid||key(row,row.operationId)!==row.key||!allowed.has(row.businessId)
                ||!['queued','inflight','unknown','confirmed'].includes(row.state))throw Error('OWNER_OUTBOX_BUSINESS_COVERAGE_REQUIRED');
              count++;cursor.continue();
            }catch(error){failure=error;tx.abort();}
          };
          tx.oncomplete=()=>resolve({enumerationComplete:true,recordCount:count});
          tx.onabort=()=>reject(failure||tx.error||Error('JOURNAL_READ_ABORTED'));
        });
      },
      async countProjectionPending(identity) {
        key(identity,'identity-check');
        await guardUnattributed(identity);
        return new Promise((resolve,reject)=>{
          const tx=db.transaction('operations','readonly');
          const request=tx.objectStore('operations').index(indexName('Projection')).count(range(identity,'pending'));
          let count;
          request.onsuccess=()=>{count=request.result;};
          tx.oncomplete=()=>resolve(count);
          tx.onabort=()=>reject(tx.error||Error('JOURNAL_READ_ABORTED'));
        });
      },
      async listProjectionPending(identity,limit=25) {
        key(identity,'identity-check');
        if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('INVALID_REPLAY_LIMIT');
        await guardUnattributed(identity);
        return new Promise((resolve,reject)=>{
          const tx=db.transaction('operations','readonly');
          const request=tx.objectStore('operations').index(indexName('Projection')).getAll(range(identity,'pending'),limit);
          let rows;
          request.onsuccess=()=>{rows=request.result;};
          tx.oncomplete=()=>resolve(rows);
          tx.onabort=()=>reject(tx.error||Error('JOURNAL_READ_ABORTED'));
        });
      },
      async markProjected(identity,operationId,expectedPayloadHash) {
        return change(key(identity,operationId),current=>{
          if(!current||current.state!=='confirmed'||current.payloadHash!==expectedPayloadHash)
            throw Error('JOURNAL_PROJECTION_CONFLICT');
          if(current.projectionState==='complete')return current;
          return {...current,projectionState:'complete',projectedAt:Date.now(),revision:current.revision+1};
        });
      },
      async countPending(identity) {
        key(identity,'identity-check');
        await guardUnattributed(identity);
        return new Promise((resolve,reject)=>{
          const tx=db.transaction('operations','readonly');
          const index=tx.objectStore('operations').index(indexName('State')),counts={};
          for(const state of ['queued','unknown','inflight']){
            const request=index.count(range(identity,state));
            request.onsuccess=()=>{counts[state]=request.result;};
          }
          tx.oncomplete=()=>resolve({pendingCount:counts.queued,unknownCount:counts.unknown+counts.inflight,
            total:counts.queued+counts.unknown+counts.inflight,countIsBounded:false});
          tx.onabort=()=>reject(tx.error||Error('JOURNAL_READ_ABORTED'));
        });
      },
      async listPending(identity, limit=25) {
        key(identity,'identity-check');
        if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('INVALID_REPLAY_LIMIT');
        await guardUnattributed(identity);
        return new Promise((resolve,reject)=>{
          const tx=db.transaction('operations','readonly');
          const index=tx.objectStore('operations').index(indexName('Replay'));
          const rows=[];
          for(const state of ['queued','unknown','inflight']){
            const request=index.getAll(replayRange(identity,state),limit);
            request.onsuccess=()=>rows.push(...request.result);
          }
          tx.oncomplete=()=>resolve(rows.sort((a,b)=>a.createdAt-b.createdAt||a.key.localeCompare(b.key)).slice(0,limit));
          tx.onabort=()=>reject(tx.error||Error('JOURNAL_READ_ABORTED'));
        });
      },
      async listPendingPage(identity, {limit=100, after=null}={}) {
        key(identity,'identity-check');
        await guardUnattributed(identity);
        const states=['queued','unknown','inflight'];
        if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('INVALID_REPLAY_LIMIT');
        if(after && (after.ownerUid!==identity.ownerUid || after.businessId!==identity.businessId
          || (after.actorUid??null)!==actorUid
          || !states.includes(after.state) || typeof after.key!=='string'
          || !after.key.startsWith(`${identity.ownerUid}:${identity.businessId}:`)))throw Error('INVALID_OUTBOX_CURSOR');
        // Keyset pagination over the scoped state index. No offset or full-store
        // scan; the extra row proves whether enumeration is complete.
        return new Promise((resolve,reject)=>{
          const tx=db.transaction('operations','readonly'),index=tx.objectStore('operations').index(indexName('State'));
          const found=[];let stateIndex=after?states.indexOf(after.state):0;
          const scan=()=>{
            if(stateIndex>=states.length)return;
            const state=states[stateIndex];
            const request=index.openCursor(range(identity,state));
            request.onsuccess=()=>{
              const cursor=request.result;
              if(!cursor){stateIndex++;scan();return;}
              if(after && state===after.state && cursor.primaryKey<=after.key){
                if(cursor.primaryKey===after.key)cursor.continue();
                else cursor.continuePrimaryKey(cursor.key,after.key);
                return;
              }
              found.push(cursor.value);
              if(found.length<=limit)cursor.continue();
            };
          };
          scan();
          tx.oncomplete=()=>{
            const rows=found.slice(0,limit),last=rows.at(-1),hasMore=found.length>limit;
            resolve({rows,complete:!hasMore,next:hasMore?{ownerUid:identity.ownerUid,businessId:identity.businessId,
              state:last.state,key:last.key,...(actorUid?{actorUid}:{})}:null});
          };
          tx.onabort=()=>reject(tx.error||Error('JOURNAL_READ_ABORTED'));
        });
      },
      async enqueue(identity, operationId, payload) {
        const id = key(identity, operationId);
        // Clone before hashing: callers cannot mutate the queued request later.
        const candidate = structuredClone(payload);
        actorCheck({payload:candidate});
        const payloadHash = await digest(candidate);
        return new Promise((resolve,reject)=>{
          const tx=db.transaction(['operations','enqueueClocks'],'readwrite'),store=tx.objectStore('operations'),clocks=tx.objectStore('enqueueClocks');
          let result,failure;
          const fail=error=>{failure=error;tx.abort();};
          store.get(id).onsuccess=e=>{
            const current=e.target.result;
            try{actorCheck(current);
              if(current){if(current.payloadHash!==payloadHash)throw Error('OPERATION_ID_PAYLOAD_CONFLICT');result=current;return;}
              const scope=`${identity.ownerUid}:${identity.businessId}`;
              clocks.get(scope).onsuccess=clock=>{
                // Transactional monotonic ordering survives equal timestamps,
                // clock rollback, restart and concurrent enqueue. IDs are not
                // chronology; taking the first ID-sorted page loses causality.
                const createdAt=Math.max(Date.now(),(clock.target.result||0)+1);
                result={key:id,ownerUid:identity.ownerUid,businessId:identity.businessId,
                  actorUid:typeof candidate.actorUid==='string'?candidate.actorUid:'',operationId,payload:candidate,payloadHash,
                  schemaVersion:1,state:'queued',revision:1,attempts:0,createdAt};
                clocks.put(createdAt,scope);store.put(result);
              };
            }catch(error){fail(error);}
          };
          tx.oncomplete=()=>resolve(result);
          tx.onabort=()=>reject(failure||tx.error||Error('JOURNAL_TRANSACTION_ABORTED'));
          tx.onerror=()=>{};
        });
      },
      async claim(identity, operationId, deviceId, now = Date.now()) {
        if (!deviceId) throw Error('DEVICE_ID_REQUIRED');
        return change(key(identity, operationId), current => {
          if (!current) throw Error('OPERATION_NOT_FOUND');
          if (current.state === 'inflight' && current.leaseUntil <= now) {
            // A crashed writer may already have committed remotely.
            return { ...current, state: 'unknown', revision: current.revision + 1 };
          }
          if (current.state !== 'queued') throw Error('OPERATION_REQUIRES_LEDGER_RECONCILIATION');
          return { ...current, state: 'inflight', claimedBy: deviceId, leaseUntil: now + 60000,
            attempts: current.attempts + 1, revision: current.revision + 1 };
        });
      },
      async markUnknown(identity, operationId, expectedRevision) {
        return change(key(identity, operationId), current => {
          if (!current || current.revision !== expectedRevision || current.state !== 'inflight') throw Error('JOURNAL_REVISION_CONFLICT');
          return { ...current, state: 'unknown', revision: current.revision + 1 };
        });
      },
      async reconcile(identity, operationId, expectedRevision, authoritative) {
        // The adapter must use a fresh SERVER ledger read. Cached/absent-network
        // results are not proof of absence and can never authorize a retry.
        if (authoritative?.source !== 'server') throw Error('SERVER_LEDGER_READ_REQUIRED');
        return change(key(identity, operationId), current => {
          if (!current || current.revision !== expectedRevision) throw Error('JOURNAL_REVISION_CONFLICT');
          if (!['unknown', 'inflight'].includes(current.state)) throw Error('JOURNAL_STATE_CONFLICT');
          if (authoritative.exists) {
            const record = authoritative.record;
            if (!record || record.ownerUid !== identity.ownerUid || record.businessId !== identity.businessId
              || record.operationId !== operationId || record.payloadHash !== current.payloadHash) throw Error('REMOTE_LEDGER_IDENTITY_CONFLICT');
            return { ...current, state: 'confirmed', projectionState:'pending', revision: current.revision + 1, confirmedAt: Date.now() };
          }
          return { ...current, state: 'queued', claimedBy: null, leaseUntil: 0, revision: current.revision + 1 };
        });
      }
    });
  }
  root.CLICK360_MODULAR_JOURNAL = Object.freeze({ open, validatePayload:canonical });
})(typeof window === 'undefined' ? globalThis : window);
