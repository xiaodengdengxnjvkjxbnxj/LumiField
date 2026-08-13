'use strict';

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const repo = path.resolve(__dirname, '..');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.resolve(process.env.LF_PROBLEM16_OUT || path.join(repo, 'test-results', 'lf-problem16-smoke', runId));
const resultFile = path.join(evidenceDir, 'result.json');
const expectedPriority = ['kugou', 'netease', 'qq', 'qishui'];
const songs = [
  ['晴天', '周杰伦'], ['七里香', '周杰伦'], ['稻香', '周杰伦'], ['夜曲', '周杰伦'], ['告白气球', '周杰伦'],
  ['演员', '薛之谦'], ['认真的雪', '薛之谦'], ['泡沫', 'G.E.M.邓紫棋'], ['光年之外', 'G.E.M.邓紫棋'],
  ['红豆', '王菲'], ['匆匆那年', '王菲'], ['如愿', '王菲'], ['海阔天空', 'BEYOND'], ['光辉岁月', 'BEYOND'],
  ['小幸运', '田馥甄'], ['后来', '刘若英'], ['童话', '光良'], ['平凡之路', '朴树'], ['孤勇者', '陈奕迅'], ['十年', '陈奕迅'],
];
const derivativePattern = /(翻唱|cover|伴奏|伴唱|instrumental|remix|dj(?:版)?|现场|演唱会|live|片段|铃声|纯音乐|纯享版|清唱|karaoke|demo|加速|降速|慢速|sped\s*up|slowed|nightcore|女声版|男声版|抖音版|剪辑版|改编|串烧|medley|车载版)/i;
const preciseReasons = new Set([
  'paid_required', 'vip_required', 'login_required', 'region_restricted', 'copyright_unavailable',
  'resource_expired', 'resource_invalid', 'resource_unavailable', 'url_unavailable', 'same_song_not_found',
]);

fs.mkdirSync(evidenceDir, { recursive: true });

