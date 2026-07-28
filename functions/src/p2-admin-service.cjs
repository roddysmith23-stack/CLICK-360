'use strict';

const { createHash, randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');

const SAFE_ID = /^[A-Za-z0-9_-]{3,128}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = new Set(['owner', 'admin', 'cashier', 'seller', 'inventory', 'server', 'kitchen', 'routeSeller', 'collector', 'readonly']);
const MODULES = new Set(['core', 'inventory', 'sales', 'cash', 'reports', 'scanner', 'labels', 'workers', 'restaurant', 'logistics', 'finance', 'admin']);
const PERMISSIONS = new Set([
  'business.read', 'business.manage', 'inventory.read', 'inventory.write',
  'sales.create', 'sales.read', 'sales.cancel', 'cash.open', 'cash.close', 'cash.read',
  'reports.read', 'labels.read', 'labels.write', 'tables.read', 'tables.write',
  'orders.create', 'orders.update', 'orders.cancel', 'kitchen.read', 'kitchen.update', 'routes.read',
  'routes.write', 'collections.read', 'collections.write', 'members.read',
  'members.manage', 'settings.read', 'settings.manage'
]);
const ROLE_PERMISSIONS = Object.freeze({
  owner: [...PERMISSIONS],
  admin: [...PERMISSIONS],
  cashier: ['business.read', 'sales.create', 'sales.read', 'cash.open', 'cash.close', 'cash.read', 'labels.read'],
  seller: ['business.read', 'sales.create', 'sales.read', 'labels.read'],
  inventory: ['business.read', 'inventory.read', 'inventory.write', 'labels.read', 'labels.write'],
  server: ['business.read', 'tables.read', 'tables.write', 'orders.create', 'orders.update'],
  kitchen: ['business.read', 'kitchen.read', 'kitchen.update'],
  routeSeller: ['business.read', 'routes.read', 'routes.write', 'sales.create', 'sales.read'],
  collector: ['business.read', 'collections.read', 'collections.write'],
  readonly: ['business.read', 'inventory.read', 'sales.read', 'reports.read', 'cash.read', 'labels.read', 'tables.read', 'routes.read', 'collections.read', 'settings.read']
});
const ACTIONS = new Set([
  'inspectUserAccess', 'activateUser', 'suspendUser', 'reactivateUser', 'updatePlan',
  'updateBusinessModules', 'inviteWorker', 'revokeWorker', 'acceptInvitation',
  'regenerateInvitation', 'expireInvitation'
]);

class P2Error extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function hash(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}
function requireId(value, label) {
  const normalized = String(value || '').trim();
  if (!SAFE_ID.test(normalized) || normalized === 'demo-click360') throw new P2Error('invalid_' + label);
  return normalized;
}
function requireKey(value) {
  const normalized = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{12,192}$/.test(normalized)) throw new P2Error('invalid_idempotency_key');
  return normalized;
}
function normaliseEmail(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!EMAIL.test(normalized)) throw new P2Error('invalid_email');
  return normalized;
}
function normaliseRole(value) {
  const role = String(value || 'readonly');
  if (!ROLES.has(role) || role === 'owner') throw new P2Error('invalid_role');
  return role;
}
function normalisePermissions(input, role) {
  const source = Array.isArray(input) && input.length ? input : (ROLE_PERMISSIONS[role] || []);
  return [...new Set(source.map((permission) => String(permission)).filter((permission) => PERMISSIONS.has(permission)))];
}
function timestampMillis(value) {
  return value && typeof value.toMillis === 'function' ? value.toMillis() : 0;
}
function isActiveMember(member, uid, businessId) {
  return !!member
    && member.schemaFamily === 'p2'
    && member.uid === uid
    && member.businessId === businessId
    && member.status === 'active';
}
function memberRole(member) {
  return String(member?.roleId || member?.role || 'readonly');
}
function requireP2Member(member, businessId) {
  if (!member || member.schemaFamily !== 'p2' || member.businessId !== businessId) {
    throw new P2Error('p2_membership_required', 403);
  }
  return member;
}
function hasPermission(member, permission) {
  return memberRole(member) === 'owner' || (Array.isArray(member?.permissions) && member.permissions.includes(permission));
}
function verifyTokenHash(token, expected) {
  const actual = Buffer.from(hash(token), 'hex');
  const target = Buffer.from(String(expected || ''), 'hex');
  return actual.length === target.length && timingSafeEqual(actual, target);
}
function safeSummary(member) {
  if (!member) return null;
  return {
    uid: member.uid || '',
    businessId: member.businessId || '',
    roleId: memberRole(member),
    permissions: Array.isArray(member.permissions) ? member.permissions : [],
    status: member.status || '',
    version: Number(member.version || 0)
  };
}
function nowTimestamp() {
  return FieldValue.serverTimestamp();
}

