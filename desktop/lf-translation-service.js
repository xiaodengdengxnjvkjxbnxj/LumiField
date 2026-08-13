'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const { Worker } = require('worker_threads');
const { setMaxListeners } = require('events');

const gunzip = promisify(zlib.gunzip);
const MODEL_SOURCE = 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/db/models.json';
const MODEL_SNAPSHOT = '2026-07-26T00:40:13Z';
const LOCAL_TRANSLATION_TIMEOUT_MS = 30000;
const MODELS = {
  enzh: {
    from: 'en', to: 'zh',
    files: {
      lex: { name: 'lex.gz', compressedSha256: '806f75821c0b838f4a8f4afe5bab3db8289cb7e5187753ba04c3bceadd75687a' },
      model: {
        name: 'model.gz',
        compressedSha256: '7f255403b3bb2502f08ac4d5ca397a8a5a13f899d2f2e987a4934e089d241d16',
        sha256: '4e5accc141373565ddc8fa1565bceaa8d0c3482a82cab8131c719ebcc6c2157c',
      },
      srcvocab: { name: 'srcvocab.gz', compressedSha256: '7846e3c236388390f4e5d321f8413d67f34c1bab5f066165eeb673bfd07607cc' },
      trgvocab: { name: 'trgvocab.gz', compressedSha256: '4d641ce165b1f8478ee2ffb5149d2d46fab3779dc8fa1e9b97f9af1d2206c091' },
    },
  },
  jaen: {
    from: 'ja', to: 'en',
    files: {
      lex: { name: 'lex.gz', compressedSha256: '438152f5ccd982edb43e88ef51305e3ae7c7b66ee5c20a8fa425e9f1822f9b9b' },
      model: {
        name: 'model.gz',
        compressedSha256: 'ae56ffbb5556d8e4240b2f208a7c7a2449a4b627ac9d673981ed29eaadaab79d',
        sha256: '3a603e20bfe1be86071913f9e23ab5129075bc0a8490151020ac4821e4f17302',
      },
      vocab: { name: 'vocab.gz', compressedSha256: '12d693f5055525d5cc1e133c8c1b8ed787c77b9bb797400d9a14382ac69c1236' },
    },
  },
};

let translatorPromise;
let requestSerial = 0;
let activeRequests = 0;
let idleShutdownTimer = null;
let resetPromise = Promise.resolve();

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function modelRoot() {
  const bundled = path.join(__dirname, 'assets', 'translation', 'models');
  return bundled;
}

function unpackedPath(file) {
  const unpacked = file.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
  try { return require('fs').existsSync(unpacked) ? unpacked : file; } catch (_) { return file; }
}

async function readVerifiedPart(modelId, part) {
  const spec = MODELS[modelId] && MODELS[modelId].files[part];
  if (!spec) throw Object.assign(new Error('LOCAL_TRANSLATION_MODEL_PART_MISSING'), { code: 'LOCAL_TRANSLATION_MODEL_PART_MISSING' });
  const compressed = await fs.readFile(path.join(modelRoot(), modelId, spec.name));
  if (sha256(compressed) !== spec.compressedSha256) {
    throw Object.assign(new Error('LOCAL_TRANSLATION_MODEL_INTEGRITY_FAILED'), { code: 'LOCAL_TRANSLATION_MODEL_INTEGRITY_FAILED' });
  }
  const unpacked = await gunzip(compressed);
  if (spec.sha256 && sha256(unpacked) !== spec.sha256) {
    throw Object.assign(new Error('LOCAL_TRANSLATION_MODEL_INTEGRITY_FAILED'), { code: 'LOCAL_TRANSLATION_MODEL_INTEGRITY_FAILED' });
  }
  return unpacked.buffer.slice(unpacked.byteOffset, unpacked.byteOffset + unpacked.byteLength);
}

