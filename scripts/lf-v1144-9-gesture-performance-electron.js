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
const evidenceDir = path.join(repo, 'test-results', 'lf-v1144-9-gesture-performance', runId);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-v1144-9-'));
const checks = {};
const rendererErrors = [];
const consoleErrors = [];
const appLog = [];
let app = null;
let cdp = null;

fs.mkdirSync(evidenceDir, { recursive:true });
fs.mkdirSync(path.join(userData, 'migrations'), { recursive:true });
fs.writeFileSync(path.join(userData, 'migrations', 'legacy-upstream-platform-session-v2.json'), JSON.stringify({ version:2, validated:true, testIsolation:true, results:[] }, null, 2), { encoding:'utf8', mode:0o600 });

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex').toUpperCase(); }
function fileSha256(file) { return sha256(fs.readFileSync(file)); }
function pass(name, condition, detail) { assert.ok(condition, `${name}: ${JSON.stringify(detail)}`); checks[name] = detail == null ? true : detail; }
function section(source, startText, endText) {
  const start = source.indexOf(startText);
  assert.ok(start >= 0, `missing ${startText}`);
  const end = source.indexOf(endText, start + startText.length);
  return source.slice(start, end < 0 ? source.length : end);
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
async function waitFor(fn, timeout = 30000, interval = 50) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeout) {
    try { last = await fn(); if (last) return last; }
    catch (error) { last = String(error && error.message || error); }
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
  }
  send(method, params, timeout = 30000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params:params || {} }));
    });
  }
  async evaluate(expression, timeout = 30000) {
    const response = await this.send('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true, userGesture:true }, timeout);
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception && response.exceptionDetails.exception.description || response.exceptionDetails.text);
    return response.result && response.result.value;
  }
  close() { try { this.ws.close(); } catch (_) {} }
}

