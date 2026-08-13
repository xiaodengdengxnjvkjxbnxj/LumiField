'use strict';

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const electron = require('electron');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.resolve(process.env.LF_PROBLEM13_OUT || path.join(repo, 'test-results', 'lf-problem13-smoke', runId));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-problem13-'));
const schemaFile = path.join(repo, 'public', 'lumifield-preset-schema.js');
const checks = {};
const screenshots = [];
const rendererErrors = [];
const appLog = [];
let app = null;
let cdp = null;
let origin = '';

fs.mkdirSync(evidenceDir, { recursive: true });

function pass(name, condition, details) {
  assert.ok(condition, name + (details == null ? '' : ': ' + JSON.stringify(details)));
  checks[name] = details == null ? true : details;
  return details;
}
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
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
async function waitFor(fn, timeout = 30000, interval = 120) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try { last = await fn(); if (last) return last; } catch (_) {}
    await delay(interval);
  }
  throw new Error('Timed out after ' + timeout + 'ms; last=' + JSON.stringify(last));
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
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result || {});
      } else if (message.method === 'Runtime.exceptionThrown') {
        const detail = message.params && message.params.exceptionDetails || {};
        rendererErrors.push(String(detail.exception && detail.exception.description || detail.text || 'Renderer exception').slice(0, 1800));
      }
    };
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
    await this.send('DOM.enable');
    await this.send('Page.bringToFront');
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (response.exceptionDetails) {
      const exception = response.exceptionDetails.exception || {};
      throw new Error(exception.description || response.exceptionDetails.text || 'Runtime.evaluate failed');
    }
    return response.result ? response.result.value : undefined;
  }
  call(fn, args) { return this.evaluate('(' + fn.toString() + ').apply(null,' + JSON.stringify(args || []) + ')'); }
  close() { try { this.ws.close(); } catch (_) {} }
}

