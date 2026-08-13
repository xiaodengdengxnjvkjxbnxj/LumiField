'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function fail(code, message) {
  const error = new Error(message || code);
  error.code = code;
  throw error;
}

function progress(percent, phase) {
  fs.writeSync(1, `LF_PROGRESS ${Math.max(0, Math.min(100, Math.round(percent)))} ${phase}\n`);
}

function parseArgs(argv) {
  const result = {};
  for (let i = 2; i < argv.length; i += 2) {
    const name = String(argv[i] || '');
    if (!name.startsWith('--') || i + 1 >= argv.length) fail('INVALID_WORKER_ARGUMENTS');
    result[name.slice(2)] = String(argv[i + 1]);
  }
  return result;
}

function requireFile(candidate, code) {
  if (!candidate || !path.isAbsolute(candidate)) fail(code);
  try {
    if (fs.statSync(candidate).isFile()) return path.resolve(candidate);
  } catch (_) {}
  fail(code);
}

function requireDirectory(candidate, code) {
  if (!candidate || !path.isAbsolute(candidate)) fail(code);
  try {
    if (fs.statSync(candidate).isDirectory()) return path.resolve(candidate);
  } catch (_) {}
  fail(code);
}

function verifySha256(filename, expected, code) {
  const digest = crypto.createHash('sha256');
  const handle = fs.openSync(filename, 'r');
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const bytes = fs.readSync(handle, chunk, 0, chunk.length, null);
      if (!bytes) break;
      digest.update(chunk.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(handle);
  }
  if (digest.digest('hex') !== expected) fail(code);
}

function findWaveChunks(data) {
  if (data.length < 44 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }
  let fmt = null;
  let pcm = null;
  for (let offset = 12; offset + 8 <= data.length;) {
    const id = data.toString('ascii', offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > data.length) fail('INVALID_WAV_FILE', 'WAV chunk exceeds file size');
    if (id === 'fmt ') fmt = { start, size };
    if (id === 'data') pcm = { start, size };
    offset = start + size + (size & 1);
  }
  if (!fmt || fmt.size < 16 || !pcm || pcm.size === 0) fail('INVALID_WAV_FILE', 'WAV fmt/data chunk missing');
  return { fmt, pcm };
}

function decodeWave(data) {
  const chunks = findWaveChunks(data);
  if (!chunks) fail('INVALID_WAV_FILE');
  const { fmt, pcm } = chunks;
  let format = data.readUInt16LE(fmt.start);
  const channels = data.readUInt16LE(fmt.start + 2);
  const sampleRate = data.readUInt32LE(fmt.start + 4);
  const blockAlign = data.readUInt16LE(fmt.start + 12);
  const bits = data.readUInt16LE(fmt.start + 14);
  if (format === 0xfffe && fmt.size >= 40) format = data.readUInt16LE(fmt.start + 24);
  const bytes = bits >>> 3;
  if (![1, 3].includes(format) || ![1, 2, 3, 4, 8].includes(bytes) || channels < 1 || channels > 32 ||
      sampleRate < 8000 || sampleRate > 384000 || blockAlign < channels * bytes) {
    fail('UNSUPPORTED_WAV_FORMAT');
  }
  if (format === 3 && bits !== 32 && bits !== 64) fail('UNSUPPORTED_WAV_FORMAT');
  if (format === 1 && ![8, 16, 24, 32].includes(bits)) fail('UNSUPPORTED_WAV_FORMAT');
  const frames = Math.floor(pcm.size / blockAlign);
  if (!frames || frames > 0x7fffffff) fail('AUDIO_SIZE_INVALID');
  const outputChannels = Math.min(channels, 2);
  const channelData = Array.from({ length: outputChannels }, () => new Float32Array(frames));
  const readSample = position => {
    if (format === 3) return bits === 32 ? data.readFloatLE(position) : data.readDoubleLE(position);
    if (bits === 8) return (data[position] - 128) / 128;
    if (bits === 16) return data.readInt16LE(position) / 32768;
    if (bits === 24) return data.readIntLE(position, 3) / 8388608;
    return data.readInt32LE(position) / 2147483648;
  };
  for (let frame = 0, position = pcm.start; frame < frames; frame += 1, position += blockAlign) {
    for (let channel = 0; channel < outputChannels; channel += 1) {
      const sample = readSample(position + channel * bytes);
      channelData[channel][frame] = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
    }
  }
  return { channelData, sampleRate, samplesDecoded: frames };
}

