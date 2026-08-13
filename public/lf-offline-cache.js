(function (global) {
  'use strict';

  var DB_NAME = 'lumifield-offline-media-v1';
  var STORE = 'tracks';
  var DB_VERSION = 3;
  var CAPACITY_KEY = 'lf-offline-capacity-bytes-v1';
  var DEFAULT_CAPACITY = 2 * 1024 * 1024 * 1024;
  var MIN_CAPACITY = 256 * 1024 * 1024;
  var MAX_CAPACITY = 20 * 1024 * 1024 * 1024;
  var MAX_SINGLE = 4 * 1024 * 1024 * 1024;
  var autoController = null;
  var autoSource = '';
  var boundAudio = null;
  var autoTimer = 0;
  var enrichmentTimer = 0;
  var offlineCoverUrl = '';
  var MAX_COVER = 20 * 1024 * 1024;
  var MAX_LYRIC_JSON = 1024 * 1024;

  function rowBytes(row) { return Number(row && (row.totalSize || row.size) || 0); }

  function accountId() {
    try {
      var user = global.LFAuth && global.LFAuth.getUser && global.LFAuth.getUser();
      return user && user.id ? String(user.id) : 'local';
    } catch (_) { return 'local'; }
  }
  function capacityBytes() {
    var value = Number(localStorage.getItem(CAPACITY_KEY) || DEFAULT_CAPACITY);
    return Math.max(MIN_CAPACITY, Math.min(MAX_CAPACITY, isFinite(value) ? value : DEFAULT_CAPACITY));
  }
  function setCapacityBytes(value) {
    value = Math.max(MIN_CAPACITY, Math.min(MAX_CAPACITY, Number(value) || DEFAULT_CAPACITY));
    localStorage.setItem(CAPACITY_KEY, String(value));
    return trim(0).then(function () { return status(); });
  }
  function openDb() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        var store;
        if (!request.result.objectStoreNames.contains(STORE)) store = request.result.createObjectStore(STORE, { keyPath: 'key' });
        else store = request.transaction.objectStore(STORE);
        if (!store.indexNames.contains('savedAt')) store.createIndex('savedAt', 'savedAt');
        if (!store.indexNames.contains('lastAccessAt')) store.createIndex('lastAccessAt', 'lastAccessAt');
        if (!store.indexNames.contains('accountId')) store.createIndex('accountId', 'accountId');
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('OFFLINE_DB_OPEN_FAILED')); };
    });
  }
  function run(mode, action) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode), value;
        try { value = action(tx.objectStore(STORE)); } catch (error) { db.close(); reject(error); return; }
        tx.oncomplete = function () { db.close(); resolve(value); };
        tx.onerror = function () { var error = tx.error || new Error('OFFLINE_DB_TRANSACTION_FAILED'); db.close(); reject(error); };
        tx.onabort = tx.onerror;
      });
    });
  }
  async function allRows() {
    var db = await openDb();
    try {
      return await new Promise(function (resolve, reject) {
        var request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        request.onsuccess = function () { resolve(request.result || []); };
        request.onerror = function () { reject(request.error); };
      });
    } finally { db.close(); }
  }
  async function list() {
    var owner = accountId();
    return (await allRows()).filter(function (row) { return String(row.accountId || 'legacy') === owner; })
      .sort(function (a, b) { return Number(b.lastAccessAt || b.savedAt || 0) - Number(a.lastAccessAt || a.savedAt || 0); });
  }
  async function recordForKey(key) {
    var db = await openDb();
    try {
      return await new Promise(function (resolve, reject) {
        var request = db.transaction(STORE, 'readonly').objectStore(STORE).get(String(key || ''));
        request.onsuccess = function () { resolve(request.result || null); };
        request.onerror = function () { reject(request.error); };
      });
    } finally { db.close(); }
  }
  async function trim(requiredBytes, protectedKey) {
    var rows = await list();
    var total = rows.reduce(function (sum, row) { return sum + rowBytes(row); }, 0);
    var limit = capacityBytes();
    var remove = [];
    rows.slice().reverse().forEach(function (row) {
      if (total + Number(requiredBytes || 0) <= limit || row.key === protectedKey) return;
      total -= rowBytes(row); remove.push(row.key);
    });
    if (remove.length) await run('readwrite', function (store) { remove.forEach(function (key) { store.delete(key); }); });
    return { removed: remove.length, availableBytes: Math.max(0, limit - total) };
  }
  function safeName(value) { return String(value || '离线歌曲').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 160); }
  function compactLyrics(lines) {
    var output = [], bytes = 2;
    (Array.isArray(lines) ? lines : []).slice(0, 10000).some(function (line) {
      if (!line) return false;
      var item = {
        t:Number(line.t || 0), duration:Number(line.duration || 0),
        text:String(line.text || '').slice(0, 4000), translation:String(line.translation || line.trans || '').slice(0, 4000),
      };
      if (Array.isArray(line.words)) item.words = line.words.slice(0, 1000).map(function (word) {
        return { t:Number(word.t || 0), duration:Number(word.duration || 0), text:String(word.text || '').slice(0, 400) };
      });
      var encoded = JSON.stringify(item);
      if (bytes + encoded.length > MAX_LYRIC_JSON) return true;
      output.push(item); bytes += encoded.length + 1; return false;
    });
    return output;
  }
  function songMetadata(song) {
    song = song || {};
    var active = compactLyrics(global.lyricsLines);
    var original = compactLyrics(global.originalLyricsState && global.originalLyricsState.lines);
    return {
      id: String(song.id || song.mid || song.songmid || ''), provider: String(song.provider || song.source || ''),
      name: safeName(song.name || song.title || '离线歌曲'), artist: String(song.artist || song.singer || '').slice(0, 160),
      cover: String(song.cover || song.pic || '').slice(0, 1200), album: String(song.album || '').slice(0, 160),
      lyricsLines: active, originalLyricsLines: original,
      lyricsHasNativeKaraoke: !!global.lyricsHasNativeKaraoke,
      lyricsTimingSource: String(global.lyricsTimingSource || 'offline-cache').slice(0, 80),
    };
  }
  function keyFor(file, metadata) {
    if (metadata && (metadata.id || metadata.provider)) return [accountId(), metadata.provider || '', metadata.id || '', metadata.name || '', Number(file.size || 0)].join(':');
    return [accountId(), file.name || 'track', Number(file.size || 0), Number(file.lastModified || 0)].join(':');
  }
  async function putBlob(blob, metadata, fileInfo) {
    if (!blob || !Number(blob.size)) return { ok:false, error:'INVALID_AUDIO_FILE' };
    if (blob.size > MAX_SINGLE || blob.size > capacityBytes()) return { ok:false, error:'AUDIO_CACHE_TOO_LARGE', message:'歌曲超过当前离线缓存容量。' };
    var provisional = keyFor({ name:fileInfo.name, size:blob.size, lastModified:fileInfo.lastModified }, metadata);
    var previous = await recordForKey(provisional);
    var coverBlob = fileInfo.coverBlob && Number(fileInfo.coverBlob.size) <= MAX_COVER ? fileInfo.coverBlob : null;
    var totalSize = Number(blob.size) + Number(coverBlob && coverBlob.size || 0);
    var required = Math.max(0, totalSize - rowBytes(previous));
    var room = await trim(required, provisional);
    if (room.availableBytes < required) return { ok:false, error:'OFFLINE_CACHE_FULL' };
    var now = Date.now();
    var record = {
      key: provisional, accountId: accountId(), name: safeName(fileInfo.name || metadata.name), type: String(fileInfo.type || blob.type || 'audio/mpeg'),
      size: Number(blob.size), totalSize:totalSize, lastModified: Number(fileInfo.lastModified || now), savedAt: previous && previous.savedAt || now,
      lastAccessAt: now, metadata: metadata || {}, policy: 'lawfully-resolved-playable-response', blob: blob,
      coverBlob:coverBlob,
    };
    await run('readwrite', function (store) { store.put(record); });
    return { ok:true, key:record.key, name:record.name, size:record.size, automatic:!!fileInfo.automatic };
  }
  async function cacheFile(file, metadata) {
    if (!file || !file.name || !Number(file.size)) return { ok:false, error:'INVALID_AUDIO_FILE' };
    return putBlob(file, metadata || {}, { name:file.name, type:file.type, lastModified:file.lastModified, automatic:false });
  }
  function cacheAllowed(song) {
    if (!song) return true;
    return !(song.drm || song.cacheable === false || song.downloadable === false || song.trialOnly || song.previewOnly || song.localOnly === false && song.noCache);
  }
  function currentSong() {
    return Array.isArray(global.playQueue) && Number(global.currentIdx) >= 0 ? global.playQueue[global.currentIdx] || null : null;
  }
  async function fetchCoverBlob(url) {
    url = String(url || '');
    if (!url) return null;
    try {
      var parsed = new URL(url, location.href), target = parsed.href;
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        if (parsed.origin !== location.origin) target = '/api/cover?url=' + encodeURIComponent(parsed.href);
      } else if (parsed.protocol !== 'blob:' && parsed.protocol !== 'data:') return null;
      var response = await fetch(target, { credentials:'same-origin', redirect:'error' });
      if (!response.ok) return null;
      var announced = Number(response.headers.get('content-length') || 0);
      var type = String(response.headers.get('content-type') || '');
      if (announced > MAX_COVER || (type && !/^image\//i.test(type))) return null;
      var blob = await response.blob();
      return blob.size && blob.size <= MAX_COVER && /^image\//i.test(blob.type || type) ? blob : null;
    } catch (_) { return null; }
  }
  async function cacheCurrentOnlineSong() {
    var audio = global.audio, song = currentSong();
    if (!navigator.onLine || !audio || !audio.currentSrc || !cacheAllowed(song)) return { ok:false, error:'CACHE_POLICY_BLOCKED' };
    var source;
    try { source = new URL(audio.currentSrc, location.href); } catch (_) { return { ok:false, error:'INVALID_AUDIO_URL' }; }
    if (source.origin !== location.origin || source.pathname !== '/api/audio') return { ok:false, error:'ONLY_RESOLVED_ONLINE_AUDIO' };
    var meta = songMetadata(song);
    var known = (await list()).find(function (row) { return row.metadata && row.metadata.id === meta.id && row.metadata.provider === meta.provider; });
    if (known) {
      var lyricsCurrent = JSON.stringify(meta.lyricsLines || []);
      var lyricsCached = JSON.stringify(known.metadata && known.metadata.lyricsLines || []);
      var originalCurrent = JSON.stringify(meta.originalLyricsLines || []);
      var originalCached = JSON.stringify(known.metadata && known.metadata.originalLyricsLines || []);
      var coverComplete = !meta.cover || !!known.coverBlob;
      if (lyricsCurrent === lyricsCached && originalCurrent === originalCached && coverComplete) {
        await touch(known.key); return { ok:true, cached:true, key:known.key };
      }
      var enrichedCover = known.coverBlob || await fetchCoverBlob(meta.cover);
      return putBlob(known.blob, meta, { name:known.name, type:known.type, lastModified:known.lastModified, automatic:true, coverBlob:enrichedCover });
    }
    if (autoController) autoController.abort();
    autoController = new AbortController(); autoSource = source.href;
    try {
      var response = await fetch(source.href, { signal:autoController.signal, redirect:'error', credentials:'same-origin' });
      if (!response.ok || response.status !== 200) return { ok:false, error:'AUDIO_CACHE_HTTP_' + response.status };
      var announced = Number(response.headers.get('content-length') || 0);
      if (announced > MAX_SINGLE || announced > capacityBytes()) return { ok:false, error:'AUDIO_CACHE_TOO_LARGE' };
      var contentType = String(response.headers.get('content-type') || 'audio/mpeg');
      if (!/^audio\//i.test(contentType) && !/octet-stream/i.test(contentType)) return { ok:false, error:'INVALID_AUDIO_RESPONSE' };
      var blob = await response.blob();
      if (!global.audio || new URL(global.audio.currentSrc, location.href).href !== autoSource) return { ok:false, error:'TRACK_CHANGED' };
      var extension = /flac/i.test(contentType) ? '.flac' : /wav/i.test(contentType) ? '.wav' : /mp4|m4a|aac/i.test(contentType) ? '.m4a' : '.mp3';
      var coverBlob = await fetchCoverBlob(meta.cover);
      return putBlob(blob, meta, { name:meta.name + ' - ' + (meta.artist || '未知歌手') + extension, type:contentType, lastModified:Date.now(), automatic:true, coverBlob:coverBlob });
    } catch (error) {
      return { ok:false, error:error && error.name === 'AbortError' ? 'CACHE_CANCELLED' : 'AUDIO_CACHE_FAILED' };
    } finally { autoController = null; autoSource = ''; }
  }
  async function touch(key) {
    var row = await recordForKey(key);
    if (!row || String(row.accountId || '') !== accountId()) return false;
    row.lastAccessAt = Date.now(); await run('readwrite', function (store) { store.put(row); }); return true;
  }
  async function play(key) {
    var row = await recordForKey(key);
    if (!row || String(row.accountId || '') !== accountId() || !row.blob) return { ok:false, error:'NO_OFFLINE_AUDIO' };
    if (typeof global.handleFiles !== 'function') return { ok:false, error:'PLAYER_NOT_READY' };
    await touch(row.key);
    if (offlineCoverUrl) { try { URL.revokeObjectURL(offlineCoverUrl); } catch (_) {} offlineCoverUrl = ''; }
    if (row.coverBlob) offlineCoverUrl = URL.createObjectURL(row.coverBlob);
    var file = new File([row.blob], row.name, { type:row.type || row.blob.type || 'audio/mpeg', lastModified:row.lastModified || Date.now() });
    file.lfOfflinePlayback = true;
    file.lfOfflineMetadata = row.metadata || {};
    file.lfOfflineCoverUrl = offlineCoverUrl;
    global.handleFiles([file]);
    return { ok:true, key:row.key, name:row.name, metadata:row.metadata || {} };
  }
  async function playLast() { var rows = await list(); return rows[0] ? play(rows[0].key) : { ok:false, error:'NO_OFFLINE_AUDIO', message:'当前 LF 账号暂无离线音乐缓存。' }; }
  async function remove(key) {
    var row = await recordForKey(key);
    if (!row || String(row.accountId || '') !== accountId()) return { ok:false, error:'NOT_FOUND' };
    await run('readwrite', function (store) { store.delete(row.key); }); return { ok:true };
  }
  async function clear() {
    var rows = await list(); await run('readwrite', function (store) { rows.forEach(function (row) { store.delete(row.key); }); }); return { ok:true, removed:rows.length };
  }
  async function status() {
    var rows = await list(), total = rows.reduce(function (sum, row) { return sum + rowBytes(row); }, 0);
    return { ok:true, accountId:accountId(), count:rows.length, totalBytes:total, capacityBytes:capacityBytes(), latest:rows[0] ? rows[0].name : '' };
  }
  function formatBytes(value) {
    var number = Number(value) || 0, units = ['B','KB','MB','GB','TB'], index = 0;
    while (number >= 1024 && index < units.length - 1) { number /= 1024; index++; }
    return (index ? number.toFixed(number >= 10 ? 1 : 2) : Math.round(number)) + ' ' + units[index];
  }
  async function renderSettings() {
    var root = document.getElementById('lf-offline-settings'); if (!root) return;
    var info = await status();
    root.querySelector('select').value = String(info.capacityBytes);
    root.querySelector('.lf-offline-cache-status').textContent = '已使用 ' + formatBytes(info.totalBytes) + ' / ' + formatBytes(info.capacityBytes) + ' · 按最近最少使用自动清理';
  }
  function injectSettings() {
    if (document.getElementById('lf-offline-settings')) return;
    var sections = Array.prototype.slice.call(document.querySelectorAll('#lf-profile-modal .lf-profile-section'));
    var target = sections.find(function (section) { var h = section.querySelector('h3'); return h && h.textContent.trim() === '设置'; });
    if (!target) return;
    var root = document.createElement('div'); root.id = 'lf-offline-settings'; root.className = 'lf-offline-settings';
    root.innerHTML = '<div><b>自动离线缓存</b><label>容量 <select><option value="536870912">512 MB</option><option value="1073741824">1 GB</option><option value="2147483648">2 GB</option><option value="5368709120">5 GB</option><option value="10737418240">10 GB</option><option value="21474836480">20 GB</option></select></label><button data-offline-clear>清空当前账号</button></div><p class="lf-offline-cache-status"></p>';
    target.appendChild(root);
    root.querySelector('select').onchange = function () { setCapacityBytes(this.value).then(renderSettings); };
    root.onclick = function (event) {
      if (event.target.closest('[data-offline-clear]') && global.confirm('清空当前 LF 账号的离线歌曲？')) clear().then(renderSettings);
    };
    renderSettings();
  }
  function scheduleAutoCache() {
    clearTimeout(autoTimer);
    clearTimeout(enrichmentTimer);
    autoTimer = setTimeout(function () { cacheCurrentOnlineSong().then(function (result) { if (result.ok) renderSettings(); }); }, 8000);
    enrichmentTimer = setTimeout(function () { cacheCurrentOnlineSong().then(function (result) { if (result.ok) renderSettings(); }); }, 25000);
  }
  function bindAudio() {
    var candidate = global.audio;
    if (!candidate || typeof candidate.addEventListener !== 'function' || typeof candidate.removeEventListener !== 'function') return;
    if (candidate === boundAudio) return;
    if (boundAudio && typeof boundAudio.removeEventListener === 'function') boundAudio.removeEventListener('playing', scheduleAutoCache);
    boundAudio = candidate; boundAudio.addEventListener('playing', scheduleAutoCache);
    boundAudio.addEventListener('loadstart', function () { clearTimeout(autoTimer); clearTimeout(enrichmentTimer); if (autoController) autoController.abort(); });
  }
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function(){}); } catch (_) {}
  setInterval(function () { bindAudio(); injectSettings(); }, 1000);

  global.LFOfflineAudioCache = Object.freeze({
    cacheFile:cacheFile, cacheCurrentOnlineSong:cacheCurrentOnlineSong, list:list, play:play, playLast:playLast,
    remove:remove, clear:clear, status:status, setCapacityBytes:setCapacityBytes, capacityBytes:capacityBytes,
  });
})(window);
