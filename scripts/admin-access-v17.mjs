import fs from 'node:fs/promises';
import path from 'node:path';
import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { domainCounts, legacyStateFromDocument, stableHash } from './lib/click360-data-core.mjs';
import { firestoreHash, normalizeEmail, plainFirestoreValue } from './lib/click360-v16-admin-core.mjs';
import {
  REQUIRED_PROJECT_ID,
  V17_SUBJECTS,
  computeV17PlanHash
} from './lib/click360-v17-access-core.mjs';
import { buildV17ExecutionManifest } from './lib/click360-v17-executor-core.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const [key, inline] = argv[index].replace(/^--/, '').split('=');
    const next = argv[index + 1];
    result[key] = inline ?? (next && !next.startsWith('--') ? (index += 1, next) : true);
  }
  return result;
}

function tenantState(document = {}) {
  return document.schemaVersion === 10 ? document.payload?.data || {} : legacyStateFromDocument(document) || {};
}

function markdown(report) {
  const rows = report.actionResults.map((result) => `| ${result.subjectKey} | ${result.path} | ${result.operation} | ${result.before.hash} | ${result.precondition.status} | ${result.changedKeys.join(', ') || '-'} |`).join('\n');
  const integrity = report.tenantIntegrity.map((item) => `| ${item.path} | ${item.expectedHash} | ${item.currentHash} | ${item.hashMatches ? 'PASS' : 'FAIL'} | ${item.countsMatch ? 'PASS' : 'FAIL'} | ${item.classification || '-'} |`).join('\n');
  return `# CLICK 360 V17 - Ejecutor administrativo (dry-run)\n\nFecha: ${report.generatedAt}\n\nProyecto: \`${report.projectId}\`\n\nModo: **${report.mode}**\n\nApply habilitado: **${report.applyEnabled ? 'SÍ' : 'NO'}**\n\nEscrituras de producción: **${report.productionWriteOperations}**\n\nVeredicto: **${report.recommendation}**\n\nPlan: \`${report.planHash}\`\n\n## Acciones\n\n| Sujeto | Ruta | Operación | Hash previo | Precondición | Campos afectados |\n| --- | --- | --- | --- | --- | --- |\n${rows}\n\n## Integridad de tenants\n\n| Ruta | Hash esperado | Hash actual | Hash | Conteos | Clasificación |\n| --- | --- | --- | --- | --- | --- |\n${integrity}\n\n## Candados\n\n${report.operationalLocks.map((lock) => `- ${lock}`).join('\n')}\n\n## Rollback\n\n${report.actionResults.map((result) => `- \`${result.path}\`: ${result.rollback.strategy}; ${result.rollback.condition}`).join('\n')}\n`;
}

const args = parseArgs(process.argv.slice(2));
const command = String(args.command || 'prepare').toLowerCase();
if (command !== 'prepare' || args.apply === true || args.write === true || args.migrate === true) {
  throw new Error('V17_APPLY_NOT_AUTHORIZED: admin-access-v17 is intentionally dry-run only.');
}
if (!args.plan) throw new Error('--plan must point to CLICK360_V17_DRY_RUN.json.');

const projectId = String(args.project || REQUIRED_PROJECT_ID);
if (projectId !== REQUIRED_PROJECT_ID) throw new Error(`Refusing project ${projectId}.`);
const planPath = path.resolve(String(args.plan));
const outputDir = path.resolve(String(args.out || 'artifacts/v17-admin-executor'));
const plan = JSON.parse(await fs.readFile(planPath, 'utf8'));
if (plan.projectId !== projectId) throw new Error('Plan project mismatch.');
if (computeV17PlanHash(plan) !== plan.planHash) throw new Error('Plan hash mismatch.');

const app = initializeApp({ credential: applicationDefault(), projectId }, `click360-v17-executor-${Date.now()}`);
const auth = getAuth(app);
const db = getFirestore(app);

try {
  const concreteActionPaths = [
    ...(plan.planCatalog?.actions || []),
    ...Object.values(plan.subjects || {}).flatMap((subject) => subject.actions || [])
  ].map((action) => action.path).filter((pathValue) => !pathValue.includes('{') && !pathValue.startsWith('auth/'));
  const backupPaths = Object.values(plan.subjects || {}).flatMap((subject) => subject.backupsRequired || []);
  const firestorePaths = [...new Set([...concreteActionPaths, ...backupPaths])].sort();
  const snapshots = await Promise.all(firestorePaths.map(async (documentPath) => {
    const snapshot = await db.doc(documentPath).get();
    return [documentPath, {
      exists: snapshot.exists,
      hash: snapshot.exists ? firestoreHash(snapshot.data() || {}) : stableHash(null),
      data: snapshot.exists ? plainFirestoreValue(snapshot.data() || {}) : null,
      updateTime: snapshot.updateTime?.toDate?.().toISOString?.() || null
    }];
  }));
  const currentByPath = Object.fromEntries(snapshots);

  const authByUid = {};
  for (const subjectKey of plan.productionOrder) {
    const subject = plan.subjects[subjectKey];
    if (!subject.uid) continue;
    const definition = V17_SUBJECTS[subjectKey];
    const user = await auth.getUser(subject.uid);
    const identityConfirmed = user.disabled !== true
      && user.uid === definition.confirmedUid
      && normalizeEmail(user.email) === normalizeEmail(definition.requiredEmail);
    authByUid[user.uid] = {
      uid: user.uid,
      email: normalizeEmail(user.email),
      disabled: user.disabled === true,
      identityConfirmed,
      customClaims: plainFirestoreValue(user.customClaims || {}),
      claimsHash: stableHash(plainFirestoreValue(user.customClaims || {}))
    };
  }

  const actor = {
    uid: String(args['actor-uid'] || ''),
    authEmail: normalizeEmail(args['actor-auth-email']),
    administrativeEmail: normalizeEmail(args['actor-admin-email']),
    reason: String(args.reason || ''),
    reauthenticated: args.reauthenticated === true
  };
  const execution = buildV17ExecutionManifest({ plan, currentByPath, authByUid, actor });

  const tenantIntegrity = [];
  for (const expected of plan.backupManifest?.tenantIntegrityManifest || []) {
    const snapshot = await db.doc(expected.path).get();
    const document = snapshot.exists ? snapshot.data() || {} : null;
    const currentHash = document ? firestoreHash(document) : null;
    const currentCounts = domainCounts(document ? tenantState(document) : {});
    tenantIntegrity.push({
      path: expected.path,
      expectedHash: expected.hash,
      currentHash,
      hashMatches: snapshot.exists && currentHash === expected.hash,
      expectedCounts: expected.counts,
      currentCounts,
      countsMatch: stableHash(currentCounts) === stableHash(expected.counts),
      classification: expected.classification?.classification || null,
      environment: expected.classification?.environment || null,
      writeAllowed: false
    });
  }
  const tenantIntegrityPassed = tenantIntegrity.every((item) => item.hashMatches && item.countsMatch && item.writeAllowed === false);
  const technicalBlockers = [
    ...execution.technicalBlockers,
    ...tenantIntegrity.filter((item) => !item.hashMatches || !item.countsMatch).map((item) => `${item.path}:tenant_integrity_mismatch`)
  ];
  const backupInputs = Object.fromEntries(Object.entries(currentByPath).map(([documentPath, current]) => [documentPath, {
    exists: current.exists,
    hash: current.hash,
    updateTime: current.updateTime,
    fullDocumentRequiredAtApply: current.exists
  }]));
  const report = {
    ...execution,
    generatedAt: new Date().toISOString(),
    sourcePlanPath: planPath,
    technicalBlockers: [...new Set(technicalBlockers)],
    tenantIntegrity,
    tenantIntegrityPassed,
    recommendation: technicalBlockers.length === 0 && tenantIntegrityPassed ? 'APPLY' : 'DO_NOT_APPLY',
    backupInputs,
    backupManifestHash: stableHash({
      projectId,
      planHash: plan.planHash,
      auditReportHash: plan.auditReportHash,
      authByUid,
      backupInputs,
      tenantIntegrity
    })
  };
  report.reportHash = stableHash(report);

  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(outputDir, 'CLICK360_V17_EXECUTOR_DRY_RUN.json'), JSON.stringify(report, null, 2)),
    fs.writeFile(path.join(outputDir, 'CLICK360_V17_EXECUTOR_DRY_RUN.md'), markdown(report)),
    fs.writeFile(path.join(outputDir, 'CLICK360_V17_EXECUTOR_DRY_RUN_SHA256.txt'), `${report.reportHash}\n`)
  ]);

  console.log(JSON.stringify({
    projectId,
    mode: report.mode,
    applyEnabled: report.applyEnabled,
    productionWriteOperations: report.productionWriteOperations,
    recommendation: report.recommendation,
    planHash: report.planHash,
    backupManifestHash: report.backupManifestHash,
    reportHash: report.reportHash,
    actionCount: report.actionResults.length,
    tenantIntegrityPassed,
    outputDir
  }, null, 2));
} finally {
  await deleteApp(app);
}
