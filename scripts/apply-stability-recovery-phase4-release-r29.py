from pathlib import Path

OLD = ('commercial-1-0-5-r20', 'commercial-1-0-5-r28')
NEW = 'commercial-1-0-5-r29'
ALLOWED_SUFFIXES = {'.js', '.css', '.html', '.json', '.webmanifest'}
EXCLUDED = {'package-lock.json'}

changed = []
for path in sorted(Path('.').iterdir()):
    if not path.is_file() or path.name in EXCLUDED or path.suffix not in ALLOWED_SUFFIXES:
        continue
    text = path.read_text(encoding='utf-8', errors='ignore')
    updated = text
    for old in OLD:
        updated = updated.replace(old, NEW)
    if updated != text:
        path.write_text(updated, encoding='utf-8')
        changed.append(path.name)
        print(f'patched release asset refs: {path.name}')

required = {'index.html', 'runtime-guard.js'}
missing = sorted(required - set(changed))
if missing:
    raise SystemExit(f'expected stale release refs in {missing}, but none were replaced')

for path in sorted(Path('.').iterdir()):
    if not path.is_file() or path.name in EXCLUDED or path.suffix not in ALLOWED_SUFFIXES:
        continue
    text = path.read_text(encoding='utf-8', errors='ignore')
    stale = [old for old in OLD if old in text]
    if stale:
        raise SystemExit(f'stale asset versions remain in runtime file {path}: {stale}')

print('phase4 release r29 unification applied:', ', '.join(changed))
