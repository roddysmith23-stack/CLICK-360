import fs from 'node:fs/promises';
import path from 'node:path';
import { initializeApp, applicationDefault, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { domainCounts, legacyStateFromDocument, stableHash } from './lib/click360-data-core.mjs';
import { firestoreHash, normalizeEmail, plainFirestoreValue } from './lib/click360-v16-admin-core.mjs';
import { REQUIRED_PROJECT_ID, V17_SUBJECTS, resolveAuthIdentity } from './lib/click360-v17-access-core.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const [key, inline] = argv[index].replace(/^--/, '').split('=');
    const next = argv[index + 1];
    result[key] = inline ?? (next && !next.startsWith('--') ? (index += 1, next) : true);
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
if (args.apply === true || args.write === true || args.migrate === true) {
  throw new Error('V17_APPLY_NOT_AUTHORIZED: this command is permanently read-only.');
}
const projectId = String(args.project || REQUIRED_PROJECT_ID);
if (projectId !== REQUIRED_PROJECT_ID) throw new Error(`Refusing project ${projectId}. Only ${REQUIRED_PROJECT_ID} is allowed.`);
const outputDir = path.resolve(String(args.out || 'artifacts/v17-access-audit'));
const maxDocuments = Math.max(100, Number(args['max-documents'] || 10000));
const maxDepth = Math.max(2, Number(args['max-depth'] || 8));

const app = initializeApp({ credential: applicationDefault(), projectId }, `click360-v17-audit-${Date.now()}`);
const auth = getAuth(app);
const db = getFirestore(app);

async function listAuthUsers() {
  const users = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    users.push(...page.users.map((user) => ({
      uid: user.uid,
      email: normalizeEmail(user.email),
      displayName: String(user.displayName || ''),
      disabled: user.disabled === true,
      providers: user.providerData.map((provider) => provider.providerId),
      creationTime: user.metadata.creationTime || null,
      lastSignInTime: user.metadata.lastSignInTime || null,
      customClaims: plainFirestoreValue(user.customClaims || {})
    })));
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

async function walkFirestore() {
  const records = [];
  const recordPaths = new Set();
  const collectionCounts = {};
  const visitedCollections = new Set();
  function addRecord(doc) {
    if (recordPaths.has(doc.ref.path)) return;
    if (records.length >= maxDocuments) throw new Error(`Firestore traversal exceeded ${maxDocuments} documents.`);
    recordPaths.add(doc.ref.path);
    records.push({
      path: doc.ref.path,
      id: doc.id,
      ref: doc.ref,
      data: doc.data() || {},
      createTime: doc.createTime?.toDate?.().toISOString?.() || null,
      updateTime: doc.updateTime?.toDate?.().toISOString?.() || null
    });
  }
  const roots = await db.listCollections();
  const recursiveRoots = new Set(['businesses', 'organizations', 'userOrganizations']);
  const pending = roots.map((collectionRef) => ({ collectionRef, depth: 1, rootId: collectionRef.id }));
  while (pending.length) {
    const batch = pending.splice(0, 20).filter(({ collectionRef }) => !visitedCollections.has(collectionRef.path));
    const discovered = await Promise.all(batch.map(async ({ collectionRef, depth, rootId }) => {
      if (depth > maxDepth) throw new Error(`Firestore traversal exceeded max depth at ${collectionRef.path}.`);
      visitedCollections.add(collectionRef.path);
      const snapshot = await collectionRef.get();
      collectionCounts[collectionRef.path] = snapshot.size;
      snapshot.docs.forEach(addRecord);
      if (!recursiveRoots.has(rootId) || depth >= maxDepth) return [];
      const children = await Promise.all(snapshot.docs.map((doc) => doc.ref.listCollections()));
      return children.flat().map((child) => ({ collectionRef: child, depth: depth + 1, rootId }));
    }));
    pending.push(...discovered.flat());
  }
  for (const groupId of ['state', 'legacyBackups', 'members', 'invitations', 'organizations']) {
    const snapshot = await db.collectionGroup(groupId).get();
    collectionCounts[`collectionGroup:${groupId}`] = snapshot.size;
    snapshot.docs.forEach(addRecord);
  }
  return { records, collectionCounts, rootCollections: roots.map((collection) => collection.id).sort() };
}

function scalarEntries(value, prefix = '', entries = []) {
  if (value == null || typeof value !== 'object') {
    entries.push({ field: prefix || '$', value });
    return entries;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scalarEntries(item, `${prefix}[${index}]`, entries));
    return entries;
  }
  for (const [key, item] of Object.entries(value)) {
    scalarEntries(item, prefix ? `${prefix}.${key}` : key, entries);
  }
  return entries;
}

function safeResolution(resolution) {
  return {
    status: resolution.status,
    confirmed: resolution.confirmed === true,
    user: resolution.user ? {
      uid: resolution.user.uid,
      email: resolution.user.email,
      displayName: resolution.user.displayName,
      disabled: resolution.user.disabled,
      providers: resolution.user.providers,
      creationTime: resolution.user.creationTime,
      lastSignInTime: resolution.user.lastSignInTime,
      customClaims: resolution.user.customClaims
    } : null,
    candidates: (resolution.candidates || []).map((user) => ({
      uid: user.uid, email: user.email, displayName: user.displayName, disabled: user.disabled,
      providers: user.providers, creationTime: user.creationTime, lastSignInTime: user.lastSignInTime,
      customClaims: user.customClaims
    })),
    conflict: resolution.conflict || null
  };
}

function matchingFields(record, exactTokens, fuzzyTerms) {
  const plain = plainFirestoreValue(record.data);
  const fields = scalarEntries(plain);
  const exact = [];
  const fuzzy = [];
  const normalizedPath = record.path.toLowerCase();
  for (const token of exactTokens) {
    if (token && normalizedPath.includes(token.toLowerCase())) exact.push('$path');
  }
  for (const entry of fields) {
    if (typeof entry.value !== 'string') continue;
    const normalized = entry.value.trim().toLowerCase();
    if (exactTokens.some((token) => token && (normalized === token || normalized.includes(token)))) exact.push(entry.field);
    if (fuzzyTerms.some((term) => term.length >= 5 && normalized.includes(term))) fuzzy.push(entry.field);
  }
  return { exact: [...new Set(exact)].slice(0, 100), fuzzy: [...new Set(fuzzy)].slice(0, 100) };
}

function summarizeAccount(record) {
  if (!record) return { exists: false, hash: firestoreHash(null) };
  const data = plainFirestoreValue(record.data);
  return {
    exists: true,
    path: record.path,
    hash: firestoreHash(record.data),
    updateTime: record.updateTime,
    uid: data.uid || null,
    email: normalizeEmail(data.email),
    businessId: data.businessId || null,
    primaryOrganizationId: data.primaryOrganizationId || null,
    status: data.status || null,
    platformRole: data.platformRole || null,
    organizationRole: data.organizationRole || null,
    adminLevel: data.adminLevel || null,
    plan: data.plan || null,
    planCode: data.planCode || null,
    billingStatus: data.billingStatus || null,
    lifetime: data.lifetime === true,
    expiresAt: data.expiresAt ?? null,
    customerTier: data.customerTier || null,
    source: data.source || null,
    entitlementVersion: Number(data.entitlementVersion || 0),
    revision: Number(data.revision || 0),
    trialDays: data.trialDays ?? null,
    trialStartedAt: data.trialStartedAt ?? null
  };
}

function summarizeApproved(record) {
  if (!record) return { exists: false, hash: firestoreHash(null) };
  const data = plainFirestoreValue(record.data);
  return {
    exists: true,
    path: record.path,
    hash: firestoreHash(record.data),
    uid: data.uid || record.id,
    email: normalizeEmail(data.email),
    name: String(data.name || ''),
    role: data.role || null,
    ownerId: data.ownerId || null,
    status: data.status || null,
    approved: data.approved === true
  };
}

function summarizeRelatedRecord(record) {
  const data = plainFirestoreValue(record.data || {});
  return {
    path: record.path,
    hash: firestoreHash(record.data || {}),
    updateTime: record.updateTime,
    action: data.action || data.eventType || null,
    targetPath: data.targetPath || null,
    uid: data.uid || null,
    email: normalizeEmail(data.email),
    actorEmail: normalizeEmail(data.actorEmail),
    status: data.status || null,
    plan: data.planCode || data.plan || null,
    source: data.source || null,
    backupPath: data.backupPath || null,
    beforeHash: data.beforeHash || null,
    requestId: data.requestId || null
  };
}

function tenantData(document) {
  if (document?.schemaVersion === 10) return document.payload?.data || {};
  return legacyStateFromDocument(document) || {};
}

function summarizeTenant(record, authByUid) {
  const raw = record.data || {};
  const state = tenantData(raw);
  const pathBusinessId = record.path.split('/')[1] || null;
  return {
    path: record.path,
    pathBusinessId,
    ownerAuthEmail: authByUid.get(raw.ownerId || pathBusinessId)?.email || null,
    schemaVersion: raw.schemaVersion || null,
    ownerUid: raw.ownerUid || null,
    ownerId: raw.ownerId || null,
    businessId: raw.businessId || null,
    tenantKey: raw.tenantKey || null,
    revision: Number(raw.revision || 0),
    updatedBy: raw.updatedBy || null,
    updatedByEmail: normalizeEmail(raw.updatedByEmail),
    hash: firestoreHash(raw),
    updateTime: record.updateTime,
    counts: domainCounts(state)
  };
}

function findDirect(recordsByPath, pathValue) {
  return pathValue ? recordsByPath.get(pathValue) || null : null;
}

function markdown(report) {
  const subjectRows = Object.entries(report.subjects).map(([key, subject]) => {
    const candidate = subject.identity.user || subject.identity.candidates[0] || {};
    return `| ${subject.label} | ${subject.identity.status} | ${candidate.email || '-'} | ${candidate.uid || '-'} | ${subject.accountAccess.status || '-'} | ${subject.accountAccess.planCode || subject.accountAccess.plan || '-'} | ${subject.canonicalTenant.exists ? 'sí' : 'no'} | ${subject.exactFirestoreHits.length} |`;
  }).join('\n');
  const tenantRows = report.tenants.map((tenant) => `| ${tenant.path} | ${tenant.ownerAuthEmail || '-'} | ${tenant.schemaVersion || 'legacy'} | ${tenant.hash} | ${JSON.stringify(tenant.counts)} | ${tenant.readbackUnchanged ? 'PASS' : 'FAIL'} |`).join('\n');
  return `# CLICK 360 V17 - Auditoría preflight\n\nFecha: ${report.generatedAt}\n\nProyecto: \`${report.projectId}\`\n\nModo: \`${report.mode}\`\n\nEscrituras de producción: **${report.productionWriteOperations}**\n\n## Identidades\n\n| Persona | Resolución Auth | Correo encontrado | UID encontrado | Acceso actual | Plan actual | Tenant canónico | Hits exactos |\n| --- | --- | --- | --- | --- | --- | --- | ---: |\n${subjectRows}\n\n## Tenants\n\n| Ruta | Auth owner | Schema | Hash | Conteos | Readback |\n| --- | --- | ---: | --- | --- | --- |\n${tenantRows}\n\n## Integridad\n\n- Documentos inspeccionados: ${report.firestore.documentCount}\n- Colecciones raíz: ${report.firestore.rootCollections.join(', ')}\n- Hash global de inventario: \`${report.firestore.inventoryHash}\`\n- Relectura sin cambios: **${report.integrity.allReadbacksUnchanged ? 'PASS' : 'FAIL'}**\n- Apply habilitado: **NO**\n`;
}

const generatedAt = new Date().toISOString();
const authUsers = await listAuthUsers();
const authByUid = new Map(authUsers.map((user) => [user.uid, user]));
const traversal = await walkFirestore();
traversal.records.sort((left, right) => left.path.localeCompare(right.path));
const recordsByPath = new Map(traversal.records.map((record) => [record.path, record]));
const resolutions = Object.fromEntries(Object.entries(V17_SUBJECTS).map(([key, subject]) => [key, resolveAuthIdentity(subject, authUsers)]));

const subjects = {};
for (const [key, subject] of Object.entries(V17_SUBJECTS)) {
  const resolution = resolutions[key];
  const identityUsers = [resolution.user, ...(resolution.candidates || [])].filter(Boolean);
  const exactTokens = [...new Set([
    normalizeEmail(subject.requiredEmail),
    String(subject.confirmedUid || ''),
    ...identityUsers.flatMap((user) => [String(user.uid || ''), normalizeEmail(user.email)])
  ].filter(Boolean))];
  const fuzzyTerms = [...new Set((subject.legacySearchTerms || []).map((term) => String(term).trim().toLowerCase()).filter(Boolean))];
  const hits = [];
  for (const record of traversal.records) {
    const match = matchingFields(record, exactTokens, fuzzyTerms);
    if (match.exact.length || match.fuzzy.length) {
      hits.push({
        path: record.path,
        documentHash: firestoreHash(record.data),
        updateTime: record.updateTime,
        exactFields: match.exact,
        fuzzyFields: match.fuzzy
      });
    }
  }
  const uid = resolution.user?.uid || (resolution.candidates?.length === 1 ? resolution.candidates[0].uid : null);
  const account = findDirect(recordsByPath, uid ? `accountAccess/${uid}` : null);
  const approved = findDirect(recordsByPath, uid ? `approvedUsers/${uid}` : null);
  const canonicalTenantRecord = findDirect(recordsByPath, uid ? `businesses/${uid}/state/main` : null);
  subjects[key] = {
    label: subject.label,
    requiredEmail: subject.requiredEmail,
    confirmedUid: subject.confirmedUid,
    desired: subject.desired,
    identity: safeResolution(resolution),
    accountAccess: summarizeAccount(account),
    approvedUser: summarizeApproved(approved),
    canonicalTenant: canonicalTenantRecord
      ? { exists: true, ...summarizeTenant(canonicalTenantRecord, authByUid) }
      : { exists: false, path: uid ? `businesses/${uid}/state/main` : null, hash: null, counts: domainCounts({}) },
    exactFirestoreHits: hits.filter((hit) => hit.exactFields.length),
    fuzzyFirestoreHits: hits.filter((hit) => !hit.exactFields.length && hit.fuzzyFields.length),
    relatedRecordSummaries: hits.filter((hit) => hit.exactFields.length)
      .map((hit) => recordsByPath.get(hit.path))
      .filter(Boolean)
      .map(summarizeRelatedRecord)
  };
}

const stateRecords = traversal.records.filter((record) => /^businesses\/[^/]+\/state\/main$/.test(record.path));
const tenants = stateRecords.map((record) => summarizeTenant(record, authByUid));
const readbacks = [];
for (const record of [...stateRecords, ...Object.values(subjects)
  .map((subject) => subject.accountAccess.exists ? recordsByPath.get(subject.accountAccess.path) : null)
  .filter(Boolean)]) {
  const after = await record.ref.get();
  const afterHash = after.exists ? firestoreHash(after.data() || {}) : null;
  readbacks.push({ path: record.path, beforeHash: firestoreHash(record.data), afterHash, unchanged: after.exists && afterHash === firestoreHash(record.data) });
}
const readbackByPath = new Map(readbacks.map((item) => [item.path, item]));
for (const tenant of tenants) tenant.readbackUnchanged = readbackByPath.get(tenant.path)?.unchanged === true;

const safeRecords = traversal.records.map((record) => ({
  path: record.path,
  hash: firestoreHash(record.data),
  createTime: record.createTime,
  updateTime: record.updateTime
}));
const report = {
  generatedAt,
  projectId,
  mode: 'FIREBASE_READ_ONLY',
  productionWriteOperations: 0,
  subjects,
  tenants,
  firestore: {
    documentCount: traversal.records.length,
    rootCollections: traversal.rootCollections,
    collectionCounts: traversal.collectionCounts,
    inventory: safeRecords,
    inventoryHash: stableHash(safeRecords),
    accountAccessInventory: traversal.records.filter((record) => /^accountAccess\/[^/]+$/.test(record.path)).map(summarizeAccount),
    approvedUsersInventory: traversal.records.filter((record) => /^approvedUsers\/[^/]+$/.test(record.path)).map(summarizeApproved),
    backupInventory: traversal.records.filter((record) => /^(adminBackups\/|businesses\/[^/]+\/legacyBackups\/)/.test(record.path)).map(summarizeRelatedRecord),
    auditInventory: traversal.records.filter((record) => /^(adminAuditLogs\/|auditLogs\/)/.test(record.path)).map(summarizeRelatedRecord)
  },
  integrity: {
    readbacks,
    allReadbacksUnchanged: readbacks.length > 0 && readbacks.every((item) => item.unchanged)
  }
};
report.reportHash = stableHash(report);

await fs.mkdir(outputDir, { recursive: true });
await Promise.all([
  fs.writeFile(path.join(outputDir, 'CLICK360_V17_AUDIT.json'), JSON.stringify(report, null, 2)),
  fs.writeFile(path.join(outputDir, 'CLICK360_V17_AUDIT.md'), markdown(report)),
  fs.writeFile(path.join(outputDir, 'CLICK360_V17_AUDIT_SHA256.txt'), `${report.reportHash}\n`)
]);

console.log(JSON.stringify({
  projectId,
  mode: report.mode,
  productionWriteOperations: report.productionWriteOperations,
  documentCount: report.firestore.documentCount,
  tenantCount: tenants.length,
  subjectStatuses: Object.fromEntries(Object.entries(subjects).map(([key, subject]) => [key, subject.identity.status])),
  allReadbacksUnchanged: report.integrity.allReadbacksUnchanged,
  reportHash: report.reportHash,
  outputDir
}, null, 2));
await deleteApp(app);
