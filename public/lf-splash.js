(function () {
  'use strict';

  var api = window.LumiFieldSplash;
  var root = document.getElementById('lf-splash-root');
  var stage = document.getElementById('lf-splash-stage');
  var atcCanvas = document.getElementById('lf-splash-atc');
  var gridCanvas = document.getElementById('lf-splash-grid');
  var signature = document.getElementById('lf-splash-signature');
  var enter = document.getElementById('lf-splash-enter');
  var startedAt = performance.now();
  var disposed = false;
  var rafId = 0;
  var atcInitTimer = 0;
  var stageVisible = false;
  var firstFrameAtMs = -1;
  var stageReadySent = false;
  var enterClicks = 0;
  var enterPending = false;
  var enterAcceptedAt = 0;
  var enterError = '';
  var enterDispatchDelayMs = -1;
  var gridFrames = 0;
  var gridCurrentMaxWarp = 0;
  var gridObservedMaxWarp = 0;
  var gridObservedRippleWarp = 0;
  var atcFrames = 0;
  var pointerMoves = 0;
  var rippleTriggers = 0;
  var signatureEnded = false;
  var signatureHeld = false;
  var signaturePlayAttempts = 0;
  var signatureError = '';
  var reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var dpr = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
  var TARGET_FRAME_MS = reducedMotion ? 250 : (1000 / 30);
  var lastPaintAt = 0;
  var frameGateSkips = 0;
  var visibilityPauses = 0;
  var suspended = !!document.hidden;
  var pointer = { x: -9999, y: -9999, tx: -9999, ty: -9999, active: false };
  var pendingPointer = null;
  var pointerDirty = false;
  var rootRect = null;
  var enterRect = null;
  var ripples = [];
  var listeners = [];
  var gl = null;
  var glProgram = null;
  var glBuffer = null;
  var glTime = null;
  var glResolution = null;
  var gridCtx = null;
  var atcFallbackCtx = null;
  var atcMode = 'none';

  function add(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    listeners.push([target, type, fn, options]);
  }

  function sizeCanvas(canvas) {
    canvas.width = Math.round(600 * dpr);
    canvas.height = Math.round(400 * dpr);
  }

  function refreshBounds() {
    rootRect = root.getBoundingClientRect();
    enterRect = enter.getBoundingClientRect();
  }

  function pointFromClient(clientX, clientY) {
    var rect = rootRect;
    if (!rect || !rect.width || !rect.height) refreshBounds();
    rect = rootRect;
    return {
      x: Math.max(0, Math.min(600, (clientX - rect.left) * 600 / Math.max(1, rect.width))),
      y: Math.max(0, Math.min(400, (clientY - rect.top) * 400 / Math.max(1, rect.height)))
    };
  }

  function consumePointer() {
    if (!pointerDirty || !pendingPointer) return;
    pointerDirty = false;
    var clientX = pendingPointer.x;
    var clientY = pendingPointer.y;
    var p = pointFromClient(clientX, clientY);
    if (!pointer.active || pointer.x < -1000 || pointer.y < -1000) { pointer.x = p.x; pointer.y = p.y; }
    pointer.tx = p.x;
    pointer.ty = p.y;
    pointer.active = true;
    var rect = enterRect;
    var inside = !!(rect && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom);
    if (inside) {
      var x = (clientX - rect.left) / Math.max(1, rect.width);
      var y = (clientY - rect.top) / Math.max(1, rect.height);
      enter.style.setProperty('--lf-enter-x', (x * 100).toFixed(2) + '%');
      enter.style.setProperty('--lf-enter-y', (y * 100).toFixed(2) + '%');
    }
    enter.style.setProperty('--lf-enter-strength', inside ? '1' : '0');
  }

  function compileShader(type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      var message = gl.getShaderInfoLog(shader) || 'SHADER_COMPILE_FAILED';
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function initAtc() {
    sizeCanvas(atcCanvas);
    if (api && api.forceGpuFallback) {
      atcFallbackCtx = atcCanvas.getContext('2d');
      atcMode = atcFallbackCtx ? 'canvas2d-fallback' : 'css-fallback';
      return;
    }
    try {
      gl = atcCanvas.getContext('webgl2', { premultipliedAlpha: false, alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
      if (!gl) throw new Error('WEBGL_UNAVAILABLE');
      var vertex = compileShader(gl.VERTEX_SHADER, [
        '#version 300 es',
        'precision highp float;',
        'layout(location=0) in vec2 a_pos;',
        'void main(){ gl_Position = vec4(a_pos,0.0,1.0); }',
      ].join('\n'));
      var fragment = compileShader(gl.FRAGMENT_SHADER, [
        '#version 300 es',
        'precision highp float;',
        'out vec4 fragColor;',
        'uniform vec2 u_res;',
        'uniform float u_time;',
        'float tanh1(float x){ float e = exp(2.0*x); return (e-1.0)/(e+1.0); }',
        'vec4 tanh4(vec4 v){ return vec4(tanh1(v.x), tanh1(v.y), tanh1(v.z), tanh1(v.w)); }',
        'void main(){',
        '  vec3 FC = vec3(gl_FragCoord.xy, 0.0);',
        '  vec3 r = vec3(u_res, max(u_res.x, u_res.y));',
        '  float t = u_time;',
        '  vec4 o = vec4(0.0);',
        '  vec3 p = vec3(0.0);',
        '  vec3 v = vec3(1.0, 2.0, 6.0);',
        '  float i = 0.0, z = 1.0, d = 1.0, f = 1.0;',
        '  for ( ; i++ < 5e1; o.rgb += (cos((p.x + z + v) * 0.1) + 1.0) / d / f / z ) {',
        '    p = z * normalize(FC * 2.0 - r.xyy);',
        '    vec4 m = cos((p + sin(p)).y * 0.4 + vec4(0.0, 33.0, 11.0, 0.0));',
        '    p.xz = mat2(m) * p.xz;',
        '    p.x += t / 0.2;',
        '    z += ( d = length(cos(p / v) * v + v.zxx / 7.0) / ( f = 2.0 + d / exp(p.y * 0.2) ) );',
        '  }',
        '  o = tanh4(0.2 * o);',
        '  o.a = 1.0;',
        '  fragColor = o;',
        '}',
      ].join('\n'));
      glProgram = gl.createProgram();
      gl.attachShader(glProgram, vertex);
      gl.attachShader(glProgram, fragment);
      gl.linkProgram(glProgram);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(glProgram) || 'PROGRAM_LINK_FAILED');
      glBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, glBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      gl.useProgram(glProgram);
      var position = gl.getAttribLocation(glProgram, 'a_pos');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      glTime = gl.getUniformLocation(glProgram, 'u_time');
      glResolution = gl.getUniformLocation(glProgram, 'u_res');
      atcMode = 'webgl2-source-adaptation';
    } catch (error) {
      signatureError = signatureError || String(error && error.message || error);
      if (gl) {
        try { var lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); } catch (_) {}
      }
      gl = null;
      atcFallbackCtx = atcCanvas.getContext('2d');
      atcMode = atcFallbackCtx ? 'canvas2d-fallback' : 'css-fallback';
    }
  }

  function renderAtc(now) {
    if (!stageVisible) return;
    atcFrames += 1;
    if (gl && glProgram) {
      gl.viewport(0, 0, atcCanvas.width, atcCanvas.height);
      gl.useProgram(glProgram);
      gl.uniform1f(glTime, now * .001);
      gl.uniform2f(glResolution, atcCanvas.width, atcCanvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      return;
    }
    if (!atcFallbackCtx) return;
    var ctx = atcFallbackCtx;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle='#030714';ctx.fillRect(0,0,600,400);
    ctx.globalCompositeOperation='lighter';
    // Keep the no-WebGL recovery surface responsive while the main process is
    // loading the player and the kinetic grid is sharing this frame budget.
    for(var i=0;i<28;i++){
      var seed=((i*47)%97)/97;
      var z=((now*.00008+i*.071)%1);
      var a=i*.91+Math.sin(now*.00018)*.4;
      var radius=18+z*z*360;
      var x=300+Math.cos(a)*radius,y=200+Math.sin(a)*radius*.62;
      ctx.strokeStyle=i%3===0?'rgba(255,184,83,.42)':'rgba(98,184,255,.42)';
      ctx.lineWidth=.5+z*2;
      ctx.beginPath();ctx.moveTo(300+(x-300)*.86,200+(y-200)*.86);ctx.lineTo(x,y);ctx.stroke();
    }
    ctx.globalCompositeOperation='source-over';
  }

  function renderGrid(now) {
    if (!stageVisible || !gridCtx) return;
    gridFrames += 1;
    // Preserve the source interaction's time response after moving from 60 to
    // 30 paints per second: 1 - (1 - .08)^2 = .1536.
    pointer.x += (pointer.tx-pointer.x)*.154;
    pointer.y += (pointer.ty-pointer.y)*.154;
    var ctx=gridCtx;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,600,400);
    var CELL_SIZE=55,INFLUENCE_RADIUS=260,MAX_WARP=24,DOT_SPACING=28;
    var cols=Math.max(2,Math.ceil(600/CELL_SIZE))+1,rows=Math.max(2,Math.ceil(400/CELL_SIZE))+1;
    var cellW=600/(cols-1),cellH=400/(rows-1),points=[],proximity=[];
    gridCurrentMaxWarp=0;
    for(var ri=ripples.length-1;ri>=0;ri--){
      var ripple=ripples[ri],age=(now-ripple.born)/1000;
      ripple.radius=Math.max(0,age*400);ripple.opacity=Math.max(0,1-age*1.2);
      if(ripple.opacity<=0)ripples.splice(ri,1);
    }
    ctx.fillStyle='rgba(255,255,255,.05)';
    for(var dx=DOT_SPACING/2;dx<600;dx+=DOT_SPACING){for(var dy=DOT_SPACING/2;dy<400;dy+=DOT_SPACING){ctx.beginPath();ctx.arc(dx,dy,.7,0,Math.PI*2);ctx.fill();}}
    function warped(gx,gy,col,row){
      var edgeMargin=1.5,colPin=Math.min(col/edgeMargin,(cols-1-col)/edgeMargin,1),rowPin=Math.min(row/edgeMargin,(rows-1-row)/edgeMargin,1),pinFactor=colPin*colPin*rowPin*rowPin;
      var mx=gx-pointer.x,my=gy-pointer.y,dist=Math.sqrt(mx*mx+my*my),prox=Math.max(0,1-dist/INFLUENCE_RADIUS)*pinFactor,rx=0,ry=0;
      for(var i=0;i<ripples.length;i++){
        var rp=ripples[i],rdx=gx-rp.x,rdy=gy-rp.y,rdist=Math.sqrt(rdx*rdx+rdy*rdy),diff=rdist-rp.radius;
        if(Math.abs(diff)<55){var strength=(1-Math.abs(diff)/55)*rp.opacity*18*pinFactor,angle=Math.atan2(rdy,rdx),sign=diff<0?-1:1;rx+=Math.cos(angle)*strength*sign*-1;ry+=Math.sin(angle)*strength*sign*-1;}
      }
      gridObservedRippleWarp=Math.max(gridObservedRippleWarp,Math.hypot(rx,ry));
      if(dist<INFLUENCE_RADIUS&&dist>0&&pinFactor>0){var t=dist/INFLUENCE_RADIUS,eased=t<.01?0:(1-t)*(1-t)*Math.min(1,dist/60),warp=eased*MAX_WARP*pinFactor,a=Math.atan2(my,mx),wx=gx-Math.cos(a)*warp+rx,wy=gy-Math.sin(a)*warp+ry;gridCurrentMaxWarp=Math.max(gridCurrentMaxWarp,Math.hypot(wx-gx,wy-gy));gridObservedMaxWarp=Math.max(gridObservedMaxWarp,gridCurrentMaxWarp);return{pt:{x:wx,y:wy},proximity:prox};}
      gridCurrentMaxWarp=Math.max(gridCurrentMaxWarp,Math.hypot(rx,ry));gridObservedMaxWarp=Math.max(gridObservedMaxWarp,gridCurrentMaxWarp);return{pt:{x:gx+rx,y:gy+ry},proximity:prox};
    }
    for(var row=0;row<rows;row++){points[row]=[];proximity[row]=[];for(var col=0;col<cols;col++){var result=warped(col*cellW,row*cellH,col,row);points[row][col]=result.pt;proximity[row][col]=result.proximity;}}
    function lerp(a,b,t){return a+(b-a)*t;}
    function lineColor(t){return'rgba('+Math.round(lerp(255,74,t))+','+Math.round(lerp(255,158,t))+','+Math.round(lerp(255,255,t))+','+lerp(.13,.9,t).toFixed(3)+')';}
    function drawSegment(p1,p2,a,b){var avg=(a+b)/2,t=avg*avg*(3-2*avg);ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);ctx.strokeStyle=lineColor(t);ctx.lineWidth=lerp(.8,1.5,t);ctx.stroke();}
    ctx.lineCap='butt';
    for(var row2=0;row2<rows;row2++){for(var col2=0;col2<cols-1;col2++)drawSegment(points[row2][col2],points[row2][col2+1],proximity[row2][col2],proximity[row2][col2+1]);}
    for(var col3=0;col3<cols;col3++){for(var row3=0;row3<rows-1;row3++)drawSegment(points[row3][col3],points[row3+1][col3],proximity[row3][col3],proximity[row3+1][col3]);}
    for(var row4=0;row4<rows;row4++){for(var col4=0;col4<cols;col4++){
      var point=points[row4][col4],pr=proximity[row4][col4],smooth=pr*pr*(3-2*pr),radius=lerp(1.8,3.2,smooth);
      if(smooth>.3){var glowR=radius+lerp(0,6,(smooth-.3)/.7),gradient=ctx.createRadialGradient(point.x,point.y,radius*.5,point.x,point.y,glowR);gradient.addColorStop(0,'rgba(74,158,255,'+(smooth*.3).toFixed(3)+')');gradient.addColorStop(1,'rgba(74,158,255,0)');ctx.beginPath();ctx.arc(point.x,point.y,glowR,0,Math.PI*2);ctx.fillStyle=gradient;ctx.fill();}
      ctx.beginPath();ctx.arc(point.x,point.y,radius,0,Math.PI*2);ctx.fillStyle='rgba('+Math.round(lerp(255,74,smooth))+','+Math.round(lerp(255,158,smooth))+',255,'+lerp(.2,1,smooth).toFixed(3)+')';ctx.fill();
    }}
    for(var rr=0;rr<ripples.length;rr++){
      var activeRipple=ripples[rr];ctx.beginPath();ctx.arc(activeRipple.x,activeRipple.y,Math.max(0,activeRipple.radius),0,Math.PI*2);ctx.strokeStyle='rgba(100,180,255,'+(activeRipple.opacity*.28).toFixed(3)+')';ctx.lineWidth=1.5;ctx.stroke();
    }
  }

  function playSignature() {
    signaturePlayAttempts += 1;
    signature.currentTime = 0;
    var promise = signature.play();
    if (promise && promise.catch) promise.catch(function (error) {
      signatureError = String(error && error.message || error);
      add(signature, 'canplay', playSignature, { once: true });
    });
  }

  function revealStage() {
    if (stageVisible || disposed) return;
    stageVisible = true;
    stage.dataset.visible='true';
    stage.setAttribute('aria-hidden','false');
    if (!stageReadySent && api) { stageReadySent=true; api.stageReady(); }
    if (signature.readyState >= 2) playSignature();
    else add(signature, 'canplay', playSignature, { once: true });
  }

  function holdSignature() {
    signatureEnded = true;
    signature.pause();
    var target=Math.max(0,(Number(signature.duration)||0)-.08);
    try { signature.currentTime=target; } catch (_) {}
    signatureHeld = true;
  }

  function frame(now) {
    if (disposed) return;
    if (firstFrameAtMs < 0) firstFrameAtMs = now - startedAt;
    if (suspended) { rafId = 0; return; }
    consumePointer();
    if (lastPaintAt && now - lastPaintAt < TARGET_FRAME_MS) {
      frameGateSkips += 1;
      rafId = requestAnimationFrame(frame);
      return;
    }
    lastPaintAt = now;
    renderAtc(now);
    renderGrid(now);
    rafId=requestAnimationFrame(frame);
  }

  function onPointerMove(event) {
    pendingPointer = { x:event.clientX, y:event.clientY };
    pointerDirty = true;
    var p = pointFromClient(event.clientX, event.clientY);
    if (!pointer.active || pointer.x < -1000 || pointer.y < -1000) { pointer.x = p.x; pointer.y = p.y; }
    pointer.tx = p.x;
    pointer.ty = p.y;
    pointer.active = true;
    pointerMoves += 1;
  }

  function onPointerLeave(){pointer.active=false;enter.style.setProperty('--lf-enter-strength','0');}
  function onGridClick(event){var p=pointFromClient(event.clientX,event.clientY);ripples.push({x:p.x,y:p.y,radius:0,opacity:1,born:performance.now()});if(ripples.length>6)ripples.shift();rippleTriggers+=1;}
  function onEnterMove(event){pendingPointer={x:event.clientX,y:event.clientY};pointerDirty=true;}
  function onEnterLeave(){enter.style.setProperty('--lf-enter-strength','0');}
  function onResize(){refreshBounds();}
  function setSuspended(next) {
    suspended = !!next;
    if (suspended) {
      visibilityPauses += 1;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      return suspended;
    }
    refreshBounds();
    lastPaintAt = 0;
    if (!rafId && !disposed) rafId = requestAnimationFrame(frame);
    return suspended;
  }
  function onVisibilityChange(){ setSuspended(document.hidden); }
  function finishRejectedEntry(message){
    enterError=String(message||'SPLASH_ENTER_REJECTED');
    enterPending=false;
    enter.disabled=false;
    enter.removeAttribute('data-pending');
    enter.removeAttribute('aria-busy');
  }
  function onEnterClick(){
    if(disposed||enterPending||!stageVisible||!api)return;
    var clickedAt=performance.now();
    enterClicks+=1;
    enterPending=true;
    enter.disabled=true;
    enter.dataset.pending='true';
    enter.setAttribute('aria-busy','true');
    // Keep both splash renderers and the signature responsive while the hidden
    // main window finishes initialization. The accepted request is queued in
    // the main process and reveals the main window without another click.
    Promise.resolve().then(function(){return api.enter();}).then(function(result){
      if(result&&result.ok===true){enterAcceptedAt=performance.now();enterDispatchDelayMs=Math.max(0,enterAcceptedAt-clickedAt);return;}
      finishRejectedEntry(result&&result.error);
    }).catch(function(error){finishRejectedEntry(error&&error.message||error||'SPLASH_ENTER_FAILED');});
  }

  function dispose() {
    if(disposed)return;disposed=true;
    if(rafId){cancelAnimationFrame(rafId);rafId=0;}
    if(atcInitTimer){clearTimeout(atcInitTimer);atcInitTimer=0;}
    listeners.splice(0).forEach(function(item){try{item[0].removeEventListener(item[1],item[2],item[3]);}catch(_){}});
    try{signature.pause();signature.removeAttribute('src');signature.load();}catch(_){}
    if(gl){try{gl.bindBuffer(gl.ARRAY_BUFFER,null);gl.useProgram(null);if(glBuffer)gl.deleteBuffer(glBuffer);if(glProgram)gl.deleteProgram(glProgram);var lose=gl.getExtension('WEBGL_lose_context');if(lose)lose.loseContext();}catch(_){}}
    gl=null;glProgram=null;glBuffer=null;gridCtx=null;atcFallbackCtx=null;ripples.length=0;
  }

  sizeCanvas(gridCanvas);
  gridCtx=gridCanvas.getContext('2d');
  refreshBounds();
  var initialFrameNow=performance.now();
  firstFrameAtMs=initialFrameNow-startedAt;
  add(window,'mousemove',onPointerMove,{passive:true});
  add(window,'mouseleave',onPointerLeave,{passive:true});
  add(window,'click',onGridClick,{passive:true});
  add(window,'resize',onResize,{passive:true});
  add(document,'visibilitychange',onVisibilityChange);
  add(enter,'pointermove',onEnterMove,{passive:true});
  add(enter,'pointerleave',onEnterLeave,{passive:true});
  add(enter,'click',onEnterClick);
  add(signature,'ended',holdSignature);
  add(signature,'error',function(){signatureError='SIGNATURE_MEDIA_ERROR';});
  add(window,'beforeunload',dispose,{once:true});
  revealStage();
  enter.disabled=false;
  renderGrid(initialFrameNow);
  atcInitTimer=setTimeout(function(){atcInitTimer=0;initAtc();},50);
  if (!suspended) rafId=requestAnimationFrame(frame);

  if(api&&api.isTest){
    window.__lfSplashSetTestVisibility=function(hidden){setSuspended(!!hidden);return window.__lfSplashDebug();};
    window.__lfSplashDebug=function(){return{
      version:2,elapsedMs:Math.round(performance.now()-startedAt),firstFrameAtMs:firstFrameAtMs,stageVisible:stageVisible,atcMode:atcMode,atcFrames:atcFrames,gridFrames:gridFrames,gridCurrentMaxWarp:gridCurrentMaxWarp,gridObservedMaxWarp:gridObservedMaxWarp,gridObservedRippleWarp:gridObservedRippleWarp,pointerMoves:pointerMoves,pointer:{x:pointer.x,y:pointer.y,targetX:pointer.tx,targetY:pointer.ty,active:pointer.active},rippleTriggers:rippleTriggers,activeRipples:ripples.length,signature:{readyState:signature.readyState,duration:Number(signature.duration)||0,currentTime:Number(signature.currentTime)||0,paused:signature.paused,ended:signatureEnded,held:signatureHeld,playAttempts:signaturePlayAttempts,error:signatureError,source:signature.currentSrc||signature.src},button:{text:enter.textContent.trim(),visible:stageVisible,disabled:enter.disabled,clicks:enterClicks,pending:enterPending,acceptedAtMs:enterAcceptedAt?Math.round(enterAcceptedAt-startedAt):-1,dispatchDelayMs:enterDispatchDelayMs<0?-1:Math.round(enterDispatchDelayMs),error:enterError,strength:enter.style.getPropertyValue('--lf-enter-strength')||'0',x:enter.style.getPropertyValue('--lf-enter-x')||'50%',y:enter.style.getPropertyValue('--lf-enter-y')||'50%'},performance:{targetFps:Math.round(1000/TARGET_FRAME_MS),dpr:dpr,frameGateSkips:frameGateSkips,suspended:suspended,visibilityPauses:visibilityPauses,pointerCoalesced:pointerMoves>gridFrames},resources:{rafActive:rafId?1:0,listeners:listeners.length,webglContexts:gl?1:0,audioContexts:0,audioElements:0,videoElements:document.querySelectorAll('video').length},reducedMotion:reducedMotion,disposed:disposed};};
  }
})();
