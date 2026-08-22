/*
 * LumiField visual lab
 *
 * The effect math below is integrated from the corresponding React Bits
 * components at commit 4e0e030193b563be6be33d928f77d0d01cefe237.
 * React/OGL/Three wrappers were replaced with a dependency-free WebGL/Canvas
 * host so this static site can lazy-load one effect at a time. See
 * THIRD_PARTY_NOTICES.md for source URLs, hashes, license, and modifications.
 */

"use strict";

const TWO_PI = Math.PI * 2;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const mobileViewport = matchMedia("(max-width: 760px)");

const debug = window.__lfSiteDebug ||= {};
Object.assign(debug, {
  effectModuleLoaded: true,
  activeEffect: null,
  liveEffects: 0,
  activeRafLoops: 0,
  webglContexts: 0,
  effectSwitches: 0,
  pointerEvents: 0,
  lastPointer: null,
  effectErrors: []
});

const EFFECTS = {
  galaxy: {
    name: "星云",
    source: "Galaxy",
    description: "多层星海随光标产生斥力，并保持原版旋转、闪烁与色相算法。"
  },
  aurora: {
    name: "极光",
    source: "Aurora",
    description: "三段色带由 simplex noise 推动，形成连续而可呼吸的极光幕。"
  },
  embers: {
    name: "余烬",
    source: "Particles",
    description: "原版三维粒子运动模型使用暖色预设，光标会轻推整个余烬场。"
  },
  ice: {
    name: "冰",
    source: "Iridescence",
    description: "冷色虹彩波纹跟随光标折射，保留八次相位迭代的原始质感。"
  },
  "color-bends": {
    name: "色彩弯曲",
    source: "ColorBends",
    description: "多色带沿弯曲场流动，光标实时改变扭曲与视差方向。"
  },
  "dot-field": {
    name: "点场",
    source: "DotField",
    description: "点阵依据光标速度形成局部隆起、微光与回弹。"
  }
};

const FULLSCREEN_VERTEX = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const GALAXY_FRAGMENT = `
precision highp float;
uniform float uTime;
uniform vec3 uResolution;
uniform vec2 uFocal;
uniform vec2 uRotation;
uniform float uStarSpeed;
uniform float uDensity;
uniform float uHueShift;
uniform float uSpeed;
uniform vec2 uMouse;
uniform float uGlowIntensity;
uniform float uSaturation;
uniform float uMouseRepulsion;
uniform float uTwinkleIntensity;
uniform float uRotationSpeed;
uniform float uRepulsionStrength;
uniform float uMouseActiveFactor;
uniform float uTransparent;
varying vec2 vUv;
#define NUM_LAYER 4.0
#define STAR_COLOR_CUTOFF 0.2
#define MAT45 mat2(0.7071, -0.7071, 0.7071, 0.7071)
#define PERIOD 3.0
float Hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float tri(float x) { return abs(fract(x) * 2.0 - 1.0); }
float tris(float x) { float t = fract(x); return 1.0 - smoothstep(0.0, 1.0, abs(2.0 * t - 1.0)); }
float trisn(float x) { float t = fract(x); return 2.0 * (1.0 - smoothstep(0.0, 1.0, abs(2.0 * t - 1.0))) - 1.0; }
vec3 hsv2rgb(vec3 c) { vec4 K = vec4(1.0, 0.6666667, 0.3333333, 3.0); vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www); return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y); }
float Star(vec2 uv, float flare) {
  float d = length(uv);
  float m = (0.05 * uGlowIntensity) / max(d, 0.0001);
  float rays = smoothstep(0.0, 1.0, 1.0 - abs(uv.x * uv.y * 1000.0));
  m += rays * flare * uGlowIntensity;
  uv *= MAT45;
  rays = smoothstep(0.0, 1.0, 1.0 - abs(uv.x * uv.y * 1000.0));
  m += rays * 0.3 * flare * uGlowIntensity;
  return m * smoothstep(1.0, 0.2, d);
}
vec3 StarLayer(vec2 uv) {
  vec3 col = vec3(0.0);
  vec2 gv = fract(uv) - 0.5;
  vec2 id = floor(uv);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y));
      vec2 si = id + offset;
      float seed = Hash21(si);
      float size = fract(seed * 345.32);
      float glossLocal = tri(uStarSpeed / (PERIOD * seed + 1.0));
      float flareSize = smoothstep(0.9, 1.0, size) * glossLocal;
      float red = smoothstep(STAR_COLOR_CUTOFF, 1.0, Hash21(si + 1.0)) + STAR_COLOR_CUTOFF;
      float blu = smoothstep(STAR_COLOR_CUTOFF, 1.0, Hash21(si + 3.0)) + STAR_COLOR_CUTOFF;
      float grn = min(red, blu) * seed;
      vec3 base = vec3(red, grn, blu);
      float hue = atan(base.g - base.r, base.b - base.r) / 6.28318 + 0.5;
      hue = fract(hue + uHueShift / 360.0);
      float sat = length(base - vec3(dot(base, vec3(0.299, 0.587, 0.114)))) * uSaturation;
      float val = max(max(base.r, base.g), base.b);
      base = hsv2rgb(vec3(hue, sat, val));
      vec2 pad = vec2(tris(seed * 34.0 + uTime * uSpeed / 10.0), tris(seed * 38.0 + uTime * uSpeed / 30.0)) - 0.5;
      float star = Star(gv - offset - pad, flareSize);
      float twinkle = trisn(uTime * uSpeed + seed * 6.2831) * 0.5 + 1.0;
      star *= mix(1.0, twinkle, uTwinkleIntensity);
      col += star * size * base;
    }
  }
  return col;
}
void main() {
  vec2 focalPx = uFocal * uResolution.xy;
  vec2 uv = (vUv * uResolution.xy - focalPx) / uResolution.y;
  vec2 mousePosUV = (uMouse * uResolution.xy - focalPx) / uResolution.y;
  float mouseDist = length(uv - mousePosUV);
  if (uMouseRepulsion > 0.5 && mouseDist > 0.0001) {
    vec2 repulsion = normalize(uv - mousePosUV) * (uRepulsionStrength / (mouseDist + 0.1));
    uv += repulsion * 0.05 * uMouseActiveFactor;
  }
  float autoRotAngle = uTime * uRotationSpeed;
  mat2 autoRot = mat2(cos(autoRotAngle), -sin(autoRotAngle), sin(autoRotAngle), cos(autoRotAngle));
  uv = autoRot * uv;
  uv = mat2(uRotation.x, -uRotation.y, uRotation.y, uRotation.x) * uv;
  vec3 col = vec3(0.0);
  for (float i = 0.0; i < 1.0; i += 1.0 / NUM_LAYER) {
    float depth = fract(i + uStarSpeed * uSpeed);
    float scale = mix(20.0 * uDensity, 0.5 * uDensity, depth);
    float fade = depth * smoothstep(1.0, 0.9, depth);
    col += StarLayer(uv * scale + i * 453.32) * fade;
  }
  if (uTransparent > 0.5) {
    float alpha = min(smoothstep(0.0, 0.3, length(col)), 1.0);
    gl_FragColor = vec4(col, alpha);
  } else {
    gl_FragColor = vec4(col, 1.0);
  }
}`;

