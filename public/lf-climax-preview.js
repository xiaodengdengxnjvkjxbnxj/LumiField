(function (global) {
  'use strict';

  var VERSION = '1.1.0';
  var CACHE_KEY = 'lumifield-climax-analysis-v2';
  var DEFAULT_HOLD_MS = 620;
  var DEFAULT_SEGMENT_SECONDS = 60;
  var MIN_CLIMAX_START_SECONDS = 0.5;
  var MAX_CACHE_ROWS = 96;
  var state = {
    phase: 'idle',
    generation: 0,
    pointerId: null,
    song: null,
    songKey: '',
    origin: '',
    target: null,
    hitId: '',
    holding: false,
    holdTimer: 0,
    loopFrame: 0,
    statusFrame: 0,
    startedAt: 0,
    startSec: 0,
    endSec: 0,
    segmentSec: 0,
    loopCount: 0,
    sourceKind: '',
    snapshot: null,
    sourceUrl: '',
    pageSignature: '',
    suppressClickUntil: 0,
    lastLoopAt: 0,
    events: [],
    lastError: '',
    lastFailureClassification: null,
  };
  var analysisCache = readAnalysisCache();
  var chip = null;
  var markerResolve = { generation:0, key:'', promise:null, failedKey:'', failedAt:0 };

  function clamp(value, min, max) {
    value = Number(value);
    if (!Number.isFinite(value)) value = min;
    return Math.max(min, Math.min(max, value));
  }
  function now() { return Date.now(); }
  function playbackFailureCoordinator() {
    var coordinator = global.LumiFieldPlaybackFailureCoordinator;
    return coordinator && typeof coordinator.getIdentity === 'function' ? coordinator : null;
  }
  function pauseMainPlaybackFailurePolicy(snapshot, reason) {
    var coordinator = playbackFailureCoordinator();
    var identity = coordinator && coordinator.getIdentity();
    if (!identity) return null;
    snapshot.failureIdentity = identity;
    coordinator.markUserPause(Object.assign({}, identity, { reason:reason || 'climax-preview' }));
    return identity;
  }
  function restoreMainPlaybackFailurePolicy(snapshot, error) {
    var coordinator = playbackFailureCoordinator();
    var identity = snapshot && snapshot.failureIdentity;
    if (!coordinator || !identity || !coordinator.isCurrent(identity)) return;
    if (snapshot.paused) {
      coordinator.markUserPause(Object.assign({}, identity, { reason:'climax-preview-restored-paused' }));
      return;
    }
    coordinator.markUserResume(Object.assign({}, identity, { reason:'climax-preview-restore' }));
    if (!error) {
      coordinator.markPlaying(coordinator.getIdentity() || identity);
      return;
    }
    Promise.resolve(coordinator.reportFailure(Object.assign({}, identity, {
      error:error,
      eventType:'error',
      sourceUrl:snapshot.src,
      media:snapshot.media,
      mediaError:snapshot.media && snapshot.media.error
    }))).catch(function () {});
  }
  function classifyPreviewFailure(error, eventType) {
    var coordinator = playbackFailureCoordinator();
    var classification = coordinator && typeof coordinator.classifyFailure === 'function'
      ? coordinator.classifyFailure({ error:error, eventType:eventType || 'error' })
      : null;
    state.lastFailureClassification = classification;
    return classification;
  }
  function holdMs() {
    var test = global.__lfClimaxPreviewTestConfig;
    return Math.max(80, Number(test && test.holdMs) || DEFAULT_HOLD_MS);
  }
  function segmentSeconds() {
    var test = global.__lfClimaxPreviewTestConfig;
    return Math.max(0.5, Number(test && test.segmentSeconds) || DEFAULT_SEGMENT_SECONDS);
  }
  function logEvent(type, extra) {
    var row = Object.assign({
      type: type,
      at: performance.now(),
      generation: state.generation,
      phase: state.phase,
      songKey: state.songKey,
    }, extra || {});
    state.events.push(row);
    if (state.events.length > 160) state.events.splice(0, state.events.length - 160);
    global.lumiFieldLastClimaxPreviewEvent = row;
    return row;
  }
  function ensureChip() {
    if (chip && chip.isConnected) return chip;
    chip = document.getElementById('lf-climax-preview-chip');
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'lf-climax-preview-chip';
      chip.setAttribute('role', 'status');
      chip.setAttribute('aria-live', 'polite');
      document.body.appendChild(chip);
    }
    return chip;
  }
  function setChip(text, phase) {
    var node = ensureChip();
    node.textContent = String(text || '');
    node.dataset.phase = phase || state.phase;
    node.classList.toggle('show', !!text);
  }
  function hideChip() {
    var node = ensureChip();
    node.classList.remove('show');
    setTimeout(function () {
      if (!node.classList.contains('show')) node.textContent = '';
    }, 220);
  }
  function formatTime(value) {
    value = Math.max(0, Math.floor(Number(value) || 0));
    return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0');
  }
  function readAnalysisCache() {
    try {
      var parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }
  function writeAnalysisCache() {
    try {
      var keys = Object.keys(analysisCache).sort(function (a, b) {
        return Number(analysisCache[b] && analysisCache[b].updatedAt) - Number(analysisCache[a] && analysisCache[a].updatedAt);
      });
      keys.slice(MAX_CACHE_ROWS).forEach(function (key) { delete analysisCache[key]; });
      localStorage.setItem(CACHE_KEY, JSON.stringify(analysisCache));
    } catch (_) {}
  }
  function providerKey(song) {
    try {
      if (typeof songProviderKey === 'function') return songProviderKey(song);
    } catch (_) {}
    return String(song && (song.provider || song.source || song.type) || 'unknown').toLowerCase();
  }
  function stableSongKey(song) {
    if (!song) return '';
    try {
      if (typeof queueItemKey === 'function') {
        var queueKey = queueItemKey(song);
        if (queueKey) return queueKey;
      }
      if (typeof beatMapSongKey === 'function') {
        var beatKey = beatMapSongKey(song);
        if (beatKey) return beatKey;
      }
    } catch (_) {}
    return [
      providerKey(song),
      song.id || song.mid || song.songmid || song.hash || '',
      song.name || song.title || '',
      song.artist || '',
    ].join(':');
  }
  function durationSeconds(value) {
    var n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n > 10000 ? n / 1000 : n;
  }
  function songDuration(song) {
    return durationSeconds(song && (song.durationSec || song.duration || song.durationMs || song.dt));
  }
  function parseClock(value) {
    if (typeof value !== 'string') return NaN;
    var text = value.trim();
    if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
    var parts = text.split(':').map(Number);
    if (!parts.length || parts.some(function (part) { return !Number.isFinite(part); })) return NaN;
    var result = 0;
    parts.forEach(function (part) { result = result * 60 + part; });
    return result;
  }
  function normalizeStartValue(value, field, duration) {
    if (value && typeof value === 'object') {
      value = value.startSec != null ? value.startSec
        : (value.startTimeMs != null ? value.startTimeMs
          : (value.startTime != null ? value.startTime
            : (value.start != null ? value.start : value.time)));
    }
    var n = typeof value === 'string' ? parseClock(value) : Number(value);
    if (!Number.isFinite(n) || n < 0) return null;
    var name = String(field || '').toLowerCase();
    if (/ms|millisecond/.test(name)) n /= 1000;
    else if (n > 1000 && (!duration || n > duration * 1.8)) n /= 1000;
    if (!Number.isFinite(n) || n < 0 || (duration > 0 && n >= duration - 0.15)) return null;
    return n;
  }
  function platformClimaxStart(song, duration) {
    if (!song || typeof song !== 'object') return null;
    var rows = [
      ['climaxStartSec', song.climaxStartSec],
      ['chorusStartSec', song.chorusStartSec],
      ['highlightStartSec', song.highlightStartSec],
      ['climaxStartMs', song.climaxStartMs],
      ['chorusStartMs', song.chorusStartMs],
      ['highlightStartMs', song.highlightStartMs],
      ['climaxStart', song.climaxStart],
      ['chorusStart', song.chorusStart],
      ['chorus_start', song.chorus_start],
      ['highlightStart', song.highlightStart],
      ['previewStartTime', song.previewStartTime],
      ['auditionStartTime', song.auditionStartTime],
      ['climax.start', song.climax],
      ['chorus.start', song.chorus],
      ['highlight.start', song.highlight],
      ['audioFeatures.climaxStartSec', song.audioFeatures && song.audioFeatures.climaxStartSec],
      ['audioFeatures.chorusStartSec', song.audioFeatures && song.audioFeatures.chorusStartSec],
    ];
    for (var i = 0; i < rows.length; i++) {
      var value = normalizeStartValue(rows[i][1], rows[i][0], duration);
      if (value != null) {
        var fitted = fitSegmentStart(value, duration);
        if (Number.isFinite(fitted)) return { startSec: fitted, source: 'platform-metadata', field: rows[i][0] };
      }
    }
    return null;
  }
  function fitSegmentStart(start, duration) {
    start = Number(start);
    duration = durationSeconds(duration);
    if (!Number.isFinite(start) || start < MIN_CLIMAX_START_SECONDS) return NaN;
    if (!duration) return start;
    var maxStart = duration - 0.15;
    if (maxStart < MIN_CLIMAX_START_SECONDS) return NaN;
    return clamp(start, MIN_CLIMAX_START_SECONDS, maxStart);
  }
  function publishResolvedStart(song, choice, duration) {
    if (!choice) return null;
    var fitted = fitSegmentStart(choice.startSec, duration || choice.duration || songDuration(song));
    if (!Number.isFinite(fitted)) return null;
    var key = stableSongKey(song);
    var result = Object.assign({}, choice, { startSec:fitted, duration:duration || choice.duration || songDuration(song) || 0 });
    if (key) {
      analysisCache[key] = {
        startSec:result.startSec,
        duration:result.duration,
        source:result.source || 'lf-analysis-cache',
        score:Number(result.score) || 0,
        updatedAt:now()
      };
      writeAnalysisCache();
    }
    try { document.dispatchEvent(new CustomEvent('lumifield-climax-start-update', { detail:{ songKey:key, startSec:result.startSec, source:result.source || '' } })); } catch (_) {}
    return result;
  }
  function getKnownStart(song, duration) {
    duration = durationSeconds(duration) || songDuration(song);
    var metadata = platformClimaxStart(song, duration);
    if (metadata) return metadata;
    var key = stableSongKey(song);
    var cached = key && analysisCache[key];
    if (cached) {
      var cachedStart = fitSegmentStart(cached.startSec, duration || cached.duration);
      if (Number.isFinite(cachedStart)) return { startSec:cachedStart, duration:duration || cached.duration || 0, source:cached.source || 'lf-analysis-cache', cached:true };
    }
    try {
      var beatKey = typeof beatMapSongKey === 'function' ? beatMapSongKey(song) : key;
      var map = typeof beatMapCache !== 'undefined' && beatMapCache && beatMapCache[beatKey];
      var fromMap = beatMapClimaxStart(map, duration);
      if (fromMap) return fromMap;
    } catch (_) {}
    return null;
  }
  function eventValue(event, key, fallback) {
    if (typeof event === 'number') return key === 'time' ? event : (fallback == null ? 0.5 : fallback);
    var value = Number(event && event[key]);
    return Number.isFinite(value) ? value : (fallback == null ? 0 : fallback);
  }
  function beatMapClimaxStart(map, duration) {
    if (!map || typeof map !== 'object') return null;
    if (Number.isFinite(Number(map.climaxStartSec))) {
      var cachedStart = fitSegmentStart(Number(map.climaxStartSec), duration || durationSeconds(map.duration));
      if (Number.isFinite(cachedStart)) return { startSec: cachedStart, source: 'lf-analysis-cache', cachedField: true };
    }
    duration = duration || durationSeconds(map.duration);
    var events = (Array.isArray(map.cameraBeats) && map.cameraBeats.length ? map.cameraBeats
      : (Array.isArray(map.beats) && map.beats.length ? map.beats
        : (Array.isArray(map.pulseBeats) ? map.pulseBeats : []))).filter(function (event) {
      var time = eventValue(event, 'time', NaN);
      return Number.isFinite(time) && time >= 0;
    });
    if (!events.length || !duration) return null;
    if (duration <= MIN_CLIMAX_START_SECONDS + 0.2) return null;
    var windowLen = Math.min(segmentSeconds(), Math.max(1, Math.min(duration - MIN_CLIMAX_START_SECONDS, duration * 0.55)));
    var maxStart = Math.max(MIN_CLIMAX_START_SECONDS, duration - windowLen);
    var minStart = Math.min(maxStart, duration >= 90 ? Math.min(20, duration * 0.08) : MIN_CLIMAX_START_SECONDS);
    var candidates = {};
    for (var grid = minStart; grid <= maxStart + 0.001; grid += 4) candidates[grid.toFixed(3)] = grid;
    events.forEach(function (event) {
      var t = eventValue(event, 'time', 0);
      if (t >= minStart && t <= maxStart) candidates[t.toFixed(3)] = t;
      var centered = clamp(t - windowLen * 0.30, minStart, maxStart);
      candidates[centered.toFixed(3)] = centered;
    });
    var best = null;
    Object.keys(candidates).forEach(function (key) {
      var start = candidates[key];
      var end = start + windowLen;
      var inside = events.filter(function (event) {
        var t = eventValue(event, 'time', 0);
        return t >= start && t < end;
      });
      if (inside.length < Math.max(4, windowLen / 12)) return;
      var strength = 0;
      var quarter = [0, 0, 0, 0];
      var gaps = [];
      var lastTime = null;
      inside.forEach(function (event) {
        var t = eventValue(event, 'time', 0);
        var row = eventValue(event, 'strength', 0.42) * 0.28
          + eventValue(event, 'impact', eventValue(event, 'strength', 0.42)) * 0.20
          + eventValue(event, 'low', 0.28) * 0.16
          + eventValue(event, 'body', 0.24) * 0.10
          + eventValue(event, 'snap', 0.18) * 0.08
          + eventValue(event, 'confidence', 0.48) * 0.10
          + (event && event.primary === true ? 0.05 : 0)
          + (event && event.camera === false ? -0.04 : 0);
        strength += row;
        quarter[Math.min(3, Math.floor((t - start) / Math.max(0.01, windowLen / 4)))] += row;
        if (lastTime != null) gaps.push(t - lastTime);
        lastTime = t;
      });
      var density = inside.length / Math.max(1, windowLen);
      var quarterMean = quarter.reduce(function (sum, value) { return sum + value; }, 0) / 4;
      var quarterFloor = Math.min.apply(Math, quarter);
      var gapMean = gaps.length ? gaps.reduce(function (sum, value) { return sum + value; }, 0) / gaps.length : 0;
      var gapVariance = gaps.length ? gaps.reduce(function (sum, value) { return sum + Math.pow(value - gapMean, 2); }, 0) / gaps.length : 1;
      var repeatStability = 1 / (1 + gapVariance * 4);
      var introLift = maxStart > 0 ? Math.min(0.08, start / maxStart * 0.08) : 0;
      var score = strength / inside.length
        + Math.min(0.26, density * 0.16)
        + Math.min(0.18, quarterFloor / Math.max(0.01, quarterMean) * 0.18)
        + repeatStability * 0.16
        + introLift;
      if (!best || score > best.score + 0.000001 || (Math.abs(score - best.score) < 0.000001 && start < best.startSec)) {
        best = { startSec: start, score: score, source: 'lf-analysis-cache', eventCount: inside.length };
      }
    });
    if (!best) return null;
    var align = events.filter(function (event) {
      var t = eventValue(event, 'time', 0);
      return t >= best.startSec - 1.2 && t <= best.startSec + 2.4;
    }).sort(function (a, b) {
      var as = eventValue(a, 'strength', 0) + eventValue(a, 'impact', 0);
      var bs = eventValue(b, 'strength', 0) + eventValue(b, 'impact', 0);
      return bs - as || eventValue(a, 'time', 0) - eventValue(b, 'time', 0);
    })[0];
    if (align) best.startSec = fitSegmentStart(eventValue(align, 'time', best.startSec), duration);
    return Number.isFinite(best.startSec) ? best : null;
  }
  function normalizedCorrelation(values, offset, length, lag) {
    if (length < 4 || lag <= 0 || offset + length + lag > values.length) return 0;
    var aMean = 0, bMean = 0;
    for (var i = 0; i < length; i++) {
      aMean += values[offset + i];
      bMean += values[offset + i + lag];
    }
    aMean /= length;
    bMean /= length;
    var numerator = 0, aPower = 0, bPower = 0;
    for (var j = 0; j < length; j++) {
      var a = values[offset + j] - aMean;
      var b = values[offset + j + lag] - bMean;
      numerator += a * b;
      aPower += a * a;
      bPower += b * b;
    }
    return aPower > 0 && bPower > 0 ? clamp(numerator / Math.sqrt(aPower * bPower), -1, 1) : 0;
  }
  function analysisIsActive(generation, guard) {
    return typeof guard === 'function' ? guard() : generation === state.generation && state.holding;
  }
  async function analyzeAudioForClimax(audioUrl, durationHint, generation, guard) {
    var response = await fetch(audioUrl);
    if (!response.ok) throw new Error('CLIMAX_AUDIO_HTTP_' + response.status);
    var bytes = await response.arrayBuffer();
    if (!analysisIsActive(generation, guard)) throw new Error('CLIMAX_CANCELLED');
    var Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) throw new Error('CLIMAX_AUDIO_CONTEXT_UNAVAILABLE');
    var context = new Ctx();
    var buffer;
    try {
      buffer = await context.decodeAudioData(bytes.slice(0));
    } finally {
      try { await context.close(); } catch (_) {}
    }
    if (!analysisIsActive(generation, guard)) throw new Error('CLIMAX_CANCELLED');
    if (!buffer || !buffer.length) throw new Error('CLIMAX_DECODE_EMPTY');
    var duration = durationSeconds(buffer.duration) || durationHint;
    var frameSec = 0.5;
    var frameCount = Math.max(1, Math.floor(duration / frameSec));
    var energy = new Float32Array(frameCount);
    var onset = new Float32Array(frameCount);
    var channels = Math.max(1, buffer.numberOfChannels);
    var sampleRate = buffer.sampleRate;
    var samplesPerFrame = Math.max(1, Math.floor(sampleRate * frameSec));
    var stride = Math.max(1, Math.floor(samplesPerFrame / 1800));
    for (var frame = 0; frame < frameCount; frame++) {
      var sum = 0, count = 0, diff = 0;
      var begin = frame * samplesPerFrame;
      var end = Math.min(buffer.length, begin + samplesPerFrame);
      for (var channel = 0; channel < channels; channel++) {
        var pcm = buffer.getChannelData(channel);
        var previous = pcm[Math.max(0, begin - stride)] || 0;
        for (var sample = begin; sample < end; sample += stride) {
          var value = pcm[sample] || 0;
          sum += value * value;
          diff += Math.abs(value - previous);
          previous = value;
          count++;
        }
      }
      energy[frame] = count ? Math.sqrt(sum / count) : 0;
      onset[frame] = count ? diff / count : 0;
      if (frame && frame % 80 === 0) {
        await new Promise(function (resolve) { setTimeout(resolve, 0); });
        if (!analysisIsActive(generation, guard)) throw new Error('CLIMAX_CANCELLED');
      }
    }
    var sortedEnergy = Array.prototype.slice.call(energy).sort(function (a, b) { return a - b; });
    var sortedOnset = Array.prototype.slice.call(onset).sort(function (a, b) { return a - b; });
    var e90 = sortedEnergy[Math.min(sortedEnergy.length - 1, Math.floor(sortedEnergy.length * 0.90))] || 0.001;
    var o90 = sortedOnset[Math.min(sortedOnset.length - 1, Math.floor(sortedOnset.length * 0.90))] || 0.001;
    if (duration <= MIN_CLIMAX_START_SECONDS + 0.2) throw new Error('CLIMAX_AUDIO_TOO_SHORT');
    var windowSec = Math.min(segmentSeconds(), Math.max(1, Math.min(duration - MIN_CLIMAX_START_SECONDS, duration * 0.55)));
    var windowFrames = Math.max(1, Math.floor(windowSec / frameSec));
    var minFrame = Math.max(1, Math.floor((duration >= 90 ? Math.min(20, duration * 0.08) : MIN_CLIMAX_START_SECONDS) / frameSec));
    var maxFrame = Math.max(minFrame, frameCount - windowFrames);
    var stepFrames = Math.max(1, Math.round(2 / frameSec));
    var best = null;
    for (var startFrame = minFrame; startFrame <= maxFrame; startFrame += stepFrames) {
      var sumEnergy = 0, sumOnset = 0, high = 0, minQuarter = Infinity;
      var quarterLen = Math.max(1, Math.floor(windowFrames / 4));
      for (var q = 0; q < 4; q++) {
        var quarterEnergy = 0;
        var qStart = startFrame + q * quarterLen;
        var qEnd = Math.min(startFrame + windowFrames, qStart + quarterLen);
        for (var f = qStart; f < qEnd; f++) quarterEnergy += energy[f] || 0;
        minQuarter = Math.min(minQuarter, quarterEnergy / Math.max(1, qEnd - qStart));
      }
      for (var index = startFrame; index < Math.min(frameCount, startFrame + windowFrames); index++) {
        sumEnergy += energy[index] || 0;
        sumOnset += onset[index] || 0;
        if ((energy[index] || 0) >= e90 * 0.72) high++;
      }
      var meanEnergy = sumEnergy / windowFrames;
      var meanOnset = sumOnset / windowFrames;
      var repeat = 0;
      [Math.round(4 / frameSec), Math.round(8 / frameSec), Math.round(16 / frameSec)].forEach(function (lag) {
        var length = Math.min(windowFrames - lag, Math.round(16 / frameSec));
        repeat += Math.max(0, normalizedCorrelation(energy, startFrame, length, lag));
      });
      repeat /= 3;
      var score = clamp(meanEnergy / e90, 0, 1.8) * 0.46
        + clamp(meanOnset / o90, 0, 1.8) * 0.17
        + (high / windowFrames) * 0.16
        + clamp(minQuarter / e90, 0, 1.4) * 0.08
        + repeat * 0.13;
      if (!best || score > best.score + 0.000001 || (Math.abs(score - best.score) < 0.000001 && startFrame < best.frame)) {
        best = { frame: startFrame, score: score };
      }
    }
    if (!best) throw new Error('CLIMAX_ANALYSIS_NO_WINDOW');
    var peakFrame = best.frame;
    var peakScore = -Infinity;
    var searchRadius = Math.max(1, Math.round(2 / frameSec));
    for (var pf = Math.max(minFrame, best.frame - searchRadius); pf <= Math.min(maxFrame, best.frame + searchRadius); pf++) {
      var pointScore = (onset[pf] / o90) * 0.62 + (energy[pf] / e90) * 0.38;
      if (pointScore > peakScore) {
        peakScore = pointScore;
        peakFrame = pf;
      }
    }
    var detectedStart = fitSegmentStart(peakFrame * frameSec, duration);
    if (!Number.isFinite(detectedStart)) throw new Error('CLIMAX_ANALYSIS_ZERO_START_REJECTED');
    return {
      startSec: detectedStart,
      duration: duration,
      source: 'local-energy-analysis',
      score: best.score,
      frameSec: frameSec,
    };
  }
  async function cachedBeatMap(song) {
    var key = '';
    try { key = typeof beatMapSongKey === 'function' ? beatMapSongKey(song) : stableSongKey(song); } catch (_) { key = stableSongKey(song); }
    if (!key) return null;
    try {
      if (typeof beatMapCache !== 'undefined' && beatMapCache && beatMapCache[key]) return beatMapCache[key];
      if (typeof readBeatDiskCache === 'function') return await readBeatDiskCache(key);
    } catch (error) {
      console.warn('[ClimaxPreviewCache]', error);
    }
    return null;
  }
  async function resolveSource(song) {
    if (song && song.localUrl) return { audioUrl: song.localUrl, duration: songDuration(song), data: null };
    if (song && song.type === 'local' && song.url) return { audioUrl: song.url, duration: songDuration(song), data: null };
    if (typeof resolvePlaybackSource !== 'function') throw new Error('CLIMAX_RESOLVER_UNAVAILABLE');
    var quality = typeof playbackQuality !== 'undefined' ? playbackQuality : 'standard';
    var data = await resolvePlaybackSource(song, quality, false);
    if (!data || !data.url) {
      var error = new Error((data && (data.message || data.reason)) || 'CLIMAX_SOURCE_UNAVAILABLE');
      error.data = data || null;
      throw error;
    }
    var resolvedDuration = songDuration(data.resolvedSong) || songDuration(song);
    return {
      audioUrl: '/api/audio?url=' + encodeURIComponent(data.url),
      duration: resolvedDuration,
      data: data,
    };
  }
  async function chooseStart(song, source, generation) {
    var duration = source.duration || songDuration(song);
    var metadata = platformClimaxStart(song, duration)
      || platformClimaxStart(source.data && source.data.resolvedSong, duration)
      || platformClimaxStart(source.data, duration);
    if (metadata) return publishResolvedStart(song, metadata, duration);
    var key = stableSongKey(song);
    if (markerResolve.key === key && markerResolve.promise) {
      var resolving = await markerResolve.promise;
      if (resolving) return resolving;
    }
    var cached = key && analysisCache[key];
    var fittedCached = cached && fitSegmentStart(Number(cached.startSec), duration || Number(cached.duration));
    if (cached && Number.isFinite(fittedCached) && (!duration || !cached.duration || Math.abs(Number(cached.duration) - duration) < 2.5)) {
      return {
        startSec: fittedCached,
        duration: duration || Number(cached.duration) || 0,
        source: cached.source === 'local-energy-analysis' ? 'local-analysis-cache' : 'lf-analysis-cache',
        score: Number(cached.score) || 0,
      };
    }
    var map = await cachedBeatMap(song);
    if (generation !== state.generation || !state.holding) throw new Error('CLIMAX_CANCELLED');
    var fromMap = beatMapClimaxStart(map, duration);
    if (fromMap) {
      fromMap.duration = duration || durationSeconds(map && map.duration);
      return publishResolvedStart(song, fromMap, fromMap.duration);
    }
    var local = await analyzeAudioForClimax(source.audioUrl, duration, generation);
    return publishResolvedStart(song, local, local.duration);
  }
  function ensureStart(song, duration) {
    duration = durationSeconds(duration) || songDuration(song);
    var known = getKnownStart(song, duration);
    if (known) return Promise.resolve(known);
    var key = stableSongKey(song);
    if (!key) return Promise.resolve(null);
    if (markerResolve.key === key && markerResolve.promise) return markerResolve.promise;
    if (markerResolve.failedKey === key && now() - markerResolve.failedAt < 15000) return Promise.resolve(null);
    var generation = ++markerResolve.generation;
    markerResolve.key = key;
    var guard = function () { return generation === markerResolve.generation && markerResolve.key === key; };
    markerResolve.promise = (async function () {
      var map = await cachedBeatMap(song);
      if (!guard()) throw new Error('CLIMAX_CANCELLED');
      var fromMap = beatMapClimaxStart(map, duration || durationSeconds(map && map.duration));
      if (fromMap) return publishResolvedStart(song, fromMap, duration || durationSeconds(map && map.duration));
      var source = await resolveSource(song);
      if (!guard()) throw new Error('CLIMAX_CANCELLED');
      var sourceDuration = source.duration || duration;
      var metadata = platformClimaxStart(source.data && source.data.resolvedSong, sourceDuration)
        || platformClimaxStart(source.data, sourceDuration);
      if (metadata) return publishResolvedStart(song, metadata, sourceDuration);
      var local = await analyzeAudioForClimax(source.audioUrl, sourceDuration, generation, guard);
      if (!guard()) throw new Error('CLIMAX_CANCELLED');
      return publishResolvedStart(song, local, local.duration);
    })().catch(function (error) {
      if (guard() && !/CLIMAX_CANCELLED/.test(String(error && error.message))) {
        markerResolve.failedKey = key;
        markerResolve.failedAt = now();
        logEvent('marker-resolve-unavailable', { songKey:key, error:String(error && error.message || error) });
      }
      return null;
    }).finally(function () {
      if (generation === markerResolve.generation) markerResolve.promise = null;
    });
    return markerResolve.promise;
  }
  function pageSignature() {
    var body = document.body;
    var classes = ['empty-home-active', 'immersive-mode', 'desktop-fullscreen', 'splash-active'].filter(function (name) {
      return body && body.classList.contains(name);
    }).join(',');
    var shelfOpen = false;
    try { shelfOpen = !!(shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent()); } catch (_) {}
    var tab = typeof queueViewTab === 'undefined' ? '' : queueViewTab;
    return location.href + '|' + classes + '|' + tab + '|' + shelfOpen;
  }
  function snapshotContext() {
    var media = typeof audio !== 'undefined' ? audio : null;
    return {
      audioExisted: !!media,
      media: media,
      src: media ? String(media.currentSrc || media.src || '') : '',
      currentTime: media && Number.isFinite(media.currentTime) ? media.currentTime : 0,
      paused: !media || media.paused,
      ended: !!(media && media.ended),
      playbackRate: media ? Number(media.playbackRate) || 1 : 1,
      defaultPlaybackRate: media ? Number(media.defaultPlaybackRate) || 1 : 1,
      preservesPitch: media ? media.preservesPitch !== false : true,
      volume: media ? Number(media.volume) : 1,
      muted: !!(media && media.muted),
      loop: !!(media && media.loop),
      preload: media ? media.preload : '',
      crossOrigin: media ? media.crossOrigin : '',
      onended: media ? media.onended : null,
      onloadedmetadata: media ? media.onloadedmetadata : null,
      onerror: media ? media.onerror : null,
      playing: typeof playing !== 'undefined' ? !!playing : false,
      playToggleBusy: typeof playToggleBusy !== 'undefined' ? !!playToggleBusy : false,
      currentIdx: typeof currentIdx !== 'undefined' ? currentIdx : -1,
      queueRef: typeof playQueue !== 'undefined' ? playQueue : null,
      queueKeys: typeof playQueue !== 'undefined' && Array.isArray(playQueue) ? playQueue.map(stableSongKey) : [],
      activeRadioContext: typeof activeRadioContext !== 'undefined' ? activeRadioContext : null,
      trackSwitchToken: typeof trackSwitchToken !== 'undefined' ? trackSwitchToken : 0,
      listenSession: typeof listenSession !== 'undefined' && listenSession ? {
        ref: listenSession,
        lastWallAt: listenSession.lastWallAt,
        lastAudioTime: listenSession.lastAudioTime,
        listenMs: listenSession.listenMs,
        maxProgress: listenSession.maxProgress,
      } : null,
    };
  }
  function queueUnchanged(snapshot) {
    if (!snapshot || typeof playQueue === 'undefined') return true;
    if (playQueue !== snapshot.queueRef || currentIdx !== snapshot.currentIdx || playQueue.length !== snapshot.queueKeys.length) return false;
    for (var i = 0; i < snapshot.queueKeys.length; i++) {
      if (stableSongKey(playQueue[i]) !== snapshot.queueKeys[i]) return false;
    }
    return true;
  }
  function mediaEvent(media, names, timeoutMs, generation) {
    names = Array.isArray(names) ? names : [names];
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () { finish(new Error('CLIMAX_MEDIA_TIMEOUT')); }, timeoutMs || 16000);
      function cleanup() {
        clearTimeout(timer);
        names.forEach(function (name) { media.removeEventListener(name, onReady); });
        media.removeEventListener('error', onError);
      }
      function finish(error) {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error); else resolve();
      }
      function onReady() {
        if (generation != null && generation !== state.generation) finish(new Error('CLIMAX_CANCELLED'));
        else finish();
      }
      function onError() {
        var detail = media.error && (media.error.message || ('MEDIA_ERR_' + media.error.code));
        finish(new Error(detail || 'CLIMAX_MEDIA_ERROR'));
      }
      names.forEach(function (name) { media.addEventListener(name, onReady); });
      media.addEventListener('error', onError);
      if (media.readyState >= 1 && names.indexOf('loadedmetadata') >= 0) finish();
      else if (media.readyState >= 3 && names.indexOf('canplay') >= 0) finish();
    });
  }
  async function seekMedia(media, seconds, generation) {
    seconds = Math.max(0, Number(seconds) || 0);
    if (Math.abs((media.currentTime || 0) - seconds) <= 0.30) return;
    await new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () { finish(new Error('CLIMAX_SEEK_TIMEOUT')); }, 9000);
      function cleanup() {
        clearTimeout(timer);
        media.removeEventListener('seeked', onSeeked);
        media.removeEventListener('error', onError);
      }
      function finish(error) {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error); else resolve();
      }
      function onSeeked() {
        if (generation != null && generation !== state.generation) finish(new Error('CLIMAX_CANCELLED'));
        else if (Math.abs((Number(media.currentTime) || 0) - seconds) > 0.30) finish(new Error('CLIMAX_SEEK_MISMATCH'));
        else finish();
      }
      function onError() {
        var detail = media.error && (media.error.message || ('MEDIA_ERR_' + media.error.code));
        finish(new Error(detail || 'CLIMAX_SEEK_MEDIA_ERROR'));
      }
      media.addEventListener('seeked', onSeeked);
      media.addEventListener('error', onError);
      try { media.currentTime = seconds; } catch (error) { finish(error); }
    });
    if (generation != null && generation !== state.generation) throw new Error('CLIMAX_CANCELLED');
    if (Math.abs((Number(media.currentTime) || 0) - seconds) > 0.30) throw new Error('CLIMAX_SEEK_MISMATCH');
  }
  async function beginMediaPreview(source, choice, generation) {
    if (generation !== state.generation || !state.holding) throw new Error('CLIMAX_CANCELLED');
    state.snapshot = snapshotContext();
    var snapshot = state.snapshot;
    pauseMainPlaybackFailurePolicy(snapshot, 'climax-preview-source-switch');
    var media = snapshot.media;
    if (!media) {
      media = audio = new Audio();
      media.crossOrigin = 'anonymous';
      if (typeof bindPlaybackProgressEvents === 'function') bindPlaybackProgressEvents(media);
    }
    if (global.LFAudioControls && typeof global.LFAudioControls.beginTransientSource === 'function') {
      global.LFAudioControls.beginTransientSource(media);
    }
    try {
      media.pause();
      media.onended = null;
      media.onloadedmetadata = null;
      media.onerror = null;
      media.loop = false;
      media.preload = 'auto';
      media.src = source.audioUrl;
      media.load();
      await mediaEvent(media, ['loadedmetadata', 'canplay'], 18000, generation);
      if (generation !== state.generation || !state.holding) throw new Error('CLIMAX_CANCELLED');
      var duration = durationSeconds(media.duration) || choice.duration || source.duration || songDuration(state.song);
      var wanted = segmentSeconds();
      var start = fitSegmentStart(choice.startSec, duration);
      if (!Number.isFinite(start)) throw new Error('CLIMAX_START_INVALID');
      var available = Math.max(0.12, duration ? duration - start : wanted);
      var segment = Math.min(wanted, available);
      state.startSec = start;
      state.segmentSec = segment;
      state.endSec = start + segment;
      state.sourceKind = choice.source || 'unknown';
      state.sourceUrl = source.audioUrl;
      await seekMedia(media, start, generation);
      if (Math.abs((Number(media.currentTime) || 0) - start) > 0.30) throw new Error('CLIMAX_SEEK_MISMATCH');
      if (typeof audioReady !== 'undefined' && !audioReady && typeof initAudio === 'function') initAudio();
      if (typeof resumeAudioAnalysis === 'function') await resumeAudioAnalysis();
      await media.play();
      if (generation !== state.generation || !state.holding) throw new Error('CLIMAX_CANCELLED');
      state.phase = 'playing';
      state.startedAt = performance.now();
      state.loopCount = 0;
      state.lastLoopAt = state.startedAt;
      if (typeof updatePlaybackProgressUi === 'function') updatePlaybackProgressUi();
      if (state.target) state.target.classList.add('lf-climax-active');
      logEvent('preview-start', {
        origin: state.origin,
        startSec: state.startSec,
        segmentSec: state.segmentSec,
        sourceKind: state.sourceKind,
        queueUnchanged: queueUnchanged(snapshot),
        mediaIdentity: String(media),
      });
      tickLoop();
    } catch (error) {
      classifyPreviewFailure(error, /TIMEOUT/.test(String(error && error.message)) ? 'timeout' : 'error');
      if (state.snapshot && generation === state.generation) await restoreSnapshot('preview-start-failed', true);
      throw error;
    }
  }
  function tickLoop() {
    cancelAnimationFrame(state.loopFrame);
    if (state.phase !== 'playing' || !state.holding || !audio) return;
    var media = audio;
    var remaining = state.endSec - (Number(media.currentTime) || 0);
    if (remaining <= 0.045 || media.ended) {
      var before = Number(media.currentTime) || 0;
      try {
        media.currentTime = state.startSec;
        if (media.paused) media.play().catch(function () {});
        state.loopCount += 1;
        var at = performance.now();
        logEvent('loop', {
          loop: state.loopCount,
          beforeSec: before,
          seekSec: state.startSec,
          wallIntervalMs: at - state.lastLoopAt,
          seekErrorSec: Math.abs((Number(media.currentTime) || state.startSec) - state.startSec),
        });
        state.lastLoopAt = at;
      } catch (error) {
        stop('loop-seek-failed', true);
        return;
      }
    }
    var elapsed = Math.max(0, (Number(media.currentTime) || state.startSec) - state.startSec);
    if (!state.statusFrame || performance.now() - state.statusFrame > 180) {
      state.statusFrame = performance.now();
      setChip('高潮预览 · ' + formatTime(elapsed) + ' / ' + formatTime(state.segmentSec) + ' · 第 ' + (state.loopCount + 1) + ' 轮', 'playing');
    }
    if (pageSignature() !== state.pageSignature) {
      stop('page-change', true);
      return;
    }
    state.loopFrame = requestAnimationFrame(tickLoop);
  }
  async function restoreSnapshot(reason, force) {
    var snapshot = state.snapshot;
    state.snapshot = null;
    if (!snapshot) return;
    var media = typeof audio !== 'undefined' ? audio : snapshot.media;
    var switchedTrack = typeof trackSwitchToken !== 'undefined' && trackSwitchToken !== snapshot.trackSwitchToken;
    if (!media || (switchedTrack && !force)) {
      if (global.LFAudioControls && typeof global.LFAudioControls.endTransientSource === 'function') {
        await global.LFAudioControls.endTransientSource(media);
      }
      restoreMainPlaybackFailurePolicy(snapshot, null);
      return;
    }
    try {
      media.pause();
      media.onended = snapshot.onended;
      media.onloadedmetadata = snapshot.onloadedmetadata;
      media.onerror = snapshot.onerror;
      media.loop = snapshot.loop;
      media.preload = snapshot.preload;
      media.crossOrigin = snapshot.crossOrigin;
      media.defaultPlaybackRate = snapshot.defaultPlaybackRate;
      media.playbackRate = snapshot.playbackRate;
      media.preservesPitch = snapshot.preservesPitch;
      media.volume = Number.isFinite(snapshot.volume) ? snapshot.volume : media.volume;
      media.muted = snapshot.muted;
      if (snapshot.src) {
        media.src = snapshot.src;
        media.load();
        await mediaEvent(media, ['loadedmetadata', 'canplay'], 16000, null);
        await seekMedia(media, snapshot.currentTime, null);
        if (!snapshot.paused) {
          if (typeof resumeAudioAnalysis === 'function') await resumeAudioAnalysis();
          await media.play();
        }
      } else {
        media.removeAttribute('src');
        media.load();
      }
      if (typeof playing !== 'undefined') playing = snapshot.playing && !snapshot.paused;
      if (typeof playToggleBusy !== 'undefined') playToggleBusy = snapshot.playToggleBusy;
      if (typeof activeRadioContext !== 'undefined') activeRadioContext = snapshot.activeRadioContext;
      if (snapshot.listenSession && snapshot.listenSession.ref && typeof listenSession !== 'undefined' && listenSession === snapshot.listenSession.ref) {
        listenSession.listenMs = snapshot.listenSession.listenMs;
        listenSession.maxProgress = snapshot.listenSession.maxProgress;
        listenSession.lastWallAt = now();
        listenSession.lastAudioTime = snapshot.currentTime;
      }
      if (typeof syncBeatMapPlaybackCursor === 'function') syncBeatMapPlaybackCursor(snapshot.currentTime, true);
      if (typeof updatePlaybackProgressUi === 'function') updatePlaybackProgressUi();
      if (typeof setPlayIcon === 'function') setPlayIcon(snapshot.playing && !snapshot.paused);
      if (typeof syncPlaybackStateFromAudioEvent === 'function') syncPlaybackStateFromAudioEvent('climax-preview-restore');
      restoreMainPlaybackFailurePolicy(snapshot, null);
      logEvent('context-restored', {
        reason: reason,
        srcRestored: String(media.currentSrc || media.src || '') === snapshot.src,
        timeErrorSec: Math.abs((Number(media.currentTime) || 0) - snapshot.currentTime),
        queueUnchanged: queueUnchanged(snapshot),
        indexUnchanged: typeof currentIdx === 'undefined' || currentIdx === snapshot.currentIdx,
        playingRestored: snapshot.paused ? media.paused : !media.paused,
      });
    } catch (error) {
      state.lastError = String(error && error.message || error);
      classifyPreviewFailure(error, /TIMEOUT/.test(state.lastError) ? 'timeout' : 'error');
      restoreMainPlaybackFailurePolicy(snapshot, error);
      console.warn('[ClimaxPreviewRestore]', error);
      logEvent('restore-error', { reason: reason, error: state.lastError });
    } finally {
      if (global.LFAudioControls && typeof global.LFAudioControls.endTransientSource === 'function') {
        try { await global.LFAudioControls.endTransientSource(media); } catch (_) {}
      }
    }
  }
  async function activate(generation) {
    if (generation !== state.generation || !state.holding || state.phase !== 'holding') return;
    state.phase = 'preparing';
    if (state.target) state.target.classList.add('lf-climax-active');
    setChip('正在定位并预载高潮 · ' + (state.song && (state.song.name || state.song.title) || '歌曲'), 'preparing');
    logEvent('prepare-start', { origin: state.origin });
    try {
      var source = await resolveSource(state.song);
      if (generation !== state.generation || !state.holding) return;
      var choice = await chooseStart(state.song, source, generation);
      if (generation !== state.generation || !state.holding) return;
      await beginMediaPreview(source, choice, generation);
    } catch (error) {
      if (generation !== state.generation || /CLIMAX_CANCELLED/.test(String(error && error.message))) return;
      state.lastError = String(error && error.message || error);
      console.warn('[ClimaxPreview]', error);
      logEvent('preview-error', { error: state.lastError });
      if (typeof showToast === 'function') showToast('高潮预览暂不可用：' + state.lastError);
      await stop('error', true);
    }
  }
  function begin(song, options) {
    options = options || {};
    if (!song || (!song.id && !song.localUrl && !song.url && !song.name)) return false;
    if (state.phase !== 'idle') {
      if (state.pointerId === options.pointerId && state.songKey === stableSongKey(song)) {
        logEvent('duplicate-pointerdown-ignored');
        return false;
      }
      logEvent('parallel-pointerdown-ignored', { pointerId: options.pointerId });
      return false;
    }
    state.generation += 1;
    state.phase = 'holding';
    state.pointerId = options.pointerId == null ? null : options.pointerId;
    state.song = song;
    state.songKey = stableSongKey(song);
    state.origin = options.origin || 'unknown';
    state.target = options.target || null;
    state.hitId = options.hitId || state.songKey;
    state.holding = true;
    state.pageSignature = pageSignature();
    state.lastError = '';
    state.startSec = 0;
    state.endSec = 0;
    state.segmentSec = 0;
    state.sourceKind = '';
    state.sourceUrl = '';
    state.loopCount = 0;
    if (state.target) state.target.classList.add('lf-climax-hold');
    var generation = state.generation;
    state.holdTimer = setTimeout(function () {
      state.holdTimer = 0;
      activate(generation);
    }, holdMs());
    logEvent('hold-start', { origin: state.origin, holdMs: holdMs(), pointerId: state.pointerId });
    return true;
  }
  async function stop(reason, restore) {
    reason = reason || 'cancel';
    if (state.phase === 'idle') return false;
    var wasLong = state.phase === 'preparing' || state.phase === 'playing' || !!state.snapshot;
    var target = state.target;
    state.holding = false;
    state.generation += 1;
    clearTimeout(state.holdTimer);
    state.holdTimer = 0;
    cancelAnimationFrame(state.loopFrame);
    state.loopFrame = 0;
    if (wasLong) state.suppressClickUntil = now() + 480;
    if (target) target.classList.remove('lf-climax-hold', 'lf-climax-active');
    hideChip();
    if (restore !== false && state.snapshot) await restoreSnapshot(reason, false);
    else if (state.snapshot) {
      var media = typeof audio !== 'undefined' ? audio : null;
      state.snapshot = null;
      if (global.LFAudioControls && typeof global.LFAudioControls.endTransientSource === 'function') {
        try { await global.LFAudioControls.endTransientSource(media); } catch (_) {}
      }
    }
    logEvent('preview-stop', { reason: reason, wasLong: wasLong, restored: restore !== false });
    state.phase = 'idle';
    state.pointerId = null;
    state.song = null;
    state.songKey = '';
    state.origin = '';
    state.target = null;
    state.hitId = '';
    state.startSec = 0;
    state.endSec = 0;
    state.segmentSec = 0;
    state.sourceKind = '';
    state.sourceUrl = '';
    if (typeof updatePlaybackProgressUi === 'function') updatePlaybackProgressUi();
    return true;
  }
  function consumeClick(event) {
    if (now() > state.suppressClickUntil) return false;
    state.suppressClickUntil = 0;
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    }
    logEvent('post-hold-click-suppressed');
    return true;
  }
  function songFromDom(target) {
    if (!target || !target.closest) return null;
    var actionButton = target.closest('.qi-act button,.mini-queue-remove,.song-action-btn,.add-btn,.queue-artist-link,.pl-detail-row-artist,[data-pl-detail-load-more],[data-pl-detail-play]');
    if (actionButton) return null;
    var row = target.closest('[data-pl-detail-row]');
    if (row) {
      var detailIndex = Number(row.getAttribute('data-pl-detail-row'));
      var detailSong = typeof playlistPanelDetailState !== 'undefined' && playlistPanelDetailState.tracks && playlistPanelDetailState.tracks[detailIndex];
      return detailSong ? { song: detailSong, target: row, origin: 'main-playlist-detail', hitId: 'detail:' + detailIndex + ':' + stableSongKey(detailSong) } : null;
    }
    var queueRow = target.closest('.queue-item');
    if (queueRow) {
      var queueNodes = Array.prototype.filter.call(queueRow.parentNode.children, function (node) { return node.classList && node.classList.contains('queue-item'); });
      var queueIndex = queueRow.hasAttribute('data-queue-index') ? Number(queueRow.getAttribute('data-queue-index')) : queueNodes.indexOf(queueRow);
      var queueSong = typeof playQueue !== 'undefined' && playQueue[queueIndex];
      return queueSong ? { song: queueSong, target: queueRow, origin: 'main-queue', hitId: 'queue:' + queueIndex + ':' + stableSongKey(queueSong) } : null;
    }
    var miniRow = target.closest('.mini-queue-item');
    if (miniRow) {
      var miniNodes = Array.prototype.filter.call(miniRow.parentNode.children, function (node) { return node.classList && node.classList.contains('mini-queue-item'); });
      var miniIndex = miniRow.hasAttribute('data-queue-index') ? Number(miniRow.getAttribute('data-queue-index')) : miniNodes.indexOf(miniRow);
      var miniSong = typeof playQueue !== 'undefined' && playQueue[miniIndex];
      return miniSong ? { song: miniSong, target: miniRow, origin: 'mini-queue', hitId: 'mini:' + miniIndex + ':' + stableSongKey(miniSong) } : null;
    }
    var searchRow = target.closest('.search-result');
    if (searchRow) {
      var playNode = searchRow.querySelector('[onclick*="playSearchResult"]');
      var match = playNode && String(playNode.getAttribute('onclick') || '').match(/playSearchResult\((\d+)\)/);
      var searchIndex = match ? Number(match[1]) : -1;
      var searchSong = typeof playlist !== 'undefined' && playlist[searchIndex];
      return searchSong ? { song: searchSong, target: searchRow, origin: 'search-results', hitId: 'search:' + searchIndex + ':' + stableSongKey(searchSong) } : null;
    }
    var homeCard = target.closest('.home-card[onclick*="playHomeSong"]');
    if (homeCard) {
      var homeMatch = String(homeCard.getAttribute('onclick') || '').match(/playHomeSong\((\d+)\)/);
      var homeIndex = homeMatch ? Number(homeMatch[1]) : -1;
      var homeSong = typeof homeDiscoverState !== 'undefined' && homeDiscoverState.songs && homeDiscoverState.songs[homeIndex];
      return homeSong ? { song: homeSong, target: homeCard, origin: 'home-song-card', hitId: 'home:' + homeIndex + ':' + stableSongKey(homeSong) } : null;
    }
    return null;
  }
  function shelfSongAtPointer(event) {
    try {
      if (!event || !shelfManager || !renderer || event.target !== renderer.domElement) return null;
      var rc = typeof raycasterFromPointerEvent === 'function' ? raycasterFromPointerEvent(event) : null;
      if (!rc) return null;
      if (shelfManager.hasOpenContent && shelfManager.hasOpenContent()) {
        var content = shelfManager.getContentList && shelfManager.getContentList();
        if (!content) return null;
        var rowHit = content.pickRowAtScreen ? content.pickRowAtScreen(event.clientX, event.clientY) : null;
        if (!rowHit && content.raycastRows) rowHit = content.raycastRows(rc);
        var row = rowHit && rowHit.row;
        if (!row || !row.song || row.song.type === 'podcast-radio' || (!row.song.id && !row.song.localUrl)) return null;
        return {
          song: row.song,
          target: renderer.domElement,
          origin: '3d-playlist-row',
          hitId: '3d-row:' + row.index + ':' + stableSongKey(row.song),
        };
      }
      var hit = typeof pointerCardHit === 'function' ? pointerCardHit(rc, event) : shelfManager.raycastCards(rc);
      var card = hit && hit.card;
      if (!card || !card.item || card.item.type !== 'queue') return null;
      var action = card.mesh && card.mesh.userData && card.mesh.userData.action;
      var index = action && action.kind === 'playQueue' ? Number(action.index) : Number(card.item.queueIndex);
      var song = typeof playQueue !== 'undefined' && playQueue[index];
      return song ? {
        song: song,
        target: renderer.domElement,
        origin: '3d-queue-card',
        hitId: '3d-card:' + card.index + ':' + stableSongKey(song),
      } : null;
    } catch (error) {
      console.warn('[ClimaxPreviewShelfHit]', error);
      return null;
    }
  }
  function onPointerDown(event) {
    if (!event || event.button !== 0 || event.isPrimary === false) return;
    var match = songFromDom(event.target) || shelfSongAtPointer(event);
    if (!match) return;
    begin(match.song, {
      pointerId: event.pointerId,
      target: match.target,
      origin: match.origin,
      hitId: match.hitId,
    });
  }
  function onPointerMove(event) {
    if (state.phase === 'idle' || !state.holding || event.pointerId !== state.pointerId) return;
    if (state.origin.indexOf('3d-') === 0) {
      if (typeof mouseDownAt !== 'undefined' && mouseDownAt.hadDrag) {
        stop('pointer-drag', true);
        return;
      }
      var match = shelfSongAtPointer(event);
      if (!match || match.hitId !== state.hitId) stop('pointer-leave-song', true);
      return;
    }
    if (state.target) {
      var rect = state.target.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
        stop('pointer-leave-song', true);
      }
    }
  }
  function onPointerEnd(event) {
    if (state.phase === 'idle') return;
    if (event && state.pointerId != null && event.pointerId != null && event.pointerId !== state.pointerId) return;
    if (state.phase === 'preparing' || state.phase === 'playing') {
      if (typeof mouseDownAt !== 'undefined') mouseDownAt.hadDrag = true;
    }
    stop(event && event.type === 'pointercancel' ? 'pointer-cancel' : 'pointer-release', true);
  }
  function installEvents() {
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    global.addEventListener('pointerup', onPointerEnd, true);
    global.addEventListener('pointercancel', onPointerEnd, true);
    global.addEventListener('blur', function () { if (state.phase !== 'idle') stop('window-blur', true); });
    global.addEventListener('pagehide', function () { if (state.phase !== 'idle') stop('page-hide', true); });
    global.addEventListener('hashchange', function () { if (state.phase !== 'idle') stop('page-change', true); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && state.phase !== 'idle') stop('document-hidden', true);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && state.phase !== 'idle') {
        event.preventDefault();
        stop('explicit-cancel', true);
      }
    }, true);
    document.addEventListener('click', function (event) {
      consumeClick(event);
    }, true);
  }

  var api = {
    version: VERSION,
    begin: begin,
    stop: function (reason, options) {
      options = options || {};
      return stop(reason || 'api-cancel', options.restore !== false);
    },
    consumeClick: consumeClick,
    isTransientActive: function () { return state.phase === 'preparing' || state.phase === 'playing'; },
    isHolding: function () { return state.phase !== 'idle'; },
    status: function () {
      return {
        version: VERSION,
        phase: state.phase,
        generation: state.generation,
        origin: state.origin,
        songKey: state.songKey,
        holding: state.holding,
        startSec: state.startSec,
        endSec: state.endSec,
        segmentSec: state.segmentSec,
        loopCount: state.loopCount,
        sourceKind: state.sourceKind,
        lastError: state.lastError,
        queueUnchanged: state.snapshot ? queueUnchanged(state.snapshot) : true,
        eventCount: state.events.length,
      };
    },
    diagnostics: function () {
      return {
        status: this.status(),
        events: state.events.slice(),
        cacheKeys: Object.keys(analysisCache),
        audioIdentity: typeof audio !== 'undefined' && audio ? String(audio) : '',
        queueKeys: typeof playQueue !== 'undefined' ? playQueue.map(stableSongKey) : [],
        currentIdx: typeof currentIdx !== 'undefined' ? currentIdx : -1,
      };
    },
    getKnownStart: getKnownStart,
    ensureStart: ensureStart,
    songKey: stableSongKey,
    getMarkerOwner: function () {
      if (!state.holding || (state.phase !== 'preparing' && state.phase !== 'playing') || !state.song) return null;
      return {
        song:state.song,
        songKey:state.songKey,
        startSec:Number.isFinite(state.startSec) && state.startSec >= MIN_CLIMAX_START_SECONDS ? state.startSec : null,
        duration:durationSeconds(typeof audio !== 'undefined' && audio ? audio.duration : 0) || songDuration(state.song),
        source:state.sourceKind || ''
      };
    },
    computePlatformStart: platformClimaxStart,
    computeBeatMapStart: beatMapClimaxStart,
    analyzeAudioForClimax: function (url, duration) {
      state.generation += 1;
      state.holding = true;
      return analyzeAudioForClimax(url, duration, state.generation).finally(function () { state.holding = false; });
    },
    resolveDomSong: songFromDom,
    resolveShelfSong: shelfSongAtPointer,
    clearAnalysisCache: function () {
      analysisCache = {};
      try { localStorage.removeItem(CACHE_KEY); } catch (_) {}
    },
  };
  global.LumiFieldClimaxPreview = Object.freeze(api);
  installEvents();
})(window);
