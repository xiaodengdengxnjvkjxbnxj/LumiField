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
const materialRoot = 'D:\\HuaweiMoveData\\Users\\35992\\Desktop\\文件13\\LF需新增的内容\\虚空文本效应';
const sourceFile = path.join(materialRoot, '虚空文本效应.完整源码以及原组件页面链接.txt');
const videoFile = path.join(materialRoot, '虚空文本效应效果视频.mp4');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.join(repo, 'test-results', 'lf-v1144-7-vapour-lyrics', runId);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-v1144-7-'));
const checks = {};
const rendererErrors = [];
const consoleErrors = [];
const screenshots = [];
const appLog = [];
let app = null;
let cdp = null;

fs.mkdirSync(evidenceDir, { recursive:true });
fs.mkdirSync(path.join(userData, 'migrations'), { recursive:true });
fs.writeFileSync(path.join(userData, 'migrations', 'legacy-upstream-platform-session-v2.json'), JSON.stringify({version:2,validated:true,testIsolation:true,results:[]}, null, 2), {encoding:'utf8',mode:0o600});

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex').toUpperCase(); }
function fileSha256(file) { return sha256(fs.readFileSync(file)); }
function pass(name, condition, detail) { assert.ok(condition, `${name}: ${JSON.stringify(detail)}`); checks[name] = detail == null ? true : detail; }
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.unref(); server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(error => error ? reject(error) : resolve(port)); });
  });
}
async function waitFor(fn, timeout = 30000, interval = 60) {
  const start = Date.now(); let last = null;
  while (Date.now() - start < timeout) {
    try { last = await fn(); if (last) return last; } catch (error) { last = String(error && error.message || error); }
    await delay(interval);
  }
  throw new Error(`Timeout: ${JSON.stringify(last)}`);
}

class CDP {
  constructor(url) { this.url=url; this.id=0; this.pending=new Map(); }
  async connect() {
    this.ws=new WebSocket(this.url);
    this.ws.onmessage=event=>{
      const message=JSON.parse(String(event.data));
      if(message.id&&this.pending.has(message.id)){
        const pending=this.pending.get(message.id);this.pending.delete(message.id);clearTimeout(pending.timer);
        if(message.error)pending.reject(new Error(message.error.message));else pending.resolve(message.result||{});return;
      }
      if(message.method==='Runtime.exceptionThrown'){
        const detail=message.params&&message.params.exceptionDetails||{};
        rendererErrors.push(String(detail.exception&&detail.exception.description||detail.text||'renderer exception'));
      }
      if(message.method==='Runtime.consoleAPICalled'&&message.params&&message.params.type==='error'){
        consoleErrors.push((message.params.args||[]).map(item=>item.value||item.description||'').join(' '));
      }
    };
    await new Promise((resolve,reject)=>{this.ws.onopen=resolve;this.ws.onerror=reject;});
    await this.send('Runtime.enable');await this.send('Page.enable');
  }
  send(method,params,timeout=30000){const id=++this.id;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},timeout);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params:params||{}}));});}
  async evaluate(expression){const response=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(response.exceptionDetails)throw new Error(response.exceptionDetails.exception&&response.exceptionDetails.exception.description||response.exceptionDetails.text);return response.result&&response.result.value;}
  async screenshot(name){const response=await this.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});const file=path.join(evidenceDir,name);fs.writeFileSync(file,Buffer.from(response.data,'base64'));screenshots.push({file:path.basename(file),sha256:fileSha256(file),bytes:fs.statSync(file).size});}
  close(){try{this.ws.close();}catch(_){}}
}

function section(source, startText, endText) {
  const start=source.indexOf(startText);assert.ok(start>=0,`missing ${startText}`);
  const end=endText?source.indexOf(endText,start+startText.length):-1;
  return source.slice(start,end<0?source.length:end);
}

