(function () {
  'use strict';

  var STORE = {
    background: 'lumifield-background-mode',
    particle: 'lumifield-particle-mode',
    opacity: 'lumifield-particle-opacity',
    brightness: 'lumifield-particle-brightness',
    saturation: 'lumifield-particle-saturation',
    primary: 'lumifield-particle-primary',
    secondary: 'lumifield-particle-secondary',
    beat: 'lumifield-particle-beat',
    city: 'lumifield-weather-city',
    weather: 'lumifield-weather-cache-v1'
  };
  var BG_MODES = ['default', 'weather', 'particles', 'lowpower'];
  var PARTICLE_MODES = ['single', 'multi', 'gradient', 'music', 'weather', 'cover'];
  var weatherState = null;
  var weatherRequest = null;
  var weatherRequestSerial = 0;
  var weatherInitialLoadSerial = 0;
  var weatherPerformance = {
    networkStarts: 0,
    dedupedRequests: 0,
    abortedRequests: 0,
    cacheHydrations: 0,
    staleResults: 0,
    initialLoadDeferred: false
  };
  var clockTimer = 0;
  var musicTimer = 0;
  var beatFollow = true;
  var ANIMATED_WEATHER_KINDS = ['sun', 'moon', 'cloud', 'partly-cloudy', 'rain', 'heavy-rain', 'snow', 'thunder', 'wind', 'fog', 'sunrise', 'rainbow'];
  var ANIMATED_WEATHER_LABELS = {
    sun: '晴', moon: '夜间晴', cloud: '多云', 'partly-cloudy': '少云', rain: '雨',
    'heavy-rain': '大雨', snow: '雪', thunder: '雷暴', wind: '大风', fog: '雾', sunrise: '日出', rainbow: '彩虹'
  };
  var animatedWeatherState = {
    initialized: false,
    shell: null,
    observer: null,
    motionQuery: null,
    motionHandler: null,
    visibilityHandler: null,
    pageHideHandler: null,
    listenerCount: 0,
    observerCount: 0,
    renderCount: 0,
    reducedMotion: false,
    documentHidden: !!document.hidden,
    windowVisible: true,
    paused: false,
    currentCode: null,
    currentKind: '',
    currentLabel: '',
    currentIsDay: true,
    currentParts: []
  };

  function read(key, fallback) {
    try { var value = localStorage.getItem(key); return value == null ? fallback : value; } catch (_) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (_) {}
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value))); }

  function ensureVisualLayers() {
    if (!document.getElementById('lf-weather-layer')) {
      var weatherLayer = document.createElement('div');
      weatherLayer.id = 'lf-weather-layer';
      weatherLayer.setAttribute('aria-hidden', 'true');
      document.body.prepend(weatherLayer);
    }
    if (!document.getElementById('lf-particle-tint')) {
      var particleLayer = document.createElement('div');
      particleLayer.id = 'lf-particle-tint';
      particleLayer.setAttribute('aria-hidden', 'true');
      document.body.appendChild(particleLayer);
    }
  }

  function markActive(selector, value, attr) {
    document.querySelectorAll(selector).forEach(function (button) {
      button.classList.toggle('active', button.getAttribute(attr) === value);
    });
  }

  function setBackgroundMode(mode) {
    if (BG_MODES.indexOf(mode) < 0) mode = 'default';
    BG_MODES.forEach(function (name) { document.body.classList.toggle('lf-bg-' + name, mode === name); });
    save(STORE.background, mode);
    markActive('[data-lf-bg]', mode, 'data-lf-bg');
    if (mode === 'lowpower' && typeof window.setPerformanceQualityMode === 'function') {
      try { window.setPerformanceQualityMode('eco'); } catch (_) {}
    }
  }

  function setParticleMode(mode) {
    if (PARTICLE_MODES.indexOf(mode) < 0) mode = 'gradient';
    PARTICLE_MODES.forEach(function (name) { document.body.classList.toggle('lf-particle-' + name, mode === name); });
    save(STORE.particle, mode);
    markActive('[data-lf-particle]', mode, 'data-lf-particle');
  }

  function setVisualVar(name, value) {
    document.documentElement.style.setProperty('--lf-particle-' + name, String(value));
    save(STORE[name], value);
    var out = document.querySelector('[data-lf-out="' + name + '"]');
    if (out) out.textContent = Math.round(Number(value) * 100) + '%';
  }

  function resetVisualModes() {
    setBackgroundMode('default');
    setParticleMode('gradient');
    setVisualVar('opacity', .28);
    setVisualVar('brightness', 1);
    setVisualVar('saturation', 1.15);
    beatFollow = true;
    save(STORE.beat, '1');
    var check = document.getElementById('lf-beat-follow');
    if (check) check.checked = true;
    var primary = document.getElementById('lf-primary-color');
    var secondary = document.getElementById('lf-secondary-color');
    if (primary && secondary) {
      primary.value = '#46d2ff'; secondary.value = '#9a4bff';
      primary.dispatchEvent(new Event('input'));
    }
    document.querySelectorAll('[data-lf-range]').forEach(function (input) {
      input.value = input.getAttribute('data-default');
    });
  }

  function injectVisualControls() {
    var panel = document.getElementById('fx-panel');
    if (!panel || document.getElementById('lf-visual-controls')) return;
    var section = document.createElement('section');
    section.id = 'lf-visual-controls';
    section.className = 'lf-controls';
    section.innerHTML = '<div class="lf-control-title"><span>光场模式</span><button class="lf-mode-btn" id="lf-reset-visual" type="button">重置</button></div>' +
      '<div class="lf-mode-grid">' +
      '<button class="lf-mode-btn" data-lf-bg="default">默认</button><button class="lf-mode-btn" data-lf-bg="weather">天气</button><button class="lf-mode-btn" data-lf-bg="particles">纯粒子</button><button class="lf-mode-btn" data-lf-bg="lowpower">低功耗</button>' +
      '</div><div class="lf-control-title" style="margin-top:14px"><span>粒子着色</span></div><div class="lf-mode-grid">' +
      '<button class="lf-mode-btn" data-lf-particle="single">单色</button><button class="lf-mode-btn" data-lf-particle="multi">多彩</button><button class="lf-mode-btn" data-lf-particle="gradient">渐变</button><button class="lf-mode-btn" data-lf-particle="music">随音乐</button><button class="lf-mode-btn" data-lf-particle="weather">随天气</button><button class="lf-mode-btn" data-lf-particle="cover">随封面</button>' +
      '</div>' +
      '<div class="lf-color-row"><input id="lf-primary-color" type="color" title="主颜色"><input id="lf-secondary-color" type="color" title="辅助颜色"><select id="lf-gradient-preset" title="渐变预设"><option value="custom">自定义</option><option value="aurora">极光</option><option value="sunset">日落</option><option value="ice">冰川</option><option value="rainbow">彩虹</option></select></div>' +
      '<label class="lf-range-row"><span>透明度</span><input data-lf-range="opacity" data-default="0.28" type="range" min="0" max="0.72" step="0.01"><output data-lf-out="opacity"></output></label>' +
      '<label class="lf-range-row"><span>亮度</span><input data-lf-range="brightness" data-default="1" type="range" min="0.45" max="1.8" step="0.05"><output data-lf-out="brightness"></output></label>' +
      '<label class="lf-range-row"><span>饱和度</span><input data-lf-range="saturation" data-default="1.15" type="range" min="0" max="2" step="0.05"><output data-lf-out="saturation"></output></label>' +
      '<label class="lf-toggle-row"><input id="lf-beat-follow" type="checkbox"> 跟随节拍响应</label>';
    var head = panel.querySelector('.fx-head');
    if (head && head.nextSibling) panel.insertBefore(section, head.nextSibling); else panel.prepend(section);
    section.addEventListener('click', function (event) {
      var bg = event.target.closest('[data-lf-bg]');
      var particle = event.target.closest('[data-lf-particle]');
      if (bg) setBackgroundMode(bg.getAttribute('data-lf-bg'));
      if (particle) setParticleMode(particle.getAttribute('data-lf-particle'));
    });
    document.getElementById('lf-reset-visual').addEventListener('click', resetVisualModes);
    section.querySelectorAll('[data-lf-range]').forEach(function (input) {
      var key = input.getAttribute('data-lf-range');
      var initial = clamp(read(STORE[key], input.getAttribute('data-default')), Number(input.min), Number(input.max));
      input.value = initial;
      setVisualVar(key, initial);
      input.addEventListener('input', function () { setVisualVar(key, input.value); });
    });
    beatFollow = read(STORE.beat, '1') !== '0';
    var beat = document.getElementById('lf-beat-follow');
    beat.checked = beatFollow;
    beat.addEventListener('change', function () { beatFollow = beat.checked; save(STORE.beat, beatFollow ? '1' : '0'); });
    var primary = document.getElementById('lf-primary-color');
    var secondary = document.getElementById('lf-secondary-color');
    primary.value = read(STORE.primary, '#46d2ff');
    secondary.value = read(STORE.secondary, '#9a4bff');
    function hexRgba(hex, alpha) {
      var n = parseInt(String(hex).slice(1), 16);
      return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
    }
    function applyPalette() {
      save(STORE.primary, primary.value); save(STORE.secondary, secondary.value);
      document.documentElement.style.setProperty('--lf-primary', hexRgba(primary.value, .30));
      document.documentElement.style.setProperty('--lf-secondary', hexRgba(secondary.value, .25));
    }
    primary.addEventListener('input', applyPalette); secondary.addEventListener('input', applyPalette); applyPalette();
    document.getElementById('lf-gradient-preset').addEventListener('change', function (event) {
      var palettes = { aurora: ['#25f5d2','#685cff'], sunset: ['#ff7043','#d946ef'], ice: ['#dff8ff','#4f8cff'], rainbow: ['#27e5ff','#ff4fc8'] };
      var palette = palettes[event.target.value];
      if (!palette) return;
      primary.value = palette[0]; secondary.value = palette[1]; applyPalette(); setParticleMode('gradient');
    });
    setBackgroundMode(read(STORE.background, 'default'));
    setParticleMode(read(STORE.particle, 'gradient'));
  }

  function weatherCodeLabel(code, isDay) {
    switch (Number(code)) {
      case 0: return isDay ? '晴' : '夜间晴';
      case 1: return isDay ? '晴间多云' : '夜间少云';
      case 2: return '多云';
      case 3: return '阴';
      case 5: return '霾';
      case 45: return '雾';
      case 48: return '雾凇';
      case 51: return '小毛毛雨';
      case 53: return '中毛毛雨';
      case 55: return '大毛毛雨';
      case 56: return '小冻毛毛雨';
      case 57: return '大冻毛毛雨';
      case 61: return '小雨';
      case 63: return '中雨';
      case 65: return '大雨';
      case 66: return '小冻雨';
      case 67: return '大冻雨';
      case 71: return '小雪';
      case 73: return '中雪';
      case 75: return '大雪';
      case 77: return '米雪';
      case 80: return '小阵雨';
      case 81: return '中阵雨';
      case 82: return '暴雨';
      case 85: return '小阵雪';
      case 86: return '大阵雪';
      case 95: return '雷雨';
      case 96: return '雷阵雨伴小冰雹';
      case 99: return '雷阵雨伴大冰雹';
      default: return '未知天气';
    }
  }

  function weatherParts(kind, isDay) {
    if (kind === 'sun') return ['sun', 'ray'];
    if (kind === 'moon') return ['moon', 'star'];
    if (kind === 'cloud') return ['cloud'];
    if (kind === 'partly-cloudy') return [isDay ? 'sun' : 'moon', 'cloud'];
    if (kind === 'rain' || kind === 'heavy-rain') return ['cloud', 'drop'];
    if (kind === 'snow') return ['cloud', 'snow'];
    if (kind === 'thunder') return ['cloud', 'bolt'];
    if (kind === 'wind') return ['wind'];
    if (kind === 'fog') return ['cloud', 'fog'];
    if (kind === 'sunrise') return ['sun', 'ray', 'horizon'];
    if (kind === 'rainbow') return ['cloud', 'rainbow'];
    return ['cloud'];
  }

  function resolveAnimatedWeather(code, isDay) {
    var day = !(isDay === 0 || isDay === false || isDay === '0');
    var requestedKind = typeof code === 'string' && ANIMATED_WEATHER_KINDS.indexOf(code) >= 0 ? code : '';
    var numericCode = requestedKind ? null : Number(code);
    var kind = requestedKind;
    if (!kind) {
      if (numericCode === 0) kind = day ? 'sun' : 'moon';
      else if (numericCode === 1 || numericCode === 2) kind = 'partly-cloudy';
      else if (numericCode === 3) kind = 'cloud';
      else if (numericCode === 5 || numericCode === 45 || numericCode === 48) kind = 'fog';
      else if ([51, 53, 55, 56, 57, 61, 63, 80].indexOf(numericCode) >= 0) kind = 'rain';
      else if ([65, 66, 67, 81, 82].indexOf(numericCode) >= 0) kind = 'heavy-rain';
      else if ([71, 73, 75, 77, 85, 86].indexOf(numericCode) >= 0) kind = 'snow';
      else if ([95, 96, 99].indexOf(numericCode) >= 0) kind = 'thunder';
      else kind = 'cloud';
    }
    return {
      kind: kind,
      label: requestedKind ? ANIMATED_WEATHER_LABELS[kind] : weatherCodeLabel(numericCode, day),
      parts: weatherParts(kind, day),
      isDay: day
    };
  }

  function animatedWeatherSvg(kind, label, isDay) {
    var cloud = '<g class="lf-wi-cloud" data-lf-weather-part="cloud"><path d="M12 31.5h23.5a6 6 0 0 0 .6-12 10.3 10.3 0 0 0-19.5-1.7A7.2 7.2 0 0 0 12 31.5Z"/></g>';
    var sun = '<g class="lf-wi-sun" data-lf-weather-part="sun"><circle class="lf-wi-sun-core" cx="24" cy="24" r="6.4"/><g class="lf-wi-rays" data-lf-weather-part="ray"><path d="M24 7.5v4M24 36.5v4M7.5 24h4M36.5 24h4M12.3 12.3l2.8 2.8M32.9 32.9l2.8 2.8M35.7 12.3l-2.8 2.8M15.1 32.9l-2.8 2.8"/></g></g>';
    var moon = '<g class="lf-wi-moon" data-lf-weather-part="moon"><path d="M31.7 10.4a14.3 14.3 0 1 0 6 24.2A12.8 12.8 0 0 1 31.7 10.4Z"/><g class="lf-wi-stars" data-lf-weather-part="star"><path d="M35 10v4M33 12h4M39 18v3M37.5 19.5h3"/></g></g>';
    var partlyLight = isDay
      ? '<g class="lf-wi-partly-light lf-wi-partly-sun" data-lf-weather-part="sun"><circle cx="17" cy="18" r="5"/><path data-lf-weather-part="ray" d="M17 8.5v3M17 24.5v3M7.5 18h3M23.5 18h3M10.4 11.4l2.1 2.1M21.5 22.5l2.1 2.1M23.6 11.4l-2.1 2.1"/></g>'
      : '<g class="lf-wi-partly-light lf-wi-partly-moon" data-lf-weather-part="moon"><path d="M20.8 9.6a8.7 8.7 0 1 0 4.7 15.7 7.8 7.8 0 0 1-4.7-15.7Z"/></g>';
    var drops = '<g class="lf-wi-drops" data-lf-weather-part="drop"><path d="M17 34v6M24 35v7M31 34v6"/></g>';
    var heavyDrops = '<g class="lf-wi-drops lf-wi-heavy-drops" data-lf-weather-part="drop"><path d="M14 34v8M21 35v8M28 34v8M35 35v7"/></g>';
    var snow = '<g class="lf-wi-snow" data-lf-weather-part="snow"><path d="M17 35v7M14 38.5h6M14.8 36.3l4.4 4.4M19.2 36.3l-4.4 4.4M31 35v7M28 38.5h6M28.8 36.3l4.4 4.4M33.2 36.3l-4.4 4.4"/></g>';
    var bolt = '<g class="lf-wi-bolt" data-lf-weather-part="bolt"><path d="M25.3 32.5 20.8 40h5l-1.2 6 7.5-9h-5.2l3-4.5Z"/></g>';
    var wind = '<g class="lf-wi-wind" data-lf-weather-part="wind"><path d="M8 17h23c5.2 0 5.2-7 1-7-2.4 0-3.5 1.4-3.5 3M8 24h29c5.2 0 5.2 7 1 7-2.4 0-3.5-1.4-3.5-3M8 31h15"/></g>';
    var fog = cloud + '<g class="lf-wi-fog" data-lf-weather-part="fog"><path d="M10 35.5h28M13 40h22M17 44h14"/></g>';
    var sunrise = '<g class="lf-wi-sunrise" data-lf-weather-part="sun"><path class="lf-wi-rising-sun" d="M16 30a8 8 0 0 1 16 0"/><g class="lf-wi-rays" data-lf-weather-part="ray"><path d="M24 12v5M11 30H6M42 30h-5M14.8 20.8l-3.6-3.6M33.2 20.8l3.6-3.6"/></g><g data-lf-weather-part="horizon"><path d="M8 31h32M12 36h24"/></g></g>';
    var rainbow = '<g class="lf-wi-rainbow" data-lf-weather-part="rainbow"><path class="lf-wi-rainbow-a" d="M7 34a17 17 0 0 1 34 0"/><path class="lf-wi-rainbow-b" d="M12 34a12 12 0 0 1 24 0"/><path class="lf-wi-rainbow-c" d="M17 34a7 7 0 0 1 14 0"/></g><g class="lf-wi-rainbow-clouds" data-lf-weather-part="cloud"><path d="M4 36h9a4 4 0 0 0 .2-8 6 6 0 0 0-11.1 2A3.5 3.5 0 0 0 4 36ZM35 36h9a3.5 3.5 0 0 0 1.9-6.5 6 6 0 0 0-11.1-1.5A4 4 0 0 0 35 36Z"/></g>';
    var body = cloud;
    if (kind === 'sun') body = sun;
    else if (kind === 'moon') body = moon;
    else if (kind === 'partly-cloudy') body = partlyLight + cloud;
    else if (kind === 'rain') body = cloud + drops;
    else if (kind === 'heavy-rain') body = cloud + heavyDrops;
    else if (kind === 'snow') body = cloud + snow;
    else if (kind === 'thunder') body = cloud + bolt;
    else if (kind === 'wind') body = wind;
    else if (kind === 'fog') body = fog;
    else if (kind === 'sunrise') body = sunrise;
    else if (kind === 'rainbow') body = rainbow;
    return '<svg class="lf-animated-weather-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false" data-lf-animated-weather="true" data-lf-weather-kind="' + kind + '" data-lf-weather-day="' + (isDay ? 'true' : 'false') + '">' + body + '</svg>';
  }

  function escapeWeatherText(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function renderAnimatedWeatherIcon(root, code, isDay, label) {
    if (!root) return null;
    var resolved = resolveAnimatedWeather(code, isDay);
    var chineseLabel = String(label || resolved.label || '天气');
    root.innerHTML = animatedWeatherSvg(resolved.kind, chineseLabel, resolved.isDay);
    root.setAttribute('role', 'img');
    root.setAttribute('aria-label', chineseLabel);
    root.setAttribute('title', chineseLabel);
    root.setAttribute('data-lf-weather-kind', resolved.kind);
    return resolved;
  }

  function applyAnimatedWeatherPauseState() {
    animatedWeatherState.documentHidden = !!document.hidden;
    var homeActive = !!(document.body && document.body.classList.contains('empty-home-active'));
    var desktopSuspended = !!(document.body && document.body.classList.contains('render-deep-sleep'));
    var lifecyclePaused = !animatedWeatherState.initialized || animatedWeatherState.reducedMotion || animatedWeatherState.documentHidden || !animatedWeatherState.windowVisible;
    animatedWeatherState.paused = lifecyclePaused || desktopSuspended || !homeActive;
    if (animatedWeatherState.shell) {
      animatedWeatherState.shell.setAttribute('data-lf-weather-paused', lifecyclePaused ? 'true' : 'false');
    }
  }

  function initAnimatedWeatherLifecycle() {
    if (animatedWeatherState.initialized) return;
    animatedWeatherState.initialized = true;
    animatedWeatherState.shell = document.querySelector('.lf-weather-shell');
    animatedWeatherState.windowVisible = !!animatedWeatherState.shell;
    animatedWeatherState.motionQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    animatedWeatherState.reducedMotion = !!(animatedWeatherState.motionQuery && animatedWeatherState.motionQuery.matches);
    animatedWeatherState.visibilityHandler = function () { applyAnimatedWeatherPauseState(); };
    document.addEventListener('visibilitychange', animatedWeatherState.visibilityHandler);
    animatedWeatherState.listenerCount += 1;
    animatedWeatherState.pageHideHandler = function () {
      cancelWeatherRequest();
      disposeAnimatedWeatherLifecycle();
    };
    window.addEventListener('pagehide', animatedWeatherState.pageHideHandler, { once: true });
    animatedWeatherState.listenerCount += 1;
    if (animatedWeatherState.motionQuery) {
      animatedWeatherState.motionHandler = function (event) {
        animatedWeatherState.reducedMotion = !!event.matches;
        applyAnimatedWeatherPauseState();
      };
      if (typeof animatedWeatherState.motionQuery.addEventListener === 'function') animatedWeatherState.motionQuery.addEventListener('change', animatedWeatherState.motionHandler);
      else if (typeof animatedWeatherState.motionQuery.addListener === 'function') animatedWeatherState.motionQuery.addListener(animatedWeatherState.motionHandler);
      animatedWeatherState.listenerCount += 1;
    }
    if (animatedWeatherState.shell && typeof window.IntersectionObserver === 'function') {
      animatedWeatherState.observer = new IntersectionObserver(function (entries) {
        var entry = entries && entries[0];
        animatedWeatherState.windowVisible = !!(entry && entry.isIntersecting && entry.intersectionRatio > 0);
        applyAnimatedWeatherPauseState();
      }, { threshold: [0, 0.01] });
      animatedWeatherState.observer.observe(animatedWeatherState.shell);
      animatedWeatherState.observerCount = 1;
    }
    applyAnimatedWeatherPauseState();
  }

  function disposeAnimatedWeatherLifecycle() {
    if (!animatedWeatherState.initialized) return;
    animatedWeatherState.paused = true;
    if (animatedWeatherState.shell) animatedWeatherState.shell.setAttribute('data-lf-weather-paused', 'true');
    if (animatedWeatherState.observer) animatedWeatherState.observer.disconnect();
    if (animatedWeatherState.visibilityHandler) document.removeEventListener('visibilitychange', animatedWeatherState.visibilityHandler);
    if (animatedWeatherState.pageHideHandler) window.removeEventListener('pagehide', animatedWeatherState.pageHideHandler);
    if (animatedWeatherState.motionQuery && animatedWeatherState.motionHandler) {
      if (typeof animatedWeatherState.motionQuery.removeEventListener === 'function') animatedWeatherState.motionQuery.removeEventListener('change', animatedWeatherState.motionHandler);
      else if (typeof animatedWeatherState.motionQuery.removeListener === 'function') animatedWeatherState.motionQuery.removeListener(animatedWeatherState.motionHandler);
    }
    animatedWeatherState.initialized = false;
    animatedWeatherState.shell = null;
    animatedWeatherState.observer = null;
    animatedWeatherState.motionQuery = null;
    animatedWeatherState.motionHandler = null;
    animatedWeatherState.visibilityHandler = null;
    animatedWeatherState.pageHideHandler = null;
    animatedWeatherState.observerCount = 0;
    animatedWeatherState.listenerCount = 0;
    animatedWeatherState.windowVisible = false;
  }

  function animatedWeatherDebug() {
    applyAnimatedWeatherPauseState();
    var desktopSuspended = !!(document.body && document.body.classList.contains('render-deep-sleep'));
    var mainRoots = document.querySelectorAll('#lf-weather-icon [data-lf-animated-weather="true"]').length;
    var forecastRoots = document.querySelectorAll('#lf-forecast [data-lf-animated-weather="true"]').length;
    return {
      initialized: animatedWeatherState.initialized,
      mainRootCount: mainRoots,
      forecastRootCount: forecastRoots,
      totalRootCount: mainRoots + forecastRoots,
      currentCode: animatedWeatherState.currentCode,
      currentKind: animatedWeatherState.currentKind,
      currentLabel: animatedWeatherState.currentLabel,
      currentIsDay: animatedWeatherState.currentIsDay,
      currentParts: animatedWeatherState.currentParts.slice(),
      supportedKinds: ANIMATED_WEATHER_KINDS.slice(),
      renderCount: animatedWeatherState.renderCount,
      mutationCount: 0,
      rafCount: 0,
      intervalCount: 0,
      listenerCount: animatedWeatherState.listenerCount,
      observerCount: animatedWeatherState.observerCount,
      reducedMotion: animatedWeatherState.reducedMotion,
      documentHidden: animatedWeatherState.documentHidden,
      windowVisible: animatedWeatherState.windowVisible && !animatedWeatherState.documentHidden && !desktopSuspended,
      desktopSuspended: desktopSuspended,
      paused: animatedWeatherState.paused,
      sourceMode: 'independent-observable-behavior'
    };
  }

  function weatherClass(code) {
    code = Number(code);
    if (code === 0) return 'clear';
    if (code >= 71 && code <= 86) return 'snow';
    if (code >= 51) return 'rain';
    return 'cloud';
  }

  function setWeatherMood(code) {
    ['clear', 'snow', 'rain', 'cloud'].forEach(function (name) {
      document.body.classList.toggle('lf-weather-' + name, weatherClass(code) === name);
    });
  }

  function renderClock() {
    var now = new Date();
    var clock = document.getElementById('lf-clock');
    var date = document.getElementById('lf-date');
    if (clock) clock.textContent = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    if (date) date.textContent = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  }

  function renderWeather(weather, stale, persist) {
    if (!weather) return;
    initAnimatedWeatherLifecycle();
    animatedWeatherState.renderCount += 1;
    weatherState = weather;
    window.lumiFieldWeather = weather;
    var city = document.getElementById('lf-weather-city');
    var updated = document.getElementById('lf-weather-updated');
    var icon = document.getElementById('lf-weather-icon');
    var temp = document.getElementById('lf-weather-temp');
    var label = document.getElementById('lf-weather-label');
    var details = document.getElementById('lf-weather-details');
    if (city) city.textContent = weather.location && weather.location.name || '当前位置';
    if (updated) updated.textContent = stale || weather.stale ? '离线缓存' : (weather.cached ? '缓存天气' : '刚刚更新');
    var currentResolved = resolveAnimatedWeather(weather.weatherCode, weather.isDay);
    var currentCode = Number(weather.weatherCode);
    var useNightLabel = !currentResolved.isDay && (currentCode === 0 || currentCode === 1);
    var currentDisplayLabel = String(useNightLabel ? currentResolved.label : (weather.label || currentResolved.label || '天气'));
    var currentIcon = renderAnimatedWeatherIcon(icon, weather.weatherCode, weather.isDay, currentDisplayLabel);
    animatedWeatherState.currentCode = currentCode;
    animatedWeatherState.currentKind = currentIcon && currentIcon.kind || '';
    animatedWeatherState.currentLabel = currentDisplayLabel;
    animatedWeatherState.currentIsDay = currentIcon ? currentIcon.isDay : true;
    animatedWeatherState.currentParts = currentIcon ? currentIcon.parts.slice() : [];
    if (temp) temp.textContent = Math.round(weather.temperature) + '°';
    if (label) label.textContent = currentDisplayLabel;
    if (details) {
      var directions = ['北','东北','东','东南','南','西南','西','西北'];
      var direction = directions[Math.round((((Number(weather.windDirection) || 0) % 360) + 360) % 360 / 45) % 8];
      var today = weather.forecast && weather.forecast[0];
      details.textContent = (today ? ('最高 ' + Math.round(today.temperatureMax) + '° · 最低 ' + Math.round(today.temperatureMin) + '° · ') : '') +
        '体感 ' + Math.round(weather.apparentTemperature) + '° · 湿度 ' + Math.round(weather.humidity) + '% · ' + direction + '风 ' + Math.round(weather.windSpeed) + ' km/h';
    }
    setWeatherMood(weather.weatherCode);
    var forecast = document.getElementById('lf-forecast');
    if (forecast) {
      forecast.innerHTML = (weather.forecast || []).slice(0, 7).map(function (day, index) {
        var date = new Date(day.date + 'T12:00:00');
        var weekday = index === 0 ? '今天' : date.toLocaleDateString('zh-CN', { weekday: 'short' });
        var resolved = resolveAnimatedWeather(day.weatherCode, 1);
        var condition = String(day.label || resolved.label || '天气');
        var safeCondition = escapeWeatherText(condition);
        return '<div class="lf-forecast-day' + (index === 0 ? ' today' : '') + '"><span>' + weekday + '</span><span class="lf-forecast-icon" role="img" aria-label="' + safeCondition + '" title="' + safeCondition + '" data-lf-weather-kind="' + resolved.kind + '">' + animatedWeatherSvg(resolved.kind, condition, true) + '</span><span class="lf-forecast-temp">' + Math.round(day.temperatureMax) + '°/' + Math.round(day.temperatureMin) + '°</span><span class="lf-forecast-rain">' + Math.round(day.precipitationProbability || 0) + '%</span></div>';
      }).join('');
    }
    if (persist !== false && !stale && !weather.stale) {
      var savedAt = Number(weather.updatedAt) || Date.now();
      try { save(STORE.weather, JSON.stringify({ savedAt: Math.min(Date.now(), savedAt), weather: weather })); } catch (_) {}
    }
  }

  async function requestJson(url, timeout, externalSignal) {
    var controller = window.AbortController ? new AbortController() : null;
    var abortFromExternal = controller && externalSignal ? function () {
      try { controller.abort(externalSignal.reason); } catch (_) { controller.abort(); }
    } : null;
    if (abortFromExternal) {
      if (externalSignal.aborted) abortFromExternal();
      else externalSignal.addEventListener('abort', abortFromExternal, { once: true });
    }
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeout || 12000) : 0;
    try {
      var signal = controller ? controller.signal : externalSignal;
      var response = await fetch(url, signal ? { signal: signal } : {});
      var body = await response.json();
      if (!response.ok || body.ok === false) {
        var failure = new Error(body.error || ('HTTP_' + response.status));
        failure.code = body.code || body.error || ('HTTP_' + response.status);
        failure.status = response.status;
        throw failure;
      }
      return body;
    } finally {
      if (timer) clearTimeout(timer);
      if (abortFromExternal) externalSignal.removeEventListener('abort', abortFromExternal);
    }
  }

  function readWeatherCache(city) {
    try {
      var parsed = JSON.parse(read(STORE.weather, '') || 'null');
      var savedCity = String(read(STORE.city, '') || '').trim();
      city = String(city || '').trim();
      if (!parsed || !parsed.weather || city && city !== savedCity) return null;
      return parsed;
    } catch (_) { return null; }
  }

  function hydrateWeatherCache(city) {
    var cached = readWeatherCache(city);
    if (!cached) return false;
    weatherPerformance.cacheHydrations += 1;
    weatherPerformance.staleResults += 1;
    renderWeather(cached.weather, true, false);
    return true;
  }

  function setWeatherBusy(busy) {
    var search = document.getElementById('lf-weather-search');
    var refresh = document.getElementById('lf-weather-refresh');
    var input = document.getElementById('lf-weather-city-input');
    if (search) search.disabled = !!busy;
    if (refresh) refresh.disabled = !!busy;
    if (input) input.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function weatherFailureText(error) {
    var code = String(error && error.code || '');
    if (code === 'WEATHER_CITY_NOT_FOUND' || error && error.status === 404) return '未找到该城市或地区';
    if (code === 'WEATHER_REQUEST_TIMEOUT' || error && error.name === 'AbortError') return '天气请求超时';
    if (code === 'WEATHER_NETWORK_ERROR' || error instanceof TypeError) return '天气网络连接失败';
    if (code === 'WEATHER_DATA_INVALID') return '天气数据异常';
    return '天气服务暂不可用';
  }

  async function performWeatherLoad(city, force, serial, signal) {
    var updated = document.getElementById('lf-weather-updated');
    if (updated) updated.textContent = weatherState ? '正在后台更新' : '正在更新';
    try {
      var query = '';
      city = String(city || '').trim();
      if (city) {
        query = '?city=' + encodeURIComponent(city) + (force ? '&t=' + Date.now() : '');
      } else {
        try {
          var location = await requestJson('/api/weather/ip-location', 9000, signal);
          var loc = location.location || {};
          query = '?lat=' + encodeURIComponent(loc.latitude) + '&lon=' + encodeURIComponent(loc.longitude) + '&city=' + encodeURIComponent(loc.city || '当前位置') + '&timezone=' + encodeURIComponent(loc.timezone || 'auto') + (force ? '&t=' + Date.now() : '');
        } catch (locationError) {
          city = String(read(STORE.city, '') || '').trim();
          if (!city) throw locationError;
          query = '?city=' + encodeURIComponent(city) + (force ? '&t=' + Date.now() : '');
        }
      }
      var result = await requestJson('/api/weather/current' + query, 15000, signal);
      if (serial !== weatherRequestSerial) return { ignored: true };
      renderWeather(result.weather, !!(result.weather && result.weather.stale), !(result.weather && result.weather.stale));
      var resolvedCity = city || String(result.weather && result.weather.location && result.weather.location.name || '').trim();
      if (resolvedCity && resolvedCity !== '当前位置') save(STORE.city, resolvedCity);
      return { ok: true, weather: result.weather };
    } catch (error) {
      if (serial !== weatherRequestSerial) return { ignored: true };
      if (error && error.name === 'AbortError') return { ignored: true, aborted: true };
      var failureText = weatherFailureText(error);
      var parsed = readWeatherCache(city);
      if (parsed && String(error && error.code || '') !== 'WEATHER_CITY_NOT_FOUND') {
        weatherPerformance.staleResults += 1;
        renderWeather(parsed.weather, true, false);
        if (updated) updated.textContent = failureText + ' · 离线缓存';
        return { ok: false, cached: true, error: error };
      }
      if (updated) updated.textContent = failureText;
      return { ok: false, cached: false, error: error };
    }
  }

  function loadWeather(city, force) {
    city = String(city || '').trim();
    var key = (city || '@location') + '|' + (force ? 'refresh' : 'cached');
    if (weatherRequest && weatherRequest.key === key) {
      weatherPerformance.dedupedRequests += 1;
      return weatherRequest.promise;
    }
    if (weatherRequest && weatherRequest.controller) {
      weatherPerformance.abortedRequests += 1;
      try { weatherRequest.controller.abort('WEATHER_REQUEST_SUPERSEDED'); } catch (_) {}
    }
    var serial = ++weatherRequestSerial;
    var controller = window.AbortController ? new AbortController() : null;
    weatherPerformance.networkStarts += 1;
    setWeatherBusy(true);
    var promise = performWeatherLoad(city, force, serial, controller && controller.signal).finally(function () {
      if (weatherRequest && weatherRequest.serial === serial) {
        weatherRequest = null;
        setWeatherBusy(false);
      }
    });
    weatherRequest = { key: key, serial: serial, promise: promise, controller: controller };
    return promise;
  }

  function cancelWeatherRequest() {
    weatherInitialLoadSerial += 1;
    weatherRequestSerial += 1;
    if (weatherRequest && weatherRequest.controller) {
      weatherPerformance.abortedRequests += 1;
      try { weatherRequest.controller.abort('WEATHER_REQUEST_CANCELLED'); } catch (_) {}
    }
    weatherRequest = null;
    setWeatherBusy(false);
  }

  function scheduleInitialWeatherLoad(city) {
    var serial = ++weatherInitialLoadSerial;
    weatherPerformance.initialLoadDeferred = true;
    function begin() {
      if (serial !== weatherInitialLoadSerial) return;
      loadWeather(city, false);
    }
    function afterPaint() {
      window.setTimeout(function () {
        if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(begin, { timeout: 700 });
        else begin();
      }, 0);
    }
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(afterPaint);
    else window.setTimeout(afterPaint, 0);
  }

  function initWeather() {
    initAnimatedWeatherLifecycle();
    renderClock();
    clockTimer = window.setInterval(renderClock, 1000);
    var search = document.getElementById('lf-weather-search');
    var refresh = document.getElementById('lf-weather-refresh');
    var input = document.getElementById('lf-weather-city-input');
    function searchCity() {
      weatherInitialLoadSerial += 1;
      var city = input && input.value.trim();
      if (city) return loadWeather(city, true);
      var updated = document.getElementById('lf-weather-updated');
      if (updated) updated.textContent = '请输入城市、区县或地址';
      return Promise.resolve({ ok: false, empty: true });
    }
    if (search) search.addEventListener('click', searchCity);
    if (input) input.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      searchCity();
    });
    if (refresh) refresh.addEventListener('click', function () {
      weatherInitialLoadSerial += 1;
      loadWeather(read(STORE.city, ''), true);
    });
    var initialCity = String(read(STORE.city, '') || '').trim();
    hydrateWeatherCache(initialCity);
    scheduleInitialWeatherLoad(initialCity);
  }

  function preserveNativeLoginTabs() {
    if (typeof window.setLoginProvider !== 'function' || window.setLoginProvider.__lfWrapped) return;
    var original = window.setLoginProvider;
    var wrapped = function (provider) {
      var shell = document.getElementById('qr-shell');
      var status = document.getElementById('qr-status');
      if (shell) shell.style.display = '';
      if (status && status.querySelector('.lf-login-placeholder')) status.innerHTML = '';
      return original.apply(this, arguments);
    };
    wrapped.__lfWrapped = true;
    window.setLoginProvider = wrapped;
  }

  function initLazyMedia() {
    function tune(root) {
      (root.querySelectorAll ? root.querySelectorAll('img') : []).forEach(function (img) {
        img.loading = 'lazy';
        img.decoding = 'async';
      });
    }
    tune(document);
    var observer = new MutationObserver(function (records) {
      records.forEach(function (record) { record.addedNodes.forEach(function (node) { if (node.nodeType === 1) tune(node); }); });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function startMusicResponse() {
    musicTimer = window.setInterval(function () {
      if (!document.body.classList.contains('lf-particle-music')) return;
      var energy = Number(window.smoothedEnergy || window.bassEnergy || 0);
      if (!energy) {
        var audio = document.querySelector('audio');
        energy = audio && !audio.paused ? (Math.sin(audio.currentTime * 4.2) + 1) * .34 : .12;
      }
      var hue = ((Date.now() / 45) + energy * 140) % 360;
      document.documentElement.style.setProperty('--lf-particle-hue', hue.toFixed(1) + 'deg');
      if (beatFollow) document.documentElement.style.setProperty('--lf-particle-brightness', String(clamp(.82 + energy * .7, .65, 1.7)));
    }, 100);
  }

  function init() {
    document.title = 'LumiField';
    document.documentElement.setAttribute('data-brand', 'lumifield');
    ensureVisualLayers();
    injectVisualControls();
    initWeather();
    preserveNativeLoginTabs();
    initLazyMedia();
    startMusicResponse();
  }

  window.__lumifieldResolveAnimatedWeather = function (code, isDay) {
    var resolved = resolveAnimatedWeather(code, isDay);
    return { kind: resolved.kind, label: resolved.label, parts: resolved.parts.slice(), isDay: resolved.isDay };
  };
  window.__lumifieldAnimatedWeatherDebug = animatedWeatherDebug;
  window.LumiFieldWeatherPerformance = Object.freeze({
    getDebug: function () {
      return {
        active: !!weatherRequest,
        activeKey: weatherRequest && weatherRequest.key || '',
        requestSerial: weatherRequestSerial,
        networkStarts: weatherPerformance.networkStarts,
        dedupedRequests: weatherPerformance.dedupedRequests,
        abortedRequests: weatherPerformance.abortedRequests,
        cacheHydrations: weatherPerformance.cacheHydrations,
        staleResults: weatherPerformance.staleResults,
        initialLoadDeferred: weatherPerformance.initialLoadDeferred,
        hasWeather: !!weatherState
      };
    },
    refresh: function (city, force) {
      weatherInitialLoadSerial += 1;
      return loadWeather(city, force !== false);
    },
    dispose: function () { cancelWeatherRequest(); return { ok: true }; }
  });
  function isAnimatedWeatherTestEnvironment() {
    if (window.LF_MASTER_TEST === true || window.LF_MASTER_TEST === '1' || window.__LF_MASTER_TEST__ === true || window.__LF_MASTER_TEST__ === '1' || window.__LF_E2E__) return true;
    if (window.navigator && window.navigator.webdriver) return true;
    if (window.location && /(?:^|[?&])(?:lfMasterTest|lfE2E)=1(?:&|$)/i.test(window.location.search || '')) return true;
    try {
      return !!(window.process && window.process.env && (String(window.process.env.LF_MASTER_TEST || '') === '1' || String(window.process.env.LUMIFIELD_E2E_TEST || '') === '1'));
    } catch (_) { return false; }
  }
  window.__lumifieldRenderAnimatedWeatherForTest = function (weather) {
    if (!isAnimatedWeatherTestEnvironment()) return { ok: false, error: 'E2E_ONLY' };
    renderWeather(weather, false);
    var result = animatedWeatherDebug();
    result.ok = true;
    return result;
  };
  window.LumiFieldAnimatedWeatherIcons = Object.freeze({
    refresh: function () { initAnimatedWeatherLifecycle(); applyAnimatedWeatherPauseState(); return animatedWeatherDebug(); },
    dispose: disposeAnimatedWeatherLifecycle,
    supportedKinds: ANIMATED_WEATHER_KINDS.slice()
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
