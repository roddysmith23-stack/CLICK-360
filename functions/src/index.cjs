'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { initializeApp, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { randomUUID } = require('node:crypto');
const { createP2AdminService, P2Error, ACTIONS } = require('./p2-admin-service.cjs');

setGlobalOptions({ region: 'us-central1', maxInstances: 2 });
if (!getApps().length) initializeApp();

const buckets = new Map();
function projectId() {
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  try { return JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId || ''; } catch { return ''; }
}
function assertNonProduction() {
  const id = projectId();
  if (!id || id === 'click-360') throw new P2Error('non_production_project_required', 403);
  return id;
}
function originAllowed(origin) {
  if (!origin) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(origin)
    || /^https:\/\/[^/]*staging[^/]*$/i.test(origin);
}
function consumeRateLimit(uid, action) {
  const key = uid + ':' + action;
  const now = Date.now();
  const bucket = buckets.get(key) || { startedAt: now, count: 0 };
  if (now - bucket.startedAt > 60_000) {
    bucket.startedAt = now;
    bucket.count = 0;
  }
  bucket.count += 1;
  buckets.set(key, bucket);
  if (bucket.count > 60) throw new P2Error('rate_limited', 429);
}
function bearer(request) {
  const value = String(request.headers.authorization || '');
  if (!value.startsWith('Bearer ')) throw new P2Error('auth_required', 401);
  return value.slice(7);
}
async function invoke(request, response, fixedAction = '') {
  const requestId = randomUUID();
  try {
    if (request.method === 'OPTIONS') {
      response.status(204).set('access-control-allow-origin', request.headers.origin || '*')
        .set('access-control-allow-methods', 'POST, OPTIONS')
        .set('access-control-allow-headers', 'authorization, content-type').send('');
      return;
    }
    if (request.method !== 'POST') throw new P2Error('method_not_allowed', 405);
    if (!originAllowed(request.headers.origin)) throw new P2Error('origin_not_allowed', 403);
    const id = assertNonProduction();
    const decoded = await getAuth().verifyIdToken(bearer(request), true);
    const action = fixedAction || String(request.body?.action || '');
    if (!ACTIONS.has(action)) throw new P2Error('unknown_action', 404);
    consumeRateLimit(decoded.uid, action);
    const service = createP2AdminService({ db: getFirestore(), projectId: id });
    const result = await service.run({
      action,
      actorUid: decoded.uid,
      actorEmail: decoded.email || '',
      payload: request.body?.payload || {},
      idempotencyKey: request.body?.idempotencyKey || '',
      requestId
    });
    response.set('access-control-allow-origin', request.headers.origin || '*').status(200).json({ ok: true, requestId, result });
  } catch (error) {
    const code = error instanceof P2Error ? error.code : 'internal_error';
    const status = error instanceof P2Error ? error.status : 500;
    response.set('access-control-allow-origin', request.headers.origin || '*').status(status).json({ ok: false, requestId, code });
  }
}
function actionHandler(action) {
  return onRequest({ cors: false }, (request, response) => invoke(request, response, action));
}

exports.p2Api = onRequest({ cors: false }, (request, response) => invoke(request, response));
exports.inspectUserAccess = actionHandler('inspectUserAccess');
exports.activateUser = actionHandler('activateUser');
exports.suspendUser = actionHandler('suspendUser');
exports.reactivateUser = actionHandler('reactivateUser');
exports.updatePlan = actionHandler('updatePlan');
exports.updateBusinessModules = actionHandler('updateBusinessModules');
exports.inviteWorker = actionHandler('inviteWorker');
exports.revokeWorker = actionHandler('revokeWorker');
exports.acceptInvitation = actionHandler('acceptInvitation');
exports.regenerateInvitation = actionHandler('regenerateInvitation');
exports.expireInvitation = actionHandler('expireInvitation');
