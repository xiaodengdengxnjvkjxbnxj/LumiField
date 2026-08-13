/*
 * LumiField Audio Echo V2 - Shape 1 vanilla adapter.
 *
 * Fixed source: https://github.com/yin-yizhen/sonic-topography
 * Commit: f14589172431fa1da66fc78dd1f6cc403ead545b
 * Rights status: LUMIFIELD_AUTHORIZED + GPLV3_DOWNSTREAM_CONFIRMED. GitHub
 * Issue #25 records the fixed-commit LumiField authorization; on 2026-08-13
 * the project owner confirmed that the author also supplied GPLv3 downstream
 * confirmation through retained WeChat correspondence. No demo audio, images,
 * fonts, player, lyrics, account, telemetry,
 * updater, renderer, AudioContext, Audio element, RAF, or listeners are copied.
 *
 * Adapted files and fixed-source SHA-256:
 * BAB65E4C966AA1013ACEF382F9A4661984C91218369DBE594783256A9CF5D01D MapScene.tsx
 * 61D7E006D4F6493E60C706F99C9D8C5917FC9C0439901653FCF5A97253EB5207 CustomShaderMaterial.ts
 * D12EBB804C2BD1BB78EE34E05697A21A7AB99D656EF71F0C05E12CCB1B509F1E AudioEngine.ts
 * 79714C24C0D5A72D0ED3AA8E7889CD713179737DE8A934AD7CE61CAF9D315E33 beatDetector.ts
 * 251A1B21BFE9390A7D35FB66EBCA2EB72FFC1B7B47B4B2768888997E015AAFE8 kickEnvelope.ts
 * D44841D2883BEFBCB89F47C12F1E2BFDDAB79947B4655A4B6A36BE9F7A056B34 groundEqSettings.ts
 * 5F338CBAEE4F53F721DB3C9150BA2EED5DEAD630F36A445E87F05A72FB52F995 sceneDefaults.ts
 * 6AF33C7A216598F856FB0AFBBC9460430ACF69D751BEC3996CA442BBF2E75CB2 terrainResponse.ts
 * 317262E37F239F94D839243CE46A2888BC7182FBD8A242C75D022512612A810F themes.ts
 * 95BE5CD7BEE2EF00DAF147804C0C8CD94D3F13A91CC9803188EB2F42F2763991 types.ts
 * Aggregate source manifest SHA-256:
 * 714BC22A826F5C8F510D9134A3930A0361E216749A0825B46E40BD3B22037D98
 *
 * Modification boundary: React/R3F/drei and the source-owned audio/player
 * lifecycle were replaced by an imperative THREE r128 scene adapter. Every
 * animation step consumes only the frame supplied by LumiField's shared audio
 * bridge. Map GLSL, eight-band analysis, beat/kick envelopes, ground EQ,
 * ripples, meteors, particles, floating blocks, themes and tuned camera values
 * remain source-derived. Shape 3/Mineradio is intentionally absent.
 */
