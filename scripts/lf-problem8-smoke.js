'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const electron = require('electron');
const installedArg = process.argv.find(value => value.startsWith('--installed-exe='));
const installedExecutable = String(process.env.LF_PROBLEM8_EXECUTABLE || (installedArg ? installedArg.slice('--installed-exe='.length) : '')).trim();
const launchExecutable = installedExecutable ? path.resolve(installedExecutable) : electron;
const launchMode = installedExecutable ? 'installed' : 'source';
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.resolve(process.env.LF_PROBLEM8_OUT || path.join(repo, 'test-results', 'lf-problem8-smoke', runId));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-problem8-'));
const checks = {};
const viewports = [];
const screenshots = [];
const rendererErrors = [];
const appLog = [];
let app = null;
let cdp = null;

fs.mkdirSync(evidenceDir, { recursive: true });

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function pass(name, condition, details) {
  assert.ok(condition, `${name}${details == null ? '' : `: ${JSON.stringify(details)}`}`);
  checks[name] = details == null ? true : details;
  return details;
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

async function waitFor(fn, timeout = 45000, interval = 100) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (_) {}
    await delay(interval);
  }
  throw new Error(`Timed out after ${timeout} ms: ${JSON.stringify(last)}`);
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
        rendererErrors.push(String(detail.exception && detail.exception.description || detail.text || 'Renderer exception').slice(0, 3000));
      }
    };
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
    await this.send('DOM.enable');
    await this.send('Page.bringToFront');
    await this.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  }

  send(method, params = {}, timeout = 60000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
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
    return this.evaluate(`(${fn.toString()}).apply(null,${JSON.stringify(args)})`);
  }

  close() {
    try { this.ws.close(); } catch (_) {}
  }
}

function focusAppWindow() {
  const script = [
    "Add-Type -Name Win32 -Namespace LF -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow); [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd);'",
    '$p=Get-Process -Id ' + Number(app && app.pid || 0) + ' -ErrorAction SilentlyContinue',
    'if($p -and $p.MainWindowHandle -ne 0){[LF.Win32]::ShowWindowAsync($p.MainWindowHandle,9)|Out-Null; [LF.Win32]::SetForegroundWindow($p.MainWindowHandle)|Out-Null}'
  ].join('; ');
  spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, encoding: 'utf8', timeout: 12000 });
}

function staticAudit() {
  const fixes = fs.readFileSync(path.join(repo, 'public', 'lumifield-fixes-v2.js'), 'utf8');
  const css = fs.readFileSync(path.join(repo, 'public', 'lumifield-fixes-v2.css'), 'utf8');
  const index = fs.readFileSync(path.join(repo, 'public', 'index.html'), 'utf8');
  const allJs = `${index}\n${fixes}`;
  pass('stable playlist close control is shipped',
    /lf-playlist-close/.test(allJs) &&
    /aria-label/.test(allJs) &&
    /type\s*=\s*['"]button['"]|\.type\s*=\s*['"]button['"]/.test(allJs));
  pass('playlist close implementation has keyboard path',
    /(?:event|e)\.(?:key|code)[^\r\n;]{0,48}['"]Escape['"]|['"]Escape['"][^\r\n;]{0,48}(?:event|e)\.(?:key|code)/.test(allJs) &&
    /playlist-panel|lf-playlist-close/.test(allJs));
  pass('playlist close has viewport-pinned positioning CSS',
    /lf-panel-x/.test(css) &&
    /position\s*:\s*(?:sticky|fixed|absolute)/.test(css) &&
    /z-index\s*:/.test(css));
  return {
    indexBytes: Buffer.byteLength(index),
    fixesBytes: Buffer.byteLength(fixes),
    cssBytes: Buffer.byteLength(css),
  };
}

async function findMainTarget(port) {
  return waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json();
    return targets.find(target =>
      target.type === 'page' &&
      /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//.test(target.url));
  }, 50000, 160);
}

async function startApp() {
  const port = await freePort();
  const args = [
    `--user-data-dir=${userData}`,
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    '--window-size=1360,860',
  ];
  if (launchMode === 'source') args.unshift('.');
  app = spawn(launchExecutable, args, {
    cwd: repo,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, {
      LUMIFIELD_SKIP_SPLASH: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      LF_ALLOW_PACKAGED_CDP_TEST: '1',
    }),
  });
  const collect = data => appLog.push(String(data));
  app.stdout.on('data', collect);
  app.stderr.on('data', collect);
  const target = await findMainTarget(port);
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  focusAppWindow();
  await cdp.send('Page.bringToFront');
  await waitFor(() => cdp.call(function () {
    return document.readyState === 'complete' &&
      typeof window.renderQueuePanel === 'function' &&
      typeof window.togglePlaylistPanel === 'function' &&
      document.getElementById('playlist-panel') &&
      document.getElementById('lf-playlist-close');
  }), 60000, 160);
}

async function setViewport(width, height, deviceScaleFactor) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor,
    mobile: false,
    screenWidth: width,
    screenHeight: height,
    screenOrientation: { type: 'landscapePrimary', angle: 0 },
  });
  await waitFor(() => cdp.call(function (size) {
    return innerWidth === size.width && innerHeight === size.height;
  }, [{ width, height }]), 10000, 80);
}

