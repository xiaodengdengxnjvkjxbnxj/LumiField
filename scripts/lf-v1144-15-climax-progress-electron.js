'use strict';

const assert=require('assert');
const crypto=require('crypto');
const fs=require('fs');
const net=require('net');
const os=require('os');
const path=require('path');
const vm=require('vm');
const {spawn}=require('child_process');

const repo=path.resolve(__dirname,'..');
const dependencyRoot=process.env.LF_DEPENDENCY_ROOT||path.join(repo,'node_modules');
const electronExe=path.join(dependencyRoot,'electron','dist','electron.exe');
const evidenceDir=path.join(repo,'test-results','lf-v1144-15-climax-progress',new Date().toISOString().replace(/[:.]/g,'-'));
const userData=fs.mkdtempSync(path.join(os.tmpdir(),'lf-v1144-15-'));
const checks={};const rendererErrors=[];const consoleErrors=[];const screenshots=[];const appLog=[];
let app=null;let cdp=null;
fs.mkdirSync(evidenceDir,{recursive:true});
fs.mkdirSync(path.join(userData,'migrations'),{recursive:true});
fs.writeFileSync(path.join(userData,'migrations','legacy-upstream-platform-session-v2.json'),JSON.stringify({version:2,validated:true,testIsolation:true,results:[]}),{mode:0o600});

function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function pass(name,condition,detail){assert.ok(condition,`${name}: ${JSON.stringify(detail)}`);checks[name]=detail==null?true:detail;}
function sha256File(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();}
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

function moduleContext(overrides){
  const storage=new Map();
  const listeners=new Map();
  const document={
    hidden:false,
    body:{classList:{contains:()=>false},appendChild:()=>{}},
    addEventListener:(name,fn)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);},
    getElementById:()=>null,
    createElement:()=>({id:'',dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false;}},setAttribute(){},appendChild(){},isConnected:true,textContent:''}),
    dispatchEvent:event=>{(listeners.get(event.type)||[]).forEach(fn=>fn(event));return true;}
  };
  const context={
    console,document,performance:{now:()=>Date.now()},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options&&options.detail;}},
    localStorage:{getItem:key=>storage.has(key)?storage.get(key):null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},
    setTimeout,clearTimeout,setInterval,clearInterval,requestAnimationFrame:fn=>setTimeout(fn,16),cancelAnimationFrame:id=>clearTimeout(id),
    addEventListener(){},removeEventListener(){},queueItemKey:song=>`${song.provider||song.type||'unknown'}:${song.id||song.localKey||song.name}`,
    beatMapSongKey:song=>`${song.provider||song.type||'unknown'}:${song.id||song.localKey||song.name}`,
    beatMapCache:{},URL,Blob,fetch
  };
  Object.assign(context,overrides||{});context.window=context;context.globalThis=context;return context;
}

function extractFunction(source,name){
  const marker=`async function ${name}`;const start=source.indexOf(marker);assert.ok(start>=0,`missing ${name}`);const brace=source.indexOf('{',start);let depth=0;let quote='';let escaped=false;
  for(let i=brace;i<source.length;i++){const ch=source[i];if(quote){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch===quote)quote='';continue;}if(ch==='\''||ch==='"'||ch==='`'){quote=ch;continue;}if(ch==='{')depth++;else if(ch==='}'&&--depth===0)return source.slice(start,i+1);}
  throw new Error(`unterminated ${name}`);
}