async function createTranslator() {
  const bergamot = await import('@browsermt/bergamot-translator');
  const backing = new bergamot.TranslatorBacking({ pivotLanguage: 'en', cacheSize: 128 });
  backing.loadWorker = async function loadWorker() {
    const worker = new Worker(unpackedPath(path.join(__dirname, 'lf-translation-worker.cjs')));
    let serial = 0;
    const pending = new Map();
    let exited = false;
    const rejectPending = error => {
      pending.forEach(request => request.reject(error));
      pending.clear();
    };
    const call = (name, ...args) => new Promise((resolve, reject) => {
      if (exited) {
        reject(Object.assign(new Error('LOCAL_TRANSLATION_WORKER_EXITED'), { code: 'LOCAL_TRANSLATION_WORKER_EXITED' }));
        return;
      }
      const id = ++serial;
      pending.set(id, { resolve, reject, name });
      try { worker.postMessage({ id, name, args }); }
      catch (error) { pending.delete(id); reject(error); }
    });
    worker.on('message', ({ id, result, error }) => {
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      if (error) request.reject(Object.assign(new Error(error.message || request.name + ' failed'), error));
      else request.resolve(result);
    });
    worker.on('error', error => {
      exited = true;
      error.code = error.code || 'LOCAL_TRANSLATION_WORKER_FAILED';
      rejectPending(error);
      this.onerror(error);
    });
    worker.on('exit', code => {
      exited = true;
      rejectPending(Object.assign(new Error('LOCAL_TRANSLATION_WORKER_EXITED'), {
        code: 'LOCAL_TRANSLATION_WORKER_EXITED',
        exitCode: code,
      }));
    });
    try {
      await call('initialize', this.options);
    } catch (error) {
      exited = true;
      rejectPending(error);
      await worker.terminate().catch(() => {});
      throw error;
    }
    worker.unref();
    return {
      worker,
      exports: new Proxy({}, {
        get(_target, name) {
          if (name !== 'then') return (...args) => call(name, ...args);
          return undefined;
        },
      }),
    };
  };
  backing.registry = Promise.resolve(Object.values(MODELS).map(model => ({
    from: model.from,
    to: model.to,
    files: Object.fromEntries(Object.entries(model.files).map(([part, file]) => [part, { name: file.name }])),
  })));
  backing.loadTranslationModel = async ({ from, to }) => {
    const modelId = Object.keys(MODELS).find(key => MODELS[key].from === from && MODELS[key].to === to);
    if (!modelId) throw Object.assign(new Error('LOCAL_TRANSLATION_UNSUPPORTED_LANGUAGE'), { code: 'LOCAL_TRANSLATION_UNSUPPORTED_LANGUAGE' });
    const files = MODELS[modelId].files;
    const loaded = Object.fromEntries(await Promise.all(Object.keys(files).map(async part => [part, await readVerifiedPart(modelId, part)])));
    return {
      model: loaded.model,
      shortlist: loaded.lex,
      vocabs: loaded.vocab ? [loaded.vocab] : [loaded.srcvocab, loaded.trgvocab],
      config: {},
    };
  };
  return new bergamot.BatchTranslator({
    workers: 1,
    batchSize: 8,
    cacheSize: 128,
    pivotLanguage: 'en',
    onerror: error => console.error('[LF translation worker]', error && error.message || error),
  }, backing);
}

function getTranslator() {
  if (idleShutdownTimer) {
    clearTimeout(idleShutdownTimer);
    idleShutdownTimer = null;
  }
  if (!translatorPromise) {
    const created = resetPromise.then(() => createTranslator());
    translatorPromise = created;
    created.catch(() => {
      if (translatorPromise === created) translatorPromise = null;
    });
  }
  return translatorPromise;
}

function invalidateTranslator(expectedPromise) {
  if (expectedPromise && translatorPromise !== expectedPromise) return resetPromise;
  const pending = translatorPromise;
  if (!pending) return resetPromise;
  translatorPromise = null;
  resetPromise = resetPromise.then(async () => {
    const translator = await pending.catch(() => null);
    if (translator) await translator.delete().catch(() => {});
  });
  return resetPromise;
}

