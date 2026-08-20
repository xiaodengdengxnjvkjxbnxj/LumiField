'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const repo = path.resolve(__dirname, '..');
const dependencyRoot = process.env.LF_DEPENDENCY_ROOT || path.resolve(repo, '..', '..', 'release', 'verify-v1.1.43-tag', 'node_modules');
const electronExe = path.join(dependencyRoot, 'electron', 'dist', 'electron.exe');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.join(repo, 'test-results', 'lf-v1144-12-home-pet-tracking-greeting', runId);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-v1144-12-'));
const checks = {};
const rendererErrors = [];
const consoleErrors = [];
const screenshots = [];
const appLog = [];
let app = null;
let cdp = null;

fs.mkdirSync(evidenceDir, { recursive:true });
fs.mkdirSync(path.join(userData, 'migrations'), { recursive:true });
fs.writeFileSync(path.join(userData, 'migrations', 'legacy-upstream-platform-session-v2.json'), JSON.stringify({version:2,validated:true,testIsolation:true,results:[]}), {mode:0o600});

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase(); }
function pass(name, condition, detail) { assert.ok(condition, `${name}: ${JSON.stringify(detail)}`); checks[name] = detail == null ? true : detail; }
async function waitFor(fn, timeout = 30000, interval = 50) {
  const started = Date.now(); let last = null;
  while (Date.now() - started < timeout) {
    try { last = await fn(); if (last) return last; } catch (error) { last = String(error && error.message || error); }
    await delay(interval);
  }
  throw new Error(`Timeout: ${JSON.stringify(last)}`);
}
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.unref(); server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(error => error ? reject(error) : resolve(port)); });
  });
}

class CDP {
  constructor(url) { this.url=url; this.id=0; this.pending=new Map(); }
  async connect() {
    this.ws=new WebSocket(this.url);
    this.ws.onmessage=event=>{
      const message=JSON.parse(String(event.data));
      if(message.id&&this.pending.has(message.id)){
        const pending=this.pending.get(message.id);this.pending.delete(message.id);clearTimeout(pending.timer);
        if(message.error)pending.reject(new Error(message.error.message));else pending.resolve(message.result||{});return;
      }
      if(message.method==='Runtime.exceptionThrown'){
        const detail=message.params&&message.params.exceptionDetails||{};
        rendererErrors.push(String(detail.exception&&detail.exception.description||detail.text||'renderer exception'));
      }
      if(message.method==='Runtime.consoleAPICalled'&&message.params&&message.params.type==='error'){
        consoleErrors.push((message.params.args||[]).map(item=>item.value||item.description||'').join(' '));
      }
    };
    await new Promise((resolve,reject)=>{this.ws.onopen=resolve;this.ws.onerror=reject;});
    await this.send('Runtime.enable');await this.send('Page.enable');
  }
  send(method,params,timeout=30000){const id=++this.id;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},timeout);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params:params||{}}));});}
  async evaluate(expression){const response=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(response.exceptionDetails)throw new Error(response.exceptionDetails.exception&&response.exceptionDetails.exception.description||response.exceptionDetails.text);return response.result&&response.result.value;}
  async mouseMove(x,y){await this.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:Math.round(x),y:Math.round(y),button:'none',buttons:0,pointerType:'mouse'});}
  async screenshot(name){const response=await this.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});const file=path.join(evidenceDir,name);fs.writeFileSync(file,Buffer.from(response.data,'base64'));screenshots.push({file:path.basename(file),bytes:fs.statSync(file).size,sha256:sha256File(file)});}
  close(){try{this.ws.close();}catch(_){}}
}

