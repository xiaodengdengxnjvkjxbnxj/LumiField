'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { createMusicPlatformService } = require('../music-platform-service');

const repo = path.resolve(__dirname, '..');
const electron = require('electron');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.join(repo, 'test-results', 'lf-master-problem9-smoke', runId);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-master-problem9-'));
const checks = {};
const screenshots = [];
const rendererErrors = [];
const appLog = [];
let app;
let cdp;

fs.mkdirSync(evidenceDir, { recursive: true });

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
    const response = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception && response.exceptionDetails.exception.description || response.exceptionDetails.text);
    return response.result && response.result.value;
  }
  call(fn, args = []) { return this.evaluate(`(${fn.toString()}).apply(null,${JSON.stringify(args)})`); }
  close() { try { this.ws.close(); } catch (_) {} }
}

function makeComment(song, index, likedCount) {
  return {
    id: `${song.id}-comment-${index}`,
    content: index === 1 ? `${song.name} 的真实长评 ` + '这一段用于验证多行截断、展开和稳定布局。'.repeat(26) : `${song.name} 的真实热评 ${index}`,
    likedCount,
    time: Date.now() - index * 1000,
    user: { id: `user-${index}`, nickname: `评论者${index}`, avatar: '' },
    provider: 'netease',
    song,
  };
}

async function backendGroupingTest() {
  const songs = [
    { id: 'song-a', provider: 'netease', name: '歌曲甲', artist: '歌手甲', cover: '' },
    { id: 'song-b', provider: 'netease', name: '歌曲乙', artist: '歌手乙', cover: '' },
  ];
  const service = createMusicPlatformService({
    statusNetease: async () => ({ ok: true, loggedIn: true, sessionValid: true, userId: 'qa' }),
    statusQQ: async () => ({ loggedIn: false }),
    hotCandidates: { netease: async () => songs },
    commentsNetease: async song => ({ comments: [
      makeComment(song, 1, 30), makeComment(song, 2, 90), makeComment(song, 3, 60), makeComment(song, 4, 10), makeComment(song, 2, 90),
    ] }),
  });
  const result = await service.hotComments({ limit: 18 });
  pass('backend returns grouped real comments', result.ok === true && Array.isArray(result.commentGroups) && result.commentGroups.length === 2, result);
  pass('backend keeps exactly three unique comments per song', result.commentGroups.every(group => group.comments.length === 3 && new Set(group.comments.map(comment => comment.id)).size === 3), result.commentGroups);
  pass('backend orders each song comments by likes', result.commentGroups.every(group => group.comments.map(comment => comment.likedCount).join(',') === '90,60,30'), result.commentGroups);
  pass('flat compatibility list preserves song grouping', result.comments.map(comment => comment.song.id).join(',') === 'song-a,song-a,song-a,song-b,song-b,song-b', result.comments);
}

