(function (global) {
  'use strict';

  var SOURCE = Object.freeze({
    page: 'https://21st.dev/@jatin-yadav05/components/vapour-text-effect',
    registry: 'https://21st.dev/r/jatin-yadav05/vapour-text-effect',
    catalogId: 2189,
    componentId: 2060,
    author: 'jatin-yadav05',
    localSourceSha256: '3747019B49FD5AF716CFF7002F2E856A66D2449514A3DD79845BF09474D73E50',
    referenceVideoSha256: '19A0E31E965C098FC3000BDE7C7A3D0B449B4EB5E791DCE603CC79B6FB41AAE6',
    licenseStatus: 'MIT_OR_PERMISSIVE_PASS'
  });
  var activeAdapter = null;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  // Direct adaptation of the supplied component's transformValue helper.
  function transformValue(value, inputRange, outputRange, shouldClamp) {
    var inputSpan = inputRange[1] - inputRange[0];
    var outputSpan = outputRange[1] - outputRange[0];
    var result = outputRange[0] + ((value - inputRange[0]) / inputSpan) * outputSpan;
    return shouldClamp ? clamp(result, Math.min(outputRange[0], outputRange[1]), Math.max(outputRange[0], outputRange[1])) : result;
  }

  // Direct adaptation of calculateVaporizeSpread from the supplied source.
  function calculateVaporizeSpread(fontSize) {
    var size = typeof fontSize === 'string' ? parseInt(fontSize, 10) : Number(fontSize);
    var points = [
      { size: 20, spread: 0.2 },
      { size: 50, spread: 0.5 },
      { size: 100, spread: 1.5 }
    ];
    if (!isFinite(size)) size = 50;
    if (size <= points[0].size) return points[0].spread;
    if (size >= points[points.length - 1].size) return points[points.length - 1].spread;
    var i = 0;
    while (i < points.length - 1 && points[i + 1].size < size) i += 1;
    var p1 = points[i];
    var p2 = points[i + 1];
    return p1.spread + (size - p1.size) * (p2.spread - p1.spread) / (p2.size - p1.size);
  }

  function randomUnit(seed, frame, salt) {
    var value = Math.sin(seed * 12.9898 + frame * 78.233 + salt * 37.719) * 43758.5453123;
    return value - Math.floor(value);
  }

  function createStageAdapter(options) {
    options = options || {};
    var THREE = options.THREE;
    var parent = options.parent;
    if (!THREE || !parent) throw new Error('LF_VAPOUR_STAGE_DEPENDENCY_MISSING');

    var maxParticles = clamp(Math.floor(Number(options.maxParticles) || 2600), 512, 5200);
    var positions = new Float32Array(maxParticles * 3);
    var originalX = new Float32Array(maxParticles);
    var originalY = new Float32Array(maxParticles);
    var velocityX = new Float32Array(maxParticles);
    var velocityY = new Float32Array(maxParticles);
    var opacity = new Float32Array(maxParticles);
    var originalAlpha = new Float32Array(maxParticles);
    var speed = new Float32Array(maxParticles);
    var seeds = new Float32Array(maxParticles);
    var quickFade = new Uint8Array(maxParticles);
    var activated = new Uint8Array(maxParticles);
    var geometry = new THREE.BufferGeometry();
    var positionAttribute = new THREE.BufferAttribute(positions, 3);
    var opacityAttribute = new THREE.BufferAttribute(opacity, 1);
    var seedAttribute = new THREE.BufferAttribute(seeds, 1);
    if (typeof positionAttribute.setUsage === 'function' && THREE.DynamicDrawUsage != null) {
      positionAttribute.setUsage(THREE.DynamicDrawUsage);
      opacityAttribute.setUsage(THREE.DynamicDrawUsage);
    }
    geometry.setAttribute('position', positionAttribute);
    geometry.setAttribute('aOpacity', opacityAttribute);
    geometry.setAttribute('aSeed', seedAttribute);
    geometry.setDrawRange(0, 0);

    var material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0xdffcff) },
        uPointSize: { value: 1.35 },
        uPixelRatio: { value: 1 },
        uVisibility: { value: 1 }
      },
      vertexShader: [
        'attribute float aOpacity;',
        'attribute float aSeed;',
        'uniform float uPointSize;',
        'uniform float uPixelRatio;',
        'varying float vOpacity;',
        'varying float vSeed;',
        'void main(){',
        '  vOpacity = aOpacity;',
        '  vSeed = aSeed;',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  float depthScale = clamp(5.0 / max(1.0, -mv.z), 0.68, 1.85);',
        '  gl_PointSize = max(1.0, uPointSize * uPixelRatio * depthScale);',
        '  gl_Position = projectionMatrix * mv;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'precision highp float;',
        'uniform vec3 uColor;',
        'uniform float uVisibility;',
        'varying float vOpacity;',
        'varying float vSeed;',
        'void main(){',
        '  float grain = 0.90 + fract(sin(vSeed * 17.13) * 43758.5453) * 0.10;',
        '  gl_FragColor = vec4(uColor * grain, vOpacity * uVisibility);',
        '}'
      ].join('\n'),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending
    });
    var points = new THREE.Points(geometry, material);
    points.name = 'lf-stage-lyric-vapour-pool';
    points.renderOrder = 45;
    points.frustumCulled = false;
    points.visible = false;
    parent.add(points);

    var state = {
      active: false,
      disposed: false,
      requestedVisible: true,
      count: 0,
      mainParticleCount: 0,
      translationParticleCount: 0,
      elapsed: 0,
      progress: 0,
      frameCount: 0,
      startCount: 0,
      cancelCount: 0,
      minX: 0,
      maxX: 1,
      spreadWorld: 0.02,
      text: '',
      translation: '',
      lineIndex: -1,
      paused: false,
      lastReason: 'idle'
    };

    function setParticle(slot, x, y, alpha, seed) {
      var offset = slot * 3;
      positions[offset] = x;
      positions[offset + 1] = y;
      positions[offset + 2] = (randomUnit(seed, 0, 3) - 0.5) * 0.012;
      originalX[slot] = x;
      originalY[slot] = y;
      velocityX[slot] = 0;
      velocityY[slot] = 0;
      opacity[slot] = alpha;
      originalAlpha[slot] = alpha;
      speed[slot] = 0;
      seeds[slot] = seed;
      quickFade[slot] = 0;
      activated[slot] = 0;
    }

    function sampleCanvas(canvas, worldWidth, worldHeight, offsetY, budget, seedBase) {
      if (!canvas || !canvas.width || !canvas.height || budget <= 0) return 0;
      var context = canvas.getContext && canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return 0;
      var image;
      try {
        image = context.getImageData(0, 0, canvas.width, canvas.height).data;
      } catch (error) {
        return 0;
      }
      var area = canvas.width * canvas.height;
      var step = Math.max(1, Math.floor(Math.sqrt(area / Math.max(1, budget * 3.2))));
      var startSlot = state.count;
      var selected = 0;
      var seen = 0;
      for (var y = 0; y < canvas.height; y += step) {
        for (var x = 0; x < canvas.width; x += step) {
          var pixelIndex = (y * canvas.width + x) * 4;
          var alpha = image[pixelIndex + 3];
          if (alpha < 26) continue;
          seen += 1;
          var relativeSlot = selected;
          if (selected < budget) {
            selected += 1;
          } else {
            relativeSlot = Math.floor(randomUnit(seedBase + x * 0.71 + y * 1.19, seen, 11) * seen);
            if (relativeSlot >= budget) continue;
          }
          var slot = startSlot + relativeSlot;
          var worldX = (x / canvas.width - 0.5) * worldWidth;
          var worldY = (0.5 - y / canvas.height) * worldHeight + offsetY;
          var sourceAlpha = clamp(alpha / 255, 0.08, 1);
          setParticle(slot, worldX, worldY, sourceAlpha, seedBase + seen * 0.61803398875);
        }
      }
      var added = Math.min(selected, budget);
      state.count += added;
      return added;
    }

    function cancel(reason) {
      state.active = false;
      state.paused = false;
      state.progress = 0;
      state.elapsed = 0;
      state.count = 0;
      state.mainParticleCount = 0;
      state.translationParticleCount = 0;
      state.text = '';
      state.translation = '';
      state.lineIndex = -1;
      state.lastReason = String(reason || 'cancelled');
      state.cancelCount += 1;
      geometry.setDrawRange(0, 0);
      points.visible = false;
    }

    function startFromLyricMesh(group, metadata) {
      metadata = metadata || {};
      if (state.disposed || !group || !group.userData || !group.userData.lyric) return false;
      var lyric = group.userData.lyric;
      var maskCanvas = lyric.mask && lyric.mask.texture && lyric.mask.texture.image;
      if (!maskCanvas) return false;
      cancel('replaced');
      state.cancelCount -= 1;
      state.count = 0;
      var translationCanvas = lyric.translationMat && lyric.translationMat.uniforms && lyric.translationMat.uniforms.uMap && lyric.translationMat.uniforms.uMap.value && lyric.translationMat.uniforms.uMap.value.image;
      var translationBudget = translationCanvas ? Math.floor(maxParticles * 0.22) : 0;
      var mainBudget = maxParticles - translationBudget;
      state.mainParticleCount = sampleCanvas(maskCanvas, Number(lyric.worldW) || 6.1, Number(lyric.worldH) || 1.14, 0, mainBudget, 17.13 + state.startCount * 101);
      if (translationCanvas && state.count < maxParticles) {
        var translationGeometry = lyric.translationMesh && lyric.translationMesh.geometry && lyric.translationMesh.geometry.parameters;
        var translationWorldW = translationGeometry && Number(translationGeometry.width) || 5.35;
        var translationWorldH = translationGeometry && Number(translationGeometry.height) || 0.67;
        state.translationParticleCount = sampleCanvas(translationCanvas, translationWorldW, translationWorldH, Number(lyric.translationLocalY) || 0, maxParticles - state.count, 73.91 + state.startCount * 131);
      }
      if (!state.count) return false;

      points.position.copy(group.position);
      points.quaternion.copy(group.quaternion);
      points.scale.copy(group.scale);
      state.active = true;
      state.elapsed = 0;
      state.progress = 0;
      state.frameCount = 0;
      state.startCount += 1;
      state.text = String(metadata.text || '');
      state.translation = String(metadata.translation || '');
      state.lineIndex = isFinite(Number(metadata.lineIndex)) ? Number(metadata.lineIndex) : -1;
      state.minX = Infinity;
      state.maxX = -Infinity;
      for (var i = 0; i < state.count; i += 1) {
        state.minX = Math.min(state.minX, originalX[i]);
        state.maxX = Math.max(state.maxX, originalX[i]);
      }
      var fontSize = lyric.mask && Number(lyric.mask.fontSize) || 50;
      var pixelToWorld = (Number(lyric.worldW) || 6.1) / Math.max(1, maskCanvas.width);
      state.spreadWorld = calculateVaporizeSpread(fontSize) * 5 * pixelToWorld;
      state.lastReason = 'started';
      geometry.setDrawRange(0, state.count);
      positionAttribute.needsUpdate = true;
      opacityAttribute.needsUpdate = true;
      seedAttribute.needsUpdate = true;
      points.visible = state.requestedVisible;
      return true;
    }

    function update(deltaTime, frameOptions) {
      frameOptions = frameOptions || {};
      if (!state.active || state.disposed) return false;
      state.paused = !!frameOptions.paused;
      points.visible = state.requestedVisible && frameOptions.visible !== false;
      if (state.paused || !points.visible) return true;

      var delta = clamp(Number(deltaTime) || 0, 0, 0.05);
      if (delta <= 0) return true;
      state.elapsed += delta;
      state.frameCount += 1;
      var vaporizeDuration = 2;
      state.progress = clamp(state.elapsed / vaporizeDuration, 0, 1);
      var vaporizeX = state.minX + (state.maxX - state.minX) * state.progress;
      var density = transformValue(5, [0, 10], [0.3, 1], true);
      var multipliedSpread = Math.max(0.0001, state.spreadWorld);
      var allVaporized = true;

      for (var i = 0; i < state.count; i += 1) {
        if (originalX[i] <= vaporizeX) {
          if (!activated[i]) {
            var angle = randomUnit(seeds[i], state.frameCount, 1) * Math.PI * 2;
            speed[i] = (randomUnit(seeds[i], state.frameCount, 2) + 0.5) * multipliedSpread;
            velocityX[i] = Math.cos(angle) * speed[i];
            velocityY[i] = Math.sin(angle) * speed[i];
            quickFade[i] = randomUnit(seeds[i], state.frameCount, 4) > density ? 1 : 0;
            activated[i] = 1;
          }
          if (quickFade[i]) {
            opacity[i] = Math.max(0, opacity[i] - delta);
          } else {
            var offset = i * 3;
            var dx = originalX[i] - positions[offset];
            var dy = originalY[i] - positions[offset + 1];
            var distanceFromOrigin = Math.sqrt(dx * dx + dy * dy);
            var dampingFactor = Math.max(0.95, 1 - distanceFromOrigin / (100 * multipliedSpread));
            var randomSpread = multipliedSpread * 3;
            var spreadX = (randomUnit(seeds[i], state.frameCount, 5) - 0.5) * randomSpread;
            var spreadY = (randomUnit(seeds[i], state.frameCount, 6) - 0.5) * randomSpread;
            velocityX[i] = (velocityX[i] + spreadX + dx * 0.002) * dampingFactor;
            velocityY[i] = (velocityY[i] + spreadY + dy * 0.002) * dampingFactor;
            var maxVelocity = multipliedSpread * 2;
            var currentVelocity = Math.sqrt(velocityX[i] * velocityX[i] + velocityY[i] * velocityY[i]);
            if (currentVelocity > maxVelocity) {
              var velocityScale = maxVelocity / currentVelocity;
              velocityX[i] *= velocityScale;
              velocityY[i] *= velocityScale;
            }
            positions[offset] += velocityX[i] * delta * 20;
            positions[offset + 1] += velocityY[i] * delta * 10;
            opacity[i] = Math.max(0, opacity[i] - delta * 0.25);
          }
          if (opacity[i] > 0.01) allVaporized = false;
        } else {
          allVaporized = false;
        }
      }

      var color = typeof options.getColor === 'function' ? options.getColor() : null;
      if (color && material.uniforms.uColor.value && typeof material.uniforms.uColor.value.copy === 'function') {
        material.uniforms.uColor.value.copy(color);
      }
      material.uniforms.uPixelRatio.value = clamp(typeof options.getPixelRatio === 'function' ? Number(options.getPixelRatio()) || 1 : Number(global.devicePixelRatio) || 1, 1, 3);
      positionAttribute.needsUpdate = true;
      opacityAttribute.needsUpdate = true;
      if (state.progress >= 1 && allVaporized) {
        cancel('completed');
        return false;
      }
      return true;
    }

    function setVisible(visible) {
      state.requestedVisible = !!visible;
      points.visible = state.active && state.requestedVisible;
    }

    function getDebug() {
      return {
        initialized: true,
        active: state.active,
        disposed: state.disposed,
        visible: !!points.visible,
        paused: state.paused,
        count: state.count,
        mainParticleCount: state.mainParticleCount,
        translationParticleCount: state.translationParticleCount,
        budget: maxParticles,
        progress: state.progress,
        elapsed: state.elapsed,
        frameCount: state.frameCount,
        startCount: state.startCount,
        cancelCount: state.cancelCount,
        sourceText: state.text,
        sourceTranslation: state.translation,
        sourceLineIndex: state.lineIndex,
        lastReason: state.lastReason,
        direction: 'left-to-right',
        density: transformValue(5, [0, 10], [0.3, 1], true),
        spread: 5,
        vaporizeDuration: 2,
        sharedFrame: true,
        ownRafCount: 0,
        ownIntervalCount: 0,
        listenerCount: 0,
        resources: {
          points: state.disposed ? 0 : 1,
          geometries: state.disposed ? 0 : 1,
          materials: state.disposed ? 0 : 1,
          textures: 0
        },
        source: SOURCE
      };
    }

    function dispose() {
      if (state.disposed) return;
      cancel('disposed');
      state.disposed = true;
      if (points.parent) points.parent.remove(points);
      geometry.dispose();
      material.dispose();
      if (activeAdapter === api) activeAdapter = null;
    }

    var api = Object.freeze({
      startFromLyricMesh: startFromLyricMesh,
      update: update,
      cancel: cancel,
      setVisible: setVisible,
      getDebug: getDebug,
      dispose: dispose
    });
    activeAdapter = api;
    return api;
  }

  function inactiveDebug() {
    return {
      initialized: true,
      active: false,
      disposed: false,
      visible: false,
      paused: false,
      count: 0,
      budget: 2600,
      progress: 0,
      sharedFrame: true,
      ownRafCount: 0,
      ownIntervalCount: 0,
      listenerCount: 0,
      resources: { points: 0, geometries: 0, materials: 0, textures: 0 },
      source: SOURCE
    };
  }

  global.LumiFieldVapourLyrics = Object.freeze({
    version: '1.0.0',
    source: SOURCE,
    createStageAdapter: createStageAdapter,
    calculateVaporizeSpread: calculateVaporizeSpread,
    transformValue: transformValue,
    getDebug: function () { return activeAdapter ? activeAdapter.getDebug() : inactiveDebug(); }
  });
})(window);
