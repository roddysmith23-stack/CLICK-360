from pathlib import Path

root = Path(__file__).resolve().parents[1]
old = 'commercial-1-0-5-r29'
new = 'commercial-1-0-5-r30'

# Exact text assets copied by scripts/build-static-release.mjs. Assets/vendor are binary/static
# and are intentionally excluded; only first-party runtime text may carry the release token.
runtime_files = [
    'index.html',
    'styles.css',
    'runtime-guard.js',
    'app.js',
    'firebase-config.js',
    'p0-tenant-guard.js',
    'v16-domain.js',
    'v16-storage.js',
    'access-flow.js',
    'firebase-service.js',
    'printing-service.js',
    'smart-print-core.js',
    'p2-web-safe-flags.js',
    'p2-restaurant-domain.js',
    'p2-logistics-domain.js',
    'universal-label-canvas.js',
    'universal-label-editor.js',
    'service-worker.js',
    'manifest.webmanifest',
    'robots.txt',
    'sitemap.xml',
]

changed = []
for relative in runtime_files:
    path = root / relative
    if not path.exists():
        raise SystemExit(f'missing published runtime file: {relative}')
    text = path.read_text(encoding='utf-8')
    updated = text.replace(old, new)
    if updated != text:
        path.write_text(updated, encoding='utf-8')
        changed.append(relative)

# Core release surfaces must all explicitly advertise r30 after the pass.
for relative in ['app.js', 'firebase-service.js', 'styles.css', 'service-worker.js', 'runtime-guard.js', 'index.html', 'manifest.webmanifest']:
    text = (root / relative).read_text(encoding='utf-8')
    if old in text:
        raise SystemExit(f'stale r29 release token remains in {relative}')
    if new not in text:
        raise SystemExit(f'r30 release token missing from {relative}')

# No text file that is actually shipped may retain the old release token.
remaining = []
for relative in runtime_files:
    text = (root / relative).read_text(encoding='utf-8')
    if old in text:
        remaining.append(relative)
if remaining:
    raise SystemExit('stale r29 release token remains in published runtime: ' + ', '.join(remaining))

print('CLICK360_R30_VERSION_COHERENCE: APPLIED ' + (', '.join(changed) if changed else 'already coherent'))