async function startApp() {
  const port = await freePort();
  app = spawn(electron, ['.', `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--window-size=1360,860'], {
    cwd: repo,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { LUMIFIELD_SKIP_SPLASH: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }),
  });
  const collect = data => appLog.push(String(data));
  app.stdout.on('data', collect);
  app.stderr.on('data', collect);
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json();
    return targets.find(item => item.type === 'page' && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//.test(item.url));
  }, 60000, 160);
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await waitFor(() => cdp.call(function () {
    return document.readyState === 'complete' && window.LumiFieldHotCommentCard && document.getElementById('lf-hot-comment-card');
  }), 60000, 160);
}

async function setViewport(spec) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: spec.width,
    height: spec.height,
    deviceScaleFactor: spec.dpr,
    mobile: false,
    screenWidth: spec.width,
    screenHeight: spec.height,
    screenOrientation: { type: 'landscapePrimary', angle: 0 },
  });
  await waitFor(() => cdp.call(function (size) { return innerWidth === size.width && innerHeight === size.height; }, [spec]), 10000, 80);
}

async function installFixture() {
  return cdp.call(async function () {
    window.startupLoginGuideShown = true;
    window.loginGuideAnimating = false;
    window.showLoginModal = function () { return false; };
    window.openProviderLogin = function () { return false; };
    if (typeof window.closeLoginModal === 'function') try { window.closeLoginModal(); } catch (_) {}
    document.querySelectorAll('.modal-mask.show,.modal-mask.open,.modal-mask.active').forEach(function (modal) {
      modal.classList.remove('show', 'open', 'active');
      modal.style.pointerEvents = 'none';
    });
    const authRoot = document.getElementById('lf-auth-root');
    if (authRoot) { authRoot.hidden = true; authRoot.style.pointerEvents = 'none'; }
    document.body.classList.remove('modal-open', 'lf-auth-locked');
    const home = document.getElementById('empty-home');
    home.style.display = 'block';
    home.style.visibility = 'visible';
    home.style.opacity = '1';
    home.style.transform = 'none';
    const songs = [
      { id:'song-a', provider:'netease', source:'netease', name:'歌曲甲', artist:'歌手甲', cover:'' },
      { id:'song-b', provider:'netease', source:'netease', name:'歌曲乙', artist:'歌手乙', cover:'' },
    ];
    function comments(song) {
      return [1, 2, 3].map(function (index) {
        return {
          id:song.id + '-comment-' + index,
          provider:'netease',
          song:song,
          content:index === 1 ? song.name + '：' + '这是一条用于验证多行截断、长评展开、切换过程中不抖动的真实结构化长评论。'.repeat(28) : song.name + ' 的热评 ' + index,
          likedCount:1000 - index,
          time:Date.now() - index * 1000,
          user:{ id:'user-' + index, nickname:'评论者' + index, avatar:'' },
        };
      });
    }
    window.LumiFieldHotComments.fetch = async function () {
      return { ok:true, commentsPerSong:3, commentGroups:songs.map(function (song) { return { provider:'netease', song:song, comments:comments(song) }; }) };
    };
    await window.LumiFieldHotCommentCard.refresh();
    window.LumiFieldHotCommentCard.state.paused = true;
    return true;
  });
}

async function measure() {
  return cdp.call(function () {
    function rect(selector) {
      const node = document.querySelector(selector);
      if (!node) return null;
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return { left:box.left, top:box.top, right:box.right, bottom:box.bottom, width:box.width, height:box.height, fontSize:parseFloat(style.fontSize) || 0, display:style.display, overflow:style.overflow };
    }
    const card = document.getElementById('lf-hot-comment-card');
    const style = getComputedStyle(card);
    const shellStyle = getComputedStyle(document.querySelector('.lf-weather-shell'));
    const state = window.LumiFieldHotCommentCard.state;
    return {
      viewport:{ width:innerWidth, height:innerHeight, dpr:devicePixelRatio },
      shell:rect('.lf-weather-shell'), weatherMain:rect('.lf-weather-main'), weatherSide:rect('.lf-weather-side'), card:rect('#lf-hot-comment-card'),
      content:rect('.lf-hot-comment-content'), cover:rect('.lf-hot-comment-cover-wrap'), song:rect('.lf-hot-comment-song'), text:rect('.lf-hot-comment-text'), meta:rect('.lf-hot-comment-meta'), actions:rect('.lf-hot-comment-actions'), indicator:rect('.lf-hot-comment-switch'),
      backdrop:style.backdropFilter || style.webkitBackdropFilter,
      shellBackdrop:shellStyle.backdropFilter || shellStyle.webkitBackdropFilter,
      glassKind:card.getAttribute('data-lf-liquid-glass') || '',
      background:style.backgroundImage + ' ' + style.backgroundColor,
      border:style.borderTopColor,
      songIndex:Number(card.dataset.songIndex), commentIndex:Number(card.dataset.commentIndex), commentsForSong:Number(card.dataset.commentsForSong),
      commentText:card.querySelector('.lf-hot-comment-text').textContent,
      groups:state.groups.map(group => group.comments.length),
      sequence:state.sequence.length,
      indicatorText:card.querySelector('.lf-hot-comment-switch').innerText,
      dots:card.querySelectorAll('.lf-hot-comment-dot').length,
    };
  });
}

function sameRect(left, right, tolerance = 0.6) {
  return ['left', 'top', 'width', 'height'].every(key => Math.abs(left[key] - right[key]) <= tolerance);
}

async function waitForStableLayout(timeout = 4000) {
  const started = Date.now();
  let previous = await measure();
  while (Date.now() - started < timeout) {
    await delay(120);
    const current = await measure();
    if (sameRect(current.shell, previous.shell, 0.2) &&
        sameRect(current.weatherMain, previous.weatherMain, 0.2) &&
        sameRect(current.weatherSide, previous.weatherSide, 0.2) &&
        sameRect(current.card, previous.card, 0.2)) return current;
    previous = current;
  }
  return previous;
}

function inside(inner, outer, tolerance = 1) {
  return inner.left >= outer.left - tolerance && inner.top >= outer.top - tolerance && inner.right <= outer.right + tolerance && inner.bottom <= outer.bottom + tolerance;
}

async function screenshot(name) {
  const response = await cdp.send('Page.captureScreenshot', { format:'png', fromSurface:true, captureBeyondViewport:false });
  const file = path.join(evidenceDir, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(response.data, 'base64'));
  screenshots.push(file);
}

async function advance() {
  await cdp.call(function () {
    window.LumiFieldHotCommentCard.state.paused = false;
    window.LumiFieldHotCommentCard.next();
    window.LumiFieldHotCommentCard.state.paused = true;
  });
  await delay(240);
  return measure();
}

async function verifyViewport(spec) {
  await setViewport(spec);
  await installFixture();
  await delay(900);
  if (spec.width <= 620) {
    await cdp.call(function () {
      const shell = document.querySelector('.lf-weather-shell');
      shell.scrollTop = shell.scrollHeight;
    });
    await delay(240);
  }
  const first = await waitForStableLayout();
  pass(`${spec.name}: grouped three comments per song`, first.groups.join(',') === '3,3' && first.sequence === 6 && first.commentsForSong === 3, first);
  pass(`${spec.name}: comment card stays inside weather panel`, inside(first.card, first.shell) && inside(first.content, first.card) && inside(first.cover, first.card) && inside(first.actions, first.card) && first.text.height > 0, first);
  pass(`${spec.name}: switch indicator is visible and complete`, first.indicator.width > 20 && first.indicator.height > 12 && first.dots === 3 && /热评\s*1\s*\/\s*3/.test(first.indicatorText), first);
  pass(`${spec.name}: liquid glass remains active`,
    (/blur|url\(/i.test(first.backdrop) || (first.glassKind === 'nested' && /blur|url\(/i.test(first.shellBackdrop))) &&
    first.background !== 'none rgba(0, 0, 0, 0)' && first.border !== 'rgba(0, 0, 0, 0)', first);
  if (spec.width >= 1200 && spec.height > 760) {
    pass(`${spec.name}: internal content is enlarged`, first.cover.width >= 80 && first.song.fontSize >= 13.5 && first.text.fontSize >= 12.5 && first.meta.fontSize >= 9.5, first);
  }
  const sequence = [first, await advance(), await advance(), await advance()];
  pass(`${spec.name}: rotates three comments before next song`, sequence.map(item => `${item.songIndex}:${item.commentIndex}`).join(',') === '0:0,0:1,0:2,1:0', sequence);
  pass(`${spec.name}: auto rotation never changes outer or weather layout`, sequence.every(item => sameRect(item.shell, first.shell) && sameRect(item.weatherMain, first.weatherMain) && sameRect(item.weatherSide, first.weatherSide) && sameRect(item.card, first.card)), sequence);
  pass(`${spec.name}: all rotated content remains clipped safely`, sequence.every(item => inside(item.content, item.card) && inside(item.cover, item.card) && inside(item.actions, item.card)), sequence);
  await screenshot(spec.name);
  return first;
}

async function verifyLongComment() {
  await cdp.call(function () {
    const state = window.LumiFieldHotCommentCard.state;
    state.index = 0;
    state.paused = false;
    window.LumiFieldHotCommentCard.next();
    state.index = 0;
  });
  await delay(260);
  const before = await measure();
  const expandable = await waitFor(() => cdp.call(function () {
    const button = document.querySelector('.lf-hot-comment-expand');
    return button && !button.hidden && !button.classList.contains('unused');
  }), 5000, 80);
  pass('long comment exposes expand control', expandable === true, expandable);
  const expanded = await cdp.call(function () {
    const card = document.getElementById('lf-hot-comment-card');
    const shell = document.querySelector('.lf-weather-shell');
    const button = card.querySelector('.lf-hot-comment-expand');
    button.click();
    const text = card.querySelector('.lf-hot-comment-text');
    const cardBox = card.getBoundingClientRect();
    const shellBox = shell.getBoundingClientRect();
    return {
      expanded:card.classList.contains('expanded'),
      scrollable:text.scrollHeight > text.clientHeight + 2,
      card:{ left:cardBox.left, top:cardBox.top, width:cardBox.width, height:cardBox.height },
      shell:{ left:shellBox.left, top:shellBox.top, width:shellBox.width, height:shellBox.height },
    };
  });
  pass('long comment expands inside fixed card with scroll', expanded.expanded && expanded.scrollable && sameRect(expanded.card, before.card) && sameRect(expanded.shell, before.shell), expanded);
}

async function cleanup() {
  if (cdp) cdp.close();
  if (app && app.exitCode == null) {
    try { app.kill(); } catch (_) {}
    await delay(400);
    if (app.exitCode == null && process.platform === 'win32' && app.pid) spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { windowsHide:true, stdio:'ignore' });
  }
  try { fs.rmSync(userData, { recursive:true, force:true }); } catch (_) {}
}

(async function main() {
  await backendGroupingTest();
  await startApp();
  const results = [];
  results.push(await verifyViewport({ name:'small-600x520-dpr1', width:600, height:520, dpr:1 }));
  results.push(await verifyViewport({ name:'fullhd-1920x1080-dpr1', width:1920, height:1080, dpr:1 }));
  await verifyLongComment();
  results.push(await verifyViewport({ name:'qhd-2560x1440-dpr1_5', width:2560, height:1440, dpr:1.5 }));
  results.push(await verifyViewport({ name:'hidpi-1280x720-dpr2', width:1280, height:720, dpr:2 }));
  pass('no renderer exception during problem 9 workflow', rendererErrors.length === 0, rendererErrors);
  const result = { ok:true, problem:9, checks, viewports:results, screenshots, rendererErrors, appLogTail:appLog.join('').slice(-12000), completedAt:new Date().toISOString() };
  const resultFile = path.join(evidenceDir, 'result.json');
  fs.writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ ok:true, problem:9, resultFile, checks:Object.keys(checks).length }, null, 2));
})().catch(error => {
  const failure = { ok:false, problem:9, error:error && error.stack || String(error), checks, screenshots, rendererErrors, appLogTail:appLog.join('').slice(-12000), completedAt:new Date().toISOString() };
  const failureFile = path.join(evidenceDir, 'failure.json');
  fs.writeFileSync(failureFile, `${JSON.stringify(failure, null, 2)}\n`);
  console.error(JSON.stringify({ ok:false, problem:9, failureFile, error:failure.error }, null, 2));
  process.exitCode = 1;
}).finally(cleanup);
