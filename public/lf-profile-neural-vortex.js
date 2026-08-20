(function (global) {
  'use strict';

  if (!global || !global.document || global.LumiFieldProfileNeuralVortex) return;

  var SOURCE = Object.freeze({
    componentUrl:'https://21st.dev/@minhxthanh/components/interactive-neural-vortex-background',
    registryUrl:'https://21st.dev/r/minhxthanh/interactive-neural-vortex-background',
    suppliedSourceSha256:'02F1C164B5C7C1F4D4355CC4388CAC173F68243B615C3A0CC38D86BA82B90EC7',
    suppliedVideoSha256:'DA681A6E286D801505CC1DFA2579B33AC6E2ED5B2CCC0366A2B4BD22B75032C4',
    sourceMode:'DIRECT_WEBGL_ADAPTATION_FROM_USER_SUPPLIED_COMPLETE_SOURCE',
    licenseStatus:'MIT_OR_PERMISSIVE_PASS'
  });

  // Shader expressions are retained from the complete source supplied by the
  // user. The React wrapper is replaced only by LumiField's existing modal
  // lifecycle and shared pointer bus.
  var VERTEX_SHADER_SOURCE = [
    'precision mediump float;',
    'attribute vec2 a_position;',
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = .5 * (a_position + 1.);',
    '  gl_Position = vec4(a_position, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FRAGMENT_SHADER_SOURCE = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'uniform float u_time;',
    'uniform float u_ratio;',
    'uniform vec2 u_pointer_position;',
    'uniform float u_scroll_progress;',
    '',
    'vec2 rotate(vec2 uv, float th) {',
    '  return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv;',
    '}',
    '',
    'float neuro_shape(vec2 uv, float t, float p) {',
    '  vec2 sine_acc = vec2(0.);',
    '  vec2 res = vec2(0.);',
    '  float scale = 8.;',
    '  for (int j = 0; j < 15; j++) {',
    '    uv = rotate(uv, 1.);',
    '    sine_acc = rotate(sine_acc, 1.);',
    '    vec2 layer = uv * scale + float(j) + sine_acc - t;',
    '    sine_acc += sin(layer) + 2.4 * p;',
    '    res += (.5 + .5 * cos(layer)) / scale;',
    '    scale *= (1.2);',
    '  }',
    '  return res.x + res.y;',
    '}',
    '',
    'void main() {',
    '  vec2 uv = .5 * vUv;',
    '  uv.x *= u_ratio;',
    '  vec2 pointer = vUv - u_pointer_position;',
    '  pointer.x *= u_ratio;',
    '  float p = clamp(length(pointer), 0., 1.);',
    '  p = .5 * pow(1. - p, 2.);',
    '  float t = .001 * u_time;',
    '  vec3 color = vec3(0.);',
    '  float noise = neuro_shape(uv, t, p);',
    '  noise = 1.2 * pow(noise, 3.);',
    '  noise += pow(noise, 10.);',
    '  noise = max(.0, noise - .5);',
    '  noise *= (1. - length(vUv - .5));',
    '  color = vec3(0.5, 0.15, 0.65);',
    '  color = mix(color, vec3(0.02, 0.7, 0.9), 0.32 + 0.16 * sin(2.0 * u_scroll_progress + 1.2));',
    '  color += vec3(0.15, 0.0, 0.6) * sin(2.0 * u_scroll_progress + 1.5);',
    '  color = color * noise;',
    '  gl_FragColor = vec4(color, noise);',
    '}'
  ].join('\n');

  var state = {
    active:false,
    modal:null,
    dialog:null,
    layer:null,
    glass:null,
    canvas:null,
    gl:null,
    program:null,
    vertexShader:null,
    fragmentShader:null,
    vertexBuffer:null,
    uniforms:null,
    unsubscribePointer:null,
    raf:0,
    listenerCount:0,
    pointer:{ x:0, y:0, tX:0, tY:0, updates:0, inside:false, initialized:false },
    hidden:false,
    reducedMotion:false,
    eco:false,
    drawCount:0,
    resizeCount:0,
    activateCount:0,
    deactivateCount:0,
    lastTime:0,
    lastRatio:1,
    lastScrollProgress:0,
    lastError:'',
    contextReleased:false,
    lastReason:'idle'
  };

  function paused() {
    return !!(state.hidden || state.reducedMotion || state.eco);
  }

  function compileShader(gl, source, type) {
    var shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      state.lastError = 'SHADER_COMPILE_FAILED:' + String(gl.getShaderInfoLog(shader) || 'unknown');
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function createLayer() {
    var layer = document.createElement('div');
    layer.id = 'lf-profile-neural-vortex';
    layer.className = 'lf-profile-neural-vortex';
    layer.setAttribute('aria-hidden', 'true');
    layer.setAttribute('role', 'presentation');
    var canvas = document.createElement('canvas');
    canvas.id = 'lf-profile-neural-vortex-canvas';
    canvas.className = 'lf-profile-neural-vortex-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.setAttribute('role', 'presentation');
    layer.appendChild(canvas);
    state.canvas = canvas;
    return layer;
  }

  function createGlass() {
    var glass = document.createElement('div');
    glass.id = 'lf-profile-neural-vortex-glass';
    glass.className = 'lf-profile-neural-vortex-glass';
    glass.setAttribute('aria-hidden', 'true');
    glass.setAttribute('role', 'presentation');
    return glass;
  }

  function initWebGL() {
    var canvas = state.canvas;
    if (!canvas) return false;
    var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
      state.lastError = 'WEBGL_NOT_SUPPORTED';
      return false;
    }
    var vertexShader = compileShader(gl, VERTEX_SHADER_SOURCE, gl.VERTEX_SHADER);
    var fragmentShader = compileShader(gl, FRAGMENT_SHADER_SOURCE, gl.FRAGMENT_SHADER);
    if (!vertexShader || !fragmentShader) {
      if (vertexShader) gl.deleteShader(vertexShader);
      if (fragmentShader) gl.deleteShader(fragmentShader);
      return false;
    }
    var program = gl.createProgram();
    if (!program) {
      state.lastError = 'PROGRAM_CREATE_FAILED';
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return false;
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      state.lastError = 'PROGRAM_LINK_FAILED:' + String(gl.getProgramInfoLog(program) || 'unknown');
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return false;
    }
    gl.useProgram(program);
    var vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    var vertexBuffer = gl.createBuffer();
    if (!vertexBuffer) {
      state.lastError = 'VERTEX_BUFFER_CREATE_FAILED';
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return false;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    var positionLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    state.gl = gl;
    state.program = program;
    state.vertexShader = vertexShader;
    state.fragmentShader = fragmentShader;
    state.vertexBuffer = vertexBuffer;
    state.uniforms = {
      time:gl.getUniformLocation(program, 'u_time'),
      ratio:gl.getUniformLocation(program, 'u_ratio'),
      pointer:gl.getUniformLocation(program, 'u_pointer_position'),
      scroll:gl.getUniformLocation(program, 'u_scroll_progress')
    };
    state.contextReleased = false;
    state.lastError = '';
    resizeCanvas();
    return true;
  }

  function resizeCanvas() {
    var canvas = state.canvas;
    var gl = state.gl;
    var dialog = state.dialog;
    if (!canvas || !gl || !dialog) return false;
    var dpr = Math.min(Number(global.devicePixelRatio) || 1, 2);
    var cssWidth = Math.max(1, dialog.clientWidth || 1);
    var cssHeight = Math.max(1, dialog.clientHeight || 1);
    var width = Math.max(1, Math.round(cssWidth * dpr));
    var height = Math.max(1, Math.round(cssHeight * dpr));
    if (state.layer) {
      state.layer.style.width = cssWidth + 'px';
      state.layer.style.height = cssHeight + 'px';
    }
    if (state.glass) {
      state.glass.style.width = cssWidth + 'px';
      state.glass.style.height = cssHeight + 'px';
    }
    if (!state.pointer.initialized) {
      state.pointer.x = state.pointer.tX = cssWidth * 0.5;
      state.pointer.y = state.pointer.tY = cssHeight * 0.5;
      state.pointer.initialized = true;
    }
    if (canvas.width === width && canvas.height === height) return false;
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
    state.lastRatio = width / height;
    gl.useProgram(state.program);
    gl.uniform1f(state.uniforms.ratio, state.lastRatio);
    state.resizeCount += 1;
    return true;
  }

  function profileScrollProgress() {
    var offset = state.dialog ? Number(state.dialog.scrollTop) || 0 : Number(global.pageYOffset) || 0;
    return offset / (2 * Math.max(1, state.dialog ? state.dialog.clientHeight : 1));
  }

  function syncLayerScroll() {
    if (!state.layer || !state.dialog) return;
    var scroll = (Number(state.dialog.scrollTop) || 0) + 'px';
    state.layer.style.setProperty('--lf-profile-vortex-scroll', scroll);
    if (state.glass) state.glass.style.setProperty('--lf-profile-vortex-scroll', scroll);
  }

  function renderFrame() {
    state.raf = 0;
    if (!state.active || !state.gl || !state.program || paused()) return;
    resizeCanvas();
    var currentTime = global.performance && typeof global.performance.now === 'function' ? global.performance.now() : Date.now();

    // Original component smoothing coefficient and pointer normalization.
    state.pointer.x += (state.pointer.tX - state.pointer.x) * 0.2;
    state.pointer.y += (state.pointer.tY - state.pointer.y) * 0.2;

    var gl = state.gl;
    var scrollProgress = profileScrollProgress();
    gl.useProgram(state.program);
    gl.uniform1f(state.uniforms.time, currentTime);
    gl.uniform2f(
      state.uniforms.pointer,
      state.pointer.x / Math.max(1, state.dialog ? state.dialog.clientWidth : 1),
      1 - state.pointer.y / Math.max(1, state.dialog ? state.dialog.clientHeight : 1)
    );
    gl.uniform1f(state.uniforms.scroll, scrollProgress);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    state.lastTime = currentTime;
    state.lastScrollProgress = scrollProgress;
    state.drawCount += 1;
    ensureFrame();
  }

  function ensureFrame() {
    if (!state.active || !state.gl || paused() || state.raf) return;
    state.raf = global.requestAnimationFrame(renderFrame);
  }

  function syncRunState() {
    if (state.layer) state.layer.dataset.paused = String(paused());
    if (paused()) {
      if (state.raf) global.cancelAnimationFrame(state.raf);
      state.raf = 0;
    } else {
      ensureFrame();
    }
  }

  function handleSharedPointer(payload) {
    if (!state.active) return;
    payload = payload || {};
    state.hidden = !!payload.hidden;
    state.reducedMotion = !!payload.reducedMotion;
    state.eco = !!payload.eco;
    state.lastReason = String(payload.reason || 'pointer');
    if (payload.hasPointer && state.dialog && state.layer) {
      var rect = state.layer.getBoundingClientRect();
      var clientX = Number(payload.clientX) || 0;
      var clientY = Number(payload.clientY) || 0;
      var inside = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
      state.pointer.inside = inside;
      if (inside) {
        state.pointer.tX = clientX - rect.left;
        state.pointer.tY = clientY - rect.top;
        state.pointer.updates += 1;
      }
    }
    syncRunState();
  }

  function subscribePointer() {
    if (state.unsubscribePointer) return true;
    var liquid = global.LumiFieldLiquidGlass;
    if (!liquid || typeof liquid.addPointerConsumer !== 'function') return false;
    state.unsubscribePointer = liquid.addPointerConsumer(handleSharedPointer);
    return true;
  }

  function releaseWebGL() {
    if (state.raf) global.cancelAnimationFrame(state.raf);
    state.raf = 0;
    var gl = state.gl;
    if (gl) {
      if (state.vertexBuffer) gl.deleteBuffer(state.vertexBuffer);
      if (state.program) gl.deleteProgram(state.program);
      if (state.vertexShader) gl.deleteShader(state.vertexShader);
      if (state.fragmentShader) gl.deleteShader(state.fragmentShader);
      try {
        var lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      } catch (_) {}
    }
    state.gl = null;
    state.program = null;
    state.vertexShader = null;
    state.fragmentShader = null;
    state.vertexBuffer = null;
    state.uniforms = null;
    state.contextReleased = true;
  }

  function activate(modal) {
    modal = modal || document.getElementById('lf-profile-modal');
    if (!modal || modal.id !== 'lf-profile-modal' || !modal.classList.contains('show')) return false;
    if (state.active && state.modal === modal && state.layer && state.layer.isConnected && state.glass && state.glass.isConnected && state.gl) {
      subscribePointer();
      ensureFrame();
      return true;
    }
    deactivate();
    Array.prototype.slice.call(document.querySelectorAll('#lf-profile-neural-vortex, #lf-profile-neural-vortex-glass')).forEach(function (node) { node.remove(); });
    state.modal = modal;
    state.dialog = modal.querySelector('.lf-profile-dialog');
    if (!state.dialog) return false;
    state.layer = createLayer();
    state.glass = createGlass();
    state.dialog.insertBefore(state.layer, state.dialog.firstChild);
    state.dialog.insertBefore(state.glass, state.layer.nextSibling);
    modal.dataset.lfNeuralVortexActive = 'true';
    state.dialog.dataset.lfNeuralVortexHost = 'true';
    state.active = true;
    state.activateCount += 1;
    state.lastReason = 'activate';
    if (!initWebGL()) {
      state.layer.dataset.webgl = 'unavailable';
      deactivate();
      return false;
    }
    state.layer.dataset.webgl = 'ready';
    global.addEventListener('resize', resizeCanvas, { passive:true });
    state.dialog.addEventListener('scroll', syncLayerScroll, { passive:true });
    state.listenerCount = 2;
    syncLayerScroll();
    subscribePointer();
    syncRunState();
    return true;
  }

  function deactivate() {
    var wasActive = state.active || !!state.layer || !!state.gl || !!state.unsubscribePointer;
    if (state.unsubscribePointer) {
      state.unsubscribePointer();
      state.unsubscribePointer = null;
    }
    if (state.listenerCount) global.removeEventListener('resize', resizeCanvas);
    if (state.dialog) state.dialog.removeEventListener('scroll', syncLayerScroll);
    state.listenerCount = 0;
    releaseWebGL();
    if (state.layer) state.layer.remove();
    if (state.glass) state.glass.remove();
    if (state.modal) delete state.modal.dataset.lfNeuralVortexActive;
    if (state.dialog) delete state.dialog.dataset.lfNeuralVortexHost;
    state.active = false;
    state.modal = null;
    state.dialog = null;
    state.layer = null;
    state.glass = null;
    state.canvas = null;
    state.hidden = false;
    state.reducedMotion = false;
    state.eco = false;
    state.pointer.inside = false;
    state.pointer.initialized = false;
    state.lastReason = 'deactivate';
    if (wasActive) state.deactivateCount += 1;
    return true;
  }

  function refresh() {
    if (!state.active) return false;
    resizeCanvas();
    subscribePointer();
    syncRunState();
    return !!state.gl;
  }

  function getDebug() {
    var layers = document.querySelectorAll('#lf-profile-neural-vortex');
    var glasses = document.querySelectorAll('#lf-profile-neural-vortex-glass');
    var layer = layers[0] || null;
    var glass = glasses[0] || null;
    var width = Math.max(1, state.dialog ? state.dialog.clientWidth : 1);
    var height = Math.max(1, state.dialog ? state.dialog.clientHeight : 1);
    var dialogRect = state.dialog ? state.dialog.getBoundingClientRect() : null;
    var contentRect = state.dialog && dialogRect ? {
      left:dialogRect.left + state.dialog.clientLeft,
      top:dialogRect.top + state.dialog.clientTop,
      right:dialogRect.left + state.dialog.clientLeft + state.dialog.clientWidth,
      bottom:dialogRect.top + state.dialog.clientTop + state.dialog.clientHeight,
      width:state.dialog.clientWidth,
      height:state.dialog.clientHeight
    } : null;
    return {
      version:'2.1.0',
      source:SOURCE,
      active:!!(state.active && layer && layer.isConnected && glass && glass.isConnected && state.gl),
      layerCount:layers.length,
      glassCount:glasses.length,
      svgCount:layer ? layer.querySelectorAll('svg').length : 0,
      canvasCount:layer ? layer.querySelectorAll('canvas').length : 0,
      webglReady:!!state.gl,
      programCount:state.program ? 1 : 0,
      shaderCount:(state.vertexShader ? 1 : 0) + (state.fragmentShader ? 1 : 0),
      bufferCount:state.vertexBuffer ? 1 : 0,
      pointerConsumerCount:state.unsubscribePointer ? 1 : 0,
      ownListenerCount:state.listenerCount,
      ownRafCount:state.raf ? 1 : 0,
      ownIntervalCount:0,
      pointer:{
        x:state.pointer.x / width,
        y:state.pointer.y / height,
        targetX:state.pointer.tX / width,
        targetY:state.pointer.tY / height,
        updates:state.pointer.updates,
        inside:state.pointer.inside
      },
      uniforms:{
        time:state.lastTime,
        ratio:state.lastRatio,
        pointer:[state.pointer.x / width, 1 - state.pointer.y / height],
        scrollProgress:state.lastScrollProgress
      },
      viewport:state.canvas ? { width:state.canvas.width, height:state.canvas.height, dpr:Math.min(Number(global.devicePixelRatio) || 1, 2) } : null,
      drawCount:state.drawCount,
      resizeCount:state.resizeCount,
      paused:paused(),
      reducedMotion:state.reducedMotion,
      eco:state.eco,
      documentHidden:state.hidden,
      activateCount:state.activateCount,
      deactivateCount:state.deactivateCount,
      lastReason:state.lastReason,
      lastError:state.lastError,
      contextReleased:state.contextReleased,
      host:'lf-profile-dialog',
      contained:!!(layer && state.dialog && layer.parentElement === state.dialog),
      glassContained:!!(glass && state.dialog && glass.parentElement === state.dialog),
      layerOrder:state.dialog ? Array.prototype.map.call(state.dialog.children, function (node) {
        if (node === layer) return 'neural-vortex';
        if (node === glass) return 'panel-glass';
        return 'content-control';
      }) : [],
      dialogRect:dialogRect ? { left:dialogRect.left, top:dialogRect.top, right:dialogRect.right, bottom:dialogRect.bottom, width:dialogRect.width, height:dialogRect.height } : null,
      contentRect:contentRect,
      fixedPosition:layer ? global.getComputedStyle(layer).position === 'fixed' : false,
      layerPosition:layer ? global.getComputedStyle(layer).position : '',
      layerPointerEvents:layer ? global.getComputedStyle(layer).pointerEvents : '',
      canvasPointerEvents:state.canvas ? global.getComputedStyle(state.canvas).pointerEvents : '',
      glassPointerEvents:glass ? global.getComputedStyle(glass).pointerEvents : '',
      layerZIndex:layer ? global.getComputedStyle(layer).zIndex : '',
      glassZIndex:glass ? global.getComputedStyle(glass).zIndex : '',
      blurFilter:layer ? global.getComputedStyle(layer).filter : '',
      backdropFilter:state.dialog ? (global.getComputedStyle(state.dialog).backdropFilter || global.getComputedStyle(state.dialog).webkitBackdropFilter || '') : ''
    };
  }

  global.LumiFieldProfileNeuralVortex = Object.freeze({
    version:'2.1.0',
    source:SOURCE,
    activate:activate,
    deactivate:deactivate,
    refresh:refresh,
    getDebug:getDebug,
    dispose:deactivate
  });
})(window);
