const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const port = 3013;
const origin = `http://127.0.0.1:${port}`;
let server;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function json(route, options) {
  const response = await fetch(origin + route, { ...options, signal: AbortSignal.timeout(45000) });
  let body;
  try { body = await response.json(); } catch (_) { body = {}; }
  return { status: response.status, body };
}

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 30000) {
    try {
      const result = await json('/api/app/version');
      if (result.status === 200) return result.body;
    } catch (_) {}
    await delay(250);
  }
  throw new Error('PLATFORM_SMOKE_SERVER_TIMEOUT');
}

(async () => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: repo,
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      LUMIFIELD_MUSIC_SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
      LF_TRANSLATE_ENDPOINT: '',
      LF_TRANSLATE_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const app = await waitForServer();
  const [audit, status, hot, search, translation] = await Promise.all([
    json('/api/platform/audit'),
    json('/api/platforms/status'),
    json('/api/platform/hot-comments?limit=6'),
    json('/api/platform/search?keywords=' + encodeURIComponent('小城夏天 LBI利比') + '&limit=12'),
    json('/api/translate/lyrics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lines: ['hello'] }),
    }),
  ]);

  assert.equal(app.version, require('../package.json').version);
  assert.equal(audit.status, 200);
  assert.equal(require('../package.json').license, 'GPL-3.0-only');
  assert.equal(audit.body.audit.provenanceNotice, 'NOTICE.md');
  assert.deepEqual(audit.body.audit.rejectedReferenceFeatures, [
    'non-standard-editions',
    'hardcoded-third-party-credentials',
    'device-fingerprint-simulation',
    'behavior-simulation',
    'unknown-cookie-upload',
  ]);
  assert.equal(status.status, 200);
  assert.deepEqual(Object.keys(status.body.platforms).sort(), ['kugou', 'kugou_concept', 'netease', 'qishui', 'qq']);
  assert.equal(hot.status, 200);
  assert.equal(hot.body.empty, true);
  assert.equal(hot.body.code, 'NO_LOGGED_IN_MUSIC_PLATFORM');
  assert.equal(translation.status, 200);
  assert.equal(translation.body.ok, true);
  assert.equal(translation.body.adapter, 'local-bergamot');
  assert.equal(Array.isArray(translation.body.translations), true);
  assert.equal(translation.body.translations.length, 1);
  assert.equal(typeof translation.body.translations[0], 'string');
  assert(translation.body.translations[0].trim().length > 0);

  const searchBody = search.body || {};
  assert.equal(search.status, 200);
  assert.deepEqual(searchBody.providersTried, ['kugou', 'netease', 'qq']);
  assert(Array.isArray(searchBody.songs) && searchBody.songs.length > 0);
  const top = searchBody.songs[0];
  assert(/小城夏天/.test(String(top.name || '')));
  assert(/LBI|利比/i.test(String(top.artist || '')));
  const resolve = await json('/api/platform/resolve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ song: top }),
  });
  assert.equal(resolve.status, 200);
  assert(Array.isArray(resolve.body.attempts) && resolve.body.attempts.length >= 1);
  let resolvedProtocol = '';
  if (resolve.body.playable) {
    const resolvedUrl = new URL(String(resolve.body.url || ''));
    resolvedProtocol = resolvedUrl.protocol;
    assert(['http:', 'https:'].includes(resolvedProtocol));
    assert(!/^(?:localhost|127\.|0\.|169\.254\.)/i.test(resolvedUrl.hostname));
  }

  const result = {
    ok: true,
    checkedAt: new Date().toISOString(),
    version: app.version,
    audit: {
      license: require('../package.json').license,
      provenanceNotice: audit.body.audit.provenanceNotice,
      networkBoundary: audit.body.audit.networkBoundary,
      rejectedUnsafeFeatures: audit.body.audit.rejectedReferenceFeatures.length,
    },
    independentPlatforms: Object.keys(status.body.platforms).sort(),
    loggedInPlatforms: Array.isArray(status.body.loggedInPlatforms) ? status.body.loggedInPlatforms.length : 0,
    hotCommentEmptyState: hot.body.message,
    translation: {
      adapter: translation.body.adapter,
      translatedLines: translation.body.translations.length,
    },
    search: {
      providersTried: searchBody.providersTried,
      resultCount: searchBody.songs.length,
      topExactTitle: /小城夏天/.test(String(top.name || '')),
      topExactArtist: /LBI|利比/i.test(String(top.artist || '')),
      topProvider: top.provider || top.source || '',
    },
    resolve: {
      playable: !!resolve.body.playable,
      provider: resolve.body.provider || '',
      trial: !!resolve.body.trial,
      protocol: resolvedProtocol,
      attempts: resolve.body.attempts.map(item => ({ provider: item.provider, reason: item.reason || '' })),
    },
  };
  const evidenceDir = path.join(repo, 'evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'lf-platform-smoke.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(() => {
  if (server && server.pid) spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
});
