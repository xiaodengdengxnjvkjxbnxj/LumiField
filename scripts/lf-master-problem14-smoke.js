'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const asar = require('@electron/asar');

const repo = path.resolve(__dirname, '..');
const electron = require('electron');
const argv = process.argv.slice(2);
const playerOnly = argv.includes('--player-only');
const exeArg = argv.find(value => value.startsWith('--exe='));
const performanceArg = argv.find(value => value.startsWith('--performance-ms='));
const performanceArgIndex = argv.indexOf('--performance-ms');
const performanceRaw = performanceArg
  ? performanceArg.slice('--performance-ms='.length)
  : (performanceArgIndex >= 0 ? argv[performanceArgIndex + 1] : '60000');
const performanceMs = Number(performanceRaw);
if (!Number.isFinite(performanceMs) || performanceMs < 1000) {
  throw new Error('--performance-ms must be a finite number >= 1000');
}
const performanceLabel = performanceMs === 60000
  ? '60-second'
  : `${Number((performanceMs / 1000).toFixed(3))}-second diagnostic`;
const performanceFocusCheckName = `${performanceLabel} performance window is restored, foreground and renderer-focused`;
const performanceCompleteCheckName = `${performanceLabel} interactive LiquidGlass performance window runs completely`;
const requestedExe = exeArg ? path.resolve(exeArg.slice('--exe='.length)) : '';
if (requestedExe && !fs.existsSync(requestedExe)) throw new Error(`Installed executable not found: ${requestedExe}`);
const requestedAsar = requestedExe ? path.join(path.dirname(requestedExe), 'resources', 'app.asar') : '';
if (requestedAsar && !fs.existsSync(requestedAsar)) throw new Error(`Installed app.asar not found: ${requestedAsar}`);
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.resolve(process.env.LF_MASTER_PROBLEM14_OUT ||
  path.join(repo, 'test-results', 'lf-master-problem14-smoke', runId));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-master-problem14-'));
const checks = {};
const screenshots = [];
const rendererErrors = [];
const appLog = [];
let app = null;
let cdp = null;
let origin = '';

const REQUIRED_SINGLE = [
  '.lf-weather-shell',
  '#search-box',
  '#search-results',
  '#playlist-panel',
  '#fx-panel',
  '#lf-account-button',
  '.track-detail-modal',
  '#lf-profile-modal .lf-profile-dialog',
  '#lf-wallpaper-modal .lf-wallpaper-dialog',
];
const REQUIRED_GROUPS = Object.freeze({
  '.home-card': 6,
  '.home-tile': 5,
  '.modal': 9,
});
const FULL_MODE = Object.freeze({ supported: true, reducedMotion: false, eco: false });

fs.mkdirSync(evidenceDir, { recursive: true });

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function compact(value, depth = 0) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 1800 ? `${value.slice(0, 1800)}…` : value;
  if (value instanceof Error) return compact({ name: value.name, message: value.message, code: value.code }, depth);
  if (depth >= 5) return Array.isArray(value) ? `[Array(${value.length})]` : `{Object(${Object.keys(value).length})}`;
  if (Array.isArray(value)) {
    const out = value.slice(0, 24).map(item => compact(item, depth + 1));
    if (value.length > 24) out.push({ truncatedItems: value.length - 24 });
    return out;
  }
  if (typeof value === 'object') {
    const out = {};
    const keys = Object.keys(value);
    keys.slice(0, 64).forEach(key => { out[key] = compact(value[key], depth + 1); });
    if (keys.length > 64) out.__truncatedKeys = keys.length - 64;
    return out;
  }
  return String(value);
}
function pass(name, condition, details) {
  const evidence = details == null ? true : compact(details);
  assert.ok(condition, `${name}${details == null ? '' : `: ${JSON.stringify(evidence)}`}`);
  checks[name] = evidence;
  return details;
}
function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  Object.keys(value).sort().forEach(key => { out[key] = stableJson(value[key]); });
  return out;
}
function deepEqual(left, right) { return JSON.stringify(stableJson(left)) === JSON.stringify(stableJson(right)); }
function getPath(value, paths) {
  for (const fieldPath of paths) {
    const result = String(fieldPath).split('.').reduce((current, key) => current == null ? undefined : current[key], value);
    if (result !== undefined) return result;
  }
  return undefined;
}
function numericBlur(value) {
  const match = /blur\(\s*([\d.]+)px\s*\)/i.exec(String(value || ''));
  return match ? Number(match[1]) : 0;
}
function rectClose(left, right, tolerance = 1) {
  return Math.abs(Number(left.x) - Number(right.x)) <= tolerance &&
    Math.abs(Number(left.y) - Number(right.y)) <= tolerance &&
    Math.abs(Number(left.width) - Number(right.width)) <= tolerance &&
    Math.abs(Number(left.height) - Number(right.height)) <= tolerance;
}

function verifyStaticLiquidGlassContract() {
  const cssFile = path.join(repo, 'public', 'lf-liquid-glass.css');
  const jsFile = path.join(repo, 'public', 'lf-liquid-glass.js');
  const indexFile = path.join(repo, 'public', 'index.html');
  pass('shared LiquidGlass implementation ships as one CSS component and one runtime controller',
    fs.existsSync(cssFile) && fs.existsSync(jsFile), { cssFile, jsFile });
  const css = fs.readFileSync(cssFile, 'utf8');
  const js = fs.readFileSync(jsFile, 'utf8');
  const index = fs.readFileSync(indexFile, 'utf8');
  const requiredVariables = [
    '--lf-lg-opacity', '--lf-lg-blur', '--lf-lg-saturate', '--lf-lg-border-alpha',
    '--lf-lg-radius', '--lf-lg-shadow', '--lf-lg-highlight-alpha',
    '--lf-lg-wallpaper-rgb', '--lf-lg-accent-rgb',
  ];
  pass('LiquidGlass defines shared transmission, blur, saturation, edge, radius, shadow and highlight variables',
    requiredVariables.every(name => css.includes(name)), requiredVariables.map(name => [name, css.includes(name)]));
  pass('LiquidGlass CSS includes active, fallback, reduced-motion and eco policies',
    /\.lf-liquid-glass/.test(css) && /fallback|no-backdrop|@supports\s+not/i.test(css) &&
    /reduced-motion|prefers-reduced-motion/i.test(css) && /eco|low-power/i.test(css), true);
  const cssIndex = index.indexOf('lf-liquid-glass.css');
  const lateBaseCssIndex = index.indexOf('lf-playlist-link-import.css');
  const jsIndex = index.indexOf('lf-liquid-glass.js');
  pass('LiquidGlass runtime is loaded after base UI and exposes one shared controller',
    cssIndex > lateBaseCssIndex && jsIndex > cssIndex &&
    /LumiFieldLiquidGlass/.test(js) && /pointermove/.test(js) && /passive\s*:\s*true/.test(js), true);
  const rafMentions = (js.match(/requestAnimationFrame\s*\(/g) || []).length;
  pass('pointer refraction uses at most one shared animation scheduler instead of one loop per panel',
    rafMentions <= 2, { requestAnimationFrameCalls: rafMentions });
  pass('LiquidGlass pseudo layers cannot intercept pointer events',
    /::before[\s\S]{0,1000}pointer-events\s*:\s*none/i.test(css) &&
    /::after[\s\S]{0,1000}pointer-events\s*:\s*none/i.test(css), true);
  pass('shared LiquidGlass leaves the complete pre-task music player console untouched',
    !/#bottom-bar/.test(css) && !/#bottom-bar/.test(js) &&
    !/\.mini-queue-popover/.test(js) && !/\.volume-popover/.test(js) && !/\.quality-popover/.test(js) &&
    index.includes('#bottom-bar::before{content:none}') &&
    index.includes('#bottom-bar::after{content:none}') &&
    index.includes('#bottom-bar.visible{opacity:.91'), true);
}

async function waitFor(fn, timeout = 45000, interval = 100) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try { last = await fn(); if (last) return last; } catch (_) {}
    await delay(interval);
  }
  throw new Error(`Timed out after ${timeout} ms; last=${JSON.stringify(compact(last))}`);
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
      } else if (message.method === 'Log.entryAdded') {
        const entry = message.params && message.params.entry || {};
        if (/^(?:error|assert)$/.test(String(entry.level || '')) && String(entry.source || '').toLowerCase() !== 'network') {
          rendererErrors.push(String(entry.text || 'Renderer log error').slice(0, 3000));
        }
      }
    };
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
    await this.send('DOM.enable');
    await this.send('Log.enable');
    await this.send('Performance.enable');
    await this.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await this.send('Page.bringToFront');
  }
  send(method, params = {}, timeout = 90000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression, timeout = 90000) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }, timeout);
    if (response.exceptionDetails) {
      const exception = response.exceptionDetails.exception || {};
      throw new Error(exception.description || response.exceptionDetails.text || 'Runtime.evaluate failed');
    }
    return response.result && response.result.value;
  }
  call(fn, args = [], timeout = 90000) { return this.evaluate(`(${fn.toString()}).apply(null,${JSON.stringify(args)})`, timeout); }
  close() { try { this.ws.close(); } catch (_) {} }
}

