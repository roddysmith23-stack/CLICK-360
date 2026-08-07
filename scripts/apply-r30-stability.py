from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'app.js'
STYLES = ROOT / 'styles.css'


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    return text.replace(old, new, 1)


def bump_release_contract():
    targets = [
        ROOT / 'app.js', ROOT / 'service-worker.js', ROOT / 'runtime-guard.js', ROOT / 'index.html'
    ]
    for folder in (ROOT / 'qa', ROOT / 'scripts'):
        if folder.exists():
            for path in folder.rglob('*'):
                if path.is_file() and path.suffix.lower() in {'.js', '.cjs', '.mjs', '.html', '.py'}:
                    targets.append(path)
    for path in targets:
        if not path.exists() or path.stat().st_size > 2_500_000:
            continue
        text = path.read_text(encoding='utf-8')
        updated = text.replace('commercial-1-0-5-r29', 'commercial-1-0-5-r30')
        if updated != text:
            path.write_text(updated, encoding='utf-8')


app = APP.read_text(encoding='utf-8')

# 1) Preserve price format through the final universal render snapshot.
app = replace_once(
    app,
    "    const documentModel = canvasApi.normalizeDocument(sourceDocument);\n    const documentSnapshot = canvasApi.normalizeDocument(documentModel);",
    "    const sourcePriceFormat = sourceDocument?.priceFormat || 'full';\n    const documentModel = { ...canvasApi.normalizeDocument(sourceDocument), priceFormat:sourcePriceFormat };\n    const documentSnapshot = { ...canvasApi.normalizeDocument(documentModel), priceFormat:sourcePriceFormat };",
    'universal print priceFormat snapshot'
)

# 2) Preserve price format even on the safe inline-paper fallback.
app = replace_once(
    app,
    "        documentModel = canvasApi.normalizeDocument({ ...documentModel, quantity: resolveLabelCopyResult(quantity, product.qty, useStock).count || 1, startSlot: Math.max(1, Number(startSlot) || 1) });\n        const qty = resolveLabelCopyResult(quantity, product.qty, useStock);",
    "        const resolvedFallbackPriceFormat = priceFormat || resolvedTemplate?.priceFormat || 'full';\n        documentModel = { ...canvasApi.normalizeDocument({ ...documentModel, quantity: resolveLabelCopyResult(quantity, product.qty, useStock).count || 1, startSlot: Math.max(1, Number(startSlot) || 1) }), priceFormat:resolvedFallbackPriceFormat };\n        const qty = resolveLabelCopyResult(quantity, product.qty, useStock);",
    'inline paper priceFormat fallback'
)

# 3) Preserve the selected saved-template price format when printing from the editor.
app = replace_once(
    app,
    "      print: async (universalDocument, providerId) => {\n        const snapshot = canvasApi.normalizeDocument(universalDocument);\n        return printUniversalLabels(product, snapshot, providerId);\n      },",
    "      print: async (universalDocument, providerId) => {\n        const snapshot = { ...canvasApi.normalizeDocument(universalDocument), priceFormat:initialTemplate?.priceFormat || 'full' };\n        return printUniversalLabels(product, snapshot, providerId);\n      },",
    'editor print priceFormat'
)

