'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');

const repo = path.resolve(__dirname, '..');
const dependencyRoot = process.env.LF_DEPENDENCY_ROOT || path.join(repo, 'node_modules');
const electronExe = path.join(dependencyRoot, 'electron', 'dist', 'electron.exe');
const evidenceDir = path.join(repo, 'test-results', 'lf-v1144-22-qq-login-recovery', new Date().toISOString().replace(/[:.]/g, '-'));
const checks = {};
const rendererErrors = [];
const consoleErrors = [];
const appLog = [];
const screenshots = [];
const requiredHuman = [
  '使用真实 QQ 账号完成官方二维码授权，并确认没有验证码、风控或地区限制。',
  '在真实网络下核对 QQ 昵称、头像和全部真实歌单与 QQ 音乐客户端一致。',
];
fs.mkdirSync(evidenceDir, { recursive:true });

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function source(file) { return fs.readFileSync(path.join(repo, file), 'utf8'); }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase(); }
function pass(name, condition, detail) { assert.ok(condition, `${name}: ${JSON.stringify(detail)}`); checks[name] = detail == null ? true : detail; }
async function waitFor(fn, timeout = 30000, interval = 50) {
  const started = Date.now(); let last = null;
  while (Date.now() - started < timeout) {
    try { last = await fn(); if (last) return last; } catch (error) { last = String(error && error.message || error); }
    await delay(interval);
  }
  throw new Error(`Timeout: ${JSON.stringify(last)}`);
}
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.unref(); server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(error => error ? reject(error) : resolve(port)); });
  });
}

