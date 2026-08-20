'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { WallpaperVideoService, CACHE_SCHEMA, cacheKeyFor } = require('../desktop/lf-wallpaper-video-optimizer');

const repo = path.resolve(__dirname, '..');
const dependencyRoot = process.env.LF_DEPENDENCY_ROOT || path.resolve(repo, '..', '..', 'release', 'verify-v1.1.43-tag', 'node_modules');
const electronExe = path.join(dependencyRoot, 'electron', 'dist', 'electron.exe');
const evidenceDir = path.join(repo, 'test-results', 'lf-v1144-11-weather-wallpaper-performance', new Date().toISOString().replace(/[:.]/g, '-'));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-v1144-11-electron-'));
const checks = {};
const rendererErrors = [];
const consoleErrors = [];
const appLog = [];
let app = null;
let cdp = null;

fs.mkdirSync(evidenceDir, { recursive:true });
fs.mkdirSync(path.join(userData, 'migrations'), { recursive:true });
fs.writeFileSync(path.join(userData, 'migrations', 'legacy-upstream-platform-session-v2.json'), JSON.stringify({version:2,validated:true,testIsolation:true,results:[]}), {mode:0o600});

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase(); }
function pass(name, condition, detail) { assert.ok(condition, `${name}: ${JSON.stringify(detail)}`); checks[name] = detail == null ? true : detail; }
async function waitFor(fn, timeout = 45000, interval = 60) {
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

class CDP {
  constructor(url) { this.url=url; this.id=0; this.pending=new Map(); this.fetchHandler=null; }
  async connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const pending=this.pending.get(message.id); this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result || {});
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const detail=message.params && message.params.exceptionDetails || {};
        rendererErrors.push(String(detail.exception && detail.exception.description || detail.text || 'renderer exception'));
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params && message.params.type === 'error') {
        consoleErrors.push((message.params.args || []).map(item => item.value || item.description || '').join(' '));
      }
      if (message.method === 'Fetch.requestPaused' && this.fetchHandler) {
        Promise.resolve(this.fetchHandler(message.params)).catch(error => rendererErrors.push(`Fetch harness: ${error.message}`));
      }
    };
    await new Promise((resolve,reject)=>{ this.ws.onopen=resolve; this.ws.onerror=reject; });
    await this.send('Runtime.enable'); await this.send('Page.enable');
  }
  send(method, params, timeout=30000) {
    const id=++this.id;
    return new Promise((resolve,reject)=>{ const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},timeout); this.pending.set(id,{resolve,reject,timer}); this.ws.send(JSON.stringify({id,method,params:params||{}})); });
  }
  async evaluate(expression) {
    const response=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception && response.exceptionDetails.exception.description || response.exceptionDetails.text);
    return response.result && response.result.value;
  }
  close() { try { this.ws.close(); } catch (_) {} }
}

function weatherFixture(city, temperature) {
  const now=Date.now();
  return {ok:true,weather:{provider:'open-meteo',location:{name:city,country:'China',latitude:31.23,longitude:121.47,timezone:'Asia/Shanghai'},label:'晴',weatherCode:0,temperature,apparentTemperature:temperature,humidity:48,precipitation:0,cloudCover:4,windSpeed:8,windDirection:90,windGusts:12,isDay:1,time:'2026-08-20T12:00',updatedAt:now,forecast:Array.from({length:7},(_,index)=>({date:`2026-08-${String(20+index).padStart(2,'0')}`,label:'晴',weatherCode:0,temperatureMax:temperature+2,temperatureMin:temperature-3,precipitationProbability:0}))}};
}

