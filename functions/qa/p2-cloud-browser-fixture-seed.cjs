'use strict';

const { mkdir, writeFile } = require('node:fs/promises');
const { getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const projectId = process.env.GCLOUD_PROJECT || 'demo-click360-p2-staging';
const output = process.env.CLICK360_P2_BROWSER_FIXTURE || 'output/p2-cloud-browser-fixture.json';
const runId = String(process.env.P2_BROWSER_RUN || 'default').replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'default';
if (!getApps().length) initializeApp({ projectId });

const permissions = {
  owner: ['business.read', 'business.manage', 'inventory.read', 'inventory.write', 'sales.create', 'sales.read', 'sales.cancel', 'cash.open', 'cash.close', 'cash.read', 'reports.read', 'labels.read', 'labels.write', 'tables.read', 'tables.write', 'orders.create', 'orders.update', 'orders.cancel', 'kitchen.read', 'kitchen.update', 'routes.read', 'routes.write', 'collections.read', 'collections.write', 'members.read', 'members.manage', 'settings.read', 'settings.manage'],
  server: ['business.read', 'tables.read', 'tables.write', 'orders.create', 'orders.update'],
  kitchen: ['business.read', 'kitchen.read', 'kitchen.update'],
  cashier: ['business.read', 'sales.create', 'sales.read', 'cash.open', 'cash.close', 'cash.read'],
  beta: ['business.read', 'business.manage', 'sales.create', 'sales.read', 'cash.read', 'members.read', 'members.manage', 'settings.read', 'settings.manage']
};

async function customToken(uid, email) {
  try { await getAuth().createUser({ uid, email }); } catch (error) {
    if (error.code !== 'auth/uid-already-exists' && error.code !== 'auth/email-already-exists') throw error;
  }
  return getAuth().createCustomToken(uid);
}

async function main() {
  const db = getFirestore();
  const businessId = 'biz-browser-' + runId + '-alpha';
  const otherBusinessId = 'biz-browser-' + runId + '-beta';
  await db.collection('businesses').doc(businessId).set({ schemaFamily: 'p2', businessId, status: 'active', version: 1 });
  await db.collection('businesses').doc(otherBusinessId).set({ schemaFamily: 'p2', businessId: otherBusinessId, status: 'active', version: 1 });
  const identities = { owner: ['owner-browser', 'owner'], server: ['server-browser', 'server'], kitchen: ['kitchen-browser', 'kitchen'], cashier: ['cashier-browser', 'cashier'], beta: ['beta-browser', 'beta'] };
  for (const [role, [uid, roleId]] of Object.entries(identities)) {
    const targetBusiness = role === 'beta' ? otherBusinessId : businessId;
    await db.collection('businesses').doc(targetBusiness).collection('members').doc(uid).set({
      schemaFamily: 'p2', uid, businessId: targetBusiness, roleId: roleId === 'beta' ? 'owner' : roleId,
      permissions: permissions[roleId], status: 'active', version: 1, createdBy: 'fixture', updatedBy: 'fixture', createdAt: new Date(), updatedAt: new Date()
    });
  }
  await db.collection('businesses').doc(businessId).collection('featureConfig').doc('main').set({
    schemaFamily: 'p2', businessId, status: 'active', plan: 'pro', modules: { core: true, restaurant: true, logistics: false, workers: false },
    featureFlags: { restaurantAdvancedEnabled: { key: 'restaurantAdvancedEnabled', enabled: true, allowedBusinessIds: [businessId], allowedUids: [], rolloutPercentage: 100, killSwitch: false } },
    version: 1, createdBy: 'fixture', updatedBy: 'fixture', createdAt: new Date(), updatedAt: new Date()
  });
  const tokens = {};
  const uids = {};
  const businessIds = {};
  for (const [role, [uid]] of Object.entries(identities)) {
    tokens[role] = await customToken(uid, role + '@p2-browser.invalid');
    uids[role] = uid;
    // beta actor tiene membresía en otherBusinessId (negocio B), no en businessId
    businessIds[role] = role === 'beta' ? otherBusinessId : businessId;
  }
  await mkdir('output', { recursive: true });
  await writeFile(output, JSON.stringify({ businessId, otherBusinessId, tokens, uids, businessIds }), { mode: 0o600 });
  console.log('P2 cloud browser fixture seeded');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
