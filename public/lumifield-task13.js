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
    particleRuntime: 'lumifield-task13-particle-runtime-v1',
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
    enabled: false, shape: 'shape1', audioMonitor: true, theme: 'neonPurple',
    quality: 'high', particleStrength: 0.72, mode1LeftLyricsEnabled: false,
    flip: false, showColorOptions: true, renderResolution: 1,
    autoCycle: false, cycleInterval: 18, accentEnabled: true, accentColor: '#ffffff', accentStrength: 0.78,
    responseStrength: 1.18, responseRange: 0.72,
    visualEq: [1, 1, 1, 1, 1, 1, 1, 1],
    rippleEnabled: true, rippleSensitivity: 0.48, rippleCooldown: 14,
    idleWave: true, idleDebounce: 2.4, idleFade: 1.8,
    cameraDistance: 1.05, cameraHorizontal: 0, cameraElevation: 34,
    autoRotate: false, rotateSpeed: 0.16,
    playerVisible: true, playerCover: true, playerSize: 1, playerX: 0, playerY: 0,
    exposureSize: 2.2, exposureStrength: 0.76, exposureRadius: 0.62,
    trailLength: 0.72, trailDecay: 0.12, flashThreshold: 0.78,
    flashEnabled: true, reducedFlash: true
  };

  var THEMES = {
    neonPurple: ['#ec70ff', '#775cff', '#57dcff'], azure: ['#3f8cff', '#58d7ff', '#c7f7ff'],
    ice: ['#9ff7ff', '#d5faff', '#7297ff'], emerald: ['#57ffc7', '#12bd89', '#b8ffe8'],
    gold: ['#ffd36a', '#ff8a3d', '#fff0a8'], ink: ['#dbe7ef', '#586979', '#ffffff'],
    deepCyan: ['#39e5dd', '#157b87', '#b4fff7'], lavender: ['#d8b7ff', '#9975ff', '#f4e9ff'],
    sakura: ['#ffafcf', '#ff6b9c', '#ffe4ef'], copper: ['#e29b62', '#83503b', '#ffd1a4'],
    mint: ['#92ffd7', '#41c6aa', '#e2fff5'], ember: ['#ff8b4e', '#b52b42', '#ffd1a3'],
    flame: ['#ff4c63', '#ff9a2e', '#ffe36e'], hazePink: ['#ff90c4', '#a56cff', '#ffd1ed'],
    fantasy: ['#9d6cff', '#ff69db', '#5fe9ff']
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
    renderResolution:[0.35,1.5], cycleInterval:[3,300], accentStrength:[0,2], particleStrength:[0,2],
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
    return value;
  }

  function validateEchoPatch(value) {
    value = migrateEchoValue(value);
    var patch = {};
    Object.keys(ECHO_DEFAULTS).forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) return;
      var current = value[key];
      if (key === 'visualEq') { patch.visualEq = normalizeVisualEq(current, true); return; }
      if (key === 'theme') {
        if (!Object.prototype.hasOwnProperty.call(THEMES, current)) throw new Error('theme 无效');
        patch.theme = current; return;
      }
      if (key === 'shape') {
        if (!/^(shape1|shape2)$/.test(String(current))) throw new Error('shape 无效');
        patch.shape = current; return;
      }
      if (key === 'quality') {
        if (!/^(auto|low|medium|high)$/.test(String(current))) throw new Error('quality 无效');
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
        echo: Object.assign({}, echoState, { visualEq:echoState.visualEq.slice() }),
        particles: customParticleDebugSnapshot()
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
    prepareParticlePreset: function (value) { return prepareCustomParticlePreset(value); },
    applyParticlePreset: function (value, options) { return applyCustomParticlePreset(value, options || {}); },
    captureParticleRuntime: function () { return captureCustomParticleRuntime(); },
    restoreParticleRuntime: function (snapshot, options) { return restoreCustomParticleRuntime(snapshot, options || {}); },
    destroyParticleRuntime: function () { return destroyCustomParticleRuntime({ restoreLegacy:true, restoreCamera:true }); },
    getParticleRuntime: function () { return captureCustomParticleRuntime(); },
    getParticleDebug: function () { return customParticleDebugSnapshot(); },
    setParticleTestUser: function (userId) { return setCustomParticleTestUser(userId); }
  };

  // ---------- Canonical custom particle runtime (shared scene / renderer / main rAF) ----------
  var CUSTOM_PARTICLE_MODES = {
    goldenStarTrailOrbitField: 'goldenStarTrailOrbitField'
  };
  var customParticleRuntime = null;
  var customParticleScopeOverride = '';
  var customParticleScopeReady = false;
  var customParticlePersistTimer = 0;
  var customParticleBuildCount = 0;
  var customParticleDisposeCount = 0;
  var customParticleGeneration = 0;
  var customParticleLastDisposed = null;
  var customParticleLastEnergy = 0;
  var customParticleFieldConsumption = {};
  var CUSTOM_SCOPE_SCHEMA = 'lumifield-user-scoped-v1';
  var CUSTOM_PARTICLE_MAX = 100000;
  var CUSTOM_PARTICLE_MIN = 256;

  function defined(value, fallback) { return value === undefined || value === null ? fallback : value; }
  function finite(value, fallback) {
    value = Number(value);
    return isFinite(value) ? value : Number(fallback) || 0;
  }
  function finiteInt(value, fallback, min, max) {
    value = Math.round(finite(value, fallback));
    return Math.max(min == null ? -2147483648 : min, Math.min(max == null ? 2147483647 : max, value));
  }
  function bool(value, fallback) { return value === undefined || value === null ? fallback === true : value === true; }
  function own(object, key) { return !!object && Object.prototype.hasOwnProperty.call(object, key); }
  function arrayOf(value, length, fallback) {
    var source = Array.isArray(value) ? value.slice(0, length) : [];
    while (source.length < length) source.push(typeof fallback === 'function' ? fallback(source.length) : fallback);
    return source;
  }
  function finiteArray(value, length, fallback) {
    return arrayOf(value, length, fallback).map(function (entry, index) {
      var number = Number(entry);
      if (!isFinite(number)) throw new Error('数组第 ' + index + ' 项必须是数值');
      return number;
    });
  }
  function colorValue(value, fallback) {
    value = String(defined(value, fallback || '#ffffff'));
    if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error('粒子颜色无效：' + value);
    return value.toLowerCase();
  }
  function customParticleClone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }
  function customParticleHash(value) {
    var text = String(value || 'lumifield');
    var hash = 2166136261 >>> 0;
    for (var index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }
  function customParticleRandom(seed) {
    var state = seed >>> 0 || 0x9e3779b9;
    return function () {
      state += 0x6d2b79f5;
      var value = state;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }
  function customParticleUserId() {
    if (customParticleScopeOverride) return customParticleScopeOverride;
    try {
      var user = window.LFAuth && typeof window.LFAuth.getUser === 'function' ? window.LFAuth.getUser() : null;
      return String(user && (user.id || user.userId || user.email) || '').trim();
    } catch (_) { return ''; }
  }
  function customParticleOwnerReady() {
    if (customParticleScopeOverride || customParticleUserId()) return true;
    if (customParticleScopeReady) return true;
    return !(window.desktopWindow && typeof window.desktopWindow.lfAuthStatus === 'function');
  }
  function customParticleScopeKey() {
    var owner = customParticleScopeOverride || customParticleUserId();
    return owner ? 'user:' + encodeURIComponent(owner).slice(0, 180) : 'device:anonymous';
  }
  function emptyScopedRoot() { return { schema:CUSTOM_SCOPE_SCHEMA, version:1, scopes:{} }; }
  function readRawJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; }
  }
  function readScopedValue(key, fallback) {
    var raw = readRawJson(key);
    if (raw && raw.schema === CUSTOM_SCOPE_SCHEMA && raw.scopes && typeof raw.scopes === 'object' && !Array.isArray(raw.scopes)) {
      return own(raw.scopes, customParticleScopeKey()) ? customParticleClone(raw.scopes[customParticleScopeKey()]) : customParticleClone(fallback);
    }
    if (raw == null) return customParticleClone(fallback);
    if (!customParticleOwnerReady()) return customParticleClone(raw);
    var root = emptyScopedRoot();
    root.scopes[customParticleScopeKey()] = customParticleClone(raw);
    try { localStorage.setItem(key, JSON.stringify(root)); } catch (_) {}
    return customParticleClone(raw);
  }
  function writeScopedValue(key, value) {
    if (!customParticleOwnerReady()) return false;
    var raw = readRawJson(key);
    var root = raw && raw.schema === CUSTOM_SCOPE_SCHEMA && raw.scopes && typeof raw.scopes === 'object' && !Array.isArray(raw.scopes)
      ? raw : emptyScopedRoot();
    root = { schema:CUSTOM_SCOPE_SCHEMA, version:1, scopes:Object.assign({}, root.scopes) };
    if (value === undefined) delete root.scopes[customParticleScopeKey()];
    else root.scopes[customParticleScopeKey()] = customParticleClone(value);
    try { localStorage.setItem(key, JSON.stringify(root)); return true; } catch (_) { return false; }
  }
  function readScopedCurrentPresetId() {
    var rawText = '';
    try { rawText = localStorage.getItem(STORE.currentPreset) || ''; } catch (_) {}
    var raw = readRawJson(STORE.currentPreset);
    if (raw == null && rawText && customParticleOwnerReady()) {
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
  function particleLodScale(requested) {
    requested = Math.max(CUSTOM_PARTICLE_MIN, finiteInt(requested, CUSTOM_PARTICLE_MIN, CUSTOM_PARTICLE_MIN, CUSTOM_PARTICLE_MAX));
    var quality = String(window.fx && window.fx.performanceQuality || 'high');
    var scale = quality === 'eco' ? 0.48 : (quality === 'balanced' ? 0.72 : 1);
    var cores = Number(navigator.hardwareConcurrency) || 8;
    if (cores <= 4 && quality !== 'high' && quality !== 'ultra') scale = Math.min(scale, 0.58);
    return { requested:requested, scale:scale, actual:Math.max(CUSTOM_PARTICLE_MIN, Math.min(requested, Math.round(requested * scale))) };
  }
  function proportionalAllocation(total, requested, order) {
    order = order || Object.keys(requested);
    var sum = order.reduce(function (value, key) { return value + Math.max(0, finite(requested[key], 0)); }, 0);
    var result = {}, fractions = [], used = 0;
    order.forEach(function (key) {
      var exact = sum > 0 ? total * Math.max(0, finite(requested[key], 0)) / sum : total / Math.max(1, order.length);
      result[key] = Math.floor(exact);
      used += result[key];
      fractions.push({ key:key, fraction:exact - result[key] });
    });
    fractions.sort(function (left, right) { return right.fraction - left.fraction; });
    for (var index = 0; used < total; index++, used++) result[fractions[index % fractions.length].key]++;
    return result;
  }
  function consumeParticleField(path, consumer, effect, status) {
    customParticleFieldConsumption[path] = {
      status:status || 'IMPLEMENTED_AND_RENDERED',
      consumer:consumer,
      effect:effect || ''
    };
  }
  function walkParticleFields(value, prefix, callback) {
    if (!value || typeof value !== 'object') return;
    Object.keys(value).forEach(function (key) {
      var path = prefix ? prefix + '.' + key : key;
      callback(path, value[key]);
      if (value[key] && typeof value[key] === 'object' && !Array.isArray(value[key])) walkParticleFields(value[key], path, callback);
    });
  }
  function buildFieldConsumption(canonical, mode) {
    customParticleFieldConsumption = {};
    function declarationOnly(path, value) {
      return !!(value && typeof value === 'object' && !Array.isArray(value)) ||
        /(?:visualConsoleBinding|organizationMode|boardShape|forceCircularBoundary|reducedClutter|ParticleDistribution|ParticlesOnly|resetMode|resetEasing|resetReloadsPreset|resetShowsReferenceImage|interactionMode|zoomMethod|zoomWheelDeltaNormalization|zoomAnchorMode|zoomPreserveAnchorScreenPosition|zoomAffectsCameraDistanceOnly|zoomAlongViewRay|yawLimit|pitchLimit|rollLimit)$/.test(path);
    }
    walkParticleFields(canonical.visual || {}, 'visual', function (path, value) {
      consumeParticleField(path, declarationOnly(path, value) ? 'GoldenPresetInvariantValidator' : 'CustomParticleMaterial',
        declarationOnly(path, value) ? '已验证并持久化的视觉约束' : '视觉强度、深度、颜色或相机冲击',
        declarationOnly(path, value) ? 'IMPLEMENTED_STATE_ONLY' : 'IMPLEMENTED_AND_RENDERED');
    });
    walkParticleFields(canonical.particles || {}, 'particles', function (path, value) {
      var consumer = 'CustomParticleMaterial';
      if (/particles\.custom\.(?:orbit|trail|background|outerArc|palette|organization|core|effectVariant|visualConsoleBinding)/.test(path)) consumer = 'GoldenAtomicStarTrailBuilder';
      else if (/mouse|drag|wheel|zoom|interaction|Full360|VerticalFlip|hoverRotate|freeOrbit/.test(path)) consumer = 'CustomParticleInteractionController';
      else if (path === 'particles.depthDistribution') consumer = 'GoldenAtomicGeometryDepthDistribution';
      var stateOnly = declarationOnly(path, value);
      consumeParticleField(path, stateOnly ? 'GoldenPresetInvariantValidator' : consumer,
        stateOnly ? '已验证并持久化的拓扑、交互或控制台约束' : '几何、着色器、层策略或交互控制',
        stateOnly ? 'IMPLEMENTED_STATE_ONLY' : 'IMPLEMENTED_AND_RENDERED');
    });
    walkParticleFields(canonical.camera || {}, 'camera', function (path, value) {
      var stateOnly = declarationOnly(path, value);
      consumeParticleField(path, stateOnly ? 'GoldenPresetInvariantValidator' : 'CustomParticleCameraController',
        stateOnly ? '已验证并持久化的共享相机约束' : '共享相机初始姿态、阻尼和交互能力',
        stateOnly ? 'IMPLEMENTED_STATE_ONLY' : 'IMPLEMENTED_AND_RENDERED');
    });
    ['spectrum','echo','lyrics','player'].forEach(function (namespace) {
      walkParticleFields(canonical[namespace] || {}, namespace, function (path) {
        consumeParticleField(path, 'LumiFieldUnifiedState', '复用 LF 统一功能状态', 'IMPLEMENTED_STATE_ONLY');
      });
    });
    consumeParticleField('particles.custom.effectMode', 'CustomParticleModeDispatcher', mode);
    return customParticleClone(customParticleFieldConsumption);
  }

  function normalizeParticleCamera(camera, mode, custom) {
    camera = camera && typeof camera === 'object' && !Array.isArray(camera) ? customParticleClone(camera) : {};
    var fixedPosition = Array.isArray(camera.fixedPosition) ? finiteArray(camera.fixedPosition, 3, 0) : null;
    var fixedTarget = Array.isArray(camera.fixedTarget) ? finiteArray(camera.fixedTarget, 3, 0) : [0, 0, 0];
    var defaultRadius = mode === CUSTOM_PARTICLE_MODES.goldenStarTrailOrbitField ? 64 : 30;
    var yaw = finite(camera.mouseYaw, 0) * Math.PI / 180;
    var pitch = finite(camera.mousePitch, -7.5) * Math.PI / 180;
    var radius = defaultRadius;
    if (fixedPosition) {
      var dx = fixedPosition[0] - fixedTarget[0], dy = fixedPosition[1] - fixedTarget[1], dz = fixedPosition[2] - fixedTarget[2];
      radius = Math.max(0.03, Math.sqrt(dx * dx + dy * dy + dz * dz));
      yaw = Math.atan2(dx, dz);
      pitch = Math.atan2(dy, Math.sqrt(dx * dx + dz * dz));
    }
    var zoomRange = Array.isArray(custom.zoomRange) ? custom.zoomRange.slice(0, 2) : [0.35, 120];
    var zoomMin = Math.max(0.001, finite(zoomRange[0], 0.35));
    var zoomUnbounded = zoomRange[1] === 'unbounded' || custom.zoomInfiniteIn === true || custom.zoomMethod === 'exponentialUnbounded';
    var zoomMax = zoomUnbounded ? 1000000 : Math.max(zoomMin, finite(zoomRange[1], 120));
    var initialRoll = finiteArray(camera.defaultRotation || [0,0,0], 3, 0)[2] * Math.PI / 180;
    return {
      mode:String(camera.mode || (mode === CUSTOM_PARTICLE_MODES.goldenStarTrailOrbitField ? 'freeOrbitDrag' : 'freeOrbit')),
      yaw:yaw, pitch:pitch, roll:initialRoll, target:fixedTarget,
      radius:radius, targetYaw:yaw, targetPitch:pitch, targetRoll:initialRoll, targetRadius:radius,
      pan:[0, 0, 0], targetPan:[0, 0, 0],
      smoothing:Math.max(0.01, Math.min(1, finite(camera.smoothing, finite(custom.mouseSmoothing, 0.11)))),
      freeOrbit:bool(camera.freeOrbit, true),
      unrestrictedPitch:bool(camera.unrestrictedPitch, camera.pitchLimit === 'none'),
      pitchLimit:defined(camera.pitchLimit, 'none'),
      allowVerticalFlip:bool(camera.allowVerticalFlip, bool(custom.allowVerticalFlip, true)),
      allowFull360Rotation:bool(camera.allowFull360Rotation, bool(custom.allowFull360Rotation, true)),
      allowRoll:bool(camera.allowRoll, true),
      allowPan:bool(camera.allowPan, custom.mouseTranslation === true),
      mouseRotation:bool(custom.mouseRotation, true),
      mouseMove:bool(custom.mouseMove, false),
      mouseFollowRotation:bool(camera.mouseFollowRotation, false),
      leftDragOrbit:bool(camera.leftDragOrbit, bool(custom.mouseRotation, true)),
      leftDragPan:bool(camera.leftDragPan, bool(custom.leftDragMovesAndRotates, false)),
      rightDragPan:bool(camera.rightDragPan, false),
      middleDragRoll:bool(camera.middleDragRoll, false),
      wheelZoom:bool(custom.zoomEnabled, true) && bool(camera.wheelZoom, bool(custom.wheelZoom, true)),
      resetKeepsFreeControls:bool(camera.resetKeepsFreeControls, true),
      preserveFreeOrbit:bool(camera.preserveFreeOrbit, true),
      hoverRotate:bool(camera.hoverRotate, bool(custom.hoverRotate, false)),
      rotateOnlyWhileLeftDrag:bool(camera.rotateOnlyWhileLeftDrag, bool(custom.rotateOnlyWhileLeftDrag, true)),
      defaultTopDownBias:bool(camera.defaultTopDownBias, false),
      fov:Math.max(18, Math.min(95, finite(camera.fieldOfView, 50))),
      zoomMin:zoomMin, zoomMax:zoomMax, zoomUnbounded:zoomUnbounded,
      zoomSensitivity:Math.max(0.005, Math.min(2, finite(custom.zoomSensitivity, 0.16))),
      zoomEnabled:bool(custom.zoomEnabled, true),
      zoomInfiniteIn:bool(custom.zoomInfiniteIn, false),
      zoomMethod:String(custom.zoomMethod || (zoomUnbounded ? 'exponentialUnbounded' : 'exponentialClamped')),
      rotationStrength:Math.max(0, finite(custom.mouseRotationStrength, 1)),
      translationStrength:Math.max(0, finite(custom.mouseTranslationStrength, 1)),
      mouseTranslation:bool(custom.mouseTranslation, bool(custom.mouseMove, false)),
      returnToCenterOnMouseLeave:bool(custom.returnToCenterOnMouseLeave, false),
      dragAccumulateRotation:bool(custom.dragAccumulateRotation, true),
      dragAccumulateTranslation:bool(custom.dragAccumulateTranslation, true),
      interactionMode:String(custom.interactionMode || ''),
      doubleClickReset:bool(custom.doubleClickReset, bool(camera.doubleLeftClickReset, true)),
      resetDurationMs:finiteInt(custom.resetDurationMs, finiteInt(camera.resetDurationMs, 420, 0, 5000), 0, 5000),
      zoomStepsToMin:finiteInt(custom.zoomStepsToMin, 12, 1, 120),
      zoomStepsToMax:finiteInt(custom.zoomStepsToMax, 12, 1, 120),
      zoomAnchor:Array.isArray(custom.zoomAnchor) ? finiteArray(custom.zoomAnchor, 3, 0) : (Array.isArray(camera.zoomTarget) ? finiteArray(camera.zoomTarget, 3, 0) : fixedTarget.slice()),
      initialRadius:radius,
      zoomStep:0
    };
  }
  function normalizeParticleCommon(canonical, custom) {
    var particles = canonical.particles || {};
    var visual = canonical.visual || {};
    return {
      point:Math.max(0.25, Math.min(8, finite(particles.point, 1.6))),
      speed:Math.max(0, Math.min(5, finite(particles.speed, 1))),
      twist:Math.max(-4, Math.min(4, finite(particles.twist, 0))),
      color:Math.max(0, Math.min(3, finite(particles.color, 1))),
      scatter:Math.max(0, Math.min(3, finite(particles.scatter, 0))),
      bgFade:Math.max(0, Math.min(1.5, finite(particles.bgFade, 0.08))),
      bloomStrength:Math.max(0, Math.min(3, finite(particles.bloomStrength, 0.8))),
      bloom:bool(particles.bloom, true),
      edge:bool(particles.edge, true),
      cinema:bool(particles.cinema, true),
      floatLayer:bool(particles.floatLayer, false),
      particleLyrics:bool(particles.particleLyrics, false),
      backCover:bool(particles.backCover, false),
      intensity:Math.max(0.1, Math.min(4, finite(visual.intensity, 1))),
      depth:Math.max(0.1, Math.min(4, finite(visual.depth, 1))),
      cinemaShake:Math.max(0, Math.min(2, finite(visual.cinemaShake, 0))),
      coverResolution:Math.max(0.75, Math.min(1.55, finite(visual.coverResolution, window.fx && window.fx.coverResolution || 1.15))),
      visualTintMode:String(visual.visualTintMode || 'custom'),
      visualTintColor:colorValue(visual.visualTintColor, '#ffffff'),
      depthDistribution:bool(particles.depthDistribution, true),
      particleOnly:bool(custom.particleOnly, true),
      allowText:bool(custom.allowText, false),
      allowSubtitle:bool(custom.allowSubtitle, false),
      allowOverlay:bool(custom.allowOverlay, false),
      allowCards:bool(custom.allowCards, false),
      allowArtwork:bool(custom.allowArtwork, false),
      allowControls:bool(custom.allowControls, false),
      allowLogo:bool(custom.allowLogo, false),
      hdSharp:bool(custom.hdSharp, true),
      blur:bool(custom.blur, false),
      threeD:bool(custom.threeD, true),
      audioReactive:bool(custom.audioReactive, true),
      boardShape:String(custom.boardShape || 'circle'),
      forceCircularBoundary:bool(custom.forceCircularBoundary, true)
    };
  }
  function validateExactArray(name, value, length, nested) {
    if (!Array.isArray(value) || value.length !== length) throw new Error(name + ' 长度必须为 ' + length);
    return value.map(function (entry, index) {
      if (nested) {
        if (!Array.isArray(entry) || entry.length !== nested) throw new Error(name + '[' + index + '] 必须含 ' + nested + ' 个数值');
        return finiteArray(entry, nested, 0);
      }
      var number = Number(entry);
      if (!isFinite(number)) throw new Error(name + '[' + index + '] 必须是数值');
      return number;
    });
  }
  function normalizeRingPreset(custom, lod) {
    var count = finiteInt(custom.ringCount, 4, 1, 16);
    var ringRadii = validateExactArray('ringRadii', custom.ringRadii, count);
    var ringThickness = validateExactArray('ringThickness', custom.ringThickness, count);
    var ringSpeeds = validateExactArray('ringSpeeds', custom.ringSpeeds, count);
    var ringVerticalWave = validateExactArray('ringVerticalWave', custom.ringVerticalWave, count);
    var ringDensity = validateExactArray('ringDensity', custom.ringDensity, count);
    var requestedAllocation = Object.assign({
      rings:Math.max(0, lod.requested - finiteInt(custom.outerHaloDensity * lod.requested * 0.18, 0, 0, lod.requested)),
      core:0, innerCrown:0, outerHalo:0
    }, custom.particleAllocation || {});
    Object.keys(requestedAllocation).forEach(function (key) { requestedAllocation[key] = finiteInt(requestedAllocation[key], 0, 0, CUSTOM_PARTICLE_MAX); });
    var allocationSum = requestedAllocation.rings + requestedAllocation.core + requestedAllocation.innerCrown + requestedAllocation.outerHalo;
    if (allocationSum !== lod.requested) throw new Error('particleAllocation 总和必须等于 particleCount');
    if (custom.coreEnabled === false && requestedAllocation.core !== 0) throw new Error('coreEnabled=false 时 core allocation 必须为 0');
    if (custom.innerCrownEnabled === false && requestedAllocation.innerCrown !== 0) throw new Error('innerCrownEnabled=false 时 innerCrown allocation 必须为 0');
    var allocation = proportionalAllocation(lod.actual, requestedAllocation, ['rings','core','innerCrown','outerHalo']);
    var ringAllocation = proportionalAllocation(allocation.rings, ringDensity.reduce(function (out, density, index) {
      out['ring' + index] = Math.max(0.0001, density); return out;
    }, {}), ringDensity.map(function (_, index) { return 'ring' + index; }));
    return {
      ringCount:count, ringRadii:ringRadii, ringThickness:ringThickness, ringSpeeds:ringSpeeds,
      ringVerticalWave:ringVerticalWave, ringDensity:ringDensity,
      ringEllipticity:finite(custom.ringEllipticity, 1),
      ringRippleStrength:finite(custom.ringRippleStrength, 0.28),
      ringPhaseStagger:finite(custom.ringPhaseStagger, 0.92),
      coreEnabled:bool(custom.coreEnabled, false), coreRadius:finite(custom.coreRadius, 0),
      coreHeight:finite(custom.coreHeight, 0), coreDensity:finite(custom.coreDensity, 0),
      coreSpinSpeed:finite(custom.coreSpinSpeed, 0), corePulseStrength:finite(custom.corePulseStrength, 0),
      coreCurlStrength:finite(custom.coreCurlStrength, 0), coreMoundShape:String(custom.coreMoundShape || 'disabled'),
      innerCrownEnabled:bool(custom.innerCrownEnabled, false), innerCrownRadius:finite(custom.innerCrownRadius, 0),
      innerCrownHeight:finite(custom.innerCrownHeight, 0), innerCrownArms:finiteInt(custom.innerCrownArms, 0, 0, 128),
      innerCrownSpinSpeed:finite(custom.innerCrownSpinSpeed, 0),
      outerHaloEnabled:bool(custom.outerHaloEnabled, true), outerHaloRadius:finite(custom.outerHaloRadius, 11.2),
      outerHaloDensity:finite(custom.outerHaloDensity, 0.48), outerHaloDrift:finite(custom.outerHaloDrift, 0.035),
      whitePalette:(Array.isArray(custom.whitePalette) ? custom.whitePalette : ['#ffffff']).map(function (color) { return colorValue(color, '#ffffff'); }),
      foamHighlight:colorValue(custom.foamHighlight, '#ffffff'),
      bassCorePulse:finite(custom.bassCorePulse, 0), bassCoreHeight:finite(custom.bassCoreHeight, 0),
      lowMidRingRipple:finite(custom.lowMidRingRipple, 0.72), midRingRotation:finite(custom.midRingRotation, 0.54),
      highSparkDensity:finite(custom.highSparkDensity, 0.62), spectralFluxBurst:finite(custom.spectralFluxBurst, 0.48),
      pauseRelease:finite(custom.pauseRelease, 0.88), coreShape:String(custom.coreShape || 'none'),
      coreVerticalRise:finite(custom.coreVerticalRise, 0), coreFlatness:finite(custom.coreFlatness, 0),
      removeCentralCone:bool(custom.removeCentralCone, true), centralConeEnabled:bool(custom.centralConeEnabled, false),
      outerHaloShape:String(custom.outerHaloShape || 'circle'),
      annularVoidEnabled:bool(custom.annularVoidEnabled, false),
      annularVoidInnerRadius:finite(custom.annularVoidInnerRadius, 0),
      annularVoidOuterRadius:finite(custom.annularVoidOuterRadius, 0),
      removedInnermostRing:bool(custom.removedInnermostRing, false),
      removedRingRadius:finite(custom.removedRingRadius, 0),
      removedRingOrderFromOutside:finiteInt(custom.removedRingOrderFromOutside, 0, 0, 128),
      redistributeRemovedRingParticles:bool(custom.redistributeRemovedRingParticles, false),
      centerParticlesEnabled:bool(custom.centerParticlesEnabled, false),
      centerFilledDiskEnabled:bool(custom.centerFilledDiskEnabled, false),
      centerVoidEnabled:bool(custom.centerVoidEnabled, false),
      centerVoidRadius:finite(custom.centerVoidRadius, 0),
      forceCenterClear:bool(custom.forceCenterClear, false),
      requestedAllocation:requestedAllocation, allocation:allocation, ringAllocation:ringAllocation
    };
  }
  function normalizeOrbitPreset(custom, lod) {
    var count = finiteInt(custom.orbitTrailCount, 11, 1, 64);
    var radii = validateExactArray('orbitRadii', custom.orbitRadii, count);
    var eccentricity = validateExactArray('orbitEccentricity', custom.orbitEccentricity, count);
    var speeds = validateExactArray('orbitSpeeds', custom.orbitSpeeds, count);
    var tilts = validateExactArray('orbitTilts', custom.orbitTilts, count, 3);
    var phaseOffsets = validateExactArray('orbitPhaseOffsets', custom.orbitPhaseOffsets, count);
    var precessionSpeeds = validateExactArray('orbitPrecessionSpeeds', custom.orbitPrecessionSpeeds, count);
    var thickness = validateExactArray('orbitThickness', custom.orbitThickness, count);
    var clusterCounts = validateExactArray('orbitClusterCount', custom.orbitClusterCount, count).map(function (value) {
      return finiteInt(value, 1, 1, 256);
    });
    var coreRequested = bool(custom.coreEnabled, true) ? finiteInt(custom.coreParticleCount, 0, 0, lod.requested) : 0;
    var backgroundRequested = bool(custom.backgroundStarsEnabled, true) ? finiteInt(custom.backgroundStarCount, 0, 0, lod.requested) : 0;
    var remaining = Math.max(0, lod.requested - coreRequested - backgroundRequested);
    var arcRequested = bool(custom.outerArcEnabled, true)
      ? Math.min(remaining, Math.round(remaining * Math.max(0, finite(custom.outerArcDensity, 0.34)) / (6 + Math.max(0, finite(custom.outerArcDensity, 0.34)))))
      : 0;
    var requestedAllocation = { trails:remaining - arcRequested, core:coreRequested, outerArc:arcRequested, backgroundStars:backgroundRequested };
    var allocation = proportionalAllocation(lod.actual, requestedAllocation, ['trails','core','outerArc','backgroundStars']);
    var orbitWeights = {};
    for (var index = 0; index < count; index++) orbitWeights['orbit' + index] = Math.max(0.01, clusterCounts[index] * Math.sqrt(Math.max(1, radii[index])));
    var perOrbit = proportionalAllocation(allocation.trails, orbitWeights, Object.keys(orbitWeights));
    var coreRequestedParts = {
      shell:finiteInt(custom.coreShellParticleCount, Math.round(coreRequested * 0.42), 0, lod.requested),
      network:finiteInt(custom.coreNetworkParticleCount, Math.round(coreRequested * 0.35), 0, lod.requested),
      halo:finiteInt(custom.coreHaloParticleCount, Math.round(coreRequested * 0.23), 0, lod.requested)
    };
    var coreAllocation = proportionalAllocation(allocation.core, coreRequestedParts, ['shell','network','halo']);
    var outerArcCount = bool(custom.outerArcEnabled, true) ? finiteInt(custom.outerArcCount, 4, 1, 32) : 0;
    var outerArcRadii = outerArcCount ? validateExactArray('outerArcRadii', custom.outerArcRadii, outerArcCount) : [];
    var outerArcCoverage = outerArcCount ? validateExactArray('outerArcCoverage', custom.outerArcCoverage, outerArcCount) : [];
    var outerArcWeights = {};
    for (var arcIndex = 0; arcIndex < outerArcCount; arcIndex++) outerArcWeights['arc' + arcIndex] = Math.max(0.001, outerArcCoverage[arcIndex]);
    var perOuterArc = outerArcCount ? proportionalAllocation(allocation.outerArc, outerArcWeights, Object.keys(outerArcWeights)) : {};
    var palette = custom.palette && typeof custom.palette === 'object' && !Array.isArray(custom.palette) ? custom.palette : {};
    return {
      orbitTrailCount:count, orbitRadii:radii, orbitEccentricity:eccentricity, orbitSpeeds:speeds, orbitTilts:tilts,
      orbitPhaseOffsets:phaseOffsets, orbitPrecessionSpeeds:precessionSpeeds, orbitThickness:thickness,
      orbitParticleDistribution:String(custom.orbitParticleDistribution || 'clusteredStardustWithNaturalGaps'),
      orbitClusterEnabled:bool(custom.orbitClusterEnabled, true), orbitClusterCount:clusterCounts,
      orbitClusterStrength:finite(custom.orbitClusterStrength, 0.72), orbitGapRatio:finite(custom.orbitGapRatio, 0.16),
      orbitJitter:finite(custom.orbitJitter, 0.11), orbitDepthNoise:finite(custom.orbitDepthNoise, 0.08),
      orbitContinuousLine:bool(custom.orbitContinuousLine, false), orbitParticlesOnly:bool(custom.orbitParticlesOnly, true),
      trailPersistence:finite(custom.trailPersistence, 0.86), trailHeadGlow:finite(custom.trailHeadGlow, 1.18),
      trailWidth:finite(custom.trailWidth, 0.2), trailSegmentVariation:finite(custom.trailSegmentVariation, 0.08),
      trailBrightnessVariation:finite(custom.trailBrightnessVariation, 0.1), trailTwinkleStrength:finite(custom.trailTwinkleStrength, 0.13),
      coreEnabled:bool(custom.coreEnabled, true), coreMode:String(custom.coreMode || 'facetedParticleEnergySphere'),
      coreRadius:finite(custom.coreRadius, 2.25), coreLoopCount:finiteInt(custom.coreLoopCount, 8, 1, 32),
      coreLoopSpeed:finite(custom.coreLoopSpeed, 0.24), coreGlowStrength:finite(custom.coreGlowStrength, 1.22),
      corePulseStrength:finite(custom.corePulseStrength, 0.08),
      coreParticleCount:coreRequested, coreShellParticleCount:coreRequestedParts.shell,
      coreNetworkParticleCount:coreRequestedParts.network, coreHaloParticleCount:coreRequestedParts.halo,
      coreFacetedNetwork:bool(custom.coreFacetedNetwork, true), coreNetworkEdgeDensity:finite(custom.coreNetworkEdgeDensity, 0.72),
      coreRotationSpeed:finite(custom.coreRotationSpeed, 0.17), coreLightFlare:finite(custom.coreLightFlare, 0.18),
      outerArcEnabled:bool(custom.outerArcEnabled, true), outerArcCount:outerArcCount,
      outerArcRadii:outerArcRadii, outerArcCoverage:outerArcCoverage,
      outerArcDensity:finite(custom.outerArcDensity, 0.34), outerArcSpeed:finite(custom.outerArcSpeed, 0.022),
      outerArcPartialTrails:bool(custom.outerArcPartialTrails, true),
      backgroundStarsEnabled:bool(custom.backgroundStarsEnabled, true),
      backgroundStarRadius:finite(custom.backgroundStarRadius, 27), backgroundDrift:finite(custom.backgroundDrift, 0.006),
      backgroundDepthLayers:finiteInt(custom.backgroundDepthLayers, 5, 1, 24),
      backgroundClusterStrength:finite(custom.backgroundClusterStrength, 0.38),
      palette:{
        shadow:colorValue(palette.shadow, '#bfc1c5'), warm:colorValue(palette.warm, '#d8d9dc'),
        gold:colorValue(palette.gold, '#ecedef'), bright:colorValue(palette.bright, '#f8f8f8'),
        core:colorValue(palette.core, '#ffffff')
      },
      effectVariant:String(custom.effectVariant || 'atomicInterwovenReferenceV5'),
      organizationMode:String(custom.organizationMode || 'asymmetricInterwoven3DOrbitTrails'),
      reducedClutter:bool(custom.reducedClutter, false),
      bassCorePulse:finite(custom.bassCorePulse, 0.11), lowMidOrbitBreath:finite(custom.lowMidOrbitBreath, 0.1),
      midOrbitRotation:finite(custom.midOrbitRotation, 0.18), highSparkDensity:finite(custom.highSparkDensity, 0.18),
      spectralFluxBurst:finite(custom.spectralFluxBurst, 0.09), pauseRelease:finite(custom.pauseRelease, 0.9),
      defaultSceneRotation:Array.isArray(custom.defaultSceneRotation) ? finiteArray(custom.defaultSceneRotation, 3, 0) : [0,0,0],
      defaultScenePosition:Array.isArray(custom.defaultScenePosition) ? finiteArray(custom.defaultScenePosition, 3, 0) : [0,0,0],
      visualConsoleBinding:customParticleClone(custom.visualConsoleBinding || {}),
      requestedAllocation:requestedAllocation, allocation:allocation, perOrbit:perOrbit,
      coreAllocation:coreAllocation, perOuterArc:perOuterArc
    };
  }
  function normalizeTsunamiPreset(custom, lod) {
    var rows = finiteInt(custom.logicalRowCount, finiteInt(custom.multiCrestCount, 5, 1, 16), 1, 16);
    var subRows = finiteInt(custom.subRowsPerLogicalRow, 2, 1, 4);
    var bands = finiteInt(custom.physicalCrestBandCount, rows * subRows, 1, 64);
    if (bands !== rows * subRows) throw new Error('physicalCrestBandCount 必须等于 logicalRowCount × subRowsPerLogicalRow');
    var rowSpeed = validateExactArray('rowSpeedMultipliers', custom.rowSpeedMultipliers, rows);
    var mainSpeed = validateExactArray('mainCrestSpeedMultipliers', custom.mainCrestSpeedMultipliers, rows);
    var subSpeed = validateExactArray('subCrestSpeedMultipliers', custom.subCrestSpeedMultipliers, rows);
    var mainDirections = validateExactArray('mainCrestDirections', custom.mainCrestDirections, rows);
    var subDirections = validateExactArray('subCrestDirections', custom.subCrestDirections, rows);
    mainDirections.concat(subDirections).forEach(function (direction) { if (direction !== 1 && direction !== -1) throw new Error('波峰方向必须是 1 或 -1'); });
    var bandWeights = {};
    var subEnabled = bool(custom.subCrestEnabled, true);
    for (var index = 0; index < bands; index++) {
      var isSubBand = index % subRows !== 0;
      bandWeights['band' + index] = isSubBand && !subEnabled
        ? 0
        : Math.max(0.1, finite(isSubBand ? custom.subCrestWidth : custom.mainCrestWidth, isSubBand ? 0.78 : 1.08));
    }
    return {
      waveAmplitude:finite(custom.waveAmplitude, 4.1), waveCrestSharpness:finite(custom.waveCrestSharpness, 1.68),
      waveImpact:finite(custom.waveImpact, 1.42),
      palette:(Array.isArray(custom.coldBluePalette) ? custom.coldBluePalette : ['#ffffff']).map(function (color) { return colorValue(color, '#ffffff'); }),
      foamHighlight:colorValue(custom.foamHighlight, '#ffffff'),
      multiCrestEnabled:bool(custom.multiCrestEnabled, true), multiCrestCount:finiteInt(custom.multiCrestCount, rows, 1, 32),
      crestSpacing:finite(custom.crestSpacing, 4.6), valleyDepth:finite(custom.valleyDepth, 0),
      crestJitter:finite(custom.crestJitter, 0.1), crestDrift:finite(custom.crestDrift, 0.18),
      crestWidth:finite(custom.crestWidth, 1.16), secondaryRipple:finite(custom.secondaryRipple, 0.36),
      distributedFieldEnabled:bool(custom.distributedFieldEnabled, true),
      fieldDistributionMode:String(custom.fieldDistributionMode || 'fiveRowsIndependentMainSub'),
      fieldFrequencyX:finite(custom.fieldFrequencyX, 0.68), fieldFrequencyZ:finite(custom.fieldFrequencyZ, 0.42),
      fieldDiagonalMix:finite(custom.fieldDiagonalMix, 0.34), fieldPhaseDrift:finite(custom.fieldPhaseDrift, 0.24),
      fieldPeakDensity:finite(custom.fieldPeakDensity, 0.92), crestHeightScale:finite(custom.crestHeightScale, 1.95),
      foamIntensity:finite(custom.foamIntensity, 1.42), crestOnlyRows:bool(custom.crestOnlyRows, true),
      logicalRowCount:rows, subRowsPerLogicalRow:subRows, physicalCrestBandCount:bands,
      doubleTrackEnabled:bool(custom.doubleTrackEnabled, false), doubleTrackMode:String(custom.doubleTrackMode || 'staggeredParallel'),
      logicalRowSpacing:finite(custom.logicalRowSpacing, 3.65), subRowOffset:finite(custom.subRowOffset, 0.56),
      subRowPhaseOffset:finite(custom.subRowPhaseOffset, 0.68), subRowLongitudinalOffset:finite(custom.subRowLongitudinalOffset, 0.48),
      subRowWidthScale:finite(custom.subRowWidthScale, 0.76), staggerAmount:finite(custom.staggerAmount, 0.42),
      preserveCrestHeight:bool(custom.preserveCrestHeight, true), subCrestEnabled:subEnabled,
      subCrestPerRow:finiteInt(custom.subCrestPerRow, 1, 0, 3), rowCoverage:String(custom.rowCoverage || 'edgeToEdge'),
      crestSpansFullWidth:bool(custom.crestSpansFullWidth, true), mainCrestWidth:finite(custom.mainCrestWidth, 1.08),
      subCrestWidth:finite(custom.subCrestWidth, 0.78), subCrestOffset:finite(custom.subCrestOffset, 0.84),
      subCrestLongitudinalOffset:finite(custom.subCrestLongitudinalOffset, 1.18),
      subCrestPhaseOffset:finite(custom.subCrestPhaseOffset, 1.14), subCrestHeightRatio:finite(custom.subCrestHeightRatio, 0.74),
      rowSpeedMode:String(custom.rowSpeedMode || 'staggeredDifferent'), rowSpeedMultipliers:rowSpeed,
      mainCrestSpeedMultipliers:mainSpeed, subCrestSpeedMultipliers:subSpeed,
      mainCrestDirections:mainDirections, subCrestDirections:subDirections,
      independentMainSubTime:bool(custom.independentMainSubTime, true),
      independentMainSubDirection:bool(custom.independentMainSubDirection, true),
      independentMainSubPhase:bool(custom.independentMainSubPhase, true),
      independentMainSubWavelength:bool(custom.independentMainSubWavelength, true),
      staggeredMotionStrength:finite(custom.staggeredMotionStrength, 1),
      allocation:proportionalAllocation(lod.actual, bandWeights, Object.keys(bandWeights))
    };
  }
  function prepareCustomParticlePreset(value) {
    if (value && value.kind === 'lumifield-custom-particle-prepared') return value;
    var canonical = value && value.canonical && value.patch ? value.canonical : value;
    if (!canonical || typeof canonical !== 'object' || Array.isArray(canonical)) throw new Error('自定义粒子预设必须是对象');
    var particles = canonical.particles && typeof canonical.particles === 'object' ? canonical.particles : {};
    var custom = particles.custom && typeof particles.custom === 'object' && !Array.isArray(particles.custom) ? customParticleClone(particles.custom) : null;
    if (!custom) return null;
    var effectMode = String(custom.effectMode || '');
    var waveMode = String(custom.waveMode || '');
    if (effectMode && waveMode) throw new Error('effectMode 与 waveMode 冲突，禁止同时应用');
    var mode = waveMode || effectMode;
    if (!own(CUSTOM_PARTICLE_MODES, mode)) return null;
    var common = normalizeParticleCommon(canonical, custom);
    if (!common.threeD) throw new Error(mode + ' 必须启用真实 threeD');
    var target = finiteInt(custom.particleCount, 0, CUSTOM_PARTICLE_MIN, CUSTOM_PARTICLE_MAX);
    var lod = particleLodScale(target);
    var topology = normalizeOrbitPreset(custom, lod);
    var camera = normalizeParticleCamera(canonical.camera || {}, mode, custom);
    var prepared = {
      kind:'lumifield-custom-particle-prepared', mode:mode,
      presetId:String(canonical.presetId || mode),
      canonical:customParticleClone(canonical), custom:custom, common:common, camera:camera,
      topology:topology, lod:lod, fieldConsumption:buildFieldConsumption(canonical, mode),
      estimatedBytes:lod.actual * 20 * 4 + 65536,
      preparedAt:Date.now()
    };
    return prepared;
  }

  function CustomParticleGeometryWriter(count) {
    this.count = count;
    this.index = 0;
    this.position = new Float32Array(count * 3);
    this.data0 = new Float32Array(count * 4);
    this.data1 = new Float32Array(count * 4);
    this.data2 = new Float32Array(count * 4);
    this.color = new Float32Array(count * 3);
    this.size = new Float32Array(count);
  }
  CustomParticleGeometryWriter.prototype.add = function (position, data0, data1, data2, color, size) {
    if (this.index >= this.count) return;
    var index = this.index++, p3 = index * 3, p4 = index * 4;
    this.position[p3] = finite(position && position[0], 0);
    this.position[p3 + 1] = finite(position && position[1], 0);
    this.position[p3 + 2] = finite(position && position[2], 0);
    for (var lane = 0; lane < 4; lane++) {
      this.data0[p4 + lane] = finite(data0 && data0[lane], 0);
      this.data1[p4 + lane] = finite(data1 && data1[lane], 0);
      this.data2[p4 + lane] = finite(data2 && data2[lane], 0);
    }
    var parsed = new window.THREE.Color(color || '#ffffff');
    this.color[p3] = parsed.r; this.color[p3 + 1] = parsed.g; this.color[p3 + 2] = parsed.b;
    this.size[index] = Math.max(0.05, finite(size, 1));
  };
  CustomParticleGeometryWriter.prototype.finish = function () {
    if (this.index !== this.count) throw new Error('粒子拓扑构建数量不一致：' + this.index + '/' + this.count);
    var geometry = new window.THREE.BufferGeometry();
    geometry.setAttribute('position', new window.THREE.BufferAttribute(this.position, 3));
    geometry.setAttribute('aData0', new window.THREE.BufferAttribute(this.data0, 4));
    geometry.setAttribute('aData1', new window.THREE.BufferAttribute(this.data1, 4));
    geometry.setAttribute('aData2', new window.THREE.BufferAttribute(this.data2, 4));
    geometry.setAttribute('aColor', new window.THREE.BufferAttribute(this.color, 3));
    geometry.setAttribute('aSize', new window.THREE.BufferAttribute(this.size, 1));
    geometry.computeBoundingSphere();
    return geometry;
  };
  function ringSafeRadius(value, topology, random) {
    var radius = Math.max(0, value);
    if (topology.centerVoidEnabled || topology.forceCenterClear) radius = Math.max(radius, topology.centerVoidRadius + 0.015);
    if (topology.annularVoidEnabled && radius >= topology.annularVoidInnerRadius && radius <= topology.annularVoidOuterRadius) {
      radius = topology.annularVoidOuterRadius + 0.015 + random() * 0.08;
    }
    return radius;
  }
  function buildLuminousOrbitGeometry(prepared) {
    var topology = prepared.topology, random = customParticleRandom(customParticleHash(prepared.presetId + ':rings'));
    var writer = new CustomParticleGeometryWriter(prepared.lod.actual);
    var palette = topology.whitePalette;
    for (var ringIndex = 0; ringIndex < topology.ringCount; ringIndex++) {
      var count = topology.ringAllocation['ring' + ringIndex] || 0;
      for (var item = 0; item < count; item++) {
        var sequence = (item + random() * 0.32) / Math.max(1, count);
        var angle = sequence * Math.PI * 2;
        var thicknessOffset = (random() - 0.5) * topology.ringThickness[ringIndex] * (0.34 + random() * 0.66);
        var radius = ringSafeRadius(topology.ringRadii[ringIndex] + thicknessOffset, topology, random);
        var spark = random() < Math.max(0, Math.min(1, topology.highSparkDensity * 0.12)) ? 1 : 0;
        writer.add([0,0,0],
          [radius, angle, topology.ringThickness[ringIndex], 0],
          [topology.ringSpeeds[ringIndex], topology.ringVerticalWave[ringIndex], random(), spark],
          [topology.ringEllipticity, topology.ringPhaseStagger * ringIndex, ringIndex, topology.ringDensity[ringIndex]],
          palette[(ringIndex + Math.floor(random() * palette.length)) % palette.length],
          0.72 + random() * 0.58 + spark * 0.38);
      }
    }
    for (var haloIndex = 0; haloIndex < topology.allocation.outerHalo; haloIndex++) {
      var haloAngle = (haloIndex + random() * 0.8) / Math.max(1, topology.allocation.outerHalo) * Math.PI * 2;
      var haloRadius = ringSafeRadius(topology.outerHaloRadius + (random() - 0.5) * (0.35 + topology.outerHaloDensity), topology, random);
      writer.add([0,0,0], [haloRadius, haloAngle, 0.42, 1],
        [topology.outerHaloDrift * (random() < 0.5 ? -1 : 1), 0.08, random(), random() < 0.04 ? 1 : 0],
        [1, random() * Math.PI * 2, topology.ringCount, topology.outerHaloDensity],
        palette[Math.floor(random() * palette.length)], 0.48 + random() * 0.48);
    }
    for (var coreIndex = 0; coreIndex < topology.allocation.core; coreIndex++) {
      var coreAngle = random() * Math.PI * 2;
      var coreRadius = ringSafeRadius(Math.sqrt(random()) * Math.max(0.05, topology.coreRadius), topology, random);
      writer.add([0,0,0], [coreRadius, coreAngle, topology.coreHeight, 2],
        [topology.coreSpinSpeed, topology.coreVerticalRise, random(), 0],
        [1, topology.coreCurlStrength, -1, topology.corePulseStrength],
        palette[Math.floor(random() * palette.length)], 0.65 + random() * 0.45);
    }
    for (var crownIndex = 0; crownIndex < topology.allocation.innerCrown; crownIndex++) {
      var crownAngle = random() * Math.PI * 2;
      var arm = topology.innerCrownArms ? crownIndex % topology.innerCrownArms : 0;
      writer.add([0,0,0], [ringSafeRadius(topology.innerCrownRadius, topology, random), crownAngle, topology.innerCrownHeight, 3],
        [topology.innerCrownSpinSpeed, topology.innerCrownHeight, random(), 0],
        [1, arm, -2, topology.innerCrownArms],
        palette[Math.floor(random() * palette.length)], 0.66 + random() * 0.42);
    }
    return writer.finish();
  }
  function buildGoldenOrbitGeometry(prepared) {
    var topology = prepared.topology, random = customParticleRandom(customParticleHash(prepared.presetId + ':orbits'));
    var writer = new CustomParticleGeometryWriter(prepared.lod.actual);
    var trailColors = [topology.palette.shadow, topology.palette.warm, topology.palette.gold, topology.palette.bright];
    for (var orbitIndex = 0; orbitIndex < topology.orbitTrailCount; orbitIndex++) {
      var count = topology.perOrbit['orbit' + orbitIndex] || 0;
      var tilt = topology.orbitTilts[orbitIndex];
      var clusters = topology.orbitClusterEnabled ? topology.orbitClusterCount[orbitIndex] : 1;
      for (var item = 0; item < count; item++) {
        var clusterIndex = item % clusters;
        var itemInCluster = Math.floor(item / clusters);
        var clusterSize = Math.max(1, Math.ceil(count / clusters));
        var within = (itemInCluster + random() * topology.orbitJitter) / clusterSize;
        var clusterSpan = Math.max(0.02, (1 - topology.orbitGapRatio) / clusters);
        var sequence = clusterIndex / clusters + within * clusterSpan;
        sequence = sequence - Math.floor(sequence);
        var clusterPull = topology.orbitClusterStrength * Math.sin(within * Math.PI);
        var angle = topology.orbitPhaseOffsets[orbitIndex] + sequence * Math.PI * 2;
        var widthNoise = (random() - 0.5) * (topology.orbitThickness[orbitIndex] + topology.trailWidth) * (0.34 + clusterPull * 0.66);
        var depthNoise = (random() - 0.5) * topology.orbitDepthNoise * topology.orbitRadii[orbitIndex];
        var segmentNoise = random();
        writer.add([0,0,depthNoise],
          [topology.orbitRadii[orbitIndex], angle, widthNoise, 0],
          [topology.orbitSpeeds[orbitIndex], topology.orbitEccentricity[orbitIndex], sequence, segmentNoise],
          [tilt[0] * Math.PI / 180, tilt[1] * Math.PI / 180, tilt[2] * Math.PI / 180, topology.orbitPrecessionSpeeds[orbitIndex]],
          trailColors[(orbitIndex + Math.floor(random() * trailColors.length)) % trailColors.length],
          0.54 + random() * 0.62);
      }
    }
    var goldenRatio = (1 + Math.sqrt(5)) * 0.5;
    var coreVertices = [
      [-1,goldenRatio,0],[1,goldenRatio,0],[-1,-goldenRatio,0],[1,-goldenRatio,0],
      [0,-1,goldenRatio],[0,1,goldenRatio],[0,-1,-goldenRatio],[0,1,-goldenRatio],
      [goldenRatio,0,-1],[goldenRatio,0,1],[-goldenRatio,0,-1],[-goldenRatio,0,1]
    ].map(function (value) {
      var length = Math.sqrt(value[0]*value[0]+value[1]*value[1]+value[2]*value[2]);
      return value.map(function (lane) { return lane / length * topology.coreRadius; });
    });
    var coreEdges = [];
    for (var va = 0; va < coreVertices.length; va++) for (var vb = va + 1; vb < coreVertices.length; vb++) {
      var ex = coreVertices[va][0]-coreVertices[vb][0], ey=coreVertices[va][1]-coreVertices[vb][1], ez=coreVertices[va][2]-coreVertices[vb][2];
      var edgeLength = Math.sqrt(ex*ex+ey*ey+ez*ez);
      if (edgeLength < topology.coreRadius * 1.12) coreEdges.push([va,vb]);
    }
    for (var shellIndex = 0; shellIndex < topology.coreAllocation.shell; shellIndex++) {
      var shellSequence = (shellIndex + 0.5) / Math.max(1, topology.coreAllocation.shell);
      var shellY = 1 - 2 * shellSequence;
      var shellRadius = Math.sqrt(Math.max(0, 1 - shellY * shellY));
      var shellAngle = shellIndex * 2.399963229728653;
      var shellPoint = [Math.cos(shellAngle)*shellRadius, shellY, Math.sin(shellAngle)*shellRadius];
      var nearest = coreVertices[Math.floor(random()*coreVertices.length)];
      var facetMix = topology.coreFacetedNetwork ? 0.12 + topology.coreNetworkEdgeDensity * 0.13 : 0;
      shellPoint = shellPoint.map(function (lane,index) { return lane*topology.coreRadius*(1-facetMix)+nearest[index]*facetMix; });
      writer.add(shellPoint, [topology.coreRadius, shellAngle, 0, 1],
        [topology.coreLoopSpeed, 0, shellSequence, random()], [0,0,0,shellIndex % topology.coreLoopCount], topology.palette.gold, 0.72+random()*0.52);
    }
    for (var networkIndex = 0; networkIndex < topology.coreAllocation.network; networkIndex++) {
      var edgeCount = Math.max(1, coreEdges.length);
      var edge = coreEdges[networkIndex % edgeCount] || [0,1];
      var start = coreVertices[edge[0]], end = coreVertices[edge[1]];
      var edgeSample = Math.floor(networkIndex / edgeCount);
      var samplesPerEdge = Math.max(1, Math.ceil(topology.coreAllocation.network / edgeCount));
      var edgeT = Math.min(1, (edgeSample + 0.5 + (random() - 0.5) * 0.18) / samplesPerEdge);
      var networkPoint = [0,1,2].map(function (lane) { return start[lane]+(end[lane]-start[lane])*edgeT; });
      writer.add(networkPoint, [topology.coreRadius, edgeT*Math.PI*2, 0, 1],
        [-topology.coreLoopSpeed*0.72, 1, edgeT, random()], [0,0,0,networkIndex % topology.coreLoopCount], topology.palette.core, 0.66+random()*0.48);
    }
    for (var haloIndex = 0; haloIndex < topology.coreAllocation.halo; haloIndex++) {
      var haloTheta=random()*Math.PI*2, haloCos=random()*2-1, haloSin=Math.sqrt(Math.max(0,1-haloCos*haloCos));
      var haloRadius=topology.coreRadius*(1.12+random()*0.38);
      writer.add([Math.cos(haloTheta)*haloSin*haloRadius,haloCos*haloRadius,Math.sin(haloTheta)*haloSin*haloRadius],
        [haloRadius,haloTheta,0,1],[topology.coreLoopSpeed*0.34,2,random(),random()],[0,0,0,haloIndex % topology.coreLoopCount],topology.palette.bright,0.48+random()*0.44);
    }
    for (var outerIndex = 0; outerIndex < topology.outerArcCount; outerIndex++) {
      var outerCount = topology.perOuterArc['arc' + outerIndex] || 0;
      for (var arcIndex = 0; arcIndex < outerCount; arcIndex++) {
        var arcSequence = (arcIndex + random()*0.18) / Math.max(1, outerCount);
        var coverage = topology.outerArcPartialTrails ? topology.outerArcCoverage[outerIndex] : 1;
        var arcAngle = topology.orbitPhaseOffsets[outerIndex % topology.orbitTrailCount] + (arcSequence - 0.5) * Math.PI * 2 * coverage;
        var outerTilt = topology.orbitTilts[(outerIndex * 2 + 3) % topology.orbitTrailCount];
        writer.add([0,0,(random()-0.5)*topology.orbitDepthNoise*topology.outerArcRadii[outerIndex]],
          [topology.outerArcRadii[outerIndex], arcAngle, (random() - 0.5) * topology.trailWidth, 2],
          [topology.outerArcSpeed*(outerIndex%2?-1:1), 1.08+outerIndex*0.07, arcSequence, random()],
          [outerTilt[0]*Math.PI/180,outerTilt[1]*Math.PI/180,outerTilt[2]*Math.PI/180,topology.orbitPrecessionSpeeds[outerIndex%topology.orbitTrailCount]],
          outerIndex%2 ? topology.palette.bright : topology.palette.gold, 0.48 + random() * 0.54);
      }
    }
    for (var starIndex = 0; starIndex < topology.allocation.backgroundStars; starIndex++) {
      var theta = random() * Math.PI * 2;
      var cosPhi = random() * 2 - 1;
      var sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
      var layer = starIndex % topology.backgroundDepthLayers;
      var layerRatio = topology.backgroundDepthLayers > 1 ? layer / (topology.backgroundDepthLayers - 1) : 0;
      var radius = topology.backgroundStarRadius * (0.54 + layerRatio * 0.43 + random() * 0.03);
      theta += Math.sin(layer * 2.17) * topology.backgroundClusterStrength;
      writer.add([Math.cos(theta) * sinPhi * radius, cosPhi * radius, Math.sin(theta) * sinPhi * radius],
        [radius, theta, 0, 3], [topology.backgroundDrift, 1, random(), random()],
        [0,0,0,layer], layer%3===0 ? topology.palette.warm : topology.palette.shadow, 0.34 + random() * 0.66);
    }
    return { geometry:writer.finish(), coreAllocation:customParticleClone(topology.coreAllocation), perOuterArc:customParticleClone(topology.perOuterArc) };
  }
  function buildTsunamiGeometry(prepared) {
    var topology = prepared.topology, random = customParticleRandom(customParticleHash(prepared.presetId + ':tsunami'));
    var writer = new CustomParticleGeometryWriter(prepared.lod.actual);
    var span = topology.crestSpansFullWidth && topology.rowCoverage === 'edgeToEdge' ? 22 : 17;
    var rowSpacing = (topology.logicalRowSpacing + topology.crestSpacing) * 0.5;
    for (var band = 0; band < topology.physicalCrestBandCount; band++) {
      var count = topology.allocation['band' + band] || 0;
      var row = Math.floor(band / topology.subRowsPerLogicalRow);
      var subIndex = band % topology.subRowsPerLogicalRow;
      var isSub = subIndex > 0;
      var width = topology.crestWidth * (isSub ? topology.subCrestWidth * topology.subRowWidthScale : topology.mainCrestWidth);
      var heightRatio = isSub && topology.preserveCrestHeight ? topology.subCrestHeightRatio : 1;
      var mainTime = topology.mainCrestSpeedMultipliers[row];
      var timeMultiplier = isSub && topology.independentMainSubTime ? topology.subCrestSpeedMultipliers[row] : mainTime;
      var speedMultiplier = topology.rowSpeedMultipliers[row] * timeMultiplier * topology.staggeredMotionStrength;
      var direction = isSub && topology.independentMainSubDirection ? topology.subCrestDirections[row] : topology.mainCrestDirections[row];
      var rowZ = (row - (topology.logicalRowCount - 1) * 0.5) * rowSpacing;
      if (isSub) rowZ += topology.subCrestLongitudinalOffset + topology.subRowLongitudinalOffset * subIndex;
      if (topology.doubleTrackEnabled) rowZ += (band % 2 ? 1 : -1) * topology.staggerAmount;
      for (var item = 0; item < count; item++) {
        var sequence = (item + random()) / Math.max(1, count);
        var x = (sequence * 2 - 1) * span + (random() - 0.5) * topology.crestJitter;
        var lateral = (random() - 0.5) * width + (isSub ? topology.subRowOffset * subIndex : 0);
        var phase = row * topology.fieldPhaseDrift + (isSub && topology.independentMainSubPhase ? topology.subCrestPhaseOffset + topology.subRowPhaseOffset * subIndex : 0);
        var wavelengthNoise = isSub && topology.independentMainSubWavelength ? (1 + topology.subCrestOffset * 0.08) : 1;
        writer.add([0,0,0], [x, lateral, rowZ, isSub ? 1 : 0],
          [phase, speedMultiplier, direction, row],
          [width, heightRatio, wavelengthNoise, random()],
          topology.palette[(row + subIndex + Math.floor(random() * topology.palette.length)) % topology.palette.length],
          0.62 + random() * 0.72);
      }
    }
    return writer.finish();
  }
  function customParticleUniforms(prepared) {
    var common = prepared.common;
    return {
      uTime:{ value:0 }, uBass:{ value:0 }, uMid:{ value:0 }, uTreble:{ value:0 }, uFlux:{ value:0 },
      uPointSize:{ value:common.point }, uPixel:{ value:1 }, uOpacity:{ value:Math.max(0.08, 1 - common.bgFade * 0.54) },
      uBloom:{ value:common.bloom ? common.bloomStrength : 0 }, uSharp:{ value:common.hdSharp && !common.blur ? 1 : 0 },
      uSpeed:{ value:common.speed }, uDepth:{ value:common.depth }, uIntensity:{ value:common.intensity },
      uTwist:{ value:common.twist }, uScatter:{ value:common.scatter }, uAudioReactive:{ value:common.audioReactive ? 1 : 0 },
      uColorStrength:{ value:common.color }, uTint:{ value:new window.THREE.Color(common.visualTintColor) },
      uFloatLayer:{ value:common.floatLayer ? 1 : 0 }, uResolutionScale:{ value:common.coverResolution / 1.15 }
    };
  }
  var CUSTOM_PARTICLE_FRAGMENT_SHADER = [
    'precision highp float;',
    'uniform float uOpacity, uBloom, uSharp, uIntensity, uColorStrength; uniform vec3 uTint;',
    'varying vec3 vColor;',
    'varying float vAlpha, vGlow;',
    'void main(){',
    '  vec2 p=gl_PointCoord-vec2(0.5); float d=length(p);',
    '  float edge=uSharp>0.5?smoothstep(0.50,0.405,d):smoothstep(0.54,0.18,d);',
    '  if(edge<0.01) discard;',
    '  float core=smoothstep(0.34,0.0,d);',
    '  vec3 color=mix(vColor,vColor*uTint,0.42)*uColorStrength*(0.82+core*0.34+vGlow*uBloom*0.26)*uIntensity;',
    '  gl_FragColor=vec4(color,edge*vAlpha*uOpacity);',
    '}'
  ].join('\n');
  function luminousOrbitVertexShader() {
    return [
      'precision highp float;',
      'attribute vec4 aData0,aData1,aData2; attribute vec3 aColor; attribute float aSize;',
      'uniform float uTime,uBass,uMid,uTreble,uFlux,uPointSize,uPixel,uSpeed,uDepth,uTwist,uScatter,uAudioReactive,uFloatLayer;',
      'uniform float uRingRipple,uLowMidRipple,uMidRotation,uFluxBurst,uPauseRelease;',
      'varying vec3 vColor; varying float vAlpha,vGlow;',
      'void main(){',
      ' float radius=aData0.x; float type=aData0.w; float audio=uAudioReactive;',
      ' float signedMid=sign(aData1.x)*uMid*uMidRotation*audio;',
      ' float angle=aData0.y+uTime*(aData1.x+signedMid)*uSpeed;',
      ' float ripple=sin(angle*4.0+aData1.z*6.283+uTime*0.42)*(uBass+uMid)*uLowMidRipple*uRingRipple*audio;',
      ' radius+=ripple*aData0.z*0.72+(aData1.z-0.5)*uScatter*0.14;',
      ' float ellipse=max(0.08,aData2.x);',
      ' vec3 p=vec3(cos(angle)*radius,sin(angle*3.0+aData2.y+uTime*0.18)*aData1.y*(1.0+uBass*audio),sin(angle)*radius*ellipse);',
      ' if(type>1.5&&type<2.5){ p.y+=aData0.z*sin(angle*2.0+aData1.z*5.0); }',
      ' if(type>2.5){ p.y+=aData0.z*abs(sin(angle*max(1.0,aData2.w))); }',
      ' float twist=angle*uTwist*0.04; p.xz=mat2(cos(twist),-sin(twist),sin(twist),cos(twist))*p.xz;',
      ' p.y*=uDepth;',
      ' vec4 mv=modelViewMatrix*vec4(p,1.0);',
      ' float spark=aData1.w*audio*(uTreble+uFlux*uFluxBurst);',
      ' gl_PointSize=max(0.8,aSize*uPointSize*uPixel*(1.0+spark*1.8)*clamp(28.0/max(1.0,-mv.z),0.55,3.5));',
      ' gl_Position=projectionMatrix*mv;',
      ' vColor=aColor; vAlpha=0.64+0.34*aData1.z+spark*0.34; vGlow=0.22+spark;',
      '}'
    ].join('\n');
  }
  function goldenOrbitVertexShader() {
    return [
      'precision highp float;',
      'attribute vec4 aData0,aData1,aData2; attribute vec3 aColor; attribute float aSize;',
      'uniform float uTime,uBass,uMid,uTreble,uFlux,uPointSize,uPixel,uSpeed,uDepth,uTwist,uScatter,uAudioReactive,uResolutionScale;',
      'uniform float uTrailPersistence,uTrailHeadGlow,uTrailVariation,uTrailBrightness,uTrailTwinkle,uContinuousLine,uCoreGlow,uCorePulse,uBassCorePulse,uCoreRotation,uCoreFlare,uBackgroundDrift,uDepthDistribution,uFloatLayer;',
      'uniform float uLowMidBreath,uMidRotation,uHighSpark,uFluxBurst;',
      'varying vec3 vColor; varying float vAlpha,vGlow;',
      'vec3 rotX(vec3 p,float a){float c=cos(a),s=sin(a);return vec3(p.x,p.y*c-p.z*s,p.y*s+p.z*c);}',
      'vec3 rotY(vec3 p,float a){float c=cos(a),s=sin(a);return vec3(p.x*c+p.z*s,p.y,-p.x*s+p.z*c);}',
      'vec3 rotZ(vec3 p,float a){float c=cos(a),s=sin(a);return vec3(p.x*c-p.y*s,p.x*s+p.y*c,p.z);}',
      'void main(){',
      ' float type=aData0.w; vec3 p=position; float alpha=1.0; float glow=0.18;',
      ' if(type<0.5){',
      '  float breath=1.0+(uBass*0.62+uMid*0.38)*uLowMidBreath*uAudioReactive;',
      '  float angle=aData0.y+uTime*(aData1.x+sign(aData1.x)*uMid*uMidRotation*uAudioReactive)*uSpeed;',
      '  float radius=(aData0.x+aData0.z+(aData1.w-0.5)*uScatter*0.18)*breath;',
      '  p=vec3(cos(angle)*radius*aData1.y,sin(angle)*radius,position.z*(0.35+uDepthDistribution*0.65));',
      '  p=rotY(p,uTime*aData2.w*uSpeed+uTwist*0.025*sin(angle));',
      '  p=rotZ(rotY(rotX(p,aData2.x),aData2.y),aData2.z);',
      '  float trail=fract(aData1.z-uTime*abs(aData1.x)*uSpeed*0.055);',
      '  alpha=mix(pow(max(0.0,1.0-trail),max(0.25,2.4-uTrailPersistence*2.0)),1.0,uContinuousLine);',
      '  float head=exp(-trail*30.0)*uTrailHeadGlow; glow=head;',
      '  alpha*=1.0-uTrailVariation*step(0.72,aData1.w);',
      '  alpha*=1.0+(aData1.w-0.5)*2.0*uTrailBrightness;',
      '  alpha*=0.84+sin(uTime*(0.7+aData1.w*1.4)+aData1.z*28.0)*uTrailTwinkle*0.16;',
      ' } else if(type<1.5){',
      '  float subtype=aData1.y; float idlePulse=sin(uTime*aData1.x+aData2.w*0.3927)*uCorePulse; float pulse=1.0+idlePulse+uBass*uBassCorePulse*uAudioReactive;',
      '  p*=pulse; p=rotY(rotX(p,uTime*uCoreRotation*0.37),uTime*uCoreRotation*(subtype>0.5?-0.72:1.0));',
      '  alpha=subtype>1.5?0.42+0.30*aData1.z:(subtype>0.5?0.72:0.62+0.32*aData1.z);',
      '  glow=uCoreGlow+uCoreFlare*(subtype>0.5?1.0:0.55)+uBass*uCorePulse*uAudioReactive;',
      ' } else if(type<2.5){',
      '  float angle=aData0.y+uTime*aData1.x*uSpeed; float radius=aData0.x+aData0.z;',
      '  p=vec3(cos(angle)*radius*aData1.y,sin(angle)*radius,position.z);',
      '  p=rotY(p,uTime*aData2.w*uSpeed); p=rotZ(rotY(rotX(p,aData2.x),aData2.y),aData2.z);',
      '  float arcTrail=fract(aData1.z-uTime*abs(aData1.x)*uSpeed*0.04); alpha=pow(1.0-arcTrail,1.15); glow=uTrailHeadGlow*0.45;',
      ' } else {',
      '  float drift=uTime*(aData1.x+uBackgroundDrift)*uSpeed; p.xz=mat2(cos(drift),-sin(drift),sin(drift),cos(drift))*p.xz;',
      '  p.y+=sin(uTime*0.12+aData2.w*1.7+aData1.w*6.283)*uFloatLayer*(0.35+aData2.w*0.12); alpha=0.34+0.55*aData1.z; glow=0.08;',
      ' }',
      ' p.z*=mix(1.0,max(0.2,uDepth),0.22+uDepthDistribution*0.18); vec4 mv=modelViewMatrix*vec4(p,1.0);',
      ' float spark=(uTreble*uHighSpark+uFlux*uFluxBurst)*uAudioReactive;',
      ' gl_PointSize=max(0.7,aSize*uPointSize*uPixel*uResolutionScale*(1.0+glow*0.25+spark)*clamp(32.0/max(1.0,-mv.z),0.52,3.3));',
      ' gl_Position=projectionMatrix*mv; vColor=aColor; vAlpha=clamp(alpha,0.05,1.25); vGlow=glow;',
      '}'
    ].join('\n');
  }
  function tsunamiVertexShader() {
    return [
      'precision highp float;',
      'attribute vec4 aData0,aData1,aData2; attribute vec3 aColor; attribute float aSize;',
      'uniform float uTime,uBass,uMid,uTreble,uFlux,uPointSize,uPixel,uSpeed,uDepth,uScatter,uAudioReactive;',
      'uniform float uAmplitude,uSharpness,uImpact,uSecondary,uFreqX,uFreqZ,uDiagonal,uPeakDensity,uHeightScale,uFoam,uValley,uDrift,uCrestCount;',
      'uniform vec3 uFoamColor;',
      'varying vec3 vColor; varying float vAlpha,vGlow;',
      'void main(){',
      ' float kind=aData0.w; float phase=aData0.x*uFreqX/aData2.z+aData0.z*uFreqZ+uDiagonal*(aData0.x+aData0.z)*0.10+aData1.x;',
      ' phase+=uTime*aData1.y*aData1.z*uSpeed*(1.0+kind*0.08)+uTime*uDrift;',
      ' float raw=sin(phase*uCrestCount*0.20);',
      ' float crest=pow(max(0.0,raw),max(0.2,uSharpness/uPeakDensity));',
      ' float valley=min(0.0,raw)*uValley;',
      ' float audio=1.0+uAudioReactive*(uBass*0.42+uMid*0.20+uFlux*0.18);',
      ' float height=(crest*uAmplitude*uHeightScale*aData2.y*audio)+valley;',
      ' float secondary=sin(phase*2.7+aData2.w*6.283+uTime*0.36)*uSecondary*(0.18+crest);',
      ' vec3 p=vec3(aData0.x+aData0.y*0.16,height+secondary,aData0.z+aData0.y+cos(phase)*crest*uImpact);',
      ' p.x+=sin(uTime*0.18+aData1.w)*uDrift; p.z+=(aData2.w-0.5)*uScatter*0.12; p.y*=uDepth;',
      ' vec4 mv=modelViewMatrix*vec4(p,1.0); float foam=pow(crest,2.2)*uFoam;',
      ' gl_PointSize=max(0.85,aSize*uPointSize*uPixel*(1.0+foam*0.34+uTreble*uAudioReactive*0.16)*clamp(30.0/max(1.0,-mv.z),0.58,3.4));',
      ' gl_Position=projectionMatrix*mv; vColor=mix(aColor,uFoamColor,clamp(foam*0.28,0.0,0.72));',
      ' vAlpha=0.56+crest*0.42+foam*0.08; vGlow=0.12+foam;',
      '}'
    ].join('\n');
  }
  function createCustomParticleMaterial(prepared) {
    var uniforms = customParticleUniforms(prepared), topology = prepared.topology, vertexShader;
    if (prepared.mode === CUSTOM_PARTICLE_MODES.goldenStarTrailOrbitField) {
      Object.assign(uniforms, {
        uTrailPersistence:{ value:topology.trailPersistence }, uTrailHeadGlow:{ value:topology.trailHeadGlow },
        uTrailVariation:{ value:topology.trailSegmentVariation }, uTrailBrightness:{ value:topology.trailBrightnessVariation },
        uContinuousLine:{ value:topology.orbitContinuousLine ? 1 : 0 }, uCoreGlow:{ value:topology.coreGlowStrength },
        uCorePulse:{ value:topology.corePulseStrength }, uBassCorePulse:{ value:topology.bassCorePulse }, uCoreRotation:{ value:topology.coreRotationSpeed },
        uCoreFlare:{ value:topology.coreLightFlare }, uTrailTwinkle:{ value:topology.trailTwinkleStrength },
        uBackgroundDrift:{ value:topology.backgroundDrift }, uDepthDistribution:{ value:prepared.common.depthDistribution ? 1 : 0 },
        uLowMidBreath:{ value:topology.lowMidOrbitBreath }, uMidRotation:{ value:topology.midOrbitRotation },
        uHighSpark:{ value:topology.highSparkDensity }, uFluxBurst:{ value:topology.spectralFluxBurst }
      });
      vertexShader = goldenOrbitVertexShader();
    } else throw new Error('不支持的自定义粒子模式');
    var material = new window.THREE.ShaderMaterial({
      uniforms:uniforms, vertexShader:vertexShader, fragmentShader:CUSTOM_PARTICLE_FRAGMENT_SHADER,
      transparent:true, depthWrite:false, depthTest:false,
      blending:prepared.common.bloom ? window.THREE.AdditiveBlending : window.THREE.NormalBlending
    });
    material.toneMapped = false;
    return material;
  }
  function buildCustomParticleResources(prepared) {
    if (!window.THREE || !window.scene || !window.renderer) throw new Error('LF 共享 Three renderer 尚未就绪');
    var extra = {}, geometry;
    if (prepared.mode === CUSTOM_PARTICLE_MODES.goldenStarTrailOrbitField) {
      extra = buildGoldenOrbitGeometry(prepared); geometry = extra.geometry;
    } else throw new Error('不支持的自定义粒子模式');
    var material = null, points = null, group = null;
    try {
      material = createCustomParticleMaterial(prepared);
      points = new window.THREE.Points(geometry, material);
      points.name = 'LumiFieldCanonicalParticles:' + prepared.mode;
      points.frustumCulled = false;
      points.renderOrder = 30;
      group = new window.THREE.Group();
      group.name = 'LumiFieldCanonicalParticleRuntime';
      group.renderOrder = 30;
      group.userData.lumiFieldParticleOnly = true;
      group.userData.effectMode = prepared.mode;
      group.userData.presetId = prepared.presetId;
      if (prepared.topology.defaultSceneRotation) group.rotation.set(
        prepared.topology.defaultSceneRotation[0] * Math.PI / 180,
        prepared.topology.defaultSceneRotation[1] * Math.PI / 180,
        prepared.topology.defaultSceneRotation[2] * Math.PI / 180
      );
      if (prepared.topology.defaultScenePosition) group.position.fromArray(prepared.topology.defaultScenePosition);
      group.add(points);
      return { group:group, points:points, geometry:geometry, material:material, extra:extra };
    } catch (error) {
      if (geometry && geometry.dispose) geometry.dispose();
      if (material && material.dispose) material.dispose();
      throw error;
    }
  }
  function captureLegacyParticleVisibility(common) {
    var entries = ['particles','bloomParticles','floatGroup','backCoverGroup','skullParticleGroup'].map(function (name) {
      var object = window[name];
      return { name:name, object:object || null, visible:!!(object && object.visible) };
    });
    return entries;
  }
  function setLegacyParticleVisibility(entries, hidden) {
    (entries || []).forEach(function (entry) {
      var object = window[entry.name] || entry.object;
      if (object) object.visible = hidden ? false : entry.visible;
    });
  }
  function captureSharedCamera() {
    var camera = window.camera;
    if (!camera) return null;
    return {
      position:camera.position.toArray(), quaternion:camera.quaternion.toArray(), up:camera.up.toArray(),
      fov:camera.fov, near:camera.near, far:camera.far, zoom:camera.zoom,
      rotationOrder:camera.rotation.order
    };
  }
  function restoreSharedCamera(snapshot) {
    var camera = window.camera;
    if (!camera || !snapshot) return;
    camera.position.fromArray(snapshot.position);
    camera.quaternion.fromArray(snapshot.quaternion);
    camera.up.fromArray(snapshot.up);
    camera.fov = snapshot.fov; camera.near = snapshot.near; camera.far = snapshot.far; camera.zoom = snapshot.zoom;
    camera.rotation.order = snapshot.rotationOrder || 'XYZ';
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }
  function serializableCameraState(camera) {
    if (!camera) return null;
    return {
      mode:camera.mode, yaw:camera.yaw, pitch:camera.pitch, roll:camera.roll, radius:camera.radius,
      targetYaw:camera.targetYaw, targetPitch:camera.targetPitch, targetRoll:camera.targetRoll, targetRadius:camera.targetRadius,
      target:camera.target.slice(), pan:camera.pan.slice(), targetPan:camera.targetPan.slice(),
      fov:camera.fov, smoothing:camera.smoothing, freeOrbit:camera.freeOrbit,
      unrestrictedPitch:camera.unrestrictedPitch, pitchLimit:camera.pitchLimit,
      allowVerticalFlip:camera.allowVerticalFlip, allowFull360Rotation:camera.allowFull360Rotation,
      allowRoll:camera.allowRoll, allowPan:camera.allowPan, leftDragOrbit:camera.leftDragOrbit, leftDragPan:camera.leftDragPan,
      rightDragPan:camera.rightDragPan, middleDragRoll:camera.middleDragRoll, wheelZoom:camera.wheelZoom,
      zoomMin:camera.zoomMin, zoomMax:camera.zoomMax, zoomUnbounded:camera.zoomUnbounded,
      zoomEnabled:camera.zoomEnabled, zoomInfiniteIn:camera.zoomInfiniteIn, zoomMethod:camera.zoomMethod,
      zoomSensitivity:camera.zoomSensitivity, rotationStrength:camera.rotationStrength,
      translationStrength:camera.translationStrength, mouseTranslation:camera.mouseTranslation,
      mouseRotation:camera.mouseRotation, mouseMove:camera.mouseMove,
      hoverRotate:camera.hoverRotate, rotateOnlyWhileLeftDrag:camera.rotateOnlyWhileLeftDrag,
      returnToCenterOnMouseLeave:camera.returnToCenterOnMouseLeave,
      dragAccumulateRotation:camera.dragAccumulateRotation,
      dragAccumulateTranslation:camera.dragAccumulateTranslation,
      resetKeepsFreeControls:camera.resetKeepsFreeControls, preserveFreeOrbit:camera.preserveFreeOrbit,
      interactionMode:camera.interactionMode, doubleClickReset:camera.doubleClickReset,
      resetDurationMs:camera.resetDurationMs, zoomStepsToMin:camera.zoomStepsToMin,
      zoomStepsToMax:camera.zoomStepsToMax, zoomAnchor:camera.zoomAnchor.slice(),
      initialRadius:camera.initialRadius, zoomStep:camera.zoomStep
    };
  }
  function restoreCameraControllerState(camera, snapshot) {
    if (!camera || !snapshot) return;
    ['yaw','pitch','roll','radius','targetYaw','targetPitch','targetRoll','targetRadius','zoomStep'].forEach(function (key) {
      if (isFinite(Number(snapshot[key]))) camera[key] = Number(snapshot[key]);
    });
    ['pan','targetPan'].forEach(function (key) {
      if (Array.isArray(snapshot[key]) && snapshot[key].length === 3) camera[key] = finiteArray(snapshot[key], 3, 0);
    });
  }
  function customParticleStageVisible() {
    return !!(customParticleRuntime && document.body && !document.body.classList.contains('lf-auth-locked') &&
      !document.body.classList.contains('splash-active') && document.visibilityState !== 'hidden');
  }
  function customParticleOwnsCanvasInput() {
    return !!(customParticleRuntime && customParticleStageVisible());
  }
  function customParticleWorldUiTransform() {
    var runtime = customParticleRuntime;
    if (!runtime || !customParticleStageVisible()) return { scale:1, center:[0,0,0] };
    var state = runtime.camera;
    return {
      scale:Math.max(0.08, Math.min(80, state.radius / 6.6)),
      center:[state.target[0] + state.pan[0], state.target[1] + state.pan[1], state.target[2] + state.pan[2]]
    };
  }
  function scheduleCustomParticlePersist() {
    if (customParticlePersistTimer) return;
    customParticlePersistTimer = setTimeout(function () {
      customParticlePersistTimer = 0;
      persistCustomParticleRuntime();
    }, 420);
  }
  function persistCustomParticleRuntime() {
    if (!customParticleOwnerReady()) return false;
    return writeScopedValue(STORE.particleRuntime, captureCustomParticleRuntime());
  }
  function addCustomParticleListener(runtime, target, name, handler, options) {
    target.addEventListener(name, handler, options);
    runtime.listeners.push([target, name, handler, options]);
  }
  function removeCustomParticleListeners(runtime) {
    (runtime && runtime.listeners || []).forEach(function (entry) {
      try { entry[0].removeEventListener(entry[1], entry[2], entry[3]); } catch (_) {}
    });
    if (runtime) runtime.listeners = [];
  }
  function resetCustomParticleCamera(runtime) {
    if (!runtime) return;
    var initial = runtime.initialCamera;
    runtime.resetTransition = {
      startedAt:performance.now(), duration:Math.max(0, runtime.camera.resetDurationMs),
      from:{ yaw:runtime.camera.yaw, pitch:runtime.camera.pitch, roll:runtime.camera.roll, radius:runtime.camera.radius, pan:runtime.camera.pan.slice() }
    };
    runtime.camera.targetYaw = initial.yaw; runtime.camera.targetPitch = initial.pitch;
    runtime.camera.targetRoll = initial.roll; runtime.camera.targetRadius = initial.radius;
    runtime.camera.targetPan = initial.pan.slice();
    runtime.camera.zoomStep = 0;
    if (!runtime.camera.preserveFreeOrbit && !runtime.camera.resetKeepsFreeControls) runtime.camera.freeOrbit = false;
    scheduleCustomParticlePersist();
  }
  function bindCustomParticleInteraction(runtime) {
    var canvas = window.renderer && window.renderer.domElement;
    if (!canvas) throw new Error('LF 共享 renderer canvas 不存在');
    var drag = { active:false, button:-1, x:0, y:0, startX:0, startY:0, moved:false, pointerId:null };
    runtime.drag = drag;
    function active() { return customParticleRuntime === runtime && customParticleStageVisible(); }
    function pointerDown(event) {
      if (!active()) return;
      var camera = runtime.camera;
      var supported = event.button === 0 && camera.leftDragOrbit ||
        event.button === 1 && camera.middleDragRoll || event.button === 2 && camera.rightDragPan;
      if (!supported) return;
      drag.active = true; drag.button = event.button; drag.x = event.clientX; drag.y = event.clientY;
      drag.startX = event.clientX; drag.startY = event.clientY; drag.moved = false; drag.pointerId = event.pointerId;
      if (window.mouseDownAt) window.mouseDownAt.hadDrag = false;
      try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
      event.preventDefault();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    }
    function pointerMove(event) {
      if (!active()) return;
      var camera = runtime.camera;
      if (!drag.active) {
        if (camera.hoverRotate && !camera.rotateOnlyWhileLeftDrag && camera.mouseFollowRotation) {
          var nx = event.clientX / Math.max(1, innerWidth) - 0.5;
          var ny = event.clientY / Math.max(1, innerHeight) - 0.5;
          camera.targetYaw = runtime.initialCamera.yaw + nx * camera.rotationStrength;
          camera.targetPitch = runtime.initialCamera.pitch - ny * camera.rotationStrength * 0.72;
        }
        return;
      }
      var dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      drag.x = event.clientX; drag.y = event.clientY;
      if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6) {
        drag.moved = true;
        if (window.mouseDownAt) window.mouseDownAt.hadDrag = true;
      }
      if (drag.button === 0 && camera.leftDragOrbit) {
        camera.targetYaw -= dx * 0.0062 * camera.rotationStrength;
        camera.targetPitch += dy * 0.0056 * camera.rotationStrength;
        if (!camera.unrestrictedPitch && !camera.allowVerticalFlip) camera.targetPitch = Math.max(-Math.PI * 0.495, Math.min(Math.PI * 0.495, camera.targetPitch));
        if (camera.mouseTranslation && (camera.leftDragPan || /Rotate(?:And)?Move/i.test(camera.interactionMode))) {
          camera.targetPan[0] += dx * 0.004 * camera.translationStrength;
          camera.targetPan[1] -= dy * 0.004 * camera.translationStrength;
        }
      } else if (drag.button === 2 && camera.rightDragPan && camera.allowPan) {
        camera.targetPan[0] -= dx * 0.012 * camera.translationStrength;
        camera.targetPan[1] += dy * 0.012 * camera.translationStrength;
      } else if (drag.button === 1 && camera.middleDragRoll && camera.allowRoll) {
        camera.targetRoll += dx * 0.006;
      }
      event.preventDefault();
    }
    function pointerUp(event) {
      if (!drag.active || event.pointerId !== drag.pointerId) return;
      drag.active = false; drag.button = -1; drag.pointerId = null;
      if (drag.moved && window.mouseDownAt) window.mouseDownAt.hadDrag = true;
      try { canvas.releasePointerCapture(event.pointerId); } catch (_) {}
      scheduleCustomParticlePersist();
    }
    function wheel(event) {
      if (!active() || !runtime.camera.wheelZoom) return;
      var camera = runtime.camera;
      var direction = event.deltaY === 0 ? 0 : (event.deltaY > 0 ? 1 : -1);
      if (!direction) return;
      var previousRadius = Math.max(0.001, camera.targetRadius);
      camera.zoomStep = Math.max(-camera.zoomStepsToMin, Math.min(camera.zoomStepsToMax, camera.zoomStep + direction));
      var linearProgress = camera.zoomStep < 0
        ? -camera.zoomStep / camera.zoomStepsToMin
        : camera.zoomStep / camera.zoomStepsToMax;
      var curvedProgress = Math.pow(Math.max(0, Math.min(1, linearProgress)), 1 / Math.max(0.05, camera.zoomSensitivity));
      var ratio = camera.zoomStep < 0
        ? Math.pow(camera.zoomMin / camera.initialRadius, curvedProgress)
        : Math.pow(camera.zoomMax / camera.initialRadius, curvedProgress);
      var next = Math.max(camera.zoomMin, Math.min(camera.zoomMax, camera.initialRadius * ratio));
      var preserveScale = next / previousRadius;
      camera.targetPan = camera.targetPan.map(function (lane) { return lane * preserveScale; });
      camera.pan = camera.pan.map(function (lane) { return lane * preserveScale; });
      camera.targetRadius = next;
      event.preventDefault();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      scheduleCustomParticlePersist();
    }
    function leave() {
      if (!runtime.camera.returnToCenterOnMouseLeave || drag.active) return;
      runtime.camera.targetYaw = runtime.initialCamera.yaw;
      runtime.camera.targetPitch = runtime.initialCamera.pitch;
      runtime.camera.targetPan = runtime.initialCamera.pan.slice();
    }
    function context(event) { if (active() && runtime.camera.rightDragPan) event.preventDefault(); }
    function doubleClick(event) {
      if (!active() || !runtime.camera.doubleClickReset || (event.button != null && event.button !== 0)) return;
      resetCustomParticleCamera(runtime);
      event.preventDefault();
    }
    addCustomParticleListener(runtime, canvas, 'pointerdown', pointerDown, true);
    addCustomParticleListener(runtime, window, 'pointermove', pointerMove, { passive:false, capture:true });
    addCustomParticleListener(runtime, window, 'pointerup', pointerUp, true);
    addCustomParticleListener(runtime, window, 'pointercancel', pointerUp, true);
    addCustomParticleListener(runtime, canvas, 'wheel', wheel, { passive:false });
    addCustomParticleListener(runtime, canvas, 'pointerleave', leave, true);
    addCustomParticleListener(runtime, canvas, 'contextmenu', context, true);
    addCustomParticleListener(runtime, canvas, 'dblclick', doubleClick, false);
  }
  function updateCustomParticleCamera(runtime, dt) {
    var camera = window.camera, state = runtime.camera;
    if (!camera || !state) return;
    if (runtime.resetTransition) {
      var reset = runtime.resetTransition;
      var progress = reset.duration <= 0 ? 1 : Math.min(1, Math.max(0, (performance.now() - reset.startedAt) / reset.duration));
      var damped = progress >= 1 ? 1 : (1 - (1 + progress * 7) * Math.exp(-progress * 7));
      ['yaw','pitch','roll','radius'].forEach(function (key) {
        state[key] = reset.from[key] + (runtime.initialCamera[key] - reset.from[key]) * damped;
      });
      state.pan = reset.from.pan.map(function (value, index) { return value + (runtime.initialCamera.pan[index] - value) * damped; });
      if (progress >= 1) runtime.resetTransition = null;
    }
    var smoothing = 1 - Math.pow(1 - Math.max(0.01, Math.min(0.95, state.smoothing)), Math.max(0.2, dt * 60));
    state.yaw += (state.targetYaw - state.yaw) * smoothing;
    state.pitch += (state.targetPitch - state.pitch) * smoothing;
    state.roll += (state.targetRoll - state.roll) * smoothing;
    if (state.zoomUnbounded) state.radius = Math.exp(Math.log(Math.max(0.001, state.radius)) + (Math.log(Math.max(0.001, state.targetRadius)) - Math.log(Math.max(0.001, state.radius))) * smoothing);
    else state.radius += (state.targetRadius - state.radius) * smoothing;
    for (var lane = 0; lane < 3; lane++) state.pan[lane] += (state.targetPan[lane] - state.pan[lane]) * smoothing;
    var targetX = state.target[0] + state.pan[0], targetY = state.target[1] + state.pan[1], targetZ = state.target[2] + state.pan[2];
    var cosPitch = Math.cos(state.pitch);
    camera.position.set(
      targetX + state.radius * cosPitch * Math.sin(state.yaw),
      targetY + state.radius * Math.sin(state.pitch),
      targetZ + state.radius * cosPitch * Math.cos(state.yaw)
    );
    camera.up.set(-Math.sin(state.pitch) * Math.sin(state.yaw), Math.cos(state.pitch), -Math.sin(state.pitch) * Math.cos(state.yaw));
    camera.lookAt(targetX, targetY, targetZ);
    var shake = Math.max(0, Math.min(1.8, finite(runtime.prepared.common.cinemaShake, 0)));
    var rollKick = finite(window.beatCam && window.beatCam.rollKick, 0) * shake;
    var radiusKick = finite(window.beatCam && window.beatCam.radiusKick, 0) * shake * 0.52;
    if (Math.abs(radiusKick) > 0.0001) camera.translateZ(radiusKick);
    camera.rotation.z = state.roll + rollKick;
    var punch = Math.max(finite(window.camPunch, 0) * 0.55,
      finite(window.beatCam && window.beatCam.punch, 0) * 0.54 + finite(window.beatCam && window.beatCam.radiusKick, 0) * 0.16) * shake;
    camera.fov = Math.max(18, Math.min(95, state.fov - punch * 1.75));
    camera.near = Math.max(0.001, Math.min(0.05, state.radius * 0.002));
    camera.far = Math.max(500, Math.min(2000000, state.radius * 4 + runtime.boundsRadius * 4));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }
  function customParticleTopologyDebug(runtime) {
    var topology = runtime.prepared.topology;
    if (runtime.mode === CUSTOM_PARTICLE_MODES.goldenStarTrailOrbitField) {
      return {
        orbitTrailCount:topology.orbitTrailCount,
        perOrbit:Array.from({ length:topology.orbitTrailCount }).map(function (_, index) { return topology.perOrbit['orbit' + index] || 0; }),
        orbitRadii:topology.orbitRadii.slice(), orbitSpeeds:topology.orbitSpeeds.slice(),
        orbitTilts:customParticleClone(topology.orbitTilts), orbitPhaseOffsets:topology.orbitPhaseOffsets.slice(),
        orbitPrecessionSpeeds:topology.orbitPrecessionSpeeds.slice(), orbitClusterCount:topology.orbitClusterCount.slice(),
        coreMode:topology.coreMode, coreFacetedNetwork:topology.coreFacetedNetwork,
        coreAllocation:customParticleClone(runtime.resources.extra.coreAllocation || {}),
        outerArcCount:topology.outerArcCount, perOuterArc:customParticleClone(runtime.resources.extra.perOuterArc || {}),
        outerArc:topology.outerArcEnabled && topology.allocation.outerArc > 0,
        backgroundStars:topology.backgroundStarsEnabled && topology.allocation.backgroundStars > 0,
        backgroundDepthLayers:topology.backgroundDepthLayers,
        zoomAnchor:runtime.camera.zoomAnchor.slice(), zoomStep:runtime.camera.zoomStep
      };
    }
    return {};
  }
  function customParticleAllocationDebug(runtime) {
    var topology = runtime.prepared.topology;
    if (runtime.mode === CUSTOM_PARTICLE_MODES.goldenStarTrailOrbitField) return customParticleClone(topology.allocation);
    return {};
  }
  function customParticleDebugSnapshot() {
    var runtime = customParticleRuntime;
    var base = {
      active:!!runtime, mode:runtime && runtime.mode || '', presetId:runtime && runtime.prepared.presetId || '',
      scope:customParticleScopeKey(),
      targetParticleCount:runtime ? runtime.prepared.lod.requested : 0,
      effectiveParticleCount:runtime ? runtime.prepared.lod.actual : 0,
      requestedParticleCount:runtime ? runtime.prepared.lod.requested : 0,
      actualParticleCount:runtime ? runtime.prepared.lod.actual : 0,
      lodScale:runtime ? runtime.prepared.lod.scale : 0,
      allocation:runtime ? customParticleAllocationDebug(runtime) : null,
      topology:runtime ? customParticleTopologyDebug(runtime) : null,
      geometryUuid:runtime ? runtime.resources.geometry.uuid : '',
      materialUuid:runtime ? runtime.resources.material.uuid : '',
      groupUuid:runtime ? runtime.resources.group.uuid : '',
      visible:!!(runtime && runtime.resources.group.visible),
      camera:runtime ? serializableCameraState(runtime.camera) : null,
      interaction:runtime ? {
        enabled:true, dragging:!!(runtime.drag && runtime.drag.active), listeners:runtime.listeners.length,
        mouseRotation:runtime.camera.mouseRotation, mouseMove:runtime.camera.mouseMove,
        hoverRotate:runtime.camera.hoverRotate, rotateOnlyWhileLeftDrag:runtime.camera.rotateOnlyWhileLeftDrag,
        leftDragOrbit:runtime.camera.leftDragOrbit, rightDragPan:runtime.camera.rightDragPan,
        middleDragRoll:runtime.camera.middleDragRoll, wheelZoom:runtime.camera.wheelZoom,
        mouseTranslation:runtime.camera.mouseTranslation, allowFull360Rotation:runtime.camera.allowFull360Rotation,
        allowVerticalFlip:runtime.camera.allowVerticalFlip, allowRoll:runtime.camera.allowRoll,
        allowPan:runtime.camera.allowPan, zoomEnabled:runtime.camera.zoomEnabled,
        zoomUnbounded:runtime.camera.zoomUnbounded, zoomInfiniteIn:runtime.camera.zoomInfiniteIn,
        zoomMethod:runtime.camera.zoomMethod,
        dragAccumulateRotation:runtime.camera.dragAccumulateRotation,
        dragAccumulateTranslation:runtime.camera.dragAccumulateTranslation,
        returnToCenterOnMouseLeave:runtime.camera.returnToCenterOnMouseLeave,
        interactionMode:runtime.camera.interactionMode
      } : null,
      fieldConsumption:runtime ? customParticleClone(runtime.prepared.fieldConsumption) : customParticleClone(customParticleFieldConsumption),
      buildCount:customParticleBuildCount, disposeCount:customParticleDisposeCount,
      listenerCount:runtime ? runtime.listeners.length : 0,
      rendererCreated:0, requestAnimationFrameCreated:0, audioContextCreated:0, analyserCreated:0,
      resourceCounts:{ groups:runtime ? 1 : 0, points:runtime ? 1 : 0, geometries:runtime ? 1 : 0, materials:runtime ? 1 : 0, textures:0 },
      legacyHiddenCount:runtime ? runtime.legacyVisibility.filter(function (entry) { return !!entry.object; }).length : 0,
      elapsed:runtime ? runtime.elapsed : 0,
      generation:runtime ? runtime.generation : customParticleGeneration,
      lastDisposed:customParticleClone(customParticleLastDisposed)
    };
    return base;
  }
  function captureCustomParticleRuntime() {
    var runtime = customParticleRuntime;
    if (!runtime) return { active:false, scope:customParticleScopeKey(), schema:1 };
    return {
      active:true, schema:1, scope:customParticleScopeKey(), mode:runtime.mode,
      presetId:runtime.prepared.presetId, canonical:customParticleClone(runtime.prepared.canonical),
      controller:serializableCameraState(runtime.camera), elapsed:runtime.elapsed,
      targetParticleCount:runtime.prepared.lod.requested, effectiveParticleCount:runtime.prepared.lod.actual
    };
  }
  function disposeCustomParticleInstance(runtime, options) {
    options = options || {};
    if (!runtime) return false;
    var listenerCount = runtime.listeners.length;
    removeCustomParticleListeners(runtime);
    try { if (runtime.resources.group.parent) runtime.resources.group.parent.remove(runtime.resources.group); } catch (_) {}
    try { runtime.resources.group.clear(); } catch (_) {}
    try { if (runtime.resources.geometry && runtime.resources.geometry.dispose) runtime.resources.geometry.dispose(); } catch (_) {}
    try { if (runtime.resources.material && runtime.resources.material.dispose) runtime.resources.material.dispose(); } catch (_) {}
    customParticleDisposeCount++;
    customParticleLastDisposed = {
      mode:runtime.mode, presetId:runtime.prepared.presetId,
      geometryUuid:runtime.resources.geometry.uuid, materialUuid:runtime.resources.material.uuid,
      disposedAt:Date.now(), listenerCount:listenerCount
    };
    if (options.restoreLegacy) setLegacyParticleVisibility(runtime.legacyVisibility, false);
    if (options.restoreCamera) restoreSharedCamera(runtime.savedCamera);
    return true;
  }
  function destroyCustomParticleRuntime(options) {
    options = options || {};
    var changed = false;
    if (customParticleRuntime) {
      var runtime = customParticleRuntime;
      customParticleRuntime = null;
      changed = disposeCustomParticleInstance(runtime, {
        restoreLegacy:options.restoreLegacy !== false,
        restoreCamera:options.restoreCamera !== false
      });
    }
    if (options.persist !== false && customParticleOwnerReady()) writeScopedValue(STORE.particleRuntime, captureCustomParticleRuntime());
    syncGoldenConsoleControls();
    decorateGoldenAtomicPresetCard();
    return changed;
  }
  function leaveCustomParticleForBuiltIn() {
    var snapshot = captureCustomParticleRuntime();
    if (!snapshot.active) return true;
    if (!customParticleOwnerReady()) return false;
    var storageBefore = storageSnapshot([STORE.currentPreset, STORE.particleRuntime]);
    var inactive = { active:false, schema:1, scope:customParticleScopeKey() };
    var currentWritten = writeScopedCurrentPresetId('');
    var runtimeWritten = currentWritten && writeScopedValue(STORE.particleRuntime, inactive);
    var verified = runtimeWritten && readScopedCurrentPresetId() === '' && readScopedValue(STORE.particleRuntime, null) && readScopedValue(STORE.particleRuntime, null).active === false;
    if (!verified) {
      restoreStorageSnapshot(storageBefore);
      return false;
    }
    try {
      destroyCustomParticleRuntime({ restoreLegacy:true, restoreCamera:true, persist:false });
    } catch (_) {
      restoreStorageSnapshot(storageBefore);
      try { restoreCustomParticleRuntime(snapshot, { persist:false, suppressFailureInjection:true }); } catch (ignore) {}
      return false;
    }
    decorateGoldenAtomicPresetCard();
    return true;
  }
  function applyCustomParticlePreset(value, options) {
    options = options || {};
    var injectedFailure = options.failAt || (options.suppressFailureInjection ? '' : window.__LF_PARTICLE_TEST_FAIL_AT);
    var prepared = prepareCustomParticlePreset(value);
    if (!prepared) {
      if (options.destroyWhenAbsent !== false) {
        destroyCustomParticleRuntime({ restoreLegacy:true, restoreCamera:true, persist:options.persist !== false });
      }
      return null;
    }
    var resources = buildCustomParticleResources(prepared);
    var previousSnapshot = captureCustomParticleRuntime();
    var previousRuntime = customParticleRuntime;
    var legacyVisibility = previousRuntime ? previousRuntime.legacyVisibility : captureLegacyParticleVisibility(prepared.common);
    var savedCamera = previousRuntime ? previousRuntime.savedCamera : captureSharedCamera();
    try {
      if (injectedFailure === 'after-build') throw new Error('PARTICLE_TEST_FAILURE_AFTER_BUILD');
      if (previousRuntime) {
        customParticleRuntime = null;
        disposeCustomParticleInstance(previousRuntime, { restoreLegacy:false, restoreCamera:false });
      }
      var cameraState = customParticleClone(prepared.camera);
      var runtime = {
        mode:prepared.mode, prepared:prepared, resources:resources, camera:cameraState,
        initialCamera:customParticleClone(cameraState), legacyVisibility:legacyVisibility, savedCamera:savedCamera,
        listeners:[], drag:null, elapsed:Math.max(0, finite(options.elapsed, 0)),
        audio:{ bass:0, mid:0, treble:0, flux:0 }, boundsRadius:prepared.mode === CUSTOM_PARTICLE_MODES.goldenStarTrailOrbitField ? 32 : 28,
        generation:++customParticleGeneration
      };
      restoreCameraControllerState(runtime.camera, options.controller);
      window.scene.add(resources.group);
      customParticleRuntime = runtime;
      bindCustomParticleInteraction(runtime);
      customParticleBuildCount++;
      if (injectedFailure === 'after-renderer') throw new Error('PARTICLE_TEST_FAILURE_AFTER_RENDERER');
      updateCustomParticleFrame(performance.now(), 0.016);
      if (options.persist !== false) persistCustomParticleRuntime();
      installGoldenVisualConsoleBindings();
      decorateGoldenAtomicPresetCard();
      return captureCustomParticleRuntime();
    } catch (error) {
      if (customParticleRuntime && customParticleRuntime.resources === resources) {
        var failed = customParticleRuntime; customParticleRuntime = null;
        disposeCustomParticleInstance(failed, { restoreLegacy:false, restoreCamera:false });
      } else {
        try { if (resources.geometry) resources.geometry.dispose(); } catch (_) {}
        try { if (resources.material) resources.material.dispose(); } catch (_) {}
      }
      if (previousSnapshot && previousSnapshot.active) {
        try {
          applyCustomParticlePreset(previousSnapshot.canonical, {
            controller:previousSnapshot.controller, elapsed:previousSnapshot.elapsed, persist:false,
            suppressFailureInjection:true
          });
        } catch (_) {
          setLegacyParticleVisibility(legacyVisibility, false);
          restoreSharedCamera(savedCamera);
        }
      } else {
        setLegacyParticleVisibility(legacyVisibility, false);
        restoreSharedCamera(savedCamera);
      }
      throw error;
    }
  }
  function restoreCustomParticleRuntime(snapshot, options) {
    options = options || {};
    if (!snapshot || snapshot.active !== true || !snapshot.canonical) {
      destroyCustomParticleRuntime({ restoreLegacy:true, restoreCamera:true, persist:options.persist !== false });
      return { active:false };
    }
    return applyCustomParticlePreset(snapshot.canonical, {
      controller:snapshot.controller, elapsed:snapshot.elapsed,
      persist:options.persist !== false, failAt:options.failAt,
      suppressFailureInjection:options.suppressFailureInjection === true
    });
  }
  function applyCustomParticleVisualUniforms(runtime) {
    if (!runtime || !runtime.resources || !runtime.resources.material) return false;
    var common = runtime.prepared.common;
    var uniforms = runtime.resources.material.uniforms;
    uniforms.uPointSize.value = common.point;
    uniforms.uSpeed.value = common.speed;
    uniforms.uTwist.value = common.twist;
    uniforms.uColorStrength.value = common.color;
    uniforms.uScatter.value = common.scatter;
    uniforms.uOpacity.value = Math.max(0.08, 1 - common.bgFade * 0.54);
    uniforms.uBloom.value = common.bloom ? common.bloomStrength : 0;
    uniforms.uSharp.value = common.edge && common.hdSharp && !common.blur ? 1 : 0;
    uniforms.uDepth.value = common.depth * (common.cinema ? 1 : 0.86);
    uniforms.uDepthDistribution.value = common.depthDistribution ? 1 : 0;
    uniforms.uFloatLayer.value = common.floatLayer ? 1 : 0;
    uniforms.uIntensity.value = common.intensity;
    uniforms.uTint.value.set(common.visualTintColor);
    uniforms.uResolutionScale.value = common.coverResolution / 1.15;
    var blending = common.bloom ? window.THREE.AdditiveBlending : window.THREE.NormalBlending;
    if (runtime.resources.material.blending !== blending) {
      runtime.resources.material.blending = blending;
      runtime.resources.material.needsUpdate = true;
    }
    return true;
  }
  function syncCustomParticleVisualConsole(runtime) {
    runtime = runtime || customParticleRuntime;
    if (!runtime || !window.fx) return false;
    var fxState = window.fx, common = runtime.prepared.common, canonical = runtime.prepared.canonical;
    var particles = canonical.particles || (canonical.particles = {});
    var visual = canonical.visual || (canonical.visual = {});
    var dynamic = {
      point:[0.25,8], speed:[0,5], twist:[-4,4], color:[0,3], scatter:[0,3],
      bgFade:[0,1.5], bloomStrength:[0,3]
    };
    Object.keys(dynamic).forEach(function (key) {
      if (!own(fxState,key)) return;
      common[key] = Math.max(dynamic[key][0], Math.min(dynamic[key][1], finite(fxState[key], common[key])));
      particles[key] = common[key];
    });
    ['bloom','edge','cinema','floatLayer'].forEach(function (key) {
      if (!own(fxState,key)) return;
      common[key] = fxState[key] === true;
      particles[key] = common[key];
    });
    ['intensity','depth'].forEach(function (key) {
      if (!own(fxState,key)) return;
      common[key] = Math.max(0.1, Math.min(4, finite(fxState[key], common[key])));
      visual[key] = common[key];
    });
    if (own(fxState,'cinemaShake')) {
      common.cinemaShake = Math.max(0, Math.min(1.8, finite(fxState.cinemaShake, common.cinemaShake)));
      visual.cinemaShake = common.cinemaShake;
    }
    if (own(fxState,'coverResolution')) {
      common.coverResolution = Math.max(0.75, Math.min(1.55, finite(fxState.coverResolution, common.coverResolution)));
      visual.coverResolution = common.coverResolution;
    }
    if (own(fxState,'visualTintColor') && /^#[0-9a-f]{6}$/i.test(String(fxState.visualTintColor))) {
      common.visualTintColor = String(fxState.visualTintColor).toLowerCase();
      visual.visualTintColor = common.visualTintColor;
    }
    applyCustomParticleVisualUniforms(runtime);
    syncGoldenConsoleControls();
    scheduleCustomParticlePersist();
    return true;
  }
  function mergeCustomParticleCanonical(patch) {
    if (!customParticleRuntime || !patch || typeof patch !== 'object' || Array.isArray(patch)) return false;
    function merge(target, source) {
      Object.keys(source).forEach(function (key) {
        var value = source[key];
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          target[key] = target[key] && typeof target[key] === 'object' && !Array.isArray(target[key]) ? target[key] : {};
          merge(target[key], value);
        } else target[key] = customParticleClone(value);
      });
      return target;
    }
    var next = merge(customParticleClone(customParticleRuntime.prepared.canonical), patch);
    return applyCustomParticlePreset(next, { persist:true });
  }
  function updateCustomParticleFrame(now, dt) {
    var runtime = customParticleRuntime;
    if (!runtime) return;
    dt = Math.max(0, Math.min(0.1, finite(dt, 0.016)));
    var visible = customParticleStageVisible();
    runtime.resources.group.visible = visible;
    if (!visible) {
      setLegacyParticleVisibility(runtime.legacyVisibility, false);
      return;
    }
    setLegacyParticleVisibility(runtime.legacyVisibility, true);
    runtime.elapsed += dt;
    var paused = !window.audio || window.audio.paused;
    var targetBass = paused ? 0 : Math.max(0, finite(window.bass, 0));
    var targetMid = paused ? 0 : Math.max(0, finite(window.mid, 0));
    var targetTreble = paused ? 0 : Math.max(0, finite(window.treble, 0));
    var energy = paused ? 0 : Math.max(0, finite(window.audioEnergy, 0));
    var release = Math.max(0.01, Math.min(0.99, finite(runtime.prepared.topology.pauseRelease, 0.9)));
    var attack = 1 - Math.pow(0.16, dt * 60), decay = 1 - Math.pow(Math.max(0.01, Math.min(0.99, release)), dt * 60);
    function envelope(previous, target) { return previous + (target - previous) * (target > previous ? attack : decay); }
    runtime.audio.bass = envelope(runtime.audio.bass, targetBass);
    runtime.audio.mid = envelope(runtime.audio.mid, targetMid);
    runtime.audio.treble = envelope(runtime.audio.treble, targetTreble);
    var fluxTarget = paused ? 0 : Math.max(0, energy - customParticleLastEnergy) * 5 + Math.max(0, finite(window.beatPulse, 0)) * 0.22;
    runtime.audio.flux = envelope(runtime.audio.flux, fluxTarget);
    customParticleLastEnergy = energy;
    var uniforms = runtime.resources.material.uniforms;
    uniforms.uTime.value = runtime.elapsed;
    uniforms.uBass.value = runtime.audio.bass;
    uniforms.uMid.value = runtime.audio.mid;
    uniforms.uTreble.value = runtime.audio.treble;
    uniforms.uFlux.value = runtime.audio.flux;
    uniforms.uPixel.value = window.renderer && typeof window.renderer.getPixelRatio === 'function' ? window.renderer.getPixelRatio() : (devicePixelRatio || 1);
    updateCustomParticleCamera(runtime, dt);
  }
  function restoreScopedCustomParticleRuntime() {
    if (!customParticleOwnerReady()) return false;
    var snapshot = readScopedValue(STORE.particleRuntime, null);
    if (snapshot && snapshot.active && snapshot.canonical) {
      try { restoreCustomParticleRuntime(snapshot, { persist:false }); return true; } catch (_) {}
    }
    var currentId = readScopedCurrentPresetId();
    var store = canonicalArchiveStore();
    var canonical = currentId && store.presets && store.presets[currentId];
    if (canonical && canonical.particles && canonical.particles.custom) {
      try { applyCustomParticlePreset(canonical, { persist:false }); return true; } catch (_) {}
    }
    destroyCustomParticleRuntime({ restoreLegacy:true, restoreCamera:true, persist:false });
    return false;
  }
  function switchCustomParticleUser(userId) {
    if (customParticleScopeReady) persistCustomParticleRuntime();
    destroyCustomParticleRuntime({ restoreLegacy:true, restoreCamera:true, persist:false });
    if (userId !== undefined) customParticleScopeOverride = '';
    customParticleScopeReady = true;
    try { migrateCanonicalArchives(); } catch (_) {}
    return restoreScopedCustomParticleRuntime();
  }
  function setCustomParticleTestUser(userId) {
    if (customParticleScopeReady) persistCustomParticleRuntime();
    destroyCustomParticleRuntime({ restoreLegacy:true, restoreCamera:true, persist:false });
    customParticleScopeOverride = String(userId == null ? '' : userId).trim();
    customParticleScopeReady = true;
    try { migrateCanonicalArchives(); } catch (_) {}
    restoreScopedCustomParticleRuntime();
    syncConsoleFoldState();
    return customParticleScopeKey();
  }
  var GOLDEN_ATOMIC_PRESET_ASSET = 'lf-golden-atomic-star-trail-preset.json';
  var goldenAtomicPresetPromise = null;
  function loadGoldenAtomicPreset() {
    if (!goldenAtomicPresetPromise) goldenAtomicPresetPromise = fetch(GOLDEN_ATOMIC_PRESET_ASSET, { cache:'no-cache' }).then(function (response) {
      if (!response.ok) throw new Error('金色量子预设资源加载失败：HTTP ' + response.status);
      return response.json();
    }).then(function (payload) {
      var normalized = canonicalSchemaApi().normalize(payload, { fileName:GOLDEN_ATOMIC_PRESET_ASSET });
      if (normalized.ignoredFields.length || normalized.invalidFields.length) throw new Error('金色量子预设字段校验未通过');
      return normalized;
    }).catch(function (error) {
      goldenAtomicPresetPromise = null;
      throw error;
    });
    return goldenAtomicPresetPromise.then(function (value) { return customParticleClone(value); });
  }
  function applyGoldenAtomicPreset(options) {
    options = options || {};
    return loadGoldenAtomicPreset().then(function (normalized) {
      var parsed = transactionalFromSchemaResult(normalized);
      var result = applyTransactionalPreset(parsed, {
        createArchive:options.createArchive !== false, importWallpaper:false,
        presetId:normalized.canonical.presetId, failAt:options.failAt, failAtStage:options.failAtStage,
        silent:options.silent === true
      });
      decorateGoldenAtomicPresetCard();
      return result;
    });
  }
  var GOLDEN_DYNAMIC_CONTROLS = [
    { key:'point', label:'粒子尺寸', type:'range', min:0.25, max:8, step:0.01 },
    { key:'speed', label:'整体运动速度', type:'range', min:0, max:5, step:0.01 },
    { key:'twist', label:'轨道进动与景深扭曲', type:'range', min:-4, max:4, step:0.01 },
    { key:'color', label:'金色层次强度', type:'range', min:0, max:3, step:0.01 },
    { key:'scatter', label:'轨道与背景离散', type:'range', min:0, max:3, step:0.01 },
    { key:'bgFade', label:'轨迹残留压缩', type:'range', min:0, max:1.5, step:0.001 },
    { key:'bloomStrength', label:'核心与粒子溢光', type:'range', min:0, max:3, step:0.01 },
    { key:'floatLayer', label:'背景景深层', type:'checkbox' },
    { key:'cinema', label:'透视景深响应', type:'checkbox' },
    { key:'edge', label:'粒子锐边', type:'checkbox' },
    { key:'depthDistribution', label:'几何深度分布', type:'checkbox' },
    { key:'bloom', label:'溢光管线', type:'checkbox' }
  ];
  var GOLDEN_ADVANCED_CONTROLS = [
    ['particleCount','粒子预算','number',1024,100000,256],
    ['orbitTrailCount','轨道数量','number',1,32,1],
    ['orbitRadii','轨道半径','json'], ['orbitEccentricity','轨道形状','json'],
    ['orbitSpeeds','逐轨速度','json'], ['orbitTilts','逐轨方向','json'],
    ['trailPersistence','轨迹持续','number',0,1,0.01], ['trailWidth','轨迹宽度','number',0.01,2,0.01],
    ['coreRadius','核心半径','number',0.2,32,0.05], ['coreParticleCount','核心密度','number',0,100000,100],
    ['backgroundStarCount','背景密度','number',0,100000,100],
    ['mouseRotationStrength','拖动旋转','number',0,4,0.01], ['mouseTranslationStrength','拖动平移','number',0,4,0.01],
    ['mouseSmoothing','交互平滑','number',0.01,1,0.01], ['zoomSensitivity','缩放响应','number',0.01,2,0.01]
  ];
  function resizedGoldenOrbitArrays(custom, count) {
    var arrays = {
      orbitRadii:function (source) { return finite(source[source.length - 1], 8) + 8; },
      orbitEccentricity:function (source) { return finite(source[source.length - 1], 1.4); },
      orbitSpeeds:function (source) { return -finite(source[source.length - 1], 0.02) * 0.82; },
      orbitTilts:function (source) { var last=source[source.length-1]; return Array.isArray(last) ? last.slice() : [0,0,0]; },
      orbitPhaseOffsets:function (source) { return finite(source[source.length - 1], 0) + Math.PI * 2 / count; },
      orbitPrecessionSpeeds:function (source) { return -finite(source[source.length - 1], 0.001) * 0.88; },
      orbitThickness:function (source) { return finite(source[source.length - 1], 0.2); },
      orbitClusterCount:function (source) { return Math.max(1, finiteInt(source[source.length - 1], 12, 1, 256)); }
    };
    Object.keys(arrays).forEach(function (key) {
      var source = Array.isArray(custom[key]) ? custom[key].slice(0,count) : [];
      while (source.length < count) source.push(arrays[key](source));
      custom[key] = source;
    });
    return custom;
  }
  function updateGoldenAdvancedField(path, value) {
    if (!customParticleRuntime) return false;
    var custom = customParticleClone(customParticleRuntime.prepared.canonical.particles.custom);
    var key = String(path).split('.').pop();
    if (key === 'orbitTrailCount') {
      value = finiteInt(value, custom.orbitTrailCount, 1, 32);
      custom.orbitTrailCount = value;
      resizedGoldenOrbitArrays(custom, value);
    } else if (key === 'particleCount') custom[key] = finiteInt(value, custom[key], CUSTOM_PARTICLE_MIN, CUSTOM_PARTICLE_MAX);
    else if (key === 'coreParticleCount' || key === 'backgroundStarCount') custom[key] = finiteInt(value, custom[key], 0, CUSTOM_PARTICLE_MAX);
    else custom[key] = customParticleClone(value);
    return mergeCustomParticleCanonical({ particles:{ custom:custom } });
  }
  function updateGoldenDynamicField(key, value) {
    var runtime = customParticleRuntime;
    if (!runtime || runtime.mode !== CUSTOM_PARTICLE_MODES.goldenStarTrailOrbitField) return false;
    var descriptor = GOLDEN_DYNAMIC_CONTROLS.filter(function (row) { return row.key === key; })[0];
    if (!descriptor) return false;
    if (descriptor.type === 'checkbox') value = value === true;
    else value = Math.max(descriptor.min, Math.min(descriptor.max, finite(value, runtime.prepared.common[key])));
    runtime.prepared.common[key] = value;
    runtime.prepared.canonical.particles[key] = value;
    applyCustomParticleVisualUniforms(runtime);
    scheduleCustomParticlePersist();
    return true;
  }
  function syncGoldenConsoleControls() {
    var runtime = customParticleRuntime;
    var goldenActive = !!(runtime && runtime.mode === CUSTOM_PARTICLE_MODES.goldenStarTrailOrbitField);
    ['lf-golden-dynamic-controls','lf-golden-console-controls'].forEach(function (id) {
      var section = byId(id);
      if (!section) return;
      section.hidden = !goldenActive;
      section.querySelectorAll('input,textarea,button,select').forEach(function (control) { control.disabled = !goldenActive; });
    });
    if (!goldenActive) return;
    GOLDEN_DYNAMIC_CONTROLS.forEach(function (descriptor) {
      var node = document.querySelector('#lf-golden-dynamic-controls [data-lf-canonical-path="particles.' + descriptor.key + '"]');
      if (!node) return;
      if (descriptor.type === 'checkbox') node.checked = runtime.prepared.common[descriptor.key] === true;
      else {
        node.value = String(runtime.prepared.common[descriptor.key]);
        var output = node.parentElement && node.parentElement.querySelector('output');
        if (output) output.textContent = Number(node.value).toFixed(descriptor.key === 'bgFade' ? 3 : 2);
      }
    });
    GOLDEN_ADVANCED_CONTROLS.forEach(function (descriptor) {
      var node = document.querySelector('[data-lf-p14-path="particles.custom.' + descriptor[0] + '"]');
      if (!node) return;
      var value = runtime.prepared.canonical.particles.custom[descriptor[0]];
      node.value = descriptor[2] === 'json' ? JSON.stringify(value) : String(value);
    });
  }
  function installGoldenVisualConsoleBindings() {
    if (typeof window.organizeFxPanel === 'function') window.organizeFxPanel();
    var body = byId('fx-advanced') && byId('fx-advanced').querySelector('.fx-advanced-body');
    var motion = document.querySelector('#fx-panel .fx-tab-page[data-fx-page="motion"]');
    if (!body || !motion) return false;
    GOLDEN_DYNAMIC_CONTROLS.forEach(function (descriptor) {
      document.querySelectorAll('[data-lf-canonical-path="particles.' + descriptor.key + '"]').forEach(function (node) {
        if (!node.closest('#lf-golden-dynamic-controls')) node.removeAttribute('data-lf-canonical-path');
      });
    });
    if (!byId('lf-golden-dynamic-controls')) {
      var dynamicSection = document.createElement('section');
      dynamicSection.id = 'lf-golden-dynamic-controls';
      dynamicSection.className = 'lf-t13-golden-controls lf-t13-golden-dynamic-controls';
      dynamicSection.innerHTML = '<div class="fx-section-label">金色量子 · 动态</div>' +
        GOLDEN_DYNAMIC_CONTROLS.map(function (descriptor) {
          var path = 'particles.' + descriptor.key;
          if (descriptor.type === 'checkbox') {
            return '<label class="fx-toggle lf-t13-golden-toggle"><span>' + descriptor.label + '</span><input type="checkbox" data-lf-canonical-path="' + path + '" aria-label="' + descriptor.label + '"></label>';
          }
          return '<label class="fx-slider"><span>' + descriptor.label + '</span><input type="range" min="' + descriptor.min + '" max="' + descriptor.max + '" step="' + descriptor.step + '" data-lf-canonical-path="' + path + '" aria-label="' + descriptor.label + '"><output></output></label>';
        }).join('');
      motion.appendChild(dynamicSection);
      dynamicSection.querySelectorAll('[data-lf-canonical-path]').forEach(function (control) {
        var key = String(control.getAttribute('data-lf-canonical-path')).slice('particles.'.length);
        var eventName = control.type === 'checkbox' ? 'change' : 'input';
        control.addEventListener(eventName, function () {
          var value = control.type === 'checkbox' ? control.checked : Number(control.value);
          if (!updateGoldenDynamicField(key, value)) return;
          var output = control.parentElement && control.parentElement.querySelector('output');
          if (output && control.type !== 'checkbox') output.textContent = Number(control.value).toFixed(key === 'bgFade' ? 3 : 2);
        });
      });
    }
    if (!byId('lf-golden-console-controls')) {
      var section = document.createElement('section'); section.id = 'lf-golden-console-controls';
      section.className = 'lf-t13-golden-controls';
      section.innerHTML = '<div class="fx-section-label">金色量子 · 全字段控制</div>' +
        GOLDEN_ADVANCED_CONTROLS.map(function (descriptor) {
          var key=descriptor[0], path='particles.custom.'+key;
          if (descriptor[2] === 'json') return '<label class="fx-slider lf-t13-golden-json"><span>'+descriptor[1]+'</span><textarea rows="2" data-lf-p14-path="'+path+'" aria-label="'+descriptor[1]+'"></textarea></label>';
          return '<label class="fx-slider"><span>'+descriptor[1]+'</span><input type="number" min="'+descriptor[3]+'" max="'+descriptor[4]+'" step="'+descriptor[5]+'" data-lf-p14-path="'+path+'" aria-label="'+descriptor[1]+'"></label>';
        }).join('');
      body.appendChild(section);
      section.querySelectorAll('[data-lf-p14-path]').forEach(function (control) {
        control.addEventListener('change', function () {
          var descriptor = GOLDEN_ADVANCED_CONTROLS.filter(function (row) { return control.getAttribute('data-lf-p14-path') === 'particles.custom.' + row[0]; })[0];
          if (!descriptor || !customParticleRuntime) return;
          try {
            var value = descriptor[2] === 'json' ? JSON.parse(control.value) : Number(control.value);
            updateGoldenAdvancedField(control.getAttribute('data-lf-p14-path'), value);
          } catch (error) { show('金色量子参数无效：' + error.message); }
          syncGoldenConsoleControls();
        });
      });
    }
    syncGoldenConsoleControls();
    return true;
  }
  function decorateGoldenAtomicPresetCard() {
    var grid = byId('preset-grid');
    if (!grid) return false;
    var card = grid.querySelector('[data-custom-preset="golden-atomic-star-trail"]');
    if (!card) {
      card = document.createElement('button');
      card.type = 'button'; card.className = 'preset-card';
      card.dataset.customPreset = 'golden-atomic-star-trail';
      card.title = '应用金色量子自由星轨粒子';
      card.innerHTML = '<span class="pc-icon" aria-hidden="true">✦</span><span class="pc-name">金色量子自由星轨</span><span class="pc-desc">11轨分面核心 · 12级定轴缩放</span>';
      card.addEventListener('click', function () {
        if (card.disabled) return;
        card.disabled = true;
        applyGoldenAtomicPreset({ createArchive:true }).catch(function (error) { show(error.message); }).finally(function () { card.disabled = false; });
      });
      grid.appendChild(card);
    }
    card.classList.toggle('active', !!(customParticleRuntime && customParticleRuntime.prepared.presetId === 'lf-golden-atomic-star-trail-free-orbit-v5.3.1'));
    card.setAttribute('aria-pressed', card.classList.contains('active') ? 'true' : 'false');
    return true;
  }
  window.LumiFieldCustomParticles = {
    prepare:prepareCustomParticlePreset, apply:applyCustomParticlePreset,
    capture:captureCustomParticleRuntime, restore:restoreCustomParticleRuntime,
    destroy:function () { return destroyCustomParticleRuntime({ restoreLegacy:true, restoreCamera:true }); },
    leaveForBuiltIn:leaveCustomParticleForBuiltIn,
    ownsCanvasInput:customParticleOwnsCanvasInput,
    worldUiTransform:customParticleWorldUiTransform,
    updateFrame:updateCustomParticleFrame,
    update:mergeCustomParticleCanonical, syncVisualConsole:function () { return syncCustomParticleVisualConsole(customParticleRuntime); },
    installVisualConsoleBindings:installGoldenVisualConsoleBindings,
    loadGoldenAtomicPreset:loadGoldenAtomicPreset, applyGoldenAtomicPreset:applyGoldenAtomicPreset,
    decoratePresetGrid:decorateGoldenAtomicPresetCard, retireDeprecatedPresets:retireDeprecatedParticlePresets,
    debug:customParticleDebugSnapshot, setTestUser:setCustomParticleTestUser
  };
  setTimeout(function () { decorateGoldenAtomicPresetCard(); installGoldenVisualConsoleBindings(); }, 0);

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
    if (controlStatusText) controlStatusText.textContent = lyricState.translate && hasRealLyrics ? (translated ? '已显示翻译' : translationStatus) : '';
    var retryButton = byId('lf-t13-translate-retry');
    if (retryButton) retryButton.hidden = !lyricState.translate || !hasRealLyrics || !translationStatus ||
      /正在|已就绪|平台翻译|翻译服务|离线翻译/.test(translationStatus);

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
      var width = Math.max(1, Math.round(innerWidth * dpr));
      var height = Math.max(1, Math.round(innerHeight * dpr));
      if (!canvas || !ctx || (canvas.width === width && canvas.height === height)) return;
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = innerWidth + 'px';
      canvas.style.height = innerHeight + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
  function spectrumColor(index, count, alpha) {
    var ratio = count <= 1 ? 0 : index / (count - 1);
    var c1 = visibleSpectrumHex(spectrumState.colorA), c2 = visibleSpectrumHex(spectrumState.colorB);
    if (spectrumState.colorMode === 'single') c2 = c1;
    if (spectrumState.colorMode === 'cover') {
      c1 = visibleSpectrumHex(currentVisualTint(c1));
      c2 = visibleSpectrumHex(spectrumState.colorB);
    }
    if (spectrumState.colorMode === 'multi') {
      var hue = (ratio * 300 + performance.now() * 0.018) % 360;
      return 'hsla(' + hue.toFixed(1) + ',88%,67%,' + clamp(alpha, 0, 1).toFixed(3) + ')';
    }
    return mixColor(c1, c2, ratio, alpha);
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
    ctx.save();
    ctx.filter = spectrumState.liquidGlassEnabled ? 'none' : 'brightness(' + brightness.toFixed(3) + ')';
    ctx.globalCompositeOperation = spectrumState.liquidGlassEnabled ? 'screen' : 'source-over';
    if (glow > 0.02 && (!spectrumState.liquidGlassEnabled || !refractedSet)) {
      ctx.shadowColor = mixColor(spectrumState.colorA, spectrumState.colorB, 0.5, Math.min(0.9, alpha));
      ctx.shadowBlur = 2 + glow * 7;
    }
    for (var i = 0; i < count; i++) {
      var energy = values[reverse ? count - 1 - i : i];
      var barHeight = energy * maximumHeight;
      if (barHeight <= 0.08) continue;
      var color = spectrumColor(i, count, alpha);
      var x = layout.xPositions[i];
      var y = fromTop ? baseline : baseline - barHeight;
      var radius = Math.min(barWidth / 2, 7);
      ctx.fillStyle = spectrumState.liquidGlassEnabled ? spectrumColor(i, count, refractedSet ? alpha * 0.28 : alpha * 0.48) : color;
      roundedRect(ctx, x, y, barWidth, barHeight, radius);
      ctx.fill();
      if (spectrumState.liquidGlassEnabled) {
        ctx.strokeStyle = spectrumColor(i, count, Math.min(1, alpha * 0.72 + 0.16));
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
    var expectedDpr = Math.max(1, Math.min(1.5, Math.max(1, devicePixelRatio || 1),
      Math.sqrt(SPECTRUM_PIXEL_BUDGET / Math.max(1, innerWidth * innerHeight))));
    var expectedWidth = Math.round(innerWidth * expectedDpr);
    var expectedHeight = Math.round(innerHeight * expectedDpr);
    if (!spectrumCanvas || spectrumCanvas.width !== expectedWidth || spectrumCanvas.height !== expectedHeight) resizeSpectrumCanvas();
    var count = referenceMode ? 48 : effectiveSpectrumCount();
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
      updateSpectrumStage(values, energyVisible);
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
    var count = referenceMode ? 48 : requestedCount;
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
        barCount: 48,
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
      active: !!spectrumState.enabled && spectrumSurfaceAvailable() && spectrumMaxEnergy > 0.0025,
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
      stageWorldTransform: spectrumStage.group ? {
        parent: spectrumStage.group.parent && (spectrumStage.group.parent.name || spectrumStage.group.parent.type),
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
    syncScopedControls('echo');
    document.querySelectorAll('[data-lf-echo-eq]').forEach(function (input) {
      var index = Number(input.dataset.lfEchoEq);
      if (index >= 0 && index < 8 && document.activeElement !== input) input.value = echoState.visualEq[index];
      var output = input.parentElement && input.parentElement.querySelector('output');
      if (output) output.textContent = Number(echoState.visualEq[index]).toFixed(2);
    });
    var block = byId('lf-t13-echo-block');
    if (block) block.classList.toggle('lf-hide-color-options', !echoState.showColorOptions);
    var modeOneLyrics = block && block.querySelector('.lf-t13-mode1-lyrics-control');
    var modeOneLyricsInput = modeOneLyrics && modeOneLyrics.querySelector('[data-lf-key="mode1LeftLyricsEnabled"]');
    if (modeOneLyrics) modeOneLyrics.classList.toggle('unavailable', echoState.shape !== 'shape1');
    if (modeOneLyricsInput) {
      modeOneLyricsInput.disabled = echoState.shape !== 'shape1';
      modeOneLyricsInput.title = echoState.shape === 'shape1' ? '' : '仅形态一可用';
    }
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

  function themeOptions() {
    var labels = { neonPurple:'霓紫', azure:'沧蓝', ice:'冰蓝', emerald:'翡翠', gold:'流金', ink:'水墨', deepCyan:'幽青', lavender:'薰衣草', sakura:'樱', copper:'锻铜', mint:'薄荷', ember:'余烬', flame:'赤焰', hazePink:'霞粉', fantasy:'幻紫' };
    return Object.keys(THEMES).map(function (key) { return [key, labels[key] || key]; });
  }

  function echoEqControlsHtml() {
    var labels = ['超低频','低频','低中频','中频','中高频','高频','空气感','极高频'];
    return '<fieldset class="lf-t13-echo-eq"><legend>8 段仅视觉 EQ</legend>' + labels.map(function (label, index) {
      return '<label class="lf-t13-field"><span>' + label + '</span><input type="range" min="0" max="2" step="0.01" data-lf-echo-eq="' + index + '" data-lf-visual-eq="visualEq[' + index + ']"><output></output></label>';
    }).join('') + '</fieldset>';
  }

  function echoControlsHtml() {
    return '<details id="lf-t13-echo-block" class="lf-t13-block"><summary><span>音域回响</span><small>两套固定源码独立形态</small></summary><div class="lf-t13-body">' +
      '<div class="lf-t13-echo-toolbar"><select id="lf-t13-echo-builtin"><option value="shape1">形态一 · Sonic Topography / Ajin</option><option value="shape2">形态二 · Sonic Topography / CmzYa</option></select><button type="button" data-lf-echo-action="builtin">应用</button><select id="lf-t13-echo-user"></select></div>' +
      '<div class="lf-t13-echo-toolbar"><button type="button" data-lf-echo-action="save">保存用户存档</button><button type="button" data-lf-echo-action="rename">重命名</button><button type="button" data-lf-echo-action="delete">删除</button><button type="button" data-lf-echo-action="export">导出 JSON</button><button type="button" data-lf-echo-action="import">导入 JSON</button><button type="button" data-lf-echo-action="reset">重置</button></div>' +
      check('echo', 'enabled', '启用音域回响') + select('echo', 'shape', '形态', [['shape1','形态一 · Sonic Topography / Ajin'],['shape2','形态二 · Sonic Topography / CmzYa']]) +
      '<fieldset><legend>基础 / 固定源码渲染</legend>' + check('echo', 'audioMonitor', '音频监听') + range('echo', 'particleStrength', '冲击粒子强度', 0, 2, 0.02) + '<label class="lf-t13-check lf-t13-mode1-lyrics-control"><input type="checkbox" data-lf-scope="echo" data-lf-key="mode1LeftLyricsEnabled"><span>左侧歌词播放</span><small>仅形态一可用</small></label>' + check('echo', 'flip', '翻转') + check('echo', 'showColorOptions', '显示颜色选项') + '</fieldset>' +
      '<fieldset class="lf-t13-echo-colors"><legend>外观</legend>' + select('echo', 'theme', '颜色主题', themeOptions()) + check('echo', 'autoCycle', '自动轮询') + range('echo', 'cycleInterval', '轮询间隔（秒）', 3, 300, 1) + check('echo', 'accentEnabled', '启用强调色') + color('echo', 'accentColor', '强调色') + range('echo', 'accentStrength', '强调色强度', 0, 2, 0.02) + '</fieldset>' +
      '<fieldset><legend>音频响应 / 波纹</legend>' + range('echo', 'responseStrength', '音频响应强度', 0, 3, 0.02) + range('echo', 'responseRange', '响应范围', 0.08, 1, 0.01) + check('echo', 'rippleEnabled', '启用波纹') + range('echo', 'rippleSensitivity', '波纹灵敏度', 0, 1, 0.01) + number('echo', 'rippleCooldown', '波纹冷却帧', 1, 240, 1) + '</fieldset>' + echoEqControlsHtml() +
      '<fieldset><legend>空闲波浪</legend>' + check('echo', 'idleWave', '空闲波浪开关') + range('echo', 'idleDebounce', '空闲波浪防抖（秒）', 0, 20, 0.1) + range('echo', 'idleFade', '空闲波浪淡出（秒）', 0.1, 12, 0.1) + '</fieldset>' +
      '<fieldset><legend>相机</legend>' + range('echo', 'cameraDistance', '视角距离', 0.45, 2.8, 0.01) + range('echo', 'cameraHorizontal', '水平角度', -180, 180, 1) + range('echo', 'cameraElevation', '垂直仰角', 5, 78, 1) + check('echo', 'autoRotate', '自动旋转') + range('echo', 'rotateSpeed', '旋转速度', -2, 2, 0.01) + '<div class="lf-t13-echo-toolbar"><button type="button" data-lf-echo-action="camera-reset">相机归位</button></div></fieldset>' +
      '<fieldset><legend>播放器</legend>' + check('echo', 'playerVisible', '显示播放器') + check('echo', 'playerCover', '显示封面') + range('echo', 'playerSize', '播放器大小', 0.55, 1.8, 0.01) + range('echo', 'playerX', '水平位置', -45, 45, 1) + range('echo', 'playerY', '垂直位置', -34, 34, 1) + '</fieldset>' +
      '<fieldset><legend>形态二 · 峰值强调</legend>' + range('echo', 'exposureStrength', '峰值强调强度', 0, 2, 0.02) + check('echo', 'flashEnabled', '峰值强调色') + check('echo', 'reducedFlash', '降低闪光') + '</fieldset>' +
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
      var eqInput = event.target.closest('[data-lf-echo-eq]');
      if (eqInput) {
        var eq = echoState.visualEq.slice();
        eq[Number(eqInput.dataset.lfEchoEq)] = Number(eqInput.value);
        applyEchoState({ visualEq:eq }, { partial:true, deferPersist:true });
        return;
      }
      var input = event.target.closest('[data-lf-scope][data-lf-key]');
      if (input) setScopedValue(input.dataset.lfScope, input.dataset.lfKey, input);
    });
    panel.addEventListener('change', function (event) {
      var eqInput = event.target.closest('[data-lf-echo-eq]');
      if (eqInput) {
        var eq = echoState.visualEq.slice();
        eq[Number(eqInput.dataset.lfEchoEq)] = Number(eqInput.value);
        applyEchoState({ visualEq:eq }, { partial:true });
        return;
      }
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
        scope:customParticleScopeKey(), state:state,
        folds:Object.keys(CONSOLE_FOLD_DEFAULTS).map(function (key) {
          var fold = document.querySelector('[data-lf-console-fold="' + key + '"]');
          var body = fold && fold.querySelector('[data-lf-console-fold-body]');
          return { key:key, count:document.querySelectorAll('[data-lf-console-fold="' + key + '"]').length, expanded:!!(fold && fold.classList.contains('open')), inert:!!(body && (body.inert || body.hasAttribute('inert'))) };
        })
      };
    },
    setExpanded:function (key, expanded) { return setConsoleFoldExpanded(key, expanded); },
    setTestUser:function (userId) { var scope = setCustomParticleTestUser(userId); relocateTask15ConsoleBlocks(); return scope; }
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
    if (shape === 'shape2') Object.assign(state, { theme:'fantasy', exposureStrength:1, reducedFlash:true });
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
      applyEchoState({ cameraDistance:1.05, cameraHorizontal:0, cameraElevation:34, autoRotate:false }, { partial:true });
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
    var patch = { core:{}, lyrics:{}, spectrum:{}, echo:{}, glass:{}, player:{}, camera:{}, customParticles:null };
    function core(namespace, keys) {
      var source = canonical[namespace];
      if (!source) return;
      keys.forEach(function (key) { if (Object.prototype.hasOwnProperty.call(source, key)) patch.core[key] = cloneJson(source[key]); });
    }
    core('visual', CORE_NAMESPACE_KEYS.visual);
    core('particles', CORE_NAMESPACE_KEYS.particles);
    core('lyrics', CORE_NAMESPACE_KEYS.lyrics);
    if (canonical.particles && canonical.particles.custom) patch.customParticles = cloneJson(canonical.particles.custom);
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
    if (customParticleRuntime && customParticleRuntime.prepared && customParticleRuntime.prepared.canonical) {
      var authoritative = cloneJson(customParticleRuntime.prepared.canonical);
      if (name) authoritative.name = String(name).slice(0, 64);
      if (presetId) authoritative.presetId = presetId;
      return schema.normalize(authoritative, { allowEmpty:true }).canonical;
    }
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
    if (namespace === 'particles') {
      if (path[0] === 'custom') {
        return nestedCanonicalValue(customParticleRuntime && customParticleRuntime.prepared.canonical.particles, path);
      }
      return nestedCanonicalValue(window.fx, path);
    }
    if (namespace === 'lyrics') {
      if (path[0] === 'translate') return lyricState.translate;
      return nestedCanonicalValue(window.fx, path);
    }
    if (namespace === 'spectrum') return nestedCanonicalValue(spectrumState, path);
    if (namespace === 'echo') return nestedCanonicalValue(echoState, path);
    if (namespace === 'camera') {
      if (customParticleRuntime) return nestedCanonicalValue(customParticleRuntime.prepared.canonical.camera || {}, path);
      return path[0] === 'cam' ? window.fx && window.fx.cam : undefined;
    }
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
      if (window.setPreset(core.preset, { silent:true, preserveCamera:false, skipTransition:false, noSave:true, commitPlaybackPreset:true }) === false) {
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
    return true;
    if (typeof window.applySavedLyricPaletteState === 'function') window.applySavedLyricPaletteState();
    if (typeof window.refreshCurrentLyricStyle === 'function') window.refreshCurrentLyricStyle();
    if (typeof window.applyDesktopLyricsState === 'function') window.applyDesktopLyricsState(true);
    if (typeof window.saveLyricLayout === 'function') window.saveLyricLayout();
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
      STORE.particleRuntime, 'lumifield-liquid-glass-v2', 'lumifield-user-fx-archives-v1', 'lumifield-lyric-layout-v1'
    ];
    var snapshot = {
      fx: window.fx ? Object.assign({}, window.fx) : null,
      lyrics:cloneJson(lyricState), spectrum:cloneJson(spectrumState), echo:cloneJson(echoState),
      glass:readJson('lumifield-liquid-glass-v2', {}), imports:importedMetaMap(),
      archives:Array.isArray(window.userFxArchives) ? cloneJson(window.userFxArchives) : null,
      storage:storageSnapshot(storageKeys),
      particles:captureCustomParticleRuntime()
    };
    var presetId = options.presetId || (parsed.canonical && parsed.canonical.presetId) || makePresetId();
    var rowsBefore = importDiff(parsed);
    try {
      var preparedParticles = prepareCustomParticlePreset(parsed.canonical);
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
      if (preparedParticles) {
        applyCustomParticlePreset(preparedParticles, {
          persist:false,
          failAt:options.failAt || (options.failAtStage === 'after-renderer' ? 'after-renderer' : '')
        });
      } else {
        destroyCustomParticleRuntime({ restoreLegacy:true, restoreCamera:true, persist:false });
      }
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
      if (!persistCustomParticleRuntime()) throw new Error('粒子运行状态持久化失败');
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
      try { restoreCustomParticleRuntime(snapshot.particles, { persist:false, suppressFailureInjection:true }); } catch (_) {
        destroyCustomParticleRuntime({ restoreLegacy:true, restoreCamera:true, persist:false });
      }
      if (!options.silent) show('预设应用失败，已自动回滚：' + (error && error.message || '未知错误'));
      if (options.failAt || options.failAtStage || window.__LF_PARTICLE_TEST_FAIL_AT) {
        var restoredParticles = captureCustomParticleRuntime();
        var storageRestored = Object.keys(snapshot.storage).every(function (key) {
          try { return localStorage.getItem(key) === snapshot.storage[key]; } catch (_) { return false; }
        });
        var particleRestored = restoredParticles.active === snapshot.particles.active &&
          (!snapshot.particles.active || (
            restoredParticles.mode === snapshot.particles.mode &&
            restoredParticles.presetId === snapshot.particles.presetId
          ));
        return {
          ok:false,
          state:'rolled-back',
          error:String(error && error.message || 'PRESET_APPLY_FAILED'),
          rollback:{ attempted:true, succeeded:storageRestored && particleRestored }
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
    if (patch.customParticles) {
      raw.particles = raw.particles || {};
      raw.particles.custom = cloneJson(patch.customParticles);
    }
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
  function retiredParticlePresetNames() {
    return [
      ['GPT海啸','粒子预设1'].join(''),
      ['GPT粒子预设_白色正圆','超大半径自由星轨粒子'].join(''),
      ['GPT粒子预设_正圆','光环白色粒子'].join('')
    ];
  }
  function retiredParticlePresetIds() {
    return [
      ['lf-retired-gpt-tsunami','-preset-1'].join(''),
      ['lf-retired-gpt-white','-large-orbit'].join(''),
      ['lf-retired-gpt-white','-ring'].join('')
    ];
  }
  function retiredParticlePresetId(value) {
    return retiredParticlePresetIds().indexOf(String(value || '').trim()) >= 0;
  }
  function retiredParticleRecord(value) {
    if (!value || typeof value !== 'object') return false;
    var names = retiredParticlePresetNames();
    var candidates = [value, value.canonical, value.parsed, value.parsed && value.parsed.canonical,
      value.snapshot, value.snapshot && value.snapshot.canonical].filter(function (entry) {
      return !!entry && typeof entry === 'object' && !Array.isArray(entry);
    });
    return candidates.some(function (candidate) {
      var identity = [candidate.name,candidate.title,candidate.presetId,candidate.id,candidate.fileName].map(function (entry) {
        return String(entry || '').replace(/\.json$/i,'').trim();
      });
      if (identity.some(function (entry) { return names.indexOf(entry) >= 0 || retiredParticlePresetId(entry); })) return true;
      var custom = candidate.particles && candidate.particles.custom || candidate.customParticles;
      var mode = String(custom && (custom.effectMode || custom.waveMode) || candidate.mode || '');
      return mode === ['luminous','OrbitVortex'].join('') || mode === ['tsunami','Curl'].join('');
    });
  }
  function mapScopedValues(raw, transform) {
    if (raw && raw.schema === CUSTOM_SCOPE_SCHEMA && raw.scopes && typeof raw.scopes === 'object' && !Array.isArray(raw.scopes)) {
      var next = customParticleClone(raw);
      Object.keys(next.scopes).forEach(function (scope) { next.scopes[scope] = transform(next.scopes[scope], scope); });
      return next;
    }
    return transform(raw, 'legacy');
  }
  function retireDeprecatedParticlePresets() {
    var keys = [STORE.canonicalPresets, STORE.imports, STORE.currentPreset, STORE.particleRuntime, 'lumifield-user-fx-archives-v1', STORE.presetShares];
    var before = storageSnapshot(keys), removedByScope = {}, removedAll = {};
    function mark(scope, id) {
      id = String(id || ''); if (!id) return;
      (removedByScope[scope] || (removedByScope[scope] = {}))[id] = true; removedAll[id] = true;
    }
    try {
      var canonicalRoot = readRawJson(STORE.canonicalPresets);
      var canonicalNext = mapScopedValues(canonicalRoot, function (store, scope) {
        if (!store || typeof store !== 'object' || Array.isArray(store)) return store;
        store = customParticleClone(store); store.presets = store.presets && typeof store.presets === 'object' ? store.presets : {};
        Object.keys(store.presets).forEach(function (id) {
          if (!retiredParticleRecord(store.presets[id])) return;
          mark(scope,id); delete store.presets[id];
        });
        if (store.archiveKeys && typeof store.archiveKeys === 'object') Object.keys(store.archiveKeys).forEach(function (key) {
          var presetId = String(store.archiveKeys[key] || '');
          if (retiredParticlePresetId(presetId) || removedByScope[scope] && removedByScope[scope][presetId]) delete store.archiveKeys[key];
        });
        return store;
      });
      if (JSON.stringify(canonicalNext) !== JSON.stringify(canonicalRoot)) localStorage.setItem(STORE.canonicalPresets, JSON.stringify(canonicalNext));

      var archiveRoot = readRawJson('lumifield-user-fx-archives-v1');
      var archiveNext = mapScopedValues(archiveRoot, function (list, scope) {
        if (!Array.isArray(list)) return list;
        return list.filter(function (slot) {
          if (!retiredParticleRecord(slot)) return true;
          mark(scope,slot && slot.id); return false;
        });
      });
      if (JSON.stringify(archiveNext) !== JSON.stringify(archiveRoot)) localStorage.setItem('lumifield-user-fx-archives-v1', JSON.stringify(archiveNext));
      if (Array.isArray(window.userFxArchives)) {
        var live = window.userFxArchives.filter(function (slot) { return !retiredParticleRecord(slot); });
        if (live.length !== window.userFxArchives.length) {
          window.userFxArchives.length = 0; Array.prototype.push.apply(window.userFxArchives, live);
          if (typeof window.saveUserFxArchives === 'function') window.saveUserFxArchives();
          if (typeof window.renderUserFxArchives === 'function') window.renderUserFxArchives();
        }
      }

      var importsRoot = readRawJson(STORE.imports);
      var importsNext = mapScopedValues(importsRoot, function (map, scope) {
        if (!map || typeof map !== 'object' || Array.isArray(map)) return map;
        map = customParticleClone(map);
        Object.keys(map).forEach(function (key) {
          var meta = map[key], presetId = String(meta && meta.presetId || key);
          if (retiredParticlePresetId(presetId) || (removedByScope[scope] && removedByScope[scope][presetId]) || retiredParticleRecord(meta && (meta.parsed && meta.parsed.canonical || meta.parsed || meta))) delete map[key];
        });
        return map;
      });
      if (JSON.stringify(importsNext) !== JSON.stringify(importsRoot)) localStorage.setItem(STORE.imports, JSON.stringify(importsNext));

      var currentRoot = readRawJson(STORE.currentPreset);
      var currentNext = mapScopedValues(currentRoot, function (id, scope) {
        return retiredParticlePresetId(id) || removedByScope[scope] && removedByScope[scope][String(id || '')] ? '' : id;
      });
      if (JSON.stringify(currentNext) !== JSON.stringify(currentRoot)) localStorage.setItem(STORE.currentPreset, JSON.stringify(currentNext));

      var runtimeRoot = readRawJson(STORE.particleRuntime);
      var runtimeNext = mapScopedValues(runtimeRoot, function (snapshot, scope) {
        var presetId = String(snapshot && snapshot.presetId || '');
        return retiredParticlePresetId(presetId) || removedByScope[scope] && removedByScope[scope][presetId] || retiredParticleRecord(snapshot)
          ? { active:false, schema:1 }
          : snapshot;
      });
      if (JSON.stringify(runtimeNext) !== JSON.stringify(runtimeRoot)) localStorage.setItem(STORE.particleRuntime, JSON.stringify(runtimeNext));

      var shares = readRawJson(STORE.presetShares);
      var sharesNext = mapScopedValues(shares, function (value, scope) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
        value = customParticleClone(value);
        var map = value.byPreset && typeof value.byPreset === 'object' ? value.byPreset : value;
        Object.keys(map).forEach(function (id) {
          if (retiredParticlePresetId(id) || removedByScope[scope] && removedByScope[scope][id] || retiredParticleRecord(map[id])) delete map[id];
        });
        return value;
      });
      if (JSON.stringify(sharesNext) !== JSON.stringify(shares)) localStorage.setItem(STORE.presetShares, JSON.stringify(sharesNext));
      if (customParticleRuntime && retiredParticleRecord(captureCustomParticleRuntime())) leaveCustomParticleForBuiltIn();
      return { removedPresetIds:Object.keys(removedAll), scopes:Object.keys(removedByScope) };
    } catch (error) {
      restoreStorageSnapshot(before);
      throw error;
    }
  }
  function migrateCanonicalArchives() {
    if (!customParticleOwnerReady()) return;
    retireDeprecatedParticlePresets();
    if (!Array.isArray(window.userFxArchives)) return;
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
      if (!customParticleOwnerReady()) return;
      var currentId = readScopedCurrentPresetId();
      var currentSlot = Array.isArray(window.userFxArchives) && window.userFxArchives.filter(function (slot) { return slot && slot.id === currentId; })[0];
      var scopedStore = canonicalArchiveStore();
      var currentCanonical = currentSlot && storedArchiveCanonical(currentSlot) || currentId && scopedStore.presets[currentId];
      if (currentCanonical) {
        applyTransactionalPreset(normalizeTransactionalPayload(currentCanonical, (currentSlot && currentSlot.name || '当前视觉预设') + '.json'), {
          createArchive:false, presetId:currentId, importWallpaper:false, silent:true
        });
      } else {
        restoreScopedCustomParticleRuntime();
      }
      customParticleScopeReady = true;
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
    setInterval(enforcePlayerVisibility, 1200);
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
      switchCustomParticleUser(event && event.detail ? event.detail.userId : undefined);
      relocateTask15ConsoleBlocks();
      syncConsoleFoldState();
    });
    window.addEventListener('pagehide', function () {
      hideTranslationReadyToast();
      cancelTranslationRequest();
      syncNativeTranslation(false, '', -1);
      persistCustomParticleRuntime();
      if (task15ConsoleReconcileTimer) clearTimeout(task15ConsoleReconcileTimer);
      task15ConsoleReconcileTimer = 0;
      if (task15ConsoleObserver) task15ConsoleObserver.disconnect();
      task15ConsoleObserver = null;
    });
    window.addEventListener('beforeunload', persistCustomParticleRuntime);
    window.addEventListener('resize', resizeSpectrumCanvas);
    setTimeout(function () { suppressLegacyVisuals(); injectConsoleControls(); relocateTask15ConsoleBlocks(); bindEchoImport(); bindBackgroundOpacity(); bindLiquidFab(); }, 1100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
