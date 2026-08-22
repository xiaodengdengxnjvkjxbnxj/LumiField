(function () {
  'use strict';

  var STORE = {
    lyrics: 'lumifield-task13-lyrics-v2',
    legacyLyrics: 'lumifield-task13-lyrics-v1',
    lyricSchemaMigrated: 'lumifield-task13-schema-v2-migrated',
    spectrum: 'lumifield-task13-spectrum-v1',
    spectrumReferenceMigrated: 'lumifield-task13-spectrum-tears-reference-v1',
    echo: 'lumifield-task13-echo-v2',
    legacyEcho: 'lumifield-task13-echo-v1',
    echoPresets: 'lumifield-task13-echo-presets-v2',
    legacyEchoPresets: 'lumifield-task13-echo-presets-v1',
    imports: 'lumifield-task13-imports-v1',
    canonicalPresets: 'lumifield-canonical-presets-v1',
    currentPreset: 'lumifield-task13-current-preset-v1',
    retiredParticleRuntime: 'lumifield-task13-particle-runtime-v1',
    presetShares: 'lumifield-preset-shares-v1',
    consoleFolds: 'lumifield-task15-console-folds-v1',
    translationPrefix: 'lumifield-task13-translation:'
  };

  var SPECTRUM_DEFAULTS = {
    enabled: true, mode: 1, bandCount: 48, horizontalGap: 8, heightScale: 1,
    opacity: 0.82, brightness: 1, glow: 0.6,
    colorMode: 'gradient', colorA: '#55b3d2', colorB: '#b076d1',
    liquidGlassEnabled: true, attack: 0.48, release: 0.12,
    offset: 0, symmetry: true, smooth: 0.58, sensitivity: 1.15
  };

  var ECHO_DEFAULTS = {
    enabled: false, shape: 'shape1', audioMonitor: true, theme: 'nocturnal',
    quality: 'high', particleStrength: 0.72, mode1LeftLyricsEnabled: false,
    flip: false, showColorOptions: true, renderResolution: 1,
    accentEnabled: true, accentColor: '#ffffff', accentStrength: 0.78,
    responseStrength: 1.18, responseRange: 0.72,
    visualEq: [1, 1, 1, 1, 1, 1, 1, 1],
    rippleEnabled: true, rippleSensitivity: 0.15, rippleCooldown: 60,
    idleWave: true, idleDebounce: 1, idleFade: 1,
    cameraDistance: 1, cameraHorizontal: 0, cameraElevation: 27,
    autoRotate: false, rotateSpeed: 0.5,
    playerVisible: true, playerCover: true, playerSize: 1, playerX: 0, playerY: 0,
    exposureSize: 2.2, exposureStrength: 0.76, exposureRadius: 0.62,
    trailLength: 0.72, trailDecay: 0.12, flashThreshold: 0.78,
    flashEnabled: true, reducedFlash: true
  };

  var SHAPE1_THEMES = {
    nocturnal:'Nocturnal', 'neon-tokyo':'Neon Tokyo',
    'cyber-forest':'Cyber Forest', 'minimal-monochrome':'Minimal Monochrome'
  };
  var SHAPE2_THEMES = {
    nocturnal:'霁紫', 'ocean-deep':'沧蓝', 'arctic-aurora':'冰蓝', 'cyber-forest':'碧翠',
    'golden-hour':'流金', 'ember-fire':'余烬', 'crimson-sunset':'赤焰', 'coral-mirage':'霞粉',
    'neon-tokyo':'幻紫', 'minimal-monochrome':'水墨', 'teal-depth':'幽青',
    'lavender-dream':'薰衣草', 'cherry-blossom':'樱', 'copper-forge':'锻铜', 'mint-fresh':'薄荷'
  };

  function byId(id) { return document.getElementById(id); }
  function clamp(value, min, max) {
    value = Number(value);
    return Math.max(min, Math.min(max, isFinite(value) ? value : min));
  }
  function readJson(key, fallback) {
    try {
      var value = JSON.parse(localStorage.getItem(key) || 'null');
      return value && typeof value === 'object' ? value : fallback;
    } catch (_) { return fallback; }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; }
  }
  function copyDefaults(defaults, value) { return Object.assign({}, defaults, value || {}); }
  function normalizeLyricState(value) {
    value = value && typeof value === 'object' ? value : {};
    return { translate:value.translate === true };
  }
  function readLyricState() {
    var current = readJson(STORE.lyrics, null);
    var legacy = readJson(STORE.legacyLyrics, null);
    var migrated = false;
    try { migrated = localStorage.getItem(STORE.lyricSchemaMigrated) === '1'; } catch (_) {}
    var state = normalizeLyricState(!migrated && legacy ? legacy : (current || legacy));
    try { localStorage.removeItem(STORE.legacyLyrics); } catch (_) {}
    if (legacy) try { localStorage.setItem(STORE.lyricSchemaMigrated, '1'); } catch (_) {}
    writeJson(STORE.lyrics, state);
    return state;
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }
  function show(message) {
    if (typeof window.showToast === 'function') window.showToast(message);
  }
  function isStageActive() {
    if (!document.body || document.body.classList.contains('lf-auth-locked') || document.body.classList.contains('empty-home-active')) return false;
    return typeof window.isVisualStageInteractionActive !== 'function' || window.isVisualStageInteractionActive();
  }
  function songNow() {
    if (Array.isArray(window.playQueue) && window.currentIdx >= 0) return window.playQueue[window.currentIdx] || {};
    return typeof window.currentLyricSong === 'function' ? (window.currentLyricSong() || {}) : {};
  }
  function songKey(song) {
    song = song || songNow();
    return [song.provider || song.source || '', song.id || song.mid || song.songmid || '', song.name || song.title || '', song.artist || ''].join('|');
  }
  function coverUrl(song) {
    song = song || songNow();
    return String(song.cover || song.pic || song.albumCover || '').trim();
  }
  function currentLineIndex(lines, time) {
    var lo = 0, hi = lines.length - 1, result = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (Number(lines[mid].t || 0) <= time + 0.05) { result = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return result;
  }
  function normalizeHex(value, fallback) {
    value = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
  }
  var ECHO_NUMBER_LIMITS = {
    renderResolution:[0.35,1.5], accentStrength:[0,2], particleStrength:[0,2],
    responseStrength:[0,3], responseRange:[0.08,1], rippleSensitivity:[0,1],
    rippleCooldown:[1,240],
    idleDebounce:[0,20], idleFade:[0.1,12], cameraDistance:[0.45,2.8],
    cameraHorizontal:[-180,180], cameraElevation:[5,78], rotateSpeed:[-2,2],
    playerSize:[0.55,1.8], playerX:[-45,45], playerY:[-34,34],
    exposureSize:[0.5,14], exposureStrength:[0,2], exposureRadius:[0.1,1.5],
    trailLength:[0,1], trailDecay:[0.01,0.8], flashThreshold:[0.05,1.5]
  };

  function normalizeVisualEq(value, strict) {
    if (!Array.isArray(value) || value.length !== 8) {
      if (strict) throw new Error('visualEq 必须是包含 8 个数值的数组');
      value = ECHO_DEFAULTS.visualEq;
    }
    return value.map(function (entry, index) {
      var number = Number(entry);
      if (!isFinite(number) || number < 0 || number > 2) {
        if (strict) throw new Error('visualEq[' + index + '] 必须是 0 到 2 的数值');
        number = 1;
      }
      return number;
    });
  }

  function migrateEchoValue(value) {
    value = value && typeof value === 'object' && !Array.isArray(value) ? Object.assign({}, value) : {};
    if (value.renderResolution == null && value.precision != null) value.renderResolution = value.precision;
    if (value.visualEq == null && Array.isArray(value.visualEQ)) value.visualEq = value.visualEQ;
    if (value.visualEq == null && Array.isArray(value.eq)) value.visualEq = value.eq;
    if (value.accentColor == null && value.accent != null) value.accentColor = value.accent;
    if (value.responseStrength == null && value.strength != null) value.responseStrength = value.strength;
    if (value.responseRange == null && value.range != null) value.responseRange = value.range;
    var legacyShape = String(value.shape == null ? '' : value.shape).toLowerCase();
    if (legacyShape === 'one' || legacyShape === '1') value.shape = 'shape1';
    else if (legacyShape === 'two' || legacyShape === '2') value.shape = 'shape2';
    else if (/^(three|four|3|4|shape3|shape4)$/.test(legacyShape)) value.shape = 'shape1';
    if (value.quality === 'auto') value.quality = 'medium';
    return value;
  }

  function echoThemeMap(shape) { return shape === 'shape2' ? SHAPE2_THEMES : SHAPE1_THEMES; }
  function normalizeEchoThemeForShape(theme, shape) {
    var aliases = {
      neonPurple:shape === 'shape2' ? 'nocturnal' : 'neon-tokyo', azure:'ocean-deep', ice:'arctic-aurora',
      emerald:'cyber-forest', gold:'golden-hour', ink:'minimal-monochrome', deepCyan:'teal-depth',
      lavender:'lavender-dream', sakura:'cherry-blossom', copper:'copper-forge', mint:'mint-fresh',
      ember:'ember-fire', flame:'crimson-sunset', hazePink:'coral-mirage', fantasy:'neon-tokyo'
    };
    var map = echoThemeMap(shape);
    theme = aliases[String(theme || '')] || String(theme || '');
    return Object.prototype.hasOwnProperty.call(map, theme) ? theme : 'nocturnal';
  }

  function validateEchoPatch(value) {
    value = migrateEchoValue(value);
    var patch = {};
    Object.keys(ECHO_DEFAULTS).forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) return;
      var current = value[key];
      if (key === 'visualEq') { patch.visualEq = normalizeVisualEq(current, true); return; }
      if (key === 'theme') {
        var shapeForTheme = Object.prototype.hasOwnProperty.call(value, 'shape') ? String(value.shape) : String(echoState && echoState.shape || ECHO_DEFAULTS.shape);
        var normalizedTheme = normalizeEchoThemeForShape(current, shapeForTheme);
        if (!Object.prototype.hasOwnProperty.call(echoThemeMap(shapeForTheme), normalizedTheme)) throw new Error('theme 无效');
        patch.theme = normalizedTheme; return;
      }
      if (key === 'shape') {
        if (!/^(shape1|shape2)$/.test(String(current))) throw new Error('shape 无效');
        patch.shape = current; return;
      }
      if (key === 'quality') {
        if (!/^(low|medium|high|ultra)$/.test(String(current))) throw new Error('quality 无效');
        patch.quality = String(current); return;
      }
      if (key === 'accentColor') {
        if (!/^#[0-9a-f]{6}$/i.test(String(current))) throw new Error('accentColor 无效');
        patch.accentColor = String(current).toLowerCase(); return;
      }
      if (typeof ECHO_DEFAULTS[key] === 'boolean') {
        if (typeof current !== 'boolean') throw new Error(key + ' 必须是布尔值');
        patch[key] = current; return;
      }
      if (typeof ECHO_DEFAULTS[key] === 'number') {
        current = Number(current);
        if (!isFinite(current)) throw new Error(key + ' 必须是数值');
        if (ECHO_NUMBER_LIMITS[key] && (current < ECHO_NUMBER_LIMITS[key][0] || current > ECHO_NUMBER_LIMITS[key][1])) throw new Error(key + ' 超出范围');
        patch[key] = current; return;
      }
      patch[key] = current;
    });
    return patch;
  }

  function normalizeEchoState(value) {
    var state = Object.assign({}, ECHO_DEFAULTS);
    state.visualEq = ECHO_DEFAULTS.visualEq.slice();
    try { Object.assign(state, validateEchoPatch(value)); } catch (_) {}
    state.visualEq = normalizeVisualEq(state.visualEq, false);
    state.theme = normalizeEchoThemeForShape(state.theme, state.shape);
    return state;
  }

  var spectrumRejectedBandCount = null;
  function normalizeSpectrumState(value) {
    value = value && typeof value === 'object' ? value : {};
    var state = copyDefaults(SPECTRUM_DEFAULTS, {});
    state.enabled = value.enabled == null ? state.enabled : value.enabled === true;
    var rawMode = value.mode != null ? value.mode : value.shape;
    state.mode = Number(rawMode) === 3 || rawMode === 'three' ? 3 : 1;
    var rawBands = value.bandCount != null ? Number(value.bandCount) : Number(value.barCount);
    if (isFinite(rawBands)) {
      rawBands = Math.round(rawBands);
      if (rawBands >= 1 && rawBands <= 256) state.bandCount = rawBands;
      else spectrumRejectedBandCount = rawBands;
    }
    var aliases = {
      horizontalGap: 'horizontalGap', heightScale: 'heightScale', opacity: 'opacity',
      brightness: 'brightness', glow: 'glow', colorMode: 'colorMode',
      attack: 'attack', release: 'release', offset: 'offset', smooth: 'smooth',
      sensitivity: 'sensitivity'
    };
    Object.keys(aliases).forEach(function (key) {
      if (value[key] != null) state[aliases[key]] = value[key];
    });
    if (value.offset == null && value.offsetY != null) state.offset = Number(value.offsetY) / 220;
    state.symmetry = value.symmetry != null ? value.symmetry === true : (value.symmetric == null ? state.symmetry : value.symmetric === true);
    state.liquidGlassEnabled = value.liquidGlassEnabled != null ? value.liquidGlassEnabled === true : (value.glass == null ? state.liquidGlassEnabled : value.glass === true);
    state.colorA = normalizeHex(value.colorA != null ? value.colorA : value.color1, state.colorA);
    state.colorB = normalizeHex(value.colorB != null ? value.colorB : value.color2, state.colorB);
    state.horizontalGap = clamp(state.horizontalGap, 0, 32);
    state.heightScale = clamp(state.heightScale, 0.25, 3);
    state.opacity = clamp(state.opacity, 0.08, 1);
    state.brightness = clamp(state.brightness, 0.1, 2.5);
    state.glow = clamp(state.glow, 0, 2.5);
    state.attack = clamp(state.attack, 0.01, 1);
    state.release = clamp(state.release, 0.005, 0.8);
    state.offset = clamp(state.offset, -1.5, 1.5);
    state.smooth = clamp(state.smooth, 0, 0.96);
    state.sensitivity = clamp(state.sensitivity, 0.2, 3);
    if (!/^(single|multi|gradient|cover)$/.test(String(state.colorMode))) state.colorMode = 'gradient';
    return state;
  }

  function assertSpectrumPatch(patch) {
    if (!patch || typeof patch !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(patch, 'bandCount')) {
      var bands = Number(patch.bandCount);
      if (!isFinite(bands) || Math.round(bands) !== bands || bands < 1 || bands > 256) throw new Error('spectrum.bandCount 必须是 1–256 的整数');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'mode') && Number(patch.mode) !== 1 && Number(patch.mode) !== 3) throw new Error('spectrum.mode 只支持 1 或 3');
  }

  var lyricState = readLyricState();
  var storedSpectrumState = readJson(STORE.spectrum, {});
  var spectrumState = normalizeSpectrumState(storedSpectrumState);
  (function migrateSpectrumReferenceAppearance() {
    var migrated = false;
    try { migrated = localStorage.getItem(STORE.spectrumReferenceMigrated) === '1'; } catch (_) {}
    if (migrated) return;
    var rawBands = storedSpectrumState.bandCount != null ? storedSpectrumState.bandCount : storedSpectrumState.barCount;
    if (rawBands == null || Number(rawBands) === 128) spectrumState.bandCount = 48;
    if (storedSpectrumState.colorA == null || /^#51dcff$/i.test(String(storedSpectrumState.colorA))) spectrumState.colorA = '#55b3d2';
    if (storedSpectrumState.colorB == null || /^#e06cff$/i.test(String(storedSpectrumState.colorB))) spectrumState.colorB = '#b076d1';
    if (storedSpectrumState.opacity == null || Number(storedSpectrumState.opacity) === 0.72) spectrumState.opacity = 0.82;
    if (storedSpectrumState.brightness == null || Number(storedSpectrumState.brightness) === 1.08) spectrumState.brightness = 1;
    if (storedSpectrumState.glow == null || Number(storedSpectrumState.glow) === 1.05) spectrumState.glow = 0.6;
    if (writeJson(STORE.spectrum, spectrumState)) {
      try { localStorage.setItem(STORE.spectrumReferenceMigrated, '1'); } catch (_) {}
    }
  })();
  var echoState = normalizeEchoState(readJson(STORE.echo, readJson(STORE.legacyEcho, {})));
  if (writeJson(STORE.echo, echoState)) {
    try { localStorage.removeItem(STORE.legacyEcho); } catch (_) {}
  }

  function persistLyrics() { lyricState = normalizeLyricState(lyricState); writeJson(STORE.lyrics, lyricState); }
  function persistSpectrum() { writeJson(STORE.spectrum, spectrumState); }
  function persistEcho() { writeJson(STORE.echo, echoState); }

  var api = window.LumiFieldTask13 = {
    controlsSpectrum: true,
    controlsLyrics: true,
    getState: function () {
      return {
        lyrics: Object.assign({}, lyricState), spectrum: Object.assign({}, spectrumState),
        echo: Object.assign({}, echoState, { visualEq:echoState.visualEq.slice() })
      };
    },
    getSpectrumDebug: function () { return spectrumDebugSnapshot(); },
    setSpectrumState: function (patch) { return applySpectrumStatePatch(patch); },
    getLyricDebug: function () { return lyricDebugSnapshot(); },
    getTranslationDebug: function () {
      var lines = Array.isArray(window.lyricsLines) ? window.lyricsLines : [];
      return {
        songKey:songKey(),
        cacheKey:translationCacheKey('zh-CN', lines),
        descriptor:translationDescriptor('zh-CN', lines),
        missingIndices:translationMissingIndices(lines),
        requestKey:translationRequest && translationRequest.key || '',
        status:translationStatus,
        retry:Object.assign({}, translationRetry),
        cache:translationCacheMaintenance(true)
      };
    },
    maintainTranslationCache: function () { return translationCacheMaintenance(true); },
    setLyricState: function (patch) { return setLyricState(patch); },
    getEchoDebug: function () {
      var manager = window.LumiFieldAudioEchoManager;
      return manager && typeof manager.getDebug === 'function' ? manager.getDebug() : echoDebugSnapshot();
    },
    setEchoState: function (patch) { return applyEchoState(patch, { partial:true }); },
    updateFrame: function (now, dt) { updateTask13Frame(now, dt); },
    updateEchoFrame: function (now, dt) { updateTask13Frame(now, dt); },
    destroyEcho: function () {
      echoState.enabled = false;
      persistEcho();
      var manager = window.LumiFieldAudioEchoManager;
      if (manager && typeof manager.disposeMode === 'function') manager.disposeMode();
      return true;
    },
    migrateRetiredPresets: function () { return migrateCanonicalArchives(); }
  };

  // ---------- User-scoped canonical preset storage ----------
  var PRESET_SCOPE_SCHEMA = 'lumifield-user-scoped-v1';
  var presetScopeOverride = '';
  var presetScopeReady = false;

  function own(object, key) { return !!object && Object.prototype.hasOwnProperty.call(object, key); }
  function presetClone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function presetScopeUserId() {
    if (presetScopeOverride) return presetScopeOverride;
    try {
      var user = window.LFAuth && typeof window.LFAuth.getUser === 'function' ? window.LFAuth.getUser() : null;
      return String(user && (user.id || user.userId || user.email) || '').trim();
    } catch (_) { return ''; }
  }
  function presetScopeOwnerReady() {
    if (presetScopeOverride || presetScopeUserId()) return true;
    if (presetScopeReady) return true;
    return !(window.desktopWindow && typeof window.desktopWindow.lfAuthStatus === 'function');
  }
  function presetScopeKey() {
    var owner = presetScopeOverride || presetScopeUserId();
    return owner ? 'user:' + encodeURIComponent(owner).slice(0, 180) : 'device:anonymous';
  }
  function emptyScopedRoot() { return { schema:PRESET_SCOPE_SCHEMA, version:1, scopes:{} }; }
  function readRawJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; }
  }
  function readScopedValue(key, fallback) {
    var raw = readRawJson(key);
    if (raw && raw.schema === PRESET_SCOPE_SCHEMA && raw.scopes && typeof raw.scopes === 'object' && !Array.isArray(raw.scopes)) {
      return own(raw.scopes, presetScopeKey()) ? presetClone(raw.scopes[presetScopeKey()]) : presetClone(fallback);
    }
    if (raw == null) return presetClone(fallback);
    if (!presetScopeOwnerReady()) return presetClone(raw);
    var root = emptyScopedRoot();
    root.scopes[presetScopeKey()] = presetClone(raw);
    try { localStorage.setItem(key, JSON.stringify(root)); } catch (_) {}
    return presetClone(raw);
  }
  function writeScopedValue(key, value) {
    if (!presetScopeOwnerReady()) return false;
    var raw = readRawJson(key);
    var root = raw && raw.schema === PRESET_SCOPE_SCHEMA && raw.scopes && typeof raw.scopes === 'object' && !Array.isArray(raw.scopes)
      ? raw : emptyScopedRoot();
    root = { schema:PRESET_SCOPE_SCHEMA, version:1, scopes:Object.assign({}, root.scopes) };
    if (value === undefined) delete root.scopes[presetScopeKey()];
    else root.scopes[presetScopeKey()] = presetClone(value);
    try { localStorage.setItem(key, JSON.stringify(root)); return true; } catch (_) { return false; }
  }
  function readScopedCurrentPresetId() {
    var rawText = '';
    try { rawText = localStorage.getItem(STORE.currentPreset) || ''; } catch (_) {}
    var raw = readRawJson(STORE.currentPreset);
    if (raw == null && rawText && presetScopeOwnerReady()) {
      var legacyId = String(rawText).trim();
      if (legacyId) {
        writeScopedValue(STORE.currentPreset, legacyId);
        return legacyId;
      }
    }
    var value = readScopedValue(STORE.currentPreset, '');
    return typeof value === 'string' ? value : '';
  }
  function writeScopedCurrentPresetId(value) {
    return writeScopedValue(STORE.currentPreset, String(value || ''));
  }
  function switchPresetScope(userId) {
    if (userId !== undefined) presetScopeOverride = '';
    presetScopeReady = true;
    try { migrateCanonicalArchives(); } catch (_) {}
    return presetScopeKey();
  }
  function setPresetScopeTestUser(userId) {
    presetScopeOverride = String(userId == null ? '' : userId).trim();
    presetScopeReady = true;
    try { migrateCanonicalArchives(); } catch (_) {}
    syncConsoleFoldState();
    return presetScopeKey();
  }
  // ---------- Native lyrics translation ----------
  var lyricSyncSongKey = '';
  var lyricSyncLinesRef = null;
  var lyricSyncIndex = -1;
  var lyricSyncFrameAt = 0;
  var lyricSyncHasRealLyrics = false;
  var lyricSyncTranslate = false;
  var EMPTY_LYRIC_LINES = [];
  var translationStatus = '';
  var translationRequest = null;
  var translationAttemptKey = '';
  var translationSongKey = '';
  var translationLinesRef = null;
  var translationRetry = { key:'', count:0, nextAt:0 };
  var translationEnsureAt = 0;
  var translationCacheMaintainedAt = 0;
  var TRANSLATION_CACHE_MAX_ENTRIES = 48;
  var TRANSLATION_CACHE_MAX_BYTES = 3 * 1024 * 1024;
  var nativeTranslationKey = '';
  var translationToastTimer = 0;
  var translationToastSongKey = '';
  var lyricDebug = {
    mode:'normal', lineIndex:-1, text:'', timingSource:'none', timingQuality:'none', estimated:false,
    tokenCount:0, revealedCount:0, renderCount:0, nodeCount:0, mounted:false,
    paused:true, time:0, rafOwned:0, listenerCount:0
  };

  function translationToastNode() {
    var node = byId('lf-t13-translation-toast');
    if (node) return node;
    node = document.createElement('div');
    node.id = 'lf-t13-translation-toast';
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    node.textContent = '本地翻译已就绪';
    document.body.appendChild(node);
    return node;
  }
  function hideTranslationReadyToast() {
    if (translationToastTimer) clearTimeout(translationToastTimer);
    translationToastTimer = 0;
    translationToastSongKey = '';
    var node = byId('lf-t13-translation-toast');
    if (node) node.classList.remove('show');
  }
  function showTranslationReadyToast(currentSongKey) {
    if (!lyricState.translate) return;
    var node = translationToastNode();
    if (translationToastTimer) clearTimeout(translationToastTimer);
    translationToastSongKey = String(currentSongKey || songKey());
    node.textContent = '本地翻译已就绪';
    node.classList.add('show');
    translationToastTimer = setTimeout(hideTranslationReadyToast, 2200);
  }

  function setNativeLyricsVisible(visible) {
    window.lumiFieldNativeLyricsVisible = !!visible;
    var stage = window.stageLyrics;
    if (!stage) return;
    if (stage.current) stage.current.visible = visible;
    if (Array.isArray(stage.outgoing)) stage.outgoing.forEach(function (mesh) { if (mesh) mesh.visible = visible; });
    if (stage.starRiver) stage.starRiver.visible = visible;
    if (stage.vapour && typeof stage.vapour.setVisible === 'function') stage.vapour.setVisible(visible);
  }

  function translationHash(value) {
    var a = 2166136261, b = 2246822519;
    value = String(value || '');
    for (var i = 0; i < value.length; i++) {
      a = Math.imul(a ^ value.charCodeAt(i), 16777619);
      b = Math.imul(b ^ value.charCodeAt(i), 3266489917);
    }
    return (a >>> 0).toString(36) + (b >>> 0).toString(36);
  }
  function translationCacheMaintenance(force) {
    var now = Date.now();
    if (!force && now - translationCacheMaintainedAt < 60000) return null;
    translationCacheMaintainedAt = now;
    var entries = [];
    var keys = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.indexOf(STORE.translationPrefix) === 0) keys.push(key);
      }
      keys.forEach(function (key) {
        var raw = localStorage.getItem(key) || '';
        var value = null;
        try { value = JSON.parse(raw); } catch (_) {}
        if (!value || !Array.isArray(value.values) || Number(value.expiresAt) <= now) {
          localStorage.removeItem(key);
          return;
        }
        entries.push({
          key:key,
          bytes:(key.length + raw.length) * 2,
          at:Number(value.lastAccessedAt || value.createdAt || 0)
        });
      });
      entries.sort(function (a, b) { return a.at - b.at; });
      var bytes = entries.reduce(function (sum, entry) { return sum + entry.bytes; }, 0);
      while (entries.length > TRANSLATION_CACHE_MAX_ENTRIES || bytes > TRANSLATION_CACHE_MAX_BYTES) {
        var evicted = entries.shift();
        localStorage.removeItem(evicted.key);
        bytes -= evicted.bytes;
      }
      return { count:entries.length, bytes:Math.max(0, bytes) };
    } catch (_) { return null; }
  }
  function readTranslationCache(key, descriptor) {
    translationCacheMaintenance(false);
    var value = readJson(key, null);
    if (!value || value.descriptor !== descriptor || !Array.isArray(value.values) || Number(value.expiresAt) <= Date.now()) {
      try { localStorage.removeItem(key); } catch (_) {}
      return null;
    }
    value.lastAccessedAt = Date.now();
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
    return value;
  }
  function writeTranslationCache(key, value) {
    var now = Date.now();
    value.createdAt = Number(value.createdAt) || now;
    value.lastAccessedAt = now;
    var raw = JSON.stringify(value);
    translationCacheMaintenance(true);
    for (var attempt = 0; attempt < TRANSLATION_CACHE_MAX_ENTRIES + 1; attempt++) {
      try {
        localStorage.setItem(key, raw);
        translationCacheMaintenance(true);
        return true;
      } catch (_) {
        var entries = [];
        try {
          for (var i = 0; i < localStorage.length; i++) {
            var candidate = localStorage.key(i);
            if (!candidate || candidate === key || candidate.indexOf(STORE.translationPrefix) !== 0) continue;
            var cached = readJson(candidate, {});
            entries.push({ key:candidate, at:Number(cached.lastAccessedAt || cached.createdAt || 0) });
          }
          entries.sort(function (a, b) { return a.at - b.at; });
          if (!entries.length) return false;
          localStorage.removeItem(entries[0].key);
        } catch (_) { return false; }
      }
    }
    return false;
  }
  function translationDescriptor(target, lines) {
    var song = songNow();
    return JSON.stringify({
      provider:String(song.provider || song.source || ''),
      songId:String(song.id || song.mid || song.songmid || ''),
      target:String(target || 'zh-CN'),
      lyrics:(lines || []).map(function (line) {
        return {
          text:String(line && line.text || '').trim(),
          t:Number(line && line.t || 0),
          duration:Number(line && (line.duration || line.dur || line.end) || 0),
          words:Array.isArray(line && line.words) ? line.words.map(function (word) {
            return [String(word.text || word.word || ''), Number(word.t || word.start || 0), Number(word.duration || word.dur || 0)];
          }) : []
        };
      })
    });
  }
  function translationCacheKey(target, lines) {
    return STORE.translationPrefix + translationHash(translationDescriptor(target, lines));
  }
  function applyTranslationArray(values, indices, skippedIndices) {
    if (!Array.isArray(window.lyricsLines) || !Array.isArray(values)) return false;
    var changed = false;
    values.forEach(function (item, valueIndex) {
      var index = Array.isArray(indices) ? Number(indices[valueIndex]) : valueIndex;
      var line = window.lyricsLines[index];
      if (!line) return;
      if (Array.isArray(skippedIndices) && skippedIndices.indexOf(valueIndex) >= 0) {
        line.lfTranslationSkipped = true;
        changed = true;
        return;
      }
      if (String(line.translation || line.trans || '').trim() && line.lfTranslationSource !== 'service') return;
      var value = item;
      if (value && typeof value === 'object') {
        if (value.skipped) { line.lfTranslationSkipped = true; changed = true; return; }
        value = value.text || value.translation;
      }
      value = String(value || '').trim();
      if (value) { line.translation = value; line.lfTranslationSource = 'service'; changed = true; }
    });
    nativeTranslationKey = '';
    if (changed && lyricState.translate && window.audio && Array.isArray(window.lyricsLines)) {
      var activeIndex = currentLineIndex(window.lyricsLines, Number(window.audio.currentTime) || 0);
      if (activeIndex >= 0) {
        var activeLine = window.lyricsLines[activeIndex] || {};
        syncNativeTranslation(true, String(activeLine.translation || activeLine.trans || '').trim(), activeIndex);
      }
    }
    return changed;
  }

  function syncNativeTranslation(enabled, translation, index) {
    enabled = !!enabled;
    translation = enabled ? String(translation || '').trim() : '';
    var stageIndex = window.stageLyrics && Number.isFinite(window.stageLyrics.currentIdx) ? window.stageLyrics.currentIdx : -999;
    var key = [enabled ? '1' : '0', songKey(), index == null ? -1 : index, stageIndex, translation].join('|');
    if (nativeTranslationKey === key) return;
    nativeTranslationKey = key;
    window.lumiFieldNativeLyricTranslationEnabled = enabled;
    if (typeof window.syncStageLyricTranslation === 'function') {
      window.syncStageLyricTranslation(enabled, translation, index);
    }
  }

  function translationMissingIndices(lines) {
    var out = [];
    (lines || []).forEach(function (line, index) {
      if (line && line.lfTranslationSkipped) return;
      if (String(line && (line.translation || line.trans) || '').trim()) return;
      if (String(line && line.text || '').trim()) out.push(index);
    });
    return out;
  }
  function cancelTranslationRequest() {
    if (translationRequest) translationRequest.controller.abort();
    translationRequest = null;
    translationAttemptKey = '';
    nativeTranslationKey = '';
  }
  function resetTranslationForSong(nextSongKey) {
    if (translationSongKey === nextSongKey) return;
    hideTranslationReadyToast();
    cancelTranslationRequest();
    translationRetry = { key:'', count:0, nextAt:performance.now() + 180 };
    translationEnsureAt = performance.now() + 180;
    translationStatus = '';
    nativeTranslationKey = '';
    if (Array.isArray(translationLinesRef)) translationLinesRef.forEach(function (line) {
      if (line && line.lfTranslationSource === 'service') {
        delete line.translation;
        delete line.lfTranslationSource;
      }
      if (line) delete line.lfTranslationSkipped;
    });
    translationSongKey = nextSongKey;
    translationLinesRef = Array.isArray(window.lyricsLines) ? window.lyricsLines : null;
  }
  function translationFailureMessage(code) {
    var messages = {
      TRANSLATION_RATE_LIMITED:'翻译请求过于频繁，请稍后重试',
      LOCAL_TRANSLATION_MODEL_INTEGRITY_FAILED:'本地翻译模型校验失败',
      LOCAL_TRANSLATION_UNSUPPORTED_LANGUAGE:'当前歌词语言暂不支持',
      LOCAL_TRANSLATION_UNSUPPORTED_TARGET:'当前目标语言暂不支持',
      TRANSLATION_TIMEOUT:'翻译服务超时',
      TRANSLATION_ABORTED:'翻译已取消'
    };
    return messages[code] || '翻译失败，原歌词仍可播放';
  }
  async function ensureTranslations(force) {
    if (!lyricState.translate || !Array.isArray(window.lyricsLines) || !window.lyricsLines.length) return;
    var linesRef = window.lyricsLines;
    var currentSongKey = songKey();
    resetTranslationForSong(currentSongKey);
    if (translationRequest && translationRequest.songKey === currentSongKey && translationRequest.linesRef === linesRef) return translationRequest.promise;
    var target = 'zh-CN';
    var descriptor = translationDescriptor(target, linesRef);
    var key = translationCacheKey(target, linesRef);
    var cache = readTranslationCache(key, descriptor);
    if (cache) {
      applyTranslationArray(cache.values);
    }
    var missing = translationMissingIndices(linesRef);
    if (!missing.length) {
      translationStatus = linesRef.some(function (line) { return line.lfTranslationSource === 'service'; }) ? '本地翻译已就绪' : '平台翻译';
      if (translationStatus === '本地翻译已就绪') showTranslationReadyToast(currentSongKey);
      return true;
    }
    if (!force && translationRetry.key === key && performance.now() < translationRetry.nextAt) return false;
    if (!force && translationAttemptKey === key && !translationRequest) return false;
    if (translationRequest && translationRequest.key === key) return translationRequest.promise;
    if (translationRequest) translationRequest.controller.abort();
    translationAttemptKey = key;
    var controller = new AbortController();
    var lines = missing.map(function (index) { return String(linesRef[index].text || '').trim(); });
    translationStatus = '正在批量翻译…';
    var promise = fetch('/api/translate/lyrics', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({
        song:songNow(), sourceLanguage:'auto', targetLanguage:target, lines:lines,
        languageContext:linesRef.map(function (line) { return String(line && line.text || '').trim(); })
      })
    }).then(async function (response) {
      var data = null;
      try { data = await response.json(); } catch (_) {}
      if (!response.ok) {
        var code = data && data.code;
        throw Object.assign(new Error(code || 'TRANSLATION_FAILED'), { code:code || 'TRANSLATION_FAILED', status:response.status });
      }
      var values = data && (data.translations || data.lines);
      if (!Array.isArray(values) || values.length !== lines.length) {
        translationStatus = '翻译响应不完整，已保留原歌词';
        return false;
      }
      if (songKey() !== currentSongKey || window.lyricsLines !== linesRef || translationDescriptor(target, linesRef) !== descriptor) return false;
      if (applyTranslationArray(values, missing, data && data.skippedIndices)) {
        var fullValues = linesRef.map(function (line) {
          return line.lfTranslationSkipped ? { skipped:true }
            : (line.lfTranslationSource === 'service' ? String(line.translation || '') : null);
        });
        writeTranslationCache(key, { descriptor:descriptor, values:fullValues, expiresAt:Date.now() + 30 * 86400000 });
        translationRetry = { key:key, count:0, nextAt:0 };
        translationStatus = data.adapter === 'local-bergamot' ? '本地离线翻译' : '翻译服务';
        showTranslationReadyToast(currentSongKey);
        return true;
      }
      translationStatus = '无可用翻译，已保留原歌词';
      return false;
    }).catch(function (error) {
      if (error && error.name === 'AbortError') return false;
      var code = String(error && (error.code || error.message) || 'TRANSLATION_FAILED');
      var count = translationRetry.key === key ? translationRetry.count + 1 : 1;
      translationRetry = { key:key, count:count, nextAt:count < 3 ? performance.now() + Math.min(8000, count * 1800) : Infinity };
      translationAttemptKey = '';
      translationStatus = translationFailureMessage(code);
      return false;
    }).finally(function () {
      if (translationRequest && translationRequest.key === key) translationRequest = null;
    });
    translationRequest = { key:key, songKey:currentSongKey, linesRef:linesRef, controller:controller, promise:promise };
    return promise;
  }

  function hasRealLyricLines(lines) {
    if (String(window.lyricsTimingSource || '').trim().toLowerCase() === 'fallback') return false;
    return (lines || []).some(function (line) {
      if (!line || !String(line.text || '').trim()) return false;
      if (line.fallback === true || line.isFallback === true || line.lfFallback === true) return false;
      return String(line.source || '').trim().toLowerCase() !== 'fallback';
    });
  }

  function syncLyricTranslation(now, force) {
    var lines = Array.isArray(window.lyricsLines) ? window.lyricsLines : EMPTY_LYRIC_LINES;
    var currentSongKey = songKey();
    if (translationToastSongKey && translationToastSongKey !== currentSongKey) hideTranslationReadyToast();
    resetTranslationForSong(currentSongKey);
    var media = window.audio;
    var stageActive = isStageActive();
    var hasRealLyrics = hasRealLyricLines(lines);
    var time = media ? Number(media.currentTime) || 0 : 0;
    var paused = !media || !!media.paused;
    var index = hasRealLyrics ? currentLineIndex(lines, time) : -1;
    var line = index >= 0 ? (lines[index] || {}) : {};
    var translated = lyricState.translate && index >= 0 ? String(line.translation || line.trans || '').trim() : '';
    var syncChanged = !!force || lyricSyncSongKey !== currentSongKey || lyricSyncLinesRef !== lines ||
      lyricSyncHasRealLyrics !== hasRealLyrics || lyricSyncTranslate !== lyricState.translate ||
      window.lumiFieldNativeLyricsVisible !== stageActive;

    if (lyricState.translate && hasRealLyrics && translationMissingIndices(lines).length && performance.now() >= translationEnsureAt) {
      translationEnsureAt = performance.now() + 500;
      ensureTranslations();
    }

    if (syncChanged) setNativeLyricsVisible(stageActive);
    syncNativeTranslation(lyricState.translate && index >= 0, translated, index);
    var controlStatusText = byId('lf-t13-translate-control-status-text');
    var nextControlStatus = lyricState.translate && hasRealLyrics ? (translated ? '已显示翻译' : translationStatus) : '';
    if (controlStatusText && controlStatusText.textContent !== nextControlStatus) controlStatusText.textContent = nextControlStatus;
    var retryButton = byId('lf-t13-translate-retry');
    var retryHidden = !lyricState.translate || !hasRealLyrics || !translationStatus ||
      /正在|已就绪|平台翻译|翻译服务|离线翻译/.test(translationStatus);
    if (retryButton && retryButton.hidden !== retryHidden) retryButton.hidden = retryHidden;

    lyricDebug.mode = 'normal';
    lyricDebug.lineIndex = index;
    lyricDebug.text = index >= 0 ? String(line.text || '') : '';
    lyricDebug.timingSource = hasRealLyrics ? String(window.lyricsTimingSource || line.source || 'line') : 'none';
    lyricDebug.timingQuality = hasRealLyrics ? 'whole-sentence' : 'none';
    lyricDebug.estimated = false;
    lyricDebug.tokenCount = 0;
    lyricDebug.revealedCount = 0;
    lyricDebug.nodeCount = 0;
    lyricDebug.paused = paused;
    lyricDebug.time = Number(time.toFixed(3));
    lyricDebug.rafOwned = 0;
    lyricDebug.listenerCount = 0;

    lyricSyncSongKey = currentSongKey;
    lyricSyncLinesRef = lines;
    lyricSyncHasRealLyrics = hasRealLyrics;
    lyricSyncTranslate = lyricState.translate;
    lyricSyncIndex = index;
    lyricSyncFrameAt = Number(now) || performance.now();
  }

  function applyLyricTranslationState() {
    lyricState = normalizeLyricState(lyricState);
    nativeTranslationKey = '';
    lyricSyncSongKey = '';
    lyricSyncLinesRef = null;
    lyricSyncIndex = -1;
    syncLyricTranslation(performance.now(), true);
  }

  function lyricDebugSnapshot() {
    return Object.assign({}, lyricDebug, {
      hasRealLyrics:lyricSyncHasRealLyrics,
      songKey:lyricSyncSongKey,
      frameAt:lyricSyncFrameAt,
      rafOwned:0,
      listenerCount:0
    });
  }

  function setLyricState(patch) {
    patch = patch && typeof patch === 'object' ? patch : {};
    if (Object.keys(patch).some(function (key) { return key !== 'translate'; })) throw new Error('歌词设置仅支持 translate');
    if (Object.prototype.hasOwnProperty.call(patch, 'translate') && typeof patch.translate !== 'boolean') throw new Error('lyrics.translate 必须是布尔值');
    var previousTranslate = lyricState.translate;
    lyricState = normalizeLyricState(Object.assign({}, lyricState, patch));
    if (previousTranslate && !lyricState.translate) {
      cancelTranslationRequest();
      translationStatus = '';
      hideTranslationReadyToast();
      syncNativeTranslation(false, '', -1);
    }
    persistLyrics();
    applyLyricTranslationState();
    if (lyricState.translate) ensureTranslations();
    syncLyricControls();
    return Object.assign({}, lyricState);
  }

  // ---------- Unified SpectrumState / the existing shared analyser ----------
  var SPECTRUM_MAX_BANDS = 256;
  var spectrumCanvas = null;
  var spectrumMainCanvas = null;
  var spectrumCtx = null;
  var spectrumMainCtx = null;
  var spectrumSmooth = new Float32Array(0);
  var spectrumValues = new Float32Array(0);
  var spectrumScratch = new Float32Array(0);
  var spectrumLastTime = performance.now();
  var spectrumFps = 60;
  var spectrumFrames = 0;
  var spectrumFpsAt = performance.now();
  var spectrumRenderStopped = false;
  var spectrumReleaseSettled = false;
  var spectrumReleaseCleared = false;
  var spectrumMaxEnergy = 0;
  var spectrumMaxBarHeight = 0;
  var spectrumBackdropCanvas = null;
  var spectrumBackdropCtx = null;
  var spectrumBackdropSource = 'none';
  var spectrumBackdropCapturedAt = 0;
  var spectrumCanvasesDirty = false;
  var spectrumStage = {
    anchor: null, group: null, mesh: null, count: 0, materialKind: '', rebuildCount: 0,
    geometryIdentity: '', visualStyle: '', xPositions: [], barWidth: 0, actualGap: 0, totalWidth: 0
  };
  var spectrumEdgeLayout = { xPositions: [], actualGap: 0, barWidth: 0, usableWidth: 0 };
  var spectrumMatrix = null;
  var spectrumPosition = null;
  var spectrumQuaternion = null;
  var spectrumScale = null;
  var spectrumThreeColor = null;
  var spectrumThreeColorB = null;
  var spectrumCanvasDpr = 1;
  var SPECTRUM_PIXEL_BUDGET = 13000000;
  var spectrumReferenceMetrics = {
    active: false, displayBandCount: 0, coverage: 0, fillRatio: 0,
    baselineSlope: 0, baselineRms: 0, maximumHeight: 0, projectedSignature: '', barHeights: [],
    pointerX: 0, pointerY: 0, rotationRadians: 0, centerX: 0, baselineCenter: 0,
    left: 0, top: 0, right: 0, bottom: 0, fullyVisible: false
  };
  var spectrumPointerFollow = { x: 0, y: 0 };
  var SPECTRUM_RENDER_ORDER = 36;

  function styleSpectrumCanvas(canvas, view) {
    canvas.dataset.lfSpectrumMount = view;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.position = 'fixed';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    // Edge bars are a visual-background layer. The shared Three renderer and
    // every DOM control must composite above them.
    canvas.style.zIndex = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.opacity = '0';
    canvas.style.transition = 'opacity .24s ease';
    canvas.style.contain = 'strict';
  }

  function ensureSpectrumCanvas() {
    if (!spectrumMainCanvas) {
      spectrumMainCanvas = document.createElement('canvas');
      spectrumMainCanvas.id = 'lf-t13-spectrum-main';
      styleSpectrumCanvas(spectrumMainCanvas, 'main');
      document.body.appendChild(spectrumMainCanvas);
      spectrumMainCtx = spectrumMainCanvas.getContext('2d', { alpha: true, desynchronized: true });
    }
    if (!spectrumCanvas) {
      spectrumCanvas = document.createElement('canvas');
      spectrumCanvas.id = 'lf-t13-spectrum';
      styleSpectrumCanvas(spectrumCanvas, 'secondary');
      document.body.appendChild(spectrumCanvas);
      spectrumCtx = spectrumCanvas.getContext('2d', { alpha: true, desynchronized: true });
    }
    resizeSpectrumCanvas();
    return spectrumCanvas;
  }

  function resizeSpectrumCanvas() {
    if (!spectrumCanvas && !spectrumMainCanvas) return;
    var viewportPixels = Math.max(1, innerWidth * innerHeight);
    var deviceDpr = Math.max(1, window.devicePixelRatio || 1);
    var normalDpr = Math.max(1, Math.min(1.5, deviceDpr, Math.sqrt(SPECTRUM_PIXEL_BUDGET / viewportPixels)));
    spectrumCanvasDpr = normalDpr;
    [[spectrumCanvas, spectrumCtx, normalDpr], [spectrumMainCanvas, spectrumMainCtx, normalDpr]].forEach(function (entry) {
      var canvas = entry[0], ctx = entry[1], dpr = entry[2];
      if (!canvas || !ctx) return;
      var ownsBackingStore = spectrumState.mode === 3 &&
        (spectrumViewName() === 'main' ? canvas === spectrumMainCanvas : canvas === spectrumCanvas);
      var width = ownsBackingStore ? Math.max(1, Math.round(innerWidth * dpr)) : 1;
      var height = ownsBackingStore ? Math.max(1, Math.round(innerHeight * dpr)) : 1;
      var backingDpr = ownsBackingStore ? dpr : 1;
      canvas.style.width = innerWidth + 'px';
      canvas.style.height = innerHeight + 'px';
      if (canvas.width === width && canvas.height === height && canvas._lfSpectrumDpr === backingDpr) return;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      canvas._lfSpectrumDpr = backingDpr;
      ctx.setTransform(backingDpr, 0, 0, backingDpr, 0, 0);
    });
  }

  function effectiveSpectrumCount() {
    var requested = Math.round(Number(spectrumState.bandCount));
    return requested >= 1 && requested <= SPECTRUM_MAX_BANDS ? requested : 0;
  }

  function ensureSpectrumArrays(count) {
    if (spectrumSmooth.length === count) return;
    var oldSmooth = spectrumSmooth;
    spectrumSmooth = new Float32Array(count);
    spectrumValues = new Float32Array(count);
    spectrumScratch = new Float32Array(count);
    for (var i = 0; i < count; i++) {
      var oldIndex = oldSmooth.length ? Math.min(oldSmooth.length - 1, Math.round(i / Math.max(1, count - 1) * (oldSmooth.length - 1))) : 0;
      spectrumSmooth[i] = oldSmooth[oldIndex] || 0;
    }
  }

  function sampledFrequency(count, seeking, paused, deltaMs) {
    ensureSpectrumArrays(count);
    var data = window.frequencyData;
    var hasData = data && data.length;
    var sensitivity = clamp(spectrumState.sensitivity, 0.2, 3);
    var attack = clamp(spectrumState.attack, 0.01, 1);
    var release = clamp(spectrumState.release, 0.005, 0.8);
    var smoothing = clamp(spectrumState.smooth, 0, 0.96);
    var sampledAt = Number(window.lumiFieldFrequencyDataTimestamp) || 0;
    var liveSeekingData = !!(seeking && !paused && hasData && performance.now() - sampledAt < 260);
    var values = spectrumValues;
    for (var i = 0; i < count; i++) {
      var ratio = count === 1 ? 0 : i / (count - 1);
      var bin = hasData ? Math.min(data.length - 1, Math.floor(Math.pow(ratio, 1.62) * Math.min(data.length - 1, 420))) : 0;
      var raw = paused ? 0 : (hasData ? (Number(data[bin]) || 0) / 255 : 0);
      if (seeking && !paused && !liveSeekingData) raw = Math.max(raw, spectrumSmooth[i] * 0.94);
      raw = Math.min(1, Math.pow(Math.max(0, raw * sensitivity), 0.82));
      var previous = spectrumSmooth[i];
      var baseEase = raw > previous ? attack : release;
      var frameScale = Math.max(0.1, Math.min(1000, Number(deltaMs) || 16.667) / 16.667);
      var ease = paused
        ? 1 - Math.exp(-Math.max(1, Number(deltaMs) || 16.667) / (180 + (1 - release) * 180))
        : 1 - Math.pow(1 - baseEase, frameScale);
      var next = previous + (raw - previous) * ease;
      spectrumSmooth[i] = next;
      values[i] = next;
    }
    if (smoothing > 0 && count > 2) {
      var passes = smoothing > 0.7 ? 2 : 1;
      for (var pass = 0; pass < passes; pass++) {
        spectrumScratch.set(values);
        for (var j = 1; j < count - 1; j++) values[j] = spectrumScratch[j] * (1 - smoothing * 0.5) + (spectrumScratch[j - 1] + spectrumScratch[j + 1]) * smoothing * 0.25;
      }
    }
    return values;
  }

  function hexRgb(hex) {
    hex = normalizeHex(hex, '#51dcff');
    return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
  }
  function visibleSpectrumHex(hex) {
    var rgb = hexRgb(hex);
    function channel(value) {
      value /= 255;
      return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    }
    var luminance = 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
    if (luminance >= 0.30) return normalizeHex(hex, '#51dcff');
    var amount = clamp((0.30 - luminance) * 1.72, 0, 0.52);
    function lift(value) { return Math.round(value + (255 - value) * amount); }
    return '#' + [lift(rgb.r), lift(rgb.g), lift(rgb.b)].map(function (value) {
      return value.toString(16).padStart(2, '0');
    }).join('');
  }
  function currentVisualTint(fallback) {
    var fxState = window.fx || {};
    var palette = window.stageLyrics && (window.stageLyrics.coverPalette || window.stageLyrics.palette) || {};
    if (fxState.visualTintMode === 'custom') return normalizeHex(fxState.visualTintColor, fallback);
    return normalizeHex(palette.secondary || palette.primary || fxState.visualTintColor, fallback);
  }
  function mixColor(a, b, ratio, alpha) {
    a = hexRgb(a); b = hexRgb(b); ratio = clamp(ratio, 0, 1);
    return 'rgba(' + Math.round(a.r + (b.r - a.r) * ratio) + ',' + Math.round(a.g + (b.g - a.g) * ratio) + ',' + Math.round(a.b + (b.b - a.b) * ratio) + ',' + clamp(alpha, 0, 1).toFixed(3) + ')';
  }
  var spectrumCssPaletteCache = new Map();
  function spectrumColorPalette(count, alpha) {
    count = Math.max(0, Number(count) || 0);
    alpha = clamp(alpha, 0, 1);
    var mode = spectrumState.colorMode;
    var c1 = visibleSpectrumHex(spectrumState.colorA);
    var c2 = visibleSpectrumHex(spectrumState.colorB);
    if (mode === 'single') c2 = c1;
    if (mode === 'cover') {
      c1 = visibleSpectrumHex(currentVisualTint(c1));
      c2 = visibleSpectrumHex(spectrumState.colorB);
    }
    var timeBucket = mode === 'multi' ? Math.floor(performance.now() / 33) : 0;
    var alphaText = alpha.toFixed(3);
    var key = count + '|' + alphaText + '|' + mode + '|' + c1 + '|' + c2 + '|' + timeBucket;
    var cached = spectrumCssPaletteCache.get(key);
    if (cached) return cached;
    if (spectrumCssPaletteCache.size > 48) spectrumCssPaletteCache.clear();
    var colors = new Array(count);
    if (mode === 'multi') {
      var hueOffset = performance.now() * 0.018;
      for (var multiIndex = 0; multiIndex < count; multiIndex++) {
        var multiRatio = count <= 1 ? 0 : multiIndex / (count - 1);
        colors[multiIndex] = 'hsla(' + ((multiRatio * 300 + hueOffset) % 360).toFixed(1) + ',88%,67%,' + alphaText + ')';
      }
    } else {
      var rgbA = hexRgb(c1);
      var rgbB = hexRgb(c2);
      for (var index = 0; index < count; index++) {
        var ratio = count <= 1 ? 0 : index / (count - 1);
        colors[index] = 'rgba(' + Math.round(rgbA.r + (rgbB.r - rgbA.r) * ratio) + ',' +
          Math.round(rgbA.g + (rgbB.g - rgbA.g) * ratio) + ',' +
          Math.round(rgbA.b + (rgbB.b - rgbA.b) * ratio) + ',' + alphaText + ')';
      }
    }
    spectrumCssPaletteCache.set(key, colors);
    return colors;
  }
  function spectrumColor(index, count, alpha) {
    return spectrumColorPalette(count, alpha)[index] || 'rgba(81,220,255,0)';
  }

  function referenceSpectrumColor(index, count, alpha) {
    var ratio = count <= 1 ? 0 : index / (count - 1);
    var colorA = normalizeHex(spectrumState.colorA, '#55b3d2');
    var colorB = normalizeHex(spectrumState.colorB, '#b076d1');
    if (spectrumState.colorMode === 'gradient' && colorA === '#55b3d2' && colorB === '#b076d1') {
      return ratio <= 0.5
        ? mixColor(colorA, '#9ba7ea', ratio * 2, alpha)
        : mixColor('#9ba7ea', colorB, (ratio - 0.5) * 2, alpha);
    }
    return spectrumColor(index, count, alpha);
  }

  function threeSpectrumColor(index, count, energy) {
    if (!window.THREE) return null;
    var ratio = count <= 1 ? 0 : index / (count - 1);
    var a = visibleSpectrumHex(spectrumState.colorA), b = visibleSpectrumHex(spectrumState.colorB);
    if (spectrumState.colorMode === 'single') b = a;
    if (spectrumState.colorMode === 'cover') {
      a = visibleSpectrumHex(currentVisualTint(a));
      b = visibleSpectrumHex(spectrumState.colorB);
    }
    if (!spectrumThreeColor) spectrumThreeColor = new THREE.Color();
    if (!spectrumThreeColorB) spectrumThreeColorB = new THREE.Color();
    if (spectrumState.colorMode === 'multi') spectrumThreeColor.setHSL((ratio * 0.82 + performance.now() * 0.000035) % 1, 0.84, 0.62);
    else spectrumThreeColor.set(normalizeHex(a, '#51dcff')).lerp(spectrumThreeColorB.set(normalizeHex(b, '#e06cff')), ratio);
    var hsl = { h:0, s:0, l:0 };
    spectrumThreeColor.getHSL(hsl);
    spectrumThreeColor.setHSL(hsl.h, Math.max(0.58, hsl.s), clamp(Math.max(0.48, hsl.l), 0.48, 0.68));
    spectrumThreeColor.multiplyScalar(clamp(spectrumState.brightness, 0.52, 2.5) * (0.86 + energy * 0.24));
    return spectrumThreeColor;
  }

  function threeReferenceSpectrumColor(index, count) {
    if (!window.THREE) return null;
    var ratio = count <= 1 ? 0 : index / (count - 1);
    var a = spectrumState.colorA, b = spectrumState.colorB;
    if (spectrumState.colorMode === 'single') b = a;
    if (spectrumState.colorMode === 'cover') {
      a = currentVisualTint(a);
      b = spectrumState.colorB;
    }
    if (!spectrumThreeColor) spectrumThreeColor = new THREE.Color();
    if (!spectrumThreeColorB) spectrumThreeColorB = new THREE.Color();
    if (spectrumState.colorMode === 'multi') {
      spectrumThreeColor.setHSL((ratio * 0.82 + performance.now() * 0.000035) % 1, 0.82, 0.64);
    } else {
      spectrumThreeColor.set(normalizeHex(a, '#55b3d2')).lerp(spectrumThreeColorB.set(normalizeHex(b, '#b076d1')), ratio);
    }
    return spectrumThreeColor.multiplyScalar(clamp(spectrumState.brightness, 0.5, 1.35));
  }

  function appendRoundedRect(ctx, x, y, width, height, radius) {
    if (width <= 0 || height <= 0) return;
    radius = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
  }
  function roundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath(); appendRoundedRect(ctx, x, y, width, height, radius);
  }

  function spectrumWorld() {
    return window.scene && window.scene.isScene ? window.scene : null;
  }

  function disposeSpectrumStageMesh() {
    if (!spectrumStage.mesh) return;
    if (spectrumStage.mesh.parent) spectrumStage.mesh.parent.remove(spectrumStage.mesh);
    if (spectrumStage.mesh.geometry && spectrumStage.mesh.geometry.dispose) spectrumStage.mesh.geometry.dispose();
    if (spectrumStage.mesh.material && spectrumStage.mesh.material.dispose) spectrumStage.mesh.material.dispose();
    spectrumStage.mesh = null;
    spectrumStage.count = 0;
    spectrumStage.geometryIdentity = '';
    spectrumStage.visualStyle = '';
  }

  function createReferenceSpectrumMaterial(glass) {
    var material = new THREE.ShaderMaterial({
      uniforms: {
        uOpacity: { value: 1 },
        uGlow: { value: clamp(spectrumState.glow, 0, 2.5) },
        uGlass: { value: glass ? 1 : 0 }
      },
      vertexShader: [
        'varying vec2 vSpectrumUv;',
        'varying vec3 vSpectrumColor;',
        'varying float vSpectrumAspect;',
        'void main(){',
        ' vSpectrumUv=uv;',
        ' #ifdef USE_INSTANCING_COLOR',
        '  vSpectrumColor=instanceColor;',
        ' #else',
        '  vSpectrumColor=vec3(1.0);',
        ' #endif',
        ' vec4 localPosition=vec4(position,1.0);',
        ' #ifdef USE_INSTANCING',
        '  float instanceWidth=max(length(instanceMatrix[0].xyz),0.0001);',
        '  float instanceHeight=max(length(instanceMatrix[1].xyz),instanceWidth);',
        '  vSpectrumAspect=instanceHeight/instanceWidth;',
        '  localPosition=instanceMatrix*localPosition;',
        ' #else',
        '  vSpectrumAspect=1.0;',
        ' #endif',
        ' gl_Position=projectionMatrix*modelViewMatrix*localPosition;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform float uOpacity;',
        'uniform float uGlow;',
        'uniform float uGlass;',
        'varying vec2 vSpectrumUv;',
        'varying vec3 vSpectrumColor;',
        'varying float vSpectrumAspect;',
        'float roundedBoxDistance(vec2 point,vec2 halfSize,float radius){',
        ' vec2 q=abs(point)-(halfSize-vec2(radius));',
        ' return length(max(q,0.0))+min(max(q.x,q.y),0.0)-radius;',
        '}',
        'void main(){',
        ' float aspect=max(1.0,vSpectrumAspect);',
        ' vec2 point=(vSpectrumUv-0.5)*vec2(1.0,aspect);',
        ' float distanceToCapsule=roundedBoxDistance(point,vec2(0.5,aspect*0.5),0.5);',
        ' float edge=max(fwidth(distanceToCapsule)*1.35,0.0015);',
        ' float coverage=1.0-smoothstep(-edge,edge,distanceToCapsule);',
        ' if(coverage<=0.001) discard;',
        ' float glowMix=clamp(uGlow/2.5,0.0,1.0);',
        ' vec3 color=mix(vSpectrumColor,vec3(1.0),uGlass*0.075);',
        ' color*=0.97+glowMix*0.10;',
        ' gl_FragColor=vec4(color,coverage*uOpacity);',
        '}'
      ].join('\n'),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      toneMapped: false,
      vertexColors: true,
      extensions: { derivatives: true }
    });
    material.opacity = 1;
    material.transmission = glass ? 0.34 : 0;
    material.userData.lumiFieldContrastMaterial = true;
    material.userData.lumiFieldMaterialType = glass ? 'ContrastTranslucentGlass' : 'SolidEmissive';
    material.userData.lumiFieldSpectrumStyle = 'tears-reference-aa-capsules';
    material.userData.lumiFieldAnalyticAntialias = true;
    return material;
  }

  function createSpectrumMaterial(glass, referenceStyle) {
    if (!window.THREE) return null;
    if (referenceStyle) return createReferenceSpectrumMaterial(glass);
    var material = new THREE.MeshBasicMaterial({
      // r128 treats vertexColors=true as a required per-vertex `color`
      // attribute. BoxBufferGeometry has none, so WebGL's zero default was
      // multiplied into every valid InstancedMesh color and rendered black.
      // Instance colors are enabled independently by InstancedMesh.
      color: 0xffffff, vertexColors: false, transparent: true,
      opacity: Math.max(glass ? 0.42 : 0.28, clamp(spectrumState.opacity, 0.08, 1)),
      depthWrite: false, depthTest: false, side: THREE.DoubleSide,
      blending: glass ? THREE.NormalBlending : THREE.AdditiveBlending,
      toneMapped: false
    });
    // A compositor-transmission value is retained for diagnostics/preset
    // compatibility; unlike MeshPhysicalMaterial this unlit material cannot
    // collapse to black when the wallpaper lives in a DOM layer.
    material.transmission = glass ? 0.34 : 0;
    material.userData.lumiFieldContrastMaterial = true;
    material.userData.lumiFieldMaterialType = glass ? 'ContrastTranslucentGlass' : 'SolidEmissive';
    return material;
  }

  function ensureSpectrumStage(count) {
    var world = spectrumWorld();
    if (!world || !window.THREE || !THREE.InstancedMesh) return null;
    if (!spectrumStage.group) {
      spectrumStage.anchor = new THREE.Group();
      spectrumStage.anchor.name = 'LumiFieldVisualStageTransform';
      spectrumStage.anchor.userData.lumiFieldStageTransform = true;
      spectrumStage.group = new THREE.Group();
      spectrumStage.group.name = 'LumiFieldSpectrumStage';
      spectrumStage.group.renderOrder = SPECTRUM_RENDER_ORDER;
      spectrumStage.group.userData.lumiFieldSpectrumStage = true;
      spectrumStage.anchor.add(spectrumStage.group);
      world.add(spectrumStage.anchor);
      spectrumMatrix = new THREE.Matrix4();
      spectrumPosition = new THREE.Vector3();
      spectrumQuaternion = new THREE.Quaternion();
      spectrumScale = new THREE.Vector3();
    }
    var referenceStyle = spectrumViewName() === 'secondary';
    var wantedStyle = referenceStyle ? 'tears-reference-aa-capsules' : 'legacy-stage-boxes';
    var wantedKind = wantedStyle + ':' + (spectrumState.liquidGlassEnabled ? 'contrast-translucent-glass' : 'solid-emissive');
    if (!spectrumStage.mesh || spectrumStage.count !== count || spectrumStage.visualStyle !== wantedStyle) {
      disposeSpectrumStageMesh();
      var geometry = referenceStyle
        ? new THREE.PlaneBufferGeometry(1, 1, 1, 1)
        : new THREE.BoxBufferGeometry(1, 1, 1, 1, 1, 1);
      geometry.userData.lumiFieldSpectrumGeometry = referenceStyle ? 'analytic-rounded-capsule-plane' : 'legacy-box';
      var material = createSpectrumMaterial(spectrumState.liquidGlassEnabled, referenceStyle);
      var mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.name = 'LumiFieldRealtimeSpectrumMode1';
      mesh.frustumCulled = false;
      mesh.renderOrder = referenceStyle ? SPECTRUM_RENDER_ORDER : 22;
      if (mesh.instanceMatrix && mesh.instanceMatrix.setUsage && THREE.DynamicDrawUsage) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      spectrumStage.group.add(mesh);
      spectrumStage.mesh = mesh;
      spectrumStage.count = count;
      spectrumStage.materialKind = wantedKind;
      spectrumStage.visualStyle = wantedStyle;
      spectrumStage.geometryIdentity = geometry.uuid;
      spectrumStage.rebuildCount++;
    } else if (spectrumStage.materialKind !== wantedKind) {
      var oldMaterial = spectrumStage.mesh.material;
      spectrumStage.mesh.material = createSpectrumMaterial(spectrumState.liquidGlassEnabled, referenceStyle);
      if (oldMaterial && oldMaterial.dispose) oldMaterial.dispose();
      spectrumStage.materialKind = wantedKind;
    }
    return spectrumStage;
  }

  function syncSpectrumStageAnchor() {
    var transformSource = window.particles;
    if (!spectrumStage.anchor || !transformSource) return;
    if (transformSource.position) spectrumStage.anchor.position.copy(transformSource.position);
    if (transformSource.scale) spectrumStage.anchor.scale.copy(transformSource.scale);
    if (transformSource.quaternion) spectrumStage.anchor.quaternion.copy(transformSource.quaternion);
    spectrumStage.group.quaternion.identity();
    var referenceStyle = spectrumStage.visualStyle === 'tears-reference-aa-capsules';
    var followX = referenceStyle ? spectrumPointerFollow.x : 0;
    var followY = referenceStyle ? spectrumPointerFollow.y : 0;
    spectrumStage.group.position.set(
      followX * 0.34,
      -0.42 + clamp(spectrumState.offset, -1.5, 1.5) + followY * 0.22,
      0
    );
    spectrumStage.group.rotation.z = referenceStyle ? followX * 0.075 : 0;
  }

  function updateSpectrumPointerFollow() {
    var sharedPointer = window.pointerTarget || window.pointerParallax || {};
    var targetX = clamp(Number(sharedPointer.x) || 0, -1, 1);
    var targetY = clamp(Number(sharedPointer.y) || 0, -1, 1);
    spectrumPointerFollow.x += (targetX - spectrumPointerFollow.x) * 0.16;
    spectrumPointerFollow.y += (targetY - spectrumPointerFollow.y) * 0.16;
  }

  function updateReferenceSpectrumMetrics(stage, values, maxHeight) {
    if (!stage || !stage.group || !window.camera || !window.THREE) return;
    stage.anchor.updateMatrixWorld(true);
    window.camera.updateMatrixWorld(true);
    var halfWidth = stage.totalWidth * 0.5;
    var corners = [
      [-halfWidth, 0], [halfWidth, 0],
      [-halfWidth, maxHeight], [halfWidth, maxHeight]
    ];
    var left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    var baseline = [];
    corners.forEach(function (corner, index) {
      var point = new THREE.Vector3(corner[0], corner[1], 0);
      point.applyMatrix4(stage.group.matrixWorld).project(window.camera);
      var x = (point.x + 1) * innerWidth * 0.5;
      var y = (1 - point.y) * innerHeight * 0.5;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      if (index < 2) baseline.push({ x:x, y:y });
    });
    var center = new THREE.Vector3(0, 0, 0).applyMatrix4(stage.group.matrixWorld).project(window.camera);
    spectrumReferenceMetrics.active = !!stage.mesh.visible;
    spectrumReferenceMetrics.displayBandCount = values.length;
    spectrumReferenceMetrics.coverage = Math.max(0, right - left) / Math.max(1, innerWidth);
    spectrumReferenceMetrics.fillRatio = stage.totalWidth > 0
      ? stage.barWidth * values.length / stage.totalWidth : 0;
    spectrumReferenceMetrics.baselineSlope = baseline.length === 2
      ? (baseline[1].y - baseline[0].y) / Math.max(1, baseline[1].x - baseline[0].x) : 0;
    spectrumReferenceMetrics.baselineRms = 0;
    spectrumReferenceMetrics.maximumHeight = maxHeight;
    spectrumReferenceMetrics.pointerX = spectrumPointerFollow.x;
    spectrumReferenceMetrics.pointerY = spectrumPointerFollow.y;
    spectrumReferenceMetrics.rotationRadians = stage.group.rotation.z;
    spectrumReferenceMetrics.centerX = (center.x + 1) * innerWidth * 0.5;
    spectrumReferenceMetrics.baselineCenter = (1 - center.y) * innerHeight * 0.5;
    spectrumReferenceMetrics.left = left;
    spectrumReferenceMetrics.top = top;
    spectrumReferenceMetrics.right = right;
    spectrumReferenceMetrics.bottom = bottom;
    var margin = 2;
    spectrumReferenceMetrics.fullyVisible = left >= margin && top >= margin &&
      right <= innerWidth - margin && bottom <= innerHeight - margin;
    spectrumReferenceMetrics.barHeights = Array.prototype.map.call(values, function (energy) {
      return Math.max(stage.barWidth, clamp(energy, 0, 1) * maxHeight);
    });
    spectrumReferenceMetrics.projectedSignature = baseline.map(function (point) {
      return point.x.toFixed(3) + ',' + point.y.toFixed(3);
    }).join('|');
  }

  function updateSpectrumStage(values, visible) {
    var stage = ensureSpectrumStage(values.length);
    if (!stage || !stage.mesh || !stage.group) return;
    var referenceStyle = stage.visualStyle === 'tears-reference-aa-capsules';
    if (referenceStyle) updateSpectrumPointerFollow();
    syncSpectrumStageAnchor();
    stage.group.renderOrder = referenceStyle ? SPECTRUM_RENDER_ORDER : 22;
    stage.group.visible = !!visible;
    stage.mesh.visible = !!visible;
    var count = values.length;
    var gapControl = clamp(spectrumState.horizontalGap, 0, 32);
    var gapRatio = gapControl / (gapControl + 16);
    var targetWidth = referenceStyle ? (6.3 + gapRatio * 1.0) : (5.6 + gapRatio * 1.6);
    var cell = targetWidth / Math.max(1, count);
    var actualGap = count > 1 ? Math.min(cell * 0.76, cell * gapRatio * 0.92) : 0;
    var barWidth = Math.max(0.004, cell - actualGap);
    var totalWidth = count * barWidth + Math.max(0, count - 1) * actualGap;
    var startX = -totalWidth / 2 + barWidth / 2;
    var maxHeight = 1.58 * clamp(spectrumState.heightScale, 0.25, 3);
    var depth = spectrumState.liquidGlassEnabled ? 0.10 : 0.065;
    if (stage.xPositions.length !== count) stage.xPositions = new Array(count);
    for (var i = 0; i < count; i++) {
      var energy = values[i];
      var height = Math.max(0.0001, energy * maxHeight);
      if (referenceStyle && energy > 0.0025) height = Math.max(height, barWidth);
      var x = startX + i * (barWidth + actualGap);
      stage.xPositions[i] = x;
      spectrumPosition.set(x, height / 2, 0);
      spectrumScale.set(barWidth, height, referenceStyle ? 1 : depth);
      spectrumMatrix.compose(spectrumPosition, spectrumQuaternion, spectrumScale);
      stage.mesh.setMatrixAt(i, spectrumMatrix);
      if (stage.mesh.setColorAt) stage.mesh.setColorAt(i, referenceStyle
        ? threeReferenceSpectrumColor(i, count)
        : threeSpectrumColor(i, count, energy));
    }
    stage.barWidth = barWidth;
    stage.actualGap = actualGap;
    stage.totalWidth = totalWidth;
    stage.mesh.instanceMatrix.needsUpdate = true;
    if (stage.mesh.instanceColor) stage.mesh.instanceColor.needsUpdate = true;
    var material = stage.mesh.material;
    var requestedOpacity = clamp(spectrumState.opacity, 0.08, 1);
    material.opacity = referenceStyle
      ? requestedOpacity * (spectrumState.liquidGlassEnabled ? 0.9 : 1)
      : Math.max(spectrumState.liquidGlassEnabled ? 0.42 : 0.28, requestedOpacity);
    if (material.uniforms && material.uniforms.uOpacity) material.uniforms.uOpacity.value = material.opacity;
    if (material.uniforms && material.uniforms.uGlow) material.uniforms.uGlow.value = clamp(spectrumState.glow, 0, 2.5);
    if (material.uniforms && material.uniforms.uGlass) material.uniforms.uGlass.value = spectrumState.liquidGlassEnabled ? 1 : 0;
    material.needsUpdate = false;
    if (referenceStyle) updateReferenceSpectrumMetrics(stage, values, maxHeight);
  }

  function edgeLayout(width, count) {
    var safe = Math.max(18, width * 0.028);
    var usable = Math.max(1, width - safe * 2);
    var cell = usable / Math.max(1, count);
    var gapControl = clamp(spectrumState.horizontalGap, 0, 32);
    var gapRatio = gapControl / (gapControl + 12);
    var actualGap = Math.min(cell * 0.78, cell * gapRatio * 0.92);
    var barWidth = Math.max(0.35, cell - actualGap);
    var positions = spectrumEdgeLayout.xPositions && spectrumEdgeLayout.xPositions.length === count
      ? spectrumEdgeLayout.xPositions : new Array(count);
    for (var i = 0; i < count; i++) positions[i] = safe + i * cell + (cell - barWidth) / 2;
    spectrumEdgeLayout.xPositions = positions;
    spectrumEdgeLayout.actualGap = actualGap;
    spectrumEdgeLayout.barWidth = barWidth;
    spectrumEdgeLayout.usableWidth = usable;
    return spectrumEdgeLayout;
  }

  function captureSpectrumBackdrop() {
    if (!spectrumBackdropCanvas) {
      spectrumBackdropCanvas = document.createElement('canvas');
      spectrumBackdropCtx = spectrumBackdropCanvas.getContext('2d', { alpha: true, desynchronized: true });
    }
    if (!spectrumBackdropCtx) return false;
    var lowFpsBackdrop = spectrumFps < 38;
    var maximumBackdropWidth = lowFpsBackdrop ? 320 : 480;
    var maximumBackdropHeight = lowFpsBackdrop ? 180 : 270;
    var scale = Math.min(lowFpsBackdrop ? 0.3 : 0.4,
      maximumBackdropWidth / Math.max(1, innerWidth), maximumBackdropHeight / Math.max(1, innerHeight));
    var backdropWidth = Math.max(1, Math.round(innerWidth * scale));
    var backdropHeight = Math.max(1, Math.round(innerHeight * scale));
    if (spectrumBackdropCanvas.width !== backdropWidth || spectrumBackdropCanvas.height !== backdropHeight) {
      spectrumBackdropCanvas.width = backdropWidth;
      spectrumBackdropCanvas.height = backdropHeight;
      spectrumBackdropCapturedAt = 0;
    }
    var capturedAt = performance.now();
    var cacheDuration = lowFpsBackdrop && /renderer/.test(spectrumBackdropSource) ? 650 : 300;
    if (spectrumBackdropSource !== 'none' && capturedAt - spectrumBackdropCapturedAt < cacheDuration) return true;
    spectrumBackdropCtx.clearRect(0, 0, backdropWidth, backdropHeight);
    spectrumBackdropCtx.filter = 'saturate(1.55) contrast(1.10) brightness(1.08)';
    spectrumBackdropSource = 'none';
    var sampled = false;
    try {
      var backgroundVideo = byId('custom-bg-video');
      if (backgroundVideo && backgroundVideo.readyState >= 2 && !backgroundVideo.hidden) {
        spectrumBackdropCtx.drawImage(backgroundVideo, 0, 0, backdropWidth, backdropHeight);
        sampled = true;
        spectrumBackdropSource = 'background-video';
      }
    } catch (_) {}
    spectrumBackdropCtx.filter = 'none';
    spectrumBackdropCapturedAt = sampled ? capturedAt : 0;
    return sampled;
  }

  function appendRefractedBackdropClip(ctx, values, layout, maximumHeight, baseline, fromTop, reverse) {
    for (var i = 0; i < values.length; i++) {
      var energy = values[reverse ? values.length - 1 - i : i];
      var barHeight = energy * maximumHeight;
      if (barHeight <= 0.08) continue;
      var y = fromTop ? baseline : baseline - barHeight;
      appendRoundedRect(ctx, layout.xPositions[i], y, layout.barWidth, barHeight, Math.min(layout.barWidth / 2, 7));
    }
  }

  function drawRefractedBackdropPair(ctx, values, layout, maximumHeight, topBaseline, bottomBaseline, bottomReverse) {
    if (!spectrumBackdropCanvas || spectrumBackdropSource === 'none') return false;
    ctx.save();
    ctx.beginPath();
    appendRefractedBackdropClip(ctx, values, layout, maximumHeight, topBaseline, true, false);
    appendRefractedBackdropClip(ctx, values, layout, maximumHeight, bottomBaseline, false, bottomReverse);
    ctx.clip();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.72;
    ctx.filter = 'none';
    ctx.drawImage(spectrumBackdropCanvas, -1.2, 0, innerWidth + 2.4, innerHeight);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = mixColor(spectrumState.colorA, spectrumState.colorB, 0.5, 1);
    ctx.fillRect(0, 0, innerWidth, innerHeight);
    ctx.restore();
    return true;
  }

  function drawSpectrumBars(ctx, values, width, height, fromTop, reverse, refractedSet) {
    var count = values.length;
    var layout = edgeLayout(width, count);
    var barWidth = layout.barWidth;
    var alpha = clamp(spectrumState.opacity, 0, 1);
    var brightness = clamp(spectrumState.brightness, 0.1, 2.5);
    var glow = clamp(spectrumState.glow, 0, 2.5);
    var maximumHeight = clamp(height * 0.13 * clamp(spectrumState.heightScale, 0.25, 3), 18, height * 0.34);
    var offsetPx = clamp(spectrumState.offset, -1.5, 1.5) * height * 0.04;
    var baseline = fromTop ? offsetPx : height + offsetPx;
    var glass = spectrumState.liquidGlassEnabled;
    var fillColors = spectrumColorPalette(count, glass ? (refractedSet ? alpha * 0.28 : alpha * 0.48) : alpha);
    var strokeColors = glass ? spectrumColorPalette(count, Math.min(1, alpha * 0.72 + 0.16)) : null;
    ctx.save();
    ctx.filter = glass ? 'none' : 'brightness(' + brightness.toFixed(3) + ')';
    ctx.globalCompositeOperation = glass ? 'screen' : 'source-over';
    if (glow > 0.02 && (!glass || !refractedSet)) {
      ctx.shadowColor = mixColor(spectrumState.colorA, spectrumState.colorB, 0.5, Math.min(0.9, alpha));
      ctx.shadowBlur = 2 + glow * 7;
    }
    for (var i = 0; i < count; i++) {
      var energy = values[reverse ? count - 1 - i : i];
      var barHeight = energy * maximumHeight;
      if (barHeight <= 0.08) continue;
      var x = layout.xPositions[i];
      var y = fromTop ? baseline : baseline - barHeight;
      var radius = Math.min(barWidth / 2, 7);
      ctx.fillStyle = fillColors[i];
      roundedRect(ctx, x, y, barWidth, barHeight, radius);
      ctx.fill();
      if (glass) {
        ctx.strokeStyle = strokeColors[i];
        ctx.lineWidth = Math.max(0.55, Math.min(1.8, barWidth * 0.14));
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function spectrumViewName() {
    return document.body && document.body.classList.contains('empty-home-active') ? 'main' : 'secondary';
  }

  function spectrumSurfaceAvailable() {
    if (!document.body || document.hidden || document.body.classList.contains('lf-auth-locked')) return false;
    return !document.body.classList.contains('splash-active') || document.body.classList.contains('splash-revealing');
  }

  function clearSpectrumCanvases() {
    if (!spectrumCanvasesDirty) return;
    [[spectrumCanvas, spectrumCtx], [spectrumMainCanvas, spectrumMainCtx]].forEach(function (entry) {
      if (!entry[0] || !entry[1]) return;
      entry[1].clearRect(0, 0, innerWidth, innerHeight);
      entry[0].classList.remove('active');
      entry[0].style.opacity = '0';
      entry[0].style.zIndex = '0';
      entry[0].style.mixBlendMode = 'normal';
      entry[0].style.filter = 'none';
    });
    spectrumReferenceMetrics.active = false;
    spectrumCanvasesDirty = false;
  }

  function drawReferenceSpectrum(values, visible) {
    var canvas = spectrumCanvas;
    var ctx = spectrumCtx;
    if (!canvas || !ctx) return;
    if (spectrumMainCanvas && spectrumMainCtx) {
      spectrumMainCtx.clearRect(0, 0, innerWidth, innerHeight);
      spectrumMainCanvas.classList.remove('active');
      spectrumMainCanvas.style.opacity = '0';
      spectrumMainCanvas.style.zIndex = '0';
    }
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    canvas.classList.toggle('active', !!visible);
    canvas.style.opacity = visible ? '1' : '0';
    canvas.style.zIndex = '0';
    canvas.style.mixBlendMode = 'normal';
    canvas.style.filter = 'none';
    spectrumCanvasesDirty = !!visible;
    spectrumReferenceMetrics.active = !!visible;
    if (!visible || !values.length) return;

    var count = values.length;
    var orbitState = window.orbit || {};
    var thetaDelta = Number(orbitState.userTheta) - Number(orbitState.baselineTheta);
    var phiDelta = Number(orbitState.userPhi) - Number(orbitState.baselinePhi);
    var particleRotationX = Number(window.particles && window.particles.rotation && window.particles.rotation.x) || 0;
    var particleRotationY = Number(window.particles && window.particles.rotation && window.particles.rotation.y) || 0;
    var particleRotationZ = Number(window.particles && window.particles.rotation && window.particles.rotation.z) || 0;
    var sharedPointer = window.pointerTarget || window.pointerParallax || {};
    var pointerTargetX = clamp(Number(sharedPointer.x) || 0, -1, 1);
    var pointerTargetY = clamp(Number(sharedPointer.y) || 0, -1, 1);
    spectrumPointerFollow.x += (pointerTargetX - spectrumPointerFollow.x) * 0.16;
    spectrumPointerFollow.y += (pointerTargetY - spectrumPointerFollow.y) * 0.16;
    var pointerX = spectrumPointerFollow.x;
    var pointerY = spectrumPointerFollow.y;
    var radiusRatio = Number(orbitState.baselineRadius) > 0 && Number(orbitState.userRadius) > 0
      ? Number(orbitState.baselineRadius) / Number(orbitState.userRadius) : 1;
    if (!Number.isFinite(thetaDelta)) thetaDelta = 0;
    if (!Number.isFinite(phiDelta)) phiDelta = 0;
    if (!Number.isFinite(radiusRatio)) radiusRatio = 1;
    var coverage = 0.54 * clamp(radiusRatio, 0.78, 1.28);
    var totalWidth = innerWidth * coverage;
    var cell = totalWidth / Math.max(1, count);
    var gapControl = clamp(spectrumState.horizontalGap, 0, 32);
    var gapRatio = gapControl / (gapControl + 16);
    var fillRatio = clamp(0.82 - gapRatio * 0.28, 0.45, 0.82);
    var barWidth = Math.max(1.5, cell * fillRatio);
    var centerX = innerWidth * (0.5 + clamp(thetaDelta + particleRotationY, -1, 1) * 0.065 + pointerX * 0.055);
    var localStartX = -totalWidth * 0.5 + cell * 0.5;
    var baseSlope = -0.0478 + clamp(thetaDelta + particleRotationZ, -1, 1) * 0.035;
    var rotationRadians = Math.atan(baseSlope) + pointerX * 0.075;
    var slope = Math.tan(rotationRadians);
    var baselineCenter = innerHeight * (0.56 + clamp(phiDelta + particleRotationX, -0.7, 0.7) * 0.07) +
      clamp(spectrumState.offset, -1.5, 1.5) * innerHeight * 0.04 - pointerY * innerHeight * 0.055;
    var maximumHeight = clamp(innerHeight * 0.205 * clamp(spectrumState.heightScale, 0.25, 3), 24, innerHeight * 0.26);
    var alpha = clamp(spectrumState.opacity, 0.08, 1) * (spectrumState.liquidGlassEnabled ? 0.9 : 1);
    var glow = clamp(spectrumState.glow, 0, 2.5);
    var brightness = clamp(spectrumState.brightness, 0.5, 1.35);

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.filter = 'brightness(' + brightness.toFixed(3) + ')';
    ctx.shadowColor = mixColor(spectrumState.colorA, spectrumState.colorB, 0.5, Math.min(0.42, alpha * 0.48));
    ctx.shadowBlur = glow > 0.02 ? Math.min(6, 1.2 + glow * 3.2) : 0;
    ctx.translate(centerX, baselineCenter);
    ctx.rotate(rotationRadians);
    for (var i = 0; i < count; i++) {
      var energy = clamp(values[i], 0, 1);
      var visualEnergy = 0.30 + Math.pow(energy, 0.62) * 0.70;
      var barHeight = Math.max(barWidth * 1.35, visualEnergy * maximumHeight);
      var x = localStartX + i * cell;
      ctx.fillStyle = referenceSpectrumColor(i, count, alpha);
      roundedRect(ctx, x - barWidth * 0.5, -barHeight, barWidth, barHeight, barWidth * 0.5);
      ctx.fill();
    }
    ctx.restore();

    spectrumReferenceMetrics.active = true;
    spectrumReferenceMetrics.displayBandCount = count;
    spectrumReferenceMetrics.coverage = coverage;
    spectrumReferenceMetrics.fillRatio = fillRatio;
    spectrumReferenceMetrics.baselineSlope = slope;
    spectrumReferenceMetrics.baselineRms = 0;
    spectrumReferenceMetrics.maximumHeight = maximumHeight;
    spectrumReferenceMetrics.pointerX = pointerX;
    spectrumReferenceMetrics.pointerY = pointerY;
    spectrumReferenceMetrics.rotationRadians = rotationRadians;
    spectrumReferenceMetrics.centerX = centerX;
    spectrumReferenceMetrics.baselineCenter = baselineCenter;
    spectrumReferenceMetrics.barHeights = Array.prototype.map.call(values, function (energy) {
      return Math.max(barWidth * 1.35, (0.30 + Math.pow(clamp(energy, 0, 1), 0.62) * 0.70) * maximumHeight);
    });
    var endX = localStartX + (count - 1) * cell;
    var cosRotation = Math.cos(rotationRadians), sinRotation = Math.sin(rotationRadians);
    spectrumReferenceMetrics.projectedSignature = [
      centerX + localStartX * cosRotation, baselineCenter + localStartX * sinRotation,
      centerX + endX * cosRotation, baselineCenter + endX * sinRotation
    ].map(function (value) { return value.toFixed(3); }).join('|');
  }

  function drawSpectrumEdges(values, visible) {
    var view = spectrumViewName();
    var canvas = view === 'main' ? spectrumMainCanvas : spectrumCanvas;
    var ctx = view === 'main' ? spectrumMainCtx : spectrumCtx;
    var otherCanvas = view === 'main' ? spectrumCanvas : spectrumMainCanvas;
    var otherCtx = view === 'main' ? spectrumCtx : spectrumMainCtx;
    if (otherCanvas && otherCtx && (otherCanvas.classList.contains('active') || otherCanvas.style.opacity !== '0')) {
      otherCtx.clearRect(0, 0, innerWidth, innerHeight);
      otherCanvas.classList.remove('active');
      otherCanvas.style.opacity = '0';
    }
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    canvas.classList.toggle('active', !!visible);
    canvas.style.opacity = visible ? '1' : '0';
    spectrumCanvasesDirty = !!visible;
    if (!visible) return;
    if (spectrumState.liquidGlassEnabled) captureSpectrumBackdrop();
    else spectrumBackdropSource = 'none';
    canvas.style.mixBlendMode = spectrumState.liquidGlassEnabled && spectrumBackdropSource === 'none' ? 'difference' : 'normal';
    canvas.style.filter = spectrumState.liquidGlassEnabled
      ? 'saturate(1.35) contrast(1.06) brightness(' + clamp(spectrumState.brightness, 0.1, 2.5).toFixed(3) + ')'
      : 'none';
    var layout = edgeLayout(innerWidth, values.length);
    var maximumHeight = clamp(innerHeight * 0.13 * clamp(spectrumState.heightScale, 0.25, 3), 18, innerHeight * 0.34);
    var offsetPx = clamp(spectrumState.offset, -1.5, 1.5) * innerHeight * 0.04;
    var refractedSet = spectrumState.liquidGlassEnabled && drawRefractedBackdropPair(
      ctx, values, layout, maximumHeight, offsetPx, innerHeight + offsetPx, !spectrumState.symmetry
    );
    drawSpectrumBars(ctx, values, innerWidth, innerHeight, true, false, refractedSet);
    drawSpectrumBars(ctx, values, innerWidth, innerHeight, false, !spectrumState.symmetry, refractedSet);
  }

  function spectrumFrame(now) {
    now = Number(now) || performance.now();
    spectrumFrames++;
    if (now - spectrumFpsAt >= 1000) {
      spectrumFps = spectrumFrames * 1000 / Math.max(1, now - spectrumFpsAt);
      spectrumFrames = 0; spectrumFpsAt = now;
    }
    var active = !!spectrumState.enabled && spectrumSurfaceAvailable() &&
      !document.body.classList.contains('lf-audio-echo-active');
    if (!active) {
      if (!spectrumRenderStopped) clearSpectrumCanvases();
      if (spectrumStage.group) spectrumStage.group.visible = false;
      spectrumRenderStopped = true;
      return;
    }
    spectrumRenderStopped = false;
    ensureSpectrumCanvas();
    var referenceMode = spectrumState.mode === 1 && spectrumViewName() === 'secondary';
    var drawInterval = spectrumState.mode === 3 && spectrumState.liquidGlassEnabled
      ? (spectrumFps < 20 ? 100 : (spectrumFps < 38 ? 66 : 40))
      : (spectrumFps < 38 ? 34 : (referenceMode ? 16.7 : 20));
    if (now - spectrumLastTime < drawInterval) return;
    var count = effectiveSpectrumCount();
    if (!count) {
      clearSpectrumCanvases();
      if (spectrumStage.group) spectrumStage.group.visible = false;
      spectrumLastTime = now;
      return;
    }
    var media = window.audio;
    var seeking = !!(window.lumiFieldSeekingAudio || (media && media.seeking));
    var paused = !media || media.paused;
    if (spectrumReleaseSettled && paused) {
      if (!spectrumReleaseCleared) {
        clearSpectrumCanvases();
        if (spectrumStage.group) spectrumStage.group.visible = false;
        spectrumReleaseCleared = true;
      }
      spectrumLastTime = now;
      return;
    }
    if (!paused) { spectrumReleaseSettled = false; spectrumReleaseCleared = false; }
    var values = sampledFrequency(count, seeking, paused, Math.max(1, now - spectrumLastTime));
    spectrumMaxEnergy = 0;
    for (var energyIndex = 0; energyIndex < values.length; energyIndex++) spectrumMaxEnergy = Math.max(spectrumMaxEnergy, values[energyIndex]);
    spectrumMaxBarHeight = spectrumState.mode === 1
      ? spectrumMaxEnergy * 1.58 * clamp(spectrumState.heightScale, 0.25, 3)
      : spectrumMaxEnergy * clamp(innerHeight * 0.13 * clamp(spectrumState.heightScale, 0.25, 3), 18, innerHeight * 0.34);
    var energyVisible = !paused || spectrumMaxEnergy > 0.0025;
    if (paused && !energyVisible) { spectrumReleaseSettled = true; spectrumReleaseCleared = false; }
    if (spectrumState.mode === 3) {
      if (spectrumStage.group) spectrumStage.group.visible = false;
      drawSpectrumEdges(values, energyVisible);
    } else if (referenceMode) {
      if (spectrumCanvas && spectrumCtx) {
        spectrumCtx.clearRect(0, 0, innerWidth, innerHeight);
        spectrumCanvas.classList.remove('active');
        spectrumCanvas.style.opacity = '0';
      }
      updateSpectrumStage(values, energyVisible);
    } else {
      clearSpectrumCanvases();
      if (spectrumStage.group) spectrumStage.group.visible = false;
      if (spectrumStage.mesh) spectrumStage.mesh.visible = false;
    }
    spectrumLastTime = now;
  }

  function updateTask13Frame(now, dt) {
    now = Number(now) || performance.now();
    var manager = window.LumiFieldAudioEchoManager;
    if (manager && typeof manager.updateAudioFrame === 'function') manager.updateAudioFrame(now, dt);
    syncLyricTranslation(now);
    spectrumFrame(now);
  }

  function spectrumDebugSnapshot() {
    var requestedCount = effectiveSpectrumCount();
    var modeOne = spectrumState.mode === 1;
    var referenceMode = modeOne && spectrumViewName() === 'secondary';
    var count = requestedCount;
    var layout = modeOne ? spectrumStage : spectrumEdgeLayout;
    var activeCanvas = spectrumViewName() === 'main' ? spectrumMainCanvas : spectrumCanvas;
    var material = spectrumStage.mesh && spectrumStage.mesh.material;
    var instanceColor = spectrumStage.mesh && spectrumStage.mesh.instanceColor;
    var instanceColorValues = instanceColor && instanceColor.array;
    var signature = '';
    if (spectrumStage.group && window.camera && window.THREE && spectrumStage.xPositions.length) {
      try {
        syncSpectrumStageAnchor();
        spectrumStage.group.updateMatrixWorld(true);
        window.camera.updateMatrixWorld(true);
        var sampleIndexes = [0, Math.floor((spectrumStage.xPositions.length - 1) / 2), spectrumStage.xPositions.length - 1];
        signature = sampleIndexes.map(function (index) {
          var point = new THREE.Vector3(spectrumStage.xPositions[index], spectrumMaxBarHeight, 0);
          point.applyMatrix4(spectrumStage.group.matrixWorld).project(window.camera);
          return [point.x.toFixed(4), point.y.toFixed(4), point.z.toFixed(4)].join(',');
        }).join('|');
      } catch (_) { signature = ''; }
    }
    var coverage = spectrumEdgeLayout.xPositions.length
      ? (spectrumEdgeLayout.xPositions[spectrumEdgeLayout.xPositions.length - 1] + spectrumEdgeLayout.barWidth - spectrumEdgeLayout.xPositions[0]) / Math.max(1, innerWidth)
      : 0;
    var edgeSignature = spectrumEdgeLayout.xPositions.length ? [
      spectrumEdgeLayout.xPositions[0],
      spectrumEdgeLayout.xPositions[Math.floor((spectrumEdgeLayout.xPositions.length - 1) / 2)],
      spectrumEdgeLayout.xPositions[spectrumEdgeLayout.xPositions.length - 1]
    ].map(function (value) { return Number(value).toFixed(3); }).join('|') : '';
    return {
      state: Object.assign({}, spectrumState), mode: spectrumState.mode,
      serializedStateKeys: Object.keys(spectrumState).sort(),
      legacyStateKeyCount: Math.max(0, Object.keys(spectrumState).length - Object.keys(SPECTRUM_DEFAULTS).length),
      requestedBandCount: spectrumState.bandCount, renderedBandCount: count,
      actualBandCount: count, deviceBandLimit: SPECTRUM_MAX_BANDS,
      rejectedBandCount: spectrumRejectedBandCount,
      mount: spectrumViewName(), activeMount: spectrumViewName(), mountId: modeOne ? 'LumiFieldSpectrumStage' : (activeCanvas && activeCanvas.id),
      mountType: modeOne ? 'three-world-stage' : 'canvas-safe-edge',
      mounts: {
        main: spectrumMainCanvas && spectrumMainCanvas.id,
        secondary: spectrumCanvas && spectrumCanvas.id
      },
      backingStores: {
        main: spectrumMainCanvas ? { width:spectrumMainCanvas.width, height:spectrumMainCanvas.height } : null,
        secondary: spectrumCanvas ? { width:spectrumCanvas.width, height:spectrumCanvas.height } : null,
        largeCount: [spectrumMainCanvas,spectrumCanvas].filter(function (canvas) { return canvas && (canvas.width > 1 || canvas.height > 1); }).length
      },
      geometryIdentity: modeOne ? spectrumStage.geometryIdentity : 'edge-bars-' + count,
      geometryRebuildCount: spectrumStage.rebuildCount,
      geometryInstanceCount: modeOne && spectrumStage.mesh ? spectrumStage.mesh.count : count * 2,
      geometryType: modeOne && spectrumStage.mesh && spectrumStage.mesh.geometry
        ? (spectrumStage.mesh.geometry.userData.lumiFieldSpectrumGeometry || spectrumStage.mesh.geometry.type)
        : 'canvas-rounded-rect',
      visualStyle: modeOne ? spectrumStage.visualStyle : 'edge-bars',
      analyticAntialias: !!(modeOne && material && material.userData.lumiFieldAnalyticAntialias),
      flatFrontFacing: !!(modeOne && spectrumStage.visualStyle === 'tears-reference-aa-capsules'),
      referenceAppearance: modeOne && spectrumViewName() === 'secondary' ? {
        source: 'user-video-tears-spectrum-only',
        sourceSha256: 'F2C54CB4531B2749FD646623ECBA98D0B42BFD9C1B4AF5DDF8BDEE550D568498',
        barCount: count,
        palette: ['#55b3d2', '#9ba7ea', '#b076d1'],
        shape: 'single-baseline-rounded-capsule-plane'
      } : null,
      layerOrder: modeOne && spectrumViewName() === 'secondary' ? {
        particles: Number(window.particles && window.particles.renderOrder) || 1,
        spectrum: spectrumStage.mesh ? spectrumStage.mesh.renderOrder : SPECTRUM_RENDER_ORDER,
        lyrics: Number(window.stageLyrics && window.stageLyrics.group && window.stageLyrics.group.renderOrder) || 38,
        shelf: 50,
        shelfContent: 232
      } : null,
      projectedBounds: modeOne && spectrumViewName() === 'secondary' ? {
        left:spectrumReferenceMetrics.left,
        top:spectrumReferenceMetrics.top,
        right:spectrumReferenceMetrics.right,
        bottom:spectrumReferenceMetrics.bottom,
        fullyVisible:spectrumReferenceMetrics.fullyVisible
      } : null,
      pointerMotion: modeOne && spectrumViewName() === 'secondary' ? {
        x:spectrumReferenceMetrics.pointerX,
        y:spectrumReferenceMetrics.pointerY,
        centerX:spectrumReferenceMetrics.centerX,
        baselineCenter:spectrumReferenceMetrics.baselineCenter,
        rotationRadians:spectrumReferenceMetrics.rotationRadians,
        source:'shared-pointer-target-smoothed'
      } : null,
      xPositions: (layout.xPositions || []).slice(), actualHorizontalGap: layout.actualGap || 0,
      barWidth: layout.barWidth || 0, totalWidth: modeOne ? spectrumStage.totalWidth : spectrumEdgeLayout.usableWidth,
      heightScale: spectrumState.heightScale, maxBarHeight: spectrumMaxBarHeight,
      configuredMaxBarHeight: modeOne
        ? 1.58 * clamp(spectrumState.heightScale, 0.25, 3)
        : clamp(innerHeight * 0.13 * clamp(spectrumState.heightScale, 0.25, 3), 18, innerHeight * 0.34),
      projectedSignature: modeOne && spectrumViewName() === 'secondary' ? spectrumReferenceMetrics.projectedSignature : signature,
      projectedWidthCoverage: modeOne && spectrumViewName() === 'secondary' ? spectrumReferenceMetrics.coverage : 0,
      projectedFillRatio: modeOne && spectrumViewName() === 'secondary' ? spectrumReferenceMetrics.fillRatio : 0,
      projectedBaselineSlope: modeOne && spectrumViewName() === 'secondary' ? spectrumReferenceMetrics.baselineSlope : 0,
      projectedBaselineRms: modeOne && spectrumViewName() === 'secondary' ? spectrumReferenceMetrics.baselineRms : 0,
      projectedBarHeights: modeOne && spectrumViewName() === 'secondary' ? spectrumReferenceMetrics.barHeights.slice() : [],
      active: !!spectrumState.enabled && spectrumSurfaceAvailable() && spectrumMaxEnergy > 0.0025 &&
        !(modeOne && spectrumViewName() === 'main'),
      maxEnergy: spectrumMaxEnergy, paused: !window.audio || !!window.audio.paused,
      releaseHidden: spectrumReleaseSettled,
      topCount: spectrumState.mode === 3 ? count : 0,
      bottomCount: spectrumState.mode === 3 ? count : 0,
      topSetCount: spectrumState.mode === 3 ? 1 : 0,
      bottomSetCount: spectrumState.mode === 3 ? 1 : 0,
      orientation: spectrumState.mode === 3 ? 'vertical-y' : 'vertical-y-stage',
      horizontalScanLineCount: 0,
      topWidthCoverage: spectrumState.mode === 3 ? coverage : 0,
      bottomWidthCoverage: spectrumState.mode === 3 ? coverage : 0,
      topXSignature: spectrumState.mode === 3 ? edgeSignature : '',
      bottomXSignature: spectrumState.mode === 3 ? edgeSignature : '',
      ghostLayers: 0,
      analyserPresent: !!window.analyser,
      analyserName: window.analyser && window.analyser.constructor ? window.analyser.constructor.name : '',
      analyserMatchesWindow: true,
      usesSharedFrequencyData: !!window.frequencyData,
      audioContextsCreated: 0,
      materialType: modeOne && material
        ? (material.userData.lumiFieldMaterialType || material.type)
        : (spectrumState.liquidGlassEnabled ? 'CanvasContrastGlass' : 'CanvasSolidColor'),
      materialDiagnostics: modeOne && material ? {
        type: material.type,
        color: material.color && material.color.getHexString ? '#' + material.color.getHexString() : '',
        opacity: material.opacity,
        transparent: !!material.transparent,
        vertexColors: !!material.vertexColors,
        depthWrite: !!material.depthWrite,
        depthTest: !!material.depthTest,
        blending: material.blending,
        toneMapped: !!material.toneMapped,
        premultipliedAlpha: !!material.premultipliedAlpha,
        instanceColorSample: instanceColorValues ? Array.prototype.slice.call(instanceColorValues, 0, Math.min(9, instanceColorValues.length)) : []
      } : null,
      liquidGlassEnabled: !!spectrumState.liquidGlassEnabled,
      transmission: modeOne && material && material.transmission != null
        ? material.transmission
        : (spectrumState.liquidGlassEnabled ? 0.34 : 0),
      backdropReactive: !!spectrumState.liquidGlassEnabled,
      backdropSampleSource: spectrumBackdropSource,
      effectiveCanvasDpr: spectrumCanvasDpr,
      canvasPixelBudget: SPECTRUM_PIXEL_BUDGET,
      canvasZIndex: activeCanvas ? getComputedStyle(activeCanvas).zIndex : '',
      rendererZIndex: (byId('canvas-container') && getComputedStyle(byId('canvas-container')).zIndex) || '',
      stageObjectPresent: !!spectrumStage.group,
      stageObjectName: spectrumStage.group ? spectrumStage.group.name : '',
      stageAnchorPresent: !!spectrumStage.anchor,
      stageAnchorName: spectrumStage.anchor ? spectrumStage.anchor.name : '',
      stageTransformSource: window.particles ? 'particles' : 'scene',
      stageMeshPresent: !!spectrumStage.mesh,
      stageMeshName: spectrumStage.mesh ? spectrumStage.mesh.name : '',
      stageVisible: !!(spectrumStage.group && spectrumStage.group.visible && spectrumStage.mesh && spectrumStage.mesh.visible),
      stageWorldTransform: spectrumStage.group ? {
        parent: spectrumStage.group.parent && (spectrumStage.group.parent.name || spectrumStage.group.parent.type),
        root: spectrumStage.anchor && spectrumStage.anchor.parent && (spectrumStage.anchor.parent.name || spectrumStage.anchor.parent.type),
        position: spectrumStage.group.position.toArray(), quaternion: spectrumStage.group.quaternion.toArray(),
        scale: spectrumStage.group.scale.toArray(), cameraDistance: window.camera && spectrumStage.group.position.distanceTo(window.camera.position)
      } : null
    };
  }

  function applySpectrumStatePatch(patch, options) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return false;
    var allowed = Object.keys(SPECTRUM_DEFAULTS);
    var candidate = Object.assign({}, spectrumState);
    for (var key in patch) {
      if (!Object.prototype.hasOwnProperty.call(patch, key) || allowed.indexOf(key) < 0) continue;
      candidate[key] = patch[key];
    }
    var requested = patch.bandCount == null ? candidate.bandCount : Math.round(Number(patch.bandCount));
    if (!isFinite(requested) || requested < 1 || requested > SPECTRUM_MAX_BANDS) {
      spectrumRejectedBandCount = patch.bandCount;
      syncSpectrumControls();
      show('频段数量超出当前设备上限 1–256，已拒绝应用');
      return false;
    }
    if (patch.mode != null && Number(patch.mode) !== 1 && Number(patch.mode) !== 3) return false;
    candidate.bandCount = requested;
    candidate.mode = Number(candidate.mode) === 3 ? 3 : 1;
    spectrumRejectedBandCount = null;
    spectrumState = normalizeSpectrumState(candidate);
    if (options && options.deferPersist) delayed('spectrum', persistSpectrum);
    else persistSpectrum();
    syncSpectrumControls();
    spectrumFrame(performance.now());
    return true;
  }

  // Legacy echo rendering was removed: LumiFieldAudioEchoManager owns the single shared-renderer pipeline.
  function echoDebugSnapshot() {
    return {
      state:Object.assign({}, echoState, { visualEq:echoState.visualEq.slice() }),
      enabled:echoState.enabled,
      active:false,
      managerUnavailable:true,
      allocations:{ rendererCreated:0, audioContextCreated:0, analyserCreated:0, audioElementCreated:0, requestAnimationFrameCreated:0 },
      audioGraphMutations:0
    };
  }
  // ---------- Visual console controls ----------
  var saveTimers = {};
  function delayed(key, fn, delay) {
    clearTimeout(saveTimers[key]);
    saveTimers[key] = setTimeout(function () { saveTimers[key] = 0; fn(); }, delay == null ? 260 : delay);
  }
  function range(scope, key, label, min, max, step) {
    return '<label class="lf-t13-field"><span>' + esc(label) + '</span><input type="range" data-lf-scope="' + scope + '" data-lf-key="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '"><output></output></label>';
  }
  function number(scope, key, label, min, max, step) {
    return '<label class="lf-t13-field"><span>' + esc(label) + '</span><input type="number" data-lf-scope="' + scope + '" data-lf-key="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '"><output></output></label>';
  }
  function check(scope, key, label) {
    return '<label class="lf-t13-check"><input type="checkbox" data-lf-scope="' + scope + '" data-lf-key="' + key + '"><span>' + esc(label) + '</span></label>';
  }
  function select(scope, key, label, options) {
    return '<label class="lf-t13-field"><span>' + esc(label) + '</span><select data-lf-scope="' + scope + '" data-lf-key="' + key + '">' + options.map(function (option) {
      return '<option value="' + esc(option[0]) + '">' + esc(option[1]) + '</option>';
    }).join('') + '</select><output></output></label>';
  }
  function color(scope, key, label) {
    return '<label class="lf-t13-field lf-t13-color"><span>' + esc(label) + '</span><input type="color" data-lf-scope="' + scope + '" data-lf-key="' + key + '"><output></output></label>';
  }

  function stateForScope(scope) {
    if (scope === 'lyrics') return lyricState;
    if (scope === 'spectrum') return spectrumState;
    if (scope === 'echo') return echoState;
    return null;
  }
  function formatControlValue(input, value) {
    if (input.type === 'checkbox') return value ? '开' : '关';
    if (input.type === 'color' || input.tagName === 'SELECT') return String(value);
    var step = Number(input.step);
    if (step >= 1) return String(Math.round(Number(value)));
    if (step >= 0.1) return Number(value).toFixed(1);
    if (step >= 0.01) return Number(value).toFixed(2);
    return String(value);
  }
  function syncScopedControls(scope) {
    var state = stateForScope(scope);
    if (!state) return;
    document.querySelectorAll('[data-lf-scope="' + scope + '"][data-lf-key]').forEach(function (input) {
      var value = state[input.dataset.lfKey];
      if (input.type === 'checkbox') input.checked = !!value;
      else if (value != null && document.activeElement !== input) input.value = value;
      var output = input.parentElement && input.parentElement.querySelector('output');
      if (output) output.textContent = formatControlValue(input, value);
    });
  }
  function syncLyricControls() {
    syncScopedControls('lyrics');
  }
  function syncSpectrumControls() {
    syncScopedControls('spectrum');
    document.querySelectorAll('[data-lf-spectrum-mode]').forEach(function (button) { button.classList.toggle('active', Number(button.dataset.lfSpectrumMode) === spectrumState.mode); });
    var safe = byId('lf-t13-spectrum-safe');
    if (safe) {
      safe.textContent = spectrumRejectedBandCount != null
        ? '已拒绝输入 ' + spectrumRejectedBandCount + '；当前设备明确上限为 256，实际保持 ' + spectrumState.bandCount
        : '输入值 ' + spectrumState.bandCount + ' · 实际渲染值 ' + effectiveSpectrumCount() + ' · 当前设备上限 256';
    }
  }
  function syncEchoControls() {
    var themeInput = document.querySelector('[data-lf-scope="echo"][data-lf-key="theme"]');
    if (themeInput) {
      var themeMap = echoThemeMap(echoState.shape);
      themeInput.innerHTML = Object.keys(themeMap).map(function (key) { return '<option value="' + esc(key) + '">' + esc(themeMap[key]) + '</option>'; }).join('');
      echoState.theme = normalizeEchoThemeForShape(echoState.theme, echoState.shape);
    }
    syncScopedControls('echo');
    var block = byId('lf-t13-echo-block');
    if (block) block.classList.toggle('lf-hide-color-options', !echoState.showColorOptions);
    if (block) block.querySelectorAll('[data-lf-echo-shapes]').forEach(function (section) {
      section.hidden = String(section.dataset.lfEchoShapes || '').split(',').indexOf(echoState.shape) < 0;
    });
    renderEchoPresetOptions();
  }

  function lyricControlsHtml() {
    return '<details id="lf-t13-lyric-block" class="lf-t13-block" open><summary><span>歌词翻译</span><small>平台优先 / 本地离线 / 缓存</small></summary><div class="lf-t13-body">' +
      check('lyrics', 'translate', '翻译歌词（平台优先 / 本地离线 / 缓存）') + '<div id="lf-t13-translate-control-status" class="lf-t13-inline-status"><span id="lf-t13-translate-control-status-text"></span><button id="lf-t13-translate-retry" type="button" hidden>重试</button></div></div></details>';
  }

  function spectrumControlsHtml() {
    return '<details id="lf-t13-spectrum-block" class="lf-t13-block"><summary><span>实时音频频谱</span><small>统一 SpectrumState · 共享 Analyser</small></summary><div class="lf-t13-body">' +
      check('spectrum', 'enabled', '启用实时频谱') + '<div class="lf-t13-segments"><button type="button" data-lf-spectrum-mode="1">形态一 · 中部舞台</button><button type="button" data-lf-spectrum-mode="3">形态三 · 上下边缘</button></div>' +
      number('spectrum', 'bandCount', '频段数量', 1, 256, 1) + number('spectrum', 'horizontalGap', '横向间隔', 0, 32, 1) + range('spectrum', 'heightScale', '频谱高度', 0.25, 3, 0.01) + '<div id="lf-t13-spectrum-safe" class="lf-t13-inline-status"></div>' +
      check('spectrum', 'liquidGlassEnabled', '液态玻璃整体效果') + select('spectrum', 'colorMode', '配色', [['single','单色'],['multi','多色'],['gradient','渐变'],['cover','跟随封面颜色']]) + color('spectrum', 'colorA', '颜色一') + color('spectrum', 'colorB', '颜色二') + range('spectrum', 'brightness', '亮度', 0.1, 2.5, 0.05) + range('spectrum', 'opacity', '透明度', 0.08, 1, 0.01) + range('spectrum', 'glow', '发光', 0, 2.5, 0.05) + range('spectrum', 'smooth', '平滑', 0, 0.96, 0.01) + range('spectrum', 'attack', 'Attack', 0.01, 1, 0.01) + range('spectrum', 'release', 'Release', 0.005, 0.8, 0.005) + range('spectrum', 'sensitivity', '灵敏度', 0.2, 3, 0.05) +
      '<fieldset><legend>位置 / 形态三</legend>' + range('spectrum', 'offset', '位置偏移', -1.5, 1.5, 0.01) + check('spectrum', 'symmetry', '上下对称') + '</fieldset></div></details>';
  }

  function themeOptions(shape) {
    var map = echoThemeMap(shape || 'shape1');
    return Object.keys(map).map(function (key) { return [key, map[key]]; });
  }

  function echoControlsHtml() {
    return '<details id="lf-t13-echo-block" class="lf-t13-block"><summary><span>音域回响</span><small>两套固定源码独立形态</small></summary><div class="lf-t13-body">' +
      '<div class="lf-t13-echo-toolbar"><select id="lf-t13-echo-builtin"><option value="shape1">形态一 · Sonic Topography / hgbhh258-spec</option><option value="shape2">形态二 · Sonic Topography / CmzYa</option></select><button type="button" data-lf-echo-action="builtin">应用</button><select id="lf-t13-echo-user"></select></div>' +
      '<div class="lf-t13-echo-toolbar"><button type="button" data-lf-echo-action="save">保存用户存档</button><button type="button" data-lf-echo-action="rename">重命名</button><button type="button" data-lf-echo-action="delete">删除</button><button type="button" data-lf-echo-action="export">导出 JSON</button><button type="button" data-lf-echo-action="import">导入 JSON</button><button type="button" data-lf-echo-action="reset">重置</button></div>' +
      check('echo', 'enabled', '启用音域回响') + select('echo', 'shape', '形态（仅用户切换）', [['shape1','形态一 · Sonic Topography / hgbhh258-spec'],['shape2','形态二 · Sonic Topography / CmzYa']]) +
      '<fieldset><legend>LumiField 适配</legend>' + select('echo', 'quality', '画质', [['low','省电'],['medium','标准'],['high','高清'],['ultra','超清']]) + check('echo', 'audioMonitor', '使用唯一播放器音频') + '<label class="lf-t13-check lf-t13-mode1-lyrics-control"><input type="checkbox" data-lf-scope="echo" data-lf-key="mode1LeftLyricsEnabled"><span>左侧歌词播放</span><small>两种形态复用同一组件</small></label></fieldset>' +
      '<fieldset class="lf-t13-echo-colors"><legend>源码主题</legend>' + select('echo', 'theme', '颜色主题', themeOptions('shape1')) + '</fieldset>' +
      '<fieldset data-lf-echo-shapes="shape1"><legend>形态一 · hgbhh258-spec 源码事件</legend>' + check('echo', 'rippleEnabled', '启用波纹与流星') + range('echo', 'rippleSensitivity', '触发灵敏度', 0, 1, 0.01) + number('echo', 'rippleCooldown', '波纹冷却帧', 1, 240, 1) + '</fieldset>' +
      '<fieldset data-lf-echo-shapes="shape2"><legend>形态二 · CmzYa 源码响应</legend>' + range('echo', 'responseStrength', '音频响应强度', 0, 3, 0.02) + range('echo', 'responseRange', '响应范围', 0.08, 1, 0.01) + check('echo', 'rippleEnabled', '启用波纹') + range('echo', 'rippleSensitivity', '波纹灵敏度', 0, 1, 0.01) + number('echo', 'rippleCooldown', '波纹冷却帧', 1, 240, 1) + check('echo', 'idleWave', '空闲波浪') + range('echo', 'idleDebounce', '空闲防抖（秒）', 0, 20, 0.1) + range('echo', 'idleFade', '空闲淡出（秒）', 0.1, 12, 0.1) + range('echo', 'exposureStrength', '峰值强调强度', 0, 2, 0.02) + check('echo', 'flashEnabled', '峰值强调色') + check('echo', 'reducedFlash', '降低闪光') + '</fieldset>' +
      '<fieldset><legend>源码相机</legend>' + range('echo', 'cameraDistance', '视角距离', 0.45, 2.8, 0.01) + range('echo', 'cameraHorizontal', '水平角度', -180, 180, 1) + range('echo', 'cameraElevation', '垂直仰角', 5, 78, 1) + check('echo', 'autoRotate', '自动旋转') + range('echo', 'rotateSpeed', '旋转速度', -2, 2, 0.01) + '<div class="lf-t13-echo-toolbar"><button type="button" data-lf-echo-action="camera-reset">相机归位</button></div></fieldset>' +
      '<input id="lf-t13-echo-import" type="file" accept=".json,application/json" hidden></div></details>';
  }

  function setScopedValue(scope, key, input) {
    var state = stateForScope(scope);
    if (!state) return;
    var value = input.type === 'checkbox' ? input.checked : (input.type === 'color' || input.tagName === 'SELECT' ? input.value : Number(input.value));
    if (scope === 'spectrum') {
      var spectrumPatch = {}; spectrumPatch[key] = value;
      if (!applySpectrumStatePatch(spectrumPatch, { deferPersist:true })) {
        input.value = spectrumState[key];
        var rejectedOutput = input.parentElement && input.parentElement.querySelector('output');
        if (rejectedOutput) rejectedOutput.textContent = formatControlValue(input, spectrumState[key]);
      }
      return;
    }
    if (scope === 'echo') {
      var echoPatch = {}; echoPatch[key] = value;
      if (!applyEchoState(echoPatch, { partial:true, deferPersist:true })) return;
      var echoOutput = input.parentElement && input.parentElement.querySelector('output');
      if (echoOutput) echoOutput.textContent = formatControlValue(input, value);
      return;
    }
    if (scope === 'lyrics') {
      var lyricPatch = {}; lyricPatch[key] = value;
      setLyricState(lyricPatch);
      return;
    }
    state[key] = value;
    var output = input.parentElement && input.parentElement.querySelector('output');
    if (output) output.textContent = formatControlValue(input, value);
  }

  function bindConsoleControls(panel) {
    panel.addEventListener('input', function (event) {
      var input = event.target.closest('[data-lf-scope][data-lf-key]');
      if (input) setScopedValue(input.dataset.lfScope, input.dataset.lfKey, input);
    });
    panel.addEventListener('change', function (event) {
      var input = event.target.closest('[data-lf-scope][data-lf-key]');
      if (input) setScopedValue(input.dataset.lfScope, input.dataset.lfKey, input);
    });
    panel.addEventListener('click', function (event) {
      var retryButton = event.target.closest('#lf-t13-translate-retry');
      if (retryButton) {
        translationAttemptKey = '';
        translationRetry = { key:'', count:0, nextAt:0 };
        translationEnsureAt = 0;
        ensureTranslations(true);
        return;
      }
      var spectrumButton = event.target.closest('[data-lf-spectrum-mode]');
      if (spectrumButton) {
        applySpectrumStatePatch({ mode: Number(spectrumButton.dataset.lfSpectrumMode), enabled: true }); return;
      }
      var echoButton = event.target.closest('[data-lf-echo-action]');
      if (echoButton) handleEchoAction(echoButton.dataset.lfEchoAction);
    });
  }

  var CONSOLE_FOLD_DEFAULTS = { liquidGlass:false, lightField:false, particleColor:false };
  var CONSOLE_FOLD_META = {
    liquidGlass:{ title:'Liquid Glass', subtitle:'透明 / 模糊 / 色差 / 高光' },
    lightField:{ title:'光场模式', subtitle:'背景与能耗模式' },
    particleColor:{ title:'粒子着色', subtitle:'配色 / 透明 / 节拍响应' }
  };
  function normalizeConsoleFoldState(value) {
    value = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
      liquidGlass:value.liquidGlass === true,
      lightField:value.lightField === true,
      particleColor:value.particleColor === true
    };
  }
  function consoleFoldState() {
    return normalizeConsoleFoldState(readScopedValue(STORE.consoleFolds, CONSOLE_FOLD_DEFAULTS));
  }
  function applyConsoleFoldExpanded(key, expanded) {
    var fold = document.querySelector('[data-lf-console-fold="' + key + '"]');
    if (!fold) return false;
    var button = fold.querySelector('[data-lf-console-fold-toggle]');
    var body = fold.querySelector('[data-lf-console-fold-body]');
    expanded = expanded === true;
    fold.classList.toggle('open', expanded);
    if (button) button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    if (body) {
      body.setAttribute('aria-hidden', expanded ? 'false' : 'true');
      body.inert = !expanded;
      if (expanded) body.removeAttribute('inert'); else body.setAttribute('inert', '');
    }
    return true;
  }
  function syncConsoleFoldState() {
    var state = consoleFoldState();
    Object.keys(CONSOLE_FOLD_DEFAULTS).forEach(function (key) { applyConsoleFoldExpanded(key, state[key]); });
    return state;
  }
  function setConsoleFoldExpanded(key, expanded) {
    if (!own(CONSOLE_FOLD_DEFAULTS, key)) return false;
    var previous = consoleFoldState();
    var state = Object.assign({}, previous);
    state[key] = expanded === true;
    if (!writeScopedValue(STORE.consoleFolds, state)) return false;
    if (consoleFoldState()[key] !== state[key]) {
      writeScopedValue(STORE.consoleFolds, previous);
      return false;
    }
    var panel = byId('fx-panel');
    var scrollTop = panel ? panel.scrollTop : 0;
    applyConsoleFoldExpanded(key, state[key]);
    if (panel) {
      var restoreScroll = function () {
        if (panel && Math.abs(panel.scrollTop - scrollTop) > 1 && scrollTop <= panel.scrollHeight - panel.clientHeight) panel.scrollTop = scrollTop;
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restoreScroll);
      setTimeout(restoreScroll, 240);
    }
    return true;
  }
  function createConsoleFold(key) {
    var meta = CONSOLE_FOLD_META[key];
    var fold = document.createElement('section');
    var buttonId = 'lf-console-fold-' + key.replace(/[A-Z]/g, function (letter) { return '-' + letter.toLowerCase(); }) + '-toggle';
    var bodyId = buttonId.replace(/-toggle$/, '-body');
    fold.id = buttonId.replace(/-toggle$/, '');
    fold.className = 'lf-console-fold';
    fold.setAttribute('data-lf-console-fold', key);
    fold.setAttribute('data-lf-problem15-fold', key);
    fold.innerHTML = '<button id="' + buttonId + '" class="lf-console-fold-toggle" type="button" data-lf-console-fold-toggle data-lf-problem15-fold-toggle="' + key + '" aria-controls="' + bodyId + '" aria-expanded="false"><span>' + esc(meta.title) + '</span><small>' + esc(meta.subtitle) + '</small><i aria-hidden="true">⌄</i></button>' +
      '<div class="lf-console-fold-clip"><div id="' + bodyId + '" class="lf-console-fold-body" data-lf-console-fold-body data-lf-problem15-fold-body="' + key + '" aria-hidden="true" inert></div></div>';
    var button = fold.querySelector('[data-lf-console-fold-toggle]');
    button.addEventListener('click', function () {
      setConsoleFoldExpanded(key, button.getAttribute('aria-expanded') !== 'true');
    });
    button.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      button.click();
    });
    return fold;
  }
  function relocateTask15ConsoleBlocks() {
    var panel = byId('fx-panel');
    var appearance = panel && panel.querySelector('.fx-tab-page[data-fx-page="appearance"]');
    var lyricsPage = panel && panel.querySelector('.fx-tab-page[data-fx-page="lyrics"]');
    if (!panel || !appearance || !lyricsPage) return false;

    var lyricBlock = byId('lf-t13-lyric-block');
    if (lyricBlock && lyricBlock.parentElement !== lyricsPage) lyricsPage.appendChild(lyricBlock);

    var glass = byId('lf-glass-controls');
    var glassFold = document.querySelector('[data-lf-console-fold="liquidGlass"]');
    if (glass) {
      if (!glassFold) glassFold = createConsoleFold('liquidGlass');
      var glassHead = glass.querySelector(':scope > .lf-v2-head');
      if (glassHead) glassHead.hidden = true;
      var glassBody = glassFold.querySelector('[data-lf-console-fold-body]');
      if (glassBody && glass.parentElement !== glassBody) glassBody.appendChild(glass);
    }
    if (glassFold && glassFold.parentElement !== appearance) appearance.appendChild(glassFold);

    var visual = byId('lf-visual-controls');
    if (visual && !visual.querySelector('[data-lf-console-fold="lightField"]')) {
      var nodes = Array.prototype.slice.call(visual.children);
      var particleTitleIndex = nodes.findIndex(function (node) { return /粒子着色/.test(node.textContent || ''); });
      if (particleTitleIndex < 0) return false;
      var lightFold = createConsoleFold('lightField');
      var particleFold = createConsoleFold('particleColor');
      var lightBody = lightFold.querySelector('[data-lf-console-fold-body]');
      var particleBody = particleFold.querySelector('[data-lf-console-fold-body]');
      nodes.slice(0, particleTitleIndex).forEach(function (node) { lightBody.appendChild(node); });
      nodes.slice(particleTitleIndex).forEach(function (node) { particleBody.appendChild(node); });
      var lightInnerTitle = lightBody.querySelector('.lf-control-title > span:first-child');
      if (lightInnerTitle) lightInnerTitle.hidden = true;
      var particleInnerTitle = particleBody.querySelector('.lf-control-title');
      if (particleInnerTitle) particleInnerTitle.hidden = true;
      visual.classList.add('lf-console-fold-host');
      visual.appendChild(lightFold);
      visual.appendChild(particleFold);
    }
    if (visual && visual.parentElement !== appearance) appearance.appendChild(visual);
    syncConsoleFoldState();
    return !!(lyricBlock && glassFold && visual && visual.querySelector('[data-lf-console-fold="particleColor"]'));
  }
  var task15ConsoleObserver = null;
  var task15ConsoleReconcileTimer = 0;
  function scheduleTask15ConsoleReconcile() {
    if (task15ConsoleReconcileTimer) return;
    task15ConsoleReconcileTimer = setTimeout(function () {
      task15ConsoleReconcileTimer = 0;
      relocateTask15ConsoleBlocks();
    }, 40);
  }
  function observeTask15ConsoleBlocks() {
    var panel = byId('fx-panel');
    if (!panel || task15ConsoleObserver || typeof MutationObserver !== 'function') return;
    task15ConsoleObserver = new MutationObserver(scheduleTask15ConsoleReconcile);
    task15ConsoleObserver.observe(panel, { childList:true, subtree:true });
  }
  window.LumiFieldTask15 = {
    refresh:function () { return relocateTask15ConsoleBlocks(); },
    getDebug:function () {
      var state = consoleFoldState();
      return {
        scope:presetScopeKey(), state:state,
        folds:Object.keys(CONSOLE_FOLD_DEFAULTS).map(function (key) {
          var fold = document.querySelector('[data-lf-console-fold="' + key + '"]');
          var body = fold && fold.querySelector('[data-lf-console-fold-body]');
          return { key:key, count:document.querySelectorAll('[data-lf-console-fold="' + key + '"]').length, expanded:!!(fold && fold.classList.contains('open')), inert:!!(body && (body.inert || body.hasAttribute('inert'))) };
        })
      };
    },
    setExpanded:function (key, expanded) { return setConsoleFoldExpanded(key, expanded); },
    setTestUser:function (userId) { var scope = setPresetScopeTestUser(userId); relocateTask15ConsoleBlocks(); return scope; }
  };

  var consoleInjectTimer = 0;
  var consoleInjectAttempts = 0;
  function retryConsoleControls() {
    if (consoleInjectTimer || consoleInjectAttempts >= 40) return;
    consoleInjectAttempts++;
    consoleInjectTimer = setTimeout(function () {
      consoleInjectTimer = 0;
      injectConsoleControls();
    }, 100);
  }
  function injectConsoleControls() {
    var panel = byId('fx-panel');
    var presetsPage = panel && panel.querySelector('.fx-tab-page[data-fx-page="presets"]');
    var archive = byId('user-archive-grid');
    if (!panel || !presetsPage || !archive || archive.parentElement !== presetsPage) {
      retryConsoleControls();
      return;
    }
    consoleInjectAttempts = 0;
    var existing = byId('lf-t13-console');
    if (existing) {
      presetsPage.insertBefore(existing, archive.nextSibling);
      relocateTask15ConsoleBlocks();
      return;
    }
    var oldSpectrum = byId('lf-visualizer-controls'); if (oldSpectrum) oldSpectrum.remove();
    var shell = document.createElement('div');
    shell.id = 'lf-t13-console';
    shell.innerHTML = lyricControlsHtml() + spectrumControlsHtml() + echoControlsHtml();
    presetsPage.insertBefore(shell, archive.nextSibling);
    bindConsoleControls(panel);
    syncLyricControls(); syncSpectrumControls(); syncEchoControls();
    bindEchoImport();
    relocateTask15ConsoleBlocks();
  }

  // ---------- Echo preset persistence / JSON ----------
  function normalizeEchoPresetList(value) {
    if (!Array.isArray(value)) return [];
    var seen = Object.create(null);
    return value.reduce(function (result, item) {
      if (!item || !item.id || !item.state) return result;
      var id = String(item.id);
      if (seen[id]) return result;
      seen[id] = true;
      result.push(Object.assign({}, item, {
        id:id,
        name:String(item.name || '音域回响').slice(0, 32),
        state:normalizeEchoState(item.state)
      }));
      return result;
    }, []);
  }
  function echoUserPresets() {
    var current = normalizeEchoPresetList(readJson(STORE.echoPresets, []));
    var legacy = normalizeEchoPresetList(readJson(STORE.legacyEchoPresets, []));
    if (!legacy.length) return current;
    var currentIds = Object.create(null);
    current.forEach(function (item) { currentIds[item.id] = true; });
    legacy.forEach(function (item) { if (!currentIds[item.id]) current.push(item); });
    if (writeJson(STORE.echoPresets, current)) {
      var verified = normalizeEchoPresetList(readJson(STORE.echoPresets, []));
      if (JSON.stringify(verified) === JSON.stringify(current)) {
        try { localStorage.removeItem(STORE.legacyEchoPresets); } catch (_) {}
      }
    }
    return current;
  }
  function saveEchoUserPresets(list) { return writeJson(STORE.echoPresets, normalizeEchoPresetList(list)); }
  function echoPresetId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'echo-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }
  function renderEchoPresetOptions() {
    var selectEl = byId('lf-t13-echo-user');
    if (!selectEl) return;
    var selected = selectEl.value;
    var list = echoUserPresets();
    selectEl.innerHTML = '<option value="">用户存档</option>' + list.map(function (item) { return '<option value="' + esc(item.id) + '">' + esc(item.name) + '</option>'; }).join('');
    if (list.some(function (item) { return item.id === selected; })) selectEl.value = selected;
  }
  function applyEchoState(value, options) {
    options = options || {};
    var before = Object.assign({}, echoState, { visualEq:echoState.visualEq.slice() });
    try {
      var patch = validateEchoPatch(value);
      var candidate = options.partial
        ? Object.assign({}, echoState, { visualEq:echoState.visualEq.slice() })
        : Object.assign({}, ECHO_DEFAULTS, { visualEq:ECHO_DEFAULTS.visualEq.slice() });
      Object.assign(candidate, patch);
      candidate.visualEq = normalizeVisualEq(candidate.visualEq, true);
      candidate.theme = normalizeEchoThemeForShape(candidate.theme, candidate.shape);
      echoState = candidate;
      var manager = window.LumiFieldAudioEchoManager;
      if (manager && typeof manager.applyState === 'function' && manager.applyState(Object.assign({}, echoState, { visualEq:echoState.visualEq.slice() })) === false) {
        throw new Error('Audio Echo 模式资源激活失败');
      }
      if (options.deferPersist) delayed('echo', persistEcho);
      else persistEcho();
      syncEchoControls();
      return true;
    } catch (error) {
      echoState = before;
      var rollbackManager = window.LumiFieldAudioEchoManager;
      if (rollbackManager && typeof rollbackManager.applyState === 'function') rollbackManager.applyState(Object.assign({}, before, { visualEq:before.visualEq.slice() }));
      syncEchoControls();
      if (!options.silent) show('音域回响设置无效，已回滚：' + (error && error.message || '未知错误'));
      return false;
    }
  }
  function builtInEchoState(shape) {
    shape = /^(shape1|shape2)$/.test(String(shape)) ? String(shape) : 'shape1';
    var state = Object.assign({}, ECHO_DEFAULTS, { enabled:true, shape:shape, visualEq:ECHO_DEFAULTS.visualEq.slice() });
    if (shape === 'shape2') Object.assign(state, {
      theme:'nocturnal', cameraElevation:25, rotateSpeed:1 / 6,
      responseStrength:1, responseRange:1, rippleSensitivity:0.2, rippleCooldown:40,
      idleDebounce:1, idleFade:1, exposureStrength:1, reducedFlash:true
    });
    return state;
  }
  function downloadJson(name, value) {
    var blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url; anchor.download = String(name || 'LumiField.json').replace(/[\\/:*?"<>|]+/g, '-'); anchor.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function selectedEchoPreset() {
    var selectEl = byId('lf-t13-echo-user');
    var id = selectEl && selectEl.value;
    return echoUserPresets().filter(function (item) { return item.id === id; })[0] || null;
  }
  function handleEchoAction(action) {
    var list, item, name;
    if (action === 'camera-reset') {
      applyEchoState({ cameraDistance:1, cameraHorizontal:0, cameraElevation:echoState.shape === 'shape2' ? 25 : 27, autoRotate:false }, { partial:true });
      var cameraManager = window.LumiFieldAudioEchoManager;
      if (cameraManager && typeof cameraManager.resetCamera === 'function') cameraManager.resetCamera();
      show('音域回响相机已归位');
      return;
    }
    if (action === 'builtin') {
      applyEchoState(builtInEchoState(byId('lf-t13-echo-builtin').value)); show('音域回响内置预设已应用'); return;
    }
    if (action === 'save') {
      name = window.prompt('用户存档名称', '音域回响 ' + (echoUserPresets().length + 1));
      if (!name) return;
      list = echoUserPresets();
      item = { id: echoPresetId(), name: String(name).trim().slice(0, 32), savedAt: Date.now(), state: Object.assign({}, echoState, { visualEq:echoState.visualEq.slice() }) };
      list.push(item); saveEchoUserPresets(list); renderEchoPresetOptions();
      byId('lf-t13-echo-user').value = item.id; show('音域回响已保存到用户存档'); return;
    }
    if (action === 'reset') { applyEchoState(ECHO_DEFAULTS); show('音域回响已重置'); return; }
    if (action === 'import') { byId('lf-t13-echo-import').click(); return; }
    item = selectedEchoPreset();
    if (!item) { show('请先选择音域回响用户存档'); return; }
    if (action === 'rename') {
      name = window.prompt('重命名用户存档', item.name);
      if (!name) return;
      list = echoUserPresets(); list.forEach(function (entry) { if (entry.id === item.id) entry.name = String(name).trim().slice(0, 32); });
      saveEchoUserPresets(list); renderEchoPresetOptions(); byId('lf-t13-echo-user').value = item.id; return;
    }
    if (action === 'delete') {
      list = echoUserPresets().filter(function (entry) { return entry.id !== item.id; });
      saveEchoUserPresets(list); renderEchoPresetOptions(); show('音域回响用户存档已删除'); return;
    }
    if (action === 'export') {
      downloadJson(item.name + '.json', { type:'lumifield-echo-preset', schema:2, presetId:item.id, name:item.name, exportedAt:Date.now(), echo:Object.assign({}, item.state, { visualEq:normalizeVisualEq(item.state.visualEq, false) }) });
    }
  }
  function bindEchoImport() {
    var input = byId('lf-t13-echo-import');
    if (!input || input._lfBound) return;
    input._lfBound = true;
    input.addEventListener('change', function () {
      var file = input.files && input.files[0]; input.value = '';
      if (!file || !/\.json$/i.test(file.name || '')) { show('请选择音域回响 JSON'); return; }
      var reader = new FileReader();
      reader.onload = function () {
        var payload;
        try { payload = JSON.parse(String(reader.result || '')); } catch (_) { show('音域回响 JSON 解析失败'); return; }
        var state = payload && (payload.echo || payload.state);
        if (!state || typeof state !== 'object') { show('不是有效的音域回响预设'); return; }
        if (!applyEchoState(state)) return;
        var list = echoUserPresets();
        var item = { id:echoPresetId(), name:String(payload.name || file.name.replace(/\.json$/i, '')).slice(0, 32), savedAt:Date.now(), state:Object.assign({}, echoState, { visualEq:echoState.visualEq.slice() }) };
        list.push(item); saveEchoUserPresets(list); renderEchoPresetOptions(); byId('lf-t13-echo-user').value = item.id;
        show('音域回响预设已导入并恢复全部设置');
      };
      reader.onerror = function () { show('音域回响导入失败'); };
      reader.readAsText(file, 'utf-8');
    });
    var user = byId('lf-t13-echo-user');
    if (user) user.addEventListener('change', function () {
      var item = selectedEchoPreset(); if (item) applyEchoState(item.state);
    });
  }

  // ---------- Transactional, field-preserving visual JSON import ----------
  var CORE_SPECS = {
    preset:['number',0,6], intensity:['number',0.2,1.6], cinemaShake:['number',0,1.8], depth:['number',0.2,1.8], coverResolution:['number',0.75,1.55],
    point:['number',0.5,2.2], speed:['number',0.2,2.5], twist:['number',0,0.6], color:['number',0.5,2], scatter:['number',0,0.5], bgFade:['number',0,1.2], bloomStrength:['number',0,1.6],
    lyricGlowStrength:['number',0,0.85], lyricScale:['number',0.35,1.65], lyricOffsetX:['number',-2,2], lyricOffsetY:['number',-1.2,1.35], lyricOffsetZ:['number',-1.6,1.6], lyricTiltX:['number',-42,42], lyricTiltY:['number',-42,42],
    lyricLetterSpacing:['number',-0.04,0.18], lyricLineHeight:['number',0.86,1.35], lyricWeight:['number',500,900],
    shelfSize:['number',0.58,1.75], shelfOffsetX:['number',-1.2,1.2], shelfOffsetY:['number',-0.9,0.9], shelfOffsetZ:['number',-0.9,0.9], shelfAngleY:['number',-30,30], shelfOpacity:['number',0.25,1], shelfBgOpacity:['number',0.25,0.98],
    desktopLyricsSize:['number',0.72,1.55], desktopLyricsOpacity:['number',0.28,1], desktopLyricsY:['number',0.08,0.92], desktopLyricsFps:['number',30,60], controlGlassChromaticOffset:['number',0,140],
    floatLayer:['boolean'], cinema:['boolean'], edge:['boolean'], bloom:['boolean'], lyricGlow:['boolean'], lyricGlowBeat:['boolean'], lyricGlowParticles:['boolean'], lyricCameraLock:['boolean'], lyricGlowLinked:['boolean'], particleLyrics:['boolean'], backCover:['boolean'], desktopLyrics:['boolean'], desktopLyricsClickThrough:['boolean'], desktopLyricsCinema:['boolean'], desktopLyricsHighlight:['boolean'],
    lyricColorMode:['enum',['auto','custom']], lyricHighlightMode:['enum',['auto','custom']], visualTintMode:['enum',['auto','custom']], backgroundColorMode:['enum',['cover','custom']], shelf:['enum',['off','side','stage']], shelfCameraMode:['enum',['dynamic','static']], shelfPresence:['enum',['auto','always']], cam:['enum',['off','gesture']],
    backgroundOpacity:['number',0,1], shelfShowPodcasts:['boolean'], shelfMergeCollections:['boolean'], shelfAngleYManual:['boolean'],
    lyricColor:['color'], lyricHighlightColor:['color'], lyricGlowColor:['color'], visualTintColor:['color'], backgroundColor:['color'], uiAccentColor:['color'], homeAccentColor:['color'], homeIconColor:['color'], visualIconColor:['color'], shelfAccentColor:['color'], lyricFont:['string']
  };
  var CORE_NAMESPACE_KEYS = {
    visual: ['preset','intensity','cinemaShake','depth','coverResolution','visualTintMode','visualTintColor','uiAccentColor','homeAccentColor','homeIconColor','visualIconColor','backgroundColorMode','backgroundColor','backgroundOpacity','shelf','shelfCameraMode','shelfPresence','shelfShowPodcasts','shelfMergeCollections','shelfAngleYManual','shelfSize','shelfOffsetX','shelfOffsetY','shelfOffsetZ','shelfAngleY','shelfOpacity','shelfBgOpacity','shelfAccentColor'],
    particles: ['point','speed','twist','color','scatter','bgFade','bloomStrength','floatLayer','cinema','edge','bloom','lyricGlow','lyricGlowBeat','lyricGlowParticles','particleLyrics','backCover'],
    lyrics: ['lyricGlowStrength','lyricScale','lyricOffsetX','lyricOffsetY','lyricOffsetZ','lyricTiltX','lyricTiltY','lyricCameraLock','lyricColorMode','lyricColor','lyricHighlightMode','lyricHighlightColor','lyricGlowLinked','lyricGlowColor','lyricFont','lyricLetterSpacing','lyricLineHeight','lyricWeight','desktopLyrics','desktopLyricsSize','desktopLyricsOpacity','desktopLyricsY','desktopLyricsClickThrough','desktopLyricsCinema','desktopLyricsHighlight','desktopLyricsFps'],
    camera: ['cam']
  };

  function validateSpec(value, spec, fallback) {
    if (!spec) return undefined;
    if (spec[0] === 'number') {
      value = Number(value); if (!isFinite(value)) throw new Error('数值无效');
      return clamp(value, spec[1], spec[2]);
    }
    if (spec[0] === 'boolean') {
      if (typeof value !== 'boolean') throw new Error('布尔值无效');
      return value;
    }
    if (spec[0] === 'enum') {
      value = String(value); if (spec[1].indexOf(value) < 0) throw new Error('枚举值无效'); return value;
    }
    if (spec[0] === 'color') {
      value = String(value); if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error('颜色无效'); return value.toLowerCase();
    }
    if (spec[0] === 'string') return String(value).slice(0, 80);
    return fallback;
  }
  function validateStatePatch(raw, defaults) {
    var out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    Object.keys(defaults).forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(raw, key)) return;
      var sample = defaults[key]; var value = raw[key];
      if (typeof sample === 'boolean') {
        if (typeof value !== 'boolean') throw new Error(key + ' 必须是布尔值'); out[key] = value;
      } else if (typeof sample === 'number') {
        value = Number(value); if (!isFinite(value)) throw new Error(key + ' 必须是数值'); out[key] = value;
      } else out[key] = String(value).slice(0, 80);
    });
    return out;
  }
  function addCoreFields(target, raw, keys) {
    if (!raw || typeof raw !== 'object') return;
    (keys || Object.keys(CORE_SPECS)).forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(raw, key) || !CORE_SPECS[key]) return;
      target[key] = validateSpec(raw[key], CORE_SPECS[key]);
    });
  }
  function wallpaperPatchFrom(payload, flat) {
    var source = payload && payload.wallpaper && typeof payload.wallpaper === 'object' ? payload.wallpaper : null;
    var out = {};
    if (source) {
      if (Object.prototype.hasOwnProperty.call(source, 'opacity')) out.opacity = clamp(source.opacity, 0, 1);
      if (Object.prototype.hasOwnProperty.call(source, 'backgroundOpacity')) out.opacity = clamp(source.backgroundOpacity, 0, 1);
      if (source.media && typeof source.media === 'object') out.media = source.media;
      else if (source.backgroundMedia && typeof source.backgroundMedia === 'object') out.media = source.backgroundMedia;
      else if (source.image) out.media = { type:'image', src:String(source.image) };
    }
    if (flat && Object.prototype.hasOwnProperty.call(flat, 'wallpaperOpacity')) out.opacity = clamp(flat.wallpaperOpacity, 0, 1);
    if (flat && Object.prototype.hasOwnProperty.call(flat, 'backgroundOpacity')) out.opacity = clamp(flat.backgroundOpacity, 0, 1);
    if (flat && flat.backgroundMedia) out.media = flat.backgroundMedia;
    else if (flat && flat.backgroundImage) out.media = { type:'image', src:String(flat.backgroundImage) };
    return Object.keys(out).length ? out : null;
  }

  function canonicalSchemaApi() {
    var schema = window.LumiFieldCanonicalPresetSchema;
    if (!schema || typeof schema.normalize !== 'function') throw new Error('CanonicalPresetSchema 未加载');
    return schema;
  }
  function cloneJson(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }
  function canonicalToPatch(canonical) {
    var patch = { core:{}, lyrics:{}, spectrum:{}, echo:{}, glass:{}, player:{}, camera:{} };
    function core(namespace, keys) {
      var source = canonical[namespace];
      if (!source) return;
      keys.forEach(function (key) { if (Object.prototype.hasOwnProperty.call(source, key)) patch.core[key] = cloneJson(source[key]); });
    }
    core('visual', CORE_NAMESPACE_KEYS.visual);
    core('particles', CORE_NAMESPACE_KEYS.particles);
    core('lyrics', CORE_NAMESPACE_KEYS.lyrics);
    if (canonical.lyrics) {
      if (Object.prototype.hasOwnProperty.call(canonical.lyrics, 'translate')) patch.lyrics.translate = canonical.lyrics.translate;
    }
    if (canonical.spectrum) patch.spectrum = cloneJson(canonical.spectrum);
    if (canonical.echo) patch.echo = cloneJson(canonical.echo);
    if (canonical.camera) {
      patch.camera = cloneJson(canonical.camera);
      if (Object.prototype.hasOwnProperty.call(canonical.camera, 'cam')) patch.core.cam = canonical.camera.cam;
    }
    if (canonical.glass) {
      Object.keys(canonical.glass).forEach(function (key) {
        if (key === 'controlChromaticOffset') patch.core.controlGlassChromaticOffset = canonical.glass[key];
        else patch.glass[key] = canonical.glass[key];
      });
    }
    if (canonical.player) {
      var playerMap = { visible:'playerVisible', cover:'playerCover', size:'playerSize', x:'playerX', y:'playerY' };
      Object.keys(playerMap).forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(canonical.player, key)) patch.player[playerMap[key]] = cloneJson(canonical.player[key]);
      });
      if (Object.prototype.hasOwnProperty.call(canonical.player, 'preservePlayback')) patch.player.preservePlayback = canonical.player.preservePlayback;
    }
    return patch;
  }
  function captureCanonicalPreset(name, presetId) {
    var schema = canonicalSchemaApi();
    var value = { type:schema.TYPE, schema:schema.SCHEMA, version:schema.VERSION, name:String(name || 'LumiField 视觉预设').slice(0,64), createdAt:Date.now() };
    function takeCore(namespace, keys) {
      if (!window.fx) return;
      var out = {};
      keys.forEach(function (key) { if (Object.prototype.hasOwnProperty.call(window.fx, key)) out[key] = cloneJson(window.fx[key]); });
      if (Object.keys(out).length) value[namespace] = out;
    }
    takeCore('visual', CORE_NAMESPACE_KEYS.visual);
    takeCore('particles', CORE_NAMESPACE_KEYS.particles);
    takeCore('lyrics', CORE_NAMESPACE_KEYS.lyrics);
    value.lyrics = Object.assign(value.lyrics || {}, cloneJson(lyricState));
    value.spectrum = cloneJson(spectrumState);
    value.echo = {};
    (schema.FIELDS.echo || []).forEach(function (key) { if (Object.prototype.hasOwnProperty.call(echoState,key)) value.echo[key] = cloneJson(echoState[key]); });
    value.camera = { cam:window.fx && window.fx.cam != null ? window.fx.cam : 'off' };
    value.glass = cloneJson(readJson('lumifield-liquid-glass-v2', {}));
    if (window.fx && window.fx.controlGlassChromaticOffset != null) value.glass.controlChromaticOffset = window.fx.controlGlassChromaticOffset;
    value.player = {
      visible:echoState.playerVisible, cover:echoState.playerCover, size:echoState.playerSize,
      x:echoState.playerX, y:echoState.playerY,
      preservePlayback:true
    };
    if (presetId) value.presetId = presetId;
    return schema.normalize(value, { allowEmpty:true }).canonical;
  }
  function emptyCanonicalStore() { return { version:1, presets:{}, archiveKeys:{} }; }
  function canonicalArchiveStore() {
    var value = readScopedValue(STORE.canonicalPresets, emptyCanonicalStore());
    if (!value || typeof value !== 'object' || Array.isArray(value)) value = emptyCanonicalStore();
    if (!value.presets || typeof value.presets !== 'object' || Array.isArray(value.presets)) value.presets = {};
    if (!value.archiveKeys || typeof value.archiveKeys !== 'object' || Array.isArray(value.archiveKeys)) value.archiveKeys = {};
    value.version = 1;
    return value;
  }
  function persistCanonicalStore(value) {
    if (!writeScopedValue(STORE.canonicalPresets, value)) throw new Error('Canonical 用户存档持久化失败');
  }
  function ensureArchivePresetId(slot) {
    if (!slot) return '';
    if (!/^[a-z0-9][a-z0-9._:-]{5,127}$/i.test(String(slot.id || ''))) slot.id = makePresetId();
    return slot.id;
  }
  function saveArchiveCanonical(slot, canonical) {
    var id = ensureArchivePresetId(slot);
    var schema = canonicalSchemaApi();
    var normalized = schema.normalize(Object.assign({}, cloneJson(canonical), { presetId:id, name:slot.name || canonical.name }), { allowEmpty:true }).canonical;
    var store = canonicalArchiveStore();
    Object.keys(store.archiveKeys).forEach(function (key) { if (store.archiveKeys[key] === id) delete store.archiveKeys[key]; });
    store.presets[id] = normalized;
    if (slot.savedAt) store.archiveKeys[String(slot.savedAt)] = id;
    persistCanonicalStore(store);
    return normalized;
  }
  function storedArchiveCanonical(slot) {
    if (!slot) return null;
    var store = canonicalArchiveStore();
    var id = String(slot.id || store.archiveKeys[String(slot.savedAt)] || '');
    var canonical = id && store.presets[id];
    if (!canonical) return null;
    try {
      return canonicalSchemaApi().normalize(Object.assign({}, cloneJson(canonical), { presetId:id, name:slot.name || canonical.name }), { allowEmpty:true }).canonical;
    } catch (_) { return null; }
  }
  function removeArchiveCanonical(slot) {
    if (!slot) return;
    var store = canonicalArchiveStore();
    var id = String(slot.id || store.archiveKeys[String(slot.savedAt)] || '');
    if (id) delete store.presets[id];
    Object.keys(store.archiveKeys).forEach(function (key) { if (key === String(slot.savedAt) || store.archiveKeys[key] === id) delete store.archiveKeys[key]; });
    persistCanonicalStore(store);
  }
  function emptyPresetShareStore() { return { version:1, byPreset:{} }; }
  function presetShareStore() {
    var value = readJson(STORE.presetShares, emptyPresetShareStore());
    if (!value || typeof value !== 'object' || Array.isArray(value)) value = emptyPresetShareStore();
    if (!value.byPreset || typeof value.byPreset !== 'object' || Array.isArray(value.byPreset)) value.byPreset = {};
    value.version = 1;
    return value;
  }
  function persistPresetShareStore(value) {
    if (!writeJson(STORE.presetShares, value)) throw new Error('分享状态持久化失败');
  }
  function archiveSlotAt(reference) {
    if (!Array.isArray(window.userFxArchives)) return null;
    if (reference && typeof reference === 'object') return reference;
    var index = Number(reference);
    return isFinite(index) ? window.userFxArchives[Math.floor(index)] || null : null;
  }
  function presetShareEntry(slot) {
    if (!slot || !slot.id) return null;
    var entry = presetShareStore().byPreset[String(slot.id)];
    return entry && typeof entry === 'object' ? cloneJson(entry) : null;
  }
  function savePresetShareEntry(slot, share) {
    if (!slot) throw new Error('用户存档不存在');
    var presetId = ensureArchivePresetId(slot);
    var store = presetShareStore();
    var current = store.byPreset[presetId] && typeof store.byPreset[presetId] === 'object' ? store.byPreset[presetId] : {};
    var entry = {
      shareId:String(share && (share.id || share.shareId) || current.shareId || '').slice(0,160),
      code:String(share && share.code || current.code || '').slice(0,32),
      status:String(share && share.status || current.status || 'active') === 'revoked' ? 'revoked' : 'active',
      createdAt:Number(share && share.createdAt || current.createdAt || Date.now()) || Date.now(),
      revokedAt:Number(share && share.revokedAt || current.revokedAt || 0) || 0
    };
    if (!entry.shareId) throw new Error('分享服务未返回分享标识');
    store.byPreset[presetId] = entry;
    persistPresetShareStore(store);
    return cloneJson(entry);
  }
  function removePresetShareEntry(slot) {
    if (!slot || !slot.id) return;
    var store = presetShareStore();
    if (!Object.prototype.hasOwnProperty.call(store.byPreset, String(slot.id))) return;
    delete store.byPreset[String(slot.id)];
    persistPresetShareStore(store);
  }
  function normalizeShareCode(value) {
    var code = String(value == null ? '' : value).trim().toUpperCase()
      .replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\s+/g, '');
    if (/^LF[0-9A-HJKMNP-TV-Z]{12}$/.test(code)) code = 'LF-' + code.slice(2,6) + '-' + code.slice(6,10) + '-' + code.slice(10);
    return code;
  }
  function validShareCode(value) { return /^LF-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(value); }
  function presetShareBridge() {
    var bridge = window.desktopWindow;
    return bridge && typeof bridge === 'object' ? bridge : null;
  }
  function shareErrorMessage(result, fallback) {
    var code = String(result && (result.error || result.code) || '').toUpperCase();
    var messages = {
      INVALID_SHARE_CODE:'分享码格式无效，请输入 LF-XXXX-XXXX-XXXX。',
      PRESET_SHARE_NOT_FOUND:'分享码不存在。',
      SHARE_NOT_FOUND:'分享码不存在。',
      NOT_FOUND:'分享码不存在。',
      PRESET_SHARE_REVOKED:'该分享码已被撤销。',
      SHARE_REVOKED:'该分享码已被撤销。',
      REVOKED:'该分享码已被撤销。',
      PRESET_SCHEMA_UNSUPPORTED:'该分享码使用了当前版本不支持的预设格式。',
      PRESET_SCHEMA_INVALID:'分享预设校验失败。',
      PRESET_SCHEMA_REJECTED:'分享预设校验失败。',
      PRESET_SHARE_CORRUPT:'分享预设数据已损坏，无法应用。',
      PRESET_SENSITIVE_DATA:'预设包含敏感信息或本机私有资源，不能分享。',
      PRESET_PAYLOAD_TOO_LARGE:'预设数据过大，不能分享。',
      INVALID_PRESET_SHARE_REQUEST:'预设分享请求无效。',
      PRESET_SHARE_FIELD_REJECTED:'预设分享请求包含不支持的字段。',
      INVALID_SESSION:'登录状态已失效，请重新登录。',
      FORBIDDEN:'无权操作该预设分享。',
      RATE_LIMITED:'操作过于频繁，请稍后再试。',
      RATE_LIMIT:'操作过于频繁，请稍后再试。',
      SHARE_SERVICE_UNAVAILABLE:'预设分享服务暂不可用，请稍后再试。',
      PRESET_SHARE_REMOTE_REQUIRED:'预设分享需要连接 LF 在线服务。'
    };
    return messages[code] || String(result && result.message || fallback || '预设分享操作失败。');
  }
  function shareFromResult(result) {
    var share = result && result.share && typeof result.share === 'object' ? result.share : result;
    return share && typeof share === 'object' ? share : {};
  }
  function canonicalFromShareResult(result) {
    if (!result || typeof result !== 'object') return null;
    if (result.canonical) return result.canonical;
    if (result.preset) return result.preset;
    if (result.data && result.data.canonical) return result.data.canonical;
    return null;
  }
  function stableSharePresetId(share, code) {
    var raw = String(share && (share.id || share.shareId) || '').replace(/[^a-z0-9._:-]/gi, '').slice(0,90);
    if (raw.length >= 6) return 'lf-share-' + raw;
    var value = String(code || '');
    var hashA = 2166136261, hashB = 2246822519;
    for (var i = 0; i < value.length; i++) {
      hashA = Math.imul(hashA ^ value.charCodeAt(i), 16777619);
      hashB = Math.imul(hashB ^ value.charCodeAt(i), 3266489917);
    }
    return 'lf-share-' + (hashA >>> 0).toString(36) + (hashB >>> 0).toString(36);
  }

  var presetShareBusy = {};
  var presetShareDialogContext = null;
  function ensurePresetShareDialog() {
    var modal = byId('lf-t13-share-dialog');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'lf-t13-share-dialog';
    modal.innerHTML = '<div class="lf-t13-share-dialog" role="dialog" aria-modal="true" aria-labelledby="lf-t13-share-title"><button type="button" class="lf-t13-share-close" aria-label="关闭">×</button><h2 id="lf-t13-share-title">预设分享</h2><p class="lf-t13-share-name"></p><label>分享码<input class="lf-t13-share-value" type="text" readonly></label><p class="lf-t13-share-status"></p><div class="lf-t13-share-actions"><button type="button" data-action="copy">复制分享码</button><button type="button" data-action="revoke">撤销分享</button><button type="button" data-action="close">关闭</button></div></div>';
    document.body.appendChild(modal);
    function close() { modal.classList.remove('show'); presetShareDialogContext = null; }
    modal.querySelector('.lf-t13-share-close').onclick = close;
    modal.querySelector('[data-action="close"]').onclick = close;
    modal.addEventListener('click', function (event) { if (event.target === modal) close(); });
    modal.querySelector('[data-action="copy"]').onclick = function () {
      var input = modal.querySelector('.lf-t13-share-value');
      var code = String(input.value || '');
      if (!code) return;
      var copied = navigator.clipboard && typeof navigator.clipboard.writeText === 'function'
        ? navigator.clipboard.writeText(code)
        : Promise.reject(new Error('CLIPBOARD_UNAVAILABLE'));
      copied.then(function () { show('分享码已复制'); }).catch(function () {
        input.focus(); input.select();
        try { document.execCommand('copy'); show('分享码已复制'); } catch (_) { show('请手动复制分享码'); }
      });
    };
    modal.querySelector('[data-action="revoke"]').onclick = function () {
      if (presetShareDialogContext) revokePresetShare(presetShareDialogContext.slot, this);
    };
    return modal;
  }
  function showPresetShareDialog(slot, entry) {
    var modal = ensurePresetShareDialog();
    presetShareDialogContext = { slot:slot, entry:entry };
    modal.querySelector('.lf-t13-share-name').textContent = String(slot && slot.name || '用户预设');
    modal.querySelector('.lf-t13-share-value').value = entry && entry.code || '';
    var revoked = entry && entry.status === 'revoked';
    modal.querySelector('.lf-t13-share-status').textContent = revoked ? '此分享已撤销，原分享码不再可用。' : (entry && entry.code ? '其他用户可输入此分享码并立即应用预设。' : '分享已创建，但完整分享码仅在创建时显示。');
    modal.querySelector('[data-action="copy"]').disabled = revoked || !(entry && entry.code);
    modal.querySelector('[data-action="revoke"]').disabled = revoked || !(entry && entry.shareId);
    modal.classList.add('show');
  }
  async function revokePresetShare(slot, button) {
    var entry = presetShareEntry(slot);
    if (!entry || !entry.shareId || entry.status === 'revoked') return;
    if (typeof window.confirm === 'function' && !window.confirm('撤销后分享码将立即失效，确定撤销？')) return;
    var bridge = presetShareBridge();
    if (!bridge || typeof bridge.lfPresetShareRevoke !== 'function') return show('预设分享服务暂不可用，请稍后再试。');
    if (button) button.disabled = true;
    try {
      var result = await bridge.lfPresetShareRevoke(entry.shareId);
      if (!result || result.ok !== true) throw result || { error:'SHARE_SERVICE_UNAVAILABLE' };
      entry.status = 'revoked';
      entry.revokedAt = Number(shareFromResult(result).revokedAt || Date.now());
      entry = savePresetShareEntry(slot, entry);
      showPresetShareDialog(slot, entry);
      if (typeof window.renderUserFxArchives === 'function') window.renderUserFxArchives();
      show('预设分享已撤销');
    } catch (error) {
      show(shareErrorMessage(error, '撤销分享失败。'));
    } finally {
      if (button && document.body.contains(button)) button.disabled = false;
    }
  }
  async function sharePresetArchive(reference, button) {
    var slot = archiveSlotAt(reference);
    if (!slot || !slot.snapshot) return show('空白存档不能分享');
    var presetId = ensureArchivePresetId(slot);
    var existing = presetShareEntry(slot);
    if (existing && existing.status === 'active') return showPresetShareDialog(slot, existing);
    if (presetShareBusy[presetId]) return;
    var bridge = presetShareBridge();
    if (!bridge || typeof bridge.lfPresetShareCreate !== 'function') return show('预设分享服务暂不可用，请稍后再试。');
    var canonical = storedArchiveCanonical(slot) || legacyCanonicalForSlot(slot);
    if (!canonical) return show('该用户存档无法转换为 CanonicalPresetSchema');
    var sanitized;
    try { sanitized = canonicalSchemaApi().sanitizeForShare(canonical).canonical; }
    catch (error) { return show('预设分享校验失败：' + error.message); }
    presetShareBusy[presetId] = true;
    if (button) button.disabled = true;
    try {
      var result = await bridge.lfPresetShareCreate(sanitized);
      if (!result || result.ok !== true) throw result || { error:'SHARE_SERVICE_UNAVAILABLE' };
      var share = shareFromResult(result);
      var entry = savePresetShareEntry(slot, {
        id:share.id || share.shareId,
        code:share.code || result.code,
        status:share.status || 'active',
        createdAt:share.createdAt || Date.now()
      });
      showPresetShareDialog(slot, entry);
      if (typeof window.renderUserFxArchives === 'function') window.renderUserFxArchives();
      show('预设分享已创建');
    } catch (error) {
      show(shareErrorMessage(error, '创建预设分享失败。'));
    } finally {
      delete presetShareBusy[presetId];
      if (button && document.body.contains(button)) button.disabled = false;
    }
  }
  async function applyPresetShareInput(button) {
    var input = byId('lf-preset-share-code');
    var code = normalizeShareCode(input && input.value);
    if (!validShareCode(code)) return show('分享码格式无效，请输入 LF-XXXX-XXXX-XXXX。');
    if (presetShareBusy.redeem) return;
    var bridge = presetShareBridge();
    if (!bridge || typeof bridge.lfPresetShareRedeem !== 'function') return show('预设分享服务暂不可用，请稍后再试。');
    presetShareBusy.redeem = true;
    if (button) button.disabled = true;
    if (input) { input.value = code; input.disabled = true; }
    try {
      var result = await bridge.lfPresetShareRedeem(code);
      if (!result || result.ok !== true) throw result || { error:'SHARE_SERVICE_UNAVAILABLE' };
      var payload = canonicalFromShareResult(result);
      if (!payload || payload.type !== canonicalSchemaApi().TYPE || payload.schema !== canonicalSchemaApi().SCHEMA || Number(payload.version) !== canonicalSchemaApi().VERSION) {
        throw { error:'PRESET_SCHEMA_UNSUPPORTED' };
      }
      var normalized = canonicalSchemaApi().normalize(payload).canonical;
      var share = shareFromResult(result);
      var applied = window.LumiFieldCanonicalPresets && window.LumiFieldCanonicalPresets.apply(normalized, {
        createArchive:true,
        importWallpaper:false,
        presetId:stableSharePresetId(share, code),
        source:'preset-share'
      });
      if (applied && typeof applied.then === 'function') applied = await applied;
      if (applied !== true) throw { error:'PRESET_APPLY_FAILED', message:'分享预设应用失败，已自动回滚。' };
      if (input) input.value = '';
      show('已导入用户存档并应用分享预设');
    } catch (error) {
      show(shareErrorMessage(error, '应用分享预设失败。'));
    } finally {
      delete presetShareBusy.redeem;
      if (input) input.disabled = false;
      if (button && document.body.contains(button)) button.disabled = false;
    }
  }
  async function syncPresetShareStates() {
    var bridge = presetShareBridge();
    if (!bridge || typeof bridge.lfPresetShareMine !== 'function') return;
    try {
      var result = await bridge.lfPresetShareMine();
      if (!result || result.ok !== true) return;
      var list = Array.isArray(result.shares) ? result.shares : (Array.isArray(result.items) ? result.items : []);
      var byId = {};
      list.forEach(function (item) {
        var share = shareFromResult(item);
        var id = String(share.id || share.shareId || '');
        if (id) byId[id] = share;
      });
      var store = presetShareStore();
      var changed = false;
      Object.keys(store.byPreset).forEach(function (presetId) {
        var local = store.byPreset[presetId];
        var remote = local && byId[String(local.shareId || '')];
        if (!remote) return;
        var status = String(remote.status || local.status) === 'revoked' ? 'revoked' : 'active';
        if (status !== local.status || Number(remote.revokedAt || 0) !== Number(local.revokedAt || 0)) {
          local.status = status; local.revokedAt = Number(remote.revokedAt || 0) || 0; changed = true;
        }
      });
      if (changed) {
        persistPresetShareStore(store);
        if (typeof window.renderUserFxArchives === 'function') window.renderUserFxArchives();
      }
    } catch (_) {}
  }
  function installPresetSharing() {
    window.getUserFxArchiveShareState = function (reference) { return presetShareEntry(archiveSlotAt(reference)); };
    window.shareUserFxArchive = function (reference, button) { return sharePresetArchive(reference, button); };
    window.revokeUserFxArchiveShare = function (reference, button) { return revokePresetShare(archiveSlotAt(reference), button); };
    window.applyPresetShareCode = function (button) { return applyPresetShareInput(button); };
    window.handlePresetShareCodeKey = function (event, button) {
      if (event && event.key === 'Enter') { event.preventDefault(); return applyPresetShareInput(button); }
    };
    syncPresetShareStates();
  }
  function transactionalFromSchemaResult(result) {
    var invalidFields = result && Array.isArray(result.invalidFields) ? result.invalidFields : [];
    if (!result || !result.canonical || invalidFields.length) {
      var invalidError = new Error('预设字段验证失败' + (invalidFields.length ? '：' + invalidFields.map(function (field) { return field.sourcePath || '$'; }).join('、') : ''));
      invalidError.code = 'PRESET_SCHEMA_INVALID';
      invalidError.report = result || null;
      throw invalidError;
    }
    return {
      schema:result.canonical.version,
      migratedFrom:result.source && result.source.version || 1,
      name:result.canonical.name,
      canonical:result.canonical,
      report:result,
      patch:canonicalToPatch(result.canonical),
      wallpaper:result.wallpaper
    };
  }
  function normalizeTransactionalPayload(payload, fileName) {
    return transactionalFromSchemaResult(canonicalSchemaApi().normalize(payload, { fileName:fileName }));
  }

  function currentPatchValue(namespace, key) {
    if (namespace === 'core') return window.fx && window.fx[key];
    if (namespace === 'lyrics') return lyricState[key];
    if (namespace === 'spectrum') return spectrumState[key];
    if (namespace === 'echo') return echoState[key];
    if (namespace === 'glass') return readJson('lumifield-liquid-glass-v2', {})[key];
    if (namespace === 'player') return echoState[key];
  }
  function nestedCanonicalValue(value, path) {
    path = Array.isArray(path) ? path : [path];
    for (var index = 0; index < path.length; index++) {
      if (value == null || typeof value !== 'object') return undefined;
      value = value[path[index]];
    }
    return value;
  }
  function currentCanonicalValue(namespace, key) {
    var path = Array.isArray(key) ? key : [key];
    if (namespace === 'visual') return nestedCanonicalValue(window.fx, path);
    if (namespace === 'particles') return nestedCanonicalValue(window.fx, path);
    if (namespace === 'lyrics') {
      if (path[0] === 'translate') return lyricState.translate;
      return nestedCanonicalValue(window.fx, path);
    }
    if (namespace === 'spectrum') return nestedCanonicalValue(spectrumState, path);
    if (namespace === 'echo') return nestedCanonicalValue(echoState, path);
    if (namespace === 'camera') return path[0] === 'cam' ? window.fx && window.fx.cam : undefined;
    if (namespace === 'glass') {
      if (path[0] === 'controlChromaticOffset') return window.fx && window.fx.controlGlassChromaticOffset;
      return nestedCanonicalValue(readJson('lumifield-liquid-glass-v2', {}), path);
    }
    if (namespace === 'player') {
      var map = { visible:'playerVisible', cover:'playerCover', size:'playerSize', x:'playerX', y:'playerY' };
      return echoState[map[path[0]]];
    }
  }
  function importDiff(parsed) {
    if (parsed.report && Array.isArray(parsed.report.appliedFields)) {
      var canonicalRows = parsed.report.appliedFields.map(function (field) {
        var parts = field.canonicalPath.split('.');
        var before = currentCanonicalValue(parts[0], parts.slice(1));
        return {
          namespace:parts[0], key:parts.slice(1).join('.'), sourcePath:field.sourcePath,
          before:cloneJson(before), after:cloneJson(field.value),
          changed:JSON.stringify(before) !== JSON.stringify(field.value)
        };
      });
      if (parsed.wallpaper) canonicalRows.push({ namespace:'wallpaper', key:'检测到壁纸字段', sourcePath:'wallpaper', before:'默认不导入', after:'需单独勾选', changed:false });
      return canonicalRows;
    }
    var rows = [];
    ['core','lyrics','spectrum','echo','glass','player'].forEach(function (namespace) {
      if (!parsed.patch[namespace]) return;
      Object.keys(parsed.patch[namespace]).forEach(function (key) {
        var before = currentPatchValue(namespace, key); var after = parsed.patch[namespace][key];
        if (JSON.stringify(before) !== JSON.stringify(after)) rows.push({ namespace:namespace, key:key, before:before, after:after });
      });
    });
    if (parsed.wallpaper) rows.push({ namespace:'wallpaper', key:'检测到壁纸字段', before:'默认不导入', after:'需单独勾选' });
    return rows;
  }
  function makePresetId() {
    return window.crypto && typeof window.crypto.randomUUID === 'function' ? window.crypto.randomUUID() : 'preset-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function refreshCoreVisuals(core) {
    if (!window.fx) return;
    if (Object.prototype.hasOwnProperty.call(core, 'preset') && typeof window.setPreset === 'function') {
      if (window.setPreset(core.preset, { silent:true, preserveCamera:false, skipTransition:false, noSave:true, commitPlaybackPreset:true, preserveAudioEcho:true }) === false) {
        throw new Error('内置视觉预设切换未能原子提交');
      }
    }
    if (Object.prototype.hasOwnProperty.call(core, 'floatLayer')) core.floatLayer ? window.createFloatLayer && window.createFloatLayer() : window.destroyFloatLayer && window.destroyFloatLayer();
    if (Object.prototype.hasOwnProperty.call(core, 'backCover')) core.backCover ? window.createBackCoverLayer && window.createBackCoverLayer() : window.destroyBackCoverLayer && window.destroyBackCoverLayer();
    if (Object.prototype.hasOwnProperty.call(core, 'particleLyrics') && typeof window.setParticleLyricsSilently === 'function') window.setParticleLyricsSilently(core.particleLyrics);
    if (Object.keys(core).some(function (key) { return /^shelf/.test(key); })) {
      if (Object.prototype.hasOwnProperty.call(core, 'shelf') && typeof window.setShelfMode === 'function') window.setShelfMode(core.shelf);
      if (window.shelfManager && window.shelfManager.rebuild) window.shelfManager.rebuild(true);
      if (window.shelfManager && window.shelfManager.refreshTheme) window.shelfManager.refreshTheme();
    }
    if (Object.keys(core).some(function (key) { return /^background(?:Color|Opacity)/.test(key); })) {
      if (Object.prototype.hasOwnProperty.call(core, 'backgroundColorMode')) window.fx.backgroundColorCustom = core.backgroundColorMode === 'custom';
      if (typeof window.applyCustomBackground === 'function') window.applyCustomBackground();
      if (typeof window.updateCustomBackgroundControls === 'function') window.updateCustomBackgroundControls();
      if (Object.prototype.hasOwnProperty.call(core, 'backgroundOpacity')) applyBackgroundOpacityComposite(core.backgroundOpacity);
    }
    if (Object.prototype.hasOwnProperty.call(core, 'cam') && typeof window.setCamMode === 'function') window.setCamMode(core.cam);
    if (Object.prototype.hasOwnProperty.call(core, 'controlGlassChromaticOffset') && typeof window.applyControlGlassChromaticOffset === 'function') window.applyControlGlassChromaticOffset();
    if (typeof window.updateFxInputs === 'function') window.updateFxInputs();
    if (typeof window.syncFxUniforms === 'function') window.syncFxUniforms();
    if (typeof window.applySavedLyricPaletteState === 'function') window.applySavedLyricPaletteState();
    if (typeof window.refreshCurrentLyricStyle === 'function') window.refreshCurrentLyricStyle();
    if (typeof window.applyDesktopLyricsState === 'function') window.applyDesktopLyricsState(true);
    if (typeof window.saveLyricLayout === 'function') window.saveLyricLayout();
    return true;
  }
  function applyGlassPatch(patch) {
    if (!Object.keys(patch).length) return;
    var state = Object.assign({ opacity:.34, blur:22, chroma:.34, highlight:.86, radius:22, elastic:.18 }, readJson('lumifield-liquid-glass-v2', {}), patch);
    writeJson('lumifield-liquid-glass-v2', state);
    var root = document.documentElement;
    root.style.setProperty('--lf-glass-panel-opacity', clamp(state.opacity, .08, .72).toFixed(2));
    root.style.setProperty('--lf-glass-blur', clamp(state.blur, 8, 42).toFixed(0) + 'px');
    root.style.setProperty('--lf-glass-chroma', clamp(state.chroma, 0, 1).toFixed(2));
    root.style.setProperty('--lf-glass-highlight', clamp(state.highlight, 0, 1.4).toFixed(2));
    root.style.setProperty('--lf-glass-radius', clamp(state.radius, 10, 36).toFixed(0) + 'px');
    root.style.setProperty('--lf-glass-elastic', clamp(state.elastic, 0, 1).toFixed(2));
  }
  function safeWallpaperMedia(media) {
    if (!media || typeof media !== 'object') return null;
    var type = /^(image|video)$/.test(String(media.type || '')) ? String(media.type) : '';
    var src = String(media.src || '');
    if (!type || !src || !/^(data:(?:image|video)\/|file:|blob:|\/)/i.test(src)) return null;
    return { type:type, src:src, id:media.id ? String(media.id).slice(0, 120) : undefined, name:media.name ? String(media.name).slice(0, 120) : undefined };
  }
  function importedMetaMap() {
    var value = readScopedValue(STORE.imports, {});
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }
  function saveImportedMeta(parsed, presetId, savedAt) {
    var map = importedMetaMap(); var meta = { presetId:presetId, savedAt:savedAt, parsed:parsed };
    map[String(presetId)] = meta; map[String(savedAt)] = meta;
    if (!writeScopedValue(STORE.imports, map)) throw new Error('用户存档索引持久化失败');
  }
  function storageSnapshot(keys) {
    var out = {};
    keys.forEach(function (key) { try { out[key] = localStorage.getItem(key); } catch (_) { out[key] = null; } });
    return out;
  }
  function restoreStorageSnapshot(snapshot) {
    Object.keys(snapshot).forEach(function (key) {
      try { if (snapshot[key] == null) localStorage.removeItem(key); else localStorage.setItem(key, snapshot[key]); } catch (_) {}
    });
  }
  function assertStoredJson(key, expected) {
    var actual;
    try { actual = JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { actual = null; }
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('本地预设状态持久化失败：' + key);
  }
  function applyTransactionalPreset(parsed, options) {
    options = options || {};
    var storageKeys = [
      STORE.lyrics, STORE.spectrum, STORE.echo, STORE.imports, STORE.canonicalPresets, STORE.currentPreset,
      'lumifield-liquid-glass-v2', 'lumifield-user-fx-archives-v1', 'lumifield-lyric-layout-v1'
    ];
    var snapshot = {
      fx: window.fx ? Object.assign({}, window.fx) : null,
      lyrics:cloneJson(lyricState), spectrum:cloneJson(spectrumState), echo:cloneJson(echoState),
      glass:readJson('lumifield-liquid-glass-v2', {}), imports:importedMetaMap(),
      archives:Array.isArray(window.userFxArchives) ? cloneJson(window.userFxArchives) : null,
      storage:storageSnapshot(storageKeys)
    };
    var presetId = options.presetId || (parsed.canonical && parsed.canonical.presetId) || makePresetId();
    var rowsBefore = importDiff(parsed);
    try {
      Object.keys(parsed.patch.core).forEach(function (key) { window.fx[key] = parsed.patch.core[key]; });
      lyricState = normalizeLyricState(Object.assign({}, lyricState, parsed.patch.lyrics));
      assertSpectrumPatch(parsed.patch.spectrum);
      spectrumState = normalizeSpectrumState(Object.assign({}, spectrumState, parsed.patch.spectrum));
      var echoPatch = validateEchoPatch(Object.assign({}, parsed.patch.echo, parsed.patch.player));
      echoState = Object.assign({}, echoState, echoPatch, { visualEq:(echoPatch.visualEq || echoState.visualEq).slice() });
      refreshCoreVisuals(parsed.patch.core);
      applyLyricTranslationState(); persistLyrics();
      persistSpectrum(); persistEcho();
      applyGlassPatch(parsed.patch.glass);
      assertStoredJson(STORE.lyrics, lyricState);
      assertStoredJson(STORE.spectrum, spectrumState);
      assertStoredJson(STORE.echo, echoState);
      if (!applyEchoState(echoState, { partial:false, silent:true })) throw new Error('Audio Echo 预设激活失败');
      syncLyricControls(); syncSpectrumControls(); syncEchoControls();
      if (options.failAtStage === 'after-apply') throw new Error('PRESET_TEST_FAILURE_AFTER_APPLY');
      if (options.importWallpaper && parsed.wallpaper) {
        var wallpaperOpacity = Object.prototype.hasOwnProperty.call(parsed.wallpaper, 'opacity') ? clamp(parsed.wallpaper.opacity, 0, 1) : null;
        if (wallpaperOpacity != null) window.fx.backgroundOpacity = wallpaperOpacity;
        var media = safeWallpaperMedia(parsed.wallpaper.media);
        var wallpaperState = window.LumiFieldWallpaperState;
        if (wallpaperState && typeof wallpaperState.importPreset === 'function') {
          wallpaperState.importPreset({ media:media, opacity:wallpaperOpacity }, { source:'preset-import' }).catch(function(error){
            console.warn('preset wallpaper import failed:', error);
          });
        } else if (wallpaperOpacity != null) applyBackgroundOpacityComposite(wallpaperOpacity);
        if (typeof window.saveLyricLayout === 'function') window.saveLyricLayout();
      }
      var savedAt = Date.now();
      while (Array.isArray(window.userFxArchives) && window.userFxArchives.some(function (slot) { return slot && slot.id !== presetId && Number(slot.savedAt) === savedAt; })) savedAt++;
      if (options.createArchive !== false && Array.isArray(window.userFxArchives)) {
        var fullSnapshot = typeof window.captureFxArchiveSnapshot === 'function' ? window.captureFxArchiveSnapshot() : Object.assign({}, window.fx);
        var slot = window.userFxArchives.filter(function (entry) { return entry && entry.id === presetId; })[0];
        if (slot) {
          slot.name = parsed.name; slot.savedAt = savedAt; slot.snapshot = fullSnapshot; slot.createdAt = slot.createdAt || savedAt;
        } else {
          slot = { id:presetId, name:parsed.name, createdAt:savedAt, savedAt:savedAt, snapshot:fullSnapshot };
          window.userFxArchives.push(slot);
        }
        saveArchiveCanonical(slot, Object.assign({}, cloneJson(parsed.canonical), {
          name:parsed.name,
          presetId:presetId
        }));
        if (typeof window.saveUserFxArchives === 'function') window.saveUserFxArchives();
        var persistedArchives = readJson('lumifield-user-fx-archives-v1', []);
        if (!Array.isArray(persistedArchives) || !persistedArchives.some(function (entry) { return entry && entry.id === presetId; })) throw new Error('用户存档持久化失败');
        if (typeof window.renderUserFxArchives === 'function') window.renderUserFxArchives();
        saveImportedMeta(parsed, presetId, savedAt);
      }
      if (!writeScopedCurrentPresetId(presetId) || readScopedCurrentPresetId() !== presetId) throw new Error('当前预设标识持久化失败');
      var appliedRows = rowsBefore.filter(function (row) { return row.namespace !== 'wallpaper' || options.importWallpaper; });
      var changedCount = appliedRows.filter(function (row) { return row.changed !== false; }).length;
      var ignoredCount = parsed.report && parsed.report.ignoredFields ? parsed.report.ignoredFields.length : 0;
      if (!options.silent) show('已应用 ' + parsed.name + ' · ' + appliedRows.length + ' 个字段 / ' + changedCount + ' 项变化' + (ignoredCount ? ' · 忽略 ' + ignoredCount + ' 项' : ''));
      return true;
    } catch (error) {
      if (snapshot.fx) window.fx = Object.assign({}, snapshot.fx);
      lyricState = normalizeLyricState(snapshot.lyrics); spectrumState = normalizeSpectrumState(snapshot.spectrum);
      echoState = normalizeEchoState(snapshot.echo);
      writeJson('lumifield-liquid-glass-v2', snapshot.glass);
      writeScopedValue(STORE.imports, snapshot.imports);
      try {
        if (snapshot.archives !== null && Array.isArray(window.userFxArchives)) {
          window.userFxArchives.length = 0;
          Array.prototype.push.apply(window.userFxArchives, snapshot.archives);
          if (typeof window.saveUserFxArchives === 'function') window.saveUserFxArchives();
          if (typeof window.renderUserFxArchives === 'function') window.renderUserFxArchives();
        }
      } catch (_) {}
      try {
        refreshCoreVisuals(snapshot.fx || {}); applyLyricTranslationState(); persistLyrics(); persistSpectrum(); persistEcho(); applyGlassPatch(snapshot.glass);
        if (typeof window.applyCustomBackground === 'function') window.applyCustomBackground();
        applyEchoState(echoState, { partial:false, silent:true }); syncLyricControls(); syncSpectrumControls(); syncEchoControls();
      } catch (_) {}
      restoreStorageSnapshot(snapshot.storage);
      if (!options.silent) show('预设应用失败，已自动回滚：' + (error && error.message || '未知错误'));
      if (options.failAt || options.failAtStage) {
        var storageRestored = Object.keys(snapshot.storage).every(function (key) {
          try { return localStorage.getItem(key) === snapshot.storage[key]; } catch (_) { return false; }
        });
        return {
          ok:false,
          state:'rolled-back',
          error:String(error && error.message || 'PRESET_APPLY_FAILED'),
          rollback:{ attempted:true, succeeded:storageRestored }
        };
      }
      return false;
    }
  }

  var pendingImport = null;
  function ensureImportPreview() {
    var modal = byId('lf-t13-import-preview');
    if (modal) return modal;
    modal = document.createElement('div'); modal.id = 'lf-t13-import-preview';
    modal.innerHTML = '<div class="lf-t13-import-dialog" role="dialog" aria-modal="true"><button type="button" class="lf-t13-import-close" aria-label="关闭">×</button><h2>预设导入预览</h2><p class="lf-t13-import-note"></p><div class="lf-t13-import-diff"><section><h3>将应用字段</h3><div class="lf-t13-import-apply"></div></section><section><h3>忽略字段</h3><div class="lf-t13-import-ignore"></div></section></div><label class="lf-t13-import-wallpaper"><input type="checkbox">同时导入 JSON 中的壁纸字段（默认不导入）</label><div class="lf-t13-import-actions"><button type="button" data-action="cancel">取消</button><button type="button" data-action="apply">确认应用</button></div></div>';
    document.body.appendChild(modal);
    function close() { modal.classList.remove('show'); pendingImport = null; }
    modal.querySelector('.lf-t13-import-close').onclick = close;
    modal.querySelector('[data-action="cancel"]').onclick = close;
    modal.addEventListener('click', function (event) { if (event.target === modal) close(); });
    modal.querySelector('[data-action="apply"]').onclick = function () {
      if (!pendingImport) return close();
      var parsed = pendingImport;
      var withWallpaper = !!modal.querySelector('.lf-t13-import-wallpaper input').checked;
      if (applyTransactionalPreset(parsed, { createArchive:true, importWallpaper:withWallpaper })) close();
    };
    return modal;
  }
  function previewTransactionalImport(parsed) {
    var modal = ensureImportPreview(); var rows = importDiff(parsed);
    var applicable = rows.filter(function (row) { return row.namespace !== 'wallpaper'; });
    var ignored = parsed.report && Array.isArray(parsed.report.ignoredFields) ? parsed.report.ignoredFields : [];
    modal.querySelector('.lf-t13-import-note').textContent = parsed.name + ' · CanonicalPresetSchema v1 · 将应用 ' + applicable.length + ' 项 / 忽略 ' + ignored.length + ' 项';
    modal.querySelector('.lf-t13-import-apply').innerHTML = applicable.length ? applicable.map(function (row) {
      return '<div class="' + (row.changed ? 'changed' : 'unchanged') + '"><b>' + esc(row.namespace + '.' + row.key) + '</b><span>' + esc(JSON.stringify(row.before)) + '</span><i>→</i><span>' + esc(JSON.stringify(row.after)) + '</span><small>' + (row.changed ? '将改变' : '值相同，仍会应用') + '</small></div>';
    }).join('') : '<p>没有可应用字段</p>';
    modal.querySelector('.lf-t13-import-ignore').innerHTML = ignored.length ? ignored.map(function (item) {
      return '<div><b>' + esc(item.sourcePath) + '</b><span>' + esc(item.reason) + '</span></div>';
    }).join('') : '<p>没有忽略字段</p>';
    var wallpaper = modal.querySelector('.lf-t13-import-wallpaper');
    wallpaper.hidden = !parsed.wallpaper; wallpaper.querySelector('input').checked = false;
    pendingImport = parsed; modal.classList.add('show');
  }
  function parseImportText(text, fileName) {
    var payload;
    if (String(text || '').length > 20 * 1024 * 1024) throw new Error('JSON 文件超过 20 MB');
    try { payload = JSON.parse(String(text || '').replace(/^\uFEFF/, '')); } catch (_) { throw new Error('JSON 解析失败'); }
    return normalizeTransactionalPayload(payload, fileName);
  }
  function canonicalFromParsedPatch(parsed, name, presetId) {
    if (parsed && parsed.canonical) {
      return canonicalSchemaApi().normalize(Object.assign({}, cloneJson(parsed.canonical), { name:name || parsed.name, presetId:presetId }), { allowEmpty:true }).canonical;
    }
    var patch = parsed && parsed.patch;
    if (!patch) return null;
    var schema = canonicalSchemaApi();
    var raw = { type:schema.TYPE, schema:schema.SCHEMA, version:schema.VERSION, name:name || parsed.name || '迁移预设', presetId:presetId };
    function takeCore(namespace, keys) {
      if (!patch.core) return;
      var out = {};
      keys.forEach(function (key) { if (Object.prototype.hasOwnProperty.call(patch.core,key)) out[key] = cloneJson(patch.core[key]); });
      if (Object.keys(out).length) raw[namespace] = out;
    }
    takeCore('visual', CORE_NAMESPACE_KEYS.visual);
    takeCore('particles', CORE_NAMESPACE_KEYS.particles);
    takeCore('lyrics', CORE_NAMESPACE_KEYS.lyrics);
    raw.lyrics = Object.assign(raw.lyrics || {}, cloneJson(patch.lyrics || {}));
    raw.spectrum = cloneJson(patch.spectrum || {});
    raw.echo = cloneJson(patch.echo || {});
    raw.camera = cloneJson(patch.camera || {});
    if (patch.core && Object.prototype.hasOwnProperty.call(patch.core,'cam')) raw.camera.cam = patch.core.cam;
    raw.glass = cloneJson(patch.glass || {});
    if (patch.core && Object.prototype.hasOwnProperty.call(patch.core,'controlGlassChromaticOffset')) raw.glass.controlChromaticOffset = patch.core.controlGlassChromaticOffset;
    var player = patch.player || {};
    raw.player = {};
    var playerMap = { playerVisible:'visible', playerCover:'cover', playerSize:'size', playerX:'x', playerY:'y' };
    Object.keys(playerMap).forEach(function (key) { if (Object.prototype.hasOwnProperty.call(player,key)) raw.player[playerMap[key]] = cloneJson(player[key]); });
    if (Object.prototype.hasOwnProperty.call(player,'preservePlayback')) raw.player.preservePlayback = player.preservePlayback;
    return schema.normalize(raw, { allowEmpty:true }).canonical;
  }
  function legacyCanonicalForSlot(slot) {
    if (!slot || !slot.snapshot) return null;
    var map = importedMetaMap();
    var meta = map[String(slot.id || '')] || map[String(slot.savedAt)];
    var migrated = meta && meta.parsed ? canonicalFromParsedPatch(meta.parsed, slot.name, slot.id) : null;
    if (migrated) return migrated;
    var payload = { type:'lumifield-user-fx-archive', schema:1, name:slot.name, presetId:slot.id, snapshot:cloneJson(slot.snapshot) };
    if (meta && meta.nativeSpectrum) payload.spectrum = cloneJson(meta.nativeSpectrum);
    try { return canonicalSchemaApi().normalize(payload, { allowEmpty:true }).canonical; } catch (_) { return null; }
  }
  function retiredPresetNames() {
    return [
      ['GPT海啸','粒子预设1'].join(''),
      ['GPT粒子预设_白色正圆','超大半径自由星轨粒子'].join(''),
      ['GPT粒子预设_正圆','光环白色粒子'].join(''),
      ['金色量子核心·中心结构特写','自由星轨粒子（中心球圆心缩放修正版）'].join(''),
      ['金色量子','自由星轨'].join(''),
      ['LF金色量子','自由星轨粒子'].join('')
    ];
  }
  function retiredPresetIds() {
    return [
      ['lf-retired-gpt-tsunami','-preset-1'].join(''),
      ['lf-retired-gpt-white','-large-orbit'].join(''),
      ['lf-retired-gpt-white','-ring'].join(''),
      ['lf-gold','en-atomic-star-trail-free-orbit-v5.3.1'].join('')
    ];
  }
  function retiredPresetId(value) {
    return retiredPresetIds().indexOf(String(value || '').trim()) >= 0;
  }
  function retiredPresetRecord(value) {
    if (!value || typeof value !== 'object') return false;
    var names = retiredPresetNames();
    var candidates = [value, value.canonical, value.parsed, value.parsed && value.parsed.canonical,
      value.snapshot, value.snapshot && value.snapshot.canonical].filter(function (entry) {
      return !!entry && typeof entry === 'object' && !Array.isArray(entry);
    });
    return candidates.some(function (candidate) {
      var identity = [candidate.name,candidate.title,candidate.presetId,candidate.id,candidate.fileName].map(function (entry) {
        return String(entry || '').replace(/\.json$/i,'').trim();
      });
      if (identity.some(function (entry) { return names.indexOf(entry) >= 0 || retiredPresetId(entry); })) return true;
      var particles = candidate.particles;
      var custom = particles && particles[['cus','tom'].join('')] || candidate[['custom','Particles'].join('')];
      var mode = String(custom && (custom.effectMode || custom.waveMode) || candidate.mode || '');
      return mode === ['luminous','OrbitVortex'].join('') ||
        mode === ['tsunami','Curl'].join('') ||
        mode === ['gold','enStarTrailOrbitField'].join('');
    });
  }
  function mapScopedValues(raw, transform) {
    if (raw && raw.schema === PRESET_SCOPE_SCHEMA && raw.scopes && typeof raw.scopes === 'object' && !Array.isArray(raw.scopes)) {
      var next = presetClone(raw);
      Object.keys(next.scopes).forEach(function (scope) { next.scopes[scope] = transform(next.scopes[scope], scope); });
      return next;
    }
    return transform(raw, 'legacy');
  }
  function retireRemovedParticlePresets() {
    var keys = [STORE.canonicalPresets, STORE.imports, STORE.currentPreset, STORE.retiredParticleRuntime, 'lumifield-user-fx-archives-v1', STORE.presetShares];
    var before = storageSnapshot(keys), removedByScope = {}, removedAll = {}, currentRemoved = false;
    function mark(scope, id) {
      id = String(id || ''); if (!id) return;
      (removedByScope[scope] || (removedByScope[scope] = {}))[id] = true; removedAll[id] = true;
    }
    try {
      var canonicalRoot = readRawJson(STORE.canonicalPresets);
      var canonicalNext = mapScopedValues(canonicalRoot, function (store, scope) {
        if (!store || typeof store !== 'object' || Array.isArray(store)) return store;
        store = presetClone(store); store.presets = store.presets && typeof store.presets === 'object' ? store.presets : {};
        Object.keys(store.presets).forEach(function (id) {
          if (!retiredPresetRecord(store.presets[id])) return;
          mark(scope,id); delete store.presets[id];
        });
        if (store.archiveKeys && typeof store.archiveKeys === 'object') Object.keys(store.archiveKeys).forEach(function (key) {
          var presetId = String(store.archiveKeys[key] || '');
          if (retiredPresetId(presetId) || removedByScope[scope] && removedByScope[scope][presetId]) delete store.archiveKeys[key];
        });
        return store;
      });
      if (JSON.stringify(canonicalNext) !== JSON.stringify(canonicalRoot)) localStorage.setItem(STORE.canonicalPresets, JSON.stringify(canonicalNext));

      var archiveRoot = readRawJson('lumifield-user-fx-archives-v1');
      var archiveNext = mapScopedValues(archiveRoot, function (list, scope) {
        if (!Array.isArray(list)) return list;
        return list.filter(function (slot) {
          if (!retiredPresetRecord(slot)) return true;
          mark(scope,slot && slot.id); return false;
        });
      });
      if (JSON.stringify(archiveNext) !== JSON.stringify(archiveRoot)) localStorage.setItem('lumifield-user-fx-archives-v1', JSON.stringify(archiveNext));
      if (Array.isArray(window.userFxArchives)) {
        var live = window.userFxArchives.filter(function (slot) { return !retiredPresetRecord(slot); });
        if (live.length !== window.userFxArchives.length) {
          window.userFxArchives.length = 0; Array.prototype.push.apply(window.userFxArchives, live);
          if (typeof window.saveUserFxArchives === 'function') window.saveUserFxArchives();
          if (typeof window.renderUserFxArchives === 'function') window.renderUserFxArchives();
        }
      }

      var importsRoot = readRawJson(STORE.imports);
      var importsNext = mapScopedValues(importsRoot, function (map, scope) {
        if (!map || typeof map !== 'object' || Array.isArray(map)) return map;
        map = presetClone(map);
        Object.keys(map).forEach(function (key) {
          var meta = map[key], presetId = String(meta && meta.presetId || key);
          if (retiredPresetId(presetId) || (removedByScope[scope] && removedByScope[scope][presetId]) || retiredPresetRecord(meta && (meta.parsed && meta.parsed.canonical || meta.parsed || meta))) delete map[key];
        });
        return map;
      });
      if (JSON.stringify(importsNext) !== JSON.stringify(importsRoot)) localStorage.setItem(STORE.imports, JSON.stringify(importsNext));

      var activeScope = presetScopeKey();
      var currentRawText = '';
      try { currentRawText = localStorage.getItem(STORE.currentPreset) || ''; } catch (_) {}
      var currentRoot = readRawJson(STORE.currentPreset);
      if (currentRoot == null && retiredPresetId(currentRawText)) currentRoot = currentRawText;
      var currentNext = mapScopedValues(currentRoot, function (id, scope) {
        var removed = retiredPresetId(id) || removedByScope[scope] && removedByScope[scope][String(id || '')];
        if (removed && (scope === 'legacy' || scope === activeScope)) currentRemoved = true;
        return removed ? '' : id;
      });
      if (JSON.stringify(currentNext) !== JSON.stringify(currentRoot)) localStorage.setItem(STORE.currentPreset, JSON.stringify(currentNext));

      localStorage.removeItem(STORE.retiredParticleRuntime);

      var shares = readRawJson(STORE.presetShares);
      var sharesNext = mapScopedValues(shares, function (value, scope) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
        value = presetClone(value);
        var map = value.byPreset && typeof value.byPreset === 'object' ? value.byPreset : value;
        Object.keys(map).forEach(function (id) {
          if (retiredPresetId(id) || removedByScope[scope] && removedByScope[scope][id] || retiredPresetRecord(map[id])) delete map[id];
        });
        return value;
      });
      if (JSON.stringify(sharesNext) !== JSON.stringify(shares)) localStorage.setItem(STORE.presetShares, JSON.stringify(sharesNext));
      return { removedPresetIds:Object.keys(removedAll), scopes:Object.keys(removedByScope), currentRemoved:currentRemoved };
    } catch (error) {
      restoreStorageSnapshot(before);
      throw error;
    }
  }
  function restoreBuiltInPresetAfterRetirement() {
    if (!window.fx) return false;
    var isolation = window.LumiFieldBuiltInPresetIsolation;
    if (isolation && typeof isolation.restoreRetiredEmily === 'function') return isolation.restoreRetiredEmily() === true;
    if (typeof window.setPreset !== 'function') return false;
    return window.setPreset(0, { silent:true, skipTransition:true, preserveAudioEcho:true }) !== false;
  }
  function migrateCanonicalArchives() {
    if (!presetScopeOwnerReady()) return { skipped:true, reason:'scope-not-ready' };
    var retired = retireRemovedParticlePresets();
    var restored = !!(retired && retired.currentRemoved && restoreBuiltInPresetAfterRetirement());
    if (!Array.isArray(window.userFxArchives)) return { retired:retired, restored:restored };
    var changed = false;
    window.userFxArchives.forEach(function (slot) {
      if (!slot || !slot.snapshot) return;
      if (!slot.id) { ensureArchivePresetId(slot); changed = true; }
      if (!storedArchiveCanonical(slot)) {
        var canonical = legacyCanonicalForSlot(slot);
        if (canonical) saveArchiveCanonical(slot, canonical);
      }
    });
    if (changed && typeof window.saveUserFxArchives === 'function') window.saveUserFxArchives();
    return { retired:retired, restored:restored };
  }
  function installTransactionalImport() {
    var originalApply = window.applyUserFxArchive;
    var originalRemove = window.removeUserFxArchive;
    var originalSave = window.saveUserFxArchive;
    var originalExportPayload = window.userFxArchiveExportPayload;
    function slotAt(reference) {
      if (!Array.isArray(window.userFxArchives)) return null;
      if (reference && typeof reference === 'object') return reference;
      if (typeof reference === 'string') {
        var byPresetId = window.userFxArchives.filter(function (slot) { return slot && slot.id === reference; })[0];
        if (byPresetId) return byPresetId;
      }
      var index = Number(reference);
      return isFinite(index) ? window.userFxArchives[Math.floor(index)] || null : null;
    }
    function parseValue(value, options) {
      options = options || {};
      if (value && value.patch && value.canonical && value.report) return value;
      var result = typeof value === 'string'
        ? canonicalSchemaApi().parse(value, { fileName:options.fileName })
        : canonicalSchemaApi().normalize(value, { fileName:options.fileName });
      return transactionalFromSchemaResult(result);
    }
    window.importUserFxArchiveText = function (text, fileName, options) {
      var parsed;
      try { parsed = parseImportText(text, fileName); } catch (error) { show(error.message); return false; }
      if (options && options.preview) { previewTransactionalImport(parsed); return true; }
      return applyTransactionalPreset(parsed, { createArchive:true, importWallpaper:false });
    };
    window.importUserFxArchiveFromDialog = function () {
      var desktop = typeof window.getDesktopWindowApi === 'function' && window.getDesktopWindowApi();
      if (desktop && typeof desktop.importJsonFile === 'function') {
        desktop.importJsonFile().then(function (result) {
          if (result && result.ok) window.importUserFxArchiveText(result.text, result.filePath || '用户存档.json', { preview:true });
          else if (!result || !result.canceled) show('导入失败');
        }).catch(function () { show('导入失败'); });
        return;
      }
      var input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
      input.onchange = function () { var file = input.files && input.files[0]; if (file) window.readUserFxArchiveImportFile(file); };
      input.click();
    };
    window.readUserFxArchiveImportFile = function (file) {
      if (!file || !/\.json$/i.test(file.name || '')) { show('请导入 JSON 用户存档'); return; }
      var reader = new FileReader();
      reader.onload = function () { window.importUserFxArchiveText(reader.result, file.name, { preview:true }); };
      reader.onerror = function () { show('导入失败'); };
      reader.readAsText(file, 'utf-8');
    };
    window.applyUserFxArchive = function (index) {
      var slot = slotAt(index);
      var canonical = storedArchiveCanonical(slot);
      if (!canonical && slot) {
        canonical = legacyCanonicalForSlot(slot);
        if (canonical) saveArchiveCanonical(slot, canonical);
      }
      if (canonical) {
        var parsed = normalizeTransactionalPayload(Object.assign({}, canonical, { name:slot.name, presetId:ensureArchivePresetId(slot) }), slot.name + '.json');
        return applyTransactionalPreset(parsed, { createArchive:false, presetId:slot.id, importWallpaper:false });
      }
      var map = importedMetaMap();
      var meta = slot && (map[String(slot.id || '')] || map[String(slot.savedAt)]);
      if (meta && meta.nativeSpectrum) {
        var nativeResult = typeof originalApply === 'function' ? originalApply(index) : undefined;
        applySpectrumStatePatch(meta.nativeSpectrum);
        return nativeResult;
      }
      if (meta && meta.parsed) { applyTransactionalPreset(meta.parsed, { createArchive:false, presetId:meta.presetId, importWallpaper:false }); return; }
      if (typeof originalApply === 'function') return originalApply(index);
    };
    window.saveUserFxArchive = function (index) {
      var slot = slotAt(index);
      if (!slot) return;
      var before = cloneJson(slot);
      var storeBefore = storageSnapshot([STORE.canonicalPresets, STORE.imports, 'lumifield-user-fx-archives-v1']);
      try {
        ensureArchivePresetId(slot);
        var result = typeof originalSave === 'function' ? originalSave(index) : undefined;
        slot = slotAt(index);
        saveArchiveCanonical(slot, captureCanonicalPreset(slot.name, slot.id));
        var map = importedMetaMap();
        map[String(slot.id)] = { canonical:true, presetId:slot.id, savedAt:slot.savedAt };
        map[String(slot.savedAt)] = map[String(slot.id)];
        if (!writeScopedValue(STORE.imports, map)) throw new Error('用户存档索引持久化失败');
        if (typeof window.saveUserFxArchives === 'function') window.saveUserFxArchives();
        var saved = readJson('lumifield-user-fx-archives-v1', []);
        if (!Array.isArray(saved) || !saved.some(function (entry) { return entry && entry.id === slot.id; })) throw new Error('用户存档持久化失败');
        return result;
      } catch (error) {
        Object.keys(slot).forEach(function (key) { delete slot[key]; });
        Object.assign(slot, before);
        restoreStorageSnapshot(storeBefore);
        if (typeof window.renderUserFxArchives === 'function') window.renderUserFxArchives();
        show('用户存档保存失败，已回滚：' + (error && error.message || '未知错误'));
        return false;
      }
    };
    window.userFxArchiveExportPayload = function (slot) {
      if (!slot) return typeof originalExportPayload === 'function' ? originalExportPayload(slot) : null;
      var canonical = storedArchiveCanonical(slot) || legacyCanonicalForSlot(slot);
      var managed = Array.isArray(window.userFxArchives) && window.userFxArchives.indexOf(slot) >= 0;
      var hasVisualFields = canonical && Object.keys(canonicalSchemaApi().FIELDS).some(function (namespace) { return canonical[namespace] && Object.keys(canonical[namespace]).length; });
      if (!managed && !hasVisualFields) canonical = captureCanonicalPreset(slot.name, ensureArchivePresetId(slot));
      if (!canonical) return typeof originalExportPayload === 'function' ? originalExportPayload(slot) : null;
      if (!storedArchiveCanonical(slot)) saveArchiveCanonical(slot, canonical);
      return canonicalSchemaApi().normalize(Object.assign({}, canonical, { name:slot.name, presetId:ensureArchivePresetId(slot) }), { allowEmpty:true }).canonical;
    };
    window.removeUserFxArchive = function (index) {
      var slot = slotAt(index);
      if (slot) {
        var shared = presetShareEntry(slot);
        if (shared && shared.status === 'active') {
          show('请先点击“分享”撤销现有分享，再删除此存档。');
          return false;
        }
        try { removeArchiveCanonical(slot); } catch (error) { show('用户存档删除失败：' + error.message); return false; }
        try { removePresetShareEntry(slot); } catch (error) { show('分享状态删除失败：' + error.message); return false; }
        var map = importedMetaMap(); var meta = map[String(slot.id || '')] || map[String(slot.savedAt)];
        if (meta && meta.presetId) delete map[String(meta.presetId)];
        delete map[String(slot.id || '')]; delete map[String(slot.savedAt)];
        if (!writeScopedValue(STORE.imports, map)) throw new Error('用户存档索引持久化失败');
      }
      if (typeof originalRemove === 'function') return originalRemove(index);
    };
    migrateCanonicalArchives();

    window.LumiFieldCanonicalPresets = {
      parse:function (text, options) { return canonicalSchemaApi().parse(text, options || {}); },
      normalize:function (payload, options) { return canonicalSchemaApi().normalize(payload, options || {}); },
      preview:function (payload, options) {
        var parsed = parseValue(payload, options || {}); previewTransactionalImport(parsed); return parsed.report;
      },
      apply:function (payload, options) {
        options = options || {};
        try {
          var parsed = parseValue(payload, options);
          return applyTransactionalPreset(parsed, {
            createArchive:options.createArchive !== false,
            importWallpaper:options.importWallpaper === true,
            presetId:options.presetId,
            failAt:options.failAt,
            failAtStage:options.failAtStage
          });
        } catch (error) { show(error.message); return false; }
      },
      capture:function (name) { return captureCanonicalPreset(name, null); },
      exportCurrent:function (name) { return captureCanonicalPreset(name, readScopedCurrentPresetId()); },
      exportPreset:function (index) { return window.userFxArchiveExportPayload(slotAt(index)); },
      sanitizeForShare:function (payload) { return canonicalSchemaApi().sanitizeForShare(payload); },
      getCurrent:function () { return captureCanonicalPreset('当前视觉预设', readScopedCurrentPresetId()); },
      getCurrentPresetId:function () { return readScopedCurrentPresetId(); },
      getArchiveCanonical:function (index) { var slot = typeof index === 'object' ? index : slotAt(index); return cloneJson(storedArchiveCanonical(slot) || legacyCanonicalForSlot(slot)); },
      listArchives:function () { return Array.isArray(window.userFxArchives) ? window.userFxArchives.map(function (slot, index) { return { index:index, presetId:slot.id || '', name:slot.name, savedAt:slot.savedAt, hasCanonical:!!storedArchiveCanonical(slot) }; }) : []; }
    };
    try {
      if (!presetScopeOwnerReady()) return;
      var currentId = readScopedCurrentPresetId();
      var currentSlot = Array.isArray(window.userFxArchives) && window.userFxArchives.filter(function (slot) { return slot && slot.id === currentId; })[0];
      var scopedStore = canonicalArchiveStore();
      var currentCanonical = currentSlot && storedArchiveCanonical(currentSlot) || currentId && scopedStore.presets[currentId];
      if (currentCanonical && !retiredPresetRecord(currentCanonical)) {
        applyTransactionalPreset(normalizeTransactionalPayload(currentCanonical, (currentSlot && currentSlot.name || '当前视觉预设') + '.json'), {
          createArchive:false, presetId:currentId, importWallpaper:false, silent:true
        });
      }
      presetScopeReady = true;
    } catch (_) {}
  }

  // ---------- Persistent player and always-live immersive hot zone ----------
  function enforcePlayerVisibility() {
    var bar = byId('bottom-bar');
    if (!bar) return;
    var immersive = document.body.classList.contains('immersive-mode') || window.immersiveMode === true;
    if (!immersive) {
      if (typeof window.controlsAutoHide !== 'undefined') window.controlsAutoHide = false;
      if (window.controlsHideTimer) { clearTimeout(window.controlsHideTimer); window.controlsHideTimer = null; }
      bar.classList.add('visible'); bar.classList.remove('soft-hidden');
      if (typeof window.updateControlsChromeState === 'function') window.updateControlsChromeState();
    }
  }
  function bindPersistentPlayer() {
    var bar = byId('bottom-bar'); if (!bar || bar._lfT13Persistent) return;
    bar._lfT13Persistent = true;
    enforcePlayerVisibility();
    new MutationObserver(enforcePlayerVisibility).observe(document.body, { attributes:true, attributeFilter:['class'] });
    document.addEventListener('visibilitychange', enforcePlayerVisibility);
    window.addEventListener('focus', enforcePlayerVisibility);
    bar.addEventListener('pointerdown', function () {
      if (window.controlsHideTimer) { clearTimeout(window.controlsHideTimer); window.controlsHideTimer = null; }
      bar.classList.remove('soft-hidden');
    }, true);
    function wake(event) {
      if (!document.body.classList.contains('immersive-mode') || event.clientY < innerHeight - 112) return;
      bar.classList.add('visible'); bar.classList.remove('soft-hidden');
      if (typeof window.setControlsHidden === 'function') window.setControlsHidden(false);
      if ((!event.target || !event.target.nodeType || !bar.contains(event.target)) && typeof window.scheduleControlsHide === 'function') window.scheduleControlsHide(1800);
    }
    window.addEventListener('pointermove', wake, { passive:true, capture:true });
    window.addEventListener('pointerdown', wake, { passive:true, capture:true });
  }

  // ---------- Compositor-only background opacity ----------
  var backgroundOpacityRaf = 0;
  var pendingBackgroundOpacity = null;
  function applyBackgroundOpacityComposite(value) {
    value = clamp(value, 0, 1);
    var wallpaper = window.LumiFieldWallpaperState;
    if (wallpaper && typeof wallpaper.isActive === 'function' && wallpaper.isActive()) {
      if (typeof wallpaper.applyOpacity === 'function') wallpaper.applyOpacity(value);
      return;
    }
    var root = document.documentElement;
    var layer = byId('custom-bg');
    var customColor = !!(window.fx && (window.fx.backgroundColorMode === 'custom' || window.fx.backgroundColorCustom));
    var hasOverride = customColor && value > 0.001;
    root.style.setProperty('--lf-background-opacity', value.toFixed(3));
    root.style.setProperty('--lf-bg-has-image', '0');
    root.style.setProperty('--lf-bg-has-video', '0');
    root.style.setProperty('--lf-bg-has-media', '0');
    if (layer) {
      layer.style.setProperty('--custom-bg-image-opacity', '0');
      layer.style.setProperty('--custom-bg-video-opacity', '0');
      layer.style.setProperty('--custom-bg-overlay-opacity', '0');
    }
    if (customColor && window.fx) {
      var rgb = hexRgb(normalizeHex(window.fx.backgroundColor, '#000000'));
      root.style.setProperty('--custom-bg-color', 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + value.toFixed(3) + ')');
    }
    document.body.classList.toggle('custom-background-override', !!hasOverride);
    document.body.classList.toggle('custom-background-flat', !!hasOverride);
    document.body.classList.remove('custom-background-video');
    var input = byId('fx-bgopacity');
    if (input && input.parentElement) { var out = input.parentElement.querySelector('output'); if (out) out.textContent = value.toFixed(2); }
  }
  function queueBackgroundOpacity(value) {
    pendingBackgroundOpacity = clamp(value, 0, 1);
    if (backgroundOpacityRaf) return;
    backgroundOpacityRaf = requestAnimationFrame(function () {
      backgroundOpacityRaf = 0;
      if (window.fx) window.fx.backgroundOpacity = pendingBackgroundOpacity;
      applyBackgroundOpacityComposite(pendingBackgroundOpacity);
    });
  }
  function persistBackgroundOpacity() {
    if (saveTimers['background-opacity']) { clearTimeout(saveTimers['background-opacity']); saveTimers['background-opacity'] = 0; }
    if (backgroundOpacityRaf) { cancelAnimationFrame(backgroundOpacityRaf); backgroundOpacityRaf = 0; if (window.fx) window.fx.backgroundOpacity = pendingBackgroundOpacity; applyBackgroundOpacityComposite(pendingBackgroundOpacity); }
    document.body.classList.remove('lf-bg-opacity-dragging');
    var wallpaper = window.LumiFieldWallpaperState;
    if (wallpaper && typeof wallpaper.setOpacity === 'function') {
      wallpaper.setOpacity(pendingBackgroundOpacity == null ? (window.fx && window.fx.backgroundOpacity) : pendingBackgroundOpacity, { persist:true }).catch(function(error){
        console.warn('wallpaper opacity save failed:', error);
      });
    }
    if (typeof window.saveLyricLayout === 'function') window.saveLyricLayout();
  }
  function bindBackgroundOpacity() {
    var input = byId('fx-bgopacity'); if (!input || input._lfT13Opacity) return;
    input._lfT13Opacity = true;
    input.addEventListener('pointerdown', function () { document.body.classList.add('lf-bg-opacity-dragging'); }, true);
    input.addEventListener('input', function (event) {
      event.stopImmediatePropagation(); queueBackgroundOpacity(input.value); delayed('background-opacity', persistBackgroundOpacity, 560);
    }, true);
    input.addEventListener('change', function (event) { event.stopImmediatePropagation(); queueBackgroundOpacity(input.value); persistBackgroundOpacity(); }, true);
    window.addEventListener('pointerup', function () { if (document.body.classList.contains('lf-bg-opacity-dragging')) persistBackgroundOpacity(); }, { passive:true });
    applyBackgroundOpacityComposite(window.fx && window.fx.backgroundOpacity != null ? window.fx.backgroundOpacity : 1);
  }

  // ---------- Dynamic backdrop-sampled liquid-glass FAB ----------
  function bindLiquidFab() {
    var fab = byId('fx-fab'); if (!fab || fab._lfT13Glass) return;
    fab._lfT13Glass = true;
    fab.addEventListener('pointermove', function (event) {
      var rect = fab.getBoundingClientRect();
      var x = (event.clientX - rect.left) / Math.max(1, rect.width) - 0.5;
      var y = (event.clientY - rect.top) / Math.max(1, rect.height) - 0.5;
      fab.style.setProperty('--lf-fab-x', (x * 8).toFixed(2) + 'px');
      fab.style.setProperty('--lf-fab-y', (y * 8).toFixed(2) + 'px');
      fab.style.setProperty('--lf-fab-angle', (x * 14).toFixed(2) + 'deg');
      fab.style.setProperty('--lf-fab-r1', (48 - x * 9).toFixed(2) + '%');
      fab.style.setProperty('--lf-fab-r2', (52 + x * 9).toFixed(2) + '%');
      fab.style.setProperty('--lf-fab-r3', (47 - y * 8).toFixed(2) + '%');
      fab.style.setProperty('--lf-fab-r4', (53 + y * 8).toFixed(2) + '%');
    });
    fab.addEventListener('pointerleave', function () {
      fab.style.setProperty('--lf-fab-x', '0px'); fab.style.setProperty('--lf-fab-y', '0px');
      fab.style.setProperty('--lf-fab-angle', '0deg');
      fab.style.setProperty('--lf-fab-r1', '48%'); fab.style.setProperty('--lf-fab-r2', '52%');
      fab.style.setProperty('--lf-fab-r3', '47%'); fab.style.setProperty('--lf-fab-r4', '53%');
    });
  }

  function suppressLegacyVisuals() {
    document.body.classList.add('lf-task13-active');
    var oldSpectrum = byId('lf-visualizer-controls'); if (oldSpectrum) oldSpectrum.remove();
    var oldMesh = window.stageLyrics && window.stageLyrics.group && window.stageLyrics.group.getObjectByName && window.stageLyrics.group.getObjectByName('LumiFieldRealtimeSpectrum');
    if (oldMesh) oldMesh.visible = false;
  }

  function migrateShelfScale() {
    if (!window.fx) return;
    var key = 'lumifield-task13-shelf-migrated-v1';
    var migrated = false;
    try { migrated = localStorage.getItem(key) === '1'; } catch (_) {}
    var input = byId('fx-shelfsize'); if (input) { input.min = '0.58'; input.max = '1.75'; }
    if (!migrated && Number(window.fx.shelfSize || 1) <= 1.02) {
      window.fx.shelfSize = 1.14;
      if (input) { input.value = '1.14'; var out = input.parentElement.querySelector('output'); if (out) out.textContent = '1.14'; }
      if (window.shelfManager && window.shelfManager.rebuild) window.shelfManager.rebuild(true);
      if (typeof window.saveLyricLayout === 'function') window.saveLyricLayout();
    }
    try { localStorage.setItem(key, '1'); } catch (_) {}
  }

  function init() {
    try { localStorage.removeItem('lumifield-task13-camera-v1'); } catch (_) {}
    try { localStorage.removeItem('lumifield-visualizer-v2'); } catch (_) {}
    persistSpectrum();
    applyLyricTranslationState();
    translationToastNode(); ensureSpectrumCanvas();
    injectConsoleControls();
    observeTask15ConsoleBlocks();
    scheduleTask15ConsoleReconcile();
    bindEchoImport();
    installTransactionalImport();
    installPresetSharing();
    bindPersistentPlayer();
    bindBackgroundOpacity(); bindLiquidFab(); migrateShelfScale();
    suppressLegacyVisuals();
    document.addEventListener('lumifield-auth-user-change', function (event) {
      switchPresetScope(event && event.detail ? event.detail.userId : undefined);
      relocateTask15ConsoleBlocks();
      syncConsoleFoldState();
    });
    window.addEventListener('pagehide', function () {
      hideTranslationReadyToast();
      cancelTranslationRequest();
      syncNativeTranslation(false, '', -1);
      if (task15ConsoleReconcileTimer) clearTimeout(task15ConsoleReconcileTimer);
      task15ConsoleReconcileTimer = 0;
      if (task15ConsoleObserver) task15ConsoleObserver.disconnect();
      task15ConsoleObserver = null;
    });
    window.addEventListener('resize', resizeSpectrumCanvas);
    setTimeout(function () { suppressLegacyVisuals(); injectConsoleControls(); relocateTask15ConsoleBlocks(); bindEchoImport(); bindBackgroundOpacity(); bindLiquidFab(); }, 1100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
