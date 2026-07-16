import fs from 'node:fs/promises';
import path from 'node:path';
import { stableHash } from './lib/click360-data-core.mjs';
import {
  REQUIRED_PROJECT_ID,
  V17_MODEL_VERSION,
  V17_SUBJECTS,
  buildPlanCatalogDryRun,
  buildProvisioningDryRun
} from './lib/click360-v17-access-core.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const [key, inline] = argv[index].replace(/^--/, '').split('=');
    const next = argv[index + 1];
    result[key] = inline ?? (next && !next.startsWith('--') ? (index += 1, next) : true);
  }
  return result;
}

function opaqueOrganizationId(projectId, subjectKey, uid) {
  return `org_${stableHash({ namespace: 'click360-v17-organization', projectId, subjectKey, uid }).slice(0, 24)}`;
}

function markdown(plan) {
  const subjectRows = Object.values(plan.subjects).map((subject) => `| ${subject.label} | ${subject.identityStatus} | ${subject.uid || '-'} | ${subject.organizationId || '-'} | ${subject.decision} | ${subject.blockers.join(', ') || '-'} |`).join('\n');
  const actionRows = Object.values(plan.subjects).flatMap((subject) => subject.actions.map((action) => `| ${subject.label} | ${action.path} | ${action.operation} |`)).join('\n');
  return `# CLICK 360 V17 - Plan de cambios (dry-run)\n\nFecha: ${plan.generatedAt}\n\nProyecto: \`${plan.projectId}\`\n\nAuditoría base: \`${plan.auditReportHash}\`\n\nModo: **${plan.mode}**\n\nEscrituras ejecutadas: **${plan.productionWriteOperations}**\n\nRecomendación: **${plan.recommendation}**\n\n## Personas\n\n| Persona | Identidad | UID | Organización propuesta | Decisión | Bloqueos |\n| --- | --- | --- | --- | --- | --- |\n${subjectRows}\n\n## Cambios propuestos\n\n| Persona | Ruta | Operación |\n| --- | --- | --- |\n${actionRows || '| - | - | - |'}\n\n## Catálogo central\n\n${plan.planCatalog.actions.map((action) => `- \`${action.path}\`: ${action.operation}`).join('\n')}\n\n## Condiciones antes de aplicar\n\n${plan.blockers.map((blocker) => `- ${blocker}`).join('\n')}\n\n## Protección\n\n- Cada documento existente exige hash previo coincidente.\n- Cada documento ausente se crea con precondición create-only.\n- El estado V10 \`businesses/*/state/main\` no se sobrescribe.\n- \`demo-click360\` y tenants ajenos son referencias de integridad de solo lectura.\n- Claims se actualizan después de la transacción y quedan registrados en \`provisioningJobs\`.\n`;
}

const args = parseArgs(process.argv.slice(2));
if (args.apply === true || args.write === true || args.migrate === true) {
  throw new Error('V17_APPLY_NOT_AUTHORIZED: this preflight command cannot write production data.');
}
if (!args.audit) throw new Error('--audit must point to CLICK360_V17_AUDIT.json.');
const auditPath = path.resolve(String(args.audit));
const outputDir = path.resolve(String(args.out || 'artifacts/v17-access-plan'));
const audit = JSON.parse(await fs.readFile(auditPath, 'utf8'));

if (audit.projectId !== REQUIRED_PROJECT_ID) throw new Error(`Refusing audit for ${audit.projectId}.`);
if (audit.mode !== 'FIREBASE_READ_ONLY' || Number(audit.productionWriteOperations) !== 0) {
  throw new Error('The source audit is not a verified read-only report.');
}
if (audit.integrity?.allReadbacksUnchanged !== true) throw new Error('The source audit failed readback integrity.');

const existingPlans = {};
const planCatalog = buildPlanCatalogDryRun(existingPlans);
const subjects = {};
for (const [subjectKey, definition] of Object.entries(V17_SUBJECTS)) {
  const audited = audit.subjects?.[subjectKey];
  if (!audited) throw new Error(`Audit is missing subject ${subjectKey}.`);
  const resolution = audited.identity;
  const ownOrganization = ['shary', 'lia'].includes(subjectKey) && resolution.confirmed === true;
  const organizationId = ownOrganization ? opaqueOrganizationId(audit.projectId, subjectKey, resolution.user.uid) : null;
  const current = {
    accountAccess: audited.accountAccess,
    legacyBusinessId: audited.canonicalTenant?.exists ? audited.canonicalTenant.businessId : resolution.user?.uid || null,
    organizationName: definition.label,
    plans: existingPlans
  };
  const subjectPlan = buildProvisioningDryRun({ subjectKey, resolution, current, organizationId });
  subjects[subjectKey] = {
    label: definition.label,
    requiredEmail: definition.requiredEmail,
    candidateEmails: (resolution.candidates || []).map((candidate) => candidate.email),
    candidateUids: (resolution.candidates || []).map((candidate) => candidate.uid),
    currentAccess: audited.accountAccess,
    currentTenant: audited.canonicalTenant,
    ...subjectPlan,
    integrityReferences: {
      canonicalTenantHash: audited.canonicalTenant?.hash || null,
      accountAccessHash: audited.accountAccess?.hash || null,
      exactFirestoreHits: audited.exactFirestoreHits?.length || 0
    }
  };
}

