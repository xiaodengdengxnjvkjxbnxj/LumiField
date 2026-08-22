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
const evidenceDir = path.join(repo, 'test-results', 'lf-v1144-4-audio-echo', runId);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-v1144-4-'));
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
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex').toUpperCase(); }
function fileSha256(file) { return sha256(fs.readFileSync(file)); }
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
    screenshots.push({ file:path.basename(file), sha256:fileSha256(file), bytes:fs.statSync(file).size });
  }
  close() { try { this.ws.close(); } catch (_) {} }
}

function extractShader(source, name) {
  const match = source.match(new RegExp('var ' + name + ' = `([\\s\\S]*?)`;'));
  assert.ok(match, `missing ${name}`);
  return match[1].replace(/[ \t]+$/gm, '').replace(/\r\n/g, '\n');
}

function staticChecks() {
  const shape1 = fs.readFileSync(path.join(repo, 'public', 'lf-audio-echo-shape1.js'), 'utf8');
  const shape2 = fs.readFileSync(path.join(repo, 'public', 'lf-audio-echo-shape2.js'), 'utf8');
  const manager = fs.readFileSync(path.join(repo, 'public', 'lumifield-audio-echo.js'), 'utf8');
  const task13 = fs.readFileSync(path.join(repo, 'public', 'lumifield-task13.js'), 'utf8');
  const index = fs.readFileSync(path.join(repo, 'public', 'index.html'), 'utf8');
  const releaseGate = fs.readFileSync(path.join(repo, 'docs', 'licenses', 'audio-echo-v2', 'RELEASE_GATE.md'), 'utf8');

  pass('Shape 1 is pinned to the requested repository and fixed MIT commit', /hgbhh258-spec\/Sonic-Topography-Wallpaper/.test(shape1) && /51afbac3d5978c112311fca38f7334578ca2b0e6/.test(shape1) && /MIT_PERMISSIVE_PASS/.test(shape1), true);
  pass('Shape 1 source manifest records all fixed upstream hashes', ['60C69D161487A921E487DE36908432F4FC43167C63B20A4D06A6EAE5D3C8F827','5DF1BCD76FB0F5EFA8F185EC317E0F29438AC2DCE45FBA7B02D21CB662F563E5','EA4D69B9D65BACE0FA36031864A19F8FCE98DDE7027AB311C3E58FE2ED9AEEE2','985314D22C24EFEB4F629B623E6D494225F9063AE2FC11F9FD2F2AF539FEFAE1'].every(value => shape1.includes(value)), true);
  pass('Shape 1 embeds the fixed source vertex shader without visual rewrites', sha256(extractShader(shape1, 'TERRAIN_VERTEX_SHADER')) === 'CA8BFE6D00B3681C312A403F96921FBE1D1B7D6C520C180F769EF4887C9ED136', true);
  pass('Shape 1 embeds the fixed source fragment shader without visual rewrites', sha256(extractShader(shape1, 'TERRAIN_FRAGMENT_SHADER')) === '6DB24F41C63AD5FF62D49D2338E31619888F5B23D76536E7A2C78044A17DE720', true);
  pass('Shape 1 preserves the 160 by 160 map and fixed event pools', /var GRID_SIZE = 160/.test(shape1) && /var RIPPLE_COUNT = 10/.test(shape1) && /var METEOR_COUNT = 20/.test(shape1) && /var PARTICLE_COUNT = 200/.test(shape1), true);
  pass('Shape 1 has no retired floating block or legacy ground EQ runtime', !/(?:FLOATING_BLOCK|floatingBlocks|sourceEqBands|applyGroundEq|uAmplitude)/.test(shape1), true);
  pass('Shape 2 remains pinned to CmzYa fixed commit and GPL pass', /CmzYa\/sonic-topography/.test(shape2) && /cd6d9d2faee167f2dcafd2d0cbd2b4861e7e5fbc/.test(shape2) && /AUDIO_ECHO_V2_GPL_PASS/.test(shape2), true);
  pass('only Shape 1 and Shape 2 are registered', /var SHAPES = \['shape1', 'shape2'\]/.test(manager) && !/registerMode\([^)]*shape3/.test(manager), true);
  pass('quality uses four explicit backing-store scales and never selects a shape', /QUALITY_SCALES = \{ low:0\.62, medium:0\.82, high:1, ultra:1\.22 \}/.test(manager) && /automaticShapeSwitching:false/.test(manager), true);
  pass('the four requested quality controls are present and old Auto is absent', /\['low','省电'\].*\['medium','标准'\].*\['high','高清'\].*\['ultra','超清'\]/s.test(task13) && !/\['auto','自动'\]/.test(task13), true);
  pass('old timed cycling and visual EQ panel are absent from the actual-source UI', !/(?:autoCycle|cycleInterval|lf-t13-echo-eq|data-lf-echo-eq)/.test(task13), true);
  pass('both shapes reuse the same protected lyrics bridge', /active:surfaceAvailable\(\) && !!activeShape/.test(manager) && /两种形态复用同一组件/.test(task13), true);
  pass('zoom direction is model-grow for both source adapters', /sourceRadius\*distanceScale\/zoom/.test(shape1) && /runtimeState\.cameraDistance \/ lastGesture\.zoom/.test(shape2), true);
  pass('auto rotation off has an exact zero angular velocity', /angularVelocity=state\.autoRotate===true/.test(shape1) && /angularVelocity:runtimeState\.autoRotateEnabled \? runtimeState\.autoRotateSpeed : 0/.test(shape2), true);
  pass('all four quality modes use renderer backing scale without camera or model offsets', /ratio \* echoScale/.test(index) && /scheduleMainRendererViewportRefresh = scheduleMainRendererViewportRefresh/.test(index), true);
  pass('ordinary preset selection atomically releases Echo while playback changes preserve it', /stopAudioEchoBeforeNormalPreset/.test(index) && /pointer\.listeners \|\| 0\) === 0/.test(index) && (index.match(/preserveAudioEcho:true/g) || []).length >= 4, true);
  const surfaceGate = manager.slice(manager.indexOf('function surfaceAvailable()'), manager.indexOf('function isActive()'));
  pass('Audio Echo remains available behind the main-interface panels', !surfaceGate.includes("classList.contains('empty-home-active')"), surfaceGate);
  pass('release documentation marks the implemented pair as distributable', /AUDIO_ECHO_V2_GPL_PASS/.test(releaseGate) && /hgbhh258-spec\/Sonic-Topography-Wallpaper/.test(releaseGate), true);
}

