(function () {
  'use strict';

  var LEGACY_PREFIX = ['mine', 'radio'].join('');
  var MARKER_KEY = 'lumifield-legacy-runtime-migration-v2';
  var CONFLICT_KEY = 'lumifield-legacy-runtime-conflicts-v1';
  var LEGACY_DB = LEGACY_PREFIX + '-custom-background-v1';
  var ARCHIVE_DB = 'lumifield-legacy-wallpaper-archive-v1';
  var MEDIA_STORE = 'media';
  var suffixes = [
    'custom-covers',
    'custom-lyrics-v1',
    'custom-lyric-prefs-v1',
    'lyric-layout-v1',
    'playback-quality-v1',
    'upload-tip-seen',
    'diy-player-mode-v1',
    'playlist-panel-pinned-v1',
    'user-capsule-auto-hide-v1',
    'fx-fab-auto-hide-v1',
    'controls-auto-hide-v1',
    'free-camera-v1',
    'hotkey-settings-v1',
    'visual-guide-seen-v2',
    'local-beatmaps-v1',
    'local-beatmap-prefs-v1',
    'listen-stats-v1',
    'weather-city',
    'search-history',
    'local-playlists-v1',
    'user-fx-archives-v1',
    'retired-visual-model-storage-v1',
    'climax-analysis-v1'
  ];

  function safeJson(value, fallback) {
    try { return JSON.parse(value); } catch (_) { return fallback; }
  }

  function stableJson(value) {
    try { return JSON.stringify(value); } catch (_) { return ''; }
  }

  function transformValue(suffix, raw) {
    var parsed;
    if (suffix === 'local-beatmap-prefs-v1') {
      parsed = safeJson(raw, null);
      if (!parsed || typeof parsed !== 'object') return raw;
      Object.keys(parsed).forEach(function (key) {
        if (parsed[key] === ['m', 'r'].join('')) parsed[key] = 'cinema';
      });
      return stableJson(parsed) || raw;
    }
    if (suffix === 'local-beatmaps-v1') {
      parsed = safeJson(raw, null);
      if (!parsed || typeof parsed !== 'object') return raw;
      Object.keys(parsed).forEach(function (key) {
        var entry = parsed[key];
        if (!entry || typeof entry !== 'object') return;
        var legacyKey = ['m', 'r'].join('');
        if (entry.cinema == null && entry[legacyKey] != null) entry.cinema = entry[legacyKey];
        delete entry[legacyKey];
      });
      return stableJson(parsed) || raw;
    }
    if (suffix === 'user-fx-archives-v1') {
      parsed = safeJson(raw, null);
      if (!Array.isArray(parsed)) return raw;
      parsed.forEach(function (entry) {
        if (!entry || typeof entry !== 'object') return;
        var legacyType = LEGACY_PREFIX + '-user-fx-archive';
        if (entry.type === legacyType) entry.type = 'lumifield-user-fx-archive';
      });
      return stableJson(parsed) || raw;
    }
    return raw;
  }

  function migrateLocalStorage() {
    var conflicts = safeJson(localStorage.getItem(CONFLICT_KEY), []);
    if (!Array.isArray(conflicts)) conflicts = [];
    var migrated = [];
    var conflictCount = 0;
    suffixes.forEach(function (suffix) {
      var oldKey = LEGACY_PREFIX + '-' + suffix;
      var newKey = 'lumifield-' + suffix;
      var oldValue = localStorage.getItem(oldKey);
      if (oldValue == null) return;
      var transformed = transformValue(suffix, oldValue);
      var current = localStorage.getItem(newKey);
      if (current == null) {
        localStorage.setItem(newKey, transformed);
        if (localStorage.getItem(newKey) !== transformed) throw new Error('LOCAL_STORAGE_VERIFY_FAILED:' + suffix);
      } else if (current !== transformed) {
        conflicts.push({ sourceKey:oldKey, canonicalKey:newKey, value:oldValue, archivedAt:Date.now() });
        localStorage.setItem(CONFLICT_KEY, JSON.stringify(conflicts));
        var stored = safeJson(localStorage.getItem(CONFLICT_KEY), []);
        var last = stored[stored.length - 1];
        if (!last || last.sourceKey !== oldKey || last.value !== oldValue) throw new Error('CONFLICT_ARCHIVE_VERIFY_FAILED:' + suffix);
        conflictCount += 1;
      }
      localStorage.removeItem(oldKey);
      if (localStorage.getItem(oldKey) != null) throw new Error('LEGACY_KEY_REMOVE_FAILED:' + suffix);
      migrated.push(suffix);
    });
    return { migrated:migrated, conflicts:conflictCount };
  }

  function requestPromise(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('IDB_REQUEST_FAILED')); };
    });
  }

  function transactionPromise(transaction) {
    return new Promise(function (resolve, reject) {
      transaction.oncomplete = function () { resolve(); };
      transaction.onabort = transaction.onerror = function () { reject(transaction.error || new Error('IDB_TRANSACTION_FAILED')); };
    });
  }

  async function databaseExists(name) {
    if (!indexedDB || typeof indexedDB.databases !== 'function') return true;
    var databases = await indexedDB.databases();
    return databases.some(function (entry) { return entry && entry.name === name; });
  }

  async function openArchiveDatabase() {
    var request = indexedDB.open(ARCHIVE_DB, 1);
    request.onupgradeneeded = function () {
      var db = request.result;
      if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE, { keyPath:'id' });
    };
    return requestPromise(request);
  }

  function recordMatches(left, right) {
    if (!left || !right || String(left.id) !== String(right.id)) return false;
    if (left.blob instanceof Blob || right.blob instanceof Blob) {
      if (!(left.blob instanceof Blob) || !(right.blob instanceof Blob)) return false;
      if (left.blob.size !== right.blob.size || left.blob.type !== right.blob.type) return false;
    }
    return true;
  }

  async function migrateWallpaperDatabase() {
    if (!window.indexedDB || !(await databaseExists(LEGACY_DB))) return { status:'absent', count:0 };
    var legacyDb = await requestPromise(indexedDB.open(LEGACY_DB));
    try {
      if (!legacyDb.objectStoreNames.contains(MEDIA_STORE)) return { status:'absent', count:0 };
      var readTx = legacyDb.transaction(MEDIA_STORE, 'readonly');
      var records = await requestPromise(readTx.objectStore(MEDIA_STORE).getAll());
      await transactionPromise(readTx);
      var archiveDb = await openArchiveDatabase();
      try {
        var writeTx = archiveDb.transaction(MEDIA_STORE, 'readwrite');
        records.forEach(function (record) { writeTx.objectStore(MEDIA_STORE).put(record); });
        await transactionPromise(writeTx);
        var verifyTx = archiveDb.transaction(MEDIA_STORE, 'readonly');
        var verifyStore = verifyTx.objectStore(MEDIA_STORE);
        var archived = await requestPromise(verifyStore.getAll());
        await transactionPromise(verifyTx);
        var byId = new Map(archived.map(function (entry) { return [String(entry.id), entry]; }));
        if (!records.every(function (record) { return recordMatches(record, byId.get(String(record.id))); })) {
          throw new Error('WALLPAPER_ARCHIVE_VERIFY_FAILED');
        }
      } finally {
        archiveDb.close();
      }
    } finally {
      legacyDb.close();
    }
    await requestPromise(indexedDB.deleteDatabase(LEGACY_DB));
    if (await databaseExists(LEGACY_DB)) throw new Error('LEGACY_WALLPAPER_DELETE_FAILED');
    return { status:'archived', count:records.length };
  }

  var storageResult = { migrated:[], conflicts:0 };
  var marker = { version:2, status:'running', startedAt:Date.now() };
  try {
    storageResult = migrateLocalStorage();
    marker.storage = storageResult;
    localStorage.setItem(MARKER_KEY, JSON.stringify(marker));
  } catch (error) {
    marker.status = 'failed';
    marker.error = String(error && error.message || error);
    try { localStorage.setItem(MARKER_KEY, JSON.stringify(marker)); } catch (_) {}
  }

  var databasePromise = migrateWallpaperDatabase().then(function (database) {
    marker.database = database;
    marker.status = marker.status === 'failed' ? 'failed' : 'complete';
    marker.completedAt = Date.now();
    localStorage.setItem(MARKER_KEY, JSON.stringify(marker));
    return marker;
  }).catch(function (error) {
    marker.status = 'failed';
    marker.error = String(error && error.message || error);
    try { localStorage.setItem(MARKER_KEY, JSON.stringify(marker)); } catch (_) {}
    return marker;
  });

  window.LumiFieldLegacyRuntimeMigration = {
    markerKey:MARKER_KEY,
    conflictKey:CONFLICT_KEY,
    archiveDatabase:ARCHIVE_DB,
    storage:storageResult,
    ready:databasePromise
  };
})();
