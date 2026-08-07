from pathlib import Path

root = Path(__file__).resolve().parents[1]
old = 'commercial-1-0-5-r29'
new = 'commercial-1-0-5-r30'
changed = []

candidates = []
for pattern in ('qa*.cjs', 'qa*.mjs', 'qa*.js'):
    candidates.extend(root.glob(pattern))
qa_dir = root / 'qa'
if qa_dir.exists():
    for pattern in ('*.cjs', '*.mjs', '*.js', '*.html'):
        candidates.extend(qa_dir.rglob(pattern))

for path in sorted(set(candidates)):
    # r30 tests intentionally assert that r29 is absent; never mutate those controls.
    if path.name.startswith('qa-r30-') or path.name.startswith('r30-'):
        continue
    text = path.read_text(encoding='utf-8')
    if old not in text:
        continue
    updated = text.replace(old, new)
    path.write_text(updated, encoding='utf-8')
    changed.append(str(path.relative_to(root)))

print('CLICK360_R30_QA_RELEASE_CONTRACTS:', ', '.join(changed) if changed else 'none')