function writePcm16Wave(filename, audio) {
  const channelData = audio.channelData;
  const channels = channelData.length;
  const frames = audio.samplesDecoded;
  const sampleRate = audio.sampleRate;
  if (!channels || channels > 2 || !frames || sampleRate < 8000) fail('INVALID_DECODED_AUDIO');
  const dataBytes = frames * channels * 2;
  if (!Number.isSafeInteger(dataBytes) || dataBytes > 0xffffffff - 44) fail('AUDIO_SIZE_INVALID');
  const output = Buffer.allocUnsafe(44 + dataBytes);
  output.write('RIFF', 0, 4, 'ascii');
  output.writeUInt32LE(36 + dataBytes, 4);
  output.write('WAVE', 8, 4, 'ascii');
  output.write('fmt ', 12, 4, 'ascii');
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(channels, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * channels * 2, 28);
  output.writeUInt16LE(channels * 2, 32);
  output.writeUInt16LE(16, 34);
  output.write('data', 36, 4, 'ascii');
  output.writeUInt32LE(dataBytes, 40);
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, Number(channelData[channel][frame]) || 0));
      output.writeInt16LE(sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767), offset);
      offset += 2;
    }
  }
  fs.writeFileSync(filename, output, { mode: 0o600 });
}

function isDirectPcm16Wave(data) {
  const chunks = findWaveChunks(data);
  if (!chunks) return false;
  const start = chunks.fmt.start;
  return data.readUInt16LE(start) === 1 && data.readUInt16LE(start + 14) === 16;
}

async function normalizeInput(inputPath, outputDir) {
  const data = fs.readFileSync(inputPath);
  if (isDirectPcm16Wave(data)) return { path: inputPath, temporary: false };
  if (!findWaveChunks(data)) fail('UNSUPPORTED_INPUT_CODEC', 'Input must be decoded to PCM WAV before separation');
  const audio = decodeWave(data);
  if (!audio || !audio.samplesDecoded || !Array.isArray(audio.channelData) || !audio.channelData.length) {
    fail('AUDIO_DECODE_FAILED');
  }
  if (audio.channelData.length > 2) audio.channelData = audio.channelData.slice(0, 2);
  const normalized = path.join(outputDir, '.lf-spleeter-input.wav');
  writePcm16Wave(normalized, audio);
  return { path: normalized, temporary: true };
}

