'use strict';

const assert = require('assert').strict;
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const electron = require('electron');
const desktop = path.resolve(process.env.USERPROFILE || 'C:\\Users\\35992', 'Desktop');
const authorityDir = path.join(desktop, '文件13');
const schemaFile = path.join(repo, 'public', 'lumifield-preset-schema.js');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.resolve(process.env.LF_MASTER_PROBLEM11_OUT ||
  path.join(repo, 'test-results', 'lf-master-problem11-smoke', runId));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-master-problem11-'));
const checks = {};
const screenshots = [];
const rendererErrors = [];
const appLog = [];
const runtimeModes = [];
let app = null;
let cdp = null;
let origin = '';

const AUTHORITIES = [
  {
    order: 1,
    key: 'ring',
    fileName: 'GPT粒子预设_正圆光环白色粒子.json',
    bytes: 4779,
    sha256: '19A90BDE35653F6B171002AE0A2390D23B96C32DDF63A27F21A29FE95734E28A',
    mode: 'luminousOrbitVortex',
    discriminator: 'effectMode',
    targetParticleCount: 38216,
  },
  {
    order: 2,
    key: 'orbit',
    fileName: 'GPT粒子预设_白色正圆超大半径自由星轨粒子.json',
    bytes: 4581,
    sha256: '1390D334AFAFA010E13F67AD51A0722D1F76E4DF28DAE324007857C57C962501',
    mode: 'goldenStarTrailOrbitField',
    discriminator: 'effectMode',
    targetParticleCount: 47200,
  },
  {
    order: 3,
    key: 'tsunami',
    fileName: 'GPT海啸粒子预设1.json',
    bytes: 4417,
    sha256: '339FF921E1E78E617E8B6990A1441A6425FFE46BCA5573B37DE6240E32A8244C',
    mode: 'tsunamiCurl',
    discriminator: 'waveMode',
    targetParticleCount: 52000,
  },
];

const META_PATHS = new Set([
  'type', 'schema', 'version', 'presetId', 'name', 'title', 'appVersion', 'visualPresetSchema',
]);
const SUCCESS_STATUSES = new Set(['IMPLEMENTED_AND_RENDERED', 'IMPLEMENTED_STATE_ONLY', 'MIGRATED', 'METADATA_ONLY']);
const RENDERED_NAMESPACES = /^(?:visual|particles|camera)\./;
const STATE_NAMESPACES = /^(?:spectrum|echo|lyrics|player)\./;

fs.mkdirSync(evidenceDir, { recursive: true });

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function compactEvidence(value, depth = 0) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  if (value instanceof Error) {
    return compactEvidence({
      name: value.name,
      message: value.message,
      code: value.code,
      report: value.report,
    }, depth);
  }
  if (depth >= 5) {
    return Array.isArray(value) ? `[Array(${value.length})]` :
      `{Object(${Object.keys(value).length})}`;
  }
  if (Array.isArray(value)) {
    const compact = value.slice(0, 16).map(item => compactEvidence(item, depth + 1));
    if (value.length > 16) compact.push({ truncatedItems: value.length - 16 });
    return compact;
  }
  if (typeof value === 'object') {
    const result = {};
    const keys = Object.keys(value);
    keys.slice(0, 48).forEach(key => { result[key] = compactEvidence(value[key], depth + 1); });
    if (keys.length > 48) result.__truncatedKeys = keys.length - 48;
    return result;
  }
  return String(value);
}

function pass(name, condition, details) {
  const compact = details == null ? true : compactEvidence(details);
  assert.ok(condition, `${name}${details == null ? '' : `: ${JSON.stringify(compact)}`}`);
  checks[name] = compact;
  return details;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  Object.keys(value).sort().forEach(key => {
    if (!/^(?:createdAt|updatedAt|savedAt|exportedAt|appliedAt|capturedAt)$/i.test(key)) {
      result[key] = stable(value[key]);
    }
  });
  return result;
}

function deepEqual(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function getPath(value, fieldPath) {
  return String(fieldPath || '').split('.').reduce((current, key) =>
    current == null ? undefined : current[key], value);
}

function fieldValueEqual(left, right) {
  if (typeof left === 'string' && typeof right === 'string' &&
      /^#[0-9a-f]{6}$/i.test(left) && /^#[0-9a-f]{6}$/i.test(right)) {
    return left.toLowerCase() === right.toLowerCase();
  }
  return deepEqual(left, right);
}

function flattenLeaves(value, prefix = '', result = []) {
  if (Array.isArray(value) || value == null || typeof value !== 'object') {
    if (prefix) result.push({ path: prefix, value: clone(value) });
    return result;
  }
  Object.keys(value).forEach(key => {
    flattenLeaves(value[key], prefix ? `${prefix}.${key}` : key, result);
  });
  return result;
}

function reportOf(result) {
  return result && (result.report || result.diagnostics) || result || {};
}

function canonicalOf(result) {
  return result && (result.canonical || result.value || result.preset || result.data) || result;
}

function listOf(report, ...keys) {
  for (const key of keys) {
    if (Array.isArray(report && report[key])) return report[key];
  }
  return [];
}

function rowPath(row) {
  if (typeof row === 'string') return row;
  return String(row && (row.canonicalPath || row.sourcePath || row.path || row.field || row.key) || '');
}

function rowStatus(row) {
  return String(row && (row.consumptionStatus || row.status || row.state || row.result) || '').toUpperCase();
}

function matrixRows(report) {
  const value = report && (report.fieldMatrix || report.fieldConsumption || report.consumedFields);
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    return Object.keys(value).map(key => {
      const row = value[key];
      return row && typeof row === 'object' ? Object.assign({ canonicalPath: key }, row) :
        { canonicalPath: key, consumptionStatus: row };
    });
  }
  return [];
}

function diagnosticText(value) {
  try { return JSON.stringify(value); } catch (_) { return String(value); }
}

function assertPreservedFields(authority, canonical) {
  const lost = [];
  flattenLeaves(authority.raw).forEach(entry => {
    const actual = getPath(canonical, entry.path);
    if (!fieldValueEqual(actual, entry.value)) {
      lost.push({ path: entry.path, expected: entry.value, actual });
    }
  });
  pass(`${authority.key}: every source leaf survives normalization without value drift`, lost.length === 0, lost);
}

function assertFieldMatrix(authority, report) {
  const rows = matrixRows(report);
  const byPath = new Map();
  rows.forEach(row => {
    const fieldPath = rowPath(row);
    if (fieldPath) byPath.set(fieldPath, row);
  });
  const required = flattenLeaves(authority.raw)
    .map(entry => entry.path)
    .filter(fieldPath => !META_PATHS.has(fieldPath));
  const missing = required.filter(fieldPath => !byPath.has(fieldPath));
  const failed = required.map(fieldPath => {
    const row = byPath.get(fieldPath);
    return { path: fieldPath, status: rowStatus(row), consumer: row && row.consumer };
  }).filter(entry => !SUCCESS_STATUSES.has(entry.status));
  const notRendered = required.map(fieldPath => {
    const row = byPath.get(fieldPath);
    return { path: fieldPath, status: rowStatus(row), consumer: row && row.consumer };
  }).filter(entry => RENDERED_NAMESPACES.test(entry.path) && entry.status !== 'IMPLEMENTED_AND_RENDERED');
  const stateFailures = required.map(fieldPath => {
    const row = byPath.get(fieldPath);
    return { path: fieldPath, status: rowStatus(row), consumer: row && row.consumer };
  }).filter(entry => STATE_NAMESPACES.test(entry.path) &&
    entry.status !== 'IMPLEMENTED_AND_RENDERED' && entry.status !== 'IMPLEMENTED_STATE_ONLY');
  pass(`${authority.key}: field matrix covers every non-metadata source leaf`, missing.length === 0, {
    required: required.length,
    matrix: rows.length,
    missing,
  });
  pass(`${authority.key}: field matrix has no unsupported invalid ignored or metadata visual field`,
    failed.length === 0 && notRendered.length === 0 && stateFailures.length === 0,
    { failed, notRendered, stateFailures });
}

