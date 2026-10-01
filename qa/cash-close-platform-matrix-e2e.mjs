import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const test = path.join(root, 'qa/p0-shary-cash-close-save-rejected-e2e.mjs');
const profiles = [
  { label:'iPhone Safari engine', browser:'webkit', device:'iPhone 15', standalone:'0' },
  { label:'iPhone installed PWA', browser:'webkit', device:'iPhone 15', standalone:'1' },
  { label:'Android Chrome engine', browser:'chromium', device:'Pixel 7', standalone:'0' },
  { label:'Android installed PWA', browser:'chromium', device:'Pixel 7', standalone:'1' },
  { label:'Windows-macOS Chrome compatible', browser:'chromium', device:'Desktop Chrome', standalone:'0' },
  { label:'macOS Safari engine', browser:'webkit', device:'Desktop Safari', standalone:'0' },
  { label:'desktop Firefox', browser:'firefox', device:'Desktop Firefox', standalone:'0' },
  { label:'Windows Edge compatible emulation', browser:'chromium', device:'Desktop Edge', standalone:'0' }
];

function runProfile(profile, index) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [test], {
      cwd:root,
      stdio:'inherit',
      env:{
        ...process.env,
        CLICK360_CASH_CLOSE_BROWSER:profile.browser,
        CLICK360_CASH_CLOSE_DEVICE:profile.device,
        CLICK360_CASH_CLOSE_STANDALONE:profile.standalone,
        CLICK360_CASH_CLOSE_PLATFORM_LABEL:profile.label,
        CLICK360_CASH_CLOSE_SMOKE:'1',
        CLICK360_SHARY_CLOSE_SAVE_E2E_PORT:String(4750 + index)
      }
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0
      ? resolve()
      : reject(new Error(`${profile.label} failed (${signal || code})`)));
  });
}

for (const [index, profile] of profiles.entries()) await runProfile(profile, index);
console.log(`PASS cash-close platform matrix: ${profiles.length} automated browser/device/display profiles`);
