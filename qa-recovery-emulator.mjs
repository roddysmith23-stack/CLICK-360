import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { MARKER,hash,firestoreFieldsHash,fieldsData,buildReplacement,applyRecovery,conditionalRollback } from './scripts/recovery/restore-core.mjs';

const project = 'demo-click360-recovery';
const port = Number(process.env.CLICK360_RECOVERY_TEST_PORT || 48888);
assert(Number.isInteger(port) && port > 1024 && port < 65533);
const origin = `http://127.0.0.1:${port}`;
const dbRoot = `projects/${project}/databases/(default)/documents`;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'click360-recovery-cas-'));
fs.writeFileSync(path.join(directory, 'firestore.rules'), "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }");
fs.writeFileSync(path.join(directory, 'firebase.json'), JSON.stringify({ firestore: { rules: 'firestore.rules' },
  emulators: { firestore: { host: '127.0.0.1', port, websocketPort:port+1 }, hub:{host:'127.0.0.1',port:port+2},logging:{host:'127.0.0.1',port:port+3},ui: { enabled: false } } }));
const java = ['/opt/homebrew/opt/openjdk@21/bin', '/usr/local/opt/openjdk@21/bin', '/opt/homebrew/opt/openjdk/bin', '/usr/local/opt/openjdk/bin'];
// This process owns an isolated emulator. It never uses ADC or reaches Google.
const emulator = spawn(path.resolve('node_modules/.bin/firebase'), ['emulators:start', '--only', 'firestore', '--project', project,
  '--config', path.join(directory, 'firebase.json')], { cwd: directory, stdio: 'ignore', detached: true,
  env: { ...process.env, PATH: `${java.join(':')}:${process.env.PATH}` } });
let commits = 0;
async function request(resource, body) {
  assert(resource.startsWith(dbRoot) && !resource.includes('..'), 'loopback project confinement');
  const response = await fetch(`${origin}/v1/${resource}`, { method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(`EMULATOR_${response.status}_${data.error?.status || 'ERROR'}`);
  return data;
}
const client = { get: name => request(name), commit: writes => { commits++; return request(`${dbRoot}:commit`, { writes }); } };
const value = x => x === null ? { nullValue: null } : Array.isArray(x) ? { arrayValue: { values: x.map(value) } }
  : typeof x === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(x).map(([k,v]) => [k,value(v)])) } }
  : typeof x === 'string' ? { stringValue: x } : typeof x === 'boolean' ? { booleanValue: x } : { integerValue: String(x) };
let fixtureNumber = 0;
async function fixture() {
  const ownerUid = `synthetic-recovery-${Date.now()}-${++fixtureNumber}`;
  const tenantKey = `owner:${ownerUid}:business:${ownerUid}`;
  const identity = { schemaVersion: 10,ownerUid,ownerId:ownerUid,businessId:ownerUid,tenantKey };
  const scope = {projectId:project,databaseId:'(default)',ownerUid,businessId:ownerUid,tenantKey,documentPath:`businesses/${ownerUid}/state/main`};
  const name = `${dbRoot}/${scope.documentPath}`;
  const fields = value({...identity,revision:9,unrelatedEnvelope:'KEEP',payload:{schemaVersion:10,identity,data:{
    businesses:[{id:ownerUid,name:'Synthetic emulator'}],activeBusinessId:ownerUid,products:[],sales:[],movements:[],invoices:[],dailyReports:[],deletedProducts:[],auditLogs:[],layaways:[],cashSessions:[],settings:{workers:[],labelTemplates:[],labelProfiles:[]}
  }}}).mapValue.fields;
  await client.commit([{update:{name,fields},currentDocument:{exists:false}}]);
  const before = await client.get(name);
  const recoveredFields = structuredClone(fields);
  recoveredFields.payload.mapValue.fields.data.mapValue.fields.products = value(Array.from({length:436},(_,i)=>({id:`synthetic-p${i}`,businessId:ownerUid,code:`QA-${i}`,name:`Synthetic product ${i}`,stock:17,qty:17,price:10,cardPrice:10,cost:4})));
  const candidate = {scope,restoreEligible:true,proposedHistoricalDocument:{name,fields:recoveredFields}};
  const attestation = {marker:MARKER,candidateHash:hash(candidate),operationId:`${MARKER}_${ownerUid}`,
    expectedUpdateTime:before.updateTime,expectedRevision:9,evidence:[{path:'synthetic-emulator-fixture',sha256:'a'.repeat(64)}],
    gates:Object.fromEntries(['identity','schema','intrinsicIntegrity','noSyntheticData','deltasExplained','newerWritesPreserved','liveWritersControlled','rollbackTested'].map(k=>[k,'PASS']))};
  const now = Date.now();
  const backup = {before,beforeHash:firestoreFieldsHash(before.fields),candidateHash:hash(candidate),expectedAfterHash:firestoreFieldsHash(buildReplacement(candidate,before,attestation.operationId,now).fields),managedBackupVerified:false};
  const backupName = `${dbRoot}/adminBackups/${attestation.operationId}`;
  await client.commit([{update:{name:backupName,fields:{beforeState:{mapValue:{fields:before.fields}}}},currentDocument:{exists:false}}]);
  const managed = await client.get(backupName);
  assert.equal(firestoreFieldsHash(managed.fields.beforeState.mapValue.fields),backup.beforeHash);
  backup.managedBackupVerified = true;
  return {client,candidate,attestation,backup,now,name};
}
async function externalWrite(name, label) {
  const fresh = await client.get(name);
  await client.commit([{update:{name,fields:{...fresh.fields,externalValidWrite:value(label)}},currentDocument:{updateTime:fresh.updateTime}}]);
}

