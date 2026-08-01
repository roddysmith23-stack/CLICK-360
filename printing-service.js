(function (root) {
  'use strict';

  const VERSION = '16.2';
  const STATUS = Object.freeze({
    DISCONNECTED: 'disconnected',
    READY: 'ready',
    HANDING_OFF: 'handing_off',
    UNSUPPORTED: 'unsupported',
    VALIDATION_REQUIRED: 'validation_required',
    ERROR: 'error'
  });

  function safeError(error, fallback = 'No se pudo completar la impresión.') {
    const code = String(error?.code || 'print-failed').replace(/[^a-z0-9_./-]/gi, '').slice(0, 64);
    return { code, message: fallback };
  }

  function printRoot() {
    let element = document.getElementById('click360PrintPortal');
    if (!element) {
      element = document.createElement('div');
      element.id = 'click360PrintPortal';
      element.className = 'printSheet click360PrintPortal';
      document.body.appendChild(element);
    }
    return element;
  }

  function pageCss(job = {}) {
    const width = Math.max(10, Math.min(1000, Number(job.mediaWidthMm || job.widthMm || 0)));
    const height = Math.max(10, Math.min(2000, Number(job.mediaHeightMm || job.heightMm || 0)));
    const receiptMatch = /^receipt-(\d+)$/i.exec(String(job.media || ''));
    const receiptWidth = width || (receiptMatch ? Number(receiptMatch[1]) : 0);
    const pageSize = job.media === 'label' && width && height
      ? `${width}mm ${height}mm`
      : String(job.media || '').startsWith('receipt') && receiptWidth ? `${receiptWidth}mm auto`
      : job.media === 'receipt-80' ? '80mm auto'
        : job.media === 'receipt-57' ? '57mm auto' : 'A4';
    const margin = job.media === 'a4' || !job.media ? '8mm' : '0';
    return `@page{size:${pageSize};margin:${margin}}`;
  }

  async function waitForResources(element, timeoutMs = 5000) {
    if (!element?.childElementCount || !String(element.textContent || '').trim() && !element.querySelector('img,canvas,svg')) {
      throw Object.assign(new Error('El plan de impresión no contiene contenido renderizable.'), { code: 'print-plan-empty' });
    }
    const images = [...element.querySelectorAll('img')];
    const waits = images.map(async (image) => {
      if (!image.complete) await new Promise((resolve, reject) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', () => reject(Object.assign(new Error('No se pudo cargar un recurso de impresión.'), { code: 'print-resource-error' })), { once: true });
      });
      if (!image.naturalWidth || !image.naturalHeight) throw Object.assign(new Error('La imagen de impresión está vacía.'), { code: 'print-resource-empty' });
      if (typeof image.decode === 'function') await image.decode().catch(() => {});
    });
    if (document.fonts?.ready) waits.push(document.fonts.ready);
    const ready = Promise.all(waits).then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const timeout = new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('Los recursos de impresión no quedaron listos.'), { code: 'print-resource-timeout' })), timeoutMs));
    await Promise.race([ready, timeout]);
    const bounds = element.getBoundingClientRect?.();
    if (!bounds || bounds.width < 1 || bounds.height < 1 || element.scrollHeight < 1) {
      throw Object.assign(new Error('El plan de impresión no ocupa un área visible.'), { code: 'print-plan-no-layout' });
    }
  }

  function mountJob(job = {}) {
    const element = printRoot();
    const sourceNode = typeof Node !== 'undefined' && job.node instanceof Node ? job.node : null;
    const copies = Math.max(1, Math.min(50, Number(job.copies || 1)));
    element.replaceChildren();
    for (let index = 0; index < copies; index += 1) {
      const copy = document.createElement('section');
      copy.className = 'printCopy';
      if (sourceNode) copy.appendChild(sourceNode.cloneNode(true));
      else if (typeof job.render === 'function') job.render(copy, index);
      else copy.innerHTML = String(job.html || '');
      element.appendChild(copy);
    }
    element.dataset.printMedia = String(job.media || 'a4');
    let style = document.getElementById('click360-print-page-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'click360-print-page-style';
      document.head.appendChild(style);
    }
    style.textContent = pageCss(job);
    return element;
  }

  function cleanupJob() {
    const element = document.getElementById('click360PrintPortal');
    if (element) {
      element.classList.remove('click360PdfExportActive');
      element.removeAttribute('style');
      element.replaceChildren();
      delete element.dataset.printMedia;
    }
    document.getElementById('click360-print-page-style')?.remove();
  }

  class SystemPrintProvider {
    constructor() {
      this.id = 'system';
      this.name = 'Impresión del sistema';
      this.state = STATUS.READY;
    }
    isSupported() { return typeof root.print === 'function'; }
    async discover() { return [{ id: 'system-dialog', name: this.name, provider: this.id }]; }
    async connect() { this.state = this.isSupported() ? STATUS.READY : STATUS.UNSUPPORTED; return this.getStatus(); }
    async disconnect() { cleanupJob(); this.state = STATUS.DISCONNECTED; return this.getStatus(); }
    async forgetDevice() { return this.disconnect(); }
    getStatus() { return { id: this.id, name: this.name, state: this.state, supported: this.isSupported() }; }
    async print(job) {
      if (!this.isSupported()) throw Object.assign(new Error('Impresión del navegador no disponible.'), { code: 'system-print-unavailable' });
      this.state = STATUS.HANDING_OFF;
      const element = mountJob(job);
      await waitForResources(element);
      let cleaned = false;
      let cleanupTimer = null;
      const clean = () => {
        if (cleaned) return;
        cleaned = true;
        clearTimeout(cleanupTimer);
        root.removeEventListener('afterprint', clean);
        cleanupJob();
        this.state = STATUS.READY;
      };
      root.addEventListener('afterprint', clean, { once: true });
      cleanupTimer = setTimeout(clean, 30000);
      root.print();
      return { status: 'handed_off', provider: this.id };
    }
    testPrint() {
      return this.print({
        media: 'receipt-80',
        html: '<section class="printTestPage"><h1>CLICK 360</h1><p>Prueba de impresión</p><p>El diálogo del sistema está listo.</p><small>No válido como factura electrónica.</small></section>'
      });
    }
    printLabel(job) { return this.print({ ...job, media: job?.media || 'label' }); }
    printReceipt(job) { return this.print({ ...job, media: job?.media || 'receipt-80' }); }
  }

  class PdfExportProvider {
    constructor() { this.id = 'pdf'; this.name = 'Guardar PDF'; this.state = STATUS.READY; }
    isSupported() { return typeof root.html2pdf === 'function'; }
    async discover() { return [{ id: 'pdf-export', name: this.name, provider: this.id }]; }
    async connect() { return this.getStatus(); }
    async disconnect() { cleanupJob(); return this.getStatus(); }
    async forgetDevice() { return this.disconnect(); }
    getStatus() { return { id: this.id, name: this.name, state: this.isSupported() ? STATUS.READY : STATUS.UNSUPPORTED, supported: this.isSupported() }; }
    async print(job) {
      if (!this.isSupported()) throw Object.assign(new Error('PDF no disponible.'), { code: 'pdf-unavailable' });
      const element = mountJob(job);
      element.classList.add('click360PdfExportActive');
      // html2canvas omite con frecuencia nodos detrás del viewport. Lo dejamos fuera
      // de la pantalla pero renderizable, con tamaño físico real para tickets.
      element.style.cssText = 'display:block;position:absolute;left:-12000px;top:0;width:max-content;height:auto;max-width:none;max-height:none;overflow:visible;background:#ffffff;color:#000000;pointer-events:none;z-index:2147483647;visibility:visible;';
      await waitForResources(element);
      const width = Math.max(10, Math.min(1000, Number(job.mediaWidthMm || job.widthMm || 0)));
      const height = Math.max(10, Math.min(2000, Number(job.mediaHeightMm || job.heightMm || 0)));
      const receiptMatch = /^receipt-(\d+)$/i.exec(String(job.media || ''));
      const receiptWidth = width || (receiptMatch ? Number(receiptMatch[1]) : 0);
      const physicalHeight = Math.max(55, Math.min(1900, Math.ceil((element.scrollHeight / 96) * 25.4) + 4));
      const format = job.media === 'label' ? [width, height]
        : String(job.media || '').startsWith('receipt') && receiptWidth ? [receiptWidth, physicalHeight]
          : job.media === 'receipt-80' ? [80, 220]
            : job.media === 'receipt-57' ? [57, 220] : 'a4';
      try {
        await root.html2pdf().set({
          margin: job.media === 'label' ? 0 : job.media?.startsWith('receipt') ? 2 : 8,
          filename: String(job.filename || 'CLICK360.pdf').replace(/[^a-z0-9_.-]/gi, '_'),
          image: { type: 'jpeg', quality: 0.96 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
          jsPDF: { unit: 'mm', format, orientation: job.media === 'label' && width > height ? 'landscape' : 'portrait' }
        }).from(element).save();
        return { status: 'exported', provider: this.id };
      } finally {
        cleanupJob();
      }
    }
    testPrint() { return this.print({ filename: 'CLICK360_prueba.pdf', html: '<h1>CLICK 360</h1><p>Prueba de PDF</p>' }); }
    printLabel(job) { return this.print({ ...job, media: job?.media || 'label' }); }
    printReceipt(job) { return this.print({ ...job, media: job?.media || 'receipt-80' }); }
  }

  class M02XBluetoothProvider {
    constructor() { this.id = 'm02x-bluetooth'; this.name = 'M02X por Bluetooth'; this.state = STATUS.VALIDATION_REQUIRED; }
    isSupported() { return false; }
    async discover() { return []; }
    getStatus() {
      return {
        id: this.id,
        name: this.name,
        state: STATUS.VALIDATION_REQUIRED,
        supported: false,
        browserBluetooth: !!root.navigator?.bluetooth && root.isSecureContext === true,
        reason: 'El fabricante no publica UUID ni protocolo de impresión web. Requiere validación física antes de habilitarse.'
      };
    }
    async connect() { throw Object.assign(new Error('Validación física pendiente.'), { code: 'm02x-validation-required' }); }
    async disconnect() { return this.getStatus(); }
    async forgetDevice() { return this.getStatus(); }
    async print() { return this.connect(); }
    async printLabel() { return this.connect(); }
    async printReceipt() { return this.connect(); }
    async testPrint() { return this.connect(); }
  }

  class NativeBridgeProvider {
    constructor() { this.id = 'native-bridge'; this.name = 'Puente nativo'; }
    isSupported() { return typeof root.click360NativePrinter?.print === 'function'; }
    async discover() { return root.click360NativePrinter?.discover?.() || []; }
    getStatus() { return { id: this.id, name: this.name, state: this.isSupported() ? STATUS.READY : STATUS.UNSUPPORTED, supported: this.isSupported() }; }
    async connect() { return this.getStatus(); }
    async disconnect() { return root.click360NativePrinter?.disconnect?.() || this.getStatus(); }
    async forgetDevice() { return root.click360NativePrinter?.forget?.() || this.getStatus(); }
    async print(job) {
      if (!this.isSupported()) throw Object.assign(new Error('Puente nativo no disponible.'), { code: 'native-bridge-unavailable' });
      return root.click360NativePrinter.print(job);
    }
    async printLabel(job) { return root.click360NativePrinter?.printLabel?.(job) || this.print({ ...job, kind: 'label' }); }
    async printReceipt(job) { return root.click360NativePrinter?.printReceipt?.(job) || this.print({ ...job, kind: 'receipt' }); }
    async testPrint() { return this.print({ kind: 'test', text: 'CLICK 360' }); }
  }

  const providers = new Map([
    ['system', new SystemPrintProvider()],
    ['pdf', new PdfExportProvider()],
    ['m02x-bluetooth', new M02XBluetoothProvider()],
    ['native-bridge', new NativeBridgeProvider()]
  ]);
  let queue = Promise.resolve();

  function run(providerId, method, job) {
    const provider = providers.get(providerId);
    if (!provider || typeof provider[method] !== 'function') return Promise.reject(Object.assign(new Error('Proveedor no disponible.'), { code: 'provider-unavailable' }));
    const operation = queue.then(() => provider[method](job));
    queue = operation.catch(() => {});
    return operation.catch((error) => { throw safeError(error); });
  }

  root.CLICK360_PRINTING = Object.freeze({
    VERSION,
    STATUS,
    providers: () => [...providers.values()].map((provider) => provider.getStatus()),
    status: (providerId) => providers.get(providerId)?.getStatus() || null,
    discover: (providerId) => run(providerId, 'discover'),
    connect: (providerId) => run(providerId, 'connect'),
    disconnect: (providerId) => run(providerId, 'disconnect'),
    forgetDevice: (providerId) => run(providerId, 'forgetDevice'),
    print: (providerId, job) => run(providerId, 'print', job),
    printLabel: (providerId, job) => run(providerId, 'printLabel', job),
    printReceipt: (providerId, job) => run(providerId, 'printReceipt', job),
    testPrint: (providerId) => run(providerId, 'testPrint'),
    cleanup: cleanupJob,
    safeError
  });
})(typeof window !== 'undefined' ? window : globalThis);
