'use strict';

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const electron = require('electron');
const installedArg = process.argv.find(value => value.startsWith('--installed-exe='));
const appExecutable = installedArg ? path.resolve(installedArg.slice('--installed-exe='.length)) : electron;
const launchMode = installedArg ? 'installed' : 'source';
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.join(repo, 'test-results', 'lf-problem1-smoke', runId);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-problem1-'));
const checks = {}, rendererErrors = [], screenshots = [], appLog = [];
let app, cdp;
fs.mkdirSync(evidenceDir, { recursive:true });

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function pass(name, condition, detail) { assert.ok(condition, name + ': ' + JSON.stringify(detail)); checks[name] = detail == null ? true : detail; }
function freePort() { return new Promise((resolve, reject) => { const s=net.createServer();s.unref();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));}); }); }
async function waitFor(fn, timeout=60000, interval=120) { const start=Date.now();let last;while(Date.now()-start<timeout){try{last=await fn();if(last)return last;}catch(_){}await delay(interval);}throw new Error('Timeout: '+JSON.stringify(last)); }

class CDP {
  constructor(url){this.url=url;this.id=0;this.pending=new Map();}
  async connect(){this.ws=new WebSocket(this.url);this.ws.onmessage=e=>{const m=JSON.parse(String(e.data));if(m.id&&this.pending.has(m.id)){const p=this.pending.get(m.id);this.pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result||{});}else if(m.method==='Runtime.exceptionThrown'){const d=m.params&&m.params.exceptionDetails||{};rendererErrors.push(String(d.exception&&d.exception.description||d.text||'Renderer error'));}};await new Promise((r,j)=>{this.ws.onopen=r;this.ws.onerror=j;});await this.send('Runtime.enable');await this.send('Page.enable');}
  send(method,params,timeout=60000){const id=++this.id;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('CDP timeout '+method));},timeout);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params:params||{}}));});}
  async call(fn,args=[]){const r=await this.send('Runtime.evaluate',{expression:'('+fn.toString()+').apply(null,'+JSON.stringify(args)+')',awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception&&r.exceptionDetails.exception.description||r.exceptionDetails.text);return r.result&&r.result.value;}
  close(){try{this.ws.close();}catch(_){}}
}

