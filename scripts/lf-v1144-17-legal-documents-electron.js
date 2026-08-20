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
const evidenceDir=path.join(repo,'test-results','lf-v1144-17-legal-documents',new Date().toISOString().replace(/[:.]/g,'-'));
const userData=fs.mkdtempSync(path.join(os.tmpdir(),'lf-v1144-17-'));
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
  const content=require(path.join(repo,'public','lf-legal-content'));
  const index=fs.readFileSync(path.join(repo,'public','index.html'),'utf8');
  const auth=fs.readFileSync(path.join(repo,'public','lf-auth-monitor.js'),'utf8');
  const backendSource=fs.readFileSync(path.join(repo,'desktop','lf-backend.js'),'utf8');
  const privacyText=JSON.stringify(content.privacy);
  const agreementText=JSON.stringify(content.agreement);
  const requiredPrivacy=['本地数据','音乐平台账号','Cookie','session','API Key','AI Provider','摄像头','麦克风','天气','第三方服务','网络请求','日志','本地缓存','删除','开源','更新','联系方式'];
  const requiredAgreement=['用户责任','内容版权','第三方音乐平台','API Key','AI Provider','开源许可证','更新','联系方式'];
  pass('one immutable versioned source owns both legal documents',Object.isFrozen(content)&&Object.isFrozen(content.privacy.sections)&&Object.isFrozen(content.agreement.sections)&&content.version==='1.1.44'&&content.effectiveDate==='2026-08-20',{version:content.version,effectiveDate:content.effectiveDate});
  pass('privacy notice is a full ten-section current-function document',content.privacy.sections.length===10&&privacyText.length>2800,{sections:content.privacy.sections.length,characters:privacyText.length});
  pass('privacy notice covers every required data and service category',requiredPrivacy.every(term=>privacyText.includes(term)),requiredPrivacy.filter(term=>!privacyText.includes(term)));
  pass('user agreement is a full twelve-section document',content.agreement.sections.length===12&&agreementText.length>2200,{sections:content.agreement.sections.length,characters:agreementText.length});
  pass('agreement covers responsibility copyright providers licensing updates and contact',requiredAgreement.every(term=>agreementText.includes(term)),requiredAgreement.filter(term=>!agreementText.includes(term)));
  pass('the notice accurately describes scoped music cookies instead of claiming they never exist',/Cookie\/session 会保存在当前 LF 账号范围内/.test(privacyText)&&!/绝不收集.{0,40}音乐平台 Cookie/.test(backendSource),true);
  pass('AI translation disclosure matches the guarded environment configuration',privacyText.includes('LF_TRANSLATE_ENDPOINT')&&privacyText.includes('LF_TRANSLATE_API_KEY')&&privacyText.includes('歌词行、源语言和目标语言'),true);
  pass('the browser loads legal content before the auth UI exactly once',index.indexOf('/lf-legal-content.js')>0&&index.indexOf('/lf-legal-content.js')<index.indexOf('/lf-auth-monitor.js')&&(index.match(/lf-legal-content\.js/g)||[]).length===1,true);
  pass('renderer uses escaped structured sections and preserves offline fallback',/function renderLegalDocument/.test(auth)&&/esc\(section\.title/.test(auth)&&/esc\(text\)/.test(auth)&&/try \{ result = await api\.lfPrivacyNotice\(\); \} catch/.test(auth),true);
  pass('backend returns the same versioned structured privacy source',/LumiFieldLegalContent = require\('\.\.\/public\/lf-legal-content'\)/.test(backendSource)&&/sections: LumiFieldLegalContent\.privacy\.sections/.test(backendSource),true);
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
  await waitFor(()=>cdp.evaluate(`document.readyState==='complete'&&!!window.LFAuth&&!!window.LumiFieldLegalContent`),60000);
}

async function prepare(){
  await cdp.evaluate(`(()=>{document.querySelectorAll('#lf-auth-root,#visual-guide,.visual-guide-scrim,.modal-mask').forEach(node=>{node.classList.remove('show','active');node.style.setProperty('display','none','important');node.setAttribute('aria-hidden','true');});document.body.classList.remove('lf-auth-locked','visual-guide-active','render-deep-sleep');return true;})()`);
}

