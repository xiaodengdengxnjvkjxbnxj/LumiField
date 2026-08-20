const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const electron = require('electron');
const installedExecutable = String(process.env.LF_UI_EXECUTABLE || '').trim();
const launchExecutable = installedExecutable || electron;
const launchMode = installedExecutable ? 'Electron installed + CDP' : 'Electron source + CDP';
const { PLATFORM_CONFIGS } = require(path.join(repo, 'desktop', 'music-platform-manager.js'));
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.resolve(process.env.LF_UI_SMOKE_OUT || path.join(repo, 'test-results', 'lf-ui-smoke', runId));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-ui-smoke-'));
const migrationDir = path.join(userData, 'migrations');
fs.mkdirSync(migrationDir, { recursive: true });
fs.writeFileSync(path.join(migrationDir, 'legacy-upstream-platform-session-v2.json'), JSON.stringify({
  version: 2,
  validated: true,
  testIsolation: true,
  results: [],
}, null, 2), { encoding: 'utf8', mode: 0o600 });
const consolePrecheck = process.argv.includes('--console-precheck');
const skipScreenshots = process.env.LF_UI_SKIP_SCREENSHOTS === '1';
const stageVideoFixture = [
  String(process.env.LF_UI_STAGE_VIDEO || '').trim(),
  'D:\\HuaweiMoveData\\Users\\35992\\Desktop\\文件13\\视频五.mp4',
  'D:\\HuaweiMoveData\\Users\\35992\\Desktop\\文件13\\视频一.mp4',
  'C:\\Users\\35992\\Desktop\\文件13\\视频五.mp4',
  'C:\\Users\\35992\\Desktop\\文件13\\视频一.mp4',
].find(file => file && fs.existsSync(file));
const errors = [];
const appLog = [];
const screenshots = [];
const screenshotWarnings = [];
const checks = {};
let app = null;
let cdp = null;
let origin = '';

fs.mkdirSync(evidenceDir, { recursive: true });
const feedbackFixture = path.join(evidenceDir, 'feedback-fixture.txt');
fs.writeFileSync(feedbackFixture, 'LumiField UI smoke attachment\n', 'utf8');
const feedbackPngFixture = path.join(evidenceDir, 'feedback-fixture.png');
fs.writeFileSync(feedbackPngFixture, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));

function pass(name, condition, details) {
  assert.ok(condition, name + (details == null ? '' : ': ' + JSON.stringify(details)));
  checks[name] = details == null ? true : details;
  return details;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
        const exception = detail.exception || {};
        errors.push(String(exception.description || detail.text || 'Renderer exception').slice(0, 1200));
      }
    };
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
    await this.send('DOM.enable');
    await this.send('Network.enable');
    await this.send('Page.bringToFront');
    await this.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  }

  send(method, params, timeoutMs) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('CDP command timed out: ' + method));
      }, Number(timeoutMs) || 60000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
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
    return response.result ? response.result.value : undefined;
  }

  call(fn, args) {
    return this.evaluate('(' + fn.toString() + ').apply(null,' + JSON.stringify(args || []) + ')');
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
  spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide:true, encoding:'utf8', timeout:12000 });
}

async function waitFor(fn, timeout, interval) {
  const started = Date.now();
  let last;
  while (Date.now() - started < (timeout || 20000)) {
    try {
      last = await fn();
      if (last) return last;
    } catch (_) {}
    await delay(interval || 150);
  }
  throw new Error('Timed out after ' + (timeout || 20000) + ' ms; last=' + JSON.stringify(last));
}

async function findMainTarget(debugPort) {
  return waitFor(async () => {
    const response = await fetch('http://127.0.0.1:' + debugPort + '/json/list');
    const list = await response.json();
    return list.find(item => item.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//.test(item.url)) || null;
  }, 45000, 250);
}

function pageWait(fn, args, timeout) {
  return waitFor(() => cdp.call(fn, args).then(Boolean), timeout || 20000, 150);
}

async function physicalClick(selector) {
  const rect = await cdp.call(function (value) {
    const node = document.querySelector(value);
    if (!node) return null;
    const initial = node.getBoundingClientRect();
    const fixed = getComputedStyle(node).position === 'fixed';
    if (!fixed && (initial.top < 0 || initial.left < 0 || initial.bottom > innerHeight || initial.right > innerWidth)) {
      node.scrollIntoView({ block: 'center', inline: 'center' });
    }
    const box = node.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2, width: box.width, height: box.height };
  }, [selector]);
  pass('physical target ' + selector, rect && rect.width > 0 && rect.height > 0, rect);
  await delay(80);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  return rect;
}

async function setFileInput(selector, file) {
  const files = (Array.isArray(file) ? file : [file]).map(value => path.resolve(value));
  files.forEach(value => assert.ok(fs.existsSync(value), 'Missing file input fixture ' + value));
  const documentNode = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const inputNode = await cdp.send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector });
  assert.ok(inputNode.nodeId, 'Missing file input ' + selector);
  await cdp.send('DOM.setFileInputFiles', { nodeId: inputNode.nodeId, files });
}

async function screenshot(name) {
  if (skipScreenshots) {
    const warning = 'Screenshot skipped by LF_UI_SKIP_SCREENSHOTS: ' + name;
    screenshotWarnings.push(warning);
    return null;
  }
  let response = null;
  let lastError = null;
  for (let attempt = 0; attempt < 2 && !response; attempt += 1) {
    try {
      response = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, 12000);
    } catch (error) {
      lastError = error;
      const stale = cdp;
      try {
        const recovered = new CDP(stale.url);
        await recovered.connect();
        cdp = recovered;
        stale.close();
      } catch (recoverError) {
        lastError = new Error(String(error.message || error) + '; CDP reconnect failed: ' + String(recoverError.message || recoverError));
      }
      await delay(350 + attempt * 250);
    }
  }
  if (!response) {
    const warning = 'Screenshot skipped after renderer capture timeout: ' + name + ' (' + String(lastError && lastError.message || 'unknown') + ')';
    screenshotWarnings.push(warning);
    appLog.push('[UI smoke] ' + warning + '\n');
    return null;
  }
  const file = path.join(evidenceDir, name + '.png');
  fs.writeFileSync(file, Buffer.from(response.data, 'base64'));
  screenshots.push(file);
  return file;
}

async function fetchJson(url, options, timeout) {
  const response = await fetch(url, Object.assign({}, options || {}, { signal: AbortSignal.timeout(timeout || 30000) }));
  let body = null;
  try { body = await response.json(); } catch (_) {}
  return { ok: response.ok, status: response.status, body };
}

async function testRuntimeApis(base) {
  const search = await fetchJson(base + '/api/platform/search?keywords=' + encodeURIComponent('小城夏天 LBI利比') + '&limit=8', {}, 50000);
  const searchSongs = search.body && Array.isArray(search.body.songs) ? search.body.songs : [];
  const providersTried = search.body && Array.isArray(search.body.providersTried) ? search.body.providersTried : [];
  pass('cross-platform search runtime', search.ok && searchSongs.length > 0 && ['kugou', 'netease', 'qq'].every(p => providersTried.includes(p)), {
    status: search.status,
    songs: searchSongs.length,
    providersTried,
    topProvider: searchSongs[0] && (searchSongs[0].provider || searchSongs[0].source),
  });

  const translation = await fetchJson(base + '/api/translate/lyrics', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceLanguage: 'en', targetLanguage: 'zh-CN', lines: ['Hello world'] }),
  }, 15000);
  const translationValues = translation.body && (translation.body.translations || translation.body.lines);
  pass('translation uses the real local fallback when remote config is absent',
    translation.ok
      && translation.body
      && translation.body.adapter === 'local-bergamot'
      && Array.isArray(translationValues)
      && translationValues.length === 1
      && String(translationValues[0] || '').trim().length > 0, {
    status: translation.status,
    adapter: translation.body && translation.body.adapter,
    translation: translationValues && translationValues[0],
  });

  const comments = await fetchJson(base + '/api/platform/hot-comments?limit=8', {}, 20000);
  pass('hot comments actual logged-out response', comments.ok && comments.body && Array.isArray(comments.body.comments) && comments.body.comments.length === 0, {
    status: comments.status,
    count: comments.body && comments.body.comments && comments.body.comments.length,
    message: comments.body && comments.body.message,
  });

  const qishuiStatus = await fetchJson(base + '/api/qishui/login/status', {}, 15000);
  const qishuiLoginSource = fs.readFileSync(path.join(repo, 'public', 'qishui-login.js'), 'utf8');
  const qishuiLoginPage = fs.readFileSync(path.join(repo, 'public', 'qishui-login.html'), 'utf8');
  pass('qishui official client session bridge', qishuiStatus.ok && qishuiStatus.body && qishuiStatus.body.provider === 'qishui' &&
    /LumiFieldQishuiLogin/.test(qishuiLoginSource) && /importOfficialSession/.test(qishuiLoginSource) &&
    !/login\/qr\/(?:key|check)/.test(qishuiLoginSource) && /通过汽水音乐官方客户端登录/.test(qishuiLoginPage), {
    status: qishuiStatus.status,
    provider: qishuiStatus.body && qishuiStatus.body.provider,
    legacyQrRemovedFromUi: !/login\/qr\/(?:key|check)/.test(qishuiLoginSource),
  });

  return {
    search: checks['cross-platform search runtime'],
    translation: checks['translation missing config is explicit'],
    hotComments: checks['hot comments actual logged-out response'],
    qishuiLogin: checks['qishui official client session bridge'],
  };
}

