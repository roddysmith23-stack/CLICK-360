(function (root) {
  'use strict';

  const APP_VERSION = '16.2';
  const ASSET_VERSION = 'mvp-launch-v16-2-p0-r1';
  const STORAGE_PREFIX = 'CLICK360:V16_2:RUNTIME_ERRORS:';
  const SESSION_ID_KEY = 'CLICK360:V16_2:RUNTIME_SESSION_ID';
  const MAX_REPORTS = 12;
  let activeContext = null;
  let lastFingerprint = '';
  let lastFingerprintAt = 0;

  function safeStorage(name) {
    try { return root[name] || null; } catch { return null; }
  }
  function safeGet(storage, key) {
    try { return storage?.getItem(key) || ''; } catch { return ''; }
  }
  function safeSet(storage, key, value) {
    try { storage?.setItem(key, value); return true; } catch { return false; }
  }
  function safeRemove(storage, key) {
    try { storage?.removeItem(key); } catch {}
  }
  function createId(prefix) {
    const random = root.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    return `${prefix}_${random}`;
  }

  const sessionStorage = safeStorage('sessionStorage');
  let runtimeSessionId = safeGet(sessionStorage, SESSION_ID_KEY);
  if (!runtimeSessionId) {
    runtimeSessionId = createId('session');
    safeSet(sessionStorage, SESSION_ID_KEY, runtimeSessionId);
  }

  function browserDetails() {
    const navigatorValue = root.navigator || {};
    const userAgent = String(navigatorValue.userAgent || 'unknown').slice(0, 500);
    const matchers = [
      ['Firefox iOS', /FxiOS\/([\d.]+)/],
      ['Firefox', /Firefox\/([\d.]+)/],
      ['Chrome iOS', /CriOS\/([\d.]+)/],
      ['Edge', /Edg\/([\d.]+)/],
      ['Chrome', /(?:Chrome|Chromium)\/([\d.]+)/],
      ['Safari', /Version\/([\d.]+).*Safari/]
    ];
    const matched = matchers.map(([name, pattern]) => [name, userAgent.match(pattern)]).find(([, value]) => value);
    return {
      name: matched?.[0] || 'Desconocido',
      version: matched?.[1]?.[1] || '',
      userAgent,
      platform: String(navigatorValue.platform || navigatorValue.userAgentData?.platform || '').slice(0, 100),
      language: String(navigatorValue.language || '').slice(0, 30),
      standalone: root.matchMedia?.('(display-mode: standalone)')?.matches === true || navigatorValue.standalone === true
    };
  }

  const browser = browserDetails();
  const detectedFirefox = /(?:Firefox|FxiOS)\//.test(browser.userAgent);
  if (typeof root.__firefox__ === 'undefined') {
    try {
      Object.defineProperty(root, '__firefox__', {
        value: detectedFirefox,
        configurable: true,
        enumerable: false,
        writable: false
      });
    } catch {
      try { root.__firefox__ = detectedFirefox; } catch {}
    }
  }

  function safePageUrl(value = root.location?.href || '') {
    try {
      const url = new URL(String(value), root.location?.origin || undefined);
      return `${url.origin}${url.pathname}${url.hash || ''}`.slice(0, 800);
    } catch { return String(value || '').split('?')[0].slice(0, 800); }
  }
  function safeSourceUrl(value = '') {
    if (!value) return 'inline-or-injected';
    try {
      const url = new URL(String(value), root.location?.origin || undefined);
      return `${url.protocol}//${url.host}${url.pathname}`.slice(0, 800);
    } catch { return String(value).split('?')[0].slice(0, 800); }
  }
  function safeStack(value = '') {
    return String(value || '')
      .replace(/([?&](?:token|inviteToken|inviteHash|ownerId|code|key)=)[^&\s)]+/gi, '$1[redacted]')
      .slice(0, 4000);
  }
  function validContext(context) {
    return !!context?.authUid && !!context?.tenantKey
      && String(context.tenantKey) === `owner:${context.ownerId}:business:${context.businessId}`;
  }
  function storageTarget(context = activeContext) {
    if (validContext(context)) {
      return {
        storage: safeStorage('localStorage') || sessionStorage,
        key: `${STORAGE_PREFIX}${encodeURIComponent(context.authUid)}:${encodeURIComponent(context.tenantKey)}`
      };
    }
    return { storage: sessionStorage, key: `${STORAGE_PREFIX}PUBLIC:${runtimeSessionId}` };
  }
  function readReports(target = storageTarget()) {
    const parse = (value) => {
      try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
      } catch { return []; }
    };
    const primary = parse(safeGet(target.storage, target.key));
    const fallback = target.storage !== sessionStorage ? parse(safeGet(sessionStorage, target.key)) : [];
    const byId = new Map([...primary, ...fallback].map((entry) => [entry.reportId, entry]));
    return [...byId.values()].slice(-MAX_REPORTS);
  }
  function saveReport(report) {
    const target = storageTarget();
    const payload = JSON.stringify([...readReports(target), report].slice(-MAX_REPORTS));
    if (!safeSet(target.storage, target.key, payload) && target.storage !== sessionStorage) {
      safeSet(sessionStorage, target.key, payload);
    }
    root.CLICK360_LAST_RUNTIME_ERROR = report;
    return report;
  }
  function reportLink(report) {
    const message = `Necesito ayuda con CLICK 360. Codigo de reporte: ${report.reportId}. Version: ${APP_VERSION}. Navegador: ${report.browser.name} ${report.browser.version}.`;
    return `https://wa.me/593969399562?text=${encodeURIComponent(message)}`;
  }
  function showFriendlyMessage(report) {
    const render = () => {
      const toast = root.document?.getElementById('toast');
      if (!toast) return;
      toast.replaceChildren();
      const link = root.document.createElement('a');
      link.href = reportLink(report);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'reportarlo a CLICK';
      link.style.color = 'var(--gold)';
      link.style.textDecoration = 'underline';
      link.style.pointerEvents = 'auto';
      toast.append(root.document.createTextNode('Tuvimos un inconveniente. Puedes continuar o '), link, root.document.createTextNode('.'));
      toast.className = 'toast show err';
      clearTimeout(toast._t);
      toast._t = setTimeout(() => { toast.className = 'toast'; }, 6500);
    };
    if (root.document?.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', render, { once: true });
    else render();
  }
  function sourceKind(filename) {
    if (!filename || filename === 'inline-or-injected') return 'inline_or_injected';
    try {
      const url = new URL(filename, root.location?.origin || undefined);
      return url.origin === root.location?.origin ? 'first_party' : 'external_or_injected';
    } catch { return 'unknown'; }
  }
  function record(details = {}) {
    const message = String(details.message || 'Error de ejecucion no identificado').slice(0, 600);
    if (/ResizeObserver loop/i.test(message)) return null;
    const filename = safeSourceUrl(details.filename || '');
    const fingerprint = `${message}|${filename}|${Number(details.line || 0)}|${Number(details.column || 0)}`;
    const now = Date.now();
    if (fingerprint === lastFingerprint && now - lastFingerprintAt < 2000) return root.CLICK360_LAST_RUNTIME_ERROR || null;
    lastFingerprint = fingerprint;
    lastFingerprintAt = now;
    let accessDiagnostics = {};
    try { accessDiagnostics = root.click360GetPublicAuthDiagnostics?.() || {}; } catch {}
    const syncState = root.click360GetSyncStatus?.() || {};
    const storageState = root.click360GetStorageState?.() || {};
    const report = saveReport({
      reportId: createId('err'),
      createdAt: new Date(now).toISOString(),
      message,
      filename,
      line: Number(details.line || 0),
      column: Number(details.column || 0),
      stack: safeStack(details.stack || ''),
      sourceKind: sourceKind(filename),
      browser,
      appVersion: APP_VERSION,
      assetVersion: ASSET_VERSION,
      pageUrl: safePageUrl(),
      online: root.navigator?.onLine !== false,
      authState: root.click360Auth?.currentUser ? 'authenticated' : 'unauthenticated',
      accessUiState: String(root.click360AccessUiState?.state || '').slice(0, 40),
      publicIntent: String(accessDiagnostics.intent || '').slice(0, 20),
      invitationParametersPresent: accessDiagnostics.invitationParametersPresent === true,
      explicitInvitationIntent: accessDiagnostics.explicitInvitationIntent === true,
      syncMode: String(syncState.status || '').slice(0, 40),
      storageMode: String(storageState.mode || '').slice(0, 40)
    });
    showFriendlyMessage(report);
    return report;
  }
  function setContext(context) {
    if (!validContext(context)) return false;
    const publicTarget = storageTarget(null);
    const pending = readReports(publicTarget);
    activeContext = Object.freeze({
      authUid: String(context.authUid),
      ownerId: String(context.ownerId),
      businessId: String(context.businessId),
      tenantKey: String(context.tenantKey)
    });
    if (pending.length) {
      const tenantTarget = storageTarget(activeContext);
      safeSet(tenantTarget.storage, tenantTarget.key, JSON.stringify([...readReports(tenantTarget), ...pending].slice(-MAX_REPORTS)));
      safeRemove(publicTarget.storage, publicTarget.key);
    }
    return true;
  }
  function clearContext() { activeContext = null; }

  if (typeof root.addEventListener === 'function') {
    root.addEventListener('error', (event) => {
      const resource = event?.target && event.target !== root
        ? event.target.currentSrc || event.target.src || event.target.href || ''
        : '';
      record({
        message: event?.message || (resource ? 'No se pudo cargar un recurso de la aplicacion.' : 'Error de ejecucion no identificado.'),
        filename: event?.filename || resource,
        line: event?.lineno,
        column: event?.colno,
        stack: event?.error?.stack || ''
      });
    }, true);
    root.addEventListener('unhandledrejection', (event) => {
      const reason = event?.reason;
      record({
        message: reason?.message || String(reason || 'Promesa rechazada sin detalle.'),
        filename: reason?.fileName || '',
        line: reason?.lineNumber,
        column: reason?.columnNumber,
        stack: reason?.stack || ''
      });
    });
  }

  root.CLICK360_RUNTIME_GUARD = Object.freeze({
    APP_VERSION,
    ASSET_VERSION,
    browser,
    detectedFirefox,
    record,
    setContext,
    clearContext,
    listReports: () => readReports(storageTarget()).map((entry) => ({ ...entry }))
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
