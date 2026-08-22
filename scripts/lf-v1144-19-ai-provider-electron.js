'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const {
  createAIAssistantController,
  PROVIDERS,
  ALLOWED_ACTIONS,
  normalizeSettings,
  officialBaseUrl,
  sanitizeAction,
  actionExplicitlyRequested,
} = require('../desktop/lf-ai-provider-main');

const repo = path.resolve(__dirname, '..');
const dependencyRoot = process.env.LF_DEPENDENCY_ROOT || path.join(repo, 'node_modules');
const electronExe = path.join(dependencyRoot, 'electron', 'dist', 'electron.exe');
const evidenceDir = path.join(repo, 'test-results', 'lf-v1144-19-ai-provider', new Date().toISOString().replace(/[:.]/g, '-'));
const checks = {};
const rendererErrors = [];
const consoleErrors = [];
const appLog = [];
const screenshots = [];
fs.mkdirSync(evidenceDir, { recursive: true });

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function hashFile(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase(); }
function pass(name, condition, detail) { assert.ok(condition, `${name}: ${JSON.stringify(detail)}`); checks[name] = detail == null ? true : detail; }
async function waitFor(fn, timeout = 30000, interval = 70) {
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
function response(content, status = 200) {
  const payload = typeof content === 'object' && content && content.choices
    ? content
    : { choices: [{ message: { content: String(content) } }] };
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) };
}

