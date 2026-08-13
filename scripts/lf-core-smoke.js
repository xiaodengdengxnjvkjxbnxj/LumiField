'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WallpaperImportService } = require('../desktop/wallpaper-import-service');
const { LFStemService } = require('../desktop/lf-stem-service');
const { validate, loadSecureLoginConfig, saveSecureLoginConfig } = require('../desktop/lf-secure-login-config');

require('../public/lf-audio-tools.js');

function file(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

function fakeWave(bytes = 256) {
  const value = Buffer.alloc(Math.max(48, bytes));
  value.write('RIFF', 0); value.writeUInt32LE(value.length - 8, 4); value.write('WAVEfmt ', 8);
  value.writeUInt32LE(16, 16); value.writeUInt16LE(1, 20); value.writeUInt16LE(1, 22);
  value.writeUInt32LE(8000, 24); value.writeUInt32LE(16000, 28); value.writeUInt16LE(2, 32);
  value.writeUInt16LE(16, 34); value.write('data', 36); value.writeUInt32LE(value.length - 44, 40);
  return value;
}

function secureStorageMock() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`lf-secure:${Buffer.from(value, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: value => {
      const text = Buffer.from(value).toString('utf8');
      if (!text.startsWith('lf-secure:')) throw new Error('invalid ciphertext');
      return Buffer.from(text.slice(10), 'base64').toString('utf8');
    },
  };
}

function fakeAudioGraph() {
  class Node {
    constructor() { this.connections = []; }
    connect(node) { this.connections.push(node); return node; }
    disconnect() { this.connections = []; }
  }
  class Gain extends Node {
    constructor() {
      super();
      this.gain = {
        value: 1,
        cancelScheduledValues() {},
        setTargetAtTime(value) { this.value = value; },
      };
    }
  }
  class BufferSource extends Node {
    constructor() {
      super();
      this.buffer = null;
      this.playbackRate = {
        value: 1,
        cancelScheduledValues() {},
        setValueAtTime(value) { this.value = value; },
      };
    }
    start() {}
    stop() {}
  }
  const context = {
    currentTime: 0, state: 'running', destination: new Node(),
    createGain: () => new Gain(), createBufferSource: () => new BufferSource(),
  };
  return { context, buffer: { duration: 180 } };
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-core-smoke-'));
  const checks = {};
  try {
    const safeStorage = secureStorageMock();
    const secureFile = path.join(root, 'secure', 'providers.bin');
    assert.equal(validate('wechat', { scope: 'profile' }).error, 'INVALID_SCOPE');
    assert.equal(validate('qq', { redirectUri: 'http://remote.example/callback' }).error, 'INVALID_REDIRECT_URI');
    let saved = saveSecureLoginConfig({
      safeStorage, filePath: secureFile, provider: 'wechat', env: {},
      input: { appId: 'wx-app-123', secret: 'private-secret', redirectUri: 'https://account.example/callback', scope: 'snsapi_login', reviewStatus: 'pending' },
    });
    assert(saved.ok && saved.secretStored);
    assert(!fs.readFileSync(secureFile).toString('utf8').includes('private-secret'));
    saved = saveSecureLoginConfig({
      safeStorage, filePath: secureFile, provider: 'wechat', env: {},
      input: { appId: 'wx-app-456', secret: '', redirectUri: 'https://account.example/callback', scope: 'snsapi_login', reviewStatus: 'approved' },
    });
    assert(saved.ok && saved.secretStored);
    const loadedEnv = {};
    assert(loadSecureLoginConfig({ safeStorage, filePath: secureFile, env: loadedEnv }).ok);
    assert.equal(loadedEnv.LF_WECHAT_APP_SECRET, 'private-secret');
    assert.equal(loadedEnv.LF_WECHAT_APP_ID, 'wx-app-456');
    checks.secureLoginConfig = true;

    const steam = path.join(root, 'steam');
    const workshop = path.join(steam, 'steamapps', 'workshop', 'content', '431960');
    const videoProject = path.join(workshop, '1001');
    file(videoProject, 'project.json', JSON.stringify({ title: 'Video One', type: 'video', file: 'wall.mp4' }));
    file(videoProject, 'wall.mp4', Buffer.alloc(4096, 7));
    const webProject = path.join(workshop, '1002');
    file(webProject, 'project.json', JSON.stringify({ title: 'Web One', type: 'web', file: 'index.html' }));
    file(webProject, 'index.html', '<!doctype html><title>Local</title><script src="app.js"></script>');
    file(webProject, 'app.js', 'document.body.dataset.ready="1";');
    file(webProject, 'blocked.exe', Buffer.alloc(16));
    const sceneProject = path.join(workshop, '1003');
    file(sceneProject, 'project.json', JSON.stringify({ title: 'Scene One', type: 'scene', file: 'scene.json' }));
    file(sceneProject, 'scene.json', '{}');
    const qian = path.join(root, 'qianqian');
    file(qian, 'one.mp4', Buffer.alloc(1111, 1));
    file(qian, 'two.mp4', Buffer.alloc(2222, 2));
    const wallpaperDir = path.join(root, 'wallpaper-cache');
    const wallpapers = new WallpaperImportService({ storageDir: wallpaperDir, steamRoots: [steam], qianqianRoots: [qian] });
    const scan = wallpapers.scan('wallpaper_engine');
    assert(scan.ok && scan.projects.length === 3);
    const video = wallpapers.import('wallpaper_engine', '1001');
    assert(video.ok && video.kind === 'video' && video.bytes === 4096 && /^\/api\/local-wallpaper\//.test(video.url));
    const web = wallpapers.import('wallpaper_engine', '1002');
    assert(web.ok && web.kind === 'web' && web.files === 3);
    assert(!fs.existsSync(path.join(wallpaperDir, web.importId, 'blocked.exe')));
    const scene = wallpapers.import('wallpaper_engine', '1003');
    assert.equal(scene.error, 'UNSUPPORTED_SCENE_PROJECT');
    const qianScan = wallpapers.scan('qianqian');
    assert.equal(qianScan.projects.length, 2);
    const qianSizes = qianScan.projects.map(item => wallpapers.import('qianqian', item.id).bytes).sort((a, b) => a - b);
    assert.deepEqual(qianSizes, [1111, 2222]);
    checks.wallpaperSandboxImport = true;

    const noRuntime = new LFStemService({ cacheDir: path.join(root, 'stems-missing'), env: { PATH: '' } });
    noRuntime.spleeterBackend = () => null;
    noRuntime.pythonBackend = () => null;
    noRuntime.findOnPath = () => '';
    assert.equal(noRuntime.status().blockerCode, 'BLOCKED_EXTERNAL_CONFIG');
    const driver = file(root, 'fake-demucs.js', [
      "'use strict';", "const fs=require('fs'),path=require('path');", "const args=process.argv.slice(2);",
      "const out=args[args.indexOf('-o')+1],model=args[args.indexOf('-n')+1],input=args[args.length-1];",
      "const target=path.join(out,model,path.basename(input,path.extname(input)));fs.mkdirSync(target,{recursive:true});",
      "fs.copyFileSync(input,path.join(target,'vocals.wav'));fs.copyFileSync(input,path.join(target,'no_vocals.wav'));console.log('100%');",
    ].join('\n'));
    const audio = file(root, 'source.wav', fakeWave(512));
    const stems = new LFStemService({
      cacheDir: path.join(root, 'stems'), env: { PATH: process.env.PATH || '' },
      backend: { command: process.execPath, prefixArgs: [driver], kind: 'test-local-demucs' },
    });
    const first = await stems.separate({ inputPath: audio, quality: 'fast' });
    assert(first.ok && !first.cached && fs.statSync(first.vocalPath).size === 512 && fs.statSync(first.noVocalsPath).size === 512);
    const second = await stems.separate({ inputPath: audio, quality: 'fast' });
    assert(second.ok && second.cached && second.sourceSha256 === first.sourceSha256);
    checks.localStemAndCache = true;

    const graph = fakeAudioGraph();
    const mixer = globalThis.LFAudioTools.createStemMixer({
      audioContext: graph.context, vocalBuffer: graph.buffer, noVocalsBuffer: graph.buffer, autoConnect: false,
    });
    let balance = mixer.setBalance(-1);
    assert(balance.originalAtCenter && balance.vocalGain === 1 && Math.abs(balance.noVocalsGain) < 1e-9);
    balance = mixer.setBalance(0);
    assert(balance.originalAtCenter && balance.vocalGain === 1 && balance.noVocalsGain === 1);
    balance = mixer.setBalance(1);
    assert(balance.noVocalsGain === 1 && Math.abs(balance.vocalGain) < 1e-9);
    assert.equal(mixer.setPlaybackRate(2).speed, 2);
    mixer.seek(42); assert.equal(mixer.currentTime, 42);
    mixer.destroy();
    checks.stemMixerDirectionSync = true;

    console.log(JSON.stringify({ ok: true, checks }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error && error.stack || error); process.exitCode = 1; });
