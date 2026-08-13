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
const evidenceDir = path.resolve(process.env.LF_PROBLEM12_OUT || path.join(repo, 'test-results', 'lf-problem12-smoke', runId));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-problem12-'));
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
  return details;
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
        rendererErrors.push(String(detail.exception && detail.exception.description || detail.text || 'Renderer exception').slice(0, 1800));
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
  return file;
}

const fixtures = {
  text: '蓝粉e\u0301👩‍🎤光',
  nextText: '下一句保持横向',
  translation: 'Blue and pink light',
  yrc: '[1000,4000](1000,600,0)蓝(1600,600,0)粉(2200,600,0)e\u0301(2800,600,0)👩‍🎤(3400,600,0)光\n[5000,4000](5000,600,0)下(5600,600,0)一(6200,600,0)句(6800,600,0)保(7400,600,0)持(8000,600,0)横(8600,400,0)向',
  qrc: '[1000,4000](1000,600,0)蓝(1600,600,0)粉(2200,600,0)e\u0301(2800,600,0)👩‍🎤(3400,600,0)光',
  ttml: '<?xml version="1.0"?><tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1s" end="5s"><span begin="1s" end="1.6s">蓝</span><span begin="1.6s" end="2.2s">粉</span><span begin="2.2s" end="2.8s">e\u0301</span><span begin="2.8s" end="3.4s">👩‍🎤</span><span begin="3.4s" end="4s">光</span></p></div></body></tt>',
  krc: '[1000,4000]<0,600,0>蓝<600,600,0>粉<1200,600,0>e\u0301<1800,600,0>👩‍🎤<2400,600,0>光',
  lrc: '[00:01.00]蓝粉e\u0301👩‍🎤光\n[00:05.00]下一句保持横向',
};

