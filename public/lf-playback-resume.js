(function (global) {
  'use strict';

  var STORAGE_KEY = 'lumifield-playback-resume-v2';
  var SCHEMA = 'lumifield.playback-resume';
  var VERSION = 2;
  var AUDIO_CONTROL_SCHEMA = 2;
  var MAX_QUEUE = 500;
  var MAX_PROFILES = 8;
  var identity = '';
  var identityReady = false;
  var pending = null;
  var pendingConsumed = false;
  var restorePromise = null;
  var saveTimer = 0;
  var lastSaveAt = 0;
  var lastSaveReason = '';
  var restoreAttempts = 0;
  var originalTogglePlay = global.togglePlay;

  function text(value, limit) { return String(value == null ? '' : value).trim().slice(0, limit || 256); }
  function number(value, fallback) { value = Number(value); return isFinite(value) ? value : (fallback || 0); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, number(value, min))); }
  function currentIdentity(value) { return text(value, 160) || 'guest'; }

  function providerOf(song) {
    var provider = text(song && (song.provider || song.source || song.type), 32).toLowerCase();
    if (provider === 'song') provider = 'netease';
    return /^(netease|qq|kugou|kugou_concept|qishui)$/.test(provider) ? provider : '';
  }

  function safeArtists(value) {
    return (Array.isArray(value) ? value : []).slice(0, 16).map(function (artist) {
      return { id:text(artist && (artist.id || artist.mid), 96), name:text(artist && artist.name, 128) };
    }).filter(function (artist) { return artist.name; });
  }

  function sanitizeSong(song) {
    if (!song || typeof song !== 'object') return null;
    var provider = providerOf(song);
    var id = text(song.id || song.mid || song.songmid || song.hash || song.localKey, 160);
    var name = text(song.name || song.title, 256);
    if (!provider || !id || !name) return null;
    return {
      id:id,
      provider:provider,
      source:provider,
      type:text(song.type, 32) || provider,
      name:name,
      artist:text(song.artist || song.author, 256),
      artists:safeArtists(song.artists),
      artistId:text(song.artistId, 96),
      artistMid:text(song.artistMid, 96),
      album:text(song.album, 256),
      albumId:text(song.albumId || song.album_id, 96),
      qqId:text(song.qqId, 96),
      mid:text(song.mid || song.songmid, 160),
      songmid:text(song.songmid || song.mid, 160),
      mediaMid:text(song.mediaMid || song.media_mid, 160),
      hash:text(song.hash || song.fileHash, 96).toUpperCase(),
      hqHash:text(song.hqHash, 96).toUpperCase(),
      sqHash:text(song.sqHash, 96).toUpperCase(),
      albumAudioId:text(song.albumAudioId || song.album_audio_id || song.mixSongId, 96),
      mixSongId:text(song.mixSongId || song.albumAudioId || song.id, 96),
      qishuiTrackId:text(song.qishuiTrackId || (provider === 'qishui' ? song.id : ''), 160),
      mediaType:text(song.mediaType || song.qishuiMediaType, 32),
      qishuiMediaType:text(song.qishuiMediaType || song.mediaType, 32),
      duration:Math.max(0, number(song.duration || song.durationMs || song.dt, 0)),
      climaxStartSec:Math.max(0, number(song.climaxStartSec, 0)),
      fee:number(song.fee, 0),
      playable:song.playable === true ? true : (song.playable === false ? false : null),
      playlistId:text(song.playlistId, 160),
      sourcePlaylistId:text(song.sourcePlaylistId, 160),
      queueId:text(song.queueId, 160)
    };
  }

  function emptyRoot() { return { schema:SCHEMA, version:VERSION, profiles:{} }; }
  function readRoot() {
    var raw = '';
    try { raw = localStorage.getItem(STORAGE_KEY) || ''; } catch (_) { return emptyRoot(); }
    if (!raw) return emptyRoot();
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.schema !== SCHEMA || parsed.version !== VERSION || !parsed.profiles || typeof parsed.profiles !== 'object' || Array.isArray(parsed.profiles)) throw new Error('INVALID_ROOT');
      return parsed;
    } catch (_) {
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      return emptyRoot();
    }
  }

  function validateSnapshot(value, scope) {
    if (!value || value.schema !== SCHEMA || value.version !== VERSION || currentIdentity(value.currentUser) !== scope || !Array.isArray(value.queue)) return null;
    var queue = value.queue.slice(0, MAX_QUEUE).map(sanitizeSong).filter(Boolean);
    var index = Math.floor(number(value.currentIndex, -1));
    if (!queue.length || index < 0 || index >= queue.length) return null;
    var duration = Math.max(0, number(value.duration, queue[index].duration || 0));
    var position = Math.max(0, number(value.position, 0));
    if (duration > 0) position = Math.min(position, Math.max(0, duration - 0.45));
    var controls = value.accompaniment && typeof value.accompaniment === 'object' ? value.accompaniment : {};
    var speedPitchLinkEnabled = value.speedPitchLinkEnabled === true;
    var playbackRate = clamp(value.playbackRate || 1, 0.5, 2);
    var pitch = clamp(value.pitch, -12, 12);
    if (speedPitchLinkEnabled) {
      if (Number(value.audioControlSchema) !== AUDIO_CONTROL_SCHEMA) playbackRate = 1;
      pitch = Math.round(12 * Math.log2(playbackRate) * 1000000) / 1000000;
    }
    return {
      schema:SCHEMA,
      version:VERSION,
      currentUser:scope,
      trackId:queue[index].id,
      provider:queue[index].provider,
      playlistId:text(value.playlistId, 160),
      queueId:text(value.queueId, 160),
      queue:queue,
      currentIndex:index,
      position:position,
      duration:duration,
      timestamp:Math.max(0, number(value.timestamp, 0)),
      audioControlSchema:AUDIO_CONTROL_SCHEMA,
      playbackRate:playbackRate,
      pitch:pitch,
      speedPitchLinkEnabled:speedPitchLinkEnabled,
      accompaniment:{ requested:controls.requested === true, balance:clamp(controls.balance, -1, 1) },
      context:value.context && typeof value.context === 'object' ? {
        id:text(value.context.id, 160), type:text(value.context.type, 48), title:text(value.context.title, 256), city:text(value.context.city, 96)
      } : null
    };
  }

  function controlsState() {
    try {
      if (global.LFAudioControls && typeof global.LFAudioControls.status === 'function') return global.LFAudioControls.status() || {};
    } catch (_) {}
    return {};
  }

  function captureSnapshot() {
    if (!identityReady) return null;
    var queue = Array.isArray(global.playQueue) ? global.playQueue : [];
    var index = Math.floor(number(global.currentIdx, -1));
    if (!queue.length || index < 0 || index >= queue.length) return null;
    var start = Math.max(0, Math.min(index - 100, Math.max(0, queue.length - MAX_QUEUE)));
    var source = queue.slice(start, start + MAX_QUEUE);
    var sanitized = [];
    var restoredIndex = -1;
    source.forEach(function (song, offset) {
      var safe = sanitizeSong(song);
      if (!safe) return;
      if (start + offset === index) restoredIndex = sanitized.length;
      sanitized.push(safe);
    });
    if (!sanitized.length || restoredIndex < 0) return null;
    var song = sanitized[restoredIndex];
    var media = global.audio;
    var preservePending = pending && !pendingConsumed && (!media || !media.src) && pending.trackId === song.id && pending.provider === song.provider;
    var duration = preservePending ? pending.duration : Math.max(0, number(media && media.duration, song.duration));
    var position = preservePending ? pending.position : Math.max(0, number(media && media.currentTime, 0));
    var controls = controlsState();
    var context = global.activeRadioContext && typeof global.activeRadioContext === 'object' ? global.activeRadioContext : null;
    return validateSnapshot({
      schema:SCHEMA,
      version:VERSION,
      currentUser:identity,
      trackId:song.id,
      provider:song.provider,
      playlistId:song.playlistId || song.sourcePlaylistId || '',
      queueId:song.queueId || song.playlistId || context && context.id || '',
      queue:sanitized,
      currentIndex:restoredIndex,
      position:position,
      duration:duration,
      timestamp:Date.now(),
      audioControlSchema:AUDIO_CONTROL_SCHEMA,
      playbackRate:number(controls.speed, media && media.playbackRate || preservePending && pending.playbackRate || 1),
      pitch:number(controls.pitch, preservePending && pending.pitch || 0),
      speedPitchLinkEnabled:controls.speedPitchLinkEnabled === true,
      accompaniment:{ requested:controls.requested === true, balance:number(controls.balance, preservePending && pending.accompaniment.balance || 0) },
      context:context
    }, identity);
  }

  function writeProfile(snapshot, reason) {
    if (!identityReady) return false;
    var root = readRoot();
    if (snapshot) root.profiles[identity] = snapshot;
    else delete root.profiles[identity];
    root.lastWrite = { currentUser:identity, reason:text(reason, 64) || 'unspecified', timestamp:Date.now() };
    if (/^(?:window-close|before-quit|app-restart|main-process-exit)$/.test(String(reason || ''))) {
      root.lastMainProcessSave = root.lastWrite;
    }
    Object.keys(root.profiles).sort(function (left, right) {
      return number(root.profiles[right] && root.profiles[right].timestamp, 0) - number(root.profiles[left] && root.profiles[left].timestamp, 0);
    }).slice(MAX_PROFILES).forEach(function (scope) { delete root.profiles[scope]; });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(root));
      lastSaveAt = Date.now();
      lastSaveReason = text(reason, 64) || 'unspecified';
      return true;
    } catch (_) { return false; }
  }

  function saveNow(reason) {
    clearTimeout(saveTimer); saveTimer = 0;
    return writeProfile(captureSnapshot(), reason);
  }

  function markDirty(reason, immediate) {
    if (!identityReady) return;
    if (immediate) { saveNow(reason); return; }
    if (saveTimer) return;
    var wait = Math.max(120, 2500 - Math.max(0, Date.now() - lastSaveAt));
    saveTimer = setTimeout(function () { saveNow(reason); }, wait);
  }

  function stopRuntimePlayback() {
    try {
      if (global.audio) {
        global.audio.pause();
        global.audio.removeAttribute('src');
        global.audio.load();
      }
    } catch (_) {}
    global.playing = false;
    global.playQueue = [];
    global.currentIdx = -1;
    global.activeRadioContext = null;
    global.currentLocalSong = null;
    if (typeof global.setPlayIcon === 'function') global.setPlayIcon(false);
    try {
      var title = document.getElementById('thumb-title');
      var artist = document.getElementById('thumb-artist');
      var wrap = document.getElementById('thumb-wrap');
      var display = document.getElementById('time-display');
      if (title) title.textContent = '未选择歌曲';
      if (artist) artist.textContent = '';
      if (wrap) wrap.classList.remove('visible');
      if (display) display.textContent = '0:00 / 0:00';
      if (typeof global.setProgressVisual === 'function') global.setProgressVisual(0);
      if (typeof global.safeRenderQueuePanel === 'function') global.safeRenderQueuePanel('playback-account-switch');
    } catch (_) {}
  }

  function renderRestoredQueue(snapshot) {
    var song = snapshot && snapshot.queue[snapshot.currentIndex];
    if (!song) return;
    try {
      var title = document.getElementById('thumb-title');
      var artist = document.getElementById('thumb-artist');
      var wrap = document.getElementById('thumb-wrap');
      if (title) title.textContent = song.name;
      if (artist) artist.textContent = song.artist;
      if (wrap) wrap.classList.add('visible');
      if (typeof global.updateControlTrackInfo === 'function') global.updateControlTrackInfo(song);
      if (typeof global.safeRenderQueuePanel === 'function') global.safeRenderQueuePanel('playback-resume-restore');
      else if (typeof global.renderQueuePanel === 'function') global.renderQueuePanel();
      if (typeof global.setPlayIcon === 'function') global.setPlayIcon(false);
      var duration = snapshot.duration || song.duration || 0;
      if (duration > 0 && typeof global.setProgressVisual === 'function') global.setProgressVisual(snapshot.position / duration * 100);
      var display = document.getElementById('time-display');
      if (display && typeof global.formatProgramTime === 'function') display.textContent = global.formatProgramTime(snapshot.position) + ' / ' + global.formatProgramTime(duration);
    } catch (_) {}
  }

  function loadIdentity(nextIdentity) {
    nextIdentity = currentIdentity(nextIdentity);
    if (identityReady && identity === nextIdentity) return pending;
    var firstIdentity = !identityReady;
    var activeRuntime = firstIdentity && ((Array.isArray(global.playQueue) && global.playQueue.length > 0) || number(global.currentIdx, -1) >= 0 || !!(global.audio && global.audio.src));
    if (identityReady) saveNow('account-switch');
    identity = nextIdentity;
    identityReady = true;
    if (activeRuntime) {
      pending = null;
      pendingConsumed = false;
      markDirty('initial-identity-active-runtime', false);
      return null;
    }
    stopRuntimePlayback();
    var root = readRoot();
    pending = validateSnapshot(root.profiles[identity], identity);
    pendingConsumed = false;
    if (pending) {
      global.playQueue = pending.queue.map(function (song) { return Object.assign({}, song); });
      global.currentIdx = pending.currentIndex;
      global.activeRadioContext = pending.context;
      renderRestoredQueue(pending);
    }
    return pending;
  }

  async function applyStoredControls(snapshot, afterPlayback) {
    var controls = global.LFAudioControls;
    if (!controls) return;
    if (!afterPlayback) {
      if (typeof controls.setSpeedPitchLinkEnabled === 'function') await Promise.resolve(controls.setSpeedPitchLinkEnabled(snapshot.speedPitchLinkEnabled));
      if (typeof controls.setSpeed === 'function') await Promise.resolve(controls.setSpeed(snapshot.playbackRate));
      if (!snapshot.speedPitchLinkEnabled && typeof controls.setPitch === 'function') await Promise.resolve(controls.setPitch(snapshot.pitch));
      if (typeof controls.setKaraokeBalance === 'function') controls.setKaraokeBalance(snapshot.accompaniment.balance);
    } else if (snapshot.accompaniment.requested && typeof controls.setKaraokeEnabled === 'function') {
      await Promise.resolve(controls.setKaraokeEnabled(true));
    }
  }

  async function restoreOnManualPlay() {
    if (!pending || pendingConsumed || !identityReady) return originalTogglePlay.apply(global, arguments);
    if (restorePromise) return restorePromise;
    var snapshot = pending;
    pendingConsumed = true;
    restoreAttempts += 1;
    restorePromise = (async function () {
      await applyStoredControls(snapshot, false);
      await Promise.resolve(global.playQueueAt(snapshot.currentIndex, {
        manual:true,
        resumeAt:snapshot.position,
        context:snapshot.context,
        playbackResume:true,
        origin:'playback-resume'
      }));
      if (!global.audio || !global.audio.src || global.audio.paused || global.audio.ended) throw new Error('PLAYBACK_RESUME_START_FAILED');
      await applyStoredControls(snapshot, true);
      markDirty('manual-restore-complete', false);
      return true;
    })().catch(function (error) {
      pendingConsumed = false;
      throw error;
    }).finally(function () { restorePromise = null; });
    return restorePromise;
  }

  if (typeof originalTogglePlay === 'function') {
    global.togglePlay = function () {
      if (restorePromise) return restorePromise;
      if (pending && !pendingConsumed) return restoreOnManualPlay();
      return originalTogglePlay.apply(global, arguments);
    };
  }

  document.addEventListener('lumifield-auth-user-change', function (event) {
    loadIdentity(event && event.detail && event.detail.userId);
  });
  global.addEventListener('beforeunload', function () { saveNow('beforeunload'); });
  global.addEventListener('pagehide', function () { saveNow('pagehide'); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) saveNow('visibility-hidden'); });
  var bridge = global.desktopWindow;
  if (bridge && typeof bridge.onPlaybackStateSaveRequest === 'function') {
    bridge.onPlaybackStateSaveRequest(function (request) {
      var ok = saveNow(request && request.reason || 'main-process-exit');
      if (typeof bridge.completePlaybackStateSave === 'function') bridge.completePlaybackStateSave(request && request.requestId, ok);
    });
  }
  setInterval(function () { if (identityReady) markDirty('periodic', false); }, 2500);

  global.LFPlaybackResume = Object.freeze({
    schema:SCHEMA,
    version:VERSION,
    saveNow:saveNow,
    markDirty:markDirty,
    isRestoring:function () { return !!restorePromise; },
    reloadCurrent:function () {
      var scope = identityReady ? identity : 'guest';
      identityReady = false;
      identity = '';
      return loadIdentity(scope);
    },
    inspect:function () {
      return {
        identity:identity,
        identityReady:identityReady,
        pending:!!pending,
        pendingConsumed:pendingConsumed,
        restoreBusy:!!restorePromise,
        restoreAttempts:restoreAttempts,
        lastSaveAt:lastSaveAt,
        lastSaveReason:lastSaveReason,
        storageKey:STORAGE_KEY
      };
    }
  });
})(window);
