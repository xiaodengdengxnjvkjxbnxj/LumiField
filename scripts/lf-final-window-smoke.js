'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const electron = require('electron');
const argv = process.argv.slice(2);
const exeArg = argv.find(value => value.startsWith('--exe=')) || argv.find(value => value.startsWith('--installed-exe='));
const requestedExe = exeArg ? path.resolve(exeArg.slice(exeArg.indexOf('=') + 1)) : '';
if (requestedExe && !fs.existsSync(requestedExe)) throw new Error(`Executable not found: ${requestedExe}`);
const outArg = argv.find(value => value.startsWith('--out='));
const scaleArg = argv.find(value => value.startsWith('--scales='));
const scales = (scaleArg ? scaleArg.slice('--scales='.length).split(',') : ['1', '1.25', '1.5', '2'])
  .map(Number)
  .filter(value => Number.isFinite(value) && value >= 1 && value <= 4);
if (!scales.length) throw new Error('No valid DPI scales supplied');

const launchExecutable = requestedExe || electron;
const launchMode = requestedExe ? 'installed' : 'source';
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.resolve(outArg ? outArg.slice('--out='.length) : path.join(repo, 'test-results', 'lf-final-window-smoke', launchMode, runId));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-final-window-'));
const checks = {};
const results = [];
const screenshots = [];
const rendererErrors = [];
const appLogs = [];
let activeApp = null;
let activeCdp = null;

fs.mkdirSync(evidenceDir, { recursive: true });

const PLAYER_CONTROLS = [
  '#quality-btn', '#heart-btn', '#collect-btn', '#play-mode-btn', '#prev-btn', '#play-btn', '#next-btn',
  '#mini-queue-btn', '.lyrics-toggle-btn', '#volume-btn', '#controls-hide-btn', '#immersive-btn', '.fullscreen-toggle-btn'
];
const WINDOW_CONTROLS = [
  '[data-window-action="minimize"]', '[data-window-action="maximize"]', '[data-window-action="close"]'
];

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
  constructor(url, scale) {
    this.url = url;
    this.scale = scale;
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
        rendererErrors.push({
          scale: this.scale,
          text: String(detail.exception && detail.exception.description || detail.text || 'Renderer exception').slice(0, 3000)
        });
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
      userGesture: true
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

async function findMainTarget(port) {
  return waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json();
    return targets.find(target => target.type === 'page' && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//.test(target.url));
  }, 60000, 160);
}

