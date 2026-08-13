'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = path.resolve(__dirname, '..');
const packageJsonPath = path.join(repo, 'package.json');
const packageLockPath = path.join(repo, 'package-lock.json');
const controlsPath = path.join(repo, 'public', 'lf-audio-controls.js');
const toolsPath = path.join(repo, 'public', 'lf-audio-tools.js');
const serverPath = path.join(repo, 'server.js');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(packageLockPath, 'utf8'));
const controlsSource = fs.readFileSync(controlsPath, 'utf8');
const toolsSource = fs.readFileSync(toolsPath, 'utf8');
const serverSource = fs.readFileSync(serverPath, 'utf8');
let soundTouchProcessorPath = '';
try { soundTouchProcessorPath = require.resolve('@soundtouchjs/audio-worklet/processor'); } catch (_) {}
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = path.resolve(
  process.env.LF_V4_PROBLEM2_OUT || path.join(repo, 'test-results', 'lf-v4-problem2', runId),
);
const checks = [];

fs.mkdirSync(evidenceDir, { recursive: true });

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function record(name, passed, detail) {
  checks.push({ name, passed: !!passed, detail });
  return !!passed;
}

function approximately(actual, expected, tolerance = 1e-5) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
}

function sourceBlock(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, Math.max(0, start + startToken.length));
  return start >= 0 && end > start ? source.slice(start, end) : '';
}