function staticChecks() {
  const source=fs.readFileSync(path.join(repo,'public','lf-home-pet-source.jsx'),'utf8');
  const bundle=fs.readFileSync(path.join(repo,'public','lf-home-pet-source.bundle.js'),'utf8');
  const feature=fs.readFileSync(path.join(repo,'public','lf-home-pet.js'),'utf8');
  const css=fs.readFileSync(path.join(repo,'public','lf-home-pet.css'),'utf8');
  pass('eye tracking consumes the global viewport pointer once per animation frame',/window\.addEventListener\('mousemove'/.test(source)&&/requestAnimationFrame/.test(source)&&/window\.innerWidth \* 0\.32/.test(source)&&/window\.innerHeight \* 0\.32/.test(source),true);
  pass('eye travel uses bounded nonlinear mapping across the viewport',/Math\.tanh\(deltaX \/ radiusX\)/.test(source)&&/Math\.tanh\(deltaY \/ radiusY\)/.test(source)&&/const maxOffset = 8/.test(source)&&/mapping: 'viewport-tanh'/.test(source),true);
  pass('local time selects exactly the three required greetings',source.includes("return '早上好'")&&source.includes("return '中午好'")&&source.includes("return '晚上好'"),true);
  pass('hover greeting has no timeout and window exit explicitly hides it',!/setTimeout|setInterval/.test(source)&&/addEventListener\('mouseout'/.test(source)&&/runtime\.greeting = ''/.test(source),true);
  pass('greeting occupies only the pet right upper safe space',/left:calc\(100% \+ 8px\)/.test(css)&&/top:0/.test(css)&&/max-width:var\(--lf-home-pet-greeting-width/.test(css)&&/max-height:var\(--lf-home-pet-visual-height/.test(css)&&/\(search\.left - left - 20\) \/ 2/.test(feature),true);
  pass('pet and greeting remain non-intercepting overlays',/#lf-home-pet\s*\{[\s\S]*?pointer-events:\s*none/.test(css)&&/\.lf-home-pet-greeting\s*\{[\s\S]*?pointer-events:none/.test(css),true);
  pass('generated source bundle contains the new production behavior',bundle.includes('lf-home-pet-greeting')&&bundle.includes('Math.tanh')&&bundle.includes('viewport-tanh')&&bundle.includes('mouseout'),sha256File(path.join(repo,'public','lf-home-pet-source.bundle.js')));
}

async function listTargets(port){return (await fetch(`http://127.0.0.1:${port}/json/list`)).json();}
async function startApp(){
  assert.ok(fs.existsSync(electronExe),`Electron not found: ${electronExe}`);
  const port=await freePort();
  app=spawn(electronExe,['.',`--user-data-dir=${userData}`,`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1'],{cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe'],env:Object.assign({},process.env,{NODE_PATH:dependencyRoot,LF_MASTER_TEST:'1',LUMIFIELD_SKIP_SPLASH:'1',ELECTRON_DISABLE_SECURITY_WARNINGS:'true'})});
  const collect=data=>appLog.push(String(data));app.stdout.on('data',collect);app.stderr.on('data',collect);
  const target=await waitFor(async()=>{const targets=await listTargets(port);return targets.find(item=>item.type==='page'&&/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?(?:index\.html)?$/i.test(item.url));},60000);
  cdp=new CDP(target.webSocketDebuggerUrl);await cdp.connect();
  await waitFor(()=>cdp.evaluate(`document.readyState==='complete'&&!!window.LumiFieldHomePet&&!!window.LumiFieldHomePetSource`),60000);
}

async function prepareHome(){
  await cdp.evaluate(`(()=>{
    const hide=node=>{if(!node)return;node.classList.remove('show','active');node.style.setProperty('display','none','important');node.style.setProperty('visibility','hidden','important');node.setAttribute('aria-hidden','true');};
    document.querySelectorAll('.modal-mask,#lf-auth-root,#visual-guide').forEach(hide);
    if(typeof closeVisualGuide==='function')closeVisualGuide(true);
    document.body.classList.remove('splash-active','splash-revealing','lf-auth-locked','visual-guide-active','immersive-mode','render-deep-sleep','render-background-eco');
    window.homeSuppressed=false;window.homeForcedOpen=true;window.emptyHomeActive=true;
    if(typeof window.LumiFieldPrepareFirstReveal==='function')window.LumiFieldPrepareFirstReveal();
    else document.body.classList.add('empty-home-active');
    window.LumiFieldHomePet.sync('problem12-test');
    return true;
  })()`);
  return waitFor(()=>cdp.evaluate(`(()=>{const d=LumiFieldHomePet.getDebug();return d.mounted&&d.eligible&&!document.getElementById('lf-home-pet').hidden&&d.visualBounds&&d.greetingCount===1?{debug:d,width:innerWidth,height:innerHeight}:null})()`),30000);
}

async function runtimeChecks(){
  const initial=await prepareHome();
  pass('Home mounts one source pet and one greeting without intercepting input',initial.debug.rootCount===1&&initial.debug.svgCount===1&&initial.debug.greetingCount===1&&initial.debug.pointerEvents==='none'&&initial.debug.mouseMoveListenerCount===2,initial.debug);
  pass('pet layout begins inside its safe region without Home or search overlap',!initial.debug.overlapsHome&&!initial.debug.overlapsSearch&&initial.debug.blockerOverlaps.length===0&&initial.debug.contentFitsRoot,initial.debug);

  const bounds=initial.debug.visualBounds;
  const center={x:bounds.left+bounds.width/2,y:bounds.top+bounds.height/2};
  await cdp.mouseMove(center.x,center.y);
  const centered=await waitFor(()=>cdp.evaluate(`(()=>{const d=LumiFieldHomePet.getDebug();return d.hovered?d:null})()`));
  pass('pointer at the pet center produces a centered eye target',Math.abs(centered.eyeX)<0.2&&Math.abs(centered.eyeY)<0.8,centered);

  const midX=center.x+(initial.width-center.x)*0.55;
  await cdp.mouseMove(midX,center.y);
  const middle=await waitFor(()=>cdp.evaluate(`(()=>{const d=LumiFieldHomePet.getDebug();return d.eyeX>1?d:null})()`));
  await cdp.mouseMove(initial.width-12,initial.height-18);
  const far=await waitFor(()=>cdp.evaluate(`(()=>{const d=LumiFieldHomePet.getDebug();return d.eyeX>6&&d.eyeY>4?d:null})()`));
  pass('a far pointer outside the pet still produces stronger directional tracking',middle.eyeX>0&&far.eyeX>middle.eyeX&&far.eyeY>0&&far.eyeX<=8&&far.eyeY<=8&&far.trackingMapping==='viewport-tanh',{middle:{x:middle.eyeX,y:middle.eyeY},far:{x:far.eyeX,y:far.eyeY},radii:[far.trackingRadiusX,far.trackingRadiusY]});

  const liveBounds=await cdp.evaluate(`LumiFieldHomePet.getDebug().visualBounds`);
  await cdp.mouseMove(liveBounds.left+liveBounds.width/2,liveBounds.top+liveBounds.height/2);
  const greeting=await waitFor(()=>cdp.evaluate(`(()=>{const d=LumiFieldHomePet.getDebug();if(!d.greetingVisible||!d.greetingBounds)return null;const h=new Date().getHours();const expected=h<11?'早上好':h<18?'中午好':'晚上好';const node=document.querySelector('.lf-home-pet-greeting');return{debug:d,expected,text:node&&node.textContent.trim(),style:node&&getComputedStyle(node).pointerEvents};})()`));
  const gb=greeting.debug.greetingBounds;const vb=greeting.debug.visualBounds;
  pass('hover shows the correct local-time greeting',greeting.text===greeting.expected&&greeting.debug.greeting===greeting.expected,greeting);
  pass('greeting stays no larger than the pet and only in its right upper safe space',gb.width<=vb.width+0.75&&gb.height<=vb.height+0.75&&gb.left>=vb.right+6&&gb.top>=vb.top-0.75&&gb.top<=vb.top+2&&greeting.debug.greetingBlockerOverlaps.length===0&&greeting.style==='none',{greeting:gb,pet:vb,overlaps:greeting.debug.greetingBlockerOverlaps});
  await delay(900);
  const held=await cdp.evaluate(`(()=>{const d=LumiFieldHomePet.getDebug();return{visible:d.greetingVisible,greeting:d.greeting,hovered:d.hovered};})()`);
  pass('continued hover keeps the greeting visible without auto close',held.visible&&held.hovered&&held.greeting===greeting.expected,held);
  await cdp.screenshot('home-pet-hover-greeting.png');

  await cdp.mouseMove(initial.width-8,initial.height-8);
  const left=await waitFor(()=>cdp.evaluate(`(()=>{const d=LumiFieldHomePet.getDebug();return!d.greetingVisible&&!d.hovered?d:null})()`));
  pass('moving away immediately hides the greeting',!left.greetingVisible&&!left.hovered&&left.greeting==='',left);

  const lifecycle=await cdp.evaluate(`(()=>{for(let i=0;i<8;i++)LumiFieldHomePet.sync('repeat-'+i);const before=LumiFieldHomePet.getDebug();document.body.classList.remove('empty-home-active');LumiFieldHomePet.sync('stage');const absent={rootCount:document.querySelectorAll('#lf-home-pet').length,debug:LumiFieldHomePet.getDebug()};document.body.classList.add('empty-home-active');LumiFieldHomePet.sync('home-return');return{before,absent};})()`);
  pass('repeated sync never duplicates roots greetings or pointer listeners',lifecycle.before.rootCount===1&&lifecycle.before.greetingCount===1&&lifecycle.before.mouseMoveListenerCount===2,lifecycle.before);
  pass('leaving Home fully unmounts the pet and its global listeners',lifecycle.absent.rootCount===0&&!lifecycle.absent.debug.mounted&&lifecycle.absent.debug.mouseMoveListenerCount===0,lifecycle.absent);
  const remounted=await waitFor(()=>cdp.evaluate(`(()=>{const d=LumiFieldHomePet.getDebug();return d.mounted&&d.mouseMoveListenerCount===2&&d.canvasCount===1?d:null})()`));
  pass('returning Home restores exactly one clean pet instance',remounted.rootCount===1&&remounted.greetingCount===1&&remounted.mouseMoveListenerCount===2,remounted);
  pass('renderer and console errors remain zero',rendererErrors.length===0&&consoleErrors.length===0,{rendererErrors,consoleErrors});
}

async function stopApp(){
  if(cdp){cdp.close();cdp=null;}
  if(app&&!app.killed){app.kill();await Promise.race([new Promise(resolve=>app.once('exit',resolve)),delay(4000)]);}
  app=null;
}

(async()=>{
  let error=null;
  try{
    staticChecks();
    if(process.env.LF_V1144_12_STATIC_ONLY!=='1'){
      await startApp();
      await runtimeChecks();
    }
  }catch(caught){error=caught;process.exitCode=1;}
  finally{
    await stopApp();
    const result={task:'v1.1.44-problem-12',status:error?'FAIL':'PASS',checks,checkCount:Object.keys(checks).length,rendererErrors,consoleErrors,screenshots,appLog,error:error?String(error.stack||error):null};
    fs.writeFileSync(path.join(evidenceDir,'result.json'),JSON.stringify(result,null,2));
    process.stdout.write(`${JSON.stringify({status:result.status,checkCount:result.checkCount,evidenceDir},null,2)}\n`);
  }
})();
