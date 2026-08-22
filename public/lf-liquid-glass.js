(function (global) {
  'use strict';

  if (!global || !global.document) return;

  var document = global.document;
  var root = document.documentElement;
  var state = {
    overrides: { supported: null, reducedMotion: null, eco: null },
    mode: { supported: false, reducedMotion: false, eco: false },
    pointer: { x: 0.5, y: 0.14, target: '', updates: 0 },
    lastPointer: null,
    pendingPointer: null,
    pointerFrame: 0,
    pointerConsumers: [],
    pointerConsumerErrors: 0,
    refreshFrame: 0,
    activeTarget: null,
    listenerCount: 0,
    observer: null,
    testRole: '',
    testTheme: null,
    originalTheme: null
  };

  var targetRules = [
    { selector: '.home-hero', kind: 'weather-content' },
    { selector: '.lf-weather-shell', kind: 'weather' },
    { selector: '#search-results, #playlist-panel, #fx-panel, .modal, .track-detail-modal, .visual-guide-card, .cover-color-pop, .color-lab-pop, .lf-auth-card, .lf-profile-dialog, .lf-account-manager-dialog, .lf-legal-dialog, .lf-wallpaper-dialog', kind: 'panel-strong' },
    { selector: '#search-box, .search-mode-tabs, #upload-tip, #trial-banner, #toast, #source-fallback-notice, #beat-chip, #drop-overlay .drop-text', kind: 'panel' },
    { selector: '.home-card, .home-tile', kind: 'card' },
    { selector: '.home-mosaic-cell', kind: 'media-card' },
    { selector: '.lf-hot-comment-card, .pl-inline-detail, .local-beat-track, .custom-lyric-track, .cover-crop-stage', kind: 'nested' }
  ];
  var dynamicTargetSelector = targetRules.map(function (rule) { return rule.selector; }).concat([
    '.top-account-pill',
    '#user-btn',
    '#lf-account-button',
    '[data-lf-liquid-glass]'
  ]).join(',');

  function list(selector, scope) {
    try {
      return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
    } catch (_) {
      return [];
    }
  }

  function frame(callback) {
    var request = global.requestAnimationFrame || function (fn) { return global.setTimeout(fn, 16); };
    return request.call(global, callback);
  }

  function cancelFrame(handle) {
    if (!handle) return;
    var cancel = global.cancelAnimationFrame || global.clearTimeout;
    cancel.call(global, handle);
  }

  function mark(element, kind) {
    if (element) element.setAttribute('data-lf-liquid-glass', kind);
  }

  function tagTargets() {
    var expected = new Map();
    function expect(element, kind) {
      if (!element) return;
      expected.set(element, kind);
    }
    targetRules.forEach(function (rule) {
      list(rule.selector).forEach(function (element) { expect(element, rule.kind); });
    });

    var userButton = document.getElementById('user-btn');
    var accountPill = document.querySelector('.top-account-pill');
    if (accountPill) expect(accountPill, 'account');
    else if (userButton) expect(userButton, 'account');

    expect(document.getElementById('lf-account-button'), 'account');

    list('[data-lf-liquid-glass]').forEach(function (element) {
      if (expected.has(element)) return;
      element.removeAttribute('data-lf-liquid-glass');
      element.classList.remove('lf-liquid-glass-active');
      if (state.activeTarget === element) state.activeTarget = null;
    });
    expected.forEach(function (kind, element) {
      if (element.getAttribute('data-lf-liquid-glass') !== kind) mark(element, kind);
    });
  }

  function nodeAffectsTargets(node) {
    if (!node || node.nodeType !== 1) return false;
    try {
      return node.matches(dynamicTargetSelector) || !!node.querySelector(dynamicTargetSelector);
    } catch (_) {
      return true;
    }
  }

  function supportsBackdrop() {
    if (state.overrides.supported !== null) return state.overrides.supported;
    var css = global.CSS;
    return !!(css && typeof css.supports === 'function' && (
      css.supports('backdrop-filter', 'blur(1px)') ||
      css.supports('-webkit-backdrop-filter', 'blur(1px)')
    ));
  }

  function prefersReducedMotion() {
    if (state.overrides.reducedMotion !== null) return state.overrides.reducedMotion;
    try {
      return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (_) {
      return false;
    }
  }

  function usesEcoMode() {
    if (state.overrides.eco !== null) return state.overrides.eco;
    var navigator = global.navigator || {};
    var bodyEco = !!(document.body && (
      document.body.classList.contains('lf-clarity-eco') ||
      document.body.classList.contains('render-deep-sleep') ||
      document.body.classList.contains('render-background-eco')
    ));
    var lowCpu = Number(navigator.hardwareConcurrency || 8) <= 4;
    var lowMemory = navigator.deviceMemory != null && Number(navigator.deviceMemory) <= 4;
    return bodyEco || !!document.hidden || lowCpu || lowMemory;
  }

  function numericVariable(name, fallback) {
    var value = Number(readVariable(name, String(fallback)));
    return Number.isFinite(value) ? value : fallback;
  }

  function derivedVariable(name, value) {
    var next = Number(value).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    if (root.style.getPropertyValue(name).trim() !== next) root.style.setProperty(name, next);
  }

  function deriveOptics() {
    var opacity = Math.max(0.08, Math.min(0.78, numericVariable('--lf-glass-panel-opacity', .34)));
    var chroma = Math.max(0, Math.min(1, numericVariable('--lf-glass-chroma', .34)));
    var highlight = Math.max(0, Math.min(1, numericVariable('--lf-glass-highlight', .86)));
    var luma = Math.max(0, Math.min(1, numericVariable('--lf-lg-wallpaper-luma', .42)));
    derivedVariable('--lf-lg-saturate', 1.20 + chroma * .34);
    derivedVariable('--lf-lg-panel-alpha', .15 + opacity * .46);
    derivedVariable('--lf-lg-strong-alpha', .25 + opacity * .54);
    derivedVariable('--lf-lg-card-alpha', .12 + opacity * .40);
    derivedVariable('--lf-lg-account-alpha', .12 + opacity * .42);
    derivedVariable('--lf-lg-highlight-alpha', .045 + highlight * .075);
    derivedVariable('--lf-lg-accent-alpha', .035 + chroma * .13);
    derivedVariable('--lf-lg-wallpaper-alpha', .025 + luma * .055);
    derivedVariable('--lf-lg-border-alpha', .10 + highlight * .085);
    derivedVariable('--lf-lg-edge-accent-alpha', .035 + chroma * .10);
    derivedVariable('--lf-lg-weather-alpha-a', .25 + opacity * .30);
    derivedVariable('--lf-lg-weather-alpha-b', .18 + opacity * .32);
  }

  function applyMode() {
    state.mode.supported = supportsBackdrop();
    state.mode.reducedMotion = prefersReducedMotion();
    state.mode.eco = usesEcoMode();

    root.classList.toggle('lf-liquid-glass-supported', state.mode.supported);
    root.classList.toggle('lf-liquid-glass-fallback', !state.mode.supported);
    root.classList.toggle('lf-liquid-glass-reduced', state.mode.reducedMotion);
    root.classList.toggle('lf-liquid-glass-low-power', state.mode.eco);
    if (state.mode.reducedMotion || state.mode.eco) clearActiveTarget();
  }

  function closestTarget(node) {
    if (!node || node === document) return null;
    if (node.nodeType !== 1) node = node.parentElement;
    if (!node) return null;
    if (typeof node.closest === 'function') return node.closest('[data-lf-liquid-glass]');
    while (node && node !== document.body) {
      if (node.getAttribute && node.hasAttribute('data-lf-liquid-glass')) return node;
      node = node.parentElement;
    }
    return null;
  }

  function clearActiveTarget() {
    if (state.activeTarget) state.activeTarget.classList.remove('lf-liquid-glass-active');
    state.activeTarget = null;
  }

  function pointerPayload(pending, reason) {
    pending = pending || state.lastPointer;
    return {
      clientX: pending ? Number(pending.clientX) || 0 : -10000,
      clientY: pending ? Number(pending.clientY) || 0 : -10000,
      target: pending && pending.target || null,
      hasPointer: !!pending,
      hidden: !!document.hidden,
      reducedMotion: !!state.mode.reducedMotion,
      eco: !!state.mode.eco,
      reason: String(reason || 'refresh')
    };
  }

  function notifyPointerConsumers(pending, reason) {
    if (!state.pointerConsumers.length) return;
    var payload = pointerPayload(pending, reason);
    state.pointerConsumers.slice().forEach(function (consumer) {
      try { consumer(payload); }
      catch (_) { state.pointerConsumerErrors += 1; }
    });
  }

  function addPointerConsumer(consumer) {
    if (typeof consumer !== 'function') return function () {};
    if (state.pointerConsumers.indexOf(consumer) < 0) state.pointerConsumers.push(consumer);
    try { consumer(pointerPayload(null, 'subscribe')); }
    catch (_) { state.pointerConsumerErrors += 1; }
    return function () { removePointerConsumer(consumer); };
  }

  function removePointerConsumer(consumer) {
    var index = state.pointerConsumers.indexOf(consumer);
    if (index >= 0) state.pointerConsumers.splice(index, 1);
  }

  function updatePointer() {
    state.pointerFrame = 0;
    var pending = state.pendingPointer;
    state.pendingPointer = null;
    if (!pending) return;
    notifyPointerConsumers(pending, 'pointer');
    if (state.mode.reducedMotion || state.mode.eco) return;

    var target = closestTarget(pending.target);
    if (!target) {
      clearActiveTarget();
      return;
    }

    var rect = target.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    var x = Math.max(0, Math.min(1, (pending.clientX - rect.left) / rect.width));
    var y = Math.max(0, Math.min(1, (pending.clientY - rect.top) / rect.height));
    target.style.setProperty('--lf-liquid-pointer-x', (x * 100).toFixed(2) + '%');
    target.style.setProperty('--lf-liquid-pointer-y', (y * 100).toFixed(2) + '%');
    if (state.activeTarget !== target) {
      clearActiveTarget();
      state.activeTarget = target;
      target.classList.add('lf-liquid-glass-active');
    }
    state.pointer = {
      x: Number(x.toFixed(4)),
      y: Number(y.toFixed(4)),
      target: target.id || target.getAttribute('data-lf-liquid-glass') || '',
      updates: state.pointer.updates + 1
    };
  }

  function onPointerMove(event) {
    state.lastPointer = {
      clientX: Number(event.clientX) || 0,
      clientY: Number(event.clientY) || 0,
      target: event.target
    };
    state.pendingPointer = state.lastPointer;
    if (!state.pointerFrame) state.pointerFrame = frame(updatePointer);
  }

  function onPointerLeave() {
    cancelFrame(state.pointerFrame);
    state.pointerFrame = 0;
    state.pendingPointer = null;
    state.lastPointer = null;
    clearActiveTarget();
    notifyPointerConsumers(null, 'pointer-leave');
  }

  function activeMode() {
    var value = state.mode.supported ? 'supported' : 'fallback';
    if (state.mode.eco) value += '-eco';
    if (state.mode.reducedMotion) value += '-reduced-motion';
    return value;
  }

  function styleOf(element) {
    try {
      return global.getComputedStyle(element);
    } catch (_) {
      return null;
    }
  }

  function backdropValue(element) {
    var style = styleOf(element);
    if (!style) return '';
    return String(style.backdropFilter || style.webkitBackdropFilter || '').trim();
  }

  function isBlurredTarget(element) {
    if (!element || element.getAttribute('data-lf-liquid-glass') === 'nested') return false;
    var value = backdropValue(element);
    return !!value && value !== 'none' && (value.indexOf('blur') >= 0 || value.indexOf('url(') >= 0);
  }

  function visible(element, style) {
    if (!element || !style || style.display === 'none' || style.visibility === 'hidden') return false;
    var rect = element.getBoundingClientRect();
    return !!rect && rect.width > 0 && rect.height > 0;
  }

  function inspectTarget(element, index) {
    var style = styleOf(element);
    return {
      id: element.id || ('liquid-glass-' + index),
      kind: element.getAttribute('data-lf-liquid-glass') || '',
      visible: visible(element, style),
      background: style ? String(style.backgroundImage || style.background || '') : '',
      backdropFilter: backdropValue(element),
      borderColor: style ? String(style.borderColor || '') : '',
      borderRadius: style ? String(style.borderRadius || '') : '',
      boxShadow: style ? String(style.boxShadow || '') : '',
      pointerEvents: style ? String(style.pointerEvents || '') : '',
      text: String(element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)
    };
  }

  function blurLayerCount(targets) {
    var maximum = 0;
    targets.forEach(function (target) {
      if (!visible(target, styleOf(target))) return;
      var current = target;
      var depth = 0;
      while (current && current !== document.body) {
        if (current.hasAttribute && current.hasAttribute('data-lf-liquid-glass') && visible(current, styleOf(current)) && isBlurredTarget(current)) depth++;
        current = current.parentElement;
      }
      maximum = Math.max(maximum, depth);
    });
    return maximum;
  }

  function readVariable(name, fallback) {
    var style = styleOf(root);
    var value = style ? String(style.getPropertyValue(name) || '').trim() : '';
    return value || fallback || '';
  }

  function backgroundSample(selector) {
    var element = document.querySelector(selector);
    var style = element && styleOf(element);
    return style ? String(style.backgroundImage || style.backgroundColor || '') : '';
  }

  function getDebug() {
    var elements = list('[data-lf-liquid-glass]');
    var targets = elements.map(inspectTarget);
    var accentRgb = readVariable('--lf-liquid-accent-rgb', readVariable('--fc-accent-rgb', '0,245,212'));
    var wallpaperRgb = readVariable('--lf-liquid-wallpaper-rgb', readVariable('--home-accent-rgb', accentRgb));
    return {
      targets: targets,
      activeMode: activeMode(),
      accent: accentRgb,
      accentRgb: accentRgb,
      wallpaperRgb: wallpaperRgb,
      wallpaperSample: {
        rgb: wallpaperRgb,
        luma: Number(readVariable('--lf-lg-wallpaper-luma', '.42')) || 0,
        weather: backgroundSample('.lf-weather-shell'),
        hero: backgroundSample('.home-hero'),
        stage: backgroundSample('#lf-stage-wallpaper'),
        album: backgroundSample('#album-bg')
      },
      pointer: {
        x: state.pointer.x,
        y: state.pointer.y,
        target: state.pointer.target,
        updates: state.pointer.updates
      },
      blurLayerCount: blurLayerCount(elements),
      visibleBlurSurfaceCount: elements.filter(function (element) {
        var style = styleOf(element);
        return visible(element, style) && isBlurredTarget(element);
      }).length,
      listenerCount: state.listenerCount,
      schedulerCount: state.pointerFrame ? 1 : 0,
      pointerConsumerCount: state.pointerConsumers.length,
      pointerConsumerErrors: state.pointerConsumerErrors,
      modes: {
        supported: state.mode.supported,
        fallback: !state.mode.supported,
        reducedMotion: state.mode.reducedMotion,
        eco: state.mode.eco
      },
      testRoleApplied: state.testRole,
      accountRole: state.testRole || 'user'
    };
  }

  function refresh(reason, silent) {
    deriveOptics();
    tagTargets();
    applyMode();
    notifyPointerConsumers(null, reason || 'refresh');
    return silent ? null : getDebug();
  }

  function setTestMode(options) {
    options = options && typeof options === 'object' ? options : {};
    ['supported', 'reducedMotion', 'eco'].forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(options, key)) return;
      state.overrides[key] = options[key] === null ? null : !!options[key];
    });
    return refresh();
  }

  function isTestEnvironment() {
    try {
      if (global.LF_MASTER_TEST === true || global.LF_MASTER_TEST === '1') return true;
      if (global.__LF_MASTER_TEST__ === true || global.__LF_MASTER_TEST__ === '1') return true;
      if (global.__LF_E2E__ || global.__lfP14E2E || global.__lfP14Harness) return true;
      if (global.navigator && global.navigator.webdriver) return true;
      if (root.hasAttribute('data-lf-e2e')) return true;
      if (global.location && /(?:^|[?&])(?:lfMasterTest|lfE2E)=1(?:&|$)/i.test(global.location.search || '')) return true;
      if (global.process && global.process.env && (
        String(global.process.env.LF_MASTER_TEST || '') === '1' ||
        String(global.process.env.LUMIFIELD_E2E_TEST || '') === '1'
      )) return true;
    } catch (_) {}
    return false;
  }

  function setTestRole(role) {
    if (!isTestEnvironment()) return { ok: false, error: 'E2E_ONLY' };
    var button = document.getElementById('lf-account-button');
    if (!button) return { ok: false, error: 'ACCOUNT_BUTTON_NOT_FOUND' };
    var value = String(role || '').toLowerCase();
    if (!button.hasAttribute('data-lf-test-original-text')) {
      button.setAttribute('data-lf-test-original-text', button.textContent || '我的');
    }
    if (value === 'admin') {
      button.textContent = '我的 · LumiField 管理员';
      state.testRole = 'admin';
    } else if (value === 'user' || value === 'normal') {
      button.textContent = '我的';
      state.testRole = 'user';
    } else if (value === 'restore' || value === '') {
      button.textContent = button.getAttribute('data-lf-test-original-text') || '我的';
      button.removeAttribute('data-lf-test-original-text');
      state.testRole = '';
    } else {
      return { ok: false, error: 'INVALID_ROLE' };
    }
    button.setAttribute('data-lf-test-role', state.testRole || 'restored');
    refresh();
    return { ok: true, role: state.testRole, text: button.textContent, debug: getDebug() };
  }

  function normalizeRgb(value) {
    if (value == null || value === '') return '';
    var parts = String(value).split(',').map(function (part) { return Number(part.trim()); });
    if (parts.length !== 3 || parts.some(function (part) {
      return !Number.isFinite(part) || part < 0 || part > 255;
    })) return '';
    return parts.map(function (part) { return Math.round(part); }).join(',');
  }

  function rememberTheme() {
    if (state.originalTheme) return;
    state.originalTheme = {};
    ['--lf-liquid-accent-rgb', '--lf-liquid-wallpaper-rgb', '--lf-lg-accent-rgb', '--lf-lg-wallpaper-rgb', '--lf-lg-wallpaper-luma'].forEach(function (name) {
      state.originalTheme[name] = root.style.getPropertyValue(name);
    });
  }

  function restoreTheme() {
    if (!state.originalTheme) return;
    Object.keys(state.originalTheme).forEach(function (name) {
      var value = state.originalTheme[name];
      if (value) root.style.setProperty(name, value);
      else root.style.removeProperty(name);
    });
    state.originalTheme = null;
    state.testTheme = null;
  }

  function setTestTheme(theme) {
    if (!isTestEnvironment()) return { ok: false, error: 'E2E_ONLY' };
    if (!theme || theme.restore === true) {
      restoreTheme();
      return { ok: true, restored: true, debug: refresh() };
    }
    if (typeof theme !== 'object') return { ok: false, error: 'INVALID_THEME' };

    rememberTheme();
    var accentRgb = normalizeRgb(theme.accentRgb);
    var wallpaperRgb = normalizeRgb(theme.wallpaperRgb);
    if (Object.prototype.hasOwnProperty.call(theme, 'accentRgb') && !accentRgb) {
      return { ok: false, error: 'INVALID_ACCENT_RGB' };
    }
    if (Object.prototype.hasOwnProperty.call(theme, 'wallpaperRgb') && !wallpaperRgb) {
      return { ok: false, error: 'INVALID_WALLPAPER_RGB' };
    }
    if (accentRgb) {
      root.style.setProperty('--lf-liquid-accent-rgb', accentRgb);
      root.style.setProperty('--lf-lg-accent-rgb', accentRgb);
    }
    if (wallpaperRgb) {
      root.style.setProperty('--lf-liquid-wallpaper-rgb', wallpaperRgb);
      root.style.setProperty('--lf-lg-wallpaper-rgb', wallpaperRgb);
    }
    if (Object.prototype.hasOwnProperty.call(theme, 'wallpaperLuma')) {
      var luma = Number(theme.wallpaperLuma);
      if (!Number.isFinite(luma)) return { ok: false, error: 'INVALID_WALLPAPER_LUMA' };
      root.style.setProperty('--lf-lg-wallpaper-luma', String(Math.max(0, Math.min(1, luma))));
    }
    state.testTheme = {
      accentRgb: accentRgb || readVariable('--lf-liquid-accent-rgb', ''),
      wallpaperRgb: wallpaperRgb || readVariable('--lf-liquid-wallpaper-rgb', ''),
      wallpaperLuma: Number(readVariable('--lf-lg-wallpaper-luma', '.42')) || 0
    };
    deriveOptics();
    scheduleRefresh();
    return { ok: true, theme: state.testTheme };
  }

  function scheduleRefresh() {
    if (state.refreshFrame) return;
    state.refreshFrame = frame(function () {
      state.refreshFrame = 0;
      refresh('observer', true);
    });
  }

  function observeDynamicTargets() {
    if (!global.MutationObserver || !document.body) return;
    state.observer = new global.MutationObserver(function (records) {
      var relevant = records.some(function (record) {
        if (record.type === 'childList') {
          return Array.prototype.some.call(record.addedNodes, nodeAffectsTargets) ||
            Array.prototype.some.call(record.removedNodes, nodeAffectsTargets);
        }
        return record.type === 'attributes' && (
          record.target === document.body ||
          (record.target === root && record.attributeName === 'style')
        );
      });
      if (relevant) scheduleRefresh();
    });
    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    });
    state.observer.observe(root, {
      attributes: true,
      attributeFilter: ['style']
    });
  }

  function init() {
    cancelFrame(state.refreshFrame);
    state.refreshFrame = 0;
    if (!state.listenerCount) {
      document.addEventListener('pointermove', onPointerMove, { passive: true });
      document.addEventListener('pointerleave', onPointerLeave, { passive: true });
      global.addEventListener('blur', onPointerLeave);
      document.addEventListener('visibilitychange', refresh);
      state.listenerCount = 4;
    }
    refresh();
    observeDynamicTargets();
    try {
      document.dispatchEvent(new global.CustomEvent('lumifield-liquid-glass-ready', {
        detail: getDebug()
      }));
    } catch (_) {}
  }

  global.LumiFieldLiquidGlass = Object.freeze({
    getDebug: getDebug,
    refresh: refresh,
    addPointerConsumer: addPointerConsumer,
    removePointerConsumer: removePointerConsumer,
    setTestMode: setTestMode,
    setTestRole: setTestRole,
    setTestTheme: setTestTheme
  });

  init();
})(window);