function win32Snapshot(rootPid) {
  const typeDefinition = [
    'using System;',
    'using System.Runtime.InteropServices;',
    'namespace LF { public static class Native {',
    '[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }',
    '[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }',
    '[StructLayout(LayoutKind.Sequential)] public struct WINDOWPLACEMENT { public int length; public int flags; public int showCmd; public POINT ptMinPosition; public POINT ptMaxPosition; public RECT rcNormalPosition; }',
    '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();',
    '[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);',
    '[DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT placement);',
    '[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);',
    '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
    '} }'
  ].join(' ');
  const encodedType = Buffer.from(typeDefinition, 'utf16le').toString('base64');
  const script = [
    "$ErrorActionPreference='Stop'",
    `$rootPid=${Number(rootPid)}`,
    '$ids=@($rootPid)',
    'for($round=0;$round -lt 5;$round++){ $children=@(Get-CimInstance Win32_Process | Where-Object { $ids -contains [int]$_.ParentProcessId } | ForEach-Object { [int]$_.ProcessId }); $next=@($ids+$children | Sort-Object -Unique); if($next.Count -eq $ids.Count){break}; $ids=$next }',
    '$windowProcess=$null',
    'foreach($candidateId in $ids){ $candidate=Get-Process -Id $candidateId -ErrorAction SilentlyContinue; if($candidate){$candidate.Refresh()}; if($candidate -and $candidate.MainWindowHandle -ne 0){$windowProcess=$candidate;break} }',
    "if(-not $windowProcess){throw 'No top-level window found for process tree'}",
    `$source=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encodedType}'))`,
    'Add-Type -TypeDefinition $source -Language CSharp',
    '[LF.Native]::SetProcessDPIAware()|Out-Null',
    '$handle=$windowProcess.MainWindowHandle',
    '$rect=New-Object LF.Native+RECT',
    '$placement=New-Object LF.Native+WINDOWPLACEMENT',
    '$placement.length=44',
    '[LF.Native]::GetWindowRect($handle,[ref]$rect)|Out-Null',
    '[LF.Native]::GetWindowPlacement($handle,[ref]$placement)|Out-Null',
    '$foreground=[LF.Native]::GetForegroundWindow()',
    '[ordered]@{pid=[int]$windowProcess.Id;handle=[int64]$handle;visible=[LF.Native]::IsWindowVisible($handle);foreground=([int64]$foreground -eq [int64]$handle);showCmd=[int]$placement.showCmd;maximized=([int]$placement.showCmd -eq 3);left=[int]$rect.Left;top=[int]$rect.Top;width=[int]($rect.Right-$rect.Left);height=[int]($rect.Bottom-$rect.Top);normalLeft=[int]$placement.rcNormalPosition.Left;normalTop=[int]$placement.rcNormalPosition.Top;normalWidth=[int]($placement.rcNormalPosition.Right-$placement.rcNormalPosition.Left);normalHeight=[int]($placement.rcNormalPosition.Bottom-$placement.rcNormalPosition.Top)} | ConvertTo-Json -Compress'
  ].join('; ');
  const output = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 20000
  });
  if (output.status !== 0) throw new Error(`Win32 snapshot failed: ${String(output.stderr || output.stdout).trim()}`);
  return JSON.parse(String(output.stdout).trim());
}

function setWin32WindowBounds(rootPid, bounds) {
  const definition = [
    'using System;',
    'using System.Runtime.InteropServices;',
    'namespace LF { public static class WindowMove {',
    '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();',
    '[DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int width, int height, uint flags);',
    '} }'
  ].join(' ');
  const encodedType = Buffer.from(definition, 'utf16le').toString('base64');
  const script = [
    "$ErrorActionPreference='Stop'",
    `$rootPid=${Number(rootPid)}`,
    '$ids=@($rootPid)',
    'for($round=0;$round -lt 5;$round++){ $children=@(Get-CimInstance Win32_Process | Where-Object { $ids -contains [int]$_.ParentProcessId } | ForEach-Object { [int]$_.ProcessId }); $next=@($ids+$children | Sort-Object -Unique); if($next.Count -eq $ids.Count){break}; $ids=$next }',
    '$windowProcess=$null',
    'foreach($candidateId in $ids){ $candidate=Get-Process -Id $candidateId -ErrorAction SilentlyContinue; if($candidate){$candidate.Refresh()}; if($candidate -and $candidate.MainWindowHandle -ne 0){$windowProcess=$candidate;break} }',
    "if(-not $windowProcess){throw 'No top-level window found for process tree'}",
    `$source=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encodedType}'))`,
    'Add-Type -TypeDefinition $source -Language CSharp',
    '[LF.WindowMove]::SetProcessDPIAware()|Out-Null',
    `$ok=[LF.WindowMove]::SetWindowPos($windowProcess.MainWindowHandle,[IntPtr]::Zero,${Math.round(bounds.left)},${Math.round(bounds.top)},${Math.round(bounds.width)},${Math.round(bounds.height)},0x0040)`,
    "if(-not $ok){throw ('SetWindowPos failed: '+[Runtime.InteropServices.Marshal]::GetLastWin32Error())}",
    '[ordered]@{ok=$ok;pid=[int]$windowProcess.Id;left=' + Math.round(bounds.left) + ';top=' + Math.round(bounds.top) + ';width=' + Math.round(bounds.width) + ';height=' + Math.round(bounds.height) + '} | ConvertTo-Json -Compress'
  ].join('; ');
  const output = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    windowsHide:true,
    encoding:'utf8',
    timeout:20000
  });
  if (output.status !== 0) throw new Error(`Win32 SetWindowPos failed: ${String(output.stderr || output.stdout).trim()}`);
  return JSON.parse(String(output.stdout).trim());
}

