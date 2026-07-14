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
    && rules.includes('validWorkerStateUpdate(businessId)'),
  'cross-tenant read, owner write, and scoped worker write guards are required'
);
assert(rules.includes('function workerUser(businessId)') && rules.includes('businessId != request.auth.uid'), 'misconfigured self-owned workers cannot become tenant owners');
assert(rules.includes('validWorkerUserCreate') && rules.includes('ownerRevokesWorker'), 'worker invite and revocation guards are present');
assert(rules.includes('request.resource.data.payload.identity.tenantKey'), 'state writes require the payload tenant key');
assert(rules.includes('request.resource.data.ownerUid == businessId'), 'state writes require the owner UID to match the tenant path');
assert(rules.includes('function validStatePayload()') && rules.includes('payload.data.businesses is list'), 'state writes reject malformed snapshots');
assert(rules.includes('function validProfileFields()') && rules.includes('photoURL.size() <= 100000'), 'profile fields are bounded');
assert(rules.includes('function ownProfileUpdateOnly(uid)') && rules.includes('return approvedUser()'), 'revoked users cannot update profiles');
assert(!rules.includes('tempOwnerEmail') && !rules.includes('validTempOwnerCreate'), 'client self-provisioned owner fallback is forbidden');
assert(rules.includes('Owner accounts are provisioned only by an administrative credential'), 'owner provisioning is administrative only');
assert(rules.includes('match /businesses/{businessId}/invitations/{inviteHash}') && rules.includes('request.resource.data.singleUse == true'), 'V16 invitations are tenant-scoped and one-use');
assert(rules.includes('match /businesses/{businessId}/members/{uid}') && rules.includes('membershipData(businessId).permissions'), 'worker memberships and permissions are tenant-scoped');
assert(rules.includes('businessId != "demo-click360"'), 'the suspect demo tenant remains client-blocked');
assert(rules.includes('request.time < data.expiresAt'), 'paid subscriptions with an expiry become server-side read-only');
assert(rules.includes('match /adminBackups/{backupId}') && rules.includes('match /adminAuditLogs/{eventId}'), 'administrative backups and audit logs have explicit client-deny routes');
assert(rules.includes('match /telemetryEvents/{eventId}') && rules.includes('request.resource.data.uidHash.size() == 16'), 'non-sensitive telemetry is allowlisted, bounded, and write-only');
console.log('PASS Firestore rules P0 contract');
