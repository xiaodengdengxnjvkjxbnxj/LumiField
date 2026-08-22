(function (global) {
  'use strict';
  if (!global || !global.document || global.__lumifieldWeatherTiltSpotlightInstalled) return;
  global.__lumifieldWeatherTiltSpotlightInstalled = true;

  var document = global.document;
  var TILT_LIMIT = 15;
  var HOVER_SCALE = 1.05;
  var PERSPECTIVE = 1200;
  var EFFECT = 'evade';
  var GLOW_BASE = 220;
  var GLOW_SPREAD = 200;
  var GLOW_SIZE = 200;
  var GLOW_BORDER = 3;
  var state = {
    root:null,
    tiltLayer:null,
    glowLayer:null,
    outerLayer:null,
    unsubscribe:null,
    registered:false,
    disposed:false,
    hovered:false,
    rotateX:0,
    rotateY:0,
    px:0.5,
    py:0.5,
    localX:0,
    localY:0,
    xp:0,
    yp:0,
    hue:GLOW_BASE,
    sharedFrames:0,
    updates:0,
    rect:null,
    visible:false,
    geometryDirty:true,
    resizeObserver:null
  };

  function finite(value, fallback) {
    value = Number(value);
    return Number.isFinite(value) ? value : fallback;
  }

  function homeIsActive() {
    return !!(document.body && document.body.classList.contains('empty-home-active')) &&
      !document.body.classList.contains('immersive-mode') &&
      !document.body.classList.contains('render-deep-sleep') &&
      document.visibilityState !== 'hidden';
  }

  function ensureSingleLayer(root, className) {
    var layers = Array.prototype.slice.call(root.querySelectorAll(':scope > .' + className));
    var layer = layers.shift();
    layers.forEach(function (extra) { extra.remove(); });
    if (!layer) {
      layer = document.createElement('span');
      layer.className = className;
      layer.setAttribute('aria-hidden', 'true');
      root.appendChild(layer);
    }
    return layer;
  }

  function ensureNodes() {
    if (state.root && state.root.isConnected && state.tiltLayer && state.tiltLayer.isConnected &&
        state.glowLayer && state.glowLayer.isConnected && state.outerLayer && state.outerLayer.isConnected) return true;
    var root = document.querySelector('#empty-home .lf-weather-shell');
    if (!root) return false;
    var tiltLayer = ensureSingleLayer(root, 'lf-weather-tilt-spotlight-layer');
    var glowLayer = ensureSingleLayer(root, 'lf-weather-card-spotlight-layer');
    var outerLayers = Array.prototype.slice.call(glowLayer.querySelectorAll(':scope > .lf-weather-card-spotlight-outer'));
    var outerLayer = outerLayers.shift();
    outerLayers.forEach(function (extra) { extra.remove(); });
    if (!outerLayer) {
      outerLayer = document.createElement('span');
      outerLayer.className = 'lf-weather-card-spotlight-outer';
      outerLayer.setAttribute('aria-hidden', 'true');
      glowLayer.appendChild(outerLayer);
    }
    root.setAttribute('data-lf-weather-tilt-spotlight', 'true');
    root.style.setProperty('--lf-weather-tilt-limit', String(TILT_LIMIT));
    root.style.setProperty('--lf-weather-tilt-perspective', PERSPECTIVE + 'px');
    root.style.setProperty('--lf-weather-spotlight-base', String(GLOW_BASE));
    root.style.setProperty('--lf-weather-spotlight-spread', String(GLOW_SPREAD));
    root.style.setProperty('--lf-weather-spotlight-size', GLOW_SIZE + 'px');
    root.style.setProperty('--lf-weather-spotlight-border', GLOW_BORDER + 'px');
    state.root = root;
    state.tiltLayer = tiltLayer;
    state.glowLayer = glowLayer;
    state.outerLayer = outerLayer;
    state.geometryDirty = true;
    return true;
  }
  function setStyle(name, value) {
    if (state.root && state.root.style.getPropertyValue(name) !== value) state.root.style.setProperty(name, value);
  }

  function setActive(active) {
    state.hovered = !!active;
    if (state.root && state.root.getAttribute('data-lf-weather-tilt-active') !== String(!!active)) {
      state.root.setAttribute('data-lf-weather-tilt-active', String(!!active));
    }
  }

  function resetTilt() {
    state.rotateX = 0;
    state.rotateY = 0;
    state.px = 0.5;
    state.py = 0.5;
    setActive(false);
    if (!state.root) return;
    setStyle('--lf-weather-rotate-x', '0deg');
    setStyle('--lf-weather-rotate-y', '0deg');
    setStyle('--lf-weather-tilt-scale', '1');
  }

  function clearAll() {
    resetTilt();
    if (!state.root) return;
    if (state.root.getAttribute('data-lf-weather-spotlight-enabled') !== 'false') state.root.setAttribute('data-lf-weather-spotlight-enabled', 'false');
    setStyle('--lf-weather-spotlight-x', '-10000px');
    setStyle('--lf-weather-spotlight-y', '-10000px');
    setStyle('--lf-weather-spotlight-local-x', '-10000px');
    setStyle('--lf-weather-spotlight-local-y', '-10000px');
    setStyle('--lf-weather-spotlight-hue', String(GLOW_BASE));
  }

  function visible(root, rect) {
    if (!rect || rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= global.innerWidth || rect.top >= global.innerHeight) return false;
    var style = global.getComputedStyle(root);
    return style.display !== 'none' && style.visibility !== 'hidden' && finite(style.opacity, 1) > 0;
  }
  function refreshGeometry() {
    state.rect = state.root.getBoundingClientRect();
    state.visible = visible(state.root, state.rect);
    state.geometryDirty = false;
  }

  function updateFromSharedPointer(payload) {
    state.updates += 1;
    if (payload && payload.reason !== 'pointer') state.geometryDirty = true;
    if (payload && payload.reason === 'pointer') state.sharedFrames += 1;
    if (!ensureNodes() || !payload || !payload.hasPointer || payload.hidden || payload.reducedMotion || payload.eco || !homeIsActive()) {
      clearAll();
      return;
    }
    var clientX = Number(payload.clientX);
    var clientY = Number(payload.clientY);
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      clearAll();
      return;
    }
    if (state.geometryDirty || !state.rect) refreshGeometry();
    var rect = state.rect;
    if (!state.visible) {
      clearAll();
      return;
    }

    var localX = clientX - rect.left;
    var localY = clientY - rect.top;
    var xp = clientX / Math.max(1, global.innerWidth);
    var yp = clientY / Math.max(1, global.innerHeight);
    state.localX = localX;
    state.localY = localY;
    state.xp = xp;
    state.yp = yp;
    state.hue = GLOW_BASE + xp * GLOW_SPREAD;
    if (state.root.getAttribute('data-lf-weather-spotlight-enabled') !== 'true') state.root.setAttribute('data-lf-weather-spotlight-enabled', 'true');
    setStyle('--lf-weather-spotlight-x', clientX.toFixed(2) + 'px');
    setStyle('--lf-weather-spotlight-y', clientY.toFixed(2) + 'px');
    setStyle('--lf-weather-spotlight-local-x', localX.toFixed(2) + 'px');
    setStyle('--lf-weather-spotlight-local-y', localY.toFixed(2) + 'px');
    setStyle('--lf-weather-spotlight-xp', xp.toFixed(4));
    setStyle('--lf-weather-spotlight-yp', yp.toFixed(4));
    setStyle('--lf-weather-spotlight-hue', state.hue.toFixed(3));

    var inside = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    if (!inside) {
      resetTilt();
      return;
    }

    var px = (clientX - rect.left) / rect.width;
    var py = (clientY - rect.top) / rect.height;
    var direction = EFFECT === 'evade' ? -1 : 1;
    var rotateX = (py - 0.5) * (TILT_LIMIT * 2) * direction;
    var rotateY = (px - 0.5) * -(TILT_LIMIT * 2) * direction;
    state.rotateX = rotateX;
    state.rotateY = rotateY;
    state.px = px;
    state.py = py;
    setActive(true);
    setStyle('--lf-weather-rotate-x', rotateX.toFixed(3) + 'deg');
    setStyle('--lf-weather-rotate-y', rotateY.toFixed(3) + 'deg');
    setStyle('--lf-weather-tilt-scale', String(HOVER_SCALE));
    setStyle('--lf-weather-tilt-spot-x', (px * 100).toFixed(3) + '%');
    setStyle('--lf-weather-tilt-spot-y', (py * 100).toFixed(3) + '%');
  }

  function sharedApi() {
    var api = global.LumiFieldLiquidGlass;
    return api && typeof api.addPointerConsumer === 'function' && typeof api.getDebug === 'function' ? api : null;
  }

  function refresh() {
    if (state.disposed || !ensureNodes()) return false;
    var api = sharedApi();
    if (!api) return false;
    if (!state.registered) {
      state.unsubscribe = api.addPointerConsumer(updateFromSharedPointer);
      state.registered = true;
      if (global.ResizeObserver) {
        state.resizeObserver = new ResizeObserver(function () { state.geometryDirty = true; });
        state.resizeObserver.observe(state.root);
      }
      global.addEventListener('pagehide', dispose, { once:true });
    }
    api.refresh('weather-tilt-spotlight-refresh', true);
    return true;
  }

  function dispose() {
    if (state.disposed) return;
    state.disposed = true;
    if (typeof state.unsubscribe === 'function') state.unsubscribe();
    state.unsubscribe = null;
    if (state.resizeObserver) state.resizeObserver.disconnect();
    state.resizeObserver = null;
    state.registered = false;
    clearAll();
    if (state.root) {
      state.root.removeAttribute('data-lf-weather-tilt-spotlight');
      state.root.removeAttribute('data-lf-weather-tilt-active');
      state.root.removeAttribute('data-lf-weather-spotlight-enabled');
      [
        '--lf-weather-tilt-limit','--lf-weather-tilt-perspective','--lf-weather-rotate-x','--lf-weather-rotate-y','--lf-weather-tilt-scale',
        '--lf-weather-tilt-spot-x','--lf-weather-tilt-spot-y','--lf-weather-spotlight-base','--lf-weather-spotlight-spread',
        '--lf-weather-spotlight-size','--lf-weather-spotlight-border','--lf-weather-spotlight-x','--lf-weather-spotlight-y',
        '--lf-weather-spotlight-local-x','--lf-weather-spotlight-local-y','--lf-weather-spotlight-xp','--lf-weather-spotlight-yp','--lf-weather-spotlight-hue'
      ].forEach(function (name) { state.root.style.removeProperty(name); });
    }
    [state.tiltLayer, state.glowLayer].forEach(function (node) { if (node && node.isConnected) node.remove(); });
    state.root = null;
    state.tiltLayer = null;
    state.glowLayer = null;
    state.outerLayer = null;
  }

  function getDebug() {
    var api = sharedApi();
    var shared = api ? api.getDebug() : null;
    var root = document.querySelector('#empty-home .lf-weather-shell');
    var autoRegion = root && root.querySelector(':scope > .lf-hot-comment-card');
    return {
      version:'1.0.0',
      initialized:!!(state.root && state.root.isConnected),
      disposed:state.disposed,
      homeActive:homeIsActive(),
      hovered:homeIsActive() && state.hovered,
      targetCount:document.querySelectorAll('#empty-home .lf-weather-shell[data-lf-weather-tilt-spotlight="true"]').length,
      tiltLayerCount:root ? root.querySelectorAll(':scope > .lf-weather-tilt-spotlight-layer').length : 0,
      glowLayerCount:root ? root.querySelectorAll(':scope > .lf-weather-card-spotlight-layer').length : 0,
      nestedEffectCount:autoRegion ? autoRegion.querySelectorAll('[data-lf-weather-tilt-spotlight],.lf-weather-tilt-spotlight-layer,.lf-weather-card-spotlight-layer').length : 0,
      tilt:{ limit:TILT_LIMIT, scale:HOVER_SCALE, perspective:PERSPECTIVE, effect:EFFECT, rotateX:Number(state.rotateX.toFixed(3)), rotateY:Number(state.rotateY.toFixed(3)), px:Number(state.px.toFixed(4)), py:Number(state.py.toFixed(4)) },
      spotlight:{ base:GLOW_BASE, spread:GLOW_SPREAD, size:GLOW_SIZE, border:GLOW_BORDER, x:Number(state.localX.toFixed(2)), y:Number(state.localY.toFixed(2)), xp:Number(state.xp.toFixed(4)), yp:Number(state.yp.toFixed(4)), hue:Number(state.hue.toFixed(3)) },
      sourceSemantics:{ tiltSpotlight:true, cardSpotlight:true, backgroundAttachment:'fixed', transitionMs:200, spotlightOpacityTransitionMs:300 },
      sharedPointer:true,
      sharedFrames:state.sharedFrames,
      updates:state.updates,
      ownPointerListenerCount:0,
      ownRafCount:0,
      ownIntervalCount:0,
      resources:{ sharedPointerConsumer:state.registered ? 1 : 0, pagehide:state.registered ? 1 : 0, layers:(state.tiltLayer ? 1 : 0) + (state.glowLayer ? 1 : 0) },
      sharedScheduler:shared ? { listenerCount:shared.listenerCount, pointerConsumerCount:shared.pointerConsumerCount, pointerConsumerErrors:shared.pointerConsumerErrors } : null
    };
  }

  global.LumiFieldWeatherTiltSpotlight = Object.freeze({ refresh:refresh, getDebug:getDebug, dispose:dispose });
  global.__lumifieldWeatherTiltSpotlightDebug = getDebug;
  refresh();
})(window);
