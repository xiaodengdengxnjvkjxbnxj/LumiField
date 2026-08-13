'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const electron = require('electron');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.join(repo, 'test-results', 'lf-master-problem10-smoke', runId);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-master-problem10-'));
const checks = {};
const launches = [];
const rendererErrors = [];
const appLog = [];
let activeApp;
let activeCdp;

fs.mkdirSync(evidenceDir, { recursive:true });

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function pass(name, condition, details) {
  assert.ok(condition, `${name}: ${JSON.stringify(details)}`);
  checks[name] = details == null ? true : details;
}
async function waitFor(fn, timeout = 45000, interval = 100) {
  const started = Date.now();
  let value;
  while (Date.now() - started < timeout) {
    try { value = await fn(); if (value) return value; } catch (_) {}
    await delay(interval);
  }
  throw new Error(`Timed out after ${timeout}ms: ${JSON.stringify(value)}`);
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
      } else if (message.method === 'Runtime.exceptionThrown') {
        const detail = message.params && message.params.exceptionDetails || {};
        rendererErrors.push(String(detail.exception && detail.exception.description || detail.text || 'Renderer exception').slice(0, 3000));
      }
    };
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
    await this.send('Page.bringToFront');
  }
  send(method, params = {}, timeout = 60000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true, userGesture:true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception && response.exceptionDetails.exception.description || response.exceptionDetails.text);
    return response.result && response.result.value;
  }
  call(fn, args = []) { return this.evaluate(`(${fn.toString()}).apply(null,${JSON.stringify(args)})`); }
  close() { try { this.ws.close(); } catch (_) {} }
}

function wavDataUrl(seconds = 8, sampleRate = 8000) {
  const samples = Math.floor(seconds * sampleRate);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    const envelope = Math.min(1, index / 400) * Math.min(1, (samples - index) / 400);
    buffer.writeInt16LE(Math.round(Math.sin(index / sampleRate * Math.PI * 2 * 220) * 5000 * envelope), 44 + index * 2);
  }
  return `data:audio/wav;base64,${buffer.toString('base64')}`;
}

