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
const evidenceDir = path.join(repo, 'test-results', 'lf-v1144-8-preset-isolation', runId);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-v1144-8-'));
const checks = {};
const rendererErrors = [];
const consoleErrors = [];
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
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}
async function waitFor(fn, timeout = 30000, interval = 60) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeout) {
    try { last = await fn(); if (last) return last; } catch (error) { last = String(error && error.message || error); }
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
  close() { try { this.ws.close(); } catch (_) {} }
}

function section(source, startText, endText) {
  const start = source.indexOf(startText);
  assert.ok(start >= 0, `missing ${startText}`);
  const end = source.indexOf(endText, start + startText.length);
  return source.slice(start, end < 0 ? source.length : end);
}

function staticChecks() {
  const index = fs.readFileSync(path.join(repo, 'public', 'index.html'), 'utf8');
  const task13 = fs.readFileSync(path.join(repo, 'public', 'lumifield-task13.js'), 'utf8');
  const schema = fs.readFileSync(path.join(repo, 'public', 'lumifield-preset-schema.js'), 'utf8');
  const presetBlock = section(index, 'function deepFreezePresetDefault', 'var presetIcons =');
  const activateBlock = section(index, 'function setPreset(p, opts)', 'function syncFxUniforms');
  const migrationBlock = section(task13, 'function retireRemovedParticlePresets()', 'function installTransactionalImport()');
  const refreshBlock = section(task13, 'function refreshCoreVisuals(core)', 'function applyGlassPatch');
  pass('immutablePresetDefaults is recursively frozen and activated through a clone factory', /immutablePresetDefaults = deepFreezePresetDefault/.test(presetBlock) && /createBuiltInPresetRuntimeState/.test(presetBlock) && /clonePresetDefaultValue/.test(presetBlock), true);
  pass('every built-in activation consumes only its independent renderer and camera state', /var runtimeState = createBuiltInPresetRuntimeState\(p\)/.test(activateBlock) && /activeBuiltInPresetRuntimeState = runtimeState/.test(activateBlock) && /runtimeState\.camera\.radius/.test(activateBlock), true);
  pass('normal preset activation does not write particle lyric typography or palette fields', !/fx\.(?:point|speed|twist|scatter|particleLyrics|lyricFont|lyricColor|visualTintColor)\s*=/.test(section(index, 'function setPreset(p, opts)', 'function restoreEmilyPresetAfterRetiredContamination')), true);
  pass('retired current presets route through the isolated Emily recovery transaction', /restoreRetiredEmily/.test(migrationBlock) && /currentRemoved && restoreBuiltInPresetAfterRetirement/.test(migrationBlock), true);
  pass('transaction refresh applies lyric palette typography desktop state and persistence before success', refreshBlock.indexOf('applySavedLyricPaletteState') < refreshBlock.lastIndexOf('return true') && refreshBlock.indexOf('refreshCurrentLyricStyle') < refreshBlock.lastIndexOf('return true'), true);
  pass('the removed Golden runtime preset remains absent', !fs.existsSync(path.join(repo, 'public', 'lf-golden-atomic-star-trail-preset.json')) && !/goldenStarTrailOrbitField/.test(index + task13 + schema) && !/LumiFieldCustomParticles/.test(index + task13 + schema), true);
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
    env:Object.assign({}, process.env, { NODE_PATH:dependencyRoot, LF_MASTER_TEST:'1', LUMIFIELD_SKIP_SPLASH:'1', ELECTRON_DISABLE_SECURITY_WARNINGS:'true' })
  });
  const collect = data => appLog.push(String(data));
  app.stdout.on('data', collect);
  app.stderr.on('data', collect);
  const target = await waitFor(async () => {
    const targets = await listTargets(port);
    return targets.find(item => item.type === 'page' && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?(?:index\.html)?$/i.test(item.url));
  }, 60000);
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await waitFor(() => cdp.evaluate(`document.readyState==='complete'&&!!window.LumiFieldBuiltInPresetIsolation&&!!window.LumiFieldTask13&&!!window.LumiFieldTask15&&typeof window.setPreset==='function'`), 60000);
  await delay(900);
}

