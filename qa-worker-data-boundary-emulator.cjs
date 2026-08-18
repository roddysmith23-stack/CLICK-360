const assert = require('assert');
const fs = require('fs');
const { assertFails, assertSucceeds, initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { collection, deleteDoc, doc, getDoc, getDocs, runTransaction, serverTimestamp, setDoc, updateDoc, writeBatch } = require('firebase/firestore');

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
    await assertSucceeds(setDoc(doc(workerDb, ...unitPath('members', WORKER)), boundaryRecord(
      OWNER, BUSINESS, 'members', WORKER, WORKER,
      { uid:WORKER, email:WORKER_EMAIL, role:'cashier', permissions:permissions('cashier'), status:'active' }
    )));

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
    await assertSucceeds(revoke.commit());
    await assertFails(getDoc(doc(workerDb, ...unitPath('products', 'product-a'))));
    await assertFails(setDoc(doc(workerDb, ...unitPath('sales', 'sale-after-revoke')), boundaryRecord(
      OWNER, BUSINESS, 'sales', 'sale-after-revoke', WORKER, { actorUid:WORKER, total:1 }
    )));

    await assertFails(getDoc(doc(workerDb, 'businesses', OWNER, 'state', 'main')));
    console.log('PASS worker boundary emulator: invite, accept, module permissions, sale, layaway payment, cash, audit, revoke and tenant isolation');
  } finally {
    await env.cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
