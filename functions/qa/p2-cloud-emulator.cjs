'use strict';

const assert = require('node:assert/strict');
const { initializeApp, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const projectId = process.env.GCLOUD_PROJECT || 'demo-click360-p2-staging';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const functionsOrigin = 'http://127.0.0.1:5001/' + projectId + '/us-central1';
if (!getApps().length) initializeApp({ projectId });

function permissions(role) {
  return role === 'owner'
    ? ['members.read', 'members.manage', 'settings.read', 'settings.manage', 'business.read']
    : role === 'admin'
      ? ['members.read', 'members.manage', 'settings.read', 'settings.manage', 'business.read']
      : role === 'server'
        ? ['tables.read', 'tables.write', 'orders.create', 'orders.update', 'business.read']
        : [];
}
async function userToken(uid, email) {
  try { await getAuth().createUser({ uid, email }); } catch (error) {
    if (error.code !== 'auth/uid-already-exists' && error.code !== 'auth/email-already-exists') throw error;
  }
  const customToken = await getAuth().createCustomToken(uid);
  const response = await fetch('http://' + authHost + '/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  });
  const body = await response.json();
  if (!response.ok) throw new Error('auth_emulator_token_failed:' + JSON.stringify(body));
  return body.idToken;
}
async function call(action, token, payload, idempotencyKey) {
  const response = await fetch(functionsOrigin + '/' + action, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ payload, idempotencyKey })
  });
  const body = await response.json();
  return { status: response.status, body };
}

async function main() {
  const db = getFirestore();
  const businessId = 'biz-cloud-alpha';
  await db.collection('businesses').doc(businessId).set({ businessId, schemaFamily: 'p2', status: 'active', version: 1 });
  await db.collection('businesses').doc(businessId).collection('members').doc('owner-cloud').set({
    schemaFamily: 'p2', uid: 'owner-cloud', businessId, roleId: 'owner', permissions: permissions('owner'), status: 'active', version: 1,
    createdBy: 'seed', updatedBy: 'seed', createdAt: new Date(), updatedAt: new Date()
  });
  await db.collection('businesses').doc(businessId).collection('members').doc('server-cloud').set({
    schemaFamily: 'p2', uid: 'server-cloud', businessId, roleId: 'server', permissions: permissions('server'), status: 'active', version: 1,
    createdBy: 'seed', updatedBy: 'seed', createdAt: new Date(), updatedAt: new Date()
  });
  const ownerToken = await userToken('owner-cloud', 'owner-cloud@example.test');
  const serverToken = await userToken('server-cloud', 'server-cloud@example.test');
  const workerToken = await userToken('worker-cloud', 'worker-cloud@example.test');

  const modules = await call('updateBusinessModules', ownerToken, {
    businessId,
    modules: { workers: true, restaurant: true, logistics: true },
    featureFlags: {
      workerAccessEnabled: { enabled: true, allowedUids: ['owner-cloud'], rolloutPercentage: 100 },
      restaurantAdvancedEnabled: { enabled: true, rolloutPercentage: 100 },
      logisticsEnabled: { enabled: false, killSwitch: true, rolloutPercentage: 0 }
    }
  }, 'modules_cloud_0001');
  assert.equal(modules.status, 200);
  assert.equal(modules.body.result.noop, false);
  const modulesRepeat = await call('updateBusinessModules', ownerToken, {
    businessId,
    modules: { workers: true, restaurant: true, logistics: true }
  }, 'modules_cloud_0001');
  assert.equal(modulesRepeat.status, 200);
  assert.equal(modulesRepeat.body.result.noop, true);

  const invite = await call('inviteWorker', ownerToken, {
    businessId, email: 'worker-cloud@example.test', roleId: 'server'
  }, 'invite_cloud_0001');
  assert.equal(invite.status, 200);
  assert.equal(typeof invite.body.result.invitationToken, 'string');
  const invitationId = invite.body.result.invitationId;
  const invitation = await db.collection('businesses').doc(businessId).collection('invitations').doc(invitationId).get();
  assert.equal(invitation.data().token, undefined);
  assert.equal(typeof invitation.data().tokenHash, 'string');

  const accepted = await call('acceptInvitation', workerToken, {
    businessId, invitationId, token: invite.body.result.invitationToken
  }, 'accept_cloud_0001');
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.result.membership.status, 'active');
  const acceptedAgain = await call('acceptInvitation', workerToken, {
    businessId, invitationId, token: invite.body.result.invitationToken
  }, 'accept_cloud_0001');
  assert.equal(acceptedAgain.status, 200);
  assert.equal(acceptedAgain.body.result.noop, true);

  const rejected = await call('updateBusinessModules', serverToken, {
    businessId, modules: { workers: false }
  }, 'server_cloud_0001');
  assert.equal(rejected.status, 403);
  assert.equal(rejected.body.code, 'permission_denied:settings.manage');

  const suspended = await call('suspendUser', ownerToken, {
    businessId, targetUid: 'worker-cloud'
  }, 'suspend_cloud_0001');
  assert.equal(suspended.status, 200);
  const inspect = await call('inspectUserAccess', ownerToken, {
    businessId, targetUid: 'worker-cloud'
  }, 'inspect_cloud_0001');
  assert.equal(inspect.status, 200);
  assert.equal(inspect.body.result.membership.status, 'suspended');

  const audit = await db.collection('businesses').doc(businessId).collection('p2AuditLogs').get();
  const idempotency = await db.collection('businesses').doc(businessId).collection('p2Idempotency').get();
  assert.ok(audit.size >= 4);
  assert.ok(idempotency.size >= 4);
  console.log('P2 cloud Functions/Auth/Firestore emulator: PASS');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
