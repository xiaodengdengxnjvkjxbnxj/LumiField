(function (global) {
  'use strict';
  if (global.__lumifieldHomePetInstalled) return;
  global.__lumifieldHomePetInstalled = true;

  var PET1 = 'shader-svg';
  var PET2 = 'electronic-pet-2';
  var PET1_ASPECT = 289 / 231;
  var PET2_ASPECT = 1;
  var MOTION_SAFE_TOP = 8;
  var STORAGE_PREFIX = 'lumifield-electronic-pet-v2:';
  var HEX_COLOR = /^#[0-9a-f]{6}$/i;
  var DEFAULT_SETTINGS = Object.freeze({
    engine:PET1,
    avatarId:'strobi',
    behaviorMode:'animation',
    animation:'idle',
    expression:'neutral',
    blinking:true,
    ambientMovement:true,
    bodyColor:'#5b7fe5',
    eyesColor:'#111316'
  });
  var ANIMATION_LABELS = {
    sleeping:'睡眠', waking:'唤醒', idle:'待机', listening:'倾听', thinking:'思考', searching:'搜索',
    working:'工作', excited:'兴奋', bored:'无聊', suspicious:'怀疑', angry:'生气', drowsy:'困倦',
    happy:'开心', curious:'好奇', confused:'困惑', surprised:'惊讶', proud:'自豪', shy:'害羞',
    sad:'难过', laughing:'大笑', scared:'害怕', playful:'调皮', celebrate:'庆祝'
  };
  var EXPRESSION_LABELS = {
    neutral:'自然', 'upward-side-glance':'侧向上望', 'downward-gaze':'低头注视',
    'skeptical-right':'右侧怀疑', 'small-attentive':'专注', 'wide-downward-gaze':'睁眼低望',
    'surprised-left':'左侧惊讶', 'sleepy-squint':'困倦眯眼', 'angry-right':'右侧生气',
    'curious-left':'左侧好奇', 'asymmetric-down-right':'右下不对称', 'attentive-left':'左侧专注',
    'joyful-wide':'开怀', 'eyes-closed':'闭眼', 'joyful-down-right':'右下开心',
    'skeptical-left':'左侧怀疑', 'far-right-glance':'远望右侧', 'angry-left':'左侧生气',
    'playful-right':'右侧调皮', 'asymmetric-up-left':'左上不对称', 'gentle-downward-gaze':'温和低望',
    'wide-down-left':'睁眼左下', 'surprised-wide-left':'睁眼惊讶', 'drowsy-closed':'困倦闭眼',
    'suspicious-right':'右侧警觉', 'shy-downward':'害羞低望', 'angry-brows':'皱眉', 'uneasy-left':'左侧不安'
  };
  var state = {
    root:null,
    host:null,
    api:null,
    engine:'',
    settings:null,
    scopeKey:'',
    resizeBound:false,
    disposed:false,
    mounts:0,
    unmounts:0,
    layouts:0,
    switches:0,
    switchSerial:0,
    pending:null,
    settingsObserver:null,
    listenersBound:false,
    lastReason:'init',
    lastError:''
  };

  function visible(element) {
    if (!element) return false;
    var rect = element.getBoundingClientRect();
    var style = global.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
      style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.02;
  }
  function blockingModalVisible() {
    return Array.prototype.some.call(document.querySelectorAll(
      '.modal-mask.show,#lf-profile-modal.show,#lf-account-manager.show,#lf-legal-modal.show'
    ), visible);
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
    return !!document.hidden || !!(body && (body.classList.contains('render-deep-sleep') ||
      body.classList.contains('render-background-eco'))) ||
      !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function sourceApi(engine) {
    var api = engine === PET2 ? global.LumiFieldPet2Runtime : global.LumiFieldHomePetSource;
    return api && typeof api.mount === 'function' && typeof api.unmount === 'function' ? api : null;
  }
  function pet2Capabilities() {
    var api = sourceApi(PET2);
    return api && typeof api.getCapabilities === 'function' ? api.getCapabilities() : {
      avatars:[], animations:[], expressions:[]
    };
  }
  function accountId() {
    try {
      var user = global.LFAuth && typeof global.LFAuth.getUser === 'function' ? global.LFAuth.getUser() : null;
      return String(user && (user.id || user.userId || user.email) || 'local');
    } catch (_) { return 'local'; }
  }
  function storageKey() {
    return STORAGE_PREFIX + encodeURIComponent(accountId()).slice(0, 256);
  }
  function normalizeSettings(input) {
    input = Object.assign({}, DEFAULT_SETTINGS, input || {});
    var capabilities = pet2Capabilities();
    var avatars = capabilities.avatars || [];
    var animations = (capabilities.animations || []).map(function (item) { return item.key; });
    var expressions = (capabilities.expressions || []).map(function (item) { return item.key; });
    var avatar = avatars.find(function (item) { return item.id === input.avatarId; }) || avatars[0] || {
      id:DEFAULT_SETTINGS.avatarId, bodyColor:DEFAULT_SETTINGS.bodyColor, eyesColor:DEFAULT_SETTINGS.eyesColor
    };
    return {
      engine:input.engine === PET2 ? PET2 : PET1,
      avatarId:String(avatar.id || DEFAULT_SETTINGS.avatarId),
      behaviorMode:input.behaviorMode === 'expression' ? 'expression' : 'animation',
      animation:animations.indexOf(input.animation) >= 0 ? input.animation : DEFAULT_SETTINGS.animation,
      expression:expressions.indexOf(input.expression) >= 0 ? input.expression : DEFAULT_SETTINGS.expression,
      blinking:input.blinking !== false,
      ambientMovement:input.ambientMovement !== false,
      bodyColor:HEX_COLOR.test(String(input.bodyColor || '')) ? String(input.bodyColor).toLowerCase() : String(avatar.bodyColor || DEFAULT_SETTINGS.bodyColor).toLowerCase(),
      eyesColor:HEX_COLOR.test(String(input.eyesColor || '')) ? String(input.eyesColor).toLowerCase() : String(avatar.eyesColor || DEFAULT_SETTINGS.eyesColor).toLowerCase()
    };
  }
  function readSettings() {
    state.scopeKey = storageKey();
    try { return normalizeSettings(JSON.parse(global.localStorage.getItem(state.scopeKey) || 'null')); }
    catch (_) { return normalizeSettings(null); }
  }
  function persistSettings(settings) {
    state.scopeKey = storageKey();
    try {
      global.localStorage.setItem(state.scopeKey, JSON.stringify(settings));
      return true;
    } catch (_) { return false; }
  }
  function createRoot() {
    var root = document.createElement('div');
    root.id = 'lf-home-pet';
    root.className = 'lf-home-pet';
    root.setAttribute('aria-hidden', 'true');
    root.setAttribute('data-source-adaptation', '21st-reuno-ui-shader-svg');
    return root;
  }
  function createEngineHost(engine) {
    var host = document.createElement('div');
    host.className = 'lf-home-pet-runtime-host';
    host.setAttribute('data-pet-engine', engine);
    host.style.visibility = 'hidden';
    host.style.opacity = '0';
    return host;
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
  function activeAspect(engine) {
    return engine === PET2 ? PET2_ASPECT : PET1_ASPECT;
  }
  function layout() {
    if (!state.root) return false;
    var home = rectOf('#empty-home');
    var search = rectOf('#search-area');
    var top = Math.max(8, Math.min(14, global.innerHeight * 0.018));
    var left = Math.max(28, Math.min(52, global.innerWidth * 0.034));
    var desired = Math.max(54, Math.min(64, global.innerWidth * 0.052));
    var aspect = activeAspect(state.engine || state.settings.engine);
    var maxByHome = home ? (home.top - top - 4 - MOTION_SAFE_TOP - 2) / (aspect * 1.08) : desired;
    var maxBySearch = search ? (search.left - left - 20) / 2 : desired;
    var width = Math.floor(Math.min(desired, maxByHome, maxBySearch));
    var visualHeight = width * aspect;
    var safeBottom = Math.ceil(visualHeight * 0.08 + 2);
    var rootHeight = MOTION_SAFE_TOP + visualHeight + safeBottom;
    var candidate = { left:left, top:top, right:left + width, bottom:top + rootHeight };
    var usable = width >= 50 && !blockerRects().some(function (entry) { return rectanglesOverlap(candidate, entry.rect); });
    if (!usable) {
      width = 50;
      visualHeight = width * aspect;
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
    if (state.api && state.host && typeof state.api.setPaused === 'function') state.api.setPaused(state.host, paused);
  }
  function mountHost(host, engine, settings) {
    var api = sourceApi(engine);
    if (!api || !api.mount(host, { paused:powerPaused(), settings:settings })) return null;
    return api;
  }
  function disposeHost(host, api) {
    if (!host) return;
    if (api && typeof api.unmount === 'function') api.unmount(host);
    if (host.parentNode) host.parentNode.removeChild(host);
  }
  function hostReady(host, engine) {
    if (!host) return false;
    return engine === PET2
      ? !!host.querySelector('svg[viewBox="-150 -150 300 300"]')
      : !!host.querySelector('svg[viewBox="0 0 231 289"],canvas');
  }
  function mount(reason) {
    if (state.disposed || state.root || !shouldMount()) return false;
    var engine = state.settings.engine;
    var root = createRoot();
    var host = createEngineHost(engine);
    root.appendChild(host);
    var api = mountHost(host, engine, state.settings);
    if (!api) {
      state.lastError = engine === PET2 ? 'PET2_RUNTIME_MOUNT_FAILED' : 'SHADER_SVG_RUNTIME_MOUNT_FAILED';
      return false;
    }
    state.root = root;
    state.host = host;
    state.api = api;
    state.engine = engine;
    root.setAttribute('data-pet-engine', engine);
    root.setAttribute('data-source-adaptation', engine === PET2
      ? 'bible-strong-avatar-web-0.1.0-source-175691a'
      : '21st-reuno-ui-shader-svg');
    (document.getElementById('desktop-window-shell') || document.body).appendChild(root);
    host.style.visibility = 'visible';
    host.style.opacity = '1';
    if (!state.resizeBound) {
      global.addEventListener('resize', layout, { passive:true });
      state.resizeBound = true;
    }
    state.mounts += 1;
    state.lastReason = String(reason || 'mount');
    state.lastError = '';
    layout();
    updatePowerState();
    return true;
  }
  function cancelPending(reason) {
    state.switchSerial += 1;
    if (!state.pending) return;
    disposeHost(state.pending.host, state.pending.api);
    state.pending = null;
    state.lastReason = String(reason || 'switch-cancel');
  }
  function unmount(reason) {
    cancelPending('unmount-pending');
    disposeHost(state.host, state.api);
    if (state.resizeBound) global.removeEventListener('resize', layout);
    state.resizeBound = false;
    if (state.root && state.root.parentNode) state.root.parentNode.removeChild(state.root);
    if (state.root) state.unmounts += 1;
    state.root = null;
    state.host = null;
    state.api = null;
    state.engine = '';
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
  function nextFrame() {
    return new Promise(function (resolve) { global.requestAnimationFrame(function () { resolve(); }); });
  }
  async function switchRuntime(input, reason, shouldPersist) {
    var next = normalizeSettings(input);
    var previous = state.settings;
    if (!state.root) {
      state.settings = next;
      if (shouldPersist !== false) persistSettings(next);
      updateSettingsUi();
      sync(reason || 'settings-unmounted');
      return true;
    }
    if (state.engine === next.engine && state.api && typeof state.api.configure === 'function') {
      var configured = state.api.configure(state.host, next);
      if (configured && configured.ok) {
        state.settings = next;
        if (shouldPersist !== false) persistSettings(next);
        state.lastReason = String(reason || 'configure');
        state.lastError = '';
        updateSettingsUi();
        return true;
      }
      if (!configured || configured.requiresRemount !== true) {
        state.lastError = configured && configured.error || 'PET_RUNTIME_CONFIGURE_FAILED';
        updateSettingsUi();
        return false;
      }
    } else if (state.engine === next.engine && JSON.stringify(previous) === JSON.stringify(next)) {
      return true;
    }

    cancelPending('replace-pending');
    var serial = ++state.switchSerial;
    var nextHost = createEngineHost(next.engine);
    state.root.appendChild(nextHost);
    var nextApi = mountHost(nextHost, next.engine, next);
    if (!nextApi) {
      nextHost.remove();
      state.lastError = next.engine === PET2 ? 'PET2_RUNTIME_MOUNT_FAILED' : 'SHADER_SVG_RUNTIME_MOUNT_FAILED';
      updateSettingsUi();
      return false;
    }
    state.pending = { host:nextHost, api:nextApi, engine:next.engine, serial:serial };
    for (var frame = 0; frame < 4 && !hostReady(nextHost, next.engine); frame += 1) await nextFrame();
    if (state.disposed || serial !== state.switchSerial || !state.pending) {
      disposeHost(nextHost, nextApi);
      return false;
    }
    if (!hostReady(nextHost, next.engine)) {
      disposeHost(nextHost, nextApi);
      state.pending = null;
      state.lastError = 'PET_RUNTIME_NOT_READY';
      updateSettingsUi();
      return false;
    }
    var oldHost = state.host;
    var oldApi = state.api;
    nextHost.style.visibility = 'visible';
    nextHost.style.opacity = '1';
    if (oldHost) {
      oldHost.style.visibility = 'hidden';
      oldHost.style.opacity = '0';
    }
    state.host = nextHost;
    state.api = nextApi;
    state.engine = next.engine;
    state.settings = next;
    state.pending = null;
    state.root.setAttribute('data-pet-engine', next.engine);
    state.root.setAttribute('data-source-adaptation', next.engine === PET2
      ? 'bible-strong-avatar-web-0.1.0'
      : '21st-reuno-ui-shader-svg');
    layout();
    disposeHost(oldHost, oldApi);
    state.switches += 1;
    state.lastReason = String(reason || 'runtime-switch');
    state.lastError = '';
    if (shouldPersist !== false) persistSettings(next);
    updatePowerState();
    updateSettingsUi();
    return true;
  }
  function optionHtml(items, labels) {
    return items.map(function (item) {
      var key = String(item.key || item.id || '');
      var label = labels[key] || item.name || item.label || key;
      return '<option value="' + escapeHtml(key) + '">' + escapeHtml(label) + ' · ' + escapeHtml(key) + '</option>';
    }).join('');
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character];
    });
  }
  function settingsAnchor() {
    var presetsPage = document.querySelector('#fx-panel .fx-tab-page[data-fx-page="presets"]');
    var echo = presetsPage && presetsPage.querySelector('#lf-t13-echo-block');
    return echo && echo.parentNode ? echo : null;
  }
  function ensureSettings() {
    var existing = document.getElementById('lf-electronic-pet-settings');
    var anchor = settingsAnchor();
    if (!anchor) {
      if (existing && existing.closest('#lf-profile-modal')) existing.remove();
      return null;
    }
    if (existing) {
      if (existing.parentNode !== anchor.parentNode || existing.previousElementSibling !== anchor) {
        anchor.insertAdjacentElement('afterend', existing);
      }
      updateSettingsUi();
      return existing;
    }
    var capabilities = pet2Capabilities();
    var root = document.createElement('div');
    root.id = 'lf-electronic-pet-settings';
    root.className = 'lf-electronic-pet-settings';
    root.innerHTML =
      '<div class="lf-pet-settings-head"><div><b>电子宠物</b><span>Home 左上角共用槽位</span></div>' +
        '<div class="lf-pet-engine-switch" role="radiogroup" aria-label="电子宠物类型">' +
          '<button type="button" role="radio" data-lf-pet-engine="' + PET1 + '">Shader SVG</button>' +
          '<button type="button" role="radio" data-lf-pet-engine="' + PET2 + '">电子宠物 2</button>' +
        '</div></div>' +
      '<div class="lf-pet2-controls" data-lf-pet2-controls>' +
        '<label><span>Avatar</span><select data-lf-pet-field="avatarId">' + optionHtml(capabilities.avatars || [], {}) + '</select></label>' +
        '<label><span>展示方式</span><select data-lf-pet-field="behaviorMode"><option value="animation">动画</option><option value="expression">表情</option></select></label>' +
        '<label data-lf-pet-animation-row><span>Animation</span><select data-lf-pet-field="animation">' + optionHtml(capabilities.animations || [], ANIMATION_LABELS) + '</select></label>' +
        '<label data-lf-pet-expression-row><span>Expression</span><select data-lf-pet-field="expression">' + optionHtml(capabilities.expressions || [], EXPRESSION_LABELS) + '</select></label>' +
        '<label class="lf-pet-color"><span>身体颜色</span><input type="color" data-lf-pet-field="bodyColor" aria-label="电子宠物 2 身体颜色"></label>' +
        '<label class="lf-pet-color"><span>眼睛颜色</span><input type="color" data-lf-pet-field="eyesColor" aria-label="电子宠物 2 眼睛颜色"></label>' +
        '<label class="lf-pet-check"><input type="checkbox" data-lf-pet-field="blinking"><span>自动眨眼</span></label>' +
        '<label class="lf-pet-check"><input type="checkbox" data-lf-pet-field="ambientMovement"><span>环境运动</span></label>' +
        '<button class="lf-pet-reset" type="button" data-lf-pet-reset>恢复 Pet 2 默认值</button>' +
      '</div>' +
      '<div class="lf-pet-license"><span>本地 Runtime · AGPL-3.0-only · 无 iframe</span><a href="https://github.com/smontlouis/bible-strong-avatar-lab/tree/175691ab32cefe5faec7828af62f3d50210a8eb2" target="_blank" rel="noopener noreferrer">对应源码</a></div>' +
      '<div class="lf-pet-settings-status" role="status" aria-live="polite"></div>';
    anchor.insertAdjacentElement('afterend', root);
    root.addEventListener('click', handleSettingsClick);
    root.addEventListener('change', handleSettingsChange);
    updateSettingsUi();
    return root;
  }
  function updateSettingsUi() {
    var root = document.getElementById('lf-electronic-pet-settings');
    if (!root || !state.settings) return;
    root.querySelectorAll('[data-lf-pet-engine]').forEach(function (button) {
      var selected = button.getAttribute('data-lf-pet-engine') === state.settings.engine;
      button.setAttribute('aria-checked', String(selected));
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('active', selected);
    });
    var controls = root.querySelector('[data-lf-pet2-controls]');
    if (controls) controls.hidden = state.settings.engine !== PET2;
    root.querySelectorAll('[data-lf-pet-field]').forEach(function (field) {
      var key = field.getAttribute('data-lf-pet-field');
      if (field.type === 'checkbox') field.checked = !!state.settings[key];
      else field.value = String(state.settings[key] == null ? '' : state.settings[key]);
    });
    var animationRow = root.querySelector('[data-lf-pet-animation-row]');
    var expressionRow = root.querySelector('[data-lf-pet-expression-row]');
    if (animationRow) animationRow.hidden = state.settings.behaviorMode !== 'animation';
    if (expressionRow) expressionRow.hidden = state.settings.behaviorMode !== 'expression';
    var status = root.querySelector('.lf-pet-settings-status');
    if (status) {
      status.textContent = state.lastError ? '切换未生效：' + state.lastError :
        (state.settings.engine === PET2 ? '电子宠物 2 设置已按当前 LF 账号保存。' : '当前使用 Shader SVG。');
      status.classList.toggle('error', !!state.lastError);
    }
  }
  function patchFromField(field) {
    var key = field.getAttribute('data-lf-pet-field');
    var patch = {};
    patch[key] = field.type === 'checkbox' ? field.checked : field.value;
    if (key === 'avatarId') {
      var avatar = (pet2Capabilities().avatars || []).find(function (item) { return item.id === field.value; });
      if (avatar) { patch.bodyColor = avatar.bodyColor; patch.eyesColor = avatar.eyesColor; }
    }
    return patch;
  }
  function handleSettingsChange(event) {
    var field = event.target && event.target.closest && event.target.closest('[data-lf-pet-field]');
    if (!field) return;
    switchRuntime(Object.assign({}, state.settings, patchFromField(field)), 'settings-change', true);
  }
  function handleSettingsClick(event) {
    var engine = event.target && event.target.closest && event.target.closest('[data-lf-pet-engine]');
    if (engine) {
      switchRuntime(Object.assign({}, state.settings, { engine:engine.getAttribute('data-lf-pet-engine') }), 'engine-select', true);
      return;
    }
    if (event.target && event.target.closest && event.target.closest('[data-lf-pet-reset]')) {
      var next = normalizeSettings(Object.assign({}, DEFAULT_SETTINGS, { engine:PET2 }));
      switchRuntime(next, 'pet2-reset', true);
    }
  }
  function observeSettingsHost() {
    if (state.settingsObserver || !document.body) return;
    state.settingsObserver = new MutationObserver(function () {
      var root = ensureSettings();
      if (root && state.settingsObserver) {
        state.settingsObserver.disconnect();
        state.settingsObserver = null;
      }
    });
    state.settingsObserver.observe(document.body, { childList:true, subtree:true });
    ensureSettings();
  }
  function handleAccountChange() {
    var next = readSettings();
    switchRuntime(next, 'account-scope-change', false).then(function () { sync('account-scope-change'); });
    observeSettingsHost();
  }
  function bindLifecycle() {
    if (state.listenersBound) return;
    state.listenersBound = true;
    document.addEventListener('visibilitychange', updatePowerState);
    document.addEventListener('lumifield-auth-user-change', handleAccountChange);
  }
  function dispose() {
    unmount('dispose');
    if (state.settingsObserver) state.settingsObserver.disconnect();
    state.settingsObserver = null;
    if (state.listenersBound) {
      document.removeEventListener('visibilitychange', updatePowerState);
      document.removeEventListener('lumifield-auth-user-change', handleAccountChange);
    }
    state.listenersBound = false;
    state.disposed = true;
  }
  function getDebug() {
    var root = state.root;
    var rect = root ? root.getBoundingClientRect() : null;
    var home = rectOf('#empty-home');
    var search = rectOf('#search-area');
    var petRect = rect ? { left:rect.left, top:rect.top, right:rect.right, bottom:rect.bottom, width:rect.width, height:rect.height } : null;
    var svg = root ? root.querySelector('svg') : null;
    var greeting = root ? root.querySelector('.lf-home-pet-greeting') : null;
    var svgBounds = svg ? svg.getBoundingClientRect() : null;
    var greetingBounds = greeting ? greeting.getBoundingClientRect() : null;
    var visualWidth = root ? parseFloat(root.style.getPropertyValue('--lf-home-pet-visual-width')) || 0 : 0;
    var visualHeight = root ? parseFloat(root.style.getPropertyValue('--lf-home-pet-visual-height')) || 0 : 0;
    var blockers = blockerRects();
    var source = state.api && state.host && typeof state.api.getDebug === 'function' ? state.api.getDebug(state.host) : null;
    var paperHosts = root ? root.querySelectorAll('[data-paper-shader]').length : 0;
    var canvasCount = root ? root.querySelectorAll('canvas').length : 0;
    return {
      version:'3.0.0-dual-runtime',
      mounted:!!root,
      disposed:state.disposed,
      rootCount:document.querySelectorAll('#lf-home-pet').length,
      engineHostCount:root ? root.querySelectorAll('.lf-home-pet-runtime-host').length : 0,
      engine:state.engine || state.settings.engine,
      preferredEngine:state.settings.engine,
      settings:Object.assign({}, state.settings),
      scopeKey:state.scopeKey,
      pet2Available:!!sourceApi(PET2),
      svgCount:root ? root.querySelectorAll('svg').length : 0,
      shaderSvgCount:root ? root.querySelectorAll('svg[viewBox="0 0 231 289"]').length : 0,
      pet2SvgCount:root ? root.querySelectorAll('svg[viewBox="-150 -150 300 300"]').length : 0,
      canvasCount:canvasCount,
      webglContextCount:paperHosts,
      paperShaderHostCount:paperHosts,
      pointerEvents:root ? global.getComputedStyle(root).pointerEvents : '',
      eyeX:source && Number(source.eyeX) || 0,
      eyeY:source && Number(source.eyeY) || 0,
      eyeLimitX:8,
      eyeLimitY:8,
      trackingRadiusX:source && Number(source.trackingRadiusX) || 0,
      trackingRadiusY:source && Number(source.trackingRadiusY) || 0,
      trackingMapping:source && source.mapping || '',
      hovered:!!(source && source.hovered),
      greeting:source && source.greeting || '',
      greetingCount:root ? root.querySelectorAll('.lf-home-pet-greeting').length : 0,
      greetingVisible:!!(greeting && greeting.getAttribute('data-visible') === 'true'),
      greetingBounds:greetingBounds ? { left:greetingBounds.left, top:greetingBounds.top, right:greetingBounds.right, bottom:greetingBounds.bottom, width:greetingBounds.width, height:greetingBounds.height } : null,
      rect:petRect,
      visualWidth:visualWidth,
      visualHeight:visualHeight,
      sourceAspect:activeAspect(state.engine || state.settings.engine),
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
      switches:state.switches,
      layouts:state.layouts,
      pendingSwitch:!!state.pending,
      pointerConsumerCount:0,
      mouseMoveListenerCount:source && Number(source.listenerCount) || 0,
      pointerFrames:source && Number(source.pointerFrames) || 0,
      resizeListenerCount:state.resizeBound ? 1 : 0,
      source:source,
      lastReason:state.lastReason,
      lastError:state.lastError,
      settingsMounted:!!document.getElementById('lf-electronic-pet-settings')
    };
  }

  state.settings = readSettings();
  bindLifecycle();
  observeSettingsHost();
  global.LumiFieldHomePet = Object.freeze({
    sync:sync,
    layout:layout,
    getDebug:getDebug,
    getSettings:function () { return Object.assign({}, state.settings); },
    updateSettings:function (patch) { return switchRuntime(Object.assign({}, state.settings, patch || {}), 'api-settings', true); },
    selectEngine:function (engine) { return switchRuntime(Object.assign({}, state.settings, { engine:engine }), 'api-engine', true); },
    ensureSettings:ensureSettings,
    dispose:dispose
  });
  global.__lumifieldHomePetDebug = getDebug;
  sync('install');
})(window);