async function loadLongQueue() {
  return cdp.call(function () {
    window.startupLoginGuideShown = true;
    window.loginGuideAnimating = false;
    window.showLoginModal = function () { return false; };
    window.openProviderLogin = function () { return false; };
    if (typeof window.closeLoginModal === 'function') {
      try { window.closeLoginModal(); } catch (_) {}
    }
    document.querySelectorAll('.modal-mask.show,.modal-mask.open,.modal-mask.active').forEach(function (modal) {
      modal.classList.remove('show', 'open', 'active');
      modal.setAttribute('aria-hidden', 'true');
      modal.style.pointerEvents = 'none';
    });
    const authRoot = document.getElementById('lf-auth-root');
    if (authRoot) {
      authRoot.classList.remove('show', 'open', 'active');
      authRoot.hidden = true;
      authRoot.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('modal-open', 'lf-auth-locked');
    window.playQueue = Array.from({ length: 72 }, function (_, index) {
      return {
        id: `problem8-${index + 1}`,
        provider: 'local',
        name: `Problem 8 long playlist track ${String(index + 1).padStart(2, '0')}`,
        artist: `LumiField QA ${index + 1}`,
        cover: '',
      };
    });
    window.currentIdx = 0;
    window.queueViewTab = 'queue';
    if (typeof window.setPlaylistPanelPinned === 'function') {
      try { window.setPlaylistPanelPinned(false, true); } catch (_) {}
    }
    window.renderQueuePanel();
    if (typeof window.switchPlaylistTab === 'function') window.switchPlaylistTab('queue');
    const panel = document.getElementById('playlist-panel');
    const close = document.getElementById('lf-playlist-close');
    window.__lfProblem8CloseEvents = [];
    ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach(function (type) {
      close.addEventListener(type, function (event) {
        window.__lfProblem8CloseEvents.push({
          type:type,
          trusted:event.isTrusted,
          x:event.clientX,
          y:event.clientY,
          classes:panel.className,
        });
      }, true);
    });
    panel.classList.remove('peek', 'pinned');
    window.togglePlaylistPanel(true);
    panel.classList.add('show');
    return {
      count: document.querySelectorAll('#queue-list .queue-item').length,
      closeCount: panel.querySelectorAll('#lf-playlist-close').length,
      blockingModals: Array.from(document.querySelectorAll('.modal-mask')).filter(function (modal) {
        const style = getComputedStyle(modal);
        return style.display !== 'none' && style.visibility !== 'hidden' &&
          style.pointerEvents !== 'none' && Number(style.opacity) > 0.1;
      }).map(function (modal) { return modal.id || modal.className; }),
      authBlocked: !!(authRoot && !authRoot.hidden && getComputedStyle(authRoot).pointerEvents !== 'none'),
    };
  });
}

async function openPanel() {
  return cdp.call(function () {
    const panel = document.getElementById('playlist-panel');
    if (typeof window.setPlaylistPanelPinned === 'function') {
      try { window.setPlaylistPanelPinned(false, true); } catch (_) {}
    }
    panel.classList.remove('peek', 'pinned');
    window.togglePlaylistPanel(true);
    panel.classList.add('show');
    return true;
  });
}

async function panelIsClosed() {
  return cdp.call(function () {
    const panel = document.getElementById('playlist-panel');
    const style = getComputedStyle(panel);
    return !panel.classList.contains('show') &&
      !panel.classList.contains('peek') &&
      !panel.classList.contains('pinned') &&
      (style.pointerEvents === 'none' || Number(style.opacity) < 0.1 || panel.getBoundingClientRect().right <= 1);
  });
}

async function measureAt(position) {
  return cdp.call(async function (where) {
    const panel = document.getElementById('playlist-panel');
    const close = document.getElementById('lf-playlist-close');
    const list = document.getElementById('queue-list');
    const candidates = [panel].concat(Array.from(panel.querySelectorAll('*'))).filter(function (node) {
      if (!(node instanceof HTMLElement) || !node.contains(list)) return false;
      const style = getComputedStyle(node);
      const scrollableStyle = /(auto|scroll|overlay)/.test(`${style.overflowY} ${style.overflow}`);
      return node.scrollHeight > node.clientHeight + 20 && (scrollableStyle || node === panel);
    });
    candidates.sort(function (a, b) {
      const aExplicit = a.hasAttribute('data-lf-playlist-scroll') || /scroll|body|content/.test(a.className || '') ? 1 : 0;
      const bExplicit = b.hasAttribute('data-lf-playlist-scroll') || /scroll|body|content/.test(b.className || '') ? 1 : 0;
      if (aExplicit !== bExplicit) return bExplicit - aExplicit;
      return (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight);
    });
    const scroller = candidates[0] || panel;
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTop = where === 'bottom' ? maxScroll : (where === 'middle' ? maxScroll / 2 : 0);
    await new Promise(resolve => requestAnimationFrame(function () {
      requestAnimationFrame(resolve);
    }));
    const buttonRect = close.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const firstRect = list.querySelector('.queue-item') && list.querySelector('.queue-item').getBoundingClientRect();
    const style = getComputedStyle(close);
    const centerX = buttonRect.left + buttonRect.width / 2;
    const centerY = buttonRect.top + buttonRect.height / 2;
    const hit = document.elementFromPoint(centerX, centerY);
    const verticalScrollWidth = Math.max(0, scroller.offsetWidth - scroller.clientWidth -
      (parseFloat(getComputedStyle(scroller).borderLeftWidth) || 0) -
      (parseFloat(getComputedStyle(scroller).borderRightWidth) || 0));
    const scrollTrackLeft = scrollerRect.left + scroller.clientLeft + scroller.clientWidth;
    const verticalOverlap = buttonRect.bottom > scrollerRect.top && buttonRect.top < scrollerRect.bottom;
    const overlapsFirst = !!firstRect &&
      buttonRect.left < firstRect.right &&
      buttonRect.right > firstRect.left &&
      buttonRect.top < firstRect.bottom &&
      buttonRect.bottom > firstRect.top;
    return {
      where,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      scroller: {
        id: scroller.id || '',
        className: String(scroller.className || ''),
        scrollTop: scroller.scrollTop,
        maxScroll,
        verticalScrollWidth,
        scrollTrackLeft,
      },
      button: {
        left: buttonRect.left,
        top: buttonRect.top,
        right: buttonRect.right,
        bottom: buttonRect.bottom,
        width: buttonRect.width,
        height: buttonRect.height,
        centerX,
        centerY,
        display: style.display,
        visibility: style.visibility,
        opacity: Number(style.opacity),
        position: style.position,
        zIndex: style.zIndex,
        hit: !!(hit && hit.closest && hit.closest('#lf-playlist-close')),
        hitElement: hit ? {
          id: hit.id || '',
          className: String(hit.className || ''),
          tagName: hit.tagName || '',
        } : null,
      },
      panel: {
        left: panelRect.left,
        top: panelRect.top,
        right: panelRect.right,
        bottom: panelRect.bottom,
      },
      first: firstRect ? {
        left: firstRect.left,
        top: firstRect.top,
        right: firstRect.right,
        bottom: firstRect.bottom,
      } : null,
      overlapsFirst,
      overlapsScrollbar: verticalScrollWidth > 0 && verticalOverlap && buttonRect.right > scrollTrackLeft - 2,
      closeCount: panel.querySelectorAll('#lf-playlist-close').length,
      ariaLabel: close.getAttribute('aria-label') || '',
      tabIndex: close.tabIndex,
    };
  }, [position]);
}

async function screenshot(name) {
  const response = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const file = path.join(evidenceDir, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(response.data, 'base64'));
  screenshots.push(file);
  return file;
}

function validateGeometry(label, samples) {
  const top = samples[0];
  pass(`${label}: long list is genuinely scrollable`, top.scroller.maxScroll > 600, top.scroller);
  for (const sample of samples) {
    const b = sample.button;
    pass(`${label}/${sample.where}: X is visible in viewport`,
      b.width >= 24 && b.height >= 24 &&
      b.left >= 0 && b.top >= 0 &&
      b.right <= sample.viewport.width && b.bottom <= sample.viewport.height &&
      b.display !== 'none' && b.visibility !== 'hidden' && b.opacity >= 0.9,
      sample);
    pass(`${label}/${sample.where}: X remains at panel upper-right`,
      b.left >= sample.panel.left &&
      b.right <= sample.panel.right + 0.5 &&
      b.top >= sample.panel.top &&
      b.top <= sample.panel.top + 72,
      sample);
    pass(`${label}/${sample.where}: X is topmost and clickable`, b.hit, sample);
    pass(`${label}/${sample.where}: X does not cover scrollbar`, !sample.overlapsScrollbar, sample);
    pass(`${label}/${sample.where}: one close control only`, sample.closeCount === 1, sample);
    pass(`${label}/${sample.where}: X is keyboard accessible`,
      sample.tabIndex >= 0 && sample.ariaLabel.trim().length > 0,
      sample);
  }
  pass(`${label}: X screen coordinates are stable through top/middle/bottom scroll`,
    samples.every(sample =>
      Math.abs(sample.button.left - top.button.left) <= 1 &&
      Math.abs(sample.button.top - top.button.top) <= 1 &&
      Math.abs(sample.button.width - top.button.width) <= 0.5 &&
      Math.abs(sample.button.height - top.button.height) <= 0.5),
    samples.map(sample => ({ where: sample.where, button: sample.button, scrollTop: sample.scroller.scrollTop })));
  pass(`${label}: middle and bottom positions were reached`,
    samples[1].scroller.scrollTop > top.scroller.scrollTop + 100 &&
    samples[2].scroller.scrollTop > samples[1].scroller.scrollTop + 100,
    samples.map(sample => ({ where: sample.where, scroller: sample.scroller })));
  pass(`${label}: X does not cover first track at top`, !top.overlapsFirst, top);
}

async function exerciseViewport(spec, captureAll) {
  await setViewport(spec.width, spec.height, spec.dpr);
  const fixture = await loadLongQueue();
  pass(`${spec.name}: 72-track queue rendered`, fixture.count === 72, fixture);
  pass(`${spec.name}: close button is not duplicated`, fixture.closeCount === 1, fixture);
  pass(`${spec.name}: no unrelated modal blocks playlist interaction`,
    fixture.blockingModals.length === 0 && !fixture.authBlocked,
    fixture);
  await delay(700);
  const samples = [];
  for (const position of ['top', 'middle', 'bottom']) {
    const sample = await measureAt(position);
    samples.push(sample);
    if (captureAll || position === 'bottom') await screenshot(`${spec.name}-${position}`);
  }
  validateGeometry(spec.name, samples);
  viewports.push({ spec, samples });
  return samples;
}

async function mouseClick(x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

async function pressEscape() {
  const params = {
    key: 'Escape',
    code: 'Escape',
    text: '',
    unmodifiedText: '',
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  };
  await cdp.send('Input.dispatchKeyEvent', Object.assign({ type: 'rawKeyDown' }, params));
  await cdp.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, params));
}