async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return response.json();
}

async function startApp() {
  assert.ok(fs.existsSync(electronExe), `Electron not found: ${electronExe}`);
  const port = await freePort();
  app = spawn(electronExe, ['.', `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], {
    cwd:repo,
    windowsHide:true,
    stdio:['ignore','pipe','pipe'],
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
  await waitFor(() => cdp.evaluate(`document.readyState==='complete' && !!window.LumiFieldTask13 && !!window.LumiFieldAudioEchoManager && !!window.renderer && !!window.frequencyData`));
  await delay(1600);
}

async function drive(frames = 12, offset = 0) {
  for (let frame = 0; frame < frames; frame += 1) {
    await cdp.evaluate(`(()=>{
      const data=window.frequencyData;
      for(let i=0;i<data.length;i++) data[i]=Math.max(6,Math.round(232*(.16+.84*Math.abs(Math.sin(i*.071+${offset}+${frame}*.13)))));
      window.LumiFieldTask13.updateEchoFrame(performance.now(),1/60);
      return true;
    })()`);
    await delay(20);
  }
}

async function prepareEcho() {
  await cdp.evaluate(`(async()=>{
    const hide=id=>{const n=document.getElementById(id);if(n){n.classList.remove('show','active');n.style.setProperty('display','none','important');n.setAttribute('aria-hidden','true');}};
    ['lf-auth-root','visual-guide','login-modal','user-modal','local-beat-modal'].forEach(hide);
    document.body.classList.remove('lf-auth-locked','splash-active','splash-revealing','empty-home-active','lf-fx-open','immersive-mode');
    window.emptyHomeActive=false;window.homeForcedOpen=false;window.homeSuppressed=true;
    const panel=document.getElementById('fx-panel');if(panel)panel.classList.remove('show','peek','closing');
    const sampleRate=8000,sampleCount=sampleRate*10,buffer=new ArrayBuffer(44+sampleCount*2),view=new DataView(buffer);
    const ascii=(o,v)=>{for(let i=0;i<v.length;i++)view.setUint8(o+i,v.charCodeAt(i));};
    ascii(0,'RIFF');view.setUint32(4,36+sampleCount*2,true);ascii(8,'WAVE');ascii(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,sampleCount*2,true);
    for(let i=0;i<sampleCount;i++){const t=i/sampleRate;view.setInt16(44+i*2,Math.round(Math.sin(t*Math.PI*180)*1200+Math.sin(t*Math.PI*760)*420),true);}
    const url=URL.createObjectURL(new Blob([buffer],{type:'audio/wav'})),audio=new Audio(url);audio.loop=true;
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('ECHO_AUDIO_TIMEOUT')),5000);audio.addEventListener('canplaythrough',()=>{clearTimeout(timer);resolve();},{once:true});audio.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('ECHO_AUDIO_ERROR'));},{once:true});audio.load();});
    window.__lfV1144EchoOriginalAudio=window.audio;window.__lfV1144EchoAudio=audio;window.__lfV1144EchoUrl=url;window.audio=audio;await audio.play();window.playing=true;
    window.LumiFieldTask13.setSpectrumState({enabled:false});
    const ok=window.LumiFieldTask13.setEchoState({enabled:true,shape:'shape1',quality:'high',theme:'nocturnal',cameraDistance:1,cameraHorizontal:0,cameraElevation:27,autoRotate:false,rotateSpeed:.5,rippleEnabled:true,rippleSensitivity:.15,rippleCooldown:60,mode1LeftLyricsEnabled:true});
    return ok;
  })()`);
  await waitFor(() => cdp.evaluate(`(()=>{const d=window.LumiFieldAudioEchoManager.getDebug();return d.active&&d.activeShape==='shape1'&&d.activeAdapter&&d.activeAdapter.grid.instanceCount===25600;})()`));
  await drive(18);
}

async function debug() { return cdp.evaluate('window.LumiFieldAudioEchoManager.getDebug()'); }

async function exercise() {
  await prepareEcho();
  const shape1 = await debug();
  pass('Shape 1 mounts as one independent source scene', shape1.active && shape1.activeSceneCount === 1 && shape1.activeShape === 'shape1' && shape1.activeAdapter.sceneIndependent && shape1.activeAdapter.grid.instanceCount === 25600, shape1);
  pass('Shape 1 uses only the fixed source event pools', shape1.activeAdapter.eventPools.ripples === 10 && shape1.activeAdapter.eventPools.meteors === 20 && shape1.activeAdapter.eventPools.impactParticles === 200 && !Object.prototype.hasOwnProperty.call(shape1.activeAdapter.eventPools, 'floatingBlocks'), shape1.activeAdapter.eventPools);
  pass('Shape 1 reuses renderer, analyser, audio context, and player', shape1.shared.rendererReused && shape1.shared.analyserMatchesWindow && shape1.shared.contextMatchesWindow && shape1.shared.frequencyDataMatchesWindow && shape1.shared.audioElementMatchesWindow && Object.values(shape1.allocations).every(value => value === 0), { shared:shape1.shared, allocations:shape1.allocations });
  pass('Shape 1 starts at the normalized center-lower anchor', shape1.normalizedAnchor.x === .5 && shape1.normalizedAnchor.y === .62 && shape1.activeAdapter.normalizedAnchor.y === .62 && shape1.activeAdapter.camera.isDefault, { manager:shape1.normalizedAnchor, adapter:shape1.activeAdapter.normalizedAnchor, camera:shape1.activeAdapter.camera });
  pass('Shape 1 automatic rotation is exactly stopped while disabled', shape1.activeAdapter.motion.angularVelocity === 0, shape1.activeAdapter.motion);
  await cdp.screenshot('shape1.png');

  const quality = [];
  for (const mode of ['low','medium','high','ultra']) {
    quality.push(await cdp.evaluate(`(async()=>{window.LumiFieldTask13.setEchoState({quality:'${mode}'});await new Promise(r=>setTimeout(r,380));const d=window.LumiFieldAudioEchoManager.getDebug();return {mode:d.quality.mode,scale:d.quality.renderScale,anchor:d.normalizedAnchor,buildCount:d.buildCount,camera:d.activeAdapter.camera,grid:d.activeAdapter.grid,pixelRatio:window.getRenderPixelRatio()};})()`));
  }
  const expectedScales = [.62,.82,1,1.22];
  pass('four quality modes change only render scale', quality.every((item, index) => Math.abs(item.scale - expectedScales[index]) < 1e-9 && item.anchor.x === .5 && item.anchor.y === .62 && item.grid.instanceCount === 25600 && item.buildCount === quality[0].buildCount), quality);
  pass('quality controls affect backing DPR without model or camera drift', quality[0].pixelRatio < quality[1].pixelRatio && quality.every(item => JSON.stringify(item.camera.position) === JSON.stringify(quality[0].camera.position) && JSON.stringify(item.camera.target) === JSON.stringify(quality[0].camera.target)), quality);

  const stoppedRotation = await cdp.evaluate(`(()=>{window.LumiFieldTask13.setEchoState({autoRotate:false});const d=window.LumiFieldAudioEchoManager.getDebug();return d.activeAdapter.motion.rotation;})()`);
  await drive(20, .4);
  const stoppedAfter = await debug();
  pass('Shape 1 rotation remains fixed while auto rotate is off', stoppedAfter.activeAdapter.motion.angularVelocity === 0 && Math.abs(stoppedAfter.activeAdapter.motion.rotation - stoppedRotation) < 1e-9, { before:stoppedRotation, after:stoppedAfter.activeAdapter.motion });
  await cdp.evaluate(`window.LumiFieldTask13.setEchoState({autoRotate:true,rotateSpeed:.5});true`);
  await drive(20, .8);
  const rotating = await debug();
  pass('Shape 1 rotation advances in the configured positive direction', rotating.activeAdapter.motion.angularVelocity === .5 && rotating.activeAdapter.motion.rotation > stoppedRotation, rotating.activeAdapter.motion);
  await cdp.evaluate(`window.LumiFieldTask13.setEchoState({autoRotate:false});window.LumiFieldAudioEchoManager.resetCamera();true`);

  const viewport = await cdp.evaluate('({width:innerWidth,height:innerHeight})');
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:Math.round(viewport.width * .32), y:Math.round(viewport.height * .48), button:'none', buttons:0, pointerType:'mouse' });
  await cdp.send('Input.dispatchMouseEvent', { type:'mousePressed', x:Math.round(viewport.width * .32), y:Math.round(viewport.height * .48), button:'left', buttons:1, clickCount:1, pointerType:'mouse' });
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:Math.round(viewport.width * .62), y:Math.round(viewport.height * .48), button:'left', buttons:1, pointerType:'mouse' });
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseReleased', x:Math.round(viewport.width * .62), y:Math.round(viewport.height * .48), button:'left', buttons:0, clickCount:1, pointerType:'mouse' });
  await drive(5);
  const dragged = await debug();
  pass('dragging right rotates in the same positive direction', dragged.pointer.rotation[1] > 0 && dragged.activeAdapter.camera.rotation[1] > 0, { pointer:dragged.pointer, camera:dragged.activeAdapter.camera });
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseWheel', x:Math.round(viewport.width * .5), y:Math.round(viewport.height * .5), deltaX:0, deltaY:-240, button:'none', buttons:0, pointerType:'mouse' });
  await drive(5);
  const zoomed = await debug();
  pass('wheel up grows the source model instead of shrinking it', zoomed.pointer.zoom > 1 && zoomed.activeAdapter.camera.zoom > 1, { pointer:zoomed.pointer, camera:zoomed.activeAdapter.camera });

  const beforeSwitch = zoomed;
  await cdp.evaluate(`(()=>{window.playQueue=[{provider:'local',id:'echo-test',name:'音域回响歌词复用'}];window.currentIdx=0;window.lyricsLines=[{t:0,text:'第一行'},{t:.5,text:'第二行'},{t:1,text:'第三行'},{t:1.5,text:'第四行'}];window.LumiFieldTask13.setEchoState({shape:'shape2',theme:'nocturnal',cameraElevation:25,autoRotate:false,quality:'high',rippleSensitivity:.2,rippleCooldown:40,responseStrength:1,responseRange:1,idleDebounce:1,idleFade:1,mode1LeftLyricsEnabled:true});return true;})()`);
  await waitFor(() => cdp.evaluate(`(()=>{const d=window.LumiFieldAudioEchoManager.getDebug();return d.active&&d.activeShape==='shape2'&&d.activeAdapter&&d.activeAdapter.grid.instanceCount===25600;})()`));
  await drive(18, 1.2);
  const shape2 = await debug();
  pass('Shape 2 is a separate fixed-source scene and disposes Shape 1', shape2.activeShape === 'shape2' && shape2.activeSceneCount === 1 && shape2.buildCount === beforeSwitch.buildCount + 1 && shape2.disposeCount === beforeSwitch.disposeCount + 1 && shape2.activeAdapter.source.commit === 'cd6d9d2faee167f2dcafd2d0cbd2b4861e7e5fbc', shape2);
  pass('Shape 2 automatic rotation is exactly stopped while disabled', shape2.activeAdapter.camera.angularVelocity === 0 && shape2.activeAdapter.camera.autoRotate === false, shape2.activeAdapter.camera);
  pass('Shape 2 reuses the exact same protected left lyric component', shape2.lyricsBridge && shape2.lyricsBridge.active === true && shape2.lyricsBridge.enabled === true && shape2.lyricsBridge.mounted === true && shape2.lyricsBridge.protectedFreeze === true, shape2.lyricsBridge);
  await cdp.screenshot('shape2.png');

  await cdp.evaluate(`window.__lfV1144EchoAudio.pause();true`);
  await drive(8, 1.6);
  await cdp.evaluate(`window.__lfV1144EchoAudio.play();true`);
  await drive(8, 1.9);
  const playbackStable = await debug();
  pass('playback, analyser energy, and pause state never switch the selected shape', playbackStable.activeShape === 'shape2' && playbackStable.state.shape === 'shape2', playbackStable);

  const cycleStart = playbackStable;
  for (let index = 0; index < 6; index += 1) {
    const shape = index % 2 ? 'shape2' : 'shape1';
    const elevation = shape === 'shape2' ? 25 : 27;
    await cdp.evaluate(`window.LumiFieldTask13.setEchoState({shape:'${shape}',theme:'nocturnal',cameraElevation:${elevation},autoRotate:false});true`);
    await drive(4, 2 + index);
  }
  const cycled = await debug();
  pass('six source switches leave exactly one scene and one pointer handler set', cycled.activeSceneCount === 1 && cycled.pointer.listeners === 6 && cycled.buildCount === cycleStart.buildCount + 6 && cycled.disposeCount === cycleStart.disposeCount + 6 && cycled.activeAdapter.resources.geometries === 3 && cycled.activeAdapter.resources.materials === 3, cycled);

  const mainBefore = await cdp.evaluate(`(()=>{
    window.LumiFieldTask13.setEchoState({enabled:false});
    window.homeSuppressed=false;window.homeForcedOpen=true;
    window.updateEmptyHomeVisibility({forceLoad:false});
    const ok=window.LumiFieldTask13.setEchoState({enabled:true,shape:'shape1',quality:'high',theme:'nocturnal',autoRotate:false});
    const d=window.LumiFieldAudioEchoManager.getDebug();
    return {ok,renderPasses:d.render.renderPasses};
  })()`);
  await waitFor(() => cdp.evaluate(`(()=>{const d=window.LumiFieldAudioEchoManager.getDebug();return document.body.classList.contains('empty-home-active')&&d.active&&d.activeShape==='shape1'&&d.activeSceneCount===1;})()`));
  await drive(18, 8.4);
  const mainEcho = await cdp.evaluate(`(()=>{
    const d=window.LumiFieldAudioEchoManager.getDebug();
    const canvas=document.getElementById('canvas-container');
    const home=document.getElementById('empty-home');
    const canvasStyle=getComputedStyle(canvas),homeStyle=getComputedStyle(home);
    return {
      active:d.active,activeShape:d.activeShape,activeSceneCount:d.activeSceneCount,
      renderPasses:d.render.renderPasses,bodyActive:document.body.classList.contains('lf-audio-echo-active'),
      homeActive:document.body.classList.contains('empty-home-active'),particlesVisible:!!(window.particles&&window.particles.visible),
      canvasOpacity:Number(canvasStyle.opacity),canvasVisibility:canvasStyle.visibility,
      canvasZ:Number(canvasStyle.zIndex),homeOpacity:Number(homeStyle.opacity),homeZ:Number(homeStyle.zIndex)
    };
  })()`);
  pass('selecting Audio Echo on the main interface renders it beneath the panels without entering the secondary interface',
    mainBefore.ok === true && mainEcho.active && mainEcho.activeShape === 'shape1' && mainEcho.activeSceneCount === 1 &&
    mainEcho.renderPasses > mainBefore.renderPasses && mainEcho.bodyActive && mainEcho.homeActive &&
    mainEcho.particlesVisible === false && mainEcho.canvasOpacity > 0 && mainEcho.canvasVisibility !== 'hidden' &&
    mainEcho.homeOpacity > 0 && mainEcho.canvasZ < mainEcho.homeZ,
    { before:mainBefore, after:mainEcho });
  await cdp.screenshot('shape1-main-interface-gaps.png');

  const normalPreset = await cdp.evaluate(`(()=>{const before=window.fx.preset;const target=(before+1)%window.presetMeta.length;const ok=window.setPreset(target);const d=window.LumiFieldAudioEchoManager.getDebug();return {ok,before,target,actual:window.fx.preset,debug:d,bodyActive:document.body.classList.contains('lf-audio-echo-active'),particles:window.particles&&window.particles.visible,toast:document.getElementById('toast')&&document.getElementById('toast').textContent};})()`);
  pass('ordinary preset selection disposes Echo before activating the preset', normalPreset.ok === true && normalPreset.actual === normalPreset.target && normalPreset.debug.enabled === false && normalPreset.debug.active === false && normalPreset.debug.activeSceneCount === 0 && normalPreset.debug.pointer.listeners === 0 && normalPreset.bodyActive === false, normalPreset);
  pass('ordinary preset selection restores the normal particle pipeline and truthful toast', normalPreset.particles === true && /视觉预设/.test(normalPreset.toast || ''), normalPreset);
}

async function cleanup() {
  if (cdp) {
    try {
      await cdp.evaluate(`(()=>{const a=window.__lfV1144EchoAudio;if(a)a.pause();const u=window.__lfV1144EchoUrl;if(u)URL.revokeObjectURL(u);if(window.__lfV1144EchoOriginalAudio)window.audio=window.__lfV1144EchoOriginalAudio;return true;})()`);
    } catch (_) {}
    cdp.close();
  }
  if (app && !app.killed) {
    try { app.kill(); } catch (_) {}
    await delay(700);
  }
}

(async () => {
  let failure = null;
  try {
    staticChecks();
    await startApp();
    await exercise();
    pass('renderer emitted no uncaught exceptions', rendererErrors.length === 0, rendererErrors);
    pass('renderer emitted no console errors', consoleErrors.length === 0, consoleErrors);
  } catch (error) {
    failure = { message:String(error && error.message || error), stack:String(error && error.stack || '') };
  } finally {
    await cleanup();
  }
  const result = {
    overall:failure ? 'FAIL' : 'PASS',
    mode:'SOURCE_ELECTRON_TARGETED',
    checks,
    checkCount:Object.keys(checks).length,
    rendererErrors,
    consoleErrors,
    screenshots,
    productSha256:{
      manager:fileSha256(path.join(repo, 'public', 'lumifield-audio-echo.js')),
      shape1:fileSha256(path.join(repo, 'public', 'lf-audio-echo-shape1.js')),
      shape2:fileSha256(path.join(repo, 'public', 'lf-audio-echo-shape2.js')),
      task13:fileSha256(path.join(repo, 'public', 'lumifield-task13.js')),
      index:fileSha256(path.join(repo, 'public', 'index.html'))
    },
    failure,
    appLog
  };
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));
  process.stdout.write(`${JSON.stringify({ overall:result.overall, checkCount:result.checkCount, evidenceDir, failure }, null, 2)}\n`);
  if (failure) process.exitCode = 1;
})();