async function exercise() {
  const factory = await cdp.evaluate(`(()=>{
    const api=window.LumiFieldBuiltInPresetIsolation;
    const defaults=api.getDefaults();
    const a=api.create(0),b=api.create(0);
    const before={radius:b.camera.radius,point:b.appearance.particles.point,font:b.appearance.lyrics.lyricFont};
    a.camera.radius=999;a.appearance.particles.point=7.7;a.appearance.lyrics.lyricFont='mutated';
    return {debug:api.getDebug(),rootFrozen:Object.isFrozen(defaults),entryFrozen:Object.isFrozen(defaults[0]),nestedFrozen:Object.isFrozen(defaults[0].appearance.lyrics),different:a!==b&&a.camera!==b.camera&&a.appearance!==b.appearance,before,after:{radius:b.camera.radius,point:b.appearance.particles.point,font:b.appearance.lyrics.lyricFont},defaultsAfter:{radius:defaults[0].camera.radius,point:defaults[0].appearance.particles.point,font:defaults[0].appearance.lyrics.lyricFont}};
  })()`);
  pass('all seven built-in defaults and their nested values are deeply frozen', factory.debug.count === 7 && factory.debug.deepFrozen && factory.rootFrozen && factory.entryFrozen && factory.nestedFrozen, factory);
  pass('two activations never share mutable camera particle or lyric state', factory.different && JSON.stringify(factory.before) === JSON.stringify(factory.after) && factory.defaultsAfter.radius === 6.6 && factory.defaultsAfter.point === 1 && factory.defaultsAfter.font === 'sans', factory);

  const cycles = await cdp.evaluate(`(()=>{
    const api=window.LumiFieldBuiltInPresetIsolation;
    const keys=['point','speed','twist','color','scatter','bgFade','bloomStrength','particleLyrics','lyricFont','lyricColorMode','lyricColor','lyricHighlightColor','visualTintColor','uiAccentColor','shelfSize','performanceQuality'];
    Object.assign(fx,{point:1.77,speed:.63,twist:.27,color:1.43,scatter:.19,bgFade:.31,bloomStrength:1.11,particleLyrics:true,lyricFont:'stone-song',lyricColorMode:'custom',lyricColor:'#345678',lyricHighlightColor:'#abcdef',visualTintColor:'#2468ac',uiAccentColor:'#13579b',shelfSize:1.31,performanceQuality:'eco'});
    const before=Object.fromEntries(keys.map(key=>[key,fx[key]]));
    const states=[];
    for(let i=0;i<10;i++){
      setPreset(0,{silent:true,noSave:true,preserveAudioEcho:true});
      const first=api.getDebug();
      setPreset(i%6+1,{silent:true,noSave:true,preserveAudioEcho:true});
      setPreset(0,{silent:true,noSave:true,preserveAudioEcho:true});
      const last=api.getDebug();
      states.push({first:first.activeState,last:last.activeState,serial:last.activationSerial,preset:fx.preset,uniform:uniforms.uPreset.value,camera:[orbit.userRadius,orbit.userPhi,orbit.userTheta]});
    }
    const after=Object.fromEntries(keys.map(key=>[key,fx[key]]));
    return {before,after,states};
  })()`);
  pass('Emily to every built-in and back for ten cycles preserves unrelated global lyric typography and palette state', JSON.stringify(cycles.before) === JSON.stringify(cycles.after), cycles);
  pass('all ten Emily returns are byte-consistent fresh runtime states with the original camera and uniform', cycles.states.every((state, index, list) => state.preset === 0 && state.uniform === 0 && JSON.stringify(state.camera) === JSON.stringify([6.6,.08,0]) && JSON.stringify(state.last) === JSON.stringify(list[0].last) && state.last !== state.first), cycles.states);

  const migrated = await cdp.evaluate(`(()=>{
    const presetId=['lf-gold','en-atomic-star-trail-free-orbit-v5.3.1'].join('');
    const name=['金色量子核心·中心结构特写','自由星轨粒子（中心球圆心缩放修正版）'].join('');
    const results=[];
    for(let i=0;i<10;i++){
      const scope=window.LumiFieldTask15.setTestUser('problem8-'+i);
      Object.assign(fx,{preset:3,intensity:1.3,cinemaShake:0,depth:3.15,point:1.42,speed:.82,twist:1.08,color:1,scatter:.31,bgFade:.018,bloomStrength:.3,floatLayer:true,cinema:true,edge:true,bloom:true,backCover:false,lyricGlow:false,lyricGlowBeat:false,lyricGlowParticles:false,particleLyrics:false,lyricGlowStrength:.81,lyricScale:.72,lyricOffsetX:1.2,lyricOffsetY:-.8,lyricOffsetZ:.9,lyricTiltX:31,lyricTiltY:-29,lyricCameraLock:true,lyricColorMode:'custom',lyricColor:'#ffd9a0',lyricHighlightMode:'custom',lyricHighlightColor:'#fff2d0',lyricGlowLinked:false,lyricGlowColor:'#ffaa00',lyricFont:'stone-song',lyricLetterSpacing:.15,lyricLineHeight:1.3,lyricWeight:500,visualTintMode:'custom',visualTintColor:'#ffd9a0',homeAccentColor:'#ffd9a0',visualIconColor:'#fff2d0',uiAccentColor:'#13579b',shelfSize:1.31,performanceQuality:'eco',cam:'gesture'});
      window.LumiFieldTask13.setLyricState({translate:true});
      const canonical={presetId,name,visual:{preset:3,intensity:1.3,cinemaShake:0,depth:3.15,visualTintMode:'custom',visualTintColor:'#ffd9a0',homeAccentColor:'#ffd9a0',visualIconColor:'#fff2d0'},particles:{point:1.42,speed:.82,twist:1.08,color:1,scatter:.31,bgFade:.018,bloomStrength:.3,floatLayer:true,cinema:true,edge:true,bloom:true,lyricGlow:false,lyricGlowBeat:false,lyricGlowParticles:false,particleLyrics:false},lyrics:{lyricGlowStrength:.81,lyricScale:.72,lyricOffsetX:1.2,lyricOffsetY:-.8,lyricOffsetZ:.9,lyricTiltX:31,lyricTiltY:-29,lyricCameraLock:true,lyricColorMode:'custom',lyricColor:'#ffd9a0',lyricHighlightMode:'custom',lyricHighlightColor:'#fff2d0',lyricGlowLinked:false,lyricGlowColor:'#ffaa00',lyricFont:'stone-song',lyricLetterSpacing:.15,lyricLineHeight:1.3,lyricWeight:500}};
      const root={schema:'lumifield-user-scoped-v1',version:1,scopes:{}};
      root.scopes[scope]={presets:{},archiveKeys:{}};root.scopes[scope].presets[presetId]=canonical;
      const current={schema:'lumifield-user-scoped-v1',version:1,scopes:{}};current.scopes[scope]=presetId;
      localStorage.setItem('lumifield-canonical-presets-v1',JSON.stringify(root));
      localStorage.setItem('lumifield-task13-current-preset-v1',JSON.stringify(current));
      const first=window.LumiFieldTask13.migrateRetiredPresets();
      const state={preset:fx.preset,intensity:fx.intensity,cinemaShake:fx.cinemaShake,depth:fx.depth,point:fx.point,speed:fx.speed,twist:fx.twist,color:fx.color,scatter:fx.scatter,bgFade:fx.bgFade,bloomStrength:fx.bloomStrength,floatLayer:fx.floatLayer,edge:fx.edge,bloom:fx.bloom,lyricGlow:fx.lyricGlow,lyricGlowBeat:fx.lyricGlowBeat,lyricGlowParticles:fx.lyricGlowParticles,particleLyrics:fx.particleLyrics,lyricGlowStrength:fx.lyricGlowStrength,lyricScale:fx.lyricScale,lyricOffsetX:fx.lyricOffsetX,lyricOffsetY:fx.lyricOffsetY,lyricOffsetZ:fx.lyricOffsetZ,lyricTiltX:fx.lyricTiltX,lyricTiltY:fx.lyricTiltY,lyricCameraLock:fx.lyricCameraLock,lyricColorMode:fx.lyricColorMode,lyricColor:fx.lyricColor,lyricHighlightMode:fx.lyricHighlightMode,lyricHighlightColor:fx.lyricHighlightColor,lyricGlowLinked:fx.lyricGlowLinked,lyricGlowColor:fx.lyricGlowColor,lyricFont:fx.lyricFont,lyricLetterSpacing:fx.lyricLetterSpacing,lyricLineHeight:fx.lyricLineHeight,lyricWeight:fx.lyricWeight,visualTintMode:fx.visualTintMode,visualTintColor:fx.visualTintColor,homeAccentColor:fx.homeAccentColor,visualIconColor:fx.visualIconColor};
      const layout=JSON.parse(localStorage.getItem('lumifield-lyric-layout-v1')||'{}');
      const currentAfter=JSON.parse(localStorage.getItem('lumifield-task13-current-preset-v1')||'{}');
      const canonicalAfter=JSON.parse(localStorage.getItem('lumifield-canonical-presets-v1')||'{}');
      const beforeSecond=JSON.stringify({state,layout,currentAfter,canonicalAfter});
      const second=window.LumiFieldTask13.migrateRetiredPresets();
      const afterSecond=JSON.stringify({state:{preset:fx.preset,intensity:fx.intensity,cinemaShake:fx.cinemaShake,depth:fx.depth,point:fx.point,speed:fx.speed,twist:fx.twist,color:fx.color,scatter:fx.scatter,bgFade:fx.bgFade,bloomStrength:fx.bloomStrength,floatLayer:fx.floatLayer,edge:fx.edge,bloom:fx.bloom,lyricGlow:fx.lyricGlow,lyricGlowBeat:fx.lyricGlowBeat,lyricGlowParticles:fx.lyricGlowParticles,particleLyrics:fx.particleLyrics,lyricGlowStrength:fx.lyricGlowStrength,lyricScale:fx.lyricScale,lyricOffsetX:fx.lyricOffsetX,lyricOffsetY:fx.lyricOffsetY,lyricOffsetZ:fx.lyricOffsetZ,lyricTiltX:fx.lyricTiltX,lyricTiltY:fx.lyricTiltY,lyricCameraLock:fx.lyricCameraLock,lyricColorMode:fx.lyricColorMode,lyricColor:fx.lyricColor,lyricHighlightMode:fx.lyricHighlightMode,lyricHighlightColor:fx.lyricHighlightColor,lyricGlowLinked:fx.lyricGlowLinked,lyricGlowColor:fx.lyricGlowColor,lyricFont:fx.lyricFont,lyricLetterSpacing:fx.lyricLetterSpacing,lyricLineHeight:fx.lyricLineHeight,lyricWeight:fx.lyricWeight,visualTintMode:fx.visualTintMode,visualTintColor:fx.visualTintColor,homeAccentColor:fx.homeAccentColor,visualIconColor:fx.visualIconColor},layout:JSON.parse(localStorage.getItem('lumifield-lyric-layout-v1')||'{}'),currentAfter:JSON.parse(localStorage.getItem('lumifield-task13-current-preset-v1')||'{}'),canonicalAfter:JSON.parse(localStorage.getItem('lumifield-canonical-presets-v1')||'{}')});
      results.push({scope,first,second,state,layout,lyricsVisible,translate:window.LumiFieldTask13.getState().lyrics.translate,uniform:uniforms.uPreset.value,camera:[orbit.userRadius,orbit.userPhi,orbit.userTheta],unrelated:{uiAccentColor:fx.uiAccentColor,shelfSize:fx.shelfSize,performanceQuality:fx.performanceQuality,cam:fx.cam},currentValue:currentAfter.scopes&&currentAfter.scopes[scope],remainingPreset:!!(canonicalAfter.scopes&&canonicalAfter.scopes[scope]&&canonicalAfter.scopes[scope].presets&&canonicalAfter.scopes[scope].presets[presetId]),idempotent:beforeSecond===afterSecond});
    }
    return results;
  })()`);
  const expected = {preset:0,intensity:.85,cinemaShake:.5,depth:1,point:1,speed:1,twist:0,color:1.1,scatter:0,bgFade:.2,bloomStrength:.62,floatLayer:false,edge:false,bloom:false,lyricGlow:true,lyricGlowBeat:true,lyricGlowParticles:false,particleLyrics:true,lyricGlowStrength:.28,lyricScale:1,lyricOffsetX:0,lyricOffsetY:0,lyricOffsetZ:0,lyricTiltX:0,lyricTiltY:0,lyricCameraLock:false,lyricColorMode:'auto',lyricColor:'#a9b8c8',lyricHighlightMode:'auto',lyricHighlightColor:'#fac900',lyricGlowLinked:true,lyricGlowColor:'#008aff',lyricFont:'sans',lyricLetterSpacing:0,lyricLineHeight:1,lyricWeight:900,visualTintMode:'auto',visualTintColor:'#9db8cf',homeAccentColor:'#ffffff',visualIconColor:'#ffffff'};
  pass('ten retired Golden fixtures restore the exact Emily particle lyric typography and palette baseline', migrated.length === 10 && migrated.every(item => JSON.stringify(item.state) === JSON.stringify(expected)), migrated);
  pass('retirement migration restores visible lyrics and the original Emily uniform and camera', migrated.every(item => item.lyricsVisible && item.translate && item.uniform === 0 && JSON.stringify(item.camera) === JSON.stringify([6.6,.08,0])), migrated);
  pass('retirement removes the obsolete active id and canonical record without resurrecting a runtime surface', migrated.every(item => item.first && item.first.restored && item.first.retired.currentRemoved && item.currentValue === '' && !item.remainingPreset), migrated);
  pass('unrelated shelf performance camera and UI preferences survive every recovery', migrated.every(item => JSON.stringify(item.unrelated) === JSON.stringify({uiAccentColor:'#13579b',shelfSize:1.31,performanceQuality:'eco',cam:'gesture'})), migrated);
  pass('the clean Emily layout is persisted and every migration is idempotent', migrated.every(item => item.layout.preset === 0 && item.layout.point === 1 && item.layout.lyricFont === 'sans' && item.layout.lyricColorMode === 'auto' && item.second && item.second.restored === false && item.idempotent), migrated);
}

