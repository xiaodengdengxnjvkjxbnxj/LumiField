'use strict';

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const electron = require('electron');
const argv = process.argv.slice(2);

function argumentValue(name) {
  const prefix = name + '=';
  const inline = argv.find((item) => item.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : '';
}

const installedExecutable = path.resolve(
  argumentValue('--installed-exe') ||
  String(process.env.LF_NEW4_EXECUTABLE || '').trim() ||
  electron
);
const launchMode = installedExecutable === path.resolve(electron) ? 'source' : 'installed';
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.resolve(
  argumentValue('--out') ||
  process.env.LF_NEW4_OUT ||
  path.join(repo, 'test-results', 'lf-new4-smoke', runId)
);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-new4-'));
const checks = {};
const screenshots = [];
const rendererErrors = [];
const appLog = [];
let child = null;
let cdp = null;

fs.mkdirSync(evidenceDir, { recursive: true });

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pass(name, condition, detail) {
  assert.ok(condition, name + ': ' + JSON.stringify(detail));
  checks[name] = detail == null ? true : detail;
}

async function waitFor(fn, timeout = 30000, interval = 100) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (_) {}
    await delay(interval);
  }
  throw new Error('Timeout; last=' + JSON.stringify(last));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

class CDP {
  constructor(url) {
    this.url = url;
    this.sequence = 0;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result || {});
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const detail = message.params && message.params.exceptionDetails || {};
        rendererErrors.push(String(
          detail.exception && detail.exception.description ||
          detail.text ||
          'Renderer exception'
        ).slice(0, 1800));
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params && message.params.type === 'error') {
        rendererErrors.push((message.params.args || []).map((arg) =>
          String(arg.value || arg.description || '')
        ).join(' ').slice(0, 1800));
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
    const id = ++this.sequence;
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
      throw new Error(
        response.exceptionDetails.exception && response.exceptionDetails.exception.description ||
        response.exceptionDetails.text ||
        'Runtime.evaluate failed'
      );
    }
    return response.result && response.result.value;
  }

  call(fn, args = []) {
    return this.evaluate('(' + fn.toString() + ').apply(null,' + JSON.stringify(args) + ')');
  }

  close() {
    try { this.ws.close(); } catch (_) {}
  }
}

async function capture(name, detail) {
  try {
    await cdp.call(function(value) {
      var node = document.getElementById('lf-new4-evidence');
      if (!node) {
        node = document.createElement('pre');
        node.id = 'lf-new4-evidence';
        node.style.cssText = 'position:fixed;left:24px;bottom:90px;z-index:2147483647;max-width:680px;padding:14px 18px;border:1px solid rgba(126,249,215,.75);border-radius:12px;background:rgba(4,12,23,.92);color:#baffeb;font:13px/1.45 Consolas,monospace;white-space:pre-wrap;pointer-events:none';
        document.body.appendChild(node);
      }
      node.textContent = 'LumiField New Feature 4\\n' + JSON.stringify(value, null, 2);
      return true;
    }, [detail]);
    const response = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    }, 15000);
    const file = path.join(evidenceDir, name + '.png');
    fs.writeFileSync(file, Buffer.from(response.data, 'base64'));
    screenshots.push(file);
  } catch (error) {
    appLog.push('[New4 screenshot skipped] ' + name + ': ' + String(error && error.message || error) + '\n');
  }
}