function sourceChecks() {
  const main = fs.readFileSync(path.join(repo, 'desktop', 'lf-ai-provider-main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(repo, 'desktop', 'preload.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(repo, 'public', 'lf-ai-assistant.js'), 'utf8');
  const index = fs.readFileSync(path.join(repo, 'public', 'index.html'), 'utf8');
  const record = fs.readFileSync(path.join(repo, 'docs', 'licenses', 'eisland', 'AI_PROVIDER_AND_TOOL_SECURITY.md'), 'utf8');
  pass('product loads one AI Provider script and stylesheet', (index.match(/\/lf-ai-assistant\.js/g) || []).length === 1 && (index.match(/\/lf-ai-assistant\.css/g) || []).length === 1, true);
  pass('main source contains encryption account scope exact-sender and stale-response gates', /safeStorage\.encryptString/.test(main) && /function isMainSender/.test(main) && /STALE_ACCOUNT_SCOPE/.test(main) && /actionExplicitlyRequested/.test(main), true);
  pass('preload exposes write-only Key operations and no credential read bridge', /setAIAssistantApiKey/.test(preload) && /clearAIAssistantApiKey/.test(preload) && !/getAIAssistantApiKey|readAIAssistantApiKey/.test(preload), true);
  pass('renderer excludes Provider password fields from the LF control catalog', /closest\('#lf-ai-provider-settings'\)/.test(renderer) && /\['password','file','hidden'\]/.test(renderer), true);
  pass('provider provenance records exact official model and API identities', /glm-4\.7-flash/.test(record) && /glm-4\.6v-flash/.test(record) && /openai\/gpt-oss-120b/.test(record) && /openai\/gpt-oss-20b/.test(record) && /qwen3\.6-27b/.test(record) && /LUMIFIELD_ORIGINAL_PASS/.test(record), true);
}

async function unitChecks() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-v1144-ai-unit-'));
  const handlers = new Map();
  const ipcMain = { handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name) };
  const mainWindow = { isDestroyed: () => false };
  const mainSender = { owner: mainWindow };
  const BrowserWindow = { fromWebContents: sender => sender && sender.owner || null };
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`LFENC:${Buffer.from(value, 'utf8').toString('base64').split('').reverse().join('')}`, 'utf8'),
    decryptString: value => Buffer.from(String(value).slice(6).split('').reverse().join(''), 'base64').toString('utf8'),
  };
  let scope = { ok: true, scopeHash: hash('account-A'), generation: 1 };
  let requestImpl = async () => response('OK');
  let requestCount = 0;
  const requestLog = [];
  let developerAllowed = false;
  let developerOpenCount = 0;
  const openedUrls = [];
  const controller = createAIAssistantController({
    app: { getPath: name => name === 'userData' ? userData : userData },
    ipcMain,
    BrowserWindow,
    safeStorage,
    shell: { openExternal: async url => { openedUrls.push(url); } },
    getMainWindow: () => mainWindow,
    resolveAccountScope: async () => ({ ...scope }),
    authorizeDeveloperAccess: async () => ({ allowed: developerAllowed }),
    openDeveloperTools: async () => { developerOpenCount += 1; return { ok: true }; },
    request: async (url, options) => { requestCount += 1; requestLog.push({ url, options }); return requestImpl(url, options); },
  });
  const event = { sender: mainSender };
  const invoke = (name, ...args) => {
    assert.ok(handlers.has(name), `missing IPC handler ${name}`);
    return handlers.get(name)(event, ...args);
  };
  try {
    pass('provider catalog uses the five required official API model IDs',
      PROVIDERS.zhipu.models.map(item => item.id).join(',') === 'glm-4.7-flash,glm-4.6v-flash' &&
      PROVIDERS.groq.models.map(item => item.id).join(',') === 'openai/gpt-oss-120b,openai/gpt-oss-20b' &&
      PROVIDERS.qwen.models[0].id === 'qwen3.6-27b', PROVIDERS);
    pass('official Base URLs accept only HTTPS provider hosts',
      officialBaseUrl('zhipu', PROVIDERS.zhipu.baseUrl) === PROVIDERS.zhipu.baseUrl &&
      officialBaseUrl('groq', 'http://api.groq.com/openai/v1') === '' &&
      officialBaseUrl('qwen', 'https://evil.example/compatible-mode/v1') === '', true);
    const normalized = normalizeSettings({ voice: { enabled: true, wakeWord: '小艺，小艺' }, assistant: { provider: 'bad', providers: { zhipu: { model: 'bad', baseUrl: 'https://evil.example', freeOnlyAcknowledged: true } } } });
    pass('settings normalization restores official provider model and URL', normalized.assistant.provider === 'zhipu' && normalized.assistant.providers.zhipu.model === 'glm-4.7-flash' && normalized.assistant.providers.zhipu.baseUrl === PROVIDERS.zhipu.baseUrl, normalized);
    pass('tool input ranges and identifiers are sanitized before renderer execution',
      sanitizeAction({ name: 'playback.volume', args: { value: 4 } }).action.args.value === 1 &&
      sanitizeAction({ name: 'control.set', args: { id: 'lf-api-key', value: 'x' } }).ok === false &&
      sanitizeAction({ name: 'shell.exec', args: { command: 'rm' } }).ok === false, true);
    pass('explicit-intent gate blocks unrelated model actions',
      actionExplicitlyRequested({ name: 'playback.next', args: {} }, '告诉我当前歌曲') === false &&
      actionExplicitlyRequested({ name: 'playback.next', args: {} }, '播放下一首') === true &&
      actionExplicitlyRequested({ name: 'wallpaper.clear', args: { target: 'stage' } }, '删除文件') === false, true);

    const initial = await invoke('lumifield-ai-assistant-settings-read');
    pass('fresh account returns defaults without a credential', initial.ok && !initial.found && initial.hasKey.zhipu === false && initial.settings.voice.wakeWord === '小艺，小艺', initial);
    const saved = await invoke('lumifield-ai-assistant-settings-write', {
      voice: { enabled: true, voiceWake: false, wakeWord: '小艺，小艺', songSync: true, topEdgeWake: false, hotkey: 'Alt+P' },
      assistant: { provider: 'zhipu', providers: { zhipu: { model: 'glm-4.7-flash', baseUrl: PROVIDERS.zhipu.baseUrl, freeOnlyAcknowledged: true } } },
    });
    pass('non-secret voice and provider settings persist under the current LF scope', saved.ok && saved.settings.voice.enabled && saved.settings.voice.songSync && saved.settings.assistant.providers.zhipu.freeOnlyAcknowledged, saved);
    const secret = 'unit-secret-ZHIPU-123456';
    const keySaved = await invoke('lumifield-ai-assistant-key-set', 'zhipu', secret);
    const credentialPath = path.join(userData, 'ai-assistant-v1', scope.scopeHash, 'credentials.bin');
    const credentialBytes = fs.readFileSync(credentialPath);
    const publicState = await invoke('lumifield-ai-assistant-settings-read');
    pass('API Key is encrypted on disk and never returned to the renderer', keySaved.ok && !credentialBytes.includes(Buffer.from(secret)) && !JSON.stringify(publicState).includes(secret) && publicState.hasKey.zhipu === true, { bytes: credentialBytes.length, publicState });

    requestCount = 0; requestLog.length = 0; requestImpl = async () => response('OK');
    const connected = await invoke('lumifield-ai-assistant-test-connection', 'zhipu');
    const requestBody = JSON.parse(requestLog[0].options.body);
    pass('real connection test issues exactly one minimal official request', connected.ok && requestCount === 1 && requestLog[0].url === `${PROVIDERS.zhipu.baseUrl}/chat/completions` && requestBody.model === 'glm-4.7-flash' && requestBody.max_tokens === 8 && requestLog[0].options.headers.Authorization === `Bearer ${secret}`, { connected, url: requestLog[0].url, body: requestBody });

    requestCount = 0;
    const implicit = await invoke('lumifield-ai-assistant-query', { text: '下一首', source: 'text', explicitUserAction: false });
    pass('model calls require a current explicit user action', !implicit.ok && implicit.error === 'EXPLICIT_USER_ACTION_REQUIRED' && requestCount === 0, implicit);

    requestImpl = async () => response(JSON.stringify({ reply: '不会执行无关动作', actions: [{ name: 'playback.next', args: {} }, { name: 'shell.exec', args: { command: 'git status' } }] }));
    const unrelated = await invoke('lumifield-ai-assistant-query', { text: '告诉我当前歌曲', source: 'text', explicitUserAction: true, context: {} });
    pass('prompt injection and model hallucination cannot bypass the LF allowlist or explicit-intent gate', unrelated.ok && unrelated.actions.length === 0 && unrelated.rejectedActions.some(item => item.error === 'ACTION_NOT_EXPLICITLY_REQUESTED') && unrelated.rejectedActions.some(item => item.error === 'ACTION_NOT_ALLOWLISTED'), unrelated);

    requestImpl = async () => response(JSON.stringify({ reply: '下一首', actions: [{ name: 'playback.next', args: {} }] }));
    const next = await invoke('lumifield-ai-assistant-query', { text: '请播放下一首', source: 'text', explicitUserAction: true, context: {} });
    pass('an explicitly requested LF action survives the main-process policy', next.ok && next.actions.length === 1 && next.actions[0].name === 'playback.next', next);

    const controlContext = { controls: [{ id: 'performance-quality-seg', kind: 'choice', label: '粒子清晰度', value: 'high', options: [{ value: 'balanced', label: '标准' }, { value: 'high', label: '高清' }] }] };
    requestImpl = async () => response(JSON.stringify({ reply: '已设为标准', actions: [{ name: 'control.choice', args: { id: 'performance-quality-seg', value: 'balanced' } }] }));
    const catalogAction = await invoke('lumifield-ai-assistant-query', { text: '把粒子清晰度设置为标准', source: 'text', explicitUserAction: true, context: controlContext });
    requestImpl = async () => response(JSON.stringify({ reply: '不执行', actions: [{ name: 'control.choice', args: { id: 'unknown-seg', value: 'balanced' } }] }));
    const forgedControl = await invoke('lumifield-ai-assistant-query', { text: '把粒子清晰度设置为标准', source: 'text', explicitUserAction: true, context: controlContext });
    pass('normal LF settings use the current renderer catalog and reject forged controls', catalogAction.ok && catalogAction.actions[0].name === 'control.choice' && forgedControl.ok && forgedControl.actions.length === 0 && forgedControl.rejectedActions[0].error === 'CONTROL_NOT_IN_CURRENT_CATALOG', { catalogAction, forgedControl });

    requestImpl = async () => response(JSON.stringify({ reply: '开发工具', actions: [{ name: 'developer.open-tools', args: {} }] }));
    developerAllowed = false;
    const deniedDev = await invoke('lumifield-ai-assistant-query', { text: '打开开发者工具调试代码', source: 'text', explicitUserAction: true, context: {} });
    developerAllowed = true;
    const allowedDev = await invoke('lumifield-ai-assistant-query', { text: '打开开发者工具调试代码', source: 'text', explicitUserAction: true, context: {} });
    pass('developer tools require explicit wording plus trusted main-process permission', deniedDev.ok && deniedDev.actions.length === 0 && deniedDev.rejectedActions[0].error === 'DEVELOPMENT_PERMISSION_REQUIRED' && allowedDev.actions[0].executedInMain === true && developerOpenCount === 1, { deniedDev, allowedDev, developerOpenCount });

    const beforeFreeBlock = requestCount;
    await invoke('lumifield-ai-assistant-key-set', 'groq', 'unit-secret-GROQ-123456');
    await invoke('lumifield-ai-assistant-settings-write', { assistant: { provider: 'groq', providers: { groq: { model: 'openai/gpt-oss-20b', baseUrl: PROVIDERS.groq.baseUrl, freeOnlyAcknowledged: false } } } });
    const freeBlock = await invoke('lumifield-ai-assistant-query', { text: '播放下一首', source: 'text', explicitUserAction: true, context: {} });
    pass('free-only acknowledgement fails closed before any Provider request', !freeBlock.ok && freeBlock.error === 'FREE_ONLY_CONFIRMATION_REQUIRED' && requestCount === beforeFreeBlock, freeBlock);

    const scopeA = scope.scopeHash;
    scope = { ok: true, scopeHash: hash('account-B'), generation: 2 };
    const bRead = await invoke('lumifield-ai-assistant-settings-read');
    await invoke('lumifield-ai-assistant-settings-write', { assistant: { provider: 'qwen', providers: { qwen: { model: 'qwen3.6-27b', baseUrl: PROVIDERS.qwen.baseUrl, freeOnlyAcknowledged: true } } } });
    await invoke('lumifield-ai-assistant-key-set', 'qwen', 'unit-secret-QWEN-123456');
    const bSaved = await invoke('lumifield-ai-assistant-settings-read');
    scope = { ok: true, scopeHash: scopeA, generation: 1 };
    const aRestored = await invoke('lumifield-ai-assistant-settings-read');
    pass('A and B settings and credentials are isolated by authoritative LF account scope', !bRead.found && bSaved.settings.assistant.provider === 'qwen' && bSaved.hasKey.qwen && !bSaved.hasKey.zhipu && aRestored.settings.assistant.provider === 'groq' && aRestored.hasKey.zhipu && !aRestored.hasKey.qwen, { bSaved, aRestored });

    await invoke('lumifield-ai-assistant-settings-write', { assistant: { provider: 'zhipu', providers: { zhipu: { freeOnlyAcknowledged: true } } } });
    let releaseRequest;
    requestImpl = () => new Promise(resolve => { releaseRequest = () => resolve(response(JSON.stringify({ reply: '下一首', actions: [{ name: 'playback.next', args: {} }] }))); });
    const stalePromise = invoke('lumifield-ai-assistant-query', { text: '播放下一首', source: 'text', explicitUserAction: true, context: {} });
    await waitFor(() => typeof releaseRequest === 'function');
    scope = { ok: true, scopeHash: hash('account-B'), generation: 2 };
    releaseRequest();
    const stale = await stalePromise;
    pass('an in-flight Provider response is discarded after LF account scope changes', !stale.ok && stale.error === 'STALE_ACCOUNT_SCOPE', stale);

    const spoof = await handlers.get('lumifield-ai-assistant-settings-read')({ sender: { owner: {} } });
    pass('all AI IPC rejects a spoofed renderer sender', !spoof.ok && spoof.error === 'INVALID_SENDER', spoof);
    scope = { ok: true, scopeHash: scopeA, generation: 1 };
    const openKey = await invoke('lumifield-ai-assistant-open-key-url', 'zhipu');
    pass('the get-Key button can open only the fixed official Provider page', openKey.ok && openedUrls.length === 1 && openedUrls[0] === PROVIDERS.zhipu.keyUrl, openedUrls);
    pass('the public LF Tool allowlist contains no shell filesystem Git Windows or other-app capability',
      Array.from(ALLOWED_ACTIONS).every(name => !/(?:shell|file|git|windows|exec|spawn|install|dependency|app\.)/i.test(name)), Array.from(ALLOWED_ACTIONS));

    scope = { ok: true, scopeHash: hash('account-corrupt'), generation: 3 };
    const corruptDir = path.join(userData, 'ai-assistant-v1', scope.scopeHash);
    fs.mkdirSync(corruptDir, { recursive: true });
    fs.writeFileSync(path.join(corruptDir, 'settings.json'), Buffer.alloc(128 * 1024 + 1, 0x20));
    fs.mkdirSync(path.join(corruptDir, 'credentials.bin'));
    const oversized = await invoke('lumifield-ai-assistant-settings-read');
    pass('oversized settings and non-regular credential paths recover to safe empty defaults', oversized.ok && !oversized.found && oversized.hasKey.zhipu === false, oversized);
    fs.rmSync(path.join(corruptDir, 'credentials.bin'), { recursive: true, force: true });
    fs.writeFileSync(path.join(corruptDir, 'credentials.bin'), Buffer.from('not-encrypted-json'));
    const corruptCredential = await invoke('lumifield-ai-assistant-settings-read');
    pass('corrupt encrypted credential data fails closed without exposing bytes', !corruptCredential.ok && corruptCredential.error === 'SECURE_CREDENTIALS_INVALID' && !JSON.stringify(corruptCredential).includes('not-encrypted-json'), corruptCredential);
  } finally {
    controller.dispose();
    fs.rmSync(userData, { recursive: true, force: true });
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
      this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async evaluate(expression, timeout = 30000) {
    const value = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, timeout);
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception && value.exceptionDetails.exception.description || value.exceptionDetails.text);
    return value.result && value.result.value;
  }
  close() { try { this.ws.close(); } catch (_) {} }
}

