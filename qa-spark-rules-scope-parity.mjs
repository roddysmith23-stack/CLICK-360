// Scope relocation must not change predicates or effective permission paths.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
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
  const source=readFileSync('firestore.spark.rules','utf8'),actual=fingerprints(source);
  const expected=JSON.parse(readFileSync('qa/fixtures/spark-rules-scope-parity.json','utf8'));
  assert.deepEqual(actual,expected.fingerprints,'Scope optimization changed an authorization predicate or effective permission path');
  const parent=source.indexOf('match /businesses/{ownerUid}/businessUnits/{businessId}/storage/v2 {');
  assert(parent>0&&source.indexOf('function sparkLedgerProof(')>parent,'Operational helpers must stay localized');
  assert(source.indexOf('function sparkActiveMember(')<parent,'Membership path must retain its shared validator');
  console.log(JSON.stringify({status:'PASS',scopeOnly:true,baseline:expected.baseline,...actual}));
}