async function findMainTarget(port) {
  return waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json();
    return targets.find(target => target.type === 'page' && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//.test(target.url)) || null;
  }, 60000, 160);
}
function focusAppWindow() {
  const pid = Number(app && app.pid || 0);
  if (!pid) return null;
  const script = [
    "$native='[DllImport(\"user32.dll\")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow); [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport(\"user32.dll\")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint flags); [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId); [DllImport(\"user32.dll\")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);'",
    'Add-Type -Name Win32 -Namespace LF -MemberDefinition $native',
    `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    '$activated=(New-Object -ComObject WScript.Shell).AppActivate(' + pid + ')',
    '$ok=$false; $windowPid=[uint32]0; $handle=[IntPtr]::Zero',
    'if($p -and $p.MainWindowHandle -ne 0){$handle=$p.MainWindowHandle; [LF.Win32]::ShowWindowAsync($handle,9)|Out-Null; [LF.Win32]::SetWindowPos($handle,[IntPtr](-1),0,0,0,0,0x43)|Out-Null; for($i=0;$i -lt 4 -and [LF.Win32]::GetForegroundWindow() -ne $handle;$i++){[LF.Win32]::keybd_event(0x12,0,0,[UIntPtr]::Zero); [LF.Win32]::keybd_event(0x12,0,2,[UIntPtr]::Zero); $ok=[LF.Win32]::SetForegroundWindow($handle); Start-Sleep -Milliseconds 80}}',
    '$foreground=[LF.Win32]::GetForegroundWindow()',
    'if($foreground -ne [IntPtr]::Zero){[LF.Win32]::GetWindowThreadProcessId($foreground,[ref]$windowPid)|Out-Null}',
    '[pscustomobject]@{targetPid=' + pid + ';handle=[int64]$handle;appActivate=[bool]$activated;setForeground=[bool]$ok;foregroundPid=[uint32]$windowPid}|ConvertTo-Json -Compress'
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 12000,
  });
  try { return JSON.parse(String(result.stdout || '').trim()); } catch (_) { return null; }
}
async function pageReady() {
  return waitFor(async () => {
    const first = await cdp.call(function (expectedOrigin) {
      if (!document.body || location.origin !== expectedOrigin) return null;
      const api = window.LumiFieldLiquidGlass;
      const methods = ['getDebug', 'refresh', 'setTestMode', 'setTestTheme', 'setTestRole'];
      var ready = document.readyState === 'complete' && api && methods.every(function (name) {
        return typeof api[name] === 'function';
      });
      return ready ? { timeOrigin: performance.timeOrigin, href: location.href } : null;
    }, [origin]);
    if (!first) return false;
    await delay(160);
    return cdp.call(function (expectedOrigin, marker) {
      var api = window.LumiFieldLiquidGlass;
      return document.readyState === 'complete' && location.origin === expectedOrigin &&
        performance.timeOrigin === marker.timeOrigin && location.href === marker.href && api &&
        ['getDebug', 'refresh', 'setTestMode', 'setTestTheme', 'setTestRole']
          .every(function (name) { return typeof api[name] === 'function'; });
    }, [origin, first]);
  }, 70000, 80);
}
async function startApp() {
  const port = await freePort();
  let appRoot = '.';
  if (requestedAsar) {
    appRoot = path.join(userData, 'installed-asar');
    asar.extractAll(requestedAsar, appRoot);
  }
  const executable = electron;
  const launchArgs = [
    `--user-data-dir=${userData}`,
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    '--window-size=1440,920',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ];
  launchArgs.unshift(appRoot);
  app = spawn(executable, launchArgs, {
    cwd: requestedAsar ? appRoot : repo,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, {
      LUMIFIELD_SKIP_SPLASH: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      LF_ALLOW_LOCAL_CODES: '1',
      LF_MASTER_TEST: '1',
      LUMIFIELD_E2E_TEST: '1',
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
  focusAppWindow();
  await cdp.send('Page.bringToFront');
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
    spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  }
  app = null;
  await delay(300);
}
async function screenshot(name) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  const file = path.join(evidenceDir, `${String(screenshots.length + 1).padStart(2, '0')}-${name}.png`);
  fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  screenshots.push(file);
  return file;
}

async function prepareSurface() {
  return cdp.call(async function () {
    document.documentElement.setAttribute('data-lf-e2e', 'problem14');
    var api = window.LumiFieldLiquidGlass;
    if (typeof goHome === 'function') goHome();
    document.body.classList.remove('splash-active');
    var splash = document.getElementById('splash');
    if (splash) splash.style.display = 'none';
    var bottom = document.getElementById('bottom-bar');
    if (bottom) bottom.classList.add('visible');
    if (!document.getElementById('lf-account-button')) {
      var account = document.createElement('button');
      account.id = 'lf-account-button';
      account.type = 'button';
      account.textContent = '我的';
      account.title = 'LF 我的账号';
      account.onclick = function () { window.__lfP14AccountClicks = (window.__lfP14AccountClicks || 0) + 1; };
      var top = document.getElementById('top-right');
      if (top) top.insertBefore(account, document.getElementById('user-btn'));
      else document.body.appendChild(account);
    }
    if (!document.getElementById('lf-profile-modal')) {
      var profileModal = document.createElement('div');
      profileModal.id = 'lf-profile-modal';
      profileModal.style.display = 'none';
      profileModal.innerHTML = '<div class="lf-profile-dialog" role="dialog" aria-modal="true"></div>';
      document.body.appendChild(profileModal);
    }
    await api.setTestRole('user');
    await api.setTestMode({ supported:true, reducedMotion:false, eco:false });
    await api.refresh('problem14-smoke-prepare');
    await new Promise(function (resolve) {
      requestAnimationFrame(function () { requestAnimationFrame(resolve); });
    });
    var homeDeadline = performance.now() + 20000;
    while ((document.querySelectorAll('.home-card').length < 6 || document.querySelectorAll('.home-tile').length < 5) && performance.now() < homeDeadline) {
      await new Promise(function (resolve) { setTimeout(resolve, 100); });
    }
    await api.refresh('problem14-smoke-settled');
    return api.getDebug();
  });
}

async function verifyPlayerConsoleBaselineAppearance() {
  const consoleState = await cdp.call(function () {
    var bar = document.getElementById('bottom-bar');
    var controls = document.getElementById('controls');
    var play = document.getElementById('play-btn');
    var queue = document.getElementById('mini-queue-popover');
    var volume = document.querySelector('.volume-popover');
    var quality = document.querySelector('.quality-popover');
    var style = getComputedStyle(bar);
    var before = getComputedStyle(bar, '::before');
    var after = getComputedStyle(bar, '::after');
    var rect = bar.getBoundingClientRect();
    var controlsRect = controls.getBoundingClientRect();
    var playRect = play.getBoundingClientRect();
    return {
      marker:bar.getAttribute('data-lf-liquid-glass'),
      backgroundColor:style.backgroundColor,
      backgroundImage:style.backgroundImage,
      backdropFilter:style.backdropFilter || style.webkitBackdropFilter || '',
      borderWidth:style.borderWidth,
      borderRadius:style.borderRadius,
      boxShadow:style.boxShadow,
      opacity:style.opacity,
      pointerEvents:style.pointerEvents,
      before:{ content:before.content, backgroundImage:before.backgroundImage },
      after:{ content:after.content, backgroundImage:after.backgroundImage },
      rect:{ x:rect.x, y:rect.y, width:rect.width, height:rect.height },
      controlsRect:{ x:controlsRect.x, y:controlsRect.y, width:controlsRect.width, height:controlsRect.height },
      playRect:{ x:playRect.x, y:playRect.y, width:playRect.width, height:playRect.height },
      popovers:[queue, volume, quality].map(function (node) {
        return {
          id:node && (node.id || node.className),
          marker:node && node.getAttribute('data-lf-liquid-glass'),
          position:node ? getComputedStyle(node).position : ''
        };
      }),
      childCount:controls.children.length
    };
  });
  pass('real Electron player console is excluded from the new shared LiquidGlass component',
    consoleState.marker == null, consoleState);
  pass('player console restores its original transparent pill without added tint or pseudo overlays',
    consoleState.backgroundImage === 'none' && consoleState.borderWidth === '0px' &&
    consoleState.borderRadius === '22px' && consoleState.before.content === 'none' &&
    consoleState.after.content === 'none' && consoleState.backgroundColor === 'rgba(8, 14, 24, 0.28)' &&
    /mineradio-control-glass-filter/.test(consoleState.backdropFilter) &&
    /0px 18px 50px/.test(consoleState.boxShadow),
    consoleState);
  pass('restored player console remains visible, interactive and keeps the original control geometry',
    Number(consoleState.opacity) >= .9 && consoleState.pointerEvents === 'auto' &&
    consoleState.rect.width > 900 && consoleState.rect.height >= 80 && consoleState.rect.height <= 110 &&
    consoleState.controlsRect.width > 850 && consoleState.playRect.width >= 54 &&
    consoleState.childCount === 3,
    consoleState);
  pass('queue, volume and quality popovers keep original absolute positioning and never enlarge the console',
    consoleState.popovers.length === 3 && consoleState.popovers.every(function (item) {
      return item.marker == null && item.position === 'absolute';
    }), consoleState.popovers);
  await screenshot('player-console-pre-task-appearance-restored');
  return consoleState;
}

async function verifyPlayerControlInventoryAndPopovers() {
  const result = await cdp.call(function () {
    var required = [
      ['#quality-btn', 'toggleQualityPanel'], ['#heart-btn', 'toggleLikeCurrent'],
      ['#collect-btn', 'openCollectModalForCurrent'], ['#play-mode-btn', 'cyclePlayMode'],
      ['#prev-btn', 'prevTrack'], ['#play-btn', 'togglePlay'], ['#next-btn', 'nextTrack'],
      ['#mini-queue-btn', 'toggleMiniQueue'], ['.lyrics-toggle-btn', 'toggleLyricsPanel'],
      ['#volume-btn', 'toggleVolumePanel'], ['#controls-hide-btn', 'toggleControlsAutoHide'],
      ['#immersive-btn', 'toggleImmersiveMode'], ['.fullscreen-toggle-btn', 'toggleFullscreen']
    ];
    var controls = required.map(function (entry) {
      var node = document.querySelector(entry[0]);
      return {
        selector:entry[0], handler:entry[1], present:!!node,
        handlerType:typeof window[entry[1]], disabled:!!(node && node.disabled),
        pointerEvents:node ? getComputedStyle(node).pointerEvents : '',
        display:node ? getComputedStyle(node).display : ''
      };
    });
    function eventStub() { return { preventDefault:function(){}, stopPropagation:function(){} }; }
    function toggleAndRead(toggle, root, popup) {
      try { toggle(eventStub()); } catch (_) { return { opened:false, error:String(_) }; }
      var container = document.querySelector(root);
      var panel = document.querySelector(popup);
      var opened = !!(container && (container.classList.contains('open') || container.classList.contains('show')));
      var state = {
        opened:opened,
        popupPosition:panel ? getComputedStyle(panel).position : '',
        popupPointerEvents:panel ? getComputedStyle(panel).pointerEvents : ''
      };
      try { toggle(eventStub()); } catch (_) {}
      return state;
    }
    var popovers = {
      quality:toggleAndRead(window.toggleQualityPanel, '#quality-control', '.quality-popover'),
      volume:toggleAndRead(window.toggleVolumePanel, '#volume-control', '.volume-popover'),
      queue:toggleAndRead(window.toggleMiniQueue, '#mini-queue-popover', '#mini-queue-popover')
    };
    var audioButton = document.getElementById('lf-audio-tool-btn');
    var audioPanel = document.getElementById('lf-audio-tool-panel');
    if (audioButton) audioButton.click();
    var audioTool = { present:!!audioButton, opened:!!(audioPanel && audioPanel.classList.contains('show')) };
    if (audioButton) audioButton.click();
    var sleepButton = document.getElementById('lf-sleep-timer-btn');
    var sleepRoot = document.getElementById('lf-sleep-timer');
    if (sleepButton) sleepButton.click();
    var sleepTimer = { present:!!sleepButton, opened:!!(sleepRoot && sleepRoot.classList.contains('open')) };
    if (sleepButton) sleepButton.click();
    var progress = document.getElementById('progress-bar');
    var time = document.getElementById('time-display');
    var cover = document.getElementById('control-cover');
    return {
      controls:controls, popovers:popovers, audioTool:audioTool, sleepTimer:sleepTimer,
      progress:{ present:!!progress, width:progress ? progress.getBoundingClientRect().width : 0, pointerEvents:progress ? getComputedStyle(progress).pointerEvents : '' },
      time:{ present:!!time, text:time ? time.textContent : '' }, coverPresent:!!cover,
      buttonCount:document.querySelectorAll('#controls button').length
    };
  });
  pass('all pre-task player controls and handlers remain present and enabled',
    result.controls.length === 13 && result.controls.every(function (item) {
      return item.present && item.handlerType === 'function' && !item.disabled && item.pointerEvents !== 'none';
    }), result.controls);
  pass('queue, volume and quality controls still open their original absolute popovers',
    ['quality', 'volume', 'queue'].every(function (key) {
      return result.popovers[key].opened && result.popovers[key].popupPosition === 'absolute';
    }), result.popovers);
  pass('added audio tools and sleep timer remain available and interactive',
    result.audioTool.present && result.audioTool.opened && result.sleepTimer.present && result.sleepTimer.opened,
    { audioTool:result.audioTool, sleepTimer:result.sleepTimer, buttonCount:result.buttonCount });
  pass('progress, time display and cover remain in the player console',
    result.progress.present && result.progress.width > 600 && result.progress.pointerEvents !== 'none' &&
    result.time.present && result.coverPresent, result);
  return result;
}

async function targetSnapshot() {
  return cdp.call(function (requiredSingle, requiredGroups) {
    function styleValue(style, camel, kebab) { return style[camel] || style.getPropertyValue(kebab) || ''; }
    function alphaOf(value) {
      var match = /rgba?\([^,]+,[^,]+,[^,]+(?:,\s*([\d.]+))?\)/i.exec(String(value || ''));
      return match ? (match[1] == null ? 1 : Number(match[1])) : 0;
    }
    function describe(node, key) {
      var style = getComputedStyle(node);
      var before = getComputedStyle(node, '::before');
      var after = getComputedStyle(node, '::after');
      var rect = node.getBoundingClientRect();
      var descendants = Array.prototype.slice.call(node.querySelectorAll('*')).map(function (child) {
        if (child.closest('[data-lf-liquid-glass]') !== node) return '';
        var childStyle = getComputedStyle(child);
        return styleValue(childStyle, 'backdropFilter', 'backdrop-filter');
      }).filter(function (value) { return value && value !== 'none'; });
      var selfBlur = styleValue(style, 'backdropFilter', 'backdrop-filter');
      return {
        selector: key || (node.id ? ('#' + node.id) : ('.' + Array.prototype.slice.call(node.classList).join('.'))),
        baseSelector: node.id ? ('#' + node.id) : ('.' + Array.prototype.slice.call(node.classList).join('.')),
        id: node.id || '', classes: Array.prototype.slice.call(node.classList),
        marker: node.getAttribute('data-lf-liquid-glass') || '',
        rect: { x:rect.x, y:rect.y, width:rect.width, height:rect.height },
        layoutRect: { x:node.offsetLeft, y:node.offsetTop, width:node.offsetWidth, height:node.offsetHeight },
        display: style.display, visibility: style.visibility, pointerEvents: style.pointerEvents,
        backgroundColor: style.backgroundColor, backgroundAlpha: alphaOf(style.backgroundColor),
        backgroundImage: style.backgroundImage,
        backdropFilter: selfBlur,
        borderWidth: style.borderWidth, borderStyle: style.borderStyle, borderColor: style.borderColor,
        borderRadius: style.borderRadius, boxShadow: style.boxShadow,
        color: style.color, opacity: style.opacity,
        pointerX: style.getPropertyValue('--lf-liquid-pointer-x').trim(),
        pointerY: style.getPropertyValue('--lf-liquid-pointer-y').trim(),
        wallpaperMix: style.getPropertyValue('--lf-lg-wallpaper-rgb').trim(),
        transitionDuration: style.transitionDuration,
        animationName: style.animationName,
        before: {
          content: before.content, backgroundImage: before.backgroundImage,
          pointerEvents: before.pointerEvents, opacity: before.opacity,
          backdropFilter: styleValue(before, 'backdropFilter', 'backdrop-filter'),
          animationName: before.animationName, transitionDuration: before.transitionDuration,
        },
        after: {
          content: after.content, backgroundImage: after.backgroundImage,
          pointerEvents: after.pointerEvents, opacity: after.opacity,
          backdropFilter: styleValue(after, 'backdropFilter', 'backdrop-filter'),
          animationName: after.animationName, transitionDuration: after.transitionDuration,
        },
        blurLayerCount: (selfBlur && selfBlur !== 'none' ? 1 : 0) + descendants.length,
        descendantBlur: descendants,
      };
    }
    var required = {};
    requiredSingle.forEach(function (selector) {
      var node = document.querySelector(selector);
      required[selector] = node ? describe(node, selector) : null;
    });
    Object.keys(requiredGroups).forEach(function (selector) {
      required[selector] = Array.prototype.map.call(document.querySelectorAll(selector), function (node, index) {
        return describe(node, selector + '[' + index + ']');
      });
    });
    var marked = Array.prototype.map.call(document.querySelectorAll('[data-lf-liquid-glass]'), function (node, index) {
      return describe(node, '[data-lf-liquid-glass][' + index + ']');
    });
    var root = getComputedStyle(document.documentElement);
    var variables = {};
    [
      '--lf-lg-opacity', '--lf-lg-blur', '--lf-lg-saturate', '--lf-lg-border-alpha',
      '--lf-lg-radius', '--lf-lg-shadow', '--lf-lg-highlight-alpha',
      '--lf-lg-wallpaper-rgb', '--lf-lg-accent-rgb'
    ].forEach(function (name) { variables[name] = root.getPropertyValue(name).trim(); });
    return {
      required: required,
      markedCount: marked.length,
      marked: marked,
      variables: variables,
      debug: window.LumiFieldLiquidGlass.getDebug(),
    };
  }, [REQUIRED_SINGLE, REQUIRED_GROUPS]);
}

function flattenRequired(snapshot) {
  const out = [];
  Object.values(snapshot.required || {}).forEach(value => {
    if (Array.isArray(value)) out.push(...value);
    else if (value) out.push(value);
  });
  return out;
}

function isAuditVisible(target) {
  return target.display !== 'none' && target.visibility !== 'hidden' &&
    Number(target.opacity) >= 0.05 && target.rect.width > 0 && target.rect.height > 0;
}

async function verifyInventoryAndActiveGlass() {
  const snapshot = await targetSnapshot();
  const missing = REQUIRED_SINGLE.filter(selector => !snapshot.required[selector]);
  const badGroups = Object.entries(REQUIRED_GROUPS).filter(([selector, count]) =>
    !Array.isArray(snapshot.required[selector]) || snapshot.required[selector].length < count);
  pass('all required main-interface panels/cards and the secondary account block exist',
    missing.length === 0 && badGroups.length === 0,
    { missing, groups: Object.fromEntries(Object.entries(REQUIRED_GROUPS).map(([selector]) => [selector, (snapshot.required[selector] || []).length])) });
  const targets = flattenRequired(snapshot);
  pass('every audited panel uses the shared LiquidGlass marker',
    targets.length >= REQUIRED_SINGLE.length + Object.values(REQUIRED_GROUPS).reduce((sum, value) => sum + value, 0) &&
      targets.every(target => target.marker),
    targets.map(target => ({ selector:target.selector, marker:target.marker })));
  pass('shared runtime inventory covers all marked LiquidGlass targets without duplicate listeners',
    snapshot.markedCount >= targets.length &&
    Number(getPath(snapshot.debug, ['blurLayerCount']) || 0) <= 1 &&
    Number(getPath(snapshot.debug, ['listenerCount', 'listeners.total']) || 0) <= 4 &&
    Number(getPath(snapshot.debug, ['schedulerCount', 'rafCount', 'schedulers']) || 0) <= 1,
    { markedCount:snapshot.markedCount, debug:snapshot.debug });
  pass('all shared LiquidGlass variables are non-empty at runtime',
    Object.values(snapshot.variables).every(Boolean), snapshot.variables);

  const styled = targets.filter(isAuditVisible);
  const configuredBlur = parseFloat(snapshot.variables['--lf-lg-blur']) || 0;
  const hasActiveGlassFilter = target =>
    /saturate\(/i.test(target.backdropFilter) &&
    (numericBlur(target.backdropFilter) >= 6 || (/url\(/i.test(target.backdropFilter) && configuredBlur >= 6));
  pass('active LiquidGlass has real transmission, blur, saturation, fine edge, radius and shadow on every visible target',
    styled.every(target =>
      target.backgroundAlpha < 0.96 && target.backgroundImage !== 'none' &&
      hasActiveGlassFilter(target) &&
      parseFloat(target.borderWidth) > 0 && target.borderStyle !== 'none' &&
      parseFloat(target.borderRadius) >= 8 && target.boxShadow !== 'none'),
    styled.map(target => ({
      selector:target.selector, backgroundAlpha:target.backgroundAlpha, backgroundImage:target.backgroundImage,
      backdropFilter:target.backdropFilter, border:`${target.borderWidth} ${target.borderStyle} ${target.borderColor}`,
      radius:target.borderRadius, shadow:target.boxShadow,
    })));
  pass('dynamic refraction/highlight and edge layers are present and never intercept input',
    styled.every(target =>
      /(?:radial|conic)-gradient/i.test(target.backgroundImage + ' ' + target.before.backgroundImage + ' ' + target.after.backgroundImage) &&
      /linear-gradient/i.test(target.backgroundImage + ' ' + target.before.backgroundImage + ' ' + target.after.backgroundImage) &&
      target.before.pointerEvents === 'none' && target.after.pointerEvents === 'none' &&
      /inset/i.test(target.boxShadow)),
    styled.map(target => ({ selector:target.selector, before:target.before, after:target.after })));
  pass('each audited panel owns only one backdrop blur layer',
    styled.every(target => target.blurLayerCount === 1 && target.before.backdropFilter === 'none' && target.after.backdropFilter === 'none'),
    styled.map(target => ({ selector:target.selector, blurLayerCount:target.blurLayerCount, descendants:target.descendantBlur })));
  pass('visible LiquidGlass text remains readable and interactive',
    styled.filter(target => Number(target.opacity) >= 0.65).every(target =>
      target.pointerEvents !== 'none' && /rgba?\(/.test(target.color)),
    styled.map(target => ({ selector:target.selector, pointerEvents:target.pointerEvents, opacity:target.opacity, color:target.color })));
  return snapshot;
}

async function verifyPointerHighlight() {
  const result = await cdp.call(async function () {
    var target = document.querySelector('.home-card');
    var rect = target.getBoundingClientRect();
    function read() {
      var style = getComputedStyle(target);
      return {
        x:style.getPropertyValue('--lf-liquid-pointer-x').trim(),
        y:style.getPropertyValue('--lf-liquid-pointer-y').trim(),
        material:style.backgroundImage + '|' + getComputedStyle(target, '::before').backgroundImage,
        debug:window.LumiFieldLiquidGlass.getDebug()
      };
    }
    var first = read();
    target.dispatchEvent(new PointerEvent('pointermove', {
      bubbles:true, clientX:rect.left + rect.width * .18, clientY:rect.top + rect.height * .22, pointerType:'mouse'
    }));
    await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
    var second = read();
    target.dispatchEvent(new PointerEvent('pointermove', {
      bubbles:true, clientX:rect.left + rect.width * .82, clientY:rect.top + rect.height * .76, pointerType:'mouse'
    }));
    await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
    var third = read();
    return { first:first, second:second, third:third, rect:{ x:rect.x, y:rect.y, width:rect.width, height:rect.height } };
  });
  pass('pointer movement updates shared per-panel refraction/highlight coordinates in both axes',
    result.second.x !== result.third.x && result.second.y !== result.third.y &&
    /%|px/.test(result.third.x) && /%|px/.test(result.third.y) && result.second.material !== result.third.material,
    result);
  const pointer = getPath(result.third.debug, ['pointer', 'lastPointer']);
  pass('LiquidGlass debug reports the latest pointer target without creating per-panel loops',
    pointer && Number(getPath(result.third.debug, ['schedulerCount', 'rafCount', 'schedulers']) || 0) <= 1,
    result.third.debug);
}

async function verifyThemeInfluence() {
  const before = await cdp.call(function () {
    var target = document.querySelector('.home-card');
    return {
      background:getComputedStyle(target).backgroundImage,
      highlight:getComputedStyle(target, '::before').backgroundImage,
      variables:{
        accent:getComputedStyle(document.documentElement).getPropertyValue('--lf-lg-accent-rgb').trim(),
        wallpaper:getComputedStyle(document.documentElement).getPropertyValue('--lf-lg-wallpaper-rgb').trim()
      },
      rect:(function (r) { return { x:r.x, y:r.y, width:r.width, height:r.height }; })(target.getBoundingClientRect())
    };
  });
  await cdp.call(async function () {
    await window.LumiFieldLiquidGlass.setTestTheme({ accentRgb:'255, 72, 132', wallpaperRgb:'32, 54, 118', wallpaperLuma:.18 });
    await window.LumiFieldLiquidGlass.refresh('problem14-theme-a');
    return true;
  });
  const themeA = await cdp.call(function () {
    var target = document.querySelector('.home-card');
    return {
      background:getComputedStyle(target).backgroundImage,
      highlight:getComputedStyle(target, '::before').backgroundImage,
      variables:{
        accent:getComputedStyle(document.documentElement).getPropertyValue('--lf-lg-accent-rgb').trim(),
        wallpaper:getComputedStyle(document.documentElement).getPropertyValue('--lf-lg-wallpaper-rgb').trim()
      },
      debug:window.LumiFieldLiquidGlass.getDebug(),
      rect:(function (r) { return { x:r.x, y:r.y, width:r.width, height:r.height }; })(target.getBoundingClientRect())
    };
  });
  await cdp.call(async function () {
    await window.LumiFieldLiquidGlass.setTestTheme({ accentRgb:'48, 236, 178', wallpaperRgb:'134, 62, 22', wallpaperLuma:.72 });
    await window.LumiFieldLiquidGlass.refresh('problem14-theme-b');
    return true;
  });
  const themeB = await cdp.call(function () {
    var target = document.querySelector('.home-card');
    return {
      background:getComputedStyle(target).backgroundImage,
      highlight:getComputedStyle(target, '::before').backgroundImage,
      variables:{
        accent:getComputedStyle(document.documentElement).getPropertyValue('--lf-lg-accent-rgb').trim(),
        wallpaper:getComputedStyle(document.documentElement).getPropertyValue('--lf-lg-wallpaper-rgb').trim()
      },
      debug:window.LumiFieldLiquidGlass.getDebug(),
      rect:(function (r) { return { x:r.x, y:r.y, width:r.width, height:r.height }; })(target.getBoundingClientRect())
    };
  });
  pass('accent and wallpaper samples materially change glass transmission and dynamic highlight color',
    !deepEqual(themeA.variables, themeB.variables) && themeA.background !== themeB.background,
    { before, themeA, themeB });
  pass('theme-driven color changes never move or resize the panel',
    rectClose(before.rect, themeA.rect) && rectClose(themeA.rect, themeB.rect),
    { before:before.rect, themeA:themeA.rect, themeB:themeB.rect });
  await screenshot('liquid-glass-dynamic-wallpaper-theme');
}

async function setMode(mode) {
  return cdp.call(async function (next) {
    await window.LumiFieldLiquidGlass.setTestMode(next);
    await window.LumiFieldLiquidGlass.refresh('problem14-mode');
    return window.LumiFieldLiquidGlass.getDebug();
  }, [mode]);
}

async function verifyFallbackReducedAndEco(fullLayout) {
  const fallbackDebug = await setMode({ supported:false, reducedMotion:false, eco:false });
  const fallback = await targetSnapshot();
  const fallbackTargets = flattenRequired(fallback).filter(isAuditVisible);
  pass('unsupported backdrop-filter uses a consistent non-blur fallback with edge, radius and shadow',
    /fallback|unsupported|no-backdrop/i.test(String(getPath(fallbackDebug, ['activeMode', 'mode']) || '')) &&
    fallbackTargets.every(target =>
      target.backdropFilter === 'none' && target.backgroundImage !== 'none' &&
      parseFloat(target.borderWidth) > 0 && parseFloat(target.borderRadius) >= 8 && target.boxShadow !== 'none'),
    { debug:fallbackDebug, targets:fallbackTargets.map(target => ({ selector:target.selector, filter:target.backdropFilter, bg:target.backgroundImage })) });
  await screenshot('liquid-glass-fallback');

  const reducedDebug = await setMode({ supported:true, reducedMotion:true, eco:false });
  const reducedBefore = await targetSnapshot();
  const reducedPointer = await cdp.call(async function () {
    var target = document.querySelector('.home-card');
    var style = getComputedStyle(target);
    var before = [style.getPropertyValue('--lf-liquid-pointer-x'), style.getPropertyValue('--lf-liquid-pointer-y')];
    var rect = target.getBoundingClientRect();
    target.dispatchEvent(new PointerEvent('pointermove', { bubbles:true, clientX:rect.right - 5, clientY:rect.bottom - 5, pointerType:'mouse' }));
    await new Promise(function (resolve) { requestAnimationFrame(resolve); });
    style = getComputedStyle(target);
    return { before:before, after:[style.getPropertyValue('--lf-liquid-pointer-x'), style.getPropertyValue('--lf-liquid-pointer-y')] };
  });
  const reducedTargets = flattenRequired(reducedBefore).filter(isAuditVisible);
  pass('reduced-motion mode disables animated refraction while retaining readable glass',
    /reduced/i.test(String(getPath(reducedDebug, ['activeMode', 'mode']) || '')) &&
    deepEqual(reducedPointer.before, reducedPointer.after) &&
    reducedTargets.every(target => target.animationName === 'none' && target.transitionDuration.split(',').every(value => parseFloat(value) === 0)),
    { debug:reducedDebug, pointer:reducedPointer, targets:reducedTargets.map(target => ({ selector:target.selector, before:target.before, after:target.after })) });

  const ecoDebug = await setMode({ supported:true, reducedMotion:false, eco:true });
  const eco = await targetSnapshot();
  const ecoTargets = flattenRequired(eco).filter(isAuditVisible);
  const ecoBlur = parseFloat(eco.variables['--lf-lg-blur']) || 0;
  pass('eco mode keeps one lightweight blur layer and lowers blur cost without losing the material',
    /eco|low/i.test(String(getPath(ecoDebug, ['activeMode', 'mode']) || '')) &&
    ecoBlur >= 4 && ecoBlur <= 16 &&
    ecoTargets.every(target => target.blurLayerCount === 1 &&
      /saturate\(/i.test(target.backdropFilter) &&
      (numericBlur(target.backdropFilter) >= 4 || /url\(/i.test(target.backdropFilter))),
    { debug:ecoDebug, targets:ecoTargets.map(target => ({ selector:target.selector, filter:target.backdropFilter, layers:target.blurLayerCount })) });

  await setMode(FULL_MODE);
  const restored = await targetSnapshot();
  const beforeRects = Object.fromEntries(flattenRequired(fullLayout).map(target => [target.selector, target.layoutRect]));
  const restoredRects = Object.fromEntries(flattenRequired(restored).map(target => [target.selector, target.layoutRect]));
  pass('fallback, reduced-motion and eco switching preserve every audited layout rectangle',
    Object.keys(beforeRects).every(key => restoredRects[key] && rectClose(beforeRects[key], restoredRects[key])),
    { before:beforeRects, restored:restoredRects });
}

async function verifyHitTestingClicksAndScroll() {
  const hit = await cdp.call(function () {
    document.body.classList.remove('lf-auth-locked');
    ['lf-auth-root', 'lf-profile-modal', 'lf-account-manager-modal', 'lf-legal-modal'].forEach(function (id) {
      var overlay = document.getElementById(id);
      if (overlay) overlay.classList.remove('show', 'is-open');
    });
    var target = document.querySelector('.home-card');
    var rect = target.getBoundingClientRect();
    window.__lfP14ClickCount = 0;
    window.__lfP14ClickHandler = function (event) {
      window.__lfP14ClickCount += 1;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    target.addEventListener('click', window.__lfP14ClickHandler, true);
    var at = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      x:rect.left + rect.width / 2, y:rect.top + rect.height / 2,
      targetTag:at && at.tagName, inside:!!(at && (at === target || target.contains(at))),
      beforePointerEvents:getComputedStyle(target, '::before').pointerEvents,
      afterPointerEvents:getComputedStyle(target, '::after').pointerEvents,
    };
  });
  pass('LiquidGlass pseudo layers leave the visible card as the actual hit-test target',
    hit.inside && hit.beforePointerEvents === 'none' && hit.afterPointerEvents === 'none', hit);
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:hit.x, y:hit.y });
  await cdp.send('Input.dispatchMouseEvent', { type:'mousePressed', x:hit.x, y:hit.y, button:'left', clickCount:1 });
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseReleased', x:hit.x, y:hit.y, button:'left', clickCount:1 });
  const clicked = await cdp.call(function () {
    var target = document.querySelector('.home-card');
    var count = window.__lfP14ClickCount;
    target.removeEventListener('click', window.__lfP14ClickHandler, true);
    delete window.__lfP14ClickHandler;
    return count;
  });
  pass('real CDP mouse click reaches the original card through LiquidGlass', clicked === 1, { clickCount:clicked });

  const panel = await cdp.call(function () {
    if (typeof toggleFxPanel === 'function') toggleFxPanel(true);
    var node = document.getElementById('fx-panel');
    node.scrollTop = 0;
    var rect = node.getBoundingClientRect();
    return {
      x:Math.min(innerWidth - 30, Math.max(30, rect.left + rect.width / 2)),
      y:Math.min(innerHeight - 90, Math.max(90, rect.top + Math.min(rect.height, innerHeight - rect.top) / 2)),
      before:node.scrollTop, scrollHeight:node.scrollHeight, clientHeight:node.clientHeight,
      pointerEvents:getComputedStyle(node).pointerEvents,
    };
  });
  pass('glass visual console remains a real scroll container',
    panel.scrollHeight > panel.clientHeight && panel.pointerEvents !== 'none', panel);
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:panel.x, y:panel.y });
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseWheel', x:panel.x, y:panel.y, deltaX:0, deltaY:520 });
  await delay(300);
  const scrolled = await cdp.call(function () { return document.getElementById('fx-panel').scrollTop; });
  pass('real wheel input scrolls the glass panel', scrolled > panel.before, { before:panel.before, after:scrolled });
  await cdp.call(function () { if (typeof toggleFxPanel === 'function') toggleFxPanel(false); return true; });
}

async function verifyAccountTextAndPermissionSurface() {
  const user = await cdp.call(async function () {
    var api = window.LumiFieldLiquidGlass;
    await api.setTestRole('user');
    var button = document.getElementById('lf-account-button');
    return {
      text:button.textContent.trim(), title:button.title, disabled:button.disabled, type:button.type,
      onclick:typeof button.onclick, classes:Array.prototype.slice.call(button.classList),
      marker:button.hasAttribute('data-lf-liquid-glass'), debug:api.getDebug()
    };
  });
  pass('ordinary LF user account block still says exactly “我的” and remains enabled',
    user.text === '我的' && user.disabled === false && user.type === 'button' && user.onclick === 'function' && user.marker,
    user);
  const admin = await cdp.call(async function () {
    var api = window.LumiFieldLiquidGlass;
    await api.setTestRole('admin');
    var button = document.getElementById('lf-account-button');
    return {
      text:button.textContent.trim(), title:button.title, disabled:button.disabled, type:button.type,
      onclick:typeof button.onclick, classes:Array.prototype.slice.call(button.classList),
      marker:button.hasAttribute('data-lf-liquid-glass'), debug:api.getDebug()
    };
  });
  pass('administrator account block preserves the original administrator text and admin permission state',
    admin.text === '我的 · LumiField 管理员' && admin.disabled === false && admin.type === 'button' &&
    admin.onclick === 'function' && admin.marker && /admin/i.test(String(getPath(admin.debug, ['testRoleApplied', 'accountRole', 'role', 'account.role']) || '')),
    admin);
  pass('LiquidGlass changes only account material, not handler/type/classes or permissions',
    user.type === admin.type && user.onclick === admin.onclick && deepEqual(user.classes, admin.classes) &&
    /normal|user/i.test(String(getPath(user.debug, ['testRoleApplied', 'accountRole', 'role', 'account.role']) || '')),
    { user, admin });
  await screenshot('liquid-glass-admin-account-block');
  await cdp.call(async function () { await window.LumiFieldLiquidGlass.setTestRole('user'); return true; });
}

async function runPerformanceWindow() {
  return cdp.call(function (durationMs) {
    return new Promise(function (resolve) {
      var api = window.LumiFieldLiquidGlass;
      var target = document.querySelector('.home-card');
      var rect = target.getBoundingClientRect();
      var start = performance.now();
      var last = 0;
      var frames = [];
      var longTasks = [];
      var heapStart = performance.memory && performance.memory.usedJSHeapSize || 0;
      var heapPeak = heapStart;
      var pointerCount = 0;
      var themeCount = 0;
      var observer = null;
      var lifecycleEvents = [];
      var throttleGaps = [];
      function recordLifecycle(type, now) {
        lifecycleEvents.push({
          type:type,
          at:Math.max(0, (now == null ? performance.now() : now) - start),
          hidden:document.hidden,
          visibilityState:document.visibilityState,
          focused:document.hasFocus()
        });
      }
      var onVisibility = function () { recordLifecycle('visibilitychange'); };
      var onFocus = function () { recordLifecycle('focus'); };
      var onBlur = function () { recordLifecycle('blur'); };
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('focus', onFocus);
      window.addEventListener('blur', onBlur);
      recordLifecycle('start', start);
      try {
        observer = new PerformanceObserver(function (list) {
          list.getEntries().forEach(function (entry) { longTasks.push(entry.duration); });
        });
        observer.observe({ entryTypes:['longtask'] });
      } catch (_) {}
      var heapTimer = setInterval(function () {
        if (performance.memory) heapPeak = Math.max(heapPeak, performance.memory.usedJSHeapSize || 0);
      }, 500);
      var pointerTimer = setInterval(function () {
        var age = performance.now() - start;
        var phase = age / 1000;
        var x = rect.left + rect.width * (.5 + Math.sin(phase * 1.7) * .43);
        var y = rect.top + rect.height * (.5 + Math.cos(phase * 1.3) * .41);
        target.dispatchEvent(new PointerEvent('pointermove', { bubbles:true, clientX:x, clientY:y, pointerType:'mouse' }));
        pointerCount += 1;
      }, 33);
      var themeTimer = setInterval(function () {
        var even = themeCount % 2 === 0;
        api.setTestTheme(even
          ? { accentRgb:'255, 92, 142', wallpaperRgb:'28, 48, 116', wallpaperLuma:.22 }
          : { accentRgb:'55, 230, 178', wallpaperRgb:'126, 60, 28', wallpaperLuma:.70 });
        themeCount += 1;
      }, 2500);
      function finish(now) {
        clearInterval(pointerTimer);
        clearInterval(themeTimer);
        clearInterval(heapTimer);
        if (observer) observer.disconnect();
        recordLifecycle('finish', now);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('blur', onBlur);
        var elapsed = now - start;
        var sorted = frames.slice().sort(function (a,b) { return a-b; });
        var percentile = function (p) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0; };
        var heapEnd = performance.memory && performance.memory.usedJSHeapSize || 0;
        resolve({
          elapsed:elapsed,
          frames:frames.length,
          fps:frames.length / Math.max(.001, elapsed / 1000),
          p95:percentile(.95), p99:percentile(.99), maxFrame:sorted[sorted.length - 1] || 0,
          longFrames:frames.filter(function (value) { return value > 50; }).length,
          severeFrames:frames.filter(function (value) { return value > 100; }).length,
          longFrameRatio:frames.filter(function (value) { return value > 50; }).length / Math.max(1, frames.length),
          longTasks:longTasks.length,
          longTaskTotal:longTasks.reduce(function (sum, value) { return sum + value; }, 0),
          longestTask:longTasks.length ? Math.max.apply(Math, longTasks) : 0,
          heapStart:heapStart, heapEnd:heapEnd, heapPeak:heapPeak,
          heapGrowth:heapEnd - heapStart, heapPeakGrowth:heapPeak - heapStart,
          pointerCount:pointerCount, themeCount:themeCount,
          lifecycleEvents:lifecycleEvents,
          throttleGaps:throttleGaps,
          debug:api.getDebug()
        });
      }
      function frame(now) {
        if (last && now - start > 1000) {
          var delta = now - last;
          frames.push(delta);
          if (delta >= 250) {
            throttleGaps.push({
              at:now - start,
              delta:delta,
              hidden:document.hidden,
              visibilityState:document.visibilityState,
              focused:document.hasFocus()
            });
          }
        }
        last = now;
        if (now - start >= durationMs) finish(now);
        else requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }, [performanceMs], Math.max(90000, performanceMs + 30000));
}

async function verifySixtySecondPerformance() {
  const nativeFocus = focusAppWindow();
  await cdp.send('Page.bringToFront');
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const rendererFocus = await waitFor(() => cdp.call(function () {
    return !document.hidden && document.visibilityState === 'visible' && document.hasFocus()
      ? { hidden:document.hidden, visibilityState:document.visibilityState, focused:document.hasFocus() }
      : null;
  }), 12000, 150);
  pass(performanceFocusCheckName,
    nativeFocus && nativeFocus.handle !== 0 && nativeFocus.foregroundPid === nativeFocus.targetPid && rendererFocus.focused,
    { nativeFocus, rendererFocus });
  const metrics = await runPerformanceWindow();
  const durationScale = performanceMs / 60000;
  const minimumElapsed = Math.max(500, performanceMs - 500);
  const minimumPointers = Math.max(1, Math.floor(1500 * durationScale));
  const minimumThemes = Math.max(0, Math.floor(20 * durationScale));
  pass(performanceCompleteCheckName,
    metrics.elapsed >= minimumElapsed && metrics.pointerCount >= minimumPointers && metrics.themeCount >= minimumThemes,
    Object.assign({ requestedMs:performanceMs, minimumElapsed, minimumPointers, minimumThemes }, metrics));
  pass('LiquidGlass sustains interactive frame pacing without systemic long frames',
    metrics.fps >= 55 && metrics.p95 <= 34.5 && metrics.longFrameRatio <= .02 && metrics.severeFrames <= 24,
    metrics);
  pass('LiquidGlass creates no long-task storm during pointer and wallpaper changes',
    metrics.longTasks <= 16 && metrics.longTaskTotal <= 900 && metrics.longestTask <= 180,
    metrics);
  pass('LiquidGlass memory remains bounded for the 60-second interaction run',
    metrics.heapGrowth <= 32 * 1024 * 1024 && metrics.heapPeakGrowth <= 64 * 1024 * 1024,
    metrics);
  pass('performance run retains one shared scheduler/listener set',
    Number(getPath(metrics.debug, ['schedulerCount', 'rafCount', 'schedulers']) || 0) <= 1 &&
    Number(getPath(metrics.debug, ['listenerCount', 'listeners.total']) || 0) <= 4,
    metrics.debug);
  return metrics;
}

async function run() {
  verifyStaticLiquidGlassContract();
  await startApp();
  const initialDebug = await prepareSurface();
  pass('LiquidGlass real Electron controller starts in full supported mode',
    /full|active|supported/i.test(String(getPath(initialDebug, ['activeMode', 'mode']) || '')),
    initialDebug);
  const playerConsole = await verifyPlayerConsoleBaselineAppearance();
  const playerControls = await verifyPlayerControlInventoryAndPopovers();
  if (playerOnly) {
    pass('real Electron renderer has zero uncaught exceptions', rendererErrors.length === 0, rendererErrors);
    const quickResult = {
      ok:true, problem:14, mode:requestedExe ? 'installed player console regression' : 'source player console regression',
      runId, origin, evidenceDir, checks, screenshots, playerConsole, playerControls, rendererErrors,
      appLogTail:appLog.join('').slice(-16000), completedAt:new Date().toISOString()
    };
    const quickResultFile = path.join(evidenceDir, 'result.json');
    fs.writeFileSync(quickResultFile, `${JSON.stringify(quickResult, null, 2)}\n`);
    console.log(JSON.stringify({ ok:true, problem:14, playerOnly:true, resultFile:quickResultFile,
      checks:Object.keys(checks).length, rendererErrors:rendererErrors.length }, null, 2));
    return;
  }
  const fullLayout = await verifyInventoryAndActiveGlass();
  await verifyPointerHighlight();
  await verifyThemeInfluence();
  await verifyFallbackReducedAndEco(fullLayout);
  await verifyHitTestingClicksAndScroll();
  await verifyAccountTextAndPermissionSurface();
  const performance = await verifySixtySecondPerformance();
  pass('real Electron renderer has zero uncaught exceptions', rendererErrors.length === 0, rendererErrors);

  const result = {
    ok:true,
    problem:14,
    mode:'real Electron/CDP shared LiquidGlass material, input, role, fallback and 60-second performance audit',
    runId,
    origin,
    evidenceDir,
    checks,
    screenshots,
    playerConsole,
    playerControls,
    performance,
    rendererErrors,
    appLogTail:appLog.join('').slice(-16000),
    completedAt:new Date().toISOString(),
  };
  const resultFile = path.join(evidenceDir, 'result.json');
  fs.writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({
    ok:true, problem:14, resultFile, checks:Object.keys(checks).length,
    screenshots:screenshots.length, fps:Number(performance.fps.toFixed(2)), rendererErrors:rendererErrors.length,
  }, null, 2));
}

run().catch(error => {
  const failure = {
    ok:false,
    problem:14,
    runId,
    origin,
    evidenceDir,
    error:String(error && error.stack || error).slice(0, 16000),
    checkSummary:{ passed:Object.keys(checks).length, names:Object.keys(checks) },
    focusEvidence:checks[performanceFocusCheckName] || null,
    screenshots,
    rendererErrors,
    appLogTail:appLog.join('').slice(-16000),
    completedAt:new Date().toISOString(),
  };
  try { fs.writeFileSync(path.join(evidenceDir, 'failure.json'), `${JSON.stringify(failure, null, 2)}\n`); } catch (_) {}
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
}).finally(async () => {
  await stopApp();
  try { fs.rmSync(userData, { recursive:true, force:true }); } catch (_) {}
});
