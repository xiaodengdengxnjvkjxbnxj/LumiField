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
const installedExecutable = String(process.env.LF_PROBLEM5_EXECUTABLE || '').trim();
const launchExecutable = installedExecutable || electron;
const launchMode = installedExecutable ? 'installed' : 'source';
const { LFStemService } = require('../desktop/lf-stem-service');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.resolve(process.env.LF_PROBLEM5_OUT || path.join(repo, 'test-results', 'lf-problem5-smoke', runId));
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-problem5-'));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-problem5-electron-'));
const checks = {};
const rendererErrors = [];
const appLog = [];
let app = null;
let cdp = null;
let stemService = null;
let backendEvidence = null;
let audioEvidence = null;
let staticEvidence = null;
let electronEvidence = null;

fs.mkdirSync(evidenceDir, { recursive: true });

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function pass(name, condition, detail) {
  assert.ok(condition, `${name}: ${JSON.stringify(detail)}`);
  checks[name] = detail == null ? true : detail;
  return detail;
}

function sha256File(filePath) {
  const digest = crypto.createHash('sha256');
  digest.update(fs.readFileSync(filePath));
  return digest.digest('hex');
}

function withTimeout(promise, timeout, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeout}ms`)), timeout);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function waitFor(fn, timeout = 60000, interval = 100) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (_) {}
    await delay(interval);
  }
  throw new Error(`waitFor timed out: ${JSON.stringify(last)}`);
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

function createStereoWave(filePath, seconds, variant) {
  const sampleRate = 44100;
  const channels = 2;
  const frames = Math.max(1, Math.floor(sampleRate * seconds));
  const dataBytes = frames * channels * 2;
  const output = Buffer.allocUnsafe(44 + dataBytes);
  output.write('RIFF', 0, 4, 'ascii');
  output.writeUInt32LE(36 + dataBytes, 4);
  output.write('WAVE', 8, 4, 'ascii');
  output.write('fmt ', 12, 4, 'ascii');
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(channels, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * channels * 2, 28);
  output.writeUInt16LE(channels * 2, 32);
  output.writeUInt16LE(16, 34);
  output.write('data', 36, 4, 'ascii');
  output.writeUInt32LE(dataBytes, 40);
  let seed = (0x6d2b79f5 ^ variant) >>> 0;
  for (let frame = 0, offset = 44; frame < frames; frame += 1) {
    const time = frame / sampleRate;
    seed = (Math.imul(seed ^ (seed >>> 15), 1 | seed) + 0x9e3779b9) >>> 0;
    const noise = ((seed & 0xffff) / 32768 - 1) * 0.025;
    const vocalEnvelope = 0.52 + 0.32 * Math.sin(2 * Math.PI * 1.7 * time);
    const vocal = vocalEnvelope * (
      0.31 * Math.sin(2 * Math.PI * (238 + variant * 7) * time + 0.12 * Math.sin(2 * Math.PI * 4.8 * time)) +
      0.17 * Math.sin(2 * Math.PI * (476 + variant * 11) * time)
    );
    const accompaniment =
      0.25 * Math.sin(2 * Math.PI * (82 + variant * 3) * time) +
      0.15 * Math.sin(2 * Math.PI * (329 + variant * 5) * time + 0.7) +
      0.08 * Math.sin(2 * Math.PI * (659 + variant * 13) * time + 1.1);
    const pulse = frame % 551 < 35 ? 0.13 * (1 - (frame % 551) / 35) : 0;
    const left = Math.max(-0.96, Math.min(0.96, vocal + accompaniment + pulse + noise));
    const right = Math.max(-0.96, Math.min(0.96, vocal * 0.86 + accompaniment * 0.72 - pulse * 0.55 - noise));
    output.writeInt16LE(Math.round(left * 32767), offset);
    output.writeInt16LE(Math.round(right * 32767), offset + 2);
    offset += 4;
  }
  fs.writeFileSync(filePath, output, { mode: 0o600 });
  return { filePath, sampleRate, channels, frames, seconds: frames / sampleRate, bytes: output.length };
}

function inspectWave(filePath) {
  const data = fs.readFileSync(filePath);
  const riff = data.toString('ascii', 0, 4);
  const wave = data.toString('ascii', 8, 12);
  let format = null;
  let dataBytes = 0;
  for (let offset = 12; offset + 8 <= data.length;) {
    const id = data.toString('ascii', offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > data.length) break;
    if (id === 'fmt ' && size >= 16) {
      format = {
        encoding: data.readUInt16LE(start),
        channels: data.readUInt16LE(start + 2),
        sampleRate: data.readUInt32LE(start + 4),
        bitsPerSample: data.readUInt16LE(start + 14),
      };
    }
    if (id === 'data') dataBytes += size;
    offset = start + size + (size & 1);
  }
  return {
    file: path.basename(filePath),
    bytes: data.length,
    riff,
    wave,
    riffSize: data.length >= 8 ? data.readUInt32LE(4) : 0,
    dataBytes,
    format,
    sha256: sha256File(filePath),
  };
}

function monotonic(events) {
  return events.length > 0 && events.every((event, index) =>
    Number.isFinite(event.progress) &&
    event.progress >= 0 &&
    event.progress <= 1 &&
    (index === 0 || event.progress + Number.EPSILON >= events[index - 1].progress));
}

function compactProgress(events) {
  return events.map(event => ({
    progress: Math.round(event.progress * 10000) / 10000,
    phase: event.phase,
    status: event.status,
  }));
}

function staticAudit() {
  const controlsPath = path.join(repo, 'public', 'lf-audio-controls.js');
  const toolsPath = path.join(repo, 'public', 'lf-audio-tools.js');
  const controls = fs.readFileSync(controlsPath, 'utf8');
  const tools = fs.readFileSync(toolsPath, 'utf8');
  const activateStart = controls.indexOf('async function activatePrepared');
  const activateEnd = controls.indexOf('\n  function bindProgress', activateStart);
  const mixerStart = tools.indexOf('class LFStemMixer');
  const mixerEnd = tools.indexOf('\n  global.LFAudioTools', mixerStart);
  assert.ok(activateStart >= 0 && activateEnd > activateStart, 'activatePrepared source block was not found');
  assert.ok(mixerStart >= 0 && mixerEnd > mixerStart, 'LFStemMixer source block was not found');
  const activation = controls.slice(activateStart, activateEnd);
  const mixer = tools.slice(mixerStart, mixerEnd);
  const mediaElementCreation = /new\s+(?:window\.)?Audio\s*\(|createElement\s*\(\s*['"]audio['"]|createMediaElementSource\s*\(|MediaElementAudioSourceNode|HTMLAudioElement/;
  pass(
    'static accompaniment activation creates no Audio or MediaElement source',
    !mediaElementCreation.test(activation),
    { source: 'public/lf-audio-controls.js', block: 'activatePrepared' },
  );
  pass(
    'static stem mixer creates no Audio or MediaElement source',
    !mediaElementCreation.test(mixer),
    { source: 'public/lf-audio-tools.js', block: 'LFStemMixer' },
  );
  pass(
    'static accompaniment decodes both stems into AudioBuffers',
    /Promise\.all\s*\(\s*\[\s*fetchStemBuffer\(result\.vocalUrl/.test(activation) &&
      /fetchStemBuffer\(result\.noVocalsUrl/.test(activation) &&
      /tools\.createStemMixer\s*\(/.test(activation) &&
      /decodeAudioData\s*\(/.test(controls),
    true,
  );
  pass(
    'static stem transport is AudioBufferSourceNode based',
    /createBufferSource\s*\(\s*\)/.test(mixer) &&
      /source\.buffer\s*=\s*buffer/.test(mixer) &&
      /transport:\s*['"]audio-buffer-source['"]/.test(mixer),
    true,
  );
  return {
    controlsSha256: sha256File(controlsPath),
    toolsSha256: sha256File(toolsPath),
    activationBytes: Buffer.byteLength(activation),
    mixerBytes: Buffer.byteLength(mixer),
    forbiddenMediaElementPatternMatched: mediaElementCreation.test(activation) || mediaElementCreation.test(mixer),
  };
}

async function realSpleeterAudit() {
  const cacheDir = path.join(scratchDir, 'stem-cache');
  const cancelInput = path.join(scratchDir, 'cancel-source.wav');
  const survivorInput = path.join(scratchDir, 'generated-44k-stereo.wav');
  const cancelWave = createStereoWave(cancelInput, 3.25, 7);
  const sourceWave = createStereoWave(survivorInput, 1.35, 3);
  const progressByTask = new Map();
  const spawnCalls = [];
  const testEnv = { ...process.env, LF_SPLEETER_THREADS: String(process.env.LF_SPLEETER_THREADS || '1') };
  stemService = new LFStemService({
    cacheDir,
    resourcesPath: repo,
    concurrency: 1,
    env: testEnv,
    spawn(command, args, options) {
      const child = spawn(command, args, options);
      const record = {
        pid: child.pid,
        command: path.basename(command),
        worker: path.basename(args[0] || ''),
        hasInput: args.includes('--input'),
        hasOutput: args.includes('--output'),
        hasRuntime: args.includes('--runtime'),
        hasModels: args.includes('--models'),
        threads: args[args.indexOf('--threads') + 1],
        startedAt: Date.now(),
        closeAt: null,
        exitCode: null,
        signal: null,
      };
      spawnCalls.push(record);
      child.once('close', (code, signal) => {
        record.closeAt = Date.now();
        record.exitCode = code;
        record.signal = signal;
      });
      return child;
    },
  });
  const backend = stemService.resolveBackend();
  const capability = stemService.status();
  pass(
    'bundled sherpa Spleeter is selected',
    backend.ok &&
      backend.kind === 'bundled-sherpa-onnx-spleeter' &&
      backend.engine === 'sherpa-onnx-spleeter' &&
      capability.available === true &&
      capability.backend === 'bundled-sherpa-onnx-spleeter',
    capability,
  );
  pass(
    'bundled runtime worker and two Spleeter models exist',
    fs.statSync(path.join(backend.runtimeDir, 'sherpa-onnx-c-api.dll')).isFile() &&
      fs.statSync(path.join(backend.runtimeDir, 'onnxruntime.dll')).isFile() &&
      fs.statSync(path.join(backend.modelDir, 'vocals.fp16.onnx')).size > 1000000 &&
      fs.statSync(path.join(backend.modelDir, 'accompaniment.fp16.onnx')).size > 1000000 &&
      fs.statSync(backend.worker).isFile(),
    {
      runtime: path.relative(repo, backend.runtimeDir),
      models: path.relative(repo, backend.modelDir),
      worker: path.relative(repo, backend.worker),
    },
  );

  let cancelTaskId = '';
  let cancelIssued = false;
  let resolveCancelTrigger;
  const cancelTrigger = new Promise(resolve => { resolveCancelTrigger = resolve; });
  stemService.on('progress', event => {
    if (!progressByTask.has(event.taskId)) progressByTask.set(event.taskId, []);
    progressByTask.get(event.taskId).push({ ...event, at: Date.now() });
    const task = stemService.tasks.get(event.taskId);
    if (!cancelIssued &&
        event.taskId === cancelTaskId &&
        event.phase === 'separating' &&
        event.progress > 0.2 &&
        task &&
        task.child) {
      cancelIssued = true;
      const response = stemService.cancel(cancelTaskId);
      resolveCancelTrigger({
        response,
        progress: event.progress,
        phase: event.phase,
        childPid: task.child && task.child.pid,
        issuedAt: Date.now(),
      });
    }
  });

  const cancelQueued = stemService.enqueue({ inputPath: cancelInput, quality: 'fast' });
  assert.ok(cancelQueued.ok, JSON.stringify(cancelQueued));
  cancelTaskId = cancelQueued.taskId;
  const survivorQueued = stemService.enqueue({ inputPath: survivorInput, quality: 'fast' });
  assert.ok(survivorQueued.ok, JSON.stringify(survivorQueued));
  pass(
    'survivor starts queued behind cancellable task',
    survivorQueued.status === 'queued' && survivorQueued.taskId !== cancelQueued.taskId,
    { cancelTaskId: cancelQueued.taskId, survivorTaskId: survivorQueued.taskId },
  );

  const cancellation = await withTimeout(cancelTrigger, 120000, 'real Spleeter cancellation trigger');
  pass(
    'active bundled Spleeter worker accepts targeted cancellation',
    cancellation.response && cancellation.response.ok && cancellation.childPid > 0,
    cancellation,
  );
  const [cancelled, separated] = await Promise.all([
    withTimeout(stemService.wait(cancelQueued.taskId), 120000, 'cancelled Spleeter task'),
    withTimeout(stemService.wait(survivorQueued.taskId), 240000, 'survivor Spleeter task'),
  ]);
  const cancelledWorker = spawnCalls.find(call => call.pid === cancellation.childPid);
  pass(
    'cancelled native worker terminates promptly with non-success exit',
    cancelledWorker &&
      cancelledWorker.closeAt >= cancellation.issuedAt &&
      cancelledWorker.closeAt - cancellation.issuedAt < 5000 &&
      (cancelledWorker.exitCode !== 0 || !!cancelledWorker.signal),
    {
      childPid: cancellation.childPid,
      issuedAt: cancellation.issuedAt,
      closeAt: cancelledWorker && cancelledWorker.closeAt,
      terminationMs: cancelledWorker && cancelledWorker.closeAt - cancellation.issuedAt,
      exitCode: cancelledWorker && cancelledWorker.exitCode,
      signal: cancelledWorker && cancelledWorker.signal,
    },
  );
  pass(
    'active cancellation is isolated from queued survivor',
    !cancelled.ok && cancelled.error === 'CANCELLED' &&
      separated.ok && separated.cached === false &&
      separated.sourceKind === 'local-separation' &&
      separated.engine === 'bundled-sherpa-onnx-spleeter',
    {
      cancelled: { ok: cancelled.ok, error: cancelled.error, taskId: cancelled.taskId },
      survivor: {
        ok: separated.ok,
        cached: separated.cached,
        sourceKind: separated.sourceKind,
        engine: separated.engine,
        taskId: separated.taskId,
      },
    },
  );

  const survivorProgress = progressByTask.get(survivorQueued.taskId) || [];
  const cancelledProgress = progressByTask.get(cancelQueued.taskId) || [];
  pass(
    'real separation progress is monotonic from queued to completed',
    monotonic(survivorProgress) &&
      survivorProgress[0].progress === 0 &&
      survivorProgress.at(-1).progress === 1 &&
      survivorProgress.some(event => event.phase === 'separating') &&
      survivorProgress.some(event => event.phase === 'validating'),
    compactProgress(survivorProgress),
  );
  pass(
    'cancelled task progress remains monotonic and task scoped',
    monotonic(cancelledProgress) &&
      cancelledProgress.every(event => event.taskId === cancelQueued.taskId) &&
      survivorProgress.every(event => event.taskId === survivorQueued.taskId),
    {
      cancelled: compactProgress(cancelledProgress),
      survivorTaskId: survivorQueued.taskId,
    },
  );

  const inputInspection = inspectWave(survivorInput);
  const vocalInspection = inspectWave(separated.vocalPath);
  const accompanimentInspection = inspectWave(separated.noVocalsPath);
  pass(
    'generated input is short 44.1 kHz stereo PCM WAV',
    inputInspection.riff === 'RIFF' &&
      inputInspection.wave === 'WAVE' &&
      inputInspection.dataBytes > 0 &&
      inputInspection.format &&
      inputInspection.format.encoding === 1 &&
      inputInspection.format.sampleRate === 44100 &&
      inputInspection.format.channels === 2 &&
      inputInspection.format.bitsPerSample === 16 &&
      sourceWave.seconds < 2,
    { generated: sourceWave, inspection: inputInspection },
  );
  pass(
    'both real Spleeter outputs are non-empty RIFF WAV files',
    [vocalInspection, accompanimentInspection].every(item =>
      item.riff === 'RIFF' &&
      item.wave === 'WAVE' &&
      item.bytes > 44 &&
      item.dataBytes > 0 &&
      item.format &&
      item.format.sampleRate === 44100 &&
      item.format.channels >= 1),
    { vocals: vocalInspection, accompaniment: accompanimentInspection },
  );
  pass(
    'real vocal and accompaniment output hashes are distinct',
    vocalInspection.sha256 !== accompanimentInspection.sha256 &&
      vocalInspection.sha256 !== inputInspection.sha256 &&
      accompanimentInspection.sha256 !== inputInspection.sha256,
    {
      input: inputInspection.sha256,
      vocals: vocalInspection.sha256,
      accompaniment: accompanimentInspection.sha256,
    },
  );
  const manifest = JSON.parse(fs.readFileSync(separated.manifestPath, 'utf8'));
  pass(
    'manifest identifies sherpa Spleeter and exact output hashes',
    manifest.engine === 'sherpa-onnx-spleeter' &&
      manifest.vocals.sha256 === vocalInspection.sha256 &&
      manifest.noVocals.sha256 === accompanimentInspection.sha256 &&
      manifest.sourceSha256 === inputInspection.sha256,
    manifest,
  );

  const workerCountBeforeCache = spawnCalls.length;
  const cachedQueued = stemService.enqueue({ inputPath: survivorInput, quality: 'fast' });
  assert.ok(cachedQueued.ok, JSON.stringify(cachedQueued));
  const cached = await withTimeout(stemService.wait(cachedQueued.taskId), 30000, 'cached Spleeter task');
  const cachedProgress = progressByTask.get(cachedQueued.taskId) || [];
  pass(
    'second separation is a cache hit without another worker',
    cached.ok &&
      cached.cached === true &&
      cached.sourceKind === 'cache' &&
      cached.vocalPath === separated.vocalPath &&
      cached.noVocalsPath === separated.noVocalsPath &&
      spawnCalls.length === workerCountBeforeCache &&
      cachedProgress.some(event => event.phase === 'cache-hit'),
    {
      cached: cached.cached,
      sourceKind: cached.sourceKind,
      spawnCountBefore: workerCountBeforeCache,
      spawnCountAfter: spawnCalls.length,
      progress: compactProgress(cachedProgress),
    },
  );
  pass(
    'cache-hit progress remains monotonic',
    monotonic(cachedProgress) && cachedProgress.at(-1).progress === 1,
    compactProgress(cachedProgress),
  );

  await waitFor(() => stemService.active === 0, 10000, 25);
  const workEntries = fs.readdirSync(path.join(cacheDir, '.work'));
  const stagingEntries = fs.readdirSync(path.join(cacheDir, '.staging'));
  const manifests = [];
  for (const entry of fs.readdirSync(cacheDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const manifestPath = path.join(cacheDir, entry.name, 'manifest.json');
    if (fs.existsSync(manifestPath)) manifests.push(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
  }
  const cancelSourceSha256 = sha256File(cancelInput);
  pass(
    'cancelled task leaves no work staging or cache artifact',
    workEntries.length === 0 &&
      stagingEntries.length === 0 &&
      manifests.every(item => item.sourceSha256 !== cancelSourceSha256),
    { workEntries, stagingEntries, cacheManifestCount: manifests.length, cancelSourceSha256 },
  );
  pass(
    'real worker invocations use bundled Spleeter arguments',
    spawnCalls.length >= 2 &&
      spawnCalls.every(call =>
        call.worker === path.basename(backend.worker) &&
        call.hasInput &&
        call.hasOutput &&
        call.hasRuntime &&
        call.hasModels),
    spawnCalls,
  );

  const audioDir = path.join(evidenceDir, 'audio');
  fs.mkdirSync(audioDir, { recursive: true });
  const evidenceFiles = {
    input: path.join(audioDir, 'generated-44k-stereo.wav'),
    vocals: path.join(audioDir, 'vocals.wav'),
    accompaniment: path.join(audioDir, 'no_vocals.wav'),
    manifest: path.join(audioDir, 'manifest.json'),
  };
  fs.copyFileSync(survivorInput, evidenceFiles.input);
  fs.copyFileSync(separated.vocalPath, evidenceFiles.vocals);
  fs.copyFileSync(separated.noVocalsPath, evidenceFiles.accompaniment);
  fs.copyFileSync(separated.manifestPath, evidenceFiles.manifest);

  const runtimePackagePath = path.join(backend.runtimeDir, 'package.json');
  const runtimePackage = JSON.parse(fs.readFileSync(runtimePackagePath, 'utf8'));
  backendEvidence = {
    capability,
    selected: {
      kind: backend.kind,
      engine: backend.engine,
      model: backend.model,
      runtimePackage: runtimePackage.name,
      runtimeVersion: runtimePackage.version,
      runtimeDir: path.relative(repo, backend.runtimeDir),
      modelDir: path.relative(repo, backend.modelDir),
      worker: path.relative(repo, backend.worker),
      workerSha256: sha256File(backend.worker),
      runtimeDllSha256: sha256File(path.join(backend.runtimeDir, 'sherpa-onnx-c-api.dll')),
      vocalsModelSha256: sha256File(path.join(backend.modelDir, 'vocals.fp16.onnx')),
      accompanimentModelSha256: sha256File(path.join(backend.modelDir, 'accompaniment.fp16.onnx')),
    },
    spawnCalls,
  };
  audioEvidence = {
    generated: sourceWave,
    cancellationInput: cancelWave,
    cancellation,
    cancelled: { ok: cancelled.ok, error: cancelled.error, taskId: cancelled.taskId },
    separated: {
      ok: separated.ok,
      cached: separated.cached,
      sourceKind: separated.sourceKind,
      engine: separated.engine,
      taskId: separated.taskId,
    },
    cached: {
      ok: cached.ok,
      cached: cached.cached,
      sourceKind: cached.sourceKind,
      taskId: cached.taskId,
    },
    inspections: {
      input: inputInspection,
      vocals: vocalInspection,
      accompaniment: accompanimentInspection,
    },
    progress: {
      cancelled: compactProgress(cancelledProgress),
      separated: compactProgress(survivorProgress),
      cached: compactProgress(cachedProgress),
    },
    evidenceFiles: Object.fromEntries(Object.entries(evidenceFiles).map(([key, value]) => [key, path.relative(repo, value)])),
  };
  fs.writeFileSync(path.join(evidenceDir, 'backend-audio.json'), JSON.stringify({ backend: backendEvidence, audio: audioEvidence }, null, 2));
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
        rendererErrors.push(String(detail.exception && detail.exception.description || detail.text || 'Renderer exception').slice(0, 2000));
      }
    };
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
  }

  send(method, params, timeout = 60000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }

  async call(fn, args = []) {
    const result = await this.send('Runtime.evaluate', {
      expression: `(${fn.toString()}).apply(null,${JSON.stringify(args)})`,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      const exception = result.exceptionDetails.exception || {};
      throw new Error(exception.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
    }
    return result.result && result.result.value;
  }

  close() {
    try { this.ws.close(); } catch (_) {}
  }
}

async function startElectron() {
  const port = await freePort();
  app = spawn(launchExecutable, (installedExecutable ? [] : ['.']).concat([
    `--user-data-dir=${userData}`,
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    '--window-size=1440,900',
  ]), {
    cwd: installedExecutable ? path.dirname(installedExecutable) : repo,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      LUMIFIELD_SKIP_SPLASH: '1',
      LF_ALLOW_PACKAGED_CDP_TEST: '1',
      LF_MAIL_HOST: ' ',
      LF_MAIL_USER: ' ',
      LF_MAIL_PASSWORD: ' ',
      LF_REMOTE_API_URL: ' ',
    },
  });
  const collect = chunk => appLog.push(String(chunk));
  app.stdout.on('data', collect);
  app.stderr.on('data', collect);
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json();
    return targets.find(item =>
      item.type === 'page' &&
      item.webSocketDebuggerUrl &&
      /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//.test(item.url));
  }, 60000, 150);
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await waitFor(() => cdp.call(function () {
    return document.readyState === 'complete' &&
      !!window.LFAudioControls &&
      !!window.LFAudioTools &&
      !!document.getElementById('lf-audio-speed-pitch-link') &&
      !!document.getElementById('lf-audio-speed') &&
      !!document.getElementById('lf-audio-pitch');
  }), 60000, 100);
  return { port, mode: launchMode, executable: launchExecutable, target: { id: target.id, url: target.url, title: target.title } };
}

async function runtimeStemTransportAudit(wavBase64) {
  return cdp.call(async function (encodedWave) {
    function bytesFromBase64(value) {
      var raw = atob(value);
      var output = new Uint8Array(raw.length);
      for (var index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index);
      return output;
    }
    function pause(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
    var bytes = bytesFromBase64(encodedWave);
    var masterUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    if (!audio) {
      audio = new Audio();
      audio.crossOrigin = 'anonymous';
    }
    audio.src = masterUrl;
    await new Promise(function (resolve) {
      var settled = false;
      function done() {
        if (settled) return;
        settled = true;
        audio.removeEventListener('loadedmetadata', done);
        audio.removeEventListener('error', done);
        resolve();
      }
      audio.addEventListener('loadedmetadata', done);
      audio.addEventListener('error', done);
      audio.load();
      setTimeout(done, 2000);
    });
    if (!audioReady) initAudio();
    window.LFAudioControls.bindAudio(audio);
    await pause(100);

    var counts = {
      newAudio: 0,
      createdAudioElement: 0,
      mediaElementSource: 0,
      bufferSource: 0,
      bufferSourceStarts: 0,
    };
    var bufferSourceStartCalls = [];
    var NativeAudio = window.Audio;
    var originalCreateElement = document.createElement;
    var originalFetch = window.fetch;
    var originalMediaElementSource = audioCtx.createMediaElementSource;
    var originalBufferSource = audioCtx.createBufferSource;
    window.Audio = new Proxy(NativeAudio, {
      construct: function (target, args, receiver) {
        counts.newAudio += 1;
        return Reflect.construct(target, args, receiver);
      },
    });
    document.createElement = function (name) {
      if (String(name || '').toLowerCase() === 'audio') counts.createdAudioElement += 1;
      return originalCreateElement.apply(this, arguments);
    };
    audioCtx.createMediaElementSource = function () {
      counts.mediaElementSource += 1;
      return originalMediaElementSource.apply(this, arguments);
    };
    audioCtx.createBufferSource = function () {
      counts.bufferSource += 1;
      var node = originalBufferSource.apply(this, arguments);
      var nativeStart = node.start;
      node.start = function () {
        counts.bufferSourceStarts += 1;
        bufferSourceStartCalls.push(Array.prototype.slice.call(arguments).map(Number));
        return nativeStart.apply(this, arguments);
      };
      return node;
    };
    window.fetch = function (url) {
      if (/\/__lf_problem5_(?:vocals|accompaniment)\.wav$/.test(String(url || ''))) {
        return Promise.resolve(new Response(bytes.slice(), {
          status: 200,
          headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(bytes.length) },
        }));
      }
      return originalFetch.apply(this, arguments);
    };
    var activation;
    var active;
    var playing;
    var deactivated;
    try {
      activation = await window.LFAudioControls.activateStems({
        ok: true,
        vocalUrl: location.origin + '/__lf_problem5_vocals.wav',
        noVocalsUrl: location.origin + '/__lf_problem5_accompaniment.wav',
        stemLayout: 'separated-pair',
        sourceKind: 'runtime-fixture',
        cached: false,
      });
      active = window.LFAudioControls.status();
      audio.dispatchEvent(new Event('play'));
      for (var attempt = 0; attempt < 60 && counts.bufferSourceStarts < 2; attempt += 1) await pause(50);
      await pause(180);
      var timeDomain = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(timeDomain);
      var sumSquares = 0;
      var peak = 0;
      for (var sampleIndex = 0; sampleIndex < timeDomain.length; sampleIndex += 1) {
        var sample = timeDomain[sampleIndex];
        sumSquares += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
      playing = window.LFAudioControls.status();
      playing.analyser = {
        rms: Math.sqrt(sumSquares / Math.max(1, timeDomain.length)),
        peak: peak,
        samples: timeDomain.length,
      };
      deactivated = await window.LFAudioControls.deactivateStems();
    } finally {
      window.fetch = originalFetch;
      window.Audio = NativeAudio;
      document.createElement = originalCreateElement;
      audioCtx.createMediaElementSource = originalMediaElementSource;
      audioCtx.createBufferSource = originalBufferSource;
      URL.revokeObjectURL(masterUrl);
    }
    return {
      activation,
      active,
      playing,
      deactivated,
      counts,
      bufferSourceStartCalls,
      master: {
        tagName: audio && audio.tagName,
        audioReady: !!audioReady,
        contextState: audioCtx && audioCtx.state,
      },
    };
  }, [wavBase64]);
}

async function packagedStemRuntimeAudit(wavBase64) {
  if (!installedExecutable) return null;
  return cdp.call(async function (encodedWave) {
    function bytesFromBase64(value) {
      var raw = atob(value);
      var output = new Uint8Array(raw.length);
      for (var index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index);
      return output;
    }
    async function sha256(value) {
      var digest = await crypto.subtle.digest('SHA-256', value);
      return Array.from(new Uint8Array(digest)).map(function (byte) {
        return byte.toString(16).padStart(2, '0');
      }).join('');
    }
    var progress = [];
    var unsubscribe = window.desktopWindow.onLFStemProgress(function (event) {
      progress.push({
        taskId: String(event && event.taskId || ''),
        progress: Number(event && event.progress),
        phase: String(event && event.phase || ''),
      });
    });
    try {
      var queued = await window.desktopWindow.lfStemStart(null, {
        decodedWav: bytesFromBase64(encodedWave),
        sourceKey: 'lf-problem5-installed-runtime',
        quality: 'fast',
      });
      if (!queued || !queued.ok || !queued.taskId) return { queued: queued, progress: progress };
      var result = await window.desktopWindow.lfStemWait(queued.taskId);
      if (!result || !result.ok) return { queued: queued, result: result, progress: progress };
      var vocalResponse = await fetch(result.vocalUrl);
      var accompanimentResponse = await fetch(result.noVocalsUrl);
      var vocal = await vocalResponse.arrayBuffer();
      var accompaniment = await accompanimentResponse.arrayBuffer();
      return {
        queued: queued,
        result: result,
        progress: progress.filter(function (entry) { return entry.taskId === queued.taskId; }),
        outputs: {
          vocal: {
            status: vocalResponse.status,
            bytes: vocal.byteLength,
            riff: new TextDecoder('ascii').decode(vocal.slice(0, 4)),
            sha256: await sha256(vocal),
          },
          accompaniment: {
            status: accompanimentResponse.status,
            bytes: accompaniment.byteLength,
            riff: new TextDecoder('ascii').decode(accompaniment.slice(0, 4)),
            sha256: await sha256(accompaniment),
          },
        },
      };
    } finally {
      if (typeof unsubscribe === 'function') unsubscribe();
    }
  }, [wavBase64]);
}

async function controlsAudit() {
  const initial = await cdp.call(function () {
    var status = window.LFAudioControls.status();
    return {
      status,
      toggleChecked: document.getElementById('lf-audio-speed-pitch-link').checked,
      speedValue: document.getElementById('lf-audio-speed').value,
      pitchValue: document.getElementById('lf-audio-pitch').value,
      storedLink: localStorage.getItem('lf-audio-speed-pitch-link'),
      storedSpeed: localStorage.getItem('lf-audio-speed'),
      storedPitch: localStorage.getItem('lf-audio-pitch'),
    };
  });
  pass(
    'speed pitch link defaults off in fresh Electron profile',
    initial.status.speedPitchLinkEnabled === false &&
      initial.toggleChecked === false &&
      initial.status.speed === 1 &&
      initial.status.pitch === 0 &&
      initial.storedLink !== '1',
    initial,
  );

  const independent = await cdp.call(async function () {
    function eventInput(id, value) {
      var node = document.getElementById(id);
      node.value = String(value);
      node.dispatchEvent(new Event('input', { bubbles: true }));
    }
    function pause(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
    eventInput('lf-audio-speed', 1.5);
    await window.LFAudioControls.whenControlsSettled();
    var afterSpeed = window.LFAudioControls.status();
    var pitchResult = await window.LFAudioControls.setPitch(5);
    await window.LFAudioControls.whenControlsSettled();
    var afterPitch = window.LFAudioControls.status();
    eventInput('lf-audio-speed', 1.25);
    await window.LFAudioControls.whenControlsSettled();
    await pause(20);
    var afterSecondSpeed = window.LFAudioControls.status();
    return {
      afterSpeed,
      pitchResult,
      afterPitch,
      afterSecondSpeed,
      ui: {
        speed: document.getElementById('lf-audio-speed').value,
        pitch: document.getElementById('lf-audio-pitch').value,
        checked: document.getElementById('lf-audio-speed-pitch-link').checked,
      },
    };
  });
  pass(
    'link off keeps speed and pitch independent',
    independent.afterSpeed.speed === 1.5 &&
      independent.afterSpeed.pitch === 0 &&
      independent.pitchResult.ok === true &&
      independent.afterPitch.speed === 1.5 &&
      independent.afterPitch.pitch === 5 &&
      independent.afterSecondSpeed.speed === 1.25 &&
      independent.afterSecondSpeed.pitch === 5 &&
      independent.ui.speed === '1.25' &&
      independent.ui.pitch === '5' &&
      independent.ui.checked === false,
    independent,
  );

  const linked = await cdp.call(async function () {
    function pause(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
    var toggle = document.getElementById('lf-audio-speed-pitch-link');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await window.LFAudioControls.whenControlsSettled();
    await pause(20);
    var afterEnable = window.LFAudioControls.status();
    var pitchToSpeed = await window.LFAudioControls.setPitch(6);
    await window.LFAudioControls.whenControlsSettled();
    var afterPitch = window.LFAudioControls.status();
    var reverseFromSpeed = window.LFAudioControls.setSpeed(afterPitch.speed);
    await window.LFAudioControls.whenControlsSettled();
    var afterPitchRoundTrip = window.LFAudioControls.status();
    var speedToPitch = window.LFAudioControls.setSpeed(0.875);
    await window.LFAudioControls.whenControlsSettled();
    var afterSpeed = window.LFAudioControls.status();
    var reverseFromPitch = await window.LFAudioControls.setPitch(afterSpeed.pitch);
    await window.LFAudioControls.whenControlsSettled();
    var afterSpeedRoundTrip = window.LFAudioControls.status();
    var pureRoundTrips = [];
    for (var pitch = -12; pitch <= 12; pitch += 1) {
      var mapped = window.LFAudioControls.mapSpeedPitchLink('pitch', pitch);
      var reversed = window.LFAudioControls.mapSpeedPitchLink('speed', mapped.speed);
      pureRoundTrips.push({
        pitch,
        speed: mapped.speed,
        reversedPitch: reversed.pitch,
        reversible: reversed.pitch === pitch,
      });
    }
    return {
      afterEnable,
      pitchToSpeed,
      afterPitch,
      reverseFromSpeed,
      afterPitchRoundTrip,
      speedToPitch,
      afterSpeed,
      reverseFromPitch,
      afterSpeedRoundTrip,
      pureRoundTrips,
      ui: {
        checked: toggle.checked,
        speedStep: document.getElementById('lf-audio-speed').step,
      },
    };
  });
  pass(
    'link on maps pitch to speed and reverses exactly',
    linked.afterEnable.speedPitchLinkEnabled === true &&
      linked.pitchToSpeed.ok === true &&
      linked.afterPitch.pitch === 6 &&
      linked.afterPitch.speed === 1.625 &&
      linked.afterPitchRoundTrip.pitch === 6 &&
      linked.afterPitchRoundTrip.speed === 1.625,
    linked,
  );
  pass(
    'link on maps speed to pitch and reverses exactly',
    linked.afterSpeed.speed === 0.875 &&
      linked.afterSpeed.pitch === -6 &&
      linked.afterSpeedRoundTrip.speed === 0.875 &&
      linked.afterSpeedRoundTrip.pitch === -6 &&
      linked.pureRoundTrips.every(item => item.reversible) &&
      linked.ui.checked === true &&
      Number(linked.ui.speedStep) === 0.0625,
    {
      afterSpeed: linked.afterSpeed,
      afterSpeedRoundTrip: linked.afterSpeedRoundTrip,
      reversibleCount: linked.pureRoundTrips.filter(item => item.reversible).length,
      total: linked.pureRoundTrips.length,
      ui: linked.ui,
    },
  );

  const lastWrite = await cdp.call(async function () {
    var api = window.LFAudioControls;
    var pitchMessages = [];
    var portPrototype = window.MessagePort && window.MessagePort.prototype;
    var nativePostMessage = portPrototype && portPrototype.postMessage;
    if (!nativePostMessage) throw new Error('MessagePort.postMessage unavailable');
    portPrototype.postMessage = function (message) {
      if (message && message.type === 'pitch') {
        pitchMessages.push({ type: message.type, semitones: Number(message.semitones) });
      }
      return nativePostMessage.apply(this, arguments);
    };
    var outcomes;
    try {
      var writes = [
        api.setPitch(-10),
        Promise.resolve(api.setSpeed(1.75)),
        api.setPitch(9),
      ];
      outcomes = await Promise.all(writes);
      await api.whenControlsSettled();
      await new Promise(resolve => setTimeout(resolve, 30));
    } finally {
      portPrototype.postMessage = nativePostMessage;
    }
    var status = api.status();
    return {
      outcomes,
      pitchMessages,
      status,
      playbackRate: audio && audio.playbackRate,
      ui: {
        speed: document.getElementById('lf-audio-speed').value,
        pitch: document.getElementById('lf-audio-pitch').value,
        checked: document.getElementById('lf-audio-speed-pitch-link').checked,
      },
      storage: {
        link: localStorage.getItem('lf-audio-speed-pitch-link'),
        speed: localStorage.getItem('lf-audio-speed'),
        pitch: localStorage.getItem('lf-audio-pitch'),
      },
    };
  });
  pass(
    'rapid linked updates apply the final write',
    lastWrite.status.speed === 1.8125 &&
      lastWrite.status.pitch === 9 &&
      lastWrite.status.speedPitchLinkLastSource === 'pitch' &&
      lastWrite.playbackRate === 1.8125 &&
      lastWrite.ui.speed === '1.8125' &&
      lastWrite.ui.pitch === '9' &&
      lastWrite.ui.checked === true &&
      lastWrite.storage.link === '1' &&
      lastWrite.storage.speed === '1.8125' &&
      lastWrite.storage.pitch === '9' &&
      lastWrite.pitchMessages.length > 0 &&
      lastWrite.pitchMessages.at(-1).semitones === 9,
    lastWrite,
  );

  const previousTimeOrigin = await cdp.call(function () { return performance.timeOrigin; });
  await cdp.send('Page.reload', { ignoreCache: true });
  const persisted = await waitFor(() => cdp.call(function (oldTimeOrigin) {
    if (document.readyState !== 'complete' ||
        performance.timeOrigin === oldTimeOrigin ||
        !window.LFAudioControls ||
        !document.getElementById('lf-audio-speed-pitch-link')) return null;
    var status = window.LFAudioControls.status();
    return {
      status,
      ui: {
        checked: document.getElementById('lf-audio-speed-pitch-link').checked,
        speed: document.getElementById('lf-audio-speed').value,
        pitch: document.getElementById('lf-audio-pitch').value,
      },
      storage: {
        link: localStorage.getItem('lf-audio-speed-pitch-link'),
        speed: localStorage.getItem('lf-audio-speed'),
        pitch: localStorage.getItem('lf-audio-pitch'),
      },
    };
  }, [previousTimeOrigin]), 60000, 100);
  pass(
    'linked speed pitch state persists across Electron reload',
    persisted.status.speedPitchLinkEnabled === true &&
      persisted.status.speed === 1.8125 &&
      persisted.status.pitch === 9 &&
      persisted.ui.checked === true &&
      persisted.ui.speed === '1.8125' &&
      persisted.ui.pitch === '9' &&
      persisted.storage.link === '1' &&
      persisted.storage.speed === '1.8125' &&
      persisted.storage.pitch === '9',
    persisted,
  );
  return { initial, independent, linked, lastWrite, persisted };
}

async function screenshotElectron() {
  await cdp.call(function () {
    if (document.body) document.body.classList.remove('splash-active', 'lf-auth-locked');
    var splash = document.getElementById('splash');
    if (splash) splash.style.display = 'none';
    var panel = document.getElementById('lf-audio-tool-panel');
    if (panel) panel.classList.add('show');
    return true;
  });
  const image = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const screenshotPath = path.join(evidenceDir, 'electron-audio-controls.png');
  fs.writeFileSync(screenshotPath, Buffer.from(image.data, 'base64'));
  return path.relative(repo, screenshotPath);
}

async function electronAudit() {
  const launch = await startElectron();
  const initial = await cdp.call(function () {
    var status = window.LFAudioControls.status();
    return {
      status,
      toggleChecked: document.getElementById('lf-audio-speed-pitch-link').checked,
      storedLink: localStorage.getItem('lf-audio-speed-pitch-link'),
    };
  });
  pass(
    'Electron starts with link disabled before runtime setup',
    initial.status.speedPitchLinkEnabled === false &&
      initial.toggleChecked === false &&
      initial.storedLink == null,
    initial,
  );
  const wavBase64 = fs.readFileSync(path.join(evidenceDir, 'audio', 'generated-44k-stereo.wav')).toString('base64');
  const packagedStemRuntime = await packagedStemRuntimeAudit(wavBase64);
  if (installedExecutable) {
    pass(
      'installed app runs bundled Spleeter and serves distinct real stems',
      packagedStemRuntime &&
        packagedStemRuntime.queued && packagedStemRuntime.queued.ok === true &&
        packagedStemRuntime.result && packagedStemRuntime.result.ok === true &&
        packagedStemRuntime.result.engine === 'bundled-sherpa-onnx-spleeter' &&
        packagedStemRuntime.outputs &&
        packagedStemRuntime.outputs.vocal.status === 200 &&
        packagedStemRuntime.outputs.accompaniment.status === 200 &&
        packagedStemRuntime.outputs.vocal.riff === 'RIFF' &&
        packagedStemRuntime.outputs.accompaniment.riff === 'RIFF' &&
        packagedStemRuntime.outputs.vocal.bytes > 44 &&
        packagedStemRuntime.outputs.accompaniment.bytes > 44 &&
        packagedStemRuntime.outputs.vocal.sha256 !== packagedStemRuntime.outputs.accompaniment.sha256 &&
        monotonic(packagedStemRuntime.progress),
      packagedStemRuntime,
    );
  }
  const stemTransport = await runtimeStemTransportAudit(wavBase64);
  pass(
    'runtime accompaniment creates no extra Audio or MediaElement',
    stemTransport.activation && stemTransport.activation.ok === true &&
      stemTransport.active && stemTransport.active.stems === true &&
      stemTransport.counts.newAudio === 0 &&
      stemTransport.counts.createdAudioElement === 0 &&
      stemTransport.counts.mediaElementSource === 0,
    stemTransport,
  );
  pass(
    'runtime accompaniment invokes AudioBufferSourceNode start',
      stemTransport.active.stemTransport === 'audio-buffer-source' &&
      stemTransport.playing.stemTransport === 'audio-buffer-source' &&
      stemTransport.counts.bufferSource >= 2 &&
      stemTransport.counts.bufferSourceStarts >= 2 &&
      stemTransport.deactivated && stemTransport.deactivated.ok === true,
    stemTransport,
  );
  const controls = await controlsAudit();
  const screenshot = await screenshotElectron();
  await delay(100);
  pass('Electron renderer reports no uncaught exceptions', rendererErrors.length === 0, rendererErrors);
  return { launch, initial, packagedStemRuntime, stemTransport, controls, screenshot };
}

async function stopElectron() {
  if (cdp) {
    try { await cdp.call(function () { window.close(); return true; }); } catch (_) {}
    cdp.close();
    cdp = null;
  }
  if (app && app.pid && app.exitCode == null) {
    await Promise.race([new Promise(resolve => app.once('exit', resolve)), delay(4000)]);
  }
  if (app && app.pid && app.exitCode == null) {
    spawnSync('taskkill', ['/pid', String(app.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
  }
  app = null;
}

async function stopStemService() {
  if (!stemService) return;
  for (const task of stemService.tasks.values()) {
    if (!task.settled) stemService.cancel(task.id);
  }
  try { await waitFor(() => stemService.active === 0, 5000, 25); } catch (_) {}
  for (const task of stemService.tasks.values()) {
    try { if (task.child) task.child.kill('SIGKILL'); } catch (_) {}
  }
}

async function run() {
  staticEvidence = staticAudit();
  await realSpleeterAudit();
  electronEvidence = await electronAudit();
  const result = {
    ok: true,
    runId,
    evidenceDir,
    checks,
    static: staticEvidence,
    backend: backendEvidence,
    audio: audioEvidence,
    electron: electronEvidence,
    rendererErrors,
  };
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({
    ok: true,
    evidenceDir,
    checkCount: Object.keys(checks).length,
    runtime: backendEvidence.selected.runtimePackage + '@' + backendEvidence.selected.runtimeVersion,
    model: backendEvidence.selected.model,
    outputs: {
      vocals: audioEvidence.inspections.vocals.sha256,
      accompaniment: audioEvidence.inspections.accompaniment.sha256,
    },
    cacheHit: audioEvidence.cached.cached,
    cancellation: audioEvidence.cancelled.error,
    electron: {
      extraMediaElements: electronEvidence.stemTransport.counts.newAudio +
        electronEvidence.stemTransport.counts.createdAudioElement +
        electronEvidence.stemTransport.counts.mediaElementSource,
      bufferSources: electronEvidence.stemTransport.counts.bufferSource,
      persisted: electronEvidence.controls.persisted.status,
    },
  }, null, 2));
}

run().catch(error => {
  const failure = {
    ok: false,
    runId,
    evidenceDir,
    error: String(error && error.stack || error),
    checks,
    static: staticEvidence,
    backend: backendEvidence,
    audio: audioEvidence,
    electron: electronEvidence,
    rendererErrors,
  };
  try { fs.writeFileSync(path.join(evidenceDir, 'failure.json'), JSON.stringify(failure, null, 2)); } catch (_) {}
  console.error(failure.error);
  process.exitCode = 1;
}).finally(async () => {
  try { fs.writeFileSync(path.join(evidenceDir, 'electron.log'), appLog.join('')); } catch (_) {}
  await stopElectron();
  await stopStemService();
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(scratchDir, { recursive: true, force: true }); } catch (_) {}
});
