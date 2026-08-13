(function (global) {
  'use strict';

  var tools = global.LFAudioTools;
  if (!tools) return;

  var SPEEDS = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 2]);
  var SPEED_MIN = 0.5;
  var SPEED_MAX = 2;
  var PITCH_MIN = -12;
  var PITCH_MAX = 12;
  var LINK_SPEED_STEP = 0.001;
  var LINK_STORAGE_KEY = 'lf-audio-speed-pitch-link';
  var LINK_STORAGE_SCHEMA_KEY = 'lf-audio-speed-pitch-link-schema';
  var LINK_STORAGE_SCHEMA_VERSION = '2';
  var storedLinkEnabled = localStorage.getItem(LINK_STORAGE_KEY) === '1';
  var storedLinkSchema = localStorage.getItem(LINK_STORAGE_SCHEMA_KEY) || '';
  var migrateBrokenLinkedState = storedLinkEnabled && storedLinkSchema !== LINK_STORAGE_SCHEMA_VERSION;
  var UNSUPPORTED_TEXT = '当前歌曲暂不支持伴唱';
  var state = {
    speed: migrateBrokenLinkedState ? 1 : storedLinkEnabled
      ? clamp(Number(localStorage.getItem('lf-audio-speed') || 1), SPEED_MIN, SPEED_MAX, 1)
      : nearestSpeed(Number(localStorage.getItem('lf-audio-speed') || 1)),
    pitch: migrateBrokenLinkedState ? 0 : clamp(Number(localStorage.getItem('lf-audio-pitch') || 0), -12, 12, 0),
    linkEnabled: storedLinkEnabled,
    linkGuard: false,
    linkUpdateSerial: 0,
    linkLastSource: '',
    controlPromise: Promise.resolve({ ok: true }),
    balance: clamp(Number(localStorage.getItem('lf-karaoke-balance') || 0), -1, 1, 0),
    engine: null,
    engineSource: null,
    pitchRouting: false,
    pitchRoutingPromise: null,
    pitchRoutingSerial: 0,
    pitchPreloadPromise: null,
    pitchApplySerial: 0,
    pitchSetQueue: Promise.resolve(),
    appliedPitch: 0,
    stemMixer: null,
    stemLayout: '',
    stemSourceKind: '',
    stemPitchEngine: null,
    stemPitchSetupPromise: null,
    stemPitchRouting: false,
    stemPitchRoutingSerial: 0,
    stemListeners: [],
    pendingStemDecode: null,
    requestedEnabled: false,
    phase: 'off',
    progress: 0,
    backendProgressBase: 0,
    backendProgressSpan: 1,
    unsupportedReason: '',
    taskId: '',
    trackKey: '',
    activeTrackKey: '',
    trackRevision: 0,
    operationToken: 0,
    boundAudio: null,
    boundHandlers: null,
    progressApi: null,
    progressUnsubscribe: null,
    routingPromise: null,
    transientSourceDepth: 0,
    transientRestoreKey: '',
  };

  function $(id) { return document.getElementById(id); }
  function clamp(value, min, max, fallback) {
    value = Number(value);
    if (!Number.isFinite(value)) value = fallback == null ? min : fallback;
    return Math.max(min, Math.min(max, value));
  }
  function nearestSpeed(value) {
    value = Number.isFinite(Number(value)) ? Number(value) : 1;
    return SPEEDS.reduce(function (best, candidate) {
      return Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best;
    }, SPEEDS[0]);
  }
  function roundControl(value) { return Math.round(Number(value) * 1000000) / 1000000; }
  function classifyAuxiliaryPlaybackFailure(details) {
    var coordinator = global.LumiFieldPlaybackFailureCoordinator;
    if (!coordinator || typeof coordinator.classifyFailure !== 'function') return null;
    return coordinator.classifyFailure(details || {});
  }
  function linkPair(source, value) {
    var speed;
    var pitch;
    if (source === 'pitch') {
      pitch = clamp(value, PITCH_MIN, PITCH_MAX, 0);
      speed = clamp(Math.pow(2, pitch / 12), SPEED_MIN, SPEED_MAX, 1);
    } else {
      speed = clamp(value, SPEED_MIN, SPEED_MAX, 1);
      pitch = clamp(12 * Math.log2(speed), PITCH_MIN, PITCH_MAX, 0);
    }
    return {
      normalized: roundControl((pitch - PITCH_MIN) / (PITCH_MAX - PITCH_MIN)),
      speed: roundControl(speed),
      pitch: roundControl(pitch),
    };
  }
  if (state.linkEnabled) {
    var restoredLinkPair = linkPair('speed', state.speed);
    state.speed = restoredLinkPair.speed;
    state.pitch = restoredLinkPair.pitch;
  }
  if (migrateBrokenLinkedState) save();
  function speedText(value) { return Number(value).toFixed(4).replace(/0+$/, '').replace(/\.$/, '') + 'x'; }
  function pitchText(value) {
    var number = roundControl(value);
    var text = Number(number).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    return (number > 0 ? '+' : '') + text + ' 半音';
  }
  function currentAudio() { return global.audio || null; }
  function currentApi() { return global.LFAudioKaraokeApi || global.desktopWindow || null; }
  function sourceKey(element) {
    if (!element) return '';
    return String(element.src || element.currentSrc || '').trim();
  }
  function currentTrack() {
    try {
      if (typeof global.currentCoverSong === 'function') return global.currentCoverSong() || null;
    } catch (_) {}
    var queue = Array.isArray(global.playQueue) ? global.playQueue : [];
    var index = Number(global.currentIdx);
    return Number.isInteger(index) && index >= 0 && index < queue.length ? queue[index] : (global.currentLocalSong || null);
  }
  function firstUrl(objects, names) {
    for (var index = 0; index < objects.length; index += 1) {
      var object = objects[index];
      if (!object || typeof object !== 'object') continue;
      for (var keyIndex = 0; keyIndex < names.length; keyIndex += 1) {
        var value = object[names[keyIndex]];
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
    }
    return '';
  }
  function platformStemOptions(track, currentAudioUrl) {
    track = track && typeof track === 'object' ? track : {};
    var nested = [track.platformStem, track.stems, track.stem, track.karaoke, track.accompaniment, track];
    var provider = String(track.provider || track.source || track.platform || '').trim().toLowerCase();
    var vocalUrl = firstUrl(nested, ['vocalUrl', 'vocalsUrl', 'voiceUrl', 'humanVoiceUrl']);
    var accompanimentUrl = firstUrl(nested, [
      'noVocalsUrl', 'no_vocals_url', 'accompanimentUrl', 'instrumentalUrl',
      'accompanyUrl', 'karaokeUrl', 'backingTrackUrl', 'bgmUrl',
    ]);
    var identity = String(track.id || track.songId || track.mid || track.hash || track.audioId || '').trim();
    var key = provider && identity ? provider + ':' + identity : sourceKey(state.boundAudio || currentAudio());
    return {
      currentAudioUrl: currentAudioUrl,
      sourceKey: key,
      provider: provider,
      platformVocalUrl: vocalUrl,
      platformAccompanimentUrl: accompanimentUrl,
      platformStem: {
        vocalUrl: vocalUrl,
        accompanimentUrl: accompanimentUrl,
        originalUrl: currentAudioUrl,
        provider: provider,
        sourceKey: key,
      },
      quality: 'fast',
    };
  }
  function save() {
    try {
      localStorage.setItem('lf-audio-speed', String(state.speed));
      localStorage.setItem('lf-audio-pitch', String(state.pitch));
      localStorage.setItem(LINK_STORAGE_KEY, state.linkEnabled ? '1' : '0');
      localStorage.setItem(LINK_STORAGE_SCHEMA_KEY, LINK_STORAGE_SCHEMA_VERSION);
      localStorage.setItem('lf-karaoke-balance', String(state.balance));
    } catch (_) {}
  }
  function setPitchPreservation(element, enabled) {
    if (!element) return;
    try { element.preservesPitch = !!enabled; } catch (_) {}
    try { element.mozPreservesPitch = !!enabled; } catch (_) {}
    try { element.webkitPreservesPitch = !!enabled; } catch (_) {}
  }
  function toolStatus(message, ok) {
    var node = $('lf-audio-tool-status');
    if (!node) return;
    node.textContent = String(message || '');
    node.classList.toggle('ok', !!ok);
  }
  function updateSpeedUi() {
    var slider = $('lf-audio-speed');
    var value = $('lf-audio-speed-value');
    var button = $('lf-audio-tool-btn');
    if (slider) slider.value = String(state.speed);
    if (value) value.textContent = speedText(state.speed);
    if (button) {
      button.textContent = speedText(state.speed);
      button.setAttribute('aria-label', '倍速 ' + speedText(state.speed) + '，打开伴唱控制');
    }
    document.querySelectorAll('#lf-audio-tool-panel [data-speed]').forEach(function (node) {
      var active = Math.abs(Number(node.dataset.speed) - state.speed) < 0.001;
      node.classList.toggle('active', active);
      node.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }
  function updatePitchUi() {
    var slider = $('lf-audio-pitch');
    var output = $('lf-audio-pitch-value');
    if (slider) slider.value = String(state.pitch);
    if (output) output.textContent = pitchText(state.pitch);
  }
  function updateLinkUi() {
    var toggle = $('lf-audio-speed-pitch-link');
    var label = $('lf-audio-speed-pitch-link-state');
    var pitchTitle = $('lf-audio-pitch-title');
    var speedSlider = $('lf-audio-speed');
    var pitchSlider = $('lf-audio-pitch');
    if (toggle) toggle.checked = state.linkEnabled;
    if (label) label.textContent = state.linkEnabled ? '开启' : '关闭';
    if (pitchTitle) pitchTitle.textContent = state.linkEnabled ? '升降调（联动）' : '独立升降调';
    if (speedSlider) speedSlider.step = state.linkEnabled ? String(LINK_SPEED_STEP) : '0.25';
    if (pitchSlider) pitchSlider.step = state.linkEnabled ? '0.01' : '1';
    if (pitchSlider) pitchSlider.setAttribute('aria-label', state.linkEnabled ? '升降调，与倍速联动' : '独立升降调');
  }
  function renderKaraoke() {
    var toggle = $('lf-karaoke-enabled');
    var slider = $('lf-karaoke-balance');
    var statusNode = $('lf-karaoke-status');
    var section = $('lf-karaoke-section');
    if (toggle) toggle.checked = state.requestedEnabled;
    if (slider) {
      slider.value = String(state.balance);
      slider.disabled = state.phase !== 'active';
    }
    if (section) {
      section.dataset.phase = state.phase;
      section.classList.toggle('active', state.phase === 'active');
      section.classList.toggle('preparing', state.phase === 'preparing');
      section.classList.toggle('unsupported', state.phase === 'unsupported');
    }
    if (statusNode) {
      if (state.phase === 'preparing') statusNode.textContent = '';
      else if (state.phase === 'unsupported') statusNode.textContent = state.unsupportedReason || UNSUPPORTED_TEXT;
      else if (state.phase === 'active') statusNode.textContent = '伴唱已开启';
      else statusNode.textContent = '';
    }
  }
  function setPhase(phase, progress, reason) {
    state.phase = phase;
    state.unsupportedReason = phase === 'unsupported' ? String(reason || '') : '';
    if (progress != null) state.progress = clamp(progress, 0, 1, 0);
    renderKaraoke();
  }

  function applySpeedCore(value, linkedExact, deferStemPitch, deferCommit) {
    var previousSpeed = state.speed;
    state.speed = linkedExact ? clamp(value, SPEED_MIN, SPEED_MAX, 1) : nearestSpeed(value);
    var shouldPreservePitch = !state.linkEnabled;
    var media = currentAudio();
    if (media) {
      setPitchPreservation(media, shouldPreservePitch);
      if (Math.abs(Number(media.playbackRate || 1) - state.speed) > 0.0001) media.playbackRate = state.speed;
    }
    if (state.stemMixer) {
      state.stemMixer.setPlaybackRate(state.speed);
      if (!deferStemPitch && Math.abs(previousSpeed - state.speed) > 0.0001) {
        state.controlPromise = Promise.resolve(applyPitchCore(state.pitch));
      }
    }
    if (!deferCommit) {
      updateSpeedUi();
      save();
    }
    return { ok: true, speed: state.speed, preservesPitch: shouldPreservePitch };
  }

  function supersedePendingLinkToggle(source) {
    if (!state.linkGuard) return false;
    state.linkUpdateSerial += 1;
    state.linkGuard = false;
    state.linkLastSource = source || 'control';
    updateLinkUi();
    return true;
  }

  function applySpeed(value) {
    supersedePendingLinkToggle('speed');
    if (!state.linkEnabled) return applySpeedCore(value, false);
    var pair = linkPair('speed', value);
    var previousSpeed = state.speed;
    var previousPitch = state.appliedPitch;
    state.linkGuard = true;
    var linkSerial = ++state.linkUpdateSerial;
    state.linkLastSource = 'speed';
    var result = applySpeedCore(pair.speed, true, true);
    state.controlPromise = Promise.resolve(applyPitchCore(pair.pitch)).then(function (pitchResult) {
      if (!pitchResult.ok && linkSerial === state.linkUpdateSerial) {
        state.linkGuard = true;
        applySpeedCore(previousSpeed, true, true);
        state.pitch = previousPitch;
        updatePitchUi();
        save();
        state.linkGuard = false;
      }
      return pitchResult;
    }).catch(function (error) {
      return { ok: false, error: error && (error.code || error.message) || 'AUDIO_PITCH_FAILED' };
    });
    state.linkGuard = false;
    return {
      ok: result.ok,
      speed: pair.speed,
      pitch: pair.pitch,
      normalized: pair.normalized,
      linked: true,
      preservesPitch: false,
    };
  }

  function ensureCoreAudio() {
    if (!global.audio && typeof global.initAudio === 'function') {
      global.audio = new Audio();
      global.audio.crossOrigin = 'anonymous';
    }
    if (!global.audioReady && global.audio && typeof global.initAudio === 'function') global.initAudio();
    return !!(global.audioCtx && global.source && global.analyser && global.beatAnalyser && global.audio);
  }
  function preloadPitchProcessor() {
    if (!global.audioCtx || state.pitchPreloadPromise) return state.pitchPreloadPromise;
    state.pitchPreloadPromise = Promise.resolve(tools.installPitchWorklet(global.audioCtx)).catch(function (error) {
      state.pitchPreloadPromise = null;
      return { ok: false, error: error && (error.code || error.message) || 'AUDIO_WORKLET_PRELOAD_FAILED' };
    });
    return state.pitchPreloadPromise;
  }
  function createOriginalEngine() {
    if (!ensureCoreAudio()) return null;
    if (!state.engine || state.engineSource !== global.source) {
      state.engine = tools.createEngine({
        audioContext: global.audioCtx,
        mediaElement: global.audio,
        sourceNode: global.source,
        destination: global.analyser,
      });
      state.engineSource = global.source;
      state.pitchRouting = false;
    } else state.engine.setMediaElement(global.audio);
    return state.engine;
  }
  function routeOriginalDirect() {
    if (!global.source || !global.analyser || !global.beatAnalyser) return { ok: true, direct: true, pendingAudioGraph: true };
    if (!state.pitchRouting && !state.engine && !state.pitchRoutingPromise) return { ok: true, direct: true, unchanged: true };
    state.pitchRoutingSerial += 1;
    var engine = state.engine;
    state.engine = null;
    state.engineSource = null;
    state.pitchRouting = false;
    state.pitchRoutingPromise = null;
    try { if (engine) engine.disconnect(); } catch (_) {}
    try { global.source.disconnect(); } catch (_) {}
    try {
      global.source.connect(global.analyser);
      global.source.connect(global.beatAnalyser);
      return { ok: true, direct: true };
    } catch (_) {
      return { ok: false, error: 'AUDIO_DIRECT_ROUTING_FAILED' };
    }
  }
  function routeStemDirect() {
    var mixer = state.stemMixer;
    if (!mixer || !mixer.mixBus || !global.analyser || !global.beatAnalyser) return { ok: false, error: 'STEM_MIXER_REQUIRED' };
    if (!state.stemPitchRouting && !state.stemPitchEngine && !state.stemPitchSetupPromise) return { ok: true, direct: true, unchanged: true };
    state.stemPitchRoutingSerial += 1;
    var engine = state.stemPitchEngine;
    state.stemPitchEngine = null;
    state.stemPitchSetupPromise = null;
    state.stemPitchRouting = false;
    try { if (engine) engine.disconnect(); } catch (_) {}
    try { mixer.mixBus.disconnect(); } catch (_) {}
    try {
      mixer.mixBus.connect(global.analyser);
      mixer.mixBus.connect(global.beatAnalyser);
      return { ok: true, direct: true };
    } catch (_) {
      return { ok: false, error: 'STEM_DIRECT_ROUTING_FAILED' };
    }
  }
  async function ensurePitchRouting() {
    var engine = createOriginalEngine();
    if (!engine) throw new Error('AUDIO_CONTEXT_REQUIRED');
    if (state.pitchRouting) return engine;
    if (state.pitchRoutingPromise) return state.pitchRoutingPromise;
    var routingSerial = state.pitchRoutingSerial;
    var sourceNode = global.source;
    var routing = (async function () {
      try { global.source.disconnect(); } catch (_) {}
      try {
        await engine.initializePitch(global.source, global.analyser);
        if (routingSerial !== state.pitchRoutingSerial || sourceNode !== global.source || state.engine !== engine) {
          try { engine.disconnect(); } catch (_) {}
          throw codedControlError('STALE_PITCH_ROUTING');
        }
        engine.pitchNode.connect(global.beatAnalyser);
        state.pitchRouting = true;
        return engine;
      } catch (error) {
        if (routingSerial === state.pitchRoutingSerial && sourceNode === global.source) {
          try { global.source.connect(global.analyser); global.source.connect(global.beatAnalyser); } catch (_) {}
          state.engine = null;
          state.engineSource = null;
          state.pitchRouting = false;
        }
        throw error;
      }
    })();
    state.pitchRoutingPromise = routing;
    try {
      return await routing;
    } finally {
      if (state.pitchRoutingPromise === routing) state.pitchRoutingPromise = null;
    }
  }
  async function ensureStemPitchRouting() {
    if (state.stemPitchEngine && state.stemPitchEngine.pitchNode) return state.stemPitchEngine;
    if (state.stemPitchSetupPromise) return state.stemPitchSetupPromise;
    var mixer = state.stemMixer;
    if (!mixer) throw codedControlError('STEM_MIXER_REQUIRED');
    if (!state.stemPitchEngine) {
      state.stemPitchEngine = tools.createEngine({
        audioContext: global.audioCtx,
        sourceNode: mixer.mixBus,
        destination: global.analyser,
      });
      try { mixer.mixBus.disconnect(); } catch (_) {}
    }
    var engine = state.stemPitchEngine;
    var routingSerial = state.stemPitchRoutingSerial;
    var setup = Promise.resolve(engine.initializePitch(mixer.mixBus, global.analyser)).then(function () {
      if (state.stemMixer !== mixer || state.stemPitchEngine !== engine || state.stemPitchRoutingSerial !== routingSerial) {
        try { engine.disconnect(); } catch (_) {}
        throw codedControlError('STALE_STEM_PITCH_ROUTING');
      }
      engine.pitchNode.connect(global.beatAnalyser);
      state.stemPitchRouting = true;
      return engine;
    });
    state.stemPitchSetupPromise = setup;
    try {
      return await setup;
    } finally {
      if (state.stemPitchSetupPromise === setup) state.stemPitchSetupPromise = null;
    }
  }
  async function applyPitchCore(value, options) {
    options = options || {};
    var targetPitch = clamp(value, -12, 12, 0);
    var targetSpeed = state.speed;
    state.pitch = targetPitch;
    var requestSerial = ++state.pitchApplySerial;
    if (!options.deferCommit) {
      updatePitchUi();
      save();
    }
    try {
      var operation = state.pitchSetQueue.then(async function () {
        if (requestSerial !== state.pitchApplySerial) return { ok: true, stale: true, semitones: state.pitch };
        if (state.stemMixer) {
          var effectiveStemPitch = state.linkEnabled
            ? 0
            : clamp(targetPitch - 12 * Math.log2(targetSpeed), -12, 12, 0);
          if (Math.abs(effectiveStemPitch) < 0.0001) {
            var directStem = routeStemDirect();
            if (!directStem.ok) throw codedControlError(directStem.error || 'STEM_DIRECT_ROUTING_FAILED');
          } else {
            var stemEngine = await ensureStemPitchRouting();
            if (requestSerial !== state.pitchApplySerial) return { ok: true, stale: true, semitones: state.pitch };
            await stemEngine.setPitch(targetPitch, targetSpeed);
            if (requestSerial !== state.pitchApplySerial) return { ok: true, stale: true, semitones: state.pitch };
          }
        } else {
          setPitchPreservation(currentAudio(), !state.linkEnabled);
          if (state.linkEnabled || Math.abs(targetPitch) < 0.0001) {
            var directOriginal = routeOriginalDirect();
            if (!directOriginal.ok) throw codedControlError(directOriginal.error || 'AUDIO_DIRECT_ROUTING_FAILED');
          } else {
            var engine = await ensurePitchRouting();
            if (requestSerial !== state.pitchApplySerial) return { ok: true, stale: true, semitones: state.pitch };
            await engine.setPitch(targetPitch);
            if (requestSerial !== state.pitchApplySerial) return { ok: true, stale: true, semitones: state.pitch };
          }
        }
        if (requestSerial === state.pitchApplySerial) state.appliedPitch = targetPitch;
        return { ok: true, semitones: targetPitch, linked: state.linkEnabled };
      });
      state.pitchSetQueue = operation.catch(function () {});
      var outcome = await operation;
      if (outcome.stale) return outcome;
      if (!options.deferCommit) toolStatus(state.linkEnabled ? '倍速与音调联动已应用' : '升降调已应用', true);
      return outcome;
    } catch (error) {
      if (requestSerial === state.pitchApplySerial) {
        state.pitch = state.appliedPitch;
        if (!options.deferCommit) {
          updatePitchUi();
          save();
        }
      }
      if (!options.deferCommit) toolStatus('当前环境暂不支持独立升降调', false);
      return { ok: false, error: error && error.code || 'AUDIO_PITCH_FAILED', semitones: state.pitch };
    }
  }

  async function applyPitch(value) {
    supersedePendingLinkToggle('pitch');
    if (!state.linkEnabled) {
      state.controlPromise = Promise.resolve(applyPitchCore(value));
      return state.controlPromise;
    }
    var pair = linkPair('pitch', value);
    var previousSpeed = state.speed;
    var previousPitch = state.appliedPitch;
    state.linkGuard = true;
    var linkSerial = ++state.linkUpdateSerial;
    state.linkLastSource = 'pitch';
    var speedResult = applySpeedCore(pair.speed, true, true);
    state.linkGuard = false;
    state.controlPromise = Promise.resolve(applyPitchCore(pair.pitch));
    var pitchResult = await state.controlPromise;
    if (!pitchResult.ok && linkSerial === state.linkUpdateSerial) {
      state.linkGuard = true;
      applySpeedCore(previousSpeed, true, true);
      state.pitch = previousPitch;
      updatePitchUi();
      save();
      state.linkGuard = false;
    }
    return {
      ok: !!pitchResult.ok,
      error: pitchResult.error,
      speed: speedResult.speed,
      semitones: pair.pitch,
      pitch: pair.pitch,
      normalized: pair.normalized,
      linked: true,
    };
  }

  function setLinkEnabled(enabled) {
    var nextEnabled = !!enabled;
    var linkSerial = ++state.linkUpdateSerial;
    state.linkGuard = true;
    state.linkEnabled = nextEnabled;
    state.linkLastSource = 'toggle';
    state.speed = 1;
    state.pitch = 0;
    state.pitchApplySerial += 1;
    var speedResult = applySpeedCore(1, true, true, true);
    var directResult = state.stemMixer ? routeStemDirect() : routeOriginalDirect();
    state.appliedPitch = 0;
    updateSpeedUi();
    updatePitchUi();
    updateLinkUi();
    save();
    var pendingPitchQueue = state.pitchSetQueue;
    var transaction = (async function () {
      try {
        await pendingPitchQueue;
        if (linkSerial !== state.linkUpdateSerial) return { ok: true, stale: true, enabled: state.linkEnabled };
        if (!directResult.ok) {
          toolStatus('音频图恢复失败', false);
          return { ok: false, enabled: state.linkEnabled, error: directResult.error || 'AUDIO_DIRECT_ROUTING_FAILED', speed: state.speed, pitch: state.pitch };
        }
        toolStatus(nextEnabled ? '联动已开启：1x / 0 半音' : '已恢复正常：1x / 0 半音', true);
        return {
          ok: true,
          enabled: nextEnabled,
          speed: speedResult.speed,
          pitch: 0,
          normalized: linkPair('speed', 1).normalized,
          appliedPitch: state.appliedPitch,
        };
      } finally {
        if (linkSerial === state.linkUpdateSerial) state.linkGuard = false;
      }
    })();
    state.controlPromise = transaction;
    return transaction;
  }

  function listen(element, name, handler) {
    element.addEventListener(name, handler);
    state.stemListeners.push([element, name, handler]);
  }
  function removeStemListeners() {
    state.stemListeners.forEach(function (entry) {
      try { entry[0].removeEventListener(entry[1], entry[2]); } catch (_) {}
    });
    state.stemListeners = [];
  }
  function clearPendingStemDecode() {
    var pending = state.pendingStemDecode;
    state.pendingStemDecode = null;
    if (pending && pending.controller) {
      try { pending.controller.abort(); } catch (_) {}
    }
  }
  function codedControlError(code, details) {
    var error = new Error(code);
    error.code = code;
    error.playbackFailureClassification = classifyAuxiliaryPlaybackFailure(Object.assign({ error:error }, details || {}));
    return error;
  }
  function decodeStemAudio(arrayBuffer) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      function complete(value) {
        if (settled) return;
        settled = true;
        if (!value || !Number(value.duration)) reject(codedControlError('AUDIO_DECODE_EMPTY'));
        else resolve(value);
      }
      function failed() {
        if (settled) return;
        settled = true;
        reject(codedControlError('AUDIO_DECODE_FAILED'));
      }
      try {
        var decoding = global.audioCtx.decodeAudioData(arrayBuffer, complete, failed);
        if (decoding && typeof decoding.then === 'function') decoding.then(complete, failed);
      } catch (_) { failed(); }
    });
  }
  async function fetchStemBuffer(url, guard, controller) {
    if (!guardIsCurrent(guard)) throw codedControlError('STALE_PREPARATION');
    var response;
    try {
      response = await fetch(String(url || ''), { signal: controller.signal, credentials: 'same-origin', cache: 'default' });
    } catch (error) {
      if (controller.signal.aborted || !guardIsCurrent(guard)) throw codedControlError('STALE_PREPARATION');
      throw codedControlError('AUDIO_FETCH_FAILED');
    }
    if (!response.ok) throw codedControlError('AUDIO_FETCH_FAILED', {
      status:response.status,
      mime:response.headers && response.headers.get('content-type')
    });
    var bytes = await response.arrayBuffer();
    if (!guardIsCurrent(guard)) throw codedControlError('STALE_PREPARATION');
    if (!bytes || !bytes.byteLength) throw codedControlError('AUDIO_FETCH_EMPTY', { emptyResponse:true });
    var decoded = await decodeStemAudio(bytes);
    if (!guardIsCurrent(guard)) throw codedControlError('STALE_PREPARATION');
    return decoded;
  }
  async function restoreOriginalRouting() {
    if (!global.source || !global.analyser || !global.beatAnalyser) return;
    state.pitchRoutingSerial += 1;
    try { global.source.disconnect(); } catch (_) {}
    try { global.source.connect(global.analyser); global.source.connect(global.beatAnalyser); } catch (_) {}
    state.engine = null;
    state.engineSource = null;
    state.pitchRouting = false;
    state.pitchRoutingPromise = null;
    if (state.pitch !== 0) await applyPitchCore(state.pitch);
  }
  async function releaseActiveStems() {
    var hadActive = !!(state.stemMixer || state.stemPitchEngine);
    if (!hadActive) return state.routingPromise || { ok: true, active: false };
    removeStemListeners();
    var mixer = state.stemMixer;
    var pitchEngine = state.stemPitchEngine;
    var pitchSetup = state.stemPitchSetupPromise;
    state.pitchApplySerial += 1;
    state.stemMixer = null;
    state.stemLayout = '';
    state.stemSourceKind = '';
    state.stemPitchEngine = null;
    state.stemPitchSetupPromise = null;
    state.stemPitchRouting = false;
    state.stemPitchRoutingSerial += 1;
    state.activeTrackKey = '';
    try { if (mixer) mixer.pause(); } catch (_) {}
    try { if (pitchEngine) pitchEngine.disconnect(); } catch (_) {}
    if (pitchSetup) Promise.resolve(pitchSetup).then(function (engine) {
      try { if (engine) engine.disconnect(); } catch (_) {}
    }).catch(function () {});
    try { if (mixer) mixer.destroy(); } catch (_) {}
    var routing = Promise.resolve(restoreOriginalRouting()).then(function () {
      applySpeedCore(state.speed, state.linkEnabled);
      return { ok: true, active: false };
    });
    state.routingPromise = routing;
    try { return await routing; }
    finally { if (state.routingPromise === routing) state.routingPromise = null; }
  }
  function cancelTask() {
    var taskId = state.taskId;
    state.taskId = '';
    if (!taskId) return;
    var api = currentApi();
    if (api && typeof api.lfStemCancel === 'function') {
      Promise.resolve(api.lfStemCancel(taskId)).catch(function () {});
    }
  }
  function invalidateOperation() {
    state.operationToken += 1;
    cancelTask();
    clearPendingStemDecode();
    return state.operationToken;
  }
  function makeGuard(revision, token, key) { return { revision: revision, token: token, key: key }; }
  function guardIsCurrent(guard) {
    return !!guard && state.requestedEnabled && guard.revision === state.trackRevision &&
      guard.token === state.operationToken && guard.key === state.trackKey &&
      guard.key === sourceKey(state.boundAudio || currentAudio());
  }
  function setBalance(value) {
    state.balance = clamp(value, -1, 1, 0);
    var slider = $('lf-karaoke-balance');
    if (slider) slider.value = String(state.balance);
    var originalPlusAccompaniment = state.stemMixer && state.stemLayout === 'original-plus-accompaniment';
    var result = state.stemMixer
      ? originalPlusAccompaniment
        ? (function () {
            var mix = clamp(state.balance, 0, 1, 0);
            var levels = state.stemMixer.setLevels(1 - mix, mix);
            return {
              ok: !!levels.ok,
              balance: state.balance,
              originalGain: levels.vocalGain,
              accompanimentGain: levels.noVocalsGain,
              originalAtCenter: state.balance <= 0,
              stemLayout: state.stemLayout,
            };
          })()
        : state.stemMixer.setBalance(state.balance)
      : {
          ok: true,
          balance: state.balance,
          vocalGain: state.balance <= 0 ? 1 : 1 - state.balance,
          noVocalsGain: state.balance >= 0 ? 1 : 1 + state.balance,
          originalAtCenter: true,
        };
    save();
    return result;
  }

  async function activatePrepared(result, guard) {
    if (!result || !result.vocalUrl || !result.noVocalsUrl) throw new Error('INVALID_PREPARED_AUDIO');
    if (!guardIsCurrent(guard)) return { ok: false, stale: true };
    if (!ensureCoreAudio()) throw new Error('AUDIO_CONTEXT_REQUIRED');

    var controller = new AbortController();
    var pendingDecode = { controller: controller, guard: guard };
    var stagedMixer = null;
    state.pendingStemDecode = pendingDecode;
    try {
      state.progress = Math.max(state.progress, 0.92);
      renderKaraoke();
      var buffers = await Promise.all([
        fetchStemBuffer(result.vocalUrl, guard, controller),
        fetchStemBuffer(result.noVocalsUrl, guard, controller),
      ]);
      if (!guardIsCurrent(guard)) return { ok: false, stale: true };
      state.progress = Math.max(state.progress, 0.98);
      renderKaraoke();
      await releaseActiveStems();
      if (!guardIsCurrent(guard)) return { ok: false, stale: true };

      var mixer = tools.createStemMixer({
        audioContext: global.audioCtx,
        vocalBuffer: buffers[0],
        noVocalsBuffer: buffers[1],
        autoConnect: false,
        balance: state.balance,
      });
      stagedMixer = mixer;
      mixer.setLevels(0, 0);
      mixer.mixBus.connect(global.analyser);
      mixer.mixBus.connect(global.beatAnalyser);
      mixer.setPlaybackRate(state.speed);
      var master = state.boundAudio || currentAudio();
      var at = master && Number.isFinite(master.currentTime) ? master.currentTime : 0;
      mixer.seek(at);

      var masterReady = master && (!Number.isFinite(Number(master.readyState)) || Number(master.readyState) >= 3);
      if (master && !master.paused && !master.seeking && masterReady) {
        var started = await mixer.play(at);
        if (!started.ok) throw new Error('PREPARED_AUDIO_PLAY_FAILED');
      }
      if (!guardIsCurrent(guard)) {
        mixer.destroy();
        return { ok: false, stale: true };
      }

      try { global.source.disconnect(); } catch (_) {}
      if (state.engine) { try { state.engine.disconnect(); } catch (_) {} }
      state.engine = null;
      state.engineSource = null;
      state.pitchRouting = false;
      state.stemMixer = mixer;
      state.stemLayout = result.stemLayout === 'original-plus-accompaniment' ? 'original-plus-accompaniment' : 'separated-pair';
      state.stemSourceKind = String(result.sourceKind || '');
      state.activeTrackKey = guard.key;
      state.pendingStemDecode = null;
      setBalance(state.balance);

      if (master) {
        function pauseStemTransport(event) {
          if (event && (event.type === 'error' || event.type === 'stalled')) {
            classifyAuxiliaryPlaybackFailure({
              eventType:event.type,
              media:master,
              mediaError:master.error,
              sourceUrl:master.currentSrc || master.src
            });
          }
          if (state.stemMixer === mixer) mixer.pause();
        }
        function playStemTransport() {
          if (state.transientSourceDepth > 0) return;
          if (state.stemMixer !== mixer || master.paused || master.seeking) return;
          var target = Number(master.currentTime) || 0;
          var drift = mixer.currentTime - target;
          if (mixer.playing && Math.abs(drift) <= 0.12) return;
          Promise.resolve(mixer.play(target)).catch(function () {});
        }
        listen(master, 'playing', playStemTransport);
        listen(master, 'pause', pauseStemTransport);
        listen(master, 'waiting', pauseStemTransport);
        listen(master, 'stalled', pauseStemTransport);
        listen(master, 'emptied', pauseStemTransport);
        listen(master, 'error', pauseStemTransport);
        listen(master, 'seeking', function () {
          if (state.transientSourceDepth > 0) return;
          pauseStemTransport();
        });
        listen(master, 'seeked', function () {
          if (state.transientSourceDepth > 0 || state.stemMixer !== mixer) return;
          mixer.seek(Number(master.currentTime) || 0);
          if (!master.paused && (!Number.isFinite(Number(master.readyState)) || Number(master.readyState) >= 3)) playStemTransport();
        });
        listen(master, 'ratechange', function () {
          if (state.stemMixer === mixer && Math.abs(Number(mixer.baseRate) - state.speed) > 0.0001) mixer.setPlaybackRate(state.speed);
        });
        listen(master, 'ended', pauseStemTransport);
      }
      await applyPitchCore(state.pitch);
      if (!guardIsCurrent(guard)) {
        await releaseActiveStems();
        return { ok: false, stale: true };
      }
      setPhase('active', 1);
      return { ok: true, active: true, cached: !!result.cached };
    } finally {
      if (state.pendingStemDecode === pendingDecode) {
        state.pendingStemDecode = null;
        try { controller.abort(); } catch (_) {}
      }
      if (stagedMixer && state.stemMixer !== stagedMixer) {
        try { stagedMixer.destroy(); } catch (_) {}
      }
    }
  }

  function bindProgress(api) {
    if (state.progressApi === api) return;
    if (typeof state.progressUnsubscribe === 'function') {
      try { state.progressUnsubscribe(); } catch (_) {}
    }
    state.progressApi = api;
    state.progressUnsubscribe = null;
    if (!api || typeof api.onLFStemProgress !== 'function') return;
    state.progressUnsubscribe = api.onLFStemProgress(function (progress) {
      if (!progress || progress.taskId !== state.taskId || state.phase !== 'preparing') return;
      var mapped = state.backendProgressBase + state.backendProgressSpan * clamp(progress.progress, 0, 1, 0);
      state.progress = Math.max(state.progress, clamp(mapped, 0, 1, 0));
      renderKaraoke();
    });
  }
  function unsupportedReason(code) {
    code = String(code || '');
    if (/DRM|PROTECTED|ENCRYPTED|ACCESS_DENIED/.test(code)) return '当前歌曲受平台保护或没有解码权限，无法进行本地伴唱处理。';
    if (/SOURCE_URL_EXPIRED/.test(code)) return '当前歌曲播放地址已失效，请重新播放后再启用伴唱。';
    if (/AUDIO_CODEC_UNSUPPORTED|SOURCE_NOT_DECODABLE|AUDIO_DECODE/.test(code)) return '当前歌曲的音频格式无法由本机解码，无法生成伴唱。';
    var httpStatus = /SOURCE_HTTP_(\d{3})/.exec(code);
    if (httpStatus) return '读取当前歌曲失败（HTTP ' + httpStatus[1] + '），无法生成伴唱。';
    if (/EXTERNAL_CONFIG|BACKEND_NOT_FOUND/.test(code)) return '本地人声分离引擎未安装，且当前歌曲没有可用的平台伴奏或缓存。';
    if (/PLATFORM_STEM/.test(code)) return '平台伴奏当前不可读取，且未能切换到本地伴唱处理。';
    if (/SOURCE_|AUDIO_DOWNLOAD|AUDIO_DECODE|UNTRUSTED_AUDIO|INVALID_AUDIO_URL/.test(code)) return '当前播放源无法合法读取或解码，无法生成伴唱。';
    return '';
  }
  function markUnsupported(guard, code) {
    if (!guardIsCurrent(guard)) return;
    state.taskId = '';
    setPhase('unsupported', 0, unsupportedReason(code));
  }
  function platformStemAvailable(options) {
    return !!(options && (options.platformAccompanimentUrl ||
      options.platformStem && (options.platformStem.accompanimentUrl || options.platformStem.noVocalsUrl)));
  }
  async function runStemRequest(api, file, options, guard, progressBase, progressSpan) {
    state.backendProgressBase = progressBase;
    state.backendProgressSpan = progressSpan;
    var queued;
    try {
      queued = await api.lfStemStart(file || null, options);
    } finally {
      if (options && options.decodedWav) options.decodedWav = null;
    }
    if (!guardIsCurrent(guard)) {
      if (queued && queued.taskId && typeof api.lfStemCancel === 'function') api.lfStemCancel(queued.taskId).catch(function () {});
      return { ok: false, stale: true };
    }
    if (!queued || !queued.ok || !queued.taskId) return queued || { ok: false, error: 'STEM_START_FAILED' };
    state.taskId = queued.taskId;
    var result = await api.lfStemWait(queued.taskId);
    if (state.taskId === queued.taskId) state.taskId = '';
    if (!guardIsCurrent(guard)) return { ok: false, stale: true };
    return result || { ok: false, error: 'STEM_WAIT_FAILED' };
  }
  async function decodeCurrentTrackToWav(track, guard) {
    var decoder = global.LFAudioDecode;
    if (!decoder || typeof decoder.decodeToWav !== 'function') throw codedControlError('AUDIO_DECODE_UNAVAILABLE');
    if (!ensureCoreAudio()) throw codedControlError('AUDIO_CONTEXT_REQUIRED');
    var controller = new AbortController();
    var pending = { controller: controller, guard: guard, phase: 'source-decode' };
    state.pendingStemDecode = pending;
    try {
      return await decoder.decodeToWav({
        file: track && track.localFile || null,
        url: guard.key,
        audioContext: global.audioCtx,
        signal: controller.signal,
        onProgress: function (value) {
          if (!guardIsCurrent(guard) || state.pendingStemDecode !== pending) return;
          state.progress = Math.max(state.progress, 0.02 + 0.33 * clamp(value, 0, 1, 0));
          renderKaraoke();
        },
      });
    } finally {
      if (state.pendingStemDecode === pending) state.pendingStemDecode = null;
    }
  }
  async function prepareCurrentTrack(guard) {
    if (!guardIsCurrent(guard)) return { ok: false, stale: true };
    var api = currentApi();
    bindProgress(api);
    if (!api || typeof api.lfStemStart !== 'function' || typeof api.lfStemWait !== 'function') {
      markUnsupported(guard);
      return { ok: false, unsupported: true };
    }
    setPhase('preparing', 0);
    try {
      if (typeof api.lfStemStatus === 'function') {
        var capability = await api.lfStemStatus('');
        if (!guardIsCurrent(guard)) return { ok: false, stale: true };
        if (capability && capability.available === false && capability.canStart !== true) {
          markUnsupported(guard, capability && (capability.blockerCode || capability.error));
          return { ok: false, unsupported: true };
        }
      }
      var track = currentTrack();
      var platformOptions = platformStemOptions(track, guard.key);
      var result = null;
      if (platformStemAvailable(platformOptions)) {
        result = await runStemRequest(api, null, platformOptions, guard, 0.02, 0.88);
        if (result && result.stale) return result;
        if (result && result.ok && result.vocalUrl && result.noVocalsUrl) {
          try { return await activatePrepared(result, guard); }
          catch (_) {
            if (!guardIsCurrent(guard)) return { ok: false, stale: true };
          }
        }
        state.progress = Math.max(state.progress, 0.04);
      }
      var decodedWav = await decodeCurrentTrackToWav(track, guard);
      if (!guardIsCurrent(guard)) return { ok: false, stale: true };
      var localOptions = {
        currentAudioUrl: guard.key,
        sourceKey: platformOptions.sourceKey,
        provider: platformOptions.provider,
        quality: 'fast',
        decodedWav: decodedWav,
      };
      result = await runStemRequest(api, track && track.localFile || null, localOptions, guard, 0.35, 0.55);
      decodedWav = null;
      if (result && result.stale) return result;
      if (!result || !result.ok || !result.vocalUrl || !result.noVocalsUrl) {
        markUnsupported(guard, result && result.error);
        return { ok: false, unsupported: true, error: result && result.error };
      }
      return await activatePrepared(result, guard);
    } catch (error) {
      markUnsupported(guard, error && (error.code || error.message));
      return { ok: false, unsupported: true };
    }
  }

  function beginTrackTransition(force) {
    if (state.transientSourceDepth > 0) {
      applySpeedCore(state.speed, state.linkEnabled);
      return;
    }
    var media = state.boundAudio || currentAudio();
    var key = sourceKey(media);
    if (!force && key === state.trackKey) {
      applySpeedCore(state.speed, state.linkEnabled);
      return;
    }
    state.trackRevision += 1;
    state.trackKey = key;
    var token = invalidateOperation();
    var revision = state.trackRevision;
    var release = releaseActiveStems();
    applySpeedCore(state.speed, state.linkEnabled);
    if (!state.requestedEnabled) {
      setPhase('off', 0);
      return;
    }
    if (!key) {
      setPhase('unsupported', 0);
      return;
    }
    setPhase('preparing', 0);
    Promise.resolve(release).then(function () {
      var guard = makeGuard(revision, token, key);
      if (guardIsCurrent(guard)) prepareCurrentTrack(guard);
    }).catch(function () {
      markUnsupported(makeGuard(revision, token, key));
    });
  }
  function bindAudio(element) {
    if (!element) return { ok: false, error: 'AUDIO_REQUIRED' };
    if (state.boundAudio === element) {
      applySpeedCore(state.speed, state.linkEnabled);
      return { ok: true, rebound: false };
    }
    if (state.boundAudio && state.boundHandlers) {
      Object.keys(state.boundHandlers).forEach(function (name) {
        try { state.boundAudio.removeEventListener(name, state.boundHandlers[name]); } catch (_) {}
      });
    }
    state.boundAudio = element;
    preloadPitchProcessor();
    state.boundHandlers = {
      loadstart: function () {
        if (state.transientSourceDepth > 0) return;
        beginTrackTransition(true);
      },
      loadedmetadata: function () {
        applySpeedCore(state.speed, state.linkEnabled);
        if (state.transientSourceDepth > 0) return;
        if (sourceKey(element) !== state.trackKey) beginTrackTransition(false);
      },
      ratechange: function () {
        setPitchPreservation(element, !state.linkEnabled);
        if (Math.abs(Number(element.playbackRate || 1) - state.speed) > 0.0001) element.playbackRate = state.speed;
      },
    };
    Object.keys(state.boundHandlers).forEach(function (name) { element.addEventListener(name, state.boundHandlers[name]); });
    setPitchPreservation(element, !state.linkEnabled);
    applySpeedCore(state.speed, state.linkEnabled);
    if (state.pitch !== 0) state.controlPromise = Promise.resolve(applyPitchCore(state.pitch));
    if (sourceKey(element)) beginTrackTransition(false);
    return { ok: true, rebound: true };
  }

  async function setKaraokeEnabled(enabled) {
    enabled = !!enabled;
    if (!enabled) {
      state.requestedEnabled = false;
      invalidateOperation();
      setPhase('off', 0);
      await releaseActiveStems();
      renderKaraoke();
      return { ok: true, active: false, requested: false };
    }
    state.requestedEnabled = true;
    var media = state.boundAudio || currentAudio();
    if (media && state.boundAudio !== media) bindAudio(media);
    var key = sourceKey(media);
    if (!key) {
      state.trackKey = '';
      setPhase('unsupported', 0);
      return { ok: false, unsupported: true, requested: true };
    }
    if (state.phase === 'active' && state.stemMixer && key === state.trackKey) {
      renderKaraoke();
      return { ok: true, active: true, requested: true };
    }
    if (key !== state.trackKey) {
      beginTrackTransition(false);
      return { ok: true, preparing: true, requested: true };
    }
    var token = invalidateOperation();
    var guard = makeGuard(state.trackRevision, token, key);
    setPhase('preparing', 0);
    await releaseActiveStems();
    if (!guardIsCurrent(guard)) return { ok: false, stale: true };
    return prepareCurrentTrack(guard);
  }
  async function activateStems(result) {
    state.requestedEnabled = true;
    var media = state.boundAudio || currentAudio();
    if (media && state.boundAudio !== media) bindAudio(media);
    if (!state.trackKey) {
      state.trackKey = sourceKey(media);
      state.trackRevision += 1;
    }
    var token = invalidateOperation();
    var guard = makeGuard(state.trackRevision, token, state.trackKey);
    setPhase('preparing', 0);
    try { return await activatePrepared(result, guard); }
    catch (_) { markUnsupported(guard); return { ok: false, unsupported: true }; }
  }
  async function deactivateStems() { return setKaraokeEnabled(false); }

  function beginTransientSource(element) {
    if (element && state.boundAudio !== element) bindAudio(element);
    if (state.transientSourceDepth === 0) {
      state.transientRestoreKey = state.trackKey;
      try { if (state.stemMixer) state.stemMixer.pause(); } catch (_) {}
    }
    state.transientSourceDepth += 1;
    return {
      ok: true,
      depth: state.transientSourceDepth,
      trackKey: state.transientRestoreKey,
      stems: !!state.stemMixer,
    };
  }

  async function endTransientSource(element) {
    if (state.transientSourceDepth > 0) state.transientSourceDepth -= 1;
    if (state.transientSourceDepth > 0) return { ok: true, depth: state.transientSourceDepth };
    var media = element || state.boundAudio || currentAudio();
    var restoredKey = sourceKey(media);
    var expectedKey = state.transientRestoreKey || state.trackKey;
    state.transientRestoreKey = '';
    applySpeedCore(state.speed, state.linkEnabled);
    if (restoredKey && expectedKey && restoredKey === expectedKey && state.stemMixer) {
      var at = media && Number.isFinite(media.currentTime) ? media.currentTime : 0;
      try {
        state.stemMixer.seek(at);
        if (media && !media.paused) await state.stemMixer.play(at);
        else state.stemMixer.pause();
      } catch (_) {}
      return { ok: true, depth: 0, resumed: true, trackKey: restoredKey };
    }
    if (restoredKey && restoredKey !== state.trackKey) beginTrackTransition(false);
    return { ok: true, depth: 0, resumed: false, trackKey: restoredKey };
  }

  function inject() {
    if ($('lf-audio-tool-btn')) return;
    var cluster = document.querySelector('#controls .control-cluster.modes');
    if (!cluster) return;
    var button = document.createElement('button');
    button.id = 'lf-audio-tool-btn';
    button.className = 'ctrl-btn lf-audio-tool-btn';
    button.type = 'button';
    button.title = '倍速 / 伴唱 / 升降调';
    button.setAttribute('aria-label', '倍速 / 伴唱 / 升降调');
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', 'lf-audio-tool-panel');
    button.setAttribute('aria-expanded', 'false');
    button.textContent = '1x';
    cluster.insertBefore(button, cluster.lastElementChild);

    var panel = document.createElement('div');
    panel.id = 'lf-audio-tool-panel';
    panel.className = 'lf-audio-tool-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '倍速与伴唱');
    panel.innerHTML =
      '<div class="lf-audio-tool-head"><b>声音控制</b><button id="lf-audio-tool-close" type="button" aria-label="关闭">×</button></div>' +
      '<section class="lf-speed-section"><div class="lf-audio-section-title"><b>倍速</b><output id="lf-audio-speed-value">1x</output></div>' +
      '<input id="lf-audio-speed" type="range" min="0.5" max="2" step="0.25" aria-label="播放倍速">' +
      '<div class="lf-audio-presets">' + SPEEDS.map(function (value) {
        return '<button type="button" data-speed="' + value + '">' + speedText(value) + '</button>';
      }).join('') + '</div></section>' +
      '<section class="lf-audio-link-section"><div class="lf-audio-section-title"><b>倍速与升降调联动</b>' +
      '<label class="lf-karaoke-switch"><input id="lf-audio-speed-pitch-link" type="checkbox" aria-label="倍速与升降调联动"><span aria-hidden="true"></span><em id="lf-audio-speed-pitch-link-state">关闭</em></label></div></section>' +
      '<section><div class="lf-audio-section-title"><b id="lf-audio-pitch-title">独立升降调</b><output id="lf-audio-pitch-value">0 半音</output></div>' +
      '<input id="lf-audio-pitch" type="range" min="-12" max="12" step="1" aria-label="独立升降调"></section>' +
      '<section id="lf-karaoke-section" class="lf-karaoke-section" data-phase="off">' +
      '<div class="lf-audio-section-title"><b>伴唱</b><label class="lf-karaoke-switch"><input id="lf-karaoke-enabled" type="checkbox"><span aria-hidden="true"></span><em>启用</em></label></div>' +
      '<div class="lf-karaoke-scale"><span>人声</span><span>原曲</span><span>伴奏</span></div>' +
      '<input id="lf-karaoke-balance" type="range" min="-1" max="1" step="0.01" value="0" disabled aria-label="声伴比例">' +
      '<div id="lf-karaoke-status" class="lf-karaoke-status" role="status" aria-live="polite"></div></section>' +
      '<div id="lf-audio-tool-status" class="lf-audio-tool-status" role="status"></div>';
    document.body.appendChild(panel);

    function setPanelOpen(open) {
      panel.classList.toggle('show', !!open);
      button.classList.toggle('active', !!open);
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    button.onclick = function (event) { event.stopPropagation(); setPanelOpen(!panel.classList.contains('show')); };
    $('lf-audio-tool-close').onclick = function () { setPanelOpen(false); };
    panel.onclick = function (event) { event.stopPropagation(); };
    document.addEventListener('click', function (event) {
      if (panel.classList.contains('show') && !panel.contains(event.target) && event.target !== button) setPanelOpen(false);
    });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') setPanelOpen(false); });
    $('lf-audio-speed').oninput = function () { applySpeed(this.value); };
    panel.addEventListener('click', function (event) {
      var preset = event.target.closest('[data-speed]');
      if (preset) applySpeed(preset.dataset.speed);
    });
    $('lf-audio-pitch').oninput = function () { applyPitch(this.value); };
    $('lf-audio-speed-pitch-link').onchange = function () { setLinkEnabled(this.checked); };
    $('lf-karaoke-balance').oninput = function () { setBalance(this.value); };
    $('lf-karaoke-enabled').onchange = function () { setKaraokeEnabled(this.checked); };
    updateLinkUi();
    updateSpeedUi();
    updatePitchUi();
    $('lf-karaoke-balance').value = String(state.balance);
    renderKaraoke();
    if (currentAudio()) bindAudio(currentAudio());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject, { once: true });
  else inject();

  global.LFAudioControls = Object.freeze({
    speeds: SPEEDS,
    unsupportedText: UNSUPPORTED_TEXT,
    setSpeed: applySpeed,
    setPitch: applyPitch,
    setSpeedPitchLinkEnabled: setLinkEnabled,
    mapSpeedPitchLink: function (source, value) { return linkPair(source === 'pitch' ? 'pitch' : 'speed', value); },
    whenControlsSettled: function () { return state.controlPromise; },
    bindAudio: bindAudio,
    notifyTrackSourceChanged: function (element) { if (element) bindAudio(element); beginTrackTransition(true); },
    beginTransientSource: beginTransientSource,
    endTransientSource: endTransientSource,
    setKaraokeEnabled: setKaraokeEnabled,
    setKaraokeBalance: setBalance,
    activateStems: activateStems,
    deactivateStems: deactivateStems,
    status: function () {
      return {
        speed: state.speed,
        pitch: state.pitch,
        speedPitchLinkEnabled: state.linkEnabled,
        speedPitchLinkGuard: state.linkGuard,
        speedPitchLinkUpdateSerial: state.linkUpdateSerial,
        speedPitchLinkLastSource: state.linkLastSource,
        requested: state.requestedEnabled,
        phase: state.phase,
        progress: state.progress,
        unsupportedReason: state.unsupportedReason,
        balance: state.balance,
        stems: !!state.stemMixer,
        stemTransport: state.stemMixer ? 'audio-buffer-source' : '',
        stemLayout: state.stemLayout,
        stemSourceKind: state.stemSourceKind,
        taskId: state.taskId,
        trackKey: state.trackKey,
        activeTrackKey: state.activeTrackKey,
        trackRevision: state.trackRevision,
        operationToken: state.operationToken,
        stemListenerCount: state.stemListeners.length,
        hasStemTimer: false,
        pendingElements: !!state.pendingStemDecode,
        pendingStemDecode: !!state.pendingStemDecode,
        transientSourceDepth: state.transientSourceDepth,
      };
    },
  });
})(window);
