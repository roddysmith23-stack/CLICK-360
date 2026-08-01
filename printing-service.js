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
  const SERVICE_SCRIPT = (() => {
    if (typeof document === 'undefined') return '';
    const script = document.currentScript || document.querySelector('script[src*="printing-service.js"]');
    const src = script?.getAttribute?.('src') || '';
    if (!src) return { href: '', query: '' };
    try {
      const url = new URL(src, document.baseURI);
      return { href: url.href, query: url.search || '' };
    } catch {
      const queryIndex = src.indexOf('?');
      return { href: src, query: queryIndex >= 0 ? src.slice(queryIndex) : '' };
    }
  })();
  let html2canvasLoader = null;

  function safeError(error, fallback = 'No se pudo completar la impresión.') {
    const code = String(error?.code || 'print-failed').replace(/[^a-z0-9_./-]/gi, '').slice(0, 64);
    return { code, message: fallback };
  }

  function ensureHtml2canvas() {
    if (typeof root.html2canvas === 'function') return Promise.resolve(root.html2canvas);
    if (html2canvasLoader) return html2canvasLoader;
    if (typeof document === 'undefined') {
      return Promise.reject(Object.assign(new Error('html2canvas no disponible.'), { code: 'html2canvas-unavailable' }));
    }
    html2canvasLoader = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src*="html2canvas.min.js"]');
      const script = existing || document.createElement('script');
      const done = () => {
        if (typeof root.html2canvas === 'function') resolve(root.html2canvas);
        else reject(Object.assign(new Error('html2canvas no quedó disponible.'), { code: 'html2canvas-unavailable' }));
      };
      script.addEventListener('load', done, { once: true });
      script.addEventListener('error', () => {
        html2canvasLoader = null;
        reject(Object.assign(new Error('No se pudo cargar html2canvas.'), { code: 'html2canvas-load-failed' }));
      }, { once: true });
      if (existing) {
        if (typeof root.html2canvas === 'function') resolve(root.html2canvas);
        return;
      }
      script.src = SERVICE_SCRIPT.href
        ? new URL(`vendor/html2canvas.min.js${SERVICE_SCRIPT.query}`, SERVICE_SCRIPT.href).href
        : `vendor/html2canvas.min.js`;
      document.head.appendChild(script);
    });
    return html2canvasLoader;
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

  function cloneForExport(source) {
    const clone = source.cloneNode(true);
    const sourceCanvases = [...source.querySelectorAll('canvas')];
    const clonedCanvases = [...clone.querySelectorAll('canvas')];
    sourceCanvases.forEach((canvas, index) => {
      const target = clonedCanvases[index];
      if (!target) return;
      try {
        const image = document.createElement('img');
        image.src = canvas.toDataURL('image/png');
        image.alt = canvas.getAttribute('aria-label') || canvas.getAttribute('alt') || 'Contenido imprimible';
        image.width = canvas.width;
        image.height = canvas.height;
        image.className = canvas.className || '';
        const style = canvas.getAttribute('style');
        if (style) image.setAttribute('style', style);
        target.replaceWith(image);
      } catch {}
    });
    return clone;
  }

  function canvasInkBounds(canvas) {
    const width = canvas?.width || 0;
    const height = canvas?.height || 0;
    if (width < 1 || height < 1) return { nonWhite: 0 };
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return { nonWhite: 0 };
    const data = context.getImageData(0, 0, width, height).data;
    const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 260000)));
    let nonWhite = 0;
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const index = (y * width + x) * 4;
        const alpha = data[index + 3];
        if (alpha > 8 && (data[index] < 245 || data[index + 1] < 245 || data[index + 2] < 245)) {
          nonWhite += 1;
          if (nonWhite > 500) return { nonWhite };
        }
      }
    }
    return { nonWhite };
  }

  function normalizedCanvas(source) {
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0);
    return canvas;
  }

  function base64ToBytes(base64) {
    const binary = root.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function singleImagePdfBlob(canvas, widthMm, heightMm) {
    const imageUrl = canvas.toDataURL('image/jpeg', 0.96);
    const imageBytes = base64ToBytes(imageUrl.split(',')[1] || '');
    const encoder = new TextEncoder();
    const chunks = [];
    const offsets = [0];
    let offset = 0;
    const addBytes = (bytes) => {
      chunks.push(bytes);
      offset += bytes.length;
    };
    const addString = (text) => addBytes(encoder.encode(text));
    const addObject = (number, writer) => {
      offsets[number] = offset;
      addString(`${number} 0 obj\n`);
      writer();
      addString('\nendobj\n');
    };
    const pageWidthPt = (Math.max(10, Number(widthMm || 80)) * 72) / 25.4;
    const pageHeightPt = (Math.max(10, Number(heightMm || 120)) * 72) / 25.4;
    const imageCommand = `q\n${pageWidthPt.toFixed(4)} 0 0 ${pageHeightPt.toFixed(4)} 0 0 cm\n/Im0 Do\nQ\n`;
    const imageCommandBytes = encoder.encode(imageCommand);
    addString('%PDF-1.3\n');
    addObject(1, () => addString('<< /Type /Catalog /Pages 2 0 R >>'));
    addObject(2, () => addString('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
    addObject(3, () => addString(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidthPt.toFixed(4)} ${pageHeightPt.toFixed(4)}] /Resources << /ProcSet [/PDF /ImageC] /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`));
    addObject(4, () => {
      addString(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`);
      addBytes(imageBytes);
      addString('\nendstream');
    });
    addObject(5, () => {
      addString(`<< /Length ${imageCommandBytes.length} >>\nstream\n`);
      addBytes(imageCommandBytes);
      addString('endstream');
    });
    const xrefOffset = offset;
    addString('xref\n0 6\n0000000000 65535 f \n');
    for (let index = 1; index <= 5; index += 1) {
      addString(`${String(offsets[index]).padStart(10, '0')} 00000 n \n`);
    }
    addString(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
    return new Blob(chunks, { type: 'application/pdf' });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = String(filename || 'CLICK360.pdf').replace(/[^a-z0-9_.-]/gi, '_');
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }

  function pdfSizeMm(job, element) {
    const width = Math.max(10, Math.min(1000, Number(job.mediaWidthMm || job.widthMm || 0)));
    const height = Math.max(10, Math.min(2000, Number(job.mediaHeightMm || job.heightMm || 0)));
    const media = String(job.media || '');
    const receiptMatch = /^receipt-(\d+)$/i.exec(media);
    const receiptWidth = width || (receiptMatch ? Number(receiptMatch[1]) : 0);
    if (job.media === 'label' && width && height) return { widthMm: width, heightMm: height };
    if (media.startsWith('receipt') && receiptWidth) {
      const ratioHeight = Math.ceil((Math.max(1, element.scrollHeight) / Math.max(1, element.scrollWidth)) * receiptWidth) + 2;
      return { widthMm: receiptWidth, heightMm: Math.max(55, Math.min(1900, ratioHeight)) };
    }
    if (width && height) return { widthMm: width, heightMm: height };
    return { widthMm: 210, heightMm: 297 };
  }

  function pdfExportRoot() {
    document.getElementById('click360PdfExportSurface')?.remove();
    const element = document.createElement('div');
    element.id = 'click360PdfExportSurface';
    element.className = 'click360PdfExportSurface';
    element.setAttribute('aria-hidden', 'true');
    document.body.appendChild(element);
    return element;
  }

  function cleanupPdfExport() {
    document.getElementById('click360PdfExportSurface')?.remove();
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
    cleanupPdfExport();
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
      const hadInlineStyle = element.hasAttribute('style');
      const previousInlineStyle = element.getAttribute('style') || '';
      const restoreMeasureStyle = () => {
        if (hadInlineStyle) element.setAttribute('style', previousInlineStyle);
        else element.removeAttribute('style');
      };
      element.style.cssText = [
        'display:block',
        'position:fixed',
        'left:-10000px',
        'top:0',
        'width:max-content',
        'height:auto',
        'max-width:none',
        'max-height:none',
        'overflow:visible',
        'background:#ffffff',
        'color:#000000',
        'pointer-events:none',
        'visibility:hidden'
      ].join(';');
      try {
        await waitForResources(element);
      } catch (error) {
        restoreMeasureStyle();
        cleanupJob();
        this.state = STATUS.READY;
        throw error;
      }
      restoreMeasureStyle();
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
    isSupported() { return typeof document !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined'; }
    async discover() { return [{ id: 'pdf-export', name: this.name, provider: this.id }]; }
    async connect() { return this.getStatus(); }
    async disconnect() { cleanupJob(); return this.getStatus(); }
    async forgetDevice() { return this.disconnect(); }
    getStatus() { return { id: this.id, name: this.name, state: this.isSupported() ? STATUS.READY : STATUS.UNSUPPORTED, supported: this.isSupported() }; }
    async print(job) {
      if (!this.isSupported()) throw Object.assign(new Error('PDF no disponible.'), { code: 'pdf-unavailable' });
      const mounted = mountJob(job);
      const element = pdfExportRoot();
      element.dataset.printMedia = String(job.media || 'a4');
      element.replaceChildren(...[...mounted.children].map((child) => {
        const copy = cloneForExport(child);
        copy.style.display = 'block';
        copy.style.margin = '0';
        copy.style.padding = '0';
        copy.style.background = '#ffffff';
        copy.style.color = '#000000';
        copy.style.breakInside = 'avoid';
        return copy;
      }));
      // html2canvas puede generar PDFs blancos si hereda display:none del portal
      // de impresión o si el nodo vive lejos del viewport. Esta superficie es
      // independiente, visible y medible solo durante la exportación.
      element.style.cssText = [
        'display:block',
        'position:fixed',
        'left:0',
        'top:0',
        'width:max-content',
        'min-width:1px',
        'height:auto',
        'max-width:none',
        'max-height:none',
        'overflow:visible',
        'background:#ffffff',
        'color:#000000',
        'pointer-events:none',
        'z-index:2147483646',
        'visibility:visible',
        'opacity:1',
        'transform:none'
      ].join(';');
      await waitForResources(element);
      try {
        const html2canvas = await ensureHtml2canvas();
        const canvas = await html2canvas(element, {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff',
          windowWidth: Math.ceil(element.scrollWidth) + 2,
          windowHeight: Math.ceil(element.scrollHeight) + 2
        });
        const normalized = normalizedCanvas(canvas);
        const ink = canvasInkBounds(normalized);
        if (ink.nonWhite < 120) {
          throw Object.assign(new Error('El PDF renderizado quedó vacío.'), { code: 'pdf-render-blank' });
        }
        const size = pdfSizeMm(job, element);
        const blob = singleImagePdfBlob(normalized, size.widthMm, size.heightMm);
        downloadBlob(blob, job.filename || 'CLICK360.pdf');
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