function focusWindow(rootPid) {
  const script = [
    "Add-Type -Name Win32 -Namespace LF -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow); [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd);'",
    `$p=Get-Process -Id ${Number(rootPid)} -ErrorAction SilentlyContinue`,
    'if($p){$p.Refresh()}',
    'if($p -and $p.MainWindowHandle -ne 0){[LF.Win32]::ShowWindowAsync($p.MainWindowHandle,9)|Out-Null;[LF.Win32]::SetForegroundWindow($p.MainWindowHandle)|Out-Null}'
  ].join('; ');
  spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 12000
  });
}

async function prepareUi(cdp) {
  await cdp.call(function () {
    window.startupLoginGuideShown = true;
    window.loginGuideAnimating = false;
    window.showLoginModal = function () { return false; };
    if (typeof window.closeLoginModal === 'function') {
      try { window.closeLoginModal(); } catch (_) {}
    }
    document.querySelectorAll('.modal-mask.show,.modal-mask.open,.modal-mask.active').forEach(function (node) {
      node.classList.remove('show', 'open', 'active');
      node.setAttribute('aria-hidden', 'true');
    });
    document.body.classList.remove('splash-active', 'splash-revealing', 'home-controls-locked', 'lf-auth-locked');
    ['lf-auth-root', 'lf-profile-modal', 'lf-account-manager-modal', 'lf-legal-modal'].forEach(function (id) {
      var overlay = document.getElementById(id);
      if (overlay) overlay.classList.remove('show', 'is-open');
    });
    var splash = document.getElementById('splash');
    if (splash) splash.style.display = 'none';
    var search = document.getElementById('search-area');
    if (search) search.classList.add('peek');
    if (typeof controlsAutoHide !== 'undefined') controlsAutoHide = false;
    if (typeof controlsHideTimer !== 'undefined' && controlsHideTimer) {
      clearTimeout(controlsHideTimer);
      controlsHideTimer = null;
    }
    var bar = document.getElementById('bottom-bar');
    if (bar) bar.classList.add('visible');
    if (typeof setControlsHidden === 'function') setControlsHidden(false);
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: Math.floor(innerWidth / 2), clientY: Math.max(0, innerHeight - 30) }));
  });
  await delay(350);
}

async function layoutSnapshot(cdp, label) {
  return cdp.call(function (payload) {
    function rect(node) {
      if (!node) return null;
      var box = node.getBoundingClientRect();
      return { left:box.left, top:box.top, right:box.right, bottom:box.bottom, width:box.width, height:box.height };
    }
    function describe(selector) {
      var node = document.querySelector(selector);
      if (!node) return { selector:selector, present:false };
      var box = node.getBoundingClientRect();
      var style = getComputedStyle(node);
      var x = box.left + box.width / 2;
      var y = box.top + box.height / 2;
      var hit = box.width > 0 && box.height > 0 && x >= 0 && y >= 0 && x < innerWidth && y < innerHeight
        ? document.elementFromPoint(x, y)
        : null;
      return {
        selector:selector,
        present:true,
        rect:rect(node),
        display:style.display,
        visibility:style.visibility,
        opacity:Number(style.opacity || 1),
        pointerEvents:style.pointerEvents,
        disabled:!!node.disabled,
        onclickType:typeof node.onclick,
        center:{ x:x, y:y },
        hit:!!(hit && (hit === node || node.contains(hit))),
        hitTarget:hit ? (hit.id ? '#' + hit.id : String(hit.className || hit.tagName || '')) : ''
      };
    }
    var root = document.documentElement;
    var body = document.body;
    var regions = {};
    ['#desktop-titlebar', '#top-right', '#search-area', '#bottom-bar', '#controls', '#canvas-container'].forEach(function (selector) {
      regions[selector] = rect(document.querySelector(selector));
    });
    return {
      label:payload.label,
      viewport:{ width:innerWidth, height:innerHeight, dpr:devicePixelRatio, outerWidth:outerWidth, outerHeight:outerHeight },
      screen:{ width:screen.width, height:screen.height, availWidth:screen.availWidth, availHeight:screen.availHeight },
      overflow:{ rootX:Math.max(0, root.scrollWidth - innerWidth), bodyX:Math.max(0, body.scrollWidth - innerWidth), rootY:Math.max(0, root.scrollHeight - innerHeight) },
      regions:regions,
      playerControls:payload.player.map(describe),
      windowControls:payload.window.map(describe),
      searchControl:describe('#search-submit-btn'),
      stateClasses:String(body.className || '')
    };
  }, [{ label, player: PLAYER_CONTROLS, window: WINDOW_CONTROLS }]);
}

