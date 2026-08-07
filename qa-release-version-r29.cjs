'use strict';

const fs = require('fs');
const assert = require('node:assert/strict');
const path = require('node:path');

const expected = 'commercial-1-0-5-r33';
const stale = ['commercial-1-0-5-r20', 'commercial-1-0-5-r28'];
const files = ['app.js','firebase-service.js','runtime-guard.js','service-worker.js','index.html','styles.css'];

for (const file of files) {
  const text = fs.readFileSync(file,'utf8');
  assert(text.includes(expected), `${file} must reference ${expected}`);
  for (const old of stale) assert(!text.includes(old), `${file} must not reference stale ${old}`);
}

assert(fs.readFileSync('app.js','utf8').includes("APP_ASSET_VERSION = 'commercial-1-0-5-r33'"),'app metadata r29');
assert(fs.readFileSync('firebase-service.js','utf8').includes("APP_ASSET_VERSION = 'commercial-1-0-5-r33'"),'firebase cache cleanup r29');
assert(fs.readFileSync('runtime-guard.js','utf8').includes("ASSET_VERSION = 'commercial-1-0-5-r33'"),'runtime guard r29');
assert(fs.readFileSync('service-worker.js','utf8').includes("click360-commercial-1-0-5-r33"),'service worker cache r29');

function walk(dir){
  const out=[];
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

if(fs.existsSync('dist')){
  for(const file of walk('dist')){
    if(!/\.(html|js|css|json|webmanifest)$/i.test(file)) continue;
    const text=fs.readFileSync(file,'utf8');
    for(const old of stale) assert(!text.includes(old), `dist contains stale ${old}: ${file}`);
  }
}

console.log('CLICK360_RELEASE_VERSION_R29: PASS single coherent asset/cache version');
