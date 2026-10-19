// Alpha-renaming only: fields, literals, function names and match captures are
// untouched. Short parameter symbols reduce the backend executable footprint.
const names={ownerUid:'_o',businessId:'_b',recordId:'_r',operationId:'_p',moduleName:'_m',
  creating:'_c',counters:'_n',result:'_z',movement:'_v',order:'_q'};
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
