(function (global) {
  'use strict';
  if (global.__lumifieldHomePetInstalled) return;
  global.__lumifieldHomePetInstalled = true;

  var SOURCE_ASPECT = 289 / 231;
  var MOTION_SAFE_TOP = 8;
  var state = {
    root:null,
    resizeBound:false,
    disposed:false,
    mounts:0,
    unmounts:0,
    layouts:0,
    lastReason:'init'
  };

  function visible(element) {
    if (!element) return false;
    var rect = element.getBoundingClientRect();
    var style = global.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
      style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.02;
  }
  function blockingModalVisible() {
    return Array.prototype.some.call(document.querySelectorAll('.modal-mask.show'), visible);
  }
  function shouldMount() {
    var body = document.body;
    return !!body && body.classList.contains('empty-home-active') &&
      !body.classList.contains('immersive-mode') &&
      !body.classList.contains('splash-active') &&
      !body.classList.contains('splash-revealing') &&
      !body.classList.contains('lf-auth-locked') &&
      !body.classList.contains('visual-guide-active') &&
      !blockingModalVisible();
  }
  function powerPaused() {
    var body = document.body;
    return !!(body && (body.classList.contains('render-deep-sleep') ||
      body.classList.contains('render-background-eco'))) ||
      !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function sourceApi() {
    var api = global.LumiFieldHomePetSource;
    return api && typeof api.mount === 'function' && typeof api.unmount === 'function' ? api : null;
  }
  function createRoot() {
    var root = document.createElement('div');
    root.id = 'lf-home-pet';
    root.className = 'lf-home-pet';
    root.setAttribute('aria-hidden', 'true');
    root.setAttribute('data-source-adaptation', '21st-reuno-ui-shader-svg');
    return root;
  }
  function rectOf(selector) {
    var element = document.querySelector(selector);
    if (!visible(element)) return null;
    var rect = element.getBoundingClientRect();
    return { left:rect.left, top:rect.top, right:rect.right, bottom:rect.bottom, width:rect.width, height:rect.height };
  }
  function rectanglesOverlap(a, b) {
    return !!(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
  }
  function blockerRects() {
    return ['#search-area', '#empty-home', '#top-right', '.desktop-window-controls', '#trial-banner', '#beat-chip']
      .map(function (selector) { return { selector:selector, rect:rectOf(selector) }; })
      .filter(function (entry) { return !!entry.rect; });
  }
  function layout() {
    if (!state.root) return false;
    var home = rectOf('#empty-home');
    var search = rectOf('#search-area');
    var top = Math.max(8, Math.min(14, global.innerHeight * 0.018));
    var left = Math.max(28, Math.min(52, global.innerWidth * 0.034));
    var desired = Math.max(54, Math.min(64, global.innerWidth * 0.052));
    var maxByHome = home ? (home.top - top - 4 - MOTION_SAFE_TOP - 2) / (SOURCE_ASPECT * 1.08) : desired;
    var maxBySearch = search ? (search.left - left - 20) / 2 : desired;
    var width = Math.floor(Math.min(desired, maxByHome, maxBySearch));
    var visualHeight = width * SOURCE_ASPECT;
    var safeBottom = Math.ceil(visualHeight * 0.08 + 2);
    var rootHeight = MOTION_SAFE_TOP + visualHeight + safeBottom;
    var candidate = { left:left, top:top, right:left + width, bottom:top + rootHeight };
    var usable = width >= 50 && !blockerRects().some(function (entry) { return rectanglesOverlap(candidate, entry.rect); });
    if (!usable) {
      width = 50;
      visualHeight = width * SOURCE_ASPECT;
      safeBottom = Math.ceil(visualHeight * 0.08 + 2);
      rootHeight = MOTION_SAFE_TOP + visualHeight + safeBottom;
    }
    state.root.hidden = !usable;
    state.root.style.setProperty('--lf-home-pet-visual-width', width + 'px');
    state.root.style.setProperty('--lf-home-pet-visual-height', visualHeight + 'px');
    state.root.style.setProperty('--lf-home-pet-safe-top', MOTION_SAFE_TOP + 'px');
    state.root.style.setProperty('--lf-home-pet-greeting-width', width + 'px');
    state.root.style.left = Math.round(left) + 'px';
    state.root.style.top = Math.round(top) + 'px';
    state.root.style.width = width + 'px';
    state.root.style.height = Math.ceil(rootHeight) + 'px';
    state.layouts += 1;
    return usable;
  }
  function updatePowerState() {
    if (!state.root) return;
    var paused = powerPaused();
    state.root.setAttribute('data-paused', paused ? 'true' : 'false');
    var api = sourceApi();
    if (api && typeof api.setPaused === 'function') api.setPaused(state.root, paused);
  }
  function mount(reason) {
    if (state.disposed || state.root || !shouldMount()) return false;
    var api = sourceApi();
    if (!api) return false;
    state.root = createRoot();
    (document.getElementById('desktop-window-shell') || document.body).appendChild(state.root);
    if (!api.mount(state.root, { paused:powerPaused() })) {
      state.root.remove();
      state.root = null;
      return false;
    }
    if (!state.resizeBound) {
      global.addEventListener('resize', layout, { passive:true });
      state.resizeBound = true;
    }
    state.mounts += 1;
    state.lastReason = String(reason || 'mount');
    layout();
    updatePowerState();
    return true;
  }
  function unmount(reason) {
    var api = sourceApi();
    if (api && state.root) api.unmount(state.root);
    if (state.resizeBound) global.removeEventListener('resize', layout);
    state.resizeBound = false;
    if (state.root && state.root.parentNode) state.root.parentNode.removeChild(state.root);
    if (state.root) state.unmounts += 1;
    state.root = null;
    state.lastReason = String(reason || 'unmount');
  }
  function sync(reason) {
    if (state.disposed) return false;
    if (shouldMount()) {
      if (!state.root) mount(reason || 'sync');
      else {
        layout();
        updatePowerState();
      }
      return !!state.root;
    }
    unmount(reason || 'sync');
    return false;
  }
  function dispose() {
    unmount('dispose');
    state.disposed = true;
  }
  function getDebug() {
    var root = state.root;
    var rect = root ? root.getBoundingClientRect() : null;
    var home = rectOf('#empty-home');
    var search = rectOf('#search-area');
    var petRect = rect ? { left:rect.left, top:rect.top, right:rect.right, bottom:rect.bottom, width:rect.width, height:rect.height } : null;
    var svg = root ? root.querySelector('.lf-home-pet-source-svg') : null;
    var greeting = root ? root.querySelector('.lf-home-pet-greeting') : null;
    var svgBounds = svg ? svg.getBoundingClientRect() : null;
    var greetingBounds = greeting ? greeting.getBoundingClientRect() : null;
    var visualWidth = root ? parseFloat(root.style.getPropertyValue('--lf-home-pet-visual-width')) || 0 : 0;
    var visualHeight = root ? parseFloat(root.style.getPropertyValue('--lf-home-pet-visual-height')) || 0 : 0;
    var blockers = blockerRects();
    var api = sourceApi();
    var source = api && typeof api.getDebug === 'function' ? api.getDebug(root) : null;
    var paperHosts = root ? root.querySelectorAll('[data-paper-shader]').length : 0;
    var canvasCount = root ? root.querySelectorAll('canvas').length : 0;
    return {
      version:'2.0.0-source-adaptation',
      mounted:!!root,
      disposed:state.disposed,
      rootCount:document.querySelectorAll('#lf-home-pet').length,
      svgCount:root ? root.querySelectorAll('svg[viewBox="0 0 231 289"]').length : 0,
      canvasCount:canvasCount,
      webglContextCount:paperHosts,
      paperShaderHostCount:paperHosts,
      pointerEvents:root ? global.getComputedStyle(root).pointerEvents : '',
      eyeX:source ? source.eyeX : 0,
      eyeY:source ? source.eyeY : 0,
      eyeLimitX:8,
      eyeLimitY:8,
      trackingRadiusX:source ? source.trackingRadiusX : 0,
      trackingRadiusY:source ? source.trackingRadiusY : 0,
      trackingMapping:source ? source.mapping : '',
      hovered:!!(source && source.hovered),
      greeting:source ? source.greeting : '',
      greetingCount:root ? root.querySelectorAll('.lf-home-pet-greeting').length : 0,
      greetingVisible:!!(greeting && greeting.getAttribute('data-visible') === 'true'),
      greetingBounds:greetingBounds ? { left:greetingBounds.left, top:greetingBounds.top, right:greetingBounds.right, bottom:greetingBounds.bottom, width:greetingBounds.width, height:greetingBounds.height } : null,
      rect:petRect,
      visualWidth:visualWidth,
      visualHeight:visualHeight,
      sourceAspect:SOURCE_ASPECT,
      visualBounds:svgBounds ? { left:svgBounds.left, top:svgBounds.top, right:svgBounds.right, bottom:svgBounds.bottom, width:svgBounds.width, height:svgBounds.height } : null,
      contentFitsRoot:!!(petRect && svgBounds && svgBounds.left >= petRect.left - 0.5 && svgBounds.right <= petRect.right + 0.5 && svgBounds.top >= petRect.top - 0.5 && svgBounds.bottom <= petRect.bottom + 0.5),
      homeRect:home,
      searchRect:search,
      blockerRects:blockers,
      blockerOverlaps:blockers.filter(function (entry) { return rectanglesOverlap(petRect, entry.rect); }).map(function (entry) { return entry.selector; }),
      greetingBlockerOverlaps:blockers.filter(function (entry) { return rectanglesOverlap(greetingBounds, entry.rect); }).map(function (entry) { return entry.selector; }),
      overlapsHome:rectanglesOverlap(petRect, home),
      overlapsSearch:rectanglesOverlap(petRect, search),
      eligible:shouldMount(),
      modalVisible:blockingModalVisible(),
      paused:powerPaused(),
      mounts:state.mounts,
      unmounts:state.unmounts,
      layouts:state.layouts,
      pointerConsumerCount:0,
      mouseMoveListenerCount:source ? source.listenerCount : 0,
      pointerFrames:source ? source.pointerFrames : 0,
      resizeListenerCount:state.resizeBound ? 1 : 0,
      source:source,
      lastReason:state.lastReason
    };
  }

  global.LumiFieldHomePet = Object.freeze({ sync:sync, layout:layout, getDebug:getDebug, dispose:dispose });
  global.__lumifieldHomePetDebug = getDebug;
  sync('install');
})(window);
