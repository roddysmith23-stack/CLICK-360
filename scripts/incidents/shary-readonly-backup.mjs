#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connectAdmin } from '../lib/firebase-admin-connect.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((entry) => {
  const [key, ...rest] = entry.replace(/^--/, '').split('=');
  return [key, rest.join('=') || true];
}));

const projectId = String(args.project || '');
const businessName = String(args['business-name'] || '');
const outputDirectory = path.resolve(String(args.out || ''));

if (args['read-only'] !== true) throw new Error('Pass --read-only to acknowledge that this tool only performs server reads.');
if (projectId !== 'click-360') throw new Error('This incident acquisition is pinned to the click-360 project.');
if (!businessName || !args.out) throw new Error('Usage: --read-only --project=click-360 --business-name=SHARY --out=<ignored-private-directory>');

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function nativeDocument(snapshot) {
  const fields = snapshot?._fieldsProto;
  if (!snapshot?.exists || !fields) throw new Error(`Could not preserve native Firestore fields for ${snapshot?.ref?.path || 'unknown document'}.`);
  const canonicalFields = canonicalJson(fields);
  return {
    name: snapshot.ref.path,
    createTime: snapshot.createTime?.toDate?.().toISOString?.() || null,
    updateTime: snapshot.updateTime?.toDate?.().toISOString?.() || null,
    readTime: snapshot.readTime?.toDate?.().toISOString?.() || null,
    fields,
    fieldsSha256: sha256(canonicalFields),
    fieldsBytes: Buffer.byteLength(canonicalFields)
  };
}

async function getCollectionDocuments(reference) {
  const snapshot = await reference.get();
  return snapshot.docs.map(nativeDocument);
}

const db = await connectAdmin(projectId, 'shary-incident-readonly-backup');
const stateSnapshots = await db.collectionGroup('state').get();
const normalizedBusinessName = businessName.trim().toUpperCase();
const candidates = stateSnapshots.docs.filter((snapshot) => {
  if (snapshot.id !== 'main' || snapshot.ref.parent.parent?.parent.id !== 'businesses') return false;
  const businesses = snapshot.data()?.payload?.data?.businesses || [];
  return businesses.some((business) => String(business?.name || '').trim().toUpperCase() === normalizedBusinessName);
});

if (candidates.length !== 1) throw new Error(`Expected exactly one ${businessName} tenant, found ${candidates.length}.`);

const stateSnapshot = await candidates[0].ref.get();
const ownerReference = stateSnapshot.ref.parent.parent;
const ownerId = ownerReference.id;
const rootAuditEvents = await getCollectionDocuments(ownerReference.collection('auditEvents'));
const businessUnitSnapshots = await ownerReference.collection('businessUnits').get();
const businessUnitAuditEvents = [];
for (const unitSnapshot of businessUnitSnapshots.docs) {
  const events = await getCollectionDocuments(unitSnapshot.ref.collection('auditEvents'));
  businessUnitAuditEvents.push({ businessUnitId: unitSnapshot.id, documents: events });
}
const adminAuditSnapshots = await db.collection('adminAuditLogs').where('uid', '==', ownerId).get();
const adminAuditLogs = adminAuditSnapshots.docs.map(nativeDocument);

const stateData = stateSnapshot.data();
const commercialState = stateData?.payload?.data || {};
const acquisition = {
  format: 'click360-firestore-native-backup-v1',
  nativeValueEncoding: 'google.firestore.v1.Value (Admin SDK fieldsProto)',
  projectId,
  capturedAt: new Date().toISOString(),
  acquisitionMode: 'server-read-only',
  tenant: {
    ownerId,
    ownerPath: ownerReference.path,
    matchedBusinessIds: (commercialState.businesses || [])
      .filter((business) => String(business?.name || '').trim().toUpperCase() === normalizedBusinessName)
      .map((business) => business.id)
  },
  documents: {
    stateMain: nativeDocument(stateSnapshot),
    rootAuditEvents,
    businessUnitAuditEvents,
    adminAuditLogs
  }
};

await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
const backupPath = path.join(outputDirectory, 'firestore-native-backup.private.json');
const backupJson = `${canonicalJson(acquisition)}\n`;
await writeFile(backupPath, backupJson, { mode: 0o600 });
await chmod(backupPath, 0o600);

const collections = ['products', 'sales', 'movements', 'cashSessions', 'dailyReports'];
const counts = Object.fromEntries(collections.map((key) => [key, Array.isArray(commercialState[key]) ? commercialState[key].length : 0]));
const manifest = {
  format: acquisition.format,
  projectId,
  capturedAt: acquisition.capturedAt,
  acquisitionMode: acquisition.acquisitionMode,
  sourcePath: stateSnapshot.ref.path,
  sourcePathSha256: sha256(stateSnapshot.ref.path),
  sourceCreateTime: acquisition.documents.stateMain.createTime,
  sourceUpdateTime: acquisition.documents.stateMain.updateTime,
  sourceRevision: stateData?.revision ?? stateData?.payload?.revision ?? null,
  nativeValueEncoding: acquisition.nativeValueEncoding,
  counts: {
    ...counts,
    rootAuditEvents: rootAuditEvents.length,
    businessUnitAuditEvents: businessUnitAuditEvents.reduce((sum, unit) => sum + unit.documents.length, 0),
    adminAuditLogs: adminAuditLogs.length
  },
  documentHashes: {
    stateMainFieldsSha256: acquisition.documents.stateMain.fieldsSha256,
    auditDocumentsSha256: sha256(canonicalJson({ rootAuditEvents, businessUnitAuditEvents, adminAuditLogs }))
  },
  backupFile: path.basename(backupPath),
  backupBytes: Buffer.byteLength(backupJson),
  backupSha256: sha256(backupJson)
};
const manifestPath = path.join(outputDirectory, 'manifest.private.json');
const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile(manifestPath, manifestJson, { mode: 0o600 });
await chmod(manifestPath, 0o600);

console.log(JSON.stringify({
  capturedAt: manifest.capturedAt,
  sourcePathSha256: manifest.sourcePathSha256,
  sourceUpdateTime: manifest.sourceUpdateTime,
  sourceRevision: manifest.sourceRevision,
  counts: manifest.counts,
  backupBytes: manifest.backupBytes,
  backupSha256: manifest.backupSha256,
  outputDirectory
}, null, 2));
