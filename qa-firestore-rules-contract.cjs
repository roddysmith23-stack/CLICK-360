const assert = require('assert');
const fs = require('fs');
const rules = fs.readFileSync('firestore.rules', 'utf8');

assert(rules.includes('match /businesses/{businessId}/state/{stateId}'), 'tenant state path must be explicit');
assert(rules.includes('stateId == "main"'), 'only main state document is client-accessible');
assert(rules.includes('match /businesses/{businessId}/legacyBackups/{backupId}') && rules.includes('allow read, write: if false;'), 'legacy backups must be admin-only');
assert(!rules.includes('match /businesses/{businessId}/{document=**}'), 'wildcard business writes are forbidden');
assert(rules.includes('tenantMatches(businessId)'), 'cross-tenant access guard is required');
assert(rules.includes('function workerUser()') && rules.includes('userData().ownerId != request.auth.uid'), 'misconfigured self-owned workers cannot become tenant owners');
assert(rules.includes('validWorkerUserCreate') && rules.includes('ownerRevokesWorker'), 'worker invite and revocation guards are present');
assert(rules.includes('request.resource.data.payload.identity.tenantKey'), 'state writes require the payload tenant key');
assert(rules.includes('request.resource.data.ownerUid == businessId'), 'state writes require the owner UID to match the tenant path');
assert(rules.includes('function validStatePayload()') && rules.includes('payload.data.businesses is list'), 'state writes reject malformed snapshots');
assert(rules.includes('function validProfileFields()') && rules.includes('photoURL.size() <= 100000'), 'profile fields are bounded');
assert(rules.includes('function ownProfileUpdateOnly(uid)') && rules.includes('return approvedUser()'), 'revoked users cannot update profiles');
assert(!rules.includes('tempOwnerEmail') && !rules.includes('validTempOwnerCreate'), 'client self-provisioned owner fallback is forbidden');
assert(rules.includes('Owner accounts are provisioned only by an administrative credential'), 'owner provisioning is administrative only');
console.log('PASS Firestore rules P0 contract (not deployed)');
