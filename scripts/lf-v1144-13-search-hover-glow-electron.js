'use strict';

const assert=require('assert');
const crypto=require('crypto');
const fs=require('fs');
const net=require('net');
const os=require('os');
const path=require('path');
const {spawn}=require('child_process');

const repo=path.resolve(__dirname,'..');
const dependencyRoot=process.env.LF_DEPENDENCY_ROOT||path.resolve(repo,'..','..','release','verify-v1.1.43-tag','node_modules');
const electronExe=path.join(dependencyRoot,'electron','dist','electron.exe');
const evidenceDir=path.join(repo,'test-results','lf-v1144-13-search-hover-glow',new Date().toISOString().replace(/[:.]/g,'-'));
const userData=fs.mkdtempSync(path.join(os.tmpdir(),'lf-v1144-13-'));
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
  async mouseMove(x,y){await this.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:Math.round(x),y:Math.round(y),button:'none',buttons:0,pointerType:'mouse'});}
  async screenshot(name){const response=await this.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});const file=path.join(evidenceDir,name);fs.writeFileSync(file,Buffer.from(response.data,'base64'));screenshots.push({file:path.basename(file),bytes:fs.statSync(file).size,sha256:sha256File(file)});}
  close(){try{this.ws.close();}catch(_){}}
}

