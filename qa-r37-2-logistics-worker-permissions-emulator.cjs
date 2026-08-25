const assert = require('assert');
const fs = require('fs');
const { assertFails, assertSucceeds, initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { doc, getDoc, serverTimestamp, setDoc, updateDoc } = require('firebase/firestore');

const RULES = fs.readFileSync('firestore.rules', 'utf8');
const PROJECT_ID = 'demo-click360-logistics-permissions';
const OWNER = 'owner-logistics';
const BUSINESS = 'business-logistics';
const OTHER_OWNER = 'owner-logistics-other';
const OTHER_BUSINESS = 'business-logistics-other';

/**
 * r37.2 (CLICK 360 -- FINAL LOGISTICS WORKER PERMISSION CLOSURE): the real
 * backend half of "un Vendedor A solo puede tocar la Ruta A, un Cobrador
 * solo cobra, un Repartidor solo entrega/retorna, Bodega prepara carga sin
 * vender ni cobrar, Supervisor administra pero nunca reabre, Owner es el
 * unico que reabre". Every scenario below is proven against the REAL
 * firestore.rules (not a client-side simulation) through the Firestore
 * emulator, using the same businessUnits/logistics* collections the real
 * app now writes through (firebase-service.js pushModularState /
 * app.js logisticsActor()).
 */

function tenantKey(ownerUid, businessId) { return `owner:${ownerUid}:business:${businessId}`; }
function ownerProfile(uid) { return { uid, email:`${uid}@example.test`, role:'owner', isOwner:true, ownerId:uid, status:'active', approved:true }; }
function unit(ownerUid, businessId) {
  return {
    id:businessId, ownerUid, businessId, tenantKey:tenantKey(ownerUid, businessId), boundarySchemaVersion:1,
    status:'CUTOVER_VERIFIED', sourcePath:`businesses/${ownerUid}/state/main`, sourceHash:'synthetic-source-hash',
    counts:{ members:0, products:0, sales:0, layaways:0, cashSessions:0, movements:0, auditEvents:0, settings:0 },
    totals:{ salesTotal:0, salesCollected:0, layawayTotal:0, layawayBalance:0, cashOpening:0, movementAmount:0, stock:0 }
  };
}
function workersFlag(ownerUid) { return { ownerUid, enabled:true, enabledAt:new Date(), enabledBy:'test-seed', updatedBy:'test-seed', updatedAt:new Date() }; }
function seats(ownerUid, businessId) {
  return { ownerUid, businessId, tenantKey:tenantKey(ownerUid, businessId), boundarySchemaVersion:1, baseSeatCap:10, addOnSeats:0, activeMembers:6, updatedBy:ownerUid, updatedAt:new Date() };
}
function emptyGenericPermissions() {
  const empty = () => ({ read:false, create:false, update:false, delete:false, payment:false, close:false, manage:false });
  return { members:empty(), products:empty(), sales:empty(), layaways:empty(), cashSessions:empty(), movements:empty(), auditEvents:empty(), settings:empty() };
}
// Exact preset permission shapes from app.js WORKER_ROLE_PRESETS /
// worker-data-boundary.js ROLE_PERMISSIONS.logistics (hand-mirrored here
// so this test is an independent check, not a re-import of the same
// code it is verifying).
function logisticsPermissions(preset) {
  const sets = {
    vendedor_ruta: ['routes.read', 'loadSheets.read', 'routeSales.read', 'routeSales.create', 'returns.read', 'returns.write', 'settlements.read', 'printing.write'],
    cobrador_ruta: ['routes.read', 'loadSheets.read', 'routeSales.read', 'returns.read', 'settlements.read', 'collections.read', 'collections.write', 'printing.write'],
    repartidor: ['vehicles.read', 'routes.read', 'loadSheets.read', 'returns.read', 'returns.write', 'reports.read', 'printing.write'],
    bodega: ['vehicles.read', 'routes.read', 'loadSheets.read', 'loadSheets.write', 'returns.read', 'returns.write', 'reports.read', 'printing.write'],
    supervisor_logistica: [
      'vehicles.read', 'vehicles.write', 'routes.read', 'routes.write', 'routes.assign',
      'loadSheets.read', 'loadSheets.write', 'routeSales.read', 'routeSales.create', 'routeSales.discount',
      'collections.read', 'collections.write', 'returns.read', 'returns.write',
      'settlements.read', 'settlements.write', 'settlements.approve', 'reports.read', 'printing.write'
    ],
    logistica_lectura: ['vehicles.read', 'routes.read', 'loadSheets.read', 'routeSales.read', 'collections.read', 'returns.read', 'settlements.read', 'reports.read']
  };
  const map = {};
  (sets[preset] || []).forEach((action) => { map[action] = true; });
  return map;
}
function member(uid, baseRole, presetLogistics) {
  return {
    ownerUid:OWNER, businessId:BUSINESS, tenantKey:tenantKey(OWNER, BUSINESS), boundarySchemaVersion:1,
    id:uid, module:'members', recordVersion:1, createdBy:uid, updatedBy:uid, createdAt:new Date(), updatedAt:new Date(),
    uid, email:`${uid}@example.test`, role:baseRole, permissions:{ ...emptyGenericPermissions(), logistics:presetLogistics }, status:'active'
  };
}
function routeDoc(routeId, sellerId, collectorId, helperId) {
  return {
    ownerUid:OWNER, businessId:BUSINESS, tenantKey:tenantKey(OWNER, BUSINESS), boundarySchemaVersion:1,
    id:routeId, module:'logisticsRoutes', recordVersion:1, createdBy:OWNER, updatedBy:OWNER, createdAt:new Date(), updatedAt:new Date(),
    name:`Ruta ${routeId}`, sellerId, collectorId, helperId, status:'dispatched'
  };
}

async function main() {
  const env = await initializeTestEnvironment({ projectId:PROJECT_ID, firestore:{ rules:RULES } });
  try {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'approvedUsers', OWNER), ownerProfile(OWNER));
      await setDoc(doc(db, 'businesses', OWNER, 'businessUnits', BUSINESS), unit(OWNER, BUSINESS));
      await setDoc(doc(db, 'businesses', OWNER, 'featureFlags', 'workers'), workersFlag(OWNER));
      await setDoc(doc(db, 'businesses', OWNER, 'businessUnits', BUSINESS, 'entitlement', 'seats'), seats(OWNER, BUSINESS));

      await setDoc(doc(db, 'businesses', OTHER_OWNER, 'businessUnits', OTHER_BUSINESS), unit(OTHER_OWNER, OTHER_BUSINESS));
      await setDoc(doc(db, 'businesses', OTHER_OWNER, 'featureFlags', 'workers'), workersFlag(OTHER_OWNER));
      await setDoc(doc(db, 'businesses', OTHER_OWNER, 'businessUnits', OTHER_BUSINESS, 'entitlement', 'seats'), seats(OTHER_OWNER, OTHER_BUSINESS));

      const members = [
        ['vendedorA', 'seller', logisticsPermissions('vendedor_ruta')],
        ['vendedorB', 'seller', logisticsPermissions('vendedor_ruta')],
        ['cobradorA', 'seller', logisticsPermissions('cobrador_ruta')],
        ['cobradorB', 'seller', logisticsPermissions('cobrador_ruta')],
        ['repartidorA', 'inventory', logisticsPermissions('repartidor')],
        ['repartidorB', 'inventory', logisticsPermissions('repartidor')],
        ['bodega1', 'inventory', logisticsPermissions('bodega')],
        ['supervisor1', 'supervisor', logisticsPermissions('supervisor_logistica')],
        ['readonly1', 'supervisor', logisticsPermissions('logistica_lectura')]
      ];
      for (const [uid, baseRole, permissionsMap] of members) {
        await setDoc(doc(db, 'businesses', OWNER, 'businessUnits', BUSINESS, 'members', uid), member(uid, baseRole, permissionsMap));
      }
      // A worker belonging to the OTHER tenant, structurally identical to
      // vendedorA, used for the cross-tenant DENY check.
      await setDoc(doc(db, 'businesses', OTHER_OWNER, 'businessUnits', OTHER_BUSINESS, 'members', 'outsiderVendor'), {
        ...member('outsiderVendor', 'seller', logisticsPermissions('vendedor_ruta')),
        ownerUid:OTHER_OWNER, businessId:OTHER_BUSINESS, tenantKey:tenantKey(OTHER_OWNER, OTHER_BUSINESS)
      });

      await setDoc(doc(db, 'businesses', OWNER, 'businessUnits', BUSINESS, 'logisticsRoutes', 'routeA'), routeDoc('routeA', 'vendedorA', 'cobradorA', 'repartidorA'));
      await setDoc(doc(db, 'businesses', OWNER, 'businessUnits', BUSINESS, 'logisticsRoutes', 'routeB'), routeDoc('routeB', 'vendedorB', 'cobradorB', 'repartidorB'));
    });

    const vendedorADb = env.authenticatedContext('vendedorA', { email:'vendedorA@example.test' }).firestore();
    const vendedorBDb = env.authenticatedContext('vendedorB', { email:'vendedorB@example.test' }).firestore();
    const cobradorADb = env.authenticatedContext('cobradorA', { email:'cobradorA@example.test' }).firestore();
    const repartidorADb = env.authenticatedContext('repartidorA', { email:'repartidorA@example.test' }).firestore();
    const bodegaDb = env.authenticatedContext('bodega1', { email:'bodega1@example.test' }).firestore();
    const supervisorDb = env.authenticatedContext('supervisor1', { email:'supervisor1@example.test' }).firestore();
    const readonlyDb = env.authenticatedContext('readonly1', { email:'readonly1@example.test' }).firestore();
    const ownerDb = env.authenticatedContext(OWNER, { email:`${OWNER}@example.test` }).firestore();
    const outsiderDb = env.authenticatedContext('outsiderVendor', { email:'outsiderVendor@example.test' }).firestore();

    const unitPath = (...parts) => ['businesses', OWNER, 'businessUnits', BUSINESS, ...parts];
    const routeSaleRecord = (db, id, routeId, actorUid, discount = 0) => ({
      ownerUid:OWNER, businessId:BUSINESS, tenantKey:tenantKey(OWNER, BUSINESS), boundarySchemaVersion:1,
      id, module:'logisticsRouteSales', recordVersion:1, createdBy:actorUid, updatedBy:actorUid,
      createdAt:serverTimestamp(), updatedAt:serverTimestamp(),
      routeId, actorUid, total:20, discount, status:'paid'
    });

    // ---- Vendedor A: sells on A (PASS), denied on B (route isolation) ----
    await assertSucceeds(setDoc(doc(vendedorADb, ...unitPath('logisticsRouteSales', 'sale-a-1')), routeSaleRecord(vendedorADb, 'sale-a-1', 'routeA', 'vendedorA')));
    await assertFails(setDoc(doc(vendedorADb, ...unitPath('logisticsRouteSales', 'sale-b-1')), routeSaleRecord(vendedorADb, 'sale-b-1', 'routeB', 'vendedorA')));
    // Vendedor never gets collections.write -- DENY even trying to collect on their OWN route.
    await assertFails(setDoc(doc(vendedorADb, ...unitPath('logisticsCollections', 'col-a-1')), {
      ownerUid:OWNER, businessId:BUSINESS, tenantKey:tenantKey(OWNER, BUSINESS), boundarySchemaVersion:1,
      id:'col-a-1', module:'logisticsCollections', recordVersion:1, createdBy:'vendedorA', updatedBy:'vendedorA',
      createdAt:serverTimestamp(), updatedAt:serverTimestamp(), routeId:'routeA', actorUid:'vendedorA', amount:5
    }));
    // Discount off by default -- a non-zero discount is denied even on the vendedor's own route.
    await assertFails(setDoc(doc(vendedorADb, ...unitPath('logisticsRouteSales', 'sale-a-discount')), routeSaleRecord(vendedorADb, 'sale-a-discount', 'routeA', 'vendedorA', 3)));

    // ---- Vendedor B: sells on B (PASS), denied on A ----
    await assertSucceeds(setDoc(doc(vendedorBDb, ...unitPath('logisticsRouteSales', 'sale-b-2')), routeSaleRecord(vendedorBDb, 'sale-b-2', 'routeB', 'vendedorB')));
    await assertFails(setDoc(doc(vendedorBDb, ...unitPath('logisticsRouteSales', 'sale-a-2')), routeSaleRecord(vendedorBDb, 'sale-a-2', 'routeA', 'vendedorB')));

    // ---- Cobrador A: collects on A (PASS), denied on B, denied selling ----
    await assertSucceeds(setDoc(doc(cobradorADb, ...unitPath('logisticsCollections', 'col-a-2')), {
      ownerUid:OWNER, businessId:BUSINESS, tenantKey:tenantKey(OWNER, BUSINESS), boundarySchemaVersion:1,
      id:'col-a-2', module:'logisticsCollections', recordVersion:1, createdBy:'cobradorA', updatedBy:'cobradorA',
      createdAt:serverTimestamp(), updatedAt:serverTimestamp(), routeId:'routeA', actorUid:'cobradorA', amount:8
    }));
    await assertFails(setDoc(doc(cobradorADb, ...unitPath('logisticsCollections', 'col-b-1')), {
      ownerUid:OWNER, businessId:BUSINESS, tenantKey:tenantKey(OWNER, BUSINESS), boundarySchemaVersion:1,
      id:'col-b-1', module:'logisticsCollections', recordVersion:1, createdBy:'cobradorA', updatedBy:'cobradorA',
      createdAt:serverTimestamp(), updatedAt:serverTimestamp(), routeId:'routeB', actorUid:'cobradorA', amount:8
    }));
    await assertFails(setDoc(doc(cobradorADb, ...unitPath('logisticsRouteSales', 'sale-a-by-cobrador')), routeSaleRecord(cobradorADb, 'sale-a-by-cobrador', 'routeA', 'cobradorA')));

    // ---- Repartidor A: delivers/returns on A (PASS), denied on B, denied selling/collecting ----
    const returnRecord = (id, routeId, actorUid) => ({
      ownerUid:OWNER, businessId:BUSINESS, tenantKey:tenantKey(OWNER, BUSINESS), boundarySchemaVersion:1,
      id, module:'logisticsReturns', recordVersion:1, createdBy:actorUid, updatedBy:actorUid,
      createdAt:serverTimestamp(), updatedAt:serverTimestamp(), routeId, actorUid, qty:2, condition:'sellable'
    });
    await assertSucceeds(setDoc(doc(repartidorADb, ...unitPath('logisticsReturns', 'ret-a-1')), returnRecord('ret-a-1', 'routeA', 'repartidorA')));
    await assertFails(setDoc(doc(repartidorADb, ...unitPath('logisticsReturns', 'ret-b-1')), returnRecord('ret-b-1', 'routeB', 'repartidorA')));
    await assertFails(setDoc(doc(repartidorADb, ...unitPath('logisticsRouteSales', 'sale-a-by-repartidor')), routeSaleRecord(repartidorADb, 'sale-a-by-repartidor', 'routeA', 'repartidorA')));
    await assertFails(setDoc(doc(repartidorADb, ...unitPath('logisticsCollections', 'col-a-by-repartidor')), {
      ownerUid:OWNER, businessId:BUSINESS, tenantKey:tenantKey(OWNER, BUSINESS), boundarySchemaVersion:1,
      id:'col-a-by-repartidor', module:'logisticsCollections', recordVersion:1, createdBy:'repartidorA', updatedBy:'repartidorA',
      createdAt:serverTimestamp(), updatedAt:serverTimestamp(), routeId:'routeA', actorUid:'repartidorA', amount:5
    }));

    // ---- Bodega: prepares load sheets on ANY route (broad, not
    // assignment-scoped), denied trying to collect ----
    const loadSheetRecord = (id, routeId, actorUid) => ({
      ownerUid:OWNER, businessId:BUSINESS, tenantKey:tenantKey(OWNER, BUSINESS), boundarySchemaVersion:1,
      id, module:'logisticsLoadSheets', recordVersion:1, createdBy:actorUid, updatedBy:actorUid,
      createdAt:serverTimestamp(), updatedAt:serverTimestamp(), routeId, status:'draft', items:[]
    });
    await assertSucceeds(setDoc(doc(bodegaDb, ...unitPath('logisticsLoadSheets', 'sheet-a')), loadSheetRecord('sheet-a', 'routeA', 'bodega1')));
    await assertSucceeds(setDoc(doc(bodegaDb, ...unitPath('logisticsLoadSheets', 'sheet-b')), loadSheetRecord('sheet-b', 'routeB', 'bodega1')));
    await assertFails(setDoc(doc(bodegaDb, ...unitPath('logisticsCollections', 'col-a-by-bodega')), {
      ownerUid:OWNER, businessId:BUSINESS, tenantKey:tenantKey(OWNER, BUSINESS), boundarySchemaVersion:1,
      id:'col-a-by-bodega', module:'logisticsCollections', recordVersion:1, createdBy:'bodega1', updatedBy:'bodega1',
      createdAt:serverTimestamp(), updatedAt:serverTimestamp(), routeId:'routeA', actorUid:'bodega1', amount:5
    }));

    // ---- Readonly: reads everything, mutates nothing ----
    await assertSucceeds(getDoc(doc(readonlyDb, ...unitPath('logisticsRoutes', 'routeA'))));
    await assertSucceeds(getDoc(doc(readonlyDb, ...unitPath('logisticsRoutes', 'routeB'))));
    await assertFails(setDoc(doc(readonlyDb, ...unitPath('logisticsLoadSheets', 'sheet-by-readonly')), loadSheetRecord('sheet-by-readonly', 'routeA', 'readonly1')));

    // ---- Supervisor: creates/assigns routes; can approve; CANNOT reopen ----
    await assertSucceeds(updateDoc(doc(supervisorDb, ...unitPath('logisticsRoutes', 'routeA')), {
      status:'in_progress', auditTrail:[], recordVersion:2, updatedBy:'supervisor1', updatedAt:serverTimestamp()
    }));
    const settlementBase = {
      ownerUid:OWNER, businessId:BUSINESS, tenantKey:tenantKey(OWNER, BUSINESS), boundarySchemaVersion:1,
      id:'settlement-a', module:'logisticsSettlements', recordVersion:1, createdBy:'supervisor1', updatedBy:'supervisor1',
      createdAt:serverTimestamp(), updatedAt:serverTimestamp(), routeId:'routeA', status:'pending_approval'
    };
    await assertSucceeds(setDoc(doc(supervisorDb, ...unitPath('logisticsSettlements', 'settlement-a')), settlementBase));
    await assertSucceeds(updateDoc(doc(supervisorDb, ...unitPath('logisticsSettlements', 'settlement-a')), {
      status:'closed', recordVersion:2, updatedBy:'supervisor1', updatedAt:serverTimestamp()
    }));
    await assertFails(updateDoc(doc(supervisorDb, ...unitPath('logisticsSettlements', 'settlement-a')), {
      status:'reopened', recordVersion:3, updatedBy:'supervisor1', updatedAt:serverTimestamp()
    }));

    // ---- Owner: the ONLY actor who can reopen a closed settlement, and it succeeds ----
    await assertSucceeds(updateDoc(doc(ownerDb, ...unitPath('logisticsSettlements', 'settlement-a')), {
      status:'reopened', recordVersion:3, updatedBy:OWNER, updatedAt:serverTimestamp()
    }));

    // ---- Cross-tenant: an identically-permissioned worker from a
    // DIFFERENT owner's tenant is denied outright, both read and write. ----
    await assertFails(getDoc(doc(outsiderDb, ...unitPath('logisticsRoutes', 'routeA'))));
    await assertFails(setDoc(doc(outsiderDb, ...unitPath('logisticsRouteSales', 'sale-cross-tenant')), routeSaleRecord(outsiderDb, 'sale-cross-tenant', 'routeA', 'outsiderVendor')));

    console.log('CLICK 360 r37.2 LOGISTICS WORKER PERMISSIONS emulator PASS: Vendedor/Cobrador/Repartidor route isolation (own route PASS, other route DENY), Vendedor never collects, Cobrador never sells, Repartidor never sells/collects, discount off by default, Bodega has broad non-assignment-scoped load-sheet access but never collects, Readonly reads everything and mutates nothing, Supervisor manages/approves but is hard-denied reopening a closed settlement, Owner is the only actor who can reopen (audited), and cross-tenant access is denied outright.');
  } finally {
    await env.cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
