import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyTenant } from '../lib/click360-data-core.mjs';

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
const outputDir = path.resolve(args.out || 'artifacts/firebase-audit');

async function loadFixture(file) {
  return JSON.parse(await fs.readFile(path.resolve(file), 'utf8'));
}

async function loadFirebase() {
  const [{ initializeApp, applicationDefault, cert, getApps }, { getFirestore }, { getAuth }] = await Promise.all([
    import('firebase-admin/app'), import('firebase-admin/firestore'), import('firebase-admin/auth')
  ]);
  const credential = process.env.GOOGLE_APPLICATION_CREDENTIALS ? cert(JSON.parse(await fs.readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'))) : applicationDefault();
  const app = getApps()[0] || initializeApp({ credential, projectId });
  const db = getFirestore(app);
  const approvedUsers = (await db.collection('approvedUsers').get()).docs.map((doc) => ({ uid: doc.id, ...doc.data() }));
  const approvedUsersByEmail = (await db.collection('approvedUsersByEmail').get()).docs.map((doc) => ({ email: doc.id, ...doc.data() }));
  const tenantDocs = await db.collectionGroup('state').get();
  const tenants = tenantDocs.docs.filter((doc) => doc.id === 'main').map((doc) => ({ pathBusinessId: doc.ref.parent.parent.id, ...doc.data() }));
  let authUsers = [];
  try {
    const auth = getAuth(app); let pageToken;
    do { const page = await auth.listUsers(1000, pageToken); authUsers.push(...page.users.map((user) => ({ uid: user.uid, email: user.email || null, disabled: user.disabled, provider: user.providerData.map((provider) => provider.providerId), creationTime: user.metadata.creationTime, lastSignInTime: user.metadata.lastSignInTime }))); pageToken = page.pageToken; } while (pageToken);
  } catch (error) { console.warn(`Auth cross-check unavailable: ${error.code || error.message}`); }
  return { approvedUsers, approvedUsersByEmail, tenants, authUsers };
}

function csvEscape(value) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
function toCsv(rows) {
  const keys = ['pathBusinessId', 'category', 'ownerId', 'schemaVersion', 'updatedBy', 'updatedByEmail', 'reasons'];
  return [keys.join(','), ...rows.map((row) => keys.map((key) => csvEscape(Array.isArray(row[key]) ? row[key].join('|') : row[key])).join(','))].join('\n');
}
function toMarkdown(report) {
  const summary = Object.entries(report.summary).map(([key, value]) => `| ${key} | ${value} |`).join('\n');
  const rows = report.tenants.map((tenant) => `| ${tenant.pathBusinessId} | ${tenant.category} | ${tenant.schemaVersion || 'legacy'} | ${(tenant.reasons || []).join(', ') || '-'} |`).join('\n');
  return `# CLICK 360 Firebase Audit\n\nMode: READ ONLY\n\n## Summary\n\n| Metric | Count |\n| --- | ---: |\n${summary}\n\n## Tenants\n\n| Tenant | Category | Schema | Signals |\n| --- | --- | --- | --- |\n${rows}\n`;
}

const source = args.fixture ? await loadFixture(args.fixture) : await loadFirebase();
const tenants = source.tenants.map((tenant) => {
  const classified = classifyTenant(tenant, source.approvedUsers, source.authUsers || []);
  return { ...tenant, category: classified.category, reasons: classified.reasons, observations: classified.observations, classifiedOwnerId: classified.ownerId, expectedOwnerEmail: classified.expectedOwnerEmail, summary: classified.summary };
});
const summary = { totalApprovedUsers: source.approvedUsers.length, totalTenants: tenants.length, CLEAN_V10: 0, LEGACY_CLEAR_OWNER: 0, LEGACY_AMBIGUOUS: 0, CROSS_TENANT_SUSPECT: 0, ORPHANED: 0 };
tenants.forEach((tenant) => { summary[tenant.category] += 1; });
const report = { generatedAt: new Date().toISOString(), projectId, mode: args.fixture ? 'FIXTURE_READ_ONLY' : 'FIREBASE_READ_ONLY', summary, approvedUsers: source.approvedUsers, approvedUsersByEmail: source.approvedUsersByEmail, authUsers: source.authUsers || [], tenants };
await fs.mkdir(outputDir, { recursive: true });
await Promise.all([
  fs.writeFile(path.join(outputDir, 'CLICK360_FIREBASE_AUDIT.json'), JSON.stringify(report, null, 2)),
  fs.writeFile(path.join(outputDir, 'CLICK360_FIREBASE_AUDIT.csv'), toCsv(tenants)),
  fs.writeFile(path.join(outputDir, 'CLICK360_FIREBASE_AUDIT.md'), toMarkdown(report))
]);
console.log(JSON.stringify(summary));
