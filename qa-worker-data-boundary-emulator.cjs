const assert = require('assert');
const fs = require('fs');
const { assertFails, assertSucceeds, initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { collection, deleteDoc, doc, getDoc, getDocs, increment, runTransaction, serverTimestamp, setDoc, updateDoc, writeBatch } = require('firebase/firestore');

const RULES = fs.readFileSync('firestore.rules', 'utf8');
const PROJECT_ID = 'demo-click360-worker-boundary';
const OWNER = 'owner-boundary';
const BUSINESS = 'business-alpha';
const OTHER_OWNER = 'owner-other';
const OTHER_BUSINESS = 'business-other';
const WORKER = 'cashier-boundary';
const WORKER_EMAIL = 'cashier-boundary@example.test';
const INVITE_HASH = 'b'.repeat(64);

function tenantKey(ownerUid, businessId) { return `owner:${ownerUid}:business:${businessId}`; }
function ownerProfile(uid) {
  return { uid, email:`${uid}@example.test`, role:'owner', isOwner:true, ownerId:uid, status:'active', approved:true };
}
function permissions(role) {
  const empty = () => ({ read:false, create:false, update:false, delete:false, payment:false, close:false, manage:false });
  const result = {
    members:empty(), products:empty(), sales:empty(), layaways:empty(), cashSessions:empty(),
    movements:empty(), auditEvents:empty(), settings:empty()
  };
  const allow = (moduleName, ...actions) => actions.forEach((action) => { result[moduleName][action] = true; });
  if (role === 'admin') Object.values(result).forEach((module) => Object.keys(module).forEach((action) => { module[action] = true; }));
  if (role === 'supervisor') {
    allow('members', 'read'); allow('products', 'read', 'create', 'update'); allow('sales', 'read', 'create', 'update');
    allow('layaways', 'read', 'create', 'update', 'payment'); allow('cashSessions', 'read', 'create', 'update', 'close');
    allow('movements', 'read', 'create'); allow('auditEvents', 'read', 'create'); allow('settings', 'read');
  }
  if (role === 'seller') {
    allow('products', 'read'); allow('sales', 'read', 'create'); allow('layaways', 'read', 'create', 'payment');
    allow('cashSessions', 'read'); allow('movements', 'read'); allow('auditEvents', 'create'); allow('settings', 'read');
  }
  if (role === 'cashier') {
    allow('products', 'read'); allow('sales', 'read', 'create'); allow('layaways', 'read', 'create', 'payment');
    allow('cashSessions', 'read', 'create', 'update', 'close'); allow('movements', 'read', 'create');
    allow('auditEvents', 'create'); allow('settings', 'read');
  }
  if (role === 'inventory') {
    allow('products', 'read', 'create', 'update', 'delete'); allow('movements', 'read', 'create');
    allow('auditEvents', 'create'); allow('settings', 'read');
  }
  return result;
}
function seats(ownerUid, businessId, extra = {}) {
  return {
    ownerUid, businessId, tenantKey:tenantKey(ownerUid, businessId), boundarySchemaVersion:1,
    baseSeatCap:2, addOnSeats:0, activeMembers:0, updatedBy:ownerUid, updatedAt:new Date(), ...extra
  };
}
function unit(ownerUid, businessId) {
  return {
    id:businessId, ownerUid, businessId, tenantKey:tenantKey(ownerUid, businessId), boundarySchemaVersion:1,
    status:'CUTOVER_VERIFIED', sourcePath:`businesses/${ownerUid}/state/main`, sourceHash:'synthetic-source-hash',
    counts:{ members:0, products:1, sales:0, layaways:0, cashSessions:0, movements:0, auditEvents:0, settings:1 },
    totals:{ salesTotal:0, salesCollected:0, layawayTotal:0, layawayBalance:0, cashOpening:0, movementAmount:0, stock:10 }
  };
}
function boundaryRecord(ownerUid, businessId, moduleName, id, actorUid, extra = {}) {
  return {
    id, ownerUid, businessId, tenantKey:tenantKey(ownerUid, businessId), boundarySchemaVersion:1,
    module:moduleName, recordVersion:1, createdBy:actorUid, updatedBy:actorUid,
    createdAt:serverTimestamp(), updatedAt:serverTimestamp(), ...extra
  };
}
function rootMember(uid, email, role, permissionMap) {
  return {
    uid, email, name:'QA Worker', role, permissions:permissionMap, status:'active', ownerId:OWNER,
    businessId:OWNER, businessUnitId:BUSINESS, tenantKey:`owner:${OWNER}:business:${OWNER}`, invitationHash:INVITE_HASH,
    acceptedAt:serverTimestamp(), lastAccessAt:serverTimestamp()
  };
}
function approvedWorker(uid, email, role, permissionMap) {
  return {
    uid, email, name:'QA Worker', photoURL:'', role, permissions:permissionMap, ownerId:OWNER,
    businessId:OWNER, businessUnitId:BUSINESS, tenantKey:`owner:${OWNER}:business:${OWNER}`, invitationHash:INVITE_HASH,
    status:'active', approved:true, isOwner:false, businessLimit:1, workerLimit:0,
    approvedFromInvitation:true, createdAt:serverTimestamp(), updatedAt:serverTimestamp()
  };
}

async function main() {
  const env = await initializeTestEnvironment({ projectId:PROJECT_ID, firestore:{ rules:RULES } });
  try {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'approvedUsers', OWNER), ownerProfile(OWNER));
      await setDoc(doc(db, 'approvedUsers', OTHER_OWNER), ownerProfile(OTHER_OWNER));
      await setDoc(doc(db, 'businesses', OWNER, 'businessUnits', BUSINESS), unit(OWNER, BUSINESS));
      await setDoc(doc(db, 'businesses', OTHER_OWNER, 'businessUnits', OTHER_BUSINESS), unit(OTHER_OWNER, OTHER_BUSINESS));
      // Pre-seeded fixture members below (admin-a, supervisor-a, seller-a, inventory-a) are
      // written with rules disabled, so the entitlement counter is seeded to match reality
      // (4 already active) with enough addOnSeats to also cover the WORKER activation later
      // in this file via the normal seat-consuming path.
      await setDoc(doc(db, 'businesses', OWNER, 'businessUnits', BUSINESS, 'entitlement', 'seats'), seats(OWNER, BUSINESS, { addOnSeats:3, activeMembers:4 }));
      await setDoc(doc(db, 'businesses', OTHER_OWNER, 'businessUnits', OTHER_BUSINESS, 'entitlement', 'seats'), seats(OTHER_OWNER, OTHER_BUSINESS));
      await setDoc(doc(db, 'businesses', OWNER, 'businessUnits', BUSINESS, 'products', 'product-a'), {
        ...boundaryRecord(OWNER, BUSINESS, 'products', 'product-a', OWNER, { name:'Producto QA', stock:10, price:5 }),
        createdAt:new Date(), updatedAt:new Date()
      });
      await setDoc(doc(db, 'businesses', OWNER, 'businessUnits', BUSINESS, 'settings', 'main'), {
        ...boundaryRecord(OWNER, BUSINESS, 'settings', 'main', OWNER, { business:{ id:BUSINESS, name:'Negocio sintetico' } }),
        createdAt:new Date(), updatedAt:new Date()
      });
      for (const [uid, role] of [['admin-a', 'admin'], ['supervisor-a', 'supervisor'], ['seller-a', 'seller'], ['inventory-a', 'inventory'], ['revoked-a', 'cashier']]) {
        await setDoc(doc(db, 'businesses', OWNER, 'businessUnits', BUSINESS, 'members', uid), {
          ...boundaryRecord(OWNER, BUSINESS, 'members', uid, uid, {
            uid, email:`${uid}@example.test`, role, permissions:permissions(role), status:uid === 'revoked-a' ? 'revoked' : 'active'
          }), createdAt:new Date(), updatedAt:new Date()
        });
      }
    });

    const ownerDb = env.authenticatedContext(OWNER, { email:`${OWNER}@example.test` }).firestore();
    const workerDb = env.authenticatedContext(WORKER, { email:WORKER_EMAIL }).firestore();
    const adminDb = env.authenticatedContext('admin-a', { email:'admin-a@example.test' }).firestore();
    const supervisorDb = env.authenticatedContext('supervisor-a', { email:'supervisor-a@example.test' }).firestore();
    const sellerDb = env.authenticatedContext('seller-a', { email:'seller-a@example.test' }).firestore();
    const inventoryDb = env.authenticatedContext('inventory-a', { email:'inventory-a@example.test' }).firestore();
    const revokedDb = env.authenticatedContext('revoked-a', { email:'revoked-a@example.test' }).firestore();
    const attackerDb = env.authenticatedContext('attacker-a', { email:'attacker@example.test' }).firestore();
    const unitPath = (...parts) => ['businesses', OWNER, 'businessUnits', BUSINESS, ...parts];

    await assertSucceeds(getDoc(doc(ownerDb, ...unitPath())));
    await assertFails(setDoc(doc(ownerDb, ...unitPath()), unit(OWNER, BUSINESS)));
    await assertSucceeds(getDoc(doc(ownerDb, ...unitPath('products', 'product-a'))));
    await assertFails(deleteDoc(doc(ownerDb, ...unitPath('products', 'product-a'))));
    await assertFails(getDoc(doc(attackerDb, ...unitPath('products', 'product-a'))));
    await assertFails(getDoc(doc(revokedDb, ...unitPath('products', 'product-a'))));
    await assertFails(getDoc(doc(attackerDb, 'businesses', OWNER, 'state', 'main')));

    const inviteRef = doc(ownerDb, 'businesses', OWNER, 'invitations', INVITE_HASH);
    await assertSucceeds(setDoc(inviteRef, {
      inviteHash:INVITE_HASH, email:WORKER_EMAIL, name:'QA Cashier', role:'cashier', permissions:permissions('cashier'),
      ownerId:OWNER, businessId:OWNER, businessUnitId:BUSINESS, tenantKey:`owner:${OWNER}:business:${OWNER}`, status:'pending', expiresAfterDays:7,
      singleUse:true, createdAt:serverTimestamp(), createdBy:OWNER, appVersion:'16.2.0'
    }));
    await assertSucceeds(runTransaction(workerDb, async (transaction) => {
      const workerInviteRef = doc(workerDb, 'businesses', OWNER, 'invitations', INVITE_HASH);
      const snapshot = await transaction.get(workerInviteRef);
      assert(snapshot.exists(), 'worker reads only its exact invitation');
      transaction.set(doc(workerDb, 'businesses', OWNER, 'members', WORKER), rootMember(WORKER, WORKER_EMAIL, 'cashier', permissions('cashier')));
      transaction.set(doc(workerDb, 'approvedUsers', WORKER), approvedWorker(WORKER, WORKER_EMAIL, 'cashier', permissions('cashier')));
      transaction.update(workerInviteRef, { status:'accepted', acceptedBy:WORKER, acceptedAt:serverTimestamp(), consumed:true });
    }));
    const acceptBatch = writeBatch(workerDb);
    acceptBatch.set(doc(workerDb, ...unitPath('members', WORKER)), boundaryRecord(
      OWNER, BUSINESS, 'members', WORKER, WORKER,
      { uid:WORKER, email:WORKER_EMAIL, role:'cashier', permissions:permissions('cashier'), status:'active' }
    ));
    acceptBatch.update(doc(workerDb, ...unitPath('entitlement', 'seats')), {
      activeMembers:5, lastActionUid:WORKER, updatedBy:WORKER, updatedAt:serverTimestamp()
    });
    await assertSucceeds(acceptBatch.commit());

    const saleRef = doc(workerDb, ...unitPath('sales', 'sale-worker-1'));
    const saleBatch = writeBatch(workerDb);
    saleBatch.set(saleRef, boundaryRecord(OWNER, BUSINESS, 'sales', 'sale-worker-1', WORKER, {
      actorUid:WORKER, status:'paid', total:5, received:5,
      items:[{ productId:'product-a', qty:1, price:5, total:5 }], stockDeltas:{ 'product-a':1 }
    }));
    saleBatch.update(doc(workerDb, ...unitPath('products', 'product-a')), {
      stock:9, lastOperationId:'sale-worker-1', recordVersion:2, updatedBy:WORKER, updatedAt:serverTimestamp()
    });
    await assertSucceeds(saleBatch.commit());
    await assertSucceeds(getDoc(saleRef));
    await assertFails(updateDoc(saleRef, { total:99, recordVersion:2, updatedBy:WORKER, updatedAt:serverTimestamp() }));
    await assertFails(updateDoc(doc(workerDb, ...unitPath('products', 'product-a')), {
      stock:8, recordVersion:3, updatedBy:WORKER, updatedAt:serverTimestamp()
    }));

    const layawayRef = doc(workerDb, ...unitPath('layaways', 'layaway-worker-1'));
    await assertSucceeds(setDoc(layawayRef, boundaryRecord(OWNER, BUSINESS, 'layaways', 'layaway-worker-1', WORKER, {
      actorUid:WORKER, status:'active', total:20, paid:5, balance:15, payments:[]
    })));
    await assertSucceeds(updateDoc(layawayRef, {
      payments:[{ id:'payment-1', amount:5 }], paid:10, balance:10, status:'active',
      recordVersion:2, updatedBy:WORKER, updatedAt:serverTimestamp()
    }));

    const cashRef = doc(workerDb, ...unitPath('cashSessions', 'cash-worker-1'));
    await assertSucceeds(setDoc(cashRef, boundaryRecord(OWNER, BUSINESS, 'cashSessions', 'cash-worker-1', WORKER, {
      actorUid:WORKER, status:'open', openingAmount:25
    })));
    await assertSucceeds(updateDoc(cashRef, {
      status:'closed', closedAt:'2026-08-18T12:00:00.000Z', closedBy:WORKER, countedCash:30,
      expectedCash:30, difference:0, reportId:'report-1', observations:'QA', recordVersion:2,
      updatedBy:WORKER, updatedAt:serverTimestamp()
    }));

    const movementRef = doc(workerDb, ...unitPath('movements', 'movement-worker-1'));
    await assertSucceeds(setDoc(movementRef, boundaryRecord(OWNER, BUSINESS, 'movements', 'movement-worker-1', WORKER, {
      actorUid:WORKER, type:'income', amount:5
    })));
    await assertFails(updateDoc(movementRef, { amount:500 }));
    const auditRef = doc(workerDb, ...unitPath('auditEvents', 'audit-worker-1'));
    await assertSucceeds(setDoc(auditRef, boundaryRecord(OWNER, BUSINESS, 'auditEvents', 'audit-worker-1', WORKER, {
      actorUid:WORKER, action:'sale_created', entityType:'sale', entityId:'sale-worker-1'
    })));
    await assertFails(getDoc(auditRef));
    await assertSucceeds(getDoc(doc(ownerDb, ...unitPath('auditEvents', 'audit-worker-1'))));

    await assertSucceeds(setDoc(doc(supervisorDb, ...unitPath('products', 'product-supervisor')), boundaryRecord(
      OWNER, BUSINESS, 'products', 'product-supervisor', 'supervisor-a', { name:'Producto supervisor', stock:3, price:2 }
    )));
    await assertSucceeds(updateDoc(doc(supervisorDb, ...unitPath('products', 'product-supervisor')), {
      stock:2, recordVersion:2, updatedBy:'supervisor-a', updatedAt:serverTimestamp()
    }));
    await assertSucceeds(getDocs(collection(supervisorDb, ...unitPath('auditEvents'))));

    // Regression: firestore.rules scopes businessUnits/{id}/settings reads to
    // the single document id "main" (recordId == "main"), unlike every other
    // module which is a normal multi-record collection. Firestore's rules
    // engine rejects an unfiltered collection list() unless it can prove
    // every possible result satisfies the rule -- an id-scoped rule never
    // allows that proof for a generic list, so the list is denied even
    // though the collection only ever contains one document. This is exactly
    // the P0 bug found live during the Phase 3.1 owner smoke test: gateway
    // pull() called the generic collection.get() for every module including
    // settings, so a real worker's very first login after accepting an
    // invite failed with permission-denied. readModule('settings') in
    // worker-data-boundary.js now reads doc('main') directly instead.
    await assertFails(getDocs(collection(workerDb, ...unitPath('settings'))));
    await assertSucceeds(getDoc(doc(workerDb, ...unitPath('settings', 'main'))));

    await assertSucceeds(getDoc(doc(sellerDb, ...unitPath('products', 'product-a'))));
    await assertFails(setDoc(doc(sellerDb, ...unitPath('products', 'product-seller')), boundaryRecord(
      OWNER, BUSINESS, 'products', 'product-seller', 'seller-a', { name:'No autorizado', stock:1, price:1 }
    )));
    await assertSucceeds(setDoc(doc(sellerDb, ...unitPath('sales', 'sale-seller-service')), boundaryRecord(
      OWNER, BUSINESS, 'sales', 'sale-seller-service', 'seller-a', { actorUid:'seller-a', status:'paid', total:3, items:[], stockDeltas:{} }
    )));

    await assertSucceeds(setDoc(doc(adminDb, ...unitPath('products', 'product-admin')), boundaryRecord(
      OWNER, BUSINESS, 'products', 'product-admin', 'admin-a', { name:'Producto admin', stock:2, price:3 }
    )));
    await assertSucceeds(updateDoc(doc(adminDb, ...unitPath('members', 'seller-a')), {
      role:'cashier', recordVersion:2, updatedBy:'admin-a', updatedAt:serverTimestamp()
    }));

    await assertSucceeds(updateDoc(doc(inventoryDb, ...unitPath('products', 'product-a')), {
      stock:8, recordVersion:3, updatedBy:'inventory-a', updatedAt:serverTimestamp()
    }));
    await assertFails(setDoc(doc(inventoryDb, ...unitPath('sales', 'sale-inventory')), boundaryRecord(
      OWNER, BUSINESS, 'sales', 'sale-inventory', 'inventory-a', { actorUid:'inventory-a', total:1 }
    )));
    await assertFails(getDoc(doc(workerDb, 'businesses', OTHER_OWNER, 'businessUnits', OTHER_BUSINESS, 'products', 'anything')));
    await assertFails(setDoc(doc(workerDb, 'businesses', 'demo-click360', 'businessUnits', BUSINESS, 'sales', 'demo-sale'), boundaryRecord(
      'demo-click360', BUSINESS, 'sales', 'demo-sale', WORKER, { actorUid:WORKER, total:1 }
    )));

    const revoke = writeBatch(ownerDb);
    revoke.update(doc(ownerDb, ...unitPath('members', WORKER)), {
      status:'revoked', recordVersion:2, updatedBy:OWNER, updatedAt:serverTimestamp(), revokedBy:OWNER, revokedAt:serverTimestamp()
    });
    revoke.update(doc(ownerDb, 'businesses', OWNER, 'members', WORKER), {
      status:'revoked', updatedAt:serverTimestamp(), updatedBy:OWNER, revokedAt:serverTimestamp(), revokedBy:OWNER
    });
    revoke.update(doc(ownerDb, ...unitPath('entitlement', 'seats')), {
      activeMembers:4, lastActionUid:WORKER, updatedBy:OWNER, updatedAt:serverTimestamp()
    });
    await assertSucceeds(revoke.commit());
    await assertFails(getDoc(doc(workerDb, ...unitPath('products', 'product-a'))));
    await assertFails(setDoc(doc(workerDb, ...unitPath('sales', 'sale-after-revoke')), boundaryRecord(
      OWNER, BUSINESS, 'sales', 'sale-after-revoke', WORKER, { actorUid:WORKER, total:1 }
    )));

    await assertFails(getDoc(doc(workerDb, 'businesses', OWNER, 'state', 'main')));

    // ── P0 commercial rule: 2 free worker seats + parametrizable paid add-on ─
    const SEAT_OWNER = 'owner-seats';
    const SEAT_BUSINESS = 'business-seats';
    const CROSS_OWNER = 'owner-seats-cross';
    const CROSS_BUSINESS = 'business-seats-cross';
    const seatWorkers = ['seat-w0', 'seat-w1', 'seat-w2', 'seat-w3', 'seat-w4'];
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'approvedUsers', SEAT_OWNER), ownerProfile(SEAT_OWNER));
      await setDoc(doc(db, 'businesses', SEAT_OWNER, 'businessUnits', SEAT_BUSINESS), unit(SEAT_OWNER, SEAT_BUSINESS));
      await setDoc(doc(db, 'businesses', SEAT_OWNER, 'businessUnits', SEAT_BUSINESS, 'entitlement', 'seats'), seats(SEAT_OWNER, SEAT_BUSINESS));
      await setDoc(doc(db, 'approvedUsers', CROSS_OWNER), ownerProfile(CROSS_OWNER));
      await setDoc(doc(db, 'businesses', CROSS_OWNER, 'businessUnits', CROSS_BUSINESS), unit(CROSS_OWNER, CROSS_BUSINESS));
      await setDoc(doc(db, 'businesses', CROSS_OWNER, 'businessUnits', CROSS_BUSINESS, 'entitlement', 'seats'), seats(CROSS_OWNER, CROSS_BUSINESS));
      for (const uid of [...seatWorkers, 'cross-w1', 'cross-w2', 'cross-w3']) {
        await setDoc(doc(db, 'businesses', uid.startsWith('cross') ? CROSS_OWNER : SEAT_OWNER, 'members', uid), {
          uid, email:`${uid}@example.test`, name:'QA Seat Worker', role:'seller', permissions:permissions('seller'),
          status:'active', ownerId:uid.startsWith('cross') ? CROSS_OWNER : SEAT_OWNER, businessId:uid.startsWith('cross') ? CROSS_OWNER : SEAT_OWNER,
          businessUnitId:uid.startsWith('cross') ? CROSS_BUSINESS : SEAT_BUSINESS,
          tenantKey:`owner:${uid.startsWith('cross') ? CROSS_OWNER : SEAT_OWNER}:business:${uid.startsWith('cross') ? CROSS_OWNER : SEAT_OWNER}`,
          invitationHash:'x'.repeat(64), acceptedAt:new Date(), lastAccessAt:new Date()
        });
      }
    });
    const seatOwnerDb = env.authenticatedContext(SEAT_OWNER, { email:`${SEAT_OWNER}@example.test` }).firestore();
    const crossOwnerDb = env.authenticatedContext(CROSS_OWNER, { email:`${CROSS_OWNER}@example.test` }).firestore();
    const seatUnitPath = (...parts) => ['businesses', SEAT_OWNER, 'businessUnits', SEAT_BUSINESS, ...parts];
    const crossUnitPath = (...parts) => ['businesses', CROSS_OWNER, 'businessUnits', CROSS_BUSINESS, ...parts];

    async function activateSeatMember(actorDb, unitPathFn, uid, expectedBefore) {
      const batch = writeBatch(actorDb);
      batch.set(doc(actorDb, ...unitPathFn('members', uid)), boundaryRecord(
        unitPathFn === seatUnitPath ? SEAT_OWNER : CROSS_OWNER, unitPathFn === seatUnitPath ? SEAT_BUSINESS : CROSS_BUSINESS,
        'members', uid, uid, { uid, email:`${uid}@example.test`, role:'seller', permissions:permissions('seller'), status:'active' }
      ));
      batch.update(doc(actorDb, ...unitPathFn('entitlement', 'seats')), {
        activeMembers:expectedBefore + 1, lastActionUid:uid, updatedBy:uid, updatedAt:serverTimestamp()
      });
      return batch.commit();
    }

    // Regression: a first-time acceptor (not yet a member, not the owner) can
    // NEVER read entitlement/seats directly -- firestore.rules only grants
    // read to the owner or an already-active member. acceptInvitationFromUrl
    // in firebase-service.js must therefore consume the seat with a blind
    // FieldValue.increment(1) write (no prior transaction.get on the seat
    // doc), which the write-time rule (seatConsumedForSelf) independently
    // re-verifies at commit. This reproduces exactly the P0 bug found during
    // live staging QA (E2E owner smoke test) and locks in the fix.
    const seatW0Db = env.authenticatedContext('seat-w0', { email:'seat-w0@example.test' }).firestore();
    await assertFails(getDoc(doc(seatW0Db, ...seatUnitPath('entitlement', 'seats'))));
    const firstTimeAcceptBatch = writeBatch(seatW0Db);
    firstTimeAcceptBatch.set(doc(seatW0Db, ...seatUnitPath('members', 'seat-w0')), boundaryRecord(
      SEAT_OWNER, SEAT_BUSINESS, 'members', 'seat-w0', 'seat-w0', { uid:'seat-w0', email:'seat-w0@example.test', role:'seller', permissions:permissions('seller'), status:'active' }
    ));
    firstTimeAcceptBatch.update(doc(seatW0Db, ...seatUnitPath('entitlement', 'seats')), {
      activeMembers:increment(1), lastActionUid:'seat-w0', updatedBy:'seat-w0', updatedAt:serverTimestamp()
    });
    await assertSucceeds(firstTimeAcceptBatch.commit());
    const seatsAfterFirstTimeAccept = await getDoc(doc(seatOwnerDb, ...seatUnitPath('entitlement', 'seats')));
    assert.strictEqual(seatsAfterFirstTimeAccept.data().activeMembers, 1, 'blind increment(1) by a first-time acceptor must land correctly with no prior read');

    // Revoke seat-w0 so the numbered scenarios below start from a clean 0/2.
    const seatW0Revoke = writeBatch(seatOwnerDb);
    seatW0Revoke.update(doc(seatOwnerDb, ...seatUnitPath('members', 'seat-w0')), {
      status:'revoked', recordVersion:2, updatedBy:SEAT_OWNER, updatedAt:serverTimestamp(), revokedBy:SEAT_OWNER, revokedAt:serverTimestamp()
    });
    seatW0Revoke.update(doc(seatOwnerDb, ...seatUnitPath('entitlement', 'seats')), {
      activeMembers:0, lastActionUid:'seat-w0', updatedBy:SEAT_OWNER, updatedAt:serverTimestamp()
    });
    await assertSucceeds(seatW0Revoke.commit());

    // Scenario 1: owner + 2 workers (seat-w1, seat-w2) = allowed (baseSeatCap=2, addOnSeats=0).
    const seatW1Db = env.authenticatedContext('seat-w1', { email:'seat-w1@example.test' }).firestore();
    const seatW2Db = env.authenticatedContext('seat-w2', { email:'seat-w2@example.test' }).firestore();
    const seatW3Db = env.authenticatedContext('seat-w3', { email:'seat-w3@example.test' }).firestore();
    const seatW4Db = env.authenticatedContext('seat-w4', { email:'seat-w4@example.test' }).firestore();
    await assertSucceeds(activateSeatMember(seatW1Db, seatUnitPath, 'seat-w1', 0));
    await assertSucceeds(activateSeatMember(seatW2Db, seatUnitPath, 'seat-w2', 1));

    // Scenario 2: worker #3 without an add-on = DENY (2/2 seats already in use).
    await assertFails(activateSeatMember(seatW3Db, seatUnitPath, 'seat-w3', 2));
    const deniedThirdMember = await getDoc(doc(seatOwnerDb, ...seatUnitPath('members', 'seat-w3')));
    assert.strictEqual(deniedThirdMember.exists(), false, 'worker #3 must not have been created when the seat cap was full');

    // Scenario 3: owner purchases +1 add-on seat (parametrizable, no price enforced here) → worker #3 now allowed.
    await assertSucceeds(updateDoc(doc(seatOwnerDb, ...seatUnitPath('entitlement', 'seats')), {
      addOnSeats:1, updatedBy:SEAT_OWNER, updatedAt:serverTimestamp()
    }));
    await assertSucceeds(activateSeatMember(seatW3Db, seatUnitPath, 'seat-w3', 2));
    // Capacity is now exactly full again (3/3): a 4th worker must still be denied.
    await assertFails(activateSeatMember(seatW4Db, seatUnitPath, 'seat-w4', 3));

    // Scenario 4: revoking a worker frees its seat for the next activation.
    const seatRevoke = writeBatch(seatOwnerDb);
    seatRevoke.update(doc(seatOwnerDb, ...seatUnitPath('members', 'seat-w1')), {
      status:'revoked', recordVersion:2, updatedBy:SEAT_OWNER, updatedAt:serverTimestamp(), revokedBy:SEAT_OWNER, revokedAt:serverTimestamp()
    });
    seatRevoke.update(doc(seatOwnerDb, ...seatUnitPath('entitlement', 'seats')), {
      activeMembers:2, lastActionUid:'seat-w1', updatedBy:SEAT_OWNER, updatedAt:serverTimestamp()
    });
    await assertSucceeds(seatRevoke.commit());
    await assertSucceeds(activateSeatMember(seatW4Db, seatUnitPath, 'seat-w4', 2));

    // A "phantom" seat release (decrementing the counter without revoking any
    // member in the same write) must be rejected: lastActionUid still points
    // at the last real activation (seat-w4), which never actually revokes.
    await assertFails(updateDoc(doc(seatOwnerDb, ...seatUnitPath('entitlement', 'seats')), {
      activeMembers:2, updatedBy:SEAT_OWNER, updatedAt:serverTimestamp()
    }));
    const untamperedSeats = await getDoc(doc(seatOwnerDb, ...seatUnitPath('entitlement', 'seats')));
    assert.strictEqual(untamperedSeats.data().activeMembers, 3, 'a standalone counter write must never change activeMembers without a paired member transition');

    // Scenario 5: cross-tenant tenants never share the seat pool. Filling CROSS_BUSINESS
    // to its own 2-seat cap must not be affected by, or affect, SEAT_BUSINESS's cap.
    const crossW1Db = env.authenticatedContext('cross-w1', { email:'cross-w1@example.test' }).firestore();
    const crossW2Db = env.authenticatedContext('cross-w2', { email:'cross-w2@example.test' }).firestore();
    const crossW3Db = env.authenticatedContext('cross-w3', { email:'cross-w3@example.test' }).firestore();
    await assertSucceeds(activateSeatMember(crossW1Db, crossUnitPath, 'cross-w1', 0));
    await assertSucceeds(activateSeatMember(crossW2Db, crossUnitPath, 'cross-w2', 1));
    await assertFails(activateSeatMember(crossW3Db, crossUnitPath, 'cross-w3', 2));
    // A worker authenticated in one tenant cannot spend the OTHER tenant's seats either.
    await assertFails(activateSeatMember(seatW1Db, crossUnitPath, 'seat-w1', 2));
    const crossSeatsAfter = await getDoc(doc(crossOwnerDb, ...crossUnitPath('entitlement', 'seats')));
    assert.strictEqual(crossSeatsAfter.data().activeMembers, 2, 'cross-tenant seat pool must stay untouched by the other tenant');
    const seatBusinessSeatsAfter = await getDoc(doc(seatOwnerDb, ...seatUnitPath('entitlement', 'seats')));
    assert.strictEqual(seatBusinessSeatsAfter.data().activeMembers, 3, 'SEAT_BUSINESS pool must be unaffected by CROSS_BUSINESS activity');

    console.log('PASS worker boundary emulator: invite, accept, module permissions, sale, layaway payment, cash, audit, revoke, tenant isolation and 2-seat entitlement (deny #3, +1 add-on, revoke frees seat, no cross-tenant sharing)');
  } finally {
    await env.cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
