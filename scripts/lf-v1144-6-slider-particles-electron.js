'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const repo = path.resolve(__dirname, '..');
const dependencyRoot = process.env.LF_DEPENDENCY_ROOT || path.join(repo, 'node_modules');
const electronExe = path.join(dependencyRoot, 'electron', 'dist', 'electron.exe');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.join(repo, 'test-results', 'lf-v1144-6-slider-particles', runId);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-v1144-6-'));
const checks = {};
const rendererErrors = [];
const consoleErrors = [];
const screenshots = [];
const appLog = [];
let app = null;
let cdp = null;

fs.mkdirSync(evidenceDir, { recursive:true });
fs.mkdirSync(path.join(userData, 'migrations'), { recursive:true });
fs.writeFileSync(path.join(userData, 'migrations', 'legacy-upstream-platform-session-v2.json'), JSON.stringify({version:2,validated:true,testIsolation:true,results:[]}, null, 2), {encoding:'utf8',mode:0o600});

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex').toUpperCase(); }
function fileSha256(file) { return sha256(fs.readFileSync(file)); }
function pass(name, condition, detail) { assert.ok(condition, `${name}: ${JSON.stringify(detail)}`); checks[name] = detail == null ? true : detail; }
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.unref(); server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(error => error ? reject(error) : resolve(port)); });
  });
}
async function waitFor(fn, timeout = 30000, interval = 60) {
  const start = Date.now(); let last = null;
  while (Date.now() - start < timeout) {
    try { last = await fn(); if (last) return last; } catch (error) { last = String(error && error.message || error); }
    await delay(interval);
  }
  throw new Error(`Timeout: ${JSON.stringify(last)}`);
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
  async screenshot(name){const response=await this.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});const file=path.join(evidenceDir,name);fs.writeFileSync(file,Buffer.from(response.data,'base64'));screenshots.push({file:path.basename(file),sha256:fileSha256(file),bytes:fs.statSync(file).size});}
  close(){try{this.ws.close();}catch(_){}}
}

function body(source, name, nextName) {
  const start=source.indexOf(`function ${name}`);assert.ok(start>=0,`missing ${name}`);
  const end=nextName?source.indexOf(`function ${nextName}`,start+1):-1;
  return source.slice(start,end<0?source.length:end);
}