const blockers = [
  'owner_approval_not_recorded',
  'smith_exact_auth_identity_not_confirmed',
  'debby_exact_auth_identity_not_confirmed',
  'debby_authorized_organization_not_confirmed',
  'lia_auth_not_created_pending_secure_activation',
  'authenticated_multidevice_smoke_not_executed',
  'production_apply_explicitly_forbidden_in_current_phase'
];
for (const [key, subject] of Object.entries(subjects)) {
  if (subject.decision === 'BLOCKED') blockers.push(`${key}:${subject.blockers.join('+')}`);
}

const tenantIntegrityManifest = audit.tenants.map((tenant) => ({
  path: tenant.path,
  hash: tenant.hash,
  counts: tenant.counts,
  protected: true,
  writeAllowed: false
}));
const plan = {
  generatedAt: new Date().toISOString(),
  projectId: audit.projectId,
  modelVersion: V17_MODEL_VERSION,
  mode: 'DRY_RUN_ONLY',
  productionWriteOperations: 0,
  auditPath,
  auditGeneratedAt: audit.generatedAt,
  auditReportHash: audit.reportHash,
  auditInventoryHash: audit.firestore.inventoryHash,
  recommendation: 'DO_NOT_APPLY',
  blockers: [...new Set(blockers)],
  planCatalog,
  subjects,
  backupManifest: {
    destinationPattern: 'adminBackups/{backupId}',
    auditDestinationPattern: 'auditLogs/{auditId}',
    provisioningJobPattern: 'provisioningJobs/{jobId}',
    requiredContent: [
      'auth_identity_and_custom_claims', 'all_target_documents_before_values', 'before_hashes',
      'tenant_counts', 'tenant_hashes', 'audit_inventory_hash', 'approved_plan_hash', 'rollback_manifest'
    ],
    tenantIntegrityManifest
  },
  applyProtocol: [
    'repeat_read_only_audit_and_require_same_or_explicitly_reviewed_hashes',
    'confirm_smith_and_debby_exact_auth_identities',
    'record_owner_approval_and_reason',
    'create_and_read_back_admin_backup',
    'create_provisioning_job_with_idempotency_key',
    'apply_one_subject_at_a_time_in_firestore_transaction_with_preconditions',
    'refresh_custom_claims_without_removing_unrelated_claims',
    'run_bootstrap_session_and_authenticated_smoke',
    'recompute_all_tenant_hashes_and_counts',
    'write_audit_log_and_mark_job_complete'
  ],
  rollbackProtocol: [
    'stop_the_subject_job_on_any_hash_identity_or_count_mismatch',
    'do_not_delete_new_documents_until_their_audit_and_ownership_are_verified',
    'restore_only_from_the_verified_subject_backup_with_hash_preconditions',
    'restore_previous_custom_claims',
    'recompute_all_protected_tenant_hashes',
    'record_rollback_in_auditLogs'
  ]
};
plan.planHash = stableHash({
  projectId: plan.projectId,
  modelVersion: plan.modelVersion,
  auditReportHash: plan.auditReportHash,
  planCatalog: plan.planCatalog,
  subjects: plan.subjects,
  backupManifest: plan.backupManifest,
  applyProtocol: plan.applyProtocol,
  rollbackProtocol: plan.rollbackProtocol
});

await fs.mkdir(outputDir, { recursive: true });
await Promise.all([
  fs.writeFile(path.join(outputDir, 'CLICK360_V17_DRY_RUN.json'), JSON.stringify(plan, null, 2)),
  fs.writeFile(path.join(outputDir, 'CLICK360_V17_DRY_RUN.md'), markdown(plan)),
  fs.writeFile(path.join(outputDir, 'CLICK360_V17_DRY_RUN_SHA256.txt'), `${plan.planHash}\n`)
]);

console.log(JSON.stringify({
  projectId: plan.projectId,
  mode: plan.mode,
  productionWriteOperations: plan.productionWriteOperations,
  auditReportHash: plan.auditReportHash,
  planHash: plan.planHash,
  recommendation: plan.recommendation,
  subjectDecisions: Object.fromEntries(Object.entries(subjects).map(([key, subject]) => [key, subject.decision])),
  outputDir
}, null, 2));
