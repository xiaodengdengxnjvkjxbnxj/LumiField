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
const {PNG}=require(path.join(dependencyRoot,'pngjs'));
const evidenceDir=path.join(repo,'test-results','lf-v1144-19-voice-overlay',new Date().toISOString().replace(/[:.]/g,'-'));
const userData=fs.mkdtempSync(path.join(os.tmpdir(),'lf-v1144-19-'));
const checks={};const rendererErrors=[];const consoleErrors=[];const screenshots=[];const appLog=[];
let app=null;let mainCdp=null;let overlayCdp=null;let debugPort=0;
fs.mkdirSync(evidenceDir,{recursive:true});
fs.mkdirSync(path.join(userData,'migrations'),{recursive:true});
fs.writeFileSync(path.join(userData,'migrations','legacy-upstream-platform-session-v2.json'),JSON.stringify({version:2,validated:true,testIsolation:true,results:[]}),{mode:0o600});

function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function pass(name,condition,detail){assert.ok(condition,`${name}: ${JSON.stringify(detail)}`);checks[name]=detail==null?true:detail;}
function sha256File(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();}
async function waitFor(fn,timeout=30000,interval=60){const started=Date.now();let last=null;while(Date.now()-started<timeout){try{last=await fn();if(last)return last;}catch(error){last=String(error&&error.message||error);}await delay(interval);}throw new Error(`Timeout: ${JSON.stringify(last)}`);}
function freePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.unref();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(error=>error?reject(error):resolve(port));});});}

class CDP{
  constructor(url,collectErrors=true){this.url=url;this.collectErrors=collectErrors;this.id=0;this.pending=new Map();}
  async connect(){this.ws=new WebSocket(this.url);this.ws.onmessage=event=>{const message=JSON.parse(String(event.data));if(message.id&&this.pending.has(message.id)){const pending=this.pending.get(message.id);this.pending.delete(message.id);clearTimeout(pending.timer);if(message.error)pending.reject(new Error(message.error.message));else pending.resolve(message.result||{});return;}if(!this.collectErrors)return;if(message.method==='Runtime.exceptionThrown'){const detail=message.params&&message.params.exceptionDetails||{};rendererErrors.push({message:String(detail.exception&&detail.exception.description||detail.text||'renderer exception'),url:detail.url||'',line:Number(detail.lineNumber||0)+1,column:Number(detail.columnNumber||0)+1,stack:detail.stackTrace||null});}if(message.method==='Runtime.consoleAPICalled'&&message.params&&message.params.type==='error')consoleErrors.push((message.params.args||[]).map(item=>item.value||item.description||'').join(' '));};await new Promise((resolve,reject)=>{this.ws.onopen=resolve;this.ws.onerror=reject;});await this.send('Runtime.enable');await this.send('Page.enable');}
  send(method,params,timeout=30000){const id=++this.id;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},timeout);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params:params||{}}));});}
  async evaluate(expression,timeout=30000){const response=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},timeout);if(response.exceptionDetails)throw new Error(response.exceptionDetails.exception&&response.exceptionDetails.exception.description||response.exceptionDetails.text);return response.result&&response.result.value;}
  close(){try{this.ws.close();}catch(_){} }
}

