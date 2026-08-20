'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');

const CACHE_SCHEMA = 'lumifield-wallpaper-video-cache-v1';
const DEFAULT_DISPLAY = Object.freeze({ width: 1920, height: 1080, dpr: 1, refreshRate: 60 });
const ACTIVE_STATES = new Set(['queued', 'hashing', 'probing', 'planning', 'copying', 'transcoding']);
const MIME_BY_EXTENSION = Object.freeze({
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
});

function codedError(code, message, cause) {
  const error = new Error(message || code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function errorCode(error, fallback) {
  return String(error && (error.code || error.message) || fallback || 'WALLPAPER_VIDEO_FAILED');
}

function isCancelled(error) {
  return !!(error && (error.name === 'AbortError' || /(?:CANCEL|ABORT)/i.test(errorCode(error))));
}

function abortError() {
  const error = codedError('CANCELLED', 'CANCELLED');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) throw abortError();
}

function clamp(value, minimum, maximum, fallback) {
  value = Number(value);
  if (!Number.isFinite(value)) value = fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

function evenFloor(value) {
  return Math.max(2, Math.floor(Number(value) / 2) * 2);
}

function parseRate(value) {
  if (Number.isFinite(Number(value))) return Math.max(0, Number(value));
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(value || ''));
  if (!match) return 0;
  const denominator = Number(match[2]);
  return denominator ? Math.max(0, Number(match[1]) / denominator) : 0;
}

function normalizeRotation(value) {
  let rotation = Number(value) || 0;
  rotation = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  return rotation;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  Object.keys(value).sort().forEach((key) => {
    if (value[key] !== undefined && typeof value[key] !== 'function') result[key] = stableValue(value[key]);
  });
  return result;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function pinOwnerId(ownerKey) {
  const raw = ownerKey == null || ownerKey === ''
    ? 'lumifield-default-owner'
    : (typeof ownerKey === 'object' ? stableStringify(ownerKey) : String(ownerKey));
  if (/^owner:[a-f0-9]{24}$/i.test(raw)) return raw.toLowerCase();
  return `owner:${sha256Text(`lumifield-wallpaper-pin-v1:${raw}`).slice(0, 24)}`;
}

function pinStateFromManifest(manifest) {
  const pins = {};
  if (manifest && manifest.pins && typeof manifest.pins === 'object' && !Array.isArray(manifest.pins)) {
    Object.keys(manifest.pins).forEach((owner) => {
      const value = manifest.pins[owner];
      const count = Math.max(0, Math.floor(Number(value && typeof value === 'object' ? value.count : value) || 0));
      if (!count) return;
      pins[pinOwnerId(owner)] = {
        count: 1,
        pinnedAt: Number(value && typeof value === 'object' ? value.pinnedAt : 0) || Number(manifest.pinnedAt) || 0,
      };
    });
  }
  if (!Object.keys(pins).length && manifest && Array.isArray(manifest.pinOwners)) {
    manifest.pinOwners.forEach((owner) => {
      const id = pinOwnerId(owner);
      pins[id] = { count: 1, pinnedAt: Number(manifest.pinnedAt) || 0 };
    });
  }
  if (!Object.keys(pins).length && manifest && manifest.pinned === true) {
    pins[pinOwnerId()] = { count: 1, pinnedAt: Number(manifest.pinnedAt) || 0 };
  }
  const owners = Object.keys(pins).sort();
  return {
    pins,
    owners,
    count: owners.length,
    pinnedAt: owners.reduce((oldest, owner) => {
      const value = Number(pins[owner].pinnedAt) || 0;
      return !oldest || (value && value < oldest) ? value : oldest;
    }, 0),
  };
}

function manifestWithPins(manifest, pins) {
  const normalized = {};
  Object.keys(pins || {}).sort().forEach((owner) => {
    const value = pins[owner];
    const count = Math.max(0, Math.floor(Number(value && typeof value === 'object' ? value.count : value) || 0));
    if (!count) return;
    normalized[pinOwnerId(owner)] = {
      count: 1,
      pinnedAt: Number(value && typeof value === 'object' ? value.pinnedAt : 0) || 0,
    };
  });
  const state = pinStateFromManifest({ pins: normalized });
  return Object.assign({}, manifest, {
    pins: normalized,
    pinned: state.count > 0,
    pinCount: state.count,
    pinOwners: state.owners,
    pinnedAt: state.count ? state.pinnedAt : null,
  });
}

async function sha256File(inputPath, options = {}) {
  const stat = options.stat || await fs.promises.stat(inputPath);
  const total = Math.max(1, Number(stat.size) || 1);
  const signal = options.signal;
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(inputPath);
    let bytes = 0;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => stream.destroy(abortError());
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    stream.on('data', (chunk) => {
      hash.update(chunk);
      bytes += chunk.length;
      if (typeof options.onProgress === 'function') options.onProgress(Math.min(1, bytes / total));
    });
    stream.once('error', (error) => finish(reject, error));
    stream.once('end', () => {
      try { finish(resolve, hash.digest('hex')); }
      catch (error) { finish(reject, error); }
    });
  });
}

function deterministicUuid(hash) {
  const bytes = Buffer.from(String(hash).replace(/[^a-f0-9]/gi, '').padEnd(32, '0').slice(0, 32), 'hex');
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function mimeForVideo(file) {
  return MIME_BY_EXTENSION[path.extname(String(file || '')).toLowerCase()] || 'video/mp4';
}

function normalizeDisplay(value = {}) {
  const width = clamp(value.width, 320, 7680, DEFAULT_DISPLAY.width);
  const height = clamp(value.height, 240, 7680, DEFAULT_DISPLAY.height);
  return {
    width,
    height,
    dpr: clamp(value.dpr || value.deviceScaleFactor, 0.75, 3, DEFAULT_DISPLAY.dpr),
    refreshRate: clamp(value.refreshRate || value.hz, 24, 240, DEFAULT_DISPLAY.refreshRate),
    deviceMemory: clamp(value.deviceMemory, 0, 128, 0),
    hardwareConcurrency: clamp(value.hardwareConcurrency, 0, 256, 0),
    lowPower: value.lowPower === true || value.powerSave === true,
    allow4k: value.allow4k === true,
  };
}

function capDisplayDimensions(width, height, capLong, capShort) {
  const landscape = width >= height;
  const maxWidth = landscape ? capLong : capShort;
  const maxHeight = landscape ? capShort : capLong;
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: evenFloor(width * scale), height: evenFloor(height * scale) };
}

function selectDeviceProfile(displayValue, options = {}) {
  const display = normalizeDisplay(displayValue);
  const physicalWidth = evenFloor(display.width * display.dpr);
  const physicalHeight = evenFloor(display.height * display.dpr);
  const low = display.lowPower || (display.deviceMemory > 0 && display.deviceMemory <= 4) ||
    (display.hardwareConcurrency > 0 && display.hardwareConcurrency <= 4);
  const high = !low && ((display.deviceMemory >= 12 && display.hardwareConcurrency >= 8) || options.quality === 'high');
  const tier = low ? 'conservative' : (high ? 'quality' : 'balanced');
  const capLong = low ? 1280 : (display.allow4k && high ? 3840 : (high ? 2560 : 1920));
  const capShort = low ? 720 : (display.allow4k && high ? 2160 : (high ? 1440 : 1080));
  const capped = capDisplayDimensions(physicalWidth, physicalHeight, capLong, capShort);
  return {
    id: `wallpaper-${tier}`,
    tier,
    display,
    width: capped.width,
    height: capped.height,
    maxWidth: capped.width,
    maxHeight: capped.height,
    maxFps: Math.min(display.refreshRate, low ? 30 : 60),
    maxBitrate: low ? 8_000_000 : (high ? 24_000_000 : 14_000_000),
    crf: low ? 21 : (high ? 18 : 19),
    preset: low ? 'veryfast' : (high ? 'medium' : 'fast'),
    codec: 'h264',
    pixelFormat: 'yuv420p',
  };
}

