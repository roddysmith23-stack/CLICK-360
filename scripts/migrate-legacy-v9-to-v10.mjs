import fs from 'node:fs/promises';
import path from 'node:path';
import { classifyTenant, domainCounts, equalCounts, stableHash, toV10Document } from './lib/click360-data-core.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const [key, inlineValue] = argv[index].replace(/^--/, '').split('=');
    const next = argv[index + 1];
    result[key] = inlineValue ?? (next && !next.startsWith('--') ? (index += 1, next) : true);
  }
  return result;
}
const args = parseArgs(process.argv.slice(2));
const REQUIRED_PROJECT_ID = 'click-360';
const projectId = args.project || REQUIRED_PROJECT_ID;
if (projectId !== REQUIRED_PROJECT_ID) throw new Error(`Refusing project ${projectId}. Only ${REQUIRED_PROJECT_ID} is allowed.`);
const apply = args.apply === true;
if (apply && !args.businessId && !args.allowlist) throw new Error('--apply requires --businessId or --allowlist. --apply-all is not supported.');

async function fixtureSource(file) { return JSON.parse(await fs.readFile(path.resolve(file), 'utf8')); }
async function firebaseSource() {
  const [{ initializeApp, applicationDefault, cert, getApps }, { getFirestore }, { getAuth }] = await Promise.all([import('firebase-admin/app'), import('firebase-admin/firestore'), import('firebase-admin/auth')]);
  const credential = process.env.GOOGLE_APPLICATION_CREDENTIALS ? cert(JSON.parse(await fs.readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'))) : applicationDefault();
  const app = getApps()[0] || initializeApp({ credential, projectId });
  const db = getFirestore(app);
  const approvedUsers = (await db.collection('approvedUsers').get()).docs.map((doc) => ({ uid: doc.id, ...doc.data() }));
  const stateDocs = await db.collectionGroup('state').get();
  const tenants = stateDocs.docs.filter((doc) => doc.id === 'main').map((doc) => ({ pathBusinessId: doc.ref.parent.parent.id, ...doc.data() }));
  const auth = getAuth(app); let pageToken; const authUsers = [];
  do { const page = await auth.listUsers(1000, pageToken); authUsers.push(...page.users.map((user) => ({ uid: user.uid, email: user.email || null }))); pageToken = page.pageToken; } while (pageToken);
  return { approvedUsers, authUsers, tenants, db };
}
async function readAllowlist(file) { return new Set(JSON.parse(await fs.readFile(path.resolve(file), 'utf8'))); }

function verifyV10Document(document, migration, context) {
  const expectedTenantKey = `owner:${context.ownerId}:business:${context.businessId}`;
  const payload = document.payload || {};
  const checks = {
    schemaVersion: document.schemaVersion === 10,
    ownerUid: document.ownerUid === context.ownerId,
    ownerId: document.ownerId === context.ownerId,
    businessId: document.businessId === context.businessId,
    tenantKey: document.tenantKey === expectedTenantKey,
    payloadIdentity: payload.identity?.ownerUid === context.ownerId
      && payload.identity?.ownerId === context.ownerId
      && payload.identity?.businessId === context.businessId
      && payload.identity?.tenantKey === expectedTenantKey,
    counts: equalCounts(migration.beforeCounts, domainCounts(payload.data || {})),
    logicalHash: stableHash(payload.data || {}) === migration.logicalHash
  };
  if (!Object.values(checks).every(Boolean)) throw new Error(`Post-migration verification failed: ${JSON.stringify(checks)}`);
  return checks;
}

const source = args.fixture ? await fixtureSource(args.fixture) : await firebaseSource();
const allowlist = args.allowlist ? await readAllowlist(args.allowlist) : null;
const selected = source.tenants.filter((tenant) => !args.businessId || tenant.pathBusinessId === args.businessId).filter((tenant) => !allowlist || allowlist.has(tenant.pathBusinessId));
const results = [];

for (const tenant of selected) {
  const classified = classifyTenant(tenant, source.approvedUsers, source.authUsers || []);
  if (classified.category !== 'LEGACY_CLEAR_OWNER') {
    results.push({ businessId: tenant.pathBusinessId, action: 'BLOCKED', category: classified.category, reasons: classified.reasons });
    continue;
  }
  const migration = toV10Document(tenant, { ownerId: classified.ownerId, businessId: tenant.pathBusinessId });
  const sourceHash = stableHash(tenant);
  const result = { businessId: tenant.pathBusinessId, action: apply ? 'APPLY_PENDING' : 'DRY_RUN_PASS', category: classified.category, sourceHash, beforeCounts: migration.beforeCounts, afterCounts: migration.afterCounts, logicalHash: migration.logicalHash };
  if (apply && source.db) {
    const stateRef = source.db.collection('businesses').doc(tenant.pathBusinessId).collection('state').doc('main');
    const backupRef = source.db.collection('businesses').doc(tenant.pathBusinessId).collection('legacyBackups').doc(`v9-${Date.now()}`);
    const context = { ownerId: classified.ownerId, businessId: tenant.pathBusinessId };
    await backupRef.create({
      source: 'legacy_v9_before_migration',
      sourceHash,
      beforeCounts: migration.beforeCounts,
      originalDocument: tenant,
      backedUpAt: new Date().toISOString(),
      backedUpBy: classified.ownerId
    });
    const backup = await backupRef.get();
    if (!backup.exists || backup.data().sourceHash !== sourceHash || stableHash(backup.data().originalDocument) !== sourceHash) {
      throw new Error('Administrative backup verification failed; migration aborted before state write.');
    }
    await source.db.runTransaction(async (transaction) => {
      const current = await transaction.get(stateRef);
      const currentBackup = await transaction.get(backupRef);
      if (!current.exists || stableHash({ pathBusinessId: tenant.pathBusinessId, ...current.data() }) !== sourceHash) throw new Error('Source document changed; migration aborted.');
      if (!currentBackup.exists || currentBackup.data().sourceHash !== sourceHash) throw new Error('Administrative backup disappeared; migration aborted.');
      transaction.set(stateRef, { schemaVersion: 10, ownerUid: classified.ownerId, ownerId: classified.ownerId, businessId: tenant.pathBusinessId, tenantKey: `owner:${classified.ownerId}:business:${tenant.pathBusinessId}`, updatedBy: classified.ownerId, updatedAtMs: Date.now(), reason: 'administrative_legacy_v9_to_v10_migration', payload: migration.payload, migration: { sourceHash, beforeCounts: migration.beforeCounts, afterCounts: migration.afterCounts, logicalHash: migration.logicalHash, backupPath: backupRef.path } });
    });
    const migrated = await stateRef.get();
    result.backupPath = backupRef.path;
    result.backupVerified = true;
    result.postVerification = verifyV10Document(migrated.data(), migration, context);
    result.action = 'APPLIED_VERIFIED';
  }
  results.push(result);
}

console.log(JSON.stringify({ projectId, mode: apply ? 'APPLY' : 'DRY_RUN', results }, null, 2));