function staticChecks(){
  const main=fs.readFileSync(path.join(repo,'desktop','lf-voice-assistant-main.js'),'utf8');
  const css=fs.readFileSync(path.join(repo,'public','lf-voice-overlay.css'),'utf8');
  const overlay=fs.readFileSync(path.join(repo,'public','lf-voice-overlay.js'),'utf8');
  const renderer=fs.readFileSync(path.join(repo,'public','lf-voice-assistant.js'),'utf8');
  const record=fs.readFileSync(path.join(repo,'docs','licenses','eisland','IMPLEMENTATION_RECORD.md'),'utf8');
  pass('all reveal timeout state and duration-based close paths are removed',!/revealUntil|revealTimer|function reveal\s*\(|reveal\s*\(\s*\d+/.test(main),true);
  pass('all explicit show sources enter one persistent open state',/function openOverlay\(\)/.test(main)&&/overlayOpen = true/.test(main)&&/safeAction === 'show'\) openOverlay\(\)/.test(main)&&/if \(woke\)[\s\S]*?openOverlay\(\)/.test(main),true);
  pass('a real global left click outside native overlay bounds is the only explicit close path',/GetAsyncKeyState\(int virtualKey\)/.test(main)&&/leftClicked =/.test(main)&&/function dismissFromOutsideClick\(cursor\)/.test(main)&&/cursorPointInOverlay/.test(main)&&/overlayDismissed = true/.test(main),true);
  pass('top-edge detection is responsive and DPI aware',/cursorTolerance = \[Math\]::Max\(10/.test(main)&&/Start-Sleep -Milliseconds 80/.test(main)&&/cursorMonitor/.test(main),true);
  pass('the Windows probe ignores the harmless CLIXML stream header but still fails on real stderr',/!\/\^#< CLIXML/.test(main)&&/failForegroundProbe\(child, generation, 'stderr'/.test(main),true);
  pass('the focusless overlay remains non-focus-stealing',/focusable: false/.test(main)&&/showInactive\(\)/.test(main),true);
  pass('Chinese wake grammar removes punctuation and includes wake-command combinations',/compactWake/.test(main)&&/Char\.IsPunctuation/.test(main)&&/wakeVariants\.SelectMany/.test(main)&&/new DictationGrammar/.test(main),true);
  pass('speech uses a Chinese recognizer only and restarts transient child failures with bounded backoff',/NO_ZH_RECOGNIZER/.test(main)&&!/\?\? recognizers\.FirstOrDefault\(\);/.test(main)&&/scheduleSpeechRestart/.test(main)&&/speechRestartAttempts >= 4/.test(main),true);
  pass('speech rejection and Chinese prerequisite errors are visible',/SPEECH_REJECTED/.test(main)&&/未识别，请重试/.test(overlay)&&/NO_ZH_RECOGNIZER/.test(renderer),true);
  pass('overlay playback state updates use the valid DOM attribute setter',/setAttribute\('aria-label', toggleLabel\)/.test(overlay)&&!/getAttribute\('aria-label'\)\s*=/.test(overlay),true);
  pass('transparent overlay has neither the black outer shadow nor backdrop blur',/background: rgba\(0, 0, 0, 0\) !important/.test(css)&&!/0 14px 36px|backdrop-filter/.test(css)&&/box-shadow: inset/.test(css),true);
  pass('source record requires persistent open until an outside click',/remains open without a timeout/.test(record)&&/click outside its native bounds/.test(record),true);
}

async function targets(){return(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();}
async function mainDebug(){return mainCdp.evaluate(`desktopWindow.getVoiceAssistantDebug()`);}
function mousePhysical(x,y,click){
  const script=`Add-Type -Name Win32 -Namespace LF19 -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v); [DllImport("user32.dll")] public static extern bool SetCursorPos(int X,int Y); [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint dx,uint dy,uint d,UIntPtr e);'; [LF19.Win32]::SetProcessDpiAwarenessContext([IntPtr](-4))|Out-Null; [LF19.Win32]::SetCursorPos(${Math.round(x)},${Math.round(y)})|Out-Null; Start-Sleep -Milliseconds 80; ${click?'[LF19.Win32]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 90; [LF19.Win32]::mouse_event(4,0,0,0,[UIntPtr]::Zero)':''}`;
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,encoding:'utf8',timeout:12000});
  if(result.status!==0)throw new Error(`physical mouse failed: ${result.stderr||result.stdout}`);
}
function sendAltP(){
  const script=`Add-Type -Name Keys -Namespace LF19 -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte k,byte s,uint f,UIntPtr e);'; [LF19.Keys]::keybd_event(0x12,0,0,[UIntPtr]::Zero); [LF19.Keys]::keybd_event(0x50,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 45; [LF19.Keys]::keybd_event(0x50,0,2,[UIntPtr]::Zero); [LF19.Keys]::keybd_event(0x12,0,2,[UIntPtr]::Zero)`;
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,encoding:'utf8',timeout:12000});
  if(result.status!==0)throw new Error(`Alt+P failed: ${result.stderr||result.stdout}`);
}