# 4) Add a real primary simple print screen. The 9-step wizard remains available only as Advanced.
simple_fn = r'''  function openSimpleLabelModal(product, initialTemplateId = '') {
    const businessId = currentBusiness()?.id || '';
    if (!businessId || !product?.id) return toast('Selecciona un negocio y un producto antes de imprimir.', 'err');
    if (product.businessId && product.businessId !== businessId) return toast('El producto no pertenece al negocio activo.', 'err');

    const templates = labelTemplatesForBiz(businessId);
    const selected = templates.find((template) => template.id === initialTemplateId)
      || templates.find((template) => template.isDefault)
      || templates[0]
      || null;
    const templateOptions = templates.length
      ? templates.map((template) => `<option value="${escapeHtml(template.id)}" ${template.id === selected?.id ? 'selected' : ''}>${escapeHtml(template.name || 'Plantilla')}</option>`).join('')
      : '<option value="">No hay plantillas guardadas</option>';

    showModal(`<div class="modalHeader"><div><h2>Imprimir etiquetas</h2><p class="fieldHint">Usa tu plantilla guardada sin repetir la configuración. El lienzo y el asistente quedan disponibles para editar.</p></div><button class="closeBtn" data-close aria-label="Cerrar">×</button></div>
      <section class="quickLabelHome" data-r30-simple-label="true">
        <div class="quickLabelProduct"><span>${icon('package')}</span><div><small>Producto</small><b>${escapeHtml(product.name || 'Producto')}</b><em>${escapeHtml(product.code || '')}</em></div></div>
        <div class="formGrid quickLabelFields">
          <div class="field full"><label for="quickLabelTemplateSelect">Plantilla</label><select id="quickLabelTemplateSelect">${templateOptions}</select></div>
          <div class="field"><label for="quickLabelHomeQuantity">Cantidad</label><input id="quickLabelHomeQuantity" type="number" min="1" max="500" step="1" inputmode="numeric" value="1"></div>
          <div class="field"><label for="quickLabelHomeStartSlot">Empezar en casilla</label><input id="quickLabelHomeStartSlot" type="number" min="1" max="120" step="1" inputmode="numeric" value="1"></div>
        </div>
        <div class="quickLabelStartActions" role="group" aria-label="Inicio rápido"><button type="button" class="btn" id="quickLabelStartLeft">Primera casilla</button><button type="button" class="btn" id="quickLabelStartRight">Segunda columna</button></div>
        <div class="quickLabelSummary" id="quickLabelHomeSummary" role="status" aria-live="polite"></div>
        <div class="quickLabelPrimaryActions"><button type="button" class="btn primary" id="quickLabelHomePrint">${icon('printer')} Imprimir</button><button type="button" class="btn" id="quickLabelHomePdf">${icon('file-down')} PDF</button></div>
        <div class="quickLabelSecondaryActions"><button type="button" class="btn" id="quickLabelHomeEdit">${icon('edit-3')} Editar plantilla</button><button type="button" class="btn" id="quickLabelHomeAdvanced">${icon('settings-2')} Configuración avanzada</button></div>
      </section>`);

    const templateSelect = $('#quickLabelTemplateSelect');
    const quantityInput = $('#quickLabelHomeQuantity');
    const startInput = $('#quickLabelHomeStartSlot');
    const summary = $('#quickLabelHomeSummary');
    const printButton = $('#quickLabelHomePrint');
    const pdfButton = $('#quickLabelHomePdf');
    const rightButton = $('#quickLabelStartRight');
    let busy = false;

    const currentTemplate = () => templates.find((template) => template.id === templateSelect?.value) || selected || null;
    const currentSetup = () => {
      const template = currentTemplate();
      if (!template) return { template:null, profile:null, paper:null };
      const profile = resolveLabelPrintProfile(businessId, template, '');
      const documentModel = universalDocumentFromTemplate(template);
      const paper = profile?.universalPaper || documentModel?.paper || null;
      return { template, profile, paper };
    };
    const refreshSummary = () => {
      const { template, profile, paper } = currentSetup();
      const columns = Math.max(1, Number(paper?.columns || 1));
      if (rightButton) {
        rightButton.hidden = columns < 2;
        rightButton.textContent = columns === 2 ? 'Segunda columna' : `Columna ${columns}`;
      }
      if (!template) {
        summary.innerHTML = '<b>Primero crea una plantilla.</b><span>No se imprimirá nada hasta guardar diseño y papel.</span>';
        printButton.disabled = true;
        pdfButton.disabled = true;
        return;
      }
      const priceMode = template.priceFormat === 'abbr' ? 'Precio abreviado' : template.priceFormat === 'noLabel' ? 'Precio sin etiqueta' : template.priceFormat === 'cash' ? 'Solo efectivo' : 'Precio completo';
      const paperText = paper ? `${paper.widthMm}×${paper.heightMm} mm · ${columns} columna${columns === 1 ? '' : 's'}` : 'Papel por configurar';
      summary.innerHTML = `<b>${escapeHtml(template.name || 'Plantilla')}</b><span>${escapeHtml(profile?.name || paperText)} · ${escapeHtml(priceMode)}</span>`;
      printButton.disabled = false;
      pdfButton.disabled = false;
    };

    $('#quickLabelStartLeft').onclick = () => { startInput.value = '1'; };
    if (rightButton) rightButton.onclick = () => {
      const columns = Math.max(1, Number(currentSetup().paper?.columns || 1));
      startInput.value = String(columns >= 2 ? 2 : 1);
    };
    if (templateSelect) templateSelect.onchange = () => { startInput.value = '1'; refreshSummary(); };

    const execute = async (providerId) => {
      if (busy) return;
      const { template } = currentSetup();
      if (!template) return toast('Primero guarda una plantilla de etiquetas.', 'err');
      const quantity = Math.max(1, Number(quantityInput?.value || 1));
      const startSlot = Math.max(1, Number(startInput?.value || 1));
      busy = true;
      printButton.disabled = true;
      pdfButton.disabled = true;
      summary.innerHTML = `<b>Preparando ${providerId === 'pdf' ? 'PDF' : 'impresión'}…</b><span>CLICK está reconstruyendo la plantilla y el plan físico.</span>`;
      try {
        const prepared = await prepareLabelPrintJob({
          product, template, templateId:template.id, quantity, startSlot, businessId,
          priceFormat:template.priceFormat || 'full'
        });
        if (prepared.plan?.count !== quantity) throw new Error(`El plan preparó ${prepared.plan?.count || 0} de ${quantity} etiquetas.`);
        closeModal();
        return await executeCanonicalLabelPrint(prepared, providerId);
      } catch (error) {
        console.warn('R30 simple label flow failed:', error);
        toast(error.message || 'No se pudo preparar la impresión.', 'err');
        busy = false;
        if (document.body.contains(printButton)) printButton.disabled = false;
        if (document.body.contains(pdfButton)) pdfButton.disabled = false;
        if (document.body.contains(summary)) refreshSummary();
        return null;
      }
    };

    printButton.onclick = () => execute('system');
    pdfButton.onclick = () => execute('pdf');
    $('#quickLabelHomeEdit').onclick = () => {
      const template = currentTemplate();
      closeModal();
      openLabelModal(product, template?.id || '', { editorOnly:true });
    };
    $('#quickLabelHomeAdvanced').onclick = () => {
      const template = currentTemplate();
      closeModal();
      openAdvancedLabelModal(product, template?.id || '', { advancedOnly:true });
    };
    refreshSummary();
  }

'''
needle = "  async function openLabelModal(product, initialTemplateId = '', options = {}) {"
if 'function openSimpleLabelModal(' in app:
    raise SystemExit('openSimpleLabelModal already exists; refusing duplicate patch')
