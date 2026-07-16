import fs from 'node:fs/promises';
import path from 'node:path';
import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { stableHash } from './lib/click360-data-core.mjs';
import {
  SHARY_V17_ARTIFACT_PATHS,
  SHARY_V17_AUTHORIZATION,
  SHARY_V17_RELATED_PATHS,
  SHARY_V17_TARGET_PATHS,
  reconstructApprovedInventoryHash,
  validateAdcPrincipal,
  validateApprovedSharyPlan,
  validateFreshAudit,
  validateSharyInvocation
} from './lib/click360-v17-shary-authorization.mjs';
import { executeV17Provisioning } from './lib/click360-v17-provisioning-engine.mjs';

async function resolveVerifiedAdcPrincipal(credential) {
  const tokenResult = await credential.getAccessToken();
  const accessToken = tokenResult?.access_token;
  if (!accessToken) throw new Error('SHARY_V17_AUTHORIZATION_REJECTED:adc_access_token_missing');
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw new Error(`SHARY_V17_AUTHORIZATION_REJECTED:adc_userinfo_http_${response.status}`);
  const identity = await response.json();
  const verified = {
    email: identity.email,
    emailVerified: identity.email_verified === true,
    projectId: SHARY_V17_AUTHORIZATION.projectId,
    subject: String(identity.sub || '')
  };
  validateAdcPrincipal(verified);
  return verified;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const [key, inline] = argv[index].replace(/^--/, '').split('=');
    const next = argv[index + 1];
    result[key] = inline ?? (next && !next.startsWith('--') ? (index += 1, next) : true);
  }
  return result;
}

function markdown(report) {
  const diffRows = (report.diff || []).map((row) => `| ${row.path} | ${row.operation} | ${row.beforeHash || '-'} | ${row.desiredHash || '-'} | ${row.preserveUnspecifiedFields ? 'sí' : 'no'} |`).join('\n');
  const tenants = (report.tenantIntegrity || []).map((tenant) => `| ${tenant.path} | ${tenant.hash} | ${JSON.stringify(tenant.counts)} | PASS |`).join('\n');
  return `# CLICK 360 V17 - Shary ${report.command}\n\nFecha: ${report.generatedAt}\n\nProyecto: \`${report.projectId}\`\n\nResultado: **${report.result}**\n\nEscrituras reportadas: **${report.productionWriteOperations}**\n\nPlan: \`${report.planHash}\`\n\nAuditoría fresca: \`${report.freshAuditHash}\`\n\n## Diff autorizado\n\n| Ruta | Operación | Hash previo | Hash deseado | Preserva otros campos |\n| --- | --- | --- | --- | --- |\n${diffRows || '| - | - | - | - | - |'}\n\n## Tenants protegidos\n\n| Ruta | Hash | Conteos | Integridad |\n| --- | --- | --- | --- |\n${tenants}\n\n## Artefactos\n\n- Backup: \`${report.backupPath || report.artifactPaths?.backup || '-'}\`\n- Job: \`${report.provisioningJobPath || report.artifactPaths?.provisioningJob || '-'}\`\n- Auditoría: \`${report.auditLogPath || report.artifactPaths?.auditLog || '-'}\`\n`;
}