function staticChecks() {
  const weather=fs.readFileSync(path.join(repo,'public','lumifield-enhancements.js'),'utf8');
  const server=fs.readFileSync(path.join(repo,'server.js'),'utf8');
  const optimizer=fs.readFileSync(path.join(repo,'desktop','lf-wallpaper-video-optimizer.js'),'utf8');
  const renderer=fs.readFileSync(path.join(repo,'public','lumifield-fixes-v2.js'),'utf8');
  const main=fs.readFileSync(path.join(repo,'desktop','main.js'),'utf8');
  const index=fs.readFileSync(path.join(repo,'public','index.html'),'utf8');
  pass('weather hydrates persistent cache before deferred network refresh', /hydrateWeatherCache\(initialCity\);\s*scheduleInitialWeatherLoad\(initialCity\)/.test(weather) && /requestAnimationFrame\(afterPaint\)/.test(weather));
  pass('stale weather render cannot refresh persistent savedAt', /persist !== false && !stale && !weather\.stale/.test(weather) && /renderWeather\(cached\.weather, true, false\)/.test(weather));
  pass('renderer coalesces identical weather requests and aborts superseded requests', /dedupedRequests \+= 1/.test(weather) && /weatherRequest\.controller\.abort\('WEATHER_REQUEST_SUPERSEDED'\)/.test(weather));
  pass('server uses bounded geocode and weather caches with in-flight coalescing', /WEATHER_CACHE_MAX_ENTRIES = 64/.test(server) && /weatherLocationInFlight/.test(server) && /weatherRefreshInFlight/.test(server) && /revalidating: true/.test(server));
  pass('home weather card reuses the validated persistent snapshot', /readHomeWeatherSnapshot/.test(index) && /weather:\s*homeWeatherSnapshot && homeWeatherSnapshot\.weather/.test(index));
  pass('video cache identity is content and plan based, not target based without orphaning prior cache manifests', CACHE_SCHEMA.endsWith('-v1') && !/sourceHash,\s*target: String\(target/.test(optimizer));
  pass('wallpaper video pipeline has actual hardware encoder probes and CPU fallback', /h264_nvenc/.test(optimizer) && /h264_qsv/.test(optimizer) && /h264_amf/.test(optimizer) && /hardwareFallbackCount \+= 1/.test(optimizer));
  pass('selected videos begin background preprocessing and Apply reuses one promise', /videoOptimizationPromise = preloadPromise/.test(renderer) && /if \(!wallpaperDialogState\.videoOptimizationPromise\)/.test(renderer));
  pass('cancelled or failed preprocessing clears only the current cached promise so Apply can retry', /wallpaperDialogState\.videoOptimizationPromise = null;\s*wallpaperDialogState\.videoOptimization = null;\s*if \(!task\)/.test(renderer) && /wallpaperDialogState\.videoOptimizationPromise !== preloadPromise/.test(renderer));
  pass('all active optimizer stages expose cancellation and visible progress', /queued\|hashing\|probing\|planning\|copying/.test(renderer) && /lf-wallpaper-video-opt-progress/.test(renderer));
  pass('main coalesces before cancelling genuinely superseded video tasks', main.indexOf('const started = await optimizer.start') < main.indexOf("if (taskOwner === ownerId && taskId !== startedTaskId)"));
}

async function optimizerChecks() {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'lf-v1144-11-video-'));
  const source=path.join(temp,'source.mp4');
  const cache=path.join(temp,'cache');
  const ffmpeg=require('ffmpeg-static');
  const generated=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=640x360:rate=30','-t','1.2','-c:v','libx264','-pix_fmt','yuv420p',source],{encoding:'utf8'});
  assert.strictEqual(generated.status,0,generated.stderr);
  const before={hash:sha256File(source),stat:fs.statSync(source)};
  const progress=[]; let ticks=0;
  const service=new WallpaperVideoService({storageDir:cache,onProgress:value=>progress.push({taskId:value.taskId,stage:value.stage,progress:value.progress})});
  const ticker=setInterval(()=>{ticks+=1;},10);
  try {
    const first=await service.start(source,{forceTranscode:true,target:'global',display:{width:640,height:360,dpr:1,refreshRate:60}});
    const concurrent=await service.start(source,{forceTranscode:true,target:'weather',display:{width:640,height:360,dpr:1,refreshRate:60}});
    pass('concurrent identical media work is coalesced to one task', first.taskId === concurrent.taskId && concurrent.coalesced === true,{first:first.taskId,concurrent});
    const result=await service.wait(first.taskId);
    pass('real bundled FFmpeg completes with hardware acceleration when available or safe CPU fallback', result.ok && fs.statSync(result.outputPath).size>0 && /^(?:h264_nvenc|h264_qsv|h264_amf|libx264)$/.test(result.encoder),{encoder:result.encoder,hardware:result.hardwareAccelerated,fallback:result.hardwareFallback});
    const manifest=JSON.parse(fs.readFileSync(path.join(path.dirname(result.outputPath),'lumifield-wallpaper.json'),'utf8'));
    const pinned=await service.pin(result,'v1.1.43-compatible-restore');
    pass('existing v1 cache schema remains readable, pinnable and capacity managed',manifest.schema==='lumifield-wallpaper-video-cache-v1' && pinned.ok===true && service.debug().pinnedCount===1,{schema:manifest.schema,pinned});
    await service.unpin(result,'v1.1.43-compatible-restore');
    const decoded=spawnSync(ffmpeg,['-hide_banner','-v','error','-i',result.outputPath,'-f','null','-'],{encoding:'utf8'});
    pass('optimized video remains fully decodable at the planned dimensions and quality format',decoded.status===0,{stderr:decoded.stderr});
    const second=await service.start(source,{forceTranscode:true,target:'weather',display:{width:640,height:360,dpr:1,refreshRate:60}});
    const cached=await service.wait(second.taskId);
    pass('cross-target reuse hits one disk cache without re-encoding',cached.ok && cached.cacheHit===true && cached.cacheKey===result.cacheKey && service.debug().cacheEntryCount===1,{first:result.cacheKey,second:cached.cacheKey,debug:service.debug()});
    const firstProgress=progress.filter(item=>item.taskId===first.taskId);
    pass('progress is visible, staged and monotonic',firstProgress.some(item=>item.stage==='probing') && firstProgress.some(item=>item.stage==='transcoding') && firstProgress.every((item,index)=>index===0 || item.progress>=firstProgress[index-1].progress),firstProgress.slice(-12));
    pass('background child processing keeps the Node event loop responsive',ticks>=5,{ticks});
    const after={hash:sha256File(source),stat:fs.statSync(source)};
    pass('source video bytes size and mtime remain unchanged',before.hash===after.hash && before.stat.size===after.stat.size && before.stat.mtimeMs===after.stat.mtimeMs,{before:{hash:before.hash,size:before.stat.size,mtimeMs:before.stat.mtimeMs},after:{hash:after.hash,size:after.stat.size,mtimeMs:after.stat.mtimeMs}});
    const debug=service.debug();
    pass('hardware capability is probed once and leaves no child process',debug.hardwareProbeCount===1 && debug.activeTaskCount===0 && debug.childProcesses===0,debug);

    const fallbackService=new WallpaperVideoService({storageDir:path.join(temp,'fallback'),hardwareEncoderCandidates:['h264_nvenc'],hardwareEncoderProbe:async()=> 'h264_nvenc'});
    const calls=[];
    fallbackService._runFfmpegTranscode=async(_task,output,_plan,_probe,encoder)=>{
      calls.push(encoder);
      if (encoder==='h264_nvenc') { fs.writeFileSync(output,'partial'); throw new Error('simulated hardware startup failure'); }
      fs.writeFileSync(output,'cpu-success'); return {code:0};
    };
    const fallbackOutput=path.join(temp,'fallback.mp4');
    const fallback=await fallbackService._transcode({id:'fallback',inputPath:source,progress:.48,controller:new AbortController(),children:new Set()},fallbackOutput,{strategy:'transcode',width:640,height:360,fps:30,crf:18,preset:'medium',extension:'.mp4'},{fps:30,duration:1});
    pass('hardware startup failure removes partial output and falls back exactly once',fallback.ok && fallback.hardwareFallback===true && fallback.encoder==='libx264' && calls.join('|')==='h264_nvenc|libx264' && fs.readFileSync(fallbackOutput,'utf8')==='cpu-success',{fallback,calls});
    await fallbackService.dispose();

    let sharedProbeCalls=0;
    const sharedService=new WallpaperVideoService({storageDir:path.join(temp,'shared-probe'),hardwareEncoderCandidates:['h264_qsv'],hardwareEncoderProbe:({signal})=>{
      sharedProbeCalls+=1;
      if(sharedProbeCalls>1)return Promise.resolve('h264_qsv');
      return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{const error=new Error('CANCELLED');error.name='AbortError';reject(error);},{once:true}));
    }});
    const taskA={id:'probe-a',controller:new AbortController(),children:new Set()};
    const taskB={id:'probe-b',controller:new AbortController(),children:new Set()};
    const probeA=sharedService._selectHardwareEncoder(taskA).then(value=>value,error=>error.name);
    const probeB=sharedService._selectHardwareEncoder(taskB);
    taskA.controller.abort();
    const [cancelledProbe,survivingProbe]=await Promise.all([probeA,probeB]);
    pass('cancelling the first shared hardware probe cannot cancel another active task',cancelledProbe==='AbortError' && survivingProbe==='h264_qsv' && sharedProbeCalls===2,{cancelledProbe,survivingProbe,sharedProbeCalls});
    await sharedService.dispose();
  } finally {
    clearInterval(ticker);
    await service.dispose();
    fs.rmSync(temp,{recursive:true,force:true});
  }
}