function insideViewport(item, viewport) {
  if (!item || !item.present || !item.rect) return false;
  return item.rect.width >= 20 && item.rect.height >= 20 &&
    item.rect.left >= -1 && item.rect.top >= -1 &&
    item.rect.right <= viewport.width + 1 && item.rect.bottom <= viewport.height + 1;
}

function validateLayout(scale, phase, snapshot) {
  const prefix = `${Math.round(scale * 100)}% ${phase}`;
  pass(`${prefix}: renderer uses requested process DPI`, Math.abs(snapshot.viewport.dpr - scale) <= 0.03, snapshot.viewport);
  pass(`${prefix}: document has no horizontal overflow`, snapshot.overflow.rootX <= 2 && snapshot.overflow.bodyX <= 2, snapshot.overflow);
  const bar = snapshot.regions['#bottom-bar'];
  const controls = snapshot.regions['#controls'];
  pass(`${prefix}: original player console stays inside the real viewport`,
    bar && controls && bar.left >= -1 && bar.right <= snapshot.viewport.width + 1 && bar.bottom <= snapshot.viewport.height + 1 &&
    bar.width >= Math.min(900, snapshot.viewport.width - 30) && bar.height >= 80 && bar.height <= 110 &&
    controls.left >= bar.left - 1 && controls.right <= bar.right + 1,
    { viewport:snapshot.viewport, bar, controls });
  const visiblePlayerControls = snapshot.playerControls.filter(item => item.rect && item.rect.width > 0 && item.rect.height > 0);
  pass(`${prefix}: all 13 player functions remain installed and enabled`,
    snapshot.playerControls.length === 13 && snapshot.playerControls.every(item =>
      item.present && !item.disabled && item.onclickType === 'function'),
    snapshot.playerControls);
  pass(`${prefix}: every mode-visible player control is inside the viewport and topmost`,
    visiblePlayerControls.length >= 10 && visiblePlayerControls.every(item =>
      insideViewport(item, snapshot.viewport) && item.display !== 'none' && item.visibility !== 'hidden' &&
      item.opacity >= 0.9 && item.pointerEvents !== 'none' && item.hit),
    visiblePlayerControls);
  pass(`${prefix}: all native window controls are visible and topmost`,
    snapshot.windowControls.length === 3 && snapshot.windowControls.every(item =>
      insideViewport(item, snapshot.viewport) && item.display !== 'none' && item.visibility !== 'hidden' &&
      item.opacity >= 0.9 && item.pointerEvents !== 'none' && !item.disabled && item.hit),
    snapshot.windowControls);
  pass(`${prefix}: search control remains visible and clickable`,
    insideViewport(snapshot.searchControl, snapshot.viewport) && snapshot.searchControl.hit &&
    snapshot.searchControl.pointerEvents !== 'none' && !snapshot.searchControl.disabled,
    snapshot.searchControl);
}

