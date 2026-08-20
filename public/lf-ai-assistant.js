(function (global) {
  'use strict';
  if (global.__lumifieldAIAssistantInstalled) return;
  global.__lumifieldAIAssistantInstalled = true;

  var state = {
    settings:null,
    providers:null,
    hasKey:{},
    connection:{},
    scopeHash:'',
    generation:0,
    busy:false,
    status:'',
    error:'',
    lastResult:null,
    disposed:false,
    loadSerial:0,
    operationSerial:0,
    actionCount:0
  };

  function api() { return global.desktopWindow || null; }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char];
    });
  }
  function toast(message) { if (typeof global.showToast === 'function') global.showToast(String(message || '')); }
  function currentProvider() {
    return state.settings && state.settings.assistant && state.settings.assistant.provider || 'zhipu';
  }
  function providerSettings(provider) {
    return state.settings && state.settings.assistant && state.settings.assistant.providers && state.settings.assistant.providers[provider] || null;
  }
  function errorText(code) {
    var known = {
      API_KEY_REQUIRED:'请先安全保存 API Key。',
      API_KEY_INVALID:'API Key 无效。',
      FREE_ONLY_CONFIRMATION_REQUIRED:'请先确认当前使用自己的免费层或免费额度。',
      PAID_ACCESS_REQUIRED:'Provider 要求付费，LF 已停止调用。',
      MODEL_OR_FREE_QUOTA_UNAVAILABLE:'模型不可用或当前没有可用免费额度。',
      FREE_QUOTA_OR_RATE_LIMIT_REACHED:'免费额度已用尽或触发限流。',
      MODEL_NOT_AVAILABLE:'当前模型不可用。',
      PROVIDER_UNAVAILABLE:'Provider 暂时不可用。',
      SECURE_STORAGE_UNAVAILABLE:'Windows 安全凭据存储当前不可用。',
      ASSISTANT_DISABLED:'请先启用 AI 语音助手。',
      EXPLICIT_USER_ACTION_REQUIRED:'只有用户明确发出的指令才会调用模型。',
      MODEL_RESPONSE_NOT_JSON:'模型没有返回可安全执行的 LF Action。',
      DEVELOPMENT_PERMISSION_REQUIRED:'当前 LF 账户未获得管理员开发权限。',
      INVALID_SESSION:'LF 登录状态已失效，请重新登录。'
    };
    return known[String(code || '')] || String(code || 'AI_ASSISTANT_FAILED');
  }
  function ensureUi() {
    var voiceRoot = document.getElementById('lf-voice-assistant');
    if (!voiceRoot || document.getElementById('lf-ai-provider-settings')) return document.getElementById('lf-ai-provider-settings');
    var section = document.createElement('section');
    section.id = 'lf-ai-provider-settings';
    section.className = 'lf-ai-provider-settings';
    section.setAttribute('aria-label', 'AI Provider 与 LF Tool 设置');
    section.innerHTML =
      '<div class="lf-ai-heading"><div><b>AI Provider</b><span>模型只在你明确发出指令时调用，Key 由 Windows 安全存储加密。</span></div><em id="lf-ai-connection-badge">未配置</em></div>' +
      '<div id="lf-ai-provider-list" class="lf-ai-provider-list"></div>' +
      '<div class="lf-ai-tool-policy"><b>LF Tool Allowlist</b><span>允许控制 LF 内的播放、音量、进度、歌词、视觉、天气、壁纸、歌单、界面与设置；默认拒绝源码、Git、Shell、文件、Windows 和其他应用。开发工具必须由受信任主进程确认管理员权限。</span></div>' +
      '<form id="lf-ai-command-form" class="lf-ai-command-form"><label for="lf-ai-command">向 AI 发出 LF 指令</label><div><input id="lf-ai-command" maxlength="800" autocomplete="off" placeholder="例如：把音量调到 40%，然后播放下一首"><button type="submit">发送</button></div></form>' +
      '<div id="lf-ai-status" class="lf-ai-status" role="status" aria-live="polite"></div>';
    voiceRoot.appendChild(section);
    section.addEventListener('click', onClick);
    section.addEventListener('change', onChange);
    section.querySelector('#lf-ai-command-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var input = section.querySelector('#lf-ai-command');
      var text = String(input && input.value || '').trim();
      if (!text) return;
      handleNaturalLanguage(text, { source:'text' }).then(function (result) {
        if (result && result.ok && input) input.value = '';
      });
    });
    return section;
  }
  function renderProviders() {
    var list = document.getElementById('lf-ai-provider-list');
    if (!list || !state.providers || !state.settings) return;
    var selected = currentProvider();
    list.innerHTML = Object.keys(state.providers).map(function (provider) {
      var meta = state.providers[provider];
      var settings = providerSettings(provider);
      var connection = state.connection[provider] || { state:'untested', reason:'' };
      var keyState = state.hasKey[provider] ? 'Key 已安全保存' : '尚未保存 Key';
      var connectionText = connection.state === 'connected' ? '模型已连接' : connection.state === 'failed' ? ('模型未连接：' + errorText(connection.reason)) : '尚未测试连接';
      return '<details class="lf-ai-provider" data-provider="' + esc(provider) + '"' + (provider === selected ? ' open data-selected="true"' : '') + '>' +
        '<summary><span><b>' + esc(meta.label) + '</b><small>' + esc(keyState) + '</small></span><em>' + (provider === selected ? '当前' : '选择') + '</em></summary>' +
        '<div class="lf-ai-provider-body">' +
          '<label><span>Model</span><select data-ai-field="model">' + meta.models.map(function (model) {
            return '<option value="' + esc(model.id) + '"' + (model.id === settings.model ? ' selected' : '') + '>' + esc(model.label + ' · ' + model.description) + '</option>';
          }).join('') + '</select></label>' +
          '<label><span>Base URL</span><input data-ai-field="baseUrl" type="url" maxlength="512" spellcheck="false" value="' + esc(settings.baseUrl) + '"></label>' +
          '<label><span>API Key</span><input data-ai-key type="password" maxlength="8192" autocomplete="new-password" placeholder="' + esc(state.hasKey[provider] ? '已安全保存；输入新 Key 可替换' : '输入此 Provider 的 API Key') + '"></label>' +
          '<label class="lf-ai-free-confirm"><input data-ai-field="freeOnlyAcknowledged" type="checkbox"' + (settings.freeOnlyAcknowledged ? ' checked' : '') + '><span>我确认使用自己的 Key，且当前调用属于免费层或免费额度；LF 不得自动产生付费调用。</span></label>' +
          '<div class="lf-ai-provider-actions"><button type="button" data-ai-action="select">设为当前</button><button type="button" data-ai-action="save-key">保存 Key</button><button type="button" data-ai-action="clear-key">清除 Key</button><button type="button" data-ai-action="get-key">获取 API Key</button><button type="button" data-ai-action="test">测试连接</button></div>' +
          '<div class="lf-ai-provider-status" data-tone="' + esc(connection.state) + '">' + esc(connectionText) + '</div>' +
        '</div>' +
      '</details>';
    }).join('');
  }
  function render() {
    var root = ensureUi();
    if (!root) return;
    if (state.providers && state.settings) renderProviders();
    root.classList.toggle('is-busy', state.busy);
    root.querySelectorAll('button,input,select').forEach(function (node) { node.disabled = state.busy; });
    var selected = currentProvider();
    var connection = state.connection[selected] || { state:'untested' };
    var badge = document.getElementById('lf-ai-connection-badge');
    if (badge) {
      badge.textContent = state.busy ? '处理中' : connection.state === 'connected' ? '模型已连接' : state.hasKey[selected] ? '待测试' : '未配置';
      badge.setAttribute('data-tone', connection.state === 'connected' ? 'ok' : connection.state === 'failed' ? 'error' : 'idle');
    }
    var status = document.getElementById('lf-ai-status');
    if (status) {
      status.textContent = state.error || state.status || '';
      status.classList.toggle('error', !!state.error);
    }
  }
  async function load() {
    var serial = ++state.loadSerial;
    state.operationSerial += 1;
    var bridge = api();
    if (!bridge || typeof bridge.getAIAssistantSettings !== 'function') {
      state.error = 'AI 主进程接口不可用。';
      render();
      return { ok:false, error:'AI_MAIN_API_UNAVAILABLE' };
    }
    var result;
    try { result = await bridge.getAIAssistantSettings(); }
    catch (error) { result = { ok:false, error:String(error && error.message || error || 'AI_SETTINGS_READ_FAILED') }; }
    if (serial !== state.loadSerial || state.disposed) return { ok:false, stale:true };
    if (!result || result.ok !== true) {
      state.error = errorText(result && result.error);
      render();
      return result;
    }
    state.settings = result.settings;
    state.providers = result.providers;
    state.hasKey = result.hasKey || {};
    state.connection = result.connection || {};
    state.scopeHash = String(result.scopeHash || '');
    state.generation = Number(result.generation) || 0;
    state.error = '';
    state.status = result.secureStorage ? 'AI 设置已由主进程按 LF 用户隔离保存。' : 'Windows 安全凭据存储不可用。';
    render();
    return result;
  }
  async function persistAssistant(patch) {
    var operation = ++state.operationSerial;
    var expectedScope = state.scopeHash;
    var bridge = api();
    if (!bridge || typeof bridge.setAIAssistantSettings !== 'function') return { ok:false, error:'AI_MAIN_API_UNAVAILABLE' };
    var result = await bridge.setAIAssistantSettings({ assistant:patch });
    if (operation !== state.operationSerial || state.disposed || expectedScope !== state.scopeHash) return { ok:false, stale:true, error:'STALE_ACCOUNT_SCOPE' };
    if (result && result.ok && result.settings) {
      state.settings = result.settings;
      state.scopeHash = String(result.scopeHash || state.scopeHash);
      state.generation = Number(result.generation) || state.generation;
      state.error = '';
    } else state.error = errorText(result && result.error);
    render();
    return result;
  }
  function providerFromNode(node) {
    var details = node && node.closest ? node.closest('.lf-ai-provider[data-provider]') : null;
    return details ? details.getAttribute('data-provider') : '';
  }
  async function onChange(event) {
    var field = event.target && event.target.getAttribute('data-ai-field');
    if (!field || !state.settings) return;
    var provider = providerFromNode(event.target);
    var current = providerSettings(provider);
    if (!current) return;
    var value = field === 'freeOnlyAcknowledged' ? event.target.checked : event.target.value;
    var providers = {};
    providers[provider] = Object.assign({}, current, {});
    providers[provider][field] = value;
    state.busy = true;
    render();
    try {
      var result = await persistAssistant({ providers:providers });
      state.status = result && result.ok ? 'Provider 配置已保存。' : '';
    } finally { state.busy = false; render(); }
  }
  async function onClick(event) {
    var button = event.target && event.target.closest ? event.target.closest('[data-ai-action]') : null;
    if (!button || state.busy) return;
    var action = button.getAttribute('data-ai-action');
    var provider = providerFromNode(button);
    if (!provider || !state.providers || !state.providers[provider]) return;
    var bridge = api();
    state.busy = true;
    state.error = '';
    render();
    try {
      var result;
      if (action === 'select') {
        result = await persistAssistant({ provider:provider });
        if (result && result.ok) state.status = '当前 AI 已切换为 ' + state.providers[provider].label + '。';
      } else if (action === 'save-key') {
        var keyInput = button.closest('.lf-ai-provider').querySelector('[data-ai-key]');
        var key = String(keyInput && keyInput.value || '').trim();
        result = key && bridge && typeof bridge.setAIAssistantApiKey === 'function'
          ? await bridge.setAIAssistantApiKey(provider, key)
          : { ok:false, error:'INVALID_API_KEY' };
        if (result && result.ok && result.scopeHash === state.scopeHash) {
          state.hasKey[provider] = true;
          keyInput.value = '';
          state.connection[provider] = { state:'untested', reason:'' };
          state.status = 'API Key 已由 Windows 安全存储加密保存。';
        }
      } else if (action === 'clear-key') {
        result = bridge && typeof bridge.clearAIAssistantApiKey === 'function'
          ? await bridge.clearAIAssistantApiKey(provider)
          : { ok:false, error:'AI_MAIN_API_UNAVAILABLE' };
        if (result && result.ok && result.scopeHash === state.scopeHash) {
          state.hasKey[provider] = false;
          state.connection[provider] = { state:'untested', reason:'' };
          state.status = 'API Key 已清除。';
        }
      } else if (action === 'get-key') {
        result = bridge && typeof bridge.openAIProviderKeyPage === 'function'
          ? await bridge.openAIProviderKeyPage(provider)
          : { ok:false, error:'AI_MAIN_API_UNAVAILABLE' };
      } else if (action === 'test') {
        result = bridge && typeof bridge.testAIAssistantConnection === 'function'
          ? await bridge.testAIAssistantConnection(provider)
          : { ok:false, error:'AI_MAIN_API_UNAVAILABLE' };
        if (result && result.scopeHash && result.scopeHash !== state.scopeHash) result = { ok:false, stale:true, error:'STALE_ACCOUNT_SCOPE' };
        state.connection[provider] = result && result.ok
          ? { state:'connected', reason:'', at:Date.now(), model:result.model }
          : { state:'failed', reason:String(result && result.error || 'CONNECTION_FAILED'), at:Date.now() };
        state.status = result && result.ok ? '模型已连接' : '';
      }
      if (!result || result.ok !== true) state.error = errorText(result && result.error);
    } catch (error) { state.error = errorText(error && error.message || error); }
    finally { state.busy = false; render(); }
  }
  function controlLabel(node) {
    if (!node) return '';
    var label = node.closest && node.closest('label');
    var text = label && (label.querySelector('span') || label.querySelector('b') || label).textContent;
    if (!text) {
      var row = node.closest && node.closest('.fx-slider,.fx-toggle,.fx-seg');
      text = row && (row.querySelector('label') || row.querySelector('span') || row.previousElementSibling) &&
        (row.querySelector('label') || row.querySelector('span') || row.previousElementSibling).textContent;
    }
    if (!text && node.previousElementSibling) text = node.previousElementSibling.textContent;
    return String(text || node.getAttribute && (node.getAttribute('aria-label') || node.title) || node.id || '').replace(/\s+/g, ' ').trim().slice(0, 64);
  }
  function optionValue(button) {
    if (!button || !button.attributes) return '';
    for (var index = 0; index < button.attributes.length; index += 1) {
      var attribute = button.attributes[index];
      if (/^data-(?!ai-|lf-test)/.test(attribute.name) && attribute.value) return String(attribute.value).slice(0, 80);
    }
    return '';
  }
  function currentControlCatalog() {
    var panel = document.getElementById('fx-panel');
    if (!panel) return [];
    var result = [], seen = Object.create(null);
    function add(entry) {
      if (!entry || !entry.id || !entry.label || seen[entry.id] || /(?:password|token|cookie|secret|api[-_]?key|file|path)/i.test(entry.id)) return;
      seen[entry.id] = true; result.push(entry);
    }
    panel.querySelectorAll('input[id],select[id]').forEach(function (node) {
      if (node.closest('#lf-ai-provider-settings') || node.disabled) return;
      var type = node.tagName === 'SELECT' ? 'select' : String(node.type || '').toLowerCase();
      if (!['range','number','checkbox','color','select'].includes(type)) return;
      var entry = { id:node.id, kind:'set', label:controlLabel(node), inputType:type, value:type === 'checkbox' ? node.checked : node.value };
      if ((type === 'range' || type === 'number') && node.min !== '') entry.min = Number(node.min);
      if ((type === 'range' || type === 'number') && node.max !== '') entry.max = Number(node.max);
      if (type === 'select') entry.options = Array.prototype.map.call(node.options, function (option) { return { value:option.value, label:String(option.textContent || option.value).trim().slice(0, 48) }; });
      add(entry);
    });
    panel.querySelectorAll('.fx-toggle[id]').forEach(function (node) {
      if (node.closest('#lf-ai-provider-settings') || node.classList.contains('dev-locked')) return;
      add({ id:node.id, kind:'toggle', label:controlLabel(node), value:node.classList.contains('active') });
    });
    panel.querySelectorAll('.fx-seg[id]').forEach(function (group) {
      if (group.closest('#lf-ai-provider-settings')) return;
      var options = Array.prototype.map.call(group.querySelectorAll('button:not(:disabled)'), function (button) {
        return { value:optionValue(button), label:String(button.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48), active:button.classList.contains('active') };
      }).filter(function (option) { return option.value && option.label; });
      if (!options.length) return;
      var active = options.find(function (option) { return option.active; });
      add({ id:group.id, kind:'choice', label:controlLabel(group), value:active && active.value || '', options:options.map(function (option) { return { value:option.value, label:option.label }; }) });
    });
    return result.slice(0, 160);
  }
  function currentContext() {
    var media = global.audio || document.querySelector('audio');
    return {
      playing:!!(media && !media.paused && !media.ended),
      title:String(global.currentSong && (global.currentSong.title || global.currentSong.name) || document.getElementById('song-title') && document.getElementById('song-title').textContent || ''),
      artist:String(global.currentSong && (global.currentSong.artist || global.currentSong.creator) || document.getElementById('song-artist') && document.getElementById('song-artist').textContent || ''),
      position:media ? Number(media.currentTime) || 0 : 0,
      duration:media ? Number(media.duration) || 0 : 0,
      view:document.body.classList.contains('empty-home-active') ? 'home' : 'stage',
      controls:currentControlCatalog()
    };
  }
  function dispatchControl(element, value) {
    if (!element || element.disabled) return { ok:false, error:'CONTROL_UNAVAILABLE' };
    var type = String(element.type || '').toLowerCase();
    var safeRoot = element.closest('#fx-panel') || ['volume-slider','cover-crop-zoom'].includes(element.id);
    if (!safeRoot || element.closest('#lf-ai-provider-settings') || ['password','file','hidden'].includes(type)) return { ok:false, error:'CONTROL_NOT_ALLOWLISTED' };
    if (type === 'checkbox') element.checked = value === true;
    else if (type === 'range' || type === 'number') {
      var number = Number(value);
      if (!Number.isFinite(number)) return { ok:false, error:'INVALID_CONTROL_VALUE' };
      if (element.min !== '') number = Math.max(Number(element.min), number);
      if (element.max !== '') number = Math.min(Number(element.max), number);
      element.value = String(number);
    } else if (element.tagName === 'SELECT') {
      var allowed = Array.prototype.some.call(element.options, function (option) { return option.value === String(value); });
      if (!allowed) return { ok:false, error:'INVALID_CONTROL_VALUE' };
      element.value = String(value);
    } else return { ok:false, error:'CONTROL_NOT_ALLOWLISTED' };
    element.dispatchEvent(new Event('input', { bubbles:true }));
    element.dispatchEvent(new Event('change', { bubbles:true }));
    return { ok:true };
  }
  function dispatchToggle(id, enabled) {
    var node = document.getElementById(id);
    if (!node || !node.closest('#fx-panel') || node.closest('#lf-ai-provider-settings') || !node.classList.contains('fx-toggle') || node.classList.contains('dev-locked')) return { ok:false, error:'CONTROL_NOT_ALLOWLISTED' };
    if (node.classList.contains('active') !== (enabled === true)) node.click();
    return { ok:true };
  }
  function dispatchChoice(id, value) {
    var group = document.getElementById(id);
    if (!group || !group.closest('#fx-panel') || group.closest('#lf-ai-provider-settings') || !group.classList.contains('fx-seg')) return { ok:false, error:'CONTROL_NOT_ALLOWLISTED' };
    var wanted = String(value || '');
    var button = Array.prototype.find.call(group.querySelectorAll('button:not(:disabled)'), function (candidate) { return optionValue(candidate) === wanted; });
    if (!button) return { ok:false, error:'INVALID_CONTROL_VALUE' };
    if (!button.classList.contains('active')) button.click();
    return { ok:true };
  }
  async function executeAction(action) {
    action = action || {};
    var name = String(action.name || '');
    var args = action.args || {};
    if (action.executedInMain) return { ok:true, name:name, executedInMain:true };
    if (name === 'playback.play') {
      if ((!global.audio || global.audio.paused || global.audio.ended) && typeof global.togglePlay === 'function') await global.togglePlay();
    } else if (name === 'playback.pause') {
      if (global.audio && !global.audio.paused && typeof global.togglePlay === 'function') await global.togglePlay();
    } else if (name === 'playback.previous' && typeof global.prevTrack === 'function') global.prevTrack();
    else if (name === 'playback.next' && typeof global.nextTrack === 'function') global.nextTrack();
    else if (name === 'playback.search') {
      var input = document.getElementById('search-input');
      if (input) input.value = args.query;
      if (typeof global.submitSearchInput === 'function') await global.submitSearchInput(args.query, { autoPlayFirst:true, source:'ai-assistant' });
      else return { ok:false, error:'SEARCH_API_UNAVAILABLE' };
    } else if (name === 'playback.volume') {
      if (typeof global.setVolume === 'function') global.setVolume(args.value);
      else return { ok:false, error:'VOLUME_API_UNAVAILABLE' };
    } else if (name === 'playback.seek') {
      var media = global.audio || document.querySelector('audio');
      if (!media) return { ok:false, error:'AUDIO_UNAVAILABLE' };
      var target = args.percent != null && Number.isFinite(media.duration) ? media.duration * args.percent : args.seconds;
      media.currentTime = Math.max(0, Math.min(Number.isFinite(media.duration) ? media.duration : 86400, Number(target) || 0));
    } else if (name === 'lyrics.toggle' && typeof global.toggleLyricsPanel === 'function') global.toggleLyricsPanel(typeof args.visible === 'boolean' ? args.visible : undefined);
    else if (name === 'visual.preset' && typeof global.setPreset === 'function') global.setPreset(args.index);
    else if (name === 'weather.refresh') {
      var refresh = document.getElementById('lf-weather-refresh'); if (refresh) refresh.click(); else return { ok:false, error:'WEATHER_API_UNAVAILABLE' };
    } else if (name === 'weather.city') {
      var city = document.getElementById('lf-weather-city-input'), search = document.getElementById('lf-weather-search');
      if (!city || !search) return { ok:false, error:'WEATHER_API_UNAVAILABLE' };
      city.value = args.city; city.dispatchEvent(new Event('input', { bubbles:true })); search.click();
    } else if (name === 'wallpaper.open') {
      var opener = args.target === 'weather' ? document.getElementById('lf-weather-wallpaper') : document.getElementById('lf-wallpaper-open');
      if (!opener) return { ok:false, error:'WALLPAPER_API_UNAVAILABLE' }; opener.click();
    } else if (name === 'wallpaper.clear') {
      var clear = args.target === 'weather' ? document.getElementById('lf-weather-clear') : document.getElementById('lf-wallpaper-clear');
      if (!clear) return { ok:false, error:'WALLPAPER_API_UNAVAILABLE' }; clear.click();
    } else if (name === 'playlist.open' && typeof global.togglePlaylistPanel === 'function') global.togglePlaylistPanel(typeof args.visible === 'boolean' ? args.visible : true);
    else if (name === 'ui.open') {
      if (args.panel === 'home' && typeof global.goHome === 'function') global.goHome();
      else if (args.panel === 'library' && typeof global.openHomeLibrary === 'function') global.openHomeLibrary();
      else if (args.panel === 'profile' && typeof global.openHomeInsight === 'function') global.openHomeInsight();
      else if (args.panel === 'player-console' && typeof global.openHomePlayerConsole === 'function') global.openHomePlayerConsole();
      else if (args.panel === 'visual-settings' && typeof global.toggleFxPanel === 'function') { global.toggleFxPanel(true); if (typeof global.setFxPanelTab === 'function') global.setFxPanelTab('advanced'); }
      else if (args.panel === 'account' && typeof global.showUserModal === 'function') global.showUserModal();
      else return { ok:false, error:'UI_ACTION_UNAVAILABLE' };
    } else if (name === 'equalizer.preset') {
      var preset = document.querySelector('[data-lf-eq-preset="' + CSS.escape(String(args.preset || 'flat')) + '"]');
      if (!preset) return { ok:false, error:'EQUALIZER_PRESET_UNAVAILABLE' }; preset.click();
    } else if (name === 'control.set') return dispatchControl(document.getElementById(args.id), args.value);
    else if (name === 'control.toggle') return dispatchToggle(args.id, args.enabled);
    else if (name === 'control.choice') return dispatchChoice(args.id, args.value);
    else return { ok:false, error:'ACTION_NOT_ALLOWLISTED' };
    state.actionCount += 1;
    return { ok:true, name:name };
  }
  async function handleNaturalLanguage(text, options) {
    text = String(text || '').trim().slice(0, 800);
    options = options || {};
    if (!text || state.busy || state.disposed) return { ok:false, error:state.busy ? 'AI_BUSY' : 'EMPTY_AI_COMMAND' };
    var bridge = api();
    if (!bridge || typeof bridge.runAIAssistant !== 'function') return { ok:false, error:'AI_MAIN_API_UNAVAILABLE' };
    state.busy = true;
    state.error = '';
    state.status = '正在请求 ' + (state.providers && state.providers[currentProvider()] && state.providers[currentProvider()].label || 'AI') + '…';
    render();
    try {
      var result = await bridge.runAIAssistant({ text:text, source:options.source === 'voice' ? 'voice' : 'text', explicitUserAction:true, context:currentContext() });
      if (!result || result.ok !== true) {
        state.error = errorText(result && result.error);
        return result || { ok:false, error:'AI_REQUEST_FAILED' };
      }
      var actionResults = [];
      for (var index = 0; index < (result.actions || []).length; index += 1) actionResults.push(await executeAction(result.actions[index]));
      state.lastResult = { provider:result.provider, model:result.model, reply:result.reply, actions:result.actions || [], actionResults:actionResults, rejectedActions:result.rejectedActions || [], at:Date.now() };
      state.status = result.reply || (actionResults.length ? '已执行 LF 指令。' : 'AI 已回复。');
      if (result.reply) toast(result.reply);
      return Object.assign({}, result, { actionResults:actionResults });
    } catch (error) {
      state.error = errorText(error && error.message || error);
      return { ok:false, error:String(error && error.message || error || 'AI_REQUEST_FAILED') };
    } finally { state.busy = false; render(); }
  }
  function getDebug() {
    return {
      initialized:!!document.getElementById('lf-ai-provider-settings'),
      disposed:state.disposed,
      scopeHash:state.scopeHash,
      generation:state.generation,
      provider:currentProvider(),
      model:providerSettings(currentProvider()) && providerSettings(currentProvider()).model || '',
      hasKey:Object.assign({}, state.hasKey),
      connection:JSON.parse(JSON.stringify(state.connection || {})),
      busy:state.busy,
      actionCount:state.actionCount,
      controlCatalogSize:currentControlCatalog().length,
      lastResult:state.lastResult,
      keyInputValues:Array.prototype.map.call(document.querySelectorAll('[data-ai-key]'), function (node) { return node.value; }),
      apiKeyInRendererState:false
    };
  }
  function onAuthChange() {
    state.operationSerial += 1;
    state.scopeHash = '';
    state.hasKey = {};
    state.connection = {};
    load();
  }
  function dispose() {
    if (state.disposed) return;
    state.disposed = true;
    state.loadSerial += 1;
    state.operationSerial += 1;
    document.removeEventListener('lumifield-auth-user-change', onAuthChange);
    var root = document.getElementById('lf-ai-provider-settings');
    if (root) root.remove();
    state.settings = null;
    state.providers = null;
    state.hasKey = {};
  }
  function boot() {
    ensureUi();
    document.addEventListener('lumifield-auth-user-change', onAuthChange);
    global.addEventListener('pagehide', dispose, { once:true });
    load();
  }

  global.LumiFieldAIAssistant = Object.freeze({
    version:'1.0.0',
    load:load,
    handleNaturalLanguage:handleNaturalLanguage,
    executeAction:executeAction,
    getDebug:getDebug,
    dispose:dispose
  });
  global.__lumifieldAIAssistantDebug = getDebug;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})(window);
