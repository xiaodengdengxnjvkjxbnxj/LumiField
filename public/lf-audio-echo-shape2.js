/*
 * LumiField Audio Echo V2 - Shape2 direct source adapter.
 * LicenseRef: GPL-3.0-only plus retained LumiField authorization
 * Source: https://github.com/CmzYa/sonic-topography
 * Fixed commit: cd6d9d2faee167f2dcafd2d0cbd2b4861e7e5fbc
 * Source SHA256:
 *   MapScene.tsx             7492417C27AB2D94E76DF5E738C90FDF8BA2ACA6171290EA80885F9463CE14D5
 *   CustomShaderMaterial.ts  698DA67DE5801EC26D81EB775D29A77E3BFC39DE2F2ED33FD26A4E6D38AF10DE
 *   AudioEngine.ts           C875F38F5A71B2E51015D1A5AE3901F8C00989F4801C9D50D07F55182A795AB8
 *   themes.ts                6CECF6806EEA37315E5951DD378D2EC275C9192C998F0029ECC18788FF085CEF
 * License status: CmzYa-authored contributions are GPL_NATIVE_PASS. Shape1-
 * derived portions are LUMIFIELD_AUTHORIZED + GPLV3_DOWNSTREAM_CONFIRMED under
 * Issue #25 and the project owner's 2026-08-13 attestation of the author's
 * retained WeChat confirmation.
 *
 * React/R3F, Wallpaper Engine preview/UI/media and the upstream audio source
 * allocation were intentionally excluded. The visual, shader and AudioEngine
 * mathematics below are adapted to LumiField's existing THREE renderer and
 * the real shared analyser frame supplied by LumiFieldAudioEchoManager.
 */