function normalize(value) {
  return String(value || '').normalize('NFKC').toLowerCase()
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function artistMatches(actual, expected) {
  const left = normalize(actual);
  const right = normalize(expected);
  if (!left || !right) return false;
  if (left === right || left.includes(right) || right.includes(left)) return true;
  if (/邓紫棋/.test(left) && /邓紫棋/.test(right)) return true;
  return false;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 30000);
  try {
    return await fetch(url, { ...(options || {}), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function json(url, options, timeoutMs) {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch (_) { throw new Error('INVALID_JSON ' + response.status + ' ' + text.slice(0, 160)); }
  assert.ok(response.ok, 'HTTP ' + response.status + ': ' + JSON.stringify(data).slice(0, 400));
  return data;
}

async function waitReady(origin) {
  let last = '';
  for (let i = 0; i < 100; i++) {
    try {
      const data = await json(origin + '/api/platform/audit', {}, 1500);
      if (data && data.ok) return data;
    } catch (error) { last = error.message; }
    await delay(120);
  }
  throw new Error('SERVER_NOT_READY: ' + last);
}

async function probeAudio(origin, url) {
  const response = await fetchWithTimeout(origin + '/api/audio?url=' + encodeURIComponent(url), {
    headers: { Range: 'bytes=0-65535' },
  }, 20000);
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const looksHtml = /^\s*</.test(buffer.subarray(0, 256).toString('utf8'));
  return {
    ok: (response.status === 200 || response.status === 206) && buffer.length >= 1024 && !looksHtml,
    status: response.status,
    contentType,
    bytes: buffer.length,
  };
}

function expectedAttempts(requestedProvider, qishuiSearchEnabled) {
  const fallbacks = expectedPriority.filter(provider => provider !== 'qishui' || qishuiSearchEnabled);
  return [requestedProvider].concat(fallbacks.filter(provider => provider !== requestedProvider));
}

async function runOne(origin, title, artist) {
  const query = title + ' ' + artist;
  const search = await json(origin + '/api/platform/search?keywords=' + encodeURIComponent(query) + '&limit=18', {}, 35000);
  assert.deepStrictEqual(search.priority, expectedPriority, query + ': search priority');
  assert.deepStrictEqual(search.providersTried, search.qishuiSearchEnabled ? expectedPriority : expectedPriority.slice(0, 3), query + ': providers tried');
  assert.equal(search.rankingPolicy, 'lf-search-v2', query + ': ranking policy');
  assert.ok(Array.isArray(search.songs) && search.songs.length, query + ': no result');
  const first = search.songs[0];
  assert.equal(normalize(first.name), normalize(title), query + ': first title ' + first.name);
  assert.ok(artistMatches(first.artist, artist), query + ': first artist ' + first.artist);
  assert.ok(!derivativePattern.test([first.name, first.artist, first.album].join(' ')), query + ': derivative first result');
  assert.ok(expectedPriority.includes(first.provider), query + ': invalid provider');

  const resolved = await json(origin + '/api/platform/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ song: first, quality: 'standard', force: true }),
  }, 55000);
  assert.deepStrictEqual(resolved.priority, expectedPriority, query + ': resolve priority');
  assert.equal(resolved.requestedProvider, first.provider, query + ': requested provider');
  assert.ok(Array.isArray(resolved.attempts) && resolved.attempts.length, query + ': attempts missing');
  const allowedOrder = expectedAttempts(first.provider, resolved.qishuiSearchEnabled);
  assert.deepStrictEqual(resolved.attempts.map(item => item.provider), allowedOrder.slice(0, resolved.attempts.length), query + ': attempt order');
  resolved.attempts.slice(1).forEach(attempt => {
    assert.equal(attempt.matchPolicy, 'strict-title-artist-version', query + ': fallback match policy');
  });

  let media = null;
  if (resolved.url) {
    assert.equal(resolved.finalResult, 'playable', query + ': playable final result');
    media = await probeAudio(origin, resolved.url);
    assert.ok(media.ok, query + ': media probe ' + JSON.stringify(media));
  } else {
    assert.equal(resolved.finalResult, 'restricted', query + ': restricted final result');
    assert.ok(preciseReasons.has(resolved.reason), query + ': imprecise reason ' + resolved.reason);
  }
  return {
    query,
    firstResult: { title: first.name, artist: first.artist, provider: first.provider, officialOriginal: first.officialOriginal === true, derivative: false, playableHint: first.playable, score: first.searchScore },
    playable: !!resolved.url,
    fallback: { used: resolved.fallbackUsed === true, from: resolved.fallbackFrom || '', to: resolved.fallbackTo || '' },
    final: resolved.url ? 'playable' : resolved.reason,
    attempts: resolved.attempts,
    media,
  };
}

(async () => {
  const port = await freePort();
  const origin = 'http://127.0.0.1:' + port;
  const appLog = [];
  const server = spawn(process.execPath, ['server.js'], {
    cwd: repo,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', chunk => appLog.push(String(chunk)));
  server.stderr.on('data', chunk => appLog.push(String(chunk)));
  const report = { runId, origin, priority: expectedPriority, qishuiSearchEnabled: false, songs: [], pass: false };
  try {
    const audit = await waitReady(origin);
    assert.deepStrictEqual(audit.audit.searchPriority, expectedPriority);
    report.qishuiSearchEnabled = audit.audit.qishuiSearchEnabled === true;
    for (const [title, artist] of songs) report.songs.push(await runOne(origin, title, artist));
    report.summary = {
      total: report.songs.length,
      exactFirstResults: report.songs.filter(item => normalize(item.firstResult.title) === normalize(item.query.split(' ')[0])).length,
      playable: report.songs.filter(item => item.playable).length,
      restrictedWithReason: report.songs.filter(item => !item.playable && preciseReasons.has(item.final)).length,
      fallbacks: report.songs.filter(item => item.fallback.used).length,
    };
    assert.equal(report.summary.total, 20);
    report.pass = true;
    fs.writeFileSync(resultFile, JSON.stringify(report, null, 2));
    console.log('LF problem16 smoke PASS', JSON.stringify(report.summary));
    console.log(resultFile);
  } catch (error) {
    report.error = error && error.stack || String(error);
    report.logTail = appLog.join('').slice(-10000);
    fs.writeFileSync(resultFile, JSON.stringify(report, null, 2));
    console.error('LF problem16 smoke FAIL:', error && error.stack || error);
    console.error(resultFile);
    process.exitCode = 1;
  } finally {
    if (!server.killed) server.kill();
  }
})();