async function testMouseClose() {
  await openPanel();
  await delay(650);
  const bottom = await measureAt('bottom');
  await mouseClick(bottom.button.centerX, bottom.button.centerY);
  let closed = false;
  try { closed = !!(await waitFor(panelIsClosed, 5000, 80)); } catch (_) {}
  const clickDiagnostic = await cdp.call(function () {
    const panel = document.getElementById('playlist-panel');
    return {
      closed:!panel.classList.contains('show') && !panel.classList.contains('peek') && !panel.classList.contains('pinned'),
      classes:panel.className,
      events:(window.__lfProblem8CloseEvents || []).slice(),
      pinned:typeof playlistPanelPinned === 'undefined' ? null : playlistPanelPinned,
      elementAtButton:(function () {
        const button = document.getElementById('lf-playlist-close');
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return hit ? { id:hit.id || '', className:String(hit.className || ''), tagName:hit.tagName || '' } : null;
      })(),
    };
  });
  pass('real mouse dispatch reaches and closes the playlist button', closed && clickDiagnostic.closed, clickDiagnostic);
  const state = await cdp.call(function () {
    return {
      queueCount: window.playQueue.length,
      rows: document.querySelectorAll('#queue-list .queue-item').length,
    };
  });
  pass('real mouse click closes the scrolled current panel without destroying queue',
    state.queueCount === 72 && state.rows === 72,
    state);
}

