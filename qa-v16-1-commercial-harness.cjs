const assert = require('node:assert');
const fs = require('node:fs');

require('./v16-domain.js');
const domain = global.CLICK360_V16_DOMAIN;
const app = fs.readFileSync('app.js', 'utf8');
const firebase = fs.readFileSync('firebase-service.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');
const worker = fs.readFileSync('service-worker.js', 'utf8');

assert.equal(domain.APP_VERSION, '16.2');
assert.deepEqual(domain.initialTenantBootstrapDecision({ snapshotPrepared: true, localPersisted: true, online: true }), { allowed: true, mode: 'local_and_cloud' });
assert.deepEqual(domain.initialTenantBootstrapDecision({ snapshotPrepared: true, localPersisted: false, onlineOnlySafe: true, online: true }), { allowed: true, mode: 'cloud_only' });
assert.equal(domain.initialTenantBootstrapDecision({ snapshotPrepared: true, localPersisted: false, onlineOnlySafe: true, online: false }).allowed, false);
assert.equal(domain.initialTenantBootstrapDecision({ snapshotPrepared: true, localPersisted: true, online: true, readOnly: true }).reason, 'read_only');
assert.equal(domain.initialTenantBootstrapDecision({ localPersisted: true, online: true }).reason, 'snapshot_preparation_required');

assert.equal(domain.publicIntentAllowsTrialCreation('trial'), true);
assert.equal(domain.publicIntentAllowsTrialCreation('register'), true);
assert.equal(domain.publicIntentAllowsTrialCreation('login'), false);
assert.equal(domain.publicIntentAllowsTrialCreation('invite'), false);
assert.equal(domain.calculatorOperation(10, 5, '+'), 15);
assert.equal(domain.calculatorOperation(10, 5, '-'), 5);
assert.equal(domain.calculatorOperation(10, 5, '*'), 50);
assert.equal(domain.calculatorOperation(10, 5, '/'), 2);
assert.equal(domain.calculatorOperation(10, 0, '/'), null);
assert.match(domain.formatBusinessClock('2026-07-14T19:30:00Z', 'es-EC', 'America/Guayaquil', false), /14 de julio de 2026.*2:30/);
assert.match(domain.formatBusinessClock('2026-07-14T19:30:00Z', 'es-EC', 'America/Guayaquil', true), /^14 de julio.*2:30/);

assert(firebase.includes("onclick = () => beginPublicAuth('login')"));
assert(firebase.includes("onclick = () => beginPublicAuth('trial')"));
assert(firebase.includes("onclick = () => beginPublicAuth('register')"));
assert(firebase.includes("publicIntentAllowsTrialCreation(publicIntent) === true"));
assert(firebase.includes("resolveAccountAccess(user, epoch, { allowCreate: false") && firebase.includes("resolveAccountAccess(user, epoch, { allowCreate: true"));
assert(firebase.includes("source: 'self_service'"));
assert(!firebase.includes('self_service_register') && !firebase.includes('self_service_trial'));
assert(!firebase.includes('if (auth.currentUser) await auth.signOut()'), 'Google login must not clear a valid redirect/session before the access gate resolves');
assert(firebase.includes("const currentParams = new URLSearchParams(location.search)"));
assert(firebase.includes("initialTenantBootstrapDecision({"));
assert(firebase.includes("pushLocalToFirestore('initial_tenant_seed')"));
assert(!firebase.includes('STATE_DOC.set('));

for (const contract of ['labelPreviewSticky', 'labelPresetGrid', 'labelQuickControls', 'labelAdvanced', 'saveTemplateAsNewBtn', 'duplicateTemplateBtn', 'deleteTemplateBtn', 'labelResetAll']) {
  assert(app.includes(contract), `QR contract ${contract}`);
}
assert(app.includes('refreshInventoryTemplateSection()'));
assert(app.includes('setInterval(updateClock, 60000)'));
assert(app.includes('function openCalculator('));
assert(app.includes('calculatorSellBtn') && app.includes('calculatorCashBtn') && app.includes('calculatorMoreBtn'));
assert(app.includes('function openBusinessSwitcher()'));
assert(app.includes('notificationMeta'));

assert(html.includes('<title>CLICK 360 | Inventario, ventas y caja para tu negocio</title>'));
assert(html.includes('FAQPage') && html.includes('SoftwareApplication'));
assert.equal((html.match(/"@type": "Question"/g) || []).length, 9);
assert(!html.includes('user-scalable=no'));
assert(html.includes('vendor/lucide.min.js?v=commercial-1-0-5-r29'));
assert(css.includes('@media(max-width:340px)') && css.includes('@media(max-width:430px)'));
assert(worker.includes("const CACHE = 'click360-commercial-1-0-5-r29'"));
assert(worker.includes("'./vendor/lucide.min.js'"));
assert(fs.existsSync('robots.txt') && fs.existsSync('sitemap.xml'));

console.log('PASS V16.1 commercial harness: cloud-only bootstrap, public intents, QR, mobile UI, calculator, clock, SEO and PWA');
