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
const evidenceDir = path.resolve(process.env.LF_PROBLEM11_OUT || path.join(repo, 'test-results', 'lf-problem11-smoke', runId));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-problem11-'));
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
}
function compactStatus(status) {
  status = Object.assign({}, status || {});
  status.trackKeyLength = String(status.trackKey || '').length;
  status.activeTrackKeyLength = String(status.activeTrackKey || '').length;
  delete status.trackKey;
  delete status.activeTrackKey;
  return status;
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
async function waitFor(fn, timeout = 30000, interval = 100) {
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
        rendererErrors.push(String(detail.exception && detail.exception.description || detail.text || 'Renderer exception').slice(0, 1600));
      }
    };
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
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
  const response = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  const file = path.join(evidenceDir, name + '.png');
  fs.writeFileSync(file, Buffer.from(response.data, 'base64'));
  screenshots.push(file);
}

function wavDataUri(tones, seconds = 10, sampleRate = 22050) {
  const sampleCount = Math.floor(seconds * sampleRate);
  const buffer = Buffer.alloc(44 + sampleCount * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + sampleCount * 2, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate;
    const fade = Math.min(1, time * 8, (seconds - time) * 8);
    let sample = 0;
    for (const [frequency, gain] of tones) sample += Math.sin(Math.PI * 2 * frequency * time) * gain;
    buffer.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(sample * fade * 24000))), 44 + index * 2);
  }
  return 'data:audio/wav;base64,' + buffer.toString('base64');
}