function staticAudit() {
  const moduleText = fs.readFileSync(path.join(repo, 'public', 'lf-playback-resume.js'), 'utf8');
  const index = fs.readFileSync(path.join(repo, 'public', 'index.html'), 'utf8');
  const main = fs.readFileSync(path.join(repo, 'desktop', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(repo, 'desktop', 'preload.js'), 'utf8');
  pass('resume module uses versioned user-scoped schema', /lumifield\.playback-resume/.test(moduleText) && /profiles/.test(moduleText) && /currentUser/.test(moduleText), true);
  pass('resume module has strict song whitelist and no URL persistence field', /function sanitizeSong/.test(moduleText) && !/\b(?:url|playUrl|audioUrl|cookie|token|signature)\s*:/.test(moduleText), true);
  pass('playback hooks cover switch pause seek periodic and unload', /track-switch-before/.test(index) && /'timeupdate', 'seeked', 'play', 'pause'/.test(index) && /markDirty\('audio-' \+ name/.test(index) && /periodic/.test(moduleText) && /beforeunload/.test(moduleText), true);
  pass('main process close handshake flushes renderer storage', /requestPlaybackStateSave/.test(main) && /flushStorageData/.test(main) && /playback-save-complete/.test(main) && /onPlaybackStateSaveRequest/.test(preload), true);
  pass('restart path saves before relaunch', /requestPlaybackStateSave\(mainWindow, 'app-restart'\)/.test(main) && /app\.relaunch\(\)/.test(main) && /app\.quit\(\)/.test(main), true);
}

async function launch(label) {
  const port = await freePort();
  const child = spawn(electron, ['.', `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--window-size=1280,800'], {
    cwd:repo,
    windowsHide:true,
    stdio:['ignore', 'pipe', 'pipe'],
    env:Object.assign({}, process.env, { LUMIFIELD_SKIP_SPLASH:'1', ELECTRON_DISABLE_SECURITY_WARNINGS:'true' })
  });
  activeApp = child;
  const collect = data => appLog.push(`[${label}] ${String(data)}`);
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const items = await response.json();
    return items.find(item => item.type === 'page' && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//.test(item.url));
  }, 60000, 160);
  const cdp = new CDP(target.webSocketDebuggerUrl);
  activeCdp = cdp;
  await cdp.connect();
  await waitFor(() => cdp.call(function () {
    return document.readyState === 'complete' && window.LFPlaybackResume && window.LFAudioControls && typeof window.togglePlay === 'function';
  }), 60000, 160);
  launches.push({ label, pid:child.pid, port });
  return { child, cdp, label };
}

async function prepare(session, userId, dataUrl) {
  await session.cdp.call(function (args) {
    window.startupLoginGuideShown = true;
    window.loginGuideAnimating = false;
    window.showLoginModal = function () { return false; };
    window.openProviderLogin = function () { return false; };
    if (typeof window.closeLoginModal === 'function') try { window.closeLoginModal(); } catch (_) {}
    document.querySelectorAll('.modal-mask.show,.modal-mask.open,.modal-mask.active').forEach(function (modal) {
      modal.classList.remove('show', 'open', 'active'); modal.style.pointerEvents = 'none';
    });
    const authRoot = document.getElementById('lf-auth-root');
    if (authRoot) { authRoot.hidden = true; authRoot.style.pointerEvents = 'none'; }
    document.body.classList.remove('modal-open', 'lf-auth-locked');
    window.__lfP10 = { resolutionCalls:0, playCalls:0, playOptions:[], sourceUrl:args.dataUrl };
    window.resolvePlaybackSource = async function (song) {
      window.__lfP10.resolutionCalls += 1;
      return { url:window.__lfP10.sourceUrl, provider:song.provider, level:'standard', resolvedSong:Object.assign({}, song) };
    };
    window.playQueueAt = async function (index, options) {
      options = options || {};
      window.__lfP10.playCalls += 1;
      window.__lfP10.playOptions.push({ index:index, manual:options.manual === true, resumeAt:Number(options.resumeAt) || 0, playbackResume:options.playbackResume === true });
      window.currentIdx = index;
      window.trackSwitchToken += 1;
      const token = window.trackSwitchToken;
      const song = window.playQueue[index];
      const resolved = await window.resolvePlaybackSource(song, 'standard', false);
      if (!window.audio) window.audio = new Audio();
      else window.audio.pause();
      window.bindPlaybackProgressEvents(window.audio);
      window.audio.volume = 0.01;
      window.audio.src = resolved.url;
      window.scheduleAudioResumePosition(window.audio, options.resumeAt, token);
      window.audio.load();
      await new Promise(function (resolve, reject) {
        if (window.audio.readyState >= 1) return resolve();
        const timer = setTimeout(function () { reject(new Error('FIXTURE_METADATA_TIMEOUT')); }, 8000);
        window.audio.addEventListener('loadedmetadata', function () { clearTimeout(timer); resolve(); }, { once:true });
        window.audio.addEventListener('error', function () { clearTimeout(timer); reject(new Error('FIXTURE_AUDIO_ERROR')); }, { once:true });
      });
      await window.audio.play();
      window.playing = true;
      window.setPlayIcon(true);
      return true;
    };
    document.dispatchEvent(new CustomEvent('lumifield-auth-user-change', { detail:{ loggedIn:true, userId:args.userId } }));
    return true;
  }, [{ userId, dataUrl }]);
  await waitFor(() => session.cdp.call(function (expected) {
    return window.LFPlaybackResume.inspect().identity === expected && window.LFPlaybackResume.inspect().identityReady;
  }, [userId]), 5000, 80);
}

async function firstRun(session) {
  const snapshot = await session.cdp.call(async function () {
    window.playQueue = [
      { id:'resume-track-a', provider:'netease', source:'netease', name:'恢复队列甲', artist:'LumiField QA', duration:8, runtimeUrl:'https://signed.invalid/a?token=SECRET_RUNTIME_URL', cookie:'COOKIE_SECRET' },
      { id:'resume-track-b', provider:'netease', source:'netease', name:'恢复队列乙', artist:'LumiField QA', duration:8, playUrl:'https://signed.invalid/b?signature=TOKEN_SECRET', token:'TOKEN_SECRET', playlistId:'playlist-resume-10' }
    ];
    window.currentIdx = 1;
    await window.LFAudioControls.setSpeedPitchLinkEnabled(false);
    await window.LFAudioControls.setSpeed(1.25);
    await window.LFAudioControls.setPitch(2);
    window.LFAudioControls.setKaraokeBalance(0.35);
    await window.playQueueAt(1, { manual:true });
    await new Promise(resolve => setTimeout(resolve, 180));
    window.audio.currentTime = 3.25;
    await new Promise(resolve => setTimeout(resolve, 160));
    window.audio.pause();
    window.LFPlaybackResume.saveNow('test-first-run');
    const key = window.LFPlaybackResume.inspect().storageKey;
    return { root:JSON.parse(localStorage.getItem(key)), raw:localStorage.getItem(key), controls:window.LFAudioControls.status(), duration:window.audio.duration, position:window.audio.currentTime };
  });
  const profile = snapshot.root.profiles['problem10-user-a'];
  pass('first run stores complete queue and current index', profile && profile.queue.length === 2 && profile.currentIndex === 1 && profile.trackId === 'resume-track-b' && profile.provider === 'netease', profile);
  pass('first run stores progress and duration', profile.position >= 3 && profile.position <= 3.6 && profile.duration > 7.5, profile);
  pass('first run stores speed pitch accompaniment and user', profile.playbackRate === 1.25 && profile.pitch === 2 && profile.accompaniment && Math.abs(profile.accompaniment.balance - 0.35) < 0.01 && profile.currentUser === 'problem10-user-a', profile);
  pass('snapshot excludes runtime URL cookie token and signature secrets', !/SECRET_RUNTIME_URL|COOKIE_SECRET|TOKEN_SECRET|signed\.invalid|data:audio/i.test(snapshot.raw), snapshot.raw.slice(0, 1200));
  return profile;
}

async function restoredState(session) {
  return session.cdp.call(function () {
    const info = window.LFPlaybackResume.inspect();
    const key = info.storageKey;
    const root = JSON.parse(localStorage.getItem(key));
    return {
      info,
      queue:window.playQueue.map(function (song) { return { id:song.id, provider:song.provider, name:song.name }; }),
      currentIdx:window.currentIdx,
      audioExists:!!window.audio,
      audioSrc:window.audio && window.audio.src || '',
      playing:window.playing,
      resolutionCalls:window.__lfP10.resolutionCalls,
      lastMainProcessSave:root.lastMainProcessSave || null
    };
  });
}

async function secondRun(session, expectedPosition) {
  const before = await restoredState(session);
  pass('restart restores queue and index without creating audio source', before.queue.length === 2 && before.currentIdx === 1 && before.info.pending && !before.info.pendingConsumed && !before.audioSrc && !before.playing, before);
  pass('restart does not resolve source or autoplay before click', before.resolutionCalls === 0 && before.info.restoreAttempts === 0, before);
  pass('main process close handshake was persisted', before.lastMainProcessSave && before.lastMainProcessSave.currentUser === 'problem10-user-a' && before.lastMainProcessSave.reason === 'window-close', before.lastMainProcessSave);
  const after = await session.cdp.call(async function () {
    await Promise.all([window.togglePlay(), window.togglePlay()]);
    await new Promise(resolve => setTimeout(resolve, 320));
    return {
      calls:window.__lfP10,
      currentTime:window.audio && window.audio.currentTime,
      paused:window.audio && window.audio.paused,
      currentIdx:window.currentIdx,
      controls:window.LFAudioControls.status(),
      info:window.LFPlaybackResume.inspect()
    };
  });
  pass('first manual click resolves a fresh source exactly once', after.calls.resolutionCalls === 1 && after.calls.playCalls === 1 && after.calls.playOptions[0].manual && after.calls.playOptions[0].playbackResume, after);
  pass('manual restore seeks to saved progress after metadata', !after.paused && after.currentIdx === 1 && after.currentTime >= expectedPosition - 0.45, after);
  pass('double click cannot duplicate restore playback', after.info.restoreAttempts === 1 && after.calls.playCalls === 1, after);
  pass('speed pitch and accompaniment controls restore', after.controls.speed === 1.25 && after.controls.pitch === 2 && Math.abs(after.controls.balance - 0.35) < 0.01, after.controls);
  await session.cdp.call(async function () {
    window.audio.currentTime = 4.4;
    await new Promise(resolve => setTimeout(resolve, 140));
    window.audio.pause();
    window.LFPlaybackResume.saveNow('test-second-run');
  });
}

async function isolationAndCorruption(session) {
  const isolated = await restoredState(session);
  pass('different LF user receives no other user queue or pending state', isolated.queue.length === 0 && isolated.currentIdx === -1 && !isolated.info.pending && !isolated.audioSrc && !isolated.playing, isolated);
  const audit = await session.cdp.call(function () {
    const key = window.LFPlaybackResume.inspect().storageKey;
    const backup = localStorage.getItem(key);
    localStorage.setItem(key, '{broken-json');
    window.LFPlaybackResume.reloadCurrent();
    const corruptSafe = !window.LFPlaybackResume.inspect().pending && window.playQueue.length === 0 && localStorage.getItem(key) === null;
    localStorage.setItem(key, backup);
    document.dispatchEvent(new CustomEvent('lumifield-auth-user-change', { detail:{ loggedIn:true, userId:'problem10-user-a' } }));
    return {
      corruptSafe,
      identity:window.LFPlaybackResume.inspect().identity,
      pending:window.LFPlaybackResume.inspect().pending,
      queue:window.playQueue.map(function (song) { return song.id; }),
      currentIdx:window.currentIdx,
      audioSrc:window.audio && window.audio.src || '',
      playing:window.playing
    };
  });
  pass('corrupted storage falls back safely without exception', audit.corruptSafe, audit);
  pass('switching back restores only that user and still does not autoplay', audit.identity === 'problem10-user-a' && audit.pending && audit.queue.join(',') === 'resume-track-a,resume-track-b' && audit.currentIdx === 1 && !audit.audioSrc && !audit.playing, audit);
}

async function closeNormally(session) {
  try { await session.cdp.call(function () { window.desktopWindow.close(); return true; }); } catch (_) {}
  await Promise.race([
    new Promise(resolve => session.child.once('exit', resolve)),
    delay(10000).then(() => { throw new Error(`Process ${session.child.pid} did not exit after window close`); })
  ]);
  session.cdp.close();
  if (activeApp === session.child) activeApp = null;
  if (activeCdp === session.cdp) activeCdp = null;
}

async function forceCleanup() {
  if (activeCdp) activeCdp.close();
  if (activeApp && activeApp.exitCode == null) {
    try { activeApp.kill(); } catch (_) {}
    await delay(350);
    if (activeApp.exitCode == null && process.platform === 'win32') spawnSync('taskkill', ['/PID', String(activeApp.pid), '/T', '/F'], { windowsHide:true, stdio:'ignore' });
  }
  try { fs.rmSync(userData, { recursive:true, force:true }); } catch (_) {}
}

(async function main() {
  staticAudit();
  const dataUrl = wavDataUrl();
  const one = await launch('run-1');
  await prepare(one, 'problem10-user-a', dataUrl);
  const firstProfile = await firstRun(one);
  await closeNormally(one);

  const two = await launch('run-2');
  await prepare(two, 'problem10-user-a', dataUrl);
  await secondRun(two, firstProfile.position);
  await closeNormally(two);

  const three = await launch('run-3');
  await prepare(three, 'problem10-user-b', dataUrl);
  await isolationAndCorruption(three);
  await closeNormally(three);

  pass('three real Electron process lifecycles completed', launches.length === 3 && launches.every(item => item.pid > 0), launches);
  pass('no renderer exception during restart workflow', rendererErrors.length === 0, rendererErrors);
  const result = { ok:true, problem:10, checks, launches, rendererErrors, appLogTail:appLog.join('').slice(-16000), completedAt:new Date().toISOString() };
  const resultFile = path.join(evidenceDir, 'result.json');
  fs.writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ ok:true, problem:10, resultFile, checks:Object.keys(checks).length }, null, 2));
})().catch(error => {
  const failure = { ok:false, problem:10, error:error && error.stack || String(error), checks, launches, rendererErrors, appLogTail:appLog.join('').slice(-16000), completedAt:new Date().toISOString() };
  const failureFile = path.join(evidenceDir, 'failure.json');
  fs.writeFileSync(failureFile, `${JSON.stringify(failure, null, 2)}\n`);
  console.error(JSON.stringify({ ok:false, problem:10, failureFile, error:failure.error }, null, 2));
  process.exitCode = 1;
}).finally(forceCleanup);
