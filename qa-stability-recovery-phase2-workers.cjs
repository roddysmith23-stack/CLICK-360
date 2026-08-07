'use strict';

const fs = require('fs');
const assert = require('node:assert/strict');

const firebase = fs.readFileSync('firebase-service.js', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');

assert(firebase.includes("const APP_ASSET_VERSION = 'commercial-1-0-5-r29'"), 'firebase-service asset version must match r29');
assert(/createdBy:\s*ownerId,\s*\n\s*appVersion:\s*'16\.2\.0'/.test(firebase), 'worker invitation must use the V16.2 Firestore contract identifier');
assert(!/createdBy:\s*ownerId,\s*\n\s*appVersion:\s*'1\.0\.5'/.test(firebase), 'commercial UI version must not be written into the V16 invitation contract field');
assert(rules.includes('(request.resource.data.appVersion == "16.0.0" || request.resource.data.appVersion == "16.2.0")'), 'rules must authorize the V16.2 invitation contract');
assert(firebase.includes("db.collection('businesses').doc(ownerId).collection('invitations')"), 'tenant-scoped invitation collection must remain in use');
assert(firebase.includes("db.collection('businesses').doc(ownerId).collection('ownerInviteSecrets')"), 'owner-only invitation secret collection must remain in use');

console.log('PHASE2_WORKER_INVITATION_CONTRACT: PASS');
