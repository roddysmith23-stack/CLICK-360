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

    return Object.freeze({
      projectId,
      identity:expected,
      paths:pathMap,
      prepareOperation,
      lookupOperation,
      commitSale,
      closeCashSession
    });
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
    createFirestoreRepository
  });
})(typeof window !== 'undefined' ? window : globalThis);