function createP2AdminService({ db, projectId, clock = () => Date.now(), idFactory = randomUUID }) {
  if (!db) throw new Error('firestore_required');
  if (!projectId || projectId === 'click-360') throw new Error('non_production_project_required');

  function businessRef(businessId) {
    return db.collection('businesses').doc(businessId);
  }
  function memberRef(businessId, uid) {
    return businessRef(businessId).collection('members').doc(uid);
  }
  function invitationRef(businessId, invitationId) {
    return businessRef(businessId).collection('invitations').doc(invitationId);
  }
  async function requireMember(transaction, businessId, uid, permission) {
    const snapshot = await transaction.get(memberRef(businessId, uid));
    const member = snapshot.exists ? snapshot.data() : null;
    if (!isActiveMember(member, uid, businessId)) throw new P2Error('membership_not_active', 403);
    if (permission && !hasPermission(member, permission)) throw new P2Error('permission_denied:' + permission, 403);
    return member;
  }
  function assertManagerMayChange(actor, target, nextRole) {
    const actorRole = memberRole(actor);
    const targetRole = memberRole(target);
    if (targetRole === 'owner' || nextRole === 'owner') throw new P2Error('owner_change_forbidden', 403);
    if (actorRole === 'admin' && (targetRole === 'admin' || nextRole === 'admin')) {
      throw new P2Error('admin_peer_change_forbidden', 403);
    }
  }
  function audit(transaction, businessId, actorUid, action, details = {}) {
    const ref = businessRef(businessId).collection('p2AuditLogs').doc('audit_' + idFactory().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48));
    transaction.set(ref, {
      businessId,
      action,
      actorUid,
      targetUid: String(details.targetUid || ''),
      requestId: String(details.requestId || ''),
      status: 'applied',
      version: 1,
      createdBy: actorUid,
      updatedBy: actorUid,
      createdAt: nowTimestamp(),
      updatedAt: nowTimestamp()
    });
  }
  async function withIdempotency({ action, businessId, actorUid, idempotencyKey, requestId, execute }) {
    const key = requireKey(idempotencyKey);
    const keyHash = hash(action + ':' + key);
    const markerRef = businessRef(businessId).collection('p2Idempotency').doc(keyHash);
    return db.runTransaction(async (transaction) => {
      const marker = await transaction.get(markerRef);
      if (marker.exists) {
        const data = marker.data() || {};
        if (data.actorUid !== actorUid || data.action !== action) throw new P2Error('idempotency_key_reused', 409);
        return { ...(data.result || {}), noop: true, requestId };
      }
      const outcome = await execute(transaction);
      const stored = outcome.storedResult || outcome.result || {};
      transaction.set(markerRef, {
        businessId,
        action,
        keyHash,
        actorUid,
        status: 'applied',
        result: stored,
        version: 1,
        createdBy: actorUid,
        updatedBy: actorUid,
        createdAt: nowTimestamp(),
        updatedAt: nowTimestamp()
      });
      audit(transaction, businessId, actorUid, action, { targetUid: outcome.targetUid, requestId });
      return { ...(outcome.result || {}), noop: false, requestId };
    });
  }
  function featureConfig(input = {}, businessId, actorUid, previous = {}) {
    const requestedFlags = input.featureFlags && typeof input.featureFlags === 'object' ? input.featureFlags : {};
    const previousFlags = previous.featureFlags && typeof previous.featureFlags === 'object' ? previous.featureFlags : {};
    const featureFlags = {};
    for (const key of ['workerAccessEnabled', 'restaurantAdvancedEnabled', 'logisticsEnabled']) {
      const current = requestedFlags[key] && typeof requestedFlags[key] === 'object' ? requestedFlags[key] : (previousFlags[key] || {});
      featureFlags[key] = {
        key,
        enabled: current.enabled === true,
        allowedBusinessIds: [businessId],
        allowedUids: Array.isArray(current.allowedUids) ? current.allowedUids.filter((uid) => SAFE_ID.test(String(uid || ''))).slice(0, 100) : [],
        rolloutPercentage: Math.max(0, Math.min(100, Number(current.rolloutPercentage == null ? 0 : current.rolloutPercentage))),
        minimumAppVersion: String(current.minimumAppVersion || '').slice(0, 40),
        killSwitch: current.killSwitch === true,
        updatedBy: actorUid,
        updatedAt: nowTimestamp()
      };
    }
    const requestedModules = input.modules && typeof input.modules === 'object' ? input.modules : (previous.modules || {});
    const modules = {};
    for (const module of MODULES) modules[module] = module === 'core' ? true : requestedModules[module] === true;
    return {
      businessId,
      plan: String(input.plan || previous.plan || 'base').slice(0, 40),
      status: 'active',
      modules,
      featureFlags,
      version: Number(previous.version || 0) + 1,
      createdBy: previous.createdBy || actorUid,
      updatedBy: actorUid,
      createdAt: previous.createdAt || nowTimestamp(),
      updatedAt: nowTimestamp()
    };
  }
  function createInvitationData({ businessId, actorUid, email, roleId, permissions, ttlHours = 168 }) {
    const token = randomBytes(32).toString('base64url');
    const invitationId = 'invite_' + hash(token).slice(0, 24);
    const role = normaliseRole(roleId);
    const expiration = Math.max(1, Math.min(24 * 30, Number(ttlHours || 168)));
    return {
      token,
      invitationId,
      document: {
        schemaFamily: 'p2',
        businessId,
        email: normaliseEmail(email),
        roleId: role,
        permissions: normalisePermissions(permissions, role),
        tokenHash: hash(token),
        status: 'pending',
        expiresAt: Timestamp.fromMillis(clock() + expiration * 60 * 60 * 1000),
        invitedBy: actorUid,
        invitedAt: nowTimestamp(),
        acceptedBy: '',
        acceptedAt: null,
        revokedAt: null,
        version: 1,
        createdBy: actorUid,
        updatedBy: actorUid,
        createdAt: nowTimestamp(),
        updatedAt: nowTimestamp()
      }
    };
  }
  async function run({ action, actorUid, actorEmail, payload = {}, idempotencyKey, requestId = '' }) {
    if (!ACTIONS.has(action)) throw new P2Error('unknown_action', 404);
    const businessId = requireId(payload.businessId, 'business_id');
    const uid = requireId(actorUid, 'actor_uid');
    if (JSON.stringify(payload).length > 20000) throw new P2Error('payload_too_large', 413);

    if (action === 'inspectUserAccess') {
      return db.runTransaction(async (transaction) => {
        await requireMember(transaction, businessId, uid, 'members.read');
        const targetUid = requireId(payload.targetUid || uid, 'target_uid');
        const target = await transaction.get(memberRef(businessId, targetUid));
        const configSnapshot = await transaction.get(businessRef(businessId).collection('featureConfig').doc('main'));
        return {
          requestId,
          businessId,
          membership: safeSummary(target.exists ? target.data() : null),
          featureConfig: configSnapshot.exists ? {
            plan: configSnapshot.data().plan || '',
            modules: configSnapshot.data().modules || {},
            version: Number(configSnapshot.data().version || 0)
          } : null
        };
      });
    }

    if (action === 'acceptInvitation') {
      const invitationId = requireId(payload.invitationId, 'invitation_id');
      const token = String(payload.token || '');
      const email = normaliseEmail(actorEmail);
      if (token.length < 32 || token.length > 256) throw new P2Error('invalid_invitation_token');
      return withIdempotency({
        action, businessId, actorUid: uid, idempotencyKey, requestId,
        execute: async (transaction) => {
          const invitationSnapshot = await transaction.get(invitationRef(businessId, invitationId));
          if (!invitationSnapshot.exists) throw new P2Error('invitation_not_found', 404);
          const invitation = invitationSnapshot.data() || {};
          if (invitation.status !== 'pending') throw new P2Error('invitation_not_pending', 409);
          if (normaliseEmail(invitation.email) !== email) throw new P2Error('invitation_email_mismatch', 403);
          if (!verifyTokenHash(token, invitation.tokenHash)) throw new P2Error('invitation_token_invalid', 403);
          if (timestampMillis(invitation.expiresAt) <= clock()) throw new P2Error('invitation_expired', 409);
          const existingSnapshot = await transaction.get(memberRef(businessId, uid));
          if (existingSnapshot.exists && existingSnapshot.data().status === 'active') {
            return { result: { businessId, membership: safeSummary(existingSnapshot.data()) }, targetUid: uid };
          }
          const roleId = normaliseRole(invitation.roleId);
          const member = {
            schemaFamily: 'p2',
            uid,
            businessId,
            roleId,
            permissions: normalisePermissions(invitation.permissions, roleId),
            status: 'active',
            invitedBy: invitation.invitedBy || '',
            invitedAt: invitation.invitedAt || null,
            acceptedAt: nowTimestamp(),
            revokedAt: null,
            lastSeenAt: nowTimestamp(),
            version: Number(existingSnapshot.exists ? existingSnapshot.data().version || 0 : 0) + 1,
            createdBy: existingSnapshot.exists ? existingSnapshot.data().createdBy || uid : uid,
            updatedBy: uid,
            createdAt: existingSnapshot.exists ? existingSnapshot.data().createdAt || nowTimestamp() : nowTimestamp(),
            updatedAt: nowTimestamp()
          };
          transaction.set(memberRef(businessId, uid), member);
          transaction.update(invitationRef(businessId, invitationId), {
            status: 'accepted',
            acceptedBy: uid,
            acceptedAt: nowTimestamp(),
            updatedBy: uid,
            updatedAt: nowTimestamp(),
            version: Number(invitation.version || 0) + 1
          });
          return { result: { businessId, membership: safeSummary(member) }, targetUid: uid };
        }
      });
    }

    return withIdempotency({
      action, businessId, actorUid: uid, idempotencyKey, requestId,
      execute: async (transaction) => {
        const permission = ['updatePlan', 'updateBusinessModules'].includes(action) ? 'settings.manage' : 'members.manage';
        const actor = await requireMember(transaction, businessId, uid, permission);
        const featureRef = businessRef(businessId).collection('featureConfig').doc('main');

        if (action === 'updatePlan' || action === 'updateBusinessModules') {
          const current = await transaction.get(featureRef);
          const previous = current.exists ? current.data() || {} : {};
          const next = featureConfig(action === 'updatePlan'
            ? { ...previous, plan: payload.plan, featureFlags: previous.featureFlags, modules: previous.modules }
            : { ...previous, modules: payload.modules, featureFlags: payload.featureFlags },
          businessId, uid, previous);
          transaction.set(featureRef, next);
          return { result: { businessId, featureConfig: { plan: next.plan, modules: next.modules, version: next.version } } };
        }

        if (action === 'inviteWorker' || action === 'regenerateInvitation') {
          if (action === 'regenerateInvitation') {
            const priorId = requireId(payload.invitationId, 'invitation_id');
            const priorSnapshot = await transaction.get(invitationRef(businessId, priorId));
            if (!priorSnapshot.exists) throw new P2Error('invitation_not_found', 404);
            transaction.update(invitationRef(businessId, priorId), {
              status: 'revoked', revokedAt: nowTimestamp(), updatedBy: uid, updatedAt: nowTimestamp(),
              version: Number(priorSnapshot.data().version || 0) + 1
            });
          }
          const next = createInvitationData({
            businessId, actorUid: uid, email: payload.email, roleId: payload.roleId,
            permissions: payload.permissions, ttlHours: payload.ttlHours
          });
          transaction.create(invitationRef(businessId, next.invitationId), next.document);
          return {
            result: {
              businessId, invitationId: next.invitationId, status: 'pending',
              expiresAtMs: clock() + Math.max(1, Math.min(24 * 30, Number(payload.ttlHours || 168))) * 60 * 60 * 1000,
              invitationToken: next.token
            },
            storedResult: { businessId, invitationId: next.invitationId, status: 'pending' }
          };
        }

        if (action === 'expireInvitation') {
          const invitationId = requireId(payload.invitationId, 'invitation_id');
          const inviteSnapshot = await transaction.get(invitationRef(businessId, invitationId));
          if (!inviteSnapshot.exists) throw new P2Error('invitation_not_found', 404);
          const invitation = inviteSnapshot.data() || {};
          if (invitation.status !== 'pending') return { result: { businessId, invitationId, status: invitation.status } };
          if (timestampMillis(invitation.expiresAt) > clock()) throw new P2Error('invitation_not_expired', 409);
          transaction.update(invitationRef(businessId, invitationId), {
            status: 'expired', updatedBy: uid, updatedAt: nowTimestamp(), version: Number(invitation.version || 0) + 1
          });
          return { result: { businessId, invitationId, status: 'expired' } };
        }

        const targetUid = requireId(payload.targetUid, 'target_uid');
        const targetSnapshot = await transaction.get(memberRef(businessId, targetUid));
        if (!targetSnapshot.exists) throw new P2Error('membership_not_found', 404);
        const target = requireP2Member(targetSnapshot.data() || {}, businessId);
        const requestedRole = payload.roleId == null ? memberRole(target) : normaliseRole(payload.roleId);
        assertManagerMayChange(actor, target, requestedRole);

        if (action === 'activateUser' || action === 'reactivateUser' || action === 'suspendUser') {
          const nextStatus = action === 'suspendUser' ? 'suspended' : 'active';
          transaction.update(memberRef(businessId, targetUid), {
            status: nextStatus,
            roleId: requestedRole,
            permissions: normalisePermissions(payload.permissions || target.permissions, requestedRole),
            revokedAt: nextStatus === 'active' ? null : target.revokedAt || null,
            updatedBy: uid,
            updatedAt: nowTimestamp(),
            version: Number(target.version || 0) + 1
          });
          return { result: { businessId, targetUid, status: nextStatus }, targetUid };
        }
        if (action === 'revokeWorker') {
          transaction.update(memberRef(businessId, targetUid), {
            status: 'revoked',
            revokedAt: nowTimestamp(),
            updatedBy: uid,
            updatedAt: nowTimestamp(),
            version: Number(target.version || 0) + 1
          });
          if (payload.invitationId) {
            const inviteId = requireId(payload.invitationId, 'invitation_id');
            transaction.set(invitationRef(businessId, inviteId), {
              status: 'revoked', revokedAt: nowTimestamp(), updatedBy: uid, updatedAt: nowTimestamp()
            }, { merge: true });
          }
          return { result: { businessId, targetUid, status: 'revoked' }, targetUid };
        }
        throw new P2Error('unsupported_action', 400);
      }
    });
  }

  return Object.freeze({ run, ACTIONS, P2Error, hash, normalisePermissions, normaliseRole, safeSummary });
}

module.exports = { createP2AdminService, P2Error, ACTIONS, ROLE_PERMISSIONS };
