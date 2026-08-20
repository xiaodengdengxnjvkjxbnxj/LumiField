(function (global) {
  'use strict';

  var SCHEMA = 'lumifield.playlist-link-imports';
  var VERSION = 1;
  var STORAGE_KEY = 'lumifield-playlist-link-imports-v1';
  var PROVIDERS = ['netease', 'qq', 'kugou', 'kugou_concept', 'qishui'];
  var LABELS = {
    netease:'网易云音乐', qq:'QQ 音乐', kugou:'酷狗音乐',
    kugou_concept:'酷狗概念版', qishui:'汽水音乐'
  };
  var MAX_INPUT = 4096;
  var MAX_SONGS = 20000;
  var scopeOverride = '';
  var observedUserId = '';
  var requestSerial = 0;
  var originalDoSearch = global.doSearch;
  var originalRefreshUserPlaylists = global.refreshUserPlaylists;
  var originalSetProviderPlaylistCache = global.setProviderPlaylistCache;
  var originalLoadPlaylistIntoQueueById = global.loadPlaylistIntoQueueById;
  var hooksInstalled = false;
  var state = {
    phase:'idle', pending:null, error:null, progress:0, lastSubmitSource:'',
    abortController:null, lastRecord:null, lastLoadedSongs:[], lastLoadedSurface:''
  };

  function own(object, key) { return Object.prototype.hasOwnProperty.call(object || {}, key); }
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function text(value, limit) { return String(value == null ? '' : value).trim().slice(0, limit || 512); }
  function provider(value) { value = text(value, 32).toLowerCase(); return PROVIDERS.indexOf(value) >= 0 ? value : ''; }
  function idValue(value) {
    value = text(value, 180);
    return /^[\w.-]+$/i.test(value) ? value : '';
  }
  function finite(value, fallback) { value = Number(value); return isFinite(value) ? value : (fallback || 0); }
  function safeUrl(value, allowEmpty) {
    value = text(value, 2048);
    if (!value && allowEmpty) return '';
    try {
      var url = new URL(value);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) return '';
      return url.href.slice(0, 2048);
    } catch (_) { return ''; }
  }
  function hashIdentity(value) {
    value = text(value, 240) || 'anonymous';
    var left = 2166136261, right = 2246822507;
    for (var index = 0; index < value.length; index++) {
      var code = value.charCodeAt(index);
      left = Math.imul(left ^ code, 16777619);
      right = Math.imul(right ^ code, 3266489909);
    }
    return ('00000000' + (left >>> 0).toString(16)).slice(-8) + ('00000000' + (right >>> 0).toString(16)).slice(-8);
  }
  function currentIdentity() {
    if (scopeOverride) return scopeOverride;
    if (observedUserId) return observedUserId;
    try {
      var user = global.LFAuth && typeof global.LFAuth.getUser === 'function' ? global.LFAuth.getUser() : null;
      return text(user && (user.id || user.userId || user.email), 240) || 'anonymous';
    } catch (_) { return 'anonymous'; }
  }
  function scopeHash() { return hashIdentity(currentIdentity()); }
  function emptyRoot() { return { schema:SCHEMA, version:VERSION, scopes:{} }; }
  function readRoot() {
    var parsed = null;
    try { parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (_) {}
    if (!parsed || parsed.schema !== SCHEMA || parsed.version !== VERSION || !parsed.scopes || typeof parsed.scopes !== 'object' || Array.isArray(parsed.scopes)) return emptyRoot();
    return parsed;
  }
  function readScope() {
    var root = readRoot();
    var value = root.scopes[scopeHash()];
    if (!value || value.version !== VERSION || !value.items || typeof value.items !== 'object' || Array.isArray(value.items)) {
      return { version:VERSION, updatedAt:0, items:{} };
    }
    return value;
  }
  function writeScope(nextScope) {
    var root = readRoot();
    var next = { schema:SCHEMA, version:VERSION, scopes:Object.assign({}, root.scopes) };
    next.scopes[scopeHash()] = {
      version:VERSION,
      updatedAt:Date.now(),
      items:Object.assign({}, nextScope && nextScope.items || {})
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
    catch (error) {
      var quota = new Error('PLAYLIST_IMPORT_STORAGE_FULL');
      quota.code = 'PLAYLIST_IMPORT_STORAGE_FULL';
      quota.cause = error;
      throw quota;
    }
    return next.scopes[scopeHash()];
  }
  function importedRecords(targetProvider) {
    var items = readScope().items;
    return Object.keys(items).map(function (key) { return items[key]; }).filter(function (item) {
      return item && item.schema === 'lumifield.imported-playlist' && item.version === VERSION && provider(item.sourceProvider) && idValue(item.sourcePlaylistId) && (!targetProvider || item.sourceProvider === targetProvider);
    }).sort(function (a, b) { return finite(b.updatedAt, 0) - finite(a.updatedAt, 0); });
  }
  function importKey(targetProvider, playlistId) { return provider(targetProvider) + ':' + idValue(playlistId); }
  function findImported(targetProvider, playlistId) {
    var key = importKey(targetProvider, playlistId);
    return key ? (readScope().items[key] || null) : null;
  }
  function removeImportedPlaylist(targetProvider, playlistId) {
    targetProvider = provider(targetProvider);
    playlistId = idValue(playlistId);
    var key = importKey(targetProvider, playlistId);
    var current = readScope();
    if (!key || !current.items[key]) {
      return { ok:false, code:'IMPORTED_PLAYLIST_NOT_FOUND', provider:targetProvider, playlistId:playlistId };
    }
    var nextItems = Object.assign({}, current.items);
    delete nextItems[key];
    writeScope({ version:VERSION, items:nextItems });
    return {
      ok:true,
      provider:targetProvider,
      id:playlistId,
      playlistId:playlistId,
      operation:'delete-local',
      localOnly:false,
      remoteMutated:false,
      imported:true
    };
  }

  function trimSharePunctuation(value) {
    return text(value, MAX_INPUT).replace(/[\]\[(){}<>，。！？、；：'"“”‘’]+$/g, '');
  }
  function firstUrl(value) {
    value = text(value, MAX_INPUT);
    var match = value.match(/https?:\/\/[^\s<>"']+/i);
    return match ? trimSharePunctuation(match[0]) : '';
  }
  function urlCount(value) {
    var matches = text(value, MAX_INPUT).match(/https?:\/\/[^\s<>"']+/ig);
    return matches ? matches.length : 0;
  }
  function hostEnds(host, suffix) { return host === suffix || host.slice(-(suffix.length + 1)) === '.' + suffix; }
  function queryId(url) {
    var names = ['id', 'playlistId', 'playlist_id', 'listid', 'listId', 'pid', 'global_collection_id', 'collection_id'];
    for (var index = 0; index < names.length; index++) {
      var found = idValue(url.searchParams.get(names[index]));
      if (found) return found;
    }
    var hash = text(url.hash, 1024);
    var queryAt = hash.indexOf('?');
    if (queryAt >= 0) {
      try {
        var hashParams = new URLSearchParams(hash.slice(queryAt + 1));
        for (var queryIndex = 0; queryIndex < names.length; queryIndex++) {
          var hashId = idValue(hashParams.get(names[queryIndex]));
          if (hashId) return hashId;
        }
      } catch (_) {}
    }
    return '';
  }
  function pathId(pathname, patterns) {
    for (var index = 0; index < patterns.length; index++) {
      var match = pathname.match(patterns[index]);
      var found = match && idValue(match[1]);
      if (found) return found;
    }
    return '';
  }
  function canonicalUrl(targetProvider, playlistId, fallback) {
    if (!playlistId) return safeUrl(fallback, true);
    if (targetProvider === 'netease') return 'https://music.163.com/playlist?id=' + encodeURIComponent(playlistId);
    if (targetProvider === 'qq') return 'https://y.qq.com/n/ryqq/playlist/' + encodeURIComponent(playlistId);
    if (targetProvider === 'kugou') return 'https://www.kugou.com/yy/special/single/' + encodeURIComponent(playlistId) + '.html';
    if (targetProvider === 'kugou_concept') return 'https://www.kugou.com/yy/special/single/' + encodeURIComponent(playlistId) + '.html?appid=3116';
    if (targetProvider === 'qishui') return 'https://www.qishui.com/playlist/' + encodeURIComponent(playlistId);
    return safeUrl(fallback, true);
  }
  function parsePlaylistLink(input) {
    var raw = text(input, MAX_INPUT + 1);
    if (!raw) return { matched:false, supported:false, code:'EMPTY_QUERY' };
    if (String(input == null ? '' : input).trim().length > MAX_INPUT) {
      return { matched:true, supported:false, code:'PLAYLIST_URL_TOO_LONG', message:'歌单链接过长。' };
    }
    if (urlCount(raw) > 1) return { matched:true, supported:false, code:'PLAYLIST_URL_AMBIGUOUS', message:'一次只能导入一个歌单链接。' };
    var extracted = firstUrl(raw);
    if (!extracted) return { matched:false, supported:false, code:'NOT_A_URL' };
    if (extracted.length > 2048) return { matched:true, supported:false, code:'PLAYLIST_URL_TOO_LONG', message:'歌单链接过长。' };
    var parsed;
    try { parsed = new URL(extracted); } catch (_) {
      return { matched:true, supported:false, code:'PLAYLIST_URL_INVALID', message:'歌单链接格式无效。' };
    }
    if (parsed.protocol !== 'https:') {
      return { matched:true, supported:false, code:'PLAYLIST_URL_HTTPS_REQUIRED', message:'歌单链接必须使用 HTTPS。' };
    }
    if (parsed.username || parsed.password) {
      return { matched:true, supported:false, code:'PLAYLIST_URL_CREDENTIALS_FORBIDDEN', message:'歌单链接不得包含账号凭据。' };
    }
    if (parsed.port) return { matched:true, supported:false, code:'PLAYLIST_URL_PORT_FORBIDDEN', message:'歌单链接不得使用非标准端口。' };
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = parsed.hash || '';
    var host = parsed.hostname;
    var targetProvider = '';
    var playlistId = '';
    if (hostEnds(host, 'music.163.com') || hostEnds(host, '163cn.tv')) {
      targetProvider = 'netease';
      playlistId = queryId(parsed) || pathId(parsed.pathname + parsed.hash, [/\/playlist\/(?:detail\/)?([\w.-]+)/i]);
    } else if (hostEnds(host, 'y.qq.com') || hostEnds(host, 'qq.com') && /(?:^|\.)(?:c|c6|i|u|y)\.qq\.com$/i.test(host)) {
      targetProvider = 'qq';
      playlistId = queryId(parsed) || pathId(parsed.pathname, [/\/playlist\/([\w.-]+)/i, /\/taoge\/([\w.-]+)/i]);
    } else if (hostEnds(host, 'kugou.com')) {
      var conceptFlag = parsed.searchParams.get('appid') === '3116' || /(?:concept|lite|kugou_concept)/i.test(host + parsed.pathname + parsed.search);
      targetProvider = conceptFlag ? 'kugou_concept' : 'kugou';
      playlistId = queryId(parsed) || pathId(parsed.pathname, [/\/special\/single\/([\w.-]+?)(?:\.html|\/|$)/i, /\/(?:songlist|playlist|zlist)\/([\w.-]+)/i]);
    } else if (hostEnds(host, 'qishui.com') || hostEnds(host, 'qishui.douyin.com')) {
      targetProvider = 'qishui';
      playlistId = queryId(parsed) || pathId(parsed.pathname, [/\/(?:playlist|collection|song-list)\/([\w.-]+)/i]);
    }
    if (!targetProvider) {
      return { matched:true, supported:false, code:'PLAYLIST_HOST_UNSUPPORTED', message:'暂不支持该平台的歌单链接。', originalUrl:parsed.href };
    }
    if (playlistId && !/^\d+$/.test(playlistId)) {
      return { matched:true, supported:false, code:'PLAYLIST_ID_INVALID', message:'歌单 ID 格式无效。', provider:targetProvider, originalUrl:parsed.href };
    }
    return {
      matched:true,
      supported:true,
      provider:targetProvider,
      platform:targetProvider,
      label:LABELS[targetProvider],
      playlistId:playlistId,
      isShortLink:!playlistId,
      originalUrl:parsed.href,
      canonicalUrl:canonicalUrl(targetProvider, playlistId, parsed.href)
    };
  }

  function safeArtists(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 32).map(function (artist) {
      if (typeof artist === 'string') return { id:'', mid:'', name:text(artist, 180) };
      return { id:idValue(artist && artist.id), mid:idValue(artist && artist.mid), name:text(artist && artist.name, 180) };
    }).filter(function (artist) { return !!artist.name; });
  }
  function sanitizeSong(raw, targetProvider, index) {
    raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    var songProvider = provider(raw.provider || raw.source || targetProvider);
    if (!songProvider || songProvider !== targetProvider) {
      var providerError = new Error('PLAYLIST_TRACK_PROVIDER_INVALID');
      providerError.code = 'PLAYLIST_TRACK_PROVIDER_INVALID';
      providerError.index = index;
      throw providerError;
    }
    var songId = idValue(raw.id || raw.songId || raw.qqId || raw.mid || raw.songmid || raw.hash || raw.qishuiTrackId || raw.mixSongId);
    var name = text(raw.name || raw.title, 320);
    if (!songId || !name) {
      var trackError = new Error('PLAYLIST_TRACK_INVALID');
      trackError.code = 'PLAYLIST_TRACK_INVALID';
      trackError.index = index;
      throw trackError;
    }
    var duration = Math.max(0, finite(raw.duration != null ? raw.duration : (raw.durationMs != null ? raw.durationMs : raw.dt), 0));
    var sanitized = {
      provider:songProvider, source:songProvider, type:text(raw.type, 32) || songProvider,
      id:songId, songId:songId,
      qqId:idValue(raw.qqId), mid:idValue(raw.mid || raw.songmid), songmid:idValue(raw.songmid || raw.mid),
      mediaMid:idValue(raw.mediaMid || raw.media_mid), hash:idValue(raw.hash).toUpperCase(),
      hqHash:idValue(raw.hqHash).toUpperCase(), sqHash:idValue(raw.sqHash).toUpperCase(),
      albumId:idValue(raw.albumId || raw.album_id), albumAudioId:idValue(raw.albumAudioId || raw.album_audio_id),
      mixSongId:idValue(raw.mixSongId || raw.albumAudioId), qishuiTrackId:idValue(raw.qishuiTrackId || (songProvider === 'qishui' ? songId : '')),
      mediaType:text(raw.mediaType || raw.qishuiMediaType, 32), qishuiMediaType:text(raw.qishuiMediaType || raw.mediaType, 32),
      name:name, title:name, artist:text(raw.artist || raw.author, 320), artists:safeArtists(raw.artists),
      artistId:idValue(raw.artistId), artistMid:idValue(raw.artistMid), album:text(raw.album, 320),
      cover:safeUrl(raw.cover || raw.pic || raw.image, true), duration:duration, durationMs:duration,
      fee:finite(raw.fee, 0), playable:raw.playable === false ? false : (raw.playable === true ? true : null)
    };
    ['climaxStartSec', 'chorusStartSec', 'highlightStartSec'].forEach(function (field) {
      var value = finite(raw[field], NaN);
      if (isFinite(value) && value > 0) sanitized[field] = value;
    });
    return sanitized;
  }
  function normalizedUpdatedAt(value) {
    if (typeof value === 'number' && isFinite(value) && value > 0) return value;
    var stringValue = text(value, 80);
    return stringValue && !isNaN(Date.parse(stringValue)) ? stringValue : Date.now();
  }
  function sanitizeResolved(data, parsed) {
    data = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    if (data.ok === false) {
      var responseError = new Error(text(data.code || data.error || 'PLAYLIST_IMPORT_FAILED', 96));
      responseError.code = text(data.code || data.error || 'PLAYLIST_IMPORT_FAILED', 96);
      responseError.data = data;
      throw responseError;
    }
    var targetProvider = provider(data.provider || data.sourceProvider || parsed.provider);
    if (!targetProvider || targetProvider !== parsed.provider) {
      var mismatch = new Error('PLAYLIST_PROVIDER_MISMATCH'); mismatch.code = 'PLAYLIST_PROVIDER_MISMATCH'; throw mismatch;
    }
    var rawPlaylist = data.playlist && typeof data.playlist === 'object' ? data.playlist : {};
    var rawMetadata = data.metadata && typeof data.metadata === 'object' ? data.metadata : rawPlaylist;
    var playlistId = idValue(data.playlistId || rawPlaylist.playlistId || rawPlaylist.id || rawMetadata.playlistId || parsed.playlistId);
    if (!playlistId) { var idError = new Error('PLAYLIST_ID_MISSING'); idError.code = 'PLAYLIST_ID_MISSING'; throw idError; }
    var rawSongs = Array.isArray(data.songs) ? data.songs : (Array.isArray(data.tracks) ? data.tracks : (Array.isArray(rawPlaylist.songs) ? rawPlaylist.songs : null));
    if (!rawSongs) { var songsError = new Error('PLAYLIST_TRACKS_MISSING'); songsError.code = 'PLAYLIST_TRACKS_MISSING'; throw songsError; }
    if (rawSongs.length > MAX_SONGS) { var sizeError = new Error('PLAYLIST_TRACKS_TOO_LARGE'); sizeError.code = 'PLAYLIST_TRACKS_TOO_LARGE'; throw sizeError; }
    if ((data.private === true || data.requiresLogin === true) && data.loggedIn === false) {
      var loginError = new Error('PLAYLIST_LOGIN_REQUIRED'); loginError.code = 'PLAYLIST_LOGIN_REQUIRED'; throw loginError;
    }
    var songs = rawSongs.map(function (song, index) { return sanitizeSong(song, targetProvider, index); });
    var name = text(rawMetadata.name || rawPlaylist.name, 320);
    if (!name) { var metadataError = new Error('PLAYLIST_METADATA_INVALID'); metadataError.code = 'PLAYLIST_METADATA_INVALID'; throw metadataError; }
    var backendCanonical = safeUrl(data.normalizedUrl || data.canonicalUrl || rawPlaylist.canonicalUrl, true);
    var canonical = backendCanonical || canonicalUrl(targetProvider, playlistId, parsed.canonicalUrl);
    var canonicalParsed = parsePlaylistLink(canonical);
    if (!canonicalParsed.supported || canonicalParsed.provider !== targetProvider) {
      var urlError = new Error('PLAYLIST_CANONICAL_URL_INVALID'); urlError.code = 'PLAYLIST_CANONICAL_URL_INVALID'; throw urlError;
    }
    var count = Math.max(0, finite(rawMetadata.songCount != null ? rawMetadata.songCount : (rawMetadata.trackCount != null ? rawMetadata.trackCount : (rawPlaylist.songCount != null ? rawPlaylist.songCount : rawPlaylist.trackCount)), songs.length));
    var key = importKey(targetProvider, playlistId);
    var previous = readScope().items[key];
    var updatedAt = normalizedUpdatedAt(data.updatedAt || rawPlaylist.sourceUpdatedAt || rawPlaylist.updatedAt);
    return {
      schema:'lumifield.imported-playlist', version:VERSION,
      key:key, provider:targetProvider, source:targetProvider, id:playlistId, playlistId:playlistId,
      sourceProvider:targetProvider, sourcePlaylistId:playlistId,
      canonicalUrl:canonical, sourceUrl:safeUrl(data.sourceUrl || parsed.originalUrl, true) || parsed.originalUrl,
      updatedAt:updatedAt, createdAt:previous && previous.createdAt || Date.now(), importedAt:Date.now(),
      name:name, cover:safeUrl(rawMetadata.cover || rawPlaylist.cover, true),
      creator:text(rawMetadata.creator || rawMetadata.creatorName || rawPlaylist.creator, 240),
      creatorId:idValue(rawMetadata.creatorId || rawPlaylist.creatorId),
      description:text(rawMetadata.description || rawPlaylist.description, 1000),
      trackCount:count, songCount:count, songs:songs,
      metadata:{
        name:name, cover:safeUrl(rawMetadata.cover || rawPlaylist.cover, true),
        creator:text(rawMetadata.creator || rawMetadata.creatorName || rawPlaylist.creator, 240),
        songCount:count
      },
      private:data.private === true, requiresLogin:data.requiresLogin === true,
      lfImportedPlaylist:true, lfImportScope:scopeHash()
    };
  }

  function stripImported(list) {
    return (Array.isArray(list) ? list : []).filter(function (item) { return !(item && item.lfImportedPlaylist === true); });
  }
  function asUiPlaylist(record) {
    var value = {
      provider:record.sourceProvider, source:record.sourceProvider,
      id:record.sourcePlaylistId, playlistId:record.sourcePlaylistId,
      name:record.name, cover:record.cover, creator:record.creator,
      trackCount:record.trackCount, songCount:record.songCount,
      songs:clone(record.songs), canonicalUrl:record.canonicalUrl,
      sourceProvider:record.sourceProvider, sourcePlaylistId:record.sourcePlaylistId,
      updatedAt:record.updatedAt, lfImportedPlaylist:true, lfImportScope:scopeHash(),
      ownership:'unknown', subscribed:false, owned:false, canDelete:false, canUnsubscribe:false
    };
    return typeof global.normalizeUserPlaylist === 'function' ? global.normalizeUserPlaylist(record.sourceProvider, value) : value;
  }
  function mergeImported(list, targetProvider) {
    targetProvider = provider(targetProvider);
    var base = stripImported(list);
    var records = importedRecords(targetProvider);
    var positions = {};
    base.forEach(function (item, index) {
      var key = importKey(provider(item && (item.provider || item.source) || targetProvider), item && (item.id || item.playlistId));
      if (key) positions[key] = index;
    });
    records.forEach(function (record) {
      var value = asUiPlaylist(record);
      if (own(positions, record.key)) base[positions[record.key]] = value;
      else { positions[record.key] = base.length; base.push(value); }
    });
    return base;
  }
  function cacheProperty(targetProvider) {
    return targetProvider === 'qq' ? 'qqPlaylists' : (targetProvider === 'kugou' ? 'kugouPlaylists' : (targetProvider === 'kugou_concept' ? 'kugouConceptPlaylists' : (targetProvider === 'qishui' ? 'qishuiPlaylists' : 'neteasePlaylists')));
  }
  function renderRuntime(reason) {
    try { if (typeof global.renderUserPlaylistsList === 'function') global.renderUserPlaylistsList({ reset:true, animate:false }); } catch (_) {}
    try { if (typeof global.scheduleShelfRebuild === 'function') global.scheduleShelfRebuild(reason || 'playlist-link-import', true); } catch (_) {}
    try { if (global.emptyHomeActive && typeof global.renderHomeDiscover === 'function') global.renderHomeDiscover(); } catch (_) {}
  }
  function applyCurrentScopeToRuntime(targetProvider) {
    var selected = provider(targetProvider || global.playlistAccountProvider) || 'netease';
    PROVIDERS.forEach(function (itemProvider) {
      var property = cacheProperty(itemProvider);
      global[property] = mergeImported(global[property], itemProvider);
    });
    global.userPlaylists = mergeImported(global.userPlaylists, selected);
    renderRuntime('playlist-link-import-scope');
    return global.userPlaylists;
  }
  async function selectImportedProvider(targetProvider) {
    targetProvider = provider(targetProvider);
    if (!targetProvider) return;
    if (global.playlistAccountProvider !== targetProvider && typeof global.setPlaylistAccountProvider === 'function') {
      await Promise.resolve(global.setPlaylistAccountProvider(targetProvider, { force:true, refresh:true, source:'playlist-link-import' })).catch(function () {});
    }
    global.playlistAccountProvider = targetProvider;
    var property = cacheProperty(targetProvider);
    global[property] = mergeImported(global[property], targetProvider);
    global.userPlaylists = mergeImported(global[property], targetProvider);
    renderRuntime('playlist-link-import-confirm');
  }

  function createModal() {
    if (document.getElementById('lf-playlist-import-modal')) return;
    var modal = document.createElement('div');
    modal.id = 'lf-playlist-import-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'lf-playlist-import-title');
    modal.innerHTML =
      '<div class="lf-playlist-import-card">' +
        '<div class="lf-playlist-import-eyebrow">LF PLAYLIST SYNC</div>' +
        '<h2 id="lf-playlist-import-title">导入音乐歌单</h2>' +
        '<p class="lf-playlist-import-summary">LF 将通过对应平台的公开接口或当前登录会话读取真实歌单；不会绕过平台权限。</p>' +
        '<div class="lf-playlist-import-source">' +
          '<span>来源平台</span><b id="lf-playlist-import-provider">—</b>' +
          '<span>歌单 ID</span><code id="lf-playlist-import-id">等待解析</code>' +
          '<span>规范链接</span><code id="lf-playlist-import-url">—</code>' +
        '</div>' +
        '<div class="lf-playlist-import-progress-wrap"><div class="lf-playlist-import-progress-track"><div class="lf-playlist-import-progress-bar"></div></div><div id="lf-playlist-import-progress" role="status" aria-live="polite">确认后开始同步。</div></div>' +
        '<div class="lf-playlist-import-actions"><button id="lf-playlist-import-cancel" type="button">取消</button><button id="lf-playlist-import-confirm" type="button">确认导入</button></div>' +
      '</div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (event) { if (event.target === modal) cancelImport(); });
    document.getElementById('lf-playlist-import-confirm').addEventListener('click', function () { confirmImport(); });
    document.getElementById('lf-playlist-import-cancel').addEventListener('click', cancelImport);
  }
  function setProgress(value, message, kind) {
    state.progress = Math.max(0, Math.min(100, finite(value, 0)));
    var bar = document.querySelector('#lf-playlist-import-modal .lf-playlist-import-progress-bar');
    var progress = document.getElementById('lf-playlist-import-progress');
    if (bar) bar.style.width = state.progress + '%';
    if (progress) {
      progress.textContent = message || '';
      progress.classList.toggle('is-error', kind === 'error');
      progress.classList.toggle('is-success', kind === 'success');
    }
  }
  function renderPending() {
    createModal();
    var pending = state.pending || {};
    var providerNode = document.getElementById('lf-playlist-import-provider');
    var idNode = document.getElementById('lf-playlist-import-id');
    var urlNode = document.getElementById('lf-playlist-import-url');
    var confirm = document.getElementById('lf-playlist-import-confirm');
    var cancel = document.getElementById('lf-playlist-import-cancel');
    if (providerNode) providerNode.textContent = LABELS[pending.provider] || '未知平台';
    if (idNode) idNode.textContent = pending.playlistId || '短链将在平台端解析';
    if (urlNode) urlNode.textContent = pending.canonicalUrl || pending.originalUrl || '—';
    if (confirm) { confirm.disabled = state.phase === 'resolving' || state.phase === 'saving'; confirm.textContent = state.phase === 'success' ? '已导入' : (state.phase === 'error' ? '重试' : '确认导入'); }
    if (cancel) cancel.textContent = state.phase === 'success' ? '关闭' : '取消';
  }
  function openModal() { createModal(); document.getElementById('lf-playlist-import-modal').classList.add('is-open'); }
  function closeModal() { var modal = document.getElementById('lf-playlist-import-modal'); if (modal) modal.classList.remove('is-open'); }
  function errorInfo(error, targetProvider) {
    var data = error && error.data || {};
    var code = text(error && (error.code || error.message) || data.code || data.error || 'PLAYLIST_IMPORT_FAILED', 96);
    var label = LABELS[targetProvider] || '对应平台';
    var messages = {
      PLAYLIST_LOGIN_REQUIRED:'该歌单为私有歌单，请先登录' + label + '。',
      PLAYLIST_FORBIDDEN:'当前账号无权访问该歌单。',
      PLAYLIST_PERMISSION_DENIED:'当前账号无权访问该歌单。',
      PLAYLIST_NOT_FOUND:'未找到该歌单，请检查链接或歌单 ID。',
      PLAYLIST_DELETED:'该歌单已被删除。',
      PLAYLIST_LINK_UNSUPPORTED:'暂不支持该歌单链接。',
      PLAYLIST_HOST_UNSUPPORTED:'暂不支持该平台的歌单链接。',
      PLAYLIST_URL_INVALID:'歌单链接格式无效。',
      PLAYLIST_URL_HTTPS_REQUIRED:'歌单链接必须使用 HTTPS。',
      PLAYLIST_URL_CREDENTIALS_FORBIDDEN:'歌单链接不得包含账号凭据。',
      PLAYLIST_URL_PORT_FORBIDDEN:'歌单链接不得使用非标准端口。',
      PLAYLIST_URL_AMBIGUOUS:'一次只能导入一个歌单链接。',
      PLAYLIST_URL_TOO_LONG:'歌单链接过长。',
      PLAYLIST_ID_INVALID:'歌单 ID 格式无效。',
      PLAYLIST_ID_MISSING:'无法从该链接解析真实歌单 ID。',
      PLAYLIST_TRACKS_MISSING:'平台未返回歌单歌曲，请稍后重试。',
      PLAYLIST_TRACK_INVALID:'平台返回的歌曲数据不完整，未保存歌单。',
      PLAYLIST_TRACK_PROVIDER_INVALID:'平台返回的歌曲来源不一致，未保存歌单。',
      PLAYLIST_PROVIDER_MISMATCH:'平台返回结果与链接来源不一致，未保存歌单。',
      PLAYLIST_IMPORT_STORAGE_FULL:'本地存储空间不足，歌单未保存。',
      PLAYLIST_UPSTREAM_FAILED:'平台服务暂时不可用，请稍后重试。',
      UPSTREAM_REQUEST_FAILED:'平台服务暂时不可用，请稍后重试。',
      AbortError:'导入已取消。'
    };
    var message = messages[code] || text(data.message || error && error.message, 320) || '歌单导入失败，请稍后重试。';
    return { code:code, message:message };
  }
  function showDetectedHint(parsed) {
    var results = document.getElementById('search-results');
    if (!results) return;
    var message = parsed.supported
      ? ('检测到' + LABELS[parsed.provider] + '歌单链接，按 Enter 或点击“搜索”确认导入。')
      : (parsed.message || '暂不支持该歌单链接。');
    results.innerHTML = '<div class="search-empty">' + (typeof global.escHtml === 'function' ? global.escHtml(message) : message) + '</div>';
    results.classList.add('show');
  }

  function submit(input, options) {
    options = options || {};
    var source = /^(enter|button|input|api|doSearch)$/.test(text(options.source, 20)) ? text(options.source, 20) : 'api';
    state.lastSubmitSource = source;
    var parsed = parsePlaylistLink(input);
    if (!parsed.matched) {
      return typeof originalDoSearch === 'function' ? originalDoSearch.call(global, input, options) : Promise.resolve({ ok:false, code:'SEARCH_UNAVAILABLE' });
    }
    if (source === 'input') {
      showDetectedHint(parsed);
      return Promise.resolve({ ok:parsed.supported, detected:true, submitted:false, parsed:clone(parsed), code:parsed.code || '' });
    }
    if (!parsed.supported) {
      state.phase = 'error';
      state.pending = null;
      state.error = { code:parsed.code || 'PLAYLIST_LINK_UNSUPPORTED', message:parsed.message || '暂不支持该歌单链接。' };
      state.progress = 0;
      if (typeof global.showToast === 'function') global.showToast(state.error.message);
      return Promise.resolve({ ok:false, code:state.error.code, message:state.error.message });
    }
    if (state.abortController) state.abortController.abort();
    requestSerial += 1;
    state.abortController = null;
    state.phase = 'confirming';
    state.pending = Object.freeze(clone(parsed));
    state.error = null;
    state.lastRecord = null;
    openModal();
    setProgress(0, parsed.playlistId ? '已识别真实歌单 ID，等待确认。' : '已识别平台短链，确认后解析真实歌单 ID。');
    renderPending();
    return Promise.resolve({ ok:true, pending:clone(state.pending), phase:state.phase });
  }

  async function confirmImport() {
    if (state.phase === 'success' && state.lastRecord) return clone(state.lastRecord);
    if (state.phase === 'error' && !state.pending) { closeModal(); return { ok:false, code:state.error && state.error.code || 'PLAYLIST_IMPORT_FAILED' }; }
    if (!state.pending || state.phase === 'resolving' || state.phase === 'saving') return { ok:false, code:'PLAYLIST_IMPORT_NOT_PENDING' };
    var pending = clone(state.pending);
    var serial = ++requestSerial;
    var controller = global.AbortController ? new AbortController() : null;
    state.abortController = controller;
    state.phase = 'resolving';
    state.error = null;
    setProgress(14, '正在连接' + LABELS[pending.provider] + '…');
    renderPending();
    try {
      var response = await global.apiJson('/api/playlist-link/resolve', {
        method:'POST', headers:{ 'Content-Type':'application/json' }, timeoutMs:45000,
        signal:controller && controller.signal,
        body:JSON.stringify({ url:pending.originalUrl })
      });
      if (serial !== requestSerial) { var stale = new Error('AbortError'); stale.code = 'AbortError'; throw stale; }
      setProgress(58, '正在验证歌单信息和歌曲…');
      var record = sanitizeResolved(response, pending);
      if (serial !== requestSerial) { var staleAfter = new Error('AbortError'); staleAfter.code = 'AbortError'; throw staleAfter; }
      state.phase = 'saving';
      setProgress(82, '正在保存到当前 LF 用户…');
      renderPending();
      var scope = readScope();
      var nextItems = Object.assign({}, scope.items);
      nextItems[record.key] = record;
      writeScope({ items:nextItems });
      if (serial !== requestSerial) return { ok:false, code:'PLAYLIST_IMPORT_CANCELLED' };
      await selectImportedProvider(record.sourceProvider);
      state.phase = 'success';
      state.pending = Object.freeze({
        provider:record.sourceProvider, playlistId:record.sourcePlaylistId,
        canonicalUrl:record.canonicalUrl, originalUrl:pending.originalUrl
      });
      state.lastRecord = clone(record);
      state.error = null;
      setProgress(100, '已同步“' + record.name + '” · ' + record.songs.length + ' 首真实歌曲。', 'success');
      renderPending();
      if (typeof global.showToast === 'function') global.showToast('歌单已同步：' + record.name);
      return clone(record);
    } catch (error) {
      if (serial !== requestSerial || error && error.name === 'AbortError' || error && error.code === 'AbortError') {
        return { ok:false, code:'PLAYLIST_IMPORT_CANCELLED', message:'导入已取消。' };
      }
      var info = errorInfo(error, pending.provider);
      state.phase = 'error';
      state.error = info;
      setProgress(0, info.message, 'error');
      renderPending();
      state.pending = null;
      var closeButton = document.getElementById('lf-playlist-import-confirm');
      if (closeButton) closeButton.textContent = '关闭';
      if (typeof global.showToast === 'function') global.showToast(info.message);
      return { ok:false, code:info.code, message:info.message };
    } finally {
      if (serial === requestSerial) state.abortController = null;
    }
  }
  function cancelImport() {
    requestSerial += 1;
    if (state.abortController) state.abortController.abort();
    state.abortController = null;
    var persisted = state.phase === 'success';
    state.phase = 'cancelled';
    state.pending = null;
    state.error = null;
    state.progress = 0;
    closeModal();
    return { ok:true, cancelled:true, persisted:persisted };
  }

  function resolvePlaylistRef(value, fallbackProvider) {
    if (typeof global.parsePlaylistReference === 'function') return global.parsePlaylistReference(value, fallbackProvider || 'netease');
    var raw = text(value, 256), targetProvider = provider(fallbackProvider) || 'netease';
    var match = raw.match(/^(netease|qq|kugou|kugou_concept|qishui):(.*)$/);
    if (match) { targetProvider = match[1]; raw = match[2]; }
    return { provider:targetProvider, id:raw, key:targetProvider + ':' + raw, providerId:targetProvider === 'netease' ? raw : targetProvider + ':' + raw };
  }
  function loadImportedPlaylist(targetProvider, playlistId, options) {
    targetProvider = provider(targetProvider);
    playlistId = idValue(playlistId);
    var record = findImported(targetProvider, playlistId);
    if (!record) return { ok:false, code:'IMPORTED_PLAYLIST_NOT_FOUND', provider:targetProvider, playlistId:playlistId, songs:[] };
    var songs = clone(record.songs || []);
    state.lastLoadedSongs = clone(songs);
    state.lastLoadedSurface = /^(2d|3d)$/.test(text(options && options.surface, 8)) ? text(options.surface, 8) : 'api';
    return {
      ok:true, provider:targetProvider, playlistId:playlistId,
      canonicalUrl:record.canonicalUrl, sourceProvider:record.sourceProvider,
      sourcePlaylistId:record.sourcePlaylistId, updatedAt:record.updatedAt,
      metadata:clone(record.metadata), songs:songs
    };
  }
  async function loadImportedIntoQueue(record, autoplay, title) {
    var loaded = loadImportedPlaylist(record.sourceProvider, record.sourcePlaylistId, { surface:'2d' });
    if (!loaded.ok) return loaded;
    if (!loaded.songs.length) { if (typeof global.showToast === 'function') global.showToast('歌单为空'); return loaded; }
    if (typeof global.showLoading === 'function') global.showLoading();
    try {
      global.playQueue = loaded.songs.map(function (song) {
        var queued = typeof global.cloneSong === 'function' ? global.cloneSong(song) : clone(song);
        queued.sourcePlaylistKey = record.sourceProvider + ':' + record.sourcePlaylistId;
        queued.sourcePlaylistProvider = record.sourceProvider;
        queued.sourcePlaylistId = record.sourcePlaylistId;
        return queued;
      });
      global.currentIdx = 0;
      if (typeof global.safeRenderQueuePanel === 'function') global.safeRenderQueuePanel('imported-playlist-load');
      if (typeof global.safeSwitchPlaylistTab === 'function') global.safeSwitchPlaylistTab('queue', 'imported-playlist-load');
      if (typeof global.safeShelfRebuild === 'function') global.safeShelfRebuild('imported-playlist-load', true);
      if (typeof global.forcePlaybackControlsInteractive === 'function') global.forcePlaybackControlsInteractive();
      if (autoplay && typeof global.playQueueAt === 'function') await global.playQueueAt(0);
      if (typeof global.showToast === 'function') global.showToast('载入: ' + (title || record.name));
      return loaded;
    } finally { if (typeof global.hideLoading === 'function') global.hideLoading(); }
  }

  function installRuntimeHooks() {
    if (hooksInstalled) return;
    hooksInstalled = true;
    if (typeof originalDoSearch === 'function') {
      global.doSearch = function (query, options) {
        options = Object.assign({}, options || {});
        if (!options.source) options.source = 'doSearch';
        return submit(query, options);
      };
    }
    if (typeof originalSetProviderPlaylistCache === 'function') {
      global.setProviderPlaylistCache = function (targetProvider, playlists) {
        return originalSetProviderPlaylistCache.call(global, targetProvider, mergeImported(playlists, targetProvider));
      };
    }
    if (typeof originalRefreshUserPlaylists === 'function') {
      global.refreshUserPlaylists = async function (force, options) {
        options = options || {};
        var targetProvider = provider(options.provider || global.playlistAccountProvider) || 'netease';
        var imports = importedRecords(targetProvider);
        var loggedIn = typeof global.hasPlatformLogin === 'function' ? global.hasPlatformLogin(targetProvider) : true;
        if (imports.length && !loggedIn) {
          var property = cacheProperty(targetProvider);
          global[property] = mergeImported(global[property], targetProvider);
          if (targetProvider === global.playlistAccountProvider) global.userPlaylists = mergeImported(global[property], targetProvider);
          global.playlistPanelLoadError = '';
          renderRuntime('playlist-link-import-public');
          return { ok:true, provider:targetProvider, importedOnly:true, playlists:clone(global.userPlaylists) };
        }
        var result = await originalRefreshUserPlaylists.call(global, force, options);
        var cache = cacheProperty(targetProvider);
        global[cache] = mergeImported(global[cache], targetProvider);
        if (targetProvider === global.playlistAccountProvider) global.userPlaylists = mergeImported(global[cache], targetProvider);
        if (imports.length) {
          global.playlistPanelLoadError = '';
          renderRuntime('playlist-link-import-refresh');
          if (!result || result.ok === false) result = { ok:true, partial:true, provider:targetProvider, sourceError:result && result.error };
          result.playlists = clone(global[cache]);
          result.importedCount = imports.length;
        }
        return result;
      };
    }
    if (typeof originalLoadPlaylistIntoQueueById === 'function') {
      global.loadPlaylistIntoQueueById = function (value, autoplay, title) {
        var ref = resolvePlaylistRef(value, 'netease');
        var record = findImported(ref.provider, ref.id);
        return record ? loadImportedIntoQueue(record, autoplay, title) : originalLoadPlaylistIntoQueueById.call(global, value, autoplay, title);
      };
    }
  }

  function importedKeys() { return importedRecords().map(function (record) { return record.key; }); }
  function getDebug() {
    var keys = importedKeys();
    return {
      schema:SCHEMA, version:VERSION,
      phase:state.phase, pending:clone(state.pending), error:clone(state.error), progress:state.progress,
      importedKeys:keys, scopeHash:scopeHash(), lastSubmitSource:state.lastSubmitSource,
      view2DKeys:keys.slice(), view3DKeys:keys.slice(),
      lastLoadedSongs:clone(state.lastLoadedSongs), lastLoadedSurface:state.lastLoadedSurface,
      queueLength:Array.isArray(global.playQueue) ? global.playQueue.length : 0
    };
  }
  async function setTestUser(userId) {
    cancelImport();
    scopeOverride = text(userId, 240) || 'anonymous';
    applyCurrentScopeToRuntime(provider(global.playlistAccountProvider) || 'netease');
    return getDebug();
  }

  createModal();
  installRuntimeHooks();
  var searchButton = document.getElementById('search-submit-btn');
  if (searchButton) searchButton.addEventListener('click', function () {
    var input = document.getElementById('search-input');
    submit(input && input.value || '', { source:'button', autoPlayFirst:false });
  });
  document.addEventListener('lumifield-auth-user-change', function (event) {
    if (scopeOverride) return;
    observedUserId = text(event && event.detail && event.detail.userId, 240);
    cancelImport();
    applyCurrentScopeToRuntime(provider(global.playlistAccountProvider) || 'netease');
  });
  setTimeout(function () { applyCurrentScopeToRuntime(provider(global.playlistAccountProvider) || 'netease'); }, 0);

  global.LumiFieldPlaylistLinkImport = Object.freeze({
    schema:SCHEMA, version:VERSION,
    parser:parsePlaylistLink,
    submit:submit,
    confirm:confirmImport,
    cancel:cancelImport,
    loadImportedPlaylist:loadImportedPlaylist,
    removeImportedPlaylist:removeImportedPlaylist,
    getImportedPlaylists:function () { return clone(importedRecords()); },
    getDebug:getDebug,
    setTestUser:setTestUser
  });
})(window);