(function () {
  'use strict';

  var SOURCE = Object.freeze({
    repository:'https://github.com/CmzYa/sonic-topography',
    commit:'cd6d9d2faee167f2dcafd2d0cbd2b4861e7e5fbc',
    license:'GPL-3.0-only',
    upstreamDeclaredLicense:'GPL-3.0-only',
    licenseStatus:'GPL_NATIVE_PASS_AND_LUMIFIELD_AUTHORIZED_GPLV3_DOWNSTREAM_CONFIRMED',
    releaseGate:'AUDIO_ECHO_V2_GPL_PASS',
    sourceSha256:'D8BD8F35B12873A81654A171D3A203281DA4F67FD8856C3415529E6DA962AE64',
    goldenMetadata:'docs/evidence/audio-echo/shape2-golden-master/metadata.json',
    rightsNote:'CmzYa contributions are GPL-3.0-only; inherited Shape1 expression is covered by Issue #25 and the retained GPLv3 downstream confirmation attested by the project owner on 2026-08-13.',
    adaptation:'direct-source-vanilla-three-shared-lf-audio',
    excluded:Object.freeze(['react-r3f-runtime','wallpaper-preview','wallpaper-ui','wallpaper-media','audio-allocation']),
    sha256:Object.freeze({
      mapScene:'7492417C27AB2D94E76DF5E738C90FDF8BA2ACA6171290EA80885F9463CE14D5',
      shader:'698DA67DE5801EC26D81EB775D29A77E3BFC39DE2F2ED33FD26A4E6D38AF10DE',
      audioEngine:'C875F38F5A71B2E51015D1A5AE3901F8C00989F4801C9D50D07F55182A795AB8',
      themes:'6CECF6806EEA37315E5951DD378D2EC275C9192C998F0029ECC18788FF085CEF'
    })
  });

  var DEFAULTS = Object.freeze({
    theme:'nocturnal',
    cameraDistance:85,
    cameraAngleX:120,
    cameraAngleY:25,
    autoRotateEnabled:false,
    autoRotateSpeed:10,
    idleWaveEnabled:true,
    idleWaveDebounce:1,
    idleWaveFadeDuration:1,
    audioIntensity:1,
    responseRange:1,
    gridSize:160,
    meteorClickEnabled:true,
    peakColorEnabled:true,
    peakColorIntensity:1,
    pulseEnabled:true,
    pulseSensitivity:0.20,
    pulseCooldown:40,
    pulseBandStart:3,
    pulseBandEnd:16,
    pulseStrength:0.28,
    meteorEnabled:true,
    meteorSensitivity:0.35,
    meteorCooldown:150,
    meteorBandStart:150,
    meteorBandEnd:240,
    meteorStrength:0.55
  });

  var THEME_SPECS = Object.freeze({
    'nocturnal':['霁紫',[0.005,0.008,0.025],[0.015,0.025,0.07],[0.35,0.1,0.9],[0.15,0.0,0.45],[0.65,0.25,1.0],[0.5,0.1,0.8],[0.5,0.2,1.0],[1.0,0.55,0.05],1.0],
    'ocean-deep':['沧蓝',[0.002,0.008,0.028],[0.005,0.018,0.06],[0.0,0.25,1.0],[0.0,0.08,0.35],[0.15,0.55,1.0],[0.05,0.35,0.85],[0.1,0.5,1.0],[1.0,0.75,0.1],1.1],
    'arctic-aurora':['冰蓝',[0.003,0.015,0.022],[0.01,0.03,0.055],[0.0,0.75,0.85],[0.0,0.3,0.5],[0.2,1.0,0.85],[0.05,0.6,0.6],[0.1,0.9,0.9],[1.0,0.25,0.35],1.25],
    'cyber-forest':['碧翠',[0.003,0.018,0.005],[0.01,0.045,0.018],[0.0,0.85,0.35],[0.0,0.35,0.15],[0.4,1.0,0.3],[0.15,0.65,0.2],[0.3,1.0,0.4],[1.0,0.2,0.5],1.3],
    'golden-hour':['流金',[0.018,0.015,0.005],[0.045,0.035,0.012],[0.85,0.6,0.05],[0.5,0.3,0.02],[1.0,0.92,0.35],[0.85,0.7,0.15],[1.0,0.85,0.25],[0.2,0.5,1.0],1.2],
    'ember-fire':['余烬',[0.022,0.008,0.002],[0.05,0.018,0.005],[1.0,0.45,0.0],[0.6,0.15,0.0],[1.0,0.78,0.15],[0.9,0.55,0.05],[1.0,0.65,0.1],[0.1,0.4,1.0],1.5],
    'crimson-sunset':['赤焰',[0.025,0.003,0.005],[0.055,0.01,0.015],[1.0,0.05,0.08],[0.65,0.0,0.06],[1.0,0.35,0.2],[0.85,0.12,0.1],[1.0,0.15,0.1],[0.1,0.9,0.7],1.4],
    'coral-mirage':['霞粉',[0.02,0.006,0.01],[0.045,0.015,0.022],[1.0,0.25,0.3],[0.7,0.08,0.18],[1.0,0.55,0.55],[0.9,0.3,0.35],[1.0,0.4,0.4],[0.1,0.7,1.0],1.3],
    'neon-tokyo':['幻紫',[0.01,0.002,0.025],[0.03,0.008,0.065],[1.0,0.05,0.6],[0.55,0.02,0.85],[1.0,0.25,0.85],[0.8,0.1,0.7],[1.0,0.2,0.75],[0.95,1.0,0.15],1.6],
    'minimal-monochrome':['水墨',[0.012,0.012,0.012],[0.045,0.045,0.045],[0.8,0.8,0.8],[0.3,0.3,0.3],[1.0,1.0,1.0],[0.6,0.6,0.6],[1.0,1.0,1.0],[1.0,1.0,1.0],0.7],
    'teal-depth':['幽青',[0.002,0.018,0.02],[0.008,0.04,0.045],[0.0,0.55,0.55],[0.0,0.25,0.28],[0.2,0.85,0.75],[0.08,0.55,0.5],[0.15,0.8,0.7],[1.0,0.45,0.15],1.2],
    'lavender-dream':['薰衣草',[0.012,0.008,0.022],[0.03,0.02,0.055],[0.55,0.35,0.85],[0.3,0.15,0.55],[0.75,0.55,1.0],[0.5,0.3,0.75],[0.65,0.45,1.0],[1.0,0.8,0.25],1.1],
    'cherry-blossom':['樱',[0.018,0.005,0.012],[0.04,0.012,0.025],[1.0,0.55,0.65],[0.7,0.2,0.35],[1.0,0.72,0.78],[0.85,0.45,0.55],[1.0,0.6,0.7],[0.25,0.9,0.55],1.15],
    'copper-forge':['锻铜',[0.02,0.01,0.005],[0.045,0.025,0.012],[0.85,0.45,0.2],[0.5,0.22,0.08],[1.0,0.65,0.3],[0.75,0.38,0.15],[0.9,0.55,0.25],[0.3,0.65,0.35],1.3],
    'mint-fresh':['薄荷',[0.003,0.02,0.015],[0.01,0.045,0.035],[0.3,0.9,0.65],[0.1,0.45,0.3],[0.5,1.0,0.8],[0.25,0.7,0.5],[0.4,1.0,0.7],[1.0,0.3,0.55],1.2]
  });

  var THEME_IDS = Object.freeze([
    'nocturnal','ocean-deep','arctic-aurora','cyber-forest','golden-hour',
    'ember-fire','crimson-sunset','coral-mirage','neon-tokyo','minimal-monochrome',
    'teal-depth','lavender-dream','cherry-blossom','copper-forge','mint-fresh'
  ]);

  var VERTEX_SHADER = `
    uniform float uTime;
    uniform float uIdleWave;
    uniform float uAudioIntensity;
    uniform float uResponseRange;
    uniform float uHalfExtent;

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
    uniform Ripple uRipples[20];

    varying vec2 vUv;
    varying float vElevation;
    varying float vDistance;
    varying vec2 vRippleAnim; // x for normal, y for white
    varying vec3 vNormal;
    varying float vRelativeY;
    varying vec2 vInstancePos;
    varying float vPeakIntensity; // 峰值强度

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

    // Eased lift: ease-out-quad 主体 + 单峰弹跳过冲，峰值附近有明显跃动感
    float easeLift(float raw, float maxHeight) {
      float x = clamp(raw, 0.0, 1.0);
      // 主体：ease-out-quad 快速上升
      float eased = 1.0 - pow(1.0 - x, 2.0);
      // 跃动感：sin(πx) 单峰始终为正，pow(x,2) 让弹跳集中在峰值附近
      float bounce = sin(x * 3.14159) * pow(x, 2.0) * 0.35;
      return (eased + bounce) * maxHeight;
    }

    // Flow lift: quick initial response, soft peak with gentle pulsing mid-energy
    float flowLift(float raw, float maxHeight) {
      float x = clamp(raw, 0.0, 1.0);
      float eased = pow(x, 0.75);
      float breathe = sin(x * 3.14159) * 0.12;
      return (eased + breathe) * maxHeight;
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

      float range = uResponseRange;
      float globalFalloff = smoothstep(uHalfExtent * 0.71 * range, uHalfExtent * 0.36 * range, centerDist);
      float idleElevation = mix(baseNoise, wave, uSmoothness * 0.5 + 0.2) * 0.8 * globalFalloff;

      // 2. Frequency Regions & Displacements with eased animation curves

      // Sub-Bass: Center heavy, ultra slow rolling hills, massive block lifts
      float subRegion = smoothstep(uHalfExtent * 0.30 * range, 0.0, centerDist);
      float subLift = easeLift(uSubBass, 6.0) * subRegion;

      // 峰值强度：基于 subLift 高度，归一化到 0-1
      // subLift 最大值为 6.0，所以除以 6.0 归一化
      vPeakIntensity = clamp(subLift / 6.0, 0.0, 1.0);

      // Bass: Chunk-based lifts, springy feel
      float bassNoise = snoise(pos2D * 0.1 - vec2(0.0, uTime * 0.2));
      float bassRegion = smoothstep(uHalfExtent * 0.42 * range, uHalfExtent * 0.06 * range, centerDist + bassNoise * 5.0);
      float bassRnd = smoothstep(0.0, 1.0, rnd + uDensity * 0.5);
      float bassLift = easeLift(uBass, 5.0) * bassRegion * bassRnd;

      // Low Mid: Flowing waves across the whole map slowly
      float lowMidNoise = snoise(pos2D * 0.05 + vec2(uTime * 0.1, 0.0));
      float lowMidLift = flowLift(uLowMid, 3.0) * (lowMidNoise * 0.5 + 0.5);

      // Mid: River-like current. Strong diagonal flow.
      float riverFlow = sin(pos2D.x * 0.2 + pos2D.y * 0.2 + snoise(pos2D * 0.1) * 2.0 - uTime * 2.0);
      float midLift = flowLift(uMid, 4.0) * max(0.0, riverFlow);

      // High Mid: Individual scattered spikes, highly dependent on column random
      float highMidRegion = smoothstep(uHalfExtent * 0.12 * range, uHalfExtent * 0.54 * range, centerDist);
      float highMidLift = 0.0;
      if (fract(rnd * 13.3) > 0.8) {
          float hmRaw = easeLift(uHighMid, 3.0);
          highMidLift = hmRaw * highMidRegion * fract(rnd * 7.7);
      }

      // Combine and apply intensity multiplier
      float audioElevation = (subLift + bassLift + lowMidLift + midLift + highMidLift) * uAudioIntensity;

      // Energy Spike with elastic bounce
      if (rnd > 0.99) {
          float energyRaw = clamp(uEnergy, 0.0, 1.0);
          float energyBounce = 1.0 - pow(1.0 - energyRaw, 1.5);
          energyBounce += sin(energyRaw * 6.283 * 2.0) * exp(-energyRaw * 5.0) * 0.2;
          audioElevation += energyBounce * 6.0 * uAudioIntensity;
      }

      audioElevation *= globalFalloff;

      // Background ambient noise - always present as base layer
      // Smooth simplex noise for organic flowing motion
      float hillNoise = snoise(pos2D * 0.08 + vec2(uTime * 0.12, 0.0));
      float hillNoise2 = snoise(pos2D * 0.06 + vec2(0.0, uTime * 0.08));

      // Medium flowing ripples
      float rippleNoise = snoise(pos2D * 0.15 + vec2(uTime * 0.2, uTime * 0.15));

      // Fine subtle texture
      float textureNoise = snoise(pos2D * 0.4 + uTime * 0.3) * 0.3;

      // Smooth combination with gentle curves
      float baseUndulation = hillNoise * 0.6 + hillNoise2 * 0.4;
      baseUndulation = baseUndulation * 0.5 + 0.5; // Normalize to 0-1

      float rippleUndulation = rippleNoise * 0.3 + 0.5; // Softer ripple

      // Per-block subtle variation
      float blockVariation = (rnd - 0.5) * 0.15;

      // Combine with smooth blending
      float combinedWave = baseUndulation * 0.5 + rippleUndulation * 0.35 + textureNoise + blockVariation;

      // Apply gentle easing curve for softer peaks
      combinedWave = smoothstep(0.1, 0.9, combinedWave);

      // Background ambient wave - always present, scaled by uIdleWave (default 1.0)
      float idleBlockWave = combinedWave * uIdleWave * 2.5 * globalFalloff;

      float elevation = idleElevation + audioElevation + idleBlockWave;

      // Ripples
      float rippleElevation = 0.0;
      float rippleIntensityNormal = 0.0;
      float rippleIntensityWhite = 0.0;
      float speed = 14.0;        // 波纹扩散速度
      float width = 5.0;         // 波纹宽度

      for(int i = 0; i < 10; i++) {
        if(uRipples[i].isActive > 0.0) {
           float dist = length(pos2D - uRipples[i].pos);
           float timeSince = uTime - uRipples[i].time;

           float curSpeed = speed;
           float curWidth = width;
           float curFadeDist = 22.0;   // 衰减距离
           float elevationScale = 3.0; // 高度影响

           if (uRipples[i].rippleType > 0.5) {
               curSpeed = 18.0;
               curWidth = 2.5;         // 流星波纹更尖锐
               curFadeDist = 18.0;     // 衰减更慢，更明显
               elevationScale = 1.8;   // 高度影响更大
           }

           float waveRadius = timeSince * curSpeed;
           float d = dist - waveRadius;
           // Gaussian-like falloff
           float rippleWave = exp(-d*d / curWidth);
           // 衰减曲线
           float fade = exp(-waveRadius / curFadeDist);
           // 平滑强度曲线
           float strengthCurve = clamp(uRipples[i].strength * 0.4, 0.0, 1.0);
           float rPulse = rippleWave * fade * strengthCurve;

           rippleElevation += rPulse * elevationScale;
           if (uRipples[i].rippleType > 0.5) {
               rippleIntensityWhite += rPulse;
           } else {
               rippleIntensityNormal += rPulse;
           }
        }
      }

      elevation += rippleElevation;
      vRippleAnim = vec2(
        clamp(sqrt(rippleIntensityNormal), 0.0, 1.0),
        clamp(sqrt(rippleIntensityWhite), 0.0, 1.0)
      );
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

  var FRAGMENT_SHADER = `
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
    uniform vec3 uPeakColor;
    uniform float uGlowIntensity;
    uniform float uPeakEnabled; // 强调色开关
    uniform float uPeakIntensity; // 强调色强度

    varying vec2 vUv;
    varying float vElevation;
    varying float vDistance;
    varying vec2 vRippleAnim;
    varying vec3 vNormal;
    varying float vRelativeY;
    varying vec2 vInstancePos;
    varying float vPeakIntensity;

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

      // Ripple overrides - softer blend with squared intensity
      float normalBlend = vRippleAnim.x * vRippleAnim.x;
      float whiteBlend = vRippleAnim.y * vRippleAnim.y;
      currentGlow = mix(currentGlow, uRippleColor, normalBlend * 0.85);
      currentGlow = mix(currentGlow, vec3(1.0, 1.0, 1.0), whiteBlend * 0.9);

      // Peak color - 中间凸起峰值颜色
      float peakBlend = pow(vPeakIntensity, 0.85) * uPeakEnabled * uPeakIntensity;
      currentGlow = mix(currentGlow, uPeakColor, clamp(peakBlend, 0.0, 1.0) * 0.7); // 发光混合 70%

      vec3 bodyColor = mix(cBase1, cBase2, vRelativeY * distFade);
      vec3 finalColor;

      if (isTop) {
         float topIntensity = smoothstep(0.0, 0.4, normElevation);

         // 峰值颜色额外增强顶面
         topIntensity += clamp(peakBlend * 0.4, 0.0, 1.0);

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

         // Presence / Sharpness flickers - slower, more deliberate flashes
         float flashChance = smoothstep(0.5, 1.0, uPresence);
         if (fract(rnd * 53.0) > 0.985 - flashChance * 0.05) {
             // Slower pulse: ~8Hz instead of 40Hz for less strobe-like effect
             float flashSync = sin(uTime * 8.0 + rnd * 50.0) * 0.5 + 0.5;
             finalColor += mix(vec3(1.0), vec3(0.5, 1.0, 1.0), rnd) * flashSync * uPresence * (1.0 + uSharpness * 1.5) * twinkleMultiplier;
         }

         // Brilliance micro-sparks strictly on edges - much rarer and slower
         float brilliancePhase = sin(uTime * 1.5 + rnd * 30.0) * 0.5 + 0.5; // Slow breathing phase
         if (edge > 0.6 && fract(rnd * 89.0) > 0.992 && brilliancePhase > 0.7) {
             finalColor += vec3(1.0) * uBrilliance * 2.0 * twinkleMultiplier * brilliancePhase;
         }

      } else {
         // Side faces
         // Smooth music has longer vertical glow, sharp music restricts it tightly to top
         float verticalFalloff = mix(1.0, 3.0, uSharpness);
         float sideGlow = smoothstep(0.5 / verticalFalloff, 0.0, distFromTop) * normElevation;

         if (normElevation < 0.02) sideGlow = 0.0;

         // 峰值颜色影响侧面
         vec3 sideGlowColor = mix(currentGlow, uPeakColor, clamp(peakBlend * 0.4, 0.0, 1.0));
         finalColor = mix(bodyColor, sideGlowColor, sideGlow * 1.5);

         // Top Rim
         float rimGlow = smoothstep(0.03, 0.0, distFromTop) * normElevation;
         finalColor += mix(currentGlow, uPeakColor, clamp(peakBlend * 0.35, 0.0, 1.0)) * rimGlow;
      }

      // 峰值颜色全局叠加
      finalColor = mix(finalColor, uPeakColor, clamp(peakBlend * 0.15, 0.0, 1.0));

      finalColor += uRippleColor * normalBlend * 0.4;
      finalColor += vec3(1.0, 1.0, 1.0) * whiteBlend * 0.7;

      // Aerial Perspective / Fog
      float aerialFog = smoothstep(30.0, 65.0, vDistance);
      vec3 atmosphericColor = mix(cBase1, cBase2, 0.4);
      finalColor = mix(finalColor, atmosphericColor, aerialFog * 0.5);

      // Distance fade out to transparent
      float alphaFade = 1.0 - smoothstep(55.0, 78.0, vDistance);

      gl_FragColor = vec4(finalColor, alphaFade);
    }
  `;

  var instanceSerial = 0;

  function finite(value, fallback) {
    value = Number(value);
    return isFinite(value) ? value : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, finite(value, min)));
  }

  function cloneDefaults() {
    var value = {};
    Object.keys(DEFAULTS).forEach(function (key) { value[key] = DEFAULTS[key]; });
    return value;
  }

  function colorFrom(THREE, value, fallback) {
    if (value && value.isColor) return value.clone();
    if (Array.isArray(value) && value.length >= 3) return new THREE.Color(finite(value[0],0), finite(value[1],0), finite(value[2],0));
    try { return new THREE.Color(value == null ? fallback : value); } catch (_) { return new THREE.Color(fallback); }
  }

  function createThemes(THREE) {
    var result = {};
    Object.keys(THEME_SPECS).forEach(function (id) {
      var value = THEME_SPECS[id];
      result[id] = {
        name:value[0], id:id,
        uBaseColor1:colorFrom(THREE,value[1],0x010206),
        uBaseColor2:colorFrom(THREE,value[2],0x03050e),
        uCoolCore:colorFrom(THREE,value[3],0x004cff),
        uCoolEdge:colorFrom(THREE,value[4],0x9933ff),
        uWarmCore:colorFrom(THREE,value[5],0xff3319),
        uWarmEdge:colorFrom(THREE,value[6],0xff9900),
        uRippleColor:colorFrom(THREE,value[7],0x33e5ff),
        uPeakColor:colorFrom(THREE,value[8],0xffffff),
        uGlowIntensity:value[9]
      };
    });
    return result;
  }

  function resolveThemeName(value) {
    var aliases = {
      neonPurple:'nocturnal', neonBlue:'ocean-deep', oceanBlue:'ocean-deep',
      aurora:'arctic-aurora', cyberForest:'cyber-forest', gold:'golden-hour',
      ember:'ember-fire', crimson:'crimson-sunset', coral:'coral-mirage',
      neonTokyo:'neon-tokyo', monochrome:'minimal-monochrome', ink:'minimal-monochrome',
      teal:'teal-depth', lavender:'lavender-dream', cherry:'cherry-blossom',
      copper:'copper-forge', mint:'mint-fresh'
    };
    value = String(value || DEFAULTS.theme);
    return Object.prototype.hasOwnProperty.call(THEME_SPECS, value) ? value : (aliases[value] || DEFAULTS.theme);
  }

  function create(options) {
    options = options || {};
    var THREE = options.THREE;
    if (!THREE || !THREE.Scene || !THREE.ShaderMaterial || !THREE.InstancedMesh) {
      throw new Error('Shape2 requires the shared LumiField THREE runtime');
    }

    var serial = ++instanceSerial;
    var layer = Math.max(0, Math.min(31, Math.round(finite(options.layer, 0))));
    var onEvent = typeof options.onEvent === 'function' ? options.onEvent : function () {};
    var rawState = Object.assign({}, options.state || {});
    var runtimeState = cloneDefaults();
    var themes = createThemes(THREE);
    var disposed = false;
    var active = true;
    var sourceTime = 0;
    var timeOrigin = null;
    var frameCount = 0;
    var sampleRate = 48000;
    var lastPlaying = false;
    var currentTrackTime = 0;
    var lastGesture = { x:0, y:0, panX:0, panY:0, zoom:1, mouseX:0, mouseY:0 };
    var pointerFollowOrigin = { x:0, y:0 };
    var viewport = { width:1, height:1, dpr:1 };

    function boolFrom(primary, secondary, fallback) {
      if (rawState[primary] != null) return rawState[primary] === true;
      if (secondary && rawState[secondary] != null) return rawState[secondary] === true;
      return fallback;
    }

    function numberFrom(primary, secondary, fallback) {
      if (rawState[primary] != null) return finite(rawState[primary], fallback);
      if (secondary && rawState[secondary] != null) return finite(rawState[secondary], fallback);
      return fallback;
    }

    function normalizedDistance() {
      var distance = numberFrom('cameraDistance', null, DEFAULTS.cameraDistance);
      return clamp(distance <= 4 ? DEFAULTS.cameraDistance * distance : distance, 5, 240);
    }

    function normalizedRotateSpeed() {
      if (rawState.autoRotateSpeed != null) return clamp(rawState.autoRotateSpeed, -180, 180);
      if (rawState.rotateSpeed != null) {
        var value = finite(rawState.rotateSpeed, DEFAULTS.autoRotateSpeed);
        return clamp(Math.abs(value) <= 2 ? value * 180 / Math.PI : value, -180, 180);
      }
      return DEFAULTS.autoRotateSpeed;
    }

    var autoRotateAngle = DEFAULTS.cameraAngleX;

    function syncRuntimeState(resetAuto) {
      var previousAngle = runtimeState.cameraAngleX;
      var previousAuto = runtimeState.autoRotateEnabled;
      runtimeState.theme = rawState.theme == null ? DEFAULTS.theme : rawState.theme;
      runtimeState.cameraDistance = normalizedDistance();
      runtimeState.cameraAngleX = clamp(
        rawState.cameraAngleX != null
          ? rawState.cameraAngleX
          : DEFAULTS.cameraAngleX + numberFrom('cameraHorizontal', null, 0),
        -1080, 1080
      );
      runtimeState.cameraAngleY = clamp(numberFrom('cameraAngleY', 'cameraElevation', DEFAULTS.cameraAngleY), -85, 85);
      runtimeState.autoRotateEnabled = boolFrom('autoRotateEnabled', 'autoRotate', DEFAULTS.autoRotateEnabled);
      runtimeState.autoRotateSpeed = normalizedRotateSpeed();
      runtimeState.idleWaveEnabled = boolFrom('idleWaveEnabled', 'idleWave', DEFAULTS.idleWaveEnabled);
      runtimeState.idleWaveDebounce = clamp(numberFrom('idleWaveDebounce', 'idleDebounce', DEFAULTS.idleWaveDebounce), 0, 30);
      runtimeState.idleWaveFadeDuration = clamp(numberFrom('idleWaveFadeDuration', 'idleFade', DEFAULTS.idleWaveFadeDuration), 0.01, 30);
      runtimeState.audioIntensity = clamp(numberFrom('audioIntensity', 'responseStrength', DEFAULTS.audioIntensity), 0, 4);
      runtimeState.responseRange = clamp(numberFrom('responseRange', null, DEFAULTS.responseRange), 0.1, 3);
      runtimeState.gridSize = 160;
      runtimeState.meteorClickEnabled = boolFrom('meteorClickEnabled', null, DEFAULTS.meteorClickEnabled);
      runtimeState.peakColorEnabled = boolFrom('peakColorEnabled', 'accentEnabled', DEFAULTS.peakColorEnabled);
      runtimeState.peakColorIntensity = clamp(numberFrom('peakColorIntensity', 'accentStrength', DEFAULTS.peakColorIntensity), 0, 2);
      runtimeState.pulseEnabled = boolFrom('pulseEnabled', 'rippleEnabled', DEFAULTS.pulseEnabled);
      runtimeState.pulseSensitivity = clamp(numberFrom('pulseSensitivity', 'rippleSensitivity', DEFAULTS.pulseSensitivity), 0, 1.5);
      runtimeState.pulseCooldown = clamp(numberFrom('pulseCooldown', 'rippleCooldown', DEFAULTS.pulseCooldown), 0, 600);
      runtimeState.pulseBandStart = clamp(numberFrom('pulseBandStart', null, DEFAULTS.pulseBandStart), 0, 511) | 0;
      runtimeState.pulseBandEnd = clamp(numberFrom('pulseBandEnd', null, DEFAULTS.pulseBandEnd), runtimeState.pulseBandStart, 511) | 0;
      runtimeState.pulseStrength = clamp(numberFrom('pulseStrength', null, DEFAULTS.pulseStrength), 0, 4);
      runtimeState.meteorEnabled = boolFrom('meteorEnabled', null, DEFAULTS.meteorEnabled);
      runtimeState.meteorSensitivity = clamp(numberFrom('meteorSensitivity', null, DEFAULTS.meteorSensitivity), 0, 1.5);
      runtimeState.meteorCooldown = clamp(numberFrom('meteorCooldown', null, DEFAULTS.meteorCooldown), 0, 1200);
      runtimeState.meteorBandStart = clamp(numberFrom('meteorBandStart', null, DEFAULTS.meteorBandStart), 0, 511) | 0;
      runtimeState.meteorBandEnd = clamp(numberFrom('meteorBandEnd', null, DEFAULTS.meteorBandEnd), runtimeState.meteorBandStart, 511) | 0;
      runtimeState.meteorStrength = clamp(numberFrom('meteorStrength', null, DEFAULTS.meteorStrength), 0, 4);
      if (resetAuto || previousAngle !== runtimeState.cameraAngleX || (!previousAuto && runtimeState.autoRotateEnabled)) {
        autoRotateAngle = runtimeState.cameraAngleX;
      }
    }

    syncRuntimeState(true);

    function themeFromInput(value) {
      if (!value || typeof value !== 'object' || value.isColor) return themes[resolveThemeName(value)] || themes.nocturnal;
      var fallback = themes.nocturnal;
      return {
        name:String(value.name || fallback.name),
        id:String(value.id || 'mixed'),
        uBaseColor1:colorFrom(THREE,value.uBaseColor1,fallback.uBaseColor1),
        uBaseColor2:colorFrom(THREE,value.uBaseColor2,fallback.uBaseColor2),
        uCoolCore:colorFrom(THREE,value.uCoolCore,fallback.uCoolCore),
        uCoolEdge:colorFrom(THREE,value.uCoolEdge,fallback.uCoolEdge),
        uWarmCore:colorFrom(THREE,value.uWarmCore,fallback.uWarmCore),
        uWarmEdge:colorFrom(THREE,value.uWarmEdge,fallback.uWarmEdge),
        uRippleColor:colorFrom(THREE,value.uRippleColor,fallback.uRippleColor),
        uPeakColor:colorFrom(THREE,value.uPeakColor,fallback.uPeakColor),
        uGlowIntensity:finite(value.uGlowIntensity,fallback.uGlowIntensity)
      };
    }

    var scene = new THREE.Scene();
    scene.name = 'LumiFieldAudioEchoShape2Scene';
    scene.userData.lumiFieldAudioEchoShape = 'shape2';
    scene.userData.sourceCommit = SOURCE.commit;
    var initialTheme = themeFromInput(runtimeState.theme);
    scene.background = initialTheme.uBaseColor1.clone();
    scene.fog = new THREE.Fog(initialTheme.uBaseColor1.clone(), 30, 95);

    var camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.name = 'LumiFieldAudioEchoShape2Camera';
    camera.layers.set(layer);
    scene.add(camera);

    var ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    ambientLight.name = 'Shape2AmbientLight';
    ambientLight.layers.set(layer);
    scene.add(ambientLight);
    var directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.name = 'Shape2DirectionalLight';
    directionalLight.position.set(10, 20, 10);
    directionalLight.layers.set(layer);
    scene.add(directionalLight);

    var GRID_SIZE = 160;
    var TOTAL_RANGE = 168;
    var SPACING = TOTAL_RANGE / GRID_SIZE;
    var PILLAR_WIDTH = SPACING * 0.857;
    var GRID_COUNT = GRID_SIZE * GRID_SIZE;
    var HALF_EXTENT = TOTAL_RANGE / 2;
    var RIPPLE_CAPACITY = 20;
    var SHADER_RIPPLE_LOOP = 10;
    var MAX_METEORS = 40;
    var MAX_PARTICLES = 200;

    var ripples = new Array(RIPPLE_CAPACITY);
    for (var ri = 0; ri < RIPPLE_CAPACITY; ri++) {
      ripples[ri] = { pos:new THREE.Vector2(), time:-100, strength:0, isActive:0, rippleType:0 };
    }
    var rippleIndex = 0;

    var uniforms = {
      uTime:{ value:0 },
      uSubBass:{ value:0 }, uBass:{ value:0 }, uLowMid:{ value:0 }, uMid:{ value:0 }, uHighMid:{ value:0 },
      uPresence:{ value:0 }, uBrilliance:{ value:0 }, uAir:{ value:0 },
      uWarmth:{ value:0 }, uBrightness:{ value:0 }, uSharpness:{ value:0 }, uSmoothness:{ value:0 },
      uDensity:{ value:0 }, uSpectralCentroid:{ value:0 }, uEnergy:{ value:0 },
      uIdleWave:{ value:0 }, uAudioIntensity:{ value:1 }, uResponseRange:{ value:1 }, uHalfExtent:{ value:84 },
      uRipples:{ value:ripples },
      uBaseColor1:{ value:new THREE.Color(0.01,0.02,0.04) },
      uBaseColor2:{ value:new THREE.Color(0.03,0.05,0.09) },
      uCoolCore:{ value:new THREE.Color(0.0,0.3,1.0) },
      uCoolEdge:{ value:new THREE.Color(0.6,0.2,1.0) },
      uWarmCore:{ value:new THREE.Color(1.0,0.2,0.1) },
      uWarmEdge:{ value:new THREE.Color(1.0,0.6,0.0) },
      uRippleColor:{ value:new THREE.Color(0.2,0.9,1.0) },
      uPeakColor:{ value:new THREE.Color(1.0,1.0,1.0) },
      uGlowIntensity:{ value:1.0 }, uPeakEnabled:{ value:1.0 }, uPeakIntensity:{ value:1.0 }
    };

    var mapGeometry = new THREE.BoxGeometry(PILLAR_WIDTH, 1, PILLAR_WIDTH);
    var mapMaterial = new THREE.ShaderMaterial({
      uniforms:uniforms,
      vertexShader:VERTEX_SHADER,
      fragmentShader:FRAGMENT_SHADER,
      transparent:true,
      depthWrite:true
    });
    mapMaterial.name = 'LumiFieldShape2MapShaderMaterial';
    var mapMesh = new THREE.InstancedMesh(mapGeometry, mapMaterial, GRID_COUNT);
    mapMesh.name = 'LumiFieldShape2Terrain';
    mapMesh.layers.set(layer);
    var matrix = new THREE.Matrix4();
    var offset = (GRID_SIZE * SPACING) / 2;
    var matrixIndex = 0;
    for (var gx = 0; gx < GRID_SIZE; gx++) {
      for (var gz = 0; gz < GRID_SIZE; gz++) {
        matrix.makeTranslation(gx * SPACING - offset, 0.5, gz * SPACING - offset);
        mapMesh.setMatrixAt(matrixIndex++, matrix);
      }
    }
    mapMesh.instanceMatrix.needsUpdate = true;
    scene.add(mapMesh);

    var meteorGeometry = new THREE.BoxGeometry(0.4, 1.2, 0.4);
    var meteorMaterial = new THREE.MeshBasicMaterial({ color:0xffffff, toneMapped:false });
    meteorMaterial.name = 'LumiFieldShape2MeteorMaterial';
    var meteorMesh = new THREE.InstancedMesh(meteorGeometry, meteorMaterial, MAX_METEORS);
    meteorMesh.name = 'LumiFieldShape2Meteors';
    meteorMesh.layers.set(layer);
    meteorMesh.frustumCulled = false;
    scene.add(meteorMesh);

    var particleGeometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    var particleMaterial = new THREE.MeshBasicMaterial({ color:0xffffff, toneMapped:false, transparent:true, opacity:0.6 });
    particleMaterial.name = 'LumiFieldShape2ParticleMaterial';
    var particleMesh = new THREE.InstancedMesh(particleGeometry, particleMaterial, MAX_PARTICLES);
    particleMesh.name = 'LumiFieldShape2ImpactParticles';
    particleMesh.layers.set(layer);
    particleMesh.frustumCulled = false;
    scene.add(particleMesh);

    var meteors = new Array(MAX_METEORS);
    var particles = new Array(MAX_PARTICLES);
    var mi;
    for (mi = 0; mi < MAX_METEORS; mi++) {
      meteors[mi] = { active:false, x:0, y:-1000, z:0, speed:0, strength:0 };
    }
    for (mi = 0; mi < MAX_PARTICLES; mi++) {
      particles[mi] = { active:false, x:0, y:-1000, z:0, vx:0, vy:0, vz:0, life:0, maxLife:1, scale:1 };
    }
    var meteorIndex = 0;
    var particleIndex = 0;
    var lastMeteorSpawnTime = -Infinity;
    var lastClickMeteorTime = -Infinity;
    var pulseAnchor = { x:0, z:0, initialized:false, lastTriggerTime:0, hitsRemaining:0 };
    var PULSE_ANCHOR_EXPIRE_MS = 1500;

    var dummyMatrix = new THREE.Matrix4();
    var dummyPosition = new THREE.Vector3();
    var dummyRotation = new THREE.Quaternion();
    var dummyScale = new THREE.Vector3();
    var tempColor = new THREE.Color();
    var whiteColor = new THREE.Color(0xffffff);
    var raycaster = new THREE.Raycaster();
    var pointerNdc = new THREE.Vector2();
    var groundPlane = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
    var intersectionPoint = new THREE.Vector3();

    function hidePools() {
      for (var i = 0; i < MAX_METEORS; i++) {
        dummyPosition.set(0,-1000,0); dummyScale.set(0,0,0);
        dummyMatrix.compose(dummyPosition,dummyRotation,dummyScale);
        meteorMesh.setMatrixAt(i,dummyMatrix);
      }
      meteorMesh.instanceMatrix.needsUpdate = true;
      for (var p = 0; p < MAX_PARTICLES; p++) {
        dummyPosition.set(0,-1000,0); dummyScale.set(0,0,0);
        dummyMatrix.compose(dummyPosition,dummyRotation,dummyScale);
        particleMesh.setMatrixAt(p,dummyMatrix);
      }
      particleMesh.instanceMatrix.needsUpdate = true;
    }
    hidePools();

    function triggerConfig(action) {
      var pulse = action === 'Pulse';
      return {
        action:action,
        enabled:true,
        mode:'Auto Beat',
        freqIndex:-1,
        threshold:0.5,
        sensitivity:pulse ? 0.20 : 0.35,
        cooldown:pulse ? 40 : 150,
        bandStart:pulse ? 3 : 150,
        bandEnd:pulse ? 16 : 240,
        pulseStrength:pulse ? 0.28 : 0.55,
        currentCooldown:0,
        beatHold:0,
        lastEvalEnergy:0,
        lastEvalThresh:0,
        fluxHistory:new Float32Array(40),
        fluxHistoryIndex:0,
        smoothedFlux:0,
        prevSmoothedFlux:0
      };
    }

    var pulseTrigger = triggerConfig('Pulse');
    var meteorTrigger = triggerConfig('Meteor');

    function syncTriggerState() {
      pulseTrigger.enabled = runtimeState.pulseEnabled;
      pulseTrigger.sensitivity = runtimeState.pulseSensitivity;
      pulseTrigger.cooldown = runtimeState.pulseCooldown;
      pulseTrigger.bandStart = runtimeState.pulseBandStart;
      pulseTrigger.bandEnd = runtimeState.pulseBandEnd;
      pulseTrigger.pulseStrength = runtimeState.pulseStrength;
      meteorTrigger.enabled = runtimeState.meteorEnabled;
      meteorTrigger.sensitivity = runtimeState.meteorSensitivity;
      meteorTrigger.cooldown = runtimeState.meteorCooldown;
      meteorTrigger.bandStart = runtimeState.meteorBandStart;
      meteorTrigger.bandEnd = runtimeState.meteorBandEnd;
      meteorTrigger.pulseStrength = runtimeState.meteorStrength;
    }
    syncTriggerState();

    var frequencyBins = new Float32Array(512);
    var prevData = new Float32Array(512);
    var prevBrightness = 0;
    var audioReceived = false;
    var lastActiveTime = 0;
    var lastIdleTime = 0;
    var idleStartTime = 0;
    var currentIdleIntensity = 0;
    var smoothedData = {
      bass:0, mid:0, treble:0, energy:0,
      subBass:0, lowMid:0, highMid:0, presence:0, brilliance:0, air:0,
      warmth:0, brightness:0, sharpness:0, smoothness:0, density:0, spectralCentroid:0
    };

    function emit(type, detail) {
      try { onEvent(Object.assign({ type:type, shape:'shape2', time:sourceTime }, detail || {})); } catch (_) {}
    }

    function addRipple(x, z, strength, isWhite) {
      var slot = ripples[rippleIndex];
      slot.pos.set(x, z);
      slot.time = sourceTime;
      slot.strength = strength;
      slot.isActive = 1;
      slot.rippleType = isWhite ? 1 : 0;
      rippleIndex = (rippleIndex + 1) % RIPPLE_CAPACITY;
      emit('ripple', { x:x, z:z, strength:strength, meteor:isWhite === true });
    }

    function spawnParticle(x, y, z, speedMultiplier) {
      var p = particles[particleIndex];
      p.active = true;
      p.x = x + (Math.random() - 0.5) * 1.5;
      p.y = y + (Math.random() - 0.5) * 1.5;
      p.z = z + (Math.random() - 0.5) * 1.5;
      p.vx = (Math.random() - 0.5) * 2.0;
      p.vy = Math.random() * 2.0 + speedMultiplier * 10.0;
      p.vz = (Math.random() - 0.5) * 2.0;
      p.life = 0;
      p.maxLife = 0.5 + Math.random() * 0.5;
      p.scale = Math.random() * 0.6 + 0.2;
      particleIndex = (particleIndex + 1) % MAX_PARTICLES;
    }

    function addMeteor(strength, x, z, bypassCooldown) {
      var cooldownSeconds = meteorTrigger.cooldown / 60;
      if (!bypassCooldown && sourceTime - lastMeteorSpawnTime < cooldownSeconds) return false;
      lastMeteorSpawnTime = sourceTime;
      var angle = Math.random() * Math.PI * 2;
      var dist = 10 + Math.random() * 35;
      var m = meteors[meteorIndex];
      m.active = true;
      m.x = isFinite(x) ? x : Math.cos(angle) * dist;
      m.z = isFinite(z) ? z : Math.sin(angle) * dist;
      m.y = 30 + Math.random() * 10;
      m.speed = 1.0 + Math.random() * 0.5 + strength * 2.5;
      m.strength = strength;
      meteorIndex = (meteorIndex + 1) % MAX_METEORS;
      emit('meteor', { x:m.x, z:m.z, strength:strength, click:bypassCooldown === true });
      return true;
    }

    function handleFrequencyTrigger(strength, mode, action) {
      if (action === 'Meteor') {
        addMeteor(Math.min(strength * 20, 4.0));
        return;
      }
      var nowMs = sourceTime * 1000;
      if (!pulseAnchor.initialized || nowMs - pulseAnchor.lastTriggerTime > PULSE_ANCHOR_EXPIRE_MS || pulseAnchor.hitsRemaining <= 0) {
        pulseAnchor.x = (Math.random() - 0.5) * 50;
        pulseAnchor.z = (Math.random() - 0.5) * 50;
        pulseAnchor.hitsRemaining = 5 + Math.floor(Math.random() * 9);
        pulseAnchor.initialized = true;
      }
      pulseAnchor.hitsRemaining--;
      pulseAnchor.lastTriggerTime = nowMs;
      var rx, rz;
      if (mode === 'Kick') {
        rx = pulseAnchor.x + (Math.random() - 0.5) * 8;
        rz = pulseAnchor.z + (Math.random() - 0.5) * 8;
      } else {
        var angle = Math.random() * Math.PI * 2;
        var dist = 15 + Math.random() * 45;
        rx = Math.cos(angle) * dist;
        rz = Math.sin(angle) * dist;
      }
      addRipple(rx, rz, Math.min(strength * 40, 8.0), false);
    }

    function evaluateTrigger(config, fluxScore, deltaTime) {
      if (!config.enabled) return;
      var eVal = 0;
      var triggered = false;
      var startBin = config.mode === 'Auto Beat' ? config.bandStart : Math.max(0, (config.freqIndex >= 0 ? config.freqIndex : Math.floor(0.2 * 512)) - 2);
      var endBin = config.mode === 'Auto Beat' ? config.bandEnd : Math.min(511, (config.freqIndex >= 0 ? config.freqIndex : Math.floor(0.2 * 512)) + 2);

      if (config.mode === 'Advanced') {
        if (config.freqIndex >= 0 && config.freqIndex < 512) {
          var sum = 0;
          var count = 0;
          for (var k = startBin; k <= endBin; k++) { sum += frequencyBins[k] || 0; count++; }
          eVal = sum / count;
          config.lastEvalThresh = config.threshold;
          if (config.currentCooldown <= 0 && eVal > config.threshold) triggered = true;
        }
        config.lastEvalEnergy = eVal;
        if (triggered) {
          handleFrequencyTrigger(eVal, 'Advanced', config.action);
          config.currentCooldown = 60;
        }
      }

      if (config.currentCooldown > 0) config.currentCooldown -= deltaTime * 60;
      if (config.currentCooldown < 0) config.currentCooldown = 0;

      if (config.mode === 'Auto Beat') {
        var fluxSmoothDt = 1 - Math.pow(1 - 0.4, deltaTime * 60);
        config.smoothedFlux += (fluxScore - config.smoothedFlux) * fluxSmoothDt;
        config.fluxHistory[config.fluxHistoryIndex] = config.smoothedFlux;
        config.fluxHistoryIndex = (config.fluxHistoryIndex + 1) % config.fluxHistory.length;
        var avgFlux = 0;
        var fluxVariance = 0;
        for (var i = 0; i < config.fluxHistory.length; i++) avgFlux += config.fluxHistory[i];
        avgFlux /= config.fluxHistory.length;
        for (var j = 0; j < config.fluxHistory.length; j++) fluxVariance += Math.pow(config.fluxHistory[j] - avgFlux, 2);
        fluxVariance /= config.fluxHistory.length;
        var fluxStdDev = Math.sqrt(fluxVariance);
        var thresholdMultiplier = Math.max(0.1, 5.0 - config.sensitivity * 4.0);
        var adaptiveThreshold = Math.max(0.05, avgFlux + fluxStdDev * thresholdMultiplier);
        var isPeak = config.prevSmoothedFlux > adaptiveThreshold && config.prevSmoothedFlux >= config.smoothedFlux;
        if (config.beatHold > 0) {
          config.beatHold -= deltaTime * 60;
        } else if (isPeak && config.prevSmoothedFlux - config.smoothedFlux > 0.0001) {
          handleFrequencyTrigger(config.prevSmoothedFlux * 2.2 * config.pulseStrength, 'Kick', config.action);
          config.beatHold = config.cooldown;
        }
        config.lastEvalEnergy = config.smoothedFlux * 2.0;
        config.lastEvalThresh = adaptiveThreshold * 2.0;
        config.prevSmoothedFlux = config.smoothedFlux;
      }
    }

    function resampleFrequencyData(input, playing) {
      var length = input && finite(input.length, 0) | 0;
      if (length <= 0) {
        frequencyBins.fill(0);
        return false;
      }
      audioReceived = true;
      var byteScale = input.BYTES_PER_ELEMENT === 1;
      if (!byteScale && !(input instanceof Float32Array) && !(input instanceof Float64Array)) {
        for (var probe = 0; probe < Math.min(length, 64); probe++) {
          if (finite(input[probe], 0) > 1.5) { byteScale = true; break; }
        }
      }
      var scale = byteScale ? 1 / 255 : 1;
      for (var i = 0; i < 512; i++) {
        var start = Math.floor(i * length / 512);
        var end = Math.max(start + 1, Math.floor((i + 1) * length / 512));
        var sum = 0;
        for (var sourceIndex = start; sourceIndex < end && sourceIndex < length; sourceIndex++) {
          sum += Math.max(0, finite(input[sourceIndex], 0)) * scale;
        }
        frequencyBins[i] = playing ? clamp(sum / Math.max(1, end - start), 0, 1) : 0;
      }
      return true;
    }

    function updateAudioData(deltaTime) {
      var energySum = 0;
      var centroidNum = 0;
      var centroidDen = 0;
      var subBassSum = 0, bassSum = 0, lowMidSum = 0, midSum = 0;
      var highMidSum = 0, presenceSum = 0, brillianceSum = 0, airSum = 0;
      var jumpVolatilitySum = 0;
      var fluxPulse = 0;
      var fluxMeteor = 0;

      for (var i = 0; i < 512; i++) {
        var val = frequencyBins[i] || 0;
        energySum += val;
        centroidNum += i * val;
        centroidDen += val;
        var prevVal = prevData[i] || 0;
        jumpVolatilitySum += Math.abs(val - prevVal);
        if (i >= pulseTrigger.bandStart && i <= pulseTrigger.bandEnd) {
          var pulseDiff = val - prevVal;
          if (pulseDiff > 0) fluxPulse += pulseDiff;
        }
        if (i >= meteorTrigger.bandStart && i <= meteorTrigger.bandEnd) {
          var meteorDiff = val - prevVal;
          if (meteorDiff > 0) fluxMeteor += meteorDiff;
        }
        prevData[i] = val;
        if (i <= 6) subBassSum += val;
        else if (i <= 18) bassSum += val;
        else if (i <= 35) lowMidSum += val;
        else if (i <= 60) midSum += val;
        else if (i <= 95) highMidSum += val;
        else if (i <= 145) presenceSum += val;
        else if (i <= 210) brillianceSum += val;
        else if (i <= 300) airSum += val;
      }

      var energy = energySum / 512;
      if (lastPlaying && energy > 0.02) lastActiveTime = sourceTime;
      else lastIdleTime = sourceTime;
      evaluateTrigger(pulseTrigger, fluxPulse, deltaTime);
      evaluateTrigger(meteorTrigger, fluxMeteor, deltaTime);

      var subBass = subBassSum / 7;
      var bass = bassSum / 12;
      var lowMid = lowMidSum / 17;
      var mid = midSum / 25;
      var highMid = highMidSum / 35;
      var presence = presenceSum / 50;
      var brilliance = brillianceSum / 65;
      var air = airSum / 90;
      var oldBass = (subBassSum + bassSum + lowMidSum) / 36;
      var oldMid = (midSum + highMidSum) / 60;
      var oldTreble = (presenceSum + brillianceSum + airSum) / 205;
      var warmth = energySum > 0 ? (subBassSum + bassSum + lowMidSum + midSum) / energySum : 0;
      var brightness = energySum > 0 ? (presenceSum + brillianceSum + airSum) / energySum : 0;
      var sharpness = Math.max(0, brightness - prevBrightness) * 10;
      prevBrightness = brightness;
      var smoothnessVal = Math.max(0, 1.0 - (jumpVolatilitySum / 512) * 2.0);
      var activeThreshold = energy * 1.5;
      var activeBands = 0;
      if (subBass > activeThreshold) activeBands++;
      if (bass > activeThreshold) activeBands++;
      if (lowMid > activeThreshold) activeBands++;
      if (mid > activeThreshold) activeBands++;
      if (highMid > activeThreshold) activeBands++;
      if (presence > activeThreshold) activeBands++;
      if (brilliance > activeThreshold) activeBands++;
      if (air > activeThreshold) activeBands++;
      var density = activeBands / 8;
      var spectralCentroid = centroidDen > 0 ? centroidNum / centroidDen : 0;
      var baseFactor = energySum > 0 ? 0.15 : 0.08;
      var dt = 1 - Math.pow(1 - baseFactor, deltaTime * 60);
      var subDt = 1 - Math.pow(1 - baseFactor * 0.5, deltaTime * 60);
      smoothedData.bass += (oldBass - smoothedData.bass) * dt;
      smoothedData.mid += (oldMid - smoothedData.mid) * dt;
      smoothedData.treble += (oldTreble - smoothedData.treble) * dt;
      smoothedData.energy += (energy - smoothedData.energy) * dt;
      smoothedData.subBass += (subBass - smoothedData.subBass) * subDt;
      smoothedData.lowMid += (lowMid - smoothedData.lowMid) * dt;
      smoothedData.highMid += (highMid - smoothedData.highMid) * dt;
      smoothedData.presence += (presence - smoothedData.presence) * dt;
      smoothedData.brilliance += (brilliance - smoothedData.brilliance) * dt;
      smoothedData.air += (air - smoothedData.air) * dt;
      smoothedData.warmth += (warmth - smoothedData.warmth) * dt;
      smoothedData.brightness += (brightness - smoothedData.brightness) * dt;
      smoothedData.sharpness += (sharpness - smoothedData.sharpness) * dt;
      smoothedData.smoothness += (smoothnessVal - smoothedData.smoothness) * dt;
      smoothedData.density += (density - smoothedData.density) * dt;
      smoothedData.spectralCentroid += (spectralCentroid - smoothedData.spectralCentroid) * dt;
      return smoothedData;
    }

    function updateIdleWave(deltaTime) {
      var targetIntensity;
      if (audioReceived) {
        var hasEnergy = lastActiveTime > lastIdleTime;
        if (hasEnergy) {
          targetIntensity = 0;
          idleStartTime = 0;
        } else {
          if (idleStartTime === 0) idleStartTime = sourceTime || 0.000001;
          targetIntensity = sourceTime - idleStartTime >= runtimeState.idleWaveDebounce ? 1 : 0;
        }
      } else {
        targetIntensity = lastPlaying ? 0 : 1;
      }
      var delta = deltaTime / runtimeState.idleWaveFadeDuration;
      if (targetIntensity > currentIdleIntensity) currentIdleIntensity = Math.min(targetIntensity, currentIdleIntensity + delta);
      else if (targetIntensity < currentIdleIntensity) currentIdleIntensity = Math.max(targetIntensity, currentIdleIntensity - delta);
      return currentIdleIntensity;
    }

    function updatePhysics(deltaTime) {
      for (var i = 0; i < MAX_METEORS; i++) {
        var m = meteors[i];
        if (m.active) {
          m.y -= m.speed * 60 * deltaTime;
          if (m.y <= 0) {
            m.active = false;
            addRipple(m.x, m.z, m.strength * 1.5, true);
            for (var impact = 0; impact < 10; impact++) spawnParticle(m.x, 0.5, m.z, m.speed * 1.5);
            emit('impact', { x:m.x, z:m.z, strength:m.strength });
          }
          if (m.active && m.y > 0 && Math.random() > 0.3) {
            spawnParticle(m.x, m.y, m.z, m.speed * 0.2);
          }
        }
      }
      for (var pIndex = 0; pIndex < MAX_PARTICLES; pIndex++) {
        var p = particles[pIndex];
        if (p.active) {
          p.life += deltaTime;
          if (p.life >= p.maxLife) {
            p.active = false;
          } else {
            p.x += p.vx * deltaTime * 10;
            p.y += p.vy * deltaTime * 10;
            p.z += p.vz * deltaTime * 10;
          }
        }
      }
    }

    function updatePoolMatrices(theme, lerpSpeed) {
      tempColor.copy(theme.uWarmCore).lerp(whiteColor, 0.7);
      meteorMaterial.color.lerp(tempColor, lerpSpeed);
      for (var i = 0; i < MAX_METEORS; i++) {
        var m = meteors[i];
        if (!m.active) {
          dummyPosition.set(0, -1000, 0);
          dummyScale.set(0, 0, 0);
        } else {
          dummyPosition.set(m.x, Math.max(0, m.y), m.z);
          dummyScale.set(1.5, 1.5, 1.5);
        }
        dummyMatrix.compose(dummyPosition, dummyRotation, dummyScale);
        meteorMesh.setMatrixAt(i, dummyMatrix);
      }
      meteorMesh.instanceMatrix.needsUpdate = true;

      particleMaterial.color.copy(meteorMaterial.color);
      for (var pIndex = 0; pIndex < MAX_PARTICLES; pIndex++) {
        var p = particles[pIndex];
        if (!p.active) {
          dummyPosition.set(0, -1000, 0);
          dummyScale.set(0, 0, 0);
        } else {
          var scale = p.scale * (1.0 - p.life / p.maxLife);
          dummyPosition.set(p.x, p.y, p.z);
          dummyScale.set(scale, scale, scale);
        }
        dummyMatrix.compose(dummyPosition, dummyRotation, dummyScale);
        particleMesh.setMatrixAt(pIndex, dummyMatrix);
      }
      particleMesh.instanceMatrix.needsUpdate = true;
    }

    function updateThemeAndUniforms(data, idleIntensity) {
      var theme = themeFromInput(runtimeState.theme);
      var isMixedTheme = runtimeState.theme && typeof runtimeState.theme === 'object';
      var lerpSpeed = isMixedTheme ? 1.0 : 0.05;
      uniforms.uBaseColor1.value.lerp(theme.uBaseColor1, lerpSpeed);
      uniforms.uBaseColor2.value.lerp(theme.uBaseColor2, lerpSpeed);
      uniforms.uCoolCore.value.lerp(theme.uCoolCore, lerpSpeed);
      uniforms.uCoolEdge.value.lerp(theme.uCoolEdge, lerpSpeed);
      uniforms.uWarmCore.value.lerp(theme.uWarmCore, lerpSpeed);
      uniforms.uWarmEdge.value.lerp(theme.uWarmEdge, lerpSpeed);
      uniforms.uRippleColor.value.lerp(theme.uRippleColor, lerpSpeed);
      uniforms.uPeakColor.value.lerp(theme.uPeakColor, lerpSpeed);
      uniforms.uGlowIntensity.value += (theme.uGlowIntensity - uniforms.uGlowIntensity.value) * lerpSpeed;
      uniforms.uPeakEnabled.value = runtimeState.peakColorEnabled ? 1 : 0;
      uniforms.uPeakIntensity.value = runtimeState.peakColorIntensity;
      if (scene.fog) scene.fog.color.lerp(theme.uBaseColor1, lerpSpeed);
      if (scene.background && scene.background.isColor) scene.background.lerp(theme.uBaseColor1, lerpSpeed);

      uniforms.uTime.value = sourceTime;
      uniforms.uBass.value = data.bass;
      uniforms.uMid.value = data.mid;
      uniforms.uEnergy.value = data.energy;
      uniforms.uSubBass.value = data.subBass;
      uniforms.uLowMid.value = data.lowMid;
      uniforms.uHighMid.value = data.highMid;
      uniforms.uPresence.value = data.presence;
      uniforms.uBrilliance.value = data.brilliance;
      uniforms.uAir.value = data.air;
      uniforms.uWarmth.value = data.warmth;
      uniforms.uBrightness.value = data.brightness;
      uniforms.uSharpness.value = data.sharpness;
      uniforms.uSmoothness.value = data.smoothness;
      uniforms.uDensity.value = data.density;
      uniforms.uSpectralCentroid.value = data.spectralCentroid;
      uniforms.uAudioIntensity.value = runtimeState.audioIntensity;
      uniforms.uResponseRange.value = runtimeState.responseRange;
      uniforms.uRipples.value = ripples;
      uniforms.uIdleWave.value = runtimeState.idleWaveEnabled ? idleIntensity : 0;
      uniforms.uHalfExtent.value = HALF_EXTENT;
      updatePoolMatrices(theme, lerpSpeed);
    }

    var cameraTarget = new THREE.Vector3();

    function updateCameraPosition(frame, advanceRotation) {
      frame = frame || {};
      var dt = clamp(frame.dt == null ? 1 / 60 : frame.dt, 0, 0.1);
      var gesture = frame.gesture || lastGesture;
      lastGesture = {
        x:finite(gesture.x, 0), y:finite(gesture.y, 0),
        panX:finite(gesture.panX, 0), panY:finite(gesture.panY, 0),
        mouseX:finite(gesture.mouseX, 0), mouseY:finite(gesture.mouseY, 0),
        zoom:clamp(gesture.zoom == null ? 1 : gesture.zoom, 0.1, 5)
      };
      if (runtimeState.autoRotateEnabled && advanceRotation !== false) {
        autoRotateAngle = (autoRotateAngle + runtimeState.autoRotateSpeed * dt) % 360;
      } else if (!runtimeState.autoRotateEnabled) {
        autoRotateAngle = runtimeState.cameraAngleX;
      }
      var azimuthDegrees = (runtimeState.autoRotateEnabled ? autoRotateAngle : runtimeState.cameraAngleX) + lastGesture.y * 180 / Math.PI;
      var elevationDegrees = clamp(runtimeState.cameraAngleY - lastGesture.x * 180 / Math.PI, -85, 85);
      var distance = clamp(runtimeState.cameraDistance * lastGesture.zoom, 5, 300);
      var azimuth = azimuthDegrees * Math.PI / 180;
      var elevation = elevationDegrees * Math.PI / 180;
      var horizontalDistance = distance * Math.cos(elevation);
      var followX = Math.abs(lastGesture.mouseX) < 100 ? (lastGesture.mouseX - pointerFollowOrigin.x) * 0.12 : 0;
      var followZ = Math.abs(lastGesture.mouseY) < 100 ? (lastGesture.mouseY - pointerFollowOrigin.y) * 0.12 : 0;
      cameraTarget.set(lastGesture.panX + followX, 0, lastGesture.panY + followZ);
      camera.position.x = cameraTarget.x + horizontalDistance * Math.sin(azimuth);
      camera.position.z = cameraTarget.z + horizontalDistance * Math.cos(azimuth);
      camera.position.y = cameraTarget.y + distance * Math.sin(elevation);
      camera.lookAt(cameraTarget);
      camera.updateMatrixWorld(true);
      return true;
    }

    updateCameraPosition({ dt:0, gesture:lastGesture }, false);

    function setState(next) {
      if (disposed || !next || typeof next !== 'object') return false;
      rawState = Object.assign({}, rawState, next);
      syncRuntimeState(false);
      syncTriggerState();
      return true;
    }

    function setActive(value) {
      if (disposed) return false;
      active = value !== false;
      scene.visible = active;
      return active;
    }

    function update(frame) {
      if (disposed || !active) return false;
      frame = frame || {};
      if (frame.state && typeof frame.state === 'object') setState(frame.state);
      var deltaTime = clamp(frame.dt == null ? 1 / 60 : frame.dt, 0.001, 0.1);
      var incomingTime = finite(frame.time, NaN);
      if (isFinite(incomingTime)) {
        if (timeOrigin == null) timeOrigin = incomingTime;
        sourceTime = Math.max(sourceTime, incomingTime - timeOrigin);
      } else {
        sourceTime += deltaTime;
      }
      sampleRate = clamp(frame.sampleRate == null ? sampleRate : frame.sampleRate, 8000, 384000);
      lastPlaying = frame.playing === true;
      currentTrackTime = Math.max(0, finite(frame.currentTime, currentTrackTime));
      resampleFrequencyData(frame.frequencyData, lastPlaying);
      var data = updateAudioData(deltaTime);
      var idleIntensity = updateIdleWave(deltaTime);
      updatePhysics(deltaTime);
      updateThemeAndUniforms(data, idleIntensity);
      updateCameraPosition(frame, true);
      frameCount++;
      return true;
    }

    function pointer(event) {
      if (disposed || !active || !event || event.type !== 'click' || !runtimeState.meteorClickEnabled || lastPlaying) return false;
      if (sourceTime - lastClickMeteorTime < 0.3) return false;
      var rect = event.rect;
      if (!rect || finite(rect.width, 0) <= 0 || finite(rect.height, 0) <= 0) return false;
      var ndcX = ((finite(event.clientX, rect.left) - rect.left) / rect.width) * 2 - 1;
      var ndcY = -((finite(event.clientY, rect.top) - rect.top) / rect.height) * 2 + 1;
      pointerNdc.set(ndcX, ndcY);
      camera.updateMatrixWorld(true);
      raycaster.setFromCamera(pointerNdc, camera);
      if (!raycaster.ray.intersectPlane(groundPlane, intersectionPoint)) return false;
      lastClickMeteorTime = sourceTime;
      return addMeteor(1.0, intersectionPoint.x, intersectionPoint.z, true);
    }

    function resize(width, height, dpr) {
      if (disposed) return false;
      viewport.width = Math.max(1, Math.round(finite(width, 1)));
      viewport.height = Math.max(1, Math.round(finite(height, 1)));
      viewport.dpr = clamp(dpr == null ? 1 : dpr, 0.25, 8);
      camera.aspect = viewport.width / viewport.height;
      camera.updateProjectionMatrix();
      return true;
    }

    function updateCamera(frame) {
      if (disposed) return false;
      if (frame && frame.state) setState(frame.state);
      return updateCameraPosition(frame || {}, false);
    }

    function resetCamera() {
      if (disposed) return false;
      autoRotateAngle = runtimeState.cameraAngleX;
      pointerFollowOrigin.x = 0;
      pointerFollowOrigin.y = 0;
      lastGesture = { x:0, y:0, panX:0, panY:0, zoom:1, mouseX:0, mouseY:0 };
      cameraTarget.set(0, 0, 0);
      return updateCameraPosition({ dt:0, gesture:lastGesture }, false);
    }

    function activeCount(values) {
      var count = 0;
      for (var i = 0; i < values.length; i++) if (values[i].active || values[i].isActive > 0) count++;
      return count;
    }

    function rounded(value) { return Math.round(finite(value, 0) * 1000000) / 1000000; }

    function getDebug() {
      var theme = themeFromInput(runtimeState.theme);
      var resourcesAlive = disposed ? 0 : 1;
      var bandVector = [
        rounded(smoothedData.subBass), rounded(smoothedData.bass), rounded(smoothedData.lowMid), rounded(smoothedData.mid),
        rounded(smoothedData.highMid), rounded(smoothedData.presence), rounded(smoothedData.brilliance), rounded(smoothedData.air)
      ];
      var cameraIsDefault = Math.abs(lastGesture.x) < 1e-6 && Math.abs(lastGesture.y) < 1e-6 &&
        Math.abs(lastGesture.panX) < 1e-6 && Math.abs(lastGesture.panY) < 1e-6 &&
        Math.abs(cameraTarget.x) < 1e-6 && Math.abs(cameraTarget.z) < 1e-6 &&
        Math.abs(lastGesture.zoom - 1) < 1e-6 &&
        (!runtimeState.autoRotateEnabled || Math.abs(autoRotateAngle - runtimeState.cameraAngleX) < 1e-6);
      return {
        id:'shape2',
        sceneId:scene.uuid,
        shaderId:mapMaterial.uuid,
        stateId:'shape2-state-' + serial,
        active:active && !disposed,
        disposed:disposed,
        frameCount:frameCount,
        bandCount:8,
        time:rounded(sourceTime),
        grid:{
          size:GRID_SIZE,
          rows:GRID_SIZE,
          columns:GRID_SIZE,
          count:GRID_COUNT,
          instanceCount:GRID_COUNT,
          totalRange:TOTAL_RANGE,
          halfExtent:HALF_EXTENT,
          spacing:SPACING,
          pillarWidth:PILLAR_WIDTH
        },
        bands:bandVector.slice(),
        audio:{
          playing:lastPlaying,
          currentTime:rounded(currentTrackTime),
          energy:rounded(smoothedData.energy),
          bands:bandVector.slice(),
          bandCount:8,
          frameCount:frameCount,
          idleActive:currentIdleIntensity > 0.0001,
          binCount:512,
          sampleRate:sampleRate,
          input:'shared-frequencyData',
          ranges:[
            { id:'subBass', start:0, end:6, divisor:7 },
            { id:'bass', start:7, end:18, divisor:12 },
            { id:'lowMid', start:19, end:35, divisor:17 },
            { id:'mid', start:36, end:60, divisor:25 },
            { id:'highMid', start:61, end:95, divisor:35 },
            { id:'presence', start:96, end:145, divisor:50 },
            { id:'brilliance', start:146, end:210, divisor:65 },
            { id:'air', start:211, end:300, divisor:90 }
          ],
          vector:bandVector.slice(),
          values:{
            subBass:rounded(smoothedData.subBass), bass:rounded(smoothedData.bass), lowMid:rounded(smoothedData.lowMid), mid:rounded(smoothedData.mid),
            highMid:rounded(smoothedData.highMid), presence:rounded(smoothedData.presence), brilliance:rounded(smoothedData.brilliance), air:rounded(smoothedData.air),
            energy:rounded(smoothedData.energy), warmth:rounded(smoothedData.warmth), brightness:rounded(smoothedData.brightness),
            sharpness:rounded(smoothedData.sharpness), smoothness:rounded(smoothedData.smoothness), density:rounded(smoothedData.density),
            spectralCentroid:rounded(smoothedData.spectralCentroid), idle:rounded(currentIdleIntensity)
          },
          flux:{
            pulse:{ range:[pulseTrigger.bandStart,pulseTrigger.bandEnd], smoothed:rounded(pulseTrigger.smoothedFlux), threshold:rounded(pulseTrigger.lastEvalThresh), cooldown:rounded(pulseTrigger.beatHold) },
            meteor:{ range:[meteorTrigger.bandStart,meteorTrigger.bandEnd], smoothed:rounded(meteorTrigger.smoothedFlux), threshold:rounded(meteorTrigger.lastEvalThresh), cooldown:rounded(meteorTrigger.beatHold) }
          }
        },
        eventPools:{
          ripples:RIPPLE_CAPACITY,
          meteors:MAX_METEORS,
          impactParticles:MAX_PARTICLES,
          shaderRippleLoop:SHADER_RIPPLE_LOOP
        },
        eventPoolState:{
          ripples:{ capacity:RIPPLE_CAPACITY, shaderLoop:SHADER_RIPPLE_LOOP, active:activeCount(ripples), nextIndex:rippleIndex },
          meteors:{ capacity:MAX_METEORS, active:activeCount(meteors), nextIndex:meteorIndex },
          impactParticles:{ capacity:MAX_PARTICLES, active:activeCount(particles), nextIndex:particleIndex }
        },
        features:{
          ripple:true,
          meteor:true,
          directSourceShader:true,
          idleWave:true,
          camera:true,
          theme:true,
          ripplePool:true,
          meteorPool:true,
          impactParticles:true,
          peakColor:true,
          themes:THEME_IDS.slice(),
          cameraRotate:true,
          cameraZoom:true,
          cameraPan:true,
          autoRotate:true,
          sharedAudio:true,
          ownRenderer:false,
          ownAudioContext:false,
          ownAnalyser:false,
          ownAudioElement:false,
          ownAnimationFrame:false,
          ownTimer:false,
          ownListener:false
        },
        camera:{
          fov:camera.fov,
          near:camera.near,
          far:camera.far,
          aspect:rounded(camera.aspect),
          distance:rounded(runtimeState.cameraDistance * lastGesture.zoom),
          angleX:rounded(runtimeState.autoRotateEnabled ? autoRotateAngle : runtimeState.cameraAngleX),
          angleY:rounded(runtimeState.cameraAngleY),
          autoRotate:runtimeState.autoRotateEnabled,
          autoRotateSpeed:runtimeState.autoRotateSpeed,
          rotation:[rounded(lastGesture.x),rounded(lastGesture.y)],
          translation:[rounded(cameraTarget.x),rounded(cameraTarget.z),0],
          zoom:rounded(lastGesture.zoom),
          isDefault:cameraIsDefault,
          target:[rounded(cameraTarget.x),rounded(cameraTarget.y),rounded(cameraTarget.z)],
          position:[rounded(camera.position.x),rounded(camera.position.y),rounded(camera.position.z)],
          viewport:Object.assign({}, viewport)
        },
        state:{
          theme:theme.id,
          audioIntensity:runtimeState.audioIntensity,
          responseRange:runtimeState.responseRange,
          idleWaveEnabled:runtimeState.idleWaveEnabled,
          peakColorEnabled:runtimeState.peakColorEnabled,
          peakColorIntensity:runtimeState.peakColorIntensity,
          pulseEnabled:pulseTrigger.enabled,
          meteorEnabled:meteorTrigger.enabled,
          playing:lastPlaying
        },
        resources:{
          scenes:resourcesAlive,
          cameras:resourcesAlive,
          instancedMeshes:resourcesAlive * 3,
          geometries:resourcesAlive * 3,
          materials:resourcesAlive * 3,
          lights:resourcesAlive * 2,
          textures:0,
          renderTargets:0,
          listeners:0,
          timers:0,
          animationFrames:0,
          raf:0,
          renderers:0,
          audioContexts:0,
          analysers:0,
          audioElements:0
        },
        viewport:Object.assign({}, viewport),
        source:SOURCE
      };
    }

    function dispose() {
      if (disposed) return true;
      disposed = true;
      active = false;
      scene.visible = false;
      mapGeometry.dispose();
      mapMaterial.dispose();
      meteorGeometry.dispose();
      meteorMaterial.dispose();
      particleGeometry.dispose();
      particleMaterial.dispose();
      scene.remove(mapMesh);
      scene.remove(meteorMesh);
      scene.remove(particleMesh);
      scene.remove(ambientLight);
      scene.remove(directionalLight);
      scene.remove(camera);
      scene.background = null;
      scene.fog = null;
      frequencyBins.fill(0);
      prevData.fill(0);
      return true;
    }

    return {
      id:'shape2',
      scene:scene,
      camera:camera,
      setState:setState,
      setActive:setActive,
      update:update,
      pointer:pointer,
      resize:resize,
      updateCamera:updateCamera,
      resetCamera:resetCamera,
      dispose:dispose,
      getDebug:getDebug
    };
  }

  window.LumiFieldAudioEchoShape2Adapter = Object.freeze({
    id:'shape2',
    source:SOURCE,
    defaults:DEFAULTS,
    create:create
  });
})();