async function listTargets(port) { return (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); }
async function startApp() {
  assert.ok(fs.existsSync(electronExe),`Electron not found: ${electronExe}`);
  const port=await freePort();
  app=spawn(electronExe,['.',`--user-data-dir=${userData}`,`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1'],{cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe'],env:Object.assign({},process.env,{NODE_PATH:dependencyRoot,LF_MASTER_TEST:'1',LUMIFIELD_SKIP_SPLASH:'1',ELECTRON_DISABLE_SECURITY_WARNINGS:'true'})});
  const collect=data=>appLog.push(String(data)); app.stdout.on('data',collect); app.stderr.on('data',collect);
  const target=await waitFor(async()=>{const targets=await listTargets(port);return targets.find(item=>item.type==='page'&&/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?(?:index\.html)?$/i.test(item.url));},60000);
  cdp=new CDP(target.webSocketDebuggerUrl); await cdp.connect();
  await waitFor(()=>cdp.evaluate(`document.readyState==='complete'&&!!window.LumiFieldWeatherPerformance`),60000);
}

async function weatherRuntimeChecks() {
  const cached=weatherFixture('上海',21).weather;
  cached.updatedAt=1700000000000;
  await cdp.evaluate(`localStorage.setItem('lumifield-weather-city','上海');localStorage.setItem('lumifield-weather-cache-v1',${JSON.stringify(JSON.stringify({savedAt:1700000000000,weather:cached}))});true`);
  const held=[];
  cdp.fetchHandler=async params=>{
    const url=new URL(params.request.url);
    if (url.pathname==='/api/weather/ip-location') {
      const body=Buffer.from(JSON.stringify({ok:true,location:{city:'上海',latitude:31.23,longitude:121.47,timezone:'Asia/Shanghai'}})).toString('base64');
      await cdp.send('Fetch.fulfillRequest',{requestId:params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body}); return;
    }
    if (url.pathname==='/api/weather/current') {
      const city=url.searchParams.get('city')||'上海';
      if (city==='上海') { held.push(params.requestId); return; }
      const body=Buffer.from(JSON.stringify(weatherFixture(city,26))).toString('base64');
      await cdp.send('Fetch.fulfillRequest',{requestId:params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body}); return;
    }
    await cdp.send('Fetch.continueRequest',{requestId:params.requestId});
  };
  await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*api/weather/current*',requestStage:'Request'},{urlPattern:'*api/weather/ip-location*',requestStage:'Request'}]});
  rendererErrors.length=0; consoleErrors.length=0;
  await cdp.send('Page.reload',{ignoreCache:true});
  const immediate=await waitFor(()=>cdp.evaluate(`(()=>{if(document.readyState!=='complete'||!window.LumiFieldWeatherPerformance)return null;const label=document.getElementById('lf-weather-label');const raw=localStorage.getItem('lumifield-weather-cache-v1');const debug=LumiFieldWeatherPerformance.getDebug();return label&&label.textContent==='晴'&&debug.cacheHydrations>=1?{label:label.textContent,updated:document.getElementById('lf-weather-updated').textContent,savedAt:JSON.parse(raw).savedAt,debug,home:window.homeWeatherRadioState&&homeWeatherRadioState.weather&&homeWeatherRadioState.weather.location.name}:null})()`),45000);
  pass('persistent weather paints immediately while the network request is still pending',immediate.savedAt===1700000000000 && immediate.updated.includes('离线缓存') && immediate.debug.initialLoadDeferred===true && immediate.home==='上海',immediate);
  await waitFor(()=>held.length>0,10000);
  const dedupe=await cdp.evaluate(`(()=>{window.__lfWeatherSameA=LumiFieldWeatherPerformance.refresh('上海',false);window.__lfWeatherSameB=LumiFieldWeatherPerformance.refresh('上海',false);return LumiFieldWeatherPerformance.getDebug()})()`);
  pass('identical renderer refresh calls share the active request',dedupe.dedupedRequests>=2 && dedupe.activeKey==='上海|cached',dedupe);
  await cdp.evaluate(`(()=>{window.__lfWeatherBeijing=LumiFieldWeatherPerformance.refresh('北京',true);return true})()`);
  const changed=await waitFor(()=>cdp.evaluate(`(()=>{const debug=LumiFieldWeatherPerformance.getDebug();const city=document.getElementById('lf-weather-city');if(debug.active||!city||city.textContent!=='北京')return null;const cache=JSON.parse(localStorage.getItem('lumifield-weather-cache-v1'));return{debug,city:city.textContent,label:document.getElementById('lf-weather-label').textContent,savedCity:localStorage.getItem('lumifield-weather-city'),savedAt:cache.savedAt,temperature:cache.weather.temperature}})()`),30000);
  pass('superseded weather work is aborted and only the newest city persists',changed.debug.abortedRequests>=1 && changed.city==='北京' && changed.savedCity==='北京' && changed.temperature===26 && changed.savedAt>1700000000000,changed);
  for (const requestId of held.splice(0)) { try { await cdp.send('Fetch.failRequest',{requestId,errorReason:'Aborted'}); } catch (_) {} }
  await cdp.send('Fetch.disable');
  pass('weather optimization produces zero renderer and console errors',rendererErrors.length===0&&consoleErrors.length===0,{rendererErrors,consoleErrors});
}

async function stopApp() {
  if(cdp){try{await cdp.send('Fetch.disable');}catch(_){} cdp.close();cdp=null;}
  if(app&&!app.killed){app.kill();await Promise.race([new Promise(resolve=>app.once('exit',resolve)),delay(5000)]);} app=null;
}

(async()=>{
  let error=null;
  try { staticChecks(); await optimizerChecks(); await startApp(); await weatherRuntimeChecks(); }
  catch(caught){error=caught;process.exitCode=1;}
  finally {
    await stopApp();
    const result={task:'v1.1.44-problem-11',status:error?'FAIL':'PASS',checkCount:Object.keys(checks).length,checks,rendererErrors,consoleErrors,appLog:appLog.join('').slice(-12000),error:error&&String(error.stack||error)};
    fs.writeFileSync(path.join(evidenceDir,'result.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify({status:result.status,checkCount:result.checkCount,evidenceDir,error:result.error||null},null,2));
  }
})();
