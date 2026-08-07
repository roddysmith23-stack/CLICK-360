from pathlib import Path

root = Path(__file__).resolve().parents[1]

firebase = root / 'firebase-service.js'
text = firebase.read_text(encoding='utf-8')
old = "const APP_ASSET_VERSION = 'commercial-1-0-5-r29';"
new = "const APP_ASSET_VERSION = 'commercial-1-0-5-r30';"
count = text.count(old)
if count != 1:
    raise SystemExit(f'firebase-service version anchor expected once, found {count}')
firebase.write_text(text.replace(old, new, 1), encoding='utf-8')

styles = root / 'styles.css'
styles_text = styles.read_text(encoding='utf-8')
updated_styles = styles_text.replace('commercial-1-0-5-r29', 'commercial-1-0-5-r30')
if updated_styles == styles_text:
    raise SystemExit('styles.css has no r29 asset references to advance to r30')
styles.write_text(updated_styles, encoding='utf-8')

print('CLICK360_R30_VERSION_COHERENCE: APPLIED firebase-service + styles')