function assertTopology(authority, raw) {
  const custom = raw.particles.custom;
  if (authority.key === 'ring') {
    const arrays = ['ringRadii', 'ringThickness', 'ringSpeeds', 'ringVerticalWave', 'ringDensity'];
    pass('ring static topology has four aligned rings',
      custom.ringCount === 4 && arrays.every(key => Array.isArray(custom[key]) && custom[key].length === 4), {
        ringCount: custom.ringCount,
        lengths: Object.fromEntries(arrays.map(key => [key, custom[key] && custom[key].length])),
      });
    pass('ring static topology preserves alternating signed speeds',
      custom.ringSpeeds.join(',') === '-0.18,0.135,-0.095,0.06', custom.ringSpeeds);
    const allocation = Object.values(custom.particleAllocation).reduce((sum, value) => sum + value, 0);
    pass('ring allocation equals requested target exactly',
      allocation === authority.targetParticleCount && allocation === custom.particleCount, {
        allocation,
        target: authority.targetParticleCount,
        parts: custom.particleAllocation,
      });
    pass('ring static center is explicitly and completely clear',
      custom.coreEnabled === false && custom.coreRadius === 0 && custom.coreParticleCount === 0 &&
      custom.innerCrownEnabled === false && custom.centerParticlesEnabled === false &&
      custom.centerFilledDiskEnabled === false && custom.centerVoidEnabled === true &&
      custom.forceCenterClear === true && custom.centralConeEnabled === false &&
      custom.removeCentralCone === true, custom);
  } else if (authority.key === 'orbit') {
    const arrays = ['orbitRadii', 'orbitEccentricity', 'orbitSpeeds', 'orbitTilts'];
    pass('orbit static topology has six aligned circular trails',
      custom.orbitTrailCount === 6 && arrays.every(key => Array.isArray(custom[key]) && custom[key].length === 6) &&
      custom.orbitEccentricity.every(value => value === 1) &&
      custom.orbitTilts.every(value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)), {
        orbitTrailCount: custom.orbitTrailCount,
        lengths: Object.fromEntries(arrays.map(key => [key, custom[key] && custom[key].length])),
      });
    pass('orbit static topology preserves signed speeds and mixed unbounded zoom tuple',
      custom.orbitSpeeds.some(value => value < 0) && custom.orbitSpeeds.some(value => value > 0) &&
      deepEqual(custom.zoomRange, [0.03, 'unbounded']) && custom.zoomInfiniteIn === true,
      { orbitSpeeds: custom.orbitSpeeds, zoomRange: custom.zoomRange });
    pass('orbit static core outer arc and background stars are real allocations',
      custom.coreEnabled === true && custom.coreLoopCount === 8 && custom.coreParticleCount === 8000 &&
      custom.outerArcEnabled === true && custom.backgroundStarsEnabled === true &&
      custom.backgroundStarCount === 2200 && custom.particleCount === authority.targetParticleCount, custom);
    pass('orbit nested white-gray palette is preserved as an object',
      deepEqual(custom.palette, {
        shadow: '#BFC1C5', warm: '#D8D9DC', gold: '#ECEDEF', bright: '#F8F8F8', core: '#FFFFFF',
      }), custom.palette);
  } else {
    const arrays = [
      'rowSpeedMultipliers', 'mainCrestSpeedMultipliers', 'subCrestSpeedMultipliers',
      'mainCrestDirections', 'subCrestDirections',
    ];
    pass('tsunami static topology is five logical rows and ten physical crest bands',
      custom.logicalRowCount === 5 && custom.multiCrestCount === 5 &&
      custom.subRowsPerLogicalRow === 2 && custom.physicalCrestBandCount === 10 &&
      arrays.every(key => Array.isArray(custom[key]) && custom[key].length === 5), {
        logicalRowCount: custom.logicalRowCount,
        physicalCrestBandCount: custom.physicalCrestBandCount,
        lengths: Object.fromEntries(arrays.map(key => [key, custom[key] && custom[key].length])),
      });
    pass('tsunami static topology preserves explicit zero false and opposing signed directions',
      custom.valleyDepth === 0 && custom.doubleTrackEnabled === false &&
      deepEqual(custom.mainCrestDirections, [1, -1, 1, -1, 1]) &&
      deepEqual(custom.subCrestDirections, [-1, 1, -1, 1, -1]) &&
      custom.independentMainSubTime === true && custom.independentMainSubDirection === true &&
      custom.independentMainSubPhase === true && custom.independentMainSubWavelength === true,
      custom);
    pass('tsunami requested target is exact', custom.particleCount === authority.targetParticleCount,
      custom.particleCount);
  }
}

function walkJsonFiles(root) {
  const result = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (_) { continue; }
    entries.forEach(entry => {
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) stack.push(full);
      else if (entry.isFile() && /\.json$/i.test(entry.name)) result.push(full);
    });
  }
  return result;
}

function loadAuthorities() {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const authorities = AUTHORITIES.map(definition => {
    const filePath = path.join(authorityDir, definition.fileName);
    const bytes = fs.readFileSync(filePath);
    pass(`${definition.key}: exact authority file exists`, fs.existsSync(filePath), filePath);
    pass(`${definition.key}: exact byte length`, bytes.length === definition.bytes, {
      expected: definition.bytes,
      actual: bytes.length,
    });
    pass(`${definition.key}: exact SHA-256`, sha256(bytes) === definition.sha256, {
      expected: definition.sha256,
      actual: sha256(bytes),
    });
    pass(`${definition.key}: UTF-8 has no BOM`,
      !(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf), Array.from(bytes.subarray(0, 3)));
    let text = '';
    let raw = null;
    let utf8Error = null;
    let jsonError = null;
    try { text = decoder.decode(bytes); } catch (error) { utf8Error = String(error && error.message || error); }
    try { raw = JSON.parse(text); } catch (error) { jsonError = String(error && error.message || error); }
    pass(`${definition.key}: strict UTF-8 decode`, !utf8Error, utf8Error);
    pass(`${definition.key}: JSON syntax`, !!raw && !jsonError, jsonError);
    pass(`${definition.key}: exact mode and target are declared`,
      getPath(raw, `particles.custom.${definition.discriminator}`) === definition.mode &&
      getPath(raw, 'particles.custom.particleCount') === definition.targetParticleCount, {
        mode: getPath(raw, `particles.custom.${definition.discriminator}`),
        target: getPath(raw, 'particles.custom.particleCount'),
      });
    assertTopology(definition, raw);
    return Object.assign({}, definition, { filePath, text, raw });
  });

  const desktopJson = walkJsonFiles(desktop);
  authorities.forEach(authority => {
    const copies = desktopJson.filter(candidate => {
      let stat;
      try { stat = fs.statSync(candidate); } catch (_) { return false; }
      if (stat.size !== authority.bytes && path.basename(candidate) !== authority.fileName) return false;
      try { return sha256(fs.readFileSync(candidate)) === authority.sha256; } catch (_) { return false; }
    });
    const sameNames = desktopJson.filter(candidate => path.basename(candidate) === authority.fileName);
    pass(`${authority.key}: no renamed hash duplicate on Desktop`, copies.length === 1 &&
      path.resolve(copies[0]) === path.resolve(authority.filePath), copies);
    pass(`${authority.key}: no same-name suffix or duplicate on Desktop`, sameNames.length === 1 &&
      path.resolve(sameNames[0]) === path.resolve(authority.filePath), sameNames);
  });
  return authorities;
}

