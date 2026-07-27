'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} = require('@firebase/rules-unit-testing');
const {
  doc,
  getDoc,
  setDoc,
  updateDoc
} = require('firebase/firestore');

const PROJECT_ID = 'demo-click360-p2-staging';
const RULES = fs.readFileSync('firestore.p2.staging.rules', 'utf8');

const permissions = {
  owner: ['business.read', 'business.manage', 'inventory.read', 'inventory.write', 'sales.create', 'sales.read', 'sales.cancel', 'cash.open', 'cash.close', 'cash.read', 'reports.read', 'labels.read', 'labels.write', 'tables.read', 'tables.write', 'orders.create', 'orders.update', 'kitchen.read', 'kitchen.update', 'routes.read', 'routes.write', 'collections.read', 'collections.write', 'members.read', 'members.manage', 'settings.read', 'settings.manage'],
  admin: ['business.read', 'tables.read', 'tables.write', 'orders.create', 'orders.update', 'members.read', 'members.manage', 'settings.read', 'settings.manage'],
  server: ['business.read', 'tables.read', 'tables.write', 'orders.create', 'orders.update'],
  kitchen: ['business.read', 'kitchen.read', 'kitchen.update'],
  cashier: ['business.read', 'sales.create', 'sales.read', 'cash.open', 'cash.close', 'cash.read'],
  routeSeller: ['business.read', 'routes.read', 'routes.write', 'sales.create', 'sales.read'],
  collector: ['business.read', 'collections.read', 'collections.write'],
  readonly: ['business.read', 'inventory.read', 'sales.read', 'reports.read', 'cash.read', 'labels.read', 'tables.read', 'routes.read', 'collections.read', 'settings.read']
};

function member(uid, businessId, roleId, status = 'active') {
  return {
    schemaFamily: 'p2',
    uid,
    businessId,
    roleId,
    permissions: permissions[roleId] || [],
    status,
    version: 1,
    createdBy: 'seed',
    updatedBy: 'seed',
    createdAt: 1,
    updatedAt: 1
  };
}
function p2Doc(businessId, createdBy = 'owner-a') {
  return {
    schemaFamily: 'p2',
    businessId,
    createdBy,
    updatedBy: createdBy,
    createdAt: 1,
    updatedAt: 1,
    status: 'active',
    version: 1
  };
}
function device(businessId, uid) {
  return {
    schemaFamily: 'p2',
    businessId,
    uid,
    deviceName: 'QA device',
    status: 'active',
    version: 1,
    createdBy: uid,
    updatedBy: uid,
    createdAt: 1,
    updatedAt: 1,
    lastSeenAt: 1
  };
}