(function () {
  'use strict';

  var REPO = 'https://github.com/yin-yizhen/sonic-topography';
  var COMMIT = 'f14589172431fa1da66fc78dd1f6cc403ead545b';
  var SOURCE_SHA256 = '714BC22A826F5C8F510D9134A3930A0361E216749A0825B46E40BD3B22037D98';
  var GOLDEN_METADATA = 'docs/evidence/audio-echo/shape1-golden-master/metadata.json';
  var SCENE_ID = 'shape1-sonic-topography-map-scene';
  var SHADER_ID = 'shape1-map-shader-f1458917';
  var STATE_ID = 'shape1-eight-band-ground-state-v2';
  var BAND_COUNT = 8;
  var RIPPLE_COUNT = 10;
  var METEOR_COUNT = 20;
  var PARTICLE_COUNT = 200;
  var FLOATING_BLOCK_COUNT = 80;
  var TERRAIN_BASE_SIZE = 168;
  var TERRAIN_MIN_GRID_SIZE = 96;
  var TERRAIN_MAX_GRID_SIZE = 224;
  var DEFAULT_CAMERA = {
    position:{ x:-37.5836298835141, y:25.718921008284557, z:92.25687558089541 },
    target:{ x:0, y:0, z:0 }
  };
  var DEFAULT_GROUND_EQ = [90, 92, 50, 50, 50, 50, 50, 48];
  var DEFAULTS = {
    terrainDensity:46,
    terrainSize:TERRAIN_BASE_SIZE,
    gridSize:155,
    motionSpeed:50,
    amplitude:50,
    groundEqBands:DEFAULT_GROUND_EQ.slice(),
    enabledBands:[true,true,true,true,true,true,true,true],
    floatingBlocksEnabled:true,
    floatingBlockIntensity:55,
    floatingBlockMinSize:9,
    floatingBlockMaxSize:26,
    floatingBlockSpeed:77,
    floatingBlockCount:FLOATING_BLOCK_COUNT,
    rotationSpeed:0.15,
    theme:'minimal-monochrome',
    beatSensitivity:100,
    camera:DEFAULT_CAMERA,
    counts:{ ripples:RIPPLE_COUNT, meteors:METEOR_COUNT, particles:PARTICLE_COUNT, floatingBlocks:FLOATING_BLOCK_COUNT }
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

  function rateBlend(rate, delta) {
    return clamp(1 - Math.exp(-rate * Math.max(0, Number(delta) || 0)), 0, 1);
  }

  function copyState(value) {
    var next = Object.assign({}, value || {});
    next.visualEq = Array.isArray(next.visualEq) ? next.visualEq.slice(0, BAND_COUNT) : new Array(BAND_COUNT).fill(1);
    while (next.visualEq.length < BAND_COUNT) next.visualEq.push(1);
    next.visualEq = next.visualEq.map(function (entry) { return clamp(entry, 0, 2); });
    return next;
  }

  function deriveGrid(density) {
    density = clamp(Math.round(Number(density)), 0, 100);
    var gridSize = Math.round(TERRAIN_MIN_GRID_SIZE + ((TERRAIN_MAX_GRID_SIZE - TERRAIN_MIN_GRID_SIZE) * density) / 100);
    var spacing = TERRAIN_BASE_SIZE / gridSize;
    return {
      density:density,
      gridSize:gridSize,
      spacing:spacing,
      boxWidth:spacing * (0.9 / 1.05),
      instanceCount:gridSize * gridSize,
      terrainSize:TERRAIN_BASE_SIZE
    };
  }

  function sourceEqBands(state) {
    var visualEq = state.visualEq || [];
    return DEFAULT_GROUND_EQ.map(function (value, index) {
      return clamp(Math.round(value * (visualEq[index] == null ? 1 : visualEq[index])), 0, 100);
    });
  }

  function enabledBands(state) {
    if (Array.isArray(state.enabledBands) && state.enabledBands.length === BAND_COUNT) {
      return state.enabledBands.map(function (value) { return value !== false; });
    }
    return new Array(BAND_COUNT).fill(true);
  }

  function readEqBand(bands, index) {
    var value = Number(bands[index]);
    return isFinite(value) ? clamp(Math.round(value), 0, 100) : 50;
  }

  function applyGroundEq(value, bands, index, max) {
    var delta = (readEqBand(bands, index) - 50) / 50;
    if (delta >= 0) return clamp(value * (1 + delta * 1.8), 0, max == null ? 1 : max);
    var dullness = Math.abs(delta);
    return clamp(Math.max(0, value - dullness * 0.35) * (1 - dullness * 0.35), 0, max == null ? 1 : max);
  }

  function deriveKickLowBands(kickEnvelope, subBassEnergy, bassEnergy, bands, enabled) {
    var safeKick = clamp(kickEnvelope, 0, 0.75);
    var normalizedKick = safeKick / 0.75;
    var subInput = clamp(subBassEnergy, 0, 1) * 0.22 + normalizedKick * 1.28;
    var bassInput = clamp(bassEnergy, 0, 1) * 0.20 + normalizedKick * 1.15;
    return {
      subBass:enabled[0] ? applyGroundEq(subInput, bands, 0, 1.2) : 0,
      bass:enabled[1] ? applyGroundEq(bassInput, bands, 1, 1.15) : 0
    };
  }

  var TERRAIN_FRAGMENT_SHADER = [
    'uniform float uTime;',
    'uniform float uPresence;',
    'uniform float uBrilliance;',
    'uniform float uAir;',
    'uniform float uWarmth;',
    'uniform float uBrightness;',
    'uniform float uSharpness;',
    'uniform vec3 uBaseColor1;',
    'uniform vec3 uBaseColor2;',
    'uniform vec3 uFogColor;',
    'uniform vec3 uCoolCore;',
    'uniform vec3 uCoolEdge;',
    'uniform vec3 uWarmCore;',
    'uniform vec3 uWarmEdge;',
    'uniform vec3 uRippleColor;',
    'uniform float uGlowIntensity;',
    'varying vec2 vUv;',
    'varying float vElevation;',
    'varying float vDistance;',
    'varying vec2 vRippleAnim;',
    'varying vec3 vNormal;',
    'varying float vRelativeY;',
    'varying vec2 vInstancePos;',
    'varying float vInstanceRandom;',
    'float random(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123); }',
    'void main() {',
    '  bool isTop = vNormal.y > 0.5;',
    '  float distFromTop = 1.0 - vRelativeY;',
    '  float rnd = vInstanceRandom;',
    '  float centerDist = length(vInstancePos);',
    '  float normElevation = clamp(vElevation / 8.0, 0.0, 1.0);',
    '  vec3 cBase1 = uBaseColor1;',
    '  vec3 cBase2 = uBaseColor2;',
    '  vec3 coolCore = uCoolCore;',
    '  vec3 coolEdge = uCoolEdge;',
    '  vec3 warmCore = uWarmCore;',
    '  vec3 warmEdge = uWarmEdge;',
    '  float warmBlend = smoothstep(0.0, 1.0, uWarmth * 1.5 + (0.5 - centerDist/80.0));',
    '  vec3 zoneCore = mix(coolCore, warmCore, warmBlend);',
    '  vec3 zoneEdge = mix(coolEdge, warmEdge, warmBlend);',
    '  vec3 targetGlow = mix(zoneCore, zoneEdge, fract(rnd * 11.0));',
    '  float distFade = 1.0 - smoothstep(40.0, 75.0, centerDist);',
    '  vec3 brightCool = mix(coolCore, vec3(1.0), 0.24);',
    '  targetGlow = mix(targetGlow, brightCool, uBrightness * 0.6);',
    '  vec3 currentGlow = mix(cBase2, targetGlow, normElevation) * uGlowIntensity * distFade;',
    '  currentGlow = mix(currentGlow, uRippleColor, vRippleAnim.x);',
    '  currentGlow = mix(currentGlow, vec3(1.0), vRippleAnim.y);',
    '  vec3 bodyColor = mix(cBase1, cBase2, vRelativeY * distFade);',
    '  vec3 finalColor;',
    '  if (isTop) {',
    '    float topIntensity = smoothstep(0.0, 0.4, normElevation);',
    '    float twinkleDistFalloff = smoothstep(60.0, 30.0, centerDist);',
    '    float twinkleMultiplier = mix(twinkleDistFalloff, 1.0, smoothstep(0.01, 0.1, normElevation));',
    '    bool isSparkleTarget = fract(rnd * 31.0) > 0.95;',
    '    if (isSparkleTarget && normElevation < 0.1) topIntensity += uAir * 2.0 * twinkleMultiplier;',
    '    finalColor = mix(cBase2, currentGlow, topIntensity);',
    '    float edgeX = smoothstep(0.05, 0.01, vUv.x) + smoothstep(0.95, 0.99, vUv.x);',
    '    float edgeY = smoothstep(0.05, 0.01, vUv.y) + smoothstep(0.95, 0.99, vUv.y);',
    '    float edge = min(edgeX + edgeY, 1.0);',
    '    finalColor += currentGlow * edge * 0.8 * (topIntensity + 0.3);',
    '    float flashChance = smoothstep(0.3, 1.0, uPresence);',
    '    if (fract(rnd * 53.0) > 0.98 - flashChance * 0.1) {',
    '      float flashSync = sin(uTime * 40.0 + rnd * 100.0) * 0.5 + 0.5;',
    '      finalColor += mix(vec3(1.0), vec3(0.5,1.0,1.0), rnd) * flashSync * uPresence * (1.0 + uSharpness * 2.0) * twinkleMultiplier;',
    '    }',
    '    if (edge > 0.5 && fract(rnd * 89.0 + uTime * 2.0) > 0.98) finalColor += vec3(1.0) * uBrilliance * 3.0 * twinkleMultiplier;',
    '  } else {',
    '    float verticalFalloff = mix(1.0, 3.0, uSharpness);',
    '    float sideGlow = smoothstep(0.5 / verticalFalloff, 0.0, distFromTop) * normElevation;',
    '    if (normElevation < 0.02) sideGlow = 0.0;',
    '    finalColor = mix(bodyColor, currentGlow, sideGlow * 1.5);',
    '    float rimGlow = smoothstep(0.03, 0.0, distFromTop) * normElevation;',
    '    finalColor += currentGlow * rimGlow;',
    '  }',
    '  finalColor += uRippleColor * vRippleAnim.x * 0.6;',
    '  finalColor += vec3(1.0) * vRippleAnim.y * 1.2;',
    '  float aerialFog = smoothstep(30.0, 65.0, vDistance);',
    '  vec3 atmosphericColor = mix(cBase1, cBase2, 0.4);',
    '  finalColor = mix(finalColor, atmosphericColor, aerialFog * 0.35);',
    '  float alphaFade = 1.0 - smoothstep(55.0, 78.0, vDistance);',
    '  float alphaBlend = 1.0 - alphaFade;',
    '  finalColor = mix(finalColor, uFogColor, alphaBlend * 0.45);',
    '  gl_FragColor = vec4(finalColor, alphaFade);',
    '}'
  ].join('\n');

  var TERRAIN_VERTEX_SHADER = [
    'uniform float uTime;',
    'uniform float uSubBass;',
    'uniform float uBass;',
    'uniform float uLowMid;',
    'uniform float uMid;',
    'uniform float uHighMid;',
    'uniform float uSmoothness;',
    'uniform float uDensity;',
    'uniform float uEnergy;',
    'uniform float uAmplitude;',
    'struct Ripple { vec2 pos; float time; float strength; float isActive; float rippleType; };',
    'uniform Ripple uRipples[10];',
    'varying vec2 vUv;',
    'varying float vElevation;',
    'varying float vDistance;',
    'varying vec2 vRippleAnim;',
    'varying vec3 vNormal;',
    'varying float vRelativeY;',
    'varying vec2 vInstancePos;',
    'varying float vInstanceRandom;',
    'vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }',
    'vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }',
    'vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }',
    'float snoise(vec2 v) {',
    '  const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);',
    '  vec2 i=floor(v+dot(v,C.yy)); vec2 x0=v-i+dot(i,C.xx);',
    '  vec2 i1=(x0.x>x0.y)?vec2(1.0,0.0):vec2(0.0,1.0);',
    '  vec4 x12=x0.xyxy+C.xxzz; x12.xy-=i1; i=mod289(i);',
    '  vec3 p=permute(permute(i.y+vec3(0.0,i1.y,1.0))+i.x+vec3(0.0,i1.x,1.0));',
    '  vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.0);',
    '  m=m*m; m=m*m; vec3 x=2.0*fract(p*C.www)-1.0; vec3 h=abs(x)-0.5; vec3 ox=floor(x+0.5);',
    '  vec3 a0=x-ox; m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);',
    '  vec3 g; g.x=a0.x*x0.x+h.x*x0.y; g.yz=a0.yz*x12.xz+h.yz*x12.yw;',
    '  return 130.0*dot(m,g);',
    '}',
    'float random(vec2 st) { return fract(sin(dot(st.xy,vec2(12.9898,78.233)))*43758.5453123); }',
    'void main() {',
    '  vUv=uv; vNormal=normal;',
    '  vec4 instancePos=instanceMatrix*vec4(0.0,0.0,0.0,1.0);',
    '  vec2 pos2D=instancePos.xz; vInstancePos=pos2D;',
    '  float centerDist=length(pos2D); vDistance=centerDist;',
    '  float rnd=random(pos2D); vInstanceRandom=rnd;',
    '  vec2 movingPos=pos2D*0.05+vec2(uTime*0.1,uTime*0.05);',
    '  float baseNoise=(snoise(movingPos)+1.0)*0.5;',
    '  float wave=sin(pos2D.x*0.15+pos2D.y*0.1-uTime*0.6)*0.5+0.5;',
    '  float globalFalloff=smoothstep(60.0,30.0,centerDist);',
    '  float idleElevation=mix(baseNoise,wave,uSmoothness*0.5+0.2)*0.8*globalFalloff;',
    '  float subRegion=smoothstep(25.0,0.0,centerDist);',
    '  float subLift=uSubBass*subRegion*5.0;',
    '  float bassNoise=snoise(pos2D*0.1-vec2(0.0,uTime*0.2));',
    '  float bassRegion=smoothstep(35.0,5.0,centerDist+bassNoise*5.0);',
    '  float bassLift=uBass*bassRegion*smoothstep(0.0,1.0,rnd+uDensity*0.5)*4.0;',
    '  float lowMidNoise=snoise(pos2D*0.05+vec2(uTime*0.1,0.0));',
    '  float lowMidLift=uLowMid*(lowMidNoise*0.5+0.5)*2.5;',
    '  float riverFlow=sin(pos2D.x*0.2+pos2D.y*0.2+snoise(pos2D*0.1)*2.0-uTime*2.0);',
    '  float midLift=uMid*max(0.0,riverFlow)*3.0;',
    '  float highMidRegion=smoothstep(10.0,45.0,centerDist);',
    '  float highMidLift=0.0;',
    '  if (fract(rnd*13.3)>0.8) highMidLift=uHighMid*highMidRegion*fract(rnd*7.7)*2.5;',
    '  float audioElevation=subLift+bassLift+lowMidLift+midLift+highMidLift;',
    '  if (rnd>0.99) audioElevation+=uEnergy*5.0;',
    '  audioElevation*=globalFalloff;',
    '  audioElevation=max(0.0,audioElevation-0.2);',
    '  audioElevation*=uAmplitude;',
    '  float elevation=idleElevation+audioElevation;',
    '  float rippleElevation=0.0; float rippleIntensityNormal=0.0; float rippleIntensityWhite=0.0;',
    '  float speed=15.0; float width=3.0;',
    '  for(int i=0;i<10;i++){',
    '    if(uRipples[i].isActive>0.0){',
    '      float dist=length(pos2D-uRipples[i].pos); float timeSince=uTime-uRipples[i].time;',
    '      float curSpeed=speed; float curWidth=width; float curFadeDist=15.0; float elevationScale=4.0;',
    '      if(uRipples[i].rippleType>0.5){curSpeed=20.0;curWidth=1.0;curFadeDist=8.0;elevationScale=1.0;}',
    '      float waveRadius=timeSince*curSpeed; float d=dist-waveRadius;',
    '      float rippleWave=exp(-d*d/curWidth); float fade=exp(-waveRadius/curFadeDist);',
    '      float rPulse=rippleWave*fade*uRipples[i].strength; rippleElevation+=rPulse*elevationScale;',
    '      if(uRipples[i].rippleType>0.5) rippleIntensityWhite+=rPulse; else rippleIntensityNormal+=rPulse;',
    '    }',
    '  }',
    '  elevation+=rippleElevation;',
    '  vRippleAnim=vec2(clamp(rippleIntensityNormal,0.0,1.0),clamp(rippleIntensityWhite,0.0,1.0));',
    '  vElevation=elevation;',
    '  float yPos=position.y+0.5; vRelativeY=yPos;',
    '  float totalHeight=1.0+elevation; vec3 pos=position; pos.y=-0.5+yPos*totalHeight;',
    '  vec4 worldPosition=modelMatrix*instanceMatrix*vec4(pos,1.0);',
    '  gl_Position=projectionMatrix*viewMatrix*worldPosition;',
    '}'
  ].join('\n');

  var FLOATING_VERTEX_SHADER = [
    'uniform float uTime;',
    'uniform float uPulse;',
    'varying vec2 vUv;',
    'varying float vElevation;',
    'varying float vDistance;',
    'varying vec2 vRippleAnim;',
    'varying vec3 vNormal;',
    'varying float vRelativeY;',
    'varying vec2 vInstancePos;',
    'void main(){',
    ' vUv=uv; vNormal=normal;',
    ' vec4 instancePos=instanceMatrix*vec4(0.0,0.0,0.0,1.0);',
    ' vec2 pos2D=instancePos.xz; vInstancePos=pos2D; vDistance=length(pos2D);',
    ' vRippleAnim=vec2(uPulse*0.8,uPulse*0.3); vElevation=uPulse*20.0;',
    ' vRelativeY=position.y+0.5;',
    ' vec4 worldPosition=modelMatrix*instanceMatrix*vec4(position,1.0);',
    ' gl_Position=projectionMatrix*viewMatrix*worldPosition;',
    '}'
  ].join('\n');

  var FLOATING_FRAGMENT_SHADER = [
    'uniform float uTime;',
    'uniform float uPresence;',
    'uniform float uBrilliance;',
    'uniform float uAir;',
    'uniform float uWarmth;',
    'uniform float uBrightness;',
    'uniform float uSharpness;',
    'uniform vec3 uBaseColor1;',
    'uniform vec3 uBaseColor2;',
    'uniform vec3 uFogColor;',
    'uniform vec3 uCoolCore;',
    'uniform vec3 uCoolEdge;',
    'uniform vec3 uWarmCore;',
    'uniform vec3 uWarmEdge;',
    'uniform vec3 uRippleColor;',
    'uniform float uGlowIntensity;',
    'varying vec2 vUv;',
    'varying float vElevation;',
    'varying float vDistance;',
    'varying vec2 vRippleAnim;',
    'varying vec3 vNormal;',
    'varying float vRelativeY;',
    'varying vec2 vInstancePos;',
    'float random(vec2 st) { return fract(sin(dot(st.xy,vec2(12.9898,78.233)))*43758.5453123); }',
    'void main(){',
    ' float rnd=random(vInstancePos);',
    ' float centerDist=length(vInstancePos);',
    ' float normElevation=clamp(vElevation/8.0,0.0,1.0);',
    ' vec3 cBase1=uBaseColor1; vec3 cBase2=uBaseColor2;',
    ' vec3 coolCore=uCoolCore; vec3 coolEdge=uCoolEdge;',
    ' vec3 warmCore=uWarmCore; vec3 warmEdge=uWarmEdge;',
    ' float warmBlend=smoothstep(0.0,1.0,uWarmth*1.5+(0.5-centerDist/80.0));',
    ' vec3 zoneCore=mix(coolCore,warmCore,warmBlend);',
    ' vec3 zoneEdge=mix(coolEdge,warmEdge,warmBlend);',
    ' vec3 targetGlow=mix(zoneCore,zoneEdge,fract(rnd*11.0));',
    ' float distFade=1.0-smoothstep(40.0,75.0,centerDist);',
    ' vec3 brightCool=mix(coolCore,vec3(1.0),0.24);',
    ' targetGlow=mix(targetGlow,brightCool,uBrightness*0.6);',
    ' vec3 currentGlow=mix(cBase2,targetGlow,normElevation)*uGlowIntensity*distFade;',
    ' currentGlow=mix(currentGlow,uRippleColor,vRippleAnim.x);',
    ' currentGlow=mix(currentGlow,vec3(1.0),vRippleAnim.y);',
    ' float topIntensity=smoothstep(0.0,0.4,normElevation);',
    ' float twinkleDistFalloff=smoothstep(60.0,30.0,centerDist);',
    ' float twinkleMultiplier=mix(twinkleDistFalloff,1.0,smoothstep(0.01,0.1,normElevation));',
    ' vec3 finalColor=mix(cBase2,currentGlow,topIntensity);',
    ' float edgeX=smoothstep(0.05,0.01,vUv.x)+smoothstep(0.95,0.99,vUv.x);',
    ' float edgeY=smoothstep(0.05,0.01,vUv.y)+smoothstep(0.95,0.99,vUv.y);',
    ' float edge=min(edgeX+edgeY,1.0);',
    ' finalColor+=currentGlow*edge*0.8*(topIntensity+0.3);',
    ' float flashChance=smoothstep(0.3,1.0,uPresence);',
    ' if(fract(rnd*53.0)>0.98-flashChance*0.1){',
    '   float flashSync=sin(uTime*40.0+rnd*100.0)*0.5+0.5;',
    '   finalColor+=mix(vec3(1.0),vec3(0.5,1.0,1.0),rnd)*flashSync*uPresence*(1.0+uSharpness*2.0)*twinkleMultiplier;',
    ' }',
    ' if(edge>0.5&&fract(rnd*89.0+uTime*2.0)>0.98) finalColor+=vec3(1.0)*uBrilliance*3.0*twinkleMultiplier;',
    ' finalColor+=uRippleColor*vRippleAnim.x*0.6;',
    ' finalColor+=vec3(1.0)*vRippleAnim.y*1.2;',
    ' float aerialFog=smoothstep(30.0,65.0,vDistance);',
    ' vec3 atmosphericColor=mix(cBase1,cBase2,0.4);',
    ' finalColor=mix(finalColor,atmosphericColor,aerialFog*0.35);',
    ' float alphaFade=1.0-smoothstep(55.0,78.0,vDistance);',
    ' float alphaBlend=1.0-alphaFade;',
    ' finalColor=mix(finalColor,uFogColor,alphaBlend*0.45);',
    ' gl_FragColor=vec4(finalColor,alphaFade);',
    '}'
  ].join('\n');

  function themeFactory(THREE, id, name, background, fog, cool, warm, accent, glow) {
    var base = new THREE.Color(background);
    var coolColor = new THREE.Color(cool);
    var warmColor = new THREE.Color(warm);
    return {
      name:name, id:id,
      uBaseColor1:base.clone(),
      uBaseColor2:base.clone().lerp(new THREE.Color(0xffffff), 0.12),
      uFogColor:new THREE.Color(fog),
      uCoolCore:coolColor.clone(),
      uCoolEdge:coolColor.clone().lerp(base, 0.35),
      uWarmCore:warmColor.clone(),
      uWarmEdge:warmColor.clone().lerp(base, 0.35),
      uRippleColor:new THREE.Color(accent),
      uGlowIntensity:glow
    };
  }

  function buildThemes(THREE) {
    var white = new THREE.Color(1,1,1);
    var themes = {
      'ink-wash':{
        name:'Ink Wash', id:'ink-wash',
        uBaseColor1:white.clone(), uBaseColor2:white.clone(), uFogColor:white.clone(),
        uCoolCore:new THREE.Color(0,0,0), uCoolEdge:new THREE.Color(0,0,0).lerp(white,0.35),
        uWarmCore:new THREE.Color(0,0,0), uWarmEdge:new THREE.Color(0,0,0).lerp(white,0.35),
        uRippleColor:new THREE.Color(0.66,0.74,0.76), uGlowIntensity:1.1
      },
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
    themes['glacier-day'] = themeFactory(THREE,'glacier-day','Glacier Day','#D8E6EA','#E5EEF0','#2D8EA3','#D96F4D','#2F5963',0.82);
    themes['koi-pond'] = themeFactory(THREE,'koi-pond','Koi Pond','#123A36','#0F2C2A','#55D6B2','#F2A65A','#C8EEE4',1.12);
    themes['coral-reef'] = themeFactory(THREE,'coral-reef','Coral Reef','#40252A','#2F2024','#5FCAD0','#E8705F','#F0B7A4',1.08);
    themes['moss-glass'] = themeFactory(THREE,'moss-glass','Moss Glass','#2E3A24','#24301E','#88C8A3','#D6C36D','#DDE8B3',0.98);
    themes['blue-hour'] = themeFactory(THREE,'blue-hour','Blue Hour','#273C55','#1D3148','#8BC5E7','#F28C72','#CFE7F4',1.05);
    themes['porcelain-teal'] = themeFactory(THREE,'porcelain-teal','Porcelain Teal','#DDE8E4','#EEF4F1','#24786F','#B85D4D','#4F706A',0.78);
    themes['wine-signal'] = themeFactory(THREE,'wine-signal','Wine Signal','#3A2430','#2F202A','#83C5BE','#D95D73','#F0CBD3',1.06);
    themes['daybreak-lime'] = themeFactory(THREE,'daybreak-lime','Daybreak Lime','#D9E7C8','#E6EFD9','#2A7C72','#C65B47','#5C6F42',0.8);
    return themes;
  }

  var THEME_ALIASES = {
    neonPurple:'neon-tokyo', azure:'blue-hour', ice:'glacier-day', emerald:'cyber-forest',
    gold:'daybreak-lime', ink:'ink-wash', deepCyan:'porcelain-teal', lavender:'neon-tokyo',
    sakura:'wine-signal', copper:'coral-reef', mint:'koi-pond', ember:'coral-reef',
    flame:'wine-signal', hazePink:'neon-tokyo', fantasy:'neon-tokyo'
  };

  function resolveTheme(themes, state) {
    var id = String(state.theme || DEFAULTS.theme);
    id = THEME_ALIASES[id] || id;
    return themes[id] || themes['minimal-monochrome'];
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
      uEnergy:{ value:0 }, uAmplitude:{ value:1 }, uRipples:{ value:ripples }
    }, colorUniforms(THREE, theme));
    return new THREE.ShaderMaterial({
      uniforms:uniforms,
      vertexShader:TERRAIN_VERTEX_SHADER,
      fragmentShader:TERRAIN_FRAGMENT_SHADER,
      transparent:true
    });
  }

  function createFloatingMaterial(THREE, theme) {
    var uniforms = Object.assign({
      uTime:{ value:0 }, uPulse:{ value:0 }, uSubBass:{ value:0 }, uBass:{ value:0 },
      uLowMid:{ value:0 }, uMid:{ value:0 }, uHighMid:{ value:0 }, uPresence:{ value:0 },
      uBrilliance:{ value:0 }, uAir:{ value:0 }, uWarmth:{ value:0 }, uBrightness:{ value:0 },
      uSharpness:{ value:0 }, uSmoothness:{ value:0 }, uDensity:{ value:0 },
      uSpectralCentroid:{ value:0 }, uEnergy:{ value:0 }, uAmplitude:{ value:1 }
    }, colorUniforms(THREE, theme));
    return new THREE.ShaderMaterial({
      uniforms:uniforms,
      vertexShader:FLOATING_VERTEX_SHADER,
      fragmentShader:FLOATING_FRAGMENT_SHADER,
      transparent:true
    });
  }

  function createKickEnvelopeState() {
    return { noiseFloor:0, kickLevel:0, kickOnset:0, kickEnvelope:0 };
  }

  function stepKickEnvelope(state, rawKickLevel, onset, delta) {
    var safeRaw = clamp(rawKickLevel, 0, 1);
    var floorRate = safeRaw > state.noiseFloor ? 1.15 : 0.35;
    var noiseFloor = state.noiseFloor + (safeRaw - state.noiseFloor) * rateBlend(floorRate, delta);
    var kickLevel = clamp(safeRaw - noiseFloor - 0.025, 0, 1);
    var breathTarget = Math.min(0.11, kickLevel * 0.18);
    var onsetTarget = onset ? Math.max(0.48, kickLevel * 0.95) : 0;
    var target = Math.max(breathTarget, onsetTarget);
    var envelopeRate = target > state.kickEnvelope ? 42 : 11.5;
    var envelope = Math.max(breathTarget, state.kickEnvelope + (target - state.kickEnvelope) * rateBlend(envelopeRate, delta));
    return { noiseFloor:noiseFloor, kickLevel:kickLevel, kickOnset:onset ? 1 : 0, kickEnvelope:clamp(envelope,0,1) };
  }

  var BEAT_WINDOWS = [
    { name:'Deep', start:0, end:2 },
    { name:'Classic', start:1, end:4 },
    { name:'Punch', start:2, end:6 },
    { name:'Wide', start:0, end:7 }
  ];

  function createBeatState() {
    return {
      activeWindowIndex:1, windowScores:new Array(4).fill(0), previousWindowLevels:new Array(4).fill(0),
      fluxHistory:new Array(90).fill(0), fluxHistoryIndex:0, smoothedFlux:0,
      previousSmoothedFlux:0, cooldownRemaining:0, kickEnvelopeState:createKickEnvelopeState()
    };
  }

  function readWindowLevel(data, window) {
    var weighted = 0;
    var weightTotal = 0;
    var center = (window.start + window.end) / 2;
    var halfWidth = Math.max(1, (window.end - window.start + 1) / 2);
    for (var bin = window.start; bin <= window.end; bin++) {
      var distance = Math.abs(bin - center);
      var weight = 0.35 + 0.65 * (1 - Math.min(1, distance / halfWidth));
      weighted += ((data[bin] || 0) / 255) * weight;
      weightTotal += weight;
    }
    return weightTotal > 0 ? weighted / weightTotal : 0;
  }

  function beatParams(sensitivity) {
    sensitivity = clamp(Math.round(sensitivity == null ? 100 : sensitivity), 0, 100);
    var low = sensitivity <= 50 ? sensitivity / 50 : 1;
    var high = sensitivity > 50 ? (sensitivity - 50) / 50 : 0;
    var thresholdStdDevGain = lerp(2.6, 1.8, low);
    var thresholdFloor = lerp(0.05, 0.028, low);
    var minTriggerFlux = lerp(0.07, 0.045, low);
    return {
      thresholdStdDevGain:lerp(thresholdStdDevGain, 1.1, high),
      thresholdFloor:lerp(thresholdFloor, 0.016, high),
      minTriggerFlux:lerp(minTriggerFlux, 0.025, high)
    };
  }

  function stepBeatDetector(state, data, delta, sensitivity) {
    var params = beatParams(sensitivity);
    var levels = BEAT_WINDOWS.map(function (window) { return readWindowLevel(data, window); });
    var scores = state.windowScores.map(function (score, index) {
      var flux = Math.max(0, levels[index] - state.previousWindowLevels[index]);
      var width = BEAT_WINDOWS[index].end - BEAT_WINDOWS[index].start + 1;
      return score * 0.965 + flux / Math.sqrt(width);
    });
    var active = state.activeWindowIndex;
    for (var i = 0; i < scores.length; i++) if (scores[i] > scores[active] * 1.03) active = i;
    var rawFlux = Math.max(0, levels[active] - state.previousWindowLevels[active]);
    var smoothedFlux = state.smoothedFlux + (rawFlux - state.smoothedFlux) * 0.35;
    var avg = state.fluxHistory.reduce(function (sum, value) { return sum + value; }, 0) / state.fluxHistory.length;
    var variance = state.fluxHistory.reduce(function (sum, value) { return sum + Math.pow(value - avg, 2); }, 0) / state.fluxHistory.length;
    var threshold = Math.max(params.thresholdFloor, avg + Math.sqrt(variance) * params.thresholdStdDevGain);
    var cooldown = Math.max(0, state.cooldownRemaining - Math.max(0, delta));
    var peak = state.previousSmoothedFlux > threshold && state.previousSmoothedFlux >= smoothedFlux && state.previousSmoothedFlux >= params.minTriggerFlux;
    var onset = cooldown <= 0 && peak;
    var displayedFlux = onset ? state.previousSmoothedFlux : smoothedFlux;
    var history = state.fluxHistory.slice();
    history[state.fluxHistoryIndex] = smoothedFlux;
    var envelope = stepKickEnvelope(state.kickEnvelopeState, levels[active], onset, delta || 1/60);
    return {
      state:{
        activeWindowIndex:active, windowScores:scores, previousWindowLevels:levels,
        fluxHistory:history, fluxHistoryIndex:(state.fluxHistoryIndex + 1) % history.length,
        smoothedFlux:smoothedFlux, previousSmoothedFlux:smoothedFlux,
        cooldownRemaining:onset ? 0.12 : cooldown, kickEnvelopeState:envelope
      },
      kickLevel:envelope.kickLevel, kickFlux:displayedFlux, kickThreshold:threshold,
      kickOnset:onset ? 1 : 0, kickEnvelope:envelope.kickEnvelope,
      kickConfidence:clamp(displayedFlux / Math.max(0.001, threshold * 2.2),0,1),
      activeWindow:BEAT_WINDOWS[active]
    };
  }

  function createTrigger(action) {
    var trigger = {
      action:action, enabled:true, mode:'Auto Beat', autoTrack:true, freqIndex:-1, threshold:0.5,
      sensitivity:0.15, cooldown:60, bandStart:0, bandEnd:16, pulseStrength:0.2,
      currentCooldown:0, beatHold:0, lastEvalEnergy:0, lastEvalThresh:0,
      fluxHistory:new Array(40).fill(0), fluxHistoryIndex:0, smoothedFlux:0, prevSmoothedFlux:0
    };
    if (action === 'Pulse') Object.assign(trigger,{ bandStart:1, bandEnd:2, sensitivity:0.85, cooldown:15 });
    if (action === 'Meteor') Object.assign(trigger,{ bandStart:159, bandEnd:174, sensitivity:0.45, cooldown:241, pulseStrength:0.50 });
    if (action === 'Snare') Object.assign(trigger,{ bandStart:47, bandEnd:120, sensitivity:0.6, cooldown:30, pulseStrength:0.3 });
    return trigger;
  }

  function createAudioState() {
    return {
      virtualData:new Uint8Array(512), prevData:new Array(512).fill(0), prevBrightness:0,
      smoothed:{
        bass:0,mid:0,treble:0,energy:0,subBass:0,lowMid:0,highMid:0,presence:0,brilliance:0,air:0,
        warmth:0,brightness:0,sharpness:0,smoothness:0,density:0,spectralCentroid:0,
        kickLevel:0,kickFlux:0,kickThreshold:0,kickOnset:0,kickEnvelope:0,kickConfidence:0,
        kickWindowName:'Classic',kickWindowStart:1,kickWindowEnd:4
      },
      beat:createBeatState(), pulse:createTrigger('Pulse'), meteor:createTrigger('Meteor'), snare:createTrigger('Snare'),
      pulseTracker:[], lastAutoTrackTime:0, wasPlaying:false, releaseUntil:0
    };
  }

  function sampleSourceBins(audio, source, sampleRate) {
    var target = audio.virtualData;
    if (!source || !source.length) {
      target.fill(0);
      return target;
    }
    var inputFftSize = source.length * 2;
    var inputHz = (Number(sampleRate) || 48000) / inputFftSize;
    var sourceHz = (Number(sampleRate) || 48000) / 1024;
    for (var i = 0; i < target.length; i++) {
      var sourceIndex = clamp(Math.round((i * sourceHz) / inputHz), 0, source.length - 1);
      target[i] = source[sourceIndex] || 0;
    }
    return target;
  }

  function evaluateTrigger(trigger, fluxScore, playing, emitTrigger) {
    if (!trigger.enabled || !playing) return false;
    trigger.smoothedFlux += (fluxScore - trigger.smoothedFlux) * 0.4;
    trigger.fluxHistory[trigger.fluxHistoryIndex] = trigger.smoothedFlux;
    trigger.fluxHistoryIndex = (trigger.fluxHistoryIndex + 1) % trigger.fluxHistory.length;
    var avg = 0;
    var variance = 0;
    var i;
    for (i = 0; i < trigger.fluxHistory.length; i++) avg += trigger.fluxHistory[i];
    avg /= trigger.fluxHistory.length;
    for (i = 0; i < trigger.fluxHistory.length; i++) variance += Math.pow(trigger.fluxHistory[i] - avg, 2);
    variance /= trigger.fluxHistory.length;
    var thresholdMultiplier = Math.max(0.1, 5.0 - trigger.sensitivity * 4.0);
    var adaptiveThreshold = Math.max(0.01, avg + Math.sqrt(variance) * thresholdMultiplier);
    var peak = trigger.prevSmoothedFlux > adaptiveThreshold && trigger.prevSmoothedFlux >= trigger.smoothedFlux;
    var triggered = false;
    if (trigger.beatHold > 0) trigger.beatHold--;
    else if (peak && trigger.prevSmoothedFlux - trigger.smoothedFlux > 0.0001) {
      emitTrigger(trigger.prevSmoothedFlux * 30 * trigger.pulseStrength, 'Kick', trigger.action);
      triggered = true;
      trigger.beatHold = trigger.cooldown;
    }
    trigger.lastEvalEnergy = trigger.smoothedFlux * 10;
    trigger.lastEvalThresh = adaptiveThreshold * 10;
    trigger.prevSmoothedFlux = trigger.smoothedFlux;
    return triggered;
  }

  function autoTrackPulse(audio, raw, nowMs) {
    if (!audio.pulse.autoTrack) return;
    audio.pulseTracker.push({ time:nowMs, data:Array.prototype.slice.call(raw,0,30) });
    while (audio.pulseTracker.length && nowMs - audio.pulseTracker[0].time > 3000) audio.pulseTracker.shift();
    if (nowMs - audio.lastAutoTrackTime <= 1000 || audio.pulseTracker.length < 30) return;
    audio.lastAutoTrackTime = nowMs;
    var frames = audio.pulseTracker;
    var diffs = new Array(30).fill(0).map(function () { return []; });
    for (var f = 1; f < frames.length; f++) {
      for (var b = 0; b < 30; b++) {
        var diff = frames[f].data[b] / 255 - frames[f-1].data[b] / 255;
        if (diff > 0.01) diffs[b].push(diff);
      }
    }
    var results = diffs.map(function (values, bin) { return { bin:bin, maxDiff:values.length ? Math.max.apply(Math, values) : 0 }; });
    results.sort(function (a,b) { return b.maxDiff - a.maxDiff; });
    if (!results.length || results[0].maxDiff < 0.15) return;
    var first = results[0].bin;
    var second = results[1].bin;
    audio.pulse.bandStart = Math.min(first, second);
    audio.pulse.bandEnd = Math.max(first, second);
    audio.pulse.sensitivity = 0.85;
  }

  function analyzeAudio(audio, frame, emitTrigger) {
    var playing = frame.playing === true;
    var nowMs = Number(frame.now) || Number(frame.time) * 1000 || 0;
    var delta = clamp(frame.dt, 0, 0.25) || 1/60;
    if (playing && !audio.wasPlaying) audio.releaseUntil = nowMs + 1600;
    if (!playing && audio.wasPlaying) audio.releaseUntil = nowMs + 1600;
    audio.wasPlaying = playing;
    var raw;
    if (playing) {
      raw = sampleSourceBins(audio, frame.frequencyData, frame.sampleRate);
    } else {
      raw = audio.virtualData;
      for (var decayIndex=0; decayIndex<raw.length; decayIndex++) raw[decayIndex] = nowMs < audio.releaseUntil ? Math.floor(raw[decayIndex] * 0.94) : 0;
    }
    if (playing) {
      autoTrackPulse(audio, raw, nowMs);
    }
    var sums = [0,0,0,0,0,0,0,0];
    var energySum=0, centroidNum=0, centroidDen=0, volatility=0;
    var fluxPulse=0, fluxMeteor=0, fluxSnare=0;
    for (var i=0;i<512;i++) {
      var value=raw[i]/255;
      var previous=audio.prevData[i] || 0;
      energySum+=value; centroidNum+=i*value; centroidDen+=value; volatility+=Math.abs(value-previous);
      var difference=value-previous;
      if (difference>0.01) {
        if (i>=audio.pulse.bandStart && i<=audio.pulse.bandEnd) fluxPulse+=difference;
        if (i>=audio.snare.bandStart && i<=audio.snare.bandEnd) fluxSnare+=difference;
        if (i>=audio.meteor.bandStart && i<=audio.meteor.bandEnd) fluxMeteor+=difference;
      }
      audio.prevData[i]=playing ? value : 0;
      if (i<=1) sums[0]+=value;
      else if (i<=3) sums[1]+=value;
      else if (i<=7) sums[2]+=value;
      else if (i<=18) sums[3]+=value;
      else if (i<=46) sums[4]+=value;
      else if (i<=93) sums[5]+=value;
      else if (i<=186) sums[6]+=value;
      else if (i<=372) sums[7]+=value;
    }
    if (playing) {
      evaluateTrigger(audio.pulse, fluxPulse/Math.max(1,audio.pulse.bandEnd-audio.pulse.bandStart+1), true, emitTrigger);
      evaluateTrigger(audio.snare, fluxSnare/Math.max(1,audio.snare.bandEnd-audio.snare.bandStart+1), true, emitTrigger);
      evaluateTrigger(audio.meteor, fluxMeteor/Math.max(1,audio.meteor.bandEnd-audio.meteor.bandStart+1), true, emitTrigger);
    }
    var beat = stepBeatDetector(audio.beat, raw, delta, frame.state && frame.state.beatSensitivity);
    audio.beat = beat.state;
    var values=[sums[0]/2,sums[1]/2,sums[2]/4,sums[3]/11,sums[4]/28,sums[5]/47,sums[6]/93,sums[7]/186];
    var energy=energySum/512;
    var oldBass=(sums[0]+sums[1]+sums[2])/8;
    var oldMid=(sums[3]+sums[4])/39;
    var oldTreble=(sums[5]+sums[6]+sums[7])/326;
    var warmth=energySum>0?(sums[0]+sums[1]+sums[2]+sums[3])/energySum:0;
    var brightness=energySum>0?(sums[5]+sums[6]+sums[7])/energySum:0;
    var sharpness=Math.max(0,brightness-audio.prevBrightness)*10;
    audio.prevBrightness=brightness;
    var smoothness=Math.max(0,1-(volatility/512)*2);
    var activeThreshold=energy*1.5, activeBands=0;
    for (i=0;i<values.length;i++) if(values[i]>activeThreshold) activeBands++;
    var density=activeBands/8;
    var centroid=centroidDen>0?centroidNum/centroidDen:0;
    var smoothing=playing&&energySum>0?0.15:(nowMs<audio.releaseUntil?0.035:0.08);
    var s=audio.smoothed;
    s.bass+=(oldBass-s.bass)*smoothing; s.mid+=(oldMid-s.mid)*smoothing; s.treble+=(oldTreble-s.treble)*smoothing; s.energy+=(energy-s.energy)*smoothing;
    s.subBass+=(values[0]-s.subBass)*smoothing; s.lowMid+=(values[2]-s.lowMid)*smoothing; s.highMid+=(values[4]-s.highMid)*smoothing;
    s.presence+=(values[5]-s.presence)*smoothing; s.brilliance+=(values[6]-s.brilliance)*smoothing; s.air+=(values[7]-s.air)*smoothing;
    s.warmth+=(warmth-s.warmth)*smoothing; s.brightness+=(brightness-s.brightness)*smoothing; s.sharpness+=(sharpness-s.sharpness)*smoothing;
    s.smoothness+=(smoothness-s.smoothness)*smoothing; s.density+=(density-s.density)*smoothing; s.spectralCentroid+=(centroid-s.spectralCentroid)*smoothing;
    s.kickLevel=beat.kickLevel; s.kickFlux=beat.kickFlux; s.kickThreshold=beat.kickThreshold; s.kickOnset=beat.kickOnset;
    s.kickEnvelope=beat.kickEnvelope; s.kickConfidence=beat.kickConfidence; s.kickWindowName=beat.activeWindow.name;
    s.kickWindowStart=beat.activeWindow.start; s.kickWindowEnd=beat.activeWindow.end;
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
    var floatingPulse = 0;
    var rippleIndex = 0;
    var meteorIndex = 0;
    var particleIndex = 0;
    var lastMeteorSpawnTime = -Infinity;
    var themes = buildThemes(THREE);
    var theme = resolveTheme(themes,state);
    var grid = deriveGrid(state.terrainDensity == null ? DEFAULTS.terrainDensity : state.terrainDensity);
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
    var floatingGeometry = new THREE.BoxGeometry(1,1,1);
    var floatingMaterial = createFloatingMaterial(THREE,theme);
    var floatingMesh = new THREE.InstancedMesh(floatingGeometry,floatingMaterial,FLOATING_BLOCK_COUNT);
    floatingMesh.userData.audioEchoRole='floating-blocks';
    platter.add(floatingMesh);
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
    var floatingBlocks = new Array(FLOATING_BLOCK_COUNT).fill(0).map(function (_,index) {
      var ring=index/FLOATING_BLOCK_COUNT;
      var angle=ring*Math.PI*2*5+Math.sin(index*12.9898)*0.7;
      var radius=14+((index*37)%62);
      return { x:Math.cos(angle)*radius,z:Math.sin(angle)*radius,y:6+((index*17)%19),baseScale:0.75+((index*11)%9)*0.05,phase:index*0.73,rotationSpeed:0.18+((index*7)%10)*0.035 };
    });
    var meteors = new Array(METEOR_COUNT).fill(0).map(function(){return{active:false,x:0,y:-1000,z:0,speed:0,strength:0};});
    var particles = new Array(PARTICLE_COUNT).fill(0).map(function(){return{active:false,x:0,y:-1000,z:0,vx:0,vy:0,vz:0,life:0,maxLife:1,scale:1};});
    var smoothedGround={subBass:0,bass:0,lowMid:0,mid:0,highMid:0,presence:0,brilliance:0,air:0};
    var audioState=createAudioState();
    var dummyPosition=new THREE.Vector3(), dummyScale=new THREE.Vector3(), dummyRotation=new THREE.Quaternion();
    var floatingRotation=new THREE.Quaternion(), floatingEuler=new THREE.Euler(), dummyMatrix=new THREE.Matrix4();
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
    var resourceDebug={listeners:0,geometries:4,materials:4,textures:0,renderTargets:0,raf:0};
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
      var cooldown=audioState.meteor.cooldown/60;
      if(time-lastMeteorSpawnTime<cooldown)return;
      lastMeteorSpawnTime=time;
      var angle=Math.random()*Math.PI*2, distance=Math.random()*25, meteor=meteors[meteorIndex];
      meteor.active=true; meteor.x=Math.cos(angle)*distance; meteor.z=Math.sin(angle)*distance;
      meteor.y=30+Math.random()*10; meteor.speed=1+Math.random()*0.5+strength*1.5; meteor.strength=strength;
      meteorIndex=(meteorIndex+1)%METEOR_COUNT;
      emit('meteor',{strength:strength});
    }

    function trigger(strength,mode,action) {
      var time=lastTime;
      if(action==='Meteor') addMeteor(strength,time);
      else if(action==='Snare') {
        var angle=Math.random()*Math.PI*2, distance=10+Math.random()*35;
        addRipple(Math.cos(angle)*distance,Math.sin(angle)*distance,Math.min(strength*3,3),true,time);
      } else {
        var pulseAngle=Math.random()*Math.PI*2;
        var pulseDistance=mode==='Kick'?Math.random()*20:10+Math.random()*25;
        addRipple(Math.cos(pulseAngle)*pulseDistance,Math.sin(pulseAngle)*pulseDistance,Math.min(strength*(mode==='Kick'?2:3),3),false,time);
      }
      emit('beat',{strength:strength,mode:mode,action:action});
    }

    function updateColors(target,delta,data) {
      var amount=animationBlend(3*delta);
      setThemeUniforms(terrainMaterial.uniforms,target,amount);
      setThemeUniforms(floatingMaterial.uniforms,target,amount);
      scene.background.lerp(target.uBaseColor1,amount);
      scene.fog.color.lerp(target.uBaseColor1,amount);
      meteorMaterial.color.lerp(target.uWarmCore.clone().lerp(new THREE.Color(0xffffff),0.7),amount);
      particleMaterial.color.copy(meteorMaterial.color);
      var sourceUniforms=terrainMaterial.uniforms, blockUniforms=floatingMaterial.uniforms;
      blockUniforms.uWarmth.value=sourceUniforms.uWarmth.value;
      blockUniforms.uBrightness.value=sourceUniforms.uBrightness.value;
      blockUniforms.uSharpness.value=sourceUniforms.uSharpness.value;
      blockUniforms.uPresence.value=sourceUniforms.uPresence.value;
      blockUniforms.uBrilliance.value=sourceUniforms.uBrilliance.value;
      blockUniforms.uAir.value=sourceUniforms.uAir.value;
    }

    function updateCamera(frame) {
      var gesture=frame&&frame.gesture||{};
      var zoom=clamp(gesture.zoom==null?cameraOffsets.zoom:gesture.zoom,0.45,2.8);
      var distanceScale=clamp(state.cameraDistance==null?1.05:state.cameraDistance,0.35,2.8)/1.05;
      var horizontal=clamp(state.cameraHorizontal==null?0:state.cameraHorizontal,-180,180)*Math.PI/180;
      var elevationDelta=(clamp(state.cameraElevation==null?34:state.cameraElevation,2,86)-34)*Math.PI/180;
      var rotationX=clamp(gesture.x==null?0:gesture.x,-Math.PI*0.48,Math.PI*0.48);
      var rotationY=Number(gesture.y)||0;
      var azimuth=sourceAzimuth+horizontal+cameraOffsets.azimuth+rotationY;
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
      var data=analyzeAudio(audioState,frame,trigger);
      audioDebug.playing=frame.playing===true;
      audioDebug.currentTime=Math.max(0,Number(frame.currentTime)||0);
      audioDebug.energy=Number(data.energy)||0;
      audioDebug.bands=[data.subBass,data.bass,data.lowMid,data.mid,data.highMid,data.presence,data.brilliance,data.air].map(function(value){return Number(value)||0;});
      audioDebug.bandCount=BAND_COUNT;
      audioDebug.frameCount=frameCount+1;
      audioDebug.idleActive=!audioDebug.playing&&state.idleWave!==false;
      audioDebug.sampleRate=Math.max(0,Number(frame.sampleRate)||0);
      var bands=sourceEqBands(state), enabled=enabledBands(state);
      var motionSpeed=clamp(state.motionSpeed==null?DEFAULTS.motionSpeed:state.motionSpeed,0,100);
      var amplitude=clamp(state.amplitude==null?DEFAULTS.amplitude:state.amplitude,0,100);
      var responseRate=lerp(2.2,60,motionSpeed/100);
      var responseBlend=animationBlend(1-Math.exp(-responseRate*delta));
      var low=deriveKickLowBands(data.kickEnvelope,data.subBass,data.bass,bands,enabled);
      var targets=[low.subBass,low.bass,
        enabled[2]?applyGroundEq(data.lowMid,bands,2):0, enabled[3]?applyGroundEq(data.mid,bands,3):0,
        enabled[4]?applyGroundEq(data.highMid,bands,4):0, enabled[5]?applyGroundEq(data.presence,bands,5):0,
        enabled[6]?applyGroundEq(data.brilliance,bands,6):0, enabled[7]?applyGroundEq(data.air,bands,7):0];
      var keys=['subBass','bass','lowMid','mid','highMid','presence','brilliance','air'];
      for(var i=0;i<keys.length;i++)smoothedGround[keys[i]]=lerp(smoothedGround[keys[i]],targets[i],responseBlend);
      var sum=smoothedGround.subBass+smoothedGround.bass+smoothedGround.lowMid+smoothedGround.mid+smoothedGround.presence+smoothedGround.brilliance+smoothedGround.air;
      var eqAverage=bands.reduce(function(total,value){return total+value;},0)/bands.length;
      var uniforms=terrainMaterial.uniforms;
      uniforms.uTime.value=time;
      uniforms.uMid.value=smoothedGround.mid;
      uniforms.uEnergy.value=clamp(data.energy*(0.25+(eqAverage/50)*0.75),0,1);
      var amplitudeMultiplier=amplitude<=50?amplitude/50:1+Math.pow((amplitude-50)/50,2)*14;
      uniforms.uAmplitude.value=amplitudeMultiplier*clamp((state.responseStrength==null?1.18:state.responseStrength)/1.18,0,3);
      uniforms.uSubBass.value=smoothedGround.subBass; uniforms.uBass.value=smoothedGround.bass; uniforms.uLowMid.value=smoothedGround.lowMid;
      uniforms.uHighMid.value=smoothedGround.highMid; uniforms.uPresence.value=smoothedGround.presence;
      uniforms.uBrilliance.value=smoothedGround.brilliance; uniforms.uAir.value=smoothedGround.air;
      uniforms.uWarmth.value=clamp((smoothedGround.subBass+smoothedGround.bass+smoothedGround.lowMid+smoothedGround.mid)/Math.max(0.001,sum),0,1);
      uniforms.uBrightness.value=clamp((smoothedGround.presence+smoothedGround.brilliance+smoothedGround.air)/Math.max(0.001,sum),0,1);
      uniforms.uSharpness.value=data.sharpness; uniforms.uSmoothness.value=data.smoothness; uniforms.uDensity.value=data.density;
      uniforms.uSpectralCentroid.value=data.spectralCentroid;
      platterRotation+=(state.rotationSpeed==null?DEFAULTS.rotationSpeed:state.rotationSpeed)*delta;
      if(state.autoRotate===true)platterRotation+=(Number(state.rotateSpeed)||0)*delta;
      platter.rotation.y=platterRotation;
      platter.scale.x=state.flip===true?-1:1;
      var intensity=clamp(state.floatingBlockIntensity==null?55:state.floatingBlockIntensity,0,100)/100;
      var floatingSpeed=clamp(state.floatingBlockSpeed==null?77:state.floatingBlockSpeed,0,100);
      var pulseBlend=animationBlend(1-Math.exp(-lerp(3,36,floatingSpeed/100)*delta));
      floatingPulse=lerp(floatingPulse,clamp(data.kickEnvelope,0,1),pulseBlend);
      var minScale=lerp(0.12,0.75,clamp(state.floatingBlockMinSize==null?9:state.floatingBlockMinSize,0,100)/100);
      var maxScale=Math.max(minScale+0.05,lerp(0.45,3.2,clamp(state.floatingBlockMaxSize==null?26:state.floatingBlockMaxSize,0,100)/100));
      var sizeMix=clamp(floatingPulse*(0.5+intensity*1.7),0,1), pulseScale=lerp(minScale,maxScale,sizeMix);
      var blocksEnabled=state.floatingBlocksEnabled!==false;
      floatingMesh.visible=blocksEnabled;
      floatingMaterial.uniforms.uTime.value=time; floatingMaterial.uniforms.uPulse.value=sizeMix;
      for(i=0;i<floatingBlocks.length;i++){
        var block=floatingBlocks[i];
        var bob=Math.sin(time*(0.55+block.rotationSpeed)+block.phase)*0.45;
        dummyPosition.set(block.x,block.y+bob+floatingPulse*intensity*1.4,block.z);
        floatingEuler.set(time*block.rotationSpeed+block.phase,time*block.rotationSpeed*0.7+block.phase,time*block.rotationSpeed*0.45);
        floatingRotation.setFromEuler(floatingEuler);
        var scale=block.baseScale*pulseScale*(blocksEnabled?1:0); dummyScale.set(scale,scale,scale);
        dummyMatrix.compose(dummyPosition,floatingRotation,dummyScale); floatingMesh.setMatrixAt(i,dummyMatrix);
      }
      floatingMesh.instanceMatrix.needsUpdate=true;
      for(i=0;i<METEOR_COUNT;i++){
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
      camera.aspect=width/height;camera.updateProjectionMatrix();return true;
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
      ripples.length=0;meteors.length=0;particles.length=0;floatingBlocks.length=0;
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
        eventPools:{ripples:RIPPLE_COUNT,meteors:METEOR_COUNT,impactParticles:PARTICLE_COUNT,floatingBlocks:FLOATING_BLOCK_COUNT},
        features:{ripple:true,meteor:true,impactParticles:true,idleWave:true,camera:true,theme:true},
        counts:{ripples:RIPPLE_COUNT,meteors:METEOR_COUNT,particles:PARTICLE_COUNT,floatingBlocks:FLOATING_BLOCK_COUNT,activeMeteors:activeMeteors,activeParticles:activeParticles},
        beat:{window:audioState.smoothed.kickWindowName,envelope:audioState.smoothed.kickEnvelope,onset:audioState.smoothed.kickOnset},
        camera:cameraReport,
        audio:{playing:audioDebug.playing,currentTime:audioDebug.currentTime,energy:audioDebug.energy,bands:audioDebug.bands.slice(),bandCount:BAND_COUNT,frameCount:audioDebug.frameCount,idleActive:audioDebug.idleActive,sampleRate:audioDebug.sampleRate},
        energy:audioDebug.energy,
        viewport:{width:viewportDebug.width,height:viewportDebug.height,dpr:viewportDebug.dpr},
        resources:Object.assign({},resourceDebug),
        state:copyState(state),
        allocations:Object.assign({},allocations),errors:errors.slice(),
        source:{repository:REPO,repo:REPO,commit:COMMIT,sourceSha256:SOURCE_SHA256,sha256:SOURCE_SHA256,goldenMetadata:GOLDEN_METADATA,licenseStatus:'LUMIFIELD_AUTHORIZED_GPLV3_DOWNSTREAM_CONFIRMED',shape3Imported:false}
      };
    }

    return { scene:scene,camera:camera,update:update,pointer:pointer,resetCamera:resetCamera,updateCamera:updateCamera,setState:setState,setActive:setActive,resize:resize,dispose:dispose,getDebug:getDebug };
  }

  window.LumiFieldAudioEchoShape1Adapter = {
    id:'shape1',
    source:{ repository:REPO,repo:REPO,commit:COMMIT,sourceSha256:SOURCE_SHA256,goldenMetadata:GOLDEN_METADATA,licenseStatus:'LUMIFIELD_AUTHORIZED_GPLV3_DOWNSTREAM_CONFIRMED' },
    defaults:DEFAULTS,
    create:create
  };
})();
