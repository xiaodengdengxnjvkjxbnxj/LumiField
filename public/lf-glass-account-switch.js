(function (global) {
  'use strict';

  var KEYS = ['netease', 'qq', 'kugou', 'kugou_concept', 'qishui', 'both'];
  var PROVIDERS = KEYS.slice(0, 5);
  var state = {
    syncCount: 0,
    selectedKey: 'netease',
    selectedIndex: 0,
    lastReason: 'module-init',
    keyboardListenerCount: 0
  };
  var keyboardGroup = null;
  var keyboardHandler = null;

  function groupElement() {
    return global.document && global.document.getElementById('user-platform-tabs');
  }

  function keyForButton(button) {
    var id = String(button && button.id || '');
    return id.indexOf('user-provider-') === 0 ? id.slice('user-provider-'.length) : '';
  }

  function normalizeProvider(value) {
    value = String(value || '').toLowerCase();
    return PROVIDERS.indexOf(value) >= 0 ? value : 'netease';
  }

  function hasValidatedSession(provider) {
    if (typeof global.platformStatus !== 'function') return false;
    var status = global.platformStatus(provider);
    return !!(status && status.loggedIn === true && status.sessionValid === true &&
      status.stale !== true && status.ok !== false && !status.error);
  }

  function rectOf(element) {
    if (!element || typeof element.getBoundingClientRect !== 'function') return null;
    var rect = element.getBoundingClientRect();
    function value(number) { return Number(Number(number || 0).toFixed(3)); }
    return {
      x: value(rect.x), y: value(rect.y), left: value(rect.left), top: value(rect.top),
      right: value(rect.right), bottom: value(rect.bottom), width: value(rect.width), height: value(rect.height)
    };
  }

  function removeKeyboard() {
    if (keyboardGroup && keyboardHandler) keyboardGroup.removeEventListener('keydown', keyboardHandler);
    if (keyboardGroup) delete keyboardGroup.dataset.lfAccountKeyboardBound;
    keyboardGroup = null;
    keyboardHandler = null;
    state.keyboardListenerCount = 0;
  }

  function installKeyboard(group) {
    if (!group || (keyboardGroup === group && keyboardHandler)) return;
    removeKeyboard();
    keyboardGroup = group;
    keyboardHandler = function (event) {
      var key = event && event.key;
      if (key === ' ' || key === 'Enter') {
        var targetButton = event.target && typeof event.target.closest === 'function' ? event.target.closest('button') : null;
        if (!targetButton || !group.contains(targetButton) || targetButton.disabled) return;
        event.preventDefault();
        targetButton.click();
        return;
      }
      var delta = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : (key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0);
      if (!delta && key !== 'Home' && key !== 'End') return;
      var buttons = Array.prototype.slice.call(group.querySelectorAll('button:not(:disabled)'));
      if (!buttons.length) return;
      var current = Math.max(0, buttons.indexOf(global.document.activeElement));
      var next = key === 'Home' ? 0 : (key === 'End' ? buttons.length - 1 : (current + delta + buttons.length) % buttons.length);
      event.preventDefault();
      buttons[next].focus();
      buttons[next].click();
    };
    group.dataset.lfAccountKeyboardBound = '1';
    group.addEventListener('keydown', keyboardHandler);
    state.keyboardListenerCount = 1;
  }

  function sync(activeProvider, multiProviderMode, reason) {
    var group = groupElement();
    var active = normalizeProvider(activeProvider == null ? global.activeAccountProvider : activeProvider);
    var multi = multiProviderMode == null ? global.multiProviderMode === true : multiProviderMode === true;
    var selectedKey = multi ? 'both' : (hasValidatedSession(active) ? active : '');
    var selectedIndex = KEYS.indexOf(selectedKey);
    var focusKey = selectedKey || active;
    if (!group) {
      removeKeyboard();
      state.syncCount += 1;
      state.selectedKey = selectedKey;
      state.selectedIndex = selectedIndex;
      state.lastReason = String(reason || 'sync');
      return getDebug();
    }

    var revealWithoutTravel = group.dataset.lfAccountSelected === '' && selectedKey !== '';
    if (revealWithoutTravel) group.classList.add('lf-account-segment-snap');
    group.dataset.lfAccountSelected = selectedKey;
    group.style.setProperty('--lf-account-segment-index', String(selectedIndex));
    group.style.setProperty('--lf-account-segment-shift', String(Math.max(0, selectedIndex) * 100) + '%');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', '账户平台切换');

    Array.prototype.forEach.call(group.querySelectorAll('button'), function (button) {
      var selected = keyForButton(button) === selectedKey;
      button.classList.toggle('active', selected);
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', selected ? 'true' : 'false');
      button.removeAttribute('aria-pressed');
      button.tabIndex = keyForButton(button) === focusKey ? 0 : -1;
    });
    installKeyboard(group);
    if (revealWithoutTravel) {
      void group.offsetWidth;
      group.classList.remove('lf-account-segment-snap');
    }

    state.syncCount += 1;
    state.selectedKey = selectedKey;
    state.selectedIndex = selectedIndex;
    state.lastReason = String(reason || 'sync');
    return getDebug();
  }

  function refresh(reason) {
    return sync(global.activeAccountProvider, global.multiProviderMode, reason || 'refresh');
  }

  function dispose() {
    removeKeyboard();
    state.lastReason = 'dispose';
    return getDebug();
  }

  function getDebug() {
    var group = groupElement();
    var buttons = group ? Array.prototype.slice.call(group.querySelectorAll('button')) : [];
    var glider = group && group.querySelector('.lf-account-segment-glider');
    var style = glider && global.getComputedStyle ? global.getComputedStyle(glider) : null;
    var reducedMotion = false;
    try {
      reducedMotion = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (_) {}
    reducedMotion = reducedMotion || !!(global.document && global.document.documentElement.classList.contains('lf-liquid-glass-reduced'));
    return {
      version: 1,
      installed: !!(group && glider),
      selectedKey: group && group.dataset.lfAccountSelected || state.selectedKey,
      selectedIndex: Number(group && group.style.getPropertyValue('--lf-account-segment-index') || state.selectedIndex),
      segmentCount: buttons.length,
      platformSegmentCount: buttons.filter(function (button) { return PROVIDERS.indexOf(keyForButton(button)) >= 0; }).length,
      gliderCount: group ? group.querySelectorAll('.lf-account-segment-glider').length : 0,
      activeIds: buttons.filter(function (button) { return button.classList.contains('active'); }).map(function (button) { return button.id; }),
      checkedIds: buttons.filter(function (button) { return button.getAttribute('aria-checked') === 'true'; }).map(function (button) { return button.id; }),
      styleIndex: group ? group.style.getPropertyValue('--lf-account-segment-index').trim() : '',
      styleShift: group ? group.style.getPropertyValue('--lf-account-segment-shift').trim() : '',
      syncCount: state.syncCount,
      lastReason: state.lastReason,
      keyboardListenerCount: state.keyboardListenerCount,
      reducedMotion: reducedMotion,
      transitionDuration: style ? style.transitionDuration : '',
      gliderPointerEvents: style ? style.pointerEvents : '',
      containerRect: rectOf(group),
      gliderRect: rectOf(glider),
      buttonRects: buttons.map(function (button) { return { id: button.id, key: keyForButton(button), rect: rectOf(button) }; })
    };
  }

  global.LumiFieldGlassAccountSwitch = {
    version: 1,
    sync: sync,
    refresh: refresh,
    dispose: dispose,
    getDebug: getDebug
  };
  global.__lumifieldGlassAccountSwitchDebug = getDebug;
  refresh('module-init');
})(window);