function staticChecks() {
  const manager = source('desktop/music-platform-manager.js');
  const main = source('desktop/main.js');
  const preload = source('desktop/preload.js');
  const adapter = source('public/music-platform-adapters.js');
  const index = source('public/index.html');
  pass('QQ official profile URL cookie allowlist and redirect hosts are explicit', /loginUrl: 'https:\/\/y\.qq\.com\/n\/ryqq\/profile'/.test(manager) && /cookieUrl: 'https:\/\/y\.qq\.com\/'/.test(manager) && /loginCookies: \[\/\^\(\?:uin\|qqmusic_uin/.test(manager) && /officialHost\(host, \['qq\.com', 'qqmusic\.qq\.com', 'weixin\.qq\.com'\]\)/.test(manager), true);
  pass('every provider partition is derived from the authoritative 64-hex account scope', /return config\.partition \+ '-account-' \+ String\(scopeHash \|\| this\.accountScopeHash\)/.test(manager) && /accountScopeHash\(''\)/.test(manager), true);
  pass('login BrowserWindow is sandboxed and isolated', /webPreferences:\s*\{[\s\S]{0,240}partition,[\s\S]{0,240}contextIsolation: true,[\s\S]{0,120}nodeIntegration: false,[\s\S]{0,120}sandbox: true/.test(manager), true);
  pass('navigation and popup redirects are denied outside the QQ official allowlist', /setWindowOpenHandler\(\(\{ url \}\) => \{[\s\S]{0,180}validNavigation/.test(manager) && /will-navigate[\s\S]{0,180}!this\.validNavigation/.test(manager), true);
  pass('cookie listener timer and provider window are released on close', /cookies\.on\('changed', changed\)/.test(manager) && /clearInterval\(timer\)/.test(manager) && /cookies\.removeListener\('changed', changed\)/.test(manager) && /this\.windows\.delete\(provider\)/.test(manager), true);
  pass('remote login is accepted only with explicit sessionValid profile-ready success', /remote\.sessionValid !== true/.test(manager) && /validatedLoginState\(state\)/.test(manager) && /profileReady/.test(manager), true);
  pass('status profile playlists and cookie flow all retain epoch checks', (manager.match(/isScopeOperational\(epoch\)/g) || []).length >= 12 && /runScopedAccountOperation\(epoch, provider/.test(manager) && /STALE_ACCOUNT_SCOPE/.test(manager), true);
  pass('all generic account IPC handlers require the exact trusted main sender', /const trustedOwner = event =>/.test(manager) && /music-platform-open-login/.test(manager) && /music-platform-login-status/.test(manager) && /music-platform-profile/.test(manager) && /music-platform-playlists/.test(manager) && /music-platform-clear-login/.test(manager), true);
  pass('main installs the canonical manager after the local backend is ready', main.indexOf('await waitForServer(localServer') < main.indexOf('new MusicPlatformManager') && main.indexOf('new MusicPlatformManager') < main.indexOf('musicPlatformManager.registerIpc(ipcMain)'), true);
  pass('preload and renderer route QQ login status profile and playlists through scoped IPC', /openQQMusicLogin: \(\) => ipcRenderer\.invoke\('music-platform-open-login', 'qq'\)/.test(preload) && /getMusicPlatformLoginStatus/.test(preload) && /getMusicPlatformProfile/.test(preload) && /getMusicPlatformPlaylists/.test(preload) && /desktopCall\('getMusicPlatformLoginStatus', id\)/.test(adapter), true);
  pass('verified QQ desktop events coalesce playlist sync and select only in single-provider mode', /function syncValidatedMusicProviderPlaylists\(provider, options\)/.test(index) && /syncState\.promise && syncState\.guard/.test(index) && /provider === 'qq' && options\.source === 'desktop-event'/.test(index) && /selectProvider:shouldActivate/.test(index), true);
  pass('manual QQ cookie success uses the same scoped playlist synchronization path', /await syncValidatedMusicProviderPlaylists\('qq', \{ selectProvider:!multiProviderMode \}\)/.test(index), true);
}

class FakeCookies extends EventEmitter {
  constructor() { super(); this.values = []; }
  async get() { return this.values.map(value => ({ ...value })); }
  async set(details) {
    const parsed = new URL(details.url);
    const value = { ...details, domain:details.domain || parsed.hostname, path:details.path || '/', secure:details.secure !== false };
    const key = item => `${item.domain}|${item.path}|${item.name}`;
    this.values = this.values.filter(item => key(item) !== key(value));
    this.values.push(value);
    this.emit('changed', {}, { ...value }, 'explicit', false);
  }
  async remove(_url, name) { this.values = this.values.filter(value => value.name !== name); }
  async flushStore() {}
  dump() { return this.values.map(({ name, value, domain, path }) => ({ name, value, domain, path })).sort((a, b) => a.name.localeCompare(b.name)); }
}

class FakeSession {
  constructor() { this.cookies = new FakeCookies(); }
  async clearStorageData() { this.cookies.values = []; }
  async closeAllConnections() {}
}

class FakeWebContents extends EventEmitter {
  constructor() { super(); this.url = ''; this.sent = []; this.openHandler = null; }
  setWindowOpenHandler(handler) { this.openHandler = handler; }
  send(channel, payload) { this.sent.push({ channel, payload }); }
  getURL() { return this.url; }
  isDestroyed() { return false; }
}

class FakeBrowserWindow extends EventEmitter {
  static instances = [];
  static owner = null;
  static fromWebContents() { return FakeBrowserWindow.owner; }
  constructor(options) {
    super(); this.options = options; this.destroyed = false; this.visible = false; this.focused = false;
    this.webContents = new FakeWebContents(); FakeBrowserWindow.instances.push(this);
  }
  async loadURL(url) { this.webContents.url = url; }
  show() { this.visible = true; }
  focus() { this.focused = true; }
  isDestroyed() { return this.destroyed; }
  close() { if (this.destroyed) return; this.destroyed = true; this.emit('closed'); }
}

async function managerChecks() {
  const { MusicPlatformManager, PLATFORM_CONFIGS } = require(path.join(repo, 'desktop', 'music-platform-manager.js'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-v1144-p22-manager-'));
  const partitions = new Map();
  const fromPartition = name => {
    name = String(name || '');
    if (!partitions.has(name)) partitions.set(name, new FakeSession());
    return partitions.get(name);
  };
  const serverState = { playlistCalls:0, logoutCalls:0 };
  const backend = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      let payload = { ok:true };
      if (/^\/api\/qq\/user\/playlists/.test(request.url)) {
        serverState.playlistCalls++;
        payload = { ok:true, provider:'qq', loggedIn:true, sessionValid:true, playlists:[{ id:'qq-list-1', name:'QQ 收藏' }] };
      } else if (/^\/api\/qq\/logout/.test(request.url)) {
        serverState.logoutCalls++;
        payload = { ok:true, provider:'qq', loggedIn:false, sessionValid:false };
      }
      response.writeHead(200, { 'content-type':'application/json' }); response.end(JSON.stringify(payload));
    });
  });
  let manager = null;
  try {
    await new Promise((resolve, reject) => { backend.once('error', reject); backend.listen(0, '127.0.0.1', resolve); });
    const published = [];
    const trustedSender = { id:'main-renderer' };
    const owner = { isDestroyed:() => false, webContents:new FakeWebContents() };
    FakeBrowserWindow.owner = owner;
    manager = new MusicPlatformManager({
      electron:{ app:{}, BrowserWindow:FakeBrowserWindow, session:{ fromPartition }, shell:{} },
      app:{ getPath:() => root }, BrowserWindow:FakeBrowserWindow, session:{ fromPartition }, shell:{},
      backendBaseUrl:`http://127.0.0.1:${backend.address().port}`,
      sessionSecret:'0123456789abcdef0123456789abcdef',
      trustedSender:sender => sender === trustedSender,
      onState:state => published.push(state),
    });
    manager.clearBackendScopeState = async () => true;
    manager.syncBackend = async provider => ({
      ok:true, provider, loggedIn:true, sessionValid:true, playbackKeyReady:true,
      profile:{ provider, userId:'qq-user-a', nickname:'QQ 测试账号', avatar:'https://q1.qlogo.cn/g?b=qq' },
    });
    const scopeA = await manager.setAccountScope('lf-v1144-p22-user-A');
    const partitionA = manager.providerPartition('qq');
    const open = await manager.openLogin('qq', owner);
    const win = FakeBrowserWindow.instances.at(-1);
    pass('QQ login window opens on the account-scoped partition with hardened webPreferences', open.ok === true && win.options.webPreferences.partition === partitionA && win.options.webPreferences.contextIsolation === true && win.options.webPreferences.nodeIntegration === false && win.options.webPreferences.sandbox === true, { partition:partitionA, scopeHash:scopeA.scopeHash });
    pass('QQ login window loads only the official profile entry URL', win.webContents.url === PLATFORM_CONFIGS.qq.loginUrl && win.webContents.openHandler({ url:'https://evil.example/login' }).action === 'deny', win.webContents.url);

    const jarA = fromPartition(partitionA);
    await jarA.cookies.set({ url:'https://y.qq.com/', domain:'.qq.com', path:'/', name:'uin', value:'10001', secure:true });
    await jarA.cookies.set({ url:'https://y.qq.com/', domain:'.qq.com', path:'/', name:'qqmusic_key', value:'qq-key-a', secure:true, httpOnly:true });
    const validated = await waitFor(() => published.find(state => state.provider === 'qq' && state.sessionValid === true));
    pass('cookie change produces a strict sessionValid QQ state with synchronized profile', validated.ok === true && validated.loggedIn === true && validated.profile && validated.profile.userId === 'qq-user-a', validated);
    const profile = await manager.getProfile('qq');
    const playlists = await manager.getPlaylists('qq');
    pass('validated QQ profile and playlists resolve through the same scoped manager', profile.ok === true && profile.loggedIn === true && profile.profile.userId === 'qq-user-a' && playlists.ok === true && playlists.playlists.length === 1 && serverState.playlistCalls === 1, { profile, playlists });
    await waitFor(() => win.isDestroyed(), 3500);
    pass('successful login closes its BrowserWindow and releases the QQ cookie listener', !manager.windows.has('qq') && jarA.cookies.listenerCount('changed') === 0, { windowDestroyed:win.isDestroyed(), listeners:jarA.cookies.listenerCount('changed') });

    const allPartitionsA = Object.keys(PLATFORM_CONFIGS).map(provider => manager.providerPartition(provider));
    pass('all five providers have unique partitions in the same LF account scope', new Set(allPartitionsA).size === 5 && allPartitionsA.every(value => value.endsWith(scopeA.scopeHash)), allPartitionsA);
    const otherSnapshots = {};
    for (const provider of Object.keys(PLATFORM_CONFIGS).filter(item => item !== 'qq')) {
      const config = PLATFORM_CONFIGS[provider];
      const session = fromPartition(manager.providerPartition(provider));
      const cookieName = provider === 'netease' ? 'MUSIC_U' : (provider === 'qishui' ? 'sessionid' : 'userid');
      await session.cookies.set({ url:config.cookieUrl, path:'/', name:cookieName, value:`keep-${provider}`, secure:true });
      otherSnapshots[provider] = session.cookies.dump();
    }
    const logout = await manager.logout('qq');
    const otherPreserved = Object.keys(otherSnapshots).every(provider => JSON.stringify(fromPartition(manager.providerPartition(provider)).cookies.dump()) === JSON.stringify(otherSnapshots[provider]));
    pass('QQ logout clears only QQ and preserves the other four provider partitions', logout.loggedIn === false && jarA.cookies.dump().length === 0 && otherPreserved && serverState.logoutCalls === 1, { logout, otherPreserved });

    await jarA.cookies.set({ url:'https://y.qq.com/', domain:'.qq.com', path:'/', name:'uin', value:'10001', secure:true });
    await jarA.cookies.set({ url:'https://y.qq.com/', domain:'.qq.com', path:'/', name:'qqmusic_key', value:'qq-key-a', secure:true });
    manager.saveProfile('qq', { provider:'qq', userId:'qq-user-a', nickname:'QQ 测试账号', avatar:'' }, manager.accountScopeEpoch);
    const scopeB = await manager.setAccountScope('lf-v1144-p22-user-B');
    const partitionB = manager.providerPartition('qq');
    const statusB = await manager.getLoginStatus('qq');
    pass('switching LF account exposes neither QQ cookies nor profile from the previous account', partitionB !== partitionA && fromPartition(partitionB).cookies.dump().length === 0 && statusB.loggedIn === false && statusB.profile == null, { scopeB:scopeB.scopeHash, partitionB, statusB });
    await manager.setAccountScope('lf-v1144-p22-user-A');
    const restoredA = await manager.getLoginStatus('qq');
    pass('returning to LF account A restores only A QQ session and profile', restoredA.sessionValid === true && restoredA.profile && restoredA.profile.userId === 'qq-user-a' && manager.providerPartition('qq') === partitionA, restoredA);

    let releaseSync;
    let markStarted;
    const started = new Promise(resolve => { markStarted = resolve; });
    const blocked = new Promise(resolve => { releaseSync = resolve; });
    manager.statusRequests.clear();
    manager.syncBackend = async provider => { markStarted(); await blocked; return { ok:true, provider, loggedIn:true, sessionValid:true, profile:{ provider, userId:'stale-a', nickname:'Stale A' } }; };
    const staleRequest = manager.getLoginStatus('qq');
    await started;
    const switchPromise = manager.setAccountScope('lf-v1144-p22-user-B');
    releaseSync();
    const stale = await staleRequest;
    await switchPromise;
    pass('a delayed QQ validation becomes stale during A to B switch and cannot write B profile', stale.stale === true && stale.error === 'STALE_ACCOUNT_SCOPE' && manager.readProfile('qq') == null && fromPartition(manager.providerPartition('qq')).cookies.dump().length === 0, stale);

    const handlers = new Map();
    manager.registerIpc({ removeHandler:channel => handlers.delete(channel), handle:(channel, handler) => handlers.set(channel, handler) });
    const methodCalls = { open:0, status:0, profile:0, playlists:0, clear:0 };
    manager.openLogin = async () => { methodCalls.open++; return { ok:true }; };
    manager.getLoginStatus = async () => { methodCalls.status++; return { ok:true }; };
    manager.getProfile = async () => { methodCalls.profile++; return { ok:true }; };
    manager.getPlaylists = async () => { methodCalls.playlists++; return { ok:true }; };
    manager.logout = async () => { methodCalls.clear++; return { ok:true }; };
    const channels = [
      ['music-platform-open-login', ['qq']], ['music-platform-login-status', ['qq']],
      ['music-platform-profile', ['qq']], ['music-platform-playlists', ['qq']], ['music-platform-clear-login', ['qq']],
    ];
    const denied = [];
    for (const [channel, args] of channels) denied.push(await handlers.get(channel)({ sender:{ id:'spoof' } }, ...args));
    pass('spoofed renderer cannot open read or clear the QQ account session', denied.every(result => result && result.error === 'FORBIDDEN') && Object.values(methodCalls).every(value => value === 0), { denied, methodCalls:{ ...methodCalls } });
    const trusted = await handlers.get('music-platform-login-status')({ sender:trustedSender }, 'qq');
    pass('the exact trusted main renderer can call the scoped status IPC', trusted.ok === true && methodCalls.status === 1, { trusted, methodCalls });
  } finally {
    if (manager) manager.dispose();
    await new Promise(resolve => backend.close(() => resolve())).catch(() => {});
    try { fs.rmSync(root, { recursive:true, force:true }); } catch (_) {}
  }
}

class CDP {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id); this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result || {});
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
    await this.send('Runtime.enable'); await this.send('Page.enable');
  }
  send(method, params, timeout = 30000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params:params || {} }));
    });
  }
  async evaluate(expression, timeout = 30000) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true, userGesture:true }, timeout);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception && result.exceptionDetails.exception.description || result.exceptionDetails.text);
    return result.result && result.result.value;
  }
  close() { try { this.ws.close(); } catch (_) {} }
}

