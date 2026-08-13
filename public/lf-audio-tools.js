(function (global) {
  'use strict';

  var PROCESSOR_NAME = 'soundtouch-processor';
  var PROCESSOR_URL = '/vendor/soundtouchjs/soundtouch-processor-2.1.0.js';
  var installedContexts = new WeakMap();

  function clamp(value, min, max) {
    value = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
  }
  function codedError(code, message) {
    var error = new Error(message || code);
    error.code = code;
    return error;
  }
  function preservePitch(element) {
    if (!element) return;
    try { element.preservesPitch = true; } catch (_) {}
    try { element.mozPreservesPitch = true; } catch (_) {}
    try { element.webkitPreservesPitch = true; } catch (_) {}
  }
  async function installPitchWorklet(context, moduleUrl) {
    if (!context || !context.audioWorklet || typeof global.AudioWorkletNode !== 'function') {
      throw codedError('AUDIO_WORKLET_UNSUPPORTED', '当前运行环境不支持 AudioWorklet，未使用 playbackRate 冒充独立升降调。');
    }
    if (installedContexts.has(context)) return installedContexts.get(context);
    var loading = (async function () {
      await context.audioWorklet.addModule(String(moduleUrl || PROCESSOR_URL));
    })();
    installedContexts.set(context, loading);
    try { await loading; }
    catch (error) { installedContexts.delete(context); throw error; }
  }

  class LFAudioToolsEngine {
    constructor(options) {
      options = options || {};
      this.context = options.audioContext || null;
      this.mediaElement = options.mediaElement || null;
      this.sourceNode = options.sourceNode || null;
      this.destination = options.destination || null;
      this.moduleUrl = options.workletModuleUrl || PROCESSOR_URL;
      this.pitchNode = null;
      this.pitchParam = null;
      this.pitchRatioParam = null;
      this.playbackRateParam = null;
      this.pitchSemitones = 0;
      this.processorPlaybackRate = 1;
      this.speed = 1;
      this.connected = false;
    }

    setMediaElement(element) {
      this.mediaElement = element || null;
      if (this.mediaElement) {
        preservePitch(this.mediaElement);
        this.mediaElement.playbackRate = this.speed;
      }
      return this;
    }

    setSpeed(value) {
      var speed = clamp(value, 0.5, 2);
      this.speed = speed;
      if (!this.mediaElement) return { ok: false, error: 'MEDIA_ELEMENT_REQUIRED', speed: speed };
      preservePitch(this.mediaElement);
      this.mediaElement.playbackRate = speed;
      return { ok: true, speed: speed, preservesPitch: true };
    }

    async initializePitch(sourceNode, destination) {
      if (this.pitchNode) return { ok: true, node: this.pitchNode, algorithm: 'soundtouchjs-wsola-lanczos-audio-worklet' };
      if (!this.context) throw codedError('AUDIO_CONTEXT_REQUIRED');
      this.sourceNode = sourceNode || this.sourceNode;
      if (!this.sourceNode) throw codedError('AUDIO_SOURCE_REQUIRED', '必须复用播放器现有的音频源节点。');
      await installPitchWorklet(this.context, this.moduleUrl);
      var node = new AudioWorkletNode(this.context, PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'max',
        processorOptions: {
          sampleBufferType: 'circular',
          interpolationStrategy: 'lanczos',
        },
      });
      this.pitchParam = node.parameters.get('pitchSemitones') || null;
      this.pitchRatioParam = node.parameters.get('pitch') || null;
      this.playbackRateParam = node.parameters.get('playbackRate') || null;
      if (!this.pitchParam || !this.pitchRatioParam || !this.playbackRateParam) {
        try { node.disconnect(); node.port.close(); } catch (_) {}
        throw codedError('SOUNDTOUCH_PARAMETERS_MISSING');
      }
      this.pitchNode = node;
      this.setAudioParam(this.pitchRatioParam, 1, false);
      this.setAudioParam(this.playbackRateParam, this.processorPlaybackRate, false);
      this.setAudioParam(this.pitchParam, this.pitchSemitones, false);
      this.sourceNode.connect(node);
      node.connect(destination || this.destination || this.context.destination);
      this.connected = true;
      return { ok: true, node: node, algorithm: 'soundtouchjs-wsola-lanczos-audio-worklet', processor: PROCESSOR_NAME };
    }

    setAudioParam(param, value, smooth) {
      if (!param) return;
      var time = Number(this.context && this.context.currentTime) || 0;
      var target = Number(value);
      try {
        param.cancelScheduledValues(time);
        if (smooth !== false && typeof param.linearRampToValueAtTime === 'function') {
          param.setValueAtTime(Number(param.value) || target, time);
          param.linearRampToValueAtTime(target, time + 0.04);
        } else param.setValueAtTime(target, time);
      } catch (_) { param.value = target; }
    }

    async setPitch(value, playbackRate) {
      var semitones = clamp(value, -12, 12);
      var compensationRate = clamp(playbackRate == null ? 1 : playbackRate, 0.5, 2);
      this.pitchSemitones = semitones;
      this.processorPlaybackRate = compensationRate;
      if (!this.pitchNode) await this.initializePitch();
      this.setAudioParam(this.pitchRatioParam, 1, true);
      this.setAudioParam(this.playbackRateParam, compensationRate, true);
      this.setAudioParam(this.pitchParam, semitones, true);
      return {
        ok: true,
        semitones: semitones,
        ratio: Math.pow(2, semitones / 12),
        processorPlaybackRate: compensationRate,
        independentOfSpeed: true,
        algorithm: 'soundtouchjs-wsola-lanczos-audio-worklet',
      };
    }

    disconnect() {
      var time = Number(this.context && this.context.currentTime) || 0;
      [this.pitchParam, this.pitchRatioParam, this.playbackRateParam].forEach(function (param) {
        try { if (param) param.cancelScheduledValues(time); } catch (_) {}
      });
      try { if (this.sourceNode && this.pitchNode) this.sourceNode.disconnect(this.pitchNode); } catch (_) {}
      try { if (this.pitchNode) this.pitchNode.disconnect(); } catch (_) {}
      try { if (this.pitchNode && this.pitchNode.port) { this.pitchNode.port.onmessage = null; this.pitchNode.port.close(); } } catch (_) {}
      this.pitchNode = null;
      this.pitchParam = null;
      this.pitchRatioParam = null;
      this.playbackRateParam = null;
      this.connected = false;
    }
  }

  class LFStemMixer {
    constructor(options) {
      options = options || {};
      if (!options.audioContext) throw codedError('AUDIO_CONTEXT_REQUIRED');
      if (!options.vocalBuffer || !options.noVocalsBuffer) throw codedError('STEM_BUFFERS_REQUIRED');
      if (typeof options.audioContext.createBufferSource !== 'function') throw codedError('AUDIO_BUFFER_SOURCE_UNSUPPORTED');
      this.context = options.audioContext;
      this.vocalBuffer = options.vocalBuffer;
      this.noVocalsBuffer = options.noVocalsBuffer;
      this.duration = Math.max(0, Math.min(Number(this.vocalBuffer.duration) || 0, Number(this.noVocalsBuffer.duration) || 0));
      if (!this.duration) throw codedError('STEM_BUFFER_EMPTY');
      this.vocalGain = this.context.createGain();
      this.noVocalsGain = this.context.createGain();
      this.mixBus = this.context.createGain();
      this.vocalGain.connect(this.mixBus);
      this.noVocalsGain.connect(this.mixBus);
      this.destination = options.destination || this.context.destination;
      this.connected = false;
      if (options.autoConnect !== false) {
        this.mixBus.connect(this.destination);
        this.connected = true;
      }
      this.baseRate = 1;
      this.balance = 0;
      this.destroyed = false;
      this.playing = false;
      this.position = 0;
      this.startedAtContext = 0;
      this.generation = 0;
      this.vocalSource = null;
      this.noVocalsSource = null;
      this.setBalance(options.balance == null ? 0 : options.balance);
    }

    get currentTime() {
      if (!this.playing) return clamp(this.position, 0, this.duration);
      var elapsed = Math.max(0, this.context.currentTime - this.startedAtContext) * this.baseRate;
      return clamp(this.position + elapsed, 0, this.duration);
    }

    smoothGain(node, value) {
      var time = this.context.currentTime;
      try {
        node.gain.cancelScheduledValues(time);
        node.gain.setTargetAtTime(clamp(value, 0, 1), time, 0.015);
      } catch (_) { node.gain.value = clamp(value, 0, 1); }
    }

    setBalance(value) {
      var balance = clamp(value, -1, 1);
      // The centre position is the untouched original mix: both separated
      // tracks remain at unity. Moving away from centre only fades the
      // opposite component, so the control is continuous without a -3 dB
      // dip at "original".
      var vocalLevel = balance <= 0 ? 1 : 1 - balance;
      var noVocalsLevel = balance >= 0 ? 1 : 1 + balance;
      this.balance = balance;
      this.smoothGain(this.vocalGain, vocalLevel);
      this.smoothGain(this.noVocalsGain, noVocalsLevel);
      return { ok: true, balance: balance, vocalGain: vocalLevel, noVocalsGain: noVocalsLevel, originalAtCenter: true };
    }

    setLevels(vocal, noVocals) {
      var vocalLevel = clamp(vocal, 0, 1);
      var noVocalsLevel = clamp(noVocals, 0, 1);
      var normalization = Math.max(1, Math.hypot(vocalLevel, noVocalsLevel));
      vocalLevel /= normalization;
      noVocalsLevel /= normalization;
      this.smoothGain(this.vocalGain, vocalLevel);
      this.smoothGain(this.noVocalsGain, noVocalsLevel);
      return { ok: true, vocalGain: vocalLevel, noVocalsGain: noVocalsLevel, powerLimited: true };
    }

    stopSources() {
      this.generation += 1;
      [this.vocalSource, this.noVocalsSource].forEach(function (source) {
        if (!source) return;
        source.onended = null;
        try { source.stop(); } catch (_) {}
        try { source.disconnect(); } catch (_) {}
      });
      this.vocalSource = null;
      this.noVocalsSource = null;
    }

    sourceFor(buffer, gain, when, offset, generation, isClock) {
      var self = this;
      var source = this.context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.setValueAtTime(this.baseRate, when);
      source.connect(gain);
      if (isClock) {
        source.onended = function () {
          if (self.destroyed || self.generation !== generation || !self.playing) return;
          self.position = self.duration;
          self.playing = false;
          self.stopSources();
        };
      }
      source.start(when, offset);
      return source;
    }

    startSources(offset) {
      if (this.destroyed) return { ok: false, error: 'STEM_MIXER_DESTROYED' };
      offset = clamp(offset, 0, this.duration);
      this.stopSources();
      this.position = offset;
      if (offset >= this.duration - 0.001) {
        this.playing = false;
        return { ok: true, ended: true, currentTime: this.duration };
      }
      var when = this.context.currentTime + 0.008;
      var generation = ++this.generation;
      this.startedAtContext = when;
      this.playing = true;
      try {
        this.vocalSource = this.sourceFor(this.vocalBuffer, this.vocalGain, when, offset, generation, false);
        this.noVocalsSource = this.sourceFor(this.noVocalsBuffer, this.noVocalsGain, when, offset, generation, true);
        return { ok: true, currentTime: offset, scheduledAt: when };
      } catch (error) {
        this.playing = false;
        this.stopSources();
        return { ok: false, error: error && error.code || 'STEM_BUFFER_START_FAILED' };
      }
    }

    setPlaybackRate(value) {
      var position = this.currentTime;
      this.baseRate = clamp(value, 0.5, 2);
      this.position = position;
      this.startedAtContext = this.context.currentTime;
      [this.vocalSource, this.noVocalsSource].forEach((source) => {
        if (!source) return;
        try {
          source.playbackRate.cancelScheduledValues(this.context.currentTime);
          source.playbackRate.setValueAtTime(this.baseRate, this.context.currentTime);
        } catch (_) { source.playbackRate.value = this.baseRate; }
      });
      return { ok: true, speed: this.baseRate, preservesPitch: false, requiresPitchCompensation: true };
    }

    async play(atSeconds) {
      if (this.context.state === 'suspended') {
        try { await this.context.resume(); } catch (_) {}
      }
      var target = Number.isFinite(Number(atSeconds)) ? Number(atSeconds) : this.currentTime;
      return this.startSources(target);
    }

    pause() {
      if (!this.playing) return { ok: true, currentTime: this.currentTime };
      var position = this.currentTime;
      this.playing = false;
      this.position = position;
      this.stopSources();
      return { ok: true, currentTime: position };
    }

    seek(seconds) {
      var target = clamp(seconds, 0, this.duration);
      var wasPlaying = this.playing;
      this.playing = false;
      this.position = target;
      this.stopSources();
      if (wasPlaying) return this.startSources(target);
      return { ok: true, currentTime: target };
    }

    syncNow(force) {
      return { ok: !this.destroyed, idle: !this.playing, corrected: false, drift: 0, forced: !!force };
    }

    status() {
      return {
        ok: true,
        playing: this.playing,
        currentTime: this.currentTime,
        duration: this.duration,
        drift: 0,
        speed: this.baseRate,
        balance: this.balance,
        transport: 'audio-buffer-source',
      };
    }

    connect(destination) {
      try { this.mixBus.disconnect(); } catch (_) {}
      this.destination = destination || this.context.destination;
      this.mixBus.connect(this.destination);
      this.connected = true;
      return this.mixBus;
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.playing = false;
      this.stopSources();
      try { this.vocalGain.disconnect(); this.noVocalsGain.disconnect(); this.mixBus.disconnect(); } catch (_) {}
      this.vocalBuffer = null;
      this.noVocalsBuffer = null;
      this.connected = false;
    }
  }

  global.LFAudioTools = Object.freeze({
    Engine: LFAudioToolsEngine,
    StemMixer: LFStemMixer,
    installPitchWorklet: installPitchWorklet,
    createEngine: function (options) { return new LFAudioToolsEngine(options); },
    createStemMixer: function (options) { return new LFStemMixer(options); },
    limits: Object.freeze({ speed: Object.freeze([0.5, 2]), pitchSemitones: Object.freeze([-12, 12]) }),
    implementation: Object.freeze({
      pitch: 'SoundTouchJS 2.1.0 AudioWorklet WSOLA with Lanczos interpolation',
      accompaniment: 'decoded AudioBufferSourceNode dual-track event-driven transport',
      processor: PROCESSOR_NAME,
      processorUrl: PROCESSOR_URL,
      fakeEqSeparation: false,
    }),
  });
})(typeof window !== 'undefined' ? window : globalThis);
