// Scope relocation must not change predicates or effective permission paths.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compactBoundParameters,restoreBoundParameters,compactFunctionSymbols,restoreFunctionSymbols} from './scripts/spark-rules-bound-parameters.mjs';
export function fingerprints(source){
  const tokens=[...source.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9]*|\d+(?:\.\d+)?|[^\s]/g)]
    .map(m=>m[0]).filter(t=>!t.startsWith('//')&&!t.startsWith('/*'));
  const functions=[],permissions=[],scopes=[];let depth=0;
  for(let i=0;i<tokens.length;i++){
    if(tokens[i]==='function'){
      const start=i,name=tokens[i+1];let open=i;
      while(tokens[open]!=='{')open++;
      let end=open+1,nesting=1;for(;nesting;end++){assert(end<tokens.length);if(tokens[end]==='{')nesting++;if(tokens[end]==='}')nesting--;}
      functions.push({name,tokens:tokens.slice(start,end)});i=end-1;continue;
    }
    if(tokens[i]==='match'){
      const path=[];let p=i+1;
      for(;p<tokens.length;p++){
        if(tokens[p]==='{'){
          // A path capture is {identifier} preceded by '/' or '=' wildcard;
          // the final block opener is not followed by an identifier + '}'.
          if(tokens[p+2]!=='}')break;
          path.push(tokens[p],tokens[p+1],tokens[p+2]);p+=2;
        }else path.push(tokens[p]);
      }
      assert(p<tokens.length);depth++;scopes.push({depth,path:path.join('')});i=p;continue;
    }
    if(tokens[i]==='allow'){
      let end=i;while(tokens[end]!==';')end++;
      permissions.push({path:scopes.map(s=>s.path).join(''),tokens:tokens.slice(i,end+1)});i=end;continue;
    }
    if(tokens[i]==='{')depth++;
    if(tokens[i]==='}'){
      if(scopes.at(-1)?.depth===depth)scopes.pop();depth--;
    }
  }
  assert.equal(new Set(functions.map(f=>f.name)).size,functions.length,'Duplicate function definitions');
  const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return {functionsHash:hash(functions.sort((a,b)=>a.name.localeCompare(b.name))),permissionsHash:hash(permissions.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))),functions:functions.length,permissions:permissions.length};
}
if(process.argv[1]?.endsWith('qa-spark-rules-scope-parity.mjs')){
  const deployed=readFileSync('firestore.spark.rules','utf8'),source=restoreFunctionSymbols(deployed).content,actual=fingerprints(source);
  assert.equal(compactFunctionSymbols(deployed).replacements,0,'Keep the certified backend executable symbol budget');
  assert.equal(compactFunctionSymbols(source).content,deployed,'Function alpha-renaming must be exactly reversible');
  const expected=JSON.parse(readFileSync('qa/fixtures/spark-rules-scope-parity.json','utf8'));
  if(expected.p0dAuthorizationChange){
    const start=source.indexOf('    // P0D policy'),end=source.indexOf('    // Optional owner-only recovery preservation',start);
    assert(start>0&&end>start);
    let retained=source.slice(0,start)+source.slice(end);
    if(expected.initialSourceClaimAuthorizationChange){
      const extension=retained.match(/    \/\/ Optional administrative tightening for an unattended pilot\.[\s\S]*?\n    match \/businesses\/\{ownerUid\}\/metadata\/\{metadataId\} \{/);
      assert(extension,'Exact initial-claim extension boundary required');
      retained=retained.replace(extension[0],'    match /businesses/{ownerUid}/metadata/{metadataId} {');
      const guard='        && (get(/databases/$(database)/documents/storageRollout/sparkV1).data.get("sourceBoundPreparation", false) != true\n          || sparkInitialSourceClaim(ownerUid))\n';
      assert(retained.includes(guard),'Only the reviewed optional create guard may be removed for baseline parity');
      retained=retained.replace(guard,'');
      const helper=source.match(/function sparkInitialSourceClaim\(_o\) \{[\s\S]*?\n    \}/)[0];
      assert.equal(createHash('sha256').update(helper).digest('hex'),expected.initialSourceClaimPredicateSha256,
        'Initial claim predicate must match the independently reviewed source/build/business/device guard');
    }
    assert.equal(createHash('sha256').update(retained).digest('hex'),
      '438905930d0f0458ba9687553fb3a6956dc45ccfff1de16e092c2d258da28b14','Every pre-P0D permission must remain byte-identical');
    // Independently inline only the new pure let bindings and verify the
    // original 6300064 receipt predicate token-for-token. No get/permission
    // or field validation can disappear to solve the compiled size ceiling.
    const block=source.slice(source.indexOf('function p0dReceipt('),source.indexOf('allow read: if sparkOwnerRead(ownerUid);',source.indexOf('function p0dReceipt(')));
    const tokenize=s=>[...s.matchAll(/"(?:\\.|[^"\\])*"|[A-Za-z_][A-Za-z_0-9]*|\d+|[^\s]/g)].map(m=>m[0]);
    const bindings=Object.fromEntries([...block.matchAll(/let (\w+) = ([\s\S]*?);/g)].map(m=>[m[1],tokenize(m[2])]));
    const expand=tokens=>tokens.flatMap((t,i)=>bindings[t]&&tokens[i-1]!=='.'?expand(bindings[t]):[t]);
    const expression=block.match(/return ([\s\S]*?);/)[1];
    const tokens=expand(tokenize('sparkRecoveryCopyWriter(_o) && '+expression)).map(t=>t==='_o'?'ownerUid':t==='_r'?'reportId':t);
    assert.equal(createHash('sha256').update(JSON.stringify(tokens)).digest('hex'),
      'fe25c2fdd2eef5c380c0caa3875a40131a5124375fdbb59f7c1c1ea1771c98d0','P0D receipt factoring must preserve the original predicate');
  }
  assert.deepEqual(actual,expected.fingerprints,'Scope optimization changed an authorization predicate or effective permission path');
  assert.equal(compactBoundParameters(source).replacements,0,'Deployed Rules must retain their certified compact bindings');
  assert.deepEqual(fingerprints(restoreBoundParameters(source).content),expected.alphaEquivalentTo,
    'Compact bindings changed more than alpha-renaming: predicates, fields and paths must match the reviewed retained source');
  const parent=source.indexOf('match /businesses/{ownerUid}/businessUnits/{businessId}/storage/v2 {');
  assert(parent>0&&source.indexOf('function sparkLedgerProof(')>parent,'Operational helpers must stay localized');
  assert(source.indexOf('function sparkActiveMember(')<parent,'Membership path must retain its shared validator');
  console.log(JSON.stringify({status:'PASS',scopeOnly:!expected.authorizationChange,
    authorizationChange:expected.authorizationChange||null,baseline:expected.baseline,...actual}));
}
