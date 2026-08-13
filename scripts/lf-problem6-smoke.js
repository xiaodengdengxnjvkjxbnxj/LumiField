'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const repo = path.resolve(__dirname, '..');
const electron = require('electron');
const installedExecutable = String(process.env.LF_PROBLEM6_EXECUTABLE || '').trim();
const launchExecutable = installedExecutable || electron;
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.resolve(process.env.LF_PROBLEM6_OUT || path.join(repo, 'test-results', 'lf-problem6-smoke', runId));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-problem6-'));
const videoAuditDir = path.join(repo, 'test-results', 'lf-problem6-video-audit');
const checks = {};
const screenshots = [];
const rendererErrors = [];
const appLog = [];
let app = null;
let cdp = null;
let origin = '';

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

async function waitFor(fn, timeout = 30000, interval = 80) {
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
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result || {});
      } else if (message.method === 'Runtime.exceptionThrown') {
        const detail = message.params && message.params.exceptionDetails || {};
        rendererErrors.push(String(detail.exception && detail.exception.description || detail.text || 'Renderer exception').slice(0, 2000));
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

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
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

async function findMainTarget(port) {
  return waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json();
    return targets.find(target =>
      target.type === 'page' &&
      /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//.test(target.url));
  }, 50000, 160);
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

function matrixDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return Infinity;
  return Math.sqrt(a.reduce((sum, value, index) => sum + Math.pow(Number(value) - Number(b[index]), 2), 0));
}

function rectIntersects(a, b, tolerance = 2) {
  if (!a || !b) return false;
  return a.left < b.right - tolerance &&
    a.right > b.left + tolerance &&
    a.top < b.bottom - tolerance &&
    a.bottom > b.top + tolerance;
}

function videoAudit() {
  const summaryPath = path.join(videoAuditDir, 'video-audit-summary.json');
  const eventPath = path.join(videoAuditDir, 'lyric-events.json');
  const reportPath = path.join(videoAuditDir, 'report.md');
  const frameDir = path.join(videoAuditDir, 'frames-30fps');
  const metricPath = path.join(videoAuditDir, 'frame-metrics.csv');
  pass('857-frame audit artifacts exist',
    fs.existsSync(summaryPath) && fs.existsSync(eventPath) && fs.existsSync(reportPath) &&
    fs.existsSync(frameDir) && fs.existsSync(metricPath));

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const audit = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const frames = fs.readdirSync(frameDir)
    .filter(name => /^frame-\d{4}\.jpg$/i.test(name))
    .sort();
  const expectedNames = Array.from({ length: 857 }, (_, index) => `frame-${String(index + 1).padStart(4, '0')}.jpg`);
  const metricRows = fs.readFileSync(metricPath, 'utf8').trim().split(/\r?\n/);
  pass('video metadata is exact 1440x1080 30fps 857 frames',
    summary.width === 1440 && summary.height === 1080 && Number(summary.fps) === 30 &&
    summary.frames === 857 && Math.abs(summary.duration_s_by_frames - 28.566667) < 0.00001,
    { width:summary.width, height:summary.height, fps:summary.fps, frames:summary.frames, duration:summary.duration_s_by_frames });
  pass('all decoded frames and metric rows are gap-free',
    JSON.stringify(frames) === JSON.stringify(expectedNames) && metricRows.length === 858,
    { frameFiles:frames.length, metricRows:metricRows.length - 1, first:frames[0], last:frames[frames.length - 1] });

  const sheets = summary.contact_sheets && summary.contact_sheets.all_frames || [];
  let nextFrame = 1;
  let sheetsContinuous = sheets.length > 0;
  for (const sheet of sheets) {
    sheetsContinuous = sheetsContinuous && sheet.first_frame === nextFrame && sheet.last_frame >= sheet.first_frame;
    nextFrame = sheet.last_frame + 1;
  }
  sheetsContinuous = sheetsContinuous && nextFrame === 858;
  pass('contact-sheet manifest covers frame 1 through 857 continuously', sheetsContinuous, sheets);

  const events = Array.isArray(audit.events) ? audit.events : [];
  const phrases = Array.isArray(audit.phrases) ? audit.phrases : [];
  const chronological = events.every((event, index) =>
    Number.isInteger(event.frame) && event.frame >= 1 && event.frame <= 857 &&
    Math.abs(Number(event.timestamp_s) - (event.frame - 1) / 30) <= 0.00051 &&
    (index === 0 || event.frame >= events[index - 1].frame));
  const completePhrases = phrases.every(phrase => {
    const own = events.filter(event => event.phrase_id === phrase.id);
    const visible = own.filter(event => event.type === 'phrase-enter' || event.type === 'line-enter')
      .map(event => event.visible_line_count);
    return phrase.lines.length === visible.length &&
      visible.every((count, index) => count === index + 1) &&
      own.some(event => event.type === 'phrase-exit-start') &&
      own.some(event => event.type === 'phrase-cleared') &&
      phrase.lines.every(line =>
        line.center_px && line.bbox_px && line.rotation_deg &&
        Number.isFinite(line.depth_normalized) && Number.isFinite(line.opacity_at_reference));
  });
  pass('79 visual events are chronological and every phrase has complete geometry lifecycle',
    events.length === 79 && phrases.length === 10 && chronological && completePhrases,
    { events:events.length, phrases:phrases.length, chronological, completePhrases });
  return { summaryPath, eventPath, reportPath, frames:frames.length, events:events.length, phrases:phrases.length };
}