async function testEscapeClose() {
  await openPanel();
  await delay(650);
  await measureAt('middle');
  await pressEscape();
  await waitFor(panelIsClosed, 5000, 80);
  pass('Escape closes the current playlist panel', true);
}

async function testOnlyCurrentPanelCloses() {
  await openPanel();
  await delay(650);
  const before = await cdp.call(function () {
    let decoy = document.getElementById('lf-problem8-decoy-panel');
    if (!decoy) {
      decoy = document.createElement('section');
      decoy.id = 'lf-problem8-decoy-panel';
      decoy.className = 'show';
      decoy.setAttribute('data-playlist-context', 'other');
      decoy.textContent = 'Other playlist context';
      document.body.appendChild(decoy);
    }
    decoy.classList.add('show');
    return {
      decoyConnected: decoy.isConnected,
      decoyShow: decoy.classList.contains('show'),
    };
  });
  const top = await measureAt('top');
  await mouseClick(top.button.centerX, top.button.centerY);
  await waitFor(panelIsClosed, 5000, 80);
  const after = await cdp.call(function () {
    const decoy = document.getElementById('lf-problem8-decoy-panel');
    return {
      decoyConnected: !!(decoy && decoy.isConnected),
      decoyShow: !!(decoy && decoy.classList.contains('show')),
      queueCount: window.playQueue.length,
      currentPanelClosed: !document.getElementById('playlist-panel').classList.contains('show'),
    };
  });
  pass('closing current playlist panel leaves other playlist context untouched',
    before.decoyConnected && before.decoyShow &&
    after.decoyConnected && after.decoyShow &&
    after.currentPanelClosed && after.queueCount === 72,
    { before, after });
}

