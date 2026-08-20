'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const dependencyRoot = process.env.LF_DEPENDENCY_ROOT || path.resolve(repo, '..', '..', 'release', 'verify-v1.1.43-tag', 'node_modules');
const electronExe = path.join(dependencyRoot, 'electron', 'dist', 'electron.exe');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.join(repo, 'test-results', 'lf-v1144-3-realtime-spectrum', runId);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-v1144-3-'));
const checks = {};
const rendererErrors = [];
const consoleErrors = [];
const appLog = [];
const screenshots = [];
let app = null;
let cdp = null;

fs.mkdirSync(evidenceDir, { recursive:true });
fs.mkdirSync(path.join(userData, 'migrations'), { recursive:true });
fs.writeFileSync(path.join(userData, 'migrations', 'legacy-upstream-platform-session-v2.json'), JSON.stringify({
  version:2, validated:true, testIsolation:true, results:[]
}, null, 2), { encoding:'utf8', mode:0o600 });

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase(); }
function pass(name, condition, detail) {
  assert.ok(condition, `${name}: ${JSON.stringify(detail)}`);
  checks[name] = detail == null ? true : detail;
}
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}
async function waitFor(fn, timeout = 60000, interval = 100) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      last = String(error && error.message || error);
    }
    await delay(interval);
  }
  throw new Error(`Timeout: ${JSON.stringify(last)}`);
}

class CDP {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result || {});
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const detail = message.params && message.params.exceptionDetails || {};
        rendererErrors.push(String(detail.exception && detail.exception.description || detail.text || 'renderer exception'));
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params && message.params.type === 'error') {
        consoleErrors.push((message.params.args || []).map(item => item.value || item.description || '').join(' '));
      }
    };
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
    await this.send('Emulation.setFocusEmulationEnabled', { enabled:true });
  }
  send(method, params, timeout = 30000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params:params || {} }));
    });
  }
  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true, userGesture:true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception && response.exceptionDetails.exception.description || response.exceptionDetails.text);
    return response.result && response.result.value;
  }
  async screenshot(name) {
    const response = await this.send('Page.captureScreenshot', { format:'png', fromSurface:true, captureBeyondViewport:false });
    const file = path.join(evidenceDir, name);
    fs.writeFileSync(file, Buffer.from(response.data, 'base64'));
    screenshots.push({ file:path.basename(file), sha256:sha256(file), bytes:fs.statSync(file).size });
  }
  close() { try { this.ws.close(); } catch (_) {} }
}

function staticChecks() {
  const source = fs.readFileSync(path.join(repo, 'public', 'lumifield-task13.js'), 'utf8');
  const spectrumStart = source.indexOf('// ---------- Unified SpectrumState');
  const spectrumEnd = source.indexOf('// Legacy echo rendering', spectrumStart);
  const spectrum = source.slice(spectrumStart, spectrumEnd > spectrumStart ? spectrumEnd : source.length);
  pass('Shape 1 display count is driven by the live SpectrumState', /var count = effectiveSpectrumCount\(\)/.test(spectrum) && !/referenceMode\s*\?\s*48/.test(spectrum), true);
  pass('Shape 1 uses analytic antialiasing and a flat rounded plane', /PlaneBufferGeometry\(1, 1, 1, 1\)/.test(spectrum) && /fwidth\(distanceToCapsule\)/.test(spectrum) && /smoothstep\(-edge,edge,distanceToCapsule\)/.test(spectrum), true);
  pass('spectrum code has no Card Tilt binding', !/(?:card.?tilt|LumiFieldTilt|data-lf-tilt|lf-tilt)/i.test(spectrum), true);
  pass('Shape 1 Home path explicitly hides both Three objects', /if \(spectrumStage\.group\) spectrumStage\.group\.visible = false;\s*if \(spectrumStage\.mesh\) spectrumStage\.mesh\.visible = false;/.test(spectrum), true);
  pass('only the active Shape 3 view owns a large canvas backing store', /var ownsBackingStore = spectrumState\.mode === 3/.test(spectrum) && /ownsBackingStore \?[^;]+: 1/.test(spectrum), true);
}