const AURORA_FRAGMENT = `
precision highp float;
uniform float uTime;
uniform float uAmplitude;
uniform vec3 uColorStops[3];
uniform vec2 uResolution;
uniform float uBlend;
vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec3 rampColor = uv.x < 0.5 ? mix(uColorStops[0], uColorStops[1], uv.x * 2.0) : mix(uColorStops[1], uColorStops[2], (uv.x - 0.5) * 2.0);
  float height = snoise(vec2(uv.x * 2.0 + uTime * 0.1, uTime * 0.25)) * 0.5 * uAmplitude;
  height = exp(height);
  height = uv.y * 2.0 - height + 0.2;
  float intensity = 0.6 * height;
  float auroraAlpha = smoothstep(0.20 - uBlend * 0.5, 0.20 + uBlend * 0.5, intensity);
  gl_FragColor = vec4(intensity * rampColor * auroraAlpha, auroraAlpha);
}`;

const IRIDESCENCE_FRAGMENT = `
precision highp float;
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uResolution;
uniform vec2 uMouse;
uniform float uAmplitude;
uniform float uSpeed;
varying vec2 vUv;
void main() {
  float mr = min(uResolution.x, uResolution.y);
  vec2 uv = (vUv.xy * 2.0 - 1.0) * uResolution.xy / mr;
  uv += (uMouse - vec2(0.5)) * uAmplitude;
  float d = -uTime * 0.5 * uSpeed;
  float a = 0.0;
  for (float i = 0.0; i < 8.0; ++i) { a += cos(i - d - a * uv.x); d += sin(uv.y * i + a); }
  d += uTime * 0.5 * uSpeed;
  vec3 col = vec3(cos(uv * vec2(d, a)) * 0.6 + 0.4, cos(a + d) * 0.5 + 0.5);
  col = cos(col * cos(vec3(d, a, 2.5)) * 0.5 + 0.5) * uColor;
  gl_FragColor = vec4(col, 1.0);
}`;