function staticChecks() {
  const index = fs.readFileSync(path.join(repo, 'public', 'index.html'), 'utf8');
  const gesture = section(index, 'var gestureVideo = null', 'function resizeHandCanvas()');
  const smoothing = section(index, 'function smoothLandmarks(lm)', 'function palmCenter(lm)');
  pass('camera callback only offers a frame and never awaits inference', /onFrame:\s*function\(\)\{\s*offerGestureFrame\(\);\s*\}/.test(gesture) && !/onFrame:\s*async/.test(gesture) && !/await\s+gestureHands\.send/.test(gesture), true);
  pass('inference stays capped near twelve frames per second', /GESTURE_FRAME_INTERVAL_MS\s*=\s*84/.test(gesture) && /now\s*-\s*gestureLastSendAt\s*<\s*GESTURE_FRAME_INTERVAL_MS/.test(gesture), true);
  pass('background task submission is decoupled and has a bounded starvation fallback', /scheduler\.postTask\(run,\s*\{\s*priority:\s*'background'/.test(gesture) && /setTimeout\(run,\s*24\)/.test(gesture) && /setTimeout\(run,\s*0\)/.test(gesture), true);
  pass('every scheduled task has an identity token so an old callback cannot cancel a new frame', /scheduledToken:\s*null/.test(gesture) && /gestureRuntime\.scheduledToken\s*!==\s*scheduleToken/.test(gesture) && /serial:\s*\+\+gestureRuntime\.scheduleSerial/.test(gesture), true);
  pass('one shared in-flight promise drops busy frames', /if\s*\(gestureRuntime\.inFlight\s*\|\|\s*gestureRuntime\.scheduled\s*\|\|\s*gestureSendBusy\)/.test(gesture) && /maxInFlight/.test(gesture), true);
  pass('session and visibility generations reject stale results', /sessionEpoch\s*!==\s*gestureRuntime\.epoch/.test(gesture) && /visibilityGeneration\s*!==\s*gestureRuntime\.visibilityGeneration/.test(gesture) && /GESTURE_RESULT_MAX_AGE_MS\s*=\s*500/.test(gesture), true);
  pass('page visibility and desktop state pause gesture processing', /document\.addEventListener\('visibilitychange',\s*syncGestureVisibility\)/.test(index) && /syncGestureVisibility\(\)/.test(section(index, 'function updateDesktopRuntimeState', 'function installRenderPowerHooks')), true);
  pass('shutdown closes Camera Hands tracks and detached video state within a bounded grace period', /cameraRuntime\.stop\(\)/.test(gesture) && /track\.stop\(\)/.test(gesture) && /hands\.close\(\)/.test(gesture) && /GESTURE_CLOSE_GRACE_MS\s*=\s*800/.test(gesture) && /video\.pause\(\)/.test(gesture) && /video\.srcObject\s*=\s*null/.test(gesture), true);
  pass('page lifecycle invokes the same complete shutdown path', /addEventListener\('pagehide',\s*stopGestureControl\)/.test(gesture) && /addEventListener\('beforeunload',\s*stopGestureControl\)/.test(gesture), true);
  pass('landmark smoothing is time-aware and bounded', /1\s*-\s*Math\.exp\(-dt\s*\/\s*HAND_SMOOTH_TAU_MS\)/.test(smoothing) && /0\.18,\s*0\.55/.test(smoothing), true);
  pass('read-only performance evidence exposes concurrency latency drops and resources', /Object\.freeze\(\{[\s\S]*getDebug:\s*getGesturePerformanceDebug/.test(gesture) && /droppedStale/.test(gesture) && /averageInferenceMs/.test(gesture) && /tracksLive/.test(gesture), true);
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
    env:Object.assign({}, process.env, { NODE_PATH:dependencyRoot, LF_MASTER_TEST:'1', LUMIFIELD_SKIP_SPLASH:'1', ELECTRON_DISABLE_SECURITY_WARNINGS:'true' })
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
  await waitFor(() => cdp.evaluate(`document.readyState==='complete'&&!!window.LumiFieldGesturePerformance&&typeof window.startGestureControl==='function'`), 60000);
  await delay(1200);
}

async function exerciseRuntime() {
  const runtime = await cdp.evaluate(`(async()=>{
    stopGestureControl();
    await new Promise(resolve=>setTimeout(resolve,30));
    document.body.classList.remove('empty-home-active');
    emptyHomeActive=false;
    homeForcedOpen=false;
    desktopRuntimeState.minimized=false;
    desktopRuntimeState.visible=true;
    const originalLoad=window.loadScriptOnce;
    const OriginalHands=window.Hands;
    const OriginalCamera=window.Camera;
    const harness={instances:[],pending:[],cameras:[],tracks:[],deferCameraStart:false,startResolvers:[],clicks:0,forcedHidden:false};
    const originalGesturePagePaused=gesturePagePaused;
    gesturePagePaused=()=>harness.forcedHidden;
    function makeLandmarks(offset){
      const points=Array.from({length:21},(_,i)=>({x:.50+(i%4)*.012+(offset||0),y:.46+Math.floor(i/4)*.018,z:0}));
      points[0]={x:.50+(offset||0),y:.62,z:0};
      points[4]={x:.44+(offset||0),y:.30,z:0};
      points[5]={x:.42+(offset||0),y:.51,z:0};
      points[8]={x:.43+(offset||0),y:.25,z:0};
      points[9]={x:.48+(offset||0),y:.50,z:0};
      points[12]={x:.48+(offset||0),y:.22,z:0};
      points[13]={x:.54+(offset||0),y:.51,z:0};
      points[16]={x:.55+(offset||0),y:.24,z:0};
      points[17]={x:.60+(offset||0),y:.52,z:0};
      points[20]={x:.62+(offset||0),y:.27,z:0};
      return points;
    }
    class FakeHands {
      constructor(){ this.handler=null;this.closeCount=0;this.options=null;harness.instances.push(this); }
      setOptions(value){ this.options=value; }
      onResults(handler){ this.handler=handler; }
      send(){
        const owner=this;
        return new Promise((resolve,reject)=>harness.pending.push({owner,resolve,reject}));
      }
      close(){ this.closeCount++; return Promise.resolve(); }
    }
    class FakeCamera {
      constructor(video,options){ this.video=video;this.options=options;this.stopCount=0;harness.cameras.push(this); }
      start(){
        const track={enabled:true,stopped:false,get readyState(){return this.stopped?'ended':'live';},stop(){this.stopped=true;this.enabled=false;}};
        harness.tracks.push(track);
        Object.defineProperty(this.video,'srcObject',{configurable:true,writable:true,value:{getTracks:()=>[track]}});
        if (!harness.deferCameraStart) return Promise.resolve();
        return new Promise(resolve=>harness.startResolvers.push(resolve));
      }
      stop(){ this.stopCount++; }
    }
    function settleNext(offset){
      const item=harness.pending.shift();
      if(!item) return false;
      item.owner.handler({multiHandLandmarks:[makeLandmarks(offset||0)]});
      item.resolve();
      return true;
    }
    window.loadScriptOnce=()=>Promise.resolve();
    window.Hands=FakeHands;
    window.Camera=FakeCamera;
    fx.cam='gesture';
    const started=await startGestureControl();
    const firstCamera=harness.cameras[0];
    const firstTrack=harness.tracks[0];
    const offerStartedAt=performance.now();
    for(let i=0;i<100;i++) firstCamera.options.onFrame();
    const offerDurationMs=performance.now()-offerStartedAt;
    for(let i=0;i<50&&!harness.pending.length;i++) await new Promise(resolve=>setTimeout(resolve,10));
    const afterBurst=window.LumiFieldGesturePerformance.getDebug();
    const button=document.createElement('button');
    button.addEventListener('click',()=>harness.clicks++);
    document.body.appendChild(button);
    button.click();
    const heartbeatStartedAt=performance.now();
    let timerFired=0;
    await new Promise(resolve=>setTimeout(()=>{timerFired=1;resolve();},0));
    const heartbeatWhilePending={clicks:harness.clicks,timerFired,pending:harness.pending.length,offerDurationMs,heartbeatMs:performance.now()-heartbeatStartedAt};
    settleNext(0);
    await new Promise(resolve=>setTimeout(resolve,30));
    const afterFirst=window.LumiFieldGesturePerformance.getDebug();

    harness.forcedHidden=true;
    syncGestureVisibility();
    await new Promise(resolve=>setTimeout(resolve,100));
    firstCamera.options.onFrame();
    await new Promise(resolve=>setTimeout(resolve,20));
    const whileHidden=window.LumiFieldGesturePerformance.getDebug();
    const hiddenTrackEnabled=firstTrack.enabled;
    harness.forcedHidden=false;
    syncGestureVisibility();
    await new Promise(resolve=>setTimeout(resolve,100));
    firstCamera.options.onFrame();
    await new Promise(resolve=>setTimeout(resolve,20));
    const beforeStale=window.LumiFieldGesturePerformance.getDebug();
    const oldHands=harness.instances[0];
    const oldCamera=harness.cameras[0];
    stopGestureControl();
    fx.cam='gesture';
    const restarted=await startGestureControl();
    const newCamera=harness.cameras[1];
    const appliedBeforeOld=window.LumiFieldGesturePerformance.getDebug().resultsApplied;
    settleNext(.06);
    await new Promise(resolve=>setTimeout(resolve,35));
    const afterOld=window.LumiFieldGesturePerformance.getDebug();
    await new Promise(resolve=>setTimeout(resolve,90));
    newCamera.options.onFrame();
    await new Promise(resolve=>setTimeout(resolve,20));
    settleNext(.02);
    await new Promise(resolve=>setTimeout(resolve,35));
    const afterNew=window.LumiFieldGesturePerformance.getDebug();
    const secondTrack=harness.tracks[1];
    const secondHands=harness.instances[1];
    const secondCamera=harness.cameras[1];
    stopGestureControl();
    await new Promise(resolve=>setTimeout(resolve,35));
    const afterStop=window.LumiFieldGesturePerformance.getDebug();

    harness.deferCameraStart=true;
    fx.cam='gesture';
    const racingStart=startGestureControl();
    await new Promise(resolve=>setTimeout(resolve,20));
    const raceHands=harness.instances[2];
    const raceCamera=harness.cameras[2];
    const raceTrack=harness.tracks[2];
    stopGestureControl();
    harness.startResolvers.splice(0).forEach(resolve=>resolve());
    const raceResult=await racingStart;
    await new Promise(resolve=>setTimeout(resolve,35));
    const afterRace=window.LumiFieldGesturePerformance.getDebug();

    handLmSmooth=null;handLmSmoothAt=0;
    const raw=[];const filtered=[];
    for(let i=0;i<18;i++){
      const source=makeLandmarks((i%2?1:-1)*.035);
      raw.push(1-source[0].x);
      filtered.push(smoothLandmarks(source)[0].x);
    }
    const variance=values=>{const mean=values.reduce((a,b)=>a+b,0)/values.length;return values.reduce((a,b)=>a+(b-mean)*(b-mean),0)/values.length;};
    handLmSmooth=null;handLmSmoothAt=0;
    smoothLandmarks(makeLandmarks(-.18));
    let converged=0;
    for(let i=0;i<5;i++) converged=smoothLandmarks(makeLandmarks(.18))[0].x;
    const open=makeLandmarks(0);const palm=palmCenter(open);const openScore=handOpenness(open,palm);
    const fist=makeLandmarks(0);[8,12,16,20].forEach((idx,j)=>{fist[idx]={x:[.43,.48,.55,.60][j],y:.51,z:0};});
    const fistScore=handOpenness(fist,palmCenter(fist));

    button.remove();
    gesturePagePaused=originalGesturePagePaused;
    window.loadScriptOnce=originalLoad;
    window.Hands=OriginalHands;
    window.Camera=OriginalCamera;
    fx.cam='off';
    return {
      started,restarted,afterBurst,heartbeatWhilePending,afterFirst,whileHidden,hiddenTrackEnabled,
      beforeStale,appliedBeforeOld,afterOld,afterNew,afterStop,raceResult,afterRace,
      resources:{
        old:{cameraStops:oldCamera.stopCount,handsCloses:oldHands.closeCount,trackStopped:firstTrack.stopped},
        second:{cameraStops:secondCamera.stopCount,handsCloses:secondHands.closeCount,trackStopped:secondTrack.stopped},
        race:{cameraStops:raceCamera.stopCount,handsCloses:raceHands.closeCount,trackStopped:raceTrack.stopped},
        videos:document.querySelectorAll('video[style*="display: none"]').length
      },
      smoothing:{rawVariance:variance(raw),filteredVariance:variance(filtered),converged,alpha:gestureRuntime.stats.lastSmoothingAlpha},
      gestures:{openScore,fistScore}
    };
  })()`, 60000);

  pass('fake camera session starts without loading the network model', runtime.started && runtime.restarted, runtime);
  pass('one hundred burst frames submit exactly one inference with maximum concurrency one', runtime.afterBurst.submitted === 1 && runtime.afterBurst.inFlight && runtime.afterBurst.maxInFlight === 1 && runtime.afterBurst.droppedBusy >= 99, runtime.afterBurst);
  pass('camera burst returns promptly and pending inference leaves input and the event loop responsive', runtime.heartbeatWhilePending.clicks === 1 && runtime.heartbeatWhilePending.timerFired === 1 && runtime.heartbeatWhilePending.pending === 1 && runtime.heartbeatWhilePending.offerDurationMs < 20 && runtime.heartbeatWhilePending.heartbeatMs < 250, runtime.heartbeatWhilePending);
  pass('a current result applies exactly once and records bounded latency', runtime.afterFirst.resultsApplied === 1 && runtime.afterFirst.completed === 1 && runtime.afterFirst.lastInferenceMs > 0, runtime.afterFirst);
  pass('hidden-state synchronization disables the live track and drops frames without submitting', runtime.whileHidden.paused && !runtime.hiddenTrackEnabled && runtime.whileHidden.submitted === runtime.afterFirst.submitted && runtime.whileHidden.droppedHidden >= 1, runtime.whileHidden);
  pass('restoring visibility re-enables inference and never overlaps the pending request', runtime.beforeStale.submitted === 2 && runtime.beforeStale.inFlight && runtime.beforeStale.maxInFlight === 1, runtime.beforeStale);
  pass('an old delayed result after stop and restart is discarded as stale', runtime.afterOld.resultsApplied === runtime.appliedBeforeOld && runtime.afterOld.droppedStale >= 1, runtime.afterOld);
  pass('the replacement session accepts its own next frame normally', runtime.afterNew.resultsApplied === runtime.appliedBeforeOld + 1 && runtime.afterNew.maxInFlight === 1, runtime.afterNew);
  pass('normal shutdown stops Camera track Hands video and leaves no work active', runtime.resources.second.cameraStops >= 1 && runtime.resources.second.trackStopped && runtime.resources.second.handsCloses === 1 && !runtime.afterStop.active && !runtime.afterStop.inFlight && runtime.afterStop.tracksLive === 0 && !runtime.afterStop.videoAttached, { resources:runtime.resources.second, debug:runtime.afterStop });
  pass('shutdown during asynchronous Camera start cannot revive the old session', runtime.raceResult === false && runtime.resources.race.cameraStops >= 1 && runtime.resources.race.trackStopped && runtime.resources.race.handsCloses === 1 && !runtime.afterRace.active && runtime.afterRace.phase === 'idle', { resources:runtime.resources.race, debug:runtime.afterRace });
  pass('time-aware landmark filtering reduces injected coordinate jitter', runtime.smoothing.filteredVariance < runtime.smoothing.rawVariance * 0.45 && runtime.smoothing.alpha >= 0.18 && runtime.smoothing.alpha <= 0.55, runtime.smoothing);
  pass('smoothing follows a large movement within five frames without losing gesture response', runtime.smoothing.converged < 0.5 && runtime.gestures.openScore > 0.62 && runtime.gestures.fistScore < 0.32, { smoothing:runtime.smoothing, gestures:runtime.gestures });
  pass('all three lifecycle sessions release every owned resource exactly once', runtime.resources.old.cameraStops >= 1 && runtime.resources.old.trackStopped && runtime.resources.old.handsCloses === 1 && runtime.resources.videos === 0, runtime.resources);
}

async function cleanup() {
  if (cdp) cdp.close();
  if (app && !app.killed) { try { app.kill(); } catch (_) {} await delay(700); }
}

(async () => {
  let failure = null;
  try {
    staticChecks();
    if (process.env.LF_V1144_P9_STATIC_ONLY !== '1') {
      await startApp();
      await exerciseRuntime();
      pass('renderer and console stayed free of errors', rendererErrors.length === 0 && consoleErrors.length === 0, { rendererErrors, consoleErrors });
    }
  } catch (error) {
    failure = error;
  } finally {
    await cleanup();
  }
  const result = {
    task:'LumiField v1.1.44 Problem 9 gesture performance',
    status:failure ? 'FAIL' : 'PASS',
    mode:process.env.LF_V1144_P9_STATIC_ONLY === '1' ? 'STATIC_ONLY' : 'SOURCE_ELECTRON_TARGETED',
    checks,
    rendererErrors,
    consoleErrors,
    appLog,
    productSha256:{ index:fileSha256(path.join(repo, 'public', 'index.html')) },
    testSha256:fileSha256(__filename),
    generatedAt:new Date().toISOString(),
    failure:failure ? String(failure.stack || failure) : null
  };
  fs.writeFileSync(path.join(evidenceDir, failure ? 'failure.json' : 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status:result.status, checks:Object.keys(checks).length, rendererErrors:rendererErrors.length, consoleErrors:consoleErrors.length, evidenceDir, failure:result.failure }, null, 2));
  if (failure) process.exitCode = 1;
})();
