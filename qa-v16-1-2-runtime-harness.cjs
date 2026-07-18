const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const runtimeSource = fs.readFileSync('runtime-guard.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
const firebase = fs.readFileSync('firebase-service.js', 'utf8');
const worker = fs.readFileSync('service-worker.js', 'utf8');
const manifest = fs.readFileSync('manifest.webmanifest', 'utf8');
const styles = fs.readFileSync('styles.css', 'utf8');
const hosting = JSON.parse(fs.readFileSync('firebase.json', 'utf8'));
const assetVersion = 'mvp-launch-v16-2-p1-r4';

class StorageMock {
  constructor() { this.values = new Map(); this.failWrites = false; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { if (this.failWrites) throw new Error('storage full'); this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
  keys() { return [...this.values.keys()]; }
}

function runtimeContext(userAgent) {
  const listeners = new Map();
  let uuidCounter = 0;
  const localStorage = new StorageMock();
  const sessionStorage = new StorageMock();
  const toast = {
    className: '',
    children: [],
    replaceChildren() { this.children = []; },
    append(...nodes) { this.children.push(...nodes); }
  };
  const context = {
    URL,
    Date,
    Math,
    JSON,
    Object,
    String,
    Number,
    Array,
    RegExp,
    encodeURIComponent,
    localStorage,
    sessionStorage,
    navigator: { userAgent, platform: 'QA', language: 'es-EC', onLine: true },
    location: {
      href: 'https://roddysmith23-stack.github.io/CLICK-360/?inviteToken=secret#home',
      origin: 'https://roddysmith23-stack.github.io',
      pathname: '/CLICK-360/'
    },
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}` },
    matchMedia: () => ({ matches: true }),
    setTimeout: () => 1,
    clearTimeout: () => {},
    addEventListener(type, callback) {
      const current = listeners.get(type) || [];
      current.push(callback);
      listeners.set(type, current);
    },
    document: {
      readyState: 'complete',
      getElementById: (id) => id === 'toast' ? toast : null,
      createTextNode: (text) => ({ textContent: text }),
      createElement: () => ({ style: {} })
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(runtimeSource, context, { filename: 'runtime-guard.js' });
  return { context, listeners, localStorage, sessionStorage, toast };
}

const firefoxQa = runtimeContext('Mozilla/5.0 Firefox/128.0');
assert.equal(firefoxQa.context.__firefox__, true, 'Firefox is detected without reading an undeclared global');
assert.equal(firefoxQa.context.CLICK360_RUNTIME_GUARD.APP_VERSION, '1.0.3-p4');
assert.equal(firefoxQa.context.CLICK360_RUNTIME_GUARD.browser.name, 'Firefox');
firefoxQa.context.CLICK360_RUNTIME_GUARD.setReleaseMetadata({
  appVersion: '1.0.3-p4',
  assetVersion,
  buildSha: 'abc123def456'
});
firefoxQa.context.location.hash = '#cash';
firefoxQa.context.click360GetEffectiveAccess = () => ({ mode: 'founder', readOnly: false });
firefoxQa.context.click360GetTenantState = () => ({ activeBusinessId: 'qa_business_demo' });

const errorListener = firefoxQa.listeners.get('error')[0];
errorListener({
  message: "ReferenceError: Can't find variable: __firefox__",
  filename: 'safari-web-extension://extension/content.js?token=secret',
  lineno: 1,
  colno: 1,
  error: { stack: 'content.js?inviteToken=secret:1:1', code: 'QA_RUNTIME_ERROR' }
});
let reports = firefoxQa.context.CLICK360_RUNTIME_GUARD.listReports();
assert.equal(reports.length, 1);
assert.equal(reports[0].filename, 'safari-web-extension://extension/content.js');
assert.equal(reports[0].sourceKind, 'external_or_injected');
assert.equal(reports[0].line, 1);
assert.equal(reports[0].browser.name, 'Firefox');
assert.equal(reports[0].appVersion, '1.0.3-p4');
assert.equal(reports[0].buildSha, 'abc123def456');
assert.equal(reports[0].assetVersion, assetVersion);
assert.equal(reports[0].displayMode, 'standalone');
assert.equal(reports[0].route, '#cash');
assert.equal(reports[0].effectiveAccess.mode, 'founder');
assert.equal(reports[0].effectiveAccess.readOnly, false);
assert.match(reports[0].activeBusinessId, /^anon_[0-9a-f]{8}$/);
assert(!reports[0].pageUrl.includes('secret') && !reports[0].stack.includes('secret'), 'tokens are removed from saved reports');
assert(!firefoxQa.toast.children.map((node) => node.textContent || '').join(' ').includes('__firefox__'), 'the customer never sees raw technical errors');
assert(firefoxQa.toast.children.some((node) => node.href?.includes('Version%3A%201.0.3-p4%20abc123def456')), 'support link includes release version and SHA');

const shary = {
  authUid: '3UTjgHd1QNSvqlcXNKQ6tL79X7u2',
  ownerId: '3UTjgHd1QNSvqlcXNKQ6tL79X7u2',
  businessId: '3UTjgHd1QNSvqlcXNKQ6tL79X7u2',
  tenantKey: 'owner:3UTjgHd1QNSvqlcXNKQ6tL79X7u2:business:3UTjgHd1QNSvqlcXNKQ6tL79X7u2'
};
assert.equal(firefoxQa.context.CLICK360_RUNTIME_GUARD.setContext(shary), true);
reports = firefoxQa.context.CLICK360_RUNTIME_GUARD.listReports();
assert.equal(reports.length, 1, 'public reports migrate into the exact authenticated namespace');
assert(firefoxQa.localStorage.keys().some((key) => key.includes(encodeURIComponent(shary.tenantKey))));
assert(!firefoxQa.sessionStorage.keys().some((key) => key.includes(':RUNTIME_ERRORS:PUBLIC:')), 'public report is removed after safe migration');
firefoxQa.localStorage.failWrites = true;
firefoxQa.context.CLICK360_RUNTIME_GUARD.record({ message: 'storage fallback test', filename: 'app.js', line: 2 });
assert.equal(firefoxQa.context.CLICK360_RUNTIME_GUARD.listReports().length, 2, 'session storage preserves reports when tenant local storage is full');

const chromeQa = runtimeContext('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36');
assert.equal(chromeQa.context.__firefox__, false);
assert.equal(chromeQa.context.CLICK360_RUNTIME_GUARD.browser.name, 'Chrome');

const firefoxLines = runtimeSource.split('\n').filter((line) => line.includes('__firefox__'));
assert(firefoxLines.every((line) => /typeof root\.__firefox__|defineProperty\(root, '__firefox__'|root\.__firefox__ = detectedFirefox/.test(line)), 'every __firefox__ use is guarded or assigned safely');
for (const file of ['app.js', 'firebase-service.js', 'p0-tenant-guard.js', 'v16-domain.js', 'v16-storage.js', 'service-worker.js']) {
  assert(!fs.readFileSync(file, 'utf8').includes('__firefox__'), `${file} has no unresolved Firefox build constant`);
}

assert(!app.includes('window.onerror'), 'legacy raw-error handler was removed');
assert(app.includes("const APP_RELEASE_VERSION = '1.0.3-p4'") && app.includes('APP_VISIBLE_VERSION') && app.includes('class="brandSlogan">Control total de tu negocio</small>'));
assert(firebase.includes('<small>V16.2</small>'));
assert(app.includes('CLICK360_RUNTIME_GUARD?.setContext(activeTenantContext)'));
assert(app.includes('CLICK360_RUNTIME_GUARD?.clearContext()'));
assert(html.indexOf(`runtime-guard.js?v=${assetVersion}`) < html.indexOf('vendor/qrcode-generator.js'), 'runtime guard loads before all application libraries');
for (const source of [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1])) {
  assert(source.includes(`?v=${assetVersion}`), `script is cache-busted: ${source}`);
}
for (const source of [html, app, firebase, worker, manifest, styles]) {
  assert(!source.includes('mvp-launch-v16-1-r1'), 'old V16.1 asset version is absent from the release payload');
}
assert(worker.includes(`const CACHE = 'click360-${assetVersion}'`));
assert(worker.includes("'./runtime-guard.js'"));
assert(worker.includes("key.startsWith('click360-') && key !== CACHE"), 'activation removes only old CLICK 360 caches');
for (const route of ['/', '/index.html', '/service-worker.js']) {
  const entry = hosting.hosting.headers.find((candidate) => candidate.source === route);
  assert(entry?.headers?.some((header) => header.key === 'Cache-Control' && header.value.includes('no-cache')), `Firebase Hosting does not retain the release shell at ${route}`);
}
assert(firebase.includes("initialTenantBootstrapDecision({"));
assert(firebase.includes("pushLocalToFirestore('initial_tenant_seed')"));
assert(!firebase.includes('STATE_DOC.set('), 'ONLINE_ONLY_SAFE bootstrap cannot overwrite a remote document');

console.log('PASS V16.2 runtime: safe Firefox detection, sanitized reports, tenant namespaces and friendly UX');
console.log('PASS V16.2 cache: all scripts versioned, old cache removed and no unresolved first-party build constant');
console.log('PASS V16.2 Shary contract: ONLINE_ONLY_SAFE uses transactional V10 bootstrap without STATE_DOC.set');
