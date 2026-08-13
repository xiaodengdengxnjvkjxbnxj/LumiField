'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LFStemService } = require('../desktop/lf-stem-service');

function wave(bytes = 512) {
  const value = Buffer.alloc(Math.max(48, bytes));
  value.write('RIFF', 0); value.writeUInt32LE(value.length - 8, 4); value.write('WAVEfmt ', 8);
  value.writeUInt32LE(16, 16); value.writeUInt16LE(1, 20); value.writeUInt16LE(1, 22);
  value.writeUInt32LE(8000, 24); value.writeUInt32LE(16000, 28); value.writeUInt16LE(2, 32);
  value.writeUInt16LE(16, 34); value.write('data', 36); value.writeUInt32LE(value.length - 44, 40);
  return value;
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-problem5-backend-'));
  const checks = {};
  try {
    const audio = path.join(root, 'source.wav');
    fs.writeFileSync(audio, wave());
    const driver = path.join(root, 'fake-demucs.js');
    fs.writeFileSync(driver, [
      "'use strict';",
      "const fs=require('fs'),path=require('path'),args=process.argv.slice(2);",
      "const out=args[args.indexOf('-o')+1],model=args[args.indexOf('-n')+1],input=args[args.length-1];",
      "const target=path.join(out,model,path.basename(input,path.extname(input)));",
      "fs.mkdirSync(target,{recursive:true});",
      "fs.copyFileSync(input,path.join(target,'vocals.wav'));",
      "fs.copyFileSync(input,path.join(target,'no_vocals.wav'));",
      "console.log('25%');console.log('100%');",
    ].join('\n'));

    const cacheDir = path.join(root, 'cache');
    const backend = { command: process.execPath, prefixArgs: [driver], kind: 'fixture-demucs' };
    const generator = new LFStemService({ cacheDir, env: { PATH: '' }, backend });
    const generated = await generator.separate({ inputPath: audio, quality: 'fast' });
    assert(generated.ok && !generated.cached && generated.sourceKind === 'local-separation');

    const noEngine = new LFStemService({ cacheDir, env: { PATH: '' } });
    noEngine.spleeterBackend = () => null;
    noEngine.pythonBackend = () => null;
    noEngine.findOnPath = () => '';
    const capability = noEngine.status();
    assert(capability.ok && !capability.available && capability.canStart);
    assert.equal(capability.blockerCode, 'BLOCKED_EXTERNAL_CONFIG');
    const cached = await noEngine.separate({ inputPath: audio, quality: 'fast' });
    assert(cached.ok && cached.cached && cached.sourceKind === 'cache');
    checks.cacheBeforeEngineProbe = true;

    const direct = new LFStemService({
      cacheDir: path.join(root, 'direct'),
      env: { PATH: '' },
      preparedValidator: async (_prepared, options) => {
        options.onProgress(0.5); options.onProgress(1);
        return { ok: true };
      },
    });
    const platform = await direct.separate({
      prepared: {
        vocalUrl: '/api/audio?url=vocal', noVocalsUrl: '/api/audio?url=accompaniment',
        provider: 'qq', stemLayout: 'separated-pair',
      },
    });
    assert(platform.ok && platform.platformDirect && platform.sourceKind === 'platform');
    checks.platformStemPriority = true;

    const progress = [];
    const deferred = new LFStemService({
      cacheDir: path.join(root, 'deferred'), env: { PATH: '' }, backend,
      sourceMaterializer: async (_source, options) => {
        options.onProgress(0.25); options.onProgress(0.75); options.onProgress(1);
        return { ok: true, inputPath: audio };
      },
    });
    deferred.on('progress', event => progress.push(event.progress));
    const resolved = await deferred.separate({ sourceRef: { currentAudioUrl: 'http://lf.invalid/api/audio', sourceKey: 'qq:1' } });
    assert(resolved.ok);
    assert(progress.length > 5 && progress.every((value, index) => index === 0 || value >= progress[index - 1]));
    checks.monotonicMaterializeAndSeparateProgress = true;

    const slow = new LFStemService({
      cacheDir: path.join(root, 'cancel'), env: { PATH: '' },
      sourceMaterializer: (_source, options) => new Promise(resolve => {
        options.signal.addEventListener('abort', () => resolve({ ok: false, error: 'CANCELLED' }), { once: true });
      }),
    });
    const queued = slow.enqueue({ sourceRef: { currentAudioUrl: 'http://lf.invalid/api/audio' } });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert(slow.cancel(queued.taskId).ok);
    const cancelled = await slow.wait(queued.taskId);
    assert.equal(cancelled.error, 'CANCELLED');
    assert.deepEqual(fs.readdirSync(path.join(root, 'cancel', '.work')), []);
    assert.deepEqual(fs.readdirSync(path.join(root, 'cancel', '.staging')), []);
    checks.cancellationAndCleanup = true;

    console.log(JSON.stringify({ ok: true, checks, capability }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