let app = null;
let cdp = null;
let debugPort = 0;
let runtimeUserData = '';
async function targets() { return (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); }

async function hideBlockingUi() {
  return cdp.evaluate(`(()=>{let style=document.getElementById('lf-ai-test-clean');if(!style){style=document.createElement('style');style.id='lf-ai-test-clean';style.textContent='#lf-auth-root,#visual-guide,.visual-guide-scrim,#drop-overlay,.modal-mask{display:none!important;visibility:hidden!important;pointer-events:none!important}';document.head.appendChild(style);}document.body.classList.remove('lf-auth-locked','visual-guide-active','render-deep-sleep','splash-active');if(typeof toggleFxPanel==='function')toggleFxPanel(true);if(typeof setFxPanelTab==='function')setFxPanelTab('voice');return true;})()`);
}

async function startApp() {
  assert.ok(fs.existsSync(electronExe), `Electron not found: ${electronExe}`);
  runtimeUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-v1144-ai-electron-'));
  fs.mkdirSync(path.join(runtimeUserData, 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(runtimeUserData, 'migrations', 'legacy-upstream-platform-session-v2.json'), JSON.stringify({ version: 2, validated: true, testIsolation: true, results: [] }), { mode: 0o600 });
  debugPort = await freePort();
  app = spawn(electronExe, ['.', `--user-data-dir=${runtimeUserData}`, `--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1'], {
    cwd: repo, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { NODE_PATH: dependencyRoot, LF_MASTER_TEST: '1', LUMIFIELD_SKIP_SPLASH: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }),
  });
  const collect = chunk => appLog.push(String(chunk)); app.stdout.on('data', collect); app.stderr.on('data', collect);
  const target = await waitFor(async () => {
    const list = await targets();
    return list.find(item => item.type === 'page' && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?(?:index\.html)?$/i.test(item.url));
  }, 60000);
  cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
  await waitFor(() => cdp.evaluate(`document.readyState==='complete'&&!!window.LumiFieldAIAssistant&&!!window.LumiFieldVoiceAssistant&&!!window.desktopWindow`), 60000);
  await hideBlockingUi();
  await waitFor(async () => { const value = await cdp.evaluate(`LumiFieldAIAssistant.getDebug()`); return value && value.initialized && !value.busy && value; }, 30000);
}

async function capturePanel() {
  await cdp.evaluate(`(()=>{const root=document.getElementById('lf-ai-provider-settings'),panel=document.getElementById('fx-panel');if(root&&panel)panel.scrollTop=Math.max(0,root.offsetTop-54);return true;})()`);
  await delay(350);
  const rect = await cdp.evaluate(`(()=>{const panel=document.getElementById('fx-panel'),pr=panel.getBoundingClientRect();const left=Math.max(0,pr.left),top=Math.max(0,pr.top);return{x:left,y:top,width:Math.max(1,Math.min(innerWidth-left,pr.width)),height:Math.max(1,Math.min(innerHeight-top,pr.height))};})()`);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false, clip: { ...rect, scale: 1 } }, 30000);
  const file = path.join(evidenceDir, 'ai-provider-settings.png');
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  screenshots.push({ file: path.basename(file), bytes: fs.statSync(file).size, sha256: hashFile(file), rect });
}

async function runtimeChecks() {
  const initial = await cdp.evaluate(`(()=>{const root=document.getElementById('lf-ai-provider-settings');const providers=[...root.querySelectorAll('.lf-ai-provider')];return{providerCount:providers.length,details:providers.map(node=>({id:node.dataset.provider,open:node.open,text:node.textContent})),keyInputs:[...root.querySelectorAll('[data-ai-key]')].map(node=>({type:node.type,value:node.value,autocomplete:node.autocomplete})),command:!!document.getElementById('lf-ai-command'),panel:document.getElementById('fx-panel').className,page:root.closest('[data-fx-page]')&&root.closest('[data-fx-page]').getAttribute('data-fx-page')};})()`);
  pass('the existing voice page contains exactly three collapsible AI Providers', initial.providerCount === 3 && initial.details.map(item => item.id).join(',') === 'zhipu,groq,qwen' && initial.details.every(item => /Model|Base URL|API Key|测试连接/.test(item.text)), initial);
  pass('all required user-facing model names are present', initial.details.some(item => item.text.includes('GLM-4.7-Flash') && item.text.includes('GLM-4.6V-Flash')) && initial.details.some(item => item.text.includes('openai/gpt-oss-120b') && item.text.includes('openai/gpt-oss-20b')) && initial.details.some(item => item.text.includes('Qwen/Qwen3.6-27b')), initial.details);
  pass('API Key controls are password-only write fields and start empty', initial.keyInputs.length === 3 && initial.keyInputs.every(item => item.type === 'password' && item.value === '' && item.autocomplete === 'new-password'), initial.keyInputs);
  const controlState = await cdp.evaluate(`(async()=>{const before=document.querySelector('#performance-quality-seg button.active');const beforeValue=before&&[...before.attributes].find(a=>a.name.startsWith('data-'))?.value||'';const result=await LumiFieldAIAssistant.executeAction({name:'control.choice',args:{id:'performance-quality-seg',value:'balanced'}});const after=document.querySelector('#performance-quality-seg button.active');const afterValue=after&&[...after.attributes].find(a=>a.name.startsWith('data-'))?.value||'';if(beforeValue&&beforeValue!=='balanced')await LumiFieldAIAssistant.executeAction({name:'control.choice',args:{id:'performance-quality-seg',value:beforeValue}});return{result,beforeValue,afterValue,debug:LumiFieldAIAssistant.getDebug()};})()`);
  pass('the live LF control catalog can operate an existing user setting without arbitrary DOM access', controlState.result.ok && controlState.afterValue === 'balanced' && controlState.debug.controlCatalogSize >= 20, controlState);

  await cdp.evaluate(`document.querySelector('.lf-ai-provider[data-provider="groq"] [data-ai-action="select"]').click()`);
  await waitFor(async () => { const value = await cdp.evaluate(`LumiFieldAIAssistant.getDebug()`); return !value.busy && value.provider === 'groq' && value; });
  await cdp.evaluate(`(()=>{const node=document.querySelector('.lf-ai-provider[data-provider="groq"] [data-ai-field="model"]');node.value='openai/gpt-oss-20b';node.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(async () => { const value = await cdp.evaluate(`LumiFieldAIAssistant.getDebug()`); return !value.busy && value.model === 'openai/gpt-oss-20b' && value; });
  await cdp.evaluate(`(()=>{const node=document.querySelector('.lf-ai-provider[data-provider="groq"] [data-ai-field="freeOnlyAcknowledged"]');node.checked=true;node.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(() => cdp.evaluate(`!LumiFieldAIAssistant.getDebug().busy`));
  const runtimeSecret = 'electron-secret-GROQ-987654321';
  await cdp.evaluate(`(()=>{const root=document.querySelector('.lf-ai-provider[data-provider="groq"]');root.querySelector('[data-ai-key]').value=${JSON.stringify(runtimeSecret)};root.querySelector('[data-ai-action="save-key"]').click();})()`);
  const keyState = await waitFor(async () => { const value = await cdp.evaluate(`LumiFieldAIAssistant.getDebug()`); return !value.busy && value.hasKey.groq && value.keyInputValues.every(item=>item==='') && value; });
  const mainState = await cdp.evaluate(`desktopWindow.getAIAssistantSettings()`);
  const mainDebug = await cdp.evaluate(`desktopWindow.getAIAssistantDebug()`);
  const credentialBytes = fs.readFileSync(mainDebug.credentialPath);
  pass('runtime save clears every renderer Key field and stores only encrypted main-process bytes', keyState.apiKeyInRendererState === false && !JSON.stringify(mainState).includes(runtimeSecret) && !credentialBytes.includes(Buffer.from(runtimeSecret)), { keyState, credentialBytes: credentialBytes.length });

  const voiceSaved = await cdp.evaluate(`LumiFieldVoiceAssistant.updateSettings({enabled:true,voiceWake:false,songSync:false,topEdgeWake:false,hotkey:''},{microphone:false,allowEmptyHotkey:true})`);
  pass('voice and AI settings share one authoritative user-scoped main store', voiceSaved === true, voiceSaved);
  const beforeReload = await cdp.evaluate(`desktopWindow.getAIAssistantSettings()`);
  pass('all requested non-secret settings are present in the authoritative record', beforeReload.settings.voice.enabled === true && beforeReload.settings.voice.voiceWake === false && beforeReload.settings.voice.songSync === false && beforeReload.settings.voice.topEdgeWake === false && beforeReload.settings.voice.hotkey === '' && beforeReload.settings.assistant.provider === 'groq' && beforeReload.settings.assistant.providers.groq.model === 'openai/gpt-oss-20b', beforeReload.settings);

  await capturePanel();
  await cdp.evaluate(`localStorage.clear();location.reload()`);
  await waitFor(() => cdp.evaluate(`document.readyState==='complete'&&!!window.LumiFieldAIAssistant&&!!window.LumiFieldVoiceAssistant`), 60000);
  await hideBlockingUi();
  const restored = await waitFor(async () => {
    const ai = await cdp.evaluate(`LumiFieldAIAssistant.getDebug()`);
    const voice = await cdp.evaluate(`LumiFieldVoiceAssistant.getDebugState()`);
    return ai && ai.initialized && !ai.busy && ai.provider === 'groq' && ai.model === 'openai/gpt-oss-20b' && ai.hasKey.groq && voice && !voice.scopeSwitching && voice.settings.enabled && { ai, voice };
  }, 30000);
  pass('main-authoritative settings and encrypted Key restore after the renderer origin store is erased', restored.ai.provider === 'groq' && restored.ai.hasKey.groq && restored.voice.settings.enabled && restored.voice.settings.topEdgeWake === false && restored.voice.settings.hotkey === '', restored);
  const publicJson = await cdp.evaluate(`(async()=>JSON.stringify(await desktopWindow.getAIAssistantSettings()))()`);
  pass('no Key read API or renderer debug field exposes plaintext credentials', !publicJson.includes(runtimeSecret) && !JSON.stringify(restored.ai).includes(runtimeSecret) && restored.ai.keyInputValues.every(value => value === ''), true);
  await cdp.evaluate(`LumiFieldVoiceAssistant.updateSettings({enabled:false,voiceWake:false,songSync:false},{microphone:false,allowEmptyHotkey:true})`);
  pass('runtime renderer and console errors remain zero', rendererErrors.length === 0 && consoleErrors.length === 0, { rendererErrors, consoleErrors });
}

async function stopApp() {
  if (cdp) { cdp.close(); cdp = null; }
  if (app && !app.killed) { app.kill(); await Promise.race([new Promise(resolve => app.once('exit', resolve)), delay(5000)]); }
  app = null;
  if (runtimeUserData) { try { fs.rmSync(runtimeUserData, { recursive: true, force: true }); } catch (_) {} }
}

(async () => {
  let error = null;
  try {
    sourceChecks();
    await unitChecks();
    if (process.env.LF_V1144_19_AI_STATIC_ONLY !== '1') { await startApp(); await runtimeChecks(); }
  } catch (caught) {
    error = caught; process.exitCode = 1;
  } finally {
    await stopApp();
    const result = { task: 'v1.1.44-problem-19-ai-provider', mode: process.env.LF_V1144_19_AI_STATIC_ONLY === '1' ? 'STATIC_AND_UNIT' : 'SOURCE_ELECTRON_TARGETED', status: error ? 'FAIL' : 'PASS', checkCount: Object.keys(checks).length, checks, screenshots, rendererErrors, consoleErrors, appLog, error: error ? String(error.stack || error) : null };
    const resultPath = path.join(evidenceDir, 'result.json'); fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    process.stdout.write(`${JSON.stringify({ status: result.status, mode: result.mode, checkCount: result.checkCount, evidenceDir, resultSha256: hashFile(resultPath) }, null, 2)}\n`);
  }
})();