const COLOR_BENDS_FRAGMENT = `
precision highp float;
#define MAX_COLORS 8
uniform vec2 uCanvas;
uniform float uTime;
uniform float uSpeed;
uniform vec2 uRot;
uniform int uColorCount;
uniform vec3 uColors[MAX_COLORS];
uniform int uTransparent;
uniform float uScale;
uniform float uFrequency;
uniform float uWarpStrength;
uniform vec2 uPointer;
uniform float uMouseInfluence;
uniform float uParallax;
uniform float uNoise;
uniform int uIterations;
uniform float uIntensity;
uniform float uBandWidth;
varying vec2 vUv;
void main() {
  float t = uTime * uSpeed;
  vec2 p = vUv * 2.0 - 1.0;
  p += uPointer * uParallax * 0.1;
  vec2 rp = vec2(p.x * uRot.x - p.y * uRot.y, p.x * uRot.y + p.y * uRot.x);
  vec2 q = vec2(rp.x * (uCanvas.x / uCanvas.y), rp.y);
  q /= max(uScale, 0.0001);
  q /= 0.5 + 0.2 * dot(q, q);
  q += 0.2 * cos(t) - 7.56;
  q += (uPointer - rp) * uMouseInfluence * 0.2;
  for (int j = 0; j < 5; j++) {
    if (j >= uIterations - 1) break;
    vec2 rr = sin(1.5 * (q.yx * uFrequency) + 2.0 * cos(q * uFrequency));
    q += (rr - q) * 0.15;
  }
  vec3 col = vec3(0.0);
  float a = 1.0;
  if (uColorCount > 0) {
    vec2 s = q;
    vec3 sumCol = vec3(0.0);
    float cover = 0.0;
    for (int i = 0; i < MAX_COLORS; ++i) {
      if (i >= uColorCount) break;
      s -= 0.01;
      vec2 r = sin(1.5 * (s.yx * uFrequency) + 2.0 * cos(s * uFrequency));
      float m0 = length(r + sin(5.0 * r.y * uFrequency - 3.0 * t + float(i)) / 4.0);
      float kBelow = clamp(uWarpStrength, 0.0, 1.0);
      float kMix = pow(kBelow, 0.3);
      float gain = 1.0 + max(uWarpStrength - 1.0, 0.0);
      vec2 warped = s + (r - s) * kBelow * gain;
      float m1 = length(warped + sin(5.0 * warped.y * uFrequency - 3.0 * t + float(i)) / 4.0);
      float m = mix(m0, m1, kMix);
      float w = 1.0 - exp(-uBandWidth / exp(uBandWidth * m));
      sumCol += uColors[i] * w;
      cover = max(cover, w);
    }
    col = clamp(sumCol, 0.0, 1.0);
    a = uTransparent > 0 ? cover : 1.0;
  } else {
    vec2 s = q;
    for (int k = 0; k < 3; ++k) {
      s -= 0.01;
      vec2 r = sin(1.5 * (s.yx * uFrequency) + 2.0 * cos(s * uFrequency));
      float m0 = length(r + sin(5.0 * r.y * uFrequency - 3.0 * t + float(k)) / 4.0);
      float kBelow = clamp(uWarpStrength, 0.0, 1.0);
      float kMix = pow(kBelow, 0.3);
      float gain = 1.0 + max(uWarpStrength - 1.0, 0.0);
      vec2 warped = s + (r - s) * kBelow * gain;
      float m1 = length(warped + sin(5.0 * warped.y * uFrequency - 3.0 * t + float(k)) / 4.0);
      float m = mix(m0, m1, kMix);
      col[k] = 1.0 - exp(-uBandWidth / exp(uBandWidth * m));
    }
    a = uTransparent > 0 ? max(max(col.r, col.g), col.b) : 1.0;
  }
  col *= uIntensity;
  if (uNoise > 0.0001) {
    float n = fract(sin(dot(gl_FragCoord.xy + vec2(uTime), vec2(12.9898, 78.233))) * 43758.5453123);
    col = clamp(col + (n - 0.5) * uNoise, 0.0, 1.0);
  }
  vec3 rgb = uTransparent > 0 ? col * a : col;
  gl_FragColor = vec4(rgb, a);
}`;

const PARTICLE_VERTEX = `
attribute vec3 position;
attribute vec4 random;
attribute vec3 color;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform float uTime;
uniform float uSpread;
uniform float uBaseSize;
uniform float uSizeRandomness;
varying vec4 vRandom;
varying vec3 vColor;
void main() {
  vRandom = random;
  vColor = color;
  vec3 pos = position * uSpread;
  pos.z *= 10.0;
  vec4 mPos = modelMatrix * vec4(pos, 1.0);
  float t = uTime;
  mPos.x += sin(t * random.z + 6.28 * random.w) * mix(0.1, 1.5, random.x);
  mPos.y += sin(t * random.y + 6.28 * random.x) * mix(0.1, 1.5, random.w);
  mPos.z += sin(t * random.w + 6.28 * random.y) * mix(0.1, 1.5, random.z);
  vec4 mvPos = viewMatrix * mPos;
  gl_PointSize = uSizeRandomness == 0.0 ? uBaseSize : (uBaseSize * (1.0 + uSizeRandomness * (random.x - 0.5))) / length(mvPos.xyz);
  gl_Position = projectionMatrix * mvPos;
}`;

