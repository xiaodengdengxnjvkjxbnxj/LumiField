(function (global) {
  'use strict';
  if (global.__lumifieldHomeEdgeGlowInstalled) return;
  global.__lumifieldHomeEdgeGlowInstalled = true;

  var state = {
    button:null,
    layer:null,
    unsubscribe:null,
    registered:false,
    disposed:false,
    active:false,
    angle:0,
    spread:0,
    pointerFrames:0,
    lastAngle:null,
    lastPointerAt:0
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function sharedApi() {
    var api = global.LumiFieldLiquidGlass;
    return api && typeof api.addPointerConsumer === 'function' && typeof api.getDebug === 'function' ? api : null;
  }

  function ensureLayer() {
    var button = document.getElementById('home-btn');
    if (!button) return false;
    var layers = button.querySelectorAll(':scope > .lf-home-edge-glow');
    var layer = layers[0];
    for (var index = 1; index < layers.length; index += 1) layers[index].remove();
    if (!layer) {
      layer = document.createElement('span');
      layer.className = 'lf-home-edge-glow';
      layer.setAttribute('aria-hidden', 'true');
      button.appendChild(layer);
    }
    if (button.getAttribute('data-lf-home-edge-glow') !== 'true') button.setAttribute('data-lf-home-edge-glow', 'true');
    state.button = button;
    state.layer = layer;
    return true;
  }

  function circularDistance(left, right) {
    var delta = Math.abs(left - right) % 360;
    return Math.min(delta, 360 - delta);
  }

  function setInactive() {
    if (!state.button || !state.layer) return;
    state.active = false;
    state.button.setAttribute('data-lf-home-edge-active', 'false');
    state.layer.style.setProperty('--lf-home-highlight-opacity', '0');
    state.layer.style.setProperty('--lf-home-highlight-blur', '.35px');
  }

  function updateFromSharedPointer(payload) {
    if (state.disposed || !ensureLayer()) return;
    if (payload && payload.reason === 'pointer') state.pointerFrames += 1;
    if (!payload || !payload.hasPointer || payload.hidden) {
      setInactive();
      return;
    }
    var x = Number(payload.clientX);
    var y = Number(payload.clientY);
    var rect = state.button.getBoundingClientRect();
    if (!Number.isFinite(x) || !Number.isFinite(y) || rect.width <= 0 || rect.height <= 0 ||
        x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setInactive();
      return;
    }

    var angle = (Math.atan2(y - (rect.top + rect.height / 2), x - (rect.left + rect.width / 2)) * 180 / Math.PI + 450) % 360;
    var now = global.performance && performance.now ? performance.now() : Date.now();
    var elapsed = state.lastPointerAt ? Math.max(8, now - state.lastPointerAt) : 16;
    var speed = state.lastAngle == null ? 0 : circularDistance(angle, state.lastAngle) / elapsed;
    var spread = Math.max(state.spread * .82, clamp(speed * 36, 0, 42));
    var start = angle - 50 - spread * .5;
    var opacity = clamp(.74 + speed * .32, .74, 1);
    var blur = clamp(.35 + spread * .035, .35, 1.82);

    state.active = true;
    state.angle = Number(angle.toFixed(2));
    state.spread = Number(spread.toFixed(2));
    state.lastAngle = angle;
    state.lastPointerAt = now;
    state.button.setAttribute('data-lf-home-edge-active', 'true');
    state.layer.style.setProperty('--lf-home-highlight-start', start.toFixed(2) + 'deg');
    state.layer.style.setProperty('--lf-home-highlight-opacity', opacity.toFixed(3));
    state.layer.style.setProperty('--lf-home-highlight-blur', blur.toFixed(2) + 'px');
  }

  function refresh() {
    if (state.disposed || !ensureLayer()) return false;
    var api = sharedApi();
    if (!api) return false;
    if (!state.registered) {
      state.unsubscribe = api.addPointerConsumer(updateFromSharedPointer);
      state.registered = true;
      global.addEventListener('pagehide', dispose, { once:true });
    }
    api.refresh('home-edge-glow-refresh', true);
    return true;
  }

  function dispose() {
    if (state.disposed) return;
    state.disposed = true;
    if (typeof state.unsubscribe === 'function') state.unsubscribe();
    state.unsubscribe = null;
    state.registered = false;
    setInactive();
    state.lastAngle = null;
    state.lastPointerAt = 0;
    if (state.layer && state.layer.parentNode) state.layer.parentNode.removeChild(state.layer);
    if (state.button) {
      state.button.removeAttribute('data-lf-home-edge-glow');
      state.button.removeAttribute('data-lf-home-edge-active');
    }
    state.layer = null;
    state.button = null;
  }

  function getDebug() {
    var shared = sharedApi();
    var sharedDebug = shared ? shared.getDebug() : null;
    var rect = state.button ? state.button.getBoundingClientRect() : null;
    return {
      version:'1.0.0',
      initialized:!!state.button,
      disposed:state.disposed,
      targetId:state.button ? state.button.id : '',
      targetCount:document.querySelectorAll('#home-btn').length,
      layerCount:document.querySelectorAll('#home-btn > .lf-home-edge-glow').length,
      active:state.active,
      angle:state.angle,
      spread:state.spread,
      pointerFrames:state.pointerFrames,
      geometry:rect ? { width:rect.width, height:rect.height, left:rect.left, top:rect.top } : null,
      resources:{ sharedPointerConsumer:state.registered ? 1 : 0, ownPointerListeners:0, ownRaf:0 },
      sharedScheduler:sharedDebug ? {
        listenerCount:sharedDebug.listenerCount,
        pointerConsumerCount:sharedDebug.pointerConsumerCount,
        pointerConsumerErrors:sharedDebug.pointerConsumerErrors
      } : null
    };
  }

  global.LumiFieldHomeEdgeGlow = Object.freeze({ refresh:refresh, getDebug:getDebug, dispose:dispose });
  global.__lumifieldHomeEdgeGlowDebug = getDebug;
  refresh();
})(window);
