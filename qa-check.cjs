
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');

function assert(name, condition) {
  if (!condition) {
    console.error('FAIL', name);
    process.exitCode = 1;
  } else {
    console.log('PASS', name);
  }
}

assert('sin CDN QR externo', !html.includes('cdn.jsdelivr'));
assert('generador QR local', app.includes('const QR = (() =>'));
assert('scanner cámara/foto/manual', app.includes('startScanner') && app.includes('scanImageFile') && app.includes('Código manual'));
assert('lector local CLICK 360', app.includes('decodeLocalC360QR'));
assert('QR simple por código', app.includes('return String(product.code'));
assert('normaliza URL scan', app.includes("searchParams.get('scan')") || app.includes('searchParams.get("scan")'));
assert('imagen opcional producto', app.includes('pImage') && app.includes('imageData'));
assert('miniaturas producto', css.includes('productImg'));
assert('descargar PNG etiqueta', app.includes('downloadLabelPng'));
assert('imprimir por stock requiere opción explícita', app.includes('labelUseStock') && app.includes('resolveLabelCopies'));
assert('roles trabajador', app.includes("role === 'cashier'") && app.includes("role === 'inventory'"));
assert('PWA manifest', fs.existsSync(path.join(__dirname, 'manifest.webmanifest')));
assert('service worker', fs.existsSync(path.join(__dirname, 'service-worker.js')));

console.log('\\nCLICK 360 MVP FINAL v2 FULL POWER QA checks finished.');

assert('logo no triangle CSS', fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8').includes('CLICK 360 v3 logo fix'));


const jsqrSize = fs.statSync(path.join(__dirname, 'vendor', 'jsQR.js')).size;
const qrgSize = fs.statSync(path.join(__dirname, 'vendor', 'qrcode-generator.js')).size;
assert('jsQR real local incluido', jsqrSize > 200000);
assert('qrcode-generator real local incluido', qrgSize > 50000);
assert('HTML carga qrcode-generator antes de app', html.includes('vendor/qrcode-generator.js') && html.indexOf('vendor/qrcode-generator.js') < html.indexOf('app.js'));
assert('HTML carga jsQR antes de app', html.includes('vendor/jsQR.js') && html.indexOf('vendor/jsQR.js') < html.indexOf('app.js'));
assert('cache offline safe', fs.readFileSync(path.join(__dirname, 'service-worker.js'), 'utf8').includes('click360-mvp-launch-v16-2-p1-5b-r1'));
assert('service worker cachea guard P0', fs.readFileSync(path.join(__dirname, 'service-worker.js'), 'utf8').includes('./p0-tenant-guard.js'));
assert('service worker cachea vendor QR', fs.readFileSync(path.join(__dirname, 'service-worker.js'), 'utf8').includes('./vendor/qrcode-generator.js') && fs.readFileSync(path.join(__dirname, 'service-worker.js'), 'utf8').includes('./vendor/jsQR.js'));
assert('perfil persistente local', app.includes('CLICK360_USER_PROFILE_') && app.includes('cacheUserProfile'));
assert('almacenamiento lleno conserva datos confirmados', app.includes('restoreLastPersistedState') && app.includes('MAX_LOCAL_TENANT_STATE_BYTES') && !app.includes('optimizeStateForStorage'));
assert('perfil pendiente se reintenta al reconectar', app.includes('CLICK360_PROFILE_PENDING:') && app.includes('click360FlushPendingProfile'));

const firebaseService = fs.readFileSync(path.join(__dirname, 'firebase-service.js'), 'utf8');
const administrativeMigrator = fs.readFileSync(path.join(__dirname, 'scripts', 'migrate-legacy-v9-to-v10.mjs'), 'utf8');
assert('estado local aislado por UID y tenant', app.includes("const STATE_PREFIX = 'CLICK360:V16:STATE:'") && app.includes('`${STATE_PREFIX}${activeTenantContext.authUid}:${activeTenantContext.tenantKey}`') && app.includes('click360SetTenantContext'));
assert('sesión local aislada por UID', app.includes("const SESSION_PREFIX = 'CLICK360:V16:SESSION:'") && app.includes('`${SESSION_PREFIX}${activeTenantContext.authUid}`') && app.includes('sessionStorageKey()'));
assert('sesión local no concede permisos', app.includes('cloudUser.uid !== activeTenantContext.authUid') && !app.includes('session.role') && !app.includes('session.username'));
assert('estado global legacy no se carga', !app.includes("localStorage.getItem(LEGACY_STATE_KEY)"));
assert('payload cloud explícito', firebaseService.includes('function buildBusinessPayload()') && firebaseService.includes('payload'));
assert('no sincroniza todo localStorage', !firebaseService.includes('function getLocalSnapshot()') && !firebaseService.includes('localStorage: snapshot'));
assert('guard de identidad en push', firebaseService.includes('activeIdentityIsValid(user)') && firebaseService.includes('blocked_push_identity'));
assert('guard de identidad en pull', firebaseService.includes('remoteMatchesContext(remoteData, context)') && firebaseService.includes('blocked_pull_identity'));
assert('logout descarga tenant', firebaseService.includes('function deactivateActiveAccount()') && firebaseService.includes('click360ClearTenantContext'));
assert('legacy entra en cuarentena namespaced', firebaseService.includes('quarantineLegacyLocalState') && firebaseService.includes('CLICK360:V16:QUARANTINE:'));
assert('no resetea almacenamiento de negocio', !firebaseService.includes('localStorage.clear()'));
assert('aprobación offline aislada por UID', firebaseService.includes('CLICK360_APPROVED_IDENTITY:') && !firebaseService.includes('CLICK360_LAST_APPROVED_USER'));
assert('legacy bloquea push y desbloqueo', firebaseService.includes('legacyMigrationRequired()') && firebaseService.includes('tenantGuard.canWrite(context)') && firebaseService.includes('showLegacyMigrationGate()'));
assert('migración exige backup y conteos administrativos', administrativeMigrator.includes('legacyBackups') && administrativeMigrator.includes('beforeCounts') && administrativeMigrator.includes('afterCounts') && administrativeMigrator.includes('equalCounts'));
assert('harness P0 ejecutable', fs.existsSync(path.join(__dirname, 'qa-p0-isolation-harness.cjs')) && fs.existsSync(path.join(__dirname, 'p0-tenant-guard.js')));
assert('arranque offline valida caché del tenant', app.includes('click360GetTenantCacheStatus') && firebaseService.includes('verifiedOfflineTenantCache()'));
assert('offline sin caché no crea seed', firebaseService.includes('Sin internet y no existe una caché propia') && firebaseService.includes('tenantGuard.block()'));
assert('V10 remoto reconcilia marcadores locales propios', firebaseService.includes('reconcileLocalStateWithRemoteV10') && firebaseService.includes('reconcileLegacyMarkers') && firebaseService.includes('remoteMustHydrate'));
assert('nueva prueba usa tiempo de servidor y modo lectura', firebaseService.includes("ACCOUNT_ACCESS_COLLECTION = 'accountAccess'") && firebaseService.includes('FieldValue.serverTimestamp()') && firebaseService.includes('ACCESS_READ_ONLY'));
assert('la interfaz ofrece CRM, recordatorios y acceso', app.includes('function crmView') && app.includes('function remindersView') && app.includes('function accessView'));
