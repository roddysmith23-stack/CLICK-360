(function (root) {
  'use strict';

  const Canvas = () => root.CLICK360_UNIVERSAL_LABEL_CANVAS;
  const PRESETS = Object.freeze({
    a4: { id: 'a4-3-column', mediaType: 'sheet', widthMm: 60, heightMm: 35, mediaWidthMm: 210, mediaHeightMm: 297, columns: 3, rows: 7, gapXmm: 3, gapYmm: 3, marginTopMm: 7, marginRightMm: 7, marginBottomMm: 7, marginLeftMm: 7, dpi: 300 },
    roll: { id: 'roll-1-60x40', mediaType: 'roll-1', widthMm: 60, heightMm: 40, mediaWidthMm: 60, mediaHeightMm: 40, columns: 1, rows: 1, gapXmm: 0, gapYmm: 0, dpi: 203 },
    roll2: { id: 'roll-2-40x60-provisional', mediaType: 'roll-2', widthMm: 40, heightMm: 60, mediaWidthMm: 0, mediaHeightMm: 60, columns: 2, rows: 1, gapXmm: 0, gapYmm: 0, dpi: 203 },
    custom: { id: 'custom', mediaType: 'roll-1', widthMm: 60, heightMm: 40, mediaWidthMm: 60, mediaHeightMm: 40, columns: 1, rows: 1, gapXmm: 0, gapYmm: 0, dpi: 203 }
  });
  const OBJECT_LABELS = Object.freeze({ qr: 'QR', barcode: 'Codigo', name: 'Nombre', price: 'Precio', sku: 'SKU', text: 'Texto', image: 'Imagen' });

  function escape(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  }
  function n(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
  function inputValue(rootElement, id, fallback = '') { return rootElement.querySelector(`#${id}`)?.value ?? fallback; }
  function checked(rootElement, id) { return rootElement.querySelector(`#${id}`)?.checked === true; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function editorMarkup() {
    return `<div class="ulcHeader"><div><h2>Lienzo universal de etiquetas</h2><p>Medidas reales en milimetros. El zoom nunca altera el plan fisico.</p></div><div class="ulcHeaderActions"><button type="button" class="btn active" id="ulcSimpleMode" aria-current="true">Modo simple · Lienzo</button><button type="button" class="btn" id="ulcUndo" title="Deshacer">Deshacer</button><button type="button" class="btn" id="ulcRedo" title="Rehacer">Rehacer</button><button type="button" class="btn" id="ulcAdvanced">Modo experto · Asistente</button><button type="button" class="closeBtn" data-close aria-label="Cerrar">x</button></div></div>
      <div class="ulcWorkspace">
        <details class="ulcPanel ulcLeft" aria-label="Papel y objetos" open>
          <summary>Papel y objetos</summary>
          <h3>Papel</h3>
          <label>Formato<select id="ulcPreset"><option value="a4">A4</option><option value="roll">Rollo</option><option value="roll2">Rollo 2 columnas 40 x 60</option><option value="custom">Personalizado</option></select></label>
          <div class="ulcFields two"><label>Ancho mm<input id="ulcWidth" type="number" min="10" max="250" step="0.1"></label><label>Alto mm<input id="ulcHeight" type="number" min="10" max="400" step="0.1"></label></div>
          <div class="ulcFields two"><label>Columnas<input id="ulcColumns" type="number" min="1" max="12" step="1"></label><label>Filas<input id="ulcRows" type="number" min="1" max="100" step="1"></label></div>
          <div class="ulcFields two"><label>Gap X mm<input id="ulcGapX" type="number" min="0" max="50" step="0.1"></label><label>Gap Y mm<input id="ulcGapY" type="number" min="0" max="50" step="0.1"></label></div>
          <div class="ulcFields two"><label>Orientacion<select id="ulcOrientation"><option value="portrait">Vertical</option><option value="landscape">Horizontal</option></select></label><label>DPI<input id="ulcDpi" type="number" min="72" max="1200" step="1"></label></div>
          <details class="ulcMeasurement"><summary>Medicion y calibracion</summary><p>Perfil provisional por negocio y dispositivo. Mide antes de certificar.</p><label>Perfil de impresora<select id="ulcProfiles"><option value="">Perfil nuevo</option></select></label><label>Nombre del perfil<input id="ulcProfileName" maxlength="80" placeholder="Impresora / papel"></label><div class="ulcFields two"><label>Ancho total<input id="ulcMediaWidth" type="number" min="0" max="1000" step="0.1"></label><label>Pitch mm<input id="ulcPitch" type="number" min="0" max="500" step="0.1"></label><label>Offset X<input id="ulcOffsetX" type="number" min="-50" max="50" step="0.1"></label><label>Offset Y<input id="ulcOffsetY" type="number" min="-50" max="50" step="0.1"></label><label>Escala X<input id="ulcScaleX" type="number" min="0.8" max="1.2" step="0.001"></label><label>Escala Y<input id="ulcScaleY" type="number" min="0.8" max="1.2" step="0.001"></label></div><button type="button" class="btn" id="ulcSaveProfile">Guardar perfil provisional</button><button type="button" class="btn" id="ulcCalibrationSheet">Hoja de calibracion</button></details>
          <h3>Agregar</h3><div class="ulcObjectButtons"><button type="button" data-ulc-add="qr">QR</button><button type="button" data-ulc-add="barcode">Codigo</button><button type="button" data-ulc-add="name">Nombre</button><button type="button" data-ulc-add="price">Precio</button><button type="button" data-ulc-add="sku">SKU</button><button type="button" data-ulc-add="text">Texto</button><button type="button" id="ulcAddImage">Imagen</button><input id="ulcImageInput" type="file" accept="image/*" hidden></div>
          <h3>Plantillas</h3><div id="ulcTemplateList" class="ulcTemplateList" aria-label="Plantillas guardadas"></div><div class="ulcInline"><button type="button" class="btn" id="ulcSaveTemplate">Guardar plantilla</button></div>
        </details>
        <section class="ulcCanvasRegion" aria-label="Lienzo de etiquetas">
          <div class="ulcCanvasToolbar"><label>Zoom <input id="ulcZoom" type="range" min="0.5" max="2" step="0.1" value="1"></label><output id="ulcZoomValue">100%</output><label><input id="ulcGrid" type="checkbox" checked> Cuadricula</label><label><input id="ulcSnap" type="checkbox" checked> Ajustar</label><span id="ulcPhysicalSize"></span></div>
          <div id="ulcViewport" class="ulcViewport"><div id="ulcStage" class="ulcStage" role="application" aria-label="Lienzo de etiqueta en milimetros"></div></div>
        </section>
        <details class="ulcPanel ulcRight" aria-label="Propiedades del objeto" open>
          <summary>Propiedades</summary>
          <p id="ulcEmptySelection">Selecciona un objeto en el lienzo.</p><div id="ulcProperties" hidden><label>Objeto<select id="ulcObjectSelect"></select></label><div class="ulcFields two"><label>X mm<input id="ulcX" type="number" step="0.1"></label><label>Y mm<input id="ulcY" type="number" step="0.1"></label><label>Ancho mm<input id="ulcObjectWidth" type="number" min="2" step="0.1"></label><label>Alto mm<input id="ulcObjectHeight" type="number" min="2" step="0.1"></label></div><label>Rotacion <input id="ulcRotation" type="range" min="-180" max="180" step="1"><output id="ulcRotationValue"></output></label><label id="ulcTextField">Texto<input id="ulcText" maxlength="160"></label><div class="ulcObjectActions"><button type="button" id="ulcDuplicate">Duplicar</button><button type="button" id="ulcDelete">Eliminar</button><button type="button" id="ulcLock">Bloquear</button><button type="button" id="ulcCopy">Copiar</button><button type="button" id="ulcPaste">Pegar</button><button type="button" id="ulcFront">Al frente</button><button type="button" id="ulcBack">Al fondo</button></div><fieldset><legend>Alinear seleccion</legend><div class="ulcAlign"><button type="button" data-ulc-align="left">Izq.</button><button type="button" data-ulc-align="center">Centro</button><button type="button" data-ulc-align="right">Der.</button><button type="button" data-ulc-align="top">Arriba</button><button type="button" data-ulc-align="middle">Medio</button><button type="button" data-ulc-align="bottom">Abajo</button></div></fieldset></div>
        </details>
      </div>
      <footer class="ulcFooter"><details class="ulcQuickPrint" open><summary><span>Cantidad e impresion por lote</span></summary><div class="ulcInline"><label>Cantidad exacta<input id="ulcQuantity" type="number" min="1" max="500" step="1"></label><label>Empezar en<input id="ulcStartSlot" type="number" min="1" step="1"></label><button type="button" id="ulcFillRow">Llenar fila</button><button type="button" id="ulcFillPage">Llenar pagina</button></div></details><div class="ulcInline" id="ulcPrintActions"><button type="button" class="btn primary" id="ulcPrint">Guardar PDF limpio</button><button type="button" class="btn" id="ulcSystemPrint">Imprimir con navegador</button></div><div id="ulcPrintWarnings" class="ulcPrintWarnings" aria-live="polite"></div></footer>`;
  }

  function open(api) {
    const engine = Canvas();
    if (!engine) throw new Error('El motor del lienzo no esta disponible.');
    const initialBase = api.initialDocument || api.initialTemplate?.universalDocument || api.initialTemplate || { paper: PRESETS.roll, quantity: 1 };
    const initial = api.initialProfile?.universalPaper ? { ...initialBase, paper: { ...(initialBase.paper || {}), ...api.initialProfile.universalPaper } } : initialBase;
    let history = engine.createHistory(engine.normalizeDocument(initial));
    let selectedIds = new Set(history.present.objects.slice(0, 1).map((object) => object.id));
    let clipboard = null;
    let zoom = 1;
    let gesture = null;
    let renderToken = 0;
    let activeTemplateId = String(api.initialTemplate?.id || '');
    let activeProfileId = String(api.initialProfile?.id || '');
    // Print dialog state machine: IDLE → PREPARING → OPEN → WAITING → FINISHED
    // Prevents multiple concurrent print/PDF invocations and dialog loops after cancel.
    let _ulcPrintState = 'idle'; // 'idle' | 'preparing' | 'open' | 'finished'
    function _setUlcPrintState(state) {
      _ulcPrintState = state;
      const busy = state !== 'idle' && state !== 'finished';
      ['ulcPrint', 'ulcSystemPrint'].forEach((id) => {
        const el = modalRoot?.querySelector(`#${id}`);
        if (el) el.disabled = busy;
      });
      // Also disable template card print/pdf buttons while active
      modalRoot?.querySelectorAll('[data-ulc-tpl-print]').forEach((el) => { el.disabled = busy; });
    }
    api.showModal(editorMarkup());
    const modalRoot = root.document.querySelector('#modalRoot');
    const modal = modalRoot.querySelector('.modal');
    modal.classList.add('universalLabelCanvasModal');
    // On narrow screens the canvas itself must win the fight for vertical
    // space -- the Papel/Propiedades panels and the batch-print quantity
    // controls are real <details> accordions in the markup (desktop-open
    // by default so nothing changes there); here we start them collapsed
    // only below the phone breakpoint so the label is visible without the
    // footer/side panels burying it (see the r37 mobile-canvas fix).
    if (root.innerWidth <= 720) {
      modalRoot.querySelectorAll('.ulcLeft, .ulcRight, .ulcQuickPrint').forEach((panel) => panel.removeAttribute('open'));
    }
    const $ = (selector) => modalRoot.querySelector(selector);
    const $$ = (selector) => [...modalRoot.querySelectorAll(selector)];
    const current = () => history.present;
    const selected = () => current().objects.filter((object) => selectedIds.has(object.id));
    const primary = () => selected()[0] || null;
    const pxPerMm = () => 3.779527559 * zoom;
    const snap = (value) => current().snap ? Math.round(value / current().gridMm) * current().gridMm : value;

    function commit(next) { history = engine.commit(history, next); render(); }
    function transient(next) { history = { ...history, present: engine.normalizeDocument(next) }; render(); }
    function objectById(id) { return current().objects.find((object) => object.id === id); }
    function updatePaper(patch) { commit({ ...current(), paper: { ...current().paper, ...patch } }); }
    function updatePrimary(patch) { const object = primary(); if (object) commit(engine.updateObject(current(), object.id, patch)); }
    function setSelection(ids) { selectedIds = new Set(ids.filter((id) => objectById(id))); render(); }
    function contentData() {
      const product = api.product || {};
      return { product, price: api.formatPrice ? api.formatPrice(product.price || 0) : String(product.price || '0.00'), sku: product.code || '', qrPayload: api.productPayload ? api.productPayload(product) : product.code || product.id || 'CLICK360' };
    }
    function ruler(length, horizontal) {
      const max = Math.ceil(length / 10) * 10;
      return Array.from({ length: max / 10 + 1 }, (_, index) => `<span style="${horizontal ? `left:${index * 10 * pxPerMm()}px` : `top:${index * 10 * pxPerMm()}px`}">${index * 10}</span>`).join('');
    }
    async function paintPreview(document, token) {
      const canvas = $('#ulcRenderCanvas');
      if (!canvas) return;
      const dimensions = await engine.renderLabelToCanvas(canvas, document, contentData(), { dpi: 96 });
      if (token !== renderToken || !canvas.isConnected) return;
      canvas.style.width = `${dimensions.widthMm * pxPerMm()}px`;
      canvas.style.height = `${dimensions.heightMm * pxPerMm()}px`;
    }
    function render() {
      const document = current();
      const paper = document.paper;
      const scale = pxPerMm();
      const stage = $('#ulcStage');
      // Render template cards (replaces old <select>)
      const templateListEl = $('#ulcTemplateList');
      if (templateListEl) {
        const templates = api.getTemplates?.() || [];
        templateListEl.innerHTML = templates.length
          ? templates.map((tpl) => `<div class="ulcTemplateCard${tpl.id === activeTemplateId ? ' active' : ''}" data-ulc-tpl-id="${escape(tpl.id)}"><span class="ulcTemplateName">${escape(tpl.name)}</span><div class="ulcTemplateCardActions"><button type="button" class="ulcTplBtn primary" data-ulc-tpl-print="${escape(tpl.id)}" title="Generar PDF limpio">PDF</button><button type="button" class="ulcTplBtn" data-ulc-tpl-edit="${escape(tpl.id)}" title="Editar">Editar</button><button type="button" class="ulcTplBtn danger" data-ulc-tpl-delete="${escape(tpl.id)}" title="Eliminar">Borrar</button></div></div>`).join('')
          : '<p class="ulcNoTemplates">Sin plantillas. Guarda una para verla aqui.</p>';
      }
      const active = primary();
      $('#ulcPreset').value = Object.entries(PRESETS).find(([, preset]) => preset.id === paper.id)?.[0] || 'custom';
      $('#ulcWidth').value = paper.widthMm; $('#ulcHeight').value = paper.heightMm; $('#ulcColumns').value = paper.columns; $('#ulcRows').value = paper.rows;
      $('#ulcGapX').value = paper.gapXmm; $('#ulcGapY').value = paper.gapYmm; $('#ulcOrientation').value = paper.orientation; $('#ulcDpi').value = paper.dpi;
      $('#ulcMediaWidth').value = paper.mediaWidthMm || ''; $('#ulcPitch').value = paper.pitchMm || ''; $('#ulcOffsetX').value = paper.xOffsetMm || 0; $('#ulcOffsetY').value = paper.yOffsetMm || 0;
      $('#ulcScaleX').value = paper.scaleX || 1; $('#ulcScaleY').value = paper.scaleY || 1; $('#ulcZoom').value = zoom; $('#ulcZoomValue').textContent = `${Math.round(zoom * 100)}%`;
      $('#ulcGrid').checked = document.gridMm > 0; $('#ulcSnap').checked = document.snap; $('#ulcQuantity').value = document.quantity; $('#ulcStartSlot').value = document.startSlot;
      $('#ulcPhysicalSize').textContent = `${paper.widthMm} x ${paper.heightMm} mm · ${paper.columns} col.`;
      stage.style.width = `${paper.widthMm * scale}px`; stage.style.height = `${paper.heightMm * scale}px`;
      stage.style.setProperty('--ulc-grid-size', `${document.gridMm * scale}px`);
      stage.classList.toggle('gridOff', document.gridMm <= 0);
      const calibratedScaleX = paper.scaleX || 1;
      const calibratedScaleY = paper.scaleY || 1;
      const objects = document.objects.filter((object) => object.visible).map((object) => {
        const selectedClass = selectedIds.has(object.id) ? ' selected' : '';
        const lockedClass = object.locked ? ' locked' : '';
        return `<div class="ulcObject${selectedClass}${lockedClass}" data-ulc-object="${escape(object.id)}" style="left:${object.xMm * scale * calibratedScaleX}px;top:${object.yMm * scale * calibratedScaleY}px;width:${object.widthMm * scale * calibratedScaleX}px;height:${object.heightMm * scale * calibratedScaleY}px;z-index:${100 + object.z};transform:rotate(${object.rotation}deg)"><span>${escape(OBJECT_LABELS[object.type] || object.type)}</span>${selectedIds.has(object.id) && !object.locked ? '<i class="ulcResizeHandle" data-ulc-handle="resize"></i><i class="ulcRotateHandle" data-ulc-handle="rotate"></i>' : ''}</div>`;
      }).join('');
      stage.innerHTML = `<div class="ulcRuler ulcRulerTop">${ruler(paper.widthMm, true)}</div><div class="ulcRuler ulcRulerLeft">${ruler(paper.heightMm, false)}</div><div class="ulcPaperSurface"><canvas id="ulcRenderCanvas" aria-label="Vista previa fisica de etiqueta"></canvas>${objects}</div>`;
      const properties = $('#ulcProperties');
      $('#ulcEmptySelection').hidden = !!active; properties.hidden = !active;
      if (active) {
        $('#ulcObjectSelect').innerHTML = document.objects.map((object) => `<option value="${escape(object.id)}" ${object.id === active.id ? 'selected' : ''}>${escape(OBJECT_LABELS[object.type])} ${escape(object.id.slice(-5))}</option>`).join('');
        $('#ulcX').value = active.xMm.toFixed(1); $('#ulcY').value = active.yMm.toFixed(1); $('#ulcObjectWidth').value = active.widthMm.toFixed(1); $('#ulcObjectHeight').value = active.heightMm.toFixed(1);
        $('#ulcRotation').value = active.rotation; $('#ulcRotationValue').textContent = `${active.rotation}°`; $('#ulcText').value = active.text || '';
        $('#ulcTextField').hidden = !['text'].includes(active.type); $('#ulcLock').textContent = active.locked ? 'Desbloquear' : 'Bloquear';
      }
      const profileSelect = $('#ulcProfiles');
      profileSelect.innerHTML = '<option value="">Perfil nuevo</option>' + (api.getProfiles?.() || []).map((profile) => `<option value="${escape(profile.id)}">${escape(profile.name || 'Perfil provisional')}</option>`).join('');
      profileSelect.value = activeProfileId;
      const activeProfile = (api.getProfiles?.() || []).find((profile) => profile.id === activeProfileId);
      $('#ulcProfileName').value = activeProfile?.name || `Perfil ${paper.widthMm}x${paper.heightMm} mm`;
      const token = ++renderToken;
      // Agent 2: use a normalized snapshot to guarantee preview === PDF === print
      const previewSnapshot = engine.normalizeDocument(document);
      paintPreview(previewSnapshot, token).catch((error) => api.toast?.(`No se pudo renderizar la etiqueta: ${error.message}`, 'err'));
    }
    // --- Agent 3: print state machine executePrint helper ---
    // Validates, guards against concurrent invocations, resets on afterprint.
    async function executePrint(docSnapshot, mode) {
      if (_ulcPrintState === 'preparing' || _ulcPrintState === 'open') {
        api.toast?.('Ya hay una impresión activa. Cancela el diálogo o espera.', 'warn');
        return;
      }
      // Validation: only CRITICAL errors block. Warnings allow print.
      const paper = docSnapshot.paper;
      const objects = docSnapshot.objects || [];
      if (!objects.length) { api.toast?.('El documento está vacío. Agrega al menos un elemento.', 'err'); return; }
      const warnings = [];
      const outsideObjects = objects.filter((o) => o.xMm + o.widthMm > paper.widthMm || o.yMm + o.heightMm > paper.heightMm);
      if (outsideObjects.length) warnings.push(`Advertencia: ${outsideObjects.length} elemento(s) fuera de la zona segura.`);
      if (warnings.length) { const warnEl = $('#ulcPrintWarnings'); if (warnEl) { warnEl.textContent = warnings.join(' '); warnEl.style.display = 'block'; setTimeout(() => { if (warnEl) warnEl.style.display = ''; }, 6000); } }
      _setUlcPrintState('preparing');
      try {
        _setUlcPrintState('open');
        await api.print?.(docSnapshot, mode);
      } finally {
        _setUlcPrintState('idle');
      }
    }
    // Reset print state when browser dialog closes (cancel OR print)
    root.addEventListener('afterprint', () => { if (_ulcPrintState !== 'idle') _setUlcPrintState('idle'); });
    function stagePoint(event) {
      const rect = $('#ulcStage').getBoundingClientRect();
      const paper = current().paper;
      return {
        xMm: Math.max(0, (event.clientX - rect.left) / (pxPerMm() * (paper.scaleX || 1))),
        yMm: Math.max(0, (event.clientY - rect.top) / (pxPerMm() * (paper.scaleY || 1)))
      };
    }
    function updateFromProperties() {
      const object = primary();
      if (!object || object.locked) return;
      updatePrimary({ xMm: n(inputValue(modalRoot, 'ulcX'), object.xMm), yMm: n(inputValue(modalRoot, 'ulcY'), object.yMm), widthMm: n(inputValue(modalRoot, 'ulcObjectWidth'), object.widthMm), heightMm: n(inputValue(modalRoot, 'ulcObjectHeight'), object.heightMm), rotation: n(inputValue(modalRoot, 'ulcRotation'), object.rotation), text: inputValue(modalRoot, 'ulcText', object.text) });
    }
    function applyPaperInputs() {
      const paper = current().paper;
      const orientation = inputValue(modalRoot, 'ulcOrientation', 'portrait');
      const orientationChanged = orientation !== paper.orientation;
      updatePaper({ widthMm: orientationChanged ? paper.heightMm : n(inputValue(modalRoot, 'ulcWidth'), 60), heightMm: orientationChanged ? paper.widthMm : n(inputValue(modalRoot, 'ulcHeight'), 40), columns: n(inputValue(modalRoot, 'ulcColumns'), 1), rows: n(inputValue(modalRoot, 'ulcRows'), 1), gapXmm: n(inputValue(modalRoot, 'ulcGapX'), 0), gapYmm: n(inputValue(modalRoot, 'ulcGapY'), 0), orientation, dpi: n(inputValue(modalRoot, 'ulcDpi'), 203), mediaWidthMm: orientationChanged ? paper.mediaHeightMm : n(inputValue(modalRoot, 'ulcMediaWidth'), 0), mediaHeightMm: orientationChanged ? paper.mediaWidthMm : paper.mediaHeightMm, pitchMm: n(inputValue(modalRoot, 'ulcPitch'), 0), xOffsetMm: n(inputValue(modalRoot, 'ulcOffsetX'), 0), yOffsetMm: n(inputValue(modalRoot, 'ulcOffsetY'), 0), scaleX: n(inputValue(modalRoot, 'ulcScaleX'), 1), scaleY: n(inputValue(modalRoot, 'ulcScaleY'), 1) });
    }

    modalRoot.addEventListener('click', async (event) => {
      const add = event.target.closest('[data-ulc-add]');
      const align = event.target.closest('[data-ulc-align]');
      if (add) { const next = engine.addObject(current(), add.dataset.ulcAdd); commit(next); setSelection([next.objects.at(-1).id]); return; }
      if (align) { commit(engine.alignObjects(current(), [...selectedIds], align.dataset.ulcAlign)); return; }
      if (event.target.closest('#ulcUndo')) { history = engine.undo(history); render(); return; }
      if (event.target.closest('#ulcRedo')) { history = engine.redo(history); render(); return; }
      if (event.target.closest('#ulcFillRow')) { commit({ ...current(), quantity: current().paper.columns }); return; }
      if (event.target.closest('#ulcFillPage')) { commit({ ...current(), quantity: current().paper.columns * current().paper.rows }); return; }
      if (event.target.closest('#ulcDuplicate') && primary()) { const next = engine.duplicateObject(current(), primary().id); commit(next); setSelection([next.objects.at(-1).id]); return; }
      if (event.target.closest('#ulcDelete')) { commit(engine.deleteObjects(current(), [...selectedIds])); setSelection([]); return; }
      if (event.target.closest('#ulcLock') && primary()) { updatePrimary({ locked: !primary().locked }); return; }
      if (event.target.closest('#ulcCopy') && primary()) { clipboard = clone(primary()); api.toast?.('Objeto copiado.'); return; }
      if (event.target.closest('#ulcPaste') && clipboard) { const next = engine.addObject(current(), clipboard.type, { ...clipboard, id: undefined, xMm: clipboard.xMm + 2, yMm: clipboard.yMm + 2 }); commit(next); setSelection([next.objects.at(-1).id]); return; }
      if (event.target.closest('#ulcFront') && primary()) { commit(engine.arrangeObject(current(), primary().id, 'front')); return; }
      if (event.target.closest('#ulcBack') && primary()) { commit(engine.arrangeObject(current(), primary().id, 'back')); return; }
      if (event.target.closest('#ulcSaveTemplate')) { const existing = (api.getTemplates?.() || []).find((template) => template.id === activeTemplateId); const name = root.prompt('Nombre de la plantilla:', existing?.name || 'Etiqueta universal'); if (name?.trim()) { const saved = await api.saveTemplate?.(name.trim(), engine.normalizeDocument(current()), activeTemplateId); activeTemplateId = String(saved?.id || activeTemplateId); } render(); return; }
      if (event.target.closest('#ulcSaveProfile')) {
        const saved = await api.saveProfile?.(current(), activeProfileId, inputValue(modalRoot, 'ulcProfileName'));
        if (!saved) return;
        activeProfileId = String(saved.id || activeProfileId);
        api.toast?.('Perfil provisional guardado en este negocio y dispositivo.', 'ok');
        render();
        return;
      }
      if (event.target.closest('#ulcCalibrationSheet')) { await api.printCalibration?.(current()); return; }
      if (event.target.closest('#ulcSimpleMode')) { api.toast?.('Ya estás en Modo simple · Lienzo.', 'info'); return; }
      if (event.target.closest('#ulcAdvanced')) { api.closeModal?.(); api.openAdvanced?.(); return; }
      // --- Template card quick actions ---
      const tplPrint = event.target.closest('[data-ulc-tpl-print]');
      const tplEdit = event.target.closest('[data-ulc-tpl-edit]');
      const tplDelete = event.target.closest('[data-ulc-tpl-delete]');
      if (tplPrint) {
        const tplId = tplPrint.dataset.ulcTplPrint;
        const template = (api.getTemplates?.() || []).find((t) => t.id === tplId);
        if (!template) { api.toast?.('Plantilla no encontrada.', 'err'); return; }
        // Load template document snapshot — does NOT change active editor state
        const tplDoc = engine.normalizeDocument(template.universalDocument || template);
        await executePrint(tplDoc, 'pdf');
        return;
      }
      if (tplEdit) {
        const tplId = tplEdit.dataset.ulcTplEdit;
        const template = (api.getTemplates?.() || []).find((t) => t.id === tplId);
        if (template) { activeTemplateId = tplId; history = engine.createHistory(engine.normalizeDocument(template.universalDocument || template)); selectedIds = new Set(history.present.objects.slice(0, 1).map((object) => object.id)); render(); }
        return;
      }
      if (tplDelete) {
        const tplId = tplDelete.dataset.ulcTplDelete;
        const template = (api.getTemplates?.() || []).find((t) => t.id === tplId);
        const confirmed = tplId && root.confirm?.(`¿Eliminar la plantilla "${template?.name || 'sin nombre'}"? Esta acción solo borra el diseño guardado.`) !== false;
        if (confirmed) {
          const deleted = await api.deleteTemplate?.(tplId);
          if (deleted !== false) {
            if (activeTemplateId === tplId) activeTemplateId = '';
            api.toast?.('Plantilla eliminada.', 'ok');
          }
          render();
        }
        return;
      }
      // --- Print / PDF buttons with state machine guard ---
      if (event.target.closest('#ulcPrint') || event.target.closest('#ulcSystemPrint')) {
        const mode = event.target.closest('#ulcSystemPrint') ? 'system' : 'pdf';
        await executePrint(engine.normalizeDocument(current()), mode);
        return;
      }
    });
    modalRoot.addEventListener('change', async (event) => {
      if (event.target.id === 'ulcPreset') { updatePaper(PRESETS[event.target.value] || PRESETS.custom); return; }
      if (event.target.id === 'ulcProfiles') {
        activeProfileId = event.target.value || '';
        api.selectProfile?.(activeProfileId);
        const profile = (api.getProfiles?.() || []).find((item) => item.id === activeProfileId);
        if (profile?.universalPaper) commit({ ...current(), paper: { ...current().paper, ...profile.universalPaper } });
        return;
      }
      if (event.target.id === 'ulcImageInput') {
        const input = event.target;
        const appendImage = (imageData) => {
          if (!imageData || !modalRoot.querySelector('#ulcStage')) return;
          const next = engine.addObject(current(), 'image', { imageData });
          commit(next); setSelection([next.objects.at(-1).id]);
        };
        if (typeof api.readImage === 'function') {
          api.readImage(input, appendImage);
          input.value = '';
          return;
        }
        const file = input.files?.[0];
        if (!file || !file.type.startsWith('image/') || file.size > 1_500_000) { input.value = ''; return; }
        const imageData = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => resolve(''); reader.readAsDataURL(file); });
        appendImage(imageData);
        input.value = '';
        return;
      }
      if (['ulcWidth','ulcHeight','ulcColumns','ulcRows','ulcGapX','ulcGapY','ulcOrientation','ulcDpi','ulcMediaWidth','ulcPitch','ulcOffsetX','ulcOffsetY','ulcScaleX','ulcScaleY'].includes(event.target.id)) { applyPaperInputs(); return; }
      if (['ulcX','ulcY','ulcObjectWidth','ulcObjectHeight','ulcRotation','ulcText'].includes(event.target.id)) { updateFromProperties(); return; }
      if (event.target.id === 'ulcObjectSelect') { setSelection([event.target.value]); return; }
      if (event.target.id === 'ulcQuantity') { commit({ ...current(), quantity: Math.max(1, Math.trunc(n(event.target.value, 1)) )}); return; }
      if (event.target.id === 'ulcStartSlot') { commit({ ...current(), startSlot: Math.max(1, Math.trunc(n(event.target.value, 1))) }); return; }
      if (event.target.id === 'ulcGrid') { commit({ ...current(), gridMm: event.target.checked ? 2 : 0 }); return; }
      if (event.target.id === 'ulcSnap') { commit({ ...current(), snap: event.target.checked }); return; }
    });
    $('#ulcZoom').addEventListener('input', (event) => { zoom = n(event.target.value, 1); render(); });
    $('#ulcAddImage').onclick = () => $('#ulcImageInput').click();
    $('#ulcStage').addEventListener('pointerdown', (event) => {
      const objectElement = event.target.closest('[data-ulc-object]');
      if (!objectElement) return;
      const id = objectElement.dataset.ulcObject;
      const object = objectById(id);
      if (!object) return;
      if (event.shiftKey) selectedIds.has(id) ? selectedIds.delete(id) : selectedIds.add(id); else selectedIds = new Set([id]);
      render();
      if (object.locked) return;
      const handle = event.target.closest('[data-ulc-handle]')?.dataset.ulcHandle || 'move';
      const point = stagePoint(event);
      gesture = { id, mode: handle, start: point, startDocument: clone(current()), startObject: clone(object) };
      try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch {}
      event.preventDefault();
    });
    $('#ulcStage').addEventListener('pointermove', (event) => {
      if (!gesture) return;
      const point = stagePoint(event); const document = clone(gesture.startDocument); const object = document.objects.find((entry) => entry.id === gesture.id); if (!object) return;
      if (gesture.mode === 'rotate') { const cx = gesture.startObject.xMm + gesture.startObject.widthMm / 2; const cy = gesture.startObject.yMm + gesture.startObject.heightMm / 2; object.rotation = Math.round(Math.atan2(point.yMm - cy, point.xMm - cx) * 180 / Math.PI + 90); }
      else if (gesture.mode === 'resize') { object.widthMm = Math.max(2, snap(point.xMm - gesture.startObject.xMm)); object.heightMm = Math.max(2, snap(point.yMm - gesture.startObject.yMm)); }
      else { object.xMm = Math.max(0, snap(gesture.startObject.xMm + point.xMm - gesture.start.xMm)); object.yMm = Math.max(0, snap(gesture.startObject.yMm + point.yMm - gesture.start.yMm)); }
      transient(document); event.preventDefault();
    });
    const finishGesture = () => { if (!gesture) return; const final = clone(current()); history = { past: [...history.past, gesture.startDocument].slice(-80), present: engine.normalizeDocument(final), future: [] }; gesture = null; render(); };
    $('#ulcStage').addEventListener('pointerup', finishGesture); $('#ulcStage').addEventListener('pointercancel', finishGesture);
    render();
  }

  root.CLICK360_UNIVERSAL_LABEL_EDITOR = Object.freeze({ PRESETS, open });
})(typeof window !== 'undefined' ? window : globalThis);