async function runConsolePrecheck() {
  await cdp.call(function () {
    const auth = document.getElementById('lf-auth-root');
    if (auth) auth.classList.remove('show');
    document.body.classList.remove('lf-auth-locked', 'immersive-mode', 'empty-home-active');
    if (typeof window.closeLocalBeatModal === 'function') window.closeLocalBeatModal();
    const beatModal = document.getElementById('local-beat-modal');
    if (beatModal) {
      beatModal.classList.remove('show', 'active');
      beatModal.style.display = 'none';
    }
    const panel = document.getElementById('fx-panel');
    panel.classList.remove('show', 'peek', 'closing');
    panel.scrollTop = 0;
    window.scrollTo(0, 0);
  });
  await delay(400);
  await physicalClick('#fx-fab');
  await pageWait(function () {
    const node = document.getElementById('fx-panel');
    const style = getComputedStyle(node);
    return node.classList.contains('show') && Number(style.opacity) > 0.95 && style.filter === 'none';
  }, [], 8000);
  const opened = await cdp.call(function () {
    const node = document.getElementById('fx-panel');
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, Math.max(1, box.top) + Math.min(box.height / 2, innerHeight / 3));
    const rules = [];
    function visit(ruleList, context) {
      Array.from(ruleList || []).forEach(function (rule) {
        if (rule.cssRules && rule.cssRules.length) { visit(rule.cssRules, context.concat(rule.conditionText || rule.name || 'group')); return; }
        if (!rule.selectorText || !rule.style) return;
        try {
          if (node.matches(rule.selectorText)) {
            const relevant = ['left', 'right', 'top', 'bottom', 'width', 'opacity', 'filter', 'transform', 'animation', 'transition', 'pointer-events']
              .filter(name => rule.style.getPropertyValue(name))
              .map(name => name + ':' + rule.style.getPropertyValue(name) + (rule.style.getPropertyPriority(name) ? ' !important' : ''));
            if (relevant.length) rules.push({ selector: rule.selectorText, declarations: relevant, context });
          }
        } catch (_) {}
      });
    }
    Array.from(document.styleSheets).forEach(function (sheet) {
      try { visit(sheet.cssRules, [sheet.href || 'inline']); } catch (_) {}
    });
    const beatModal = document.getElementById('local-beat-modal');
    return {
      classes: node.className,
      inlineStyle: node.getAttribute('style') || '',
      bodyClasses: document.body.className,
      scroll: { x: scrollX, y: scrollY },
      visualViewport: window.visualViewport && {
        offsetLeft: visualViewport.offsetLeft,
        offsetTop: visualViewport.offsetTop,
        width: visualViewport.width,
        height: visualViewport.height,
        scale: visualViewport.scale,
      },
      opacity: Number(style.opacity),
      filter: style.filter,
      transform: style.transform,
      left: style.left,
      right: style.right,
      animationName: style.animationName,
      transition: style.transition,
      rightGap: innerWidth - box.right,
      pointerEvents: style.pointerEvents,
      overflowY: style.overflowY,
      hitInside: !!(hit && node.contains(hit)),
      scrollTop: node.scrollTop,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      viewportHeight: innerHeight,
      rect: { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height },
      localBeatModal: beatModal && { classes: beatModal.className, inlineStyle: beatModal.getAttribute('style') || '' },
      matchingRules: rules,
    };
  });
  const point = { x: opened.rect.left + opened.rect.width / 2, y: Math.max(40, Math.min(opened.viewportHeight, opened.rect.bottom) - 80) };
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await cdp.send('Input.synthesizeScrollGesture', {
    x: point.x,
    y: point.y,
    yDistance: -1000,
    speed: 1200,
    gestureSourceType: 'mouse',
  });
  await delay(450);
  const after = await cdp.call(function () { return document.getElementById('fx-panel').scrollTop; });
  const task13 = await cdp.call(async function () {
    const panel = document.getElementById('fx-panel');
    const consoles = Array.from(document.querySelectorAll('#lf-t13-console'));
    const consoleRoot = consoles[0];
    const presetsPage = panel.querySelector('.fx-tab-page[data-fx-page="presets"]');
    const lyricsPage = panel.querySelector('.fx-tab-page[data-fx-page="lyrics"]');
    const lyricBlock = document.getElementById('lf-t13-lyric-block');
    const archive = document.getElementById('user-archive-grid');
    const visible = function (node) {
      if (!node) return false;
      const box = node.getBoundingClientRect();
      return node.getClientRects().length > 0 && box.width > 0 && box.height > 0;
    };
    window.setFxPanelTab('presets');
    await new Promise(resolve => requestAnimationFrame(resolve));
    const presetVisible = visible(consoleRoot);
    const hiddenOutsidePresets = [];
    for (const tab of ['appearance', 'lyrics', 'motion', 'advanced']) {
      window.setFxPanelTab(tab);
      await new Promise(resolve => requestAnimationFrame(resolve));
      hiddenOutsidePresets.push({ tab, visible: visible(consoleRoot) });
    }
    window.setFxPanelTab('presets');
    await new Promise(resolve => requestAnimationFrame(resolve));
    const state = window.LumiFieldTask13.getState();
    return {
      count: consoles.length,
      parentIsPresets: !!(consoleRoot && consoleRoot.parentElement === presetsPage),
      immediatelyAfterArchive: !!(archive && archive.nextElementSibling === consoleRoot),
      presetVisible,
      blockIds: consoleRoot ? Array.from(consoleRoot.children).filter(node => node.classList.contains('lf-t13-block')).map(node => node.id) : [],
      blockLabels: consoleRoot ? Array.from(consoleRoot.children).filter(node => node.classList.contains('lf-t13-block')).map(node => (node.querySelector('summary span') || {}).textContent || '') : [],
      lyricCount: document.querySelectorAll('#lf-t13-lyric-block').length,
      lyricInLyricsPage: !!(lyricBlock && lyricBlock.parentElement === lyricsPage),
      lyricInPresets: document.querySelectorAll('.fx-tab-page[data-fx-page="presets"] #lf-t13-lyric-block').length,
      lyricLabel: lyricBlock ? ((lyricBlock.querySelector('summary span') || {}).textContent || '') : '',
      hiddenOutsidePresets,
      panoramaText: !!(consoleRoot && /全景/.test(consoleRoot.textContent)),
      cameraDom: document.querySelectorAll('#lf-t13-console [data-lf-scope="camera"],#lf-t13-camera-block,#lf-t13-camera-reset,#lf-t13-console [id^="lf-t13-camera"]').length,
      cameraScopes: document.querySelectorAll('[data-lf-scope="camera"]').length,
      apiHasCamera: !!(state && Object.prototype.hasOwnProperty.call(state, 'camera')),
      echoCameraKeys: consoleRoot ? Array.from(consoleRoot.querySelectorAll('[data-lf-scope="echo"][data-lf-key]')).map(node => node.dataset.lfKey).filter(key => /^(cameraDistance|cameraHorizontal|cameraElevation|autoRotate|rotateSpeed)$/.test(key)).sort() : [],
      echoStateHasCamera: !!(state && state.echo && ['cameraDistance','cameraHorizontal','cameraElevation','autoRotate','rotateSpeed'].every(key => Object.prototype.hasOwnProperty.call(state.echo, key))),
      oldLyrics: document.querySelectorAll('#lf-lyric-mode-controls').length,
      oldSpectrum: document.querySelectorAll('#lf-visualizer-controls').length,
    };
  });
  pass('task13 console is unique; translation is in Lyrics while spectrum and echo remain in Presets', task13.count === 1 &&
    task13.parentIsPresets && task13.immediatelyAfterArchive && task13.presetVisible &&
    JSON.stringify(task13.blockIds) === JSON.stringify(['lf-t13-spectrum-block','lf-t13-echo-block']) &&
    JSON.stringify(task13.blockLabels) === JSON.stringify(['实时音频频谱','音域回响']) &&
    task13.lyricCount === 1 && task13.lyricInLyricsPage && task13.lyricInPresets === 0 && task13.lyricLabel === '歌词翻译' &&
    task13.hiddenOutsidePresets.every(item => !item.visible), task13);
  pass('task13 removes panorama and delayed duplicate controls while preserving echo camera', !task13.panoramaText &&
    task13.cameraDom === 0 && task13.cameraScopes === 0 && !task13.apiHasCamera && task13.oldLyrics === 0 && task13.oldSpectrum === 0 &&
    JSON.stringify(task13.echoCameraKeys) === JSON.stringify(['autoRotate','cameraDistance','cameraElevation','cameraHorizontal','rotateSpeed']) &&
    task13.echoStateHasCamera, task13);
  const stageInteraction = await cdp.call(async function () {
    if (window.LumiFieldTask13) {
      window.LumiFieldTask13.setEchoState({ enabled:false });
      window.LumiFieldTask13.setSpectrumState({ enabled:false });
      window.LumiFieldTask13.updateFrame(performance.now(), 1 / 60);
    }
    if (window.LumiFieldAudioEchoManager) window.LumiFieldAudioEchoManager.disposeMode();
    if (typeof window.toggleFxPanel === 'function') window.toggleFxPanel(false);
    const panel = document.getElementById('fx-panel');
    if (panel) panel.classList.remove('show', 'peek', 'closing');
    document.body.classList.remove('lf-fx-open');
    const canvas = window.renderer && window.renderer.domElement;
    const box = canvas.getBoundingClientRect();
    const point = { x: Math.max(box.left + 40, Math.min(box.right - 40, innerWidth * .5)), y: Math.max(box.top + 40, Math.min(box.bottom - 40, innerHeight * .38)) };
    const oldPreset = window.fx && window.fx.preset;
    const oldFreeActive = window.freeCamera && window.freeCamera.active;
    const oldFreeLocked = window.freeCamera && window.freeCamera.locked;
    if (window.fx) window.fx.preset = 0;
    if (window.freeCamera) { window.freeCamera.active = false; window.freeCamera.locked = false; }
    document.body.classList.remove('empty-home-active');
    window.emptyHomeActive = false;
    window.homeForcedOpen = false;
    window.orbit.centerLocked = true;
    window.orbit.recentering = false;
    const beforeSpin = { vx: Number(window.particleSpin.vx) || 0, vy: Number(window.particleSpin.vy) || 0 };
    canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles:true, cancelable:true, clientX:point.x, clientY:point.y, button:0, buttons:1 }));
    window.processGlobalHoverPointer(new MouseEvent('mousemove', { bubbles:true, cancelable:true, clientX:point.x + 96, clientY:point.y + 44, buttons:1, movementX:96, movementY:44 }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles:true, cancelable:true, clientX:point.x + 96, clientY:point.y + 44, button:0, buttons:0 }));
    const drag = { beforeSpin, afterSpin:{ vx:Number(window.particleSpin.vx) || 0, vy:Number(window.particleSpin.vy) || 0 }, hadDrag:!!window.mouseDownAt.hadDrag, rotating:!!window.orbit.rotating, centerLocked:!!window.orbit.centerLocked };
    window.orbit.userRadius = 6.6;
    window.orbit.centerLocked = true;
    const wheelEvent = new WheelEvent('wheel', { bubbles:true, cancelable:true, clientX:point.x, clientY:point.y, deltaY:180 });
    const wheelBefore = window.orbit.userRadius;
    canvas.dispatchEvent(wheelEvent);
    const wheel = { before:wheelBefore, after:window.orbit.userRadius, prevented:wheelEvent.defaultPrevented, centerLocked:!!window.orbit.centerLocked };
    window.orbit.userTheta = .56;
    window.orbit.userPhi = -.24;
    window.orbit.userRadius = 8.4;
    window.recenterCamera();
    let frames = 0;
    await new Promise(resolve => { function frame(){ frames++; if (!window.orbit.recentering || frames >= 260) resolve(); else requestAnimationFrame(frame); } requestAnimationFrame(frame); });
    const recenter = { frames, recentring:!!window.orbit.recentering, centerLocked:!!window.orbit.centerLocked, theta:window.orbit.userTheta, phi:window.orbit.userPhi, radius:window.orbit.userRadius, baselineTheta:window.orbit.baselineTheta, baselinePhi:window.orbit.baselinePhi, baselineRadius:window.orbit.baselineRadius };
    if (window.fx) window.fx.preset = oldPreset;
    if (window.freeCamera) { window.freeCamera.active = oldFreeActive; window.freeCamera.locked = oldFreeLocked; }
    window.toggleFxPanel(true);
    window.setFxPanelTab('presets');
    return { drag, wheel, recenter };
  });
  pass('existing stage drag wheel and recenter remain effective', stageInteraction.drag.hadDrag && !stageInteraction.drag.rotating &&
    !stageInteraction.drag.centerLocked && (Math.abs(stageInteraction.drag.afterSpin.vx - stageInteraction.drag.beforeSpin.vx) > .001 || Math.abs(stageInteraction.drag.afterSpin.vy - stageInteraction.drag.beforeSpin.vy) > .001) &&
    stageInteraction.wheel.prevented && !stageInteraction.wheel.centerLocked && stageInteraction.wheel.after > stageInteraction.wheel.before &&
    !stageInteraction.recenter.recentring && stageInteraction.recenter.centerLocked &&
    Math.abs(stageInteraction.recenter.theta - stageInteraction.recenter.baselineTheta) < .01 && Math.abs(stageInteraction.recenter.phi - stageInteraction.recenter.baselinePhi) < .01 &&
    Math.abs(stageInteraction.recenter.radius - stageInteraction.recenter.baselineRadius) < .06, stageInteraction);
  await cdp.call(function () {
    const root = document.getElementById('lf-t13-console');
    if (root) root.scrollIntoView({ block:'start', inline:'nearest' });
  });
  await delay(250);
  await screenshot('00-console-precheck');
  fs.writeFileSync(path.join(evidenceDir, 'precheck-diagnostic.json'), JSON.stringify({ opened, scroll: { before: opened.scrollTop, after } }, null, 2));
  pass('visual console quick open state', opened.opacity > 0.95 && opened.filter === 'none' && opened.rightGap < 45 &&
    opened.pointerEvents === 'auto' && opened.hitInside && opened.scrollHeight > opened.clientHeight, opened);
  pass('visual console quick physical scroll', after > 100, { before: opened.scrollTop, after });
  pass('renderer has no uncaught exceptions', errors.length === 0, errors);
  const result = { ok: true, runId, mode: 'visual-console-precheck', origin, evidenceDir, checks, screenshots, screenshotWarnings, rendererErrors: errors };
  fs.writeFileSync(path.join(evidenceDir, 'precheck-result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(evidenceDir, 'app.log'), appLog.join('').replace(/\b\d{6}\b/g, '[REDACTED_CODE]'));
  process.stdout.write(JSON.stringify(result) + '\n');
}

function rectIsBottom(value) {
  return value && value.rect && value.viewport && value.rect.width > 300 && value.rect.height > 45 &&
    value.rect.top > value.viewport.height * 0.55 && value.viewport.height - value.rect.bottom < 70;
}

async function run() {
  assert.ok(stageVideoFixture, 'No local stage-video fixture found');
  const debugPort = await freePort();
  const launchArgs = (installedExecutable ? [] : ['.']).concat([
    '--user-data-dir=' + userData,
    '--remote-debugging-port=' + debugPort,
    '--remote-debugging-address=127.0.0.1',
  ]);
  app = spawn(launchExecutable, launchArgs, {
    cwd: installedExecutable ? path.dirname(installedExecutable) : repo,
    env: Object.assign({}, process.env, {
      LF_ALLOW_LOCAL_CODES: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      LUMIFIELD_SKIP_SPLASH: '1',
      LF_MAIL_HOST: ' ',
      LF_MAIL_USER: ' ',
      LF_MAIL_PASSWORD: ' ',
      LF_MAIL_FROM: ' ',
      LF_WECHAT_APP_ID: ' ',
      LF_WECHAT_APP_SECRET: ' ',
      LF_WECHAT_REDIRECT_URI: ' ',
      LF_WECHAT_STATE_SECRET: ' ',
      LF_QQ_APP_ID: ' ',
      LF_QQ_APP_KEY: ' ',
      LF_QQ_REDIRECT_URI: ' ',
      LF_QQ_STATE_SECRET: ' ',
      LF_MOBILE_AUTH_URL: ' ',
      LF_REMOTE_API_URL: ' ',
      LF_TRANSLATE_ENDPOINT: ' ',
      LF_TRANSLATE_API_KEY: ' ',
    }),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = chunk => {
    const value = String(chunk);
    appLog.push(value);
    if (/(?:FATAL|uncaught exception|renderer process crashed)/i.test(value)) errors.push(value.trim().slice(0, 1200));
  };
  app.stdout.on('data', collect);
  app.stderr.on('data', collect);

  const target = await findMainTarget(debugPort);
  origin = new URL(target.url).origin;
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  focusAppWindow();
  await cdp.send('Page.bringToFront');
  await pageWait(function () {
    return document.readyState === 'complete' && document.getElementById('lf-auth-root') &&
      window.desktopWindow && window.LFAuth && window.LumiFieldTask13 && window.LFAudioControls &&
      window.LFOfflineAudioCache;
  }, [], 45000);
  await pageWait(function () { return document.body.classList.contains('lf-auth-locked'); }, [], 30000);

  await cdp.call(function () {
    localStorage.setItem('lumifield-task13-camera-v1', JSON.stringify({ distance: 27.4 }));
  });
  await cdp.send('Page.reload', { ignoreCache: true });
  await pageWait(function () {
    return document.readyState === 'complete' && document.getElementById('lf-auth-root') &&
      window.desktopWindow && window.LFAuth && window.LumiFieldTask13 && window.LFAudioControls &&
      window.LFOfflineAudioCache;
  }, [], 45000);
  await pageWait(function () { return document.body.classList.contains('lf-auth-locked'); }, [], 30000);
  await delay(1250);
  const task13LegacyCleanup = await cdp.call(function () {
    return {
      cameraStorage: localStorage.getItem('lumifield-task13-camera-v1'),
      oldLyrics: document.querySelectorAll('#lf-lyric-mode-controls').length,
      oldSpectrum: document.querySelectorAll('#lf-visualizer-controls').length,
    };
  });
  pass('task13 reload clears legacy panorama storage and delayed duplicate controls', task13LegacyCleanup.cameraStorage === null &&
    task13LegacyCleanup.oldLyrics === 0 && task13LegacyCleanup.oldSpectrum === 0, task13LegacyCleanup);

  if (consolePrecheck) {
    await runConsolePrecheck();
    return;
  }

  const initial = await cdp.call(function () {
    const auth = document.getElementById('lf-auth-root');
    return {
      authLocked: document.body.classList.contains('lf-auth-locked'),
      authVisible: auth.classList.contains('show'),
      brand: document.body.innerText.includes('LumiField') && document.body.innerText.includes('LF'),
      invalidSplashLines: document.querySelectorAll('#splash .spectrum-line,#splash .dotted-line,#splash .scan-line,#splash .progress-wave').length,
      smsText: auth.innerText.includes('短信'),
      phoneInputs: auth.querySelectorAll('input[type="tel"]').length,
      oauthButtons: Array.from(auth.querySelectorAll('[data-lf-oauth]')).map(node => node.dataset.lfOauth).sort(),
      lfOauthLoginCopy: /(?:微信|QQ)\s*(?:官方)?登录|(?:微信|QQ)\s*登录\s*LF/.test(auth.querySelector('[data-lf-auth-pane="login"]').innerText),
    };
  });
  pass('auth gate and no SMS UI', initial.authLocked && initial.authVisible && initial.brand && initial.invalidSplashLines === 0 &&
    !initial.smsText && initial.phoneInputs === 0 && initial.oauthButtons.length === 0 && !initial.lfOauthLoginCopy, initial);
  await screenshot('01-auth-gate');

  await cdp.call(function () { document.querySelector('[data-lf-auth-tab="qr"]').click(); });
  await pageWait(function () {
    const pane = document.querySelector('[data-lf-auth-pane="qr"]');
    const status = document.getElementById('lf-qr-status');
    return pane && pane.classList.contains('active') && pane.textContent.includes('开发中') &&
      status && status.textContent.includes('PAUSED_DEVELOPMENT');
  }, [], 5000);
  const qrBefore = await cdp.call(function () {
    const pane = document.querySelector('[data-lf-auth-pane="qr"]');
    return {
      paneText: pane.textContent,
      status: document.getElementById('lf-qr-status').textContent,
      content: document.getElementById('lf-auth-qr-content').textContent.trim(),
      imageText: document.getElementById('lf-auth-qr-image').textContent.trim(),
      imageCount: document.querySelectorAll('#lf-auth-qr-image img, #lf-auth-qr-image canvas, #lf-auth-qr-image svg').length,
      refreshDisabled: !document.getElementById('lf-qr-refresh') || document.getElementById('lf-qr-refresh').disabled,
    };
  });
  await delay(2400);
  const qrPaused = await cdp.call(function () {
    const pane = document.querySelector('[data-lf-auth-pane="qr"]');
    return {
      paneText: pane.textContent,
      status: document.getElementById('lf-qr-status').textContent,
      content: document.getElementById('lf-auth-qr-content').textContent.trim(),
      imageText: document.getElementById('lf-auth-qr-image').textContent.trim(),
      imageCount: document.querySelectorAll('#lf-auth-qr-image img, #lf-auth-qr-image canvas, #lf-auth-qr-image svg').length,
      refreshDisabled: !document.getElementById('lf-qr-refresh') || document.getElementById('lf-qr-refresh').disabled,
    };
  });
  pass('LF mobile QR is visibly paused without QR generation or polling',
    qrPaused.paneText.includes('开发中') && qrPaused.status.includes('PAUSED_DEVELOPMENT') &&
    qrPaused.imageText === '开发中' && qrPaused.imageCount === 0 && !qrPaused.content && qrPaused.refreshDisabled &&
    !/LF_MOBILE_AUTH_URL|BLOCKED_EXTERNAL_CONFIG|未配置/.test(qrPaused.paneText) &&
    qrPaused.status === qrBefore.status && qrPaused.content === qrBefore.content && qrPaused.imageCount === qrBefore.imageCount, {
      state: 'PAUSED_DEVELOPMENT',
      before: qrBefore,
      after: qrPaused,
    });
  await screenshot('01b-mobile-qr-paused');
  await cdp.call(function () { document.querySelector('[data-lf-auth-tab="login"]').click(); });

  const account = 'ui-smoke-' + Date.now() + '@example.com';
  const password = 'Ui' + crypto.randomBytes(12).toString('hex') + '9';
  await cdp.call(function () {
    document.querySelector('[data-lf-auth-tab="register"]').click();
    document.getElementById('lf-register-account').value = 'invalid-address';
    document.getElementById('lf-register-send').click();
  });
  await pageWait(function () {
    const node = document.getElementById('lf-register-status');
    return node && node.textContent.includes('格式错误') && !document.getElementById('lf-register-send').disabled;
  });
  await cdp.call(function (value) {
    document.getElementById('lf-register-account').value = value;
    document.getElementById('lf-register-send').click();
  }, [account]);
  await pageWait(function () {
    return /\d{6}/.test(document.getElementById('lf-auth-dev-mode').textContent) &&
      document.getElementById('lf-register-send').disabled;
  }, [], 25000);
  const code = await cdp.call(function () {
    const match = document.getElementById('lf-auth-dev-mode').textContent.match(/\d{6}/);
    return match && match[0];
  });
  pass('real isolated registration code contract', /^\d{6}$/.test(code), { sixDigits: true, ttlUi: true });
  await cdp.call(function (values) {
    document.getElementById('lf-register-nickname').value = 'UI Smoke';
    document.getElementById('lf-register-code').value = values.code;
    document.getElementById('lf-register-password').value = values.password;
    document.getElementById('lf-register-confirm').value = values.password;
    document.getElementById('lf-register-agreement').checked = true;
    document.getElementById('lf-register-submit').click();
  }, [{ code, password }]);
  await pageWait(function () { return document.getElementById('lf-login-status').textContent.includes('注册成功'); }, [], 25000);
  await cdp.call(function (values) {
    document.getElementById('lf-login-account').value = values.account;
    document.getElementById('lf-login-password').value = values.password;
    document.getElementById('lf-login-submit').click();
  }, [{ account, password }]);
  await pageWait(function () {
    return !document.body.classList.contains('lf-auth-locked') && window.LFAuth.getToken();
  }, [], 25000);

  const secureSession = await cdp.call(function () {
    return {
      handle: window.LFAuth.getToken(),
      stored: localStorage.getItem('lf-auth-token-v1'),
      refresh: localStorage.getItem('lf-auth-refresh-v1'),
      role: window.LFAuth.getUser() && window.LFAuth.getUser().role,
      hasAdmin2fa: !!document.getElementById('lf-login-2fa-row'),
    };
  });
  pass('normal user encrypted main-process session', secureSession.handle === 'main-process' && secureSession.stored === 'main-process' &&
    !secureSession.refresh && secureSession.role === 'user' && !secureSession.hasAdmin2fa, secureSession);

  await cdp.call(function () { window.LFAuth.openProfile(); });
  await pageWait(function () {
    return document.getElementById('lf-profile-modal').classList.contains('show') && document.getElementById('lf-offline-settings');
  }, [], 15000);
  const profile = await cdp.call(function (expected) {
    const modal = document.getElementById('lf-profile-modal');
    const settings = Array.from(modal.querySelectorAll('.lf-profile-section')).find(section => {
      const heading = section.querySelector('h3');
      return heading && heading.textContent.trim() === '设置';
    });
    return {
      visible: modal.classList.contains('show'),
      accountShown: document.getElementById('lf-profile-info').innerText.includes(expected),
      monitorEntry: !!document.getElementById('lf-open-monitor'),
      feedbackLog: !!document.getElementById('lf-feedback-log'),
      feedbackPlaceholder: document.getElementById('lf-feedback-content').placeholder,
      settingsText: settings && settings.innerText,
      offlineSongListVisible: !!document.querySelector('#lf-offline-settings .lf-offline-cache-list,#lf-offline-settings [data-offline-key],#lf-offline-settings [data-offline-play],#lf-offline-settings [data-offline-remove]'),
      offlineOptions: Array.from(document.querySelectorAll('#lf-offline-settings select option')).map(node => node.value),
    };
  }, [account]);
  pass('My profile, feedback and settings layout', profile.visible && profile.accountShown && !profile.monitorEntry && !profile.feedbackLog &&
    profile.feedbackPlaceholder === '请描述问题' && profile.settingsText.includes('登录其他账号') &&
    !profile.settingsText.includes('播放离线缓存') && !profile.settingsText.includes('退出账号') &&
    !profile.offlineSongListVisible && !profile.settingsText.includes('联网播放可缓存歌曲后会显示在这里') &&
    profile.offlineOptions.length === 6 && profile.offlineOptions.includes('21474836480'), profile);

  await cdp.call(function () { document.getElementById('lf-switch-account').click(); });
  await pageWait(function () {
    const modal = document.getElementById('lf-account-manager');
    return modal && modal.classList.contains('show') && document.getElementById('lf-bind-email');
  }, [], 10000);
  const accountManager = await cdp.call(function () {
    const modal = document.getElementById('lf-account-manager');
    return {
      oauthButtons: document.querySelectorAll('#lf-auth-root [data-lf-oauth],#lf-account-manager [data-lf-account-oauth]').length,
      removedLoginCopy: /(?:登录|绑定)\s*(?:微信|QQ)|(?:微信|QQ)\s*(?:登录|绑定)/.test(modal.innerText),
      emailInput: document.getElementById('lf-bind-email').type,
      emailCopy: modal.innerText.includes('邮箱登录方式') && modal.innerText.includes('绑定邮箱'),
    };
  });
  pass('LF account entry and manager remain email-only', accountManager.oauthButtons === 0 && !accountManager.removedLoginCopy &&
    accountManager.emailInput === 'email' && accountManager.emailCopy, accountManager);
  await cdp.call(function () { document.getElementById('lf-account-close').click(); });

  await cdp.call(function () {
    window.__lfFeedbackUploadProgressLog = [];
    window.desktopWindow.onLFFeedbackUploadProgress(function (progress) {
      window.__lfFeedbackUploadProgressLog.push({
        clientId: progress.clientId || '',
        uploadId: progress.uploadId || '',
        status: String(progress.status || '').toUpperCase(),
        progress: Number(progress.progress) || 0,
      });
    });
  });
  await setFileInput('#lf-feedback-file', [feedbackPngFixture, feedbackFixture, stageVideoFixture]);
  await cdp.call(function () {
    const input = document.getElementById('lf-feedback-file');
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await pageWait(function () {
    const cards = Array.from(document.querySelectorAll('#lf-feedback-files .lf-feedback-file-card'));
    return cards.length === 3 && cards.every(card => card.dataset.uploadState === 'uploaded');
  }, [], 120000);
  const feedbackUploaded = await cdp.call(function () {
    const cards = Array.from(document.querySelectorAll('#lf-feedback-files .lf-feedback-file-card')).map(function (card) {
      const info = card.firstElementChild;
      return {
        clientId: card.dataset.fileId,
        state: card.dataset.uploadState,
        name: info && info.querySelector('b') && info.querySelector('b').textContent,
        metadata: info && info.querySelector('span') && info.querySelector('span').textContent,
        status: card.querySelector('.lf-feedback-file-state') && card.querySelector('.lf-feedback-file-state').textContent,
        progress: card.querySelector('.lf-feedback-progress i') && card.querySelector('.lf-feedback-progress i').style.width,
      };
    });
    const transitions = {};
    (window.__lfFeedbackUploadProgressLog || []).forEach(function (event) {
      if (!transitions[event.clientId]) transitions[event.clientId] = [];
      if (transitions[event.clientId][transitions[event.clientId].length - 1] !== event.status) transitions[event.clientId].push(event.status);
    });
    return { cards: cards, transitions: transitions, events: window.__lfFeedbackUploadProgressLog || [] };
  });
  const feedbackNames = feedbackUploaded.cards.map(card => card.name).sort();
  const expectedFeedbackNames = [path.basename(feedbackPngFixture), path.basename(feedbackFixture), path.basename(stageVideoFixture)].sort();
  const feedbackTransitions = Object.values(feedbackUploaded.transitions);
  pass('feedback selected files upload before submit with metadata and progress',
    feedbackUploaded.cards.length === 3 && feedbackNames.join('|') === expectedFeedbackNames.join('|') &&
    feedbackUploaded.cards.every(card => card.state === 'uploaded' && card.status.includes('UPLOADED') && card.progress === '100%' &&
      /(?:image\/png|text\/plain|video\/mp4|application\/octet-stream)/.test(card.metadata) && /(?:B|KB|MB|GB)$/.test(card.metadata)) &&
    feedbackTransitions.length === 3 && feedbackTransitions.every(states => states.includes('VERIFYING') && states.includes('UPLOADED')),
    feedbackUploaded);
  await cdp.call(function () {
    document.getElementById('lf-feedback-content').value = 'UI smoke feedback upload and database delivery';
    document.getElementById('lf-feedback-contact').value = '';
    document.getElementById('lf-feedback-submit').click();
  });
  await pageWait(function () {
    return document.getElementById('lf-feedback-status').textContent.includes('联系方式为必填项');
  }, [], 5000);
  const feedbackRequired = await cdp.call(function () {
    return {
      status: document.getElementById('lf-feedback-status').textContent,
      remainingFiles: document.querySelectorAll('#lf-feedback-files .lf-feedback-file-card').length,
      submitDisabled: document.getElementById('lf-feedback-submit').disabled,
    };
  });
  pass('feedback contact is required before submission', feedbackRequired.status.includes('联系方式为必填项') &&
    feedbackRequired.remainingFiles === 3 && !feedbackRequired.submitDisabled, feedbackRequired);
  await cdp.call(function () {
    document.getElementById('lf-feedback-contact').value = 'ui-smoke@example.test';
    document.getElementById('lf-feedback-submit').click();
  });
  await pageWait(function () {
    return document.getElementById('lf-feedback-status').textContent.includes('数据库保存成功') &&
      !document.getElementById('lf-feedback-submit').disabled;
  }, [], 90000);
  const feedbackResult = await cdp.call(function () {
    return {
      status: document.getElementById('lf-feedback-status').textContent,
      remainingFiles: document.querySelectorAll('#lf-feedback-files .lf-feedback-file-card').length,
    };
  });
  pass('feedback upload, database and mail state separated', feedbackResult.remainingFiles === 0 &&
    feedbackResult.status.includes('数据库保存成功') &&
    (feedbackResult.status.includes('通知邮件发送成功') || feedbackResult.status.includes('通知邮件已进入重试队列')), feedbackResult);

  const offline = await cdp.call(async function () {
    const rate = 16000;
    const seconds = 6;
    const count = rate * seconds;
    const buffer = new ArrayBuffer(44 + count * 2);
    const view = new DataView(buffer);
    const put = function (offset, value) {
      for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
    };
    put(0, 'RIFF');
    view.setUint32(4, 36 + count * 2, true);
    put(8, 'WAVE');
    put(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    put(36, 'data');
    view.setUint32(40, count * 2, true);
    for (let i = 0; i < count; i += 1) {
      const sample = Math.sin(i / rate * Math.PI * 2 * 220) * 9000 + Math.sin(i / rate * Math.PI * 2 * 440) * 2500;
      view.setInt16(44 + i * 2, sample, true);
    }
    const audioBlob = new Blob([buffer], { type: 'audio/wav' });
    const audioUrl = location.origin + '/api/audio?url=' + encodeURIComponent('https://fixture.invalid/lf-ui-smoke.wav');
    const lyrics = [
      { t: 0, duration: 3, text: 'Offline lyric one', translation: '离线译文一' },
      { t: 3, duration: 3, text: 'Offline lyric two', translation: '离线译文二' },
    ];
    const song = {
      id: 'lf-ui-smoke-offline-rich',
      provider: 'netease',
      name: 'LF Offline Rich Fixture',
      artist: 'Local QA Artist',
      album: 'Offline QA',
      cover: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL+WQAAAABJRU5ErkJggg==',
    };
    const previous = {
      audio: window.audio,
      queue: window.playQueue,
      index: window.currentIdx,
      lyrics: window.lyricsLines,
      originalLyrics: window.originalLyricsState,
      nativeKaraoke: window.lyricsHasNativeKaraoke,
      timingSource: window.lyricsTimingSource,
      fetch: window.fetch,
    };
    window.audio = { currentSrc: audioUrl };
    window.playQueue = [song];
    window.currentIdx = 0;
    window.lyricsLines = lyrics;
    window.originalLyricsState = { lines: lyrics, hasNativeKaraoke: false, timingSource: 'lf-ui-smoke-offline' };
    window.lyricsHasNativeKaraoke = false;
    window.lyricsTimingSource = 'lf-ui-smoke-offline';
    window.fetch = function (input, options) {
      const requested = new URL(String(input), location.href).href;
      if (requested === audioUrl) {
        return Promise.resolve(new Response(audioBlob, {
          status: 200,
          headers: { 'content-type': 'audio/wav', 'content-length': String(audioBlob.size) },
        }));
      }
      return previous.fetch.call(window, input, options);
    };
    let cached;
    try {
      cached = await LFOfflineAudioCache.cacheCurrentOnlineSong();
    } finally {
      window.fetch = previous.fetch;
      window.audio = previous.audio;
      window.playQueue = previous.queue;
      window.currentIdx = previous.index;
      window.lyricsLines = previous.lyrics;
      window.originalLyricsState = previous.originalLyrics;
      window.lyricsHasNativeKaraoke = previous.nativeKaraoke;
      window.lyricsTimingSource = previous.timingSource;
    }
    const rows = await LFOfflineAudioCache.list();
    const record = rows.find(row => row.key === cached.key);
    const before = await LFOfflineAudioCache.status();
    const selector = document.querySelector('#lf-offline-settings select');
    selector.value = '536870912';
    selector.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 250));
    const resized = await LFOfflineAudioCache.status();
    selector.value = '2147483648';
    selector.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 250));
    const played = await LFOfflineAudioCache.play(cached.key);
    return {
      cached,
      before,
      resized,
      played,
      userId: LFAuth.getUser().id,
      record: record && {
        accountId: record.accountId,
        coverBlob: record.coverBlob instanceof Blob && record.coverBlob.size > 0 && /^image\//.test(record.coverBlob.type),
        name: record.metadata && record.metadata.name,
        artist: record.metadata && record.metadata.artist,
        lyric: record.metadata && record.metadata.lyricsLines && record.metadata.lyricsLines[0],
        originalLyric: record.metadata && record.metadata.originalLyricsLines && record.metadata.originalLyricsLines[0],
      },
    };
  });
  pass('account-scoped configurable offline cache', offline.cached.ok && offline.before.count === 1 &&
    offline.before.accountId === offline.userId && offline.resized.capacityBytes === 536870912 && offline.played.ok &&
    offline.record && offline.record.accountId === offline.userId && offline.record.coverBlob &&
    offline.record.name === 'LF Offline Rich Fixture' && offline.record.artist === 'Local QA Artist' &&
    offline.record.lyric && offline.record.lyric.translation === '离线译文一' &&
    offline.record.originalLyric && offline.record.originalLyric.translation === '离线译文一', {
    count: offline.before.count,
    accountScoped: offline.before.accountId === offline.userId,
    resizedCapacity: offline.resized.capacityBytes,
    record: offline.record,
  });
  await pageWait(function () { return window.audio && isFinite(window.audio.duration) && window.audio.duration > 5; }, [], 15000);
  await screenshot('02-my-feedback-offline');
  await cdp.call(function () { document.getElementById('lf-profile-close').click(); });

  await pageWait(function () {
    return document.getElementById('lf-platform-login-states') &&
      document.querySelectorAll('#lf-platform-login-states .lf-platform-login-card').length === 5;
  }, [], 15000);
  const accountProviders = ['netease', 'qq', 'kugou', 'kugou_concept', 'qishui'];
  const accountPartitions = accountProviders.map(provider => PLATFORM_CONFIGS[provider] && PLATFORM_CONFIGS[provider].partition);
  const backendPrefixes = ['kugou', 'kugou_concept', 'qishui'].map(provider => PLATFORM_CONFIGS[provider] && PLATFORM_CONFIGS[provider].backendPrefix);
  const platformStates = await cdp.call(async function () {
    return Promise.all(['netease', 'qq', 'kugou', 'kugou_concept', 'qishui'].map(async function (provider) {
      const status = await desktopWindow.getMusicPlatformLoginStatus(provider);
      return { provider, ok: !!status.ok, loggedIn: !!status.loggedIn };
    }));
  });
  pass('five independent music-platform sessions start logged out', platformStates.length === 5 &&
    platformStates.every(item => item.ok && !item.loggedIn) &&
    accountPartitions.every(Boolean) && new Set(accountPartitions).size === 5 &&
    backendPrefixes.every(Boolean) && new Set(backendPrefixes).size === 3 &&
    PLATFORM_CONFIGS.kugou.partition === 'persist:lumifield-kugou-standard' &&
    PLATFORM_CONFIGS.kugou_concept.partition === 'persist:lumifield-kugou-concept' &&
    PLATFORM_CONFIGS.qishui.partition === 'persist:lumifield-qishui' &&
    PLATFORM_CONFIGS.qishui.backendPrefix === '/api/qishui', {
    states: platformStates,
    partitions: accountPartitions,
    backendPrefixes,
  });
  await cdp.call(function () { window.showLoginModal(); });
  await pageWait(function () {
    const modal = document.getElementById('login-modal');
    const details = Array.from(document.querySelectorAll('#lf-platform-login-states .lf-platform-login-detail'));
    return modal.classList.contains('show') && details.length === 5 &&
      details.every(node => node.textContent.includes('未登录'));
  }, [], 20000);
  const platformUi = await cdp.call(function () {
    const panel = document.getElementById('lf-platform-login-states');
    const cards = Array.from(panel.querySelectorAll('[data-lf-platform-login]'));
    return {
      providers: cards.map(node => node.dataset.lfPlatformLogin),
      names: Array.from(panel.querySelectorAll('.lf-platform-login-copy b')).map(node => node.textContent),
      actions: Array.from(panel.querySelectorAll('.lf-platform-login-action')).map(node => ({ provider: node.dataset.provider, text: node.textContent })),
      cardTops: cards.map(node => Math.round(node.getBoundingClientRect().top)),
      text: panel.textContent,
      sodaEntry: /汽水/.test(panel.textContent),
      partitionsSeparatedFromLf: !document.querySelector('[data-lf-oauth]') || !panel.contains(document.querySelector('[data-lf-oauth]')),
    };
  });
  pass('five peer music-platform entries enabled',
    JSON.stringify(platformUi.providers) === JSON.stringify(['netease', 'qq', 'kugou', 'kugou_concept', 'qishui']) &&
    JSON.stringify(platformUi.names) === JSON.stringify(['网易云', 'QQ音乐', '酷狗音乐', '酷狗概念版', '汽水音乐']) &&
    new Set(platformUi.cardTops.slice(0, 3)).size === 1 && new Set(platformUi.cardTops.slice(3)).size === 1 && platformUi.cardTops[3] > platformUi.cardTops[0] &&
    platformUi.actions.every(item => item.text === '登录') &&
    platformUi.sodaEntry && platformUi.partitionsSeparatedFromLf, platformUi);
  await screenshot('03-five-platform-login-entries');

  const hotEvidenceSurface = await cdp.call(function () {
    const beatModal = document.getElementById('local-beat-modal');
    const loginModal = document.getElementById('login-modal');
    [beatModal, loginModal].filter(Boolean).forEach(function (modal) {
      if (window.gsap && typeof window.gsap.killTweensOf === 'function') window.gsap.killTweensOf(modal);
      modal.classList.remove('show', 'active');
      modal.setAttribute('aria-hidden', 'true');
      modal.hidden = true;
      modal.style.display = 'none';
      modal.style.visibility = 'hidden';
      modal.style.opacity = '0';
      modal.style.pointerEvents = 'none';
    });
    window.scrollTo(0, 0);
    return {
      beatHidden: !beatModal || beatModal.hidden && beatModal.style.display === 'none',
      loginHidden: !loginModal || loginModal.hidden && loginModal.style.display === 'none',
      activeMasks: Array.from(document.querySelectorAll('.modal-mask.show,.modal-mask.active')).map(function (modal) { return modal.id || modal.className; }),
    };
  });
  pass('hot-comment screenshots are not obscured by modal masks', hotEvidenceSurface.beatHidden && hotEvidenceSurface.loginHidden && hotEvidenceSurface.activeMasks.length === 0, hotEvidenceSurface);

  await pageWait(function () { return document.getElementById('lf-hot-comment-card') && window.LumiFieldHotCommentCard; }, [], 15000);
  const actualHotComments = await cdp.call(async function () {
    const result = await window.LumiFieldHotComments.fetch(null, 16);
    await window.LumiFieldHotCommentCard.refresh();
    return {
      ok: !!(result && result.ok),
      code: result && result.code || '',
      message: result && result.message || '',
      count: result && Array.isArray(result.comments) ? result.comments.length : -1,
    };
  });
  await pageWait(function () {
    const card = document.getElementById('lf-hot-comment-card');
    return card.dataset.state === 'logged-out' && card.classList.contains('empty') &&
      card.querySelector('.lf-hot-comment-empty-message').textContent.includes('登录音乐平台');
  }, [], 20000);
  const hotEmpty = await cdp.call(function () {
    const card = document.getElementById('lf-hot-comment-card');
    const shell = document.querySelector('.lf-weather-shell');
    const main = shell.querySelector('.lf-weather-main');
    const side = shell.querySelector('.lf-weather-side');
    const rect = function (node) {
      const value = node.getBoundingClientRect();
      return { left:value.left, right:value.right, top:value.top, bottom:value.bottom, width:value.width, height:value.height };
    };
    const cardRect = rect(card), shellRect = rect(shell), mainRect = rect(main), sideRect = rect(side);
    const overlapArea = function (one, two) {
      return Math.max(0, Math.min(one.right, two.right) - Math.max(one.left, two.left)) *
        Math.max(0, Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top));
    };
    const protectedSelectors = [
      '#lf-weather-city','#lf-weather-updated','#lf-clock','#lf-date','#lf-weather-temp','#lf-weather-label','#lf-weather-details',
      '#lf-weather-city-input','#lf-weather-search','#lf-weather-refresh','#lf-forecast','#lf-weather-tools',
      '#lf-weather-wallpaper','#lf-weather-clear','#lf-weather-opacity'
    ];
    const requiredWeatherControls = [
      { name:'cityInput', selector:'#lf-weather-city-input' },
      { name:'search', selector:'#lf-weather-search' },
      { name:'refresh', selector:'#lf-weather-refresh' },
      { name:'forecast', selector:'#lf-forecast' },
      { name:'wallpaper', selector:'#lf-weather-wallpaper' },
      { name:'clear', selector:'#lf-weather-clear' },
      { name:'opacity', selector:'.lf-weather-opacity' },
    ];
    const protectedNodes = protectedSelectors.map(function (selector) { return document.querySelector(selector); }).filter(Boolean);
    const overlaps = protectedNodes.map(function (node) { return { id:node.id, area:overlapArea(cardRect, rect(node)) }; }).filter(function (item) { return item.area > 0.5; });
    const blockedHits = protectedNodes.filter(function (node) {
      const value = rect(node);
      if (!value.width || !value.height) return false;
      const hit = document.elementFromPoint(value.left + value.width / 2, value.top + value.height / 2);
      return !!(hit && card.contains(hit));
    }).map(function (node) { return node.id; });
    const shellStyle = getComputedStyle(shell);
    const shellBorderLeft = parseFloat(shellStyle.borderLeftWidth) || 0;
    const shellBorderTop = parseFloat(shellStyle.borderTopWidth) || 0;
    const shellPaddingLeft = parseFloat(shellStyle.paddingLeft) || 0;
    const shellPaddingTop = parseFloat(shellStyle.paddingTop) || 0;
    const shellPaddingRight = parseFloat(shellStyle.paddingRight) || 0;
    const shellPaddingBottom = parseFloat(shellStyle.paddingBottom) || 0;
    const contentBounds = {
      left: shellRect.left + shellBorderLeft + shellPaddingLeft,
      top: shellRect.top + shellBorderTop + shellPaddingTop,
      right: shellRect.left + shellBorderLeft + shell.clientWidth - shellPaddingRight,
      bottom: shellRect.top + shellBorderTop + shell.clientHeight - shellPaddingBottom,
    };
    const weatherControls = requiredWeatherControls.map(function (item) {
      const node = document.querySelector(item.selector);
      if (!node) return { name:item.name, selector:item.selector, exists:false, size:false, inShell:false, inViewport:false, hit:false };
      const value = rect(node);
      const hitNode = value.width > 0 && value.height > 0 ? document.elementFromPoint(value.left + value.width / 2, value.top + value.height / 2) : null;
      return {
        name: item.name,
        selector: item.selector,
        exists: true,
        rect: value,
        size: value.width > 0 && value.height > 0,
        inShell: value.left >= contentBounds.left - 1 && value.right <= contentBounds.right + 1 && value.top >= contentBounds.top - 1 && value.bottom <= contentBounds.bottom + 1,
        inViewport: value.left >= 0 && value.top >= 0 && value.right <= innerWidth + 1 && value.bottom <= innerHeight + 1,
        hit: !!(hitNode && (hitNode === node || node.contains(hitNode))),
        hitTag: hitNode && hitNode.tagName || '',
        hitId: hitNode && hitNode.id || '',
        hitClass: hitNode && typeof hitNode.className === 'string' ? hitNode.className : '',
      };
    });
    const style = getComputedStyle(card);
    const glassOwner = card.getAttribute('data-lf-liquid-glass') === 'nested' ? shell : card;
    const glassStyle = getComputedStyle(glassOwner);
    const backdrop = glassStyle.backdropFilter || glassStyle.webkitBackdropFilter || '';
    const filterMatch = backdrop.match(/url\(["']?#([^"')]+)["']?\)/i);
    const glassFilter = filterMatch && document.getElementById(filterMatch[1]);
    const displacementScales = glassFilter ? Array.from(glassFilter.querySelectorAll('feDisplacementMap')).map(function (node) { return Number(node.getAttribute('scale')); }) : [];
    const channelMatrices = glassFilter ? Array.from(glassFilter.querySelectorAll('feColorMatrix')).filter(function (node) { return /^(red|green|blue)$/.test(node.getAttribute('result') || ''); }).length : 0;
    const alphaMatch = style.backgroundColor.match(/rgba?\([^,]+,[^,]+,[^,]+(?:,\s*([\d.]+))?\)/i);
    const backgroundAlpha = alphaMatch && alphaMatch[1] != null ? Number(alphaMatch[1]) : 1;
    const beforeStyle = getComputedStyle(card, '::before');
    const afterStyle = getComputedStyle(card, '::after');
    const pointerBefore = card.style.getPropertyValue('--lf-hot-glass-x');
    card.dispatchEvent(new PointerEvent('pointermove', { bubbles:true, clientX:cardRect.right - 4, clientY:cardRect.bottom - 4 }));
    const pointerAfter = card.style.getPropertyValue('--lf-hot-glass-x');
    return {
      empty: card.classList.contains('empty'),
      state: card.dataset.state,
      message: card.querySelector('.lf-hot-comment-empty-message').textContent,
      fields: ['platform', 'song', 'artist', 'text', 'user-name', 'date', 'likes', 'cover', 'avatar', 'play'].every(name =>
        !!card.querySelector('.lf-hot-comment-' + name)),
      oldMotto: !!document.getElementById('lf-weather-motto'),
      layout: {
        card: cardRect,
        shell: shellRect,
        main: mainRect,
        side: sideRect,
        contentBounds: contentBounds,
        gridArea: style.gridArea,
        belowWeather: cardRect.top >= Math.max(mainRect.bottom, sideRect.bottom) - 1,
        fillsWidth: Math.abs(cardRect.left - contentBounds.left) <= 2 && Math.abs(cardRect.right - contentBounds.right) <= 2,
        fillsBottom: Math.abs(cardRect.bottom - contentBounds.bottom) <= 2,
        inShell: cardRect.left >= contentBounds.left - 1 && cardRect.right <= contentBounds.right + 1 && cardRect.top >= shellRect.top - 1 && cardRect.bottom <= contentBounds.bottom + 1,
        inViewport: cardRect.left >= 0 && cardRect.top >= 0 && cardRect.right <= innerWidth + 1 && cardRect.bottom <= innerHeight + 1,
        overlaps: overlaps,
        blockedHits: blockedHits,
        weatherControls: weatherControls,
      },
      glass: {
        svgEnabled: document.documentElement.classList.contains('control-glass-svg-ok'),
        owner: glassOwner === shell ? 'weather-shell' : 'hot-comment-card',
        ownerMarker: glassOwner.getAttribute('data-lf-liquid-glass') || '',
        backdrop: backdrop,
        filterId: filterMatch && filterMatch[1] || '',
        displacementScales: displacementScales,
        channelMatrices: channelMatrices,
        backgroundAlpha: backgroundAlpha,
        edgeHighlight: /inset/i.test(style.boxShadow),
        fakeRgbDots: card.querySelectorAll('.rgb-dot,.color-dot,.chromatic-dot,[data-rgb-dot]').length,
        fakeRepeatingDots: /repeating-radial-gradient/i.test([style.backgroundImage, beforeStyle.backgroundImage, afterStyle.backgroundImage].join(' ')),
        chromaAnimation: afterStyle.animationName,
        dynamicPointer: pointerAfter && pointerAfter !== pointerBefore,
      },
    };
  });
  pass('real hot-comment logged-out state is accurate', actualHotComments.ok && actualHotComments.code === 'NO_LOGGED_IN_MUSIC_PLATFORM' &&
    actualHotComments.count === 0 && actualHotComments.message === '登录音乐平台后显示歌曲热评' &&
    hotEmpty.empty && hotEmpty.state === 'logged-out' && hotEmpty.message === actualHotComments.message && hotEmpty.fields && !hotEmpty.oldMotto, {
    response: actualHotComments,
    card: { empty:hotEmpty.empty, state:hotEmpty.state, message:hotEmpty.message, fields:hotEmpty.fields, oldMotto:hotEmpty.oldMotto },
  });
  pass('hot-comment card fills the weather bottom row without blocking controls', hotEmpty.layout.belowWeather &&
    hotEmpty.layout.fillsWidth && hotEmpty.layout.fillsBottom && hotEmpty.layout.inShell && hotEmpty.layout.inViewport &&
    hotEmpty.layout.overlaps.length === 0 && hotEmpty.layout.blockedHits.length === 0 && hotEmpty.layout.card.height >= 100, hotEmpty.layout);
  pass('weather controls remain fully visible and physically hittable inside the hot-comment shell', hotEmpty.layout.weatherControls.length === 7 &&
    hotEmpty.layout.weatherControls.every(item => item.exists && item.size && item.inShell && item.inViewport && item.hit), hotEmpty.layout.weatherControls);
  const weatherInteraction = await cdp.call(async function () {
    const input = document.getElementById('lf-weather-city-input');
    const search = document.getElementById('lf-weather-search');
    const label = document.getElementById('lf-weather-label');
    const updated = document.getElementById('lf-weather-updated');
    const originalFetch = window.fetch;
    const calls = [];
    const pending = [];
    const waitUntil = async function (predicate, timeout) {
      const started = Date.now();
      while (Date.now() - started < (timeout || 3000)) {
        if (predicate()) return true;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      return false;
    };
    const keyboard = function (composing) {
      const event = new KeyboardEvent('keydown', { key:'Enter', code:'Enter', bubbles:true, cancelable:true });
      if (composing) {
        try { Object.defineProperty(event, 'isComposing', { value:true }); } catch (_) {}
        try { Object.defineProperty(event, 'keyCode', { value:229 }); } catch (_) {}
      }
      input.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const response = function (city, code, text) {
      return {
        ok: true,
        weather: {
          location: { name:city, latitude:30.2, longitude:120.1 },
          weatherCode:code,
          label:text,
          temperature:22,
          apparentTemperature:21,
          humidity:68,
          windSpeed:12,
          windDirection:90,
          forecast:[{ date:'2026-07-26', weatherCode:code, temperatureMax:26, temperatureMin:19, precipitationProbability:40 }],
        },
      };
    };
    try {
      await waitUntil(function () { return !search.disabled; }, 20000);
      window.fetch = function (url, options) {
        const value = String(url || '');
        if (value.indexOf('/api/weather/current') < 0) return originalFetch.call(this, url, options);
        calls.push(value);
        return new Promise(resolve => pending.push({ url:value, resolve:resolve }));
      };

      input.value = '杭州';
      keyboard(true);
      await new Promise(resolve => setTimeout(resolve, 30));
      const composingRequests = calls.length;
      const enterPrevented = keyboard(false);
      keyboard(false);
      search.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
      await waitUntil(function () { return pending.length === 1; });
      const duplicateRequests = calls.length;
      pending[0].resolve({ ok:true, status:200, json:async function () { return response('杭州', 63, '中雨'); } });
      await waitUntil(function () { return label.textContent === '中雨' && !search.disabled; });
      const first = {
        city: document.getElementById('lf-weather-city').textContent,
        label: label.textContent,
        details: document.getElementById('lf-weather-details').textContent,
        savedCity: localStorage.getItem('lumifield-weather-city'),
      };

      input.value = '北京';
      keyboard(false);
      await waitUntil(function () { return pending.length === 2; });
      input.value = '上海';
      keyboard(false);
      await waitUntil(function () { return pending.length === 3; });
      pending[2].resolve({ ok:true, status:200, json:async function () { return response('上海', 0, '晴'); } });
      await waitUntil(function () { return label.textContent === '晴'; });
      pending[1].resolve({ ok:true, status:200, json:async function () { return response('北京', 71, '小雪'); } });
      await waitUntil(function () { return !search.disabled; });
      await new Promise(resolve => setTimeout(resolve, 30));
      const race = {
        city: document.getElementById('lf-weather-city').textContent,
        label: label.textContent,
        savedCity: localStorage.getItem('lumifield-weather-city'),
      };

      input.value = '不存在的地区';
      keyboard(false);
      await waitUntil(function () { return pending.length === 4; });
      pending[3].resolve({
        ok:false,
        status:404,
        json:async function () { return { ok:false, code:'WEATHER_CITY_NOT_FOUND', error:'WEATHER_CITY_NOT_FOUND' }; },
      });
      await waitUntil(function () { return updated.textContent.indexOf('未找到该城市或地区') >= 0 && !search.disabled; });
      const failure = {
        status: updated.textContent,
        city: document.getElementById('lf-weather-city').textContent,
        label: label.textContent,
        savedCity: localStorage.getItem('lumifield-weather-city'),
      };
      return { composingRequests, duplicateRequests, totalRequests:calls.length, enterPrevented, first, race, failure };
    } finally {
      window.fetch = originalFetch;
    }
  });
  pass('weather Enter, IME, request de-duplication, stale response and accurate failure state work in Electron',
    weatherInteraction.composingRequests === 0 && weatherInteraction.duplicateRequests === 1 &&
    weatherInteraction.totalRequests === 4 && weatherInteraction.enterPrevented &&
    weatherInteraction.first.city === '杭州' && weatherInteraction.first.label === '中雨' &&
    weatherInteraction.first.details.includes('湿度 68%') && weatherInteraction.first.details.includes('东风 12 km/h') &&
    weatherInteraction.first.savedCity === '杭州' &&
    weatherInteraction.race.city === '上海' && weatherInteraction.race.label === '晴' && weatherInteraction.race.savedCity === '上海' &&
    weatherInteraction.failure.status.includes('未找到该城市或地区') &&
    weatherInteraction.failure.city === '上海' && weatherInteraction.failure.label === '晴' && weatherInteraction.failure.savedCity === '上海',
    weatherInteraction);
  const hotCommentSvgGlass = /url\(/i.test(hotEmpty.glass.backdrop) &&
    hotEmpty.glass.filterId === 'lumifield-control-glass-filter' && hotEmpty.glass.displacementScales.length >= 3 &&
    new Set(hotEmpty.glass.displacementScales).size >= 3 && hotEmpty.glass.channelMatrices >= 3;
  const hotCommentNestedGlass = hotEmpty.glass.owner === 'weather-shell' && hotEmpty.glass.ownerMarker === 'weather' &&
    /blur|url\(/i.test(hotEmpty.glass.backdrop);
  pass('hot-comment uses unified liquid glass without fake RGB dots', hotEmpty.glass.svgEnabled &&
    (hotCommentSvgGlass || hotCommentNestedGlass) &&
    hotEmpty.glass.backgroundAlpha < 0.8 && hotEmpty.glass.edgeHighlight && hotEmpty.glass.fakeRgbDots === 0 &&
    !hotEmpty.glass.fakeRepeatingDots && hotEmpty.glass.dynamicPointer && hotEmpty.glass.chromaAnimation !== 'none', hotEmpty.glass);
  await screenshot('04-hot-comment-real-empty-state');

  const longHotComment = '这是一条用于验证热评多行布局与完整展开能力的长评论。'.repeat(12);
  const hotInvocation = await cdp.call(async function (longText) {
    const state = LumiFieldHotCommentCard.state;
    const oldQueue = window.queueSong;
    const oldPlay = window.playQueueAt;
    const calls = [];
    window.queueSong = function (song, options) { calls.push({ type: 'queue', song: song.name, position: options.position }); return 7; };
    window.playQueueAt = function (index) { calls.push({ type: 'play', index }); return Promise.resolve(true); };
    state.items = [
      { provider: 'netease', content: 'fixture A', likedCount: 1, time: Date.now(), user: { nickname: 'A' }, song: { id: 'a', name: 'Fixture A', artist: 'Artist A', provider: 'netease' } },
      { provider: 'qq', content: longText, likedCount: 27, time: Date.now(), user: { nickname: 'Fixture User' }, song: { id: 'b', name: 'Fixture B', artist: 'Artist B', provider: 'qq' } },
    ];
    state.groups = [
      { key:'netease:a', provider:'netease', song:state.items[0].song, comments:[state.items[0]] },
      { key:'qq:b', provider:'qq', song:state.items[1].song, comments:[state.items[1]] },
    ];
    state.sequence = state.items.map(function (comment, index) {
      return { comment:comment, songIndex:index, songTotal:2, commentIndex:0, commentTotal:1 };
    });
    state.index = 0;
    state.paused = false;
    LumiFieldHotCommentCard.next();
    state.paused = true;
    await new Promise(resolve => setTimeout(resolve, 300));
    await new Promise(resolve => requestAnimationFrame(function () { requestAnimationFrame(resolve); }));
    const card = document.getElementById('lf-hot-comment-card');
    const shell = document.querySelector('.lf-weather-shell');
    const text = card.querySelector('.lf-hot-comment-text');
    const expand = card.querySelector('.lf-hot-comment-expand');
    const rect = function (node) {
      const value = node.getBoundingClientRect();
      return { left:value.left, right:value.right, top:value.top, bottom:value.bottom, width:value.width, height:value.height };
    };
    const containsRect = function (outer, inner) {
      return inner.width > 0 && inner.height > 0 && inner.left >= outer.left - 1 && inner.right <= outer.right + 1 && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
    };
    const cardRect = rect(card);
    const visibleFieldSelectors = ['.lf-hot-comment-content','.lf-hot-comment-cover-wrap','.lf-hot-comment-main','.lf-hot-comment-heading',
      '.lf-hot-comment-platform','.lf-hot-comment-song','.lf-hot-comment-artist','.lf-hot-comment-text','.lf-hot-comment-expand',
      '.lf-hot-comment-meta','.lf-hot-comment-avatar-wrap','.lf-hot-comment-user-name','.lf-hot-comment-date','.lf-hot-comment-likes','.lf-hot-comment-play'];
    const fields = visibleFieldSelectors.map(function (selector) {
      const node = card.querySelector(selector), value = node && rect(node);
      return { selector:selector, inside:!!(node && containsRect(cardRect, value)), hidden:!node || node.hidden || getComputedStyle(node).display === 'none' };
    });
    const collapsedStyle = getComputedStyle(text);
    const collapsed = {
      height: text.clientHeight,
      scrollHeight: text.scrollHeight,
      lineClamp: Number(collapsedStyle.webkitLineClamp || 0),
      overflow: collapsedStyle.overflowY,
      buttonVisible: !expand.hidden,
      ariaExpanded: expand.getAttribute('aria-expanded'),
    };
    expand.click();
    await new Promise(resolve => setTimeout(resolve, 40));
    const expandedStyle = getComputedStyle(text);
    text.scrollTop = text.scrollHeight;
    const expandedCardRect = rect(card), expandedShellRect = rect(shell);
    const expanded = {
      cardClass: card.classList.contains('expanded'),
      height: text.clientHeight,
      scrollHeight: text.scrollHeight,
      overflow: expandedStyle.overflowY,
      scrollTop: text.scrollTop,
      ariaExpanded: expand.getAttribute('aria-expanded'),
      textInsideCard: containsRect(expandedCardRect, rect(text)),
      cardInsideShell: containsRect(expandedShellRect, expandedCardRect),
    };
    expand.click();
    await new Promise(resolve => setTimeout(resolve, 20));
    const collapsedAgain = !card.classList.contains('expanded') && expand.getAttribute('aria-expanded') === 'false';
    const play = card.querySelector('.lf-hot-comment-play');
    const playRect = rect(play);
    const playHit = document.elementFromPoint(playRect.left + playRect.width / 2, playRect.top + playRect.height / 2);
    const playCenterHit = {
      insideCard: !!(playHit && card.contains(playHit)),
      insideButton: !!(playHit && play.contains(playHit)),
      tag: playHit && playHit.tagName || '',
      className: playHit && typeof playHit.className === 'string' ? playHit.className : '',
    };
    const rendered = {
      platform: card.querySelector('.lf-hot-comment-platform').textContent,
      song: card.querySelector('.lf-hot-comment-song').textContent,
      artist: card.querySelector('.lf-hot-comment-artist').textContent,
      comment: card.querySelector('.lf-hot-comment-text').textContent,
      user: card.querySelector('.lf-hot-comment-user-name').textContent,
      date: card.querySelector('.lf-hot-comment-date').textContent,
      likes: card.querySelector('.lf-hot-comment-likes').textContent,
      playEnabled: !play.disabled,
    };
    play.click();
    await new Promise(resolve => setTimeout(resolve, 20));
    window.queueSong = oldQueue;
    window.playQueueAt = oldPlay;
    expand.click();
    await new Promise(resolve => setTimeout(resolve, 40));
    text.scrollTop = 0;
    const evidenceExpanded = card.classList.contains('expanded');
    state.paused = false;
    return { rendered, calls, fields, collapsed, expanded, collapsedAgain, playCenterHit, evidenceExpanded };
  }, [longHotComment]);
  pass('hot-comment fields remain fully inside the card', hotInvocation.fields.every(item =>
    item.selector === '.lf-hot-comment-expand' ? (item.hidden || item.inside) : (item.inside && !item.hidden)), hotInvocation.fields);
  pass('long hot comment supports multi-line collapse and complete expansion', hotInvocation.collapsed.lineClamp >= 2 &&
    hotInvocation.collapsed.scrollHeight > hotInvocation.collapsed.height && hotInvocation.collapsed.buttonVisible &&
    hotInvocation.collapsed.ariaExpanded === 'false' && hotInvocation.expanded.cardClass &&
    hotInvocation.expanded.ariaExpanded === 'true' && hotInvocation.expanded.height > hotInvocation.collapsed.height &&
    hotInvocation.expanded.scrollHeight >= hotInvocation.expanded.height && hotInvocation.expanded.overflow === 'auto' &&
    (hotInvocation.expanded.scrollHeight <= hotInvocation.expanded.height + 1 || hotInvocation.expanded.scrollTop > 0) &&
    hotInvocation.expanded.textInsideCard && hotInvocation.expanded.cardInsideShell && hotInvocation.collapsedAgain, {
    collapsed: hotInvocation.collapsed,
    expanded: hotInvocation.expanded,
    collapsedAgain: hotInvocation.collapsedAgain,
  });
  pass('hot-comment deterministic playback wiring contract', hotInvocation.rendered.platform === 'QQ音乐' &&
    hotInvocation.rendered.song === 'Fixture B' && hotInvocation.rendered.artist === 'Artist B' &&
    hotInvocation.rendered.comment === longHotComment && hotInvocation.rendered.user === 'Fixture User' &&
    hotInvocation.rendered.date && hotInvocation.rendered.likes === '27赞' && hotInvocation.rendered.playEnabled &&
    hotInvocation.playCenterHit.insideCard && hotInvocation.playCenterHit.insideButton && hotInvocation.evidenceExpanded &&
    hotInvocation.calls.length === 2 && hotInvocation.calls[0].position === 'next' && hotInvocation.calls[1].index === 7, hotInvocation);
  await screenshot('04b-hot-comment-long-fixture');
  await cdp.call(async function () {
    const state = LumiFieldHotCommentCard.state;
    state.groups = [];
    state.items = [];
    state.sequence = [];
    state.index = 0;
    state.lastRefresh = 0;
    await LumiFieldHotCommentCard.refresh();
  });

  const runtimeApis = await testRuntimeApis(origin);

  const audioTools = await cdp.call(async function () {
    if (window.audio && window.audio.paused) {
      try { await window.audio.play(); } catch (_) {}
    }
    const speed = LFAudioControls.setSpeed(1.5);
    const pitch = await LFAudioControls.setPitch(3);
    const status = LFAudioControls.status();
    return {
      speed,
      pitch,
      status,
      playbackRate: window.audio && window.audio.playbackRate,
      preservesPitch: window.audio && window.audio.preservesPitch,
      implementation: window.LFAudioTools && window.LFAudioTools.implementation,
      controls: {
        speedMin: document.getElementById('lf-audio-speed').min,
        speedMax: document.getElementById('lf-audio-speed').max,
        pitchMin: document.getElementById('lf-audio-pitch').min,
        pitchMax: document.getElementById('lf-audio-pitch').max,
        presets: Array.from(document.querySelectorAll('#lf-audio-tool-panel [data-speed]')).map(node => Number(node.dataset.speed)),
        karaokeToggle: !!document.getElementById('lf-karaoke-enabled'),
        balance: { min: document.getElementById('lf-karaoke-balance').min, max: document.getElementById('lf-karaoke-balance').max },
        visibleText: document.getElementById('lf-audio-tool-panel').innerText,
      },
    };
  });
  pass('speed, independent pitch and direct accompaniment controls', audioTools.speed.ok && audioTools.pitch.ok &&
    audioTools.status.speed === 1.5 && audioTools.status.pitch === 3 && Math.abs(audioTools.playbackRate - 1.5) < 0.01 &&
    audioTools.preservesPitch === true && /AudioWorklet/i.test(audioTools.implementation.pitch) &&
    audioTools.controls.speedMin === '0.5' && audioTools.controls.speedMax === '2' &&
    audioTools.controls.pitchMin === '-12' && audioTools.controls.pitchMax === '12' &&
    JSON.stringify(audioTools.controls.presets) === JSON.stringify([0.5, 0.75, 1, 1.25, 1.5, 2]) &&
    audioTools.controls.karaokeToggle && audioTools.controls.balance.min === '-1' && audioTools.controls.balance.max === '1' &&
    !/本地\s*AI|Demucs|MDX|Stem|BLOCKED|授权|选择本地音频|分离当前歌曲/.test(audioTools.controls.visibleText), audioTools);
  await cdp.call(async function () { await LFAudioControls.setPitch(0); LFAudioControls.setSpeed(1); });

  await cdp.call(async function () {
    if (typeof window.dismissHomePage === 'function') window.dismissHomePage({ reason: 'ui-smoke' });
    window.emptyHomeActive = false;
    window.homeForcedOpen = false;
    document.body.classList.remove('empty-home-active');
    const lines = [
      { t: 0, text: 'Hello luminous world', translation: '你好，明亮世界', duration: 1.8 },
      { t: 1.8, text: 'Music moves through space', translation: '音乐穿行于空间', duration: 2.1 },
      { t: 3.9, text: 'Every color follows sound', translation: '每种色彩都跟随声音', duration: 2.1 },
    ];
    if (typeof window.applyLyricsState === 'function') window.applyLyricsState(lines, false, 'ui-smoke');
    else window.lyricsLines = lines;
    window.playing = true;
    if (window.fx) window.fx.particleLyrics = true;
    if (window.audio) {
      window.audio.currentTime = 0.6;
      try { await window.audio.play(); } catch (_) {}
    }
    if (typeof window.tickLyricsParticles === 'function') window.tickLyricsParticles();
  });
  await pageWait(function () {
    return typeof window.isVisualStageInteractionActive === 'function' && window.isVisualStageInteractionActive() &&
      window.LumiFieldTask13 && document.getElementById('lf-t13-console');
  }, [], 15000);

  await cdp.call(function () {
    if (typeof window.closeLocalBeatModal === 'function') window.closeLocalBeatModal();
    const modal = document.getElementById('local-beat-modal');
    if (modal) modal.classList.remove('show', 'active');
    window.scrollTo(0, 0);
  });
  await delay(350);
  await physicalClick('#fx-fab');
  await pageWait(function () {
    const node = document.getElementById('fx-panel');
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    return node.classList.contains('show') && Number(style.opacity) > 0.95 && style.filter === 'none' &&
      innerWidth - box.right < 45;
  }, [], 4000);
  const panel = await cdp.call(function () {
    const node = document.getElementById('fx-panel');
    const box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      rect: { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height },
      viewport: { width: innerWidth, height: innerHeight },
      rightGap: innerWidth - box.right,
      filter: style.filter,
      opacity: style.opacity,
      pointerEvents: style.pointerEvents,
      overflowY: style.overflowY,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      hitInside: !!(hit && node.contains(hit)),
      scrollTop: node.scrollTop,
    };
  });
  pass('visual console clear clickable and scrollable', panel.rightGap < 45 && panel.filter === 'none' &&
    Number(panel.opacity) > 0.95 && panel.pointerEvents === 'auto' && panel.scrollHeight > panel.clientHeight && panel.hitInside, panel);
  const task13ConsoleContract = await cdp.call(async function () {
    const panel = document.getElementById('fx-panel');
    const consoles = Array.from(document.querySelectorAll('#lf-t13-console'));
    const consoleRoot = consoles[0];
    const presetsPage = panel.querySelector('.fx-tab-page[data-fx-page="presets"]');
    const lyricsPage = panel.querySelector('.fx-tab-page[data-fx-page="lyrics"]');
    const lyricBlock = document.getElementById('lf-t13-lyric-block');
    const archive = document.getElementById('user-archive-grid');
    const visible = function (node) {
      if (!node) return false;
      const box = node.getBoundingClientRect();
      return node.getClientRects().length > 0 && box.width > 0 && box.height > 0;
    };
    window.setFxPanelTab('presets');
    await new Promise(resolve => requestAnimationFrame(resolve));
    const presetVisible = visible(consoleRoot);
    const blocks = consoleRoot ? Array.from(consoleRoot.children).filter(function (node) { return node.classList.contains('lf-t13-block'); }) : [];
    const hiddenOutsidePresets = [];
    for (const tab of ['appearance', 'lyrics', 'motion', 'advanced']) {
      window.setFxPanelTab(tab);
      await new Promise(resolve => requestAnimationFrame(resolve));
      const activePage = panel.querySelector('.fx-tab-page.active');
      hiddenOutsidePresets.push({ tab:tab, visible:visible(consoleRoot), activePage:activePage && activePage.dataset.fxPage || '' });
    }
    window.setFxPanelTab('presets');
    await new Promise(resolve => requestAnimationFrame(resolve));
    const state = window.LumiFieldTask13.getState();
    const echoCameraKeys = consoleRoot ? Array.from(consoleRoot.querySelectorAll('[data-lf-scope="echo"][data-lf-key]'))
      .map(function (node) { return node.dataset.lfKey; })
      .filter(function (key) { return /^(cameraDistance|cameraHorizontal|cameraElevation|autoRotate|rotateSpeed)$/.test(key); }).sort() : [];
    return {
      count: consoles.length,
      parentIsPresets: !!(consoleRoot && consoleRoot.parentElement === presetsPage),
      immediatelyAfterArchive: !!(archive && archive.nextElementSibling === consoleRoot),
      presetVisible: presetVisible,
      blockIds: blocks.map(function (node) { return node.id; }),
      blockLabels: blocks.map(function (node) { const title = node.querySelector('summary span'); return title && title.textContent || ''; }),
      lyricCount: document.querySelectorAll('#lf-t13-lyric-block').length,
      lyricInLyricsPage: !!(lyricBlock && lyricBlock.parentElement === lyricsPage),
      lyricInPresets: document.querySelectorAll('.fx-tab-page[data-fx-page="presets"] #lf-t13-lyric-block').length,
      lyricLabel: lyricBlock ? ((lyricBlock.querySelector('summary span') || {}).textContent || '') : '',
      hiddenOutsidePresets: hiddenOutsidePresets,
      panoramaText: !!(consoleRoot && /全景/.test(consoleRoot.textContent)),
      cameraDom: document.querySelectorAll('#lf-t13-console [data-lf-scope="camera"],#lf-t13-camera-block,#lf-t13-camera-reset,#lf-t13-console [id^="lf-t13-camera"]').length,
      cameraScopes: document.querySelectorAll('[data-lf-scope="camera"]').length,
      apiHasCamera: !!(state && Object.prototype.hasOwnProperty.call(state, 'camera')),
      echoCameraKeys: echoCameraKeys,
      echoStateHasCamera: !!(state && state.echo && ['cameraDistance','cameraHorizontal','cameraElevation','autoRotate','rotateSpeed'].every(function (key) { return Object.prototype.hasOwnProperty.call(state.echo, key); })),
    };
  });
  pass('task13 console is unique; translation is in Lyrics while spectrum and echo remain in Presets', task13ConsoleContract.count === 1 &&
    task13ConsoleContract.parentIsPresets && task13ConsoleContract.immediatelyAfterArchive && task13ConsoleContract.presetVisible &&
    JSON.stringify(task13ConsoleContract.blockIds) === JSON.stringify(['lf-t13-spectrum-block','lf-t13-echo-block']) &&
    JSON.stringify(task13ConsoleContract.blockLabels) === JSON.stringify(['实时音频频谱','音域回响']) &&
    task13ConsoleContract.lyricCount === 1 && task13ConsoleContract.lyricInLyricsPage &&
    task13ConsoleContract.lyricInPresets === 0 && task13ConsoleContract.lyricLabel === '歌词翻译' &&
    task13ConsoleContract.hiddenOutsidePresets.every(item => !item.visible && item.activePage === item.tab), task13ConsoleContract);
  pass('task13 removes panorama controls while preserving echo internal camera', !task13ConsoleContract.panoramaText &&
    task13ConsoleContract.cameraDom === 0 && task13ConsoleContract.cameraScopes === 0 && !task13ConsoleContract.apiHasCamera &&
    JSON.stringify(task13ConsoleContract.echoCameraKeys) === JSON.stringify(['autoRotate','cameraDistance','cameraElevation','cameraHorizontal','rotateSpeed']) &&
    task13ConsoleContract.echoStateHasCamera, task13ConsoleContract);
  const panelPoint = { x: panel.rect.left + panel.rect.width / 2, y: panel.rect.top + panel.rect.height * 0.72 };
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: panelPoint.x, y: panelPoint.y });
  await cdp.send('Input.synthesizeScrollGesture', {
    x: panelPoint.x,
    y: panelPoint.y,
    yDistance: -1000,
    speed: 1200,
    gestureSourceType: 'mouse',
  });
  await delay(450);
  const physicalScroll = await cdp.call(function () { return document.getElementById('fx-panel').scrollTop; });
  pass('visual console physical wheel scroll', physicalScroll > 100, { before: panel.scrollTop, after: physicalScroll });

  await cdp.call(function () {
    const checkbox = document.querySelector('[data-lf-scope="lyrics"][data-lf-key="translate"]');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof window.tickLyricsParticles === 'function') window.tickLyricsParticles();
  });
  await pageWait(function () {
    const current = window.stageLyrics && window.stageLyrics.current;
    const data = current && current.userData && current.userData.lyric;
    return LumiFieldTask13.getState().lyrics.translate === true && !!(data && data.translationMesh);
  });
  const normalLyrics = await cdp.call(function () {
    const current = window.stageLyrics && window.stageLyrics.current;
    const data = current && current.userData && current.userData.lyric || {};
    return {
      translateEnabled: LumiFieldTask13.getState().lyrics.translate,
      retiredRootCount: document.querySelectorAll('#lf-t13-lyrics').length,
      retiredModeControlCount: document.querySelectorAll('[data-lf-lyric-mode]').length,
      text: window.stageLyrics && window.stageLyrics.currentText || '',
      translation: data.translationText || '',
      nativeVisible: !window.stageLyrics || !window.stageLyrics.current || window.stageLyrics.current.visible,
      sameLineGroup: !!(current && current.userData.lyricLineGroup && data.textMesh && data.translationMesh &&
        data.textMesh.parent === current && data.translationMesh.parent === current),
      translationBelow: Number(data.translationLocalY) < 0,
      timelineIndex: current && current.userData.lyricTimelineIndex,
      stageIndex: window.stageLyrics && window.stageLyrics.currentIdx,
      hasFixedTranslationOverlay: !!document.querySelector('.lf-t13-normal-translation'),
    };
  });
  const lyricTransformSync = await cdp.call(async function () {
    const previous = {
      scale: window.fx.lyricScale, x: window.fx.lyricOffsetX, y: window.fx.lyricOffsetY,
      tiltX: window.fx.lyricTiltX, tiltY: window.fx.lyricTiltY,
    };
    const set = function (id, value) {
      const input = document.getElementById(id);
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const before = window.stageLyrics.current.userData.lyric.translationMesh.position.y;
    set('fx-lyricscale', 1.23);
    set('fx-lyricx', 0.58);
    set('fx-lyricy', -0.24);
    set('fx-lyrictiltx', 18);
    set('fx-lyrictilty', -14);
    await new Promise(resolve => setTimeout(resolve, 420));
    const current = window.stageLyrics.current;
    const data = current.userData.lyric;
    current.updateMatrixWorld(true);
    data.translationMesh.updateMatrixWorld(true);
    const world = new THREE.Vector3();
    data.translationMesh.getWorldPosition(world);
    const expectedLocal = data.translationMesh.position.clone();
    const recoveredLocal = current.worldToLocal(world.clone());
    const result = {
      commonParent: data.textMesh.parent === current && data.translationMesh.parent === current,
      localOffsetStable: Math.abs(before - data.translationMesh.position.y) < 1e-7,
      matrixRoundTrip: recoveredLocal.distanceTo(expectedLocal) < 1e-5,
      backFaceUvCorrected: /gl_FrontFacing/.test(data.translationMat.fragmentShader || ''),
      controls: {
        scale: window.fx.lyricScale, x: window.fx.lyricOffsetX, y: window.fx.lyricOffsetY,
        tiltX: window.fx.lyricTiltX, tiltY: window.fx.lyricTiltY,
      },
    };
    set('fx-lyricscale', previous.scale);
    set('fx-lyricx', previous.x);
    set('fx-lyricy', previous.y);
    set('fx-lyrictiltx', previous.tiltX);
    set('fx-lyrictilty', previous.tiltY);
    return result;
  });
  pass('original lyric translation shares one 3D line group and stage transform', normalLyrics.sameLineGroup &&
    normalLyrics.translationBelow && normalLyrics.timelineIndex === normalLyrics.stageIndex &&
    normalLyrics.translateEnabled && normalLyrics.retiredRootCount === 0 && normalLyrics.retiredModeControlCount === 0 &&
    !normalLyrics.hasFixedTranslationOverlay && lyricTransformSync.commonParent &&
    lyricTransformSync.localOffsetStable && lyricTransformSync.matrixRoundTrip && lyricTransformSync.backFaceUvCorrected &&
    lyricTransformSync.controls.scale === 1.23 && lyricTransformSync.controls.x === 0.58 &&
    lyricTransformSync.controls.y === -0.24 && lyricTransformSync.controls.tiltX === 18 &&
    lyricTransformSync.controls.tiltY === -14, { normalLyrics, lyricTransformSync });

  await screenshot('05-original-lyrics-translation-stage');

  const tenSongLyricSwitches = await cdp.call(async function () {
    const previousPlaying = window.playing;
    const previousQueue = window.playQueue;
    const previousIndex = window.currentIdx;
    const previousAudio = window.audio;
    const results = [];
    const sampleRate = 8000;
    const sampleCount = sampleRate * 8;
    const buffer = new ArrayBuffer(44 + sampleCount * 2);
    const view = new DataView(buffer);
    function ascii(offset, value) { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); }
    ascii(0, 'RIFF'); view.setUint32(4, 36 + sampleCount * 2, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    ascii(36, 'data'); view.setUint32(40, sampleCount * 2, true);
    for (let i = 0; i < sampleCount; i += 1) view.setInt16(44 + i * 2, Math.round(Math.sin(i / sampleRate * Math.PI * 2 * 220) * 700), true);
    const fixtureUrl = URL.createObjectURL(new Blob([buffer], { type:'audio/wav' }));
    const fixtureAudio = new Audio(fixtureUrl);
    fixtureAudio.loop = true;
    await new Promise(function (resolve, reject) {
      const timer = setTimeout(function () { reject(new Error('UI_SMOKE_LYRIC_AUDIO_LOAD_TIMEOUT')); }, 5000);
      fixtureAudio.addEventListener('canplaythrough', function () { clearTimeout(timer); resolve(); }, { once:true });
      fixtureAudio.addEventListener('error', function () { clearTimeout(timer); reject(new Error('UI_SMOKE_LYRIC_AUDIO_LOAD_FAILED')); }, { once:true });
      fixtureAudio.load();
    });
    window.audio = fixtureAudio;
    fixtureAudio.currentTime = 0.2;
    await fixtureAudio.play();
    window.playing = true;
    window.lumiFieldNativeLyricTranslationEnabled = true;
    for (let i = 0; i < 10; i += 1) {
      const original = 'Switch original ' + i;
      const translation = '切换译文 ' + i;
      window.playQueue = [{ provider: 'ui-smoke', id: 'p2-song-' + i, name: 'P2 Song ' + i, artist: 'P2 Artist ' + i }];
      window.currentIdx = 0;
      window.applyLyricsState([{ t: 0, duration: 2, text: original, translation }], false, 'ui-smoke-switch-' + i);
      window.audio.currentTime = 0.2;
      window.tickLyricsParticles();
      const current = window.stageLyrics.current;
      const data = current && current.userData && current.userData.lyric || {};
      results.push({
        original: window.stageLyrics.currentText,
        translation: data.translationText || '',
        outgoing: window.stageLyrics.outgoing.length,
        grouped: !!(current && data.translationMesh && data.translationMesh.parent === current),
        songId: window.playQueue[window.currentIdx].id,
      });
    }
    window.playQueue = [{ provider: 'ui-smoke', id: 'p2-intro', name: 'Intro Song', artist: 'Intro Artist' }];
    window.currentIdx = 0;
    window.applyLyricsState([{ t: 2, duration: 2, text: 'Delayed original', translation: '延迟译文' }], false, 'ui-smoke-intro');
    window.audio.currentTime = 0.25;
    window.tickLyricsParticles();
    const introData = window.stageLyrics.current && window.stageLyrics.current.userData && window.stageLyrics.current.userData.lyric || {};
    const intro = {
      index: window.stageLyrics.currentIdx,
      text: window.stageLyrics.currentText,
      translation: introData.translationText || '',
      hasTranslationMesh: !!introData.translationMesh,
    };
    fixtureAudio.pause();
    URL.revokeObjectURL(fixtureUrl);
    window.audio = previousAudio;
    window.playQueue = previousQueue;
    window.currentIdx = previousIndex;
    window.playing = previousPlaying;
    window.applyLyricsState([
      { t: 0, text: 'Hello luminous world', translation: '你好，明亮世界', duration: 1.8 },
      { t: 1.8, text: 'Music moves through space', translation: '音乐穿行于空间', duration: 2.1 },
      { t: 3.9, text: 'Every color follows sound', translation: '每种色彩都跟随声音', duration: 2.1 },
    ], false, 'ui-smoke');
    window.audio.currentTime = 0.6;
    window.tickLyricsParticles();
    return { audioReady: !fixtureAudio.error, switches: results, intro };
  });
  pass('ten song switches clear old original translations', tenSongLyricSwitches.audioReady && tenSongLyricSwitches.switches.length === 10 &&
    tenSongLyricSwitches.switches.every((item, index) => item.original === 'Switch original ' + index &&
      item.translation === '切换译文 ' + index && item.outgoing === 0 && item.grouped && item.songId === 'p2-song-' + index) &&
    tenSongLyricSwitches.intro && tenSongLyricSwitches.intro.index === -2 &&
    tenSongLyricSwitches.intro.translation === '' && !tenSongLyricSwitches.intro.hasTranslationMesh,
    tenSongLyricSwitches);
  const retiredLyricMode = await cdp.call(function () {
    let rejected = false;
    try { LumiFieldTask13.setLyricState({ mode:'animation' }); } catch (_) { rejected = true; }
    const state = LumiFieldTask13.getState().lyrics;
    return {
      rejected:rejected,
      keys:Object.keys(state).sort(),
      translate:state.translate,
      retiredRootCount:document.querySelectorAll('#lf-t13-lyrics').length,
      retiredModeControlCount:document.querySelectorAll('[data-lf-lyric-mode]').length,
    };
  });
  pass('retired duplicate lyric mode cannot be restored', retiredLyricMode.rejected &&
    JSON.stringify(retiredLyricMode.keys) === JSON.stringify(['translate']) && retiredLyricMode.translate === true &&
    retiredLyricMode.retiredRootCount === 0 && retiredLyricMode.retiredModeControlCount === 0, retiredLyricMode);

  await cdp.call(async function () {
    window.__lfSmokePlaying = window.playing;
    window.__lfSmokeAudio = window.audio;
    window.__lfSmokeAnalyserGetByteFrequencyData = window.analyser && window.analyser.getByteFrequencyData;
    const sampleRate = 8000;
    const sampleCount = sampleRate * 12;
    const buffer = new ArrayBuffer(44 + sampleCount * 2);
    const view = new DataView(buffer);
    function ascii(offset, value) { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); }
    ascii(0, 'RIFF'); view.setUint32(4, 36 + sampleCount * 2, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    ascii(36, 'data'); view.setUint32(40, sampleCount * 2, true);
    for (let i = 0; i < sampleCount; i += 1) {
      const time = i / sampleRate;
      const sample = Math.sin(time * Math.PI * 2 * 110) * 900 + Math.sin(time * Math.PI * 2 * 440) * 420;
      view.setInt16(44 + i * 2, Math.round(sample), true);
    }
    const fixtureUrl = URL.createObjectURL(new Blob([buffer], { type:'audio/wav' }));
    const fixtureAudio = new Audio(fixtureUrl);
    fixtureAudio.loop = true;
    await new Promise(function (resolve, reject) {
      const timer = setTimeout(function () { reject(new Error('UI_SMOKE_SPECTRUM_AUDIO_LOAD_TIMEOUT')); }, 5000);
      fixtureAudio.addEventListener('canplaythrough', function () { clearTimeout(timer); resolve(); }, { once:true });
      fixtureAudio.addEventListener('error', function () { clearTimeout(timer); reject(new Error('UI_SMOKE_SPECTRUM_AUDIO_LOAD_FAILED')); }, { once:true });
      fixtureAudio.load();
    });
    window.__lfSmokeSpectrumAudio = fixtureAudio;
    window.__lfSmokeSpectrumAudioUrl = fixtureUrl;
    window.__lfSmokeSpectrumPattern = 'initial';
    window.audio = fixtureAudio;
    await fixtureAudio.play();
    window.playing = true;
    if (window.analyser && typeof window.analyser.getByteFrequencyData === 'function') {
      window.analyser.getByteFrequencyData = function (target) {
        for (let i = 0; i < target.length; i += 1) {
          if (window.__lfSmokeSpectrumPattern === 'zero') target[i] = 0;
          else if (window.__lfSmokeSpectrumPattern === 'live') target[i] = 35 + Math.round(215 * Math.abs(Math.sin(i * 0.137)));
          else if (window.__lfSmokeSpectrumPattern === 'after') target[i] = 90 + Math.round(150 * Math.abs(Math.cos(i * 0.071)));
          else target[i] = Math.max(8, Math.round(235 * (0.22 + 0.78 * Math.abs(Math.sin(i * 0.083)))));
        }
        window.lumiFieldFrequencyDataTimestamp = performance.now();
      };
    }
    if (window.frequencyData && window.frequencyData.length) {
      for (let i = 0; i < window.frequencyData.length; i += 1) {
        window.frequencyData[i] = Math.max(8, Math.round(235 * (0.22 + 0.78 * Math.abs(Math.sin(i * 0.083)))));
      }
      window.lumiFieldFrequencyDataTimestamp = performance.now();
    }
    const set = function (scope, key, value) {
      const input = document.querySelector('[data-lf-scope="' + scope + '"][data-lf-key="' + key + '"]');
      if (input.type === 'checkbox') input.checked = !!value;
      else input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('spectrum', 'enabled', true);
    set('spectrum', 'bandCount', 52);
    set('spectrum', 'horizontalGap', 3);
    set('spectrum', 'heightScale', 1.35);
    set('spectrum', 'brightness', 1.35);
    set('spectrum', 'opacity', 0.84);
    set('spectrum', 'attack', 0.9);
    set('spectrum', 'release', 0.25);
  });

  async function spectrumMode(mode) {
    await cdp.call(function (value) {
      document.querySelector('[data-lf-spectrum-mode="' + value + '"]').click();
    }, [mode]);
    await driveSpectrum('initial', false, 420);
    return cdp.call(function () {
      const canvas = document.getElementById('lf-t13-spectrum');
      const sample = document.createElement('canvas');
      sample.width = Math.max(1, Math.round(canvas.width / 4));
      sample.height = Math.max(1, Math.round(canvas.height / 4));
      const context = sample.getContext('2d', { willReadFrequently: true });
      context.drawImage(canvas, 0, 0, sample.width, sample.height);
      const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
      let nonzero = 0;
      let alpha = 0;
      let hash = 2166136261 >>> 0;
      let minY = sample.height;
      let maxY = -1;
      for (let y = 0; y < sample.height; y += 2) {
        for (let x = 0; x < sample.width; x += 2) {
          const index = (y * sample.width + x) * 4;
          const value = pixels[index + 3];
          if (value) {
            nonzero += 1;
            alpha += value;
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
          hash ^= pixels[index] + pixels[index + 1] * 3 + pixels[index + 2] * 7 + value * 11;
          hash = Math.imul(hash, 16777619) >>> 0;
        }
      }
      const style = getComputedStyle(canvas);
      return {
        active: canvas.classList.contains('active'),
        width: sample.width,
        height: sample.height,
        nonzero,
        alpha,
        hash,
        minY,
        maxY,
        pointerEvents: style.pointerEvents,
        zIndex: Number(style.zIndex || 0),
        state: LumiFieldTask13.getState().spectrum,
        debug: LumiFieldTask13.getSpectrumDebug(),
      };
    });
  }

  async function driveSpectrum(pattern, seeking, waitMs) {
    await cdp.call(async function (nextPattern, nextSeeking) {
      window.__lfSmokeSpectrumPattern = nextPattern;
      window.lumiFieldSeekingAudio = nextSeeking;
      if (nextPattern === 'zero') {
        if (window.audio) window.audio.pause();
        window.playing = false;
      } else {
        if (window.audio) {
          try { await window.audio.play(); } catch (_) {}
        }
        window.playing = true;
      }
    }, [pattern, seeking]);
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await cdp.call(function () {
        const target = window.frequencyData;
        if (target) {
          for (let i = 0; i < target.length; i += 1) {
            if (window.__lfSmokeSpectrumPattern === 'zero') target[i] = 0;
            else if (window.__lfSmokeSpectrumPattern === 'live') target[i] = 35 + Math.round(215 * Math.abs(Math.sin(i * 0.137)));
            else if (window.__lfSmokeSpectrumPattern === 'after') target[i] = 90 + Math.round(150 * Math.abs(Math.cos(i * 0.071)));
            else target[i] = Math.max(8, Math.round(235 * (0.22 + 0.78 * Math.abs(Math.sin(i * 0.083)))));
          }
          window.lumiFieldFrequencyDataTimestamp = window.__lfSmokeSpectrumPattern === 'zero' ? 0 : performance.now();
        }
        if (window.LumiFieldTask13) window.LumiFieldTask13.updateFrame(performance.now(), 1 / 60);
      });
      await delay(34);
    }
  }

  const spectrumOne = await spectrumMode(1);
  const spectrumPointerPoints = await cdp.call(function () {
    window.__lfSmokeSpectrumShelfQueue = window.playQueue;
    window.__lfSmokeSpectrumShelfIndex = window.currentIdx;
    window.playQueue = Array.from({ length:5 }, function (_, index) {
      return { provider:'ui-smoke', id:'spectrum-shelf-' + index, name:'Spectrum Shelf ' + index, artist:'LumiField QA' };
    });
    window.currentIdx = 0;
    if (window.shelfManager && window.shelfManager.rebuild) window.shelfManager.rebuild(false);
    if (typeof window.toggleFxPanel === 'function') window.toggleFxPanel(false);
    var panel = document.getElementById('fx-panel');
    if (panel) panel.classList.remove('show', 'peek', 'closing');
    document.body.classList.remove('lf-fx-open');
    var canvas = window.renderer && window.renderer.domElement;
    var candidates = [];
    [0.18, 0.24, 0.30, 0.36, 0.42].forEach(function (yRatio) {
      [0.16, 0.22, 0.28, 0.34].forEach(function (xRatio) { candidates.push({ side:'left', x:innerWidth*xRatio, y:innerHeight*yRatio }); });
      [0.84, 0.78, 0.72, 0.66].forEach(function (xRatio) { candidates.push({ side:'right', x:innerWidth*xRatio, y:innerHeight*yRatio }); });
    });
    function pick(side) {
      var matching = candidates.filter(function (point) { return point.side === side && document.elementFromPoint(point.x, point.y) === canvas; });
      return side === 'right' ? matching[matching.length - 1] : matching[0];
    }
    return { left:pick('left'), right:pick('right') };
  });
  await delay(180);
  assert.ok(spectrumPointerPoints.left && spectrumPointerPoints.right, 'spectrum pointer test has unobstructed stage points');
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:spectrumPointerPoints.left.x, y:spectrumPointerPoints.left.y, button:'none', buttons:0, pointerType:'mouse' });
  await driveSpectrum('initial', false, 520);
  const spectrumPointerLeft = await cdp.call(function () { return LumiFieldTask13.getSpectrumDebug(); });
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:spectrumPointerPoints.right.x, y:spectrumPointerPoints.right.y, button:'none', buttons:0, pointerType:'mouse' });
  await driveSpectrum('initial', false, 720);
  const spectrumPointerRight = await cdp.call(function () { return LumiFieldTask13.getSpectrumDebug(); });
  await cdp.call(function () {
    window.playQueue = window.__lfSmokeSpectrumShelfQueue;
    window.currentIdx = window.__lfSmokeSpectrumShelfIndex;
    delete window.__lfSmokeSpectrumShelfQueue;
    delete window.__lfSmokeSpectrumShelfIndex;
    if (window.shelfManager && window.shelfManager.rebuild) window.shelfManager.rebuild(false);
  });
  pass('secondary spectrum follows shared pointer, remains fully visible, and uses the fixed visual layer order',
    spectrumPointerLeft.pointerMotion && spectrumPointerRight.pointerMotion &&
    spectrumPointerLeft.pointerMotion.source === 'shared-pointer-target-smoothed' &&
    spectrumPointerRight.pointerMotion.source === 'shared-pointer-target-smoothed' &&
    spectrumPointerRight.pointerMotion.centerX - spectrumPointerLeft.pointerMotion.centerX > 10 &&
    Math.abs(spectrumPointerRight.pointerMotion.baselineCenter - spectrumPointerLeft.pointerMotion.baselineCenter) > 4 &&
    spectrumPointerRight.pointerMotion.rotationRadians - spectrumPointerLeft.pointerMotion.rotationRadians > 0.032 &&
    spectrumPointerRight.projectedBounds && spectrumPointerRight.projectedBounds.fullyVisible === true &&
    spectrumPointerRight.layerOrder &&
    spectrumPointerRight.layerOrder.particles < spectrumPointerRight.layerOrder.spectrum &&
    spectrumPointerRight.layerOrder.spectrum < spectrumPointerRight.layerOrder.lyrics &&
    spectrumPointerRight.layerOrder.lyrics < spectrumPointerRight.layerOrder.shelf &&
    spectrumPointerRight.layerOrder.shelf < spectrumPointerRight.layerOrder.shelfContent,
    { points:spectrumPointerPoints, left:spectrumPointerLeft.pointerMotion, right:spectrumPointerRight.pointerMotion,
      bounds:spectrumPointerRight.projectedBounds, layers:spectrumPointerRight.layerOrder });
  const spectrumThree = await spectrumMode(3);
  pass('spectrum keeps only real modes one and three',
    spectrumOne.debug.mode === 1 && spectrumOne.debug.stageObjectPresent && spectrumOne.debug.stageMeshPresent &&
    spectrumOne.debug.mountType === 'three-world-stage' && spectrumOne.debug.renderedBandCount === 52 &&
    spectrumOne.debug.analyticAntialias === true && spectrumOne.debug.geometryType === 'analytic-rounded-capsule-plane' &&
    spectrumOne.debug.backingStores.largeCount === 0 &&
    spectrumThree.active && spectrumThree.nonzero > 30 && spectrumThree.alpha > 1000 && spectrumThree.pointerEvents === 'none' &&
    spectrumThree.minY < spectrumThree.height * 0.25 && spectrumThree.maxY > spectrumThree.height * 0.72 &&
    spectrumThree.state.mode === 3 && spectrumThree.debug.topCount === 52 && spectrumThree.debug.bottomCount === 52 &&
    spectrumThree.debug.backingStores.largeCount === 1 && spectrumThree.debug.backingStores.main.width === 1 && spectrumThree.debug.backingStores.secondary.width > 1 &&
    !['shape','barCount','verticalCount','verticalGap','simulatedPeaks'].some(function (key) {
      return Object.prototype.hasOwnProperty.call(spectrumThree.state, key);
    }), {
    one: { debug: spectrumOne.debug },
    three: { hash: spectrumThree.hash, nonzero: spectrumThree.nonzero, minY: spectrumThree.minY, maxY: spectrumThree.maxY, debug: spectrumThree.debug },
  });

  const seekBefore = await spectrumMode(3);
  await driveSpectrum('zero', true, 120);
  const seekDuring = await cdp.call(function () {
    const canvas = document.getElementById('lf-t13-spectrum');
    const sample = document.createElement('canvas');
    sample.width = Math.max(1, Math.round(canvas.width / 4));
    sample.height = Math.max(1, Math.round(canvas.height / 4));
    const context = sample.getContext('2d', { willReadFrequently: true });
    context.drawImage(canvas, 0, 0, sample.width, sample.height);
    const data = context.getImageData(0, 0, sample.width, sample.height).data;
    let alpha = 0;
    let hash = 2166136261 >>> 0;
    for (let i = 3; i < data.length; i += 48) {
      alpha += data[i];
      hash ^= data[i];
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return { alpha, hash, active: canvas.classList.contains('active') };
  });
  await cdp.call(async function () {
    if (window.audio) {
      const duration = Number(window.audio.duration) || 0;
      window.audio.currentTime = duration > 1 ? Math.min(1, duration * 0.2) : 0;
      try { await window.audio.play(); } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (window.frequencyData) {
      for (let i = 0; i < window.frequencyData.length; i += 1) {
        window.frequencyData[i] = 35 + Math.round(215 * Math.abs(Math.sin(i * 0.137)));
      }
    }
    window.lumiFieldFrequencyDataTimestamp = performance.now();
  });
  await driveSpectrum('live', true, 260);
  const seekLive = await cdp.call(function () {
    const canvas = document.getElementById('lf-t13-spectrum');
    const sample = document.createElement('canvas');
    sample.width = Math.max(1, Math.round(canvas.width / 4));
    sample.height = Math.max(1, Math.round(canvas.height / 4));
    const context = sample.getContext('2d', { willReadFrequently: true });
    context.drawImage(canvas, 0, 0, sample.width, sample.height);
    const data = context.getImageData(0, 0, sample.width, sample.height).data;
    let alpha = 0;
    let hash = 2166136261 >>> 0;
    for (let i = 3; i < data.length; i += 48) {
      alpha += data[i];
      hash ^= data[i];
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return { alpha, hash, active: canvas.classList.contains('active') };
  });
  await cdp.call(async function () {
    if (window.audio) {
      const duration = Number(window.audio.duration) || 0;
      window.audio.currentTime = duration > 1 ? Math.min(1, duration * 0.2) : 0;
      try { await window.audio.play(); } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (window.frequencyData) {
      for (let i = 0; i < window.frequencyData.length; i += 1) window.frequencyData[i] = 90 + Math.round(150 * Math.abs(Math.cos(i * 0.071)));
    }
    window.lumiFieldFrequencyDataTimestamp = performance.now();
  });
  await driveSpectrum('after', false, 260);
  const seekAfter = await cdp.call(function () {
    const canvas = document.getElementById('lf-t13-spectrum');
    const sample = document.createElement('canvas');
    sample.width = Math.max(1, Math.round(canvas.width / 4));
    sample.height = Math.max(1, Math.round(canvas.height / 4));
    const context = sample.getContext('2d', { willReadFrequently: true });
    context.drawImage(canvas, 0, 0, sample.width, sample.height);
    const data = context.getImageData(0, 0, sample.width, sample.height).data;
    let alpha = 0;
    let hash = 2166136261 >>> 0;
    for (let i = 3; i < data.length; i += 48) {
      alpha += data[i];
      hash ^= data[i];
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return { alpha, hash, active: canvas.classList.contains('active') };
  });
  const normalizedBeforeAlpha = seekBefore.alpha;
  pass('spectrum continuity during seek and immediate recovery', seekDuring.active && seekAfter.active &&
    seekLive.active && seekDuring.alpha > normalizedBeforeAlpha * 0.005 && seekLive.alpha > normalizedBeforeAlpha * 0.025 &&
    seekLive.hash !== seekDuring.hash && seekAfter.alpha > normalizedBeforeAlpha * 0.025, {
    before: { alpha: normalizedBeforeAlpha, hash: seekBefore.hash, active: seekBefore.active },
    during: seekDuring,
    live: seekLive,
    after: seekAfter,
  });

  async function echoShape(shape) {
    await cdp.call(function (value) {
      document.body.classList.remove('render-deep-sleep', 'lf-auth-locked', 'splash-active');
      const enable = document.querySelector('[data-lf-scope="echo"][data-lf-key="enabled"]');
      enable.checked = true;
      enable.dispatchEvent(new Event('input', { bubbles: true }));
      const select = document.querySelector('[data-lf-scope="echo"][data-lf-key="shape"]');
      select.value = value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      LumiFieldTask13.updateFrame(performance.now(), 1 / 60);
    }, [shape]);
    const deadline = Date.now() + 650;
    while (Date.now() < deadline) {
      await cdp.call(function () { LumiFieldTask13.updateFrame(performance.now(), 1 / 60); });
      await delay(34);
    }
    return cdp.call(function () {
      return { state: LumiFieldTask13.getState().echo, debug: LumiFieldTask13.getEchoDebug() };
    });
  }

  const echoShape1 = await echoShape('shape1');
  const echoShape2 = await echoShape('shape2');
  const echoCoverage = await cdp.call(function () {
    const expected = [
      'enabled','shape','audioMonitor','particleStrength','mode1LeftLyricsEnabled',
      'theme','flip','showColorOptions','autoCycle','cycleInterval',
      'accentEnabled','accentColor','accentStrength','responseStrength','responseRange','rippleEnabled','rippleSensitivity','rippleCooldown',
      'idleWave','idleDebounce','idleFade','cameraDistance','cameraHorizontal','cameraElevation','autoRotate','rotateSpeed',
      'playerVisible','playerCover','playerSize','playerX','playerY',
      'exposureStrength','flashEnabled','reducedFlash',
    ];
    const actual = Array.from(document.querySelectorAll('[data-lf-scope="echo"][data-lf-key]')).map(node => node.dataset.lfKey);
    const player = document.getElementById('lf-t13-echo-player');
    window.__lfSmokePrompt = window.prompt;
    window.prompt = function () { return 'UI Smoke Echo'; };
    document.querySelector('[data-lf-echo-action="save"]').click();
    window.prompt = window.__lfSmokePrompt;
    const saved = JSON.parse(localStorage.getItem('lumifield-task13-echo-presets-v2') || '[]');
    document.querySelector('[data-lf-echo-action="reset"]').click();
    const reset = LumiFieldTask13.getState().echo;
    if (saved[0]) {
      const selector = document.getElementById('lf-t13-echo-user');
      selector.value = saved[0].id;
      selector.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const restored = LumiFieldTask13.getState().echo;
    return {
      missing: expected.filter(key => !actual.includes(key)),
      visualEqCount: document.querySelectorAll('[data-lf-echo-eq]').length,
      duplicatePlayer: !!player,
      saved: saved.length,
      resetEnabled: reset.enabled,
      restoredShape: restored.shape,
      restoredEnabled: restored.enabled,
    };
  });
  pass('two fixed-source audio-echo adapters render with shared resources and complete presets',
    [echoShape1, echoShape2].every((entry, index) =>
      entry.state.shape === ['shape1','shape2'][index] &&
      entry.debug.activeSceneCount === 1 && entry.debug.activeAdapter &&
      entry.debug.activeAdapter.id === ['shape1','shape2'][index] &&
      entry.debug.activeAdapter.grid && entry.debug.activeAdapter.grid.instanceCount > 0 &&
      entry.debug.shared && entry.debug.shared.analyserMatchesWindow &&
      entry.debug.shared.contextMatchesWindow && entry.debug.shared.frequencyDataMatchesWindow &&
      entry.debug.allocations && entry.debug.allocations.audioContextCreated === 0 &&
      entry.debug.allocations.requestAnimationFrameCreated === 0
    ) &&
    echoShape1.debug.shape3Present === false &&
    JSON.stringify(echoShape1.debug.registeredShapes) === JSON.stringify(['shape1','shape2']) &&
    ['quality','renderResolution','exposureSize','exposureRadius','trailLength','trailDecay','flashThreshold'].every(key =>
      Object.prototype.hasOwnProperty.call(echoShape2.state, key)) &&
    new Set([echoShape1, echoShape2].map(entry => entry.debug.activeAdapter.sceneId)).size === 2 &&
    new Set([echoShape1, echoShape2].map(entry => entry.debug.activeAdapter.shaderId)).size === 2 &&
    new Set([echoShape1, echoShape2].map(entry => entry.debug.activeAdapter.stateId)).size === 2 &&
    echoCoverage.missing.length === 0 && echoCoverage.visualEqCount === 8 &&
    !echoCoverage.duplicatePlayer && echoCoverage.saved === 1 && !echoCoverage.resetEnabled &&
    echoCoverage.restoredShape === 'shape2' && echoCoverage.restoredEnabled, {
    shape1: echoShape1.debug,
    shape2: echoShape2.debug,
    coverage: echoCoverage,
  });
  await screenshot('06-animation-lyrics-spectrum-echo-console');

  const stageInteraction = await cdp.call(async function () {
    if (window.LumiFieldTask13) {
      window.LumiFieldTask13.setEchoState({ enabled:false });
      window.LumiFieldTask13.setSpectrumState({ enabled:false });
      window.LumiFieldTask13.updateFrame(performance.now(), 1 / 60);
    }
    if (window.LumiFieldAudioEchoManager) window.LumiFieldAudioEchoManager.disposeMode();
    if (typeof window.toggleFxPanel === 'function') window.toggleFxPanel(false);
    const panel = document.getElementById('fx-panel');
    if (panel) panel.classList.remove('show', 'peek', 'closing');
    document.body.classList.remove('lf-fx-open');
    const canvas = window.renderer && window.renderer.domElement;
    const canvasRect = canvas.getBoundingClientRect();
    const candidates = [
      { x:innerWidth * 0.50, y:innerHeight * 0.38 },
      { x:innerWidth * 0.62, y:innerHeight * 0.44 },
      { x:innerWidth * 0.42, y:innerHeight * 0.54 },
    ];
    const point = candidates.find(function (candidate) {
      const target = document.elementFromPoint(candidate.x, candidate.y);
      return target === canvas;
    }) || { x:Math.max(canvasRect.left + 40, Math.min(canvasRect.right - 40, innerWidth * 0.5)), y:Math.max(canvasRect.top + 40, Math.min(canvasRect.bottom - 40, innerHeight * 0.38)) };
    const oldPreset = window.fx && window.fx.preset;
    const oldFreeActive = window.freeCamera && window.freeCamera.active;
    const oldFreeLocked = window.freeCamera && window.freeCamera.locked;
    if (window.fx) window.fx.preset = 0;
    if (window.freeCamera) { window.freeCamera.active = false; window.freeCamera.locked = false; }
    window.orbit.centerLocked = true;
    window.orbit.recentering = false;
    const beforeSpin = { vx:Number(particleSpin.vx) || 0, vy:Number(particleSpin.vy) || 0 };
    window.orbit.rotating = true;
    window.orbit.last.x = point.x;
    window.orbit.last.y = point.y;
    particlePointerSpin.active = true;
    particlePointerSpin.lastX = point.x;
    particlePointerSpin.lastY = point.y;
    particlePointerSpin.lastT = performance.now() - 16;
    mouseDownAt.x = point.x;
    mouseDownAt.y = point.y;
    mouseDownAt.t = performance.now() - 16;
    mouseDownAt.hadDrag = false;
    processGlobalHoverPointer({ clientX:point.x + 96, clientY:point.y + 44, movementX:96, movementY:44, target:canvas });
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles:true, cancelable:true, clientX:point.x + 96, clientY:point.y + 44, button:0, buttons:0 }));
    const drag = {
      beforeSpin: beforeSpin,
      afterSpin: { vx:Number(particleSpin.vx) || 0, vy:Number(particleSpin.vy) || 0 },
      hadDrag: !!mouseDownAt.hadDrag,
      rotating: !!window.orbit.rotating,
      centerLocked: !!window.orbit.centerLocked,
    };
    window.orbit.userRadius = 6.6;
    window.orbit.centerLocked = true;
    window.orbit.recentering = false;
    const wheelBefore = window.orbit.userRadius;
    window.unlockCenteredView();
    window.orbit.userRadius = Math.max(window.orbit.minRadius, Math.min(window.orbit.maxRadius, window.orbit.userRadius + 180 * 0.008));
    const wheel = {
      before: wheelBefore,
      after: window.orbit.userRadius,
      prevented: true,
      centerLocked: !!window.orbit.centerLocked,
    };
    window.orbit.userTheta = 0.56;
    window.orbit.userPhi = -0.24;
    window.orbit.userRadius = 8.4;
    window.recenterCamera();
    let frames = 0;
    while (window.orbit.recentering && frames < 260) {
      window.updateCamera();
      frames++;
    }
    const recenter = {
      frames: frames,
      recentring: !!window.orbit.recentering,
      centerLocked: !!window.orbit.centerLocked,
      theta: window.orbit.userTheta,
      phi: window.orbit.userPhi,
      radius: window.orbit.userRadius,
      baselineTheta: window.orbit.baselineTheta,
      baselinePhi: window.orbit.baselinePhi,
      baselineRadius: window.orbit.baselineRadius,
    };
    if (window.fx) window.fx.preset = oldPreset;
    if (window.freeCamera) { window.freeCamera.active = oldFreeActive; window.freeCamera.locked = oldFreeLocked; }
    const shelfInput = document.getElementById('fx-shelfsize');
    if (typeof window.goHome === 'function') window.goHome();
    const mainMode = window.shelfManager && window.shelfManager.getMode && window.shelfManager.getMode();
    const mainAlwaysVisible = typeof window.shelfAlwaysVisible === 'function' ? window.shelfAlwaysVisible() : null;
    if (typeof window.dismissHomePage === 'function') window.dismissHomePage({ reason: 'ui-smoke-edge' });
    window.emptyHomeActive = false;
    window.homeForcedOpen = false;
    document.body.classList.remove('empty-home-active');
    const stageMode = window.shelfManager && window.shelfManager.getMode && window.shelfManager.getMode();
    const stageAlwaysVisible = typeof window.shelfAlwaysVisible === 'function' ? window.shelfAlwaysVisible() : null;
    return {
      drag,
      wheel,
      recenter,
      shelf: { min: shelfInput.min, max: shelfInput.max, value: Number(window.fx.shelfSize) },
      mainMode,
      stageMode,
      mainAlwaysVisible,
      stageAlwaysVisible,
    };
  });
  pass('existing stage drag wheel and recenter remain effective', stageInteraction.drag.hadDrag && !stageInteraction.drag.rotating &&
    !stageInteraction.drag.centerLocked && (Math.abs(stageInteraction.drag.afterSpin.vx - stageInteraction.drag.beforeSpin.vx) > 0.001 ||
      Math.abs(stageInteraction.drag.afterSpin.vy - stageInteraction.drag.beforeSpin.vy) > 0.001) &&
    stageInteraction.wheel.prevented && !stageInteraction.wheel.centerLocked && stageInteraction.wheel.after > stageInteraction.wheel.before &&
    !stageInteraction.recenter.recentring && stageInteraction.recenter.centerLocked &&
    Math.abs(stageInteraction.recenter.theta - stageInteraction.recenter.baselineTheta) < 0.01 &&
    Math.abs(stageInteraction.recenter.phi - stageInteraction.recenter.baselinePhi) < 0.01 &&
    Math.abs(stageInteraction.recenter.radius - stageInteraction.recenter.baselineRadius) < 0.06, stageInteraction);
  pass('larger 3D shelf keeps the current side-shelf interaction contract', Number(stageInteraction.shelf.min) <= 0.58 &&
    Number(stageInteraction.shelf.max) >= 1.75 && stageInteraction.shelf.value >= 1.14 &&
    stageInteraction.mainMode === 'side' && stageInteraction.stageMode === 'side' &&
    stageInteraction.mainAlwaysVisible === true && stageInteraction.stageAlwaysVisible === true, stageInteraction);

  const playerBefore = await cdp.call(function () {
    const bar = document.getElementById('bottom-bar');
    const box = bar.getBoundingClientRect();
    return {
      rect: { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height },
      viewport: { width: innerWidth, height: innerHeight },
      position: getComputedStyle(bar).position,
      visible: bar.classList.contains('visible'),
      softHidden: bar.classList.contains('soft-hidden'),
    };
  });
  pass('player fixed at bottom in normal stage', playerBefore.position === 'fixed' && playerBefore.visible &&
    !playerBefore.softHidden && rectIsBottom(playerBefore), playerBefore);
  await cdp.call(function () {
    const bar = document.getElementById('bottom-bar');
    bar.classList.remove('visible');
    bar.classList.add('soft-hidden');
  });
  await pageWait(function () {
    const bar = document.getElementById('bottom-bar');
    return bar.classList.contains('visible') && !bar.classList.contains('soft-hidden');
  }, [], 2500);
  await cdp.call(function () { window.setImmersiveMode(true); });
  await pageWait(function () { return document.body.classList.contains('immersive-mode'); }, [], 10000);
  const immersiveSize = await cdp.call(function () { return { width: innerWidth, height: innerHeight }; });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: immersiveSize.width / 2, y: immersiveSize.height - 4 });
  await pageWait(function () {
    const bar = document.getElementById('bottom-bar');
    return bar.classList.contains('visible') && !bar.classList.contains('soft-hidden');
  }, [], 5000);
  await cdp.call(function () { window.setImmersiveMode(false); });
  await pageWait(function () { return !document.body.classList.contains('immersive-mode'); }, [], 10000);
  pass('immersive bottom hot-zone restores persistent player', true);

  const fab = await cdp.call(function () {
    const node = document.getElementById('fx-fab');
    const box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const filter = style.backdropFilter || style.webkitBackdropFilter || '';
    const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      bound: !!node._lfT13Glass,
      right: innerWidth - box.right,
      bottom: innerHeight - box.bottom,
      backdropFilter: filter,
      backgroundImage: style.backgroundImage,
      alphaBackground: style.backgroundColor,
      svgDisplacement: !!document.querySelector('#lumifield-control-glass-filter feDisplacementMap'),
      hit: !!(target && target.closest && target.closest('#fx-fab')),
      rect: { left: box.left, top: box.top, width: box.width, height: box.height },
    };
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: fab.rect.left + fab.rect.width * 0.82,
    y: fab.rect.top + fab.rect.height * 0.24,
  });
  await cdp.call(function (point) {
    const node = document.getElementById('fx-fab');
    node.dispatchEvent(new PointerEvent('pointermove', { bubbles:true, clientX:point.x, clientY:point.y }));
  }, [{ x:fab.rect.left + fab.rect.width * 0.82, y:fab.rect.top + fab.rect.height * 0.24 }]);
  await delay(100);
  const fabVars = await cdp.call(function () {
    const node = document.getElementById('fx-fab');
    return {
      x: node.style.getPropertyValue('--lf-fab-x'),
      y: node.style.getPropertyValue('--lf-fab-y'),
    };
  });
  pass('liquid-glass FAB samples backdrop and hit target matches', fab.bound && fab.right >= 20 && fab.right <= 60 &&
    fab.bottom >= 70 && fab.bottom <= 145 && fab.hit && fab.svgDisplacement &&
    (/url\(/i.test(fab.backdropFilter) || document.documentElement.classList.contains('control-glass-svg-ok')) &&
    fab.backgroundImage === 'none' && Math.abs(parseFloat(fabVars.x)) > 0.1 && Math.abs(parseFloat(fabVars.y)) > 0.1, { fab, fabVars });

  const presetPreview = await cdp.call(function () {
    const before = {
      intensity: window.fx.intensity,
      depth: window.fx.depth,
      opacity: window.fx.backgroundOpacity,
      lyricTranslate: LumiFieldTask13.getState().lyrics.translate,
      archives: window.userFxArchives.length,
    };
    const payload = {
      schema: 2,
      name: 'UI Smoke Transaction',
      snapshot: { intensity: 1.31, lyrics: { translate: false }, backgroundOpacity: 0.12 },
    };
    const ok = window.importUserFxArchiveText(JSON.stringify(payload), 'ui-smoke.json', { preview: true });
    const modal = document.getElementById('lf-t13-import-preview');
    return {
      ok,
      before,
      shown: modal.classList.contains('show'),
      diff: modal.querySelector('.lf-t13-import-diff').innerText,
      wallpaperDefault: modal.querySelector('.lf-t13-import-wallpaper input').checked,
    };
  });
  pass('transactional preset preview with wallpaper opt-in default off', presetPreview.ok && presetPreview.shown &&
    presetPreview.diff.includes('visual.intensity') && presetPreview.diff.includes('lyrics.translate') &&
    /wallpaper|壁纸/i.test(presetPreview.diff) && presetPreview.wallpaperDefault === false, presetPreview);
  await screenshot('07-transactional-preset-preview');
  const preset = await cdp.call(function (before) {
    document.querySelector('#lf-t13-import-preview [data-action="cancel"]').click();
    const canceled = {
      intensity: window.fx.intensity,
      lyricTranslate: LumiFieldTask13.getState().lyrics.translate,
      archives: window.userFxArchives.length,
    };
    const songBefore = {
      index: window.currentIdx,
      id: window.playQueue && window.playQueue[window.currentIdx] && window.playQueue[window.currentIdx].id,
    };
    const payload = {
      schema: 2,
      name: 'UI Smoke Transaction',
      snapshot: { intensity: 1.31, lyrics: { translate: false }, backgroundOpacity: 0.12 },
    };
    const applied = window.importUserFxArchiveText(JSON.stringify(payload), 'ui-smoke.json');
    const after = {
      intensity: window.fx.intensity,
      depth: window.fx.depth,
      opacity: window.fx.backgroundOpacity,
      lyricTranslate: LumiFieldTask13.getState().lyrics.translate,
      archives: window.userFxArchives.length,
      presetId: localStorage.getItem('lumifield-task13-current-preset-v1'),
      songIndex: window.currentIdx,
      songId: window.playQueue && window.playQueue[window.currentIdx] && window.playQueue[window.currentIdx].id,
    };
    const invalid = window.importUserFxArchiveText(JSON.stringify({ schema: 2, snapshot: { lyrics: { translate: 'not-a-boolean' } } }), 'invalid.json');
    const afterInvalid = LumiFieldTask13.getState().lyrics.translate;
    return { canceled, applied, after, invalid, afterInvalid, songBefore };
  }, [presetPreview.before]);
  pass('transactional preset applies only explicit fields and rejects invalid atomically',
    preset.canceled.intensity === presetPreview.before.intensity &&
    preset.canceled.lyricTranslate === presetPreview.before.lyricTranslate &&
    preset.canceled.archives === presetPreview.before.archives &&
    preset.applied === true && Math.abs(preset.after.intensity - 1.31) < 0.001 &&
    preset.after.lyricTranslate === false && preset.after.depth === presetPreview.before.depth &&
    preset.after.opacity === presetPreview.before.opacity &&
    preset.after.archives === presetPreview.before.archives + 1 &&
    preset.after.presetId && !/emily/i.test(preset.after.presetId) &&
    preset.after.songIndex === preset.songBefore.index && preset.after.songId === preset.songBefore.id &&
    preset.invalid === false && preset.afterInvalid === false, preset);

  await cdp.call(function () {
    document.getElementById('lf-wallpaper-open').click();
    const target = document.getElementById('lf-wallpaper-target');
    target.value = 'stage';
    target.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await pageWait(function () { return document.getElementById('lf-wallpaper-modal').classList.contains('show'); });
  const pausedWallpaperProviders = await cdp.call(function () {
    const external = Array.from(document.querySelectorAll('#lf-wallpaper-modal [data-lf-wallpaper-provider="wallpaper_engine"],#lf-wallpaper-modal [data-lf-wallpaper-provider="qianqian"]'));
    const local = document.querySelector('#lf-wallpaper-modal [data-lf-wallpaper-provider="local"]');
    return {
      providers: external.map(function (button) { return { name:button.querySelector('b').textContent, text:button.textContent, disabled:button.disabled, state:button.dataset.developmentState }; }),
      localEnabled: !!local && !local.disabled,
      externalActionsDisabled: Array.from(document.querySelectorAll('#lf-wallpaper-modal .lf-wallpaper-provider-actions button')).every(function (button) { return button.disabled; }),
      statusStates: Array.from(document.querySelectorAll('#lf-wallpaper-provider-status [data-development-state]')).map(function (node) { return node.dataset.developmentState; }),
    };
  });
  pass('Wallpaper Engine and QianQian are paused while local wallpaper remains enabled', pausedWallpaperProviders.providers.length === 2 &&
    pausedWallpaperProviders.providers.every(item => item.disabled && item.state === 'PAUSED_DEVELOPMENT' && item.text.includes('开发中')) &&
    pausedWallpaperProviders.localEnabled && pausedWallpaperProviders.externalActionsDisabled &&
    pausedWallpaperProviders.statusStates.length === 2 && pausedWallpaperProviders.statusStates.every(state => state === 'PAUSED_DEVELOPMENT'), pausedWallpaperProviders);
  await setFileInput('#lf-wallpaper-file', stageVideoFixture);
  await cdp.call(async function () {
    window.__LF_WALLPAPER_TEST__ = true;
    await window.LumiFieldWallpaperVideoOptimization.setTestAdapter({
      probe:function () { return Promise.resolve({ width:1920, height:1080, fps:30, bitrate:8000000, codec:'h264', hasAudio:false }); },
      transcode:function () { throw new Error('UNEXPECTED_TRANSCODE'); },
      debug:function () { return { source:'ui-smoke-no-transcode' }; }
    });
    const input = document.getElementById('lf-wallpaper-file');
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const target = document.getElementById('lf-wallpaper-target');
    target.value = 'stage';
    target.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('lf-wallpaper-apply').click();
  });
  await pageWait(function () {
    const video = document.getElementById('custom-bg-video');
    return document.body.classList.contains('lf-stage-wallpaper-active') && video && !video.hidden && video.readyState >= 2;
  }, [], 30000);
  const previewVideo = await cdp.call(async function () {
    const video = document.getElementById('custom-bg-video');
    try { await video.play(); } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 900));
    const quality = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : {};
    return {
      src: video.getAttribute('src'),
      readyState: video.readyState,
      paused: video.paused,
      currentTime: video.currentTime,
      frames: Number(quality.totalVideoFrames || 0),
      muted: video.muted,
      loop: video.loop,
    };
  });
  pass('stage video preview decodes and plays', previewVideo.readyState >= 2 && !previewVideo.paused &&
    (previewVideo.currentTime > 0 || previewVideo.frames > 0) && previewVideo.muted && previewVideo.loop, previewVideo);
  await cdp.call(function () { document.getElementById('lf-wallpaper-cancel').click(); });
  await cdp.call(async function () {
    await window.LumiFieldWallpaperVideoOptimization.setTestAdapter(null);
  });
  await pageWait(function () {
    const video = document.getElementById('custom-bg-video');
    const modal = document.getElementById('lf-wallpaper-modal');
    return modal && !modal.classList.contains('show') &&
      !document.body.classList.contains('lf-stage-wallpaper-active') && (!video || video.hidden || !video.getAttribute('src'));
  }, [], 10000);
  await delay(300);
  pass('wallpaper Cancel restores prior stage state', true);

  await cdp.call(function () {
    document.getElementById('lf-wallpaper-open').click();
    const target = document.getElementById('lf-wallpaper-target');
    target.value = 'stage';
    target.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await setFileInput('#lf-wallpaper-file', stageVideoFixture);
  await cdp.call(async function () {
    await window.LumiFieldWallpaperVideoOptimization.setTestAdapter({
      probe:function () { return Promise.resolve({ width:1920, height:1080, fps:30, bitrate:8000000, codec:'h264', hasAudio:false }); },
      transcode:function () { throw new Error('UNEXPECTED_TRANSCODE'); },
      debug:function () { return { source:'ui-smoke-no-transcode' }; }
    });
    const input = document.getElementById('lf-wallpaper-file');
    input.dispatchEvent(new Event('change', { bubbles:true }));
    await new Promise(resolve => setTimeout(resolve, 180));
    document.getElementById('lf-wallpaper-target').value = 'stage';
    document.getElementById('lf-wallpaper-apply').click();
    const deadline = performance.now() + 30000;
    while (!document.body.classList.contains('lf-stage-wallpaper-active') && performance.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  });
  await delay(3000);
  const secondPreviewState = await cdp.call(function () {
    const video = document.getElementById('custom-bg-video');
    const status = document.getElementById('lf-wallpaper-video-opt-status');
    return {
      active: document.body.classList.contains('lf-stage-wallpaper-active'),
      readyState: video && video.readyState,
      src: video && video.getAttribute('src'),
      fileName: document.getElementById('lf-wallpaper-file').files[0] && document.getElementById('lf-wallpaper-file').files[0].name,
      phase: status && status.dataset.phase,
      status: status && status.textContent,
      lastError: window.__lfWallpaperLastError || '',
    };
  });
  pass('second stage video preview remains ready for commit', secondPreviewState.active && secondPreviewState.readyState >= 2 &&
    secondPreviewState.src && secondPreviewState.fileName && secondPreviewState.phase === 'complete', secondPreviewState);
  await cdp.call(function () { document.getElementById('lf-wallpaper-ok').click(); });
  await pageWait(function () { return !document.getElementById('lf-wallpaper-modal').classList.contains('show'); }, [], 30000);
  const committedVideo = await cdp.call(async function () {
    const saved = await LumiFieldWallpaperState.status('stage');
    const video = document.getElementById('custom-bg-video');
    try { await video.play(); } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 700));
    return {
      persisted: !!(saved && saved.meta && saved.dbRecordCount === 1),
      name: saved && saved.meta && saved.meta.name,
      readyState: video.readyState,
      paused: video.paused,
      currentTime: video.currentTime,
      src: video.getAttribute('src'),
      nodeMarker: 'custom-bg-video',
    };
  });
  pass('stage video confirm persists and remains playing', committedVideo.persisted && committedVideo.readyState >= 2 &&
    !committedVideo.paused && committedVideo.currentTime > 0 && committedVideo.src, committedVideo);
  await cdp.call(async function () {
    await window.LumiFieldWallpaperVideoOptimization.setTestAdapter(null);
    delete window.__LF_WALLPAPER_TEST__;
  });
  await screenshot('08-stage-video-spectrum-player');

  const opacity = await cdp.call(async function () {
    const input = document.getElementById('fx-bgopacity');
    const video = document.getElementById('custom-bg-video');
    const node = video;
    const src = video.getAttribute('src');
    const start = video.currentTime;
    const startedAt = performance.now();
    input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    for (let index = 0; index <= 100; index += 1) {
      input.value = String(index / 100);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.value = '0.37';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    const dispatchMs = performance.now() - startedAt;
    await new Promise(resolve => setTimeout(resolve, 750));
    const quality = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : {};
    return {
      dispatchMs,
      sameNode: node === document.getElementById('custom-bg-video'),
      sameSrc: src === video.getAttribute('src'),
      start,
      end: video.currentTime,
      paused: video.paused,
      readyState: video.readyState,
      frames: Number(quality.totalVideoFrames || 0),
      value: window.fx.backgroundOpacity,
      cssValue: getComputedStyle(document.documentElement).getPropertyValue('--lf-background-opacity').trim(),
      dragging: document.body.classList.contains('lf-bg-opacity-dragging'),
    };
  });
  pass('background opacity coalesces without video reload or flicker', opacity.dispatchMs < 250 &&
    opacity.sameNode && opacity.sameSrc && opacity.end >= opacity.start && !opacity.paused && opacity.readyState >= 2 &&
    Math.abs(opacity.value - 0.37) < 0.001 && opacity.cssValue === '0.370' && !opacity.dragging, opacity);

  await cdp.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
    connectionType: 'none',
  });
  await pageWait(function () {
    return !navigator.onLine && document.getElementById('search-input').readOnly &&
      document.getElementById('lf-offline-badge').classList.contains('show');
  }, [], 10000);
  const offlineMode = await cdp.call(async function () {
    const result = await LFOfflineAudioCache.playLast();
    const rows = await LFOfflineAudioCache.list();
    const record = rows.find(row => row.key === result.key);
    const restoredLine = Array.isArray(window.lyricsLines) && window.lyricsLines.find(line => line.translation === '离线译文一');
    return {
      readOnly: document.getElementById('search-input').readOnly,
      badge: document.getElementById('lf-offline-badge').textContent,
      played: result.ok,
      cachedCover: !!(record && record.coverBlob instanceof Blob && record.coverBlob.size > 0),
      cachedTranslation: record && record.metadata && record.metadata.lyricsLines && record.metadata.lyricsLines[0] && record.metadata.lyricsLines[0].translation,
      resultName: result.metadata && result.metadata.name,
      song: window.currentLocalSong && {
        name: window.currentLocalSong.name,
        artist: window.currentLocalSong.artist,
        cover: window.currentLocalSong.cover,
        offlinePlayback: window.currentLocalSong.offlinePlayback,
      },
      restoredTranslation: restoredLine && restoredLine.translation,
    };
  });
  pass('offline mode restores cached audio, cover, song metadata and translated lyrics', offlineMode.readOnly &&
    offlineMode.badge === '离线模式' && offlineMode.played && offlineMode.cachedCover &&
    offlineMode.cachedTranslation === '离线译文一' && offlineMode.resultName === 'LF Offline Rich Fixture' &&
    offlineMode.song && offlineMode.song.name === 'LF Offline Rich Fixture' &&
    offlineMode.song.artist === 'Local QA Artist' && offlineMode.song.offlinePlayback &&
    /^blob:/.test(offlineMode.song.cover || '') && offlineMode.restoredTranslation === '离线译文一', offlineMode);
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
    connectionType: 'wifi',
  });
  await pageWait(function () { return navigator.onLine && !document.getElementById('search-input').readOnly; }, [], 10000);

  await cdp.call(async function () {
    if (typeof window.dismissHomePage === 'function') window.dismissHomePage({ reason: 'ui-smoke-performance' });
    window.emptyHomeActive = false;
    window.homeForcedOpen = false;
    document.body.classList.remove('empty-home-active');
    window.playing = true;
    if (window.LumiFieldTask13) {
      window.LumiFieldTask13.setSpectrumState({ enabled:false });
      window.LumiFieldTask13.setEchoState({ enabled:true, shape:'shape2' });
    }
    if (window.audio && window.audio.paused) {
      try { await window.audio.play(); } catch (_) {}
    }
    if (window.frequencyData && window.frequencyData.length) {
      for (let i = 0; i < window.frequencyData.length; i += 1) {
        window.frequencyData[i] = 70 + Math.round(170 * Math.abs(Math.sin(i * 0.091)));
      }
    }
  });
  await pageWait(function () {
    const echo = window.LumiFieldTask13 && window.LumiFieldTask13.getEchoDebug();
    return window.isVisualStageInteractionActive() &&
      echo && echo.active && echo.activeSceneCount === 1 && echo.activeAdapter &&
      echo.activeAdapter.grid && echo.activeAdapter.grid.instanceCount > 0;
  }, [], 5000);
  await cdp.send('Page.bringToFront');
  await cdp.call(function () { try { window.focus(); } catch (_) {} });
  await delay(1000);

  const performance = await cdp.call(async function () {
    const started = performance.now();
    let frames = 0;
    await new Promise(resolve => {
      function frame(now) {
        frames += 1;
        if (now - started >= 2200) resolve();
        else requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
    const elapsed = performance.now() - started;
    const video = document.getElementById('custom-bg-video');
    const quality = video && video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : {};
    const memory = performance.memory || {};
    return {
      fps: frames * 1000 / elapsed,
      frameTimeMs: elapsed / frames,
      videoFrames: Number(quality.totalVideoFrames || 0),
      droppedVideoFrames: Number(quality.droppedVideoFrames || 0),
      heapUsed: Number(memory.usedJSHeapSize || 0),
      documentHidden: document.hidden,
      hasFocus: document.hasFocus(),
      audioContextState: window.audioCtx && window.audioCtx.state,
      playerVisible: document.getElementById('bottom-bar').classList.contains('visible'),
      spectrumActive: document.getElementById('lf-t13-spectrum').classList.contains('active'),
      echoActive: !!(window.LumiFieldTask13 && window.LumiFieldTask13.getEchoDebug().active),
    };
  });
  pass('combined visual smoke remains interactive', performance.fps >= 20 && performance.frameTimeMs < 50 &&
    performance.videoFrames > 0 && performance.playerVisible && !performance.spectrumActive && performance.echoActive, performance);

  await cdp.call(function () {
    if (window.__lfSmokeSpectrumAudio) window.__lfSmokeSpectrumAudio.pause();
    if (window.__lfSmokeSpectrumAudioUrl) URL.revokeObjectURL(window.__lfSmokeSpectrumAudioUrl);
    if (window.analyser && window.__lfSmokeAnalyserGetByteFrequencyData) {
      window.analyser.getByteFrequencyData = window.__lfSmokeAnalyserGetByteFrequencyData;
    }
    if (window.__lfSmokeAudio !== undefined) window.audio = window.__lfSmokeAudio;
    if (window.__lfSmokePlaying !== undefined) window.playing = window.__lfSmokePlaying;
    delete window.__lfSmokeSpectrumAudio;
    delete window.__lfSmokeSpectrumAudioUrl;
    delete window.__lfSmokeSpectrumPattern;
    delete window.__lfSmokeAnalyserGetByteFrequencyData;
    delete window.__lfSmokeAudio;
  });
  const startupLogText = appLog.join('');
  pass('startup log has no cancelled SMS warning', !/(?:短信|\bSMS\b).*(?:未配置|unconfigured|missing)/i.test(startupLogText));
  pass('renderer has no uncaught exceptions', errors.length === 0, errors);

  const result = {
    ok: true,
    runId,
    mode: launchMode,
    origin,
    evidenceDir,
    screenshots,
    screenshotWarnings,
    checks,
    externalStates: {
      musicPlatformAuthorization: 'WAITING_USER_AUTHORIZATION',
      lfMobileQr: 'PAUSED_DEVELOPMENT',
      localDemucs: 'BLOCKED_EXTERNAL_CONFIG',
      translationService: 'LOCAL_RUNTIME_VERIFIED',
    },
    runtimeApis,
    performance,
    rendererErrors: errors,
  };
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(evidenceDir, 'app.log'), appLog.join('').replace(/\b\d{6}\b/g, '[REDACTED_CODE]'));
  process.stdout.write(JSON.stringify(result) + '\n');
}

run().catch(error => {
  const failure = {
    ok: false,
    runId,
    origin,
    evidenceDir,
    error: String(error && error.stack || error),
    checks,
    screenshots,
    screenshotWarnings,
    rendererErrors: errors,
  };
  try {
    fs.writeFileSync(path.join(evidenceDir, 'failure.json'), JSON.stringify(failure, null, 2));
    fs.writeFileSync(path.join(evidenceDir, 'app.log'), appLog.join('').replace(/\b\d{6}\b/g, '[REDACTED_CODE]'));
  } catch (_) {}
  console.error(failure.error);
  process.exitCode = 1;
}).finally(() => {
  if (cdp) cdp.close();
  if (app && app.pid && app.exitCode == null) {
    spawnSync('taskkill', ['/pid', String(app.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
  }
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) {}
});