async function clickAt(selector){
  const point=await cdp.evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)return null;node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,visible:r.width>0&&r.height>0};})()`);
  assert.ok(point&&point.visible,`not visible: ${selector}`);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',buttons:1,clickCount:1});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',buttons:0,clickCount:1});
}

async function inspectDocument(kind){
  return waitFor(()=>cdp.evaluate(`(()=>{const modal=document.getElementById('lf-legal-modal'),body=document.getElementById('lf-legal-body'),dialog=modal&&modal.querySelector('.lf-legal-dialog');if(!modal||!modal.classList.contains('show')||!body||body.dataset.document!==${JSON.stringify(kind)})return null;const r=dialog.getBoundingClientRect(),styles=getComputedStyle(dialog);return{kind:body.dataset.document,version:body.dataset.version,title:document.getElementById('lf-legal-title').textContent,sectionCount:body.querySelectorAll('.lf-legal-section').length,sectionIds:Array.from(body.querySelectorAll('.lf-legal-section')).map(n=>n.dataset.legalSection),text:body.textContent.replace(/\\s+/g,' ').trim(),rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height},viewport:{width:innerWidth,height:innerHeight},scroll:{top:dialog.scrollTop,height:dialog.scrollHeight,client:dialog.clientHeight},role:dialog.getAttribute('role'),ariaModal:dialog.getAttribute('aria-modal'),overflowY:styles.overflowY};})()`),15000);
}

async function runtimeChecks(){
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false,screenWidth:1280,screenHeight:720});
  await prepare();
  const backend=await cdp.evaluate(`desktopWindow.lfPrivacyNotice()`);
  pass('live backend exposes the complete shared privacy document',backend&&backend.ok&&backend.version==='1.1.44'&&backend.effectiveDate==='2026-08-20'&&backend.sections.length===10,{version:backend&&backend.version,sections:backend&&backend.sections&&backend.sections.length});

  await cdp.evaluate(`LFAuth.openProfile()`);await waitFor(()=>cdp.evaluate(`document.getElementById('lf-profile-modal')&&document.getElementById('lf-profile-modal').classList.contains('show')`));
  await clickAt('#lf-privacy-open');
  const privacy=await inspectDocument('privacy');
  const privacyTerms=['本地数据','五个音乐平台账号','Cookie','session','API Key','AI Provider','摄像头','麦克风','天气','网络请求','日志','本地缓存','完整删除本机数据','GPL-3.0-only','联系方式'];
  pass('the real Privacy button opens all ten visible sections',privacy.sectionCount===10&&privacy.title==='LumiField 隐私说明'&&privacy.version==='1.1.44',{title:privacy.title,sections:privacy.sectionCount,ids:privacy.sectionIds});
  pass('rendered privacy text contains every required operational disclosure',privacyTerms.every(term=>privacy.text.includes(term)),privacyTerms.filter(term=>!privacy.text.includes(term)));
  pass('privacy dialog is accessible bounded and scrollable at desktop size',privacy.role==='dialog'&&privacy.ariaModal==='true'&&privacy.rect.left>=0&&privacy.rect.top>=0&&privacy.rect.right<=privacy.viewport.width&&privacy.rect.bottom<=privacy.viewport.height&&privacy.scroll.height>privacy.scroll.client,privacy);
  await cdp.evaluate(`(()=>{const d=document.querySelector('.lf-legal-dialog');d.scrollTop=d.scrollHeight;return d.scrollTop;})()`);await delay(100);
  const privacyBottom=await cdp.evaluate(`(()=>{const d=document.querySelector('.lf-legal-dialog'),last=document.querySelector('[data-legal-section="license-update-contact"]');const r=last.getBoundingClientRect(),dr=d.getBoundingClientRect();return{scrollTop:d.scrollTop,lastVisible:r.bottom<=dr.bottom+1&&r.bottom>=dr.top};})()`);
  pass('users can scroll to the final open-source update and contact section',privacyBottom.scrollTop>0&&privacyBottom.lastVisible,privacyBottom);
  await cdp.screenshot('privacy-notice.png');

  await clickAt('#lf-legal-close');await waitFor(()=>cdp.evaluate(`!document.getElementById('lf-legal-modal').classList.contains('show')`));
  await cdp.evaluate(`LFAuth.openProfile()`);await waitFor(()=>cdp.evaluate(`document.getElementById('lf-profile-modal').classList.contains('show')`));
  await clickAt('#lf-agreement-open');
  const agreement=await inspectDocument('agreement');
  const agreementTerms=['用户责任','内容版权','第三方音乐平台','API Key','AI Provider','GPL-3.0-only','冻结版本','退出不等于删除','联系方式'];
  pass('the real Agreement button opens all twelve visible sections',agreement.sectionCount===12&&agreement.title==='LumiField 用户协议'&&agreement.version==='1.1.44',{title:agreement.title,sections:agreement.sectionCount,ids:agreement.sectionIds});
  pass('rendered agreement covers responsibility copyright licensing updates and deletion limits',agreementTerms.every(term=>agreement.text.includes(term)),agreementTerms.filter(term=>!agreement.text.includes(term)));
  await cdp.screenshot('user-agreement.png');

  await cdp.send('Emulation.setDeviceMetricsOverride',{width:960,height:540,deviceScaleFactor:2,mobile:false,screenWidth:960,screenHeight:540});await delay(150);
  const compact=await inspectDocument('agreement');
  pass('legal content remains bounded and scrollable at the minimum high-DPI viewport',compact.rect.left>=0&&compact.rect.top>=0&&compact.rect.right<=compact.viewport.width&&compact.rect.bottom<=compact.viewport.height&&compact.scroll.height>compact.scroll.client,compact);
  await clickAt('#lf-legal-close');
  pass('renderer and console errors remain zero',rendererErrors.length===0&&consoleErrors.length===0,{rendererErrors,consoleErrors});
}

async function stopApp(){if(cdp){cdp.close();cdp=null;}if(app&&!app.killed){app.kill();await Promise.race([new Promise(resolve=>app.once('exit',resolve)),delay(4000)]);}app=null;}

(async()=>{let error=null;try{staticChecks();if(process.env.LF_V1144_17_STATIC_ONLY!=='1'){await startApp();await runtimeChecks();}}catch(caught){error=caught;process.exitCode=1;}finally{await stopApp();const result={task:'v1.1.44-problem-17',status:error?'FAIL':'PASS',checks,checkCount:Object.keys(checks).length,rendererErrors,consoleErrors,screenshots,appLog,error:error?String(error.stack||error):null};fs.writeFileSync(path.join(evidenceDir,'result.json'),JSON.stringify(result,null,2));process.stdout.write(`${JSON.stringify({status:result.status,checkCount:result.checkCount,evidenceDir},null,2)}\n`);}})();