function staticChecks(){
  const source=fs.readFileSync(path.join(repo,'public','lf-particle-range-control.js'),'utf8');
  const pointerMove=body(source,'onPointerMove','releasePointer');
  const frame=body(source,'frame','sampleDeleteParticles');
  const flush=body(source,'flushPendingTrails','onVisibilityChange');
  pass('the exact slider reference video remains pinned',source.includes('47074935E9D21BE26F38579C324BB1A08932F65DBB9E61E802AFC9358EBB9E87'),true);
  pass('raw pointermove only queues the latest sample',/queueTrail\(/.test(pointerMove)&&!/emitTrail\(|getBoundingClientRect/.test(pointerMove),true);
  pass('one frame flush owns all layout reads and visual emission',/flushPendingTrails\(\)/.test(frame)&&/getBoundingClientRect\(\)/.test(flush)&&/emitTrail\(/.test(flush),true);
  pass('pending records are pooled and repeated samples are coalesced',/pendingRecordByControl = new WeakMap/.test(source)&&/pendingTrails = new Map/.test(source)&&/coalescedTrailEvents \+= 1/.test(source),true);
  pass('range particles are smaller and denser than the retired path',/steps = clamp\([^\n]+pointer \? 18 : 10/.test(source)&&/size:0\.38 \+ Math\.random\(\) \* 0\.72/.test(source),true);
  pass('all slider particles are crisp with no blur',/context\.shadowBlur = 0/.test(source)&&!/particle\.kind === 'delete' \? 0 : 3\.5/.test(source),true);
  pass('disabled, hidden, and offscreen sliders are rejected before emission',/control\.disabled/.test(source)&&/rect\.right <= 0 \|\| rect\.bottom <= 0/.test(source)&&/style\.display !== 'none'/.test(source),true);
  pass('the particle object pool and only one RAF scheduler remain',/MAX_PARTICLES = 2200/.test(source)&&/function acquireParticle/.test(source)&&/if \(state\.raf/.test(source)&&/state\.raf = global\.requestAnimationFrame\(frame\)/.test(source),true);
  pass('hidden documents cancel work and clear pending input',/pendingTrails\.clear\(\)/.test(body(source,'onVisibilityChange','clearCanvas')),true);
  pass('idle overlay releases its backing store and active DPR is pixel-budgeted',/function releaseCanvasBacking/.test(source)&&/MAX_CANVAS_PIXELS = 8300000/.test(source)&&/deviceDpr = clamp\([^\n]+1, 1\.5\)/.test(source),true);
}

async function listTargets(port){const response=await fetch(`http://127.0.0.1:${port}/json/list`);return response.json();}
async function startApp(){
  assert.ok(fs.existsSync(electronExe),`Electron not found: ${electronExe}`);
  const port=await freePort();
  app=spawn(electronExe,['.',`--user-data-dir=${userData}`,`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1'],{
    cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe'],env:Object.assign({},process.env,{NODE_PATH:dependencyRoot,LF_MASTER_TEST:'1',LUMIFIELD_SKIP_SPLASH:'1',ELECTRON_DISABLE_SECURITY_WARNINGS:'true'})
  });
  const collect=data=>appLog.push(String(data));app.stdout.on('data',collect);app.stderr.on('data',collect);
  const target=await waitFor(async()=>{const targets=await listTargets(port);return targets.find(item=>item.type==='page'&&/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?(?:index\.html)?$/i.test(item.url));},60000);
  cdp=new CDP(target.webSocketDebuggerUrl);await cdp.connect();
  await waitFor(()=>cdp.evaluate(`document.readyState==='complete'&&!!window.LumiFieldParticleRangeControl&&!!document.getElementById('volume-slider')`),60000);
  await delay(1400);
}

async function prepare(){
  return cdp.evaluate(`(()=>{
    const hide=id=>{const n=document.getElementById(id);if(n){n.classList.remove('show','active');n.style.setProperty('display','none','important');n.setAttribute('aria-hidden','true');}};
    ['lf-auth-root','visual-guide','login-modal','user-modal','playlist-delete-modal','local-beat-modal'].forEach(hide);
    document.body.classList.remove('lf-auth-locked','splash-active','splash-revealing','empty-home-active','lf-fx-open','immersive-mode');
    window.emptyHomeActive=false;window.homeForcedOpen=false;window.homeSuppressed=true;
    const old=document.getElementById('lf-v1144-slider-fixture');if(old)old.remove();
    const wrap=document.createElement('div');wrap.id='lf-v1144-slider-fixture';wrap.style.cssText='position:fixed;left:180px;top:150px;width:420px;height:100px;z-index:10000;background:rgba(0,0,0,.72);padding:24px';
    wrap.innerHTML='<input id="lf-v1144-visible-range" type="range" min="0" max="100" value="20" style="width:360px"><input id="lf-v1144-disabled-range" type="range" min="0" max="100" value="20" disabled style="width:360px"><input id="lf-v1144-offscreen-range" type="range" min="0" max="100" value="20" style="position:fixed;left:-800px;top:-800px;width:360px">';
    document.body.appendChild(wrap);window.LumiFieldParticleRangeControl.refresh();
    return window.LumiFieldParticleRangeControl.getDebug();
  })()`);
}

async function exercise(){
  const prepared=await prepare();
  const actualCount=await cdp.evaluate(`document.querySelectorAll('input[type="range"],[role="slider"],#progress-bar').length`);
  pass('every current native and custom slider is discovered and tagged',prepared.controlCount===actualCount&&prepared.taggedCount===actualCount&&prepared.canvasCount===1,{prepared,actualCount});
  pass('dynamically inserted sliders join the same shared controller',prepared.controlKeys.includes('lf-v1144-visible-range')&&prepared.controlKeys.includes('lf-v1144-disabled-range')&&prepared.controlKeys.includes('lf-v1144-offscreen-range'),prepared.controlKeys.slice(-5));
  pass('idle shared overlay keeps only a 1x1 backing store',prepared.viewport.backingReleased&&prepared.viewport.backingWidth===1&&prepared.viewport.backingHeight===1,prepared.viewport);

  const burst=await cdp.evaluate(`(async()=>{
    const el=document.getElementById('lf-v1144-visible-range'),r=el.getBoundingClientRect(),api=window.LumiFieldParticleRangeControl,before=api.getDebug();
    el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:77,clientX:r.left+8,clientY:r.top+r.height/2,buttons:1}));
    for(let i=0;i<300;i++)el.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:77,clientX:r.left+8+(r.width-16)*i/299,clientY:r.top+r.height/2,buttons:1}));
    const queued=api.getDebug();
    el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:77,clientX:r.right-8,clientY:r.top+r.height/2,buttons:0}));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const after=api.getDebug();
    return {before,queued,after};
  })()`);
  const pointerDelta=burst.queued.pointerEvents-burst.before.pointerEvents;
  const emissionDelta=burst.after.emissions-burst.before.emissions;
  const particleDelta=burst.after.emittedParticles-burst.before.emittedParticles;
  pass('300 high-rate pointer samples collapse into one pending control record',pointerDelta===300&&burst.queued.pendingTrailCount===1&&burst.after.coalescedTrailEvents-burst.before.coalescedTrailEvents>=299,{pointerDelta,queued:burst.queued,after:burst.after});
  pass('one RAF performs one visual emission instead of 300 emissions',emissionDelta===1&&particleDelta>=16&&particleDelta<=18&&burst.after.pendingTrailCount===0&&burst.after.visualFlushCount-burst.before.visualFlushCount===1&&burst.after.maxFrameEmissions===1,{emissionDelta,particleDelta,after:burst.after});
  pass('particle size and blur runtime contract matches the crisp dense implementation',burst.after.rangeParticleMaxSize===1.1&&burst.after.rangeParticleShadowBlur===0&&burst.after.poolSize<=burst.after.poolCapacity,burst.after);
  await cdp.screenshot('coalesced-slider-particles.png');

  const rejected=await cdp.evaluate(`(async()=>{
    const api=window.LumiFieldParticleRangeControl,before=api.getDebug();
    for(const id of ['lf-v1144-disabled-range','lf-v1144-offscreen-range']){
      const el=document.getElementById(id),r=el.getBoundingClientRect();
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:88,clientX:r.left+r.width/2,clientY:r.top+r.height/2,buttons:0}));
    }
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    return {before,after:api.getDebug()};
  })()`);
  pass('disabled and offscreen sliders emit no particles',rejected.after.emissions===rejected.before.emissions&&rejected.after.emittedParticles===rejected.before.emittedParticles,rejected);

  const native=await cdp.evaluate(`(async()=>{
    const el=document.getElementById('volume-slider'),bar=document.getElementById('bottom-bar'),api=window.LumiFieldParticleRangeControl;
    if(bar)bar.classList.add('visible');document.body.classList.add('controls-visible');
    const volumeControl=document.getElementById('volume-control');if(volumeControl)volumeControl.classList.add('open');
    await new Promise(resolve=>requestAnimationFrame(resolve));
    const before=api.getDebug(),old=el.value,min=Number(el.min||0),max=Number(el.max||1),step=Number(el.step||.01);
    const next=Number(old)>min+step?Math.max(min,Number(old)-Math.max(step,(max-min)*.07)):Math.min(max,Number(old)+Math.max(step,(max-min)*.07));
    el.value=String(next);el.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const rect=el.getBoundingClientRect(),style=getComputedStyle(el);
    return {old,value:el.value,rect:{left:rect.left,top:rect.top,width:rect.width,height:rect.height},style:{display:style.display,visibility:style.visibility,opacity:style.opacity},before,after:api.getDebug()};
  })()`);
  pass('existing slider business values remain functional while feedback is queued',Number(native.value)!==Number(native.old)&&native.after.inputEvents===native.before.inputEvents+1&&native.after.emissions===native.before.emissions+1,native);

  const dpis=[];
  for(const scale of [1,1.5,2]){
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1080,height:608,deviceScaleFactor:scale,mobile:false});
    await cdp.evaluate(`(async()=>{window.dispatchEvent(new Event('resize'));window.LumiFieldParticleRangeControl.refresh();const el=document.getElementById('lf-v1144-visible-range');el.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(resolve=>requestAnimationFrame(resolve));return true;})()`);
    dpis.push(await cdp.evaluate(`(()=>{const d=window.LumiFieldParticleRangeControl.getDebug(),c=document.getElementById('lf-particle-range-overlay');return {dpr:d.viewport.dpr,width:d.viewport.width,height:d.viewport.height,canvasWidth:c.width,canvasHeight:c.height,canvasCount:d.canvasCount,schedulerCount:d.schedulerCount};})()`));
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  pass('100 150 and 200 percent DPI reuse one pixel-budgeted overlay',dpis.every((item,index)=>Math.abs(item.dpr-[1,1.5,1.5][index])<.01&&item.canvasWidth===Math.round(item.width*item.dpr)&&item.canvasHeight===Math.round(item.height*item.dpr)&&item.canvasCount===1&&item.schedulerCount<=1),dpis);

  await waitFor(()=>cdp.evaluate(`(()=>{const d=window.LumiFieldParticleRangeControl.getDebug();return !d.rafPending&&d.activeParticles===0;})()`),10000);
  const idleBacking=await cdp.evaluate(`window.LumiFieldParticleRangeControl.getDebug().viewport`);
  pass('overlay releases full-screen pixels again when particles settle',idleBacking.backingReleased&&idleBacking.backingWidth===1&&idleBacking.backingHeight===1,idleBacking);
  const lifecycle=await cdp.evaluate(`(()=>{const api=window.LumiFieldParticleRangeControl,before=api.getDebug();api.dispose();const disposed=api.getDebug();api.refresh();const restored=api.getDebug();return {before,disposed,restored};})()`);
  pass('dispose and refresh restore one idle canvas observer and listener set',!lifecycle.disposed.initialized&&lifecycle.disposed.canvasCount===0&&lifecycle.restored.initialized&&lifecycle.restored.canvasCount===1&&lifecycle.restored.observerCount===1&&lifecycle.restored.listenerCount===lifecycle.before.listenerCount&&lifecycle.restored.viewport.backingReleased,lifecycle);
}

async function cleanup(){if(cdp){try{await cdp.evaluate(`const n=document.getElementById('lf-v1144-slider-fixture');if(n)n.remove();true`);}catch(_){}cdp.close();}if(app&&!app.killed){try{app.kill();}catch(_){}await delay(700);}}

(async()=>{
  let failure=null;
  try{staticChecks();await startApp();await exercise();pass('renderer emitted no uncaught exceptions',rendererErrors.length===0,rendererErrors);pass('renderer emitted no console errors',consoleErrors.length===0,consoleErrors);}
  catch(error){failure={message:String(error&&error.message||error),stack:String(error&&error.stack||'')};}
  finally{await cleanup();}
  const result={overall:failure?'FAIL':'PASS',mode:'SOURCE_ELECTRON_TARGETED',checks,checkCount:Object.keys(checks).length,rendererErrors,consoleErrors,screenshots,productSha256:{effect:fileSha256(path.join(repo,'public','lf-particle-range-control.js')),index:fileSha256(path.join(repo,'public','index.html'))},failure,appLog};
  fs.writeFileSync(path.join(evidenceDir,'result.json'),JSON.stringify(result,null,2));
  process.stdout.write(`${JSON.stringify({overall:result.overall,checkCount:result.checkCount,evidenceDir,failure},null,2)}\n`);
  if(failure)process.exitCode=1;
})();
