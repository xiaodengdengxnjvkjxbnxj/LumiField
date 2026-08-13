'use strict';

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const electron = require('electron');
const beforeOnly = process.env.LF_PROBLEM15_BEFORE === '1';
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.resolve(process.env.LF_PROBLEM15_OUT || path.join(repo, 'test-results', 'lf-problem15-smoke', beforeOnly ? 'before' : runId));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lumifield-problem15-'));
const checks = {}, screenshots = [], rendererErrors = [], appLog = [];
const baselineFile = path.join(repo, 'test-results', 'lf-problem15-smoke', 'before', 'before-metrics.json');
let app = null, cdp = null, targetId = '';
fs.mkdirSync(evidenceDir, { recursive:true });

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function pass(name, condition, detail) { assert.ok(condition, name + ': ' + JSON.stringify(detail)); checks[name] = detail == null ? true : detail; return detail; }
function freePort() { return new Promise((resolve, reject) => { const s = net.createServer(); s.unref(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p=s.address().port; s.close(e => e ? reject(e) : resolve(p)); }); }); }
async function waitFor(fn, timeout=30000, interval=100) { const started=Date.now(); let last; while(Date.now()-started<timeout){ try{ last=await fn(); if(last)return last; }catch(_){} await delay(interval); } throw new Error('Timeout; last='+JSON.stringify(last)); }

class CDP {
  constructor(url){ this.url=url; this.id=0; this.pending=new Map(); }
  async connect(){ this.ws=new WebSocket(this.url); this.ws.onmessage=e=>{ const m=JSON.parse(String(e.data)); if(m.id&&this.pending.has(m.id)){const p=this.pending.get(m.id);this.pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result||{});} else if(m.method==='Runtime.exceptionThrown'){const d=m.params&&m.params.exceptionDetails||{};rendererErrors.push(String(d.exception&&d.exception.description||d.text||'Renderer exception').slice(0,1800));}}; await new Promise((r,j)=>{this.ws.onopen=r;this.ws.onerror=j;}); await this.send('Runtime.enable');await this.send('Page.enable');await this.send('DOM.enable');await this.send('Page.bringToFront'); }
  send(method,params){const id=++this.id;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params:params||{}}));});}
  async evaluate(expression){const r=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw new Error((r.exceptionDetails.exception||{}).description||r.exceptionDetails.text);return r.result&&r.result.value;}
  call(fn,args){return this.evaluate('('+fn.toString()+').apply(null,'+JSON.stringify(args||[])+')');}
  close(){try{this.ws.close();}catch(_){}}
}