function staticAudit() {
  const task13 = fs.readFileSync(path.join(repo, 'public', 'lumifield-task13.js'), 'utf8');
  const task13Css = fs.readFileSync(path.join(repo, 'public', 'lumifield-task13.css'), 'utf8');
  const fixes = fs.readFileSync(path.join(repo, 'public', 'lumifield-fixes-v2.js'), 'utf8');
  const fixesCss = fs.readFileSync(path.join(repo, 'public', 'lumifield-fixes-v2.css'), 'utf8');
  const index = fs.readFileSync(path.join(repo, 'public', 'index.html'), 'utf8');
  const lyricSources = [task13, task13Css, fixes, fixesCss].join('\n');
  const obsolete = [
    /lf-multilyric-overlay/g, /lf-lyric-mode-controls/g, /lf-t13-fan/g, /lf-t13-dynamic/g, /lf-t13-word/g,
    /renderFan\s*\(/g, /renderDynamic\s*\(/g, /updateDynamicProgress\s*\(/g,
    /data-lf-lyric-mode=["'](?:fan|dynamic)["']/g,
    /\b(?:fanDepth|fanArc|fanRotate|fanRadius|fanSpacing|fanCurrentSize|fanOtherSize|fanBlur|fanOpacity|fanSpeed|fanHighlight|fanGlow)\b/g,
    /\b(?:dynamicSpread|dynamicDepth|dynamicGap|dynamicFloat|dynamicRotate|dynamicScale|dynamicNeon|dynamicScheme|dynamicFadeIn|dynamicFadeOut|dynamicWordSpeed|dynamicBlur)\b/g,
    /透视扇形|空间动态|歌词空间模式/g,
  ];
  const obsoleteMatches = obsolete.flatMap(regex => (lyricSources.match(regex) || []).map(value => value));
  pass('legacy fan dynamic overlay fields renderers CSS and entrances are zero', obsoleteMatches.length === 0, obsoleteMatches);
  pass('task13 exposes only normal and animation lyric modes',
    /LYRIC_DEFAULTS\s*=\s*\{\s*mode:\s*['"]normal['"]/.test(task13) &&
      /\^\(normal\|animation\)\$/.test(task13) &&
      !/\^\(normal\|fan\|dynamic\)\$/.test(task13));
  pass('unique lyric console entrance is named lyric animation mode',
    (task13.match(/id=["']lf-t13-lyric-block["']/g) || []).length === 1 &&
      (task13.match(/歌词动画模式/g) || []).length >= 1 &&
      (task13.match(/data-lf-lyric-mode=["']normal["']/g) || []).length === 1 &&
      (task13.match(/data-lf-lyric-mode=["']animation["']/g) || []).length === 1);
  pass('clean-room lyric source contains no Folia branding assets telemetry or copied license claim',
    !/(folia-major|chthollyphile|folia\s+major|google-analytics|gtag\s*\(|mixpanel|telemetry)/i.test(task13 + task13Css + index));
  pass('animation renderer uses grapheme segmentation and measured glyph boundary',
    /Intl\.Segmenter/.test(task13) && /offsetLeft\s*\+\s*[^;\n]*offsetWidth/.test(task13) &&
      /lf-t13-animation-underline/.test(task13));
  pass('enhanced timing adapters are public and LRC estimation is explicit',
    /LumiFieldLyricTiming/.test(task13 + index) && /parseYrc/.test(task13 + index) && /parseQrc/.test(task13 + index) &&
      /parseTtml/.test(task13 + index) && /parseKrc/.test(task13 + index) && /selectTimeline/.test(task13 + index) &&
      /estimated-word/.test(task13));
}

async function inspectCurrent() {
  return cdp.call(function () {
    const root = document.getElementById('lf-t13-lyrics');
    const line = root && root.querySelector('.lf-t13-animation-line.current');
    const main = line && line.querySelector('.lf-t13-animation-main');
    const glyphs = main ? Array.from(main.querySelectorAll('.lf-t13-glyph')) : [];
    const revealed = glyphs.filter(node => node.classList.contains('revealed'));
    const sung = glyphs.filter(node => node.classList.contains('sung'));
    const current = glyphs.find(node => node.classList.contains('current'));
    const future = glyphs.find(node => !node.classList.contains('revealed'));
    const underline = line && line.querySelector('.lf-t13-animation-underline');
    const translation = line && line.querySelector('.lf-t13-animation-translation');
    const mainRect = main && main.getBoundingClientRect();
    const underlineRect = underline && underline.getBoundingClientRect();
    const last = revealed[revealed.length - 1];
    const lastRect = last && last.getBoundingClientRect();
    const rows = glyphs.map(node => Number(node.offsetTop));
    const style = main && getComputedStyle(main);
    function color(node) { return node ? getComputedStyle(node).color : ''; }
    return {
      mode: root && root.dataset.mode,
      visible: !!(root && root.classList.contains('visible')),
      text: main && main.getAttribute('aria-label'),
      glyphText: glyphs.map(node => node.textContent).join(''),
      glyphCount: glyphs.length,
      revealed: revealed.length,
      sung: sung.length,
      currentColor: color(current),
      sungColor: color(sung[0]),
      futureColor: color(future),
      underlineWidth: underline ? parseFloat(underline.style.width || '0') : 0,
      renderedUnderlineWidth: underlineRect ? underlineRect.width : 0,
      expectedUnderlineWidth: last ? last.offsetLeft + last.offsetWidth : 0,
      inlineUnderlineWidth: underline && underline.style.width,
      underlineTransition: underline && getComputedStyle(underline).transition,
      translation: translation && translation.textContent,
      translationBelow: !!(translation && mainRect && translation.getBoundingClientRect().top >= mainRect.bottom - 1),
      horizontal: rows.length < 2 || Math.max.apply(null, rows) - Math.min.apply(null, rows) <= 1,
      whiteSpace: style && style.whiteSpace,
      centeredXError: mainRect ? Math.abs((mainRect.left + mainRect.right) / 2 - innerWidth / 2) : 9999,
      centeredYRatio: mainRect ? (mainRect.top + mainRect.bottom) / 2 / innerHeight : -1,
      lineClass: line && line.className,
      lineCount: root ? root.querySelectorAll('.lf-t13-animation-line').length : 0,
      leavingCount: root ? root.querySelectorAll('.lf-t13-animation-line.leaving').length : 0,
      leavingTransition: root && root.querySelector('.lf-t13-animation-line.leaving') ? getComputedStyle(root.querySelector('.lf-t13-animation-line.leaving')).transition : '',
      debug: window.LumiFieldTask13.getLyricDebug(),
      sameStoredNode: !!(line && window.__p12LineNode === line),
    };
  });
}

function rgb(value) {
  const match = String(value || '').match(/rgba?\((\d+(?:\.\d+)?)[, ]+(\d+(?:\.\d+)?)[, ]+(\d+(?:\.\d+)?)/);
  return match ? match.slice(1, 4).map(Number) : [0, 0, 0];
}

async function recordEvidence() {
  return cdp.call(async function () {
    if (typeof MediaRecorder !== 'function') throw new Error('MediaRecorder unavailable');
    const api = window.LumiFieldTask13;
    const view = document.createElement('canvas');
    view.width = Math.max(960, innerWidth);
    view.height = Math.max(540, innerHeight);
    const context = view.getContext('2d', { alpha:false });
    const stream = view.captureStream(30);
    const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(MediaRecorder.isTypeSupported) || '';
    const recorder = new MediaRecorder(stream, type ? { mimeType:type, videoBitsPerSecond:3000000 } : { videoBitsPerSecond:3000000 });
    const chunks = [];
    recorder.ondataavailable = event => { if (event.data && event.data.size) chunks.push(event.data); };
    const stopped = new Promise((resolve, reject) => {
      recorder.onstop = resolve;
      recorder.onerror = event => reject(event.error || new Error('MediaRecorder failed'));
    });
    const originalTime = Number(audio.currentTime) || 0;
    const started = performance.now();
    let raf = 0;
    function render() {
      const elapsed = performance.now() - started;
      audio.currentTime = 1 + elapsed / 1000;
      const gradient = context.createLinearGradient(0, 0, view.width, view.height);
      gradient.addColorStop(0, '#07152a'); gradient.addColorStop(.52, '#11102a'); gradient.addColorStop(1, '#240d25');
      context.fillStyle = gradient; context.fillRect(0, 0, view.width, view.height);
      try { if (window.renderer && renderer.domElement) context.drawImage(renderer.domElement, 0, 0, view.width, view.height); } catch (_) {}
      const line = document.querySelector('#lf-t13-lyrics .lf-t13-animation-line.current');
      if (line) {
        const glyphs = Array.from(line.querySelectorAll('.lf-t13-glyph'));
        glyphs.forEach(node => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          if (Number(style.opacity) <= .01) return;
          context.save();
          context.globalAlpha = Number(style.opacity) || 1;
          context.font = style.font;
          context.fillStyle = style.color;
          context.shadowColor = style.color;
          context.shadowBlur = 16;
          context.fillText(node.textContent, rect.left, rect.bottom - Math.max(2, rect.height * .12));
          context.restore();
        });
        const underline = line.querySelector('.lf-t13-animation-underline');
        if (underline) {
          const rect = underline.getBoundingClientRect();
          const glow = context.createLinearGradient(rect.left, 0, rect.right, 0);
          glow.addColorStop(0, '#63dcff'); glow.addColorStop(1, '#ff78c9');
          context.save(); context.fillStyle = glow; context.shadowColor = '#cf8cff'; context.shadowBlur = 16;
          context.fillRect(rect.left, rect.top, rect.width, Math.max(2, rect.height)); context.restore();
        }
        const translated = line.querySelector('.lf-t13-animation-translation');
        if (translated) {
          const rect = translated.getBoundingClientRect(); const style = getComputedStyle(translated);
          context.font = style.font; context.fillStyle = style.color; context.textAlign = 'center';
          context.fillText(translated.textContent, rect.left + rect.width / 2, rect.bottom - 2); context.textAlign = 'start';
        }
      }
      context.fillStyle = 'rgba(2,8,18,.72)'; context.fillRect(18, 18, 540, 54);
      context.fillStyle = '#eafcff'; context.font = '600 17px sans-serif';
      const debug = api.getLyricDebug();
      context.fillText('LumiField 问题12 · 真实逐字时间轴', 32, 42);
      context.fillStyle = '#9cecff'; context.font = '13px sans-serif';
      context.fillText(debug.timingSource + ' · revealed=' + debug.revealedCount + '/' + debug.tokenCount + ' · underline=' + debug.underlineWidth + 'px', 32, 62);
      if (elapsed < 4300) raf = requestAnimationFrame(render);
      else recorder.stop();
    }
    recorder.start(300);
    render();
    await stopped;
    if (raf) cancelAnimationFrame(raf);
    stream.getTracks().forEach(track => track.stop());
    audio.currentTime = originalTime;
    const blob = new Blob(chunks, { type:recorder.mimeType || 'video/webm' });
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('WebM read failed')); reader.readAsDataURL(blob);
    });
    return { base64:dataUrl.slice(dataUrl.indexOf(',') + 1), bytes:blob.size, mimeType:blob.type,
      durationMs:Math.round(performance.now() - started), width:view.width, height:view.height };
  });
}

async function run() {
  staticAudit();
  const debugPort = await freePort();
  app = spawn(electron, ['.', '--user-data-dir=' + userData, '--remote-debugging-port=' + debugPort, '--remote-debugging-address=127.0.0.1'], {
    cwd: repo,
    env: Object.assign({}, process.env, {
      LF_ALLOW_LOCAL_CODES:'1', ELECTRON_DISABLE_SECURITY_WARNINGS:'true', LUMIFIELD_SKIP_SPLASH:'1',
      LF_MAIL_HOST:' ', LF_MAIL_USER:' ', LF_MAIL_PASSWORD:' ', LF_REMOTE_API_URL:' ',
    }),
    windowsHide:true,
    stdio:['ignore', 'pipe', 'pipe'],
  });
  const collect = chunk => {
    const value = String(chunk); appLog.push(value);
    if (/(?:FATAL|uncaught exception|renderer process crashed)/i.test(value)) rendererErrors.push(value.trim().slice(0, 1800));
  };
  app.stdout.on('data', collect); app.stderr.on('data', collect);

  const target = await findMainTarget(debugPort);
  origin = new URL(target.url).origin;
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await pageWait(function () {
    return document.readyState === 'complete' && window.LumiFieldTask13 && window.LumiFieldLyricTiming &&
      document.getElementById('lf-t13-lyrics') && typeof LumiFieldTask13.getLyricDebug === 'function';
  }, [], 45000);

  const parser = await cdp.call(function (f) {
    const api = window.LumiFieldLyricTiming;
    function summarize(lines) {
      lines = Array.isArray(lines) ? lines : [];
      const line = lines[0] || {};
      return {
        lineCount:lines.length, text:line.text, source:line.source,
        words:Array.isArray(line.words) ? line.words.map(word => ({ text:word.text, t:word.t, d:word.d, c0:word.c0, c1:word.c1 })) : [],
        wordTimesMonotonic:!line.words || line.words.every((word, index, all) => index === 0 || word.t >= all[index - 1].t),
      };
    }
    const yrc = summarize(api.parseYrc(f.yrc));
    const qrc = summarize(api.parseQrc(f.qrc));
    const ttml = summarize(api.parseTtml(f.ttml));
    const krc = summarize(api.parseKrc(f.krc));
    const priorities = [
      api.selectTimeline({ yrc:f.yrc, qrc:f.qrc, ttml:f.ttml, krc:f.krc, lrc:f.lrc }),
      api.selectTimeline({ qrc:f.qrc, ttml:f.ttml, krc:f.krc, lrc:f.lrc }),
      api.selectTimeline({ ttml:f.ttml, krc:f.krc, lrc:f.lrc }),
      api.selectTimeline({ krc:f.krc, lrc:f.lrc }),
      api.selectTimeline({ lrc:f.lrc }),
    ].map(value => ({ source:value.source, hasWordTiming:value.hasWordTiming, estimated:value.estimated,
      lineCount:value.lines && value.lines.length, text:value.lines && value.lines[0] && value.lines[0].text }));
    return { yrc, qrc, ttml, krc, priorities };
  }, [fixtures]);
  const enhanced = [parser.yrc, parser.qrc, parser.ttml, parser.krc];
  pass('YRC QRC TTML KRC fixtures preserve exact text and monotonic true word timing',
    enhanced.every(value => value.text === fixtures.text && value.words.length === 5 && value.wordTimesMonotonic), parser);
  pass('enhanced timeline selection obeys YRC QRC TTML KRC LRC precedence and labels estimation honestly',
    JSON.stringify(parser.priorities.map(value => value.source)) === JSON.stringify(['yrc-word','qrc-word','ttml-word','krc-word','lrc-line']) &&
      parser.priorities.slice(0, 4).every(value => value.hasWordTiming && !value.estimated) &&
      !parser.priorities[4].hasWordTiming && parser.priorities[4].estimated, parser.priorities);

  const setup = await cdp.call(function (f) {
    document.body.classList.remove('lf-auth-locked', 'empty-home-active', 'splash-active');
    document.body.classList.add('immersive-mode');
    const auth = document.getElementById('lf-auth-root'); if (auth) { auth.classList.remove('show'); auth.style.display = 'none'; }
    const splash = document.getElementById('splash'); if (splash) splash.style.display = 'none';
    if (typeof window.toggleFxPanel === 'function') window.toggleFxPanel(false);
    if (typeof window.togglePlaylistPanel === 'function') window.togglePlaylistPanel(false);
    window.isVisualStageInteractionActive = function () { return true; };
    window.playQueue = [{ provider:'fixture', id:'problem12-yrc', name:'Problem 12', artist:'LumiField QA' }];
    window.currentIdx = 0;
    const selected = LumiFieldLyricTiming.selectTimeline({ yrc:f.yrc, lrc:f.lrc });
    selected.lines[0].translation = f.translation;
    selected.lines[1].translation = 'The next sentence';
    window.lyricsLines = selected.lines;
    window.lyricsTimingSource = selected.source;
    const testAudio = new Audio();
    Object.defineProperty(testAudio, 'currentTime', { configurable:true, writable:true, value:1 });
    Object.defineProperty(testAudio, 'paused', { configurable:true, get:function () { return !!this.__p12Paused; } });
    testAudio.__p12Paused = true;
    window.audio = testAudio;
    LumiFieldTask13.setLyricState({ mode:'animation', translate:true });
    return { selected:{ source:selected.source, hasWordTiming:selected.hasWordTiming, estimated:selected.estimated }, state:LumiFieldTask13.getState().lyrics };
  }, [fixtures]);
  pass('animation mode starts from selected native timeline', setup.selected.source === 'yrc-word' && setup.selected.hasWordTiming && !setup.selected.estimated &&
    setup.state.mode === 'animation' && setup.state.translate, setup);
  await pageWait(function () {
    const line = document.querySelector('#lf-t13-lyrics[data-mode="animation"] .lf-t13-animation-line.current');
    return !!(line && line.querySelectorAll('.lf-t13-glyph').length === 5);
  }, [], 15000);

  await cdp.call(function () { audio.currentTime = 2.5; });
  await delay(460);
  const middle = await inspectCurrent();
  await cdp.call(function () { window.__p12LineNode = document.querySelector('#lf-t13-lyrics .lf-t13-animation-line.current'); });
  const expectedGraphemes = 5;
  pass('animation uses exact grapheme count text horizontal single sentence centered layout',
    middle.glyphCount === expectedGraphemes && middle.text === fixtures.text && middle.glyphText === fixtures.text &&
      middle.horizontal && /pre|nowrap/.test(middle.whiteSpace) && middle.centeredXError <= 3 &&
      middle.centeredYRatio >= .34 && middle.centeredYRatio <= .66, middle);
  pass('translation is rendered directly below the same current sentence',
    middle.translation === fixtures.translation && middle.translationBelow, middle);
  pass('underline ends at the measured last revealed grapheme within one pixel and grows by width transition',
    middle.revealed > 1 && Math.abs(middle.underlineWidth - middle.expectedUnderlineWidth) <= 1 &&
      /width/.test(middle.underlineTransition) && !/^0s(?:\s|$)/.test(middle.underlineTransition), middle);
  const sungRgb = rgb(middle.sungColor), currentRgb = rgb(middle.currentColor), futureRgb = rgb(middle.futureColor);
  pass('sung text is blue future text is pink and current glyph is a natural time-driven blend',
    sungRgb[2] > sungRgb[0] + 40 && futureRgb[0] > futureRgb[2] + 20 &&
      currentRgb[0] > sungRgb[0] && currentRgb[0] < futureRgb[0] && currentRgb[2] >= currentRgb[0],
    { sung:middle.sungColor, current:middle.currentColor, future:middle.futureColor });
  await screenshot('01-native-word-progress-blue-pink-underline');

  const monotonic = [];
  for (const time of [1.05, 1.65, 2.25, 2.85, 3.45, 4.85]) {
    await cdp.call(function (value) { audio.currentTime = value; }, [time]);
    await delay(90);
    const state = await inspectCurrent();
    monotonic.push({ time, revealed:state.revealed, underline:state.underlineWidth, expected:state.expectedUnderlineWidth,
      renderCount:state.debug.renderCount, sameNode:state.sameStoredNode });
  }
  pass('native word time reveals one grapheme at a time monotonically without DOM reconstruction',
    monotonic.slice(1, 5).every((row, index) => row.revealed > monotonic[index].revealed) &&
      monotonic[5].revealed === monotonic[4].revealed && monotonic[5].underline === monotonic[4].underline &&
      monotonic.every(row => Math.abs(row.underline - row.expected) <= 1) &&
      monotonic.every(row => row.renderCount === monotonic[0].renderCount && row.sameNode), monotonic);
  pass('completed sentence remains fully present until the next sentence starts',
    monotonic[monotonic.length - 1].revealed === expectedGraphemes && monotonic[monotonic.length - 1].sameNode, monotonic[monotonic.length - 1]);

  const paused = await cdp.call(async function () {
    audio.currentTime = 2.5; audio.__p12Paused = true;
    await new Promise(resolve => setTimeout(resolve, 280));
    const before = LumiFieldTask13.getLyricDebug();
    const line = document.querySelector('#lf-t13-lyrics .lf-t13-animation-line.current');
    const width = line.querySelector('.lf-t13-animation-underline').getBoundingClientRect().width;
    await new Promise(resolve => setTimeout(resolve, 360));
    const after = LumiFieldTask13.getLyricDebug();
    return { before, after, sameNode:line === document.querySelector('#lf-t13-lyrics .lf-t13-animation-line.current'),
      width, widthAfter:line.querySelector('.lf-t13-animation-underline').getBoundingClientRect().width };
  });
  pass('pause freezes glyph progress underline and DOM identity', paused.before.paused && paused.after.paused && paused.sameNode &&
    paused.before.revealedCount === paused.after.revealedCount && Math.abs(paused.width - paused.widthAfter) <= .2 &&
    paused.before.renderCount === paused.after.renderCount, paused);

  const seek = await cdp.call(async function () {
    function snap() {
      const debug = LumiFieldTask13.getLyricDebug();
      const line = document.querySelector('#lf-t13-lyrics .lf-t13-animation-line.current');
      return { debug, line, width:line.querySelector('.lf-t13-animation-underline').getBoundingClientRect().width };
    }
    audio.currentTime = 4.2; await new Promise(resolve => setTimeout(resolve, 100)); const forward = snap();
    audio.currentTime = 1.15; await new Promise(resolve => setTimeout(resolve, 100)); const back = snap();
    audio.currentTime = 3.65; await new Promise(resolve => setTimeout(resolve, 100)); const again = snap();
    return { forward:{ count:forward.debug.revealedCount, width:forward.width }, back:{ count:back.debug.revealedCount, width:back.width },
      again:{ count:again.debug.revealedCount, width:again.width }, sameNode:forward.line === back.line && back.line === again.line };
  });
  pass('backward and forward seek deterministically recompute reveal and underline on the same sentence',
    seek.sameNode && seek.back.count < seek.forward.count && seek.back.width < seek.forward.width &&
      seek.again.count > seek.back.count && seek.again.width > seek.back.width, seek);

  await cdp.call(function () { audio.currentTime = 5.06; });
  await delay(80);
  const transition = await inspectCurrent();
  pass('next sentence starts by fading the complete previous sentence as one node',
    transition.text === fixtures.nextText && transition.lineCount === 2 && transition.leavingCount === 1 &&
      /opacity/.test(transition.leavingTransition), transition);
  await screenshot('02-next-sentence-whole-line-fade');
  await delay(500);
  const transitionDone = await inspectCurrent();
  pass('previous sentence is removed only after its whole-line fade completes',
    transitionDone.text === fixtures.nextText && transitionDone.lineCount === 1 && transitionDone.leavingCount === 0, transitionDone);

  const lrc = await cdp.call(async function (f) {
    const selected = LumiFieldLyricTiming.selectTimeline({ lrc:f.lrc });
    window.playQueue[0] = { provider:'fixture', id:'problem12-lrc', name:'LRC estimate', artist:'LumiField QA' };
    window.lyricsLines = selected.lines; window.lyricsTimingSource = selected.source; audio.currentTime = 2.4;
    await new Promise(resolve => setTimeout(resolve, 140));
    return { selected:{ source:selected.source, estimated:selected.estimated, hasWordTiming:selected.hasWordTiming }, debug:LumiFieldTask13.getLyricDebug() };
  }, [fixtures]);
  pass('line-only LRC is explicitly reported as estimated word timing and never native precision',
    lrc.selected.source === 'lrc-line' && lrc.selected.estimated && !lrc.selected.hasWordTiming &&
      lrc.debug.estimated && lrc.debug.timingQuality === 'estimated-word', lrc);

  const songChange = await cdp.call(async function (f) {
    const before = document.querySelector('#lf-t13-lyrics .lf-t13-animation-line.current');
    window.playQueue[0] = { provider:'fixture', id:'problem12-new-song', name:'New song', artist:'LumiField QA' };
    window.lyricsLines = [{ t:1, duration:3, text:'切歌后新歌词', translation:'New track lyric',
      source:'yrc-word', words:[{ text:'切', t:1, d:.5, c0:0, c1:1 },{ text:'歌', t:1.5, d:.5, c0:1, c1:2 },
        { text:'后', t:2, d:.5, c0:2, c1:3 },{ text:'新', t:2.5, d:.5, c0:3, c1:4 },{ text:'歌', t:3, d:.5, c0:4, c1:5 },{ text:'词', t:3.5, d:.5, c0:5, c1:6 }] }];
    window.lyricsTimingSource = 'yrc-word'; audio.currentTime = 1.2;
    await new Promise(resolve => setTimeout(resolve, 520));
    const after = document.querySelector('#lf-t13-lyrics .lf-t13-animation-line.current');
    return { changed:before !== after, text:after && after.querySelector('.lf-t13-animation-main').getAttribute('aria-label'),
      oldCurrent:!!Array.from(document.querySelectorAll('#lf-t13-lyrics .lf-t13-animation-line.current')).find(node => node.textContent.includes(f.text)),
      count:document.querySelectorAll('#lf-t13-lyrics .lf-t13-animation-line').length };
  }, [fixtures]);
  pass('track change replaces stale current lyric and leaves exactly the new song sentence',
    songChange.changed && songChange.text === '切歌后新歌词' && !songChange.oldCurrent && songChange.count === 1, songChange);

  const modes = await cdp.call(async function () {
    const buttons = Array.from(document.querySelectorAll('#lf-t13-lyric-block [data-lf-lyric-mode]')).map(node => node.dataset.lfLyricMode);
    LumiFieldTask13.setLyricState({ mode:'normal' });
    await new Promise(resolve => setTimeout(resolve, 100));
    const normal = { state:LumiFieldTask13.getState().lyrics.mode, root:document.getElementById('lf-t13-lyrics').dataset.mode,
      customLines:document.querySelectorAll('#lf-t13-lyrics .lf-t13-animation-line').length, nativeVisible:window.lumiFieldNativeLyricsVisible };
    LumiFieldTask13.setLyricState({ mode:'animation', translate:true });
    let rejected = false; try { LumiFieldTask13.setLyricState({ mode:'fan' }); } catch (_) { rejected = true; }
    return { buttons, normal, rejected, state:LumiFieldTask13.getState().lyrics.mode };
  });
  pass('normal and animation are the only runtime modes and normal restores native lyrics',
    JSON.stringify(modes.buttons) === JSON.stringify(['normal','animation']) && modes.normal.state === 'normal' &&
      modes.normal.root === 'off' && modes.normal.customLines === 0 && modes.normal.nativeVisible === true &&
      modes.rejected && modes.state === 'animation', modes);

  await cdp.call(function (f) {
    window.playQueue[0] = { provider:'fixture', id:'problem12-video', name:'Problem 12 Evidence', artist:'LumiField QA' };
    const selected = LumiFieldLyricTiming.selectTimeline({ yrc:f.yrc }); selected.lines[0].translation = f.translation;
    selected.lines[1].translation = 'The next sentence'; window.lyricsLines = selected.lines; window.lyricsTimingSource = selected.source;
    audio.currentTime = 1; LumiFieldTask13.setLyricState({ mode:'animation', translate:true });
  }, [fixtures]);
  await delay(120);
  const recording = await recordEvidence();
  const videoPath = path.join(evidenceDir, '03-problem12-live-word-timeline.webm');
  fs.writeFileSync(videoPath, Buffer.from(recording.base64, 'base64'));
  pass('short WebM records native timing reveal gradient underline retention and sentence transition',
    recording.bytes >= 40000 && recording.durationMs >= 4000 && /webm/.test(recording.mimeType),
    { file:videoPath, bytes:recording.bytes, durationMs:recording.durationMs, width:recording.width, height:recording.height, mimeType:recording.mimeType });

  pass('renderer has no uncaught exceptions', rendererErrors.length === 0, rendererErrors);
  const result = {
    ok:true, runId, mode:'Electron source + CDP problem 12 native/enhanced lyric timing', origin, evidenceDir,
    fixtures:{ text:fixtures.text, sources:['YRC','QRC','TTML','KRC','LRC'] }, screenshots, video:videoPath,
    checks, rendererErrors,
  };
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(evidenceDir, 'app.log'), appLog.join('').replace(/\b\d{6}\b/g, '[REDACTED_CODE]'));
  process.stdout.write(JSON.stringify(result) + '\n');
}

run().catch(error => {
  const failure = { ok:false, runId, origin, evidenceDir, error:String(error && error.stack || error), checks, screenshots, rendererErrors };
  try {
    fs.writeFileSync(path.join(evidenceDir, 'failure.json'), JSON.stringify(failure, null, 2));
    fs.writeFileSync(path.join(evidenceDir, 'app.log'), appLog.join('').replace(/\b\d{6}\b/g, '[REDACTED_CODE]'));
  } catch (_) {}
  console.error(failure.error);
  process.exitCode = 1;
}).finally(() => {
  if (cdp) cdp.close();
  if (app && app.pid && app.exitCode == null) spawnSync('taskkill', ['/pid', String(app.pid), '/t', '/f'], { windowsHide:true, stdio:'ignore' });
  try { fs.rmSync(userData, { recursive:true, force:true }); } catch (_) {}
});
