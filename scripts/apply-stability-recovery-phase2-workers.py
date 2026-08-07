from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match in {path}, found {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')
    print(f'patched {label}: {path}')

# Keep firebase-service cache cleanup on the same runtime release as app.js and SW.
replace_once(
    'firebase-service.js',
    "const APP_ASSET_VERSION = 'commercial-1-0-5-r20';",
    "const APP_ASSET_VERSION = 'commercial-1-0-5-r29';",
    'firebase service asset version r29',
)

# The Firestore invitation rule uses the V16.2 contract identifier. A regression
# changed this field to the commercial UI version 1.0.5, making the whole batch fail
# with permission-denied. Restore the authorized contract value without relaxing Rules.
replace_once(
    'firebase-service.js',
    "createdBy: ownerId,\n      appVersion: '1.0.5'",
    "createdBy: ownerId,\n      appVersion: '16.2.0'",
    'worker invitation rules contract version',
)

print('phase2 worker invitation patch applied successfully')
