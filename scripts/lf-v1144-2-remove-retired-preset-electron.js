'use strict';

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const dependencyRoot = process.env.LF_DEPENDENCY_ROOT || path.join(repo, 'node_modules');
const electronExe = path.join(dependencyRoot, 'electron', 'dist', 'electron.exe');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.join(repo, 'test-results', 'lf-v1144-2-remove-retired-preset', runId);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-v1144-2-'));
const checks = {};
const rendererErrors = [];
const consoleErrors = [];
const appLog = [];
const screenshots = [];
let app = null;
let cdp = null;

fs.mkdirSync(evidenceDir, { recursive: true });

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
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
  let last;
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
        rendererErrors.push(detail.exception && detail.exception.description || detail.text || 'renderer exception');
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params && message.params.type === 'error') {
        consoleErrors.push((message.params.args || []).map(item => item.value || item.description || '').join(' '));
      }
    };
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
  }
  send(method, params, timeout = 30000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout ${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception && result.exceptionDetails.exception.description || result.exceptionDetails.text);
    return result.result && result.result.value;
  }
  async screenshot(name) {
    const result = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    const file = path.join(evidenceDir, name);
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    screenshots.push(file);
  }
  close() { try { this.ws.close(); } catch (_) {} }
}

function staticChecks() {
  const index = fs.readFileSync(path.join(repo, 'public', 'index.html'), 'utf8');
  const task13 = fs.readFileSync(path.join(repo, 'public', 'lumifield-task13.js'), 'utf8');
  const schemaSource = fs.readFileSync(path.join(repo, 'public', 'lumifield-preset-schema.js'), 'utf8');
  const css = fs.readFileSync(path.join(repo, 'public', 'lumifield-task13.css'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
  const schema = require(path.join(repo, 'public', 'lumifield-preset-schema.js'));
  const retiredAsset = ['lf-gold', 'en-atomic-star-trail-preset.json'].join('');
  const retiredRuntime = ['LumiField', 'CustomParticles'].join('');
  const retiredControls = ['lf-gold', 'en-dynamic-controls'].join('');
  const oldTest = ['lf-master-problem', '11-smoke.js'].join('');

  pass('retired manifest JSON is absent', !fs.existsSync(path.join(repo, 'public', retiredAsset)), retiredAsset);
  pass('retired implementation test is absent', !fs.existsSync(path.join(repo, 'scripts', oldTest)), oldTest);
  pass('retired package test entry is absent', !Object.keys(pkg.scripts || {}).some(key => /master-problem11/i.test(key)), Object.keys(pkg.scripts || {}));
  pass('retired renderer API and controls have no runtime entry', !index.includes(retiredRuntime) && !task13.includes(retiredRuntime) && !index.includes(retiredControls) && !task13.includes(retiredControls) && !css.includes(retiredControls), true);
  pass('3D playlist code has no dangling removed-transform variables', !/\b(?:openCustomUi|customUi)\b/.test(index), true);
  pass('custom particle modes and fields are no longer registered', Object.keys(schema.MODES).length === 0 && Object.keys(schema.MODE_FIELDS).length === 0 && !schema.FIELDS.particles.includes('custom'), { modes: schema.MODES, fields: schema.FIELDS.particles });
  pass('all seven built-in presets keep their stable indices', JSON.stringify(schema.BUILTIN_PRESETS) === JSON.stringify({
    emily:{index:0,name:'emily专辑封面'}, roller:{index:1,name:'滚筒'}, planet:{index:2,name:'星球'}, void:{index:3,name:'虚空'}, record:{index:4,name:'唱片'}, galaxy:{index:5,name:'星河'}, requiem:{index:6,name:'安魂'}
  }), schema.BUILTIN_PRESETS);
  pass('removed custom imports fail with the dedicated rejection code', (() => {
    try {
      schema.normalize({ type:schema.TYPE, schema:schema.SCHEMA, version:schema.VERSION, particles:{ custom:{ effectMode:['gold','enStarTrailOrbitField'].join('') } } }, { allowEmpty:true });
      return false;
    } catch (error) {
      return error && error.code === 'PRESET_SCHEMA_INVALID' && error.report && error.report.invalidFields.some(item => item.code === 'CUSTOM_PARTICLE_PRESET_REMOVED');
    }
  })(), true);
  pass('source retains only bounded retirement cleanup, not a renderer branch', /function retireRemovedParticlePresets\(\)/.test(task13) && !/GoldenAtomicStarTrailBuilder|CustomParticleModeDispatcher|CustomParticleMaterial/.test(task13) && !/goldenStarTrailOrbitField\s*:/.test(schemaSource), true);
}

async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return response.json();
}

async function startApp() {
  assert.ok(fs.existsSync(electronExe), `Electron not found: ${electronExe}`);
  const port = await freePort();
  app = spawn(electronExe, ['.', `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], {
    cwd: repo,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, {
      NODE_PATH: dependencyRoot,
      LF_MASTER_TEST: '1',
      LUMIFIELD_SKIP_SPLASH: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
    })
  });
  const collect = data => appLog.push(String(data));
  app.stdout.on('data', collect);
  app.stderr.on('data', collect);
  const target = await waitFor(async () => {
    const targets = await listTargets(port);
    return targets.find(item => item.type === 'page' && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?(?:index\.html)?$/i.test(item.url));
  }, 60000, 120);
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await waitFor(() => cdp.evaluate(`document.readyState==='complete' && !!window.LumiFieldCanonicalPresetSchema && !!window.LumiFieldTask15 && Array.isArray(window.presetMeta) && typeof window.setPreset==='function'`), 60000, 120);
}

async function exerciseRemoval() {
  const result = await cdp.evaluate(`(()=>{
    const oldId=['lf-gold','en-atomic-star-trail-free-orbit-v5.3.1'].join('');
    const oldName=['金色量子','自由星轨'].join('');
    const oldMode=['gold','enStarTrailOrbitField'].join('');
    const schema='lumifield-user-scoped-v1';
    const scope=window.LumiFieldTask15.setTestUser('v1144-feature2');
    const root=value=>({schema,version:1,scopes:{[scope]:value}});
    const canonical={version:1,presets:{[oldId]:{presetId:oldId,name:oldName,particles:{custom:{effectMode:oldMode}}}},archiveKeys:{legacy:oldId}};
    const imports={legacy:{presetId:oldId,parsed:{canonical:{presetId:oldId,name:oldName,particles:{custom:{effectMode:oldMode}}}}}};
    const archives=[{id:oldId,name:oldName,savedAt:1,snapshot:{particles:{custom:{effectMode:oldMode}}}}];
    const shares={version:1,byPreset:{[oldId]:{presetId:oldId,status:'active'}}};
    localStorage.setItem('lumifield-canonical-presets-v1',JSON.stringify(root(canonical)));
    localStorage.setItem('lumifield-task13-imports-v1',JSON.stringify(root(imports)));
    localStorage.setItem('lumifield-task13-current-preset-v1',JSON.stringify(root(oldId)));
    localStorage.setItem('lumifield-task13-particle-runtime-v1',JSON.stringify({active:true,mode:oldMode,presetId:oldId}));
    localStorage.setItem('lumifield-user-fx-archives-v1',JSON.stringify(root(archives)));
    localStorage.setItem('lumifield-preset-shares-v1',JSON.stringify(root(shares)));
    window.userFxArchives.length=0;
    window.userFxArchives.push(...archives);
    window.setPreset(6,{silent:true,noSave:true,skipTransition:true});
    const namesBefore=window.presetMeta.map(item=>item.name);
    window.LumiFieldTask15.setTestUser('v1144-feature2');
    const read=key=>{try{return JSON.parse(localStorage.getItem(key)||'null')}catch(_){return null}};
    const scoped=(key,fallback)=>{const value=read(key);return value&&value.scopes&&Object.prototype.hasOwnProperty.call(value.scopes,scope)?value.scopes[scope]:fallback};
    const canonicalAfter=scoped('lumifield-canonical-presets-v1',{});
    const importsAfter=scoped('lumifield-task13-imports-v1',{});
    const currentAfter=scoped('lumifield-task13-current-preset-v1',null);
    const archivesAfter=scoped('lumifield-user-fx-archives-v1',[]);
    const sharesAfter=scoped('lumifield-preset-shares-v1',{});
    let rejection=null;
    try {
      window.LumiFieldCanonicalPresetSchema.normalize({type:'lumifield-canonical-preset',schema:'lumifield-canonical-preset',version:1,particles:{custom:{effectMode:oldMode}}},{allowEmpty:true});
    } catch(error) {
      rejection={code:error.code,codes:(error.report&&error.report.invalidFields||[]).map(item=>item.code)};
    }
    const migrated={
      canonicalRemoved:!canonicalAfter.presets||!canonicalAfter.presets[oldId],
      archiveKeyRemoved:!canonicalAfter.archiveKeys||!canonicalAfter.archiveKeys.legacy,
      importRemoved:!importsAfter[oldId]&&!importsAfter.legacy,
      current:currentAfter,
      runtimeRemoved:localStorage.getItem('lumifield-task13-particle-runtime-v1')===null,
      archivesRemoved:Array.isArray(archivesAfter)&&archivesAfter.every(item=>item&&item.id!==oldId),
      liveArchivesRemoved:window.userFxArchives.every(item=>item&&item.id!==oldId),
      shareRemoved:!(sharesAfter.byPreset&&sharesAfter.byPreset[oldId]),
      preset:window.fx.preset,
      currentApi:window.LumiFieldCanonicalPresets.getCurrentPresetId(),
      rejection
    };
    const cards=[...document.querySelectorAll('#preset-grid .preset-card')].map(card=>({id:Number(card.dataset.preset),name:(card.querySelector('.pc-name')||{}).textContent||''}));
    const switchResults=[];
    for(let i=0;i<7;i++){
      const ok=window.setPreset(i,{silent:true,noSave:true,skipTransition:true});
      const active=[...document.querySelectorAll('#preset-grid .preset-card.active')].map(card=>Number(card.dataset.preset));
      switchResults.push({i,ok,fx:window.fx.preset,active});
    }
    return {
      scope,migrated,cards,switchResults,
      namesBefore,namesAfter:window.presetMeta.map(item=>item.name),
      customApi:typeof window.LumiFieldCustomParticles,
      customControls:document.querySelectorAll('#lf-golden-dynamic-controls,[data-custom-preset],.lf-custom-preset-card').length,
      modes:Object.keys(window.LumiFieldCanonicalPresetSchema.MODES),
      particleFields:window.LumiFieldCanonicalPresetSchema.FIELDS.particles
    };
  })()`);

  pass('removed preset is absent from runtime APIs, schema and DOM', result.customApi === 'undefined' && result.customControls === 0 && result.modes.length === 0 && !result.particleFields.includes('custom'), result);
  pass('legacy canonical, import, archive, share and runtime state are retired', result.migrated.canonicalRemoved && result.migrated.archiveKeyRemoved && result.migrated.importRemoved && result.migrated.runtimeRemoved && result.migrated.archivesRemoved && result.migrated.liveArchivesRemoved && result.migrated.shareRemoved, result.migrated);
  pass('legacy active id falls back to the default built-in preset', result.migrated.current === '' && result.migrated.currentApi === '' && result.migrated.preset === 0, result.migrated);
  pass('legacy custom imports are rejected rather than silently revived', result.migrated.rejection && result.migrated.rejection.code === 'PRESET_SCHEMA_INVALID' && result.migrated.rejection.codes.includes('CUSTOM_PARTICLE_PRESET_REMOVED'), result.migrated.rejection);
  pass('preset selector contains exactly the seven unchanged built-ins', result.cards.length === 7 && result.cards.map(card => card.id).sort().join(',') === '0,1,2,3,4,5,6' && JSON.stringify(result.namesBefore) === JSON.stringify(result.namesAfter), { cards:result.cards,namesBefore:result.namesBefore,namesAfter:result.namesAfter });
  pass('every built-in preset still activates independently', result.switchResults.every(item => item.ok === true && item.fx === item.i && item.active.length === 1 && item.active[0] === item.i), result.switchResults);

  await cdp.evaluate(`(()=>{
    const auth=document.getElementById('lf-auth-root');if(auth){auth.style.setProperty('display','none','important');auth.setAttribute('aria-hidden','true');}
    if(typeof window.toggleFxPanel==='function')window.toggleFxPanel(true);
    if(typeof window.setFxPanelTab==='function')window.setFxPanelTab('presets');
    window.setPreset(0,{silent:true,noSave:true,skipTransition:true});
    return true;
  })()`);
  await delay(750);
  await cdp.screenshot('01-seven-built-in-presets-only.png');
}

async function stopApp() {
  if (cdp) {
    try { await cdp.evaluate('window.close();true'); } catch (_) {}
    cdp.close();
  }
  if (app && app.pid && app.exitCode == null) await Promise.race([new Promise(resolve => app.once('exit', resolve)), delay(5000)]);
  if (app && app.pid && app.exitCode == null) spawnSync('taskkill', ['/pid', String(app.pid), '/t', '/f'], { windowsHide:true, stdio:'ignore' });
  try { fs.rmSync(userData, { recursive:true, force:true }); } catch (_) {}
}

async function run() {
  staticChecks();
  await startApp();
  await exerciseRemoval();
  pass('renderer errors are zero', rendererErrors.length === 0, rendererErrors);
  pass('console errors are zero', consoleErrors.length === 0, consoleErrors);
  const result = { ok:true, runId, evidenceDir, checks, screenshots, rendererErrors, consoleErrors };
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ok:true, evidenceDir, checkCount:Object.keys(checks).length, screenshots:screenshots.length }, null, 2));
}

run().catch(error => {
  const failure = { ok:false, runId, evidenceDir, checks, rendererErrors, consoleErrors, error:String(error && error.stack || error) };
  try { fs.writeFileSync(path.join(evidenceDir, 'failure.json'), JSON.stringify(failure, null, 2)); } catch (_) {}
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  try { fs.writeFileSync(path.join(evidenceDir, 'app.log'), appLog.join('')); } catch (_) {}
  await stopApp();
});