async function staticAndServiceChecks() {
  const renderer = fs.readFileSync(path.join(repo,'public','lumifield-task13.js'),'utf8');
  const stage = fs.readFileSync(path.join(repo,'public','index.html'),'utf8');
  const server = fs.readFileSync(path.join(repo,'server.js'),'utf8');
  const serviceSource = fs.readFileSync(path.join(repo,'desktop','lf-translation-service.js'),'utf8');
  const integritySource = fs.readFileSync(path.join(repo,'desktop','lf-integrity.js'),'utf8');
  pass('cache descriptor contains song id original target and timeline',
    /songId:String/.test(renderer) && /target:String/.test(renderer) && /text:String/.test(renderer) && /t:Number/.test(renderer) && /words:Array\.isArray/.test(renderer), true);
  pass('song switch abort and retry paths exist', /resetTranslationForSong/.test(renderer) && /translationRequest\.controller\.abort/.test(renderer) && /lf-t13-translate-retry/.test(renderer), true);
  pass('partial translations request only missing indices', /translationMissingIndices/.test(renderer) && /missing\.map/.test(renderer) && /applyTranslationArray\(values, missing/.test(renderer), true);
  pass('late translation mutates child without rebuilding parent', /function updateLyricTranslationChild/.test(stage) && /updateLyricTranslationChild\(stageLyrics\.current, next\)/.test(stage), true);
  pass('administrator remote adapter falls back to local service', /proxyRemoteLyricTranslation/.test(server) && /localTranslationService\.translateLyrics/.test(server), true);
  pass('WASM is covered by signed installed-module integrity', /INSTALL_MODULE_EXTENSIONS[^]*'\.wasm'/.test(integritySource), true);
  pass('worker faults reset instance and local translation has total timeout',
    /worker\.on\('exit'/.test(serviceSource) && /rejectPending/.test(serviceSource) && /LOCAL_TRANSLATION_TIMEOUT_MS = 30000/.test(serviceSource) && /invalidateTranslator/.test(serviceSource), true);
  pass('translation cache has TTL sweep capacity limit and quota eviction retry',
    /TRANSLATION_CACHE_MAX_ENTRIES = 48/.test(renderer) && /TRANSLATION_CACHE_MAX_BYTES = 3 \* 1024 \* 1024/.test(renderer) && /entries\.shift/.test(renderer) && /localStorage\.setItem\(key, raw\)/.test(renderer), true);

  const service = require(path.join(repo,'desktop','lf-translation-service'));
  const result = await service.translateLyrics({
    sourceLanguage:'auto', targetLanguage:'zh-CN',
    lines:['Hello world','你好世界','君の声が聞こえる','Love你 forever','你好、君の声が聞こえる']
  });
  const kanji = await service.translateLyrics({ sourceLanguage:'ja', targetLanguage:'zh-CN', lines:['未来永遠'] });
  const inferredKanji = await service.translateLyrics({
    sourceLanguage:'auto', targetLanguage:'zh-CN',
    languageContext:['君の声が聞こえる','未来永遠'],
    lines:['君の声が聞こえる','未来永遠']
  });
  pass('real English translation', !!result.translations[0] && result.translations[0] !== 'Hello world', result.translations[0]);
  pass('pure Chinese is skipped instead of duplicated', result.translations[1] === '' && result.skippedIndices.includes(1), result);
  pass('real Japanese translation', !!result.translations[2] && result.translations[2] !== '君の声が聞こえる', result.translations[2]);
  pass('Chinese English mixed translation', /爱|永远|永久|永恒/.test(result.translations[3]), result.translations[3]);
  pass('Chinese Japanese mixed translation', !!result.translations[4] && result.translations[4] !== '你好、君の声が聞こえる', result.translations[4]);
  pass('explicit Japanese supports kanji-only line', !!kanji.translations[0] && kanji.translations[0] !== '未来永遠', kanji.translations[0]);
  pass('whole-lyric auto inference translates kanji-only Japanese line', inferredKanji.inferredSourceLanguage === 'ja' && !!inferredKanji.translations[1] && inferredKanji.translations[1] !== '未来永遠', inferredKanji);
  pass('local adapter and pinned Mozilla snapshot used', result.adapter === 'local-bergamot' && /^https:\/\/storage\.googleapis\.com\//.test(result.modelSource), {adapter:result.adapter,snapshot:result.modelSnapshot});
  const abortController = new AbortController();
  const cancelled = service.translateLyrics({
    sourceLanguage:'auto', targetLanguage:'zh-CN',
    languageContext:['君の声が聞こえる'],
    lines:Array(120).fill('君の声が聞こえる')
  }, {signal:abortController.signal});
  setTimeout(()=>abortController.abort(),10);
  let cancelCode='';
  try { await cancelled; } catch (error) { cancelCode=error.code; }
  const rebuilt = await service.translateLyrics({sourceLanguage:'auto',targetLanguage:'zh-CN',lines:['Good night']});
  pass('cancellation terminates worker and next request rebuilds safely', cancelCode === 'TRANSLATION_ABORTED' && !!rebuilt.translations[0], {cancelCode,rebuild:rebuilt.translations[0]});
  if(launchMode==='installed'){
    const manifest=JSON.parse(fs.readFileSync(path.join(path.dirname(appExecutable),'resources','lf-integrity-manifest.json'),'utf8'));
    pass('installed signed manifest contains Bergamot WASM', manifest.modules.some(item=>/bergamot-translator-worker\.wasm$/i.test(item.path)), manifest.modules.filter(item=>/bergamot/i.test(item.path)));
  }
  await service.shutdown();
}

async function startApp() {
  const port=await freePort();
  const args=['--user-data-dir='+userData,'--remote-debugging-port='+port,'--remote-debugging-address=127.0.0.1','--window-size=1440,900'];
  if(launchMode==='source')args.unshift('.');
  app=spawn(appExecutable,args,{
    cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe'],
    env:Object.assign({},process.env,{LUMIFIELD_SKIP_SPLASH:'1',ELECTRON_DISABLE_SECURITY_WARNINGS:'true',LF_ALLOW_PACKAGED_CDP_TEST:'1',LF_TRANSLATE_ENDPOINT:'',LF_TRANSLATE_API_KEY:'',LF_REMOTE_API_URL:' '})
  });
  const collect=data=>appLog.push(String(data));app.stdout.on('data',collect);app.stderr.on('data',collect);
  const target=await waitFor(async()=>{const r=await fetch('http://127.0.0.1:'+port+'/json/list');const a=await r.json();return a.find(x=>x.type==='page'&&/^http:\/\/(?:localhost|127\.0\.0\.1):/.test(x.url));},50000,180);
  cdp=new CDP(target.webSocketDebuggerUrl);await cdp.connect();
  await waitFor(()=>cdp.call(function(){return document.readyState==='complete'&&window.LumiFieldTask13&&typeof renderer!=='undefined'&&typeof stageLyrics!=='undefined';}),50000);
}

async function rendererChecks() {
  const prepared=await cdp.call(async function(){
    document.body.classList.remove('splash-active','empty-home-active','lf-auth-locked');
    emptyHomeActive=false;homeForcedOpen=false;
    var splash=document.getElementById('splash');if(splash)splash.style.display='none';
    playQueue=[{id:'problem1-a',provider:'local',name:'Translation Test',artist:'LF QA'}];currentIdx=0;
    lyricsLines=[
      {t:0,duration:5,text:'Hello world'},
      {t:5,duration:5,text:'Already translated',translation:'平台已有译文'},
      {t:10,duration:5,text:'君の声が聞こえる'},
      {t:15,duration:5,text:'你好世界'}
    ];
    if(!audio){audio=document.createElement('audio');document.body.appendChild(audio);}
    audio.currentTime=0;
    playing=true;
    fx.particleLyrics=true;
    if(typeof createLyricsParticles==='function')createLyricsParticles();
    if(typeof tickLyricsParticles==='function')tickLyricsParticles();
    stageLyrics.currentIdx=0;
    showStageLine('Hello world',true,'');
    var before=window.lumiFieldProblem1Debug();
    window.LumiFieldTask13.setLyricState({translate:true});
    return {before:before,cache:window.LumiFieldTask13.getTranslationDebug().cacheKey};
  });
  let translated;
  try {
    translated=await waitFor(()=>cdp.call(function(){
      var done=lyricsLines[0]&&lyricsLines[0].lfTranslationSource==='service'&&lyricsLines[2]&&lyricsLines[2].lfTranslationSource==='service'&&lyricsLines[3]&&lyricsLines[3].lfTranslationSkipped;
      var stage=window.lumiFieldProblem1Debug();
      return done&&stage.hasTranslationMesh?{lines:lyricsLines.map(function(x){return{text:x.text,translation:x.translation||'',source:x.lfTranslationSource||'',skipped:!!x.lfTranslationSkipped};}),stage:stage,debug:window.LumiFieldTask13.getTranslationDebug()}:null;
    }),90000,200);
  } catch (error) {
    const diagnostic=await cdp.call(function(){return{lines:lyricsLines,stage:window.lumiFieldProblem1Debug(),debug:window.LumiFieldTask13.getTranslationDebug()};});
    throw new Error(error.message+' diagnostic='+JSON.stringify(diagnostic));
  }
  pass('Electron renderer receives real local translations', translated.lines[0].translation && translated.lines[2].translation, translated.lines);
  pass('existing platform partial translation is preserved', translated.lines[1].translation === '平台已有译文' && translated.lines[1].source === '', translated.lines[1]);
  pass('pure Chinese renderer line is marked complete without duplicate', translated.lines[3].translation === '' && translated.lines[3].skipped, translated.lines[3]);
  pass('late result keeps same Three parent', prepared.before.parentUuid && translated.stage.parentUuid === prepared.before.parentUuid && translated.stage.hasTranslationMesh, {before:prepared.before,after:translated.stage});

  const cacheKeys=await cdp.call(function(){
    var base=window.LumiFieldTask13.getTranslationDebug().cacheKey;
    var oldT=lyricsLines[0].t;lyricsLines[0].t=oldT+0.25;var timeline=window.LumiFieldTask13.getTranslationDebug().cacheKey;lyricsLines[0].t=oldT;
    var oldText=lyricsLines[0].text;lyricsLines[0].text=oldText+'!';var original=window.LumiFieldTask13.getTranslationDebug().cacheKey;lyricsLines[0].text=oldText;
    var oldId=playQueue[0].id;playQueue[0].id=oldId+'-other';var songId=window.LumiFieldTask13.getTranslationDebug().cacheKey;playQueue[0].id=oldId;
    return {base:base,timeline:timeline,original:original,songId:songId};
  });
  pass('cache key changes for timeline original and song id', new Set(Object.values(cacheKeys)).size===4, cacheKeys);

  const cachePolicy=await cdp.call(function(){
    var prefix='lumifield-task13-translation:test-policy-';
    var now=Date.now();
    for(var i=0;i<70;i++){
      localStorage.setItem(prefix+i,JSON.stringify({descriptor:'test-'+i,values:['x'],createdAt:now-i*1000,lastAccessedAt:now-i*1000,expiresAt:i<5?now-1:now+86400000}));
    }
    var stats=window.LumiFieldTask13.maintainTranslationCache();
    var expired=false,count=0;
    for(var j=0;j<localStorage.length;j++){var key=localStorage.key(j);if(key&&key.indexOf('lumifield-task13-translation:')===0){count++;if(/^lumifield-task13-translation:test-policy-[0-4]$/.test(key))expired=true;}}
    return{stats:stats,total:count,expiredRemains:expired};
  });
  pass('translation cache sweeps TTL and enforces count and byte caps', cachePolicy.stats&&cachePolicy.stats.count<=48&&cachePolicy.stats.bytes<=3*1024*1024&&cachePolicy.total<=48&&!cachePolicy.expiredRemains, cachePolicy);

  const toggleCancel=await cdp.call(async function(){
    playQueue=[{id:'problem1-toggle-cancel',provider:'local',name:'Cancel',artist:'LF'}];currentIdx=0;
    lyricsLines=Array.from({length:120},function(_,i){return{t:i,text:'君の声が聞こえる '+i};});
    var oldLines=lyricsLines;
    window.LumiFieldTask13.setLyricState({translate:true});
    await new Promise(function(r){setTimeout(r,500);});
    window.LumiFieldTask13.setLyricState({translate:false});
    await new Promise(function(r){setTimeout(r,1200);});
    return{requestKey:window.LumiFieldTask13.getTranslationDebug().requestKey,status:window.LumiFieldTask13.getTranslationDebug().status,oldMutated:oldLines.some(function(x){return x.lfTranslationSource==='service';})};
  });
  pass('turning translation off aborts active work without late mutation', !toggleCancel.requestKey&&!toggleCancel.status&&!toggleCancel.oldMutated, toggleCancel);

  const switchResult=await cdp.call(async function(){
    window.LumiFieldTask13.setLyricState({translate:true});
    playQueue=[{id:'problem1-slow-a',provider:'local',name:'A',artist:'LF'}];currentIdx=0;
    lyricsLines=Array.from({length:120},function(_,i){return{t:i,text:'君の声が聞こえる '+i};});
    var oldLines=lyricsLines;
    await new Promise(function(r){setTimeout(r,550);});
    playQueue=[{id:'problem1-b',provider:'local',name:'B',artist:'LF'}];currentIdx=0;
    lyricsLines=[{t:0,text:'Good night'}];audio.currentTime=0;
    await new Promise(function(r){setTimeout(r,6500);});
    return {
      oldMutated:oldLines.some(function(x){return x.lfTranslationSource==='service';}),
      current:lyricsLines[0],
      debug:window.LumiFieldTask13.getTranslationDebug()
    };
  });
  pass('song switch cancels stale result and translates new song', !switchResult.oldMutated && switchResult.current.lfTranslationSource==='service' && !!switchResult.current.translation, switchResult);

  await cdp.call(function(value){
    var n=document.createElement('pre');n.id='lf-problem1-evidence';n.style.cssText='position:fixed;z-index:2147483647;left:24px;top:70px;max-width:680px;padding:16px;background:rgba(4,10,18,.94);color:#baffed;border:1px solid #6ff0d2;border-radius:12px;font:13px/1.5 Consolas,monospace;white-space:pre-wrap';n.textContent='LumiField Problem 1 PASS\\n'+JSON.stringify(value,null,2);document.body.appendChild(n);return true;
  },[{translations:translated.lines,parentUuid:translated.stage.parentUuid,cacheKeys,songSwitch:switchResult}]);
  const shot=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false},20000);
  const file=path.join(evidenceDir,'problem1-electron.png');fs.writeFileSync(file,Buffer.from(shot.data,'base64'));screenshots.push(file);
}

async function stopApp() {
  if(cdp){try{await cdp.call(function(){window.close();return true;});}catch(_){}cdp.close();}
  if(app&&app.pid&&app.exitCode==null)await Promise.race([new Promise(r=>app.once('exit',r)),delay(4000)]);
  if(app&&app.pid&&app.exitCode==null)spawnSync('taskkill',['/pid',String(app.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'});
  try{fs.rmSync(userData,{recursive:true,force:true});}catch(_){}
}

async function run(){
  await staticAndServiceChecks();
  await startApp();
  await rendererChecks();
  pass('rendererErrors=0',rendererErrors.length===0,rendererErrors);
  const result={ok:true,runId,launchMode,appExecutable,evidenceDir,checks,screenshots,rendererErrors};
  fs.writeFileSync(path.join(evidenceDir,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({ok:true,launchMode,evidenceDir,checkCount:Object.keys(checks).length,rendererErrors:rendererErrors.length},null,2));
}
run().catch(error=>{console.error(error&&error.stack||error);process.exitCode=1;}).finally(async()=>{try{fs.writeFileSync(path.join(evidenceDir,'app.log'),appLog.join(''));}catch(_){}await stopApp();try{await require(path.join(repo,'desktop','lf-translation-service')).shutdown();}catch(_){}});
