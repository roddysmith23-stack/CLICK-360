'use strict';

const { createHash } = require('node:crypto');

const SAFE_ID = /^[A-Za-z0-9_-]{3,128}$/;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stable(value[key]);
    return out;
  }, {});
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function cleanId(value, label) {
  const normalized = String(value || '').trim();
  if (!SAFE_ID.test(normalized) || normalized === 'demo-click360') {
    throw new Error('invalid_' + label);
  }
  return normalized;
}

function collectionManifest(name, entries) {
  const list = Array.isArray(entries) ? entries : [];
  return { name, count: list.length, hash: hash(list) };
}

function duplicateIds(entries) {
  const seen = new Set();
  return entries.map((entry) => String(entry.id || entry.uid || '')).filter((id) => {
    if (!id || seen.has(id)) return true;
    seen.add(id);
    return false;
  });
}

function buildP2CloudMigrationDryRun(input = {}) {
  const businessId = cleanId(input.businessId, 'business_id');
  const localMembers = Array.isArray(input.localMembers) ? input.localMembers : [];
  const liteTables = Array.isArray(input.liteTables) ? input.liteTables : [];
  const labelProfiles = Array.isArray(input.labelProfiles) ? input.labelProfiles : [];
  const routes = Array.isArray(input.routes) ? input.routes : [];
  const errors = [];
  const protectedState = input.legacyStateMain ? collectionManifest('businesses/' + businessId + '/state/main', [input.legacyStateMain]) : null;

  for (const [name, entries] of Object.entries({ localMembers, liteTables, labelProfiles, routes })) {
    const duplicates = duplicateIds(entries);
    if (duplicates.length) errors.push(name + '_duplicate_or_missing_id');
    entries.forEach((entry) => {
      if (entry.businessId && entry.businessId !== businessId) errors.push(name + '_cross_business');
    });
  }
  localMembers.forEach((entry) => {
    if (!entry.uid && entry.status !== 'pending') errors.push('member_missing_uid');
    if (!entry.email && entry.status === 'pending') errors.push('pending_invitation_missing_email');
  });

  const source = [
    collectionManifest('localMembers', localMembers),
    collectionManifest('liteTables', liteTables),
    collectionManifest('labelProfiles', labelProfiles),
    collectionManifest('routes', routes),
    ...(protectedState ? [protectedState] : [])
  ];
  if (errors.length) {
    return Object.freeze({
      status: 'ABORTED_AMBIGUOUS',
      noWrites: true,
      businessId,
      errors: [...new Set(errors)].sort(),
      source,
      rollback: { action: 'none', reason: 'no_write_performed' }
    });
  }

  const membershipDocuments = localMembers.filter((entry) => entry.status !== 'pending').map((entry) => ({
    id: cleanId(entry.uid, 'member_uid'),
    path: 'businesses/' + businessId + '/members/' + cleanId(entry.uid, 'member_uid'),
    schemaFamily: 'p2', businessId, uid: cleanId(entry.uid, 'member_uid'),
    roleId: String(entry.roleId || entry.role || 'readonly'), status: String(entry.status || 'active')
  }));
  const invitationDocuments = localMembers.filter((entry) => entry.status === 'pending').map((entry) => ({
    id: cleanId(entry.id, 'invitation_id'),
    path: 'businesses/' + businessId + '/invitations/' + cleanId(entry.id, 'invitation_id'),
    schemaFamily: 'p2', businessId, email: String(entry.email).toLowerCase(), status: 'pending', tokenHash: 'REGENERATE_ON_APPROVED_APPLY'
  }));
  const tableDocuments = liteTables.map((entry) => ({
    id: cleanId(entry.id, 'table_id'), path: 'businesses/' + businessId + '/restaurantTables/' + cleanId(entry.id, 'table_id'),
    schemaFamily: 'p2', businessId, name: String(entry.name || 'Mesa').slice(0, 120), status: String(entry.status || 'free')
  }));
  const profileDocuments = labelProfiles.map((entry) => ({
    id: cleanId(entry.id, 'profile_id'), path: 'businesses/' + businessId + '/labelProfiles/' + cleanId(entry.id, 'profile_id'),
    schemaFamily: 'p2', businessId, deviceScope: String(entry.deviceScope || 'unknown'), source: 'legacy_profile_dry_run'
  }));
  const routeDocuments = routes.map((entry) => ({
    id: cleanId(entry.id, 'route_id'), path: 'businesses/' + businessId + '/routes/' + cleanId(entry.id, 'route_id'),
    schemaFamily: 'p2', businessId, status: String(entry.status || 'planned'), source: 'legacy_route_dry_run'
  }));
  const target = [
    collectionManifest('memberships', membershipDocuments),
    collectionManifest('invitations', invitationDocuments),
    collectionManifest('restaurantTables', tableDocuments),
    collectionManifest('labelProfiles', profileDocuments),
    collectionManifest('routes', routeDocuments)
  ];

  return Object.freeze({
    status: 'DRY_RUN_READY',
    noWrites: true,
    businessId,
    source,
    target,
    planHash: hash({ businessId, source, target }),
    preconditions: [
      'owner_approval_required',
      'immutable_backup_manifest_required',
      'source_hashes_must_match',
      'state_main_preserved_and_untouched',
      'no_cross_business_records',
      'apply_uses_create_or_explicit_precondition_only'
    ],
    rollback: {
      action: 'delete_only_documents_created_by_the_approved_run',
      prohibited: ['businesses/' + businessId + '/state/main', 'legacy_source_documents']
    }
  });
}

module.exports = { buildP2CloudMigrationDryRun, hash };
