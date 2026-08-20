'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const repo = path.resolve(__dirname, '..');
const dependencyRoot = process.env.LF_DEPENDENCY_ROOT || path.resolve(repo, '..', '..', 'release', 'verify-v1.1.43-tag', 'node_modules');
const electronExe = path.join(dependencyRoot, 'electron', 'dist', 'electron.exe');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.join(repo, 'test-results', 'lf-v1144-5-playlist-dissolve', runId);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-v1144-5-'));
const checks = {};
const rendererErrors = [];
const consoleErrors = [];
const screenshots = [];
const appLog = [];
let app = null;
let cdp = null;

fs.mkdirSync(evidenceDir, { recursive:true });
fs.mkdirSync(path.join(userData, 'migrations'), { recursive:true });
fs.writeFileSync(path.join(userData, 'migrations', 'legacy-upstream-platform-session-v2.json'), JSON.stringify({
  version:2, validated:true, testIsolation:true, results:[]
}, null, 2), { encoding:'utf8', mode:0o600 });

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex').toUpperCase(); }
function fileSha256(file) { return sha256(fs.readFileSync(file)); }
function pass(name, condition, detail) {
  assert.ok(condition, `${name}: ${JSON.stringify(detail)}`);
  checks[name] = detail == null ? true : detail;
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
  let last = null;
  while (Date.now() - started < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      last = String(error && error.message || error);
    }
    await delay(interval);
  }
  throw new Error(`Timeout: ${JSON.stringify(last)}`);
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
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const detail = message.params && message.params.exceptionDetails || {};
        rendererErrors.push(String(detail.exception && detail.exception.description || detail.text || 'renderer exception'));
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params && message.params.type === 'error') {
        consoleErrors.push((message.params.args || []).map(item => item.value || item.description || '').join(' '));
      }
    };
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
  }
  send(method, params, timeout = 30000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params:params || {} }));
    });
  }
  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true, userGesture:true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception && response.exceptionDetails.exception.description || response.exceptionDetails.text);
    return response.result && response.result.value;
  }
  async screenshot(name) {
    const response = await this.send('Page.captureScreenshot', { format:'png', fromSurface:true, captureBeyondViewport:false });
    const file = path.join(evidenceDir, name);
    fs.writeFileSync(file, Buffer.from(response.data, 'base64'));
    screenshots.push({ file:path.basename(file), sha256:fileSha256(file), bytes:fs.statSync(file).size });
  }
  close() { try { this.ws.close(); } catch (_) {} }
}

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `missing ${name}`);
  const next = source.indexOf('\n  function ', start + 12);
  return source.slice(start, next < 0 ? source.length : next);
}