async function shutdown() {
  if (idleShutdownTimer) {
    clearTimeout(idleShutdownTimer);
    idleShutdownTimer = null;
  }
  await invalidateTranslator();
}

function scheduleIdleShutdown() {
  if (idleShutdownTimer) clearTimeout(idleShutdownTimer);
  idleShutdownTimer = setTimeout(() => {
    idleShutdownTimer = null;
    if (activeRequests === 0) shutdown().catch(error => console.error('[LF translation shutdown]', error && error.message || error));
  }, 45000);
  if (idleShutdownTimer.unref) idleShutdownTimer.unref();
}

function detectLanguage(text) {
  const value = String(text || '');
  if (/[\u3040-\u30ff]/u.test(value)) return 'ja';
  if (/[A-Za-z]/.test(value)) return 'en';
  if (/[\u3400-\u9fff]/u.test(value)) return 'zh';
  return 'none';
}

function looksClearlyChinese(text) {
  return /(?:你好|谢谢|什么|怎么|我们|你们|他们|这里|那里|没有|不是|可以|因为|所以|已经|还是|这个|那个|歌曲|世界)/u.test(String(text || ''))
    || /[这吗呢哪谁们么]/u.test(String(text || ''));
}

function inferSourceLanguage(input, lines) {
  const requested = String(input && input.sourceLanguage || 'auto').toLowerCase().split('-')[0];
  if (requested === 'ja' || requested === 'en' || requested === 'zh') return requested;
  const song = input && input.song || {};
  const metadata = String(song.language || song.lang || song.locale || '').toLowerCase();
  if (/^(?:ja|jp)(?:[-_]|$)/.test(metadata)) return 'ja';
  if (/^(?:zh|cn)(?:[-_]|$)/.test(metadata)) return 'zh';
  const context = Array.isArray(input && input.languageContext) && input.languageContext.length
    ? input.languageContext
    : lines;
  const joined = context.map(value => String(value || '')).join('\n');
  if (/[\u3040-\u30ff]/u.test(joined)) return 'ja';
  if (/[気駅図円沢浜広辺桜竜処歩徳応変実読楽帰続]/u.test(joined) && !/[气图圆泽滨广边龙处德应变实读乐归续]/u.test(joined)) return 'ja';
  return 'auto';
}

function abortError(code = 'TRANSLATION_ABORTED') {
  return Object.assign(new Error(code), { name: 'AbortError', code });
}

async function translateText(translator, text, from, requestId, signal) {
  if (signal && signal.aborted) throw abortError();
  if (from === 'zh' || from === 'none') return '';
  if (from !== 'en' && from !== 'ja') {
    throw Object.assign(new Error('LOCAL_TRANSLATION_UNSUPPORTED_LANGUAGE'), { code: 'LOCAL_TRANSLATION_UNSUPPORTED_LANGUAGE' });
  }
  const request = { from, to: 'zh', text, html: false, requestId };
  let abort;
  const aborted = new Promise((_, reject) => {
    abort = () => {
      translator.remove(candidate => candidate.requestId === requestId);
      reject(abortError());
    };
    if (signal) signal.addEventListener('abort', abort, { once: true });
  });
  try {
    const response = await Promise.race([translator.translate(request), aborted]);
    return String(response && response.target && response.target.text || '').trim();
  } finally {
    if (signal && abort) signal.removeEventListener('abort', abort);
  }
}

