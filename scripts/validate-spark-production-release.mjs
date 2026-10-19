// Read-only pre-promotion check. This program NEVER invokes Firebase deploy.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
export function validateTarget({projectId,sha,rulesSha256,config,legacy}){
  assert.equal(projectId,'click-360','EXPLICIT_PRODUCTION_PROJECT_REQUIRED');
  assert.match(sha||'',/^[a-f0-9]{40}$/,'EXACT_RELEASE_SHA_REQUIRED');
  assert.match(rulesSha256||'',/^[a-f0-9]{64}$/,'APPROVED_RULES_HASH_REQUIRED');
  assert.deepEqual(Object.keys(config).sort(),['firestore','hosting']);
  assert.deepEqual(config.hosting,legacy.hosting,'PRESERVE_PRODUCTION_HOSTING_CONFIG');
  assert.deepEqual(config.firestore,{rules:'firestore.spark.rules'});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=Object.fromEntries(process.argv.slice(2).map(value=>value.split('=')));
  const config=JSON.parse(await readFile('firebase.spark-production.json','utf8'));
  const legacy=JSON.parse(await readFile('firebase.json','utf8'));
  validateTarget({projectId:args['--project'],sha:args['--sha'],rulesSha256:args['--rules-sha256'],config,legacy});
  assert(!process.env.FIRESTORE_EMULATOR_HOST&&!process.env.FIREBASE_AUTH_EMULATOR_HOST,'PRODUCTION_PACKAGE_MUST_NOT_TARGET_EMULATORS');
  assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),args['--sha']);
  assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'','COMMIT_SOURCE_BEFORE_PROMOTION');
  const sha=value=>createHash('sha256').update(value).digest('hex');
  assert.equal(sha(await readFile(config.firestore.rules)),args['--rules-sha256']);
  const manifest=JSON.parse(await readFile('dist/release-manifest.json','utf8'));
  assert.equal(manifest.buildSha,args['--sha'].slice(0,12));
  for(const [file,hash]of Object.entries(manifest.assetHashes)){
    assert(!file.includes('..')&&!file.startsWith('/')&&!file.includes('\\'),'INVALID_ASSET_PATH');
    assert.equal(sha(await readFile('dist/'+file)),hash,`RELEASE_ASSET_MISMATCH:${file}`);
  }
  assert((await readFile('dist/service-worker.js','utf8')).includes(`const RELEASE_SHA = '${manifest.buildSha}'`));
  console.log(JSON.stringify({status:'PRODUCTION_PACKAGE_VALIDATED',sha:args['--sha'],rulesSha256:args['--rules-sha256'],
    config:'firebase.spark-production.json',projectId:'click-360',authorizationRequired:true,deploymentsExecuted:0}));
}
