'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const repo = path.resolve(__dirname, '..');
const dependencyRoot = process.env.LF_DEPENDENCY_ROOT || path.join(repo, 'node_modules');
const electronExe = path.join(dependencyRoot, 'electron', 'dist', 'electron.exe');
const snapshotFile = path.join(repo, 'docs', 'evidence', 'v1.1.44', 'preset-advanced-defaults-regression.json');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.join(repo, 'test-results', 'lf-v1144-10-preset-advanced-defaults', runId);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-v1144-10-'));
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
function pass(name, condition, detail) { assert.ok(condition, `${name}: ${JSON.stringify(detail)}`); checks[name] = detail == null ? true : detail; }
function section(source, startText, endText) {
  const start = source.indexOf(startText);
  assert.ok(start >= 0, `missing ${startText}`);
  const end = source.indexOf(endText, start + startText.length);
  return source.slice(start, end < 0 ? source.length : end);
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
async function waitFor(fn, timeout = 30000, interval = 60) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeout) {
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

function staticChecks() {
  const expectedIds = ['emily-cover','requiem','galaxy','record','planet','roller'];
  const snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
  pass('regression snapshot contains exactly the six requested particle presets',
    snapshot.presets.length === 6 && snapshot.presets.map(item => item.id).join('|') === expectedIds.join('|'), snapshot.presets);
  pass('regression snapshot pins original point and scatter values without guessed variants',
    snapshot.presets.every(item => item.point === 1 && item.scatter === 0), snapshot.presets);
  pass('regression snapshot pins the original repository commit blob and file digest',
    snapshot.primarySource.commit === '6b130103f759e5dcd1e133700071c8216b8fa5a6' &&
    snapshot.primarySource.gitBlobSha1 === 'da5e47b41475b4401c45eb6b25f0ff60f72addd2' &&
    snapshot.primarySource.fileSha256 === '78C6C7A760AC14326AF924A367A97DA94771A30E8072836F62B0745DAEABDFE2', snapshot.primarySource);

  const releaseSource = execFileSync('git', ['show', 'f20b09f:public/index.html'], { cwd:repo, encoding:'utf8', maxBuffer:8 * 1024 * 1024 });
  const releaseBlob = execFileSync('git', ['rev-parse', 'f20b09f:public/index.html'], { cwd:repo, encoding:'utf8' }).trim();
  const releasePreset = section(releaseSource, 'function setPreset(p, opts)', 'function syncFxUniforms');
  pass('frozen v1.1.43 Git history corroborates point 1 and scatter 0',
    /point:\s*1(?:\.0)?[^\n]*scatter:\s*0(?:\.0)?/.test(releaseSource) && releaseBlob === snapshot.corroboration[1].gitBlobSha1,
    {releaseBlob, expected:snapshot.corroboration[1].gitBlobSha1});
  pass('frozen history confirms preset selection never substituted per-preset advanced values',
    !/fx\.(?:point|scatter)\s*=/.test(releasePreset), true);

  const current = fs.readFileSync(path.join(repo, 'public', 'index.html'), 'utf8');
  const block = section(current, 'var ORIGINAL_PRESET_ADVANCED_DEFAULT_SOURCE', 'var presetIcons =');
  pass('runtime source lock is independent from mutable packaged defaults',
    /ORIGINAL_PRESET_ADVANCED_DEFAULTS/.test(block) && /presetDefaultFields\(PRESET_ISOLATED_PARTICLE_KEYS, originalAdvanced\)/.test(block), true);
  pass('runtime source identity matches the regression snapshot',
    block.includes(snapshot.primarySource.commit) && block.includes(snapshot.primarySource.gitBlobSha1) && block.includes(snapshot.primarySource.fileSha256), true);
  const snapshotText = fs.readFileSync(snapshotFile, 'utf8');
  pass('regression snapshot file is stable UTF-8 JSON', snapshotText.charCodeAt(0) !== 0xFEFF && /\r?\n$/.test(snapshotText), sha256(snapshotText));
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
  await waitFor(() => cdp.evaluate(`document.readyState==='complete'&&!!window.LumiFieldBuiltInPresetIsolation&&typeof window.setPreset==='function'`), 60000);
  await delay(500);
}

async function runtimeChecks() {
  const result = await cdp.evaluate(`(()=>{
    const api=LumiFieldBuiltInPresetIsolation;
    const ids=['emily-cover','requiem','galaxy','record','planet','roller'];
    const first=api.getOriginalAdvancedDefaults();
    first.presets['emily-cover'].point=9;
    first.source.commit='mutated';
    const second=api.getOriginalAdvancedDefaults();
    const defaults=api.getDefaults();
    const selected=ids.map(id=>{
      const entry=defaults.find(item=>item.id===id);
      return {id,point:entry&&entry.appearance.particles.point,scatter:entry&&entry.appearance.particles.scatter};
    });
    fx.point=1.73;fx.scatter=.23;syncFxUniforms();
    const sentinel={point:fx.point,scatter:fx.scatter,uPoint:uniforms.uPointScale.value,uScatter:uniforms.uScatter.value};
    const activations=[];
    [0,6,5,4,2,1].forEach(index=>{
      setPreset(index,{silent:true,noSave:true,skipTransition:true,preserveAudioEcho:true});
      const debug=api.getDebug();
      activations.push({index,activeIndex:debug.activeIndex,point:fx.point,scatter:fx.scatter,uPoint:uniforms.uPointScale.value,uScatter:uniforms.uScatter.value,activePoint:debug.activeState.appearance.particles.point,activeScatter:debug.activeState.appearance.particles.scatter});
    });
    return {version:api.version,second,selected,sentinel,activations,deepFrozen:api.getDebug().deepFrozen};
  })()`);
  pass('runtime exposes a defensive source-locked snapshot',
    result.version === 2 && result.second.source.commit === '6b130103f759e5dcd1e133700071c8216b8fa5a6' && result.second.presets['emily-cover'].point === 1,
    {version:result.version, source:result.second.source});
  pass('all six runtime preset factories retain original point and scatter defaults',
    result.deepFrozen && result.selected.every(item => item.point === 1 && item.scatter === 0), result.selected);
  pass('switching all six presets preserves user advanced controls and uniforms',
    result.activations.every(item => item.point === result.sentinel.point && item.scatter === result.sentinel.scatter && item.uPoint === result.sentinel.uPoint && item.uScatter === result.sentinel.uScatter),
    result.activations);
  pass('each activation carries an independent original-default regression state',
    result.activations.every(item => item.activeIndex === item.index && item.activePoint === 1 && item.activeScatter === 0), result.activations);
  pass('renderer and console errors remain zero', rendererErrors.length === 0 && consoleErrors.length === 0, {rendererErrors,consoleErrors});
}

async function stopApp() {
  if (cdp) { cdp.close(); cdp = null; }
  if (app && !app.killed) {
    app.kill();
    await Promise.race([new Promise(resolve => app.once('exit', resolve)), delay(4000)]);
  }
  app = null;
}

(async () => {
  let error = null;
  try {
    staticChecks();
    await startApp();
    await runtimeChecks();
  } catch (caught) {
    error = caught;
    process.exitCode = 1;
  } finally {
    await stopApp();
    const result = {
      task:'v1.1.44-problem-10',
      status:error ? 'FAIL' : 'PASS',
      checks,
      checkCount:Object.keys(checks).length,
      rendererErrors,
      consoleErrors,
      snapshotSha256:fs.existsSync(snapshotFile) ? sha256(fs.readFileSync(snapshotFile)) : null,
      appLog,
      error:error ? String(error.stack || error) : null
    };
    fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));
    process.stdout.write(`${JSON.stringify({status:result.status,checkCount:result.checkCount,evidenceDir}, null, 2)}\n`);
  }
})();
