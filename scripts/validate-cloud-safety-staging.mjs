import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const project='click360-staging-7620168025';
assert.equal(process.argv[2]||project,project,'This check cannot target production');
const config=JSON.parse(await readFile('firebase.staging.json','utf8'));
assert.equal(config.hosting.site,project);assert.equal(config.hosting.public,'dist');
assert.equal(config.firestore.rules,'firestore.rules');
assert.equal(config.functions.codebase,'cloud-safety');assert.equal(config.functions.source,'functions');
const sha=execFileSync('git',['rev-parse','--short=12','HEAD'],{encoding:'utf8'}).trim();
const manifest=JSON.parse(await readFile('dist/release-manifest.json','utf8'));
assert.equal(manifest.buildSha,sha);
for(const [file,hash]of Object.entries(manifest.assetHashes)){
  assert(!file.includes('..')&&!file.startsWith('/'));
  assert.equal(createHash('sha256').update(await readFile(`dist/${file}`)).digest('hex'),hash,`Artifact mismatch: ${file}`);
}
const firebaseConfig=await readFile('dist/firebase-config.js','utf8');
for(const host of [`${project}.web.app`,`${project}--safety-fixture.web.app`]){
  const window={location:{hostname:host}};vm.runInNewContext(firebaseConfig,{window});
  assert.equal(window.CLICK360_FIREBASE_CONFIG.projectId,project);
}
assert.deepEqual(await readFile('functions/generated/cloud-safety-backup.cjs'),await readFile('cloud-safety-backup.js'),'Server codec must be the exact canonical client codec');
console.log(JSON.stringify({status:'PASS_LOCAL_STAGING_PREFLIGHT',project,buildSha:sha,assetCount:Object.keys(manifest.assetHashes).length,codebase:'cloud-safety',productionWrites:0,deploymentPerformed:false}));