async function cleanup() {
  if (cdp) cdp.close();
  if (app && !app.killed) { try { app.kill(); } catch (_) {} await delay(700); }
}

(async () => {
  let failure = null;
  try {
    staticChecks();
    if (process.env.LF_V1144_P8_STATIC_ONLY !== '1') {
      await startApp();
      await exercise();
      pass('renderer emitted no uncaught exceptions', rendererErrors.length === 0, rendererErrors);
      pass('renderer emitted no console errors', consoleErrors.length === 0, consoleErrors);
    }
  } catch (error) {
    failure = { message:String(error && error.message || error), stack:String(error && error.stack || '') };
  } finally {
    await cleanup();
  }
  const result = {
    overall:failure ? 'FAIL' : 'PASS',
    mode:process.env.LF_V1144_P8_STATIC_ONLY === '1' ? 'STATIC_ONLY' : 'SOURCE_ELECTRON_TARGETED',
    checks,
    checkCount:Object.keys(checks).length,
    rendererErrors,
    consoleErrors,
    productSha256:{
      index:fileSha256(path.join(repo, 'public', 'index.html')),
      task13:fileSha256(path.join(repo, 'public', 'lumifield-task13.js')),
      schema:fileSha256(path.join(repo, 'public', 'lumifield-preset-schema.js'))
    },
    failure,
    appLog
  };
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));
  process.stdout.write(`${JSON.stringify({overall:result.overall,checkCount:result.checkCount,evidenceDir,failure},null,2)}\n`);
  if (failure) process.exitCode = 1;
})();