function expectSchemaRejected(schema, fixture, label, patterns) {
  let normalizeError = null;
  try { schema.normalize(fixture, { fileName: `${label}.json` }); } catch (error) { normalizeError = error; }
  pass(`${label}: normalize rejects invalid authority topology`, !!normalizeError, normalizeError && normalizeError.message);
  const errorText = diagnosticText(normalizeError && (normalizeError.report || normalizeError));
  pass(`${label}: rejection identifies exact conflicting field paths`,
    patterns.every(pattern => pattern.test(errorText)), { patterns: patterns.map(String), errorText });
  if (typeof schema.preflight === 'function') {
    const result = schema.preflight(fixture, { fileName: `${label}.json` });
    pass(`${label}: preflight is invalid without throwing away diagnostics`,
      result && result.valid === false && result.ok !== true, result);
    const preflightText = diagnosticText(result);
    pass(`${label}: preflight reports exact paths`,
      patterns.every(pattern => pattern.test(preflightText)), { patterns: patterns.map(String), preflightText });
  }
}

function staticSchemaAudit(authorities) {
  pass('problem 11 schema module exists', fs.existsSync(schemaFile), schemaFile);
  delete require.cache[require.resolve(schemaFile)];
  const schema = require(schemaFile);
  const methods = [
    'normalize', 'parse', 'serialize', 'validate', 'preflight', 'diff', 'deepEqual',
    'migrate', 'createTransaction', 'atomicApply', 'verifyRoundTrip',
  ];
  pass('problem 11 schema exposes versioned mode registry and full transaction surface',
    schema && schema.TYPE && schema.SCHEMA && Number.isFinite(Number(schema.VERSION)) &&
    Number.isFinite(Number(schema.EFFECT_SCHEMA_VERSION)) && schema.MODES && schema.MODE_FIELDS &&
    schema.FIELD_REGISTRY && schema.MIGRATIONS &&
    methods.every(method => typeof schema[method] === 'function'), {
      type: schema && schema.TYPE,
      schema: schema && schema.SCHEMA,
      version: schema && schema.VERSION,
      effectVersion: schema && schema.EFFECT_SCHEMA_VERSION,
      methods: methods.filter(method => schema && typeof schema[method] === 'function'),
    });

  authorities.forEach(authority => {
    const normalized = schema.normalize(authority.raw, { fileName: authority.fileName });
    const canonical = canonicalOf(normalized);
    const report = reportOf(normalized);
    const invalid = listOf(report, 'invalidFields', 'invalid', 'rejectedFields', 'rejected');
    const ignored = listOf(report, 'ignoredFields', 'ignored', 'unknownFields', 'unknown');
    const ignoredCustom = ignored.filter(row => /^particles\.custom(?:\.|$)/.test(rowPath(row)));
    pass(`${authority.key}: schema reports zero invalid fields`, invalid.length === 0, invalid);
    pass(`${authority.key}: schema reports zero ignored custom fields`, ignoredCustom.length === 0, ignoredCustom);
    pass(`${authority.key}: schema recognizes the exact independent mode`,
      String(report.mode || getPath(canonical, `particles.custom.${authority.discriminator}`)) === authority.mode,
      { reportMode: report.mode, canonicalMode: getPath(canonical, `particles.custom.${authority.discriminator}`) });
    assertPreservedFields(authority, canonical);
    assertFieldMatrix(authority, report);

    const serialized = schema.serialize(canonical, 2);
    const parsed = schema.parse(serialized, { fileName: `roundtrip-${authority.fileName}` });
    const reparsed = canonicalOf(parsed);
    pass(`${authority.key}: serialize and parse are deeply equivalent`,
      deepEqual(canonical, reparsed) &&
      (typeof schema.deepEqual !== 'function' || schema.deepEqual(canonical, reparsed) === true), {
        serializedBytes: Buffer.byteLength(serialized),
      });
    const verification = schema.verifyRoundTrip(canonical);
    pass(`${authority.key}: schema verifyRoundTrip passes`, verification === true ||
      !!(verification && verification.ok === true), verification);
    authority.canonical = canonical;
    authority.report = report;
  });

  const ring = authorities[0].raw;
  const conflict = clone(ring);
  conflict.particles.custom.waveMode = 'tsunamiCurl';
  expectSchemaRejected(schema, conflict, 'mode-conflict', [/effectMode/i, /waveMode/i]);

  const ringLength = clone(ring);
  ringLength.particles.custom.ringRadii.pop();
  expectSchemaRejected(schema, ringLength, 'ring-array-length', [/ringRadii/i, /ringCount/i]);

  const allocation = clone(ring);
  allocation.particles.custom.particleAllocation.outerHalo += 1;
  expectSchemaRejected(schema, allocation, 'ring-allocation-total',
    [/particleAllocation/i, /particleCount|38216/i]);

  const orbitTilt = clone(authorities[1].raw);
  orbitTilt.particles.custom.orbitTilts[2] = [0, 28];
  expectSchemaRejected(schema, orbitTilt, 'orbit-tilt-vector', [/orbitTilts/i, /3|three|三个/i]);

  const tsunamiRows = clone(authorities[2].raw);
  tsunamiRows.particles.custom.mainCrestDirections.pop();
  expectSchemaRejected(schema, tsunamiRows, 'tsunami-row-length',
    [/mainCrestDirections/i, /logicalRowCount|5/i]);

  return schema;
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

async function waitFor(fn, timeout = 45000, interval = 120) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (_) {}
    await delay(interval);
  }
  throw new Error(`Timed out after ${timeout} ms; last=${diagnosticText(last)}`);
}

class CDP {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
  }

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
      } else if (message.method === 'Runtime.exceptionThrown') {
        const detail = message.params && message.params.exceptionDetails || {};
        rendererErrors.push(String(detail.exception && detail.exception.description ||
          detail.text || 'Renderer exception').slice(0, 3000));
      } else if (message.method === 'Log.entryAdded') {
        const entry = message.params && message.params.entry || {};
        if (/^(?:error|assert)$/.test(String(entry.level || '')) &&
            String(entry.source || '').toLowerCase() !== 'network') {
          rendererErrors.push(String(entry.text || 'Renderer log error').slice(0, 3000));
        }
      }
    };
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
    await this.send('DOM.enable');
    await this.send('Log.enable');
    await this.send('Page.bringToFront');
  }

  send(method, params = {}, timeout = 60000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) {
      const exception = response.exceptionDetails.exception || {};
      throw new Error(exception.description || response.exceptionDetails.text || 'Runtime.evaluate failed');
    }
    return response.result && response.result.value;
  }

  call(fn, args = []) {
    return this.evaluate(`(${fn.toString()}).apply(null,${JSON.stringify(args)})`);
  }

  close() {
    try { this.ws.close(); } catch (_) {}
  }
}

