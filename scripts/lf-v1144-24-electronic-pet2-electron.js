'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const repo = path.resolve(__dirname, '..');
const fallbackDependencies = path.resolve(repo, '..', '..', 'release', 'verify-v1.1.43-tag', 'node_modules');
const dependencyRoot = process.env.LF_DEPENDENCY_ROOT ||
  (fs.existsSync(path.join(repo, 'node_modules', 'electron', 'dist', 'electron.exe'))
    ? path.join(repo, 'node_modules')
    : fallbackDependencies);
const electronExe = path.join(dependencyRoot, 'electron', 'dist', 'electron.exe');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.join(repo, 'test-results', 'lf-v1144-24-electronic-pet2', runId);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-v1144-24-'));
const checks = {};
const rendererErrors = [];
const consoleErrors = [];
const networkRequests = [];
const screenshots = [];
const appLog = [];
let app = null;
let cdp = null;

fs.mkdirSync(evidenceDir, { recursive: true });
fs.mkdirSync(path.join(userData, 'migrations'), { recursive: true });
fs.writeFileSync(
  path.join(userData, 'migrations', 'legacy-upstream-platform-session-v2.json'),
  JSON.stringify({ version: 2, validated: true, testIsolation: true, results: [] }),
  { mode: 0o600 },
);

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
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
      if (message.method === 'Network.requestWillBeSent') {
        networkRequests.push(String(message.params && message.params.request && message.params.request.url || ''));
      }
    };
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
    await this.send('Network.enable');
  }
  send(method, params, timeout = 30000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true,
    }, 60000);
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception && response.exceptionDetails.exception.description || response.exceptionDetails.text);
    }
    return response.result && response.result.value;
  }
  async screenshot(name) {
    const response = await this.send('Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: false,
    });
    const file = path.join(evidenceDir, name);
    fs.writeFileSync(file, Buffer.from(response.data, 'base64'));
    screenshots.push({ file: path.basename(file), bytes: fs.statSync(file).size, sha256: sha256File(file) });
  }
  close() { try { this.ws.close(); } catch (_) {} }
}