async function run() {
  const controlSource = fs.readFileSync(path.join(repo, 'public', 'lf-audio-controls.js'), 'utf8');
  const toolSource = fs.readFileSync(path.join(repo, 'public', 'lf-audio-tools.js'), 'utf8');
  const cssSource = fs.readFileSync(path.join(repo, 'public', 'lf-audio-controls.css'), 'utf8');
  const indexSource = fs.readFileSync(path.join(repo, 'public', 'index.html'), 'utf8');
  const banned = /伴唱\s*\/\s*本地\s*AI|Demucs|MDX|BLOCKED|我确认有权|分离当前歌曲|选择本地音频/gi;
  pass('source removes the user-facing manual separation flow', !(controlSource.match(banned) || []).length, true);
  pass('source exposes the exact six playback speeds', /\[0\.5,\s*0\.75,\s*1,\s*1\.25,\s*1\.5,\s*2\]/.test(controlSource));
  pass('source contains the exact unsupported copy and no raw backend error rendering',
    controlSource.includes("var UNSUPPORTED_TEXT = '当前歌曲暂不支持伴唱'") &&
      !/(?:queued|result|capability)\s*\.\s*(?:error|message)[^;]{0,180}textContent|textContent[^;]{0,180}(?:queued|result|capability)\s*\.\s*(?:error|message)/.test(controlSource));
  pass('track lifecycle is connected at the shared player binding point',
    /LFAudioControls\.bindAudio\(audioEl\)/.test(indexSource));
  pass('mixer centre is unity original mix and endpoints are directional',
    /balance <= 0 \? 1 : 1 - balance/.test(toolSource) && /balance >= 0 \? 1 : 1 \+ balance/.test(toolSource));
  pass('1x entry and panel have enlarged fixed geometry',
    /flex:0 0 56px/.test(cssSource) && /width:min\(460px/.test(cssSource));

  const debugPort = await freePort();
  app = spawn(electron, ['.', '--user-data-dir=' + userData, '--remote-debugging-port=' + debugPort, '--remote-debugging-address=127.0.0.1'], {
    cwd: repo,
    env: Object.assign({}, process.env, {
      LF_ALLOW_LOCAL_CODES: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', LUMIFIELD_SKIP_SPLASH: '1',
      LF_MAIL_HOST: ' ', LF_MAIL_USER: ' ', LF_MAIL_PASSWORD: ' ', LF_REMOTE_API_URL: ' ',
    }),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = chunk => {
    const value = String(chunk); appLog.push(value);
    if (/(?:FATAL|uncaught exception|renderer process crashed)/i.test(value)) rendererErrors.push(value.trim().slice(0, 1600));
  };
  app.stdout.on('data', collect); app.stderr.on('data', collect);

  const target = await findMainTarget(debugPort);
  origin = new URL(target.url).origin;
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await pageWait(function () {
    return document.readyState === 'complete' && window.LFAudioControls && window.LFAudioTools &&
      document.getElementById('lf-audio-tool-btn') && document.getElementById('lf-audio-tool-panel');
  }, [], 45000);

  const clips = {
    songA: wavDataUri([[220, 0.34], [660, 0.24]]),
    songB: wavDataUri([[330, 0.34], [990, 0.24]]),
    vocals: wavDataUri([[660, 0.42]]),
    accompaniment: wavDataUri([[220, 0.42]]),
  };
  await cdp.call(async function (audioClips) {
    document.body.classList.remove('lf-auth-locked', 'empty-home-active', 'splash-active');
    const auth = document.getElementById('lf-auth-root');
    if (auth) { auth.classList.remove('show'); auth.style.display = 'none'; }
    const splash = document.getElementById('splash');
    if (splash) splash.style.display = 'none';
    window.__p11Clips = audioClips;
    const adapterState = window.__p11AdapterState = {
      available: true, delay: 120, sequence: 0, jobs: {}, cancellations: [], callbacks: [], starts: [],
    };
    window.LFAudioKaraokeApi = {
      lfStemStatus: async function () { return { ok: adapterState.available, available: adapterState.available }; },
      lfStemStart: async function (_file, options) {
        if (!adapterState.available) return { ok: false, error: 'UNAVAILABLE' };
        const taskId = 'p11-' + (++adapterState.sequence);
        adapterState.jobs[taskId] = { delay: adapterState.delay, source: String(options && options.currentAudioUrl || '') };
        adapterState.starts.push({ taskId, source: adapterState.jobs[taskId].source });
        return { ok: true, taskId };
      },
      lfStemWait: async function (taskId) {
        const job = adapterState.jobs[taskId];
        const chunks = 4;
        for (let index = 1; index <= chunks; index += 1) {
          await new Promise(resolve => setTimeout(resolve, Math.max(5, job.delay / chunks)));
          adapterState.callbacks.forEach(callback => callback({ taskId, progress: index / chunks, phase: 'preparing' }));
        }
        return { ok: true, taskId, vocalUrl: audioClips.vocals, noVocalsUrl: audioClips.accompaniment };
      },
      lfStemCancel: async function (taskId) { adapterState.cancellations.push(taskId); return { ok: true, taskId }; },
      onLFStemProgress: function (callback) {
        adapterState.callbacks.push(callback);
        return function () { adapterState.callbacks = adapterState.callbacks.filter(item => item !== callback); };
      },
    };
    if (window.audio) { try { window.audio.pause(); } catch (_) {} }
    window.audio = new Audio();
    window.audio.crossOrigin = 'anonymous';
    window.audio.src = audioClips.songA;
    window.LFAudioControls.bindAudio(window.audio);
    if (!window.audioReady && typeof window.initAudio === 'function') window.initAudio();
    window.audio.load();
    await new Promise((resolve, reject) => {
      if (window.audio.readyState >= 2) return resolve();
      const timer = setTimeout(() => reject(new Error('fixture audio timeout')), 10000);
      window.audio.addEventListener('canplay', function ready() { clearTimeout(timer); resolve(); }, { once: true });
    });
    await window.audio.play();
    document.getElementById('lf-audio-tool-btn').click();
  }, [clips]);

  const ui = await cdp.call(function () {
    const button = document.getElementById('lf-audio-tool-btn');
    const panel = document.getElementById('lf-audio-tool-panel');
    const time = document.getElementById('time-display');
    const buttonRect = button.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const timeRect = time.getBoundingClientRect();
    const hit = document.elementFromPoint(buttonRect.left + buttonRect.width / 2, buttonRect.top + buttonRect.height / 2);
    return {
      button: { width: buttonRect.width, height: buttonRect.height },
      panel: { width: panelRect.width, height: panelRect.height, visible: panel.classList.contains('show') },
      timeVisible: timeRect.width > 0,
      nonOverlap: timeRect.width <= 0 || buttonRect.right <= timeRect.left + 0.5 || timeRect.right <= buttonRect.left + 0.5,
      hit: hit === button || button.contains(hit),
      speeds: Array.from(panel.querySelectorAll('[data-speed]')).map(node => Number(node.dataset.speed)),
      text: panel.innerText,
      balance: { min: document.getElementById('lf-karaoke-balance').min, max: document.getElementById('lf-karaoke-balance').max },
    };
  });
  pass('1x entry is clearly visible, clickable and does not overlap duration',
    ui.button.width >= 50 && ui.button.height >= 36 && ui.hit && ui.nonOverlap, ui);
  pass('glass panel is enlarged and exposes direct accompaniment controls',
    ui.panel.visible && ui.panel.width >= 430 && ui.text.includes('伴唱') && ui.text.includes('人声') && ui.text.includes('原曲') && ui.text.includes('伴奏'), ui);
  pass('visible panel has no implementation, consent or manual-file terminology',
    !/本地\s*AI|Demucs|MDX|Stem|BLOCKED|授权|选择本地音频|分离当前歌曲|模型|质量/.test(ui.text), ui.text);
  pass('runtime presents exactly the required six speed presets',
    JSON.stringify(ui.speeds) === JSON.stringify([0.5, 0.75, 1, 1.25, 1.5, 2]), ui.speeds);
  await screenshot('01-enlarged-1x-and-direct-controls');

  const activation = await cdp.call(async function () {
    const before = { time: audio.currentTime, paused: audio.paused };
    const result = await LFAudioControls.setKaraokeEnabled(true);
    const after = { time: audio.currentTime, paused: audio.paused };
    const left = LFAudioControls.setKaraokeBalance(-1);
    const centre = LFAudioControls.setKaraokeBalance(0);
    const right = LFAudioControls.setKaraokeBalance(1);
    return { result, before, after, status: LFAudioControls.status(), left, centre, right };
  });
  pass('direct enable prepares and activates without resetting or pausing the song',
    activation.result.ok && activation.status.phase === 'active' && activation.status.requested && activation.status.stems &&
      !activation.before.paused && !activation.after.paused && activation.after.time >= activation.before.time && activation.after.time - activation.before.time < 2,
    { result: activation.result, before: activation.before, after: activation.after, status: compactStatus(activation.status) });
  pass('voice-original-accompaniment law is continuous with a true unity centre',
    activation.left.vocalGain === 1 && activation.left.noVocalsGain === 0 &&
      activation.centre.vocalGain === 1 && activation.centre.noVocalsGain === 1 && activation.centre.originalAtCenter &&
      activation.right.vocalGain === 0 && activation.right.noVocalsGain === 1, {
      left: activation.left, centre: activation.centre, right: activation.right,
    });
  await screenshot('02-accompaniment-active');

  const speedRuntime = await cdp.call(async function () {
    const results = [];
    for (const speed of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
      const before = audio.currentTime;
      const paused = audio.paused;
      const result = LFAudioControls.setSpeed(speed);
      await new Promise(resolve => setTimeout(resolve, 45));
      results.push({ requested: speed, result, actual: audio.playbackRate, preservesPitch: audio.preservesPitch, pausedBefore: paused, pausedAfter: audio.paused, before, after: audio.currentTime });
    }
    const bins = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(bins);
    const desktop = typeof desktopLyricsPlaybackPayload === 'function' ? desktopLyricsPlaybackPayload() : null;
    return { results, maxFrequency: Math.max.apply(null, Array.from(bins)), desktop };
  });
  pass('all six speeds remain continuous and preserve pitch', speedRuntime.results.every(item =>
    item.result.ok && Math.abs(item.actual - item.requested) < 0.001 && item.preservesPitch === true &&
    item.pausedBefore === item.pausedAfter && item.after >= item.before), speedRuntime.results);
  pass('lyrics playback clock and real analyser stay synchronized at changed speed',
    speedRuntime.desktop && Math.abs(speedRuntime.desktop.rate - 2) < 0.001 && speedRuntime.maxFrequency > 0, speedRuntime);

  const unsupported = await cdp.call(async function () {
    await LFAudioControls.setKaraokeEnabled(false);
    __p11AdapterState.available = false;
    await LFAudioControls.setKaraokeEnabled(true);
    return { status: LFAudioControls.status(), text: document.getElementById('lf-karaoke-status').textContent, panel: document.getElementById('lf-audio-tool-panel').innerText };
  });
  pass('unsupported songs show only the exact required message',
    unsupported.status.phase === 'unsupported' && unsupported.text === '当前歌曲暂不支持伴唱' &&
      !/UNAVAILABLE|BLOCKED|Demucs|MDX|Stem/.test(unsupported.panel), { status: compactStatus(unsupported.status), text: unsupported.text });
  await screenshot('03-exact-unsupported-state');

  const offDuringPrepare = await cdp.call(async function () {
    await LFAudioControls.setKaraokeEnabled(false);
    __p11AdapterState.available = true;
    __p11AdapterState.delay = 520;
    const pending = LFAudioControls.setKaraokeEnabled(true);
    await new Promise(resolve => setTimeout(resolve, 90));
    const preparing = LFAudioControls.status();
    const timeBeforeOff = audio.currentTime;
    await LFAudioControls.setKaraokeEnabled(false);
    await pending;
    await new Promise(resolve => setTimeout(resolve, 560));
    return { preparing, final: LFAudioControls.status(), timeBeforeOff, timeAfter: audio.currentTime, paused: audio.paused, cancellations: __p11AdapterState.cancellations.slice() };
  });
  pass('turning off during preparation cannot rebound after the stale result resolves',
    offDuringPrepare.preparing.phase === 'preparing' && offDuringPrepare.final.phase === 'off' &&
      !offDuringPrepare.final.requested && !offDuringPrepare.final.stems && !offDuringPrepare.final.pendingElements &&
      !offDuringPrepare.final.pendingStemDecode &&
      (offDuringPrepare.cancellations.length > 0 || offDuringPrepare.preparing.pendingStemDecode) &&
      offDuringPrepare.timeAfter >= offDuringPrepare.timeBeforeOff && !offDuringPrepare.paused,
    { preparing: compactStatus(offDuringPrepare.preparing), final: compactStatus(offDuringPrepare.final),
      timeBeforeOff: offDuringPrepare.timeBeforeOff, timeAfter: offDuringPrepare.timeAfter,
      paused: offDuringPrepare.paused, cancellations: offDuringPrepare.cancellations });

  const trackRace = await cdp.call(async function () {
    __p11AdapterState.available = true;
    __p11AdapterState.delay = 540;
    const revisionBefore = LFAudioControls.status().trackRevision;
    const oldPromise = LFAudioControls.setKaraokeEnabled(true);
    await new Promise(resolve => setTimeout(resolve, 90));
    __p11AdapterState.delay = 90;
    audio.src = __p11Clips.songB;
    audio.load();
    await new Promise((resolve, reject) => {
      if (audio.readyState >= 2) return resolve();
      const timer = setTimeout(() => reject(new Error('track B timeout')), 10000);
      audio.addEventListener('canplay', function ready() { clearTimeout(timer); resolve(); }, { once: true });
    });
    await audio.play();
    await oldPromise;
    const started = performance.now();
    while (LFAudioControls.status().phase !== 'active' && performance.now() - started < 5000) await new Promise(resolve => setTimeout(resolve, 50));
    const status = LFAudioControls.status();
    return {
      status,
      currentSourceMatches: status.activeTrackKey === audio.src,
      revisionAdvanced: status.trackRevision > revisionBefore,
      cancellations: __p11AdapterState.cancellations.slice(),
      starts: __p11AdapterState.starts.map(item => item.taskId),
      paused: audio.paused,
    };
  });
  pass('rapid A-to-B switch ignores A, keeps user intent and activates only B',
    trackRace.status.phase === 'active' && trackRace.status.requested && trackRace.status.stems &&
      trackRace.currentSourceMatches && trackRace.revisionAdvanced && trackRace.cancellations.length >= 2 && !trackRace.paused,
    { status: compactStatus(trackRace.status), currentSourceMatches: trackRace.currentSourceMatches, revisionAdvanced: trackRace.revisionAdvanced,
      cancellations: trackRace.cancellations, starts: trackRace.starts, paused: trackRace.paused });

  const cleanup = await cdp.call(async function () {
    const before = audio.currentTime;
    await LFAudioControls.setKaraokeEnabled(false);
    await new Promise(resolve => setTimeout(resolve, 120));
    return { before, after: audio.currentTime, paused: audio.paused, status: LFAudioControls.status() };
  });
  pass('disable restores original playback without leaked stem listeners, timer or pending elements',
    cleanup.after >= cleanup.before && !cleanup.paused && cleanup.status.phase === 'off' && !cleanup.status.stems &&
      cleanup.status.stemListenerCount === 0 && !cleanup.status.hasStemTimer && !cleanup.status.pendingElements && cleanup.status.activeTrackKey === '',
    { before: cleanup.before, after: cleanup.after, paused: cleanup.paused, status: compactStatus(cleanup.status) });
  pass('renderer has no uncaught exceptions', rendererErrors.length === 0, rendererErrors);

  const result = {
    ok: true,
    runId,
    mode: 'Electron source + CDP problem 11 with deterministic prepared dual-track adapter',
    origin,
    evidenceDir,
    screenshots,
    checks,
    rendererErrors,
  };
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(evidenceDir, 'app.log'), appLog.join('').replace(/\b\d{6}\b/g, '[REDACTED_CODE]'));
  process.stdout.write(JSON.stringify(result) + '\n');
}

run().catch(error => {
  const failure = { ok: false, runId, origin, evidenceDir, error: String(error && error.stack || error), checks, screenshots, rendererErrors };
  try {
    fs.writeFileSync(path.join(evidenceDir, 'failure.json'), JSON.stringify(failure, null, 2));
    fs.writeFileSync(path.join(evidenceDir, 'app.log'), appLog.join('').replace(/\b\d{6}\b/g, '[REDACTED_CODE]'));
  } catch (_) {}
  console.error(failure.error);
  process.exitCode = 1;
}).finally(() => {
  if (cdp) cdp.close();
  if (app && app.pid && app.exitCode == null) spawnSync('taskkill', ['/pid', String(app.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) {}
});