function loadApi(runtimeDir) {
  const koffi = require('koffi');
  const onnxRuntimeDll = requireFile(path.join(runtimeDir, 'onnxruntime.dll'), 'SPLEETER_RUNTIME_MISSING');
  const providerDll = requireFile(path.join(runtimeDir, 'onnxruntime_providers_shared.dll'), 'SPLEETER_RUNTIME_MISSING');
  const dll = requireFile(path.join(runtimeDir, 'sherpa-onnx-c-api.dll'), 'SPLEETER_RUNTIME_MISSING');
  verifySha256(onnxRuntimeDll, 'daa77083a45bf525da0dde9e87f85d8eb146f58f9c9aa7124ca84545e1c0f148', 'SPLEETER_RUNTIME_INTEGRITY_FAILED');
  verifySha256(providerDll, '190d10767c321f324d3785368a0b752d9c5a9e06cb5d4d97bb176f58bdb652f3', 'SPLEETER_RUNTIME_INTEGRITY_FAILED');
  verifySha256(dll, 'b0e708ed1ab736067f34dee09b2f6f03dce14ec9d6d89ecd9bd0e4a8b8d2a227', 'SPLEETER_RUNTIME_INTEGRITY_FAILED');
  process.env.PATH = `${runtimeDir}${path.delimiter}${process.env.PATH || ''}`;
  const onnxRuntime = koffi.load(onnxRuntimeDll);

  const FloatPtrPtr = koffi.pointer('float', 2);
  const SpleeterConfig = koffi.struct('SherpaOnnxOfflineSourceSeparationSpleeterModelConfig', {
    vocals: 'str',
    accompaniment: 'str',
  });
  const UvrConfig = koffi.struct('SherpaOnnxOfflineSourceSeparationUvrModelConfig', { model: 'str' });
  const ModelConfig = koffi.struct('SherpaOnnxOfflineSourceSeparationModelConfig', {
    spleeter: SpleeterConfig,
    uvr: UvrConfig,
    num_threads: 'int32_t',
    debug: 'int32_t',
    provider: 'str',
  });
  const Config = koffi.struct('SherpaOnnxOfflineSourceSeparationConfig', { model: ModelConfig });
  const Wave = koffi.struct('SherpaOnnxMultiChannelWave', {
    samples: FloatPtrPtr,
    num_channels: 'int32_t',
    num_samples: 'int32_t',
    sample_rate: 'int32_t',
  });
  const Stem = koffi.struct('SherpaOnnxSourceSeparationStem', {
    samples: FloatPtrPtr,
    num_channels: 'int32_t',
    n: 'int32_t',
  });
  const Output = koffi.struct('SherpaOnnxSourceSeparationOutput', {
    stems: koffi.pointer(Stem),
    num_stems: 'int32_t',
    sample_rate: 'int32_t',
  });
  const Separator = koffi.opaque('SherpaOnnxOfflineSourceSeparation');
  const SeparatorPtr = koffi.pointer(Separator);
  const library = koffi.load(dll);
  return {
    koffi, onnxRuntime, Config, Wave, Stem, Output,
    getVersion: library.func('SherpaOnnxGetVersionStr', 'str', []),
    create: library.func('SherpaOnnxCreateOfflineSourceSeparation', SeparatorPtr, [koffi.pointer(Config)]),
    destroy: library.func('SherpaOnnxDestroyOfflineSourceSeparation', 'void', [SeparatorPtr]),
    getSampleRate: library.func('SherpaOnnxOfflineSourceSeparationGetOutputSampleRate', 'int32_t', [SeparatorPtr]),
    getStemCount: library.func('SherpaOnnxOfflineSourceSeparationGetNumberOfStems', 'int32_t', [SeparatorPtr]),
    readWave: library.func('SherpaOnnxReadWaveMultiChannel', koffi.pointer(Wave), ['str']),
    freeWave: library.func('SherpaOnnxFreeMultiChannelWave', 'void', [koffi.pointer(Wave)]),
    process: library.func('SherpaOnnxOfflineSourceSeparationProcess', koffi.pointer(Output), [SeparatorPtr, FloatPtrPtr, 'int32_t', 'int32_t', 'int32_t']),
    destroyOutput: library.func('SherpaOnnxDestroySourceSeparationOutput', 'void', [koffi.pointer(Output)]),
    writeWave: library.func('SherpaOnnxWriteWaveMultiChannel', 'int32_t', [FloatPtrPtr, 'int32_t', 'int32_t', 'int32_t', 'str']),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const inputPath = requireFile(path.resolve(args.input || ''), 'INPUT_AUDIO_MISSING');
  const outputDir = requireDirectory(path.resolve(args.output || ''), 'OUTPUT_DIRECTORY_MISSING');
  const runtimeDir = requireDirectory(path.resolve(args.runtime || ''), 'SPLEETER_RUNTIME_MISSING');
  const modelDir = requireDirectory(path.resolve(args.models || ''), 'SPLEETER_MODELS_MISSING');
  const vocalsModel = requireFile(path.join(modelDir, 'vocals.fp16.onnx'), 'SPLEETER_MODELS_MISSING');
  const accompanimentModel = requireFile(path.join(modelDir, 'accompaniment.fp16.onnx'), 'SPLEETER_MODELS_MISSING');
  verifySha256(vocalsModel, '24cef84aedcd1fe87c0b743ef3370ad34dc1fabf6c9014d6128a75a538c7b668', 'SPLEETER_MODEL_INTEGRITY_FAILED');
  verifySha256(accompanimentModel, 'd14cea55793cc531a5875f5f4da08207d1c5ab9292e8e0099a104eecb014fcc0', 'SPLEETER_MODEL_INTEGRITY_FAILED');
  const threads = Math.max(1, Math.min(8, Number.parseInt(args.threads, 10) || 1));

  progress(2, 'decoding');
  const normalized = await normalizeInput(inputPath, outputDir);
  progress(12, 'loading-runtime');
  const api = loadApi(runtimeDir);
  if (api.getVersion() !== '1.13.4') {
    fail('SPLEETER_RUNTIME_VERSION_MISMATCH');
  }
  let wavePtr = null;
  let separator = null;
  let outputPtr = null;
  try {
    wavePtr = api.readWave(normalized.path);
    if (!wavePtr) fail('AUDIO_DECODE_FAILED');
    const wave = api.koffi.decode(wavePtr, api.Wave);
    if (!wave.samples || wave.num_channels < 1 || wave.num_channels > 2 || wave.num_samples < 1 || wave.sample_rate < 8000) {
      fail('INVALID_DECODED_AUDIO');
    }
    progress(20, 'loading-models');
    separator = api.create({
      model: {
        spleeter: { vocals: vocalsModel, accompaniment: accompanimentModel },
        uvr: { model: null },
        num_threads: threads,
        debug: 0,
        provider: 'cpu',
      },
    });
    if (!separator) fail('SPLEETER_ENGINE_INIT_FAILED');
    if (api.getStemCount(separator) !== 2 || api.getSampleRate(separator) < 8000) fail('SPLEETER_MODEL_INVALID');
    progress(32, 'separating');
    outputPtr = api.process(separator, wave.samples, wave.num_channels, wave.num_samples, wave.sample_rate);
    if (!outputPtr) fail('STEM_SEPARATION_FAILED');
    const output = api.koffi.decode(outputPtr, api.Output);
    if (output.num_stems !== 2 || output.sample_rate < 8000) fail('SPLEETER_OUTPUT_INVALID');
    const stems = api.koffi.decode(output.stems, api.Stem, output.num_stems);
    progress(88, 'writing');
    const destinations = [path.join(outputDir, 'vocals.wav'), path.join(outputDir, 'no_vocals.wav')];
    for (let index = 0; index < 2; index += 1) {
      const stem = stems[index];
      if (!stem || !stem.samples || stem.num_channels < 1 || stem.num_channels > 2 || stem.n < 1) {
        fail('SPLEETER_OUTPUT_INVALID');
      }
      if (api.writeWave(stem.samples, stem.n, output.sample_rate, stem.num_channels, destinations[index]) !== 1) {
        fail('STEM_WRITE_FAILED');
      }
      requireFile(destinations[index], 'STEM_WRITE_FAILED');
    }
    progress(100, 'completed');
  } finally {
    if (outputPtr) api.destroyOutput(outputPtr);
    if (separator) api.destroy(separator);
    if (wavePtr) api.freeWave(wavePtr);
    if (normalized.temporary) {
      try { fs.rmSync(normalized.path, { force: true }); } catch (_) {}
    }
  }
}

main().then(() => process.exit(0)).catch(error => {
  const code = String(error && error.code || 'SPLEETER_WORKER_FAILED').replace(/[^A-Z0-9_]/g, '') || 'SPLEETER_WORKER_FAILED';
  const message = String(error && error.message || code).replace(/[\r\n]+/g, ' ').slice(0, 500);
  fs.writeSync(2, `LF_ERROR ${code} ${message}\n`);
  process.exit(1);
});