const PARTICLE_FRAGMENT = `
precision highp float;
uniform float uTime;
uniform float uAlphaParticles;
varying vec4 vRandom;
varying vec3 vColor;
void main() {
  vec2 uv = gl_PointCoord.xy;
  float d = length(uv - vec2(0.5));
  if (uAlphaParticles < 0.5) {
    if (d > 0.5) discard;
    gl_FragColor = vec4(vColor + 0.2 * sin(uv.yxx + uTime + vRandom.y * 6.28), 1.0);
  } else {
    float circle = smoothstep(0.5, 0.4, d) * 0.8;
    gl_FragColor = vec4(vColor + 0.2 * sin(uv.yxx + uTime + vRandom.y * 6.28), circle);
  }
}`;

function recordEffectError(effect, error) {
  debug.effectErrors.push({ effect, message: String(error?.message || error), at: new Date().toISOString() });
}

function hexToRgb(hex) {
  const value = hex.replace(/^#/, "");
  const full = value.length === 3 ? [...value].map((part) => part + part).join("") : value;
  const number = parseInt(full.slice(0, 6), 16);
  return [((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255];
}

function compileProgram(gl, vertexSource, fragmentSource) {
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || "Shader compilation failed";
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "Shader linking failed";
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function createCanvas(host, kind = "webgl") {
  const canvas = document.createElement("canvas");
  canvas.className = "effect-canvas";
  canvas.setAttribute("aria-hidden", "true");
  canvas.dataset.renderer = kind;
  host.appendChild(canvas);
  return canvas;
}

function createFrameDriver(render, fps = 30) {
  let active = false;
  let raf = 0;
  let counted = false;
  let last = -Infinity;
  const interval = 1000 / (mobileViewport.matches ? Math.min(fps, 24) : fps);
  const tick = (time) => {
    if (!active) return;
    raf = requestAnimationFrame(tick);
    if (time - last < interval) return;
    last = time;
    render(time);
  };
  const start = () => {
    if (active || document.hidden) return;
    active = true;
    if (reducedMotion.matches) {
      render(performance.now());
      return;
    }
    counted = true;
    debug.activeRafLoops += 1;
    raf = requestAnimationFrame(tick);
  };
  const stop = () => {
    if (!active) return;
    active = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (counted) debug.activeRafLoops = Math.max(0, debug.activeRafLoops - 1);
    counted = false;
  };
  return { start, stop, drawOnce: () => render(performance.now()) };
}

function canvasMetrics(canvas, host) {
  const rect = host.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.round(rect.width));
  const cssHeight = Math.max(1, Math.round(rect.height));
  const pixelBudget = mobileViewport.matches ? 780000 : 1450000;
  const budgetRatio = Math.sqrt(pixelBudget / (cssWidth * cssHeight));
  const ratio = Math.min(devicePixelRatio || 1, 1.5, budgetRatio);
  const width = Math.max(1, Math.round(cssWidth * ratio));
  const height = Math.max(1, Math.round(cssHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
  }
  return { width, height, cssWidth, cssHeight, ratio };
}

function createFullscreenEffect(host, fragmentSource, setup) {
  const canvas = createCanvas(host);
  const gl = canvas.getContext("webgl", { alpha: true, antialias: false, powerPreference: "high-performance", premultipliedAlpha: true });
  if (!gl) throw new Error("此浏览器未提供 WebGL 运行环境");
  debug.webglContexts += 1;
  let program;
  try {
    program = compileProgram(gl, FULLSCREEN_VERTEX, fragmentSource);
  } catch (error) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    canvas.remove();
    debug.webglContexts = Math.max(0, debug.webglContexts - 1);
    throw error;
  }
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.useProgram(program);
  const uniform = (name) => gl.getUniformLocation(program, name);
  const state = setup({ canvas, gl, program, uniform }) || {};
  let visible = true;
  const render = (time) => {
    const size = canvasMetrics(canvas, host);
    gl.viewport(0, 0, size.width, size.height);
    state.render?.(time, size);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };
  const driver = createFrameDriver(render, state.fps || 30);
  const resizeObserver = "ResizeObserver" in window ? new ResizeObserver(() => driver.drawOnce()) : null;
  resizeObserver?.observe(host);
  const onVisibility = () => {
    if (document.hidden) driver.stop();
    else if (visible) driver.start();
  };
  document.addEventListener("visibilitychange", onVisibility);
  driver.start();
  return {
    setVisible(value) {
      visible = value;
      if (value) driver.start(); else driver.stop();
    },
    destroy() {
      driver.stop();
      resizeObserver?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      state.destroy?.();
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
      debug.webglContexts = Math.max(0, debug.webglContexts - 1);
    }
  };
}

function trackPointer(host, callback, onLeave) {
  const move = (event) => {
    const rect = host.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    const y = Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / Math.max(1, rect.height)));
    debug.pointerEvents += 1;
    debug.lastPointer = { x, y };
    callback(x, y);
  };
  host.addEventListener("pointermove", move, { passive: true });
  if (onLeave) host.addEventListener("pointerleave", onLeave, { passive: true });
  return () => {
    host.removeEventListener("pointermove", move);
    if (onLeave) host.removeEventListener("pointerleave", onLeave);
  };
}

function createGalaxy(host) {
  return createFullscreenEffect(host, GALAXY_FRAGMENT, ({ gl, uniform }) => {
    const locations = Object.fromEntries(["uTime", "uResolution", "uFocal", "uRotation", "uStarSpeed", "uDensity", "uHueShift", "uSpeed", "uMouse", "uGlowIntensity", "uSaturation", "uMouseRepulsion", "uTwinkleIntensity", "uRotationSpeed", "uRepulsionStrength", "uMouseActiveFactor", "uTransparent"].map((key) => [key, uniform(key)]));
    const target = { x: 0.5, y: 0.5, active: 0 };
    const current = { x: 0.5, y: 0.5, active: 0 };
    const untrack = trackPointer(host, (x, y) => Object.assign(target, { x, y, active: 1 }), () => { target.active = 0; });
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    return {
      render(time, size) {
        current.x += (target.x - current.x) * 0.08;
        current.y += (target.y - current.y) * 0.08;
        current.active += (target.active - current.active) * 0.08;
        const seconds = time * 0.001;
        gl.uniform1f(locations.uTime, seconds);
        gl.uniform3f(locations.uResolution, size.width, size.height, size.width / size.height);
        gl.uniform2f(locations.uFocal, 0.5, 0.5);
        gl.uniform2f(locations.uRotation, 1, 0);
        gl.uniform1f(locations.uStarSpeed, seconds * 0.05);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform1f(locations.uDensity, 1);
        gl.uniform1f(locations.uHueShift, 140);
        gl.uniform1f(locations.uSpeed, 1);
        gl.uniform2f(locations.uMouse, current.x, current.y);
        gl.uniform1f(locations.uGlowIntensity, 0.3);
        gl.uniform1f(locations.uSaturation, 0);
        gl.uniform1f(locations.uMouseRepulsion, 1);
        gl.uniform1f(locations.uTwinkleIntensity, 0.32);
        gl.uniform1f(locations.uRotationSpeed, 0.1);
        gl.uniform1f(locations.uRepulsionStrength, 2);
        gl.uniform1f(locations.uMouseActiveFactor, current.active);
        gl.uniform1f(locations.uTransparent, 1);
      },
      destroy: untrack
    };
  });
}

function createAurora(host) {
  return createFullscreenEffect(host, AURORA_FRAGMENT, ({ gl, uniform }) => {
    const time = uniform("uTime");
    const resolution = uniform("uResolution");
    const amplitude = uniform("uAmplitude");
    const blend = uniform("uBlend");
    const colors = uniform("uColorStops[0]");
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    const palette = ["#5227FF", "#7cff67", "#5227FF"].flatMap(hexToRgb);
    gl.uniform3fv(colors, new Float32Array(palette));
    gl.uniform1f(amplitude, 1);
    gl.uniform1f(blend, 0.5);
    return {
      render(now, size) {
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform1f(time, now * 0.001);
        gl.uniform2f(resolution, size.width, size.height);
      }
    };
  });
}

function createIridescence(host) {
  return createFullscreenEffect(host, IRIDESCENCE_FRAGMENT, ({ gl, uniform }) => {
    const time = uniform("uTime");
    const resolution = uniform("uResolution");
    const mouse = uniform("uMouse");
    const target = { x: 0.5, y: 0.5 };
    const current = { ...target };
    const untrack = trackPointer(host, (x, y) => Object.assign(target, { x, y }));
    gl.uniform3f(uniform("uColor"), 0.56, 0.86, 1.0);
    gl.uniform1f(uniform("uAmplitude"), 0.18);
    gl.uniform1f(uniform("uSpeed"), 0.72);
    return {
      render(now, size) {
        current.x += (target.x - current.x) * 0.1;
        current.y += (target.y - current.y) * 0.1;
        gl.uniform1f(time, now * 0.001);
        gl.uniform3f(resolution, size.width, size.height, size.width / size.height);
        gl.uniform2f(mouse, current.x, current.y);
      },
      destroy: untrack
    };
  });
}

function createColorBends(host) {
  return createFullscreenEffect(host, COLOR_BENDS_FRAGMENT, ({ gl, uniform }) => {
    const locations = Object.fromEntries(["uCanvas", "uTime", "uSpeed", "uRot", "uColorCount", "uColors[0]", "uTransparent", "uScale", "uFrequency", "uWarpStrength", "uPointer", "uMouseInfluence", "uParallax", "uNoise", "uIterations", "uIntensity", "uBandWidth"].map((key) => [key, uniform(key)]));
    const target = { x: 0, y: 0 };
    const current = { ...target };
    const untrack = trackPointer(host, (x, y) => Object.assign(target, { x: x * 2 - 1, y: y * 2 - 1 }));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    gl.uniform1f(locations.uSpeed, 0.2);
    gl.uniform1i(locations.uColorCount, 0);
    gl.uniform1i(locations.uTransparent, 1);
    gl.uniform1f(locations.uScale, 1);
    gl.uniform1f(locations.uFrequency, 1);
    gl.uniform1f(locations.uWarpStrength, 1);
    gl.uniform1f(locations.uMouseInfluence, 1);
    gl.uniform1f(locations.uParallax, 0.5);
    gl.uniform1f(locations.uNoise, 0.15);
    gl.uniform1i(locations.uIterations, 1);
    gl.uniform1f(locations.uIntensity, 1.5);
    gl.uniform1f(locations.uBandWidth, 6);
    return {
      render(now, size) {
        current.x += (target.x - current.x) * 0.08;
        current.y += (target.y - current.y) * 0.08;
        const angle = 90 * Math.PI / 180;
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform2f(locations.uCanvas, size.width, size.height);
        gl.uniform1f(locations.uTime, now * 0.001);
        gl.uniform2f(locations.uRot, Math.cos(angle), Math.sin(angle));
        gl.uniform2f(locations.uPointer, current.x, current.y);
      },
      destroy: untrack
    };
  });
}

function perspectiveMatrix(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

function modelMatrix(rx, ry, rz, tx, ty) {
  const sx = Math.sin(rx), cx = Math.cos(rx);
  const sy = Math.sin(ry), cy = Math.cos(ry);
  const sz = Math.sin(rz), cz = Math.cos(rz);
  return new Float32Array([
    cy * cz, sx * sy * cz + cx * sz, -cx * sy * cz + sx * sz, 0,
    -cy * sz, -sx * sy * sz + cx * cz, cx * sy * sz + sx * cz, 0,
    sy, -sx * cy, cx * cy, 0,
    tx, ty, 0, 1
  ]);
}

function seededRandom(seed = 0x4c554d49) {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
    return (value >>> 0) / 4294967296;
  };
}

function createParticles(host) {
  const canvas = createCanvas(host);
  const gl = canvas.getContext("webgl", { alpha: true, antialias: false, powerPreference: "high-performance", premultipliedAlpha: false, depth: false });
  if (!gl) throw new Error("此浏览器未提供 WebGL 运行环境");
  debug.webglContexts += 1;
  let program;
  try {
    program = compileProgram(gl, PARTICLE_VERTEX, PARTICLE_FRAGMENT);
  } catch (error) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    canvas.remove();
    debug.webglContexts = Math.max(0, debug.webglContexts - 1);
    throw error;
  }
  gl.useProgram(program);
  const count = mobileViewport.matches ? 180 : 240;
  const positions = new Float32Array(count * 3);
  const randoms = new Float32Array(count * 4);
  const colors = new Float32Array(count * 3);
  const palette = ["#ffb347", "#ff6b35", "#ffd166", "#ff3d71"].map(hexToRgb);
  const random = seededRandom();
  for (let i = 0; i < count; i += 1) {
    let x, y, z, length;
    do { x = random() * 2 - 1; y = random() * 2 - 1; z = random() * 2 - 1; length = x * x + y * y + z * z; } while (length > 1 || length === 0);
    const radius = Math.cbrt(random());
    positions.set([x * radius, y * radius, z * radius], i * 3);
    randoms.set([random(), random(), random(), random()], i * 4);
    colors.set(palette[Math.floor(random() * palette.length)], i * 3);
  }
  const buffers = [];
  const attribute = (name, size, data) => {
    const buffer = gl.createBuffer();
    buffers.push(buffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const location = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  };
  attribute("position", 3, positions);
  attribute("random", 4, randoms);
  attribute("color", 3, colors);
  const uniform = (name) => gl.getUniformLocation(program, name);
  const uniforms = { model: uniform("modelMatrix"), view: uniform("viewMatrix"), projection: uniform("projectionMatrix"), time: uniform("uTime"), spread: uniform("uSpread"), baseSize: uniform("uBaseSize"), randomness: uniform("uSizeRandomness"), alpha: uniform("uAlphaParticles") };
  gl.uniform1f(uniforms.spread, 10);
  gl.uniform1f(uniforms.randomness, 1);
  gl.uniform1f(uniforms.alpha, 1);
  const view = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -20, 1]);
  gl.uniformMatrix4fv(uniforms.view, false, view);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.disable(gl.DEPTH_TEST);
  gl.clearColor(0, 0, 0, 0);
  const pointer = { x: 0, y: 0 };
  const current = { x: 0, y: 0 };
  const untrack = trackPointer(host, (x, y) => Object.assign(pointer, { x: x * 2 - 1, y: y * 2 - 1 }), () => Object.assign(pointer, { x: 0, y: 0 }));
  let visible = true;
  const render = (now) => {
    const size = canvasMetrics(canvas, host);
    current.x += (pointer.x - current.x) * 0.06;
    current.y += (pointer.y - current.y) * 0.06;
    const elapsed = now * 0.00012;
    gl.viewport(0, 0, size.width, size.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniformMatrix4fv(uniforms.projection, false, perspectiveMatrix(15 * Math.PI / 180, size.width / size.height, 0.1, 100));
    gl.uniformMatrix4fv(uniforms.model, false, modelMatrix(Math.sin(elapsed * 0.2) * 0.1, Math.cos(elapsed * 0.5) * 0.15, elapsed * 0.45, -current.x * 0.9, -current.y * 0.9));
    gl.uniform1f(uniforms.time, elapsed);
    gl.uniform1f(uniforms.baseSize, 112 * size.ratio);
    gl.drawArrays(gl.POINTS, 0, count);
  };
  const driver = createFrameDriver(render, 30);
  const resizeObserver = "ResizeObserver" in window ? new ResizeObserver(() => driver.drawOnce()) : null;
  resizeObserver?.observe(host);
  const onVisibility = () => { if (document.hidden) driver.stop(); else if (visible) driver.start(); };
  document.addEventListener("visibilitychange", onVisibility);
  driver.start();
  return {
    setVisible(value) { visible = value; if (value) driver.start(); else driver.stop(); },
    destroy() {
      driver.stop();
      resizeObserver?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      untrack();
      buffers.forEach((buffer) => gl.deleteBuffer(buffer));
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
      debug.webglContexts = Math.max(0, debug.webglContexts - 1);
    }
  };
}

