(function (global) {
  'use strict';

  if (global.LumiFieldParticleRangeControl) return;

  var SOURCE = Object.freeze({
    material: '桌面/文件13/鸿蒙.mp4 (reference only; not packaged)',
    referenceVideoSha256: '47074935E9D21BE26F38579C324BB1A08932F65DBB9E61E802AFC9358EBB9E87',
    sourceMode: 'FRAME_ANALYZED_REFERENCE_VIDEO',
    implementation: 'LUMIFIELD_INDEPENDENT_IMPLEMENTATION',
    releaseGate: 'NOT_BLOCKED_BY_REFERENCE_VIDEO'
  });
  var CONTROL_SELECTOR = 'input[type="range"],[role="slider"],#progress-bar';
  var MAX_PARTICLES = 2200;
  var state = {
    installed:false,
    disposed:false,
    canvas:null,
    context:null,
    observer:null,
    mediaQuery:null,
    mediaQueryMode:'',
    raf:0,
    lastFrameAt:0,
    width:0,
    height:0,
    dpr:1,
    particles:[],
    recycleCursor:0,
    activeControl:null,
    activePointerId:null,
    lastPointer:null,
    refreshQueued:false,
    controlCount:0,
    nativeRangeCount:0,
    customSliderCount:0,
    enabledVisibleCount:0,
    emissions:0,
    emittedParticles:0,
    pointerEvents:0,
    inputEvents:0,
    frameCount:0,
    resizeCount:0,
    deleteEffect:null,
    deleteStarts:0,
    deleteCompletions:0,
    deleteDuplicates:0,
    lastDeleteKey:'',
    completedDeleteKeys:Object.create(null),
    listenerCount:0
  };
  var lastPointByControl = new WeakMap();
  var activeVisualControls = new Set();

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function nowMs() {
    return global.performance && typeof global.performance.now === 'function' ? global.performance.now() : Date.now();
  }

  function reducedMotion() {
    return !!(state.mediaQuery && state.mediaQuery.matches);
  }

  function isElement(value) {
    return !!(value && value.nodeType === 1);
  }

  function closestControl(target) {
    if (!isElement(target)) return null;
    if (target.matches && target.matches(CONTROL_SELECTOR)) return target;
    return target.closest ? target.closest(CONTROL_SELECTOR) : null;
  }

  function controlFromEvent(event) {
    var path = event && typeof event.composedPath === 'function' ? event.composedPath() : [];
    for (var index = 0; index < path.length; index += 1) {
      var fromPath = closestControl(path[index]);
      if (fromPath) return fromPath;
    }
    var direct = closestControl(event && event.target);
    if (direct) return direct;
    if (event && isFinite(event.clientX) && isFinite(event.clientY) && document.elementFromPoint) {
      return closestControl(document.elementFromPoint(event.clientX, event.clientY));
    }
    return null;
  }

  function controlKey(control, index) {
    if (!control) return 'unknown:' + index;
    if (control.id) return control.id;
    var canonical = control.getAttribute('data-lf-canonical-path');
    if (canonical) return 'canonical:' + canonical;
    var scope = control.getAttribute('data-lf-scope');
    var scopedKey = control.getAttribute('data-lf-key');
    if (scope && scopedKey) return 'scope:' + scope + ':' + scopedKey;
    var echoEq = control.getAttribute('data-lf-echo-eq');
    if (echoEq != null) return 'echo-eq:' + echoEq;
    var visualEq = control.getAttribute('data-lf-visual-eq');
    if (visualEq) return 'visual-eq:' + visualEq;
    var rangeKey = control.getAttribute('data-lf-range');
    if (rangeKey) return 'range:' + rangeKey;
    if (scopedKey) return 'key:' + scopedKey;
    var label = control.getAttribute('aria-label');
    if (label) return 'label:' + label;
    return 'control:' + index;
  }

  function isVisibleControl(control) {
    if (!control || control.disabled || control.getAttribute('aria-disabled') === 'true') return false;
    var rect = control.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    var style = global.getComputedStyle ? global.getComputedStyle(control) : null;
    return !style || (style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0);
  }

  function scanControls() {
    var controls = Array.prototype.slice.call(document.querySelectorAll(CONTROL_SELECTOR));
    var nativeCount = 0;
    var customCount = 0;
    var visibleCount = 0;
    controls.forEach(function (control, index) {
      if (control.getAttribute('data-lf-particle-range-control') !== 'true') {
        control.setAttribute('data-lf-particle-range-control', 'true');
      }
      control.setAttribute('data-lf-particle-range-key', controlKey(control, index));
      if (control.matches('input[type="range"]')) nativeCount += 1;
      else customCount += 1;
      if (isVisibleControl(control)) visibleCount += 1;
    });
    state.controlCount = controls.length;
    state.nativeRangeCount = nativeCount;
    state.customSliderCount = customCount;
    state.enabledVisibleCount = visibleCount;
    return controls;
  }

  function scheduleRefresh() {
    if (state.refreshQueued || state.disposed) return;
    state.refreshQueued = true;
    var run = function () {
      state.refreshQueued = false;
      if (!state.disposed) scanControls();
    };
    if (typeof global.queueMicrotask === 'function') global.queueMicrotask(run);
    else Promise.resolve().then(run);
  }

  function ensureCanvas() {
    if (state.canvas && state.canvas.isConnected) return state.canvas;
    var canvas = document.createElement('canvas');
    canvas.id = 'lf-particle-range-overlay';
    canvas.className = 'lf-particle-range-overlay';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.setAttribute('role', 'presentation');
    document.body.appendChild(canvas);
    state.canvas = canvas;
    state.context = canvas.getContext('2d', { alpha:true, desynchronized:true });
    resizeCanvas(true);
    return canvas;
  }

  function resizeCanvas(force) {
    if (!state.canvas || !state.context) return false;
    var width = Math.max(1, Math.round(global.innerWidth || document.documentElement.clientWidth || 1));
    var height = Math.max(1, Math.round(global.innerHeight || document.documentElement.clientHeight || 1));
    var dpr = clamp(Number(global.devicePixelRatio) || 1, 1, 2.5);
    if (!force && width === state.width && height === state.height && Math.abs(dpr - state.dpr) < 0.001) return false;
    state.width = width;
    state.height = height;
    state.dpr = dpr;
    state.canvas.width = Math.max(1, Math.round(width * dpr));
    state.canvas.height = Math.max(1, Math.round(height * dpr));
    state.canvas.style.width = width + 'px';
    state.canvas.style.height = height + 'px';
    state.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.resizeCount += 1;
    return true;
  }

  function accentTriplet() {
    var value = global.getComputedStyle ? global.getComputedStyle(document.documentElement).getPropertyValue('--fc-accent-rgb') : '';
    var parts = String(value || '').match(/[\d.]+/g) || [];
    if (parts.length < 3) return [164, 117, 255];
    return [clamp(Number(parts[0]) || 164, 0, 255), clamp(Number(parts[1]) || 117, 0, 255), clamp(Number(parts[2]) || 255, 0, 255)];
  }

  function acquireParticle() {
    var particle;
    if (state.particles.length < MAX_PARTICLES) {
      particle = {};
      state.particles.push(particle);
    } else {
      particle = state.particles[state.recycleCursor % MAX_PARTICLES];
      state.recycleCursor = (state.recycleCursor + 1) % MAX_PARTICLES;
    }
    return particle;
  }

  function spawnParticle(options) {
    options = options || {};
    var particle = acquireParticle();
    particle.x = Number(options.x) || 0;
    particle.y = Number(options.y) || 0;
    particle.vx = Number(options.vx) || 0;
    particle.vy = Number(options.vy) || 0;
    particle.life = Math.max(0.08, Number(options.life) || 0.56);
    particle.maxLife = particle.life;
    particle.size = Math.max(0.45, Number(options.size) || 1.35);
    particle.alpha = clamp(Number(options.alpha) || 0.9, 0, 1);
    particle.drag = clamp(Number(options.drag) || 0.94, 0.80, 0.998);
    particle.gravity = Number(options.gravity) || 0;
    particle.wind = Number(options.wind) || 0;
    particle.r = clamp(Number(options.r) || 220, 0, 255);
    particle.g = clamp(Number(options.g) || 210, 0, 255);
    particle.b = clamp(Number(options.b) || 255, 0, 255);
    particle.bornAt = Number(options.bornAt) || 0;
    particle.kind = options.kind || 'range';
    particle.active = true;
    state.emittedParticles += 1;
    return particle;
  }

  function ensureFrame() {
    if (state.raf || state.disposed || document.hidden) return;
    state.lastFrameAt = nowMs();
    state.raf = global.requestAnimationFrame(frame);
  }

  function emitTrail(control, x, y, pointer, force) {
    if (!control || !isVisibleControl(control) || !isFinite(x) || !isFinite(y)) return false;
    var currentTime = nowMs();
    var previous = lastPointByControl.get(control);
    if (!previous) previous = { x:x, y:y, at:currentTime };
    var dx = x - previous.x;
    var dy = y - previous.y;
    var distance = Math.sqrt(dx * dx + dy * dy);
    if (!force && distance < 1.5 && currentTime - previous.at < 34) return false;
    var elapsed = Math.max(8, currentTime - previous.at);
    var speedX = dx / elapsed * 1000;
    var speedY = dy / elapsed * 1000;
    var steps = clamp(Math.ceil(Math.max(1, distance) / (pointer ? 4.5 : 7)), 1, pointer ? 12 : 7);
    var palette = accentTriplet();
    var reduced = reducedMotion();
    if (reduced) steps = Math.min(steps, 2);
    for (var step = 0; step < steps; step += 1) {
      var ratio = steps === 1 ? 1 : step / (steps - 1);
      var px = previous.x + dx * ratio;
      var py = previous.y + dy * ratio;
      var random = Math.random();
      var side = Math.random() < 0.5 ? -1 : 1;
      var perpendicularX = distance > 0.01 ? -dy / distance : 0;
      var perpendicularY = distance > 0.01 ? dx / distance : -1;
      spawnParticle({
        x:px + perpendicularX * side * (1 + random * 2.6),
        y:py + perpendicularY * side * (1 + random * 2.6),
        vx:clamp(speedX * 0.11, -82, 82) + perpendicularX * side * (8 + Math.random() * 24),
        vy:clamp(speedY * 0.11, -82, 82) + perpendicularY * side * (8 + Math.random() * 24) - 4,
        life:reduced ? 0.22 : 0.42 + Math.random() * 0.38,
        size:0.65 + Math.random() * 1.45,
        alpha:0.58 + Math.random() * 0.36,
        drag:0.925 + Math.random() * 0.045,
        gravity:-2.5,
        wind:5 + Math.random() * 11,
        r:Math.random() < 0.34 ? 245 : palette[0],
        g:Math.random() < 0.34 ? 248 : palette[1],
        b:255
      });
    }
    lastPointByControl.set(control, { x:x, y:y, at:currentTime });
    state.emissions += 1;
    control.setAttribute('data-lf-particle-range-active', 'true');
    control.__lfParticleRangeActiveUntil = currentTime + 180;
    activeVisualControls.add(control);
    ensureCanvas();
    ensureFrame();
    return true;
  }

  function valuePoint(control) {
    if (!control) return null;
    var rect = control.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    var min = Number(control.min != null && control.min !== '' ? control.min : control.getAttribute('aria-valuemin'));
    var max = Number(control.max != null && control.max !== '' ? control.max : control.getAttribute('aria-valuemax'));
    var value = Number(control.value != null && control.value !== '' ? control.value : control.getAttribute('aria-valuenow'));
    if (!isFinite(min)) min = 0;
    if (!isFinite(max) || max === min) max = min + 1;
    if (!isFinite(value)) value = min;
    var ratio = clamp((value - min) / (max - min), 0, 1);
    var style = global.getComputedStyle ? global.getComputedStyle(control) : null;
    var vertical = control.getAttribute('aria-orientation') === 'vertical' ||
      (style && /vertical/.test(String(style.writingMode || ''))) || rect.height > rect.width * 1.55;
    if (vertical) {
      return { x:rect.left + rect.width / 2, y:rect.bottom - Math.max(5, rect.height * ratio) };
    }
    if (style && style.direction === 'rtl') ratio = 1 - ratio;
    var inset = Math.min(9, rect.width * 0.06);
    return { x:rect.left + inset + (rect.width - inset * 2) * ratio, y:rect.top + rect.height / 2 };
  }

  function onPointerDown(event) {
    var control = controlFromEvent(event);
    if (!control || !isVisibleControl(control)) return;
    state.activeControl = control;
    state.activePointerId = event.pointerId;
    state.lastPointer = { x:event.clientX, y:event.clientY, at:nowMs() };
    emitTrail(control, event.clientX, event.clientY, true, true);
  }

  function onPointerMove(event) {
    state.pointerEvents += 1;
    var control = state.activeControl && (state.activePointerId == null || state.activePointerId === event.pointerId)
      ? state.activeControl : controlFromEvent(event);
    if (!control || !isVisibleControl(control)) return;
    var rect = control.getBoundingClientRect();
    if (event.clientX < rect.left - 8 || event.clientX > rect.right + 8 || event.clientY < rect.top - 8 || event.clientY > rect.bottom + 8) {
      if (control !== state.activeControl) return;
    }
    emitTrail(control, event.clientX, event.clientY, control === state.activeControl, false);
    state.lastPointer = { x:event.clientX, y:event.clientY, at:nowMs() };
  }

  function releasePointer(event) {
    if (state.activePointerId != null && event && event.pointerId != null && state.activePointerId !== event.pointerId) return;
    state.activeControl = null;
    state.activePointerId = null;
    state.lastPointer = null;
  }

  function onInput(event) {
    var control = closestControl(event.target);
    if (!control || !control.matches('input[type="range"],[role="slider"]') || !isVisibleControl(control)) return;
    state.inputEvents += 1;
    var point = valuePoint(control);
    if (point) emitTrail(control, point.x, point.y, false, true);
  }

  function onVisibilityChange() {
    if (!document.hidden) {
      resizeCanvas(true);
      if (state.particles.some(function (particle) { return particle.active; }) || state.deleteEffect) ensureFrame();
      return;
    }
    if (state.raf) global.cancelAnimationFrame(state.raf);
    state.raf = 0;
    state.particles.forEach(function (particle) { particle.active = false; });
    if (state.deleteEffect) finishDeleteEffect(false, 'document-hidden');
    clearCanvas();
  }

  function clearCanvas() {
    if (!state.context) return;
    state.context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    state.context.clearRect(0, 0, state.width, state.height);
  }

  function updateAndDrawParticles(time, dt) {
    var context = state.context;
    if (!context) return 0;
    var alive = 0;
    context.save();
    context.globalCompositeOperation = 'lighter';
    for (var index = 0; index < state.particles.length; index += 1) {
      var particle = state.particles[index];
      if (!particle.active) continue;
      if (particle.bornAt && time < particle.bornAt) {
        alive += 1;
        continue;
      }
      particle.life -= dt;
      if (particle.life <= 0) {
        particle.active = false;
        continue;
      }
      var frameDrag = Math.pow(particle.drag, dt * 60);
      particle.vx = particle.vx * frameDrag + particle.wind * dt;
      particle.vy = particle.vy * frameDrag + particle.gravity * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      var lifeRatio = clamp(particle.life / particle.maxLife, 0, 1);
      var alpha = particle.alpha * Math.min(1, lifeRatio * 2.4) * lifeRatio;
      context.fillStyle = 'rgba(' + Math.round(particle.r) + ',' + Math.round(particle.g) + ',' + Math.round(particle.b) + ',' + alpha.toFixed(3) + ')';
      context.shadowColor = 'rgba(' + Math.round(particle.r) + ',' + Math.round(particle.g) + ',' + Math.round(particle.b) + ',' + (alpha * 0.72).toFixed(3) + ')';
      context.shadowBlur = particle.kind === 'delete' ? 5.5 : 3.5;
      context.beginPath();
      context.arc(particle.x, particle.y, particle.size * (0.72 + lifeRatio * 0.36), 0, Math.PI * 2);
      context.fill();
      alive += 1;
    }
    context.restore();
    activeVisualControls.forEach(function (control) {
      if (!control || !control.isConnected || time >= Number(control.__lfParticleRangeActiveUntil || 0)) {
        if (control && control.removeAttribute) control.removeAttribute('data-lf-particle-range-active');
        activeVisualControls.delete(control);
      }
    });
    return alive;
  }

  function drawDeleteGhost(time) {
    var effect = state.deleteEffect;
    if (!effect || !effect.source || !state.context) return;
    var elapsed = time - effect.startAt;
    var duration = effect.duration;
    var progress = clamp(elapsed / duration, 0, 1);
    var slideProgress = 1 - Math.pow(1 - clamp(progress / 0.58, 0, 1), 3);
    var dissolve = clamp((progress - 0.14) / 0.72, 0, 1);
    var sourceWidth = Math.max(1, Number(effect.source.width) || 1);
    var sourceHeight = Math.max(1, Number(effect.source.height) || 1);
    var bounds = effect.bounds;
    var cutSource = Math.floor(sourceWidth * dissolve);
    var cutScreen = bounds.width * dissolve;
    var slide = bounds.width * 0.22 * slideProgress;
    if (cutSource >= sourceWidth - 1 || progress >= 0.98) return;
    state.context.save();
    state.context.globalAlpha = Math.pow(1 - dissolve, 0.62) * 0.98;
    state.context.shadowColor = 'rgba(174,139,255,.30)';
    state.context.shadowBlur = 16;
    try {
      state.context.drawImage(
        effect.source,
        0, 0, sourceWidth - cutSource, sourceHeight,
        bounds.left + slide, bounds.top,
        Math.max(1, bounds.width - cutScreen), bounds.height
      );
    } catch (drawError) {
      effect.drawError = String(drawError && drawError.message || drawError);
    }
    state.context.restore();
  }

  function frame(time) {
    state.raf = 0;
    if (state.disposed || document.hidden) return;
    resizeCanvas(false);
    var dt = clamp((time - state.lastFrameAt) / 1000, 0.001, 0.04);
    state.lastFrameAt = time;
    clearCanvas();
    drawDeleteGhost(time);
    var alive = updateAndDrawParticles(time, dt);
    state.frameCount += 1;
    if (state.deleteEffect && time - state.deleteEffect.startAt >= state.deleteEffect.duration) {
      finishDeleteEffect(true, 'complete');
    }
    if (alive || state.deleteEffect) ensureFrame();
  }

  function sampleDeleteParticles(effect) {
    var source = effect.source;
    var context = source && typeof source.getContext === 'function' ? source.getContext('2d', { willReadFrequently:true }) : null;
    if (!context) return 0;
    var width = Math.max(1, source.width || 1);
    var height = Math.max(1, source.height || 1);
    var target = reducedMotion() ? 130 : 920;
    var step = Math.max(3, Math.floor(Math.sqrt(width * height / target)));
    var pixels;
    try {
      pixels = context.getImageData(0, 0, width, height).data;
    } catch (readError) {
      effect.readError = String(readError && readError.message || readError);
      return 0;
    }
    var created = 0;
    for (var y = Math.floor(step / 2); y < height; y += step) {
      for (var x = Math.floor(step / 2); x < width; x += step) {
        var offset = (y * width + x) * 4;
        var alpha = pixels[offset + 3] / 255;
        if (alpha < 0.11 || Math.random() > 0.88) continue;
        var normalizedX = x / width;
        var bornAt = effect.startAt + effect.duration * (0.13 + (1 - normalizedX) * 0.47) + Math.random() * 70;
        spawnParticle({
          x:effect.bounds.left + normalizedX * effect.bounds.width,
          y:effect.bounds.top + y / height * effect.bounds.height,
          vx:56 + Math.random() * 112 + normalizedX * 42,
          vy:-38 + (Math.random() - 0.5) * 68,
          life:0.46 + Math.random() * 0.42,
          size:0.7 + Math.random() * 1.75,
          alpha:clamp(alpha * 0.95, 0.34, 0.98),
          drag:0.965 + Math.random() * 0.022,
          gravity:-5 - Math.random() * 7,
          wind:28 + Math.random() * 42,
          r:pixels[offset],
          g:pixels[offset + 1],
          b:pixels[offset + 2],
          bornAt:bornAt,
          kind:'delete'
        });
        created += 1;
      }
    }
    return created;
  }

  function finishDeleteEffect(ok, reason) {
    var effect = state.deleteEffect;
    if (!effect) return;
    state.deleteEffect = null;
    if (ok) {
      state.deleteCompletions += 1;
      state.completedDeleteKeys[effect.key] = true;
    }
    var resolve = effect.resolve;
    effect.resolve = null;
    if (typeof resolve === 'function') resolve({ ok:!!ok, key:effect.key, reason:reason, particleCount:effect.particleCount || 0 });
  }

  function normalizeBounds(bounds) {
    bounds = bounds || {};
    var left = clamp(Number(bounds.left) || 0, -state.width, state.width * 2);
    var top = clamp(Number(bounds.top) || 0, -state.height, state.height * 2);
    var width = clamp(Number(bounds.width) || 0, 24, state.width * 1.5);
    var height = clamp(Number(bounds.height) || 0, 24, state.height * 1.5);
    return { left:left, top:top, width:width, height:height };
  }

  function animatePlaylistRemoval(snapshot) {
    snapshot = snapshot || {};
    var key = String(snapshot.operationId || snapshot.key || 'playlist-delete');
    if (state.deleteEffect) {
      if (state.deleteEffect.key === key) {
        state.deleteDuplicates += 1;
        return state.deleteEffect.promise;
      }
      finishDeleteEffect(false, 'superseded');
    }
    if (state.completedDeleteKeys[key]) {
      state.deleteDuplicates += 1;
      return Promise.resolve({ ok:false, key:key, reason:'already-completed', duplicate:true });
    }
    if (!snapshot.sourceCanvas || !snapshot.bounds) {
      return Promise.resolve({ ok:false, key:key, reason:'snapshot-unavailable' });
    }
    if (!state.installed) install();
    ensureCanvas();
    resizeCanvas(true);
    var effect = {
      key:key,
      source:snapshot.sourceCanvas,
      bounds:normalizeBounds(snapshot.bounds),
      startAt:nowMs(),
      duration:reducedMotion() ? 260 : 1580,
      resolve:null,
      promise:null,
      particleCount:0,
      drawError:'',
      readError:''
    };
    effect.promise = new Promise(function (resolve) { effect.resolve = resolve; });
    state.deleteEffect = effect;
    state.deleteStarts += 1;
    state.lastDeleteKey = key;
    if (typeof snapshot.hideOriginal === 'function') {
      try { snapshot.hideOriginal(); } catch (hideError) { effect.hideError = String(hideError && hideError.message || hideError); }
    }
    effect.particleCount = sampleDeleteParticles(effect);
    ensureFrame();
    return effect.promise;
  }

  function addListener(target, name, handler, options) {
    target.addEventListener(name, handler, options);
    state.listenerCount += 1;
  }

  function removeListener(target, name, handler, options) {
    target.removeEventListener(name, handler, options);
  }

  function install() {
    if (state.installed && !state.disposed) return true;
    state.disposed = false;
    state.installed = true;
    ensureCanvas();
    scanControls();
    addListener(document, 'pointerdown', onPointerDown, { capture:true, passive:true });
    addListener(document, 'pointermove', onPointerMove, { capture:true, passive:true });
    addListener(document, 'pointerup', releasePointer, { capture:true, passive:true });
    addListener(document, 'pointercancel', releasePointer, { capture:true, passive:true });
    addListener(document, 'input', onInput, true);
    addListener(document, 'change', onInput, true);
    addListener(document, 'visibilitychange', onVisibilityChange, false);
    addListener(global, 'resize', resizeCanvas, { passive:true });
    addListener(global, 'pagehide', dispose, { once:true });
    state.mediaQuery = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (state.mediaQuery) {
      if (typeof state.mediaQuery.addEventListener === 'function') {
        state.mediaQuery.addEventListener('change', scheduleRefresh);
        state.mediaQueryMode = 'event';
      } else if (typeof state.mediaQuery.addListener === 'function') {
        state.mediaQuery.addListener(scheduleRefresh);
        state.mediaQueryMode = 'legacy';
      }
    }
    state.observer = new MutationObserver(scheduleRefresh);
    state.observer.observe(document.body, { childList:true, subtree:true });
    return true;
  }

  function refresh() {
    if (!state.installed || state.disposed) install();
    ensureCanvas();
    resizeCanvas(false);
    return scanControls();
  }

  function getDebug() {
    var controls = Array.prototype.slice.call(document.querySelectorAll(CONTROL_SELECTOR));
    if (state.installed && !state.disposed) scanControls();
    var activeParticles = state.particles.filter(function (particle) { return particle.active; }).length;
    return {
      version:'1.0.0',
      initialized:state.installed && !state.disposed,
      source:SOURCE,
      controlSelector:CONTROL_SELECTOR,
      controlCount:state.controlCount,
      nativeRangeCount:state.nativeRangeCount,
      customSliderCount:state.customSliderCount,
      enabledVisibleCount:state.enabledVisibleCount,
      controlKeys:controls.map(controlKey),
      taggedCount:document.querySelectorAll('[data-lf-particle-range-control="true"]').length,
      canvasCount:document.querySelectorAll('#lf-particle-range-overlay').length,
      pointerEvents:state.pointerEvents,
      inputEvents:state.inputEvents,
      emissions:state.emissions,
      emittedParticles:state.emittedParticles,
      activeParticles:activeParticles,
      poolSize:state.particles.length,
      poolCapacity:MAX_PARTICLES,
      rafPending:!!state.raf,
      schedulerCount:state.raf ? 1 : 0,
      frameCount:state.frameCount,
      listenerCount:state.listenerCount + (state.mediaQueryMode ? 1 : 0),
      observerCount:state.observer ? 1 : 0,
      reducedMotion:reducedMotion(),
      deleteEffectActive:!!state.deleteEffect,
      deleteStarts:state.deleteStarts,
      deleteCompletions:state.deleteCompletions,
      deleteDuplicates:state.deleteDuplicates,
      lastDeleteKey:state.lastDeleteKey,
      deleteParticleCount:state.deleteEffect ? state.deleteEffect.particleCount : 0,
      viewport:{ width:state.width, height:state.height, dpr:state.dpr }
    };
  }

  function dispose() {
    if (state.disposed) return;
    state.disposed = true;
    state.installed = false;
    if (state.raf) global.cancelAnimationFrame(state.raf);
    state.raf = 0;
    removeListener(document, 'pointerdown', onPointerDown, { capture:true, passive:true });
    removeListener(document, 'pointermove', onPointerMove, { capture:true, passive:true });
    removeListener(document, 'pointerup', releasePointer, { capture:true, passive:true });
    removeListener(document, 'pointercancel', releasePointer, { capture:true, passive:true });
    removeListener(document, 'input', onInput, true);
    removeListener(document, 'change', onInput, true);
    removeListener(document, 'visibilitychange', onVisibilityChange, false);
    removeListener(global, 'resize', resizeCanvas, { passive:true });
    removeListener(global, 'pagehide', dispose, { once:true });
    if (state.observer) state.observer.disconnect();
    state.observer = null;
    if (state.mediaQuery) {
      if (state.mediaQueryMode === 'event' && typeof state.mediaQuery.removeEventListener === 'function') state.mediaQuery.removeEventListener('change', scheduleRefresh);
      if (state.mediaQueryMode === 'legacy' && typeof state.mediaQuery.removeListener === 'function') state.mediaQuery.removeListener(scheduleRefresh);
    }
    state.mediaQuery = null;
    state.mediaQueryMode = '';
    state.listenerCount = 0;
    state.particles.forEach(function (particle) { particle.active = false; });
    activeVisualControls.forEach(function (control) {
      if (control && control.removeAttribute) control.removeAttribute('data-lf-particle-range-active');
    });
    activeVisualControls.clear();
    state.completedDeleteKeys = Object.create(null);
    finishDeleteEffect(false, 'disposed');
    clearCanvas();
    if (state.canvas && state.canvas.parentNode) state.canvas.parentNode.removeChild(state.canvas);
    state.canvas = null;
    state.context = null;
    Array.prototype.forEach.call(document.querySelectorAll('[data-lf-particle-range-control="true"]'), function (control) {
      control.removeAttribute('data-lf-particle-range-control');
      control.removeAttribute('data-lf-particle-range-key');
      control.removeAttribute('data-lf-particle-range-active');
    });
  }

  global.LumiFieldParticleRangeControl = Object.freeze({
    version:'1.0.0',
    source:SOURCE,
    refresh:refresh,
    getDebug:getDebug,
    animatePlaylistRemoval:animatePlaylistRemoval,
    dispose:dispose
  });
  global.__lumifieldParticleRangeDebug = getDebug;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})(window);
