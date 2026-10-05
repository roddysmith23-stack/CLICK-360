import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
// Preserve the real pre-safety production build, not a mocked service worker.
const previous='21409a1d2dc710315ab8c3c27e5da566f004cc8e';
const directory=await mkdtemp(path.join(tmpdir(),'click360-safety-upgrade-'));
const checkout=path.join(directory,'previous');
execFileSync('git',['worktree','add','--detach',checkout,previous],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/build-static-release.mjs'],{cwd:checkout,stdio:'inherit'});
execFileSync(process.execPath,['qa/founder-pwa-upgrade-e2e.mjs'],{
  stdio:'inherit',env:{...process.env,CLICK360_OLD_BUILD_DIR:path.join(checkout,'dist')}
});
// Do not remove caches, IndexedDB or the preserved diagnostic checkout here.