async function staticAndUnitChecks(){
  const index=fs.readFileSync(path.join(repo,'public','index.html'),'utf8');
  const climax=fs.readFileSync(path.join(repo,'public','lf-climax-preview.js'),'utf8');
  const resume=fs.readFileSync(path.join(repo,'public','lf-playback-resume.js'),'utf8');
  const playlistImport=fs.readFileSync(path.join(repo,'public','lf-playlist-link-import.js'),'utf8');
  const server=fs.readFileSync(path.join(repo,'server.js'),'utf8');
  const service=fs.readFileSync(path.join(repo,'music-platform-service.js'),'utf8');
  pass('the progress bar owns exactly one dedicated climax marker',(index.match(/id="progress-climax-marker"/g)||[]).length===1,true);
  pass('the marker is a four-pixel non-interactive white dot clamped inside the track',/#progress-climax-marker\{[^}]*left:clamp\(2px,[^}]*width:4px;height:4px[^}]*background:#fff[^}]*pointer-events:none/.test(index),true);
  pass('analysis cache schema is bumped and the legacy cache is not read',climax.includes("lumifield-climax-analysis-v2")&&!climax.includes("lumifield-climax-analysis-v1"),true);
  pass('short tracks never force the climax start back to zero',!/duration\s*<=\s*wanted[\s\S]{0,120}start\s*=\s*0/.test(climax)&&!/return\s*\{\s*startSec:\s*0/.test(climax),true);
  pass('strict seek completes and is verified before media play',/await seekMedia\(media, start, generation\);[\s\S]{0,400}await media\.play\(\)/.test(climax)&&/CLIMAX_SEEK_MISMATCH/.test(climax)&&/CLIMAX_SEEK_TIMEOUT/.test(climax),true);
  pass('track changes use a generation-deduplicated asynchronous marker resolver',/function ensureStart\([\s\S]*markerResolve\.generation[\s\S]*cachedBeatMap[\s\S]*analyzeAudioForClimax/.test(climax)&&/requestSerial !== progressClimaxMarkerRequestSerial/.test(index),true);
  pass('song metadata duration wins over stale media duration during marker changes',/normalizePlaybackDurationSeconds\(owner && owner\.duration\) \|\| playbackDurationFromSong\(song\)/.test(index)&&/progressClimaxMediaSongKey === songKey/.test(index),true);
  pass('resume and playlist serializers preserve only explicitly positive climax fields',!resume.includes('climaxStartSec:Math.max(0')&&!playlistImport.includes('climaxStartSec:Math.max(0')&&(resume.match(/value > 0/g)||[]).length>=1&&(playlistImport.match(/value > 0/g)||[]).length>=1,true);
  pass('backend normalizers reject null empty and zero candidates',[server,service].every(source=>source.includes('candidate == null')&&source.includes('value <= 0')&&source.includes('return undefined')),true);
  const inline=[...index.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match=>match[1]).filter(text=>text.trim());
  inline.forEach((source,indexValue)=>new vm.Script(source,{filename:`index-inline-${indexValue}.js`}));
  pass('all inline application scripts still parse',inline.length>0,{count:inline.length});

  const deferred={};
  const context=moduleContext({readBeatDiskCache:key=>new Promise(resolve=>{deferred[key]=resolve;})});
  vm.createContext(context);new vm.Script(climax,{filename:'lf-climax-preview.js'}).runInContext(context);
  const api=context.LumiFieldClimaxPreview;
  const cases={
    seconds:api.computePlatformStart({chorusStartSec:10},18),
    milliseconds:api.computePlatformStart({chorusStartMs:10500},18),
    clock:api.computePlatformStart({chorusStart:'0:12.5'},18),
    nested:api.computePlatformStart({chorus:{startSec:11}},18),
    unknownDuration:api.computePlatformStart({climaxStartSec:17},0),
    zero:api.computePlatformStart({climaxStartSec:0},180),
    missing:api.computePlatformStart({climaxStartSec:null},180)
  };
  pass('seconds milliseconds nested and clock metadata preserve the exact positive timestamp',cases.seconds.startSec===10&&cases.milliseconds.startSec===10.5&&cases.clock.startSec===12.5&&cases.nested.startSec===11&&cases.unknownDuration.startSec===17,cases);
  pass('zero and missing metadata never become a climax timestamp',cases.zero===null&&cases.missing===null,cases);
  const shortMap=api.computeBeatMapStart({duration:18,climaxStartSec:10},18);
  pass('an eighteen-second track keeps its real ten-second chorus start',shortMap&&shortMap.startSec===10,shortMap);

  const songA={provider:'netease',id:'async-a',name:'A',duration:180000};
  const songB={provider:'qq',id:'async-b',name:'B',duration:200000};
  const promiseA=api.ensureStart(songA,180);await waitFor(()=>deferred['netease:async-a'],1000,5);
  const promiseB=api.ensureStart(songB,200);await waitFor(()=>deferred['qq:async-b'],1000,5);
  deferred['netease:async-a']({duration:180,climaxStartSec:44});
  deferred['qq:async-b']({duration:200,climaxStartSec:88});
  const [resultA,resultB]=await Promise.all([promiseA,promiseB]);
  pass('a late analysis result cannot overwrite the newly selected song',resultA===null&&resultB&&resultB.startSec===88&&api.getKnownStart(songA,180)===null&&api.getKnownStart(songB,200).startSec===88,{resultA,resultB});

  const seekSource=extractFunction(climax,'seekMedia');
  const seekContext={state:{generation:7},setTimeout,clearTimeout,Number,Math,Error};vm.createContext(seekContext);
  const seek=vm.runInContext(`(${seekSource})`,seekContext);
  function fakeMedia(mismatch){const handlers={};let current=0;return{get currentTime(){return current;},set currentTime(value){current=mismatch?0:value;queueMicrotask(()=>{(handlers.seeked||[]).slice().forEach(fn=>fn());});},error:null,addEventListener(name,fn){(handlers[name]||(handlers[name]=[])).push(fn);},removeEventListener(name,fn){handlers[name]=(handlers[name]||[]).filter(item=>item!==fn);}};}
  await seek(fakeMedia(false),10,7);
  let mismatch='';try{await seek(fakeMedia(true),10,7);}catch(error){mismatch=String(error&&error.message||error);}
  pass('seek verification accepts the exact target and rejects a media element stuck at zero',mismatch==='CLIMAX_SEEK_MISMATCH',mismatch);
}

async function listTargets(port){return(await fetch(`http://127.0.0.1:${port}/json/list`)).json();}
async function startApp(){
  assert.ok(fs.existsSync(electronExe),`Electron not found: ${electronExe}`);const port=await freePort();
  app=spawn(electronExe,['.',`--user-data-dir=${userData}`,`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1','--autoplay-policy=no-user-gesture-required'],{cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe'],env:Object.assign({},process.env,{NODE_PATH:dependencyRoot,LF_MASTER_TEST:'1',LUMIFIELD_SKIP_SPLASH:'1',ELECTRON_DISABLE_SECURITY_WARNINGS:'true'})});
  const collect=data=>appLog.push(String(data));app.stdout.on('data',collect);app.stderr.on('data',collect);
  const target=await waitFor(async()=>{const targets=await listTargets(port);return targets.find(item=>item.type==='page'&&/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?(?:index\.html)?$/i.test(item.url));},60000);
  cdp=new CDP(target.webSocketDebuggerUrl);await cdp.connect();
  await waitFor(()=>cdp.evaluate(`document.readyState==='complete'&&!!window.LumiFieldClimaxPreview&&!!document.getElementById('progress-climax-marker')`),60000);
}

async function runtimeChecks(){
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false,screenWidth:1280,screenHeight:720});
  await cdp.evaluate(`(()=>{document.querySelectorAll('.modal-mask,#lf-auth-root,#visual-guide').forEach(n=>{n.classList.remove('show','active');n.style.setProperty('display','none','important');});document.body.classList.remove('lf-auth-locked','visual-guide-active','render-deep-sleep');document.body.classList.add('controls-visible');const bar=document.getElementById('bottom-bar');if(bar)bar.classList.add('visible');return true;})()`);
  const markers=await cdp.evaluate(`(()=>{const marker=document.getElementById('progress-climax-marker'),bar=document.getElementById('progress-bar');const sample=song=>{playQueue=[song];currentIdx=0;currentLocalSong=null;updatePlaybackProgressUi();const mr=marker.getBoundingClientRect(),br=bar.getBoundingClientRect();return{key:progressClimaxMarkerState.songKey,start:marker.getAttribute('data-start-sec'),source:marker.getAttribute('data-source'),position:marker.style.getPropertyValue('--lf-climax-position'),className:marker.className,rect:{left:mr.left,right:mr.right,top:mr.top,bottom:mr.bottom,width:mr.width,height:mr.height},bar:{left:br.left,right:br.right,top:br.top,bottom:br.bottom}};};const a=sample({provider:'netease',id:'marker-a',name:'Marker A',artist:'LF',duration:180000,chorusStartSec:36});const beforeDrag=marker.style.getPropertyValue('--lf-climax-position');setProgressVisual(77);const afterDrag=marker.style.getPropertyValue('--lf-climax-position');const b=sample({provider:'qq',id:'marker-b',name:'Marker B',artist:'LF',duration:240000,highlightStartSec:96});return{a,b,beforeDrag,afterDrag,count:document.querySelectorAll('#progress-climax-marker').length};})()`);
  pass('two songs immediately place the same unique marker at different chorus positions',markers.count===1&&markers.a.position==='20.0000%'&&markers.b.position==='40.0000%'&&markers.a.key!==markers.b.key,markers);
  pass('the live marker remains fully inside the progress track and no larger than four pixels',[markers.a,markers.b].every(item=>item.rect.width<=4.01&&item.rect.height<=4.01&&item.rect.left>=item.bar.left-.01&&item.rect.right<=item.bar.right+.01),markers);
  pass('dragging the playback thumb cannot move the chorus marker',markers.beforeDrag===markers.afterDrag,{before:markers.beforeDrag,after:markers.afterDrag});
  await delay(180);await cdp.screenshot('climax-progress-marker.png');

  const preview=await cdp.evaluate(`(async()=>{if(LumiFieldClimaxPreview.isHolding())await LumiFieldClimaxPreview.stop('test-reset',{restore:false});if(audio){try{audio.pause();audio.removeAttribute('src');audio.load();}catch(_){}}audio=null;playQueue=[];currentIdx=-1;currentLocalSong=null;const seconds=18,sampleRate=8000,samples=seconds*sampleRate,buffer=new ArrayBuffer(44+samples*2),view=new DataView(buffer);const put=(offset,text)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i));};put(0,'RIFF');view.setUint32(4,36+samples*2,true);put(8,'WAVE');put(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);put(36,'data');view.setUint32(40,samples*2,true);const url=URL.createObjectURL(new Blob([buffer],{type:'audio/wav'}));const song={provider:'local',type:'local',id:'short-real-chorus',localKey:'short-real-chorus',name:'18秒真实高潮',artist:'LumiField QA',duration:18000,chorusStartSec:10,localUrl:url};window.__lfClimaxPreviewTestConfig={holdMs:80,segmentSeconds:60};const began=LumiFieldClimaxPreview.begin(song,{origin:'main-queue',pointerId:1515,hitId:'runtime-short'});const until=performance.now()+15000;while(performance.now()<until){const status=LumiFieldClimaxPreview.status();if(status.phase==='playing'||status.lastError)break;await new Promise(r=>setTimeout(r,40));}updatePlaybackProgressUi();const status=LumiFieldClimaxPreview.status(),marker=document.getElementById('progress-climax-marker');const result={began,status,currentTime:audio&&audio.currentTime,paused:audio&&audio.paused,marker:{visible:marker.classList.contains('visible'),start:marker.getAttribute('data-start-sec'),position:marker.style.getPropertyValue('--lf-climax-position'),owner:LumiFieldClimaxPreview.getMarkerOwner()}};await LumiFieldClimaxPreview.stop('runtime-complete',{restore:true});URL.revokeObjectURL(url);delete window.__lfClimaxPreviewTestConfig;return result;})()`,30000);
  pass('a real eighteen-second media file starts from its ten-second chorus without zero fallback',preview.began&&preview.status.phase==='playing'&&Math.abs(preview.status.startSec-10)<.01&&preview.status.segmentSec>7.5&&preview.status.segmentSec<=8.01&&preview.currentTime>=9.7&&preview.currentTime<13&&!preview.paused,preview);
  pass('transient preview temporarily gives the progress marker to the previewed song',preview.marker.visible&&preview.marker.start==='10.000'&&Math.abs(parseFloat(preview.marker.position)-55.5556)<.02&&preview.marker.owner&&preview.marker.owner.songKey==='local:short-real-chorus',preview.marker);
  pass('renderer and console errors remain zero',rendererErrors.length===0&&consoleErrors.length===0,{rendererErrors,consoleErrors});
}

async function stopApp(){if(cdp){cdp.close();cdp=null;}if(app&&!app.killed){app.kill();await Promise.race([new Promise(resolve=>app.once('exit',resolve)),delay(4000)]);}app=null;}
(async()=>{let error=null;try{await staticAndUnitChecks();if(process.env.LF_V1144_15_STATIC_ONLY!=='1'){await startApp();await runtimeChecks();}}catch(caught){error=caught;process.exitCode=1;}finally{await stopApp();const result={task:'v1.1.44-problem-15',status:error?'FAIL':'PASS',checks,checkCount:Object.keys(checks).length,rendererErrors,consoleErrors,screenshots,appLog,error:error?String(error.stack||error):null};fs.writeFileSync(path.join(evidenceDir,'result.json'),JSON.stringify(result,null,2));process.stdout.write(`${JSON.stringify({status:result.status,checkCount:result.checkCount,evidenceDir},null,2)}\n`);}})();
