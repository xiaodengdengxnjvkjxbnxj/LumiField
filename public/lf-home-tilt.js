(function (global) {
  'use strict';
  if (global.__lumifieldHomeTiltInstalled) return;
  global.__lumifieldHomeTiltInstalled = true;

  var state = {
    cards:[],
    unsubscribe:null,
    registered:false,
    disposed:false,
    activeIndex:-1,
    sharedFrames:0,
    refreshes:0
  };
  var MAX_TILT = 7.5;
  var HOVER_SCALE = 1.012;

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function homeIsActive() {
    return !!(document.body && document.body.classList.contains('empty-home-active')) &&
      !document.body.classList.contains('immersive-mode') && document.visibilityState !== 'hidden';
  }
  function ensureCards() {
    var cards = Array.prototype.slice.call(document.querySelectorAll('#empty-home .home-grid > .home-card'));
    if (cards.length !== 6) return false;
    cards.forEach(function (card, index) {
      if (card.getAttribute('data-lf-home-tilt') !== 'true') card.setAttribute('data-lf-home-tilt', 'true');
      card.dataset.lfHomeTiltIndex = String(index);
    });
    state.cards = cards;
    return true;
  }
  function visible(card, rect) {
    if (!rect || card.offsetWidth <= 0 || card.offsetHeight <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= global.innerWidth || rect.top >= global.innerHeight) return false;
    var style = global.getComputedStyle(card);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
  }
  function resetCard(card) {
    card.style.setProperty('--lf-home-tilt-x', '0deg');
    card.style.setProperty('--lf-home-tilt-y', '0deg');
    card.style.setProperty('--lf-home-tilt-scale', '1');
    if (card.getAttribute('data-lf-home-tilt-active') !== 'false') card.setAttribute('data-lf-home-tilt-active', 'false');
  }
  function resetAll() {
    state.activeIndex = -1;
    state.cards.forEach(resetCard);
  }
  function updateFromSharedPointer(payload) {
    state.refreshes += 1;
    if (payload && payload.reason === 'pointer') state.sharedFrames += 1;
    if (!ensureCards() || !payload || !payload.hasPointer || payload.hidden || payload.reducedMotion || payload.eco || !homeIsActive()) {
      resetAll();
      return;
    }
    var pointerX = Number(payload.clientX);
    var pointerY = Number(payload.clientY);
    if (!Number.isFinite(pointerX) || !Number.isFinite(pointerY)) { resetAll(); return; }
    var active = -1;
    var measurements = state.cards.map(function (card) {
      var rect = card.getBoundingClientRect();
      return {
        rect:rect,
        centerX:rect.left + rect.width / 2,
        centerY:rect.top + rect.height / 2,
        width:Math.max(1, card.offsetWidth),
        height:Math.max(1, card.offsetHeight)
      };
    });
    state.cards.forEach(function (card, index) {
      var box = measurements[index];
      var inside = visible(card, box.rect) &&
        Math.abs(pointerX - box.centerX) <= box.width / 2 &&
        Math.abs(pointerY - box.centerY) <= box.height / 2;
      if (!inside || active >= 0) { resetCard(card); return; }
      var localX = clamp((pointerX - box.centerX) / box.width + 0.5, 0, 1);
      var localY = clamp((pointerY - box.centerY) / box.height + 0.5, 0, 1);
      var rotateX = (localY - 0.5) * MAX_TILT * 2;
      var rotateY = (localX - 0.5) * -MAX_TILT * 2;
      card.style.setProperty('--lf-home-tilt-x', rotateX.toFixed(3) + 'deg');
      card.style.setProperty('--lf-home-tilt-y', rotateY.toFixed(3) + 'deg');
      card.style.setProperty('--lf-home-tilt-scale', String(HOVER_SCALE));
      card.setAttribute('data-lf-home-tilt-active', 'true');
      active = index;
    });
    state.activeIndex = active;
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
    }
    api.refresh('home-tilt-refresh', true);
    return true;
  }
  function dispose() {
    if (typeof state.unsubscribe === 'function') state.unsubscribe();
    state.unsubscribe = null;
    state.registered = false;
    state.disposed = true;
    resetAll();
    state.cards.forEach(function (card) {
      card.removeAttribute('data-lf-home-tilt');
      card.removeAttribute('data-lf-home-tilt-active');
      card.removeAttribute('data-lf-home-tilt-index');
      card.style.removeProperty('--lf-home-tilt-x');
      card.style.removeProperty('--lf-home-tilt-y');
      card.style.removeProperty('--lf-home-tilt-scale');
    });
    state.cards = [];
  }
  function getDebug() {
    var api = sharedApi();
    var shared = api ? api.getDebug() : null;
    return {
      version:'1.0.0',
      initialized:state.cards.length === 6,
      disposed:state.disposed,
      targetCount:document.querySelectorAll('#empty-home .home-grid > .home-card[data-lf-home-tilt="true"]').length,
      activeCount:document.querySelectorAll('#empty-home .home-grid > .home-card[data-lf-home-tilt-active="true"]').length,
      activeIndex:homeIsActive() ? state.activeIndex : -1,
      maxTiltDegrees:MAX_TILT,
      hoverScale:HOVER_SCALE,
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

  global.LumiFieldHomeTilt = Object.freeze({ refresh:refresh, getDebug:getDebug, dispose:dispose });
  global.__lumifieldHomeTiltDebug = getDebug;
  refresh();
})(window);
