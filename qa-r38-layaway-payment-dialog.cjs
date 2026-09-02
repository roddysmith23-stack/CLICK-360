const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync(process.env.CLICK360_APP_SOURCE||'app.js','utf8');
const start=source.indexOf('function requestLayawayPayment(sale)');
const end=source.indexOf('window.payLayaway =',start);
let nodes={},closed=0,operations=0;
const context={Promise,fmt:String,parseMoney:Number,uid:()=>`synthetic-${++operations}`,
  showModal:()=>{nodes={};for(const key of ['#cancelLayawayPayment','[data-close]','#confirmLayawayPayment','#layawayPaymentAmount','#layawayPaymentMethod'])nodes[key]={value:key.includes('Method')?'Transferencia':'3',focus(){}};},
  closeModal:()=>{closed++;nodes={};},$:selector=>nodes[selector]||null};
vm.createContext(context);vm.runInContext(source.slice(start,end),context);
(async()=>{
  const promise=context.requestLayawayPayment({balance:7});
  const oldButton=nodes['#confirmLayawayPayment'];
  for(let i=0;i<5;i++)oldButton.onclick();
  const result=await promise;
  assert.equal(result.amount,3);assert.equal(result.method,'Transferencia');
  assert.equal(closed,1);assert.equal(operations,1);
  const cancel=context.requestLayawayPayment({balance:4});
  const staleConfirm=nodes['#confirmLayawayPayment'];nodes['#cancelLayawayPayment'].onclick();staleConfirm.onclick();
  assert.equal(await cancel,null);assert.equal(operations,1);
  console.log('PASS layaway dialog: five queued clicks and stale confirm after cancel settle once with no detached-DOM errors');
})().catch(error=>{console.error(error);process.exitCode=1;});