async function findMainTarget(port) {
  return waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json();
    return targets.find(target => target.type === 'page' &&
      /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//.test(target.url)) || null;
  }, 60000, 180);
}

async function pageReady() {
  return waitFor(async () => {
    const first = await cdp.call(function (expectedOrigin) {
      if (!document.body || location.origin !== expectedOrigin) return null;
      const api = window.LumiFieldCanonicalPresets;
      const particles = window.LumiFieldTask13 || window.LumiFieldCustomParticles;
      const ready = document.readyState === 'complete' && api && particles &&
        typeof api.preview === 'function' && typeof api.apply === 'function' &&
        typeof api.exportCurrent === 'function' &&
        typeof particles.prepareParticlePreset === 'function' &&
        typeof particles.applyParticlePreset === 'function' &&
        typeof particles.captureParticleRuntime === 'function' &&
        typeof particles.restoreParticleRuntime === 'function' &&
        typeof particles.getParticleDebug === 'function' &&
        typeof particles.setParticleTestUser === 'function' &&
        window.renderer && window.scene && window.fx;
      return ready ? { timeOrigin: performance.timeOrigin, href: location.href } : null;
    }, [origin]);
    if (!first) return false;
    await delay(180);
    return cdp.call(function (expectedOrigin, marker) {
      if (!document.body || location.origin !== expectedOrigin ||
          performance.timeOrigin !== marker.timeOrigin || location.href !== marker.href) return false;
      const api = window.LumiFieldCanonicalPresets;
      const particles = window.LumiFieldTask13 || window.LumiFieldCustomParticles;
      return document.readyState === 'complete' && api && particles &&
        typeof api.preview === 'function' && typeof api.apply === 'function' &&
        typeof api.exportCurrent === 'function' &&
        typeof particles.prepareParticlePreset === 'function' &&
        typeof particles.applyParticlePreset === 'function' &&
        typeof particles.captureParticleRuntime === 'function' &&
        typeof particles.restoreParticleRuntime === 'function' &&
        typeof particles.getParticleDebug === 'function' &&
        typeof particles.setParticleTestUser === 'function' &&
        window.renderer && window.scene && window.fx;
    }, [origin, first]);
  }, 70000, 80);
}

async function startApp() {
  const port = await freePort();
  app = spawn(electron, [
    '.',
    `--user-data-dir=${userData}`,
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    '--window-size=1440,920',
  ], {
    cwd: repo,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, {
      LUMIFIELD_SKIP_SPLASH: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      LF_ALLOW_LOCAL_CODES: '1',
      LF_MAIL_HOST: ' ',
      LF_MAIL_USER: ' ',
      LF_MAIL_PASSWORD: ' ',
      LF_REMOTE_API_URL: ' ',
    }),
  });
  const collect = chunk => {
    const text = String(chunk);
    appLog.push(text);
    if (/(?:FATAL|uncaught exception|unhandled rejection|renderer process crashed)/i.test(text)) {
      rendererErrors.push(text.trim().slice(0, 3000));
    }
  };
  app.stdout.on('data', collect);
  app.stderr.on('data', collect);
  const target = await findMainTarget(port);
  origin = new URL(target.url).origin;
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await pageReady();
}

async function stopApp() {
  if (cdp) {
    try { await cdp.call(function () { window.close(); return true; }); } catch (_) {}
    cdp.close();
    cdp = null;
  }
  if (app && app.pid && app.exitCode == null) {
    await Promise.race([new Promise(resolve => app.once('exit', resolve)), delay(5000)]);
  }
  if (app && app.pid && app.exitCode == null) {
    spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  }
  app = null;
  await delay(500);
}

async function screenshot(name) {
  const response = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const file = path.join(evidenceDir, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(response.data, 'base64'));
  screenshots.push(file);
  return file;
}

async function clearStageOverlays() {
  return cdp.call(function () {
    document.body.classList.remove('lf-auth-locked', 'empty-home-active', 'splash-active', 'modal-open');
    ['login-modal', 'user-modal', 'lf-auth-root', 'splash'].forEach(function (id) {
      const node = document.getElementById(id);
      if (!node) return;
      node.classList.remove('show', 'open', 'active');
      node.hidden = true;
      node.style.display = 'none';
      node.style.pointerEvents = 'none';
    });
    return true;
  });
}

async function prepareRuntime() {
  return cdp.call(async function () {
    window.startupLoginGuideShown = true;
    window.loginGuideAnimating = false;
    window.showLoginModal = function () { return false; };
    window.openProviderLogin = function () { return false; };
    document.body.classList.remove('lf-auth-locked', 'empty-home-active', 'splash-active', 'modal-open');
    document.querySelectorAll('.modal-mask.show,.modal-mask.open,.modal-mask.active').forEach(function (modal) {
      modal.classList.remove('show', 'open', 'active');
      modal.style.pointerEvents = 'none';
    });
    const auth = document.getElementById('lf-auth-root');
    if (auth) {
      auth.classList.remove('show');
      auth.hidden = true;
      auth.style.pointerEvents = 'none';
    }
    const splash = document.getElementById('splash');
    if (splash) splash.style.display = 'none';
    if (typeof window.dismissHomePage === 'function') {
      try { window.dismissHomePage({ reason: 'master-problem11-smoke' }); } catch (_) {}
    }
    window.appRevealed = true;
    if (window.fx) window.fx.performanceQuality = 'high';
    if (typeof window.setPerformanceQualityMode === 'function') {
      try { window.setPerformanceQualityMode('high', true); } catch (_) {}
    }

    const particles = window.LumiFieldTask13 || window.LumiFieldCustomParticles;
    await Promise.resolve(particles.setParticleTestUser('lf-p11-primary'));

    if (window.__lfP11AudioUrl) {
      try { URL.revokeObjectURL(window.__lfP11AudioUrl); } catch (_) {}
    }
    const sampleRate = 8000;
    const seconds = 90;
    const samples = sampleRate * seconds;
    const buffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(buffer);
    function write(offset, text) {
      for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index));
    }
    write(0, 'RIFF');
    view.setUint32(4, 36 + samples * 2, true);
    write(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, 'data');
    view.setUint32(40, samples * 2, true);
    for (let index = 0; index < samples; index++) {
      const value = Math.sin(index / sampleRate * Math.PI * 2 * 220) * 9000;
      view.setInt16(44 + index * 2, value, true);
    }
    window.__lfP11AudioUrl = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
    if (window.audio) {
      try { window.audio.pause(); } catch (_) {}
    }
    window.audio = new Audio();
    window.audio.crossOrigin = 'anonymous';
    window.audio.src = window.__lfP11AudioUrl;
    window.audio.loop = true;
    window.playQueue = [
      { id: 'lf-p11-track-a', provider: 'local', name: '问题11连续播放', artist: 'LumiField', duration: 90000 },
      { id: 'lf-p11-track-b', provider: 'local', name: '问题11队列保护', artist: 'LumiField', duration: 90000 },
    ];
    window.currentIdx = 0;
    window.audioReady = false;
    window.source = null;
    window.analyser = null;
    window.beatAnalyser = null;
    window.gainNode = null;
    if (typeof window.initAudio === 'function') window.initAudio();
    await window.audio.play();
    if (typeof window.resumeAudioAnalysis === 'function') await window.resumeAudioAnalysis();
    window.__lfP11CoreRefs = {
      renderer: window.renderer,
      scene: window.scene,
      audioContext: window.audioCtx,
    };
    window.__lfP11QueueKey = JSON.stringify(window.playQueue);
    return {
      playing: !window.audio.paused,
      queueKey: window.__lfP11QueueKey,
      audioContext: !!window.audioCtx,
      renderer: !!window.renderer,
      scene: !!window.scene,
    };
  });
}