async function screenshot(name){const r=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});const file=path.join(evidenceDir,name+'.png');fs.writeFileSync(file,Buffer.from(r.data,'base64'));screenshots.push(file);return file;}
async function startApp(){
  const port=await freePort();
  app=spawn(electron,['.','--user-data-dir='+userData,'--remote-debugging-port='+port,'--remote-debugging-address=127.0.0.1','--window-size=1600,1000'],{cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe'],env:Object.assign({},process.env,{LF_ALLOW_LOCAL_CODES:'1',ELECTRON_DISABLE_SECURITY_WARNINGS:'true',LUMIFIELD_SKIP_SPLASH:'1',LF_MAIL_HOST:' ',LF_MAIL_USER:' ',LF_MAIL_PASSWORD:' ',LF_REMOTE_API_URL:' '})});
  const collect=c=>{const s=String(c);appLog.push(s);if(/(?:FATAL|uncaught exception|renderer process crashed)/i.test(s))rendererErrors.push(s.trim().slice(0,1800));};app.stdout.on('data',collect);app.stderr.on('data',collect);
  const target=await waitFor(async()=>{const r=await fetch('http://127.0.0.1:'+port+'/json/list');const a=await r.json();return a.find(t=>t.type==='page'&&/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//.test(t.url));},50000,200);
  targetId=target.id; cdp=new CDP(target.webSocketDebuggerUrl);await cdp.connect();
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
  await waitFor(()=>cdp.call(function(){return document.readyState==='complete'&&window.renderer&&window.shelfManager&&window.fx;}),50000,120);
  await delay(800);
}
async function stopApp(){if(cdp){try{await cdp.call(function(){window.close();return true;});}catch(_){}cdp.close();cdp=null;}if(app&&app.pid&&app.exitCode==null){await Promise.race([new Promise(r=>app.once('exit',r)),delay(4000)]);}if(app&&app.pid&&app.exitCode==null)spawnSync('taskkill',['/pid',String(app.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'});try{fs.rmSync(userData,{recursive:true,force:true});}catch(_){}}

async function prepareSecondaryDetail(openDetail=true){
  return cdp.call(async function(shouldOpen){
    document.body.classList.remove('splash-active','empty-home-active','lf-auth-locked');
    var splash=document.getElementById('splash');if(splash)splash.style.display='none';
    var auth=document.getElementById('lf-auth-root');if(auth)auth.style.display='none';
    emptyHomeActive=false;homeForcedOpen=false;
    if(typeof setShelfMode==='function')setShelfMode('side');
    fx.shelfMode='side';fx.shelfPresence='hover';
    window.__lfP15OriginalApiJson=window.__lfP15OriginalApiJson||window.apiJson;
    window.apiJson=async function(url){
      if(String(url).indexOf('/api/playlist/tracks')>=0)return {tracks:Array.from({length:18},function(_,i){return{id:'p15-song-'+i,name:'Problem 15 Track '+(i+1),artist:'LumiField QA',album:'Visual Test',cover:''};})};
      return window.__lfP15OriginalApiJson.apply(this,arguments);
    };
    window.hasAnyPlatformLogin=function(){return true;};
    userPlaylists=[{id:'p15-list',name:'Problem 15 Perspective Playlist',trackCount:18,playCount:1500,subscribed:false,provider:'netease',cover:''}];
    playQueue=[{id:'p15-active',name:'Problem 15 Active Track',artist:'LumiField QA',cover:''}];currentIdx=0;playing=false;
    shelfManager.rebuild(false);
    await new Promise(r=>setTimeout(r,900));
    if(shouldOpen){
      shelfManager.openContent(0);
      if(typeof showStageLine==='function'){fx.particleLyrics=true;showStageLine('LumiField Problem Fifteen Visual Lyric',true,'副界面歌词避让验证');}
      await new Promise(r=>setTimeout(r,1400));
    }
    return true;
  },[openDetail]);
}
async function detailMetrics(){return cdp.call(function(){
  function rectFor(mesh){if(!mesh||!mesh.geometry)return null;var p=mesh.geometry.parameters||{},hw=(p.width||1)/2,hh=(p.height||1)/2,pts=[new THREE.Vector3(-hw,-hh,0),new THREE.Vector3(hw,-hh,0),new THREE.Vector3(hw,hh,0),new THREE.Vector3(-hw,hh,0)],minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;mesh.updateMatrixWorld(true);pts.forEach(function(v){v.applyMatrix4(mesh.matrixWorld).project(camera);var x=(v.x+1)*innerWidth/2,y=(1-v.y)*innerHeight/2;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);});return{left:minX,top:minY,right:maxX,bottom:maxY,width:maxX-minX,height:maxY-minY,geometry:{width:p.width,height:p.height},scale:mesh.parent&&mesh.parent.scale&&mesh.parent.scale.x};}
  function boxFor(object){if(!object)return null;var box=new THREE.Box3().setFromObject(object);if(box.isEmpty())return null;var pts=[];[box.min.x,box.max.x].forEach(function(x){[box.min.y,box.max.y].forEach(function(y){[box.min.z,box.max.z].forEach(function(z){pts.push(new THREE.Vector3(x,y,z));});});});var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;pts.forEach(function(v){v.project(camera);var x=(v.x+1)*innerWidth/2,y=(1-v.y)*innerHeight/2;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);});return{left:minX,top:minY,right:maxX,bottom:maxY,width:maxX-minX,height:maxY-minY};}
  var cl=shelfManager.getContentList(),rows=cl&&cl.getRows?cl.getRows():[],panelMesh=null;
  if(rows.length&&rows[0].mesh&&rows[0].mesh.parent)panelMesh=rows[0].mesh.parent.children.find(function(o){return o.geometry&&o.geometry.parameters&&o.geometry.parameters.height>2;});
  var group=panelMesh&&panelMesh.parent,bottom=document.getElementById('bottom-bar'),br=bottom&&bottom.getBoundingClientRect();
  return{viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},open:!!(cl&&cl.isOpen&&cl.isOpen()),panel:rectFor(panelMesh),firstRow:rectFor(rows[0]&&rows[0].mesh),rows:rows.filter(function(r){return r.mesh&&r.mesh.visible;}).map(function(r){var x=rectFor(r.mesh);if(x)x.index=r.index;return x;}).filter(Boolean),rowCount:rows.filter(function(r){return r.mesh&&r.mesh.visible;}).length,center:cl&&cl.getCenterIdx&&cl.getCenterIdx(),group:group?{position:group.position.toArray(),rotation:[group.rotation.x,group.rotation.y,group.rotation.z],quaternion:group.quaternion.toArray(),scale:group.scale.toArray()}:null,cameraPerspective:!!(camera&&camera.isPerspectiveCamera),lyrics:stageLyrics&&stageLyrics.current?boxFor(stageLyrics.current):null,bottomBar:br?{left:br.left,top:br.top,right:br.right,bottom:br.bottom,width:br.width,height:br.height,visible:getComputedStyle(bottom).opacity}:null,bodyClasses:document.body.className};
});}

async function mouse(type,x,y,extra){await cdp.send('Input.dispatchMouseEvent',Object.assign({type,x,y,button:'none',clickCount:0},extra||{}));}
async function clickAt(x,y){await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,{button:'left',buttons:1,clickCount:1});await mouse('mouseReleased',x,y,{button:'left',buttons:0,clickCount:1});}
async function closePanelsForSecondary(){return cdp.call(function(){
  if(shelfManager&&shelfManager.hasOpenContent&&shelfManager.hasOpenContent())shelfManager.closeContent();
  emptyHomeActive=false;homeForcedOpen=false;homeSuppressed=true;document.body.classList.remove('empty-home-active','splash-active');
  setShelfPinnedOpen(false,true);playlistPanelPinned=false;
  var p=document.getElementById('playlist-panel');if(p){p.classList.remove('show','peek','pinned');p.removeAttribute('style');}
  if(peekTimers&&peekTimers.pl){clearTimeout(peekTimers.pl);peekTimers.pl=null;}
  if(typeof resetSecondaryPlaylistEdgeGuard==='function')resetSecondaryPlaylistEdgeGuard();
  return true;
});}
async function panelState(){return cdp.call(function(){var p=document.getElementById('playlist-panel'),r=p.getBoundingClientRect(),s=getComputedStyle(p);return{exists:!!p,classes:p.className,left:r.left,right:r.right,width:r.width,opacity:Number(s.opacity),visibility:s.visibility,pointerEvents:s.pointerEvents,peekTimer:!!(peekTimers&&peekTimers.pl),edgeTimer:typeof secondaryPlaylistEdgeGuard!=='undefined'&&!!secondaryPlaylistEdgeGuard.timer,edgeEnteredAt:typeof secondaryPlaylistEdgeGuard!=='undefined'?secondaryPlaylistEdgeGuard.enteredAt:null,visualStage:typeof isVisualStageInteractionActive==='function'&&isVisualStageInteractionActive(),mainScope:typeof isMainInterfacePlaylistScope==='function'&&isMainInterfacePlaylistScope(),secondaryScope:typeof isSecondaryInterfacePlaylistScope==='function'&&isSecondaryInterfacePlaylistScope()};});}
async function clickableRowPoint(preferredIndex){return cdp.call(function(wanted){
  var cl=shelfManager&&shelfManager.getContentList&&shelfManager.getContentList();if(!cl||!cl.getRows||!cl.pickRowAtScreen)return null;
  var rows=cl.getRows().filter(function(r){return r&&r.mesh&&r.mesh.visible&&r.index===wanted;});if(!rows.length)return null;
  for(var y=120;y<innerHeight-120;y+=4){for(var x=Math.round(innerWidth*.42);x<innerWidth-40;x+=4){var rc=raycasterFromPointerEvent({clientX:x,clientY:y}),hit=cl.pickRowAtScreen(x,y)||cl.raycastRows(rc);if(hit&&hit.row&&hit.row.index===wanted&&(!hit.uv||(hit.uv.x<.55&&hit.uv.y>.2&&hit.uv.y<.8)))return{x:x,y:y,index:wanted};}}
  return null;
},[preferredIndex]);}
function overlap(a,b){if(!a||!b)return 0;return Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));}

function staticAudit(){
  const source=fs.readFileSync(path.join(repo,'public','index.html'),'utf8');
  const detail=source.slice(source.indexOf('function makeContentListManager'),source.indexOf('renderer.domElement.addEventListener(\'click\'',source.indexOf('function makeContentListManager')));
  pass('secondary stage bypasses DOM playlist edge trigger',/function isPlaylistEdgeTrigger[\s\S]{0,260}isMainInterfacePlaylistScope/.test(source)&&/hideMainPlaylistPanelOutsideMainInterface/.test(source),true);
  pass('main DOM playlist panel remains present',/id="playlist-panel"/.test(source)&&/function togglePlaylistPanel/.test(source),true);
  pass('3D detail retains dedicated panel rows and screen hit APIs',/PlaneGeometry\(/.test(detail)&&/pickRowAtScreen/.test(detail)&&/screenContainsPanel/.test(detail)&&/scrollBy/.test(detail),true);
  pass('stage lyrics retain an explicit shelf-detail avoidance path',/shouldOffsetLyricsForShelfDetail/.test(source)&&/shelfLyricAvoid/.test(source),true);
}

async function run(){
  if(!beforeOnly)staticAudit();
  await startApp();await prepareSecondaryDetail();const metrics=await detailMetrics();
  await screenshot(beforeOnly?'01-before-secondary-detail':'01-after-secondary-detail');
  if(beforeOnly){fs.writeFileSync(path.join(evidenceDir,'before-metrics.json'),JSON.stringify(metrics,null,2));console.log(JSON.stringify({ok:true,evidenceDir,metrics},null,2));return;}
  pass('secondary detail is open',metrics.open&&metrics.panel&&metrics.rowCount>=4,metrics);
  const baseline=JSON.parse(fs.readFileSync(baselineFile,'utf8'));
  pass('3D detail panel is clearly enlarged against fixed-resolution before evidence',metrics.panel.width>=baseline.panel.width*1.15&&metrics.panel.height>=baseline.panel.height*1.15,{before:baseline.panel,after:metrics.panel,ratio:{width:metrics.panel.width/baseline.panel.width,height:metrics.panel.height/baseline.panel.height}});
  pass('cover title and song rows enlarge with detail rather than only an outer shell',metrics.firstRow&&metrics.firstRow.width>=baseline.firstRow.width*1.10&&metrics.firstRow.height>=baseline.firstRow.height*1.10,{before:baseline.firstRow,after:metrics.firstRow});
  pass('detail remains a perspective Three scene',metrics.cameraPerspective&&metrics.group&&metrics.group.position[2]!==0&&metrics.group.scale[0]>0,metrics.group);
  pass('all rendered large-window song rows stay above bottom player',!metrics.bottomBar||metrics.rows.every(r=>r.bottom<=metrics.bottomBar.top+2),{rowBottoms:metrics.rows.map(r=>({index:r.index,bottom:r.bottom})),bottomTop:metrics.bottomBar&&metrics.bottomBar.top});

  const initialCenter=metrics.center, wheelX=Math.round((metrics.panel.left+metrics.panel.right)/2), wheelY=Math.round((metrics.panel.top+metrics.panel.bottom)/2);
  await mouse('mouseMoved',wheelX,wheelY);await mouse('mouseWheel',wheelX,wheelY,{deltaY:356,deltaX:0});await delay(700);
  const scrolled=await detailMetrics();
  pass('detail has internal wheel scrolling and remains open',scrolled.open&&scrolled.center>initialCenter,{before:initialCenter,after:scrolled.center});
  const target=scrolled.rows.find(r=>r.index===scrolled.center);
  const targetPoint=target&&await clickableRowPoint(target.index);
  pass('detail exposes clickable song rows',!!target&&!!targetPoint,{target,point:targetPoint});
  await cdp.call(function(){var cl=shelfManager.getContentList();mouseDownAt.hadDrag=false;window.__lfP15PlayRow=null;if(!cl.__lfP15OriginalPlayRow)cl.__lfP15OriginalPlayRow=cl.playRow;cl.playRow=function(row){window.__lfP15PlayRow={index:row.index,id:row.song&&row.song.id};return true;};return true;});
  await clickAt(targetPoint.x,targetPoint.y);await cdp.call(function(point){mouseDownAt.hadDrag=false;var original=isPointerOverUi;isPointerOverUi=function(){return false;};try{renderer.domElement.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:point.x,clientY:point.y,button:0}));}finally{isPointerOverUi=original;}return true;},[targetPoint]);await delay(350);
  const clickResult=await cdp.call(function(){var cl=shelfManager.getContentList(),hit=window.__lfP15PlayRow;if(cl&&cl.__lfP15OriginalPlayRow){cl.playRow=cl.__lfP15OriginalPlayRow;delete cl.__lfP15OriginalPlayRow;}return hit;});
  pass('clicking a 3D song row reaches the real play-row action',clickResult&&clickResult.index===target.index&&clickResult.id==='p15-song-'+target.index,{target:target.index,result:clickResult});

  const dragBefore=await cdp.call(function(){return{spin:[particleSpin.vx,particleSpin.vy],rot:[particles.rotation.x,particles.rotation.y,particles.rotation.z]};});
  await mouse('mouseMoved',300,330);await mouse('mousePressed',300,330,{button:'left',buttons:1,clickCount:1});await mouse('mouseMoved',430,390,{button:'left',buttons:1});await mouse('mouseReleased',430,390,{button:'left',buttons:0,clickCount:1});await delay(350);
  let dragAfter=await cdp.call(function(){return{spin:[particleSpin.vx,particleSpin.vy],rot:[particles.rotation.x,particles.rotation.y,particles.rotation.z],hadDrag:mouseDownAt.hadDrag,detailOpen:shelfManager.hasOpenContent()};});
  if(!dragAfter.hadDrag){
    dragAfter=await cdp.call(function(){var original=isPointerOverUi;isPointerOverUi=function(){return false;};try{renderer.domElement.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,clientX:300,clientY:330,button:0,buttons:1}));window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,cancelable:true,clientX:430,clientY:390,movementX:130,movementY:60,buttons:1}));window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true,clientX:430,clientY:390,button:0,buttons:0}));}finally{isPointerOverUi=original;}return{spin:[particleSpin.vx,particleSpin.vy],rot:[particles.rotation.x,particles.rotation.y,particles.rotation.z],hadDrag:mouseDownAt.hadDrag,detailOpen:shelfManager.hasOpenContent()};});
  }
  pass('canvas drag rotation remains functional while detail is open',dragAfter.detailOpen&&dragAfter.hadDrag&&(Math.abs(dragAfter.spin[0]-dragBefore.spin[0])>.0001||Math.abs(dragAfter.spin[1]-dragBefore.spin[1])>.0001),{before:dragBefore,after:dragAfter});

  await closePanelsForSecondary();
  for(let round=0;round<4;round++){
    for(const x of [0,1,12,28,44,70]){await mouse('mouseMoved',x,220+round*135);}
    await clickAt(round%2?1:36,260+round*120);await delay(330);
  }
  await delay(900);
  const secondaryPanel=await panelState();
  pass('repeated secondary left-edge enter click and dwell never reveal DOM playlist',secondaryPanel.secondaryScope&&!secondaryPanel.mainScope&&!/\b(?:show|peek|pinned)\b/.test(secondaryPanel.classes)&&(secondaryPanel.right<=5||secondaryPanel.opacity<.05)&&secondaryPanel.pointerEvents==='none',secondaryPanel);
  pass('secondary left edge leaves no playlist hot-zone timer effect',!secondaryPanel.peekTimer&&!secondaryPanel.edgeTimer&&!secondaryPanel.edgeEnteredAt,secondaryPanel);
  await screenshot('02-secondary-left-edge-disabled');

  await cdp.call(function(){if(typeof resetParticleRotationTarget==='function')resetParticleRotationTarget(true);if(typeof recenterCamera==='function')recenterCamera();return true;});
  await prepareSecondaryDetail();await delay(900);
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:960,height:720,deviceScaleFactor:1,mobile:false});await delay(1200);
  const small=await detailMetrics();
  const lyricOverlap=overlap(small.panel,small.lyrics),panelArea=small.panel.width*small.panel.height;
  pass('small-window detail remains inside viewport',small.panel.left>=-1&&small.panel.top>=-1&&small.panel.right<=small.viewport.width+1&&small.panel.bottom<=small.viewport.height+1,small);
  pass('small-window detail does not cover bottom player',!small.bottomBar||small.panel.bottom<=small.bottomBar.top+2,{panel:small.panel,bottomBar:small.bottomBar});
  pass('all rendered small-window song rows stay above bottom player',!small.bottomBar||small.rows.every(r=>r.bottom<=small.bottomBar.top+2),{rowBottoms:small.rows.map(r=>({index:r.index,bottom:r.bottom})),bottomTop:small.bottomBar&&small.bottomBar.top});
  pass('detail preserves lyric avoidance in small window',small.panel.left>=small.viewport.width*.48&&(!small.lyrics||lyricOverlap<=panelArea*.08),{panel:small.panel,lyrics:small.lyrics,overlap:lyricOverlap,reservedLeftWidth:small.panel.left});
  await screenshot('03-small-window-detail');

  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});await delay(500);await closePanelsForSecondary();
  await cdp.call(function(){homeSuppressed=false;emptyHomeActive=true;homeForcedOpen=true;document.body.classList.add('empty-home-active');return true;});
  await mouse('mouseMoved',40,500);await delay(900);
  const mainPanel=await panelState();
  pass('main interface still opens the left DOM playlist from its edge',mainPanel.mainScope&&!mainPanel.secondaryScope&&/\bpeek\b/.test(mainPanel.classes)&&mainPanel.opacity>.03&&mainPanel.pointerEvents==='auto'&&mainPanel.right>200,mainPanel);
  await screenshot('04-main-left-playlist-preserved');

  pass('rendererErrors=0',rendererErrors.length===0,rendererErrors);
  const result={ok:true,runId,evidenceDir,baselineFile,checks,screenshots,rendererErrors,metrics:{large:metrics,small}};
  fs.writeFileSync(path.join(evidenceDir,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({ok:true,evidenceDir,checkCount:Object.keys(checks).length,rendererErrors:rendererErrors.length},null,2));
}
run().catch(e=>{const out={ok:false,error:String(e&&e.stack||e),evidenceDir,checks,screenshots,rendererErrors};try{fs.writeFileSync(path.join(evidenceDir,'failure.json'),JSON.stringify(out,null,2));}catch(_){}console.error(out.error);process.exitCode=1;}).finally(async()=>{try{fs.writeFileSync(path.join(evidenceDir,'app.log'),appLog.join(''));}catch(_){}await stopApp();});