async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return response.json();
}

async function startApp() {
  assert.ok(fs.existsSync(electronExe), `Electron not found: ${electronExe}`);
  const port = await freePort();
  app = spawn(electronExe, ['.', `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], {
    cwd:repo, windowsHide:true, stdio:['ignore','pipe','pipe'],
    env:Object.assign({}, process.env, {
      NODE_PATH:dependencyRoot,
      LF_MASTER_TEST:'1',
      LUMIFIELD_SKIP_SPLASH:'1',
      ELECTRON_DISABLE_SECURITY_WARNINGS:'true'
    })
  });
  const collect = data => appLog.push(String(data));
  app.stdout.on('data', collect);
  app.stderr.on('data', collect);
  const target = await waitFor(async () => {
    const targets = await listTargets(port);
    return targets.find(item => item.type === 'page' && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?(?:index\.html)?$/i.test(item.url));
  });
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await waitFor(() => cdp.evaluate(`document.readyState==='complete' && !!window.LumiFieldTask13 && !!window.renderer && !!window.scene && !!window.frequencyData`));
  await delay(1800);
}

async function drive(frames = 18, pattern = 0.083) {
  for (let frame = 0; frame < frames; frame += 1) {
    await cdp.evaluate(`(()=>{
      const data=window.frequencyData;
      for(let i=0;i<data.length;i++) data[i]=Math.max(12,Math.round(238*(.18+.82*Math.abs(Math.sin(i*${pattern}+${frame}*.071)))));
      window.lumiFieldFrequencyDataTimestamp=performance.now();
      window.LumiFieldTask13.updateFrame(performance.now(),1/60);
      return true;
    })()`);
    await delay(24);
  }
}

async function prepareSpectrum() {
  await cdp.evaluate(`(async()=>{
    const hide=id=>{const n=document.getElementById(id);if(n){n.classList.remove('show','active');n.style.setProperty('display','none','important');n.setAttribute('aria-hidden','true');}};
    ['lf-auth-root','visual-guide','login-modal','user-modal','local-beat-modal'].forEach(hide);
    document.body.classList.remove('lf-auth-locked','splash-active','splash-revealing','empty-home-active','lf-fx-open','immersive-mode');
    window.emptyHomeActive=false;window.homeForcedOpen=false;window.homeSuppressed=true;
    const panel=document.getElementById('fx-panel');if(panel)panel.classList.remove('show','peek','closing');
    const sampleRate=8000, sampleCount=sampleRate*8, buffer=new ArrayBuffer(44+sampleCount*2), view=new DataView(buffer);
    const ascii=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
    ascii(0,'RIFF');view.setUint32(4,36+sampleCount*2,true);ascii(8,'WAVE');ascii(12,'fmt ');
    view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);
    view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,sampleCount*2,true);
    for(let i=0;i<sampleCount;i++){const t=i/sampleRate;view.setInt16(44+i*2,Math.round(Math.sin(t*Math.PI*220)*1100+Math.sin(t*Math.PI*880)*360),true);}
    const url=URL.createObjectURL(new Blob([buffer],{type:'audio/wav'}));
    const audio=new Audio(url);audio.loop=true;
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('SPECTRUM_AUDIO_TIMEOUT')),5000);audio.addEventListener('canplaythrough',()=>{clearTimeout(timer);resolve();},{once:true});audio.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('SPECTRUM_AUDIO_ERROR'));},{once:true});audio.load();});
    window.__lfV1144SpectrumOriginalAudio=window.audio;window.__lfV1144SpectrumAudio=audio;window.__lfV1144SpectrumUrl=url;window.audio=audio;
    await audio.play();window.playing=true;
    window.LumiFieldTask13.setEchoState({enabled:false});
    window.LumiFieldTask13.setSpectrumState({enabled:true,mode:1,bandCount:24,horizontalGap:3,heightScale:1.25,opacity:.82,brightness:1,glow:.6,colorMode:'gradient',colorA:'#55b3d2',colorB:'#b076d1',attack:.9,release:.2,smooth:.56});
    return true;
  })()`);
  await drive(24);
}

async function debug() { return cdp.evaluate('window.LumiFieldTask13.getSpectrumDebug()'); }

async function exercise() {
  await prepareSpectrum();
  const initial = await debug();
  pass('Shape 1 mounts once in the shared Three scene', initial.mount === 'secondary' && initial.mountType === 'three-world-stage' && initial.stageObjectPresent && initial.stageMeshPresent && initial.stageWorldTransform && initial.stageWorldTransform.parent === 'LumiFieldVisualStageTransform' && initial.stageWorldTransform.root === 'Scene', initial);
  pass('Shape 1 starts with the requested 24 bars and no canvas allocation', initial.requestedBandCount === 24 && initial.renderedBandCount === 24 && initial.geometryInstanceCount === 24 && initial.backingStores.largeCount === 0, initial);
  pass('Shape 1 visual material is a sharp analytic rounded capsule plane', initial.geometryType === 'analytic-rounded-capsule-plane' && initial.analyticAntialias === true && initial.flatFrontFacing === true && initial.visualStyle === 'tears-reference-aa-capsules' && initial.materialDiagnostics && initial.materialDiagnostics.depthWrite === false && initial.materialDiagnostics.depthTest === false, initial);

  const liveChange = await cdp.evaluate(`(()=>{
    const input=document.querySelector('[data-lf-scope="spectrum"][data-lf-key="bandCount"]');
    if(!input)return {missing:true};
    const before=window.LumiFieldTask13.getSpectrumDebug();
    input.value='73';input.dispatchEvent(new Event('input',{bubbles:true}));
    return {missing:false,before,controlValue:Number(input.value),state:window.LumiFieldTask13.getState().spectrum};
  })()`);
  await drive(8, 0.117);
  const changed = await debug();
  pass('band count control updates Shape 1 in the current secondary view', !liveChange.missing && liveChange.controlValue === 73 && liveChange.state.bandCount === 73 && changed.mount === 'secondary' && changed.renderedBandCount === 73 && changed.geometryInstanceCount === 73, { liveChange, changed });
  pass('live band change keeps the same scene root and rebuilds only the shared mesh', changed.stageWorldTransform.parent === initial.stageWorldTransform.parent && changed.geometryRebuildCount === initial.geometryRebuildCount + 1 && changed.stageObjectName === 'LumiFieldSpectrumStage' && changed.stageMeshName === 'LumiFieldRealtimeSpectrumMode1', { initial, changed });

  const invalid = await cdp.evaluate(`(()=>{
    const before=window.LumiFieldTask13.getSpectrumDebug();
    const low=window.LumiFieldTask13.setSpectrumState({bandCount:0});
    const high=window.LumiFieldTask13.setSpectrumState({bandCount:257});
    return {before,low,high,after:window.LumiFieldTask13.getSpectrumDebug()};
  })()`);
  pass('invalid band counts are rejected atomically', invalid.low === false && invalid.high === false && invalid.after.renderedBandCount === 73 && invalid.after.geometryIdentity === invalid.before.geometryIdentity, invalid);

  await cdp.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:180, y:260, button:'none', buttons:0, pointerType:'mouse' });
  await drive(18, 0.091);
  const left = await debug();
  const viewport = await cdp.evaluate('({width:innerWidth,height:innerHeight})');
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:Math.round(viewport.width * .82), y:Math.round(viewport.height * .48), button:'none', buttons:0, pointerType:'mouse' });
  await drive(24, 0.091);
  const right = await debug();
  pass('Shape 1 follows the shared stage pointer in position and rotation', left.pointerMotion && right.pointerMotion && right.pointerMotion.centerX - left.pointerMotion.centerX > 8 && Math.abs(right.pointerMotion.baselineCenter - left.pointerMotion.baselineCenter) > 2 && right.pointerMotion.rotationRadians - left.pointerMotion.rotationRadians > 0.02, { left:left.pointerMotion, right:right.pointerMotion });
  pass('Shape 1 remains fully clipped inside the usable viewport', right.projectedBounds && right.projectedBounds.fullyVisible === true && right.projectedBounds.left >= 0 && right.projectedBounds.top >= 0, right.projectedBounds);
  pass('Three layer order remains particles then spectrum then lyrics then 3D playlist', right.layerOrder && right.layerOrder.particles < right.layerOrder.spectrum && right.layerOrder.spectrum < right.layerOrder.lyrics && right.layerOrder.lyrics < right.layerOrder.shelf && right.layerOrder.shelf < right.layerOrder.shelfContent, right.layerOrder);

  const home = await cdp.evaluate(`(()=>{
    document.body.classList.add('empty-home-active');window.emptyHomeActive=true;window.homeForcedOpen=true;window.homeSuppressed=false;
    window.LumiFieldTask13.updateFrame(performance.now()+40,1/60);
    return true;
  })()`);
  await drive(5);
  const homeDebug = await debug();
  const homeDom = await cdp.evaluate(`(()=>({
    activeCanvases:document.querySelectorAll('#lf-t13-spectrum.active,#lf-t13-spectrum-main.active').length,
    visibleCanvas:[...document.querySelectorAll('#lf-t13-spectrum,#lf-t13-spectrum-main')].some(node=>Number(getComputedStyle(node).opacity)>.01)
  }))()`);
  pass('Shape 1 never leaks through Home gaps', home === true && homeDebug.mount === 'main' && homeDebug.active === false && homeDebug.stageVisible === false && homeDebug.backingStores.largeCount === 0 && homeDom.activeCanvases === 0 && homeDom.visibleCanvas === false, { homeDebug, homeDom });

  await cdp.evaluate(`(()=>{document.body.classList.remove('empty-home-active');window.emptyHomeActive=false;window.homeForcedOpen=false;window.homeSuppressed=true;window.LumiFieldTask13.setSpectrumState({mode:1,bandCount:73});return true;})()`);
  await drive(12);
  const restored = await debug();
  pass('Shape 1 restores in the same secondary view without a Home round trip', restored.mount === 'secondary' && restored.stageVisible === true && restored.renderedBandCount === 73, restored);

  await cdp.evaluate(`window.LumiFieldTask13.setSpectrumState({mode:3,bandCount:73,heightScale:1.2});true`);
  await drive(22, 0.129);
  const shape3 = await debug();
  const shape3Pixels = await cdp.evaluate(`(()=>{
    const canvas=document.getElementById('lf-t13-spectrum');const ctx=canvas.getContext('2d',{willReadFrequently:true});
    const w=canvas.width,h=canvas.height,data=ctx.getImageData(0,0,w,h).data;
    let edge=0,center=0,edgeSamples=0,centerSamples=0;
    for(let y=0;y<h;y+=8){for(let x=0;x<w;x+=8){const a=data[(y*w+x)*4+3];if(y<h*.34||y>h*.66){edge+=a;edgeSamples++;}else{center+=a;centerSamples++;}}}
    const ids=['fx-panel','playlist-panel','bottom-bar'];
    return {width:w,height:h,active:canvas.classList.contains('active'),pointerEvents:getComputedStyle(canvas).pointerEvents,zIndex:Number(getComputedStyle(canvas).zIndex||0),edgeAverage:edge/Math.max(1,edgeSamples),centerAverage:center/Math.max(1,centerSamples),uiZ:ids.map(id=>({id,z:Number(getComputedStyle(document.getElementById(id)).zIndex||0)})),rendererZ:Number(getComputedStyle(document.getElementById('canvas-container')).zIndex||0)};
  })()`);
  pass('Shape 3 allocates exactly one active-view backing store', shape3.mode === 3 && shape3.backingStores.largeCount === 1 && shape3.backingStores.main.width === 1 && shape3.backingStores.main.height === 1 && shape3.backingStores.secondary.width > 1 && shape3.backingStores.secondary.height > 1, shape3.backingStores);
  pass('Shape 3 stays behind lyrics, controls and 3D playlist and never intercepts input', shape3Pixels.active && shape3Pixels.pointerEvents === 'none' && shape3Pixels.zIndex === 0 && shape3Pixels.rendererZ > shape3Pixels.zIndex && shape3Pixels.uiZ.every(item => item.z > shape3Pixels.zIndex), shape3Pixels);
  pass('Shape 3 preserves a clear central stage instead of obscuring content', shape3Pixels.edgeAverage > 0.2 && shape3Pixels.centerAverage < shape3Pixels.edgeAverage * 0.08, shape3Pixels);

  const beforeCycles = shape3.geometryRebuildCount;
  for (let index = 0; index < 24; index += 1) {
    const mode = index % 2 ? 3 : 1;
    const count = 16 + (index * 17) % 105;
    await cdp.evaluate(`window.LumiFieldTask13.setSpectrumState({mode:${mode},bandCount:${count}});true`);
    await drive(2, 0.071 + index * 0.001);
  }
  await cdp.evaluate(`window.LumiFieldTask13.setSpectrumState({mode:1,bandCount:64});true`);
  await drive(10);
  const cycled = await debug();
  const singleton = await cdp.evaluate(`(()=>({
    groups:window.scene.children.filter(node=>node&&node.name==='LumiFieldVisualStageTransform').length,
    stageGroups:(()=>{let count=0;window.scene.traverse(node=>{if(node&&node.name==='LumiFieldSpectrumStage')count++;});return count;})(),
    meshes:(()=>{let count=0;window.scene.traverse(node=>{if(node&&node.name==='LumiFieldRealtimeSpectrumMode1')count++;});return count;})(),
    canvases:document.querySelectorAll('#lf-t13-spectrum,#lf-t13-spectrum-main').length
  }))()`);
  pass('repeated mode and band changes keep one stage, one mesh and two bounded canvases', cycled.renderedBandCount === 64 && cycled.geometryInstanceCount === 64 && cycled.backingStores.largeCount === 0 && singleton.groups === 1 && singleton.stageGroups === 1 && singleton.meshes === 1 && singleton.canvases === 2 && cycled.geometryRebuildCount > beforeCycles, { cycled, singleton });

  await cdp.screenshot('01-secondary-spectrum-final.png');
  pass('renderer and console remain error-free', rendererErrors.length === 0 && consoleErrors.length === 0, { rendererErrors, consoleErrors });
}

async function stopApp() {
  if (cdp) {
    try {
      await cdp.evaluate(`(()=>{if(window.__lfV1144SpectrumAudio){window.__lfV1144SpectrumAudio.pause();}if(window.__lfV1144SpectrumUrl)URL.revokeObjectURL(window.__lfV1144SpectrumUrl);return true;})()`);
      await cdp.evaluate('window.close();true');
    } catch (_) {}
    cdp.close();
  }
  if (app && app.pid && app.exitCode == null) await Promise.race([new Promise(resolve => app.once('exit', resolve)), delay(4000)]);
  if (app && app.pid && app.exitCode == null) spawnSync('taskkill', ['/pid', String(app.pid), '/t', '/f'], { windowsHide:true, stdio:'ignore' });
  try { fs.rmSync(userData, { recursive:true, force:true }); } catch (_) {}
}

async function main() {
  let failure = null;
  try {
    staticChecks();
    await startApp();
    await exercise();
  } catch (error) {
    failure = error;
  } finally {
    await stopApp();
  }
  const result = {
    status:failure ? 'FAIL' : 'PASS',
    runId,
    checks,
    totals:{ passed:Object.keys(checks).length, failed:failure ? 1 : 0 },
    rendererErrors,
    consoleErrors,
    screenshots,
    appLog:appLog.join('').slice(-20000),
    failure:failure ? String(failure.stack || failure) : null,
    productSha256:sha256(path.join(repo, 'public', 'lumifield-task13.js'))
  };
  const resultFile = path.join(evidenceDir, 'result.json');
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status:result.status, evidenceDir, totals:result.totals, resultSha256:sha256(resultFile) }, null, 2));
  if (failure) throw failure;
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