async function testVirtualQueueLifecycleAndRemoval() {
  const state = await cdp.call(async function () {
    var originalQueue = playQueue;
    var originalIndex = currentIdx;
    var originalPlayQueueAt = window.playQueueAt;
    var originalMiniOpen = miniQueueOpen;
    var calls = [];
    try {
      playQueue = Array.from({ length:180 },function(_,index){
        return { id:'virtual-'+index, provider:'local', name:'Virtual '+index, artist:'QA', cover:'' };
      });
      currentIdx = 90;
      setMiniQueueOpen(true);
      await new Promise(function(resolve){ setTimeout(resolve,120); });
      var list = document.getElementById('mini-queue-list');
      var releaseDeadline = performance.now() + 1000;
      while (list.__lfVirtualProgrammaticScroll && performance.now() < releaseDeadline) {
        await new Promise(function(resolve){ setTimeout(resolve,16); });
      }
      var initial = { rows:list.querySelectorAll('.mini-queue-item').length, mode:list.dataset.lfVirtualization || '' };
      list.scrollTop = Math.min(list.scrollHeight-list.clientHeight,list.scrollTop+1240);
      list.dispatchEvent(new Event('scroll'));
      await new Promise(function(resolve){ setTimeout(resolve,120); });
      var scrolled = {
        rows:list.querySelectorAll('.mini-queue-item').length,
        mode:list.dataset.lfVirtualization || '',
        start:Number(list.__lfVirtualStart || 0)
      };
      setMiniQueueOpen(false);
      await new Promise(function(resolve){ setTimeout(resolve,80); });
      var closed = {
        rows:list.querySelectorAll('.mini-queue-item').length,
        mode:list.dataset.lfVirtualization || '',
        frame:Number(list.__lfVirtualFrame || 0),
        timer:Number(list.__lfVirtualIdleTimer || 0)
      };

      playQueue = Array.from({ length:6 },function(_,index){ return { id:'remove-'+index, name:'Remove '+index, artist:'QA' }; });
      currentIdx = 3;
      window.playQueueAt = function(index){ calls.push(index); return Promise.resolve(true); };
      removeFromQueue(1);
      var beforeCurrent = { index:currentIdx, songId:playQueue[currentIdx] && playQueue[currentIdx].id };
      removeFromQueue(currentIdx);
      var current = { index:currentIdx, songId:playQueue[currentIdx] && playQueue[currentIdx].id, calls:calls.slice() };
      return { initial:initial, scrolled:scrolled, closed:closed, beforeCurrent:beforeCurrent, current:current };
    } finally {
      window.playQueueAt = originalPlayQueueAt;
      playQueue = originalQueue;
      currentIdx = originalIndex;
      setMiniQueueOpen(originalMiniOpen);
      safeRenderQueuePanel('problem8-virtual-lifecycle-restore',{ deferWhenHidden:false });
    }
  });
  pass('large mini queue is windowed before interaction', state.initial.rows < 180 && state.initial.mode === 'windowed', state);
  pass('active high-speed scroll remains windowed and advances its bounded range', state.scrolled.rows < 180 && state.scrolled.mode === 'windowed' && state.scrolled.start > 0, state);
  pass('closing mini queue cancels pending work and immediately compacts hidden DOM', state.closed.rows < 180 && state.closed.mode === 'windowed' && state.closed.frame === 0 && state.closed.timer === 0, state);
  pass('removing an earlier item preserves the playing song index', state.beforeCurrent.index === 2 && state.beforeCurrent.songId === 'remove-3', state);
  pass('removing the current item advances to the replacement and synchronizes index', state.current.index === 2 && state.current.songId === 'remove-4' && state.current.calls.join(',') === '2', state);
  return state;
}

