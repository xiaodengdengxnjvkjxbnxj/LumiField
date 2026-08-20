'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const repo = path.resolve(__dirname, '..');
const legacyBrand = ['Mine', 'radio'].join('');
const legacyPattern = new RegExp(legacyBrand, 'i');
const dependencyRoot = process.env.LF_DEPENDENCY_ROOT || path.resolve(repo, '..', '..', 'release', 'verify-v1.1.43-tag', 'node_modules');
const electronExe = path.join(dependencyRoot, 'electron', 'dist', 'electron.exe');
const evidenceDir = path.join(repo, 'test-results', 'lf-v1144-21-brand-separation', new Date().toISOString().replace(/[:.]/g, '-'));
const checks = {};
const rendererErrors = [];
const consoleErrors = [];
const appLog = [];
const screenshots = [];
fs.mkdirSync(evidenceDir, { recursive: true });

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function text(file) { return fs.readFileSync(path.join(repo, file), 'utf8'); }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase(); }
function pass(name, condition, detail) { assert.ok(condition, `${name}: ${JSON.stringify(detail)}`); checks[name] = detail == null ? true : detail; }
function walk(relative) {
  const root = path.join(repo, relative);
  const out = [];
  const visit = current => fs.readdirSync(current, { withFileTypes:true }).forEach(entry => {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) visit(absolute); else if (entry.isFile()) out.push(path.relative(repo, absolute).replace(/\\/g, '/'));
  });
  visit(root);
  return out;
}
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

function staticChecks() {
  const pkg = JSON.parse(text('package.json'));
  const brand = JSON.parse(text('brand.config.json'));
  const main = text('desktop/main.js');
  const index = text('public/index.html');
  const installer = text('build/installer.nsh');
  const installerDoc = text('docs/INSTALLER_STYLE.md');
  const glassDoc = text('docs/GLASS_SVG_TEXTURE.md');
  const currentFiles = [
    'package.json', 'brand.config.json', 'server.js', 'music-platform-service.js',
    ...walk('desktop'), ...walk('build'), ...walk('public'),
  ];
  const currentBrandLeaks = currentFiles.filter(file => legacyPattern.test(text(file)));
  const currentNameLeaks = currentFiles.filter(file => legacyPattern.test(path.basename(file)));

  pass('package metadata is exclusively LumiField', pkg.name === 'lumifield' && pkg.productName === 'LumiField' && pkg.build.appId === 'com.lumifield.desktop' && pkg.build.productName === 'LumiField' && pkg.build.win.executableName === 'LumiField' && pkg.build.nsis.shortcutName === 'LumiField' && pkg.build.nsis.artifactName === 'LumiField-${version}-Setup.${ext}', {
    name:pkg.name, productName:pkg.productName, appId:pkg.build.appId, executableName:pkg.build.win.executableName, shortcutName:pkg.build.nsis.shortcutName, artifactName:pkg.build.nsis.artifactName,
  });
  pass('brand configuration and repository metadata point to LumiField', brand.name === 'LumiField' && brand.slug === 'lumifield' && brand.appId === 'com.lumifield.desktop' && /\/LumiField\/?$/.test(pkg.homepage) && /\/LumiField(?:\.git)?$/.test(pkg.repository.url), { brand, homepage:pkg.homepage, repository:pkg.repository.url });
  pass('current runtime build and public surfaces contain no legacy product brand', currentBrandLeaks.length === 0 && currentNameLeaks.length === 0, { currentBrandLeaks, currentNameLeaks });
  pass('main process establishes LumiField identity before any userData access', main.indexOf('app.setName(APP_NAME)') >= 0 && main.indexOf("loadLFEnvironment({") > main.indexOf('app.setName(APP_NAME)') && main.indexOf("app.getPath('userData')") > main.indexOf('app.setName(APP_NAME)') && /setAppUserModelId\(APP_USER_MODEL_ID\)/.test(main), true);
  pass('window title taskbar shortcut and startup fallback are LumiField-branded', /title: APP_NAME/.test(main) && /`\$\{APP_NAME\}\.lnk`/.test(main) && /LumiField immersive music player/.test(main) && /重启 LumiField/.test(main) && /LumiField startup failed/.test(main), true);
  pass('installer uses only LumiField paths marker labels and artifacts', /\.lumifield-install-root/.test(installer) && /appId=com\.lumifield\.desktop/.test(installer) && /D:\\LumiField/.test(installer) && /C:\\LumiField/.test(installer) && /LumiField 安装/.test(installer) && !legacyPattern.test(installer), true);
  pass('installer and glass guidance match the current product implementation', !legacyPattern.test(installerDoc) && /LumiField-<version>-Setup\.exe/.test(installerDoc) && /lumifield-control-glass-filter/.test(glassDoc) && !legacyPattern.test(glassDoc), true);
  pass('current icons and installer artwork exist under brand-neutral LumiField build names', ['build/icon.ico','build/icon.png','build/installerHeader.bmp','build/installerSidebar.bmp'].every(file => fs.statSync(path.join(repo, file)).size > 1024) && !walk('build').some(file => legacyPattern.test(file)), true);
  pass('no legacy global bridge performance hook or glass filter remains in current code and maintained smoke tests', /window\.desktopWindow/.test(index) && /window\.__lumifieldPerfSnapshot/.test(index) && /id="lumifield-control-glass-filter"/.test(index) && !legacyPattern.test(text('scripts/lf-installed-final-smoke.js')) && !legacyPattern.test(text('scripts/lf-combined-perf-diagnostic.js')) && !legacyPattern.test(text('scripts/lf-master-problem14-smoke.js')) && !legacyPattern.test(text('scripts/lf-master-problem16-smoke.js')) && !legacyPattern.test(text('scripts/lf-ui-smoke.js')), true);
  pass('preset runtime provenance points to packaged legal notice without exposing the former product repository', /provenance:'NOTICE\.md'/.test(index) && !/ORIGINAL_PRESET_ADVANCED_DEFAULT_SOURCE[\s\S]{0,300}repository:/.test(index), true);
  pass('updates are explicitly disabled and official project links use LumiField', pkg.lumifield && pkg.lumifield.update && pkg.lumifield.update.enabled === false && /xiaodengdengxnjvkjxbnxj\/LumiField/.test(pkg.repository.url) && /xiaodengdengxnjvkjxbnxj\/LumiField\/issues/.test(pkg.bugs.url), pkg.lumifield.update);
  pass('no obsolete custom protocol registration can revive a legacy product scheme', !/setAsDefaultProtocolClient|registerSchemesAsPrivileged/.test(main) && !legacyPattern.test(main), true);

  const legal = [text('README.md'), text('MODIFICATIONS.md'), text('NOTICE.md'), text('THIRD_PARTY_NOTICES.md')].join('\n');
  pass('legally required upstream attribution remains intact and GPL-3.0 is declared', legacyPattern.test(legal) && /GPL-3\.0/.test(legal) && /XxHuberrr/.test(legal), true);
  pass('legacy runtime storage session preset and beat-cache migration entrypoints are absent', !fs.existsSync(path.join(repo, 'public', 'lf-legacy-runtime-migration.js')) && !fs.existsSync(path.join(repo, 'desktop', 'lf-legacy-platform-session-migration.js')) && !/lf-legacy-runtime-migration/.test(index) && !/migrateLegacyPlatformSessions/.test(main) && !/\['mine',\s*'radio'\]/i.test(text('public/lumifield-preset-schema.js')) && !/legacyBeatCacheModeToken|legacyBeatMapCacheKey/.test(text('server.js')), true);
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
  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true, userGesture:true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception && response.exceptionDetails.exception.description || response.exceptionDetails.text);
    return response.result && response.result.value;
  }
  close() { try { this.ws.close(); } catch (_) {} }
}

