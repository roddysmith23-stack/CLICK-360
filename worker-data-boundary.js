(function initClick360WorkerDataBoundary(root) {
  'use strict';

  const VERSION = '1.0.0';
  const SCHEMA_VERSION = 1;
  const PRODUCTION_PROJECT_ID = 'click-360';
  const DEFAULT_BASE_SEAT_CAP = 2;
  const MODULES = Object.freeze([
    'members',
    'products',
    'sales',
    'layaways',
    'cashSessions',
    'movements',
    'auditEvents',
    'settings'
  ]);
  const CUTOVER_STATUSES = Object.freeze({
    PREPARED: 'PREPARED',
    VERIFIED: 'VERIFIED',
    CUTOVER_VERIFIED: 'CUTOVER_VERIFIED',
    ROLLBACK_ONLY: 'ROLLBACK_ONLY'
  });
  const ROLE_ALIASES = Object.freeze({
    owner: 'owner',
    admin: 'admin',
    supervisor: 'supervisor',
    worker: 'seller',
    seller: 'seller',
    vendedor: 'seller',
    cashier: 'cashier',
    cajero: 'cashier',
    inventory: 'inventory',
    inventario: 'inventory'
  });
  const ROLE_PERMISSIONS = Object.freeze({
    owner: '*',
    admin: '*',
    supervisor: {
      members: ['read'], products: ['read', 'create', 'update'], sales: ['read', 'create', 'update'],
      layaways: ['read', 'create', 'update', 'payment'], cashSessions: ['read', 'create', 'update', 'close'],
      movements: ['read', 'create'], auditEvents: ['read', 'create'], settings: ['read']
    },
    seller: {
      products: ['read'], sales: ['read', 'create'], layaways: ['read', 'create', 'payment'],
      cashSessions: ['read'], movements: ['read'], auditEvents: ['create'], settings: ['read']
    },
    cashier: {
      products: ['read'], sales: ['read', 'create'], layaways: ['read', 'create', 'payment'],
      cashSessions: ['read', 'create', 'update', 'close'], movements: ['read', 'create'],
      auditEvents: ['create'], settings: ['read']
    },
    inventory: {
      products: ['read', 'create', 'update', 'delete'], movements: ['read', 'create'],
      auditEvents: ['create'], settings: ['read']
    }
  });

  function safeId(value, label = 'id') {
    const normalized = String(value || '').trim();
    if (!normalized || normalized.length > 120 || /[/.]/.test(normalized)) {
      throw new Error(`${label} invalido para la frontera modular.`);
    }
    return normalized;
  }

  function normalizedRole(role) {
    return ROLE_ALIASES[String(role || '').trim().toLowerCase()] || '';
  }

  function tenantKey(ownerUid, businessId) {
    return `owner:${safeId(ownerUid, 'ownerUid')}:business:${safeId(businessId, 'businessId')}`;
  }

  function normalizePermissionMap(role, overrides = {}) {
    const normalized = normalizedRole(role);
    if (!normalized) throw new Error('Rol modular no reconocido.');
    const baseline = ROLE_PERMISSIONS[normalized];
    const result = {};
    MODULES.forEach((moduleName) => {
      const allowed = baseline === '*' ? ['read', 'create', 'update', 'delete', 'payment', 'close', 'manage'] : (baseline[moduleName] || []);
      result[moduleName] = {};
      allowed.forEach((action) => {
        result[moduleName][action] = overrides?.[moduleName]?.[action] !== false;
      });
    });
    return result;
  }

  function can(permissionMap, moduleName, action) {
    return MODULES.includes(moduleName) && permissionMap?.[moduleName]?.[action] === true;
  }

  function identity(ownerUid, businessId) {
    return {
      ownerUid: safeId(ownerUid, 'ownerUid'),
      businessId: safeId(businessId, 'businessId'),
      tenantKey: tenantKey(ownerUid, businessId),
      boundarySchemaVersion: SCHEMA_VERSION
    };
  }

  function boundaryRootPath(ownerUid, businessId) {
    return `businesses/${safeId(ownerUid, 'ownerUid')}/businessUnits/${safeId(businessId, 'businessId')}`;
  }

  function seatEntitlementPath(ownerUid, businessId) {
    return `${boundaryRootPath(ownerUid, businessId)}/entitlement/seats`;
  }

  function workersFeatureFlagPath(ownerUid) {
    return `businesses/${safeId(ownerUid, 'ownerUid')}/featureFlags/workers`;
  }

  /**
   * Per-tenant rollout gate for Workers, independent of and in addition to
   * enabledForProject(). Staging/demo projects stay always-enabled (QA is
   * unaffected). In production, a tenant is enabled ONLY by an explicit,
   * admin-managed featureFlags/workers doc with { enabled: true } (see
   * scripts/worker-boundary-admin.mjs) -- clients can never write this doc
   * themselves, and its absence means NOT enabled (default-closed pilot
   * opt-in; production has zero tenants live on Workers before this flag
   * exists, so there is nothing to grandfather). worker-boundary-migrate.mjs
   * always provisions this doc explicitly (enabled:true for staging/demo,
   * enabled:false for production) so no migrated tenant is ever left
   * without one.
   */
  function workersEnabledForTenant(projectId, flagData) {
    if (enabledForProject(projectId)) return true;
    if (String(projectId || '').trim() !== PRODUCTION_PROJECT_ID) return false;
    return flagData?.enabled === true;
  }

  function seatEntitlement(ownerUid, businessId, overrides = {}) {
    return {
      ...identity(ownerUid, businessId),
      baseSeatCap: DEFAULT_BASE_SEAT_CAP,
      addOnSeats: 0,
      activeMembers: 0,
      ...overrides
    };
  }

  function seatCapacity(entitlement) {
    return Number(entitlement?.baseSeatCap ?? DEFAULT_BASE_SEAT_CAP) + Number(entitlement?.addOnSeats ?? 0);
  }

  function hasSeatAvailable(entitlement) {
    return Number(entitlement?.activeMembers ?? 0) < seatCapacity(entitlement);
  }

  /**
   * Plans the entitlement write for activating one worker (invite accepted or
   * member reactivated). Throws SEAT_LIMIT_EXCEEDED if no seat remains; the
   * caller must abort the member activation write in the same transaction.
   * `lastActionUid` must be the uid of the member whose doc is transitioning
   * to active in the SAME write: Firestore rules re-verify that transition
   * server-side, so a counter change can never be submitted on its own.
   */
  function planSeatConsumption(entitlement, expected, lastActionUid) {
    if (!entitlement) throw new Error('SEAT_ENTITLEMENT_ABSENT: el negocio modular no tiene cupos configurados.');
    for (const key of ['ownerUid', 'businessId', 'tenantKey', 'boundarySchemaVersion']) {
      if (entitlement[key] !== expected[key]) throw new Error(`SEAT_ENTITLEMENT_IDENTITY_MISMATCH: ${key}`);
    }
    if (!hasSeatAvailable(entitlement)) {
      throw new Error(`SEAT_LIMIT_EXCEEDED: ${entitlement.activeMembers}/${seatCapacity(entitlement)} cupos en uso.`);
    }
    return { activeMembers: Number(entitlement.activeMembers || 0) + 1, lastActionUid: safeId(lastActionUid, 'lastActionUid') };
  }

  /**
   * Plans the entitlement write for deactivating (revoking) one worker.
   * `lastActionUid` must be the uid of the member whose doc is transitioning
   * to revoked in the SAME write (see planSeatConsumption).
   */
  function planSeatRelease(entitlement, expected, lastActionUid) {
    if (!entitlement) throw new Error('SEAT_ENTITLEMENT_ABSENT: el negocio modular no tiene cupos configurados.');
    for (const key of ['ownerUid', 'businessId', 'tenantKey', 'boundarySchemaVersion']) {
      if (entitlement[key] !== expected[key]) throw new Error(`SEAT_ENTITLEMENT_IDENTITY_MISMATCH: ${key}`);
    }
    return { activeMembers: Math.max(0, Number(entitlement.activeMembers || 0) - 1), lastActionUid: safeId(lastActionUid, 'lastActionUid') };
  }

  function collectionPath(ownerUid, businessId, moduleName) {
    if (!MODULES.includes(moduleName)) throw new Error('Modulo fuera de la frontera autorizada.');
    return `${boundaryRootPath(ownerUid, businessId)}/${moduleName}`;
  }

  function recordPath(ownerUid, businessId, moduleName, recordId) {
    return `${collectionPath(ownerUid, businessId, moduleName)}/${safeId(recordId, 'recordId')}`;
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

  function recordsForBusiness(records, businessId, fallbackBusinessId = '') {
    return (Array.isArray(records) ? records : []).filter((record) => {
      const recordBusinessId = String(record?.businessId || fallbackBusinessId || '');
      return recordBusinessId === businessId;
    });
  }

  function modularRecord(record, ownerUid, businessId, moduleName, index, generatedAt = '') {
    const rawId = record?.id || `${moduleName}-${index + 1}`;
    const recordId = safeId(rawId, `${moduleName}.id`);
    const createdAt = record?.createdAt || record?.when || generatedAt;
    return {
      ...canonicalize(record || {}),
      id: recordId,
      ...identity(ownerUid, businessId),
      module: moduleName,
      recordVersion: Math.max(1, Number(record?.recordVersion || 1)),
      createdBy: String(record?.createdBy || record?.actorUid || ownerUid),
      updatedBy: String(record?.updatedBy || record?.createdBy || record?.actorUid || ownerUid),
      createdAt,
      updatedAt: record?.updatedAt || createdAt
    };
  }

  function settingsRecord(legacy, business, ownerUid, businessId, generatedAt) {
    const settings = legacy?.settings || {};
    const legacyFallback = settings.legacyDataBusinessId || '';
    const filterSettings = (value) => recordsForBusiness(value, businessId, legacyFallback);
    return modularRecord({
      id: 'main',
      business: canonicalize(business),
      customers: filterSettings(settings.customers),
      reminders: filterSettings(settings.reminders),
      labelTemplates: filterSettings(settings.labelTemplates),
      labelProfiles: filterSettings(settings.labelProfiles),
      policies: canonicalize(business?.settings?.policies || settings.policies || {}),
      tax: canonicalize(business?.settings?.tax || {}),
      source: 'legacy_state_main'
    }, ownerUid, businessId, 'settings', 0, generatedAt);
  }

  function totals(collections) {
    const sales = collections.sales || [];
    const layaways = collections.layaways || [];
    const cashSessions = collections.cashSessions || [];
    const movements = collections.movements || [];
    return {
      salesTotal: sales.reduce((sum, item) => sum + Number(item.total || 0), 0),
      salesCollected: sales.reduce((sum, item) => sum + Number(item.received || 0), 0),
      layawayTotal: layaways.reduce((sum, item) => sum + Number(item.total || 0), 0),
      layawayBalance: layaways.reduce((sum, item) => sum + Number(item.balance || 0), 0),
      cashOpening: cashSessions.reduce((sum, item) => sum + Number(item.openingAmount || item.opening || 0), 0),
      movementAmount: movements.reduce((sum, item) => sum + Number(item.amount || 0), 0),
      stock: (collections.products || []).reduce((sum, item) => sum + Number(item.stock || 0), 0)
    };
  }

  function planMigration(legacyState, options = {}) {
    const ownerUid = safeId(options.ownerUid, 'ownerUid');
    const businessId = safeId(options.businessId, 'businessId');
    const generatedAt = String(options.generatedAt || new Date(0).toISOString());
    const businesses = Array.isArray(legacyState?.businesses) ? legacyState.businesses : [];
    const business = businesses.find((item) => item?.id === businessId);
    if (!business) throw new Error('El negocio no existe en el snapshot legacy.');
    const collections = {
      members: (options.members || []).map((item, index) => modularRecord(item, ownerUid, businessId, 'members', index, generatedAt)),
      products: recordsForBusiness(legacyState.products, businessId).map((item, index) => modularRecord(item, ownerUid, businessId, 'products', index, generatedAt)),
      sales: recordsForBusiness(legacyState.sales, businessId).map((item, index) => modularRecord(item, ownerUid, businessId, 'sales', index, generatedAt)),
      layaways: recordsForBusiness(legacyState.layaways, businessId).map((item, index) => modularRecord(item, ownerUid, businessId, 'layaways', index, generatedAt)),
      cashSessions: recordsForBusiness(legacyState.cashSessions, businessId).map((item, index) => modularRecord(item, ownerUid, businessId, 'cashSessions', index, generatedAt)),
      movements: recordsForBusiness(legacyState.movements, businessId).map((item, index) => modularRecord(item, ownerUid, businessId, 'movements', index, generatedAt)),
      auditEvents: recordsForBusiness(legacyState.auditLogs, businessId).map((item, index) => modularRecord(item, ownerUid, businessId, 'auditEvents', index, generatedAt)),
      settings: [settingsRecord(legacyState, business, ownerUid, businessId, generatedAt)]
    };
    const counts = Object.fromEntries(MODULES.map((moduleName) => [moduleName, collections[moduleName].length]));
    const manifest = {
      ...identity(ownerUid, businessId),
      id: businessId,
      status: CUTOVER_STATUSES.PREPARED,
      sourcePath: `businesses/${ownerUid}/state/main`,
      sourceRevision: Number(options.sourceRevision || legacyState?.revision || 0),
      sourceHash: String(options.sourceHash || ''),
      counts,
      totals: totals(collections),
      rollbackPath: `businesses/${ownerUid}/state/main`,
      writePolicy: 'create_only',
      generatedAt
    };
    return { manifest, collections };
  }

  function validateMigrationPlan(plan) {
    const errors = [];
    const warnings = [];
    const manifest = plan?.manifest || {};
    const collections = plan?.collections || {};
    const expectedIdentity = identity(manifest.ownerUid, manifest.businessId);
    MODULES.forEach((moduleName) => {
      const records = Array.isArray(collections[moduleName]) ? collections[moduleName] : [];
      const ids = new Set();
      records.forEach((record) => {
        if (ids.has(record.id)) errors.push(`${moduleName}:duplicate:${record.id}`);
        ids.add(record.id);
        if (record.ownerUid !== expectedIdentity.ownerUid || record.businessId !== expectedIdentity.businessId || record.tenantKey !== expectedIdentity.tenantKey) {
          errors.push(`${moduleName}:identity:${record.id}`);
        }
      });
      if (Number(manifest.counts?.[moduleName]) !== records.length) errors.push(`${moduleName}:count`);
    });
    const products = new Set((collections.products || []).map((item) => item.id));
    (collections.sales || []).forEach((sale) => {
      (Array.isArray(sale.items) ? sale.items : []).forEach((item) => {
        const productId = item.productId || item.id;
        if (productId && !products.has(productId)) warnings.push(`sales:missing-product:${sale.id}:${productId}`);
      });
      const itemTotal = (Array.isArray(sale.items) ? sale.items : []).reduce((sum, item) => sum + Number(item.total ?? Number(item.qty || 0) * Number(item.price || 0)), 0);
      if (sale.items?.length && Math.abs(itemTotal - Number(sale.subtotal ?? itemTotal)) > 0.02) warnings.push(`sales:subtotal:${sale.id}`);
    });
    const recomputedTotals = totals(collections);
    Object.entries(recomputedTotals).forEach(([key, value]) => {
      if (Math.abs(Number(manifest.totals?.[key] || 0) - value) > 0.0001) errors.push(`totals:${key}`);
    });
    return { valid: errors.length === 0, errors, warnings, counts: manifest.counts, totals: recomputedTotals };
  }

  function compareMigrationPlans(before, after) {
    const beforeValidation = validateMigrationPlan(before);
    const afterValidation = validateMigrationPlan(after);
    const mismatches = [];
    MODULES.forEach((moduleName) => {
      const beforeRecords = before?.collections?.[moduleName] || [];
      const afterRecords = after?.collections?.[moduleName] || [];
      if (beforeRecords.length !== afterRecords.length) mismatches.push(`${moduleName}:count`);
      if (canonicalJson(beforeRecords) !== canonicalJson(afterRecords)) mismatches.push(`${moduleName}:content`);
    });
    if (canonicalJson(before?.manifest?.totals) !== canonicalJson(after?.manifest?.totals)) mismatches.push('totals');
    return { equal: beforeValidation.valid && afterValidation.valid && mismatches.length === 0, mismatches, beforeValidation, afterValidation };
  }

  /**
   * Validates that a Firestore source document has a correct canonical identity
   * at payload.identity before the migration is allowed to plan or commit.
   *
   * A document without a valid payload.identity will be accepted by
   * extractLegacyState() but rejected at runtime by p0-tenant-guard's
   * validBusinessPayload(). This guard blocks migration before declaring
   * CUTOVER_VERIFIED from a document the tenant guard would subsequently reject.
   *
   * Only called when loading from Firestore (not from --input fixture).
   * Fails closed: any absence or mismatch throws, blocking the migration.
   *
   * If payload.identity is absent, run worker-boundary-repair-identity.mjs first
   * to materialize it from the document's valid root-level identity fields.
   */
  /**
   * Validates that raw.payload.identity satisfies the complete p0-tenant-guard contract:
   * ownerUid, ownerId, businessId, tenantKey, and schemaVersion (must equal 10).
   * Throws SOURCE_IDENTITY_ABSENT when payload.identity is missing.
   * Throws SOURCE_IDENTITY_MISMATCH when any of the five fields contradict expected.
   * Called by the migration script before allowing CUTOVER_VERIFIED and by the repair
   * script after writing payload.identity to confirm the write was correct.
   *
   * @param {object} raw - Raw Firestore document (full snapshot data)
   * @param {{ ownerUid, ownerId, businessId, tenantKey, schemaVersion }} expected
   */
  function validateSourceDocumentIdentity(raw, expected) {
    const { ownerUid, ownerId, businessId, tenantKey, schemaVersion } = expected;
    const payloadIdentity = raw?.payload?.identity;
    if (!payloadIdentity || typeof payloadIdentity !== 'object') {
      throw new Error(
        `SOURCE_IDENTITY_ABSENT: El documento state/main de businesses/${ownerUid} ` +
        `no contiene payload.identity. Ejecute primero worker-boundary-repair-identity.mjs ` +
        `para materializar la identidad anidada desde la identidad raíz válida del documento.`
      );
    }
    const mismatches = [];
    if (payloadIdentity.ownerUid !== ownerUid) mismatches.push(`ownerUid: esperado ${ownerUid}, encontrado ${payloadIdentity.ownerUid}`);
    if (payloadIdentity.ownerId !== ownerId) mismatches.push(`ownerId: esperado ${ownerId}, encontrado ${payloadIdentity.ownerId}`);
    if (payloadIdentity.businessId !== businessId) mismatches.push(`businessId: esperado ${businessId}, encontrado ${payloadIdentity.businessId}`);
    if (payloadIdentity.tenantKey !== tenantKey) mismatches.push(`tenantKey: esperado ${tenantKey}, encontrado ${payloadIdentity.tenantKey}`);
    if (Number(payloadIdentity.schemaVersion) !== Number(schemaVersion)) mismatches.push(`schemaVersion: esperado ${schemaVersion}, encontrado ${payloadIdentity.schemaVersion}`);
    if (mismatches.length) {
      throw new Error(
        `SOURCE_IDENTITY_MISMATCH: La identidad del documento fuente no coincide con el tenant esperado. ` +
        `Diferencias: ${mismatches.join('; ')}. ` +
        `No se puede declarar CUTOVER_VERIFIED con identidad contradictoria.`
      );
    }
  }

  /**
   * Plans a repair for a Firestore state/main document that has a valid root-level
   * identity but is missing payload.identity (the nested form required by p0-tenant-guard).
   *
   * Decision logic (all other cases throw REPAIR_DENIED):
   *   - Root identity valid AND payload.identity absent  → REPAIR (materialize)
   *   - Root identity valid AND payload.identity matches → NOOP (already correct)
   *   - Root identity valid AND payload.identity contradicts → REPAIR_DENIED_NESTED_MISMATCH
   *   - Root identity contradicts expected               → REPAIR_DENIED_ROOT_MISMATCH
   *
   * Returns { action: 'NOOP'|'REPAIR', payloadIdentity: object|null, reason: string }
   * Never touches payload.data or any other field — only payload.identity.
   *
   * @param {object} raw - Raw Firestore document data (the full snapshot)
   * @param {{ ownerUid, ownerId, businessId, tenantKey, schemaVersion }} expected
   */
  function planIdentityRepair(raw, expected) {
    const { ownerUid: expOwnerUid, ownerId: expOwnerId, businessId: expBusinessId, tenantKey: expTenantKey, schemaVersion: expSchemaVersion } = expected;
    // 1. Validate root-level identity fields (strict)
    const rootMismatches = [];
    if (raw?.ownerUid !== expOwnerUid) rootMismatches.push(`ownerUid: raíz=${raw?.ownerUid}, esperado=${expOwnerUid}`);
    if (raw?.ownerId !== expOwnerId) rootMismatches.push(`ownerId: raíz=${raw?.ownerId}, esperado=${expOwnerId}`);
    if (raw?.businessId !== expBusinessId) rootMismatches.push(`businessId: raíz=${raw?.businessId}, esperado=${expBusinessId}`);
    if (raw?.tenantKey !== expTenantKey) rootMismatches.push(`tenantKey: raíz=${raw?.tenantKey}, esperado=${expTenantKey}`);
    if (Number(raw?.schemaVersion) !== Number(expSchemaVersion)) rootMismatches.push(`schemaVersion: raíz=${raw?.schemaVersion}, esperado=${expSchemaVersion}`);
    if (rootMismatches.length > 0) {
      throw new Error(
        `REPAIR_DENIED_ROOT_MISMATCH: La identidad raíz del documento no coincide con el contexto esperado. ` +
        `Diferencias: ${rootMismatches.join('; ')}. ` +
        `No se repara un documento con identidad raíz contradictoria.`
      );
    }
    // Root is valid. Build the canonical payload.identity to materialize.
    const canonicalPayloadIdentity = {
      ownerUid: expOwnerUid,
      ownerId: expOwnerId,
      businessId: expBusinessId,
      tenantKey: expTenantKey,
      schemaVersion: Number(expSchemaVersion)
    };
    // 2. Check payload.identity
    const existingNested = raw?.payload?.identity;
    if (existingNested && typeof existingNested === 'object') {
      // Nested exists — verify it agrees with root and expected
      const nestedMismatches = [];
      if (existingNested.ownerUid !== expOwnerUid) nestedMismatches.push(`ownerUid: anidado=${existingNested.ownerUid}, esperado=${expOwnerUid}`);
      if (existingNested.ownerId !== expOwnerId) nestedMismatches.push(`ownerId: anidado=${existingNested.ownerId}, esperado=${expOwnerId}`);
      if (existingNested.businessId !== expBusinessId) nestedMismatches.push(`businessId: anidado=${existingNested.businessId}, esperado=${expBusinessId}`);
      if (existingNested.tenantKey !== expTenantKey) nestedMismatches.push(`tenantKey: anidado=${existingNested.tenantKey}, esperado=${expTenantKey}`);
      if (Number(existingNested.schemaVersion) !== Number(expSchemaVersion)) nestedMismatches.push(`schemaVersion: anidado=${existingNested.schemaVersion}, esperado=${expSchemaVersion}`);
      if (nestedMismatches.length > 0) {
        throw new Error(
          `REPAIR_DENIED_NESTED_MISMATCH: La payload.identity existente contradice el contexto esperado. ` +
          `Diferencias: ${nestedMismatches.join('; ')}. ` +
          `No se sobrescribirá una identidad anidada contradictoria.`
        );
      }
      return { action: 'NOOP', payloadIdentity: null, reason: 'payload.identity ya existe y coincide con la identidad raíz y el contexto esperado.' };
    }
    // payload.identity absent, root valid → plan REPAIR
    return {
      action: 'REPAIR',
      payloadIdentity: canonicalPayloadIdentity,
      reason: 'payload.identity ausente; identidad raíz válida. Se materializará payload.identity sin alterar payload.data ni ningún dato comercial.'
    };
  }

  /**
   * Phase 3.3: this used to hard-block any projectId === production, back
   * when Workers had no per-tenant activation mechanism and production
   * access had to be blocked unconditionally at every layer including the
   * client gateway. That is now redundant AND actively wrong: a pilot
   * tenant explicitly enabled via businesses/{ownerUid}/featureFlags/workers
   * (see workersEnabledForTenant()) legitimately needs its real workers to
   * reach production Firestore through this same gateway. The authoritative
   * gate is firestore.rules' businessUnitReady() (unbypassable, checked on
   * every read/write), which applyWorkerBoundaryIdentity() in
   * firebase-service.js already re-checks client-side via
   * workersEnabledForTenant() BEFORE ever constructing this gateway. This
   * function now only guards against a missing/empty projectId.
   */
  function assertValidGatewayProject(projectId) {
    const normalized = String(projectId || '').trim();
    if (!normalized) throw new Error('La frontera de trabajadores requiere un projectId valido.');
    return normalized;
  }

  function enabledForProject(projectId) {
    const normalized = String(projectId || '').trim();
    return normalized === 'click360-staging-7620168025' || normalized.startsWith('demo-');
  }

  function stripBoundaryMetadata(record = {}) {
    const output = { ...record };
    ['ownerUid', 'tenantKey', 'boundarySchemaVersion', 'module', 'recordVersion', 'createdBy', 'updatedBy'].forEach((key) => delete output[key]);
    return output;
  }

  function createFirestoreGateway(options = {}) {
    const db = options.db;
    const firebase = options.firebase;
    const user = options.user;
    const ownerUid = safeId(options.ownerUid, 'ownerUid');
    const businessId = safeId(options.businessId, 'businessId');
    const role = normalizedRole(options.role);
    const permissionMap = options.permissions || normalizePermissionMap(role);
    if (!db || !firebase?.firestore?.FieldValue || !user?.uid) throw new Error('Gateway modular incompleto.');
    assertValidGatewayProject(options.projectId);
    const rootRef = db.collection('businesses').doc(ownerUid).collection('businessUnits').doc(businessId);
    const serverTimestamp = () => firebase.firestore.FieldValue.serverTimestamp();
    const moduleRef = (moduleName) => rootRef.collection(moduleName);
    const previousByModule = new Map();

    function may(moduleName, action) {
      return ['owner', 'admin'].includes(role) || can(permissionMap, moduleName, action);
    }

    async function verify() {
      const unitSnapshot = await rootRef.get({ source:'server' });
      if (!unitSnapshot.exists) throw new Error('El negocio no tiene una frontera modular preparada.');
      const unit = unitSnapshot.data() || {};
      const expected = identity(ownerUid, businessId);
      if (unit.status !== CUTOVER_STATUSES.CUTOVER_VERIFIED
        || unit.ownerUid !== expected.ownerUid || unit.businessId !== expected.businessId
        || unit.tenantKey !== expected.tenantKey || Number(unit.boundarySchemaVersion) !== SCHEMA_VERSION) {
        throw new Error('El corte modular del negocio no está verificado.');
      }
      if (!['owner', 'admin'].includes(role)) {
        const memberSnapshot = await moduleRef('members').doc(user.uid).get({ source:'server' });
        const member = memberSnapshot.exists ? memberSnapshot.data() : null;
        if (!member || member.status !== 'active' || member.uid !== user.uid
          || member.ownerUid !== ownerUid || member.businessId !== businessId || member.tenantKey !== expected.tenantKey) {
          throw new Error('La membresía modular no está activa.');
        }
      }
      return unit;
    }

    async function readModule(moduleName) {
      if (!may(moduleName, 'read')) return [];
      // firestore.rules restricts businessUnits/{id}/settings reads to the
      // single document id "main" (recordId == "main"). Firestore's rules
      // engine rejects an unfiltered collection list() unless it can prove
      // every possible result satisfies the rule, which an id-scoped rule
      // never allows for a generic list -- so this module must be read as a
      // single doc get, not a collection query, even though every other
      // module here is a normal multi-record collection.
      if (moduleName === 'settings') {
        const snapshot = await moduleRef('settings').doc('main').get({ source:'server' });
        if (!snapshot.exists) return [];
        const record = snapshot.data();
        return record.status === 'deleted' ? [] : [record];
      }
      const snapshot = await moduleRef(moduleName).get({ source:'server' });
      return snapshot.docs.map((entry) => entry.data()).filter((record) => record.status !== 'deleted');
    }

    async function pull() {
      const unit = await verify();
      const readable = ['products', 'sales', 'layaways', 'cashSessions', 'movements', 'auditEvents', 'settings'];
      const entries = await Promise.all(readable.map(async (moduleName) => [moduleName, await readModule(moduleName)]));
      const collections = Object.fromEntries(entries);
      entries.forEach(([moduleName, records]) => previousByModule.set(moduleName, new Map(records.map((record) => [record.id, canonicalJson(record)]))));
      const settings = stripBoundaryMetadata(collections.settings?.find((record) => record.id === 'main') || {});
      const business = settings.business || { id:businessId, name:'Negocio' };
      return {
        version:'CLICK360_MODULAR_V1',
        updatedAtMs:Date.now(),
        updatedAt:new Date().toISOString(),
        activeBusinessId:businessId,
        businesses:[{ ...business, id:businessId, settings:{ ...(business.settings || {}), tax:settings.tax || business.settings?.tax || {}, policies:settings.policies || business.settings?.policies || {} } }],
        products:(collections.products || []).map(stripBoundaryMetadata),
        sales:(collections.sales || []).map(stripBoundaryMetadata),
        layaways:(collections.layaways || []).map(stripBoundaryMetadata),
        cashSessions:(collections.cashSessions || []).map(stripBoundaryMetadata),
        movements:(collections.movements || []).map(stripBoundaryMetadata),
        auditLogs:(collections.auditEvents || []).map(stripBoundaryMetadata),
        invoices:[], dailyReports:[], operationLedger:[], deletedProducts:[], tables:[], tableOrders:[],
        restaurantPayments:[], restaurantPrintHistory:[], restaurantEvents:[], restaurantRecipes:[], labelPrintHistory:[],
        logistics:{ vehicles:[], routes:[], loadSheets:[], routeSales:[], collections:[], returns:[], routeSettlements:[], routeExpenses:[], routeCustomers:[], events:[], printHistory:[] },
        finance:{ payments:[], loans:[], envelopes:[], goals:[] }, notifications:[], legalAcceptances:[],
        settings:{
          workers:[], labelTemplates:settings.labelTemplates || [], labelProfiles:settings.labelProfiles || [],
          userProfiles:{}, customers:settings.customers || [], reminders:settings.reminders || [],
          onboarding:{}, activationRequests:[], policies:settings.policies || {}, legal:{}, modularBoundary:unit
        }
      };
    }

    function recordsFromState(state, moduleName) {
      if (moduleName === 'auditEvents') return recordsForBusiness(state?.auditLogs, businessId);
      if (moduleName === 'settings') {
        const business = (state?.businesses || []).find((item) => item.id === businessId) || {};
        return [{
          id:'main', business, customers:recordsForBusiness(state?.settings?.customers, businessId, state?.settings?.legacyDataBusinessId),
          reminders:recordsForBusiness(state?.settings?.reminders, businessId, state?.settings?.legacyDataBusinessId),
          labelTemplates:recordsForBusiness(state?.settings?.labelTemplates, businessId, state?.settings?.legacyDataBusinessId),
          labelProfiles:recordsForBusiness(state?.settings?.labelProfiles, businessId, state?.settings?.legacyDataBusinessId),
          policies:business?.settings?.policies || state?.settings?.policies || {}, tax:business?.settings?.tax || {}
        }];
      }
      return recordsForBusiness(state?.[moduleName], businessId);
    }

    function writableAction(moduleName, previousRecord, nextRecord) {
      if (!previousRecord && nextRecord) return 'create';
      if (previousRecord && !nextRecord) return moduleName === 'products' ? 'delete' : '';
      if (previousRecord && nextRecord && canonicalJson(stripBoundaryMetadata(previousRecord)) !== canonicalJson(nextRecord)) {
        if (moduleName === 'layaways' && may(moduleName, 'payment')) return 'payment';
        if (moduleName === 'cashSessions' && nextRecord.status === 'closed' && previousRecord.status !== 'closed') return 'close';
        return 'update';
      }
      return '';
    }

    async function commit(previousState, nextState) {
      await verify();
      const batch = db.batch();
      let writes = 0;
      const beforeProducts = new Map(recordsFromState(previousState, 'products').map((record) => [record.id, record]));
      const afterProducts = new Map(recordsFromState(nextState, 'products').map((record) => [record.id, record]));
      const previousSales = new Set(recordsFromState(previousState, 'sales').map((record) => record.id));
      const newSales = recordsFromState(nextState, 'sales').filter((record) => !previousSales.has(record.id));
      const saleStockDeltas = new Map();
      const productSaleId = new Map();
      newSales.forEach((sale) => {
        const deltas = {};
        (Array.isArray(sale.items) ? sale.items : []).forEach((item) => {
          const productId = item.productId || item.id;
          const before = beforeProducts.get(productId);
          const after = afterProducts.get(productId);
          const delta = Number(before?.stock || 0) - Number(after?.stock || 0);
          if (before && after && delta > 0) {
            deltas[productId] = delta;
            productSaleId.set(productId, sale.id);
          }
        });
        saleStockDeltas.set(sale.id, deltas);
      });
      for (const moduleName of ['products', 'sales', 'layaways', 'cashSessions', 'movements', 'auditEvents', 'settings']) {
        const before = new Map(recordsFromState(previousState, moduleName).map((record) => [record.id, record]));
        const after = new Map(recordsFromState(nextState, moduleName).map((record) => [record.id, record]));
        const ids = new Set([...before.keys(), ...after.keys()]);
        for (const id of ids) {
          const previousRecord = before.get(id);
          const nextRecord = after.get(id);
          let action = writableAction(moduleName, previousRecord, nextRecord);
          if (!action) continue;
          let saleStockOperationId = '';
          if (moduleName === 'products' && action === 'update' && !may(moduleName, action)) {
            const changedKeys = new Set([...Object.keys(previousRecord || {}), ...Object.keys(nextRecord || {})]
              .filter((key) => canonicalJson(previousRecord?.[key]) !== canonicalJson(nextRecord?.[key])));
            const onlyStock = [...changedKeys].every((key) => ['stock', 'updatedAt', 'updatedAtMs'].includes(key));
            saleStockOperationId = productSaleId.get(id) || '';
            if (onlyStock && saleStockOperationId && may('sales', 'create')) action = 'sale_stock';
          }
          if (action !== 'sale_stock' && !may(moduleName, action)) throw new Error(`Permiso denegado: ${moduleName}.${action}`);
          const ref = moduleRef(moduleName).doc(safeId(id, `${moduleName}.id`));
          if (!previousRecord && nextRecord) {
            const payload = {
              ...canonicalize(nextRecord), ...identity(ownerUid, businessId), module:moduleName, recordVersion:1,
              actorUid:nextRecord.actorUid || user.uid, createdBy:user.uid, updatedBy:user.uid,
              createdAt:serverTimestamp(), updatedAt:serverTimestamp()
            };
            if (moduleName === 'sales') payload.stockDeltas = saleStockDeltas.get(id) || {};
            batch.set(ref, payload);
          } else {
            const storedSnapshot = await ref.get({ source:'server' });
            if (!storedSnapshot.exists) throw new Error(`No existe ${moduleName}/${id}; no se hará overwrite.`);
            const stored = storedSnapshot.data() || {};
            const domain = nextRecord ? canonicalize(nextRecord) : { ...stripBoundaryMetadata(stored), status:'deleted', deletedAt:new Date().toISOString() };
            if (action === 'sale_stock') domain.lastOperationId = saleStockOperationId;
            batch.update(ref, {
              ...domain, ...identity(ownerUid, businessId), module:moduleName,
              recordVersion:Number(stored.recordVersion || 1) + 1, updatedBy:user.uid, updatedAt:serverTimestamp()
            });
          }
          writes += 1;
          if (writes > 400) throw new Error('El lote modular supera el límite seguro; divide la operación.');
        }
      }
      if (!writes) return { ok:true, noop:true, writes:0 };
      await batch.commit();
      return { ok:true, noop:false, writes };
    }

    return Object.freeze({ ownerUid, businessId, role, permissions:permissionMap, verify, pull, commit, may });
  }

  root.CLICK360_WORKER_DATA_BOUNDARY = Object.freeze({
    VERSION,
    SCHEMA_VERSION,
    MODULES,
    CUTOVER_STATUSES,
    ROLE_PERMISSIONS,
    DEFAULT_BASE_SEAT_CAP,
    normalizedRole,
    normalizePermissionMap,
    can,
    identity,
    boundaryRootPath,
    collectionPath,
    recordPath,
    canonicalJson,
    planMigration,
    validateMigrationPlan,
    compareMigrationPlans,
    validateSourceDocumentIdentity,
    planIdentityRepair,
    assertValidGatewayProject,
    enabledForProject,
    createFirestoreGateway,
    seatEntitlementPath,
    seatEntitlement,
    seatCapacity,
    hasSeatAvailable,
    planSeatConsumption,
    planSeatRelease,
    PRODUCTION_PROJECT_ID,
    workersFeatureFlagPath,
    workersEnabledForTenant
  });
})(typeof window !== 'undefined' ? window : globalThis);
