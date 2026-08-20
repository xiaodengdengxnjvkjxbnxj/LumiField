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
const dependencyRoot=process.env.LF_DEPENDENCY_ROOT||path.resolve(repo,'..','..','release','verify-v1.1.43-tag','node_modules');
const electronExe=path.join(dependencyRoot,'electron','dist','electron.exe');
const evidenceDir=path.join(repo,'test-results','lf-v1144-18-playlist-search-performance',new Date().toISOString().replace(/[:.]/g,'-'));
const userData=fs.mkdtempSync(path.join(os.tmpdir(),'lf-v1144-18-'));
const checks={};const rendererErrors=[];const consoleErrors=[];const screenshots=[];const appLog=[];
let app=null;let cdp=null;
fs.mkdirSync(evidenceDir,{recursive:true});
fs.mkdirSync(path.join(userData,'migrations'),{recursive:true});
fs.writeFileSync(path.join(userData,'migrations','legacy-upstream-platform-session-v2.json'),JSON.stringify({version:2,validated:true,testIsolation:true,results:[]}),{mode:0o600});

function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function pass(name,condition,detail){assert.ok(condition,`${name}: ${JSON.stringify(detail)}`);checks[name]=detail==null?true:detail;}
function sha256File(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();}
async function waitFor(fn,timeout=30000,interval=50){const started=Date.now();let last=null;while(Date.now()-started<timeout){try{last=await fn();if(last)return last;}catch(error){last=String(error&&error.message||error);}await delay(interval);}throw new Error(`Timeout: ${JSON.stringify(last)}`);}
function freePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.unref();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(error=>error?reject(error):resolve(port));});});}

class CDP{
  constructor(url){this.url=url;this.id=0;this.pending=new Map();}
  async connect(){this.ws=new WebSocket(this.url);this.ws.onmessage=event=>{const message=JSON.parse(String(event.data));if(message.id&&this.pending.has(message.id)){const pending=this.pending.get(message.id);this.pending.delete(message.id);clearTimeout(pending.timer);if(message.error)pending.reject(new Error(message.error.message));else pending.resolve(message.result||{});return;}if(message.method==='Runtime.exceptionThrown'){const detail=message.params&&message.params.exceptionDetails||{};rendererErrors.push(String(detail.exception&&detail.exception.description||detail.text||'renderer exception'));}if(message.method==='Runtime.consoleAPICalled'&&message.params&&message.params.type==='error')consoleErrors.push((message.params.args||[]).map(item=>item.value||item.description||'').join(' '));};await new Promise((resolve,reject)=>{this.ws.onopen=resolve;this.ws.onerror=reject;});await this.send('Runtime.enable');await this.send('Page.enable');}
  send(method,params,timeout=30000){const id=++this.id;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},timeout);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params:params||{}}));});}
  async evaluate(expression,timeout=30000){const response=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},timeout);if(response.exceptionDetails)throw new Error(response.exceptionDetails.exception&&response.exceptionDetails.exception.description||response.exceptionDetails.text);return response.result&&response.result.value;}
  async screenshot(name){const response=await this.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});const file=path.join(evidenceDir,name);fs.writeFileSync(file,Buffer.from(response.data,'base64'));screenshots.push({file:path.basename(file),bytes:fs.statSync(file).size,sha256:sha256File(file)});}
  close(){try{this.ws.close();}catch(_){} }
}

