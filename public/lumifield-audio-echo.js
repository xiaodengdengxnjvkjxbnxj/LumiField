(function () {
  'use strict';

  var THREE = window.THREE;
  var ECHO_LAYER = 29;
  var SHAPES = ['shape1', 'shape2'];
  var NORMALIZED_ANCHOR = { x:0.5, y:0.62 };
  var QUALITY_SCALES = { low:0.62, medium:0.82, high:1, ultra:1.22 };
  var DEFAULT_STATE = {
    enabled:false, shape:'shape1', quality:'high', renderResolution:1,
    audioMonitor:true, responseStrength:1.18, responseRange:0.72,
    visualEq:[1,1,1,1,1,1,1,1], rippleEnabled:true, rippleSensitivity:0.15,
    rippleCooldown:60, idleWave:true, idleDebounce:1, idleFade:1,
    cameraDistance:1, cameraHorizontal:0, cameraElevation:27,
    autoRotate:false, rotateSpeed:0.5, theme:'nocturnal',
    accentEnabled:true, accentColor:'#ffffff', accentStrength:0.78,
    particleStrength:0.72, mode1LeftLyricsEnabled:false, flip:false,
    showColorOptions:true,
    playerVisible:true, playerCover:true, playerSize:1, playerX:0, playerY:0,
    exposureSize:2.2, exposureStrength:0.76, exposureRadius:0.62,
    trailLength:0.72, trailDecay:0.12, flashThreshold:0.78,
    flashEnabled:true, reducedFlash:true
  };
  var state = copyState(DEFAULT_STATE);
  var active = null;
  var activeShape = '';
  var manuallyPaused = false;
  var generation = 0;
  var buildCount = 0;
  var disposeCount = 0;
  var lastFrameAt = 0;
  var lastLyricAt = 0;
  var viewport = { dirty:true, container:null, canvas:null, containerRect:null, canvasRect:null };
  var resizeObserver = null;
  var lifecycleListeners = 0;
  var pointer = {
    canvas:null, down:false, pointerId:null, x:0, y:0, lastX:0, lastY:0,
    moved:false, hoverX:0, hoverY:0, zoom:1,
    rotationX:0, rotationY:0, panX:0, panY:0, listeners:0
  };
  var renderScratch = THREE ? {
    viewport:new THREE.Vector4(), scissor:new THREE.Vector4(), size:new THREE.Vector2()
  } : null;
  var errors = [];
  var metrics = {
    renderPasses:0, clearDepthCalls:0, stateRestoreCount:0,
    lastViewport:null, lastScissor:null, lastRenderAt:0, drawCalls:0
  };
  var reportedRenderScale = 1;

  function clamp(value, min, max) {
    value = Number(value);
    return Math.max(min, Math.min(max, isFinite(value) ? value : min));
  }

  function normalizeShape(value) {
    value = String(value || '').toLowerCase();
    if (value === 'shape1' || value === 'one' || value === '1') return 'shape1';
    if (value === 'shape2' || value === 'two' || value === '2') return 'shape2';
    // Retired four-shape records migrate to the supported primary source mode.
    if (value === 'shape3' || value === 'shape4' || value === 'three' || value === 'four' || value === '3' || value === '4') return 'shape1';
    return '';
  }

  function copyState(value) {
    var result = Object.assign({}, value || {});
    result.shape = normalizeShape(result.shape) || 'shape1';
    result.quality = String(result.quality || 'high').toLowerCase();
    if (result.quality === 'auto') result.quality = 'medium';
    if (!Object.prototype.hasOwnProperty.call(QUALITY_SCALES, result.quality)) result.quality = 'high';
    result.visualEq = Array.isArray(result.visualEq) ? result.visualEq.slice(0, 8) : DEFAULT_STATE.visualEq.slice();
    while (result.visualEq.length < 8) result.visualEq.push(1);
    result.visualEq = result.visualEq.map(function (entry) { return clamp(entry, 0, 2); });
    return result;
  }

  function adapters() {
    return {
      shape1:window.LumiFieldAudioEchoShape1Adapter,
      shape2:window.LumiFieldAudioEchoShape2Adapter
    };
  }

  function availableAdapter(shape) {
    var definition = adapters()[shape];
    return definition && definition.id === shape && typeof definition.create === 'function' ? definition : null;
  }

  function surfaceAvailable() {
    if (!state.enabled || manuallyPaused || document.hidden || !document.body) return false;
    if (document.body.classList.contains('lf-auth-locked') || document.body.classList.contains('splash-active') || document.body.classList.contains('empty-home-active')) return false;
    return !document.body.classList.contains('render-deep-sleep');
  }

  function isActive() {
    return !!(active && surfaceAvailable());
  }

  function bridge() {
    return window.Shape1LyricsPreservationBridge || null;
  }

  function syncLyrics(force) {
    var lyrics = bridge();
    if (!lyrics || typeof lyrics.configure !== 'function') return false;
    return lyrics.configure({
      active:surfaceAvailable() && !!activeShape,
      enabled:state.mode1LeftLyricsEnabled === true,
      force:force === true
    });
  }

  function disposeInstance(instance) {
    if (!instance) return;
    try {
      if (typeof instance.dispose === 'function') instance.dispose();
    } catch (error) {
      errors.push('dispose:' + String(error && error.message || error));
    }
    disposeCount++;
  }

  function createInstance(shape, nextState) {
    var definition = availableAdapter(shape);
    if (!definition) throw new Error('Audio Echo adapter unavailable: ' + shape);
    var instance = definition.create({
      THREE:THREE,
      layer:ECHO_LAYER,
      state:copyState(nextState),
      onEvent:function () {}
    });
    if (!instance || !instance.scene || !instance.camera || typeof instance.update !== 'function' || typeof instance.dispose !== 'function') {
      disposeInstance(instance);
      throw new Error('Audio Echo adapter contract invalid: ' + shape);
    }
    return instance;
  }

  function activateMode(value) {
    var shape = normalizeShape(value || state.shape);
    if (!shape || SHAPES.indexOf(shape) < 0) return false;
    if (active && activeShape === shape) {
      if (typeof active.setState === 'function') active.setState(copyState(state));
      if (typeof active.setActive === 'function') active.setActive(true);
      if (active.scene) active.scene.visible = true;
      if (document.body) document.body.classList.add('lf-audio-echo-active');
      syncLyrics(true);
      return true;
    }
    var next;
    try {
      next = createInstance(shape, state);
    } catch (error) {
      errors.push('activate:' + String(error && error.message || error));
      if (errors.length > 20) errors.shift();
      return false;
    }
    var previous = active;
    active = next;
    activeShape = shape;
    generation++;
    buildCount++;
    disposeInstance(previous);
    if (document.body) document.body.classList.add('lf-audio-echo-active');
    syncLyrics(true);
    return true;
  }

  function deactivateMode() {
    if (active && typeof active.setActive === 'function') active.setActive(false);
    if (active && active.scene) active.scene.visible = false;
    if (document.body) document.body.classList.remove('lf-audio-echo-active');
    syncLyrics(true);
    return true;
  }

  function disposeMode() {
    var previous = active;
    active = null;
    activeShape = '';
    generation++;
    disposeInstance(previous);
    if (document.body) document.body.classList.remove('lf-audio-echo-active');
    var lyrics = bridge();
    if (lyrics && typeof lyrics.dispose === 'function') lyrics.dispose();
    return true;
  }

  function applyState(next) {
    next = next && typeof next === 'object' ? next : {};
    var candidate = copyState(Object.assign({}, state, next));
    var requestedShape = normalizeShape(next.shape == null ? candidate.shape : next.shape);
    if (!requestedShape || SHAPES.indexOf(requestedShape) < 0) return false;
    candidate.shape = requestedShape;
    var before = state;
    state = candidate;
    if (!state.enabled) {
      disposeMode();
      teardownPointer();
      refreshRendererQuality('disabled');
      return true;
    }
    setupPointer();
    if (!surfaceAvailable()) {
      deactivateMode();
      refreshRendererQuality('surface-unavailable');
      return true;
    }
    if (!active || activeShape !== state.shape) {
      if (!activateMode(state.shape)) {
        state = before;
        return false;
      }
    } else if (typeof active.setState === 'function') {
      active.setState(copyState(state));
    }
    if (active && active.scene) active.scene.visible = true;
    if (active && typeof active.setActive === 'function') active.setActive(true);
    if (document.body) document.body.classList.add('lf-audio-echo-active');
    syncLyrics(true);
    refreshRendererQuality('state');
    return true;
  }

  function audioFrame(now, dt) {
    var audio = window.audio || null;
    var monitorEnabled = state.audioMonitor !== false;
    var frequencyData = monitorEnabled ? (window.frequencyData || null) : null;
    return {
      now:Number(now) || performance.now(),
      time:(Number(now) || performance.now()) / 1000,
      dt:clamp(dt, 0.001, 0.1),
      frequencyData:frequencyData,
      sampleRate:window.audioCtx && Number(window.audioCtx.sampleRate) || 48000,
      playing:!!(monitorEnabled && audio && !audio.paused && !audio.ended),
      currentTime:audio ? Number(audio.currentTime) || 0 : 0,
      state:copyState(state),
      gesture:{
        x:pointer.rotationX,
        y:pointer.rotationY,
        panX:pointer.panX,
        panY:pointer.panY,
        mouseX:pointer.hoverX,
        mouseY:pointer.hoverY,
        zoom:pointer.zoom,
        orbitRadius:Number(window.orbit && window.orbit.userRadius || 0)
      }
    };
  }

  function updateAudioFrame(now, dt) {
    if (!state.enabled) {
      if (active) disposeMode();
      return false;
    }
    if (!surfaceAvailable()) {
      deactivateMode();
      refreshRendererQuality('surface-unavailable');
      return false;
    }
    if (!active || activeShape !== state.shape) {
      if (!activateMode(state.shape)) return false;
    }
    if (active.scene) active.scene.visible = true;
    if (typeof active.setActive === 'function') active.setActive(true);
    if (document.body) document.body.classList.add('lf-audio-echo-active');
    refreshRendererQuality('surface-active');
    var nowMs = Number(now) || performance.now();
    var delta = Number(dt);
    if (!isFinite(delta) || delta <= 0) delta = lastFrameAt ? Math.min(0.1, (nowMs - lastFrameAt) / 1000) : 1 / 60;
    lastFrameAt = nowMs;
    try {
      active.update(audioFrame(nowMs, delta));
    } catch (error) {
      errors.push('update:' + String(error && error.message || error));
      if (errors.length > 20) errors.shift();
      return false;
    }
    if (nowMs - lastLyricAt >= 80) {
      lastLyricAt = nowMs;
      syncLyrics(false);
    }
    return true;
  }

  function invalidateViewport() { viewport.dirty = true; }

  function copyRect(rect) {
    return { left:rect.left, top:rect.top, right:rect.right, bottom:rect.bottom, width:rect.width, height:rect.height };
  }

  function viewportFor(renderer, force) {
    var container = document.getElementById('canvas-container');
    var canvas = renderer && renderer.domElement;
    if (!container || !canvas) return null;
    if (container !== viewport.container || canvas !== viewport.canvas) {
      viewport.container = container;
      viewport.canvas = canvas;
      viewport.dirty = true;
      if (window.ResizeObserver) {
        if (!resizeObserver) resizeObserver = new ResizeObserver(invalidateViewport);
        resizeObserver.disconnect();
        resizeObserver.observe(container);
        if (canvas !== container) resizeObserver.observe(canvas);
      }
    }
    if (force || viewport.dirty || !viewport.containerRect || !viewport.canvasRect) {
      viewport.containerRect = copyRect(container.getBoundingClientRect());
      viewport.canvasRect = copyRect(canvas.getBoundingClientRect());
      viewport.dirty = false;
    }
    return viewport;
  }

  function renderSharedFrame(renderer) {
    if (!renderer || !active || !active.scene || !active.camera || !surfaceAvailable()) return false;
    var layout = viewportFor(renderer, false);
    if (!layout || layout.containerRect.width <= 1 || layout.containerRect.height <= 1) return false;
    var rect = layout.containerRect;
    var canvasRect = layout.canvasRect;
    var oldViewport = renderScratch.viewport;
    var oldScissor = renderScratch.scissor;
    renderer.getViewport(oldViewport);
    renderer.getScissor(oldScissor);
    var oldScissorTest = renderer.getScissorTest();
    var oldAutoClear = renderer.autoClear;
    var drawing = renderScratch.size;
    renderer.getDrawingBufferSize(drawing);
    var scaleX = drawing.x / canvasRect.width;
    var scaleY = drawing.y / canvasRect.height;
    var x = Math.max(0, Math.round((rect.left - canvasRect.left) * scaleX));
    var y = Math.max(0, Math.round((canvasRect.bottom - rect.bottom) * scaleY));
    var width = Math.max(1, Math.min(drawing.x - x, Math.round(rect.width * scaleX)));
    var height = Math.max(1, Math.min(drawing.y - y, Math.round(rect.height * scaleY)));
    try {
      if (typeof active.resize === 'function') active.resize(width, height, Math.min(scaleX, scaleY));
      renderer.autoClear = false;
      renderer.setViewport(x, y, width, height);
      renderer.setScissor(x, y, width, height);
      renderer.setScissorTest(true);
      renderer.clear(true, true, true);
      if (typeof renderer.clearDepth === 'function') {
        renderer.clearDepth();
        metrics.clearDepthCalls++;
      }
      renderer.render(active.scene, active.camera);
      metrics.drawCalls = renderer.info && renderer.info.render ? Number(renderer.info.render.calls || 0) : -1;
      metrics.renderPasses++;
      metrics.lastViewport = { x:x, y:y, width:width, height:height };
      metrics.lastScissor = { x:x, y:y, width:width, height:height, enabled:true };
      metrics.lastRenderAt = performance.now();
      return true;
    } catch (error) {
      errors.push('render:' + String(error && error.message || error));
      if (errors.length > 20) errors.shift();
      return false;
    } finally {
      renderer.autoClear = oldAutoClear;
      renderer.setViewport(oldViewport);
      renderer.setScissor(oldScissor);
      renderer.setScissorTest(oldScissorTest);
      metrics.stateRestoreCount++;
    }
  }

  function pointerIgnored(event) {
    if (!event || !event.target || !event.target.closest) return false;
    return !!event.target.closest('#search-area,#top-right,#fullscreen-diy-zone,#fx-panel,#fx-fab,#playlist-panel,#bottom-bar,#empty-home,.modal-mask,#toast,button,a,input,select,textarea,[role="button"],[contenteditable],[data-audio-echo-ignore]');
  }

  function pointerDown(event) {
    if (!isActive() || pointerIgnored(event) || (event.button != null && event.button !== 0)) return;
    pointer.down = true;
    pointer.pointerId = event.pointerId;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
    pointer.moved = false;
  }

  function pointerMove(event) {
    if (pointer.canvas) {
      var rect = pointer.canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        pointer.hoverX = clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
        pointer.hoverY = clamp(-(((event.clientY - rect.top) / rect.height) * 2 - 1), -1, 1);
      }
    }
    if (!pointer.down || event.pointerId !== pointer.pointerId) return;
    var dx = event.clientX - pointer.lastX;
    var dy = event.clientY - pointer.lastY;
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
    if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 6) pointer.moved = true;
    if (event.shiftKey || event.altKey) {
      pointer.panX = clamp(pointer.panX - dx * 0.012, -18, 18);
      pointer.panY = clamp(pointer.panY + dy * 0.012, -12, 12);
    } else {
      pointer.rotationX = clamp(pointer.rotationX + dy * 0.0032, -Math.PI * 0.48, Math.PI * 0.48);
      pointer.rotationY += dx * 0.0034;
    }
  }

  function pointerUp(event) {
    if (!pointer.down || event.pointerId !== pointer.pointerId) return;
    var moved = pointer.moved;
    pointer.down = false;
    pointer.pointerId = null;
    if (moved || !active || typeof active.pointer !== 'function') return;
    var layout = viewportFor(window.renderer, true);
    active.pointer({ type:'click', clientX:event.clientX, clientY:event.clientY, rect:layout && layout.containerRect });
  }

  function pointerCancel() {
    pointer.down = false;
    pointer.pointerId = null;
    pointer.moved = false;
  }

  function pointerWheel(event) {
    if (!isActive() || pointerIgnored(event)) return;
    event.preventDefault();
    pointer.zoom = clamp(pointer.zoom - Number(event.deltaY || 0) * 0.0009, 0.45, 2.8);
  }

  function pointerDoubleClick(event) {
    if (!isActive() || pointerIgnored(event)) return;
    event.preventDefault();
    resetCamera();
  }

  function setupPointer() {
    var canvas = window.renderer && window.renderer.domElement;
    if (!canvas || pointer.canvas === canvas) return;
    teardownPointer();
    pointer.canvas = canvas;
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointercancel', pointerCancel);
    canvas.addEventListener('wheel', pointerWheel, { passive:false });
    canvas.addEventListener('dblclick', pointerDoubleClick);
    pointer.listeners = 6;
  }

  function teardownPointer() {
    var canvas = pointer.canvas;
    if (canvas) {
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp);
      canvas.removeEventListener('pointercancel', pointerCancel);
      canvas.removeEventListener('wheel', pointerWheel);
      canvas.removeEventListener('dblclick', pointerDoubleClick);
    }
    pointer.canvas = null;
    pointer.listeners = 0;
    pointerCancel();
  }

  function resetCamera() {
    pointer.zoom = 1;
    pointer.rotationX = 0;
    pointer.rotationY = 0;
    pointer.panX = 0;
    pointer.panY = 0;
    pointer.hoverX = 0;
    pointer.hoverY = 0;
    if (active && typeof active.resetCamera === 'function') active.resetCamera();
    return true;
  }

  function setMode1LeftLyricsEnabled(value) {
    state.mode1LeftLyricsEnabled = value === true;
    syncLyrics(true);
    return state.mode1LeftLyricsEnabled;
  }

  function updateLyricTimeline(force) { return syncLyrics(force === true); }
  function updateViewport() { invalidateViewport(); return viewportFor(window.renderer, true); }
  function getRenderScale() {
    return active && state.enabled && surfaceAvailable() ? QUALITY_SCALES[state.quality] : 1;
  }
  function refreshRendererQuality(reason) {
    var nextScale = getRenderScale();
    if (Math.abs(nextScale - reportedRenderScale) < 0.001) return true;
    reportedRenderScale = nextScale;
    if (typeof window.scheduleMainRendererViewportRefresh === 'function') {
      window.scheduleMainRendererViewportRefresh('audio-echo-' + (reason || 'quality'));
    }
    return true;
  }
  function updateQuality() {
    if (active && typeof active.setState === 'function') active.setState(copyState(state));
    return refreshRendererQuality('quality');
  }
  function updateTheme() { return updateQuality(); }
  function savePreset() { return copyState(state); }
  function restorePreset(value) { return applyState(value); }
  function pause() { manuallyPaused = true; deactivateMode(); return true; }
  function resume() { manuallyPaused = false; setupPointer(); return !state.enabled || !surfaceAvailable() || activateMode(state.shape); }
  function handleVisibilityChange() {
    if (document.hidden) return deactivateMode();
    if (manuallyPaused) return false;
    return !state.enabled || applyState(state);
  }

  function getDebug() {
    var adapterDebug = active && typeof active.getDebug === 'function' ? active.getDebug() : null;
    return {
      state:copyState(state),
      enabled:state.enabled,
      active:isActive(),
      activeShape:activeShape || state.shape,
      mode:activeShape || state.shape,
      registeredShapes:SHAPES.slice(),
      registeredModes:SHAPES.slice(),
      shape3Present:false,
      activeSceneCount:active ? 1 : 0,
      activeAdapter:adapterDebug,
      normalizedAnchor:Object.assign({}, NORMALIZED_ANCHOR),
      quality:{ mode:state.quality, renderScale:getRenderScale(), automaticShapeSwitching:false },
      generation:generation,
      buildCount:buildCount,
      disposeCount:disposeCount,
      allocations:{ rendererCreated:0, audioContextCreated:0, analyserCreated:0, audioElementCreated:0, requestAnimationFrameCreated:0 },
      shared:{
        rendererReused:!!window.renderer,
        analyserMatchesWindow:!!window.analyser,
        contextMatchesWindow:!!window.audioCtx,
        frequencyDataMatchesWindow:!!window.frequencyData,
        audioElementMatchesWindow:!!window.audio
      },
      pointer:{
        listeners:pointer.listeners, zoom:pointer.zoom, down:pointer.down,
        rotation:[pointer.rotationX,pointer.rotationY], translation:[pointer.panX,pointer.panY],
        hover:[pointer.hoverX,pointer.hoverY]
      },
      resources:{ lifecycleListeners:lifecycleListeners, resizeObserver:resizeObserver ? 1 : 0 },
      lyricsBridge:bridge() && typeof bridge().getDebug === 'function' ? bridge().getDebug() : null,
      render:Object.assign({}, metrics, { rendererErrors:errors.slice() }),
      source:{
        manager:'LumiField Audio Echo V2 adapter host',
        releaseGate:'AUDIO_ECHO_V2_GPL_PASS',
        shape3:'DISABLED_FALLBACK_ONLY_NOT_IMPORTED'
      }
    };
  }

  function dispose() {
    disposeMode();
    teardownPointer();
    unbindLifecycle();
    if (resizeObserver) resizeObserver.disconnect();
    resizeObserver = null;
    viewport.container = viewport.canvas = null;
    viewport.containerRect = viewport.canvasRect = null;
    viewport.dirty = true;
  }

  function bindLifecycle() {
    if (lifecycleListeners) return;
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('resize', updateViewport, { passive:true });
    window.addEventListener('scroll', invalidateViewport, { passive:true, capture:true });
    document.addEventListener('fullscreenchange', invalidateViewport);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', invalidateViewport, { passive:true });
      window.visualViewport.addEventListener('scroll', invalidateViewport, { passive:true });
    }
    window.addEventListener('pagehide', dispose, { once:true });
    lifecycleListeners = window.visualViewport ? 7 : 5;
  }

  function unbindLifecycle() {
    if (!lifecycleListeners) return;
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('resize', updateViewport);
    window.removeEventListener('scroll', invalidateViewport, true);
    document.removeEventListener('fullscreenchange', invalidateViewport);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', invalidateViewport);
      window.visualViewport.removeEventListener('scroll', invalidateViewport);
    }
    window.removeEventListener('pagehide', dispose);
    lifecycleListeners = 0;
  }

  var manager = window.LumiFieldAudioEchoManager = {
    registerMode:function () { return false; },
    activateMode:activateMode,
    deactivateMode:deactivateMode,
    disposeMode:disposeMode,
    updateAudioFrame:updateAudioFrame,
    updateCamera:function () { return active && typeof active.updateCamera === 'function' ? active.updateCamera(audioFrame(performance.now(), 1 / 60)) : false; },
    updateViewport:updateViewport,
    updateQuality:updateQuality,
    getRenderScale:getRenderScale,
    getNormalizedAnchor:function () { return Object.assign({}, NORMALIZED_ANCHOR); },
    updateTheme:updateTheme,
    savePreset:savePreset,
    restorePreset:restorePreset,
    pause:pause,
    resume:resume,
    handleVisibilityChange:handleVisibilityChange,
    handleResize:updateViewport,
    handleLyricLineChange:updateLyricTimeline,
    resetCamera:resetCamera,
    renderSharedFrame:renderSharedFrame,
    setMode1LeftLyricsEnabled:setMode1LeftLyricsEnabled,
    updateLyricTimeline:updateLyricTimeline,
    disposeMode1LeftLyricsLayer:function () { var value = bridge(); return value && value.dispose ? value.dispose() : true; },
    applyState:applyState,
    ownsCanvasInput:isActive,
    isActive:isActive,
    getDebug:getDebug,
    dispose:dispose
  };

  bindLifecycle();
  if (window.LumiFieldTask13 && typeof window.LumiFieldTask13.getState === 'function') {
    applyState(window.LumiFieldTask13.getState().echo || DEFAULT_STATE);
  }
})();
