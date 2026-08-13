'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { spawn, spawnSync } = require('child_process');

const AUDIO_EXTENSIONS = new Set(['.wav', '.flac', '.mp3', '.m4a', '.aac', '.ogg', '.opus', '.wma', '.aiff', '.aif']);
const QUALITY_PRESETS = Object.freeze({
  fast: Object.freeze({ model: 'mdx_q', args: ['--shifts', '0', '--overlap', '0.1'] }),
  high: Object.freeze({ model: 'htdemucs_ft', args: ['--shifts', '2', '--overlap', '0.5'] }),
});
const SPLEETER_MODEL_ID = 'sherpa-onnx-spleeter-2stems-fp16';
const SPLEETER_CACHE_VERSION = 'lf-spleeter-v1-c6c5c4307673bc68';
const MAX_AUDIO_BYTES = 20 * 1024 * 1024 * 1024;

function token(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || 0)); }
function isInside(root, candidate) {
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  return target === base || target.startsWith(`${base}${path.sep}`);
}
function regularFile(candidate) {
  try { return fs.statSync(candidate).isFile(); } catch (_) { return false; }
}
function regularDirectory(candidate) {
  try { return fs.statSync(candidate).isDirectory(); } catch (_) { return false; }
}
function unpackedPath(candidate) {
  return String(candidate || '').replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
}
function executableModel(value, fallback) {
  const model = String(value || '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(model) ? model : fallback;
}
function sanitizedFailure(value, inputPath, cacheDir) {
  let text = String(value || 'STEM_SEPARATION_FAILED');
  for (const item of [inputPath, cacheDir]) {
    if (item) text = text.split(String(item)).join(item === inputPath ? '[audio]' : '[cache]');
  }
  return text
    .replace(/(token|secret|password|cookie|authorization)\s*[=:]\s*[^\s]+/gi, '$1=[redacted]')
    .replace(/https?:\/\/[^\s]+/gi, '[url]')
    .replace(/[\u0000-\u001f]/g, ' ')
    .trim().slice(-600);
}

class LFStemService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.env = options.env || process.env;
    this.resourcesPath = path.resolve(options.resourcesPath || process.resourcesPath || path.join(__dirname, '..'));
    this.cacheDir = path.resolve(options.cacheDir || path.join(os.homedir(), '.lumifield', 'stem-cache'));
    this.concurrency = Math.round(clamp(options.concurrency == null ? 1 : options.concurrency, 1, 2));
    this.spawn = options.spawn || spawn;
    this.spawnSync = options.spawnSync || spawnSync;
    this.utilityFork = typeof options.utilityFork === 'function' ? options.utilityFork : null;
    this.backendOverride = options.backend || null;
    this.sourceMaterializer = typeof options.sourceMaterializer === 'function' ? options.sourceMaterializer : null;
    this.preparedValidator = typeof options.preparedValidator === 'function' ? options.preparedValidator : null;
    this.tasks = new Map();
    this.queue = [];
    this.active = 0;
    fs.mkdirSync(path.join(this.cacheDir, '.work'), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(this.cacheDir, '.staging'), { recursive: true, mode: 0o700 });
  }

  childEnvironment() {
    const source = this.env;
    const allowed = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'LOCALAPPDATA', 'APPDATA', 'CUDA_VISIBLE_DEVICES', 'VIRTUAL_ENV', 'CONDA_PREFIX'];
    const result = {
      PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1',
      HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', NO_PROXY: '127.0.0.1,localhost',
    };
    for (const key of allowed) if (source[key]) result[key] = String(source[key]);
    const modelDir = String(source.LF_DEMUCS_MODEL_DIR || '').trim();
    if (modelDir && path.isAbsolute(modelDir)) {
      try { if (fs.statSync(modelDir).isDirectory()) result.TORCH_HOME = path.resolve(modelDir); } catch (_) {}
    }
    return result;
  }

  findOnPath(command) {
    const locator = process.platform === 'win32' ? 'where.exe' : 'which';
    try {
      const result = this.spawnSync(locator, [command], { encoding: 'utf8', windowsHide: true, timeout: 4000, env: this.childEnvironment() });
      if (result.status !== 0) return '';
      return String(result.stdout || '').split(/\r?\n/).map(item => item.trim()).find(regularFile) || '';
    } catch (_) { return ''; }
  }

  pythonBackend(candidate) {
    if (!regularFile(candidate)) return null;
    try {
      const probe = this.spawnSync(candidate, ['-c', 'import demucs'], { encoding: 'utf8', windowsHide: true, timeout: 8000, env: this.childEnvironment() });
      return probe.status === 0 ? { command: path.resolve(candidate), prefixArgs: ['-m', 'demucs'], kind: 'python-demucs' } : null;
    } catch (_) { return null; }
  }

  backendFromPath(candidate) {
    if (!candidate) return null;
    let resolved = path.resolve(String(candidate));
    try {
      if (fs.statSync(resolved).isDirectory()) {
        const names = process.platform === 'win32'
          ? ['demucs.exe', path.join('Scripts', 'demucs.exe'), path.join('python', 'python.exe')]
          : ['demucs', path.join('bin', 'demucs'), path.join('python', 'bin', 'python3')];
        for (const name of names) {
          const file = path.join(resolved, name);
          if (!regularFile(file)) continue;
          if (/python(?:3)?(?:\.exe)?$/i.test(path.basename(file))) return this.pythonBackend(file);
          return { command: file, prefixArgs: [], kind: 'demucs-executable' };
        }
        return null;
      }
    } catch (_) { return null; }
    if (!regularFile(resolved)) return null;
    if (/python(?:3)?(?:\.exe)?$/i.test(path.basename(resolved))) return this.pythonBackend(resolved);
    if (/\.py$/i.test(resolved)) {
      const python = this.findOnPath(process.platform === 'win32' ? 'python.exe' : 'python3');
      return python ? { command: python, prefixArgs: [resolved], kind: 'demucs-script' } : null;
    }
    return { command: resolved, prefixArgs: [], kind: 'demucs-executable' };
  }

  spleeterBackend() {
    let installedRuntime = '';
    try { installedRuntime = path.dirname(require.resolve('sherpa-onnx-win-x64/package.json')); } catch (_) {}
    const runtimeDir = [
      String(this.env.LF_SPLEETER_RUNTIME_DIR || '').trim(),
      unpackedPath(installedRuntime),
      path.join(this.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sherpa-onnx-win-x64'),
      path.join(__dirname, '..', 'node_modules', 'sherpa-onnx-win-x64'),
    ].map(candidate => path.resolve(candidate || '.')).find(candidate =>
      regularDirectory(candidate) &&
      regularFile(path.join(candidate, 'sherpa-onnx-c-api.dll')) &&
      regularFile(path.join(candidate, 'onnxruntime.dll')));
    const worker = [
      String(this.env.LF_SPLEETER_WORKER || '').trim(),
      unpackedPath(path.join(__dirname, 'lf-spleeter-worker.cjs')),
      path.join(__dirname, 'lf-spleeter-worker.cjs'),
    ].map(candidate => path.resolve(candidate || '.')).find(regularFile);
    const modelDir = [
      String(this.env.LF_SPLEETER_MODEL_DIR || '').trim(),
      path.join(this.resourcesPath, 'spleeter', SPLEETER_MODEL_ID),
      path.join(this.resourcesPath, 'resources', 'spleeter', SPLEETER_MODEL_ID),
      path.join(__dirname, '..', 'resources', 'spleeter', SPLEETER_MODEL_ID),
    ].map(candidate => path.resolve(candidate || '.')).find(candidate => {
      if (!regularDirectory(candidate)) return false;
      const vocals = path.join(candidate, 'vocals.fp16.onnx');
      const accompaniment = path.join(candidate, 'accompaniment.fp16.onnx');
      try {
        return fs.statSync(vocals).size === 19681017 && fs.statSync(accompaniment).size === 19681024;
      } catch (_) { return false; }
    });
    if (!runtimeDir || !worker || !modelDir) return null;
    return {
      command: process.execPath,
      prefixArgs: [worker],
      worker,
      utilityWorker: path.resolve(path.join(__dirname, 'lf-spleeter-worker.cjs')),
      runtimeDir,
      modelDir,
      kind: 'bundled-sherpa-onnx-spleeter',
      engine: 'sherpa-onnx-spleeter',
      model: SPLEETER_MODEL_ID,
      cacheVersion: SPLEETER_CACHE_VERSION,
    };
  }

  resolveBackend() {
    if (this.backendOverride) {
      const direct = this.backendFromPath(this.backendOverride.command || this.backendOverride);
      if (direct) {
        if (Array.isArray(this.backendOverride.prefixArgs)) direct.prefixArgs = this.backendOverride.prefixArgs.map(String);
        direct.kind = String(this.backendOverride.kind || direct.kind);
        return { ok: true, ...direct };
      }
    }
    const spleeter = this.spleeterBackend();
    if (spleeter) return { ok: true, ...spleeter };
    for (const candidate of [
      this.env.LF_DEMUCS_EXECUTABLE,
      this.env.LF_DEMUCS_PATH,
      path.join(this.resourcesPath, 'demucs'),
      path.join(this.resourcesPath, 'resources', 'demucs'),
      path.join(__dirname, '..', 'resources', 'demucs'),
    ]) {
      const backend = this.backendFromPath(candidate);
      if (backend) return { ok: true, ...backend };
    }
    const configuredPython = this.pythonBackend(String(this.env.LF_DEMUCS_PYTHON || ''));
    if (configuredPython) return { ok: true, ...configuredPython };
    const demucs = this.findOnPath(process.platform === 'win32' ? 'demucs.exe' : 'demucs');
    if (demucs) return { ok: true, command: demucs, prefixArgs: [], kind: 'system-demucs' };
    for (const name of process.platform === 'win32' ? ['python.exe', 'python3.exe'] : ['python3', 'python']) {
      const python = this.findOnPath(name);
      const backend = this.pythonBackend(python);
      if (backend) return { ok: true, ...backend, kind: 'system-python-demucs' };
    }
    return {
      ok: false,
      error: 'BLOCKED_EXTERNAL_CONFIG',
      missing: ['随包 Spleeter 或本机 Demucs 分离运行时'],
      message: '未检测到可用的离线人声分离引擎；不会下载模型、联网分离或用 EQ 假冒人声分离。',
    };
  }

  status() {
    const backend = this.resolveBackend();
    return backend.ok
      ? {
          ok: true, available: true, canStart: true, cacheAvailable: true, platformStemAvailable: true,
          localEngineAvailable: true, localOnly: true, backend: backend.kind,
          command: path.basename(backend.worker || backend.command), model: backend.model,
          modes: Object.keys(QUALITY_PRESETS),
        }
      : {
          ok: true, available: false, canStart: true, cacheAvailable: true, platformStemAvailable: true,
          localEngineAvailable: false, localOnly: true, modes: Object.keys(QUALITY_PRESETS),
          blockerCode: backend.error, missing: backend.missing, message: backend.message,
        };
  }

  qualityConfig(input = {}) {
    const quality = input.quality === 'high' ? 'high' : 'fast';
    const preset = QUALITY_PRESETS[quality];
    const envModel = quality === 'high' ? this.env.LF_DEMUCS_HIGH_MODEL : this.env.LF_DEMUCS_FAST_MODEL;
    return { quality, model: executableModel(input.model || envModel, preset.model), preset };
  }

  validateLocalInput(inputPath, config) {
    const candidatePath = String(inputPath || '').trim();
    if (!candidatePath || !path.isAbsolute(candidatePath) || /^\\\\/.test(candidatePath) || /^[a-z]+:\/\//i.test(candidatePath)) {
      return { ok: false, error: 'INVALID_LOCAL_AUDIO', message: '只允许选择本机绝对路径音频文件。' };
    }
    let realPath;
    try { realPath = fs.realpathSync.native(candidatePath); } catch (_) { return { ok: false, error: 'AUDIO_NOT_FOUND' }; }
    if (!regularFile(realPath) || !AUDIO_EXTENSIONS.has(path.extname(realPath).toLowerCase())) return { ok: false, error: 'UNSUPPORTED_AUDIO_FILE' };
    const stat = fs.statSync(realPath);
    const size = stat.size;
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_AUDIO_BYTES) return { ok: false, error: 'AUDIO_SIZE_INVALID' };
    return { ok: true, inputPath: realPath, size, mtimeMs: stat.mtimeMs, ...config };
  }

  validateInput(input = {}) {
    const config = this.qualityConfig(input);
    const prepared = input.prepared && typeof input.prepared === 'object' ? input.prepared : null;
    if (prepared) {
      const vocalUrl = String(prepared.vocalUrl || prepared.originalUrl || '').trim();
      const noVocalsUrl = String(prepared.noVocalsUrl || prepared.accompanimentUrl || '').trim();
      if (!vocalUrl || !noVocalsUrl || vocalUrl.length > 8192 || noVocalsUrl.length > 8192) {
        return { ok: false, error: 'INVALID_PLATFORM_STEMS', message: '平台伴奏地址不完整。' };
      }
      return {
        ok: true, kind: 'prepared', prepared: {
          vocalUrl, noVocalsUrl,
          originalUrl: String(prepared.originalUrl || vocalUrl),
          stemLayout: prepared.stemLayout === 'original-plus-accompaniment' ? 'original-plus-accompaniment' : 'separated-pair',
          provider: String(prepared.provider || '').slice(0, 32),
          sourceKey: String(prepared.sourceKey || '').slice(0, 512),
        },
        ...config,
      };
    }
    const inputPath = String(input.inputPath || input.path || '').trim();
    if (inputPath) return this.validateLocalInput(inputPath, config);
    const sourceRef = input.sourceRef && typeof input.sourceRef === 'object' ? input.sourceRef : null;
    if (!sourceRef || !this.sourceMaterializer) {
      return { ok: false, error: 'INVALID_LOCAL_AUDIO', message: '没有可处理的本地文件或真实播放源。' };
    }
    const currentAudioUrl = String(sourceRef.currentAudioUrl || '').trim();
    if (!currentAudioUrl || currentAudioUrl.length > 16384) return { ok: false, error: 'INVALID_AUDIO_URL' };
    return {
      ok: true, kind: 'deferred', sourceRef: {
        currentAudioUrl,
        sourceKey: String(sourceRef.sourceKey || '').slice(0, 512),
      },
      inputPath: '', size: 0, mtimeMs: 0, ...config,
    };
  }

  enqueue(input = {}) {
    const validated = this.validateInput(input);
    if (!validated.ok) return validated;
    const task = {
      id: token('stem'), input: validated, status: 'queued', phase: 'queued', progress: 0,
      createdAt: Date.now(), startedAt: null, finishedAt: null, child: null, stream: null,
      cancelled: false, settled: false, result: null, abortController: new AbortController(),
    };
    task.completion = new Promise(resolve => { task.resolve = resolve; });
    this.tasks.set(task.id, task);
    this.queue.push(task);
    this.emitProgress(task, 0, 'queued');
    queueMicrotask(() => this.pump());
    return this.snapshot(task);
  }

  snapshot(task) {
    if (!task) return { ok: false, error: 'TASK_NOT_FOUND' };
    return {
      ok: true, taskId: task.id, status: task.status, phase: task.phase,
      progress: task.progress, quality: task.input.quality, createdAt: task.createdAt,
      startedAt: task.startedAt, finishedAt: task.finishedAt,
      result: task.result && task.result.ok ? task.result : undefined,
      error: task.result && !task.result.ok ? task.result.error : undefined,
      message: task.result && !task.result.ok ? task.result.message : undefined,
      sourceKind: task.result && task.result.ok ? task.result.sourceKind : undefined,
    };
  }

  getTask(taskId) { return this.snapshot(this.tasks.get(String(taskId || ''))); }
  wait(taskId) {
    const task = this.tasks.get(String(taskId || ''));
    return task ? task.completion : Promise.resolve({ ok: false, error: 'TASK_NOT_FOUND' });
  }

  async separate(input, onProgress) {
    const queued = this.enqueue(input);
    if (!queued.ok) return queued;
    const listener = event => { if (event.taskId === queued.taskId && typeof onProgress === 'function') onProgress(event); };
    this.on('progress', listener);
    try { return await this.wait(queued.taskId); } finally { this.off('progress', listener); }
  }

  cancel(taskId) {
    const task = this.tasks.get(String(taskId || ''));
    if (!task) return { ok: false, error: 'TASK_NOT_FOUND' };
    if (task.settled) return { ok: false, error: 'TASK_ALREADY_FINISHED' };
    task.cancelled = true;
    try { task.abortController.abort(Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' })); } catch (_) {}
    if (task.status === 'queued') {
      this.queue = this.queue.filter(item => item !== task);
      this.complete(task, { ok: false, taskId: task.id, error: 'CANCELLED' });
    } else {
      try { if (task.stream) task.stream.destroy(Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' })); } catch (_) {}
      try {
        if (task.child) {
          const child = task.child;
          if (child.__lfUtilityProcess) child.kill();
          else child.kill('SIGTERM');
          const forced = setTimeout(() => {
            try {
              if (task.child === child) {
                if (child.__lfUtilityProcess) child.kill();
                else child.kill('SIGKILL');
              }
            } catch (_) {}
          }, 3000);
          if (forced.unref) forced.unref();
        }
      } catch (_) {}
    }
    return { ok: true, taskId: task.id, status: 'cancelling' };
  }

  emitProgress(task, progress, phase) {
    task.progress = Math.max(task.progress, clamp(progress, 0, 1));
    task.phase = String(phase || task.phase);
    this.emit('progress', { taskId: task.id, progress: task.progress, phase: task.phase, status: task.status, quality: task.input.quality });
  }

  complete(task, result) {
    if (task.settled) return;
    task.settled = true;
    task.finishedAt = Date.now();
    task.result = result;
    task.status = result.ok ? 'completed' : result.error === 'CANCELLED' ? 'cancelled' : 'failed';
    task.phase = task.status;
    task.progress = result.ok ? 1 : task.progress;
    task.resolve(result);
    this.emit(result.ok ? 'completed' : 'failed', { ...this.snapshot(task), result });
    const cleanup = setTimeout(() => this.tasks.delete(task.id), 60 * 60 * 1000);
    if (cleanup.unref) cleanup.unref();
  }

  pump() {
    while (this.active < this.concurrency && this.queue.length) {
      const task = this.queue.shift();
      if (!task || task.cancelled || task.settled) continue;
      this.active += 1;
      task.status = 'running'; task.startedAt = Date.now();
      this.runTask(task).then(result => this.complete(task, result)).catch(error => {
        const code = error && error.code;
        const known = /^(?:CANCELLED|BLOCKED_EXTERNAL_CONFIG|AUDIO_[A-Z0-9_]+|SOURCE_[A-Z0-9_]+|PLATFORM_[A-Z0-9_]+|INVALID_[A-Z0-9_]+)$/.test(String(code || ''));
        this.complete(task, {
          ok: false, taskId: task.id,
          error: known ? code : 'STEM_SEPARATION_FAILED',
          message: sanitizedFailure(error && error.message, task.input.inputPath, this.cacheDir),
        });
      }).finally(() => { this.active -= 1; this.pump(); });
    }
  }

  sha256File(filePath, task, startProgress = 0, endProgress = 0.12) {
    return new Promise((resolve, reject) => {
      const digest = crypto.createHash('sha256');
      let bytes = 0;
      const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
      task.stream = stream;
      stream.on('data', chunk => {
        if (task.cancelled) return stream.destroy(Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' }));
        digest.update(chunk); bytes += chunk.length;
        this.emitProgress(task, startProgress + (endProgress - startProgress) * Math.min(1, bytes / task.input.size), 'hashing');
      });
      stream.on('error', reject);
      stream.on('end', () => resolve(digest.digest('hex')));
      stream.on('close', () => { if (task.stream === stream) task.stream = null; });
    });
  }

  safeRemove(directory, category) {
    const root = path.join(this.cacheDir, category);
    const target = path.resolve(directory);
    if (!isInside(root, target) || target === path.resolve(root)) return;
    try { fs.rmSync(target, { recursive: true, force: true }); } catch (_) {}
  }

  cachedResult(cachePath, sourceSha256, task, expectedModel = task.input.model) {
    try {
      const manifestPath = path.join(cachePath, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const vocalPath = path.join(cachePath, 'vocals.wav');
      const noVocalsPath = path.join(cachePath, 'no_vocals.wav');
      if (manifest.sourceSha256 !== sourceSha256 || manifest.quality !== task.input.quality || manifest.model !== expectedModel) return null;
      if (!regularFile(vocalPath) || !regularFile(noVocalsPath) || fs.statSync(vocalPath).size !== manifest.vocals.bytes || fs.statSync(noVocalsPath).size !== manifest.noVocals.bytes) return null;
      return {
        ok: true, taskId: task.id, cached: true, sourceSha256,
        quality: task.input.quality, model: manifest.model, engine: manifest.engine,
        vocalPath, noVocalsPath, manifestPath,
      };
    } catch (_) { return null; }
  }

  async findStemFiles(root) {
    const found = {};
    const visit = async (directory, depth) => {
      if (depth > 6 || found.vocals && found.noVocals) return;
      const entries = await fs.promises.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const candidate = path.join(directory, entry.name);
        if (!isInside(root, candidate)) continue;
        if (entry.isDirectory()) await visit(candidate, depth + 1);
        else if (entry.isFile() && /^vocals\.wav$/i.test(entry.name)) found.vocals = candidate;
        else if (entry.isFile() && /^no_vocals\.wav$/i.test(entry.name)) found.noVocals = candidate;
      }
    };
    await visit(root, 0);
    return found;
  }

  async runDemucs(task, backend, workDir, startProgress = 0.15, endProgress = 0.9) {
    const args = [
      ...backend.prefixArgs,
      '--two-stems=vocals', '-n', task.input.model, '-o', workDir,
      ...task.input.preset.args,
      task.input.inputPath,
    ];
    return new Promise((resolve, reject) => {
      let tail = '';
      const child = this.spawn(backend.command, args, {
        cwd: workDir, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: this.childEnvironment(),
      });
      task.child = child;
      const consume = chunk => {
        const text = String(chunk || '');
        tail = `${tail}${text}`.slice(-12000);
        const matches = [...text.matchAll(/(?:^|\D)(\d{1,3})(?:\.\d+)?%/g)];
        if (matches.length) {
          const ratio = clamp(Number(matches.at(-1)[1]) / 100, 0, 1);
          this.emitProgress(task, startProgress + (endProgress - startProgress) * ratio, 'separating');
        }
      };
      if (child.stdout) child.stdout.on('data', consume);
      if (child.stderr) child.stderr.on('data', consume);
      child.once('error', error => reject(Object.assign(error, { code: error.code === 'ENOENT' ? 'BLOCKED_EXTERNAL_CONFIG' : error.code })));
      child.once('close', code => {
        task.child = null;
        if (task.cancelled) return reject(Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' }));
        if (code === 0) return resolve();
        const missing = /no module named demucs|not recognized|command not found|enoent|download|connection refused|urlopen|model.{0,30}not found|checkpoint.{0,30}not found|no such file.{0,120}\.th/i.test(tail);
        reject(Object.assign(new Error(sanitizedFailure(tail || `Demucs exited with ${code}`, task.input.inputPath, this.cacheDir)), { code: missing ? 'BLOCKED_EXTERNAL_CONFIG' : 'STEM_SEPARATION_FAILED' }));
      });
    });
  }

  startSpleeterWorker(backend, args, workDir) {
    let fork = this.utilityFork;
    if (!fork && process.versions && process.versions.electron) {
      try {
        const electron = require('electron');
        if (electron.utilityProcess && typeof electron.utilityProcess.fork === 'function') {
          fork = electron.utilityProcess.fork.bind(electron.utilityProcess);
        }
      } catch (_) {}
    }
    const env = this.childEnvironment();
    if (fork) {
      const child = fork(backend.utilityWorker || backend.worker, args, {
        cwd: workDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        serviceName: 'LumiField Offline Stem Separation',
      });
      child.__lfUtilityProcess = true;
      return child;
    }
    return this.spawn(backend.command, [backend.worker, ...args], {
      cwd: workDir,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    });
  }

  async runSpleeter(task, backend, workDir, startProgress = 0.15, endProgress = 0.9) {
    const configuredThreads = Number.parseInt(this.env.LF_SPLEETER_THREADS, 10);
    const threads = Number.isInteger(configuredThreads)
      ? Math.round(clamp(configuredThreads, 1, 8))
      : Math.max(1, Math.min(task.input.quality === 'high' ? 4 : 2, os.cpus().length || 1));
    const args = [
      '--input', task.input.inputPath,
      '--output', workDir,
      '--runtime', backend.runtimeDir,
      '--models', backend.modelDir,
      '--threads', String(threads),
    ];
    return new Promise((resolve, reject) => {
      let tail = '';
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };
      const child = this.startSpleeterWorker(backend, args, workDir);
      task.child = child;
      const consume = chunk => {
        const text = String(chunk || '');
        tail = `${tail}${text}`.slice(-12000);
        const matches = [...tail.matchAll(/LF_PROGRESS\s+(\d{1,3})\s+([A-Za-z0-9_-]+)/g)];
        if (matches.length) {
          const ratio = clamp(Number(matches.at(-1)[1]) / 100, 0, 1);
          this.emitProgress(task, startProgress + (endProgress - startProgress) * ratio, matches.at(-1)[2]);
        }
      };
      if (child.stdout) child.stdout.on('data', consume);
      if (child.stderr) child.stderr.on('data', consume);
      child.once('error', error => {
        const failure = error instanceof Error ? error : new Error(String(error || 'Utility process failed'));
        finish(Object.assign(failure, {
          code: failure.code === 'ENOENT' ? 'BLOCKED_EXTERNAL_CONFIG' : failure.code,
        }));
      });
      child.once(child.__lfUtilityProcess ? 'exit' : 'close', code => {
        task.child = null;
        if (task.cancelled) return finish(Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' }));
        if (code === 0) return finish();
        const reported = /LF_ERROR\s+([A-Z0-9_]+)/.exec(tail);
        const workerCode = reported && reported[1];
        let mapped = 'STEM_SEPARATION_FAILED';
        if (/^(?:SPLEETER_RUNTIME_MISSING|SPLEETER_RUNTIME_VERSION_MISMATCH|SPLEETER_RUNTIME_INTEGRITY_FAILED|SPLEETER_MODELS_MISSING|SPLEETER_MODEL_INTEGRITY_FAILED|SPLEETER_ENGINE_INIT_FAILED|SPLEETER_MODEL_INVALID)$/.test(workerCode || '')) {
          mapped = 'BLOCKED_EXTERNAL_CONFIG';
        } else if (/^(?:UNSUPPORTED_INPUT_CODEC|UNSUPPORTED_WAV_FORMAT)$/.test(workerCode || '')) {
          mapped = 'AUDIO_CODEC_UNSUPPORTED';
        } else if (/^(?:AUDIO_DECODE_FAILED|INVALID_WAV_FILE|INVALID_DECODED_AUDIO)$/.test(workerCode || '')) {
          mapped = 'AUDIO_DECODE_FAILED';
        } else if (workerCode === 'AUDIO_SIZE_INVALID') {
          mapped = 'AUDIO_SIZE_INVALID';
        } else if (/^(?:SPLEETER_OUTPUT_INVALID|STEM_WRITE_FAILED)$/.test(workerCode || '')) {
          mapped = 'INVALID_STEM_OUTPUT';
        }
        finish(Object.assign(new Error(sanitizedFailure(tail || `Spleeter worker exited with ${code}`, task.input.inputPath, this.cacheDir)), { code: mapped }));
      });
    });
  }

  async runTask(task) {
    if (task.cancelled) return { ok: false, taskId: task.id, error: 'CANCELLED' };
    if (task.input.kind === 'prepared') {
      this.emitProgress(task, 0.05, 'validating-platform-stems');
      if (this.preparedValidator) {
        let validation;
        try {
          validation = await this.preparedValidator(task.input.prepared, {
            taskId: task.id,
            signal: task.abortController.signal,
            onProgress: value => this.emitProgress(task, 0.05 + 0.85 * clamp(value, 0, 1), 'validating-platform-stems'),
          });
        } catch (error) {
          if (task.cancelled || error && (error.name === 'AbortError' || error.code === 'CANCELLED')) {
            return { ok: false, taskId: task.id, error: 'CANCELLED' };
          }
          return {
            ok: false, taskId: task.id,
            error: error && error.code || 'PLATFORM_STEM_VALIDATION_FAILED',
            message: sanitizedFailure(error && error.message, '', this.cacheDir),
          };
        }
        if (!validation || !validation.ok) {
          return {
            ok: false, taskId: task.id,
            error: validation && validation.error || 'PLATFORM_STEM_VALIDATION_FAILED',
            message: validation && validation.message || '平台伴奏当前不可读取。',
          };
        }
      }
      if (task.cancelled) return { ok: false, taskId: task.id, error: 'CANCELLED' };
      this.emitProgress(task, 1, 'completed');
      return {
        ok: true, taskId: task.id, cached: false, sourceKind: 'platform',
        platformDirect: true, quality: task.input.quality,
        ...task.input.prepared,
      };
    }

    let hashStart = 0;
    let hashEnd = 0.12;
    if (task.input.kind === 'deferred') {
      this.emitProgress(task, 0.01, 'materializing');
      let materialized;
      try {
        materialized = await this.sourceMaterializer(task.input.sourceRef, {
          taskId: task.id,
          signal: task.abortController.signal,
          onProgress: value => this.emitProgress(task, 0.01 + 0.11 * clamp(value, 0, 1), 'materializing'),
        });
      } catch (error) {
        if (task.cancelled || error && (error.name === 'AbortError' || error.code === 'CANCELLED')) {
          return { ok: false, taskId: task.id, error: 'CANCELLED' };
        }
        return {
          ok: false, taskId: task.id,
          error: error && error.code || 'SOURCE_MATERIALIZE_FAILED',
          message: sanitizedFailure(error && error.message, '', this.cacheDir),
        };
      }
      if (!materialized || !materialized.ok) {
        return {
          ok: false, taskId: task.id,
          error: materialized && materialized.error || 'SOURCE_MATERIALIZE_FAILED',
          message: materialized && materialized.message || '无法读取当前歌曲的可解码音频。',
        };
      }
      const local = this.validateLocalInput(materialized.inputPath, {
        quality: task.input.quality, model: task.input.model, preset: task.input.preset,
      });
      if (!local.ok) return { ...local, taskId: task.id };
      task.input = {
        ...task.input, ...local, kind: 'local',
        sourceMaterialized: true, sourceCached: !!materialized.cached,
      };
      hashStart = 0.12;
      hashEnd = 0.22;
    }

    const sourceSha256 = await this.sha256File(task.input.inputPath, task, hashStart, hashEnd);
    const sourceAfterHash = fs.statSync(task.input.inputPath);
    if (sourceAfterHash.size !== task.input.size || sourceAfterHash.mtimeMs !== task.input.mtimeMs) return { ok: false, taskId: task.id, error: 'AUDIO_CHANGED_DURING_READ' };
    const legacyCacheKey = crypto.createHash('sha256').update(`lf-demucs-v1\0${sourceSha256}\0${task.input.quality}\0${task.input.model}`).digest('hex');
    let cachePath = path.join(this.cacheDir, legacyCacheKey);
    const legacyHit = this.cachedResult(cachePath, sourceSha256, task);
    if (legacyHit) {
      this.emitProgress(task, 1, 'cache-hit');
      return { ...legacyHit, sourceKind: 'cache' };
    }
    const spleeterCacheKey = crypto.createHash('sha256').update(`${SPLEETER_CACHE_VERSION}\0${sourceSha256}\0${task.input.quality}\0${SPLEETER_MODEL_ID}`).digest('hex');
    const spleeterCachePath = path.join(this.cacheDir, spleeterCacheKey);
    const spleeterHit = this.cachedResult(spleeterCachePath, sourceSha256, task, SPLEETER_MODEL_ID);
    if (spleeterHit) {
      this.emitProgress(task, 1, 'cache-hit');
      return { ...spleeterHit, sourceKind: 'cache' };
    }
    const backend = this.resolveBackend();
    if (!backend.ok) {
      return {
        ...backend, taskId: task.id,
        message: `${backend.message} 当前歌曲未命中本地 stem 缓存。`,
      };
    }
    const effectiveModel = backend.engine === 'sherpa-onnx-spleeter' ? backend.model : task.input.model;
    if (backend.cacheVersion) {
      const cacheKey = crypto.createHash('sha256').update(`${backend.cacheVersion}\0${sourceSha256}\0${task.input.quality}\0${effectiveModel}`).digest('hex');
      cachePath = path.join(this.cacheDir, cacheKey);
      const hit = this.cachedResult(cachePath, sourceSha256, task, effectiveModel);
      if (hit) {
        this.emitProgress(task, 1, 'cache-hit');
        return { ...hit, sourceKind: 'cache' };
      }
    }
    const workDir = path.join(this.cacheDir, '.work', task.id);
    const stagingDir = path.join(this.cacheDir, '.staging', task.id);
    this.safeRemove(workDir, '.work'); this.safeRemove(stagingDir, '.staging');
    fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
    try {
      const separationStart = task.input.sourceMaterialized ? 0.24 : 0.15;
      this.emitProgress(task, separationStart, 'separating');
      if (backend.engine === 'sherpa-onnx-spleeter') {
        await this.runSpleeter(task, backend, workDir, separationStart, 0.9);
      } else {
        await this.runDemucs(task, backend, workDir, separationStart, 0.9);
      }
      if (task.cancelled) return { ok: false, taskId: task.id, error: 'CANCELLED' };
      this.emitProgress(task, 0.92, 'validating');
      const stems = await this.findStemFiles(workDir);
      if (!stems.vocals || !stems.noVocals || fs.statSync(stems.vocals).size < 44 || fs.statSync(stems.noVocals).size < 44) {
        return { ok: false, taskId: task.id, error: 'INVALID_STEM_OUTPUT', message: '离线分离引擎未生成有效的人声与伴奏双轨。' };
      }
      fs.mkdirSync(stagingDir, { recursive: true, mode: 0o700 });
      const stagedVocal = path.join(stagingDir, 'vocals.wav');
      const stagedNoVocals = path.join(stagingDir, 'no_vocals.wav');
      await fs.promises.copyFile(stems.vocals, stagedVocal, fs.constants.COPYFILE_EXCL);
      await fs.promises.copyFile(stems.noVocals, stagedNoVocals, fs.constants.COPYFILE_EXCL);
      const sourceSize = task.input.size;
      task.input.size = fs.statSync(stagedVocal).size;
      const vocalsSha256 = await this.sha256File(stagedVocal, task, 0.94, 0.97);
      task.input.size = fs.statSync(stagedNoVocals).size;
      const noVocalsSha256 = await this.sha256File(stagedNoVocals, task, 0.97, 0.99);
      task.input.size = sourceSize;
      const manifest = {
        format: 2, sourceSha256, quality: task.input.quality, model: effectiveModel, createdAt: Date.now(),
        engine: backend.engine || 'demucs-local', localOnly: true,
        licenses: backend.engine === 'sherpa-onnx-spleeter'
          ? { runtime: 'Apache-2.0', ffi: 'MIT', onnxRuntime: 'MIT', model: 'MIT' }
          : { runtime: 'MIT' },
        vocals: { file: 'vocals.wav', bytes: fs.statSync(stagedVocal).size, sha256: vocalsSha256 },
        noVocals: { file: 'no_vocals.wav', bytes: fs.statSync(stagedNoVocals).size, sha256: noVocalsSha256 },
      };
      await fs.promises.writeFile(path.join(stagingDir, 'manifest.json'), JSON.stringify(manifest, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      try { await fs.promises.rename(stagingDir, cachePath); }
      catch (error) {
        const raceHit = this.cachedResult(cachePath, sourceSha256, task, effectiveModel);
        if (!raceHit) throw error;
        this.safeRemove(stagingDir, '.staging');
        return raceHit;
      }
      this.emitProgress(task, 1, 'completed');
      return {
        ok: true, taskId: task.id, cached: false, sourceKind: 'local-separation',
        sourceSha256, quality: task.input.quality, model: effectiveModel,
        engine: backend.kind,
        engineLicense: backend.engine === 'sherpa-onnx-spleeter' ? 'Apache-2.0; model MIT' : 'Demucs MIT',
        vocalPath: path.join(cachePath, 'vocals.wav'),
        noVocalsPath: path.join(cachePath, 'no_vocals.wav'),
        manifestPath: path.join(cachePath, 'manifest.json'),
      };
    } catch (error) {
      if (error && error.code === 'CANCELLED') return { ok: false, taskId: task.id, error: 'CANCELLED' };
      if (error && error.code === 'BLOCKED_EXTERNAL_CONFIG') return { ok: false, taskId: task.id, error: 'BLOCKED_EXTERNAL_CONFIG', message: sanitizedFailure(error.message, task.input.inputPath, this.cacheDir) };
      throw error;
    } finally {
      this.safeRemove(workDir, '.work');
      if (fs.existsSync(stagingDir)) this.safeRemove(stagingDir, '.staging');
    }
  }
}

module.exports = { LFStemService, QUALITY_PRESETS, AUDIO_EXTENSIONS };
