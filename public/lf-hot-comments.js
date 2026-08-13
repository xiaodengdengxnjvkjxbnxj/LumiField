(function (global) {
  'use strict';

  var DAILY_CACHE_KEY = 'lumifield-hot-comments-daily-v1';
  var DAILY_CACHE_VERSION = 1;
  var MAX_DAILY_GROUPS = 6;
  var state = {
    groups:[], items:[], sequence:[], index:0, paused:false, timer:0, transitionTimer:0,
    lastRefresh:0, requestSerial:0, view:'loading', message:'正在读取已登录平台热评…',
    scope:'', dayKey:'', stale:false, cacheStale:false, cacheState:'none', cacheStatus:'none'
  };
  function byId(id) { return document.getElementById(id); }
  function providerName(provider) {
    return { kugou:'酷狗', kugou_concept:'酷狗概念版', netease:'网易云', qq:'QQ音乐', qishui:'汽水音乐' }[String(provider || '').toLowerCase()] || '音乐平台';
  }
  function safeAsset(value) {
    value = String(value || '').trim(); if (!value) return '';
    try { var parsed = new URL(value, location.origin); return parsed.protocol === 'https:' || parsed.origin === location.origin ? parsed.href : ''; }
    catch (_) { return ''; }
  }
  function likes(value) { value = Math.max(0, Number(value) || 0); return value >= 10000 ? (value / 10000).toFixed(value >= 100000 ? 0 : 1).replace(/\.0$/, '') + '万赞' : value + '赞'; }
  function dateText(value) { var date = new Date(Number(value) || 0); return isFinite(date.getTime()) && date.getTime() > 0 ? date.toLocaleDateString('zh-CN') : ''; }
  function shortText(value, limit) {
    value = String(value || '').replace(/\s+/g, ' ').trim();
    return value.length > limit ? value.slice(0, Math.max(1, limit - 1)) + '…' : value;
  }
  function image(img, fallback, value) {
    var source = safeAsset(value); img.hidden = !source; fallback.hidden = !!source; img.removeAttribute('src');
    if (!source) return;
    img.onerror = function () { img.hidden = true; fallback.hidden = false; img.removeAttribute('src'); };
    img.src = source;
  }
  function toast(message) { if (typeof global.showToast === 'function') global.showToast(message); }

  function localDayKey() {
    var now = new Date();
    return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  }

  function currentScope() {
    try {
      var debug = global.LumiFieldMultiPlatform && typeof global.LumiFieldMultiPlatform.getDebug === 'function'
        ? global.LumiFieldMultiPlatform.getDebug()
        : null;
      if (debug && debug.scopeHash) return String(debug.scopeHash);
    } catch (_) {}
    return 'anonymous';
  }

  function realSongId(provider, song) {
    provider = String(provider || song && (song.provider || song.source || song.type) || '').toLowerCase();
    song = song || {};
    var value = '';
    if (provider === 'qq') value = song.songmid || song.mid || song.id;
    else if (provider === 'kugou' || provider === 'kugou_concept') value = song.mixSongId || song.albumAudioId || song.hash || song.id;
    else if (provider === 'qishui') value = song.qishuiTrackId || song.id;
    else value = song.id;
    return String(value == null ? '' : value).trim();
  }

  function songIdentity(provider, song) {
    provider = String(provider || song && (song.provider || song.source || song.type) || '').toLowerCase();
    var id = realSongId(provider, song);
    return provider && id ? provider + ':' + id : '';
  }

  function groupKey(comment, song) {
    song = song || comment && comment.song || {};
    return songIdentity(comment && comment.provider || song.provider || song.source, song);
  }

  function normalizeGroups(result) {
    var groups = [], byKey = Object.create(null), sourceGroups = Array.isArray(result && result.commentGroups) ? result.commentGroups : [];
    function append(comment, fallbackSong, fallbackProvider) {
      if (!comment || !comment.content) return;
      var candidateSong = comment.song || {};
      var candidateProvider = comment.provider || candidateSong.provider || candidateSong.source || fallbackProvider || '';
      var song = songIdentity(candidateProvider, candidateSong) ? candidateSong : fallbackSong;
      if (!song) return;
      var provider = String(comment.provider || fallbackProvider || song.provider || song.source || '').toLowerCase();
      if (!songIdentity(provider, song)) return;
      var normalized = comment.song === song && comment.provider === provider ? comment : Object.assign({}, comment, { provider:provider, song:song });
      var key = groupKey(normalized, song);
      if (!key) return;
      var group = byKey[key];
      if (!group) {
        group = byKey[key] = { key:key, provider:provider, song:song, comments:[], seen:Object.create(null) };
        groups.push(group);
      }
      var user = normalized.user || {};
      var identity = String(normalized.id || [shortText(normalized.content, 500), user.id || user.nickname || '', normalized.time || ''].join('|'));
      if (group.seen[identity] || group.comments.length >= 3) return;
      group.seen[identity] = true;
      group.comments.push(normalized);
    }
    sourceGroups.forEach(function (group) {
      (Array.isArray(group && group.comments) ? group.comments : []).forEach(function (comment) {
        append(comment, group.song, group.provider);
      });
    });
    if (!sourceGroups.length) {
      (Array.isArray(result && result.comments) ? result.comments : []).forEach(function (comment) { append(comment); });
    }
    return groups.filter(function (group) { delete group.seen; return group.comments.length > 0; });
  }

  function readCacheRegistry() {
    var parsed = null;
    try { parsed = JSON.parse(localStorage.getItem(DAILY_CACHE_KEY) || 'null'); } catch (_) {}
    if (parsed && parsed.version === DAILY_CACHE_VERSION && parsed.scopes && typeof parsed.scopes === 'object') return parsed;
    var registry = { version:DAILY_CACHE_VERSION, scopes:{} };
    if (parsed && parsed.day && Array.isArray(parsed.groups)) {
      registry.scopes[String(parsed.scope || 'anonymous')] = parsed;
    }
    return registry;
  }

  function cachedEntry(scope) {
    var raw = readCacheRegistry().scopes[String(scope || '')];
    if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(String(raw.day || '')) || !Array.isArray(raw.groups)) return null;
    var groups = normalizeGroups({ commentGroups:raw.groups });
    if (!groups.length) return null;
    return {
      version:DAILY_CACHE_VERSION,
      scope:String(scope || ''),
      day:String(raw.day),
      groups:groups,
      todaySongKeys:Array.isArray(raw.todaySongKeys) ? raw.todaySongKeys.map(String) : groups.map(function (group) { return group.key; }),
      recentSongKeys:Array.isArray(raw.recentSongKeys) ? raw.recentSongKeys.map(String) : [],
      lastSuccessAt:Math.max(0, Number(raw.lastSuccessAt) || 0)
    };
  }

  function persistSuccessfulDay(scope, day, groups, previous) {
    var registry = readCacheRegistry();
    var todayKeys = groups.map(function (group) { return group.key; });
    var priorToday = previous && previous.todaySongKeys || [];
    var priorRecent = previous && previous.recentSongKeys || [];
    if (previous && previous.day === day) {
      var superseded = Object.create(null);
      priorToday.forEach(function (key) { superseded[String(key)] = true; });
      priorToday = [];
      priorRecent = priorRecent.filter(function (key) { return !superseded[String(key)]; });
    }
    var recent = todayKeys
      .concat(priorToday)
      .concat(priorRecent)
      .filter(function (key, index, values) {
      return key && values.indexOf(key) === index;
    }).slice(0, 36);
    var storedGroups;
    try { storedGroups = JSON.parse(JSON.stringify(groups)); } catch (_) { return false; }
    registry.scopes[String(scope)] = {
      version:DAILY_CACHE_VERSION,
      scope:String(scope),
      day:String(day),
      groups:storedGroups,
      todaySongKeys:todayKeys,
      recentSongKeys:recent,
      lastSuccessAt:Date.now()
    };
    try { localStorage.setItem(DAILY_CACHE_KEY, JSON.stringify(registry)); return true; } catch (_) { return false; }
  }

  function selectDailyGroups(groups, previous) {
    var seen = Object.create(null), unique = [];
    (groups || []).forEach(function (group) {
      var key = String(group && group.key || songIdentity(group && group.provider, group && group.song));
      if (!key || seen[key]) return;
      seen[key] = true;
      group.key = key;
      unique.push(group);
    });
    var recent = Object.create(null);
    (previous && previous.todaySongKeys || []).concat(previous && previous.recentSongKeys || []).forEach(function (key) {
      recent[String(key)] = true;
    });
    var fresh = unique.filter(function (group) { return !recent[group.key]; });
    var repeated = unique.filter(function (group) { return recent[group.key]; });
    return fresh.concat(repeated).slice(0, MAX_DAILY_GROUPS);
  }

  function rebuildSequence(groups) {
    state.groups = groups || [];
    state.sequence = [];
    state.groups.forEach(function (group, songIndex) {
      group.comments.forEach(function (comment, commentIndex) {
        state.sequence.push({ comment:comment, songIndex:songIndex, songTotal:state.groups.length, commentIndex:commentIndex, commentTotal:group.comments.length });
      });
    });
    state.items = state.sequence.map(function (entry) { return entry.comment; });
    state.index = 0;
  }

  function activeEntry() {
    return state.sequence.length ? state.sequence[state.index % state.sequence.length] : null;
  }

  function renderSwitch(card, entry) {
    var songPosition = card.querySelector('.lf-hot-comment-song-position');
    var commentPosition = card.querySelector('.lf-hot-comment-comment-position');
    var dots = card.querySelector('.lf-hot-comment-dots');
    songPosition.textContent = (entry.songIndex + 1) + ' / ' + entry.songTotal;
    commentPosition.textContent = '热评 ' + (entry.commentIndex + 1) + ' / ' + entry.commentTotal;
    dots.replaceChildren();
    for (var index = 0; index < entry.commentTotal; index += 1) {
      var dot = document.createElement('i');
      dot.className = 'lf-hot-comment-dot' + (index === entry.commentIndex ? ' active' : '');
      dots.appendChild(dot);
    }
    card.dataset.songIndex = String(entry.songIndex);
    card.dataset.commentIndex = String(entry.commentIndex);
    card.dataset.commentsForSong = String(entry.commentTotal);
  }

  function setEmptyState(view, message) {
    state.view = view || 'empty';
    state.message = message || (state.view === 'error' ? '热评读取失败，请稍后重试' : '当前没有可显示的歌曲热评');
  }

  function setCacheState(status, stale) {
    state.stale = stale === true;
    state.cacheStale = state.stale;
    state.cacheState = status || 'none';
    state.cacheStatus = status || 'none';
  }

  function restoreCachedScope(scope) {
    var entry = cachedEntry(scope);
    state.scope = String(scope || '');
    if (!entry) {
      state.dayKey = '';
      rebuildSequence([]);
      setCacheState('miss', false);
      return null;
    }
    state.dayKey = entry.day;
    state.lastRefresh = entry.lastSuccessAt;
    rebuildSequence(entry.groups);
    var fresh = entry.day === localDayKey();
    setCacheState(fresh ? 'fresh' : 'stale', !fresh);
    state.view = 'ready';
    state.message = fresh ? '' : '正在显示上次成功缓存，联网后将自动更新';
    render();
    return entry;
  }

  function updateExpandable(card) {
    var text = card.querySelector('.lf-hot-comment-text');
    var button = card.querySelector('.lf-hot-comment-expand');
    if (!text || !button || text.hidden) return;
    card.classList.remove('expanded');
    button.setAttribute('aria-expanded', 'false');
    button.textContent = '展开长评';
    requestAnimationFrame(function () {
      if (!card.isConnected || text !== card.querySelector('.lf-hot-comment-text')) return;
      var expandable = text.textContent.length > 84 || text.scrollHeight > text.clientHeight + 2;
      button.hidden = false;
      button.disabled = !expandable;
      button.classList.toggle('unused', !expandable);
    });
  }

  function render() {
    var card = byId('lf-hot-comment-card'); if (!card) return;
    var entry = activeEntry();
    var comment = entry && entry.comment;
    var empty = card.querySelector('.lf-hot-comment-empty');
    var emptyMessage = card.querySelector('.lf-hot-comment-empty-message');
    var retry = card.querySelector('.lf-hot-comment-retry');
    var content = card.querySelector('.lf-hot-comment-content');
    card.classList.toggle('empty', !comment);
    card.classList.toggle('error', !comment && state.view === 'error');
    card.classList.toggle('loading', !comment && state.view === 'loading');
    card.classList.toggle('logged-out', !comment && state.view === 'logged-out');
    card.classList.toggle('stale', state.stale === true);
    card.dataset.state = comment ? 'ready' : state.view;
    card.dataset.cacheState = state.cacheState || 'none';
    card.dataset.cacheStatus = state.cacheStatus || 'none';
    card.setAttribute('aria-busy', state.view === 'loading' ? 'true' : 'false');
    if (!comment) {
      card.classList.remove('expanded');
      empty.hidden = false;
      content.hidden = true;
      emptyMessage.textContent = state.message;
      retry.hidden = state.view !== 'error';
      return;
    }
    card.classList.remove('loading', 'error', 'logged-out');
    empty.hidden = true;
    content.hidden = false;
    var song = comment.song || {}, user = comment.user || {};
    card.style.fontFamily = typeof global.lyricFontStackForKey === 'function' ? global.lyricFontStackForKey(global.fx && global.fx.lyricFont) : '';
    card.querySelector('.lf-hot-comment-platform').textContent = providerName(comment.provider || song.provider || song.source) + (state.stale ? ' · 缓存' : '');
    card.querySelector('.lf-hot-comment-song').textContent = song.name || song.title || '未知歌曲';
    card.querySelector('.lf-hot-comment-artist').textContent = song.artist || song.author || '未知歌手';
    card.querySelector('.lf-hot-comment-text').textContent = comment.content || '';
    card.querySelector('.lf-hot-comment-user-name').textContent = user.nickname || '音乐用户';
    card.querySelector('.lf-hot-comment-date').textContent = dateText(comment.time);
    card.querySelector('.lf-hot-comment-likes').textContent = likes(comment.likedCount);
    image(card.querySelector('.lf-hot-comment-cover'), card.querySelector('.lf-hot-comment-cover-fallback'), song.cover);
    image(card.querySelector('.lf-hot-comment-avatar'), card.querySelector('.lf-hot-comment-avatar-fallback'), user.avatar);
    card.querySelector('.lf-hot-comment-play').disabled = !song.id;
    renderSwitch(card, entry);
    card.setAttribute('aria-label', shortText(song.name || '歌曲', 40) + '热评：' + shortText(comment.content, 100));
    updateExpandable(card);
  }

  function next() {
    if (state.paused || state.sequence.length < 2) return;
    state.index = (state.index + 1) % state.sequence.length;
    var card = byId('lf-hot-comment-card'); if (card) card.classList.add('changing');
    clearTimeout(state.transitionTimer);
    state.transitionTimer = setTimeout(function () { render(); if (card) card.classList.remove('changing'); }, 170);
  }

  async function refresh(force) {
    var scope = currentScope(), today = localDayKey();
    if (state.scope !== scope) restoreCachedScope(scope);
    var previous = cachedEntry(scope);
    if (!force && previous && previous.day === today) {
      if (state.dayKey !== previous.day || !state.items.length) restoreCachedScope(scope);
      return;
    }
    if (!force && Date.now() - state.lastRefresh < 60000) return;
    var serial = ++state.requestSerial, requestScope = scope, requestDay = today, card = byId('lf-hot-comment-card');
    if (!state.items.length) { setEmptyState('loading', '正在读取已登录平台热评…'); render(); }
    if (card) { card.classList.add('refreshing'); card.setAttribute('aria-busy', 'true'); }
    try {
      if (!global.LumiFieldHotComments || typeof global.LumiFieldHotComments.fetch !== 'function') throw new Error('HOT_COMMENT_SERVICE_UNAVAILABLE');
      var result = await global.LumiFieldHotComments.fetch(null, 18);
      if (serial !== state.requestSerial || requestScope !== currentScope() || requestDay !== localDayKey()) return;
      if (!result || result.ok === false) {
        state.lastRefresh = Date.now();
        if (state.items.length) {
          state.view = 'ready'; state.message = '正在显示上次成功缓存，联网后将自动更新'; setCacheState('stale', true);
        } else {
          setCacheState('miss', false);
          setEmptyState('error', shortText(result && result.message, 160) || '热评读取失败，请检查网络后重试');
        }
        render(); return;
      }
      state.lastRefresh = Date.now();
      var groups = selectDailyGroups(normalizeGroups(result), previous);
      if (!groups.length) {
        if (state.items.length) {
          state.view = 'ready'; state.message = '正在显示上次成功缓存，暂未取得今日热评'; setCacheState('stale', true);
          render(); return;
        }
        rebuildSequence([]);
        var code = String(result.code || 'NO_HOT_COMMENTS');
        setCacheState('miss', false);
        setEmptyState(code === 'NO_LOGGED_IN_MUSIC_PLATFORM' || code === 'MUSIC_PLATFORM_LOGIN_REQUIRED' ? 'logged-out' : 'empty',
          result.message || (code === 'NO_HOT_COMMENTS' ? '已登录平台暂无可用热评' : '登录音乐平台后显示歌曲热评'));
      } else {
        rebuildSequence(groups);
        state.scope = requestScope; state.dayKey = requestDay;
        state.view = 'ready'; state.message = ''; setCacheState('fresh', false);
        persistSuccessfulDay(requestScope, requestDay, groups, previous);
      }
      render();
    } catch (_) {
      if (serial !== state.requestSerial || requestScope !== currentScope() || requestDay !== localDayKey()) return;
      state.lastRefresh = Date.now();
      if (state.items.length) {
        state.view = 'ready'; state.message = '正在显示上次成功缓存，联网后将自动更新'; setCacheState('stale', true);
      } else {
        setCacheState('miss', false);
        setEmptyState('error', '热评读取失败，请检查网络后重试');
      }
      render();
    } finally {
      if (serial === state.requestSerial && requestScope === currentScope() && requestDay === localDayKey() && card) {
        card.classList.remove('refreshing');
        card.setAttribute('aria-busy', 'false');
      }
    }
  }

  async function playActiveComment(event) {
    event.stopPropagation();
    var card = byId('lf-hot-comment-card');
    var button = card && card.querySelector('.lf-hot-comment-play');
    var entry = activeEntry();
    var comment = entry && entry.comment;
    if (!comment || !comment.song || !comment.song.id) return toast('当前热评没有可播放歌曲');
    if (typeof global.queueSong !== 'function' || typeof global.playQueueAt !== 'function') return toast('播放器尚未准备完成，请稍后重试');
    if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
    try {
      var index = global.queueSong(comment.song, { position:'next' });
      if (!Number.isInteger(index) || index < 0) throw new Error('QUEUE_REJECTED');
      var played = await Promise.resolve(global.playQueueAt(index));
      if (played === false || played && played.ok === false) throw new Error(played && (played.message || played.error) || 'PLAY_REJECTED');
    } catch (_) {
      toast('热评歌曲播放失败，请重新选择歌曲');
    } finally {
      if (button) {
        var currentEntry = activeEntry();
        var current = currentEntry && currentEntry.comment;
        button.disabled = !(current && current.song && current.song.id);
        button.removeAttribute('aria-busy');
      }
    }
  }

  function updateGlassPointer(card, event) {
    var rect = card.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    card.style.setProperty('--lf-hot-glass-x', Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)).toFixed(1) + '%');
    card.style.setProperty('--lf-hot-glass-y', Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100)).toFixed(1) + '%');
  }

  function init() {
    var shell = document.querySelector('.lf-weather-shell'); if (!shell || byId('lf-hot-comment-card')) return;
    shell.classList.add('lf-hot-comments-host');
    var card = document.createElement('section');
    card.id = 'lf-hot-comment-card'; card.className = 'lf-hot-comment-card empty loading'; card.tabIndex = 0;
    card.setAttribute('aria-live', 'polite'); card.setAttribute('aria-busy', 'true');
    card.innerHTML = '<div class="lf-hot-comment-empty"><span class="lf-hot-comment-empty-message">正在读取已登录平台热评…</span><button class="lf-hot-comment-retry" type="button" hidden>重试</button></div><div class="lf-hot-comment-content" hidden><div class="lf-hot-comment-cover-wrap"><img class="lf-hot-comment-cover" alt="" referrerpolicy="no-referrer"><span class="lf-hot-comment-cover-fallback">♫</span></div><div class="lf-hot-comment-main"><div class="lf-hot-comment-heading"><span class="lf-hot-comment-platform"></span><b class="lf-hot-comment-song"></b><span class="lf-hot-comment-artist"></span></div><blockquote class="lf-hot-comment-text"></blockquote><button class="lf-hot-comment-expand" type="button" aria-expanded="false" hidden>展开长评</button><div class="lf-hot-comment-meta"><span class="lf-hot-comment-avatar-wrap"><img class="lf-hot-comment-avatar" alt="" referrerpolicy="no-referrer"><span class="lf-hot-comment-avatar-fallback">人</span></span><span class="lf-hot-comment-user-name"></span><time class="lf-hot-comment-date"></time><span class="lf-hot-comment-likes"></span></div></div><div class="lf-hot-comment-actions"><button class="lf-hot-comment-play" type="button" title="播放这首歌" aria-label="播放热评歌曲">▶</button><div class="lf-hot-comment-switch" aria-label="热评切换位置"><span class="lf-hot-comment-song-position"></span><span class="lf-hot-comment-comment-position"></span><span class="lf-hot-comment-dots" aria-hidden="true"></span></div></div></div>';
    shell.appendChild(card);
    card.addEventListener('pointerenter', function () { state.paused = true; });
    card.addEventListener('pointermove', function (event) { updateGlassPointer(card, event); });
    card.addEventListener('pointerleave', function () { state.paused = false; card.style.setProperty('--lf-hot-glass-x', '50%'); card.style.setProperty('--lf-hot-glass-y', '18%'); });
    card.addEventListener('focusin', function () { state.paused = true; });
    card.addEventListener('focusout', function () { state.paused = false; });
    card.querySelector('.lf-hot-comment-play').addEventListener('click', playActiveComment);
    card.querySelector('.lf-hot-comment-retry').addEventListener('click', function (event) { event.stopPropagation(); refresh(true); });
    card.querySelector('.lf-hot-comment-expand').addEventListener('click', function (event) {
      event.stopPropagation();
      var expanded = card.classList.toggle('expanded');
      event.currentTarget.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      event.currentTarget.textContent = expanded ? '收起长评' : '展开长评';
    });
    state.timer = setInterval(next, 7600); setInterval(function () { refresh(false); }, 300000);
    global.addEventListener('focus', function () { refresh(false); });
    document.addEventListener('lumifield-current-platform-change', function () { setTimeout(function () { refresh(false); }, 700); });
    document.addEventListener('click', function (event) {
      if (event.target && event.target.closest && event.target.closest('.lf-platform-login-action')) setTimeout(function () { refresh(true); }, 1800);
      if (event.target && event.target.closest && event.target.closest('[data-font]')) setTimeout(render, 0);
    });
    global.LumiFieldHotCommentCard = Object.freeze({ refresh:function () { return refresh(true); }, next:next, state:state });
    var cached = restoreCachedScope(currentScope());
    if (!cached || cached.day !== localDayKey()) refresh(true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true }); else init();
})(window);
