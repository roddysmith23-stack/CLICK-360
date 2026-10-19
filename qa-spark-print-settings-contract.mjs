import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import './modular-ui-adapter.js';

// Execute the existing PWA handlers, not a replacement print interface. This
// contract does not certify the advanced field whitelist in deployed Rules.
const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
const identity={ownerUid:'synthetic-owner',businessId:'synthetic-business'};
const original={id:'template',businessId:identity.businessId,name:'Original',recordVersion:4,isDefault:true,
  bgColor:'#123456',qrBgColor:'#ffffff',fgColor:'#101010',social:'Synthetic',customText:'Preserve',
  address:'Synthetic address',taxDisplay:'included',qrMargin:2,unrecognizedHistoricalPreference:{retained:true}};
const nodes=new Map(),commands=[],toasts=[];
let sequence=0;
const context=vm.createContext({structuredClone,JSON,Date,console,
  window:{click360SparkOperationalSession:{identity},click360Auth:{currentUser:{uid:identity.ownerUid}},
    CLICK360_MODULAR_UI_ADAPTER:globalThis.CLICK360_MODULAR_UI_ADAPTER},
  state:{settings:{labelTemplates:[structuredClone(original)],labelProfiles:[]}},
  cloneState:structuredClone,uid:prefix=>`${prefix}-${++sequence}`,
  prompt:()=> 'Renamed',confirm:()=>true,toast:message=>toasts.push(message),renderApp:()=>{},addAudit:()=>{},
  currentBusiness:()=>({id:identity.businessId}),
  $$:selector=>{if(!nodes.has(selector))nodes.set(selector,[{dataset:{renameTpl:'template',duplicateTpl:'template',defaultTpl:'template',delTpl:'template'}}]);return nodes.get(selector);},
  save:()=>{throw Error('LEGACY_SAVE_MUST_NOT_RUN');},
  commitCriticalMutation:async(previous,reason,verify,options)=>{
    const command=options.sparkCommand();commands.push({previous,reason,command});return {ok:true};
  }
});
vm.runInContext(`
  function labelTemplatesForBiz(){return state.settings.labelTemplates.filter(t=>!t.deleted&&t.businessId===currentBusiness().id);}
  ${source.slice(source.indexOf('  async function commitScopedPrintSetting('),source.indexOf('  function scopedBusinessSettingsCommand('))}
  ${source.slice(source.indexOf("    $$('[data-rename-tpl]')"),source.indexOf('    bindInventoryActions();',source.indexOf("    $$('[data-rename-tpl]')")))}
`,context);
await nodes.get('[data-rename-tpl]')[0].onclick();
assert.equal(commands.length,1);assert.equal(commands[0].command.kind,'scoped_settings');
assert.equal(commands[0].command.input.expectedRecordVersion,4);
assert.equal(commands[0].command.input.changes.bgColor,original.bgColor);
assert.deepEqual(commands[0].command.input.changes.unrecognizedHistoricalPreference,original.unrecognizedHistoricalPreference);
assert.equal(commands[0].previous.settings.labelTemplates[0].name,'Original');
await nodes.get('[data-duplicate-tpl]')[0].onclick();
assert.equal(commands[1].command.input.expectedRecordVersion,0);
assert.notEqual(commands[1].command.input.recordId,original.id);
assert.equal(commands[1].command.input.changes.customText,original.customText);
const beforeDefault=structuredClone(context.state),beforeCount=commands.length;
await nodes.get('[data-default-tpl]')[0].onclick();
assert.deepEqual(context.state,beforeDefault);assert.equal(commands.length,beforeCount);
await nodes.get('[data-del-tpl]')[0].onclick();
assert.equal(commands.at(-1).command.input.expectedRecordVersion,4);
assert.equal(commands.at(-1).command.input.changes.deleted,true);
assert.equal(context.state.settings.labelTemplates.length,2,'Tombstone does not erase template history');
assert.equal(context.state.settings.labelTemplates[1].isDefault,false,'Deletion does not silently mutate another template');

// The advanced editor's own persistence function must retain non-rendered
// historical fields. A profile+template operation remains explicitly gated.
context.state={settings:{labelTemplates:[structuredClone(original)],labelProfiles:[]}};
Object.assign(context,{activeTemplateId:'template',editorBusinessId:identity.businessId,
  editorBusinessIsActive:()=>true,product:{qty:37},getOptions:()=>new Proxy({bgColor:'#abcdef',layout:{},widthMm:40,heightMm:30},{get:(target,key)=>target[key]??0}),
  $:()=>({value:'1',checked:false}),resolveLabelCopyResult:()=>({count:1}),
  universalDocumentFromTemplate:input=>({quantity:input.quantity,paper:{widthMm:40,heightMm:30}}),
  refreshTemplateSelect:()=>{},refreshInventoryTemplateSection:()=>{}
});
const advancedStart=source.indexOf('    const persistTemplate = async ');
const advancedEnd=source.indexOf("    $('#saveTemplateBtn').onclick",advancedStart);
assert(advancedStart>0&&advancedEnd>advancedStart,'Actual advanced editor boundary must exist');
vm.runInContext(`${source.slice(advancedStart,advancedEnd)};globalThis.runPersistTemplate=persistTemplate;`,context);
const advancedBefore=structuredClone(context.state);
assert.equal(await context.runPersistTemplate({deferSave:true}),null);
assert.deepEqual(context.state,advancedBefore,'Unsupported combined operation stops before mutation');
await context.runPersistTemplate({nameOverride:'Advanced preserved'});
assert.equal(commands.at(-1).command.input.expectedRecordVersion,4);
assert.equal(commands.at(-1).command.input.changes.bgColor,'#abcdef');
assert.deepEqual(commands.at(-1).command.input.changes.unrecognizedHistoricalPreference,original.unrecognizedHistoricalPreference);
assert.equal(commands.at(-1).command.input.changes.universalDocument.quantity,1,'Print copies do not inherit stock quantity');

const profileStart=source.indexOf('    const persistPrintProfile = async ');
const profileEnd=source.indexOf("    $('#savePrintProfileBtn').onclick",profileStart);
vm.runInContext(`${source.slice(profileStart,profileEnd)};globalThis.runPersistPrintProfile=persistPrintProfile;`,context);
const profileBefore=structuredClone(context.state);
await context.runPersistPrintProfile();
assert.deepEqual(structuredClone(context.state),profileBefore,'Compound profile operation is refused before preparing or mutating either record');
console.log('PASS actual print settings handlers: scoped async rename/duplicate/tombstone, retained historical preferences, exact revision and business, no legacy fallback, unsupported compound/default stopped before mutation. Advanced Rules coverage is a separate gate.');