if needle not in app:
    raise SystemExit('openLabelModal anchor not found')
app = app.replace(needle, simple_fn + needle, 1)

# 5) Route normal label entry to the simple screen first. Direct actions still use the same canonical engine.
start = app.index(needle)
templates_anchor = "    const templates = labelTemplatesForBiz(businessId);"
anchor_at = app.index(templates_anchor, start)
old_prefix = app[start:anchor_at]
if "p2UniversalLabelsEnabled" not in old_prefix or "options.directPrint || options.directPdf" not in old_prefix:
    raise SystemExit('openLabelModal prologue did not match expected r29 structure')
new_prefix = r'''  async function openLabelModal(product, initialTemplateId = '', options = {}) {
    if (options.directPrint || options.directPdf) {
      return runQuickLabelPrintFlow({
        product,
        templateId:initialTemplateId,
        action:options.directPdf ? 'pdf' : 'print'
      });
    }
    if (options.advancedOnly) return openAdvancedLabelModal(product, initialTemplateId, options);
    if (!options.editorOnly) return openSimpleLabelModal(product, initialTemplateId);

    const editor = window.CLICK360_UNIVERSAL_LABEL_EDITOR;
    const canvasApi = window.CLICK360_UNIVERSAL_LABEL_CANVAS;
    const editorBusiness = currentBusiness();
    const businessId = editorBusiness?.id || '';
    if (!editor || !canvasApi) return openAdvancedLabelModal(product, initialTemplateId, options);
    if (!businessId || (product?.businessId && product.businessId !== businessId)) return toast('El producto no pertenece al negocio activo.', 'err');

'''
app = app[:start] + new_prefix + app[anchor_at:]

APP.write_text(app, encoding='utf-8')

# 6) Append responsive styles for the simple primary screen without changing physical print CSS.
styles = STYLES.read_text(encoding='utf-8')
marker = '/* CLICK360_R30_SIMPLE_LABEL */'
if marker in styles:
    raise SystemExit('R30 simple label styles already exist; refusing duplicate patch')
styles += r'''

/* CLICK360_R30_SIMPLE_LABEL */
.quickLabelHome{display:grid;gap:16px;min-width:0;max-width:760px;margin:0 auto;padding:4px 0 8px}
.quickLabelProduct{display:flex;align-items:center;gap:14px;min-width:0;padding:16px;border:1px solid var(--border);border-radius:16px;background:var(--panel2,#151515)}
.quickLabelProduct>span{display:grid;place-items:center;flex:0 0 44px;width:44px;height:44px;border-radius:14px;background:rgba(241,194,50,.14);color:var(--accent,#f1c232)}
.quickLabelProduct>div{display:grid;min-width:0;gap:2px}.quickLabelProduct small,.quickLabelProduct em{color:var(--muted);font-style:normal}.quickLabelProduct b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.quickLabelFields{margin:0}.quickLabelStartActions,.quickLabelPrimaryActions,.quickLabelSecondaryActions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;min-width:0}
.quickLabelStartActions .btn,.quickLabelPrimaryActions .btn,.quickLabelSecondaryActions .btn{min-width:0;width:100%;white-space:normal}
.quickLabelSummary{display:grid;gap:4px;min-width:0;padding:14px 16px;border:1px solid rgba(241,194,50,.28);border-radius:14px;background:rgba(241,194,50,.07)}
.quickLabelSummary b,.quickLabelSummary span{min-width:0;overflow-wrap:anywhere}.quickLabelSummary span{color:var(--muted)}
.quickLabelPrimaryActions .btn{min-height:52px;font-weight:800}.quickLabelSecondaryActions .btn{min-height:44px}
@media(max-width:600px){.quickLabelHome{gap:13px}.quickLabelStartActions,.quickLabelSecondaryActions{grid-template-columns:1fr}.quickLabelPrimaryActions{grid-template-columns:1fr 1fr}.quickLabelProduct{padding:13px}.quickLabelFields{grid-template-columns:1fr}.quickLabelFields .field{min-width:0}.quickLabelFields input,.quickLabelFields select{width:100%;max-width:100%;box-sizing:border-box}}
@media(max-width:340px){.quickLabelPrimaryActions{grid-template-columns:1fr}}
'''
STYLES.write_text(styles, encoding='utf-8')

bump_release_contract()
print('CLICK360_R30_PATCH_APPLIED')