function staticChecks(){
  const index=fs.readFileSync(path.join(repo,'public','index.html'),'utf8');
  const effect=fs.readFileSync(path.join(repo,'public','lf-vapour-lyrics.js'),'utf8');
  const showLine=section(index,'function showStageLine','function syncStageLyricTranslation');
  const startEffect=section(index,'function startStageLyricVapour','function cancelStageLyricVapour');
  const update=section(effect,'function update(deltaTime','function setVisible');
  pass('the supplied complete source and reference video are pinned exactly',fs.existsSync(sourceFile)&&fs.existsSync(videoFile)&&fileSha256(sourceFile)==='3747019B49FD5AF716CFF7002F2E856A66D2449514A3DD79845BF09474D73E50'&&fileSha256(videoFile)==='19A0E31E965C098FC3000BDE7C7A3D0B449B4EB5E791DCE603CC79B6FB41AAE6',{source:fileSha256(sourceFile),video:fileSha256(videoFile)});
  pass('particles start transparent and appear only at the moving glyph edge',/opacity\[slot\] = 0/.test(effect)&&/opacity\[i\] = originalAlpha\[i\]/.test(update)&&/releasedCount \+= 1/.test(update),true);
  pass('the existing main and translated glyph shaders own the dissolve mask',/uVapourProgress/.test(index)&&/glyphKeep = smoothstep/.test(index)&&/mask \* uOpacity \* glyphKeep/.test(index)&&/tex\.a \* uOpacity \* glyphKeep/.test(index),true);
  pass('the same existing lyric object is retained as the outgoing target',/stageLyrics\.outgoing\.push\(stageLyrics\.current\)/.test(showLine)&&!/startStageLyricVapour\(stageLyrics\.current\);\s*disposeLyricMesh\(stageLyrics\.current\)/.test(showLine),true);
  pass('fallback song names and no-lyric text cannot start vaporization',/lineIndex < 0/.test(startEffect)&&/lyricsTimingSource === 'fallback'/.test(startEffect)&&/line\.fallback/.test(startEffect)&&/isNoLyricText\(line\.text\)/.test(startEffect),true);
  pass('source behavior keeps density spread direction and two second duration',/transformValue\(5, \[0, 10\], \[0\.3, 1\], true\)/.test(effect)&&/calculateVaporizeSpread\(fontSize\) \* 5/.test(effect)&&/var vaporizeDuration = 2/.test(effect)&&/direction: 'left-to-right'/.test(effect),true);
  pass('the adaptation adds no timer listener renderer or private animation frame',!/requestAnimationFrame|setInterval|setTimeout|addEventListener|new THREE\.WebGLRenderer/.test(effect),true);
}

