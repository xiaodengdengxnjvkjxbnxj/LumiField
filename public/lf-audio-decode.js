(function (global) {
  'use strict';

  var TARGET_SAMPLE_RATE = 44100;
  var MAX_SECONDS = 3 * 60 * 60;
  var MAX_SOURCE_BYTES = 512 * 1024 * 1024;

  function cancelled(signal) {
    if (!signal || !signal.aborted) return;
    var error = new Error('CANCELLED');
    error.code = 'CANCELLED';
    throw error;
  }

  function fail(code, message) {
    var error = new Error(message || code);
    error.code = code;
    return error;
  }

  function report(callback, value, phase) {
    if (typeof callback === 'function') callback(Math.max(0, Math.min(1, value)), phase);
  }

  async function readStream(stream, total, options, phase) {
    if (!stream || typeof stream.getReader !== 'function') throw fail('SOURCE_DOWNLOAD_FAILED');
    var reader = stream.getReader();
    var chunks = [];
    var received = 0;
    try {
      while (true) {
        cancelled(options.signal);
        var next = await reader.read();
        if (next.done) break;
        if (!next.value || !next.value.byteLength) continue;
        received += next.value.byteLength;
        if (received > MAX_SOURCE_BYTES) throw fail('AUDIO_SIZE_INVALID', '歌曲源文件超过 512 MB 限制。');
        chunks.push(next.value);
        var ratio = total > 0 ? Math.min(1, received / total) : Math.min(0.96, received / (received + 1024 * 1024));
        report(options.onProgress, 0.03 + 0.15 * ratio, phase);
      }
    } finally {
      if (options.signal && options.signal.aborted) {
        try { await reader.cancel(); } catch (_) {}
      }
      try { reader.releaseLock(); } catch (_) {}
    }
    var merged = new Uint8Array(received);
    var offset = 0;
    chunks.forEach(function (chunk) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    });
    report(options.onProgress, 0.18, phase === 'reading' ? 'read' : 'downloaded');
    return merged.buffer;
  }

  async function readSource(options) {
    cancelled(options.signal);
    if (options.file && typeof options.file.arrayBuffer === 'function') {
      var fileSize = Number(options.file.size || 0);
      if (fileSize > MAX_SOURCE_BYTES) throw fail('AUDIO_SIZE_INVALID', '歌曲源文件超过 512 MB 限制。');
      if (typeof options.file.stream === 'function') {
        return readStream(options.file.stream(), fileSize, options, 'reading');
      }
      report(options.onProgress, 0.08, 'reading');
      var fileBytes = await options.file.arrayBuffer();
      if (fileBytes.byteLength > MAX_SOURCE_BYTES) throw fail('AUDIO_SIZE_INVALID', '歌曲源文件超过 512 MB 限制。');
      report(options.onProgress, 0.18, 'read');
      return fileBytes;
    }
    var url = String(options.url || '').trim();
    if (!url) throw fail('INVALID_AUDIO_URL', '当前歌曲没有可读取的音频源。');
    report(options.onProgress, 0.03, 'downloading');
    var response;
    try {
      response = await fetch(url, { signal: options.signal, credentials: 'same-origin' });
    } catch (error) {
      if (options.signal && options.signal.aborted) cancelled(options.signal);
      throw fail('SOURCE_DOWNLOAD_FAILED', error && error.message);
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw fail('SOURCE_ACCESS_DENIED_OR_DRM', '播放源拒绝解码访问，可能需要会员权限或受 DRM 保护。');
      }
      if (response.status === 404 || response.status === 410) {
        throw fail('SOURCE_URL_EXPIRED', '歌曲播放地址已失效。');
      }
      throw fail('SOURCE_HTTP_' + response.status, '读取歌曲播放源失败（HTTP ' + response.status + '）。');
    }
    var type = String(response.headers.get('content-type') || '').toLowerCase();
    if (type && !/^audio\//.test(type) && !/^(?:application\/(?:octet-stream|ogg))\b/.test(type)) {
      throw fail('SOURCE_NOT_DECODABLE', '播放源没有返回可解码音频。');
    }
    var announced = Number(response.headers.get('content-length') || 0);
    if (announced > MAX_SOURCE_BYTES) throw fail('AUDIO_SIZE_INVALID', '歌曲源文件超过 512 MB 限制。');
    if (response.body) return readStream(response.body, announced, options, 'downloading');
    var data = await response.arrayBuffer();
    if (data.byteLength > MAX_SOURCE_BYTES) throw fail('AUDIO_SIZE_INVALID', '歌曲源文件超过 512 MB 限制。');
    report(options.onProgress, 0.18, 'downloaded');
    return data;
  }

  async function decodeAudio(options, bytes) {
    cancelled(options.signal);
    var context = options.audioContext;
    var ownsContext = false;
    if (!context || typeof context.decodeAudioData !== 'function') {
      var AudioContextClass = global.AudioContext || global.webkitAudioContext;
      if (!AudioContextClass) throw fail('AUDIO_DECODE_UNAVAILABLE', '当前系统没有可用的音频解码器。');
      context = new AudioContextClass();
      ownsContext = true;
    }
    report(options.onProgress, 0.22, 'decoding');
    try {
      var decoded = await context.decodeAudioData(bytes.slice(0));
      cancelled(options.signal);
      if (!decoded || !Number.isFinite(decoded.duration) || decoded.duration <= 0 || decoded.duration > MAX_SECONDS) {
        throw fail('AUDIO_DURATION_INVALID', '歌曲时长无效或超过本地伴唱处理上限。');
      }
      report(options.onProgress, 0.48, 'decoded');
      return decoded;
    } catch (error) {
      if (error && error.code) throw error;
      throw fail('SOURCE_NOT_DECODABLE', '当前播放源无法由 LumiField 音频引擎解码。');
    } finally {
      if (ownsContext && context && typeof context.close === 'function') {
        try { await context.close(); } catch (_) {}
      }
    }
  }

  async function stereo44100(options, source) {
    cancelled(options.signal);
    if (source.sampleRate === TARGET_SAMPLE_RATE && source.numberOfChannels <= 2) return source;
    var OfflineClass = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    if (!OfflineClass) throw fail('AUDIO_RESAMPLE_UNAVAILABLE', '当前系统没有可用的离线音频转换器。');
    var frames = Math.max(1, Math.ceil(source.duration * TARGET_SAMPLE_RATE));
    if (frames * 4 > 0xffffffff - 44) throw fail('AUDIO_SIZE_INVALID', '歌曲过长，无法生成标准 WAV。');
    report(options.onProgress, 0.52, 'resampling');
    var offline = new OfflineClass(2, frames, TARGET_SAMPLE_RATE);
    var node = offline.createBufferSource();
    node.buffer = source;
    node.connect(offline.destination);
    node.start(0);
    var rendered = await offline.startRendering();
    cancelled(options.signal);
    report(options.onProgress, 0.68, 'resampled');
    return rendered;
  }

  function ascii(view, offset, text) {
    for (var index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  }

  async function encodePcm16(options, buffer) {
    var frames = buffer.length;
    var bytes = frames * 4;
    if (!frames || bytes > 0xffffffff - 44) throw fail('AUDIO_SIZE_INVALID', '解码后的歌曲大小无效。');
    var output = new ArrayBuffer(44 + bytes);
    var view = new DataView(output);
    ascii(view, 0, 'RIFF');
    view.setUint32(4, 36 + bytes, true);
    ascii(view, 8, 'WAVE');
    ascii(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, TARGET_SAMPLE_RATE, true);
    view.setUint32(28, TARGET_SAMPLE_RATE * 4, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    ascii(view, 36, 'data');
    view.setUint32(40, bytes, true);
    var left = buffer.getChannelData(0);
    var right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
    var offset = 44;
    var chunk = 65536;
    for (var start = 0; start < frames; start += chunk) {
      cancelled(options.signal);
      var end = Math.min(frames, start + chunk);
      for (var frame = start; frame < end; frame += 1) {
        var l = Math.max(-1, Math.min(1, left[frame] || 0));
        var r = Math.max(-1, Math.min(1, right[frame] || 0));
        view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7fff, true);
        view.setInt16(offset + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
        offset += 4;
      }
      report(options.onProgress, 0.68 + 0.31 * end / frames, 'encoding');
      if (end < frames && start % (chunk * 8) === 0) {
        await new Promise(function (resolve) { setTimeout(resolve, 0); });
      }
    }
    report(options.onProgress, 1, 'ready');
    return output;
  }

  async function decodeToWav(options) {
    options = options && typeof options === 'object' ? options : {};
    var bytes = await readSource(options);
    cancelled(options.signal);
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 44) {
      throw fail('SOURCE_NOT_DECODABLE', '当前播放源没有有效音频数据。');
    }
    var decoded = await decodeAudio(options, bytes);
    var normalized = await stereo44100(options, decoded);
    return encodePcm16(options, normalized);
  }

  global.LFAudioDecode = Object.freeze({
    decodeToWav: decodeToWav,
    targetSampleRate: TARGET_SAMPLE_RATE,
  });
})(window);
