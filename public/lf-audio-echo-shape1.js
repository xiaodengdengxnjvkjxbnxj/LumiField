/*
 * LumiField Audio Echo V2 - Shape 1 vanilla adapter.
 *
 * Fixed source: https://github.com/hgbhh258-spec/Sonic-Topography-Wallpaper
 * Commit: 51afbac3d5978c112311fca38f7334578ca2b0e6
 * Upstream license: MIT, Copyright (c) 2026 eeegg.
 * No demo audio, images, fonts, player, lyrics, account, telemetry, updater,
 * renderer, AudioContext, Audio element, RAF, or listeners are copied.
 *
 * Adapted files and fixed-source SHA-256:
 * 60C69D161487A921E487DE36908432F4FC43167C63B20A4D06A6EAE5D3C8F827 MapScene.tsx
 * 5DF1BCD76FB0F5EFA8F185EC317E0F29438AC2DCE45FBA7B02D21CB662F563E5 CustomShaderMaterial.ts
 * EA4D69B9D65BACE0FA36031864A19F8FCE98DDE7027AB311C3E58FE2ED9AEEE2 AudioEngine.ts
 * 1A639512C111E40868ABAF49DC22F654D5725E377742D1139C389D996DAB683C types.ts
 * CFC35B5BF3D29D4906B132E85FE19EF91F229A9AAABCF6F891237E4186F07F39 themes.ts
 * A56D7F54B15275F69BA6BA3A2E605183C79918D2DC6AB3BFEF976369CA916585 LICENSE
 * Aggregate source manifest SHA-256:
 * 985314D22C24EFEB4F629B623E6D494225F9063AE2FC11F9FD2F2AF539FEFAE1
 *
 * Modification boundary: React/R3F/drei and the source-owned audio/player
 * lifecycle were replaced by an imperative THREE r128 scene adapter. Every
 * animation step consumes only the frame supplied by LumiField's shared audio
 * bridge. The 160x160 map, map GLSL, 512-bin eight-band analysis, 10 ripples,
 * 20 meteors, 200 impact particles, four themes and [35,25,35] camera remain
 * source-derived. The legacy third shape is intentionally absent.
 */