export async function runSharyCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const command = String(args.command || 'preview').toLowerCase();
  if (!args.plan) throw new Error('--plan is required.');
  if (!args['fresh-audit']) throw new Error('--fresh-audit is required.');
  validateSharyInvocation(args, command);

  const planPath = path.resolve(String(args.plan));
  const freshAuditPath = path.resolve(String(args['fresh-audit']));
  const outputDir = path.resolve(String(args.out || 'artifacts/v17-shary-execution'));
  const [plan, freshAudit] = await Promise.all([
    fs.readFile(planPath, 'utf8').then(JSON.parse),
    fs.readFile(freshAuditPath, 'utf8').then(JSON.parse)
  ]);
  const { actionMap } = validateApprovedSharyPlan(plan);
  const auditAgeMs = Date.now() - Date.parse(String(freshAudit.generatedAt || ''));
  if (!Number.isFinite(auditAgeMs) || auditAgeMs < -30_000 || auditAgeMs > 10 * 60 * 1000) {
    throw new Error('SHARY_V17_AUTHORIZATION_REJECTED:fresh_audit_expired');
  }

  const context = {
    ...SHARY_V17_AUTHORIZATION,
    planHash: plan.planHash,
    sourceAuditHash: plan.auditReportHash,
    sourceInventoryHash: plan.auditInventoryHash,
    targetPaths: [...SHARY_V17_TARGET_PATHS],
    relatedPaths: [...SHARY_V17_RELATED_PATHS],
    artifactPaths: [...SHARY_V17_ARTIFACT_PATHS],
    targetActions: SHARY_V17_TARGET_PATHS.map((pathValue) => actionMap.get(pathValue)),
    claimsAction: actionMap.get(`auth/${SHARY_V17_AUTHORIZATION.uid}/customClaims`),
    tenantManifest: plan.backupManifest.tenantIntegrityManifest
  };
  const evidence = {
    actor: {
      uid: SHARY_V17_AUTHORIZATION.actor.uid,
      authEmail: SHARY_V17_AUTHORIZATION.actor.authEmail,
      administrativeEmail: SHARY_V17_AUTHORIZATION.actor.administrativeEmail,
      adminLevel: SHARY_V17_AUTHORIZATION.actor.adminLevel
    },
    reason: String(args.reason),
    confirmation: String(args.confirm),
    reauthenticatedAt: String(args['reauthenticated-at']),
    freshAuditHash: freshAudit.reportHash,
    freshAuditEvidence: {
      generatedAt: freshAudit.generatedAt,
      reportHash: freshAudit.reportHash,
      inventoryHash: freshAudit.firestore?.inventoryHash,
      inventoryCount: freshAudit.firestore?.inventory?.length || 0,
      canonicalTenant: freshAudit.subjects?.shary?.canonicalTenant || null,
      exactFirestoreHits: freshAudit.subjects?.shary?.exactFirestoreHits || [],
      fuzzyFirestoreHits: freshAudit.subjects?.shary?.fuzzyFirestoreHits || [],
      relatedRecordSummaries: freshAudit.subjects?.shary?.relatedRecordSummaries || []
    }
  };

  const credential = applicationDefault();
  evidence.adcPrincipal = await resolveVerifiedAdcPrincipal(credential);
  const app = initializeApp({
    credential,
    projectId: SHARY_V17_AUTHORIZATION.projectId
  }, `click360-v17-shary-${command}-${Date.now()}`);
  const db = getFirestore(app);
  const auth = getAuth(app);

  try {
    const [backupSnapshot, jobSnapshot, auditSnapshot] = await Promise.all([
      db.doc(SHARY_V17_ARTIFACT_PATHS[0]).get(),
      db.doc(SHARY_V17_ARTIFACT_PATHS[1]).get(),
      db.doc(SHARY_V17_ARTIFACT_PATHS[2]).get()
    ]);
    const artifactsExist = backupSnapshot.exists || jobSnapshot.exists || auditSnapshot.exists;
    if ((jobSnapshot.exists || auditSnapshot.exists) && !backupSnapshot.exists) {
      throw new Error('SHARY_V17_AUTHORIZATION_REJECTED:administrative_artifact_without_backup');
    }
    validateFreshAudit(freshAudit, { allowAppliedArtifacts: artifactsExist });
    const reconstructedInventoryHash = reconstructApprovedInventoryHash(
      freshAudit.firestore?.inventory || [],
      backupSnapshot.exists ? backupSnapshot.data() || {} : null
    );
    if (reconstructedInventoryHash !== SHARY_V17_AUTHORIZATION.sourceInventoryHash) {
      throw new Error('SHARY_V17_AUTHORIZATION_REJECTED:reconstructed_inventory_hash_mismatch');
    }
    if (!artifactsExist && freshAudit.firestore.inventoryHash !== SHARY_V17_AUTHORIZATION.sourceInventoryHash) {
      throw new Error('SHARY_V17_AUTHORIZATION_REJECTED:initial_inventory_hash_mismatch');
    }

    const execution = await executeV17Provisioning({ db, auth, context, command, evidence });
    const report = {
      generatedAt: new Date().toISOString(),
      projectId: context.projectId,
      subject: context.subjectKey,
      uid: context.uid,
      email: context.email,
      organizationId: context.organizationId,
      command,
      planHash: context.planHash,
      sourceAuditHash: context.sourceAuditHash,
      freshAuditHash: freshAudit.reportHash,
      sourceInventoryHash: context.sourceInventoryHash,
      reconstructedInventoryHash,
      adcPrincipal: evidence.adcPrincipal,
      ...execution
    };
    report.reportHash = stableHash(report);
    await fs.mkdir(outputDir, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(outputDir, `CLICK360_V17_SHARY_${command.toUpperCase()}.json`), JSON.stringify(report, null, 2)),
      fs.writeFile(path.join(outputDir, `CLICK360_V17_SHARY_${command.toUpperCase()}.md`), markdown(report)),
      fs.writeFile(path.join(outputDir, `CLICK360_V17_SHARY_${command.toUpperCase()}_SHA256.txt`), `${report.reportHash}\n`)
    ]);
    console.log(JSON.stringify({
      result: report.result,
      command,
      productionWriteOperations: report.productionWriteOperations,
      planHash: report.planHash,
      freshAuditHash: report.freshAuditHash,
      backupPath: report.backupPath || report.artifactPaths?.backup || null,
      provisioningJobPath: report.provisioningJobPath || report.artifactPaths?.provisioningJob || null,
      auditLogPath: report.auditLogPath || report.artifactPaths?.auditLog || null,
      bootstrapStatus: report.bootstrapSession?.status || null,
      reportHash: report.reportHash,
      outputDir
    }, null, 2));
    return report;
  } finally {
    await deleteApp(app);
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === path.resolve(new URL(import.meta.url).pathname)) {
  await runSharyCli();
}