async function listTargets(port){const response=await fetch(`http://127.0.0.1:${port}/json/list`);return response.json();}
async function startApp(){
  assert.ok(fs.existsSync(electronExe),`Electron not found: ${electronExe}`);
  const port=await freePort();
  app=spawn(electronExe,['.',`--user-data-dir=${userData}`,`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1'],{
    cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe'],env:Object.assign({},process.env,{NODE_PATH:dependencyRoot,LF_MASTER_TEST:'1',LUMIFIELD_SKIP_SPLASH:'1',ELECTRON_DISABLE_SECURITY_WARNINGS:'true'})
  });
  const collect=data=>appLog.push(String(data));app.stdout.on('data',collect);app.stderr.on('data',collect);
  const target=await waitFor(async()=>{const targets=await listTargets(port);return targets.find(item=>item.type==='page'&&/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?(?:index\.html)?$/i.test(item.url));},60000);
  cdp=new CDP(target.webSocketDebuggerUrl);await cdp.connect();
  await waitFor(()=>cdp.evaluate(`document.readyState==='complete'&&!!window.LumiFieldVapourLyrics&&typeof showStageLine==='function'&&typeof buildLyricMesh==='function'`),60000);
  await delay(1200);
}

async function prepare(){
  return cdp.evaluate(`(()=>{
    const hide=id=>{const n=document.getElementById(id);if(n){n.classList.remove('show','active');n.style.setProperty('display','none','important');n.setAttribute('aria-hidden','true');}};
    ['lf-auth-root','visual-guide','login-modal','user-modal','playlist-delete-modal','local-beat-modal'].forEach(hide);
    document.body.classList.remove('lf-auth-locked','splash-active','splash-revealing','empty-home-active','lf-fx-open','immersive-mode');
    window.emptyHomeActive=false;window.homeForcedOpen=false;window.homeSuppressed=true;window.lumiFieldNativeLyricsVisible=true;
    fx.particleLyrics=true;fx.lyricGlowParticles=false;playing=false;
    clearStageLyrics();createLyricsParticles();
    lyricsTimingSource='native-lrc';
    lyricsLines=[
      {t:0,text:'第一行歌词从字形本体消散',duration:2.4,charCount:13,source:'lrc'},
      {t:2.4,text:'第二行歌词保持清晰',duration:2.4,charCount:10,source:'lrc'}
    ];
    stageLyrics.trackKey=String(currentIdx)+'|'+String(audio&&(audio.currentSrc||audio.src)||'');
    stageLyrics.currentIdx=0;showStageLine(lyricsLines[0].text,false,'第一行翻译');
    const source=stageLyrics.current,lyric=source.userData.lyric;
    lyric.textMat.uniforms.uOpacity.value=1;
    if(lyric.translationMat)lyric.translationMat.uniforms.uOpacity.value=.82;
    source.userData.age=.52;
    const uuid=source.uuid;
    stageLyrics.currentIdx=1;showStageLine(lyricsLines[1].text,false,'第二行翻译');
    const debug=window.LumiFieldVapourLyrics.getDebug(),outgoing=stageLyrics.outgoing[0],data=outgoing&&outgoing.userData.lyric;
    return {uuid,currentUuid:stageLyrics.current&&stageLyrics.current.uuid,outgoingUuid:outgoing&&outgoing.uuid,outgoingCount:stageLyrics.outgoing.length,outgoingAttached:!!(outgoing&&outgoing.parent===stageLyrics.group),debug,textProgress:data&&data.textMat.uniforms.uVapourProgress.value,translationProgress:data&&data.translationMat&&data.translationMat.uniforms.uVapourProgress.value,decorationsHidden:!!(data&&!data.readability.visible&&!data.glow.visible&&!data.sparks.visible&&!data.sun.visible)};
  })()`);
}

async function exercise(){
  const initial=await prepare();
  pass('line change targets the exact existing glyph object without a clone',initial.outgoingCount===1&&initial.outgoingUuid===initial.uuid&&initial.currentUuid!==initial.uuid&&initial.outgoingAttached&&initial.debug.sourceUuid===initial.uuid&&initial.debug.duplicateGlyphCount===0,initial);
  pass('the particle pool begins empty-looking while the original glyph remains attached',initial.debug.active&&initial.debug.count>400&&initial.debug.releasedCount===0&&initial.debug.unreleasedVisibleCount===0&&initial.debug.sourceGlyphAttached&&initial.textProgress<0&&initial.translationProgress<0,initial);
  pass('non-glyph glow decorations are disabled during direct glyph dissolve',initial.decorationsHidden,initial);

  const paused=await cdp.evaluate(`(()=>{const api=stageLyrics.vapour,before=api.getDebug();api.update(.5,{paused:true,visible:true});const after=api.getDebug();return {before,after};})()`);
  pass('pause freezes the only lyric-timeline-driven effect',paused.after.elapsed===paused.before.elapsed&&paused.after.progress===paused.before.progress&&paused.after.paused,paused);

  const middle=await cdp.evaluate(`(()=>{const api=stageLyrics.vapour;for(let i=0;i<20;i++)api.update(.05,{paused:false,visible:true});const d=api.getDebug(),out=stageLyrics.outgoing[0],lyric=out&&out.userData.lyric;return {debug:d,outgoingUuid:out&&out.uuid,outgoingAttached:!!(out&&out.parent),textProgress:lyric&&lyric.textMat.uniforms.uVapourProgress.value,translationProgress:lyric&&lyric.translationMat&&lyric.translationMat.uniforms.uVapourProgress.value};})()`);
  pass('midpoint erases the source glyph and releases only reached pixels in lockstep',middle.debug.progress>.48&&middle.debug.progress<.52&&middle.debug.releasedCount>0&&middle.debug.releasedCount<middle.debug.count&&middle.debug.unreleasedVisibleCount===0&&middle.textProgress>.45&&middle.textProgress<.56&&middle.translationProgress>.45&&middle.translationProgress<.56,middle);
  pass('the original glyph identity remains attached throughout the effect',middle.outgoingUuid===initial.uuid&&middle.outgoingAttached&&middle.debug.sourceGlyphAttached,middle);
  await cdp.screenshot('existing-glyph-mid-dissolve.png');

  const completed=await cdp.evaluate(`(async()=>{const api=stageLyrics.vapour;for(let i=0;i<180&&api.getDebug().active;i++)api.update(.05,{paused:false,visible:true});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return {debug:api.getDebug(),outgoingCount:stageLyrics.outgoing.length,sourceStillAttached:!!stageLyrics.group.getObjectByProperty('uuid',${JSON.stringify(initial.uuid)})};})()`);
  pass('completed vaporization removes the original glyph and leaves no outgoing duplicate',!completed.debug.active&&completed.debug.lastReason==='completed'&&completed.outgoingCount===0&&!completed.sourceStillAttached&&completed.debug.duplicateGlyphCount===0,completed);

  const fallback=await cdp.evaluate(`(()=>{clearStageLyrics();lyricsTimingSource='fallback';lyricsLines=[{t:0,text:'歌曲名称 - 歌手',duration:9999,charCount:9,fallback:true}];stageLyrics.trackKey=String(currentIdx)+'|'+String(audio&&(audio.currentSrc||audio.src)||'');stageLyrics.currentIdx=0;showStageLine(lyricsLines[0].text,false,'');const before=window.LumiFieldVapourLyrics.getDebug(),started=startStageLyricVapour(stageLyrics.current),after=window.LumiFieldVapourLyrics.getDebug();return {started,before,after,currentAttached:!!(stageLyrics.current&&stageLyrics.current.parent)};})()`);
  pass('song-title-only fallback remains a normal glyph and never enables vaporization',fallback.started===false&&!fallback.after.active&&fallback.after.startCount===fallback.before.startCount&&fallback.currentAttached,fallback);

  const seek=await cdp.evaluate(`(()=>{clearStageLyrics();lyricsTimingSource='native-lrc';lyricsLines=[{t:0,text:'跳转前歌词',duration:2,charCount:5},{t:2,text:'跳转后歌词',duration:2,charCount:5}];stageLyrics.trackKey=String(currentIdx)+'|'+String(audio&&(audio.currentSrc||audio.src)||'');stageLyrics.currentIdx=0;showStageLine(lyricsLines[0].text,false,'');const source=stageLyrics.current;source.userData.lyric.textMat.uniforms.uOpacity.value=1;stageLyrics.currentIdx=1;showStageLine(lyricsLines[1].text,false,'');stageLyrics.vapour.update(.35,{paused:false,visible:true});cancelStageLyricVapour('seek');const d=stageLyrics.vapour.getDebug(),out=stageLyrics.outgoing[0];return {debug:d,sourceProgress:out&&out.userData.lyric.textMat.uniforms.uVapourProgress.value,vapourActive:out&&out.userData.vapourActive};})()`);
  pass('seek cancels stale particles and restores the source mask before normal cleanup',!seek.debug.active&&seek.debug.lastReason==='seek'&&seek.sourceProgress===-1&&seek.vapourActive===false,seek);

  const lifecycle=await cdp.evaluate(`(()=>{clearStageLyrics();const api=stageLyrics.vapour,before=api.getDebug();disposeLyricsParticles();const after=api.getDebug();return {before,after,global:window.LumiFieldVapourLyrics.getDebug()};})()`);
  pass('one shared pool disposes its only geometry and material exactly once',lifecycle.before.resources.points===1&&lifecycle.before.resources.geometries===1&&lifecycle.before.resources.materials===1&&lifecycle.after.disposed&&lifecycle.after.resources.points===0&&lifecycle.after.resources.geometries===0&&lifecycle.after.resources.materials===0&&lifecycle.global.resources.points===0,lifecycle);
  pass('the feature owns no RAF interval or event listener',lifecycle.before.sharedFrame&&lifecycle.before.ownRafCount===0&&lifecycle.before.ownIntervalCount===0&&lifecycle.before.listenerCount===0,lifecycle.before);
}

async function cleanup(){if(cdp){try{await cdp.evaluate(`try{disposeLyricsParticles()}catch(e){};true`);}catch(_){}cdp.close();}if(app&&!app.killed){try{app.kill();}catch(_){}await delay(700);}}

(async()=>{
  let failure=null;
  try{staticChecks();await startApp();await exercise();pass('renderer emitted no uncaught exceptions',rendererErrors.length===0,rendererErrors);pass('renderer emitted no console errors',consoleErrors.length===0,consoleErrors);}
  catch(error){failure={message:String(error&&error.message||error),stack:String(error&&error.stack||'')};}
  finally{await cleanup();}
  const result={overall:failure?'FAIL':'PASS',mode:'SOURCE_ELECTRON_TARGETED',checks,checkCount:Object.keys(checks).length,rendererErrors,consoleErrors,screenshots,materialSha256:{source:fileSha256(sourceFile),video:fileSha256(videoFile)},productSha256:{effect:fileSha256(path.join(repo,'public','lf-vapour-lyrics.js')),index:fileSha256(path.join(repo,'public','index.html'))},failure,appLog};
  fs.writeFileSync(path.join(evidenceDir,'result.json'),JSON.stringify(result,null,2));
  process.stdout.write(`${JSON.stringify({overall:result.overall,checkCount:result.checkCount,evidenceDir,failure},null,2)}\n`);
  if(failure)process.exitCode=1;
})();