async function runtimeSnapshot() {
  return cdp.call(function () {
    const particles = window.LumiFieldTask13 || window.LumiFieldCustomParticles;
    const debug = particles.getParticleDebug();
    const api = window.LumiFieldCanonicalPresets;
    function scopedStorage(key) {
      let raw = null;
      try { raw = JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) {}
      if (raw && raw.schema === 'lumifield-user-scoped-v1' && raw.scopes &&
          Object.prototype.hasOwnProperty.call(raw.scopes, debug.scope)) {
        return raw.scopes[debug.scope];
      }
      return raw;
    }
    return {
      debug,
      coreReuse: {
        renderer: !!(window.__lfP11CoreRefs && window.renderer === window.__lfP11CoreRefs.renderer),
        scene: !!(window.__lfP11CoreRefs && window.scene === window.__lfP11CoreRefs.scene),
        audioContext: !!(window.__lfP11CoreRefs && window.audioCtx === window.__lfP11CoreRefs.audioContext),
      },
      player: {
        paused: !window.audio || window.audio.paused,
        currentTime: window.audio && Number(window.audio.currentTime.toFixed(3)),
        queueKey: JSON.stringify(window.playQueue || []),
        currentIdx: window.currentIdx,
      },
      currentPresetId: api.getCurrentPresetId(),
      archives: api.listArchives(),
      persistence: {
        particleRuntime: scopedStorage('lumifield-task13-particle-runtime-v1'),
        currentPreset: scopedStorage('lumifield-task13-current-preset-v1'),
        canonicalPresets: scopedStorage('lumifield-canonical-presets-v1'),
      },
      canvas: window.renderer && window.renderer.domElement ? (function () {
        const rect = window.renderer.domElement.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      })() : null,
    };
  });
}

function assertRuntimeFieldConsumption(authority, debug) {
  const rows = Array.isArray(debug && debug.fieldConsumption) ? debug.fieldConsumption :
    Object.keys(debug && debug.fieldConsumption || {}).map(key => {
      const value = debug.fieldConsumption[key];
      return value && typeof value === 'object' ? Object.assign({ canonicalPath: key }, value) :
        { canonicalPath: key, consumptionStatus: value };
    });
  const byPath = new Map(rows.map(row => [rowPath(row), row]));
  const required = flattenLeaves(authority.raw)
    .map(entry => entry.path)
    .filter(fieldPath => !META_PATHS.has(fieldPath));
  const missing = required.filter(fieldPath => !byPath.has(fieldPath));
  const failed = required.map(fieldPath => {
    const row = byPath.get(fieldPath);
    return { path: fieldPath, status: rowStatus(row), consumer: row && row.consumer };
  }).filter(entry => {
    if (RENDERED_NAMESPACES.test(entry.path)) return entry.status !== 'IMPLEMENTED_AND_RENDERED';
    return entry.status !== 'IMPLEMENTED_AND_RENDERED' && entry.status !== 'IMPLEMENTED_STATE_ONLY';
  });
  pass(`${authority.key}: runtime fieldConsumption is complete`, missing.length === 0, {
    required: required.length,
    rows: rows.length,
    missing,
  });
  pass(`${authority.key}: runtime fieldConsumption contains no fake applied field`, failed.length === 0, failed);
}

function assertRuntimeTopology(authority, snapshot) {
  const debug = snapshot.debug || {};
  const topology = debug.topology || {};
  pass(`${authority.key}: runtime mode preset and target particle count are exact`,
    debug.active === true && debug.visible !== false && debug.mode === authority.mode &&
    debug.presetId === authority.raw.presetId &&
    Number(debug.targetParticleCount) === authority.targetParticleCount &&
    Number(debug.effectiveParticleCount) > 0 &&
    Number(debug.effectiveParticleCount) <= authority.targetParticleCount, debug);
  pass(`${authority.key}: runtime reuses renderer scene audio and owns no rAF or analyser`,
    snapshot.coreReuse.renderer && snapshot.coreReuse.scene && snapshot.coreReuse.audioContext &&
    Number(debug.rendererCreated) === 0 &&
    Number(debug.requestAnimationFrameCreated) === 0 &&
    Number(debug.audioContextCreated) === 0 &&
    Number(debug.analyserCreated) === 0, {
      coreReuse: snapshot.coreReuse,
      rendererCreated: debug.rendererCreated,
      requestAnimationFrameCreated: debug.requestAnimationFrameCreated,
      audioContextCreated: debug.audioContextCreated,
      analyserCreated: debug.analyserCreated,
    });
  if (authority.key === 'ring') {
    pass('ring runtime topology is four rings with a clear center and outer halo',
      Number(topology.ringCount) === 4 && Array.isArray(topology.perRing) && topology.perRing.length === 4 &&
      topology.centerClear === true && topology.outerHalo === true, topology);
  } else if (authority.key === 'orbit') {
    pass('orbit runtime topology is six trails core eight loops outer arc and background stars',
      Number(topology.orbitTrailCount) === 6 && Array.isArray(topology.perOrbit) &&
      topology.perOrbit.length === 6 && Number(topology.coreLoopCount) === 8 &&
      topology.outerArc === true && topology.backgroundStars === true, topology);
  } else {
    pass('tsunami runtime topology is five logical rows and ten physical bands',
      Number(topology.logicalRowCount) === 5 && Number(topology.physicalCrestBandCount) === 10 &&
      Array.isArray(topology.perBand) && topology.perBand.length === 10, topology);
  }
  const allocation = debug.allocation && typeof debug.allocation === 'object' ?
    Object.values(debug.allocation).filter(Number.isFinite).reduce((sum, value) => sum + value, 0) : 0;
  if (allocation) {
    pass(`${authority.key}: runtime allocation equals effective particle count`,
      allocation === Number(debug.effectiveParticleCount), {
        allocation,
        effectiveParticleCount: debug.effectiveParticleCount,
        parts: debug.allocation,
      });
  }
  assertRuntimeFieldConsumption(authority, debug);
}

async function assertPlaybackContinues(label, before, after) {
  pass(`${label}: import preserves queue index and active playback`,
    before.player.queueKey === after.player.queueKey &&
    before.player.currentIdx === after.player.currentIdx &&
    before.player.paused === false && after.player.paused === false &&
    after.player.currentTime > before.player.currentTime, {
      before: before.player,
      after: after.player,
    });
}

