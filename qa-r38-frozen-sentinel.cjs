'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
const base='7155238b4e0097c136d9ae9f4be291f25697f012';
for(const file of ['firestore.rules','worker-data-boundary.js','v16-domain.js','p0-tenant-guard.js',
  'p2-restaurant-domain.js','p2-logistics-domain.js','safe-update.js','access-flow.js',
  'universal-label-canvas.js','universal-label-editor.js','printing-service.js','vendor/qrcode-generator.js']){
  let source=fs.readFileSync(file,'utf8');
  if(file==='firestore.rules'){
    // Owner-authorized additive archive scope; ALL pre-existing Rules remain
    // byte-identical. New Rules are independently exercised with real clients.
    const begin='    // BEGIN CLOUD SAFETY BACKUP ADDITIVE RULES\n';
    const end='    // END CLOUD SAFETY BACKUP ADDITIVE RULES\n';
    assert.equal(source.split(begin).length,2,'Exactly one additive Rules block');
    assert.equal(source.split(end).length,2,'Exactly one additive Rules terminator');
    source=source.slice(0,source.indexOf(begin))+source.slice(source.indexOf(end)+end.length);
  }
  assert(Buffer.from(source).equals(execFileSync('git',['show',`${base}:${file}`])),`Frozen system changed: ${file}`);
}
const changes=execFileSync('git',['diff','--name-only',base],{encoding:'utf8'}).trim().split('\n');
const safetyFunctions=new Set(['functions/package.json','functions/package-lock.json','functions/index.cjs','functions/safety-verifier.cjs']);
assert(!changes.some(p=>(p.startsWith('functions/')&&!safetyFunctions.has(p))||p.startsWith('tools/admin/')),'No incidental server/admin changes');
const config=JSON.parse(fs.readFileSync('firebase.staging.json','utf8'));
assert.equal(config.hosting.site,'click360-staging-7620168025');
assert.equal(config.hosting.public,'dist');
console.log('PASS frozen Sentinel: Rules, tenant boundary, Auth/access, financial domain, Restaurant/Logistics, Safe Update, QR artwork and print provider byte-identical to modern main');
