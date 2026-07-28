const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const rootPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const rootLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const adminPackage = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'admin', 'package.json'), 'utf8'));
const adminLock = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'admin', 'package-lock.json'), 'utf8'));
const build = fs.readFileSync(path.join(root, 'scripts', 'build-static-release.mjs'), 'utf8');
const webFunctionsWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'web-functions-qa.yml'), 'utf8');
const adminWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'admin-qa.yml'), 'utf8');

assert.equal(Object.hasOwn(rootPackage.dependencies, 'firebase-admin'), false, 'PWA root has no administrative SDK dependency');
assert.equal(Object.hasOwn(rootLock.packages[''].dependencies || {}, 'firebase-admin'), false, 'PWA root lockfile has no direct administrative SDK dependency');
for (const script of ['qa:p2:cloud', 'qa:p2:multiuser', 'qa:p2:browser']) {
  assert.match(rootPackage.scripts[script], /^bash /, `${script} uses Bash where pipefail is required in Linux CI`);
}
assert.equal(adminPackage.dependencies['firebase-admin'], '^14.1.0', 'admin package owns firebase-admin explicitly');
assert.equal(Object.hasOwn(adminLock.packages[''].dependencies || {}, 'firebase-admin'), true, 'admin lockfile owns firebase-admin');
assert.equal(build.includes("'node_modules'"), false, 'static build allowlist never copies node_modules');
for (const file of ['admin-access-v16.mjs', 'audit-firestore-legacy.mjs', 'migrate-legacy-v9-to-v10.mjs', 'normalize-approved-owner-access.mjs']) {
  assert.ok(fs.existsSync(path.join(root, 'tools', 'admin', 'scripts', file)), `admin script moved: ${file}`);
  assert.match(fs.readFileSync(path.join(root, 'scripts', file), 'utf8'), /admin-tool-wrapper/, `compatibility wrapper delegates: ${file}`);
}
assert.match(webFunctionsWorkflow, /^  web-runtime-qa:/m, 'web runtime QA is independent');
assert.match(webFunctionsWorkflow, /^  functions-fixture-qa:/m, 'Functions fixture QA is independent');
assert.match(webFunctionsWorkflow, /^  functions-security-audit:/m, 'Functions security audit remains blocking');
assert.equal(webFunctionsWorkflow.includes('working-directory: tools/admin'), false, 'P2 Functions workflow never routes to the admin package');
assert.match(webFunctionsWorkflow, /functions\/\.\*/, 'nested Functions paths are detected');
assert.match(adminWorkflow, /^  admin-fixture-qa:/m, 'admin fixture QA is independent');
assert.match(adminWorkflow, /^  admin-security-audit:/m, 'admin audit remains independent');
assert.match(adminWorkflow, /needs\.changes\.outputs\.admin == 'true'/, 'admin jobs are selected by changed paths');
const adminCodeRule = adminWorkflow.split('\n').find((line) => line.includes('admin_code=true'));
assert.ok(adminCodeRule && !adminCodeRule.includes('functions/'), 'Functions never activate the admin package audit');
assert.match(adminCodeRule, /tools\/admin\/\.\*/, 'nested admin paths are detected');
assert.match(adminWorkflow, /non_admin_runtime=true/, 'combined P2 Functions changes keep admin package jobs skipped');
assert.equal(`${webFunctionsWorkflow}\n${adminWorkflow}`.includes('continue-on-error'), false, 'security jobs cannot be made green artificially');

console.log('PASS P2 web/admin boundary harness: independent packages, static boundary, routed CI, explicit compatibility wrappers.');