async function previewAndApply(authority) {
  const before = await runtimeSnapshot();
  const preview = await cdp.call(function (payload, fileName) {
    const api = window.LumiFieldCanonicalPresets;
    const particles = window.LumiFieldTask13 || window.LumiFieldCustomParticles;
    const beforeDebug = particles.getParticleDebug();
    const report = api.preview(payload, { fileName });
    const afterDebug = particles.getParticleDebug();
    const modal = document.getElementById('lf-t13-import-preview') ||
      document.querySelector('[data-lf-canonical-preview]');
    return {
      report,
      unchanged: JSON.stringify(beforeDebug) === JSON.stringify(afterDebug),
      modal: {
        exists: !!modal,
        visible: !!(modal && (modal.classList.contains('show') || getComputedStyle(modal).display !== 'none')),
        text: modal && modal.innerText,
        apply: !!(modal && modal.querySelector('[data-action="apply"]')),
      },
    };
  }, [authority.raw, authority.fileName]);
  const previewText = diagnosticText(preview.report);
  pass(`${authority.key}: real preview is side-effect free and identifies the mode`,
    preview.unchanged && previewText.includes(authority.mode), preview);
  pass(`${authority.key}: real preview UI exposes apply and full diagnostics`,
    preview.modal.exists && preview.modal.visible && preview.modal.apply &&
    preview.modal.text.includes(authority.mode) &&
    /particleCount|粒子数/i.test(preview.modal.text) &&
    !/未识别|不支持|invalid|unsupported/i.test(preview.modal.text), preview.modal);
  await screenshot(`${String(authority.order).padStart(2, '0')}-${authority.key}-preview`);

  const clicked = await cdp.call(function () {
    const modal = document.getElementById('lf-t13-import-preview') ||
      document.querySelector('[data-lf-canonical-preview]');
    const button = modal && modal.querySelector('[data-action="apply"]');
    if (!button) return false;
    button.click();
    return true;
  });
  pass(`${authority.key}: preview confirmation was clicked`, clicked === true, clicked);
  await waitFor(async () => {
    const snapshot = await runtimeSnapshot();
    return snapshot.debug && snapshot.debug.active === true &&
      snapshot.debug.mode === authority.mode &&
      snapshot.debug.presetId === authority.raw.presetId && snapshot;
  }, 70000, 160);
  await delay(380);
  await clearStageOverlays();
  const after = await runtimeSnapshot();
  assertRuntimeTopology(authority, after);
  await assertPlaybackContinues(authority.key, before, after);
  await screenshot(`${String(authority.order).padStart(2, '0')}-${authority.key}-applied`);
  runtimeModes.push({ key: authority.key, debug: after.debug });
  return after;
}

function cameraCore(camera) {
  if (!camera || typeof camera !== 'object') return camera;
  const out = clone(camera);
  ['updatedAt', 'lastInputAt', 'frame', 'time'].forEach(key => delete out[key]);
  return out;
}

async function canvasPoint() {
  const snapshot = await runtimeSnapshot();
  const rect = snapshot.canvas;
  assert.ok(rect && rect.width > 200 && rect.height > 200, 'renderer canvas must be visible');
  return {
    x: Math.round(rect.left + rect.width * 0.72),
    y: Math.round(rect.top + rect.height * 0.48),
  };
}

async function drag(button, dx, dy) {
  const point = await canvasPoint();
  const buttons = button === 'left' ? 1 : button === 'right' ? 2 : 4;
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: point.x, y: point.y, button, buttons, clickCount: 1,
  });
  for (let step = 1; step <= 6; step++) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x + dx * step / 6,
      y: point.y + dy * step / 6,
      button,
      buttons,
    });
    await delay(30);
  }
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: point.x + dx, y: point.y + dy, button, buttons: 0, clickCount: 1,
  });
  await delay(240);
}

async function wheel(deltaY) {
  const point = await canvasPoint();
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: point.x, y: point.y, deltaX: 0, deltaY,
  });
  await delay(260);
}

async function cameraSnapshot() {
  const snapshot = await runtimeSnapshot();
  return cameraCore(snapshot.debug && snapshot.debug.camera);
}

async function verifyInteractions(authority) {
  const debug = (await runtimeSnapshot()).debug;
  const interaction = debug.interaction || {};
  if (authority.key === 'ring') {
    pass('ring runtime interaction declares drag-only 360 rotation vertical flip and wheel zoom',
      interaction.mouseRotation === true && interaction.rotateOnlyWhileLeftDrag === true &&
      interaction.allowFull360Rotation === true && interaction.allowVerticalFlip === true &&
      interaction.wheelZoom === true && interaction.mouseMove === false, interaction);
    const beforeDrag = await cameraSnapshot();
    await drag('left', 130, -90);
    const afterDrag = await cameraSnapshot();
    pass('ring real left drag changes camera rotation', !deepEqual(beforeDrag, afterDrag), { beforeDrag, afterDrag });
    const beforeWheel = afterDrag;
    await wheel(-480);
    const afterWheel = await cameraSnapshot();
    pass('ring real wheel changes camera zoom', !deepEqual(beforeWheel, afterWheel), { beforeWheel, afterWheel });
  } else if (authority.key === 'orbit') {
    pass('orbit runtime interaction declares accumulated rotate translate and unbounded exponential zoom',
      interaction.mouseRotation === true && interaction.mouseTranslation === true &&
      interaction.dragAccumulateRotation === true && interaction.dragAccumulateTranslation === true &&
      interaction.zoomInfiniteIn === true && interaction.zoomMethod === 'exponentialUnbounded', interaction);
    const beforeDrag = await cameraSnapshot();
    await drag('left', -150, 85);
    const afterDrag = await cameraSnapshot();
    pass('orbit real left drag changes accumulated free camera state',
      !deepEqual(beforeDrag, afterDrag), { beforeDrag, afterDrag });
    const beforeWheel = afterDrag;
    await wheel(-1200);
    const afterWheel = await cameraSnapshot();
    pass('orbit real wheel changes unbounded zoom state',
      !deepEqual(beforeWheel, afterWheel), { beforeWheel, afterWheel });
  } else {
    pass('tsunami runtime interaction declares left orbit right pan middle roll and wheel zoom',
      interaction.leftDragOrbit === true && interaction.rightDragPan === true &&
      interaction.middleDragRoll === true && interaction.wheelZoom === true &&
      interaction.allowFull360Rotation === true && interaction.allowVerticalFlip === true, interaction);
    const beforeLeft = await cameraSnapshot();
    await drag('left', 110, 80);
    const afterLeft = await cameraSnapshot();
    pass('tsunami real left drag changes orbit', !deepEqual(beforeLeft, afterLeft), { beforeLeft, afterLeft });
    await drag('right', -90, 55);
    const afterRight = await cameraSnapshot();
    pass('tsunami real right drag changes pan', !deepEqual(afterLeft, afterRight), { afterLeft, afterRight });
    await drag('middle', 75, 0);
    const afterMiddle = await cameraSnapshot();
    pass('tsunami real middle drag changes roll', !deepEqual(afterRight, afterMiddle), { afterRight, afterMiddle });
    await wheel(520);
    const afterWheel = await cameraSnapshot();
    pass('tsunami real wheel changes zoom', !deepEqual(afterMiddle, afterWheel), { afterMiddle, afterWheel });
  }
}

