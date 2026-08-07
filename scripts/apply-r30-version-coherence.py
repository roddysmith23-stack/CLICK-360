from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'firebase-service.js'
text = path.read_text(encoding='utf-8')
old = "const APP_ASSET_VERSION = 'commercial-1-0-5-r29';"
new = "const APP_ASSET_VERSION = 'commercial-1-0-5-r30';"
count = text.count(old)
if count != 1:
    raise SystemExit(f'firebase-service version anchor expected once, found {count}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('CLICK360_R30_FIREBASE_SERVICE_VERSION: APPLIED')