function createDotField(host) {
  const canvas = createCanvas(host, "2d");
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("此浏览器未提供 Canvas 2D 运行环境");
  const dots = [];
  const mouse = { x: -9999, y: -9999, previousX: -9999, previousY: -9999, speed: 0 };
  let size = { width: 1, height: 1, ratio: 1 };
  let engagement = 0;
  let gradient;
  let visible = true;
  const build = () => {
    size = canvasMetrics(canvas, host);
    context.setTransform(size.ratio, 0, 0, size.ratio, 0, 0);
    gradient = context.createLinearGradient(0, 0, size.cssWidth, size.cssHeight);
    gradient.addColorStop(0, "rgba(168, 85, 247, .35)");
    gradient.addColorStop(1, "rgba(180, 151, 207, .25)");
    dots.length = 0;
    const step = 15.5;
    const columns = Math.floor(size.cssWidth / step);
    const rows = Math.floor(size.cssHeight / step);
    const padX = (size.cssWidth % step) / 2;
    const padY = (size.cssHeight % step) / 2;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const ax = padX + column * step + step / 2;
        const ay = padY + row * step + step / 2;
        dots.push({ ax, ay, sx: ax, sy: ay });
      }
    }
  };
  const onPointer = (event) => {
    const rect = host.getBoundingClientRect();
    mouse.x = event.clientX - rect.left;
    mouse.y = event.clientY - rect.top;
    debug.pointerEvents += 1;
    debug.lastPointer = { x: mouse.x / Math.max(1, rect.width), y: 1 - mouse.y / Math.max(1, rect.height) };
  };
  const onLeave = () => { mouse.x = -9999; mouse.y = -9999; };
  window.addEventListener("pointermove", onPointer, { passive: true });
  document.documentElement.addEventListener("pointerleave", onLeave, { passive: true });
  const render = () => {
    const dx = mouse.previousX - mouse.x;
    const dy = mouse.previousY - mouse.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    mouse.speed += (distance - mouse.speed) * 0.5;
    if (mouse.speed < 0.001) mouse.speed = 0;
    mouse.previousX = mouse.x;
    mouse.previousY = mouse.y;
    const target = Math.min(mouse.speed / 5, 1);
    engagement += (target - engagement) * 0.06;
    if (engagement < 0.001) engagement = 0;
    context.clearRect(0, 0, size.cssWidth, size.cssHeight);
    const glow = Math.min(1, engagement * 0.85);
    if (glow > 0.01) {
      const light = context.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 160);
      light.addColorStop(0, `rgba(18, 15, 23, ${0.8 * glow})`);
      light.addColorStop(1, "rgba(18, 15, 23, 0)");
      context.fillStyle = light;
      context.fillRect(0, 0, size.cssWidth, size.cssHeight);
    }
    context.fillStyle = gradient;
    context.beginPath();
    const radius = 0.75;
    const cursorRadius = 500;
    const cursorSquared = cursorRadius * cursorRadius;
    for (let index = 0; index < dots.length; index += 1) {
      const dot = dots[index];
      const deltaX = mouse.x - dot.ax;
      const deltaY = mouse.y - dot.ay;
      const distanceSquared = deltaX * deltaX + deltaY * deltaY;
      if (distanceSquared < cursorSquared && engagement > 0.01) {
        const distanceToPointer = Math.sqrt(distanceSquared);
        const influence = 1 - distanceToPointer / cursorRadius;
        const push = influence * influence * 67 * engagement;
        const angle = Math.atan2(deltaY, deltaX);
        dot.sx += (dot.ax - Math.cos(angle) * push - dot.sx) * 0.15;
        dot.sy += (dot.ay - Math.sin(angle) * push - dot.sy) * 0.15;
      } else {
        dot.sx += (dot.ax - dot.sx) * 0.1;
        dot.sy += (dot.ay - dot.sy) * 0.1;
      }
      context.moveTo(dot.sx + radius, dot.sy);
      context.arc(dot.sx, dot.sy, radius, 0, TWO_PI);
    }
    context.fill();
  };
  build();
  const driver = createFrameDriver(render, 30);
  const resizeObserver = "ResizeObserver" in window ? new ResizeObserver(build) : null;
  resizeObserver?.observe(host);
  const onVisibility = () => { if (document.hidden) driver.stop(); else if (visible) driver.start(); };
  document.addEventListener("visibilitychange", onVisibility);
  driver.start();
  return {
    setVisible(value) { visible = value; if (value) driver.start(); else driver.stop(); },
    destroy() {
      driver.stop();
      resizeObserver?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onPointer);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      canvas.width = 1;
      canvas.height = 1;
      canvas.remove();
    }
  };
}