async function verifyExportRoundTrip(authority, schema) {
  const exported = await cdp.call(function () {
    const api = window.LumiFieldCanonicalPresets;
    const current = api.exportCurrent('问题11重导入');
    const archives = api.listArchives();
    const matching = archives.find(item => item.presetId === api.getCurrentPresetId());
    const archive = matching ? api.getArchiveCanonical(matching.index) : null;
    return { current, archive, currentId: api.getCurrentPresetId(), archives };
  });
  const current = exported.current && (exported.current.canonical || exported.current.payload) || exported.current;
  const archive = exported.archive && (exported.archive.canonical || exported.archive.payload) || exported.archive;
  pass(`${authority.key}: current export retains exact mode and target`,
    getPath(current, `particles.custom.${authority.discriminator}`) === authority.mode &&
    getPath(current, 'particles.custom.particleCount') === authority.targetParticleCount, exported);
  pass(`${authority.key}: archive stores the complete canonical custom preset`,
    archive && getPath(archive, `particles.custom.${authority.discriminator}`) === authority.mode &&
    fieldValueEqual(getPath(archive, 'camera'), getPath(authority.raw, 'camera')), exported);
  const serialized = schema.serialize(current, 2);
  const reparsed = canonicalOf(schema.parse(serialized, { fileName: `runtime-export-${authority.key}.json` }));
  pass(`${authority.key}: runtime export parse is deeply equivalent`,
    deepEqual(current, reparsed), { bytes: Buffer.byteLength(serialized) });
  const reapplied = await cdp.call(async function (payload) {
    return await Promise.resolve(window.LumiFieldCanonicalPresets.apply(payload, {
      createArchive: false,
      source: 'problem11-export-roundtrip',
    }));
  }, [reparsed]);
  pass(`${authority.key}: exported JSON can be reapplied`, reapplied === true ||
    !!(reapplied && reapplied.ok === true), reapplied);
  const snapshot = await runtimeSnapshot();
  assertRuntimeTopology(authority, snapshot);
}

function rollbackComparable(snapshot) {
  const debug = clone(snapshot.debug || {});
  [
    'buildCount', 'disposeCount', 'geometryUuid', 'materialUuid', 'groupUuid',
    'lastAppliedAt', 'updatedAt', 'fieldConsumption', 'elapsed', 'generation', 'lastDisposed',
  ].forEach(key => delete debug[key]);
  return {
    debug: stable(debug),
    player: {
      paused: snapshot.player && snapshot.player.paused,
      queueKey: snapshot.player && snapshot.player.queueKey,
      currentIdx: snapshot.player && snapshot.player.currentIdx,
    },
    currentPresetId: snapshot.currentPresetId,
    archives: stable(snapshot.archives || []),
    persistence: stable(snapshot.persistence || {}),
  };
}

async function verifyAtomicRollback(authorities) {
  const before = await runtimeSnapshot();
  const target = authorities.find(authority => authority.mode !== before.debug.mode) || authorities[0];
  const result = await cdp.call(async function (payload) {
    return await Promise.resolve(window.LumiFieldCanonicalPresets.apply(payload, {
      createArchive: false,
      source: 'problem11-failure-injection',
      failAtStage: 'after-apply',
    }));
  }, [target.raw]);
  pass('runtime deterministic after-apply failure reports a successful rollback',
    result && result.ok === false && result.state === 'rolled-back' &&
    result.rollback && result.rollback.attempted === true && result.rollback.succeeded === true, result);
  await delay(300);
  const after = await runtimeSnapshot();
  pass('runtime rollback restores mode camera state storage archive and player atomically',
    deepEqual(rollbackComparable(before), rollbackComparable(after)) &&
    deepEqual(before.debug && before.debug.fieldConsumption, after.debug && after.debug.fieldConsumption) &&
    after.player.currentTime >= before.player.currentTime &&
    after.player.currentTime - before.player.currentTime < 3, {
      before: rollbackComparable(before),
      after: rollbackComparable(after),
      fieldConsumptionBefore: before.debug && before.debug.fieldConsumption,
      fieldConsumptionAfter: after.debug && after.debug.fieldConsumption,
      playbackTime: { before: before.player.currentTime, after: after.player.currentTime },
    });
}

async function directApply(authority, options = {}) {
  const result = await cdp.call(async function (payload, applyOptions) {
    const api = window.LumiFieldCanonicalPresets;
    const applied = await Promise.resolve(api.apply(payload, applyOptions));
    const particles = window.LumiFieldTask13 || window.LumiFieldCustomParticles;
    return { applied, debug: particles.getParticleDebug() };
  }, [authority.raw, Object.assign({ createArchive: false, source: 'problem11-switch' }, options)]);
  pass(`${authority.key}: direct canonical apply succeeds`, result.applied === true ||
    !!(result.applied && result.applied.ok === true), result.applied);
  pass(`${authority.key}: direct apply activates requested mode`,
    result.debug && result.debug.mode === authority.mode, result.debug);
  return result.debug;
}

function resourceSignature(debug) {
  const resources = debug && debug.resourceCounts || {};
  return stable({
    resources,
    listenerCount: debug && debug.listenerCount,
    effectiveParticleCount: debug && debug.effectiveParticleCount,
    topology: debug && debug.topology,
  });
}

async function verifyTwentySwitches(authorities) {
  const before = (await runtimeSnapshot()).debug;
  const samples = [];
  for (let index = 0; index < 20; index++) {
    const authority = authorities[index % authorities.length];
    const debug = await directApply(authority);
    samples.push({
      index,
      key: authority.key,
      mode: debug.mode,
      buildCount: debug.buildCount,
      disposeCount: debug.disposeCount,
      listenerCount: debug.listenerCount,
      rendererCreated: debug.rendererCreated,
      requestAnimationFrameCreated: debug.requestAnimationFrameCreated,
      audioContextCreated: debug.audioContextCreated,
      analyserCreated: debug.analyserCreated,
      signature: resourceSignature(debug),
    });
  }
  const after = (await runtimeSnapshot()).debug;
  pass('20 switches each build the requested independent mode',
    samples.every((sample, index) => sample.mode === authorities[index % authorities.length].mode) &&
    Number(after.buildCount) - Number(before.buildCount) === 20, { before, after, samples });
  pass('20 switches dispose every superseded mode without listener or core-loop leak',
    Number(after.disposeCount) - Number(before.disposeCount) >= 19 &&
    samples.every(sample => Number(sample.rendererCreated) === 0 &&
      Number(sample.requestAnimationFrameCreated) === 0 &&
      Number(sample.audioContextCreated) === 0 && Number(sample.analyserCreated) === 0) &&
    samples.every(sample => Number(sample.listenerCount) === Number(samples[0].listenerCount)), {
      before: { buildCount: before.buildCount, disposeCount: before.disposeCount, listenerCount: before.listenerCount },
      after: { buildCount: after.buildCount, disposeCount: after.disposeCount, listenerCount: after.listenerCount },
      samples,
    });
  const signatures = {};
  samples.forEach(sample => {
    if (!signatures[sample.key]) signatures[sample.key] = JSON.stringify(sample.signature);
    else pass(`20 switches keep stable active resources for ${sample.key}`,
      signatures[sample.key] === JSON.stringify(sample.signature), {
        expected: signatures[sample.key],
        actual: sample.signature,
      });
  });
}

