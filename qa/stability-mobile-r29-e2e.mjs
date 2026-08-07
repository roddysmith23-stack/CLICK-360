import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium, firefox, webkit } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_STABILITY_MOBILE_PORT || 4187);
const url = `http://127.0.0.1:${port}/qa/fixtures/stability-mobile-r29.html`;
const widths = [320, 360, 375, 390, 430, 768];
const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd:root, stdio:'ignore' });

async function waitForServer(){
  for(let i=0;i<60;i+=1){
    try{ const response=await fetch(url); if(response.ok)return; }catch{}
    await new Promise(r=>setTimeout(r,250));
  }
  throw new Error('stability mobile fixture did not start');
}

async function run(name,browserType){
  const browser=await browserType.launch();
  try{
    const page=await browser.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{ if(m.type()==='error')errors.push(m.text()); });
    await page.goto(url,{waitUntil:'networkidle'});
    for(const width of widths){
      await page.setViewportSize({width,height:844});
      const result=await page.evaluate(()=>window.__CLICK360_STABILITY_MOBILE_QA__?.evaluate());
      if(!result?.pass)throw new Error(`${name} overflow at ${width}: ${JSON.stringify(result)}`);
      const dateWidths=await page.locator('input[type=date]').evaluateAll(nodes=>nodes.map(n=>({client:n.clientWidth,scroll:n.scrollWidth,right:n.getBoundingClientRect().right,viewport:document.documentElement.clientWidth})));
      if(dateWidths.some(x=>x.right>x.viewport+1||x.client>x.viewport))throw new Error(`${name} date input overflow at ${width}: ${JSON.stringify(dateWidths)}`);
      const calculator=await page.locator('.calculatorSheet').evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,width:el.getBoundingClientRect().width,viewport:document.documentElement.clientWidth}));
      if(calculator.left<0||calculator.right>calculator.viewport+1)throw new Error(`${name} calculator overflow at ${width}: ${JSON.stringify(calculator)}`);
    }
    if(errors.length)throw new Error(`${name} console errors: ${JSON.stringify(errors)}`);
  }finally{ await browser.close(); }
}

try{
  await waitForServer();
  await run('chromium',chromium);
  await run('webkit',webkit);
  await run('firefox',firefox);
  console.log('CLICK360_STABILITY_MOBILE_R29: PASS Chromium/WebKit/Firefox');
}finally{ server.kill('SIGTERM'); }
