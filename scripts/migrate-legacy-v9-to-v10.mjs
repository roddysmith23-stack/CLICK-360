import fs from 'node:fs/promises';
import path from 'node:path';
import { classifyTenant, stableHash, toV10Document } from './lib/click360-data-core.mjs';

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
  const [{ initializeApp, applicationDefault, cert, getApps }, { getFirestore }] = await Promise.all([import('firebase-admin/app'), import('firebase-admin/firestore')]);
  const credential = process.env.GOOGLE_APPLICATION_CREDENTIALS ? cert(JSON.parse(await fs.readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'))) : applicationDefault();
  const app = getApps()[0] || initializeApp({ credential, projectId });
  const db = getFirestore(app);
  const approvedUsers = (await db.collection('approvedUsers').get()).docs.map((doc) => ({ uid: doc.id, ...doc.data() }));
  const stateDocs = await db.collectionGroup('state').get();
  const tenants = stateDocs.docs.filter((doc) => doc.id === 'main').map((doc) => ({ pathBusinessId: doc.ref.parent.parent.id, ...doc.data() }));
  return { approvedUsers, tenants, db };
}
async function readAllowlist(file) { return new Set(JSON.parse(await fs.readFile(path.resolve(file), 'utf8'))); }

const source = args.fixture ? await fixtureSource(args.fixture) : await firebaseSource();
const allowlist = args.allowlist ? await readAllowlist(args.allowlist) : null;
const selected = source.tenants.filter((tenant) => !args.businessId || tenant.pathBusinessId === args.businessId).filter((tenant) => !allowlist || allowlist.has(tenant.pathBusinessId));
const results = [];

for (const tenant of selected) {
  const classified = classifyTenant(tenant, source.approvedUsers);
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
    await source.db.runTransaction(async (transaction) => {
      const current = await transaction.get(stateRef);
      if (!current.exists || stableHash({ pathBusinessId: tenant.pathBusinessId, ...current.data() }) !== sourceHash) throw new Error('Source document changed; migration aborted.');
      transaction.set(backupRef, { source: 'legacy_v9_before_migration', sourceHash, beforeCounts: migration.beforeCounts, originalDocument: tenant, backedUpAt: new Date().toISOString() });
      transaction.set(stateRef, { schemaVersion: 10, ownerUid: classified.ownerId, ownerId: classified.ownerId, businessId: tenant.pathBusinessId, tenantKey: `owner:${classified.ownerId}:business:${tenant.pathBusinessId}`, updatedBy: classified.ownerId, updatedAtMs: Date.now(), reason: 'administrative_legacy_v9_to_v10_migration', payload: migration.payload, migration: { sourceHash, beforeCounts: migration.beforeCounts, afterCounts: migration.afterCounts, logicalHash: migration.logicalHash } });
    });
    result.action = 'APPLIED';
  }
  results.push(result);
}

console.log(JSON.stringify({ projectId, mode: apply ? 'APPLY' : 'DRY_RUN', results }, null, 2));
