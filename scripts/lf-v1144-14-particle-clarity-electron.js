'use strict';

const assert=require('assert');
const crypto=require('crypto');
const fs=require('fs');
const net=require('net');
const os=require('os');
const path=require('path');
const {spawn,spawnSync}=require('child_process');

const repo=path.resolve(__dirname,'..');
const dependencyRoot=process.env.LF_DEPENDENCY_ROOT||path.join(repo,'node_modules');
const electronExe=path.join(dependencyRoot,'electron','dist','electron.exe');
const referenceVideo='D:\\HuaweiMoveData\\Users\\35992\\Desktop\\文件13\\粒子预设.星轨.mp4';
const ffmpegExe=[process.env.LF_FFMPEG_PATH,'D:\\LumiField\\resources\\app.asar.unpacked\\node_modules\\ffmpeg-static\\ffmpeg.exe','C:\\Program Files\\eIsland\\resources\\ffmpeg\\ffmpeg.exe'].find(file=>file&&fs.existsSync(file));
const evidenceDir=path.join(repo,'test-results','lf-v1144-14-particle-clarity',new Date().toISOString().replace(/[:.]/g,'-'));
const userData=fs.mkdtempSync(path.join(os.tmpdir(),'lf-v1144-14-'));
const checks={};const rendererErrors=[];const consoleErrors=[];const screenshots=[];const appLog=[];
let app=null;let cdp=null;
fs.mkdirSync(evidenceDir,{recursive:true});
fs.mkdirSync(path.join(userData,'migrations'),{recursive:true});
fs.writeFileSync(path.join(userData,'migrations','legacy-upstream-platform-session-v2.json'),JSON.stringify({version:2,validated:true,testIsolation:true,results:[]}),{mode:0o600});

function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function sha256File(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();}
function pass(name,condition,detail){assert.ok(condition,`${name}: ${JSON.stringify(detail)}`);checks[name]=detail==null?true:detail;}
async function waitFor(fn,timeout=30000,interval=50){const start=Date.now();let last=null;while(Date.now()-start<timeout){try{last=await fn();if(last)return last;}catch(error){last=String(error&&error.message||error);}await delay(interval);}throw new Error(`Timeout: ${JSON.stringify(last)}`);}
function freePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.unref();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(error=>error?reject(error):resolve(port));});});}

class CDP{
  constructor(url){this.url=url;this.id=0;this.pending=new Map();}
  async connect(){this.ws=new WebSocket(this.url);this.ws.onmessage=event=>{const message=JSON.parse(String(event.data));if(message.id&&this.pending.has(message.id)){const pending=this.pending.get(message.id);this.pending.delete(message.id);clearTimeout(pending.timer);if(message.error)pending.reject(new Error(message.error.message));else pending.resolve(message.result||{});return;}if(message.method==='Runtime.exceptionThrown'){const detail=message.params&&message.params.exceptionDetails||{};rendererErrors.push(String(detail.exception&&detail.exception.description||detail.text||'renderer exception'));}if(message.method==='Runtime.consoleAPICalled'&&message.params&&message.params.type==='error')consoleErrors.push((message.params.args||[]).map(item=>item.value||item.description||'').join(' '));};await new Promise((resolve,reject)=>{this.ws.onopen=resolve;this.ws.onerror=reject;});await this.send('Runtime.enable');await this.send('Page.enable');}
  send(method,params,timeout=30000){const id=++this.id;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},timeout);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params:params||{}}));});}
  async evaluate(expression){const response=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(response.exceptionDetails)throw new Error(response.exceptionDetails.exception&&response.exceptionDetails.exception.description||response.exceptionDetails.text);return response.result&&response.result.value;}
  async screenshot(name){const response=await this.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});const file=path.join(evidenceDir,name);fs.writeFileSync(file,Buffer.from(response.data,'base64'));screenshots.push({file:path.basename(file),bytes:fs.statSync(file).size,sha256:sha256File(file)});}
  close(){try{this.ws.close();}catch(_){} }
}

