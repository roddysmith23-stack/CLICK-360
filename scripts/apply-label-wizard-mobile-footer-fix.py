from pathlib import Path

path = Path('styles.css')
css = path.read_text(encoding='utf-8')
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
path.write_text(css, encoding='utf-8')
print('label wizard mobile footer fix applied')
