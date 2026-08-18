const assert = require('assert');
const fs = require('fs');
const rules = fs.readFileSync('firestore.rules', 'utf8');

assert(rules.includes('match /businesses/{businessId}/state/{stateId}'), 'tenant state path must be explicit');
assert(rules.includes('stateId == "main"'), 'only main state document is client-accessible');
assert(rules.includes('match /businesses/{businessId}/legacyBackups/{backupId}') && rules.includes('allow read, write: if false;'), 'legacy backups must be admin-only');
assert(!rules.includes('match /businesses/{businessId}/{document=**}'), 'wildcard business writes are forbidden');
assert(
  rules.includes('allow read: if stateId == "main" && tenantReadable(businessId)')
    && rules.includes('request.auth.uid == businessId && ownerUser() && writeMatchesTenant(businessId)')
    && rules.includes('return ownerReadUser() && request.auth.uid == businessId;'),
  'cross-tenant reads and writes are restricted to the canonical owner'
);
assert(!rules.includes('validWorkerStateUpdate') && !rules.includes('workerListMutationAllowed'), 'workers cannot access the monolithic tenant snapshot');
assert(rules.includes('validWorkerUserCreate') && rules.includes('ownerRevokesWorker'), 'worker invite and revocation guards are present');
assert(rules.includes('request.resource.data.payload.identity.tenantKey'), 'state writes require the payload tenant key');
assert(rules.includes('request.resource.data.ownerUid == businessId'), 'state writes require the owner UID to match the tenant path');
assert(rules.includes('function validStatePayload()') && rules.includes('payload.data.businesses is list'), 'state writes reject malformed snapshots');
assert(rules.includes('function validProfileFields()') && rules.includes('photoURL.size() <= 100000'), 'profile fields are bounded');
assert(rules.includes('function ownProfileUpdateOnly(uid)') && rules.includes('return approvedUser()'), 'revoked users cannot update profiles');
assert(!rules.includes('tempOwnerEmail') && !rules.includes('validTempOwnerCreate'), 'client self-provisioned owner fallback is forbidden');
assert(rules.includes('Owner accounts are provisioned only by an administrative credential'), 'owner provisioning is administrative only');
assert(rules.includes('match /businesses/{businessId}/invitations/{inviteHash}') && rules.includes('request.resource.data.singleUse == true'), 'V16 invitations are tenant-scoped and one-use');
assert(rules.includes('match /businesses/{businessId}/members/{uid}') && rules.includes('request.resource.data.permissions is map') && rules.includes('request.resource.data.tenantKey == "owner:" + businessId + ":business:" + businessId'), 'worker membership records remain tenant-scoped while operational access is paused');
assert(rules.includes('businessId != "demo-click360"'), 'the suspect demo tenant remains client-blocked');
assert(rules.includes('request.time < data.expiresAt'), 'paid subscriptions with an expiry become server-side read-only');
assert(rules.includes('data.status == "active"')
  && rules.includes('data.lifetime == true')
  && rules.includes('data.plan == "pro"')
  && rules.includes('data.planCode == "pro_lifetime"')
  && rules.includes('data.billingStatus == "lifetime"'), 'PRO Lifetime compatibility remains limited to the authorized active lifetime contract');
assert(rules.includes('data.planCode != "pro_lifetime"'), 'malformed PRO Lifetime records cannot pass through the generic active paid branch');
assert(rules.includes('match /adminBackups/{backupId}') && rules.includes('match /adminAuditLogs/{eventId}'), 'administrative backups and audit logs have explicit client-deny routes');
assert(rules.includes('match /telemetryEvents/{eventId}') && rules.includes('request.resource.data.uidHash.size() == 16'), 'non-sensitive telemetry is allowlisted, bounded, and write-only');
assert(rules.includes('match /businesses/{businessId}/auditEvents/{eventId}')
  && rules.includes('request.resource.data.actorUid == request.auth.uid')
  && rules.includes('request.resource.data.correlationId.size() > 0'), 'audit events are identity-bound and correlated');
assert(rules.includes('request.resource.data.before.keys().hasOnly(["status", "amount", "stock", "role"])')
  && rules.includes('request.resource.data.after.keys().hasOnly(["status", "amount", "stock", "role"])'), 'audit payloads cannot contain commercial snapshots');
console.log('PASS Firestore rules P0 contract');
