(function () {
  'use strict';

  var STORE = {
    clarity: 'lumifield-clarity-v2',
    weatherWallpaper: 'lumifield-weather-wallpaper-v2',
    weatherOpacity: 'lumifield-weather-wallpaper-opacity-v2',
    glass: 'lumifield-liquid-glass-v2',
    scan: 'lumifield-soft-scan-v2'
  };
  function read(key, fallback) { try { var value = localStorage.getItem(key); return value == null ? fallback : value; } catch (_) { return fallback; } }
  function save(key, value) { try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch (_) {} }
  function parse(key, fallback) { try { return JSON.parse(read(key, '')); } catch (_) { return fallback; } }
  function byId(id) { return document.getElementById(id); }
  function emitInput(el) { if (el) el.dispatchEvent(new Event('input', { bubbles: true })); }

  function applyClarity(mode) {
    if (['eco', 'standard', 'high', 'ultra'].indexOf(mode) < 0) mode = 'high';
    ['eco', 'standard', 'high', 'ultra'].forEach(function (name) { document.body.classList.toggle('lf-clarity-' + name, mode === name); });
    document.querySelectorAll('[data-lf-clarity]').forEach(function (button) { button.classList.toggle('active', button.dataset.lfClarity === mode); });
    save(STORE.clarity, mode);
    var quality = mode === 'standard' ? 'balanced' : mode;
    if (typeof window.setPerformanceQualityMode === 'function') {
      try { window.setPerformanceQualityMode(quality); } catch (_) {}
    }
    try {
      if (window.renderer && typeof renderer.setPixelRatio === 'function') {
        var cap = { eco: 1, standard: 1.25, high: 1.6, ultra: 2 }[mode];
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
        renderer.setSize(innerWidth, innerHeight, false);
      }
    } catch (_) {}
  }

  function injectTopControls() {
    var visual = byId('lf-visual-controls');
    var panel = byId('fx-panel');
    if (!panel || byId('lf-v2-clarity')) return;
    var gesture = document.createElement('section');
    gesture.id = 'lf-v2-gesture';
    gesture.className = 'lf-v2-block';
    gesture.innerHTML = '<div class="lf-v2-head"><span>手势交互</span><span class="lf-v2-sub">触碰 · 握拳缩放 · 手掌旋转</span></div>' +
      '<div class="lf-v2-grid"><button type="button" data-lf-cam="off">关闭</button><button type="button" data-lf-cam="gesture">摄像头手势</button></div>' +
      '<div class="lf-v2-row"><span>握拳收束，张开恢复；手掌翻转控制整体旋转</span></div>';
    var clarity = document.createElement('section');
    clarity.id = 'lf-v2-clarity';
    clarity.className = 'lf-v2-block';
    clarity.innerHTML = '<div class="lf-v2-head"><span>粒子清晰度</span><span class="lf-v2-sub">DPR 与像素预算</span></div>' +
      '<div class="lf-v2-grid"><button data-lf-clarity="eco">省电</button><button data-lf-clarity="standard">标准</button><button data-lf-clarity="high">高清</button><button data-lf-clarity="ultra">超清</button></div>';
    if (visual) {
      panel.insertBefore(gesture, visual);
      panel.insertBefore(clarity, visual);
    } else {
      panel.prepend(clarity); panel.prepend(gesture);
    }
    gesture.addEventListener('click', function (event) {
      var button = event.target.closest('[data-lf-cam]');
      if (!button || typeof window.setCamMode !== 'function') return;
      setCamMode(button.dataset.lfCam);
      syncGestureButtons();
    });
    clarity.addEventListener('click', function (event) {
      var button = event.target.closest('[data-lf-clarity]');
      if (button) applyClarity(button.dataset.lfClarity);
    });
    applyClarity(read(STORE.clarity, 'high'));
    syncGestureButtons();
  }

  function syncGestureButtons() {
    var mode = window.fx && fx.cam === 'gesture' ? 'gesture' : 'off';
    document.querySelectorAll('[data-lf-cam]').forEach(function (button) { button.classList.toggle('active', button.dataset.lfCam === mode); });
  }

  function glassState() {
    return Object.assign({ opacity:.34, blur:22, chroma:.34, highlight:.86, radius:22, elastic:.18 }, parse(STORE.glass, {}));
  }
  function applyLiquidGlass(state, persist) {
    state = Object.assign(glassState(), state || {});
    if (persist !== false) save(STORE.glass, state);
    var root = document.documentElement;
    root.style.setProperty('--lf-glass-panel-opacity', Math.max(.08, Math.min(.72, Number(state.opacity) || .34)).toFixed(2));
    root.style.setProperty('--lf-glass-blur', Math.max(8, Math.min(42, Number(state.blur) || 22)).toFixed(0) + 'px');
    root.style.setProperty('--lf-glass-chroma', Math.max(0, Math.min(1, Number(state.chroma) || 0)).toFixed(2));
    root.style.setProperty('--lf-glass-highlight', Math.max(0, Math.min(1.4, Number(state.highlight) || .86)).toFixed(2));
    root.style.setProperty('--lf-glass-radius', Math.max(10, Math.min(36, Number(state.radius) || 22)).toFixed(0) + 'px');
    root.style.setProperty('--lf-glass-elastic', Math.max(0, Math.min(1, Number(state.elastic) || 0)).toFixed(2));
    if (window.fx && typeof window.applyControlGlassChromaticOffset === 'function') {
      window.fx.controlGlassChromaticOffset = Math.round(Math.max(0, Math.min(1, Number(state.chroma) || 0)) * 100);
      window.applyControlGlassChromaticOffset();
    }
  }
  function initLiquidGlassControls() {
    var panel = byId('fx-panel');
    if (!panel || byId('lf-glass-controls')) return;
    var state = glassState();
    var box = document.createElement('section');
    box.id = 'lf-glass-controls';
    box.className = 'lf-v2-block';
    box.innerHTML = '<div class="lf-v2-head"><span>Liquid Glass</span><span class="lf-v2-sub">透明 / 模糊 / 色差 / 高光</span></div>' +
      '<div class="lf-v2-row"><span>透明</span><input id="lf-glass-opacity" type="range" min="0.08" max="0.72" step="0.01"></div>' +
      '<div class="lf-v2-row"><span>模糊</span><input id="lf-glass-blur" type="range" min="8" max="42" step="1"></div>' +
      '<div class="lf-v2-row"><span>色差</span><input id="lf-glass-chroma" type="range" min="0" max="1" step="0.01"></div>' +
      '<div class="lf-v2-row"><span>高光</span><input id="lf-glass-highlight" type="range" min="0" max="1.4" step="0.01"></div>' +
      '<div class="lf-v2-row"><span>圆角</span><input id="lf-glass-radius" type="range" min="10" max="36" step="1"></div>' +
      '<div class="lf-v2-row"><span>弹性</span><input id="lf-glass-elastic" type="range" min="0" max="1" step="0.01"></div>';
    var visual = byId('lf-visual-controls');
    if (visual) panel.insertBefore(box, visual); else panel.prepend(box);
    var ids = { opacity:'lf-glass-opacity', blur:'lf-glass-blur', chroma:'lf-glass-chroma', highlight:'lf-glass-highlight', radius:'lf-glass-radius', elastic:'lf-glass-elastic' };
    Object.keys(ids).forEach(function(key){
      var el = byId(ids[key]);
      el.value = state[key];
      el.addEventListener('input', function(){ state[key] = Number(el.value); applyLiquidGlass(state); });
    });
    applyLiquidGlass(state, false);
  }

  function initGestureStage() {
    if (typeof window.processHandFrame !== 'function' || window.processHandFrame.__lfV2) return;
    var original = window.processHandFrame;
    var target = { scale: 1, rx: 0, rz: 0 };
    var current = { scale: 1, rx: 0, rz: 0 };
    var frameId = 0;
    var lastWritten = { scale: NaN, rx: NaN, rz: NaN };
    function writeStageTransform(force) {
      if (force || Math.abs(current.scale-lastWritten.scale) > 0.0005) {
        document.documentElement.style.setProperty('--lf-stage-scale', current.scale.toFixed(3));
        lastWritten.scale = current.scale;
      }
      if (force || Math.abs(current.rx-lastWritten.rx) > 0.01) {
        document.documentElement.style.setProperty('--lf-stage-rotate-x', current.rx.toFixed(2) + 'deg');
        lastWritten.rx = current.rx;
      }
      if (force || Math.abs(current.rz-lastWritten.rz) > 0.01) {
        document.documentElement.style.setProperty('--lf-stage-rotate-z', current.rz.toFixed(2) + 'deg');
        lastWritten.rz = current.rz;
      }
    }
    function requestTick() {
      if (!frameId && !document.hidden) frameId = requestAnimationFrame(tick);
    }
    function tick() {
      frameId = 0;
      var active = window.fx && fx.cam === 'gesture';
      if (!active) { target.scale = 1; target.rx = 0; target.rz = 0; }
      current.scale += (target.scale - current.scale) * .14;
      current.rx += (target.rx - current.rx) * .12;
      current.rz += (target.rz - current.rz) * .12;
      var unsettled = Math.abs(target.scale-current.scale) > 0.0008 ||
        Math.abs(target.rx-current.rx) > 0.015 || Math.abs(target.rz-current.rz) > 0.015;
      if (!unsettled) {
        current.scale = target.scale; current.rx = target.rx; current.rz = target.rz;
      }
      writeStageTransform(!unsettled);
      if (unsettled) requestTick();
    }
    window.processHandFrame = function (landmarks) {
      var result = original.apply(this, arguments);
      try {
        var palmX = (landmarks[0].x + landmarks[5].x + landmarks[9].x + landmarks[13].x + landmarks[17].x) / 5;
        var palmY = (landmarks[0].y + landmarks[5].y + landmarks[9].y + landmarks[13].y + landmarks[17].y) / 5;
        var openness = typeof window.handOpenness === 'function' && typeof window.palmCenter === 'function' ? handOpenness(landmarks, palmCenter(landmarks)) : 0.7;
        var acrossX = landmarks[17].x - landmarks[5].x;
        var acrossY = landmarks[17].y - landmarks[5].y;
        target.rz = Math.max(-12, Math.min(12, Math.atan2(acrossY, acrossX) * 180 / Math.PI));
        target.rx = Math.max(-8, Math.min(8, (palmY - 0.5) * -16));
        target.scale = openness < 0.38 ? 0.78 : (openness > 0.66 ? 1 : 0.9);
        window.lumiFieldGesturePalm = { x: palmX, y: palmY };
      } catch (_) {}
      requestTick();
      return result;
    };
    window.processHandFrame.__lfV2 = true;
    if (typeof window.setCamMode === 'function' && !window.setCamMode.__lfV2GestureWake) {
      var originalSetCamMode = window.setCamMode;
      window.setCamMode = function () {
        var result = originalSetCamMode.apply(this, arguments);
        requestTick();
        return result;
      };
      window.setCamMode.__lfV2GestureWake = true;
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (frameId) cancelAnimationFrame(frameId);
        frameId = 0;
      } else requestTick();
    });
    window.addEventListener('pagehide', function () {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
    }, { once:true });
    writeStageTransform(true);
  }

  function initFxOverlay() {
    if (byId('lf-fx-overlay')) return;
    var panel = byId('fx-panel');
    if (!panel) return;
    var overlay = document.createElement('div');
    overlay.id = 'lf-fx-overlay';
    overlay.className = 'modal-mask';
    overlay.setAttribute('aria-hidden', 'true');
    // The player UI lives in a transformed desktop shell (its own stacking
    // context). Keep the backdrop in that same context so it cannot sit above
    // the console and intercept every click/wheel event.
    panel.parentNode.insertBefore(overlay, panel);
    overlay.addEventListener('click', function () { if (typeof window.toggleFxPanel === 'function') toggleFxPanel(false); });
    var isVisible = function () { return panel.classList.contains('show') || panel.classList.contains('peek'); };
    var wasVisible = isVisible();
    var sync = function () {
      var visible = isVisible();
      var modalOpen = panel.classList.contains('show');
      // Hover preview must not enable the full-screen backdrop, otherwise the
      // backdrop steals the click that should pin/open the console.
      document.body.classList.toggle('lf-fx-open', modalOpen);
      window.lumiFieldInteractionLocked = visible;
      if (visible) {
        var playlist = byId('playlist-panel');
        if (playlist && typeof window.togglePlaylistPanel === 'function') togglePlaylistPanel(false);
        if (typeof window.clearShelfHoverFocus === 'function') clearShelfHoverFocus();
        else if (window.shelfManager && shelfManager.clearSelected) shelfManager.clearSelected();
      }
      if (wasVisible && !visible && window.fx && fx.cam === 'gesture' && typeof window.setCamMode === 'function') setCamMode('off');
      wasVisible = visible;
    };
    new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['class'] });
    sync();
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && isVisible()) toggleFxPanel(false); }, true);
  }

  function initPanelCloseButtons() {
    function add(panelId, id, action, stickyTitlebar) {
      var panel = byId(panelId);
      if (!panel || byId(id)) return;
      var btn = document.createElement('button');
      btn.id = id;
      btn.type = 'button';
      btn.className = 'lf-panel-x';
      btn.setAttribute('aria-label', '关闭');
      btn.setAttribute('aria-controls', panelId);
      btn.textContent = '×';
      btn.addEventListener('focus', function(event){
        if (event.relatedTarget && !panel.contains(event.relatedTarget)) btn.__lfReturnFocus = event.relatedTarget;
      });
      function closeCurrentPanel(event) {
        event.preventDefault();
        event.stopPropagation();
        var returnFocus = btn.__lfReturnFocus;
        action(panel);
        requestAnimationFrame(function(){
          if (document.activeElement !== btn) return;
          if (returnFocus && returnFocus.isConnected && typeof returnFocus.focus === 'function') {
            try { returnFocus.focus({ preventScroll:true }); } catch (_) { returnFocus.focus(); }
          } else {
            btn.blur();
          }
        });
      }
      btn.addEventListener('click', closeCurrentPanel, true);
      btn.addEventListener('keydown', function(event){
        if (event.key !== 'Escape') return;
        event.stopImmediatePropagation();
        closeCurrentPanel(event);
      }, true);
      if (stickyTitlebar) {
        var titlebar = document.createElement('div');
        titlebar.className = 'lf-playlist-sticky-titlebar';
        titlebar.appendChild(btn);
        panel.insertBefore(titlebar, panel.firstChild);
      } else {
        panel.insertBefore(btn, panel.firstChild);
      }
    }
    add('playlist-panel', 'lf-playlist-close', function(panel){
      if (typeof window.togglePlaylistPanel === 'function') togglePlaylistPanel(false);
      panel.classList.remove('show', 'peek', 'pinned');
    }, true);
    var playlistTitlebar = byId('playlist-panel') && byId('playlist-panel').querySelector('.lf-playlist-sticky-titlebar');
    if (playlistTitlebar && !byId('lf-playlist-back-to-top')) {
      var topButton = document.createElement('button');
      topButton.id = 'lf-playlist-back-to-top';
      topButton.type = 'button';
      topButton.className = 'lf-playlist-top';
      topButton.textContent = '↑ 第一首';
      topButton.title = '回到顶部（第一首）';
      topButton.setAttribute('aria-label', '回到顶部（第一首）');
      topButton.setAttribute('aria-controls', 'playlist-panel');
      function activateTop(event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof window.scrollPlaylistPanelToTop === 'function') scrollPlaylistPanelToTop();
      }
      topButton.addEventListener('click', activateTop);
      topButton.addEventListener('keydown', function(event){
        if (event.key !== 'Enter' && event.key !== ' ') return;
        activateTop(event);
      });
      playlistTitlebar.insertBefore(topButton, byId('lf-playlist-close'));
      if (typeof window.updatePlaylistBackToTopState === 'function') updatePlaylistBackToTopState();
    }
    add('fx-panel', 'lf-fx-close', function(panel){
      if (typeof window.toggleFxPanel === 'function') toggleFxPanel(false);
      panel.classList.remove('show', 'peek');
    });
    if (!document.__lfPlaylistEscapeBound) {
      document.__lfPlaylistEscapeBound = true;
      document.addEventListener('keydown', function(event){
        if (event.key !== 'Escape') return;
        var panel = byId('playlist-panel');
        if (!panel || !panel.classList.contains('show') && !panel.classList.contains('peek') && !panel.classList.contains('pinned')) return;
        if (document.fullscreenElement || document.body.classList.contains('immersive-mode')) return;
        var blockingSurface = Array.from(document.querySelectorAll(
          '.modal-mask.show:not(#lf-fx-overlay),.modal.show,.track-detail-modal.show,#lf-wallpaper-modal.show'
        )).some(function(surface){
          if (surface === panel || panel.contains(surface)) return false;
          var style = getComputedStyle(surface);
          return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
        });
        if (blockingSurface) return;
        if (window.miniQueueOpen || window.shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent()) return;
        var close = byId('lf-playlist-close');
        if (!close) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        close.click();
      }, true);
    }
  }

  function initHomePlayer() {
    var bar = byId('bottom-bar');
    if (!bar) return;
    function keepVisible() {
      if (!document.body.classList.contains('empty-home-active')) return;
      bar.classList.add('visible'); bar.classList.remove('soft-hidden');
    }
    new MutationObserver(keepVisible).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    keepVisible();
    bar.addEventListener('click', function (event) {
      if (!document.body.classList.contains('empty-home-active')) return;
      if (event.target.closest('button,input,select,a,.volume-popover,.quality-popover,.mini-queue-popover')) return;
      if (!event.target.closest('.control-track,.control-meta,.control-cover,#controls')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      try {
        if (typeof window.enterVisualStageFromHome === 'function') enterVisualStageFromHome('player-console');
        if (typeof window.revealBottomControls === 'function') revealBottomControls(1200);
      } catch (_) {}
    }, true);
  }

  function initImmersiveBottomHotZone() {
    function wake(event) {
      if (!document.body.classList.contains('immersive-mode') || event.clientY < innerHeight - 96) return;
      var bar = byId('bottom-bar');
      if (!bar) return;
      bar.classList.add('visible');
      bar.classList.remove('soft-hidden');
      if (typeof window.setControlsHidden === 'function') setControlsHidden(false);
      if (typeof window.scheduleControlsHide === 'function') scheduleControlsHide(1100);
    }
    window.addEventListener('pointermove', wake, { passive:true, capture:true });
    window.addEventListener('pointerdown', wake, { passive:true, capture:true });
  }

  function initGestureLifecycle() {
    function releaseWhenHidden() {
      var hidden = document.hidden || document.body.classList.contains('empty-home-active');
      if (hidden && window.fx && fx.cam === 'gesture' && typeof window.setCamMode === 'function') setCamMode('off');
    }
    document.addEventListener('visibilitychange', releaseWhenHidden);
    new MutationObserver(releaseWhenHidden).observe(document.body, { attributes:true, attributeFilter:['class'] });
  }

  function injectVisualizerControls() {
    var legacyControls = byId('lf-visualizer-controls');
    if (legacyControls) legacyControls.remove();
    var legacyMesh = window.stageLyrics && stageLyrics.group && stageLyrics.group.getObjectByName && stageLyrics.group.getObjectByName('LumiFieldRealtimeSpectrum');
    if (legacyMesh && legacyMesh.parent) {
      legacyMesh.parent.remove(legacyMesh);
      if (legacyMesh.geometry && legacyMesh.geometry.dispose) legacyMesh.geometry.dispose();
      if (legacyMesh.material && legacyMesh.material.dispose) legacyMesh.material.dispose();
    }
  }

  function initSoftScan() {
    var enabled = read(STORE.scan, '1') !== '0';
    function scan() {
      if (!enabled) return;
      var box = byId('search-results') || byId('search-area');
      if (!box) return;
      box.classList.remove('lf-search-scanning');
      void box.offsetWidth;
      box.classList.add('lf-search-scanning');
      setTimeout(function () { box.classList.remove('lf-search-scanning'); }, 1200);
    }
    var input = byId('search-input');
    if (input) {
      input.addEventListener('focus', scan);
      input.addEventListener('keydown', function (event) {
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter') scan();
      });
    }
    document.addEventListener('click', function (event) { if (event.target.closest('#search-btn,.search-mode-tabs button')) scan(); });
  }

  var weatherObjectUrl = '';
  var weatherVideoVisible = true;
  function weatherOpacityValue() {
    var value = Number(read(STORE.weatherOpacity, '0.72'));
    return Math.max(0.12, Math.min(1, isFinite(value) ? value : 0.72));
  }
  function applyWeatherOpacity(shell, video, value) {
    value = Math.max(0.12, Math.min(1, Number(value) || 0.72));
    save(STORE.weatherOpacity, String(value));
    document.documentElement.style.setProperty('--lf-weather-media-opacity', value.toFixed(2));
    if (shell) shell.style.setProperty('--lf-weather-media-opacity', value.toFixed(2));
    if (video) video.style.opacity = value.toFixed(2);
    var out = byId('lf-weather-opacity-value'); if (out) out.textContent = Math.round(value * 100) + '%';
  }
  function syncWeatherVideoPlayback() {
    var video = byId('lf-weather-video');
    if (!video || video.hidden || !video.src) return;
    var shouldPlay = !document.hidden && weatherVideoVisible;
    if (shouldPlay) {
      var play = video.play(); if (play && play.catch) play.catch(function(){});
    } else {
      try { video.pause(); } catch (_) {}
    }
  }
  function openWeatherDb() {
    return new Promise(function(resolve, reject) {
      var req = indexedDB.open('lumifield-weather-media', 1);
      req.onupgradeneeded = function(){ if (!req.result.objectStoreNames.contains('media')) req.result.createObjectStore('media'); };
      req.onsuccess = function(){ resolve(req.result); };
      req.onerror = function(){ reject(req.error); };
    });
  }
  async function weatherDbWrite(blob) {
    var db = await openWeatherDb();
    await new Promise(function(resolve, reject){ var tx = db.transaction('media','readwrite'); tx.objectStore('media').put(blob,'active'); tx.oncomplete=resolve; tx.onerror=function(){reject(tx.error);}; });
    db.close();
  }
  async function weatherDbRead() {
    var db = await openWeatherDb();
    var value = await new Promise(function(resolve, reject){ var req=db.transaction('media','readonly').objectStore('media').get('active'); req.onsuccess=function(){resolve(req.result);}; req.onerror=function(){reject(req.error);}; });
    db.close(); return value;
  }
  async function weatherDbClear() {
    var db = await openWeatherDb();
    await new Promise(function(resolve, reject){ var tx=db.transaction('media','readwrite'); tx.objectStore('media').delete('active'); tx.oncomplete=resolve; tx.onerror=function(){reject(tx.error);}; });
    db.close();
  }
  function clearWeatherPresentation(shell, video) {
    if (weatherObjectUrl) { URL.revokeObjectURL(weatherObjectUrl); weatherObjectUrl = ''; }
    shell.style.removeProperty('--lf-weather-wallpaper');
    if (video) { try { video.pause(); video.removeAttribute('src'); video.load(); } catch (_) {} video.hidden = true; }
  }
  function applyWeatherBlob(shell, video, blob, meta) {
    clearWeatherPresentation(shell, video);
    if (!blob) return;
    weatherObjectUrl = URL.createObjectURL(blob);
    if (meta.type === 'video') {
      video.hidden = false;
      video.src = weatherObjectUrl;
      video.muted = true; video.loop = true; video.autoplay = true; video.playsInline = true; video.preload = 'auto';
      video.disablePictureInPicture = true;
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.style.opacity = weatherOpacityValue().toFixed(2);
      video.onloadeddata = syncWeatherVideoPlayback;
      video.oncanplay = syncWeatherVideoPlayback;
      video.onstalled = function(){ setTimeout(syncWeatherVideoPlayback, 400); };
      video.onerror = function(){ clearWeatherPresentation(shell, video); if (typeof window.showToast === 'function') showToast('天气视频无法播放，已恢复默认背景'); };
      syncWeatherVideoPlayback();
    } else {
      shell.style.setProperty('--lf-weather-wallpaper', 'url("' + weatherObjectUrl + '")');
    }
    applyWeatherOpacity(shell, video, weatherOpacityValue());
  }

  function initWeatherTools() {
    var shell = document.querySelector('.lf-weather-shell');
    if (!shell) return;
    if (byId('lf-weather-tools')) return;
    var video = document.createElement('video');
    video.id = 'lf-weather-video'; video.className = 'lf-weather-media'; video.hidden = true; video.preload = 'auto'; video.muted = true; video.loop = true; video.autoplay = true; video.setAttribute('aria-hidden','true');
    shell.insertBefore(video, shell.firstChild);
    var tools = document.createElement('div');
    tools.id = 'lf-weather-tools'; tools.className = 'lf-weather-tools';
    tools.innerHTML = '<div class="lf-weather-tool-buttons"><button id="lf-weather-wallpaper" title="选择天气卡片图片或视频">壁纸</button><button id="lf-weather-clear" title="清除天气卡片壁纸">清除</button></div><label class="lf-weather-opacity">透明度 <input id="lf-weather-opacity" type="range" min="0.12" max="1" step="0.02"><output id="lf-weather-opacity-value"></output></label><input id="lf-weather-wallpaper-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime" hidden>';
    var toolsHost = shell.querySelector('.lf-weather-side') || shell;
    toolsHost.appendChild(tools);
    var stored = read(STORE.weatherWallpaper, '');
    var legacyWeatherMeta = /^data:image\//i.test(stored) ? null : parse(STORE.weatherWallpaper, null);
    if (legacyWeatherMeta && /^(image|video)$/.test(legacyWeatherMeta.type)) {
      weatherDbRead().then(async function(blob){
        if (!blob || wallpaperMeta().weather) return;
        var scope = wallpaperScopeKey();
        await enqueueWallpaperMutation('weather', async function(){
          var legacyUrl = URL.createObjectURL(blob);
          try { await validateWallpaperSource(legacyUrl, legacyWeatherMeta.mime || blob.type || '', blob); }
          finally { URL.revokeObjectURL(legacyUrl); }
          await putWallpaperBlob('weather', blob, Object.assign({}, legacyWeatherMeta, { target:'weather', fit:'cover', migratedFrom:'lumifield-weather-media' }), scope);
        });
        localStorage.removeItem(STORE.weatherWallpaper);
        await weatherDbClear();
        await restoreWallpaperTarget('weather', scope);
      }).catch(function(error){ console.warn('[WeatherWallpaperMigration]', error); });
    }
    applyWeatherOpacity(shell, video, weatherOpacityValue());
    var opacityInput = byId('lf-weather-opacity'); if (opacityInput) {
      opacityInput.value = weatherOpacityValue();
      opacityInput.addEventListener('input', function(){ applyWeatherOpacity(shell, video, opacityInput.value); });
    }
    if (window.IntersectionObserver) {
      new IntersectionObserver(function(entries){
        weatherVideoVisible = !entries.length || entries[0].isIntersecting;
        syncWeatherVideoPlayback();
      }, { threshold:0.08 }).observe(shell);
    }
    document.addEventListener('visibilitychange', syncWeatherVideoPlayback);
    byId('lf-weather-wallpaper').addEventListener('click', function () { openWallpaperDialog('weather'); });
    byId('lf-weather-clear').addEventListener('click', async function () {
      var result = await clearWallpaperTargetsPersistent(['weather'], { source:'weather-toolbar' });
      clearWeatherPresentation(shell, video); localStorage.removeItem(STORE.weatherWallpaper); await weatherDbClear().catch(function(){});
      if (typeof window.showToast === 'function') showToast(result.ok ? '天气壁纸已清除' : '天气壁纸清除失败，请重试');
    });
    byId('lf-weather-wallpaper-input').addEventListener('change', async function (event) {
      var file = event.target.files && event.target.files[0]; event.target.value = ''; if (!file) return;
      var type = /^video\//i.test(file.type) ? 'video' : (/^image\//i.test(file.type) ? 'image' : '');
      if (!type) { if (typeof window.showToast === 'function') showToast('请选择 JPG、PNG、WebP、GIF、MP4 或 WebM'); return; }
      openWallpaperDialog('weather');
      var canonicalInput = byId('lf-wallpaper-file');
      if (!canonicalInput) return;
      var transfer = new DataTransfer(); transfer.items.add(file); canonicalInput.files = transfer.files;
      canonicalInput.dispatchEvent(new Event('change', { bubbles:true }));
    });
  }

  function openFontDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('lumifield-fonts', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('fonts'); };
      req.onsuccess = function () { resolve(req.result); }; req.onerror = function () { reject(req.error); };
    });
  }
  function fontFileBaseName(name) { return String(name || 'Local Font').split(/[\\/]/).pop().replace(/\.(ttf|otf|woff2?|ttc)$/i, '').trim() || 'Local Font'; }
  function readUtf16Be(view, offset, length) {
    var out = '';
    for (var i = 0; i + 1 < length; i += 2) out += String.fromCharCode(view.getUint16(offset + i, false));
    return out.replace(/\0/g, '').trim();
  }
  function readAscii(view, offset, length) {
    var out = '';
    for (var i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i));
    return out.replace(/\0/g, '').trim();
  }
  function parseFontDisplayName(buffer, fileName) {
    try {
      var view = new DataView(buffer);
      var sfnt = readAscii(view, 0, 4);
      if (!(sfnt === 'OTTO' || sfnt === 'true' || sfnt === 'typ1' || view.getUint32(0, false) === 0x00010000)) return fontFileBaseName(fileName);
      var numTables = view.getUint16(4, false);
      var nameOffset = 0, nameLength = 0;
      for (var i = 0; i < numTables; i++) {
        var p = 12 + i * 16;
        if (readAscii(view, p, 4) === 'name') { nameOffset = view.getUint32(p + 8, false); nameLength = view.getUint32(p + 12, false); break; }
      }
      if (!nameOffset || !nameLength) return fontFileBaseName(fileName);
      var count = view.getUint16(nameOffset + 2, false);
      var stringOffset = nameOffset + view.getUint16(nameOffset + 4, false);
      var best = '';
      for (var r = 0; r < count; r++) {
        var rp = nameOffset + 6 + r * 12;
        var platform = view.getUint16(rp, false);
        var nameId = view.getUint16(rp + 6, false);
        var len = view.getUint16(rp + 8, false);
        var off = view.getUint16(rp + 10, false);
        if ([1, 4, 16].indexOf(nameId) < 0 || !len) continue;
        var text = platform === 3 ? readUtf16Be(view, stringOffset + off, len) : readAscii(view, stringOffset + off, len);
        if (text && (!best || nameId === 4 || nameId === 16)) best = text;
      }
      return best || fontFileBaseName(fileName);
    } catch (_) { return fontFileBaseName(fileName); }
  }
  function fontStackFamily(family) { return '"' + String(family || '').replace(/"/g, '') + '",Inter,"Noto Sans SC","PingFang SC","Microsoft YaHei",Arial,sans-serif'; }
  function ensureImportedFontStackHook() {
    window.lumiFieldImportedFontMap = window.lumiFieldImportedFontMap || {};
    var originalStack = window.lyricFontStackForKey;
    if (typeof originalStack === 'function' && !originalStack.__lfV2Imported) {
      window.lyricFontStackForKey = function (key) {
        var entry = window.lumiFieldImportedFontMap && window.lumiFieldImportedFontMap[key];
        return entry ? fontStackFamily(entry.family) : originalStack.apply(this, arguments);
      };
      window.lyricFontStackForKey.__lfV2Imported = true;
    }
  }
  function removeDisallowedFontButtons(grid) {
    ['hei','song','bold-song','stone-song','serif-en','editorial','humanist','mono','display','hanyi'].forEach(function(key){
      var btn = grid.querySelector('[data-font="' + key + '"]');
      if (btn) btn.remove();
    });
  }
  function selectedLyricFontKey() {
    var state = typeof fx !== 'undefined' && fx ? fx : window.fx;
    return state ? String(state.lyricFont || '') : '';
  }
  async function fontDbPut(entry) {
    var db = await openFontDb();
    await new Promise(function(resolve, reject){ var tx = db.transaction('fonts','readwrite'); tx.objectStore('fonts').put(entry, entry.id); tx.oncomplete=resolve; tx.onerror=function(){reject(tx.error);}; });
    db.close();
  }
  async function fontDbEntries() {
    var db = await openFontDb();
    var entries = await new Promise(function(resolve, reject){
      var out = [];
      var req = db.transaction('fonts','readonly').objectStore('fonts').openCursor();
      req.onsuccess = function(){ var cursor = req.result; if (!cursor) return resolve(out); if (cursor.value && cursor.value.id && cursor.value.buffer) out.push(cursor.value); cursor.continue(); };
      req.onerror = function(){ reject(req.error); };
    });
    db.close();
    return entries;
  }
  async function loadImportedFont(entry, grid) {
    if (!entry || !entry.id || !entry.buffer) return;
    window.lumiFieldImportedFontMap = window.lumiFieldImportedFontMap || {};
    if (!window.lumiFieldImportedFontMap[entry.id]) {
      var face = new FontFace(entry.family, entry.buffer);
      await face.load();
      document.fonts.add(face);
      window.lumiFieldImportedFontMap[entry.id] = entry;
    }
    if (grid && !grid.querySelector('[data-font="' + entry.id + '"]')) {
      var button = document.createElement('button');
      button.type = 'button';
      button.dataset.font = entry.id;
      button.className = 'lf-font-ok';
      button.textContent = entry.label || entry.fileName || 'Local Font';
      button.title = (entry.fileName || '') + ' / ' + (entry.label || '');
      button.onclick = function () { if (typeof window.setLyricFont === 'function') setLyricFont(entry.id); };
      grid.appendChild(button);
    }
    if (selectedLyricFontKey() === entry.id) {
      if (typeof window.refreshCurrentLyricStyle === 'function') window.refreshCurrentLyricStyle();
    }
  }
  async function initLicensedFonts() {
    var grid = byId('lyric-font-grid'); if (!grid) return;
    removeDisallowedFontButtons(grid);
    ensureImportedFontStackHook();
    if (!byId('lf-font-import-input')) {
      var importButton = document.createElement('button'); importButton.type = 'button'; importButton.className = 'lf-font-import'; importButton.textContent = '导入本地授权字体';
      var input = document.createElement('input'); input.id = 'lf-font-import-input'; input.type = 'file'; input.accept = '.ttf,.otf,.woff,.woff2'; input.hidden = true;
      grid.appendChild(importButton); grid.appendChild(input);
      importButton.onclick = function () { input.click(); };
      input.onchange = async function () {
        var file = input.files && input.files[0]; input.value = ''; if (!file) return;
        try {
          var buffer = await file.arrayBuffer();
          var id = 'lf-font-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
          var label = parseFontDisplayName(buffer, file.name);
          var entry = { id:id, label:label, family:'LumiField Local ' + id, fileName:file.name, mime:file.type || '', importedAt:Date.now(), buffer:buffer };
          await loadImportedFont(entry, grid);
          await fontDbPut(entry);
          if (typeof window.setLyricFont === 'function') setLyricFont(id);
          if (typeof window.showToast === 'function') showToast('已导入字体：' + label);
        } catch (e) {
          console.warn('[LicensedFontImport]', e);
          if (typeof window.showToast === 'function') showToast('字体导入失败，请确认文件有效且已授权');
        }
      };
    }
    try {
      var entries = await fontDbEntries();
      var selected = selectedLyricFontKey();
      if (/^lf-font-/i.test(selected) && !entries.some(function (entry) { return entry && entry.id === selected; })) {
        if (typeof window.setLyricFont === 'function') window.setLyricFont('sans');
        if (typeof window.showToast === 'function') window.showToast('已保存的本地字体不可用，已回退到默认字体');
        selected = 'sans';
      }
      var failed = [];
      for (var i = 0; i < entries.length; i++) {
        try { await loadImportedFont(entries[i], grid); }
        catch (_) { failed.push(entries[i] && entries[i].id); }
      }
      selected = selectedLyricFontKey();
      if (/^lf-font-/i.test(selected) && (!window.lumiFieldImportedFontMap || !window.lumiFieldImportedFontMap[selected])) {
        if (typeof window.setLyricFont === 'function') window.setLyricFont('sans');
        if (typeof window.showToast === 'function') window.showToast('已保存的本地字体不可用，已回退到默认字体');
      } else if (failed.length && typeof window.showToast === 'function') {
        window.showToast('部分本地字体加载失败，已跳过无效文件');
      }
    } catch (_) {
      var selected = selectedLyricFontKey();
      if (/^lf-font-/i.test(selected) && typeof window.setLyricFont === 'function') {
        window.setLyricFont('sans');
        if (typeof window.showToast === 'function') window.showToast('本地字体存储读取失败，已回退到默认字体');
      }
    }
  }

  function initLoginStates() {
    var names = { kugou:'酷狗音乐标准版', kugou_concept:'酷狗概念版', qishui:'汽水音乐', netease:'网易云音乐', qq:'QQ 音乐' };
    var savedPlatform = read('lumifield-current-platform', 'netease');
    var currentPlatform = /^(kugou|kugou_concept|qishui|netease|qq)$/.test(savedPlatform) ? savedPlatform : 'netease';
    var existingManager = window.LumiFieldMusicPlatformManager;
    if (existingManager && typeof existingManager.status === 'function' && typeof existingManager.login === 'function' && typeof existingManager.logout === 'function') {
      existingManager.setActive(currentPlatform);
      return;
    }
    function setCurrentPlatform(provider, state) {
      if (!/^(netease|qq|kugou|kugou_concept|qishui)$/.test(String(provider || ''))) provider = 'netease';
      currentPlatform = provider;
      save('lumifield-current-platform', provider);
      document.body.dataset.currentMusicPlatform = provider;
      try { window.activeAccountProvider = provider; } catch (_) {}
      try { if (typeof window.updateSearchModeTabs === 'function') updateSearchModeTabs(); } catch (_) {}
      try { document.dispatchEvent(new CustomEvent('lumifield-current-platform-change', { detail:{ provider:provider } })); } catch (_) {}
      var oldBadge = byId('lf-current-platform'); if (oldBadge) oldBadge.remove();
    }
    window.LumiFieldMusicPlatformManager = {
      current:function(){ return currentPlatform || read('lumifield-current-platform', 'netease'); },
      setActive:function(provider, state){ setCurrentPlatform(provider, state || null); },
      names:names
    };
    setCurrentPlatform(currentPlatform, null);
    function syncNativeCurrentProvider() {
      var provider = '';
      try { provider = String(window.activeAccountProvider || ''); } catch (_) {}
      if (!/^(netease|qq|kugou|kugou_concept|qishui)$/.test(provider) || provider === currentPlatform) return;
      if (provider === 'qq' && window.qqLoginStatus && qqLoginStatus.loggedIn) setCurrentPlatform('qq', null);
      else if (provider === 'netease' && window.loginStatus && loginStatus.loggedIn) setCurrentPlatform('netease', null);
      else if (provider === 'kugou' && window.kugouLoginStatus && kugouLoginStatus.loggedIn) setCurrentPlatform('kugou', null);
      else if (provider === 'kugou_concept' && window.kugouConceptLoginStatus && kugouConceptLoginStatus.loggedIn) setCurrentPlatform('kugou_concept', null);
      else if (provider === 'qishui' && window.qishuiLoginStatus && qishuiLoginStatus.loggedIn) setCurrentPlatform('qishui', null);
    }
    setInterval(syncNativeCurrentProvider, 900);
  }

  function syncNativeFullscreen() {
    var api = window.desktopWindow;
    if (!api || typeof api.onStateChange !== 'function') return;
    api.onStateChange(function (state) {
      var modes = state && Array.isArray(state.activeModes) ? state.activeModes : null;
      if (window.immersiveMode && modes && !state.transitioning && modes.indexOf('immersive') < 0 && typeof window.setImmersiveMode === 'function') {
        setImmersiveMode(false, { windowStateAlreadyHandled:true, silent:true });
      }
    });
  }

  function removeSearchModeTabs() {
    var tabs = byId('search-mode-tabs');
    if (tabs) tabs.remove();
    try {
      if (/^(netease|qq)$/.test(String(window.searchMode || ''))) window.searchMode = 'song';
      if (typeof window.updateSearchModeTabs === 'function') window.updateSearchModeTabs();
    } catch (_) {}
  }

  var wallpaperObjectUrls = {};
  var wallpaperDialogState = { target:'stage', fit:'cover', file:null, objectUrl:'', provider:'local', importedAsset:null, previewedTargets:{}, videoOptimization:null, videoOptimizationPromise:null };
  var wallpaperVideoOptimizationAdapter = null;
  var wallpaperVideoOptimizationTask = null;
  var wallpaperVideoOptimizationCache = new Map();
  var wallpaperVideoOptimizationHistory = [];
  var wallpaperVideoOptimizationUnsubscribe = null;
  var wallpaperVideoOptimizationSerial = 0;
  var wallpaperVideoOptimizationLast = { phase:'idle', progress:0, error:'', result:null };
  var WALLPAPER_META_KEY = 'lumifield-wallpaper-picker-meta-v1';
  var WALLPAPER_META_SCHEMA = 3;
  var wallpaperModules = null;
  var wallpaperRestoreTokens = { weather:0, stage:0, global:0 };
  var wallpaperDialogSelectionToken = 0;
  var wallpaperScopeOverride = '';
  var wallpaperScopeMigration = null;
  var wallpaperScopeRevision = 0;
  var wallpaperMutationQueues = { weather:Promise.resolve(), global:Promise.resolve() };
  var wallpaperTestMode = /(?:^|[?&])lfWallpaperTest=1(?:&|$)/.test(location.search || '');

  function wallpaperVideoStatus(phase, progress, text, error) {
    wallpaperVideoOptimizationLast.phase = String(phase || 'idle');
    wallpaperVideoOptimizationLast.progress = Math.max(0, Math.min(1, Number(progress) || 0));
    wallpaperVideoOptimizationLast.error = String(error || '');
    var status = byId('lf-wallpaper-video-opt-status');
    var meter = byId('lf-wallpaper-video-opt-progress');
    var cancel = byId('lf-wallpaper-video-opt-cancel');
    if (status) {
      status.dataset.phase = wallpaperVideoOptimizationLast.phase;
      status.textContent = String(text || (phase === 'idle' ? '选择视频后将自动探测并优化' : phase));
    }
    if (meter) {
      meter.value = wallpaperVideoOptimizationLast.progress;
      meter.setAttribute('aria-valuenow', String(Math.round(wallpaperVideoOptimizationLast.progress * 100)));
    }
    if (cancel) cancel.disabled = !wallpaperVideoOptimizationTask || !/^(queued|hashing|probing|planning|copying|optimizing|transcoding|running)$/.test(wallpaperVideoOptimizationLast.phase);
  }
  function wallpaperVideoAbortError(reason) {
    var error;
    try { error = new DOMException(String(reason || 'CANCELLED'), 'AbortError'); }
    catch (_) { error = new Error(String(reason || 'CANCELLED')); error.name = 'AbortError'; }
    error.code = 'CANCELLED';
    return error;
  }
  function wallpaperVideoDisplayBudget() {
    return {
      width:Math.max(640, Number(screen && screen.width) || innerWidth || 1920),
      height:Math.max(360, Number(screen && screen.height) || innerHeight || 1080),
      dpr:Math.max(1, Math.min(4, Number(devicePixelRatio) || 1)),
      refreshRate:60
    };
  }
  function wallpaperVideoEven(value) {
    value = Math.max(2, Math.round(Number(value) || 2));
    return value % 2 ? value - 1 : value;
  }
  function wallpaperVideoPlan(probe, display) {
    probe = probe || {};
    display = display || wallpaperVideoDisplayBudget();
    var sourceWidth = Math.max(2, Number(probe.width || probe.codedWidth) || 2);
    var sourceHeight = Math.max(2, Number(probe.height || probe.codedHeight) || 2);
    var limitWidth = Math.max(2, (Number(display.width) || 1920) * (Number(display.dpr) || 1));
    var limitHeight = Math.max(2, (Number(display.height) || 1080) * (Number(display.dpr) || 1));
    var scale = Math.min(1, limitWidth / sourceWidth, limitHeight / sourceHeight);
    var codec = String(probe.codec || probe.codecName || probe.videoCodec || '').toLowerCase();
    var bitrate = Number(probe.bitrate || probe.bitRate) || 0;
    var fps = Math.max(1, Number(probe.fps || probe.frameRate || probe.averageFrameRate) || 30);
    var hardwareCompatible = /^(?:h264|avc1?|vp9|av1)$/.test(codec);
    var ordinary1080 = sourceWidth <= 1920 && sourceHeight <= 1080 && fps <= 60 && bitrate <= 12000000 && hardwareCompatible && probe.hasAudio !== true;
    var optimize = !ordinary1080 && (scale < .999 || fps > 60 || bitrate > 12000000 || !hardwareCompatible || probe.hasAudio === true);
    if (ordinary1080) scale = 1;
    return {
      width:wallpaperVideoEven(sourceWidth * scale),
      height:wallpaperVideoEven(sourceHeight * scale),
      fps:Math.max(Math.min(60, fps, Number(display.refreshRate) || 60), Math.min(30, fps)),
      codec:'h264',
      pixelFormat:'yuv420p',
      crf:18,
      preset:'medium',
      stripAudio:true,
      audio:false,
      optimized:optimize,
      pipelineVersion:1
    };
  }
  async function wallpaperVideoFileHash(file) {
    var bytes = await file.arrayBuffer();
    var digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.prototype.map.call(new Uint8Array(digest), function(value){ return value.toString(16).padStart(2, '0'); }).join('');
  }
  async function cancelWallpaperVideoOptimization(reason) {
    var task = wallpaperVideoOptimizationTask;
    wallpaperDialogState.videoOptimizationPromise = null;
    wallpaperDialogState.videoOptimization = null;
    if (!task) return { ok:true, cancelled:false };
    wallpaperVideoOptimizationTask = null;
    try { task.controller.abort(reason || 'CANCELLED'); } catch (_) {}
    if (task.desktopTaskId && window.desktopWindow && typeof window.desktopWindow.lfWallpaperVideoCancel === 'function') {
      try { await window.desktopWindow.lfWallpaperVideoCancel(task.desktopTaskId); } catch (_) {}
    }
    if (!wallpaperVideoOptimizationTask) wallpaperVideoStatus('cancelled', 0, '视频优化已取消', 'CANCELLED');
    return { ok:true, cancelled:true };
  }
  function wallpaperVideoTaskIsCurrent(task, selectionToken) {
    return wallpaperVideoOptimizationTask === task && selectionToken === wallpaperDialogSelectionToken;
  }
  async function optimizeWallpaperVideoFile(file, target, selectionToken) {
    if (!file || !/^video\//i.test(file.type || '') && !/\.(?:mp4|m4v|mov|webm|ogv|mkv)$/i.test(file.name || '')) {
      return { ok:true, optimized:false, file:file, sourceName:file && file.name || '' };
    }
    await cancelWallpaperVideoOptimization('SELECTION_SUPERSEDED');
    if (selectionToken !== wallpaperDialogSelectionToken) throw wallpaperVideoAbortError('WALLPAPER_SELECTION_SUPERSEDED');
    var controller = new AbortController();
    var serial = ++wallpaperVideoOptimizationSerial;
    var task = wallpaperVideoOptimizationTask = { serial:serial, controller:controller, desktopTaskId:'', selectionToken:selectionToken };
    var display = wallpaperVideoDisplayBudget();
    wallpaperVideoStatus('probing', .02, '正在探测视频分辨率、帧率、码率与编码…');
    try {
      var result;
      if (wallpaperVideoOptimizationAdapter) {
        var adapter = wallpaperVideoOptimizationAdapter;
        var probe = await adapter.probe(file, { signal:controller.signal, target:target, display:display });
        if (controller.signal.aborted) throw wallpaperVideoAbortError();
        var plan = wallpaperVideoPlan(probe, display);
        var sourceHash = await wallpaperVideoFileHash(file);
        var cacheKey = sourceHash + '|' + JSON.stringify(plan);
        if (wallpaperVideoOptimizationCache.has(cacheKey)) {
          result = Object.assign({}, wallpaperVideoOptimizationCache.get(cacheKey), { cached:true, cacheHit:true });
          if (wallpaperVideoTaskIsCurrent(task, selectionToken)) wallpaperVideoStatus('complete', 1, '已复用视频优化缓存');
        } else if (!plan.optimized) {
          result = { ok:true, optimized:false, cached:false, file:file, blob:file, sourceName:file.name, originalName:file.name, sourceHash:sourceHash, cacheKey:cacheKey, probe:probe, plan:plan };
          wallpaperVideoOptimizationCache.set(cacheKey, result);
          if (wallpaperVideoTaskIsCurrent(task, selectionToken)) wallpaperVideoStatus('complete', 1, '视频已探测，无需优化');
        } else {
          wallpaperVideoStatus('transcoding', .08, '正在使用 FFmpeg 高质量优化视频…');
          result = await adapter.transcode(file, plan, {
            signal:controller.signal,
            target:target,
            display:display,
            onProgress:function(value, detail){
              if (!wallpaperVideoTaskIsCurrent(task, selectionToken)) return;
              wallpaperVideoStatus('transcoding', Math.max(.08, Number(value) || 0), '正在使用 FFmpeg 高质量优化视频 ' + Math.round((Number(value) || 0) * 100) + '%');
            }
          });
          if (controller.signal.aborted) throw wallpaperVideoAbortError();
          result = Object.assign({}, result || {}, { ok:true, optimized:true, cached:!!(result && result.cached), sourceName:file.name, originalName:file.name, sourceHash:sourceHash, cacheKey:cacheKey, probe:probe, plan:plan });
          wallpaperVideoOptimizationCache.set(cacheKey, result);
          if (wallpaperVideoTaskIsCurrent(task, selectionToken)) wallpaperVideoStatus('complete', 1, result.cached ? '已复用视频优化缓存' : '视频优化完成');
        }
      } else {
        if (!window.desktopWindow || typeof window.desktopWindow.lfWallpaperVideoStart !== 'function') throw new Error('WALLPAPER_VIDEO_OPTIMIZER_UNAVAILABLE');
        var started = await window.desktopWindow.lfWallpaperVideoStart(file, { target:target, display:display });
        if (!started || started.ok === false || !started.taskId) throw new Error(started && started.error || 'WALLPAPER_VIDEO_OPTIMIZER_START_FAILED');
        task.desktopTaskId = started.taskId;
        result = await window.desktopWindow.lfWallpaperVideoWait(started.taskId);
        if (!result || result.ok === false) throw new Error(result && result.error || 'FFMPEG_TRANSCODE_FAILED');
        if (wallpaperVideoTaskIsCurrent(task, selectionToken)) wallpaperVideoStatus('complete', 1, result.cached ? '已复用视频优化缓存' : (result.optimized ? '视频优化完成' : '视频已探测，无需优化'));
      }
      if (!wallpaperVideoTaskIsCurrent(task, selectionToken)) throw wallpaperVideoAbortError('WALLPAPER_SELECTION_SUPERSEDED');
      wallpaperVideoOptimizationLast.result = result;
      wallpaperVideoOptimizationHistory.push({ serial:serial, sourceName:file.name, result:result, at:Date.now() });
      if (wallpaperVideoOptimizationHistory.length > 24) wallpaperVideoOptimizationHistory.shift();
      return result;
    } catch (error) {
      var code = String(error && (error.code || error.message) || error || 'WALLPAPER_VIDEO_OPTIMIZATION_FAILED');
      if (wallpaperVideoTaskIsCurrent(task, selectionToken)) {
        wallpaperVideoOptimizationLast.error = code;
        wallpaperVideoOptimizationHistory.push({ serial:serial, sourceName:file.name, error:code, at:Date.now() });
        wallpaperVideoStatus(/CANCEL|ABORT|SUPERSEDED/i.test(code) ? 'cancelled' : 'failed', 0, /CANCEL|ABORT|SUPERSEDED/i.test(code) ? '视频优化已取消' : ('视频优化失败：' + code), code);
      }
      throw error;
    } finally {
      if (wallpaperVideoOptimizationTask === task) {
        wallpaperVideoOptimizationTask = null;
        var cancel = byId('lf-wallpaper-video-opt-cancel'); if (cancel) cancel.disabled = true;
      }
    }
  }
  window.LumiFieldWallpaperVideoOptimization = {
    setTestAdapter:function(adapter) {
      if (!(wallpaperTestMode || window.__LF_WALLPAPER_TEST__ === true)) throw new Error('TEST_MODE_REQUIRED');
      wallpaperVideoOptimizationAdapter = adapter && typeof adapter === 'object' ? adapter : null;
      wallpaperVideoOptimizationCache.clear();
      return Promise.resolve({ ok:true });
    },
    cancel:cancelWallpaperVideoOptimization,
    debug:function(){
      var adapterDebug = wallpaperVideoOptimizationAdapter && typeof wallpaperVideoOptimizationAdapter.debug === 'function' ? wallpaperVideoOptimizationAdapter.debug() : null;
      return Promise.resolve({
        activeTasks:wallpaperVideoOptimizationTask ? 1 : 0,
        phase:wallpaperVideoOptimizationLast.phase,
        progress:wallpaperVideoOptimizationLast.progress,
        error:wallpaperVideoOptimizationLast.error,
        lastResult:wallpaperVideoOptimizationLast.result,
        history:wallpaperVideoOptimizationHistory.slice(),
        cacheEntries:wallpaperVideoOptimizationCache.size,
        adapter:adapterDebug
      });
    },
    dispose:async function(reason){
      await cancelWallpaperVideoOptimization(reason || 'DISPOSED');
      wallpaperVideoOptimizationCache.clear();
      wallpaperVideoOptimizationLast.result = null;
      if (wallpaperVideoOptimizationUnsubscribe) { try { wallpaperVideoOptimizationUnsubscribe(); } catch (_) {} wallpaperVideoOptimizationUnsubscribe = null; }
      return { ok:true };
    }
  };
  if (window.desktopWindow && typeof window.desktopWindow.onLFWallpaperVideoProgress === 'function') {
    wallpaperVideoOptimizationUnsubscribe = window.desktopWindow.onLFWallpaperVideoProgress(function(payload){
      var task = wallpaperVideoOptimizationTask;
      if (!task || !task.desktopTaskId || String(payload && payload.taskId || '') !== String(task.desktopTaskId)) return;
      var progress = Math.max(0, Math.min(1, Number(payload.progress) || 0));
      wallpaperVideoStatus(String(payload.stage || 'transcoding'), progress, String(payload.message || ('正在优化视频 ' + Math.round(progress * 100) + '%')));
    });
  }

  function ensureWallpaperModules() {
    if (!wallpaperModules && window.LumiFieldWallpaper && typeof window.LumiFieldWallpaper.create === 'function') {
      wallpaperModules = window.LumiFieldWallpaper.create(window.desktopWindow, applyWallpaperUrl);
    }
    return wallpaperModules;
  }
  function wallpaperUserId() {
    try {
      var user = window.LFAuth && typeof window.LFAuth.getUser === 'function' ? window.LFAuth.getUser() : null;
      return String(user && (user.id || user.userId || user.email) || '').trim();
    } catch (_) {
      return '';
    }
  }
  function wallpaperOwnerReady() {
    if (wallpaperScopeOverride) return true;
    if (wallpaperUserId()) return true;
    return !(window.desktopWindow && typeof window.desktopWindow.lfAuthStatus === 'function');
  }
  function wallpaperScopeKey() {
    var owner = wallpaperScopeOverride || wallpaperUserId();
    if (!owner) return 'device:anonymous';
    return 'user:' + encodeURIComponent(owner).slice(0, 180);
  }
  function canonicalWallpaperTarget(target) {
    target = String(target || 'global');
    return target === 'weather' ? 'weather' : 'global';
  }
  function wallpaperPersistenceKey(target, scopeKey) {
    return 'v2|' + (scopeKey || wallpaperScopeKey()) + '|' + canonicalWallpaperTarget(target);
  }
  function wallpaperVideoPinOwner(scopeKey, target) {
    return String(scopeKey || wallpaperScopeKey()) + '|' + canonicalWallpaperTarget(target);
  }
  function wallpaperVideoCacheReference(meta) {
    if (!meta || meta.external !== true) return null;
    var url = String(meta.url || '');
    var importId = String(meta.importId || '');
    if (!importId) {
      var match = /\/api\/local-wallpaper\/([^/]+)/i.exec(url);
      if (match) try { importId = decodeURIComponent(match[1]); } catch (_) { importId = match[1]; }
    }
    var cacheKey = String(meta.cacheKey || '');
    if (!importId && !cacheKey) return null;
    return { importId:importId, cacheKey:cacheKey, projectId:String(meta.projectId || '') };
  }
  function wallpaperVideoCacheReferenceEqual(left, right) {
    if (!left || !right) return false;
    return !!((left.importId && left.importId === right.importId) || (left.cacheKey && left.cacheKey === right.cacheKey));
  }
  async function pinWallpaperVideoCache(meta, scopeKey, target) {
    var reference = wallpaperVideoCacheReference(meta);
    if (!reference) return { ok:true, skipped:true };
    if (!window.desktopWindow || typeof window.desktopWindow.lfWallpaperVideoPin !== 'function') return { ok:false, error:'WALLPAPER_VIDEO_PIN_UNAVAILABLE' };
    return window.desktopWindow.lfWallpaperVideoPin(reference, wallpaperVideoPinOwner(scopeKey, target));
  }
  async function unpinWallpaperVideoCache(meta, scopeKey, target) {
    var reference = wallpaperVideoCacheReference(meta);
    if (!reference) return { ok:true, skipped:true };
    if (!window.desktopWindow || typeof window.desktopWindow.lfWallpaperVideoUnpin !== 'function') return { ok:false, error:'WALLPAPER_VIDEO_UNPIN_UNAVAILABLE' };
    return window.desktopWindow.lfWallpaperVideoUnpin(reference, wallpaperVideoPinOwner(scopeKey, target));
  }
  function assertWallpaperScope(scopeKey) {
    if (scopeKey && scopeKey !== wallpaperScopeKey()) throw new Error('WALLPAPER_SCOPE_CHANGED');
    return scopeKey || wallpaperScopeKey();
  }
  function readWallpaperMetaRoot() {
    try {
      var value = JSON.parse(localStorage.getItem(WALLPAPER_META_KEY) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (_) {
      return {};
    }
  }
  function wallpaperMeta(scopeKey) {
    var root = readWallpaperMetaRoot();
    if (root.schema === WALLPAPER_META_SCHEMA && root.scopes && typeof root.scopes === 'object') {
      var scoped = root.scopes[scopeKey || wallpaperScopeKey()];
      return scoped && typeof scoped === 'object' ? Object.assign({}, scoped) : {};
    }
    return wallpaperOwnerReady() ? Object.assign({}, root) : {};
  }
  function saveWallpaperMeta(meta, scopeKey) {
    var root = readWallpaperMetaRoot();
    if (root.schema !== WALLPAPER_META_SCHEMA || !root.scopes || typeof root.scopes !== 'object') {
      root = { schema:WALLPAPER_META_SCHEMA, scopes:{} };
    } else {
      root = { schema:WALLPAPER_META_SCHEMA, scopes:Object.assign({}, root.scopes) };
    }
    root.scopes[scopeKey || wallpaperScopeKey()] = Object.assign({}, meta || {});
    try {
      localStorage.setItem(WALLPAPER_META_KEY, JSON.stringify(root));
      return true;
    } catch (_) {
      return false;
    }
  }
  async function ensureWallpaperScopeMigrated() {
    if (!wallpaperOwnerReady()) return false;
    var migrationScope = wallpaperScopeKey();
    var root = readWallpaperMetaRoot();
    if (root.schema === WALLPAPER_META_SCHEMA && root.scopes && typeof root.scopes === 'object') return true;
    if (wallpaperScopeMigration) return wallpaperScopeMigration;
    wallpaperScopeMigration = (async function(){
      var scopes = {};
      var legacyScopes = root.schema === 2 && root.scopes && typeof root.scopes === 'object'
        ? root.scopes
        : (function(){ var one = {}; one[migrationScope] = root; return one; })();
      Object.keys(legacyScopes).forEach(function(scope){
        var legacy = legacyScopes[scope] && typeof legacyScopes[scope] === 'object' ? legacyScopes[scope] : {};
        var scopedMeta = {};
        if (legacy.weather) scopedMeta.weather = Object.assign({}, legacy.weather, {
          target:'weather', scopeKey:scope, persistenceKey:'v2|' + scope + '|weather'
        });
        var app = legacy.global || legacy.stage;
        if (app) scopedMeta.global = Object.assign({}, app, {
          target:'global', scopeKey:scope, persistenceKey:'v2|' + scope + '|global'
        });
        var opacity = legacy.appOpacity;
        if (opacity == null && app && app.opacity != null) opacity = app.opacity;
        if (opacity != null) scopedMeta.appOpacity = Math.max(0, Math.min(1, Number(opacity) || 0));
        scopes[scope] = scopedMeta;
      });
      var migratedRoot = { schema:WALLPAPER_META_SCHEMA, scopes:{} };
      migratedRoot.scopes = scopes;
      var previousRaw = '';
      try { previousRaw = localStorage.getItem(WALLPAPER_META_KEY) || ''; } catch (_) {}
      try {
        localStorage.setItem(WALLPAPER_META_KEY, JSON.stringify(migratedRoot));
      } catch (_) {
        throw new Error('WALLPAPER_META_MIGRATION_FAILED');
      }
      var db = await openWallpaperDb();
      try {
        await new Promise(function(resolve, reject){
          var tx = db.transaction('wallpapers', 'readwrite');
          var store = tx.objectStore('wallpapers');
          Object.keys(legacyScopes).forEach(function(scope){
            var legacy = legacyScopes[scope] || {};
            var oldStageKey = root.schema === 2 ? 'v2|' + scope + '|stage' : 'stage';
            var oldGlobalKey = root.schema === 2 ? 'v2|' + scope + '|global' : 'global';
            var newGlobalKey = 'v2|' + scope + '|global';
            var globalReq = store.get(oldGlobalKey);
            globalReq.onsuccess = function(){
              if (globalReq.result) {
                var record = globalReq.result;
                record.meta = Object.assign({}, record.meta || {}, scopes[scope] && scopes[scope].global || {}, { target:'global' });
                store.put(record, newGlobalKey);
                if (oldGlobalKey !== newGlobalKey) store.delete(oldGlobalKey);
                store.delete(oldStageKey);
                return;
              }
              var stageReq = store.get(oldStageKey);
              stageReq.onsuccess = function(){
                if (stageReq.result) {
                  var stageRecord = stageReq.result;
                  stageRecord.meta = Object.assign({}, stageRecord.meta || {}, scopes[scope] && scopes[scope].global || {}, { target:'global' });
                  store.put(stageRecord, newGlobalKey);
                }
                store.delete(oldStageKey);
              };
            };
            if (legacy.weather) {
              var oldWeatherKey = root.schema === 2 ? 'v2|' + scope + '|weather' : 'weather';
              var newWeatherKey = 'v2|' + scope + '|weather';
              var weatherReq = store.get(oldWeatherKey);
              weatherReq.onsuccess = function(){
                if (!weatherReq.result) return;
                var weatherRecord = weatherReq.result;
                weatherRecord.meta = Object.assign({}, weatherRecord.meta || {}, scopes[scope] && scopes[scope].weather || {}, { target:'weather' });
                store.put(weatherRecord, newWeatherKey);
                if (oldWeatherKey !== newWeatherKey) store.delete(oldWeatherKey);
              };
            }
          });
          tx.oncomplete = resolve;
          tx.onerror = function(){ reject(tx.error || new Error('WALLPAPER_DB_MIGRATION_FAILED')); };
          tx.onabort = function(){ reject(tx.error || new Error('WALLPAPER_DB_MIGRATION_ABORTED')); };
        });
      } catch (error) {
        try {
          if (previousRaw) localStorage.setItem(WALLPAPER_META_KEY, previousRaw);
          else localStorage.removeItem(WALLPAPER_META_KEY);
        } catch (_) {}
        throw error;
      } finally {
        db.close();
      }
      return true;
    })();
    try {
      return await wallpaperScopeMigration;
    } finally {
      wallpaperScopeMigration = null;
    }
  }
  function openWallpaperDb() {
    return new Promise(function(resolve, reject) {
      var req = indexedDB.open('lumifield-wallpaper-picker', 1);
      req.onupgradeneeded = function(){ req.result.createObjectStore('wallpapers'); };
      req.onsuccess = function(){ resolve(req.result); };
      req.onerror = function(){ reject(req.error); };
    });
  }
  async function putWallpaperBlob(target, file, meta, operationScope) {
    target = canonicalWallpaperTarget(target);
    operationScope = assertWallpaperScope(operationScope);
    await ensureWallpaperScopeMigrated();
    assertWallpaperScope(operationScope);
    var scope = operationScope;
    var persistenceKey = wallpaperPersistenceKey(target, scope);
    meta = Object.assign({}, meta || {}, { scopeKey:scope, persistenceKey:persistenceKey });
    var previousMeta = wallpaperMeta(scope);
    var nextMeta = Object.assign({}, previousMeta);
    nextMeta[target] = meta;
    if (!saveWallpaperMeta(nextMeta, scope)) throw new Error('WALLPAPER_META_SAVE_FAILED');
    var db = await openWallpaperDb();
    try {
      await new Promise(function(resolve, reject){
        var tx = db.transaction('wallpapers', 'readwrite');
        tx.objectStore('wallpapers').put({ blob:file, meta:meta }, persistenceKey);
        tx.oncomplete = resolve;
        tx.onerror = function(){ reject(tx.error || new Error('WALLPAPER_BLOB_SAVE_FAILED')); };
        tx.onabort = function(){ reject(tx.error || new Error('WALLPAPER_BLOB_SAVE_ABORTED')); };
      });
    } catch (error) {
      saveWallpaperMeta(previousMeta, scope);
      throw error;
    } finally {
      db.close();
    }
    assertWallpaperScope(operationScope);
    return { ok:true, target:target, scopeKey:scope, persistenceKey:persistenceKey, meta:meta };
  }
  async function getWallpaperBlob(target, operationScope) {
    target = canonicalWallpaperTarget(target);
    operationScope = operationScope || wallpaperScopeKey();
    await ensureWallpaperScopeMigrated();
    var db = await openWallpaperDb();
    try {
      return await new Promise(function(resolve, reject){
        var req = db.transaction('wallpapers', 'readonly').objectStore('wallpapers').get(wallpaperPersistenceKey(target, operationScope));
        req.onsuccess = function(){ resolve(req.result || null); };
        req.onerror = function(){ reject(req.error || new Error('WALLPAPER_BLOB_READ_FAILED')); };
      });
    } finally {
      db.close();
    }
  }
  async function captureWallpaperPersistence(target, operationScope) {
    target = canonicalWallpaperTarget(target);
    operationScope = assertWallpaperScope(operationScope);
    await ensureWallpaperScopeMigrated();
    assertWallpaperScope(operationScope);
    var snapshot = {
      target:target,
      scopeKey:operationScope,
      persistenceKey:wallpaperPersistenceKey(target, operationScope),
      meta:wallpaperMeta(operationScope),
      record:await getWallpaperBlob(target, operationScope)
    };
    assertWallpaperScope(operationScope);
    return snapshot;
  }
  async function restoreWallpaperPersistence(snapshot) {
    if (!snapshot) return;
    var target = canonicalWallpaperTarget(snapshot.target);
    var scope = snapshot.scopeKey || wallpaperScopeKey();
    if (!saveWallpaperMeta(snapshot.meta || {}, scope)) throw new Error('WALLPAPER_ROLLBACK_META_FAILED');
    var db = await openWallpaperDb();
    try {
      await new Promise(function(resolve, reject){
        var tx = db.transaction('wallpapers', 'readwrite');
        var store = tx.objectStore('wallpapers');
        if (snapshot.record) store.put(snapshot.record, snapshot.persistenceKey || wallpaperPersistenceKey(target, scope));
        else store.delete(snapshot.persistenceKey || wallpaperPersistenceKey(target, scope));
        tx.oncomplete = resolve;
        tx.onerror = function(){ reject(tx.error || new Error('WALLPAPER_ROLLBACK_BLOB_FAILED')); };
        tx.onabort = function(){ reject(tx.error || new Error('WALLPAPER_ROLLBACK_ABORTED')); };
      });
    } finally { db.close(); }
  }
  async function deleteWallpaperRecords(targets, operationScope) {
    targets = Array.from(new Set((targets || []).map(canonicalWallpaperTarget)));
    if (!targets.length) return;
    operationScope = assertWallpaperScope(operationScope);
    await ensureWallpaperScopeMigrated();
    assertWallpaperScope(operationScope);
    var previousMeta = wallpaperMeta(operationScope);
    var nextMeta = Object.assign({}, previousMeta);
    targets.forEach(function(target){ delete nextMeta[target]; });
    if (!saveWallpaperMeta(nextMeta, operationScope)) throw new Error('WALLPAPER_META_CLEAR_FAILED');
    var db = await openWallpaperDb();
    try {
      await new Promise(function(resolve, reject){
        var tx = db.transaction('wallpapers', 'readwrite');
        var store = tx.objectStore('wallpapers');
        targets.forEach(function(target){ store.delete(wallpaperPersistenceKey(target, operationScope)); });
        tx.oncomplete = resolve;
        tx.onerror = function(){ reject(tx.error || new Error('WALLPAPER_BLOB_CLEAR_FAILED')); };
        tx.onabort = function(){ reject(tx.error || new Error('WALLPAPER_BLOB_CLEAR_ABORTED')); };
      });
    } catch (error) {
      saveWallpaperMeta(previousMeta, operationScope);
      throw error;
    } finally {
      db.close();
    }
    assertWallpaperScope(operationScope);
  }
  async function saveExternalWallpaperMeta(target, meta, operationScope) {
    target = canonicalWallpaperTarget(target);
    operationScope = assertWallpaperScope(operationScope);
    await ensureWallpaperScopeMigrated();
    assertWallpaperScope(operationScope);
    var previousMeta = wallpaperMeta(operationScope);
    var nextMeta = Object.assign({}, previousMeta);
    nextMeta[target] = Object.assign({}, meta || {}, {
      scopeKey:operationScope,
      persistenceKey:wallpaperPersistenceKey(target, operationScope)
    });
    if (!saveWallpaperMeta(nextMeta, operationScope)) throw new Error('WALLPAPER_META_SAVE_FAILED');
    var db = await openWallpaperDb();
    try {
      await new Promise(function(resolve, reject){
        var tx = db.transaction('wallpapers', 'readwrite');
        tx.objectStore('wallpapers').delete(wallpaperPersistenceKey(target, operationScope));
        tx.oncomplete = resolve;
        tx.onerror = function(){ reject(tx.error || new Error('WALLPAPER_OLD_BLOB_CLEAR_FAILED')); };
        tx.onabort = function(){ reject(tx.error || new Error('WALLPAPER_OLD_BLOB_CLEAR_ABORTED')); };
      });
    } catch (error) {
      saveWallpaperMeta(previousMeta, operationScope);
      throw error;
    } finally {
      db.close();
    }
    assertWallpaperScope(operationScope);
  }
  function revokeWallpaperUrl(key) {
    if (wallpaperObjectUrls[key]) { try { URL.revokeObjectURL(wallpaperObjectUrls[key]); } catch (_) {} }
    wallpaperObjectUrls[key] = '';
  }
  function wallpaperFitToCss(fit) {
    return fit === 'contain' ? 'contain' : (fit === 'fill' ? '100% 100%' : (fit === 'center' ? 'auto' : 'cover'));
  }
  function clampWallpaperOpacity(value) {
    value = Number(value);
    return isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
  }
  function wallpaperOpacityValue() {
    var meta = wallpaperMeta();
    if (meta.appOpacity != null) return clampWallpaperOpacity(meta.appOpacity);
    try {
      if (window.fx && window.fx.backgroundOpacity != null) return clampWallpaperOpacity(window.fx.backgroundOpacity);
    } catch (_) {}
    return 1;
  }
  function appWallpaperActive() {
    var layer = byId('custom-bg');
    return !!(layer && /^(image|video|web)$/.test(String(layer.dataset.lfWallpaperKind || '')));
  }
  function applyWallpaperOpacity(value) {
    value = clampWallpaperOpacity(value);
    var root = document.documentElement;
    var layer = byId('custom-bg');
    var video = byId('custom-bg-video');
    var web = byId('lf-global-wallpaper-web');
    var kind = layer ? String(layer.dataset.lfWallpaperKind || '') : '';
    root.style.setProperty('--lf-background-opacity', value.toFixed(3));
    if (layer && appWallpaperActive()) {
      layer.style.setProperty('--custom-bg-image-opacity', kind === 'image' ? value.toFixed(3) : '0');
      layer.style.setProperty('--custom-bg-video-opacity', kind === 'video' ? value.toFixed(3) : '0');
      layer.style.setProperty('--custom-bg-overlay-opacity', (value * 0.12).toFixed(3));
    }
    if (video && kind === 'video') video.style.opacity = value.toFixed(3);
    if (web) web.style.opacity = kind === 'web' ? value.toFixed(3) : '0';
    try { if (window.fx) window.fx.backgroundOpacity = value; } catch (_) {}
    var slider = byId('fx-bgopacity');
    if (slider && Math.abs(Number(slider.value) - value) > 0.0001) slider.value = String(value);
    if (slider && slider.parentElement) {
      var output = slider.parentElement.querySelector('output');
      if (output) output.textContent = value.toFixed(2);
    }
    return value;
  }
  async function setWallpaperOpacity(value, options) {
    options = options || {};
    value = applyWallpaperOpacity(value);
    if (options.persist === false || !wallpaperOwnerReady()) return { ok:true, opacity:value, persisted:false };
    var operationScope = wallpaperScopeKey();
    return enqueueWallpaperMutation('global', async function(){
      assertWallpaperScope(operationScope);
      await ensureWallpaperScopeMigrated();
      assertWallpaperScope(operationScope);
      var previousMeta = wallpaperMeta(operationScope);
      var nextMeta = Object.assign({}, previousMeta, { appOpacity:value });
      if (!saveWallpaperMeta(nextMeta, operationScope)) {
        applyWallpaperOpacity(previousMeta.appOpacity == null ? 1 : previousMeta.appOpacity);
        throw new Error('WALLPAPER_OPACITY_SAVE_FAILED');
      }
      if (operationScope !== wallpaperScopeKey()) {
        await refreshWallpaperScope();
        throw new Error('WALLPAPER_SCOPE_CHANGED');
      }
      return { ok:true, opacity:value, persisted:true, scopeKey:operationScope };
    });
  }
  function enqueueWallpaperMutation(target, work) {
    target = canonicalWallpaperTarget(target);
    var previous = wallpaperMutationQueues[target] || Promise.resolve();
    var current = previous.catch(function(){}).then(work);
    wallpaperMutationQueues[target] = current.catch(function(){});
    return current;
  }
  function waitForWallpaperTestGate(phase) {
    if (!(wallpaperTestMode || window.__LF_WALLPAPER_TEST__ === true)) return Promise.resolve();
    var gate = window.__LF_WALLPAPER_MUTATION_GATE__;
    return typeof gate === 'function' ? Promise.resolve(gate(String(phase || ''))) : Promise.resolve();
  }
  function assertWallpaperDialogSelection(selectionToken) {
    if (selectionToken !== wallpaperDialogSelectionToken) throw new Error('WALLPAPER_SELECTION_SUPERSEDED');
  }
  function validateWallpaperSource(url, mime, blob) {
    if (/^text\/html/i.test(mime || '') || mime === 'web') return Promise.resolve(true);
    var isVideo = /^video/i.test(mime || '');
    var headerValidation = Promise.resolve(true);
    if (isVideo && blob && typeof blob.slice === 'function') {
      if (!blob.size) return Promise.reject(new Error('WALLPAPER_VIDEO_EMPTY'));
      headerValidation = blob.slice(0, 32).arrayBuffer().then(function(buffer){
        var bytes = new Uint8Array(buffer);
        var webm = bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
        var mp4 = bytes.length >= 12 && String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) === 'ftyp';
        if (!webm && !mp4) throw new Error('WALLPAPER_VIDEO_CONTAINER_INVALID');
        return true;
      });
    }
    return headerValidation.then(function(){ return new Promise(function(resolve, reject){
      var done = false;
      var timer = setTimeout(function(){ finish(false, new Error('WALLPAPER_MEDIA_TIMEOUT')); }, 8000);
      var media;
      function finish(ok, error) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (media && media.tagName === 'VIDEO') {
          try { media.pause(); } catch (_) {}
          media.removeAttribute('src');
          try { media.load(); } catch (_) {}
        }
        ok ? resolve(true) : reject(error || new Error('WALLPAPER_MEDIA_INVALID'));
      }
      if (isVideo) {
        media = document.createElement('video');
        media.muted = true; media.preload = 'auto';
        media.oncanplay = function(){
          if (Number(media.videoWidth) > 0 && Number(media.videoHeight) > 0) finish(true);
          else finish(false, new Error('WALLPAPER_VIDEO_HAS_NO_VISUAL_TRACK'));
        };
        media.onerror = function(){ finish(false, new Error('WALLPAPER_VIDEO_INVALID')); };
        media.src = url;
        try { media.load(); } catch (error) { finish(false, error); }
      } else {
        media = new Image();
        media.onload = function(){ finish(true); };
        media.onerror = function(){ finish(false, new Error('WALLPAPER_IMAGE_INVALID')); };
        media.src = url;
      }
    }); });
  }
  function applyWeatherWallpaperUrl(url, type, fit) {
    var shell = document.querySelector('.lf-weather-shell');
    if (!shell) return false;
    var video = byId('lf-weather-video');
    if (!video) {
      video = document.createElement('video');
      video.id = 'lf-weather-video'; video.className = 'lf-weather-media';
      video.muted = true; video.loop = true; video.autoplay = true; video.playsInline = true; video.preload = 'auto';
      shell.insertBefore(video, shell.firstChild);
    }
    var web = byId('lf-weather-web');
    if (!web) {
      web = document.createElement('iframe');
      web.id = 'lf-weather-web'; web.className = 'lf-weather-media lf-wallpaper-web'; web.hidden = true;
      web.setAttribute('sandbox', 'allow-scripts'); web.setAttribute('referrerpolicy', 'no-referrer');
      shell.insertBefore(web, shell.firstChild);
    }
    shell.style.backgroundSize = wallpaperFitToCss(fit || 'cover');
    shell.style.backgroundPosition = fit === 'center' ? 'center center' : 'center';
    if (/^text\/html/i.test(type || '') || type === 'web') {
      try { video.pause(); } catch (_) {}
      video.hidden = true; web.hidden = false;
      if (web.getAttribute('src') !== url) web.setAttribute('src', url);
      shell.style.removeProperty('--lf-weather-wallpaper');
    } else if (/^video/i.test(type || '')) {
      shell.style.removeProperty('--lf-weather-wallpaper');
      web.hidden = true; web.removeAttribute('src');
      video.hidden = false; if (video.getAttribute('src') !== url) video.setAttribute('src', url); video.style.objectFit = fit === 'contain' ? 'contain' : (fit === 'fill' ? 'fill' : 'cover');
      var p = video.play(); if (p && p.catch) p.catch(function(){});
    } else {
      web.hidden = true; web.removeAttribute('src');
      if (video) { try { video.pause(); } catch (_) {} video.hidden = true; }
      shell.style.setProperty('--lf-weather-wallpaper', 'url("' + String(url).replace(/"/g, '') + '")');
    }
    return true;
  }
  function applyGlobalWallpaperUrl(url, type, fit) {
    var layer = byId('custom-bg'), video = byId('custom-bg-video');
    if (!layer) return false;
    var web = byId('lf-global-wallpaper-web');
    if (!web) {
      web = document.createElement('iframe'); web.id = 'lf-global-wallpaper-web'; web.className = 'lf-wallpaper-web'; web.hidden = true;
      web.setAttribute('sandbox', 'allow-scripts'); web.setAttribute('referrerpolicy', 'no-referrer');
      layer.appendChild(web);
    }
    if (/^text\/html/i.test(type || '') || type === 'web') {
      if (video) { try { video.pause(); } catch (_) {} video.removeAttribute('src'); try { video.load(); } catch (_) {} video.hidden = true; }
      web.hidden = false; if (web.getAttribute('src') !== url) web.setAttribute('src', url);
      layer.dataset.lfWallpaperKind = 'web';
      layer.style.setProperty('--custom-bg-image', 'none');
      document.body.classList.add('custom-background-override', 'lf-global-wallpaper-web-active');
      document.body.classList.remove('custom-background-video');
    } else if (/^video/i.test(type || '')) {
      web.hidden = true; web.removeAttribute('src'); document.body.classList.remove('lf-global-wallpaper-web-active');
      if (video) {
        if (video.getAttribute('src') !== url) { video.setAttribute('src', url); try { video.load(); } catch (_) {} }
        video.hidden = false; video.muted = true; video.loop = true; video.autoplay = true; video.preload = 'auto'; video.style.objectFit = fit === 'contain' ? 'contain' : (fit === 'fill' ? 'fill' : 'cover');
        layer.dataset.lfWallpaperKind = 'video';
        layer.style.setProperty('--custom-bg-image', 'none');
        document.body.classList.add('custom-background-override', 'custom-background-video');
        syncGlobalWallpaperVideoPlayback();
      }
    } else {
      web.hidden = true; web.removeAttribute('src'); document.body.classList.remove('lf-global-wallpaper-web-active');
      if (video) { try { video.pause(); } catch (_) {} video.removeAttribute('src'); try { video.load(); } catch (_) {} video.hidden = true; }
      layer.dataset.lfWallpaperKind = 'image';
      layer.style.setProperty('--custom-bg-image', 'url("' + String(url).replace(/"/g, '') + '")');
      layer.style.setProperty('background-size', wallpaperFitToCss(fit || 'cover'));
      document.body.classList.add('custom-background-override');
      document.body.classList.remove('custom-background-video');
    }
    document.body.classList.add('lf-stage-wallpaper-active');
    applyWallpaperOpacity(wallpaperOpacityValue());
    return true;
  }
  function syncGlobalWallpaperVideoPlayback() {
    var video = byId('custom-bg-video');
    if (!video || video.hidden || !video.getAttribute('src')) return;
    if (document.hidden) {
      try { video.pause(); } catch (_) {}
      return;
    }
    var play = video.play(); if (play && play.catch) play.catch(function(){});
  }
  document.addEventListener('visibilitychange', syncGlobalWallpaperVideoPlayback);
  function applyStageWallpaperUrl(url, type, fit) {
    return applyGlobalWallpaperUrl(url, type, fit);
  }
  function applyWallpaperUrl(target, url, type, fit) {
    target = canonicalWallpaperTarget(target);
    var applied = target === 'weather'
      ? applyWeatherWallpaperUrl(url, type, fit)
      : applyGlobalWallpaperUrl(url, type, fit);
    if (applied) wallpaperDisposed[target] = false;
    return applied;
  }
  var wallpaperDisposed = { weather:true, global:true };
  async function restoreWallpaperTarget(target, operationScope) {
    target = canonicalWallpaperTarget(target);
    operationScope = operationScope || wallpaperScopeKey();
    var token = ++wallpaperRestoreTokens[target];
    try {
      assertWallpaperScope(operationScope);
      if (!wallpaperOwnerReady()) {
        clearWallpaperTarget(target);
        return { ok:true, target:target, skipped:true, reason:'OWNER_PENDING' };
      }
      await ensureWallpaperScopeMigrated();
      assertWallpaperScope(operationScope);
      var all = wallpaperMeta(operationScope);
      if (token !== wallpaperRestoreTokens[target]) return { ok:false, target:target, stale:true, error:'RESTORE_SUPERSEDED' };
      if (!all[target]) {
        clearWallpaperTarget(target);
        return { ok:true, target:target, empty:true };
      }
      if (all[target].external && all[target].url) {
        if (token !== wallpaperRestoreTokens[target]) return { ok:false, target:target, stale:true, error:'RESTORE_SUPERSEDED' };
        var pinResult = await pinWallpaperVideoCache(all[target], operationScope, target);
        if (!pinResult || pinResult.ok === false) return { ok:false, target:target, error:pinResult && pinResult.error || 'WALLPAPER_VIDEO_CACHE_MISSING' };
        applyWallpaperUrl(target, all[target].url, all[target].mime || all[target].kind || '', all[target].fit);
        return { ok:true, target:target, restored:true, external:true };
      }
      var rec = await getWallpaperBlob(target, operationScope);
      assertWallpaperScope(operationScope);
      if (token !== wallpaperRestoreTokens[target]) return { ok:false, target:target, stale:true, error:'RESTORE_SUPERSEDED' };
      if (!rec || !rec.blob) {
        clearWallpaperTarget(target);
        return { ok:false, target:target, error:'WALLPAPER_BLOB_MISSING' };
      }
      revokeWallpaperUrl(target);
      wallpaperObjectUrls[target] = URL.createObjectURL(rec.blob);
      applyWallpaperUrl(target, wallpaperObjectUrls[target], rec.meta && rec.meta.mime, rec.meta && rec.meta.fit);
      return { ok:true, target:target, restored:true, external:false };
    } catch (error) {
      return { ok:false, target:target, error:String(error && error.message || error || 'WALLPAPER_RESTORE_FAILED') };
    }
  }
  function clearWallpaperTarget(target) {
    target = canonicalWallpaperTarget(target);
    if (target === 'weather') {
      var shell = document.querySelector('.lf-weather-shell'), weatherVideo = byId('lf-weather-video'), weatherWeb = byId('lf-weather-web');
      if (weatherVideo) { try { weatherVideo.pause(); } catch (_) {} weatherVideo.removeAttribute('src'); try { weatherVideo.load(); } catch (_) {} weatherVideo.hidden = true; }
      if (weatherWeb) { weatherWeb.removeAttribute('src'); weatherWeb.hidden = true; }
      if (shell) shell.style.removeProperty('--lf-weather-wallpaper');
      revokeWallpaperUrl(target);
      wallpaperDisposed[target] = true;
      return;
    }
    var globalLayer = byId('custom-bg'), globalVideo = byId('custom-bg-video'), globalWeb = byId('lf-global-wallpaper-web');
    if (globalVideo) {
      try { globalVideo.pause(); } catch (_) {}
      try { globalVideo.srcObject = null; } catch (_) {}
      globalVideo.removeAttribute('src');
      while (globalVideo.firstChild) globalVideo.removeChild(globalVideo.firstChild);
      try { globalVideo.load(); } catch (_) {}
      globalVideo.hidden = true;
      // Chromium may retain currentSrc after a revoked blob URL. Replace the inert
      // element so the released resource can no longer remain selected internally.
      if (globalVideo.currentSrc && globalVideo.parentNode) {
        var cleanVideo = globalVideo.cloneNode(false);
        cleanVideo.removeAttribute('src');
        cleanVideo.hidden = true;
        globalVideo.parentNode.replaceChild(cleanVideo, globalVideo);
        globalVideo = cleanVideo;
      }
    }
    if (globalWeb) { globalWeb.removeAttribute('src'); globalWeb.hidden = true; }
    if (globalLayer) {
      globalLayer.style.setProperty('--custom-bg-image', 'none');
      globalLayer.style.setProperty('--custom-bg-image-opacity', '0');
      globalLayer.style.setProperty('--custom-bg-video-opacity', '0');
      globalLayer.style.setProperty('--custom-bg-overlay-opacity', '0');
      globalLayer.style.removeProperty('background-size');
      delete globalLayer.dataset.lfWallpaperKind;
    }
    document.body.classList.remove('lf-global-wallpaper-web-active', 'lf-stage-wallpaper-active', 'custom-background-video', 'custom-background-override');
    revokeWallpaperUrl(target);
    wallpaperDisposed[target] = true;
  }
  async function clearWallpaperTargetsPersistent(targets, options) {
    targets = Array.from(new Set((targets || []).map(canonicalWallpaperTarget)));
    if (!targets.length) return { ok:false, error:'INVALID_WALLPAPER_TARGET' };
    var operationScope = wallpaperScopeKey();
    return enqueueWallpaperMutation(targets[0], async function(){
      var snapshots = [];
      try {
        assertWallpaperScope(operationScope);
        for (var index = 0; index < targets.length; index++) snapshots.push(await captureWallpaperPersistence(targets[index], operationScope));
        await waitForWallpaperTestGate('clear-after-snapshot');
        assertWallpaperScope(operationScope);
        targets.forEach(function(target){ wallpaperRestoreTokens[target] += 1; });
        await deleteWallpaperRecords(targets, operationScope);
        assertWallpaperScope(operationScope);
        targets.forEach(function(target){
          clearWallpaperTarget(target);
          if (wallpaperDialogState.previewedTargets) delete wallpaperDialogState.previewedTargets[target];
        });
        for (var unpinIndex = 0; unpinIndex < snapshots.length; unpinIndex++) {
          var clearedSnapshot = snapshots[unpinIndex];
          var clearedMeta = clearedSnapshot && clearedSnapshot.meta && clearedSnapshot.meta[clearedSnapshot.target];
          await unpinWallpaperVideoCache(clearedMeta, operationScope, clearedSnapshot.target);
        }
        try {
          document.dispatchEvent(new CustomEvent('lumifield-wallpaper-state-change', {
            detail:{ action:'clear', targets:targets.slice(), scopeKey:wallpaperScopeKey() }
          }));
        } catch (_) {}
        return { ok:true, targets:targets.slice(), scopeKey:operationScope, persistent:true, disposed:true };
      } catch (error) {
        for (var i = 0; i < snapshots.length; i++) {
          try { await restoreWallpaperPersistence(snapshots[i]); } catch (_) {}
        }
        if (operationScope === wallpaperScopeKey()) {
          for (var j = 0; j < targets.length; j++) await restoreWallpaperTarget(targets[j], operationScope);
        } else {
          await refreshWallpaperScope();
        }
        return { ok:false, targets:targets.slice(), error:String(error && error.message || error || 'WALLPAPER_CLEAR_FAILED') };
      }
    });
  }
  async function wallpaperDbRecordCount(target) {
    await ensureWallpaperScopeMigrated();
    var db = await openWallpaperDb();
    try {
      return await new Promise(function(resolve, reject){
        var req = db.transaction('wallpapers', 'readonly').objectStore('wallpapers').count(wallpaperPersistenceKey(target));
        req.onsuccess = function(){ resolve(Number(req.result) || 0); };
        req.onerror = function(){ reject(req.error || new Error('WALLPAPER_DB_COUNT_FAILED')); };
      });
    } finally {
      db.close();
    }
  }
  function wallpaperMediaStatus(target) {
    target = canonicalWallpaperTarget(target);
    if (target === 'weather') {
      var weatherShell = document.querySelector('.lf-weather-shell');
      var weatherVideo = byId('lf-weather-video');
      var weatherWeb = byId('lf-weather-web');
      return {
        image:weatherShell ? weatherShell.style.getPropertyValue('--lf-weather-wallpaper') || '' : '',
        video:weatherVideo && !weatherVideo.hidden ? weatherVideo.getAttribute('src') || '' : '',
        web:weatherWeb && !weatherWeb.hidden ? weatherWeb.getAttribute('src') || '' : ''
      };
    }
    var globalLayer = byId('custom-bg');
    var globalVideo = byId('custom-bg-video');
    var globalWeb = byId('lf-global-wallpaper-web');
    var globalImage = globalLayer ? globalLayer.style.getPropertyValue('--custom-bg-image') || '' : '';
    return {
      active:document.body.classList.contains('custom-background-override'),
      image:globalImage === 'none' ? '' : globalImage,
      video:globalVideo && !globalVideo.hidden ? globalVideo.getAttribute('src') || '' : '',
      web:globalWeb && !globalWeb.hidden ? globalWeb.getAttribute('src') || '' : ''
    };
  }
  async function wallpaperStateStatus(target) {
    target = canonicalWallpaperTarget(target);
    var meta = wallpaperMeta();
    var count = 0;
    try { count = wallpaperOwnerReady() ? await wallpaperDbRecordCount(target) : 0; } catch (_) {}
    return {
      ok:true,
      target:target,
      scopeKey:wallpaperScopeKey(),
      persistenceKey:wallpaperPersistenceKey(target),
      meta:meta[target] || null,
      media:wallpaperMediaStatus(target),
      opacity:target === 'global' ? wallpaperOpacityValue() : 1,
      objectUrl:wallpaperObjectUrls[target] || '',
      dbRecordCount:count,
      texture:{ present:false, disposed:true, mediaDisposed:wallpaperDisposed[target] !== false, renderer:'dom-css-media' }
    };
  }
  async function refreshWallpaperScope() {
    ['weather','global'].forEach(function(target){
      wallpaperRestoreTokens[target] += 1;
      clearWallpaperTarget(target);
    });
    if (!wallpaperOwnerReady()) return { ok:true, scopeKey:wallpaperScopeKey(), pending:true };
    await ensureWallpaperScopeMigrated();
    var results = [];
    for (var i = 0; i < 2; i++) results.push(await restoreWallpaperTarget(['weather','global'][i]));
    applyWallpaperOpacity(wallpaperOpacityValue());
    return { ok:results.every(function(result){ return result.ok || result.empty; }), scopeKey:wallpaperScopeKey(), results:results };
  }
  async function importPresetWallpaper(payload, options) {
    payload = payload || {};
    options = options || {};
    var operationScope = wallpaperScopeKey();
    var opacity = payload.opacity == null ? null : clampWallpaperOpacity(payload.opacity);
    var media = payload.media && typeof payload.media === 'object' ? payload.media : null;
    if (!media) return opacity == null ? { ok:true, skipped:true } : setWallpaperOpacity(opacity, { persist:true });
    var type = /^(image|video)$/.test(String(media.type || '')) ? String(media.type) : '';
    var src = String(media.src || media.url || '').trim();
    if (!type || !/^(?:data:|https?:\/\/)/i.test(src)) throw new Error('PRESET_WALLPAPER_INVALID');
    var mime = type === 'video' ? 'video/webm' : 'image/png';
    var operationUrl = src;
    var blob = null;
    if (/^data:/i.test(src)) {
      var response = await fetch(src);
      if (!response.ok) throw new Error('PRESET_WALLPAPER_DECODE_FAILED');
      blob = await response.blob();
      mime = blob.type || mime;
      operationUrl = URL.createObjectURL(blob);
    }
    try {
      await validateWallpaperSource(operationUrl, mime, blob);
      assertWallpaperScope(operationScope);
      return await enqueueWallpaperMutation('global', async function(){
        assertWallpaperScope(operationScope);
        var snapshot = await captureWallpaperPersistence('global', operationScope);
        try {
          await waitForWallpaperTestGate('preset-after-snapshot');
          assertWallpaperScope(operationScope);
          if (opacity != null) {
            var scoped = wallpaperMeta(operationScope);
            if (!saveWallpaperMeta(Object.assign({}, scoped, { appOpacity:opacity }), operationScope)) throw new Error('WALLPAPER_OPACITY_SAVE_FAILED');
          }
          var meta = { target:'global', fit:'cover', name:String(media.name || '预设壁纸').slice(0, 120), mime:mime, size:blob && blob.size || 0, savedAt:Date.now(), source:options.source || 'preset-import' };
          if (blob) await putWallpaperBlob('global', blob, meta, operationScope);
          else await saveExternalWallpaperMeta('global', Object.assign(meta, { external:true, url:src, kind:type }), operationScope);
          assertWallpaperScope(operationScope);
          var restored = await restoreWallpaperTarget('global', operationScope);
          if (!restored || !restored.ok) throw new Error(restored && restored.error || 'PRESET_WALLPAPER_APPLY_FAILED');
          applyWallpaperOpacity(opacity == null ? wallpaperOpacityValue() : opacity);
          return { ok:true, target:'global', scopeKey:operationScope };
        } catch (error) {
          await restoreWallpaperPersistence(snapshot);
          if (operationScope === wallpaperScopeKey()) await restoreWallpaperTarget('global', operationScope);
          else await refreshWallpaperScope();
          throw error;
        }
      });
    } finally {
      if (blob && operationUrl) try { URL.revokeObjectURL(operationUrl); } catch (_) {}
    }
  }
  window.LumiFieldWallpaperState = {
    status:wallpaperStateStatus,
    restore:restoreWallpaperTarget,
    clear:function(target, options){ return clearWallpaperTargetsPersistent([target], options || {}); },
    isActive:appWallpaperActive,
    applyOpacity:applyWallpaperOpacity,
    setOpacity:setWallpaperOpacity,
    importPreset:importPresetWallpaper,
    refreshScope:refreshWallpaperScope,
    setTestUser:async function(value, options) {
      if (!(wallpaperTestMode || window.__LF_WALLPAPER_TEST__ === true)) return { ok:false, error:'TEST_MODE_REQUIRED' };
      options = options || {};
      if (options.waitForMutations !== false) await Promise.all(Object.keys(wallpaperMutationQueues).map(function(key){ return wallpaperMutationQueues[key].catch(function(){}); }));
      wallpaperScopeRevision += 1;
      ['weather','global'].forEach(function(target){ wallpaperRestoreTokens[target] += 1; clearWallpaperTarget(target); });
      wallpaperScopeOverride = String(value || '').trim();
      wallpaperScopeMigration = null;
      if (options.waitForMutations === false) {
        var revision = wallpaperScopeRevision;
        Promise.all(Object.keys(wallpaperMutationQueues).map(function(key){ return wallpaperMutationQueues[key].catch(function(){}); })).then(function(){
          if (revision === wallpaperScopeRevision) return refreshWallpaperScope();
        }).catch(function(){});
        return { ok:true, scopeKey:wallpaperScopeKey(), pending:true };
      }
      return refreshWallpaperScope();
    }
  };
  window.clearLumiFieldWallpaperTarget = function(target, options) {
    return clearWallpaperTargetsPersistent([target], options || {});
  };
  window.clearLumiFieldWallpaperBackgrounds = function(options) {
    return clearWallpaperTargetsPersistent(['global'], options || {});
  };
  document.addEventListener('lumifield-auth-user-change', function(){
    var revision = ++wallpaperScopeRevision;
    wallpaperScopeMigration = null;
    ['weather','global'].forEach(function(target){ wallpaperRestoreTokens[target] += 1; clearWallpaperTarget(target); });
    Promise.all(Object.keys(wallpaperMutationQueues).map(function(key){ return wallpaperMutationQueues[key].catch(function(){}); })).then(function(){
      if (revision === wallpaperScopeRevision) return refreshWallpaperScope();
    }).catch(function(error){ console.warn('wallpaper scope refresh failed:', error); });
  });
  function disposeWallpaperDialogPreview() {
    var preview = byId('lf-wallpaper-preview');
    if (!preview) return;
    preview.querySelectorAll('video').forEach(function(video){
      try { video.pause(); } catch (_) {}
      video.removeAttribute('src');
      try { video.load(); } catch (_) {}
    });
    preview.querySelectorAll('iframe').forEach(function(frame){ frame.removeAttribute('src'); });
    preview.textContent = '尚未选择本地壁纸';
  }
  async function finishWallpaperDialog(commitTarget, skipRestore) {
    wallpaperDialogSelectionToken += 1;
    await cancelWallpaperVideoOptimization('DIALOG_CLOSED');
    var targets = Object.keys(wallpaperDialogState.previewedTargets || {});
    for (var i = 0; i < targets.length; i++) if (!commitTarget || targets[i] !== commitTarget) await restoreWallpaperTarget(targets[i]);
    if (commitTarget && !skipRestore) await restoreWallpaperTarget(commitTarget);
    wallpaperDialogState.previewedTargets = {};
    disposeWallpaperDialogPreview();
    revokeWallpaperUrl('dialog');
    wallpaperDialogState.file = null;
    wallpaperDialogState.importedAsset = null;
    wallpaperDialogState.videoOptimization = null;
    wallpaperDialogState.videoOptimizationPromise = null;
    wallpaperDialogState.objectUrl = '';
    var modal = byId('lf-wallpaper-modal'); if (modal) modal.classList.remove('show');
  }
  function renderWallpaperProviderStatus(list) {
    var box = byId('lf-wallpaper-provider-status');
    if (!box) return;
    var providers = list || [];
    box.innerHTML = providers.map(function(p){
      return '<div class="lf-wallpaper-provider-line" data-development-state="' + (p.paused ? 'PAUSED_DEVELOPMENT' : '') + '"><b>' + p.label + '</b><span>' + (p.paused ? '开发中' : (p.installed ? '已检测到本机应用' : '未检测到本机应用')) + '</span></div>';
    }).join('');
  }
  function previewImportedWallpaper(asset) {
    var preview = byId('lf-wallpaper-preview');
    if (!preview || !asset || !asset.url) return;
    if (asset.kind === 'web' || /^text\/html/i.test(asset.mime || '')) {
      preview.innerHTML = '<iframe src="' + esc(String(asset.url)) + '" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>';
    } else if (/^video/i.test(asset.mime || '') || asset.kind === 'video') {
      preview.innerHTML = '<video src="' + esc(String(asset.url)) + '" muted loop autoplay playsinline></video>';
    } else preview.innerHTML = '<img src="' + esc(String(asset.url)) + '" alt="">';
  }
  function renderWallpaperProjects(provider, result) {
    var box = byId('lf-wallpaper-projects');
    if (!box) return;
    var projects = result && result.projects || [];
    box.innerHTML = projects.map(function(project){
      return '<button type="button" class="lf-wallpaper-project' + (project.supported ? '' : ' unsupported') + '" data-lf-wallpaper-project="' + esc(project.id) + '" data-provider="' + esc(provider) + '"><b>' + esc(project.title || project.id) + '</b><span>' + esc(project.supported ? (project.kind || project.type || '壁纸') : (project.limitation || '当前格式不支持直接嵌入')) + '</span></button>';
    }).join('') || '<div class="lf-wallpaper-empty">未扫描到可导入资源。可选择本地项目目录或资源文件。</div>';
  }
  function initWallpaperEcosystem() {
    if (!byId('lf-wallpaper-modal')) {
      var modal = document.createElement('div');
      modal.id = 'lf-wallpaper-modal';
      modal.innerHTML =
        '<div class="lf-wallpaper-dialog" role="dialog" aria-modal="true">' +
          '<button id="lf-wallpaper-close" class="lf-panel-x" type="button" aria-label="关闭">×</button>' +
          '<div class="lf-wallpaper-title">更换壁纸</div>' +
          '<div class="lf-wallpaper-sub">本地图片 / 视频可正常导入；第三方壁纸接入暂停开发。</div>' +
          '<div class="lf-wallpaper-grid">' +
            '<button type="button" data-lf-wallpaper-provider="wallpaper_engine" data-development-state="PAUSED_DEVELOPMENT" disabled><b>Wallpaper Engine</b><span>开发中</span></button>' +
            '<button type="button" data-lf-wallpaper-provider="qianqian" data-development-state="PAUSED_DEVELOPMENT" disabled><b>网易千千壁纸</b><span>开发中</span></button>' +
            '<button type="button" data-lf-wallpaper-provider="local"><b>本地图片 / 视频</b><span>选择文件后可预览、应用、确定保存</span></button>' +
          '</div>' +
          '<div id="lf-wallpaper-provider-status" class="lf-wallpaper-status"></div>' +
          '<div class="lf-wallpaper-provider-actions"><button type="button" data-lf-wallpaper-select="file" disabled>开发中</button><button type="button" data-lf-wallpaper-select="folder" disabled>开发中</button><button type="button" id="lf-wallpaper-open-external" disabled>开发中</button></div>' +
          '<div id="lf-wallpaper-projects" class="lf-wallpaper-projects"></div>' +
          '<div class="lf-wallpaper-row"><span>应用范围</span><select id="lf-wallpaper-target"><option value="stage">主 / 副界面共享背景</option><option value="weather">天气面板</option></select></div>' +
          '<div class="lf-wallpaper-row"><span>显示模式</span><select id="lf-wallpaper-fit"><option value="cover">拉伸覆盖</option><option value="contain">原比例适应</option><option value="fill">填充</option><option value="center">居中</option></select></div>' +
          '<div id="lf-wallpaper-preview" class="lf-wallpaper-preview">尚未选择本地壁纸</div>' +
          '<div class="lf-wallpaper-video-opt"><span id="lf-wallpaper-video-opt-status" data-phase="idle">选择视频后将自动探测并优化</span><progress id="lf-wallpaper-video-opt-progress" max="1" value="0" aria-label="视频优化进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></progress><button id="lf-wallpaper-video-opt-cancel" type="button" disabled>取消优化</button></div>' +
          '<input id="lf-wallpaper-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime,video/x-matroska" hidden>' +
          '<div class="lf-wallpaper-actions"><button id="lf-wallpaper-clear" type="button">清除当前壁纸</button><button id="lf-wallpaper-apply" type="button">应用</button><button id="lf-wallpaper-ok" type="button">确定</button><button id="lf-wallpaper-cancel" type="button">取消</button></div>' +
        '</div>';
      document.body.appendChild(modal);
      byId('lf-wallpaper-close').onclick = function(){ finishWallpaperDialog(''); };
      modal.addEventListener('click', function(e){ if (e.target === modal) finishWallpaperDialog(''); });
      byId('lf-wallpaper-target').onchange = function(e){
        wallpaperDialogState.target = e.target.value || 'stage';
      };
      byId('lf-wallpaper-fit').onchange = function(e){
        wallpaperDialogState.fit = e.target.value || 'cover';
      };
      byId('lf-wallpaper-file').onchange = async function(e){
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        var selectionToken = ++wallpaperDialogSelectionToken;
        await cancelWallpaperVideoOptimization('SELECTION_CHANGED');
        if (selectionToken !== wallpaperDialogSelectionToken) return;
        wallpaperDialogState.file = file;
        wallpaperDialogState.importedAsset = null;
        wallpaperDialogState.videoOptimization = null;
        wallpaperDialogState.videoOptimizationPromise = null;
        disposeWallpaperDialogPreview();
        revokeWallpaperUrl('dialog');
        var preview = byId('lf-wallpaper-preview');
        if (/^video\//i.test(file.type || '') || /\.(?:mp4|m4v|mov|webm|ogv|mkv)$/i.test(file.name || '')) {
          wallpaperDialogState.objectUrl = '';
          preview.textContent = '视频已选择；正在后台探测并生成高质量缓存副本，不会修改原文件。';
          wallpaperVideoStatus('probing', 0, '正在后台探测：' + (file.name || '本地视频'));
          var preloadTarget = canonicalWallpaperTarget(byId('lf-wallpaper-target').value || 'stage');
          var preloadPromise = optimizeWallpaperVideoFile(file, preloadTarget, selectionToken);
          wallpaperDialogState.videoOptimizationPromise = preloadPromise;
          preloadPromise.then(function(result){
            if (selectionToken !== wallpaperDialogSelectionToken) return;
            wallpaperDialogState.videoOptimization = result;
          }).catch(function(){
            if (selectionToken !== wallpaperDialogSelectionToken || wallpaperDialogState.videoOptimizationPromise !== preloadPromise) return;
            wallpaperDialogState.videoOptimizationPromise = null;
            wallpaperDialogState.videoOptimization = null;
          });
        } else {
          wallpaperObjectUrls.dialog = URL.createObjectURL(file);
          wallpaperDialogState.objectUrl = wallpaperObjectUrls.dialog;
          preview.innerHTML = '<img src="' + wallpaperDialogState.objectUrl + '" alt="">';
          wallpaperVideoStatus('idle', 0, '图片无需视频优化');
        }
      };
      modal.addEventListener('click', function(e){
        var providerBtn = e.target.closest('[data-lf-wallpaper-provider]');
        if (!providerBtn) return;
        var provider = providerBtn.getAttribute('data-lf-wallpaper-provider');
        wallpaperDialogState.provider = provider;
        if (provider === 'local') { byId('lf-wallpaper-file').click(); return; }
        var modules = ensureWallpaperModules();
        if (modules && modules.manager) {
          var box = byId('lf-wallpaper-projects'); if (box) box.innerHTML = '<div class="lf-wallpaper-empty">正在扫描本机资源…</div>';
          modules.manager.projects(provider).then(function(res){ renderWallpaperProjects(provider, res); }).catch(function(){ renderWallpaperProjects(provider, {projects:[]}); });
        }
      });
      modal.addEventListener('click', function(e){
        var projectBtn = e.target.closest('[data-lf-wallpaper-project]');
        if (!projectBtn) return;
        if (projectBtn.classList.contains('unsupported')) { if (typeof window.showToast === 'function') showToast(projectBtn.querySelector('span').textContent); return; }
        var modules = ensureWallpaperModules(), provider = projectBtn.getAttribute('data-provider'), projectId = projectBtn.getAttribute('data-lf-wallpaper-project');
        if (!modules || !modules.manager) return;
        projectBtn.disabled = true;
        modules.manager.import(provider, projectId).then(function(res){
          projectBtn.disabled = false;
          if (!res || !res.ok) { if (typeof window.showToast === 'function') showToast((res && (res.limitation || res.error)) || '壁纸导入失败'); return; }
          wallpaperDialogSelectionToken += 1;
          cancelWallpaperVideoOptimization('PROVIDER_IMPORT_SELECTED').catch(function(){});
          wallpaperDialogState.file = null; wallpaperDialogState.importedAsset = res; wallpaperDialogState.objectUrl = res.url;
          wallpaperDialogState.videoOptimization = null; wallpaperDialogState.videoOptimizationPromise = null;
          previewImportedWallpaper(res);
          if (typeof window.showToast === 'function') showToast('已导入到 LF，可应用或确定');
        }).catch(function(){ projectBtn.disabled = false; });
      });
      modal.addEventListener('click', function(e){
        var selectBtn = e.target.closest('[data-lf-wallpaper-select]');
        if (!selectBtn || wallpaperDialogState.provider === 'local') return;
        var modules = ensureWallpaperModules(); if (!modules || !modules.manager) return;
        modules.manager.select(wallpaperDialogState.provider, selectBtn.getAttribute('data-lf-wallpaper-select') === 'folder').then(function(res){
          if (res && res.project) renderWallpaperProjects(wallpaperDialogState.provider, { projects:[res.project] });
        }).catch(function(){});
      });
      byId('lf-wallpaper-open-external').onclick = function(){
        var modules = ensureWallpaperModules(), provider = wallpaperDialogState.provider;
        if (modules && modules.manager && provider !== 'local') modules.manager.open(provider).catch(function(){});
      };
      byId('lf-wallpaper-clear').onclick = async function(){
        var button = byId('lf-wallpaper-clear');
        var target = byId('lf-wallpaper-target').value || 'stage';
        wallpaperDialogSelectionToken += 1;
        button.disabled = true;
        var result = await clearWallpaperTargetsPersistent([target], { source:'wallpaper-dialog' });
        button.disabled = false;
        if (typeof window.showToast === 'function') showToast(result.ok ? '壁纸已清除' : '壁纸清除失败，请重试');
        if (result.ok) await finishWallpaperDialog(target);
      };
      byId('lf-wallpaper-video-opt-cancel').onclick = function(){ cancelWallpaperVideoOptimization('USER_CANCELLED'); };
      byId('lf-wallpaper-apply').onclick = function(){
        applyWallpaperDialog(false).catch(function(error){
          console.warn('wallpaper preview failed:', error);
          if (typeof window.showToast === 'function') showToast('壁纸预览失败');
        });
      };
      byId('lf-wallpaper-ok').onclick = function(){
        applyWallpaperDialog(true).catch(function(error){
          window.__lfWallpaperLastError = String(error && (error.stack || error.message) || error || 'WALLPAPER_SAVE_FAILED');
          console.warn('wallpaper save failed:', error);
          if (typeof window.showToast === 'function') showToast('壁纸保存失败');
        });
      };
      byId('lf-wallpaper-cancel').onclick = function(){ finishWallpaperDialog(''); };
    }
    injectWallpaperEntry();
    restoreWallpaperTarget('weather');
    restoreWallpaperTarget('global');
  }
  function injectWallpaperEntry() {
    var panel = byId('fx-panel');
    if (panel && !byId('lf-wallpaper-open')) {
      var btn = document.createElement('button');
      btn.id = 'lf-wallpaper-open'; btn.type = 'button'; btn.className = 'lf-v2-action lf-wallpaper-open';
      btn.textContent = '更换壁纸';
      btn.onclick = function(){ openWallpaperDialog('stage'); };
      panel.insertBefore(btn, panel.firstChild);
    }
  }
  function openWallpaperDialog(target) {
    wallpaperDialogSelectionToken += 1;
    wallpaperDialogState.target = target === 'weather' ? 'weather' : 'stage';
    wallpaperDialogState.previewedTargets = {};
    var modal = byId('lf-wallpaper-modal');
    if (!modal) return;
    byId('lf-wallpaper-target').value = wallpaperDialogState.target === 'weather' ? 'weather' : 'stage';
    byId('lf-wallpaper-fit').value = wallpaperDialogState.fit || 'cover';
    modal.classList.add('show');
    renderWallpaperProviderStatus([
      { label:'Wallpaper Engine', paused:true },
      { label:'网易千千壁纸', paused:true }
    ]);
  }
  async function applyWallpaperDialog(confirm) {
    var file = wallpaperDialogState.file;
    var imported = wallpaperDialogState.importedAsset;
    var selectionToken = wallpaperDialogSelectionToken;
    var previewUrl = wallpaperDialogState.objectUrl;
    var localVideo = !!(file && (/^video\//i.test(file.type || '') || /\.(?:mp4|m4v|mov|webm|ogv|mkv)$/i.test(file.name || '')));
    if ((!file && !imported) || (!previewUrl && !localVideo)) {
      if (typeof window.showToast === 'function') showToast('请先选择或导入壁纸');
      return;
    }
    var operationScope = wallpaperScopeKey();
    var optimization = null;
    if (localVideo) {
      optimization = wallpaperDialogState.videoOptimization;
      if (!optimization) {
        if (!wallpaperDialogState.videoOptimizationPromise) {
          wallpaperDialogState.videoOptimizationPromise = optimizeWallpaperVideoFile(file, canonicalWallpaperTarget(byId('lf-wallpaper-target').value || 'stage'), selectionToken);
          wallpaperDialogState.videoOptimizationPromise.catch(function(){});
        }
        optimization = await wallpaperDialogState.videoOptimizationPromise;
      }
      assertWallpaperDialogSelection(selectionToken);
      if (!optimization || optimization.ok === false) throw new Error(optimization && optimization.error || 'WALLPAPER_VIDEO_OPTIMIZATION_FAILED');
      wallpaperDialogState.videoOptimization = optimization;
      var optimizedFile = optimization.file || optimization.blob;
      if (optimizedFile instanceof Blob) {
        file = optimizedFile;
        imported = null;
        revokeWallpaperUrl('dialog');
        wallpaperObjectUrls.dialog = URL.createObjectURL(file);
        previewUrl = wallpaperObjectUrls.dialog;
        wallpaperDialogState.objectUrl = previewUrl;
      } else if (optimization.url) {
        imported = Object.assign({}, optimization, {
          kind:'video', mime:optimization.mime || 'video/mp4', title:optimization.sourceName || optimization.originalName || (file && file.name) || '视频壁纸'
        });
        file = null;
        previewUrl = optimization.url;
        wallpaperDialogState.importedAsset = imported;
        wallpaperDialogState.objectUrl = previewUrl;
      } else {
        throw new Error('WALLPAPER_VIDEO_OPTIMIZED_MEDIA_MISSING');
      }
    }
    var target = byId('lf-wallpaper-target').value || 'stage';
    var fit = byId('lf-wallpaper-fit').value || 'cover';
    var canonicalTarget = canonicalWallpaperTarget(target);
    var meta = imported ? { target:canonicalTarget, fit:fit, name:imported.title || imported.sourceName || '', mime:imported.mime || '', size:imported.bytes || 0, savedAt:Date.now(), external:true, url:imported.url, kind:imported.kind, provider:imported.provider || 'local-optimized', projectId:imported.projectId || imported.cacheKey || '' } : { target:canonicalTarget, fit:fit, name:file.name || '', mime:file.type || '', size:file.size || 0, savedAt:Date.now() };
    if (optimization) {
      meta.optimized = optimization.optimized === true;
      meta.cached = optimization.cached === true || optimization.cacheHit === true;
      meta.sourceName = String(optimization.sourceName || optimization.originalName || wallpaperDialogState.file && wallpaperDialogState.file.name || '');
      meta.originalName = meta.sourceName;
      meta.cacheKey = String(optimization.cacheKey || '');
      meta.importId = String(optimization.importId || '');
      meta.sourceHash = String(optimization.sourceHash || '');
      meta.optimizationPlan = optimization.plan || optimization.optimizationPlan || null;
      meta.probe = optimization.probe || optimization.metadata || null;
      meta.encoder = String(optimization.encoder || '');
      meta.hardwareAccelerated = optimization.hardwareAccelerated === true;
      meta.hardwareFallback = optimization.hardwareFallback === true;
    }
    meta.scopeKey = operationScope;
    meta.persistenceKey = wallpaperPersistenceKey(canonicalTarget, operationScope);
    var modules = ensureWallpaperModules();
    if (!confirm) {
      await validateWallpaperSource(previewUrl, imported ? (imported.mime || imported.kind || '') : (file.type || ''), file);
      await waitForWallpaperTestGate('preview-after-validation');
      assertWallpaperDialogSelection(selectionToken);
      assertWallpaperScope(operationScope);
      if (modules && modules.previewDialog) modules.previewDialog.preview({ target:canonicalTarget, fit:fit, url:previewUrl, mime:file && file.type || imported && (imported.mime || imported.kind) || '' });
      else applyWallpaperUrl(canonicalTarget, previewUrl, file && file.type || imported && (imported.mime || imported.kind) || '', fit);
      wallpaperDialogState.previewedTargets[canonicalTarget] = true;
      if (typeof window.showToast === 'function') showToast('壁纸已预览应用');
      return;
    }
    var operationUrl = file ? URL.createObjectURL(file) : previewUrl;
    try {
      await enqueueWallpaperMutation(canonicalTarget, async function(){
        if (operationScope !== wallpaperScopeKey()) throw new Error('WALLPAPER_SCOPE_CHANGED');
        await validateWallpaperSource(operationUrl, imported ? (imported.mime || imported.kind || '') : (file.type || ''), file);
        assertWallpaperDialogSelection(selectionToken);
        if (operationScope !== wallpaperScopeKey()) throw new Error('WALLPAPER_SCOPE_CHANGED');
        var snapshot = await captureWallpaperPersistence(canonicalTarget, operationScope);
        var previousVideoMeta = snapshot && snapshot.meta && snapshot.meta[canonicalTarget];
        var previousVideoReference = wallpaperVideoCacheReference(previousVideoMeta);
        var nextVideoReference = wallpaperVideoCacheReference(meta);
        var nextVideoPinned = false;
        try {
          await waitForWallpaperTestGate('save-after-snapshot');
          assertWallpaperDialogSelection(selectionToken);
          assertWallpaperScope(operationScope);
          if (nextVideoReference && !wallpaperVideoCacheReferenceEqual(previousVideoReference, nextVideoReference)) {
            var nextPinResult = await pinWallpaperVideoCache(meta, operationScope, canonicalTarget);
            if (!nextPinResult || nextPinResult.ok === false) throw new Error(nextPinResult && nextPinResult.error || 'WALLPAPER_VIDEO_PIN_FAILED');
            nextVideoPinned = true;
          }
          if (imported) await saveExternalWallpaperMeta(canonicalTarget, meta, operationScope);
          else await putWallpaperBlob(canonicalTarget, file, meta, operationScope);
          assertWallpaperDialogSelection(selectionToken);
          assertWallpaperScope(operationScope);
          var restored = await restoreWallpaperTarget(canonicalTarget, operationScope);
          if (!restored || !restored.ok) throw new Error(restored && restored.error || 'WALLPAPER_APPLY_FAILED');
          assertWallpaperDialogSelection(selectionToken);
          if (previousVideoReference && !wallpaperVideoCacheReferenceEqual(previousVideoReference, nextVideoReference)) {
            await unpinWallpaperVideoCache(previousVideoMeta, operationScope, canonicalTarget);
          }
        } catch (error) {
          if (nextVideoPinned && !wallpaperVideoCacheReferenceEqual(previousVideoReference, nextVideoReference)) {
            await unpinWallpaperVideoCache(meta, operationScope, canonicalTarget);
          }
          await restoreWallpaperPersistence(snapshot);
          if (operationScope === wallpaperScopeKey()) await restoreWallpaperTarget(canonicalTarget, operationScope);
          else await refreshWallpaperScope();
          throw error;
        }
      });
      wallpaperDialogState.previewedTargets[canonicalTarget] = true;
      if (selectionToken === wallpaperDialogSelectionToken) await finishWallpaperDialog(canonicalTarget, true);
      if (typeof window.showToast === 'function') showToast('壁纸已保存并应用');
    } finally {
      if (file && operationUrl) try { URL.revokeObjectURL(operationUrl); } catch (_) {}
    }
  }

  function initPerformanceMonitor() {
    var params = new URLSearchParams(location.search);
    var dev = params.get('perf') === '1' || read('lumifield-dev-perf', '0') === '1';
    var badge = null;
    if (dev) {
      badge = document.createElement('div');
      badge.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:90;padding:5px 8px;border-radius:7px;background:rgba(0,0,0,.72);color:#9ff3ff;font:10px/1.2 Consolas,monospace;pointer-events:none';
      badge.textContent = 'FPS --'; document.body.appendChild(badge);
      if (window.PerformanceObserver) {
        try { new PerformanceObserver(function (list) { list.getEntries().forEach(function (entry) { console.warn('[LumiField long task]', Math.round(entry.duration) + 'ms'); }); }).observe({ type:'longtask', buffered:true }); } catch (_) {}
      }
    }
    var lowWindows = 0, warned = false;
    var timer = setInterval(function () {
      if (document.hidden) return;
      var metrics = window.__lumifieldPerf;
      var fps = metrics && Number(metrics.fps);
      if (!isFinite(fps) || fps <= 0) return;
      if (badge) badge.textContent = 'FPS ' + Math.round(fps);
      lowWindows = fps < 28 ? lowWindows + 1 : Math.max(0, lowWindows - 1);
      if (!warned && lowWindows >= 4) {
        warned = true;
        if (typeof window.showToast === 'function') showToast('检测到持续低帧率，可在“粒子清晰度”切换到省电模式');
      }
    }, 2000);
    window.addEventListener('pagehide', function () { clearInterval(timer); }, { once:true });
  }

  function init() {
    save('lumifield-hourly-chime', '0');
    initLicensedFonts();
    injectTopControls();
    initLiquidGlassControls();
    initFxOverlay();
    initPanelCloseButtons();
    initHomePlayer();
    initImmersiveBottomHotZone();
    initGestureLifecycle();
    injectVisualizerControls();
    initSoftScan();
    initWeatherTools();
    initLoginStates();
    removeSearchModeTabs();
    initWallpaperEcosystem();
    syncNativeFullscreen();
    initPerformanceMonitor();
    setTimeout(initGestureStage, 100);
    setTimeout(function () { injectTopControls(); initLiquidGlassControls(); initPanelCloseButtons(); injectVisualizerControls(); initWeatherTools(); initLicensedFonts(); removeSearchModeTabs(); initWallpaperEcosystem(); }, 800);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