function staticAudit() {
  const taskPath = path.join(repo, 'public', 'lumifield-task13.js');
  const cssPath = path.join(repo, 'public', 'lumifield-task13.css');
  const indexPath = path.join(repo, 'public', 'index.html');
  const task = fs.readFileSync(taskPath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');
  const index = fs.readFileSync(indexPath, 'utf8');
  const lyricStart = task.indexOf('// ---------- Original lyrics / shared Three.js sentence animation ----------');
  const lyricEnd = task.indexOf('// ---------- Unified SpectrumState', lyricStart);
  assert.ok(lyricStart >= 0 && lyricEnd > lyricStart, 'problem 6 Task13 lyric bridge block was not found');
  const lyricBridge = task.slice(lyricStart, lyricEnd);
  const coreStart = index.indexOf('var STAGE_LYRIC_ANIMATION_MAX_LINES');
  const coreEnd = index.indexOf('\nfunction showStageLine', coreStart);
  assert.ok(coreStart >= 0 && coreEnd > coreStart, 'problem 6 Three.js core block was not found');
  const core = index.slice(coreStart, coreEnd);

  pass('old typewriter renderer and LRC estimated-word mode are removed',
    !/buildAnimatedTimeline|updateAnimatedLine|lf-t13-glyph|estimated-word|LRC估算/.test(task + css));
  pass('bridge creates no camera renderer RAF or lyric request',
    !/new\s+THREE\.(?:PerspectiveCamera|OrthographicCamera|WebGLRenderer)/.test(lyricBridge) &&
    !/requestAnimationFrame\s*\(/.test(lyricBridge) &&
    !/fetch\s*\(\s*['"`]\/api\/(?!translate\/lyrics)[^'"`]*lyric/i.test(lyricBridge));
  pass('Three core exposes shared lifecycle and debug APIs',
    /setStageLyricAnimationMode/.test(core) &&
    /syncStageLyricAnimationAt/.test(core) &&
    /refreshStageLyricAnimation/.test(core) &&
    /getStageLyricAnimationDebug/.test(core) &&
    /sharedScene/.test(core) && /sharedCamera/.test(core) && /sharedRenderer/.test(core));
  pass('Three core creates no second camera renderer or RAF',
    !/new\s+THREE\.(?:PerspectiveCamera|OrthographicCamera|WebGLRenderer)/.test(core) &&
    !/requestAnimationFrame\s*\(/.test(core));
  pass('lyric bridge is pointer transparent and contains no blur or 2D skew simulation',
    /#lf-t13-lyrics[^{}]*\{[^{}]*pointer-events\s*:\s*none!important/i.test(css) &&
    !/#lf-t13-lyrics[^}]*filter\s*:\s*blur/i.test(css) &&
    !/lf-t13-(?:lyrics|animation)[^}]*\bskew/i.test(css));
  return {
    taskBytes:Buffer.byteLength(task),
    cssBytes:Buffer.byteLength(css),
    coreBytes:Buffer.byteLength(core),
  };
}

const fixtures = {
  lines: [
    { t:1, duration:1, text:'第一句完整出现', translation:'First complete sentence', source:'yrc-word' },
    { t:2, duration:1, text:'Second line appears whole', translation:'第二句完整出现', source:'yrc-word' },
    { t:3, duration:1, text:'三行交错向左', translation:'Third line', source:'qrc-word' },
    { t:4, duration:1, text:'第四行向右下方', translation:'Fourth line', source:'ttml-word' },
    { t:5, duration:1, text:'五行触发安全退场', translation:'Safe retirement', source:'krc-word' },
    { t:6, duration:1, text:'日本語も鮮明に表示', translation:'Japanese remains sharp', source:'yrc-word' },
    { t:7, duration:1, text:'Seek target sentence', translation:'跳转目标句', source:'qrc-word' },
    { t:8, duration:1, text:'最后一行保持完整', translation:'Final complete line', source:'ttml-word' },
  ],
  nextLines: [
    { t:1, duration:1.3, text:'切歌后的新歌词', translation:'New track lyric', source:'yrc-word' },
    { t:2.3, duration:1.3, text:'旧歌词必须全部清理', translation:'Old lyrics removed', source:'yrc-word' },
  ],
};

async function twoFrames() {
  return cdp.call(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))));
}

async function setTime(time, options = {}) {
  return cdp.call(function (value, opts) {
    audio.currentTime = value;
    window.lumiFieldSeekingAudio = !!opts.seek;
    const debug = window.syncStageLyricAnimationAt(value, {
      seek:!!opts.seek,
      force:!!opts.force,
      instant:!!opts.instant,
      translate:true,
    });
    window.lumiFieldSeekingAudio = false;
    return debug;
  }, [time, options]);
}

async function dispatchMouse(type, x, y, extra = {}) {
  await cdp.send('Input.dispatchMouseEvent', Object.assign({
    type,
    x:Math.round(x),
    y:Math.round(y),
    button:'none',
  }, extra));
}

async function run() {
  const videoEvidence = videoAudit();
  const staticEvidence = staticAudit();
  if (installedExecutable) {
    pass('installed executable path exists', fs.existsSync(installedExecutable), installedExecutable);
  }
  const port = await freePort();
  const launchArgs = (installedExecutable ? [] : ['.']).concat([
    `--user-data-dir=${userData}`,
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    '--window-size=1600,1000',
  ]);
  app = spawn(launchExecutable, launchArgs, {
    cwd:installedExecutable ? path.dirname(installedExecutable) : repo,
    env:Object.assign({}, process.env, {
      LUMIFIELD_SKIP_SPLASH:'1',
      LF_ALLOW_LOCAL_CODES:'1',
      LF_ALLOW_PACKAGED_CDP_TEST:'1',
      ELECTRON_DISABLE_SECURITY_WARNINGS:'true',
      LF_MAIL_HOST:' ',
      LF_MAIL_USER:' ',
      LF_MAIL_PASSWORD:' ',
      LF_REMOTE_API_URL:' ',
    }),
    windowsHide:true,
    stdio:['ignore', 'pipe', 'pipe'],
  });
  const collect = chunk => {
    const text = String(chunk);
    appLog.push(text);
    if (/(?:FATAL|uncaught exception|renderer process crashed)/i.test(text)) rendererErrors.push(text.trim().slice(0, 2000));
  };
  app.stdout.on('data', collect);
  app.stderr.on('data', collect);

  const target = await findMainTarget(port);
  origin = new URL(target.url).origin;
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await waitFor(() => cdp.call(function () {
    return document.readyState === 'complete' &&
      window.LumiFieldTask13 &&
      typeof window.getStageLyricAnimationDebug === 'function' &&
      typeof window.syncStageLyricAnimationAt === 'function' &&
      window.renderer && window.scene && window.camera;
  }), 50000, 120);

  const setup = await cdp.call(function (fixtureLines) {
    document.body.classList.remove('lf-auth-locked', 'empty-home-active', 'splash-active', 'render-deep-sleep');
    document.body.classList.add('diy-mode');
    const auth = document.getElementById('lf-auth-root');
    if (auth) { auth.classList.remove('show'); auth.style.setProperty('display', 'none', 'important'); }
    const splash = document.getElementById('splash');
    if (splash) splash.style.display = 'none';
    if (typeof window.closeLoginModal === 'function') window.closeLoginModal();
    if (typeof window.closeUserModal === 'function') window.closeUserModal();
    ['login-modal', 'user-modal'].forEach(function (id) {
      const modal = document.getElementById(id);
      if (modal) { modal.classList.remove('show'); modal.style.display = 'none'; }
    });
    window.isVisualStageInteractionActive = function () { return true; };
    if (typeof window.toggleFxPanel === 'function') window.toggleFxPanel(false);
    if (typeof window.togglePlaylistPanel === 'function') window.togglePlaylistPanel(false);
    window.__p6LyricRequests = 0;
    window.__p6OriginalFetch = window.fetch;
    window.fetch = function () {
      const url = String(arguments[0] && arguments[0].url || arguments[0] || '');
      if (/\/api\/.*lyric/i.test(url)) window.__p6LyricRequests += 1;
      return window.__p6OriginalFetch.apply(this, arguments);
    };
    window.playQueue = [{ provider:'fixture', id:'p6-track-a', name:'P6 fixture', artist:'LumiField QA' }];
    window.currentIdx = 0;
    window.lyricsLines = fixtureLines.map(line => Object.assign({}, line));
    window.lyricsTimingSource = 'yrc-word';
    const testAudio = new Audio();
    Object.defineProperty(testAudio, 'currentTime', { configurable:true, writable:true, value:1.001 });
    Object.defineProperty(testAudio, 'paused', { configurable:true, get:function () { return !!this.__p6Paused; } });
    Object.defineProperty(testAudio, 'seeking', { configurable:true, get:function () { return !!this.__p6Seeking; } });
    testAudio.__p6Paused = false;
    testAudio.__p6Seeking = false;
    window.audio = testAudio;
    window.playing = true;
    LumiFieldTask13.setLyricState({ mode:'animation', translate:true });
    window.syncStageLyricAnimationAt(1.001, { force:true, instant:true, translate:true });
    return { debug:LumiFieldTask13.getLyricDebug(), requests:window.__p6LyricRequests };
  }, [fixtures.lines]);
  await twoFrames();
  const first = await cdp.call(() => window.LumiFieldTask13.getLyricDebug());
  pass('whole sentence exists within two frames with no typewriter state',
    setup.debug.wholeSentence === true && setup.debug.typewriter === false &&
    first.lineCount === 1 && first.lines[0].text === fixtures.lines[0].text &&
    first.lines[0].opacity > 0 && first.timingQuality === 'whole-sentence' &&
    first.estimated === false && first.tokenCount === 0 && first.revealedCount === 0,
    first);
  pass('Task13 bridge owns no RAF listener or lyric request',
    first.rafOwned === 0 && first.listenerCount === 0 && setup.requests === 0,
    { rafOwned:first.rafOwned, listenerCount:first.listenerCount, requests:setup.requests });

  const retained = [];
  for (const time of [2.01, 3.01, 4.01]) {
    await setTime(time - 0.22);
    await setTime(time);
    await twoFrames();
    retained.push(await cdp.call(() => window.getStageLyricAnimationDebug()));
  }
  await delay(360);
  const four = await cdp.call(() => window.getStageLyricAnimationDebug());
  const positions = four.lines.map(line => line.targetPosition);
  const rotations = four.lines.map(line => line.rotationDegrees);
  pass('three then four complete lines are retained as one zigzag stair',
    retained[0].lineCount === 2 && retained[1].lineCount === 3 && four.lineCount === 4 &&
    JSON.stringify(four.lines.map(line => line.index)) === JSON.stringify([0, 1, 2, 3]) &&
    positions[0].x < 0 && positions[1].x > 0 && positions[2].x < 0 && positions[3].x > 0 &&
    positions.every((position, index) => index === 0 || position.y < positions[index - 1].y),
    four.lines);
  pass('all retained lines are true Three objects with nonzero xyz rotation and shared parent',
    four.lines.every(line =>
      line.meshUuid && line.parentUuid === four.stageGroupUuid &&
      Math.abs(line.rotationDegrees.x) > 0.5 &&
      Math.abs(line.rotationDegrees.y) > 0.5 &&
      Math.abs(line.rotationDegrees.z) > 0.5) &&
    new Set(four.lines.map(line => line.parentUuid)).size === 1,
    rotations);
  pass('lyrics reuse the exact LF scene camera renderer and particle transform',
    four.sharedScene && four.sharedCamera && four.sharedRenderer && four.sharedParticleTransform &&
    four.sharedMatrix && four.sceneUuid === windowValue(four.sceneUuid) &&
    four.stageWorldMatrix.length === 16 && four.particleWorldMatrix.length === 16 &&
    four.rafOwned === 0,
    {
      sceneUuid:four.sceneUuid, cameraUuid:four.cameraUuid, rendererUuid:four.rendererUuid,
      stageGroupUuid:four.stageGroupUuid, transformBasis:four.transformBasis,
    });

  await screenshot('01-four-whole-sentence-three-scene');

  await setTime(4.78);
  await setTime(5.01);
  await delay(420);
  const retired = await cdp.call(() => window.getStageLyricAnimationDebug());
  pass('oldest line exits safely and the active window remains bounded to four',
    retired.lineCount === 4 && retired.outgoingCount === 0 &&
    JSON.stringify(retired.lines.map(line => line.index)) === JSON.stringify([1, 2, 3, 4]),
    retired);

  const consoleOpen = await cdp.call(async function () {
    setFxPanelTab('presets');
    toggleFxPanel(true);
    await new Promise(resolve => setTimeout(resolve, 620));
    const panel = document.getElementById('fx-panel');
    const summary = document.querySelector('#lf-t13-lyric-block>summary');
    summary.scrollIntoView({ block:'center' });
    await new Promise(resolve => requestAnimationFrame(resolve));
    const panelRect = panel.getBoundingClientRect();
    const summaryRect = summary.getBoundingClientRect();
    const hit = document.elementFromPoint(summaryRect.left + summaryRect.width / 2, summaryRect.top + summaryRect.height / 2);
    return {
      panelRect:{ left:panelRect.left, top:panelRect.top, right:panelRect.right, bottom:panelRect.bottom, width:panelRect.width, height:panelRect.height },
      point:{ x:summaryRect.left + summaryRect.width / 2, y:summaryRect.top + summaryRect.height / 2 },
      hitInsidePanel:!!(hit && hit.closest('#fx-panel')),
      pointerEvents:getComputedStyle(document.getElementById('lf-t13-lyrics')).pointerEvents,
      detailsOpen:document.getElementById('lf-t13-lyric-block').open,
    };
  });
  const rightOpenBefore = (await cdp.call(() => window.getStageLyricAnimationDebug())).safeInsets.right;
  await dispatchMouse('mousePressed', consoleOpen.point.x, consoleOpen.point.y, { button:'left', buttons:1, clickCount:1 });
  await dispatchMouse('mouseReleased', consoleOpen.point.x, consoleOpen.point.y, { button:'left', buttons:0, clickCount:1 });
  await delay(100);
  await cdp.call(() => {
    document.getElementById('fx-panel').scrollTop = 0;
    return true;
  });
  await dispatchMouse('mouseWheel',
    (consoleOpen.panelRect.left + consoleOpen.panelRect.right) / 2,
    (consoleOpen.panelRect.top + consoleOpen.panelRect.bottom) / 2,
    { deltaX:0, deltaY:620 });
  await delay(240);
  const consoleAfter = await cdp.call(function () {
    const panel = document.getElementById('fx-panel');
    const debug = window.getStageLyricAnimationDebug();
    return {
      scrollTop:panel.scrollTop,
      detailsOpen:document.getElementById('lf-t13-lyric-block').open,
      debug,
    };
  });
  const noPanelOverlap = consoleAfter.debug.lines.every(line =>
    !rectIntersectsLocal(line.projectedRect, consoleOpen.panelRect));
  pass('visual console stays in front and remains physically clickable and scrollable',
    consoleOpen.hitInsidePanel && consoleOpen.pointerEvents === 'none' &&
    consoleAfter.detailsOpen !== consoleOpen.detailsOpen && consoleAfter.scrollTop > 20,
    { before:consoleOpen, after:{ scrollTop:consoleAfter.scrollTop, detailsOpen:consoleAfter.detailsOpen } });
  pass('open console creates a right safe inset and projected lyrics avoid it',
    rightOpenBefore >= Math.round(consoleOpen.panelRect.width) && noPanelOverlap,
    { rightOpenBefore, panelWidth:consoleOpen.panelRect.width, lines:consoleAfter.debug.lines.map(line => line.projectedRect) });
  await screenshot('02-console-front-click-scroll-safe-area');

  const lineCountBeforeClose = consoleAfter.debug.lineCount;
  await cdp.call(() => { toggleFxPanel(false); return true; });
  await delay(520);
  const consoleClosed = await cdp.call(() => window.getStageLyricAnimationDebug());
  pass('closing console restores safe area without globally hiding lyrics',
    consoleClosed.safeInsets.right < rightOpenBefore && consoleClosed.lineCount === lineCountBeforeClose &&
    consoleClosed.enabled,
    { openRight:rightOpenBefore, closedRight:consoleClosed.safeInsets.right, lineCount:consoleClosed.lineCount });

  const beforeFont = consoleClosed;
  const fontChanged = await cdp.call(async function () {
    setLyricFont('kai-song');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return window.getStageLyricAnimationDebug();
  });
  pass('font switch rebuilds every visible texture immediately',
    fontChanged.fontKey === 'kai-song' && fontChanged.lines.length === beforeFont.lines.length &&
    fontChanged.lines.every(line => line.fontKey === 'kai-song') &&
    fontChanged.lines.every(line => {
      const old = beforeFont.lines.find(previous => previous.index === line.index);
      return old && old.textureUuid && line.textureUuid && old.textureUuid !== line.textureUuid;
    }),
    { before:beforeFont.lines.map(line => [line.index, line.textureUuid]), after:fontChanged.lines.map(line => [line.index, line.textureUuid, line.fontKey]) });
  await setTime(5.78);
  await setTime(6.01);
  await twoFrames();
  const futureFont = await cdp.call(() => window.getStageLyricAnimationDebug());
  pass('future lyric lines keep the selected font',
    futureFont.fontKey === 'kai-song' && futureFont.lines.every(line => line.fontKey === 'kai-song'), futureFont.lines);
  await screenshot('03-font-refresh-all-lines');

  const pause = await cdp.call(async function () {
    audio.__p6Paused = true;
    playing = false;
    const before = window.getStageLyricAnimationDebug();
    await new Promise(resolve => setTimeout(resolve, 420));
    const after = window.getStageLyricAnimationDebug();
    return { before, after };
  });
  pass('pause freezes current line identities transforms and opacity',
    JSON.stringify(pause.before.lines.map(line => [line.meshUuid, line.position, line.rotationDegrees, line.opacity])) ===
      JSON.stringify(pause.after.lines.map(line => [line.meshUuid, line.position, line.rotationDegrees, line.opacity])),
    pause);
  await cdp.call(() => { audio.__p6Paused = false; playing = true; return true; });

  const seekForward = await setTime(7.01, { seek:true });
  const seekBack = await setTime(3.01, { seek:true });
  pass('forward and backward seek rebuild the target window immediately without catch-up',
    seekForward.currentIndex === 6 &&
    JSON.stringify(seekForward.lines.map(line => line.index)) === JSON.stringify([3, 4, 5, 6]) &&
    seekForward.outgoingCount === 0 &&
    seekBack.currentIndex === 2 &&
    JSON.stringify(seekBack.lines.map(line => line.index)) === JSON.stringify([0, 1, 2]) &&
    seekBack.outgoingCount === 0,
    { forward:seekForward.lines.map(line => line.index), back:seekBack.lines.map(line => line.index) });

  const trackChange = await cdp.call(function (nextLines) {
    const oldIds = window.getStageLyricAnimationDebug().lines.map(line => line.meshUuid);
    playQueue[0] = { provider:'fixture', id:'p6-track-b', name:'P6 new track', artist:'LumiField QA' };
    lyricsLines = nextLines.map(line => Object.assign({}, line));
    lyricsTimingSource = 'yrc-word';
    audio.currentTime = 1.01;
    const debug = syncStageLyricAnimationAt(1.01, { seek:true, force:true, instant:true, translate:true });
    const aliveOld = oldIds.filter(id => scene.getObjectByProperty('uuid', id)).length;
    return { oldIds, aliveOld, debug };
  }, [fixtures.nextLines]);
  pass('track change disposes every old lyric object and renders only the new track',
    trackChange.aliveOld === 0 && trackChange.debug.lineCount === 1 &&
    trackChange.debug.lines[0].text === fixtures.nextLines[0].text,
    trackChange);

  const noLyrics = await cdp.call(function () {
    if (typeof applyLyricsState === 'function') applyLyricsState([], false, 'none');
    else { lyricsLines = []; lyricsTimingSource = 'none'; }
    return syncStageLyricAnimationAt(2, { seek:true, force:true, instant:true });
  });
  pass('no-real-lyrics state renders no title fallback or fake sentence',
    !noLyrics.realTimeline && noLyrics.lineCount === 0 && noLyrics.outgoingCount === 0 &&
    /no-real-lyrics|before-timeline/.test(noLyrics.reason),
    noLyrics);

  await cdp.call(function (fixtureLines) {
    playQueue[0] = { provider:'fixture', id:'p6-track-c', name:'P6 coexist', artist:'LumiField QA' };
    lyricsLines = fixtureLines.map(line => Object.assign({}, line));
    lyricsTimingSource = 'yrc-word';
    audio.currentTime = 4.01;
    LumiFieldTask13.setLyricState({ mode:'animation', translate:true });
    syncStageLyricAnimationAt(4.01, { seek:true, force:true, instant:true, translate:true });
    return true;
  }, [fixtures.lines]);
  const coexist = await cdp.call(async function () {
    const requestsBefore = window.__p6LyricRequests;
    LumiFieldTask13.setEchoState({ enabled:true, shape:'one', mode1LeftLyricsEnabled:true });
    if (window.LumiFieldAudioEchoManager && typeof LumiFieldAudioEchoManager.updateLyricTimeline === 'function') {
      LumiFieldAudioEchoManager.updateLyricTimeline(true);
    }
    await new Promise(resolve => setTimeout(resolve, 220));
    const left = document.getElementById('lf-mode1-left-lyrics-layer');
    const current = left && left.querySelector('.lf-mode1-left-lyrics-row.current');
    const core = getStageLyricAnimationDebug();
    const plane = left && left.querySelector('.lf-mode1-left-lyrics-plane');
    const rect = plane && plane.getBoundingClientRect();
    return {
      requestsBefore, requestsAfter:window.__p6LyricRequests,
      leftMounted:!!(left && left.isConnected),
      leftText:current && current.querySelector('span') && current.querySelector('span').textContent,
      leftIndex:current && Number(current.dataset.lyricIndex),
      leftPointer:left && getComputedStyle(left).pointerEvents,
      leftRect:rect && { left:rect.left, top:rect.top, right:rect.right, bottom:rect.bottom, width:rect.width, height:rect.height },
      core,
    };
  });
  const p4NoOverlap = coexist.core.lines.every(line => !rectIntersectsLocal(line.projectedRect, coexist.leftRect));
  pass('P4 left lyrics and P6 Three lyrics coexist on the same timeline without a new request',
    coexist.leftMounted && coexist.leftPointer === 'none' &&
    coexist.leftIndex === coexist.core.currentIndex &&
    coexist.leftText === fixtures.lines[3].text &&
    coexist.requestsAfter === coexist.requestsBefore && p4NoOverlap,
    coexist);
  await screenshot('04-p4-left-and-p6-shared-timeline');

  const independent = await cdp.call(async function () {
    LumiFieldTask13.setEchoState({ mode1LeftLyricsEnabled:false });
    await new Promise(resolve => setTimeout(resolve, 80));
    const p6AfterLeftOff = getStageLyricAnimationDebug();
    const leftOff = !document.getElementById('lf-mode1-left-lyrics-layer');
    LumiFieldTask13.setEchoState({ mode1LeftLyricsEnabled:true });
    await new Promise(resolve => setTimeout(resolve, 80));
    LumiFieldTask13.setLyricState({ mode:'normal' });
    await new Promise(resolve => setTimeout(resolve, 80));
    return {
      leftOff,
      p6AfterLeftOff,
      p6Disabled:getStageLyricAnimationDebug(),
      leftStillMounted:!!document.getElementById('lf-mode1-left-lyrics-layer'),
    };
  });
  pass('P4 and P6 switches are independent in both directions',
    independent.leftOff && independent.p6AfterLeftOff.enabled && independent.p6AfterLeftOff.lineCount === 4 &&
    !independent.p6Disabled.enabled && independent.p6Disabled.lineCount === 0 && independent.leftStillMounted,
    independent);

  const cycles = await cdp.call(async function () {
    LumiFieldTask13.setEchoState({ mode1LeftLyricsEnabled:false, enabled:false });
    const rows = [];
    for (let index = 0; index < 20; index++) {
      LumiFieldTask13.setLyricState({ mode:'animation', translate:false });
      syncStageLyricAnimationAt(4.01, { force:true, instant:true });
      LumiFieldTask13.setLyricState({ mode:'normal' });
      const debug = getStageLyricAnimationDebug();
      let sceneRows = 0;
      scene.traverse(object => { if (object.userData && object.userData.stageLyricAnimation) sceneRows += 1; });
      rows.push({
        enabled:debug.enabled, lineCount:debug.lineCount, outgoingCount:debug.outgoingCount,
        sceneRows, rafOwned:LumiFieldTask13.getLyricDebug().rafOwned,
        listenerCount:LumiFieldTask13.getLyricDebug().listenerCount,
      });
    }
    return rows;
  });
  pass('twenty close reopen cycles leave zero Three objects RAFs and listeners',
    cycles.every(row => !row.enabled && row.lineCount === 0 && row.outgoingCount === 0 &&
      row.sceneRows === 0 && row.rafOwned === 0 && row.listenerCount === 0),
    cycles);

  await cdp.call(function (fixtureLines) {
    lyricsLines = fixtureLines.map(line => Object.assign({}, line));
    lyricsTimingSource = 'yrc-word';
    audio.currentTime = 4.01;
    playing = true;
    audio.__p6Paused = false;
    LumiFieldTask13.setLyricState({ mode:'animation', translate:true });
    syncStageLyricAnimationAt(4.01, { seek:true, force:true, instant:true, translate:true });
    return true;
  }, [fixtures.lines]);
  await twoFrames();
  const interactionBefore = await cdp.call(function () {
    const debug = getStageLyricAnimationDebug();
    return {
      debug,
      width:innerWidth, height:innerHeight,
      mouseWorld:{ x:mouseWorld.x, y:mouseWorld.y },
      radius:orbit.userRadius,
    };
  });
  const x0 = interactionBefore.width * 0.34;
  const y0 = interactionBefore.height * 0.35;
  const x1 = interactionBefore.width * 0.53;
  const y1 = interactionBefore.height * 0.52;
  await dispatchMouse('mouseMoved', x0, y0);
  await delay(80);
  const hover = await cdp.call(() => ({ x:mouseWorld.x, y:mouseWorld.y, active:mouseActive }));
  await dispatchMouse('mousePressed', x0, y0, { button:'left', buttons:1, clickCount:1 });
  for (let step = 1; step <= 6; step++) {
    await dispatchMouse('mouseMoved', x0 + (x1 - x0) * step / 6, y0 + (y1 - y0) * step / 6, {
      button:'left', buttons:1,
    });
    await delay(18);
  }
  await dispatchMouse('mouseReleased', x1, y1, { button:'left', buttons:0, clickCount:1 });
  await delay(320);
  const dragged = await cdp.call(() => ({
    debug:getStageLyricAnimationDebug(),
    gesture:{ x:gestureRotation.x, y:gestureRotation.y },
    radius:orbit.userRadius,
  }));
  pass('mouse hover updates the shared particle pointer without lyric hit capture',
    hover.active && Number.isFinite(hover.x) && Number.isFinite(hover.y) &&
    (hover.x !== interactionBefore.mouseWorld.x || hover.y !== interactionBefore.mouseWorld.y),
    { before:interactionBefore.mouseWorld, hover });
  pass('physical canvas drag rotates particles and the lyric shared matrix together',
    Math.abs(dragged.gesture.x) + Math.abs(dragged.gesture.y) > 0.01 &&
    matrixDistance(interactionBefore.debug.particleWorldMatrix, dragged.debug.particleWorldMatrix) > 0.001 &&
    matrixDistance(interactionBefore.debug.stageWorldMatrix, dragged.debug.stageWorldMatrix) > 0.001 &&
    dragged.debug.sharedMatrix,
    { gesture:dragged.gesture, stageDelta:matrixDistance(interactionBefore.debug.stageWorldMatrix, dragged.debug.stageWorldMatrix),
      particleDelta:matrixDistance(interactionBefore.debug.particleWorldMatrix, dragged.debug.particleWorldMatrix) });

  await dispatchMouse('mouseWheel', x1, y1, { deltaX:0, deltaY:360 });
  await delay(420);
  const zoomed = await cdp.call(() => ({ debug:getStageLyricAnimationDebug(), radius:orbit.userRadius }));
  const zoomRectBefore = dragged.debug.lines[dragged.debug.lines.length - 1].projectedRect;
  const zoomRectAfter = zoomed.debug.lines[zoomed.debug.lines.length - 1].projectedRect;
  pass('wheel zoom changes the shared camera projection for lyrics',
    Math.abs(zoomed.radius - dragged.radius) > 0.05 &&
    (Math.abs(zoomRectAfter.width - zoomRectBefore.width) > 0.5 ||
      Math.abs(zoomRectAfter.left - zoomRectBefore.left) > 0.5 ||
      Math.abs(zoomRectAfter.top - zoomRectBefore.top) > 0.5),
    { beforeRadius:dragged.radius, afterRadius:zoomed.radius,
      beforeRect:zoomRectBefore, afterRect:zoomRectAfter });

  await dispatchMouse('mousePressed', x1, y1, { button:'left', buttons:1, clickCount:2 });
  await dispatchMouse('mouseReleased', x1, y1, { button:'left', buttons:0, clickCount:2 });
  await delay(850);
  const reset = await cdp.call(() => ({
    centered:orbit.centerLocked,
    recentering:orbit.recentering,
    gesture:{ x:gestureRotation.x, y:gestureRotation.y },
    debug:getStageLyricAnimationDebug(),
  }));
  pass('double-click reset recenters the same scene and lyric matrix remains shared',
    reset.centered && Math.abs(reset.gesture.x) < 0.001 && Math.abs(reset.gesture.y) < 0.001 &&
    reset.debug.sharedMatrix,
    reset);
  await screenshot('05-shared-mouse-drag-zoom-reset');

  const unavailableFont = await cdp.call(function () {
    setLyricFont('lf-font-missing-restart');
    return {
      selected:fx.lyricFont,
      saved:JSON.parse(localStorage.getItem(LYRIC_LAYOUT_STORE_KEY) || '{}').lyricFont,
    };
  });
  pass('unavailable imported font is persisted as a restart fallback precondition',
    unavailableFont.selected === 'lf-font-missing-restart' &&
    unavailableFont.saved === 'lf-font-missing-restart',
    unavailableFont);
  await cdp.send('Page.reload', { ignoreCache:true });
  await waitFor(() => cdp.call(function () {
    return document.readyState === 'complete' && window.LumiFieldTask13 &&
      typeof window.getStageLyricAnimationDebug === 'function' &&
      window.renderer && window.scene && window.camera;
  }), 50000, 120);
  await waitFor(() => cdp.call(function () {
    return window.fx && window.fx.lyricFont === 'sans';
  }), 15000, 120);
  const restartFallback = await cdp.call(function () {
    var sceneRows = 0;
    scene.traverse(function (object) {
      if (object.userData && object.userData.stageLyricAnimation) sceneRows += 1;
    });
    return {
      selected:fx.lyricFont,
      saved:JSON.parse(localStorage.getItem(LYRIC_LAYOUT_STORE_KEY) || '{}').lyricFont,
      missingLoaded:!!(window.lumiFieldImportedFontMap && window.lumiFieldImportedFontMap['lf-font-missing-restart']),
      defaultFamily:lyricFontStackForKey('sans'),
      debug:getStageLyricAnimationDebug(),
      sceneRows:sceneRows,
    };
  });
  pass('restart uses the safe default family for an unavailable imported font with no stale lyric objects',
    restartFallback.selected === 'sans' && restartFallback.saved === 'sans' &&
    restartFallback.debug.fontKey === 'sans' && restartFallback.debug.fontFamily === restartFallback.defaultFamily &&
    !restartFallback.missingLoaded && restartFallback.sceneRows === 0 &&
    restartFallback.debug.lineCount === 0 && restartFallback.debug.outgoingCount === 0,
    restartFallback);
  await screenshot('06-font-restart-failure-fallback');

  pass('renderer has no uncaught exceptions', rendererErrors.length === 0, rendererErrors);
  const result = {
    ok:true,
    runId,
    mode:installedExecutable ? 'installed Electron CDP' : 'source Electron CDP',
    executable:installedExecutable || electron,
    origin,
    evidenceDir,
    videoEvidence,
    staticEvidence,
    screenshots,
    checks,
    rendererErrors,
  };
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(evidenceDir, 'app.log'), appLog.join('').replace(/\b\d{6}\b/g, '[REDACTED_CODE]'));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

// JSON-serializable helpers injected by CDP calls cannot close over Node state.
function rectIntersectsLocal(a, b) {
  if (!a || !b) return false;
  return a.left < b.right - 2 && a.right > b.left + 2 && a.top < b.bottom - 2 && a.bottom > b.top + 2;
}

// UUID values are opaque; this intentionally only verifies that the core
// returned a non-empty stable value while direct scene identity is asserted by
// sharedScene/sharedCamera/sharedRenderer in the renderer.
function windowValue(value) {
  return typeof value === 'string' && value.length > 0 ? value : '';
}

run().catch(error => {
  const failure = {
    ok:false,
    runId,
    mode:installedExecutable ? 'installed Electron CDP' : 'source Electron CDP',
    executable:installedExecutable || electron,
    origin,
    evidenceDir,
    error:String(error && error.stack || error),
    checks,
    screenshots,
    rendererErrors,
  };
  try {
    fs.writeFileSync(path.join(evidenceDir, 'failure.json'), JSON.stringify(failure, null, 2));
    fs.writeFileSync(path.join(evidenceDir, 'app.log'), appLog.join('').replace(/\b\d{6}\b/g, '[REDACTED_CODE]'));
  } catch (_) {}
  console.error(failure.error);
  process.exitCode = 1;
}).finally(() => {
  if (cdp) cdp.close();
  if (app && !app.killed) {
    try { app.kill(); } catch (_) {}
  }
  try { fs.rmSync(userData, { recursive:true, force:true }); } catch (_) {}
});
