'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const root=__dirname,baseline='7155238';
const read=(ref,file)=>ref==='working-tree'?fs.readFileSync(path.join(root,file),'utf8'):execFileSync('git',['show',`${ref}:${file}`],{cwd:root,encoding:'utf8'});
const sha=text=>createHash('sha256').update(text).digest('hex');
function extract(source,name) {
  const start=source.indexOf(`function ${name}(`); assert.ok(start>=0,name);
  let p=source.indexOf('(',start),n=0; for(;p<source.length;p++) {if(source[p]==='(')n++;if(source[p]===')'&&!--n)break;}
  let end=source.indexOf('{',p); n=0; for(;end<source.length;end++){if(source[end]==='{')n++;if(source[end]==='}'&&!--n)break;}
  return source.slice(start,end+1);
}
const refs=[['emergency','c030256d'],['emergency-hotfix','dccee527'],['r31','d9b33f7573d01d41ac4be2e4207eedec6e3092b2'],['r33','7868c2f8b795bdc3903a1cbf3498e03a5ad09cfc'],['r37.2.1','1199c18'],['r37.2.3','daba9ed007cc02c81090068222c6b6845f2dd081'],['PR79','276fcd093f97c25709a31fcce5ca3ce8f315c3ee'],['modern-before',baseline],['modern-after','working-tree']];
const cases=[{name:'auto',mediaWidthMm:0,mediaHeightMm:0,rows:1},{name:'stale800',mediaWidthMm:800,mediaHeightMm:0,rows:1},{name:'undersized-width40',mediaWidthMm:40,mediaHeightMm:0,rows:1},{name:'plausible-width100',mediaWidthMm:100,mediaHeightMm:0,rows:1},{name:'undersized-two-rows',mediaWidthMm:0,mediaHeightMm:60,rows:2},{name:'plausible-height90',mediaWidthMm:0,mediaHeightMm:90,rows:1}];
const history=refs.map(([label,ref])=>{
  const context={console}; context.window=context; vm.createContext(context);
  for(const file of ['smart-print-core.js','universal-label-canvas.js'])vm.runInContext(read(ref,file),context);
  vm.runInContext(extract(read(ref,'app.js'),'universalMediaSize'),context);
  return {label,ref:ref==='working-tree'?ref:execFileSync('git',['rev-parse',ref],{cwd:root,encoding:'utf8'}).trim(),cases:cases.map(c=>({name:c.name,media:context.universalMediaSize(context.CLICK360_UNIVERSAL_LABEL_CANVAS.normalizeDocument({paper:{id:'synthetic',mediaType:'roll-2',widthMm:40,heightMm:60,columns:2,gapXmm:4,gapYmm:4,marginLeftMm:6,marginRightMm:2,marginTopMm:13,marginBottomMm:2,...c}}))}))};
});
const immutableFiles=['universal-label-canvas.js','universal-label-editor.js','printing-service.js','vendor/qrcode-generator.js','vendor/jsbarcode.min.js'].map(file=>({file,beforeSha256:sha(read(baseline,file)),afterSha256:sha(read('working-tree',file))}));
const artFunctions=['drawLabelOnCanvas','drawCanvasElement','drawFittedText','normalizedLabelLayout','defaultLabelLayout','labelFmt','universalDocumentFromTemplate','buildUniversalLabelPrintNode'].map(name=>({name,beforeSha256:sha(extract(read(baseline,'app.js'),name)),afterSha256:sha(extract(read('working-tree','app.js'),name))}));
for(const item of [...immutableFiles,...artFunctions])assert.equal(item.beforeSha256,item.afterSha256,item.file||item.name);
const output=path.join(root,'artifacts/full-mvp-20260831/print'); fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(output,'source-history-and-artwork-hashes.json'),JSON.stringify({checkedAt:new Date().toISOString(),syntheticOnly:true,physicalGolden:{requested:'SHARY_PHYSICAL_GOLDEN_2026-08-07',available:false,note:'No physical output or printer/driver measurement supplied; commit comparisons are software evidence only.'},history,immutableFiles,artFunctions,pass:true},null,2)+'\n');
console.log('COMMERCIAL_MVP_PRINT_SOURCE_HISTORY PASS:9 revisions,6 geometry cases,5 complete files and8 artwork functions byte-identical to modern baseline');