const factories = {
  galaxy: createGalaxy,
  aurora: createAurora,
  embers: createParticles,
  ice: createIridescence,
  "color-bends": createColorBends,
  "dot-field": createDotField
};

export function mountVisualLab(root) {
  if (!root) throw new Error("Visual lab root is required");
  const host = root.querySelector("[data-effect-host]");
  const buttons = [...root.querySelectorAll("[data-effect]")];
  const name = root.querySelector("[data-effect-name]");
  const source = root.querySelector("[data-effect-source]");
  const description = root.querySelector("[data-effect-description]");
  const status = root.querySelector("[data-effect-status]");
  if (!host || buttons.length === 0) throw new Error("Visual lab markup is incomplete");
  let engine = null;
  let activeKey = null;
  let sectionVisible = root.getBoundingClientRect().top < innerHeight && root.getBoundingClientRect().bottom > 0;

  const setCopy = (key) => {
    const item = EFFECTS[key];
    if (name) name.textContent = item.name;
    if (source) source.textContent = `React Bits / ${item.source}`;
    if (description) description.textContent = item.description;
  };

  const activate = (key, focus = false) => {
    if (!EFFECTS[key] || (activeKey === key && engine)) return;
    host.classList.add("is-switching");
    engine?.destroy();
    engine = null;
    host.replaceChildren();
    setCopy(key);
    buttons.forEach((button) => {
      const selected = button.dataset.effect === key;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.classList.toggle("is-active", selected);
      if (selected && focus) button.focus();
    });
    try {
      engine = factories[key](host);
      engine.setVisible(sectionVisible);
      activeKey = key;
      debug.activeEffect = key;
      debug.effectSwitches += 1;
      debug.liveEffects = 1;
      if (status) status.textContent = `${EFFECTS[key].name} 已就绪，可移动光标交互`;
      root.dispatchEvent(new CustomEvent("lf-effect-changed", { detail: { key } }));
    } catch (error) {
      activeKey = null;
      debug.activeEffect = null;
      debug.liveEffects = 0;
      recordEffectError(key, error);
      host.innerHTML = '<p class="effect-fallback">当前浏览器无法启动此效果。请确认已启用硬件加速，或切换到“点场”。</p>';
      if (status) status.textContent = `${EFFECTS[key].name} 启动失败：${error?.message || error}`;
    } finally {
      requestAnimationFrame(() => host.classList.remove("is-switching"));
    }
  };

  buttons.forEach((button, index) => {
    button.addEventListener("click", () => activate(button.dataset.effect));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      let next = index;
      if (event.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
      if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = buttons.length - 1;
      activate(buttons[next].dataset.effect, true);
    });
  });

  const observer = "IntersectionObserver" in window ? new IntersectionObserver(([entry]) => {
    sectionVisible = Boolean(entry?.isIntersecting);
    engine?.setVisible(sectionVisible);
  }, { threshold: 0.01 }) : null;
  observer?.observe(root);
  activate(buttons.find((button) => button.getAttribute("aria-selected") === "true")?.dataset.effect || "galaxy");
  const onMotionPreference = () => {
    if (!activeKey) return;
    const key = activeKey;
    activeKey = null;
    activate(key);
  };
  reducedMotion.addEventListener?.("change", onMotionPreference);

  const controller = {
    activate,
    get activeEffect() { return activeKey; },
    destroy() {
      observer?.disconnect();
      reducedMotion.removeEventListener?.("change", onMotionPreference);
      engine?.destroy();
      engine = null;
      debug.activeEffect = null;
      debug.liveEffects = 0;
    }
  };
  debug.visualLab = controller;
  return controller;
}

export { EFFECTS };
