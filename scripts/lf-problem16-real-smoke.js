'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const electron = require('electron');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.resolve(process.env.LF_PROBLEM16_OUT || path.join(repo, 'test-results', 'lf-problem16-real', runId));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-problem16-'));
const rows = [];
const checks = {};
const rendererErrors = [];
const appLog = [];
const backendLog = [];
let backend = null;
let app = null;
let cdp = null;

const fixtures = [
  ['小城夏天', 'LBI利比', /LBI|利比/i],
  ['晴天', '周杰伦', /周杰伦|周杰倫|Jay\s*Chou/i],
  ['七里香', '周杰伦', /周杰伦|周杰倫|Jay\s*Chou/i],
  ['稻香', '周杰伦', /周杰伦|周杰倫|Jay\s*Chou/i],
  ['夜曲', '周杰伦', /周杰伦|周杰倫|Jay\s*Chou/i],
  ['演员', '薛之谦', /薛之谦|薛之謙/i],
  ['天外来物', '薛之谦', /薛之谦|薛之謙/i],
  ['光年之外', '邓紫棋', /邓紫棋|鄧紫棋|G\.E\.M/i],
  ['泡沫', '邓紫棋', /邓紫棋|鄧紫棋|G\.E\.M/i],
  ['句号', '邓紫棋', /邓紫棋|鄧紫棋|G\.E\.M/i],
  ['平凡之路', '朴树', /朴树|朴樹/i],
  ['生如夏花', '朴树', /朴树|朴樹/i],
  ['红豆', '王菲', /王菲/i],
  ['匆匆那年', '王菲', /王菲/i],
  ['十年', '陈奕迅', /陈奕迅|陳奕迅|Eason/i],
  ['富士山下', '陈奕迅', /陈奕迅|陳奕迅|Eason/i],
  ['后来', '刘若英', /刘若英|劉若英/i],
  ['童话', '光良', /光良/i],
  ['勇气', '梁静茹', /梁静茹|梁靜茹/i],
  ['可惜没如果', '林俊杰', /林俊杰|林俊傑|JJ\s*Lin/i],
];

fs.mkdirSync(evidenceDir, { recursive:true });

function pass(name, condition, details) {
  assert.ok(condition, name + (details == null ? '' : ': ' + JSON.stringify(details)));
  checks[name] = details == null ? true : details;
}
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function norm(value) {
  return String(value || '').normalize('NFKC').toLowerCase()
    .replace(/[（(【\[].*?[）)】\]]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
}
function isDerivative(value) {
  return /(翻唱|cover|伴奏|instrumental|remix|dj(?:版)?|现场|演唱会|live|片段|铃声|纯音乐|karaoke|demo|加速版|降速版|抖音版|剪辑版|女声版|男声版)/i.test(String(value || ''));
}
function titleMatches(expected, actual) {
  const left = norm(expected), right = norm(actual);
  return !!left && !!right && (left === right || right.startsWith(left));
}
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.unref(); server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(error => error ? reject(error) : resolve(port)); });
  });
}
async function waitFor(fn, timeout = 45000, interval = 180) {
  const started = Date.now(); let last;
  while (Date.now() - started < timeout) {
    try { last = await fn(); if (last) return last; } catch (_) {}
    await delay(interval);
  }
  throw new Error('Timed out after ' + timeout + 'ms; last=' + JSON.stringify(last));
}
async function json(origin, route, options, timeout) {
  const response = await fetch(origin + route, { ...(options || {}), signal:AbortSignal.timeout(timeout || 90000) });
  const text = await response.text();
  let body = {}; try { body = JSON.parse(text); } catch (_) {}
  return { status:response.status, body, text:text.slice(0, 500) };
}
async function probeAudio(url, provider) {
  if (!url) return { ok:false, status:0, contentType:'', bytes:0, reason:'empty_url' };
  const referers = { kugou:'https://www.kugou.com/', netease:'https://music.163.com/', qq:'https://y.qq.com/', qishui:'https://www.qishui.com/' };
  try {
    const response = await fetch(url, {
      redirect:'follow', signal:AbortSignal.timeout(25000),
      headers:{ Range:'bytes=0-8191', 'User-Agent':'Mozilla/5.0', Referer:referers[provider] || 'https://www.kugou.com/' },
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    const type = String(response.headers.get('content-type') || '').toLowerCase();
    const prefix = buffer.subarray(0, 256).toString('utf8').toLowerCase();
    const mediaLike = /audio|video|octet-stream|mpegurl|application\/vnd\.apple/i.test(type) ||
      /^id3/.test(buffer.subarray(0, 3).toString('latin1').toLowerCase()) || buffer[0] === 0xff || /ftyp/.test(buffer.subarray(0, 32).toString('latin1'));
    return { ok:(response.status === 200 || response.status === 206) && buffer.length > 128 && mediaLike && !/<html|<!doctype/.test(prefix),
      status:response.status, contentType:type, bytes:buffer.length, finalUrl:response.url };
  } catch (error) {
    return { ok:false, status:0, contentType:'', bytes:0, reason:String(error && error.message || error).slice(0, 200) };
  }
}

class CDP {
  constructor(url) { this.url=url; this.id=0; this.pending=new Map(); }
  async connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id); this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result || {});
      } else if (message.method === 'Runtime.exceptionThrown') {
        const detail = message.params && message.params.exceptionDetails || {};
        rendererErrors.push(String(detail.exception && detail.exception.description || detail.text || 'Renderer exception').slice(0, 1800));
      }
    };
    await new Promise((resolve,reject) => { this.ws.onopen=resolve; this.ws.onerror=reject; });
    await this.send('Runtime.enable'); await this.send('Page.enable'); await this.send('Page.bringToFront');
  }
  send(method, params) {
    const id=++this.id;
    return new Promise((resolve,reject) => { this.pending.set(id,{resolve,reject}); this.ws.send(JSON.stringify({id,method,params:params||{}})); });
  }
  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true, userGesture:true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception && response.exceptionDetails.exception.description || response.exceptionDetails.text);
    return response.result && response.result.value;
  }
  call(fn,args) { return this.evaluate('(' + fn.toString() + ').apply(null,' + JSON.stringify(args || []) + ')'); }
  close() { try { this.ws.close(); } catch (_) {} }
}