function staticChecks(){
  const index=fs.readFileSync(path.join(repo,'public','index.html'),'utf8');
  pass('all five music providers share the unified expanded-playlist renderer',['netease','qq','kugou','kugou_concept','qishui'].every(provider=>index.includes(`{ key:'${provider}'`))&&/loadUnifiedPlaylistTracks\(detailRef\.providerId, provider/.test(index),true);
  pass('large 2D details use fixed-height overscanned virtualization instead of cumulative load-more',/PLAYLIST_DETAIL_ROW_HEIGHT = 54/.test(index)&&/PLAYLIST_DETAIL_OVERSCAN = 5/.test(index)&&/pl-detail-virtual-spacer/.test(index)&&!/data-pl-detail-load-more/.test(index),true);
  pass('virtual scrolling replaces only the detail-list window on one rAF',/playlistPanelDetailVirtualFrame = requestAnimationFrame/.test(index)&&/list\.innerHTML = playlistPanelDetailVirtualHtml/.test(index)&&!/function maybeGrowPlaylistPanelDetailRenderLimit/.test(index),true);
  pass('row markup is memoized with a strict bounded cache',/PLAYLIST_DETAIL_ROW_MEMO_LIMIT = 512/.test(index)&&/playlistPanelDetailRowMemo\.size > PLAYLIST_DETAIL_ROW_MEMO_LIMIT/.test(index),true);
  pass('detail images decode asynchronously and both image caches stay bounded',/loading=\"lazy\" decoding=\"async\" fetchpriority=\"low\"/.test(index)&&/img\.decoding = 'async'/.test(index)&&/keys\.length <= 240/.test(index)&&/keys\.length - 200/.test(index),true);
  pass('search is local normalized and preserves original track indices',/normalize\('NFKC'\)/.test(index)&&/st\.searchCorpus\[i\]/.test(index)&&/data-pl-detail-row=\"' \+ originalIndex/.test(index),true);
  pass('button Enter clear and the exact no-result guidance are implemented',(index.match(/当前歌单中没有找到这首歌曲。可以尝试使用主界面顶部的全局搜索继续查找。/g)||[]).length>=2&&/e\.key === 'Enter'/.test(index)&&/clearPlaylistPanelDetailSearch/.test(index),true);
  pass('3D details have one pointer-safe search overlay backed by source tracks',/lf-3d-playlist-search/.test(index)&&/sourceTracks = \[\]/.test(index)&&/applyContentSearch/.test(index)&&/originalIndexForVisible/.test(index),true);
  const syncBlock=(index.match(/function syncRenderedRows\(force\) \{[\s\S]*?\n  \}\n\n  function contentMeshScreenRect/)||[])[0]||'';
  pass('3D row windows reuse overlap and dispose only rows that leave',/previousByIndex/.test(syncBlock)&&/nextRows/.test(syncBlock)&&/disposeRow\(previousByIndex\[key\]\)/.test(syncBlock)&&(syncBlock.match(/disposeRows\(\)/g)||[]).length===1&&/if \(!total\) \{ disposeRows\(\); return; \}/.test(syncBlock),true);
  pass('all expensive global hover work is merged into the single rAF mouse broker',(index.match(/window\.addEventListener\('mousemove'/g)||[]).length===1&&/processInterfaceHoverPointer\(e\)/.test(index),true);
  const inline=[...index.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match=>match[1]).filter(text=>text.trim());
  inline.forEach((source,indexValue)=>new vm.Script(source,{filename:`index-inline-${indexValue}.js`}));
  pass('all inline application scripts parse',inline.length>0,{count:inline.length});
}

async function listTargets(port){return(await fetch(`http://127.0.0.1:${port}/json/list`)).json();}
async function startApp(){
  assert.ok(fs.existsSync(electronExe),`Electron not found: ${electronExe}`);const port=await freePort();
  app=spawn(electronExe,['.',`--user-data-dir=${userData}`,`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1'],{cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe'],env:Object.assign({},process.env,{NODE_PATH:dependencyRoot,LF_MASTER_TEST:'1',LUMIFIELD_SKIP_SPLASH:'1',ELECTRON_DISABLE_SECURITY_WARNINGS:'true'})});
  const collect=data=>appLog.push(String(data));app.stdout.on('data',collect);app.stderr.on('data',collect);
  const target=await waitFor(async()=>{const targets=await listTargets(port);return targets.find(item=>item.type==='page'&&/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?(?:index\.html)?$/i.test(item.url));},60000);
  cdp=new CDP(target.webSocketDebuggerUrl);await cdp.connect();
  await waitFor(()=>cdp.evaluate(`document.readyState==='complete'&&!!window.LFAuth&&!!window.LumiFieldPlaylistDetailPerformance&&!!window.THREE&&!!window.gsap`),60000);
}

async function prepare(){
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false,screenWidth:1280,screenHeight:720});
  await cdp.evaluate(`(async()=>{
    if(typeof musicAccountScopeRestorePromise!=='undefined'&&musicAccountScopeRestorePromise)try{await musicAccountScopeRestorePromise;}catch(_){}
    await new Promise(r=>setTimeout(r,120));
    document.querySelectorAll('#lf-auth-root,#visual-guide,.visual-guide-scrim,.modal-mask,#drop-overlay').forEach(node=>{node.classList.remove('show','active');node.style.setProperty('display','none','important');node.setAttribute('aria-hidden','true');});
    document.body.classList.remove('lf-auth-locked','visual-guide-active','render-deep-sleep','splash-active');
    queueViewTab='playlists';
    document.getElementById('queue-pane').style.display='none';document.getElementById('pl-pane').style.display='';document.getElementById('podcast-pane').style.display='none';document.getElementById('tab-queue').classList.remove('active');document.getElementById('tab-pl').classList.add('active');
    const panel=document.getElementById('playlist-panel');panel.classList.add('show');panel.style.setProperty('display','block','important');panel.style.setProperty('visibility','visible','important');panel.style.setProperty('opacity','1','important');panel.style.setProperty('pointer-events','auto','important');panel.style.setProperty('transform','none','important');
    const providers=['netease','qq','kugou','kugou_concept','qishui'];
    window.__p18Fixtures={};
    providers.forEach((provider,pIndex)=>{window.__p18Fixtures[provider]=Array.from({length:2000},(_,i)=>({id:provider+'-'+i,name:i===1500?'稀有目标 '+provider+' 1500':provider+' 曲目 '+String(i).padStart(4,'0'),artist:'歌手 '+(i%37),album:'专辑 '+(i%19),provider}));});
    window.__p18OriginalLoadUnified=loadUnifiedPlaylistTracks;
    window.__p18OriginalRefreshUserPlaylists=refreshUserPlaylists;
    playlistProviderRequestSerial+=1000;
    loadUnifiedPlaylistTracks=async function(id,provider){return{state:'ready',tracks:(window.__p18Fixtures[provider]||[]).map(cloneSong)};};
    refreshUserPlaylists=async()=>({ok:true,testFixture:true});
    window.__p18Install2D=()=>{playlistProviderRequestSerial+=1000;playlistPanelLoadError='';playlistPanelDetailState=createPlaylistPanelDetailState({token:Number(playlistPanelDetailState&&playlistPanelDetailState.token||0)+1});playlistPanelDetailRowMemo.clear();userPlaylists=providers.map(provider=>({id:'fixture-'+provider,provider,name:'大型歌单 '+provider,creator:'LumiField QA',trackCount:2000}));playlistPanelRenderLimit=28;renderUserPlaylistsList();};
    window.__p18Install2D();
    return true;
  })()`);
}

async function clickAt(selector){
  const point=await cdp.evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)return null;node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect();const top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return{x:r.left+r.width/2,y:r.top+r.height/2,visible:r.width>0&&r.height>0,hit:!!(top&&(top===node||node.contains(top)))};})()`);
  assert.ok(point&&point.visible&&point.hit,`not hittable: ${selector} ${JSON.stringify(point)}`);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',buttons:1,clickCount:1});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',buttons:0,clickCount:1});
}

async function open2DProvider(provider){
  await cdp.evaluate(`(async()=>{window.__p18Install2D();await openPlaylistPanelDetail(${JSON.stringify(provider)},'fixture-'+${JSON.stringify(provider)},'大型歌单 '+${JSON.stringify(provider)});return true;})()`);
  try{return await waitFor(()=>cdp.evaluate(`(()=>{const d=LumiFieldPlaylistDetailPerformance.getDebug();return d.provider===${JSON.stringify(provider)}&&d.totalTrackCount===2000&&!playlistPanelDetailState.loading&&d;})()`),15000);}catch(error){const detail=await cdp.evaluate(`({debug:LumiFieldPlaylistDetailPerformance.getDebug(),state:{key:playlistPanelDetailState.key,loading:playlistPanelDetailState.loading,error:playlistPanelDetailState.error,phase:playlistPanelDetailState.phase},cards:Array.from(document.querySelectorAll('.pl-card')).map(n=>({provider:n.dataset.playlistProvider,id:n.dataset.playlistId,className:n.className}))})`);throw new Error(`open2DProvider ${provider}: ${JSON.stringify(detail)}; ${error.message}`);}
}

async function set2DSearch(value){
  await cdp.evaluate(`(()=>{const input=document.querySelector('[data-pl-detail-search-input]');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
}

async function runtime2DChecks(){
  const initial=await open2DProvider('netease');
  const initialDom=await cdp.evaluate(`({html:document.getElementById('pl-list').innerHTML.slice(0,500),cards:document.querySelectorAll('.pl-card').length,details:document.querySelectorAll('[data-pl-detail]').length,userPlaylists:userPlaylists.map(p=>({provider:p.provider,id:p.id})),panelError:playlistPanelLoadError})`);
  pass('a real 2000-track detail mounts a bounded virtual row window',initial.virtualized&&initial.totalTrackCount===2000&&initial.mountedRowCount>0&&initial.mountedRowCount<=20&&initial.rowMemoSize<=512,{initial,initialDom});
  await open2DProvider('netease');
  const positions=await cdp.evaluate(`(async()=>{const list=document.querySelector('.pl-detail-list');const out=[];for(const ratio of[0,.5,1]){list.scrollTop=(list.scrollHeight-list.clientHeight)*ratio;list.dispatchEvent(new Event('scroll'));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const d=LumiFieldPlaylistDetailPerformance.getDebug();out.push({ratio,mounted:d.mountedRowCount,start:d.virtualStart,end:d.virtualEnd,first:Number(list.querySelector('[data-pl-detail-row]')&&list.querySelector('[data-pl-detail-row]').dataset.plDetailRow),last:Number(Array.from(list.querySelectorAll('[data-pl-detail-row]')).at(-1).dataset.plDetailRow),scrollTop:list.scrollTop});}return out;})()`);
  pass('top middle and bottom scrolling keep DOM bounded while reaching correct source indices',positions.every(item=>item.mounted<=20)&&positions[0].first===0&&positions[1].first>800&&positions[2].last===1999,positions);
  const broker=await cdp.evaluate(`(async()=>{const before=LumiFieldPlaylistDetailPerformance.getDebug();for(let i=0;i<300;i++)window.dispatchEvent(new MouseEvent('mousemove',{clientX:100+i%600,clientY:120+i%300}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const after=LumiFieldPlaylistDetailPerformance.getDebug();return{events:after.pointerEvents-before.pointerEvents,frames:after.pointerFrames-before.pointerFrames};})()`);
  pass('a 300-event pointer burst executes expensive hover work only once per animation frame',broker.events===300&&broker.frames<=2,broker);

  await set2DSearch('稀有目标 netease 1500');
  await clickAt('[data-pl-detail-search-submit]');
  const filtered=await waitFor(()=>cdp.evaluate(`(()=>{const d=LumiFieldPlaylistDetailPerformance.getDebug(),rows=Array.from(document.querySelectorAll('[data-pl-detail-row]')).map(node=>({index:Number(node.dataset.plDetailRow),text:node.textContent}));return d.searchApplied&&d.visibleTrackCount===1?{debug:d,rows}:null;})()`));
  pass('the Search button returns only the requested song from the current playlist',filtered.debug.filteredIndices.length===1&&filtered.debug.filteredIndices[0]===1500&&filtered.rows.length===1&&filtered.rows[0].index===1500&&filtered.rows[0].text.includes('稀有目标 netease 1500'),filtered);

  await cdp.evaluate(`(()=>{window.__p18OriginalPlayQueueAt=playQueueAt;window.__p18OriginalEnterStage=enterVisualStageFromHome;playQueueAt=async()=>true;enterVisualStageFromHome=()=>{};return true;})()`);
  await clickAt('[data-pl-detail-row="1500"]');
  const played=await waitFor(()=>cdp.evaluate(`currentIdx===1500&&playQueue.length===2000&&({currentIdx,queueLength:playQueue.length,id:playQueue[currentIdx]&&playQueue[currentIdx].id})`));
  pass('clicking a filtered row still plays its original full-playlist index',played.currentIdx===1500&&played.queueLength===2000&&played.id==='netease-1500',played);
  await cdp.evaluate(`playQueueAt=window.__p18OriginalPlayQueueAt;enterVisualStageFromHome=window.__p18OriginalEnterStage;queueViewTab='playlists';document.getElementById('queue-pane').style.display='none';document.getElementById('pl-pane').style.display='';document.getElementById('tab-queue').classList.remove('active');document.getElementById('tab-pl').classList.add('active');renderUserPlaylistsList();true`);

  await set2DSearch('绝对不存在的歌曲');
  await cdp.evaluate(`document.querySelector('[data-pl-detail-search-input]').focus()`);
  await cdp.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
  await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
  const empty=await waitFor(()=>cdp.evaluate(`(()=>{const d=LumiFieldPlaylistDetailPerformance.getDebug(),node=document.querySelector('.pl-detail-empty');return d.searchApplied&&d.visibleTrackCount===0&&node?{debug:d,text:node.textContent.trim()}:null;})()`));
  pass('Enter shows the exact friendly no-result guidance',empty.text==='当前歌单中没有找到这首歌曲。可以尝试使用主界面顶部的全局搜索继续查找。',empty);
  await cdp.screenshot('playlist-search-no-result.png');
  await clickAt('[data-pl-detail-search-clear]');
  const restored=await waitFor(()=>cdp.evaluate(`(()=>{const d=LumiFieldPlaylistDetailPerformance.getDebug();return !d.searchApplied&&d.totalTrackCount===2000&&d.visibleTrackCount===2000&&!d.virtualFramePending&&d;})()`));
  pass('Clear restores the complete current playlist and its prior scroll position',restored.virtualScrollTop>500&&restored.virtualScrollTop===restored.fullScrollTop&&restored.mountedRowCount<=20,restored);

  const providers=['qq','kugou','kugou_concept','qishui'];
  const providerResults=[];
  for(const provider of providers){
    const opened=await open2DProvider(provider);
    await set2DSearch(`稀有目标 ${provider} 1500`);
    await cdp.evaluate(`document.querySelector('[data-pl-detail-search-submit]').click()`);
    const result=await waitFor(()=>cdp.evaluate(`(()=>{const d=LumiFieldPlaylistDetailPerformance.getDebug();return d.searchApplied&&d.visibleTrackCount===1?{provider:d.provider,index:d.filteredIndices[0],row:Number(document.querySelector('[data-pl-detail-row]').dataset.plDetailRow),mounted:d.mountedRowCount,total:d.totalTrackCount}:null;})()`));
    providerResults.push({opened:{provider:opened.provider,total:opened.totalTrackCount,mounted:opened.mountedRowCount},result});
  }
  pass('QQ Kugou Concept and Qishui use the same isolated current-playlist search',providerResults.every(item=>item.opened.total===2000&&item.opened.mounted<=20&&item.result.index===1500&&item.result.row===1500),providerResults);
  await cdp.screenshot('playlist-search-five-platforms.png');
}

async function runtime3DChecks(){
  const opened=await cdp.evaluate(`(async()=>{
    emptyHomeActive=false;homeForcedOpen=false;document.body.classList.remove('empty-home-active','splash-active');
    window.__p18Content=makeContentListManager();
    await window.__p18Content.open('fixture-netease','大型 3D 歌单',{item:{provider:'netease',playlistId:'fixture-netease',rawPlaylistId:'fixture-netease',title:'大型 3D 歌单',playlist:{id:'fixture-netease',provider:'netease'}}});
    for(let i=0;i<8;i++){window.__p18Content.update(1/60);await new Promise(r=>requestAnimationFrame(r));}
    return window.__p18Content.getDebug();
  })()`,30000);
  pass('the 3D expanded playlist loads 2000 source tracks with at most seven row objects',opened.state==='ready'&&opened.sourceTrackCount===2000&&opened.renderedRowCount<=7&&opened.searchOverlayCount===1,opened);
  const reuse=await cdp.evaluate(`(()=>{const before=__p18Content.getRows().map(row=>row.mesh.uuid);for(let i=0;i<4;i++)__p18Content.scrollBy(1);__p18Content.update(1/60);const after=__p18Content.getRows().map(row=>row.mesh.uuid);return{before,after,reused:after.filter(id=>before.includes(id)).length,debug:__p18Content.getDebug()};})()`);
  pass('3D scrolling reuses six overlapping rows instead of rebuilding all seven',reuse.before.length===7&&reuse.after.length===7&&reuse.reused===6&&reuse.debug.renderedRowCount===7,reuse);

  const overlay=await waitFor(()=>cdp.evaluate(`(()=>{__p18Content.update(1/60);const root=document.querySelector('.lf-3d-playlist-search'),input=root&&root.querySelector('input'),r=root&&root.getBoundingClientRect();return root&&root.classList.contains('show')&&r.width>0?{left:r.left,top:r.top,width:r.width,input:input.placeholder,count:document.querySelectorAll('.lf-3d-playlist-search').length}:null;})()`));
  pass('the 3D current-playlist search is a single visible pointer-safe top overlay',overlay.count===1&&overlay.input==='当前歌单内搜索'&&overlay.width>=280,overlay);
  await cdp.evaluate(`(()=>{const root=document.querySelector('.lf-3d-playlist-search'),input=root.querySelector('input');input.value='稀有目标 netease 1500';input.dispatchEvent(new Event('input',{bubbles:true}));root.querySelector('[data-lf-3d-search-submit]').click();__p18Content.update(1/60);return true;})()`);
  const searched=await waitFor(()=>cdp.evaluate(`(()=>{const d=__p18Content.getDebug(),text=document.querySelector('.lf-3d-playlist-search-status').textContent;return d.searchApplied&&d.visibleTrackCount===1?{debug:d,text}:null;})()`));
  pass('3D search displays only the requested source song and retains its original index',searched.debug.originalRowIndices.length===1&&searched.debug.originalRowIndices[0]===1500&&searched.text.includes('1/2000'),searched);

  await cdp.evaluate(`(()=>{const root=document.querySelector('.lf-3d-playlist-search'),input=root.querySelector('input');input.value='不存在的 3D 歌曲';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));__p18Content.update(1/60);return true;})()`);
  const noResult=await waitFor(()=>cdp.evaluate(`(()=>{const d=__p18Content.getDebug(),text=document.querySelector('.lf-3d-playlist-search-status').textContent.trim();return d.searchApplied&&text.includes('当前歌单中没有找到')?{debug:d,text}:null;})()`));
  pass('3D Enter uses the same exact no-result guidance',noResult.text==='当前歌单中没有找到这首歌曲。可以尝试使用主界面顶部的全局搜索继续查找。',noResult);
  await cdp.evaluate(`document.querySelector('[data-lf-3d-search-clear]').click();__p18Content.update(1/60);true`);
  const cleared=await waitFor(()=>cdp.evaluate(`(()=>{const d=__p18Content.getDebug();return !d.searchApplied&&d.sourceTrackCount===2000&&d.visibleTrackCount===2000&&d.renderedRowCount<=7&&d;})()`));
  pass('clearing 3D search restores all source tracks without growing resources',cleared.sourceTrackCount===2000&&cleared.visibleTrackCount===2000&&cleared.renderedRowCount<=7,cleared);
  await cdp.screenshot('playlist-search-3d.png');

  const lifecycle=await cdp.evaluate(`(async()=>{const providers=['netease','qq','kugou','kugou_concept','qishui'],out=[];for(const provider of providers){__p18Content.close();await new Promise(r=>setTimeout(r,210));await __p18Content.open('fixture-'+provider,'3D '+provider,{item:{provider,playlistId:'fixture-'+provider,rawPlaylistId:'fixture-'+provider,title:'3D '+provider,playlist:{id:'fixture-'+provider,provider}}});__p18Content.update(1/60);const root=document.querySelector('.lf-3d-playlist-search'),input=root.querySelector('input');input.value='稀有目标 '+provider+' 1500';input.dispatchEvent(new Event('input',{bubbles:true}));root.querySelector('[data-lf-3d-search-submit]').click();__p18Content.update(1/60);const d=__p18Content.getDebug();out.push({provider,openProvider:d.openRef&&d.openRef.provider,source:d.sourceTrackCount,visible:d.visibleTrackCount,original:d.originalRowIndices[0],overlays:d.searchOverlayCount,rows:d.renderedRowCount});}__p18Content.close();await new Promise(r=>setTimeout(r,230));return{out,overlayCount:document.querySelectorAll('.lf-3d-playlist-search').length};})()`,30000);
  pass('all five 3D platform details reset query state and keep one bounded overlay lifecycle',lifecycle.out.every(item=>item.openProvider===item.provider&&item.source===2000&&item.visible===1&&item.original===1500&&item.overlays===1&&item.rows<=7)&&lifecycle.overlayCount===0,lifecycle);
}

async function runtimeChecks(){
  await prepare();
  await runtime2DChecks();
  await runtime3DChecks();
  const final=await cdp.evaluate(`({overlays:document.querySelectorAll('.lf-3d-playlist-search').length,memo:LumiFieldPlaylistDetailPerformance.getDebug().rowMemoSize})`);
  pass('all temporary 3D search resources are released and the row memo remains bounded',final.overlays===0&&final.memo<=512,final);
  pass('renderer and console errors remain zero',rendererErrors.length===0&&consoleErrors.length===0,{rendererErrors,consoleErrors});
}

async function stopApp(){if(cdp){try{await cdp.evaluate(`if(window.__p18Content)window.__p18Content.close();if(window.__p18OriginalLoadUnified)loadUnifiedPlaylistTracks=window.__p18OriginalLoadUnified;true`);}catch(_){}cdp.close();cdp=null;}if(app&&!app.killed){app.kill();await Promise.race([new Promise(resolve=>app.once('exit',resolve)),delay(4000)]);}app=null;}

(async()=>{let error=null;try{staticChecks();if(process.env.LF_V1144_18_STATIC_ONLY!=='1'){await startApp();await runtimeChecks();}}catch(caught){error=caught;process.exitCode=1;}finally{await stopApp();const result={task:'v1.1.44-problem-18',status:error?'FAIL':'PASS',checks,checkCount:Object.keys(checks).length,rendererErrors,consoleErrors,screenshots,appLog,error:error?String(error.stack||error):null};fs.writeFileSync(path.join(evidenceDir,'result.json'),JSON.stringify(result,null,2));process.stdout.write(`${JSON.stringify({status:result.status,checkCount:result.checkCount,evidenceDir},null,2)}\n`);}})();
