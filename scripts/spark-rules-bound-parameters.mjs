// Alpha-renaming only: fields, literals and match captures are untouched.
// Reversible symbols reduce the backend executable footprint, not security.
const names={ownerUid:'_o',businessId:'_b',recordId:'_r',operationId:'_p',moduleName:'_m',
  creating:'_c',counters:'_n',result:'_z',movement:'_v',order:'_q'};
// P0D backend deploy found the compiled 256000-byte ceiling (not the source
// limit). Rename ONLY declarations/calls, reversibly. No expression changes.
const functionNames=Object.fromEntries(['businessUnitPermission','sparkMoneyEqual','sparkBoundOperation',
  'isPlatformAdmin','signedIn','validBoundaryCreate','sparkControlPath','sparkOperationalCreate',
  'logisticsAssignedTo','sparkLegacyReadable','sparkOperationalUpdate','validBusinessUnitIdentity',
  'validBoundaryUpdate','sparkLegacyWritable','activeBusinessUnitMember','sparkLedger',
  'supportedMemberRole','sparkAfter','businessUnitOwner','businessUnitMemberData',
  'workersFeatureFlagEnabled','sparkSettingsMutation'].map((name,i)=>[name,`_F${i}`])
  .filter(([name])=>name!=='workersFeatureFlagEnabled')); // retained deployment compatibility marker
export const compactFunctionSymbols=source=>renameFunctions(source,functionNames);
export const restoreFunctionSymbols=source=>renameFunctions(source,
  Object.fromEntries(Object.entries(functionNames).map(([long,short])=>[short,long])));
function renameFunctions(source,names){
  const tokens=[...source.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9]*|\d+(?:\.\d+)?|[^\s]/g)]
    .map(m=>({value:m[0],offset:m.index})).filter(t=>!t.value.startsWith('//')&&!t.value.startsWith('/*'));
  const replacements=[];
  for(let i=0;i<tokens.length;i++){
    const t=tokens[i],name=names[t.value];
    if(!name||tokens[i+1]?.value!=='('||tokens[i-1]?.value==='.')continue;
    if(tokens.some(x=>x.value===name))throw Error(`FUNCTION_SYMBOL_CAPTURE:${name}`);
    replacements.push({offset:t.offset,length:t.value.length,value:name});
  }
  let content=source;
  for(const r of replacements.sort((a,b)=>b.offset-a.offset))content=content.slice(0,r.offset)+r.value+content.slice(r.offset+r.length);
  return {content,replacements:replacements.length,bytesSaved:Buffer.byteLength(source)-Buffer.byteLength(content)};
}
export const compactBoundParameters=source=>renameBoundParameters(source,names);
export const restoreBoundParameters=source=>renameBoundParameters(source,
  Object.fromEntries(Object.entries(names).map(([long,short])=>[short,long])));
function renameBoundParameters(source,names){
  const tokens=[...source.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9]*|\d+(?:\.\d+)?|[^\s]/g)]
    .map(match=>({value:match[0],offset:match.index}));
  const significant=tokens.filter(t=>!t.value.startsWith('//')&&!t.value.startsWith('/*'));
  const replacements=[],bindings=[];
  for(let i=0;i<significant.length;i++){
    if(significant[i].value!=='function')continue;
    const name=significant[i+1].value;
    let open=i;while(significant[open].value!=='{')open++;
    let end=open+1,depth=1;
    for(;depth;end++){if(significant[end].value==='{')depth++;if(significant[end].value==='}')depth--;}
    const parameters=significant.slice(i+3,open-1).filter(t=>t.value!==',').map(t=>t.value);
    const body=significant.slice(open,end);
    for(const parameter of parameters){
      const short=names[parameter];if(!short)continue;
      if(body.some((t,n)=>t.value===short&&body[n-1]?.value!=='.'&&body[n+1]?.value!==':'))
        throw Error(`PARAMETER_CAPTURE:${name}:${short}`);
      bindings.push({function:name,parameter,short});
      for(let n=i+3;n<end;n++){
        const token=significant[n];
        if(token.value===parameter&&significant[n-1]?.value!=='.'&&significant[n+1]?.value!==':')
          replacements.push({offset:token.offset,length:parameter.length,value:short});
      }
    }
    i=end-1;
  }
  let content=source;
  for(const replacement of replacements.sort((a,b)=>b.offset-a.offset))
    content=content.slice(0,replacement.offset)+replacement.value+content.slice(replacement.offset+replacement.length);
  return {content,bindings,replacements:replacements.length,bytesSaved:Buffer.byteLength(source)-Buffer.byteLength(content)};
}