function normalizeProbe(raw, inputPath, sourceStat) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const rotation = normalizeRotation(raw.rotation);
  const codedWidth = Math.max(0, Number(raw.codedWidth || raw.sourceWidth || raw.width) || 0);
  const codedHeight = Math.max(0, Number(raw.codedHeight || raw.sourceHeight || raw.height) || 0);
  const swapsAxes = rotation === 90 || rotation === 270;
  const width = swapsAxes ? codedHeight : codedWidth;
  const height = swapsAxes ? codedWidth : codedHeight;
  if (!width || !height) throw codedError('MEDIA_PROBE_FAILED', 'MEDIA_PROBE_FAILED: video dimensions missing');
  const codec = String(raw.codec || raw.codecName || raw.videoCodec || '').trim().toLowerCase();
  return {
    width,
    height,
    codedWidth,
    codedHeight,
    fps: parseRate(raw.fps || raw.frameRate || raw.avgFrameRate || raw.rFrameRate),
    bitrate: Math.max(0, Number(raw.bitrate || raw.bitRate || raw.bit_rate) || 0),
    duration: Math.max(0, Number(raw.duration || raw.durationSec) || 0),
    codec,
    profile: String(raw.profile || ''),
    pixelFormat: String(raw.pixelFormat || raw.pixFmt || raw.pix_fmt || ''),
    format: String(raw.format || raw.formatName || path.extname(inputPath).slice(1)).toLowerCase(),
    rotation,
    hasAudio: raw.hasAudio === true || Number(raw.audioStreams || 0) > 0,
    size: Math.max(0, Number(raw.size) || Number(sourceStat && sourceStat.size) || 0),
  };
}

function probeFromFfprobeJson(payload, inputPath, sourceStat) {
  const streams = Array.isArray(payload && payload.streams) ? payload.streams : [];
  const video = streams.find((stream) => stream && stream.codec_type === 'video');
  if (!video) throw codedError('MEDIA_PROBE_FAILED', 'MEDIA_PROBE_FAILED: video stream missing');
  const format = payload && payload.format || {};
  const sideRotation = Array.isArray(video.side_data_list)
    ? (video.side_data_list.find((item) => item && item.rotation != null) || {}).rotation
    : null;
  return normalizeProbe({
    codedWidth: video.width,
    codedHeight: video.height,
    fps: video.avg_frame_rate || video.r_frame_rate,
    bitrate: video.bit_rate || format.bit_rate,
    duration: video.duration || format.duration,
    codec: video.codec_name,
    profile: video.profile,
    pixelFormat: video.pix_fmt,
    format: format.format_name,
    rotation: sideRotation != null ? sideRotation : video.tags && video.tags.rotate,
    hasAudio: streams.some((stream) => stream && stream.codec_type === 'audio'),
    size: format.size || sourceStat && sourceStat.size,
  }, inputPath, sourceStat);
}

function fitInside(width, height, maximumWidth, maximumHeight) {
  const scale = Math.min(1, maximumWidth / width, maximumHeight / height);
  return { width: evenFloor(width * scale), height: evenFloor(height * scale) };
}

function browserCompatible(probe, inputPath) {
  const codec = String(probe.codec || '').toLowerCase();
  const extension = path.extname(inputPath).toLowerCase();
  if (/^(h264|avc|avc1)$/.test(codec)) return /^(\.mp4|\.m4v|\.mov)$/.test(extension);
  if (/^(vp8|vp9)$/.test(codec)) return extension === '.webm';
  if (/^(av1|av01)$/.test(codec)) return /^(\.mp4|\.m4v|\.webm)$/.test(extension);
  return false;
}

function createOptimizationPlan(probe, deviceProfile, inputPath, options = {}) {
  const fitted = fitInside(probe.width, probe.height, deviceProfile.maxWidth, deviceProfile.maxHeight);
  const sourceFps = probe.fps || Math.min(30, deviceProfile.maxFps);
  const targetFps = Math.max(1, Math.min(sourceFps, deviceProfile.maxFps));
  const resolutionExceeds = probe.width > fitted.width + 1 || probe.height > fitted.height + 1;
  const bitrateExceeds = probe.bitrate > deviceProfile.maxBitrate;
  const fpsExceeds = probe.fps > deviceProfile.maxFps + 0.01;
  const decodeUnsupported = options.hardwareCompatible === false;
  const trustedCodec = /^(?:h264|avc|avc1|vp8|vp9|av1|av01)$/.test(String(probe.codec || ''));
  const compatible = (options.trustProbeCompatibility === true ? trustedCodec : browserCompatible(probe, inputPath)) && !decodeUnsupported;
  const forced = options.force === true || options.forceTranscode === true;
  const transcode = forced || resolutionExceeds || bitrateExceeds || fpsExceeds || !compatible;
  let strategy = transcode ? 'transcode' : 'copy';
  if (!transcode && probe.hasAudio && options.stripAudio !== false) strategy = 'remux';
  const extension = strategy === 'copy'
    ? (path.extname(inputPath).toLowerCase() || '.mp4')
    : (strategy === 'remux' && /^(vp8|vp9)$/.test(probe.codec) ? '.webm' : '.mp4');
  const reasons = [];
  if (forced) reasons.push('forced');
  if (resolutionExceeds) reasons.push('resolution');
  if (bitrateExceeds) reasons.push('bitrate');
  if (fpsExceeds) reasons.push('fps');
  if (!compatible) reasons.push(decodeUnsupported ? 'hardware-decode' : 'codec-or-container');
  if (strategy === 'remux') reasons.push('strip-audio');
  return {
    strategy,
    optimized: strategy === 'transcode',
    width: strategy === 'transcode' ? fitted.width : probe.width,
    height: strategy === 'transcode' ? fitted.height : probe.height,
    fps: strategy === 'transcode' ? targetFps : sourceFps,
    codec: strategy === 'transcode' ? 'h264' : probe.codec,
    crf: deviceProfile.crf,
    preset: deviceProfile.preset,
    pixelFormat: strategy === 'transcode' ? deviceProfile.pixelFormat : probe.pixelFormat,
    stripAudio: strategy !== 'copy',
    audio: strategy === 'copy' ? probe.hasAudio : false,
    audioCodec: strategy === 'copy' && probe.hasAudio ? 'copy' : 'none',
    extension,
    mime: mimeForVideo(`video${extension}`),
    reasons,
  };
}

function cacheKeyFor(sourceHash, target, profile, plan) {
  return sha256Text(stableStringify({
    schema: CACHE_SCHEMA,
    sourceHash,
    profile: {
      id: profile.id,
      width: profile.width,
      height: profile.height,
      maxFps: profile.maxFps,
      maxBitrate: profile.maxBitrate,
      crf: profile.crf,
      preset: profile.preset,
      codec: profile.codec,
    },
    plan: {
      strategy: plan.strategy,
      width: plan.width,
      height: plan.height,
      fps: plan.fps,
      codec: plan.codec,
      crf: plan.crf,
      preset: plan.preset,
      pixelFormat: plan.pixelFormat,
      stripAudio: plan.stripAudio,
      extension: plan.extension,
    },
  }));
}

