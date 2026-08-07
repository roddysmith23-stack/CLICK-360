from pathlib import Path
import re


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match in {path}, found {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')
    print(f'patched {label}: {path}')


def regex_once(path, pattern, repl, label):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    updated, count = re.subn(pattern, repl, text, count=1, flags=re.MULTILINE)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match in {path}, found {count}')
    p.write_text(updated, encoding='utf-8')
    print(f'patched {label}: {path}')

# ---------- app.js: report filters are UI-only and must not write tenant state ----------
replace_once(
    'app.js',
    """  function bindReports(){\n      $('#repFrom').onchange = (e) => { state.reportsFrom = e.target.value; if(!save()) return; renderApp('reports'); };\n      $('#repTo').onchange = (e) => { state.reportsTo = e.target.value; if(!save()) return; renderApp('reports'); };\n  }""",
    """  function bindReports(){\n      // Report date filters are view state only. Persisting them through save() used to\n      // trigger cloud writes/sync gates from Safari just for changing a filter.\n      $('#repFrom').onchange = (e) => { state.reportsFrom = e.target.value; renderApp('reports'); };\n      $('#repTo').onchange = (e) => { state.reportsTo = e.target.value; renderApp('reports'); };\n  }""",
    'reports filters no longer write tenant data',
)

replace_once(
    'app.js',
    '<div class="card sectionCard" style="display:flex; gap:10px; margin-bottom:14px; align-items:center;">',
    '<div class="card sectionCard reportRangeCard">',
    'responsive report range wrapper',
)

replace_once(
    'app.js',
    'id="financeForm" class="formGrid"',
    'id="financeForm" class="formGrid financeEntryForm"',
    'finance mobile form class',
)

# ---------- app.js: calculator behaves like a bounded PiP window ----------
regex_once(
    'app.js',
    r"(const savedPos = \(\(\) => \{ try \{ return JSON\.parse\(localStorage\.getItem\('calcWindowPos'\) \|\| 'null'\); \} catch \{ return null; \} \}\)\(\);\n\s*)(if \(savedPos\) \{)",
    r"\1const savedSize = (() => { try { return JSON.parse(localStorage.getItem('calcWindowSize') || 'null'); } catch { return null; } })();\n      const calculatorBounds = () => ({ maxW: Math.max(220, window.innerWidth - 16), maxH: Math.max(280, window.innerHeight - 24) });\n      const applyCalculatorWindowSize = (width, height) => {\n        const bounds = calculatorBounds();\n        const nextW = Math.max(220, Math.min(bounds.maxW, Number(width || Math.min(360, bounds.maxW))));\n        const nextH = Math.max(280, Math.min(bounds.maxH, Number(height || Math.min(620, bounds.maxH))));\n        calcSheet.style.width = nextW + 'px';\n        calcSheet.style.height = nextH + 'px';\n        calcSheet.style.maxHeight = bounds.maxH + 'px';\n        return { width: nextW, height: nextH };\n      };\n      const persistCalculatorWindowSize = () => {\n        try { localStorage.setItem('calcWindowSize', JSON.stringify({ width: calcSheet.offsetWidth, height: calcSheet.offsetHeight })); } catch {}\n      };\n      if (savedSize) applyCalculatorWindowSize(savedSize.width, savedSize.height);\n      \2",
    'calculator persisted size helpers',
)

replace_once(
    'app.js',
    "pinchStart = { dist: Math.hypot(dx, dy), h: calcSheet.offsetHeight };",
    "pinchStart = { dist: Math.hypot(dx, dy), w: calcSheet.offsetWidth, h: calcSheet.offsetHeight };",
    'calculator pinch captures width and height',
)

regex_once(
    'app.js',
    r"\s*const newH = Math\.max\(220, Math\.min\(window\.innerHeight - 40, Math\.round\(pinchStart\.h \* Math\.hypot\(dx, dy\) / pinchStart\.dist\)\)\);\s*\n\s*calcSheet\.style\.height = newH \+ 'px';\s*\n\s*calcSheet\.style\.maxHeight = newH \+ 'px';",
    "\n          const scale = Math.max(0.55, Math.min(1.8, Math.hypot(dx, dy) / Math.max(1, pinchStart.dist)));\n          applyCalculatorWindowSize(Math.round(pinchStart.w * scale), Math.round(pinchStart.h * scale));",
    'calculator pinch resizes whole window',
)

replace_once(
    'app.js',
    "calcSheet.addEventListener('touchend', function() { pinchStart = null; });",
    "calcSheet.addEventListener('touchend', function() { if (pinchStart) persistCalculatorWindowSize(); pinchStart = null; });",
    'calculator pinch size persistence',
)

regex_once(
    'app.js',
    r"\s*const newH = Math\.max\(220, Math\.min\(window\.innerHeight - 40, calcSheet\.offsetHeight \+ \(ev\.deltaY > 0 \? -24 : 24\)\)\);\s*\n\s*calcSheet\.style\.height = newH \+ 'px';\s*\n\s*calcSheet\.style\.maxHeight = newH \+ 'px';",
    "\n        const factor = ev.deltaY > 0 ? 0.92 : 1.08;\n        applyCalculatorWindowSize(Math.round(calcSheet.offsetWidth * factor), Math.round(calcSheet.offsetHeight * factor));\n        persistCalculatorWindowSize();",
    'calculator desktop proportional resize',
)

regex_once(
    'app.js',
    r"calcSheet\.style\.left\s*=\s*Math\.max\(0,\s*Math\.min\(window\.innerWidth\s*-\s*220,\s*savedPos\.x\)\)\s*\+\s*'px';\s*\n\s*calcSheet\.style\.top\s*=\s*Math\.max\(0,\s*Math\.min\(window\.innerHeight\s*-\s*120,\s*savedPos\.y\)\)\s*\+\s*'px';",
    "calcSheet.style.left = Math.max(8, Math.min(Math.max(8, window.innerWidth - calcSheet.offsetWidth - 8), Number(savedPos.x || 8))) + 'px';\n        calcSheet.style.top = Math.max(8, Math.min(Math.max(8, window.innerHeight - calcSheet.offsetHeight - 8), Number(savedPos.y || 8))) + 'px';",
    'calculator restored position stays onscreen',
)

regex_once(
    'app.js',
    r"const nx = Math\.max\(0, Math\.min\(window\.innerWidth - 220, calcDrag\.x \+ ev\.clientX - calcDrag\.startX\)\);\s*\n\s*const ny = Math\.max\(0, Math\.min\(window\.innerHeight - 80, calcDrag\.y \+ ev\.clientY - calcDrag\.startY\)\);",
    "const nx = Math.max(8, Math.min(Math.max(8, window.innerWidth - calcSheet.offsetWidth - 8), calcDrag.x + ev.clientX - calcDrag.startX));\n        const ny = Math.max(8, Math.min(Math.max(8, window.innerHeight - calcSheet.offsetHeight - 8), calcDrag.y + ev.clientY - calcDrag.startY));",
    'calculator drag stays fully onscreen',
)

# ---------- styles.css: align cached assets and add final mobile containment layer ----------
styles = Path('styles.css')
css = styles.read_text(encoding='utf-8')
stale_count = css.count('commercial-1-0-5-r20')
if stale_count:
    css = css.replace('commercial-1-0-5-r20', 'commercial-1-0-5-r29')

marker = '/* CLICK 360 stability recovery r29: mobile containment */'
if marker in css:
    raise SystemExit('mobile stability block already exists')
css += r'''

/* CLICK 360 stability recovery r29: mobile containment */
.reportRangeCard{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:10px;
  margin-bottom:14px;
  align-items:end;
}
.reportRangeCard .field{margin:0;min-width:0}
.financeEntryForm>*{min-width:0;max-width:100%}

@media(max-width:760px){
  .modalOverlay{
    padding:max(8px,env(safe-area-inset-top,0px)) max(8px,env(safe-area-inset-right,0px)) max(8px,env(safe-area-inset-bottom,0px)) max(8px,env(safe-area-inset-left,0px));
    overflow:hidden;
  }
  .modal{
    width:calc(100vw - max(16px,env(safe-area-inset-left,0px) + env(safe-area-inset-right,0px)));
    max-width:calc(100vw - 16px);
    max-height:calc(100dvh - max(16px,env(safe-area-inset-top,0px) + env(safe-area-inset-bottom,0px)));
    overflow-y:auto;
    overflow-x:hidden;
    overscroll-behavior:contain;
    padding:16px;
  }
  .modalHeader{align-items:flex-start;min-width:0}
  .modalHeader>div,.modalHeader h2{min-width:0;max-width:100%;overflow-wrap:anywhere}
  .formGrid,.financeEntryForm,.reportRangeCard{
    grid-template-columns:minmax(0,1fr)!important;
    width:100%;
    min-width:0;
  }
  .field,.field>label,.field>input,.field>select,.field>textarea{
    min-width:0!important;
    max-width:100%!important;
  }
  input[type="date"],input[type="time"],input[type="datetime-local"],input[type="month"]{
    display:block;
    width:100%!important;
    min-width:0!important;
    max-width:100%!important;
    box-sizing:border-box!important;
  }
  .sectionCard,.sectionCard>*{min-width:0;max-width:100%}
  .sectionCard .toolbar,.pageHead .toolbar{width:100%;display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
  .sectionCard .toolbar .btn,.pageHead .toolbar .btn{width:100%;min-width:0;white-space:normal;overflow-wrap:anywhere}
  .pageHead{align-items:stretch;flex-direction:column}
  .btn{white-space:normal;overflow-wrap:anywhere;text-align:center}
  .calculatorWorkspace .calculatorSheet{
    min-width:220px;
    min-height:280px;
    max-width:calc(100vw - 16px)!important;
    max-height:calc(100dvh - 16px)!important;
    overscroll-behavior:contain;
  }
  .calculatorBody{min-width:0;overflow-x:hidden}
  .calculatorKeys{grid-template-columns:repeat(4,minmax(0,1fr))}
  .calculatorKeys button{min-width:0}
}
'''
styles.write_text(css, encoding='utf-8')
print(f'patched styles: updated {stale_count} stale r20 asset refs + mobile containment block')

print('phase3 mobile/reports/calculator patch applied successfully')
