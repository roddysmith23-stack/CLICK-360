// Support-only: authoritative reads and private local evidence. No restore,
// commercial write, journal replay, activation or cutover capability.
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {connectAdmin} from './lib/firebase-admin-connect.mjs';
import '../spark-modular-migration.js';

const [project, identityFile, expectedOwnerHash, out] = process.argv.slice(2);
assert(project && identityFile && /^[a-f0-9]{64}$/.test(expectedOwnerHash || '') && out,
  'Usage: project private-identity.json expected-owner-sha256 new-private-output-directory');
const {owner} = JSON.parse(await readFile(identityFile, 'utf8'));
assert.equal(createHash('sha256').update(owner).digest('hex'), expectedOwnerHash);
assert(!owner.includes('/'));
await mkdir(out, {mode:0o700}); // Never reuse/overwrite previous evidence.
const api = globalThis.CLICK360_SPARK_MIGRATION;
const db = await connectAdmin(project, 'recovery-readonly-inspection');
const save = (name, value) => writeFile(`${out}/${name}`, JSON.stringify(value, null, 2), {mode:0o600, flag:'wx'});
const safeReason = error => /^[A-Z0-9_]+$/.test(error.message || '') ? error.message : 'INSPECTION_FAILED';
try {
  const legacy = await db.doc(`businesses/${owner}/state/main`).get();
  assert(legacy.exists);
  const remote = legacy.data(), remoteHash = await api.hash(remote.payload.data);
  await save('legacy.private.json', remote);
  // Small bounded manifest census, with complete pagination of every part.
  const manifests = await db.collection(`businesses/${owner}/recoveryCopies`).orderBy('createdAt','desc').limit(10).get();
  const results = [];
  for (const doc of manifests.docs) {
    const m = doc.data();
    assert.equal(m.ownerUid, owner); assert.equal(m.captureHash, doc.id);
    if (m.state !== 'CLIENT_VERIFIED') { results.push({captureHash:doc.id, state:m.state, verified:false}); continue; }
    assert.equal(m.schemaVersion, 2);
    assert(Number.isSafeInteger(m.partCount) && m.partCount > 0 && m.partCount <= 1024);
    assert(Number.isSafeInteger(m.payloadBytes) && m.payloadBytes <= 16*1024*1024);
    const parts = []; let cursor = null, readBytes = 0;
    do {
      let q = doc.ref.collection('parts').orderBy('position').limit(100);
      if (cursor !== null) q = q.startAfter(cursor);
      const page = await q.get();
      for (const d of page.docs) {
        const p = d.data();
        assert(typeof p.content==='string' && p.content.length<=48000);
        readBytes+=Buffer.byteLength(p.content,'utf8');
        assert(readBytes<=m.payloadBytes,'Fragment stream exceeds declared bounded capture');
        assert.equal(d.id, `p${parts.length}`); assert.equal(p.position, parts.length);
        assert.equal(p.ownerUid, owner); assert.equal(p.captureHash, doc.id); assert.equal(p.schemaVersion,2);
        assert.equal(await api.hash(p.content), p.contentHash);
        parts.push(p); assert(parts.length <= m.partCount);
      }
      cursor = page.size === 100 ? parts.at(-1).position : null;
    } while (cursor !== null);
    assert.equal(parts.length, m.partCount);
    const text = parts.map(p=>p.content).join(''), capture = JSON.parse(text);
    assert.equal(api.canonicalJson(capture), text); assert.equal(api.byteLength(capture),m.payloadBytes);
    assert.equal(await api.hash(capture),doc.id); assert.equal(capture.ownerUid,owner);
    assert.equal(capture.schemaVersion,2); assert.equal(capture.deviceId,m.deviceId);
    assert.equal(capture.buildSha,m.buildSha); assert.equal(capture.record.deviceRevision,m.deviceRevision);
    assert.equal(await api.hash(capture.record.snapshot),m.sourceHash);
    assert.equal(await api.hash(capture.journalCapture),m.journalHash);
    assert.equal(capture.journalCapture.enumerationComplete,true);
    assert.equal(capture.journalCapture.rows.length,capture.journalCapture.recordCount);
    assert.equal(capture.remoteReference.source,'server');
    assert.equal(capture.remoteReference.hash,m.remoteHash); assert.equal(capture.remoteReference.revision,m.remoteRevision);
    await save(`${doc.id}.capture.private.json`,capture);
    const state=capture.record.snapshot, rows=capture.journalCapture.rows;
    const modules={};
    for(const key of ['products','sales','movements','cashSessions','dailyReports','auditLogs']) {
      const local=state[key]||[], old=remote.payload.data[key]||[];
      const indexed=new Map(old.map(row=>[row.id,row]));
      const ids=new Set(local.map(row=>row.id));
      modules[key]={local:local.length,legacy:old.length,duplicateIds:local.length-ids.size,
        added:local.filter(row=>!indexed.has(row.id)).length,
        removed:old.filter(row=>!ids.has(row.id)).length,
        changed:(await Promise.all(local.filter(row=>indexed.has(row.id)).map(async row=>
          await api.hash(row)!==await api.hash(indexed.get(row.id))))).filter(Boolean).length};
    }
    let migration;
    try {
      const record=capture.record;
      const selected=await api.selectSource({ownerUid:owner,
        remote:{source:'server',revision:remote.revision,identity:remote.payload.identity,snapshot:remote.payload.data},
        local:{...record,durable:true},unknownOperations:rows.filter(r=>['unknown','inflight'].includes(r.state)).length});
      const manifest=await api.plan({ownerUid:owner,snapshot:selected.snapshot,identity:selected.identity,
        remoteRevision:selected.remoteRevision,deviceRevision:selected.deviceRevision});
      // This is a LOCAL codec roundtrip, NOT remote shadow equality/cutover.
      const roundtrip=await api.compare({manifest,source:state,remoteRecords:structuredClone(manifest.records)});
      const cash=[];
      for(const businessId of selected.businessIds) {
        const checked=await api.deriveCashSummaries({snapshot:state,businessId});
        cash.push({businessHash:await api.hash(businessId),canProceed:checked.canProceed,
          verifiedSessions:Object.keys(checked.verified).length,
          failureReasons:checked.failures.reduce((counts,f)=>({...counts,[f.reason]:(counts[f.reason]||0)+1}),{})});
      }
      migration={sourceSelection:selected.source,localCodecRoundtrip:roundtrip.status,
        sourceHash:roundtrip.sourceHash,reconstructedHash:roundtrip.reconstructedHash,
        recordCount:manifest.recordCount,cash,remoteShadowVerified:false,cutover:false};
    } catch(error) { migration={blocked:true,reason:safeReason(error),cutover:false}; }
    results.push({captureHash:doc.id,sourceHash:m.sourceHash,verified:true,
      createdAt:m.createdAt?.toDate().toISOString(),clientVerifiedAt:m.clientVerifiedAt?.toDate().toISOString(),
      deviceHash:await api.hash(m.deviceId),buildSha:m.buildSha,payloadBytes:m.payloadBytes,
      matchesHistoricalWriterDevice:typeof remote.deviceId==='string'?remote.deviceId===m.deviceId:null,
      journalRows:rows.length,unknown:rows.filter(r=>['unknown','inflight'].includes(r.state)).length,
      snapshotPendingOperations:(capture.record.pendingOperations||[]).length,
      historicalReferenceStillMatches:m.remoteRevision===remote.revision&&m.remoteHash===remoteHash,
      modules,migration,operationalCloudConfirmed:false});
  }
  const report={readOnly:true,commercialWrites:0,project,legacyRevision:remote.revision,
    physicalDeviceOriginNotAssumed:true,results};
  await save('report.json',report); console.log(JSON.stringify(report,null,2));
} finally { await db.terminate(); }