function staticChecks() {
  const index = fs.readFileSync(path.join(repo, 'public', 'index.html'), 'utf8');
  const effect = fs.readFileSync(path.join(repo, 'public', 'lf-particle-range-control.js'), 'utf8');
  const snapshot = index.slice(index.indexOf('getDeleteVisualSnapshot: function'), index.indexOf('getDeleteScreenPoint:', index.indexOf('getDeleteVisualSnapshot: function')));
  const confirmDelete = index.slice(index.indexOf('async function confirmPlaylistDelete'), index.indexOf('window.LumiFieldPlaylistMutation', index.indexOf('async function confirmPlaylistDelete')));
  const frameEffect = functionBody(effect, 'updateDeleteOriginal');
  const sampler = functionBody(effect, 'sampleDeleteParticles');

  pass('the exact dissolve reference video is pinned by SHA-256', effect.includes('3FDD9569045F97D60F64B8667A6E91A14B357CC261DF7D079C0B72DD85C79675'), true);
  pass('the 3D delete snapshot returns the original card canvas', /sourceCanvas:card\.canvas/.test(snapshot) && /originalTarget:true/.test(snapshot), true);
  pass('the 3D delete snapshot creates no replacement card or cover canvas', !/createElement\(['"]canvas['"]\)|drawImage\(/.test(snapshot), true);
  pass('the original card redraw is locked only while its own dissolve is active', /card\.deleteEffectActive === true/.test(index) && /card\.deleteEffectActive = true/.test(snapshot) && /card\.deleteEffectActive = false/.test(snapshot), true);
  pass('the original texture is erased from right to left and restored on cancellation', /clearRect\(nextX, 0, lastClearedX - nextX/.test(snapshot) && /putImageData\(imageData, 0, 0\)/.test(snapshot), true);
  pass('the overlay no longer draws a whole-card ghost clone', !/drawDeleteGhost/.test(effect) && !/drawImage\(\s*effect\.source/.test(effect) && /applyOriginalProgress/.test(frameEffect), true);
  pass('delete particles are numerous, small, RGB white, and unblurred', /target = reducedMotion\(\) \? 220 : 1600/.test(sampler) && /size:0\.45 \+ Math\.random\(\) \* 0\.72/.test(sampler) && /r:248,\s*g:250,\s*b:255/.test(sampler) && /particle\.kind === 'delete' \? 0 : 3\.5/.test(effect), true);
  pass('one shared particle pool and one RAF remain the only allocation path', /MAX_PARTICLES = 2200/.test(effect) && /function acquireParticle/.test(effect) && /state\.raf = global\.requestAnimationFrame\(frame\)/.test(effect), true);
  pass('playlist data removal happens only after the dissolve promise completes', /particleRemovalResult = await particleRangeControl\.animatePlaylistRemoval\(deleteSnapshot\)[\s\S]*applyConfirmedPlaylistRemoval\(pending\)/.test(index), true);
  pass('failed playlist mutation cannot start the visual effect', confirmDelete.indexOf("if (!result || result.ok !== true)") < confirmDelete.indexOf('getDeleteVisualSnapshot'), true);
}

async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return response.json();
}

async function startApp() {
  assert.ok(fs.existsSync(electronExe), `Electron not found: ${electronExe}`);
  const port = await freePort();
  app = spawn(electronExe, ['.', `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], {
    cwd:repo,
    windowsHide:true,
    stdio:['ignore','pipe','pipe'],
    env:Object.assign({}, process.env, {
      NODE_PATH:dependencyRoot,
      LF_MASTER_TEST:'1',
      LUMIFIELD_SKIP_SPLASH:'1',
      ELECTRON_DISABLE_SECURITY_WARNINGS:'true'
    })
  });
  const collect = data => appLog.push(String(data));
  app.stdout.on('data', collect);
  app.stderr.on('data', collect);
  const target = await waitFor(async () => {
    const targets = await listTargets(port);
    return targets.find(item => item.type === 'page' && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?(?:index\.html)?$/i.test(item.url));
  }, 60000);
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await waitFor(() => cdp.evaluate(`document.readyState==='complete' && !!window.renderer && !!window.shelfManager && !!window.LumiFieldParticleRangeControl && !!window.LumiFieldPlaylistMutation`), 60000);
  await delay(1500);
}

async function prepareReal3dPlaylist() {
  await cdp.evaluate(`(()=>{
    const hide=id=>{const n=document.getElementById(id);if(n){n.classList.remove('show','active');n.style.setProperty('display','none','important');n.setAttribute('aria-hidden','true');}};
    ['lf-auth-root','visual-guide','login-modal','user-modal','playlist-delete-modal','local-beat-modal'].forEach(hide);
    document.body.classList.remove('lf-auth-locked','splash-active','splash-revealing','empty-home-active','lf-fx-open','immersive-mode');
    window.emptyHomeActive=false;window.homeForcedOpen=false;window.homeSuppressed=true;window.immersiveMode=false;
    window.__lfV1144OriginalPlaylistLoader=window.loadUnifiedPlaylistTracks;
    window.loadUnifiedPlaylistTracks=async()=>({ok:true,tracks:[
      {provider:'local',id:'track-a',name:'原对象第一首',artist:'LumiField'},
      {provider:'local',id:'track-b',name:'原对象第二首',artist:'LumiField'}
    ]});
    const record=normalizeUserPlaylist('local',{id:'lf-v1144-delete',name:'原对象消散歌单',trackCount:2,playCount:18,owned:true,ownership:'owned',canDelete:true,songs:[]});
    window.localPlaylists=[record];window.userPlaylists=[record];
    window.neteasePlaylists=[];window.qqPlaylists=[];window.kugouPlaylists=[];window.kugouConceptPlaylists=[];window.qishuiPlaylists=[];window.myPodcastCollections=[];
    persistLocalPlaylists();
    if(window.shelfManager.getMode()!=='off')window.shelfManager.setMode('off');
    window.shelfManager.setMode('side');
    window.setShelfPinnedOpen(true,true);
    window.shelfManager.rebuild(false);
    for(let i=0;i<20;i++)window.shelfManager.update(1/60);
    return {cards:window.shelfManager.getCards().length,keys:window.shelfManager.getPlaylistKeys()};
  })()`);
  await waitFor(() => cdp.evaluate(`(()=>{window.shelfManager.update(1/60);const c=window.shelfManager.getCardAt(0);return !!(c&&c.mesh&&c.canvas&&c.texture);})()`));
  await cdp.evaluate(`window.shelfManager.openContent(0);true`);
  await waitFor(() => cdp.evaluate(`(()=>{window.shelfManager.update(1/60);const c=window.shelfManager.getContentList();const d=c&&c.getDebug();return !!(c&&c.isOpen()&&d&&d.state==='ready'&&d.openRef&&d.openRef.key==='local:lf-v1144-delete');})()`));
  await cdp.evaluate(`(()=>{
    const card=window.shelfManager.getCardAt(0),content=window.shelfManager.getContentList();
    const snapshot=content.getDeleteVisualSnapshot('local:lf-v1144-delete');
    if(!snapshot)throw new Error('REAL_3D_DELETE_SNAPSHOT_MISSING');
    window.__lfV1144DeleteCard=card;window.__lfV1144DeleteSnapshot=snapshot;
    return true;
  })()`);
}

async function exercise() {
  await prepareReal3dPlaylist();
  const initial = await cdp.evaluate(`(()=>{
    const card=window.__lfV1144DeleteCard,snapshot=window.__lfV1144DeleteSnapshot;
    return {sameCanvas:snapshot.sourceCanvas===card.canvas,originalTarget:snapshot.originalTarget,cards:window.shelfManager.getCards().length,meshVisible:card.mesh.visible,key:snapshot.key};
  })()`);
  pass('the live 3D snapshot is the exact original card object', initial.sameCanvas && initial.originalTarget && initial.cards === 1 && initial.meshVisible && initial.key === 'local:lf-v1144-delete', initial);
  await cdp.screenshot('before-delete.png');

  const failedBefore = await cdp.evaluate('window.LumiFieldParticleRangeControl.getDebug().deleteStarts');
  const failed = await cdp.evaluate(`(async()=>{
    openPlaylistDeleteConfirmation({provider:'local',id:'missing-v1144',title:'不存在的歌单'});
    const ok=await confirmPlaylistDelete();
    const status=window.LumiFieldPlaylistMutation.status();
    cancelPlaylistDelete();
    return {ok,status,starts:window.LumiFieldParticleRangeControl.getDebug().deleteStarts,present:window.localPlaylists.some(x=>String(x.id)==='lf-v1144-delete')};
  })()`);
  pass('a failed delete keeps data and starts no dissolve', failed.ok === false && failed.starts === failedBefore && failed.present && failed.status.lastResult && failed.status.lastResult.ok === false, failed);
  await cdp.evaluate(`(()=>{const toast=document.getElementById('toast');if(toast){toast.classList.remove('show');toast.textContent='';}return true;})()`);

  const rebound = await cdp.evaluate(`(()=>{
    const card=window.shelfManager.getCardAt(window.shelfManager.getOpenContentIndex()),content=window.shelfManager.getContentList();
    const snapshot=content.getDeleteVisualSnapshot('local:lf-v1144-delete');
    if(!card||!snapshot||snapshot.sourceCanvas!==card.canvas)throw new Error('LIVE_3D_DELETE_CARD_NOT_REBOUND');
    window.__lfV1144DeleteCard=card;window.__lfV1144DeleteSnapshot=snapshot;
    window.__lfV1144DisposeCounts={texture:0,material:0,geometry:0};
    [['texture',card.texture],['material',card.mesh.material],['geometry',card.mesh.geometry]].forEach(([key,resource])=>{
      const original=resource.dispose.bind(resource);resource.dispose=function(){window.__lfV1144DisposeCounts[key]++;return original();};
    });
    return {sameCanvas:snapshot.sourceCanvas===card.canvas,index:window.shelfManager.getOpenContentIndex(),cardCount:window.shelfManager.getCards().length};
  })()`);
  pass('a shelf rebuild cannot detach the dissolve from the live 3D card', rebound.sameCanvas && rebound.index === 0 && rebound.cardCount === 1, rebound);

  const requested = await cdp.evaluate(`(()=>{const content=window.shelfManager.getContentList();return content&&content.requestDelete();})()`);
  pass('the real 3D playlist delete confirmation opens', requested === true, requested);
  await cdp.evaluate(`window.__lfV1144DeletePromise=confirmPlaylistDelete();true`);
  await waitFor(() => cdp.evaluate(`(()=>{const d=window.LumiFieldParticleRangeControl.getDebug();return d.deleteEffectActive&&d.deleteOriginalProgress>.28&&d.deleteOriginalProgress<.92;})()`), 10000, 30);
  const mid = await cdp.evaluate(`(()=>{
    const card=window.__lfV1144DeleteCard,ctx=card.ctx,w=card.canvas.width,h=card.canvas.height;
    const sum=(x0,x1)=>{const d=ctx.getImageData(x0,0,Math.max(1,x1-x0),h).data;let a=0;for(let i=3;i<d.length;i+=64)a+=d[i];return a;};
    const debug=window.LumiFieldParticleRangeControl.getDebug();
    return {
      debug,
      cardCount:window.shelfManager.getCards().length,
      sameCard:window.shelfManager.getCardAt(0)===card,
      effectFlag:card.deleteEffectActive===true,
      meshVisible:card.mesh.visible,
      leftAlpha:sum(0,Math.floor(w*.16)),
      rightAlpha:sum(Math.floor(w*.84),w),
      localStillPresent:window.localPlaylists.some(x=>String(x.id)==='lf-v1144-delete'),
      userStillPresent:window.userPlaylists.some(x=>String(x.id)==='lf-v1144-delete')
    };
  })()`);
  pass('mid-animation keeps one original card and never creates a visual clone', mid.cardCount === 1 && mid.sameCard && mid.effectFlag && mid.meshVisible && mid.debug.deleteTargetMode === 'original-card' && mid.debug.deleteCloneCount === 0, mid);
  pass('the original texture itself dissolves from right to left', mid.leftAlpha > 0 && mid.rightAlpha === 0 && mid.debug.deleteOriginalProgress > .28, mid);
  pass('playlist data remains intact until the original-object animation ends', mid.localStillPresent && mid.userStillPresent, mid);
  pass('the shared pool emits a dense crisp white particle field', mid.debug.deleteParticleCount >= 1100 && mid.debug.poolSize <= mid.debug.poolCapacity && mid.debug.deleteParticleColor === 'rgb-white' && mid.debug.deleteParticleShadowBlur === 0 && mid.debug.schedulerCount === 1, mid.debug);
  await cdp.screenshot('during-original-dissolve.png');

  const completed = await cdp.evaluate(`window.__lfV1144DeletePromise`);
  const after = await waitFor(() => cdp.evaluate(`(()=>{
    const mutation=window.LumiFieldPlaylistMutation.status();
    if(!mutation.lastResult||mutation.lastResult.ok!==true)return null;
    return {
      completed:${JSON.stringify(completed)},
      mutation,
      debug:window.LumiFieldParticleRangeControl.getDebug(),
      localPresent:window.localPlaylists.some(x=>String(x.id)==='lf-v1144-delete'),
      userPresent:window.userPlaylists.some(x=>String(x.id)==='lf-v1144-delete'),
      dispose:Object.assign({},window.__lfV1144DisposeCounts),
      cardCount:window.shelfManager.getCards().length
    };
  })()`), 10000);
  pass('successful mutation removes data only after the effect completes', completed === true && !after.localPresent && !after.userPresent && after.mutation.lastResult.particleRemovalPlayed === true, after);
  pass('removed card texture, material, and geometry are disposed exactly once', after.dispose.texture === 1 && after.dispose.material === 1 && after.dispose.geometry === 1, after.dispose);
  pass('the 3D shelf rebuild contains no replacement playlist card', after.cardCount === 0, after);

  const duplicate = await cdp.evaluate(`(async()=>{const s=window.__lfV1144DeleteSnapshot;s.operationId=window.LumiFieldParticleRangeControl.getDebug().lastDeleteKey;return window.LumiFieldParticleRangeControl.animatePlaylistRemoval(s);})()`);
  pass('the same confirmed removal cannot replay or duplicate particles', duplicate && duplicate.duplicate === true && duplicate.reason === 'already-completed', duplicate);
  await waitFor(() => cdp.evaluate(`(()=>{const d=window.LumiFieldParticleRangeControl.getDebug();return !d.deleteEffectActive&&!d.rafPending&&d.activeParticles===0;})()`), 10000);
  const settled = await cdp.evaluate('window.LumiFieldParticleRangeControl.getDebug()');
  pass('the shared RAF and particle pool fully settle after deletion', settled.deleteCompletions === 1 && settled.schedulerCount === 0 && settled.activeParticles === 0 && settled.deleteDuplicates === 1, settled);
  await cdp.screenshot('after-delete.png');
}

async function cleanup() {
  if (cdp) {
    try { await cdp.evaluate(`if(window.__lfV1144OriginalPlaylistLoader)window.loadUnifiedPlaylistTracks=window.__lfV1144OriginalPlaylistLoader;true`); } catch (_) {}
    cdp.close();
  }
  if (app && !app.killed) {
    try { app.kill(); } catch (_) {}
    await delay(700);
  }
}

(async () => {
  let failure = null;
  try {
    staticChecks();
    await startApp();
    await exercise();
    pass('renderer emitted no uncaught exceptions', rendererErrors.length === 0, rendererErrors);
    pass('renderer emitted no console errors', consoleErrors.length === 0, consoleErrors);
  } catch (error) {
    failure = { message:String(error && error.message || error), stack:String(error && error.stack || '') };
  } finally {
    await cleanup();
  }
  const result = {
    overall:failure ? 'FAIL' : 'PASS',
    mode:'SOURCE_ELECTRON_TARGETED',
    checks,
    checkCount:Object.keys(checks).length,
    rendererErrors,
    consoleErrors,
    screenshots,
    productSha256:{
      effect:fileSha256(path.join(repo, 'public', 'lf-particle-range-control.js')),
      index:fileSha256(path.join(repo, 'public', 'index.html'))
    },
    referenceVideo:{
      path:'D:/HuaweiMoveData/Users/35992/Desktop/文件13/消散.mp4',
      bytes:116756159,
      sha256:'3FDD9569045F97D60F64B8667A6E91A14B357CC261DF7D079C0B72DD85C79675'
    },
    failure,
    appLog
  };
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));
  process.stdout.write(`${JSON.stringify({overall:result.overall,checkCount:result.checkCount,evidenceDir,failure},null,2)}\n`);
  if (failure) process.exitCode = 1;
})();
