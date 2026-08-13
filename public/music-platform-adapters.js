(function () {
  'use strict';

  var PROVIDERS = ['netease', 'qq', 'kugou', 'kugou_concept', 'qishui'];
  var LOGIN_ENTRIES = ['netease', 'qq', 'kugou', 'kugou_concept', 'qishui'];
  var NAMES = { netease: '网易云', qq: 'QQ音乐', kugou: '酷狗音乐', kugou_concept: '酷狗概念版', qishui: '汽水音乐' };
  var SHORT_NAMES = { netease: 'NE', qq: 'QQ', kugou: 'KG', kugou_concept: 'KGC', qishui: 'QS' };
  var registry = new Map();
  var songRegistry = new Map();
  var originalApiJson = window.apiJson;
  var originalFetchSearch = window.fetchMusicSearchResults;
  var originalProviderKey = window.songProviderKey;
  var originalSourceLabel = window.songSourceLabel;
  var originalCanReload = window.canReloadCurrentTrackForQuality;
  var originalPlayAudio = window.playAudio;
  var activePlatform = readActivePlatform();

  function providerKey(song) {
    var value = String(song && (song.provider || song.source || song.type) || '').toLowerCase();
    if (value === 'kugou' || value === 'kugou_concept' || value === 'qq' || value === 'netease' || value === 'qishui') return value;
    return typeof originalProviderKey === 'function' ? originalProviderKey(song) : 'netease';
  }

  function readActivePlatform() {
    try {
      var value = localStorage.getItem('lumifield-current-platform');
      return PROVIDERS.indexOf(value) >= 0 ? value : 'netease';
    } catch (_) { return 'netease'; }
  }

  function setActivePlatform(provider) {
    provider = String(provider || '').toLowerCase();
    if (PROVIDERS.indexOf(provider) < 0) provider = 'netease';
    activePlatform = provider;
    try { localStorage.setItem('lumifield-current-platform', provider); } catch (_) {}
    document.body.dataset.currentMusicPlatform = provider;
    try { document.dispatchEvent(new CustomEvent('lumifield-current-platform-change', { detail: { provider: provider } })); } catch (_) {}
    return provider;
  }

  function playlistError(code, message, provider, playlistId, details) {
    var error = new Error(message || code || 'PLAYLIST_TRACKS_FAILED');
    error.code = code || 'PLAYLIST_TRACKS_FAILED';
    error.provider = provider || '';
    error.playlistId = playlistId || '';
    error.details = details && typeof details === 'object' ? details : null;
    if (error.code === 'PLAYLIST_LOGIN_REQUIRED') error.loginRequired = true;
    return error;
  }

  function playlistAbortError(provider, playlistId) {
    var error = playlistError('PLAYLIST_TRACKS_ABORTED', '歌单详情加载已取消', provider, playlistId);
    error.name = 'AbortError';
    return error;
  }

  function rawPlaylistId(value, provider) {
    provider = String(provider || '').toLowerCase();
    var raw = String(value == null ? '' : value).trim();
    var match;
    while ((match = raw.match(/^(netease|qq|kugou|kugou_concept|qishui):(.*)$/i))) {
      if (match[1].toLowerCase() !== provider) {
        throw playlistError('PLAYLIST_PROVIDER_MISMATCH', '歌单平台与歌单 ID 不匹配', provider, raw, {
          idProvider: match[1].toLowerCase(),
        });
      }
      raw = String(match[2] || '').trim();
    }
    if (!raw) throw playlistError('MISSING_PLAYLIST_ID', '缺少歌单 ID', provider, '');
    if (raw.length > 180 || /[\u0000-\u001f\u007f]/.test(raw)) {
      throw playlistError('INVALID_PLAYLIST_ID', '歌单 ID 格式无效', provider, '');
    }
    return raw;
  }

  function playlistTracksPath(provider) {
    if (provider === 'qq') return '/api/qq/playlist/tracks';
    if (provider === 'kugou') return '/api/kugou/playlist/tracks';
    if (provider === 'kugou_concept') return '/api/kugou-concept/playlist/tracks';
    if (provider === 'qishui') return '/api/qishui/playlist/tracks';
    return '/api/playlist/tracks';
  }

  function playlistFailureCode(value) {
    var source = value && typeof value === 'object' ? value : {};
    var raw = String(source.code || source.error || source.message || '').trim();
    var numericCode = Number(source.code);
    if (source.loggedIn === false || source.sessionValid === false || numericCode === 301 || numericCode === 401 ||
        /(?:NOT_LOGGED_IN|LOGIN_REQUIRED|INVALID_(?:SESSION|COOKIE)|SESSION_(?:INVALID|EXPIRED|MISSING|NOT_CONFIGURED)|COOKIE_(?:MISSING|EXPIRED)|TOKEN_EXPIRED|AUTH(?:ENTICATION)?_(?:REQUIRED|EXPIRED)|UNAUTHORIZED)/i.test(raw)) {
      return 'PLAYLIST_LOGIN_REQUIRED';
    }
    if (numericCode === 403 || /(?:FORBIDDEN|PERMISSION|NO_ACCESS|ACCESS_DENIED)/i.test(raw)) return 'PLAYLIST_FORBIDDEN';
    if (numericCode === 404 || /(?:NOT_FOUND|PLAYLIST_DELETED)/i.test(raw)) return 'PLAYLIST_NOT_FOUND';
    if (/(?:TIMEOUT|TIMED_OUT)/i.test(raw)) return 'PLAYLIST_TRACKS_TIMEOUT';
    if (/(?:ABORT|CANCEL)/i.test(raw)) return 'PLAYLIST_TRACKS_ABORTED';
    if (/(?:MISSING_PLAYLIST_ID|INVALID_PLAYLIST_ID)/i.test(raw)) return raw.toUpperCase();
    return raw || 'PLAYLIST_TRACKS_FAILED';
  }

  function playlistFailureMessage(code, provider, value) {
    var label = NAMES[provider] || '对应音乐平台';
    if (code === 'PLAYLIST_LOGIN_REQUIRED') return '请重新登录' + label + '后加载该歌单';
    if (code === 'PLAYLIST_FORBIDDEN') return '当前' + label + '账号无权读取该歌单';
    if (code === 'PLAYLIST_NOT_FOUND') return '未找到该歌单，歌单可能已被删除';
    if (code === 'PLAYLIST_TRACKS_TIMEOUT') return label + '歌单详情请求超时';
    if (code === 'PLAYLIST_TRACKS_ABORTED') return '歌单详情加载已取消';
    return String(value && (value.message || value.error) || label + '歌单详情加载失败');
  }

  function normalizePlaylistTrack(provider, raw, index, playlistId) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw playlistError('PLAYLIST_TRACK_INVALID', '平台返回了无效歌曲记录', provider, playlistId, { index: index });
    }
    var sourceProvider = String(raw.provider || raw.source || raw.type || provider).toLowerCase();
    if (sourceProvider === 'song') sourceProvider = 'netease';
    if (sourceProvider !== provider) {
      throw playlistError('PLAYLIST_TRACK_PROVIDER_MISMATCH', '歌单歌曲平台与歌单平台不一致', provider, playlistId, {
        index: index,
        trackProvider: sourceProvider,
      });
    }
    var songId = String(raw.songId || raw.id || raw.mid || raw.songmid || raw.hash ||
      raw.qishuiTrackId || raw.mixSongId || raw.qqId || '').trim();
    var name = String(raw.name || raw.title || '').trim();
    if (!songId || !name) {
      throw playlistError('PLAYLIST_TRACK_INVALID', '平台返回的歌曲缺少真实 ID 或名称', provider, playlistId, { index: index });
    }
    var rawArtists = Array.isArray(raw.artists) ? raw.artists : [];
    var artist = String(raw.artist || raw.author || raw.singer ||
      rawArtists.map(function (item) { return typeof item === 'string' ? item : item && item.name; }).filter(Boolean).join(' / ') || '').trim();
    var albumValue = raw.album;
    var album = String(albumValue && typeof albumValue === 'object'
      ? (albumValue.name || albumValue.title || '')
      : (albumValue || '')).trim();
    var cover = String(raw.cover || raw.pic || raw.image ||
      albumValue && typeof albumValue === 'object' && (albumValue.picUrl || albumValue.coverUrl || albumValue.url_cover) || '').trim();
    var duration = Number(raw.duration != null ? raw.duration : (raw.durationMs != null ? raw.durationMs : raw.dt));
    if (!isFinite(duration) || duration < 0) duration = 0;
    var playable = raw.playable === true ? true : (raw.playable === false ? false : null);
    return Object.assign({}, raw, {
      provider: provider,
      source: provider,
      type: provider === 'netease' ? 'song' : provider,
      id: songId,
      songId: songId,
      name: name,
      title: name,
      artist: artist,
      album: album,
      cover: cover,
      duration: duration,
      playable: playable,
    });
  }

  function normalizePlaylistTracksResult(provider, playlistId, result) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw playlistError('PLAYLIST_TRACKS_RESPONSE_INVALID', '平台未返回有效歌单详情', provider, playlistId);
    }
    var resultCode = Number(result.code);
    if (result.ok === false || result.loggedIn === false || result.sessionValid === false || result.error ||
        resultCode === 301 || resultCode === 401 || resultCode === 403 || resultCode === 404) {
      var failureCode = playlistFailureCode(result);
      throw playlistError(failureCode, playlistFailureMessage(failureCode, provider, result), provider, playlistId, result);
    }
    var rows = Array.isArray(result.tracks) ? result.tracks : (Array.isArray(result.songs) ? result.songs : null);
    if (!rows) {
      throw playlistError('PLAYLIST_TRACKS_RESPONSE_INVALID', '平台歌单详情缺少歌曲列表', provider, playlistId, result);
    }
    var tracks = rows.map(function (track, index) {
      return normalizePlaylistTrack(provider, track, index, playlistId);
    });
    var rawPlaylist = result.playlist && typeof result.playlist === 'object' && !Array.isArray(result.playlist)
      ? result.playlist
      : {};
    var playlist = Object.assign({}, rawPlaylist, {
      provider: provider,
      source: provider,
      id: playlistId,
      playlistId: playlistId,
      trackCount: Math.max(0, Number(rawPlaylist.trackCount != null ? rawPlaylist.trackCount : rawPlaylist.songCount) || tracks.length),
      songCount: Math.max(0, Number(rawPlaylist.songCount != null ? rawPlaylist.songCount : rawPlaylist.trackCount) || tracks.length),
    });
    return Object.assign({}, result, {
      ok: true,
      provider: provider,
      playlistId: playlistId,
      playlist: playlist,
      tracks: tracks,
      songs: tracks,
      empty: tracks.length === 0,
    });
  }

  function normalizePlaylistRequestError(error, provider, playlistId, signal) {
    if (signal && signal.aborted || error && error.name === 'AbortError') return playlistAbortError(provider, playlistId);
    var payload = error && error.data && typeof error.data === 'object'
      ? error.data
      : (error && error.response && typeof error.response === 'object' ? error.response : error);
    var status = Number(error && error.status || payload && (payload.status || payload.statusCode) || 0);
    var code = status === 401 || status === 301
      ? 'PLAYLIST_LOGIN_REQUIRED'
      : (status === 403
        ? 'PLAYLIST_FORBIDDEN'
        : (status === 404
          ? 'PLAYLIST_NOT_FOUND'
          : (status === 408 || status === 504 ? 'PLAYLIST_TRACKS_TIMEOUT' : playlistFailureCode(payload))));
    var normalized = playlistError(code, playlistFailureMessage(code, provider, payload), provider, playlistId, payload);
    if (status) normalized.status = status;
    if (error && error.cause) normalized.cause = error.cause;
    return normalized;
  }

  function unavailable(feature) {
    return Promise.resolve({ ok: false, available: false, feature: feature, error: 'PLATFORM_FEATURE_UNAVAILABLE' });
  }

  function fetchJSON(url, options) {
    if (typeof originalApiJson === 'function') return originalApiJson(url, options);
    return fetch(url, options).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok) throw new Error(data.error || data.message || ('HTTP_' + response.status));
        return data;
      });
    });
  }

  function desktopCall(name, provider) {
    var api = window.desktopWindow;
    if (!api || typeof api[name] !== 'function') return unavailable(name);
    return Promise.resolve(api[name](provider));
  }

  function songKey(song) {
    var provider = providerKey(song);
    return provider + ':' + String(song && (song.hash || song.mid || song.songmid || song.id) || '');
  }

  function registerSong(song) {
    if (!song || typeof song !== 'object') return song;
    var key = songKey(song);
    if (!/:$/.test(key)) songRegistry.set(key, song);
    (song.alternatives || []).forEach(registerSong);
    return song;
  }

  function allKnownSongs() {
    var out = [];
    if (Array.isArray(window.playQueue)) out = out.concat(window.playQueue);
    if (Array.isArray(window.playlist)) out = out.concat(window.playlist);
    songRegistry.forEach(function (song) { out.push(song); });
    return out;
  }

  function findSong(provider, id) {
    provider = String(provider || '').toLowerCase();
    id = String(id || '');
    var direct = songRegistry.get(provider + ':' + id);
    if (direct) return direct;
    var known = allKnownSongs();
    for (var i = 0; i < known.length; i++) {
      var song = known[i];
      if (!song || providerKey(song) !== provider) continue;
      var ids = [song.id, song.hash, song.mid, song.songmid, song.qqId, song.qishuiTrackId].map(String);
      if (ids.indexOf(id) >= 0) return song;
    }
    return null;
  }

  function currentSongForId(id) {
    id = String(id || '');
    var song = window.playQueue && window.playQueue[window.currentIdx];
    if (!song) return null;
    var ids = [song.id, song.hash, song.mid, song.songmid, song.qqId, song.qishuiTrackId].map(String);
    return ids.indexOf(id) >= 0 ? song : null;
  }

  function appendSongParams(url, song) {
    var allowed = ['provider', 'id', 'qqId', 'mid', 'songmid', 'mediaMid', 'hash', 'hqHash', 'sqHash', 'albumId', 'albumAudioId', 'mixSongId', 'qishuiTrackId', 'mediaType', 'qishuiMediaType', 'name', 'artist', 'album', 'cover', 'duration', 'fee', 'climaxStartSec', 'chorusStartSec', 'highlightStartSec'];
    allowed.forEach(function (key) {
      var value = song && song[key];
      if (value != null && typeof value !== 'object' && String(value).length < 2048) url.searchParams.set(key, String(value));
    });
    url.searchParams.set('provider', providerKey(song));
    return url;
  }

  function MusicPlatformAdapter(config) {
    this.platformId = config.platformId;
    this.platformName = config.platformName;
    this.features = Object.assign({}, config.features || {});
  }

  MusicPlatformAdapter.prototype.login = function () {
    var id = this.platformId;
    return desktopCall('openMusicPlatformLogin', id);
  };
  MusicPlatformAdapter.prototype.importCookie = function (cookieText) {
    if (this.platformId !== 'qq') return unavailable('cookieImport');
    var api = window.desktopWindow;
    if (!api || typeof api.importMusicPlatformCookie !== 'function') return unavailable('cookieImport');
    return Promise.resolve(api.importMusicPlatformCookie('qq', String(cookieText || '')));
  };
  MusicPlatformAdapter.prototype.checkNeteaseQr = function (key) {
    if (this.platformId !== 'netease') return unavailable('neteaseQrCheck');
    var api = window.desktopWindow;
    if (!api || typeof api.checkNeteaseQrLogin !== 'function') return unavailable('neteaseQrCheck');
    return Promise.resolve(api.checkNeteaseQrLogin(String(key || '')));
  };
  MusicPlatformAdapter.prototype.logout = function () { return desktopCall('clearMusicPlatformLogin', this.platformId); };
  MusicPlatformAdapter.prototype.getLoginStatus = function () {
    var id = this.platformId;
    return desktopCall('getMusicPlatformLoginStatus', id).then(function (state) {
      if (state && typeof state.loggedIn === 'boolean') return state;
      if (id === 'netease' && window.loginStatus) return Object.assign({ provider: id, ok: true }, window.loginStatus);
      if (id === 'qq' && window.qqLoginStatus) return Object.assign({ provider: id, ok: true }, window.qqLoginStatus);
      if (id === 'kugou') return fetchJSON('/api/kugou/login/status');
      if (id === 'kugou_concept') return fetchJSON('/api/kugou-concept/login/status');
      if (id === 'qishui') return fetchJSON('/api/qishui/login/status');
      return state;
    });
  };
  MusicPlatformAdapter.prototype.getUserProfile = function () { return desktopCall('getMusicPlatformProfile', this.platformId); };
  MusicPlatformAdapter.prototype.getPlaylist = function () { return desktopCall('getMusicPlatformPlaylists', this.platformId); };
  MusicPlatformAdapter.prototype.getPlaylists = MusicPlatformAdapter.prototype.getPlaylist;
  MusicPlatformAdapter.prototype.getPlaylistTracks = async function (playlistId, options) {
    options = options && typeof options === 'object' ? options : {};
    var provider = this.platformId;
    var rawId = rawPlaylistId(playlistId, provider);
    var signal = options.signal || null;
    if (signal && signal.aborted) throw playlistAbortError(provider, rawId);
    var url = new URL(playlistTracksPath(provider), location.origin);
    url.searchParams.set('id', rawId);
    if (options.page != null && provider !== 'qishui') url.searchParams.set('page', String(options.page));
    if (options.cursor != null && provider === 'qishui') url.searchParams.set('cursor', String(options.cursor));
    if (options.limit != null) url.searchParams.set('limit', String(options.limit));
    try {
      var result = await fetchJSON(url.pathname + url.search, {
        signal: signal,
        timeoutMs: Number(options.timeoutMs) || 20000,
      });
      if (signal && signal.aborted) throw playlistAbortError(provider, rawId);
      return normalizePlaylistTracksResult(provider, rawId, result);
    } catch (error) {
      if (error && error.provider === provider && error.playlistId === rawId && error.code) throw error;
      throw normalizePlaylistRequestError(error, provider, rawId, signal);
    }
  };
  MusicPlatformAdapter.prototype.getPlaylistDetail = MusicPlatformAdapter.prototype.getPlaylistTracks;
  MusicPlatformAdapter.prototype.search = function (keywords, limit) {
    if (!navigator.onLine || (window.LFAuth && typeof window.LFAuth.isOnline === 'function' && !window.LFAuth.isOnline())) {
      return Promise.resolve({ ok:false, available:false, error:'OFFLINE_MODE', songs:[] });
    }
    return fetchJSON('/api/platform/search?keywords=' + encodeURIComponent(keywords || '') + '&limit=' + encodeURIComponent(limit || 18));
  };
  MusicPlatformAdapter.prototype.getSongUrl = function (song, quality, force) {
    var url = appendSongParams(new URL('/api/platform/resolve', location.origin), song);
    if (quality) url.searchParams.set('quality', quality);
    if (force) url.searchParams.set('force', '1');
    return fetchJSON(url.pathname + url.search);
  };
  MusicPlatformAdapter.prototype.getLyric = function (song) {
    var provider = providerKey(song);
    if (provider === 'qishui') return unavailable('lyric');
    var path = (provider === 'kugou' || provider === 'kugou_concept') ? '/api/kugou/lyric' : (provider === 'qq' ? '/api/qq/lyric' : '/api/lyric');
    var url = appendSongParams(new URL(path, location.origin), song);
    return fetchJSON(url.pathname + url.search);
  };
  MusicPlatformAdapter.prototype.refreshSession = function () { return this.getLoginStatus(); };
  MusicPlatformAdapter.prototype.persistSession = function () { return this.getLoginStatus().then(function (state) { return Object.assign({ persisted: true }, state); }); };
  MusicPlatformAdapter.prototype.clearSession = MusicPlatformAdapter.prototype.logout;
  MusicPlatformAdapter.prototype.isFeatureAvailable = function (feature) { return !!this.features[feature]; };

  PROVIDERS.forEach(function (provider) {
    registry.set(provider, new MusicPlatformAdapter({
      platformId: provider,
      platformName: NAMES[provider],
      features: { login: true, status: true, profile: true, search: provider !== 'qishui', songUrl: true, playlist: true, playlistTracks: true, playlistDetail: true, lyric: provider !== 'qishui', comments: provider !== 'qishui' },
    }));
  });

  var platformManager = {
    names: NAMES,
    current: function () { return activePlatform; },
    setActive: setActivePlatform,
    get: function (provider) { return registry.get(String(provider || '').toLowerCase()) || null; },
    list: function () { return Array.from(registry.values()); },
    login: function (provider) { var adapter = this.get(provider); return adapter ? adapter.login() : unavailable('login'); },
    importCookie: function (provider, cookieText) { var adapter = this.get(provider); return adapter ? adapter.importCookie(cookieText) : unavailable('cookieImport'); },
    checkNeteaseQr: function (key) { return registry.get('netease').checkNeteaseQr(key); },
    logout: function (provider) { var adapter = this.get(provider); return adapter ? adapter.logout() : unavailable('logout'); },
    status: function (provider) { var adapter = this.get(provider); return adapter ? adapter.getLoginStatus() : unavailable('status'); },
    profile: function (provider) { var adapter = this.get(provider); return adapter ? adapter.getUserProfile() : unavailable('profile'); },
    playlists: function (provider) { var adapter = this.get(provider); return adapter ? adapter.getPlaylist() : unavailable('playlist'); },
    readAccountPreferences: function () { return desktopCall('getMusicPlatformAccountPreferences'); },
    writeAccountPreferences: function (preferences, generation) {
      var api = window.desktopWindow;
      if (!api || typeof api.setMusicPlatformAccountPreferences !== 'function') return unavailable('setMusicPlatformAccountPreferences');
      return Promise.resolve(api.setMusicPlatformAccountPreferences(preferences, generation));
    },
    refreshLoginStates: function () { return refreshPlatformLoginStates(); },
    playlistTracks: function (provider, playlistId, options) {
      var adapter = this.get(provider);
      if (!adapter) return Promise.reject(playlistError('PLAYLIST_PROVIDER_UNSUPPORTED', '不支持该音乐平台', String(provider || ''), String(playlistId || '')));
      return adapter.getPlaylistTracks(playlistId, options);
    },
    playlistDetail: function (provider, playlistId, options) {
      return this.playlistTracks(provider, playlistId, options);
    },
    search: function (keywords, limit) { return registry.get('kugou').search(keywords, limit); },
    resolve: function (song, quality, force) { return registry.get(providerKey(song)).getSongUrl(song, quality, force); },
    lyrics: function (song) { return registry.get(providerKey(song)).getLyric(song); },
    loggedInPlatforms: function () {
      return Promise.all(PROVIDERS.map(function (provider) { return platformManager.status(provider); })).then(function (states) {
        return states.filter(function (state) {
          return state && state.loggedIn === true && state.sessionValid === true
            && state.ok !== false && !state.error && state.stale !== true
            && state.profileUnavailable !== true && state.pendingProfile !== true
            && state.ignoredStaleSession !== true;
        }).map(function (state) { return state.provider; });
      });
    },
  };

  function exposeManager() {
    window.MusicPlatformAdapter = MusicPlatformAdapter;
    window.LumiFieldMusicPlatforms = platformManager;
    window.LumiFieldMusicPlatformManager = platformManager;
  }

  window.songProviderKey = providerKey;
  window.songSourceLabel = function (song) {
    var provider = providerKey(song);
    if (provider === 'kugou' || provider === 'kugou_concept' || provider === 'qishui') return NAMES[provider];
    return typeof originalSourceLabel === 'function' ? originalSourceLabel(song) : NAMES[provider];
  };
  window.songSourceTagHtml = function (song) {
    var provider = providerKey(song);
    return '<span class="tag-source ' + provider + '">' + SHORT_NAMES[provider] + '</span>';
  };
  window.playbackProviderLabel = function (song) { return NAMES[providerKey(song)] || '音乐平台'; };
  window.playbackLoginProvider = function (song) { return providerKey(song); };
  window.canReloadCurrentTrackForQuality = function () {
    var song = window.playQueue && window.playQueue[window.currentIdx];
    return /^(?:kugou|kugou_concept|qishui)$/.test(providerKey(song)) || (typeof originalCanReload === 'function' && originalCanReload());
  };
  window.playAudio = async function (options) {
    if (typeof originalPlayAudio !== 'function') return false;
    var started = await originalPlayAudio(options);
    if (started) return true;
    var song = window.playQueue && window.playQueue[window.currentIdx];
    if (!song || song.type === 'local' || song.type === 'podcast') return false;
    var now = Date.now();
    if (now - Number(song._sourceRefreshAttemptAt || 0) < 10000) return false;
    song._sourceRefreshAttemptAt = now;
    try {
      var fresh = await platformManager.resolve(song, window.playbackQuality || '', true);
      if (!fresh || !fresh.url || !window.audio) return false;
      if (fresh.resolvedSong) Object.assign(song, fresh.resolvedSong);
      window.audio.src = '/api/audio?url=' + encodeURIComponent(fresh.url);
      window.audio.load();
      return originalPlayAudio(options);
    } catch (_) { return false; }
  };

  window.fetchMusicSearchResults = async function (query, mode, signal) {
    if (mode === 'podcast' && typeof originalFetchSearch === 'function') return originalFetchSearch(query, mode, signal);
    var data = await fetchJSON('/api/platform/search?keywords=' + encodeURIComponent(query || '') + '&limit=18', { signal: signal });
    var songs = data && Array.isArray(data.songs) ? data.songs : [];
    songs.forEach(function (song) {
      song._searchScore = Number(song.searchScore || 0) || 0;
      registerSong(song);
    });
    var priority = data && Array.isArray(data.priority) ? data.priority.slice() : ['kugou', 'netease', 'qq', 'qishui'];
    var qishuiSearchEnabled = !!(data && data.qishuiSearchEnabled === true);
    var qishuiSearchReason = qishuiSearchEnabled ? '' : '汽水音乐当前没有独立、可验证的合法搜索能力，未参与本次搜索';
    window.lumiFieldLastSearchProvider = priority.join('>');
    window.lumiFieldLastSearchUnsupported = qishuiSearchReason;
    window.lumiFieldLastSearchAudit = {
      query: query || '',
      priority: priority,
      providersTried: data && data.providersTried || [],
      qishuiSearchEnabled: qishuiSearchEnabled,
      qishuiSearchReason: qishuiSearchReason,
      rankingPolicy: data && data.rankingPolicy || '',
      firstResult: songs[0] ? {
        name: songs[0].name,
        artist: songs[0].artist,
        provider: providerKey(songs[0]),
        score: songs[0].searchScore,
        playable: songs[0].playable,
        officialOriginal: songs[0].officialOriginal === true
      } : null
    };
    return songs;
  };

  window.apiJson = async function (value, options) {
    var parsed;
    try { parsed = new URL(value, location.origin); } catch (_) { return fetchJSON(value, options); }
    var path = parsed.pathname;
    var provider = path === '/api/qq/song/url' ? 'qq' : 'netease';
    if (path === '/api/song/url' || path === '/api/qq/song/url') {
      var lookupId = parsed.searchParams.get(path === '/api/qq/song/url' ? 'mid' : 'id') || '';
      var song = currentSongForId(lookupId) || findSong(provider, lookupId) || (provider === 'netease' ? (findSong('kugou', lookupId) || findSong('kugou_concept', lookupId)) : null);
      if (song) {
        var target = appendSongParams(new URL('/api/platform/resolve', location.origin), song);
        var quality = parsed.searchParams.get('quality');
        if (quality) target.searchParams.set('quality', quality);
        var result = await fetchJSON(target.pathname + target.search, options);
        if (result && result.resolvedSong) {
          Object.assign(song, result.resolvedSong);
          registerSong(song);
        }
        return result;
      }
    }
    if (path === '/api/lyric' || path === '/api/song/comments') {
      var current = findSong('kugou', parsed.searchParams.get('id') || '') || findSong('kugou_concept', parsed.searchParams.get('id') || '');
      if (current) {
        var kugouPath = path === '/api/lyric' ? '/api/kugou/lyric' : '/api/kugou/song/comments';
        var kugouUrl = appendSongParams(new URL(kugouPath, location.origin), current);
        parsed.searchParams.forEach(function (item, key) { if (!kugouUrl.searchParams.has(key)) kugouUrl.searchParams.set(key, item); });
        return fetchJSON(kugouUrl.pathname + kugouUrl.search, options);
      }
    }
    return fetchJSON(value, options);
  };

  window.openProviderLogin = function (provider) {
    provider = String(provider || '').toLowerCase();
    var operationGuard = accountOperationGuard();
    if (!operationGuard.ready) return Promise.resolve({ ok:false, provider:provider, error:'ACCOUNT_SCOPE_NOT_READY' });
    var request = platformManager.login(provider);
    return Promise.resolve(request).then(function (result) {
      return isAccountOperationCurrent(operationGuard) ? result : { ok:false, provider:provider, stale:true, error:'STALE_ACCOUNT_SCOPE' };
    });
  };

  window.LumiFieldHotComments = {
    fetch: function (song, limit) {
      var url = new URL('/api/platform/hot-comments', location.origin);
      if (song) appendSongParams(url, song);
      if (limit) url.searchParams.set('limit', String(limit));
      return fetchJSON(url.pathname + url.search);
    },
  };

  var platformLoginRefreshSerial = 0;
  var platformLoginActionSerial = { netease:0, qq:0, kugou:0, kugou_concept:0, qishui:0 };

  function accountOperationGuard() {
    if (typeof window.getMusicAccountOperationGuard === 'function') return window.getMusicAccountOperationGuard();
    return Object.freeze({ scope:'', restoreSerial:0, ready:true, switching:false });
  }

  function isAccountOperationCurrent(guard) {
    var current = accountOperationGuard();
    return !!(guard && guard.ready === true && current.ready === true &&
      String(guard.scope || '') === String(current.scope || '') &&
      Number(guard.restoreSerial) === Number(current.restoreSerial));
  }

  function isValidatedLoginState(state) {
    return !!(state && state.loggedIn === true && state.stale !== true &&
      state.ok !== false && state.sessionValid === true && !state.error &&
      state.profileUnavailable !== true && state.pendingProfile !== true &&
      state.ignoredStaleSession !== true);
  }

  function platformLoginCard(provider) {
    return document.querySelector('[data-lf-platform-login="' + provider + '"]');
  }

  function renderPlatformLoginState(provider, state, profileResult) {
    var card = platformLoginCard(provider);
    if (!card) return;
    var loggedIn = isValidatedLoginState(state);
    var invalid = !!(state && state.loggedIn === true && !loggedIn);
    var profile = profileResult && profileResult.profile || state && state.profile || {};
    var avatar = card.querySelector('.lf-platform-login-avatar');
    var fallback = card.querySelector('.lf-platform-login-avatar-fallback');
    var detail = card.querySelector('.lf-platform-login-detail');
    var action = card.querySelector('.lf-platform-login-action');
    var avatarUrl = String(profile.avatar || profile.avatarUrl || '');
    var nickname = String(profile.nickname || profile.name || '').trim();
    card.dataset.loggedIn = loggedIn ? '1' : '0';
    card.dataset.sessionInvalid = invalid ? '1' : '0';
    card.classList.toggle('logged-in', loggedIn);
    if (avatar) {
      avatar.hidden = !loggedIn || !/^https:\/\//i.test(avatarUrl);
      avatar.removeAttribute('src');
      if (!avatar.hidden) avatar.src = avatarUrl;
    }
    if (fallback) fallback.hidden = !!(avatar && !avatar.hidden);
    if (detail) {
      detail.textContent = loggedIn
        ? (nickname ? '已登录 · ' + nickname : '已登录')
        : (invalid ? '登录已失效，请重新登录' : (state && state.ok === false ? '状态读取失败' : '未登录'));
    }
    if (action) {
      action.disabled = false;
      action.textContent = loggedIn ? '退出' : (invalid ? '重新登录' : '登录');
    }
  }

  function renderGatedPlatformEntry(provider) {
    var card = platformLoginCard(provider);
    if (!card) return;
    var detail = card.querySelector('.lf-platform-login-detail');
    var action = card.querySelector('.lf-platform-login-action');
    card.dataset.loggedIn = '0';
    card.dataset.gated = '1';
    if (detail) detail.textContent = '酷狗概念版完成后继续接入';
    if (action) {
      action.disabled = true;
      action.textContent = '待验收';
    }
  }

  async function refreshPlatformLoginState(provider, serial, operationGuard) {
    if (!isAccountOperationCurrent(operationGuard)) return;
    var card = platformLoginCard(provider);
    var detail = card && card.querySelector('.lf-platform-login-detail');
    var action = card && card.querySelector('.lf-platform-login-action');
    if (detail) detail.textContent = '正在读取…';
    if (action) action.disabled = true;
    try {
      var state = await platformManager.status(provider);
      if (serial !== platformLoginRefreshSerial || !isAccountOperationCurrent(operationGuard) || state && state.stale === true) return;
      var profileResult = null;
      if (isValidatedLoginState(state)) profileResult = await platformManager.profile(provider).catch(function () { return null; });
      if (serial !== platformLoginRefreshSerial || !isAccountOperationCurrent(operationGuard) || profileResult && profileResult.stale === true) return;
      if (profileResult && profileResult.profile) state = Object.assign({}, state || {}, { profile: profileResult.profile });
      if (typeof window.applyMusicPlatformLoginState === 'function') window.applyMusicPlatformLoginState(state || { provider: provider, loggedIn: false });
      if (card) renderPlatformLoginState(provider, state || { ok: false, loggedIn: false }, profileResult);
    } catch (_) {
      if (serial === platformLoginRefreshSerial && isAccountOperationCurrent(operationGuard) && card) {
        renderPlatformLoginState(provider, { ok: false, loggedIn: false }, null);
      }
    }
  }

  function refreshPlatformLoginStates() {
    var serial = ++platformLoginRefreshSerial;
    var operationGuard = accountOperationGuard();
    if (!operationGuard.ready) {
      PROVIDERS.forEach(function (provider) {
        var card = platformLoginCard(provider);
        var detail = card && card.querySelector('.lf-platform-login-detail');
        var action = card && card.querySelector('.lf-platform-login-action');
        if (card) { card.dataset.loggedIn = '0'; card.dataset.sessionInvalid = '0'; card.classList.remove('logged-in'); }
        if (detail) detail.textContent = '账号状态切换中…';
        if (action) { action.disabled = true; action.textContent = '请稍候'; }
      });
      return;
    }
    PROVIDERS.forEach(function (provider) { refreshPlatformLoginState(provider, serial, operationGuard); });
  }

  function installPlatformLoginPanel() {
    if (document.getElementById('lf-platform-login-states')) return;
    var tabs = document.getElementById('login-platform-tabs');
    if (!tabs || !tabs.parentNode) return;
    var panel = document.createElement('div');
    panel.id = 'lf-platform-login-states';
    panel.className = 'lf-platform-login-states';
    panel.setAttribute('aria-label', '音乐平台登录状态');
    LOGIN_ENTRIES.forEach(function (provider) {
      var card = document.createElement('div');
      card.className = 'lf-platform-login-card ' + provider;
      card.dataset.lfPlatformLogin = provider;

      var avatarWrap = document.createElement('span');
      avatarWrap.className = 'lf-platform-login-avatar-wrap';
      var avatar = document.createElement('img');
      avatar.className = 'lf-platform-login-avatar';
      avatar.alt = '';
      avatar.referrerPolicy = 'no-referrer';
      avatar.hidden = true;
      var fallback = document.createElement('span');
      fallback.className = 'lf-platform-login-avatar-fallback';
      fallback.textContent = SHORT_NAMES[provider];
      avatarWrap.appendChild(avatar);
      avatarWrap.appendChild(fallback);

      var copy = document.createElement('span');
      copy.className = 'lf-platform-login-copy';
      var name = document.createElement('b');
      name.textContent = NAMES[provider];
      var detail = document.createElement('span');
      detail.className = 'lf-platform-login-detail';
      detail.textContent = '正在读取…';
      copy.appendChild(name);
      copy.appendChild(detail);

      var action = document.createElement('button');
      action.className = 'lf-platform-login-action';
      action.type = 'button';
      action.textContent = '登录';
      action.dataset.provider = provider;

      card.appendChild(avatarWrap);
      card.appendChild(copy);
      card.appendChild(action);
      panel.appendChild(card);
    });
    tabs.parentNode.insertBefore(panel, tabs.nextSibling);
    LOGIN_ENTRIES.filter(function (provider) { return PROVIDERS.indexOf(provider) < 0; }).forEach(renderGatedPlatformEntry);
    panel.addEventListener('click', async function (event) {
      var action = event.target.closest('.lf-platform-login-action');
      if (!action || action.disabled) return;
      var provider = action.dataset.provider;
      var card = platformLoginCard(provider);
      var loggedIn = !!(card && card.dataset.loggedIn === '1');
      if (loggedIn && !window.confirm('仅退出' + NAMES[provider] + '，其他平台和 LF 账号不受影响。')) return;
      var operationGuard = accountOperationGuard();
      if (!operationGuard.ready) return refreshPlatformLoginStates();
      var operationSerial = ++platformLoginActionSerial[provider];
      action.disabled = true;
      var detail = card && card.querySelector('.lf-platform-login-detail');
      if (detail) detail.textContent = loggedIn ? '正在退出…' : '等待官方登录…';
      try {
        var result = loggedIn ? await platformManager.logout(provider) : await platformManager.login(provider);
        if (!isAccountOperationCurrent(operationGuard) || operationSerial !== platformLoginActionSerial[provider] || result && result.stale === true) return;
        if (result && result.ok === false) throw new Error(result.error || result.message || (loggedIn ? 'LOGOUT_FAILED' : 'LOGIN_FAILED'));
      } catch (error) {
        if (isAccountOperationCurrent(operationGuard) && operationSerial === platformLoginActionSerial[provider] && detail) {
          detail.textContent = error && error.message ? error.message : '操作失败';
        }
      } finally {
        if (isAccountOperationCurrent(operationGuard) && operationSerial === platformLoginActionSerial[provider]) {
          setTimeout(refreshPlatformLoginStates, loggedIn ? 0 : 800);
        }
      }
    });

    var modal = document.getElementById('login-modal');
    if (modal && typeof MutationObserver === 'function') {
      new MutationObserver(function () {
        if (modal.classList.contains('show')) refreshPlatformLoginStates();
      }).observe(modal, { attributes: true, attributeFilter: ['class'] });
      if (modal.classList.contains('show')) refreshPlatformLoginStates();
    }
    var desktop = window.desktopWindow;
    if (desktop && typeof desktop.onMusicPlatformLoginState === 'function') {
      desktop.onMusicPlatformLoginState(function (state) {
        if (!state || state.stale === true || PROVIDERS.indexOf(state.provider) < 0) return;
        if (typeof window.applyMusicPlatformLoginState === 'function') window.applyMusicPlatformLoginState(state, { forceRefresh: true, source: 'desktop-event' });
        refreshPlatformLoginStates();
      });
    }
  }

  function installKugouLoginButton() {
    if (document.getElementById('login-provider-kugou')) return;
    var qq = document.getElementById('login-provider-qq');
    if (!qq || !qq.parentNode) return;
    var button = document.createElement('button');
    button.id = 'login-provider-kugou';
    button.className = 'kugou';
    button.type = 'button';
    button.textContent = '酷狗音乐';
    button.onclick = function () {
      var status = document.getElementById('qr-status');
      if (status) { status.className = 'preview'; status.textContent = '已打开酷狗音乐扫码窗口'; }
      Promise.resolve(window.openProviderLogin('kugou')).catch(function (error) {
        if (status) { status.className = 'fail'; status.textContent = error.message || '酷狗登录窗口打开失败'; }
      });
    };
    qq.parentNode.insertBefore(button, qq.nextSibling);
  }

  function installLoginUi() {
    installKugouLoginButton();
    installPlatformLoginPanel();
    refreshPlatformLoginStates();
  }

  exposeManager();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installLoginUi, { once: true });
  else installLoginUi();
  setTimeout(exposeManager, 900);
  setTimeout(exposeManager, 1600);
})();
