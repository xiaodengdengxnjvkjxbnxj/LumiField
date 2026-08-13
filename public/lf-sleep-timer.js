(function (global) {
  'use strict';

  var ALLOWED_MINUTES = [30, 60, 120];
  var state = {
    active: false,
    phase: 'idle',
    deadline: 0,
    startedAt: 0,
    durationMinutes: 0,
    selectedIndex: -1,
    timerId: 0,
    generation: 0,
    blockAutoAdvanceUntil: 0,
    setCount: 0,
    replaceCount: 0,
    expirationCount: 0,
    lastReason: '',
    events: [],
  };
  var ui = {};
  var chosenMinutes = 30;

  function now() {
    var test = global.__lfSleepTimerTestConfig;
    return test && typeof test.now === 'function' ? Number(test.now()) : Date.now();
  }

  function log(type, detail) {
    var entry = Object.assign({
      type: type,
      at: now(),
      generation: state.generation,
      deadline: state.deadline,
      selectedIndex: state.selectedIndex,
    }, detail || {});
    state.events.push(entry);
    if (state.events.length > 160) state.events.shift();
    return entry;
  }

  function clearScheduledTick() {
    if (!state.timerId) return;
    clearTimeout(state.timerId);
    state.timerId = 0;
  }

  function formatRemaining(milliseconds) {
    var seconds = Math.max(0, Math.ceil(Number(milliseconds || 0) / 1000));
    var hours = Math.floor(seconds / 3600);
    var minutes = Math.floor((seconds % 3600) / 60);
    var secs = seconds % 60;
    if (hours) return hours + ':' + String(minutes).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    return String(minutes).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
  }

  function queueSongs() {
    return Array.isArray(global.playQueue) ? global.playQueue : [];
  }

  function songLabel(song, index) {
    song = song || {};
    return (index + 1) + '. ' + String(song.name || song.title || '未知歌曲') +
      (song.artist ? ' · ' + String(song.artist) : '');
  }

  function refreshSongOptions(preferredIndex) {
    if (!ui.song) return;
    var songs = queueSongs();
    var selected = Number.isInteger(preferredIndex) ? preferredIndex :
      (Number.isInteger(global.currentIdx) && global.currentIdx >= 0 ? global.currentIdx : 0);
    ui.song.replaceChildren();
    songs.forEach(function (song, index) {
      var option = document.createElement('option');
      option.value = String(index);
      option.textContent = songLabel(song, index);
      ui.song.appendChild(option);
    });
    ui.song.disabled = !songs.length;
    ui.confirm.disabled = !songs.length;
    if (songs.length) ui.song.value = String(Math.max(0, Math.min(songs.length - 1, selected)));
    if (ui.empty) ui.empty.hidden = !!songs.length;
  }

  function render() {
    if (!ui.root) return;
    var remaining = state.active ? Math.max(0, state.deadline - now()) : 0;
    ui.root.classList.toggle('active', state.active);
    ui.button.classList.toggle('active', state.active);
    ui.button.setAttribute('aria-pressed', state.active ? 'true' : 'false');
    ui.button.title = state.active ? '定时播放 · 剩余 ' + formatRemaining(remaining) : '定时播放';
    ui.badge.hidden = !state.active;
    ui.badge.textContent = state.active ? formatRemaining(remaining) : '';
    ui.status.textContent = state.active
      ? state.durationMinutes + ' 分钟 · ' + formatRemaining(remaining) + ' 后停止'
      : '未设置定时播放';
    ui.cancel.disabled = !state.active;
    Array.prototype.forEach.call(ui.durationButtons || [], function (button) {
      button.classList.toggle('selected', Number(button.dataset.minutes) === chosenMinutes);
    });
  }

  function closePopover() {
    if (!ui.root) return;
    ui.root.classList.remove('open');
    ui.button.setAttribute('aria-expanded', 'false');
  }

  function openPopover() {
    if (!ui.root) return;
    refreshSongOptions(state.active ? state.selectedIndex : undefined);
    ui.root.classList.add('open');
    ui.button.setAttribute('aria-expanded', 'true');
    render();
  }

  function togglePopover(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (ui.root.classList.contains('open')) closePopover();
    else openPopover();
  }

  function shouldBlockAutoAdvance() {
    if (state.active && state.deadline && now() >= state.deadline) expire(state.generation);
    return now() < state.blockAutoAdvanceUntil;
  }

  function allowPlayback(reason) {
    if (!state.blockAutoAdvanceUntil) return false;
    state.blockAutoAdvanceUntil = 0;
    log('playback-unblocked', { reason: reason || 'manual-action' });
    return true;
  }

  function handleMediaEnded() {
    if (state.active && state.deadline && now() >= state.deadline) {
      state.lastReason = 'media-ended-at-deadline';
      expire(state.generation);
    }
    if (!shouldBlockAutoAdvance()) return false;
    log('auto-advance-blocked', { reason: state.lastReason || 'deadline' });
    return true;
  }

  function stopPlaybackAtDeadline() {
    try {
      if (global.LumiFieldClimaxPreview && global.LumiFieldClimaxPreview.isHolding()) {
        global.LumiFieldClimaxPreview.stop('sleep-timer-expired', { restore: false });
      }
    } catch (_) {}
    try {
      if (typeof global.clearAudioFadeTimers === 'function') global.clearAudioFadeTimers();
    } catch (_) {}
    var media = global.audio;
    var failureCoordinator = global.LumiFieldPlaybackFailureCoordinator;
    var failureIdentity = failureCoordinator && failureCoordinator.getIdentity && failureCoordinator.getIdentity();
    if (failureCoordinator && failureIdentity && typeof failureCoordinator.markUserPause === 'function') {
      failureCoordinator.markUserPause(Object.assign({}, failureIdentity, { reason:'sleep-timer-expired' }));
    }
    if (typeof global.trackSwitchToken === 'number') global.trackSwitchToken += 1;
    global.playToggleBusy = false;
    if (media) {
      try { media.pause(); } catch (_) {}
    }
    try { global.playing = false; } catch (_) {}
    try { if (typeof global.setPlayIcon === 'function') global.setPlayIcon(false); } catch (_) {}
    try { if (typeof global.hideLoading === 'function') global.hideLoading(); } catch (_) {}
    try {
      if (typeof global.updateListenStatsTick === 'function') global.updateListenStatsTick(true);
      if (typeof global.syncPlaybackStateFromAudioEvent === 'function') {
        global.syncPlaybackStateFromAudioEvent('sleep-timer-expired');
      }
    } catch (_) {}
  }

  function expire(generation) {
    if (!state.active || generation !== state.generation) return false;
    clearScheduledTick();
    state.phase = 'expiring';
    state.active = false;
    state.expirationCount += 1;
    state.blockAutoAdvanceUntil = now() + 2500;
    state.lastReason = 'deadline';
    stopPlaybackAtDeadline();
    log('expired', {
      expiredAt: now(),
      deadlineErrorMs: now() - state.deadline,
      queueIndex: Number(global.currentIdx),
      audioPaused: !global.audio || !!global.audio.paused,
    });
    state.phase = 'idle';
    render();
    closePopover();
    if (typeof global.showToast === 'function') global.showToast('定时播放已结束');
    return true;
  }

  function tick(generation) {
    state.timerId = 0;
    if (!state.active || generation !== state.generation) return;
    var remaining = state.deadline - now();
    render();
    if (remaining <= 0) {
      expire(generation);
      return;
    }
    state.timerId = setTimeout(function () {
      tick(generation);
    }, Math.max(20, Math.min(1000, remaining)));
  }

  function schedule() {
    clearScheduledTick();
    var generation = state.generation;
    state.timerId = setTimeout(function () {
      tick(generation);
    }, Math.max(20, Math.min(1000, state.deadline - now())));
  }

  function durationMs(minutes, testDurationMs) {
    if (testDurationMs != null && global.__lfSleepTimerTestConfig) {
      return Math.max(80, Number(testDurationMs) || 0);
    }
    return minutes * 60 * 1000;
  }

  async function setTimer(minutes, songIndex, options) {
    options = options || {};
    minutes = Number(minutes);
    songIndex = Number(songIndex);
    if (ALLOWED_MINUTES.indexOf(minutes) < 0) throw new Error('SLEEP_TIMER_DURATION_INVALID');
    var songs = queueSongs();
    if (!Number.isInteger(songIndex) || songIndex < 0 || songIndex >= songs.length) {
      throw new Error('SLEEP_TIMER_SONG_INVALID');
    }
    var replacing = state.active;
    clearScheduledTick();
    state.generation += 1;
    state.active = true;
    state.phase = 'active';
    state.startedAt = now();
    state.durationMinutes = minutes;
    state.selectedIndex = songIndex;
    state.deadline = state.startedAt + durationMs(minutes, options.testDurationMs);
    state.blockAutoAdvanceUntil = 0;
    state.lastReason = replacing ? 'replaced' : 'set';
    state.setCount += 1;
    if (replacing) state.replaceCount += 1;
    log(replacing ? 'replaced' : 'set', {
      durationMinutes: minutes,
      startedAt: state.startedAt,
      durationMs: state.deadline - state.startedAt,
      songKey: String((songs[songIndex] && songs[songIndex].id) || ''),
    });
    schedule();
    render();
    closePopover();
    try {
      var started = await Promise.resolve(global.playQueueAt(songIndex, {
        manual: true,
        sleepTimerStart: true,
        origin: 'sleep-timer',
      }));
      log(started === false ? 'selected-song-failure-policy-active' : 'selected-song-started', {
        currentIdx: Number(global.currentIdx),
        deadlineUnchanged: state.deadline,
      });
    } catch (error) {
      log('selected-song-start-failed', { error: String(error && error.message || error) });
      throw error;
    }
    return status();
  }

  function cancel(reason, options) {
    options = options || {};
    var wasActive = state.active;
    var oldDeadline = state.deadline;
    clearScheduledTick();
    state.generation += 1;
    state.active = false;
    state.phase = 'idle';
    state.deadline = 0;
    state.startedAt = 0;
    state.durationMinutes = 0;
    state.selectedIndex = -1;
    state.blockAutoAdvanceUntil = 0;
    state.lastReason = reason || 'cancelled';
    if (wasActive) log('cancelled', { reason: state.lastReason, oldDeadline: oldDeadline });
    render();
    closePopover();
    if (wasActive && !options.silent && typeof global.showToast === 'function') {
      global.showToast('已取消定时播放');
    }
    return wasActive;
  }

  function status() {
    return {
      version: '1.0.0',
      active: state.active,
      phase: state.phase,
      deadline: state.deadline,
      startedAt: state.startedAt,
      durationMinutes: state.durationMinutes,
      selectedIndex: state.selectedIndex,
      remainingMs: state.active ? Math.max(0, state.deadline - now()) : 0,
      scheduledTimerCount: state.timerId ? 1 : 0,
      generation: state.generation,
      setCount: state.setCount,
      replaceCount: state.replaceCount,
      expirationCount: state.expirationCount,
      lastReason: state.lastReason,
      autoAdvanceBlocked: shouldBlockAutoAdvance(),
    };
  }

  function diagnostics() {
    return {
      status: status(),
      events: state.events.slice(),
      allowedMinutes: ALLOWED_MINUTES.slice(),
      audioIdentity: String(global.audio),
      playerCount: document.querySelectorAll('audio').length,
      persistedKeys: Object.keys(localStorage).filter(function (key) {
        return /sleep.?timer|定时播放/i.test(key);
      }),
    };
  }

  function injectUi() {
    if (document.getElementById('lf-sleep-timer')) return;
    var transport = document.querySelector('.control-cluster.transport');
    if (!transport) return;
    var root = document.createElement('div');
    root.id = 'lf-sleep-timer';
    root.className = 'lf-sleep-timer';
    root.innerHTML =
      '<button id="lf-sleep-timer-btn" class="ctrl-btn lf-sleep-timer-btn" type="button" title="定时播放" aria-label="定时播放" aria-haspopup="dialog" aria-controls="lf-sleep-timer-popover" aria-expanded="false" aria-pressed="false">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.4 2"/><path d="M8.2 2.8 6.5 4.5M15.8 2.8l1.7 1.7"/></svg>' +
        '<span id="lf-sleep-timer-badge" class="lf-sleep-timer-badge" hidden></span>' +
      '</button>' +
      '<div id="lf-sleep-timer-popover" class="lf-sleep-timer-popover" role="dialog" aria-label="定时播放">' +
        '<div class="lf-sleep-timer-title">定时播放</div>' +
        '<div class="lf-sleep-timer-status" id="lf-sleep-timer-status">未设置定时播放</div>' +
        '<div class="lf-sleep-timer-durations" role="group" aria-label="播放时长">' +
          '<button type="button" data-minutes="30">30 分钟</button>' +
          '<button type="button" data-minutes="60">60 分钟</button>' +
          '<button type="button" data-minutes="120">120 分钟</button>' +
        '</div>' +
        '<label class="lf-sleep-timer-song-label" for="lf-sleep-timer-song">指定歌曲</label>' +
        '<select id="lf-sleep-timer-song" aria-label="指定歌曲"></select>' +
        '<div id="lf-sleep-timer-empty" class="lf-sleep-timer-empty" hidden>当前队列没有可选歌曲</div>' +
        '<div class="lf-sleep-timer-actions">' +
          '<button id="lf-sleep-timer-cancel" type="button">取消定时</button>' +
          '<button id="lf-sleep-timer-confirm" type="button" class="primary">开始定时</button>' +
        '</div>' +
      '</div>';
    transport.appendChild(root);
    ui.root = root;
    ui.button = root.querySelector('#lf-sleep-timer-btn');
    ui.badge = root.querySelector('#lf-sleep-timer-badge');
    ui.popover = root.querySelector('#lf-sleep-timer-popover');
    ui.status = root.querySelector('#lf-sleep-timer-status');
    ui.song = root.querySelector('#lf-sleep-timer-song');
    ui.empty = root.querySelector('#lf-sleep-timer-empty');
    ui.confirm = root.querySelector('#lf-sleep-timer-confirm');
    ui.cancel = root.querySelector('#lf-sleep-timer-cancel');
    ui.durationButtons = root.querySelectorAll('[data-minutes]');
    ui.button.addEventListener('click', togglePopover);
    Array.prototype.forEach.call(ui.durationButtons, function (button) {
      button.addEventListener('click', function () {
        chosenMinutes = Number(button.dataset.minutes);
        render();
      });
    });
    ui.confirm.addEventListener('click', async function () {
      ui.confirm.disabled = true;
      try {
        await setTimer(chosenMinutes, Number(ui.song.value));
        if (typeof global.showToast === 'function') global.showToast('已设置 ' + chosenMinutes + ' 分钟定时播放');
      } catch (error) {
        if (typeof global.showToast === 'function') {
          global.showToast(error && error.message === 'SLEEP_TIMER_SONG_INVALID' ? '请选择要播放的歌曲' : '定时播放设置失败');
        }
      } finally {
        ui.confirm.disabled = !queueSongs().length;
      }
    });
    ui.cancel.addEventListener('click', function () { cancel('user-cancel'); });
    document.addEventListener('pointerdown', function (event) {
      if (ui.root.classList.contains('open') && !ui.root.contains(event.target)) closePopover();
    }, true);
    global.addEventListener('beforeunload', function () { cancel('app-exit', { silent: true }); });
    global.addEventListener('pagehide', function () { cancel('app-exit', { silent: true }); });
    refreshSongOptions();
    render();
  }

  global.LumiFieldSleepTimer = {
    version: '1.0.0',
    allowedMinutes: ALLOWED_MINUTES.slice(),
    set: function (minutes, songIndex) { return setTimer(minutes, songIndex); },
    cancel: cancel,
    expireNow: function () {
      if (!global.__lfSleepTimerTestConfig) return false;
      state.deadline = now();
      return expire(state.generation);
    },
    setForTest: function (minutes, songIndex, milliseconds) {
      if (!global.__lfSleepTimerTestConfig) return Promise.reject(new Error('SLEEP_TIMER_TEST_DISABLED'));
      return setTimer(minutes, songIndex, { testDurationMs: milliseconds });
    },
    shouldBlockAutoAdvance: shouldBlockAutoAdvance,
    shouldPreventPlayback: shouldBlockAutoAdvance,
    handleMediaEnded: handleMediaEnded,
    allowPlayback: allowPlayback,
    status: status,
    getState: status,
    diagnostics: diagnostics,
    getDiagnostics: diagnostics,
    refreshQueue: refreshSongOptions,
    open: openPopover,
    close: closePopover,
  };
  global.LFSleepTimer = global.LumiFieldSleepTimer;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectUi, { once: true });
  else injectUi();
})(window);
