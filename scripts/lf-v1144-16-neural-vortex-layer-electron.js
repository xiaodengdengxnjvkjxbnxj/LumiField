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
const evidenceDir=path.join(repo,'test-results','lf-v1144-16-neural-vortex-layer',new Date().toISOString().replace(/[:.]/g,'-'));
const userData=fs.mkdtempSync(path.join(os.tmpdir(),'lf-v1144-16-'));
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
  async evaluate(expression,timeout=30000){const response=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},timeout);if(response.exceptionDetails)throw new Error(response.exceptionDetails.exception&&response.exceptionDetails.exception.description||response.exceptionDetails.text);return response.result&&response.result.value;}
  async screenshot(name){const response=await this.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});const file=path.join(evidenceDir,name);fs.writeFileSync(file,Buffer.from(response.data,'base64'));screenshots.push({file:path.basename(file),bytes:fs.statSync(file).size,sha256:sha256File(file)});}
  close(){try{this.ws.close();}catch(_){} }
}

function staticChecks(){
  const index=fs.readFileSync(path.join(repo,'public','index.html'),'utf8');
  const auth=fs.readFileSync(path.join(repo,'public','lf-auth-monitor.js'),'utf8');
  const feature=fs.readFileSync(path.join(repo,'public','lf-profile-neural-vortex.js'),'utf8');
  const css=fs.readFileSync(path.join(repo,'public','lf-profile-neural-vortex.css'),'utf8');
  pass('the neural vortex assets load exactly once',(index.match(/lf-profile-neural-vortex\.css/g)||[]).length===1&&(index.match(/lf-profile-neural-vortex\.js/g)||[]).length===1,true);
  pass('the production lifecycle is limited to the My profile modal',/modal\.id !== 'lf-profile-modal'/.test(feature)&&/modal\.querySelector\('\.lf-profile-dialog'\)/.test(feature)&&/LumiFieldProfileNeuralVortex\.activate\(modal\)/.test(auth)&&/LumiFieldProfileNeuralVortex\.deactivate\(\)/.test(auth),true);
  pass('background vortex glass and controls have explicit ordered layers',/insertBefore\(state\.layer, state\.dialog\.firstChild\)[\s\S]{0,160}insertBefore\(state\.glass, state\.layer\.nextSibling\)/.test(feature)&&/lf-profile-neural-vortex[^}]*z-index:\s*0/.test(css)&&/lf-profile-neural-vortex-glass[^}]*z-index:\s*1/.test(css)&&/not\(\.lf-profile-neural-vortex-glass\)[^{]*\{[^}]*z-index:\s*2/.test(css)&&/\.lf-panel-x[^}]*z-index:\s*3/.test(css),true);
  pass('vortex canvas and glass are all pointer transparent',(css.match(/pointer-events:\s*none\s*!important/g)||[]).length>=3&&!/addEventListener\(['"](?:pointer|mouse)/.test(feature),true);
  pass('the feature consumes the existing shared pointer bus without a second pointer scheduler',/LumiFieldLiquidGlass/.test(feature)&&/addPointerConsumer\(handleSharedPointer\)/.test(feature)&&!/onpointermove|onmousemove/.test(feature),true);
  pass('the panel never blurs the neural shader',!/blur\s*\(/i.test(css)&&/backdrop-filter:\s*none\s*!important/.test(css)&&/filter:\s*none\s*!important/.test(css),true);
  pass('the supplied complete neural shader remains intact',/for \(int j = 0; j < 15; j\+\+\)/.test(feature)&&/neuro_shape\(uv, t, p\)/.test(feature)&&/DIRECT_WEBGL_ADAPTATION_FROM_USER_SUPPLIED_COMPLETE_SOURCE/.test(feature),true);
  pass('deactivation releases WebGL listeners pointer subscription and both background layers',/state\.unsubscribePointer\(\)/.test(feature)&&/removeEventListener\('resize'/.test(feature)&&/releaseWebGL\(\)/.test(feature)&&/state\.layer\.remove\(\)/.test(feature)&&/state\.glass\.remove\(\)/.test(feature),true);
  const inline=[...index.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match=>match[1]).filter(text=>text.trim());
  inline.forEach((source,indexValue)=>new vm.Script(source,{filename:`index-inline-${indexValue}.js`}));
  pass('all inline application scripts still parse',inline.length>0,{count:inline.length});
}

async function listTargets(port){return(await fetch(`http://127.0.0.1:${port}/json/list`)).json();}
async function startApp(){
  assert.ok(fs.existsSync(electronExe),`Electron not found: ${electronExe}`);const port=await freePort();
  app=spawn(electronExe,['.',`--user-data-dir=${userData}`,`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1'],{cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe'],env:Object.assign({},process.env,{NODE_PATH:dependencyRoot,LF_MASTER_TEST:'1',LUMIFIELD_SKIP_SPLASH:'1',ELECTRON_DISABLE_SECURITY_WARNINGS:'true'})});
  const collect=data=>appLog.push(String(data));app.stdout.on('data',collect);app.stderr.on('data',collect);
  const target=await waitFor(async()=>{const targets=await listTargets(port);return targets.find(item=>item.type==='page'&&/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?(?:index\.html)?$/i.test(item.url));},60000);
  cdp=new CDP(target.webSocketDebuggerUrl);await cdp.connect();
  await waitFor(()=>cdp.evaluate(`document.readyState==='complete'&&!!window.LFAuth&&!!window.LumiFieldProfileNeuralVortex&&!!window.LumiFieldLiquidGlass`),60000);
}

async function openProfile(){
  await cdp.evaluate(`(()=>{document.querySelectorAll('#lf-auth-root,#visual-guide,.visual-guide-scrim,.modal-mask').forEach(node=>{node.classList.remove('show','active');node.style.setProperty('display','none','important');node.setAttribute('aria-hidden','true');});document.body.classList.remove('lf-auth-locked','visual-guide-active','render-deep-sleep');LFAuth.openProfile();return true;})()`);
  return waitFor(()=>cdp.evaluate(`(()=>{const d=LumiFieldProfileNeuralVortex.getDebug();return d.active&&d.layerCount===1&&d.glassCount===1&&d.webglReady&&d.drawCount>0&&d;})()`),20000);
}

async function runtimeChecks(){
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false,screenWidth:1280,screenHeight:720});
  const baseline=await cdp.evaluate(`LumiFieldLiquidGlass.getDebug().pointerConsumerCount`);
  const opened=await openProfile();
  pass('opening My creates one live vortex one glass layer and one shared pointer consumer',opened.active&&opened.layerCount===1&&opened.glassCount===1&&opened.pointerConsumerCount===1,{feature:opened,baseline});
  const layout=await cdp.evaluate(`(()=>{const modal=document.getElementById('lf-profile-modal'),dialog=modal.querySelector('.lf-profile-dialog'),layer=document.getElementById('lf-profile-neural-vortex'),glass=document.getElementById('lf-profile-neural-vortex-glass'),canvas=document.getElementById('lf-profile-neural-vortex-canvas'),close=document.getElementById('lf-profile-close'),content=document.querySelector('.lf-profile-head');const s=n=>getComputedStyle(n);return{parent:layer.parentElement===dialog&&glass.parentElement===dialog,order:Array.from(dialog.children).map(n=>n===layer?'vortex':n===glass?'glass':'content'),z:{layer:s(layer).zIndex,glass:s(glass).zIndex,content:s(content).zIndex,close:s(close).zIndex},pointer:{layer:s(layer).pointerEvents,canvas:s(canvas).pointerEvents,glass:s(glass).pointerEvents},filters:{layer:s(layer).filter,canvas:s(canvas).filter,glass:s(glass).filter,dialog:s(dialog).filter,dialogBackdrop:s(dialog).backdropFilter||s(dialog).webkitBackdropFilter||'',glassBackdrop:s(glass).backdropFilter||s(glass).webkitBackdropFilter||'',closeBackdrop:s(close).backdropFilter||s(close).webkitBackdropFilter||''},otherHosts:['fx-panel','playlist-panel','user-modal','lf-account-manager'].map(id=>({id,count:document.querySelectorAll('#'+id+' #lf-profile-neural-vortex,#'+id+' #lf-profile-neural-vortex-glass').length}))};})()`);
  pass('computed order is background vortex glass content and close control',layout.parent&&layout.order[0]==='vortex'&&layout.order[1]==='glass'&&layout.z.layer==='0'&&layout.z.glass==='1'&&layout.z.content==='2'&&layout.z.close==='3',layout);
  pass('canvas and both non-content layers cannot capture pointer events',Object.values(layout.pointer).every(value=>value==='none'),layout.pointer);
  pass('the vortex remains sharp with no panel glass or close-button backdrop blur',Object.values(layout.filters).every(value=>value==='none'||value===''),layout.filters);
  pass('the vortex never appears inside any other panel',layout.otherHosts.every(item=>item.count===0),layout.otherHosts);

  const positions=await cdp.evaluate(`(()=>{const d=document.querySelector('.lf-profile-dialog').getBoundingClientRect();return[[d.left+d.width*.2,d.top+d.height*.25],[d.left+d.width*.5,d.top+d.height*.5],[d.left+d.width*.8,d.top+d.height*.75]];})()`);
  const pointerSamples=[];
  for(const position of positions){await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:position[0],y:position[1],button:'none',buttons:0});await delay(100);pointerSamples.push(await cdp.evaluate(`LumiFieldProfileNeuralVortex.getDebug()`));}
  pass('three real pointer moves update the shared interactive shader across the panel',pointerSamples.every(sample=>sample.pointer.inside)&&pointerSamples[2].pointer.updates>=pointerSamples[0].pointer.updates+2&&Math.abs(pointerSamples[2].pointer.targetX-pointerSamples[0].pointer.targetX)>.4&&Math.abs(pointerSamples[2].pointer.targetY-pointerSamples[0].pointer.targetY)>.3,{samples:pointerSamples.map(sample=>sample.pointer)});
  const liquidActive=await cdp.evaluate(`LumiFieldLiquidGlass.getDebug()`);
  pass('the neural effect adds exactly one consumer to the existing shared pointer scheduler',liquidActive.pointerConsumerCount===baseline+1&&liquidActive.pointerConsumerErrors===0,{baseline,active:liquidActive.pointerConsumerCount,errors:liquidActive.pointerConsumerErrors});

  const scrollGeometry=await cdp.evaluate(`(async()=>{const dialog=document.querySelector('.lf-profile-dialog'),layer=document.getElementById('lf-profile-neural-vortex'),glass=document.getElementById('lf-profile-neural-vortex-glass');const sample=()=>{const dr=dialog.getBoundingClientRect(),lr=layer.getBoundingClientRect(),gr=glass.getBoundingClientRect(),expected={left:dr.left+dialog.clientLeft,top:dr.top+dialog.clientTop,width:dialog.clientWidth,height:dialog.clientHeight};const delta=r=>({left:Math.abs(r.left-expected.left),top:Math.abs(r.top-expected.top),width:Math.abs(r.width-expected.width),height:Math.abs(r.height-expected.height)});return{scrollTop:dialog.scrollTop,max:Math.max(0,dialog.scrollHeight-dialog.clientHeight),layer:delta(lr),glass:delta(gr)};};const out=[];for(const ratio of[0,.5,1]){dialog.scrollTop=(dialog.scrollHeight-dialog.clientHeight)*ratio;dialog.dispatchEvent(new Event('scroll'));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));out.push(sample());}return out;})()`);
  const geometryOk=scrollGeometry.every(sample=>[sample.layer,sample.glass].every(delta=>Object.values(delta).every(value=>value<=1.1)));
  pass('vortex and glass remain pinned to the visible profile viewport while scrolling',geometryOk,scrollGeometry);

  const hit=await cdp.evaluate(`(()=>{const button=document.getElementById('lf-change-password'),dialog=document.querySelector('.lf-profile-dialog');button.scrollIntoView({block:'center'});dialog.dispatchEvent(new Event('scroll'));window.__lfP16ClickCount=0;button.addEventListener('click',()=>window.__lfP16ClickCount++,{once:true});return new Promise(resolve=>requestAnimationFrame(()=>{const r=button.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,top=document.elementFromPoint(x,y);resolve({x,y,buttonId:button.id,hitId:top&&top.id,hitInside:!!(top&&(top===button||button.contains(top)))});}));})()`);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:hit.x,y:hit.y,button:'left',buttons:1,clickCount:1});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:hit.x,y:hit.y,button:'left',buttons:0,clickCount:1});
  await delay(80);
  const clickCount=await cdp.evaluate(`window.__lfP16ClickCount`);
  pass('real hit-testing and clicking reach the profile control through both background layers',hit.hitInside&&hit.hitId==='lf-change-password'&&clickCount===1,{hit,clickCount});

  const reduced=await cdp.evaluate(`(async()=>{LumiFieldLiquidGlass.setTestMode({reducedMotion:true});await new Promise(r=>setTimeout(r,80));const paused=LumiFieldProfileNeuralVortex.getDebug();LumiFieldLiquidGlass.setTestMode({reducedMotion:false});await new Promise(r=>setTimeout(r,80));const resumed=LumiFieldProfileNeuralVortex.getDebug();return{paused,resumed};})()`);
  pass('reduced motion pauses the shader and restoring motion resumes the same instance',reduced.paused.paused&&reduced.paused.ownRafCount===0&&!reduced.resumed.paused&&reduced.resumed.ownRafCount===1&&reduced.resumed.layerCount===1&&reduced.resumed.glassCount===1,{paused:{paused:reduced.paused.paused,raf:reduced.paused.ownRafCount},resumed:{paused:reduced.resumed.paused,raf:reduced.resumed.ownRafCount}});
  await cdp.screenshot('my-neural-vortex-layer.png');

  const lifecycle=await cdp.evaluate(`(async()=>{const snapshots=[];for(let i=0;i<8;i++){document.getElementById('lf-profile-close').click();await new Promise(r=>setTimeout(r,45));snapshots.push({closed:LumiFieldProfileNeuralVortex.getDebug(),liquid:LumiFieldLiquidGlass.getDebug()});LFAuth.openProfile();await new Promise(r=>setTimeout(r,65));snapshots.push({opened:LumiFieldProfileNeuralVortex.getDebug(),liquid:LumiFieldLiquidGlass.getDebug()});}document.getElementById('lf-profile-close').click();await new Promise(r=>setTimeout(r,70));return{snapshots,final:LumiFieldProfileNeuralVortex.getDebug(),liquid:LumiFieldLiquidGlass.getDebug(),dom:{layer:document.querySelectorAll('#lf-profile-neural-vortex').length,glass:document.querySelectorAll('#lf-profile-neural-vortex-glass').length}};})()`,30000);
  const closed=lifecycle.snapshots.filter(item=>item.closed).every(item=>item.closed.layerCount===0&&item.closed.glassCount===0&&item.closed.pointerConsumerCount===0&&item.closed.ownListenerCount===0&&item.closed.ownRafCount===0&&item.closed.programCount===0&&item.closed.shaderCount===0&&item.closed.bufferCount===0&&item.closed.contextReleased&&item.liquid.pointerConsumerCount===baseline);
  const reopened=lifecycle.snapshots.filter(item=>item.opened).every(item=>item.opened.active&&item.opened.layerCount===1&&item.opened.glassCount===1&&item.opened.pointerConsumerCount===1&&item.opened.ownListenerCount===2&&item.opened.programCount===1&&item.opened.shaderCount===2&&item.opened.bufferCount===1&&item.liquid.pointerConsumerCount===baseline+1);
  pass('eight close and reopen cycles preserve one instance and release every resource',closed&&reopened&&lifecycle.final.layerCount===0&&lifecycle.final.glassCount===0&&lifecycle.final.pointerConsumerCount===0&&lifecycle.final.ownListenerCount===0&&lifecycle.final.ownRafCount===0&&lifecycle.dom.layer===0&&lifecycle.dom.glass===0,{closed,reopened,final:lifecycle.final,dom:lifecycle.dom,baseline,finalConsumers:lifecycle.liquid.pointerConsumerCount});
  pass('renderer and console errors remain zero',rendererErrors.length===0&&consoleErrors.length===0,{rendererErrors,consoleErrors});
}

async function stopApp(){if(cdp){cdp.close();cdp=null;}if(app&&!app.killed){app.kill();await Promise.race([new Promise(resolve=>app.once('exit',resolve)),delay(4000)]);}app=null;}

(async()=>{let error=null;try{staticChecks();if(process.env.LF_V1144_16_STATIC_ONLY!=='1'){await startApp();await runtimeChecks();}}catch(caught){error=caught;process.exitCode=1;}finally{await stopApp();const result={task:'v1.1.44-problem-16',status:error?'FAIL':'PASS',checks,checkCount:Object.keys(checks).length,rendererErrors,consoleErrors,screenshots,appLog,error:error?String(error.stack||error):null};fs.writeFileSync(path.join(evidenceDir,'result.json'),JSON.stringify(result,null,2));process.stdout.write(`${JSON.stringify({status:result.status,checkCount:result.checkCount,evidenceDir},null,2)}\n`);}})();