try {
  let ready = false;
  for (let i=0;i<180;i++) { try { ready = (await fetch(origin)).ok; } catch {} if (ready) break; await new Promise(r=>setTimeout(r,500)); }
  assert(ready,'isolated Firestore emulator started');
  const f = await fixture();
  const restored = await applyRecovery(f);
  assert.equal(restored.status,'SHARY_DATA_RECOVERY_VERIFIED');
  assert.equal(fieldsData(restored.second.fields).payload.data.products.length,436);
  assert.equal(restored.first.updateTime,restored.second.updateTime);
  assert.equal(fieldsData((await client.get(`${dbRoot}/adminAuditLogs/${f.attestation.operationId}`)).fields).action,'shary_data_recovery');
  const beforeReplay = commits;
  assert.equal((await applyRecovery(f)).status,'ALREADY_APPLIED');
  assert.equal(commits,beforeReplay);
  console.log('PASS real emulator restore436 + atomic audit + two authoritative reads + idempotent replay');
  const rollback = await conditionalRollback({...f,expectedPostUpdateTime:restored.second.updateTime,now:f.now+10});
  assert.equal(hash(rollback.actual.fields.payload),hash(f.backup.before.fields.payload));
  assert.equal(fieldsData(rollback.actual.fields).unrelatedEnvelope,'KEEP');
  assert.equal(fieldsData((await client.get(`${dbRoot}/adminAuditLogs/${f.attestation.operationId}_rollback`)).fields).action,'shary_data_recovery_rollback');
  console.log('PASS real conditional rollback restores payload, preserves envelope, increments revision, audits atomically');

  const race = await fixture();
  const raceClient = {...client,commit:async writes=>{ await externalWrite(race.name,'confirmed-after-read'); return client.commit(writes); }};
  await assert.rejects(applyRecovery({...race,client:raceClient}),/EMULATOR_/);
  const racedAfter = fieldsData((await client.get(race.name)).fields);
  assert.equal(racedAfter.externalValidWrite,'confirmed-after-read');
  assert.equal(racedAfter.payload.data.products.length,0);
  console.log('PASS restore CAS rejects a writer that commits between GET and commit');

  const collision = await fixture();
  await client.commit([{update:{name:`${dbRoot}/adminAuditLogs/${collision.attestation.operationId}`,fields:{existing:value(true)}},currentDocument:{exists:false}}]);
  await assert.rejects(applyRecovery(collision),/EMULATOR_/);
  assert.equal(firestoreFieldsHash((await client.get(collision.name)).fields),collision.backup.beforeHash);
  console.log('PASS audit precondition collision rolls back the entire atomic commit, not just audit');

  const rollbackRace = await fixture();
  const post = await applyRecovery(rollbackRace);
  const concurrentRollbackClient = {...client,commit:async writes=>{ await externalWrite(rollbackRace.name,'valid-post-recovery'); return client.commit(writes); }};
  await assert.rejects(conditionalRollback({...rollbackRace,client:concurrentRollbackClient,expectedPostUpdateTime:post.second.updateTime}),/EMULATOR_/);
  const preserved = fieldsData((await client.get(rollbackRace.name)).fields);
  assert.equal(preserved.externalValidWrite,'valid-post-recovery');
  assert.equal(preserved.payload.data.products.length,436);
  await assert.rejects(applyRecovery(rollbackRace),/IDEMPOTENT_RESULT_DIVERGED/);
  console.log('PASS rollback CAS preserves a later valid write; replay cannot hide divergence');

  const gated = await fixture();
  for (const key of Object.keys(gated.attestation.gates)) {
    const attestation = structuredClone(gated.attestation); attestation.gates[key]='UNKNOWN';
    const count = commits;
    await assert.rejects(applyRecovery({...gated,attestation}),/GATE_NOT_PASS/);
    assert.equal(commits,count);
  }
  console.log('PASS all offline gates deny writes before transport mutation');
  console.log('CLICK360 recovery emulator CAS/rollback/idempotency PASS; production requests=0');
} finally {
  try { process.kill(-emulator.pid,'SIGTERM'); } catch { emulator.kill('SIGTERM'); }
}