async function backendAudit() {
  const port = await freePort(); const origin = 'http://127.0.0.1:' + port;
  backend = spawn(process.execPath, ['server.js'], {
    cwd:repo, windowsHide:true, stdio:['ignore','pipe','pipe'],
    env:{ ...process.env, PORT:String(port), HOST:'127.0.0.1', LUMIFIELD_MUSIC_SESSION_SECRET:crypto.randomBytes(32).toString('hex'),
      LF_MAIL_HOST:' ', LF_MAIL_USER:' ', LF_MAIL_PASSWORD:' ', LF_REMOTE_API_URL:' ' },
  });
  backend.stdout.on('data', chunk => backendLog.push(String(chunk)));
  backend.stderr.on('data', chunk => backendLog.push(String(chunk)));
  await waitFor(async () => (await json(origin, '/api/app/version', null, 8000)).status === 200, 45000, 250);

  for (let index = 0; index < fixtures.length; index++) {
    const [title, artist, artistPattern] = fixtures[index];
    const query = title + ' ' + artist;
    const searched = await json(origin, '/api/platform/search?keywords=' + encodeURIComponent(query) + '&limit=18&force=1', null, 120000);
    const body = searched.body || {}; const songs = Array.isArray(body.songs) ? body.songs : [];
    const first = songs[0] || {};
    const original = titleMatches(title, first.name) && artistPattern.test(String(first.artist || '')) && !isDerivative([first.name,first.artist,first.album].join(' '));
    let resolved = { ok:false, playable:false, reason:'search_empty', attempts:[] };
    let probe = { ok:false, reason:'not_resolved' };
    if (first.id) {
      const response = await json(origin, '/api/platform/resolve', {
        method:'POST', headers:{'content-type':'application/json'},
        body:JSON.stringify({ song:first, quality:'standard', force:true }),
      }, 150000);
      resolved = response.body || {};
      if (resolved.playable && resolved.url) probe = await probeAudio(resolved.url, resolved.provider || first.provider);
    }
    const resolvedSong = resolved.resolvedSong || first;
    const fallbackUsed = !!resolved.fallbackUsed || !!resolved.fallbackFrom;
    const fallback = fallbackUsed ? (String(resolved.fallbackFrom || first.provider || '') + '->' + String(resolved.fallbackTo || resolved.provider || '')) : '';
    const allowedReason = /^(?:paid_required|vip_required|login_required|region_restricted|copyright_unavailable|resource_expired|resource_invalid|resource_unavailable|url_unavailable|same_song_not_found|provider_unavailable|resolve_failed)$/;
    const strictAttempts = (resolved.attempts || []).filter(attempt => attempt && attempt.directSource === false);
    const legalFallback = !fallbackUsed || (titleMatches(title, resolvedSong.name) && artistPattern.test(String(resolvedSong.artist || '')) && !isDerivative([resolvedSong.name,resolvedSong.album].join(' ')) &&
      strictAttempts.every(attempt => attempt.matchPolicy === 'strict-title-artist-version' && attempt.matchVerified !== false));
    const final = resolved.playable ? (probe.ok ? 'PLAYABLE_PROBED' : 'PLAYABLE_PROBE_FAILED') : ('BLOCKED:' + String(resolved.reason || resolved.restriction && resolved.restriction.category || 'unknown'));
    rows.push({ index:index+1, query, firstResult:first.name || '', artist:first.artist || '', provider:first.provider || first.source || '',
      original, playable:!!resolved.playable && !!probe.ok, fallback, final,
      providersTried:body.providersTried || [], priority:body.priority || [], rankingPolicy:body.rankingPolicy || '', qishuiSearchEnabled:body.qishuiSearchEnabled, resultCount:songs.length,
      resolve:{ provider:resolved.provider || '', playable:!!resolved.playable, reason:resolved.reason || resolved.restriction && resolved.restriction.category || '',
        message:resolved.message || resolved.restriction && resolved.restriction.message || '', attempts:resolved.attempts || [], resolvedSong:{ name:resolvedSong.name || '', artist:resolvedSong.artist || '', provider:resolvedSong.provider || '' } }, probe });
    assert.equal(searched.status, 200, query + ' search status');
    assert.ok(songs.length > 0, query + ' returned no songs');
    assert.ok(original, query + ' first result is not the expected original: ' + JSON.stringify(rows[rows.length-1]));
    assert.deepEqual((body.providersTried || []).slice(0,3), ['kugou','netease','qq'], query + ' provider order');
    assert.deepEqual(body.priority || [], ['kugou','netease','qq','qishui'], query + ' declared priority');
    assert.equal(body.rankingPolicy, 'lf-search-v2', query + ' ranking policy');
    assert.ok(body.qishuiSearchEnabled === true || body.qishuiSearchEnabled === false, query + ' Qishui search capability must be explicit');
    assert.deepEqual(resolved.priority || [], ['kugou','netease','qq','qishui'], query + ' resolve priority');
    assert.ok(legalFallback, query + ' fallback was not strict same title and artist');
    assert.ok((resolved.playable && probe.ok) || (!resolved.playable && allowedReason.test(String(resolved.reason || resolved.restriction && resolved.restriction.category || ''))),
      query + ' neither probed playable nor accurately restricted: ' + JSON.stringify(rows[rows.length-1]));
    fs.writeFileSync(path.join(evidenceDir, 'songs.partial.json'), JSON.stringify(rows, null, 2));
    await delay(650);
  }
  pass('20 real mainstream searches returned exact original first results', rows.length === 20 && rows.every(row => row.original), { count:rows.length });
  pass('provider query order is Kugou then Netease then QQ', rows.every(row => JSON.stringify(row.providersTried.slice(0,3)) === JSON.stringify(['kugou','netease','qq'])));
  pass('every real result is either media-probed playable or carries an accurate legal restriction', rows.every(row => row.final === 'PLAYABLE_PROBED' || /^BLOCKED:(?:paid_required|vip_required|login_required|region_restricted|copyright_unavailable|resource_expired|resource_invalid|resource_unavailable|url_unavailable|same_song_not_found|provider_unavailable|resolve_failed)$/.test(row.final)),
    { playable:rows.filter(row => row.final === 'PLAYABLE_PROBED').length, restricted:rows.filter(row => row.final.startsWith('BLOCKED:')).length });
  pass('all cross-provider fallbacks retain strict same title artist and original edition', rows.every(row => !row.fallback ||
    (titleMatches(row.query.split(' ')[0], row.resolve.resolvedSong.name) && !isDerivative(row.resolve.resolvedSong.name))),
    rows.filter(row => row.fallback).map(row => ({ query:row.query, fallback:row.fallback, song:row.resolve.resolvedSong })));
  return origin;
}