async function translateMixedLine(translator, text, requestId, signal, sourceHint) {
  const detected = detectLanguage(text);
  const language = sourceHint === 'ja' && detected === 'zh' ? 'ja'
    : (sourceHint === 'en' && detected === 'zh' ? 'zh' : detected);
  if (language === 'ja') return translateText(translator, text, 'ja', requestId, signal);
  if (language !== 'en' || !/[\u3400-\u9fff]/u.test(text)) {
    return translateText(translator, text, language, requestId, signal);
  }
  const segments = String(text).split(/([\u3400-\u9fff]+(?:[\s，。！？、；：“”‘’（）《》【】…—-]*))/u);
  const translated = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment || !/[A-Za-z]/.test(segment)) translated.push(segment);
    else translated.push(await translateText(translator, segment, 'en', requestId + ':' + index, signal));
  }
  return translated.join('').trim();
}

async function translateLyrics(input, options = {}) {
  const targetLanguage = String(input && input.targetLanguage || 'zh-CN').toLowerCase();
  if (!/^zh(?:-cn|-hans)?$/.test(targetLanguage)) {
    throw Object.assign(new Error('LOCAL_TRANSLATION_UNSUPPORTED_TARGET'), { code: 'LOCAL_TRANSLATION_UNSUPPORTED_TARGET' });
  }
  const lines = input.lines;
  if (!Array.isArray(lines)) throw Object.assign(new Error('INVALID_TRANSLATION_LINES'), { code: 'INVALID_TRANSLATION_LINES' });
  const keepAlive = setInterval(() => {}, 1000);
  activeRequests += 1;
  const controller = new AbortController();
  let timedOut = false;
  const externalAbort = () => controller.abort();
  if (options.signal) {
    setMaxListeners(0, options.signal);
    options.signal.addEventListener('abort', externalAbort, { once: true });
    if (options.signal.aborted) controller.abort();
  }
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, LOCAL_TRANSLATION_TIMEOUT_MS);
  const translatorHandle = getTranslator();
  const abortReset = () => { invalidateTranslator(translatorHandle).catch(() => {}); };
  controller.signal.addEventListener('abort', abortReset, { once: true });
  try {
    setMaxListeners(0, controller.signal);
    const translator = await Promise.race([
      translatorHandle,
      new Promise((_, reject) => controller.signal.addEventListener('abort', () =>
        reject(abortError(timedOut ? 'TRANSLATION_TIMEOUT' : 'TRANSLATION_ABORTED')), { once:true }))
    ]);
    const baseId = 'lf-' + (++requestSerial);
    const sourceHint = inferSourceLanguage(input, lines);
    const skippedIndices = [];
    const translations = await Promise.all(lines.map(async (line, index) => {
      const text = String(lines[index] || '').trim();
      const detected = detectLanguage(text);
      if (!text || detected === 'none' || detected === 'zh' && (sourceHint !== 'ja' || looksClearlyChinese(text))) {
        skippedIndices.push(index);
        return '';
      }
      return translateMixedLine(translator, text, baseId + ':' + index, controller.signal, sourceHint);
    }));
    return {
      ok: true,
      translations,
      skippedIndices,
      sourceLanguage: String(input.sourceLanguage || 'auto'),
      inferredSourceLanguage: sourceHint,
      targetLanguage: 'zh-CN',
      adapter: 'local-bergamot',
      modelSource: MODEL_SOURCE,
      modelSnapshot: MODEL_SNAPSHOT,
    };
  } catch (error) {
    if (controller.signal.aborted) throw abortError(timedOut ? 'TRANSLATION_TIMEOUT' : 'TRANSLATION_ABORTED');
    await invalidateTranslator(translatorHandle);
    throw error;
  } finally {
    activeRequests = Math.max(0, activeRequests - 1);
    clearTimeout(timeout);
    controller.signal.removeEventListener('abort', abortReset);
    if (options.signal) options.signal.removeEventListener('abort', externalAbort);
    clearInterval(keepAlive);
    if (activeRequests === 0) scheduleIdleShutdown();
  }
}

module.exports = {
  MODEL_SOURCE,
  MODEL_SNAPSHOT,
  MODELS,
  LOCAL_TRANSLATION_TIMEOUT_MS,
  detectLanguage,
  inferSourceLanguage,
  shutdown,
  translateLyrics,
};
