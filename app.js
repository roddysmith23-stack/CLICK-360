
(() => {
  'use strict';

  const STATE_PREFIX = 'CLICK360:V16:STATE:';
  const SESSION_PREFIX = 'CLICK360:V16:SESSION:';
  const CACHE_META_PREFIX = 'CLICK360:V16:CACHEMETA:';
  const LEGACY_STATE_PREFIX = 'CLICK360_STATE:';
  const LEGACY_SESSION_PREFIX = 'CLICK360_SESSION:';
  const APP_ASSET_VERSION = 'commercial-1-0-5-r29';
  const APP_RELEASE_VERSION = '1.0.5';
  const APP_BUILD_SHA = '__CLICK360_BUILD_SHA__';
  const APP_VISIBLE_VERSION = `${APP_RELEASE_VERSION}${APP_BUILD_SHA && APP_BUILD_SHA !== '__CLICK360_BUILD_SHA__' ? ` · ${APP_BUILD_SHA}` : ''}`;
  window.CLICK360_RUNTIME_GUARD?.setReleaseMetadata?.({
    appVersion: APP_RELEASE_VERSION,
    assetVersion: APP_ASSET_VERSION,
    buildSha: APP_BUILD_SHA && APP_BUILD_SHA !== '__CLICK360_BUILD_SHA__' ? APP_BUILD_SHA : ''
  });
  const HOME_BANNER_SRC = `assets/banner-click360-home.png?v=${APP_ASSET_VERSION}`;
  const PROFILE_CACHE_PREFIX = 'CLICK360:V16:PROFILE:';
  const PROFILE_PENDING_PREFIX = 'CLICK360:V16:PROFILE_PENDING:';
  const LEGACY_PROFILE_CACHE_PREFIX = 'CLICK360_USER_PROFILE_';
  const LEGACY_PROFILE_PENDING_PREFIX = 'CLICK360_PROFILE_PENDING:';
  const tenantRuntime = window.CLICK360_P0_TENANT_GUARD;
  const criticalActionGate = window.CLICK360_V16_DOMAIN?.createOperationGate?.();
  const MAX_IMAGE_INPUT_BYTES = 8 * 1024 * 1024;
  const MAX_LOCAL_TENANT_STATE_BYTES = tenantRuntime?.MAX_CLOUD_PAYLOAD_BYTES || 850000;
  const LOCAL_BACKUP_RETENTION = 3;
  const WORKER_TENANT_ACCESS_ENABLED = true;
  const RECEIPT_FOOTER_TEXT = 'Control total de tu negocio con CLICK 360';
  const RECEIPT_DEFAULT_NOTE = 'Comprobante interno. No válido como factura electrónica.';
  const RECEIPT_WIDTH_PRESETS = Object.freeze({
    'receipt-57': { label:'Ticket 57 mm centrado', widthMm:57 },
    'receipt-58': { label:'Ticket 58 mm', widthMm:58 },
    'receipt-60': { label:'Ticket 60 mm', widthMm:60 },
    'receipt-76': { label:'Ticket 76 mm', widthMm:76 },
    'receipt-80': { label:'Ticket 80 mm', widthMm:80 },
    'receipt-custom': { label:'Personalizado', widthMm:80 }
  });
  const RECEIPT_PAPER_PRESETS = Object.freeze({
    'thermal-57': { label:'Ticket térmico 57 mm', mediaType:'receipt', receiptWidthMm:57, receiptHeightMm:150, mediaWidthMm:57, mediaHeightMm:0, columns:1, rows:1, gapXmm:0, gapYmm:0, marginTopMm:0, marginRightMm:0, marginBottomMm:0, marginLeftMm:0, dpi:203 },
    'thermal-58': { label:'Ticket térmico 58 mm', mediaType:'receipt', receiptWidthMm:58, receiptHeightMm:150, mediaWidthMm:58, mediaHeightMm:0, columns:1, rows:1, gapXmm:0, gapYmm:0, marginTopMm:0, marginRightMm:0, marginBottomMm:0, marginLeftMm:0, dpi:203 },
    'thermal-80': { label:'Ticket térmico 80 mm', mediaType:'receipt', receiptWidthMm:80, receiptHeightMm:170, mediaWidthMm:80, mediaHeightMm:0, columns:1, rows:1, gapXmm:0, gapYmm:0, marginTopMm:0, marginRightMm:0, marginBottomMm:0, marginLeftMm:0, dpi:203 },
    'continuous-80': { label:'Papel continuo 80 mm', mediaType:'continuous', receiptWidthMm:80, receiptHeightMm:170, mediaWidthMm:80, mediaHeightMm:0, columns:1, rows:1, gapXmm:0, gapYmm:0, marginTopMm:0, marginRightMm:0, marginBottomMm:0, marginLeftMm:0, dpi:203 },
    'roll-2-40x30': { label:'Rollo 2 columnas · 40x30 mm', mediaType:'roll', receiptWidthMm:40, receiptHeightMm:30, mediaWidthMm:84, mediaHeightMm:30, columns:2, rows:1, gapXmm:4, gapYmm:0, marginTopMm:0, marginRightMm:0, marginBottomMm:0, marginLeftMm:0, dpi:203 },
    'roll-2-60x40': { label:'Rollo 2 columnas · 60x40 mm', mediaType:'roll', receiptWidthMm:60, receiptHeightMm:40, mediaWidthMm:124, mediaHeightMm:40, columns:2, rows:1, gapXmm:4, gapYmm:0, marginTopMm:0, marginRightMm:0, marginBottomMm:0, marginLeftMm:0, dpi:203 },
    'roll-3-40x30': { label:'Rollo 3 columnas · 40x30 mm', mediaType:'roll', receiptWidthMm:40, receiptHeightMm:30, mediaWidthMm:128, mediaHeightMm:30, columns:3, rows:1, gapXmm:4, gapYmm:0, marginTopMm:0, marginRightMm:0, marginBottomMm:0, marginLeftMm:0, dpi:203 },
    'sheet-a4-2': { label:'Hoja A4 · 2 columnas', mediaType:'sheet', receiptWidthMm:90, receiptHeightMm:55, mediaWidthMm:210, mediaHeightMm:297, columns:2, rows:4, gapXmm:6, gapYmm:6, marginTopMm:10, marginRightMm:10, marginBottomMm:10, marginLeftMm:10, dpi:300 },
    'sheet-a4-3': { label:'Hoja A4 · 3 columnas', mediaType:'sheet', receiptWidthMm:60, receiptHeightMm:45, mediaWidthMm:210, mediaHeightMm:297, columns:3, rows:6, gapXmm:4, gapYmm:4, marginTopMm:8, marginRightMm:8, marginBottomMm:8, marginLeftMm:8, dpi:300 },
    'sheet-a3': { label:'Hoja A3 · comprobantes grandes', mediaType:'sheet', receiptWidthMm:90, receiptHeightMm:70, mediaWidthMm:297, mediaHeightMm:420, columns:3, rows:5, gapXmm:6, gapYmm:6, marginTopMm:12, marginRightMm:12, marginBottomMm:12, marginLeftMm:12, dpi:300 },
    'square-50': { label:'Etiqueta cuadrada 50x50 mm', mediaType:'sheet', receiptWidthMm:50, receiptHeightMm:50, mediaWidthMm:50, mediaHeightMm:50, columns:1, rows:1, gapXmm:0, gapYmm:0, marginTopMm:0, marginRightMm:0, marginBottomMm:0, marginLeftMm:0, dpi:203 },
    custom: { label:'Personalizado', mediaType:'custom', receiptWidthMm:80, receiptHeightMm:150, mediaWidthMm:80, mediaHeightMm:150, columns:1, rows:1, gapXmm:0, gapYmm:0, marginTopMm:0, marginRightMm:0, marginBottomMm:0, marginLeftMm:0, dpi:203 }
  });
  const RECEIPT_BLOCKS = Object.freeze([
    { id:'branding', label:'Marca y negocio', help:'Logo, nombre y datos del negocio' },
    { id:'document', label:'Encabezado del comprobante', help:'Título, número y fecha' },
    { id:'customer', label:'Cliente y vendedor', help:'Datos de cliente y responsable' },
    { id:'items', label:'Detalle de venta', help:'Productos, cantidades y totales' },
    { id:'payment', label:'Pago y resumen', help:'Subtotal, pago y cambio' },
    { id:'thanks', label:'Mensaje final', help:'Mensaje de gracias y nota interna' }
  ]);

  // P1 FIX: Guard para cambio atómico de negocio.
  // Previene doble-tap, herencia de readOnly entre negocios y estado visual contradictorio.
  // true mientras la transición está en curso; accessInfo() devuelve estado seguro durante este período.
  let BUSINESS_SWITCH_GUARD = false;

  /**
   * Calcula readOnly efectivo desde el accessState actual, aplicando
   * la precedencia correcta de V16.2:
   *   founder / lifetime → nunca readOnly
   *   paid_base / paid_pro / member → readOnly solo si está expirado
   *   trial / trial_expired → readOnly según reloj
   *   switching en curso → false (no mostrar modo lectura durante transición)
   * @param {object} accessState - window.click360AccessState o equivalente
   * @returns {boolean}
   */
  function resolveReadOnly(accessState) {
    if (BUSINESS_SWITCH_GUARD) return false;
    if (!accessState || typeof accessState !== 'object') return false;
    const mode = String(accessState.mode || '').toLowerCase();
    const status = String(accessState.status || '').toLowerCase();
    const plan = String(accessState.plan || '').toLowerCase();
    const planCode = String(accessState.planCode || '').toLowerCase();
    const billingStatus = String(accessState.billingStatus || '').toLowerCase();
    const platformRole = String(accessState.platformRole || '').toLowerCase();
    const customerTier = String(accessState.customerTier || '').toLowerCase();
    if (['suspended', 'blocked', 'disabled'].includes(status) || ['blocked', 'suspended'].includes(mode)) return true;
    if (platformRole === 'platform_founder' || customerTier === 'platform_founder') return false;
    if (plan === 'founder_unlimited' || planCode === 'founder_unlimited') return false;
    if (mode === 'founder' || mode === 'lifetime') return false;
    if (accessState.lifetime === true && billingStatus === 'lifetime') return false;
    if (planCode === 'pro_lifetime' && billingStatus === 'lifetime' && accessState.lifetime === true) return false;
    if (mode === 'member') return false;
    if (mode === 'paid_base' || mode === 'paid_pro') return accessState.readOnly === true;
    if (mode === 'trial_active') return false;
    return accessState.readOnly === true;
  }
  function accessInfo() {
    const raw = window.click360AccessState || { mode: 'founder', plan: 'founder', readOnly: false, source: 'approvedUsers' };
    if (BUSINESS_SWITCH_GUARD) return { ...raw, readOnly: false };
    return { ...raw, readOnly: resolveReadOnly(raw) };
  }
  window.click360ResolveReadOnly = resolveReadOnly;
  window.click360GetEffectiveAccess = accessInfo;
  window.click360CanWriteByAccess = () => !accessInfo().readOnly;
  let lastWriteBlock = null;
  function writeGateStatus() {
    const external = typeof window.click360WriteGate === 'function' ? window.click360WriteGate() : null;
    if (external && external.allowed === false) {
      const access = accessInfo();
      if (external.reason === 'read_only' && !access.readOnly) return { allowed: true, reason: 'effective_access_allows' };
      return external;
    }
    return { allowed: true, reason: 'ok' };
  }
  function writeBlockMessage(gate = {}) {
    const reason = String(gate.reason || 'unknown');
    if (reason === 'read_only') return 'Tu acceso está en modo lectura. Contacta a CLICK 360 para activar tu plan.';
    if (reason === 'pending_remote_sync') return 'Sincronizando cambios...';
    if (reason === 'offline_online_only') return 'Este dispositivo necesita internet para guardar. Conéctate y vuelve a intentar.';
    if (reason === 'legacy_migration_required') return 'Estos datos están protegidos hasta completar una migración segura.';
    if (reason === 'sync_conflict') return 'Hay un conflicto de sincronización pendiente. Actualiza desde nube o respalda antes de continuar.';
    if (reason === 'auth_not_ready') return 'La sesión aún se está verificando. Intenta nuevamente en unos segundos.';
    if (reason === 'tenant_guard_not_ready') return 'La cuenta aún está preparando la protección de datos. Intenta nuevamente en unos segundos.';
    return gate.message || 'No se pudo guardar ahora. Tus datos anteriores siguen intactos.';
  }
  function clampNumber(value, min, max, fallback = min) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }
  function markAppReady(stage = 'app') {
    window.__click360AppReady = true;
    window.dispatchEvent(new CustomEvent('click360:ready', { detail:{ stage, appVersion:APP_RELEASE_VERSION, assetVersion:APP_ASSET_VERSION } }));
    if (typeof window.click360MarkSplashReady === 'function') window.click360MarkSplashReady();
  }

  /**
   * Cambia de negocio de forma atómica:
   * 1. Bloquea nuevos cambios (anti double-tap)
   * 2. Actualiza activeBusinessId
   * 3. Persiste si es owner
   * 4. Recalcula readOnly desde el accessState actual del usuario (no del negocio)
   * 5. Renderiza con el estado limpio
   * 6. Desbloquea
   *
   * NO toca Firebase, Auth, Rules ni datos.
   * @param {string} nextId - ID del negocio destino
   * @param {string} currentRoute - ruta activa actual
   */
  function selectBusinessAtomically(nextId, currentRoute) {
    // Guard: evitar doble-tap o cambio mientras ya se está cambiando
    if (BUSINESS_SWITCH_GUARD) return;
    if (!state.businesses.some((b) => b.id === nextId)) return;
    if (state.activeBusinessId === nextId) { closeModal(); return; }

    BUSINESS_SWITCH_GUARD = true;
    try {
      // 1. Cambiar ID de negocio activo
      state.activeBusinessId = nextId;

      // 2. Persistir si el usuario es owner (mismo comportamiento que antes)
      if (authUser().role === 'owner') {
        window.click360ClearStaleSyncGuard?.({ reason: 'business_switch' });
        save({ nonBlockingSync: true, operationId: uid('business-switch'), syncSource: 'business_switch' });
      }

      // 3. Cerrar modal antes de renderizar
      closeModal();

      // 4. Renderizar — accessInfo() devolverá estado seguro mientras BUSINESS_SWITCH_GUARD=true
      renderApp(currentRoute);
    } finally {
      // 5. Desbloquear en el siguiente tick para que la UI ya haya pintado
      // Usamos setTimeout 0 para liberar el event loop y evitar que un segundo tap
      // se procese antes de que el render termine.
      setTimeout(() => { BUSINESS_SWITCH_GUARD = false; }, 0);
    }
  }
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
  const app = $('#app');
  const toastEl = $('#toast');

  function icon(name, label = '') {
    return `<i data-lucide="${escapeHtml(name)}"${label ? ` aria-label="${escapeHtml(label)}"` : ' aria-hidden="true"'}></i>`;
  }
  function refreshIcons(root = document) {
    requestAnimationFrame(() => window.lucide?.createIcons({ root, attrs: { 'stroke-width': 2, width: 20, height: 20 } }));
  }

  // No business state is loaded until Firebase resolves an authenticated tenant.
  let activeTenantContext = null;
  let state = seed();
  let lastPersistedState = null;
  let session = null;
  let route = 'home';
  let scanStream = null;
  let scanTimer = null;
  let lastScanAt = 0;
  let scannerGeneration = 0;
  let deferredInstallPrompt = null;
  let lastAutoSaveHash = '';
  let tenantStateDeferred = false;
  let onboardingPrompted = false;
  let clockTimer = null;
  let modalReturnFocus = null;
  let modalKeyHandler = null;
	  let storageState = Object.freeze({ mode: 'checking', indexedDbReady: false, localReady: true, tenantKey: null, message: '' });
	  let indexedTenantCacheMeta = null;
	  let lastSavePersistence = null;
	  const onlineOnlyCommitCheckpoints = new Map();
	  const cashCloseInFlight = new Set();
	  let lastCashCloseDiagnostic = Object.freeze({ stage: 'idle', status: 'idle', blocking: false, reason: '' });

  function publishStorageState(next = {}) {
    storageState = Object.freeze({ ...storageState, ...next, tenantKey: activeTenantContext?.tenantKey || next.tenantKey || null });
    window.click360StorageState = storageState;
    window.dispatchEvent(new CustomEvent('click360-storage-mode', { detail: storageState }));
    return storageState;
  }
  window.click360GetStorageState = () => ({ ...storageState });

  function localStorageReady(context = activeTenantContext) {
    if (!context?.authUid || !context?.tenantKey) return false;
    const key = `CLICK360:V16:STORAGE_PROBE:${context.authUid}:${context.tenantKey}`;
    try {
      localStorage.setItem(key, '1');
      localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
  });

  function uid(prefix='id') {
    if (window.crypto?.randomUUID) return `${prefix}_${window.crypto.randomUUID()}`;
    return `${prefix}_${Math.random().toString(36).slice(2,8)}${Date.now().toString(36).slice(-4)}`;
  }
  function slug(s) { return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || 'negocio'; }
  let workingDate = null;
  function localDateKey(date = new Date()) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  function today() { return workingDate || localDateKey(); }
  function safeDateInputValue(value, fallback = today()) {
    const date = String(value || '');
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : fallback;
  }
  function numericInputValue(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? String(number) : String(fallback);
  }
  function setWorkingDate(d) {
    workingDate = d || null;
    renderApp(route);
  }
  function nowLabel() { return new Date().toLocaleString('es-EC', { dateStyle:'short', timeStyle:'medium' }); }
  function formattedTodaySpanish() {
    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const parts = today().split('-');
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    const dayName = days[d.getDay()];
    const dayNum = d.getDate();
    const monthName = months[d.getMonth()];
    const year = d.getFullYear();
    return `${dayName}, ${dayNum} de ${monthName} de ${year}`;
  }
  function businessTimeZone() {
    return currentBusiness?.()?.settings?.timeZone || 'America/Guayaquil';
  }
  function liveClockLabel(compact = false) {
    try {
	      return window.CLICK360_V16_DOMAIN?.formatBusinessClock(Date.now(), 'es-EC', businessTimeZone(), compact)
	        || new Date().toLocaleString('es-EC');
    } catch { return new Date().toLocaleString('es-EC'); }
  }
  function escapeHtml(str) { return String(str ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function actionId(value) { return encodeURIComponent(String(value ?? '')).replace(/'/g, '%27'); }
  function decodeActionId(value) { try { return decodeURIComponent(String(value ?? '')); } catch { return ''; } }
  function safeImageSrc(value) { return tenantRuntime?.safeImageSrc(value) || ''; }
  function safeColor(value, fallback) {
    const color = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
  }
  function sanitizeStoredReportHtml(value) {
    const template = document.createElement('template');
    template.innerHTML = String(value || '');
    template.content.querySelectorAll('script,iframe,object,embed,link,meta,base,form,input,button,svg,math').forEach(node => node.remove());
    template.content.querySelectorAll('*').forEach(node => {
      [...node.attributes].forEach(attribute => {
        const name = attribute.name.toLowerCase();
        const content = attribute.value.trim();
        if (name.startsWith('on') || name === 'srcdoc' || name === 'href' || name === 'src') {
          node.removeAttribute(attribute.name);
        } else if (name === 'style' && /(?:url\s*\(|expression\s*\(|@import|javascript:|behavior:)/i.test(content)) {
          node.removeAttribute(attribute.name);
        }
      });
    });
    return template.innerHTML;
  }
  let html2canvasLoader = null;
  function loadHtml2Canvas() {
    if (typeof window.html2canvas === 'function') return Promise.resolve(window.html2canvas);
    if (html2canvasLoader) return html2canvasLoader;
    html2canvasLoader = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `vendor/html2canvas.min.js?v=${APP_ASSET_VERSION}`;
      script.onload = () => {
        script.remove();
        if (typeof window.html2canvas === 'function') resolve(window.html2canvas);
        else reject(new Error('html2canvas no quedó disponible.'));
      };
      script.onerror = () => {
        script.remove();
        html2canvasLoader = null;
        reject(new Error('No se pudo cargar html2canvas.'));
      };
      document.head.appendChild(script);
    });
    return html2canvasLoader;
  }
  function downloadHtmlAsPng(html, filename, options = {}) {
    toast('Generando Imagen...');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    wrapper.style.position = 'fixed';
    wrapper.style.top = '0';
    wrapper.style.left = '0';
    wrapper.style.width = options.width || '480px';
    wrapper.style.zIndex = '-9999';
    wrapper.style.pointerEvents = 'none';
    document.body.appendChild(wrapper);
    return loadHtml2Canvas()
      .then(renderer => renderer(wrapper.firstElementChild, { scale: 2, useCORS: options.useCORS === true }))
      .then(canvas => {
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = filename;
        link.click();
        toast('Imagen descargada');
      })
      .catch(error => {
        console.warn('No se pudo generar la imagen:', error.message);
        toast('No se pudo generar la imagen. Usa Imprimir.', 'err');
      })
      .finally(() => wrapper.remove());
  }

  // Print dialog state machine: prevents concurrent print/PDF invocations
  // States: 'idle' | 'preparing' | 'open' | 'waiting' | 'finished'
  let _printDialogState = 'idle';
  function _setPrintDialogState(state) {
    _printDialogState = state;
    // Disable/enable primary print buttons while printing is active
    if (typeof document !== 'undefined') {
      ['printOne', 'savePdfBtn', 'ulcPrint', 'ulcSystemPrint', 'printReceiptBtn', 'downloadPdfBtn', 'receiptDesignerPdf', 'receiptDesignerPdfInline', 'printerTest'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = (state !== 'idle' && state !== 'finished');
      });
    }
  }
  // Reset on afterprint (fired when dialog closes, whether user prints or cancels)
  if (typeof window !== 'undefined') {
    window.addEventListener('afterprint', () => {
      if (_printDialogState !== 'idle') _setPrintDialogState('idle');
    });
  }

  async function handoffPrint(job, providerId = '') {
    // Guard: prevent multiple concurrent print dialogs
    if (_printDialogState === 'preparing' || _printDialogState === 'open' || _printDialogState === 'waiting') {
      console.warn('[CLICK360] Print dialog already active, ignoring duplicate call. State:', _printDialogState);
      return null;
    }
    _setPrintDialogState('preparing');
    try {
      const preferences = printingPreferences();
      const selectedProvider = providerId || preferences.provider || 'system';
      const preparedJob = { ...job, copies: job.copiesHandled ? 1 : Math.max(1, Number(job.copies || preferences.copies || 1)) };
      if (window.CLICK360_PRINTING?.print) {
        _setPrintDialogState('open');
        const result = await window.CLICK360_PRINTING.print(selectedProvider, preparedJob);
        _setPrintDialogState('finished');
        _setPrintDialogState('idle');
        if (result?.status === 'handed_off') toast('Documento enviado al diálogo de impresión.');
        if (result?.status === 'exported') toast('PDF generado.');
        return result;
      }
      const root = $('#printRoot') || document.createElement('div');
      root.id = 'printRoot'; root.className = 'printSheet';
      if (!root.isConnected) document.body.appendChild(root);
      root.replaceChildren();
      if (preparedJob.node instanceof Node) root.appendChild(preparedJob.node.cloneNode(true));
      else if (preparedJob.html) root.innerHTML = String(preparedJob.html);
      else throw Object.assign(new Error('No hay contenido imprimible preparado.'), { code:'empty-print-job' });
      _setPrintDialogState('open');
      window.print();
      // afterprint event will reset to idle
      return { status: 'handed_off', provider: 'legacy-system' };
    } catch (error) {
      _setPrintDialogState('idle');
      console.warn('Impresión no disponible:', error.code || error.message);
      toast(error.message || 'No se pudo abrir la impresión. Usa PDF o PNG.', 'err');
      return null;
    }
  }

  function imageThumb(product){
    const src = safeImageSrc(product?.imageData);
    if(src) return `<img class="productImg" src="${escapeHtml(src)}" alt="${escapeHtml(product.name || 'Producto')}" loading="lazy">`;
    return `<div class="productImg emptyImg">▧</div>`;
  }
  function dataUrlBytes(value) {
    const src = String(value || '');
    const comma = src.indexOf(',');
    return comma < 0 ? 0 : Math.floor((src.length - comma - 1) * 0.75);
  }
	  function readImageInput(input, cb, options={}){
	    const file = input?.files?.[0];
	    if(!file) return false;
	    if(!file.type.startsWith('image/')) return toast('Selecciona una imagen válida','err');
	    if(file.size > MAX_IMAGE_INPUT_BYTES) return toast('La imagen supera 8 MB. Elige una foto más ligera.', 'err');
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxBytes = options.maxBytes || 30 * 1024;
        let max = options.max || 320;
        let quality = options.quality || 0.52;
        let encoded = '';
        for (let attempt = 0; attempt < 6; attempt += 1) {
          const ratio = Math.min(1, max / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * ratio));
          canvas.height = Math.max(1, Math.round(img.height * ratio));
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          encoded = canvas.toDataURL('image/jpeg', quality);
          if (dataUrlBytes(encoded) <= maxBytes) break;
          max = Math.max(96, Math.floor(max * 0.72));
          quality = Math.max(0.34, quality - 0.06);
        }
        if (dataUrlBytes(encoded) > maxBytes) {
          toast('No se pudo reducir la foto lo suficiente. Elige una imagen más simple.', 'err');
          return;
        }
        cb(safeImageSrc(encoded));
      };
      img.onerror = () => toast('No se pudo leer la imagen','err');
      img.src = reader.result;
    };
	    reader.readAsDataURL(file);
	    return true;
	  }
  function bindImageInputPair({ cameraInputId, galleryInputId, cameraButtonId, galleryButtonId, onImage, options = {} }) {
    const cameraInput = document.getElementById(cameraInputId);
    const galleryInput = document.getElementById(galleryInputId);
    const cameraButton = document.getElementById(cameraButtonId);
    const galleryButton = document.getElementById(galleryButtonId);
    const handleImage = (event) => {
      readImageInput(event.target, onImage, options);
      event.target.value = '';
    };
    if (galleryInput) {
      galleryInput.setAttribute('accept', 'image/*');
      galleryInput.removeAttribute('capture');
      galleryInput.onchange = handleImage;
    }
    if (cameraInput) {
      cameraInput.setAttribute('accept', 'image/*');
      cameraInput.setAttribute('capture', 'environment');
      cameraInput.onchange = handleImage;
    }
    if (galleryButton && galleryInput) {
      galleryButton.onclick = () => {
        galleryInput.value = '';
        galleryInput.click();
      };
    }
    if (cameraButton && cameraInput) {
      cameraButton.onclick = () => {
        cameraInput.value = '';
        cameraInput.click();
      };
    }
  }
function parseMoney(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : NaN;
    let s = String(value ?? '').trim().replace(/\s/g,'');
    if (!s) return 0;
    s = s.replace(/[^0-9,.-]/g,'');
    const neg = s.startsWith('-');
    s = s.replace(/-/g,'');
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    let sep = null;
    if (lastComma >= 0 || lastDot >= 0) sep = lastComma > lastDot ? ',' : '.';
    let n;
    if (sep) {
      const parts = s.split(sep);
      const dec = (parts.pop() || '').replace(/\D/g,'').slice(0,2);
      const whole = parts.join('').replace(/\D/g,'') || '0';
      n = Number(whole + '.' + dec.padEnd(2,'0'));
    } else n = Number(s.replace(/\D/g,'') || 0);
    if (!Number.isFinite(n)) return NaN;
    return neg ? -n : Math.round(n * 100) / 100;
  }
  function fmt(value) { return `$${(Number(value)||0).toFixed(2)}`; }
  // Format price for label printing according to template priceFormat setting
  function labelFmt(product, priceFormat) {
    const cash = Number(product?.price || 0);
    const card = Number(product?.cardPrice || 0);
    const hasCard = card > 0 && Math.abs(card - cash) > 0.001;
    switch (priceFormat) {
      case 'abbr': return hasCard ? `Ef.${fmt(cash)}·Tj.${fmt(card)}` : fmt(cash);
      case 'noLabel': return hasCard ? `${fmt(cash)}·${fmt(card)}` : fmt(cash);
      case 'cash': return fmt(cash);
      default: return hasCard ? `Efectivo ${fmt(cash)} · Tarjeta ${fmt(card)}` : fmt(cash);
    }
  }
  function toast(msg, type='ok') {
    toastEl.textContent = msg;
    toastEl.className = `toast show ${type}`;
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.className = 'toast', 2800);
  }
  function beep(kind='ok') {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const now = ctx.currentTime;
        osc.type = kind === 'err' ? 'sawtooth' : 'square';
        osc.frequency.setValueAtTime(kind === 'sale' ? 1040 : kind === 'err' ? 180 : 880, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(kind === 'err' ? 0.11 : 0.16, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now); osc.stop(now + 0.13);
        osc.onended = () => ctx.close().catch(() => {});
      }
    } catch {}
    try { if (navigator.vibrate) navigator.vibrate(kind === 'err' ? [50,30,50] : 35); } catch {}
  }

  function stateSizeBytes(obj=state) {
    try {
      const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
      if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).byteLength;
      return new Blob([text]).size;
    } catch { return 0; }
  }
  function cloneState(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
  }
  function rememberPersistedState() {
    lastPersistedState = cloneState(state);
  }
  function restoreLastPersistedState() {
    if (lastPersistedState) state = cloneState(lastPersistedState) || state;
  }
  function cacheMetaKey(context = activeTenantContext) {
    return context?.authUid && context?.tenantKey ? `${CACHE_META_PREFIX}${context.authUid}:${context.tenantKey}` : '';
  }
  function writeCacheMeta(source, bytes, extra = {}) {
    const key = cacheMetaKey();
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify({ source, bytes: Number(bytes || 0), updatedAtMs: Number(state.updatedAtMs || Date.now()), tenantKey: activeTenantContext.tenantKey, ...extra }));
    } catch {}
  }
  function contextScope(context = activeTenantContext) {
    return context?.authUid && context?.tenantKey ? `${context.authUid}:${context.tenantKey}` : '';
  }
  function commitCheckpointKey(detail = {}) {
    const scope = detail.authUid && detail.tenantKey ? `${detail.authUid}:${detail.tenantKey}` : '';
    return scope && detail.operationId ? `${scope}:${detail.operationId}` : '';
  }
  function dispatchLocalStateSaved(detail = {}) {
    if (!activeTenantContext) return;
    window.dispatchEvent(new CustomEvent('click360-local-state-saved', {
      detail: {
        authUid: activeTenantContext.authUid,
        tenantKey: activeTenantContext.tenantKey,
        updatedAtMs: Number(state.updatedAtMs || 0),
        storageMode: storageState.mode,
        ...detail
      }
    }));
  }
  function acquireCriticalAction(reason) {
    const scope = contextScope();
    const key = scope && reason ? `${scope}:${reason}` : '';
    if (!key || !criticalActionGate) return { acquired: false, snapshot: null, release() {} };
    const entry = criticalActionGate.begin(key, cloneState(state));
    return {
      acquired: entry.acquired,
      snapshot: cloneState(entry.snapshot),
      release() { if (entry.acquired) criticalActionGate.end(key, entry.token); }
    };
  }
  function queueIndexedSnapshot(snapshot, metadata = {}) {
    if (!activeTenantContext || !window.CLICK360_V16_STORAGE) return Promise.resolve(false);
    const context = activeTenantContext;
    return window.CLICK360_V16_STORAGE.putSnapshot(context, cloneState(snapshot), metadata).then(() => {
      if (activeTenantContext !== context) return false;
      indexedTenantCacheMeta = {
        pendingRemoteSync: metadata.pendingRemoteSync === true,
        baseRevision: Number(metadata.baseRevision || 0),
        operationId: String(metadata.operationId || ''),
        payloadHash: String(metadata.payloadHash || ''),
        updatedAtMs: Number(snapshot?.updatedAtMs || 0),
        source: String(metadata.source || 'local_snapshot')
      };
      publishStorageState({ mode: 'indexeddb_cache', indexedDbReady: true, message: 'Copia sin conexion disponible en este dispositivo.' });
      writeCacheMeta('indexeddb', stateSizeBytes(snapshot), indexedTenantCacheMeta);
      return true;
    }).catch((error) => {
      if (activeTenantContext === context) {
        const localFallbackReady = typeof metadata.localPersisted === 'boolean'
          ? metadata.localPersisted
          : localStorageReady(context);
        if (localFallbackReady) {
          publishStorageState({
            mode: 'localstorage_cache',
            indexedDbReady: false,
            localReady: true,
            message: 'Copia sin conexión disponible en este dispositivo.'
          });
        } else {
          publishStorageState({
            mode: navigator.onLine ? 'online_only_safe' : 'unavailable',
            indexedDbReady: false,
            localReady: false,
            message: 'Tus datos estan seguros en la nube. Este dispositivo no pudo activar el modo sin conexion.'
          });
        }
      }
      console.warn('No se pudo guardar snapshot IndexedDB:', error.message);
      return false;
    });
  }
  function save(options = {}) {
    if (!activeTenantContext || !stateStorageKey()) {
      console.warn('CLICK360: intento de guardar sin tenant activo bloqueado.');
      return false;
    }
    const gate = writeGateStatus();
	    if (!gate.allowed) {
	      lastWriteBlock = { ...gate, at: new Date().toISOString() };
	      window.click360LastWriteBlock = lastWriteBlock;
	      restoreLastPersistedState();
	      if (gate.reason === 'sync_conflict') showSyncConflictRecovery(gate);
	      toast(writeBlockMessage(gate), gate.reason === 'pending_remote_sync' ? 'ok' : 'err');
	      return false;
	    }
    lastWriteBlock = null;
    window.click360LastWriteBlock = null;
    const previousState = cloneState(lastPersistedState);
    lastSavePersistence = null;
    try {
      if (!isOwnerUser()) {
        const error = new Error('El acceso operativo para trabajadores está temporalmente pausado.');
        error.code = 'click360/permission-denied';
        throw error;
      }
      state.updatedAtMs = Date.now();
      state.updatedAt = new Date().toISOString();
      state.identity = tenantIdentity();
      const serialized = JSON.stringify(state);
      if (stateSizeBytes(serialized) > MAX_LOCAL_TENANT_STATE_BYTES) {
        const error = new Error('El estado supera el espacio local seguro.');
        error.code = 'click360/local-state-too-large';
        throw error;
      }
      let localPersisted = false;
      let storageError = null;
      try {
        localStorage.setItem(stateStorageKey(), serialized);
        localPersisted = true;
        writeCacheMeta('localstorage', stateSizeBytes(serialized));
      } catch (error) {
        storageError = error;
        if (!navigator.onLine && (!options.allowIndexedDbOffline || !storageState.indexedDbReady)) throw error;
        publishStorageState(storageState.indexedDbReady
          ? { mode: 'indexeddb_cache', localReady: false, message: 'La copia sin conexión se guardará en el almacenamiento seguro del dispositivo.' }
          : { mode: navigator.onLine ? 'online_only_safe' : 'unavailable', localReady: false, message: 'Tus datos estan seguros en la nube. Este dispositivo no pudo activar el modo sin conexion.' });
      }
      const context = activeTenantContext;
      const snapshot = cloneState(state);
      const operationId = String(options.operationId || uid('persist'));
      const baseRevision = Number(window.click360DebugSyncIdentity?.().revision || 0);
      const pendingRemoteSync = options.nonBlockingSync === true ? false : true;
      const syncSource = String(options.syncSource || (pendingRemoteSync
        ? (navigator.onLine ? 'local_change' : 'offline_pending')
        : 'non_blocking_local_change'));
      const indexedPromise = queueIndexedSnapshot(snapshot, {
        source: syncSource,
        pendingRemoteSync,
        baseRevision,
        operationId,
        localPersisted
      });
      lastSavePersistence = {
        context,
        operationId,
        updatedAtMs: Number(state.updatedAtMs || 0),
        previousState,
        snapshot,
        localPersisted,
        indexedPromise,
        storageError
      };
      if (localPersisted) {
        writeCacheMeta('localstorage', stateSizeBytes(serialized), {
          pendingRemoteSync,
          baseRevision,
          operationId,
          updatedAtMs: Number(state.updatedAtMs || 0),
          pendingCreatedAtMs: pendingRemoteSync ? Date.now() : 0,
          nonBlockingSync: options.nonBlockingSync === true
        });
        rememberPersistedState();
      }
      if (options.deferSync !== true && localPersisted) {
        dispatchLocalStateSaved({ operationId, localPersisted, indexedPersisted: false, pendingRemoteSync, syncSource });
      } else if (options.deferSync !== true && navigator.onLine) {
        indexedPromise.then((indexedPersisted) => {
          if (activeTenantContext !== context) return;
          if (!indexedPersisted) {
            const checkpoint = {
              authUid: context.authUid,
              tenantKey: context.tenantKey,
              operationId,
              context,
              previousState,
              nextState: snapshot,
              updatedAtMs: Number(snapshot.updatedAtMs || 0)
            };
            onlineOnlyCommitCheckpoints.set(commitCheckpointKey(checkpoint), checkpoint);
          }
          dispatchLocalStateSaved({ operationId, localPersisted: false, indexedPersisted, pendingRemoteSync, syncSource });
        });
      }
      if (!localPersisted) toast('Guardando el cambio de forma segura...', 'ok');
      return true;
    } catch(e) {
      console.error(e);
      state = previousState || state;
      window.CLICK360_RUNTIME_GUARD?.record?.({
        message: e.message || 'Error al guardar estado local.',
        filename: 'app.js',
        stack: e.stack || ''
      });
      if (e.code === 'click360/permission-denied') {
        toast(e.message, 'err');
        return false;
      }
      if (e.code === 'click360/local-state-too-large') {
        toast('El último cambio supera el espacio seguro y no se guardó. No se eliminaron datos existentes.', 'err');
        return false;
      }
      if(e.name === 'QuotaExceededError' || e.message.includes('quota')) {
        toast('Almacenamiento lleno. El último cambio no se guardó y los datos anteriores siguen intactos.', 'err');
      } else {
        toast('Error al guardar. Los datos anteriores siguen intactos.', 'err');
      }
      return false;
    }
  }
  function restoreCriticalSnapshot(snapshot, metadata = {}) {
    if (!snapshot || !activeTenantContext) return false;
    const restored = normalizeState(cloneState(snapshot));
    restored.identity = tenantIdentity();
    state = restored;
    lastAutoSaveHash = JSON.stringify(state);
    try {
      localStorage.setItem(stateStorageKey(), lastAutoSaveHash);
      writeCacheMeta('localstorage', stateSizeBytes(lastAutoSaveHash));
    } catch {}
    rememberPersistedState();
    queueIndexedSnapshot(state, {
      source: metadata.source || 'critical_rollback',
      pendingRemoteSync: metadata.pendingRemoteSync === true,
      baseRevision: Number(window.click360DebugSyncIdentity?.().revision || 0),
      operationId: String(metadata.operationId || '')
    });
    return true;
  }
  async function commitCriticalMutation(previousState, reason, remoteApplied) {
    const context = activeTenantContext;
    const actionLock = acquireCriticalAction(reason);
    if (!actionLock.acquired) {
      restoreCriticalSnapshot(actionLock.snapshot || previousState, {
        source: 'duplicate_operation_restore',
        pendingRemoteSync: true
      });
      toast('La operación ya se está procesando. Espera su confirmación.', 'err');
      return { ok: false, pending: false, duplicate: true };
    }
    const operationId = uid('persist');
    try {
      if (!save({ allowIndexedDbOffline: true, operationId, deferSync: true })) {
        return { ok: false, pending: false, reason: lastWriteBlock?.reason || 'save_rejected' };
      }
      const persistence = lastSavePersistence?.operationId === operationId ? lastSavePersistence : null;
      if (!navigator.onLine && !persistence?.localPersisted) {
        const indexedPersisted = await persistence?.indexedPromise;
        if (activeTenantContext !== context) return { ok: false, pending: false, stale: true };
        if (!indexedPersisted) {
          restoreCriticalSnapshot(previousState);
          toast('No se pudo guardar el cambio sin conexión. La información anterior sigue intacta.', 'err');
          return { ok: false, pending: false };
        }
        rememberPersistedState();
        lastAutoSaveHash = JSON.stringify(state);
        dispatchLocalStateSaved({ operationId, localPersisted: false, indexedPersisted: true });
      }
    if (!navigator.onLine) {
      toast('Cambio guardado en este dispositivo. Se confirmará al recuperar internet.', 'ok');
      return { ok: true, pending: true };
    }
    if (typeof window.click360SyncNow !== 'function') {
      restoreCriticalSnapshot(previousState);
      toast('No se pudo confirmar el cambio en la nube. Inténtalo nuevamente.', 'err');
      return { ok: false, pending: false };
    }
    const synced = await window.click360SyncNow();
    if (activeTenantContext !== context) return { ok: false, pending: false, stale: true };
    if (synced) return { ok: true, pending: false };

    let refreshed = false;
    try { refreshed = await window.click360RefreshNow?.() === true; } catch {}
    if (activeTenantContext !== context) return { ok: false, pending: false, stale: true };
    if (typeof remoteApplied === 'function' && remoteApplied(state)) {
      return { ok: true, pending: false, recovered: true };
    }
    if (!refreshed) restoreCriticalSnapshot(previousState);
    toast('El cambio no fue confirmado y no se registró como completado.', 'err');
    return { ok: false, pending: false };
    } finally {
      actionLock.release();
    }
  }
  function stateStorageKey() {
    return activeTenantContext?.authUid && activeTenantContext?.tenantKey ? `${STATE_PREFIX}${activeTenantContext.authUid}:${activeTenantContext.tenantKey}` : '';
  }
  function legacyStateStorageKey(context = activeTenantContext) {
    return context?.tenantKey ? `${LEGACY_STATE_PREFIX}${context.tenantKey}` : '';
  }
  function sessionStorageKey() {
    return activeTenantContext?.authUid ? `${SESSION_PREFIX}${activeTenantContext.authUid}` : '';
  }
  function legacySessionStorageKey(context = activeTenantContext) {
    return context?.authUid ? `${LEGACY_SESSION_PREFIX}${context.authUid}` : '';
  }
  function tenantIdentity() {
    if (!activeTenantContext) return null;
    return {
      ownerUid: activeTenantContext.ownerUid || activeTenantContext.authUid,
      ownerId: activeTenantContext.ownerId,
      businessId: activeTenantContext.businessId,
      tenantKey: activeTenantContext.tenantKey,
      schemaVersion: 10
    };
  }
  function sameTenantIdentity(identity, context=activeTenantContext) {
    return tenantRuntime?.sameTenantIdentity(identity, context) === true;
  }
  function markTenantCacheCorrupt(reason) {
    if (!activeTenantContext?.tenantKey) return;
    try { localStorage.setItem(`CLICK360_TENANT:${activeTenantContext.tenantKey}:CORRUPT`, reason); } catch {}
  }
  function loadState() {
    const key = stateStorageKey();
    if (!key) return seed();
    try {
      const raw = localStorage.getItem(key) || localStorage.getItem(legacyStateStorageKey());
      if (raw) {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || !sameTenantIdentity(parsed.identity)) {
          markTenantCacheCorrupt('missing_or_mismatched_identity');
          return seed();
        }
        if (!tenantRuntime?.validBusinessPayload({ identity: parsed.identity, data: parsed }, activeTenantContext)) {
          markTenantCacheCorrupt('invalid_local_payload_shape');
          return seed();
        }
        const loaded = normalizeState(parsed);
        loaded.identity = tenantIdentity();
        try {
          localStorage.setItem(key, JSON.stringify(loaded));
          localStorage.removeItem(legacyStateStorageKey());
        } catch {}
        return loaded;
      }
    } catch { markTenantCacheCorrupt('json_parse_failed'); }
    const fresh = seed();
    fresh.identity = tenantIdentity();
    return fresh;
  }
  function loadSession() {
    const key = sessionStorageKey();
    try {
      const parsed = key ? JSON.parse(localStorage.getItem(key) || localStorage.getItem(legacySessionStorageKey()) || 'null') : null;
      return parsed?.uid === activeTenantContext?.authUid ? parsed : null;
    } catch { return null; }
  }
  function setSession(s) {
    session = s ? {
      uid: activeTenantContext?.authUid || '',
      username: String(s.username || '').slice(0, 120),
      updatedAt: new Date().toISOString()
    } : null;
    const key = sessionStorageKey();
    if (!key) return;
    try {
      if(session) localStorage.setItem(key, JSON.stringify(session));
      else localStorage.removeItem(key);
      localStorage.removeItem(legacySessionStorageKey());
    } catch (error) {
      console.warn('No se pudo guardar la sesión de interfaz:', error.message);
    }
  }
  function profileCacheKey(uid) { return uid ? `${PROFILE_CACHE_PREFIX}${uid}` : ''; }
  function cachedUserProfile(uid) {
    if (!uid) return null;
    const stateProfile = state.settings?.userProfiles?.[uid];
    if (stateProfile?.uid === uid) return { ...stateProfile };
    try {
      const key = profileCacheKey(uid);
      const legacyKey = `${LEGACY_PROFILE_CACHE_PREFIX}${uid}`;
      const parsed = JSON.parse(localStorage.getItem(key) || localStorage.getItem(legacyKey) || 'null');
      if (parsed?.uid !== uid) return null;
      localStorage.setItem(key, JSON.stringify(parsed));
      localStorage.removeItem(legacyKey);
      return parsed;
    } catch { return null; }
  }
  function cacheUserProfile(profile) {
    const uid = profile?.uid || window.click360User?.uid || '';
    if (!uid) return;
    const safeProfile = {
      uid,
      name: profile.name || '',
      photoURL: profile.photoURL || '',
      email: profile.email || window.click360User?.email || '',
      updatedAt: new Date().toISOString(),
      pendingSync: profile.pendingSync === true
    };
    state.settings ||= {};
    state.settings.userProfiles ||= {};
    state.settings.userProfiles[uid] = safeProfile;
    return safeProfile;
  }
  function persistUserProfileCache(profile) {
    if (!profile?.uid) return;
    try { localStorage.setItem(profileCacheKey(profile.uid), JSON.stringify(profile)); } catch {}
  }
  function pendingProfileKey(uid) { return uid ? `${PROFILE_PENDING_PREFIX}${uid}` : ''; }
  function queuePendingProfile(profile) {
    const key = pendingProfileKey(profile?.uid);
    if (!key) return false;
    try { localStorage.setItem(key, JSON.stringify(profile)); return true; } catch { return false; }
  }
  async function flushPendingProfile() {
    const uid = window.click360Auth?.currentUser?.uid || '';
    const key = pendingProfileKey(uid);
    if (!uid || !key || !navigator.onLine || !window.click360Db || uid !== activeTenantContext?.authUid) return false;
    try {
      const legacyKey = `${LEGACY_PROFILE_PENDING_PREFIX}${uid}`;
      const pendingRaw = localStorage.getItem(key) || localStorage.getItem(legacyKey) || '';
      const cachedProfile = cachedUserProfile(uid);
      const profile = pendingRaw ? JSON.parse(pendingRaw) : (cachedProfile?.pendingSync === true ? cachedProfile : null);
      if (!profile || profile.uid !== uid) return false;
      if (window.click360User?.access?.source === 'accountAccess' && typeof window.click360UpdateAccessProfile === 'function') {
        await window.click360UpdateAccessProfile(profile);
      } else {
        await window.click360Db.collection('approvedUsers').doc(uid).update({
          name: String(profile.name || ''),
          photoURL: safeImageSrc(profile.photoURL),
          updatedAt: new Date().toISOString()
        });
      }
      localStorage.removeItem(key);
      localStorage.removeItem(legacyKey);
      const syncedProfile = cacheUserProfile({ ...profile, pendingSync: false });
      persistUserProfileCache(syncedProfile);
      save();
      return true;
    } catch (error) {
      console.warn('Perfil local pendiente de nube:', error.message);
      return false;
    }
  }
  window.click360FlushPendingProfile = flushPendingProfile;
  window.click360AppLogout = async function() {
    setSession(null);
    if(window.click360Logout) await window.click360Logout();
    else renderLogin('', { ready:true });
  };
  window.click360SetTenantContext = function(context, options = {}) {
    if (!context?.authUid || !context?.ownerId || !context?.businessId || !context?.tenantKey) {
      throw new Error('Contexto de cuenta incompleto. No se cargaron datos.');
    }
    activeTenantContext = Object.freeze({ ...context, schemaVersion: 10 });
    indexedTenantCacheMeta = null;
    lastSavePersistence = null;
    onlineOnlyCommitCheckpoints.clear();
    criticalActionGate?.clear();
    window.CLICK360_RUNTIME_GUARD?.setContext(activeTenantContext);
    onboardingPrompted = false;
    window.click360TenantContext = activeTenantContext;
    tenantStateDeferred = options.deferLocalLoad === true;
    if (tenantStateDeferred) {
      state = seed();
      state.identity = tenantIdentity();
      lastPersistedState = null;
      lastAutoSaveHash = '';
    } else {
      state = loadState();
      rememberPersistedState();
      lastAutoSaveHash = JSON.stringify(state);
    }
    session = loadSession();
    publishStorageState({ mode: 'checking', tenantKey: activeTenantContext.tenantKey, message: 'Comprobando almacenamiento seguro.' });
    return { ...activeTenantContext };
  };
	  window.click360PrepareTenantStorage = async function(context = activeTenantContext) {
    if (!context || context.tenantKey !== activeTenantContext?.tenantKey || !window.CLICK360_V16_STORAGE) {
      publishStorageState({ mode: navigator.onLine ? 'online_only_safe' : 'unavailable', indexedDbReady: false, message: 'Almacenamiento sin conexion no disponible.' });
      return false;
	    }
	    const localReady = localStorageReady(context);
	    try {
	      await window.CLICK360_V16_STORAGE.probe();
	      publishStorageState(localReady
	        ? { mode: 'indexeddb_ready', indexedDbReady: true, localReady: true, message: 'Almacenamiento seguro listo.' }
	        : { mode: 'indexeddb_ready', indexedDbReady: true, localReady: false, message: 'La copia sin conexión usará el almacenamiento seguro del dispositivo.' });
	      return true;
    } catch (error) {
      if (localReady) {
        publishStorageState({ mode: 'localstorage_cache', indexedDbReady: false, localReady: true, message: 'Copia sin conexión disponible en este dispositivo.' });
        return true;
      }
      publishStorageState({ mode: navigator.onLine ? 'online_only_safe' : 'unavailable', indexedDbReady: false, localReady: false, message: 'Tus datos estan seguros en la nube. Este dispositivo no pudo activar el modo sin conexion.' });
	      return false;
	    }
	  };
  window.click360PrepareInitialTenantState = async function(context = activeTenantContext) {
    if (!context || !activeTenantContext || !stateStorageKey()
      || context.authUid !== activeTenantContext.authUid
      || context.tenantKey !== activeTenantContext.tenantKey) {
      return { prepared: false, localPersisted: false, indexedPersisted: false, reason: 'tenant_context_mismatch' };
    }

    const snapshot = cloneState(state);
    if (!snapshot) return { prepared: false, localPersisted: false, indexedPersisted: false, reason: 'snapshot_clone_failed' };
    snapshot.identity = tenantIdentity();
    if (!sameTenantIdentity(snapshot.identity, context)
      || tenantRuntime?.validBusinessPayload({ identity: snapshot.identity, data: snapshot }, context) !== true) {
      return { prepared: false, localPersisted: false, indexedPersisted: false, reason: 'snapshot_identity_invalid' };
    }

    const serialized = JSON.stringify(snapshot);
    if (stateSizeBytes(serialized) > MAX_LOCAL_TENANT_STATE_BYTES) {
      return { prepared: false, localPersisted: false, indexedPersisted: false, reason: 'snapshot_too_large' };
    }

    let localPersisted = false;
    try {
      localStorage.setItem(stateStorageKey(), serialized);
      localPersisted = true;
      writeCacheMeta('initial_tenant_snapshot', stateSizeBytes(serialized), {
        pendingRemoteSync: true,
        baseRevision: 0,
        operationId: 'initial_tenant_seed'
      });
    } catch {}

    const indexedPersisted = await queueIndexedSnapshot(snapshot, {
      source: 'initial_tenant_snapshot',
      pendingRemoteSync: true,
      baseRevision: 0,
      operationId: 'initial_tenant_seed',
      localPersisted
    });
    if (!activeTenantContext
      || activeTenantContext.authUid !== context.authUid
      || activeTenantContext.tenantKey !== context.tenantKey) {
      return { prepared: false, localPersisted: false, indexedPersisted: false, reason: 'tenant_context_changed' };
    }

    state = snapshot;
    tenantStateDeferred = false;
    if (localPersisted || indexedPersisted) rememberPersistedState();
    lastAutoSaveHash = JSON.stringify(state);
    return {
      prepared: true,
      localPersisted,
      indexedPersisted,
      storageMode: storageState.mode,
      reason: localPersisted || indexedPersisted ? 'device_snapshot_ready' : 'online_snapshot_ready'
    };
  };
  window.click360ClearTenantContext = function() {
    stopScanner();
    activeTenantContext = null;
    window.CLICK360_RUNTIME_GUARD?.clearContext();
    onboardingPrompted = false;
    window.click360TenantContext = null;
    state = seed();
    lastPersistedState = null;
    indexedTenantCacheMeta = null;
    lastSavePersistence = null;
    onlineOnlyCommitCheckpoints.clear();
    criticalActionGate?.clear();
    lastAutoSaveHash = '';
    session = null;
    route = 'home';
    workingDate = null;
    tenantStateDeferred = false;
    publishStorageState({ mode: 'checking', indexedDbReady: false, tenantKey: null, message: '' });
    if (app) app.innerHTML = '';
  };
  window.click360IsTenantStateDeferred = () => tenantStateDeferred;
  window.click360LoadDeferredTenantCache = function() {
    if (!activeTenantContext) return false;
    state = loadState();
    tenantStateDeferred = false;
    rememberPersistedState();
    lastAutoSaveHash = JSON.stringify(state);
    return true;
  };
  window.click360LoadIndexedTenantCache = async function(context = activeTenantContext) {
    if (!context || context.tenantKey !== activeTenantContext?.tenantKey || !window.CLICK360_V16_STORAGE) return false;
    try {
      const record = await window.CLICK360_V16_STORAGE.getSnapshot(context);
      const candidate = record?.snapshot;
      if (!candidate || !sameTenantIdentity(candidate.identity, context)
        || !tenantRuntime?.validBusinessPayload({ identity: candidate.identity, data: candidate }, context)) return false;
      state = normalizeState(candidate);
      state.identity = tenantIdentity();
      indexedTenantCacheMeta = {
        pendingRemoteSync: record.pendingRemoteSync === true,
        baseRevision: Number(record.baseRevision || record.revision || 0),
        operationId: String(record.operationId || ''),
        payloadHash: String(record.payloadHash || ''),
        materialHash: String(record.materialHash || ''),
        updatedAtMs: Number(record.updatedAtMs || candidate.updatedAtMs || 0),
        pendingCreatedAtMs: Number(record.pendingCreatedAtMs || record.savedAtMs || 0),
        savedAtMs: Number(record.savedAtMs || 0),
        source: String(record.source || 'indexeddb_cache')
      };
      tenantStateDeferred = false;
      rememberPersistedState();
      lastAutoSaveHash = JSON.stringify(state);
      publishStorageState({ mode: 'indexeddb_cache', indexedDbReady: true, message: 'Copia sin conexion cargada.' });
      return true;
    } catch (error) {
      console.warn('No se pudo cargar snapshot IndexedDB:', error.message);
      return false;
    }
  };
  window.click360RetryTenantStorage = async function() {
    if (!activeTenantContext) return false;
    const prepared = await window.click360PrepareTenantStorage(activeTenantContext);
    if (!prepared) return false;
    const saved = await queueIndexedSnapshot(state);
    if (saved) toast('Modo sin conexion activado para este dispositivo.');
    return saved;
  };
  window.click360GetTenantState = function() {
    if (!activeTenantContext) return null;
    return JSON.parse(JSON.stringify(state));
  };
  window.click360PersistTenantState = function() {
    return save();
  };
  window.click360GetIndexedTenantCacheMeta = function() {
    return indexedTenantCacheMeta ? { ...indexedTenantCacheMeta } : null;
  };
  window.click360MarkTenantCacheSynced = function(metadata = {}) {
    if (!activeTenantContext) return Promise.resolve(false);
    indexedTenantCacheMeta = {
      pendingRemoteSync: false,
      baseRevision: Number(metadata.revision || 0),
      revision: Number(metadata.revision || 0),
      operationId: String(metadata.operationId || ''),
      payloadHash: String(metadata.payloadHash || ''),
      materialHash: String(metadata.materialHash || ''),
      updatedAtMs: Number(state.updatedAtMs || 0),
      pendingCreatedAtMs: 0,
      savedAtMs: Date.now(),
      source: 'cloud_confirmed'
    };
    writeCacheMeta('cloud_confirmed', stateSizeBytes(state), {
      pendingRemoteSync: false,
      baseRevision: Number(metadata.revision || 0),
      revision: Number(metadata.revision || 0),
      operationId: String(metadata.operationId || ''),
      payloadHash: String(metadata.payloadHash || ''),
      materialHash: String(metadata.materialHash || ''),
      pendingCreatedAtMs: 0
    });
    return queueIndexedSnapshot(state, {
      source: 'cloud_confirmed',
      pendingRemoteSync: false,
      baseRevision: Number(metadata.revision || 0),
      revision: Number(metadata.revision || 0),
      operationId: String(metadata.operationId || ''),
      payloadHash: String(metadata.payloadHash || ''),
      materialHash: String(metadata.materialHash || '')
    });
  };
  window.click360GetTenantCacheStatus = function(context) {
    if (!context?.tenantKey || !context?.ownerId || !context?.businessId || !context?.authUid) {
      return { valid: false, reason: 'context_incomplete' };
    }
    const key = `${STATE_PREFIX}${context.authUid}:${context.tenantKey}`;
    const corruptKey = `CLICK360_TENANT:${context.tenantKey}:CORRUPT`;
    if (storageState.localReady === false && storageState.indexedDbReady
      && storageState.mode === 'indexeddb_cache' && storageState.tenantKey === context.tenantKey
      && indexedTenantCacheMeta) {
      return { valid: true, source: 'indexeddb_memory', key, updatedAtMs: Number(state.updatedAtMs || 0), ...indexedTenantCacheMeta };
    }
    let cacheMetadata = {};
    let raw = '';
    try {
      const parsedMeta = JSON.parse(localStorage.getItem(cacheMetaKey(context)) || 'null');
      if (parsedMeta?.tenantKey === context.tenantKey) cacheMetadata = parsedMeta;
      if (localStorage.getItem(corruptKey)) return { valid: false, reason: 'cache_marked_corrupt', key };
      raw = localStorage.getItem(key) || localStorage.getItem(`${LEGACY_STATE_PREFIX}${context.tenantKey}`) || '';
    } catch (error) {
      if (storageState.indexedDbReady && storageState.mode === 'indexeddb_cache' && storageState.tenantKey === context.tenantKey) {
        return { valid: true, source: 'indexeddb_memory', key, updatedAtMs: Number(state.updatedAtMs || 0), ...indexedTenantCacheMeta };
      }
      return { valid: false, reason: 'localstorage_unavailable', key };
    }
    if (!raw) {
      if (storageState.indexedDbReady && storageState.mode === 'indexeddb_cache' && storageState.tenantKey === context.tenantKey) {
        return { valid: true, source: 'indexeddb_memory', key, updatedAtMs: Number(state.updatedAtMs || 0), ...indexedTenantCacheMeta };
      }
      return { valid: false, reason: 'cache_missing', key };
    }
    try {
      const parsed = JSON.parse(raw);
      if (!sameTenantIdentity(parsed.identity, context) || parsed.identity?.tenantKey !== context.tenantKey) {
        return { valid: false, reason: 'tenant_mismatch', key };
      }
      if (!tenantRuntime?.validBusinessPayload({ identity: parsed.identity, data: parsed }, context)) {
        return { valid: false, reason: 'cache_payload_invalid', key };
      }
      return { valid: true, source: 'localstorage', key, updatedAtMs: Number(parsed.updatedAtMs || 0), ...cacheMetadata };
    } catch {
      return { valid: false, reason: 'cache_corrupt', key };
    }
  };
  window.click360ApplyTenantState = function(nextState, context) {
    const candidatePayload = { identity: nextState?.identity || context, data: nextState || {} };
    if (!activeTenantContext || !context || context.tenantKey !== activeTenantContext.tenantKey
      || !tenantRuntime?.validBusinessPayload(candidatePayload, activeTenantContext)) {
      markTenantCacheCorrupt('remote_payload_invalid');
      throw new Error('Snapshot de otro tenant bloqueado.');
    }
    const next = normalizeState(nextState || {});
    next.identity = tenantIdentity();
    let localPersisted = false;
    try {
      localStorage.setItem(stateStorageKey(), JSON.stringify(next));
      localPersisted = true;
      writeCacheMeta('localstorage', stateSizeBytes(next));
    } catch (error) {
      publishStorageState({ mode: navigator.onLine ? 'online_only_safe' : 'unavailable', localReady: false, message: 'Tus datos estan seguros en la nube. Este dispositivo no pudo activar el modo sin conexion.' });
    }
    state = next;
    tenantStateDeferred = false;
    rememberPersistedState();
    lastAutoSaveHash = JSON.stringify(state);
    queueIndexedSnapshot(state, { source: 'remote_applied', pendingRemoteSync: false, localPersisted });
    try { localStorage.removeItem(`CLICK360_TENANT:${activeTenantContext.tenantKey}:CORRUPT`); } catch {}
    return { applied: true, localPersisted, storageMode: storageState.mode };
  };
  function normalizeState(s) {
    const d = seed();
    const out = Object.assign(d, s || {});
    if (!out.businesses || out.businesses.length === 0) out.businesses = d.businesses;
    out.products ||= []; out.sales ||= []; out.movements ||= []; out.dailyReports ||= [];
    out.invoices ||= [];
    out.auditLogs ||= [];
    out.deletedProducts ||= [];
    out.layaways ||= [];
    out.cashSessions ||= [];
    out.tables ||= [];
    out.tableOrders ||= [];
    out.restaurantPayments ||= [];
    out.restaurantPrintHistory ||= [];
    out.restaurantEvents ||= [];
    out.restaurantRecipes ||= [];
    out.logistics ||= {};
    out.logistics.vehicles ||= [];
    out.logistics.routes ||= [];
    out.logistics.loadSheets ||= [];
    out.logistics.routeSales ||= [];
    out.logistics.collections ||= [];
    out.logistics.returns ||= [];
    out.logistics.routeSettlements ||= [];
    out.logistics.routeExpenses ||= [];
    out.logistics.routeCustomers ||= [];
    out.logistics.events ||= [];
    out.logistics.printHistory ||= [];
    out.labelPrintHistory ||= [];
    out.notifications ||= [];
    out.legalAcceptances ||= [];
    out.finance ||= {};
    out.finance.payments ||= [];
    out.finance.loans ||= [];
    out.finance.envelopes ||= [];
    out.finance.goals ||= [];
    out.settings ||= {};
    out.settings.labelTemplates ||= [];
    out.settings.labelProfiles ||= [];
    out.settings.workers ||= [];
    out.settings.userProfiles ||= {};
    out.settings.customers ||= [];
    out.settings.reminders ||= [];
    out.settings.onboarding ||= {};
    out.settings.activationRequests ||= [];
    out.settings.policies ||= {};
    out.settings.legal ||= {};
    const businessIds = new Set(out.businesses.map((business) => business?.id).filter(Boolean));
    if (!businessIds.has(out.settings.legacyDataBusinessId)) {
      out.settings.legacyDataBusinessId = businessIds.has(out.activeBusinessId)
        ? out.activeBusinessId : (out.businesses[0]?.id || '');
    }

    out.products.forEach(p => {
      p.code = String(p.code || '').trim().toUpperCase();
      p.updatedAtMs = Number(p.updatedAtMs || p.createdAtMs || 0);
    });
    out.deletedProducts.forEach(t => {
      t.code = String(t.code || '').trim().toUpperCase();
      t.deletedAtMs = Number(t.deletedAtMs || t.updatedAtMs || Date.now());
    });
    const deletedById = new Map();
    const deletedByCode = new Map();
    out.deletedProducts.forEach(t => {
      const businessId = t.businessId || '';
      if (t.id) {
        const key = `${businessId}:${t.id}`;
        deletedById.set(key, Math.max(deletedById.get(key) || 0, t.deletedAtMs || 0));
      }
      if (t.code) {
        const key = `${businessId}:${t.code}`;
        deletedByCode.set(key, Math.max(deletedByCode.get(key) || 0, t.deletedAtMs || 0));
      }
    });
    out.products = out.products.filter(p => {
      const pMs = Number(p.updatedAtMs || p.createdAtMs || 0);
      const businessId = p.businessId || '';
      const tombstoneMs = Math.max(deletedById.get(`${businessId}:${p.id}`) || 0, deletedByCode.get(`${businessId}:${p.code}`) || 0);
      return !tombstoneMs || pMs > tombstoneMs;
    });

    const normalizedPhone = (value) => window.CLICK360_V16_DOMAIN?.normalizePhone?.(value || '') || String(value || '').replace(/\D/g, '');
    out.settings.customers.forEach((customer) => {
      if (customer.businessId || !customer.id) return;
      const phone = normalizedPhone(customer.phone);
      const name = String(customer.name || '').trim().toLowerCase();
      const candidates = new Set(out.sales.filter((sale) => {
        const samePhone = phone && normalizedPhone(sale.customerPhone) === phone;
        const sameName = name && String(sale.customer || '').trim().toLowerCase() === name;
        return sale.businessId && (samePhone || sameName);
      }).map((sale) => sale.businessId));
      if (candidates.size === 1) customer.businessId = [...candidates][0];
    });
    const customersById = new Map(out.settings.customers.map((customer) => [customer.id, customer]));
    out.settings.reminders.forEach((reminder) => {
      if (reminder.businessId) return;
      const customerBusinessId = customersById.get(reminder.customerId)?.businessId;
      if (customerBusinessId) reminder.businessId = customerBusinessId;
    });
    if (out.businesses.length === 1) {
      const onlyBusinessId = out.businesses[0]?.id || '';
      out.settings.customers.forEach((customer) => { if (!customer.businessId) customer.businessId = onlyBusinessId; });
      out.settings.reminders.forEach((reminder) => { if (!reminder.businessId) reminder.businessId = onlyBusinessId; });
      out.settings.labelTemplates.forEach((template) => { if (!template.businessId) template.businessId = onlyBusinessId; });
      out.settings.labelProfiles.forEach((profile) => { if (!profile.businessId) profile.businessId = onlyBusinessId; });
    }

    // Migración para limpiar "sale_..." de movimientos antiguos
    out.movements.forEach(m => {
       if (m.note && m.note.includes('Venta anulada sale_')) {
          m.note = 'Venta anulada (Registro histórico)';
       }
    });

    return out;
  }
  function seed() {
    const b1 = { id:'biz_main', code:'EMPRESA-001', name:'Mi Negocio', type:'ropa', status:'activo', due:'2026-07-08' };
    return {
      version:'CLICK360_V16',
      updatedAtMs: Date.now(),
      updatedAt: new Date().toISOString(),
      activeBusinessId:b1.id,
      businesses:[b1],
      products:[],
      sales:[],
      movements:[],
      invoices:[],
      dailyReports:[],
      auditLogs:[],
      deletedProducts:[],
      layaways:[],
      cashSessions:[],
      tables:[],
      tableOrders:[],
      restaurantPayments:[],
      restaurantPrintHistory:[],
      restaurantEvents:[],
      restaurantRecipes:[],
      logistics:{ vehicles:[], routes:[], loadSheets:[], routeSales:[], collections:[], returns:[], routeSettlements:[], routeExpenses:[], routeCustomers:[], events:[], printHistory:[] },
      labelPrintHistory:[],
      finance:{ payments: [], loans: [], envelopes: [], goals: [] },
      notifications:[],
      legalAcceptances:[],
      settings:{ workers: [], labelTemplates: [], labelProfiles: [], userProfiles: {}, customers: [], reminders: [], onboarding: {}, activationRequests: [], policies: {}, legal: {}, appVersion: APP_RELEASE_VERSION }
    };
  }

  function addAudit(action, details={}) {
    state.auditLogs ||= [];
    state.auditLogs.push({
      id: uid('audit'),
      action,
      businessId: currentBusiness()?.id || state.activeBusinessId || 'biz_main',
      userId: window.click360User?.uid || '',
      userEmail: window.click360User?.email || '',
      createdBy: authUser().name || 'Sistema',
      createdAt: new Date().toISOString(),
      when: nowLabel(),
      details
    });
  }

  window.click360ReloadState = () => {
    state = loadState();
    rememberPersistedState();
    lastAutoSaveHash = JSON.stringify(state);
  };

  window.addEventListener('storage', (event) => {
    if (!activeTenantContext || event.key !== stateStorageKey() || !event.newValue) return;
    try {
      const parsed = JSON.parse(event.newValue);
      const payload = { identity: parsed?.identity, data: parsed || {} };
      if (!tenantRuntime?.validBusinessPayload(payload, activeTenantContext)) {
        markTenantCacheCorrupt('cross_tab_payload_invalid');
        toast('Se bloqueó un cambio inválido de otra pestaña.', 'err');
        return;
      }
      state = normalizeState(parsed);
      state.identity = tenantIdentity();
      rememberPersistedState();
      lastAutoSaveHash = JSON.stringify(state);
      const editing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
      if (!editing && !document.querySelector('#modalRoot .modalOverlay.show')) renderApp(route);
    } catch {
      markTenantCacheCorrupt('cross_tab_json_invalid');
      toast('Se bloqueó una caché dañada de otra pestaña.', 'err');
    }
  });

  function currentUser(){
    const cloudUser = window.click360User;
    if (!cloudUser || !activeTenantContext || cloudUser.uid !== activeTenantContext.authUid) return null;
    return {
      username: cloudUser.uid,
      role: cloudUser.role || 'guest',
      label: cloudUser.name || cloudUser.email || 'Usuario'
    };
  }
  function authUser() {
    if (currentUser()) return window.click360User;
    return { name: 'Sistema', role: 'guest', email: '' };
  }
  function isOwnerUser() {
    const u = authUser();
    return u?.role === 'owner' || u?.isOwner === true;
  }
  function saleItems(s) {
    return Array.isArray(s?.items) ? s.items : [];
  }
  function collectedAmount(sale) {
    if (!sale || sale.status === 'cancelled') return 0;
    const total = Math.max(0, Number(sale.total) || 0);
    const raw = Number(sale.received);
    if (sale.status === 'paid') return Math.min(total, Number.isFinite(raw) && raw > 0 ? raw : total);
    return Math.min(total, Math.max(0, Number.isFinite(raw) ? raw : 0));
  }
  function syncStatusInfo() {
    const fallback = navigator.onLine
      ? { status: 'local', title: 'Modo local', detail: 'La nube se activará al iniciar sesión con Google.' }
      : { status: 'offline', title: 'Sin internet', detail: 'Puedes trabajar localmente; se sincroniza cuando vuelva la conexión.' };
    const s = typeof window.click360GetSyncStatus === 'function' ? window.click360GetSyncStatus() : fallback;
    const map = {
	      synced: ['Nube sincronizada', 'Tus datos están guardados en este dispositivo y en la nube.'],
	      syncing: ['Sincronizando', 'Guardando cambios de forma segura.'],
      pending: ['Pendiente de sincronizar', 'Hay cambios locales esperando conexión o confirmación de nube.'],
      offline: ['Sin internet', 'La app sigue funcionando localmente y subirá cambios al reconectar.'],
      error: ['Revisar nube', s.message || 'No se pudo confirmar la sincronización. Tus datos locales se mantienen.'],
      read_only: ['Modo lectura', s.message || 'Tu información está protegida. Activa un plan para volver a editar.'],
      migration_required: ['Migración requerida', s.message || 'Los datos anteriores están protegidos hasta completar una migración segura.'],
      blocked_identity: ['Cuenta bloqueada', s.message || 'No se pudo comprobar una caché segura para esta cuenta.'],
      checking: ['Verificando nube', 'Comprobando sesión y datos remotos.'],
      local: ['Modo local', 'Inicia sesión con Google para activar nube.']
    };
    const [title, detail] = map[s.status] || map.local;
    return { ...s, title, detail };
  }
  function syncPillHtml(compact=false) {
    const info = syncStatusInfo();
    const color = info.status === 'synced' ? '#37d57e' : info.status === 'error' ? '#ff5c62' : info.status === 'offline' ? '#d6aa2c' : 'var(--gold)';
    const label = compact ? info.title.replace('Nube ', '') : info.title;
    return `<div id="${compact ? 'syncStatusPillTop' : 'syncStatusPill'}" title="${escapeHtml(info.detail)}" style="display:inline-flex;align-items:center;gap:7px;border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:6px 10px;color:${color};font-size:12px;font-weight:700;background:rgba(255,255,255,.04);white-space:nowrap;">
      <span style="width:7px;height:7px;border-radius:999px;background:${color};box-shadow:0 0 10px ${color};"></span>${escapeHtml(label)}
    </div>`;
  }
  function currentBusiness(){
    return state.businesses.find(b=>b.id===state.activeBusinessId)
      || state.businesses[0]
      || { id:'biz_main', code:'EMPRESA-001', name:'Mi Negocio', type:'ropa', status:'activo', due:'2026-07-08', settings:{} };
  }
  function businessTaxConfig(business = currentBusiness()) {
    const settings = business?.settings || {};
    return window.CLICK360_V16_DOMAIN?.normalizeTaxConfig(settings.tax || { iva: settings.iva || 0 })
      || { enabled: Number(settings.iva || 0) > 0, rate: Number(settings.iva || 0), priceMode: 'included', showLabel: true, rounding: 'line' };
  }
  function productTaxLegend(product) {
    return window.CLICK360_V16_DOMAIN?.taxLegend(product, businessTaxConfig()) || '';
  }
  function businessPolicies(business = currentBusiness()) {
    const stored = business?.settings?.policies || state.settings?.policies || {};
    return {
      version: Number(stored.version || 1),
      layaway: String(stored.layaway || 'El producto queda reservado al registrar el anticipo.'),
      pickup: String(stored.pickup || 'El retiro debe realizarse hasta la fecha acordada con el negocio.'),
      returns: String(stored.returns || 'Las devoluciones y cambios se revisan directamente con el negocio.'),
      damages: String(stored.damages || 'El negocio verificara el estado del producto al entregarlo.'),
      additional: String(stored.additional || '')
    };
  }
  function layawayTermsText(business = currentBusiness()) {
    const policy = businessPolicies(business);
    return [policy.layaway, policy.pickup, policy.returns, policy.damages, policy.additional].filter(Boolean).join('\n');
  }
  function productsForBiz(bid=currentBusiness()?.id){ return state.products.filter(p=>p.businessId===bid); }
  function salesForBiz(bid=currentBusiness()?.id){ return state.sales.filter(s=>s.businessId===bid); }
  function movementsForBiz(bid=currentBusiness()?.id){ return state.movements.filter(m=>m.businessId===bid); }
  function tablesForBiz(bid=currentBusiness()?.id){ return (state.tables || []).filter(table=>table.businessId===bid); }
  function tableOrdersForBiz(bid=currentBusiness()?.id){ return (state.tableOrders || []).filter(order=>order.businessId===bid); }
  function restaurantRecipesForBiz(bid=currentBusiness()?.id){ return (state.restaurantRecipes || []).filter(recipe=>recipe.businessId===bid); }
  function logisticsForBiz(kind, bid=currentBusiness()?.id){ return (state.logistics?.[kind] || []).filter(entry=>entry.businessId===bid); }
  function financeForBiz(kind, bid=currentBusiness()?.id){ return (state.finance?.[kind] || []).filter(entry=>entry.businessId===bid); }
  function businessHasMeaningfulProfile(business = currentBusiness()) {
    const settings = business?.settings || {};
    const name = String(business?.name || '').trim().toLowerCase();
    const defaultNames = new Set(['', 'mi negocio', 'nuevo negocio', 'empresa 001', 'empresa-001']);
    return !defaultNames.has(name)
      || !!String(settings.ruc || '').trim()
      || !!String(settings.phone || '').trim()
      || !!String(settings.address || '').trim()
      || !!String(settings.logoUrl || '').trim()
      || !!String(settings.ownerName || '').trim();
  }
  function businessMaterialRecordCount(businessId = currentBusiness()?.id) {
    if (!businessId) return 0;
    const byBiz = (list = []) => Array.isArray(list) ? list.filter((item) => item?.businessId === businessId).length : 0;
    const logisticsCount = Object.values(state.logistics || {}).reduce((sum, list) => sum + byBiz(list), 0);
    const financeCount = Object.values(state.finance || {}).reduce((sum, list) => sum + byBiz(list), 0);
    const legacyBusinessId = state.settings?.legacyDataBusinessId;
    const customers = (state.settings?.customers || []).filter((item) => item.businessId === businessId || (!item.businessId && legacyBusinessId === businessId)).length;
    const reminders = (state.settings?.reminders || []).filter((item) => item.businessId === businessId || (!item.businessId && legacyBusinessId === businessId)).length;
    const labels = (state.settings?.labelTemplates || []).filter((item) => item.businessId === businessId || (!item.businessId && legacyBusinessId === businessId)).length;
    return productsForBiz(businessId).length
      + salesForBiz(businessId).length
      + movementsForBiz(businessId).length
      + tablesForBiz(businessId).length
      + tableOrdersForBiz(businessId).length
      + restaurantRecipesForBiz(businessId).length
      + byBiz(state.invoices || [])
      + customers
      + reminders
      + labels
      + logisticsCount
      + financeCount;
  }
  function shouldPromptInitialBusinessSetup(access, business = currentBusiness()) {
    if (onboardingPrompted || access.source !== 'accountAccess' || access.readOnly || !isOwnerUser()) return false;
    if (state.settings?.onboarding?.completedAt) return false;
    if (!business || state.businesses.length > 1) return false;
    return !businessHasMeaningfulProfile(business) && businessMaterialRecordCount(business.id) === 0;
  }
  function labelTemplatesForBiz(bid=currentBusiness()?.id) {
    const legacyBusinessId = state.settings?.legacyDataBusinessId;
    return (state.settings?.labelTemplates || []).filter((template) => template.businessId === bid
      || (!template.businessId && legacyBusinessId === bid));
  }
  function labelProfilesForBiz(bid=currentBusiness()?.id) {
    const legacyBusinessId = state.settings?.legacyDataBusinessId;
    return (state.settings?.labelProfiles || []).filter((profile) => profile.businessId === bid
      || (!profile.businessId && legacyBusinessId === bid));
  }
  const printDeviceMemory = new Map();
  function printDeviceStorageKey(businessId=currentBusiness()?.id) {
    const identity = window.click360DebugSyncIdentity?.() || {};
    return window.CLICK360_SMART_PRINT?.localDeviceStorageKey({
      uid:identity.uid,
      tenantKey:activeTenantContext?.tenantKey,
      businessId,
      deviceId:identity.deviceId
    }) || '';
  }
  function loadPrintDeviceState(businessId=currentBusiness()?.id) {
    const key = printDeviceStorageKey(businessId);
    if (!key) return {};
    if (printDeviceMemory.has(key)) return JSON.parse(JSON.stringify(printDeviceMemory.get(key)));
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '{}');
      const identity = window.click360DebugSyncIdentity?.() || {};
      const normalized = window.CLICK360_SMART_PRINT?.normalizeLocalDeviceState(parsed, {
        uid:identity.uid,
        tenantKey:activeTenantContext?.tenantKey,
        businessId,
        deviceId:identity.deviceId
      }) || (parsed && typeof parsed === 'object' ? parsed : {});
      printDeviceMemory.set(key, normalized);
      return JSON.parse(JSON.stringify(normalized));
    } catch {
      return {};
    }
  }
  function savePrintDeviceState(next, businessId=currentBusiness()?.id) {
    const key = printDeviceStorageKey(businessId);
    if (!key) return {};
    const identity = window.click360DebugSyncIdentity?.() || {};
    const safe = window.CLICK360_SMART_PRINT?.normalizeLocalDeviceState(next, {
      uid:identity.uid,
      tenantKey:activeTenantContext?.tenantKey,
      businessId,
      deviceId:identity.deviceId
    }) || (next && typeof next === 'object' ? JSON.parse(JSON.stringify(next)) : {});
    printDeviceMemory.set(key, safe);
    try { localStorage.setItem(key, JSON.stringify(safe)); } catch {}
    return safe;
  }
  function isRestaurantBusiness(business=currentBusiness()) {
    return ['restaurante', 'cafeteria', 'bar'].includes(String(business?.type || '').toLowerCase());
  }
  function p2Flag(key) {
    const flags = window.CLICK360_P2_WEB_SAFE_FLAGS || {};
    return flags[key] === true;
  }
  function restaurantModuleEnabled(business=currentBusiness()) {
    return isRestaurantBusiness(business) && p2Flag('p2RestaurantAdvancedEnabled');
  }
  function isLogisticsBusiness(business=currentBusiness()) {
    const type = String(business?.type || '').toLowerCase();
    return ['logistica', 'distribucion', 'transporte'].includes(type);
  }
  function logisticsModuleEnabled(business=currentBusiness()) {
    return isLogisticsBusiness(business) && p2Flag('p2LogisticsEnabled');
  }
  function restaurantActor() {
    return { uid:window.click360User?.uid || 'local-owner', roleId:isOwnerUser() ? 'owner' : 'server', permissions:isOwnerUser() ? undefined : ['tables.read','orders.create','orders.update'] };
  }
  function logisticsActor() {
    return { uid:window.click360User?.uid || 'local-owner', roleId:isOwnerUser() ? 'owner' : 'routeSeller' };
  }
  function saveTableLayoutChange() {
    window.click360ClearStaleSyncGuard?.({ reason:'restaurant_table_layout', force:false });
    return save({ operationId:uid('table-layout'), syncSource:'restaurant_table_layout' });
  }
  function resolveLabelCopyResult(manualCopies, stock, useStock=false) {
    return window.CLICK360_SMART_PRINT?.resolveCopies(manualCopies, useStock, stock)
      || (() => {
        const parsed = Number(useStock ? stock : manualCopies);
        const valid = Number.isInteger(parsed) && parsed >= (useStock ? 0 : 1) && parsed <= 500;
        return { valid, count:valid ? parsed : 0, mode:useStock ? 'stock' : 'exact', error:valid ? '' : 'La cantidad debe ser un numero entero valido.' };
      })();
  }
  function resolveLabelCopies(manualCopies, stock, useStock=false) {
    return resolveLabelCopyResult(manualCopies, stock, useStock).count;
  }
  window.click360ResolveLabelCopies = resolveLabelCopies;
  const HELP_TOPICS = Object.freeze([
    { id:'first-product', category:'Primeros pasos', title:'¿Cómo creo mi primer producto?', keywords:'nuevo inventario registrar precio código stock', steps:['Abre Inventario y toca Nuevo.','Completa nombre, código, precio y stock.','Revisa el negocio activo y guarda.'] },
    { id:'inventory-stock', category:'Inventario', title:'¿Cómo ajusto el stock de un producto?', keywords:'cantidad existencias corregir editar', steps:['Abre Inventario.','Edita el producto correcto.','Cambia la cantidad y guarda.'] },
    { id:'sell-product', category:'Ventas', title:'¿Cómo vendo un producto?', keywords:'cobrar carrito factura ticket', steps:['Abre Caja y confirma que la jornada esté activa.','Ve a Vender y agrega productos.','Elige el método y confirma el cobro.'] },
    { id:'open-cash', category:'Caja diaria', title:'¿Cómo abro caja?', keywords:'iniciar jornada efectivo inicial apertura', steps:['Ve a Caja.','Registra el efectivo inicial.','Confirma la apertura antes de vender.'] },
    { id:'close-cash', category:'Cierre de caja', title:'¿Cómo cierro caja?', keywords:'cerrar caja no puedo cerrar caja cierre diario cuadre faltante sobrante', steps:['En Caja toca Cerrar día.','Revisa ventas, movimientos y efectivo esperado.','Cuenta el efectivo y confirma el cierre.'] },
    { id:'cash-history', category:'Cierre de caja', title:'¿Dónde veo el historial de cierres?', keywords:'reporte cierre pasado historial caja', steps:['Abre Caja.','Entra al historial de cierres.','Selecciona el día que deseas revisar.'] },
    { id:'switch-business', category:'Primeros pasos', title:'¿Cómo cambio de negocio?', keywords:'empresa local sucursal negocio activo', steps:['Toca el selector de negocio superior.','Elige el negocio.','Confirma su nombre antes de registrar operaciones.'] },
    { id:'scan-code', category:'Código de barras / QR', title:'¿Cómo escaneo un código de barras o QR?', keywords:'barcode lector escanear cámara qr código barras', steps:['En Inventario o Vender toca Escanear.','Permite la cámara cuando el navegador lo solicite.','Centra el QR o código hasta que CLICK 360 lo reconozca.'] },
    { id:'camera-help', category:'Código de barras / QR', title:'¿Qué hago si mi cámara no lee el código?', keywords:'permiso cámara enfoque luz safari android iphone', steps:['Comprueba el permiso de cámara.','Mejora la luz y limpia el lente.','Si no funciona, escribe el código manualmente.'] },
    { id:'print-label', category:'Etiquetas', title:'¿Cómo imprimo una etiqueta?', keywords:'etiqueta imprimir impresión plantilla papel térmica', steps:['En Inventario abre la etiqueta del producto.','Elige tamaño, cantidad y papel.','Revisa la hoja completa y toca Imprimir.'] },
    { id:'label-stock', category:'Etiquetas', title:'¿Cómo imprimo exactamente una etiqueta?', keywords:'cantidad exacta stock una copia copias', steps:['Escribe 1 en Cantidad exacta.','Deja desactivada la opción por stock.','La vista previa debe indicar 1 etiqueta.'] },
    { id:'label-alignment', category:'Etiquetas', title:'La etiqueta sale cortada o desalineada', keywords:'margen corte impresora dpi hoja columnas', steps:['Elige el tamaño real del papel.','Ejecuta Prueba de alineación.','Ajusta márgenes y separación antes de imprimir el catálogo.'] },
    { id:'label-measure', category:'Etiquetas', title:'¿Cómo mido un sticker?', keywords:'medir sticker ancho alto milimetros regla', steps:['Mide un sticker individual de borde a borde.','Anota primero el ancho y luego el alto en milímetros.','Mide aparte el ancho total del rollo o de la hoja.'] },
    { id:'label-media-width', category:'Etiquetas', title:'Sticker y ancho total del rollo no son lo mismo', keywords:'ancho total rollo sticker soporte dos columnas', steps:['El sticker es una sola etiqueta.','El soporte incluye todas las columnas, separaciones y márgenes.','Para varias columnas CLICK necesita ambas medidas.'] },
    { id:'label-columns', category:'Etiquetas', title:'¿Cómo sé cuántas columnas tiene mi rollo?', keywords:'una dos tres columnas rollo etiquetas', steps:['Observa una fila horizontal del material.','Cuenta cuántos stickers aparecen lado a lado.','Selecciona esa cantidad en el Asistente de impresión.'] },
    { id:'label-gap', category:'Etiquetas', title:'¿Qué significa gap?', keywords:'gap espacio separación horizontal vertical sensor', steps:['El gap es el espacio físico entre stickers.','Mídelo en milímetros sin incluir el sticker.','En el driver selecciona etiquetas con espacios o Gap.'] },
    { id:'label-browser-headers', category:'Etiquetas', title:'¿Cómo quito la URL y los encabezados al imprimir?', keywords:'url encabezado pie pagina chrome navegador', steps:['Abre el diálogo de impresión.','Desactiva Encabezados y pies de página.','Usa Márgenes: ninguno y Escala: 100 % o Tamaño real.'] },
    { id:'label-partial-sheet', category:'Etiquetas', title:'¿Cómo reutilizo una hoja parcialmente usada?', keywords:'casilla inicio hoja usada reutilizar columna derecha', steps:['En el paso Desde dónde empezar marca las casillas ya usadas.','Elige la primera casilla disponible.','Comprueba los espacios grises en la vista física.'] },
    { id:'label-rotated', category:'Etiquetas', title:'La impresión sale girada', keywords:'sale girada rotacion orientación 90 grados', steps:['Confirma ancho y alto del sticker.','Cambia Rotación del contenido, no las medidas físicas.','Imprime una prueba de alineación antes del lote.'] },
    { id:'label-multiple', category:'Etiquetas', title:'La impresora genera varias copias', keywords:'imprime varias copias cantidad stock duplicadas', steps:['Comprueba Cantidad exacta.','Deja desactivado Imprimir por stock.','En Chrome y en el driver usa Copias: 1.'] },
    { id:'label-two-column', category:'Etiquetas', title:'Una columna funciona y otra no', keywords:'dos columnas izquierda derecha desplazada segunda columna', steps:['Confirma el ancho total del soporte.','Mide gap horizontal y márgenes.','Imprime la cuadrícula numerada y calibra X/Y.'] },
    { id:'label-driver', category:'Etiquetas', title:'¿El problema es CLICK o el driver?', keywords:'driver windows click vista previa papel fisico sensor', steps:['Si la vista física ya está cortada, corrige el perfil en CLICK.','Si la vista está bien pero el papel sale mal, revisa tamaño, escala, gap y sensor en Windows.','Comparte el diagnóstico sanitizado con soporte.'] },
    { id:'label-diagnostic', category:'Etiquetas', title:'¿Cómo comparto un diagnóstico de impresión?', keywords:'diagnostico soporte copiar json perfil', steps:['Abre el Asistente de impresión.','En Revisión toca Copiar diagnóstico.','El reporte no incluye correos, clientes, ventas ni productos.'] },
    { id:'create-table', category:'Mesas', title:'¿Cómo creo y organizo una mesa?', keywords:'mesa restaurante abrir plano mover color forma', steps:['Configura el negocio como restaurante, cafetería o bar.','Ve a Mesas y toca Nueva mesa.','Activa Editar plano para moverla o cambiar su forma.'] },
    { id:'charge-table', category:'Mesas', title:'¿Cómo cobro una mesa?', keywords:'cuenta restaurante liberar mesa pago', steps:['Abre la mesa y agrega productos.','Marca por cobrar si necesitas avisar a caja.','Toca Cobrar mesa; la venta queda en la caja activa.'] },
    { id:'monthly-payment', category:'Finanzas', title:'¿Cómo registro un pago mensual?', keywords:'pago mensual registrar vencimiento arriendo luz', steps:['Ve a Más y abre Finanzas.','En Pagos mensuales toca Agregar.','Completa monto, fecha y guarda.'] },
    { id:'finance-goals', category:'Finanzas', title:'¿Cómo creo una meta o un sobre?', keywords:'meta sueño ahorro sobre dinero separado presupuesto finanzas', steps:['Ve a Más y abre Finanzas.','Elige Metas o Sobres de dinero.','Escribe el objetivo y el monto guardado; esto no mueve la caja.'] },
    { id:'install-pwa', category:'Aplicación', title:'¿Cómo instalo CLICK 360 en mi celular?', keywords:'pwa instalar iphone android pantalla inicio app', steps:['Abre Más.','Toca Instalar CLICK 360 como app.','Sigue la instrucción de Safari o Chrome para añadirla a inicio.'] },
    { id:'offline', category:'Nube y respaldo', title:'¿Qué puedo hacer sin internet?', keywords:'offline sin conexión pendiente sincronizar nube', steps:['Puedes consultar la última copia validada.','Las acciones que requieren nube pueden quedar pendientes.','Reconecta y espera la confirmación antes de cerrar la app.'] },
    { id:'local-state', category:'Nube y respaldo', title:'¿Qué significa limpiar estado local?', keywords:'conflicto stale lock caché safari pwa', steps:['Abre Diagnóstico o Ajustes.','Usa Limpiar estado local de esta app.','CLICK 360 elimina bloqueos obsoletos y vuelve a leer la nube; no borra Firebase.'] },
    { id:'common-errors', category:'Errores comunes', title:'¿Qué hago si una acción no se completa?', keywords:'error código falla bloqueado soporte', steps:['Comprueba internet.','Anota el código visible.','Reintenta una vez y, si continúa, comparte el diagnóstico con soporte.'] },
    { id:'support', category:'Soporte', title:'¿Cómo contactar soporte?', keywords:'whatsapp ayuda contacto', steps:['Toca Contactar soporte por WhatsApp.','Describe la pantalla y el código de error.','Nunca compartas contraseñas ni códigos de acceso.'] }
  ]);
  function latestCashSession(businessId = currentBusiness()?.id, date = today()) {
    return (state.cashSessions || []).slice().reverse().find((session) =>
      session.businessId === businessId && session.date === date) || null;
  }
  function currentOpenCashSession(businessId = currentBusiness()?.id, date = today()) {
    const session = latestCashSession(businessId, date);
    return session?.status === 'open' ? session : null;
  }
  function isCashIncomeMovement(m) {
    if (!m || m.kind !== 'ingreso' || m.status === 'cancelled') return false;
    return !['Tarjeta', 'Transferencia'].includes(m.paymentMethod || '');
  }
  function isDayStarted() {
    const bid = currentBusiness()?.id;
    if (!bid) return true;
    if (currentOpenCashSession(bid, today())) return true;
    const latestSession = latestCashSession(bid, today());
    if (latestSession) return latestSession.status === 'open';
    return state.movements.some(m => m.businessId === bid && m.date === today() && m.kind === 'apertura')
      && !isBusinessDateClosed(today(), bid);
  }
  function isDayClosed() {
	    const bid = currentBusiness()?.id;
	    if (!bid) return false;
	    return isBusinessDateClosed(today(), bid);
	  }
  function isBusinessDateClosed(date, businessId = currentBusiness()?.id) {
    return !!businessId && (state.dailyReports || []).some((report) =>
      report.businessId === businessId && report.date === date && report.status !== 'reopened');
  }
  function can(section) {
    const role = authUser().role;
    if (role === 'owner') return true;
	    if (['home','more','access','legal','printing','help'].includes(section)) return ['worker','cashier','inventory'].includes(role);
    const permissions = window.click360User?.permissions || {};
    const routeModule = { inventory: 'inventory', sell: 'sales', cash: 'cash', settings: 'settings', reports: 'reports', crm: 'customers', reminders: 'reminders', invoices: 'suppliers', workers: 'workers' }[section];
    if (routeModule && Object.keys(permissions).length) return permissions[routeModule]?.view === true;
    if (role === 'worker') return ['inventory','sell','cash','settings'].includes(section);
    if (role === 'cashier') return ['sell','cash'].includes(section);
    if (role === 'inventory') return section === 'inventory';
    return false;
  }
  function checkAuth(required='business') {
    const u = currentUser();
    if (!u) { setSession(null); renderLogin('', { ready:true }); return false; }
    const b = currentBusiness();
    if (b && ['pausado','vencido'].includes(b.status)) { renderPaused(b); return false; }
    return true;
  }

  function businessVocabulary(type) {
    return {
      ropa: { singular:'producto', plural:'productos', category:'Categoría', examples:'Talla, color, colección' },
      restaurante: { singular:'producto/plato', plural:'productos/platos', category:'Categoría', examples:'Comida, bebida, combo' },
      barberia: { singular:'servicio', plural:'servicios', category:'Tipo de servicio', examples:'Corte, barba, combo' },
      ganaderia: { singular:'animal/activo', plural:'animales/activos', category:'Estado o lote', examples:'Peso, edad, vacuna' },
      ferreteria: { singular:'producto', plural:'productos', category:'Categoría', examples:'Marca, medida, proveedor' },
      otro: { singular:'producto/activo', plural:'productos/activos', category:'Categoría', examples:'Notas del negocio' }
    }[type] || { singular:'producto/activo', plural:'productos/activos', category:'Categoría', examples:'Notas' };
  }

  // -------- QR GENERATOR: real local library wrapper, no CDN --------
  const QR = (() => {
    function make(text){
      const value = String(text || '').trim().toUpperCase();
      if(!value) throw new Error('Código QR vacío');
      if(window.qrcode){
        const qr = window.qrcode(0, 'M');
        qr.addData(value);
        qr.make();
        const n = qr.getModuleCount();
        const mat = Array.from({length:n},(_,r)=>Array.from({length:n},(_,c)=>qr.isDark(r,c)));
        return mat;
      }
      // Emergency fallback only. Normal build uses vendor/qrcode-generator.js.
      const size=21;
      const mat=Array.from({length:size},()=>Array(size).fill(false));
      for(let i=0;i<size;i++){mat[0][i]=mat[size-1][i]=mat[i][0]=mat[i][size-1]=true;}
      return mat;
    }
    function draw(canvas,text,size=280,margin=5,fgColor='#000000',bgColor='#ffffff'){
      const mat=make(text), n=mat.length;
      canvas.width=size; canvas.height=size;
      const ctx=canvas.getContext('2d');
      ctx.fillStyle=bgColor; ctx.fillRect(0,0,size,size);
      const cell=size/(n+margin*2);
      ctx.fillStyle=fgColor;
      for(let r=0;r<n;r++) for(let c=0;c<n;c++) if(mat[r][c]) ctx.fillRect(Math.round((c+margin)*cell),Math.round((r+margin)*cell),Math.ceil(cell),Math.ceil(cell));
    }
    return { draw, make };
  })();

	  function generateCode(name='P') {
	    const base = slug(name).split('-').map(x=>x[0]).join('').slice(0,4).toUpperCase() || 'P';
	    let c;
	    do { c = `${base}${Math.random().toString(36).slice(2,7).toUpperCase()}`; } while(codeExists(c));
	    return c;
	  }
	  function codeExists(code, productId=null, businessId=currentBusiness()?.id) { return state.products.some(p => p.businessId === businessId && p.code.toUpperCase() === String(code).toUpperCase() && p.id !== productId); }
	  function tombstoneProduct(product, reason='deleted') {
	    if (!product) return;
	    state.deletedProducts ||= [];
	    const nowMs = Date.now();
	    state.deletedProducts.push({
	      id: product.id,
	      businessId: product.businessId,
	      code: String(product.code || '').trim().toUpperCase(),
	      name: product.name || '',
	      reason,
	      deletedAt: new Date(nowMs).toISOString(),
	      deletedAtMs: nowMs,
	      deletedBy: authUser().name || 'Sistema'
	    });
	  }
	  function productPayload(product) {
    // QR ultra-simple for faster camera/photo decoding. The business is validated by the active inventory.
    return String(product.code || '').trim().toUpperCase();
  }
  function normalizeCode(input) {
    const s = String(input||'').trim();
    if (!s) return '';
    if (s.includes('C360|')) return s.split('|').pop().trim();
    if (s.includes('CLICK360|PRODUCT|')) return s.split('|').pop().trim();
    try {
      const u = new URL(s, location.href);
      const q = u.searchParams.get('scan') || u.searchParams.get('code') || '';
      if (q) return normalizeCode(q);
      const scan = u.hash.startsWith('#scan=') ? decodeURIComponent(u.hash.slice(6)) : '';
      if (scan) return normalizeCode(scan);
    } catch {}
    return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  }

  function renderLogin(message='', options = {}) {
    stopScanner();
    // Splash screen on first visit this session
    if (options.ready && !sessionStorage.getItem('c360_splash')) {
      try {
        sessionStorage.setItem('c360_splash','1');
        const sp = document.createElement('div');
        sp.id = 'click360Splash';
        sp.innerHTML = '<div class="splashInner"><div class="splashLogoWrap"><div class="logoIcon splashLogoIcon"></div></div><div class="splashBrand"><b>CLICK</b><span>360</span></div><div class="splashTag">Tu negocio, listo para crecer</div></div>';
        document.body.appendChild(sp);
        requestAnimationFrame(() => { try { sp.classList.add('splashShow'); } catch {} });
        setTimeout(() => {
          try {
            sp.classList.add('splashOut');
            setTimeout(() => { try { sp.isConnected && sp.remove(); } catch {} renderLogin(message, { ...options }); }, 500);
          } catch { renderLogin(message, { ...options }); }
        }, 2600);
        return;
      } catch(e) { console.warn('splash error:', e); /* fall through to normal login */ }
    }
    app.innerHTML = `
      <main class="loginPage">
        <section class="loginShell" style="text-align:center;">
          <div class="loginBrand">
            <div class="logoIcon" style="margin: 0 auto;"></div>
            <div class="logoText" style="margin-top:20px;"><b>CLICK</b><span>360</span></div>
          </div>
          <div style="margin-top:30px;color:var(--gold);font-weight:bold;">
            ${escapeHtml(message || 'Validando seguridad...')}
          </div>
        </section>
      </main>`;
    if (options.ready === true) markAppReady('login');
  }

  function renderPaused(b) {
    app.innerHTML = `<main class="pausedPage"><section class="card"><div class="logoMark" style="justify-content:center;margin-bottom:18px"><div class="logoIcon"></div><div class="logoText"><b>CLICK</b><span>360</span></div></div><h1>Cuenta ${escapeHtml(b.status)}</h1><p>Tu cuenta está ${escapeHtml(b.status)}. Contacta a CLICK 360 para reactivar tu servicio.</p><button class="btn primary block" id="logoutPaused">Cerrar sesión</button></section></main>`;
    $('#logoutPaused').onclick=()=>window.click360AppLogout();
    markAppReady('paused');
  }

	  function shell(content, active='home') {
    const isWorkingDateActive = !!workingDate;
    const badgeBorder = isWorkingDateActive ? 'border:2px solid var(--gold); background:rgba(244,196,49,0.25);' : 'border:1px solid rgba(244,196,49,0.25); background:rgba(244,196,49,0.12);';
    const clearDateBtn = isWorkingDateActive ? `<button type="button" id="clearWorkingDateBtn" style="background:none; border:none; color:#ff4d4d; cursor:pointer; font-size:14px; margin-left:6px; padding:0; display:inline-flex; align-items:center;" title="Volver a hoy">✕</button>` : '';

	    const dateBadgeHtml = `<div class="businessDateBar">
		        <label class="businessDateClock" style="${badgeBorder}" title="Cambiar fecha de trabajo">
		          ${icon('calendar-days')} <span class="js-business-clock" data-clock-format="full" aria-live="off">${escapeHtml(liveClockLabel())}</span>
	          <input type="date" id="workingDateInput" value="${today()}" style="position:absolute; top:0; left:0; width:100%; height:100%; opacity:0; cursor:pointer;">
	        </label>
	        ${isWorkingDateActive ? `<span class="workingDateNotice">Fecha de trabajo: ${escapeHtml(formattedTodaySpanish())}</span>` : ''}
	        ${clearDateBtn}
	      </div>`;

    const b=currentBusiness();
	    const businessName = b?.name || 'Seleccionar negocio';
	    const businessSwitcher = (id, className = '') => `<button type="button" id="${id}" class="businessSwitchButton ${className}" title="Cambiar negocio"><span>${escapeHtml(businessName)}</span>${icon('chevrons-up-down')}</button>`;
    const businessLogo = safeImageSrc(b?.settings?.logoUrl);
    const profilePhoto = safeImageSrc(authUser().photoURL);
    const logoIconSide = businessLogo
      ? `<img src="${escapeHtml(businessLogo)}" style="width:48px;height:48px;object-fit:cover;border-radius:10px;">`
      : `<div class="logoIcon" style="width:48px;height:48px;"></div>`;
    const logoIconTop = businessLogo
      ? `<img src="${escapeHtml(businessLogo)}" style="width:44px;height:44px;object-fit:cover;border-radius:8px;">`
      : `<div class="logoIcon" style="width:44px;height:44px;"></div>`;
    const avatarHtml = profilePhoto
      ? `<img src="${escapeHtml(profilePhoto)}" style="width:100%;height:100%;object-fit:contain;background:#111;">`
      : (businessLogo
        ? `<img src="${escapeHtml(businessLogo)}" style="width:100%;height:100%;object-fit:contain;background:#111;">`
        : (authUser().name || 'U').charAt(0).toUpperCase());
    const unreadCount = notificationItems().filter((item) => !item.read).length;

		    return `<div class="app"><div class="desktopLayout">
	      <aside class="sidebar flex-sidebar">
	        <div>
		          <button type="button" class="logoMark sidebarBrand" onclick="window.location.hash='#home'" aria-label="Ir a Inicio">${logoIconSide}<span class="logoText" style="font-size:28px;"><b>CLICK</b><span>360</span><small class="versionBadge">${escapeHtml(APP_VISIBLE_VERSION)}</small><small class="brandSlogan">Control total de tu negocio</small></span></button>
	          <div class="field"><label>Negocio activo</label>${businessSwitcher('businessPickerSide')}</div>
	          <nav class="sideNav">${navButtons(active, true)}</nav>
	        </div>
	        <div style="margin-top:auto; padding-top:20px; border-top:1px solid var(--line); display:grid; gap:10px;">
		          <div class="sidebarStatusRow"><span class="sidebarStatusLabel">Actividad</span><button type="button" id="notificationBellSide" class="iconBtn notificationBell" title="Notificaciones" aria-label="Notificaciones${unreadCount ? `, ${unreadCount} sin leer` : ''}">${icon('bell')}${unreadCount ? `<b>${unreadCount > 99 ? '99+' : unreadCount}</b>` : ''}</button></div>
	          ${syncPillHtml(false)}
	          <div style="display:flex; align-items:center; gap:10px;">
	            <button type="button" class="profileAvatar" onclick="window.location.hash='#settings'" aria-label="Abrir ajustes" style="background:#1a1a1a; color:var(--gold); width:44px; height:44px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; font-weight:bold; border: 1px solid var(--gold); overflow:hidden;" title="Ajustes">${avatarHtml}</button>
	            <button class="logoutBtn logoutBtnWide" id="logoutSide" title="Cerrar sesión">${icon('log-out')}<span>Cerrar sesión</span></button>
	          </div>
	        </div>
	      </aside>
      <div>
        <header class="topbar">
          <button type="button" class="logoMark" onclick="window.location.hash='#home'" aria-label="Ir a Inicio">${logoIconTop}<span class="logoText" style="font-size:24px;"><b>CLICK</b><span>360</span><small>Control total</small></span></button>
	          <div style="flex:1; display:flex; justify-content:center; min-width:0; padding:0 8px;">
	            ${businessSwitcher('businessPickerTop', 'businessSelect')}
	          </div>
		          <button type="button" id="notificationBell" class="iconBtn notificationBell" title="Notificaciones" aria-label="Notificaciones${unreadCount ? `, ${unreadCount} sin leer` : ''}">${icon('bell')}${unreadCount ? `<b>${unreadCount > 99 ? '99+' : unreadCount}</b>` : ''}</button>
	        </header>
        <div style="flex-shrink:0; padding:16px 16px 0; background:transparent;">
          ${dateBadgeHtml}
        </div>
        <main class="main" style="padding-top:10px;">
          ${content}
        </main>
      </div>
	    </div>${bottomNav(active)}<button type="button" id="floatingCalcBtn" class="floatingCalcBtn" aria-label="Abrir calculadora" title="Calculadora">${icon('calculator')}</button><div id="modalRoot"></div><div id="printRoot" class="printSheet"></div></div>`;
  }
	  function primaryRouteKeys() {
	    const routes = ['home','inventory','sell','cash'];
	    if (restaurantModuleEnabled()) routes.push('tables','kitchen','bar');
	    if (logisticsModuleEnabled()) routes.push('logistics');
	    routes.push('finance','workers','reminders','reports','crm','more');
	    return routes;
	  }
	  function allowedRoutes(){
	    const r=currentUser()?.role;
	    if(r==='cashier') return ['home','sell','cash', ...(restaurantModuleEnabled() ? ['tables','bar'] : []), 'more'];
	    if(r==='inventory') return ['home','inventory','reminders','more'];
	    if(r==='worker') return ['home','inventory','sell','cash', ...(restaurantModuleEnabled() ? ['tables','kitchen','bar'] : []), 'reminders','more'];
	    return primaryRouteKeys();
	  }
  function navButtons(active, side=false) {
    const iconMap = {
      home:['home', 'Inicio'], inventory:['package', 'Inventario'], sell:['shopping-cart', 'Vender'], cash:['credit-card', 'Caja'],
      tables:['armchair', 'Mesas'], kitchen:['chef-hat', 'Cocina'], bar:['wine', 'Barra'], finance:['wallet-cards', 'Finanzas'],
      logistics:['truck', 'Rutas'], workers:['users-round', 'Trabajadores'], reminders:['alarm-clock', 'Recordatorios'],
      reports:['chart-no-axes-combined', 'Reportes'], crm:['contact-round', 'Clientes'], more:['menu', 'Más']
    };
    const compactLabels = { inventory:'Invent.', workers:'Equipo', reminders:'Agenda', reports:'Reportes', logistics:'Rutas', finance:'Finanzas' };
    const items = allowedRoutes().map((key) => [key, icon(iconMap[key]?.[0] || 'circle'), iconMap[key]?.[1] || key]);
    return items.map(([key,ico,label])=>`<button class="${side?'btn':'navBtn'} ${active===key?'active':''}" data-route="${key}"${active===key?' aria-current="page"':''}>${side?ico+' ':`<span class="navIcon">${ico}</span>`}<span>${escapeHtml(side ? label : (compactLabels[key] || label))}</span></button>`).join('');
  }
	  function bottomNav(active){ return `<nav class="bottomNav" aria-label="Navegación principal">${navButtons(active)}</nav>`; }
	  function openBusinessSwitcher() {
	    // P1 FIX: No abrir el switcher si ya hay un cambio en curso
	    if (BUSINESS_SWITCH_GUARD) return;
	    const active = currentBusiness()?.id;
	    showModal(`<div class="modalHeader"><div><h2>Cambiar negocio</h2><p class="fieldHint">Selecciona dónde quieres trabajar.</p></div><button class="closeBtn" data-close aria-label="Cerrar">×</button></div><div class="businessSwitchList">${state.businesses.map((business) => `<button type="button" class="businessSwitchOption ${business.id === active ? 'active' : ''}" data-business-switch="${actionId(business.id)}"><span>${icon(business.id === active ? 'circle-check-big' : 'store')}<b>${escapeHtml(business.name)}</b></span>${business.id === active ? '<small>Activo</small>' : icon('chevron-right')}</button>`).join('')}</div>`);
	    $$('[data-business-switch]').forEach((button) => {
	      button.onclick = () => {
	        // P1 FIX: Usar selectBusinessAtomically para cambio seguro:
	        // - evita doble-tap
	        // - recalcula readOnly desde accessState del usuario (no hereda del negocio anterior)
	        // - no muestra "modo lectura" durante la transición
	        const nextId = decodeActionId(button.dataset.businessSwitch);
	        selectBusinessAtomically(nextId, route);
	      };
	    });
	  }
	  function bindShell(){
	    clearInterval(clockTimer);
		    const updateClock = () => {
		      $$('.js-business-clock').forEach((element) => { element.textContent = liveClockLabel(element.dataset.clockFormat === 'compact'); });
		      updateTrialCountdown();
		    };
	    updateClock();
	    clockTimer = setInterval(updateClock, 60000);
    $$('[data-route]').forEach(b=>b.onclick=()=>renderApp(b.dataset.route));
    requestAnimationFrame(() => { document.querySelector('.bottomNav .navBtn.active')?.scrollIntoView({block:'nearest',inline:'center',behavior:'instant'}); });
	    ['businessPickerTop','businessPickerSide'].forEach(id=>{ const el=$('#'+id); if(el) el.onclick=openBusinessSwitcher; });
    $('#logoutTop')?.addEventListener('click',()=>window.click360AppLogout());
    $('#logoutSide')?.addEventListener('click',()=>window.click360AppLogout());
    $('#notificationBell')?.addEventListener('click', openNotificationCenter);
		    $('#notificationBellSide')?.addEventListener('click', openNotificationCenter);
		    bindFloatingCalculator();
		    refreshIcons();

    const dateInput = $('#workingDateInput');
    if (dateInput) {
       dateInput.onchange = () => {
          setWorkingDate(dateInput.value);
       };
    }
    const clearDateBtn = $('#clearWorkingDateBtn');
    if (clearDateBtn) {
       clearDateBtn.onclick = (e) => {
          e.preventDefault();
          setWorkingDate(null);
       };
    }
  }
	  function renderApp(r='home') {
	    try {
	      if(!checkAuth('business')) return;
	      if(!can(r)) r='home';
	      stopScanner(); closeModal(); route=r;
      clearInterval(clockTimer);
      history.replaceState(null, '', '#' + r);
      const views={home:homeView,inventory:inventoryView,sell:sellView,cash:cashView,more:moreView,reports:reportsView,settings:settingsView,workers:workersView,backup:backupView,debtors:debtorsView,invoices:invoicesView,crm:crmView,reminders:remindersView,access:accessView,legal:legalView,printing:printingView,tables:tablesView,kitchen:kitchenView,bar:barView,logistics:logisticsView,finance:financeView,help:helpView};
      app.innerHTML=shell((views[r]||homeView)(), r);
      bindShell(); bindView(r);
      checkDueReminders();
      if (r === 'home') setTimeout(showOnboardingForNewAccount, 0);
      markAppReady(`route:${r}`);
	    } catch(e) {
	      console.error("Error al renderizar la app:", e);
	      const report = window.CLICK360_RUNTIME_GUARD?.record?.({
	        message: e?.message || 'No se pudo abrir una vista.',
	        filename: 'app.js',
	        stack: e?.stack || ''
	      });
	      app.innerHTML = `<main class="friendlyError" role="alert"><div>${icon('refresh-cw')}<h2>No pudimos abrir esta sección</h2><p>Tu información sigue protegida. Actualiza CLICK 360 e inténtalo nuevamente.</p>${report?.reportId ? `<small>Código de ayuda: ${escapeHtml(report.reportId)}</small>` : ''}<button class="btn primary" onclick="location.reload()">Actualizar aplicación</button></div></main>`;
	      refreshIcons();
	      markAppReady('error');
	    }
  }

  function homeView() {
    const b=currentBusiness(), products=productsForBiz(), sales=salesForBiz().filter(s=>s.date===today() && s.status!=='cancelled'), mov=movementsForBiz().filter(m=>m.date===today() && m.status!=='cancelled');
    const apertura=mov.find(m=>m.kind==='apertura')?.amount||0;
    const income=mov.filter(isCashIncomeMovement).reduce((a,m)=>a+m.amount,0);
    const expenses=mov.filter(m=>m.kind==='egreso').reduce((a,m)=>a+m.amount,0);
    const compras=mov.filter(m=>m.kind==='compra').reduce((a,m)=>a+m.amount,0);
    const retiros=mov.filter(m=>m.kind==='retiro').reduce((a,m)=>a+m.amount,0);
    const out=expenses+compras+retiros;
    const saldo=apertura+income-out;
    const low=products.filter(p=>p.qty<=3).length;
    const motivationalPhrases = [
      '"El éxito no es casualidad, es constancia."',
      '"Cada venta es un paso más hacia tu sueño."',
      '"Tu negocio crece contigo. \u00a1Sigue adelante!"',
      '"La disciplina vence al talento."',
      '"Hoy es un gran día para vender."',
      '"El mejor momento para crecer es ahora."',
      '"Controla tu negocio, controla tu futuro."',
      '"Los grandes negocios empiezan con peque\u00f1os pasos."'
    ];
    const todayPhrase = motivationalPhrases[new Date().getDate() % motivationalPhrases.length];

	    return `<div class="pageHead homeGreeting"><div><h1>Hola, <span>${escapeHtml(authUser().name || 'Usuario')}</span></h1><p>${escapeHtml(b.name)}</p></div></div>
      ${accessBannerHtml()}
      <section class="grid kpis">
        <div class="card kpi gold"><div class="icon">\u2197</div><small>Ventas de hoy</small><strong class="goldText">${fmt(income)}</strong></div>
        <div class="card kpi"><div class="icon">\u25A3</div><small>Caja</small><strong>${fmt(saldo)}</strong></div>
        <div class="card kpi"><div class="icon">\u25A7</div><small>Inventario</small><strong>${products.length}</strong></div>
        <div class="card kpi"><div class="icon">\u26A0</div><small>Stock bajo</small><strong>${low}</strong></div>
      </section>
      <section class="card sectionCard homeBannerCard">
        <h3>TU NEGOCIO CLICK 360</h3>
        <div class="homeBannerFrame">
          <img src="${HOME_BANNER_SRC}" alt="Banner CLICK 360 para negocios" onerror="this.closest('.homeBannerFrame').style.display='none'">
        </div>
        <p class="homeBannerPhrase">${todayPhrase}</p>
        <a href="https://wa.me/593969399562?text=${encodeURIComponent('Hola CLICK 360, necesito informaci\u00f3n')}" target="_blank" rel="noopener noreferrer" class="btn" style="border:1px solid #25D366;color:#25D366;background:transparent;display:flex;align-items:center;justify-content:center;gap:8px;font-weight:700;">\uD83D\uDCAC Contactar Soporte CLICK 360</a>
      </section>
      <section class="split" style="margin-top:14px">
	        <div class="card sectionCard"><h3>\u00DAltimas ventas</h3>${sales.slice(-3).reverse().map(s=>`<div class="movement"><span>${saleItems(s).map(i=>escapeHtml(i.name)).join(', ') || 'Venta sin detalle'}</span><b class="pos">${fmt(s.total)}</b></div>`).join('') || '<p class="empty">A\u00fan no hay ventas hoy.</p>'}</div>
        <div class="card sectionCard"><h3>Acciones r\u00e1pidas</h3><div class="quickActionGrid"><button class="btn primary" onclick="window.click360Route('sell')">Vender</button><button class="btn silver" onclick="window.click360Route('inventory')">Inventario</button>${restaurantModuleEnabled(b) ? `<button class="btn silver" onclick="window.click360Route('tables')">${icon('utensils')} Mesas</button>` : ''}${logisticsModuleEnabled(b) ? `<button class="btn silver" onclick="window.click360Route('logistics')">${icon('truck')} Rutas</button>` : ''}</div></div>
      </section>`;
  }

  function inventoryView() {
    const b=currentBusiness(), v=businessVocabulary(b.type), products=productsForBiz();
    const templates = labelTemplatesForBiz();

    let templatesHtml = '';
    if (templates.length > 0) {
      templatesHtml = `
        <div class="card sectionCard" id="labelTemplatesSection" style="margin-top:20px;">
          <h3>Plantillas de Etiquetas QR</h3>
          <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap:12px; margin-top:10px;">
            ${templates.map(t => `
              <div class="templateRow">
                <div style="font-weight:bold; display:flex; justify-content:space-between; align-items:center;">
                  <span style="color:var(--text);">${escapeHtml(t.name)} ${t.isDefault ? '<span class="badge gold">Predeterminada</span>' : ''}</span>
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                  <span style="display:inline-block; width:18px; height:18px; border-radius:4px; background:${safeColor(t.bgColor, '#ffffff')}; border:1px solid #555;" title="Fondo de Etiqueta"></span>
                  <span style="display:inline-block; width:18px; height:18px; border-radius:4px; background:${safeColor(t.qrBgColor || t.bgColor, '#ffffff')}; border:1px solid #555;" title="Fondo de QR"></span>
                  <span style="display:inline-block; width:18px; height:18px; border-radius:4px; background:${safeColor(t.fgColor, '#000000')}; border:1px solid #555;" title="Texto/QR"></span>
                  <span style="font-size:11px; color:#aaa; margin-left:4px;">Colores</span>
                </div>
                ${t.social ? `<div style="font-size:12px; color:#ccc;">📱 ${escapeHtml(t.social)}</div>` : ''}
                ${t.address ? `<div style="font-size:12px; color:#ccc; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">📍 ${escapeHtml(t.address)}</div>` : ''}
                <div class="templateActions"><button class="btn primary small" data-print-tpl="${escapeHtml(t.id)}" title="Abrir el diálogo de impresión con esta plantilla">${icon('printer')} Imprimir</button><button class="btn small" data-pdf-tpl="${escapeHtml(t.id)}" title="Guardar PDF de esta plantilla">${icon('file-down')} Guardar PDF</button><button class="btn silver" data-edit-tpl="${escapeHtml(t.id)}">${icon('pencil')} Editar</button><button class="btn silver" data-rename-tpl="${escapeHtml(t.id)}">Renombrar</button><button class="btn silver" data-duplicate-tpl="${escapeHtml(t.id)}">Duplicar</button><button class="btn silver" data-default-tpl="${escapeHtml(t.id)}">Predeterminada</button><button class="iconBtn danger small-del-btn" data-del-tpl="${escapeHtml(t.id)}" title="Eliminar plantilla" aria-label="Eliminar plantilla">${icon('trash-2')}</button></div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } else {
      templatesHtml = `
        <div class="card sectionCard" id="labelTemplatesSection" style="margin-top:20px;">
          <h3>Plantillas de Etiquetas QR</h3>
          <p class="empty" style="margin:0; padding:10px 0;">No has creado plantillas de etiquetas aún. Diseña una etiqueta en cualquier producto y guárdala como plantilla para verla aquí.</p>
        </div>
      `;
    }

    return `<div class="pageHead"><div><h1>Inventario</h1><p>Registra, controla y genera etiquetas.</p></div><div class="toolbar"><button class="btn silver" id="openCamera">${icon('scan-line')} Escanear</button><button class="btn primary" id="newProduct">＋ Nuevo</button></div></div>
      <div class="searchBox" style="display:flex; gap:10px;">
         <input id="productSearch" data-scanner-input placeholder="Buscar por nombre o código..." style="flex:1;" />
      </div>
      <div id="cameraPanel" class="cameraPanel" style="margin-bottom:14px;"><video id="scanVideo" playsinline muted></video><div id="cameraStatus" class="cameraStatus">Listo para cámara.</div></div>
      <section id="productList" class="productList" style="margin-top:14px">${productList(products,v)}</section>
      ${templatesHtml}`;
  }
  function refreshInventoryTemplateSection(){
    const currentSection = $('#labelTemplatesSection');
    if (!currentSection || window.location.hash.replace('#', '') !== 'inventory') return;
    const nextView = document.createElement('div');
    nextView.innerHTML = inventoryView();
    const nextSection = nextView.querySelector('#labelTemplatesSection');
    if (!nextSection) return;
    currentSection.replaceWith(nextSection);
    bindInventory();
  }
  function productList(products,v) {
    if(!products.length) return `<div class="card empty">Aún no hay ${escapeHtml(v.plural)}. Crea el primero con Nuevo.</div>`;
    return products.map(p=>`<article class="card productCard hasImage" data-pid="${escapeHtml(p.id)}">
      ${imageThumb(p)}
      <div class="productInfo"><h3>${escapeHtml(p.name)}</h3><div class="meta"><span>${escapeHtml(p.category||'General')}</span><span class="badge">${escapeHtml(p.code)}</span><span>Stock: <b>${p.qty}</b></span><span class="badge gold">${fmt(p.price)}${p.cardPrice && p.cardPrice !== p.price ? ' / ' + fmt(p.cardPrice) + ' tarjeta' : ''}${productTaxLegend(p) ? ` <span style="font-size:10px;opacity:.8;">(${escapeHtml(productTaxLegend(p))})</span>` : ''}</span></div></div>
      <div class="actions"><button class="iconBtn gold" data-label="${escapeHtml(p.id)}" title="Diseñar etiqueta QR" aria-label="Diseñar etiqueta QR">${icon('qr-code')}</button><button class="iconBtn" data-quick-print="${escapeHtml(p.id)}" title="Imprimir etiqueta con la última plantilla guardada" aria-label="Imprimir etiqueta">${icon('printer')}</button><button class="iconBtn" data-edit="${escapeHtml(p.id)}" title="Editar producto" aria-label="Editar producto">${icon('pencil')}</button><button class="iconBtn danger" data-del="${escapeHtml(p.id)}" title="Borrar producto" aria-label="Borrar producto">${icon('trash-2')}</button></div>
    </article>`).join('');
  }

  function sellView() {
    if (!isDayStarted()) {
      return `<div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:60px 20px; text-align:center; min-height:50vh;">
        <div style="font-size:48px; margin-bottom:16px;">🔑</div>
        <h2>Jornada no Iniciada</h2>
        <p style="color:var(--muted); max-width:320px; margin-bottom:24px;">Debes iniciar el día desde la sección de Caja Diaria antes de poder realizar ventas.</p>
        <button class="btn primary" onclick="window.click360Route('cash')">Ir a Caja Diaria</button>
      </div>`;
    }
    if (isDayClosed()) {
      return `<div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:60px 20px; text-align:center; min-height:50vh;">
        <div style="font-size:48px; margin-bottom:16px;">🔒</div>
        <h2>Caja Cerrada</h2>
        <p style="color:var(--muted); max-width:320px; margin-bottom:24px;">El día de hoy ya fue cerrado. Las ventas están deshabilitadas.</p>
        <button class="btn primary" onclick="window.click360Route('home')">Ir al Inicio</button>
      </div>`;
    }
	    return `<div class="pageHead"><div><h1>Vender</h1><p>Escanea QR o ingresa el código.</p></div><div class="toolbar"><button type="button" class="iconBtn" id="calculatorSellBtn" title="Calculadora" aria-label="Abrir calculadora">${icon('calculator')}</button></div></div>
      <section class="sellWrap">
        <div class="card scanBox">
          <div class="scanRows">
            <div class="searchBox"><input id="sellSearch" placeholder="Buscar por nombre o código..." /></div>
            <div class="manualRow">
               <input id="manualCode" data-scanner-input autocomplete="off" placeholder="Código manual o lector físico" />
               <button type="button" class="btn silver" id="addCode" title="Agregar a carrito">
                 <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
               </button>
               <button type="button" class="iconBtn" id="openCamera" title="Escanear QR o código de barras" aria-label="Escanear QR o código de barras">
                 ${icon('scan-line')}
               </button>
            </div>
            <div id="quickProducts" class="productList"></div>
            <div id="cameraPanel" class="cameraPanel"><video id="scanVideo" playsinline muted></video><div id="cameraStatus" class="cameraStatus">Listo para cámara.</div></div>
          </div>
        </div>
        <div class="card cartPanel"><h3>Carrito</h3><div id="cartItems"><p class="empty">Vacío. Agrega productos para vender.</p></div>
          <div class="formGrid">
            <div class="field"><label>Descuento</label><input id="discount" value="0" inputmode="decimal" /></div>
            <div class="field"><label>Método</label><select id="payMethod"><option value="Efectivo">Efectivo</option><option value="Transferencia">Transferencia</option><option value="Tarjeta">Tarjeta</option><option value="Pendiente">Pendiente</option><option value="Apartado">Apartado</option></select></div>
            <div class="field" id="receivedField" style="display:none;"><label>Efectivo Recibido</label><input id="cashReceived" inputmode="decimal" /></div>
            <div class="field" id="changeField" style="display:none;"><label>Vuelto</label><input id="cashChange" readonly style="background:#111;color:var(--gold);" /></div>
            <div class="field"><label id="lblCustomer">Cliente (opcional)</label><input id="customer" placeholder="Ej. Juan Pérez" /></div>
            <div class="field"><label>Cédula/RUC del Cliente</label><input id="customerCedula" placeholder="Ej. 1712345678" /></div>
            <div class="field"><label id="lblCustomerPhone">Teléfono (WhatsApp)</label><input id="customerPhone" placeholder="Ej. 593969399562" /></div>
            <div class="field" id="layawayDueDateField" style="display:none;"><label>Fecha Límite de Retiro</label><input type="date" id="layawayDueDate" /></div>
            <div class="field full" id="layawayTermsField" style="display:none;"><details class="termsDetails"><summary>Leer terminos del apartado</summary><p>${escapeHtml(layawayTermsText()).replace(/\n/g, '<br>')}</p><small>Estas politicas pertenecen al negocio. CLICK 360 proporciona herramientas de gestion, no asesoria legal.</small></details><label class="consentCheck"><input type="checkbox" id="layawayTermsAccepted"><span>El cliente conoce y acepta estos terminos.</span></label></div>
          </div>
          <div class="cartSummary" style="margin-bottom:10px; font-size:13px; color:var(--muted); text-align:right;">
             <div id="cartSubtotalView" style="display:none; justify-content:space-between; margin-bottom:4px;"><span>Subtotal:</span> <b>$0.00</b></div>
             <div id="cartIvaView" style="display:none; justify-content:space-between;"><span>IVA:</span> <b>$0.00</b></div>
          </div>
          <div class="totalRow">
             <div><small>Total</small><strong id="cartTotal">$0.00</strong></div>
             <div style="display:flex; gap:10px;">
                <button type="button" class="btn silver" id="clearCartBtn" title="Limpiar carrito">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
                <button type="button" class="btn primary" id="chargeBtn">Cobrar</button>
             </div>
          </div>
        </div>
      </section>`;
  }

  function cashView() {
    const openSession = currentOpenCashSession();
    const latestSession = latestCashSession();
    const allMov = movementsForBiz().filter(m=>m.date===today());
    const hasSessionTaggedMovements = !!latestSession
      && allMov.some((movement) => movement.cashSessionId === latestSession.id);
    const mov = hasSessionTaggedMovements
      ? allMov.filter((movement) => movement.cashSessionId === latestSession.id)
      : allMov;
    const aperture=mov.slice().reverse().find(m=>m.kind==='apertura')?.amount || 0;
    const income=mov.filter(isCashIncomeMovement).reduce((a,m)=>a+m.amount,0);
    const expenses=mov.filter(m=>m.kind==='egreso').reduce((a,m)=>a+m.amount,0);
    const compras=mov.filter(m=>m.kind==='compra').reduce((a,m)=>a+m.amount,0);
    const retiros=mov.filter(m=>m.kind==='retiro').reduce((a,m)=>a+m.amount,0);
    const out=expenses+compras+retiros;
    const saldo = aperture + income - out;

    let topCard = '';
    if (!isDayStarted()) {
      topCard = `
       <div class="card" style="text-align:center; padding:24px; margin-bottom:16px; border:1px dashed var(--gold);">
         <h3 style="margin-bottom:8px;">🔑 Iniciar Jornada de Hoy</h3>
         <p style="font-size:13px; color:var(--muted); margin-bottom:16px;">Ingresa el monto de caja inicial con el que ingresa el negocio.</p>
         <div style="max-width:240px; margin: 0 auto 16px;">
            <label style="display:block; text-align:left; font-size:12px; margin-bottom:4px; font-weight:bold;">Monto de Apertura ($)</label>
            <input type="text" id="apertureAmountInput" class="full" style="text-align:center; font-size:18px; font-weight:bold;" placeholder="0.00" value="0.00">
         </div>
         <button class="btn primary block" id="startDayBtnCash" style="width:100%;">Iniciar Día (Apertura)</button>
       </div>
      `;
    } else if (isDayClosed()) {
      topCard = `
       <div class="card" style="text-align:center; padding:24px; margin-bottom:16px; border: 1px solid var(--gold);">
         <h3 style="margin-bottom:8px; color:var(--gold);">🔒 Caja Cerrada</h3>
         <p style="font-size:13px; color:var(--muted); margin-bottom:16px;">La jornada de hoy ha sido cerrada. No se permiten más transacciones.</p>
         <button class="btn primary" id="reopenCashBtn" style="margin: 0 auto; display: inline-flex; align-items: center; gap: 6px;">🔓 Abrir nueva caja diaria</button>
       </div>
      `;
    } else {
      topCard = `
       <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; gap: 10px;">
         <button class="btn primary" id="newMove">＋ Movimiento</button>
         <button class="btn silver" id="closeDayBtn">Cerrar día</button>
       </div>
       <section class="grid cashGrid">
         <div class="card kpi"><small>Caja Inicial</small><strong class="goldText">${fmt(aperture)}</strong></div>
         <div class="card kpi"><small>Ingresos (Ventas)</small><strong class="goldText">${fmt(income)}</strong></div>
         <div class="card kpi"><small>Egresos</small><strong>${fmt(out)}</strong></div>
         <div class="card kpi"><small>Saldo Actual</small><strong class="goldText">${fmt(saldo)}</strong></div>
         <div class="card kpi"><small>Gastos</small><strong>${fmt(expenses)}</strong></div>
         <div class="card kpi"><small>Compras</small><strong>${fmt(compras)}</strong></div>
         <div class="card kpi"><small>Retiros</small><strong>${fmt(retiros)}</strong></div>
       </section>
      `;
    }

    const showMovementsList = isDayStarted();

	    return `<div class="pageHead">
	        <div>
	          <h1>Caja diaria</h1>
	          <p>Ingresos, egresos y cierre del día.</p>
	        </div><div class="toolbar"><button type="button" class="iconBtn" id="calculatorCashBtn" title="Calculadora" aria-label="Abrir calculadora">${icon('calculator')}</button></div>
      </div>
      ${topCard}
      ${showMovementsList ? `
      <section class="card sectionCard" style="margin-top:14px">
         <h3>Movimientos de hoy</h3>
         <div class="movementList">
           ${mov.slice().reverse().map(m=>{
              const isCancelled = m.status === 'cancelled';
              const editDeleteButtons = (authUser().role === 'owner' && !isCancelled) ? `
                <div style="display:flex; gap:6px; margin-top:6px; justify-content:flex-end;">
                  <button class="btn silver" style="padding:2px 8px; font-size:11px; min-height:24px; font-weight:bold;" onclick="window.editMovement('${actionId(m.id)}')">✎ Editar</button>
                  <button class="btn danger" style="padding:2px 8px; font-size:11px; min-height:24px; font-weight:bold;" onclick="window.deleteMovement('${actionId(m.id)}')">🗑 Anular</button>
                </div>
              ` : '';
              const cancelledLabel = isCancelled ? `<br><span style="font-size:11px;color:#ff4d4d;font-weight:bold;">🚫 ANULADO por ${escapeHtml(m.cancelledBy || 'owner')} a las ${escapeHtml(m.cancelledAt || '')}</span>` : '';
              const textStyle = isCancelled ? 'text-decoration: line-through; opacity: 0.5;' : '';
              const amtDisplay = isCancelled ? `<span style="text-decoration:line-through;color:var(--muted);font-weight:normal;font-size:12px;margin-right:6px;">${fmt(m.originalAmount || 0)}</span><span style="color:#ff4d4d;">$0.00</span>` : `<span class="${m.kind==='ingreso'||m.kind==='apertura'?'pos':'neg'}">${m.kind==='ingreso'||m.kind==='apertura'?'+':'−'}${fmt(m.amount)}</span>`;

              return `<div class="movement" style="flex-direction:column; align-items:stretch; gap:4px; padding:10px 0; border-bottom:1px solid var(--line); ${textStyle}">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <span><b>${escapeHtml(labelKind(m.kind))}</b><br><small>${escapeHtml(m.note||'')}</small>${cancelledLabel}<br><span style="font-size:10px;color:var(--gold);opacity:0.8;">🧑‍💻 ${escapeHtml(m.createdBy||m.user||'Sistema')} • 🕒 ${escapeHtml(m.when || m.date || '')}</span></span>
                  <div style="text-align:right; font-weight:bold;">
                    ${amtDisplay}
                  </div>
                </div>
                ${editDeleteButtons}
              </div>`;
           }).join('') || '<p class="empty">No hay movimientos.</p>'}
         </div>
      </section>
      ` : ''}
      <section class="card sectionCard" style="margin-top:14px"><h3>Historial de Cierres</h3><div class="movementList">
	         ${(state.dailyReports || []).filter(r=>r.businessId===currentBusiness().id).slice().reverse().slice(0,5).map(r=>`<div class="movement"><span>Cierre ${escapeHtml(r.date)} ${r.status === 'reopened' ? '<span class="badge gold">Reabierto</span>' : ''}<br><small>Caja F.: ${fmt(r.closeCash)}${r.reopenReason ? ' · Motivo: ' + escapeHtml(r.reopenReason) : ''}</small></span><button class="btn silver" onclick="window.viewDailyReport('${actionId(r.id)}')">Ver Imagen</button></div>`).join('') || '<p class="empty">No hay cierres previos.</p>'}
      </div></section>`;
  }
  function labelKind(k){ return ({apertura:'Apertura',ingreso:'Ingreso',egreso:'Gasto',compra:'Compra',retiro:'Retiro'})[k]||k; }

  function buildChartHtml(sales) {
     const last7Days = [];
     for(let i=6; i>=0; i--) {
       const d = new Date(); d.setDate(d.getDate() - i);
       const pad = (n) => n.toString().padStart(2, '0');
       last7Days.push(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`);
     }
     const salesByDay = {};
     last7Days.forEach(d => salesByDay[d] = 0);
     sales.filter(s=>s.status!=='cancelled').forEach(s => {
       if (salesByDay[s.date] !== undefined) {
	       salesByDay[s.date] += collectedAmount(s);
       }
     });

     const vals = last7Days.map(d => salesByDay[d]);
     const max = Math.max(...vals, 1);

     const width = 300;
     const height = 120;
     const padX = 20;
     const padY = 25;
     const chartW = width - padX * 2;
     const chartH = height - padY * 1.5;

     const points = vals.map((val, i) => {
         const x = padX + (i / 6) * chartW;
         const y = padY + chartH - ((val / max) * chartH);
         return {x, y, val, d: last7Days[i]};
     });

     let pathD = `M ${points[0].x} ${points[0].y}`;
     for(let i=0; i<points.length - 1; i++) {
         const p0 = points[i];
         const p1 = points[i+1];
         const cp1x = p0.x + (p1.x - p0.x) / 2;
         const cp2x = cp1x;
         pathD += ` C ${cp1x} ${p0.y}, ${cp2x} ${p1.y}, ${p1.x} ${p1.y}`;
     }

     const fillPathD = pathD + ` L ${points[points.length-1].x} ${height} L ${points[0].x} ${height} Z`;

     const circlesHtml = points.map(p => `
       <g class="chart-point-group" transform="translate(${p.x}, ${p.y})">
         <circle cx="0" cy="0" r="4" fill="var(--gold)" stroke="#111" stroke-width="2" />
         <!-- hitbox invisible -->
         <rect x="-15" y="-20" width="30" height="40" fill="transparent" style="cursor:pointer;" />
         <g class="chart-tooltip" style="opacity:0; pointer-events:none; transition:0.2s;">
            <rect x="-25" y="-32" width="50" height="20" rx="4" fill="#222" stroke="var(--gold)" stroke-width="1"/>
            <text x="0" y="-18" fill="#fff" font-size="9" text-anchor="middle" font-family="monospace">${fmt(p.val)}</text>
         </g>
       </g>
     `).join('');

     const daysHtml = points.map(p => `
       <text x="${p.x}" y="${height - 4}" fill="var(--muted)" font-size="9" text-anchor="middle">${p.d.slice(-2)}</text>
     `).join('');

     return `
       <div style="position:relative; width:100%; overflow:hidden; background:rgba(255,255,255,0.02); border-radius:12px; border: 1px solid var(--line); margin-bottom:8px;">
         <style>
           .chart-point-group:hover .chart-tooltip { opacity: 1 !important; transform: translateY(-4px); }
           .chart-point-group:active .chart-tooltip { opacity: 1 !important; transform: translateY(-4px); }
         </style>
         <svg viewBox="0 0 ${width} ${height}" style="width:100%; height:auto; display:block; overflow:visible;">
            <defs>
              <linearGradient id="curveGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--gold)" stop-opacity="0.3" />
                <stop offset="100%" stop-color="var(--gold)" stop-opacity="0.0" />
              </linearGradient>
            </defs>
            <path d="${fillPathD}" fill="url(#curveGradient)" />
            <path d="${pathD}" fill="none" stroke="var(--gold)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
            <line x1="${padX}" y1="${padY}" x2="${width-padX}" y2="${padY}" stroke="var(--line)" stroke-dasharray="2 4" />
            <line x1="${padX}" y1="${padY + chartH/2}" x2="${width-padX}" y2="${padY + chartH/2}" stroke="var(--line)" stroke-dasharray="2 4" />
            ${daysHtml}
            ${circlesHtml}
         </svg>
       </div>
       <div style="text-align:center; font-size:12px; color:var(--muted);">Curva de Crecimiento - Últimos 7 Días</div>
     `;
  }

  function labelStatus(s) {
    if(s==='paid')return'Pagado';
    if(s==='pending_payment')return'Por cobrar';
    if(s==='layaway')return'Apartado';
    if(s==='cancelled')return'Anulado';
    return s;
  }

	  function reportsView() {
	    state.reportsFrom = state.reportsFrom || today();
	    state.reportsTo = state.reportsTo || today();
	    const allSales = salesForBiz();
	    const sales = allSales.filter(s => s.date >= state.reportsFrom && s.date <= state.reportsTo);
	    const validSales = sales.filter(s => s.status !== 'cancelled');
	    const tickets=validSales.length;
	    const soldTotal=validSales.reduce((a,s)=>a+(Number(s.total)||0),0);
	    const collectedTotal=validSales.reduce((a,s)=>a+collectedAmount(s),0);
	    const pendingTotal=validSales.reduce((a,s)=>a+Number(s.balance || 0),0);
	    const counts={}; validSales.forEach(s=>saleItems(s).forEach(i=>counts[i.name]=(counts[i.name]||0)+i.qty));
	    const top=Object.entries(counts).sort((a,b)=>b[1]-a[1]);
    return `<div class="pageHead"><div><h1>Reportes</h1><p>Resumen general de tu negocio.</p></div>
        <div style="display:flex; gap:8px;">
	          <button class="btn silver" onclick="window.printReports('print')">Imprimir</button>
	          <button class="btn silver" onclick="window.printReports('pdf')">Guardar PDF</button>
	          <button class="btn primary" onclick="window.printReports('image')">Descargar Imagen</button>
        </div>
      </div>
      <div class="card sectionCard reportRangeCard">
        <div class="field full" style="margin:0;"><label>Desde</label><input type="date" id="repFrom" value="${safeDateInputValue(state.reportsFrom)}"></div>
        <div class="field full" style="margin:0;"><label>Hasta</label><input type="date" id="repTo" value="${safeDateInputValue(state.reportsTo)}"></div>
      </div>
	      <section class="grid cashGrid"><div class="card kpi"><small>Vendido</small><strong class="goldText">${fmt(soldTotal)}</strong></div><div class="card kpi"><small>Cobrado</small><strong class="goldText">${fmt(collectedTotal)}</strong></div><div class="card kpi"><small>Pendiente</small><strong>${fmt(pendingTotal)}</strong></div><div class="card kpi"><small>Tickets</small><strong>${tickets}</strong></div><div class="card kpi"><small>Promedio cobrado</small><strong>${fmt(tickets?collectedTotal/tickets:0)}</strong></div></section>
      <section class="card sectionCard" style="margin-top:14px"><h3>Crecimiento</h3>${buildChartHtml(sales)}</section>
      <section class="card sectionCard" style="margin-top:14px"><h3>Más vendidos</h3>${top.map(([n,c])=>`<div class="movement"><span>${escapeHtml(n)}</span><b class="goldText">${c}</b></div>`).join('') || '<p class="empty">Sin ventas.</p>'}</section>
      <section class="card sectionCard" style="margin-top:14px"><h3>Historial</h3>
        ${sales.slice().reverse().map(s=>`
        <div class="movement" style="flex-direction:column; gap:8px;">
          <div style="display:flex; justify-content:space-between; width:100%;">
             <span>${escapeHtml(s.when)}<br>
	               <small>${saleItems(s).length} items · ${escapeHtml(s.method)} ${s.customer?'· '+escapeHtml(s.customer):''}</small><br>
               <span class="badge ${s.status==='cancelled'?'danger':'gold'}">${s.status==='cancelled'?'Anulada':s.status==='pending_payment'?'Pendiente':s.status==='layaway'?'Apartado':'Pagada'}</span>
               <br><small style="font-size:10px;color:var(--gold);">🧑‍💻 ${escapeHtml(s.createdBy||'Sistema')}</small>
             </span>
             <b class="${s.status==='cancelled'?'neg':'goldText'}">${fmt(s.total)}</b>
          </div>
          <div style="display:flex; gap:8px; justify-content:flex-end; width:100%; flex-wrap:wrap; margin-top:6px;">
            <button class="btn silver" style="min-height:32px; padding:6px 12px; font-size:12px;" onclick="window.printReceipt('${actionId(s.id)}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg> Ticket
            </button>
            ${s.status!=='cancelled' ? `<button class="btn danger" style="min-height:32px; padding:6px 12px; font-size:12px;" onclick="window.cancelSale('${actionId(s.id)}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg> Anular
            </button>` : ''}
          </div>
        </div>`).join('') || '<p class="empty">Sin ventas.</p>'}
      </section>`;
  }

  function debtorsView() {
    const pendings = salesForBiz().filter(s=>s.status==='layaway' || s.status==='pending_payment');
    const layaways = (state.layaways || []).filter((item) => item.businessId === currentBusiness().id && !['cancelled','refunded','picked_up'].includes(item.status));
    const totalPending = pendings.reduce((a,s)=>a+(s.balance||0),0);
    return `<div class="pageHead"><div><h1>Por Cobrar</h1><p>Apartados y deudas pendientes.</p></div></div>
      <section class="grid cashGrid"><div class="card kpi"><small>Saldo en la calle</small><strong class="goldText">${fmt(totalPending)}</strong></div><div class="card kpi"><small>Cuentas activas</small><strong>${pendings.length}</strong></div></section>
      <section class="card sectionCard" style="margin-top:14px"><h3>Listado de Pendientes</h3>
        ${pendings.slice().reverse().map(s=>`
        <div class="movement" style="flex-direction:column; gap:8px;">
          <div style="display:flex; justify-content:space-between; width:100%;">
             <span>${escapeHtml(s.customer || 'Cliente sin nombre')} <br>
               <small>${escapeHtml(s.when)} · ${Math.floor((new Date()-new Date(s.date))/(1000*60*60*24))} días transcurridos</small><br>
               <span class="badge ${s.status==='layaway'?'gold':'danger'}">${s.status==='layaway'?'Apartado':'Pendiente'}</span>
             </span>
             <div style="text-align:right;">
                <b class="neg">${fmt(s.balance)}</b><br>
                <small>de ${fmt(s.total)}</small>
             </div>
          </div>
          <div style="display:flex; gap:8px; justify-content:flex-end; width:100%; flex-wrap:wrap; margin-top:6px;">
            ${s.customerPhone ? `
            <button class="btn" style="min-height:32px; padding:6px 12px; font-size:12px; border:1px solid #25D366; color:#25D366; background:transparent;" onclick="window.sendWhatsAppReminder('${actionId(s.id)}')">
               💬 Recordatorio
            </button>` : ''}
            <button class="btn silver" style="min-height:32px; padding:6px 12px; font-size:12px;" onclick="window.printReceipt('${actionId(s.id)}')">
               Ticket
            </button>
            <button class="btn primary" style="min-height:32px; padding:6px 12px; font-size:12px;" onclick="window.payLayaway('${actionId(s.id)}')">
               Abonar
            </button>
          </div>
        </div>`).join('') || '<p class="empty">No hay apartados ni deudas pendientes.</p>'}
      </section>
      <section class="card sectionCard" style="margin-top:14px"><h3>Retiros de apartados</h3>${layaways.map((layaway) => { const status = window.CLICK360_V16_DOMAIN?.layawayStatus(layaway) || layaway.status; return `<div class="movement"><span><b>${escapeHtml(layaway.customerSnapshot?.name || 'Cliente')}</b><br><small>${escapeHtml(window.CLICK360_V16_DOMAIN?.formatBusinessDate(layaway.pickupDueAt ? `${layaway.pickupDueAt}T12:00:00` : '', 'es-EC', businessTimeZone(), false) || layaway.pickupDueAt || 'Sin fecha')}</small><br><span class="badge gold">${escapeHtml(status)}</span></span><div class="reminderActions">${status === 'paid' ? `<button class="btn silver" onclick="window.markLayawayStatus('${actionId(layaway.id)}','ready_for_pickup')">Listo para retiro</button>` : ''}${['paid','ready_for_pickup'].includes(status) ? `<button class="btn primary" onclick="window.markLayawayStatus('${actionId(layaway.id)}','picked_up')">Entregado</button>` : ''}</div></div>`; }).join('') || '<p class="empty">No hay retiros pendientes.</p>'}</section>`;
  }

  window.markLayawayStatus = function(layawayId, nextStatus) {
	  layawayId = decodeActionId(layawayId);
	  if (!['ready_for_pickup','picked_up'].includes(nextStatus)) return;
	  const layaway = state.layaways?.find((item) => item.id === layawayId && item.businessId === currentBusiness().id);
	  if (!layaway) return toast('Apartado no encontrado.', 'err');
	  if (nextStatus === 'picked_up' && !confirm('Confirma que el cliente recibio todos los productos reservados.')) return;
	  layaway.status = nextStatus;
	  layaway.updatedAt = new Date().toISOString();
	  if (nextStatus === 'picked_up') layaway.pickedUpAt = layaway.updatedAt;
	  addAudit('layaway_status_updated', { layawayId, saleId: layaway.saleId, status: nextStatus });
	  if (!save()) return;
	  renderApp('debtors');
	  toast(nextStatus === 'picked_up' ? 'Entrega registrada' : 'Apartado listo para retiro');
	};

			  function purchaseWhatsAppUrl() {
	    const plan = accessInfo().plan || 'base';
	    return `https://wa.me/593969399562?text=${encodeURIComponent(`Hola CLICK 360, quiero activar mi plan ${plan}. Negocio: ${currentBusiness()?.name || ''}. Correo: ${authUser()?.email || ''}.`)}`;
		  }
		  function trialCountdown() {
		    return window.CLICK360_V16_DOMAIN?.trialRemaining?.(accessInfo(), Date.now())
		      || { days: 0, hours: 0, endsAtMs: 0, expired: true };
		  }
		  function trialCountdownText(remaining = trialCountdown()) {
		    return `${remaining.days} ${remaining.days === 1 ? 'día' : 'días'} y ${remaining.hours} ${remaining.hours === 1 ? 'hora' : 'horas'}`;
		  }
		  function trialEndText(remaining = trialCountdown()) {
		    if (!remaining.endsAtMs) return '';
		    return window.CLICK360_V16_DOMAIN?.formatBusinessDate?.(remaining.endsAtMs, 'es-EC', businessTimeZone(), true) || '';
		  }
		  function updateTrialCountdown() {
		    const remaining = trialCountdown();
		    $$('[data-trial-countdown]').forEach((element) => { element.textContent = trialCountdownText(remaining); });
		    $$('[data-trial-end]').forEach((element) => { element.textContent = trialEndText(remaining); });
		  }
		  function accessBannerHtml() {
	    const access = accessInfo();
	    if (access.mode === 'founder') return `<section class="card sectionCard" style="margin:0 0 14px;border-color:rgba(55,213,126,.35);"><b style="color:#37d57e;">Acceso fundador activo</b><p style="margin:6px 0 0;color:var(--muted);font-size:13px;">Tu cuenta conserva acceso completo a CLICK 360.</p></section>`;
		    if (access.mode === 'trial_active' || access.mode === 'trial') {
		      const remaining = trialCountdown();
		      return `<section class="card sectionCard" style="margin:0 0 14px;border-color:rgba(244,196,49,.45);"><b style="color:var(--gold);">Prueba gratuita: <span data-trial-countdown>${escapeHtml(trialCountdownText(remaining))}</span> restantes</b><p style="margin:6px 0 0;color:var(--muted);font-size:13px;">Finaliza el <span data-trial-end>${escapeHtml(trialEndText(remaining))}</span>. Tus datos se conservarán al terminar.</p></section>`;
	    }
	    if (access.readOnly) return `<section class="card sectionCard" style="margin:0 0 14px;border-color:rgba(255,92,98,.6);"><b style="color:#ff8d92;">Tu prueba termino: tus datos estan protegidos en modo lectura.</b><a href="${escapeHtml(purchaseWhatsAppUrl())}" target="_blank" rel="noopener noreferrer" class="btn primary block" style="margin-top:10px;">Activar plan por WhatsApp</a></section>`;
		    return `<section class="card sectionCard" style="margin:0 0 14px;border-color:rgba(55,213,126,.35);"><b style="color:#37d57e;">Plan CLICK 360 activo</b><p style="margin:6px 0 0;color:var(--muted);font-size:13px;">Plan ${escapeHtml((access.plan || 'base').toUpperCase())} con acceso completo.</p></section>`;
	  }
	  function accessView() {
	    const access = accessInfo();
	    const catalog = window.CLICK360_V16_DOMAIN?.PLAN_CATALOG || {};
	    const requests = state.settings?.activationRequests || [];
	    const labels = { founder: 'Fundador', trial: 'Prueba gratuita', trial_active: 'Prueba gratuita', trial_expired: 'Modo lectura', paid_base: 'Plan Base', paid_pro: 'Plan Pro', lifetime: 'Acceso de por vida', member: 'Trabajador' };
	    const periodOptions = (code) => `<option value="month">1 mes</option><option value="quarter">3 meses</option><option value="semester">6 meses</option><option value="year">1 año</option>${code === 'base' ? '<option value="lifetime">De por vida</option>' : ''}`;
	    const basePrices = catalog.base?.prices || {};
	    const planPriceSummary = (code) => code === 'base' ? `<div class="planPriceSummary neuroPrice" aria-label="Precios Plan Base">
	      <div class="neuPlanTier">
	        <div class="neuTierLabel muted">Mensual</div>
	        <div class="neuTierPrice"><s class="neuStrike">${fmt(basePrices.month || 40)}/mes</s></div>
	        <div class="neuTierNote muted">Precio regular</div>
	      </div>
	      <div class="neuPlanTier neuStar">
	        <div class="neuBadge">⭐ AHORRA 50%</div>
	        <div class="neuTierLabel">Anual — Más elegido</div>
	        <div class="neuTierPrice"><b class="neuBig">${fmt((basePrices.year || 240)/12)}<small>/mes</small></b></div>
	        <div class="neuTierNote">${fmt(basePrices.year || 240)} al año · un solo pago</div>
	      </div>
	      <div class="neuPlanTier">
	        <div class="neuTierLabel muted">Vitalicio</div>
	        <div class="neuTierPrice"><b>${fmt(basePrices.lifetime || 600)}</b></div>
	        <div class="neuTierNote muted">Pago único · para siempre</div>
	      </div>
	      <p class="neuCopy">🚀 El 87% de nuestros clientes elige el plan anual</p>
	    </div>` : '';
	    return `<div class="pageHead"><div><h1>Mi plan</h1><p>Acceso, funciones y activacion.</p></div></div>
	      ${accessBannerHtml()}
	      <section class="card sectionCard"><h3>${escapeHtml(labels[access.mode] || `Plan ${(access.plan || 'base').toUpperCase()}`)}</h3>
	        <p class="cloudStatus">${access.mode === 'trial_active' ? 'Dispones de todas las funciones Base durante siete dias.' : access.readOnly ? 'Puedes consultar tu informacion; la edicion se habilita al activar un plan.' : 'Tu acceso esta activo.'}</p>
	      </section>
	      <section class="planGrid" style="margin-top:14px;">
	        ${['base','pro'].map((code) => { const item = catalog[code] || {}; return `<article class="card planCard"><div><span class="badge gold">${escapeHtml(code.toUpperCase())}</span><h3>${escapeHtml(item.name || code)}</h3><strong>${fmt(item.prices?.month || 0)} <small>/ mes</small></strong>${planPriceSummary(code)}</div><ul>${(item.features || []).map((feature) => `<li>${escapeHtml(feature)}</li>`).join('')}</ul><label class="field"><span>Periodo</span><select data-plan-period="${code}">${periodOptions(code)}</select></label><button class="btn ${code === 'pro' ? 'primary' : 'silver'} block" data-request-plan="${code}">Solicitar ${escapeHtml(item.name || code)}</button></article>`; }).join('')}
	      </section>
	      <section class="card printerOfferCard"><div><span class="badge gold">Equipo opcional</span><h3>Impresora térmica de etiquetas</h3><p>Lista para etiquetas QR y comprobantes; incluye envío y un rollo de papel adhesivo de cortesía.</p></div><strong>${fmt(65)}</strong><a class="btn primary" target="_blank" rel="noopener noreferrer" href="https://wa.me/593969399562?text=${encodeURIComponent('Hola CLICK 360, quiero información sobre la impresora térmica de etiquetas de $65.')}">Consultar por WhatsApp</a></section>
	      ${requests.length ? `<section class="card sectionCard" style="margin-top:14px;"><h3>Solicitudes</h3>${requests.slice().reverse().map((request) => `<div class="movement"><span><b>${escapeHtml(String(request.plan || '').toUpperCase())}</b><br><small>${escapeHtml(request.requestCode || '')} · ${escapeHtml(request.period || '')}</small></span><span class="badge gold">${escapeHtml(request.status === 'pending' ? 'Pendiente' : request.status || 'Pendiente')}</span></div>`).join('')}</section>` : ''}
	      ${access.mode !== 'founder' ? `<a href="${escapeHtml(purchaseWhatsAppUrl())}" target="_blank" rel="noopener noreferrer" class="btn block" style="margin-top:14px;border:1px solid #25D366;color:#25D366;background:transparent;">Hablar con CLICK 360 por WhatsApp</a>` : ''}`;
	  }
	  function legalView() {
	    const version = window.CLICK360_V16_DOMAIN?.TERMS_VERSION || '2026-07-13';
	    return `<div class="pageHead"><div><h1>Terminos y privacidad</h1><p>Version ${escapeHtml(version)}</p></div></div><section class="legalDocument">
	      <article><h2>Terminos y condiciones</h2><p>CLICK 360 proporciona herramientas para administrar inventario, ventas, caja, clientes y tareas del negocio. La persona titular de la cuenta es responsable de la exactitud de la informacion registrada y del uso que autorice a sus trabajadores.</p></article>
		      <article><h2>Privacidad y datos</h2><p>La autenticación se realiza con Google y los datos operativos se guardan de forma separada para cada cuenta. CLICK 360 no vende información personal. El negocio puede descargar respaldos y solicitar asistencia para exportación o eliminación.</p></article>
	      <article><h2>Prueba y suscripciones</h2><p>La prueba gratuita dura siete días desde la hora registrada de forma segura y se concede una sola vez por cuenta. Al terminar, los datos se conservan en modo lectura. La activación es manual y no se realizan cobros automáticos dentro de la aplicación.</p></article>
		      <article><h2>Uso aceptable</h2><p>No se permite intentar acceder a información de otra cuenta, elevar permisos, manipular invitaciones, introducir contenido malicioso ni usar CLICK 360 para actividades ilegales.</p></article>
	      <article><h2>Uso sin conexión</h2><p>Cuando el dispositivo permite almacenamiento seguro, la aplicación conserva una copia local aislada. Si el navegador bloquea ese almacenamiento, CLICK 360 trabaja solo en línea y pausa la edición cuando se pierde la conexión.</p></article>
	      <article><h2>Politicas del comercio</h2><p>Las politicas configuradas por cada negocio deben revisarse conforme a la legislacion aplicable. CLICK 360 proporciona herramientas de gestion, no asesoria legal.</p></article>
	      <article><h2>Responsabilidades</h2><p>Los comprobantes y reportes son registros operativos. No sustituyen documentos tributarios oficiales, asesoria contable ni asesoramiento legal. Antes de una accion destructiva se recomienda generar y verificar un respaldo.</p></article>
	    </section>`;
	  }
	  function crmCustomers() {
	    const businessId = currentBusiness()?.id;
      const legacyBusinessId = state.settings?.legacyDataBusinessId;
	    return (state.settings?.customers || []).filter((customer) => customer.businessId === businessId
        || (!customer.businessId && legacyBusinessId === businessId));
	  }
	  function crmView() {
	    const customers = crmCustomers();
	    return `<div class="pageHead"><div><h1>Clientes</h1><p>Seguimiento de clientes y contacto por WhatsApp.</p></div><div class="toolbar"><button class="btn primary" id="newCustomerBtn">Nuevo cliente</button></div></div>
	      <section class="card sectionCard"><div class="field"><label>Buscar</label><input id="customerSearch" placeholder="Nombre o telefono"></div><div id="customerList">${customerCards(customers)}</div></section>`;
	  }
	  function customerCards(customers) {
	    if (!customers.length) return '<p class="empty">Todavia no hay clientes registrados.</p>';
	    return customers.map((customer) => {
	      const phone = window.CLICK360_V16_DOMAIN?.normalizePhone(customer.phone || '') || '';
	      return `<article class="movement" style="align-items:flex-start;gap:10px;"><div style="flex:1;"><b>${escapeHtml(customer.name || 'Cliente')}</b>${customer.businessId ? '' : ' <span class="badge gold">Histórico por confirmar</span>'}<br><small>${escapeHtml(customer.phone || 'Sin telefono')}${customer.notes ? ` - ${escapeHtml(customer.notes)}` : ''}</small></div><div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">${phone ? `<a class="btn silver" style="min-height:30px;padding:5px 9px;font-size:12px;" target="_blank" rel="noopener noreferrer" href="https://wa.me/${escapeHtml(phone)}">WhatsApp</a>` : ''}<button class="btn silver" style="min-height:30px;padding:5px 9px;font-size:12px;" data-customer-edit="${actionId(customer.id)}">Editar</button><button class="btn danger" style="min-height:30px;padding:5px 9px;font-size:12px;" data-customer-delete="${actionId(customer.id)}">Eliminar</button></div></article>`;
	    }).join('');
	  }
	  function openCustomerModal(customerId = '') {
	    const customer = crmCustomers().find((item) => item.id === customerId) || { id: '', name: '', phone: '', notes: '' };
	    showModal(`<div class="modalHeader"><h2>${customer.id ? 'Editar' : 'Nuevo'} cliente</h2><button class="closeBtn" data-close>×</button></div><form id="customerForm" class="formGrid"><div class="field"><label>Nombre</label><input id="customerName" required value="${escapeHtml(customer.name)}"></div><div class="field"><label>Telefono / WhatsApp</label><input id="customerPhoneCrm" inputmode="tel" value="${escapeHtml(customer.phone)}" placeholder="593999999999"></div><div class="field full"><label>Notas</label><input id="customerNotes" value="${escapeHtml(customer.notes)}"></div><button class="btn primary block" type="submit">Guardar cliente</button></form>`);
	    $('#customerForm').onsubmit = (event) => {
	      event.preventDefault();
	      const name = $('#customerName').value.trim();
	      if (!name) return toast('Ingresa el nombre del cliente.', 'err');
	      state.settings.customers ||= [];
	      const next = { id: customer.id || uid('customer'), businessId: currentBusiness().id, name, phone: $('#customerPhoneCrm').value.trim(), notes: $('#customerNotes').value.trim(), updatedAt: new Date().toISOString() };
	      const index = state.settings.customers.findIndex((item) => item.id === next.id);
	      if (index >= 0) state.settings.customers[index] = next;
	      else state.settings.customers.push(next);
	      if (!save()) return;
	      closeModal(); renderApp('crm'); toast('Cliente guardado');
	    };
	  }
	  function remindersForBusiness() {
	    const businessId = currentBusiness()?.id;
      const legacyBusinessId = state.settings?.legacyDataBusinessId;
	    return (state.settings?.reminders || []).filter((reminder) => reminder.businessId === businessId
        || (!reminder.businessId && legacyBusinessId === businessId));
	  }
	  function notificationItems() {
	    const readById = new Map((state.notifications || []).map((item) => [item.id, item]));
	    const now = Date.now();
	    const reminders = remindersForBusiness().filter((reminder) => !reminder.done && !['completed','cancelled'].includes(reminder.status)).map((reminder) => {
	      const dueMs = Date.parse(reminder.dueAt || '');
	      return {
	        id: `reminder:${reminder.id}`,
	        type: reminder.type || 'task',
	        title: reminder.title || 'Recordatorio',
		        detail: Number.isFinite(dueMs) ? `${dueMs < now ? 'Vencido' : 'Proximo'} · ${window.CLICK360_V16_DOMAIN?.formatBusinessDate(reminder.dueAt, 'es-EC', businessTimeZone(), true) || reminder.dueAt}` : 'Sin fecha',
		        route: 'reminders',
		        dueAt: reminder.dueAt || '',
		        priority: Number.isFinite(dueMs) && dueMs < now ? 'Alta' : 'Media',
		        status: Number.isFinite(dueMs) && dueMs < now ? 'Vencida' : 'Próxima',
		        overdue: Number.isFinite(dueMs) && dueMs < now,
	        read: !!readById.get(`reminder:${reminder.id}`)?.readAt
	      };
	    });
	    const stock = productsForBiz().filter((product) => Number(product.qty || 0) <= Number(product.lowStockThreshold ?? 3)).map((product) => ({
	      id: `stock:${product.id}`,
	      type: 'low_stock',
	      title: `Stock bajo: ${product.name}`,
		      detail: `${product.qty} disponible${Number(product.qty) === 1 ? '' : 's'}`,
		      route: 'inventory',
		      dueAt: product.updatedAt || '',
		      priority: Number(product.qty) <= 0 ? 'Alta' : 'Media',
		      status: Number(product.qty) <= 0 ? 'Agotado' : 'Stock bajo',
	      overdue: Number(product.qty) <= 0,
	      read: !!readById.get(`stock:${product.id}`)?.readAt
	    }));
	    return [...reminders, ...stock].sort((a, b) => Number(b.overdue) - Number(a.overdue));
	  }
		  function openNotificationCenter() {
		    const items = notificationItems();
		    showModal(`<div class="modalHeader"><div><h2>Notificaciones</h2><p class="fieldHint">${items.filter((item) => !item.read).length} sin leer</p></div><button class="closeBtn" data-close>×</button></div><div class="notificationList">${items.length ? items.map((item) => `<button type="button" class="notificationItem ${item.read ? 'read' : ''} ${item.overdue ? 'overdue' : ''}" data-notification-route="${item.route}" data-notification-id="${actionId(item.id)}"><span class="notificationGlyph">${icon(item.type === 'low_stock' ? 'package-minus' : item.type === 'collection' ? 'hand-coins' : 'alarm-clock')}</span><span class="notificationBody"><span><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.detail)}</small></span><span class="notificationMeta"><em>${escapeHtml(item.status)}</em><small>Prioridad ${escapeHtml(item.priority)}</small><small>${item.read ? 'Leída' : 'Nueva'}</small></span></span>${icon('chevron-right')}</button>`).join('') : `<div class="empty">${icon('bell-off')}<p>No tienes alertas pendientes.</p></div>`}</div>${items.some((item) => !item.read) ? `<button type="button" class="btn silver block" id="markNotificationsRead">${icon('check-check')} Marcar todas como leídas</button>` : ''}`);
	    $$('[data-notification-route]').forEach((button) => button.onclick = () => {
	      const id = decodeActionId(button.dataset.notificationId);
	      state.notifications ||= [];
	      const existing = state.notifications.find((item) => item.id === id);
	      if (existing) existing.readAt = new Date().toISOString();
	      else state.notifications.push({ id, businessId: currentBusiness().id, readAt: new Date().toISOString() });
	      save();
	      closeModal();
	      renderApp(button.dataset.notificationRoute);
	    });
	    $('#markNotificationsRead')?.addEventListener('click', () => {
	      state.notifications ||= [];
	      const now = new Date().toISOString();
	      items.forEach((item) => {
	        const existing = state.notifications.find((record) => record.id === item.id);
	        if (existing) existing.readAt = now;
	        else state.notifications.push({ id: item.id, businessId: currentBusiness().id, readAt: now });
	      });
	      if (!save()) return;
	      closeModal();
	      renderApp(route);
	    });
	  }
	  function remindersView() {
	    const reminders = remindersForBusiness().slice().sort((a, b) => String(a.dueAt || '').localeCompare(String(b.dueAt || '')));
	    return `<div class="pageHead"><div><h1>Recordatorios</h1><p>Alertas de seguimiento para clientes y negocio.</p></div><div class="toolbar"><button class="btn primary" id="newReminderBtn">Nuevo recordatorio</button></div></div><section class="card sectionCard"><div id="reminderList">${reminderCards(reminders)}</div></section>`;
	  }
	  function reminderCards(reminders) {
	    if (!reminders.length) return '<p class="empty">No hay recordatorios pendientes.</p>';
	    return reminders.map((reminder) => {
	      const customer = crmCustomers().find((item) => item.id === reminder.customerId);
	      const phone = window.CLICK360_V16_DOMAIN?.normalizePhone(reminder.phone || customer?.phone || '') || '';
	      const message = `Hola ${customer?.name || reminder.customerName || ''}, te recordamos un saldo pendiente de ${fmt(reminder.amount || 0)} con ${currentBusiness()?.name || ''}. Fecha acordada: ${window.CLICK360_V16_DOMAIN?.formatBusinessDate(reminder.dueAt, 'es-EC', businessTimeZone(), true) || reminder.dueAt}.`;
	      return `<article class="movement reminderCard"><div style="flex:1;"><div><span class="badge">${escapeHtml(reminder.type || 'tarea')}</span> <b>${escapeHtml(reminder.title || 'Recordatorio')}</b></div><small>${escapeHtml(reminder.dueAt ? (window.CLICK360_V16_DOMAIN?.formatBusinessDate(reminder.dueAt, 'es-EC', businessTimeZone(), true) || new Date(reminder.dueAt).toLocaleString('es-EC')) : 'Sin fecha')}${reminder.notes ? ` · ${escapeHtml(reminder.notes)}` : ''}</small>${customer ? `<small>${escapeHtml(customer.name)}${reminder.amount ? ` · ${fmt(reminder.amount)}` : ''}</small>` : ''}</div><div class="reminderActions">${phone ? `<a class="btn whatsapp" target="_blank" rel="noopener noreferrer" href="https://wa.me/${escapeHtml(phone)}?text=${encodeURIComponent(message)}">Cobrar por WhatsApp</a>` : ''}<button class="btn silver" data-reminder-edit="${actionId(reminder.id)}">Editar</button>${reminder.done || reminder.status === 'completed' ? '<span class="badge">Hecho</span>' : `<button class="btn silver" data-reminder-postpone="${actionId(reminder.id)}">Posponer</button><button class="btn primary" data-reminder-done="${actionId(reminder.id)}">Completar</button>`}<button class="iconBtn danger" title="Eliminar" aria-label="Eliminar recordatorio" data-reminder-delete="${actionId(reminder.id)}">&#128465;</button></div></article>`;
	    }).join('');
	  }
	  function openReminderModal(reminderId = '') {
	    const reminder = state.settings.reminders?.find((item) => item.id === reminderId) || {};
	    const dueValue = reminder.dueAt ? new Date(new Date(reminder.dueAt).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
	    const dueDateValue = dueValue ? dueValue.slice(0, 10) : '';
	    const dueTimeValue = dueValue ? dueValue.slice(11, 16) : '09:00';
	    const customers = crmCustomers();
	    showModal(`<div class="modalHeader"><h2>${reminder.id ? 'Editar' : 'Nuevo'} recordatorio</h2><button class="closeBtn" data-close>×</button></div><form id="reminderForm" class="formGrid reminderForm"><div class="field"><label>Tipo</label><select id="reminderType"><option value="collection" ${reminder.type === 'collection' ? 'selected' : ''}>Cobrar cliente</option><option value="layaway" ${reminder.type === 'layaway' ? 'selected' : ''}>Apartado</option><option value="low_stock" ${reminder.type === 'low_stock' ? 'selected' : ''}>Inventario bajo</option><option value="supplier" ${reminder.type === 'supplier' ? 'selected' : ''}>Proveedor</option><option value="invoice" ${reminder.type === 'invoice' ? 'selected' : ''}>Factura</option><option value="task" ${!reminder.type || reminder.type === 'task' ? 'selected' : ''}>Tarea</option><option value="follow_up" ${reminder.type === 'follow_up' ? 'selected' : ''}>Seguimiento</option><option value="cash" ${reminder.type === 'cash' ? 'selected' : ''}>Caja</option></select></div><div class="field"><label>Titulo</label><input id="reminderTitle" required value="${escapeHtml(reminder.title || '')}" placeholder="Ej. Llamar a cliente"></div><div class="field full reminderDueField"><label>Fecha y hora</label><div class="reminderDueGrid"><input id="reminderDueDate" type="date" required value="${escapeHtml(dueDateValue)}" aria-label="Fecha del recordatorio"><input id="reminderDueTime" type="time" required value="${escapeHtml(dueTimeValue)}" aria-label="Hora del recordatorio"></div></div><div class="field"><label>Cliente</label><select id="reminderCustomer"><option value="">Sin cliente</option>${customers.map((customer) => `<option value="${escapeHtml(customer.id)}" ${customer.id === reminder.customerId ? 'selected' : ''}>${escapeHtml(customer.name)}</option>`).join('')}</select></div><div class="field"><label>Monto</label><input id="reminderAmount" inputmode="decimal" value="${numericInputValue(reminder.amount || 0)}"></div><div class="field full"><label>Notas</label><textarea id="reminderNotes">${escapeHtml(reminder.notes || '')}</textarea></div><button class="btn primary block" type="submit">Guardar recordatorio</button></form>`);
	    $('#reminderForm').onsubmit = (event) => {
	      event.preventDefault();
	      const dueDate = $('#reminderDueDate').value;
	      const dueTime = $('#reminderDueTime').value;
	      const dueAt = new Date(`${dueDate}T${dueTime}`);
	      if (!Number.isFinite(dueAt.getTime())) return toast('Fecha invalida.', 'err');
	      const customer = crmCustomers().find((item) => item.id === $('#reminderCustomer').value);
	      const next = { id: reminder.id || uid('reminder'), businessId: currentBusiness().id, type: $('#reminderType').value, title: $('#reminderTitle').value.trim(), dueAt: dueAt.toISOString(), notes: $('#reminderNotes').value.trim(), customerId: customer?.id || '', customerName: customer?.name || '', phone: customer?.phone || '', amount: Math.max(0, parseMoney($('#reminderAmount').value) || 0), status: reminder.status || 'pending', done: reminder.done === true, createdAt: reminder.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
	      state.settings.reminders ||= [];
	      const index = state.settings.reminders.findIndex((item) => item.id === next.id);
	      if (index >= 0) state.settings.reminders[index] = next;
	      else state.settings.reminders.push(next);
	      if (!save()) return;
	      closeModal(); renderApp('reminders'); toast('Recordatorio guardado');
	    };
	  }
	  function bindCrm() {
	    $('#newCustomerBtn')?.addEventListener('click', () => openCustomerModal());
	    $('#customerSearch')?.addEventListener('input', (event) => {
	      const query = String(event.target.value || '').toLowerCase();
	      $('#customerList').innerHTML = customerCards(crmCustomers().filter((customer) => `${customer.name || ''} ${customer.phone || ''}`.toLowerCase().includes(query)));
	      bindCrmActions();
	    });
	    bindCrmActions();
	  }
	  function bindCrmActions() {
	    $$('[data-customer-edit]').forEach((button) => button.onclick = () => openCustomerModal(decodeActionId(button.dataset.customerEdit)));
	    $$('[data-customer-delete]').forEach((button) => button.onclick = () => {
	      const id = decodeActionId(button.dataset.customerDelete);
	      state.settings.customers = (state.settings.customers || []).filter((customer) => customer.id !== id);
	      if (!save()) return;
	      renderApp('crm'); toast('Cliente eliminado');
	    });
	  }
	  function bindReminders() {
	    $('#newReminderBtn')?.addEventListener('click', () => openReminderModal());
	    $$('[data-reminder-edit]').forEach((button) => button.onclick = () => openReminderModal(decodeActionId(button.dataset.reminderEdit)));
	    $$('[data-reminder-postpone]').forEach((button) => button.onclick = () => {
	      const reminder = state.settings.reminders?.find((item) => item.id === decodeActionId(button.dataset.reminderPostpone));
	      if (!reminder) return;
	      const next = prompt('Nueva fecha y hora (AAAA-MM-DD HH:MM):', new Date(Date.parse(reminder.dueAt || '') + 24 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' '));
	      if (!next) return;
	      const due = new Date(next.replace(' ', 'T'));
	      if (!Number.isFinite(due.getTime())) return toast('Fecha y hora invalidas.', 'err');
	      reminder.dueAt = due.toISOString();
	      reminder.status = 'postponed';
	      reminder.updatedAt = new Date().toISOString();
	      if (!save()) return;
	      renderApp('reminders');
	      toast('Recordatorio pospuesto');
	    });
	    $$('[data-reminder-done]').forEach((button) => button.onclick = () => {
	      const reminder = state.settings.reminders?.find((item) => item.id === decodeActionId(button.dataset.reminderDone));
	      if (!reminder) return;
	      reminder.done = true; reminder.status = 'completed'; reminder.completedAt = new Date().toISOString();
	      if (!save()) return;
	      renderApp('reminders');
	    });
	    $$('[data-reminder-delete]').forEach((button) => button.onclick = () => {
	      const id = decodeActionId(button.dataset.reminderDelete);
	      state.settings.reminders = (state.settings.reminders || []).filter((item) => item.id !== id);
	      if (!save()) return;
	      renderApp('reminders');
	    });
	  }
	  function bindAccess() {
	    $$('[data-request-plan]').forEach((button) => {
	      button.onclick = async () => {
	        const plan = button.dataset.requestPlan;
	        const period = $(`[data-plan-period="${plan}"]`)?.value || 'month';
	        button.disabled = true;
	        button.textContent = 'Creando solicitud...';
	        try {
	          if (typeof window.click360CreateActivationRequest !== 'function') throw new Error('La solicitud en nube no esta disponible.');
	          const request = await window.click360CreateActivationRequest({ plan, period, businessName: currentBusiness()?.name || '' });
	          state.settings.activationRequests ||= [];
	          state.settings.activationRequests.push({ ...request, status: 'pending', createdAt: new Date().toISOString() });
	          if (!save()) throw new Error('La solicitud se creo en nube, pero no pudo guardarse en este dispositivo.');
	          const planName = window.CLICK360_V16_DOMAIN?.PLAN_CATALOG?.[plan]?.name || plan;
	          const message = `Hola, quiero activar CLICK 360.\nNegocio: ${currentBusiness()?.name || ''}\nCorreo: ${authUser()?.email || ''}\nPlan: ${planName}\nPeriodo: ${period}\nCodigo: ${request.requestCode}`;
	          window.open(`https://wa.me/593969399562?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
	          renderApp('access');
	          toast('Solicitud de activacion creada');
		        } catch (error) {
		          const planName = window.CLICK360_V16_DOMAIN?.PLAN_CATALOG?.[plan]?.name || plan;
		          const fallbackCode = `LOCAL-${Date.now().toString(36).toUpperCase()}`;
		          state.settings.activationRequests ||= [];
		          state.settings.activationRequests.push({
		            id: uid('activation-local'),
		            plan,
		            period,
		            requestCode: fallbackCode,
		            status: 'pending_whatsapp',
		            source: 'local_permission_fallback',
		            errorCode: String(error?.code || 'activation_request_permission_fallback'),
		            createdAt: new Date().toISOString(),
		            businessId: currentBusiness()?.id || ''
		          });
		          save();
		          const message = `Hola, quiero activar CLICK 360.\nNegocio: ${currentBusiness()?.name || ''}\nCorreo: ${authUser()?.email || ''}\nPlan: ${planName}\nPeriodo: ${period}\nCodigo: ${fallbackCode}`;
		          window.open(`https://wa.me/593969399562?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
		          renderApp('access');
		          toast('Solicitud preparada por WhatsApp. No se mostrará error técnico al cliente.');
		          button.disabled = false;
		          button.textContent = `Solicitar ${planName}`;
		        }
	      };
	    });
	  }
	  const alertedReminderIds = new Set();
	  function checkDueReminders() {
	    const now = Date.now();
	    remindersForBusiness().filter((reminder) => !reminder.done && Date.parse(reminder.dueAt || '') <= now).forEach((reminder) => {
	      if (alertedReminderIds.has(reminder.id)) return;
	      alertedReminderIds.add(reminder.id);
	      toast(`Recordatorio: ${reminder.title || 'pendiente'}`, 'ok');
	    });
	  }
	  function showOnboardingForNewAccount() {
	    const access = accessInfo();
	    const business = currentBusiness();
    if (!shouldPromptInitialBusinessSetup(access, business)) return;
    onboardingPrompted = true;
		    const onboardingAction = ['trial', 'trial_active'].includes(access.mode) ? 'Comenzar prueba' : 'Guardar y continuar';
		    showModal(`<div class="modalHeader"><h2>Configura tu negocio</h2><button class="closeBtn" data-close>×</button></div><form id="onboardingForm" class="formGrid"><div class="field"><label>Nombre</label><input id="onboardingName" required value="${escapeHtml(authUser().name || '')}"></div><div class="field"><label>Apellido</label><input id="onboardingLastName" autocomplete="family-name"></div><div class="field"><label>Teléfono</label><input id="onboardingPhone" type="tel" autocomplete="tel" required placeholder="0999999999"></div><div class="field"><label>País</label><select id="onboardingCountry"><option value="EC">Ecuador</option><option value="CO">Colombia</option><option value="PE">Perú</option><option value="MX">México</option><option value="US">Estados Unidos</option><option value="other">Otro</option></select></div><div class="field"><label>Nombre de empresa</label><input id="onboardingBusiness" required value="${escapeHtml(business.name === 'Mi Negocio' ? '' : business.name)}"></div><div class="field"><label>Tipo de negocio</label><select id="onboardingType">${typeOptions(business.type || 'otro')}</select></div><div class="field"><label>Moneda</label><select id="onboardingCurrency"><option value="USD">USD</option><option value="COP">COP</option><option value="PEN">PEN</option><option value="MXN">MXN</option><option value="EUR">EUR</option></select></div><div class="field"><label>Zona horaria</label><select id="onboardingTimezone"><option value="America/Guayaquil">America/Guayaquil</option><option value="America/Bogota">America/Bogota</option><option value="America/Lima">America/Lima</option><option value="America/Mexico_City">America/Mexico_City</option><option value="America/New_York">America/New_York</option><option value="Europe/Madrid">Europe/Madrid</option></select></div><label class="consentCheck full"><input id="onboardingTerms" type="checkbox" required><span>Acepto los Términos y la Política de privacidad de CLICK 360, versión ${escapeHtml(window.CLICK360_V16_DOMAIN?.TERMS_VERSION || '2026-07-14')}.</span></label><button class="btn primary block" type="submit">${onboardingAction}</button></form>`);
	    $('#onboardingForm').onsubmit = async (event) => {
	      event.preventDefault();
	      const name = $('#onboardingName').value.trim();
	      const lastName = $('#onboardingLastName').value.trim();
	      const fullName = [name, lastName].filter(Boolean).join(' ');
	      const businessName = $('#onboardingBusiness').value.trim();
	      if (!name || !businessName || !$('#onboardingPhone').value.trim()) return toast('Completa tu nombre, telefono y empresa.', 'err');
	      if (!$('#onboardingTerms').checked) return toast('Debes aceptar los terminos para continuar.', 'err');
	      const previousState = cloneState(state);
	      const operationId = uid('onboarding');
	      business.name = businessName; business.type = $('#onboardingType').value;
	      business.settings ||= {};
	      business.settings.phone = $('#onboardingPhone').value.trim();
	      business.settings.country = $('#onboardingCountry').value;
	      business.settings.currency = $('#onboardingCurrency').value;
	      business.settings.timeZone = $('#onboardingTimezone').value;
	      const termsVersion = window.CLICK360_V16_DOMAIN?.TERMS_VERSION || '2026-07-13';
		      state.settings.onboarding = { completedAt: new Date().toISOString(), operationId, version: 16.2, checklist: { business: true, product: false, cash: false, sale: false, customer: false, reminder: false, label: false, report: false } };
	      state.legalAcceptances ||= [];
	      state.legalAcceptances.push({ id: uid('legal'), businessId: business.id, uid: window.click360User.uid, termsVersion, privacyVersion: termsVersion, acceptedAt: new Date().toISOString(), source: 'onboarding' });
	      window.click360User.name = fullName;
	      business.settings.ownerName = fullName;
	      cacheUserProfile({ uid: window.click360User.uid, name: fullName, email: window.click360User.email, photoURL: window.click360User.photoURL });
	      persistUserProfileCache(cachedUserProfile(window.click360User.uid));
	      queuePendingProfile(cachedUserProfile(window.click360User.uid));
	      const committed = await commitCriticalMutation(previousState, 'onboarding_completed', (next) =>
	        next.settings?.onboarding?.operationId === operationId);
	      if (!committed.ok) { closeModal(); renderApp('home'); return; }
	      const profileSynced = await flushPendingProfile();
	      await window.click360SaveLegalAcceptance?.({ termsVersion, privacyVersion: termsVersion, source: 'onboarding' }).catch((error) => console.warn('Aceptacion legal pendiente de nube:', error.message));
	      closeModal(); renderApp('home'); toast(committed.pending || !profileSynced ? 'Tu negocio está listo; queda una sincronización pendiente.' : 'Tu negocio está listo');
	    };
	  }

	  function activeTableOrder(tableId) {
	    return tableOrdersForBiz().find((order) => order.tableId === tableId && order.status === 'open') || null;
	  }
	  function tableElapsedLabel(order) {
	    if (!order?.openedAtMs) return 'Sin cuenta abierta';
	    const minutes = Math.max(0, Math.floor((Date.now() - Number(order.openedAtMs)) / 60000));
	    if (minutes < 60) return `${minutes} min abierta`;
	    return `${Math.floor(minutes / 60)} h ${minutes % 60} min abierta`;
	  }
	  function tableOrderTotal(order) {
	    return (order?.items || []).reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
	  }
	  function tableReservedQuantity(productId, excludedOrderId = '') {
	    return tableOrdersForBiz()
	      .filter((order) => order.status === 'open' && order.id !== excludedOrderId)
	      .flatMap((order) => order.items || [])
	      .filter((item) => !item.nonInventory && item.id === productId)
	      .reduce((total, item) => total + Number(item.qty || 0), 0);
	  }
	  function tablePeopleLabel(table = {}) {
	    const seats = Math.max(1, Math.trunc(Number(table.seats || table.capacity || 4)));
	    const party = Math.max(0, Math.min(seats, Math.trunc(Number(table.partySize || table.people || 0))));
	    return `${party}/${seats} personas`;
	  }
	  function normalizeTableSizeValue(value, fallback, min, max) {
	    return Math.max(min, Math.min(max, Number(value || fallback)));
	  }
	  function splitPlanSummary(order = {}) {
	    const plan = order.splitPlan;
	    if (!plan) return '';
	    if (plan.mode === 'people') return `${plan.parts || 1} personas · ${fmt(Number(plan.amountPerPart || 0))} c/u`;
	    if (plan.mode === 'items') return `${(plan.groups || []).length} grupos por producto`;
	    return 'División configurada';
	  }
	  const TABLE_VISUAL_COLORS = Object.freeze({
	    gold:'#d6aa2c', green:'#2f9d68', blue:'#3d7ea6', red:'#a94a4a', graphite:'#4d5158'
	  });
	  function normalizedTableLayout(table, index = 0) {
	    const layout = table?.layout || {};
	    return {
	      x:Math.max(2, Math.min(82, Number(layout.x ?? 4 + (index % 4) * 24))),
	      y:Math.max(2, Math.min(78, Number(layout.y ?? 5 + Math.floor(index / 4) * 24))),
	      width:normalizeTableSizeValue(layout.width, 18, 12, 42),
	      height:normalizeTableSizeValue(layout.height, 18, 12, 38),
	      shape:['round','square','rectangle','bar','delivery','takeaway'].includes(layout.shape) ? layout.shape : 'round',
	      color:TABLE_VISUAL_COLORS[layout.color] ? layout.color : 'gold'
	    };
	  }
	  function tableElapsedMinutes(order) {
	    if (!order) return 0;
	    const started = Number(order.openedAtMs || Date.parse(order.openedAt || '') || Date.now());
	    return Math.max(0, Math.floor((Date.now() - started) / 60000));
	  }
	  function tableWaitClass(order) {
	    const minutes = tableElapsedMinutes(order);
	    if (minutes >= 45) return 'danger';
	    if (minutes >= 20) return 'warning';
	    return 'ok';
	  }
	  function tableKitchenStatus(order) {
	    if (!order) return 'Libre';
	    if (order.status === 'paid') return 'Pagada';
	    if (order.readyToCharge) return 'Por cobrar';
	    if (order.kitchenStatus === 'ready') return 'Lista';
	    if (order.kitchenStatus === 'preparing') return 'Preparando';
	    if (order.sentToKitchen) return 'En cocina';
	    return 'Abierta';
	  }
	  function tableSeatDots(table = {}, order = null) {
	    const seats = Math.max(1, Math.min(12, Math.trunc(Number(table.seats || table.capacity || 4))));
	    const party = Math.max(0, Math.min(seats, Math.trunc(Number(table.partySize || table.people || (order ? seats : 0)))));
	    return `<span class="tableSeats" aria-hidden="true">${Array.from({ length: seats }, (_, index) => {
	      const angle = -90 + (360 / seats) * index;
	      return `<i class="${index < party ? 'occupied' : 'free'}" style="--seat-angle:${angle}deg"></i>`;
	    }).join('')}</span>`;
	  }
	  function tableMapCard(table, index) {
	    const order = activeTableOrder(table.id);
	    const status = order ? (order.readyToCharge ? 'por-cobrar' : 'ocupada') : 'libre';
	    const layout = normalizedTableLayout(table, index);
	    const color = TABLE_VISUAL_COLORS[layout.color];
	    return `<article class="tableMapItem ${layout.shape} ${status.replace(' ', '-')}" data-table-map-item="${actionId(table.id)}" style="--table-x:${layout.x}%;--table-y:${layout.y}%;--table-w:${layout.width}%;--table-h:${layout.height}%;--table-color:${color}">
	      ${tableSeatDots(table, order)}
	      <button type="button" data-table-open="${actionId(table.id)}" aria-label="Abrir ${escapeHtml(table.name)}">
	        <b>${escapeHtml(table.name)}</b><span class="tableMetaPill">${escapeHtml(tableKitchenStatus(order))}</span><small>${escapeHtml(tablePeopleLabel(table))}</small><strong>${fmt(tableOrderTotal(order))}</strong>${order ? `<em class="tableWait ${tableWaitClass(order)}">${tableElapsedMinutes(order)} min</em>` : ''}
	      </button>
	      <button type="button" class="tableStyleBtn" data-table-style="${actionId(table.id)}" title="Forma y color" aria-label="Editar forma y color">${icon('palette')}</button>
	      <span class="tableSizeStepper" aria-label="Tamaño de mesa"><button type="button" data-table-shrink="${actionId(table.id)}" title="Reducir mesa">−</button><button type="button" data-table-grow="${actionId(table.id)}" title="Agrandar mesa">+</button></span>
	      <span class="tableResizeHandle" data-table-resize="${actionId(table.id)}" title="Cambiar tamaño" aria-hidden="true"></span>
	    </article>`;
	  }
	  function tablesView() {
	    if (!restaurantModuleEnabled()) {
	      return `<div class="pageHead"><div><h1>Mesas</h1><p>Activa este módulo desde el tipo de negocio.</p></div></div>
	        <section class="card sectionCard"><h3>Configura tu negocio</h3><p class="cloudStatus">En Ajustes selecciona Restaurante / cafetería / bar para usar Mesas Lite.</p><button class="btn primary" onclick="window.click360Route('settings')">Ir a Ajustes</button></section>`;
	    }
	    const tables = tablesForBiz();
	    const visualTables = tables.slice().sort((first, second) => {
	      const a = normalizedTableLayout(first);
	      const b = normalizedTableLayout(second);
	      return a.y - b.y || a.x - b.x;
	    });
	    return `<div class="pageHead"><div><h1>Mesas</h1><p>Plano de ${escapeHtml(currentBusiness().name)}</p></div><div class="toolbar"><button class="btn" id="toggleTableLayout">${icon('move')} Editar plano</button><button class="btn primary" id="newTableBtn">${icon('plus')} Nueva mesa</button></div></div>
	      <section class="card tableMapShell"><header><span><b>Distribución del local</b><small>Arrastra, cambia tamaño y controla espera, personas y cocina desde el plano.</small></span><span class="tableMapLegend"><i class="free"></i> Libre <i class="busy"></i> Ocupada <i class="charge"></i> Por cobrar</span></header>
	        <div class="tableMap tableLayoutSurface" id="tableMap">${visualTables.length ? visualTables.map(tableMapCard).join('') : '<div class="tableMapEmpty">Crea Mesa 1, Barra, Patio o Delivery.</div>'}</div>
	        <p class="fieldHint tableMapHint">Activa “Editar plano”: arrastra cada mesa y usa la esquina dorada para hacerla más grande o pequeña. Los cambios se guardan solo en este negocio.</p>
	      </section>
	      <details class="settingsDisclosure tableListDisclosure"><summary>Lista y administración</summary><section class="tableGrid">${tables.length ? tables.map((table) => {
	        const order = activeTableOrder(table.id);
	        const status = order ? (order.readyToCharge ? 'por cobrar' : 'ocupada') : 'libre';
	        return `<article class="card tableCard ${status.replace(' ', '-')}">
	          <div class="tableCardHead"><span>${icon(order ? 'utensils' : 'armchair')}<b>${escapeHtml(table.name)}</b></span><span class="badge ${order ? 'gold' : ''}">${escapeHtml(status)}</span></div>
	          <p>${escapeHtml(tableElapsedLabel(order))} · ${escapeHtml(tablePeopleLabel(table))}</p>
	          <strong>${fmt(tableOrderTotal(order))}</strong>
	          <div class="tableActions"><button class="btn ${order ? 'primary' : 'silver'}" data-table-open="${actionId(table.id)}">${order ? 'Ver cuenta' : 'Abrir mesa'}</button><button class="iconBtn" data-table-rename="${actionId(table.id)}" title="Editar nombre" aria-label="Editar nombre">${icon('pencil')}</button><button class="iconBtn danger" data-table-delete="${actionId(table.id)}" title="Eliminar mesa" aria-label="Eliminar mesa">${icon('trash-2')}</button></div>
	        </article>`;
	      }).join('') : '<div class="card empty">Crea Mesa 1, Barra, Patio, Delivery o cualquier espacio que uses.</div>'}</section></details>`;
	  }
	  function openTableNameModal(tableId = '') {
	    const table = tablesForBiz().find((item) => item.id === tableId);
	    const seats = Math.max(1, Math.trunc(Number(table?.seats || table?.capacity || 4)));
	    const partySize = Math.max(0, Math.min(seats, Math.trunc(Number(table?.partySize || table?.people || 0))));
	    showModal(`<div class="modalHeader"><h2>${table ? 'Editar' : 'Nueva'} mesa</h2><button class="closeBtn" data-close>×</button></div>
	      <form id="tableNameForm" class="formGrid"><div class="field full"><label>Nombre</label><input id="tableName" maxlength="40" required value="${escapeHtml(table?.name || '')}" placeholder="Mesa 1, Barra, Patio..."></div>
	      <div class="field"><label>Sillas / capacidad</label><input id="tableSeats" type="number" min="1" max="40" value="${seats}"></div>
	      <div class="field"><label>Personas sentadas</label><input id="tablePartySize" type="number" min="0" max="40" value="${partySize}"></div>
	      <button class="btn" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Guardar mesa</button></form>`);
	    $('#tableNameForm').onsubmit = (event) => {
	      event.preventDefault();
	      const name = $('#tableName').value.trim();
	      const nextSeats = Math.max(1, Math.min(40, Math.trunc(Number($('#tableSeats').value || 4))));
	      const nextPartySize = Math.max(0, Math.min(nextSeats, Math.trunc(Number($('#tablePartySize').value || 0))));
	      if (!name) return toast('Escribe un nombre para la mesa.', 'err');
	      if (table) Object.assign(table, { name, seats:nextSeats, partySize:nextPartySize, updatedAt: new Date().toISOString() });
	      else {
	        const nextTable = { id:uid('table'), businessId:currentBusiness().id, name, seats:nextSeats, partySize:nextPartySize, createdAt:new Date().toISOString(), status:'free' };
	        nextTable.layout = normalizedTableLayout(nextTable, tablesForBiz().length);
	        state.tables.push(nextTable);
	      }
	      addAudit(table ? 'table_renamed' : 'table_created', { tableId: table?.id || state.tables.at(-1)?.id });
	      if (!save()) return;
	      closeModal(); renderApp('tables'); toast('Mesa guardada');
	    };
	  }
	  function openTableStyleModal(tableId) {
	    const table = tablesForBiz().find((item) => item.id === tableId);
	    if (!table) return;
	    const layout = normalizedTableLayout(table);
	    showModal(`<div class="modalHeader"><div><h2>Diseño de ${escapeHtml(table.name)}</h2><p class="fieldHint">Solo cambia su apariencia en el plano.</p></div><button class="closeBtn" data-close>×</button></div>
	      <form id="tableStyleForm" class="formGrid"><div class="field"><label>Forma</label><select id="tableShape"><option value="round" ${layout.shape === 'round' ? 'selected' : ''}>Redonda</option><option value="square" ${layout.shape === 'square' ? 'selected' : ''}>Cuadrada</option><option value="rectangle" ${layout.shape === 'rectangle' ? 'selected' : ''}>Rectangular</option><option value="bar" ${layout.shape === 'bar' ? 'selected' : ''}>Barra</option><option value="delivery" ${layout.shape === 'delivery' ? 'selected' : ''}>Delivery</option><option value="takeaway" ${layout.shape === 'takeaway' ? 'selected' : ''}>Para llevar</option></select></div>
	      <div class="field"><label>Color</label><select id="tableColor">${Object.keys(TABLE_VISUAL_COLORS).map((key) => `<option value="${key}" ${layout.color === key ? 'selected' : ''}>${{gold:'Dorado',green:'Verde',blue:'Azul',red:'Rojo',graphite:'Grafito'}[key]}</option>`).join('')}</select></div>
	      <div class="field"><label>Ancho visual</label><input id="tableLayoutW" type="range" min="12" max="42" step="1" value="${layout.width}"></div><div class="field"><label>Alto visual</label><input id="tableLayoutH" type="range" min="12" max="38" step="1" value="${layout.height}"></div>
	      <button class="btn" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Guardar diseño</button></form>`);
	    $('#tableStyleForm').onsubmit = (event) => {
	      event.preventDefault();
	      table.layout = { ...layout, shape:$('#tableShape').value, color:$('#tableColor').value, width:Number($('#tableLayoutW').value), height:Number($('#tableLayoutH').value) };
	      table.updatedAt = new Date().toISOString();
	      addAudit('table_layout_changed', { tableId:table.id, shape:table.layout.shape, color:table.layout.color });
	      if (!saveTableLayoutChange()) return;
	      closeModal(); renderApp('tables'); toast('Diseño de mesa guardado');
	    };
	  }
	  function openTableOrderModal(tableId) {
	    const table = tablesForBiz().find((item) => item.id === tableId);
	    if (!table) return toast('Mesa no encontrada.', 'err');
	    let order = activeTableOrder(table.id);
	    if (!order) {
	      order = { id: uid('tableorder'), tableId: table.id, businessId: currentBusiness().id, items: [], status: 'open', kitchenStatus:'draft', sentToKitchen:false, openedAt: new Date().toISOString(), openedAtMs: Date.now(), updatedAtMs: Date.now() };
	      state.tableOrders.push(order);
	      table.status = 'occupied';
	      addAudit('table_opened', { tableId: table.id, orderId: order.id });
	      if (!save()) return;
	    }
	    const render = () => {
	      const productOptions = productsForBiz().map((product) => ({
	        product,
	        available: Math.max(0, Number(product.qty || 0) - tableReservedQuantity(product.id, order.id))
	      })).filter(({ available }) => available > 0).map(({ product, available }) => `<option value="${actionId(product.id)}">${escapeHtml(product.name)} · ${fmt(product.price)} · ${available} disp.</option>`).join('');
	      showModal(`<div class="modalHeader"><div><h2>${escapeHtml(table.name)}</h2><p class="fieldHint">${escapeHtml(tableElapsedLabel(order))}</p></div><button class="closeBtn" data-close>×</button></div>
	        <section class="tableOrderStatusStrip"><span class="${order.sentToKitchen ? 'sent' : ''}">${icon(order.sentToKitchen ? 'chef-hat' : 'notebook-pen')} ${escapeHtml(tableKitchenStatus(order))}</span><span>${icon('clock')} ${tableElapsedMinutes(order)} min de espera</span><span>${icon('users-round')} ${escapeHtml(tablePeopleLabel(table))}</span></section>
	        <section class="tableOrderSummary">${(order.items || []).length ? order.items.map((item) => `<div class="movement tableLineRow"><span><b>${escapeHtml(item.name)}</b><small>${item.qty} × ${fmt(item.price)}${item.nonInventory ? ' · directo' : ''}${item.area ? ` · ${escapeHtml(item.area === 'bar' ? 'barra' : 'cocina')}` : ''}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</small></span><span><b>${fmt(item.qty * item.price)}</b><button class="iconBtn danger" data-table-item-remove="${actionId(item.id)}" aria-label="Quitar producto">${icon('trash-2')}</button></span></div>`).join('') : '<p class="empty">La mesa todavía no tiene productos.</p>'}</section>
	        <div class="tableQuickPanels">
	          <form id="tableAddItemForm" class="tableAddItem"><div class="field"><label>Producto de inventario</label><select id="tableProduct" ${productOptions ? '' : 'disabled'}>${productOptions || '<option>Sin productos con stock</option>'}</select></div><div class="field"><label>Cantidad</label><input id="tableQty" type="number" min="1" max="99" value="1"></div><button class="btn silver" type="submit" ${productOptions ? '' : 'disabled'}>${icon('plus')} Agregar</button></form>
	          <form id="tableQuickItemForm" class="tableAddItem tableDirectItem"><div class="field"><label>Producto directo</label><input id="tableQuickName" maxlength="60" placeholder="Ej. Menú del día, plato extra"></div><div class="field"><label>Precio</label><input id="tableQuickPrice" type="number" min="0" step="0.01" inputmode="decimal" value="0"></div><div class="field"><label>Cant.</label><input id="tableQuickQty" type="number" min="1" max="99" value="1"></div><div class="field"><label>Área</label><select id="tableQuickArea"><option value="kitchen">Cocina</option><option value="bar">Barra</option></select></div><div class="field"><label>Detalle</label><input id="tableQuickNote" maxlength="120" placeholder="Sin lechuga, sin azúcar..."></div><button class="btn silver" type="submit">${icon('plus')} Agregar directo</button></form>
	        </div>
	        ${order.splitPlan ? `<div class="tableSplitPreview"><b>Cuenta dividida</b><span>${escapeHtml(splitPlanSummary(order))}</span></div>` : ''}
	        <div class="tableOrderTotal"><span>Total</span><strong>${fmt(tableOrderTotal(order))}</strong></div>
	        <div class="tableCheckoutActions"><button class="btn primary" type="button" id="tableSendKitchenBtn" ${(order.items || []).length ? '' : 'disabled'}>${icon('chef-hat')} Enviar a cocina</button><button class="btn" type="button" id="tableSplitBtn">Dividir cuenta</button><button class="btn" type="button" id="tableDetailsBtn">Detalles del pedido</button><button class="btn" type="button" id="tableReadyBtn">${order.readyToCharge ? 'Seguir agregando' : 'Marcar por cobrar'}</button><button class="btn primary" type="button" id="tableChargeBtn" ${(order.items || []).length ? '' : 'disabled'}>Cobrar mesa</button></div>`);
	      $$('[data-table-item-remove]').forEach((button) => button.onclick = () => {
	        order.items = order.items.filter((item) => item.id !== decodeActionId(button.dataset.tableItemRemove));
	        order.updatedAtMs = Date.now();
	        if (!save()) return;
	        render();
	      });
	      $('#tableAddItemForm').onsubmit = (event) => {
	        event.preventDefault();
	        const productId = decodeActionId($('#tableProduct').value);
	        const product = productsForBiz().find((item) => item.id === productId);
	        const qty = Math.max(1, Math.min(99, Math.trunc(Number($('#tableQty').value || 1))));
	        const existing = order.items.find((item) => item.id === productId);
	        const requested = qty + Number(existing?.qty || 0);
	        const available = Number(product?.qty || 0) - tableReservedQuantity(productId, order.id);
	        if (!product || requested > available) return toast('No hay stock suficiente.', 'err');
	        if (existing) existing.qty = requested;
	        else order.items.push({ id: product.id, productId:product.id, name: product.name, code: product.code, price: product.price, cardPrice: product.cardPrice || product.price, taxMode: product.taxMode || 'inherit', qty, area:'kitchen', note:'', imageData:safeImageSrc(product.imageData || '') });
	        order.readyToCharge = false;
	        order.kitchenStatus = order.sentToKitchen ? 'preparing' : 'draft';
	        order.updatedAtMs = Date.now();
	        if (!save()) return;
	        render();
	      };
	      $('#tableQuickItemForm').onsubmit = (event) => {
	        event.preventDefault();
	        const name = $('#tableQuickName').value.trim();
	        const price = Math.max(0, Number($('#tableQuickPrice').value || 0));
	        const qty = Math.max(1, Math.min(99, Math.trunc(Number($('#tableQuickQty').value || 1))));
	        const area = $('#tableQuickArea').value === 'bar' ? 'bar' : 'kitchen';
	        const note = $('#tableQuickNote').value.trim();
	        if (!name) return toast('Escribe el nombre del consumo directo.', 'err');
	        if (!Number.isFinite(price) || price < 0) return toast('Precio directo inválido.', 'err');
	        order.items.push({ id:uid('direct'), productId:'', name, code:'DIRECTO', price, cardPrice:price, taxMode:'inherit', qty, area, note, nonInventory:true, createdAt:new Date().toISOString() });
	        order.readyToCharge = false;
	        order.kitchenStatus = order.sentToKitchen ? 'preparing' : 'draft';
	        order.updatedAtMs = Date.now();
	        addAudit('table_direct_item_added', { tableId:table.id, orderId:order.id, name, qty });
	        if (!save()) return;
	        render();
	      };
	      $('#tableReadyBtn').onclick = () => {
	        order.readyToCharge = !order.readyToCharge;
	        order.kitchenStatus = order.readyToCharge ? 'ready' : (order.sentToKitchen ? 'preparing' : 'draft');
	        order.updatedAtMs = Date.now();
	        if (!save()) return;
	        render();
	      };
	      $('#tableSendKitchenBtn').onclick = () => {
	        if (!(order.items || []).length) return toast('Agrega productos antes de enviar a cocina.', 'err');
	        order.sentToKitchen = true;
	        order.kitchenStatus = 'preparing';
	        order.sentToKitchenAt = order.sentToKitchenAt || new Date().toISOString();
	        order.updatedAtMs = Date.now();
	        addAudit('table_sent_to_kitchen', { tableId:table.id, orderId:order.id, items:(order.items || []).length });
	        if (!save()) return;
	        render();
	        toast('Pedido enviado a cocina/barra');
	      };
	      $('#tableSplitBtn').onclick = () => openTableSplitModal(table.id, order.id);
	      $('#tableDetailsBtn').onclick = () => openTableDetailsModal(table.id, order.id);
	      $('#tableChargeBtn').onclick = () => chargeTableOrder(table, order);
	      refreshIcons();
	    };
	    render();
	  }
	  function openTableSplitModal(tableId, orderId) {
	    const table = tablesForBiz().find((item) => item.id === tableId);
	    const order = tableOrdersForBiz().find((item) => item.id === orderId);
	    if (!table || !order) return toast('Cuenta no encontrada.', 'err');
	    const currentParts = Math.max(1, Math.trunc(Number(order.splitPlan?.parts || table.partySize || 2)));
	    const total = tableOrderTotal(order);
	    showModal(`<div class="modalHeader"><div><h2>Dividir cuenta</h2><p class="fieldHint">${escapeHtml(table.name)} · Total ${fmt(total)}</p></div><button class="closeBtn" data-close>×</button></div>
	      <form id="tableSplitForm" class="formGrid">
	        <div class="field"><label>Modo</label><select id="tableSplitMode"><option value="people" ${order.splitPlan?.mode !== 'items' ? 'selected' : ''}>Por personas</option><option value="items" ${order.splitPlan?.mode === 'items' ? 'selected' : ''}>Por productos</option></select></div>
	        <div class="field"><label>Personas / partes</label><input id="tableSplitParts" type="number" min="1" max="30" value="${currentParts}"></div>
	        <div class="field full"><label>Nota</label><textarea id="tableSplitNote" placeholder="Ej. mesa dividida en 3 pagos">${escapeHtml(order.splitPlan?.note || '')}</textarea></div>
	        <section class="card full tableSplitPreview"><b>Resumen</b><span id="splitLiveSummary">${fmt(total / currentParts)} por persona</span></section>
	        <button class="btn" type="button" data-close>Cancelar</button><button class="btn danger" type="button" id="clearSplitBtn">Quitar división</button><button class="btn primary" type="submit">Guardar división</button>
	      </form>`);
	    const update = () => {
	      const parts = Math.max(1, Math.min(30, Math.trunc(Number($('#tableSplitParts').value || 1))));
	      $('#splitLiveSummary').textContent = $('#tableSplitMode').value === 'items'
	        ? `${(order.items || []).length} productos para repartir manualmente`
	        : `${fmt(total / parts)} por persona`;
	    };
	    $('#tableSplitParts').oninput = update;
	    $('#tableSplitMode').onchange = update;
	    $('#clearSplitBtn').onclick = () => {
	      order.splitPlan = null;
	      order.updatedAtMs = Date.now();
	      addAudit('table_split_cleared', { tableId, orderId });
	      if (!save()) return;
	      closeModal(); openTableOrderModal(tableId);
	    };
	    $('#tableSplitForm').onsubmit = (event) => {
	      event.preventDefault();
	      const mode = $('#tableSplitMode').value === 'items' ? 'items' : 'people';
	      const parts = Math.max(1, Math.min(30, Math.trunc(Number($('#tableSplitParts').value || 1))));
	      order.splitPlan = {
	        mode,
	        parts,
	        amountPerPart: mode === 'people' ? Math.round((total / parts) * 100) / 100 : 0,
	        groups: mode === 'items' ? (order.items || []).map((item, index) => ({ group:index + 1, itemId:item.id, name:item.name, total:Number(item.price || 0) * Number(item.qty || 0) })) : [],
	        note:$('#tableSplitNote').value.trim(),
	        updatedAt:new Date().toISOString()
	      };
	      order.updatedAtMs = Date.now();
	      addAudit('table_split_saved', { tableId, orderId, mode, parts });
	      if (!save()) return;
	      closeModal(); openTableOrderModal(tableId);
	    };
	    update();
	  }
	  function openTableDetailsModal(tableId = '', orderId = '') {
	    const table = tablesForBiz().find((item) => item.id === tableId);
	    const order = tableOrdersForBiz().find((item) => item.id === orderId);
	    if (!table || !order) return toast('Pedido no encontrado.', 'err');
	    const itemFields = (order.items || []).map((item, index) => `<article class="tableDetailItem">
	      <b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.area === 'bar' ? 'Barra' : 'Cocina')} · ${item.qty} unidad${Number(item.qty) === 1 ? '' : 'es'}</small>
	      <label>Detalle para cocina/barra<input data-order-item-note="${actionId(item.id)}" maxlength="140" value="${escapeHtml(item.note || '')}" placeholder="Ej. sin tomate, sin azúcar, término medio"></label>
	      <label>Área<select data-order-item-area="${actionId(item.id)}"><option value="kitchen" ${item.area !== 'bar' ? 'selected' : ''}>Cocina</option><option value="bar" ${item.area === 'bar' ? 'selected' : ''}>Barra</option></select></label>
	    </article>`).join('');
	    showModal(`<div class="modalHeader"><div><h2>Detalles del pedido</h2><p class="fieldHint">${escapeHtml(table.name)} · notas claras para cocina y barra.</p></div><button class="closeBtn" data-close>×</button></div>
	      <form id="tableDetailsForm" class="formGrid">
	        <div class="field full"><label>Nota general del pedido</label><textarea id="tableOrderNote" placeholder="Ej. cliente apurado, servir todo junto...">${escapeHtml(order.note || '')}</textarea></div>
	        <section class="full tableDetailsList">${itemFields || '<p class="empty">Agrega productos para escribir detalles.</p>'}</section>
	        <button class="btn" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Guardar detalles</button>
	      </form>`);
	    $('#tableDetailsForm').onsubmit = (event) => {
	      event.preventDefault();
	      order.note = $('#tableOrderNote').value.trim();
	      (order.items || []).forEach((item) => {
	        const id = actionId(item.id);
	        item.note = $(`[data-order-item-note="${id}"]`)?.value.trim() || '';
	        item.area = $(`[data-order-item-area="${id}"]`)?.value === 'bar' ? 'bar' : 'kitchen';
	      });
	      order.updatedAtMs = Date.now();
	      addAudit('table_order_details_saved', { tableId, orderId });
	      if (!save()) return;
	      closeModal(); openTableOrderModal(tableId); toast('Detalles del pedido guardados');
	    };
	  }
	  function openTableRecipesModal(tableId = '', orderId = '') {
	    const recipes = restaurantRecipesForBiz();
	    const productOptions = productsForBiz().map((product) => `<option value="${actionId(product.id)}">${escapeHtml(product.name)}</option>`).join('');
	    showModal(`<div class="modalHeader"><div><h2>Recetas</h2><p class="fieldHint">Guarda ingredientes y preparación para cocina. No descuenta insumos automáticamente.</p></div><button class="closeBtn" data-close>×</button></div>
	      <section class="tableRecipeList">${recipes.length ? recipes.map((recipe) => `<article class="card compactRecipe"><b>${escapeHtml(recipe.name)}</b><small>${escapeHtml(recipe.productName || 'Receta libre')}</small><p>${escapeHtml(recipe.ingredients || '')}</p><button class="iconBtn danger" data-recipe-delete="${actionId(recipe.id)}" aria-label="Eliminar receta">${icon('trash-2')}</button></article>`).join('') : '<p class="empty">Aún no tienes recetas para este negocio.</p>'}</section>
	      <form id="tableRecipeForm" class="formGrid">
	        <div class="field"><label>Nombre de receta</label><input id="recipeName" maxlength="80" required placeholder="Ej. Hamburguesa clásica"></div>
	        <div class="field"><label>Producto relacionado</label><select id="recipeProduct"><option value="">Receta libre</option>${productOptions}</select></div>
	        <div class="field full"><label>Ingredientes</label><textarea id="recipeIngredients" placeholder="Pan, carne, queso, salsa..."></textarea></div>
	        <div class="field full"><label>Preparación</label><textarea id="recipeSteps" placeholder="Pasos de cocina"></textarea></div>
	        <button class="btn" type="button" data-close>Salir</button><button class="btn primary" type="submit">Guardar receta</button>
	      </form>`);
	    $$('[data-recipe-delete]').forEach((button) => button.onclick = () => {
	      const id = decodeActionId(button.dataset.recipeDelete);
	      state.restaurantRecipes = (state.restaurantRecipes || []).filter((recipe) => recipe.id !== id);
	      addAudit('restaurant_recipe_deleted', { recipeId:id });
	      if (!save()) return;
	      openTableRecipesModal(tableId, orderId);
	    });
	    $('#tableRecipeForm').onsubmit = (event) => {
	      event.preventDefault();
	      const productId = decodeActionId($('#recipeProduct').value);
	      const product = productsForBiz().find((item) => item.id === productId);
	      const recipe = {
	        id:uid('recipe'),
	        businessId:currentBusiness().id,
	        name:$('#recipeName').value.trim(),
	        productId:product?.id || '',
	        productName:product?.name || '',
	        ingredients:$('#recipeIngredients').value.trim(),
	        steps:$('#recipeSteps').value.trim(),
	        createdAt:new Date().toISOString(),
	        updatedAtMs:Date.now()
	      };
	      if (!recipe.name) return toast('Escribe el nombre de la receta.', 'err');
	      state.restaurantRecipes.push(recipe);
	      addAudit('restaurant_recipe_saved', { recipeId:recipe.id, productId:recipe.productId });
	      if (!save()) return;
	      openTableRecipesModal(tableId, orderId);
	    };
	    refreshIcons();
	  }
	  function chargeTableOrder(table, order) {
	    if (!isDayStarted() || isDayClosed()) return toast('Abre una caja activa antes de cobrar la mesa.', 'err');
	    const total = tableOrderTotal(order);
	    showModal(`<div class="modalHeader"><div><h2>Cobrar ${escapeHtml(table.name)}</h2><p class="fieldHint">Usa el mismo cierre claro que una venta normal.</p></div><button class="closeBtn" data-close>×</button></div>
	      <form id="tableCheckoutForm" class="formGrid">
	        <section class="card full tableCheckoutSummary"><span>Total a cobrar</span><strong>${fmt(total)}</strong></section>
	        <div class="field"><label>Método de pago</label><select id="tableCheckoutMethod"><option value="Efectivo">Efectivo</option><option value="Tarjeta">Tarjeta</option><option value="Transferencia">Transferencia</option></select></div>
	        <div class="field"><label>Efectivo recibido</label><input id="tableCheckoutTendered" type="number" min="0" step="0.01" inputmode="decimal" value="${numericInputValue(total)}"></div>
	        <div class="field"><label>Cliente (opcional)</label><input id="tableCheckoutCustomer" maxlength="100" placeholder="Nombre del cliente"></div>
	        <div class="field"><label>Cédula/RUC (opcional)</label><input id="tableCheckoutCedula" maxlength="32" inputmode="numeric"></div>
	        <div class="field full"><label>Teléfono / WhatsApp (opcional)</label><input id="tableCheckoutPhone" maxlength="32" inputmode="tel"></div>
	        <label class="consentCheck full"><input id="tableCheckoutPrint" type="checkbox" checked><span>Abrir comprobante listo para imprimir al cobrar</span></label>
	        <button class="btn" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Confirmar cobro</button>
	      </form>`);
	    const methodInput = $('#tableCheckoutMethod');
	    const tenderedInput = $('#tableCheckoutTendered');
	    const updateTendered = () => { tenderedInput.disabled = methodInput.value !== 'Efectivo'; if (tenderedInput.disabled) tenderedInput.value = numericInputValue(total); };
	    methodInput.onchange = updateTendered; updateTendered();
	    $('#tableCheckoutForm').onsubmit = (event) => {
	      event.preventDefault();
	      const method = methodInput.value;
	      const tendered = method === 'Efectivo' ? Number(tenderedInput.value || 0) : total;
	      if (!Number.isFinite(tendered) || tendered < total) return toast('El efectivo recibido no cubre el total.', 'err');
	      finalizeTableCharge(table, order, { method, tendered, customer:$('#tableCheckoutCustomer').value.trim(), customerCedula:$('#tableCheckoutCedula').value.trim(), customerPhone:$('#tableCheckoutPhone').value.trim(), print:$('#tableCheckoutPrint').checked });
	    };
	  }
	  async function finalizeTableCharge(table, order, checkout = {}) {
	    const method = ['Efectivo','Tarjeta','Transferencia'].includes(checkout.method) ? checkout.method : 'Efectivo';
	    const tendered = Number(checkout.tendered || 0);
	    const previousState = cloneState(state);
	    const businessId = currentBusiness().id;
	    const tax = businessTaxConfig();
	    const lines = order.items.map((item) => ({ ...item, unitPrice: method === 'Tarjeta' ? item.cardPrice : item.price }));
	    const calculation = window.CLICK360_V16_DOMAIN?.calculateCart(lines, 0, tax);
	    const total = Number(calculation?.total ?? tableOrderTotal(order));
	    for (const item of order.items) {
	      if (item.nonInventory) continue;
	      const product = productsForBiz().find((candidate) => candidate.id === item.id);
	      if (!product || product.qty < item.qty) return toast(`Stock insuficiente: ${item.name}`, 'err');
	    }
	    const saleId = uid('sale');
	    const sale = {
	      id: saleId, operationId: uid('table-sale'), cashSessionId: currentOpenCashSession()?.id || '',
	      businessId, tableId: table.id, tableOrderId: order.id, date: today(), when: nowLabel(),
	      items: (calculation?.lines || lines).map((item) => ({ id:item.id, productId:item.productId || (item.nonInventory ? '' : item.id), nonInventory:item.nonInventory === true, name:item.name, code:item.code, qty:item.qty, price:item.unitPrice || item.price, taxMode:item.taxMode || 'inherit', taxBase:item.base || 0, tax:item.tax || 0, total:item.total || item.qty * item.price })),
	      subtotal: Number(calculation?.subtotal || total), iva: Number(calculation?.tax || 0), discount: 0, total, method,
	      customer:checkout.customer || '', customerCedula:checkout.customerCedula || '', customerPhone:checkout.customerPhone || '',
	      status:'paid', received:tendered || total, tendered:tendered || total, change:method === 'Efectivo' ? Math.max(0, (tendered || total) - total) : 0, balance:0, user:authUser().name,
	      createdAt:new Date().toISOString(), createdAtMs:Date.now(), createdBy:authUser().name
	    };
	    state.sales.push(sale);
	    order.items.forEach((item) => {
	      if (item.nonInventory) return;
	      const product = productsForBiz().find((candidate) => candidate.id === item.id);
	      product.qty -= item.qty;
	      product.updatedAtMs = Date.now();
	      product.updatedAt = new Date().toISOString();
	    });
	    state.movements.push({ id:uid('mov'), businessId, date:today(), when:nowLabel(), kind:'ingreso', amount:total, note:`Venta ${table.name}`, user:authUser().name, saleId, paymentMethod:method, cashSessionId:sale.cashSessionId, createdAtMs:Date.now(), createdBy:authUser().name });
	    Object.assign(order, { status:'paid', closedAt:new Date().toISOString(), closedAtMs:Date.now(), saleId, readyToCharge:false });
	    Object.assign(table, { status:'free', updatedAt:new Date().toISOString() });
	    addAudit('table_charged', { tableId: table.id, orderId: order.id, saleId, total });
	    const committed = await commitCriticalMutation(previousState, 'table_charged', (next) =>
	      next.sales.some((item) => item.id === saleId && item.businessId === businessId)
	      && next.tableOrders.some((item) => item.id === order.id && item.status === 'paid'));
	    if (!committed.ok) return renderApp('tables');
	    closeModal(); renderApp('tables');
	    if (checkout.print) setTimeout(() => window.showSaleCompleteModal?.(sale.id), 0);
	    toast(committed.pending ? 'Mesa cobrada; sincronización pendiente.' : 'Mesa cobrada y liberada');
	  }
	  function bindTables() {
	    $('#newTableBtn')?.addEventListener('click', () => openTableNameModal());
	    let editingLayout = false;
	    const toggle = $('#toggleTableLayout');
	    toggle?.addEventListener('click', () => {
	      editingLayout = !editingLayout;
	      $('#tableMap')?.classList.toggle('editing', editingLayout);
	      toggle.classList.toggle('primary', editingLayout);
	      toggle.innerHTML = editingLayout ? `${icon('check')} Terminar` : `${icon('move')} Editar plano`;
	      refreshIcons(toggle);
	    });
	    $$('[data-table-open]').forEach((button) => button.onclick = (event) => {
	      if (editingLayout && event.currentTarget.closest('.tableMapItem')) return;
	      openTableOrderModal(decodeActionId(button.dataset.tableOpen));
	    });
	    $$('[data-table-rename]').forEach((button) => button.onclick = () => openTableNameModal(decodeActionId(button.dataset.tableRename)));
	    $$('[data-table-style]').forEach((button) => button.onclick = (event) => {
	      event.stopPropagation();
	      openTableStyleModal(decodeActionId(button.dataset.tableStyle));
	    });
	    const resizeByStep = (tableId, delta) => {
	      const table = tablesForBiz().find((candidate) => candidate.id === tableId);
	      if (!table || !editingLayout) return;
	      const layout = normalizedTableLayout(table);
	      table.layout = {
	        ...layout,
	        width:Math.max(12, Math.min(42, Number(layout.width || 18) + delta)),
	        height:Math.max(12, Math.min(38, Number(layout.height || 18) + delta))
	      };
	      table.updatedAt = new Date().toISOString();
	      addAudit(delta > 0 ? 'table_grown' : 'table_shrunk', { tableId });
	      if (!saveTableLayoutChange()) return;
	      const card = $(`[data-table-map-item="${actionId(tableId)}"]`);
	      card?.style.setProperty('--table-w', `${table.layout.width}%`);
	      card?.style.setProperty('--table-h', `${table.layout.height}%`);
	    };
	    $$('[data-table-grow]').forEach((button) => button.onclick = (event) => { event.stopPropagation(); resizeByStep(decodeActionId(button.dataset.tableGrow), 3); });
	    $$('[data-table-shrink]').forEach((button) => button.onclick = (event) => { event.stopPropagation(); resizeByStep(decodeActionId(button.dataset.tableShrink), -3); });
	    $$('[data-table-map-item]').forEach((item) => {
	      let drag = null;
	      item.addEventListener('pointerdown', (event) => {
	        if (!editingLayout || event.target.closest('.tableStyleBtn')) return;
	        const map = $('#tableMap');
	        const table = tablesForBiz().find((candidate) => candidate.id === decodeActionId(item.dataset.tableMapItem));
	        if (!map || !table) return;
	        const layout = normalizedTableLayout(table);
	        const resizing = !!event.target.closest('[data-table-resize]');
	        drag = { table, businessId:currentBusiness().id, layout, resizing, startX:event.clientX, startY:event.clientY, rect:map.getBoundingClientRect() };
	        item.setPointerCapture?.(event.pointerId);
	        event.preventDefault();
	      });
	      item.addEventListener('pointermove', (event) => {
	        if (!drag) return;
	        if (drag.resizing) {
	          const width = Math.max(12, Math.min(42, drag.layout.width + (event.clientX - drag.startX) / drag.rect.width * 100));
	          const height = Math.max(12, Math.min(38, drag.layout.height + (event.clientY - drag.startY) / drag.rect.height * 100));
	          item.style.setProperty('--table-w', `${width}%`);
	          item.style.setProperty('--table-h', `${height}%`);
	          drag.next = { ...drag.layout, width:Number(width.toFixed(2)), height:Number(height.toFixed(2)) };
	        } else {
	          const x = Math.max(2, Math.min(98 - drag.layout.width, drag.layout.x + (event.clientX - drag.startX) / drag.rect.width * 100));
	          const y = Math.max(2, Math.min(98 - drag.layout.height, drag.layout.y + (event.clientY - drag.startY) / drag.rect.height * 100));
	          item.style.setProperty('--table-x', `${x}%`);
	          item.style.setProperty('--table-y', `${y}%`);
	          drag.next = { ...drag.layout, x:Number(x.toFixed(2)), y:Number(y.toFixed(2)) };
	        }
	      });
	      const finishDrag = () => {
	        if (!drag?.next || drag.businessId !== currentBusiness()?.id) { drag = null; return; }
	        drag.table.layout = drag.next;
	        drag.table.updatedAt = new Date().toISOString();
	        addAudit(drag.resizing ? 'table_resized' : 'table_moved', { tableId:drag.table.id });
	        saveTableLayoutChange();
	        drag = null;
	      };
	      item.addEventListener('pointerup', finishDrag);
	      item.addEventListener('pointercancel', finishDrag);
	    });
	    $$('[data-table-delete]').forEach((button) => button.onclick = () => {
	      const tableId = decodeActionId(button.dataset.tableDelete);
	      if (activeTableOrder(tableId)) return toast('Cobra o vacía la cuenta antes de eliminar la mesa.', 'err');
	      const table = tablesForBiz().find((item) => item.id === tableId);
	      if (!table || !confirm(`¿Eliminar ${table.name}?`)) return;
	      state.tables = state.tables.filter((item) => item.id !== tableId || item.businessId !== currentBusiness().id);
	      addAudit('table_deleted', { tableId });
	      if (!save()) return;
	      renderApp('tables'); toast('Mesa eliminada');
	    });
	  }

	  function kitchenOrders(area = 'kitchen') {
	    return tableOrdersForBiz()
	      .filter((order) => order.status !== 'paid' && (order.items || []).some((item) => (item.area === 'bar' ? 'bar' : 'kitchen') === area))
	      .sort((a, b) => Number(a.openedAtMs || 0) - Number(b.openedAtMs || 0));
	  }
	  function kitchenBoardView(area = 'kitchen') {
	    if (!restaurantModuleEnabled()) {
	      return `<div class="pageHead"><div><h1>${area === 'bar' ? 'Barra' : 'Cocina'}</h1><p>Activa Restaurante en Ajustes.</p></div></div>
	        <section class="card sectionCard"><button class="btn primary" onclick="window.click360Route('settings')">Ir a Ajustes</button></section>`;
	    }
	    const orders = kitchenOrders(area);
	    const title = area === 'bar' ? 'Barra' : 'Cocina';
	    return `<div class="pageHead"><div><h1>${title}</h1><p>Pedidos enviados desde mesas · ${escapeHtml(currentBusiness().name)}</p></div><div class="toolbar"><button class="btn" onclick="window.click360Route('tables')">${icon('armchair')} Ver mesas</button></div></div>
	      <section class="kitchenBoard">${orders.length ? orders.map((order) => {
	        const table = tablesForBiz().find((item) => item.id === order.tableId);
	        const items = (order.items || []).filter((item) => (item.area === 'bar' ? 'bar' : 'kitchen') === area);
	        return `<article class="card kitchenTicket ${tableWaitClass(order)}">
	          <header class="kitchenTicketHeader"><span><b>${escapeHtml(table?.name || 'Mesa')}</b><small>${escapeHtml(tablePeopleLabel(table || {}))}</small></span><span class="badge gold">${escapeHtml(tableKitchenStatus(order))}</span></header>
	          <div class="kitchenTimer"><span>${icon('clock')} ${tableElapsedMinutes(order)} min</span><span>${icon(area === 'bar' ? 'wine' : 'chef-hat')} ${escapeHtml(title)}</span></div>
	          <div class="kitchenItems">${items.map((item) => { const product = productsForBiz().find((candidate) => candidate.id === (item.productId || item.id)); const recipe = restaurantRecipesForBiz().find((entry) => entry.productId && entry.productId === product?.id); const image = safeImageSrc(item.imageData || product?.imageData || ''); return `<div>${image ? `<img class="kitchenItemImage" src="${escapeHtml(image)}" alt="">` : ''}<span><b>${item.qty}× ${escapeHtml(item.name)}</b>${item.note ? `<small>${escapeHtml(item.note)}</small>` : ''}${recipe ? `<small class="kitchenRecipe"><b>Receta:</b> ${escapeHtml(recipe.ingredients || recipe.steps || recipe.name)}</small>` : ''}</span><em>${escapeHtml(item.area === 'bar' ? 'Barra' : 'Cocina')}</em></div>`; }).join('')}</div>
	          ${order.note ? `<p class="kitchenNote">${escapeHtml(order.note)}</p>` : ''}
	          <footer><button class="btn" data-kitchen-status="${actionId(order.id)}" data-kitchen-next="preparing">${icon('flame')} Preparando</button><button class="btn primary" data-kitchen-status="${actionId(order.id)}" data-kitchen-next="ready">${icon('bell-ring')} Listo</button><button class="btn silver" data-kitchen-status="${actionId(order.id)}" data-kitchen-next="delivered">${icon('check')} Entregado</button></footer>
	        </article>`;
	      }).join('') : `<article class="card empty">${icon('chef-hat')}<p>No hay pedidos pendientes para ${escapeHtml(title.toLowerCase())}.</p></article>`}</section>`;
	  }
	  function kitchenView(){ return kitchenBoardView('kitchen'); }
	  function barView(){ return kitchenBoardView('bar'); }
	  function bindKitchen() {
	    $$('[data-kitchen-status]').forEach((button) => {
	      button.onclick = () => {
	        const order = tableOrdersForBiz().find((item) => item.id === decodeActionId(button.dataset.kitchenStatus));
	        if (!order) return toast('Pedido no encontrado.', 'err');
	        const next = button.dataset.kitchenNext;
	        order.sentToKitchen = true;
	        order.kitchenStatus = next;
	        if (next === 'ready') order.readyToCharge = true;
	        order.updatedAtMs = Date.now();
	        addAudit('restaurant_kitchen_status_changed', { orderId:order.id, status:next });
	        if (!save()) return;
	        renderApp(route);
	        toast(next === 'ready' ? 'Pedido listo para cobrar' : 'Estado actualizado');
	      };
	    });
	  }

	  function logisticsSummary(route) {
	    const sales = logisticsForBiz('routeSales').filter((sale) => sale.routeId === route.id);
	    const collections = logisticsForBiz('collections').filter((collection) => collection.routeId === route.id);
	    const returns = logisticsForBiz('returns').filter((item) => item.routeId === route.id);
	    const expenses = logisticsForBiz('routeExpenses').filter((item) => item.routeId === route.id);
	    const sold = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
	    const collected = collections.reduce((sum, collection) => sum + Number(collection.amount || 0), 0);
	    const returned = returns.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.price || 0), 0);
	    const spent = expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
	    return { sales, collections, returns, expenses, sold, collected, returned, spent, expected:Math.max(0, sold + collected - spent) };
	  }
	  function logisticsView() {
	    if (!logisticsModuleEnabled()) {
	      return `<div class="pageHead"><div><h1>Logística</h1><p>Disponible al configurar el negocio como logística, distribución o transporte.</p></div></div>
	        <section class="card sectionCard"><h3>Configura tu negocio</h3><p class="cloudStatus">Selecciona Logística / distribución / transporte en Ajustes para activar rutas, vehículos, carga y liquidación.</p><button class="btn primary" onclick="window.click360Route('settings')">Ir a Ajustes</button></section>`;
	    }
	    const vehicles = logisticsForBiz('vehicles');
	    const routes = logisticsForBiz('routes').slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
	    const openRoutes = routes.filter((route) => !['closed','cancelled'].includes(route.status));
	    const closedRoutes = routes.length - openRoutes.length;
	    return `<div class="pageHead"><div><h1>Logística y rutas</h1><p>${escapeHtml(currentBusiness().name)} · transporte, carga, ventas y liquidación</p></div><div class="toolbar"><button class="btn" id="newVehicleBtn">${icon('truck')} Vehículo</button><button class="btn primary" id="newRouteBtn">${icon('map')} Ruta</button></div></div>
	      <section class="kpiGrid">
	        <article class="card kpi"><span>Vehículos</span><strong>${vehicles.length}</strong></article>
	        <article class="card kpi"><span>Rutas abiertas</span><strong>${openRoutes.length}</strong></article>
	        <article class="card kpi"><span>Rutas cerradas</span><strong>${closedRoutes}</strong></article>
	      </section>
	      <section class="logisticsLayout">
	        <article class="card sectionCard"><h3>Vehículos</h3><div class="logisticsList">${vehicles.length ? vehicles.map((vehicle) => `<div class="logisticsRow"><span><b>${escapeHtml(vehicle.plate)}</b><small>${escapeHtml(vehicle.name || vehicle.driverName || 'Sin conductor')} · ${escapeHtml(vehicle.status || 'active')}</small></span><button class="iconBtn danger" data-logistics-delete-vehicle="${actionId(vehicle.id)}" aria-label="Eliminar vehículo">${icon('trash-2')}</button></div>`).join('') : '<p class="empty">Agrega placas y conductores.</p>'}</div></article>
	        <article class="card sectionCard"><h3>Rutas</h3><div class="logisticsList">${routes.length ? routes.map((route) => {
	          const summary = logisticsSummary(route);
	          return `<button class="logisticsRouteCard" data-route-open="${actionId(route.id)}"><span><b>${escapeHtml(route.name)}</b><small>${escapeHtml(route.zone || 'Sin zona')} · ${escapeHtml(route.date || today())} · ${escapeHtml(route.status || 'draft')}</small></span><strong>${fmt(summary.sold)}</strong></button>`;
	        }).join('') : '<p class="empty">Crea una ruta para iniciar hoja de carga y liquidación.</p>'}</div></article>
	      </section>`;
	  }
	  function openVehicleModal() {
	    showModal(`<div class="modalHeader"><h2>Nuevo vehículo</h2><button class="closeBtn" data-close>×</button></div>
	      <form id="vehicleForm" class="formGrid"><div class="field"><label>Placa</label><input id="vehiclePlate" required maxlength="12" placeholder="ABC-1234"></div><div class="field"><label>Nombre / alias</label><input id="vehicleName" maxlength="60" placeholder="Camión 1"></div><div class="field"><label>Conductor</label><input id="vehicleDriver" maxlength="80"></div><div class="field"><label>Capacidad</label><input id="vehicleCapacity" type="number" min="0" step="1" value="0"></div><button class="btn" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Guardar vehículo</button></form>`);
	    $('#vehicleForm').onsubmit = (event) => {
	      event.preventDefault();
	      const input = { businessId:currentBusiness().id, plate:$('#vehiclePlate').value.trim(), name:$('#vehicleName').value.trim(), driverName:$('#vehicleDriver').value.trim(), capacity:Number($('#vehicleCapacity').value || 0), status:'active' };
	      let vehicle;
	      try { vehicle = window.CLICK360_P2_LOGISTICS?.createVehicle?.({ input, actor:logisticsActor() }) || { id:uid('vehicle'), ...input, createdAt:new Date().toISOString() }; }
	      catch (error) { return toast(error.message || 'No se pudo crear vehículo.', 'err'); }
	      state.logistics.vehicles.push(vehicle);
	      addAudit('logistics_vehicle_created', { vehicleId:vehicle.id, plate:vehicle.plate });
	      if (!save()) return;
	      closeModal(); renderApp('logistics'); toast('Vehículo guardado');
	    };
	  }
	  function openRouteModal() {
	    const vehicleOptions = logisticsForBiz('vehicles').map((vehicle) => `<option value="${actionId(vehicle.id)}">${escapeHtml(vehicle.plate)} · ${escapeHtml(vehicle.name || vehicle.driverName || '')}</option>`).join('');
	    showModal(`<div class="modalHeader"><h2>Nueva ruta</h2><button class="closeBtn" data-close>×</button></div>
	      <form id="routeForm" class="formGrid"><div class="field"><label>Nombre</label><input id="routeName" required maxlength="70" placeholder="Ruta norte"></div><div class="field"><label>Zona</label><input id="routeZone" maxlength="70" placeholder="Norte / centro"></div><div class="field"><label>Fecha</label><input id="routeDate" type="date" value="${today()}"></div><div class="field"><label>Vehículo</label><select id="routeVehicle"><option value="">Sin vehículo</option>${vehicleOptions}</select></div><div class="field"><label>Vendedor</label><input id="routeSeller" maxlength="80"></div><div class="field"><label>Ayudante</label><input id="routeHelper" maxlength="80"></div><button class="btn" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Crear ruta</button></form>`);
	    $('#routeForm').onsubmit = (event) => {
	      event.preventDefault();
	      const vehicleId = decodeActionId($('#routeVehicle').value);
	      const input = { businessId:currentBusiness().id, name:$('#routeName').value.trim(), zone:$('#routeZone').value.trim(), date:$('#routeDate').value || today(), vehicleId, sellerName:$('#routeSeller').value.trim(), helperName:$('#routeHelper').value.trim(), status:'planned' };
	      let route;
	      try { route = window.CLICK360_P2_LOGISTICS?.createRoute?.({ input, actor:logisticsActor(), vehicle:logisticsForBiz('vehicles').find((vehicle) => vehicle.id === vehicleId) }) || { id:uid('route'), ...input, createdAt:new Date().toISOString() }; }
	      catch (error) { return toast(error.message || 'No se pudo crear ruta.', 'err'); }
	      state.logistics.routes.push(route);
	      addAudit('logistics_route_created', { routeId:route.id });
	      if (!save()) return;
	      closeModal(); renderApp('logistics'); toast('Ruta creada');
	    };
	  }
	  function openRouteWorkspace(routeId) {
	    const route = logisticsForBiz('routes').find((item) => item.id === routeId);
	    if (!route) return toast('Ruta no encontrada.', 'err');
	    const summary = logisticsSummary(route);
	    const sheet = logisticsForBiz('loadSheets').find((item) => item.routeId === route.id && !['closed','cancelled'].includes(item.status));
	    const productOptions = productsForBiz().map((product) => `<option value="${actionId(product.id)}">${escapeHtml(product.name)} · ${Number(product.qty || 0)} disp.</option>`).join('');
	    showModal(`<div class="modalHeader"><div><h2>${escapeHtml(route.name)}</h2><p class="fieldHint">${escapeHtml(route.zone || 'Ruta')} · ${escapeHtml(route.date || today())}</p></div><button class="closeBtn" data-close>×</button></div>
	      <section class="kpiGrid routeKpis"><article class="card kpi"><span>Venta ruta</span><strong>${fmt(summary.sold)}</strong></article><article class="card kpi"><span>Cobrado</span><strong>${fmt(summary.collected)}</strong></article><article class="card kpi"><span>Retornos</span><strong>${fmt(summary.returned)}</strong></article></section>
	      <section class="card sectionCard"><h3>Hoja de carga</h3><div class="logisticsList">${sheet?.items?.length ? sheet.items.map((item) => `<div class="logisticsRow"><span><b>${escapeHtml(item.name)}</b><small>${item.qty} × ${fmt(item.price)}</small></span><strong>${fmt(item.total)}</strong></div>`).join('') : '<p class="empty">Sin productos cargados.</p>'}</div>
	        <form id="routeLoadForm" class="tableAddItem"><div class="field"><label>Producto</label><select id="routeLoadProduct" ${productOptions ? '' : 'disabled'}>${productOptions || '<option>Sin inventario</option>'}</select></div><div class="field"><label>Cant.</label><input id="routeLoadQty" type="number" min="1" value="1"></div><button class="btn silver" type="submit" ${productOptions ? '' : 'disabled'}>Agregar carga</button></form></section>
	      <section class="card sectionCard"><h3>Venta, cobranza y retorno</h3>
	        <form id="routeSaleForm" class="formGrid"><div class="field"><label>Cliente</label><input id="routeCustomer" maxlength="80" placeholder="Cliente de ruta"></div><div class="field"><label>Producto vendido</label><select id="routeSaleProduct" ${productOptions ? '' : 'disabled'}><option value="">Venta manual</option>${productOptions}</select></div><div class="field"><label>Cant.</label><input id="routeSaleQty" type="number" min="1" value="1"></div><div class="field"><label>Total venta</label><input id="routeSaleTotal" type="number" min="0" step="0.01" value="0" placeholder="Se calcula si eliges producto"></div><div class="field"><label>Tipo</label><select id="routePaymentType"><option value="cash">Contado</option><option value="credit">Crédito</option><option value="transfer">Transferencia</option></select></div><button class="btn primary" type="submit">Registrar venta</button></form>
	        <form id="routeCollectionForm" class="formGrid"><div class="field"><label>Cobranza</label><input id="routeCollectionAmount" type="number" min="0" step="0.01" value="0"></div><div class="field"><label>Método</label><select id="routeCollectionMethod"><option value="cash">Efectivo</option><option value="transfer">Transferencia</option></select></div><button class="btn silver" type="submit">Registrar cobro</button></form>
	        <form id="routeReturnForm" class="formGrid"><div class="field"><label>Producto devuelto</label><select id="routeReturnProduct" ${productOptions ? '' : 'disabled'}>${productOptions || '<option>Sin inventario</option>'}</select></div><div class="field"><label>Cant.</label><input id="routeReturnQty" type="number" min="1" value="1"></div><div class="field"><label>Estado</label><select id="routeReturnCondition"><option value="sellable">Vendible</option><option value="damaged">Dañado</option></select></div><button class="btn silver" type="submit" ${productOptions ? '' : 'disabled'}>Registrar retorno</button></form></section>
	      <div class="tableCheckoutActions"><button class="btn" id="routePrintBtn" type="button">${icon('printer')} Imprimir hoja</button><button class="btn primary" id="routeCloseBtn" type="button">Liquidar ruta</button></div>`);
	    $('#routeLoadForm').onsubmit = (event) => {
	      event.preventDefault();
	      const productId = decodeActionId($('#routeLoadProduct').value);
	      const product = productsForBiz().find((item) => item.id === productId);
	      const qty = Math.max(1, Math.trunc(Number($('#routeLoadQty').value || 1)));
	      if (!product || qty > Number(product.qty || 0)) return toast('Inventario insuficiente para cargar ruta.', 'err');
	      let currentSheet = sheet || { id:uid('loadsheet'), businessId:currentBusiness().id, routeId:route.id, status:'draft', items:[], createdAt:new Date().toISOString() };
	      if (!sheet) state.logistics.loadSheets.push(currentSheet);
	      const existing = currentSheet.items.find((item) => item.productId === product.id);
	      if (existing) { existing.qty += qty; existing.total = Number(existing.qty || 0) * Number(existing.price || 0); }
	      else currentSheet.items.push({ id:uid('loaditem'), productId:product.id, code:product.code, name:product.name, qty, price:Number(product.price || 0), total:qty * Number(product.price || 0), createdAt:new Date().toISOString() });
	      currentSheet.updatedAtMs = Date.now();
	      addAudit('logistics_load_item_added', { routeId:route.id, productId:product.id, qty });
	      if (!save()) return;
	      closeModal(); openRouteWorkspace(route.id);
	    };
	    $('#routeSaleForm').onsubmit = (event) => {
	      event.preventDefault();
	      const productId = decodeActionId($('#routeSaleProduct')?.value || '');
	      const product = productsForBiz().find((item) => item.id === productId);
	      const qty = Math.max(1, Math.trunc(Number($('#routeSaleQty')?.value || 1)));
	      let total = Math.max(0, Number($('#routeSaleTotal').value || 0));
	      const items = [];
	      if (product) {
	        const loadedQty = (sheet?.items || []).filter((item) => item.productId === product.id).reduce((sum, item) => sum + Number(item.qty || 0), 0);
	        const soldQty = logisticsForBiz('routeSales').filter((sale) => sale.routeId === route.id).flatMap((sale) => sale.items || []).filter((item) => item.productId === product.id).reduce((sum, item) => sum + Number(item.qty || 0), 0);
	        const availableQty = Math.max(0, loadedQty - soldQty);
	        if (qty > availableQty) return toast(`Carga insuficiente para vender. Disponible en ruta: ${availableQty}.`, 'err');
	        const unitPrice = Number(product.price || 0);
	        total = total > 0 ? total : qty * unitPrice;
	        items.push({ id:uid('routesaleitem'), productId:product.id, code:product.code, name:product.name, qty, price:qty ? total / qty : unitPrice, total, createdAt:new Date().toISOString() });
	      }
	      if (!total) return toast(product ? 'El producto necesita precio o total manual.' : 'Ingresa el total de la venta de ruta.', 'err');
	      const paymentType = $('#routePaymentType').value;
	      const sale = { id:uid('routesale'), businessId:currentBusiness().id, routeId:route.id, customerName:$('#routeCustomer').value.trim() || 'Cliente de ruta', items, subtotal:total, discount:0, total, paymentType, paidAmount:paymentType === 'credit' ? 0 : total, balance:paymentType === 'credit' ? total : 0, status:paymentType === 'credit' ? 'credit' : 'paid', createdAt:new Date().toISOString(), createdAtMs:Date.now(), createdBy:authUser().name };
	      state.logistics.routeSales.push(sale);
	      addAudit('logistics_route_sale_created', { routeId:route.id, saleId:sale.id, total, productId:product?.id || '' });
	      if (!save()) return;
	      closeModal(); openRouteWorkspace(route.id);
	    };
	    $('#routeCollectionForm').onsubmit = (event) => {
	      event.preventDefault();
	      const amount = Math.max(0, Number($('#routeCollectionAmount').value || 0));
	      if (!amount) return toast('Ingresa el valor cobrado.', 'err');
	      state.logistics.collections.push({ id:uid('collection'), businessId:currentBusiness().id, routeId:route.id, amount, method:$('#routeCollectionMethod').value, createdAt:new Date().toISOString(), createdAtMs:Date.now(), createdBy:authUser().name });
	      addAudit('logistics_collection_created', { routeId:route.id, amount });
	      if (!save()) return;
	      closeModal(); openRouteWorkspace(route.id);
	    };
	    $('#routeReturnForm').onsubmit = (event) => {
	      event.preventDefault();
	      const productId = decodeActionId($('#routeReturnProduct').value);
	      const product = productsForBiz().find((item) => item.id === productId);
	      const qty = Math.max(1, Math.trunc(Number($('#routeReturnQty').value || 1)));
	      if (!product) return toast('Producto no encontrado.', 'err');
	      state.logistics.returns.push({ id:uid('return'), businessId:currentBusiness().id, routeId:route.id, productId:product.id, code:product.code, name:product.name, qty, price:Number(product.price || 0), condition:$('#routeReturnCondition').value, createdAt:new Date().toISOString(), createdAtMs:Date.now(), createdBy:authUser().name });
	      addAudit('logistics_return_created', { routeId:route.id, productId:product.id, qty });
	      if (!save()) return;
	      closeModal(); openRouteWorkspace(route.id);
	    };
	    $('#routeCloseBtn').onclick = () => {
	      const next = logisticsSummary(route);
	      const settlement = { id:uid('settlement'), businessId:currentBusiness().id, routeId:route.id, status:'closed', totalSales:next.sold, totalCollections:next.collected, totalReturns:next.returned, totalExpenses:next.spent, expectedCash:next.expected, closedAt:new Date().toISOString(), createdAtMs:Date.now(), createdBy:authUser().name };
	      state.logistics.routeSettlements.push(settlement);
	      route.status = 'closed';
	      route.closedAt = new Date().toISOString();
	      addAudit('logistics_route_closed', { routeId:route.id, settlementId:settlement.id, expectedCash:settlement.expectedCash });
	      if (!save()) return;
	      closeModal(); renderApp('logistics'); toast('Ruta liquidada');
	    };
	    $('#routePrintBtn').onclick = () => {
	      const html = `<h1>${escapeHtml(route.name)}</h1><p>${escapeHtml(route.zone || '')} · ${escapeHtml(route.date || '')}</p><h2>Hoja de carga</h2>${(sheet?.items || []).map((item) => `<p>${escapeHtml(item.name)} · ${item.qty} · ${fmt(item.total)}</p>`).join('') || '<p>Sin carga</p>'}<h2>Liquidación</h2><p>Venta: ${fmt(summary.sold)}</p><p>Cobrado: ${fmt(summary.collected)}</p><p>Retornos: ${fmt(summary.returned)}</p>`;
	      const popup = window.open('', '_blank');
	      if (!popup) return toast('Permite ventanas emergentes para imprimir.', 'err');
	      popup.document.write(`<!doctype html><title>Ruta</title><body>${html}</body>`);
	      popup.document.close();
	      popup.print();
	    };
	    refreshIcons();
	  }
	  function bindLogistics() {
	    $('#newVehicleBtn')?.addEventListener('click', openVehicleModal);
	    $('#newRouteBtn')?.addEventListener('click', openRouteModal);
	    $$('[data-route-open]').forEach((button) => button.onclick = () => openRouteWorkspace(decodeActionId(button.dataset.routeOpen)));
	    $$('[data-logistics-delete-vehicle]').forEach((button) => button.onclick = () => {
	      const vehicleId = decodeActionId(button.dataset.logisticsDeleteVehicle);
	      if (logisticsForBiz('routes').some((route) => route.vehicleId === vehicleId && !['closed','cancelled'].includes(route.status))) return toast('No elimines un vehículo con rutas abiertas.', 'err');
	      state.logistics.vehicles = state.logistics.vehicles.filter((vehicle) => vehicle.id !== vehicleId || vehicle.businessId !== currentBusiness().id);
	      addAudit('logistics_vehicle_deleted', { vehicleId });
	      if (!save()) return;
	      renderApp('logistics');
	    });
	  }

	  const FINANCE_CONFIG = Object.freeze({
	    payments: { title:'Pagos mensuales', icon:'calendar-clock', fields:['name','category','amount','dueDate','notes'] },
	    loans: { title:'Bancos / préstamos manuales', icon:'landmark', fields:['name','amount','monthlyAmount','dueDate','status','notes'] },
	    envelopes: { title:'Sobres de dinero', icon:'mail', fields:['name','targetAmount','savedAmount','category','notes'] },
	    goals: { title:'Metas / sueños / ahorros', icon:'target', fields:['name','targetAmount','savedAmount','dueDate','notes'] }
	  });
	  function financeEntryStatus(kind, entry) {
	    if (kind === 'payments' && entry.status !== 'paid' && entry.dueDate && entry.dueDate < today()) return 'atrasado';
	    if (entry.status === 'paid') return 'pagado';
	    return entry.status === 'pending' ? 'pendiente' : 'activo';
	  }
	  function financeView() {
	    const sections = Object.entries(FINANCE_CONFIG).map(([kind, config]) => {
	      const entries = financeForBiz(kind);
	      const total = entries.reduce((sum, entry) => sum + Number(entry.amount || entry.targetAmount || 0), 0);
	      return `<section class="card financeCard"><header><span>${icon(config.icon)}<b>${escapeHtml(config.title)}</b></span><button class="iconBtn gold" data-finance-add="${kind}" title="Agregar" aria-label="Agregar">${icon('plus')}</button></header><strong>${fmt(total)}</strong>
	        <div class="financeList">${entries.length ? entries.map((entry) => {
	          const progress = kind === 'goals' && Number(entry.targetAmount) > 0 ? ` · ${Math.min(100, Math.round(Number(entry.savedAmount || 0) / Number(entry.targetAmount) * 100))}%` : '';
	          const status = financeEntryStatus(kind, entry);
	          return `<article class="financeEntry"><div><b>${escapeHtml(entry.name)}</b><small>${escapeHtml(entry.category || '')}${entry.dueDate ? ` · ${escapeHtml(entry.dueDate)}` : ''}${progress}</small></div><span><em class="${entry.status === 'paid' ? 'paid' : ''}">${escapeHtml(status)}</em>${kind === 'payments' ? `<button class="iconBtn" data-finance-toggle="${kind}:${actionId(entry.id)}" title="Cambiar estado">${icon('check')}</button>` : ''}<button class="iconBtn danger" data-finance-delete="${kind}:${actionId(entry.id)}" title="Eliminar">${icon('trash-2')}</button></span></article>`;
	        }).join('') : '<p class="empty">Sin registros.</p>'}</div></section>`;
	    }).join('');
	    return `<div class="pageHead"><div><h1>Finanzas</h1><p>Organización manual. No conecta cuentas bancarias ni modifica caja.</p></div></div><section class="financeGrid">${sections}</section><p class="financeSecurity">${icon('shield-check')} CLICK 360 no solicita usuarios, claves ni tokens bancarios.</p>`;
	  }
	  function openFinanceModal(kind) {
	    const config = FINANCE_CONFIG[kind];
	    if (!config) return;
	    const labels = { name:'Nombre', category:'Categoría', amount:'Monto / saldo', monthlyAmount:'Cuota mensual', targetAmount:'Monto objetivo', savedAmount:'Monto separado / ahorrado', dueDate:'Fecha de pago u objetivo', status:'Estado', notes:'Notas' };
	    const fieldsHtml = config.fields.map((field) => {
	      let control;
	      if (field === 'notes') control = `<textarea id="finance-${field}"></textarea>`;
	      else if (field === 'category' && kind === 'payments') {
	        control = `<select id="finance-${field}"><option>Arriendo</option><option>Luz</option><option>Agua</option><option>Internet</option><option>Proveedor</option><option>Sueldo</option><option>Banco</option><option>Tarjeta</option><option>Préstamo</option><option>Otro</option></select>`;
	      } else if (field === 'status') {
	        control = `<select id="finance-${field}"><option value="active">Activo</option><option value="pending">Pendiente</option><option value="paid">Pagado</option></select>`;
	      } else {
	        control = `<input id="finance-${field}" ${['amount','monthlyAmount','targetAmount','savedAmount'].includes(field) ? 'inputmode="decimal"' : ''} ${field === 'dueDate' ? 'type="date"' : ''} ${field === 'name' ? 'required' : ''}>`;
	      }
	      return `<div class="field ${field === 'notes' ? 'full' : ''}"><label>${labels[field]}</label>${control}</div>`;
	    }).join('');
	    showModal(`<div class="modalHeader"><h2>${escapeHtml(config.title)}</h2><button class="closeBtn" data-close>×</button></div><form id="financeForm" class="formGrid financeEntryForm">${fieldsHtml}<button class="btn" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Guardar</button></form>`);
	    $('#financeForm').onsubmit = async (event) => {
	      event.preventDefault();
	      const previousState = cloneState(state);
	      const businessId = currentBusiness().id;
	      const entry = { id:uid(`finance-${kind}`), operationId:uid('financeop'), businessId, status:kind === 'payments' ? 'pending' : 'active', createdAt:new Date().toISOString() };
	      config.fields.forEach((field) => {
	        const value = $(`#finance-${field}`).value.trim();
	        entry[field] = ['amount','monthlyAmount','targetAmount','savedAmount'].includes(field) ? Math.max(0, parseMoney(value) || 0) : value;
	      });
	      if (!entry.name) return toast('Escribe un nombre.', 'err');
	      state.finance[kind].push(entry);
	      addAudit('finance_entry_created', { kind, entryId:entry.id });
	      const committed = await commitCriticalMutation(previousState, 'finance_entry_created', (next) =>
	        next.finance?.[kind]?.some((item) => item.id === entry.id && item.businessId === businessId));
	      if (!committed.ok) return;
	      closeModal(); renderApp('finance'); toast('Registro financiero guardado');
	    };
	  }
	  function bindFinance() {
	    $$('[data-finance-add]').forEach((button) => button.onclick = () => openFinanceModal(button.dataset.financeAdd));
	    $$('[data-finance-toggle]').forEach((button) => button.onclick = async () => {
	      const [kind, encodedId] = button.dataset.financeToggle.split(':');
	      const entry = financeForBiz(kind).find((item) => item.id === decodeActionId(encodedId));
	      if (!entry) return;
	      const previousState = cloneState(state);
	      const businessId = currentBusiness().id;
	      entry.status = entry.status === 'paid' ? 'pending' : 'paid';
	      entry.paidAt = entry.status === 'paid' ? new Date().toISOString() : null;
	      const expectedStatus = entry.status;
	      const committed = await commitCriticalMutation(previousState, 'finance_payment_status_changed', (next) =>
	        next.finance?.[kind]?.some((item) => item.id === entry.id && item.businessId === businessId && item.status === expectedStatus));
	      if (!committed.ok) return;
	      renderApp('finance');
	    });
	    $$('[data-finance-delete]').forEach((button) => button.onclick = async () => {
	      const [kind, encodedId] = button.dataset.financeDelete.split(':');
	      const entryId = decodeActionId(encodedId);
	      if (!FINANCE_CONFIG[kind] || !confirm('¿Eliminar este registro financiero manual?')) return;
	      const previousState = cloneState(state);
	      const businessId = currentBusiness().id;
	      state.finance[kind] = state.finance[kind].filter((item) => item.id !== entryId || item.businessId !== businessId);
	      const committed = await commitCriticalMutation(previousState, 'finance_entry_deleted', (next) =>
	        !next.finance?.[kind]?.some((item) => item.id === entryId && item.businessId === businessId));
	      if (!committed.ok) return;
	      renderApp('finance');
	    });
	  }

	  function helpView() {
	    const categories = [...new Set(HELP_TOPICS.map((topic) => topic.category))];
	    return `<div class="pageHead"><div><h1>Centro de ayuda</h1><p>Respuestas claras para trabajar con CLICK 360.</p></div></div>
	      <div class="helpSearch"><span>${icon('search')}</span><input id="helpSearchInput" type="search" placeholder="Buscar: cerrar caja, etiqueta, mesa..."></div>
	      <div class="helpSuggestions" aria-label="Búsquedas sugeridas">${['crear producto','cerrar caja','imprimir 1 etiqueta','organizar mesas','instalar app','sin internet'].map((query) => `<button type="button" data-help-query="${escapeHtml(query)}">${escapeHtml(query)}</button>`).join('')}</div>
	      <div class="helpCategories">${categories.map((category) => `<button type="button" data-help-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join('')}</div>
	      <section id="helpResults" class="helpResults">${helpTopicCards(HELP_TOPICS)}</section>
	      <a class="btn whatsapp block helpSupport" href="https://wa.me/593969399562?text=${encodeURIComponent('Hola CLICK 360, necesito ayuda')}" target="_blank" rel="noopener noreferrer">${icon('message-circle')} Contactar soporte por WhatsApp</a>`;
	  }
	  function helpTopicCards(topics) {
	    return topics.length ? topics.map((topic) => `<details class="card helpTopic"><summary><span><small>${escapeHtml(topic.category)}</small>${escapeHtml(topic.title)}</span>${icon('chevron-down')}</summary><ol>${(topic.steps || [topic.body]).filter(Boolean).map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol></details>`).join('') : '<div class="card empty">No encontramos una guía con esas palabras. Prueba “cerrar caja”, “etiqueta” o “sin internet”.</div>';
	  }
		  function bindHelp() {
		    const input = $('#helpSearchInput');
		    const filter = (category = '') => {
		      const query = String(input?.value || '').trim();
		      const available = HELP_TOPICS.filter((topic) => !category || topic.category === category);
		      const topics = query
		        ? (window.CLICK360_SMART_PRINT?.searchHelp(available, query) || [])
		        : available;
		      $('#helpResults').innerHTML = helpTopicCards(topics);
	      refreshIcons($('#helpResults'));
	    };
	    input?.addEventListener('input', () => filter());
	    $$('[data-help-query]').forEach((button) => button.onclick = () => {
	      input.value = button.dataset.helpQuery;
	      filter();
	      input.focus();
	    });
	    $$('[data-help-category]').forEach((button) => button.onclick = () => {
	      const active = button.classList.toggle('active');
	      $$('[data-help-category]').forEach((candidate) => { if (candidate !== button) candidate.classList.remove('active'); });
	      filter(active ? button.dataset.helpCategory : '');
	    });
	  }

		function moreView(){
		    const ownerTools = isOwnerUser() ? `
		      <button class="card bigRow" data-more="backup"><span>${icon('cloud-check')} Respaldo y nube</span>${icon('chevron-right')}</button>
		      <button class="card bigRow" data-more="invoices"><span>${icon('receipt-text')} Facturas de proveedores</span>${icon('chevron-right')}</button>
		      <button class="card bigRow" data-more="settings"><span>${icon('settings')} Ajustes</span>${icon('chevron-right')}</button>
		    ` : `<button class="card bigRow" data-more="settings"><span>${icon('user-round-cog')} Mi perfil</span>${icon('chevron-right')}</button>`;
			    return `<div class="pageHead"><div><h1>Más</h1></div></div><section class="moreList">
			      ${ownerTools}
			      <button class="card bigRow" data-more="printing"><span>${icon('printer')} Centro de impresión</span>${icon('chevron-right')}</button>
			      <button class="card bigRow" data-more="access"><span>${icon('badge-dollar-sign')} Mi plan y acceso</span>${icon('chevron-right')}</button>
		      <button class="card bigRow" data-more="legal"><span>${icon('shield-check')} Términos y privacidad</span>${icon('chevron-right')}</button>
		      <button class="card bigRow" id="calculatorMoreBtn"><span>${icon('calculator')} Calculadora</span>${icon('chevron-right')}</button>
		      <button class="card bigRow" id="installAppBtn"><span>${icon('smartphone')} Instalar CLICK 360 como app</span>${icon('chevron-right')}</button>
	      <button class="card bigRow" data-more="help"><span>${icon('circle-help')} Centro de ayuda</span>${icon('chevron-right')}</button>
		      <button class="btn block" id="logoutMore">Cerrar sesión</button>
			    </section>`;
			  }

			  function printingPreferencesKey() {
			    const identity = window.click360DebugSyncIdentity?.() || {};
			    return activeTenantContext?.authUid && activeTenantContext?.tenantKey && currentBusiness()?.id && identity.deviceId
			      ? `CLICK360:V16:PRINTING:${activeTenantContext.authUid}:${activeTenantContext.tenantKey}:${currentBusiness().id}:${identity.deviceId}` : '';
			  }
		  function printingPreferences() {
		    try {
		      const parsed = JSON.parse(localStorage.getItem(printingPreferencesKey()) || '{}');
		      return { provider: ['system', 'pdf', 'm02x-bluetooth', 'native-bridge'].includes(parsed.provider) ? parsed.provider : 'system', media: [...Object.keys(RECEIPT_WIDTH_PRESETS), 'a4'].includes(parsed.media) ? parsed.media : 'receipt-80', copies: Math.max(1, Math.min(20, Number(parsed.copies || 1))) };
		    } catch { return { provider: 'system', media: 'receipt-80', copies: 1 }; }
		  }
			  function savePrintingPreferences(next) {
			    try { localStorage.setItem(printingPreferencesKey(), JSON.stringify(next)); } catch {}
			  }
      function receiptPaperPresetOptionsHtml(selected = 'thermal-80') {
        return Object.entries(RECEIPT_PAPER_PRESETS)
          .map(([value, preset]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${escapeHtml(preset.label)}</option>`)
          .join('');
      }
      function receiptWidthOptionsHtml(selected = 'receipt-80') {
        return Object.entries(RECEIPT_WIDTH_PRESETS)
          .map(([value, preset]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${escapeHtml(preset.label)}</option>`)
          .join('');
      }
      function receiptLegacyPaperType(template = {}) {
        const width = String(template.width || 'receipt-80');
        if (width === 'receipt-57') return 'thermal-57';
        if (width === 'receipt-58') return 'thermal-58';
        if (width === 'receipt-60') return 'thermal-58';
        if (width === 'receipt-76') return 'continuous-80';
        if (width === 'receipt-80') return 'thermal-80';
        return 'custom';
      }
      function receiptPaperFromTemplate(template = {}) {
        const paperType = RECEIPT_PAPER_PRESETS[template.paperType] ? template.paperType : receiptLegacyPaperType(template);
        const preset = RECEIPT_PAPER_PRESETS[paperType] || RECEIPT_PAPER_PRESETS['thermal-80'];
        const receiptWidthMm = clampNumber(template.receiptWidthMm ?? template.labelWidthMm ?? (template.width === 'receipt-custom' ? template.customWidthMm : preset.receiptWidthMm), 30, 210, preset.receiptWidthMm);
        const receiptHeightMm = clampNumber(template.receiptHeightMm ?? template.labelHeightMm ?? preset.receiptHeightMm, 20, 420, preset.receiptHeightMm);
        const columns = Math.round(clampNumber(template.columns ?? preset.columns, 1, 6, preset.columns));
        const rows = Math.round(clampNumber(template.rows ?? preset.rows, 1, 20, preset.rows));
        const gapXmm = clampNumber(template.gapXmm ?? preset.gapXmm, 0, 40, preset.gapXmm);
        const gapYmm = clampNumber(template.gapYmm ?? preset.gapYmm, 0, 40, preset.gapYmm);
        const marginTopMm = clampNumber(template.marginTopMm ?? preset.marginTopMm, 0, 80, preset.marginTopMm);
        const marginRightMm = clampNumber(template.marginRightMm ?? preset.marginRightMm, 0, 80, preset.marginRightMm);
        const marginBottomMm = clampNumber(template.marginBottomMm ?? preset.marginBottomMm, 0, 80, preset.marginBottomMm);
        const marginLeftMm = clampNumber(template.marginLeftMm ?? preset.marginLeftMm, 0, 80, preset.marginLeftMm);
        const minimumMediaWidth = marginLeftMm + marginRightMm + columns * receiptWidthMm + Math.max(0, columns - 1) * gapXmm;
        const minimumMediaHeight = marginTopMm + marginBottomMm + rows * receiptHeightMm + Math.max(0, rows - 1) * gapYmm;
        const mediaType = template.mediaType || preset.mediaType || 'receipt';
        const continuous = mediaType === 'receipt' || mediaType === 'continuous';
        const mediaWidthMm = clampNumber(template.mediaWidthMm ?? preset.mediaWidthMm ?? minimumMediaWidth, Math.max(30, minimumMediaWidth), 420, Math.max(preset.mediaWidthMm || 0, minimumMediaWidth));
        const mediaHeightMm = continuous
          ? 0
          : clampNumber(template.mediaHeightMm ?? preset.mediaHeightMm ?? minimumMediaHeight, Math.max(20, minimumMediaHeight), 900, Math.max(preset.mediaHeightMm || 0, minimumMediaHeight));
        return {
          paperType,
          label:preset.label,
          mediaType,
          receiptWidthMm,
          receiptHeightMm,
          mediaWidthMm,
          mediaHeightMm,
          columns,
          rows,
          gapXmm,
          gapYmm,
          marginTopMm,
          marginRightMm,
          marginBottomMm,
          marginLeftMm,
          startSlot:Math.round(clampNumber(template.startSlot, 1, columns * rows, 1)),
          xOffsetMm:clampNumber(template.xOffsetMm, -40, 40, 0),
          yOffsetMm:clampNumber(template.yOffsetMm, -40, 40, 0),
          contentRotation:[0,90,180,270].includes(Number(template.contentRotation)) ? Number(template.contentRotation) : 0,
          dpi:Math.round(clampNumber(template.dpi ?? preset.dpi, 72, 600, preset.dpi || 203))
        };
      }
      function receiptWidthMmFromTemplate(template = {}) {
        return receiptPaperFromTemplate(template).receiptWidthMm;
      }
      function receiptPrintMedia(template = {}) {
        const paper = receiptPaperFromTemplate(template);
        if (paper.mediaType === 'receipt' || paper.mediaType === 'continuous') {
          if (paper.receiptWidthMm <= 58) return 'receipt-58';
          if (paper.receiptWidthMm <= 60) return 'receipt-60';
          if (paper.receiptWidthMm <= 76) return 'receipt-76';
          return 'receipt-80';
        }
        return 'label';
      }

      function normalizeReceiptBlocks(blocks) {
        const known = new Set(RECEIPT_BLOCKS.map((block) => block.id));
        const source = Array.isArray(blocks) ? blocks : [];
        const normalized = source
          .filter((block) => known.has(block?.id))
          .map((block) => ({ id:block.id, visible:block.visible !== false }));
        RECEIPT_BLOCKS.forEach((block) => {
          if (!normalized.some((entry) => entry.id === block.id)) normalized.push({ id:block.id, visible:true });
        });
        return normalized;
      }

		  function receiptTemplatePreferences() {
			    const template = currentBusiness()?.settings?.receiptTemplate || {};
          const width = RECEIPT_WIDTH_PRESETS[template.width] ? template.width : 'receipt-80';
          const paper = receiptPaperFromTemplate(template);
          const effectiveWidthMm = paper.receiptWidthMm;
			    return {
			      mode: ['simple','expert'].includes(template.mode) ? template.mode : 'simple',
			      footer: RECEIPT_FOOTER_TEXT,
			      note: String(template.note || RECEIPT_DEFAULT_NOTE).slice(0, 160),
			      width,
            customWidthMm: effectiveWidthMm,
            paperType: paper.paperType,
            mediaType: paper.mediaType,
            receiptWidthMm: paper.receiptWidthMm,
            receiptHeightMm: paper.receiptHeightMm,
            mediaWidthMm: paper.mediaWidthMm,
            mediaHeightMm: paper.mediaHeightMm,
            columns: paper.columns,
            rows: paper.rows,
            gapXmm: paper.gapXmm,
            gapYmm: paper.gapYmm,
            marginTopMm: paper.marginTopMm,
            marginRightMm: paper.marginRightMm,
            marginBottomMm: paper.marginBottomMm,
            marginLeftMm: paper.marginLeftMm,
            startSlot: paper.startSlot,
            xOffsetMm: paper.xOffsetMm,
            yOffsetMm: paper.yOffsetMm,
            contentRotation: paper.contentRotation,
            dpi: paper.dpi,
			      showLogo: template.showLogo !== false,
			      showCustomer: template.showCustomer !== false,
			      showSeller: template.showSeller !== false,
			      showPayment: template.showPayment !== false,
			      showTax: template.showTax !== false,
			      showThanks: template.showThanks !== false,
			      showDividers: template.showDividers !== false,
			      align: ['left','center'].includes(template.align) ? template.align : 'center',
			      paddingMm: clampNumber(template.paddingMm, 1, 8, effectiveWidthMm <= 60 ? 2 : 3),
		      textScale: clampNumber(template.textScale, 0.78, 1.25, 1),
		      logoHeightMm: clampNumber(template.logoHeightMm, 12, 38, 22),
            blocks: normalizeReceiptBlocks(template.blocks)
		    };
			  }
			  function saveReceiptTemplatePreferences(next) {
			    const business = currentBusiness();
			    if (!business) return false;
			    business.settings ||= {};
			    business.settings.receiptTemplate = { ...receiptTemplatePreferences(), ...next, footer:RECEIPT_FOOTER_TEXT, updatedAt:new Date().toISOString() };
			    addAudit('receipt_template_updated', { businessId:business.id, width:business.settings.receiptTemplate.width });
			    return save();
			  }
      function receiptTemplateSampleSale() {
        return {
          id:'sample-ticket',
          businessId:currentBusiness()?.id || 'sample',
          when:nowLabel(),
          method:'Efectivo',
          customer:'Cliente ejemplo',
          customerCedula:'1234567890',
          customerPhone:'0999999999',
          createdBy:authUser().name || 'CLICK 360',
          items:[
            { id:'sample-1', name:'Producto ejemplo', qty:1, price:12, total:12 },
            { id:'sample-2', name:'Servicio adicional', qty:2, price:3.5, total:7 }
          ],
          subtotal:19,
          receiptSubtotal:19,
          iva:0,
          discount:0,
          total:19,
          received:20,
          tendered:20,
          change:1,
          balance:0
        };
      }
      function receiptLineTotal(i) {
        return Number(i.total ?? (i.price*i.qty) ?? 0);
      }
      function receiptBlockStyle(template, id) {
        const blocks = normalizeReceiptBlocks(template.blocks);
        const index = blocks.findIndex((block) => block.id === id);
        const block = blocks[index];
        return `order:${index < 0 ? 99 : index};display:${block?.visible === false ? 'none' : 'block'};`;
      }
      function buildReceiptHtml(s, business = currentBusiness(), template = receiptTemplatePreferences()) {
        const bizSettings = business?.settings || {};
        const paper = receiptPaperFromTemplate(template);
        const receiptWidthMm = paper.receiptWidthMm;
        const fixedReceiptHeight = paper.mediaType === 'sheet' || paper.mediaType === 'roll' || paper.mediaType === 'custom';
        const compactReceipt = receiptWidthMm <= 60;
        const scale = clampNumber(template.textScale, 0.78, 1.25, 1);
        const baseFont = (compactReceipt ? 9.2 : 11.5) * scale;
        const receiptPaddingMm = clampNumber(template.paddingMm, 1, 8, compactReceipt ? 2 : 3);
        const textAlign = template.align === 'left' ? 'left' : 'center';
        const divider = template.showDividers ? '<div style="border-top:1px dashed #000; margin:7px 0;"></div>' : '<div style="height:6px;"></div>';
        const infoLine = (label, value, show = true) => show && value ? `<div style="display:flex;justify-content:space-between;gap:5px;margin-bottom:3px;"><span>${escapeHtml(label)}</span><span style="text-align:right;word-break:break-word;">${escapeHtml(value)}</span></div>` : '';
        const receiptLogoSrc = safeImageSrc(bizSettings.logoUrl);
        const logoUrl = receiptLogoSrc && template.showLogo ? `<div style="text-align:${textAlign}; margin-bottom:5px;"><img src="${escapeHtml(receiptLogoSrc)}" style="max-width:${Math.max(24, receiptWidthMm - receiptPaddingMm * 2)}mm; max-height:${clampNumber(template.logoHeightMm, 12, 38, compactReceipt ? 18 : 24)}mm; object-fit:contain;"></div>` : '';
        const currentIva = Number(s.taxRate ?? bizSettings.tax?.rate ?? bizSettings.iva ?? 0);
        const items = saleItems(s).length ? saleItems(s) : (s.items || []);
        return `
          <div class="receiptPrintBody" style="box-sizing:border-box;font-family:monospace;color:#000;font-size:${baseFont}px;margin:0 auto;padding:${receiptPaddingMm}mm;width:${receiptWidthMm}mm;max-width:${receiptWidthMm}mm;${fixedReceiptHeight ? `height:${paper.receiptHeightMm}mm;overflow:hidden;` : ''}background:#fff;line-height:${compactReceipt ? 1.22 : 1.32};overflow-wrap:anywhere;text-align:left;"><div style="display:flex;flex-direction:column;">
            <section data-receipt-block="branding" style="${receiptBlockStyle(template, 'branding')}">
            ${logoUrl}
            <h2 style="font-size:${baseFont * 1.25}px;margin:0 0 2px;text-align:${textAlign};font-weight:bold;word-break:break-word;">${escapeHtml(business?.name || 'CLICK 360')}</h2>
            ${bizSettings.ruc ? `<div style="text-align:${textAlign};font-size:${baseFont * .84}px;">RUC/ID: ${escapeHtml(bizSettings.ruc)}</div>` : ''}
            ${bizSettings.phone ? `<div style="text-align:${textAlign};font-size:${baseFont * .84}px;">Tel: ${escapeHtml(bizSettings.phone)}</div>` : ''}
            ${bizSettings.address ? `<div style="text-align:${textAlign};font-size:${baseFont * .84}px;">${escapeHtml(bizSettings.address)}</div>` : ''}</section>
            <section data-receipt-block="document" style="${receiptBlockStyle(template, 'document')}">
            <div style="text-align:center;margin:7px 0;font-weight:bold;font-size:${baseFont * 1.08}px;${template.showDividers ? 'border-top:1px dashed #000;border-bottom:1px dashed #000;padding:4px 0;' : ''}">COMPROBANTE DE VENTA</div>
            ${infoLine('No. Ticket:', String(s.id || '').slice(-6).toUpperCase())}
            ${infoLine('Fecha/Hora:', s.when || nowLabel())}</section>
            <section data-receipt-block="customer" style="${receiptBlockStyle(template, 'customer')}">
            ${infoLine('Método:', s.method, template.showPayment)}
            ${infoLine('Cliente:', s.customer, template.showCustomer)}
            ${infoLine('Cédula/RUC:', s.customerCedula, template.showCustomer)}
            ${infoLine('Teléfono:', s.customerPhone, template.showCustomer)}
            ${infoLine('Vendedor:', s.createdBy || s.user || 'Sistema', template.showSeller)}</section>
            <section data-receipt-block="items" style="${receiptBlockStyle(template, 'items')}">
            ${divider}
            <table style="width:100%;font-size:${baseFont * .9}px;border-collapse:collapse;table-layout:fixed;">
              <thead><tr style="border-bottom:${template.showDividers ? '1px solid #000' : '0'};"><th style="text-align:left;">Detalle</th><th style="text-align:center;width:${compactReceipt ? 8 : 12}mm;">Cant</th><th style="text-align:right;width:${compactReceipt ? 15 : 22}mm;">Total</th></tr></thead>
              <tbody>${items.map(i=>`<tr><td style="padding:3px 3px 3px 0;word-break:break-word;">${escapeHtml(i.name)}</td><td style="text-align:center;">${i.qty}</td><td style="text-align:right;word-break:normal;">${fmt(receiptLineTotal(i))}</td></tr>`).join('')}</tbody>
            </table></section>
            <section data-receipt-block="payment" style="${receiptBlockStyle(template, 'payment')}">
            ${divider}
            ${infoLine('Subtotal:', fmt(s.receiptSubtotal ?? (Number(s.subtotal || 0) + Number(s.discount || 0))))}
            ${template.showTax && s.iva ? infoLine(`IVA (${currentIva}%):`, fmt(s.iva)) : ''}
            ${s.discount ? infoLine('Descuento:', `-${fmt(s.discount)}`) : ''}
            <div style="display:flex;justify-content:space-between;gap:6px;margin-bottom:4px;font-size:${baseFont * 1.12}px;font-weight:bold;${template.showDividers ? 'border-top:1px solid #000;padding-top:4px;' : ''}"><span>TOTAL:</span><span style="text-align:right;">${fmt(s.total)}</span></div>
            ${infoLine('Pagado:', fmt(collectedAmount(s)))}
            ${s.method === 'Efectivo' && Number(s.tendered || 0) > 0 ? infoLine('Efectivo entregado:', fmt(s.tendered)) : ''}
            ${s.balance ? `<div style="display:flex;justify-content:space-between;margin-bottom:4px;color:#d9534f;font-weight:bold;"><span>Saldo Pendiente:</span><span>${fmt(s.balance)}</span></div>` : ''}
            ${s.dueDate ? infoLine('Fecha de retiro:', window.CLICK360_V16_DOMAIN?.formatBusinessDate(`${s.dueDate}T12:00:00`, 'es-EC', businessTimeZone(), false) || s.dueDate) : ''}
            ${s.termsAccepted ? `<div style="border-top:1px dashed #000;margin-top:8px;padding-top:6px;font-size:${baseFont * .76}px;"><b>Términos de apartado v${escapeHtml(s.termsVersion || '1')} aceptados:</b><br>${escapeHtml(s.terms || '')}</div>` : ''}</section>
            <section data-receipt-block="thanks" style="${receiptBlockStyle(template, 'thanks')}">
            ${divider}
            <div style="text-align:center;font-size:${baseFont * .78}px;word-break:break-word;">${template.showThanks ? '¡Gracias por su compra!<br>' : ''}<small style="display:block;margin-top:4px;">${escapeHtml(template.note || RECEIPT_DEFAULT_NOTE)}</small></div></section>
            <footer data-receipt-block="locked-footer" style="order:99;text-align:center;font-size:${baseFont * .78}px;word-break:break-word;border-top:1px dashed #000;margin-top:7px;padding-top:5px;"><small>${escapeHtml(RECEIPT_FOOTER_TEXT)}</small></footer></div>
          </div>
        `;
      }
      function receiptCellPosition(paper, slotNumber = 1) {
        const slot = Math.max(1, Math.min(paper.columns * paper.rows, Math.round(Number(slotNumber || 1))));
        const index = slot - 1;
        const column = index % paper.columns;
        const row = Math.floor(index / paper.columns);
        return {
          xMm: paper.marginLeftMm + column * (paper.receiptWidthMm + paper.gapXmm) + paper.xOffsetMm,
          yMm: paper.marginTopMm + row * (paper.receiptHeightMm + paper.gapYmm) + paper.yOffsetMm,
          slot
        };
      }
      function receiptPrintMediaSize(template = {}) {
        const paper = receiptPaperFromTemplate(template);
        const continuous = paper.mediaType === 'receipt' || paper.mediaType === 'continuous';
        if (continuous) {
          return { widthMm: paper.receiptWidthMm, heightMm: 0 };
        }
        const requiredWidth = paper.marginLeftMm + paper.marginRightMm + paper.columns * paper.receiptWidthMm + Math.max(0, paper.columns - 1) * paper.gapXmm;
        const requiredHeight = paper.marginTopMm + paper.marginBottomMm + paper.rows * paper.receiptHeightMm + Math.max(0, paper.rows - 1) * paper.gapYmm;
        return { widthMm: Math.max(paper.mediaWidthMm, requiredWidth), heightMm: Math.max(paper.mediaHeightMm, requiredHeight) };
      }
      function buildReceiptPaperHtml(s, business = currentBusiness(), template = receiptTemplatePreferences(), options = {}) {
        const paper = receiptPaperFromTemplate(template);
        const media = receiptPrintMediaSize(template);
        const continuous = paper.mediaType === 'receipt' || paper.mediaType === 'continuous';
        const receiptHtml = buildReceiptHtml(s, business, template);
        if (continuous && !options.forceSheet) return receiptHtml;
        const totalSlots = paper.columns * paper.rows;
        const copies = Math.max(1, Math.min(totalSlots, Number(options.copies || 1)));
        let remaining = copies;
        const cells = [];
        for (let slot = 1; slot <= totalSlots; slot += 1) {
          const position = receiptCellPosition(paper, slot);
          const printable = slot >= paper.startSlot && remaining > 0;
          if (printable) remaining -= 1;
          cells.push(`<div class="receiptPaperCell ${printable ? 'filled' : 'empty'}" data-slot="${slot}" style="position:absolute;left:${position.xMm}mm;top:${position.yMm}mm;width:${paper.receiptWidthMm}mm;height:${paper.receiptHeightMm}mm;box-sizing:border-box;overflow:hidden;border:${options.preview ? '1px dashed rgba(0,0,0,.28)' : '0'};background:${printable ? '#fff' : 'transparent'};">${printable ? `<div style="transform:rotate(${paper.contentRotation}deg);transform-origin:center center;width:${paper.receiptWidthMm}mm;min-height:${paper.receiptHeightMm}mm;">${receiptHtml}</div>` : (options.preview ? `<span style="display:grid;place-items:center;width:100%;height:100%;font:700 9px Arial;color:#aaa;">${slot}</span>` : '')}</div>`);
        }
        return `<section class="receiptPaperSheet" data-receipt-paper="${escapeHtml(paper.paperType)}" style="position:relative;width:${media.widthMm}mm;height:${media.heightMm || paper.receiptHeightMm}mm;box-sizing:border-box;background:#fff;color:#000;overflow:hidden;">${cells.join('')}</section>`;
      }
      function receiptPrintJob(s, business = currentBusiness(), template = receiptTemplatePreferences(), options = {}) {
        const paper = receiptPaperFromTemplate(template);
        const media = receiptPrintMediaSize(template);
        const continuous = paper.mediaType === 'receipt' || paper.mediaType === 'continuous';
        return {
          html: buildReceiptPaperHtml(s, business, template, { copies:options.copies || 1 }),
          media: receiptPrintMedia(template),
          mediaWidthMm: media.widthMm || paper.receiptWidthMm,
          mediaHeightMm: continuous ? undefined : media.heightMm,
          widthMm: paper.receiptWidthMm,
          heightMm: continuous ? undefined : paper.receiptHeightMm,
          copiesHandled:true,
          filename: options.filename || `Recibo_${String(s.id || uid('rec')).slice(-6).toUpperCase()}.pdf`
        };
      }
      async function printReceiptWithFallback(s, business = currentBusiness(), template = receiptTemplatePreferences(), providerId = 'system') {
        const job = receiptPrintJob(s, business, template);
        const result = await handoffPrint(job, providerId);
        if (result) return result;
        if (providerId !== 'pdf') {
          toast('No se pudo abrir el diálogo de impresión. Usa Guardar PDF solo si quieres un archivo.', 'err');
        }
        return null;
      }
      function openReceiptTemplateDesigner() {
        const business = currentBusiness();
        if (!business) return toast('Selecciona un negocio antes de editar comprobantes.', 'err');
        const latestSale = salesForBiz().filter((sale) => sale.status !== 'cancelled').slice(-1)[0];
        const sampleSale = latestSale || receiptTemplateSampleSale();
        let draftTemplate = receiptTemplatePreferences();
        let designerBlocks = normalizeReceiptBlocks(draftTemplate.blocks);
        let selectedBlockId = designerBlocks.find((block) => block.visible !== false)?.id || designerBlocks[0]?.id || 'branding';
        let draggedBlockId = '';
        const blockDefinition = (id) => RECEIPT_BLOCKS.find((entry) => entry.id === id) || { id, label:id, help:'' };
        const selectedBlock = () => designerBlocks.find((block) => block.id === selectedBlockId) || designerBlocks[0];
        const currentMode = () => $('#receiptExpertMode')?.classList.contains('active') ? 'expert' : ($('#receiptDesignerModal')?.dataset.receiptMode || draftTemplate.mode || 'simple');
        const blockControlsHtml = () => `<section class="receiptBlockRail" aria-label="Orden del comprobante"><header><span><b>Bloques del comprobante</b><small>Toca un bloque en la lista o directamente en el ticket. Arrastra, sube, baja u oculta secciones. El pie de CLICK 360 queda fijo.</small></span></header><div id="receiptBlockList">${designerBlocks.map((block, index) => {
          const definition = blockDefinition(block.id);
          return `<article class="receiptBlockRow ${block.id === selectedBlockId ? 'selected' : ''}" draggable="true" data-receipt-block-row="${block.id}"><span class="receiptBlockDrag">${icon('grip-vertical')}</span><span class="receiptBlockTitle"><b>${escapeHtml(definition.label)}</b><small>${escapeHtml(definition.help)}</small></span><label class="receiptBlockVisible"><input type="checkbox" data-receipt-block-visible="${block.id}" ${block.visible ? 'checked' : ''}><span>Visible</span></label><div class="receiptBlockMoves"><button type="button" class="iconBtn" data-receipt-block-up="${block.id}" ${index === 0 ? 'disabled' : ''} aria-label="Subir bloque">${icon('chevron-up')}</button><button type="button" class="iconBtn" data-receipt-block-down="${block.id}" ${index === designerBlocks.length - 1 ? 'disabled' : ''} aria-label="Bajar bloque">${icon('chevron-down')}</button></div></article>`;
        }).join('')}</div></section>`;
        const controlsHtml = (mode = draftTemplate.mode) => {
          const selected = selectedBlock();
          const selectedDefinition = blockDefinition(selected?.id);
          const paper = receiptPaperFromTemplate(draftTemplate);
          const totalSlots = paper.columns * paper.rows;
          return `
            <div class="receiptDesignerControlHeader">
              <span><b>Formato físico</b><small>El comprobante usa el mismo papel para vista, PDF e impresión. Configura rollo, hoja, columnas, márgenes y casilla inicial antes de imprimir.</small></span>
              <b>${paper.receiptWidthMm} × ${paper.receiptHeightMm} mm</b>
            </div>
            <div class="receiptDesignerSections">
              <section class="receiptDesignerFieldset">
                <h4>Papel y tamaño</h4>
                <div class="receiptDesignerFields receiptCanvasFields">
                  <div class="field full"><label>Perfil de papel</label><select id="receiptDesignerPaperType">${receiptPaperPresetOptionsHtml(paper.paperType)}</select></div>
                  <div class="field"><label>Ancho del comprobante/sticker (mm)</label><input id="receiptDesignerReceiptWidth" type="number" min="30" max="210" step="1" value="${numericInputValue(paper.receiptWidthMm, 80)}"></div>
                  <div class="field"><label>Alto del comprobante/sticker (mm)</label><input id="receiptDesignerReceiptHeight" type="number" min="20" max="420" step="1" value="${numericInputValue(paper.receiptHeightMm, 150)}"></div>
                  <div class="field"><label>Ancho total del rollo/hoja (mm)</label><input id="receiptDesignerMediaWidth" type="number" min="30" max="420" step="1" value="${numericInputValue(paper.mediaWidthMm, paper.receiptWidthMm)}"></div>
                  <div class="field"><label>Alto total de hoja (mm)</label><input id="receiptDesignerMediaHeight" type="number" min="0" max="900" step="1" value="${numericInputValue(paper.mediaHeightMm, 0)}"></div>
                </div>
              </section>
              <section class="receiptDesignerFieldset">
                <h4>Casillas y posición</h4>
                <div class="receiptDesignerFields receiptCanvasFields">
                  <div class="field"><label>Columnas</label><input id="receiptDesignerColumns" type="number" min="1" max="6" step="1" value="${paper.columns}"></div>
                  <div class="field"><label>Filas</label><input id="receiptDesignerRows" type="number" min="1" max="20" step="1" value="${paper.rows}"></div>
                  <div class="field"><label>Separación horizontal (mm)</label><input id="receiptDesignerGapX" type="number" min="0" max="40" step="0.5" value="${numericInputValue(paper.gapXmm, 0)}"></div>
                  <div class="field"><label>Separación vertical (mm)</label><input id="receiptDesignerGapY" type="number" min="0" max="40" step="0.5" value="${numericInputValue(paper.gapYmm, 0)}"></div>
                  <div class="field"><label>Empezar en casilla</label><input id="receiptDesignerStartSlot" type="number" min="1" max="${totalSlots}" step="1" value="${paper.startSlot}"></div>
                  <div class="field"><label>Rotación de contenido</label><select id="receiptDesignerRotation"><option value="0" ${paper.contentRotation === 0 ? 'selected' : ''}>0° normal</option><option value="90" ${paper.contentRotation === 90 ? 'selected' : ''}>90°</option><option value="180" ${paper.contentRotation === 180 ? 'selected' : ''}>180°</option><option value="270" ${paper.contentRotation === 270 ? 'selected' : ''}>270°</option></select></div>
                </div>
              </section>
              ${mode === 'expert' ? `
                <section class="receiptDesignerFieldset">
                  <h4>Márgenes y calibración</h4>
                  <div class="receiptDesignerFields receiptCanvasFields">
                    <div class="field"><label>Margen superior (mm)</label><input id="receiptDesignerMarginTop" type="number" min="0" max="80" step="0.5" value="${numericInputValue(paper.marginTopMm, 0)}"></div>
                    <div class="field"><label>Margen derecho (mm)</label><input id="receiptDesignerMarginRight" type="number" min="0" max="80" step="0.5" value="${numericInputValue(paper.marginRightMm, 0)}"></div>
                    <div class="field"><label>Margen inferior (mm)</label><input id="receiptDesignerMarginBottom" type="number" min="0" max="80" step="0.5" value="${numericInputValue(paper.marginBottomMm, 0)}"></div>
                    <div class="field"><label>Margen izquierdo (mm)</label><input id="receiptDesignerMarginLeft" type="number" min="0" max="80" step="0.5" value="${numericInputValue(paper.marginLeftMm, 0)}"></div>
                    <div class="field"><label>Calibración X (mm)</label><input id="receiptDesignerXOffset" type="number" min="-40" max="40" step="0.5" value="${numericInputValue(paper.xOffsetMm, 0)}"></div>
                    <div class="field"><label>Calibración Y (mm)</label><input id="receiptDesignerYOffset" type="number" min="-40" max="40" step="0.5" value="${numericInputValue(paper.yOffsetMm, 0)}"></div>
                    <div class="field"><label>DPI referencia</label><input id="receiptDesignerDpi" type="number" min="72" max="600" step="1" value="${paper.dpi}"></div>
                  </div>
                </section>
                <section class="receiptDesignerFieldset">
                  <h4>Estilo y contenido</h4>
                  <div class="receiptDesignerFields receiptCanvasFields">
                    <div class="field"><label>Tamaño de texto</label><input id="receiptDesignerTextScale" type="range" min="0.78" max="1.25" step="0.01" value="${numericInputValue(draftTemplate.textScale, 1)}"></div>
                    <div class="field"><label>Padding interno (mm)</label><input id="receiptDesignerPadding" type="number" min="1" max="8" step="0.5" value="${numericInputValue(draftTemplate.paddingMm, 3)}"></div>
                    <div class="field"><label>Alto máximo de logo (mm)</label><input id="receiptDesignerLogoHeight" type="number" min="12" max="38" step="1" value="${numericInputValue(draftTemplate.logoHeightMm, 22)}"></div>
                    <div class="field"><label>Alineación superior</label><select id="receiptDesignerAlign"><option value="center" ${draftTemplate.align !== 'left' ? 'selected' : ''}>Centrada</option><option value="left" ${draftTemplate.align === 'left' ? 'selected' : ''}>Izquierda</option></select></div>
                    <label class="consentCheck"><input type="checkbox" id="receiptDesignerTax" ${draftTemplate.showTax ? 'checked' : ''}><span>Mostrar IVA cuando aplique</span></label>
                    <label class="consentCheck"><input type="checkbox" id="receiptDesignerThanks" ${draftTemplate.showThanks ? 'checked' : ''}><span>Mensaje de gracias</span></label>
                  </div>
                </section>
              ` : ''}
              <section class="receiptDesignerFieldset">
                <h4>Datos visibles</h4>
                <div class="receiptDesignerFields receiptCanvasFields">
                  <label class="consentCheck"><input type="checkbox" id="receiptDesignerLogo" ${draftTemplate.showLogo ? 'checked' : ''}><span>Logo del negocio</span></label>
                  <label class="consentCheck"><input type="checkbox" id="receiptDesignerCustomer" ${draftTemplate.showCustomer ? 'checked' : ''}><span>Cliente y teléfono</span></label>
                  <label class="consentCheck"><input type="checkbox" id="receiptDesignerSeller" ${draftTemplate.showSeller ? 'checked' : ''}><span>Vendedor</span></label>
                  <label class="consentCheck"><input type="checkbox" id="receiptDesignerPayment" ${draftTemplate.showPayment ? 'checked' : ''}><span>Método de pago</span></label>
                  <label class="consentCheck"><input type="checkbox" id="receiptDesignerDividers" ${draftTemplate.showDividers ? 'checked' : ''}><span>Líneas divisorias</span></label>
                  <div class="field full"><label>Nota interna</label><textarea id="receiptDesignerNote" maxlength="160">${escapeHtml(draftTemplate.note)}</textarea></div>
                </div>
              </section>
            </div>
            <section class="receiptSelectedBlockPanel">
              <span><b>Bloque seleccionado</b><small>${escapeHtml(selectedDefinition?.label || '')} · ${escapeHtml(selectedDefinition?.help || '')}</small></span>
              <div>
                <button type="button" class="btn small" id="receiptSelectedUp">${icon('arrow-up')} Subir</button>
                <button type="button" class="btn small" id="receiptSelectedDown">${icon('arrow-down')} Bajar</button>
                <button type="button" class="btn small" id="receiptSelectedToggle">${selected?.visible === false ? icon('eye') + ' Mostrar' : icon('eye-off') + ' Ocultar'}</button>
              </div>
            </section>
            <section class="receiptDesignerHint"><b>Cómo editar</b><small>Usa Bloques para ordenar el ticket, el Lienzo para revisar en vivo y Propiedades para ajustar ancho, logo, datos visibles y estilo.</small></section>`;
        };
        showModal(`<div class="modalHeader"><div><h2>Editor de comprobante</h2><p class="fieldHint">Organiza el ticket como un lienzo: selecciona bloques, cambia orden, ancho y estilo. El PDF, la vista previa y la impresión usan esta misma plantilla.</p></div><button class="closeBtn" data-close>×</button></div>
          <section id="receiptDesignerModal" class="receiptDesignerModal receiptCanvasDesigner" data-receipt-mode="${draftTemplate.mode}">
            <div class="labelModeSwitch receiptModeSwitch"><button type="button" id="receiptSimpleMode" class="${draftTemplate.mode !== 'expert' ? 'active' : ''}">Modo simple · Lienzo</button><button type="button" id="receiptExpertMode" class="${draftTemplate.mode === 'expert' ? 'active' : ''}">Modo experto · Avanzado</button></div>
            <div class="receiptDesignerLayout">
              <aside class="receiptDesignerBlockPanel">
                ${blockControlsHtml()}
              </aside>
              <aside class="receiptDesignerPreviewPanel">
                <div class="receiptDesignerPreviewHeader"><span><h3>Lienzo de comprobante</h3><small>Selecciona una sección del ticket para editarla.</small></span><b id="receiptDesignerWidthBadge">${receiptPaperFromTemplate(draftTemplate).receiptWidthMm} x ${receiptPaperFromTemplate(draftTemplate).receiptHeightMm} mm</b></div>
                <div id="receiptDesignerPreview" class="receiptDesignerPreview">${buildReceiptPaperHtml(sampleSale, business, draftTemplate, { preview: true, forceSheet: true })}</div>
                <div class="receiptCanvasActions"><button type="button" class="btn small" id="receiptPreviewUp">${icon('arrow-up')} Subir</button><button type="button" class="btn small" id="receiptPreviewDown">${icon('arrow-down')} Bajar</button><button type="button" class="btn small" id="receiptPreviewToggle">${icon('eye-off')} Ocultar</button><button type="button" class="btn small" id="receiptDesignerPdfInline">${icon('file-down')} PDF</button></div>
              </aside>
              <form id="receiptDesignerForm" class="receiptDesignerControls">${controlsHtml(draftTemplate.mode)}</form>
            </div>
            <div class="receiptFixedFooter">${escapeHtml(RECEIPT_FOOTER_TEXT)}</div>
            <div class="receiptDesignerActions"><button type="button" class="btn" data-close>Cancelar</button><button type="button" class="btn silver" id="receiptDesignerPdf">${icon('file-down')} PDF de prueba</button><button type="button" class="btn primary" id="receiptDesignerSave">${icon('save')} Guardar plantilla</button></div>
          </section>`);
        $('#modalRoot .modal')?.classList.add('receiptDesignerShell');
        const collect = () => {
          const previous = draftTemplate || receiptTemplatePreferences();
          const previousPaper = receiptPaperFromTemplate(previous);
          const selectedPaperType = $('#receiptDesignerPaperType')?.value || previousPaper.paperType || 'thermal-80';
          const preset = RECEIPT_PAPER_PRESETS[selectedPaperType] || RECEIPT_PAPER_PRESETS.custom;
          const profileChanged = selectedPaperType !== previousPaper.paperType;
          const readPaperNumber = (id, key, min, max) => {
            if (profileChanged) return preset[key];
            return $(id) ? clampNumber($(id).value, min, max, previousPaper[key]) : previousPaper[key];
          };
          const receiptWidthMm = readPaperNumber('#receiptDesignerReceiptWidth', 'receiptWidthMm', 24, 210);
          const receiptHeightMm = readPaperNumber('#receiptDesignerReceiptHeight', 'receiptHeightMm', 10, 420);
          const columns = Math.round(readPaperNumber('#receiptDesignerColumns', 'columns', 1, 6));
          const rows = Math.round(readPaperNumber('#receiptDesignerRows', 'rows', 1, 20));
          const gapXmm = readPaperNumber('#receiptDesignerGapX', 'gapXmm', 0, 30);
          const gapYmm = readPaperNumber('#receiptDesignerGapY', 'gapYmm', 0, 30);
          const marginLeftMm = readPaperNumber('#receiptDesignerMarginLeft', 'marginLeftMm', 0, 60);
          const marginRightMm = readPaperNumber('#receiptDesignerMarginRight', 'marginRightMm', 0, 60);
          const marginTopMm = readPaperNumber('#receiptDesignerMarginTop', 'marginTopMm', 0, 60);
          const marginBottomMm = readPaperNumber('#receiptDesignerMarginBottom', 'marginBottomMm', 0, 60);
          const minimumMediaWidth = marginLeftMm + marginRightMm + (receiptWidthMm * columns) + (gapXmm * Math.max(0, columns - 1));
          const minimumMediaHeight = marginTopMm + marginBottomMm + (receiptHeightMm * rows) + (gapYmm * Math.max(0, rows - 1));
          const mediaWidthMm = Math.max(minimumMediaWidth, readPaperNumber('#receiptDesignerMediaWidth', 'mediaWidthMm', 24, 420));
          const mediaHeightMm = selectedPaperType.startsWith('thermal') || selectedPaperType === 'continuous-80'
            ? readPaperNumber('#receiptDesignerMediaHeight', 'mediaHeightMm', 0, 999)
            : Math.max(minimumMediaHeight, readPaperNumber('#receiptDesignerMediaHeight', 'mediaHeightMm', 0, 999));
          const legacyWidth = receiptWidthMm <= 57 ? 'receipt-57' : receiptWidthMm <= 58 ? 'receipt-58' : receiptWidthMm <= 60 ? 'receipt-60' : receiptWidthMm <= 76 ? 'receipt-76' : receiptWidthMm <= 80 ? 'receipt-80' : 'receipt-custom';
          return {
            ...previous,
            mode: currentMode(),
            paperType: RECEIPT_PAPER_PRESETS[selectedPaperType] ? selectedPaperType : 'custom',
            mediaType: preset.mediaType || previousPaper.mediaType,
            receiptWidthMm,
            receiptHeightMm,
            mediaWidthMm,
            mediaHeightMm,
            columns,
            rows,
            gapXmm,
            gapYmm,
            marginTopMm,
            marginRightMm,
            marginBottomMm,
            marginLeftMm,
            startSlot: Math.round($('#receiptDesignerStartSlot') ? clampNumber($('#receiptDesignerStartSlot').value, 1, Math.max(1, columns * rows), previousPaper.startSlot) : previousPaper.startSlot),
            contentRotation: $('#receiptDesignerRotation') ? clampNumber($('#receiptDesignerRotation').value, -180, 180, previousPaper.contentRotation) : previousPaper.contentRotation,
            xOffsetMm: $('#receiptDesignerXOffset') ? clampNumber($('#receiptDesignerXOffset').value, -50, 50, previousPaper.xOffsetMm) : previousPaper.xOffsetMm,
            yOffsetMm: $('#receiptDesignerYOffset') ? clampNumber($('#receiptDesignerYOffset').value, -50, 50, previousPaper.yOffsetMm) : previousPaper.yOffsetMm,
            dpi: Math.round($('#receiptDesignerDpi') ? clampNumber($('#receiptDesignerDpi').value, 72, 600, previousPaper.dpi) : previousPaper.dpi),
            width: legacyWidth,
            customWidthMm: receiptWidthMm,
            showLogo: $('#receiptDesignerLogo') ? $('#receiptDesignerLogo').checked === true : previous.showLogo,
            showCustomer: $('#receiptDesignerCustomer') ? $('#receiptDesignerCustomer').checked === true : previous.showCustomer,
            showSeller: $('#receiptDesignerSeller') ? $('#receiptDesignerSeller').checked === true : previous.showSeller,
            showPayment: $('#receiptDesignerPayment') ? $('#receiptDesignerPayment').checked === true : previous.showPayment,
            showDividers: $('#receiptDesignerDividers') ? $('#receiptDesignerDividers').checked === true : previous.showDividers,
            showTax: $('#receiptDesignerTax') ? $('#receiptDesignerTax').checked === true : previous.showTax,
            showThanks: $('#receiptDesignerThanks') ? $('#receiptDesignerThanks').checked === true : previous.showThanks,
            align: $('#receiptDesignerAlign')?.value === 'left' ? 'left' : previous.align,
            paddingMm: $('#receiptDesignerPadding') ? clampNumber($('#receiptDesignerPadding').value, 1, 8, previous.paddingMm) : previous.paddingMm,
            textScale: $('#receiptDesignerTextScale') ? clampNumber($('#receiptDesignerTextScale').value, 0.78, 1.25, previous.textScale) : previous.textScale,
            logoHeightMm: $('#receiptDesignerLogoHeight') ? clampNumber($('#receiptDesignerLogoHeight').value, 12, 38, previous.logoHeightMm) : previous.logoHeightMm,
            note: ($('#receiptDesignerNote')?.value || previous.note || '').trim() || RECEIPT_DEFAULT_NOTE,
            blocks: normalizeReceiptBlocks(designerBlocks)
          };
        };
        const selectBlock = (id) => {
          if (!designerBlocks.some((block) => block.id === id)) return;
          selectedBlockId = id;
          updateSelectedState();
        };
        const moveSelectedBlock = (delta) => {
          const current = designerBlocks.findIndex((entry) => entry.id === selectedBlockId);
          const next = current + delta;
          if (current < 0 || next < 0 || next >= designerBlocks.length) return false;
          [designerBlocks[current], designerBlocks[next]] = [designerBlocks[next], designerBlocks[current]];
          renderControls();
          repaint();
          return true;
        };
        const toggleSelectedBlock = () => {
          const block = selectedBlock();
          if (!block) return;
          block.visible = block.visible === false;
          renderControls();
          repaint();
        };
        const updateSelectedState = () => {
          const block = selectedBlock();
          const isVisible = block?.visible !== false;
          $$('[data-receipt-block-row]').forEach((row) => row.classList.toggle('selected', row.dataset.receiptBlockRow === selectedBlockId));
          $$('#receiptDesignerPreview [data-receipt-block]').forEach((node) => node.classList.toggle('selected', node.dataset.receiptBlock === selectedBlockId));
          ['receiptSelectedToggle', 'receiptPreviewToggle'].forEach((id) => {
            const button = $(`#${id}`);
            if (button) button.innerHTML = isVisible ? `${icon('eye-off')} Ocultar` : `${icon('eye')} Mostrar`;
          });
          refreshIcons();
        };
        const repaint = () => {
          draftTemplate = collect();
          const preview = $('#receiptDesignerPreview');
          if (preview) preview.innerHTML = buildReceiptPaperHtml(sampleSale, business, draftTemplate, { preview: true, forceSheet: true });
          const badge = $('#receiptDesignerWidthBadge');
          const paper = receiptPaperFromTemplate(draftTemplate);
          if (badge) badge.textContent = `${paper.receiptWidthMm} x ${paper.receiptHeightMm} mm`;
          bindPreviewBlocks();
          updateSelectedState();
        };
        const bindPreviewBlocks = () => {
          $$('#receiptDesignerPreview [data-receipt-block]').forEach((node) => {
            node.tabIndex = 0;
            node.setAttribute('role', 'button');
            node.setAttribute('aria-label', `Seleccionar bloque ${blockDefinition(node.dataset.receiptBlock).label}`);
            node.addEventListener('click', () => selectBlock(node.dataset.receiptBlock));
            node.addEventListener('keydown', (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              selectBlock(node.dataset.receiptBlock);
            });
          });
        };
        const bindBlockControls = () => {
          $$('[data-receipt-block-row]').forEach((row) => {
            row.addEventListener('click', (event) => {
              if (event.target.closest('button,input,label')) return;
              selectBlock(row.dataset.receiptBlockRow);
            });
            row.addEventListener('dragstart', (event) => {
              draggedBlockId = row.dataset.receiptBlockRow || '';
              event.dataTransfer?.setData('text/plain', draggedBlockId);
            });
            row.addEventListener('dragover', (event) => event.preventDefault());
            row.addEventListener('drop', (event) => {
              event.preventDefault();
              const sourceId = event.dataTransfer?.getData('text/plain') || draggedBlockId;
              const targetId = row.dataset.receiptBlockRow;
              const sourceIndex = designerBlocks.findIndex((block) => block.id === sourceId);
              const targetIndex = designerBlocks.findIndex((block) => block.id === targetId);
              if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
              const [moved] = designerBlocks.splice(sourceIndex, 1);
              designerBlocks.splice(targetIndex, 0, moved);
              selectedBlockId = moved.id;
              renderControls();
              repaint();
            });
          });
          $$('[data-receipt-block-visible]').forEach((input) => input.addEventListener('change', () => {
            const block = designerBlocks.find((entry) => entry.id === input.dataset.receiptBlockVisible);
            if (block) block.visible = input.checked;
            selectedBlockId = block?.id || selectedBlockId;
            renderControls();
            repaint();
          }));
          $$('[data-receipt-block-up], [data-receipt-block-down]').forEach((button) => button.addEventListener('click', () => {
            const id = button.dataset.receiptBlockUp || button.dataset.receiptBlockDown;
            selectedBlockId = id || selectedBlockId;
            moveSelectedBlock(button.dataset.receiptBlockUp ? -1 : 1);
          }));
          $('#receiptSelectedUp')?.addEventListener('click', () => moveSelectedBlock(-1));
          $('#receiptSelectedDown')?.addEventListener('click', () => moveSelectedBlock(1));
          $('#receiptSelectedToggle')?.addEventListener('click', toggleSelectedBlock);
        };
        const bindForm = () => {
          $$('#receiptDesignerForm input, #receiptDesignerForm select, #receiptDesignerForm textarea').forEach((input) => input.addEventListener('input', repaint));
          $$('#receiptDesignerForm select, #receiptDesignerForm input[type="checkbox"]').forEach((input) => input.addEventListener('change', repaint));
          bindBlockControls();
        };
        const renderControls = () => {
          draftTemplate = collect();
          const form = $('#receiptDesignerForm');
          if (form) form.innerHTML = controlsHtml(currentMode());
          bindForm();
          updateSelectedState();
          refreshIcons();
        };
        const setMode = (mode) => {
          draftTemplate = { ...collect(), mode };
          const modal = $('#receiptDesignerModal');
          if (modal) modal.dataset.receiptMode = mode;
          $('#receiptSimpleMode')?.classList.toggle('active', mode !== 'expert');
          $('#receiptExpertMode')?.classList.toggle('active', mode === 'expert');
          renderControls();
          repaint();
        };
        const runReceiptPdf = () => {
          const draft = collect();
          handoffPrint(receiptPrintJob(sampleSale, business, draft, { filename:'CLICK360_Comprobante_Prueba.pdf' }), 'pdf')
            .then(() => toast('PDF de prueba generado.', 'ok'))
            .catch((error) => toast(error.message || 'No se pudo generar el PDF.', 'err'));
        };
        $('#receiptSimpleMode')?.addEventListener('click', () => setMode('simple'));
        $('#receiptExpertMode')?.addEventListener('click', () => setMode('expert'));
        $('#receiptPreviewUp')?.addEventListener('click', () => moveSelectedBlock(-1));
        $('#receiptPreviewDown')?.addEventListener('click', () => moveSelectedBlock(1));
        $('#receiptPreviewToggle')?.addEventListener('click', toggleSelectedBlock);
        $('#receiptDesignerPdfInline')?.addEventListener('click', runReceiptPdf);
        $('#receiptDesignerSave')?.addEventListener('click', () => {
          if (!saveReceiptTemplatePreferences(collect())) return;
          closeModal();
          renderApp('printing');
          toast('Plantilla de comprobante guardada.', 'ok');
        });
        $('#receiptDesignerPdf')?.addEventListener('click', runReceiptPdf);
        bindForm();
        bindPreviewBlocks();
        updateSelectedState();
        refreshIcons();
      }
			  function printerStateLabel(status = {}) {
		    const labels = { ready: 'Listo', disconnected: 'Desconectado', handing_off: 'Enviando', unsupported: 'No disponible', validation_required: 'Validación física pendiente', error: 'Revisar' };
		    return labels[status.state] || 'Sin comprobar';
		  }
		  function printingView() {
		    const preferences = printingPreferences();
		    const statuses = window.CLICK360_PRINTING?.providers?.() || [];
		    const statusRows = statuses.map((status) => `<div class="printerStatusRow"><span><b>${escapeHtml(status.name)}</b><small>${escapeHtml(printerStateLabel(status))}</small></span><em class="${status.supported ? 'ready' : ''}">${status.supported ? 'Disponible' : 'Alternativa'}</em></div>`).join('');
		    const latestSale = salesForBiz().filter((sale) => sale.status !== 'cancelled').slice(-1)[0];
		    const firstProduct = productsForBiz()[0];
			    const receiptTemplate = receiptTemplatePreferences();
          const receiptPaper = receiptPaperFromTemplate(receiptTemplate);
			    return `<div class="pageHead"><div><h1>Centro de impresión</h1><p>${escapeHtml(currentBusiness().name)}</p></div></div>
		      <section class="card sectionCard printingControlPanel">
		        <div class="formGrid">
		          <div class="field"><label>Salida</label><select id="printingProvider"><option value="system" ${preferences.provider === 'system' ? 'selected' : ''}>Impresión del sistema</option><option value="pdf" ${preferences.provider === 'pdf' ? 'selected' : ''}>Guardar PDF</option><option value="m02x-bluetooth" ${preferences.provider === 'm02x-bluetooth' ? 'selected' : ''}>M02X Bluetooth</option><option value="native-bridge" ${preferences.provider === 'native-bridge' ? 'selected' : ''}>Puente nativo</option></select></div>
		          <div class="field"><label>Formato</label><select id="printingMedia">${receiptWidthOptionsHtml(preferences.media)}<option value="a4" ${preferences.media === 'a4' ? 'selected' : ''}>A4</option></select></div>
		          <div class="field"><label>Copias</label><input id="printingCopies" type="number" min="1" max="20" value="${preferences.copies}"></div>
		        </div>
		        <div class="printerPrimaryActions"><button class="btn primary" id="printerConnect">${icon('search')} Buscar o preparar</button><button class="btn" id="printerTest">${icon('printer-check')} Imprimir prueba</button><button class="btn" id="printerDisconnect">${icon('unplug')} Desconectar</button><button class="btn" id="printerForget">${icon('trash-2')} Olvidar dispositivo</button></div>
		        <p id="printerFeedback" class="fieldHint" role="status" aria-live="polite"></p>
		      </section>
		      <section class="printingStatusList" aria-label="Estado de salidas">${statusRows}</section>
			      <section class="printingQuickActions">
		        <button class="card bigRow" id="printingLabelAction" ${firstProduct ? '' : 'disabled'}><span>${icon('qr-code')} Etiqueta QR de producto</span><small>${firstProduct ? escapeHtml(firstProduct.name) : 'Agrega un producto primero'}</small></button>
		        <button class="card bigRow" id="printingReceiptAction" ${latestSale ? '' : 'disabled'}><span>${icon('receipt')} Último comprobante</span><small>${latestSale ? escapeHtml(latestSale.id.slice(-6).toUpperCase()) : 'Aún no hay ventas'}</small></button>
			        <button class="card bigRow" id="printingReportAction"><span>${icon('file-chart-column')} Reporte actual</span><small>Impresión o PDF</small></button>
			      </section>
			      <section class="card sectionCard receiptTemplatePanel">
			        <div class="receiptTemplateHeader"><span><h3>Plantilla de comprobante de venta</h3><p class="fieldHint">Edita con modo simple o experto. El pie de CLICK 360 queda fijo y no se puede borrar.</p></span><button type="button" class="btn primary" id="openReceiptDesignerBtn">${icon('layout-template')} Editar plantilla</button></div>
			        <div class="receiptDesignerSummary">
			          <div><b>${escapeHtml(receiptPaper.label)}</b><small>${receiptPaper.receiptWidthMm} x ${receiptPaper.receiptHeightMm} mm · ${receiptPaper.columns} col. · ${receiptTemplate.mode === 'expert' ? 'modo experto' : 'modo simple'}</small></div>
			          <div class="receiptDesignerMini" aria-label="Vista mini de comprobante">${buildReceiptPaperHtml(receiptTemplateSampleSale(), currentBusiness(), receiptTemplate, { preview:true, forceSheet:true })}</div>
			        </div>
			        <div class="receiptFixedFooter">${escapeHtml(RECEIPT_FOOTER_TEXT)}</div>
			      </section>
			      <section class="card sectionCard m02xNotice"><h3>M02X</h3><p>El equipo usa Bluetooth y 203 dpi. La conexión directa permanece desactivada hasta validar el protocolo y una impresión física con la unidad real. Mientras tanto, usa la salida del sistema o PDF.</p></section>`;
			  }
	  function backupView(){
	    const yest = new Date(); yest.setDate(yest.getDate() - 1); const yesterdayStr = localDateKey(yest);
	    const firstDay = localDateKey(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
	    const lastDay = localDateKey(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0));
	    const cloud = syncStatusInfo();

	    return `<div class="pageHead"><div><h1>Nube y Respaldo</h1><p>Sincronizaci\u00f3n y reportes contables.</p></div></div>
	      <section class="card sectionCard">
	        <h3>Nube CLICK 360</h3>
	        <p id="cloudStatusDynamic" class="cloudStatus" style="margin-bottom:10px; color:var(--gold);">\u2605 ${escapeHtml(cloud.title)}</p>
	        <p id="cloudStatusDetail" class="cloudStatus">${escapeHtml(cloud.detail)}</p>
		        <div class="split" style="gap:10px;margin-top:12px;"><button type="button" class="btn silver" id="refreshCloudBtn">Actualizar desde nube</button><button type="button" class="btn primary" id="forceSyncCloud">Guardar ahora en nube</button></div>
		        <div class="syncRecoveryCard">
		          <button type="button" class="btn block" id="clearLocalAppStateBtn">Limpiar estado local de esta app</button>
		          <button type="button" class="btn silver block" id="copySyncDiagnosticBtn" style="margin-top:8px;">Copiar diagnóstico técnico</button>
		          <p class="fieldHint">Solo limpia locks locales de sincronización y vuelve a leer la nube. No borra Firebase, negocios ni productos.</p>
		        </div>
	      </section>
      <section class="card sectionCard" style="margin-top:14px">
        <h3>Reporte Contable General</h3>
        <p class="cloudStatus">Descarga el reporte completo en formato Excel real (XLSX). Selecciona el rango de fechas o usa los accesos r\u00e1pidos.</p>
        <div class="formGrid" style="margin-bottom:8px;">
          <div class="field"><label>Desde</label><input type="date" id="csvDateFrom" value="${today()}"></div>
          <div class="field"><label>Hasta</label><input type="date" id="csvDateTo" value="${today()}"></div>
        </div>
        <div style="display:flex; gap:8px; margin-bottom:14px; flex-wrap:wrap;">
          <button type="button" class="btn silver mini" onclick="$('#csvDateFrom').value=$('#csvDateTo').value='${today()}';" style="padding:4px 10px; font-size:12px;">Hoy</button>
          <button type="button" class="btn silver mini" onclick="$('#csvDateFrom').value=$('#csvDateTo').value='${yesterdayStr}';" style="padding:4px 10px; font-size:12px;">Ayer</button>
          <button type="button" class="btn silver mini" onclick="$('#csvDateFrom').value='${firstDay}'; $('#csvDateTo').value='${lastDay}';" style="padding:4px 10px; font-size:12px;">Este Mes</button>
        </div>
        <button type="button" class="btn primary block" id="exportCsvBtn">\uD83D\uDCCA Descargar Reporte Excel (XLSX)</button>
        <button type="button" class="btn block" id="sendReportBtn" style="margin-top:10px;border:1px solid #25D366;color:#25D366;background:transparent;">\uD83D\uDCE4 Enviar Excel a Contadora (WhatsApp)</button>
      </section>
      <section class="card sectionCard" style="margin-top:14px">
        <h3>Respaldo Manual (Copia de Seguridad)</h3><p class="cloudStatus">Guarda una copia de toda tu informaci\u00f3n en tu dispositivo o rest\u00e1urala si cambiaste de equipo.</p>
        <div class="split" style="gap:10px;"><button type="button" class="btn silver" id="backupBtn">\uD83D\uDCBE Guardar Respaldo</button><label class="btn silver" style="flex:1; text-align:center; display:flex; align-items:center; justify-content:center;"><input type="file" id="restoreFile" accept="application/json" hidden/>\uD83D\uDD04 Restaurar Respaldo</label></div>
      </section>`;
  }
  function workersView(){
    return `<div class="pageHead"><div><h1>Trabajadores</h1><p>Administra los accesos a tu negocio.</p></div></div>
	  ${WORKER_TENANT_ACCESS_ENABLED ? '' : '<section class="card sectionCard"><h3>Registro pausado</h3><p class="cloudStatus">El acceso operativo para trabajadores está temporalmente pausado. Puedes revisar o revocar invitaciones existentes; no se crearán accesos nuevos desde esta versión.</p></section>'}
      <section class="card sectionCard" ${WORKER_TENANT_ACCESS_ENABLED ? '' : 'aria-disabled="true"'}>
         <h3>Registrar Trabajador</h3>
         ${WORKER_TENANT_ACCESS_ENABLED ? '' : '<p class="fieldHint">Disponible en una fase posterior; no se activó en este release P1.1.</p>'}
	         <form id="addWorkerForm" style="${WORKER_TENANT_ACCESS_ENABLED ? 'display:flex' : 'display:none'}; flex-direction:column; gap:10px; margin-bottom:14px;">
            <div class="field"><label>Nombre</label><input id="workerName" required placeholder="Ej. Juan Pérez"></div>
            <div class="field"><label>Correo de Google del Trabajador</label><input id="workerEmail" type="email" required placeholder="Ej. juan@gmail.com"></div>
            <div class="field"><label>Rol inicial</label><select id="workerRole"><option value="worker">Operador</option><option value="cashier">Caja y ventas</option><option value="inventory">Inventario</option></select></div>
            <button class="btn primary block" type="submit">Crear invitacion segura</button>
         </form>

         <div id="inviteLinkBox" style="display:none; margin-top:14px; background:rgba(55,213,126,0.1); border:1px solid rgba(55,213,126,0.3); padding:12px; border-radius:12px;">
            <small style="color:var(--green); display:block; margin-bottom:6px; font-weight:bold;">Enlace de Invitación:</small>
            <input type="text" id="inviteLinkVal" readonly style="width:100%; font-size:12px; margin-bottom:8px; background:#000; border:1px solid #444; color:#fff; padding:8px; border-radius:8px;">
            <button class="btn silver block" id="copyInviteLinkBtn" type="button">Copiar Enlace</button>
         </div>
      </section>
      <section class="card sectionCard" style="margin-top:14px">
         <h3>Trabajadores Registrados</h3>
         <div id="workersList"></div>
      </section>`;
  }
	  function settingsView(){
	    const b=currentBusiness();
	    const bizSettings = currentBusiness().settings || {};
    const tax = businessTaxConfig(b);
    const ruc = bizSettings.ruc || '';
    const phone = bizSettings.phone || '';
    const address = bizSettings.address || '';
	    const logoUrl = safeImageSrc(bizSettings.logoUrl);
    const policies = businessPolicies(b);
    const bizOptions = state.businesses.map(x=>`<option value="${escapeHtml(x.id)}" ${x.id===b?.id?'selected':''}>${escapeHtml(x.name)}</option>`).join('');
	    const ownerOnlyStyle = isOwnerUser() ? '' : 'display:none;';

	    return `<div class="pageHead"><div><h1>Ajustes</h1><p>Configura tu empresa.</p></div></div>
	      <section class="card sectionCard" style="${ownerOnlyStyle}">
	        <h3>Datos del Negocio</h3>
        <div class="field" style="display:flex; flex-direction:column; align-items:center;">
          <div style="width:80px; height:80px; border-radius:50%; background:#222; border:1px solid #444; overflow:hidden; margin-bottom:10px; display:flex; justify-content:center; align-items:center;">
             ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" style="width:100%; height:100%; object-fit:cover;">` : `<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" style="display:block; margin:0;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>`}
          </div>
          <label class="btn silver" style="font-size:12px; padding:4px 8px; position:relative; display:inline-flex; justify-content:center; align-items:center; min-height:28px; gap:6px;">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" style="display:block; margin:0;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            Cambiar Logo
            <input type="file" id="bizLogoUpload" accept="image/*" hidden>
          </label>
        </div>
        <div class="field"><label>Nombre del Negocio</label><input id="bizName" value="${escapeHtml(b.name)}"></div>
        <div class="field"><label>RUC o Identificación</label><input id="bizRuc" value="${escapeHtml(ruc)}" placeholder="1234567890001"></div>
        <div class="field"><label>Teléfono</label><input id="bizPhone" type="tel" value="${escapeHtml(phone)}" placeholder="+593 999999999"></div>
        <div class="field"><label>Dirección del Local</label><input id="bizAddress" value="${escapeHtml(address)}" placeholder="Ej. Av. de los Shyris y Naciones Unidas"></div>
        <div class="field"><label>¿Cuál es tu negocio?</label><select id="bizType">${typeOptions(b.type)}</select></div>
        <label class="consentCheck"><input type="checkbox" id="bizTaxEnabled" ${tax.enabled ? 'checked' : ''}><span>IVA activado</span></label>
        <div class="field"><label>IVA global (%)</label><input type="number" min="0" max="100" step="0.01" inputmode="decimal" id="bizIva" value="${numericInputValue(tax.rate)}" placeholder="0"></div>
        <div class="field"><label>Los precios del negocio</label><select id="bizTaxPriceMode"><option value="included" ${tax.priceMode === 'included' ? 'selected' : ''}>Incluyen IVA</option><option value="excluded" ${tax.priceMode === 'excluded' ? 'selected' : ''}>No incluyen IVA</option></select></div>
        <label class="consentCheck"><input type="checkbox" id="bizTaxShowLabel" ${tax.showLabel ? 'checked' : ''}><span>Mostrar condicion de IVA</span></label>
        <details class="settingsDisclosure"><summary>Politicas de apartados y retiros</summary><div class="formGrid"><div class="field full"><label>Politica de apartado</label><textarea id="policyLayaway">${escapeHtml(policies.layaway)}</textarea></div><div class="field full"><label>Politica de retiro</label><textarea id="policyPickup">${escapeHtml(policies.pickup)}</textarea></div><div class="field full"><label>Devoluciones y cambios</label><textarea id="policyReturns">${escapeHtml(policies.returns)}</textarea></div><div class="field full"><label>Daños y estado del producto</label><textarea id="policyDamages">${escapeHtml(policies.damages)}</textarea></div><div class="field full"><label>Condiciones adicionales</label><textarea id="policyAdditional">${escapeHtml(policies.additional)}</textarea></div><p class="fieldHint full">Revisa estas politicas conforme a la legislacion aplicable. CLICK 360 proporciona herramientas de gestion, no asesoria legal.</p></div></details>
        <button type="button" class="btn primary block" id="saveBiz">Guardar cambios</button>
      </section>

      <section class="card sectionCard" style="margin-top:14px">
        <h3>Mi Perfil (Usuario)</h3>
        <div class="field" style="display:flex; flex-direction:column; align-items:center;">
          <div style="width:80px; height:80px; border-radius:50%; background:#222; border:1px solid #444; overflow:hidden; margin-bottom:10px; display:flex; justify-content:center; align-items:center;">
             ${safeImageSrc(authUser().photoURL) ? `<img src="${escapeHtml(safeImageSrc(authUser().photoURL))}" style="width:100%; height:100%; object-fit:cover;">` : `<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" style="display:block; margin:0;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`}
          </div>
          <label class="btn silver" style="font-size:12px; padding:4px 8px; position:relative; display:inline-flex; justify-content:center; align-items:center; min-height:28px; gap:6px;">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" style="display:block; margin:0;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            Cambiar Foto de Perfil
            <input type="file" id="userPhotoUpload" accept="image/*" hidden>
          </label>
        </div>
        <div class="field"><label>Nombre de Usuario</label><input id="userName" value="${escapeHtml(authUser().name)}"></div>
        <button type="button" class="btn primary block" id="saveUser">Guardar Perfil</button>
      </section>

	      <section class="card sectionCard" style="margin-top:14px;${ownerOnlyStyle}">
	        <h3>Cambiar de Negocio</h3>
        <p style="font-size:13px; color:var(--muted); margin-bottom:12px;">Selecciona el negocio que deseas ver y administrar actualmente.</p>
        <div class="field">
          <label>Negocio Activo</label>
          <select id="businessPickerSettings">${bizOptions}</select>
        </div>
      </section>

	      ${isRestaurantBusiness(b) ? `<section class="card sectionCard" style="margin-top:14px;${ownerOnlyStyle}"><h3>Distribuci\u00f3n de mesas</h3><p class="fieldHint">Organiza formas, colores y posiciones para este negocio.</p><button type="button" class="btn silver block" id="configureTablesBtn">${icon('layout-grid')} Configurar plano de mesas</button></section>` : ''}
	      ${isLogisticsBusiness(b) ? `<section class="card sectionCard" style="margin-top:14px;${ownerOnlyStyle}"><h3>Logística y rutas</h3><p class="fieldHint">Este negocio usa vehículos, rutas, hojas de carga, cobranzas y liquidación diaria.</p><button type="button" class="btn silver block" id="configureLogisticsBtn">${icon('truck')} Abrir rutas y logística</button></section>` : ''}

	      <section class="card sectionCard" style="margin-top:14px;${ownerOnlyStyle}">
	        <h3>Agregar otro negocio</h3>
        <div class="field"><label>Nombre</label><input id="newBizName"></div>
        <div class="field"><label>Tipo</label><select id="newBizType">${typeOptions('otro')}</select></div>
        <div class="field"><label>RUC (Opcional)</label><input id="newBizRuc"></div>
        <div class="field"><label>Teléfono (Opcional)</label><input id="newBizPhone"></div>
        <button type="button" class="btn silver block" id="createBiz">Crear negocio</button>
      </section>

	      <section class="card sectionCard" style="margin-top:14px; border:1px solid #4a1c1c;${ownerOnlyStyle}">
        <h3 style="color:#d9534f;">Zona de Peligro</h3>
        <button type="button" class="btn danger block" id="resetInventoryBtn" style="margin-bottom:10px;">Reiniciar Inventario</button>
        <button type="button" class="btn danger block" id="resetSystemBtn">Borrar Todo el Sistema (Empezar de cero)</button>
      </section>

      <section class="card sectionCard" style="margin-top:14px; text-align:center;">
        <h3>Soporte y Legales</h3>
        <button type="button" class="btn" style="border:1px solid #25D366; color:#25D366; background:transparent; width:100%; margin-bottom:12px;" onclick="window.open('https://wa.me/593969399562?text=Hola,%20necesito%20soporte%20con%20CLICK%20360', '_blank', 'noopener,noreferrer')">📱 Contactar Soporte (WhatsApp)</button>
        <p style="font-size:11px; color:#888; line-height:1.4;">Al usar el sistema, aceptas los <a href="#" id="showTerms" style="color:var(--gold); text-decoration:underline;">Términos y Condiciones</a>.</p>
      </section>`;
  }
  function typeOptions(selected){ return [
    ['ropa','Tienda / bazar / perfumes / ropa'],
    ['minimarket','Minimarket / licorería / farmacia'],
    ['restaurante','Restaurante / cafetería / bar'],
    ['servicios','Servicios'],
    ['barberia','Barbería'],
    ['ganaderia','Ganadería'],
    ['ferreteria','Ferretería'],
    ['logistica','Logística / distribución / transporte'],
    ['otro','Otro']
  ].map(([v,l])=>`<option value="${v}" ${selected===v?'selected':''}>${l}</option>`).join(''); }

  function bindView(r){
    if(r==='inventory') bindInventory();
    if(r==='sell') bindSell();
    if(r==='cash') bindCash();
    if(r==='more') bindMore();
    if(r==='backup') bindBackup();
    if(r==='settings') bindSettings();
    if(r==='workers') bindWorkers();
    if(r==='reports') bindReports();
    if(r==='invoices') bindInvoices();
    if(r==='crm') bindCrm();
	    if(r==='reminders') bindReminders();
	    if(r==='tables') bindTables();
	    if(r==='kitchen'||r==='bar') bindKitchen();
	    if(r==='logistics') bindLogistics();
    if(r==='finance') bindFinance();
    if(r==='help') bindHelp();
	    if(r==='access') bindAccess();
	    if(r==='printing') bindPrinting();
	  }
  function bindInventory(){
    $('#newProduct').onclick=()=>openProductModal();
    $('#productSearch').oninput=()=>{ const q=$('#productSearch').value.toLowerCase(); const p=productsForBiz().filter(x=>x.name.toLowerCase().includes(q)||x.code.toLowerCase().includes(q)); $('#productList').innerHTML=productList(p,businessVocabulary(currentBusiness().type)); bindInventoryActions(); };
    $('#productSearch').onkeydown=(event)=>{
      if(event.key!=='Enter') return;
      event.preventDefault();
      const code=normalizeCode(event.currentTarget.value);
      const product=productsForBiz().find((item)=>normalizeCode(item.code)===code);
      if(product) return openProductModal(product);
      if(code && confirm(`No existe el código ${code}. ¿Crear producto?`)) openProductModal(null, code);
    };
    if ($('#openCamera')) {
       $('#openCamera').onclick=()=>startScanner((code) => {
          const normalized = normalizeCode(code);
          const product = productsForBiz().find((item) => normalizeCode(item.code) === normalized);
          stopScanner();
          $('#cameraPanel')?.classList.remove('show');
          if (product) {
            openProductModal(product);
            return toast(`Producto encontrado: ${product.name}`);
          }
          if (normalized && confirm(`Código ${normalized} no registrado. ¿Crear producto?`)) openProductModal(null, normalized);
       });
    }

    // Bind template deletion
	    const labelSample = productsForBiz()[0] || { id: 'sample', businessId: currentBusiness().id, code: 'CLICK360', category: 'Ejemplo', name: 'Producto de ejemplo', qty: 1, price: 10, cardPrice: 10, taxMode: 'inherit', imageData: '' };
    const runTemplateOutput = (templateId, mode = 'system') => {
      const template = labelTemplatesForBiz().find((item) => item.id === templateId);
      if (!template) return toast('Plantilla no encontrada.', 'err');
      const products = productsForBiz();
      const options = mode === 'pdf' ? { directPdf:true } : { directPrint:true };
      if (products.length <= 1) {
        return openLabelModal(products[0] || labelSample, templateId, options);
      }
      showModal(`<div class="modalHeader"><div><h2>Elegir producto para esta plantilla</h2><p class="fieldHint">El diseño se conserva; el QR y el código se generan con el producto seleccionado.</p></div><button class="closeBtn" data-close aria-label="Cerrar">×</button></div><div class="businessSwitchList">${products.map((item) => `<button type="button" class="businessSwitchOption" data-template-product="${actionId(item.id)}"><span>${icon('tag')}<b>${escapeHtml(item.name || 'Producto')}</b><small>${escapeHtml(item.code || '')}</small></span>${icon('chevron-right')}</button>`).join('')}</div>`);
      $$('[data-template-product]').forEach((itemButton) => {
        itemButton.onclick = () => {
          const productId = decodeActionId(itemButton.dataset.templateProduct);
          const selected = productsForBiz().find((item) => item.id === productId);
          closeModal();
          if (!selected) return toast('Producto no encontrado.', 'err');
          return openLabelModal(selected, templateId, options);
        };
      });
      return null;
    };

	    $$('[data-print-tpl]').forEach((button) => button.onclick = async () => {
	      if (typeof _printDialogState !== 'undefined' && _printDialogState !== 'idle') {
	        return toast('Ya hay una impresión activa. Espera a que termine.', 'warn');
	      }
	      runTemplateOutput(button.dataset.printTpl, 'system');
	    });

    $$('[data-pdf-tpl]').forEach((button) => button.onclick = async () => {
      if (typeof _printDialogState !== 'undefined' && _printDialogState !== 'idle') {
        return toast('Ya hay una generación de PDF activa. Espera a que termine.', 'warn');
      }
	      runTemplateOutput(button.dataset.pdfTpl, 'pdf');
	    });

    $$('[data-edit-tpl]').forEach((button) => button.onclick = () => openLabelModal(labelSample, button.dataset.editTpl));
    $$('[data-rename-tpl]').forEach((button) => button.onclick = () => {
      const template = labelTemplatesForBiz().find((item) => item.id === button.dataset.renameTpl);
      if (!template) return;
      const name = prompt('Nuevo nombre de la plantilla:', template.name);
      if (!name?.trim()) return;
      template.name = name.trim();
      template.updatedAt = new Date().toISOString();
      if (!save()) return;
      renderApp('inventory');
      toast('Plantilla renombrada');
    });
    $$('[data-duplicate-tpl]').forEach((button) => button.onclick = () => {
      const template = labelTemplatesForBiz().find((item) => item.id === button.dataset.duplicateTpl);
      if (!template) return;
      const copy = JSON.parse(JSON.stringify(template));
      copy.id = uid('tpl');
      copy.name = `${template.name} copia`;
      copy.isDefault = false;
      copy.createdAt = new Date().toISOString();
      copy.updatedAt = copy.createdAt;
      state.settings.labelTemplates.push(copy);
      if (!save()) return;
      renderApp('inventory');
      toast('Plantilla duplicada');
    });
    $$('[data-default-tpl]').forEach((button) => button.onclick = () => {
      labelTemplatesForBiz().forEach((template) => { template.isDefault = template.id === button.dataset.defaultTpl; });
      if (!save()) return;
      renderApp('inventory');
      toast('Plantilla predeterminada actualizada');
    });
    $$('[data-del-tpl]').forEach(btn => {
       btn.onclick = () => {
          if (confirm('¿Estás seguro de eliminar esta plantilla de etiquetas?')) {
             const tplId = btn.dataset.delTpl;
             state.settings ||= {};
             state.settings.labelTemplates ||= [];
             const businessId = currentBusiness().id;
             const previous = [...state.settings.labelTemplates];
             state.settings.labelTemplates = previous.filter((template) =>
               template.id !== tplId || !(
                 template.businessId === businessId
                 || (!template.businessId && state.settings?.legacyDataBusinessId === businessId)
               ));
             if (state.settings.labelTemplates.length === previous.length) return toast('Plantilla no encontrada.', 'err');
             const remainingTemplates = labelTemplatesForBiz();
             if (remainingTemplates.length && !remainingTemplates.some((template) => template.isDefault)) remainingTemplates[0].isDefault = true;
             addAudit('label_template_deleted', { templateId: tplId, businessId });
             if(!save()) { state.settings.labelTemplates = previous; return toast('No se pudo eliminar la plantilla.', 'err'); }
             renderApp('inventory');
             toast('Plantilla eliminada', 'ok');
          }
       };
    });

    bindInventoryActions();
  }
  function bindInventoryActions(){
    $$('[data-edit]').forEach(b=>b.onclick=()=>openProductModal(state.products.find(p=>p.id===b.dataset.edit && p.businessId===currentBusiness()?.id)));
    $$('[data-del]').forEach(b=>b.onclick=()=>deleteProduct(b.dataset.del));
    $$('[data-label]').forEach(b=>b.onclick=()=>openLabelModal(state.products.find(p=>p.id===b.dataset.label && p.businessId===currentBusiness()?.id)));
    $$('[data-quick-print]').forEach(b=>b.onclick=()=>{
      try {
        const biz=currentBusiness();
        if(!biz) return toast('Selecciona un negocio activo primero.','err');
        const product=state.products.find(p=>p.id===b.dataset.quickPrint && p.businessId===biz?.id);
        if(!product) return toast('Producto no encontrado.','err');
        const templates=(state.settings?.labelTemplates||[]).filter(t=>t.businessId===biz.id||((!t.businessId)&&state.settings?.legacyDataBusinessId===biz.id));
        const tpl=templates.find(t=>t.isDefault)||templates[0]||null;
        if(!tpl) { openLabelModal(product); return toast('Configura y guarda una plantilla primero. Usa el botón QR dorado.','ok'); }
        openLabelModal(product, tpl.id, { directPrint: true });
      } catch(e) { console.warn('quick-print error:', e); toast('No se pudo imprimir.','err'); }
    });
  }
	  function openProductModal(product=null, initialCode=''){
	    const b=currentBusiness(), v=businessVocabulary(b.type);
	    const p=product || {id:null,code:normalizeCode(initialCode),category:'',name:'',qty:0,cost:0,price:0,taxMode:'inherit',notes:'',imageData:''};
	    const linkedRecipe = product ? restaurantRecipesForBiz().find((recipe) => recipe.productId === product.id) : null;
    const productImage = safeImageSrc(p.imageData);
    showModal(`<div class="modalHeader"><h2>${product?'Editar':'Nuevo'} ${escapeHtml(v.singular)}</h2><button class="closeBtn" data-close>×</button></div>
      <form id="productForm" class="formGrid">
        <div class="field full productImageField">
          <label>Imagen del producto (opcional)</label>
	          <div class="imagePicker">
	            <div id="imagePreview">${productImage ? `<img src="${escapeHtml(productImage)}" alt="Imagen del producto">` : `<span>Sin imagen</span>`}</div>
	            <div class="imagePickerActions">
	               <button type="button" class="btn silver" id="pImageGalleryBtn">Galería</button>
	               <button type="button" class="btn silver" id="pImageCameraBtn">Tomar foto</button>
	               <input type="file" id="pImageGal" accept="image/*" hidden>
	               <input type="file" id="pImageCam" accept="image/*" capture="environment" hidden>
	            </div>
	            ${productImage ? '<button type="button" class="btn" id="removeImage">Quitar imagen</button>' : ''}
	          </div>
        </div>
        <div class="field"><label>Código</label><input id="pCode" value="${escapeHtml(p.code)}" placeholder="Auto si vacío"></div>
        <div class="field"><label>${escapeHtml(v.category)}</label><input id="pCat" value="${escapeHtml(p.category)}" placeholder="${escapeHtml(v.examples)}"></div>
        <div class="field full"><label>Nombre</label><input id="pName" required value="${escapeHtml(p.name)}"></div>
        <div class="field"><label>Cantidad</label><input id="pQty" inputmode="numeric" value="${numericInputValue(p.qty)}"></div>
        <div class="field"><label>Costo</label><input id="pCost" inputmode="decimal" value="${numericInputValue(p.cost).replace('.',',')}"></div>
        <div class="field"><label>Precio (Efectivo)</label><input id="pPrice" inputmode="decimal" value="${numericInputValue(p.price).replace('.',',')}"></div>
        <div class="field"><label>Precio con Tarjeta</label><input id="pCardPrice" inputmode="decimal" value="${numericInputValue(p.cardPrice ?? p.price).replace('.',',')}"></div>
	        <div class="field full"><label>IVA del producto</label><select id="pTaxMode"><option value="inherit" ${!p.taxMode || p.taxMode === 'inherit' ? 'selected' : ''}>Usar configuración de IVA del negocio</option><option value="included" ${p.taxMode === 'included' ? 'selected' : ''}>Incluye IVA</option><option value="excluded" ${p.taxMode === 'excluded' ? 'selected' : ''}>No incluye IVA</option><option value="exempt" ${p.taxMode === 'exempt' ? 'selected' : ''}>Exento de IVA</option></select></div>
	        <div class="field full"><label>Notas</label><textarea id="pNotes">${escapeHtml(p.notes||'')}</textarea></div>
	        ${restaurantModuleEnabled() ? `<fieldset class="field full productRecipeField"><legend>Receta para cocina</legend><p class="fieldHint">La receta pertenece al producto de inventario y cocina la ve junto con la imagen.</p><label>Ingredientes<input id="pRecipeIngredients" maxlength="500" value="${escapeHtml(linkedRecipe?.ingredients || '')}" placeholder="Ej. pan, carne, queso, salsa"></label><label>Preparación<textarea id="pRecipeSteps" maxlength="900" placeholder="Pasos de preparación">${escapeHtml(linkedRecipe?.steps || '')}</textarea></label></fieldset>` : ''}
        <button type="button" class="btn" data-close>Cancelar</button><button class="btn primary" type="submit">Guardar</button>
      </form>`);
	    let imageData = productImage;
		    bindImageInputPair({
	      cameraInputId: 'pImageCam',
	      galleryInputId: 'pImageGal',
	      cameraButtonId: 'pImageCameraBtn',
	      galleryButtonId: 'pImageGalleryBtn',
	      onImage: (data) => {
	        imageData = data;
	        const safe = safeImageSrc(data);
	        imageData = safe;
	        $('#imagePreview').innerHTML = safe ? `<img src="${escapeHtml(safe)}" alt="Imagen del producto">` : '<span>Sin imagen</span>';
	      }
	    });
	    $('#removeImage')?.addEventListener('click',()=>{ imageData=''; $('#imagePreview').innerHTML='<span>Sin imagen</span>'; });

    // Restrict inputs to numeric values only
    const qtyIn = $('#pQty');
    if (qtyIn) qtyIn.oninput = () => { qtyIn.value = qtyIn.value.replace(/[^0-9]/g, ''); };
    const costIn = $('#pCost');
    if (costIn) costIn.oninput = () => { costIn.value = costIn.value.replace(/[^0-9.,]/g, ''); };
    const priceIn = $('#pPrice');
    if (priceIn) priceIn.oninput = () => { priceIn.value = priceIn.value.replace(/[^0-9.,]/g, ''); };
    const cardPriceIn = $('#pCardPrice');
    if (cardPriceIn) cardPriceIn.oninput = () => { cardPriceIn.value = cardPriceIn.value.replace(/[^0-9.,]/g, ''); };

    $('#productForm').onsubmit=e=>{
      e.preventDefault();
      const name=$('#pName').value.trim();
      const qty=parseInt($('#pQty').value||'0',10);
      const cost=parseMoney($('#pCost').value);
      const price=parseMoney($('#pPrice').value);
      const cardPrice=parseMoney($('#pCardPrice').value) || price;
      let code=($('#pCode').value.trim() || generateCode(name)).toUpperCase();
      if(!name) return toast('Falta el nombre','err');
      if(!Number.isFinite(qty)||qty<0) return toast('Cantidad inválida','err');
      if(!Number.isFinite(cost)||cost<0) return toast('Costo inválido','err');
      if(!Number.isFinite(price)||price<0) return toast('Precio inválido','err');
      if(!Number.isFinite(cardPrice)||cardPrice<0) return toast('Precio con tarjeta inválido','err');
      if(codeExists(code, product?.id)) return toast('Ese código ya existe','err');
	      const updatedAtMs = Date.now();
	      const taxMode = $('#pTaxMode').value;
	      let savedProduct = product;
	      if(product) Object.assign(product,{code,category:$('#pCat').value.trim(),name,qty,cost,price,cardPrice,taxMode,notes:$('#pNotes').value.trim(),imageData, updatedBy: authUser().name, updatedAt:new Date(updatedAtMs).toISOString(), updatedAtMs});
	      else { savedProduct = {id:uid('prod'),businessId:b.id,code,category:$('#pCat').value.trim(),name,qty,cost,price,cardPrice,taxMode,notes:$('#pNotes').value.trim(),imageData,createdAt:new Date(updatedAtMs).toISOString(), createdAtMs:updatedAtMs, updatedAt:new Date(updatedAtMs).toISOString(), updatedAtMs, createdBy: authUser().name}; state.products.push(savedProduct); }
	      if (restaurantModuleEnabled()) {
	        const ingredients = $('#pRecipeIngredients')?.value.trim() || '';
	        const steps = $('#pRecipeSteps')?.value.trim() || '';
	        const existingRecipe = state.restaurantRecipes.find((recipe) => recipe.productId === savedProduct.id && recipe.businessId === b.id);
	        if (ingredients || steps) Object.assign(existingRecipe || (state.restaurantRecipes.push({ id:uid('recipe'), businessId:b.id, productId:savedProduct.id, createdAt:new Date(updatedAtMs).toISOString() }), state.restaurantRecipes.at(-1)), { name:savedProduct.name, productName:savedProduct.name, ingredients, steps, updatedAtMs });
	        else if (existingRecipe) state.restaurantRecipes = state.restaurantRecipes.filter((recipe) => recipe.id !== existingRecipe.id);
	      }
	      if(!save()) return; closeModal(); renderApp('inventory'); toast(product?'Producto actualizado con éxito':'Producto creado con éxito', 'ok');
	    };
	  }
	  async function deleteProduct(id){
	    if(confirm('¿Borrar este producto? Se guardará una huella para que no reaparezca desde otro dispositivo.')){
	      const businessId = currentBusiness()?.id;
	      const p=state.products.find(x=>x.id===id && x.businessId===businessId);
	      if (!p) return toast('Producto no encontrado en este negocio.', 'err');
	      const previousState = cloneState(state);
	      if(p) {
	        tombstoneProduct(p, 'manual_delete');
	        state.movements.push({id:uid('mov'),businessId,date:today(),when:nowLabel(),kind:'egreso',amount:0,note:`Eliminó producto: ${p.name}`,cashSessionId:currentOpenCashSession(businessId)?.id||'',createdAtMs:Date.now(),createdBy: authUser().name});
	      }
	      state.products=state.products.filter(x=>x.id!==id || x.businessId!==businessId);
	      const committed = await commitCriticalMutation(previousState, 'product_deleted', (next) =>
	        !next.products.some((item) => item.id === id && item.businessId === businessId)
	        && next.deletedProducts.some((item) => item.id === id && item.businessId === businessId));
	      renderApp('inventory');
	      if (committed.ok) toast(committed.pending ? 'Producto eliminado; sincronización pendiente.' : 'Producto eliminado');
	    }
	  }

	  function bindSell(){
	    if(!$('#payMethod')) return;
	    let cart=[];
	    const currentTax = businessTaxConfig();
	    $('#calculatorSellBtn')?.addEventListener('click', () => openCalculator({ base: parseMoney($('#cartTotal')?.textContent || 0), preferredTarget: 'cashReceived' }));

    const calculateCurrentCart = (method = $('#payMethod').value) => {
      const isCard = method === 'Tarjeta';
      const lines = cart.map((item) => ({ ...item, unitPrice: isCard ? item.cardPrice : item.price }));
      const discount = parseMoney($('#discount')?.value || 0);
      return window.CLICK360_V16_DOMAIN?.calculateCart(lines, Number.isFinite(discount) ? discount : 0, currentTax)
        || { lines, gross: 0, discount: 0, subtotal: 0, tax: 0, total: 0, config: currentTax };
    };

    const renderCart=()=>{
      const method = $('#payMethod').value;
      const isCard = method === 'Tarjeta';
      const calculation = calculateCurrentCart(method);
      const total = calculation.total;

      $('#cartTotal').textContent=fmt(total);

      const subView = $('#cartSubtotalView'), ivaView = $('#cartIvaView');
      if (currentTax.enabled && currentTax.rate > 0) {
         subView.style.display = 'flex'; ivaView.style.display = 'flex';
         subView.querySelector('b').textContent = fmt(calculation.subtotal);
         ivaView.querySelector('b').textContent = fmt(calculation.tax);
      } else {
         subView.style.display = 'none'; ivaView.style.display = 'none';
      }

      $('#cartItems').innerHTML=cart.length?cart.map(i=>{ const src=safeImageSrc(i.imageData); return `<div class="cartItem cartWithImage">${src ? `<img class="productImg small" src="${escapeHtml(src)}" alt="${escapeHtml(i.name)}">` : '<div class="productImg small emptyImg">▧</div>'}<div><b>${escapeHtml(i.name)}</b><br><small>${fmt(isCard ? i.cardPrice : i.price)} /u · ${escapeHtml(i.code)}</small></div><div class="qtyControls"><button type="button" data-minus="${escapeHtml(i.id)}">−</button><b>${i.qty}</b><button type="button" data-plus="${escapeHtml(i.id)}">＋</button><button type="button" class="iconBtn danger" data-remove="${escapeHtml(i.id)}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2 2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></div></div>`; }).join(''):'<p class="empty">Vacío. Agrega productos para vender.</p>';
      $$('[data-minus]').forEach(b=>b.onclick=()=>{const it=cart.find(x=>x.id===b.dataset.minus); if(it.qty>1)it.qty--; else cart=cart.filter(x=>x.id!==it.id); renderCart();});
      $$('[data-plus]').forEach(b=>b.onclick=()=>{const it=cart.find(x=>x.id===b.dataset.plus); const p=it && state.products.find(p=>p.id===it.id && p.businessId===currentBusiness()?.id); if (!it || (!it.isCustom && (!p || it.qty >= p.qty))) return toast('No hay mas stock disponible', 'err'); it.qty++; renderCart();});
      $$('[data-remove]').forEach(b=>b.onclick=()=>{cart=cart.filter(x=>x.id!==b.dataset.remove); renderCart();});

      const recF = $('#receivedField'), chgF = $('#changeField'), lblCustomer = $('#lblCustomer');

      if (method === 'Apartado' || method === 'Pendiente') {
        lblCustomer.innerHTML = 'Cliente (Nombre) <b>*Obligatorio</b>';
      } else {
        lblCustomer.textContent = 'Cliente (opcional)';
      }

      const dueField = $('#layawayDueDateField');
      const termsField = $('#layawayTermsField');
      if (method === 'Apartado') {
         if (dueField) {
            dueField.style.display = 'grid';
            const dueInput = $('#layawayDueDate');
            if (dueInput && !dueInput.value) {
               const future = new Date();
               future.setDate(future.getDate() + 30);
               dueInput.value = localDateKey(future);
            }
         }
         if (termsField) termsField.style.display = 'grid';
      } else {
         if (dueField) dueField.style.display = 'none';
         if (termsField) termsField.style.display = 'none';
      }

      if (method === 'Efectivo') {
        recF.style.display = 'grid'; chgF.style.display = 'grid';
        const rec = parseMoney($('#cashReceived').value);
        if(Number.isFinite(rec) && rec >= total) {
           $('#cashChange').value = fmt(rec - total);
        } else {
           $('#cashChange').value = '$0.00';
        }
      } else if(method === 'Apartado') {
        recF.style.display = 'grid'; chgF.style.display = 'grid';
        $('#receivedField label').textContent = 'Abono Inicial';
        $('#changeField label').textContent = 'Saldo Pendiente';
        const rec = parseMoney($('#cashReceived').value);
        if(Number.isFinite(rec)) {
           $('#cashChange').value = fmt(Math.max(0, total - rec));
        } else {
           $('#cashChange').value = fmt(total);
        }
      } else {
        recF.style.display = 'none'; chgF.style.display = 'none';
        $('#receivedField label').textContent = 'Efectivo Recibido';
        $('#changeField label').textContent = 'Vuelto';
      }
    };

    $('#payMethod').onchange = renderCart;

    const discIn = $('#discount'), cashRecIn = $('#cashReceived');
    if (discIn) { discIn.oninput = () => { discIn.value = discIn.value.replace(/[^0-9.,]/g, ''); renderCart(); }; }
    if (cashRecIn) { cashRecIn.oninput = () => { cashRecIn.value = cashRecIn.value.replace(/[^0-9.,]/g, ''); renderCart(); }; }

    const addProduct=(input)=>{
      const code=normalizeCode(input).toUpperCase().trim();
      let p=productsForBiz().find(x=>normalizeCode(x.code)===code);
      if(!p){
        const possible = String(input||'').toUpperCase().match(/[A-Z0-9_-]{3,17}/g) || [];
        p = productsForBiz().find(x=>possible.includes(normalizeCode(x.code)));
      }
      if(!p){
        beep('err');
        if (code && confirm(`Producto no encontrado: ${code}. ¿Crear este producto?`)) openProductModal(null, code);
        else toast(`Producto no encontrado: ${code || 'sin código'}`,'err');
        return;
      }
      if(p.qty<=0){ beep('err'); return toast('Sin stock disponible','err'); }
      const it=cart.find(x=>x.id===p.id);
      if(it){ if(it.qty>=p.qty){ beep('err'); return toast('No hay más stock','err'); } it.qty++; }
      else cart.push({id:p.id,name:p.name,price:p.price,cardPrice:p.cardPrice||p.price,qty:1,code:p.code,imageData:p.imageData||'',taxMode:p.taxMode||'inherit'});
      renderCart(); beep(); toast(`${p.name} agregado`);
    };

    if($('#clearCartBtn')) {
       $('#clearCartBtn').onclick = () => {
          if(!cart.length) return;
          if(confirm('¿Limpiar todo el carrito?')) {
             cart = [];
             $('#discount').value = '0';
             $('#cashReceived').value = '';
             $('#customer').value = '';
             $('#customerCedula').value = '';
             $('#customerPhone').value = '';
             renderCart();
             toast('Carrito limpio');
          }
       };
    }

    $('#addCode').onclick=()=>{
        const v = $('#manualCode').value.trim();
        if(v) { addProduct(v); $('#manualCode').value=''; }
        else {
            const name = prompt("Nombre del producto/servicio (Ej: Venta Libre):");
            if (!name) return;
            const priceRaw = prompt("Precio ($):");
            const price = parseMoney(priceRaw);
            if (!Number.isFinite(price) || price < 0) return toast("Precio inválido", "err");
            cart.push({ id: 'custom_'+Date.now(), name, price, cardPrice: price, qty: 1, isCustom: true, category: 'Venta Libre', code: 'MANUAL', taxMode: 'inherit' });
            renderCart();
            toast('Producto manual agregado');
        }
    };
    $('#manualCode').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#addCode').click();}});
    $('#sellSearch').oninput=()=>{ const q=$('#sellSearch').value.toLowerCase(); const list=productsForBiz().filter(p=>String(p.name || '').toLowerCase().includes(q)||String(p.code || '').toLowerCase().includes(q)).slice(0,8); $('#quickProducts').innerHTML=list.map(p=>`<button class="card bigRow quickProduct" data-quick="${escapeHtml(p.code)}">${imageThumb(p)}<span>${escapeHtml(p.name)}<br><small>${escapeHtml(p.code)} · ${p.qty} disp.</small></span><b>${fmt(p.price)}</b></button>`).join(''); $$('[data-quick]').forEach(b=>b.onclick=()=>addProduct(b.dataset.quick)); };
    $('#openCamera').onclick=()=>startScanner(addProduct);
    $('#chargeBtn').onclick=async()=>{
      if(!cart.length){ beep('err'); return toast('El carrito está vacío','err'); }
      const disc=parseMoney($('#discount').value);
      if(!Number.isFinite(disc)||disc<0){ beep('err'); return toast('Descuento inválido','err'); }

      const method = $('#payMethod').value;
      const isCard = method === 'Tarjeta';
      const gross = cart.reduce((a,i)=>a+(isCard ? i.cardPrice : i.price)*i.qty,0);
      if(disc>gross){ beep('err'); return toast('El descuento supera el subtotal','err'); }

      const calculation = calculateCurrentCart(method);
      const base = calculation.subtotal;
      const ivaAmount = calculation.tax;
      const total = calculation.total;

      for(const i of cart){
        if(i.isCustom) continue;
        const p=state.products.find(p=>p.id===i.id && p.businessId===currentBusiness()?.id);
        if(!p||p.qty<i.qty){ beep('err'); return toast(`Stock insuficiente: ${i.name}`,'err'); }
      }

      const rec = parseMoney($('#cashReceived').value);
	      let received = 0; let tendered = 0; let change = 0; let balance = 0;
      let status = "paid";

      const customerName = $('#customer').value.trim();
      const customerCedulaVal = $('#customerCedula').value.trim();
      const customerPhoneVal = $('#customerPhone').value.trim();

      if ((method === 'Apartado' || method === 'Pendiente') && (!customerName || !customerPhoneVal || !customerCedulaVal)) {
         beep('err'); return toast('Debe ingresar el Nombre, Cédula y Teléfono del Cliente para cuentas por cobrar','err');
      }

      if(method === 'Efectivo') {
         if(!Number.isFinite(rec) || rec < total) { beep('err'); return toast('Efectivo recibido es menor al total','err'); }
	         tendered = rec; received = total; change = rec - total;
      } else if (method === 'Apartado') {
         if (!$('#layawayDueDate').value) { beep('err'); return toast('Selecciona la fecha limite de retiro.', 'err'); }
         if (!$('#layawayTermsAccepted')?.checked) { beep('err'); return toast('Debes confirmar la aceptacion de los terminos del apartado.', 'err'); }
         if(!Number.isFinite(rec) || rec < 0) { beep('err'); return toast('Monto de abono inválido','err'); }
         if(rec > total) { beep('err'); return toast('El abono no puede superar el total','err'); }
         received = rec; balance = total - rec; status = 'layaway';
      } else if (method === 'Pendiente') {
         received = 0; balance = total; status = 'pending_payment';
      } else {
         received = total;
      }

	      const previousState = cloneState(state);
	      const saleCreatedAtMs = Date.now();
	      const policySnapshot = method === 'Apartado' ? businessPolicies() : null;
	      const sale={
	        id:uid('sale'),
	        operationId: uid('saleop'),
	        cashSessionId: currentOpenCashSession()?.id || '',
	        businessId:currentBusiness().id,
	        date:today(),
	        when:nowLabel(),
        items:calculation.lines.map(i=>({
          id: i.id,
          name: i.name,
          price: i.unitPrice,
          qty: i.qty,
          code: i.code,
          category: i.category || 'General',
          taxMode: i.taxMode,
          taxBase: i.base,
          tax: i.tax,
          total: i.total
        })),
	        subtotal:base,
	        receiptSubtotal:calculation.displaySubtotal,
        iva:ivaAmount,
        taxRate: currentTax.rate,
        taxPriceMode: currentTax.priceMode,
        discount:disc,
        total,
        method,
        customer:customerName,
        customerCedula:customerCedulaVal,
        customerPhone:customerPhoneVal,
        dueDate: method === 'Apartado' ? $('#layawayDueDate').value : null,
        inventoryDisposition: method === 'Apartado' ? 'reserved' : 'sold',
        terms: policySnapshot ? layawayTermsText() : '',
        termsVersion: policySnapshot?.version || null,
        termsAccepted: method === 'Apartado' ? true : false,
        termsAcceptedAt: method === 'Apartado' ? new Date(saleCreatedAtMs).toISOString() : null,
        user:authUser().name,
	        status,
	        received,
	        tendered,
	        change,
	        balance,
	        payments: received > 0 ? [{ id: uid('pay'), date: today(), when: nowLabel(), amount: received, method, createdBy: authUser().name }] : [],
	        createdAt: new Date(saleCreatedAtMs).toISOString(),
	        createdAtMs: saleCreatedAtMs,
	        updatedAt: new Date(saleCreatedAtMs).toISOString(),
	        updatedAtMs: saleCreatedAtMs,
	        createdBy: authUser().name
	      };
      state.sales.push(sale);
	      if (method === 'Apartado') {
	        state.layaways ||= [];
	        state.layaways.push({
	          id: uid('layaway'),
	          saleId: sale.id,
	          businessId: sale.businessId,
	          customerId: '',
	          customerSnapshot: { name: customerName, cedula: customerCedulaVal, phone: customerPhoneVal },
	          phone: customerPhoneVal,
	          items: sale.items.map((item) => ({ ...item, inventoryDisposition: 'reserved' })),
	          total: sale.total,
	          paid: sale.received,
	          balance: sale.balance,
	          methods: sale.payments.map((payment) => payment.method),
	          createdAt: sale.createdAt,
	          pickupDueAt: sale.dueDate,
	          responsible: sale.createdBy,
	          status: sale.balance > 0 ? (sale.received > 0 ? 'partially_paid' : 'active') : 'paid',
	          terms: sale.terms,
	          termsVersion: sale.termsVersion,
	          accepted: true,
	          acceptedAt: sale.termsAcceptedAt,
	          payments: sale.payments.map((payment) => ({ ...payment })),
	          notes: ''
	        });
	      }
	      cart.forEach(i=>{ if(i.isCustom) return; const p=state.products.find(p=>p.id===i.id && p.businessId===currentBusiness()?.id); if(p) { p.qty-=i.qty; p.updatedAtMs = Date.now(); p.updatedAt = new Date().toISOString(); p.updatedBy = authUser().name; } });

      let movAmount = (method === 'Apartado') ? received : (method === 'Pendiente' ? 0 : total);
      if(movAmount > 0) {
	        state.movements.push({id:uid('mov'),businessId:currentBusiness().id,date:today(),when:nowLabel(),kind:'ingreso',amount:movAmount,note:`Venta ${sale.method}`,user:authUser().name,saleId:sale.id,paymentMethod:sale.method,cashSessionId:sale.cashSessionId,createdAtMs:Date.now(),createdBy:authUser().name});
      }

      addAudit('sale_created', { saleId: sale.id, total: sale.total, method: sale.method, status: sale.status });
      const committed = await commitCriticalMutation(previousState, 'sale_created', (next) =>
        next.sales.some((item) => item.id === sale.id && item.businessId === sale.businessId));
      if(!committed.ok) { renderApp('sell'); return; }
      cart=[];
      $('#cashReceived').value='';
      $('#discount').value='0';
      $('#customer').value = '';
      $('#customerCedula').value = '';
      $('#customerPhone').value = '';
      renderCart();
      beep('sale'); toast(committed.pending ? `Venta guardada sin conexión · ${fmt(total)}` : `Venta registrada · ${fmt(total)}`);

      setTimeout(() => {
        if(window.printReceipt) window.printReceipt(actionId(sale.id));
      }, 500);
    };
  }


  function decodeLocalC360QR(imageData){
    const w=imageData.width,h=imageData.height,d=imageData.data;
    if(!w||!h||w<80||h<80) return null;
    const gray=new Uint8Array(w*h);
    let sum=0, min=255, max=0;
    for(let i=0,p=0;i<d.length;i+=4,p++){
      const g=(d[i]*299+d[i+1]*587+d[i+2]*114)/1000|0;
      gray[p]=g; sum+=g; if(g<min)min=g; if(g>max)max=g;
    }
    const threshold=(sum/(w*h))*0.85 + (min+max)*0.075;
    const black=(x,y)=>gray[y*w+x] < threshold;

    function ratioOK(r){
      const t=r.reduce((a,b)=>a+b,0); if(t<14) return false;
      const m=t/7;
      return Math.abs(r[0]-m)<m*.95 && Math.abs(r[1]-m)<m*.95 && Math.abs(r[2]-3*m)<3*m*.65 && Math.abs(r[3]-m)<m*.95 && Math.abs(r[4]-m)<m*.95;
    }
    const cands=[];
    const step=Math.max(1,Math.floor(h/240));
    for(let y=0;y<h;y+=step){
      let runs=[], colors=[], x=0, cur=black(0,y), len=0, start=0;
      for(x=0;x<w;x++){
        const b=black(x,y);
        if(b===cur) len++;
        else { runs.push(len); colors.push(cur); cur=b; len=1; }
      }
      runs.push(len); colors.push(cur);
      let pos=0;
      for(let i=0;i<runs.length-4;i++){
        const seq=runs.slice(i,i+5), cols=colors.slice(i,i+5);
        if(cols[0]&& !cols[1]&&cols[2]&&!cols[3]&&cols[4] && ratioOK(seq)){
          const total=seq.reduce((a,b)=>a+b,0);
          const cx=pos+seq[0]+seq[1]+seq[2]/2;
          const module=total/7;
          // vertical cross-check
          const ix=Math.max(0,Math.min(w-1,Math.round(cx)));
          let up=0,down=0;
          for(let yy=y;yy>=0 && black(ix,yy);yy--) up++;
          for(let yy=y+1;yy<h && black(ix,yy);yy++) down++;
          const centerRun=up+down;
          if(centerRun>module*1.5 && centerRun<module*4.8) cands.push({x:cx,y,module});
        }
        pos+=runs[i];
      }
    }
    if(cands.length<3) return null;
    const clusters=[];
    for(const c of cands){
      let found=null;
      for(const cl of clusters){
        const dx=cl.x/cl.n-c.x, dy=cl.y/cl.n-c.y;
        if(Math.hypot(dx,dy)<Math.max(8,c.module*3)){found=cl;break;}
      }
      if(found){found.x+=c.x; found.y+=c.y; found.module+=c.module; found.n++;}
      else clusters.push({x:c.x,y:c.y,module:c.module,n:1});
    }
    const pts=clusters.filter(c=>c.n>=2).map(c=>({x:c.x/c.n,y:c.y/c.n,module:c.module/c.n,n:c.n})).sort((a,b)=>b.n-a.n).slice(0,6);
    if(pts.length<3) return null;
    let best=null, bestArea=0;
    for(let i=0;i<pts.length;i++)for(let j=i+1;j<pts.length;j++)for(let k=j+1;k<pts.length;k++){
      const a=pts[i],b=pts[j],c=pts[k];
      const area=Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x));
      if(area>bestArea){bestArea=area;best=[a,b,c];}
    }
    if(!best) return null;
    let [p0,p1,p2]=best;
    const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
    const d01=dist(p0,p1), d02=dist(p0,p2), d12=dist(p1,p2);
    let tl,tr,bl;
    if(d12>=d01 && d12>=d02){ tl=p0; tr=p1; bl=p2; }
    else if(d02>=d01 && d02>=d12){ tl=p1; tr=p0; bl=p2; }
    else { tl=p2; tr=p0; bl=p1; }
    const cross=(tr.x-tl.x)*(bl.y-tl.y)-(tr.y-tl.y)*(bl.x-tl.x);
    if(cross<0){ const tmp=tr; tr=bl; bl=tmp; }
    const vtr={x:tr.x-tl.x,y:tr.y-tl.y}, vbl={x:bl.x-tl.x,y:bl.y-tl.y};
    const distTR=Math.hypot(vtr.x,vtr.y), distBL=Math.hypot(vbl.x,vbl.y);
    if(distTR<40||distBL<40) return null;
    const size=29;
    const sample=(r,c)=>{
      const u=(c-3.5)/22, v=(r-3.5)/22;
      const x=Math.round(tl.x+vtr.x*u+vbl.x*v);
      const y=Math.round(tl.y+vtr.y*u+vbl.y*v);
      if(x<0||y<0||x>=w||y>=h) return false;
      let cnt=0,tot=0;
      for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++){
        const sx=x+xx, sy=y+yy;
        if(sx>=0&&sy>=0&&sx<w&&sy<h){tot++; if(black(sx,sy))cnt++;}
      }
      return cnt>tot/2;
    };
    const reserved=Array.from({length:size},()=>Array(size).fill(false));
    function reserveFinder(r,c){
      for(let y=-1;y<=7;y++)for(let x=-1;x<=7;x++){
        const rr=r+y, cc=c+x;
        if(rr>=0&&cc>=0&&rr<size&&cc<size) reserved[rr][cc]=true;
      }
    }
    reserveFinder(0,0); reserveFinder(0,size-7); reserveFinder(size-7,0);
    for(let i=8;i<size-8;i++){reserved[6][i]=true;reserved[i][6]=true;}
    for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++) reserved[22+y][22+x]=true;
    for(let i=0;i<9;i++){ if(i!==6){reserved[8][i]=true;reserved[i][8]=true;} }
    for(let i=0;i<8;i++){reserved[8][size-1-i]=true;reserved[size-1-i][8]=true;}
    const bits=[];
    let upward=true;
    for(let right=size-1;right>=1;right-=2){
      if(right===6) right--;
      for(let vert=0;vert<size;vert++){
        const r=upward?size-1-vert:vert;
        for(let j=0;j<2;j++){
          const c=right-j;
          if(reserved[r][c]) continue;
          let bit=sample(r,c);
          if(((r+c)&1)===0) bit=!bit; // mask 0
          bits.push(bit?1:0);
        }
      }
      upward=!upward;
    }
    const read=(pos,len)=>{let v=0;for(let i=0;i<len;i++)v=(v<<1)|(bits[pos+i]||0);return v;};
    if(read(0,4)!==4) return null;
    const len=read(4,8);
    if(len<=0||len>80) return null;
    const bytes=[];
    let pos=12;
    for(let i=0;i<len;i++){ bytes.push(read(pos,8)); pos+=8; }
    let text;
    try{text=new TextDecoder().decode(new Uint8Array(bytes));}catch{return null;}
    return text ? text : null;
  }

  let currentFacingMode = 'environment';
  const BARCODE_FORMATS = Object.freeze(['qr_code','ean_13','ean_8','upc_a','upc_e','code_128','code_39','codabar','itf']);
  async function createBarcodeDetector() {
    if (!('BarcodeDetector' in window)) return null;
    try {
      const supported = typeof BarcodeDetector.getSupportedFormats === 'function'
        ? await BarcodeDetector.getSupportedFormats() : BARCODE_FORMATS;
      const formats = BARCODE_FORMATS.filter((format) => supported.includes(format));
      return new BarcodeDetector({ formats: formats.length ? formats : ['qr_code'] });
    } catch {
      try { return new BarcodeDetector({ formats:['qr_code'] }); } catch { return null; }
    }
  }
  async function startScanner(onCode, toggleMode=false){
    if(toggleMode) currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    stopScanner(false);
    const generation = ++scannerGeneration;
    const panel=$('#cameraPanel'), video=$('#scanVideo'), status=$('#cameraStatus');
    panel.classList.add('show');
    if(!$('#scanUpload')){
      const input=document.createElement('input');
      input.type='file'; input.accept='image/*'; input.id='scanUpload'; input.style.display='none';
      panel.appendChild(input);

      const btnRow = document.createElement('div');
      btnRow.style.display = 'flex'; btnRow.style.gap = '10px'; btnRow.style.margin = '10px';

      const uploadBtn=document.createElement('button');
      uploadBtn.className='btn silver block';
      uploadBtn.id='scanUploadBtn';
      uploadBtn.textContent='📸 Foto';
      uploadBtn.onclick=()=>input.click();

      const toggleBtn=document.createElement('button');
      toggleBtn.className='btn silver block';
      toggleBtn.id='scanToggleBtn';
      toggleBtn.textContent='🔄 Girar';
      toggleBtn.onclick=()=>startScanner(onCode, true);

      const stopBtn=document.createElement('button');
      stopBtn.className='btn danger block';
      stopBtn.id='scanStopBtn';
      stopBtn.textContent='❌ Apagar';
      stopBtn.onclick=()=>{
         stopScanner();
         panel.classList.remove('show');
         toast('Cámara apagada');
      };

      btnRow.appendChild(uploadBtn);
      btnRow.appendChild(toggleBtn);
      btnRow.appendChild(stopBtn);
      panel.appendChild(btnRow);

      input.onchange=e=>{ const file=e.target.files?.[0]; e.target.value=''; scanImageFile(file, onCode); };
    }
    status.textContent='Solicitando permiso de cámara...';
    try{
      if(!navigator.mediaDevices?.getUserMedia) throw new Error('camera unavailable');
      try {
        scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:currentFacingMode}}});
      } catch(e) {
        scanStream=await navigator.mediaDevices.getUserMedia({video:true});
      }
      if (generation !== scannerGeneration) {
        scanStream?.getTracks?.().forEach((track) => track.stop());
        scanStream = null;
        return;
      }
      video.srcObject=scanStream; await video.play();
      status.textContent='Apunta al QR o código de barras. También puedes escribir el código.';
      const canvas=document.createElement('canvas');
      const ctx=canvas.getContext('2d', { willReadFrequently:true });

      const detector = await createBarcodeDetector();
      if(detector){
        let detectInFlight = false;
        scanTimer=setInterval(async()=>{
          if(detectInFlight || generation !== scannerGeneration || !video.videoWidth || Date.now()-lastScanAt<1000) return;
          detectInFlight = true;
          try {
            const codes=await detector.detect(video).catch(()=>[]);
            if(codes?.length){
              lastScanAt=Date.now();
              const raw=codes[0].rawValue||'';
              onCode(raw);
            }
          } finally { detectInFlight = false; }
        },420);
      } else {
        const zxingReader = window.ZXingBrowser?.BrowserMultiFormatReader
          ? new window.ZXingBrowser.BrowserMultiFormatReader() : null;
        scanTimer=setInterval(()=>{
          if(!video.videoWidth || Date.now()-lastScanAt<1000) return;
          canvas.width=video.videoWidth; canvas.height=video.videoHeight;
          ctx.drawImage(video,0,0,canvas.width,canvas.height);
          const img=ctx.getImageData(0,0,canvas.width,canvas.height);
          let raw=null;
          if(window.jsQR){
            const qr=window.jsQR(img.data,img.width,img.height);
            raw=qr?.data||null;
          }
          if(!raw) raw=decodeLocalC360QR(img);
          if(!raw && zxingReader) {
            try { raw = zxingReader.decodeFromCanvas(canvas)?.getText?.() || null; } catch {}
          }
          if(raw){
            lastScanAt=Date.now();
            onCode(raw);
          }
        },300);
        status.textContent=zxingReader ? 'Apunta al QR o código de barras.' : 'Este navegador usa lectura QR compatible. Para códigos de barras usa el código manual o un lector físico.';
      }
    }catch(e){
      const messages = {
        NotAllowedError:'Permiso de cámara denegado. Habilítalo en el navegador o usa el código manual.',
        NotFoundError:'No encontramos una cámara disponible. Usa el código manual o un lector físico.',
        NotReadableError:'La cámara está ocupada por otra aplicación. Ciérrala e intenta nuevamente.'
      };
      status.textContent=messages[e?.name] || 'No se pudo activar la cámara. Escribe el código manualmente.';
      toast(status.textContent,'err');
    }
  }

  function scanImageFile(file,onCode){
    if(!file) return;
    const status=$('#cameraStatus');
    const reader=new FileReader();
    reader.onload=()=>{
      const img=new Image();
      img.onload=async()=>{
        try{
          const canvas=document.createElement('canvas'), ctx=canvas.getContext('2d',{willReadFrequently:true});
          canvas.width=img.naturalWidth; canvas.height=img.naturalHeight;
          ctx.drawImage(img,0,0);
          const data=ctx.getImageData(0,0,canvas.width,canvas.height);
          if(window.jsQR){
            const qr=window.jsQR(data.data,data.width,data.height);
            if(qr?.data){ onCode(qr.data); status.textContent='QR leído desde foto.'; return; }
          }
          const localRaw=decodeLocalC360QR(data);
          if(localRaw){ onCode(localRaw); status.textContent='QR leído desde foto.'; return; }
          if(window.ZXingBrowser?.BrowserMultiFormatReader){
            try {
              const reader = new window.ZXingBrowser.BrowserMultiFormatReader();
              const result = reader.decodeFromCanvas(canvas);
              if(result?.getText?.()){ onCode(result.getText()); status.textContent='Código leído desde foto.'; return; }
            } catch {}
          }
          const detector=await createBarcodeDetector();
          if(detector){
            const codes=await detector.detect(img).catch(()=>[]);
            if(codes?.length){ onCode(codes[0].rawValue); status.textContent='QR leído desde foto.'; return; }
          }
          status.textContent='No se pudo leer el QR de la foto. Escribe el código que aparece debajo del QR.';
          toast('No se pudo leer el QR. Escribe el código visible.','err');
        }catch(err){
          status.textContent='Error leyendo la foto. Usa el código manual.';
          toast('Error leyendo la foto','err');
        }
      };
      img.src=reader.result;
    };
    reader.readAsDataURL(file);
	  }
	  function stopScanner(hide=true){ scannerGeneration += 1; if(scanTimer) clearInterval(scanTimer); scanTimer=null; if(scanStream){ scanStream.getTracks().forEach(t=>t.stop()); scanStream=null; } const p=$('#cameraPanel'); if(p&&hide)p.classList.remove('show'); }

	  function cashCloseDisplayMode() {
	    return window.matchMedia?.('(display-mode: standalone)')?.matches === true || navigator.standalone === true ? 'standalone' : 'browser';
	  }
	  function cashCloseSyncState(reason = 'cash_close_diagnostic') {
	    try { return window.click360GetSyncState?.({ cleanup: true, reason }) || {}; } catch { return {}; }
	  }
	  function cashCloseDiagnostic(stage = 'unknown', details = {}) {
	    const access = accessInfo();
	    const syncState = details.syncState || cashCloseSyncState(`cash_close_${stage}`);
	    const business = details.business || currentBusiness();
	    const reportId = details.reportId || details.closeDetails?.id || '';
	    const cashSessionId = details.cashSessionId || details.closeDetails?.cashSessionId || currentOpenCashSession(business?.id)?.id || '';
	    return {
	      appVersion: APP_RELEASE_VERSION,
	      buildSha: APP_BUILD_SHA && APP_BUILD_SHA !== '__CLICK360_BUILD_SHA__' ? APP_BUILD_SHA : '',
	      assetVersion: APP_ASSET_VERSION,
	      stage: String(stage || 'unknown').slice(0, 80),
	      status: String(details.status || 'active').slice(0, 40),
	      reason: String(details.reason || syncState.reason || '').slice(0, 120),
	      errorCode: String(details.errorCode || details.error?.code || details.error?.name || '').slice(0, 80),
	      displayMode: cashCloseDisplayMode(),
	      route: route || 'cash',
	      activeBusinessId: anonFingerprint(business?.id || state.activeBusinessId || ''),
	      cashSessionId: anonFingerprint(cashSessionId),
	      reportId: anonFingerprint(reportId),
	      effectiveAccess: { mode: String(access.mode || '').slice(0, 40), readOnly: access.readOnly === true },
	      canCash: can('cash') === true,
	      ownerWritable: isOwnerUser() === true,
	      writeGate: details.gate ? {
	        allowed: details.gate.allowed !== false,
	        reason: String(details.gate.reason || '').slice(0, 80)
	      } : null,
	      syncState: {
	        status: String(syncState.status || '').slice(0, 40),
	        blocking: syncState.blocking === true,
	        reason: String(syncState.reason || '').slice(0, 80),
	        localHash: String(syncState.localHash || '').slice(0, 24),
	        remoteHash: String(syncState.remoteHash || '').slice(0, 24),
	        lockAgeMs: Number(syncState.lockAgeMs || 0),
	        hasDirtyFields: syncState.hasDirtyFields === true
	      },
	      storageMode: String(storageState.mode || '').slice(0, 40),
	      online: navigator.onLine !== false,
	      userAgent: String(navigator.userAgent || '').slice(0, 500)
	    };
	  }
	  function updateCashCloseDiagnostic(stage, details = {}) {
	    const diagnostic = cashCloseDiagnostic(stage, details);
	    lastCashCloseDiagnostic = Object.freeze(diagnostic);
	    window.click360LastCashCloseDiagnostic = diagnostic;
	    return diagnostic;
	  }
	  window.click360GetCashCloseDiagnostics = () => ({ ...lastCashCloseDiagnostic });
	  function cashCloseDiagnosticRows(diagnostic = lastCashCloseDiagnostic) {
	    const rows = [
	      ['Etapa', diagnostic.stage || 'unknown'],
	      ['Código', diagnostic.errorCode || 'sin_codigo'],
	      ['Acceso', `${diagnostic.effectiveAccess?.mode || 'unknown'} / lectura=${diagnostic.effectiveAccess?.readOnly === true}`],
	      ['Caja', diagnostic.canCash ? 'permitida' : 'sin permiso'],
	      ['Escritura', diagnostic.writeGate ? `${diagnostic.writeGate.allowed ? 'permitida' : 'bloqueada'} / ${diagnostic.writeGate.reason || 'ok'}` : 'sin evaluar'],
	      ['Sync', `${diagnostic.syncState?.status || 'unknown'} / bloquea=${diagnostic.syncState?.blocking === true}`],
	      ['Motivo', diagnostic.reason || diagnostic.syncState?.reason || 'sin_detalle'],
	      ['Hash local', diagnostic.syncState?.localHash || 'n/a'],
	      ['Hash nube', diagnostic.syncState?.remoteHash || 'n/a'],
	      ['Edad lock', `${Math.round(Number(diagnostic.syncState?.lockAgeMs || 0) / 1000)}s`],
	      ['Modo', diagnostic.displayMode || 'browser'],
	      ['Online', diagnostic.online ? 'sí' : 'no']
	    ];
	    return `<dl class="syncDiagnosticList cashCloseDiagnosticList">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`;
	  }
	  function cashCloseAccessStatus(stage = 'validate_access') {
	    const business = currentBusiness();
	    if (!business?.id) return { allowed: false, reason: 'cash_close_no_active_business', business };
	    const access = accessInfo();
	    if (access.readOnly) return { allowed: false, reason: 'read_only', business };
	    const gate = writeGateStatus();
	    if (!gate.allowed) return { allowed: false, reason: gate.reason || 'write_gate_blocked', gate, business };
	    if (!can('cash')) return { allowed: false, reason: 'cash_permission_denied', gate, business };
	    if (!isOwnerUser()) return { allowed: false, reason: WORKER_TENANT_ACCESS_ENABLED ? 'cash_role_denied' : 'worker_module_paused', gate, business };
	    return { allowed: true, reason: 'ok', gate, business };
	  }
	  function recordCashCloseIssue(stage, error, details = {}) {
	    const diagnostic = updateCashCloseDiagnostic(stage, {
	      ...details,
	      error,
	      errorCode: details.errorCode || error?.code || error?.name || 'cash_close_error',
	      status: 'error'
	    });
	    window.CLICK360_RUNTIME_GUARD?.record?.({
	      message: `Cash close failed at ${diagnostic.stage}`,
	      filename: 'app.js',
	      stack: error?.stack || '',
	      cause: diagnostic.errorCode || diagnostic.reason,
	      uiHandled: true
	    });
	    window.click360RecordTelemetry?.('cash_close_failure', {
	      requestId: details.reportId || details.operationId || '',
	      mode: diagnostic.stage,
	      errorCode: diagnostic.errorCode || 'cash_close_error'
	    }).catch?.(() => {});
	    return diagnostic;
	  }
	  function showCashCloseAccessBlocked(status = {}) {
	    const diagnostic = updateCashCloseDiagnostic('cash_close_validate_access', {
	      business: status.business,
	      gate: status.gate,
	      reason: status.reason,
	      errorCode: status.reason || 'cash_close_access_blocked',
	      status: 'blocked'
	    });
	    const message = status.reason === 'worker_module_paused'
	      ? 'El acceso operativo para trabajadores está temporalmente pausado. Ingresa con el dueño del negocio para cerrar caja.'
	      : status.reason === 'read_only'
	        ? 'Tu cuenta está en modo lectura. No se cerró la caja.'
	        : 'Tu cuenta no tiene autorización para cerrar caja en este negocio.';
	    showModal(`<div class="modalHeader"><div><h2>Sin permiso para cerrar caja</h2><p class="fieldHint">${escapeHtml(message)}</p></div><button class="closeBtn" data-close aria-label="Cerrar">×</button></div>
	      <div class="cashCloseIssuePanel">
	        ${cashCloseDiagnosticRows(diagnostic)}
	        <button type="button" class="btn primary block" data-close>Entendido</button>
	      </div>`);
	    toast('No se cerró la caja.', 'err');
	  }
	  function showCashCloseError(stage, diagnostic, retryOptions = {}) {
	    showModal(`<div class="modalHeader"><div><h2>No pudimos cerrar la caja</h2><p class="fieldHint">El cierre no se guardó. Tus datos anteriores siguen intactos.</p></div><button class="closeBtn" data-close aria-label="Cerrar">×</button></div>
	      <div class="cashCloseIssuePanel">
	        ${cashCloseDiagnosticRows(diagnostic)}
	        <div class="cashCloseActions">
	          <button type="button" class="btn primary block" id="retryCashCloseBtn">Reintentar cierre</button>
	          <button type="button" class="btn silver block" id="copyCashCloseDiagnosticBtn">Copiar diagnóstico</button>
	        </div>
	        <button type="button" class="btn block" data-close style="margin-top:10px;">Cancelar</button>
	      </div>`);
	    $('#retryCashCloseBtn')?.addEventListener('click', () => {
	      closeModal(false);
	      openCashCloseDialog(retryOptions);
	    });
	    $('#copyCashCloseDiagnosticBtn')?.addEventListener('click', async () => {
	      await navigator.clipboard?.writeText(JSON.stringify(diagnostic, null, 2)).catch(() => null);
	      toast('Diagnóstico copiado');
	    });
	    toast(`No se cerró la caja. Código: ${stage}`, 'err');
	  }
	  function showCashCloseExportIssue(stage, diagnostic) {
	    showModal(`<div class="modalHeader"><div><h2>Caja cerrada</h2><p class="fieldHint">El cierre quedó guardado, pero la exportación no se pudo completar en este dispositivo.</p></div><button class="closeBtn" data-close aria-label="Cerrar">×</button></div>
	      <div class="cashCloseIssuePanel">
	        ${cashCloseDiagnosticRows(diagnostic)}
	        <button type="button" class="btn primary block" data-close>Entendido</button>
	      </div>`);
	    toast(`Caja cerrada. Exportación pendiente: ${stage}`, 'err');
	  }
	  function cashCloseBasis() {
	    const business = currentBusiness();
	    const businessId = business?.id || '';
	    const date = today();
	    const activeSession = currentOpenCashSession(businessId, date);
	    const allMovements = Array.isArray(state.movements) ? state.movements.filter(m => m.businessId === businessId && m.date === date) : [];
	    const closeMovements = activeSession && allMovements.some((movement) => movement.cashSessionId === activeSession.id)
	      ? allMovements.filter((movement) => movement.cashSessionId === activeSession.id)
	      : allMovements;
	    const apertureMov = closeMovements.slice().reverse().find((movement) => movement.kind === 'apertura');
	    const lastCash = apertureMov ? Number(apertureMov.amount || 0) : Number(business?.lastCashBalance || 0);
	    return { business, businessId, date, activeSession, closeMovements, apertureMov, lastCash };
	  }
	  function buildCashCloseSummary({ basis, cInicial, eFisico, observations, reportId }) {
	    updateCashCloseDiagnostic('cash_close_calculate_totals', { business: basis.business, cashSessionId: basis.activeSession?.id || '', reportId });
	    const income = basis.closeMovements.filter(isCashIncomeMovement).reduce((a, m) => a + Number(m.amount || 0), 0);
	    const out = basis.closeMovements.filter(m => m.kind !== 'ingreso' && m.kind !== 'apertura').reduce((a, m) => a + Number(m.amount || 0), 0);
	    const balanceCalculado = cInicial + income - out;
	    const diferencia = eFisico - balanceCalculado;
	    const allSales = Array.isArray(state.sales) ? state.sales.filter(s => s.businessId === basis.businessId && s.date === basis.date && s.status !== 'cancelled') : [];
	    const sales = basis.activeSession && allSales.some((sale) => sale.cashSessionId === basis.activeSession.id)
	      ? allSales.filter((sale) => sale.cashSessionId === basis.activeSession.id)
	      : allSales;
	    const salesEfectivo = sales.filter(s => s.method === 'Efectivo').reduce((a, s) => a + Number(s.total || 0), 0);
	    const salesTarjeta = sales.filter(s => s.method === 'Tarjeta').reduce((a, s) => a + Number(s.total || 0), 0);
	    const salesTransf = sales.filter(s => s.method === 'Transferencia').reduce((a, s) => a + Number(s.total || 0), 0);
	    const abonosApartado = basis.closeMovements.filter((movement) => movement.status !== 'cancelled'
	      && (movement.paymentMethod === 'Apartado' || movement.paymentType === 'receivable_payment'))
	      .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
	    const totalIva = sales.reduce((a, s) => a + Number(s.iva || 0), 0);
	    let totalItems = 0;
	    sales.forEach(s => saleItems(s).forEach(i => { totalItems += Number(i.qty || 0); }));
	    updateCashCloseDiagnostic('cash_close_build_summary', { business: basis.business, cashSessionId: basis.activeSession?.id || '', reportId });
	    const bizSettings = basis.business?.settings || {};
	    const ruc = bizSettings.ruc ? `<div style="text-align:center; font-size:10px;">RUC/ID: ${escapeHtml(bizSettings.ruc)}</div>` : '';
	    const phone = bizSettings.phone ? `<div style="text-align:center; font-size:10px;">Tel: ${escapeHtml(bizSettings.phone)}</div>` : '';
	    const logoSrc = safeImageSrc(bizSettings.logoUrl);
	    const logoUrl = logoSrc ? `<div style="text-align:center; margin-bottom:6px;"><img src="${escapeHtml(logoSrc)}" style="max-width:80px; max-height:80px; object-fit:contain;"></div>` : '';
	    const html = `
	            <div style="font-family:monospace; color:#000; font-size:12px; margin:0; padding:10px; width:80mm; background:white;">
	            ${logoUrl}
	            <h2 style="font-size:16px; margin:0 0 2px; text-align:center;">${escapeHtml(basis.business?.name || 'Negocio')}</h2>
	            ${ruc}${phone}
	            <div style="text-align:center; margin:10px 0;">CIERRE DE CAJA<br>${nowLabel()}</div>
	            <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Caja Inicial:</span><span>${fmt(cInicial)}</span></div>
	            <div style="border-top:1px dashed #000; margin:8px 0;"></div>
	            <div style="text-align:center;font-weight:bold;margin-bottom:4px">RESUMEN VENTAS</div>
	            <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Productos Vendidos:</span><span>${totalItems}</span></div>
	            <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>IVA Recaudado:</span><span>${fmt(totalIva)}</span></div>
	            <div style="border-top:1px dashed #000; margin:8px 0;"></div>
	            <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Efectivo:</span><span>${fmt(salesEfectivo)}</span></div>
	            <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Tarjeta:</span><span>${fmt(salesTarjeta)}</span></div>
	            <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Transferencia:</span><span>${fmt(salesTransf)}</span></div>
	            <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Abonos Apartado:</span><span>${fmt(abonosApartado)}</span></div>
	            <div style="border-top:1px dashed #000; margin:8px 0;"></div>
	            <div style="text-align:center;font-weight:bold;margin-bottom:4px">MOVIMIENTOS DE CAJA</div>
	            <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Ingresos en efectivo:</span><span>+${fmt(income)}</span></div>
	            <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Total Salidas:</span><span>-${fmt(out)}</span></div>
	            <div style="border-top:1px dashed #000; margin:8px 0;"></div>
	            <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:14px;"><b>Balance Teórico:</b><b>${fmt(balanceCalculado)}</b></div>
	            <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Efectivo Declarado:</span><span>${fmt(eFisico)}</span></div>
	            <div style="border-top:1px dashed #000; margin:8px 0;"></div>
	            <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:13px;"><b>Diferencia:</b><b>${fmt(diferencia)}</b></div>
	            <div style="margin-top:10px;">Obs: ${escapeHtml(observations)}</div>
	            <div style="margin-top:10px; text-align:center;">Generado por: ${escapeHtml(authUser().name || 'Usuario')}</div>
	            </div>`;
	    return { income, out, balanceCalculado, diferencia, sales, salesEfectivo, salesTarjeta, salesTransf, abonosApartado, totalIva, totalItems, html };
	  }
	  function showCashCloseSummary(closeDetails, committed = {}) {
	    updateCashCloseDiagnostic('cash_close_export_ready', { closeDetails, reportId: closeDetails.id });
	    showModal(`<div class="modalHeader"><h2>Resumen de Cierre</h2><button class="closeBtn" data-close>×</button></div>
	      <div class="cashClosePreview">
	        <div id="pdfContentPreview" class="cashClosePreviewInner">
	          ${closeDetails.html}
	        </div>
	      </div>
	      <div class="cashCloseActions">
	          <button class="btn silver block" id="printCierreBtn">Imprimir</button>
	          <button class="btn silver block" id="downloadPdfCierreBtn">Guardar PDF</button>
	          <button class="btn primary block" id="downloadImgCierreBtn">Descargar Imagen (PNG)</button>
	      </div>
	      <p class="fieldHint">El cierre ya quedó guardado. Si una exportación falla, puedes volver a abrir este resumen desde el historial.</p>
	    `);
	    const runExport = async (stage, job) => {
	      updateCashCloseDiagnostic(stage, { closeDetails, reportId: closeDetails.id });
	      try {
	        await Promise.resolve(job());
	      } catch (error) {
	        const diagnostic = recordCashCloseIssue(stage, error, { closeDetails, reportId: closeDetails.id, errorCode: 'cash_close_export_failed' });
	        showCashCloseExportIssue(stage, diagnostic);
	      }
	    };
	    $('#printCierreBtn')?.addEventListener('click', () => runExport('cash_close_export_print', () => handoffPrint({ html: closeDetails.html, media: 'a4', filename: `Cierre_Caja_${closeDetails.date}.pdf` }, 'system')));
	    $('#downloadPdfCierreBtn')?.addEventListener('click', () => runExport('cash_close_export_pdf', () => handoffPrint({ html: closeDetails.html, media: 'a4', filename: `Cierre_Caja_${closeDetails.date}.pdf` }, 'pdf')));
	    $('#downloadImgCierreBtn')?.addEventListener('click', () => runExport('cash_close_export_png', () => downloadHtmlAsPng(closeDetails.html, `Cierre_Caja_${closeDetails.date}.png`)));
	    toast(committed.pending ? 'Cierre guardado; sincronización pendiente.' : 'Cierre del día generado');
	  }
	  function openCashCloseDialog(options = {}) {
	    const accessStatus = cashCloseAccessStatus('cash_close_open_modal');
	    if (!accessStatus.allowed) return showCashCloseAccessBlocked(accessStatus);
	    const basis = cashCloseBasis();
	    if (!basis.businessId) return toast('No se encontró el negocio activo.', 'err');
	    if (isBusinessDateClosed(basis.date, basis.businessId)) return toast('La caja de hoy ya está cerrada.', 'ok');
	    updateCashCloseDiagnostic('cash_close_open_modal', { business: basis.business, cashSessionId: basis.activeSession?.id || '' });
	    showModal(`<div class="modalHeader"><h2>Cerrar día</h2><button class="closeBtn" data-close>×</button></div>
	      <form id="closeDayForm" class="formGrid">
	        <div class="field full"><label>Caja Inicial (Auto-cuadre)</label><input id="cajaInicial" value="${escapeHtml(options.cajaInicial ?? basis.lastCash)}" inputmode="decimal"></div>
	        <div class="field full"><label>Efectivo Físico (Contado)</label><input id="efectivoFisico" value="${escapeHtml(options.efectivoFisico ?? 0)}" inputmode="decimal"></div>
	        <div class="field full"><label>Observaciones</label><input id="cierreObs" value="${escapeHtml(options.observations || '')}"></div>
	        <button class="btn silver" type="button" data-close>Cancelar</button>
	        <button class="btn primary block" type="submit" id="closeDaySubmitBtn">Generar Cierre</button>
	      </form>`);
	    const cInicialInput = $('#cajaInicial'), eFisicoInput = $('#efectivoFisico');
	    if (cInicialInput) cInicialInput.oninput = () => { cInicialInput.value = cInicialInput.value.replace(/[^0-9.,]/g, ''); };
	    if (eFisicoInput) eFisicoInput.oninput = () => { eFisicoInput.value = eFisicoInput.value.replace(/[^0-9.,]/g, ''); };
	    $('#closeDayForm').onsubmit = submitCashClose;
	  }
	  async function submitCashClose(e) {
	    e.preventDefault();
	    const retryOptions = {
	      cajaInicial: $('#cajaInicial')?.value || '',
	      efectivoFisico: $('#efectivoFisico')?.value || '',
	      observations: $('#cierreObs')?.value || ''
	    };
	    let stage = 'cash_close_validate_access';
	    let previousState = null;
	    let inFlightKey = '';
	    let commitStarted = false;
	    let reportId = '';
	    const submitButton = $('#closeDaySubmitBtn');
	    try {
	      submitButton?.setAttribute('disabled', 'disabled');
	      const accessStatus = cashCloseAccessStatus(stage);
	      updateCashCloseDiagnostic(stage, { business: accessStatus.business, gate: accessStatus.gate, reason: accessStatus.reason });
	      if (!accessStatus.allowed) {
	        showCashCloseAccessBlocked(accessStatus);
	        return;
	      }
	      stage = 'cash_close_load_session';
	      const basis = cashCloseBasis();
	      if (!basis.businessId) {
	        const error = new Error('No active business for cash close.');
	        error.code = 'cash_close_no_active_business';
	        throw error;
	      }
	      if (isBusinessDateClosed(basis.date, basis.businessId)) {
	        toast('La caja de hoy ya está cerrada.', 'ok');
	        closeModal();
	        renderApp('cash');
	        return;
	      }
	      const sessionKey = basis.activeSession?.id || `legacy:${basis.businessId}:${basis.date}`;
	      inFlightKey = `${basis.businessId}:${basis.date}:${sessionKey}`;
	      if (cashCloseInFlight.has(inFlightKey)) {
	        toast('Ya estamos cerrando esta caja. Espera la confirmación.', 'ok');
	        return;
	      }
	      cashCloseInFlight.add(inFlightKey);
	      updateCashCloseDiagnostic(stage, { business: basis.business, cashSessionId: basis.activeSession?.id || '' });
	      const cInicial = parseMoney($('#cajaInicial')?.value);
	      const eFisico = parseMoney($('#efectivoFisico')?.value);
	      const observations = ($('#cierreObs')?.value || '').trim();
	      if (!Number.isFinite(cInicial) || !Number.isFinite(eFisico)) {
	        const error = new Error('Invalid cash close amounts.');
	        error.code = 'cash_close_invalid_amounts';
	        throw error;
	      }
	      reportId = uid('rep');
	      const summary = buildCashCloseSummary({ basis, cInicial, eFisico, observations, reportId });
	      stage = 'cash_close_persist_summary';
	      previousState = cloneState(state);
	      state.dailyReports ||= [];
	      state.cashSessions ||= [];
	      const existingClosedReport = state.dailyReports.find((report) =>
	        report.businessId === basis.businessId && report.date === basis.date && report.status === 'closed'
	        && (basis.activeSession?.id ? report.cashSessionId === basis.activeSession.id : true));
	      if (existingClosedReport) {
	        toast('La caja ya estaba cerrada. Puedes ver el cierre en el historial.', 'ok');
	        closeModal();
	        renderApp('cash');
	        return;
	      }
	      const closeDetails = {
	        id: reportId,
	        operationId: reportId,
	        businessId: basis.businessId,
	        date: basis.date,
	        cashSessionId: basis.activeSession?.id || '',
	        openedBy: basis.activeSession?.openedBy || basis.apertureMov?.createdBy || '',
	        openedAt: basis.activeSession?.openedAt || '',
	        closedBy: authUser().name,
	        closedByUid: window.click360User?.uid || '',
	        closedAt: new Date().toISOString(),
	        openingAmount: cInicial,
	        productQuantity: summary.totalItems,
	        buyers: [...new Set(summary.sales.map((sale) => sale.customer).filter(Boolean))],
	        saleIds: summary.sales.map((sale) => sale.id),
	        paymentTotals: { cash: summary.salesEfectivo, card: summary.salesTarjeta, transfer: summary.salesTransf, layawayPayments: summary.abonosApartado },
	        taxTotal: summary.totalIva,
	        income: summary.income,
	        expenses: summary.out,
	        expectedCash: summary.balanceCalculado,
	        countedCash: eFisico,
	        difference: summary.diferencia,
	        observations,
	        closeCash: eFisico,
	        status: 'closed',
	        html: summary.html
	      };
	      state.dailyReports.push(closeDetails);
	      if (basis.activeSession) Object.assign(basis.activeSession, { status: 'closed', closedBy: authUser().name, closedByUid: window.click360User?.uid || '', closedAt: closeDetails.closedAt, countedCash: eFisico, expectedCash: summary.balanceCalculado, difference: summary.diferencia, reportId, observations });
	      addAudit('cash_closed', { reportId, expectedCash: summary.balanceCalculado, countedCash: eFisico, difference: summary.diferencia, cashSessionId: basis.activeSession?.id || '' });
	      const business = state.businesses.find((item) => item.id === basis.businessId);
	      if (business) business.lastCashBalance = eFisico;
	      updateCashCloseDiagnostic(stage, { business: basis.business, closeDetails, reportId });
	      stage = 'cash_close_verify_closed';
	      commitStarted = true;
	      const committed = await commitCriticalMutation(previousState, 'cash_closed', (next) => {
	        const reportClosed = (next.dailyReports || []).some((report) => report.id === reportId && report.businessId === basis.businessId && report.status === 'closed');
	        const sessionClosed = !basis.activeSession || (next.cashSessions || []).some((session) => session.id === basis.activeSession.id && session.businessId === basis.businessId && session.status === 'closed' && session.reportId === reportId);
	        return reportClosed && sessionClosed;
	      });
	      if (!committed.ok) {
	        const error = new Error(writeBlockMessage(window.click360LastWriteBlock || { reason: committed.reason || 'cash_close_commit_not_confirmed' }));
	        error.code = committed.reason || 'cash_close_commit_not_confirmed';
	        throw error;
	      }
	      updateCashCloseDiagnostic('cash_close_verify_closed', { business: basis.business, closeDetails, reportId, status: committed.pending ? 'pending' : 'closed' });
	      window.click360RecordTelemetry?.('cash_close', { requestId: reportId, mode: summary.diferencia === 0 ? 'balanced' : 'difference' }).catch?.(() => {});
	      closeModal(false);
	      renderApp('cash');
	      try {
	        showCashCloseSummary(closeDetails, committed);
	      } catch (error) {
	        const diagnostic = recordCashCloseIssue('cash_close_export_ready', error, { closeDetails, reportId, errorCode: 'cash_close_summary_modal_failed' });
	        showCashCloseExportIssue('cash_close_export_ready', diagnostic);
	      }
	    } catch (error) {
	      if (previousState && !commitStarted) {
	        state = normalizeState(cloneState(previousState));
	        lastAutoSaveHash = JSON.stringify(state);
	      }
	      const diagnostic = recordCashCloseIssue(stage, error, { reportId, errorCode: error?.code || error?.name || 'cash_close_failed' });
	      showCashCloseError(stage, diagnostic, retryOptions);
	    } finally {
	      if (inFlightKey) cashCloseInFlight.delete(inFlightKey);
	      submitButton?.removeAttribute('disabled');
	    }
	  }

		  function bindCash(){
	    $('#calculatorCashBtn')?.addEventListener('click', () => openCalculator({ preferredTarget: isDayStarted() ? '' : 'apertureAmountInput' }));
    const btnReopenCash = $('#reopenCashBtn');
	    if (btnReopenCash) {
	      btnReopenCash.onclick = async () => {
	        if (!isOwnerUser()) return toast('Solo el dueño puede reabrir una caja cerrada.', 'err');
	        if (!confirm('¿Deseas reabrir la caja de hoy?\nEl cierre anterior NO se borrará; quedará guardado como historial y se registrará la reapertura.')) return;
	        const reason = prompt('Escribe el motivo de reapertura de caja:');
	        if (!reason || reason.trim().length < 4) return toast('Motivo requerido para reabrir caja', 'err');
	        const bid = currentBusiness()?.id;
	        if (bid) {
	          const previousState = cloneState(state);
	          const operationId = uid('cashreopen');
	          const closedReports = (state.dailyReports || []).filter(r => r.businessId === bid && r.date === today() && r.status !== 'reopened');
	          closedReports.forEach(r => {
	            r.status = 'reopened';
	            r.reopenedAt = new Date().toISOString();
	            r.reopenedBy = authUser().name;
	            r.reopenReason = reason.trim();
	          });
	          state.movements.push({
	            id: uid('mov'),
	            operationId,
	            businessId: bid,
	            date: today(),
	            when: nowLabel(),
	            kind: 'apertura',
	            amount: currentBusiness().lastCashBalance || 0,
	            note: `Reapertura de caja: ${reason.trim()}`,
	            createdBy: authUser().name,
	            reopened: true,
	            cashSessionId: operationId,
	            createdAtMs: Date.now()
	          });
	          state.cashSessions ||= [];
	          state.cashSessions.push({
	            id: operationId, operationId, businessId: bid, registerName: 'Caja principal', date: today(), status: 'open',
	            openedByUid: window.click360User?.uid || '', openedBy: authUser().name, openedByRole: authUser().role || 'owner',
	            openedAt: new Date().toISOString(), openingAmount: currentBusiness().lastCashBalance || 0,
	            reopened: true, reopenReason: reason.trim(), notes: ''
	          });
	          addAudit('cash_reopened', { businessId: bid, date: today(), reason: reason.trim(), reports: closedReports.map(r => r.id) });
	          const committed = await commitCriticalMutation(previousState, 'cash_reopened', (next) =>
	            next.movements.some((movement) => movement.operationId === operationId && movement.businessId === bid));
	          renderApp('cash');
	          if (committed.ok) toast(committed.pending ? 'Reapertura guardada; sincronización pendiente.' : 'Caja reabierta con auditoría');
	        }
	      };
	    }

    if (!isDayStarted()) {
       const startBtn = $('#startDayBtnCash');
       const inputEl = $('#apertureAmountInput');
       if (inputEl) {
         inputEl.oninput = () => { inputEl.value = inputEl.value.replace(/[^0-9.,]/g, ''); };
       }
       if (startBtn) {
          startBtn.onclick = async () => {
             const amt = parseMoney(inputEl.value);
             if (!Number.isFinite(amt) || amt < 0) return toast('Monto de apertura inválido', 'err');
	             const previousState = cloneState(state);
	             const cashSessionId = uid('cash');
	             const operationId = uid('cashopen');
             state.movements.push({
               id: uid('mov'),
	               operationId,
	               cashSessionId,
	               createdAtMs: Date.now(),
               businessId: currentBusiness().id,
               date: today(),
               when: nowLabel(),
               kind: 'apertura',
               amount: amt,
               note: 'Apertura de caja diaria',
               createdBy: authUser().name
             });
             state.cashSessions ||= [];
             state.cashSessions.push({
	               id: cashSessionId,
	               operationId,
               businessId: currentBusiness().id,
               registerName: 'Caja principal',
               date: today(),
               status: 'open',
               openedByUid: window.click360User?.uid || '',
               openedBy: authUser().name,
               openedByRole: authUser().role || 'owner',
               deviceId: window.click360DebugSyncIdentity?.().deviceId || '',
               openedAt: new Date().toISOString(),
               openingAmount: amt,
               notes: ''
	             });
	             addAudit('cash_opened', { amount: amt, businessId: currentBusiness().id });
	             const businessId = currentBusiness().id;
	             const committed = await commitCriticalMutation(previousState, 'cash_opened', (next) =>
	               next.cashSessions.some((session) => session.id === cashSessionId && session.businessId === businessId));
	             if (!committed.ok) { renderApp('cash'); return; }
	             window.click360RecordTelemetry?.('cash_open', { mode: authUser().role || 'owner' }).catch?.(() => {});
	             renderApp('cash');
	             toast(committed.pending ? 'Apertura guardada; sincronización pendiente.' : 'Jornada iniciada exitosamente');
          };
       }
       return;
    }

    const btnNewMove = $('#newMove');
    if (btnNewMove) {
      btnNewMove.onclick=()=>{
	        showModal(`<div class="modalHeader"><h2>Nuevo movimiento</h2><button class="closeBtn" data-close>×</button></div><form id="moveForm"><div class="field"><label>Tipo</label><select id="mKind"><option value="egreso">Gasto</option><option value="compra">Compra</option><option value="retiro">Retiro</option><option value="ingreso">Ingreso</option></select></div><div class="field"><label>Monto</label><div class="inputWithAction"><input id="mAmount" inputmode="decimal" value="0"><button type="button" class="iconBtn" id="calculatorMoveBtn" title="Calcular monto" aria-label="Calcular monto">${icon('calculator')}</button></div></div><div class="field"><label>Nota</label><input id="mNote" required></div><button type="submit" class="btn primary block">Guardar</button></form>`);
	        $('#calculatorMoveBtn').onclick = () => openCalculator({ preferredTarget: 'mAmount' });

        const mAmountInput = $('#mAmount');
        if (mAmountInput) {
          mAmountInput.oninput = () => { mAmountInput.value = mAmountInput.value.replace(/[^0-9.,]/g, ''); };
        }

        $('#moveForm').onsubmit = async (e) => {
          e.preventDefault();
          const k=$('#mKind').value, a=parseMoney($('#mAmount').value), n=$('#mNote').value.trim();
          if(!Number.isFinite(a)||a<=0) return toast('Monto inválido','err');
	          const previousState = cloneState(state);
	          const movementId = uid('mov');
	          const businessId = currentBusiness().id;
	          state.movements.push({id:movementId,operationId:movementId,businessId,date:today(),when:nowLabel(),kind:k,amount:a,note:n,paymentMethod:k==='ingreso'?'Efectivo':null,cashSessionId:currentOpenCashSession(businessId)?.id||'',createdAtMs:Date.now(),createdBy:authUser().name});
          addAudit('cash_movement_created', { kind:k, amount:a, note:n });
	          const committed = await commitCriticalMutation(previousState, 'cash_movement_created', (next) =>
	            next.movements.some((movement) => movement.id === movementId && movement.businessId === businessId));
	          if (!committed.ok) { closeModal(); renderApp('cash'); return; }
	          closeModal(); renderApp('cash'); toast(committed.pending ? 'Movimiento guardado; sincronización pendiente.' : 'Movimiento guardado');
        };
      };
    }

	    const btnCloseDay = $('#closeDayBtn');
	    if (btnCloseDay) {
	      btnCloseDay.onclick=()=>openCashCloseDialog();
	    }
	  }
		  function bindPrinting() {
		    const provider = $('#printingProvider');
		    const media = $('#printingMedia');
		    const copies = $('#printingCopies');
		    const feedback = $('#printerFeedback');
		    const selected = () => provider?.value || 'system';
		    const setFeedback = (message, error = false) => {
		      if (!feedback) return;
		      feedback.textContent = message;
		      feedback.style.color = error ? 'var(--red)' : 'var(--gold2)';
		    };
		    const persist = () => savePrintingPreferences({ provider: selected(), media: media?.value || 'receipt-80', copies: Math.max(1, Math.min(20, Number(copies?.value || 1))) });
		    provider?.addEventListener('change', persist);
		    media?.addEventListener('change', persist);
		    copies?.addEventListener('change', persist);
		    $('#printerConnect')?.addEventListener('click', async () => {
		      persist();
		      try {
		        await window.CLICK360_PRINTING?.discover(selected());
		        const status = await window.CLICK360_PRINTING?.connect(selected());
		        setFeedback(`${status?.name || 'Salida'}: ${printerStateLabel(status)}.`);
		      } catch (error) { setFeedback(error.message || 'Esta salida todavía no está disponible.', true); }
		    });
		    $('#printerDisconnect')?.addEventListener('click', async () => {
		      try {
		        const status = await window.CLICK360_PRINTING?.disconnect(selected());
		        setFeedback(`${status?.name || 'Salida'}: ${printerStateLabel(status)}.`);
		      } catch (error) { setFeedback(error.message || 'No se pudo desconectar.', true); }
		    });
		    $('#printerForget')?.addEventListener('click', async () => {
		      try {
		        const status = await window.CLICK360_PRINTING?.forgetDevice(selected());
		        setFeedback(`${status?.name || 'Salida'}: autorización eliminada.`);
		      } catch (error) { setFeedback(error.message || 'No se pudo olvidar el dispositivo.', true); }
		    });
		    $('#printerTest')?.addEventListener('click', async () => {
		      persist();
		      try {
		        await window.CLICK360_PRINTING?.testPrint(selected());
		        setFeedback(selected() === 'pdf' ? 'PDF de prueba generado.' : 'Prueba enviada al diálogo del sistema.');
		      } catch (error) { setFeedback(error.message || 'No se pudo imprimir la prueba.', true); }
		    });
		    $('#printingLabelAction')?.addEventListener('click', () => {
		      const product = productsForBiz()[0];
		      if (product) openLabelModal(product);
		    });
		    $('#printingReceiptAction')?.addEventListener('click', () => {
		      const sale = salesForBiz().filter((item) => item.status !== 'cancelled').slice(-1)[0];
		      if (sale) window.showSaleCompleteModal(actionId(sale.id));
		    });
			    $('#printingReportAction')?.addEventListener('click', () => renderApp('reports'));
			    $('#openReceiptDesignerBtn')?.addEventListener('click', openReceiptTemplateDesigner);
			  }

		  function bindMore(){
	     $$('[data-more]').forEach(b=>b.onclick=()=>renderApp(b.dataset.more));
	     $('#calculatorMoreBtn')?.addEventListener('click', () => openCalculator());
	     $('#logoutMore')?.addEventListener('click',()=>window.click360AppLogout());
	     $('#installAppBtn')?.addEventListener('click', async () => {
	       const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
	       const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
	       if (isStandalone) return toast('CLICK 360 ya está instalado como app.');
	       if (deferredInstallPrompt) {
	         deferredInstallPrompt.prompt();
	         await deferredInstallPrompt.userChoice.catch(()=>null);
	         deferredInstallPrompt = null;
	         return toast('Instalación iniciada');
	       }
	       if (isIOS) {
	         showModal(`<div class="modalHeader"><h2>Instalar en iPhone</h2><button class="closeBtn" data-close>×</button></div>
	           <div style="line-height:1.55;color:var(--muted);font-size:14px;">
	             <p>Abre CLICK 360 en Safari, toca el botón de compartir y elige <b>Agregar a pantalla de inicio</b>.</p>
	             <p>Después podrás abrirlo como app y seguir trabajando con los datos guardados en este dispositivo.</p>
	           </div>
	           <button class="btn primary block" data-close>Entendido</button>`);
	         return;
	       }
	       showModal(`<div class="modalHeader"><h2>Instalar CLICK 360</h2><button class="closeBtn" data-close>×</button></div>
	         <p style="line-height:1.55;color:var(--muted);font-size:14px;">Si el navegador no muestra el instalador automático, abre el menú y elige <b>Instalar app</b> o <b>Agregar a pantalla principal</b>.</p>
	         <button class="btn primary block" data-close>Entendido</button>`);
	     });

	     $('#helpBtn')?.addEventListener('click', () => {
       showModal(`<div class="modalHeader"><h2>\u00bfC\u00f3mo funciona CLICK 360?</h2><button class="closeBtn" data-close>\u00d7</button></div>
         <div style="max-height:60vh;overflow-y:auto;padding:4px;">
           <div style="margin-bottom:16px;">
             <h3 style="color:var(--gold);margin-bottom:8px;">\uD83C\uDFE0 Inicio</h3>
             <p>Ve un resumen de tus ventas, caja, inventario y stock bajo del d\u00eda.</p>
           </div>
           <div style="margin-bottom:16px;">
             <h3 style="color:var(--gold);margin-bottom:8px;">\uD83D\uDCE6 Inventario</h3>
             <p>Registra productos con nombre, c\u00f3digo, precio, stock e imagen. Genera etiquetas QR personalizables para imprimir. Busca por nombre o escanea c\u00e1digos QR con la c\u00e1mara.</p>
           </div>
           <div style="margin-bottom:16px;">
             <h3 style="color:var(--gold);margin-bottom:8px;">\uD83D\uDED2 Vender</h3>
             <p>Escanea QR o busca productos para vender. Selecciona m\u00e9todo de pago (efectivo, tarjeta, transferencia, apartado). Genera comprobantes de venta imprimibles en formato t\u00e9rmico 80mm.</p>
           </div>
           <div style="margin-bottom:16px;">
             <h3 style="color:var(--gold);margin-bottom:8px;">\uD83D\uDCB0 Caja Diaria</h3>
             <p>Inicia el d\u00eda con un monto de apertura. Registra ingresos, egresos, gastos y compras. Al final del d\u00eda, cierra caja con un reporte completo.</p>
           </div>
           <div style="margin-bottom:16px;">
             <h3 style="color:var(--gold);margin-bottom:8px;">\uD83D\uDCCA Reportes</h3>
             <p>Ve el historial de ventas por d\u00eda con detalles de cada transacci\u00f3n. Identifica productos m\u00e1s vendidos y ventas anuladas.</p>
           </div>
           <div style="margin-bottom:16px;">
             <h3 style="color:var(--gold);margin-bottom:8px;">☁️ Nube y Respaldo</h3>
             <p>Descarga reportes contables en CSV con filtro por fecha. Envía reportes a tu contadora por WhatsApp. Guarda y restaura respaldos manuales.</p>
           </div>
           <div style="margin-bottom:16px;">
             <h3 style="color:var(--gold);margin-bottom:8px;">\uD83D\uDC65 Trabajadores</h3>
	             <p>Revisa y revoca invitaciones existentes. Los accesos nuevos se habilitarán cuando cada módulo tenga permisos independientes.</p>
           </div>
           <div style="margin-bottom:16px;">
             <h3 style="color:var(--gold);margin-bottom:8px;">⚙️ Ajustes</h3>
             <p>Configura nombre, RUC, teléfono, dirección, logo e IVA de tu negocio. Estos datos se reflejan en los comprobantes de venta y cierre de caja.</p>
           </div>
           <div style="background:rgba(244,196,49,0.08);padding:12px;border-radius:12px;border:1px solid rgba(244,196,49,0.2);">
             <p style="margin:0;font-size:13px;"><b style="color:var(--gold);">🔒 Seguridad:</b> Los datos se protegen en la nube.</p>
           </div>
         </div>`);
     });

     // Check for pending workers in background to toggle badge
     if (window.click360User && window.click360User.role === 'owner') {
        const workers = state.settings?.workers || [];
        const pendingCount = 0; // Simplified for this iteration
        const badge = $('#pendingWorkersBadge');
        if (badge) {
            badge.style.display = 'none';
        }
     }
  }

  async function bindWorkers() {
    const list = $('#workersList');
    if (!window.click360User || window.click360User.role !== 'owner') {
      list.innerHTML = '<p class="empty">Solo el dueño puede administrar trabajadores.</p>';
      const form = $('#addWorkerForm');
      if (form) form.style.display = 'none';
      return;
    }

    let displayedWorkers = [];
    const loadWorkers = async () => {
      let workers = (state.settings?.workers || []).map(worker => ({ ...worker }));
      try {
        if (typeof window.click360ListWorkers === 'function') workers = await window.click360ListWorkers();
      } catch (error) { console.warn('No se pudo actualizar el directorio de trabajadores:', error.message); }
      displayedWorkers = workers;
      if (workers.length === 0) {
        list.innerHTML = '<p class="empty">No hay trabajadores registrados.</p>';
        return;
      }

      list.innerHTML = workers.map(w => {
        const active = ['active', 'accepted'].includes(w.status) && w.status !== 'revoked';
        const statusLabel = active ? 'Activo' : w.status === 'pending' ? 'Invitacion pendiente' : w.status === 'revoked' ? 'Revocado' : 'Bloqueado';
        const avatarHtml = `<div style="width:32px; height:32px; border-radius:50%; background:#222; border:1px solid #444; display:flex; justify-content:center; align-items:center; font-weight:bold; color:var(--gold); font-size:12px;">${escapeHtml(String(w.name || 'W').charAt(0).toUpperCase())}</div>`;
        return `
          <div class="movement" style="align-items:center; gap:10px; padding:12px 0; border-bottom:1px solid var(--line);">
             ${avatarHtml}
             <div style="flex:1;">
               <b>${escapeHtml(w.name)}</b>
               <span class="badge ${active ? 'green' : 'danger'}" style="margin-left:6px;font-size:10px;padding:2px 6px;">${escapeHtml(statusLabel)}</span>
               <br><small style="color:#aaa;">${escapeHtml(w.email)} · ${escapeHtml(w.role || 'worker')}</small>
             </div>
             <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                <button class="btn silver" style="padding:4px 8px;font-size:12px;min-height:32px;" data-worker-details="${actionId(w.inviteHash || '')}">Permisos</button>
                ${w.status === 'pending' ? `<button class="btn silver" style="padding:4px 8px;font-size:12px;min-height:32px;" data-worker-link="${actionId(w.inviteHash || '')}">Enlace</button>` : ''}
                ${w.status !== 'revoked' ? `<button class="btn danger" style="padding:4px 8px;font-size:12px;min-height:32px;" data-del-worker="${escapeHtml(w.email)}">Revocar</button>` : ''}
             </div>
          </div>
        `;
      }).join('');

      $$('[data-worker-link]').forEach((button) => {
        button.onclick = async () => {
          try {
            const link = await window.click360GetInviteLink(decodeActionId(button.dataset.workerLink));
            $('#inviteLinkBox').style.display = 'block';
            $('#inviteLinkVal').value = link;
            await navigator.clipboard?.writeText(link).catch(() => {});
            toast('Enlace recuperado y listo para compartir');
          } catch (error) { toast(error.message, 'err'); }
        };
      });

      $$('[data-worker-details]').forEach((button) => {
        button.onclick = () => {
          const hash = decodeActionId(button.dataset.workerDetails);
          const worker = displayedWorkers.find((item) => item.inviteHash === hash);
          if (!worker) return toast('No se encontro la ficha del trabajador.', 'err');
          const modules = [['inventory','Inventario'],['sales','Ventas'],['cash','Caja'],['customers','Clientes'],['reports','Reportes'],['reminders','Recordatorios'],['settings','Ajustes'],['suppliers','Proveedores'],['workers','Trabajadores']];
          const actions = ['view','create','edit','delete','approve','export','manage'];
	          const workerStatus = worker.status === 'pending' ? 'Pendiente' : worker.status === 'active' ? 'Activo' : worker.status === 'revoked' ? 'Revocado' : 'Bloqueado';
	          const actionLabels = { view: 'Ver', create: 'Crear', edit: 'Editar', delete: 'Eliminar', approve: 'Aprobar', export: 'Exportar', manage: 'Administrar' };
	          showModal(`<div class="modalHeader"><h2>${escapeHtml(worker.name || worker.email)}</h2><button class="closeBtn" data-close>×</button></div><div class="workerMeta"><p>${escapeHtml(worker.email || '')}</p><p>Estado: <b>${escapeHtml(workerStatus)}</b></p><p>Aceptación: ${escapeHtml(worker.acceptedAt?.toDate?.().toLocaleString?.('es-EC') || (worker.acceptedAt ? String(worker.acceptedAt) : 'Pendiente'))}</p><p>Último acceso: ${escapeHtml(worker.lastAccessAt?.toDate?.().toLocaleString?.('es-EC') || 'Sin registro')}</p></div><div class="field"><label for="workerEditRole">Rol</label><select id="workerEditRole"><option value="worker" ${worker.role === 'worker' ? 'selected' : ''}>Operador</option><option value="cashier" ${worker.role === 'cashier' ? 'selected' : ''}>Caja y ventas</option><option value="inventory" ${worker.role === 'inventory' ? 'selected' : ''}>Inventario</option></select></div><div class="permissionMatrix">${modules.map(([module, label]) => `<fieldset><legend>${label}</legend>${actions.map((action) => `<label><input type="checkbox" data-permission-module="${module}" data-permission-action="${action}" ${worker.permissions?.[module]?.[action] === true ? 'checked' : ''}><span>${escapeHtml(actionLabels[action] || action)}</span></label>`).join('')}</fieldset>`).join('')}</div><button type="button" class="btn primary block" id="saveWorkerPermissions">Guardar permisos</button>`);
          $('#saveWorkerPermissions').onclick = async () => {
            const permissions = {};
            $$('[data-permission-module]').forEach((input) => {
              permissions[input.dataset.permissionModule] ||= {};
              permissions[input.dataset.permissionModule][input.dataset.permissionAction] = input.checked;
            });
            try {
              await window.click360UpdateWorkerPermissions(worker.uid || '', worker.inviteHash, $('#workerEditRole').value, permissions);
              addAudit('worker_permissions_updated', { workerUid: worker.uid || '', inviteHash: worker.inviteHash, role: $('#workerEditRole').value });
              closeModal();
              await loadWorkers();
              toast('Permisos actualizados');
            } catch (error) { toast(error.message, 'err'); }
          };
        };
      });

      // Bind delete handlers
      $$('[data-del-worker]').forEach(btn => {
        btn.onclick = async () => {
          const email = btn.dataset.delWorker.toLowerCase();
          if (!confirm(`¿Estás seguro de eliminar el acceso para ${email}?`)) return;

          btn.textContent = '...';
          btn.disabled = true;

          // Find UID if worker has logged in
          const match = displayedWorkers.find(w => String(w.email || '').toLowerCase() === email);
          try {
            if (!window.click360RevokeWorker) throw new Error('La revocación en nube no está disponible.');
	          await window.click360RevokeWorker(email, match?.uid || '', match?.inviteHash || '');
            addAudit('worker_revoked', { email, uid: match?.uid || '' });
            state.settings.workers = (state.settings.workers || []).filter(w => String(w.email || '').toLowerCase() !== email);
            if(!save()) {
              toast('El acceso fue revocado en nube, pero no se pudo actualizar la lista local.', 'err');
              await loadWorkers();
              return;
            }
            toast('Acceso removido');
            await loadWorkers();
          } catch (error) {
            console.warn('No se pudo revocar trabajador:', error.message);
            btn.textContent = 'Eliminar';
            btn.disabled = false;
            toast('No se pudo revocar el acceso. No se alteró la lista local.', 'err');
          }
        };
      });
    };

    await loadWorkers();
	    if (!WORKER_TENANT_ACCESS_ENABLED) return;

    $('#addWorkerForm').onsubmit = async (e) => {
      e.preventDefault();
      const name = $('#workerName').value.trim();
      const email = $('#workerEmail').value.trim().toLowerCase();
      const role = $('#workerRole').value;

      const workers = displayedWorkers;
      const activeCount = workers.filter(worker => worker.status !== 'revoked' && worker.status !== 'blocked').length;
      const workerLimit = Number(window.click360User?.workerLimit || 2);
      if (activeCount >= workerLimit) {
         return toast(`Tu plan permite hasta ${workerLimit} trabajadores activos.`, 'err');
      }

      if (workers.some(w => w.email.toLowerCase() === email)) {
         return toast('Este correo ya está registrado', 'err');
      }

      const submitBtn = $('#addWorkerForm button[type="submit"]');
      submitBtn.textContent = 'Procesando...';
      submitBtn.disabled = true;

      try {
         // 1. Write the cloud invitation before presenting it as active.
	         if (!window.click360InviteWorkerEmail) throw new Error('La invitación en nube no está disponible.');
	         const inviteMeta = await window.click360InviteWorkerEmail(email, name, { role });

         // 2. Add to local storage settings list
         state.settings ||= {};
         state.settings.workers ||= [];
	         state.settings.workers.push({ email, name, status: 'pending', role, inviteHash: inviteMeta?.inviteHash || '', permissions: inviteMeta?.permissions || {}, ownerId: window.click360User.uid, createdAt: new Date().toISOString() });
	         if (!save()) {
	           await window.click360CancelInviteEmail(email, inviteMeta?.inviteHash || '').catch(() => {});
	           throw new Error('No se pudo guardar la invitación localmente; la invitación en nube fue cancelada.');
	         }

         // 3. Display invite link PWA-compatible
         $('#inviteLinkBox').style.display = 'block';
	         const inviteLink = window.location.origin + window.location.pathname + "?invite=true&ownerId=" + encodeURIComponent(window.click360User.uid) + "&inviteHash=" + encodeURIComponent(inviteMeta.inviteHash) + "&inviteToken=" + encodeURIComponent(inviteMeta.inviteToken);
         $('#inviteLinkVal').value = inviteLink;

         toast('Invitacion segura creada', 'ok');
         await loadWorkers();

         // Reset fields
         $('#workerName').value = '';
         $('#workerEmail').value = '';
      } catch(err) {
         toast('Error al registrar: ' + err.message, 'err');
      } finally {
         submitBtn.textContent = 'Crear invitacion segura';
         submitBtn.disabled = false;
      }
    };

    $('#copyInviteLinkBtn').onclick = async () => {
       const el = $('#inviteLinkVal');
       try { await navigator.clipboard.writeText(el.value); }
       catch { el.select(); document.execCommand('copy'); }
       toast('Enlace copiado al portapapeles');
    };
  }

  function bindReports(){
      // Report date filters are view state only. Persisting them through save() used to
      // trigger cloud writes/sync gates from Safari just for changing a filter.
      $('#repFrom').onchange = (e) => { state.reportsFrom = e.target.value; renderApp('reports'); };
      $('#repTo').onchange = (e) => { state.reportsTo = e.target.value; renderApp('reports'); };
  }

  function bindSettings(){
    $('#configureTablesBtn')?.addEventListener('click', () => renderApp('tables'));
    $('#configureLogisticsBtn')?.addEventListener('click', () => renderApp('logistics'));
    let pendingLogoUrl = safeImageSrc((currentBusiness().settings || {}).logoUrl);
    const logoUpload = $('#bizLogoUpload');
    if (logoUpload) {
      logoUpload.addEventListener('change', (e) => {
         readImageInput(e.target, (data) => {
            if (!data) return;
            pendingLogoUrl = safeImageSrc(data);
            e.target.parentElement.previousElementSibling.innerHTML = `<img src="${escapeHtml(pendingLogoUrl)}" style="width:100%; height:100%; object-fit:cover;">`;
         }, { max: 260, quality: 0.48, maxBytes: 24 * 1024 });
      });
    }

    let pendingUserPhotoUrl = safeImageSrc(authUser().photoURL);
    const userPhotoUpload = $('#userPhotoUpload');
    if (userPhotoUpload) {
      userPhotoUpload.addEventListener('change', (e) => {
         readImageInput(e.target, (data) => {
            if (data) {
              pendingUserPhotoUrl = safeImageSrc(data);
              e.target.parentElement.previousElementSibling.innerHTML = `<img src="${escapeHtml(pendingUserPhotoUrl)}" style="width:100%; height:100%; object-fit:cover;">`;
            }
         }, { max: 220, quality: 0.5, maxBytes: 16 * 1024 });
      });
    }

    $('#saveUser').onclick = async () => {
       const newName = $('#userName').value.trim();
       if(!newName) return toast('Falta el nombre de usuario', 'err');

       const btn = $('#saveUser');
       btn.textContent = 'Guardando...';
       btn.disabled = true;
       try {
         const uid = window.click360User?.uid || window.click360Auth?.currentUser?.uid || '';
         const role = window.click360User?.role || 'guest';
         const email = window.click360User?.email || window.click360Auth?.currentUser?.email || '';
         const previousState = cloneState(state);
         const profile = { uid, name: newName, photoURL: pendingUserPhotoUrl || '', email, pendingSync: true };
         const safeProfile = cacheUserProfile(profile);
         const committed = await commitCriticalMutation(previousState, 'profile_updated', (next) =>
           next.settings?.userProfiles?.[uid]?.name === newName);
	         if(!committed.ok) {
	           const error = new Error(writeBlockMessage({ reason: committed.reason || 'profile_save_rejected' }));
	           error.code = committed.reason || 'profile_save_rejected';
	           throw error;
	         }
         if (window.click360User) {
           window.click360User.name = newName;
           window.click360User.photoURL = safeProfile.photoURL;
         }
         setSession({ username: newName, role });
         persistUserProfileCache(safeProfile);

         if (window.click360Auth?.currentUser?.updateProfile) {
           await window.click360Auth.currentUser.updateProfile({
             displayName: newName,
             photoURL: pendingUserPhotoUrl || null
           }).catch(err => console.warn('No se pudo actualizar Firebase Auth:', err.message));
         }

         if (window.click360Db && uid && navigator.onLine) {
           queuePendingProfile(safeProfile);
           const profileSynced = await flushPendingProfile();
           toast(profileSynced ? 'Perfil actualizado y sincronizado' : 'Perfil actualizado localmente; la nube sigue pendiente', profileSynced ? 'ok' : 'err');
         } else {
           toast(committed.pending ? 'Perfil guardado sin conexión; se sincronizará al volver.' : 'Perfil guardado en este dispositivo');
         }
	       } catch(e) {
	         console.error("Error actualizando perfil:", e);
	         const errorCode = String(e.code || window.click360LastWriteBlock?.reason || 'profile_save_failed');
	         window.CLICK360_RUNTIME_GUARD?.record?.({
	           message: `No se pudo guardar perfil: ${errorCode}`,
	           filename: 'app.js',
	           stack: e.stack || ''
	         });
	         toast(`No se pudo guardar el perfil. Código: ${errorCode}.`, 'err');
	       } finally {
         btn.textContent = 'Guardar Perfil';
         btn.disabled = false;
       }
       renderApp('settings');
    };

		    $('#saveBiz').onclick=async ()=>{
		       if (!isOwnerUser()) return toast('Solo el dueño puede cambiar datos del negocio.', 'err');
		       const b=currentBusiness();
		       const previousState = cloneState(state);
		       const businessId = b?.id || '';
	       b.name=$('#bizName').value.trim()||b.name;
       b.type=$('#bizType').value;
       currentBusiness().settings = currentBusiness().settings || {};
       const taxRate = Math.max(0, Math.min(100, parseFloat($('#bizIva').value) || 0));
       currentBusiness().settings.iva = taxRate;
       currentBusiness().settings.tax = {
         enabled: $('#bizTaxEnabled')?.checked === true && taxRate > 0,
         rate: taxRate,
         priceMode: $('#bizTaxPriceMode')?.value === 'excluded' ? 'excluded' : 'included',
         showLabel: $('#bizTaxShowLabel')?.checked !== false,
         rounding: 'line'
       };
       const previousPolicies = businessPolicies(currentBusiness());
       const nextPolicies = {
         layaway: $('#policyLayaway')?.value.trim() || previousPolicies.layaway,
         pickup: $('#policyPickup')?.value.trim() || previousPolicies.pickup,
         returns: $('#policyReturns')?.value.trim() || previousPolicies.returns,
         damages: $('#policyDamages')?.value.trim() || previousPolicies.damages,
         additional: $('#policyAdditional')?.value.trim() || ''
       };
       const policyChanged = ['layaway','pickup','returns','damages','additional'].some((key) => nextPolicies[key] !== previousPolicies[key]);
       currentBusiness().settings.policies = { ...nextPolicies, version: policyChanged ? previousPolicies.version + 1 : previousPolicies.version, updatedAt: policyChanged ? new Date().toISOString() : currentBusiness().settings.policies?.updatedAt || null };
       currentBusiness().settings.ruc = $('#bizRuc') ? $('#bizRuc').value.trim() : '';
	       currentBusiness().settings.phone = $('#bizPhone') ? $('#bizPhone').value.trim() : '';
	       currentBusiness().settings.address = $('#bizAddress') ? $('#bizAddress').value.trim() : '';
		       if (pendingLogoUrl) currentBusiness().settings.logoUrl = pendingLogoUrl;
		       const expectedName = b.name;
		       const expectedRuc = currentBusiness().settings.ruc;
		       addAudit('business_profile_updated', { businessId });
		       const committed = await commitCriticalMutation(previousState, 'business_profile_updated', (next) =>
		         next.businesses.some((business) => business.id === businessId
		           && business.name === expectedName
		           && business.settings?.ruc === expectedRuc));
		       renderApp('settings');
		       if (committed.ok) toast(committed.pending ? 'Perfil del negocio guardado; sincronización pendiente.' : 'Perfil del negocio guardado');
	    };
	    $('#createBiz').onclick=()=>{
	      if (!isOwnerUser()) return toast('Solo el dueño puede crear negocios.', 'err');
	      const name=$('#newBizName').value.trim();
      if(!name)return toast('Falta el nombre','err');
      const businessLimit = Number(window.click360User?.businessLimit || 2);
      if(state.businesses.length >= businessLimit) return toast(`Tu plan permite hasta ${businessLimit} negocios.`, 'err');
      const b={id:uid('biz'),code:'EMPRESA-'+String(state.businesses.length+1).padStart(3,'0'),name,type:$('#newBizType').value,status:'activo',due:'2026-07-08', settings:{}};
      b.settings.ruc = $('#newBizRuc').value.trim();
      b.settings.phone = $('#newBizPhone').value.trim();
      b.settings.address = '';
      state.businesses.push(b);
      state.activeBusinessId=b.id;
      addAudit('business_created', { businessId: b.id, name: b.name });
      if(!save()) return;
      renderApp('settings'); toast('Negocio creado');
    };

    const pickSettings = $('#businessPickerSettings');
    if (pickSettings) {
      pickSettings.onchange = () => {
        state.activeBusinessId = pickSettings.value;
        if(!save()) return;
        renderApp('settings');
        toast('Cambiaste de negocio');
      };
    }

	    $('#resetInventoryBtn').onclick = async () => {
	       if (!isOwnerUser()) {
	         return toast('Solo el dueño de la cuenta puede reiniciar inventario.', 'err');
	       }
	       const ok = confirm('ADVERTENCIA DE SEGURIDAD\nSe borrará todo el inventario de esta empresa. Se creará un respaldo automático antes de continuar.\n\n¿Deseas seguir?');
       if (!ok) return toast('Acción cancelada', 'err');
	       const confirmWord = prompt('Para confirmar que deseas reiniciar el inventario del negocio actual, escribe exactamente: REINICIAR');
	       if (confirmWord !== 'REINICIAR') {
	          return toast('Acción cancelada', 'err');
	       }
	       downloadBackup('antes-de-reiniciar-inventario');
	       const previousState = cloneState(state);
	       const businessId = currentBusiness().id;
	       const operationId = uid('inventoryreset');
	       state.products.filter(p => p.businessId === businessId).forEach(p => tombstoneProduct(p, 'inventory_reset'));
	       state.products = state.products.filter(p => p.businessId !== businessId);
	       addAudit('inventory_reset', { businessId, operationId });
	       const committed = await commitCriticalMutation(previousState, 'inventory_reset', (next) =>
	         !next.products.some((product) => product.businessId === businessId)
	         && next.auditLogs.some((entry) => entry.details?.operationId === operationId));
	       if (!committed.ok) { renderApp('settings'); return; }
	       toast(committed.pending ? 'Inventario reiniciado; sincronización pendiente.' : 'Inventario reiniciado.');
       renderApp('settings');
    };

    $('#resetSystemBtn').onclick = async () => {
       if (authUser().role !== 'owner') {
         return toast('Solo el dueño de la cuenta puede borrar el sistema.', 'err');
       }
	       const ok = confirm('ALERTA CRÍTICA DE SEGURIDAD\nSe eliminarán de forma permanente los datos del negocio activo: productos, ventas, movimientos, facturas y reportes diarios. Los otros negocios de la cuenta no se borrarán. Se creará un respaldo automático antes de continuar.\n\n¿Deseas seguir?');
       if (!ok) return toast('Acción cancelada', 'err');
	       const confirmWord = prompt('Para confirmar el borrado total e irreversible de todo el sistema, escribe exactamente: BORRAR TODO');
	       if (confirmWord !== 'BORRAR TODO') {
	          return toast('Acción cancelada', 'err');
	       }
	       downloadBackup('antes-de-borrar-todo');
		       const previousState = cloneState(state);
		       const bid = currentBusiness().id;
		       const operationId = uid('systemreset');
		       state.products.filter(x => x.businessId === bid).forEach(p => tombstoneProduct(p, 'system_reset'));
		       state.products = state.products.filter(x => x.businessId !== bid);
	       state.sales = state.sales.filter(x => x.businessId !== bid);
	       state.dailyReports = state.dailyReports.filter(x => x.businessId !== bid);
	       state.invoices = (state.invoices || []).filter(x => x.businessId !== bid);
	       state.movements = state.movements.filter(x => x.businessId !== bid);
	       state.layaways = (state.layaways || []).filter(x => x.businessId !== bid);
	       state.cashSessions = (state.cashSessions || []).filter(x => x.businessId !== bid);
	       state.notifications = (state.notifications || []).filter(x => x.businessId !== bid);
	       state.movements.push({
	         id: uid('mov'),
	         businessId: bid,
         date: today(),
         when: nowLabel(),
         kind: 'retiro',
	         amount: 0,
	         note: `Sistema reiniciado por: ${authUser().name}`,
	         cashSessionId: currentOpenCashSession(bid)?.id || '',
	         createdAtMs: Date.now(),
	         createdBy: authUser().name
	       });
	       addAudit('system_deleted', { businessId: bid, scope: 'active_business_only', operationId });
	       const committed = await commitCriticalMutation(previousState, 'system_deleted', (next) =>
	         !next.products.some((item) => item.businessId === bid)
	         && !next.sales.some((item) => item.businessId === bid)
	         && !next.invoices.some((item) => item.businessId === bid)
	         && next.auditLogs.some((entry) => entry.details?.operationId === operationId));
	       if (!committed.ok) { renderApp('settings'); return; }
	       toast(committed.pending ? 'Reinicio guardado; sincronización pendiente.' : 'Sistema reiniciado.');
	       setTimeout(() => window.location.reload(), 900);
    };

    $('#showTerms').onclick = (e) => {
       e.preventDefault();
       renderApp('legal');
    };
  }

	  function showModal(html){
	    const returnFocus = document.activeElement;
	    closeModal(false);
	    let root = $('#modalRoot');
	    if (!root) { root = document.createElement('div'); root.id = 'modalRoot'; document.body.appendChild(root); }
	    modalReturnFocus = returnFocus;
	    root.innerHTML = `<div class="modalOverlay show"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
	    document.body.classList.add('has-modal');
	    const dialog = $('.modal', root);
	    $$('.field label:not([for])', dialog).forEach((label) => {
	      const control = $('input,select,textarea', label.parentElement);
	      if (control?.id) label.htmlFor = control.id;
	    });
	    const heading = $('h1,h2,h3', dialog);
	    if (heading) {
	      heading.id ||= `click360-dialog-${uid('title')}`;
	      heading.tabIndex = -1;
	      dialog.setAttribute('aria-labelledby', heading.id);
	    } else {
	      dialog.setAttribute('aria-label', 'Ventana de CLICK 360');
	    }
	    $$('[data-close]', root).forEach((button) => {
	      button.setAttribute('aria-label', button.getAttribute('aria-label') || 'Cerrar');
	      button.onclick = closeModal;
	    });
	    $$('.desktopLayout,.bottomNav').forEach((element) => {
	      if (element.contains(root)) return;
	      element.inert = true;
	      element.setAttribute('aria-hidden', 'true');
	    });
	    const focusable = () => $$('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])', dialog)
	      .filter((element) => element.getClientRects().length > 0);
	    modalKeyHandler = (event) => {
	      if (event.key === 'Escape') {
	        event.preventDefault();
	        closeModal();
	        return;
	      }
	      if (event.key !== 'Tab') return;
	      const items = focusable();
	      if (!items.length) { event.preventDefault(); dialog.focus(); return; }
	      const first = items[0];
	      const last = items[items.length - 1];
	      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
	      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
	    };
	    document.addEventListener('keydown', modalKeyHandler);
	    $('.modalOverlay', root).addEventListener('pointerdown', (event) => { if (event.target === event.currentTarget) closeModal(); });
	    refreshIcons(root);
	    requestAnimationFrame(() => (heading || focusable()[0] || dialog).focus());
	  }
		  function closeModal(restoreFocus = true){
		    if (modalKeyHandler) document.removeEventListener('keydown', modalKeyHandler);
		    modalKeyHandler = null;
	    $$('#modalRoot').forEach((root) => {
	      if (root.closest('.app')) root.innerHTML = '';
	      else root.remove();
	    });
	    document.body.classList.remove('has-modal');
	    $$('.desktopLayout,.bottomNav').forEach((element) => {
	      element.inert = false;
	      element.removeAttribute('aria-hidden');
	    });
		    const returnFocus = modalReturnFocus;
		    modalReturnFocus = null;
		    if (restoreFocus && returnFocus?.isConnected) requestAnimationFrame(() => returnFocus.focus());
		  }
		  function syncDiagnosticRows(syncState = {}) {
		    const access = accessInfo();
		    const rows = [
		      ['Versión', APP_VISIBLE_VERSION],
		      ['Modo', syncState.displayMode || (window.matchMedia?.('(display-mode: standalone)')?.matches ? 'standalone' : 'browser')],
		      ['Ruta', route || 'home'],
		      ['Acceso', `${access.mode || 'unknown'} / lectura=${access.readOnly === true}`],
		      ['Sync', `${syncState.status || 'unknown'} / bloquea=${syncState.blocking === true}`],
		      ['Motivo', syncState.reason || 'sin_detalle'],
		      ['Hash local', syncState.localHash || 'n/a'],
		      ['Hash nube', syncState.remoteHash || 'n/a'],
		      ['Edad lock', `${Math.round(Number(syncState.lockAgeMs || 0) / 1000)}s`],
		      ['Cambios reales', syncState.hasDirtyFields === true ? 'sí' : 'no'],
		      ['Online', navigator.onLine ? 'sí' : 'no']
		    ];
		    // Hide technical rows by default - show only under support disclosure
		    return `<details class="syncDiagnosticDetails"><summary style="color:var(--muted);font-size:12px;cursor:pointer;margin-top:8px;">▶ Detalles técnicos (para soporte)</summary><dl class="syncDiagnosticList">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl></details>`;
		  }
		  function anonFingerprint(value = '') {
		    const text = String(value || '');
		    if (!text) return '';
		    let hash = 2166136261;
		    for (let index = 0; index < text.length; index += 1) {
		      hash ^= text.charCodeAt(index);
		      hash = Math.imul(hash, 16777619);
		    }
		    return `anon_${(hash >>> 0).toString(16).padStart(8, '0')}`;
		  }
		  window.click360GetReliabilityDiagnostics = function() {
		    const syncState = window.click360GetSyncState?.({ reason: 'ui_diagnostic' }) || {};
		    const access = accessInfo();
		    return {
		      appVersion: APP_RELEASE_VERSION,
		      buildSha: APP_BUILD_SHA && APP_BUILD_SHA !== '__CLICK360_BUILD_SHA__' ? APP_BUILD_SHA : '',
		      assetVersion: APP_ASSET_VERSION,
		      displayMode: syncState.displayMode || (window.matchMedia?.('(display-mode: standalone)')?.matches ? 'standalone' : 'browser'),
		      route,
		      activeBusinessId: anonFingerprint(syncState.activeBusinessId || currentBusiness()?.id || state.activeBusinessId),
		      effectiveAccess: { mode: String(access.mode || ''), readOnly: access.readOnly === true },
		      syncState: {
		        status: String(syncState.status || ''),
		        blocking: syncState.blocking === true,
		        reason: String(syncState.reason || ''),
		        localHash: String(syncState.localHash || ''),
		        remoteHash: String(syncState.remoteHash || ''),
		        lockAgeMs: Number(syncState.lockAgeMs || 0),
		        hasDirtyFields: syncState.hasDirtyFields === true
		      },
		      isOnline: navigator.onLine !== false,
		      userAgent: String(navigator.userAgent || '').slice(0, 500)
		    };
		  };
		  function localBusinessSyncStats() {
		    try {
		      const biz = currentBusiness();
		      const bizId = biz?.id || state?.activeBusinessId;
		      const products = (state?.products || []).filter(p => p.businessId === bizId).length;
		      const sales = (state?.sales || []).filter(s => s.businessId === bizId).length;
		      const movements = (state?.movements || []).filter(m => m.businessId === bizId).length;
		      return { businessId: bizId || '', products, sales, movements, meaningful: products > 0 || sales > 0 || movements > 0 };
		    } catch (error) {
		      console.warn('sync local stats:', error);
		      return { businessId: '', products: 0, sales: 0, movements: 0, meaningful: null };
		    }
		  }
		  window.click360GetLocalBusinessSyncStats = localBusinessSyncStats;
		  function showSyncConflictRecovery(gate = {}) {
		    const syncState = gate.syncState || window.click360GetSyncState?.({ reason: 'ui_conflict_modal' }) || {};
		    const localStats = localBusinessSyncStats();
		    const localProds = localStats.products;
		    const localSales = localStats.sales;
		    const localMovs = localStats.movements;
		    const hasMeaningfulLocalData = localStats.meaningful === true;

		    // A brand-new/empty device is not a real conflict. Never offer a destructive
		    // "keep local" path when it would mean pushing an empty tenant over cloud data.
		    if (localStats.meaningful === false) {
		      if (window.__CLICK360_EMPTY_LOCAL_RECOVERY_ACTIVE) return;
		      window.__CLICK360_EMPTY_LOCAL_RECOVERY_ACTIVE = true;
		      toast('Sincronizando los datos de tu negocio desde la nube...');
		      Promise.resolve(window.click360ResolveSyncConflict?.('refresh_cloud'))
		        .then((result) => {
		          if (result?.refreshed === true) {
		            closeModal(false);
		            renderApp(route);
		            toast('✅ Tus datos se actualizaron desde la nube.', 'ok');
		            return;
		          }
		          showModal(`<div class="modalHeader"><div><h2>Sincronización pendiente</h2><p class="fieldHint">Este dispositivo está vacío y no reemplazará los datos de la nube.</p></div><button class="closeBtn" data-close aria-label="Cerrar">×</button></div><div class="syncConflictPanel"><p>Conéctate a internet y vuelve a intentar. Tus datos remotos permanecen protegidos.</p><button type="button" class="btn primary block" id="syncRetryEmptyLocal">🔄 Reintentar desde nube</button></div>`);
		          $('#syncRetryEmptyLocal')?.addEventListener('click', () => { closeModal(false); showSyncConflictRecovery(gate); });
		        })
		        .catch((error) => {
		          console.warn('empty-local cloud recovery:', error);
		          toast('No se pudo actualizar desde nube. Tus datos remotos no fueron modificados.', 'err');
		        })
		        .finally(() => { window.__CLICK360_EMPTY_LOCAL_RECOVERY_ACTIVE = false; });
		      return;
		    }
		    showModal(`<div class="modalHeader"><div><h2>⚠️ Conflicto de sincronización</h2><p class="fieldHint">Los datos de este dispositivo y los de la nube son diferentes. Elige cómo resolver.</p></div><button class="closeBtn" data-close aria-label="Cerrar">×</button></div>
		      <div class="syncConflictPanel">
		        <div style="background:rgba(244,196,49,.10);border:1px solid rgba(244,196,49,.45);border-radius:8px;padding:12px;margin-bottom:12px;">
		          <b style="color:var(--gold2);display:block;margin-bottom:6px;">📱 Este dispositivo tiene:</b>
		          <span style="font-size:14px;line-height:1.6;">${localProds} productos · ${localSales} ventas · ${localMovs} movimientos</span>
		          ${hasMeaningfulLocalData ? '<p style="color:#ff8d92;font-size:12px;margin:8px 0 0;font-weight:850;">⚠️ Si eliges "Actualizar desde nube" estos datos serán REEMPLAZADOS.</p>' : ''}
		        </div>
		        ${syncDiagnosticRows(syncState)}
		        <div style="display:grid;gap:10px;margin-top:14px;">
		          <button type="button" class="btn primary" id="syncKeepLocal" style="min-height:54px;font-size:15px;">✅ Conservar mi versión local (${localProds} productos)</button>
		          <button type="button" class="btn silver" id="syncRefreshCloud" style="min-height:50px;">🔄 Actualizar desde nube${hasMeaningfulLocalData ? ' ⚠️' : ''}</button>
		        </div>
		        <button type="button" class="btn block" data-close style="margin-top:10px;">Cancelar (mantener conflicto)</button>
		      </div>`);
		    $('#syncKeepLocal')?.addEventListener('click', async () => {
		      if (!confirm(`✅ CONFIRMAR: Conservar este dispositivo.\n\nSe guardarán en la nube:\n• ${localProds} productos\n• ${localSales} ventas\n• ${localMovs} movimientos\n\nSe descargará un respaldo automático antes de continuar.\n\n¿Continuar?`)) return;
		      downloadBackup('antes-de-conservar-local');
		      toast('Guardando tu versión en la nube... puede tomar unos segundos.');
		      const result = await window.click360ResolveSyncConflict?.('keep_local').catch(() => null);
		      closeModal();
		      renderApp(route);
		      if (result?.ok) {
		        toast('✅ Tu versión local quedó guardada en la nube.', 'ok');
		      } else {
		        toast('No se pudo guardar en nube. Ve a Ajustes → Respaldo y exporta manualmente para no perder datos.', 'err');
		      }
		    });
		    $('#syncRefreshCloud')?.addEventListener('click', async () => {
		      const confirmMsg = hasMeaningfulLocalData
		        ? `⚠️ ADVERTENCIA: Esto REEMPLAZARÁ tus ${localProds} productos y ${localSales} ventas locales con la versión de la nube.\n\nUn respaldo automático se descargará ANTES de continuar para que puedas recuperar tus datos si es necesario.\n\n¿Estás seguro de querer reemplazar los datos locales?`
		        : '¿Actualizar datos desde la nube?';
		      if (!confirm(confirmMsg)) return;
		      downloadBackup('antes-de-actualizar-conflicto');
		      toast('Respaldo guardado. Actualizando desde nube...');
		      const result = await window.click360ResolveSyncConflict?.('refresh_cloud').catch(() => null);
		      closeModal();
		      renderApp(route);
		      toast(result?.ok ? '✅ Datos actualizados desde nube.' : 'No se pudo actualizar desde nube.', result?.ok ? 'ok' : 'err');
		    });
		  }
		  window.click360ShowSyncConflictRecovery = showSyncConflictRecovery;
		  async function clearLocalAppStateRecovery() {
		    if (!window.click360ClearLocalRecoveryState) return toast('Recuperación local no disponible en este entorno.', 'err');
		    if (!confirm('Esto limpiará únicamente locks locales de sincronización de esta app y recargará desde nube. No borra Firebase ni tus negocios. ¿Continuar?')) return;
		    downloadBackup('antes-de-limpiar-estado-local');
		    toast('Limpiando estado local...');
		    const result = await window.click360ClearLocalRecoveryState().catch(() => null);
		    renderApp(route);
		    toast(result?.ok ? 'Estado local recuperado desde nube.' : 'No se pudo completar la recuperación local.', result?.ok ? 'ok' : 'err');
		  }
		  function closeCalculator(){ $('#calculatorRoot')?.remove(); }
	  function calculatorOperation(left, right, operator) {
	    const domainResult = window.CLICK360_V16_DOMAIN?.calculatorOperation(left, right, operator);
	    if (domainResult !== undefined) return domainResult;
	    if (operator === '+') return left + right;
	    if (operator === '-') return left - right;
	    if (operator === '*') return left * right;
	    if (operator === '/') return right === 0 ? null : left / right;
	    return right;
	  }
	  const FLOATING_CALC_KEY = 'CLICK360:V16:FLOATING_CALCULATOR';
	  function floatingCalculatorPrefs() {
	    try {
	      const parsed = JSON.parse(localStorage.getItem(FLOATING_CALC_KEY) || '{}');
	      return {
	        x: Math.max(8, Math.min(window.innerWidth - 74, Number(parsed.x || window.innerWidth - 86))),
	        y: Math.max(80, Math.min(window.innerHeight - 96, Number(parsed.y || window.innerHeight - 154))),
	        size: Math.max(48, Math.min(74, Number(parsed.size || 58)))
	      };
	    } catch { return { x: window.innerWidth - 86, y: window.innerHeight - 154, size: 58 }; }
	  }
	  function saveFloatingCalculatorPrefs(next) {
	    try { localStorage.setItem(FLOATING_CALC_KEY, JSON.stringify(next)); } catch {}
	  }
	  function calculatorHistoryKey() {
	    const uidPart = activeTenantContext?.authUid || authUser()?.uid || 'offline';
	    const businessPart = currentBusiness()?.id || 'business';
	    return `CLICK360:V16:CALC_HISTORY:${uidPart}:${businessPart}`;
	  }
	  function calculatorHistory() {
	    try { return JSON.parse(localStorage.getItem(calculatorHistoryKey()) || '[]').slice(0, 12); } catch { return []; }
	  }
	  function pushCalculatorHistory(expression, result) {
	    const entry = { expression:String(expression || ''), result:String(result || '0'), at:new Date().toISOString() };
	    try { localStorage.setItem(calculatorHistoryKey(), JSON.stringify([entry, ...calculatorHistory()].slice(0, 12))); } catch {}
	  }
	  function calculatorOperatorLabel(operator) {
	    return ({ '*':'×', '/':'÷', '+':'+', '-':'−' })[operator] || operator;
	  }
	  function bindFloatingCalculator() {
	    const button = $('#floatingCalcBtn');
	    if (!button) return;
	    let prefs = floatingCalculatorPrefs();
	    const apply = () => {
	      button.style.setProperty('--calc-x', `${prefs.x}px`);
	      button.style.setProperty('--calc-y', `${prefs.y}px`);
	      button.style.setProperty('--calc-size', `${prefs.size}px`);
	    };
	    apply();
	    let drag = null;
	    button.onpointerdown = (event) => {
	      drag = { startX:event.clientX, startY:event.clientY, x:prefs.x, y:prefs.y, moved:false };
	      button.setPointerCapture?.(event.pointerId);
	    };
	    button.onpointermove = (event) => {
	      if (!drag) return;
	      const nextX = Math.max(8, Math.min(window.innerWidth - prefs.size - 8, drag.x + event.clientX - drag.startX));
	      const nextY = Math.max(70, Math.min(window.innerHeight - prefs.size - 12, drag.y + event.clientY - drag.startY));
	      drag.moved ||= Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > 8;
	      prefs = { ...prefs, x:nextX, y:nextY };
	      apply();
	      event.preventDefault();
	    };
	    button.onpointerup = () => {
	      const wasDrag = drag?.moved;
	      drag = null;
	      saveFloatingCalculatorPrefs(prefs);
	      if (!wasDrag) openCalculator();
	    };
	    button.onpointercancel = () => { drag = null; saveFloatingCalculatorPrefs(prefs); };
	    button.ondblclick = (event) => {
	      prefs = { ...prefs, size:prefs.size >= 70 ? 50 : prefs.size + 8 };
	      apply();
	      saveFloatingCalculatorPrefs(prefs);
	      event.preventDefault();
	    };
	  }
	  function openCalculator(options = {}) {
	    closeCalculator();
	    const targets = [
	      ['cashReceived', 'Efectivo recibido'], ['discount', 'Descuento'], ['mAmount', 'Monto del movimiento'],
	      ['apertureAmountInput', 'Apertura de caja'], ['emAmount', 'Monto editado'], ['reminderAmount', 'Monto del recordatorio'], ['iAmount', 'Factura de proveedor']
	    ].filter(([id]) => document.getElementById(id));
	    const preferredTarget = targets.some(([id]) => id === options.preferredTarget) ? options.preferredTarget : (targets[0]?.[0] || '');
	    const initialBase = Math.max(0, Number(options.base || parseMoney(document.getElementById(preferredTarget)?.value || 0)) || 0);
	    const root = document.createElement('div');
	    root.id = 'calculatorRoot';
	    root.innerHTML = `<div class="calculatorWorkspace"><section class="calculatorSheet" role="dialog" aria-modal="false" aria-labelledby="calculatorTitle"><div class="modalHeader calculatorWindowHeader"><div><h2 id="calculatorTitle">Calculadora</h2><p class="fieldHint">Puedes dejarla abierta mientras trabajas.</p></div><div class="calculatorWindowActions"><button type="button" class="iconBtn" data-calculator-minimize aria-label="Minimizar calculadora" title="Minimizar">${icon('minus')}</button><button type="button" class="closeBtn" data-calculator-close aria-label="Cerrar">×</button></div></div><div class="calculatorBody"><div class="calculatorSizeControl" aria-label="Tamaño del icono flotante"><span>Icono</span><button type="button" data-calc-size="50">Pequeño</button><button type="button" data-calc-size="58">Medio</button><button type="button" data-calc-size="72">Grande</button></div>${targets.length ? `<label class="field"><span>Usar resultado en</span><select id="calculatorTarget">${targets.map(([id, label]) => `<option value="${id}" ${id === preferredTarget ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></label>` : ''}<output id="calculatorDisplay" class="calculatorDisplay">${initialBase || 0}</output><div class="calculatorKeys" aria-label="Teclado de calculadora"><button data-calc-action="clear">C</button><button data-calc-action="back" aria-label="Borrar último">${icon('delete')}</button><button data-calc-action="percent">%</button><button class="operator" data-calc-op="/">÷</button>${['7','8','9'].map((key) => `<button data-calc-key="${key}">${key}</button>`).join('')}<button class="operator" data-calc-op="*">×</button>${['4','5','6'].map((key) => `<button data-calc-key="${key}">${key}</button>`).join('')}<button class="operator" data-calc-op="-">−</button>${['1','2','3'].map((key) => `<button data-calc-key="${key}">${key}</button>`).join('')}<button class="operator" data-calc-op="+">+</button><button data-calc-action="sign">±</button><button data-calc-key="0">0</button><button data-calc-key=".">.</button><button class="equals" data-calc-action="equals">=</button></div><div class="calculatorHelpers"><label>Porcentaje<input id="calculatorRate" type="number" min="0" max="100" step="0.01" value="15" inputmode="decimal"></label><button type="button" data-calc-helper="discount">Descuento</button><button type="button" data-calc-helper="tax">Impuesto</button></div><div class="calculatorHistory" id="calculatorHistory"></div><div class="calculatorActions"><button type="button" class="btn" id="calculatorCopy">${icon('copy')} Copiar</button><button type="button" class="btn primary" id="calculatorUse">${icon('check')} Usar resultado</button></div></div></section></div>`;
	    document.body.appendChild(root);
	    refreshIcons(root);
	    let display = String(initialBase || '0');
	    let accumulator = null;
	    let pendingOperator = null;
	    let replaceDisplay = false;
	    const output = $('#calculatorDisplay', root);
	    const renderHistory = () => {
	      const target = $('#calculatorHistory', root);
	      if (!target) return;
	      const entries = calculatorHistory();
	      target.innerHTML = entries.length
	        ? `<b>Historial</b>${entries.map((entry) => `<button type="button" data-calc-history="${escapeHtml(entry.result)}"><span>${escapeHtml(entry.expression)}</span><strong>${escapeHtml(entry.result)}</strong></button>`).join('')}`
	        : '<small>Sin cálculos todavía.</small>';
	    };
	    const render = () => { output.textContent = display; renderHistory(); };
	    const normalizedResult = (value) => String(Math.round((Number(value) + Number.EPSILON) * 1000000) / 1000000);
	    const calculate = () => {
	      if (accumulator == null || !pendingOperator) return Number(display) || 0;
	      const left = accumulator;
	      const right = Number(display) || 0;
	      const operator = pendingOperator;
	      const result = calculatorOperation(left, right, operator);
	      if (result == null || !Number.isFinite(result)) { toast('No se puede dividir para cero.', 'err'); return null; }
	      display = normalizedResult(result);
	      pushCalculatorHistory(`${normalizedResult(left)} ${calculatorOperatorLabel(operator)} ${normalizedResult(right)} =`, display);
	      accumulator = null;
	      pendingOperator = null;
	      replaceDisplay = true;
	      render();
	      return result;
	    };
	    $$('[data-calc-key]', root).forEach((button) => { button.onclick = () => {
	      const key = button.dataset.calcKey;
	      if (replaceDisplay) { display = '0'; replaceDisplay = false; }
	      if (key === '.' && display.includes('.')) return;
	      display = key === '.' ? `${display}.` : display === '0' ? key : `${display}${key}`;
	      if (display.length > 16) display = display.slice(0, 16);
	      render();
	    }; });
	    $$('[data-calc-op]', root).forEach((button) => { button.onclick = () => {
	      if (pendingOperator && !replaceDisplay && calculate() == null) return;
	      accumulator = Number(display) || 0;
	      pendingOperator = button.dataset.calcOp;
	      replaceDisplay = true;
	    }; });
	    $('[data-calc-action="clear"]', root).onclick = () => { display = '0'; accumulator = null; pendingOperator = null; replaceDisplay = false; render(); };
	    $('[data-calc-action="back"]', root).onclick = () => { display = display.length > 1 ? display.slice(0, -1) : '0'; render(); };
	    $('[data-calc-action="percent"]', root).onclick = () => { display = normalizedResult((Number(display) || 0) / 100); render(); };
	    $('[data-calc-action="sign"]', root).onclick = () => { display = normalizedResult(-(Number(display) || 0)); render(); };
	    $('[data-calc-action="equals"]', root).onclick = calculate;
	    root.addEventListener('click', (event) => {
	      const historyButton = event.target.closest('[data-calc-history]');
	      if (historyButton) { display = historyButton.dataset.calcHistory || '0'; replaceDisplay = true; render(); return; }
	      const sizeButton = event.target.closest('[data-calc-size]');
	      if (sizeButton) {
	        const prefs = floatingCalculatorPrefs();
	        saveFloatingCalculatorPrefs({ ...prefs, size:Number(sizeButton.dataset.calcSize || 58) });
	        bindFloatingCalculator();
	      }
	    });
	    $$('[data-calc-helper]', root).forEach((button) => { button.onclick = () => {
	      const rate = Math.max(0, Math.min(100, Number($('#calculatorRate', root).value || 0)));
	      const base = initialBase || Number(display) || 0;
	      display = normalizedResult(base * rate / 100);
	      pushCalculatorHistory(`${button.dataset.calcHelper === 'discount' ? 'Descuento' : 'Impuesto'} ${rate}% de ${normalizedResult(base)} =`, display);
	      accumulator = null; pendingOperator = null; replaceDisplay = true; render();
	      toast(button.dataset.calcHelper === 'discount' ? `Descuento de ${rate}% calculado` : `Impuesto de ${rate}% calculado`);
	    }; });
	    $('#calculatorCopy', root).onclick = async () => {
	      await navigator.clipboard?.writeText(display).catch(() => null);
	      toast('Resultado copiado');
	    };
	    $('#calculatorUse', root).onclick = () => {
	      const targetId = $('#calculatorTarget', root)?.value || '';
	      const target = targetId ? document.getElementById(targetId) : null;
	      if (target) {
	        target.value = normalizedResult(Number(display) || 0);
	        target.dispatchEvent(new Event('input', { bubbles: true }));
	        target.dispatchEvent(new Event('change', { bubbles: true }));
	        toast('Resultado aplicado');
	      } else {
	        navigator.clipboard?.writeText(display).catch(() => null);
	        toast('Resultado listo para pegar');
	      }
	      closeCalculator();
	    };
	    $('[data-calculator-minimize]', root).onclick = () => {
	      const sheet = $('.calculatorSheet', root);
	      const minimized = sheet.classList.toggle('minimized');
	      $('[data-calculator-minimize]', root).setAttribute('aria-label', minimized ? 'Expandir calculadora' : 'Minimizar calculadora');
	      $('[data-calculator-minimize]', root).setAttribute('title', minimized ? 'Expandir' : 'Minimizar');
	    };
	    $$('[data-calculator-close]', root).forEach((button) => { button.onclick = closeCalculator; });
	    // Drag to move calculator window by its header
	    const calcSheet = $('.calculatorSheet', root);
	    const calcHeader = $('.calculatorWindowHeader', root);
	    if (calcSheet && calcHeader) {
	      const savedPos = (() => { try { return JSON.parse(localStorage.getItem('calcWindowPos') || 'null'); } catch { return null; } })();
	      const savedSize = (() => { try { return JSON.parse(localStorage.getItem('calcWindowSize') || 'null'); } catch { return null; } })();
      const calculatorBounds = () => ({ maxW: Math.max(220, window.innerWidth - 16), maxH: Math.max(280, window.innerHeight - 24) });
      const applyCalculatorWindowSize = (width, height) => {
        const bounds = calculatorBounds();
        const nextW = Math.max(220, Math.min(bounds.maxW, Number(width || Math.min(360, bounds.maxW))));
        const nextH = Math.max(280, Math.min(bounds.maxH, Number(height || Math.min(620, bounds.maxH))));
        calcSheet.style.width = nextW + 'px';
        calcSheet.style.height = nextH + 'px';
        calcSheet.style.maxHeight = bounds.maxH + 'px';
        return { width: nextW, height: nextH };
      };
      const persistCalculatorWindowSize = () => {
        try { localStorage.setItem('calcWindowSize', JSON.stringify({ width: calcSheet.offsetWidth, height: calcSheet.offsetHeight })); } catch {}
      };
      if (savedSize) applyCalculatorWindowSize(savedSize.width, savedSize.height);
      if (savedPos) {
	        calcSheet.style.right = 'auto'; calcSheet.style.bottom = 'auto';
	        calcSheet.style.left = Math.max(8, Math.min(Math.max(8, window.innerWidth - calcSheet.offsetWidth - 8), Number(savedPos.x || 8))) + 'px';
        calcSheet.style.top = Math.max(8, Math.min(Math.max(8, window.innerHeight - calcSheet.offsetHeight - 8), Number(savedPos.y || 8))) + 'px';
	      }
	      let calcDrag = null;
	      calcHeader.style.cursor = 'grab';
	      calcHeader.addEventListener('pointerdown', function(ev) {
	        if (ev.target.closest('button')) return;
	        const rect = calcSheet.getBoundingClientRect();
	        calcSheet.style.right = 'auto'; calcSheet.style.bottom = 'auto';
	        calcSheet.style.left = rect.left + 'px'; calcSheet.style.top = rect.top + 'px';
	        calcDrag = { startX: ev.clientX, startY: ev.clientY, x: rect.left, y: rect.top };
	        calcHeader.setPointerCapture && calcHeader.setPointerCapture(ev.pointerId);
	        calcHeader.style.cursor = 'grabbing'; ev.preventDefault();
	      });
	      calcHeader.addEventListener('pointermove', function(ev) {
	        if (!calcDrag) return;
	        const nx = Math.max(8, Math.min(Math.max(8, window.innerWidth - calcSheet.offsetWidth - 8), calcDrag.x + ev.clientX - calcDrag.startX));
        const ny = Math.max(8, Math.min(Math.max(8, window.innerHeight - calcSheet.offsetHeight - 8), calcDrag.y + ev.clientY - calcDrag.startY));
	        calcSheet.style.left = nx + 'px'; calcSheet.style.top = ny + 'px';
	      });
	      const endCalcDrag = function() {
	        if (!calcDrag) return;
	        try { localStorage.setItem('calcWindowPos', JSON.stringify({x:parseFloat(calcSheet.style.left||0),y:parseFloat(calcSheet.style.top||0)})); } catch(e) {}
	        calcDrag = null; calcHeader.style.cursor = 'grab';
	      };
	      calcHeader.addEventListener('pointerup', endCalcDrag);
	      calcHeader.addEventListener('pointercancel', endCalcDrag);
	      // Pinch-to-resize (mobile) and Ctrl+wheel resize (desktop)
	      let pinchStart = null;
	      calcSheet.addEventListener('touchstart', function(ev) {
	        if (ev.touches.length === 2) {
	          ev.preventDefault();
	          const dx = ev.touches[0].clientX - ev.touches[1].clientX;
	          const dy = ev.touches[0].clientY - ev.touches[1].clientY;
	          pinchStart = { dist: Math.hypot(dx, dy), w: calcSheet.offsetWidth, h: calcSheet.offsetHeight };
	        }
	      }, { passive: false });
	      calcSheet.addEventListener('touchmove', function(ev) {
	        if (ev.touches.length === 2 && pinchStart) {
	          ev.preventDefault();
	          const dx = ev.touches[0].clientX - ev.touches[1].clientX;
	          const dy = ev.touches[0].clientY - ev.touches[1].clientY;
          const scale = Math.max(0.55, Math.min(1.8, Math.hypot(dx, dy) / Math.max(1, pinchStart.dist)));
          applyCalculatorWindowSize(Math.round(pinchStart.w * scale), Math.round(pinchStart.h * scale));
	        }
	      }, { passive: false });
	      calcSheet.addEventListener('touchend', function() { if (pinchStart) persistCalculatorWindowSize(); pinchStart = null; });
	      calcSheet.addEventListener('wheel', function(ev) {
	        if (!ev.ctrlKey && !ev.metaKey) return;
	        ev.preventDefault();
        const factor = ev.deltaY > 0 ? 0.92 : 1.08;
        applyCalculatorWindowSize(Math.round(calcSheet.offsetWidth * factor), Math.round(calcSheet.offsetHeight * factor));
        persistCalculatorWindowSize();
	      }, { passive: false });
	    }
	    renderHistory();
	  }

  function defaultLabelLayout() {
    return {
      business: { x: 130, y: 27, width: 235, size: 16, visible: true, locked: false, z: 2 },
      address: { x: 130, y: 46, width: 235, size: 9, visible: true, locked: false, z: 2 },
      logo: { x: 15, y: 14, width: 38, height: 38, visible: false, locked: false, z: 3 },
      image: { x: 204, y: 14, width: 42, height: 42, visible: false, locked: false, z: 3 },
      qr: { x: 45, y: 60, width: 170, height: 170, visible: true, locked: false, z: 1 },
      barcode: { x: 20, y: 235, width: 220, height: 34, visible: true, locked: false, z: 2 },
      code: { x: 130, y: 278, width: 230, size: 10, visible: true, locked: false, z: 2 },
      name: { x: 130, y: 302, width: 235, size: 16, visible: true, locked: false, z: 2 },
      variant: { x: 130, y: 320, width: 235, size: 10, visible: false, locked: false, z: 2 },
      price: { x: 130, y: 326, width: 235, size: 18, visible: true, locked: false, z: 2 },
      tax: { x: 130, y: 345, width: 235, size: 9, visible: true, locked: false, z: 2 },
      social: { x: 130, y: 363, width: 235, size: 9, visible: true, locked: false, z: 2 },
      phone: { x: 58, y: 363, width: 110, size: 8, visible: false, locked: false, z: 2 },
      stock: { x: 202, y: 363, width: 90, size: 8, visible: false, locked: false, z: 2 },
      customText: { x: 130, y: 232, width: 235, size: 8, visible: false, locked: false, z: 2 }
    };
  }
  function normalizedLabelLayout(layout = {}) {
    const defaults = defaultLabelLayout();
    Object.keys(defaults).forEach((key) => { defaults[key] = { ...defaults[key], ...(layout[key] || {}) }; });
    return defaults;
  }
  const LABEL_PAPER_PRESETS = Object.freeze({
    'thermal-40x30': { label:'Rollo térmico 40x30 mm', mediaType:'roll-1', width:40, height:30, mediaWidth:40, columns:1, rows:1, gapX:0, gapY:0, dpi:203 },
    'thermal-50x30': { label:'Rollo térmico etiqueta pequeña · Rollo térmico 50x30 mm', mediaType:'roll-1', width:50, height:30, mediaWidth:50, columns:1, rows:1, gapX:0, gapY:0, dpi:203 },
    'thermal-60x40': { label:'Rollo térmico 60x40 mm', mediaType:'roll-1', width:60, height:40, mediaWidth:60, columns:1, rows:1, gapX:0, gapY:0, dpi:203 },
    'thermal-80x50': { label:'Rollo térmico 80x50 mm', mediaType:'roll-1', width:80, height:50, mediaWidth:80, columns:1, rows:1, gapX:0, gapY:0, dpi:203 },
    'thermal-108': { label:'Rollo térmico 4x2 · 4 pulgadas / 108 mm', mediaType:'roll-1', width:108, height:60, mediaWidth:108, columns:1, rows:1, gapX:0, gapY:0, dpi:203 },
    'roll-2-custom': { label:'Rollo de 2 columnas · confirmar medidas', mediaType:'roll-2', width:40, height:60, mediaWidth:0, columns:2, rows:1, gapX:2, gapY:2, dpi:203, provisional:true },
    'roll-3-custom': { label:'Rollo de 3 columnas · confirmar medidas', mediaType:'roll-3', width:30, height:40, mediaWidth:0, columns:3, rows:1, gapX:2, gapY:2, dpi:203, provisional:true },
    'roll-2-40x60-provisional': { label:'Rollo 2 columnas · 40x60 mm · 203 DPI (provisional)', mediaType:'roll-2', width:40, height:60, mediaWidth:0, columns:2, rows:1, gapX:0, gapY:0, dpi:203, provisional:true, requiresMeasurement:true },
    'sheet-2': { label:'Hoja 2 columnas · Hoja A4 2 columnas', mediaType:'sheet', width:90, height:45, mediaWidth:210, mediaHeight:297, columns:2, rows:5, gapX:4, gapY:4, dpi:300, marginTop:8, marginRight:8, marginBottom:8, marginLeft:8 },
    'sheet-3': { label:'Hoja 3 columnas · Hoja A4 3 columnas', mediaType:'sheet', width:60, height:35, mediaWidth:210, mediaHeight:297, columns:3, rows:7, gapX:3, gapY:3, dpi:300, marginTop:7, marginRight:7, marginBottom:7, marginLeft:7 },
    'sheet-small': { label:'Hoja A4 stickers pequeños', mediaType:'sheet', width:38, height:25, mediaWidth:210, mediaHeight:297, columns:4, rows:10, gapX:2, gapY:2, dpi:300, marginTop:6, marginRight:6, marginBottom:6, marginLeft:6 },
    'square-50': { label:'Etiqueta cuadrada 50x50 mm', mediaType:'square', width:50, height:50, mediaWidth:50, columns:1, rows:1, gapX:0, gapY:0, dpi:203, shape:'square' },
    'round-50': { label:'Etiqueta redonda 50 mm', mediaType:'round', width:50, height:50, mediaWidth:50, columns:1, rows:1, gapX:0, gapY:0, dpi:203, shape:'circle' },
    'ticket-80': { label:'Ticket térmico 80 mm', mediaType:'receipt', width:80, height:120, mediaWidth:80, columns:1, rows:1, gapX:0, gapY:0, dpi:203 },
    continuous: { label:'Papel continuo', mediaType:'continuous', width:60, height:40, mediaWidth:60, columns:1, rows:1, gapX:0, gapY:0, dpi:203, provisional:true },
    unsure: { label:'No estoy seguro · guía de medición', mediaType:'unsure', width:60, height:40, mediaWidth:0, columns:1, rows:1, gapX:0, gapY:0, dpi:203, provisional:true },
    custom: { label:'Personalizada' }
  });
  function labelPaperOptions(selected = 'custom') {
    return Object.entries(LABEL_PAPER_PRESETS).map(([key, preset]) =>
      `<option value="${key}" ${selected === key ? 'selected' : ''}>${escapeHtml(preset.label)}</option>`).join('');
  }
  function labelElementBounds(key, element) {
    const width = Number(element.width || 20);
    const height = ['qr','barcode','logo','image'].includes(key) ? Number(element.height || width) : Number(element.size || 10) * 1.35;
    const centered = !['qr','logo','image','barcode'].includes(key);
    return {
      left:centered ? Number(element.x || 0) - width / 2 : Number(element.x || 0),
      right:centered ? Number(element.x || 0) + width / 2 : Number(element.x || 0) + width,
      top:Number(element.y || 0) - (['qr','barcode','logo','image'].includes(key) ? 0 : height),
      bottom:Number(element.y || 0) + (['qr','barcode','logo','image'].includes(key) ? height : 3)
    };
  }
  function validateLabelLayout(options = {}, layout = {}, copies = 1) {
    const widthMm = Number(options.widthMm || 0);
    const heightMm = Number(options.heightMm || 0);
    const columns = Number(options.columns || 1);
    const rows = Number(options.rows || 1);
    const errors = [];
    const warnings = [];
    if (widthMm < 10 || widthMm > 250 || heightMm < 10 || heightMm > 400) errors.push('El tamaño de etiqueta no es válido.');
    if (copies < 1 || copies > 500) errors.push('La cantidad debe estar entre 1 y 500.');
    if (columns < 1 || columns > 6 || rows < 1 || rows > 20) errors.push('La cuadrícula de papel no es válida.');
    const paperValidation = window.CLICK360_SMART_PRINT?.validatePaperProfile({
      id:options.paperType,
      mediaType:options.mediaType,
      labelWidthMm:widthMm,
      labelHeightMm:heightMm,
      mediaWidthMm:options.mediaWidthMm,
      mediaHeightMm:options.mediaHeightMm,
      columns,
      rows,
      gapHorizontalMm:options.gapXmm,
      gapVerticalMm:options.gapYmm,
      marginTopMm:options.marginTopMm,
      marginRightMm:options.marginRightMm,
      marginBottomMm:options.marginBottomMm,
      marginLeftMm:options.marginLeftMm,
      shape:options.shape,
      contentRotation:options.contentRotation,
      status:options.profileStatus,
      measurementsConfirmed:options.measurementsConfirmed
    });
    if (paperValidation && !paperValidation.valid) errors.push(...paperValidation.errors);
    if (paperValidation) warnings.push(...paperValidation.warnings);
    const baseWidth = Math.round(Math.max(10, widthMm) * (260 / 60));
    const baseHeight = Math.round(Math.max(10, heightMm) * (380 / 88));
    Object.entries(normalizedLabelLayout(layout)).forEach(([key, element]) => {
      if (element.visible === false) return;
      const bounds = labelElementBounds(key, element);
      if (bounds.left < 0 || bounds.top < 0 || bounds.right > baseWidth || bounds.bottom > baseHeight) {
        warnings.push(`${key} queda fuera de la zona segura.`);
      }
    });
    const qr = normalizedLabelLayout(layout).qr;
    if (qr.visible !== false && Math.min(Number(qr.width || 0), Number(qr.height || qr.width || 0)) < 90) errors.push('El QR es demasiado pequeño para una lectura segura.');
    const visible = Object.entries(normalizedLabelLayout(layout)).filter(([, element]) => element.visible !== false);
    for (let first = 0; first < visible.length; first += 1) {
      for (let second = first + 1; second < visible.length; second += 1) {
        const a = labelElementBounds(visible[first][0], visible[first][1]);
        const b = labelElementBounds(visible[second][0], visible[second][1]);
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
          const keys = [visible[first][0], visible[second][0]];
          warnings.push(`Hay elementos superpuestos: ${keys[0]} y ${keys[1]}.`);
        }
      }
    }
    return { valid:errors.length === 0, errors:[...new Set(errors)], warnings:[...new Set(warnings)], capacity:columns * rows };
  }
  const validateLabelPrintSetup = validateLabelLayout;
  window.click360ValidateLabelLayout = validateLabelLayout;
  window.click360ValidateLabelPrintSetup = validateLabelPrintSetup;
  function drawFittedText(ctx, text, element, scale, weight = 700, family = 'Arial') {
    if (!element.visible || !String(text || '').trim()) return;
    let fontSize = Math.max(6, Number(element.size || 10)) * scale;
    const maxWidth = Math.max(20, Number(element.width || 220)) * scale;
    ctx.font = `${weight} ${fontSize}px ${family}`;
    while (ctx.measureText(String(text)).width > maxWidth && fontSize > 6 * scale) {
      fontSize -= scale;
      ctx.font = `${weight} ${fontSize}px ${family}`;
    }
    const x = Number(element.x || 0) * scale;
    const y = Number(element.y || 0) * scale;
    const rotation = Number(element.rotation || 0) * Math.PI / 180;
    if (rotation) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rotation);
      ctx.fillText(String(text), 0, 0, maxWidth); ctx.restore();
      return;
    }
    ctx.fillText(String(text), x, y, maxWidth);
  }
  function drawCanvasElement(ctx, element, scale, x, y, width, height, draw) {
    const rotation = Number(element.rotation || 0) * Math.PI / 180;
    if (!rotation) return draw(x * scale, y * scale, width * scale, height * scale);
    ctx.save();
    ctx.translate((x + width / 2) * scale, (y + height / 2) * scale);
    ctx.rotate(rotation);
    draw(-width * scale / 2, -height * scale / 2, width * scale, height * scale);
    ctx.restore();
  }
  function loadCanvasImage(src) {
    return new Promise((resolve) => {
      const safe = safeImageSrc(src);
      if (!safe) return resolve(null);
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = safe;
    });
  }
  function resolvedTaxLegend(product, options) {
    const mode = options.taxDisplay || 'inherit';
    if (mode === 'hidden') return '';
    if (mode === 'included') return 'Incluye IVA';
    if (mode === 'excluded') return 'No incluye IVA';
    if (mode === 'exempt') return 'Exento de IVA';
    return productTaxLegend(product);
  }
  async function drawLabelOnCanvas(canvas, product, options = {}) {
    const scale = options.scale || 3;
    const widthMm = Math.max(10, Math.min(250, Number(options.widthMm || 60)));
    const heightMm = Math.max(10, Math.min(400, Number(options.heightMm || 88)));
	    const baseWidth = Math.round(widthMm * (260 / 60));
	    const baseHeight = Math.round(heightMm * (380 / 88));
	    const layout = normalizedLabelLayout(options.layout);
	    layout.barcode.visible = options.showBarcode !== false && layout.barcode.visible !== false;
	    const yOffset = Number(options.yOffsetAdj || 0);
	    if (yOffset) Object.entries(layout).forEach(([key, element]) => {
	      if (!['qr', 'logo', 'image'].includes(key)) element.y = Number(element.y || 0) + yOffset;
	    });
	    layout.name.size = Number(layout.name.size || 10) * Math.max(0.6, Math.min(1.4, Number(options.nameScale || 1)));
	    layout.price.size = Number(layout.price.size || 10) * Math.max(0.6, Math.min(1.4, Number(options.priceScale || 1)));
    const w = baseWidth * scale;
    const h = baseHeight * scale;
    canvas.width = w;
    canvas.height = h;
    canvas.dataset.baseWidth = String(baseWidth);
    canvas.dataset.baseHeight = String(baseHeight);
	    const ctx = canvas.getContext('2d');
	    ctx.save();
	    ctx.fillStyle = safeColor(options.bgColor, '#ffffff');
	    if (options.shape === 'circle') {
	      ctx.beginPath();
	      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
	      ctx.clip();
	      ctx.fillRect(0, 0, w, h);
	    } else {
	      roundRect(ctx, 0, 0, w, h, options.shape === 'square' ? 0 : 12 * scale, true, false);
	    }
    const fg = safeColor(options.fgColor, '#000000');
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    const layers = Object.entries(layout).sort((a, b) => Number(a[1].z || 0) - Number(b[1].z || 0));
    for (const [key, element] of layers) {
      if (!element.visible) continue;
      if (key === 'qr') {
        const size = Math.max(90, Math.min(Number(element.width || 170), Number(element.height || element.width || 170)));
        const x = Math.max(0, Math.min(baseWidth - size, Number(element.x || 0)));
        const y = Math.max(0, Math.min(baseHeight - size, Number(element.y || 0)));
        const qrCanvas = document.createElement('canvas');
        QR.draw(qrCanvas, productPayload(product), size * scale, Math.max(2, Number(options.qrMargin || 5)), fg, safeColor(options.qrBgColor || options.bgColor, '#ffffff'));
        drawCanvasElement(ctx, element, scale, x, y, size, size, (dx, dy, dw, dh) => ctx.drawImage(qrCanvas, dx, dy, dw, dh));
      } else if (key === 'barcode') {
        if (typeof window.JsBarcode !== 'function' || !String(product.code || '').trim()) continue;
        try {
          const barcodeCanvas = document.createElement('canvas');
          window.JsBarcode(barcodeCanvas, String(product.code).trim(), { format:'CODE128', displayValue:false, margin:0, background:safeColor(options.bgColor, '#ffffff'), lineColor:fg, height:Math.max(20, Number(element.height || 34) * scale) });
          drawCanvasElement(ctx, element, scale, Number(element.x || 0), Number(element.y || 0), Number(element.width || 220), Number(element.height || 34), (dx, dy, dw, dh) => ctx.drawImage(barcodeCanvas, dx, dy, dw, dh));
        } catch {}
      } else if (key === 'logo' || key === 'image') {
        const source = key === 'logo' ? options.businessLogo : product.imageData;
        const image = await loadCanvasImage(source);
        if (image) drawCanvasElement(ctx, element, scale, Number(element.x || 0), Number(element.y || 0), Number(element.width || 40), Number(element.height || 40), (dx, dy, dw, dh) => ctx.drawImage(image, dx, dy, dw, dh));
      } else {
        const values = {
          business: String(options.businessName || 'CLICK 360').toUpperCase(),
          address: options.address,
          code: product.code,
          name: product.name,
          variant: product.variant || product.category,
          price: (() => {
            if (!product.cardPrice || product.cardPrice === product.price) return fmt(product.price);
            const cash = fmt(product.price);
            const card = fmt(product.cardPrice);
            const pf = options.priceFormat || 'full';
            if (pf === 'abbr') return `Ef. ${cash} · Tj. ${card}`;
            if (pf === 'noLabel') return `${cash} · ${card}`;
            if (pf === 'cash') return cash;
            return `Efectivo ${cash} · Tarjeta ${card}`;
          })(),
          tax: resolvedTaxLegend(product, options),
          social: options.social,
          phone: options.phone || '',
          stock: `Stock ${product.qty}`,
          customText: options.customText || ''
        };
        drawFittedText(ctx, values[key], element, scale, ['business','name','price'].includes(key) ? 900 : 600, key === 'code' ? 'monospace' : 'Arial');
      }
    }
    ctx.restore();
    const contentRotation = [90, 180, 270].includes(Number(options.contentRotation))
      ? Number(options.contentRotation) : 0;
    if (contentRotation) {
      const rendered = document.createElement('canvas');
      rendered.width = w;
      rendered.height = h;
      rendered.getContext('2d').drawImage(canvas, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = safeColor(options.bgColor, '#ffffff');
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(contentRotation * Math.PI / 180);
      if (contentRotation === 90 || contentRotation === 270) {
        ctx.drawImage(rendered, -h / 2, -w / 2, h, w);
      } else {
        ctx.drawImage(rendered, -w / 2, -h / 2, w, h);
      }
      ctx.restore();
    }
    return { widthMm, heightMm, baseWidth, baseHeight, layout };
  }

  async function openAdvancedLabelModal(product, initialTemplateId = '', options = {}){
    const editorBusiness = currentBusiness();
    const editorBusinessId = editorBusiness?.id || '';
    if (!editorBusinessId || (product?.businessId && product.businessId !== editorBusinessId)) {
      return toast('El producto no pertenece al negocio activo.', 'err');
    }
    const bizSettings = editorBusiness.settings || {};
    const address = bizSettings.address || '';

    const templates = labelTemplatesForBiz(editorBusinessId);
    const templateOptions = templates.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('');
    const printProfiles = labelProfilesForBiz(editorBusinessId);
    const printProfileOptions = printProfiles.map(profile => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name || 'Perfil de impresión')}</option>`).join('');
    const initialTemplate = templates.find((template) => template.id === initialTemplateId)
      || templates.find((template) => template.isDefault) || null;
	    let activeTemplateId = initialTemplate?.id || '';
	    let printDeviceState = loadPrintDeviceState(editorBusinessId);
	    let activePrintProfileId = printProfiles.some((profile) => profile.id === printDeviceState.selectedProfileId)
	      ? printDeviceState.selectedProfileId : '';
	    let usedPrintSlots = new Set();
	    let smartPrintStep = 1;
	    let editorLayout = normalizedLabelLayout(initialTemplate?.layout);
	    const legacyPaperMap = { 'roll-4x2':'thermal-108', 'roll-small':'thermal-50x30' };
	    const initialPaperType = legacyPaperMap[initialTemplate?.paperType] || initialTemplate?.paperType || 'thermal-60x40';
    if (initialTemplate && !initialTemplate.layout) {
      const legacyOffset = Number(initialTemplate.yOffsetAdj || 0);
      Object.values(editorLayout).forEach((element) => { element.y = Number(element.y || 0) + legacyOffset; });
      editorLayout.name.size *= Number(initialTemplate.nameScale || 1);
      editorLayout.price.size *= Number(initialTemplate.priceScale || 1);
    }

	    showModal(`<div class="modalHeader"><div><h2>Lienzo universal de etiquetas</h2><p class="fieldHint">Diseña con medidas físicas. La vista, el PDF y la impresión comparten un único plan.</p><p id="labelEditorIdentity" class="labelEditorIdentity"></p></div><button class="closeBtn" data-close>×</button></div>
	      <div class="labelWizardRail" aria-label="Progreso del asistente de etiquetas"><div class="labelModeSwitch" role="group" aria-label="Modo del lienzo"><button type="button" class="active" data-label-mode="simple">Modo simple · Lienzo</button><button type="button" data-label-mode="expert">Modo experto · Asistente avanzado</button></div>
	      <div class="smartPrintProgress"><span id="smartPrintStepText">Paso 1 de 9</span><progress id="smartPrintProgress" max="9" value="1">1 de 9</progress></div>
	      <ol class="labelGuideSteps smartPrintSteps"><li class="active" data-smart-step-nav="1"><b>1</b><span>Salida</span></li><li data-smart-step-nav="2"><b>2</b><span>Papel</span></li><li data-smart-step-nav="3"><b>3</b><span>Medidas</span></li><li data-smart-step-nav="4"><b>4</b><span>Contenido</span></li><li data-smart-step-nav="5"><b>5</b><span>Cantidad</span></li><li data-smart-step-nav="6"><b>6</b><span>Inicio</span></li><li data-smart-step-nav="7"><b>7</b><span>Vista</span></li><li data-smart-step-nav="8"><b>8</b><span>Revisión</span></li><li data-smart-step-nav="9"><b>9</b><span>Imprimir</span></li></ol></div>
	      <div class="labelCustomizerLayout">
		        <details class="labelPreviewDisclosure" data-smart-step="7" open><summary>Vista previa del sticker · Lienzo</summary><div class="labelPreviewSticky"><canvas id="labelPreviewCanvas" tabindex="0" role="application" aria-label="Lienzo visual de etiqueta. Usa las flechas para mover el elemento seleccionado y las teclas más o menos para cambiar su tamaño."></canvas><div class="labelCanvasActions" role="toolbar" aria-label="Acciones del lienzo"><button type="button" class="btn" id="labelCanvasUndo" title="Deshacer">${icon('undo-2')}</button><button type="button" class="btn" id="labelCanvasRedo" title="Rehacer">${icon('redo-2')}</button><button type="button" class="btn" id="labelCanvasDuplicate">${icon('copy')} Duplicar</button><button type="button" class="btn" id="labelCanvasRotate">${icon('rotate-cw')} Rotar</button><button type="button" class="btn" id="labelCanvasAlign">${icon('align-center')} Alinear</button></div><button type="button" class="btn" id="labelPreviewLarge">${icon('maximize-2')} Ver grande</button></div></details>
	        <div class="labelControls">
	          <section class="smartPrintPanel" data-smart-step="1"><h3>¿Cómo vas a imprimir?</h3><div class="smartChoiceGrid" role="radiogroup" aria-label="Salida de impresión"><label><input type="radio" name="smartPrintOutput" value="system" checked><span>${icon('printer')}<b>Imprimir ahora</b><small>Abre el diálogo de tu dispositivo para elegir impresora y copias.</small></span></label><label><input type="radio" name="smartPrintOutput" value="pdf"><span>${icon('file-down')}<b>Guardar un PDF</b><small>Crea un archivo independiente, sin abrir la impresora.</small></span></label><label><input type="radio" name="smartPrintOutput" value="certified" ${printProfiles.some(profile => profile.status === 'certified') ? '' : 'disabled'}><span>${icon('badge-check')}<b>Perfil certificado por CLICK</b><small>${printProfiles.some(profile => profile.status === 'certified') ? 'Selecciona un perfil certificado.' : 'Todavía no hay perfiles certificados.'}</small></span></label><label><input type="radio" name="smartPrintOutput" value="custom"><span>${icon('settings-2')}<b>Configurar otro formato</b><small>Usa medidas personalizadas.</small></span></label></div><p class="wizardHelp">Imprimir y Guardar PDF son acciones independientes. CLICK no instala drivers ni selecciona la impresora por ti.</p></section>
		          <div class="field" data-smart-step="1"><label for="labelProfileSelect">Perfil reutilizable</label><select id="labelProfileSelect"><option value="">Configuración nueva</option>${printProfileOptions}</select></div>
		          <div class="field" data-smart-step="1"><label for="applyTemplateSelect">Diseño guardado</label><select id="applyTemplateSelect"><option value="">Nueva plantilla</option>${templateOptions}</select></div>
		          <section class="smartPrintPanel" data-smart-step="2"><h3>¿Qué tipo de papel tienes?</h3><div class="smartMediaGrid"><button type="button" data-smart-paper="thermal-60x40">${icon('rectangle-horizontal')}<b>Rollo · 1 columna</b></button><button type="button" data-smart-paper="roll-2-custom">${icon('columns-2')}<b>Rollo · 2 columnas</b></button><button type="button" data-smart-paper="roll-3-custom">${icon('columns-3')}<b>Rollo · 3 columnas</b></button><button type="button" data-smart-paper="sheet-2">${icon('file-spreadsheet')}<b>Hoja con stickers</b></button><button type="button" data-smart-paper="round-50">${icon('circle')}<b>Redondas</b></button><button type="button" data-smart-paper="square-50">${icon('square')}<b>Cuadradas</b></button><button type="button" data-smart-paper="ticket-80">${icon('receipt')}<b>Ticket térmico</b></button><button type="button" data-smart-paper="continuous">${icon('scroll-text')}<b>Papel continuo</b></button><button type="button" data-smart-paper="unsure">${icon('circle-help')}<b>No estoy seguro</b></button><button type="button" data-smart-paper="custom">${icon('ruler')}<b>Personalizado</b></button></div><p id="smartPaperHint" class="wizardHelp">Elige el dibujo que más se parece a tu material.</p></section>
	          <section class="labelPresetPanel" data-smart-step="4"><h3>¿Qué quieres mostrar?</h3><div class="labelPresetGrid"><button type="button" data-label-preset="qr">Solo QR</button><button type="button" data-label-preset="qr-name">QR + nombre</button><button type="button" data-label-preset="qr-price">QR + nombre + precio</button><button type="button" data-label-preset="barcode-price">Código de barras + precio</button><button type="button" data-label-preset="name-price-sku">Nombre + precio + SKU</button><button type="button" data-label-preset="compact">Completa compacta</button><button type="button" data-label-preset="custom">Personalizada segura</button></div>${product.cardPrice && product.cardPrice !== product.price ? `<div class="field" style="margin-top:10px"><label for="labelPriceFormat">Formato del precio con tarjeta</label><select id="labelPriceFormat"><option value="full">Efectivo $X · Tarjeta $Y</option><option value="abbr">Ef. $X · Tj. $Y (abreviado)</option><option value="noLabel">$X · $Y (sin etiqueta)</option><option value="cash">Solo efectivo</option></select></div>` : ''}<label class="consentCheck"><input type="checkbox" id="labelShowUrl"><span>Mostrar también el contenido del QR como texto</span></label></section>
	          <section class="labelElementPanel expertOnly">
		            <div class="field"><label for="labelElementSelect">Elemento seleccionado</label><select id="labelElementSelect"><option value="qr">QR</option><option value="barcode">Código de barras</option><option value="business">Negocio</option><option value="address">Dirección</option><option value="name">Nombre</option><option value="price">Precio</option><option value="tax">IVA</option><option value="phone">Teléfono</option><option value="social">Red social</option><option value="code">Código</option><option value="logo">Logo</option><option value="image">Imagen</option><option value="variant">Variante</option><option value="stock">Stock</option><option value="customText">Texto</option></select></div>
	            <div class="labelQuickControls"><button type="button" id="labelSizeDown" title="Reducir">${icon('minus')}</button><button type="button" id="labelSizeUp" title="Aumentar">${icon('plus')}</button><button type="button" id="labelCenter" title="Centrar">${icon('align-center')}<span>Centrar</span></button><button type="button" id="labelToggleVisibility" title="Mostrar u ocultar">${icon('eye')}<span>Ocultar</span></button><button type="button" id="labelToggleLock" title="Bloquear posición">${icon('lock-open')}<span>Bloquear</span></button><button type="button" id="labelResetElement" title="Restablecer elemento">${icon('rotate-ccw')}<span>Restablecer</span></button></div>
	            <p id="labelQrWarning" class="fieldHint"></p>
	          </section>
	          <div class="formGrid expertOnly"><div class="field"><label>IVA visible</label><select id="labelTaxDisplay"><option value="inherit">Usar configuración de IVA del producto</option><option value="included">Incluye IVA</option><option value="excluded">No incluye IVA</option><option value="exempt">Exento de IVA</option><option value="hidden">No mostrar</option></select></div><div class="field"><label>Red social / contacto</label><input id="labelSocial" placeholder="Ej. @click360" value="${escapeHtml(initialTemplate?.social || '')}"></div><div class="field full"><label>Dirección del local</label><input id="labelAddress" placeholder="Dirección para la etiqueta" value="${escapeHtml(initialTemplate?.address || address)}"></div><div class="field full"><label>Texto libre (hasta 2 líneas)</label><textarea id="labelCustomText" maxlength="160" rows="2" style="min-height:66px;resize:vertical">${escapeHtml(initialTemplate?.customText || '')}</textarea></div></div>
	          <details class="settingsDisclosure labelAdvanced expertOnly"><summary>Ajustes avanzados</summary><div class="labelAdvancedBody">
	            <div class="labelColorGrid"><div class="field"><label>Fondo etiqueta</label><input type="color" id="labelBgColor" value="${safeColor(initialTemplate?.bgColor, '#ffffff')}"></div><div class="field"><label>Fondo QR</label><input type="color" id="qrBgColor" value="${safeColor(initialTemplate?.qrBgColor || initialTemplate?.bgColor, '#ffffff')}"></div><div class="field"><label>Texto / QR</label><input type="color" id="labelFgColor" value="${safeColor(initialTemplate?.fgColor, '#000000')}"></div></div>
	            <div class="formGrid labelSizeGrid"><div class="field"><label>Margen QR</label><input type="number" min="2" max="12" id="labelQrMargin" value="${numericInputValue(initialTemplate?.qrMargin || 5)}"></div><label class="consentCheck"><input type="checkbox" id="labelSnap" checked><span>Ajustar a cuadrícula</span></label></div>
	            <div class="formGrid"><div class="field"><label>X</label><input id="labelElementX" type="number"></div><div class="field"><label>Y</label><input id="labelElementY" type="number"></div><div class="field"><label>Ancho</label><input id="labelElementWidth" type="number" min="8"></div><div class="field"><label>Alto / tamaño</label><input id="labelElementHeight" type="number" min="6"></div></div>
	            <div class="labelElementToggles"><label><input type="checkbox" id="labelElementVisible"> Visible</label><label><input type="checkbox" id="labelElementLocked"> Bloqueado</label></div>
	            <div class="labelLayerButtons"><button type="button" class="btn" id="labelLayerDown">Enviar atrás</button><button type="button" class="btn" id="labelLayerUp">Traer al frente</button></div>
	            <div class="field"><label>Mover textos <span id="yOffsetVal">0px</span></label><input type="range" id="labelYOffset" min="-50" max="50" value="0"></div><div class="formGrid"><div class="field"><label>Tamaño nombre <span id="nameScaleVal">1.0x</span></label><input type="range" id="labelNameScale" min="0.6" max="1.4" step="0.1" value="1.0"></div><div class="field"><label>Tamaño precio <span id="priceScaleVal">1.0x</span></label><input type="range" id="labelPriceScale" min="0.6" max="1.4" step="0.1" value="1.0"></div></div>
	          </div></details>
	          <section class="labelPrintContract" data-smart-step="5"><h3>¿Cuántas etiquetas necesitas?</h3><div class="field"><label>Cantidad exacta</label><input type="number" id="labelCopies" min="1" max="500" step="1" inputmode="numeric" value="1"></div><label class="consentCheck"><input type="checkbox" id="labelUseStock"><span>Imprimir una etiqueta por cada unidad en stock (${product.qty})</span></label><p id="labelQuantitySummary" class="fieldHint">Se imprimirá 1 etiqueta. El stock no cambia esta cantidad.</p></section>
	          <details class="settingsDisclosure" data-smart-step="3" open><summary>Medidas del sticker y del soporte</summary><div class="labelAdvancedBody"><div class="formGrid"><div class="field full"><label>Perfil de papel</label><select id="labelPaperType">${labelPaperOptions(initialPaperType)}</select></div><div class="field"><label>Ancho de cada sticker (mm)</label><input type="number" min="10" max="250" step="0.1" id="labelWidthMm" value="${numericInputValue(initialTemplate?.widthMm || 60)}"></div><div class="field"><label>Alto de cada sticker (mm)</label><input type="number" min="10" max="400" step="0.1" id="labelHeightMm" value="${numericInputValue(initialTemplate?.heightMm || 40)}"></div><div class="field"><label>Ancho total del rollo/hoja (mm)</label><input id="labelMediaWidth" type="number" min="0" max="1000" step="0.1" value="${numericInputValue(initialTemplate?.mediaWidthMm || 0)}"></div><div class="field"><label>Alto total de hoja/tramo (mm)</label><input id="labelMediaHeight" type="number" min="0" max="2000" step="0.1" value="${numericInputValue(initialTemplate?.mediaHeightMm || 0)}"></div><div class="field"><label>Columnas</label><input id="labelColumns" type="number" min="1" max="6" step="1" value="${numericInputValue(initialTemplate?.columns || 1)}"></div><div class="field"><label>Filas por hoja/tramo</label><input id="labelRows" type="number" min="1" max="20" step="1" value="${numericInputValue(initialTemplate?.rows || 1)}"></div><div class="field"><label>Separación horizontal (mm)</label><input id="labelGapX" type="number" min="0" max="100" step="0.1" value="${numericInputValue(initialTemplate?.gapXmm ?? 0)}"></div><div class="field"><label>Separación vertical / gap (mm)</label><input id="labelGapY" type="number" min="0" max="100" step="0.1" value="${numericInputValue(initialTemplate?.gapYmm ?? 0)}"></div></div><label class="consentCheck"><input type="checkbox" id="labelMeasurementsConfirmed"><span>Confirmé estas medidas con el material físico</span></label><p id="smartMeasurementHint" class="wizardHelp">Sticker individual y soporte completo son medidas distintas.</p><div class="formGrid expertOnly"><div class="field"><label>Margen superior (mm)</label><input id="labelMarginTop" type="number" min="0" max="200" step="0.1" value="${numericInputValue(initialTemplate?.marginTopMm || 0)}"></div><div class="field"><label>Margen derecho (mm)</label><input id="labelMarginRight" type="number" min="0" max="200" step="0.1" value="${numericInputValue(initialTemplate?.marginRightMm || 0)}"></div><div class="field"><label>Margen inferior (mm)</label><input id="labelMarginBottom" type="number" min="0" max="200" step="0.1" value="${numericInputValue(initialTemplate?.marginBottomMm || 0)}"></div><div class="field"><label>Margen izquierdo (mm)</label><input id="labelMarginLeft" type="number" min="0" max="200" step="0.1" value="${numericInputValue(initialTemplate?.marginLeftMm || 0)}"></div><div class="field"><label>Forma física</label><select id="labelShape"><option value="rounded" ${!['square','circle'].includes(initialTemplate?.shape) ? 'selected' : ''}>Rectangular redondeada</option><option value="square" ${initialTemplate?.shape === 'square' ? 'selected' : ''}>Rectangular / cuadrada</option><option value="circle" ${initialTemplate?.shape === 'circle' ? 'selected' : ''}>Circular</option></select></div><div class="field"><label>Rotación del contenido</label><select id="labelContentRotation"><option value="0">0°</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></div><div class="field"><label>DPI nominal (referencia del driver)</label><select id="labelDpi"><option value="203" ${Number(initialTemplate?.dpi || 203) === 203 ? 'selected' : ''}>203 DPI</option><option value="300" ${Number(initialTemplate?.dpi) === 300 ? 'selected' : ''}>300 DPI</option><option value="600" ${Number(initialTemplate?.dpi) === 600 ? 'selected' : ''}>600 DPI</option></select></div></div><label class="consentCheck expertOnly"><input type="checkbox" id="labelShowBarcode" ${initialTemplate?.showBarcode === false ? '' : 'checked'}><span>Mostrar código de barras cuando sea compatible</span></label></div></details>
	          <section class="smartPrintPanel" data-smart-step="6"><h3>¿Desde dónde quieres empezar?</h3><div class="formGrid"><div class="field"><label>Primera casilla</label><input id="labelStartSlot" type="number" min="1" max="120" step="1" value="1"></div><div class="field"><label>Acceso rápido</label><select id="labelStartPreset"><option value="first">Primera disponible</option><option value="left">Columna izquierda</option><option value="right">Columna derecha</option><option value="custom">Casilla específica</option></select></div></div><p class="wizardHelp">Toca casillas para marcarlas como ya usadas. Se mostrarán en gris y CLICK no imprimirá sobre ellas.</p><div id="labelStartGrid" class="labelStartGrid" aria-label="Selector de casilla inicial"></div></section>
	          <section class="labelSheetPreviewPanel" data-smart-step="7"><div><h3>Así quedará tu papel completo</h3><p id="labelValidationSummary" class="fieldHint"></p><p id="labelPhysicalSummary" class="fieldHint"></p></div><div id="labelSheetPreview" class="labelSheetPreview" aria-label="Distribución física de etiquetas"></div></section>
	          <section class="smartPrintPanel smartPreflight" data-smart-step="8"><h3>Revisión antes de imprimir</h3><div id="labelPreflightList" class="smartPreflightList" role="status" aria-live="polite"></div><div class="labelPrimaryActions"><button type="button" class="btn" id="labelAutoCorrect">${icon('wand-sparkles')} Corregir automáticamente</button><button type="button" class="btn" id="labelUseCompact">${icon('layout-template')} Usar diseño compacto</button><button type="button" class="btn" id="copyPrintDiagnostic">${icon('clipboard-copy')} Copiar diagnóstico</button></div></section>
	          <section class="smartPrintPanel" data-smart-step="9"><h3>Todo listo para imprimir</h3><div class="systemPrintChecklist"><b>Elige una acción:</b><p><strong>Imprimir etiquetas</strong> abre el diálogo de la impresora. <strong>Guardar PDF</strong> descarga un archivo y no intenta imprimir.</p><details><summary>Ajustes del diálogo de impresión</summary><ul><li>Copias: 1</li><li>Escala: 100 % o Tamaño real</li><li>Páginas por hoja: 1</li><li>Márgenes: ninguno</li><li>Encabezados y pies: desactivados</li><li>Ajustar a página: desactivado</li></ul><p>Para rollos: Térmica directa · Etiquetas con espacios/Gap · DPI y tamaño personalizado correctos.</p></details></div><div class="labelPrimaryActions labelOutputActions"><button type="button" class="btn primary" id="printOne">${icon('printer')} Imprimir etiquetas</button><button type="button" class="btn" id="savePdfBtn">${icon('file-down')} Guardar PDF</button><button type="button" class="btn" id="saveTemplateFromPrintBtn">${icon('save')} Guardar diseño</button><button type="button" class="btn" id="savePrintProfileBtn">${icon('save')} Guardar perfil</button><button type="button" class="btn" id="labelAlignmentTest">${icon('ruler')} Imprimir prueba de alineación</button><button type="button" class="btn" id="openCalibrationBtn">${icon('crosshair')} Calibrar X/Y</button></div><section id="labelCalibrationPanel" class="labelCalibrationPanel" hidden><h4>Calibración guiada X/Y</h4><p>Imprime la cuadrícula y toca el número que quedó mejor centrado. CLICK guardará el ajuste solo en este dispositivo y negocio.</p><div class="formGrid"><div class="field"><label>Ajuste X actual (mm)</label><input id="labelXOffset" value="0" readonly></div><div class="field"><label>Ajuste Y actual (mm)</label><input id="labelYOffsetMm" value="0" readonly></div></div><div id="labelCalibrationGrid" class="labelCalibrationGrid" aria-label="Casilla centrada"></div><p id="labelCalibrationStatus" class="fieldHint">Estado provisional hasta comprobar una prueba física.</p><div class="labelPrimaryActions"><button type="button" class="btn" id="resetCalibrationBtn">${icon('rotate-ccw')} Restablecer calibración</button><button type="button" class="btn" id="repeatCalibrationBtn">${icon('repeat-2')} Repetir prueba</button></div></section><div class="labelPrimaryActions expertOnly"><button type="button" class="btn" id="duplicatePrintProfileBtn">${icon('copy')} Duplicar perfil</button><button type="button" class="btn danger" id="deletePrintProfileBtn">${icon('trash-2')} Eliminar perfil</button></div></section>
	          <div class="labelPrimaryActions expertOnly"><button type="button" class="btn" id="saveTemplateBtn">${icon('save')} Guardar diseño</button><button type="button" class="btn" id="saveTemplateAsNewBtn">${icon('copy-plus')} Guardar como nuevo</button><button type="button" class="btn" id="duplicateTemplateBtn">${icon('copy')} Duplicar</button><button type="button" class="btn danger" id="deleteTemplateBtn" ${activeTemplateId ? '' : 'disabled'}>${icon('trash-2')} Eliminar</button><button type="button" class="btn" id="labelResetAll">${icon('rotate-ccw')} Restablecer</button></div>
	          <details class="settingsDisclosure expertOnly"><summary>Más opciones de impresión</summary><div class="labelPrimaryActions"><button type="button" class="btn" id="downloadLabelPng">${icon('image-down')} Descargar PNG</button><button type="button" class="btn" id="printAll">${icon('notebook-tabs')} Imprimir catálogo</button><button type="button" class="btn" id="copyLabelCode">${icon('copy')} Copiar ${escapeHtml(product.code)}</button></div></details>
	        </div>
	      </div>
	      <footer class="smartWizardFooter"><button type="button" class="btn" id="smartPrintBack">${icon('arrow-left')} Atrás</button><button type="button" class="btn" id="smartPrintHelp">${icon('circle-help')} Ayuda de este paso</button><button type="button" class="btn primary" id="smartPrintNext">Continuar ${icon('arrow-right')}</button></footer>`);

    $('#modalRoot .modal')?.classList.add('labelEditorModal');
	    const labelEditorModal = $('#modalRoot .labelEditorModal');
	    labelEditorModal.dataset.labelMode = 'simple';
	    let latestSmartPreflight = null;
	    let runPrintJob = async () => null;
	    const editorBusinessIsActive = () => currentBusiness()?.id === editorBusinessId;
	    const updateLabelEditorIdentity = () => {
	      const template = labelTemplatesForBiz(editorBusinessId).find((item) => item.id === activeTemplateId);
	      const productName = String(product?.name || product?.code || 'Producto').trim();
	      $('#labelEditorIdentity').textContent = `Etiqueta: ${productName} · Diseño: ${template?.name || 'Configuración nueva'}`;
	    };
	    updateLabelEditorIdentity();
    const smartStepHelp = {
      1:'Imprimir abre el diálogo del sistema. Guardar PDF crea un archivo separado; ninguna acción sustituye a la otra.',
      2:'Cuenta cuántos stickers aparecen lado a lado en una fila.',
      3:'Mide por separado un sticker y el ancho total del soporte.',
      4:'La URL queda oculta porque el QR ya contiene el enlace.',
      5:'Cantidad exacta nunca se reemplaza por stock sin activar la opción.',
      6:'Marca las casillas ya usadas para no desperdiciar material.',
      7:'La vista usa la misma geometría que la salida imprimible.',
      8:'Los errores rojos deben corregirse; las advertencias explican el driver.',
      9:'Imprimir etiquetas abre la impresora. Guardar PDF descarga el mismo diseño físico como archivo.'
    };
	    const scrollSmartPanelIntoView = (targetPanel) => {
	      if (!targetPanel) return;
	      const controls = targetPanel.closest('.labelControls');
	      if (!controls) return;
	      requestAnimationFrame(() => {
	        const panelBox = targetPanel.getBoundingClientRect();
	        const controlsBox = controls.getBoundingClientRect();
	        const nextTop = controls.scrollTop + panelBox.top - controlsBox.top - 8;
	        controls.scrollTo({ top: Math.max(0, nextTop), behavior:'smooth' });
	      });
	    };
	    const showSmartPrintStep = (requestedStep) => {
	      smartPrintStep = Math.max(1, Math.min(9, Number(requestedStep) || 1));
	      const simple = labelEditorModal.dataset.labelMode === 'simple';
	      labelEditorModal.dataset.smartStepCurrent = String(smartPrintStep);
	      const previewDisclosure = labelEditorModal.querySelector('.labelPreviewDisclosure');
	      if (previewDisclosure) {
	        previewDisclosure.dataset.previewMode = smartPrintStep === 7 ? 'full' : 'compact';
	        previewDisclosure.open = true;
	      }
	      $$('[data-smart-step]', labelEditorModal).forEach((panel) => {
	        panel.hidden = simple && Number(panel.dataset.smartStep) !== smartPrintStep && !panel.classList.contains('labelPreviewDisclosure');
	      });
      $$('[data-smart-step-nav]', labelEditorModal).forEach((item) => {
        const step = Number(item.dataset.smartStepNav);
        item.classList.toggle('active', step === smartPrintStep);
        item.classList.toggle('complete', step < smartPrintStep);
        item.setAttribute('aria-current', step === smartPrintStep ? 'step' : 'false');
      });
      $('#smartPrintStepText').textContent = `Paso ${smartPrintStep} de 9`;
      $('#smartPrintProgress').value = smartPrintStep;
      $('#smartPrintBack').disabled = smartPrintStep === 1;
	      $('#smartPrintNext').hidden = !simple;
	      $('#smartPrintNext').innerHTML = smartPrintStep === 9
		        ? `Imprimir etiquetas ${icon('printer')}`
	        : `Continuar ${icon('arrow-right')}`;
	      const targetPanel = labelEditorModal.querySelector(`.labelControls [data-smart-step="${smartPrintStep}"]`);
	      if (smartPrintStep !== 7) scrollSmartPanelIntoView(targetPanel);
	    };
    $$('[data-label-mode]', labelEditorModal).forEach((button) => button.onclick = () => {
      labelEditorModal.dataset.labelMode = button.dataset.labelMode;
      $$('[data-label-mode]', labelEditorModal).forEach((candidate) => candidate.classList.toggle('active', candidate === button));
      showSmartPrintStep(smartPrintStep);
    });
    $$('[data-smart-step-nav]', labelEditorModal).forEach((item) => {
      item.tabIndex = 0;
      item.onclick = () => showSmartPrintStep(Number(item.dataset.smartStepNav));
      item.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); item.click(); } };
    });
    $('#smartPrintBack').onclick = () => showSmartPrintStep(smartPrintStep - 1);
    $('#smartPrintNext').onclick = () => {
      if (smartPrintStep === 3 && latestSmartPreflight?.paper && latestSmartPreflight.paper.valid === false) {
        return toast(latestSmartPreflight.paper.errors[0], 'err');
      }
      if (smartPrintStep === 5 && latestSmartPreflight?.quantity?.valid === false) {
        return toast(latestSmartPreflight.quantity.error, 'err');
      }
      if (smartPrintStep === 8 && latestSmartPreflight?.blocking) {
        return toast('Corrige los errores rojos antes de imprimir.', 'err');
      }
	      if (smartPrintStep === 9) return runPrintJob('system');
	      showSmartPrintStep(smartPrintStep + 1);
	    };
    $('#smartPrintHelp').onclick = () => toast(smartStepHelp[smartPrintStep], 'ok');
    showSmartPrintStep(1);
	    const canvas = $('#labelPreviewCanvas');
	    let canvasHistory = [JSON.stringify(editorLayout)];
	    let canvasHistoryIndex = 0;
	    const rememberCanvasLayout = () => {
	      const snapshot = JSON.stringify(editorLayout);
	      if (canvasHistory[canvasHistoryIndex] === snapshot) return;
	      canvasHistory = canvasHistory.slice(0, canvasHistoryIndex + 1).concat(snapshot).slice(-40);
	      canvasHistoryIndex = canvasHistory.length - 1;
	    };
	    const restoreCanvasLayout = (direction) => {
	      const next = canvasHistoryIndex + direction;
	      if (next < 0 || next >= canvasHistory.length) return;
	      canvasHistoryIndex = next;
	      editorLayout = normalizedLabelLayout(JSON.parse(canvasHistory[canvasHistoryIndex]));
	      syncElementControls();
	      updatePreview();
	    };
	    $('#labelCanvasUndo').onclick = () => restoreCanvasLayout(-1);
	    $('#labelCanvasRedo').onclick = () => restoreCanvasLayout(1);
	    $('#labelCanvasRotate').onclick = () => {
	      const element = editorLayout[elementSelect.value];
	      if (!element || element.locked) return toast('Desbloquea el elemento para rotarlo.', 'err');
	      element.rotation = (Number(element.rotation || 0) + 90) % 360;
	      rememberCanvasLayout(); syncElementControls(); updatePreview();
	    };
	    $('#labelCanvasAlign').onclick = () => {
	      const element = editorLayout[elementSelect.value];
	      if (!element || element.locked) return toast('Desbloquea el elemento para alinearlo.', 'err');
	      const baseWidth = Number(canvas.dataset.baseWidth || 260);
	      element.x = ['qr','barcode','logo','image'].includes(elementSelect.value) ? Math.max(0, (baseWidth - Number(element.width || 0)) / 2) : baseWidth / 2;
	      rememberCanvasLayout(); syncElementControls(); updatePreview();
	    };
	    $('#labelCanvasDuplicate').onclick = () => {
	      const selected = editorLayout[elementSelect.value];
	      if (!selected || selected.locked) return toast('Desbloquea el elemento para duplicarlo.', 'err');
	      editorLayout.customText = { ...selected, x:Number(selected.x || 0) + 10, y:Number(selected.y || 0) + 10, visible:true, locked:false, z:Math.max(...Object.values(editorLayout).map((item) => Number(item.z || 0))) + 1 };
	      $('#labelCustomText').value = $('#labelCustomText').value.trim() || 'Texto duplicado';
	      elementSelect.value = 'customText';
	      rememberCanvasLayout(); syncElementControls(); updatePreview();
	    };
	    $('#applyTemplateSelect').value = activeTemplateId;
	    $('#labelProfileSelect').value = activePrintProfileId;
	    $('#labelTaxDisplay').value = initialTemplate?.taxDisplay || 'inherit';
	    _editorPriceFormat = initialTemplate?.priceFormat || 'full';
    $('#labelYOffset').value = initialTemplate?.layout ? (initialTemplate?.yOffsetAdj || 0) : 0;
	    $('#labelNameScale').value = initialTemplate?.layout ? (initialTemplate?.nameScale || 1) : 1;
	    $('#labelPriceScale').value = initialTemplate?.layout ? (initialTemplate?.priceScale || 1) : 1;

    let _editorPriceFormat = null;
    const getOptions = (extraScale = null) => {
       return {
          scale: extraScale || 2,
          bgColor: safeColor($('#labelBgColor').value, '#ffffff'),
          qrBgColor: safeColor($('#qrBgColor').value, '#ffffff'),
          fgColor: safeColor($('#labelFgColor').value, '#000000'),
          social: $('#labelSocial').value.trim(),
	          address: $('#labelAddress').value.trim(),
	          phone: editorBusiness.settings?.phone || '',
	          businessName:editorBusiness.name,
	          businessLogo:editorBusiness.settings?.logoUrl || '',
	          customText: $('#labelShowUrl')?.checked ? productPayload(product) : $('#labelCustomText').value.trim(),
          taxDisplay: $('#labelTaxDisplay').value,
          qrMargin: Math.max(2, Math.min(12, Number($('#labelQrMargin').value || 5))),
          widthMm: Math.max(10, Math.min(250, Number($('#labelWidthMm').value || 60))),
          heightMm: Math.max(10, Math.min(400, Number($('#labelHeightMm').value || 40))),
          paperType: $('#labelPaperType')?.value || 'roll-4x2',
          mediaType: LABEL_PAPER_PRESETS[$('#labelPaperType')?.value]?.mediaType || ($('#labelColumns')?.value > 1 ? `roll-${Math.min(3, Number($('#labelColumns').value))}` : 'roll-1'),
          mediaWidthMm: Math.max(0, Math.min(1000, Number($('#labelMediaWidth')?.value || 0))),
          mediaHeightMm: Math.max(0, Math.min(2000, Number($('#labelMediaHeight')?.value || 0))),
          columns: Math.max(1, Math.min(6, Number($('#labelColumns')?.value || 1))),
          rows: Math.max(1, Math.min(20, Number($('#labelRows')?.value || 1))),
          marginTopMm: Math.max(0, Math.min(200, Number($('#labelMarginTop')?.value || 0))),
          marginRightMm: Math.max(0, Math.min(200, Number($('#labelMarginRight')?.value || 0))),
          marginBottomMm: Math.max(0, Math.min(200, Number($('#labelMarginBottom')?.value || 0))),
          marginLeftMm: Math.max(0, Math.min(200, Number($('#labelMarginLeft')?.value || 0))),
          gapXmm: Math.max(0, Math.min(100, Number($('#labelGapX')?.value || 0))),
          gapYmm: Math.max(0, Math.min(100, Number($('#labelGapY')?.value || 0))),
          dpi: [203,300,600].includes(Number($('#labelDpi')?.value)) ? Number($('#labelDpi').value) : 203,
	          contentRotation: [0,90,180,270].includes(Number($('#labelContentRotation')?.value)) ? Number($('#labelContentRotation').value) : 0,
	          xOffsetMm:Math.max(-10, Math.min(10, Number($('#labelXOffset')?.value || 0))),
	          yOffsetMm:Math.max(-10, Math.min(10, Number($('#labelYOffsetMm')?.value || 0))),
          measurementsConfirmed: $('#labelMeasurementsConfirmed')?.checked === true,
          profileStatus: activePrintProfileId ? (labelProfilesForBiz(editorBusinessId).find(profile => profile.id === activePrintProfileId)?.status || 'provisional') : 'provisional',
          outputMode: $$('input[name="smartPrintOutput"]', labelEditorModal).find(input => input.checked)?.value || 'pdf',
          startSlot: Math.max(1, Number($('#labelStartSlot')?.value || 1)),
          usedSlots: [...usedPrintSlots],
          showUrl: $('#labelShowUrl')?.checked === true,
	          showBarcode: $('#labelShowBarcode')?.checked !== false,
	          shape: ['square','circle'].includes($('#labelShape')?.value) ? $('#labelShape').value : 'rounded',
	          layout: normalizedLabelLayout(editorLayout),
          priceFormat: $('#labelPriceFormat')?.value || _editorPriceFormat || 'full',
          yOffsetAdj: parseFloat($('#labelYOffset').value || '0'),
          nameScale: parseFloat($('#labelNameScale').value || '1.0'),
          priceScale: parseFloat($('#labelPriceScale').value || '1.0'),
          businessId:editorBusinessId
       };
    };

	    const smartPaperFromOptions = (options) => ({
      id:options.paperType,
      businessId:editorBusinessId,
      name:LABEL_PAPER_PRESETS[options.paperType]?.label || 'Perfil personalizado',
      mediaType:options.mediaType,
      labelWidthMm:options.widthMm,
      labelHeightMm:options.heightMm,
      mediaWidthMm:options.mediaWidthMm,
      mediaHeightMm:options.mediaHeightMm,
      columns:options.columns,
      rows:options.rows,
      gapHorizontalMm:options.gapXmm,
      gapVerticalMm:options.gapYmm,
      marginTopMm:options.marginTopMm,
      marginRightMm:options.marginRightMm,
      marginBottomMm:options.marginBottomMm,
      marginLeftMm:options.marginLeftMm,
      shape:options.shape,
      contentRotation:options.contentRotation,
      xOffsetMm:options.xOffsetMm || 0,
      yOffsetMm:options.yOffsetMm || 0,
      nominalDpi:options.dpi,
      status:options.profileStatus,
	      measurementsConfirmed:options.measurementsConfirmed
	    });
	    const calibrationKeyFor = (options) => {
	      const fingerprint = window.CLICK360_SMART_PRINT?.paperGeometryFingerprint(smartPaperFromOptions(options))
	        || `${options.paperType}|${options.widthMm}|${options.heightMm}|${options.columns}|${options.rows}`;
	      return `${activePrintProfileId || options.paperType}:${fingerprint}`.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 120);
	    };
	    const loadCalibrationIntoForm = () => {
	      const options = getOptions();
	      const key = calibrationKeyFor(options);
	      const fingerprint = window.CLICK360_SMART_PRINT?.paperGeometryFingerprint(smartPaperFromOptions(options)) || '';
	      const calibration = printDeviceState.calibrations?.[key];
	      const compatible = calibration && calibration.geometryFingerprint === fingerprint;
	      $('#labelXOffset').value = compatible ? String(calibration.xOffsetMm || 0) : '0';
	      $('#labelYOffsetMm').value = compatible ? String(calibration.yOffsetMm || 0) : '0';
	      $('#labelCalibrationStatus').textContent = compatible
	        ? `Calibración ${calibration.status === 'verified' ? 'verificada' : 'provisional'} en este dispositivo.`
	        : 'Estado provisional hasta comprobar una prueba física.';
	    };
    const updateSheetPreview = () => {
      const options = getOptions();
      const useStock = $('#labelUseStock')?.checked === true;
      const quantity = resolveLabelCopyResult($('#labelCopies')?.value, product.qty, useStock);
      const copies = quantity.count;
      const validation = validateLabelPrintSetup(options, editorLayout, copies);
      const core = window.CLICK360_SMART_PRINT;
      const paper = smartPaperFromOptions(options);
      const paperValidation = core?.validatePaperProfile(paper) || { valid:true, errors:[], warnings:[], paper };
      const sheetPlan = core?.buildSheetPlan([{ product, copies }], paper, { startSlot:options.startSlot, usedSlots:options.usedSlots })
        || buildLabelSheetPlan([{ product, copies }], options);
	      const capacity = Math.max(1, sheetPlan.capacity || options.columns * options.rows);
	      $('#labelStartSlot').max = String(capacity);
	      const preview = $('#labelSheetPreview');
	      preview.style.setProperty('--label-columns', String(options.columns));
	      preview.style.setProperty('--label-aspect', String(options.widthMm / Math.max(1, options.heightMm)));
	      const previewMediaWidth = paperValidation.paper?.mediaWidthMm || paperValidation.requiredWidthMm || options.widthMm;
	      const previewMediaHeight = paperValidation.paper?.mediaHeightMm || paperValidation.requiredHeightMm || options.heightMm;
	      preview.dataset.geometryFingerprint = window.CLICK360_SMART_PRINT?.paperGeometryFingerprint(paper) || '';
	      preview.innerHTML = (sheetPlan.pages || []).map((page) => `<section class="labelPreviewPage" style="--media-aspect:${previewMediaWidth / Math.max(1, previewMediaHeight)}" aria-label="${sheetPlan.mediaType === 'sheet' ? 'Hoja' : 'Tramo'} ${page.index + 1}"><header>${sheetPlan.mediaType === 'sheet' ? 'Hoja' : 'Tramo'} ${page.index + 1}</header><div class="labelPreviewCells">${(page.cells || page.sheetCells || []).map((cell, index) => {
	        const status = cell?.status || (cell ? 'filled' : 'empty');
	        const slot = cell?.slot || index + 1;
	        const isStart = status === 'filled' && !(page.cells || []).slice(0, index).some(candidate => candidate.status === 'filled') && page.index === 0;
	        const left = Number(cell?.xMm ?? options.marginLeftMm) / Math.max(1, previewMediaWidth) * 100;
	        const top = Number(cell?.yMm ?? options.marginTopMm) / Math.max(1, previewMediaHeight) * 100;
	        const width = options.widthMm / Math.max(1, previewMediaWidth) * 100;
	        const height = options.heightMm / Math.max(1, previewMediaHeight) * 100;
	        return `<span class="${status}${isStart ? ' start' : ''}" style="left:${left}%;top:${top}%;width:${width}%;height:${height}%;" title="Casilla ${slot}: ${status === 'filled' ? 'etiqueta' : status === 'used' ? 'ya usada' : 'libre'}">${status === 'filled' ? slot : status === 'used' ? '×' : ''}</span>`;
	      }).join('')}</div></section>`).join('');
      const startGrid = $('#labelStartGrid');
      startGrid.style.setProperty('--label-columns', String(options.columns));
      startGrid.innerHTML = Array.from({ length:capacity }, (_, index) => {
        const slot = index + 1;
        const used = usedPrintSlots.has(slot);
        return `<button type="button" data-used-slot="${slot}" class="${used ? 'used' : ''}" aria-pressed="${used}" title="Casilla ${slot}${used ? ' ya usada' : ''}">${slot}</button>`;
      }).join('');
      $$('[data-used-slot]', startGrid).forEach((button) => {
        button.onclick = () => {
          const slot = Number(button.dataset.usedSlot);
          if (usedPrintSlots.has(slot)) usedPrintSlots.delete(slot);
          else usedPrintSlots.add(slot);
          updateSheetPreview();
        };
      });
      const baseWidth = Math.round(Math.max(10, options.widthMm) * (260 / 60));
      const baseHeight = Math.round(Math.max(10, options.heightMm) * (380 / 88));
      const corePreflight = core?.buildPreflight({
        paper,
        manualQuantity:$('#labelCopies')?.value,
        useStock,
        stock:product.qty,
        elements:editorLayout,
        bounds:{ width:baseWidth, height:baseHeight },
        qrSizeMm:Number(editorLayout.qr?.width || 0) / Math.max(1, baseWidth) * options.widthMm,
        showUrl:options.showUrl,
        visibleUrl:options.showUrl ? productPayload(product) : ''
      });
	      const blocking = !quantity.valid || !paperValidation.valid || sheetPlan.valid === false;
      latestSmartPreflight = {
        blocking,
        quantity,
        paper:paperValidation,
        plan:sheetPlan,
        validation,
        core:corePreflight,
        options
      };
	      const messages = [...paperValidation.errors, ...(sheetPlan.errors || []), ...validation.errors,
	        ...(corePreflight?.errors || []).map((item) => item.message),
	        ...paperValidation.warnings, ...validation.warnings,
	        ...(corePreflight?.warnings || []).map((item) => item.message)];
      $('#labelValidationSummary').textContent = messages.length
        ? messages.join(' ')
        : `${copies} etiqueta${copies === 1 ? '' : 's'} · ${options.columns} columna${options.columns === 1 ? '' : 's'} · ${sheetPlan.pages.length} ${sheetPlan.mediaType === 'sheet' ? 'hoja' : 'tramo'}${sheetPlan.pages.length === 1 ? '' : 's'}.`;
      $('#labelValidationSummary').classList.toggle('validationError', blocking);
      $('#labelPhysicalSummary').textContent = `${options.widthMm} mm ancho × ${options.heightMm} mm alto por sticker · soporte ${options.mediaWidthMm || 'sin confirmar'} mm · rotación ${options.contentRotation}° · inicio casilla ${options.startSlot}.`;
	      const checks = corePreflight?.checks?.length ? corePreflight.checks : [
	        { status:paperValidation.valid ? 'pass' : 'error', message:paperValidation.valid ? 'Perfil de papel válido' : paperValidation.errors[0] },
	        { status:quantity.valid ? 'pass' : 'error', message:quantity.valid ? `Cantidad exacta: ${copies}` : quantity.error },
	        { status:useStock ? 'warning' : 'pass', message:useStock ? `Opción por stock activa: ${copies}` : 'Opción por stock desactivada' },
	        { status:validation.errors.length ? 'error' : 'pass', message:validation.errors[0] || 'Contenido dentro de la zona segura' },
	        { status:validation.warnings.length ? 'warning' : 'pass', message:validation.warnings[0] || 'Sin elementos montados' },
	        { status:'warning', message:'En Windows o Chrome usa escala 100 % y desactiva encabezados y pies' }
	      ];
      $('#labelPreflightList').innerHTML = checks.map((check) => `<div class="${check.status}"><span>${check.status === 'pass' ? '✓' : check.status === 'error' ? '×' : '!'}</span><p>${escapeHtml(check.message || '')}</p></div>`).join('');
      $('#printOne').disabled = copies < 1 || !quantity.valid || !paperValidation.valid || sheetPlan.valid === false;
      $('#savePdfBtn').disabled = copies < 1 || !quantity.valid || !paperValidation.valid || sheetPlan.valid === false;
      return latestSmartPreflight;
    };

	    let previewGeneration = 0;
	    const updatePreview = async () => {
	       const generation = ++previewGeneration;
	       try {
	         const result = await drawLabelOnCanvas(canvas, product, getOptions(2));
	         if (generation !== previewGeneration || !result) return;
	       const selectedKey = $('#labelElementSelect').value;
	       const selected = result.layout[selectedKey];
		       if (selected?.visible !== false && Number(getOptions().contentRotation) === 0) {
	         const bounds = hitBounds(selectedKey, selected);
	         const context = canvas.getContext('2d');
	         const previewScale = canvas.width / Number(canvas.dataset.baseWidth || result.baseWidth || 260);
	         context.save();
	         context.strokeStyle = '#d9a928';
		         context.lineWidth = Math.max(2, previewScale);
		         context.setLineDash([4 * previewScale, 3 * previewScale]);
		         context.strokeRect(bounds.left * previewScale, bounds.top * previewScale, Math.max(1, bounds.right - bounds.left) * previewScale, Math.max(1, bounds.bottom - bounds.top) * previewScale);
		         context.setLineDash([]);
		         context.fillStyle = '#d9a928';
		         context.fillRect(bounds.right * previewScale - 7, bounds.bottom * previewScale - 7, 14, 14);
	         context.restore();
	       }
	       const qr = editorLayout.qr;
       $('#labelQrWarning').textContent = Number(qr.width || 0) < 90 ? 'Aumenta el QR: por debajo de 90 px puede perder legibilidad.' : '';
       updateSheetPreview();
	       } catch (err) {
	         console.warn('updatePreview error:', err);
	       }
    };

    // Auto sync qrBgColor to labelBgColor if they were matching
    let lastBgColor = $('#labelBgColor').value;
    $('#labelBgColor').oninput = () => {
       const currentBg = $('#labelBgColor').value;
       const currentQrBg = $('#qrBgColor').value;
       if (currentQrBg === lastBgColor) {
          $('#qrBgColor').value = currentBg;
       }
       lastBgColor = currentBg;
       updatePreview();
    };

    $('#qrBgColor').oninput = updatePreview;
    $('#labelFgColor').oninput = updatePreview;
    $('#labelSocial').oninput = updatePreview;
    $('#labelAddress').oninput = updatePreview;
	    $('#labelCustomText').oninput = updatePreview;
	    $('#labelTaxDisplay').onchange = updatePreview;
	    $('#labelPriceFormat')?.addEventListener('change', updatePreview);
	    $('#labelQrMargin').oninput = updatePreview;
	    $('#labelWidthMm').oninput = () => { loadCalibrationIntoForm(); updatePreview(); };
	    $('#labelHeightMm').oninput = () => { loadCalibrationIntoForm(); updatePreview(); };
	    $('#labelShowBarcode').onchange = updatePreview;
	    $('#labelShowUrl').onchange = () => {
	      editorLayout.customText.visible = $('#labelShowUrl').checked;
	      updatePreview();
	    };
	    $$('input[name="smartPrintOutput"]', labelEditorModal).forEach((input) => {
	      input.onchange = () => { updateSheetPreview(); showSmartPrintStep(smartPrintStep); };
	    });

    // Wire range inputs
    $('#labelYOffset').oninput = (e) => { $('#yOffsetVal').textContent = e.target.value + 'px'; updatePreview(); };
    $('#labelNameScale').oninput = (e) => { $('#nameScaleVal').textContent = e.target.value + 'x'; updatePreview(); };
    $('#labelPriceScale').oninput = (e) => { $('#priceScaleVal').textContent = e.target.value + 'x'; updatePreview(); };

    const elementSelect = $('#labelElementSelect');
    const syncElementControls = () => {
      const key = elementSelect.value;
      const element = editorLayout[key];
      if (!element) return;
      $('#labelElementVisible').checked = element.visible !== false;
      $('#labelElementLocked').checked = element.locked === true;
      $('#labelElementX').value = Math.round(Number(element.x || 0));
      $('#labelElementY').value = Math.round(Number(element.y || 0));
	      $('#labelElementWidth').value = Math.round(Number(element.width || 20));
	      $('#labelElementHeight').value = Math.round(Number(['qr','barcode','logo','image'].includes(key) ? (element.height || element.width || 20) : (element.size || 10)));
	      $('#labelToggleVisibility span').textContent = element.visible === false ? 'Mostrar' : 'Ocultar';
	      $('#labelToggleLock span').textContent = element.locked === true ? 'Desbloquear' : 'Bloquear';
	    };
    const updateSelectedElement = () => {
      const key = elementSelect.value;
      const element = editorLayout[key];
      if (!element) return;
      element.visible = $('#labelElementVisible').checked;
      element.locked = $('#labelElementLocked').checked;
      element.x = Number($('#labelElementX').value || 0);
      element.y = Number($('#labelElementY').value || 0);
      element.width = Math.max(8, Number($('#labelElementWidth').value || element.width || 20));
      if (['qr','barcode','logo','image'].includes(key)) element.height = Math.max(key === 'qr' ? 90 : 8, Number($('#labelElementHeight').value || element.height || element.width));
      else element.size = Math.max(6, Number($('#labelElementHeight').value || element.size || 10));
      updatePreview();
    };
    elementSelect.onchange = () => { syncElementControls(); updatePreview(); };
    ['labelElementVisible','labelElementLocked','labelElementX','labelElementY','labelElementWidth','labelElementHeight'].forEach((id) => {
      const input = $('#' + id);
      input.oninput = updateSelectedElement;
      input.onchange = updateSelectedElement;
    });
	    $('#labelLayerUp').onclick = () => { editorLayout[elementSelect.value].z = Math.max(...Object.values(editorLayout).map((item) => Number(item.z || 0))) + 1; updatePreview(); };
	    $('#labelLayerDown').onclick = () => { editorLayout[elementSelect.value].z = Math.min(...Object.values(editorLayout).map((item) => Number(item.z || 0))) - 1; updatePreview(); };
	    const resizeSelected = (delta) => {
	      const key = elementSelect.value;
	      const element = editorLayout[key];
	      if (!element || element.locked) return toast('Desbloquea el elemento para cambiarlo.', 'err');
	      if (['qr','barcode','logo','image'].includes(key)) {
	        const minimum = key === 'qr' ? 90 : 20;
	        element.width = Math.max(minimum, Number(element.width || minimum) + delta * 10);
	        element.height = Math.max(minimum, Number(element.height || element.width) + delta * 10);
	        if (key === 'qr') element.width = element.height = Math.max(element.width, element.height);
	      } else element.size = Math.max(6, Number(element.size || 10) + delta);
	      syncElementControls(); updatePreview();
	    };
	    $('#labelSizeDown').onclick = () => resizeSelected(-1);
	    $('#labelSizeUp').onclick = () => resizeSelected(1);
	    $('#labelCenter').onclick = () => {
	      const key = elementSelect.value;
	      const element = editorLayout[key];
	      const baseWidth = Number(canvas.dataset.baseWidth || 260);
	      if (['qr','barcode','logo','image'].includes(key)) element.x = Math.max(0, (baseWidth - Number(element.width || 0)) / 2);
	      else element.x = baseWidth / 2;
	      syncElementControls(); updatePreview();
	    };
	    $('#labelToggleVisibility').onclick = () => { const element = editorLayout[elementSelect.value]; element.visible = element.visible === false; syncElementControls(); updatePreview(); };
	    $('#labelToggleLock').onclick = () => { const element = editorLayout[elementSelect.value]; element.locked = !element.locked; syncElementControls(); updatePreview(); };
	    $('#labelResetElement').onclick = () => { const key = elementSelect.value; editorLayout[key] = { ...defaultLabelLayout()[key] }; syncElementControls(); updatePreview(); };
	    const scaledDefaultLayout = (widthMm, heightMm) => {
	      const scaleX = widthMm / 60;
	      const scaleY = heightMm / 88;
	      const fontScale = Math.min(scaleX, scaleY);
	      const layout = defaultLabelLayout();
	      Object.values(layout).forEach((element) => {
	        element.x *= scaleX; element.y *= scaleY; element.width *= scaleX;
	        if (element.height) element.height *= scaleY;
	        if (element.size) element.size = Math.max(6, element.size * fontScale);
	      });
	      return layout;
	    };
	    const applyPreset = (preset, announce = true) => {
	      const widthMm = Math.max(10, Number($('#labelWidthMm').value || 60));
	      const heightMm = Math.max(10, Number($('#labelHeightMm').value || 40));
	      editorLayout = scaledDefaultLayout(widthMm, heightMm);
	      Object.values(editorLayout).forEach((element) => { element.visible = false; });
	      const visibleByPreset = {
	        qr:['qr'],
	        'qr-name':['qr','name'],
	        'qr-price':['qr','name','price'],
	        'barcode-price':['barcode','price'],
	        'name-price-sku':['name','price','code'],
	        compact:['business','qr','barcode','name','price','code'],
	        custom:['business','qr','name','price','code'],
	        small:['qr','name','price'],
	        medium:['business','qr','name','price','code'],
	        large:['business','address','qr','barcode','name','price','code'],
	        business:['business','address','qr','name','price','code']
	      };
	      (visibleByPreset[preset] || visibleByPreset.custom).forEach((key) => { editorLayout[key].visible = true; });
	      const baseWidth = widthMm * (260 / 60);
	      const baseHeight = heightMm * (380 / 88);
	      if (['qr','qr-name','qr-price'].includes(preset)) {
	        const reserved = preset === 'qr' ? 16 : preset === 'qr-name' ? 55 : 78;
	        const qrSize = Math.max(90, Math.min(baseWidth - 24, baseHeight - reserved));
	        Object.assign(editorLayout.qr, { visible:true, x:(baseWidth - qrSize) / 2, y:10, width:qrSize, height:qrSize });
	        if (preset !== 'qr') Object.assign(editorLayout.name, { visible:true, x:baseWidth / 2, y:qrSize + 30, width:baseWidth - 20, size:14 });
	        if (preset === 'qr-price') Object.assign(editorLayout.price, { visible:true, x:baseWidth / 2, y:qrSize + 52, width:baseWidth - 20, size:17 });
	      }
	      if (preset === 'barcode-price') {
	        Object.assign(editorLayout.barcode, { visible:true, x:14, y:22, width:baseWidth - 28, height:Math.max(28, baseHeight * 0.42) });
	        Object.assign(editorLayout.price, { visible:true, x:baseWidth / 2, y:baseHeight - 18, width:baseWidth - 20, size:17 });
	      }
	      syncElementControls();
	      updatePreview();
	      if (announce) toast('Diseño aplicado');
	    };
	    $$('[data-label-preset]').forEach((button) => { button.onclick = () => applyPreset(button.dataset.labelPreset); });
	    $('#labelResetAll').onclick = () => { editorLayout = normalizedLabelLayout(); $('#labelWidthMm').value = 60; $('#labelHeightMm').value = 88; syncElementControls(); updatePreview(); };
	    $('#labelPreviewLarge').onclick = async () => {
	      await updatePreview();
	      const previewRoot = document.createElement('div');
	      previewRoot.id = 'labelLargePreview';
	      previewRoot.innerHTML = `<div class="modalOverlay show labelLargeOverlay"><div class="labelLargeSheet"><button type="button" class="closeBtn" aria-label="Cerrar">×</button><img src="${canvas.toDataURL('image/png')}" alt="Vista previa grande de la etiqueta QR"></div></div>`;
	      document.body.appendChild(previewRoot);
	      $('.closeBtn', previewRoot).onclick = () => previewRoot.remove();
	    };

    const hitBounds = (key, element) => {
      if (['qr','barcode','logo','image'].includes(key)) return { left: element.x, top: element.y, right: element.x + element.width, bottom: element.y + (element.height || element.width) };
      const half = Number(element.width || 100) / 2;
      return { left: element.x - half, top: element.y - Number(element.size || 10) * 1.3, right: element.x + half, bottom: element.y + 5 };
    };
	    let dragState = null;
	    canvas.style.touchAction = 'none';
	    canvas.addEventListener('keydown', (event) => {
	      const key = elementSelect.value;
	      const element = editorLayout[key];
	      if (!element || element.locked) return;
	      if (event.key === '+' || event.key === '=') {
	        event.preventDefault();
	        resizeSelected(1);
	        return;
	      }
	      if (event.key === '-') {
	        event.preventDefault();
	        resizeSelected(-1);
	        return;
	      }
	      const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
	      if (!direction) return;
	      event.preventDefault();
	      const step = event.shiftKey ? 10 : 2;
	      element.x = Number(element.x || 0) + direction[0] * step;
	      element.y = Number(element.y || 0) + direction[1] * step;
	      syncElementControls();
	      updatePreview();
	    });
	    canvas.addEventListener('pointerdown', (event) => {
      const rect = canvas.getBoundingClientRect();
      const baseWidth = Number(canvas.dataset.baseWidth || 260);
      const baseHeight = Number(canvas.dataset.baseHeight || 380);
      const point = { x: (event.clientX - rect.left) * baseWidth / rect.width, y: (event.clientY - rect.top) * baseHeight / rect.height };
      const hit = Object.entries(editorLayout).filter(([, element]) => element.visible !== false).sort((a, b) => Number(b[1].z || 0) - Number(a[1].z || 0)).find(([key, element]) => {
        const bounds = hitBounds(key, element);
        return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
      });
      if (!hit) return;
	      elementSelect.value = hit[0];
	      syncElementControls();
	      if (hit[1].locked) return toast('Este elemento esta bloqueado.', 'err');
	      const bounds = hitBounds(hit[0], hit[1]);
	      const resize = Math.abs(point.x - bounds.right) <= 14 && Math.abs(point.y - bounds.bottom) <= 14;
	      dragState = {
	        key: hit[0], mode: resize ? 'resize' : 'move', startX: point.x, startY: point.y,
	        x: Number(hit[1].x || 0), y: Number(hit[1].y || 0), width: Number(hit[1].width || 20),
	        height: Number(hit[1].height || hit[1].width || 20), size: Number(hit[1].size || 10)
	      };
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!dragState) return;
      const rect = canvas.getBoundingClientRect();
      const baseWidth = Number(canvas.dataset.baseWidth || 260);
      const baseHeight = Number(canvas.dataset.baseHeight || 380);
	      const point = { x: (event.clientX - rect.left) * baseWidth / rect.width, y: (event.clientY - rect.top) * baseHeight / rect.height };
	      const element = editorLayout[dragState.key];
	      const snap = $('#labelSnap').checked ? 5 : 1;
	      if (dragState.mode === 'resize') {
	        const dx = point.x - dragState.startX;
	        const dy = point.y - dragState.startY;
	        element.width = Math.max(dragState.key === 'qr' ? 90 : 20, Math.round((dragState.width + dx) / snap) * snap);
	        if (['qr','barcode','logo','image'].includes(dragState.key)) {
	          element.height = Math.max(dragState.key === 'qr' ? 90 : 20, Math.round((dragState.height + dy) / snap) * snap);
	          if (dragState.key === 'qr') element.width = element.height = Math.max(element.width, element.height);
	        } else {
	          element.size = Math.max(6, Math.round((dragState.size + dy / 2) / snap) * snap);
	        }
	      } else {
	        element.x = Math.round((dragState.x + point.x - dragState.startX) / snap) * snap;
	        element.y = Math.round((dragState.y + point.y - dragState.startY) / snap) * snap;
	      }
      const bounds = hitBounds(dragState.key, element);
      if (bounds.left < 0) element.x -= bounds.left;
      if (bounds.top < 0) element.y -= bounds.top;
      if (bounds.right > baseWidth) element.x -= bounds.right - baseWidth;
      if (bounds.bottom > baseHeight) element.y -= bounds.bottom - baseHeight;
      syncElementControls();
      updatePreview();
      event.preventDefault();
    });
	    const stopDrag = () => { if (dragState) rememberCanvasLayout(); dragState = null; };
    canvas.addEventListener('pointerup', stopDrag);
    canvas.addEventListener('pointercancel', stopDrag);
    syncElementControls();

    // Apply template logic
	    $('#applyTemplateSelect').onchange = (e) => {
	       const tplId = e.target.value;
	       if (!tplId) { activeTemplateId = ''; $('#deleteTemplateBtn').disabled = true; updateLabelEditorIdentity(); return; }
	       const tpl = labelTemplatesForBiz(editorBusinessId).find(t => t.id === tplId);
	       if (tpl) {
	          activeTemplateId = tpl.id;
	          $('#deleteTemplateBtn').disabled = false;
	          const universalDoc = tpl.universalDocument ? universalDocumentFromTemplate(tpl) : null;
	          const universalPaper = universalDoc?.paper || null;
	          editorLayout = universalDoc ? legacyLayoutFromUniversalDocument(universalDoc) : normalizedLabelLayout(tpl.layout);
	          if (!tpl.layout && !universalDoc) {
	            const legacyOffset = Number(tpl.yOffsetAdj || 0);
	            Object.values(editorLayout).forEach((element) => { element.y = Number(element.y || 0) + legacyOffset; });
	            editorLayout.name.size *= Number(tpl.nameScale || 1);
	            editorLayout.price.size *= Number(tpl.priceScale || 1);
	          }
          $('#labelBgColor').value = safeColor(tpl.bgColor, '#ffffff');
          $('#qrBgColor').value = safeColor(tpl.qrBgColor || tpl.bgColor, '#ffffff');
          $('#labelFgColor').value = safeColor(tpl.fgColor, '#000000');
          $('#labelSocial').value = tpl.social || '';
          $('#labelAddress').value = tpl.address || '';
	          $('#labelYOffset').value = tpl.layout ? (tpl.yOffsetAdj || 0) : 0;
	          $('#labelNameScale').value = tpl.layout ? (tpl.nameScale || 1.0) : 1.0;
	          $('#labelPriceScale').value = tpl.layout ? (tpl.priceScale || 1.0) : 1.0;
          $('#labelWidthMm').value = universalPaper?.widthMm || tpl.widthMm || 60;
          $('#labelHeightMm').value = universalPaper?.heightMm || tpl.heightMm || 88;
	          $('#labelPaperType').value = legacyPaperMap[tpl.paperType] || tpl.paperType || universalPaper?.id || 'thermal-60x40';
	          $('#labelMediaWidth').value = universalPaper?.mediaWidthMm || tpl.mediaWidthMm || 0;
	          $('#labelMediaHeight').value = universalPaper?.mediaHeightMm || tpl.mediaHeightMm || 0;
	          $('#labelColumns').value = universalPaper?.columns || tpl.columns || 1;
	          $('#labelRows').value = universalPaper?.rows || tpl.rows || 1;
	          $('#labelMarginTop').value = universalPaper?.marginTopMm || tpl.marginTopMm || 0;
	          $('#labelMarginRight').value = universalPaper?.marginRightMm || tpl.marginRightMm || 0;
	          $('#labelMarginBottom').value = universalPaper?.marginBottomMm || tpl.marginBottomMm || 0;
	          $('#labelMarginLeft').value = universalPaper?.marginLeftMm || tpl.marginLeftMm || 0;
          $('#labelGapX').value = universalPaper?.gapXmm ?? tpl.gapXmm ?? 2;
          $('#labelGapY').value = universalPaper?.gapYmm ?? tpl.gapYmm ?? 2;
          $('#labelDpi').value = universalPaper?.dpi || tpl.dpi || 203;
	          $('#labelContentRotation').value = [0,90,180,270].includes(Number(tpl.contentRotation)) ? String(tpl.contentRotation) : '0';
	          $('#labelMeasurementsConfirmed').checked = tpl.measurementsConfirmed === true;
	          $('#labelShowUrl').checked = tpl.showUrl === true;
	          editorLayout.customText.visible = tpl.showUrl === true || editorLayout.customText.visible === true;
	          $('#labelShowBarcode').checked = tpl.showBarcode !== false;
	          $('#labelShape').value = ['square','circle'].includes(tpl.shape) ? tpl.shape : 'rounded';
          $('#labelTaxDisplay').value = tpl.taxDisplay || 'inherit';
          $('#labelQrMargin').value = tpl.qrMargin || 5;
          $('#labelCustomText').value = tpl.customText || '';
          _editorPriceFormat = tpl.priceFormat || 'full';
          if ($('#labelPriceFormat')) $('#labelPriceFormat').value = _editorPriceFormat;
          $('#yOffsetVal').textContent = ($('#labelYOffset').value) + 'px';
          $('#nameScaleVal').textContent = ($('#labelNameScale').value) + 'x';
          $('#priceScaleVal').textContent = ($('#labelPriceScale').value) + 'x';
          lastBgColor = $('#labelBgColor').value;
	          syncElementControls();
	          updateLabelEditorIdentity();
	          updatePreview();
       }
    };

	    const refreshTemplateSelect = () => {
		      const updatedTemplates = labelTemplatesForBiz(editorBusinessId);
	      $('#applyTemplateSelect').innerHTML = `<option value="">Nueva plantilla</option>` + updatedTemplates.map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>`).join('');
	      $('#applyTemplateSelect').value = activeTemplateId;
	      $('#deleteTemplateBtn').disabled = !activeTemplateId;
	      updateLabelEditorIdentity();
	    };
	    const persistTemplate = ({ forceNew = false, suggestedName = '', nameOverride = '', silent = false, deferSave = false } = {}) => {
		       if (!editorBusinessIsActive()) {
		         toast('El negocio activo cambió. Reabre el asistente para guardar con seguridad.', 'err');
		         return null;
		       }
		       const existing = forceNew ? null : labelTemplatesForBiz(editorBusinessId).find((template) => template.id === activeTemplateId);
	       const name = nameOverride || prompt('Nombre de la plantilla:', suggestedName || existing?.name || 'Mi Plantilla QR');
		       if (!name?.trim()) return null;
		       const currentOpts = getOptions();
	       const universalDocument = universalDocumentFromTemplate({
	         ...currentOpts,
	         layout:currentOpts.layout,
	         paperType:currentOpts.paperType,
	         quantity:resolveLabelCopyResult($('#labelCopies')?.value, product.qty, $('#labelUseStock')?.checked === true).count,
	         startSlot:currentOpts.startSlot
	       });
		       const tpl = {
          id: existing?.id || uid('tpl'),
          name: name.trim(),
          bgColor: currentOpts.bgColor,
          qrBgColor: currentOpts.qrBgColor,
          fgColor: currentOpts.fgColor,
          social: currentOpts.social,
          address: currentOpts.address,
          customText: currentOpts.customText,
          taxDisplay: currentOpts.taxDisplay,
          qrMargin: currentOpts.qrMargin,
          widthMm: currentOpts.widthMm,
          heightMm: currentOpts.heightMm,
	          paperType: currentOpts.paperType,
	          mediaWidthMm:currentOpts.mediaWidthMm,
	          mediaHeightMm:currentOpts.mediaHeightMm,
	          columns: currentOpts.columns,
	          rows: currentOpts.rows,
	          marginTopMm: currentOpts.marginTopMm,
	          marginRightMm:currentOpts.marginRightMm,
	          marginBottomMm:currentOpts.marginBottomMm,
	          marginLeftMm: currentOpts.marginLeftMm,
          gapXmm: currentOpts.gapXmm,
          gapYmm: currentOpts.gapYmm,
	          dpi: currentOpts.dpi,
	          contentRotation:currentOpts.contentRotation,
	          measurementsConfirmed:currentOpts.measurementsConfirmed,
	          showUrl:currentOpts.showUrl,
	          showBarcode: currentOpts.showBarcode,
		          shape: currentOpts.shape,
		          businessId: editorBusinessId,
          layout: currentOpts.layout,
          universalDocument,
          renderer:'universal-mm-v2',
          yOffsetAdj: currentOpts.yOffsetAdj,
          nameScale: currentOpts.nameScale,
          priceFormat: currentOpts.priceFormat,
          priceScale: currentOpts.priceScale,
          isDefault: existing?.isDefault === true,
          createdAt: existing?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
       };
       state.settings ||= {};
       state.settings.labelTemplates ||= [];
	       const previousTemplates = JSON.parse(JSON.stringify(state.settings.labelTemplates || []));
	       const previousTemplateId = activeTemplateId;
	       const index = state.settings.labelTemplates.findIndex((template) =>
	         template.id === tpl.id && (template.businessId === editorBusinessId
	           || (!template.businessId && state.settings?.legacyDataBusinessId === editorBusinessId)));
       if (index >= 0) state.settings.labelTemplates[index] = tpl;
       else state.settings.labelTemplates.push(tpl);
	       activeTemplateId = tpl.id;
	       addAudit('label_template_saved', { templateId: tpl.id, name: tpl.name, updated: index >= 0 });
	       if (deferSave) {
	         refreshTemplateSelect();
	         refreshInventoryTemplateSection();
	         return tpl;
	       }
	       if(!save()) {
	          state.settings.labelTemplates = previousTemplates;
	          activeTemplateId = previousTemplateId;
	          window.click360RecordTelemetry?.('template_save_failure', { requestId: tpl.id, errorCode: 'local_save_rejected' }).catch?.(() => {});
	          refreshTemplateSelect();
	          refreshInventoryTemplateSection();
	          return null;
	       }
	       if (!silent) toast('Plantilla guardada correctamente', 'ok');
	       refreshTemplateSelect();
	       refreshInventoryTemplateSection();
	       return tpl;
	    };
	    $('#saveTemplateBtn').onclick = () => persistTemplate();
	    $('#saveTemplateFromPrintBtn').onclick = () => persistTemplate({ suggestedName: activeTemplateId ? '' : 'Mi Plantilla QR' });
	    $('#saveTemplateAsNewBtn').onclick = () => persistTemplate({ forceNew: true });
	    $('#duplicateTemplateBtn').onclick = () => {
	      if (!editorBusinessIsActive()) return toast('El negocio activo cambió. Reabre el asistente.', 'err');
	      const current = labelTemplatesForBiz(editorBusinessId).find((template) => template.id === activeTemplateId);
	      persistTemplate({ forceNew: true, suggestedName: `${current?.name || 'Mi Plantilla QR'} - copia` });
	    };
	    $('#deleteTemplateBtn').onclick = () => {
	      if (!editorBusinessIsActive()) return toast('El negocio activo cambió. Reabre el asistente.', 'err');
	      const current = labelTemplatesForBiz(editorBusinessId).find((template) => template.id === activeTemplateId);
	      if (!current || !confirm(`¿Eliminar la plantilla "${current.name}"?`)) return;
	      const businessId = editorBusinessId;
	      const previous = [...(state.settings.labelTemplates || [])];
	      state.settings.labelTemplates = previous.filter((template) =>
	        template.id !== activeTemplateId || !(
	          template.businessId === businessId
	          || (!template.businessId && state.settings?.legacyDataBusinessId === businessId)
	        ));
	      addAudit('label_template_deleted', { templateId: activeTemplateId, name: current.name });
	      activeTemplateId = '';
	      if (!save()) { state.settings.labelTemplates = previous; activeTemplateId = current.id; return toast('No se pudo eliminar la plantilla.', 'err'); }
	      refreshTemplateSelect();
	      refreshInventoryTemplateSection();
	      toast('Plantilla eliminada', 'ok');
	    };

	    const refreshPrintProfileSelect = () => {
	      const profiles = labelProfilesForBiz(editorBusinessId);
	      $('#labelProfileSelect').innerHTML = '<option value="">Configuración nueva</option>'
	        + profiles.map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name || 'Perfil de impresión')}</option>`).join('');
	      $('#labelProfileSelect').value = activePrintProfileId;
	      $('#deletePrintProfileBtn').disabled = !activePrintProfileId;
	      $('#duplicatePrintProfileBtn').disabled = !activePrintProfileId;
	    };
	    const applyPrintProfile = (sourceProfile) => {
	      if (!sourceProfile) return;
	      const profile = window.CLICK360_SMART_PRINT?.normalizePrintProfile(sourceProfile, editorBusinessId) || sourceProfile;
	      if (profile.businessId && profile.businessId !== editorBusinessId) {
	        return toast('Ese perfil pertenece a otro negocio.', 'err');
	      }
	      const paper = profile.paper || {};
	      const design = profile.design || {};
	      activePrintProfileId = profile.id || sourceProfile.id;
	      $('#labelProfileSelect').value = activePrintProfileId;
	      $('#labelPaperType').value = LABEL_PAPER_PRESETS[paper.id] ? paper.id : 'custom';
	      $('#labelWidthMm').value = paper.labelWidthMm || 60;
	      $('#labelHeightMm').value = paper.labelHeightMm || 40;
	      $('#labelMediaWidth').value = paper.mediaWidthMm || 0;
	      $('#labelMediaHeight').value = paper.mediaHeightMm || 0;
	      $('#labelColumns').value = paper.columns || 1;
	      $('#labelRows').value = paper.rows || 1;
	      $('#labelGapX').value = paper.gapHorizontalMm || 0;
	      $('#labelGapY').value = paper.gapVerticalMm || 0;
	      $('#labelMarginTop').value = paper.marginTopMm || 0;
	      $('#labelMarginRight').value = paper.marginRightMm || 0;
	      $('#labelMarginBottom').value = paper.marginBottomMm || 0;
	      $('#labelMarginLeft').value = paper.marginLeftMm || 0;
	      $('#labelShape').value = paper.shape || 'rounded';
	      $('#labelContentRotation').value = String(paper.contentRotation || 0);
	      $('#labelDpi').value = String(paper.nominalDpi || 203);
	      $('#labelMeasurementsConfirmed').checked = paper.measurementsConfirmed === true;
	      $('#labelShowUrl').checked = design.showUrl === true;
	      editorLayout.customText.visible = design.showUrl === true || editorLayout.customText.visible === true;
	      if (design.elements && Object.keys(design.elements).length) editorLayout = normalizedLabelLayout(design.elements);
	      const output = $$('input[name="smartPrintOutput"]', labelEditorModal).find((input) => input.value === profile.outputMode);
	      if (output && !output.disabled) output.checked = true;
	      printDeviceState = savePrintDeviceState({ ...printDeviceState, selectedProfileId:activePrintProfileId }, editorBusinessId);
	      loadCalibrationIntoForm();
	      syncElementControls();
	      updatePreview();
	      refreshPrintProfileSelect();
	      toast(`Perfil ${profile.status === 'certified' ? 'certificado' : profile.status === 'verified' ? 'verificado' : 'provisional'} cargado.`);
	    };
	    $('#labelProfileSelect').onchange = () => {
	      const selectedId = $('#labelProfileSelect').value;
	      if (!selectedId) {
	        activePrintProfileId = '';
	        printDeviceState = savePrintDeviceState({ ...printDeviceState, selectedProfileId:'' }, editorBusinessId);
	        refreshPrintProfileSelect();
	        return updatePreview();
	      }
	      applyPrintProfile(labelProfilesForBiz(editorBusinessId).find((profile) => profile.id === selectedId));
	    };
	    const persistPrintProfile = ({ forceNew = false, suggestedName = '' } = {}) => {
	      if (!editorBusinessIsActive()) return toast('El negocio activo cambió. Reabre el asistente.', 'err');
	      const preflight = updateSheetPreview();
	      if (preflight.blocking) return toast('Corrige los errores rojos antes de guardar el perfil.', 'err');
	      const existing = forceNew ? null : labelProfilesForBiz(editorBusinessId).find((profile) => profile.id === activePrintProfileId);
	      const name = prompt('Nombre del perfil de impresión:', suggestedName || existing?.name || 'Mi papel e impresora');
	      if (!name?.trim()) return null;
	      const options = getOptions();
	      const core = window.CLICK360_SMART_PRINT;
	      const previousTemplates = JSON.parse(JSON.stringify(state.settings?.labelTemplates || []));
	      const previousTemplateId = activeTemplateId;
	      const templateName = activeTemplateId
	        ? (labelTemplatesForBiz(editorBusinessId).find((template) => template.id === activeTemplateId)?.name || `${name.trim()} - diseño`)
	        : `${name.trim()} - diseño`;
	      const templateSnapshot = persistTemplate({
	        forceNew: !activeTemplateId,
	        suggestedName: templateName,
	        nameOverride: templateName,
	        silent: true,
	        deferSave: true
	      });
	      if (!templateSnapshot) {
	        state.settings.labelTemplates = previousTemplates;
	        activeTemplateId = previousTemplateId;
	        refreshTemplateSelect();
	        refreshInventoryTemplateSection();
	        return toast('No se pudo preparar el diseño para este perfil.', 'err');
	      }
	      const profileInput = {
	        id:existing?.id || uid('printprofile'),
	        businessId:editorBusinessId,
	        name:name.trim(),
	        outputMode:options.outputMode,
	        printer:{
	          id:'system-dialog',
	          businessId:editorBusinessId,
	          deviceProfileId:window.click360DebugSyncIdentity?.().deviceId || '',
	          displayName:'Impresora seleccionada en el sistema',
	          connectionType:options.outputMode === 'pdf' ? 'pdf' : 'system',
	          nominalDpi:options.dpi,
	          status:existing?.status === 'certified' ? 'certified' : options.measurementsConfirmed ? 'verified' : 'provisional'
	        },
	        paper:smartPaperFromOptions(options),
	        design:{
	          id:templateSnapshot.id,
	          businessId:editorBusinessId,
	          name:templateSnapshot.name || 'Diseño seguro',
	          layoutPreset:'custom',
	          elements:normalizedLabelLayout(templateSnapshot.layout || editorLayout),
	          universalDocument:templateSnapshot.universalDocument,
	          showUrl:options.showUrl,
	          showPrice:editorLayout.price?.visible !== false,
	          showBusiness:editorLayout.business?.visible !== false,
	          showSku:editorLayout.code?.visible !== false
	        },
	        status:existing?.status === 'certified' ? 'certified' : options.measurementsConfirmed ? 'verified' : 'provisional',
	        createdAt:existing?.createdAt || new Date().toISOString(),
	        updatedAt:new Date().toISOString()
	      };
	      const profile = core?.normalizePrintProfile(profileInput, editorBusinessId) || profileInput;
	      const previous = JSON.parse(JSON.stringify(state.settings?.labelProfiles || []));
	      state.settings ||= {};
	      state.settings.labelProfiles ||= [];
	      const index = state.settings.labelProfiles.findIndex((item) => item.id === profile.id
	        && (item.businessId === editorBusinessId
	          || (!item.businessId && state.settings?.legacyDataBusinessId === editorBusinessId)));
	      if (index >= 0) state.settings.labelProfiles[index] = profile;
	      else state.settings.labelProfiles.push(profile);
	      activePrintProfileId = profile.id;
	      addAudit('label_print_profile_saved', { profileId:profile.id, status:profile.status, updated:index >= 0 });
	      if (!save()) {
	        state.settings.labelProfiles = previous;
	        state.settings.labelTemplates = previousTemplates;
	        activeTemplateId = previousTemplateId;
	        refreshTemplateSelect();
	        refreshInventoryTemplateSection();
	        return toast('No se pudo guardar el perfil. Tus datos anteriores siguen intactos.', 'err');
	      }
	      printDeviceState = savePrintDeviceState({ ...printDeviceState, selectedProfileId:profile.id }, editorBusinessId);
	      refreshTemplateSelect();
	      refreshInventoryTemplateSection();
	      refreshPrintProfileSelect();
	      toast('Perfil de impresión guardado.', 'ok');
	      return profile;
	    };
	    $('#savePrintProfileBtn').onclick = () => persistPrintProfile();
	    $('#duplicatePrintProfileBtn').onclick = () => {
	      const current = labelProfilesForBiz(editorBusinessId).find((profile) => profile.id === activePrintProfileId);
	      persistPrintProfile({ forceNew:true, suggestedName:`${current?.name || 'Perfil'} - copia` });
	    };
	    $('#deletePrintProfileBtn').onclick = () => {
	      if (!editorBusinessIsActive()) return toast('El negocio activo cambió. Reabre el asistente.', 'err');
	      const current = labelProfilesForBiz(editorBusinessId).find((profile) => profile.id === activePrintProfileId);
	      if (!current || !confirm(`¿Eliminar el perfil "${current.name}" de este negocio?`)) return;
	      const previous = JSON.parse(JSON.stringify(state.settings.labelProfiles || []));
	      state.settings.labelProfiles = state.settings.labelProfiles.filter((profile) =>
	        profile.id !== activePrintProfileId || !(
	          profile.businessId === editorBusinessId
	          || (!profile.businessId && state.settings?.legacyDataBusinessId === editorBusinessId)
	        ));
	      addAudit('label_print_profile_deleted', { profileId:activePrintProfileId });
	      if (!save()) {
	        state.settings.labelProfiles = previous;
	        return toast('No se pudo eliminar el perfil.', 'err');
	      }
	      activePrintProfileId = '';
	      printDeviceState = savePrintDeviceState({ ...printDeviceState, selectedProfileId:'' }, editorBusinessId);
	      refreshPrintProfileSelect();
	      updatePreview();
	      toast('Perfil eliminado.');
	    };
	    refreshPrintProfileSelect();

	    updatePreview();

	    const updateQuantitySummary = () => {
	      const useStock = $('#labelUseStock').checked;
		      const result = resolveLabelCopyResult($('#labelCopies').value, product.qty, useStock);
		      const copies = result.count;
	      $('#labelCopies').disabled = useStock;
	      $('#labelQuantitySummary').textContent = useStock
	        ? (copies ? `Se imprimirán ${copies} etiquetas porque activaste la opción por stock.` : 'El producto no tiene stock; no se imprimirá ninguna etiqueta.')
	        : `Se imprimirán ${copies} etiquetas exactas. El stock no cambia esta cantidad.`;
	      updateSheetPreview();
	    };
	    $('#labelCopies').oninput = updateQuantitySummary;
	    $('#labelUseStock').onchange = () => {
	      if ($('#labelUseStock').checked && !confirm(`Activar impresión por stock generará ${Math.max(0, Number(product.qty || 0))} etiqueta(s). ¿Continuar?`)) {
	        $('#labelUseStock').checked = false;
	      }
	      updateQuantitySummary();
	    };
    updateQuantitySummary();

	    const applyPaperType = () => {
	      const preset = LABEL_PAPER_PRESETS[$('#labelPaperType').value];
	      if (!preset?.width) return updateSheetPreview();
	      $('#labelWidthMm').value = preset.width;
	      $('#labelHeightMm').value = preset.height;
	      $('#labelMediaWidth').value = preset.mediaWidth || 0;
	      $('#labelMediaHeight').value = preset.mediaHeight || 0;
	      $('#labelColumns').value = preset.columns;
	      $('#labelRows').value = preset.rows;
	      $('#labelGapX').value = preset.gapX;
	      $('#labelGapY').value = preset.gapY;
	      $('#labelDpi').value = preset.dpi;
	      $('#labelMarginTop').value = preset.marginTop || 0;
	      $('#labelMarginRight').value = preset.marginRight || 0;
	      $('#labelMarginBottom').value = preset.marginBottom || 0;
	      $('#labelMarginLeft').value = preset.marginLeft || 0;
	      $('#labelMeasurementsConfirmed').checked = preset.provisional !== true && preset.requiresMeasurement !== true;
	      $('#smartPaperHint').textContent = preset.provisional
	        ? 'Perfil provisional: confirma ancho total, gaps y medidas antes de imprimir.'
	        : `${preset.label}. Puedes ajustar las medidas si tu material físico difiere.`;
	      if (preset.shape) $('#labelShape').value = preset.shape;
	      const recommendedPreset = preset.height <= 30
	        ? 'qr'
	        : preset.height <= 35
	          ? 'qr-name'
	          : 'qr-price';
	      applyPreset(recommendedPreset, false);
	      loadCalibrationIntoForm();
	      updatePreview();
	    };
		    $('#labelPaperType').onchange = applyPaperType;
		    $('#labelShape').onchange = updatePreview;
		    ['labelColumns','labelRows','labelMediaWidth','labelMediaHeight','labelMarginTop','labelMarginRight','labelMarginBottom','labelMarginLeft','labelGapX','labelGapY','labelDpi','labelContentRotation','labelMeasurementsConfirmed'].forEach((id) => {
		      const input = $('#' + id);
		      input.oninput = () => { loadCalibrationIntoForm(); updatePreview(); };
		      input.onchange = () => { loadCalibrationIntoForm(); updatePreview(); };
		    });
	    $$('[data-smart-paper]', labelEditorModal).forEach((button) => {
	      button.onclick = () => {
	        const paperType = button.dataset.smartPaper;
	        if (!LABEL_PAPER_PRESETS[paperType]) return;
	        $('#labelPaperType').value = paperType;
	        $$('[data-smart-paper]', labelEditorModal).forEach((candidate) => candidate.classList.toggle('active', candidate === button));
	        applyPaperType();
	        showSmartPrintStep(3);
	      };
	    });
	    $('#labelStartSlot').oninput = () => { $('#labelStartPreset').value = 'custom'; updateSheetPreview(); };
	    $('#labelStartPreset').onchange = () => {
	      const columns = Math.max(1, Number($('#labelColumns').value || 1));
	      if ($('#labelStartPreset').value === 'first') {
	        const capacity = columns * Math.max(1, Number($('#labelRows').value || 1));
	        $('#labelStartSlot').value = String(Array.from({ length:capacity }, (_, index) => index + 1).find((slot) => !usedPrintSlots.has(slot)) || 1);
	      } else if ($('#labelStartPreset').value === 'left') {
	        $('#labelStartSlot').value = '1';
	      } else if ($('#labelStartPreset').value === 'right') {
	        $('#labelStartSlot').value = String(columns);
	      }
	      updateSheetPreview();
	    };
		    if (activePrintProfileId) {
		      applyPrintProfile(labelProfilesForBiz(editorBusinessId).find((profile) => profile.id === activePrintProfileId));
		    } else if (!initialTemplate) {
		      applyPaperType();
		    } else {
		      loadCalibrationIntoForm();
		    }
	    $('#labelAutoCorrect').onclick = () => {
	      const options = getOptions();
	      const baseWidth = Math.round(options.widthMm * (260 / 60));
	      const baseHeight = Math.round(options.heightMm * (380 / 88));
	      editorLayout = window.CLICK360_SMART_PRINT?.autoCorrectLayout(editorLayout, { width:baseWidth, height:baseHeight })
	        || editorLayout;
	      syncElementControls();
	      updatePreview();
	      toast('CLICK ajustó el contenido dentro de la zona segura.');
	    };
	    $('#labelUseCompact').onclick = () => applyPreset('compact');
	    $('#copyPrintDiagnostic').onclick = async () => {
	      const options = getOptions();
	      const preflight = updateSheetPreview();
	      const bytes = new Uint8Array(8);
	      if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
	      else bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256); });
	      const diagnosticId = `PRNREP-${[...bytes].map((value) => value.toString(36).padStart(2, '0')).join('').slice(0, 12).toUpperCase()}`;
	      const report = window.CLICK360_SMART_PRINT?.sanitizeDiagnostic({
	        diagnosticId,
	        release:APP_RELEASE_VERSION,
	        buildSha:APP_BUILD_SHA,
	        assetVersion:APP_ASSET_VERSION,
	        browser:navigator.userAgent,
	        operatingSystem:navigator.userAgent,
	        displayMode:window.matchMedia?.('(display-mode: standalone)').matches ? 'standalone' : 'browser',
	        online:navigator.onLine,
	        step:smartPrintStep,
	        outputMode:options.outputMode,
	        printer:{ nominalDpi:options.dpi, status:options.profileStatus },
	        paper:smartPaperFromOptions(options),
	        exactQuantity:preflight.quantity.count,
	        stockMode:preflight.quantity.mode === 'stock',
	        startSlot:options.startSlot,
	        preflightStatus:preflight.blocking ? 'blocked' : (preflight.validation.warnings.length ? 'warning' : 'ready'),
	        quantityValid:preflight.quantity.valid,
	        startSlotValid:preflight.plan.valid !== false,
	        paperValid:preflight.paper.valid,
	        paperIncomplete:options.columns > 1 && !options.mediaWidthMm,
	        layoutOutside:preflight.core?.layout?.outside?.length > 0,
	        layoutCollision:preflight.core?.layout?.collisions?.length > 0,
	        qrUnsafe:preflight.core?.checks?.some((check) => check.code === 'qr-size' && check.status === 'error')
	      });
	      if (!report) return toast('No se pudo preparar el diagnóstico.', 'err');
	      const serialized = JSON.stringify(report, null, 2).slice(0, 12000);
	      await navigator.clipboard?.writeText(serialized).catch(() => null);
	      toast(`Diagnóstico ${report.diagnosticId} copiado sin datos comerciales.`);
	    };

	    const calibrationGrid = window.CLICK360_SMART_PRINT?.buildCalibrationGrid(1) || [];
	    $('#labelCalibrationGrid').innerHTML = calibrationGrid.map((cell) =>
	      `<button type="button" data-calibration-cell="${cell.cell}" title="Ajuste X ${cell.deltaXmm} mm, Y ${cell.deltaYmm} mm">${cell.cell}<small>${cell.deltaXmm >= 0 ? '+' : ''}${cell.deltaXmm} / ${cell.deltaYmm >= 0 ? '+' : ''}${cell.deltaYmm}</small></button>`).join('');
	    const applyCalibrationCell = (cell) => {
	      const options = getOptions();
	      const result = window.CLICK360_SMART_PRINT?.applyCalibrationCell({
	        cell,
	        stepMm:1,
	        currentXOffsetMm:options.xOffsetMm,
	        currentYOffsetMm:options.yOffsetMm
	      });
	      if (!result?.valid) return toast(result?.error || 'No se pudo calcular la calibración.', 'err');
	      const key = calibrationKeyFor(options);
	      const fingerprint = window.CLICK360_SMART_PRINT.paperGeometryFingerprint(smartPaperFromOptions(options));
	      printDeviceState = savePrintDeviceState({
	        ...printDeviceState,
	        selectedProfileId:activePrintProfileId,
	        calibrations:{
	          ...(printDeviceState.calibrations || {}),
	          [key]:{
	            xOffsetMm:result.xOffsetMm,
	            yOffsetMm:result.yOffsetMm,
	            status:result.status,
	            geometryFingerprint:fingerprint,
	            attemptId:uid('cal'),
	            updatedAt:new Date().toISOString()
	          }
	        }
	      }, editorBusinessId);
	      loadCalibrationIntoForm();
	      updatePreview();
	      toast(`Calibración local X ${result.xOffsetMm} mm · Y ${result.yOffsetMm} mm.`);
	    };
	    $$('[data-calibration-cell]', $('#labelCalibrationGrid')).forEach((button) => {
	      button.onclick = () => applyCalibrationCell(Number(button.dataset.calibrationCell));
	    });
	    $('#openCalibrationBtn').onclick = () => {
	      $('#labelCalibrationPanel').hidden = !$('#labelCalibrationPanel').hidden;
	      if (!$('#labelCalibrationPanel').hidden) $('#labelCalibrationGrid button')?.focus();
	    };
	    $('#resetCalibrationBtn').onclick = () => {
	      const key = calibrationKeyFor(getOptions());
	      const calibrations = { ...(printDeviceState.calibrations || {}) };
	      delete calibrations[key];
	      printDeviceState = savePrintDeviceState({ ...printDeviceState, calibrations }, editorBusinessId);
	      loadCalibrationIntoForm();
	      updatePreview();
	      toast('Calibración local restablecida.');
	    };
	    $('#repeatCalibrationBtn').onclick = () => $('#labelAlignmentTest').click();

	    $('#labelAlignmentTest').onclick = () => {
	      const options = getOptions();
	      const paperValidation = window.CLICK360_SMART_PRINT?.validatePaperProfile(smartPaperFromOptions(options));
	      if (!paperValidation?.valid) return toast(paperValidation?.errors?.[0] || 'Revisa las medidas del papel.', 'err');
	      const columns = Math.max(1, options.columns);
	      const calibrationRows = Math.ceil(9 / columns);
	      const mediaWidthMm = options.mediaWidthMm || paperValidation.requiredWidthMm;
	      const mediaHeightMm = options.mediaHeightMm || (
	        options.marginTopMm + options.marginBottomMm
	        + calibrationRows * options.heightMm
	        + Math.max(0, calibrationRows - 1) * options.gapYmm
	      );
	      const cells = calibrationGrid.map((calibration, index) => {
	        const column = index % columns;
	        const row = Math.floor(index / columns);
	        const x = options.marginLeftMm + column * (options.widthMm + options.gapXmm) + options.xOffsetMm;
	        const y = options.marginTopMm + row * (options.heightMm + options.gapYmm) + options.yOffsetMm;
	        return `<div class="alignmentCell" style="position:absolute;left:${x}mm;top:${y}mm;width:${options.widthMm}mm;height:${options.heightMm}mm"><i></i><b>${calibration.cell}</b><span>X ${calibration.deltaXmm >= 0 ? '+' : ''}${calibration.deltaXmm} · Y ${calibration.deltaYmm >= 0 ? '+' : ''}${calibration.deltaYmm}</span><small>CLICK 360 ${APP_RELEASE_VERSION} · ${options.widthMm} × ${options.heightMm} mm</small></div>`;
	      }).join('');
	      handoffPrint({
	        media:'label',
	        mediaWidthMm,
	        mediaHeightMm,
	        filename:'CLICK360_prueba_alineacion.pdf',
	        html:`<section class="alignmentGrid" style="position:relative;width:${mediaWidthMm}mm;height:${mediaHeightMm}mm">${cells}</section>`
	      }, 'system').catch((error) => toast(error.message || 'No se pudo preparar la prueba.', 'err'));
	    };

	    runPrintJob = async (providerId = '') => {
		       if (!editorBusinessIsActive()) return toast('El negocio activo cambió. Reabre el asistente.', 'err');
		       const preflight = updateSheetPreview();
		       if (!preflight.quantity.valid || preflight.quantity.count < 1) return toast(preflight.quantity.error || 'No hay etiquetas para imprimir.', 'err');
		       // Solo errores críticos bloquean. Las advertencias (elementos montados, fuera de zona segura) permiten continuar.
		       const criticalErrors = (preflight.validation?.errors || []).filter(e =>
		         /vacío|inválido|plan|perfil/.test(e.toLowerCase())
		       );
		       if (preflight.plan?.valid === false) return toast(preflight.paper.errors?.[0] || 'El plan de impresión no es válido.', 'err');
		       if (criticalErrors.length > 0) return toast(criticalErrors[0], 'err');
		       if (preflight.blocking) toast((preflight.validation?.warnings || preflight.validation?.errors || [])[0] || 'Advertencia: revisa el diseño antes de imprimir.', 'warn');
		       const options = getOptions();
		       if (options.outputMode === 'certified') {
		         const selected = labelProfilesForBiz(editorBusinessId).find((profile) => profile.id === activePrintProfileId);
		         if (selected?.status !== 'certified') return toast('Selecciona un perfil certificado por CLICK.', 'err');
		       }
		       const outputProvider = providerId || (options.outputMode === 'system' || options.outputMode === 'certified' ? 'system' : 'pdf');
		       return printLabels([{ product, copies:preflight.quantity.count }], options, outputProvider);
		    };
	    $('#printOne').onclick = () => runPrintJob('system');
	    $('#savePdfBtn').onclick = () => runPrintJob('pdf');

        if (options.directPrint) setTimeout(() => runPrintJob(), 150);
        if (options.directPdf) setTimeout(() => runPrintJob('pdf'), 150);

	    $('#printAll').onclick = () => {
	       const preflight = updateSheetPreview();
	       if (preflight.blocking) return toast('Corrige los errores rojos antes de imprimir el catálogo.', 'err');
	       const products = productsForBiz(editorBusinessId);
	       if (!products.length) return toast('No hay productos para imprimir.', 'err');
	       printLabels(products.map((candidate) => ({ product:candidate, copies:1 })), getOptions(), 'system');
	    };

	    $('#downloadLabelPng').onclick = async () => {
	       const preflight = updateSheetPreview();
	       if (preflight.blocking) return toast('Corrige los errores rojos antes de descargar.', 'err');
	       const exportCanvas = document.createElement('canvas');
       const options = getOptions(4);
       await drawLabelOnCanvas(exportCanvas, product, options);
       const a = document.createElement('a');
       a.download = `etiqueta-${slug(product.name)}-${product.code}.png`;
       a.href = exportCanvas.toDataURL('image/png');
       a.click();
       toast('Imagen de etiqueta descargada');
    };

    $('#copyLabelCode').onclick = () => {
       navigator.clipboard?.writeText(product.code);
       toast('Código copiado');
    };
  }
  function universalLabelDocument(template = {}) {
    const canvas = window.CLICK360_UNIVERSAL_LABEL_CANVAS;
    if (!canvas) return null;
    return universalDocumentFromTemplate(template);
  }
  function universalPaperFromTemplate(template = {}) {
    const preset = LABEL_PAPER_PRESETS[template.paperType] || {};
    const paper = template.paper || {};
    const columns = Math.max(1, Number(template.columns ?? paper.columns ?? preset.columns ?? 1));
    return {
      id:template.paperType || paper.id || preset.id || 'custom',
      mediaType:template.mediaType || paper.mediaType || preset.mediaType || (columns > 1 ? `roll-${Math.min(3, columns)}` : 'roll-1'),
      widthMm:Number(template.widthMm ?? paper.widthMm ?? preset.width ?? 60),
      heightMm:Number(template.heightMm ?? paper.heightMm ?? preset.height ?? 40),
      mediaWidthMm:Number(template.mediaWidthMm ?? paper.mediaWidthMm ?? preset.mediaWidth ?? 0),
      mediaHeightMm:Number(template.mediaHeightMm ?? paper.mediaHeightMm ?? preset.mediaHeight ?? 0),
      columns,
      rows:Math.max(1, Number(template.rows ?? paper.rows ?? preset.rows ?? 1)),
      gapXmm:Number(template.gapXmm ?? template.gapHorizontalMm ?? paper.gapXmm ?? preset.gapX ?? 0),
      gapYmm:Number(template.gapYmm ?? template.gapVerticalMm ?? paper.gapYmm ?? preset.gapY ?? 0),
      marginTopMm:Number(template.marginTopMm ?? paper.marginTopMm ?? preset.marginTop ?? 0),
      marginRightMm:Number(template.marginRightMm ?? paper.marginRightMm ?? preset.marginRight ?? 0),
      marginBottomMm:Number(template.marginBottomMm ?? paper.marginBottomMm ?? preset.marginBottom ?? 0),
      marginLeftMm:Number(template.marginLeftMm ?? paper.marginLeftMm ?? preset.marginLeft ?? 0),
      pitchMm:Number(template.pitchMm ?? paper.pitchMm ?? 0),
      xOffsetMm:Number(template.xOffsetMm ?? paper.xOffsetMm ?? 0),
      yOffsetMm:Number(template.yOffsetMm ?? paper.yOffsetMm ?? 0),
      scaleX:Number(template.scaleX ?? paper.scaleX ?? 1),
      scaleY:Number(template.scaleY ?? paper.scaleY ?? 1),
      dpi:Number(template.dpi ?? paper.dpi ?? preset.dpi ?? 203),
      orientation:template.orientation || paper.orientation || 'portrait'
    };
  }
  function universalDocumentFromTemplate(template = {}) {
    const canvas = window.CLICK360_UNIVERSAL_LABEL_CANVAS;
    if (!canvas) return null;
    if (template.universalDocument) return canvas.normalizeDocument(template.universalDocument);
    if (Array.isArray(template.objects) || template.schemaVersion === 2) return canvas.normalizeDocument(template);
    return canvas.normalizeDocument({
      schemaVersion:2,
      paper:universalPaperFromTemplate(template),
      layout:normalizedLabelLayout(template.layout),
      quantity:Math.max(1, Number(template.quantity || template.copies || 1)),
      startSlot:Math.max(1, Number(template.startSlot || 1)),
      gridMm:Number(template.gridMm || 2),
      snap:template.snap !== false
    });
  }
  function legacyLayoutFromUniversalDocument(sourceDocument = {}) {
    const canvas = window.CLICK360_UNIVERSAL_LABEL_CANVAS;
    if (!canvas) return normalizedLabelLayout();
    const documentModel = canvas.normalizeDocument(sourceDocument);
    const paper = documentModel.paper;
    const baseWidth = Math.round(Math.max(10, paper.widthMm) * (260 / 60));
    const baseHeight = Math.round(Math.max(10, paper.heightMm) * (380 / 88));
    const layout = normalizedLabelLayout();
    Object.keys(layout).forEach((key) => { layout[key].visible = false; });
    const keyForType = { qr:'qr', barcode:'barcode', name:'name', price:'price', sku:'code', text:'customText', image:'image' };
    documentModel.objects.forEach((object) => {
      const key = keyForType[object.type];
      if (!key || !layout[key]) return;
      const width = object.widthMm / Math.max(1, paper.widthMm) * baseWidth;
      const height = object.heightMm / Math.max(1, paper.heightMm) * baseHeight;
      const originX = object.xMm / Math.max(1, paper.widthMm) * baseWidth;
      const originY = object.yMm / Math.max(1, paper.heightMm) * baseHeight;
      const isBox = ['qr','barcode','logo','image'].includes(key);
      layout[key] = {
        ...layout[key],
        visible:object.visible !== false,
        locked:object.locked === true,
        rotation:object.rotation || 0,
        z:object.z,
        x:isBox ? originX : originX + width / 2,
        y:isBox ? originY : originY + height,
        width,
        ...(isBox ? { height } : { size:Math.max(6, height / 1.35) })
      };
      if (key === 'customText') layout[key].text = object.text || layout[key].text || '';
    });
    return normalizedLabelLayout(layout);
  }
  function universalMediaSize(document) {
    const paper = document.paper;
    const rowAdvanceMm = paper.pitchMm > paper.heightMm ? paper.pitchMm : paper.heightMm + paper.gapYmm;
    const width = paper.mediaWidthMm || paper.marginLeftMm + paper.marginRightMm
      + paper.columns * paper.widthMm + Math.max(0, paper.columns - 1) * paper.gapXmm;
    const height = paper.mediaHeightMm || paper.marginTopMm + paper.marginBottomMm + paper.heightMm
      + Math.max(0, paper.rows - 1) * rowAdvanceMm;
    return { widthMm: Math.max(paper.widthMm, width), heightMm: Math.max(paper.heightMm, height) };
  }
  function legacyPaperProfileToUniversal(paper = {}) {
    return {
      id:paper.id || paper.paperType || 'custom',
      mediaType:paper.mediaType || 'roll-1',
      widthMm:Number(paper.labelWidthMm ?? paper.widthMm ?? 60),
      heightMm:Number(paper.labelHeightMm ?? paper.heightMm ?? 40),
      mediaWidthMm:Number(paper.mediaWidthMm ?? 0),
      mediaHeightMm:Number(paper.mediaHeightMm ?? 0),
      columns:Math.max(1, Number(paper.columns ?? 1)),
      rows:Math.max(1, Number(paper.rows ?? 1)),
      gapXmm:Number(paper.gapHorizontalMm ?? paper.gapXmm ?? 0),
      gapYmm:Number(paper.gapVerticalMm ?? paper.gapYmm ?? 0),
      marginTopMm:Number(paper.marginTopMm ?? 0),
      marginRightMm:Number(paper.marginRightMm ?? 0),
      marginBottomMm:Number(paper.marginBottomMm ?? 0),
      marginLeftMm:Number(paper.marginLeftMm ?? 0),
      pitchMm:Number(paper.pitchMm ?? 0),
      xOffsetMm:Number(paper.xOffsetMm ?? 0),
      yOffsetMm:Number(paper.yOffsetMm ?? 0),
      scaleX:Number(paper.scaleX ?? 1),
      scaleY:Number(paper.scaleY ?? 1),
      dpi:Number(paper.nominalDpi ?? paper.dpi ?? 203),
      orientation:paper.orientation || 'portrait'
    };
  }
  function resolveLabelPrintProfile(businessId, template = {}, profileId = '') {
    const profiles = labelProfilesForBiz(businessId);
    const deviceState = loadPrintDeviceState(businessId);
    const smartPrint = window.CLICK360_SMART_PRINT;
    const candidates = [profileId, template?.universalProfileId, deviceState?.universalProfileId, deviceState?.selectedProfileId].filter(Boolean);
    for (const id of candidates) {
      const raw = profiles.find((profile) => profile.id === id);
      if (!raw) continue;
      if (raw.universalPaper) return smartPrint?.applyUniversalDeviceCalibration(raw, deviceState) || raw;
      const normalized = smartPrint?.normalizePrintProfile(raw, businessId) || raw;
      if (normalized?.paper) {
        return {
          ...normalized,
          universalPaper:legacyPaperProfileToUniversal(normalized.paper),
          name:normalized.name || raw.name
        };
      }
    }
    const canvasApi = window.CLICK360_UNIVERSAL_LABEL_CANVAS;
    const templateDoc = template?.id || template?.layout || template?.universalDocument ? universalDocumentFromTemplate(template) : null;
    const templatePaper = templateDoc?.paper;
    if (templatePaper && canvasApi) {
      // Accept template paper even with warnings (multi-column without mediaWidth gets a warning
      // but is still valid enough for a quick provisional print from the quick-print button).
      const validation = smartPrint?.validatePaperProfile(canvasApi.toPrintPaper(templateDoc)) || { valid:true };
      const hasBlockingErrors = (validation.errors || []).some(e => /no está disponible|inválido/i.test(e));
      if (!hasBlockingErrors) {
        return {
          id:'template-paper',
          name:`${template?.name || 'Plantilla'} · ${templatePaper.columns} col${templatePaper.columns > 1 ? 's' : ''} · ${templatePaper.widthMm}×${templatePaper.heightMm} mm`,
          universalPaper:templatePaper,
          status:'provisional'
        };
      }
    }
    return null;
  }
  function mergeUniversalPaperIntoDocument(sourceDocument, universalPaper) {
    const canvasApi = window.CLICK360_UNIVERSAL_LABEL_CANVAS;
    if (!canvasApi) return sourceDocument;
    const normalized = canvasApi.normalizeDocument(sourceDocument);
    if (!universalPaper) return normalized;
    return canvasApi.normalizeDocument({ ...normalized, paper:{ ...normalized.paper, ...universalPaper } });
  }
  function universalDocumentFromAdvancedState(options = {}) {
    const canvasApi = window.CLICK360_UNIVERSAL_LABEL_CANVAS;
    if (!canvasApi) return null;
    return canvasApi.normalizeDocument({
      schemaVersion:2,
      paper:universalPaperFromTemplate({
        paperType:options.paperType,
        widthMm:options.widthMm,
        heightMm:options.heightMm,
        mediaWidthMm:options.mediaWidthMm,
        mediaHeightMm:options.mediaHeightMm,
        columns:options.columns,
        rows:options.rows,
        gapXmm:options.gapXmm,
        gapYmm:options.gapYmm,
        marginTopMm:options.marginTopMm,
        marginRightMm:options.marginRightMm,
        marginBottomMm:options.marginBottomMm,
        marginLeftMm:options.marginLeftMm,
        pitchMm:options.pitchMm,
        xOffsetMm:options.xOffsetMm,
        yOffsetMm:options.yOffsetMm,
        scaleX:options.scaleX,
        scaleY:options.scaleY,
        dpi:options.dpi,
        mediaType:options.mediaType
      }),
      layout:normalizedLabelLayout(options.layout),
      quantity:1,
      startSlot:Math.max(1, Number(options.startSlot || 1))
    });
  }
  async function prepareLabelPrintJob({
    product,
    template = null,
    templateId = '',
    paperProfileId = '',
    quantity = 1,
    startSlot = 1,
    useStock = false,
    businessId = currentBusiness()?.id,
    usedSlots = [],
    sourceDocument = null,
    priceFormat = ''
  } = {}) {
    const canvasApi = window.CLICK360_UNIVERSAL_LABEL_CANVAS;
    if (!canvasApi) throw Object.assign(new Error('El motor de etiquetas no está disponible. Recarga CLICK 360.'), { code:'label-engine-unavailable' });
    if (!product?.id) throw Object.assign(new Error('Producto no encontrado.'), { code:'label-product-missing' });
    if (product.businessId && businessId && product.businessId !== businessId) {
      throw Object.assign(new Error('El producto no pertenece al negocio activo.'), { code:'label-product-business-mismatch' });
    }
    const templates = labelTemplatesForBiz(businessId);
    const resolvedTemplate = template
      || templates.find((item) => item.id === templateId)
      || templates.find((item) => item.isDefault)
      || null;
    if (!resolvedTemplate && !sourceDocument) {
      throw Object.assign(new Error('Plantilla no encontrada. Guarda un diseño primero.'), { code:'label-template-missing' });
    }
    const profile = resolveLabelPrintProfile(businessId, resolvedTemplate || {}, paperProfileId);
    // If no saved profile found, fall back to the template/sourceDocument paper itself.
    // This ensures print still works even without an explicit profile saved.
    if (!profile?.universalPaper) {
      const fallbackDoc = sourceDocument
        ? canvasApi.normalizeDocument(sourceDocument)
        : (resolvedTemplate ? universalDocumentFromTemplate(resolvedTemplate) : null);
      const fallbackPaper = fallbackDoc?.paper;
      if (fallbackPaper?.widthMm > 0 && fallbackPaper?.heightMm > 0) {
        console.warn('[CLICK360] No saved profile — using document paper as provisional profile');
        // Use document paper directly, skip profile merge step
        let documentModel = fallbackDoc;
        documentModel = canvasApi.normalizeDocument({ ...documentModel, quantity: resolveLabelCopyResult(quantity, product.qty, useStock).count || 1, startSlot: Math.max(1, Number(startSlot) || 1) });
        const qty = resolveLabelCopyResult(quantity, product.qty, useStock);
        const groups = [{ product, copies: qty.count || 1 }];
        const plan = canvasApi.buildPrintPlan(groups, documentModel, { startSlot: documentModel.startSlot, usedSlots });
        if (!plan.valid || !plan.count || !plan.pages?.length) {
          throw Object.assign(new Error(plan.errors?.[0] || 'No hay etiquetas válidas. Verifica la plantilla.'), { code:'label-plan-invalid' });
        }
        return { product, template:resolvedTemplate, profile:{ id:'inline-paper', universalPaper:fallbackPaper, name:'Papel de plantilla' }, document:documentModel, plan, groups, quantity:qty, media:universalMediaSize(documentModel), fingerprint:canvasApi.planFingerprint(plan) };
      }
      throw Object.assign(new Error('Selecciona o configura un perfil de papel antes de imprimir. Abre el botón QR dorado y elige un perfil.'), { code:'label-profile-missing' });
    }
    const quantityResult = resolveLabelCopyResult(quantity, product.qty, useStock);
    if (!quantityResult.valid || quantityResult.count < 1) {
      throw Object.assign(new Error(quantityResult.error || 'La cantidad debe ser un número entero válido.'), { code:'label-quantity-invalid' });
    }
    let documentModel = sourceDocument
      ? canvasApi.normalizeDocument(sourceDocument)
      : universalDocumentFromTemplate(resolvedTemplate);
    documentModel = mergeUniversalPaperIntoDocument(documentModel, profile.universalPaper);
    const resolvedPriceFormat = priceFormat || resolvedTemplate?.priceFormat || 'full';
    documentModel = canvasApi.normalizeDocument({
      ...documentModel,
      quantity:quantityResult.count,
      startSlot:Math.max(1, Number(startSlot) || 1)
    });
    // Attach priceFormat as non-schema metadata (preserved through cloneNode/snapshot)
    documentModel = { ...documentModel, priceFormat:resolvedPriceFormat };
    const groups = [{ product, copies:quantityResult.count }];
    const plan = canvasApi.buildPrintPlan(groups, documentModel, {
      startSlot:documentModel.startSlot,
      usedSlots
    });
    if (!plan.valid || !plan.count || !plan.pages?.length) {
      throw Object.assign(new Error(plan.errors?.[0] || 'No hay etiquetas válidas para imprimir.'), { code:'label-plan-invalid' });
    }
    const smartPrint = window.CLICK360_SMART_PRINT;
    const paperValidation = smartPrint?.validatePaperProfile(canvasApi.toPrintPaper(documentModel)) || { valid:true };
    if (!paperValidation.valid) {
      throw Object.assign(new Error(paperValidation.errors?.[0] || 'El perfil de papel no es válido.'), { code:'label-paper-invalid' });
    }
    return {
      product,
      template:resolvedTemplate,
      profile,
      document:documentModel,
      plan,
      groups,
      quantity:quantityResult,
      media:universalMediaSize(documentModel),
      fingerprint:canvasApi.planFingerprint(plan)
    };
  }
  async function waitForLabelPrintNodeReady(node, timeoutMs = 8000) {
    if (!node?.childElementCount) throw Object.assign(new Error('El plan de impresión no contiene contenido renderizable.'), { code:'label-render-empty' });
    const images = [...node.querySelectorAll('img')];
    const waits = images.map(async (image) => {
      if (!image.complete) await new Promise((resolve, reject) => {
        image.addEventListener('load', resolve, { once:true });
        image.addEventListener('error', () => reject(Object.assign(new Error('No se pudo cargar la etiqueta.'), { code:'label-image-error' })), { once:true });
      });
      if (!image.naturalWidth || !image.naturalHeight) throw Object.assign(new Error('La imagen de la etiqueta está vacía.'), { code:'label-image-empty' });
      if (typeof image.decode === 'function') await image.decode().catch(() => {});
    });
    if (document.fonts?.ready) waits.push(document.fonts.ready);
    const ready = Promise.all(waits).then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const timeout = new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('La vista previa no quedó lista. Intenta de nuevo.'), { code:'label-render-timeout' })), timeoutMs));
    await Promise.race([ready, timeout]);
    for (const canvas of node.querySelectorAll('canvas')) {
      if (!canvas.width || !canvas.height) throw Object.assign(new Error('La etiqueta se renderizó vacía.'), { code:'label-canvas-empty' });
    }
  }
  async function executeCanonicalLabelPrint(preparedJob, providerId = 'system') {
    const job = await buildUniversalLabelPrintNode(preparedJob.product, preparedJob.document);
    await waitForLabelPrintNodeReady(job.node);
    const result = await handoffPrint({
      node:job.node.cloneNode(true),
      media:'label',
      mediaWidthMm:job.media.widthMm,
      mediaHeightMm:job.media.heightMm,
      widthMm:job.document.paper.widthMm,
      heightMm:job.document.paper.heightMm,
      copiesHandled:true,
      printPlan:job.plan,
      filename:`CLICK360_etiquetas_${slug(preparedJob.product.name || preparedJob.product.code)}_${today()}.pdf`
    }, providerId);
    return { ...job, result, fingerprint:preparedJob.fingerprint };
  }
  function showQuickLabelPrintConfirm({ product, template, profile, quantity = 1, startSlot = 1, action = 'print' } = {}) {
    return new Promise((resolve) => {
      const isPdf = action === 'pdf';
      const profileName = profile?.name || 'Perfil guardado';
      showModal(`<div class="modalHeader"><div><h2>${isPdf ? 'Guardar PDF' : 'Imprimir etiqueta'}</h2><p class="fieldHint">Confirma producto, plantilla y papel antes de continuar.</p></div><button class="closeBtn" data-close aria-label="Cerrar">×</button></div>
        <div class="formGrid">
          <div class="field full"><label>Producto</label><input readonly value="${escapeHtml(product?.name || 'Producto')} (${escapeHtml(product?.code || '')})"></div>
          <div class="field full"><label>Plantilla</label><input readonly value="${escapeHtml(template?.name || 'Predeterminada')}"></div>
          <div class="field full"><label>Papel</label><input readonly value="${escapeHtml(profileName)}"></div>
          <div class="field"><label>Cantidad</label><input id="quickLabelQuantity" type="number" min="1" max="500" step="1" inputmode="numeric" value="${Math.max(1, Number(quantity) || 1)}"></div>
          <div class="field"><label>Empezar en casilla</label><input id="quickLabelStartSlot" type="number" min="1" max="120" step="1" value="${Math.max(1, Number(startSlot) || 1)}"></div>
        </div>
        <div class="labelPrimaryActions"><button type="button" class="btn" data-close>Cancelar</button><button type="button" class="btn primary" id="quickLabelConfirm">${isPdf ? `${icon('file-down')} Guardar PDF` : `${icon('printer')} Imprimir`}</button></div>`);
      $('#quickLabelConfirm').onclick = () => {
        closeModal();
        resolve({
          confirmed:true,
          quantity:Math.max(1, Number($('#quickLabelQuantity')?.value || 1)),
          startSlot:Math.max(1, Number($('#quickLabelStartSlot')?.value || 1))
        });
      };
      $$('[data-close]').forEach((button) => { button.onclick = () => { closeModal(); resolve({ confirmed:false }); }; });
    });
  }
  async function runQuickLabelPrintFlow({ product, templateId = '', action = 'print', quantity = 1, startSlot = 1 } = {}) {
    const businessId = currentBusiness()?.id;
    if (!businessId) { toast('Selecciona un negocio activo primero.', 'err'); return null; }
    if (!product?.id) { toast('Producto no encontrado.', 'err'); return null; }
    try {
      const templates = labelTemplatesForBiz(businessId);
      const template = templates.find((item) => item.id === templateId) || templates.find((item) => item.isDefault) || null;
      if (!template) {
        toast('Configura y guarda una plantilla primero. Usa el botón QR dorado.', 'ok');
        openLabelModal(product);
        return null;
      }
      const profile = resolveLabelPrintProfile(businessId, template, '');
      if (!profile?.universalPaper) {
        toast('Selecciona o configura un perfil de papel antes de imprimir.', 'err');
        openLabelModal(product, template.id);
        return null;
      }
      const confirmation = await showQuickLabelPrintConfirm({ product, template, profile, quantity, startSlot, action });
      if (!confirmation.confirmed) return null;
      const prepared = await prepareLabelPrintJob({
        product,
        template,
        templateId:template.id,
        quantity:confirmation.quantity,
        startSlot:confirmation.startSlot,
        businessId,
        priceFormat:template.priceFormat || 'full'
      });
      return executeCanonicalLabelPrint(prepared, action === 'pdf' ? 'pdf' : 'system');
    } catch (error) {
      console.warn('Quick label print failed:', error);
      toast(error.message || 'No se pudo imprimir.', 'err');
      return null;
    }
  }
  async function buildUniversalLabelPrintNode(product, sourceDocument) {
    const canvasApi = window.CLICK360_UNIVERSAL_LABEL_CANVAS;
    const documentModel = canvasApi.normalizeDocument(sourceDocument);
    const documentSnapshot = canvasApi.normalizeDocument(documentModel);
    const plan = canvasApi.buildPrintPlan([{ product, copies: documentSnapshot.quantity }], documentSnapshot, { startSlot: documentSnapshot.startSlot });
    if (!plan.valid || !plan.count || !plan.pages?.length) throw Object.assign(new Error(plan.errors?.[0] || 'No hay etiquetas válidas para imprimir.'), { code:'universal-print-plan-invalid' });
    const media = universalMediaSize(documentSnapshot);
    const wrap = document.createElement('div');
    wrap.className = 'printLabels universalPrintLabels';
    wrap.dataset.printPlan = canvasApi.planFingerprint(plan);
    wrap.dataset.renderer = 'universal-mm-v2';
    for (const page of plan.pages) {
      const pageNode = document.createElement('section');
      pageNode.className = 'labelPrintPage';
      pageNode.style.cssText = `position:relative;width:${media.widthMm}mm;height:${media.heightMm}mm;overflow:hidden;page-break-after:always;`;
      for (const cell of page.cells) {
        const cellNode = document.createElement('div');
        cellNode.className = `labelPrintCell ${cell.status}`;
        cellNode.style.cssText = `position:absolute;left:${cell.xMm}mm;top:${cell.yMm}mm;width:${documentSnapshot.paper.widthMm}mm;height:${documentSnapshot.paper.heightMm}mm;overflow:hidden;`;
        if (cell.status === 'filled') {
          const labelCanvas = document.createElement('canvas');
          await canvasApi.renderLabelToCanvas(labelCanvas, documentSnapshot, {
            product: cell.item.product,
            price: labelFmt(cell.item.product, documentSnapshot.priceFormat),
            sku: cell.item.product?.code || '',
            qrPayload: productPayload(cell.item.product)
          });
          if (!labelCanvas.width || !labelCanvas.height) throw Object.assign(new Error('La etiqueta se renderizó vacía.'), { code:'universal-render-empty' });
          const image = document.createElement('img');
          image.src = labelCanvas.toDataURL('image/png');
          image.alt = `Etiqueta ${cell.item.copy} de ${cell.item.product?.name || 'producto'}`;
          image.style.cssText = `display:block;width:${documentSnapshot.paper.widthMm}mm;height:${documentSnapshot.paper.heightMm}mm;`;
          cellNode.appendChild(image);
        }
        pageNode.appendChild(cellNode);
      }
      wrap.appendChild(pageNode);
    }
    return { node:wrap, plan, document:documentSnapshot, media };
  }
  async function printUniversalLabels(product, sourceDocument, providerId = 'system') {
    // Direct path: caller already has a fully-calibrated document (editor or runQuickLabelPrintFlow).
    // Do NOT re-resolve the profile — calibrated paper is already baked into sourceDocument.
    const canvasApi = window.CLICK360_UNIVERSAL_LABEL_CANVAS;
    if (!canvasApi) throw Object.assign(new Error('El motor de etiquetas no está disponible. Recarga CLICK 360.'), { code:'label-engine-unavailable' });
    const documentModel = canvasApi.normalizeDocument(sourceDocument);
    const job = await buildUniversalLabelPrintNode(product, documentModel);
    await waitForLabelPrintNodeReady(job.node);
    const result = await handoffPrint({
      node:job.node.cloneNode(true), media:'label',
      mediaWidthMm:job.media.widthMm, mediaHeightMm:job.media.heightMm,
      widthMm:job.document.paper.widthMm, heightMm:job.document.paper.heightMm,
      copiesHandled:true, printPlan:job.plan,
      filename:`CLICK360_etiquetas_${slug(product?.name || product?.code || 'etiqueta')}_${today()}.pdf`
    }, providerId);
    return { ...job, result };
  }
  async function printUniversalCalibration(sourceDocument, providerId = 'system') {
    const canvasApi = window.CLICK360_UNIVERSAL_LABEL_CANVAS;
    const documentModel = canvasApi.normalizeDocument(sourceDocument);
    const calibrationProduct = { id:'calibration', name:'Calibración CLICK 360', code:'CAL-001', price:0, qty:1 };
    const withText = canvasApi.addObject(documentModel, 'text', { text:'Prueba X/Y · mide borde y gap', xMm:2, yMm:Math.max(2, documentModel.paper.heightMm - 8), widthMm:Math.max(10, documentModel.paper.widthMm - 4), heightMm:5 });
    return printUniversalLabels(calibrationProduct, { ...withText, quantity: Math.max(2, documentModel.paper.columns), startSlot:1 }, providerId);
  }
  async function openLabelModal(product, initialTemplateId = '', options = {}) {
    const editor = window.CLICK360_UNIVERSAL_LABEL_EDITOR;
    const canvasApi = window.CLICK360_UNIVERSAL_LABEL_CANVAS;
    if (window.CLICK360_P2_WEB_SAFE_FLAGS?.p2UniversalLabelsEnabled !== true) {
      return openAdvancedLabelModal(product, initialTemplateId, options);
    }
    const editorBusiness = currentBusiness();
    const businessId = editorBusiness?.id || '';
    if (!editor || !canvasApi) return openAdvancedLabelModal(product, initialTemplateId, options);
    if (!businessId || (product?.businessId && product.businessId !== businessId)) return toast('El producto no pertenece al negocio activo.', 'err');

    if (options.directPrint || options.directPdf) {
      return runQuickLabelPrintFlow({
        product,
        templateId:initialTemplateId,
        action:options.directPdf ? 'pdf' : 'print'
      });
    }
    const templates = labelTemplatesForBiz(businessId);
    const initialTemplate = templates.find((template) => template.id === initialTemplateId) || templates.find((template) => template.isDefault) || null;
    const deviceState = loadPrintDeviceState(businessId);
    const deviceProfile = (profile) => window.CLICK360_SMART_PRINT?.applyUniversalDeviceCalibration(profile, loadPrintDeviceState(businessId)) || profile;
    const initialProfile = deviceProfile(labelProfilesForBiz(businessId).find((profile) => profile.id === deviceState.universalProfileId) || null);
    const editorBusinessIsActive = () => currentBusiness()?.id === businessId;
    editor.open({
      product,
      initialTemplate,
      initialProfile,
      initialDocument: universalLabelDocument(initialTemplate || {}),
      formatPrice:fmt,
      productPayload,
      readImage:(input, onImage) => readImageInput(input, onImage, { max:640, maxBytes:140 * 1024, quality:0.7 }),
      showModal,
      closeModal,
      toast,
      getTemplates:() => labelTemplatesForBiz(businessId).filter((template) => template.universalDocument || template.layout),
      getProfiles:() => labelProfilesForBiz(businessId).filter((profile) => profile.universalPaper).map(deviceProfile),
      selectProfile:(profileId) => {
        const next = loadPrintDeviceState(businessId);
        savePrintDeviceState({ ...next, universalProfileId:profileId || '' }, businessId);
      },
      saveTemplate:async (name, universalDocument, templateId = '') => {
        if (!editorBusinessIsActive()) return toast('El negocio activo cambió. Reabre el lienzo para guardar con seguridad.', 'err');
        state.settings ||= {}; state.settings.labelTemplates ||= [];
        const previous = [...state.settings.labelTemplates];
        const existing = state.settings.labelTemplates.find((template) => template.id === templateId && template.businessId === businessId);
        const template = {
          ...(existing || {}), id:existing?.id || uid('tpl'), name, businessId,
          universalDocument:canvasApi.normalizeDocument(universalDocument), widthMm:universalDocument.paper.widthMm,
          heightMm:universalDocument.paper.heightMm, columns:universalDocument.paper.columns, rows:universalDocument.paper.rows,
          paperType:universalDocument.paper.id, dpi:universalDocument.paper.dpi,
          renderer:'universal-mm-v2', universalProfileId:activeProfileId || '', schemaVersion:2,
          priceFormat:existing?.priceFormat || initialTemplate?.priceFormat || 'full',
          createdAt:existing?.createdAt || new Date().toISOString(), updatedAt:new Date().toISOString(), isDefault:existing?.isDefault === true
        };
        const index = state.settings.labelTemplates.findIndex((item) => item.id === template.id && item.businessId === businessId);
        if (index >= 0) state.settings.labelTemplates[index] = template; else state.settings.labelTemplates.push(template);
        addAudit('universal_label_template_saved', { templateId:template.id, businessId, renderer:'universal-mm-v2' });
        if (!save()) { state.settings.labelTemplates = previous; toast('No se pudo guardar la plantilla en este dispositivo.', 'err'); return null; }
        refreshInventoryTemplateSection(); toast('Plantilla del lienzo guardada.', 'ok'); return template;
      },
      deleteTemplate:async (templateId) => {
        if (!editorBusinessIsActive()) { toast('El negocio activo cambió. Reabre el lienzo.', 'err'); return false; }
        state.settings ||= {}; state.settings.labelTemplates ||= [];
        const previous = [...state.settings.labelTemplates];
        const beforeCount = previous.length;
        state.settings.labelTemplates = previous.filter((template) => !(template.id === templateId && template.businessId === businessId));
        if (state.settings.labelTemplates.length === beforeCount) { toast('Plantilla no encontrada.', 'err'); return false; }
        addAudit('universal_label_template_deleted', { templateId, businessId, renderer:'universal-mm-v2' });
        if (!save()) { state.settings.labelTemplates = previous; toast('No se pudo eliminar la plantilla.', 'err'); return false; }
        refreshInventoryTemplateSection(); toast('Plantilla eliminada.', 'ok'); return true;
      },
      saveProfile:async (universalDocument, profileId = '', profileName = '') => {
        if (!editorBusinessIsActive()) return toast('El negocio activo cambió. Reabre el lienzo.', 'err');
        state.settings ||= {}; state.settings.labelProfiles ||= [];
        const previous = [...state.settings.labelProfiles];
        const existing = state.settings.labelProfiles.find((profile) => profile.id === profileId && profile.businessId === businessId);
        const name = String(profileName || existing?.name || `Perfil ${universalDocument.paper.widthMm}x${universalDocument.paper.heightMm} mm`).trim().slice(0, 80);
        const normalizedPaper = canvasApi.normalizeDocument(universalDocument).paper;
        const sharedPaper = { ...normalizedPaper, xOffsetMm:0, yOffsetMm:0, scaleX:1, scaleY:1 };
        const profile = { ...(existing || {}), id:existing?.id || uid('print-profile'), businessId, name:name || `Perfil ${universalDocument.paper.widthMm}x${universalDocument.paper.heightMm} mm`, status:'provisional', universalPaper:sharedPaper, createdAt:existing?.createdAt || new Date().toISOString(), updatedAt:new Date().toISOString() };
        const index = state.settings.labelProfiles.findIndex((item) => item.id === profile.id && item.businessId === businessId);
        if (index >= 0) state.settings.labelProfiles[index] = profile; else state.settings.labelProfiles.push(profile);
        addAudit('universal_label_profile_saved', { profileId:profile.id, businessId, status:'provisional' });
        if (!save()) { state.settings.labelProfiles = previous; toast('No se pudo guardar el perfil.', 'err'); return null; }
        const localState = loadPrintDeviceState(businessId);
        const calibrationKey = window.CLICK360_SMART_PRINT?.universalCalibrationKey(profile.id);
        const geometryFingerprint = window.CLICK360_SMART_PRINT?.universalPaperGeometryFingerprint(sharedPaper) || '';
        const calibrations = { ...(localState.calibrations || {}) };
        if (calibrationKey) {
          calibrations[calibrationKey] = {
            xOffsetMm:normalizedPaper.xOffsetMm,
            yOffsetMm:normalizedPaper.yOffsetMm,
            scaleX:normalizedPaper.scaleX,
            scaleY:normalizedPaper.scaleY,
            status:'provisional',
            geometryFingerprint,
            updatedAt:new Date().toISOString()
          };
        }
        savePrintDeviceState({ ...localState, universalProfileId:profile.id, calibrations }, businessId);
        return deviceProfile(profile);
      },
      print: async (universalDocument, providerId) => {
        const snapshot = canvasApi.normalizeDocument(universalDocument);
        return printUniversalLabels(product, snapshot, providerId);
      },
      printCalibration:(universalDocument) => printUniversalCalibration(universalDocument),
      openAdvanced:() => openAdvancedLabelModal(product, initialTemplateId)
    });
  }
  window.click360UniversalLabelTest = {
    normalize:(input) => window.CLICK360_UNIVERSAL_LABEL_CANVAS?.normalizeDocument(input),
    buildPlan:(product, input) => window.CLICK360_UNIVERSAL_LABEL_CANVAS?.buildPrintPlan([{ product, copies:input?.quantity || 1 }], input, { startSlot:input?.startSlot || 1 }),
    render:(product, input) => buildUniversalLabelPrintNode(product, input),
    prepare:prepareLabelPrintJob,
    execute:executeCanonicalLabelPrint,
    open:(product) => openLabelModal(product)
  };
  window.click360PrepareLabelPrintJob = prepareLabelPrintJob;
  window.click360ExecuteCanonicalLabelPrint = executeCanonicalLabelPrint;
  function roundRect(ctx,x,y,w,h,r,fill,stroke){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();if(fill)ctx.fill();if(stroke)ctx.stroke();}
  function printPaperFromOptions(options = {}) {
    return {
      id:options.paperType || 'custom',
      businessId:options.businessId || '',
      mediaType:options.mediaType || (String(options.paperType || '').startsWith('sheet-') ? 'sheet' : 'roll-1'),
      labelWidthMm:options.widthMm,
      labelHeightMm:options.heightMm,
      mediaWidthMm:options.mediaWidthMm,
      mediaHeightMm:options.mediaHeightMm,
      columns:options.columns,
      rows:options.rows,
      gapHorizontalMm:options.gapXmm,
      gapVerticalMm:options.gapYmm,
      marginTopMm:options.marginTopMm,
      marginRightMm:options.marginRightMm,
      marginBottomMm:options.marginBottomMm,
      marginLeftMm:options.marginLeftMm,
      shape:options.shape,
      contentRotation:options.contentRotation,
      xOffsetMm:options.xOffsetMm,
      yOffsetMm:options.yOffsetMm,
      nominalDpi:options.dpi,
      status:options.profileStatus,
      measurementsConfirmed:options.measurementsConfirmed
    };
  }
  function buildLabelSheetPlan(groups, options = {}) {
    const universal = window.CLICK360_UNIVERSAL_LABEL_CANVAS;
    if (universal?.buildPrintPlan) return universal.buildPrintPlan(groups, printPaperFromOptions(options), {
      startSlot: options.startSlot,
      usedSlots: options.usedSlots
    });
    const core = window.CLICK360_SMART_PRINT;
    if (!core?.buildSheetPlan) {
      return { valid:false, errors:['El motor físico de impresión no está disponible. Recarga CLICK 360.'], items:[], count:0, columns:1, rows:1, capacity:1, pages:[], mediaType:'roll' };
    }
    return core.buildSheetPlan(groups, printPaperFromOptions(options), {
      startSlot:options.startSlot,
      usedSlots:options.usedSlots
    });
  }
  function buildLabelPrintPlan(groups, options = {}) { return buildLabelSheetPlan(groups, options); }
  window.click360BuildLabelSheetPlan = buildLabelSheetPlan;
  window.click360BuildLabelPrintPlan = buildLabelPrintPlan;
  async function printLabels(groups, options = {}, providerId = 'system'){
    const root=$('#printRoot') || document.createElement('div');
    root.id='printRoot';
    root.className='printSheet';
    if (!root.isConnected) document.body.appendChild(root);
    root.replaceChildren();
    const plan = buildLabelPrintPlan(groups, options);
    if (!plan.valid || !plan.count || !plan.pages.length) {
      toast(plan.errors?.[0] || 'No hay etiquetas válidas para imprimir.', 'err');
      return { count:0, columns:plan.columns, rows:plan.rows, status:'blocked' };
    }
    const paperValidation = window.CLICK360_SMART_PRINT.validatePaperProfile(printPaperFromOptions(options));
    if (!paperValidation.valid) {
      toast(paperValidation.errors[0], 'err');
      return { count:0, columns:plan.columns, rows:plan.rows, status:'blocked' };
    }
    const paper = paperValidation.paper;
    const widthMm = paper.labelWidthMm;
    const heightMm = paper.labelHeightMm;
    const mediaWidthMm = paper.mediaWidthMm || paperValidation.requiredWidthMm;
    const mediaHeightMm = paper.mediaHeightMm || paperValidation.requiredHeightMm;
    const wrap=document.createElement('div');
    wrap.className='printLabels';
    wrap.dataset.paper = String(options.paperType || 'custom');
    wrap.dataset.geometryFingerprint = window.CLICK360_SMART_PRINT.paperGeometryFingerprint(paper);
    root.appendChild(wrap);
    root.dataset.labelCount = String(plan.count);
    root.dataset.labelPaper = String(options.paperType || 'custom');
    for (const page of plan.pages) {
      const pageElement=document.createElement('section');
      pageElement.className='labelPrintPage';
      pageElement.dataset.page=String(page.index + 1);
      pageElement.style.width=`${mediaWidthMm}mm`;
      pageElement.style.height=`${mediaHeightMm}mm`;
      pageElement.style.position='relative';
      for (const cell of page.cells) {
        const cellElement=document.createElement('div');
        cellElement.className=`labelPrintCell ${cell.status}`;
        cellElement.dataset.slot=String(cell.slot);
        cellElement.style.position='absolute';
        cellElement.style.left=`${cell.xMm}mm`;
        cellElement.style.top=`${cell.yMm}mm`;
        cellElement.style.width=`${widthMm}mm`;
        cellElement.style.height=`${heightMm}mm`;
        if (cell.status !== 'filled') {
          cellElement.setAttribute('aria-hidden', 'true');
          pageElement.appendChild(cellElement);
          continue;
        }
        cellElement.classList.add('printLabel');
        cellElement.style.borderRadius = options.shape === 'circle' ? '50%' : (options.shape === 'square' ? '0' : '2mm');
        cellElement.style.overflow='hidden';
        const canvas=document.createElement('canvas');
        const opt = {
          ...options,
          scale:3,
          bgColor:safeColor(options.bgColor, '#ffffff'),
          qrBgColor:safeColor(options.qrBgColor || options.bgColor, '#ffffff'),
          fgColor:safeColor(options.fgColor, '#000000'),
          social:options.social || '',
          address:options.address || '',
          widthMm,
          heightMm
        };
        await drawLabelOnCanvas(canvas, cell.item.product, opt);
        const renderedImage=document.createElement('img');
        renderedImage.src=canvas.toDataURL('image/png');
        renderedImage.alt=`Etiqueta ${cell.item.copy} de ${cell.item.product?.name || 'producto'}`;
        renderedImage.style.width=`${widthMm}mm`;
        renderedImage.style.height=`${heightMm}mm`;
        renderedImage.style.display='block';
        cellElement.appendChild(renderedImage);
        pageElement.appendChild(cellElement);
      }
      wrap.appendChild(pageElement);
    }
    const printable=wrap.cloneNode(true);
    const handoff=await handoffPrint({
      node:printable,
      media:'label',
      mediaWidthMm,
      mediaHeightMm,
      widthMm,
      heightMm,
      copiesHandled:true,
      filename:`CLICK360_etiquetas_${today()}.pdf`
    }, providerId);
    return { count:plan.count, columns:plan.columns, rows:plan.rows, pages:plan.pages.length, status:handoff ? 'handed_off' : 'error' };
	  }

  function createBackupSnapshot(reason='manual') {
    const backup = {
      reason,
      createdAt: new Date().toISOString(),
      createdBy: authUser().name || 'Sistema',
      businessId: currentBusiness()?.id || '',
      state
    };
    const prefix = activeTenantContext?.tenantKey ? `CLICK360_BACKUP:${activeTenantContext.tenantKey}:` : '';
    try {
      if (prefix) {
        localStorage.setItem(`${prefix}${Date.now()}:${reason}`, JSON.stringify(backup));
        const keys = [];
        for (let index = 0; index < localStorage.length; index += 1) {
          const key = localStorage.key(index);
          if (key?.startsWith(prefix)) keys.push(key);
        }
        keys.sort();
        keys.slice(0, Math.max(0, keys.length - LOCAL_BACKUP_RETENTION)).forEach((key) => localStorage.removeItem(key));
      }
    } catch {}
    return backup;
  }
  function downloadBackup(reason='manual'){
    const backup = createBackupSnapshot(reason);
    const a=document.createElement('a');
    const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(backup.state,null,2)],{type:'application/json'}));
    a.href=objectUrl;
    a.download=`click360-respaldo-${reason}-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    addAudit('backup_exported', { reason });
    toast('Respaldo guardado');
    return true;
  }
  function validateBackupData(data) {
    if (!data || typeof data !== 'object' || stateSizeBytes(data) > MAX_LOCAL_TENANT_STATE_BYTES) return false;
    return tenantRuntime?.validBusinessPayload({ identity: data.identity, data }, activeTenantContext) === true;
  }
	  function bindBackup(){
	    $('#backupBtn').onclick=downloadBackup;
	    $('#forceSyncCloud')?.addEventListener('click', async ()=>{
	      if(window.click360SyncNow) {
	        toast('Guardando en nube...');
	        const synced = await window.click360SyncNow();
	        toast(synced ? 'Nube actualizada' : 'No se pudo sincronizar', synced ? 'ok' : 'err');
	      } else toast('Nube no disponible en este entorno', 'err');
	    });
		    $('#refreshCloudBtn')?.addEventListener('click', async ()=>{
		      if(!window.click360RefreshNow) return toast('Nube no disponible en este entorno', 'err');
		      if(!confirm('Actualizar desde nube reemplazará la copia local actual. Se descargará un respaldo antes de continuar. ¿Deseas seguir?')) return;
		      if(prompt('Escribe exactamente REEMPLAZAR LOCAL para confirmar:') !== 'REEMPLAZAR LOCAL') return toast('Actualización cancelada', 'err');
		      downloadBackup('antes-de-actualizar-desde-nube');
		      toast('Actualizando desde nube...');
		      await window.click360RefreshNow().catch(()=>toast('No se pudo actualizar desde nube', 'err'));
		    });
		    $('#clearLocalAppStateBtn')?.addEventListener('click', clearLocalAppStateRecovery);
		    $('#copySyncDiagnosticBtn')?.addEventListener('click', async () => {
		      const diagnostic = window.click360GetReliabilityDiagnostics?.() || {};
		      const text = JSON.stringify(diagnostic, null, 2);
		      try {
		        await navigator.clipboard.writeText(text);
		        toast('Diagnóstico copiado.');
		      } catch {
		        console.info('CLICK360 diagnóstico', diagnostic);
		        toast('Diagnóstico enviado a consola.', 'ok');
		      }
		    });
	    $('#restoreFile').onchange = (e) => {
	        if(!isOwnerUser()) {
	          e.target.value = '';
	          return toast('Solo el dueño puede restaurar respaldos.', 'err');
	        }
	        const file = e.target.files[0]; if(!file) return;
        const r = new FileReader();
        r.onload = async (ev) => {
          try {
             const data = JSON.parse(ev.target.result);
	             if(!validateBackupData(data)) {
	                toast('Respaldo inválido, incompleto o de otra cuenta', 'err');
                return;
             }
             const summary = `Productos: ${(data.products||[]).length}\nVentas: ${(data.sales||[]).length}\nMovimientos: ${(data.movements||[]).length}\nNegocios: ${(data.businesses||[]).length}`;
             if(!confirm(`Este respaldo reemplazará los datos actuales y luego se sincronizará con la nube.\n\n${summary}\n\nSe creará un respaldo automático antes de restaurar. ¿Continuar?`)) return;
             const word = prompt('Escribe RESTAURAR para confirmar la restauración:');
	             if(word !== 'RESTAURAR') {
	                toast('Restauración cancelada', 'err');
	                return;
	             }
	             downloadBackup('antes-de-restaurar');
	             const previousState = cloneState(state);
	             const operationId = uid('restore');
	             state = normalizeState(data);
	             state.identity = tenantIdentity();
	             addAudit('backup_restored', { summary, operationId });
	             const committed = await commitCriticalMutation(previousState, 'backup_restored', (next) =>
	               next.auditLogs.some((entry) => entry.details?.operationId === operationId));
	             if (!committed.ok) { renderApp('reports'); return; }
	             toast(committed.pending ? 'Respaldo restaurado; sincronización pendiente.' : 'Respaldo restaurado exitosamente');
	             setTimeout(() => location.reload(), 1200);
          }
          catch(err) {
             toast('Error leyendo archivo de respaldo', 'err');
          }
        };
        r.readAsText(file);
    };

    function generateExcelReport(dateFrom, dateTo) {
       const biz = currentBusiness();
       const inRange = (d) => { const date = (d || '').slice(0,10); return (!dateFrom || date >= dateFrom) && date <= dateTo; };

       // 1. Compile Sales
       const salesRows = [
         ["FECHA y HORA", "ID VENTA", "METODO", "CATEGORIA", "PRODUCTO/DETALLE", "CANTIDAD", "PRECIO UNIT.", "BASE LINEA", "IVA LINEA", "TOTAL LINEA", "SUBTOTAL VENTA", "DESCUENTO", "IVA VENTA", "TOTAL VENTA", "RECIBIDO", "SALDO", "CLIENTE", "CEDULA/RUC", "TELEFONO", "ATENDIDO POR", "ESTADO"]
       ];
       let totalVentas = 0;
       let totalCobrado = 0;
       let totalPendiente = 0;
       let salesCount = 0;
       state.sales.filter(s => s.businessId === biz.id && inRange(s.date)).forEach(s => {
          if (s.status !== 'cancelled') salesCount++;
          if (s.status !== 'cancelled') {
             totalVentas += s.total || 0;
             totalCobrado += collectedAmount(s);
             totalPendiente += s.balance || 0;
          }
	          (s.items || []).forEach((item, itemIndex) => {
             const rowTotal = Number(item.total ?? (item.price * item.qty));
             const rowTax = Number(item.tax || 0);
             const rowBase = Number(item.taxBase ?? (rowTotal - rowTax));
             salesRows.push([
                s.when || s.date,
                s.id,
                s.method || '',
                item.category || 'General',
                `${item.name} [${item.code}]`,
                item.qty,
                item.price,
                rowBase,
                rowTax,
                rowTotal,
                itemIndex === 0 ? (s.subtotal || rowBase) : '',
                itemIndex === 0 ? (s.discount || 0) : '',
                itemIndex === 0 ? (s.iva || 0) : '',
                itemIndex === 0 ? (s.total || rowTotal) : '',
                itemIndex === 0 ? collectedAmount(s) : '',
                itemIndex === 0 ? (s.balance || 0) : '',
                s.customer || '',
                s.customerCedula || '',
                s.customerPhone || '',
                s.createdBy || s.user || 'Sistema',
                labelStatus(s.status)
             ]);
          });
       });

       // 2. Compile Movements
       const movRows = [
         ["FECHA y HORA", "ID MOVIMIENTO", "TIPO MOVIMIENTO", "METODO PAGO", "DETALLE/NOTA", "MONTO", "ID VENTA", "ID FACTURA", "ATENDIDO POR", "ESTADO"]
       ];
       let totalIngresos = 0;
       let totalEgresos = 0;
       let totalIngresosEfectivo = 0;
       let movCount = 0;
       state.movements.filter(m => m.businessId === biz.id && inRange(m.date)).forEach(m => {
          if (m.status !== 'cancelled') movCount++;
          const isOutflow = m.kind !== 'ingreso' && m.kind !== 'apertura';
          const signedAmount = isOutflow ? -m.amount : m.amount;
          if (m.status !== 'cancelled') {
             if (isOutflow) totalEgresos += m.amount;
             else if (m.kind === 'ingreso') {
                totalIngresos += m.amount;
                if (isCashIncomeMovement(m)) totalIngresosEfectivo += m.amount;
             }
          }
          movRows.push([
             m.when || m.date,
             m.id,
             m.kind.toUpperCase(),
             m.paymentMethod || '',
             m.note || (m.saleId ? `Pago de venta ${m.saleId}` : 'Movimiento de caja'),
             signedAmount,
             m.saleId || '',
             m.invoiceId || '',
             m.createdBy || m.user || 'Sistema',
             m.status === 'cancelled' ? `ANULADO por ${m.cancelledBy || '?'} ${m.cancelledAt || ''}` : 'OK'
          ]);
       });

       const invoiceRows = [
          ["FECHA", "ID FACTURA", "PROVEEDOR", "NUMERO", "MONTO", "IVA", "NOTAS", "ATENDIDO POR", "CREADA", "ESTADO"]
       ];
       state.invoices.filter(i => i.businessId === biz.id && inRange(i.date)).forEach(i => {
          invoiceRows.push([
             i.date,
             i.id,
             i.provider,
             i.number,
             i.amount,
             i.iva || '',
             i.notes || '',
             i.createdBy || 'Sistema',
             i.createdAt || '',
             i.status === 'cancelled' ? `ANULADA por ${i.cancelledBy || '?'} ${i.cancelledAt || ''}` : 'OK'
          ]);
       });

       // 3. Compile Summary Sheet
       const summaryRows = [
          ["REPORTE CONTABLE CLICK 360"],
          ["Negocio:", biz.name],
          ["Periodo:", `${dateFrom} al ${dateTo}`],
          ["Fecha Reporte:", nowLabel()],
          [],
          ["INDICADOR/METRICA", "VALOR"],
          ["Total Ventas ($)", totalVentas],
          ["Total Cobrado ($)", totalCobrado],
          ["Saldo Pendiente ($)", totalPendiente],
          ["Transacciones de Venta", salesCount],
          ["Total Ingresos Caja ($)", totalIngresos],
          ["Ingresos Efectivo Caja ($)", totalIngresosEfectivo],
          ["Total Egresos/Compras/Retiros ($)", totalEgresos],
          ["Movimientos de Caja Registrados", movCount]
       ];

       // Create workbook
       const wb = XLSX.utils.book_new();

       const wsSummary = XLSX.utils.aoa_to_sheet(safeSheetRows(summaryRows));
       const wsSales = XLSX.utils.aoa_to_sheet(safeSheetRows(salesRows));
       const wsMovs = XLSX.utils.aoa_to_sheet(safeSheetRows(movRows));
       const wsInvoices = XLSX.utils.aoa_to_sheet(safeSheetRows(invoiceRows));

       XLSX.utils.book_append_sheet(wb, wsSummary, "Resumen");
       XLSX.utils.book_append_sheet(wb, wsSales, "Ventas");
       XLSX.utils.book_append_sheet(wb, wsMovs, "Movimientos");
       XLSX.utils.book_append_sheet(wb, wsInvoices, "Facturas");

       const filename = dateFrom === dateTo ?
          `Reporte_Contable_${slug(biz.name)}_${dateFrom}.xlsx` :
          `Reporte_Contable_${slug(biz.name)}_${dateFrom}_a_${dateTo}.xlsx`;

	       XLSX.writeFile(wb, filename);
	       return { totalVentas, salesCount, movCount };
	    }

	    function spreadsheetCell(value) {
	      if (typeof value !== 'string') return value;
	      return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
	    }
	    function safeSheetRows(rows) {
	      return rows.map(row => row.map(spreadsheetCell));
	    }
	    function csvCell(value) {
	      const text = String(spreadsheetCell(value) ?? '').replace(/\r?\n/g, ' ');
	      return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
	    }
	    function downloadCsvFallback(dateFrom, dateTo) {
	      const biz = currentBusiness();
	      const inRange = (d) => { const date = (d || '').slice(0,10); return (!dateFrom || date >= dateFrom) && date <= dateTo; };
	      const rows = [
	        ["SECCION", "FECHA", "ID", "TIPO", "DETALLE", "CANTIDAD", "MONTO", "CLIENTE", "USUARIO", "ESTADO"]
	      ];
	      let totalVentas = 0;
	      let salesCount = 0;
	      let movCount = 0;
	      state.sales.filter(s => s.businessId === biz.id && inRange(s.date)).forEach(s => {
	        if (s.status !== 'cancelled') { totalVentas += s.total || 0; salesCount++; }
	        (s.items || []).forEach(item => rows.push([
	          "VENTA",
	          s.when || s.date,
	          s.id,
	          s.method || '',
	          `${item.name || ''} ${item.code ? '[' + item.code + ']' : ''}`.trim(),
	          item.qty || 0,
	          item.price || 0,
	          s.customer || '',
	          s.createdBy || s.user || 'Sistema',
	          labelStatus(s.status)
	        ]));
	      });
	      state.movements.filter(m => m.businessId === biz.id && inRange(m.date)).forEach(m => {
	        movCount++;
	        rows.push(["MOVIMIENTO", m.when || m.date, m.id, m.kind || '', m.note || '', '', m.amount || 0, '', m.createdBy || m.user || 'Sistema', m.status || 'OK']);
	      });
	      (state.invoices || []).filter(i => i.businessId === biz.id && inRange(i.date)).forEach(i => {
	        rows.push(["FACTURA", i.date, i.id, i.provider || '', i.number || '', '', i.amount || 0, '', i.createdBy || 'Sistema', i.status === 'cancelled' ? 'ANULADA' : 'OK']);
	      });
	      rows.push([]);
	      rows.push(["RESUMEN", "NEGOCIO", biz.name, "PERIODO", `${dateFrom} al ${dateTo}`, "", "", "", "", ""]);
	      rows.push(["RESUMEN", "TOTAL VENTAS", "", "", "", "", totalVentas, "", "", ""]);
	      const csv = rows.map(row => row.map(csvCell).join(',')).join('\n');
	      const a = document.createElement('a');
	      const objectUrl = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8' }));
	      a.href = objectUrl;
	      a.download = `Reporte_Contable_${slug(biz.name)}_${dateFrom}_a_${dateTo}.csv`;
	      a.click();
	      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
	      return { totalVentas, salesCount, movCount, csv: true };
	    }

    const exp = $('#exportCsvBtn');
    if(exp) exp.onclick = () => {
	      const dateFrom = $('#csvDateFrom')?.value || '';
	      const dateTo = $('#csvDateTo')?.value || today();
	      if (!window.XLSX) {
	         downloadCsvFallback(dateFrom, dateTo);
	         toast('Sin internet para Excel. Se descargó reporte CSV.', 'ok');
	         return;
	      }
      try {
         const info = generateExcelReport(dateFrom, dateTo);
         toast(`Reporte Excel generado con éxito`, 'ok');
      } catch (err) {
         console.error(err);
         toast('Error al generar archivo Excel', 'err');
      }
    };

    const sendBtn = $('#sendReportBtn');
    if (sendBtn) sendBtn.onclick = () => {
	      const dateFrom = $('#csvDateFrom')?.value || today();
	      const dateTo = $('#csvDateTo')?.value || today();
	      try {
	         const info = window.XLSX ? generateExcelReport(dateFrom, dateTo) : downloadCsvFallback(dateFrom, dateTo);
	         const bizName = currentBusiness().name;

         const text = `📊 *Reporte Contable — ${bizName}*\n📅 Periodo: ${dateFrom} al ${dateTo}\n\n💰 Total Ventas: $${info.totalVentas.toFixed(2)}\n🧾 Transacciones de venta: ${info.salesCount}\n📋 Movimientos de caja: ${info.movCount}\n\n_Reporte generado por CLICK 360_\n_Por favor descarga el archivo EXCEL adjunto para ver los detalles._`;

	         toast(`${info.csv ? 'CSV' : 'Excel'} descargado. Abriendo WhatsApp... Adjunta el archivo al chat.`, 'ok', 6000);
         setTimeout(() => {
	            window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
         }, 1000);
      } catch (err) {
         console.error(err);
         toast('Error al generar Excel para WhatsApp', 'err');
      }
    };

	    const cloudBtn = $('#cloudSoon');
	    if (cloudBtn) {
	       cloudBtn.onclick = async () => {
	          if (window.click360SyncNow) {
	             const synced = await window.click360SyncNow();
	             toast(synced ? 'Sincronizado con la nube' : 'No se pudo sincronizar', synced ? 'ok' : 'err');
          } else {
             toast('Preparado para CLICK 360 Cloud. Requiere backend real.');
          }
       };
    }
  }

  window.cancelSale = async function(saleId) {
	  saleId = decodeActionId(saleId);
    if (authUser().role !== 'owner') {
      return toast('Solo el propietario puede anular ventas', 'err');
    }
    if(!confirm('\u00bfSeguro que deseas anular esta venta? Esto no se puede deshacer y devolver\u00e1 el stock.')) return;
    const businessId = currentBusiness()?.id;
    const sale = salesForBiz(businessId).find(s=>s.id === saleId);
    if(!sale) return toast('Venta no encontrada', 'err');
    if(sale.status === 'cancelled') return toast('Esta venta ya fue anulada.', 'err');
    if(isBusinessDateClosed(sale.date, businessId)) return toast('Reabre la caja de esa fecha antes de anular la venta.', 'err');
    const reason = prompt('Motivo de anulación:');
    if(!reason || !reason.trim()) return toast('Debes indicar el motivo de anulación', 'err');
    const previousState = cloneState(state);

    // Devolver stock
	    saleItems(sale).forEach(i => {
	       const p = state.products.find(prod=>prod.id === i.id && prod.businessId === businessId);
	       if(p) { p.qty += i.qty; p.updatedAtMs = Date.now(); p.updatedAt = new Date().toISOString(); p.updatedBy = authUser().name; }
	    });

	    sale.status = 'cancelled';
	    sale.cancelledBy = authUser().name || 'Usuario';
	    sale.cancelledAt = nowLabel();
	    sale.cancelledAtMs = Date.now();
	    sale.cancelReason = reason.trim();
	    sale.updatedAt = new Date().toISOString();
	    sale.updatedAtMs = Date.now();
	    const linkedLayaway = state.layaways?.find((item) => item.saleId === sale.id && item.businessId === businessId);
	    if (linkedLayaway) {
	      linkedLayaway.status = 'cancelled';
	      linkedLayaway.cancelledAt = new Date().toISOString();
	      linkedLayaway.cancelReason = reason.trim();
	    }

    // Anular todos los movimientos ligados a la venta, incluyendo abonos.
    const linkedMovements = state.movements.filter(m => m.businessId === businessId && m.saleId === sale.id && m.status !== 'cancelled');
    linkedMovements.forEach(mov => {
       mov.status = 'cancelled';
       mov.cancelledBy = authUser().name || 'Usuario';
       mov.cancelledAt = nowLabel();
       mov.cancelReason = reason.trim();
       mov.originalAmount = mov.amount;
       mov.amount = 0;
    });

    state.movements.push({
       id:uid('mov'),
	       operationId:`cancel:${sale.id}`,
	       businessId,
       date:today(),
       when:nowLabel(),
       kind:'retiro',
       amount:0,
       originalAmount:sale.total,
       note:`Venta anulada: ${reason.trim()}`,
       user:authUser().name,
       saleId:sale.id,
       createdBy:authUser().name,
       status:'cancelled',
       cancelledBy:authUser().name || 'Usuario',
       cancelledAt:nowLabel(),
       cashSessionId:currentOpenCashSession(businessId)?.id||'',
       createdAtMs:Date.now()
    });

    addAudit('sale_cancelled', { saleId: sale.id, total: sale.total, reason: reason.trim(), linkedMovements: linkedMovements.length });
    const committed = await commitCriticalMutation(previousState, 'sale_cancelled', (next) =>
      next.sales.some((item) => item.id === sale.id && item.businessId === businessId && item.status === 'cancelled'));
    renderApp('reports');
    if (committed.ok) toast(committed.pending ? 'Anulación guardada; sincronización pendiente.' : 'Venta anulada y stock devuelto');
  };

  window.payLayaway = async function(saleId) {
	  saleId = decodeActionId(saleId);
    if (!isDayStarted()) return toast('Debes iniciar caja diaria antes de registrar abonos', 'err');
    if (isDayClosed()) return toast('La caja de hoy ya está cerrada', 'err');
    const businessId = currentBusiness()?.id;
    const sale = salesForBiz(businessId).find(s=>s.id === saleId);
    if(!sale) return toast('Venta no encontrada', 'err');
    if(!['layaway','pending_payment'].includes(sale.status)) return toast('Esta cuenta no tiene saldo pendiente', 'err');

    const amountStr = prompt(`Saldo pendiente: ${fmt(sale.balance)}\nIngrese el monto a abonar:`);
    if(!amountStr) return;
    const amount = parseMoney(amountStr);
    if(!Number.isFinite(amount) || amount <= 0) return toast('Monto inválido', 'err');
    if(amount > sale.balance) return toast('El abono no puede superar el saldo pendiente', 'err');
	    const previousState = cloneState(state);
	    const paymentId = uid('pay');

	    sale.received = (sale.received || 0) + amount;
	    sale.balance -= amount;
	    sale.payments ||= [];
	    sale.payments.push({
	      id: paymentId,
	      operationId: paymentId,
	      date: today(),
	      when: nowLabel(),
	      amount,
	      method: 'Efectivo',
	      createdBy: authUser().name
	    });
	    sale.updatedAt = new Date().toISOString();
	    sale.updatedAtMs = Date.now();
	    const linkedLayaway = state.layaways?.find((item) => item.saleId === sale.id && item.businessId === businessId);
	    if (linkedLayaway) {
	      linkedLayaway.paid = sale.received;
	      linkedLayaway.balance = sale.balance;
	      linkedLayaway.payments = sale.payments.map((payment) => ({ ...payment }));
	      linkedLayaway.status = sale.balance <= 0 ? 'paid' : 'partially_paid';
	      linkedLayaway.updatedAt = sale.updatedAt;
	    }

	    if(sale.balance <= 0) sale.status = 'paid';

    state.movements.push({
      id: uid('mov'),
      operationId: paymentId,
      businessId,
      date: today(),
      when: nowLabel(),
      kind: 'ingreso',
      amount: amount,
      note: `Abono a ticket ${saleId}`,
      user: authUser().name,
      saleId: sale.id,
      paymentMethod: 'Efectivo',
      paymentType: 'receivable_payment',
	      cashSessionId: currentOpenCashSession(businessId)?.id || '',
	      createdAtMs: Date.now(),
      createdBy: authUser().name
    });
    addAudit('sale_payment_received', { saleId: sale.id, amount, balance: sale.balance });
    const committed = await commitCriticalMutation(previousState, 'sale_payment_received', (next) =>
      next.sales.some((item) => item.id === sale.id && item.businessId === businessId
        && item.payments?.some((payment) => payment.id === paymentId)));
    renderApp(route);
    if (committed.ok) {
      const remoteSale = salesForBiz(businessId).find((item) => item.id === sale.id);
      toast(committed.pending
        ? 'Abono guardado; sincronización pendiente.'
        : remoteSale?.balance <= 0 ? 'Cuenta saldada en su totalidad' : `Abono registrado. Nuevo saldo: ${fmt(remoteSale?.balance || 0)}`);
    }
  };

	  window.showSaleCompleteModal = function(id) {
		  id = decodeActionId(id);
	    const business = currentBusiness();
	    const s = salesForBiz(business?.id).find(x=>x.id===id);
	    if(!s) return;
	    if (!business || s.businessId !== business.id) return toast('El comprobante pertenece a otro negocio y fue bloqueado.', 'err');
	    const receiptTemplate = receiptTemplatePreferences();
      const receiptHtml = buildReceiptPaperHtml(s, business, receiptTemplate, { preview:true, forceSheet:true });
      const receiptJob = () => receiptPrintJob(s, business, receiptTemplate, { filename: `Recibo_${s.id.slice(-6).toUpperCase()}.pdf` });

    showModal(`
      <div class="modalHeader"><h2>Venta Completada</h2><button class="closeBtn" data-close>×</button></div>
      <p style="color:var(--green); text-align:center; font-weight:bold; margin-bottom:12px;">✓ Guardado exitosamente</p>

      <div style="display:flex; justify-content:center; margin-bottom:16px;">
        <div style="max-height:220px; overflow-y:auto; border:1px solid #444; border-radius:12px; background:#fff; padding:4px;">
          ${receiptHtml}
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">
	        <button class="btn primary" id="printReceiptBtn">${icon('printer')} Imprimir ticket</button>
	        <button class="btn silver" id="downloadPdfBtn">${icon('file-down')} Guardar PDF</button>
	        <button class="btn silver" id="downloadImgBtn" style="grid-column:1/-1;">${icon('image-down')} Guardar PNG</button>
	        ${s.customerPhone && Number(s.balance || 0) > 0 ? `<button class="btn" style="grid-column: 1 / -1; border:1px solid #25D366; color:#25D366; background:transparent;" id="whatsappReminderBtn">💬 Recordatorio WhatsApp</button>` : ''}
      </div>
      <button class="btn block" id="doneSaleBtn" style="border:1px solid var(--gold); color:var(--gold);">Listo / Nueva Venta</button>
    `);

    const waBtn = $('#whatsappReminderBtn');
    if (waBtn) {
       waBtn.onclick = () => {
	         const phone = window.CLICK360_V16_DOMAIN?.normalizePhone(s.customerPhone || '') || '';
	         const bizName = business.name;
         const text = `Hola ${s.customer}, te saludamos de ${bizName}. Queremos recordarte que tienes un saldo pendiente por un total de ${fmt(s.total)}, con un abono de ${fmt(s.received)} y un saldo pendiente de ${fmt(s.balance)}. La fecha límite de pago y retiro es el ${s.dueDate || ''}. Muchas gracias.`;
	         const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
	         window.open(url, '_blank', 'noopener,noreferrer');
       };
    }

		    $('#printReceiptBtn').onclick = () => printReceiptWithFallback(s, business, receiptTemplate, 'system');
		    $('#downloadPdfBtn').onclick = () => handoffPrint(receiptJob(), 'pdf');

    $('#downloadImgBtn').onclick = () => {
      downloadHtmlAsPng(receiptHtml, `Recibo_${s.id.slice(-6).toUpperCase()}.png`);
    };

    $('#doneSaleBtn').onclick = () => {
      closeModal();
    };
  };

	  window.editMovement = function(id) {
	  id = decodeActionId(id);
    if (authUser().role !== 'owner') {
      return toast('Solo el propietario puede editar transacciones', 'err');
    }
	    const businessId = currentBusiness()?.id;
	    const m = movementsForBiz(businessId).find(x => x.id === id);
    if (!m) return toast('Movimiento no encontrado', 'err');
	    if (isBusinessDateClosed(m.date, businessId)) return toast('Reabre la caja de esa fecha antes de editar el movimiento.', 'err');
	    const linkedSale = m.saleId ? salesForBiz(businessId).find((sale) => sale.id === m.saleId) : null;
	    const linkedSaleSummary = linkedSale ? `<section class="movementSaleSummary"><header><span><b>Detalle de venta asociado</b><small>Solo lectura. El comprobante y sus productos no se modifican desde movimientos.</small></span><strong>${fmt(linkedSale.total)}</strong></header><div>${saleItems(linkedSale).map((item) => `<p><span>${Number(item.qty || 0)}× ${escapeHtml(item.name || 'Producto')}</span><b>${fmt(receiptLineTotal(item))}</b></p>`).join('')}</div><footer><span>${escapeHtml(linkedSale.method || 'Sin método')}</span><span>${escapeHtml(linkedSale.customer || 'Consumidor final')}</span></footer></section>` : '';

	    showModal(`<div class="modalHeader"><h2>Editar movimiento</h2><button class="closeBtn" data-close>×</button></div>
	      ${linkedSaleSummary}
      <form id="editMoveForm">
        <div class="field">
          <label>Tipo</label>
          <select id="emKind">
            <option value="ingreso" ${m.kind==='ingreso'?'selected':''}>Ingreso</option>
            <option value="egreso" ${m.kind==='egreso'?'selected':''}>Gasto</option>
            <option value="compra" ${m.kind==='compra'?'selected':''}>Compra</option>
            <option value="retiro" ${m.kind==='retiro'?'selected':''}>Retiro</option>
            <option value="apertura" ${m.kind==='apertura'?'selected':''}>Apertura</option>
          </select>
        </div>
        <div class="field">
          <label>Monto</label>
          <input id="emAmount" type="text" inputmode="decimal" value="${String(m.amount).replace('.',',')}">
        </div>
        <div class="field">
          <label>Nota</label>
          <input id="emNote" required value="${escapeHtml(m.note || '')}">
        </div>
        <button type="submit" class="btn primary block">Guardar cambios</button>
      </form>`);

    const emAmountInput = $('#emAmount');
    if (emAmountInput) {
       emAmountInput.oninput = () => { emAmountInput.value = emAmountInput.value.replace(/[^0-9.,]/g, ''); };
    }

    $('#editMoveForm').onsubmit = async (e) => {
       e.preventDefault();
       const k = $('#emKind').value;
       const a = parseMoney($('#emAmount').value);
       const n = $('#emNote').value.trim();
       if (!Number.isFinite(a) || a < 0) return toast('Monto inválido', 'err');
	       const previousState = cloneState(state);
	       const operationId = uid('movementedit');

       m.kind = k;
       m.amount = a;
       m.note = n;
       m.updatedBy = authUser().name;
	       m.updatedAt = new Date().toISOString();
	       m.operationId = operationId;
	       addAudit('cash_movement_updated', { movementId: m.id, businessId, operationId });
	       const committed = await commitCriticalMutation(previousState, 'cash_movement_updated', (next) =>
	         next.movements.some((movement) => movement.id === m.id && movement.businessId === businessId && movement.operationId === operationId));
       closeModal();
       renderApp('cash');
	       if (committed.ok) toast(committed.pending ? 'Movimiento actualizado; sincronización pendiente.' : 'Movimiento actualizado');
    };
  };

	window.deleteMovement = async function(id) {
	  id = decodeActionId(id);
    if (authUser().role !== 'owner') {
      return toast('Solo el propietario puede anular transacciones', 'err');
    }
    if (!confirm('\u00bfSeguro que deseas anular este movimiento? Se conservar\u00e1 el registro.')) return;

	    const businessId = currentBusiness()?.id;
	    const mov = movementsForBiz(businessId).find(x => x.id === id);
    if (!mov) return toast('Movimiento no encontrado', 'err');
	    if (mov.status === 'cancelled') return toast('Este movimiento ya fue anulado.', 'err');
	    if (isBusinessDateClosed(mov.date, businessId)) return toast('Reabre la caja de esa fecha antes de anular el movimiento.', 'err');
	    const previousState = cloneState(state);
	    const operationId = uid('movementcancel');

    // Soft delete: mark as cancelled with audit trail
    mov.status = 'cancelled';
    mov.cancelledBy = authUser().name || 'Propietario';
    mov.cancelledAt = nowLabel();
    mov.originalAmount = mov.amount;
    mov.amount = 0;
	    mov.operationId = operationId;
	    addAudit('cash_movement_cancelled', { movementId: mov.id, businessId, operationId });

	    const committed = await commitCriticalMutation(previousState, 'cash_movement_cancelled', (next) =>
	      next.movements.some((movement) => movement.id === mov.id && movement.businessId === businessId
	        && movement.status === 'cancelled' && movement.operationId === operationId));
    renderApp('cash');
	    if (committed.ok) toast(committed.pending ? 'Movimiento anulado; sincronización pendiente.' : `Movimiento anulado por ${mov.cancelledBy} a las ${mov.cancelledAt}`);
  };

  window.printReceipt = function(id) {
    window.showSaleCompleteModal(id);
  };

	  window.sendWhatsAppReminder = function(id) {
		  id = decodeActionId(id);
	    const s = salesForBiz().find(x => x.id === id);
    if (!s) return;
	    const phone = window.CLICK360_V16_DOMAIN?.normalizePhone(s.customerPhone || '') || '';
    const bizName = currentBusiness().name;
    const text = `Hola ${s.customer}, te saludamos de ${bizName}. Queremos recordarte que tienes un saldo pendiente por un total de ${fmt(s.total)}, con un abono de ${fmt(s.received)} y un saldo pendiente de ${fmt(s.balance)}. La fecha límite de pago y retiro es el ${s.dueDate || ''}. Muchas gracias.`;
	    const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  window.viewDailyReport = function(id) {
	 id = decodeActionId(id);
     const r = state.dailyReports?.find(x=>x.id===id);
     if(!r) return;
     const reportHtml = sanitizeStoredReportHtml(r.html);
     showModal(`<div class="modalHeader"><h2>Resumen de Cierre</h2><button class="closeBtn" data-close>×</button></div>
       <div style="background:#fff; border-radius:8px; border:1px solid #ccc; max-height:40vh; overflow-y:auto; margin-bottom:15px; padding:10px; display:flex; justify-content:center;">
         <div id="pdfContentPreview" style="transform: scale(0.85); transform-origin: top center;">
           ${reportHtml}
         </div>
       </div>
	       <div style="display:flex; gap:10px;">
	           <button class="btn silver block" id="printCierreBtn">Imprimir</button>
	           <button class="btn silver block" id="downloadPdfCierreBtn">Guardar PDF</button>
	           <button class="btn primary block" id="downloadImgCierreBtn">Descargar Imagen (PNG)</button>
	       </div>
	     `);
	     $('#printCierreBtn').onclick = () => handoffPrint({ html: reportHtml, media: 'a4', filename: `Cierre_Caja_${r.date}.pdf` }, 'system');
	     $('#downloadPdfCierreBtn').onclick = () => handoffPrint({ html: reportHtml, media: 'a4', filename: `Cierre_Caja_${r.date}.pdf` }, 'pdf');
     $('#downloadImgCierreBtn').onclick = () => {
          downloadHtmlAsPng(reportHtml, `Cierre_Caja_${r.date}.png`);
      };
  };

  window.printReports = function(mode = 'print') {
    state.reportsFrom = state.reportsFrom || today();
    state.reportsTo = state.reportsTo || today();
	    const allSales = salesForBiz();
	    const sales = allSales.filter(s => s.date >= state.reportsFrom && s.date <= state.reportsTo);
	    const validSales = sales.filter(s => s.status!=='cancelled');
	    const soldTotal = validSales.reduce((a,s)=>a+(Number(s.total)||0),0);
	    const collectedTotal = validSales.reduce((a,s)=>a+collectedAmount(s),0);
	    const pendingTotal = validSales.reduce((a,s)=>a+Number(s.balance || 0),0);
	    const tickets = validSales.length;
	    const counts={}; validSales.forEach(s=>saleItems(s).forEach(i=>counts[i.name]=(counts[i.name]||0)+i.qty));
    const top = Object.entries(counts).sort((a,b)=>b[1]-a[1]);

    // Anulados
    const cancelled = sales.filter(s => s.status==='cancelled');

    const html = `
      <div style="font-family:sans-serif; color:#000; font-size:12px; margin:0; padding:20px; background:white;">
      <h2 style="font-size:20px; margin:0 0 10px;">${escapeHtml(currentBusiness().name)} - Reporte General</h2>
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Periodo:</span><span>${state.reportsFrom} a ${state.reportsTo}</span></div>
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Impreso:</span><span>${nowLabel()}</span></div>
      <div style="border-top:1px solid #ccc; margin:12px 0;"></div>

      <div style="width:100%; max-width:400px; margin:0 auto 20px;">
        <h3 style="margin-top:10px; text-align:center;">Crecimiento de Ventas (7 días)</h3>
        ${buildChartHtml(allSales).replace(/var\\(--gold\\)/g, '#D4AF37').replace(/var\\(--line\\)/g, '#ddd').replace(/var\\(--muted\\)/g, '#666')}
      </div>

	      <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Vendido:</span><strong>${fmt(soldTotal)}</strong></div>
	      <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Cobrado:</span><strong>${fmt(collectedTotal)}</strong></div>
	      <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Pendiente:</span><strong>${fmt(pendingTotal)}</strong></div>
	      <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Tickets Exitosos:</span><strong>${tickets}</strong></div>
	      <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Promedio cobrado:</span><strong>${fmt(tickets?collectedTotal/tickets:0)}</strong></div>
      <div style="border-top:1px solid #ccc; margin:12px 0;"></div>
      <h3 style="margin-top:10px;">Productos Más Vendidos</h3>
      <table style="width:100%; border-collapse:collapse; margin-top:10px;">
        <tr><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Producto</th><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Cant. Vendida</th></tr>
        ${top.map(([n,c])=>`<tr><td style="text-align:left; padding:6px; border-bottom:1px solid #eee;">${escapeHtml(n)}</td><td style="text-align:left; padding:6px; border-bottom:1px solid #eee;">${c}</td></tr>`).join('')}
      </table>
      <div style="border-top:1px solid #ccc; margin:12px 0;"></div>
      <h3 style="margin-top:10px;">Historial de Tickets</h3>
      <table style="width:100%; border-collapse:collapse; margin-top:10px;">
        <tr><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Fecha/Hora</th><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Vendedor</th><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Método</th><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Estado</th><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Total</th></tr>
        ${sales.slice().reverse().map(s=>`<tr><td style="text-align:left; padding:6px; border-bottom:1px solid #eee;">${escapeHtml(s.when)}</td><td style="text-align:left; padding:6px; border-bottom:1px solid #eee;">${escapeHtml(s.createdBy || s.user || 'Sistema')}</td><td style="text-align:left; padding:6px; border-bottom:1px solid #eee;">${escapeHtml(s.method)}</td><td style="text-align:left; padding:6px; border-bottom:1px solid #eee;">${escapeHtml(labelStatus(s.status))}</td><td style="text-align:left; padding:6px; border-bottom:1px solid #eee;">${fmt(s.total)}</td></tr>`).join('')}
      </table>

      ${cancelled.length > 0 ? `
      <div style="border-top:1px solid #ccc; margin:12px 0;"></div>
      <h3 style="margin-top:10px; color:#d9534f;">Anulaciones</h3>
      <table style="width:100%; border-collapse:collapse; margin-top:10px;">
        <tr><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Fecha Anulación</th><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Anulado por</th><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Vendedor Orig.</th><th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">Total</th></tr>
        ${cancelled.slice().reverse().map(s=>`<tr><td style="text-align:left; padding:6px; border-bottom:1px solid #eee;">${escapeHtml(s.cancelledAt || s.when)}</td><td style="text-align:left; padding:6px; border-bottom:1px solid #eee; color:#d9534f;">${escapeHtml(s.cancelledBy || 'Desconocido')}</td><td style="text-align:left; padding:6px; border-bottom:1px solid #eee;">${escapeHtml(s.createdBy || s.user || 'Sistema')}</td><td style="text-align:left; padding:6px; border-bottom:1px solid #eee;">${fmt(s.total)}</td></tr>`).join('')}
      </table>
      ` : ''}

      </div>`;

	    if (mode === 'print') {
	        handoffPrint({ html, media: 'a4', filename: `Reporte_Ventas_${state.reportsFrom}.pdf` }, 'system');
	    } else if (mode === 'pdf') {
	        handoffPrint({ html, media: 'a4', filename: `Reporte_Ventas_${state.reportsFrom}.pdf` }, 'pdf');
    } else if (mode === 'image') {
        downloadHtmlAsPng(html, `Reporte_Ventas_${state.reportsFrom}.png`, { width: '800px', useCORS: true });
    }
  };

	  window.click360Route=renderApp;
	  window.click360SetSession = setSession;
	  window.addEventListener('click360-sync-status', () => {
	    const info = syncStatusInfo();
	    const side = $('#syncStatusPill');
	    if (side) side.outerHTML = syncPillHtml(false);
	    const top = $('#syncStatusPillTop');
	    if (top) top.outerHTML = syncPillHtml(true);
	    const title = $('#cloudStatusDynamic');
	    if (title) title.textContent = `★ ${info.title}`;
	    const detail = $('#cloudStatusDetail');
	    if (detail) detail.textContent = info.detail;
	  });
		  window.addEventListener('click360-access-changed', () => {
		    if (currentUser()) renderApp(route);
		  });
		  window.addEventListener('click360-online-only-commit', (event) => {
        const key = commitCheckpointKey(event.detail || {});
        const checkpoint = key ? onlineOnlyCommitCheckpoints.get(key) : null;
        if (!checkpoint || checkpoint.context !== activeTenantContext
          || Number(event.detail?.updatedAtMs || 0) !== checkpoint.updatedAtMs) return;
        onlineOnlyCommitCheckpoints.delete(key);
        const exactCurrentState = Number(state.updatedAtMs || 0) === checkpoint.updatedAtMs;
        if (event.detail?.success === true) {
          if (exactCurrentState) rememberPersistedState();
          toast('Cambio guardado en la nube.', 'ok');
          return;
        }
        const scope = contextScope(checkpoint.context);
        const hasNewerCheckpoint = [...onlineOnlyCommitCheckpoints.values()].some((item) =>
          contextScope(item.context) === scope && item.updatedAtMs > checkpoint.updatedAtMs);
        if (exactCurrentState && !hasNewerCheckpoint) {
          restoreCriticalSnapshot(checkpoint.previousState, { source: 'online_only_failed', pendingRemoteSync: false });
          renderApp(route);
          toast('No pudimos guardar el cambio. La información anterior sigue intacta.', 'err');
          return;
        }
        toast('Una operación anterior no se confirmó; el cambio más reciente permanece protegido.', 'err');
		  });

	  // Safety net for mutations that have not yet persisted through their action handler.
  setInterval(() => {
    if (!currentUser() || !activeTenantContext) return;
    try {
      const currentHash = JSON.stringify(state);
      if (currentHash !== lastAutoSaveHash) {
        if (save()) {
          lastAutoSaveHash = JSON.stringify(state);
          console.log('[CLICK360] Auto-save ejecutado');
        }
      }
    } catch(e) {}
  }, 30000);
  // --- INVOICES MODULE ---
  function invoicesView() {
    const biz = currentBusiness();
    const invs = (state.invoices || []).filter(i => i.businessId === biz.id);

    // Default dates: start of this month to today
    const firstDay = localDateKey(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    const lastDay = today();

    return `<div class="pageHead">
        <div>
          <h1>Facturas de Proveedores</h1>
          <p>Control y archivo digital de tus facturas de compras.</p>
        </div>
        <button class="btn primary" id="newInvoiceBtn">➕ Registrar Factura</button>
      </div>

      <section class="card sectionCard">
         <h3>Buscar y Filtrar</h3>
         <div class="formGrid" style="margin-bottom:12px;">
            <div class="field"><label>Proveedor / N° Factura</label><input type="text" id="invoiceSearch" placeholder="Buscar..."></div>
            <div class="field"><label>Desde</label><input type="date" id="invoiceDateFrom" value="${firstDay}"></div>
            <div class="field"><label>Hasta</label><input type="date" id="invoiceDateTo" value="${lastDay}"></div>
         </div>
         <button type="button" class="btn block" id="filterInvoicesBtn">🔍 Aplicar Filtros</button>
      </section>

      <section class="card sectionCard" style="margin-top:14px">
         <h3>Historial de Facturas</h3>
         <div id="invoiceList" class="movementList">
            <!-- Invoices list goes here -->
         </div>
      </section>`;
  }

  function invoiceListHtml(filteredInvoices) {
    if (filteredInvoices.length === 0) {
      return '<p class="empty">No se encontraron facturas en este periodo.</p>';
    }
    return filteredInvoices.slice().reverse().map(i => {
      const imageSrc = safeImageSrc(i.imageData);
      const invoiceId = actionId(i.id);
      const cancelled = i.status === 'cancelled';
      const imgBtn = imageSrc ?
         `<button class="btn silver mini" onclick="window.viewInvoiceImage('${invoiceId}')" style="padding:4px 8px; font-size:12px; margin-right:8px;">👁️ Ver Foto</button>` :
         `<span style="font-size:11px; color:var(--muted); margin-right:8px;">Sin foto</span>`;

      return `<div class="movementItem" style="padding:12px; border-bottom:1px solid #333; display:flex; justify-content:space-between; align-items:center;${cancelled ? 'opacity:.65;' : ''}">
         <div style="flex:1; min-width:0;">
            <div style="font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(i.provider)}</div>
            <small style="color:var(--muted); display:block; margin:2px 0;">Factura: ${escapeHtml(i.number)} | Fecha: ${escapeHtml(i.date)}</small>
            ${i.notes ? `<small style="color:#aaa; font-style:italic; display:block;">Nota: ${escapeHtml(i.notes)}</small>` : ''}
            <small style="color:var(--muted); display:block; font-size:10px;">Atendido por: ${escapeHtml(i.createdBy || 'Sistema')} ${cancelled ? '· ANULADA' : ''}</small>
         </div>
         <div style="text-align:right; margin-left:12px;">
            <div style="font-weight:bold; color:var(--gold); font-size:16px; margin-bottom:6px;">${fmt(i.amount)}</div>
            <div style="display:flex; align-items:center; justify-content:flex-end;">
               ${imgBtn}
               ${cancelled ? '' : `<button class="btn danger mini" onclick="window.deleteInvoice('${invoiceId}')" style="padding:4px 8px; font-size:12px;">🗑️</button>`}
            </div>
         </div>
      </div>`;
    }).join('');
  }

  function bindInvoices() {
    const list = $('#invoiceList');
    const biz = currentBusiness();

    const filterAndRender = () => {
       const q = $('#invoiceSearch')?.value.toLowerCase() || '';
       const dateFrom = $('#invoiceDateFrom')?.value || '';
       const dateTo = $('#invoiceDateTo')?.value || today();

       const allInvs = state.invoices || [];
       const filtered = allInvs.filter(i => {
          const matchBiz = i.businessId === biz.id;
          const matchQuery = String(i.provider || '').toLowerCase().includes(q) || String(i.number || '').toLowerCase().includes(q) || String(i.notes || '').toLowerCase().includes(q);
          const matchDate = (!dateFrom || i.date >= dateFrom) && i.date <= dateTo;
          return matchBiz && matchQuery && matchDate;
       });

       list.innerHTML = invoiceListHtml(filtered);
    };

    $('#newInvoiceBtn').onclick = () => openInvoiceModal(null, filterAndRender);
    $('#filterInvoicesBtn').onclick = filterAndRender;
    if ($('#invoiceSearch')) $('#invoiceSearch').oninput = filterAndRender;

    // Expose helpers globally so they work in inline onclick
    window.viewInvoiceImage = (id) => {
	   id = decodeActionId(id);
	       const inv = (state.invoices || []).find(x => x.id === id && x.businessId === biz.id);
       const imageSrc = safeImageSrc(inv?.imageData);
       if (inv && imageSrc) {
          showModal(`<div class="modalHeader"><h2>Factura de ${escapeHtml(inv.provider)}</h2><button class="closeBtn" data-close>×</button></div>
             <div style="text-align:center; padding:10px; background:#000;">
                <img src="${escapeHtml(imageSrc)}" style="max-width:100%; max-height:75vh; border-radius:8px; border:1px solid #333;" alt="Foto de factura">
             </div>
             <button class="btn block primary" style="margin-top:10px;" data-close>Cerrar Vista</button>`);
       }
    };

	    window.deleteInvoice = async (id) => {
	   id = decodeActionId(id);
       if (!isOwnerUser()) return toast('Solo el dueño puede anular facturas.', 'err');
	       const invoice = (state.invoices || []).find(x => x.id === id && x.businessId === biz.id);
       if (!invoice || invoice.status === 'cancelled') return;
	       if (isBusinessDateClosed(invoice.date, biz.id)) return toast('Reabre la caja de esa fecha antes de anular la factura.', 'err');
       if (confirm('¿Anular esta factura? Se conservará el registro y también se anulará su movimiento de caja.')) {
	          const previousState = cloneState(state);
	          const operationId = uid('invoicecancel');
          invoice.status = 'cancelled';
	          invoice.operationId = operationId;
          invoice.originalAmount = invoice.amount;
          invoice.amount = 0;
          invoice.cancelledBy = authUser().name || 'Propietario';
          invoice.cancelledAt = nowLabel();
	          const linked = state.movements.filter(m => m.businessId === biz.id && m.invoiceId === id && m.status !== 'cancelled');
          linked.forEach(movement => {
            movement.status = 'cancelled';
            movement.originalAmount = movement.amount;
            movement.amount = 0;
            movement.cancelledBy = invoice.cancelledBy;
            movement.cancelledAt = invoice.cancelledAt;
          });
	          addAudit('supplier_invoice_cancelled', { invoiceId: id, linkedMovements: linked.length, operationId });
	          const committed = await commitCriticalMutation(previousState, 'supplier_invoice_cancelled', (next) =>
	            next.invoices.some((item) => item.id === id && item.businessId === biz.id
	              && item.status === 'cancelled' && item.operationId === operationId));
          filterAndRender();
	          if (committed.ok) toast(committed.pending ? 'Factura anulada; sincronización pendiente.' : 'Factura y movimiento anulados');
       }
    };

    // Initial render
    filterAndRender();
  }

  function openInvoiceModal(invoice = null, onSaved = null) {
    showModal(`<div class="modalHeader"><h2>Registrar Factura</h2><button class="closeBtn" data-close>×</button></div>
      <form id="invoiceForm" class="formGrid">
         <div class="field full productImageField">
	           <label>Foto de la Factura (opcional)</label>
	           <div class="imagePicker">
	             <div id="invoiceImagePreview"><span>Sin foto</span></div>
	             <div class="imagePickerActions">
	                <button type="button" class="btn silver" id="iImageGalleryBtn">Galería</button>
	                <button type="button" class="btn silver" id="iImageCameraBtn">Tomar foto</button>
	                <input type="file" id="iImageGal" accept="image/*" hidden>
	                <input type="file" id="iImageCam" accept="image/*" capture="environment" hidden>
	             </div>
	           </div>
         </div>
         <div class="field full"><label>Proveedor</label><input id="iProvider" required placeholder="Nombre del proveedor"></div>
         <div class="field"><label>N° Factura</label><input id="iNumber" required placeholder="Ej. 001-001-0000123"></div>
         <div class="field"><label>Fecha</label><input type="date" id="iDate" value="${today()}"></div>
         <div class="field"><label>Monto Total ($)</label><input id="iAmount" inputmode="decimal" required placeholder="0.00"></div>
         <div class="field full"><label>Notas / Descripción</label><textarea id="iNotes" placeholder="Detalle adicional..."></textarea></div>
         <button type="button" class="btn" data-close>Cancelar</button><button class="btn primary" type="submit">Guardar Factura</button>
      </form>`);

	    let imageData = '';
	    bindImageInputPair({
	      cameraInputId: 'iImageCam',
	      galleryInputId: 'iImageGal',
	      cameraButtonId: 'iImageCameraBtn',
	      galleryButtonId: 'iImageGalleryBtn',
	      onImage: (data) => {
	        imageData = data;
	        const safe = safeImageSrc(data);
	        imageData = safe;
	        $('#invoiceImagePreview').innerHTML = safe ? `<img src="${escapeHtml(safe)}" style="max-height:160px; object-fit:contain; border-radius:8px;" alt="Foto de factura">` : '<span>Sin foto</span>';
	      }
	    });

    const amountIn = $('#iAmount');
    if (amountIn) amountIn.oninput = () => { amountIn.value = amountIn.value.replace(/[^0-9.,]/g, ''); };

	    $('#invoiceForm').onsubmit = async e => {
       e.preventDefault();
       const provider = $('#iProvider').value.trim();
       const number = $('#iNumber').value.trim();
       const date = $('#iDate').value;
       const amount = parseMoney($('#iAmount').value);
       const notes = $('#iNotes').value.trim();

       if (!provider || !number || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(amount) || amount <= 0) {
          toast('Por favor completa todos los campos requeridos', 'err');
          return;
       }
	       const businessId = currentBusiness().id;
	       if (isBusinessDateClosed(date, businessId)) return toast('Reabre la caja de esa fecha antes de registrar la factura.', 'err');
	       const previousState = cloneState(state);
	       const operationId = uid('invoiceop');

       const newInv = {
          id: uid('inv'),
	          operationId,
	          businessId,
          provider,
          number,
          date,
          amount,
          notes,
          imageData,
          createdBy: authUser().name || 'Usuario',
          createdAt: nowLabel()
       };

       state.invoices ||= [];
       state.invoices.push(newInv);
       state.movements.push({
          id: uid('mov'),
	          operationId,
	          businessId,
          date,
          when: nowLabel(),
          kind: 'compra',
          amount,
          note: `Factura proveedor ${provider} #${number}`,
          invoiceId: newInv.id,
	          cashSessionId: currentOpenCashSession(businessId, date)?.id || '',
	          createdAtMs: Date.now(),
          createdBy: authUser().name || 'Usuario'
       });
	       addAudit('supplier_invoice_created', { invoiceId: newInv.id, provider, number, amount, operationId });
	       const committed = await commitCriticalMutation(previousState, 'supplier_invoice_created', (next) =>
	         next.invoices.some((item) => item.id === newInv.id && item.businessId === businessId && item.operationId === operationId));
	       if (!committed.ok) { closeModal(); if (onSaved) onSaved(); return; }

       closeModal();
	       toast(committed.pending ? 'Factura guardada; sincronización pendiente.' : 'Factura guardada con éxito', 'ok');
       if (onSaved) onSaved();
    };
  }

  window.CLICK360_QA={parseMoney, normalizeCode, productPayload, QR};

  window.addEventListener('online', () => { flushPendingProfile().catch(() => {}); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopScanner(); });
	  window.addEventListener('hashchange',()=>{ const h=location.hash.replace('#',''); if(['home','inventory','sell','cash','more','reports','settings','workers','backup','debtors','invoices','crm','reminders','access','legal','printing','tables','kitchen','bar','finance','help'].includes(h)) renderApp(h); });
  if('serviceWorker' in navigator) navigator.serviceWorker.register(`./service-worker.js?v=${APP_ASSET_VERSION}`).catch(()=>{});
  renderLogin();
})();