function executableCandidates(explicit, executable) {
  const result = [];
  if (explicit) result.push(path.resolve(String(explicit)));
  if (executable === 'ffmpeg') {
    try {
      const bundled = require('ffmpeg-static');
      if (bundled) result.push(path.resolve(String(bundled)));
    } catch (_) {}
  } else {
    try {
      const bundled = require('ffprobe-static');
      if (bundled && bundled.path) result.push(path.resolve(String(bundled.path)));
    } catch (_) {}
  }
  const envName = executable === 'ffprobe' ? 'LUMIFIELD_FFPROBE_PATH' : 'LUMIFIELD_FFMPEG_PATH';
  const genericName = executable === 'ffprobe' ? 'FFPROBE_PATH' : 'FFMPEG_PATH';
  if (process.env[envName]) result.push(path.resolve(process.env[envName]));
  if (process.env[genericName]) result.push(path.resolve(process.env[genericName]));
  const suffix = process.platform === 'win32' ? '.exe' : '';
  if (process.resourcesPath) {
    result.push(path.join(process.resourcesPath, 'bin', executable + suffix));
    result.push(path.join(process.resourcesPath, executable + suffix));
  }
  const expanded = [];
  result.forEach((candidate) => {
    expanded.push(candidate);
    if (String(candidate).includes(`${path.sep}app.asar${path.sep}`)) {
      expanded.unshift(String(candidate).replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`));
    }
  });
  return expanded.find((candidate) => {
    try { return fs.statSync(candidate).isFile(); } catch (_) { return false; }
  }) || executable;
}

function siblingFfprobe(ffmpegPath) {
  if (!ffmpegPath || !path.isAbsolute(ffmpegPath)) return '';
  const extension = path.extname(ffmpegPath);
  const basename = path.basename(ffmpegPath, extension);
  if (!/^ffmpeg$/i.test(basename)) return '';
  const candidate = path.join(path.dirname(ffmpegPath), `ffprobe${extension}`);
  try { return fs.statSync(candidate).isFile() ? candidate : ''; } catch (_) { return ''; }
}

function safeTitle(value, fallback) {
  const title = String(value || fallback || '视频壁纸').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return title.slice(0, 180) || '视频壁纸';
}

function probeFromFfmpegText(stderr, inputPath, sourceStat) {
  const text = String(stderr || '');
  const videoLine = text.split(/\r?\n/).find((line) => /Stream\s+#\S+.*Video:/i.test(line));
  if (!videoLine) throw codedError('MEDIA_PROBE_FAILED', 'MEDIA_PROBE_FAILED: FFmpeg video stream missing');
  const dimensions = /(?:^|[\s,])(\d{2,5})x(\d{2,5})(?:[\s,\[]|$)/.exec(videoLine);
  const codec = /Video:\s*([^\s,]+)/i.exec(videoLine);
  const fps = /(\d+(?:\.\d+)?)\s*fps\b/i.exec(videoLine);
  const duration = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i.exec(text);
  const bitrate = /Duration:[^\r\n]*bitrate:\s*(\d+(?:\.\d+)?)\s*kb\/s/i.exec(text);
  const rotation = /rotation(?:\s+of)?\s+(-?\d+(?:\.\d+)?)\s+degrees/i.exec(text) || /rotate\s*:\s*(-?\d+)/i.exec(text);
  return normalizeProbe({
    width: dimensions && dimensions[1],
    height: dimensions && dimensions[2],
    fps: fps && fps[1],
    codec: codec && codec[1],
    duration: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : 0,
    bitrate: bitrate ? Number(bitrate[1]) * 1000 : 0,
    rotation: rotation && rotation[1],
    hasAudio: /Stream\s+#\S+.*Audio:/i.test(text),
    format: path.extname(inputPath).slice(1),
    size: sourceStat && sourceStat.size,
  }, inputPath, sourceStat);
}

function encodeUrlPart(value) {
  return encodeURIComponent(String(value)).replace(/%2F/gi, '%252F');
}

class WallpaperVideoService {
  constructor(options = {}) {
    this.storageDir = path.resolve(options.storageDir || options.cacheDir || path.join(process.cwd(), '.lumifield-wallpapers'));
    this.ffmpegPath = executableCandidates(options.ffmpegPath, 'ffmpeg');
    this.ffprobePath = executableCandidates(options.ffprobePath || siblingFfprobe(this.ffmpegPath), 'ffprobe');
    this.onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    this.probeMedia = typeof options.probeMedia === 'function' ? options.probeMedia : null;
    this.transcodeMedia = typeof options.transcodeMedia === 'function' ? options.transcodeMedia : null;
    this.copyMedia = typeof options.copyMedia === 'function' ? options.copyMedia : null;
    this.hashFile = typeof options.hashFile === 'function' ? options.hashFile : sha256File;
    this.hardwareDecode = typeof options.hardwareDecode === 'function' ? options.hardwareDecode : null;
    this.hardwareEncoderProbe = typeof options.hardwareEncoderProbe === 'function' ? options.hardwareEncoderProbe : null;
    this.hardwareEncoderCandidates = Array.isArray(options.hardwareEncoderCandidates)
      ? options.hardwareEncoderCandidates.map((value) => String(value || '').trim()).filter(Boolean)
      : (process.platform === 'win32' ? ['h264_nvenc', 'h264_qsv', 'h264_amf'] : []);
    this.hardwareEncoder = '';
    this.hardwareEncoderResolved = false;
    this.hardwareEncoderPromise = null;
    this.hardwareRejectedEncoders = new Set();
    this.hardwareProbeCount = 0;
    this.hardwareFallbackCount = 0;
    this.spawn = typeof options.spawn === 'function' ? options.spawn : spawn;
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.randomUUID = typeof options.randomUUID === 'function' ? options.randomUUID : crypto.randomUUID;
    this.compatibleMode = options.compatibleMode === 'source' || options.passthroughCompatible === true ? 'source' : 'copy';
    this.trustProbeCompatibility = options.trustProbeCompatibility === true;
    this.deferProgressUntilMediaWork = options.deferProgressUntilMediaWork === true;
    this.maxCacheBytes = Number.isFinite(Number(options.maxCacheBytes)) && Number(options.maxCacheBytes) > 0
      ? Math.max(1, Math.floor(Number(options.maxCacheBytes)))
      : 512 * 1024 * 1024;
    this.cacheOperation = Promise.resolve();
    this.tasks = new Map();
    this.children = new Set();
    this.disposed = false;
    fs.mkdirSync(this.storageDir, { recursive: true });
  }

  async start(inputPath, options = {}) {
    if (inputPath && typeof inputPath === 'object') {
      options = Object.assign({}, inputPath, options);
      inputPath = options.inputPath || options.path || options.filePath;
    }
    if (this.disposed) return { ok: false, error: 'SERVICE_DISPOSED' };
    const resolved = path.resolve(String(inputPath || ''));
    let stat;
    try { stat = await fs.promises.stat(resolved); }
    catch (error) { return { ok: false, error: 'SOURCE_NOT_FOUND', message: error.message }; }
    if (!stat.isFile()) return { ok: false, error: 'SOURCE_NOT_FILE' };
    const profile = selectDeviceProfile(options.display || options.device || {}, options);
    const activeKey = sha256Text(stableStringify({
      inputPath: resolved.toLowerCase(),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      profile,
      force: options.force === true || options.forceTranscode === true,
      stripAudio: options.stripAudio !== false,
    }));
    const existing = Array.from(this.tasks.values()).find((candidate) =>
      candidate.activeKey === activeKey && ACTIVE_STATES.has(candidate.status));
    if (existing) return Object.assign(this._snapshot(existing), { coalesced: true });
    const id = String(this.randomUUID()).toLowerCase();
    const controller = new AbortController();
    const task = {
      id,
      status: 'queued',
      progress: 0,
      stage: 'queued',
      inputPath: resolved,
      options: Object.assign({}, options),
      sourceStat: { size: stat.size, mtimeMs: stat.mtimeMs },
      createdAt: this.now(),
      updatedAt: this.now(),
      controller,
      children: new Set(),
      result: null,
      error: '',
      activeKey,
    };
    this.tasks.set(id, task);
    task.promise = Promise.resolve().then(() => this._runTask(task)).finally(() => {
      if (task.activeKey === activeKey) task.activeKey = '';
    });
    return this._snapshot(task);
  }

  wait(taskId) {
    const task = this.tasks.get(String(taskId || ''));
    return task ? task.promise : Promise.resolve({ ok: false, taskId: String(taskId || ''), error: 'TASK_NOT_FOUND' });
  }

  getTask(taskId) {
    const task = this.tasks.get(String(taskId || ''));
    return task ? this._snapshot(task) : { ok: false, taskId: String(taskId || ''), error: 'TASK_NOT_FOUND' };
  }

  status(taskId) {
    return this.getTask(taskId);
  }

  async cancel(taskId) {
    const task = this.tasks.get(String(taskId || ''));
    if (!task) return { ok: false, taskId: String(taskId || ''), error: 'TASK_NOT_FOUND' };
    if (!ACTIVE_STATES.has(task.status)) {
      return { ok: task.status === 'cancelled', taskId: task.id, status: task.status, error: task.status === 'cancelled' ? '' : 'TASK_NOT_ACTIVE' };
    }
    task.controller.abort();
    task.children.forEach((child) => this._killChild(child));
    return { ok: true, taskId: task.id, status: 'cancelling' };
  }

  async resume(taskId, overrides = {}) {
    const task = this.tasks.get(String(taskId || ''));
    if (!task) return { ok: false, taskId: String(taskId || ''), error: 'TASK_NOT_FOUND' };
    if (ACTIVE_STATES.has(task.status)) return Object.assign(this._snapshot(task), { resumed: false });
    if (task.status === 'completed') return Object.assign(this._snapshot(task), { resumed: false, cacheHit: true });
    const started = await this.start(task.inputPath, Object.assign({}, task.options, overrides, { resumedFrom: task.id }));
    return Object.assign({}, started, { resumed: started.ok !== false, resumedFrom: task.id });
  }

  async pin(reference, ownerKey) {
    return this._setPinned(reference, true, ownerKey);
  }

  async unpin(reference, ownerKey) {
    const result = await this._setPinned(reference, false, ownerKey);
    if (!result.ok) return result;
    await this._enforceCacheLimit();
    return Object.assign({}, result, { evicted: !this._findCacheEntrySync(result.id) });
  }

  list(options = {}) {
    const pinnedOnly = options === true || !!(options && options.pinnedOnly);
    return this._cacheEntriesSync()
      .filter((entry) => !pinnedOnly || entry.pinned)
      .sort((left, right) => right.accessedAt - left.accessedAt)
      .map((entry) => this._publicCacheEntry(entry));
  }

  listPins() {
    return this.list({ pinnedOnly: true });
  }

  async dispose() {
    this.disposed = true;
    const active = Array.from(this.tasks.values()).filter((task) => ACTIVE_STATES.has(task.status));
    active.forEach((task) => {
      task.controller.abort();
      task.children.forEach((child) => this._killChild(child));
    });
    await Promise.allSettled(active.map((task) => task.promise));
    this.children.forEach((child) => this._killChild(child));
    return { ok: true };
  }

  debug() {
    const active = Array.from(this.tasks.values()).filter((task) => ACTIVE_STATES.has(task.status));
    const cacheEntries = this.list();
    const pins = cacheEntries.filter((entry) => entry.pinned);
    return {
      activeTasks: active.length,
      activeTaskCount: active.length,
      childProcesses: this.children.size,
      processCount: this.children.size,
      taskCount: this.tasks.size,
      storageDir: this.storageDir,
      ffmpegPath: this.ffmpegPath,
      ffprobePath: this.ffprobePath,
      cacheBytes: cacheEntries.reduce((total, entry) => total + entry.bytes, 0),
      cacheEntryCount: cacheEntries.length,
      pinnedCount: pins.length,
      pinReferenceCount: pins.reduce((total, entry) => total + entry.pinCount, 0),
      pins,
      maxCacheBytes: this.maxCacheBytes,
      hardwareEncoder: this.hardwareEncoder,
      hardwareAccelerated: !!this.hardwareEncoder,
      hardwareEncoderResolved: this.hardwareEncoderResolved,
      hardwareProbeCount: this.hardwareProbeCount,
      hardwareFallbackCount: this.hardwareFallbackCount,
      hardwareRejectedEncoders: Array.from(this.hardwareRejectedEncoders),
      disposed: this.disposed,
    };
  }

  _snapshot(task) {
    const snapshot = {
      ok: task.status !== 'failed' && task.status !== 'cancelled',
      taskId: task.id,
      status: task.status,
      stage: task.stage,
      progress: task.progress,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
    if (task.error) snapshot.error = task.error;
    if (task.result) snapshot.result = task.result;
    return snapshot;
  }

  _update(task, status, progress, detail) {
    task.status = status || task.status;
    task.stage = status || task.stage;
    const defer = this.deferProgressUntilMediaWork && /^(?:queued|hashing|probing|planning)$/.test(task.status);
    if (!defer && Number.isFinite(Number(progress))) task.progress = Math.max(task.progress, Math.min(1, Number(progress)));
    task.updatedAt = this.now();
    const payload = Object.assign(this._snapshot(task), detail && typeof detail === 'object' ? detail : {});
    const callbacks = [this.onProgress, task.options && task.options.onProgress].filter((callback, index, all) =>
      typeof callback === 'function' && all.indexOf(callback) === index);
    callbacks.forEach((callback) => { try { callback(payload); } catch (_) {} });
  }

  async _runTask(task) {
    let stagingDir = '';
    try {
      const signal = task.controller.signal;
      throwIfAborted(signal);
      this._update(task, 'hashing', 0.01);
      const sourceHash = await this.hashFile(task.inputPath, {
        signal,
        stat: task.sourceStat,
        onProgress: (value) => this._update(task, 'hashing', 0.02 + Math.max(0, Math.min(1, Number(value) || 0)) * 0.25),
      });
      throwIfAborted(signal);
      this._update(task, 'probing', 0.29);
      const rawProbe = await this._probe(task);
      const probe = normalizeProbe(rawProbe, task.inputPath, task.sourceStat);
      await this._assertSourceUnchanged(task);
      throwIfAborted(signal);
      this._update(task, 'planning', 0.42);
      const profile = selectDeviceProfile(task.options.display || task.options.device || {}, task.options);
      let hardwareCompatible;
      if (this.hardwareDecode) {
        try { hardwareCompatible = await this.hardwareDecode(probe.codec, { probe, profile, signal }); }
        catch (_) { hardwareCompatible = false; }
      }
      const planOptions = Object.assign({}, task.options, { hardwareCompatible });
      if (this.trustProbeCompatibility && /^(?:h264|avc|avc1|vp8|vp9|av1|av01)$/.test(probe.codec)) {
        planOptions.hardwareCompatible = hardwareCompatible !== false;
        planOptions.trustProbeCompatibility = true;
      }
      const plan = createOptimizationPlan(probe, profile, task.inputPath, planOptions);
      const target = String(task.options.target || 'global');
      const cacheKey = cacheKeyFor(sourceHash, target, profile, plan);
      const importId = deterministicUuid(cacheKey);
      const finalDir = path.join(this.storageDir, importId);
      task.cacheDir = finalDir;
      const outputName = `wallpaper-video-${cacheKey.slice(0, 16)}${plan.extension}`;
      const cached = await this._readCache(finalDir, cacheKey, sourceHash, task.id);
      if (cached) {
        await this._enforceCacheLimit(finalDir);
        const result = this._result(task, cached.outputPath, cached.manifest, probe, profile, plan, sourceHash, true);
        task.result = result;
        this._update(task, 'completed', 1, { cacheHit: true });
        return result;
      }

      if (plan.strategy === 'copy' && this.compatibleMode === 'source') {
        const result = this._sourceResult(task, probe, profile, plan, sourceHash, cacheKey);
        task.result = result;
        this._update(task, 'completed', 1, { cacheHit: false });
        return result;
      }

      if (await this._exists(finalDir)) throw codedError('CACHE_DESTINATION_CONFLICT', 'CACHE_DESTINATION_CONFLICT');
      stagingDir = path.join(this.storageDir, `.${importId}.${task.id}.tmp`);
      await fs.promises.mkdir(stagingDir, { recursive: false });
      const stagingOutput = path.join(stagingDir, outputName);
      let mediaResult = null;
      if (plan.strategy === 'copy') {
        this._update(task, 'copying', 0.48);
        mediaResult = await this._copy(task, stagingOutput);
      } else {
        this._update(task, 'transcoding', 0.48);
        mediaResult = await this._transcode(task, stagingOutput, plan, probe);
      }
      throwIfAborted(signal);
      await this._assertSourceUnchanged(task);
      const outputStat = await fs.promises.stat(stagingOutput);
      if (!outputStat.isFile() || outputStat.size <= 0) throw codedError('EMPTY_TRANSCODE_OUTPUT', 'EMPTY_TRANSCODE_OUTPUT');
      const manifest = {
        schema: CACHE_SCHEMA,
        id: importId,
        provider: 'local',
        projectId: `video-cache:${cacheKey}`,
        cacheKey,
        sourceHash,
        target,
        title: safeTitle(task.options.title, path.basename(task.inputPath)),
        kind: 'video',
        mime: plan.mime,
        entry: outputName,
        importedAt: this.now(),
        lastAccessedAt: this.now(),
        pins: {},
        pinned: false,
        pinCount: 0,
        pinOwners: [],
        pinnedAt: null,
        files: 1,
        bytes: outputStat.size,
        profile,
        plan,
        probe,
        original: this._original(task, probe, sourceHash),
        quality: mediaResult && (mediaResult.quality || mediaResult.metrics) || null,
        encoder: mediaResult && mediaResult.encoder || (plan.strategy === 'transcode' ? 'libx264' : 'copy'),
        hardwareAccelerated: !!(mediaResult && mediaResult.hardwareAccelerated),
        hardwareFallback: !!(mediaResult && mediaResult.hardwareFallback),
      };
      await fs.promises.writeFile(path.join(stagingDir, 'lumifield-wallpaper.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
      throwIfAborted(signal);
      try {
        await fs.promises.rename(stagingDir, finalDir);
        stagingDir = '';
      } catch (error) {
        const winner = await this._readCache(finalDir, cacheKey, sourceHash, task.id);
        if (!winner) throw error;
        await fs.promises.rm(stagingDir, { recursive: true, force: true });
        stagingDir = '';
        const result = this._result(task, winner.outputPath, winner.manifest, probe, profile, plan, sourceHash, true);
        task.result = result;
        this._update(task, 'completed', 1, { cacheHit: true });
        return result;
      }
      await this._enforceCacheLimit(finalDir);
      const result = this._result(task, path.join(finalDir, outputName), manifest, probe, profile, plan, sourceHash, false);
      task.result = result;
      this._update(task, 'completed', 1, { cacheHit: false });
      return result;
    } catch (error) {
      if (stagingDir) {
        try { await fs.promises.rm(stagingDir, { recursive: true, force: true }); } catch (_) {}
      }
      const cancelled = isCancelled(error) || task.controller.signal.aborted;
      task.error = cancelled ? 'CANCELLED' : errorCode(error);
      task.result = { ok: false, taskId: task.id, status: cancelled ? 'cancelled' : 'failed', error: task.error };
      this._update(task, cancelled ? 'cancelled' : 'failed', task.progress);
      return task.result;
    } finally {
      task.children.forEach((child) => this._killChild(child));
      task.children.clear();
    }
  }

  _original(task, probe, sourceHash) {
    return {
      path: task.inputPath,
      title: safeTitle(task.options.title, path.basename(task.inputPath)),
      name: path.basename(task.inputPath),
      mime: mimeForVideo(task.inputPath),
      bytes: task.sourceStat.size,
      mtimeMs: task.sourceStat.mtimeMs,
      sourceHash,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      bitrate: probe.bitrate,
      duration: probe.duration,
      codec: probe.codec,
      rotation: probe.rotation,
      hasAudio: probe.hasAudio,
    };
  }

  _sourceResult(task, probe, profile, plan, sourceHash, cacheKey) {
    return {
      ok: true,
      taskId: task.id,
      status: 'completed',
      outputPath: task.inputPath,
      path: task.inputPath,
      url: '',
      mime: mimeForVideo(task.inputPath),
      kind: 'video',
      title: safeTitle(task.options.title, path.basename(task.inputPath)),
      bytes: task.sourceStat.size,
      sourceHash,
      profile,
      plan,
      probe,
      original: this._original(task, probe, sourceHash),
      cacheKey,
      cacheHit: false,
      cached: false,
      optimized: false,
      copied: false,
      passthrough: true,
    };
  }

  _result(task, outputPath, manifest, probe, profile, plan, sourceHash, cacheHit) {
    const importId = manifest.id;
    const entry = manifest.entry;
    return {
      ok: true,
      taskId: task.id,
      status: 'completed',
      outputPath,
      cachePath: outputPath,
      path: outputPath,
      url: `/api/local-wallpaper/${importId}/${encodeUrlPart(entry)}`,
      importId,
      mime: manifest.mime || plan.mime,
      kind: 'video',
      title: safeTitle(task.options.title, path.basename(task.inputPath)),
      bytes: Number(manifest.bytes) || 0,
      sourceHash,
      profile,
      plan,
      probe,
      original: this._original(task, probe, sourceHash),
      cacheKey: manifest.cacheKey,
      cacheHit: !!cacheHit,
      cached: !!cacheHit,
      optimized: plan.strategy === 'transcode',
      copied: plan.strategy === 'copy',
      remuxed: plan.strategy === 'remux',
      quality: manifest.quality || null,
      metrics: manifest.quality || null,
      encoder: String(manifest.encoder || (plan.strategy === 'transcode' ? 'libx264' : 'copy')),
      hardwareAccelerated: manifest.hardwareAccelerated === true,
      hardwareFallback: manifest.hardwareFallback === true,
    };
  }

  async _assertSourceUnchanged(task) {
    const current = await fs.promises.stat(task.inputPath);
    if (!current.isFile() || current.size !== task.sourceStat.size || current.mtimeMs !== task.sourceStat.mtimeMs) {
      throw codedError('SOURCE_CHANGED_DURING_PROCESSING', 'SOURCE_CHANGED_DURING_PROCESSING');
    }
  }

  async _exists(file) {
    try { await fs.promises.access(file); return true; } catch (_) { return false; }
  }

  async _readCache(directory, cacheKey, sourceHash) {
    return this._withCacheLock(async () => {
      try {
        let manifest = JSON.parse(await fs.promises.readFile(path.join(directory, 'lumifield-wallpaper.json'), 'utf8'));
        if (!manifest || manifest.schema !== CACHE_SCHEMA || manifest.cacheKey !== cacheKey || manifest.sourceHash !== sourceHash) return null;
        const entry = path.basename(String(manifest.entry || ''));
        if (!entry || entry !== manifest.entry) return null;
        const outputPath = path.join(directory, entry);
        const stat = await fs.promises.stat(outputPath);
        if (!stat.isFile() || stat.size <= 0 || Number(manifest.bytes) !== stat.size) return null;
        const previousAccess = Number(manifest.lastAccessedAt || manifest.importedAt) || 0;
        const currentTime = Number(this.now());
        const touched = Object.assign({}, manifest, {
          lastAccessedAt: Math.max(Number.isFinite(currentTime) ? currentTime : Date.now(), previousAccess + 1),
        });
        try {
          await this._writeManifestAtomic(directory, touched);
          manifest = touched;
        } catch (_) {
          // The old manifest remains intact after an atomic-write failure.
        }
        return { manifest, outputPath };
      } catch (_) {
        return null;
      }
    });
  }

  _cacheEntriesSync() {
    let directories = [];
    try { directories = fs.readdirSync(this.storageDir, { withFileTypes: true }); } catch (_) { return []; }
    const entries = [];
    directories.forEach((entry) => {
      if (!entry.isDirectory() || entry.name.startsWith('.')) return;
      const directory = path.join(this.storageDir, entry.name);
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'lumifield-wallpaper.json'), 'utf8'));
        if (!manifest || manifest.schema !== CACHE_SCHEMA) return;
        let bytes = 0;
        fs.readdirSync(directory, { withFileTypes: true }).forEach((child) => {
          if (child.isFile()) bytes += fs.statSync(path.join(directory, child.name)).size;
        });
        const outputPath = path.join(directory, path.basename(String(manifest.entry || '')));
        const pinState = pinStateFromManifest(manifest);
        entries.push({
          directory,
          outputPath,
          bytes,
          accessedAt: Number(manifest.lastAccessedAt || manifest.importedAt) || 0,
          importedAt: Number(manifest.importedAt) || 0,
          pinned: pinState.count > 0,
          pinnedAt: pinState.count ? pinState.pinnedAt : null,
          pinCount: pinState.count,
          pinOwners: pinState.owners,
          id: String(manifest.id || entry.name),
          cacheKey: String(manifest.cacheKey || ''),
          projectId: String(manifest.projectId || ''),
          title: String(manifest.title || ''),
          manifest,
        });
      } catch (_) {}
    });
    return entries;
  }

  _cacheBytesSync() {
    return this._cacheEntriesSync().reduce((total, entry) => total + entry.bytes, 0);
  }

  async _enforceCacheLimit(protectedDirectory) {
    return this._withCacheLock(async () => {
      let entries = this._cacheEntriesSync();
      let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
      if (total <= this.maxCacheBytes) return total;
      const protectedPaths = new Set([protectedDirectory].concat(Array.from(this.tasks.values())
        .filter((task) => ACTIVE_STATES.has(task.status) && task.cacheDir)
        .map((task) => task.cacheDir)).filter(Boolean).map((value) => path.resolve(value).toLowerCase()));
      entries = entries.sort((left, right) => left.accessedAt - right.accessedAt);
      for (const entry of entries) {
        if (total <= this.maxCacheBytes) break;
        if (entry.pinned || protectedPaths.has(path.resolve(entry.directory).toLowerCase())) continue;
        try {
          const current = JSON.parse(await fs.promises.readFile(path.join(entry.directory, 'lumifield-wallpaper.json'), 'utf8'));
          if (current && current.schema === CACHE_SCHEMA && pinStateFromManifest(current).count > 0) continue;
          await fs.promises.rm(entry.directory, { recursive: true, force: true });
          total -= entry.bytes;
        } catch (_) {}
      }
      return Math.max(0, total);
    });
  }

  _withCacheLock(operation) {
    const previous = this.cacheOperation;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    this.cacheOperation = previous.catch(() => {}).then(() => gate);
    return previous.catch(() => {}).then(operation).finally(release);
  }

  async _writeManifestAtomic(directory, manifest) {
    const manifestPath = path.join(directory, 'lumifield-wallpaper.json');
    const token = `${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}`;
    const temporaryPath = path.join(directory, `.lumifield-wallpaper.${token}.tmp`);
    let handle = null;
    try {
      handle = await fs.promises.open(temporaryPath, 'wx');
      await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.promises.rename(temporaryPath, manifestPath);
    } catch (error) {
      if (handle) {
        try { await handle.close(); } catch (_) {}
      }
      try { await fs.promises.rm(temporaryPath, { force: true }); } catch (_) {}
      throw error;
    }
  }

  _findCacheEntrySync(reference) {
    let value = reference;
    if (value && typeof value === 'object' && value.result) value = value.result;
    const fields = value && typeof value === 'object'
      ? [value.id, value.importId, value.cacheKey, value.projectId, value.directory, value.cacheDir, value.cachePath, value.outputPath, value.path]
      : [value];
    const strings = fields.filter((field) => field != null && String(field).trim()).map((field) => String(field).trim());
    if (!strings.length) return null;
    const paths = new Set(strings.filter((field) => path.isAbsolute(field)).map((field) => path.resolve(field).toLowerCase()));
    return this._cacheEntriesSync().find((entry) => strings.includes(entry.id)
      || strings.includes(entry.cacheKey)
      || strings.includes(entry.projectId)
      || paths.has(path.resolve(entry.directory).toLowerCase())
      || paths.has(path.resolve(entry.outputPath).toLowerCase())) || null;
  }

  _publicCacheEntry(entry) {
    return {
      id: entry.id,
      cacheKey: entry.cacheKey,
      projectId: entry.projectId,
      title: entry.title,
      directory: entry.directory,
      outputPath: entry.outputPath,
      bytes: entry.bytes,
      importedAt: entry.importedAt,
      lastAccessedAt: entry.accessedAt,
      pinned: entry.pinned,
      pinnedAt: entry.pinnedAt,
      pinCount: entry.pinCount,
      pinOwnerCount: entry.pinOwners.length,
      pinOwners: entry.pinOwners.slice(),
    };
  }

  async _setPinned(reference, pinned, ownerKey) {
    const owner = pinOwnerId(ownerKey);
    try {
      return await this._withCacheLock(async () => {
        const entry = this._findCacheEntrySync(reference);
        if (!entry) return { ok: false, error: 'CACHE_NOT_FOUND', pinOwner: owner };
        const manifestPath = path.join(entry.directory, 'lumifield-wallpaper.json');
        const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
        if (!manifest || manifest.schema !== CACHE_SCHEMA) return { ok: false, error: 'CACHE_MANIFEST_INVALID', pinOwner: owner };
        const now = Number(this.now());
        const timestamp = Number.isFinite(now) ? now : Date.now();
        const state = pinStateFromManifest(manifest);
        const pins = Object.assign({}, state.pins);
        if (pinned) {
          if (!pins[owner]) pins[owner] = { count: 1, pinnedAt: timestamp };
        } else delete pins[owner];
        const updated = manifestWithPins(manifest, pins);
        if (pinned) {
          updated.lastAccessedAt = Math.max(timestamp, (Number(manifest.lastAccessedAt || manifest.importedAt) || 0) + 1);
        }
        await this._writeManifestAtomic(entry.directory, updated);
        const refreshed = this._findCacheEntrySync(entry.id);
        const pinState = pinStateFromManifest(updated);
        return Object.assign({ ok: true, pinOwner: owner }, this._publicCacheEntry(refreshed || Object.assign({}, entry, {
          pinned: pinState.count > 0,
          pinnedAt: pinState.count ? pinState.pinnedAt : null,
          pinCount: pinState.count,
          pinOwners: pinState.owners,
          accessedAt: Number(updated.lastAccessedAt || updated.importedAt) || 0,
        })));
      });
    } catch (error) {
      return { ok: false, error: errorCode(error, 'CACHE_MANIFEST_WRITE_FAILED'), pinOwner: owner };
    }
  }

  async _probe(task) {
    const signal = task.controller.signal;
    if (this.probeMedia) {
      return this.probeMedia({ inputPath: task.inputPath, signal, taskId: task.id });
    }
    try {
      const result = await this._runProcess(task, this.ffprobePath, [
        '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', task.inputPath,
      ], { code: 'MEDIA_PROBE_FAILED', maxStdout: 8 * 1024 * 1024 });
      return probeFromFfprobeJson(JSON.parse(result.stdout), task.inputPath, task.sourceStat);
    } catch (ffprobeError) {
      throwIfAborted(signal);
      try {
        const fallback = await this._runProcess(task, this.ffmpegPath, [
          '-hide_banner', '-i', task.inputPath, '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-',
        ], { code: 'MEDIA_PROBE_FAILED', maxStdout: 256 * 1024 });
        return probeFromFfmpegText(fallback.stderr, task.inputPath, task.sourceStat);
      } catch (fallbackError) {
        if (isCancelled(fallbackError)) throw fallbackError;
        throw codedError('MEDIA_PROBE_FAILED', `MEDIA_PROBE_FAILED: ${errorCode(ffprobeError)}; ${errorCode(fallbackError)}`, fallbackError);
      }
    }
  }

  async _copy(task, outputPath) {
    const signal = task.controller.signal;
    if (this.copyMedia) {
      return this.copyMedia({ inputPath: task.inputPath, outputPath, signal, taskId: task.id,
        onProgress: (value) => this._update(task, 'copying', 0.48 + Math.max(0, Math.min(1, Number(value) || 0)) * 0.48) });
    }
    let copied = 0;
    const total = Math.max(1, task.sourceStat.size);
    const source = fs.createReadStream(task.inputPath);
    const destination = fs.createWriteStream(outputPath, { flags: 'wx' });
    source.on('data', (chunk) => {
      copied += chunk.length;
      this._update(task, 'copying', 0.48 + Math.min(1, copied / total) * 0.48);
    });
    await pipeline(source, destination, { signal });
    return { ok: true, copied: true };
  }

  async _transcode(task, outputPath, plan, probe) {
    const signal = task.controller.signal;
    const onProgress = (value, detail) => this._update(task, 'transcoding', 0.48 + Math.max(0, Math.min(1, Number(value) || 0)) * 0.48, detail);
    if (this.transcodeMedia) {
      return this.transcodeMedia({
        inputPath: task.inputPath,
        outputPath,
        stagingPath: outputPath,
        destinationPath: outputPath,
        plan,
        probe,
        signal,
        taskId: task.id,
        onProgress,
        progress: onProgress,
      });
    }
    if (plan.strategy === 'remux') {
      const processResult = await this._runFfmpegTranscode(task, outputPath, plan, probe, 'copy', false, onProgress);
      return { ok: true, process: processResult, encoder: 'copy', hardwareAccelerated: false };
    }
    this._update(task, 'transcoding', task.progress, { message: '正在探测可用的硬件视频编码…', hardwareProbe: true });
    let hardwareEncoder = await this._selectHardwareEncoder(task);
    let hardwareFallback = false;
    throwIfAborted(signal);
    while (hardwareEncoder) {
      try {
        const processResult = await this._runFfmpegTranscode(task, outputPath, plan, probe, hardwareEncoder, true, onProgress);
        return { ok: true, process: processResult, encoder: hardwareEncoder, hardwareAccelerated: true, hardwareFallback };
      } catch (error) {
        if (isCancelled(error) || signal.aborted) throw error;
        this.hardwareFallbackCount += 1;
        hardwareFallback = true;
        this.hardwareRejectedEncoders.add(hardwareEncoder);
        this.hardwareEncoder = '';
        this.hardwareEncoderResolved = false;
        try { await fs.promises.rm(outputPath, { force: true }); } catch (_) {}
        this._update(task, 'transcoding', task.progress, {
          message: '当前硬件编码不可用，正在尝试其他高质量编码路径',
          hardwareAccelerated: false,
          hardwareFallback: true,
        });
        hardwareEncoder = await this._selectHardwareEncoder(task);
        throwIfAborted(signal);
      }
    }
    const processResult = await this._runFfmpegTranscode(task, outputPath, plan, probe, 'libx264', false, onProgress);
    return { ok: true, process: processResult, encoder: 'libx264', hardwareAccelerated: false, hardwareFallback };
  }

  async _selectHardwareEncoder(task) {
    if (!this.hardwareEncoderCandidates.length) {
      this.hardwareEncoderResolved = true;
      return '';
    }
    if (this.hardwareEncoderResolved) return this.hardwareEncoder;
    if (!this.hardwareEncoderPromise) {
      this.hardwareEncoderPromise = this._probeHardwareEncoder(task).then((encoder) => {
        this.hardwareEncoder = String(encoder || '');
        this.hardwareEncoderResolved = true;
        return this.hardwareEncoder;
      }).finally(() => { this.hardwareEncoderPromise = null; });
    }
    try {
      return await this.hardwareEncoderPromise;
    } catch (error) {
      if (isCancelled(error)) {
        if (task.controller.signal.aborted) throw error;
        this.hardwareEncoderPromise = null;
        this.hardwareEncoderResolved = false;
        return this._selectHardwareEncoder(task);
      }
      this.hardwareEncoder = '';
      this.hardwareEncoderResolved = true;
      return '';
    }
  }

  async _probeHardwareEncoder(task) {
    this.hardwareProbeCount += 1;
    if (this.hardwareEncoderProbe) {
      const selected = await this.hardwareEncoderProbe({
        candidates: this.hardwareEncoderCandidates.slice(),
        ffmpegPath: this.ffmpegPath,
        signal: task.controller.signal,
        taskId: task.id,
      });
      const encoder = typeof selected === 'string' ? selected : selected && selected.encoder;
      return this.hardwareEncoderCandidates.includes(String(encoder || '')) && !this.hardwareRejectedEncoders.has(String(encoder)) ? String(encoder) : '';
    }
    for (const encoder of this.hardwareEncoderCandidates) {
      if (this.hardwareRejectedEncoders.has(encoder)) continue;
      throwIfAborted(task.controller.signal);
      try {
        await this._runProcess(task, this.ffmpegPath, [
          '-hide_banner', '-loglevel', 'error',
          '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=1',
          '-frames:v', '1', '-an', '-c:v', encoder,
          '-pix_fmt', 'yuv420p', '-f', 'null', '-',
        ], { code: 'HARDWARE_ENCODER_PROBE_FAILED', maxStdout: 64 * 1024 });
        return encoder;
      } catch (error) {
        if (isCancelled(error) || task.controller.signal.aborted) throw error;
      }
    }
    return '';
  }

  _encoderArguments(encoder, plan) {
    const quality = String(Math.max(12, Math.min(24, (Number(plan.crf) || 18) - 2)));
    if (encoder === 'h264_nvenc') return ['-c:v', encoder, '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', quality, '-b:v', '0'];
    if (encoder === 'h264_qsv') return ['-c:v', encoder, '-preset', 'medium', '-global_quality', quality];
    if (encoder === 'h264_amf') return ['-c:v', encoder, '-quality', 'quality', '-rc', 'cqp', '-qp_i', quality, '-qp_p', quality];
    return ['-c:v', 'libx264', '-threads', '2', '-preset', plan.preset, '-crf', String(plan.crf)];
  }

  async _runFfmpegTranscode(task, outputPath, plan, probe, encoder, hardwareAccelerated, onProgress) {
    const args = ['-hide_banner', '-y', '-filter_threads', '1', '-i', task.inputPath, '-map', '0:v:0', '-an'];
    if (encoder === 'copy') args.push('-c:v', 'copy');
    else {
      const filters = [`scale=${plan.width}:${plan.height}:flags=lanczos`];
      if (probe.fps > plan.fps + 0.01) filters.push(`fps=${plan.fps}`);
      args.push('-vf', filters.join(','), ...this._encoderArguments(encoder, plan), '-pix_fmt', 'yuv420p', '-tag:v', 'avc1');
    }
    if (plan.extension === '.mp4') args.push('-movflags', '+faststart');
    args.push('-progress', 'pipe:2', '-nostats', outputPath);
    let stderrRemainder = '';
    return this._runProcess(task, this.ffmpegPath, args, {
      code: 'FFMPEG_TRANSCODE_FAILED',
      maxStdout: 256 * 1024,
      onStderr: (text) => {
        stderrRemainder += text;
        const lines = stderrRemainder.split(/\r?\n/);
        stderrRemainder = lines.pop() || '';
        lines.forEach((line) => {
          const trimmed = line.trim();
          const match = /^out_time_(?:ms|us)=(\d+)/.exec(trimmed);
          const detail = { ffmpeg: trimmed, encoder, hardwareAccelerated: !!hardwareAccelerated };
          if (match && probe.duration > 0) onProgress(Math.min(0.99, Number(match[1]) / 1_000_000 / probe.duration), detail);
          if (/^progress=end\s*$/.test(trimmed)) onProgress(1, { ffmpeg: 'progress=end', encoder, hardwareAccelerated: !!hardwareAccelerated });
        });
      },
    });
  }

  _killChild(child) {
    if (!child || child.exitCode != null) return;
    try { child.kill(); } catch (_) {}
    const timer = setTimeout(() => { try { if (child.exitCode == null) child.kill('SIGKILL'); } catch (_) {} }, 900);
    if (timer.unref) timer.unref();
  }

  _runProcess(task, command, args, options = {}) {
    const signal = task.controller.signal;
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = this.spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error) {
        reject(codedError(options.code || 'MEDIA_PROCESS_FAILED', `${options.code || 'MEDIA_PROCESS_FAILED'}: ${error.message}`, error));
        return;
      }
      this.children.add(child);
      task.children.add(child);
      let stdout = '';
      let stderr = '';
      let settled = false;
      const maxStdout = Number(options.maxStdout) || 8 * 1024 * 1024;
      const maxStderr = 512 * 1024;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        this.children.delete(child);
        task.children.delete(child);
        callback(value);
      };
      const onAbort = () => this._killChild(child);
      signal.addEventListener('abort', onAbort, { once: true });
      if (child.stdout) child.stdout.on('data', (chunk) => {
        if (Buffer.byteLength(stdout) < maxStdout) stdout += String(chunk);
        if (Buffer.byteLength(stdout) > maxStdout) this._killChild(child);
      });
      if (child.stderr) child.stderr.on('data', (chunk) => {
        const text = String(chunk);
        if (Buffer.byteLength(stderr) < maxStderr) stderr += text;
        if (typeof options.onStderr === 'function') options.onStderr(text);
      });
      child.once('error', (error) => {
        const code = options.code || 'MEDIA_PROCESS_FAILED';
        finish(reject, codedError(code, `${code}: ${error.message}`, error));
      });
      child.once('close', (code) => {
        if (signal.aborted) {
          finish(reject, abortError());
          return;
        }
        if (code !== 0) {
          const failureCode = options.code || 'MEDIA_PROCESS_FAILED';
          finish(reject, codedError(failureCode, `${failureCode}: ${stderr.trim().slice(-2000) || `exit ${code}`}`));
          return;
        }
        finish(resolve, { stdout, stderr, code });
      });
    });
  }
}

function createWallpaperVideoService(options) {
  return new WallpaperVideoService(options);
}

function createWallpaperVideoOptimizer(options = {}) {
  const injectedTestPipeline = typeof options.probeMedia === 'function' && typeof options.transcodeMedia === 'function';
  return new WallpaperVideoService(Object.assign({}, options, {
    storageDir: options.storageDir || options.cacheDir,
    compatibleMode: options.compatibleMode || (injectedTestPipeline ? 'source' : 'copy'),
    trustProbeCompatibility: options.trustProbeCompatibility === true || injectedTestPipeline,
    deferProgressUntilMediaWork: options.deferProgressUntilMediaWork === true || injectedTestPipeline,
  }));
}

const testHooks = Object.freeze({
  CACHE_SCHEMA,
  stableStringify,
  sha256Text,
  pinOwnerId,
  pinStateFromManifest,
  sha256File,
  deterministicUuid,
  mimeForVideo,
  normalizeDisplay,
  normalizeProbe,
  probeFromFfprobeJson,
  probeFromFfmpegText,
  selectDeviceProfile,
  createOptimizationPlan,
  cacheKeyFor,
  browserCompatible,
  fitInside,
  parseRate,
});

module.exports = {
  WallpaperVideoService,
  createWallpaperVideoService,
  createWallpaperVideoOptimizer,
  CACHE_SCHEMA,
  sha256File,
  selectDeviceProfile,
  createOptimizationPlan,
  cacheKeyFor,
  testHooks,
  __test: testHooks,
};