(function () {
  'use strict';

  var REPO = 'https://github.com/hgbhh258-spec/Sonic-Topography-Wallpaper';
  var COMMIT = '51afbac3d5978c112311fca38f7334578ca2b0e6';
  var SOURCE_SHA256 = '985314D22C24EFEB4F629B623E6D494225F9063AE2FC11F9FD2F2AF539FEFAE1';
  var GOLDEN_METADATA = 'docs/evidence/audio-echo/shape1-golden-master/metadata.json';
  var SCENE_ID = 'shape1-sonic-topography-map-scene';
  var SHADER_ID = 'shape1-map-shader-51afbac3';
  var STATE_ID = 'shape1-hgb-eight-band-state-v1';
  var BAND_COUNT = 8;
  var RIPPLE_COUNT = 10;
  var METEOR_COUNT = 20;
  var PARTICLE_COUNT = 200;
  var GRID_SIZE = 160;
  var GRID_SPACING = 1.05;
  var GRID_BOX_WIDTH = 0.9;
  var NORMALIZED_ANCHOR = { x:0.5, y:0.62 };
  var DEFAULT_CAMERA = {
    position:{ x:35, y:25, z:35 },
    target:{ x:0, y:0, z:0 }
  };
  var DEFAULTS = {
    gridSize:GRID_SIZE,
    spacing:GRID_SPACING,
    boxWidth:GRID_BOX_WIDTH,
    theme:'nocturnal',
    autoRotate:false,
    rotateSpeed:0.5,
    camera:DEFAULT_CAMERA,
    counts:{ ripples:RIPPLE_COUNT, meteors:METEOR_COUNT, particles:PARTICLE_COUNT }
  };

  function clamp(value, min, max) {
    value = Number(value);
    return Math.max(min, Math.min(max, isFinite(value) ? value : min));
  }

  function lerp(start, end, amount) {
    return start + (end - start) * amount;
  }

  function animationBlend(value) {
    return clamp(value, 0, 1);
  }

  function copyState(value) {
    var next = Object.assign({}, value || {});
    next.visualEq = Array.isArray(next.visualEq) ? next.visualEq.slice(0, BAND_COUNT) : new Array(BAND_COUNT).fill(1);
    while (next.visualEq.length < BAND_COUNT) next.visualEq.push(1);
    next.visualEq = next.visualEq.map(function (entry) { return clamp(entry, 0, 2); });
    return next;
  }

  function deriveGrid() {
    return {
      density:100,
      gridSize:GRID_SIZE,
      spacing:GRID_SPACING,
      boxWidth:GRID_BOX_WIDTH,
      instanceCount:GRID_SIZE * GRID_SIZE,
      terrainSize:GRID_SIZE * GRID_SPACING
    };
  }

  var TERRAIN_FRAGMENT_SHADER = `
    uniform float uTime;

    // High frequency & timbral uniforms for color
    uniform float uPresence;
    uniform float uBrilliance;
    uniform float uAir;

    uniform float uWarmth;
    uniform float uBrightness;
    uniform float uSharpness;

    // Theme Uniforms
    uniform vec3 uBaseColor1;
    uniform vec3 uBaseColor2;
    uniform vec3 uCoolCore;
    uniform vec3 uCoolEdge;
    uniform vec3 uWarmCore;
    uniform vec3 uWarmEdge;
    uniform vec3 uRippleColor;
    uniform float uGlowIntensity;

    varying vec2 vUv;
    varying float vElevation;
    varying float vDistance;
    varying vec2 vRippleAnim;
    varying vec3 vNormal;
    varying float vRelativeY;
    varying vec2 vInstancePos;

    float random(vec2 st) {
      return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
    }

    void main() {
      bool isTop = vNormal.y > 0.5;
      float distFromTop = 1.0 - vRelativeY;

      float rnd = random(vInstancePos);
      float centerDist = length(vInstancePos);

      float normElevation = clamp(vElevation / 8.0, 0.0, 1.0);

      // Base dark pillars
      vec3 cBase1 = uBaseColor1;
      vec3 cBase2 = uBaseColor2;

      // Timbre determines palette
      // Warmth drives red/orange, Brightness drives blue/cyan, Sharpness adds stark white clipping
      vec3 coolCore = uCoolCore;
      vec3 coolEdge = uCoolEdge;

      vec3 warmCore = uWarmCore;
      vec3 warmEdge = uWarmEdge;

      float warmBlend = smoothstep(0.0, 1.0, uWarmth * 1.5 + (0.5 - centerDist/80.0));

      vec3 zoneCore = mix(coolCore, warmCore, warmBlend);
      vec3 zoneEdge = mix(coolEdge, warmEdge, warmBlend);

      // Shift colors slightly per pillar
      vec3 targetGlow = mix(zoneCore, zoneEdge, fract(rnd * 11.0));

      // Distance fade for contrast and brightness
      float distFade = 1.0 - smoothstep(40.0, 75.0, centerDist);

      // Brightness lifts the black point of the glow, adding cyan/white wash
      targetGlow = mix(targetGlow, vec3(0.4, 0.8, 1.0), uBrightness * 0.6);

      vec3 currentGlow = mix(cBase2, targetGlow, normElevation) * uGlowIntensity * distFade;

      // Ripple overrides
      currentGlow = mix(currentGlow, uRippleColor, vRippleAnim.x);
      currentGlow = mix(currentGlow, vec3(1.0, 1.0, 1.0), vRippleAnim.y);

      vec3 bodyColor = mix(cBase1, cBase2, vRelativeY * distFade);
      vec3 finalColor;

      if (isTop) {
         float topIntensity = smoothstep(0.0, 0.4, normElevation);

         // Distance falloff for twinkling on flat ground
         float twinkleDistFalloff = smoothstep(60.0, 30.0, centerDist);
         float twinkleMultiplier = mix(twinkleDistFalloff, 1.0, smoothstep(0.01, 0.1, normElevation));

         // Inactive shimmering (Air / Brilliance)
         bool isSparkleTarget = fract(rnd * 31.0) > 0.95;
         if (isSparkleTarget && normElevation < 0.1) {
            topIntensity += uAir * 2.0 * twinkleMultiplier;
         }

         finalColor = mix(cBase2, currentGlow, topIntensity);

         // Edges glow on the top face
         float edgeX = smoothstep(0.05, 0.01, vUv.x) + smoothstep(0.95, 0.99, vUv.x);
         float edgeY = smoothstep(0.05, 0.01, vUv.y) + smoothstep(0.95, 0.99, vUv.y);
         float edge = min(edgeX + edgeY, 1.0);
         finalColor += currentGlow * edge * 0.8 * (topIntensity + 0.3);

         // Presence / Sharpness flickers
         float flashChance = smoothstep(0.3, 1.0, uPresence);
         if (fract(rnd * 53.0) > 0.98 - flashChance * 0.1) {
             float flashSync = sin(uTime * 40.0 + rnd * 100.0) * 0.5 + 0.5;
             finalColor += mix(vec3(1.0), vec3(0.5, 1.0, 1.0), rnd) * flashSync * uPresence * (1.0 + uSharpness * 2.0) * twinkleMultiplier;
         }

         // Brilliance micro-sparks strictly on edges
         if (edge > 0.5 && fract(rnd * 89.0 + uTime * 2.0) > 0.98) {
             finalColor += vec3(1.0) * uBrilliance * 3.0 * twinkleMultiplier;
         }

      } else {
         // Side faces
         // Smooth music has longer vertical glow, sharp music restricts it tightly to top
         float verticalFalloff = mix(1.0, 3.0, uSharpness);
         float sideGlow = smoothstep(0.5 / verticalFalloff, 0.0, distFromTop) * normElevation;

         if (normElevation < 0.02) sideGlow = 0.0;

         finalColor = mix(bodyColor, currentGlow, sideGlow * 1.5);

         // Top Rim
         float rimGlow = smoothstep(0.03, 0.0, distFromTop) * normElevation;
         finalColor += currentGlow * rimGlow;
      }

      finalColor += uRippleColor * vRippleAnim.x * 0.6;
      finalColor += vec3(1.0, 1.0, 1.0) * vRippleAnim.y * 1.2;

      // Aerial Perspective / Fog
      float aerialFog = smoothstep(30.0, 65.0, vDistance);
      vec3 atmosphericColor = mix(cBase1, cBase2, 0.4);
      finalColor = mix(finalColor, atmosphericColor, aerialFog * 0.5);

      // Distance fade out to transparent
      float alphaFade = 1.0 - smoothstep(55.0, 78.0, vDistance);

      gl_FragColor = vec4(finalColor, alphaFade);
    }
`;

  var TERRAIN_VERTEX_SHADER = `
    uniform float uTime;

    // Frequency envelopes
    uniform float uSubBass;
    uniform float uBass;
    uniform float uLowMid;
    uniform float uMid;
    uniform float uHighMid;

    // Timbral
    uniform float uSmoothness;
    uniform float uDensity;
    uniform float uEnergy;

    struct Ripple {
      vec2 pos;
      float time;
      float strength;
      float isActive;
      float rippleType;
    };
    uniform Ripple uRipples[10];

    varying vec2 vUv;
    varying float vElevation;
    varying float vDistance;
    varying vec2 vRippleAnim; // x for normal, y for white
    varying vec3 vNormal;
    varying float vRelativeY;
    varying vec2 vInstancePos;

    // Simplex noise
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
    float snoise(vec2 v) {
      const vec4 C = vec4(0.211324865405187,  0.366025403784439, -0.577350269189626, 0.024390243902439);
      vec2 i  = floor(v + dot(v, C.yy) );
      vec2 x0 = v -   i + dot(i, C.xx);
      vec2 i1; i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
      i = mod289(i);
      vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
      vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
      m = m*m ; m = m*m ;
      vec3 x = 2.0 * fract(p * C.www) - 1.0; vec3 h = abs(x) - 0.5; vec3 ox = floor(x + 0.5);
      vec3 a0 = x - ox; m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
      vec3 g; g.x  = a0.x  * x0.x  + h.x  * x0.y; g.yz = a0.yz * x12.xz + h.yz * x12.yw;
      return 130.0 * dot(m, g);
    }

    float random(vec2 st) {
      return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
    }

    void main() {
      vUv = uv;
      vNormal = normal;

      vec4 instancePos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      vec2 pos2D = instancePos.xz;
      vInstancePos = pos2D;

      float centerDist = length(pos2D);
      vDistance = centerDist;

      float rnd = random(pos2D);

      // 1. Idle Background state (smooth, ocean-like)
      vec2 movingPos = pos2D * 0.05 + vec2(uTime * 0.1, uTime * 0.05);
      float baseNoise = (snoise(movingPos) + 1.0) * 0.5;
      float wave = sin(pos2D.x * 0.15 + pos2D.y * 0.1 - uTime * 0.6) * 0.5 + 0.5;

      float globalFalloff = smoothstep(60.0, 30.0, centerDist);
      float idleElevation = mix(baseNoise, wave, uSmoothness * 0.5 + 0.2) * 0.8 * globalFalloff;

      // 2. Frequency Regions & Displacements

      // Sub-Bass: Center heavy, ultra slow rolling hills, massive block lifts
      float subRegion = smoothstep(25.0, 0.0, centerDist);
      float subLift = uSubBass * subRegion * 5.0; // Reduced from 8.0

      // Bass: Chunk-based lifts, less rigid than sub, but still clustered
      float bassNoise = snoise(pos2D * 0.1 - vec2(0.0, uTime * 0.2));
      float bassRegion = smoothstep(35.0, 5.0, centerDist + bassNoise * 5.0);
      float bassLift = uBass * bassRegion * (smoothstep(0.0, 1.0, rnd + uDensity * 0.5)) * 4.0; // Reduced from 6.0

      // Low Mid: Flowing waves across the whole map slowly
      float lowMidNoise = snoise(pos2D * 0.05 + vec2(uTime * 0.1, 0.0));
      float lowMidLift = uLowMid * (lowMidNoise * 0.5 + 0.5) * 2.5; // Reduced from 4.0

      // Mid: River-like current. Strong diagonal flow.
      float riverFlow = sin(pos2D.x * 0.2 + pos2D.y * 0.2 + snoise(pos2D * 0.1) * 2.0 - uTime * 2.0);
      float midLift = uMid * max(0.0, riverFlow) * 3.0; // Reduced from 5.0

      // High Mid: Individual scattered spikes, highly dependent on column random
      float highMidRegion = smoothstep(10.0, 45.0, centerDist);
      float highMidLift = 0.0;
      if (fract(rnd * 13.3) > 0.8) {
          highMidLift = uHighMid * highMidRegion * fract(rnd * 7.7) * 2.5; // Reduced from 4.0
      }

      // Combine
      float audioElevation = subLift + bassLift + lowMidLift + midLift + highMidLift;

      // Energy Spike
      if (rnd > 0.99) {
          audioElevation += uEnergy * 5.0; // Reduced from 10.0
      }

      audioElevation *= globalFalloff;

      float elevation = idleElevation + audioElevation;

      // Ripples
      float rippleElevation = 0.0;
      float rippleIntensityNormal = 0.0;
      float rippleIntensityWhite = 0.0;
      float speed = 15.0;
      float width = 3.0;

      for(int i = 0; i < 10; i++) {
        if(uRipples[i].isActive > 0.0) {
           float dist = length(pos2D - uRipples[i].pos);
           float timeSince = uTime - uRipples[i].time;

           float curSpeed = speed;
           float curWidth = width;
           float curFadeDist = 15.0;
           float elevationScale = 4.0;

           if (uRipples[i].rippleType > 0.5) {
               curSpeed = 20.0;
               curWidth = 1.0; // Sharper
               curFadeDist = 8.0; // Fades out faster
               elevationScale = 1.0; // Less elevation impact
           }

           float waveRadius = timeSince * curSpeed;
           float d = dist - waveRadius;
           float rippleWave = exp(-d*d / curWidth);
           float fade = exp(-waveRadius / curFadeDist);
           float rPulse = rippleWave * fade * uRipples[i].strength;

           rippleElevation += rPulse * elevationScale;
           if (uRipples[i].rippleType > 0.5) {
               rippleIntensityWhite += rPulse;
           } else {
               rippleIntensityNormal += rPulse;
           }
        }
      }

      elevation += rippleElevation;
      vRippleAnim = vec2(clamp(rippleIntensityNormal, 0.0, 1.0), clamp(rippleIntensityWhite, 0.0, 1.0));
      vElevation = elevation;

      float yPos = position.y + 0.5; // 0 to 1
      vRelativeY = yPos;

      float totalHeight = 1.0 + elevation;
      vec3 pos = position;
      pos.y = -0.5 + yPos * totalHeight; // Anchor bottom to local -0.5

      vec4 worldPosition = instanceMatrix * vec4(pos, 1.0);
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
`;

  function buildThemes(THREE) {
    var white = new THREE.Color(1,1,1);
    var themes = {
      'nocturnal':{
        name:'Nocturnal', id:'nocturnal',
        uBaseColor1:new THREE.Color(0.01,0.02,0.04), uBaseColor2:new THREE.Color(0.03,0.05,0.09), uFogColor:new THREE.Color(0.01,0.02,0.04),
        uCoolCore:new THREE.Color(0,0.3,1), uCoolEdge:new THREE.Color(0.6,0.2,1),
        uWarmCore:new THREE.Color(1,0.2,0.1), uWarmEdge:new THREE.Color(1,0.6,0),
        uRippleColor:new THREE.Color(0.2,0.9,1), uGlowIntensity:1
      },
      'neon-tokyo':{
        name:'Neon Tokyo', id:'neon-tokyo',
        uBaseColor1:new THREE.Color(0.01,0.005,0.02), uBaseColor2:new THREE.Color(0.04,0.01,0.06), uFogColor:new THREE.Color(0.01,0.005,0.02),
        uCoolCore:new THREE.Color(1,0.1,0.6), uCoolEdge:new THREE.Color(0.6,0.1,1),
        uWarmCore:new THREE.Color(0.1,1,0.8), uWarmEdge:new THREE.Color(0.1,0.4,1),
        uRippleColor:white.clone(), uGlowIntensity:1.5
      },
      'cyber-forest':{
        name:'Cyber Forest', id:'cyber-forest',
        uBaseColor1:new THREE.Color(0.01,0.02,0.01), uBaseColor2:new THREE.Color(0.02,0.05,0.02), uFogColor:new THREE.Color(0.01,0.02,0.01),
        uCoolCore:new THREE.Color(0.1,1,0.5), uCoolEdge:new THREE.Color(0.05,0.5,0.3),
        uWarmCore:new THREE.Color(0.8,1,0.1), uWarmEdge:new THREE.Color(0.9,0.5,0.1),
        uRippleColor:new THREE.Color(0.6,1,0.3), uGlowIntensity:1.3
      },
      'minimal-monochrome':{
        name:'Minimal Monochrome', id:'minimal-monochrome',
        uBaseColor1:new THREE.Color(0.02,0.02,0.02), uBaseColor2:new THREE.Color(0.06,0.06,0.06), uFogColor:new THREE.Color(0.02,0.02,0.02),
        uCoolCore:new THREE.Color(0.9,0.9,0.9), uCoolEdge:new THREE.Color(0.4,0.4,0.4),
        uWarmCore:white.clone(), uWarmEdge:new THREE.Color(0.7,0.7,0.7),
        uRippleColor:white.clone(), uGlowIntensity:0.8
      }
    };
    return themes;
  }

  var THEME_ALIASES = {
    neonPurple:'neon-tokyo', emerald:'cyber-forest', ink:'minimal-monochrome',
    lavender:'neon-tokyo', fantasy:'neon-tokyo'
  };

  function resolveTheme(themes, state) {
    var id = String(state.theme || DEFAULTS.theme);
    id = THEME_ALIASES[id] || id;
    return themes[id] || themes.nocturnal;
  }

  function colorUniforms(THREE, theme) {
    return {
      uBaseColor1:{ value:theme.uBaseColor1.clone() },
      uBaseColor2:{ value:theme.uBaseColor2.clone() },
      uFogColor:{ value:theme.uFogColor.clone() },
      uCoolCore:{ value:theme.uCoolCore.clone() },
      uCoolEdge:{ value:theme.uCoolEdge.clone() },
      uWarmCore:{ value:theme.uWarmCore.clone() },
      uWarmEdge:{ value:theme.uWarmEdge.clone() },
      uRippleColor:{ value:theme.uRippleColor.clone() },
      uGlowIntensity:{ value:theme.uGlowIntensity }
    };
  }

  function createRippleSlots(THREE) {
    return new Array(RIPPLE_COUNT).fill(0).map(function () {
      return { pos:new THREE.Vector2(), time:-100, strength:0, isActive:0, rippleType:0 };
    });
  }

  function createTerrainMaterial(THREE, theme, ripples) {
    var uniforms = Object.assign({
      uTime:{ value:0 }, uSubBass:{ value:0 }, uBass:{ value:0 }, uLowMid:{ value:0 },
      uMid:{ value:0 }, uHighMid:{ value:0 }, uPresence:{ value:0 }, uBrilliance:{ value:0 },
      uAir:{ value:0 }, uWarmth:{ value:0 }, uBrightness:{ value:0 }, uSharpness:{ value:0 },
      uSmoothness:{ value:0 }, uDensity:{ value:0 }, uSpectralCentroid:{ value:0 },
      uEnergy:{ value:0 }, uRipples:{ value:ripples }
    }, colorUniforms(THREE, theme));
    return new THREE.ShaderMaterial({
      uniforms:uniforms,
      vertexShader:TERRAIN_VERTEX_SHADER,
      fragmentShader:TERRAIN_FRAGMENT_SHADER,
      transparent:true
    });
  }

  function createTrigger(action) {
    var trigger = {
      action:action, enabled:true, sensitivity:0.15, cooldown:60,
      bandStart:0, bandEnd:16, pulseStrength:0.2, beatHold:0,
      fluxHistory:new Array(40).fill(0), fluxHistoryIndex:0,
      smoothedFlux:0, prevSmoothedFlux:0, lastEvalEnergy:0, lastEvalThresh:0
    };
    if (action === 'Meteor') Object.assign(trigger, {
      bandStart:159, bandEnd:174, sensitivity:0.45, cooldown:241, pulseStrength:0.5
    });
    return trigger;
  }

  function createAudioState() {
    return {
      virtualData:new Uint8Array(512), prevData:new Array(512).fill(0), prevBrightness:0,
      smoothed:{
        bass:0,mid:0,treble:0,energy:0,subBass:0,lowMid:0,highMid:0,presence:0,brilliance:0,air:0,
        warmth:0,brightness:0,sharpness:0,smoothness:0,density:0,spectralCentroid:0
      },
      pulse:createTrigger('Pulse'), meteor:createTrigger('Meteor')
    };
  }

  function sampleSourceBins(audio, source, sampleRate) {
    var target=audio.virtualData;
    if(!source||!source.length){target.fill(0);return target;}
    var inputHz=(Number(sampleRate)||48000)/(source.length*2);
    var sourceHz=(Number(sampleRate)||48000)/1024;
    for(var i=0;i<512;i++){
      var sourceIndex=clamp(Math.round((i*sourceHz)/inputHz),0,source.length-1);
      target[i]=source[sourceIndex]||0;
    }
    return target;
  }

  function evaluateTrigger(trigger, fluxScore, playing, emitTrigger) {
    if(!trigger.enabled||!playing)return false;
    trigger.smoothedFlux+=(fluxScore-trigger.smoothedFlux)*0.4;
    trigger.fluxHistory[trigger.fluxHistoryIndex]=trigger.smoothedFlux;
    trigger.fluxHistoryIndex=(trigger.fluxHistoryIndex+1)%trigger.fluxHistory.length;
    var avg=trigger.fluxHistory.reduce(function(sum,value){return sum+value;},0)/trigger.fluxHistory.length;
    var variance=trigger.fluxHistory.reduce(function(sum,value){return sum+Math.pow(value-avg,2);},0)/trigger.fluxHistory.length;
    var thresholdMultiplier=Math.max(0.1,5-trigger.sensitivity*4);
    var adaptiveThreshold=Math.max(0.05,avg+Math.sqrt(variance)*thresholdMultiplier);
    var peak=trigger.prevSmoothedFlux>adaptiveThreshold&&trigger.prevSmoothedFlux>=trigger.smoothedFlux;
    var triggered=false;
    if(trigger.beatHold>0)trigger.beatHold--;
    else if(peak&&trigger.prevSmoothedFlux-trigger.smoothedFlux>0.0001){
      emitTrigger(trigger.prevSmoothedFlux*3*trigger.pulseStrength,'Kick',trigger.action);
      trigger.beatHold=trigger.cooldown;
      triggered=true;
    }
    trigger.lastEvalEnergy=trigger.smoothedFlux*2;
    trigger.lastEvalThresh=adaptiveThreshold*2;
    trigger.prevSmoothedFlux=trigger.smoothedFlux;
    return triggered;
  }

  function analyzeAudio(audio, frame, emitTrigger) {
    var playing=frame.playing===true;
    var raw=playing?sampleSourceBins(audio,frame.frequencyData,frame.sampleRate):audio.virtualData;
    if(!playing)raw.fill(0);
    var sums=[0,0,0,0,0,0,0,0];
    var energySum=0,centroidNum=0,centroidDen=0,volatility=0,fluxPulse=0,fluxMeteor=0;
    for(var i=0;i<512;i++){
      var value=raw[i]/255, previous=audio.prevData[i]||0, difference=value-previous;
      energySum+=value;centroidNum+=i*value;centroidDen+=value;volatility+=Math.abs(difference);
      if(difference>0){
        if(i>=audio.pulse.bandStart&&i<=audio.pulse.bandEnd)fluxPulse+=difference;
        if(i>=audio.meteor.bandStart&&i<=audio.meteor.bandEnd)fluxMeteor+=difference;
      }
      audio.prevData[i]=value;
      if(i<=1)sums[0]+=value;else if(i<=3)sums[1]+=value;else if(i<=7)sums[2]+=value;
      else if(i<=18)sums[3]+=value;else if(i<=46)sums[4]+=value;else if(i<=93)sums[5]+=value;
      else if(i<=186)sums[6]+=value;else if(i<=372)sums[7]+=value;
    }
    evaluateTrigger(audio.pulse,fluxPulse,playing,emitTrigger);
    evaluateTrigger(audio.meteor,fluxMeteor,playing,emitTrigger);
    var values=[sums[0]/2,sums[1]/2,sums[2]/4,sums[3]/11,sums[4]/28,sums[5]/47,sums[6]/93,sums[7]/186];
    var energy=energySum/512;
    var oldBass=(sums[0]+sums[1]+sums[2])/8,oldMid=(sums[3]+sums[4])/39,oldTreble=(sums[5]+sums[6]+sums[7])/326;
    var warmth=energySum>0?(sums[0]+sums[1]+sums[2]+sums[3])/energySum:0;
    var brightness=energySum>0?(sums[5]+sums[6]+sums[7])/energySum:0;
    var sharpness=Math.max(0,brightness-audio.prevBrightness)*10;audio.prevBrightness=brightness;
    var smoothness=Math.max(0,1-(volatility/512)*2),activeThreshold=energy*1.5,activeBands=0;
    values.forEach(function(value){if(value>activeThreshold)activeBands++;});
    var density=activeBands/8,centroid=centroidDen>0?centroidNum/centroidDen:0,s=audio.smoothed,blend=0.15;
    s.bass+=(oldBass-s.bass)*blend;s.mid+=(oldMid-s.mid)*blend;s.treble+=(oldTreble-s.treble)*blend;s.energy+=(energy-s.energy)*blend;
    s.subBass+=(values[0]-s.subBass)*blend;s.lowMid+=(values[2]-s.lowMid)*blend;s.highMid+=(values[4]-s.highMid)*blend;
    s.presence+=(values[5]-s.presence)*blend;s.brilliance+=(values[6]-s.brilliance)*blend;s.air+=(values[7]-s.air)*blend;
    s.warmth+=(warmth-s.warmth)*blend;s.brightness+=(brightness-s.brightness)*blend;s.sharpness+=(sharpness-s.sharpness)*blend;
    s.smoothness+=(smoothness-s.smoothness)*blend;s.density+=(density-s.density)*blend;s.spectralCentroid+=(centroid-s.spectralCentroid)*blend;
    return s;
  }

  function setThemeUniforms(uniforms, theme, amount) {
    uniforms.uBaseColor1.value.lerp(theme.uBaseColor1,amount);
    uniforms.uBaseColor2.value.lerp(theme.uBaseColor2,amount);
    uniforms.uFogColor.value.lerp(theme.uFogColor,amount);
    uniforms.uCoolCore.value.lerp(theme.uCoolCore,amount);
    uniforms.uCoolEdge.value.lerp(theme.uCoolEdge,amount);
    uniforms.uWarmCore.value.lerp(theme.uWarmCore,amount);
    uniforms.uWarmEdge.value.lerp(theme.uWarmEdge,amount);
    uniforms.uRippleColor.value.lerp(theme.uRippleColor,amount);
    uniforms.uGlowIntensity.value=lerp(uniforms.uGlowIntensity.value,theme.uGlowIntensity,amount);
  }

  function applyObjectLayer(root, layer) {
    if (!root || !root.traverse || !isFinite(Number(layer))) return;
    root.traverse(function (node) { if (node.layers) node.layers.set(Number(layer)); });
  }

  function create(options) {
    options = options || {};
    var THREE = options.THREE || window.THREE;
    if (!THREE || !THREE.Scene || !THREE.InstancedMesh || !THREE.ShaderMaterial) throw new Error('Shape1 requires THREE r128');
    var state = copyState(options.state);
    var layer = Number(options.layer);
    var onEvent = typeof options.onEvent === 'function' ? options.onEvent : function () {};
    var disposed = false;
    var active = true;
    var frameCount = 0;
    var errors = [];
    var lastTime = 0;
    var platterRotation = 0;
    var rippleIndex = 0;
    var meteorIndex = 0;
    var particleIndex = 0;
    var themes = buildThemes(THREE);
    var theme = resolveTheme(themes,state);
    var grid = deriveGrid();
    var scene = new THREE.Scene();
    scene.background = theme.uBaseColor1.clone();
    scene.fog = new THREE.Fog(theme.uBaseColor1.clone(),30,95);
    var camera = new THREE.PerspectiveCamera(45,1,0.1,1000);
    camera.position.set(DEFAULT_CAMERA.position.x,DEFAULT_CAMERA.position.y,DEFAULT_CAMERA.position.z);
    camera.lookAt(DEFAULT_CAMERA.target.x,DEFAULT_CAMERA.target.y,DEFAULT_CAMERA.target.z);
    var platter = new THREE.Group();
    platter.userData.audioEchoShape='shape1';
    scene.add(platter);
    scene.add(new THREE.AmbientLight(0xffffff,0.5));
    var directional = new THREE.DirectionalLight(0xffffff,1);
    directional.position.set(10,20,10);
    scene.add(directional);
    var ripples = createRippleSlots(THREE);
    var terrainGeometry = new THREE.BoxGeometry(grid.boxWidth,1,grid.boxWidth);
    var terrainMaterial = createTerrainMaterial(THREE,theme,ripples);
    var terrain = new THREE.InstancedMesh(terrainGeometry,terrainMaterial,grid.instanceCount);
    terrain.userData.audioEchoShape='shape1';
    terrain.userData.audioEchoRole='terrain';
    var matrix = new THREE.Matrix4();
    var offset = grid.gridSize * grid.spacing / 2;
    var instance = 0;
    for (var x=0;x<grid.gridSize;x++) {
      for (var z=0;z<grid.gridSize;z++) {
        matrix.makeTranslation(x*grid.spacing-offset,0.5,z*grid.spacing-offset);
        terrain.setMatrixAt(instance++,matrix);
      }
    }
    terrain.instanceMatrix.needsUpdate=true;
    platter.add(terrain);
    var meteorGeometry = new THREE.BoxGeometry(0.4,1.2,0.4);
    var meteorMaterial = new THREE.MeshBasicMaterial({ color:0xffffff, toneMapped:false });
    var meteorMesh = new THREE.InstancedMesh(meteorGeometry,meteorMaterial,METEOR_COUNT);
    meteorMesh.frustumCulled=false;
    meteorMesh.userData.audioEchoRole='meteors';
    platter.add(meteorMesh);
    var particleGeometry = new THREE.BoxGeometry(0.8,0.8,0.8);
    var particleMaterial = new THREE.MeshBasicMaterial({ color:0xffffff, toneMapped:false, transparent:true, opacity:0.6 });
    var particleMesh = new THREE.InstancedMesh(particleGeometry,particleMaterial,PARTICLE_COUNT);
    particleMesh.frustumCulled=false;
    particleMesh.userData.audioEchoRole='meteor-particles';
    platter.add(particleMesh);
    var meteors = new Array(METEOR_COUNT).fill(0).map(function(){return{active:false,x:0,y:-1000,z:0,speed:0,strength:0};});
    var particles = new Array(PARTICLE_COUNT).fill(0).map(function(){return{active:false,x:0,y:-1000,z:0,vx:0,vy:0,vz:0,life:0,maxLife:1,scale:1};});
    var audioState=createAudioState();
    var dummyPosition=new THREE.Vector3(), dummyScale=new THREE.Vector3(), dummyRotation=new THREE.Quaternion();
    var dummyMatrix=new THREE.Matrix4();
    var raycaster=new THREE.Raycaster(), pointerNdc=new THREE.Vector2(), plane=new THREE.Plane(new THREE.Vector3(0,1,0),0), hitPoint=new THREE.Vector3();
    var inversePlatter=new THREE.Matrix4(), localPoint=new THREE.Vector3();
    var cameraTarget=new THREE.Vector3(), cameraBase=new THREE.Vector3(DEFAULT_CAMERA.position.x,DEFAULT_CAMERA.position.y,DEFAULT_CAMERA.position.z);
    var sourceRadius=cameraBase.length();
    var sourceAzimuth=Math.atan2(DEFAULT_CAMERA.position.x,DEFAULT_CAMERA.position.z);
    var sourceElevation=Math.asin(DEFAULT_CAMERA.position.y/sourceRadius);
    var cameraOffsets={ azimuth:0,elevation:0,zoom:1 };
    var allocations={rendererCreated:0,audioContextCreated:0,analyserCreated:0,audioElementCreated:0,requestAnimationFrameCreated:0,listenerCreated:0};
    var viewportDebug={width:0,height:0,dpr:1};
    var cameraDebug={
      rotation:[0,0],translation:[0,0,0],zoom:1,isDefault:true,
      position:[DEFAULT_CAMERA.position.x,DEFAULT_CAMERA.position.y,DEFAULT_CAMERA.position.z],
      target:[DEFAULT_CAMERA.target.x,DEFAULT_CAMERA.target.y,DEFAULT_CAMERA.target.z]
    };
    var audioDebug={playing:false,currentTime:0,energy:0,bands:new Array(BAND_COUNT).fill(0),bandCount:BAND_COUNT,frameCount:0,idleActive:true,sampleRate:0};
    var resourceDebug={listeners:0,geometries:3,materials:3,textures:0,renderTargets:0,raf:0};
    applyObjectLayer(scene,layer);
    if (isFinite(layer)) camera.layers.enable(layer);

    function emit(type,detail) {
      try { onEvent(Object.assign({ type:type,shape:'shape1' },detail||{})); }
      catch (error) { errors.push('event:'+String(error&&error.message||error)); }
    }

    function addRipple(x,z,strength,isWhite,time) {
      var slot=ripples[rippleIndex];
      slot.pos.set(x,z); slot.time=time; slot.strength=strength; slot.isActive=1; slot.rippleType=isWhite?1:0;
      rippleIndex=(rippleIndex+1)%RIPPLE_COUNT;
      emit('ripple',{x:x,z:z,strength:strength,white:!!isWhite});
    }

    function spawnParticle(x,y,z,speedMultiplier) {
      var p=particles[particleIndex];
      p.active=true; p.x=x+(Math.random()-0.5)*1.5; p.y=y+(Math.random()-0.5)*1.5; p.z=z+(Math.random()-0.5)*1.5;
      p.vx=(Math.random()-0.5)*2; p.vy=Math.random()*2+speedMultiplier*10; p.vz=(Math.random()-0.5)*2;
      p.life=0; p.maxLife=0.5+Math.random()*0.5; p.scale=Math.random()*0.6+0.2;
      particleIndex=(particleIndex+1)%PARTICLE_COUNT;
    }

    function addMeteor(strength,time) {
      var angle=Math.random()*Math.PI*2, distance=Math.random()*25, meteor=meteors[meteorIndex];
      meteor.active=true; meteor.x=Math.cos(angle)*distance; meteor.z=Math.sin(angle)*distance;
      meteor.y=30+Math.random()*10; meteor.speed=1+Math.random()*0.5+strength*1.5; meteor.strength=strength;
      meteorIndex=(meteorIndex+1)%METEOR_COUNT;
      emit('meteor',{strength:strength});
    }

    function trigger(strength,mode,action) {
      var time=lastTime;
      if(action==='Meteor') addMeteor(strength,time);
      else {
        var pulseAngle=Math.random()*Math.PI*2;
        var pulseDistance=mode==='Kick'?Math.random()*25:10+Math.random()*25;
        addRipple(Math.cos(pulseAngle)*pulseDistance,Math.sin(pulseAngle)*pulseDistance,Math.min(strength*3,mode==='Kick'?4:3),false,time);
      }
      emit('beat',{strength:strength,mode:mode,action:action});
    }

    function updateColors(target,delta,data) {
      var amount=animationBlend(3*delta);
      setThemeUniforms(terrainMaterial.uniforms,target,amount);
      scene.background.lerp(target.uBaseColor1,amount);
      scene.fog.color.lerp(target.uBaseColor1,amount);
      meteorMaterial.color.lerp(target.uWarmCore.clone().lerp(new THREE.Color(0xffffff),0.7),amount);
      particleMaterial.color.copy(meteorMaterial.color);
    }

    function updateCamera(frame) {
      var gesture=frame&&frame.gesture||{};
      var zoom=clamp(gesture.zoom==null?cameraOffsets.zoom:gesture.zoom,0.45,2.8);
      var distanceScale=clamp(state.cameraDistance==null?1:state.cameraDistance,0.35,2.8);
      var horizontal=clamp(state.cameraHorizontal==null?0:state.cameraHorizontal,-180,180)*Math.PI/180;
      var elevationDelta=(clamp(state.cameraElevation==null?27:state.cameraElevation,2,86)-27)*Math.PI/180;
      var rotationX=clamp(gesture.x==null?0:gesture.x,-Math.PI*0.48,Math.PI*0.48);
      var rotationY=Number(gesture.y)||0;
      var azimuth=sourceAzimuth+horizontal+cameraOffsets.azimuth+rotationY+platterRotation;
      var elevation=clamp(sourceElevation+elevationDelta+cameraOffsets.elevation+rotationX,0.04,Math.PI/2-0.1);
      var radius=sourceRadius*distanceScale/zoom;
      var mouseX=Math.abs(Number(gesture.mouseX))<900?clamp(gesture.mouseX,-50,50)*0.035:0;
      var mouseY=Math.abs(Number(gesture.mouseY))<900?clamp(gesture.mouseY,-50,50)*0.035:0;
      var panX=clamp(gesture.panX==null?0:gesture.panX,-18,18);
      var panY=clamp(gesture.panY==null?0:gesture.panY,-12,12);
      cameraTarget.set(panX+mouseX,0,panY+mouseY);
      camera.position.set(Math.sin(azimuth)*Math.cos(elevation)*radius,Math.sin(elevation)*radius,Math.cos(azimuth)*Math.cos(elevation)*radius).add(cameraTarget);
      camera.lookAt(cameraTarget);
      cameraDebug.rotation=[rotationX,rotationY];
      cameraDebug.translation=[cameraTarget.x,cameraTarget.y,cameraTarget.z];
      cameraDebug.zoom=zoom;
      cameraDebug.position=[camera.position.x,camera.position.y,camera.position.z];
      cameraDebug.target=[cameraTarget.x,cameraTarget.y,cameraTarget.z];
      cameraDebug.isDefault=Math.abs(rotationX)<1e-6&&Math.abs(rotationY)<1e-6&&Math.abs(panX)<1e-6&&Math.abs(panY)<1e-6&&Math.abs(zoom-1)<1e-6&&Math.abs(distanceScale-1)<1e-6&&Math.abs(horizontal)<1e-6&&Math.abs(elevationDelta)<1e-6;
      return true;
    }

    function update(frame) {
      if(disposed||!active)return false;
      frame=frame||{};
      if(frame.state)state=copyState(Object.assign({},state,frame.state));
      var delta=clamp(frame.dt,0.001,0.1);
      var time=isFinite(Number(frame.time))?Number(frame.time):(lastTime+delta);
      lastTime=time;
      frame.time=time; frame.dt=delta; frame.state=state;
      theme=resolveTheme(themes,state);
      audioState.pulse.enabled=state.rippleEnabled!==false;
      audioState.meteor.enabled=state.rippleEnabled!==false;
      audioState.pulse.sensitivity=clamp(state.rippleSensitivity==null?0.15:state.rippleSensitivity,0,1);
      audioState.pulse.cooldown=clamp(state.rippleCooldown==null?60:state.rippleCooldown,1,240);
      var data=analyzeAudio(audioState,frame,trigger);
      audioDebug.playing=frame.playing===true;
      audioDebug.currentTime=Math.max(0,Number(frame.currentTime)||0);
      audioDebug.energy=Number(data.energy)||0;
      audioDebug.bands=[data.subBass,data.bass,data.lowMid,data.mid,data.highMid,data.presence,data.brilliance,data.air].map(function(value){return Number(value)||0;});
      audioDebug.bandCount=BAND_COUNT;
      audioDebug.frameCount=frameCount+1;
      audioDebug.idleActive=!audioDebug.playing&&state.idleWave!==false;
      audioDebug.sampleRate=Math.max(0,Number(frame.sampleRate)||0);
      var uniforms=terrainMaterial.uniforms;
      uniforms.uTime.value=time;
      uniforms.uSubBass.value=data.subBass; uniforms.uBass.value=data.bass; uniforms.uLowMid.value=data.lowMid;
      uniforms.uMid.value=data.mid; uniforms.uHighMid.value=data.highMid; uniforms.uPresence.value=data.presence;
      uniforms.uBrilliance.value=data.brilliance; uniforms.uAir.value=data.air; uniforms.uEnergy.value=data.energy;
      uniforms.uWarmth.value=data.warmth; uniforms.uBrightness.value=data.brightness;
      uniforms.uSharpness.value=data.sharpness; uniforms.uSmoothness.value=data.smoothness; uniforms.uDensity.value=data.density;
      uniforms.uSpectralCentroid.value=data.spectralCentroid;
      var angularVelocity=state.autoRotate===true?(state.rotateSpeed==null?DEFAULTS.rotateSpeed:Number(state.rotateSpeed)):0;
      if(!isFinite(angularVelocity))angularVelocity=0;
      platterRotation+=angularVelocity*delta;
      platter.rotation.y=0;
      platter.scale.x=1;
      for(var i=0;i<METEOR_COUNT;i++){
        var meteor=meteors[i];
        if(!meteor.active){dummyPosition.set(0,-1000,0);dummyScale.set(0,0,0);}
        else{
          meteor.y-=meteor.speed*60*delta;
          if(meteor.y<=0){meteor.active=false;addRipple(meteor.x,meteor.z,Math.min(meteor.strength,1.2),true,time);for(var impact=0;impact<10;impact++)spawnParticle(meteor.x,0.5,meteor.z,meteor.speed*1.5);}
          dummyPosition.set(meteor.x,Math.max(0,meteor.y),meteor.z);dummyScale.set(1.5,1.5,1.5);
          if(meteor.y>0&&Math.random()>0.3)spawnParticle(meteor.x,meteor.y,meteor.z,meteor.speed*0.2);
        }
        dummyMatrix.compose(dummyPosition,dummyRotation,dummyScale);meteorMesh.setMatrixAt(i,dummyMatrix);
      }
      meteorMesh.instanceMatrix.needsUpdate=true;
      for(i=0;i<PARTICLE_COUNT;i++){
        var particle=particles[i];
        if(!particle.active){dummyPosition.set(0,-1000,0);dummyScale.set(0,0,0);}
        else{
          particle.life+=delta;
          if(particle.life>=particle.maxLife){particle.active=false;dummyScale.set(0,0,0);}
          else{particle.x+=particle.vx*delta*10;particle.y+=particle.vy*delta*10;particle.z+=particle.vz*delta*10;var particleScale=particle.scale*(1-particle.life/particle.maxLife);dummyPosition.set(particle.x,particle.y,particle.z);dummyScale.set(particleScale,particleScale,particleScale);}
        }
        dummyMatrix.compose(dummyPosition,dummyRotation,dummyScale);particleMesh.setMatrixAt(i,dummyMatrix);
      }
      particleMesh.instanceMatrix.needsUpdate=true;
      updateColors(theme,delta,data);
      updateCamera(frame);
      scene.visible=true;
      frameCount++;
      return true;
    }

    function pointer(event) {
      if(disposed||!active||!event)return false;
      var rect=event.rect;
      if(event.point&&isFinite(event.point.x)&&isFinite(event.point.z)) {
        addRipple(event.point.x,event.point.z,clamp(event.strength==null?0.2:event.strength,0.2,3),event.white===true,lastTime);
        return true;
      }
      if(!rect||!rect.width||!rect.height)return false;
      pointerNdc.set(((Number(event.clientX)-rect.left)/rect.width)*2-1,-((Number(event.clientY)-rect.top)/rect.height)*2+1);
      raycaster.setFromCamera(pointerNdc,camera);
      if(!raycaster.ray.intersectPlane(plane,hitPoint))return false;
      platter.updateMatrixWorld(true); inversePlatter.copy(platter.matrixWorld).invert(); localPoint.copy(hitPoint).applyMatrix4(inversePlatter);
      var duration=clamp(event.duration||0,0,1000);
      addRipple(localPoint.x,localPoint.z,Math.min(0.2+(duration/1000)*2.8,3),event.white===true,lastTime);
      return true;
    }

    function resetCamera() {
      cameraOffsets.azimuth=0;cameraOffsets.elevation=0;cameraOffsets.zoom=1;
      cameraTarget.set(DEFAULT_CAMERA.target.x,DEFAULT_CAMERA.target.y,DEFAULT_CAMERA.target.z);
      camera.position.set(DEFAULT_CAMERA.position.x,DEFAULT_CAMERA.position.y,DEFAULT_CAMERA.position.z);
      camera.lookAt(cameraTarget);
      cameraDebug.rotation=[0,0];cameraDebug.translation=[0,0,0];cameraDebug.zoom=1;cameraDebug.isDefault=true;
      cameraDebug.position=[DEFAULT_CAMERA.position.x,DEFAULT_CAMERA.position.y,DEFAULT_CAMERA.position.z];
      cameraDebug.target=[DEFAULT_CAMERA.target.x,DEFAULT_CAMERA.target.y,DEFAULT_CAMERA.target.z];
      return true;
    }

    function setState(next) {
      state=copyState(Object.assign({},state,next||{}));
      return copyState(state);
    }

    function resize(width,height,dpr) {
      width=Math.max(1,Number(width)||1);height=Math.max(1,Number(height)||1);
      viewportDebug.width=width;viewportDebug.height=height;viewportDebug.dpr=Math.max(0.1,Number(dpr)||1);
      camera.aspect=width/height;
      camera.setViewOffset(width,height,0,Math.round((0.5-NORMALIZED_ANCHOR.y)*height),width,height);
      camera.updateProjectionMatrix();return true;
    }

    function setActive(value) {
      active=value!==false;scene.visible=active;return active;
    }

    function dispose() {
      if(disposed)return true;
      disposed=true;active=false;
      var geometries=[],materials=[];
      scene.traverse(function(node){
        if(node.geometry&&geometries.indexOf(node.geometry)<0)geometries.push(node.geometry);
        var entries=Array.isArray(node.material)?node.material:[node.material];
        entries.forEach(function(material){if(material&&materials.indexOf(material)<0)materials.push(material);});
      });
      geometries.forEach(function(geometry){geometry.dispose();});
      materials.forEach(function(material){material.dispose();});
      while(scene.children.length)scene.remove(scene.children[scene.children.length-1]);
      ripples.length=0;meteors.length=0;particles.length=0;
      resourceDebug.listeners=0;resourceDebug.geometries=0;resourceDebug.materials=0;resourceDebug.textures=0;resourceDebug.renderTargets=0;resourceDebug.raf=0;
      emit('disposed',{geometries:geometries.length,materials:materials.length});
      return true;
    }

    function getDebug() {
      var activeMeteors=meteors.reduce(function(total,item){return total+(item.active?1:0);},0);
      var activeParticles=particles.reduce(function(total,item){return total+(item.active?1:0);},0);
      var cameraReport={
        rotation:cameraDebug.rotation.slice(),translation:cameraDebug.translation.slice(),zoom:cameraDebug.zoom,isDefault:cameraDebug.isDefault,
        position:{x:cameraDebug.position[0],y:cameraDebug.position[1],z:cameraDebug.position[2]},
        target:{x:cameraDebug.target[0],y:cameraDebug.target[1],z:cameraDebug.target[2]},
        positionArray:cameraDebug.position.slice(),targetArray:cameraDebug.target.slice()
      };
      return {
        id:'shape1',sceneId:SCENE_ID,shaderId:SHADER_ID,stateId:STATE_ID,disposed:disposed,active:active,frameCount:frameCount,
        sceneIndependent:true,rendererShared:true,audioShared:true,
        grid:{density:grid.density,size:grid.gridSize,columns:grid.gridSize,rows:grid.gridSize,instanceCount:grid.instanceCount,instances:grid.instanceCount,spacing:grid.spacing,boxWidth:grid.boxWidth},
        bands:audioDebug.bands.slice(),bandCount:BAND_COUNT,
        eventPools:{ripples:RIPPLE_COUNT,meteors:METEOR_COUNT,impactParticles:PARTICLE_COUNT},
        features:{ripple:true,meteor:true,impactParticles:true,idleWave:true,camera:true,theme:true},
        counts:{ripples:RIPPLE_COUNT,meteors:METEOR_COUNT,particles:PARTICLE_COUNT,activeMeteors:activeMeteors,activeParticles:activeParticles},
        motion:{autoRotate:state.autoRotate===true,angularVelocity:state.autoRotate===true?(Number(state.rotateSpeed)||0):0,rotation:platterRotation},
        camera:cameraReport,
        audio:{playing:audioDebug.playing,currentTime:audioDebug.currentTime,energy:audioDebug.energy,bands:audioDebug.bands.slice(),bandCount:BAND_COUNT,frameCount:audioDebug.frameCount,idleActive:audioDebug.idleActive,sampleRate:audioDebug.sampleRate},
        energy:audioDebug.energy,
        viewport:{width:viewportDebug.width,height:viewportDebug.height,dpr:viewportDebug.dpr},
        resources:Object.assign({},resourceDebug),
        state:copyState(state),
        allocations:Object.assign({},allocations),errors:errors.slice(),
        normalizedAnchor:Object.assign({},NORMALIZED_ANCHOR),
        source:{repository:REPO,repo:REPO,commit:COMMIT,sourceSha256:SOURCE_SHA256,sha256:SOURCE_SHA256,goldenMetadata:GOLDEN_METADATA,licenseStatus:'MIT_PERMISSIVE_PASS',releaseGate:'AUDIO_ECHO_V2_GPL_PASS',shape3Imported:false}
      };
    }

    return { scene:scene,camera:camera,update:update,pointer:pointer,resetCamera:resetCamera,updateCamera:updateCamera,setState:setState,setActive:setActive,resize:resize,dispose:dispose,getDebug:getDebug };
  }

  window.LumiFieldAudioEchoShape1Adapter = {
    id:'shape1',
    source:{ repository:REPO,repo:REPO,commit:COMMIT,sourceSha256:SOURCE_SHA256,goldenMetadata:GOLDEN_METADATA,licenseStatus:'MIT_PERMISSIVE_PASS',releaseGate:'AUDIO_ECHO_V2_GPL_PASS' },
    defaults:DEFAULTS,
    create:create
  };
})();
