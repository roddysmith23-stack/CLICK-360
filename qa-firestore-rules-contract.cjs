const assert = require('assert');
const fs = require('fs');
const rules = fs.readFileSync('firestore.rules', 'utf8');

assert(rules.includes('match /businesses/{businessId}/state/{stateId}'), 'tenant state path must be explicit');
assert(rules.includes('stateId == "main"'), 'only main state document is client-accessible');
assert(rules.includes('match /businesses/{businessId}/legacyBackups/{backupId}') && rules.includes('allow read, write: if false;'), 'legacy backups must be admin-only');
assert(!rules.includes('match /businesses/{businessId}/{document=**}'), 'wildcard business writes are forbidden');
assert(rules.includes('tenantMatches(businessId)'), 'cross-tenant access guard is required');
assert(rules.includes('validWorkerUserCreate') && rules.includes('ownerRevokesWorker'), 'worker invite and revocation guards are present');
console.log('PASS Firestore rules P0 contract (not deployed)');