async function electronAudit() {
  const port = await freePort();
  app = spawn(electron, ['.', '--user-data-dir=' + userData, '--remote-debugging-port=' + port, '--remote-debugging-address=127.0.0.1'], {
    cwd:repo, windowsHide:true, stdio:['ignore','pipe','pipe'], env:{ ...process.env, LF_ALLOW_LOCAL_CODES:'1', ELECTRON_DISABLE_SECURITY_WARNINGS:'true',
      LUMIFIELD_SKIP_SPLASH:'1', LF_MAIL_HOST:' ', LF_MAIL_USER:' ', LF_MAIL_PASSWORD:' ', LF_REMOTE_API_URL:' ' },
  });
  const collect = chunk => { const value=String(chunk); appLog.push(value); if (/(?:FATAL|uncaught exception|renderer process crashed)/i.test(value)) rendererErrors.push(value.slice(0,1800)); };
  app.stdout.on('data',collect); app.stderr.on('data',collect);
  const target = await waitFor(async () => {
    const response = await fetch('http://127.0.0.1:' + port + '/json/list'); const targets=await response.json();
    return targets.find(item => item.type === 'page' && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//.test(item.url));
  }, 50000, 250);
  cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
  await waitFor(() => cdp.call(function(){ return document.readyState === 'complete' && typeof doSearch === 'function' && typeof playSearchResult === 'function'; }), 50000, 200);
  const runtime = await cdp.call(async function () {
    document.body.classList.remove('lf-auth-locked','splash-active');
    const auth=document.getElementById('lf-auth-root'); if(auth){auth.classList.remove('show');auth.style.setProperty('display','none','important');}
    const splash=document.getElementById('splash'); if(splash)splash.style.display='none';
    const input=document.getElementById('search-input') || document.querySelector('#search-area input');
    if (input) input.value='小城夏天 LBI利比';
    window.searchMode='song';
    await doSearch('小城夏天 LBI利比');
    await new Promise(resolve=>setTimeout(resolve,1200));
    const first=window.playlist && playlist[0];
    const firstNode=document.querySelector('#search-results .search-result');
    if (firstNode) firstNode.querySelector('div[onclick*="playSearchResult"]')?.click();
    await new Promise(resolve=>setTimeout(resolve,10000));
    return { count:Array.isArray(window.playlist)?playlist.length:0, first:first&&{name:first.name,artist:first.artist,provider:first.provider||first.source},
      current:window.playQueue && playQueue[currentIdx] && {name:playQueue[currentIdx].name,artist:playQueue[currentIdx].artist,provider:playQueue[currentIdx].provider||playQueue[currentIdx].source},
      audioSrc:window.audio && audio.src || '', resultVisible:!!firstNode, lastProvider:window.lumiFieldLastSearchProvider || '' };
  });
  pass('real Electron search renders results and a real result click enters playback queue', runtime.count > 0 && runtime.resultVisible && runtime.first && runtime.current &&
    titleMatches('小城夏天',runtime.first.name) && /LBI|利比/i.test(runtime.first.artist) && titleMatches(runtime.first.name,runtime.current.name), runtime);
  pass('Electron renderer has no uncaught exceptions', rendererErrors.length === 0, rendererErrors);
  return runtime;
}

async function stopAll() {
  if (cdp) { try { await cdp.send('Browser.close'); } catch (_) {} cdp.close(); cdp=null; }
  if (app && app.pid && app.exitCode == null) { await Promise.race([new Promise(resolve=>app.once('exit',resolve)),delay(5000)]); }
  if (app && app.pid && app.exitCode == null) spawnSync('taskkill',['/pid',String(app.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'});
  if (backend && backend.pid && backend.exitCode == null) spawnSync('taskkill',['/pid',String(backend.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'});
}

(async function run() {
  await backendAudit();
  if (backend && backend.pid && backend.exitCode == null) spawnSync('taskkill',['/pid',String(backend.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'});
  backend=null; await delay(900);
  const electron = await electronAudit();
  const result={ ok:true, runId, evidenceDir, mode:'20 real online mainstream searches + resolve/media probe + Electron click', fixtures:fixtures.map(v=>v.slice(0,2)), rows, electron, checks, rendererErrors };
  fs.writeFileSync(path.join(evidenceDir,'songs.json'),JSON.stringify(rows,null,2));
  fs.writeFileSync(path.join(evidenceDir,'result.json'),JSON.stringify(result,null,2));
  fs.writeFileSync(path.join(evidenceDir,'backend.log'),backendLog.join('').replace(/\b\d{6}\b/g,'[REDACTED_CODE]'));
  fs.writeFileSync(path.join(evidenceDir,'app.log'),appLog.join('').replace(/\b\d{6}\b/g,'[REDACTED_CODE]'));
  console.log(JSON.stringify({ok:true,evidenceDir,rows:rows.length,playable:rows.filter(row=>row.final==='PLAYABLE_PROBED').length,checks:Object.keys(checks).length,rendererErrors:rendererErrors.length},null,2));
})().catch(error => {
  const failure={ok:false,runId,evidenceDir,error:String(error&&error.stack||error),rows,checks,rendererErrors};
  try{fs.writeFileSync(path.join(evidenceDir,'failure.json'),JSON.stringify(failure,null,2));fs.writeFileSync(path.join(evidenceDir,'songs.partial.json'),JSON.stringify(rows,null,2));}catch(_){}
  console.error(failure.error); process.exitCode=1;
}).finally(async()=>{ await stopAll(); try{fs.rmSync(userData,{recursive:true,force:true});}catch(_){} });