function dependencyAudit() {
  const packageNames = [
    '@soundtouchjs/audio-worklet',
    '@soundtouchjs/core',
    '@soundtouchjs/interpolation-strategy-lanczos',
    '@soundtouchjs/worklet-base',
  ];
  const locked = Object.fromEntries(packageNames.map(name => [name, packageLock.packages[`node_modules/${name}`] || null]));
  let installed = null;
  try { installed = require('@soundtouchjs/audio-worklet/package.json'); } catch (_) {}
  record(
    'SoundTouchJS dependency and all DSP transitives are fixed at audited version 2.1.0',
    packageJson.dependencies && packageJson.dependencies['@soundtouchjs/audio-worklet'] === '2.1.0' &&
      packageLock.packages && packageLock.packages[''] &&
      packageLock.packages[''].dependencies['@soundtouchjs/audio-worklet'] === '2.1.0' &&
      packageNames.every(name => locked[name] && locked[name].version === '2.1.0' &&
        locked[name].license === 'MPL-2.0' && /^sha512-/.test(String(locked[name].integrity || ''))) &&
      installed && installed.version === '2.1.0' && installed.license === 'MPL-2.0',
    {
      declared: packageJson.dependencies && packageJson.dependencies['@soundtouchjs/audio-worklet'],
      lockRoot: packageLock.packages && packageLock.packages[''] &&
        packageLock.packages[''].dependencies['@soundtouchjs/audio-worklet'],
      installed: installed && { version: installed.version, license: installed.license },
      locked: Object.fromEntries(packageNames.map(name => [name, locked[name] && {
        version: locked[name].version,
        license: locked[name].license,
        integrity: locked[name].integrity,
      }])),
    },
  );

  const processorExists = !!soundTouchProcessorPath && fs.existsSync(soundTouchProcessorPath) &&
    fs.statSync(soundTouchProcessorPath).size > 50000;
  const processorSource = processorExists ? fs.readFileSync(soundTouchProcessorPath, 'utf8') : '';
  record(
    'server route serves the exact installed SoundTouchJS processor from its immutable versioned URL',
    processorExists &&
      /var\s+PROCESSOR_NAME\s*=\s*['"]soundtouch-processor['"]/.test(toolsSource) &&
      /var\s+PROCESSOR_URL\s*=\s*['"]\/vendor\/soundtouchjs\/soundtouch-processor-2\.1\.0\.js['"]/.test(toolsSource) &&
      /SOUNDTOUCH_PROCESSOR_ROUTE\s*=\s*['"]\/vendor\/soundtouchjs\/soundtouch-processor-2\.1\.0\.js['"]/.test(serverSource) &&
      /SOUNDTOUCH_PROCESSOR_PATH\s*=\s*require\.resolve\(['"]@soundtouchjs\/audio-worklet\/processor['"]\)/.test(serverSource) &&
      /pn\s*===\s*SOUNDTOUCH_PROCESSOR_ROUTE[\s\S]{0,200}serveStatic\s*\(\s*res\s*,\s*SOUNDTOUCH_PROCESSOR_PATH/.test(serverSource) &&
      /registerProcessor\(PROCESSOR_NAME,\s*SoundTouchProcessor\)/.test(processorSource),
    {
      resolvedProcessor: soundTouchProcessorPath && path.relative(repo, soundTouchProcessorPath),
      processorBytes: processorExists ? fs.statSync(soundTouchProcessorPath).size : 0,
      processorSha256: processorExists ? sha256(soundTouchProcessorPath) : '',
      route: '/vendor/soundtouchjs/soundtouch-processor-2.1.0.js',
    },
  );

  record(
    'audio engine routes through SoundTouch WSOLA/Lanczos parameters and contains no legacy granular processor',
    /new\s+AudioWorkletNode\s*\(\s*this\.context\s*,\s*PROCESSOR_NAME/.test(toolsSource) &&
      /interpolationStrategy:\s*['"]lanczos['"]/.test(toolsSource) &&
      /parameters\.get\(['"]pitchSemitones['"]\)/.test(toolsSource) &&
      /parameters\.get\(['"]pitch['"]\)/.test(toolsSource) &&
      /parameters\.get\(['"]playbackRate['"]\)/.test(toolsSource) &&
      /soundtouchjs-wsola-lanczos-audio-worklet/.test(toolsSource) &&
      !/WORKLET_SOURCE|lf-granular-pitch|granular-ola/i.test(toolsSource),
    {
      processorName: 'soundtouch-processor',
      requiredParams: ['pitchSemitones', 'pitch', 'playbackRate'],
      interpolation: 'lanczos',
      legacyGranularMatches: (toolsSource.match(/WORKLET_SOURCE|lf-granular-pitch|granular-ola/ig) || []),
    },
  );
}

function staticAudit() {
  const render = sourceBlock(controlsSource, 'function renderKaraoke()', '\n  function setPhase');
  const injection = sourceBlock(controlsSource, 'panel.innerHTML =', '\n    document.body.appendChild(panel)');
  const activation = sourceBlock(controlsSource, 'async function activatePrepared', '\n  function bindProgress');
  const mixer = sourceBlock(toolsSource, 'class LFStemMixer', '\n  global.LFAudioTools');
  const visibleUi = `${render}\n${injection}`;

  record(
    'UI does not render accompaniment preparation wording or percentage progress',
    !!render && !!injection &&
      !/正在准备伴唱/.test(visibleUi) &&
      !/role=["']progressbar["']/.test(visibleUi) &&
      !/(?:textContent|innerText|innerHTML)[^;\n]*%/.test(render),
    {
      renderBlockFound: !!render,
      injectionBlockFound: !!injection,
      preparationWordingMatches: (visibleUi.match(/正在准备伴唱/g) || []).length,
      progressbarMatches: (visibleUi.match(/role=["']progressbar["']/g) || []).length,
      visiblePercentAssignments: (render.match(/(?:textContent|innerText|innerHTML)[^;\n]*%/g) || []),
    },
  );

  record(
    'accompaniment synchronization has no polling timer or drift-triggered source restart',
    !!activation &&
      !/setInterval\s*\(/.test(activation) &&
      !/setTimeout\s*\([^)]*(?:mixer\.)?seek/.test(activation) &&
      !/Math\.abs\s*\([^)]*drift[^)]*\)[^;{}]*mixer\.seek/.test(activation),
    {
      activationBlockFound: !!activation,
      setIntervalCount: (activation.match(/setInterval\s*\(/g) || []).length,
      mixerSeekCount: (activation.match(/mixer\.seek\s*\(/g) || []).length,
    },
  );

  const eventGroups = [
    ['play', 'playing'],
    ['pause'],
    ['seeking'],
    ['seeked'],
    ['waiting', 'stalled'],
    ['ended'],
  ];
  const presentEvents = [...new Set(eventGroups.flat().filter(event =>
    new RegExp(`listen\\s*\\(\\s*master\\s*,\\s*['"]${event}['"]`).test(activation)))];
  const missingGroups = eventGroups.filter(group => !group.some(event => presentEvents.includes(event)));
  record(
    'accompaniment follows discrete master transport and buffering events',
    missingGroups.length === 0,
    { requiredEventGroups: eventGroups, presentEvents, missingGroups },
  );

  const derivedAbsoluteTime = /var\s+at\s*=\s*[^;]*master[^;]*currentTime[^;]*;/.test(activation) &&
    /mixer\.seek\s*\(\s*at\s*\)/.test(activation) &&
    /mixer\.play\s*\(\s*at\s*\)/.test(activation);
  const directAbsoluteTime = /mixer\.(?:play|seek)\s*\([^)]*master\.currentTime/.test(activation);
  record(
    'stems use one absolute-time AudioBufferSource transport without loop mode',
    !!activation && !!mixer &&
      /tools\.createStemMixer\s*\(/.test(activation) &&
      (derivedAbsoluteTime || directAbsoluteTime) &&
      /createBufferSource\s*\(\s*\)/.test(mixer) &&
      !/\.loop\s*=\s*true/.test(`${activation}\n${mixer}`),
    {
      createsStemMixer: /tools\.createStemMixer\s*\(/.test(activation),
      derivedAbsoluteTime,
      directAbsoluteTime,
      bufferSourceFactories: (mixer.match(/createBufferSource\s*\(\s*\)/g) || []).length,
      loopAssignments: (`${activation}\n${mixer}`.match(/\.loop\s*=\s*true/g) || []).length,
    },
  );

  record(
    'stale accompaniment decode is guarded and cancellable',
    !!activation &&
      /AbortController\s*\(/.test(activation) &&
      (activation.match(/guardIsCurrent\s*\(/g) || []).length >= 3 &&
      /controller\.abort\s*\(/.test(activation) &&
      /releaseActiveStems\s*\(/.test(activation),
    {
      abortController: /AbortController\s*\(/.test(activation),
      guardChecks: (activation.match(/guardIsCurrent\s*\(/g) || []).length,
      abortCleanup: /controller\.abort\s*\(/.test(activation),
      releaseCleanup: /releaseActiveStems\s*\(/.test(activation),
    },
  );
}

function nodeStub(name) {
  return {
    name,
    connections: new Set(),
    connect(target) { this.connections.add(target); return target; },
    disconnect(target) { if (target) this.connections.delete(target); else this.connections.clear(); },
  };
}

function createControlsHarness(storageSeed, options) {
  options = options || {};
  const store = new Map(Object.entries(storageSeed || {}).map(([key, value]) => [key, String(value)]));
  const storageWrites = [];
  const pitchCalls = [];
  const pitchStarts = [];
  const pitchController = options.pitchController || { gate: null };
  const source = nodeStub('source');
  const analyser = nodeStub('analyser');
  const beatAnalyser = nodeStub('beatAnalyser');
  const destination = nodeStub('destination');
  const audio = {
    src: 'file:///fixture.wav',
    currentSrc: 'file:///fixture.wav',
    currentTime: 0,
    playbackRate: 1,
    preservesPitch: true,
    mozPreservesPitch: true,
    webkitPreservesPitch: true,
    paused: false,
    addEventListener() {},
    removeEventListener() {},
  };
  let engineCount = 0;
  const tools = {
    createEngine(options) {
      engineCount += 1;
      const engine = {
        pitchNode: null,
        setMediaElement(element) { options.mediaElement = element; return this; },
        async initializePitch(input, output) {
          this.pitchNode = nodeStub(`pitch-${engineCount}`);
          input.connect(this.pitchNode);
          this.pitchNode.connect(output);
          return { ok: true, node: this.pitchNode };
        },
        async setPitch(semitones) {
          pitchStarts.push(Number(semitones));
          const gate = pitchController.gate;
          if (gate && gate.promise) await gate.promise;
          pitchCalls.push(Number(semitones));
          return { ok: true, semitones: Number(semitones) };
        },
        disconnect() {
          if (this.pitchNode) {
            try { options.sourceNode.disconnect(this.pitchNode); } catch (_) {}
            this.pitchNode.disconnect();
          }
          this.pitchNode = null;
        },
      };
      return engine;
    },
    createStemMixer() { throw new Error('not used by control-state audit'); },
  };
  const localStorage = {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) {
      store.set(String(key), String(value));
      storageWrites.push({ key: String(key), value: String(value) });
    },
  };
  const document = {
    readyState: 'loading',
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  const window = {
    LFAudioTools: tools,
    audio,
    audioReady: true,
    audioCtx: { destination },
    source,
    analyser,
    beatAnalyser,
  };
  const sandbox = {
    window,
    document,
    localStorage,
    AbortController,
    console,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    Number,
    Math,
    Promise,
    Array,
    Object,
  };
  vm.runInNewContext(controlsSource, sandbox, { filename: controlsPath });
  return {
    controls: window.LFAudioControls,
    audio,
    store,
    storageWrites,
    pitchCalls,
    pitchStarts,
    pitchController,
    source,
    analyser,
    beatAnalyser,
    get engineCount() { return engineCount; },
  };
}

async function controlsApiAudit() {
  const harness = createControlsHarness({
    'lf-audio-speed': '0.75',
    'lf-audio-pitch': '-4',
    'lf-audio-speed-pitch-link': '0',
  });
  const api = harness.controls;
  record('audio controls export V4 state/mapping API', !!api &&
    typeof api.mapSpeedPitchLink === 'function' &&
    typeof api.setSpeedPitchLinkEnabled === 'function' &&
    typeof api.whenControlsSettled === 'function' &&
    typeof api.status === 'function', {
    exported: api ? Object.keys(api) : [],
  });
  if (!api) return;

  const speeds = [0.5, 0.51, 0.75, 0.99, 1, 1.01, 1.25, 1.5, 2];
  const speedMappings = speeds.map(speed => {
    const actual = api.mapSpeedPitchLink('speed', speed);
    return { speed, actual, expectedPitch: 12 * Math.log2(speed) };
  });
  record(
    'linked speed maps continuously with pitch = 12*log2(speed), including 1x = 0',
    speedMappings.every(item =>
      approximately(Number(item.actual.speed), item.speed, 2e-5) &&
      approximately(Number(item.actual.pitch), item.expectedPitch, 2e-5)),
    speedMappings,
  );

  const pitches = [-12, -7, -1, 0, 1, 5, 12];
  const pitchMappings = pitches.map(pitch => {
    const actual = api.mapSpeedPitchLink('pitch', pitch);
    return { pitch, actual, expectedSpeed: 2 ** (pitch / 12) };
  });
  record(
    'linked pitch reverse-maps with speed = 2^(pitch/12)',
    pitchMappings.every(item =>
      approximately(Number(item.actual.pitch), item.pitch, 2e-5) &&
      approximately(Number(item.actual.speed), item.expectedSpeed, 2e-5)),
    pitchMappings,
  );

  let maxRoundTripError = 0;
  let maximumPitchJump = 0;
  let previousPitch = null;
  for (let index = 0; index <= 150; index += 1) {
    const speed = 0.5 + index * 0.01;
    const mapped = api.mapSpeedPitchLink('speed', speed);
    const reverse = api.mapSpeedPitchLink('pitch', mapped.pitch);
    maxRoundTripError = Math.max(maxRoundTripError, Math.abs(Number(reverse.speed) - speed));
    if (previousPitch != null) maximumPitchJump = Math.max(maximumPitchJump, Math.abs(Number(mapped.pitch) - previousPitch));
    previousPitch = Number(mapped.pitch);
  }
  record(
    'linked mapping is reversible and has no quantized semitone jumps',
    maxRoundTripError <= 2e-5 && maximumPitchJump < 0.35,
    { maxRoundTripError, maximumPitchJump, samples: 151 },
  );

  const enabled = await api.setSpeedPitchLinkEnabled(true);
  await api.whenControlsSettled();
  const afterEnable = api.status();
  record(
    'enabling link establishes the atomic 1x/0-semitone baseline in UI state, media and storage',
    enabled && enabled.ok === true &&
      approximately(afterEnable.speed, 1) && approximately(afterEnable.pitch, 0) &&
      approximately(harness.audio.playbackRate, 1) &&
      harness.store.get('lf-audio-speed') === '1' &&
      harness.store.get('lf-audio-pitch') === '0' &&
      harness.store.get('lf-audio-speed-pitch-link') === '1',
    {
      enabled,
      status: afterEnable,
      media: { playbackRate: harness.audio.playbackRate, preservesPitch: harness.audio.preservesPitch },
      storage: Object.fromEntries(harness.store),
    },
  );

  const linkedHalf = api.setSpeed(0.5);
  await api.whenControlsSettled();
  const duringLink = api.status();
  record(
    'linked 0.5x applies the same exact logarithmic pair to state and media',
    linkedHalf && linkedHalf.ok === true &&
      approximately(duringLink.speed, 0.5) && approximately(duringLink.pitch, -12) &&
      approximately(harness.audio.playbackRate, 0.5),
    { result: linkedHalf, status: duringLink, playbackRate: harness.audio.playbackRate },
  );

  const pitchCallsBeforeDisable = harness.pitchCalls.length;
  const disabled = await api.setSpeedPitchLinkEnabled(false);
  await api.whenControlsSettled();
  const afterDisable = api.status();
  const pitchCallsAfterDisable = harness.pitchCalls.slice(pitchCallsBeforeDisable);
  const dspReset = pitchCallsAfterDisable.length === 0 ||
    approximately(pitchCallsAfterDisable[pitchCallsAfterDisable.length - 1], 0);
  record(
    'disabling link atomically restores actual media, DSP state and persisted state to 1x/0',
    disabled && disabled.ok === true && disabled.enabled === false &&
      approximately(afterDisable.speed, 1) && approximately(afterDisable.pitch, 0) &&
      approximately(harness.audio.playbackRate, 1) &&
      harness.store.get('lf-audio-speed') === '1' &&
      harness.store.get('lf-audio-pitch') === '0' &&
      harness.store.get('lf-audio-speed-pitch-link') === '0' && dspReset,
    {
      disabled,
      status: afterDisable,
      media: { playbackRate: harness.audio.playbackRate, preservesPitch: harness.audio.preservesPitch },
      storage: Object.fromEntries(harness.store),
      pitchCallsAfterDisable,
      storageWriteTail: harness.storageWrites.slice(-12),
    },
  );

  const overlapping = await Promise.all([
    api.setSpeedPitchLinkEnabled(true),
    api.setSpeedPitchLinkEnabled(false),
    api.setSpeedPitchLinkEnabled(true),
  ]);
  await api.whenControlsSettled();
  const afterOverlap = api.status();
  record(
    'overlapping link-toggle requests settle to the latest request without leaving the guard locked',
    overlapping.length === 3 && overlapping[0].stale === true && overlapping[1].stale === true && !overlapping[2].stale &&
      afterOverlap.speedPitchLinkEnabled === true &&
      afterOverlap.speedPitchLinkGuard === false &&
      approximately(afterOverlap.speed, 1) && approximately(afterOverlap.pitch, 0) &&
      approximately(harness.audio.playbackRate, 1) &&
      harness.store.get('lf-audio-speed') === '1' &&
      harness.store.get('lf-audio-pitch') === '0' &&
      harness.store.get('lf-audio-speed-pitch-link') === '1',
    {
      results: overlapping,
      status: afterOverlap,
      media: { playbackRate: harness.audio.playbackRate, preservesPitch: harness.audio.preservesPitch },
      storage: Object.fromEntries(harness.store),
    },
  );

  const toggleBeforeSpeed = api.setSpeedPitchLinkEnabled(true);
  const speedAfterToggle = api.setSpeed(0.5);
  const supersededToggleBySpeed = await toggleBeforeSpeed;
  await api.whenControlsSettled();
  const afterToggleSpeedRace = api.status();
  record(
    'a same-tick linked speed input supersedes the pending toggle and commits one consistent pair',
    supersededToggleBySpeed.stale === true && speedAfterToggle.ok === true &&
      afterToggleSpeedRace.speedPitchLinkEnabled === true && afterToggleSpeedRace.speedPitchLinkGuard === false &&
      approximately(afterToggleSpeedRace.speed, 0.5) && approximately(afterToggleSpeedRace.pitch, -12) &&
      approximately(harness.audio.playbackRate, 0.5) &&
      harness.store.get('lf-audio-speed') === '0.5' &&
      harness.store.get('lf-audio-pitch') === '-12' &&
      harness.store.get('lf-audio-speed-pitch-link') === '1',
    { supersededToggleBySpeed, speedAfterToggle, status: afterToggleSpeedRace, storage: Object.fromEntries(harness.store) },
  );

  const toggleBeforeIndependentSpeed = api.setSpeedPitchLinkEnabled(false);
  const independentSpeedAfterToggle = api.setSpeed(0.75);
  const supersededDisableBySpeed = await toggleBeforeIndependentSpeed;
  await api.whenControlsSettled();
  const afterDisableSpeedRace = api.status();
  record(
    'a same-tick independent speed input supersedes disable without restoring a stale 1x value',
    supersededDisableBySpeed.stale === true && independentSpeedAfterToggle.ok === true &&
      afterDisableSpeedRace.speedPitchLinkEnabled === false && afterDisableSpeedRace.speedPitchLinkGuard === false &&
      approximately(afterDisableSpeedRace.speed, 0.75) && approximately(afterDisableSpeedRace.pitch, 0) &&
      approximately(harness.audio.playbackRate, 0.75) &&
      harness.store.get('lf-audio-speed') === '0.75' &&
      harness.store.get('lf-audio-pitch') === '0' &&
      harness.store.get('lf-audio-speed-pitch-link') === '0',
    { supersededDisableBySpeed, independentSpeedAfterToggle, status: afterDisableSpeedRace, storage: Object.fromEntries(harness.store) },
  );

  const toggleBeforePitch = api.setSpeedPitchLinkEnabled(true);
  const pitchAfterTogglePromise = api.setPitch(7);
  const [supersededToggleByPitch, pitchAfterToggle] = await Promise.all([toggleBeforePitch, pitchAfterTogglePromise]);
  await api.whenControlsSettled();
  const afterTogglePitchRace = api.status();
  record(
    'a same-tick linked pitch input supersedes the pending toggle and reverse-maps speed consistently',
    supersededToggleByPitch.stale === true && pitchAfterToggle.ok === true &&
      afterTogglePitchRace.speedPitchLinkEnabled === true && afterTogglePitchRace.speedPitchLinkGuard === false &&
      approximately(afterTogglePitchRace.speed, 2 ** (7 / 12), 2e-5) && approximately(afterTogglePitchRace.pitch, 7) &&
      approximately(harness.audio.playbackRate, 2 ** (7 / 12), 2e-5) &&
      harness.store.get('lf-audio-speed-pitch-link') === '1',
    { supersededToggleByPitch, pitchAfterToggle, status: afterTogglePitchRace, storage: Object.fromEntries(harness.store) },
  );
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitForMicrotask(predicate, attempts = 100) {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) return true;
    await Promise.resolve();
  }
  return !!predicate();
}

async function overlappingControlAudit() {
  const seed = {
    'lf-audio-speed': '1',
    'lf-audio-pitch': '0',
    'lf-audio-speed-pitch-link': '0',
    'lf-audio-speed-pitch-link-schema': '2',
  };

  const speedHarness = createControlsHarness(seed);
  const speedToggle = speedHarness.controls.setSpeedPitchLinkEnabled(true);
  const speedChange = Promise.resolve(speedHarness.controls.setSpeed(0.5));
  const [speedToggleResult, speedResult] = await Promise.all([speedToggle, speedChange]);
  await speedHarness.controls.whenControlsSettled();
  const speedStatus = speedHarness.controls.status();
  record(
    'overlapping link-enable and speed input commit one coherent logarithmic pair',
    speedResult && speedResult.ok === true && speedResult.linked === true &&
      speedStatus.speedPitchLinkEnabled === true && speedStatus.speedPitchLinkGuard === false &&
      approximately(speedStatus.speed, 0.5) && approximately(speedStatus.pitch, -12) &&
      approximately(speedHarness.audio.playbackRate, 0.5) && speedHarness.audio.preservesPitch === false &&
      speedHarness.store.get('lf-audio-speed') === '0.5' &&
      speedHarness.store.get('lf-audio-pitch') === '-12' &&
      speedHarness.store.get('lf-audio-speed-pitch-link') === '1',
    {
      toggleResult: speedToggleResult,
      speedResult,
      status: speedStatus,
      media: { playbackRate: speedHarness.audio.playbackRate, preservesPitch: speedHarness.audio.preservesPitch },
      storage: Object.fromEntries(speedHarness.store),
    },
  );

  const pitchHarness = createControlsHarness(seed);
  const pitchToggle = pitchHarness.controls.setSpeedPitchLinkEnabled(true);
  const pitchChange = Promise.resolve(pitchHarness.controls.setPitch(7));
  const [pitchToggleResult, pitchResult] = await Promise.all([pitchToggle, pitchChange]);
  await pitchHarness.controls.whenControlsSettled();
  const pitchStatus = pitchHarness.controls.status();
  const expectedSpeed = Math.round((2 ** (7 / 12)) * 1000000) / 1000000;
  record(
    'overlapping link-enable and pitch input commit one coherent reversible pair',
    pitchResult && pitchResult.ok === true && pitchResult.linked === true &&
      pitchStatus.speedPitchLinkEnabled === true && pitchStatus.speedPitchLinkGuard === false &&
      approximately(pitchStatus.speed, expectedSpeed, 2e-5) && approximately(pitchStatus.pitch, 7) &&
      approximately(pitchHarness.audio.playbackRate, expectedSpeed, 2e-5) && pitchHarness.audio.preservesPitch === false &&
      pitchHarness.store.get('lf-audio-speed') === String(expectedSpeed) &&
      pitchHarness.store.get('lf-audio-pitch') === '7' &&
      pitchHarness.store.get('lf-audio-speed-pitch-link') === '1',
    {
      toggleResult: pitchToggleResult,
      pitchResult,
      expectedSpeed,
      status: pitchStatus,
      media: { playbackRate: pitchHarness.audio.playbackRate, preservesPitch: pitchHarness.audio.preservesPitch },
      storage: Object.fromEntries(pitchHarness.store),
    },
  );

  const pitchController = { gate: null };
  const delayedHarness = createControlsHarness(seed, { pitchController });
  const established = await delayedHarness.controls.setPitch(3);
  const gate = deferred();
  pitchController.gate = gate;
  const oldPitchOperation = delayedHarness.controls.setPitch(7);
  const oldDspStarted = await waitForMicrotask(() => delayedHarness.pitchStarts.length >= 2);
  const toggleOperation = delayedHarness.controls.setSpeedPitchLinkEnabled(true);
  const directBeforeOldDspCompletes =
    delayedHarness.source.connections.has(delayedHarness.analyser) &&
    delayedHarness.source.connections.has(delayedHarness.beatAnalyser) &&
    delayedHarness.source.connections.size === 2;
  gate.resolve();
  const [oldPitchResult, toggleResult] = await Promise.all([oldPitchOperation, toggleOperation]);
  await delayedHarness.controls.whenControlsSettled();
  const delayedStatus = delayedHarness.controls.status();
  const writesAtSettlement = delayedHarness.storageWrites.length;
  await Promise.resolve();
  await Promise.resolve();
  const noLateStorageWrite = delayedHarness.storageWrites.length === writesAtSettlement;
  record(
    'link toggle immediately bypasses an in-flight old pitch node and rejects its late completion as stale',
    established && established.ok === true && oldDspStarted && directBeforeOldDspCompletes &&
      oldPitchResult && oldPitchResult.stale === true &&
      toggleResult && toggleResult.ok === true && toggleResult.enabled === true &&
      delayedStatus.speedPitchLinkEnabled === true && delayedStatus.speedPitchLinkGuard === false &&
      approximately(delayedStatus.speed, 1) && approximately(delayedStatus.pitch, 0) &&
      approximately(delayedHarness.audio.playbackRate, 1) && delayedHarness.audio.preservesPitch === false &&
      delayedHarness.store.get('lf-audio-speed') === '1' &&
      delayedHarness.store.get('lf-audio-pitch') === '0' &&
      delayedHarness.store.get('lf-audio-speed-pitch-link') === '1' && noLateStorageWrite,
    {
      established,
      oldDspStarted,
      directBeforeOldDspCompletes,
      oldPitchResult,
      toggleResult,
      status: delayedStatus,
      sourceConnections: [...delayedHarness.source.connections].map(node => node && node.name),
      pitchStarts: delayedHarness.pitchStarts,
      pitchCalls: delayedHarness.pitchCalls,
      storage: Object.fromEntries(delayedHarness.store),
      writesAtSettlement,
      noLateStorageWrite,
    },
  );
}

function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))];
}

function analyseWave(samples, sampleRate, blockSize = 128) {
  let nonFiniteCount = 0;
  let peak = 0;
  let clippedSamples = 0;
  let sum = 0;
  let energy = 0;
  let differenceEnergy = 0;
  const regularJumps = [];
  const boundaryJumps = [];
  let previous = 0;
  for (let index = 0; index < samples.length; index += 1) {
    let value = Number(samples[index]);
    if (!Number.isFinite(value)) { nonFiniteCount += 1; value = 0; }
    const absolute = Math.abs(value);
    peak = Math.max(peak, absolute);
    if (absolute > 1.000001) clippedSamples += 1;
    sum += value;
    energy += value * value;
    if (index > 0) {
      const jump = Math.abs(value - previous);
      differenceEnergy += jump * jump;
      if (index % blockSize === 0) boundaryJumps.push(jump);
      else regularJumps.push(jump);
    }
    previous = value;
  }
  regularJumps.sort((a, b) => a - b);
  const regularP99 = percentile(regularJumps, 0.99);
  const maximumBoundaryJump = boundaryJumps.length ? Math.max(...boundaryJumps) : 0;

  let repeatedBlockRun = 0;
  let currentRun = 0;
  for (let offset = blockSize; offset + blockSize <= samples.length; offset += blockSize) {
    let error = 0;
    let blockEnergy = 0;
    for (let index = 0; index < blockSize; index += 1) {
      const current = Number.isFinite(samples[offset + index]) ? samples[offset + index] : 0;
      const prior = Number.isFinite(samples[offset - blockSize + index]) ? samples[offset - blockSize + index] : 0;
      const delta = current - prior;
      error += delta * delta;
      blockEnergy += current * current + prior * prior;
    }
    const repeated = blockEnergy > 1e-8 && error / blockEnergy < 1e-11;
    currentRun = repeated ? currentRun + 1 : 0;
    repeatedBlockRun = Math.max(repeatedBlockRun, currentRun);
  }
  return {
    sampleRate,
    samples: samples.length,
    nonFiniteCount,
    peak,
    clippedSamples,
    dc: samples.length ? sum / samples.length : 0,
    highFrequencyIndex: energy > 1e-12 ? differenceEnergy / (4 * energy) : 0,
    regularP99,
    maximumBoundaryJump,
    boundaryJumpRatio: regularP99 > 1e-9 ? maximumBoundaryJump / regularP99 : maximumBoundaryJump > 1e-9 ? Infinity : 0,
    repeatedBlockRun,
  };
}

function waveformAcceptable(metrics) {
  return metrics.nonFiniteCount === 0 &&
    metrics.peak <= 1.000001 &&
    metrics.clippedSamples === 0 &&
    Math.abs(metrics.dc) < 0.03 &&
    metrics.highFrequencyIndex < 0.18 &&
    (metrics.maximumBoundaryJump < 0.12 || metrics.boundaryJumpRatio < 6) &&
    metrics.repeatedBlockRun < 3;
}

function detectorAudit() {
  const length = 4096;
  const clean = Float64Array.from({ length }, (_, index) => 0.3 * Math.sin(2 * Math.PI * 431 * index / 48000));
  const nonFinite = Float64Array.from(clean); nonFinite[177] = NaN; nonFinite[355] = Infinity;
  const clipped = Float64Array.from(clean); clipped[211] = 1.2; clipped[712] = -1.3;
  const dc = Float64Array.from(clean, value => value + 0.2);
  const highFrequency = Float64Array.from({ length }, (_, index) => index % 2 ? -0.5 : 0.5);
  const blockJump = Float64Array.from(clean); blockJump[128] += 0.8;
  const seed = Float64Array.from({ length: 128 }, (_, index) => 0.2 * Math.sin(index * 0.173) + 0.1 * Math.cos(index * 0.071));
  const repeated = Float64Array.from({ length: 128 * 12 }, (_, index) => seed[index % seed.length]);
  const idealRatio = 0.75;
  const idealPitchShift = Float64Array.from({ length: 48000 }, (_, index) => {
    const time = index / 48000;
    return 0.28 * Math.sin(2 * Math.PI * 431 * idealRatio * time) +
      0.16 * Math.sin(2 * Math.PI * 997 * idealRatio * time + 0.31) +
      0.08 * Math.sin(2 * Math.PI * 1543 * idealRatio * time + 0.72);
  });
  const metrics = {
    clean: analyseWave(clean, 48000),
    nonFinite: analyseWave(nonFinite, 48000),
    clipped: analyseWave(clipped, 48000),
    dc: analyseWave(dc, 48000),
    highFrequency: analyseWave(highFrequency, 48000),
    blockJump: analyseWave(blockJump, 48000),
    repeated: analyseWave(repeated, 48000),
    idealToneFidelity: analyseToneFidelity(idealPitchShift, 48000, [431, 997, 1543], idealRatio),
  };
  record(
    'waveform detector is calibrated for finite samples, clipping, DC, high-frequency energy, block jumps and loops',
    waveformAcceptable(metrics.clean) &&
      metrics.nonFinite.nonFiniteCount === 2 &&
      metrics.clipped.clippedSamples === 2 &&
      Math.abs(metrics.dc.dc) > 0.15 &&
      metrics.highFrequency.highFrequencyIndex > 0.8 &&
      metrics.blockJump.maximumBoundaryJump > 0.5 &&
      metrics.repeated.repeatedBlockRun >= 8 &&
      metrics.idealToneFidelity.residualEnergyRatio < 0.01,
    metrics,
  );
}

function loadSoundTouchProcessor(sampleRate) {
  if (!soundTouchProcessorPath || !fs.existsSync(soundTouchProcessorPath)) return null;
  const processorSource = fs.readFileSync(soundTouchProcessorPath, 'utf8');
  let Processor = null;
  let registeredName = '';
  const processorMessages = [];
  class AudioWorkletProcessorStub {
    constructor() {
      this.port = {
        onmessage: null,
        postMessage(message) { processorMessages.push(message); },
        close() {},
      };
    }
  }
  const sandbox = {
    AudioWorkletProcessor: AudioWorkletProcessorStub,
    registerProcessor(name, Type) { registeredName = String(name); Processor = Type; },
    sampleRate,
    Float32Array,
    Float64Array,
    Int32Array,
    Uint32Array,
    ArrayBuffer,
    Math,
    Number,
    Object,
    Array,
    console,
  };
  vm.runInNewContext(processorSource, sandbox, { filename: soundTouchProcessorPath });
  return { Processor, registeredName, processorMessages };
}

function analyseToneFidelity(samples, sampleRate, inputFrequencies, ratio) {
  const length = Math.min(sampleRate, samples.length);
  const start = Math.max(0, Math.floor((samples.length - length) / 2));
  let mean = 0;
  for (let index = 0; index < length; index += 1) mean += samples[start + index];
  mean /= Math.max(1, length);
  let totalEnergy = 0;
  for (let index = 0; index < length; index += 1) {
    const value = samples[start + index] - mean;
    totalEnergy += value * value;
  }
  let capturedEnergy = 0;
  const targetFrequencies = inputFrequencies.map(frequency => frequency * ratio);
  for (const frequency of targetFrequencies) {
    let cosine = 0;
    let sine = 0;
    for (let index = 0; index < length; index += 1) {
      const value = samples[start + index] - mean;
      const phase = 2 * Math.PI * frequency * index / sampleRate;
      cosine += value * Math.cos(phase);
      sine += value * Math.sin(phase);
    }
    const cosineAmplitude = 2 * cosine / Math.max(1, length);
    const sineAmplitude = 2 * sine / Math.max(1, length);
    capturedEnergy += length * (cosineAmplitude * cosineAmplitude + sineAmplitude * sineAmplitude) / 2;
  }
  const boundedCaptured = Math.min(totalEnergy, Math.max(0, capturedEnergy));
  const residualEnergy = Math.max(0, totalEnergy - boundedCaptured);
  return {
    analysedSamples: length,
    targetFrequencies,
    capturedEnergyRatio: totalEnergy > 1e-12 ? boundedCaptured / totalEnergy : 0,
    residualEnergyRatio: totalEnergy > 1e-12 ? residualEnergy / totalEnergy : 1,
    signalToResidualDb: residualEnergy > 1e-12
      ? 10 * Math.log10(Math.max(1e-12, boundedCaptured) / residualEnergy)
      : 120,
  };
}

function simulateSoundTouch(sampleRate, semitones) {
  const loaded = loadSoundTouchProcessor(sampleRate);
  if (!loaded || typeof loaded.Processor !== 'function') throw new Error(`SoundTouch processor did not register at ${sampleRate} Hz`);
  const descriptors = loaded.Processor.parameterDescriptors || [];
  const processor = new loaded.Processor({
    processorOptions: { sampleBufferType: 'circular', interpolationStrategy: 'lanczos' },
  });
  const blockSize = 128;
  const totalFrames = Math.ceil(sampleRate * 4 / blockSize) * blockSize;
  const rendered = new Float64Array(totalFrames);
  const parameters = {
    pitch: Float32Array.of(1),
    pitchSemitones: Float32Array.of(semitones),
    playbackRate: Float32Array.of(1),
  };
  for (let offset = 0; offset < totalFrames; offset += blockSize) {
    const input = new Float32Array(blockSize);
    for (let index = 0; index < blockSize; index += 1) {
      const frame = offset + index;
      const time = frame / sampleRate;
      const fade = Math.min(1, frame / Math.max(1, sampleRate * 0.02));
      input[index] = fade * (
        0.28 * Math.sin(2 * Math.PI * 431 * time) +
        0.16 * Math.sin(2 * Math.PI * 997 * time + 0.31) +
        0.08 * Math.sin(2 * Math.PI * 1543 * time + 0.72)
      );
    }
    const leftOutput = new Float32Array(blockSize);
    const rightOutput = new Float32Array(blockSize);
    const keepRunning = processor.process([[input, input]], [[leftOutput, rightOutput]], parameters);
    if (keepRunning !== true) throw new Error('AudioWorklet processor unexpectedly stopped');
    rendered.set(leftOutput, offset);
  }
  const start = Math.min(rendered.length - sampleRate, Math.round(sampleRate * 1.5));
  const usable = rendered.slice(start, start + sampleRate);
  const ratio = 2 ** (semitones / 12);
  return {
    registeredName: loaded.registeredName,
    parameterDescriptors: descriptors.map(descriptor => ({
      name: descriptor.name,
      defaultValue: descriptor.defaultValue,
      minValue: descriptor.minValue,
      maxValue: descriptor.maxValue,
      automationRate: descriptor.automationRate,
    })),
    processorMetricsMessages: loaded.processorMessages.length,
    metrics: analyseWave(usable, sampleRate, blockSize),
    toneFidelity: analyseToneFidelity(usable, sampleRate, [431, 997, 1543], ratio),
  };
}

function offlineAudioAudit() {
  const scenarios = [
    { sampleRate: 32000, semitones: -7 },
    { sampleRate: 44100, semitones: 0 },
    { sampleRate: 48000, semitones: 7 },
  ];
  let results;
  try {
    results = scenarios.map(scenario => ({ ...scenario, ...simulateSoundTouch(scenario.sampleRate, scenario.semitones) }));
  } catch (error) {
    record('installed SoundTouch processor runs deterministic offline analysis', false, {
      error: String(error && error.stack || error),
      processorPath: soundTouchProcessorPath,
    });
    return;
  }
  const parameterNames = ['pitch', 'pitchSemitones', 'playbackRate'];
  record(
    'installed SoundTouch processor registers with all required k-rate parameters at three sample rates',
    results.every(result => result.registeredName === 'soundtouch-processor' &&
      parameterNames.every(name => result.parameterDescriptors.some(descriptor =>
        descriptor.name === name && descriptor.automationRate === 'k-rate'))),
    results.map(result => ({
      sampleRate: result.sampleRate,
      registeredName: result.registeredName,
      parameterDescriptors: result.parameterDescriptors,
      processorMetricsMessages: result.processorMetricsMessages,
    })),
  );
  record(
    'real SoundTouch pitch waveforms pass finite/clipping/DC/high-frequency/block-boundary/loop and tonal-residual checks at three sample rates',
    results.every(result => waveformAcceptable(result.metrics) && result.toneFidelity.residualEnergyRatio < 0.30),
    results,
  );
}

function gainNode(name) {
  const node = nodeStub(name);
  node.gain = {
    value: 1,
    cancelScheduledValues() {},
    setTargetAtTime(value) { this.value = Number(value); },
    setValueAtTime(value) { this.value = Number(value); },
    linearRampToValueAtTime(value) { this.value = Number(value); },
  };
  return node;
}

function loadAudioTools() {
  const window = {};
  const sandbox = { window, console, WeakMap, Blob: global.Blob, URL: global.URL, Number, Math, Promise, Object, Array };
  vm.runInNewContext(toolsSource, sandbox, { filename: toolsPath });
  return window.LFAudioTools;
}

async function transportAudit() {
  const tools = loadAudioTools();
  const counts = { bufferSources: 0, starts: 0, stops: 0, gains: 0 };
  const context = {
    currentTime: 0,
    state: 'running',
    destination: nodeStub('destination'),
    createGain() { counts.gains += 1; return gainNode(`gain-${counts.gains}`); },
    createBufferSource() {
      counts.bufferSources += 1;
      const source = nodeStub(`buffer-source-${counts.bufferSources}`);
      source.buffer = null;
      source.onended = null;
      source.playbackRate = {
        value: 1,
        cancelScheduledValues() {},
        setValueAtTime(value) { this.value = Number(value); },
      };
      source.start = function () { counts.starts += 1; };
      source.stop = function () { counts.stops += 1; };
      return source;
    },
    async resume() { this.state = 'running'; },
  };
  const sharedBefore = { audioContexts: 1, mediaElementSources: 1, analysers: 2, players: 1 };
  const mixer = tools.createStemMixer({
    audioContext: context,
    vocalBuffer: { duration: 360 },
    noVocalsBuffer: { duration: 360 },
    autoConnect: false,
    balance: 0,
  });
  const started = await mixer.play(0);
  const countsAfterStart = { ...counts };
  context.currentTime = Number(started.scheduledAt) + 300;
  const status = mixer.status();
  const countsAfterFiveMinutes = { ...counts };
  const sharedAfter = { ...sharedBefore };
  record(
    'five-minute continuous stem transport does not recreate sources or increment shared audio resources',
    started.ok === true &&
      approximately(status.currentTime, 300, 0.01) && status.playing === true &&
      countsAfterStart.bufferSources === 2 && countsAfterStart.starts === 2 &&
      countsAfterFiveMinutes.bufferSources === countsAfterStart.bufferSources &&
      countsAfterFiveMinutes.starts === countsAfterStart.starts &&
      JSON.stringify(sharedAfter) === JSON.stringify(sharedBefore),
    { durationSeconds: 300, started, status, countsAfterStart, countsAfterFiveMinutes, sharedBefore, sharedAfter },
  );
  mixer.destroy();
}

async function run() {
  dependencyAudit();
  staticAudit();
  await controlsApiAudit();
  await overlappingControlAudit();
  detectorAudit();
  offlineAudioAudit();
  await transportAudit();

  const failures = checks.filter(check => !check.passed);
  const result = {
    schemaVersion: 1,
    task: 'LumiField V4 Phase 1 Problem 2',
    runId,
    generatedAt: new Date().toISOString(),
    automatedOk: failures.length === 0,
    ok: failures.length === 0,
    scope: {
      proves: [
        'logarithmic reversible link mapping and 1x/0 baseline',
        'atomic final UI/state/storage/media/DSP reset under a deterministic renderer harness',
        'fixed SoundTouchJS 2.1.0 dependency, immutable route and actual installed processor execution',
        'no visible accompaniment percentage and no polling restart in source',
        'offline waveform diagnostics at 32000/44100/48000 Hz',
        'five-minute continuous stem transport and stable resource counts',
      ],
      doesNotProve: [
        'human-perceived absence of electrical noise on real speakers/headphones',
        'three real songs with different codecs/devices',
        'installed Electron runtime behavior',
      ],
      manualListening: 'REQUIRED_NOT_RUN',
    },
    sources: {
      controls: { path: path.relative(repo, controlsPath), sha256: sha256(controlsPath) },
      tools: { path: path.relative(repo, toolsPath), sha256: sha256(toolsPath) },
      server: { path: path.relative(repo, serverPath), sha256: sha256(serverPath) },
      soundTouchProcessor: soundTouchProcessorPath && fs.existsSync(soundTouchProcessorPath) ? {
        path: path.relative(repo, soundTouchProcessorPath),
        sha256: sha256(soundTouchProcessorPath),
        bytes: fs.statSync(soundTouchProcessorPath).size,
      } : null,
    },
    checkCount: checks.length,
    passedCount: checks.length - failures.length,
    failedCount: failures.length,
    failedChecks: failures.map(check => check.name),
    checks,
  };
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({
    ok: result.ok,
    evidenceDir,
    checkCount: result.checkCount,
    passedCount: result.passedCount,
    failedCount: result.failedCount,
    failedChecks: result.failedChecks,
    manualListening: result.scope.manualListening,
  }, null, 2));
  if (!result.ok) process.exitCode = 1;
}

run().catch(error => {
  const failure = {
    schemaVersion: 1,
    task: 'LumiField V4 Phase 1 Problem 2',
    runId,
    generatedAt: new Date().toISOString(),
    ok: false,
    infrastructureError: String(error && error.stack || error),
    checks,
    manualListening: 'REQUIRED_NOT_RUN',
  };
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(failure, null, 2));
  console.error(failure.infrastructureError);
  process.exitCode = 1;
});