async function realClick(cdp, selector) {
  const point = await cdp.call(function (value) {
    var node = document.querySelector(value);
    if (!node) return null;
    var rect = node.getBoundingClientRect();
    var x = rect.left + rect.width / 2;
    var y = rect.top + rect.height / 2;
    var hit = document.elementFromPoint(x, y);
    return { x:x, y:y, hit:!!(hit && (hit === node || node.contains(hit))) };
  }, [selector]);
  assert.ok(point && point.hit, `Control is not clickable: ${selector}`);
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:point.x, y:point.y });
  await cdp.send('Input.dispatchMouseEvent', { type:'mousePressed', x:point.x, y:point.y, button:'left', buttons:1, clickCount:1 });
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseReleased', x:point.x, y:point.y, button:'left', buttons:0, clickCount:1 });
}

async function domButtonClick(cdp, selector) {
  const clicked = await cdp.call(function (value) {
    var node = document.querySelector(value);
    if (!node || typeof node.click !== 'function') return false;
    node.click();
    return true;
  }, [selector]);
  assert.ok(clicked, `DOM button is unavailable: ${selector}`);
}

async function capture(cdp, scale, name) {
  const shot = await cdp.send('Page.captureScreenshot', { format:'png', fromSurface:true, captureBeyondViewport:false });
  const file = path.join(evidenceDir, `${Math.round(scale * 100)}-${name}.png`);
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  screenshots.push(file);
  return file;
}

async function stopActiveApp() {
  if (activeCdp) {
    activeCdp.close();
    activeCdp = null;
  }
  if (activeApp && activeApp.exitCode == null) {
    try { activeApp.kill(); } catch (_) {}
    await delay(450);
    if (activeApp.exitCode == null && process.platform === 'win32' && activeApp.pid) {
      spawnSync('taskkill', ['/PID', String(activeApp.pid), '/T', '/F'], { windowsHide:true, stdio:'ignore' });
    }
    await delay(1200);
  }
  activeApp = null;
}