function staticChecks() {
  const fixedCommit = '175691ab32cefe5faec7828af62f3d50210a8eb2';
  const read = relative => fs.readFileSync(path.join(repo, ...relative.split('/')), 'utf8');
  const source = read('public/lf-electronic-pet2-source.js');
  const manager = read('public/lf-home-pet.js');
  const index = read('public/index.html');
  const css = read('public/lf-home-pet.css');
  const bundle = read('public/lf-electronic-pet2.bundle.js');
  const packageJson = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const definition = JSON.parse(read('public/lf-electronic-pet2.avatar.json'));
  const presets = JSON.parse(read('public/lf-electronic-pet2-avatars.json'));
  const snapshot = JSON.parse(read('third_party/bible-strong-avatar-lab/UPSTREAM_SNAPSHOT.json'));
  const meta = JSON.parse(read('docs/licenses/bible-strong-avatar-lab/ESBUILD_META.json'));
  const inputs = Object.keys(meta.inputs || {}).map(value => value.replaceAll('\\', '/'));

  pass('official source identity is fixed and retained', snapshot.commit === fixedCommit && presets.source.commit === fixedCommit && source.includes(fixedCommit), snapshot);
  pass('official capabilities are complete', presets.avatars.length === 10 && Object.keys(definition.animations).length === 23 && Object.keys(definition.expressions).length === 28, { avatars: presets.avatars.length, animations: Object.keys(definition.animations).length, expressions: Object.keys(definition.expressions).length });
  pass('fixed schema preserves official values above npm schema limit', read('third_party/bible-strong-avatar-lab/packages/avatar-core/src/avatarDefinition.schema.json').includes('"maximum": 2') && presets.avatars.some(avatar => JSON.stringify(avatar.body).includes('1.5026171875')) && presets.avatars.some(avatar => JSON.stringify(avatar.body).includes('"tipRoundness":2')), true);
  pass('bundle resolves exact vendored core and web source', inputs.some(value => value.includes('third_party/bible-strong-avatar-lab/packages/avatar-core/src/index.ts')) && inputs.some(value => value.includes('third_party/bible-strong-avatar-lab/packages/avatar-web/src/index.ts')) && !inputs.some(value => value.includes('node_modules/@bible-strong/avatar-')), inputs.filter(value => value.includes('avatar-')));
  pass('npm runtime mismatch cannot enter production dependency graph', !packageJson.dependencies['@bible-strong/avatar-core'] && !packageJson.dependencies['@bible-strong/avatar-web'] && !lock.packages['node_modules/@bible-strong/avatar-core'] && !lock.packages['node_modules/@bible-strong/avatar-web'] && packageJson.devDependencies.ajv === '8.20.0', true);
  pass('runtime is fully local with no iframe or remote module', !/<iframe|fetch\s*\(|import\s*\(\s*['"]https:|esm\.sh|unpkg|jsdelivr/i.test(source + manager) && source.includes('../third_party/bible-strong-avatar-lab/packages/avatar-web/src/index.ts'), true);
  pass('official destroy lifecycle and continuous expression runtime are retained', /controller\.destroy\(\)/.test(source) && /lf-expression-/.test(source) && /holdMs:\s*60000/.test(source) && /microSaccades/.test(source) && /slowDrift/.test(source), true);
  pass('shared-slot switch is transactional and persistent per LF account', /state\.root\.appendChild\(nextHost\)/.test(manager) && /nextHost\.style\.visibility = 'visible'/.test(manager) && /disposeHost\(oldHost, oldApi\)/.test(manager) && /lumifield-electronic-pet-v2:/.test(manager) && /lumifield-auth-user-change/.test(manager), true);
  pass('settings expose the two exact required choices and full controls', manager.includes('Shader SVG') && manager.includes('电子宠物 2') && manager.includes('自动眨眼') && manager.includes('环境运动') && manager.includes('对应源码'), true);
  pass('settings target Presets directly below Audio Echo and never target My profile', manager.includes('.fx-tab-page[data-fx-page="presets"]') && manager.includes("querySelector('#lf-t13-echo-block')") && manager.includes("anchor.insertAdjacentElement('afterend', root)") && !manager.includes("querySelectorAll('#lf-profile-modal .lf-profile-section')"), true);
  pass('Pet 2 bundle loads locally before the shared manager', index.indexOf('/lf-electronic-pet2.bundle.js') > index.indexOf('/lf-home-pet-source.bundle.js') && index.indexOf('/lf-electronic-pet2.bundle.js') < index.indexOf('/lf-home-pet.js'), true);
  pass('shared slot has no visual transition and keeps Pet 2 fully visible', /\.lf-home-pet-runtime-host\s*\{/.test(css) && /overflow:visible/.test(css) && !/lf-home-pet-runtime-host[\s\S]{0,220}transition:/.test(css), true);
  pass('bundle carries durable AGPL attribution', bundle.startsWith('/*! Bible Strong Avatar Lab Web Runtime') && bundle.includes('AGPL-3.0-only') && bundle.includes(fixedCommit), sha256File(path.join(repo, 'public', 'lf-electronic-pet2.bundle.js')));

  const hashRows = read('docs/licenses/bible-strong-avatar-lab/SOURCE_SHA256SUMS.txt').trim().split(/\r?\n/);
  const mismatches = hashRows.filter(line => {
    const match = line.match(/^([A-F0-9]{64})  (.+)$/);
    return !match || !fs.existsSync(path.join(repo, ...match[2].split('/'))) || sha256File(path.join(repo, ...match[2].split('/'))) !== match[1];
  });
  pass('corresponding-source hash manifest is complete and current', hashRows.length >= 60 && mismatches.length === 0, { files: hashRows.length, mismatches });
  pass('AGPL copyright source and modification evidence is complete', read('resources/licenses/Bible-Strong-Avatar-Lab-AGPL-3.0-only.txt').includes('GNU AFFERO GENERAL PUBLIC LICENSE') && read('resources/licenses/Bible-Strong-Avatar-Web-COPYRIGHT.txt').includes('Copyright (C) 2026 Stéphane Montlouis-Calixte') && read('docs/licenses/bible-strong-avatar-lab/MODIFICATIONS.md').includes('Modification date: 2026-08-22') && read('NOTICE.md').includes(fixedCommit) && read('THIRD_PARTY_NOTICES.md').includes(fixedCommit), true);
}

async function listTargets(port) { return (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); }
async function startApp() {
  assert.ok(fs.existsSync(electronExe), `Electron not found: ${electronExe}`);
  const port = await freePort();
  app = spawn(electronExe, ['.', `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], {
    cwd: repo,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, {
      NODE_PATH: dependencyRoot,
      LF_MASTER_TEST: '1',
      LUMIFIELD_SKIP_SPLASH: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    }),
  });
  const collect = data => appLog.push(String(data)); app.stdout.on('data', collect); app.stderr.on('data', collect);
  const target = await waitFor(async () => {
    const targets = await listTargets(port);
    return targets.find(item => item.type === 'page' && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?(?:index\.html)?$/i.test(item.url));
  }, 60000);
  cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
  await waitFor(() => cdp.evaluate(`document.readyState==='complete'&&!!window.LumiFieldHomePet&&!!window.LumiFieldPet2Runtime&&!!window.LumiFieldHomePetSource`), 60000);
}

async function prepareHome() {
  await cdp.evaluate(`(()=>{
    const auth=document.getElementById('lf-auth-root');if(auth){auth.classList.remove('show');auth.style.setProperty('display','none','important');auth.setAttribute('aria-hidden','true');}
    document.querySelectorAll('.modal-mask,#lf-profile-modal,#lf-account-manager,#lf-legal-modal').forEach(node=>node.classList.remove('show','active'));
    if(typeof closeVisualGuide==='function')closeVisualGuide(true);
    document.body.classList.remove('splash-active','splash-revealing','lf-auth-locked','visual-guide-active','immersive-mode','render-deep-sleep','render-background-eco');
    window.homeSuppressed=false;window.homeForcedOpen=true;window.emptyHomeActive=true;
    if(typeof window.LumiFieldPrepareFirstReveal==='function')window.LumiFieldPrepareFirstReveal();else document.body.classList.add('empty-home-active');
    window.LumiFieldHomePet.sync('problem24-test');
    return true;
  })()`);
  return waitFor(() => cdp.evaluate(`(()=>{const d=LumiFieldHomePet.getDebug();return d.mounted&&d.eligible&&d.engine==='shader-svg'&&d.canvasCount===1&&d.mouseMoveListenerCount===2?d:null})()`), 30000);
}

async function runtimeChecks() {
  const initial = await prepareHome();
  const capabilities = await cdp.evaluate(`LumiFieldPet2Runtime.getCapabilities()`);
  pass('runtime exposes all official user-selectable capabilities', capabilities.avatars.length === 10 && capabilities.animations.length === 23 && capabilities.expressions.length === 28 && capabilities.sourceCommit === '175691ab32cefe5faec7828af62f3d50210a8eb2', { avatars: capabilities.avatars.length, animations: capabilities.animations.length, expressions: capabilities.expressions.length, sourceCommit: capabilities.sourceCommit });
  pass('existing Shader SVG remains the default in the unchanged shared slot', initial.engine === 'shader-svg' && initial.rootCount === 1 && initial.engineHostCount === 1 && initial.shaderSvgCount === 1 && initial.canvasCount === 1, initial);

  const firstSwitch = await cdp.evaluate(`(async()=>{
    const root=document.getElementById('lf-home-pet');const timeOrigin=performance.timeOrigin;const href=location.href;
    const samples=[];const visible=()=>Array.from(root.querySelectorAll('.lf-home-pet-runtime-host')).filter(node=>{const s=getComputedStyle(node);return s.visibility!=='hidden'&&Number(s.opacity)>0.02;}).length;
    const observer=new MutationObserver(()=>samples.push(visible()));observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['style']});
    const started=performance.now();const ok=await LumiFieldHomePet.selectEngine('electronic-pet-2');const duration=performance.now()-started;
    await Promise.resolve();observer.disconnect();const d=LumiFieldHomePet.getDebug();
    return{ok,duration,timeOriginStable:performance.timeOrigin===timeOrigin,hrefStable:location.href===href,rootStable:document.getElementById('lf-home-pet')===root,samples,debug:d,shaderStats:LumiFieldHomePetSource.getDebug(document.createElement('div'))};
  })()`);
  pass('visible Pet 1 to Pet 2 switch is immediate with no reload or empty slot', firstSwitch.ok && firstSwitch.duration < 160 && firstSwitch.timeOriginStable && firstSwitch.hrefStable && firstSwitch.rootStable && firstSwitch.samples.every(count => count >= 1), firstSwitch);
  pass('Pet 2 mounts one official local SVG and destroys Pet 1', firstSwitch.debug.engine === 'electronic-pet-2' && firstSwitch.debug.engineHostCount === 1 && firstSwitch.debug.pet2SvgCount === 1 && firstSwitch.debug.canvasCount === 0 && firstSwitch.debug.source.sourceCommit === capabilities.sourceCommit && firstSwitch.shaderStats.unmounts >= 1 && firstSwitch.shaderStats.listenerCount === 0, firstSwitch.debug);

  const avatarResults = await cdp.evaluate(`(async()=>{
    const cap=LumiFieldPet2Runtime.getCapabilities();const results=[];
    for(const avatar of cap.avatars){
      const ok=await LumiFieldHomePet.updateSettings({avatarId:avatar.id,bodyColor:avatar.bodyColor,eyesColor:avatar.eyesColor});
      const d=LumiFieldHomePet.getDebug();const svg=document.querySelector('#lf-home-pet svg[viewBox="-150 -150 300 300"]');
      results.push({id:avatar.id,name:avatar.name,ok,engineHosts:d.engineHostCount,svg:d.pet2SvgCount,error:d.lastError,sourceError:d.source&&d.source.lastError,active:d.source&&d.source.settings&&d.source.settings.avatarId,paths:svg?Array.from(svg.querySelectorAll('path')).filter(node=>node.getAttribute('d')).length:0});
    }
    return results;
  })()`);
  pass('all ten official avatars mount without schema distortion or runtime error', avatarResults.length === 10 && avatarResults.every(item => item.ok && item.engineHosts === 1 && item.svg === 1 && !item.error && !item.sourceError && item.active === item.id && item.paths >= 3) && avatarResults.some(item => item.name === 'Onee'), avatarResults);

  const commandCoverage = await cdp.evaluate(`(async()=>{
    const cap=LumiFieldPet2Runtime.getCapabilities();const animations=[];const expressions=[];
    for(const item of cap.animations){const ok=await LumiFieldHomePet.updateSettings({behaviorMode:'animation',animation:item.key});const d=LumiFieldHomePet.getDebug();animations.push({key:item.key,ok,active:d.source&&d.source.activeAnimation,error:d.lastError||d.source&&d.source.lastError});}
    for(const item of cap.expressions){const ok=await LumiFieldHomePet.updateSettings({behaviorMode:'expression',expression:item.key});const d=LumiFieldHomePet.getDebug();expressions.push({key:item.key,ok,active:d.source&&d.source.activeAnimation,error:d.lastError||d.source&&d.source.lastError});}
    return{animations,expressions,debug:LumiFieldHomePet.getDebug()};
  })()`);
  pass('all 23 official animations are callable', commandCoverage.animations.length === 23 && commandCoverage.animations.every(item => item.ok && item.active === item.key && !item.error), commandCoverage.animations);
  pass('all 28 official expressions are callable through continuous official-runtime loops', commandCoverage.expressions.length === 28 && commandCoverage.expressions.every(item => item.ok && item.active === `lf-expression-${item.key}` && !item.error), commandCoverage.expressions);
  pass('animation and expression changes reuse one runtime without duplicate hosts', commandCoverage.debug.engineHostCount === 1 && commandCoverage.debug.pet2SvgCount === 1 && commandCoverage.debug.source.configures >= 50, commandCoverage.debug.source);

  const behaviorEvidence = await cdp.evaluate(`(async()=>{
    const cap=LumiFieldPet2Runtime.getCapabilities();const strobi=cap.avatars.find(item=>item.name==='Strobi');
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const sample=async(ms)=>{const values=[];const end=performance.now()+ms;while(performance.now()<end){const svg=document.querySelector('#lf-home-pet svg[viewBox="-150 -150 300 300"]');const eyes=svg?Array.from(svg.querySelectorAll('g path')).map(node=>node.getAttribute('d')).join('|'):'';const body=svg?Array.from(svg.children).filter(node=>node.tagName&&node.tagName.toLowerCase()==='path'&&node.getAttribute('d')).map(node=>node.getAttribute('d')).join('|'):'';values.push({eyes,body});await new Promise(requestAnimationFrame);}return{eyeUnique:new Set(values.map(item=>item.eyes)).size,bodyUnique:new Set(values.map(item=>item.body)).size,samples:values.length};};
    await LumiFieldHomePet.updateSettings({avatarId:strobi.id,bodyColor:strobi.bodyColor,eyesColor:strobi.eyesColor,behaviorMode:'expression',expression:'neutral',ambientMovement:false,blinking:true});
    await sleep(600);const blink=await sample(3500);
    await LumiFieldHomePet.updateSettings({blinking:false,ambientMovement:false});await sleep(600);const still=await sample(900);
    await LumiFieldHomePet.updateSettings({blinking:false,ambientMovement:true});await sleep(600);const ambient=await sample(900);
    return{blink,still,ambient,debug:LumiFieldHomePet.getDebug()};
  })()`);
  pass('official blinking visibly changes the eye geometry', behaviorEvidence.blink.eyeUnique > 2 && behaviorEvidence.blink.samples > 80, behaviorEvidence.blink);
  pass('disabling blink and ambient leaves the expression geometrically stable', behaviorEvidence.still.eyeUnique === 1 && behaviorEvidence.still.bodyUnique === 1, behaviorEvidence.still);
  pass('official ambient movement remains continuously interactive over animation frames', behaviorEvidence.ambient.eyeUnique > 2 && behaviorEvidence.ambient.bodyUnique > 2 && behaviorEvidence.ambient.samples >= 8 && behaviorEvidence.ambient.eyeUnique === behaviorEvidence.ambient.samples && behaviorEvidence.ambient.bodyUnique === behaviorEvidence.ambient.samples, behaviorEvidence.ambient);

  const switchPerformance = await cdp.evaluate(`(async()=>{
    const durations=[];const frames=[];let running=true;let previous=0;
    const tick=time=>{if(previous)frames.push(time-previous);previous=time;if(running)requestAnimationFrame(tick);};requestAnimationFrame(tick);
    for(let i=0;i<8;i++){const engine=i%2===0?'shader-svg':'electronic-pet-2';const started=performance.now();await LumiFieldHomePet.selectEngine(engine);durations.push(performance.now()-started);await new Promise(requestAnimationFrame);}
    if(LumiFieldHomePet.getSettings().engine!=='electronic-pet-2')await LumiFieldHomePet.selectEngine('electronic-pet-2');
    await new Promise(requestAnimationFrame);running=false;const sorted=frames.slice().sort((a,b)=>a-b);const d=LumiFieldHomePet.getDebug();
    return{durations,frames,maxFrame:Math.max(...frames),p95:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))]||0,debug:d,pet2Stats:LumiFieldPet2Runtime.getDebug(document.createElement('div')),shaderStats:LumiFieldHomePetSource.getDebug(document.createElement('div'))};
  })()`);
  pass('repeated shared-slot switches stay responsive without duplicate runtimes', Math.max(...switchPerformance.durations) < 120 && switchPerformance.debug.engineHostCount === 1 && switchPerformance.debug.pet2SvgCount === 1 && switchPerformance.shaderStats.listenerCount === 0, switchPerformance);

  const presets = await cdp.evaluate(`(async()=>{
    if(typeof toggleFxPanel==='function')toggleFxPanel(true);if(typeof setFxPanelTab==='function')setFxPanelTab('presets');await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);LumiFieldHomePet.ensureSettings();
    const root=document.getElementById('lf-electronic-pet-settings');root&&root.scrollIntoView({block:'center'});
    const values=selector=>Array.from(root.querySelector(selector).options).map(option=>option.value);
    const echo=document.getElementById('lf-t13-echo-block');const page=root&&root.closest('.fx-tab-page');
    return{shown:document.getElementById('fx-panel').classList.contains('show'),page:page&&page.dataset.fxPage,directlyAfterEcho:!!(echo&&echo.nextElementSibling===root),inProfile:document.querySelectorAll('#lf-profile-modal #lf-electronic-pet-settings').length,profileText:(document.getElementById('lf-profile-modal')||{}).textContent||'',petRootCount:document.querySelectorAll('#lf-home-pet').length,title:root&&root.querySelector('.lf-pet-settings-head b').textContent.trim(),engines:Array.from(root.querySelectorAll('[data-lf-pet-engine]')).map(node=>node.textContent.trim()),avatars:values('[data-lf-pet-field="avatarId"]'),animations:values('[data-lf-pet-field="animation"]'),expressions:values('[data-lf-pet-field="expression"]'),source:root.querySelector('.lf-pet-license a').href,localText:root.querySelector('.lf-pet-license span').textContent};
  })()`);
  pass('all pet settings are in Presets directly below Audio Echo and absent from My', presets.shown && presets.page === 'presets' && presets.directlyAfterEcho && presets.inProfile === 0 && presets.petRootCount === 1 && presets.title === '电子宠物' && presets.engines.join('|') === 'Shader SVG|电子宠物 2' && presets.avatars.length === 10 && presets.animations.length === 23 && presets.expressions.length === 28, presets);
  pass('Settings discloses local AGPL runtime and exact corresponding source', presets.localText.includes('本地 Runtime') && presets.localText.includes('AGPL-3.0-only') && presets.localText.includes('无 iframe') && presets.source.includes('175691ab32cefe5faec7828af62f3d50210a8eb2'), presets);
  await cdp.screenshot('electronic-pet-settings.png');

  const myPanel = await cdp.evaluate(`(async()=>{
    LFAuth.openProfile();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
    const root=document.getElementById('lf-electronic-pet-settings');const echo=document.getElementById('lf-t13-echo-block');
    return{shown:document.getElementById('lf-profile-modal').classList.contains('show'),inProfile:document.querySelectorAll('#lf-profile-modal #lf-electronic-pet-settings').length,inPresets:document.querySelectorAll('#fx-panel .fx-tab-page[data-fx-page="presets"] #lf-electronic-pet-settings').length,directlyAfterEcho:!!(echo&&echo.nextElementSibling===root)};
  })()`);
  pass('opening My never moves or duplicates the pet settings', myPanel.shown && myPanel.inProfile === 0 && myPanel.inPresets === 1 && myPanel.directlyAfterEcho, myPanel);
  await cdp.screenshot('my-panel-without-electronic-pet-settings.png');
  await cdp.evaluate(`(()=>{document.getElementById('lf-profile-close').click();toggleFxPanel(true);setFxPanelTab('presets');return true;})()`);

  const uiSwitch = await cdp.evaluate(`(async()=>{
    const root=document.getElementById('lf-electronic-pet-settings');root.querySelector('[data-lf-pet-engine="shader-svg"]').click();await Promise.resolve();const shader=LumiFieldHomePet.getSettings();root.querySelector('[data-lf-pet-engine="electronic-pet-2"]').click();await Promise.resolve();const pet2=LumiFieldHomePet.getSettings();const avatar=root.querySelector('[data-lf-pet-field="avatarId"]');avatar.selectedIndex=1;avatar.dispatchEvent(new Event('change',{bubbles:true}));await Promise.resolve();const selected=LumiFieldHomePet.getSettings();toggleFxPanel(false);return{shader,pet2,selected};
  })()`);
  const afterPanel = await waitFor(() => cdp.evaluate(`(()=>{const d=LumiFieldHomePet.getDebug();return d.mounted&&d.engine==='electronic-pet-2'&&d.source&&d.source.settings.avatarId===LumiFieldPet2Runtime.getCapabilities().avatars[1].id?d:null})()`));
  pass('Presets controls switch engines immediately and apply the selected avatar on close', uiSwitch.shader.engine === 'shader-svg' && uiSwitch.pet2.engine === 'electronic-pet-2' && uiSwitch.selected.avatarId === capabilities.avatars[1].id && afterPanel.engineHostCount === 1 && afterPanel.pet2SvgCount === 1, { uiSwitch, afterPanel });
  await cdp.screenshot('electronic-pet2-home.png');

  const accountPersistence = await cdp.evaluate(`(async()=>{
    const original=LFAuth.getUser;const change=id=>{LFAuth.getUser=()=>({id});document.dispatchEvent(new CustomEvent('lumifield-auth-user-change',{detail:{loggedIn:true,userId:id}}));};
    change('problem24-account-a');await new Promise(resolve=>setTimeout(resolve,30));await LumiFieldHomePet.selectEngine('electronic-pet-2');const aSaved={settings:LumiFieldHomePet.getSettings(),key:LumiFieldHomePet.getDebug().scopeKey};
    change('problem24-account-b');await new Promise(resolve=>setTimeout(resolve,60));const bDefault={settings:LumiFieldHomePet.getSettings(),key:LumiFieldHomePet.getDebug().scopeKey};
    change('problem24-account-a');await new Promise(resolve=>setTimeout(resolve,60));const aRestored={settings:LumiFieldHomePet.getSettings(),key:LumiFieldHomePet.getDebug().scopeKey};
    LFAuth.getUser=original;document.dispatchEvent(new CustomEvent('lumifield-auth-user-change',{detail:{loggedIn:true,userId:'restore'}}));await new Promise(resolve=>setTimeout(resolve,60));
    return{aSaved,bDefault,aRestored,storedA:localStorage.getItem(aSaved.key),storedB:localStorage.getItem(bDefault.key)};
  })()`);
  pass('selection is persisted independently for each LF account', accountPersistence.aSaved.settings.engine === 'electronic-pet-2' && accountPersistence.bDefault.settings.engine === 'shader-svg' && accountPersistence.aRestored.settings.engine === 'electronic-pet-2' && accountPersistence.aSaved.key !== accountPersistence.bDefault.key && JSON.parse(accountPersistence.storedA).engine === 'electronic-pet-2', accountPersistence);

  await cdp.evaluate(`LumiFieldHomePet.selectEngine('electronic-pet-2')`);
  const lifecycle = await cdp.evaluate(`(async()=>{
    const before=LumiFieldPet2Runtime.getDebug(document.createElement('div')).unmounts;document.body.classList.remove('empty-home-active');LumiFieldHomePet.sync('problem24-leave-home');const absent={roots:document.querySelectorAll('#lf-home-pet').length,stats:LumiFieldPet2Runtime.getDebug(document.createElement('div'))};document.body.classList.add('empty-home-active');LumiFieldHomePet.sync('problem24-return-home');await new Promise(requestAnimationFrame);return{before,absent,returned:LumiFieldHomePet.getDebug()};
  })()`);
  pass('leaving Home destroys the old official runtime and returning creates exactly one clean instance', lifecycle.absent.roots === 0 && lifecycle.absent.stats.unmounts > lifecycle.before && lifecycle.returned.engine === 'electronic-pet-2' && lifecycle.returned.engineHostCount === 1 && lifecycle.returned.pet2SvgCount === 1, lifecycle);

  const remoteAvatarRequests = networkRequests.filter(url => /avatars\.bible-strong\.app|github\.com\/smontlouis\/bible-strong-avatar-lab|esm\.sh|unpkg\.com|jsdelivr\.net/i.test(url));
  const resourceRemote = await cdp.evaluate(`performance.getEntriesByType('resource').map(item=>item.name).filter(url=>/avatars\\.bible-strong\\.app|github\\.com\\/smontlouis\\/bible-strong-avatar-lab|esm\\.sh|unpkg\\.com|jsdelivr\\.net/i.test(url))`);
  pass('runtime makes no Avatar Lab iframe CDN or remote source request', remoteAvatarRequests.length === 0 && resourceRemote.length === 0, { remoteAvatarRequests, resourceRemote });
  pass('renderer and console errors remain zero', rendererErrors.length === 0 && consoleErrors.length === 0, { rendererErrors, consoleErrors });
}

async function stopApp() {
  if (cdp) { cdp.close(); cdp = null; }
  if (app && !app.killed) {
    app.kill();
    await Promise.race([new Promise(resolve => app.once('exit', resolve)), delay(4000)]);
  }
  app = null;
}

(async () => {
  let error = null;
  try {
    staticChecks();
    if (process.env.LF_V1144_24_STATIC_ONLY !== '1') {
      await startApp();
      await runtimeChecks();
    }
  } catch (caught) {
    error = caught;
    process.exitCode = 1;
  } finally {
    await stopApp();
    const result = {
      task: 'v1.1.44-problem-24',
      status: error ? 'FAIL' : 'PASS',
      checks,
      checkCount: Object.keys(checks).length,
      rendererErrors,
      consoleErrors,
      networkRequests: networkRequests.filter(Boolean),
      screenshots,
      appLog,
      error: error ? String(error.stack || error) : null,
    };
    fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));
    process.stdout.write(`${JSON.stringify({ status: result.status, checkCount: result.checkCount, evidenceDir }, null, 2)}\n`);
  }
})();