function staticChecks(){
  const index=fs.readFileSync(path.join(repo,'public','index.html'),'utf8');
  const fixes=fs.readFileSync(path.join(repo,'public','lumifield-fixes-v2.js'),'utf8');
  pass('highest quality uses a real 2x cap, a 1x floor and a twelve megapixel budget',/quality === 'ultra'\) return \{ cap: 2\.0, min: 1\.0, budget: 12000000 \}/.test(index),true);
  pass('highest quality keeps the final backing scale at or above one',index.includes("var finalFloor = normalizePerformanceQuality(fx && fx.performanceQuality) === 'ultra'")&&index.includes('? Math.min(device, 1)'),true);
  pass('the default framebuffer explicitly requests MSAA',/new THREE\.WebGLRenderer\(\{ antialias: true, alpha: true/.test(index),true);
  pass('main and bloom points have final CSS-pixel size limits',/min\(sz \* uPixel \* uPointScale, 10\.0 \* uPixel\)/.test(index)&&/min\(sz \* uPixel \* uPointScale \* uBloomSize, 18\.0 \* uPixel\)/.test(index),true);
  pass('loading mist can no longer multiply point size by more than 1.11',/loadingMistSize = 1\.0 \+ mistBreath \* 0\.04 \+ abs\(mistRibbon\) \* 0\.025 \+ glowPick \* 0\.045/.test(index)&&!/loadingMistSize = 1\.26/.test(index),true);
  pass('particle and cover textures use linear filtering',/tex\.minFilter = THREE\.LinearFilter; tex\.magFilter = THREE\.LinearFilter/.test(index)&&/coverTex\.minFilter = THREE\.LinearFilter; coverTex\.magFilter = THREE\.LinearFilter/.test(index),true);
  pass('main particle rendering stays on the direct framebuffer without CSS scale',/#canvas-container canvas\{display:block;width:100%!important;height:100%!important\}/.test(index)&&!/canvas-container[^\{]*\{[^\}]*transform\s*:\s*scale\(/.test(index),true);
  const clarity=fixes.slice(fixes.indexOf('function applyClarity'),fixes.indexOf('function injectTopControls'));
  pass('clarity controls have one authoritative renderer resize path',/if \(typeof window\.setPerformanceQualityMode === 'function'\)[\s\S]*?\} else \{/.test(clarity)&&/uniforms\.uPixel\.value = renderer\.getPixelRatio\(\)/.test(clarity),true);
  pass('quality debug declares no FXAA, post-processing or motion blur',/postProcessing:false,[\s\S]*?fxaa:false,[\s\S]*?motionBlur:false/.test(index),true);
}

function mediaChecks(){
  pass('the authoritative star-track video exists',fs.existsSync(referenceVideo),referenceVideo);
  pass('a fixed local ffmpeg binary is available for full-frame validation',!!ffmpegExe,ffmpegExe||null);
  const decode=spawnSync(ffmpegExe,['-hide_banner','-loglevel','info','-i',referenceVideo,'-map','0:v:0','-vf','showinfo','-fps_mode','passthrough','-an','-f','framemd5','-'],{encoding:'utf8',maxBuffer:64*1024*1024});
  const pts=[...String(decode.stderr||'').matchAll(/\bn:\s*(\d+)\s+pts:\s*\d+\s+pts_time:([0-9.]+)/g)].map(match=>({n:Number(match[1]),pts:Number(match[2])}));
  pass('all 933 frames are present in strictly increasing presentation order',pts.length===933&&pts.every((item,index)=>item.n===index&&(index===0||item.pts>pts[index-1].pts)),{count:pts.length,first:pts[0],last:pts[pts.length-1]});
  const decoded=decode.stdout.split(/\r?\n/).filter(line=>line&&line[0]!=='#').length;
  pass('ffmpeg fully decodes and hashes all 933 reference frames',decode.status===0&&decoded===933,{status:decode.status,frames:decoded,sha256:sha256File(referenceVideo)});
}

async function listTargets(port){return(await fetch(`http://127.0.0.1:${port}/json/list`)).json();}
async function startApp(){
  assert.ok(fs.existsSync(electronExe),`Electron not found: ${electronExe}`);const port=await freePort();
  app=spawn(electronExe,['.',`--user-data-dir=${userData}`,`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1'],{cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe'],env:Object.assign({},process.env,{NODE_PATH:dependencyRoot,LF_MASTER_TEST:'1',LUMIFIELD_SKIP_SPLASH:'1',ELECTRON_DISABLE_SECURITY_WARNINGS:'true'})});
  const collect=data=>appLog.push(String(data));app.stdout.on('data',collect);app.stderr.on('data',collect);
  const target=await waitFor(async()=>{const targets=await listTargets(port);return targets.find(item=>item.type==='page'&&/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?(?:index\.html)?$/i.test(item.url));},60000);
  cdp=new CDP(target.webSocketDebuggerUrl);await cdp.connect();
  await waitFor(()=>cdp.evaluate(`document.readyState==='complete'&&!!window.LumiFieldParticleQuality&&typeof window.setPerformanceQualityMode==='function'`),60000);
}

async function qualitySample(mode){
  return cdp.evaluate(`(async()=>{document.body.classList.remove('render-deep-sleep');setPerformanceQualityMode(${JSON.stringify(mode)},true);applyRendererPowerMode();await new Promise(r=>setTimeout(r,120));const d=LumiFieldParticleQuality.getDebug(),containerTransform=getComputedStyle(document.getElementById('canvas-container')).transform,m=new DOMMatrix(containerTransform);return Object.assign(d,{uPixel:uniforms.uPixel.value,containerTransform,containerScaleX:Math.hypot(m.m11,m.m12,m.m13),containerScaleY:Math.hypot(m.m21,m.m22,m.m23),canvasTransform:getComputedStyle(renderer.domElement).transform});})()`);
}

async function runtimeChecks(){
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:2,mobile:false,screenWidth:1280,screenHeight:720});
  const profiles={};for(const mode of ['eco','balanced','high','ultra'])profiles[mode]=await qualitySample(mode);
  pass('quality backing resolutions increase monotonically',profiles.eco.canvasWidth<profiles.balanced.canvasWidth&&profiles.balanced.canvasWidth<profiles.high.canvasWidth&&profiles.high.canvasWidth<profiles.ultra.canvasWidth,profiles);
  pass('ultra renders at full device DPR without CSS upscaling',Math.abs(profiles.ultra.renderPixelRatio-2)<0.01&&!profiles.ultra.cssUpscaled&&profiles.ultra.canvasWidth===2560&&profiles.ultra.canvasHeight===1440,profiles.ultra);
  pass('MSAA is active in the live WebGL context',profiles.ultra.antialias===true,profiles.ultra);
  pass('renderer DPR and particle uPixel remain identical in every quality mode',Object.values(profiles).every(item=>Math.abs(item.renderPixelRatio-item.uPixel)<0.001),profiles);
  pass('the live particle canvas has no CSS transform scale',Math.abs(profiles.ultra.containerScaleX-1)<0.001&&Math.abs(profiles.ultra.containerScaleY-1)<0.001&&profiles.ultra.canvasTransform==='none',profiles.ultra);

  const clarity=await cdp.evaluate(`(async()=>{const button=document.querySelector('[data-lf-clarity="ultra"]');if(button)button.click();await new Promise(r=>setTimeout(r,120));return LumiFieldParticleQuality.getDebug();})()`);
  pass('the public clarity control preserves the authoritative ultra backing resolution',clarity.quality==='ultra'&&Math.abs(clarity.renderPixelRatio-2)<0.01&&!clarity.cssUpscaled,clarity);

  const stress=await cdp.evaluate(`(()=>{const original={point:fx.point,scatter:fx.scatter,preset:fx.preset,loading:uniforms.uLoading.value};const before={uuid:geo.uuid,count:geo.getAttribute('position').count};fx.point=8;fx.scatter=0;uniforms.uLoading.value=1;for(let i=0;i<50;i++){setPreset(i%7,{silent:true,noSave:true,preserveAudioEcho:true});uniforms.uTime.value+=0.4;tickPresetTransition();}setPreset(original.preset,{silent:true,noSave:true,skipTransition:true,preserveAudioEcho:true});fx.point=original.point;fx.scatter=original.scatter;uniforms.uLoading.value=0;syncFxUniforms();const d=LumiFieldParticleQuality.getDebug();return{before,after:{uuid:geo.uuid,count:geo.getAttribute('position').count},debug:d,mainClamp:/10\\.0 \\* uPixel/.test(material.vertexShader),bloomClamp:/18\\.0 \\* uPixel/.test(bloomMaterial.vertexShader),transition:presetTransition.active};})()`);
  pass('maximum point scale and fifty preset transitions cannot create oversized meshes',stress.mainClamp&&stress.bloomClamp&&stress.debug.mainPointLimitCss===10&&stress.debug.bloomPointLimitCss===18&&stress.before.uuid===stress.after.uuid&&stress.before.count===stress.after.count&&!stress.transition&&stress.debug.loading===0,stress);
  pass('render state is clean after the stress sequence',stress.debug.pointScale<=8&&stress.debug.geometryCount===stress.before.count&&Number.isFinite(stress.debug.renderPixelRatio),stress.debug);

  await cdp.evaluate(`(()=>{document.querySelectorAll('.modal-mask,#lf-auth-root,#visual-guide').forEach(n=>{n.classList.remove('show','active');n.style.setProperty('display','none','important');});document.body.classList.remove('empty-home-active','lf-auth-locked','visual-guide-active','render-deep-sleep');setPreset(5,{silent:true,noSave:true,skipTransition:true,preserveAudioEcho:true});uniforms.uAlpha.value=1;applyRendererPowerMode();return true;})()`);
  await delay(350);await cdp.screenshot('particle-ultra-dpr2.png');
  pass('renderer and console errors remain zero',rendererErrors.length===0&&consoleErrors.length===0,{rendererErrors,consoleErrors});
}

async function stopApp(){if(cdp){cdp.close();cdp=null;}if(app&&!app.killed){app.kill();await Promise.race([new Promise(resolve=>app.once('exit',resolve)),delay(4000)]);}app=null;}
(async()=>{let error=null;try{staticChecks();mediaChecks();if(process.env.LF_V1144_14_STATIC_ONLY!=='1'){await startApp();await runtimeChecks();}}catch(caught){error=caught;process.exitCode=1;}finally{await stopApp();const result={task:'v1.1.44-problem-14',status:error?'FAIL':'PASS',checks,checkCount:Object.keys(checks).length,rendererErrors,consoleErrors,screenshots,referenceVideo:{path:referenceVideo,sha256:fs.existsSync(referenceVideo)?sha256File(referenceVideo):null},appLog,error:error?String(error.stack||error):null};fs.writeFileSync(path.join(evidenceDir,'result.json'),JSON.stringify(result,null,2));process.stdout.write(`${JSON.stringify({status:result.status,checkCount:result.checkCount,evidenceDir},null,2)}\n`);}})();
