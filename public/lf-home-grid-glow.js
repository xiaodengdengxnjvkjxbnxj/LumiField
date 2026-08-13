(function (global) {
  'use strict';
  if (global.__lumifieldHomeGridGlowInstalled) return;
  global.__lumifieldHomeGridGlowInstalled = true;

  var state = {
    grid:null,
    cards:[],
    junctions:[],
    activeCards:0,
    activeJunctions:0,
    sharedPointerFrames:0,
    refreshes:0,
    registered:false,
    disposed:false,
    resizeObserver:null,
    unsubscribe:null
  };
  var PROXIMITY = 56;
  var JUNCTION_PROXIMITY = 82;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
  function setActiveFlag(node, active) {
    var value = active ? 'true' : 'false';
    if (node.getAttribute('data-lf-grid-glow-active') !== value) node.setAttribute('data-lf-grid-glow-active', value);
  }
  function homeIsActive() {
    return !!(document.body && document.body.classList.contains('empty-home-active')) &&
      !document.body.classList.contains('immersive-mode') && document.visibilityState !== 'hidden';
  }
  function reducedMotion() {
    return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function ensureLayer(card) {
    var layers = card.querySelectorAll(':scope > .lf-grid-glow-layer');
    var layer = layers[0];
    for (var index = 1; index < layers.length; index += 1) layers[index].remove();
    if (!layer) {
      layer = document.createElement('span');
      layer.className = 'lf-grid-glow-layer';
      layer.setAttribute('aria-hidden', 'true');
      card.appendChild(layer);
    }
    if (card.getAttribute('data-lf-grid-glow') !== 'true') card.setAttribute('data-lf-grid-glow', 'true');
  }
  function ensureJunctions(grid) {
    var nodes = Array.prototype.slice.call(grid.querySelectorAll(':scope > .lf-grid-glow-junction'));
    while (nodes.length < 2) {
      var node = document.createElement('span');
      node.className = 'lf-grid-glow-junction';
      node.setAttribute('aria-hidden', 'true');
      grid.appendChild(node);
      nodes.push(node);
    }
    while (nodes.length > 2) nodes.pop().remove();
    return nodes;
  }
  function ensureNodes() {
    var grid = document.querySelector('#empty-home .home-grid');
    if (!grid) return false;
    var cards = Array.prototype.slice.call(document.querySelectorAll('#empty-home .home-grid > .home-card'));
    if (cards.length !== 6) return false;
    cards.forEach(ensureLayer);
    if (grid.getAttribute('data-lf-grid-glow-ready') !== 'true') grid.setAttribute('data-lf-grid-glow-ready', 'true');
    state.grid = grid;
    state.cards = cards;
    state.junctions = ensureJunctions(grid);
    return true;
  }
  function setCardGlow(card, rect, pointerX, pointerY, opacity) {
    var x = clamp(pointerX - rect.left, 0, rect.width);
    var y = clamp(pointerY - rect.top, 0, rect.height);
    var angle = Math.atan2(pointerY - (rect.top + rect.height / 2), pointerX - (rect.left + rect.width / 2)) * 180 / Math.PI;
    card.style.setProperty('--lf-grid-glow-x', x.toFixed(2) + 'px');
    card.style.setProperty('--lf-grid-glow-y', y.toFixed(2) + 'px');
    card.style.setProperty('--lf-grid-glow-angle', angle.toFixed(2) + 'deg');
    card.style.setProperty('--lf-grid-glow-opacity', opacity.toFixed(3));
    setActiveFlag(card, opacity > .02);
  }
  function cardDistance(rect, pointerX, pointerY) {
    var dx = pointerX < rect.left ? rect.left - pointerX : pointerX > rect.right ? pointerX - rect.right : 0;
    var dy = pointerY < rect.top ? rect.top - pointerY : pointerY > rect.bottom ? pointerY - rect.bottom : 0;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function junctionPoint(rects, upperIndex) {
    var topLeft = rects[upperIndex];
    var topRight = rects[upperIndex + 1];
    var bottomLeft = rects[upperIndex + 2];
    var bottomRight = rects[upperIndex + 3];
    if (!topLeft || !topRight || !bottomLeft || !bottomRight) return null;
    if (Math.abs(topLeft.top - topRight.top) > 12 || Math.abs(bottomLeft.top - bottomRight.top) > 12) return null;
    return {
      x:(topLeft.right + topRight.left) / 2,
      y:(Math.max(topLeft.bottom, topRight.bottom) + Math.min(bottomLeft.top, bottomRight.top)) / 2
    };
  }
  function clearGlow() {
    state.activeCards = 0;
    state.activeJunctions = 0;
    state.cards.forEach(function (card) {
      card.style.setProperty('--lf-grid-glow-opacity', '0');
      setActiveFlag(card, false);
    });
    state.junctions.forEach(function (node) {
      node.style.setProperty('--lf-grid-junction-opacity', '0');
      setActiveFlag(node, false);
    });
  }
  function updateFromSharedPointer(payload) {
    state.refreshes += 1;
    if (payload && payload.reason === 'pointer') state.sharedPointerFrames += 1;
    if (!ensureNodes() || !payload || !payload.hasPointer || payload.hidden || payload.reducedMotion || payload.eco || !homeIsActive()) {
      clearGlow();
      return;
    }
    var pointerX = Number(payload.clientX);
    var pointerY = Number(payload.clientY);
    if (!Number.isFinite(pointerX) || !Number.isFinite(pointerY)) {
      clearGlow();
      return;
    }
    var rects = state.cards.map(function (card) { return card.getBoundingClientRect(); });
    var gridRect = state.grid.getBoundingClientRect();
    state.activeCards = 0;
    state.cards.forEach(function (card, index) {
      var rect = rects[index];
      var opacity = clamp(1 - cardDistance(rect, pointerX, pointerY) / PROXIMITY, 0, 1);
      setCardGlow(card, rect, pointerX, pointerY, opacity);
      if (opacity > .02) state.activeCards += 1;
    });
    var points = [junctionPoint(rects, 0), junctionPoint(rects, 2)];
    state.activeJunctions = 0;
    state.junctions.forEach(function (node, index) {
      var point = points[index];
      if (!point) {
        node.style.setProperty('--lf-grid-junction-opacity', '0');
        setActiveFlag(node, false);
        return;
      }
      var dx = pointerX - point.x;
      var dy = pointerY - point.y;
      var opacity = clamp(1 - Math.sqrt(dx * dx + dy * dy) / JUNCTION_PROXIMITY, 0, 1);
      node.style.left = (point.x - gridRect.left).toFixed(2) + 'px';
      node.style.top = (point.y - gridRect.top).toFixed(2) + 'px';
      node.style.setProperty('--lf-grid-junction-opacity', opacity.toFixed(3));
      setActiveFlag(node, opacity > .02);
      if (opacity > .02) state.activeJunctions += 1;
    });
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
        state.resizeObserver = new ResizeObserver(function () {
          if (!state.disposed) api.refresh('grid-glow-resize', true);
        });
        state.resizeObserver.observe(state.grid);
      }
      global.addEventListener('pagehide', dispose, { once:true });
    }
    api.refresh('grid-glow-refresh', true);
    return true;
  }
  function dispose() {
    if (state.disposed) return;
    state.disposed = true;
    if (typeof state.unsubscribe === 'function') state.unsubscribe();
    if (state.resizeObserver) state.resizeObserver.disconnect();
    state.unsubscribe = null;
    state.resizeObserver = null;
    state.registered = false;
    clearGlow();
  }
  function getDebug() {
    var api = sharedApi();
    var shared = api ? api.getDebug() : null;
    var homeActive = homeIsActive();
    var layerCount = document.querySelectorAll('#empty-home .home-grid > .home-card > .lf-grid-glow-layer').length;
    var junctionCount = document.querySelectorAll('#empty-home .home-grid > .lf-grid-glow-junction').length;
    var pending = !!(shared && shared.schedulerCount);
    return {
      version:'1.0.0',
      initialized:!!state.grid,
      disposed:state.disposed,
      sharedPointer:true,
      targetCount:state.cards.length,
      layerCount:layerCount,
      junctionCount:junctionCount,
      pointerListenerCount:state.registered && shared ? 1 : 0,
      ownPointerListenerCount:0,
      rafPending:pending,
      rafRequests:state.sharedPointerFrames,
      rafExecutions:state.sharedPointerFrames,
      ownRafCount:0,
      activeCardCount:homeActive ? state.activeCards : 0,
      activeJunctionCount:homeActive ? state.activeJunctions : 0,
      reducedMotion:reducedMotion(),
      refreshes:state.refreshes,
      listeners:{ pointermove:state.registered && shared ? 1 : 0, ownPointermove:0, pagehide:state.registered ? 1 : 0 },
      raf:{ shared:true, pending:pending, requests:state.sharedPointerFrames, executions:state.sharedPointerFrames, own:0 },
      active:{ home:homeActive, cards:homeActive ? state.activeCards : 0, junctions:homeActive ? state.activeJunctions : 0 },
      resources:{ sharedPointerConsumer:state.registered ? 1 : 0, resizeObserver:state.resizeObserver ? 1 : 0, ownPointerListeners:0, ownRaf:0 },
      sharedScheduler:shared ? { listenerCount:shared.listenerCount, pointerConsumerCount:shared.pointerConsumerCount, pointerConsumerErrors:shared.pointerConsumerErrors } : null
    };
  }

  global.LumiFieldHomeGridGlow = Object.freeze({ refresh:refresh, getDebug:getDebug });
  global.__lumifieldGridGlowDebug = getDebug;
  refresh();
})(window);
