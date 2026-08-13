const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const electron = require('electron');
const installedExecutable = String(process.env.LF_NEW2_EXECUTABLE || '').trim();
const launchExecutable = installedExecutable || electron;
const launchMode = installedExecutable ? 'installed' : 'source';
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.resolve(process.env.LF_NEW2_OUT || path.join(repo, 'test-results', 'lf-new2', runId));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-new2-'));
const checks = {};
const rendererErrors = [];
const appLog = [];
const screenshots = [];
let app = null;
let cdp = null;

fs.mkdirSync(evidenceDir, { recursive: true });

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function pass(name, condition, details) {
  assert.ok(condition, name + (details == null ? '' : ': ' + JSON.stringify(details)));
  checks[name] = details == null ? true : details;
}
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}
async function waitFor(fn, timeout = 25000, interval = 100) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (_) {}
    await delay(interval);
  }
  throw new Error('Timed out after ' + timeout + 'ms; last=' + JSON.stringify(last));
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
        rendererErrors.push(String(detail.exception && detail.exception.description || detail.text || 'Renderer exception').slice(0, 1600));
      }
    };
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
    await this.send('Page.bringToFront');
  }
  send(method, params, timeoutMs = 60000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('CDP command timeout: ' + method));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
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
    return this.evaluate('(' + fn.toString() + ').apply(null,' + JSON.stringify(args) + ')');
  }
  close() { try { this.ws.close(); } catch (_) {} }
}
async function findMainTarget(port) {
  return waitFor(async () => {
    const response = await fetch('http://127.0.0.1:' + port + '/json/list');
    const list = await response.json();
    return list.find(item => item.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//.test(item.url));
  }, 45000, 250);
}
async function launch() {
  const debugPort = await freePort();
  const args = (installedExecutable ? [] : ['.']).concat([
    '--user-data-dir=' + userData,
    '--remote-debugging-port=' + debugPort,
    '--remote-debugging-address=127.0.0.1',
  ]);
  app = spawn(launchExecutable, args, {
    cwd: installedExecutable ? path.dirname(installedExecutable) : repo,
    env: Object.assign({}, process.env, {
      LF_ALLOW_LOCAL_CODES: '1',
      LF_ALLOW_PACKAGED_CDP_TEST: installedExecutable ? '1' : '0',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      LUMIFIELD_SKIP_SPLASH: '1',
      LF_MAIL_HOST: ' ',
      LF_MAIL_USER: ' ',
      LF_MAIL_PASSWORD: ' ',
      LF_MAIL_FROM: ' ',
      LF_REMOTE_API_URL: ' ',
      LF_TRANSLATE_ENDPOINT: ' ',
      LF_TRANSLATE_API_KEY: ' ',
    }),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = chunk => {
    const text = String(chunk);
    appLog.push(text);
    if (/(?:FATAL|uncaught exception|renderer process crashed)/i.test(text)) rendererErrors.push(text.trim().slice(0, 1600));
  };
  app.stdout.on('data', collect);
  app.stderr.on('data', collect);
  const target = await findMainTarget(debugPort);
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await waitFor(() => cdp.call(function () {
    return document.readyState === 'complete' && window.LFAuth && window.LFSleepTimer;
  }), 45000);
}
async function stopApp() {
  if (cdp) cdp.close();
  cdp = null;
  if (app && app.pid) spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  app = null;
  await delay(900);
}
async function registerAndLogin() {
  const account = 'new2-' + Date.now() + '@example.com';
  const password = 'N2' + crypto.randomBytes(12).toString('hex') + 'z9';
  await cdp.call(function () {
    document.querySelector('[data-lf-auth-tab="register"]').click();
  });
  await cdp.call(function (value) {
    document.getElementById('lf-register-account').value = value;
    document.getElementById('lf-register-send').click();
  }, [account]);
  const code = await waitFor(() => cdp.call(function () {
    const match = document.getElementById('lf-auth-dev-mode').textContent.match(/\d{6}/);
    return match && match[0];
  }), 25000);
  await cdp.call(function (values) {
    document.getElementById('lf-register-nickname').value = 'New2 Smoke';
    document.getElementById('lf-register-code').value = values.code;
    document.getElementById('lf-register-password').value = values.password;
    document.getElementById('lf-register-confirm').value = values.password;
    document.getElementById('lf-register-agreement').checked = true;
    document.getElementById('lf-register-submit').click();
  }, [{ code, password }]);
  await waitFor(() => cdp.call(function () {
    return document.getElementById('lf-login-status').textContent.includes('注册成功');
  }), 25000);
  await cdp.call(function (values) {
    document.getElementById('lf-login-account').value = values.account;
    document.getElementById('lf-login-password').value = values.password;
    document.getElementById('lf-login-submit').click();
  }, [{ account, password }]);
  await waitFor(() => cdp.call(function () {
    return !document.body.classList.contains('lf-auth-locked') && !!window.LFAuth.getToken();
  }), 25000);
}
async function setupFixture() {
  return cdp.call(async function () {
    function makeWav(duration, frequency) {
      const sampleRate = 8000;
      const length = Math.floor(duration * sampleRate);
      const bytes = new ArrayBuffer(44 + length * 2);
      const view = new DataView(bytes);
      function text(offset, value) {
        for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
      }
      text(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data');
      view.setUint32(40, length * 2, true);
      for (let i = 0; i < length; i += 1) {
        view.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * frequency * i / sampleRate) * 9000), true);
      }
      return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    }
    const urls = [makeWav(20, 220), makeWav(20, 330), makeWav(20, 440)];
    const songs = urls.map((url, index) => ({
      type: 'local', provider: 'local', id: 'new2-' + index,
      name: '定时歌曲 ' + (index + 1), artist: 'LF Test', localUrl: url, duration: 20,
    }));
    window.__lfSleepTimerTestConfig = {};
    window.__lfNew2Urls = urls;
    window.__lfNew2Songs = songs;
    window.__lfNew2Calls = [];
    if (!window.audio) {
      window.audio = new Audio();
      window.audio.crossOrigin = 'anonymous';
      window.bindPlaybackProgressEvents(window.audio);
    }
    if (!window.audioReady) window.initAudio();
    window.playQueue = songs.slice();
    window.currentIdx = 0;
    window.playQueueAt = async function (index, options) {
      options = options || {};
      window.__lfNew2Calls.push({ type: 'playQueueAt', index, options, at: Date.now() });
      window.finalizeListenSession(false);
      window.currentIdx = index;
      window.trackSwitchToken += 1;
      const media = window.audio;
      media.pause();
      media.src = urls[index];
      media.load();
      await new Promise((resolve, reject) => {
        if (media.readyState >= 1) return resolve();
        const timer = setTimeout(() => reject(new Error('NEW2_AUDIO_TIMEOUT')), 8000);
        media.addEventListener('loadedmetadata', function done() {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
      await media.play();
      window.playing = true;
      window.setPlayIcon(true);
      window.beginListenSession(songs[index], null);
      return { ok: true };
    };
    await window.playQueueAt(0, { fixture: true });
    window.dismissHomePage({ reason: 'new2-smoke' });
    window.LFSleepTimer.refreshQueue();
    return {
      queue: window.playQueue.map(song => song.id),
      currentIdx: window.currentIdx,
      audioDuration: window.audio.duration,
      allowed: window.LFSleepTimer.allowedMinutes,
      button: !!document.getElementById('lf-sleep-timer-btn'),
    };
  });
}
async function clickSelector(selector) {
  const point = await cdp.call(function (value) {
    const node = document.querySelector(value);
    if (!node) return null;
    node.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = node.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, [selector]);
  assert.ok(point, 'Missing click target: ' + selector);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
}
async function capture(name) {
  try {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, 12000);
    const file = path.join(evidenceDir, name + '.png');
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    screenshots.push(file);
  } catch (error) {
    appLog.push('[screenshot skipped] ' + String(error && error.message || error));
  }
}
async function run() {
  await launch();
  await waitFor(() => cdp.call(function () { return document.body.classList.contains('lf-auth-locked'); }), 30000);
  await registerAndLogin();
  const fixture = await setupFixture();
  pass('single-player fixture and timer UI ready',
    fixture.button && JSON.stringify(fixture.allowed) === '[30,60,120]' && fixture.audioDuration > 19.8, fixture);

  await clickSelector('#lf-sleep-timer-btn');
  await waitFor(() => cdp.call(function () {
    return document.getElementById('lf-sleep-timer').classList.contains('open');
  }));
  await clickSelector('#lf-sleep-timer [data-minutes="60"]');
  await cdp.call(function () {
    document.getElementById('lf-sleep-timer-song').value = '1';
  });
  const confirmedAt = Date.now();
  await clickSelector('#lf-sleep-timer-confirm');
  const uiState = await waitFor(() => cdp.call(function () {
    const state = window.LFSleepTimer.status();
    return state.active && state.durationMinutes === 60 && state;
  }));
  pass('physical UI sets 60-minute absolute deadline and immediately starts selected song',
    uiState.deadline - uiState.startedAt === 3600000 && uiState.selectedIndex === 1 &&
      Math.abs(uiState.startedAt - confirmedAt) < 2500, uiState);
  const uiDetail = await cdp.call(function () {
    return {
      currentIdx: window.currentIdx,
      badge: document.getElementById('lf-sleep-timer-badge').textContent,
      active: document.getElementById('lf-sleep-timer').classList.contains('active'),
      calls: window.__lfNew2Calls.slice(),
    };
  });
  pass('selected queue song plays and remaining-time UI is visible',
    uiDetail.currentIdx === 1 && uiDetail.active && /^(?:\d{2}:\d{2}|\d+:\d{2}:\d{2})$/.test(uiDetail.badge) &&
      uiDetail.calls.some(call => call.index === 1 && call.options.sleepTimerStart), uiDetail);
  await clickSelector('#lf-sleep-timer-btn');
  await cdp.call(function () { window.LFSleepTimer.cancel('test-reset', { silent: true }); });

  const durations = await cdp.call(async function () {
    const output = [];
    for (const minutes of [30, 60, 120]) {
      await window.LFSleepTimer.set(minutes, 0);
      const state = window.LFSleepTimer.status();
      output.push({ minutes, delta: state.deadline - state.startedAt, timers: state.scheduledTimerCount });
      window.LFSleepTimer.cancel('duration-check', { silent: true });
    }
    return output;
  });
  pass('all three fixed duration choices use exact absolute deadlines and one scheduled timer',
    durations.every(row => row.delta === row.minutes * 60000 && row.timers === 1), durations);

  const continuity = await cdp.call(async function () {
    await window.LFSleepTimer.setForTest(30, 0, 4200);
    const deadline = window.LFSleepTimer.status().deadline;
    window.audio.pause();
    await new Promise(resolve => setTimeout(resolve, 180));
    await window.audio.play();
    window.nextTrack();
    await new Promise(resolve => setTimeout(resolve, 260));
    return {
      deadline,
      afterDeadline: window.LFSleepTimer.status().deadline,
      currentIdx: window.currentIdx,
      active: window.LFSleepTimer.status().active,
    };
  });
  pass('pause resume and manual track change never reset deadline',
    continuity.active && continuity.deadline === continuity.afterDeadline && continuity.currentIdx === 1, continuity);

  const replaced = await cdp.call(async function () {
    await window.LFSleepTimer.setForTest(30, 0, 5000);
    const first = window.LFSleepTimer.status();
    await new Promise(resolve => setTimeout(resolve, 100));
    await window.LFSleepTimer.setForTest(120, 2, 1700);
    const second = window.LFSleepTimer.status();
    return { first, second };
  });
  pass('reset explicitly replaces old timer without duplicate callbacks',
    replaced.second.replaceCount >= 1 && replaced.second.scheduledTimerCount === 1 &&
      replaced.second.generation > replaced.first.generation && replaced.second.selectedIndex === 2, replaced);

  const beforeExpiry = await cdp.call(function () {
    return {
      deadline: window.LFSleepTimer.status().deadline,
      calls: window.__lfNew2Calls.length,
      token: window.trackSwitchToken,
    };
  });
  const expired = await waitFor(() => cdp.call(function () {
    const state = window.LFSleepTimer.status();
    return !state.active && state.expirationCount > 0 && state.autoAdvanceBlocked && state;
  }), 8000);
  const expiryDetail = await cdp.call(async function (before) {
    const callsBeforeAutomatic = window.__lfNew2Calls.length;
    window.nextTrack({ automatic: true });
    await new Promise(resolve => setTimeout(resolve, 180));
    return {
      state: window.LFSleepTimer.status(),
      paused: window.audio.paused,
      playing: window.playing,
      tokenAdvanced: window.trackSwitchToken > before.token,
      automaticCalls: window.__lfNew2Calls.length - callsBeforeAutomatic,
    };
  }, [beforeExpiry]);
  pass('deadline immediately stops playback and prevents automatic next song',
    expired.expirationCount > 0 && expiryDetail.paused && !expiryDetail.playing &&
      expiryDetail.tokenAdvanced && expiryDetail.automaticCalls === 0, expiryDetail);

  const manualResume = await cdp.call(async function () {
    const before = window.LFSleepTimer.status();
    window.LFSleepTimer.allowPlayback('manual-test');
    await window.audio.play();
    window.playing = true;
    window.setPlayIcon(true);
    return { before, after: window.LFSleepTimer.status(), paused: window.audio.paused };
  });
  pass('explicit manual playback clears only the post-deadline guard',
    manualResume.before.autoAdvanceBlocked && !manualResume.after.autoAdvanceBlocked && !manualResume.paused, manualResume);

  const cancelled = await cdp.call(async function () {
    await window.LFSleepTimer.setForTest(60, 0, 4000);
    const deadline = window.LFSleepTimer.status().deadline;
    const pausedBefore = window.audio.paused;
    window.LFSleepTimer.cancel('user-cancel', { silent: true });
    return {
      deadline,
      pausedBefore,
      pausedAfter: window.audio.paused,
      state: window.LFSleepTimer.status(),
      diagnostics: window.LFSleepTimer.diagnostics(),
    };
  });
  pass('cancel clears timer without stopping current playback or persisting temporary state',
    !cancelled.state.active && cancelled.state.scheduledTimerCount === 0 &&
      cancelled.pausedBefore === cancelled.pausedAfter && cancelled.diagnostics.persistedKeys.length === 0, cancelled);

  await stopApp();
  await launch();
  await waitFor(() => cdp.call(function () {
    return !document.body.classList.contains('lf-auth-locked') && window.LFSleepTimer;
  }), 30000);
  const restarted = await cdp.call(function () {
    return {
      state: window.LFSleepTimer.status(),
      diagnostics: window.LFSleepTimer.diagnostics(),
      button: !!document.getElementById('lf-sleep-timer-btn'),
    };
  });
  pass('full app restart never resumes temporary timer',
    restarted.button && !restarted.state.active && restarted.state.deadline === 0 &&
      restarted.state.scheduledTimerCount === 0 && restarted.diagnostics.persistedKeys.length === 0, restarted);
  pass('renderer has no uncaught exceptions', rendererErrors.length === 0, rendererErrors);

  return {
    ok: true,
    runId,
    mode: launchMode,
    evidenceDir,
    checks,
    screenshots,
    rendererErrors,
  };
}

(async () => {
  let result;
  try {
    result = await run();
    fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    const failure = {
      ok: false,
      runId,
      mode: launchMode,
      evidenceDir,
      error: String(error && error.stack || error),
      checks,
      screenshots,
      rendererErrors,
      appLog: appLog.join('').slice(-12000),
    };
    fs.writeFileSync(path.join(evidenceDir, 'failure.json'), JSON.stringify(failure, null, 2));
    console.error(failure.error);
    process.exitCode = 1;
  } finally {
    await stopApp();
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
})();