function staticChecks(){
  const css=fs.readFileSync(path.join(repo,'public','lf-animated-search.css'),'utf8');
  const js=fs.readFileSync(path.join(repo,'public','lf-animated-search.js'),'utf8');
  const hoverBlock=css.slice(css.indexOf('#search-box[data-lf-animated-search="true"]:hover .lf-animated-search-glow{'),css.indexOf('#search-box[data-lf-animated-search="true"][data-composing="true"]'));
  pass('glow animation is paused by default',/animation:lf-search-glow-orbit[\s\S]*?animation-play-state:paused/.test(css),true);
  pass('the entire glow layer is fully hidden with no delayed fade when idle',/--lf-search-glow-idle-opacity:0/.test(css)&&/visibility:hidden/.test(css)&&/transition:none/.test(css),true);
  pass('only visible hover starts the border animation',/body:not\(\.render-deep-sleep\) #search-area\.peek #search-box\[data-lf-animated-search="true"\]:hover[\s\S]*?animation-play-state:running/.test(hoverBlock),true);
  pass('focus and nonempty input no longer keep the glow active',!/:focus-within \.lf-animated-search-glow|\[data-has-value="true"\] \.lf-animated-search-glow|:has\(#search-input:not\(:placeholder-shown\)\) \.lf-animated-search-glow/.test(hoverBlock),true);
  pass('IME composition can brighten the flow only while the pointer is also hovering',/\[data-composing="true"\]:hover \.lf-animated-search-glow/.test(css)&&!/\[data-composing="true"\] \.lf-animated-search-glow\{/.test(css),true);
  pass('search behavior adds no animation frame or interval loop',!/requestAnimationFrame|setInterval/.test(js),true);
}

async function listTargets(port){return(await fetch(`http://127.0.0.1:${port}/json/list`)).json();}
async function startApp(){
  assert.ok(fs.existsSync(electronExe),`Electron not found: ${electronExe}`);const port=await freePort();
  app=spawn(electronExe,['.',`--user-data-dir=${userData}`,`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1'],{cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe'],env:Object.assign({},process.env,{NODE_PATH:dependencyRoot,LF_MASTER_TEST:'1',LUMIFIELD_SKIP_SPLASH:'1',ELECTRON_DISABLE_SECURITY_WARNINGS:'true'})});
  const collect=data=>appLog.push(String(data));app.stdout.on('data',collect);app.stderr.on('data',collect);
  const target=await waitFor(async()=>{const targets=await listTargets(port);return targets.find(item=>item.type==='page'&&/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?(?:index\.html)?$/i.test(item.url));},60000);
  cdp=new CDP(target.webSocketDebuggerUrl);await cdp.connect();
  await waitFor(()=>cdp.evaluate(`document.readyState==='complete'&&!!window.LumiFieldAnimatedSearch`),60000);
}

async function prepare(){
  await cdp.evaluate(`(()=>{const hide=node=>{if(!node)return;node.classList.remove('show','active');node.style.setProperty('display','none','important');node.style.setProperty('visibility','hidden','important');};document.querySelectorAll('.modal-mask,#lf-auth-root,#visual-guide').forEach(hide);if(typeof closeVisualGuide==='function')closeVisualGuide(true);document.body.classList.remove('splash-active','splash-revealing','lf-auth-locked','visual-guide-active','render-deep-sleep');const area=document.getElementById('search-area');area.classList.add('peek');area.style.removeProperty('display');if(typeof setPeek==='function')setPeek(area,true,'search');const input=document.getElementById('search-input');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));input.blur();return{rect:document.getElementById('search-box').getBoundingClientRect().toJSON(),width:innerWidth,height:innerHeight};})()`);
  const dims=await cdp.evaluate(`({width:innerWidth,height:innerHeight})`);await cdp.mouseMove(dims.width-8,dims.height-8);
  return waitFor(()=>cdp.evaluate(`(()=>{const box=document.getElementById('search-box'),glow=box&&box.querySelector('.lf-animated-search-glow'),r=box&&box.getBoundingClientRect();if(!r||!r.width)return null;const p=getComputedStyle(glow,'::before');return{rect:r.toJSON(),state:p.animationPlayState,name:p.animationName,angle:p.getPropertyValue('--lf-search-glow-angle').trim(),debug:LumiFieldAnimatedSearch.getDebug()};})()`));
}

async function sample(){return cdp.evaluate(`(()=>{const box=document.getElementById('search-box'),glow=box.querySelector('.lf-animated-search-glow'),style=getComputedStyle(glow),p=getComputedStyle(glow,'::before');return{state:p.animationPlayState,name:p.animationName,angle:parseFloat(p.getPropertyValue('--lf-search-glow-angle'))||0,opacity:parseFloat(style.opacity),visibility:style.visibility,rect:box.getBoundingClientRect().toJSON(),focused:document.activeElement===document.getElementById('search-input'),hovered:box.matches(':hover'),hasValue:box.dataset.hasValue,mode:LumiFieldAnimatedSearch.getDebug().mode};})()`);}

async function runtimeChecks(){
  const initial=await prepare();
  pass('default search glow is fully absent and its animation is stopped',initial.state==='paused'&&initial.name==='lf-search-glow-orbit'&&initial.debug.glowCount===1&&initial.debug.ownRafCount===0,initial);
  const defaultA=await sample();await delay(220);const defaultB=await sample();
  pass('idle glow remains invisible with a fixed angle over time',defaultA.opacity===0&&defaultA.visibility==='hidden'&&defaultB.opacity===0&&defaultB.visibility==='hidden'&&Math.abs(defaultB.angle-defaultA.angle)<0.2,{before:defaultA,after:defaultB});
  await cdp.screenshot('search-idle-no-glow.png');

  await cdp.evaluate(`(()=>{const input=document.getElementById('search-input');input.focus({preventScroll:true});input.value='保持焦点和值';input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  const focusA=await sample();await delay(220);const focusB=await sample();
  pass('focus and a nonempty value cannot show start or retain the flow',focusA.focused&&focusA.hasValue==='true'&&focusA.state==='paused'&&focusA.opacity===0&&focusA.visibility==='hidden'&&focusB.state==='paused'&&focusB.opacity===0&&Math.abs(focusB.angle-focusA.angle)<0.2,{before:focusA,after:focusB});
  await cdp.evaluate(`document.getElementById('search-input').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'测'}))`);
  const composingAway=await sample();
  pass('composition away from the search box cannot reveal the flow',composingAway.opacity===0&&composingAway.visibility==='hidden'&&composingAway.state==='paused',composingAway);
  await cdp.evaluate(`document.getElementById('search-input').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'测'}))`);

  const box=focusB.rect;await cdp.mouseMove(box.left+box.width/2,box.top+box.height/2);
  const hoverA=await waitFor(async()=>{const value=await sample();return value.state==='running'?value:null;});
  for(let index=0;index<4;index+=1){await delay(60);await cdp.mouseMove(box.left+box.width/2,box.top+box.height/2);}
  const hoverB=await sample();
  pass('pointer hover alone starts and reveals visible border motion',hoverA.hovered&&hoverA.visibility==='visible'&&hoverB.state==='running'&&Math.abs(hoverB.angle-hoverA.angle)>5&&hoverB.opacity>0,{before:hoverA,after:hoverB});
  pass('hover changes no search geometry',Math.abs(hoverB.rect.left-box.left)<0.5&&Math.abs(hoverB.rect.top-box.top)<0.5&&Math.abs(hoverB.rect.width-box.width)<0.5&&Math.abs(hoverB.rect.height-box.height)<0.5,{before:box,after:hoverB.rect});
  await cdp.screenshot('search-hover-glow.png');

  const dims=await cdp.evaluate(`({width:innerWidth,height:innerHeight})`);const leaveStarted=Date.now();await cdp.mouseMove(dims.width-8,dims.height-8);
  const leaveA=await waitFor(async()=>{const value=await sample();return value.state==='paused'&&value.opacity===0&&value.visibility==='hidden'?value:null;},500,15);const leaveLatencyMs=Date.now()-leaveStarted;await delay(220);const leaveB=await sample();
  pass('pointer leave stops and fully disappears in the same interaction frame',leaveLatencyMs<120&&leaveA.focused&&leaveA.hasValue==='true'&&leaveA.state==='paused'&&leaveA.opacity===0&&leaveA.visibility==='hidden'&&leaveB.state==='paused'&&leaveB.opacity===0&&Math.abs(leaveB.angle-leaveA.angle)<0.2,{leaveLatencyMs,immediate:leaveA,held:leaveB});

  await cdp.evaluate(`document.getElementById('search-area').classList.add('stage-mode')`);await cdp.mouseMove(box.left+box.width/2,box.top+box.height/2);
  const secondary=await waitFor(async()=>{const value=await sample();return value.mode==='secondary'&&value.state==='running'?value:null;});
  pass('the same hover-only rule works in the secondary interface',secondary.mode==='secondary'&&secondary.state==='running',secondary);
  await cdp.evaluate(`document.body.classList.add('render-deep-sleep')`);
  const sleeping=await waitFor(async()=>{const value=await sample();return value.state==='paused'?value:null;});
  pass('background sleep overrides hover and pauses the border',sleeping.state==='paused',sleeping);
  await cdp.evaluate(`document.body.classList.remove('render-deep-sleep')`);

  await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const reduced=await waitFor(async()=>{const value=await sample();return value.name==='none'?value:null;});
  pass('reduced motion keeps a static border even under hover',reduced.name==='none',reduced);
  await cdp.send('Emulation.setEmulatedMedia',{features:[]});
  const integrity=await cdp.evaluate(`(()=>{for(let i=0;i<20;i++)LumiFieldAnimatedSearch.refresh();const d=LumiFieldAnimatedSearch.getDebug();return{debug:d,box:document.querySelectorAll('#search-box').length,input:document.querySelectorAll('#search-input').length,glow:document.querySelectorAll('.lf-animated-search-glow').length};})()`);
  pass('refresh cycles retain one shared search component and no private frame loop',integrity.box===1&&integrity.input===1&&integrity.glow===1&&integrity.debug.ownRafCount===0&&integrity.debug.ownIntervalCount===0,integrity);
  pass('renderer and console errors remain zero',rendererErrors.length===0&&consoleErrors.length===0,{rendererErrors,consoleErrors});
}

async function stopApp(){if(cdp){cdp.close();cdp=null;}if(app&&!app.killed){app.kill();await Promise.race([new Promise(resolve=>app.once('exit',resolve)),delay(4000)]);}app=null;}
(async()=>{let error=null;try{staticChecks();if(process.env.LF_V1144_13_STATIC_ONLY!=='1'){await startApp();await runtimeChecks();}}catch(caught){error=caught;process.exitCode=1;}finally{await stopApp();const result={task:'v1.1.44-problem-13',status:error?'FAIL':'PASS',checks,checkCount:Object.keys(checks).length,rendererErrors,consoleErrors,screenshots,appLog,error:error?String(error.stack||error):null};fs.writeFileSync(path.join(evidenceDir,'result.json'),JSON.stringify(result,null,2));process.stdout.write(`${JSON.stringify({status:result.status,checkCount:result.checkCount,evidenceDir},null,2)}\n`);}})();
