/* LumiField independent implementation; no Python-island/eIsland source code is copied here. */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';
  var STORE_PREFIX = 'lumifield-voice-assistant-v1:';
  var STORE_SCHEMA = 1;
  var WAKE_WINDOW_MS = 8000;
  var FINAL_DEDUP_MS = 1500;
  var WAKE_COOLDOWN_MS = 1500;
  var DEFAULTS = Object.freeze({
    enabled:false,
    voiceWake:true,
    songSync:true,
    topEdgeWake:true,
    wakeWord:'小艺，小艺',
    hotkey:'Alt+KeyP'
  });
  var state = {
    disposed:false,
    scope:'anonymous',
    scopeKey:'',
    settings:null,
    busy:false,
    scopeSwitching:false,
    switchSerial:0,
    operationSerial:0,
    wakeArmedUntil:0,
    micStatus:'unknown',
    serviceStatus:'disabled',
    syncStatus:'disabled',
    hotkeyStatus:'disabled',
    statusMessage:'语音助手已关闭',
    error:'',
    errors:{ settings:'', microphone:'', service:'', sync:'', hotkey:'', command:'', overlay:'' },
    boundAudio:null,
    audioUnbinders:[],
    commandUnsubscribe:null,
    statusUnsubscribe:null,
    playbackSerial:0,
    lastProgressSecond:-1,
    lastPlaybackSignature:'',
    lastCommand:null,
    lastTranscriptKey:'',
    lastTranscriptAt:0,
    lastWakeAt:0
  };

  function refreshError() {
    var order = ['settings','microphone','service','sync','hotkey','command','overlay'];
    state.error = order.map(function (key) { return state.errors[key] || ''; }).find(Boolean) || '';
  }
  function setError(source, message) {
    if (!Object.prototype.hasOwnProperty.call(state.errors, source)) source = 'settings';
    state.errors[source] = String(message || '');
    refreshError();
  }
  function clearError(source) {
    if (Object.prototype.hasOwnProperty.call(state.errors, source)) state.errors[source] = '';
    refreshError();
  }
  function clearErrors() {
    Object.keys(state.errors).forEach(function (key) { state.errors[key] = ''; });
    refreshError();
  }

  function bool(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
  }
  function normalizeWakeWord(value) {
    value = String(value == null ? '' : value);
    try { value = value.normalize('NFC'); } catch (_) {}
    value = value.trim().replace(/\s+/g, ' ');
    return value ? value.slice(0, 32) : DEFAULTS.wakeWord;
  }
  function nfkc(value) {
    value = String(value == null ? '' : value);
    try { return value.normalize('NFKC'); } catch (_) { return value; }
  }
  function normalizeHotkey(value) {
    var parts = String(value || '').split('+').map(function (item) { return item.trim(); }).filter(Boolean);
    var modifiers = [];
    var code = '';
    parts.forEach(function (part) {
      var lower = part.toLowerCase();
      if (lower === 'control' || lower === 'ctrl') { if (modifiers.indexOf('Ctrl') < 0) modifiers.push('Ctrl'); return; }
      if (lower === 'alt') { if (modifiers.indexOf('Alt') < 0) modifiers.push('Alt'); return; }
      if (lower === 'shift') { if (modifiers.indexOf('Shift') < 0) modifiers.push('Shift'); return; }
      if (lower === 'meta' || lower === 'super' || lower === 'win') { if (modifiers.indexOf('Meta') < 0) modifiers.push('Meta'); return; }
      if (!code) {
        if (/^[a-z]$/i.test(part)) code = 'Key' + part.toUpperCase();
        else if (/^[0-9]$/.test(part)) code = 'Digit' + part;
        else code = part;
      }
    });
    if (!code || !modifiers.length) return '';
    return modifiers.concat([code]).join('+');
  }
  function normalizeSettings(value) {
    value = value && typeof value === 'object' ? value : {};
    return {
      enabled:bool(value.enabled, DEFAULTS.enabled),
      voiceWake:bool(value.voiceWake, DEFAULTS.voiceWake),
      songSync:bool(value.songSync, DEFAULTS.songSync),
      topEdgeWake:bool(value.topEdgeWake, DEFAULTS.topEdgeWake),
      wakeWord:normalizeWakeWord(value.wakeWord),
      hotkey:Object.prototype.hasOwnProperty.call(value, 'hotkey') ? normalizeHotkey(value.hotkey) : DEFAULTS.hotkey
    };
  }
  function cloneSettings(value) {
    return normalizeSettings(Object.assign({}, value || {}));
  }
  function stableSettings(value) {
    value = normalizeSettings(value);
    return JSON.stringify({
      enabled:value.enabled,
      voiceWake:value.voiceWake,
      songSync:value.songSync,
      topEdgeWake:value.topEdgeWake,
      wakeWord:value.wakeWord,
      hotkey:value.hotkey
    });
  }
  function scopeToken(userId) {
    var text = String(userId || 'anonymous');
    var left = 2166136261;
    var right = 2246822519;
    for (var index = 0; index < text.length; index++) {
      var code = text.charCodeAt(index);
      left = Math.imul(left ^ code, 16777619);
      right = Math.imul(right ^ code, 3266489909);
    }
    return ('00000000' + (left >>> 0).toString(16)).slice(-8) + ('00000000' + (right >>> 0).toString(16)).slice(-8);
  }
  function keyForUser(userId) {
    return STORE_PREFIX + scopeToken(userId || 'anonymous');
  }
  function storagePayload(settings, scope) {
    return {
      schema:STORE_SCHEMA,
      scope:scope,
      updatedAt:Date.now(),
      settings:normalizeSettings(settings)
    };
  }
  function parseStored(raw, expectedScope) {
    if (!raw) return null;
    try {
      var payload = JSON.parse(raw);
      if (!payload || payload.schema !== STORE_SCHEMA || payload.scope !== expectedScope || !payload.settings) return null;
      return normalizeSettings(payload.settings);
    } catch (_) {
      return null;
    }
  }
  function readScopedSettings(scopeKey) {
    try {
      return parseStored(localStorage.getItem(scopeKey), scopeKey) || cloneSettings(DEFAULTS);
    } catch (_) {
      return cloneSettings(DEFAULTS);
    }
  }
  function writeScopedSettings(settings, expectedKey) {
    var key = String(expectedKey || '');
    if (!key || key !== state.scopeKey) return false;
    var stageKey = key + ':staging';
    var previous = null;
    var raw = JSON.stringify(storagePayload(settings, key));
    try {
      previous = localStorage.getItem(key);
      localStorage.setItem(stageKey, raw);
      if (stableSettings(parseStored(localStorage.getItem(stageKey), key)) !== stableSettings(settings)) throw new Error('VOICE_SETTINGS_STAGE_VERIFY_FAILED');
      localStorage.setItem(key, raw);
      if (stableSettings(parseStored(localStorage.getItem(key), key)) !== stableSettings(settings)) throw new Error('VOICE_SETTINGS_COMMIT_VERIFY_FAILED');
      localStorage.removeItem(stageKey);
      return true;
    } catch (error) {
      try {
        if (previous == null) localStorage.removeItem(key);
        else localStorage.setItem(key, previous);
        localStorage.removeItem(stageKey);
      } catch (_) {}
      setError('settings', String(error && error.message || error || 'VOICE_SETTINGS_WRITE_FAILED'));
      return false;
    }
  }
  function desktopApi() {
    return global.desktopWindow || null;
  }
  function toast(message) {
    if (typeof global.showToast === 'function') global.showToast(message);
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char];
    });
  }
  function formatHotkey(value) {
    return String(value || '').split('+').map(function (part) {
      if (/^Key[A-Z]$/.test(part)) return part.slice(3);
      if (/^Digit[0-9]$/.test(part)) return part.slice(5);
      if (part === 'Meta') return 'Win';
      return part;
    }).join(' + ') || '未设置';
  }
  function statusText(kind) {
    var maps = {
      mic:{ unknown:'待授权', prompt:'待授权', granted:'已授权', denied:'未授权', unavailable:'不可用', checking:'请求中' },
      service:{ disabled:'已停止', starting:'启动中', listening:'正在监听', ready:'已就绪', error:'启动失败', unavailable:'不可用' },
      sync:{ disabled:'已停止', syncing:'同步中', ready:'已同步', error:'同步失败', unavailable:'不可用' },
      hotkey:{ disabled:'未注册', registering:'注册中', ready:'已注册', conflict:'被占用', error:'注册失败', unavailable:'不可用' }
    };
    var key = kind === 'mic' ? state.micStatus : kind === 'service' ? state.serviceStatus : kind === 'sync' ? state.syncStatus : state.hotkeyStatus;
    return maps[kind][key] || key;
  }
  function statusTone(kind) {
    var key = kind === 'mic' ? state.micStatus : kind === 'service' ? state.serviceStatus : kind === 'sync' ? state.syncStatus : state.hotkeyStatus;
    if (key === 'granted' || key === 'ready' || key === 'listening') return 'ok';
    if (key === 'error' || key === 'denied' || key === 'unavailable' || key === 'conflict') return 'error';
    return 'idle';
  }
  function serviceReasonText(reason) {
    reason = String(reason || '');
    var known = {
      WINDOWS_SYSTEM_SPEECH_REQUIRED:'当前 Windows 缺少 System.Speech 语音识别支持。',
      NO_RECOGNIZER:'Windows 未安装可用的语音识别器。',
      SPEECH_PROCESS_EXITED:'语音识别服务意外退出，请关闭后重新启用。',
      SPEECH_PROCESS_FAILED:'语音识别服务启动失败。'
    };
    return known[reason] || reason;
  }
  function ensurePage() {
    var page = document.querySelector('#fx-panel .fx-tab-page[data-fx-page="voice"]');
    if (!page || page.querySelector('#lf-voice-assistant')) return page;
    page.innerHTML =
      '<section id="lf-voice-assistant" class="lf-voice-assistant" aria-label="语音助手设置">' +
        '<div class="lf-va-intro"><div><b>AI 语音助手</b><span>仅控制 LumiField 的搜索与播放。</span></div><em id="lf-va-runtime-badge">已关闭</em></div>' +
        '<label class="lf-va-switch-row lf-va-master"><span><b>启用语音助手</b><small>关闭后释放麦克风、热键、悬浮窗与识别服务。</small></span><input id="lf-va-enabled" type="checkbox"><i aria-hidden="true"></i></label>' +
        '<div class="lf-va-section">' +
          '<label class="lf-va-switch-row"><span><b>语音唤醒</b><small>说出唤醒词后，仅接受搜索和播放指令。</small></span><input id="lf-va-voice-wake" type="checkbox"><i aria-hidden="true"></i></label>' +
          '<label class="lf-va-field"><span>唤醒词</span><input id="lf-va-wake-word" type="text" maxlength="32" autocomplete="off" spellcheck="false" value="小艺，小艺"></label>' +
        '</div>' +
        '<div class="lf-va-section">' +
          '<label class="lf-va-switch-row"><span><b>歌曲同步</b><small>只同步 LF 当前歌曲、队列、进度与播放状态。</small></span><input id="lf-va-song-sync" type="checkbox"><i aria-hidden="true"></i></label>' +
          '<label class="lf-va-switch-row"><span><b>顶边悬浮唤出</b><small>鼠标触达屏幕顶边时临时显示。</small></span><input id="lf-va-top-edge" type="checkbox"><i aria-hidden="true"></i></label>' +
        '</div>' +
        '<div class="lf-va-section lf-va-hotkey-section">' +
          '<div class="lf-va-label"><b>全局唤出热键</b><small>点击按键框后按下新的组合键。</small></div>' +
          '<div class="lf-va-hotkey-row"><input id="lf-va-hotkey" readonly aria-label="全局唤出热键"><button type="button" id="lf-va-hotkey-clear">清空</button><button type="button" id="lf-va-hotkey-default">默认</button></div>' +
        '</div>' +
        '<div class="lf-va-status-grid" aria-label="真实运行状态">' +
          '<div><span>麦克风</span><b id="lf-va-status-mic"></b></div>' +
          '<div><span>识别服务</span><b id="lf-va-status-service"></b></div>' +
          '<div><span>歌曲同步</span><b id="lf-va-status-sync"></b></div>' +
          '<div><span>全局热键</span><b id="lf-va-status-hotkey"></b></div>' +
        '</div>' +
        '<div id="lf-va-message" class="lf-va-message" role="status" aria-live="polite"></div>' +
      '</section>';
    bindPage(page);
    return page;
  }
  function setStatusNode(id, kind) {
    var node = document.getElementById(id);
    if (!node) return;
    node.textContent = statusText(kind);
    node.setAttribute('data-tone', statusTone(kind));
  }
  function render() {
    var page = ensurePage();
    if (!page || !state.settings) return;
    var settings = state.settings;
    var enabled = document.getElementById('lf-va-enabled');
    var voiceWake = document.getElementById('lf-va-voice-wake');
    var songSync = document.getElementById('lf-va-song-sync');
    var topEdge = document.getElementById('lf-va-top-edge');
    var wakeWord = document.getElementById('lf-va-wake-word');
    var hotkey = document.getElementById('lf-va-hotkey');
    if (enabled) { enabled.checked = settings.enabled; enabled.disabled = state.busy; }
    if (voiceWake) { voiceWake.checked = settings.voiceWake; voiceWake.disabled = state.busy; }
    if (songSync) { songSync.checked = settings.songSync; songSync.disabled = state.busy; }
    if (topEdge) { topEdge.checked = settings.topEdgeWake; topEdge.disabled = state.busy; }
    if (wakeWord && document.activeElement !== wakeWord) wakeWord.value = settings.wakeWord;
    if (wakeWord) wakeWord.disabled = state.busy;
    if (hotkey && hotkey.getAttribute('data-capturing') !== '1') hotkey.value = formatHotkey(settings.hotkey);
    var root = document.getElementById('lf-voice-assistant');
    if (root) root.classList.toggle('is-disabled', !settings.enabled);
    var badge = document.getElementById('lf-va-runtime-badge');
    if (badge) {
      badge.textContent = state.busy ? '处理中' : settings.enabled ? (state.error ? '部分不可用' : '已启用') : '已关闭';
      badge.setAttribute('data-tone', state.error ? 'error' : settings.enabled ? 'ok' : 'idle');
    }
    setStatusNode('lf-va-status-mic', 'mic');
    setStatusNode('lf-va-status-service', 'service');
    setStatusNode('lf-va-status-sync', 'sync');
    setStatusNode('lf-va-status-hotkey', 'hotkey');
    var message = document.getElementById('lf-va-message');
    if (message) {
      message.textContent = state.error || state.statusMessage || '';
      message.classList.toggle('error', !!state.error);
    }
  }
  function bindPage(page) {
    var enabled = page.querySelector('#lf-va-enabled');
    var voiceWake = page.querySelector('#lf-va-voice-wake');
    var songSync = page.querySelector('#lf-va-song-sync');
    var topEdge = page.querySelector('#lf-va-top-edge');
    var wakeWord = page.querySelector('#lf-va-wake-word');
    var hotkey = page.querySelector('#lf-va-hotkey');
    enabled.addEventListener('change', function () { updateSettings({ enabled:enabled.checked }, { microphone:enabled.checked }); });
    voiceWake.addEventListener('change', function () { updateSettings({ voiceWake:voiceWake.checked }, { microphone:voiceWake.checked && state.settings.enabled }); });
    songSync.addEventListener('change', function () { updateSettings({ songSync:songSync.checked }); });
    topEdge.addEventListener('change', function () { updateSettings({ topEdgeWake:topEdge.checked }); });
    wakeWord.addEventListener('change', function () { updateSettings({ wakeWord:wakeWord.value }); });
    wakeWord.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      wakeWord.blur();
    });
    hotkey.addEventListener('focus', beginHotkeyCapture);
    hotkey.addEventListener('click', beginHotkeyCapture);
    hotkey.addEventListener('blur', endHotkeyCapture);
    hotkey.addEventListener('keydown', captureHotkey);
    page.querySelector('#lf-va-hotkey-clear').addEventListener('click', function () { updateSettings({ hotkey:'' }, { allowEmptyHotkey:true }); });
    page.querySelector('#lf-va-hotkey-default').addEventListener('click', function () { updateSettings({ hotkey:DEFAULTS.hotkey }); });
  }
  function beginHotkeyCapture(event) {
    var node = event.currentTarget;
    node.setAttribute('data-capturing', '1');
    node.value = '请按组合键…';
  }
  function endHotkeyCapture(event) {
    var node = event.currentTarget;
    node.removeAttribute('data-capturing');
    node.value = formatHotkey(state.settings.hotkey);
  }
  function eventHotkey(event) {
    if (/^(Control|Shift|Alt|Meta)$/.test(event.key || '')) return '';
    var mods = [];
    if (event.ctrlKey) mods.push('Ctrl');
    if (event.altKey) mods.push('Alt');
    if (event.shiftKey) mods.push('Shift');
    if (event.metaKey) mods.push('Meta');
    if (!mods.length || !event.code) return '';
    return mods.concat([event.code]).join('+');
  }
  function captureHotkey(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') { event.currentTarget.blur(); return; }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      updateSettings({ hotkey:'' }, { allowEmptyHotkey:true });
      event.currentTarget.blur();
      return;
    }
    var value = eventHotkey(event);
    if (!value) return;
    updateSettings({ hotkey:value });
    event.currentTarget.blur();
  }

  async function ensureMicrophonePermission(isCurrent) {
    state.micStatus = 'checking';
    state.statusMessage = '正在请求真实麦克风权限…';
    clearError('microphone');
    render();
    var stream = null;
    try {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') throw new Error('MEDIA_DEVICES_UNAVAILABLE');
      stream = await navigator.mediaDevices.getUserMedia({ audio:true, video:false });
      (stream.getTracks ? stream.getTracks() : []).forEach(function (track) { try { track.stop(); } catch (_) {} });
      stream = null;
      if (typeof isCurrent === 'function' && !isCurrent()) return false;
      state.micStatus = 'granted';
      clearError('microphone');
      state.statusMessage = '麦克风权限已确认；权限验证流已立即释放。';
      render();
      return true;
    } catch (error) {
      if (stream && stream.getTracks) stream.getTracks().forEach(function (track) { try { track.stop(); } catch (_) {} });
      if (typeof isCurrent === 'function' && !isCurrent()) return false;
      var errorName = String(error && error.name || 'MICROPHONE_START_FAILED');
      var api = desktopApi();
      if (errorName === 'NotAllowedError' || errorName === 'SecurityError' || errorName === 'PermissionDeniedError') {
        state.micStatus = 'denied';
        try {
          if (api && typeof api.openVoiceAssistantMicrophoneSettings === 'function') await api.openVoiceAssistantMicrophoneSettings();
        } catch (_) {}
        setError('microphone', '麦克风权限被拒绝或受系统策略限制，已打开 Windows 麦克风权限设置；授权后请重新启用。');
      } else if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
        state.micStatus = 'unavailable';
        setError('microphone', '未检测到可用麦克风，请连接或启用麦克风后重试。');
      } else if (errorName === 'NotReadableError' || errorName === 'TrackStartError') {
        state.micStatus = 'unavailable';
        setError('microphone', '麦克风正被其他程序占用，或设备无法启动；释放设备后请重试。');
      } else if (errorName === 'AbortError') {
        state.micStatus = 'unavailable';
        setError('microphone', '麦克风启动被中断，请检查设备连接后重试。');
      } else {
        state.micStatus = 'unavailable';
        setError('microphone', '麦克风启动失败：' + errorName);
      }
      state.statusMessage = '';
      toast(state.error);
      render();
      return false;
    }
  }
  function runtimeConfig(settings, extra) {
    return Object.assign({
      enabled:settings.enabled,
      voiceWake:settings.voiceWake,
      songSync:settings.songSync,
      topEdgeWake:settings.topEdgeWake,
      wakeWord:settings.wakeWord,
      hotkey:settings.hotkey,
      scope:state.scopeKey
    }, extra || {});
  }
  async function configureMain(settings, extra) {
    var api = desktopApi();
    if (!api || typeof api.configureVoiceAssistant !== 'function') return { ok:false, error:'VOICE_DESKTOP_API_UNAVAILABLE' };
    try {
      var result = await api.configureVoiceAssistant(runtimeConfig(settings, extra));
      return result && typeof result === 'object' ? result : { ok:false, error:'VOICE_CONFIG_EMPTY_RESULT' };
    } catch (error) {
      return { ok:false, error:String(error && error.message || error || 'VOICE_CONFIG_FAILED') };
    }
  }
  async function updateSettings(patch, options) {
    if (state.busy || state.disposed) return false;
    options = options || {};
    var operation = ++state.operationSerial;
    var expectedSwitch = state.switchSerial;
    var expectedScope = state.scopeKey;
    var isCurrent = function () {
      return !state.disposed && operation === state.operationSerial &&
        expectedSwitch === state.switchSerial && expectedScope === state.scopeKey && !state.scopeSwitching;
    };
    var previous = cloneSettings(state.settings);
    var candidateInput = Object.assign({}, previous, patch || {});
    var candidate = normalizeSettings(candidateInput);
    if (options.allowEmptyHotkey && Object.prototype.hasOwnProperty.call(patch || {}, 'hotkey') && !patch.hotkey) candidate.hotkey = '';
    if (!candidate.wakeWord) {
      setError('settings', '唤醒词不能为空。');
      render();
      return false;
    }
    state.busy = true;
    clearError('settings');
    render();
    try {
      if (options.microphone && candidate.enabled && candidate.voiceWake) {
        var permissionOk = await ensureMicrophonePermission(isCurrent);
        if (!permissionOk || !isCurrent()) return false;
      }
      var configured = await configureMain(candidate);
      if (!isCurrent()) return false;
      if (!configured || configured.ok !== true) {
        setError('settings', configured && (configured.message || configured.error) || '语音助手启动失败。');
        state.statusMessage = '';
        toast('语音助手设置未生效：' + state.error);
        return false;
      }
      if (!writeScopedSettings(candidate, expectedScope)) {
        await configureMain(previous);
        if (!isCurrent()) return false;
        setError('settings', '设置保存校验失败，原设置已恢复。');
        toast(state.error);
        return false;
      }
      if (!isCurrent()) return false;
      state.settings = candidate;
      if (!candidate.enabled || !candidate.voiceWake) {
        state.wakeArmedUntil = 0;
        state.lastTranscriptKey = '';
        state.lastTranscriptAt = 0;
        state.lastWakeAt = 0;
      }
      state.serviceStatus = candidate.enabled && candidate.voiceWake ? (configured.listening ? 'listening' : 'ready') : 'disabled';
      state.syncStatus = candidate.enabled && candidate.songSync ? 'syncing' : 'disabled';
      state.hotkeyStatus = candidate.enabled && candidate.hotkey ? 'registering' : 'disabled';
      state.statusMessage = candidate.enabled ? '语音助手已按当前 LF 用户设置启动。' : '语音助手已关闭，相关资源已释放。';
      clearError('settings');
      if (!candidate.enabled) clearErrors();
      else {
        if (!candidate.voiceWake) { clearError('microphone'); clearError('service'); }
        if (!candidate.songSync) clearError('sync');
        if (!candidate.hotkey) clearError('hotkey');
      }
      if (candidate.enabled) handleMainStatus(configured.state || configured);
      applyPlaybackBinding();
      if (!candidate.enabled || !candidate.songSync) disablePlaybackSync('settings-disabled');
      refreshGlobalHotkeys();
      if (candidate.enabled && candidate.songSync) syncPlayback('settings-change', true);
      return true;
    } finally {
      if (!state.disposed && operation === state.operationSerial) {
        state.busy = false;
        render();
      }
    }
  }
  function refreshGlobalHotkeys() {
    if (typeof global.registerGlobalHotkeys === 'function') {
      Promise.resolve(global.registerGlobalHotkeys()).catch(function () {});
    } else {
      state.hotkeyStatus = state.settings && state.settings.enabled && state.settings.hotkey ? 'unavailable' : 'disabled';
    }
  }
  function getGlobalHotkeyBinding() {
    return {
      enabled:!!(!state.disposed && !state.scopeSwitching && state.settings && state.settings.enabled && state.settings.hotkey),
      action:'voiceAssistantShow',
      binding:state.settings && state.settings.hotkey || ''
    };
  }
  function onGlobalHotkeyRegistrationResult(result) {
    if (!state.settings || !state.settings.enabled || !state.settings.hotkey || result && result.disabled) state.hotkeyStatus = 'disabled';
    else if (result && result.ok) state.hotkeyStatus = 'ready';
    else if (result && result.conflict) state.hotkeyStatus = 'conflict';
    else state.hotkeyStatus = 'error';
    if (state.hotkeyStatus === 'conflict') setError('hotkey', '全局唤出热键已被占用，请更换组合键。');
    else if (state.hotkeyStatus === 'error') setError('hotkey', '全局唤出热键注册失败，请更换组合键后重试。');
    else clearError('hotkey');
    render();
  }

  function currentAudio() {
    return global.audio && typeof global.audio.addEventListener === 'function' ? global.audio : null;
  }
  function currentQueue() {
    return Array.isArray(global.playQueue) ? global.playQueue : [];
  }
  function cleanSong(song, index) {
    song = song && typeof song === 'object' ? song : {};
    return {
      index:Number.isFinite(index) ? index : -1,
      id:String(song.id || song.songId || song.mid || song.hash || ''),
      name:String(song.name || song.title || ''),
      artist:String(song.artist || song.ar || song.author || ''),
      cover:String(song.cover || song.pic || song.picUrl || song.albumCover || ''),
      provider:String(song.provider || song.sourceProvider || song.platform || '')
    };
  }
  function playbackPayload(reason, includeQueue) {
    var media = currentAudio();
    var queue = currentQueue();
    var index = Number.isFinite(Number(global.currentIdx)) ? Number(global.currentIdx) : -1;
    var current = index >= 0 && index < queue.length ? queue[index] : global.currentLocalSong || null;
    var payload = {
      enabled:!!(state.settings && state.settings.enabled && state.settings.songSync),
      reason:String(reason || 'event'),
      playing:!!(media && media.src && !media.paused && !media.ended),
      currentIndex:index,
      queueLength:queue.length,
      current:cleanSong(current, index),
      currentTime:media && Number.isFinite(media.currentTime) ? Math.max(0, Number(media.currentTime)) : 0,
      duration:media && Number.isFinite(media.duration) ? Math.max(0, Number(media.duration)) : 0,
      canPrevious:queue.length > 0,
      canNext:queue.length > 0
    };
    payload.title = payload.current.name;
    payload.artist = payload.current.artist;
    payload.position = payload.currentTime;
    if (includeQueue) payload.queue = queue.map(function (song, queueIndex) { return cleanSong(song, queueIndex); });
    return payload;
  }
  function playbackSignature(payload) {
    return [payload.playing ? 1 : 0, payload.currentIndex, payload.queueLength, payload.current.id, Math.floor(payload.currentTime), Math.floor(payload.duration)].join('|');
  }
  function disablePlaybackSync(reason) {
    var api = desktopApi();
    state.playbackSerial++;
    if (!api || typeof api.syncVoiceAssistantPlayback !== 'function') return;
    Promise.resolve(api.syncVoiceAssistantPlayback({ enabled:false, reason:String(reason || 'disabled') })).catch(function () {});
  }
  async function syncPlayback(reason, includeQueue) {
    if (state.disposed || !state.settings || !state.settings.enabled || !state.settings.songSync) return { ok:false, disabled:true };
    bindAudioEvents();
    var api = desktopApi();
    if (!api || typeof api.syncVoiceAssistantPlayback !== 'function') {
      state.syncStatus = 'unavailable';
      setError('sync', '歌曲同步接口不可用。');
      render();
      return { ok:false, error:'VOICE_PLAYBACK_SYNC_API_UNAVAILABLE' };
    }
    var payload = playbackPayload(reason, includeQueue === true);
    var signature = playbackSignature(payload) + (includeQueue ? '|queue' : '');
    if (!includeQueue && signature === state.lastPlaybackSignature) return { ok:true, unchanged:true };
    state.lastPlaybackSignature = signature;
    var serial = ++state.playbackSerial;
    try {
      var result = await api.syncVoiceAssistantPlayback(payload);
      if (serial !== state.playbackSerial || state.disposed) return { ok:false, stale:true };
      state.syncStatus = result && result.ok === false ? 'error' : 'ready';
      if (state.syncStatus === 'error') setError('sync', result.message || result.error || '歌曲同步失败。');
      else clearError('sync');
      render();
      return result || { ok:true };
    } catch (error) {
      if (serial === state.playbackSerial) {
        state.syncStatus = 'error';
        setError('sync', String(error && error.message || error || '歌曲同步失败。'));
        render();
      }
      return { ok:false, error:String(error && error.message || error) };
    }
  }
  function unbindAudioEvents() {
    state.audioUnbinders.splice(0).forEach(function (unbind) { try { unbind(); } catch (_) {} });
    state.boundAudio = null;
    state.lastProgressSecond = -1;
    state.lastPlaybackSignature = '';
  }
  function bindAudioEvents() {
    var media = currentAudio();
    if (media === state.boundAudio) return;
    unbindAudioEvents();
    if (!media || !state.settings || !state.settings.enabled || !state.settings.songSync) return;
    state.boundAudio = media;
    ['play','playing','pause','ended','loadedmetadata','durationchange','seeked','emptied','error'].forEach(function (name) {
      var listener = function () { syncPlayback('audio-' + name, name === 'loadedmetadata' || name === 'emptied'); };
      media.addEventListener(name, listener);
      state.audioUnbinders.push(function () { media.removeEventListener(name, listener); });
    });
    var progressListener = function () {
      var second = Math.floor(Number(media.currentTime) || 0);
      if (second === state.lastProgressSecond) return;
      state.lastProgressSecond = second;
      syncPlayback('audio-timeupdate', false);
    };
    media.addEventListener('timeupdate', progressListener);
    state.audioUnbinders.push(function () { media.removeEventListener('timeupdate', progressListener); });
  }
  function applyPlaybackBinding() {
    if (state.settings && state.settings.enabled && state.settings.songSync) bindAudioEvents();
    else unbindAudioEvents();
  }
  function onPlaybackDirty(event) {
    if (!state.settings || !state.settings.enabled || !state.settings.songSync) return;
    bindAudioEvents();
    var detail = event && event.detail || {};
    syncPlayback(detail.reason || 'queue-change', detail.includeQueue !== false);
  }

  function punctuationPattern(text) {
    var compact = nfkc(text).replace(/[\s,，。.!！?？、;；:：'"“”‘’（）()\-]+/g, '');
    return compact.split('').map(function (char) { return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('[\\s,，。.!！?？、;；:：\'"“”‘’（）()\\-]*');
  }
  function parseTranscript(text, now) {
    text = nfkc(text).trim();
    now = Number(now) || Date.now();
    if (!text) return { ok:false, error:'EMPTY_TRANSCRIPT' };
    var transcriptKey = text.toLowerCase().replace(/[\s,，。.!！?？、;；:：'"“”‘’（）()\-]+/g, '');
    if (transcriptKey && transcriptKey === state.lastTranscriptKey && now - state.lastTranscriptAt < FINAL_DEDUP_MS) {
      return { ok:false, error:'DUPLICATE_FINAL' };
    }
    state.lastTranscriptKey = transcriptKey;
    state.lastTranscriptAt = now;
    var wakePattern = punctuationPattern(state.settings && state.settings.wakeWord || DEFAULTS.wakeWord);
    var wakeRegex = wakePattern ? new RegExp(wakePattern, 'i') : null;
    var wakeMatch = wakeRegex && wakeRegex.exec(text);
    var woke = !!wakeMatch;
    var wakeTriggered = false;
    if (woke) {
      text = (text.slice(0, wakeMatch.index) + ' ' + text.slice(wakeMatch.index + wakeMatch[0].length)).trim();
      if (!state.lastWakeAt || now - state.lastWakeAt >= WAKE_COOLDOWN_MS) {
        state.lastWakeAt = now;
        state.wakeArmedUntil = now + WAKE_WINDOW_MS;
        wakeTriggered = true;
      }
    }
    if (!woke && now > state.wakeArmedUntil) return { ok:false, error:'WAKE_REQUIRED' };
    text = text.replace(/^[\s,，。.!！?？、;；:：]+|[\s,，。.!！?？、;；:：]+$/g, '').trim();
    if (!text) return wakeTriggered ? { ok:true, action:'show', wakeMatched:true, wakeTriggered:true } : { ok:false, error:'WAKE_COOLDOWN' };
    if (/^(?:暂停|暂停播放|停止播放)$/.test(text)) return { ok:true, action:'pause', wakeMatched:woke, wakeTriggered:wakeTriggered };
    if (/^(?:播放|继续|继续播放|开始播放)$/.test(text)) return { ok:true, action:'play', wakeMatched:woke, wakeTriggered:wakeTriggered };
    if (/^(?:上一首|上一个|切到上一首|切换上一首)$/.test(text)) return { ok:true, action:'previous', wakeMatched:woke, wakeTriggered:wakeTriggered };
    if (/^(?:下一首|下一个|切到下一首|切换下一首)$/.test(text)) return { ok:true, action:'next', wakeMatched:woke, wakeTriggered:wakeTriggered };
    var search = /^(?:搜索|搜一下|查找)(?:歌曲)?\s*(.{1,80})$/.exec(text) || /^(?:播放歌曲|播放)\s*(.{1,80})$/.exec(text);
    if (search && search[1] && search[1].trim()) return { ok:true, action:'search', query:search[1].trim(), wakeMatched:woke, wakeTriggered:wakeTriggered };
    return { ok:false, error:'COMMAND_NOT_ALLOWED' };
  }
  function validDirectCommand(payload) {
    var allowed = { search:1, play:1, pause:1, previous:1, next:1, show:1 };
    if (!payload || !allowed[payload.action]) return false;
    if (payload.source === 'overlay' || payload.source === 'global-hotkey' || payload.source === 'top-edge') return true;
    return payload.wakeMatched === true || Date.now() <= state.wakeArmedUntil || payload.action === 'show';
  }
  async function executeCommand(command) {
    if (!state.settings || !state.settings.enabled || !command || !command.action) return { ok:false, error:'VOICE_ASSISTANT_DISABLED' };
    var action = command.action;
    if (action === 'show') return show(command.source || 'voice');
    if (action === 'search') {
      var query = String(command.query || '').trim().slice(0, 80);
      if (!query) return { ok:false, error:'SEARCH_QUERY_REQUIRED' };
      var input = document.getElementById('search-input');
      if (input) {
        input.value = query;
        if (global.LumiFieldAnimatedSearch && typeof global.LumiFieldAnimatedSearch.refresh === 'function') global.LumiFieldAnimatedSearch.refresh();
      }
      if (typeof global.submitSearchInput === 'function') await global.submitSearchInput(query, { autoPlayFirst:true, source:'voice-assistant' });
      else if (typeof global.doSearch === 'function') await global.doSearch(query, { autoPlayFirst:true, source:'voice-assistant' });
      else return { ok:false, error:'SEARCH_API_UNAVAILABLE' };
    } else if (action === 'play') {
      if ((!currentAudio() || currentAudio().paused || currentAudio().ended) && typeof global.togglePlay === 'function') await global.togglePlay();
    } else if (action === 'pause') {
      if (currentAudio() && !currentAudio().paused && typeof global.togglePlay === 'function') await global.togglePlay();
    } else if (action === 'previous') {
      if (typeof global.prevTrack === 'function') global.prevTrack();
      else return { ok:false, error:'PREVIOUS_API_UNAVAILABLE' };
    } else if (action === 'next') {
      if (typeof global.nextTrack === 'function') global.nextTrack();
      else return { ok:false, error:'NEXT_API_UNAVAILABLE' };
    } else {
      return { ok:false, error:'COMMAND_NOT_ALLOWED' };
    }
    state.lastCommand = { action:action, query:command.query || '', at:Date.now() };
    state.statusMessage = action === 'search' ? '已在 LF 搜索并播放：' + command.query : '已执行 LF 播放指令：' + action;
    clearError('command');
    render();
    return { ok:true, action:action };
  }
  async function handleCommand(payload) {
    payload = payload && typeof payload === 'object' ? payload : {};
    if (!state.settings || !state.settings.enabled) return { ok:false, error:'VOICE_ASSISTANT_DISABLED' };
    if (payload.text) {
      if (!state.settings.voiceWake) return { ok:false, error:'VOICE_WAKE_DISABLED' };
      var parsed = parseTranscript(payload.text);
      if (!parsed.ok) {
        if (parsed.error === 'COMMAND_NOT_ALLOWED') {
          setError('command', '只支持搜索歌曲、播放、暂停、上一首和下一首。');
          render();
        }
        return parsed;
      }
      parsed.source = 'voice';
      if (parsed.wakeTriggered && parsed.action !== 'show') show('wake-word');
      return executeCommand(parsed);
    }
    if (!validDirectCommand(payload)) return { ok:false, error:'COMMAND_NOT_ALLOWED_OR_WAKE_REQUIRED' };
    return executeCommand(payload);
  }
  async function show(source) {
    if (!state.settings || !state.settings.enabled) {
      toast('请先在视觉控制台启用语音助手');
      return { ok:false, error:'VOICE_ASSISTANT_DISABLED' };
    }
    state.wakeArmedUntil = Date.now() + WAKE_WINDOW_MS;
    var api = desktopApi();
    var result;
    try {
      result = api && typeof api.showVoiceAssistant === 'function'
        ? await api.showVoiceAssistant()
        : await configureMain(state.settings, { show:true, source:String(source || 'renderer') });
    } catch (error) {
      result = { ok:false, error:String(error && error.message || error || 'VOICE_SHOW_FAILED') };
    }
    if (!result || result.ok !== true) {
      setError('overlay', result && (result.message || result.error) || '语音助手悬浮窗唤出失败。');
      render();
    } else clearError('overlay');
    return result;
  }
  function handleMainStatus(payload) {
    payload = payload && typeof payload === 'object' ? payload : {};
    if (!state.settings || !state.settings.enabled) return;
    var recognition = payload.recognition && typeof payload.recognition === 'object' ? payload.recognition : payload;
    var serviceState = String(recognition.state || payload.state || '');
    if (payload.listening === true || serviceState === 'listening' || serviceState === 'command') {
      state.serviceStatus = 'listening';
      state.micStatus = 'granted';
      clearError('service');
      clearError('microphone');
    }
    else if (payload.ready === true || serviceState === 'ready') { state.serviceStatus = 'ready'; clearError('service'); }
    else if (serviceState === 'starting') state.serviceStatus = 'starting';
    else if (serviceState === 'stopped') { state.serviceStatus = 'disabled'; clearError('service'); }
    else if (recognition.available === false || serviceState === 'unavailable') state.serviceStatus = 'unavailable';
    else if (payload.error || serviceState === 'error') state.serviceStatus = 'error';
    var systemStatus = payload.systemStatus && typeof payload.systemStatus === 'object' ? payload.systemStatus : {};
    var microphone = String(payload.microphone || systemStatus.microphone || '');
    if (microphone === 'granted') { state.micStatus = 'granted'; clearError('microphone'); }
    else if (microphone === 'denied') { state.micStatus = 'denied'; setError('microphone', '麦克风权限被拒绝。'); }
    else if (microphone === 'unavailable' || microphone === 'not-found' || microphone === 'busy') { state.micStatus = 'unavailable'; setError('microphone', '麦克风不可用。'); }
    var reason = String(recognition.reason || payload.error || systemStatus.error || '');
    if (reason && (state.serviceStatus === 'unavailable' || state.serviceStatus === 'error')) setError('service', String(payload.message || serviceReasonText(reason)));
    else if (payload.message) state.statusMessage = String(payload.message);
    render();
  }
  function bindMainEvents() {
    var api = desktopApi();
    if (!api) return;
    if (typeof api.onVoiceAssistantCommand === 'function') state.commandUnsubscribe = api.onVoiceAssistantCommand(handleCommand);
    if (typeof api.onVoiceAssistantStatus === 'function') state.statusUnsubscribe = api.onVoiceAssistantStatus(handleMainStatus);
  }
  async function applyLoadedSettings(serial) {
    if (serial !== state.switchSerial || state.disposed) return;
    var configured = await configureMain(state.settings);
    if (serial !== state.switchSerial || state.disposed) return;
    if (!configured || configured.ok !== true) {
      state.serviceStatus = state.settings.enabled ? 'error' : 'disabled';
      state.syncStatus = state.settings.enabled && state.settings.songSync ? 'unavailable' : 'disabled';
      if (state.settings.enabled) setError('service', configured.message || configured.error || '桌面语音服务不可用。');
      else clearErrors();
    } else {
      state.serviceStatus = state.settings.enabled && state.settings.voiceWake ? (configured.listening ? 'listening' : 'ready') : 'disabled';
      state.syncStatus = state.settings.enabled && state.settings.songSync ? 'syncing' : 'disabled';
      clearError('service');
      if (!state.settings.songSync) clearError('sync');
      if (!state.settings.hotkey) clearError('hotkey');
      state.statusMessage = state.settings.enabled ? '已恢复当前 LF 用户的语音助手设置。' : '语音助手已关闭';
      if (state.settings.enabled) handleMainStatus(configured.state || configured);
    }
    applyPlaybackBinding();
    if (!state.settings.enabled || !state.settings.songSync) disablePlaybackSync('scope-load-disabled');
    refreshGlobalHotkeys();
    if (state.settings.enabled && state.settings.songSync) syncPlayback('scope-load', true);
    render();
  }
  async function switchScope(userId) {
    if (state.disposed) return { ok:false, disposed:true };
    state.operationSerial++;
    var serial = ++state.switchSerial;
    state.busy = true;
    state.scopeSwitching = true;
    state.wakeArmedUntil = 0;
    state.lastTranscriptKey = '';
    state.lastTranscriptAt = 0;
    state.lastWakeAt = 0;
    unbindAudioEvents();
    disablePlaybackSync('account-switch');
    refreshGlobalHotkeys();
    await configureMain(Object.assign(cloneSettings(state.settings || DEFAULTS), { enabled:false }));
    if (serial !== state.switchSerial || state.disposed) return { ok:false, stale:true };
    state.scope = String(userId || 'anonymous');
    state.scopeKey = keyForUser(state.scope);
    state.settings = readScopedSettings(state.scopeKey);
    state.micStatus = 'unknown';
    state.serviceStatus = 'disabled';
    state.syncStatus = 'disabled';
    state.hotkeyStatus = 'disabled';
    clearErrors();
    state.scopeSwitching = false;
    render();
    await applyLoadedSettings(serial);
    if (serial !== state.switchSerial || state.disposed) return { ok:false, stale:true };
    state.busy = false;
    render();
    return { ok:true, scope:state.scopeKey };
  }
  function onAuthChange(event) {
    var detail = event && event.detail || {};
    switchScope(detail.loggedIn ? detail.userId : 'anonymous');
  }
  function initialUserId() {
    try {
      var user = global.LFAuth && typeof global.LFAuth.getUser === 'function' ? global.LFAuth.getUser() : null;
      return String(user && (user.id || user.userId || user.email) || 'anonymous');
    } catch (_) {
      return 'anonymous';
    }
  }
  function getDebugState() {
    return {
      version:VERSION,
      disposed:state.disposed,
      scopeSwitching:state.scopeSwitching,
      scopeKey:state.scopeKey,
      settings:cloneSettings(state.settings || DEFAULTS),
      status:{ microphone:state.micStatus, service:state.serviceStatus, sync:state.syncStatus, hotkey:state.hotkeyStatus },
      wakeWindowOpen:Date.now() <= state.wakeArmedUntil,
      boundToUniqueAudio:state.boundAudio === currentAudio(),
      audioListenerCount:state.audioUnbinders.length,
      lastCommand:state.lastCommand
    };
  }
  function dispose() {
    if (state.disposed) return;
    state.disposed = true;
    state.operationSerial++;
    state.scopeSwitching = true;
    refreshGlobalHotkeys();
    state.switchSerial++;
    state.playbackSerial++;
    unbindAudioEvents();
    disablePlaybackSync('pagehide');
    document.removeEventListener('lumifield-playback-state-dirty', onPlaybackDirty);
    document.removeEventListener('lumifield-auth-user-change', onAuthChange);
    global.removeEventListener('pagehide', dispose);
    if (state.commandUnsubscribe) { try { state.commandUnsubscribe(); } catch (_) {} state.commandUnsubscribe = null; }
    if (state.statusUnsubscribe) { try { state.statusUnsubscribe(); } catch (_) {} state.statusUnsubscribe = null; }
    configureMain(Object.assign(cloneSettings(state.settings || DEFAULTS), { enabled:false }));
  }
  function boot() {
    state.scope = initialUserId();
    state.scopeKey = keyForUser(state.scope);
    state.settings = readScopedSettings(state.scopeKey);
    ensurePage();
    bindMainEvents();
    document.addEventListener('lumifield-playback-state-dirty', onPlaybackDirty);
    document.addEventListener('lumifield-auth-user-change', onAuthChange);
    global.addEventListener('pagehide', dispose);
    render();
    applyLoadedSettings(state.switchSerial);
  }

  global.LumiFieldVoiceAssistant = {
    version:VERSION,
    getSettings:function () { return cloneSettings(state.settings || DEFAULTS); },
    getGlobalHotkeyBinding:getGlobalHotkeyBinding,
    onGlobalHotkeyRegistrationResult:onGlobalHotkeyRegistrationResult,
    show:show,
    handleCommand:handleCommand,
    parseTranscript:parseTranscript,
    updateSettings:updateSettings,
    syncPlayback:syncPlayback,
    switchScope:switchScope,
    getDebugState:getDebugState,
    dispose:dispose,
    __test:Object.freeze({
      defaults:cloneSettings(DEFAULTS),
      normalizeSettings:normalizeSettings,
      normalizeHotkey:normalizeHotkey,
      normalizeText:nfkc,
      scopeToken:scopeToken,
      keyForUser:keyForUser,
      playbackPayload:playbackPayload,
      setTestUser:switchScope
    })
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})(window);