async function findMainTarget(port) {
  return waitFor(async () => {
    const response = await fetch('http://127.0.0.1:' + port + '/json/list');
    const targets = await response.json();
    return targets.find(target => target.type === 'page' && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//.test(target.url)) || null;
  }, 45000, 200);
}
async function pageWait(fn, args, timeout) { return waitFor(() => cdp.call(fn, args).then(Boolean), timeout || 30000, 100); }
async function screenshot(name) {
  const response = await cdp.send('Page.captureScreenshot', { format:'png', fromSurface:true, captureBeyondViewport:false });
  const file = path.join(evidenceDir, name + '.png');
  fs.writeFileSync(file, Buffer.from(response.data, 'base64'));
  screenshots.push(file);
  return file;
}

function shuffledObject(value, reverse) {
  if (Array.isArray(value)) return value.map(item => shuffledObject(item, reverse));
  if (!value || typeof value !== 'object') return value;
  const entries = Object.keys(value).sort().map(key => [key, shuffledObject(value[key], reverse)]);
  if (reverse) entries.reverse();
  return Object.fromEntries(entries);
}
function normalizeOutcome(result) {
  if (result && result.ok === false) return result;
  const canonical = result && (result.canonical || result.preset || result.value || result.data) || result;
  const diagnostics = result && (result.diagnostics || result.report) || {};
  return {
    ok: !result || result.ok !== false,
    canonical,
    appliedFields: result && (result.appliedFields || result.applied) || diagnostics.appliedFields || diagnostics.applied || [],
    ignoredFields: result && (result.ignoredFields || result.ignored) || diagnostics.ignoredFields || diagnostics.ignored || [],
    invalidFields: result && (result.invalidFields || result.invalid) || diagnostics.invalidFields || diagnostics.invalid ||
      ((result && result.ignoredFields) || diagnostics.ignoredFields || diagnostics.ignored || []).filter(item =>
        /invalid|无效|鏃犳晥/i.test(String(item && item.reason || ''))),
  };
}
function fieldNames(values) {
  return (Array.isArray(values) ? values : []).map(value => typeof value === 'string' ? value :
    String(value.sourcePath || value.canonicalPath || value.path || value.field || value.key || '')).filter(Boolean);
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  Object.keys(value).sort().forEach(key => {
    if (!/^(?:exportedAt|updatedAt|savedAt|createdAt)$/i.test(key)) out[key] = stable(value[key]);
  });
  return out;
}

function staticAudit() {
  pass('canonical schema module exists', fs.existsSync(schemaFile), schemaFile);
  delete require.cache[require.resolve(schemaFile)];
  const schema = require(schemaFile);
  pass('node schema exposes constants and pure APIs', schema && schema.TYPE && schema.SCHEMA && Number.isFinite(Number(schema.VERSION)) &&
    typeof schema.parse === 'function' && typeof schema.normalize === 'function' && typeof schema.serialize === 'function' &&
    typeof schema.sanitizeForShare === 'function' && schema.FIELDS && typeof schema.FIELDS === 'object', {
    type:schema && schema.TYPE, schema:schema && schema.SCHEMA, version:schema && schema.VERSION,
  });

  const canonicalFixture = {
    type:schema.TYPE, schema:schema.SCHEMA, version:schema.VERSION,
    presetId:'lf-problem13-order-stable', name:'字段顺序测试',
    visual:{ intensity:1.31, depth:1.42, visualTintColor:'#123456' },
    particles:{ point:1.37, speed:.83 },
    lyrics:{ mode:'animation', translate:true },
    spectrum:{ enabled:true, mode:3, bandCount:73, colorA:'#11aaff', colorB:'#ee55cc' },
    echo:{ enabled:false, precision:.91, strength:1.24, range:.68 },
  };
  const orderedA = normalizeOutcome(schema.normalize(shuffledObject(canonicalFixture, false), { fileName:'ordered-a.json' }));
  const orderedB = normalizeOutcome(schema.normalize(shuffledObject(canonicalFixture, true), { fileName:'ordered-b.json' }));
  pass('canonical normalization is independent of JSON field order', orderedA.ok && orderedB.ok &&
    JSON.stringify(stable(orderedA.canonical)) === JSON.stringify(stable(orderedB.canonical)), {
    a:stable(orderedA.canonical), b:stable(orderedB.canonical),
  });

  const legacy = {
    schema:1, id:'lf-problem13-legacy-stable', title:'旧版迁移与别名',
    fx:{ intensity:1.27, depth:1.36 },
    spectrum:{ shape:'three', barCount:61, color1:'#22bbff', color2:'#ff66cc', symmetric:false, glass:false },
    echo:{ precision:.87, visualEQ:[.5,.6,.7,.8,.9,1,1.1,1.2], accent:'#abcdef', strength:1.33, range:.64 },
    unknownLegacyBlock:{ retainedOnlyAsDiagnostic:true },
  };
  const migrated = normalizeOutcome(schema.normalize(legacy, { fileName:'legacy.json' }));
  const migratedJson = JSON.stringify(migrated.canonical || {});
  pass('legacy schema and common aliases migrate to canonical fields', migrated.ok &&
    /lf-problem13-legacy-stable/.test(migratedJson) && /bandCount/.test(migratedJson) && /61/.test(migratedJson) &&
    /renderResolution/.test(migratedJson) && /visualEq/.test(migratedJson) && /accentColor/.test(migratedJson) &&
    !/visualEQ|barCount|color1|unknownLegacyBlock/.test(migratedJson), migrated);
  pass('unknown fields are listed without blocking recognized migration',
    fieldNames(migrated.ignoredFields).some(value => /unknownLegacyBlock/.test(value)) && /intensity/.test(migratedJson), migrated.ignoredFields);

  const invalid = normalizeOutcome(schema.normalize({
    type:schema.TYPE, schema:schema.SCHEMA, version:schema.VERSION, presetId:'lf-problem13-invalid-list', name:'invalid',
    visual:{ intensity:1.22, depth:'not-a-number', notAVisualField:123 },
    spectrum:{ bandCount:999, mode:2, colorA:'red' },
    echo:{ visualEq:'not-an-array' },
  }, { fileName:'invalid.json' }));
  const invalidNames = fieldNames(invalid.invalidFields);
  const ignoredNames = fieldNames(invalid.ignoredFields);
  pass('invalid and unknown fields have separate complete diagnostics while valid fields survive', invalid.ok &&
    invalidNames.some(value => /depth/.test(value)) && invalidNames.some(value => /mode/.test(value)) &&
    invalidNames.some(value => /colorA/.test(value)) && invalidNames.some(value => /visualEq/.test(value)) &&
    ignoredNames.some(value => /notAVisualField/.test(value)) && invalid.canonical.spectrum && invalid.canonical.spectrum.bandCount === 256 &&
    /1\.22/.test(JSON.stringify(invalid.canonical)), {
    invalid:invalidNames, ignored:ignoredNames, canonical:invalid.canonical,
  });

  const roundTripTextA = schema.serialize(orderedA.canonical, 2);
  const roundTripTextB = schema.serialize(normalizeOutcome(schema.parse(roundTripTextA, { fileName:'roundtrip.json' })).canonical, 2);
  pass('canonical serialize parse is deterministic and drift free', roundTripTextA === roundTripTextB, {
    bytes:Buffer.byteLength(roundTripTextA),
  });

  const dirty = Object.assign({}, orderedA.canonical, {
    metadata:{ author:'QA', accessToken:'SECRET_TOKEN_13', cookie:'SECRET_COOKIE_13', userId:'private-user-13',
      filePath:'C:\\Users\\private\\wallpaper.png' },
    wallpaper:{ opacity:.7, media:{ type:'image', src:'file:///C:/Users/private/wallpaper.png' } },
  });
  const sanitized = schema.sanitizeForShare(dirty);
  const sanitizedText = JSON.stringify(sanitized);
  pass('sanitizeForShare strips tokens cookies local paths identifiers and wallpaper source but keeps visual settings',
    !/SECRET_TOKEN_13|SECRET_COOKIE_13|private-user-13|Users[\\/]+private|file:\/\//i.test(sanitizedText) &&
      /intensity/.test(sanitizedText), sanitized);

  let malformedRejected = false;
  try { schema.parse('{"visual":', { fileName:'malformed.json' }); } catch (_) { malformedRejected = true; }
  let depthRejected = false;
  let nested = { leaf:true };
  for (let index = 0; index < 14; index++) nested = { nested };
  try { schema.normalize({ settings:nested }, { fileName:'too-deep.json' }); } catch (_) { depthRejected = true; }
  let oversizedRejected = false;
  try { schema.parse('{"padding":"' + 'x'.repeat(20 * 1024 * 1024) + '"}', { fileName:'oversized.json' }); } catch (_) { oversizedRejected = true; }
  pass('malformed excessive-depth and oversized preset inputs are rejected', malformedRejected && depthRejected && oversizedRejected,
    { malformedRejected, depthRejected, oversizedRejected });
  return { schema, canonicalFixture, legacy };
}

async function startApp() {
  const debugPort = await freePort();
  app = spawn(electron, ['.', '--user-data-dir=' + userData, '--remote-debugging-port=' + debugPort, '--remote-debugging-address=127.0.0.1'], {
    cwd:repo,
    env:Object.assign({}, process.env, {
      LF_ALLOW_LOCAL_CODES:'1', ELECTRON_DISABLE_SECURITY_WARNINGS:'true', LUMIFIELD_SKIP_SPLASH:'1',
      LF_MAIL_HOST:' ', LF_MAIL_USER:' ', LF_MAIL_PASSWORD:' ', LF_REMOTE_API_URL:' ',
    }),
    windowsHide:true,
    stdio:['ignore', 'pipe', 'pipe'],
  });
  const collect = chunk => {
    const value = String(chunk); appLog.push(value);
    if (/(?:FATAL|uncaught exception|renderer process crashed)/i.test(value)) rendererErrors.push(value.trim().slice(0, 1800));
  };
  app.stdout.on('data', collect); app.stderr.on('data', collect);
  const target = await findMainTarget(debugPort);
  origin = new URL(target.url).origin;
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await pageWait(function () {
    const schema = window.LumiFieldCanonicalPresetSchema;
    const api = window.LumiFieldCanonicalPresets;
    return document.readyState === 'complete' && schema && api && window.LumiFieldTask13 && window.fx &&
      typeof schema.normalize === 'function' && typeof api.preview === 'function' && typeof api.apply === 'function';
  }, [], 50000);
}

async function stopApp() {
  if (cdp) {
    try { await cdp.call(function () { window.close(); return true; }); } catch (_) {}
    cdp.close(); cdp = null;
  }
  if (app && app.pid && app.exitCode == null) {
    await Promise.race([
      new Promise(resolve => app.once('exit', resolve)),
      delay(5000),
    ]);
  }
  if (app && app.pid && app.exitCode == null) spawnSync('taskkill', ['/pid', String(app.pid), '/t', '/f'], { windowsHide:true, stdio:'ignore' });
  app = null;
  await delay(900);
}

async function run() {
  const fixtures = staticAudit();
  await startApp();

  const surface = await cdp.call(function () {
    const schema = window.LumiFieldCanonicalPresetSchema;
    const api = window.LumiFieldCanonicalPresets;
    return {
      schema:{ type:schema.TYPE, schema:schema.SCHEMA, version:schema.VERSION, fields:!!schema.FIELDS,
        methods:['parse','normalize','serialize','sanitizeForShare'].filter(key => typeof schema[key] === 'function') },
      api:['parse','normalize','preview','apply','capture','exportCurrent','exportPreset','sanitizeForShare','getCurrentPresetId','getArchiveCanonical','listArchives']
        .filter(key => typeof api[key] === 'function'),
    };
  });
  pass('renderer exposes complete canonical schema and application APIs', surface.schema.methods.length === 4 && surface.schema.fields &&
    ['parse','normalize','preview','apply','sanitizeForShare','getCurrentPresetId','listArchives'].every(key => surface.api.includes(key)) &&
    (surface.api.includes('capture') || surface.api.includes('exportCurrent')) && surface.api.includes('exportPreset'), surface);

  const preview = await cdp.call(function (input) {
    document.body.classList.remove('lf-auth-locked', 'empty-home-active', 'splash-active');
    const auth = document.getElementById('lf-auth-root');
    if (auth) { auth.classList.remove('show'); auth.style.setProperty('display', 'none', 'important'); }
    const splash = document.getElementById('splash'); if (splash) splash.style.display = 'none';
    const api = window.LumiFieldCanonicalPresets;
    const baseline = {
      intensity:window.fx.intensity,
      depth:window.fx.depth,
      spectrum:window.LumiFieldTask13.getState().spectrum,
    };
    const payload = {
      type:input.type, schema:input.schema, version:input.version, presetId:'lf-problem13-runtime-stable', name:'问题13真实应用',
      visual:{ intensity:1.29, depth:1.47, nonExistingVisualField:'ignored' },
      spectrum:{ enabled:true, mode:3, bandCount:67, colorA:'#12aaff', colorB:'#f05ac8' },
      echo:{ responseStrength:1.32, responseRange:.66 },
      privateToken:'DO_NOT_KEEP_13',
      wallpaper:{ opacity:.41, media:{ type:'image', src:'file:///C:/private/problem13.png' } },
    };
    const result = api.preview(payload, { fileName:'runtime.json' });
    const modal = document.getElementById('lf-t13-import-preview') || document.querySelector('[data-lf-canonical-preview]');
    const text = modal ? modal.innerText : '';
    const appliedRegion = modal && (modal.querySelector('[data-zone="applied"]') || modal.querySelector('.lf-canonical-applied') ||
      modal.querySelector('[data-lf-applied]') || modal.querySelector('.lf-t13-import-apply'));
    const ignoredRegion = modal && (modal.querySelector('[data-zone="ignored"]') || modal.querySelector('.lf-canonical-ignored') ||
      modal.querySelector('[data-lf-ignored]') || modal.querySelector('.lf-t13-import-ignore'));
    return {
      payload, result, baseline,
      after:{ intensity:window.fx.intensity, depth:window.fx.depth, spectrum:window.LumiFieldTask13.getState().spectrum },
      modal:{ exists:!!modal, visible:!!(modal && (modal.classList.contains('show') || getComputedStyle(modal).visibility !== 'hidden')),
        text, appliedRegion:!!appliedRegion, ignoredRegion:!!ignoredRegion },
    };
  }, [{ type:fixtures.schema.TYPE, schema:fixtures.schema.SCHEMA, version:fixtures.schema.VERSION }]);
  const previewJson = JSON.stringify(preview.result || {});
  pass('preview is side effect free and reports recognized and ignored fields', preview.baseline.intensity === preview.after.intensity &&
    preview.baseline.depth === preview.after.depth && JSON.stringify(preview.baseline.spectrum) === JSON.stringify(preview.after.spectrum) &&
    /intensity/.test(previewJson) && /nonExistingVisualField|privateToken|wallpaper/.test(previewJson), preview);
  pass('import preview UI has explicit apply and ignore regions with wallpaper default ignored', preview.modal.exists && preview.modal.visible &&
    preview.modal.appliedRegion && preview.modal.ignoredRegion && /intensity/.test(preview.modal.text) &&
    /nonExistingVisualField|privateToken/.test(preview.modal.text) && /wallpaper|壁纸/i.test(preview.modal.text), preview.modal);
  await screenshot('01-canonical-preview-apply-ignore-zones');

  const canceled = await cdp.call(function () {
    const api = window.LumiFieldCanonicalPresets;
    const before = { intensity:window.fx.intensity, depth:window.fx.depth, current:api.getCurrentPresetId(), archives:api.listArchives().length };
    const modal = document.getElementById('lf-t13-import-preview');
    const cancel = modal && modal.querySelector('[data-action="cancel"]');
    if (cancel) cancel.click();
    const after = { intensity:window.fx.intensity, depth:window.fx.depth, current:api.getCurrentPresetId(), archives:api.listArchives().length };
    return { before, after, hidden:!!(modal && !modal.classList.contains('show')) };
  });
  pass('canceling import preview has no visual archive or current-preset side effects', canceled.hidden &&
    JSON.stringify(canceled.before) === JSON.stringify(canceled.after), canceled);

  const applied = await cdp.call(async function (payload) {
    const api = window.LumiFieldCanonicalPresets;
    const modal = document.getElementById('lf-t13-import-preview') || document.querySelector('[data-lf-canonical-preview]');
    if (modal) {
      const close = modal.querySelector('[data-action="cancel"],.lf-t13-import-close,[data-action="close"]');
      if (close) close.click();
    }
    const before = { intensity:window.fx.intensity, depth:window.fx.depth, wallpaperOpacity:window.fx.backgroundOpacity };
    const result = await api.apply(payload, { createArchive:true, importWallpaper:false, source:'problem13-smoke' });
    const current = api.getCurrentPresetId();
    const archives = api.listArchives();
    const state = window.LumiFieldTask13.getState();
    const after = { intensity:window.fx.intensity, depth:window.fx.depth, wallpaperOpacity:window.fx.backgroundOpacity,
      spectrum:state.spectrum, echo:state.echo };
    return { result, before, after, current, archives };
  }, [preview.payload]);
  pass('recognized canonical fields are really applied and wallpaper remains opt-in', applied.result && applied.result.ok !== false &&
    Math.abs(applied.after.intensity - 1.29) < .001 && Math.abs(applied.after.depth - 1.47) < .001 &&
    applied.after.spectrum.bandCount === 67 && applied.after.spectrum.mode === 3 &&
    Math.abs(applied.after.echo.responseStrength - 1.32) < .001 && applied.after.wallpaperOpacity === applied.before.wallpaperOpacity, applied);
  pass('stable presetId becomes current and is saved exactly once in user archives', applied.current === 'lf-problem13-runtime-stable' &&
    Array.isArray(applied.archives) && applied.archives.filter(item => item && (item.presetId || item.id) === applied.current).length === 1, {
    current:applied.current, archives:applied.archives,
  });

  const reapplied = await cdp.call(async function (payload) {
    const api = window.LumiFieldCanonicalPresets;
    const result = await api.apply(payload, { createArchive:true, importWallpaper:false, source:'problem13-smoke-reimport' });
    const archives = api.listArchives();
    return { result, current:api.getCurrentPresetId(), archives,
      matching:archives.filter(item => item && item.presetId === payload.presetId).length };
  }, [preview.payload]);
  pass('reimporting the same stable presetId updates one archive instead of creating a random duplicate',
    reapplied.result && reapplied.current === preview.payload.presetId && reapplied.matching === 1, reapplied);

  const sparse = await cdp.call(async function (input) {
    const api = window.LumiFieldCanonicalPresets;
    const before = { intensity:window.fx.intensity, depth:window.fx.depth, point:window.fx.point, preset:window.fx.preset,
      spectrum:window.LumiFieldTask13.getState().spectrum };
    const result = await api.apply({ type:input.type, schema:input.schema, version:input.version,
      presetId:'lf-problem13-sparse', name:'稀疏预设', visual:{ intensity:1.16 } },
    { createArchive:true, importWallpaper:false, source:'problem13-smoke' });
    const after = { intensity:window.fx.intensity, depth:window.fx.depth, point:window.fx.point, preset:window.fx.preset,
      spectrum:window.LumiFieldTask13.getState().spectrum };
    return { result, before, after, current:api.getCurrentPresetId() };
  }, [{ type:fixtures.schema.TYPE, schema:fixtures.schema.SCHEMA, version:fixtures.schema.VERSION }]);
  pass('sparse import applies only explicitly present fields without built-in preset fallback', sparse.result && sparse.result.ok !== false &&
    Math.abs(sparse.after.intensity - 1.16) < .001 && sparse.after.depth === sparse.before.depth && sparse.after.point === sparse.before.point &&
    sparse.after.preset === sparse.before.preset &&
    JSON.stringify(sparse.after.spectrum) === JSON.stringify(sparse.before.spectrum) && sparse.current === 'lf-problem13-sparse', sparse);

  const rollback = await cdp.call(async function (input) {
    const api = window.LumiFieldCanonicalPresets;
    const before = { intensity:window.fx.intensity, preset:window.fx.preset, current:api.getCurrentPresetId(),
      archiveCount:api.listArchives().length, stored:localStorage.getItem('lumifield-task13-current-preset-v1') };
    const originalSetPreset = window.setPreset;
    window.setPreset = function () { throw new Error('LF_PROBLEM13_FORCED_TRANSACTION_FAILURE'); };
    let result, thrown = '';
    try {
      result = await api.apply({ type:input.type, schema:input.schema, version:input.version,
        presetId:'lf-problem13-must-rollback', name:'事务回滚', visual:{ intensity:1.55, preset:4 } },
      { createArchive:true, importWallpaper:false, source:'problem13-smoke' });
    } catch (error) { thrown = String(error && error.message || error); }
    window.setPreset = originalSetPreset;
    const after = { intensity:window.fx.intensity, preset:window.fx.preset, current:api.getCurrentPresetId(),
      archiveCount:api.listArchives().length, stored:localStorage.getItem('lumifield-task13-current-preset-v1') };
    return { before, after, result, thrown };
  }, [{ type:fixtures.schema.TYPE, schema:fixtures.schema.SCHEMA, version:fixtures.schema.VERSION }]);
  pass('apply failure rolls back visual state current preset persistence and archive atomically',
    rollback.before.intensity === rollback.after.intensity && rollback.before.preset === rollback.after.preset &&
    rollback.before.current === rollback.after.current && rollback.before.archiveCount === rollback.after.archiveCount &&
    rollback.before.stored === rollback.after.stored && (rollback.thrown || !rollback.result || rollback.result.ok === false), rollback);

  const exports = await cdp.call(function () {
    const api = window.LumiFieldCanonicalPresets;
    const id = api.getCurrentPresetId();
    const archive = api.listArchives().find(item => item && item.presetId === id);
    const first = api.exportPreset(archive && archive.index);
    const runtimeIntensity = window.fx.intensity;
    window.fx.intensity = runtimeIntensity === .23 ? .37 : .23;
    if (typeof window.syncFxUniforms === 'function') window.syncFxUniforms();
    const second = api.exportPreset(archive && archive.index);
    window.fx.intensity = runtimeIntensity;
    if (typeof window.syncFxUniforms === 'function') window.syncFxUniforms();
    const current = typeof api.exportCurrent === 'function' ? api.exportCurrent() : api.capture();
    const clean = api.sanitizeForShare(Object.assign({}, current, {
      accessToken:'SECRET_RUNTIME_TOKEN_13', cookie:'SECRET_RUNTIME_COOKIE_13', filePath:'C:\\Users\\private\\runtime.json',
      wallpaper:{ media:{ type:'image', src:'file:///C:/Users/private/runtime.png' } },
    }));
    return { id, archive, first, second, current, clean, runtimeIntensity };
  });
  pass('saved-state export is canonical deterministic and does not drift', exports.first && exports.second &&
    JSON.stringify(stable(exports.first)) === JSON.stringify(stable(exports.second)) &&
    exports.first.visual && Math.abs(exports.first.visual.intensity - exports.runtimeIntensity) < .001 &&
    JSON.stringify(exports.first).includes(exports.id), exports);
  pass('renderer sanitizeForShare removes runtime secrets and local sources',
    !/SECRET_RUNTIME|Users[\\/]+private|file:\/\//i.test(JSON.stringify(exports.clean)) && /intensity/.test(JSON.stringify(exports.clean)), exports.clean);
  await screenshot('02-canonical-applied-and-saved');

  const persisted = {
    current:applied.current,
    expectedSparseId:'lf-problem13-sparse',
    sparseIntensity:sparse.after.intensity,
    sparseDepth:sparse.after.depth,
  };
  const firstOrigin = origin;
  await stopApp();
  await startApp();
  const restored = await cdp.call(function () {
    const api = window.LumiFieldCanonicalPresets;
    const state = window.LumiFieldTask13.getState();
    const id = api.getCurrentPresetId();
    const archives = api.listArchives();
    const archive = archives.find(item => item && item.presetId === id);
    const canonical = api.getArchiveCanonical(archive && archive.index);
    return { id, archives, canonical, intensity:window.fx.intensity, depth:window.fx.depth, spectrum:state.spectrum };
  });
  pass('same Electron userData restores current preset and archive after a real process restart',
    restored.id === persisted.expectedSparseId && Array.isArray(restored.archives) &&
    restored.archives.some(item => item && (item.presetId || item.id) === restored.id) && restored.canonical &&
    Math.abs(restored.intensity - persisted.sparseIntensity) < .001 && Math.abs(restored.depth - persisted.sparseDepth) < .001, {
    firstOrigin, secondOrigin:origin, restored,
  });
  await screenshot('03-restart-restored-user-archive');

  pass('renderer has no uncaught exceptions', rendererErrors.length === 0, rendererErrors);
  const result = {
    ok:true,
    runId,
    mode:'Electron source + CDP problem 13 canonical schema, transaction and real restart persistence',
    origin,
    evidenceDir,
    userData,
    screenshots,
    checks,
    rendererErrors,
  };
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(evidenceDir, 'app.log'), appLog.join('').replace(/\b\d{6}\b/g, '[REDACTED_CODE]'));
  process.stdout.write(JSON.stringify(result) + '\n');
}

run().catch(error => {
  const failure = { ok:false, runId, origin, evidenceDir, error:String(error && error.stack || error), checks, screenshots, rendererErrors };
  try {
    fs.writeFileSync(path.join(evidenceDir, 'failure.json'), JSON.stringify(failure, null, 2));
    fs.writeFileSync(path.join(evidenceDir, 'app.log'), appLog.join('').replace(/\b\d{6}\b/g, '[REDACTED_CODE]'));
  } catch (_) {}
  console.error(failure.error);
  process.exitCode = 1;
}).finally(async () => {
  await stopApp();
  try { fs.rmSync(userData, { recursive:true, force:true }); } catch (_) {}
});
