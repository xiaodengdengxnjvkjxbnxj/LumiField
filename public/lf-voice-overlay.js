(function () {
  'use strict';

  var bridge = window.lfVoiceOverlay;
  if (!bridge) return;

  var shell = document.getElementById('lf-voice-overlay');
  var title = document.getElementById('lf-voice-track-title');
  var meta = document.getElementById('lf-voice-track-meta');
  var previous = document.getElementById('lf-voice-previous');
  var toggle = document.getElementById('lf-voice-toggle');
  var next = document.getElementById('lf-voice-next');
  var status = document.getElementById('lf-voice-status');
  var statusText = status.querySelector('b');
  var playing = false;

  function clock(seconds) {
    var value = Math.max(0, Number(seconds) || 0);
    var minutes = Math.floor(value / 60);
    var rest = Math.floor(value % 60);
    return minutes + ':' + String(rest).padStart(2, '0');
  }

  function recognitionLabel(recognition) {
    var state = recognition && recognition.state || 'stopped';
    if (recognition && recognition.lastEvent === 'rejected') return '未识别，请重试';
    if (state === 'listening') return '正在聆听';
    if (state === 'command') return '请说命令';
    if (state === 'starting') return '正在启动';
    if (state === 'unavailable') return '语音不可用';
    return '已就绪';
  }

  function render(state) {
    state = state || {};
    var playback = state.playback || {};
    var recognition = state.recognition || {};
    playing = playback.playing === true;
    title.textContent = state.songSync && playback.title ? playback.title : '等待 LF 歌曲同步';
    var trackMeta = state.songSync && playback.title
      ? [playback.artist, clock(playback.position) + ' / ' + clock(playback.duration)].filter(Boolean).join('  ·  ')
      : (state.songSync ? '已连接 LF 唯一播放器' : '歌曲同步未开启');
    meta.textContent = trackMeta;
    previous.disabled = !playback.canPrevious;
    next.disabled = !playback.canNext;
    toggle.disabled = !state.songSync;
    toggle.dataset.playing = String(playing);
    toggle.querySelector('span').textContent = playing ? 'Ⅱ' : '▶';
    var toggleLabel = playing ? '暂停' : '播放';
    toggle.title = toggleLabel;
    toggle.setAttribute('aria-label', toggleLabel);
    shell.dataset.recognition = recognition.state || 'stopped';
    status.dataset.state = recognition.state || 'stopped';
    statusText.textContent = recognitionLabel(recognition);
    if (recognition.reason) status.title = recognition.reason;
  }

  previous.addEventListener('click', function () { bridge.previous(); });
  next.addEventListener('click', function () { bridge.next(); });
  toggle.addEventListener('click', function () { (playing ? bridge.pause() : bridge.play()); });
  bridge.onState(render);
  bridge.ready().then(function (result) {
    if (result && result.state) render(result.state);
  }).catch(function () {});
}());
