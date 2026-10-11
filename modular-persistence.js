(function initClick360ModularPersistence(root) {
  'use strict';

  const VERSION = '0.1.0';
  const SCHEMA_VERSION = 2;
  const PRODUCTION_PROJECT_ID = 'click-360';
  const LEGACY_WRITE_FENCE = 'REJECT_AFTER_CUTOVER';
  const MODULES = Object.freeze([
    'products',
    'sales',
    'movements',
    'cashSessions',
    'dailyReports',
    'auditEvents',
    'config',
    'metadata',
    'operationLedger',
    'storageTelemetry'
  ]);

  function safeId(value, label = 'id') {
    const normalized = String(value || '').trim();
    if (!normalized || normalized.length > 120 || /[/.]/.test(normalized)) {
      throw new Error(`${label} invalido para persistencia modular.`);
    }
    return normalized;
  }

  function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).sort().reduce((output, key) => {
      if (value[key] !== undefined) output[key] = canonicalize(value[key]);
      return output;
    }, {});
  }

  function canonicalJson(value) {
    return JSON.stringify(canonicalize(value));
  }

  function byteLength(value) {
    return new TextEncoder().encode(typeof value === 'string' ? value : canonicalJson(value)).byteLength;
  }

  async function sha256(value) {
    if (!root.crypto?.subtle) throw new Error('SHA256_UNAVAILABLE');
    const bytes = new TextEncoder().encode(typeof value === 'string' ? value : canonicalJson(value));
    const digest = await root.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function occupancy(bytes, limitBytes = 850000) {
    const usedBytes = Math.max(0, Number(bytes || 0));
    const limit = Math.max(1, Number(limitBytes || 850000));
    const ratio = usedBytes / limit;
    return Object.freeze({
      usedBytes,
      limitBytes: limit,
      remainingBytes: Math.max(0, limit - usedBytes),
      ratio,
      level: ratio >= 0.95 ? 'critical' : ratio >= 0.80 ? 'warning' : 'normal'
    });
  }

  function identity(ownerUid, businessId) {
    const owner = safeId(ownerUid, 'ownerUid');
    const business = safeId(businessId, 'businessId');
    return Object.freeze({
      ownerUid: owner,
      businessId: business,
      tenantKey: `owner:${owner}:business:${business}`,
      storageSchemaVersion: SCHEMA_VERSION
    });
  }

  function paths(ownerUid, businessId) {
    const expected = identity(ownerUid, businessId);
    const rootPath = `businesses/${expected.ownerUid}/businessUnits/${expected.businessId}`;
    return Object.freeze({
      root: rootPath,
      featureFlag: `businesses/${expected.ownerUid}/featureFlags/modularStorage`,
      legacyState: `businesses/${expected.ownerUid}/state/main`,
      collection(moduleName) {
        if (!MODULES.includes(moduleName)) throw new Error(`Modulo no soportado: ${moduleName}`);
        return `${rootPath}/${moduleName}`;
      },
      record(moduleName, recordId) {
        return `${this.collection(moduleName)}/${safeId(recordId, `${moduleName}.id`)}`;
      }
    });
  }

  function assertIdentity(record, expected, label) {
    if (!record
      || record.ownerUid !== expected.ownerUid
      || record.businessId !== expected.businessId
      || record.tenantKey !== expected.tenantKey) {
      throw new Error(`TENANT_IDENTITY_MISMATCH:${label}`);
    }
  }

  function assertProject(projectId, allowProduction) {
    const normalized = String(projectId || '').trim();
    if (!normalized) throw new Error('PROJECT_ID_REQUIRED');
    if (normalized === PRODUCTION_PROJECT_ID && allowProduction !== true) {
      throw new Error('PRODUCTION_MODULAR_WRITES_REQUIRE_SEPARATE_AUTHORIZATION');
    }
    return normalized;
  }

  function recordBase(expected, moduleName, id, actorUid, timestamp) {
    return {
      id,
      ...expected,
      module: moduleName,
      recordVersion: 1,
      createdBy: actorUid,
      updatedBy: actorUid,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  function createFirestoreRepository(options = {}) {
    const db = options.db;
    const firebase = options.firebase;
    const user = options.user;
    const projectId = assertProject(options.projectId, options.allowProduction);
    const actualProject = db?.app?.options?.projectId || db?.projectId;
    if (actualProject && actualProject !== projectId) throw new Error('MODULAR_ADAPTER_PROJECT_MISMATCH');
    const expected = identity(options.ownerUid, options.businessId);
    const pathMap = paths(expected.ownerUid, expected.businessId);
    if (!db?.collection || !db?.runTransaction || !firebase?.firestore?.FieldValue || !user?.uid) {
      throw new Error('MODULAR_REPOSITORY_INCOMPLETE');
    }
    const actorUid = safeId(user.uid, 'actorUid');
    const serverTimestamp = () => firebase.firestore.FieldValue.serverTimestamp();
    const rootRef = db.collection('businesses').doc(expected.ownerUid).collection('businessUnits').doc(expected.businessId);
    const flagRef = db.collection('businesses').doc(expected.ownerUid).collection('featureFlags').doc('modularStorage');
    const ref = (moduleName, id) => rootRef.collection(moduleName).doc(safeId(id, `${moduleName}.id`));

    async function verifyReady(transaction) {
      const flagSnapshot = await transaction.get(flagRef);
      const unitSnapshot = await transaction.get(rootRef);
      const flag = flagSnapshot.exists ? flagSnapshot.data() : null;
      const unit = unitSnapshot.exists ? unitSnapshot.data() : null;
      if (!flag || flag.enabled !== true || flag.writeMode !== 'modular' || Number(flag.schemaVersion) !== SCHEMA_VERSION) {
        throw new Error('MODULAR_FEATURE_FLAG_DISABLED');
      }
      if (!Array.isArray(flag.businessIds) || !flag.businessIds.includes(expected.businessId)) throw new Error('MODULAR_BUSINESS_FLAG_DISABLED');
      assertIdentity(unit, expected, 'businessUnit');
      if (unit.status !== 'CUTOVER_VERIFIED'
        || Number(unit.storageSchemaVersion) !== SCHEMA_VERSION
        || unit.legacyWriteFence !== LEGACY_WRITE_FENCE) {
        throw new Error('MODULAR_CUTOVER_NOT_VERIFIED');
      }
      return { flag, unit };
    }

    async function operationHash(kind, payload) {
      return sha256({ kind, schemaVersion:SCHEMA_VERSION, tenantKey:expected.tenantKey, payload });
    }

    async function prepareSale(input = {}) {
      const operationId = safeId(input.operationId || input.sale?.operationId || input.sale?.id, 'operationId');
      const sale = canonicalize(input.sale || {});
      const movement = canonicalize(input.movement || {});
      const productChanges = [...(input.productChanges || [])]
        .map((change) => ({
          productId:safeId(change.productId, 'productId'),
          quantity:Number(change.quantity),
          expectedStock:Number(change.expectedStock),
          expectedRecordVersion:Number(change.expectedRecordVersion || 1)
        }))
        .sort((left, right) => left.productId.localeCompare(right.productId));
      if (!Number.isFinite(Number(sale.total)) || Number(sale.total) < 0 || !Array.isArray(sale.items)) throw new Error('SALE_PAYLOAD_INVALID');
      if (!Number.isFinite(Number(movement.amount)) || Number(movement.amount) !== Number(sale.total)) throw new Error('SALE_MOVEMENT_MISMATCH');
      if (!productChanges.length || productChanges.some((change) => !Number.isInteger(change.quantity) || change.quantity <= 0)) {
        throw new Error('SALE_STOCK_DELTA_INVALID');
      }
      if (new Set(productChanges.map(change => change.productId)).size !== productChanges.length) throw new Error('DUPLICATE_PRODUCT_DELTA');
      const itemQuantities = new Map();
      for (const item of sale.items) {
        const id = safeId(item.productId, 'sale.item.productId');
        const qty = Number(item.qty);
        if (!Number.isInteger(qty) || qty <= 0) throw new Error('SALE_ITEM_QUANTITY_INVALID');
        itemQuantities.set(id, (itemQuantities.get(id) || 0) + qty);
      }
      if (itemQuantities.size !== productChanges.length || productChanges.some(change => itemQuantities.get(change.productId) !== change.quantity)) throw new Error('SALE_ITEMS_STOCK_MISMATCH');
      const cashSessionId = safeId(sale.cashSessionId || movement.cashSessionId, 'cashSessionId');
      if ((sale.cashSessionId && sale.cashSessionId !== cashSessionId) || movement.cashSessionId !== cashSessionId || sale.date !== movement.date) throw new Error('SALE_SESSION_MISMATCH');
      const payload = { operationId, sale, movement, productChanges };
      const fingerprint = await operationHash('sale', payload);
      const saleId = operationId;
      const movementId = operationId;
      const auditId = `sale-${operationId}`;
      const telemetryId = `sale-${operationId}`;
      return { operationId, sale, movement, productChanges, cashSessionId, payload, fingerprint, saleId, movementId, auditId, telemetryId };
    }

    async function commitSale(input = {}) {
      const { operationId, sale, movement, productChanges, cashSessionId, payload, fingerprint, saleId, movementId, auditId, telemetryId } = await prepareSale(input);
      return db.runTransaction(async (transaction) => {
        await verifyReady(transaction);
        const ledgerRef = ref('operationLedger', operationId);
        const ledgerSnapshot = await transaction.get(ledgerRef);
        if (ledgerSnapshot.exists) {
          const existing = ledgerSnapshot.data();
          assertIdentity(existing, expected, 'operationLedger');
          if (existing.kind !== 'sale' || existing.payloadSha256 !== fingerprint || existing.status !== 'committed') {
            throw new Error('IDEMPOTENCY_KEY_CONFLICT');
          }
          return { ok:true, status:'already_committed', operationId, saleId:existing.saleId, movementId:existing.movementId, payloadSha256:fingerprint };
        }

        const sessionRef = ref('cashSessions', cashSessionId);
        const sessionSnapshot = await transaction.get(sessionRef);
        const session = sessionSnapshot.exists ? sessionSnapshot.data() : null;
        assertIdentity(session, expected, 'cashSessions');
        if (session.status !== 'open' || session.date !== sale.date) throw new Error('SALE_SESSION_NOT_OPEN');
        const productRows = [];
        for (const change of productChanges) {
          const productRef = ref('products', change.productId);
          const snapshot = await transaction.get(productRef);
          if (!snapshot.exists) throw new Error(`PRODUCT_NOT_FOUND:${change.productId}`);
          const product = snapshot.data();
          assertIdentity(product, expected, `products/${change.productId}`);
          const stock = Number(product.stock ?? product.qty ?? 0);
          if (stock !== change.expectedStock || Number(product.recordVersion || 1) !== change.expectedRecordVersion) {
            throw new Error(`PRODUCT_REVISION_CONFLICT:${change.productId}`);
          }
          if (stock < change.quantity) throw new Error(`INSUFFICIENT_STOCK:${change.productId}`);
          productRows.push({ ref:productRef, product, change, nextStock:stock - change.quantity });
        }

        const timestamp = serverTimestamp();
        transaction.update(sessionRef, {
          recordVersion:Number(session.recordVersion || 1) + 1,
          saleCount:Number(session.saleCount || 0) + 1,
          salesTotal:Number(session.salesTotal || 0) + Number(sale.total),
          updatedAt:timestamp, updatedBy:actorUid
        });
        const stockDeltas = Object.fromEntries(productChanges.map((change) => [change.productId, change.quantity]));
        transaction.set(ref('sales', saleId), {
          ...sale,
          cashSessionId,
          ...recordBase(expected, 'sales', saleId, actorUid, timestamp),
          operationId,
          legacyId:sale.id || '',
          actorUid,
          stockDeltas
        });
        transaction.set(ref('movements', movementId), {
          ...movement,
          ...recordBase(expected, 'movements', movementId, actorUid, timestamp),
          operationId,
          saleId,
          actorUid
        });
        productRows.forEach(({ ref:productRef, product, nextStock }) => transaction.update(productRef, {
          stock:nextStock,
          qty:nextStock,
          recordVersion:Number(product.recordVersion || 1) + 1,
          lastOperationId:operationId,
          updatedBy:actorUid,
          updatedAt:timestamp
        }));
        transaction.set(ref('auditEvents', auditId), {
          ...recordBase(expected, 'auditEvents', auditId, actorUid, timestamp),
          actorUid,
          action:'sale_committed',
          operationId,
          saleId,
          movementId
        });
        transaction.set(ledgerRef, {
          ...recordBase(expected, 'operationLedger', operationId, actorUid, timestamp),
          kind:'sale',
          status:'committed',
          payloadSha256:fingerprint,
          saleId,
          movementId
        });
        transaction.set(ref('storageTelemetry', telemetryId), {
          ...recordBase(expected, 'storageTelemetry', telemetryId, actorUid, timestamp),
          kind:'sale',
          operationId,
          payloadBytes:byteLength(payload),
          documentsWritten:productRows.length + 6
        });
        return { ok:true, status:'committed', operationId, saleId, movementId, payloadSha256:fingerprint };
      });
    }

    async function prepareClose(input = {}) {
      const operationId = safeId(input.operationId, 'operationId');
      const cashSessionId = safeId(input.cashSessionId, 'cashSessionId');
      const report = canonicalize(input.report || {});
      const reportId = safeId(report.id || `report-${cashSessionId}`, 'reportId');
      const auditId = `close-${operationId}`;
      const telemetryId = `close-${operationId}`;
      if (!report.date || !Array.isArray(report.saleIds)) throw new Error('CASH_REPORT_INVALID');
      if (Object.hasOwn(report, 'html')) throw new Error('CASH_REPORT_HTML_FORBIDDEN');
      const payload = { operationId, cashSessionId, report:{ ...report, id:reportId } };
      const fingerprint = await operationHash('cash_close', payload);
      return { operationId, cashSessionId, report, reportId, auditId, telemetryId, payload, fingerprint };
    }

    async function closeCashSession(input = {}) {
      const { operationId, cashSessionId, report, reportId, auditId, telemetryId, payload, fingerprint } = await prepareClose(input);
      return db.runTransaction(async (transaction) => {
        await verifyReady(transaction);
        const ledgerRef = ref('operationLedger', operationId);
        const sessionRef = ref('cashSessions', cashSessionId);
        const reportRef = ref('dailyReports', reportId);
        const ledgerSnapshot = await transaction.get(ledgerRef);
        const sessionSnapshot = await transaction.get(sessionRef);
        const reportSnapshot = await transaction.get(reportRef);
        if (!sessionSnapshot.exists) throw new Error('CASH_SESSION_NOT_FOUND');
        const session = sessionSnapshot.data();
        assertIdentity(session, expected, `cashSessions/${cashSessionId}`);
        if (session.date !== report.date) throw new Error('CASH_CLOSE_DATE_MISMATCH');
        if (ledgerSnapshot.exists) {
          const existing = ledgerSnapshot.data();
          assertIdentity(existing, expected, 'operationLedger');
          if (existing.kind !== 'cash_close' || existing.payloadSha256 !== fingerprint || existing.status !== 'committed') {
            throw new Error('IDEMPOTENCY_KEY_CONFLICT');
          }
          if (session.status !== 'closed' || session.reportId !== existing.reportId || !reportSnapshot.exists) {
            throw new Error('CASH_CLOSE_CONFIRMATION_INCOMPLETE');
          }
          assertIdentity(reportSnapshot.data(), expected, 'dailyReports');
          return { ok:true, status:'already_committed', operationId, cashSessionId, reportId:existing.reportId, payloadSha256:fingerprint };
        }
        if (reportSnapshot.exists || session.status === 'closed') {
          if (reportSnapshot.exists && session.status === 'closed' && session.reportId === reportId) {
            const existingReport = reportSnapshot.data() || {};
            assertIdentity(existingReport, expected, `dailyReports/${reportId}`);
            const suppliedReportMatches = Object.entries(report).every(([key, value]) => key === 'id'
              || canonicalJson(existingReport[key]) === canonicalJson(value));
            const operationMatches = !existingReport.operationId || existingReport.operationId === operationId;
            const hashMatches = !existingReport.payloadSha256 || existingReport.payloadSha256 === fingerprint;
            if (!suppliedReportMatches || !operationMatches || !hashMatches || existingReport.cashSessionId !== cashSessionId) {
              throw new Error('CASH_CLOSE_STATE_CONFLICT');
            }
            return { ok:true, status:'confirmed_existing', operationId, cashSessionId, reportId, payloadSha256:fingerprint };
          }
          throw new Error('CASH_CLOSE_STATE_CONFLICT');
        }

        if(session.status!=='open')throw new Error('CASH_SESSION_NOT_OPEN');
        const authoritativeTotal=Number(session.salesTotal||0);
        const authoritativeSaleCount=Number(session.saleCount||0);
        if(!Number.isFinite(authoritativeTotal)||authoritativeTotal<0||!Number.isSafeInteger(authoritativeSaleCount)||authoritativeSaleCount<0)throw new Error('CASH_SESSION_SUMMARY_INVALID');
        if(report.total!==undefined&&Number(report.total)!==authoritativeTotal)throw new Error('CASH_CLOSE_AUTHORITATIVE_TOTAL_MISMATCH');
        const timestamp = serverTimestamp();
        transaction.set(reportRef, {
          ...report,
          total:authoritativeTotal,
          saleCount:authoritativeSaleCount,
          salesReferenceMode:'cash_session_query',
          ...recordBase(expected, 'dailyReports', reportId, actorUid, timestamp),
          operationId,
          cashSessionId,
          actorUid,
          payloadSha256:fingerprint,
          renderVersion:report.renderVersion || 'cash-close-structured-v1',
          status:'closed'
        });
        transaction.update(sessionRef, {
          status:'closed',
          reportId,
          closedBy:actorUid,
          closedAt:timestamp,
          recordVersion:Number(session.recordVersion || 1) + 1,
          updatedBy:actorUid,
          updatedAt:timestamp
        });
        transaction.set(ref('auditEvents', auditId), {
          ...recordBase(expected, 'auditEvents', auditId, actorUid, timestamp),
          actorUid,
          action:'cash_session_closed',
          operationId,
          cashSessionId,
          reportId
        });
        transaction.set(ledgerRef, {
          ...recordBase(expected, 'operationLedger', operationId, actorUid, timestamp),
          kind:'cash_close',
          status:'committed',
          payloadSha256:fingerprint,
          cashSessionId,
          reportId
        });
        transaction.set(ref('storageTelemetry', telemetryId), {
          ...recordBase(expected, 'storageTelemetry', telemetryId, actorUid, timestamp),
          kind:'cash_close',
          operationId,
          payloadBytes:byteLength(payload),
          documentsWritten:5
        });
        return { ok:true, status:'committed', operationId, cashSessionId, reportId, payloadSha256:fingerprint };
      });
    }

    async function prepareOperation(kind, input) {
      const prepared = kind === 'sale' ? await prepareSale(input)
        : kind === 'cash_close' ? await prepareClose(input) : null;
      if (!prepared) throw new Error('MODULAR_OPERATION_KIND_UNSUPPORTED');
      return { operationId:prepared.operationId, payloadSha256:prepared.fingerprint,
        envelope:{ kind, schemaVersion:SCHEMA_VERSION, tenantKey:expected.tenantKey, payload:prepared.payload } };
    }

    async function lookupOperation(operationId, kind, payloadSha256) {
      safeId(operationId, 'operationId');
      return db.runTransaction(async transaction => {
        // Transactions are server-only; offline/cached responses cannot prove absence.
        await verifyReady(transaction);
        const snapshot = await transaction.get(ref('operationLedger', operationId));
        if (!snapshot.exists) return { source:'server', exists:false };
        const record = snapshot.data();
        assertIdentity(record, expected, 'operationLedger');
        if (record.kind !== kind || record.payloadSha256 !== payloadSha256 || record.status !== 'committed') throw new Error('IDEMPOTENCY_KEY_CONFLICT');
        if (kind === 'sale') {
          const sale = await transaction.get(ref('sales', record.saleId));
          const movement = await transaction.get(ref('movements', record.movementId));
          if (!sale.exists || !movement.exists) throw new Error('SALE_CONFIRMATION_INCOMPLETE');
          assertIdentity(sale.data(), expected, 'sales');
          assertIdentity(movement.data(), expected, 'movements');
          if (sale.data().operationId !== operationId || movement.data().operationId !== operationId
            || movement.data().saleId !== record.saleId) throw new Error('SALE_CONFIRMATION_INCOMPLETE');
        } else if (kind === 'cash_close') {
          const session = await transaction.get(ref('cashSessions', record.cashSessionId));
          const report = await transaction.get(ref('dailyReports', record.reportId));
          if (!session.exists || !report.exists) throw new Error('CASH_CLOSE_CONFIRMATION_INCOMPLETE');
          assertIdentity(session.data(), expected, 'cashSessions');
          assertIdentity(report.data(), expected, 'dailyReports');
          if (session.data().status !== 'closed' || session.data().reportId !== record.reportId
            || report.data().cashSessionId !== record.cashSessionId || report.data().operationId !== operationId
            || report.data().payloadSha256 !== payloadSha256) throw new Error('CASH_CLOSE_CONFIRMATION_INCOMPLETE');
        } else throw new Error('MODULAR_OPERATION_KIND_UNSUPPORTED');
        return { source:'server', exists:true, record:{ ownerUid:expected.ownerUid, businessId:expected.businessId,
          operationId, payloadHash:record.payloadSha256 } };
      });
    }

    async function readPage(moduleName,{limit=25,afterId=''}={}) {
      if(!['products','sales','movements','cashSessions','dailyReports','auditEvents'].includes(moduleName))throw new Error('PAGINATION_MODULE_UNSUPPORTED');
      if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('PAGINATION_LIMIT_INVALID');
      if(afterId)safeId(afterId,'cursor');
      await db.runTransaction(transaction=>verifyReady(transaction));
      let query=rootRef.collection(moduleName).orderBy(firebase.firestore.FieldPath?.documentId?.()||'__name__').limit(limit);
      if(afterId)query=query.startAfter(afterId);
      const snapshot=await query.get({source:'server'});
      if(snapshot.metadata?.fromCache||snapshot.metadata?.hasPendingWrites)throw new Error('SERVER_PAGE_NOT_CONFIRMED');
      const records=snapshot.docs.map(document=>{
        const record=document.data();assertIdentity(record,expected,`${moduleName}/${document.id}`);
        if(record.id!==document.id)throw new Error('PAGE_RECORD_IDENTITY_CONFLICT');
        return record;
      });
      return {source:'server',identity:expected,records,nextCursor:records.length===limit?snapshot.docs.at(-1).id:null};
    }

    return Object.freeze({
      projectId,
      identity:expected,
      paths:pathMap,
      prepareOperation,
      lookupOperation,
      commitSale,
      closeCashSession,
      readPage
    });
  }

  // Same repository boundary as the DEV kernel, now using the shared nested
  // record codec/transaction transport. This factory has no migration side
  // effects; the transport requires a verified modular control before writes.
  function createSparkRepository(options={}) {
    const expected=identity(options.ownerUid,options.businessId),transport=options.transport;
    if(!transport?.run||typeof options.serverTimestamp!=='function'||!options.actorUid)throw Error('SPARK_REPOSITORY_INCOMPLETE');
    const kinds=Object.freeze(['sale','cash_open','cash_close','cash_reopen','product_create','product_edit','inventory_adjust','cash_movement']);
    const actorUid=safeId(options.actorUid,'actorUid');
    const number=(value,label)=>{if(typeof value!=='number'||!Number.isFinite(value))throw Error(`${label}_INVALID`);return value;};
    const money=(value,label)=>{const n=number(value,label);if(n<0||Math.abs(n*100-Math.round(n*100))>0.000001)throw Error(`${label}_INVALID`);return Math.round(n*100)/100;};
    const date=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)!==value)throw Error('WORKING_DATE_INVALID');return value;};
    const methods=new Set(['Efectivo','Tarjeta','Transferencia']);
    function scoped(data){if(data?.businessId!==undefined&&data.businessId!==expected.businessId)throw Error('SPARK_PAYLOAD_BUSINESS_CONFLICT');return data;}
    async function prepareOperation(kind,input){
      if(!kinds.includes(kind))throw Error('MODULAR_OPERATION_KIND_UNSUPPORTED');
      const payload=root.CLICK360_MODULAR_JOURNAL.validatePayload(structuredClone(input));
      const operationId=safeId(payload.operationId,'operationId');scoped(payload);scoped(payload.sale);scoped(payload.product);
      const envelope={kind,schemaVersion:2,tenantKey:expected.tenantKey,payload};
      return {operationId,envelope,payloadSha256:await sha256(envelope)};
    }
    function base(moduleName,id,timestamp,data={}){
      return {...data,...recordBase(expected,moduleName,id,actorUid,timestamp)};
    }
    function summary(session){
      if(session.summaryVersion!==1||!session.paymentTotals)throw Error('CASH_SESSION_AUTHORITATIVE_SUMMARY_REQUIRED');
      for(const f of ['saleCount','salesTotal','itemCount','taxTotal','cashBalance','openingAmount','incomeCash','expenseCash'])number(session[f],`SESSION_${f}`);
      for(const f of ['cash','card','transfer','receivablePayments'])money(session.paymentTotals[f],`SESSION_${f}`);
      if(!Number.isSafeInteger(session.saleCount)||session.saleCount<0)throw Error('CASH_SESSION_SUMMARY_INVALID');
      return structuredClone(session.paymentTotals);
    }
    async function commitAttempt(kind,input){
      const prepared=await prepareOperation(kind,input),p=prepared.envelope.payload,op=prepared.operationId;
      return transport.run(async tx=>{
        const ledger=await tx.get('operationLedger',op);
        if(ledger){
          if(ledger.kind!==kind||ledger.payloadHash!==prepared.payloadSha256||ledger.status!=='committed')throw Error('IDEMPOTENCY_KEY_CONFLICT');
          return {ok:true,status:'already_committed',operationId:op,result:ledger.result};
        }
        const rows=[],timestamp=options.serverTimestamp();
        const stage=(moduleName,id,before,data)=>rows.push({moduleName,id,before,data});
        let result={};
        if(kind==='product_create'){
          const id=safeId(p.product?.id,'productId'),old=await tx.get('products',id);
          if(old)throw Error('PRODUCT_ALREADY_EXISTS');
          const stock=number(p.product.stock??p.product.qty??0,'STOCK');if(stock<0)throw Error('STOCK_INVALID');
          if(stock>0){if(await tx.get('movements',op))throw Error('MOVEMENT_ALREADY_EXISTS');
            stage('movements',op,null,{operationId:op,kind:'inventory_opening',productId:id,quantityDelta:stock,amount:0,date:date(p.date),lastOperationId:op});}
          stage('products',id,null,{...p.product,stock,qty:stock,lastOperationId:op});result={productId:id};
        }else if(kind==='product_edit'||kind==='inventory_adjust'){
          const id=safeId(p.productId,'productId'),old=await tx.get('products',id);
          if(!old)throw Error('PRODUCT_NOT_FOUND');
          if(p.expectedRecordVersion!==undefined&&p.expectedRecordVersion!==old.recordVersion)throw Error('PRODUCT_REVISION_CONFLICT');
          const changes=p.changes??(kind==='inventory_adjust'?{}:null);
          if(!changes||Array.isArray(changes)||typeof changes!=='object'
            ||Object.keys(changes).some(k=>!['code','name','category','cost','price','cardPrice','taxMode','notes','imageData'].includes(k)))throw Error('PRODUCT_EDIT_FIELDS_INVALID');
          if(kind==='product_edit'){
            stage('products',id,old,{...old,...changes,lastOperationId:op});
          }else{
            const delta=number(p.quantityDelta,'STOCK_DELTA');if(!delta)throw Error('STOCK_DELTA_INVALID');
            const stock=number(Number(old.stock??old.qty),'STOCK')+delta;if(stock<0)throw Error('INSUFFICIENT_STOCK');
            if(await tx.get('movements',op))throw Error('MOVEMENT_ALREADY_EXISTS');
            stage('products',id,old,{...old,...changes,stock,qty:stock,lastOperationId:op});
            stage('movements',op,null,{operationId:op,kind:'inventory_adjustment',productId:id,quantityDelta:delta,amount:0,date:date(p.date),note:String(p.reason||''),lastOperationId:op});
          }
          result={productId:id};
        }else if(kind==='cash_open'){
          const id=safeId(p.cashSessionId,'cashSessionId'),old=await tx.get('cashSessions',id),movement=await tx.get('movements',op);
          if(old||movement)throw Error('CASH_OPEN_ID_CONFLICT');
          const runtime=await tx.get('metadata','runtime');if(!runtime||runtime.summaryVersion!==1)throw Error('CASH_RUNTIME_NOT_VERIFIED');
          if(runtime.openCashSessionId)throw Error('BUSINESS_ALREADY_HAS_OPEN_CASH_SESSION');
          const opening=money(p.openingAmount,'OPENING_AMOUNT');
          stage('cashSessions',id,null,{status:'open',date:date(p.date),openingAmount:opening,cashBalance:opening,
            summaryVersion:1,saleCount:0,salesTotal:0,itemCount:0,taxTotal:0,incomeCash:0,expenseCash:0,
            paymentTotals:{cash:0,card:0,transfer:0,receivablePayments:0},closeCycle:1,lastOperationId:op});
          stage('movements',op,null,{operationId:op,kind:'apertura',amount:opening,date:p.date,cashSessionId:id,lastOperationId:op});result={cashSessionId:id};
          stage('metadata','runtime',runtime,{...runtime,openCashSessionId:id,lastOperationId:op});
        }else if(kind==='sale'){
          const sale=scoped(p.sale||{}),sessionId=safeId(sale.cashSessionId,'cashSessionId');date(sale.date);
          const session=await tx.get('cashSessions',sessionId);
          if(!session||session.status!=='open'||session.date!==sale.date)throw Error('SALE_SESSION_NOT_OPEN');
          const runtime=await tx.get('metadata','runtime');
          if(runtime?.summaryVersion!==1||runtime.openCashSessionId!==sessionId)throw Error('CASH_RUNTIME_SESSION_CONFLICT');
          const paymentTotals=summary(session),total=money(sale.total,'SALE_TOTAL'),received=money(sale.received??total,'SALE_RECEIVED');
          if(received>total||!Array.isArray(sale.items)||!sale.items.length)throw Error('SALE_PAYLOAD_INVALID');
          const saleStatus=sale.method==='Apartado'?'layaway':sale.method==='Pendiente'?'pending_payment':'paid';
          if((sale.status!==undefined&&sale.status!==saleStatus)||(sale.method==='Pendiente'&&received!==0)
            ||(saleStatus==='paid'&&received!==total))throw Error('SALE_PAYMENT_STATE_CONFLICT');
          if(sale.items.length>12)throw Error('SALE_LINE_BUDGET_EXCEEDED');
          const paymentMethod=received>0?(p.paymentMethod||sale.method):null;
          if(received>0&&!methods.has(paymentMethod))throw Error('SALE_PAYMENT_METHOD_INVALID');
          const products=new Map(),itemOrder=[];let itemCount=0;
          for(const item of sale.items){
            const qty=number(item.qty,'ITEM_QUANTITY');if(!Number.isSafeInteger(qty)||qty<=0)throw Error('SALE_ITEM_QUANTITY_INVALID');itemCount+=qty;
            const itemId=safeId(item.productId||item.id,'productId');
            if(item.id&&item.productId&&item.id!==item.productId)throw Error('SALE_LINE_ID_CONFLICT');
            if(itemOrder.includes(itemId))throw Error('SALE_DUPLICATE_LINE_ID');
            itemOrder.push(itemId);
            if(item.isCustom===true)continue;
            products.set(itemId,qty);
          }
          if(await tx.get('sales',op)||await tx.get('movements',op))throw Error('SALE_RECORD_WITHOUT_LEDGER_CONFLICT');
          let layawayId=null;
          if(sale.method==='Apartado'){
            const layaway=scoped(p.layaway);
            layawayId=safeId(layaway?.id,'layawayId');
            if(money(layaway.total,'LAYAWAY_TOTAL')!==total||money(layaway.paid,'LAYAWAY_PAID')!==received
              ||money(layaway.balance,'LAYAWAY_BALANCE')!==Math.round((total-received)*100)/100)throw Error('LAYAWAY_SALE_CONFLICT');
            if(await tx.get('layaways',layawayId))throw Error('LAYAWAY_ALREADY_EXISTS');
            stage('layaways',layawayId,null,{...layaway,saleId:op,lastOperationId:op});
          }
          const stockRows=[];
          for(const [id,qty]of products){const product=await tx.get('products',id);if(!product)throw Error('PRODUCT_NOT_FOUND');
            const stock=number(Number(product.stock??product.qty),'STOCK');if(stock<qty)throw Error('INSUFFICIENT_STOCK');stockRows.push({id,product,stock:stock-qty});}
          const methodKey={Efectivo:'cash',Tarjeta:'card',Transferencia:'transfer'}[paymentMethod];
          if(methodKey)paymentTotals[methodKey]=Math.round((paymentTotals[methodKey]+received)*100)/100;
          if(sale.method==='Apartado')paymentTotals.receivablePayments=Math.round((paymentTotals.receivablePayments+received)*100)/100;
          const cashReceived=paymentMethod==='Efectivo'?received:0;
          const normalizedItems=sale.items.map((line,index)=>({...line,productId:itemOrder[index],isCustom:line.isCustom===true}));
          stage('cashSessions',sessionId,session,{...session,saleCount:session.saleCount+1,salesTotal:Math.round((session.salesTotal+total)*100)/100,
            itemCount:session.itemCount+itemCount,taxTotal:Math.round((session.taxTotal+money(sale.iva??0,'SALE_TAX'))*100)/100,
            cashBalance:Math.round((session.cashBalance+cashReceived)*100)/100,paymentTotals,lastOperationId:op});
          stage('sales',op,null,{...sale,operationId:op,legacyId:sale.id||'',received,iva:money(sale.iva??0,'SALE_TAX'),itemCount,itemOrder,
            status:saleStatus,balance:Math.round((total-received)*100)/100,
            customOrder:itemOrder.filter((id,index)=>sale.items[index].isCustom===true),
            items:normalizedItems,stockItemIndices:Object.fromEntries(normalizedItems.flatMap((line,index)=>line.isCustom?[]:[[line.productId,index]])),
            customItemIndices:Object.fromEntries(normalizedItems.flatMap((line,index)=>line.isCustom?[[line.productId,index]]:[])),
            ...(layawayId?{layawayId}:{}),lastOperationId:op,stockDeltas:Object.fromEntries(products),stockOrder:stockRows.map(row=>row.id)});
          stage('movements',op,null,{operationId:op,saleId:op,cashSessionId:sessionId,date:sale.date,kind:'ingreso',amount:received,
            paymentMethod:paymentMethod||'Pendiente',paymentType:sale.method==='Apartado'?'receivable_payment':'sale',lastOperationId:op});
          for(const [index,row]of stockRows.entries())stage('products',row.id,row.product,{...row.product,stock:row.stock,qty:row.stock,lastOperationId:op,saleStockIndex:index});
          result={saleId:op,movementId:op,cashSessionId:sessionId,...(layawayId?{layawayId}:{})};
        }else if(kind==='cash_close'){
          const id=safeId(p.cashSessionId,'cashSessionId'),session=await tx.get('cashSessions',id);
          if(!session||session.date!==date(p.date))throw Error('CASH_CLOSE_SESSION_CONFLICT');
          const reportId=safeId(`report-${id}-${session.closeCycle||1}`,'reportId'),report=await tx.get('dailyReports',reportId);
          if(session.status!=='open'||report)throw Error('CASH_CLOSE_STATE_CONFLICT');
          const runtime=await tx.get('metadata','runtime');if(!runtime||runtime.openCashSessionId!==id)throw Error('CASH_RUNTIME_SESSION_CONFLICT');
          const paymentTotals=summary(session),declared=money(p.declaredCash,'DECLARED_CASH');
          stage('dailyReports',reportId,null,{operationId:op,cashSessionId:id,date:session.date,status:'closed',renderVersion:'cash-close-structured-v1',
            openingAmount:session.openingAmount,closeCash:declared,declaredCash:declared,theoreticalCash:session.cashBalance,
            difference:Math.round((declared-session.cashBalance)*100)/100,saleCount:session.saleCount,total:session.salesTotal,
            totalItems:session.itemCount,totalIva:session.taxTotal,incomeCash:session.incomeCash,expenseCash:session.expenseCash,paymentTotals,
            observations:String(p.observations||''),closeCycle:session.closeCycle||1,lastOperationId:op});
          stage('cashSessions',id,session,{...session,status:'closed',reportId,lastOperationId:op,closedAt:timestamp});result={cashSessionId:id,reportId};
          stage('metadata','runtime',runtime,{...runtime,openCashSessionId:'',lastOperationId:op});
        }else if(kind==='cash_reopen'){
          const id=safeId(p.cashSessionId,'cashSessionId'),session=await tx.get('cashSessions',id);
          if(!session||session.status!=='closed'||session.date!==date(p.date)||!session.reportId)throw Error('CASH_REOPEN_SESSION_CONFLICT');summary(session);
          const report=await tx.get('dailyReports',session.reportId),runtime=await tx.get('metadata','runtime');
          if(!report||report.cashSessionId!==id||report.status!=='closed'||!runtime||runtime.openCashSessionId)throw Error('CASH_REOPEN_STATE_CONFLICT');
          if(typeof p.reason!=='string'||!p.reason.trim())throw Error('CASH_REOPEN_REASON_REQUIRED');
          stage('dailyReports',session.reportId,report,{...report,status:'reopened',reopenReason:p.reason,lastOperationId:op});
          stage('cashSessions',id,session,{...session,status:'open',closeCycle:(session.closeCycle||1)+1,lastOperationId:op});
          stage('metadata','runtime',runtime,{...runtime,openCashSessionId:id,lastOperationId:op});result={cashSessionId:id,reportId:session.reportId};
        }else if(kind==='cash_movement'){
          const id=safeId(p.cashSessionId,'cashSessionId'),session=await tx.get('cashSessions',id);
          if(!session||session.status!=='open'||session.date!==date(p.date))throw Error('MOVEMENT_SESSION_NOT_OPEN');summary(session);
          const runtime=await tx.get('metadata','runtime');
          if(runtime?.summaryVersion!==1||runtime.openCashSessionId!==id)throw Error('CASH_RUNTIME_SESSION_CONFLICT');
          if(!['ingreso','egreso','retiro','compra'].includes(p.movementKind))throw Error('MOVEMENT_KIND_INVALID');
          const amount=money(p.amount,'MOVEMENT_AMOUNT');if(await tx.get('movements',op))throw Error('MOVEMENT_ALREADY_EXISTS');
          const income=p.movementKind==='ingreso',delta=income?amount:-amount;
          stage('cashSessions',id,session,{...session,cashBalance:Math.round((session.cashBalance+delta)*100)/100,
            incomeCash:income?Math.round((session.incomeCash+amount)*100)/100:session.incomeCash,
            expenseCash:income?session.expenseCash:Math.round((session.expenseCash+amount)*100)/100,lastOperationId:op});
          stage('movements',op,null,{operationId:op,cashSessionId:id,date:p.date,kind:p.movementKind,amount,note:String(p.note||''),lastOperationId:op});result={movementId:op,cashSessionId:id};
        }
        for(const row of rows){const value=row.before?{...row.data,recordVersion:row.before.recordVersion+1,updatedAt:timestamp,updatedBy:actorUid,
          createdAt:row.before.storageMetadataKeys?.includes('createdAt')?row.before.createdAt:timestamp,
          createdBy:row.before.storageMetadataKeys?.includes('createdBy')?row.before.createdBy:actorUid}
          :base(row.moduleName,row.id,timestamp,row.data);tx[row.before?'update':'create'](row.moduleName,row.id,value);}
        tx.create('operationLedger',op,base('operationLedger',op,timestamp,{operationId:op,kind,status:'committed',payloadHash:prepared.payloadSha256,result}));
        return {ok:true,status:'committed',operationId:op,result};
      });
    }
    async function commitFinancialOperation(kind,input){
      // Rules can reject a stale concurrent commit before the SDK surfaces
      // its read-version conflict. This is not permission to resend blindly:
      // pin the command, query the authoritative ledger, and attempt at most
      // one fresh transaction only when absence is confirmed by the server.
      const candidate=root.CLICK360_MODULAR_JOURNAL.validatePayload(structuredClone(input));
      try{return await commitAttempt(kind,candidate);}
      catch(error){
        if(!['permission-denied','firestore/permission-denied'].includes(error?.code))throw error;
        const prepared=await prepareOperation(kind,candidate);
        const evidence=await lookupOperation(prepared.operationId,kind,prepared.payloadSha256);
        if(evidence.source!=='server')throw Error('SPARK_RECONCILIATION_REQUIRED');
        if(evidence.exists)return {ok:true,status:'already_committed',operationId:prepared.operationId,result:evidence.result};
        // No recursion: persistent denied permissions cannot create a loop.
        return commitAttempt(kind,candidate);
      }
    }
    async function ensureDerivedAudit(operationId,kind,payloadHash){
      safeId(operationId,'operationId');
      return transport.run(async tx=>{
        const ledger=await tx.get('operationLedger',operationId),auditId=safeId(`audit-${operationId}`,'auditId');
        if(!ledger||ledger.status!=='committed'||ledger.kind!==kind||ledger.payloadHash!==payloadHash)throw Error('AUDIT_CONFIRMED_LEDGER_REQUIRED');
        const old=await tx.get('auditEvents',auditId);
        if(old){if(old.operationId!==operationId||old.action!==kind||old.actorUid!==ledger.createdBy||old.payloadHash!==payloadHash)throw Error('AUDIT_LEDGER_CONFLICT');return {status:'already_materialized'};}
        const timestamp=options.serverTimestamp();
        tx.create('auditEvents',auditId,base('auditEvents',auditId,timestamp,{operationId,action:kind,actorUid:ledger.createdBy,payloadHash,lastOperationId:operationId}));
        return {status:'materialized'};
      });
    }
    async function commitOperation(kind,input){
      const candidate=root.CLICK360_MODULAR_JOURNAL.validatePayload(structuredClone(input));
      const prepared=await prepareOperation(kind,candidate);
      const result=await commitFinancialOperation(kind,candidate);
      // Financial truth and immutable actor/hash receipt are already atomic.
      // This derived view cannot change stock/cash or justify a second sale.
      // If its response fails, the stable audit ID can be repaired from ledger.
      try{await ensureDerivedAudit(prepared.operationId,kind,prepared.payloadSha256);return {...result,auditPending:false};}
      catch(error){return {...result,auditPending:true,auditError:String(error.code||error.message||'audit_unavailable')};}
    }
    async function lookupOperation(operationId,kind,payloadHash){
      safeId(operationId,'operationId');
      return transport.run(async tx=>{const record=await tx.get('operationLedger',operationId);
        if(!record)return {source:'server',exists:false};
        if(record.kind!==kind||record.payloadHash!==payloadHash||record.status!=='committed')throw Error('IDEMPOTENCY_KEY_CONFLICT');
        const r=record.result||{};
        for(const [key,moduleName]of [['saleId','sales'],['movementId','movements'],['reportId','dailyReports'],['cashSessionId','cashSessions'],['productId','products'],['layawayId','layaways']]){
          if(!r[key])continue;const linked=await tx.get(moduleName,r[key]);
          if(!linked||(['sales','movements'].includes(moduleName)&&linked.operationId!==operationId)
            ||(moduleName==='dailyReports'&&kind==='cash_close'&&(linked.operationId!==operationId||linked.cashSessionId!==r.cashSessionId)))throw Error('SPARK_OPERATION_CONFIRMATION_INCOMPLETE');
        }
        return {source:'server',exists:true,record:{ownerUid:expected.ownerUid,businessId:expected.businessId,operationId,payloadHash,status:'committed'},result:record.result};});
    }
    async function readOperationProjection(operationId,kind,payloadHash){
      // Read a bounded, consistent view after confirmation. Never reconstruct
      // a tenant or scan historical collections to project one operation.
      return transport.run(async tx=>{
        const ledger=await tx.get('operationLedger',safeId(operationId,'operationId'));
        if(!ledger||ledger.status!=='committed'||ledger.kind!==kind||ledger.payloadHash!==payloadHash)throw Error('SPARK_PROJECTION_LEDGER_CONFLICT');
        const records={},r=ledger.result||{};
        for(const [key,moduleName]of [['saleId','sales'],['movementId','movements'],['reportId','dailyReports'],['cashSessionId','cashSessions'],['productId','products'],['layawayId','layaways']]){
          if(!r[key])continue;
          const value=await tx.get(moduleName,r[key]);
          if(!value)throw Error('SPARK_PROJECTION_RECORD_MISSING');
          (records[moduleName]??=[]).push(value);
        }
        for(const productId of records.sales?.[0]?.stockOrder||[]){
          const value=await tx.get('products',productId);
          if(!value)throw Error('SPARK_PROJECTION_RECORD_MISSING');
          (records.products??=[]).push(value);
        }
        return {source:'server',operationId,identity:{...expected},records};
      });
    }
    return Object.freeze({identity:expected,supportedKinds:kinds,prepareOperation,commitOperation,lookupOperation,ensureDerivedAudit,readOperationProjection,
      readPage:(moduleName,options)=>transport.readPage(moduleName,options),
      commitSale:input=>commitOperation('sale',input),closeCashSession:input=>commitOperation('cash_close',input)});
  }

  root.CLICK360_MODULAR_PERSISTENCE = Object.freeze({
    VERSION,
    SCHEMA_VERSION,
    PRODUCTION_PROJECT_ID,
    LEGACY_WRITE_FENCE,
    MODULES,
    safeId,
    canonicalJson,
    byteLength,
    sha256,
    occupancy,
    identity,
    paths,
    createFirestoreRepository,
    createSparkRepository
  });
})(typeof window !== 'undefined' ? window : globalThis);