async function main() {
  const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: RULES }
  });
  try {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const bizA = doc(db, 'businesses', 'biz-alpha');
      const bizB = doc(db, 'businesses', 'biz-bravo');
      await setDoc(bizA, p2Doc('biz-alpha'));
      await setDoc(bizB, p2Doc('biz-bravo', 'owner-b'));
      for (const [uid, role] of [
        ['owner-a', 'owner'], ['admin-a', 'admin'], ['server-a', 'server'], ['kitchen-a', 'kitchen'],
        ['cashier-a', 'cashier'], ['seller-a', 'routeSeller'], ['collector-a', 'collector'],
        ['readonly-a', 'readonly'], ['revoked-a', 'server']
      ]) {
        await setDoc(doc(db, 'businesses', 'biz-alpha', 'members', uid), member(uid, 'biz-alpha', role, uid === 'revoked-a' ? 'revoked' : 'active'));
      }
      await setDoc(doc(db, 'businesses', 'biz-bravo', 'members', 'owner-b'), member('owner-b', 'biz-bravo', 'owner'));
      await setDoc(doc(db, 'businesses', 'biz-alpha', 'featureConfig', 'main'), {
        ...p2Doc('biz-alpha'),
        plan: 'pro',
        modules: { core: true, workers: true, restaurant: true, logistics: true },
        featureFlags: { workerAccessEnabled: { enabled: true } }
      });
      await setDoc(doc(db, 'businesses', 'biz-alpha', 'restaurantOrders', 'order-a'), { ...p2Doc('biz-alpha'), tableId: 't-1', serverId: 'server-a', total: 12 });
      await setDoc(doc(db, 'businesses', 'biz-bravo', 'restaurantOrders', 'order-b'), { ...p2Doc('biz-bravo', 'owner-b'), tableId: 't-2', total: 9 });
      await setDoc(doc(db, 'businesses', 'biz-alpha', 'restaurantPayments', 'payment-a'), { ...p2Doc('biz-alpha'), orderId: 'order-a', amount: 12 });
      await setDoc(doc(db, 'businesses', 'biz-alpha', 'routes', 'route-a'), { ...p2Doc('biz-alpha'), sellerId: 'seller-a' });
      await setDoc(doc(db, 'businesses', 'biz-alpha', 'collections', 'collection-a'), { ...p2Doc('biz-alpha'), routeId: 'route-a', collectorId: 'collector-a' });
      await setDoc(doc(db, 'businesses', 'biz-alpha', 'invitations', 'invite-pending'), {
        ...p2Doc('biz-alpha'), email: 'invitee@example.test', status: 'pending', tokenHash: 'a'.repeat(64), roleId: 'server', permissions: permissions.server
      });
      await setDoc(doc(db, 'businesses', 'biz-alpha', 'invitations', 'invite-revoked'), {
        ...p2Doc('biz-alpha'), email: 'revoked-invite@example.test', status: 'revoked', tokenHash: 'b'.repeat(64), roleId: 'server', permissions: permissions.server
      });
    });

    const owner = env.authenticatedContext('owner-a', { email: 'owner-a@example.test' }).firestore();
    const admin = env.authenticatedContext('admin-a', { email: 'admin-a@example.test' }).firestore();
    const server = env.authenticatedContext('server-a', { email: 'server-a@example.test' }).firestore();
    const kitchen = env.authenticatedContext('kitchen-a', { email: 'kitchen-a@example.test' }).firestore();
    const cashier = env.authenticatedContext('cashier-a', { email: 'cashier-a@example.test' }).firestore();
    const seller = env.authenticatedContext('seller-a', { email: 'seller-a@example.test' }).firestore();
    const collector = env.authenticatedContext('collector-a', { email: 'collector-a@example.test' }).firestore();
    const revoked = env.authenticatedContext('revoked-a', { email: 'revoked-a@example.test' }).firestore();
    const otherBusiness = env.authenticatedContext('owner-b', { email: 'owner-b@example.test' }).firestore();
    const invitee = env.authenticatedContext('invitee', { email: 'invitee@example.test' }).firestore();
    const revokedInvitee = env.authenticatedContext('revoked-invitee', { email: 'revoked-invite@example.test' }).firestore();
    const unauthenticated = env.unauthenticatedContext().firestore();

    await assertSucceeds(getDoc(doc(owner, 'businesses', 'biz-alpha', 'members', 'server-a')));
    await assertSucceeds(getDoc(doc(admin, 'businesses', 'biz-alpha', 'members', 'server-a')));
    await assertSucceeds(getDoc(doc(server, 'businesses', 'biz-alpha', 'members', 'server-a')));
    await assertFails(getDoc(doc(server, 'businesses', 'biz-alpha', 'members', 'cashier-a')));
    await assertFails(getDoc(doc(revoked, 'businesses', 'biz-alpha', 'members', 'revoked-a')));
    await assertFails(getDoc(doc(otherBusiness, 'businesses', 'biz-alpha', 'members', 'server-a')));
    await assertFails(getDoc(doc(unauthenticated, 'businesses', 'biz-alpha', 'members', 'server-a')));

    await assertSucceeds(getDoc(doc(server, 'businesses', 'biz-alpha', 'restaurantOrders', 'order-a')));
    await assertSucceeds(getDoc(doc(kitchen, 'businesses', 'biz-alpha', 'restaurantOrders', 'order-a')));
    await assertSucceeds(getDoc(doc(cashier, 'businesses', 'biz-alpha', 'restaurantPayments', 'payment-a')));
    await assertFails(getDoc(doc(server, 'businesses', 'biz-alpha', 'restaurantPayments', 'payment-a')));
    await assertFails(getDoc(doc(server, 'businesses', 'biz-bravo', 'restaurantOrders', 'order-b')));
    await assertFails(setDoc(doc(owner, 'businesses', 'biz-alpha', 'restaurantOrders', 'forged'), { ...p2Doc('biz-alpha'), tableId: 'forged' }));

    await assertSucceeds(getDoc(doc(seller, 'businesses', 'biz-alpha', 'routes', 'route-a')));
    await assertFails(getDoc(doc(seller, 'businesses', 'biz-alpha', 'collections', 'collection-a')));
    await assertSucceeds(getDoc(doc(collector, 'businesses', 'biz-alpha', 'collections', 'collection-a')));
    await assertFails(getDoc(doc(collector, 'businesses', 'biz-alpha', 'routes', 'route-a')));
    await assertFails(getDoc(doc(otherBusiness, 'businesses', 'biz-alpha', 'routes', 'route-a')));

    await assertSucceeds(getDoc(doc(invitee, 'businesses', 'biz-alpha', 'invitations', 'invite-pending')));
    await assertFails(getDoc(doc(revokedInvitee, 'businesses', 'biz-alpha', 'invitations', 'invite-revoked')));
    await assertFails(updateDoc(doc(server, 'businesses', 'biz-alpha', 'members', 'server-a'), { roleId: 'owner', status: 'active' }));
    await assertFails(updateDoc(doc(owner, 'businesses', 'biz-alpha', 'members', 'server-a'), { roleId: 'owner' }));

    const ownDevice = doc(server, 'businesses', 'biz-alpha', 'devices', 'device-server-a');
    await assertSucceeds(setDoc(ownDevice, device('biz-alpha', 'server-a')));
    await assertSucceeds(updateDoc(ownDevice, { deviceName: 'QA device updated', version: 2, updatedBy: 'server-a', updatedAt: 2 }));
    await assertFails(setDoc(doc(server, 'businesses', 'biz-alpha', 'devices', 'device-forged'), device('biz-alpha', 'owner-a')));
    await assertFails(getDoc(doc(otherBusiness, 'businesses', 'biz-alpha', 'devices', 'device-server-a')));
    await assertFails(getDoc(doc(owner, 'organizations', 'org-alpha')));

    console.log('P2 cloud Firestore Rules emulator: PASS');
  } finally {
    await env.cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