function staticAudit() {
  const main = fs.readFileSync(path.join(repo, 'desktop', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(repo, 'desktop', 'preload.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(repo, 'public', 'index.html'), 'utf8');
  pass('native Windows thumbar API is used',
    /setThumbarButtons\(buttons\)/.test(main) && /process\.platform === ['"]win32['"]/.test(main),
    true);
  pass('three native actions reuse the unique player channel',
    ['prevTrack', 'togglePlay', 'nextTrack'].every((action) =>
      main.includes("sendGlobalHotkeyAction('" + action + "')")
    ),
    true);
  pass('preload exposes state update and read-only diagnostics',
    preload.includes('updateTaskbarPlaybackState:') &&
      preload.includes('getTaskbarToolbarState:') &&
      preload.includes('testTaskbarToolbarClick:'),
    true);
  pass('test click is environment gated',
    /LF_ALLOW_PACKAGED_CDP_TEST[^]*TEST_DISABLED/.test(main),
    true);
  pass('renderer synchronizes central icon and queue state',
    /function syncTaskbarPlaybackState/.test(renderer) &&
      /function setPlayIcon\(p\)[^]*syncTaskbarPlaybackState\(!!p\)/.test(renderer) &&
      /function renderQueuePanel[^]*syncTaskbarPlaybackState\(\)/.test(renderer),
    true);
  const searchStart = renderer.indexOf('async function doSearch(q, opts)');
  const searchEnd = renderer.indexOf('// ============================================================\n//  音频上下文', searchStart);
  const searchBlock = renderer.slice(searchStart, searchEnd);
  pass('every music search shows a synchronous pending result before network await',
    searchStart >= 0 &&
      searchBlock.indexOf("$results.setAttribute('aria-busy', 'true')") >= 0 &&
      searchBlock.indexOf("$results.classList.add('show')") < searchBlock.indexOf('await fetchMusicSearchResults'),
    true);
}

async function startApp() {
  const port = await freePort();
  const source = launchMode === 'source';
  const args = (source ? ['.'] : []).concat([
    '--user-data-dir=' + userData,
    '--remote-debugging-port=' + port,
    '--remote-debugging-address=127.0.0.1',
    '--window-size=1440,920',
  ]);
  child = spawn(installedExecutable, args, {
    cwd: source ? repo : path.dirname(installedExecutable),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, {
      LF_ALLOW_PACKAGED_CDP_TEST: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      LUMIFIELD_SKIP_SPLASH: '1',
      LF_MAIL_HOST: ' ',
      LF_MAIL_USER: ' ',
      LF_MAIL_PASSWORD: ' ',
      LF_REMOTE_API_URL: ' ',
    }),
  });
  const collect = (chunk) => {
    const text = String(chunk);
    appLog.push(text);
    if (/(?:FATAL|uncaught exception|renderer process crashed)/i.test(text)) {
      rendererErrors.push(text.trim().slice(0, 1800));
    }
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  const target = await waitFor(async () => {
    const response = await fetch('http://127.0.0.1:' + port + '/json/list');
    const list = await response.json();
    return list.find((item) =>
      item.type === 'page' &&
      /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//.test(item.url)
    );
  }, 50000, 180);
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 920,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitFor(() => cdp.call(function() {
    return document.readyState === 'complete' &&
      !!window.desktopWindow &&
      typeof window.desktopWindow.updateTaskbarPlaybackState === 'function' &&
      typeof window.executeHotkeyAction === 'function' &&
      typeof window.syncTaskbarPlaybackState === 'function';
  }), 50000, 120);
  await delay(600);
}

async function prepareFixture() {
  return cdp.call(async function() {
    document.body.classList.remove('splash-active', 'empty-home-active', 'lf-auth-locked', 'immersive-mode');
    var splash = document.getElementById('splash');
    if (splash) splash.style.display = 'none';
    var auth = document.getElementById('lf-auth-root');
    if (auth) auth.style.display = 'none';
    if (!globalHotkeyListenerBound) bindHotkeySettings();

    window.__lfNew4Switches = [];
    window.__lfNew4OriginalPlayQueueAt = window.playQueueAt;
    window.__lfNew4OriginalTogglePlay = window.togglePlay;
    window.playQueueAt = function(idx) {
      currentIdx = idx;
      window.__lfNew4Switches.push({
        index: idx,
        id: playQueue[idx] && playQueue[idx].id || '',
        minimizedAtDispatch: window.__lfNew4Minimized === true
      });
      safeRenderQueuePanel('new4-test-switch');
      syncTaskbarPlaybackState();
      return Promise.resolve(true);
    };
    window.togglePlay = function() {
      playing = !playing;
      setPlayIcon(playing);
      return Promise.resolve(playing);
    };
    playMode = 'loop';
    playQueue = [
      { id: 'new4-a', name: 'New4 A', artist: 'LumiField', provider: 'local' },
      { id: 'new4-b', name: 'New4 B', artist: 'LumiField', provider: 'local' },
      { id: 'new4-c', name: 'New4 C', artist: 'LumiField', provider: 'local' }
    ];
    currentIdx = 1;
    playing = false;
    safeRenderQueuePanel('new4-test-ready');
    setPlayIcon(false);
    await new Promise(function(resolve) { setTimeout(resolve, 250); });
    return {
      queueIds: playQueue.map(function(item) { return item.id; }),
      currentIdx: currentIdx,
      listenerBound: globalHotkeyListenerBound
    };
  });
}

async function toolbarState() {
  return cdp.call(async function() {
    return window.desktopWindow.getTaskbarToolbarState();
  });
}

async function runRuntimeChecks() {
  const fixture = await prepareFixture();
  pass('fixture uses three-item real queue and product hotkey listener',
    fixture.listenerBound &&
      fixture.currentIdx === 1 &&
      fixture.queueIds.join(',') === 'new4-a,new4-b,new4-c',
    fixture);

  const searchFeedback = await cdp.call(async function() {
    var originalFetch = window.fetchMusicSearchResults;
    var originalAuth = window.LFAuth;
    var releaseSearch;
    window.LFAuth = null;
    window.fetchMusicSearchResults = function() {
      return new Promise(function(resolve) { releaseSearch = resolve; });
    };
    searchMode = 'song';
    $input.value = 'LumiField immediate feedback';
    var pendingPromise = doSearch($input.value, { source:'programmatic-test' });
    var immediate = {
      visible: $results.classList.contains('show'),
      busy: $results.getAttribute('aria-busy'),
      text: $results.textContent,
      childCount: $results.children.length
    };
    releaseSearch([{ id:'lf-search-feedback', name:'Immediate Feedback', artist:'LumiField', provider:'netease', playable:true }]);
    await pendingPromise;
    var settled = {
      visible: $results.classList.contains('show'),
      busy: $results.getAttribute('aria-busy'),
      resultCount: $results.querySelectorAll('.search-result').length
    };
    window.fetchMusicSearchResults = originalFetch;
    window.LFAuth = originalAuth;
    return { immediate: immediate, settled: settled };
  });
  pass('programmatic search exposes loading UI in the same task',
    searchFeedback.immediate.visible &&
      searchFeedback.immediate.busy === 'true' &&
      /正在搜索/.test(searchFeedback.immediate.text) &&
      searchFeedback.immediate.childCount === 1,
    searchFeedback.immediate);
  pass('search pending state closes after the latest result renders',
    searchFeedback.settled.visible &&
      searchFeedback.settled.busy === 'false' &&
      searchFeedback.settled.resultCount === 1,
    searchFeedback.settled);

  const paused = await waitFor(async () => {
    const state = await toolbarState();
    return state && state.applied && state.buttonCount === 3 && state.playing === false && state;
  });
  pass('three native buttons applied with valid icons',
    paused.supported === true &&
      paused.buttons.length === 3 &&
      paused.buttons.every((button) => button.iconReady === true),
    paused);
  pass('paused state shows play icon and queue navigation enabled',
    paused.buttons[1].tooltip === '播放' &&
      paused.buttons[0].enabled === true &&
      paused.buttons[2].enabled === true,
    paused);
  await capture('01-taskbar-paused', paused);

  const playClick = await cdp.call(async function() {
    return window.desktopWindow.testTaskbarToolbarClick('togglePlay');
  });
  pass('native play test callback accepted', playClick && playClick.ok, playClick);
  const active = await waitFor(async () => {
    const state = await toolbarState();
    return state && state.playing === true && state.buttons[1].tooltip === '暂停' && state;
  });
  pass('play state changes native action to pause with valid icon',
    active.buttons[1].iconReady === true,
    active);
  await capture('02-taskbar-playing', active);

  const pauseClick = await cdp.call(async function() {
    return window.desktopWindow.testTaskbarToolbarClick('togglePlay');
  });
  pass('native pause test callback accepted', pauseClick && pauseClick.ok, pauseClick);
  const pausedAgain = await waitFor(async () => {
    const state = await toolbarState();
    return state && state.playing === false && state.buttons[1].tooltip === '播放' && state;
  });
  pass('pause state changes native action back to play', pausedAgain.buttons[1].iconReady === true, pausedAgain);

  await cdp.call(async function() {
    await window.desktopWindow.minimize();
    return true;
  });
  const minimized = await waitFor(() => cdp.call(async function() {
    var state = await window.desktopWindow.getState();
    if (state && state.isMinimized) window.__lfNew4Minimized = true;
    return state && state.isMinimized && state;
  }), 10000, 100);
  pass('main window is minimized before native navigation clicks', minimized.isMinimized === true, minimized);

  const nextClick = await cdp.call(async function() {
    return window.desktopWindow.testTaskbarToolbarClick('nextTrack');
  });
  pass('native next callback accepted while minimized', nextClick && nextClick.ok, nextClick);
  const afterNext = await waitFor(() => cdp.call(function() {
    var last = window.__lfNew4Switches[window.__lfNew4Switches.length - 1];
    return currentIdx === 2 && last && { currentIdx: currentIdx, id: playQueue[currentIdx].id, last: last };
  }), 8000, 80);
  pass('next uses product queue order while minimized',
    afterNext.currentIdx === 2 &&
      afterNext.id === 'new4-c' &&
      afterNext.last.minimizedAtDispatch === true,
    afterNext);

  const previousClick = await cdp.call(async function() {
    return window.desktopWindow.testTaskbarToolbarClick('prevTrack');
  });
  pass('native previous callback accepted while minimized', previousClick && previousClick.ok, previousClick);
  const afterPrevious = await waitFor(() => cdp.call(function() {
    var last = window.__lfNew4Switches[window.__lfNew4Switches.length - 1];
    return currentIdx === 1 && last && { currentIdx: currentIdx, id: playQueue[currentIdx].id, last: last };
  }), 8000, 80);
  pass('previous uses product queue order while minimized',
    afterPrevious.currentIdx === 1 &&
      afterPrevious.id === 'new4-b' &&
      afterPrevious.last.minimizedAtDispatch === true,
    afterPrevious);

  await cdp.call(async function() {
    playQueue = [];
    currentIdx = -1;
    playing = false;
    safeRenderQueuePanel('new4-test-empty');
    setPlayIcon(false);
    await new Promise(function(resolve) { setTimeout(resolve, 160); });
    return true;
  });
  const empty = await waitFor(async () => {
    const state = await toolbarState();
    return state &&
      state.canPrevious === false &&
      state.canNext === false &&
      state.buttons.length === 3 &&
      state;
  });
  pass('empty queue disables previous and next without removing toolbar',
    empty.applied === true &&
      empty.buttonCount === 3 &&
      empty.buttons[0].enabled === false &&
      empty.buttons[2].enabled === false &&
      empty.buttons[1].enabled === true,
    empty);
}

async function stopApp() {
  if (cdp) {
    try { await cdp.call(function() { window.close(); return true; }); } catch (_) {}
    cdp.close();
    cdp = null;
  }
  if (child && child.pid && child.exitCode == null) {
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      delay(3000),
    ]);
  }
  if (child && child.pid && child.exitCode == null) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  }
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) {}
}

async function run() {
  staticAudit();
  await startApp();
  await runRuntimeChecks();
  pass('rendererErrors=0', rendererErrors.length === 0, rendererErrors);
  const result = {
    ok: true,
    runId,
    launchMode,
    executable: installedExecutable,
    evidenceDir,
    checks,
    screenshots,
    rendererErrors,
  };
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({
    ok: true,
    launchMode,
    evidenceDir,
    checkCount: Object.keys(checks).length,
    screenshots: screenshots.length,
    rendererErrors: rendererErrors.length,
  }, null, 2));
}

run().catch((error) => {
  const failure = {
    ok: false,
    error: String(error && error.stack || error),
    launchMode,
    executable: installedExecutable,
    evidenceDir,
    checks,
    screenshots,
    rendererErrors,
  };
  try {
    fs.writeFileSync(path.join(evidenceDir, 'failure.json'), JSON.stringify(failure, null, 2));
  } catch (_) {}
  console.error(failure.error);
  process.exitCode = 1;
}).finally(async () => {
  try {
    fs.writeFileSync(path.join(evidenceDir, 'app.log'), appLog.join(''));
  } catch (_) {}
  await stopApp();
});
