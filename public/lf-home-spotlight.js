(function (global) {
  'use strict';
  if (global.__lumifieldHomeSpotlightInstalled) return;
  global.__lumifieldHomeSpotlightInstalled = true;

  var state = {
    row:null,
    cards:[],
    unsubscribe:null,
    registered:false,
    disposed:false,
    activeCount:0,
    visibleCount:0,
    sharedFrames:0,
    refreshes:0,
    geometryDirty:true,
    geometry:[],
    resizeObserver:null
  };
  var PROXIMITY = 92;

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function homeIsActive() {
    return !!(document.body && document.body.classList.contains('empty-home-active')) &&
      !document.body.classList.contains('immersive-mode') && document.visibilityState !== 'hidden';
  }
  function ensureLayer(card) {
    var layers = Array.prototype.slice.call(card.querySelectorAll(':scope > .lf-home-spotlight-layer'));
    var layer = layers.shift();
    layers.forEach(function (extra) { extra.remove(); });
    if (!layer) {
      layer = document.createElement('span');
      layer.className = 'lf-home-spotlight-layer';
      layer.setAttribute('aria-hidden', 'true');
      card.appendChild(layer);
    }
    if (card.getAttribute('data-lf-home-spotlight') !== 'true') card.setAttribute('data-lf-home-spotlight', 'true');
    return layer;
  }
  function ensureCards() {
    if (state.row && state.row.isConnected && state.cards.length === 5 &&
        state.cards.every(function (card) { return card && card.isConnected; })) return true;
    var row = document.getElementById('home-tile-row');
    if (!row) return false;
    var cards = Array.prototype.slice.call(row.querySelectorAll(':scope > .home-tile'));
    if (cards.length !== 5) return false;
    cards.forEach(ensureLayer);
    state.row = row;
    state.cards = cards;
    state.geometryDirty = true;
    if (state.resizeObserver) {
      state.resizeObserver.disconnect();
      state.resizeObserver.observe(state.row);
      state.cards.forEach(function (card) { state.resizeObserver.observe(card); });
    }
    return true;
  }
  function visibleCard(card, rect) {
    if (!rect || rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= global.innerWidth || rect.top >= global.innerHeight) return false;
    var style = global.getComputedStyle(card);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
  }
  function distanceToRect(rect, x, y) {
    var dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
    var dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function setStyle(card, name, value) {
    if (card.style.getPropertyValue(name) !== value) card.style.setProperty(name, value);
  }
  function refreshGeometry() {
    state.geometry = state.cards.map(function (card) {
      var rect = card.getBoundingClientRect();
      return { rect:rect, visible:visibleCard(card, rect) };
    });
    state.geometryDirty = false;
  }
  function clearCard(card) {
    setStyle(card, '--lf-home-spotlight-opacity', '0');
    if (card.getAttribute('data-lf-home-spotlight-active') !== 'false') card.setAttribute('data-lf-home-spotlight-active', 'false');
  }
  function clearAll() {
    state.activeCount = 0;
    state.visibleCount = 0;
    state.cards.forEach(clearCard);
  }
  function updateCard(card, rect, pointerX, pointerY) {
    var localX = clamp(pointerX - rect.left, 0, rect.width);
    var localY = clamp(pointerY - rect.top, 0, rect.height);
    var opacity = clamp(1 - distanceToRect(rect, pointerX, pointerY) / PROXIMITY, 0, 1);
    var hue = 285 - clamp(pointerX / Math.max(1, global.innerWidth), 0, 1) * 175;
    if (opacity > .02) {
      setStyle(card, '--lf-home-spotlight-x', localX.toFixed(2) + 'px');
      setStyle(card, '--lf-home-spotlight-y', localY.toFixed(2) + 'px');
      setStyle(card, '--lf-home-spotlight-hue', hue.toFixed(2));
    }
    setStyle(card, '--lf-home-spotlight-opacity', opacity > .02 ? opacity.toFixed(3) : '0');
    var active = opacity > .02;
    if (card.getAttribute('data-lf-home-spotlight-active') !== String(active)) card.setAttribute('data-lf-home-spotlight-active', String(active));
    if (active) state.activeCount += 1;
  }
  function updateFromSharedPointer(payload) {
    state.refreshes += 1;
    if (payload && payload.reason !== 'pointer') state.geometryDirty = true;
    if (payload && payload.reason === 'pointer') state.sharedFrames += 1;
    if (!ensureCards() || !payload || !payload.hasPointer || payload.hidden || payload.reducedMotion || payload.eco || !homeIsActive()) {
      clearAll();
      return;
    }
    var pointerX = Number(payload.clientX);
    var pointerY = Number(payload.clientY);
    if (!Number.isFinite(pointerX) || !Number.isFinite(pointerY)) {
      clearAll();
      return;
    }
    if (state.geometryDirty || state.geometry.length !== state.cards.length) refreshGeometry();
    state.activeCount = 0;
    state.visibleCount = 0;
    state.cards.forEach(function (card, index) {
      var geometry = state.geometry[index];
      var rect = geometry.rect;
      if (!geometry.visible) { clearCard(card); return; }
      state.visibleCount += 1;
      updateCard(card, rect, pointerX, pointerY);
    });
  }
  function sharedApi() {
    var api = global.LumiFieldLiquidGlass;
    return api && typeof api.addPointerConsumer === 'function' && typeof api.getDebug === 'function' ? api : null;
  }
  function refresh() {
    if (state.disposed || !ensureCards()) return false;
    var api = sharedApi();
    if (!api) return false;
    if (!state.registered) {
      state.unsubscribe = api.addPointerConsumer(updateFromSharedPointer);
      state.registered = true;
      if (global.ResizeObserver) {
        state.resizeObserver = new ResizeObserver(function () { state.geometryDirty = true; });
        state.resizeObserver.observe(state.row);
        state.cards.forEach(function (card) { state.resizeObserver.observe(card); });
      }
    }
    api.refresh('home-spotlight-refresh', true);
    return true;
  }
  function dispose() {
    if (typeof state.unsubscribe === 'function') state.unsubscribe();
    state.unsubscribe = null;
    if (state.resizeObserver) state.resizeObserver.disconnect();
    state.resizeObserver = null;
    state.registered = false;
    state.disposed = true;
    clearAll();
    state.cards.forEach(function (card) {
      card.removeAttribute('data-lf-home-spotlight');
      card.removeAttribute('data-lf-home-spotlight-active');
      card.querySelectorAll(':scope > .lf-home-spotlight-layer').forEach(function (layer) { layer.remove(); });
    });
    state.cards = [];
    state.row = null;
  }
  function getDebug() {
    var api = sharedApi();
    var shared = api ? api.getDebug() : null;
    var row = document.getElementById('home-tile-row');
    return {
      version:'1.0.0',
      initialized:!!state.row,
      disposed:state.disposed,
      targetCount:row ? row.querySelectorAll(':scope > .home-tile[data-lf-home-spotlight="true"]').length : 0,
      layerCount:row ? row.querySelectorAll(':scope > .home-tile > .lf-home-spotlight-layer').length : 0,
      activeCount:homeIsActive() ? state.activeCount : 0,
      visibleCount:homeIsActive() ? state.visibleCount : 0,
      sharedPointer:true,
      sharedFrames:state.sharedFrames,
      refreshes:state.refreshes,
      ownPointerListenerCount:0,
      ownRafCount:0,
      ownIntervalCount:0,
      pointerConsumerCount:state.registered ? 1 : 0,
      sharedScheduler:shared ? { listenerCount:shared.listenerCount, pointerConsumerCount:shared.pointerConsumerCount, pointerConsumerErrors:shared.pointerConsumerErrors } : null
    };
  }

  global.LumiFieldHomeSpotlight = Object.freeze({ refresh:refresh, getDebug:getDebug, dispose:dispose });
  global.__lumifieldHomeSpotlightDebug = getDebug;
  refresh();
})(window);
