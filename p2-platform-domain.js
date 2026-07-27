(function (root) {
  'use strict';

  const MODULES = Object.freeze(['core', 'inventory', 'sales', 'cash', 'reports', 'scanner', 'labels', 'workers', 'restaurant', 'logistics', 'finance', 'admin']);
  const PERMISSIONS = Object.freeze([
    'business.read', 'business.manage', 'inventory.read', 'inventory.write',
    'sales.create', 'sales.read', 'sales.cancel', 'cash.open', 'cash.close', 'cash.read',
    'reports.read', 'labels.read', 'labels.write', 'tables.read', 'tables.write',
    'orders.create', 'orders.update', 'kitchen.read', 'kitchen.update', 'routes.read',
    'routes.write', 'collections.read', 'collections.write', 'members.read',
    'members.manage', 'settings.read', 'settings.manage'
  ]);
  const ROLES = Object.freeze(['owner', 'admin', 'cashier', 'seller', 'inventory', 'server', 'kitchen', 'routeSeller', 'collector', 'readonly']);
  const FEATURE_FOR_MODULE = Object.freeze({ workers: 'workerAccessEnabled', restaurant: 'restaurantAdvancedEnabled', logistics: 'logisticsEnabled' });
  const BASE_MODULES = Object.freeze(['core', 'inventory', 'sales', 'cash', 'reports', 'scanner', 'labels', 'finance', 'admin']);

  const ROLE_PERMISSIONS = Object.freeze({
    owner: PERMISSIONS,
    admin: ['business.read', 'business.manage', 'inventory.read', 'inventory.write', 'sales.create', 'sales.read', 'sales.cancel', 'cash.open', 'cash.close', 'cash.read', 'reports.read', 'labels.read', 'labels.write', 'tables.read', 'tables.write', 'orders.create', 'orders.update', 'kitchen.read', 'kitchen.update', 'routes.read', 'routes.write', 'collections.read', 'collections.write', 'members.read', 'members.manage', 'settings.read', 'settings.manage'],
    cashier: ['business.read', 'sales.create', 'sales.read', 'cash.open', 'cash.close', 'cash.read', 'labels.read'],
    seller: ['business.read', 'sales.create', 'sales.read', 'labels.read'],
    inventory: ['business.read', 'inventory.read', 'inventory.write', 'labels.read', 'labels.write'],
    server: ['business.read', 'tables.read', 'tables.write', 'orders.create', 'orders.update'],
    kitchen: ['business.read', 'kitchen.read', 'kitchen.update'],
    routeSeller: ['business.read', 'routes.read', 'routes.write', 'sales.create', 'sales.read'],
    collector: ['business.read', 'collections.read', 'collections.write'],
    readonly: ['business.read', 'inventory.read', 'sales.read', 'reports.read', 'cash.read', 'labels.read', 'tables.read', 'routes.read', 'collections.read', 'settings.read']
  });

  function text(value) { return String(value || '').trim(); }
  function normalizedEmail(value) { return text(value).toLowerCase(); }
  function unique(values) { return [...new Set((values || []).filter(Boolean))]; }
  function nowIso(now = Date.now()) { return new Date(now).toISOString(); }
  function simpleId(prefix, seed = '') { return `${prefix}_${text(seed).replace(/[^a-z0-9]/gi, '').slice(-12) || Math.random().toString(36).slice(2, 12)}`; }

  function normalizeRole(roleId) {
    return ROLES.includes(roleId) ? roleId : 'readonly';
  }
  function rolePermissions(roleId) {
    return [...(ROLE_PERMISSIONS[normalizeRole(roleId)] || ROLE_PERMISSIONS.readonly)];
  }
  function permissionMap(values) {
    const allowed = new Set(values || []);
    return Object.fromEntries(PERMISSIONS.map((permission) => [permission, allowed.has(permission)]));
  }
  function normalizeMembership(input = {}, fallback = {}) {
    const roleId = normalizeRole(input.roleId || input.role || fallback.roleId || fallback.role || 'readonly');
    const granted = unique(input.permissions || rolePermissions(roleId)).filter((permission) => PERMISSIONS.includes(permission));
    return {
      id: text(input.id) || simpleId('member', input.uid || input.email),
      uid: text(input.uid),
      email: normalizedEmail(input.email),
      businessId: text(input.businessId || fallback.businessId),
      roleId,
      permissions: granted,
      status: ['active', 'pending', 'revoked', 'suspended'].includes(input.status) ? input.status : 'pending',
      invitedBy: text(input.invitedBy),
      invitedAt: text(input.invitedAt),
      acceptedAt: text(input.acceptedAt),
      revokedAt: text(input.revokedAt),
      lastSeenAt: text(input.lastSeenAt)
    };
  }
  function normalizeAccess(access = {}) {
    const status = text(access.status || access.mode || 'active').toLowerCase();
    const suspended = ['suspended', 'blocked', 'disabled'].includes(status);
    const expired = access.expired === true || status === 'expired';
    return { ...access, status, suspended, expired, lifetime: access.lifetime === true };
  }
  function flagValue(flags, key) {
    if (Array.isArray(flags)) return flags.find((flag) => flag?.key === key) || {};
    return flags?.[key] || {};
  }
  function stableRollout(subject, key) {
    const source = `${text(subject)}:${text(key)}`;
    let result = 0;
    for (let index = 0; index < source.length; index += 1) result = (result * 31 + source.charCodeAt(index)) >>> 0;
    return result % 100;
  }
  function isFlagEnabled(flags, key, context = {}) {
    const flag = flagValue(flags, key);
    if (flag.killSwitch === true || flag.enabled !== true) return false;
    const businessId = text(context.businessId);
    const uid = text(context.uid);
    const environments = flag.environments;
    if (Array.isArray(environments) && environments.length && !environments.includes(context.environment || 'local')) return false;
    if (Array.isArray(flag.allowedBusinessIds) && flag.allowedBusinessIds.length && !flag.allowedBusinessIds.includes(businessId)) return false;
    if (Array.isArray(flag.allowedUids) && flag.allowedUids.length && !flag.allowedUids.includes(uid)) return false;
    const percent = Math.max(0, Math.min(100, Number(flag.rolloutPercentage == null ? 100 : flag.rolloutPercentage)));
    return stableRollout(uid || businessId || 'anonymous', key) < percent;
  }
  function configuredModuleMap(business = {}, access = {}) {
    const source = business.modules || business.settings?.modules || access.modules || {};
    const enabled = new Set(BASE_MODULES);
    if (Array.isArray(source)) source.forEach((module) => enabled.add(module));
    else if (source && typeof source === 'object') {
      for (const [module, active] of Object.entries(source)) {
        if (active === true) enabled.add(module);
        if (active === false && module !== 'core' && module !== 'admin') enabled.delete(module);
      }
    }
    enabled.add('core');
    return Object.fromEntries(MODULES.map((module) => [module, enabled.has(module)]));
  }
  function planLimits(access = {}) {
    const plan = text(access.planCode || access.plan || 'base').toLowerCase();
    if (plan.includes('founder')) return { workers: 100, businesses: 100, routes: 1000, restaurantTables: 500 };
    if (plan.includes('pro')) return { workers: 5, businesses: 1, routes: 50, restaurantTables: 80 };
    if (plan.includes('trial')) return { workers: 2, businesses: 1, routes: 10, restaurantTables: 20 };
    return { workers: 2, businesses: 1, routes: 10, restaurantTables: 20 };
  }
  function resolveEnabledModules({ accountAccess = {}, business = {}, membership = {}, featureFlags = {}, device = {} } = {}) {
    const access = normalizeAccess(accountAccess);
    const normalizedMember = normalizeMembership(membership, { businessId: business.id });
    const isOwner = normalizedMember.roleId === 'owner' && normalizedMember.status === 'active';
    const membershipActive = normalizedMember.status === 'active' && normalizedMember.businessId === text(business.id);
    const writable = membershipActive && !access.suspended && !access.expired && access.readOnly !== true;
    const modules = configuredModuleMap(business, access);
    const context = { businessId: text(business.id), uid: normalizedMember.uid || text(device.uid), environment: device.environment || 'local' };
    const featureEnabled = {};
    for (const [module, flagKey] of Object.entries(FEATURE_FOR_MODULE)) {
      featureEnabled[module] = isFlagEnabled(featureFlags, flagKey, context);
      modules[module] = modules[module] === true && featureEnabled[module];
    }
    if (modules.workers && !isOwner && normalizedMember.roleId !== 'admin') modules.workers = false;
    modules.admin = modules.admin === true && isOwner;
    if (!membershipActive) {
      for (const module of MODULES) modules[module] = module === 'core';
    }
    const grants = new Set(normalizedMember.permissions);
    const permissions = permissionMap([...grants].filter((permission) => {
      const [scope] = permission.split('.');
      if (scope === 'inventory') return modules.inventory;
      if (scope === 'sales') return modules.sales;
      if (scope === 'cash') return modules.cash;
      if (scope === 'reports') return modules.reports;
      if (scope === 'labels') return modules.labels;
      if (scope === 'tables' || scope === 'orders' || scope === 'kitchen') return modules.restaurant;
      if (scope === 'routes' || scope === 'collections') return modules.logistics;
      if (scope === 'members') return modules.workers && (isOwner || normalizedMember.roleId === 'admin');
      if (scope === 'business' || scope === 'settings') return modules.admin || isOwner || normalizedMember.roleId === 'admin';
      return true;
    }));
    if (!writable) {
      for (const permission of Object.keys(permissions)) if (/\.(manage|write|create|cancel|open|close|update)$/.test(permission)) permissions[permission] = false;
    }
    const reasons = [];
    const warnings = [];
    if (!membershipActive) { reasons.push('membership_not_active'); warnings.push('El usuario no tiene una membresia activa para este negocio.'); }
    if (access.suspended) { reasons.push('account_suspended'); warnings.push('La cuenta esta suspendida y no puede escribir.'); }
    if (access.expired) { reasons.push('access_expired'); warnings.push('El plan actual limita las operaciones de escritura.'); }
    for (const [module, flagKey] of Object.entries(FEATURE_FOR_MODULE)) {
      if (!modules[module]) reasons.push(module === 'workers' && featureEnabled[module] ? 'workers_role_denied' : `${flagKey}_off`);
    }
    return { modules, permissions, readOnly: !writable, limits: planLimits(access), warnings, reasons: unique(reasons), membership: normalizedMember, account: access };
  }
  function can(resolution, permission) {
    return resolution?.permissions?.[permission] === true;
  }
  function assertBusinessScope({ businessId, membership, uid }) {
    const normalized = normalizeMembership(membership, { businessId });
    return normalized.status === 'active' && normalized.businessId === text(businessId) && (!uid || normalized.uid === text(uid));
  }
  function randomToken() {
    if (!root.crypto?.getRandomValues) throw new Error('secure_token_unavailable');
    const bytes = new Uint8Array(24);
    root.crypto.getRandomValues(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  async function tokenHash(token) {
    if (!root.crypto?.subtle || !root.TextEncoder) throw new Error('secure_hash_unavailable');
    const bytes = await root.crypto.subtle.digest('SHA-256', new root.TextEncoder().encode(text(token)));
    return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  async function createInvitation({ businessId, email, roleId, permissions, invitedBy, now = Date.now(), ttlMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
    const role = normalizeRole(roleId);
    if (role === 'owner') throw new Error('owner_invitation_forbidden');
    const normalized = normalizedEmail(email);
    if (!businessId || !normalized || !normalized.includes('@')) throw new Error('invalid_invitation_subject');
    const token = randomToken();
    const tokenHashValue = await tokenHash(token);
    return {
      token,
      invitation: {
        id: simpleId('invite', tokenHashValue), businessId: text(businessId), email: normalized, roleId: role,
        permissions: unique(permissions || rolePermissions(role)), status: 'pending', tokenHash: tokenHashValue,
        expiresAt: nowIso(now + Math.max(60 * 1000, Number(ttlMs || 0))), invitedBy: text(invitedBy), invitedAt: nowIso(now),
        acceptedBy: '', acceptedAt: '', revokedAt: ''
      }
    };
  }
  async function redeemInvitation({ invitation, token, uid, email, now = Date.now() } = {}) {
    const current = { ...invitation };
    if (current.status !== 'pending') throw new Error('invitation_not_pending');
    if (Date.parse(current.expiresAt || '') <= now) throw new Error('invitation_expired');
    if (normalizedEmail(email) !== normalizedEmail(current.email)) throw new Error('invitation_email_mismatch');
    if (await tokenHash(token) !== current.tokenHash) throw new Error('invitation_token_invalid');
    const member = normalizeMembership({
      id: simpleId('member', uid), uid, email, businessId: current.businessId, roleId: current.roleId,
      permissions: current.permissions, status: 'active', invitedBy: current.invitedBy, invitedAt: current.invitedAt,
      acceptedAt: nowIso(now), lastSeenAt: nowIso(now)
    });
    return { invitation: { ...current, status: 'accepted', acceptedBy: text(uid), acceptedAt: nowIso(now) }, membership: member };
  }
  function updateMembership({ actor, target, roleId, permissions, status, now = Date.now() } = {}) {
    const source = normalizeMembership(actor);
    const current = normalizeMembership(target);
    if (source.status !== 'active' || !source.permissions.includes('members.manage')) throw new Error('member_manage_denied');
    if (source.businessId !== current.businessId) throw new Error('cross_business_member_update');
    const nextRole = roleId == null ? current.roleId : normalizeRole(roleId);
    if (nextRole === 'owner' && current.roleId !== 'owner') throw new Error('owner_escalation_forbidden');
    if (current.roleId === 'owner' && status && status !== 'active') throw new Error('owner_revoke_forbidden');
    if (source.roleId === 'admin' && (current.roleId === 'owner' || current.roleId === 'admin' || nextRole === 'owner' || nextRole === 'admin')) throw new Error('admin_peer_or_owner_manage_forbidden');
    if (!['owner', 'admin'].includes(source.roleId)) throw new Error('member_manage_denied');
    const nextStatus = status == null ? current.status : (['active', 'suspended', 'revoked'].includes(status) ? status : current.status);
    return normalizeMembership({ ...current, roleId: nextRole, permissions: permissions || rolePermissions(nextRole), status: nextStatus,
      revokedAt: nextStatus === 'revoked' ? nowIso(now) : current.revokedAt });
  }
  function auditEvent(action, details = {}) {
    const clean = Object.fromEntries(Object.entries(details).filter(([key]) => !/token|secret|password/i.test(key)).map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 120) : value]));
    return { id: simpleId('audit', `${action}:${Date.now()}`), action: text(action), createdAt: nowIso(), details: clean };
  }

  root.CLICK360_P2_PLATFORM = Object.freeze({
    MODULES, PERMISSIONS, ROLES, ROLE_PERMISSIONS, FEATURE_FOR_MODULE, rolePermissions, permissionMap,
    normalizeMembership, resolveEnabledModules, can, assertBusinessScope, isFlagEnabled, createInvitation,
    redeemInvitation, updateMembership, auditEvent, tokenHash
  });
})(typeof window !== 'undefined' ? window : globalThis);