let app = null;
let cdp = null;
let runtimeUserData = '';
let debugPort = 0;
async function targets() { return (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); }

async function runtimeChecks() {
  assert.ok(fs.existsSync(electronExe), `Electron not found: ${electronExe}`);
  runtimeUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-v1144-p21-'));
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
  await waitFor(() => cdp.evaluate(`document.readyState==='complete'&&document.title==='LumiField'&&!!window.desktopWindow&&!!window.__lumifieldPerfSnapshot`), 60000);
  const runtime = await cdp.evaluate(`(()=>{const forbidden=['Mine','radio'].join('');const pattern=new RegExp(forbidden,'i');const globals=Object.keys(window).filter(key=>pattern.test(key));const textHits=[...document.querySelectorAll('body *')].filter(node=>node.children.length===0&&pattern.test(node.textContent||'')).slice(0,12).map(node=>({tag:node.tagName,id:node.id,text:(node.textContent||'').trim().slice(0,100)}));return{title:document.title,url:location.href,bridge:!!window.desktopWindow,perf:!!window.__lumifieldPerfSnapshot,oldBridge:globals,oldText:textHits,source:window.LumiFieldBuiltInPresetIsolation&&window.LumiFieldBuiltInPresetIsolation.getDebug?window.LumiFieldBuiltInPresetIsolation.getDebug().source:null};})()`);
  pass('live document title bridge and performance API are exclusively LumiField', runtime.title === 'LumiField' && runtime.bridge && runtime.perf && runtime.oldBridge.length === 0, runtime);
  pass('live UI contains no legacy product label or repository provenance', runtime.oldText.length === 0 && (!runtime.source || !runtime.source.repository) && (!runtime.source || runtime.source.provenance === 'NOTICE.md'), runtime);
  const currentTargets = await targets();
  const pageTarget = currentTargets.find(item => item.type === 'page' && item.url === runtime.url);
  pass('Electron page target and error-free runtime keep the LumiField title', !!pageTarget && pageTarget.title === 'LumiField' && rendererErrors.length === 0 && consoleErrors.length === 0, { targetTitle:pageTarget && pageTarget.title, rendererErrors, consoleErrors });
  const shot = await cdp.send('Page.captureScreenshot', { format:'png', fromSurface:true, captureBeyondViewport:false });
  const shotFile = path.join(evidenceDir, 'lumifield-runtime-brand.png');
  fs.writeFileSync(shotFile, Buffer.from(shot.data, 'base64'));
  screenshots.push({ file:path.basename(shotFile), bytes:fs.statSync(shotFile).size, sha256:sha256File(shotFile) });
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
    if (process.env.LF_V1144_P21_STATIC_ONLY !== '1') await runtimeChecks();
  } catch (caught) {
    error = caught; process.exitCode = 1;
  } finally {
    await stopApp();
    const result = { task:'v1.1.44-problem-21-brand-separation', mode:process.env.LF_V1144_P21_STATIC_ONLY === '1' ? 'STATIC_ONLY' : 'SOURCE_ELECTRON_TARGETED', status:error ? 'FAIL' : 'PASS', checkCount:Object.keys(checks).length, checks, screenshots, rendererErrors, consoleErrors, appLog, error:error ? String(error.stack || error) : null };
    const resultPath = path.join(evidenceDir, 'result.json'); fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    process.stdout.write(`${JSON.stringify({ status:result.status, mode:result.mode, checkCount:result.checkCount, evidenceDir, resultSha256:sha256File(resultPath) }, null, 2)}\n`);
  }
})();