async function runScale(scale, index) {
  const port = await freePort();
  const userData = path.join(tempRoot, `dpi-${String(scale).replace('.', '_')}`);
  fs.mkdirSync(userData, { recursive:true });
  const args = [
    `--user-data-dir=${userData}`,
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    `--force-device-scale-factor=${scale}`,
    '--window-size=1280,800'
  ];
  if (launchMode === 'source') args.unshift('.');
  activeApp = spawn(launchExecutable, args, {
    cwd:repo,
    windowsHide:true,
    stdio:['ignore', 'pipe', 'pipe'],
    env:Object.assign({}, process.env, {
      LUMIFIELD_SKIP_SPLASH:'1',
      ELECTRON_DISABLE_SECURITY_WARNINGS:'true',
      LF_ALLOW_PACKAGED_CDP_TEST:'1'
    })
  });
  const log = [];
  const collect = data => log.push(String(data));
  activeApp.stdout.on('data', collect);
  activeApp.stderr.on('data', collect);
  const rootPid = activeApp.pid;
  try {
    const target = await findMainTarget(port);
    activeCdp = new CDP(target.webSocketDebuggerUrl, scale);
    await activeCdp.connect();
    focusWindow(rootPid);
    await activeCdp.send('Page.bringToFront');
    await waitFor(() => activeCdp.call(function () {
      return document.readyState === 'complete' && window.desktopWindow && typeof desktopWindow.getState === 'function' &&
        document.getElementById('bottom-bar') && document.querySelector('[data-window-action="maximize"]');
    }), 60000, 160);
    await prepareUi(activeCdp);

    let initialState = await activeCdp.call(async function () { return desktopWindow.getState(); });
    if (initialState && initialState.isMaximized) {
      await domButtonClick(activeCdp, '[data-window-action="maximize"]');
      await waitFor(() => activeCdp.call(async function () {
        var state = await desktopWindow.getState();
        return state && !state.isMaximized ? state : null;
      }), 12000, 120);
      await delay(350);
      await prepareUi(activeCdp);
      initialState = await activeCdp.call(async function () { return desktopWindow.getState(); });
    }
    const initialWin32 = win32Snapshot(rootPid);
    pass(`${Math.round(scale * 100)}% initial: Win32 finds the real normal window`,
      initialWin32.visible && !initialWin32.maximized,
      initialWin32);
    const requestedNormalBounds = {
      left:Math.max(0, initialWin32.left),
      top:Math.max(0, initialWin32.top),
      width:Math.max(1000, initialWin32.width - 64),
      height:Math.max(600, initialWin32.height - 48)
    };
    const win32Resize = setWin32WindowBounds(rootPid, requestedNormalBounds);
    await delay(500);
    await prepareUi(activeCdp);
    const normalWin32 = await waitFor(() => {
      const value = win32Snapshot(rootPid);
      return value.visible && !value.maximized ? value : null;
    }, 15000, 200);
    const normalLayout = await layoutSnapshot(activeCdp, 'normal');
    validateLayout(scale, 'normal', normalLayout);
    pass(`${Math.round(scale * 100)}% normal: Win32 confirms a visible restored window`,
      normalWin32.visible && !normalWin32.maximized && normalWin32.width >= 900 && normalWin32.height >= 540,
      normalWin32);
    pass(`${Math.round(scale * 100)}% normal: Win32 SetWindowPos applies a real normal-window resize`,
      !!win32Resize.ok && normalWin32.visible && !normalWin32.maximized,
      { requested:requestedNormalBounds, operation:win32Resize, applied:normalWin32 });
    await capture(activeCdp, scale, 'normal');

    await realClick(activeCdp, '#mini-queue-btn');
    const queueOpened = await waitFor(() => activeCdp.call(function () {
      var button = document.getElementById('mini-queue-btn');
      var panel = document.getElementById('mini-queue-popover');
      return !!(button && panel && button.classList.contains('active') && panel.classList.contains('show') && getComputedStyle(panel).pointerEvents !== 'none');
    }), 5000, 100);
    pass(`${Math.round(scale * 100)}%: real CDP mouse click opens the player queue control`, !!queueOpened, queueOpened);
    await realClick(activeCdp, '#mini-queue-btn');

    await domButtonClick(activeCdp, '[data-window-action="maximize"]');
    const maximizedState = await waitFor(() => activeCdp.call(async function () {
      var state = await desktopWindow.getState();
      return state && state.isMaximized ? state : null;
    }), 12000, 120);
    await delay(500);
    const maximizedWin32 = win32Snapshot(rootPid);
    await prepareUi(activeCdp);
    const maximizedLayout = await layoutSnapshot(activeCdp, 'maximized');
    validateLayout(scale, 'maximized', maximizedLayout);
    pass(`${Math.round(scale * 100)}%: titlebar DOM button handler maximizes BrowserWindow and Win32 window`,
      !!maximizedState.isMaximized && maximizedWin32.visible &&
        (maximizedWin32.maximized || maximizedWin32.width > normalWin32.width + 100 || maximizedWin32.height > normalWin32.height + 100),
      { electron:maximizedState, win32:maximizedWin32 });
    await domButtonClick(activeCdp, '[data-window-action="maximize"]');
    const restoredState = await waitFor(() => activeCdp.call(async function () {
      var state = await desktopWindow.getState();
      return state && !state.isMaximized ? state : null;
    }), 12000, 120);
    await delay(500);
    const restoredWin32 = win32Snapshot(rootPid);
    await prepareUi(activeCdp);
    const restoredLayout = await layoutSnapshot(activeCdp, 'restored');
    validateLayout(scale, 'restored', restoredLayout);
    const boundDelta = {
      left:Math.abs(restoredWin32.left - normalWin32.left),
      top:Math.abs(restoredWin32.top - normalWin32.top),
      width:Math.abs(restoredWin32.width - normalWin32.width),
      height:Math.abs(restoredWin32.height - normalWin32.height)
    };
    pass(`${Math.round(scale * 100)}%: second titlebar DOM button handler restores the original window`,
      !restoredState.isMaximized && !restoredWin32.maximized &&
      boundDelta.left <= 32 && boundDelta.top <= 32 && boundDelta.width <= 32 && boundDelta.height <= 32,
      { electron:restoredState, win32:restoredWin32, boundDelta });

    const displayState = await activeCdp.call(async function () { return desktopWindow.getState(); });
    return {
      index,
      requestedScale:scale,
      measuredScale:normalLayout.viewport.dpr,
      target:{ id:target.id, type:target.type, url:target.url },
      normal:{ requested:requestedNormalBounds, operation:win32Resize, win32:normalWin32, layout:normalLayout },
      maximized:{ win32:maximizedWin32, layout:maximizedLayout },
      restored:{ win32:restoredWin32, layout:restoredLayout },
      displayState,
      multiMonitorExercised:!!(displayState && (displayState.hasDisplayOnLeft || displayState.hasDisplayOnRight)),
      logTail:log.join('').slice(-10000)
    };
  } finally {
    appLogs.push({ scale, tail:log.join('').slice(-10000) });
    await stopActiveApp();
  }
}