let app = null;
let cdp = null;
let runtimeUserData = '';
let debugPort = 0;
async function targets() { return (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); }

async function rendererChecks() {
  assert.ok(fs.existsSync(electronExe), `Electron not found: ${electronExe}`);
  runtimeUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-v1144-p22-renderer-'));
  debugPort = await freePort();
  app = spawn(electronExe, ['.', `--user-data-dir=${runtimeUserData}`, `--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1'], {
    cwd:repo, windowsHide:true, stdio:['ignore','pipe','pipe'],
    env:Object.assign({}, process.env, { NODE_PATH:dependencyRoot, LF_MASTER_TEST:'1', LUMIFIELD_SKIP_SPLASH:'1', ELECTRON_DISABLE_SECURITY_WARNINGS:'true' }),
  });
  const collect = chunk => appLog.push(String(chunk)); app.stdout.on('data', collect); app.stderr.on('data', collect);
  const target = await waitFor(async () => {
    const list = await targets();
    return list.find(item => item.type === 'page' && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?(?:index\.html)?$/i.test(item.url));
  }, 60000);
  cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
  await waitFor(() => cdp.evaluate(`document.readyState==='complete'&&!!window.LumiFieldMusicPlatformManager&&typeof window.applyMusicPlatformLoginState==='function'&&typeof musicAccountScopeReady!=='undefined'&&musicAccountScopeReady===true`), 60000);
  const result = await cdp.evaluate(`(async()=>{
    await window.LumiFieldMultiPlatform.setTestUser('lf-v1144-p22-renderer');
    if(musicAccountScopeReady!==true||musicAccountScopeSwitching===true)throw new Error('TEST_ACCOUNT_SCOPE_NOT_READY');
    const manager=window.LumiFieldMusicPlatformManager;
    const originalPlaylists=manager.playlists;
    const calls=[];
    const validNetease={provider:'netease',ok:true,loggedIn:true,sessionValid:true,nickname:'NE',userId:'ne-user',profile:{provider:'netease',userId:'ne-user',nickname:'NE'}};
    const validQQ={provider:'qq',ok:true,loggedIn:true,sessionValid:true,nickname:'QQ测试',userId:'qq-user',profile:{provider:'qq',userId:'qq-user',nickname:'QQ测试'}};
    function reset(multi){
      musicAccountScopeReady=true; musicAccountScopeSwitching=false;
      loginStatus=normalizeNeteaseLoginStatus(validNetease); qqLoginStatus=normalizeQQLoginStatus(null);
      activeAccountProvider='netease'; playlistAccountProvider='netease'; setMultiProviderFlag(multi);
      qqPlaylists=[]; platformPlaylistLoaded.qq=false; userPlaylists=[];
      renderPlaylistProviderTabs(); renderUserBtn();
    }
    try{
      reset(false);
      manager.playlists=async provider=>{calls.push('single:'+provider);await new Promise(r=>setTimeout(r,120));return{ok:true,provider,playlists:[{id:'q1',name:'收藏1'},{id:'q2',name:'收藏2'}]};};
      applyMusicPlatformLoginState(validQQ,{source:'desktop-event',forceRefresh:true});
      applyMusicPlatformLoginState(validQQ,{source:'desktop-event',forceRefresh:true});
      for(let i=0;i<80&&!platformPlaylistLoaded.qq;i++)await new Promise(r=>setTimeout(r,25));
      const single={active:activeAccountProvider,playlist:playlistAccountProvider,loaded:platformPlaylistLoaded.qq,count:qqPlaylists.length,calls:calls.filter(x=>x.startsWith('single:')).length,selected:document.querySelector('.playlist-provider-tab.active')&&document.querySelector('.playlist-provider-tab.active').dataset.playlistProvider};

      reset(true);
      manager.playlists=async provider=>{calls.push('multi:'+provider);await new Promise(r=>setTimeout(r,120));return{ok:true,provider,playlists:[{id:'mq1',name:'多平台QQ收藏'}]};};
      applyMusicPlatformLoginState(validQQ,{source:'desktop-event',forceRefresh:true});
      applyMusicPlatformLoginState(validQQ,{source:'desktop-event',forceRefresh:true});
      for(let i=0;i<80&&!platformPlaylistLoaded.qq;i++)await new Promise(r=>setTimeout(r,25));
      const multi={mode:multiProviderMode,active:activeAccountProvider,playlist:playlistAccountProvider,loaded:platformPlaylistLoaded.qq,count:qqPlaylists.length,calls:calls.filter(x=>x.startsWith('multi:')).length};

      reset(true);
      let release;const blocked=new Promise(resolve=>{release=resolve;});
      manager.playlists=async provider=>{calls.push('race:'+provider);await blocked;return{ok:true,provider,playlists:[{id:'stale',name:'不得写入'}]};};
      applyMusicPlatformLoginState(validQQ,{source:'desktop-event',forceRefresh:true});
      await new Promise(r=>setTimeout(r,40));
      musicAccountScopeSwitching=true;musicAccountScopeReady=false;musicAccountRestoreSerial++;
      release();await new Promise(r=>setTimeout(r,100));
      const race={loaded:platformPlaylistLoaded.qq,count:qqPlaylists.length,calls:calls.filter(x=>x.startsWith('race:')).length};
      return{single,multi,race};
    }finally{manager.playlists=originalPlaylists;musicAccountScopeSwitching=false;musicAccountScopeReady=true;}
  })()`, 30000);
  pass('single-provider verified QQ event selects QQ and synchronizes its playlists exactly once', result.single.active === 'qq' && result.single.playlist === 'qq' && result.single.selected === 'qq' && result.single.loaded === true && result.single.count === 2 && result.single.calls === 1, result.single);
  pass('multi-provider verified QQ event keeps the current provider but fills the independent QQ cache once', result.multi.mode === true && result.multi.active === 'netease' && result.multi.playlist === 'netease' && result.multi.loaded === true && result.multi.count === 1 && result.multi.calls === 1, result.multi);
  pass('renderer scope generation drops a delayed QQ playlist completion without cache writes', result.race.loaded === false && result.race.count === 0 && result.race.calls === 1, result.race);
  pass('targeted renderer run has no exception or console error', rendererErrors.length === 0 && consoleErrors.length === 0, { rendererErrors, consoleErrors });
  await cdp.evaluate(`(()=>{const auth=document.getElementById('lf-auth-root');if(auth){auth.hidden=true;auth.style.setProperty('display','none','important');auth.setAttribute('aria-hidden','true');}const guide=document.getElementById('visual-guide');if(guide){guide.classList.remove('show');guide.style.display='none';}const toast=document.getElementById('toast');if(toast){toast.classList.remove('show');toast.style.display='none';}return true;})()`);
  await delay(180);
  const shot = await cdp.send('Page.captureScreenshot', { format:'png', fromSurface:true, captureBeyondViewport:false });
  const file = path.join(evidenceDir, 'qq-login-recovery-runtime.png');
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  screenshots.push({ file:path.basename(file), bytes:fs.statSync(file).size, sha256:sha256File(file) });
}

async function stopApp() {
  if (cdp) { cdp.close(); cdp = null; }
  if (app && !app.killed) { app.kill(); await Promise.race([new Promise(resolve => app.once('exit', resolve)), delay(5000)]); }
  app = null;
  if (runtimeUserData) { try { fs.rmSync(runtimeUserData, { recursive:true, force:true }); } catch (_) {} }
}

(async () => {
  let error = null;
  try {
    staticChecks();
    await managerChecks();
    if (process.env.LF_V1144_P22_STATIC_ONLY !== '1') await rendererChecks();
  } catch (caught) {
    error = caught; process.exitCode = 1;
  } finally {
    await stopApp();
    const result = {
      task:'v1.1.44-problem-22-qq-login-recovery',
      mode:process.env.LF_V1144_P22_STATIC_ONLY === '1' ? 'STATIC_AND_SOURCE_NODE' : 'SOURCE_NODE_ELECTRON_TARGETED',
      status:error ? 'FAIL' : (requiredHuman.length ? 'AUTOMATED_PASS_HUMAN_REQUIRED' : 'PASS'),
      checkCount:Object.keys(checks).length, checks, screenshots, rendererErrors, consoleErrors, requiredHuman, appLog,
      error:error ? String(error.stack || error) : null,
    };
    const resultPath = path.join(evidenceDir, 'result.json'); fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    process.stdout.write(`${JSON.stringify({ status:result.status, mode:result.mode, checkCount:result.checkCount, evidenceDir, resultSha256:sha256File(resultPath) }, null, 2)}\n`);
  }
})();
