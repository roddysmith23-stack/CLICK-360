import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const rules=await readFile('firestore.rules','utf8');
const first=rules.indexOf('    match /storageRollout/{policyId}');
const end=rules.indexOf('    function signedIn()',first);
assert(first>0&&end>first);
const legacy=rules.slice(0,first)+rules.slice(end);
assert.equal(createHash('sha256').update(legacy).digest('hex'),
  '38b504d5d0806071c6d29b1787d8261aa2dc8026ecdba891352158b8147a448b',
  'Every byte of the certified production commercial Rules must remain unchanged');
for(const file of ['p0a-canonical.js','p0a-journal-reader.js','p0a-recovery-store.js','p0a-recovery-bootstrap.js']){
  const s=await readFile(file,'utf8');
  assert(!/CLICK360_SPARK_(IMPORTER|BOOTSTRAP|RECONCILIATION|RECORD_CODEC)|prepareShadow|storageMode\s*[:=]/.test(s),file);
}
const bootstrap=await readFile('p0a-recovery-bootstrap.js','utf8');
const service=await readFile('firebase-service.js','utf8');
assert(service.indexOf('experimentalForceLongPolling:true')<service.indexOf('db.enablePersistence('));
assert(service.includes('experimentalAutoDetectLongPolling:false'));
assert(bootstrap.includes('policy.automaticShadow!==false'));
const reader=await readFile('p0a-journal-reader.js','utf8');
assert(!reader.includes("'readwrite'")&&!reader.includes('deleteDatabase'));
for(const file of ['firebase.json','firebase.staging.json'])
  assert.equal(JSON.parse(await readFile(file)).firestore.rules,'firestore.rules');
console.log('PASS P0A exact legacy Rules parity, explicit deploy files, recovery-only boundary');