function writeJson(name, value) {
  const file = path.join(evidenceDir, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

(async function main() {
  for (let index = 0; index < scales.length; index += 1) {
    results.push(await runScale(scales[index], index));
  }
  pass('all requested DPI scales were exercised in separate real Electron processes',
    results.length === scales.length && results.every((item, index) => Math.abs(item.requestedScale - scales[index]) <= 0.001),
    results.map(item => ({ requested:item.requestedScale, measured:item.measuredScale })));
  pass('no uncaught renderer exception during DPI/window workflow', rendererErrors.length === 0, rendererErrors);
  const environment = {
    platform:process.platform,
    osRelease:os.release(),
    osVersion:typeof os.version === 'function' ? os.version() : '',
    arch:process.arch,
    launchMode,
    launchExecutable,
    dpiMethod:'separate Electron process with --force-device-scale-factor; measured by CDP devicePixelRatio',
    windowMethod:'Win32 SetWindowPos resize; titlebar DOM button handler through page CDP; Electron state plus Win32 GetWindowPlacement verification; real CDP pointer input is separately verified on the queue control',
    browserDomain:'Electron remote debugging in this runtime does not expose Browser.getWindowForTarget; no Browser-domain result is claimed.',
    multiMonitorExercised:results.some(item => item.multiMonitorExercised),
    limitations:results.some(item => item.multiMonitorExercised) ? [] : ['No secondary display was exposed by the current host; multi-monitor behavior was not claimed.']
  };
  const result = {
    ok:true,
    runId,
    environment,
    scales,
    checks,
    results,
    screenshots,
    rendererErrors,
    completedAt:new Date().toISOString()
  };
  const resultFile = writeJson('result.json', result);
  console.log(JSON.stringify({ ok:true, launchMode, resultFile, scales, checks:Object.keys(checks).length, screenshots:screenshots.length, limitations:environment.limitations }, null, 2));
})().catch(async error => {
  await stopActiveApp();
  const failure = {
    ok:false,
    runId,
    launchMode,
    launchExecutable,
    scales,
    error:error && error.stack || String(error),
    checks,
    results,
    screenshots,
    rendererErrors,
    appLogs,
    completedAt:new Date().toISOString()
  };
  const failureFile = writeJson('failure.json', failure);
  console.error(JSON.stringify({ ok:false, failureFile, error:failure.error }, null, 2));
  process.exitCode = 1;
}).finally(() => {
  try { fs.rmSync(tempRoot, { recursive:true, force:true }); } catch (_) {}
});
