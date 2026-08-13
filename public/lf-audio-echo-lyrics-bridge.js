(function () {
  'use strict';

  // PROTECTED_FREEZE: this bridge preserves the existing LumiField Shape 1
  // left-lyric DOM, classes, timing, translation and layout contract.  It does
  // not import or substitute the upstream sonic-topography lyric component.
  var root = null;
  var renderKey = '';
  var lastSongIdentity = '';
  var enabled = false;
  var active = false;
  var mountCount = 0;
  var disposeCount = 0;

  function clamp(value, min, max) {
    value = Number(value);
    return Math.max(min, Math.min(max, isFinite(value) ? value : min));
  }

  function currentLyricIndex(lines, time) {
    var lo = 0;
    var hi = lines.length - 1;
    var result = -1;
    while (lo <= hi) {
      var middle = (lo + hi) >> 1;
      if (Number(lines[middle] && lines[middle].t || 0) <= time + 0.05) {
        result = middle;
        lo = middle + 1;
      } else {
        hi = middle - 1;
      }
    }
    return result;
  }

  function currentSong() {
    if (Array.isArray(window.playQueue) && window.currentIdx >= 0) {
      return window.playQueue[window.currentIdx] || {};
    }
    return typeof window.currentLyricSong === 'function' ? (window.currentLyricSong() || {}) : {};
  }

  function ensureLayer() {
    if (root && root.isConnected) return root;
    var parent = document.getElementById('canvas-container');
    if (!parent) return null;
    root = document.createElement('section');
    root.id = 'lf-mode1-left-lyrics-layer';
    root.setAttribute('aria-hidden', 'true');
    var plane = document.createElement('div');
    plane.className = 'lf-mode1-left-lyrics-plane';
    var title = document.createElement('h2');
    title.className = 'lf-mode1-left-lyrics-title';
    var timeline = document.createElement('div');
    timeline.className = 'lf-mode1-left-lyrics-timeline';
    var focus = document.createElement('i');
    focus.className = 'lf-mode1-left-lyrics-focus';
    var list = document.createElement('div');
    list.className = 'lf-mode1-left-lyrics-list';
    plane.appendChild(title);
    plane.appendChild(timeline);
    plane.appendChild(focus);
    plane.appendChild(list);
    root.appendChild(plane);
    parent.appendChild(root);
    mountCount++;
    return root;
  }

  function dispose() {
    if (root && root.parentNode) {
      root.parentNode.removeChild(root);
      disposeCount++;
    }
    root = null;
    renderKey = '';
    return true;
  }

  function update(force) {
    if (!active || !enabled || document.hidden || !document.body ||
        document.body.classList.contains('lf-auth-locked') ||
        document.body.classList.contains('splash-active') ||
        document.body.classList.contains('render-deep-sleep')) {
      dispose();
      return false;
    }
    var lines = Array.isArray(window.lyricsLines) ? window.lyricsLines : [];
    var time = window.audio ? Number(window.audio.currentTime) || 0 : 0;
    var index = currentLyricIndex(lines, time);
    var song = currentSong();
    var songId = [song.provider || song.source || '', song.id || song.mid || song.songmid || '', song.name || song.title || ''].join('|');
    if (!lines.length || index < 0 || !String(song.name || song.title || '').trim()) {
      dispose();
      lastSongIdentity = songId;
      return false;
    }
    if (lastSongIdentity && songId !== lastSongIdentity) dispose();
    lastSongIdentity = songId;
    var translated = !!(window.LumiFieldTask13 && window.LumiFieldTask13.getState &&
      window.LumiFieldTask13.getState().lyrics.translate);
    var key = songId + '|' + index + '|' + lines.length + '|' + translated;
    if (!force && key === renderKey) return true;
    renderKey = key;
    var layer = ensureLayer();
    if (!layer) return false;
    layer.querySelector('.lf-mode1-left-lyrics-title').textContent = String(song.name || song.title || '');
    var list = layer.querySelector('.lf-mode1-left-lyrics-list');
    while (list.firstChild) list.removeChild(list.firstChild);
    var start = Math.max(0, index - 3);
    var end = Math.min(lines.length - 1, index + 3);
    var container = document.getElementById('canvas-container');
    var rowGap = clamp((container && container.clientHeight || 1080) * 0.089, 58, 108);
    for (var i = start; i <= end; i++) {
      var line = lines[i] || {};
      var row = document.createElement('div');
      row.className = 'lf-mode1-left-lyrics-row' + (i === index ? ' current' : '');
      row.setAttribute('data-lyric-index', String(i));
      row.style.setProperty('--lf-lyric-y', String((i - index) * rowGap) + 'px');
      var text = document.createElement('span');
      text.textContent = String(line.text || '').trim();
      if (text.textContent.length > 18) row.classList.add('long');
      if (text.textContent.length > 34) row.classList.add('very-long');
      row.appendChild(text);
      var translation = String(line.translation || line.trans || '').trim();
      if (translation) {
        var translationNode = document.createElement('small');
        translationNode.textContent = translation;
        row.appendChild(translationNode);
      }
      list.appendChild(row);
    }
    return true;
  }

  function configure(options) {
    options = options || {};
    active = options.active === true;
    enabled = options.enabled === true;
    return update(options.force === true);
  }

  function getDebug() {
    return {
      protectedFreeze:true,
      active:active,
      enabled:enabled,
      mounted:!!(root && root.isConnected),
      rowCount:root ? root.querySelectorAll('.lf-mode1-left-lyrics-row').length : 0,
      mountCount:mountCount,
      disposeCount:disposeCount,
      updateIntervalMs:80,
      checkpoint:{
        commit:'ef301323de66f01891c9f8aecb3506f61e7178eb',
        managerSha256:'D4FF9E14535F3B9AAC8E135D3574CC65B5F8BC06E59460E56AC2D82FCA835D0D',
        lyricJavascriptSha256:'E85C85ADB8B97452A7DDD4B654D1706E7AC0D88C8F2D826C23DF462A77B6FE1F',
        lyricCssSha256:'CAA06C58B997DED35B7C2340EAE301DD7E332F3ED69CA85E3B785AD28BABC478'
      },
      pointerEvents:root ? getComputedStyle(root).pointerEvents : 'none',
      renderKey:renderKey
    };
  }

  window.Shape1LyricsPreservationBridge = {
    configure:configure,
    update:update,
    dispose:dispose,
    getDebug:getDebug
  };
})();
