from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match in {path}, found {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')
    print(f'patched {label}: {path}')


def replace_if_stale(path, old, new, label):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count == 0:
        if new in text:
            print(f'already aligned {label}: {path}')
            return
        raise SystemExit(f'{label}: neither stale nor current contract found in {path}')
    if count != 1:
        raise SystemExit(f'{label}: expected at most 1 stale match in {path}, found {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')
    print(f'patched {label}: {path}')


# Empty-device recovery may only claim success after a real cloud pull.
replace_once(
    'app.js',
    "if (result?.ok) {\n\t\t            closeModal(false);\n\t\t            renderApp(route);\n\t\t            toast('✅ Tus datos se actualizaron desde la nube.', 'ok');",
    "if (result?.refreshed === true) {\n\t\t            closeModal(false);\n\t\t            renderApp(route);\n\t\t            toast('✅ Tus datos se actualizaron desde la nube.', 'ok');",
    'empty-device success requires actual remote refresh',
)

# Historical P1.5B QA must validate the current candidate cache, not r20.
# This is a test-contract correction only; runtime behavior is not weakened.
replace_if_stale(
    'qa-p1-5b-production-ux-polish-harness.cjs',
    "const ASSET = 'commercial-1-0-5-r20';",
    "const ASSET = 'commercial-1-0-5-r29';",
    'P1.5B QA asset contract r29',
)

# The label engine already passes quantity/start-slot tests. The remaining regression
# was purely mobile layout: the fixed footer physically covered the scrollable wizard body.
styles = Path('styles.css')
css = styles.read_text(encoding='utf-8')
marker = '/* CLICK 360 label stability: footer participates in mobile modal layout */'
if marker in css:
    raise SystemExit('label mobile footer stability override already exists')
css += r'''

/* CLICK 360 label stability: footer participates in mobile modal layout */
@media(max-width:899px){
  .labelEditorModal{
    overflow:hidden!important;
  }
  .labelEditorModal .labelCustomizerLayout{
    min-height:0!important;
    overflow:auto!important;
    overscroll-behavior:contain!important;
    padding:0 4px 12px!important;
  }
  .smartWizardFooter{
    position:relative!important;
    left:auto!important;
    right:auto!important;
    bottom:auto!important;
    width:100%!important;
    max-width:100%!important;
    margin:0!important;
    flex:0 0 auto!important;
  }
}
'''
styles.write_text(css, encoding='utf-8')
print('patched label mobile footer layout')

print('final stability candidate patch applied successfully')
