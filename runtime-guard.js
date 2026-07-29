(function (root) {
  'use strict';

  const APP_VERSION = '1.0.5';
  const ASSET_VERSION = 'commercial-1-0-5-r4';
  const STORAGE_PREFIX = 'CLICK360:V16_2:RUNTIME_ERRORS:';
  const SESSION_ID_KEY = 'CLICK360:V16_2:RUNTIME_SESSION_ID';
  const MAX_REPORTS = 12;
  let activeContext = null;
  let lastFingerprint = '';
  let lastFingerprintAt = 0;
  let releaseMetadata = Object.freeze({
    appVersion: APP_VERSION,
    assetVersion: ASSET_VERSION,
    buildSha: '',
    environment: 'production'
  });

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
  function shortHash(value = '') {
    const text = String(value || '');
    if (!text) return '';
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `anon_${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }
  function setReleaseMetadata(next = {}) {
    const current = releaseMetadata;
    releaseMetadata = Object.freeze({
      appVersion: String(next.appVersion || current.appVersion || APP_VERSION).slice(0, 80),
      assetVersion: String(next.assetVersion || current.assetVersion || ASSET_VERSION).slice(0, 120),
      buildSha: String(next.buildSha || current.buildSha || '').slice(0, 40),
      environment: String(next.environment || current.environment || 'production').slice(0, 40)
    });
    return releaseMetadata;
  }
  function versionLabel() {
    const sha = releaseMetadata.buildSha ? ` ${releaseMetadata.buildSha.slice(0, 12)}` : '';
    return `${releaseMetadata.appVersion}${sha}`;
  }
  function displayMode() {
    const navigatorValue = root.navigator || {};
    return root.matchMedia?.('(display-mode: standalone)')?.matches === true || navigatorValue.standalone === true
      ? 'standalone'
      : 'browser';
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
      standalone: displayMode() === 'standalone'
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
  function safeCause(value = '') {
    return String(value || '')
      .replace(/([?&](?:token|inviteToken|inviteHash|ownerId|code|key)=)[^&\s)]+/gi, '$1[redacted]')
      .slice(0, 900);
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
    const message = [
      'Necesito ayuda con CLICK 360.',
      `Codigo de reporte: ${report.reportId}.`,
      `Version: ${report.appVersion}${report.buildSha ? ` ${report.buildSha}` : ''}.`,
      `Asset: ${report.assetVersion}.`,
      `Modo: ${report.displayMode}.`,
      `Ruta: ${report.route}.`,
      `Acceso: ${report.effectiveAccess?.mode || 'unknown'} readOnly=${report.effectiveAccess?.readOnly === true}.`,
      `Navegador: ${report.browser.name} ${report.browser.version}.`
    ].join(' ');
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
	    let reliabilityState = {};
	    try { reliabilityState = root.click360GetSyncState?.({ reason: 'runtime_report' }) || {}; } catch {}
	    let cashCloseState = {};
	    try { cashCloseState = root.click360GetCashCloseDiagnostics?.() || {}; } catch {}
	    const storageState = root.click360GetStorageState?.() || {};
    let effectiveAccess = {};
    try {
      const rawAccess = root.click360GetEffectiveAccess?.() || root.click360AccessState || {};
      effectiveAccess = {
        mode: String(rawAccess.mode || '').slice(0, 40),
        readOnly: rawAccess.readOnly === true
      };
    } catch {}
    let activeBusinessId = activeContext?.businessId || '';
    try { activeBusinessId ||= root.click360GetTenantState?.()?.activeBusinessId || ''; } catch {}
    const report = saveReport({
      reportId: createId('err'),
      createdAt: new Date(now).toISOString(),
      message,
      filename,
      line: Number(details.line || 0),
      column: Number(details.column || 0),
      stack: safeStack(details.stack || ''),
      cause: safeCause(details.cause || details.errorCode || ''),
      sourceKind: sourceKind(filename),
      browser,
      appVersion: releaseMetadata.appVersion,
      buildSha: releaseMetadata.buildSha,
      assetVersion: releaseMetadata.assetVersion,
      releaseLabel: versionLabel(),
      displayMode: displayMode(),
      route: String(root.location?.hash || root.location?.pathname || '').slice(0, 180),
      activeBusinessId: shortHash(activeBusinessId),
      effectiveAccess,
      pageUrl: safePageUrl(),
      online: root.navigator?.onLine !== false,
      authState: root.click360Auth?.currentUser ? 'authenticated' : 'unauthenticated',
      accessUiState: String(root.click360AccessUiState?.state || '').slice(0, 40),
      publicIntent: String(accessDiagnostics.intent || '').slice(0, 20),
      invitationParametersPresent: accessDiagnostics.invitationParametersPresent === true,
      explicitInvitationIntent: accessDiagnostics.explicitInvitationIntent === true,
	      syncMode: String(syncState.status || '').slice(0, 40),
	      storageMode: String(storageState.mode || '').slice(0, 40),
		      reliability: {
		        status: String(reliabilityState.status || '').slice(0, 40),
		        blocking: reliabilityState.blocking === true,
		        reason: String(reliabilityState.reason || '').slice(0, 80),
		        localHash: String(reliabilityState.localHash || '').slice(0, 24),
		        remoteHash: String(reliabilityState.remoteHash || '').slice(0, 24),
		        lockAgeMs: Number(reliabilityState.lockAgeMs || 0),
		        hasDirtyFields: reliabilityState.hasDirtyFields === true,
		        displayMode: String(reliabilityState.displayMode || displayMode()).slice(0, 24)
		      },
		      cashClose: {
		        stage: String(cashCloseState.stage || '').slice(0, 80),
		        status: String(cashCloseState.status || '').slice(0, 40),
		        reason: String(cashCloseState.reason || '').slice(0, 120),
		        errorCode: String(cashCloseState.errorCode || '').slice(0, 80),
		        business: shortHash(cashCloseState.activeBusinessId || ''),
		        session: shortHash(cashCloseState.cashSessionId || ''),
		        report: shortHash(cashCloseState.reportId || '')
		      }
		    });
	    if (details.uiHandled !== true) showFriendlyMessage(report);
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
        stack: event?.error?.stack || '',
        cause: event?.error?.cause?.message || event?.error?.code || ''
      });
    }, true);
    root.addEventListener('unhandledrejection', (event) => {
      const reason = event?.reason;
      record({
        message: reason?.message || String(reason || 'Promesa rechazada sin detalle.'),
        filename: reason?.fileName || '',
        line: reason?.lineNumber,
        column: reason?.columnNumber,
        stack: reason?.stack || '',
        cause: reason?.cause?.message || reason?.code || ''
      });
    });
  }

  root.CLICK360_RUNTIME_GUARD = Object.freeze({
    APP_VERSION,
    ASSET_VERSION,
    browser,
    detectedFirefox,
    record,
    setReleaseMetadata,
    getReleaseMetadata: () => ({ ...releaseMetadata }),
    displayMode,
    setContext,
    clearContext,
    listReports: () => readReports(storageTarget()).map((entry) => ({ ...entry }))
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