async function reloadPage() {
  const previousTimeOrigin = await cdp.call(function () { return performance.timeOrigin; });
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(() => cdp.call(function (expectedOrigin, previous) {
    return !!(document.body && location.origin === expectedOrigin &&
      performance.timeOrigin !== previous && document.readyState !== 'loading');
  }, [origin, previousTimeOrigin]), 70000, 100);
  await pageReady();
  await delay(650);
}

async function verifyReloadRestore(authority) {
  const before = await runtimeSnapshot();
  await reloadPage();
  const particlesReady = await waitFor(() => cdp.call(async function (userId) {
    if (!document.body) return false;
    document.body.classList.remove('lf-auth-locked', 'splash-active', 'empty-home-active');
    const particles = window.LumiFieldTask13 || window.LumiFieldCustomParticles;
    await Promise.resolve(particles.setParticleTestUser(userId));
    return true;
  }, ['lf-p11-primary']), 20000, 100);
  pass('reload restores the test user context', particlesReady === true, particlesReady);
  const restored = await waitFor(async () => {
    const snapshot = await runtimeSnapshot();
    return snapshot.debug && snapshot.debug.mode === authority.mode && snapshot;
  }, 50000, 180);
  pass(`${authority.key}: real page reload restores mode topology and target`,
    restored.debug.presetId === authority.raw.presetId &&
    restored.debug.targetParticleCount === authority.targetParticleCount &&
    deepEqual(before.debug.topology, restored.debug.topology), {
      before: before.debug,
      restored: restored.debug,
    });
  return restored;
}

async function setTestUser(userId) {
  await cdp.call(async function (id) {
    const particles = window.LumiFieldTask13 || window.LumiFieldCustomParticles;
    await Promise.resolve(particles.setParticleTestUser(id));
    return true;
  }, [userId]);
  await delay(260);
  return runtimeSnapshot();
}

async function verifyUserIsolation(authorities) {
  const userA = 'lf-p11-user-a';
  const userB = 'lf-p11-user-b';
  await setTestUser(userA);
  await directApply(authorities[0], { createArchive: true, source: 'problem11-user-a' });
  const aSaved = await runtimeSnapshot();

  const bBefore = await setTestUser(userB);
  pass('user B never inherits user A current particle preset',
    (!bBefore.debug.active || bBefore.debug.presetId !== authorities[0].raw.presetId) &&
    bBefore.persistence.currentPreset !== authorities[0].raw.presetId &&
    getPath(bBefore.persistence, `particleRuntime.canonical.presetId`) !== authorities[0].raw.presetId, {
      userA: aSaved.debug,
      userB: bBefore.debug,
      userBPersistence: bBefore.persistence,
    });
  await directApply(authorities[1], { createArchive: true, source: 'problem11-user-b' });
  const bSaved = await runtimeSnapshot();

  const aRestored = await setTestUser(userA);
  pass('switching back to user A restores only user A ring preset',
    aRestored.debug.mode === authorities[0].mode &&
    aRestored.debug.presetId === authorities[0].raw.presetId &&
    aRestored.persistence.currentPreset === authorities[0].raw.presetId &&
    getPath(aRestored.persistence, 'particleRuntime.canonical.presetId') === authorities[0].raw.presetId, {
      debug: aRestored.debug,
      persistence: aRestored.persistence,
    });
  const bRestored = await setTestUser(userB);
  pass('switching back to user B restores only user B orbit preset',
    bRestored.debug.mode === authorities[1].mode &&
    bRestored.debug.presetId === authorities[1].raw.presetId &&
    bRestored.persistence.currentPreset === authorities[1].raw.presetId &&
    getPath(bRestored.persistence, 'particleRuntime.canonical.presetId') === authorities[1].raw.presetId, {
      debug: bRestored.debug,
      persistence: bRestored.persistence,
    });
  pass('user A and B keep distinct persisted archive identity',
    aSaved.currentPresetId !== bSaved.currentPresetId ||
    aSaved.debug.presetId !== bSaved.debug.presetId, {
      userA: { currentPresetId: aSaved.currentPresetId, presetId: aSaved.debug.presetId },
      userB: { currentPresetId: bSaved.currentPresetId, presetId: bSaved.debug.presetId },
    });

  await reloadPage();
  await setTestUser(userB);
  const bReloaded = await waitFor(async () => {
    const snapshot = await runtimeSnapshot();
    return snapshot.debug && snapshot.debug.mode === authorities[1].mode && snapshot;
  }, 50000, 180);
  pass('user B remains isolated after real reload',
    bReloaded.debug.presetId === authorities[1].raw.presetId &&
    bReloaded.persistence.currentPreset === authorities[1].raw.presetId &&
    getPath(bReloaded.persistence, 'particleRuntime.canonical.presetId') === authorities[1].raw.presetId, {
      debug: bReloaded.debug,
      persistence: bReloaded.persistence,
    });
}

async function run() {
  const authorities = loadAuthorities();
  const schema = staticSchemaAudit(authorities);
  await startApp();
  const runtime = await prepareRuntime();
  pass('real Electron runtime starts with playing audio and one reusable core',
    runtime.playing && runtime.audioContext && runtime.renderer && runtime.scene, runtime);

  for (const authority of authorities) {
    await previewAndApply(authority);
    await verifyInteractions(authority);
    await verifyExportRoundTrip(authority, schema);
  }

  await verifyAtomicRollback(authorities);
  await verifyTwentySwitches(authorities);
  const finalAuthority = authorities[(20 - 1) % authorities.length];
  await verifyReloadRestore(finalAuthority);
  await verifyUserIsolation(authorities);

  pass('real renderer has no uncaught exceptions', rendererErrors.length === 0, rendererErrors);
  const result = {
    ok: true,
    problem: 11,
    mode: 'authority JSON static schema + real Electron/CDP custom particle lifecycle',
    runId,
    origin,
    evidenceDir,
    authorities: authorities.map(authority => ({
      order: authority.order,
      key: authority.key,
      fileName: authority.fileName,
      filePath: authority.filePath,
      bytes: authority.bytes,
      sha256: authority.sha256,
      mode: authority.mode,
      targetParticleCount: authority.targetParticleCount,
      leafCount: flattenLeaves(authority.raw).length,
    })),
    runtimeModes,
    checks,
    screenshots,
    rendererErrors,
    appLogTail: appLog.join('').slice(-16000),
    completedAt: new Date().toISOString(),
  };
  const resultFile = path.join(evidenceDir, 'result.json');
  fs.writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: true,
    problem: 11,
    resultFile,
    checks: Object.keys(checks).length,
    screenshots: screenshots.length,
    rendererErrors: rendererErrors.length,
  }, null, 2));
}

run().catch(error => {
  const errorText = String(error && error.stack || error);
  const failure = {
    ok: false,
    problem: 11,
    runId,
    origin,
    evidenceDir,
    error: errorText.slice(0, 16000),
    checkSummary: {
      passed: Object.keys(checks).length,
      names: Object.keys(checks),
    },
    screenshots,
    rendererErrors,
    appLogTail: appLog.join('').slice(-16000),
    completedAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(path.join(evidenceDir, 'failure.json'), `${JSON.stringify(failure, null, 2)}\n`);
  } catch (_) {}
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
}).finally(async () => {
  await stopApp();
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) {}
});
