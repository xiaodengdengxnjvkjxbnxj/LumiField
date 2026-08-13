(function (global) {
  'use strict';

  var existing = global.LFPlaybackFailureCoordinator;
  if (existing && existing.__lumifieldPlaybackFailureCoordinator === true) {
    global.PlaybackFailureCoordinator = existing;
    global.LumiFieldPlaybackFailureCoordinator = existing;
    return;
  }

  var VERSION = '1.0.0';
  var HTTP_REFRESH_STATUSES = { 401: true, 403: true, 404: true, 410: true, 416: true };
  var DEFAULTS = {
    maxRefreshAttempts: 1,
    loadTimeoutMs: 20000,
    stallTimeoutMs: 8000,
    navigationTimeoutMs: 5000,
    refreshTimeoutMs: 20000,
    sourceAbortGraceMs: 350
  };
  var CALLBACK_NAMES = [
    'getQueueSnapshot', 'getTrackKey', 'inspectFailure', 'refreshSource', 'applyRefreshedSource',
    'advance', 'stop', 'onTrackFailed', 'onExhausted', 'onPolicyBlocked',
    'onStateChange', 'log'
  ];

  function noop() {}
  function own(value, key) { return Object.prototype.hasOwnProperty.call(value || {}, key); }
  function text(value) { return String(value == null ? '' : value).trim(); }
  function finite(value, fallback) { value = Number(value); return isFinite(value) ? value : fallback; }
  function clampInt(value, fallback, min, max) {
    value = Math.floor(finite(value, fallback));
    return Math.max(min, Math.min(max, value));
  }
  function dict() { return Object.create ? Object.create(null) : {}; }
  function dictKey(value) { return '$' + text(value); }
  function promise(value) { return Promise.resolve(value); }
  function lower(value) { return text(value).toLowerCase(); }
  function safeErrorMessage(error) { return text(error && error.message ? error.message : error); }
  function safeCall(fn, payload, fallback) {
    try { return fn(payload); }
    catch (error) { return fallback; }
  }
  function sameUrl(left, right) {
    left = text(left);
    right = text(right);
    if (!left || !right) return true;
    try { return new URL(left, global.location && global.location.href).href === new URL(right, global.location && global.location.href).href; }
    catch (_) { return left === right; }
  }
  function supportedMime(value) {
    value = lower(value).split(';')[0].trim();
    if (!value) return true;
    if (value.indexOf('audio/') === 0) return true;
    if (value === 'video/mp4' || value === 'video/webm') return true;
    return value === 'application/octet-stream' ||
      value === 'binary/octet-stream' ||
      value === 'application/mp4' ||
      value === 'application/x-m4a' ||
      value === 'application/flac' ||
      value === 'application/x-flac' ||
      value === 'application/ogg' ||
      value === 'application/vnd.apple.mpegurl' ||
      value === 'application/x-mpegurl' ||
      value === 'application/mpegurl' ||
      value === 'application/dash+xml';
  }
  function responseValue(details, name) {
    var response = details && details.response;
    if (own(details, name)) return details[name];
    if (response && own(response, name)) return response[name];
    return null;
  }
  function responseHeader(details, name) {
    var response = details && details.response;
    var headers = response && response.headers;
    if (!headers || typeof headers.get !== 'function') return '';
    try { return headers.get(name) || ''; }
    catch (_) { return ''; }
  }
  function mediaErrorCode(details) {
    var mediaError = details && (details.mediaError || (details.media && details.media.error));
    var value = details && details.mediaCode;
    if (value == null && mediaError) value = mediaError.code;
    value = Number(value);
    return isFinite(value) ? value : 0;
  }
  function errorName(details) {
    var error = details && details.error;
    return text(details && details.errorName ? details.errorName : error && error.name);
  }
  function errorMessage(details) {
    var error = details && details.error;
    var mediaError = details && (details.mediaError || (details.media && details.media.error));
    return text(details && details.message ? details.message :
      error && error.message ? error.message :
      mediaError && mediaError.message ? mediaError.message : error);
  }
  function result(type, code, refreshable, autoSkip, ignored, message) {
    return {
      type: type,
      code: code,
      refreshable: refreshable === true,
      autoSkip: autoSkip === true,
      ignored: ignored === true,
      message: message || code
    };
  }

  function classifyFailure(details) {
    details = details || {};
    var name = errorName(details);
    var message = errorMessage(details);
    var joined = lower(name + ' ' + message + ' ' + text(details.reason));
    var eventType = lower(details.eventType || details.type);
    var status = Number(responseValue(details, 'status')) || 0;
    var mime = text(responseValue(details, 'mime') || responseValue(details, 'contentType') || responseHeader(details, 'content-type'));
    var contentLength = responseValue(details, 'contentLength');
    if (contentLength == null) contentLength = responseHeader(details, 'content-length');
    var bodyLength = responseValue(details, 'bodyLength');
    var code = mediaErrorCode(details);

    if (details.userPaused === true || details.manualPause === true || eventType === 'user-pause') {
      return result('user-action', 'USER_PAUSED', false, false, true, '用户已手动暂停');
    }
    if (name === 'NotAllowedError' || joined.indexOf('notallowederror') >= 0 || details.policyBlocked === true) {
      return result('policy', 'PLAYBACK_NOT_ALLOWED', false, false, false, '播放需要用户操作');
    }
    if (HTTP_REFRESH_STATUSES[status]) {
      return result('http', 'HTTP_' + status, true, true, false, '音源请求返回 HTTP ' + status);
    }
    if (status >= 400) {
      return result('http', 'HTTP_' + status, status >= 500, true, false, '音源请求返回 HTTP ' + status);
    }
    if (status === 204 || details.empty === true || details.emptyResponse === true ||
        (bodyLength != null && Number(bodyLength) === 0) ||
        (contentLength !== '' && contentLength != null && Number(contentLength) === 0)) {
      return result('response', 'EMPTY_RESPONSE', true, true, false, '音源响应为空');
    }
    if (mime && !supportedMime(mime)) {
      return result('response', 'INVALID_AUDIO_MIME', true, true, false, '音源响应类型不是可播放音频');
    }
    if (details.unsupported === true || details.supported === false || code === 4 ||
        name === 'NotSupportedError' || joined.indexOf('not supported') >= 0 ||
        joined.indexOf('src_not_supported') >= 0 || joined.indexOf('unsupported format') >= 0 ||
        eventType === 'unsupported' || eventType === 'unsupported-format') {
      return result('format', 'UNSUPPORTED_FORMAT', true, true, false, '当前音源格式不受支持');
    }
    if (details.decodeFailed === true || code === 3 || name === 'EncodingError' ||
        joined.indexOf('decode') >= 0 || joined.indexOf('decoder') >= 0 || joined.indexOf('media_err_decode') >= 0) {
      return result('decode', 'DECODE_FAILED', true, true, false, '音源解码失败');
    }
    if (details.timedOut === true || name === 'TimeoutError' || joined.indexOf('timeout') >= 0 ||
        joined.indexOf('timed out') >= 0 || eventType === 'timeout') {
      return result('timeout', 'PLAYBACK_TIMEOUT', true, true, false, '音源加载超时');
    }
    if (eventType === 'stalled') {
      return result('stall', 'PLAYBACK_STALLED', true, true, false, '音源加载停滞');
    }
    if (eventType === 'abort' || name === 'AbortError' || code === 1 || joined.indexOf('media_err_aborted') >= 0) {
      return result('abort', 'LOAD_ABORTED', true, true, false, '音源加载被中止');
    }
    if (code === 2 || eventType === 'error' || eventType === 'load-error') {
      return result('network', 'MEDIA_NETWORK_ERROR', true, true, false, '音源网络加载失败');
    }
    if (eventType === 'load') {
      return result('load', 'LOAD_FAILED', true, true, false, '音源加载失败');
    }
    return result('unknown', 'PLAYBACK_FAILED', true, true, false, message || '歌曲播放失败');
  }

  var config = {
    maxRefreshAttempts: DEFAULTS.maxRefreshAttempts,
    loadTimeoutMs: DEFAULTS.loadTimeoutMs,
    stallTimeoutMs: DEFAULTS.stallTimeoutMs,
    navigationTimeoutMs: DEFAULTS.navigationTimeoutMs,
    refreshTimeoutMs: DEFAULTS.refreshTimeoutMs,
    sourceAbortGraceMs: DEFAULTS.sourceAbortGraceMs,
    getQueueSnapshot: function () { return []; },
    getTrackKey: null,
    inspectFailure: null,
    refreshSource: null,
    applyRefreshedSource: null,
    advance: null,
    stop: noop,
    onTrackFailed: noop,
    onExhausted: noop,
    onPolicyBlocked: noop,
    onStateChange: noop,
    log: noop
  };
  var state = {
    generation: 0,
    roundSequence: 0,
    continuationSequence: 0,
    active: null,
    round: null,
    media: null,
    handlers: null,
    loadTimer: null,
    stallTimer: null,
    navigationTimer: null,
    refreshAbort: null,
    suppressAbortUntil: 0,
    destroyed: false
  };

  function log(level, label, detail) {
    safeCall(config.log, { level: level, label: label, detail: detail }, null);
  }
  function notify(reason) {
    safeCall(config.onStateChange, { reason: reason, state: snapshot() }, null);
  }
  function clearTimer(name) {
    if (state[name] != null) global.clearTimeout(state[name]);
    state[name] = null;
  }
  function clearLoadTimers() {
    clearTimer('loadTimer');
    clearTimer('stallTimer');
  }
  function abortRefresh() {
    var controller = state.refreshAbort;
    state.refreshAbort = null;
    if (controller && typeof controller.abort === 'function') {
      try { controller.abort(); } catch (_) {}
    }
  }
  function currentIdentity(active) {
    active = active || state.active;
    return active ? {
      generation: active.generation,
      trackKey: active.trackKey,
      itemKey: active.itemKey,
      index: active.index,
      sourceRevision: active.sourceRevision
    } : null;
  }
  function identityMatches(details, active) {
    active = active || state.active;
    if (!active) return false;
    details = details || {};
    if (details.generation != null && Number(details.generation) !== active.generation) return false;
    if (details.trackKey != null && text(details.trackKey) !== active.trackKey) return false;
    if (details.itemKey != null && text(details.itemKey) !== active.itemKey) return false;
    if (details.sourceRevision != null && Number(details.sourceRevision) !== active.sourceRevision) return false;
    if (details.sourceUrl && active.sourceUrl && !sameUrl(details.sourceUrl, active.sourceUrl)) return false;
    return true;
  }
  function deriveTrackKey(track, index, explicit) {
    explicit = text(explicit);
    if (explicit) return explicit;
    if (typeof config.getTrackKey === 'function') {
      var injected = text(safeCall(config.getTrackKey, { track: track, index: index }, ''));
      if (injected) return injected;
    }
    track = track || {};
    if (typeof track === 'string' || typeof track === 'number') return text(track);
    var provider = text(track.provider || track.platform || track.sourceProvider || track.source || 'unknown');
    var id = text(track.id || track.songId || track.trackId || track.mid || track.rid || track.hash || track.audioId);
    if (id) return provider + ':' + id;
    return provider + ':' + text(track.name || track.title) + ':' + text(track.artist || track.singer) + ':' + text(track.duration);
  }
  function queueInput(context) {
    if (context && Array.isArray(context.queueItems)) return context.queueItems;
    if (context && Array.isArray(context.queue)) return context.queue;
    var value = safeCall(config.getQueueSnapshot, { context: context || null }, []);
    return Array.isArray(value) ? value : [];
  }
  function normalizeQueue(context) {
    var raw = queueInput(context);
    var items = [];
    var i;
    for (i = 0; i < raw.length; i++) {
      var entry = raw[i];
      var track = entry && typeof entry === 'object' && own(entry, 'track') ? entry.track : entry;
      var index = entry && typeof entry === 'object' && entry.index != null ? Number(entry.index) : i;
      if (!isFinite(index)) index = i;
      var trackKey = deriveTrackKey(track, index, entry && typeof entry === 'object' ? entry.trackKey : '');
      var suppliedItemKey = entry && typeof entry === 'object' ? (entry.itemKey || entry.queueItemKey) : '';
      var itemKey = text(suppliedItemKey) || (String(index) + '|' + trackKey);
      items.push({ index: index, itemKey: itemKey, trackKey: trackKey, track: track });
    }
    return items;
  }
  function queueFingerprint(items) {
    var values = [], i;
    for (i = 0; i < items.length; i++) values.push(items[i].itemKey);
    return values.join('\u001e');
  }
  function findQueuePosition(items, itemKey, index) {
    var i;
    for (i = 0; i < items.length; i++) if (items[i].itemKey === itemKey) return i;
    for (i = 0; i < items.length; i++) if (items[i].index === index) return i;
    return -1;
  }
  function buildActive(context, items) {
    context = context || {};
    var index = finite(context.index, 0);
    var track = context.track || null;
    var trackKey = deriveTrackKey(track, index, context.trackKey);
    var itemKey = text(context.itemKey || context.queueItemKey) || (String(index) + '|' + trackKey);
    return {
      generation: ++state.generation,
      trackKey: trackKey,
      itemKey: itemKey,
      index: index,
      track: track,
      queueItems: items,
      queueFingerprint: queueFingerprint(items),
      sourceUrl: text(context.sourceUrl),
      sourceMime: text(context.mime || context.contentType),
      sourceRevision: 0,
      refreshAttempts: 0,
      handledRevisions: dict(),
      inspectionRevisions: dict(),
      inspectionOperations: dict(),
      userPaused: false,
      started: false,
      committed: false,
      policyBlocked: false,
      policyNotified: false
    };
  }
  function newRound(active) {
    var items = active.queueItems.slice(0);
    if (!items.length) {
      items.push({ index: active.index, itemKey: active.itemKey, trackKey: active.trackKey, track: active.track });
    }
    return {
      id: ++state.roundSequence,
      fingerprint: queueFingerprint(items),
      items: items,
      failed: dict(),
      failedCount: 0,
      expected: null,
      advancePending: false,
      exhausted: false,
      exhaustedNotified: false
    };
  }
  function tagMedia(active) {
    var media = state.media;
    if (!media || !active) return;
    try {
      media.__lfPlaybackFailureGeneration = active.generation;
      media.__lfPlaybackFailureSourceRevision = active.sourceRevision;
    } catch (_) {}
  }
  function beginTrack(context) {
    context = context || {};
    clearLoadTimers();
    clearTimer('navigationTimer');
    abortRefresh();
    var items = normalizeQueue(context);
    var active = buildActive(context, items);
    var continuation = text(context.continuation || context.failureContinuation);
    var round = state.round;
    var expected = round && round.expected;
    var continuationValid = !!(continuation && expected && expected.token === continuation && expected.itemKey === active.itemKey &&
      round && round.fingerprint === active.queueFingerprint);
    if (continuationValid) {
      round.expected = null;
      round.advancePending = false;
      active.queueItems = round.items.slice(0);
      active.queueFingerprint = round.fingerprint;
    } else {
      round = newRound(active);
    }
    state.round = round;
    state.active = active;
    state.suppressAbortUntil = Date.now() + config.sourceAbortGraceMs;
    notify(continuationValid ? 'track-continued' : 'track-begin');
    return currentIdentity(active);
  }
  function setSource(details) {
    details = details || {};
    var active = state.active;
    if (!identityMatches(details, active)) return false;
    active.sourceUrl = text(details.url || details.sourceUrl);
    active.sourceMime = text(details.mime || details.contentType);
    active.sourceRevision++;
    active.started = false;
    active.userPaused = false;
    active.policyBlocked = false;
    active.policyNotified = false;
    state.suppressAbortUntil = Date.now() + config.sourceAbortGraceMs;
    tagMedia(active);
    armLoadTimeout(active);
    notify('source-set');
    return currentIdentity(active);
  }
  function armLoadTimeout(active) {
    clearTimer('loadTimer');
    if (!active || active.userPaused || active.started || config.loadTimeoutMs <= 0) return;
    var identity = currentIdentity(active);
    state.loadTimer = global.setTimeout(function () {
      state.loadTimer = null;
      if (!identityMatches(identity)) return;
      reportFailure({
        generation: identity.generation,
        trackKey: identity.trackKey,
        itemKey: identity.itemKey,
        sourceRevision: identity.sourceRevision,
        type: 'timeout',
        timedOut: true,
        phase: 'load'
      });
    }, config.loadTimeoutMs);
  }
  function armStallTimeout(active) {
    clearTimer('stallTimer');
    if (!active || active.userPaused || config.stallTimeoutMs <= 0) return;
    var identity = currentIdentity(active);
    state.stallTimer = global.setTimeout(function () {
      state.stallTimer = null;
      if (!identityMatches(identity)) return;
      reportFailure({
        generation: identity.generation,
        trackKey: identity.trackKey,
        itemKey: identity.itemKey,
        sourceRevision: identity.sourceRevision,
        type: 'stalled',
        eventType: 'stalled'
      });
    }, config.stallTimeoutMs);
  }
  function markProgress(details) {
    if (!identityMatches(details || {})) return false;
    if (state.active.userPaused) return false;
    clearLoadTimers();
    state.active.started = true;
    state.active.userPaused = false;
    state.active.policyBlocked = false;
    state.round = null;
    notify('playback-progress');
    return true;
  }
  function markUserPause(details) {
    if (!identityMatches(details || {})) return false;
    state.active.userPaused = true;
    clearLoadTimers();
    abortRefresh();
    notify('user-pause');
    return true;
  }
  function markUserResume(details) {
    if (!identityMatches(details || {})) return false;
    if (details && details.restartFailed === true && state.active.committed) {
      state.active.committed = false;
      state.active.refreshAttempts = 0;
      state.active.handledRevisions = dict();
      state.active.inspectionRevisions = dict();
      state.active.inspectionOperations = dict();
      state.round = newRound(state.active);
    }
    state.active.userPaused = false;
    state.active.policyBlocked = false;
    state.active.policyNotified = false;
    delete state.active.handledRevisions[dictKey(state.active.sourceRevision)];
    delete state.active.inspectionRevisions[dictKey(state.active.sourceRevision)];
    delete state.active.inspectionOperations[dictKey(state.active.sourceRevision)];
    if (!state.active.started) armLoadTimeout(state.active);
    notify('user-resume');
    return true;
  }
  function makeAbortController() {
    if (typeof global.AbortController === 'function') {
      try { return new global.AbortController(); } catch (_) {}
    }
    return null;
  }
  function refreshResolutionValid(value, active) {
    var resolution = typeof value === 'string' ? { url: value } : (value || {});
    var responseDetails = {
      response: resolution.response,
      status: resolution.status,
      mime: resolution.mime || resolution.contentType,
      contentLength: resolution.contentLength,
      bodyLength: resolution.bodyLength,
      empty: resolution.empty
    };
    var classification = classifyFailure(responseDetails);
    var status = Number(responseValue(responseDetails, 'status')) || 0;
    var hasResponseFailure = status >= 400 || classification.code === 'EMPTY_RESPONSE' || classification.code === 'INVALID_AUDIO_MIME';
    var url = text(resolution.url || resolution.sourceUrl);
    if (!url) return { ok: false, classification: result('response', 'EMPTY_RESPONSE', false, true, false, '刷新后的音源地址为空') };
    if (hasResponseFailure) return { ok: false, classification: classification };
    if (active.sourceUrl && sameUrl(url, active.sourceUrl) && resolution.revalidated !== true) {
      return { ok: false, classification: result('response', 'UNCHANGED_SOURCE_URL', false, true, false, '刷新后的音源地址未变化') };
    }
    return { ok: true, resolution: resolution, url: url };
  }
  function failurePayload(active, classification, extra) {
    var payload = {
      generation: active.generation,
      trackKey: active.trackKey,
      itemKey: active.itemKey,
      index: active.index,
      track: active.track,
      sourceUrl: active.sourceUrl,
      sourceRevision: active.sourceRevision,
      classification: classification,
      refreshAttempt: active.refreshAttempts,
      maxRefreshAttempts: config.maxRefreshAttempts
    };
    var key;
    for (key in extra) if (own(extra, key)) payload[key] = extra[key];
    return payload;
  }
  function invokeRefresh(active, classification) {
    active.refreshAttempts++;
    abortRefresh();
    var controller = makeAbortController();
    state.refreshAbort = controller;
    var identity = currentIdentity(active);
    var payload = failurePayload(active, classification, {
      signal: controller ? controller.signal : null
    });
    var refresh;
    try { refresh = config.refreshSource(payload); }
    catch (error) { refresh = Promise.reject(error); }
    var refreshTimer = null;
    var refreshDeadline = new Promise(function (_, reject) {
      refreshTimer = global.setTimeout(function () {
        if (controller && typeof controller.abort === 'function') {
          try { controller.abort(); } catch (_) {}
        }
        var error = new Error('PLAYBACK_SOURCE_REFRESH_TIMEOUT');
        error.name = 'TimeoutError';
        reject(error);
      }, config.refreshTimeoutMs);
    });
    return Promise.race([promise(refresh), refreshDeadline]).then(function (value) {
      if (!identityMatches(identity, active) || state.active !== active) return { action: 'stale' };
      if (active.userPaused) return { action: 'ignored', reason: 'USER_PAUSED' };
      var checked = refreshResolutionValid(value, active);
      if (!checked.ok) return commitFailedTrack(active, checked.classification);
      var oldUrl = active.sourceUrl;
      active.sourceUrl = checked.url;
      active.sourceMime = text(checked.resolution.mime || checked.resolution.contentType);
      active.sourceRevision++;
      active.started = false;
      state.suppressAbortUntil = Date.now() + config.sourceAbortGraceMs;
      tagMedia(active);
      var applyPayload = failurePayload(active, classification, {
        oldUrl: oldUrl,
        url: checked.url,
        resolution: checked.resolution,
        signal:controller ? controller.signal : null
      });
      var applied;
      try { applied = config.applyRefreshedSource(applyPayload); }
      catch (error) { applied = Promise.reject(error); }
      return promise(applied).then(function (accepted) {
        if (!identityMatches({ generation: active.generation, trackKey: active.trackKey, itemKey: active.itemKey }, active) || state.active !== active) {
          return { action: 'stale' };
        }
        if (active.userPaused || accepted && accepted.ignored === true) return { action: 'ignored', reason: 'USER_PAUSED' };
        if (accepted === false || (accepted && accepted.accepted === false)) {
          return commitFailedTrack(active, result('retry', 'REFRESH_APPLY_REJECTED', false, true, false, '刷新后的音源未被播放器接受'));
        }
        armLoadTimeout(active);
        notify('source-refreshed');
        return {
          action: 'retry',
          generation: active.generation,
          trackKey: active.trackKey,
          itemKey: active.itemKey,
          sourceRevision: active.sourceRevision,
          refreshAttempt: active.refreshAttempts,
          url: checked.url
        };
      }, function (error) {
        if (state.active !== active) return { action: 'stale' };
        if (active.userPaused) return { action: 'ignored', reason: 'USER_PAUSED' };
        log('warn', 'apply-refreshed-source-failed', error);
        return commitFailedTrack(active, classifyFailure({ error: error }));
      });
    }, function (error) {
      if (state.active !== active || !identityMatches(identity, active)) return { action: 'stale' };
      if (active.userPaused) return { action: 'ignored', reason: 'USER_PAUSED' };
      log('warn', 'refresh-source-failed', error);
      return commitFailedTrack(active, classifyFailure({ error: error }));
    }).then(function (value) {
      if (refreshTimer) global.clearTimeout(refreshTimer);
      if (state.refreshAbort === controller) state.refreshAbort = null;
      return value;
    }, function (error) {
      if (refreshTimer) global.clearTimeout(refreshTimer);
      if (state.refreshAbort === controller) state.refreshAbort = null;
      throw error;
    });
  }
  function nextCandidate(round, active) {
    var items = round.items;
    var start = findQueuePosition(items, active.itemKey, active.index);
    if (start < 0) start = 0;
    var step, item;
    for (step = 1; step <= items.length; step++) {
      item = items[(start + step) % items.length];
      if (!round.failed[dictKey(item.itemKey)]) return item;
    }
    return null;
  }
  function markRoundItemFailed(round, item, classification) {
    var key = dictKey(item.itemKey);
    if (round.failed[key]) return false;
    round.failed[key] = classification || true;
    round.failedCount++;
    return true;
  }
  function exhaustRound(round, active, classification) {
    if (!round || round.exhausted) return promise({ action: 'exhausted', duplicate: true });
    round.exhausted = true;
    clearLoadTimers();
    clearTimer('navigationTimer');
    abortRefresh();
    var payload = failurePayload(active, classification, {
      action: 'exhausted',
      roundId: round.id,
      failedCount: round.failedCount,
      queueLength: round.items.length
    });
    safeCall(config.stop, payload, null);
    if (!round.exhaustedNotified) {
      round.exhaustedNotified = true;
      safeCall(config.onExhausted, payload, null);
    }
    notify('queue-exhausted');
    return promise(payload);
  }
  function scheduleNextCandidate(round, active, classification) {
    var candidate = nextCandidate(round, active);
    if (!candidate) return exhaustRound(round, active, classification);
    var token = 'lfpf:' + round.id + ':' + (++state.continuationSequence) + ':' + candidate.itemKey;
    round.expected = { token: token, itemKey: candidate.itemKey, index: candidate.index };
    round.advancePending = true;
    var payload = failurePayload(active, classification, {
      action: 'advance',
      roundId: round.id,
      continuation: token,
      fromIndex: active.index,
      nextIndex: candidate.index,
      nextItemKey: candidate.itemKey,
      nextTrackKey: candidate.trackKey,
      nextTrack: candidate.track,
      failedCount: round.failedCount,
      queueLength: round.items.length
    });
    global.setTimeout(function () {
      if (state.round !== round || round.exhausted || !round.expected || round.expected.token !== token) return;
      var advanced;
      try { advanced = config.advance ? config.advance(payload) : false; }
      catch (error) { advanced = Promise.reject(error); }
      promise(advanced).then(function (accepted) {
        if (state.round !== round || !round.expected || round.expected.token !== token) return;
        if (accepted === false || (accepted && accepted.accepted === false)) {
          round.advancePending = false;
          round.expected = null;
          markRoundItemFailed(round, candidate, result('navigation', 'ADVANCE_REJECTED', false, true, false, '下一首未被播放器接受'));
          scheduleNextCandidate(round, active, classification);
          return;
        }
        clearTimer('navigationTimer');
        state.navigationTimer = global.setTimeout(function () {
          state.navigationTimer = null;
          if (state.round !== round || !round.expected || round.expected.token !== token) return;
          round.advancePending = false;
          round.expected = null;
          markRoundItemFailed(round, candidate, result('navigation', 'ADVANCE_TIMEOUT', false, true, false, '下一首未在限定时间内开始加载'));
          scheduleNextCandidate(round, active, classification);
        }, config.navigationTimeoutMs);
      }, function (error) {
        if (state.round !== round || !round.expected || round.expected.token !== token) return;
        log('warn', 'advance-failed', error);
        round.advancePending = false;
        round.expected = null;
        markRoundItemFailed(round, candidate, classifyFailure({ error: error }));
        scheduleNextCandidate(round, active, classification);
      });
    }, 0);
    notify('track-advance-scheduled');
    return promise(payload);
  }
  function commitFailedTrack(active, classification) {
    if (state.active !== active) return promise({ action: 'stale' });
    if (active.committed) return promise({ action: 'already-failed', generation: active.generation, itemKey: active.itemKey });
    active.committed = true;
    clearLoadTimers();
    abortRefresh();
    var round = state.round || newRound(active);
    state.round = round;
    markRoundItemFailed(round, {
      itemKey: active.itemKey,
      index: active.index,
      trackKey: active.trackKey,
      track: active.track
    }, classification);
    var payload = failurePayload(active, classification, {
      roundId: round.id,
      failedCount: round.failedCount,
      queueLength: round.items.length
    });
    safeCall(config.onTrackFailed, payload, null);
    notify('track-failed');
    return scheduleNextCandidate(round, active, classification);
  }
  function reportFailure(details) {
    details = details || {};
    var active = state.active;
    if (!identityMatches(details, active)) return promise({ action: 'stale' });
    if (active.userPaused || details.userPaused === true || details.manualPause === true) {
      return promise({ action: 'ignored', reason: 'USER_PAUSED' });
    }
    var classification = classifyFailure(details);
    if (classification.ignored) return promise({ action: 'ignored', reason: classification.code });
    if (classification.code === 'PLAYBACK_NOT_ALLOWED') {
      clearLoadTimers();
      active.policyBlocked = true;
      if (!active.policyNotified) {
        active.policyNotified = true;
        safeCall(config.onPolicyBlocked, failurePayload(active, classification, { action: 'manual-required' }), null);
      }
      notify('policy-blocked');
      return promise({ action: 'manual-required', reason: classification.code, generation: active.generation });
    }
    if (active.policyBlocked) return promise({ action: 'ignored', reason: 'POLICY_BLOCKED' });
    var revisionKey = dictKey(active.sourceRevision);
    if (active.handledRevisions[revisionKey]) return active.handledRevisions[revisionKey];
    var operation;
    if (classification.refreshable && typeof config.refreshSource === 'function' &&
        typeof config.applyRefreshedSource === 'function' && active.refreshAttempts < config.maxRefreshAttempts) {
      operation = invokeRefresh(active, classification);
    } else {
      operation = commitFailedTrack(active, classification);
    }
    active.handledRevisions[revisionKey] = operation;
    return operation;
  }
  function reportResponse(details) {
    details = details || {};
    if (!identityMatches(details)) return promise({ action: 'stale' });
    var status = Number(responseValue(details, 'status')) || 0;
    var classification = classifyFailure(details);
    if (status >= 400 || classification.code === 'EMPTY_RESPONSE' || classification.code === 'INVALID_AUDIO_MIME') {
      return reportFailure(details);
    }
    return promise({ action: 'response-ok', generation: state.active.generation, status: status });
  }
  function eventDetails(media, type) {
    var mediaError = media && media.error;
    return {
      generation: media && media.__lfPlaybackFailureGeneration,
      sourceRevision: media && media.__lfPlaybackFailureSourceRevision,
      sourceUrl: media && (media.currentSrc || media.src),
      eventType: type,
      media: media,
      mediaError: mediaError,
      mediaCode: mediaError && mediaError.code,
      message: mediaError && mediaError.message
    };
  }
  function inspectAndReportFailure(details) {
    details = details || {};
    var active = state.active;
    if (!identityMatches(details, active)) return promise({ action: 'stale' });
    if (active.userPaused) return promise({ action: 'ignored', reason: 'USER_PAUSED' });
    if (active.policyBlocked) return promise({ action: 'ignored', reason: 'POLICY_BLOCKED' });
    var immediateClassification = classifyFailure(details);
    if (immediateClassification.code === 'PLAYBACK_NOT_ALLOWED' || immediateClassification.ignored) return reportFailure(details);
    if (typeof config.inspectFailure !== 'function') return reportFailure(details);
    var inspectionKey = dictKey(active.sourceRevision);
    if (active.inspectionOperations[inspectionKey]) return active.inspectionOperations[inspectionKey];
    active.inspectionRevisions[inspectionKey] = true;
    var inspected;
    try { inspected = config.inspectFailure(details); }
    catch (_) { inspected = null; }
    var operation = promise(inspected).then(function (extra) {
      if (extra && typeof extra === 'object') {
        var key;
        for (key in extra) if (own(extra, key)) details[key] = extra[key];
      }
      return reportFailure(details);
    }, function () { return reportFailure(details); });
    active.inspectionOperations[inspectionKey] = operation;
    return operation;
  }
  function deferMediaFailure(media, type) {
    var details = eventDetails(media, type);
    global.setTimeout(function () {
      inspectAndReportFailure(details);
    }, 0);
  }
  function unbindMedia() {
    var media = state.media;
    var handlers = state.handlers;
    if (media && handlers && typeof media.removeEventListener === 'function') {
      var name;
      for (name in handlers) if (own(handlers, name)) media.removeEventListener(name, handlers[name]);
    }
    state.media = null;
    state.handlers = null;
  }
  function bindMedia(media) {
    if (state.media === media && state.handlers) return function () { unbindMedia(); };
    unbindMedia();
    if (!media || typeof media.addEventListener !== 'function') return noop;
    var handlers = {
      loadstart: function () {
        if (identityMatches(eventDetails(media, 'loadstart'))) armLoadTimeout(state.active);
      },
      load: function () {
        if (identityMatches(eventDetails(media, 'load'))) clearTimer('loadTimer');
      },
      loadeddata: function () { if (identityMatches(eventDetails(media, 'loadeddata'))) clearLoadTimers(); },
      canplay: function () { if (identityMatches(eventDetails(media, 'canplay'))) clearLoadTimers(); },
      playing: function () { if (!media.paused) markProgress(eventDetails(media, 'playing')); },
      timeupdate: function () {
        if (media && !media.paused && Number(media.currentTime) > 0) markProgress(eventDetails(media, 'timeupdate'));
      },
      progress: function () {
        if (identityMatches(eventDetails(media, 'progress'))) clearTimer('stallTimer');
      },
      error: function () { deferMediaFailure(media, 'error'); },
      stalled: function () {
        if (!media.paused && identityMatches(eventDetails(media, 'stalled'))) armStallTimeout(state.active);
      },
      abort: function () {
        if (Date.now() <= state.suppressAbortUntil) return;
        if (state.active && state.active.userPaused) return;
        deferMediaFailure(media, 'abort');
      }
    };
    var name;
    for (name in handlers) if (own(handlers, name)) media.addEventListener(name, handlers[name]);
    state.media = media;
    state.handlers = handlers;
    if (state.active && state.active.sourceRevision > 0) tagMedia(state.active);
    return function () { if (state.media === media) unbindMedia(); };
  }
  function reset(reason) {
    clearLoadTimers();
    clearTimer('navigationTimer');
    abortRefresh();
    state.generation++;
    state.active = null;
    state.round = null;
    state.suppressAbortUntil = Date.now() + config.sourceAbortGraceMs;
    notify(reason || 'reset');
  }
  function configure(options) {
    options = options || {};
    config.maxRefreshAttempts = clampInt(options.maxRefreshAttempts, config.maxRefreshAttempts, 0, 4);
    config.loadTimeoutMs = clampInt(options.loadTimeoutMs, config.loadTimeoutMs, 0, 120000);
    config.stallTimeoutMs = clampInt(options.stallTimeoutMs, config.stallTimeoutMs, 0, 120000);
    config.navigationTimeoutMs = clampInt(options.navigationTimeoutMs, config.navigationTimeoutMs, 250, 120000);
    config.refreshTimeoutMs = clampInt(options.refreshTimeoutMs, config.refreshTimeoutMs, 250, 120000);
    config.sourceAbortGraceMs = clampInt(options.sourceAbortGraceMs, config.sourceAbortGraceMs, 0, 5000);
    var i, name;
    for (i = 0; i < CALLBACK_NAMES.length; i++) {
      name = CALLBACK_NAMES[i];
      if (own(options, name)) config[name] = typeof options[name] === 'function' ? options[name] : null;
    }
    if (config.stop == null) config.stop = noop;
    if (config.onTrackFailed == null) config.onTrackFailed = noop;
    if (config.onExhausted == null) config.onExhausted = noop;
    if (config.onPolicyBlocked == null) config.onPolicyBlocked = noop;
    if (config.onStateChange == null) config.onStateChange = noop;
    if (config.log == null) config.log = noop;
    state.destroyed = false;
    notify('configured');
    return api;
  }
  function snapshot() {
    var active = state.active;
    var round = state.round;
    return {
      version: VERSION,
      generation: state.generation,
      active: active ? {
        generation: active.generation,
        trackKey: active.trackKey,
        itemKey: active.itemKey,
        index: active.index,
        sourceUrl: active.sourceUrl,
        sourceRevision: active.sourceRevision,
        refreshAttempts: active.refreshAttempts,
        userPaused: active.userPaused,
        started: active.started,
        committed: active.committed,
        policyBlocked: active.policyBlocked
      } : null,
      round: round ? {
        id: round.id,
        failedCount: round.failedCount,
        queueLength: round.items.length,
        expectedItemKey: round.expected ? round.expected.itemKey : '',
        exhausted: round.exhausted,
        exhaustedNotified: round.exhaustedNotified
      } : null,
      mediaBound: !!state.media
    };
  }
  function destroy() {
    reset('destroy');
    unbindMedia();
    state.destroyed = true;
  }

  var api = {
    __lumifieldPlaybackFailureCoordinator: true,
    version: VERSION,
    configure: configure,
    beginTrack: beginTrack,
    setSource: setSource,
    bindMedia: bindMedia,
    unbindMedia: unbindMedia,
    reportFailure: reportFailure,
    inspectAndReportFailure: inspectAndReportFailure,
    reportResponse: reportResponse,
    markPlaying: markProgress,
    markProgress: markProgress,
    markUserPause: markUserPause,
    markUserResume: markUserResume,
    isCurrent: function (identity) { return identityMatches(identity || {}); },
    getIdentity: function () { return currentIdentity(); },
    getState: snapshot,
    reset: reset,
    destroy: destroy,
    classifyFailure: classifyFailure,
    isSupportedMime: supportedMime
  };

  global.LFPlaybackFailureCoordinator = api;
  global.PlaybackFailureCoordinator = api;
  global.LumiFieldPlaybackFailureCoordinator = api;
})(window);