function writeResult(name, value) {
  const file = path.join(evidenceDir, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

async function cleanup() {
  if (cdp) cdp.close();
  if (app && app.exitCode == null) {
    try { app.kill(); } catch (_) {}
    await delay(400);
    if (app.exitCode == null && process.platform === 'win32' && app.pid) {
      spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    }
  }
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) {}
}

(async function main() {
  const staticEvidence = staticAudit();
  await startApp();
  const desktop = await exerciseViewport({ name: 'desktop-dpr1', width: 1280, height: 800, dpr: 1 }, true);
  await testMouseClose();
  await testEscapeClose();
  await testOnlyCurrentPanelCloses();
  const compact = await exerciseViewport({ name: 'compact-dpr1', width: 640, height: 520, dpr: 1 }, false);
  const highDpi = await exerciseViewport({ name: 'desktop-dpr1_75', width: 980, height: 650, dpr: 1.75 }, false);
  const virtualQueue = await testVirtualQueueLifecycleAndRemoval();
  pass('no renderer exception during problem 8 workflow', rendererErrors.length === 0, rendererErrors);
  const result = {
    ok: true,
    problem: 8,
    launchMode,
    launchExecutable,
    staticEvidence,
    checks,
    summary: {
      desktopCoordinates: desktop.map(sample => ({ where: sample.where, left: sample.button.left, top: sample.button.top })),
      compactCoordinates: compact.map(sample => ({ where: sample.where, left: sample.button.left, top: sample.button.top })),
      highDpiCoordinates: highDpi.map(sample => ({ where: sample.where, left: sample.button.left, top: sample.button.top })),
      virtualQueue,
      screenshots,
    },
    viewports,
    rendererErrors,
    appLogTail: appLog.join('').slice(-12000),
    completedAt: new Date().toISOString(),
  };
  const resultFile = writeResult('result.json', result);
  console.log(JSON.stringify({ ok: true, problem: 8, launchMode, resultFile, checks: Object.keys(checks).length }, null, 2));
})().catch(error => {
  const failure = {
    ok: false,
    problem: 8,
    launchMode,
    launchExecutable,
    error: error && error.stack || String(error),
    checks,
    viewports,
    screenshots,
    rendererErrors,
    appLogTail: appLog.join('').slice(-12000),
    completedAt: new Date().toISOString(),
  };
  const failureFile = writeResult('failure.json', failure);
  console.error(JSON.stringify({ ok: false, problem: 8, failureFile, error: failure.error }, null, 2));
  process.exitCode = 1;
}).finally(cleanup);