async function startApp(){
  assert.ok(fs.existsSync(electronExe),`Electron not found: ${electronExe}`);debugPort=await freePort();
  app=spawn(electronExe,['.',`--user-data-dir=${userData}`,`--remote-debugging-port=${debugPort}`,'--remote-debugging-address=127.0.0.1'],{cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe'],env:Object.assign({},process.env,{NODE_PATH:dependencyRoot,LF_MASTER_TEST:'1',LUMIFIELD_SKIP_SPLASH:'1',ELECTRON_DISABLE_SECURITY_WARNINGS:'true'})});
  const collect=data=>appLog.push(String(data));app.stdout.on('data',collect);app.stderr.on('data',collect);
  const target=await waitFor(async()=>{const list=await targets();return list.find(item=>item.type==='page'&&/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?(?:index\.html)?$/i.test(item.url));},60000);
  mainCdp=new CDP(target.webSocketDebuggerUrl,true);await mainCdp.connect();
  await waitFor(()=>mainCdp.evaluate(`document.readyState==='complete'&&!!window.LumiFieldVoiceAssistant&&!!window.desktopWindow`),60000);
  await mainCdp.evaluate(`(()=>{document.querySelectorAll('#lf-auth-root,#visual-guide,.visual-guide-scrim,.modal-mask,#drop-overlay').forEach(node=>{node.classList.remove('show','active');node.style.setProperty('display','none','important');node.setAttribute('aria-hidden','true');});document.body.classList.remove('lf-auth-locked','visual-guide-active','render-deep-sleep','splash-active');return true;})()`);
  await waitFor(async()=>{const value=await mainCdp.evaluate(`LumiFieldVoiceAssistant.getDebugState()`);return value&&!value.scopeSwitching&&value;});
  await waitFor(()=>mainCdp.evaluate(`LumiFieldVoiceAssistant.updateSettings({enabled:true,voiceWake:false,songSync:false,topEdgeWake:true,hotkey:'Alt+KeyP'},{allowEmptyHotkey:false})`),15000,120);
  await waitFor(async()=>{const value=await mainCdp.evaluate(`LumiFieldVoiceAssistant.getDebugState()`);return value.settings.enabled&&value.status.hotkey==='ready'&&value;},15000);
}

async function connectOverlay(){
  const target=await waitFor(async()=>{const list=await targets();return list.find(item=>/\/lf-voice-overlay\.html$/i.test(item.url));},15000);
  overlayCdp=new CDP(target.webSocketDebuggerUrl,true);await overlayCdp.connect();
  await waitFor(()=>overlayCdp.evaluate(`document.readyState==='complete'&&!!document.getElementById('lf-voice-overlay')`));
}

async function captureOverlay(){
  await overlayCdp.send('Emulation.setDefaultBackgroundColorOverride',{color:{r:0,g:0,b:0,a:0}});
  const response=await overlayCdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
  const file=path.join(evidenceDir,'voice-overlay-transparent.png');
  const bytes=Buffer.from(response.data,'base64');fs.writeFileSync(file,bytes);
  const png=PNG.sync.read(bytes);let transparent=0;let darkOpaque=0;let total=0;
  for(let y=Math.max(0,png.height-8);y<png.height;y+=1){for(let x=0;x<png.width;x+=1){const index=(y*png.width+x)*4;const alpha=png.data[index+3];if(alpha<=3)transparent+=1;if(alpha>24&&png.data[index]<20&&png.data[index+1]<20&&png.data[index+2]<20)darkOpaque+=1;total+=1;}}
  screenshots.push({file:path.basename(file),bytes:bytes.length,sha256:sha256File(file),width:png.width,height:png.height,bottomTransparentRatio:transparent/total,bottomDarkOpaqueRatio:darkOpaque/total});
  return screenshots.at(-1);
}

async function runtimeChecks(){
  await connectOverlay();
  let debug=await waitFor(async()=>{const value=await mainDebug();return value.foreground&&value;},12000);
  const monitor=debug.foreground&&debug.foreground.cursorMonitor;
  assert.ok(monitor&&Number.isFinite(monitor.left),`foreground probe unavailable: ${JSON.stringify(debug)}`);
  mousePhysical(monitor.right-60,monitor.bottom-80,true);
  const dismissed=await waitFor(async()=>{const value=await mainDebug();return value.overlayDismissed&&!value.overlayVisible&&value;},8000);
  pass('a physical click outside closes the overlay exactly once',dismissed.overlayDismissed&&!dismissed.overlayOpen&&!dismissed.overlayVisible,dismissed);

  sendAltP();
  const opened=await waitFor(async()=>{const value=await mainDebug();return value.overlayOpen&&value.overlayVisible&&value;},8000);
  pass('real Alt+P opens the single focusless top overlay',opened.overlayWindowCount===1&&opened.overlayOpen&&opened.overlayVisible,opened);
  const scale=Math.max(.5,Number(opened.foreground&&opened.foreground.dpi||96)/96);
  const inside={x:(opened.overlayBounds.x+opened.overlayBounds.width/2)*scale,y:(opened.overlayBounds.y+opened.overlayBounds.height/2)*scale};
  mousePhysical(inside.x,inside.y,false);
  await delay(6500);
  const persistent=await mainDebug();
  pass('the Alt+P overlay remains open beyond the former 5-to-6-second timeout',persistent.overlayOpen&&persistent.overlayVisible&&!persistent.overlayDismissed&&!persistent.speechRestartPending,persistent);

  mousePhysical(inside.x,inside.y,true);await delay(450);
  const insideState=await mainDebug();
  pass('clicking inside the overlay does not close it',insideState.overlayOpen&&insideState.overlayVisible&&!insideState.overlayDismissed,insideState);

  const transparency=await captureOverlay();
  const style=await overlayCdp.evaluate(`(()=>{const root=getComputedStyle(document.documentElement),body=getComputedStyle(document.body),shell=getComputedStyle(document.getElementById('lf-voice-overlay'));return{htmlBg:root.backgroundColor,bodyBg:body.backgroundColor,backdrop:shell.backdropFilter,shadow:shell.boxShadow,height:innerHeight,shellBottom:document.getElementById('lf-voice-overlay').getBoundingClientRect().bottom};})()`);
  pass('the bottom black curtain is absent in computed style and pixels',style.htmlBg==='rgba(0, 0, 0, 0)'&&style.bodyBg==='rgba(0, 0, 0, 0)'&&(style.backdrop==='none'||style.backdrop==='')&&transparency.bottomTransparentRatio>.98&&transparency.bottomDarkOpaqueRatio===0,{style,transparency});

  mousePhysical(monitor.right-70,monitor.bottom-90,true);
  await waitFor(async()=>{const value=await mainDebug();return value.overlayDismissed&&!value.overlayVisible&&value;},8000);
  mousePhysical((monitor.left+monitor.right)/2,monitor.top,false);
  const topEdge=await waitFor(async()=>{const value=await mainDebug();return value.overlayOpen&&value.overlayVisible&&value.foreground&&value.foreground.cursorAtTop&&value;},8000);
  pass('moving to the physical top edge reliably opens and pins the overlay',topEdge.overlayOpen&&topEdge.overlayVisible&&topEdge.foreground.cursorAtTop,topEdge);

  mousePhysical(monitor.right-80,monitor.bottom-100,true);
  await waitFor(async()=>{const value=await mainDebug();return value.overlayDismissed&&!value.overlayVisible;},8000);
  await waitFor(()=>mainCdp.evaluate(`LumiFieldVoiceAssistant.updateSettings({voiceWake:true},{microphone:false})`),15000,120);
  const wake=await mainCdp.evaluate(`LumiFieldVoiceAssistant.handleCommand({text:'小艺小艺',source:'voice',final:true})`);
  const wakeState=await waitFor(async()=>{const value=await mainDebug();return value.overlayOpen&&value.overlayVisible&&value;},8000);
  pass('the punctuation-free Chinese wake phrase opens the overlay through the production parser',wake&&wake.ok===true&&wakeState.overlayOpen&&wakeState.overlayVisible,{wake,wakeState});
  const speech=await waitFor(async()=>{const value=await mainDebug();return value.recognition&&value.recognition.state!=='starting'&&value;},12000);
  pass('the shipped System.Speech child reports a deterministic Chinese state instead of silent failure',speech.recognition.state==='listening'||(speech.recognition.state==='unavailable'&&['NO_ZH_RECOGNIZER','ZH_GRAMMAR_UNAVAILABLE'].includes(speech.recognition.reason)),speech.recognition);

  await mainCdp.evaluate(`LumiFieldVoiceAssistant.updateSettings({enabled:false,voiceWake:false,songSync:false},{microphone:false})`);
  const stopped=await waitFor(async()=>{const value=await mainDebug();return value.overlayWindowCount===0&&!value.foregroundProbeActive&&!value.speechProcessActive&&!value.speechRestartPending&&value;},12000);
  pass('disabling releases overlay probe recognizer and every restart timer',stopped.overlayWindowCount===0&&!stopped.foregroundProbeActive&&!stopped.speechProcessActive&&!stopped.speechRestartPending&&stopped.speechRestartAttempts===0,stopped);
  pass('renderer and console errors remain zero',rendererErrors.length===0&&consoleErrors.length===0,{rendererErrors,consoleErrors});
}

async function stopApp(){if(overlayCdp){overlayCdp.close();overlayCdp=null;}if(mainCdp){mainCdp.close();mainCdp=null;}if(app&&!app.killed){app.kill();await Promise.race([new Promise(resolve=>app.once('exit',resolve)),delay(4000)]);}app=null;try{fs.rmSync(userData,{recursive:true,force:true});}catch(_){} }

(async()=>{let error=null;try{staticChecks();if(process.env.LF_V1144_19_STATIC_ONLY!=='1'){await startApp();await runtimeChecks();}}catch(caught){error=caught;process.exitCode=1;}finally{await stopApp();const result={task:'v1.1.44-problem-19',status:error?'FAIL':'PASS',checks,checkCount:Object.keys(checks).length,rendererErrors,consoleErrors,screenshots,appLog,error:error?String(error.stack||error):null};fs.writeFileSync(path.join(evidenceDir,'result.json'),JSON.stringify(result,null,2));process.stdout.write(`${JSON.stringify({status:result.status,checkCount:result.checkCount,evidenceDir},null,2)}\n`);}})();
