'use strict';

const path = require('path');
const { spawn } = require('child_process');

const CHANNELS = Object.freeze({
  configure: 'lumifield-voice-assistant-configure',
  playback: 'lumifield-voice-assistant-playback',
  show: 'lumifield-voice-assistant-show',
  settings: 'lumifield-voice-assistant-open-microphone-settings',
  overlayAction: 'lumifield-voice-assistant-overlay-action',
  overlayReady: 'lumifield-voice-assistant-overlay-ready',
  overlayState: 'lumifield-voice-assistant-overlay-state',
  command: 'lumifield-voice-assistant-command',
  status: 'lumifield-voice-assistant-status',
  debug: 'lumifield-voice-assistant-debug',
});

const ALLOWED_COMMANDS = new Set(['search', 'play', 'pause', 'previous', 'next', 'show']);
const OVERLAY_COMMANDS = new Set(['play', 'pause', 'previous', 'next']);
const TEST_ENV_KEYS = ['LF_MASTER_TEST', 'LUMIFIELD_E2E_TEST', 'LF_ALLOW_PACKAGED_CDP_TEST'];
const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  voiceWake: false,
  songSync: false,
  topEdgeWake: true,
  wakeWord: '小艺，小艺',
});
const DEFAULT_PLAYBACK = Object.freeze({
  title: '',
  artist: '',
  playing: false,
  canPrevious: false,
  canNext: false,
  position: 0,
  duration: 0,
  currentIndex: -1,
  queueLength: 0,
});

function clampText(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function finiteNumber(value, min, max, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function sanitizeConfig(value = {}, previous = DEFAULT_CONFIG) {
  const source = value && typeof value === 'object' ? value : {};
  const has = key => Object.prototype.hasOwnProperty.call(source, key);
  return {
    enabled: has('enabled') ? source.enabled === true : previous.enabled === true,
    voiceWake: has('voiceWake') ? source.voiceWake === true : previous.voiceWake === true,
    songSync: has('songSync') ? source.songSync === true : previous.songSync === true,
    topEdgeWake: has('topEdgeWake') ? source.topEdgeWake === true : previous.topEdgeWake !== false,
    wakeWord: has('wakeWord') ? (clampText(source.wakeWord, 32) || DEFAULT_CONFIG.wakeWord) : previous.wakeWord,
  };
}

function sanitizePlayback(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const current = source.current && typeof source.current === 'object' ? source.current : {};
  return {
    title: clampText(source.title || source.name || current.title || current.name, 160),
    artist: clampText(source.artist || source.creator || current.artist || current.creator, 120),
    playing: source.playing === true,
    canPrevious: source.canPrevious === true,
    canNext: source.canNext === true,
    position: finiteNumber(source.position != null ? source.position : source.currentTime, 0, 86400, 0),
    duration: finiteNumber(source.duration, 0, 86400, 0),
    currentIndex: Math.round(finiteNumber(source.currentIndex, -1, 100000, -1)),
    queueLength: Math.round(finiteNumber(source.queueLength, 0, 100000, 0)),
  };
}

function normalizeSpeech(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s,，。.!！?？、:：;；'"“”‘’]/g, '');
}

function encodedPowerShell(script) {
  return Buffer.from(String(script), 'utf16le').toString('base64');
}

function foregroundMonitorScript(overlayHandle) {
  const safeOverlayHandle = /^\d+$/.test(String(overlayHandle || '')) ? String(overlayHandle) : '0';
  return String.raw`
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class LFVoiceWindowProbe {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Auto)] public struct MONITORINFOEX {
    public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string szDevice;
  }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder value, int maxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int virtualKey);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromPoint(POINT point, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFOEX info);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out RECT value, int size);
}
"@
try { [LFVoiceWindowProbe]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null } catch {}
$overlayHandle = [int64]${safeOverlayHandle}
$last = ""
$lastLeftDown = $false
while ($true) {
  try {
    $cursor = New-Object LFVoiceWindowProbe+POINT
    [LFVoiceWindowProbe]::GetCursorPos([ref]$cursor) | Out-Null
    $cursorMonitorHandle = [LFVoiceWindowProbe]::MonitorFromPoint($cursor, 2)
    $cursorMonitor = New-Object LFVoiceWindowProbe+MONITORINFOEX
    $cursorMonitor.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($cursorMonitor)
    [LFVoiceWindowProbe]::GetMonitorInfo($cursorMonitorHandle, [ref]$cursorMonitor) | Out-Null
    $leftState = [LFVoiceWindowProbe]::GetAsyncKeyState(1)
    $leftDown = (($leftState -band 0x8000) -ne 0)
    $leftClicked = (($leftState -band 1) -ne 0) -or ($leftDown -and -not $lastLeftDown)
    $lastLeftDown = $leftDown

    $hwnd = [LFVoiceWindowProbe]::GetForegroundWindow()
    $rect = New-Object LFVoiceWindowProbe+RECT
    $windowPid = [uint32]0
    $visible = $false
    $iconic = $false
    $windowClass = ""
    $foregroundMonitor = New-Object LFVoiceWindowProbe+MONITORINFOEX
    $foregroundMonitor.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($foregroundMonitor)
    $dpi = 96
    if ($hwnd -ne [IntPtr]::Zero) {
      $visible = [LFVoiceWindowProbe]::IsWindowVisible($hwnd)
      $iconic = [LFVoiceWindowProbe]::IsIconic($hwnd)
      $classBuilder = [Text.StringBuilder]::new(260)
      [LFVoiceWindowProbe]::GetClassName($hwnd, $classBuilder, $classBuilder.Capacity) | Out-Null
      $windowClass = $classBuilder.ToString()
      [LFVoiceWindowProbe]::GetWindowThreadProcessId($hwnd, [ref]$windowPid) | Out-Null
      [LFVoiceWindowProbe]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
      try {
        $extendedRect = New-Object LFVoiceWindowProbe+RECT
        if ([LFVoiceWindowProbe]::DwmGetWindowAttribute($hwnd, 9, [ref]$extendedRect, [Runtime.InteropServices.Marshal]::SizeOf($extendedRect)) -eq 0) { $rect = $extendedRect }
      } catch {}
      $foregroundMonitorHandle = [LFVoiceWindowProbe]::MonitorFromWindow($hwnd, 2)
      [LFVoiceWindowProbe]::GetMonitorInfo($foregroundMonitorHandle, [ref]$foregroundMonitor) | Out-Null
      try { $dpi = [int][LFVoiceWindowProbe]::GetDpiForWindow($hwnd) } catch { $dpi = 96 }
      if ($dpi -le 0) { $dpi = 96 }
    }
    $shellWindow = @("Progman", "WorkerW", "Shell_TrayWnd") -contains $windowClass
    $validWindow = $visible -and -not $iconic -and -not $shellWindow
    $scale = [double]$dpi / 96.0
    $overlayWidth = [int][Math]::Round(620 * $scale)
    $overlayHeight = [int][Math]::Round(92 * $scale)
    $overlayLeft = [int][Math]::Round(($foregroundMonitor.rcMonitor.Left + $foregroundMonitor.rcMonitor.Right - $overlayWidth) / 2)
    $overlayRight = $overlayLeft + $overlayWidth
    $overlayTop = $foregroundMonitor.rcMonitor.Top
    $overlayBottom = $overlayTop + $overlayHeight
    $coversMonitor = $validWindow -and
      $rect.Left -le ($foregroundMonitor.rcMonitor.Left + 2) -and
      $rect.Top -le ($foregroundMonitor.rcMonitor.Top + 2) -and
      $rect.Right -ge ($foregroundMonitor.rcMonitor.Right - 2) -and
      $rect.Bottom -ge ($foregroundMonitor.rcMonitor.Bottom - 2)
    $intersectsTop = $validWindow -and
      $rect.Right -gt $overlayLeft -and $rect.Left -lt $overlayRight -and
      $rect.Bottom -gt $overlayTop -and $rect.Top -lt $overlayBottom
    $cursorTolerance = [Math]::Max(10, [int][Math]::Round(10 * $scale))
    $cursorAtTop = $cursor.Y -ge $cursorMonitor.rcMonitor.Top -and $cursor.Y -le ($cursorMonitor.rcMonitor.Top + $cursorTolerance)
    $state = [ordered]@{
      foregroundPid = [int]$windowPid
      blocking = ($validWindow -and ([int64]$hwnd -ne $overlayHandle))
      visible = [bool]$validWindow
      windowClass = $windowClass
      dpi = [int]$dpi
      fullscreen = [bool]$coversMonitor
      intersectsTop = [bool]$intersectsTop
      rect = [ordered]@{ left=$rect.Left; top=$rect.Top; right=$rect.Right; bottom=$rect.Bottom }
      monitor = [ordered]@{ left=$foregroundMonitor.rcMonitor.Left; top=$foregroundMonitor.rcMonitor.Top; right=$foregroundMonitor.rcMonitor.Right; bottom=$foregroundMonitor.rcMonitor.Bottom }
      cursorAtTop = [bool]$cursorAtTop
      cursor = [ordered]@{ x=$cursor.X; y=$cursor.Y }
      leftClicked = [bool]$leftClicked
      cursorMonitor = [ordered]@{ left=$cursorMonitor.rcMonitor.Left; top=$cursorMonitor.rcMonitor.Top; right=$cursorMonitor.rcMonitor.Right; bottom=$cursorMonitor.rcMonitor.Bottom }
    }
    $json = $state | ConvertTo-Json -Compress -Depth 3
    if ($json -ne $last) { [Console]::Out.WriteLine($json); [Console]::Out.Flush(); $last = $json }
  } catch {
    $errorJson = '{"probeError":"WINDOW_PROBE_FAILED"}'
    if ($last -ne $errorJson) { [Console]::Out.WriteLine($errorJson); [Console]::Out.Flush(); $last = $errorJson }
  }
  Start-Sleep -Milliseconds 80
}`;
}

function speechRecognitionScript() {
  return String.raw`
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
  Add-Type -AssemblyName System.Speech
  Add-Type -ReferencedAssemblies System.Speech @"
using System;
using System.Globalization;
using System.Linq;
using System.Speech.Recognition;
using System.Text;
public static class LFVoiceSpeechRunner {
  public static void Run(string wakeWord) {
    SpeechRecognitionEngine engine = null;
    try {
      var recognizers = SpeechRecognitionEngine.InstalledRecognizers();
      var info = recognizers.FirstOrDefault(item => item.Culture.Name.Equals("zh-CN", StringComparison.OrdinalIgnoreCase))
        ?? recognizers.FirstOrDefault(item => item.Culture.TwoLetterISOLanguageName.Equals("zh", StringComparison.OrdinalIgnoreCase));
      if (info == null) {
        Console.WriteLine("UNAVAILABLE\t" + Convert.ToBase64String(Encoding.UTF8.GetBytes("NO_ZH_RECOGNIZER")));
        return;
      }
      engine = new SpeechRecognitionEngine(info.Id);
      var compactWake = new string((wakeWord ?? "").Where(value => !Char.IsWhiteSpace(value) && !Char.IsPunctuation(value) && !Char.IsSymbol(value)).ToArray());
      var spacedWake = String.Join(" ", compactWake.ToCharArray());
      var commands = new [] { "播放", "继续播放", "暂停", "暂停播放", "上一首", "下一首", "搜索歌曲" };
      var wakeVariants = new [] { compactWake, spacedWake }.Where(value => !String.IsNullOrWhiteSpace(value)).Distinct().ToArray();
      var phrases = wakeVariants.Concat(commands).Concat(wakeVariants.SelectMany(wake => commands.Select(command => wake + command))).Distinct().ToArray();
      var grammarLoaded = false;
      try {
        var choices = new Choices(phrases);
        var builder = new GrammarBuilder { Culture = info.Culture };
        builder.Append(choices);
        engine.LoadGrammar(new Grammar(builder));
        grammarLoaded = true;
      } catch {}
      try { engine.LoadGrammar(new DictationGrammar()); grammarLoaded = true; } catch {}
      if (!grammarLoaded) {
        Console.WriteLine("UNAVAILABLE\t" + Convert.ToBase64String(Encoding.UTF8.GetBytes("ZH_GRAMMAR_UNAVAILABLE")));
        return;
      }
      engine.SpeechRecognized += (sender, args) => {
        if (args.Result == null || String.IsNullOrWhiteSpace(args.Result.Text)) return;
        string encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(args.Result.Text));
        Console.WriteLine("TEXT\t" + args.Result.Confidence.ToString(CultureInfo.InvariantCulture) + "\t" + encoded);
      };
      engine.SpeechRecognitionRejected += (sender, args) => Console.WriteLine("REJECTED");
      engine.SetInputToDefaultAudioDevice();
      engine.RecognizeAsync(RecognizeMode.Multiple);
      Console.WriteLine("READY\t" + info.Culture.Name);
      string line;
      while ((line = Console.ReadLine()) != null && !line.Equals("STOP", StringComparison.OrdinalIgnoreCase)) {}
      try { engine.RecognizeAsyncCancel(); } catch {}
      try { engine.RecognizeAsyncStop(); } catch {}
    } catch (Exception error) {
      Console.WriteLine("UNAVAILABLE\t" + Convert.ToBase64String(Encoding.UTF8.GetBytes(error.GetType().Name + ":" + error.Message)));
    } finally {
      if (engine != null) engine.Dispose();
    }
  }
}
"@
  $wake = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:LF_VOICE_WAKE_WORD_B64))
  [LFVoiceSpeechRunner]::Run($wake)
} catch {
  $message = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($_.Exception.GetType().Name + ":" + $_.Exception.Message))
  [Console]::Out.WriteLine("UNAVAILABLE" + [char]9 + $message)
  [Console]::Out.Flush()
}`;
}

function createVoiceAssistantController(options = {}) {
  const {
    app,
    BrowserWindow,
    ipcMain,
    screen,
    session,
    shell,
    dialog,
    getMainWindow,
    getAppOrigin,
    getOverlayUrl,
    log,
  } = options;
  if (!app || !BrowserWindow || !ipcMain || !screen || !session || !shell || !dialog
    || typeof dialog.showMessageBox !== 'function' || typeof getMainWindow !== 'function') {
    throw new Error('LF_VOICE_ASSISTANT_INVALID_DEPENDENCIES');
  }

  let config = { ...DEFAULT_CONFIG };
  let playback = { ...DEFAULT_PLAYBACK };
  let overlayWindow = null;
  let foregroundProbe = null;
  let foregroundGeneration = 0;
  let foregroundRestartTimer = null;
  let foregroundRestartAttempts = 0;
  let foregroundBuffer = '';
  let foregroundState = null;
  let speechProcess = null;
  let speechBuffer = '';
  let speechExpectedStop = false;
  let speechGeneration = 0;
  let speechRestartTimer = null;
  let speechRestartAttempts = 0;
  let recognition = { state: 'stopped', available: process.platform === 'win32', reason: '' };
  let overlayOpen = false;
  let overlayDismissed = false;
  let overlayOpenedAt = 0;
  let voiceArmedUntil = 0;
  let voiceArmedTimer = null;
  let activeDisplayId = null;
  let lastPublished = '';
  let disposed = false;
  let permissionHandlersInstalled = false;
  const permissionPromptPromises = { audio: null, video: null };
  const permissionGrants = { audio: false, video: false };
  let displayListenersAttached = false;

  const isTestEnvironment = () => TEST_ENV_KEYS.some(key => process.env[key] === '1');
  const safeLog = (message, error) => {
    if (typeof log === 'function') log(message, error);
  };
  const mainWindow = () => {
    const candidate = getMainWindow();
    return candidate && !candidate.isDestroyed() ? candidate : null;
  };
  const isMainSender = event => {
    const owner = mainWindow();
    return !!(owner && event && event.sender === owner.webContents && !event.sender.isDestroyed());
  };
  const isOverlaySender = event => !!(
    overlayWindow && !overlayWindow.isDestroyed() && event && event.sender === overlayWindow.webContents && !event.sender.isDestroyed()
  );

  function monitorToDisplay(monitor) {
    if (!monitor || !Number.isFinite(Number(monitor.left)) || !Number.isFinite(Number(monitor.right))) return null;
    const physicalPoint = {
      x: Math.round((Number(monitor.left) + Number(monitor.right)) / 2),
      y: Math.round((Number(monitor.top) + Number(monitor.bottom)) / 2),
    };
    let point = physicalPoint;
    try {
      if (typeof screen.screenToDipPoint === 'function') point = screen.screenToDipPoint(physicalPoint);
    } catch (_) {}
    try { return screen.getDisplayNearestPoint(point); } catch (_) { return null; }
  }

  function targetDisplay() {
    const topEdgeDisplay = foregroundState && foregroundState.cursorAtTop
      ? monitorToDisplay(foregroundState.cursorMonitor)
      : null;
    if (config.topEdgeWake && topEdgeDisplay) return topEdgeDisplay;
    return monitorToDisplay(foregroundState && foregroundState.monitor) || screen.getPrimaryDisplay();
  }

  function overlayBounds(display) {
    const bounds = display && display.bounds ? display.bounds : screen.getPrimaryDisplay().bounds;
    const workArea = display && display.workArea ? display.workArea : bounds;
    const width = Math.max(360, Math.min(620, workArea.width - 24));
    const height = 92;
    return {
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: Math.round(Math.max(bounds.y + 8, workArea.y + 8)),
      width,
      height,
    };
  }

  function sameDisplay(left, right) {
    return !!(left && right && String(left.id) === String(right.id));
  }

  function foregroundRectInDip() {
    const rect = foregroundState && foregroundState.rect;
    if (!rect) return null;
    const physical = {
      x: Number(rect.left) || 0,
      y: Number(rect.top) || 0,
      width: Math.max(0, (Number(rect.right) || 0) - (Number(rect.left) || 0)),
      height: Math.max(0, (Number(rect.bottom) || 0) - (Number(rect.top) || 0)),
    };
    try {
      if (typeof screen.screenToDipRect === 'function') return screen.screenToDipRect(null, physical);
    } catch (_) {}
    const scale = Math.max(0.5, (Number(foregroundState && foregroundState.dpi) || 96) / 96);
    return { x: physical.x / scale, y: physical.y / scale, width: physical.width / scale, height: physical.height / scale };
  }

  function rectanglesIntersect(left, right) {
    return !!(left && right
      && left.x < right.x + right.width && left.x + left.width > right.x
      && left.y < right.y + right.height && left.y + left.height > right.y);
  }

  function visibilityState() {
    const display = targetDisplay();
    const topEdgeActive = !!(config.topEdgeWake && foregroundState && foregroundState.cursorAtTop);
    const explicitlyOpen = overlayOpen || topEdgeActive;
    const awaitingProbe = process.platform === 'win32' && !foregroundState && !explicitlyOpen;
    const foregroundDisplay = monitorToDisplay(foregroundState && foregroundState.monitor);
    const exactTopOverlap = rectanglesIntersect(foregroundRectInDip(), overlayBounds(display));
    const obstructed = !!(
      foregroundState && foregroundState.blocking && foregroundState.visible && sameDisplay(display, foregroundDisplay)
      && (foregroundState.fullscreen || exactTopOverlap)
    );
    return {
      display,
      explicitlyOpen,
      obstructed,
      visible: config.enabled && !overlayDismissed && !awaitingProbe && (explicitlyOpen || !obstructed),
      reason: overlayDismissed ? 'outside-click-dismissed' : awaitingProbe ? 'awaiting-foreground-probe' : topEdgeActive ? 'top-edge-open' : overlayOpen ? 'explicit-open' : obstructed ? (foregroundState.fullscreen ? 'foreground-fullscreen' : 'foreground-top-overlap') : 'clear',
    };
  }

  function publicState() {
    const visibility = visibilityState();
    return {
      enabled: config.enabled,
      voiceWake: config.voiceWake,
      songSync: config.songSync,
      topEdgeWake: config.topEdgeWake,
      wakeWord: config.wakeWord,
      playback: config.songSync ? playback : { ...DEFAULT_PLAYBACK },
      recognition: { ...recognition },
      visible: visibility.visible,
      visibilityReason: visibility.reason,
      overlayOpen,
      overlayDismissed,
      listeningForCommand: Date.now() < voiceArmedUntil,
    };
  }

  function publishState(force = false) {
    const state = publicState();
    const serialized = JSON.stringify(state);
    if (!force && serialized === lastPublished) return;
    lastPublished = serialized;
    const owner = mainWindow();
    if (owner && !owner.webContents.isDestroyed()) owner.webContents.send(CHANNELS.status, state);
    if (overlayWindow && !overlayWindow.isDestroyed() && !overlayWindow.webContents.isDestroyed()) {
      overlayWindow.webContents.send(CHANNELS.overlayState, state);
    }
  }

  function updateOverlayVisibility() {
    if (!config.enabled) return;
    const win = ensureOverlayWindow();
    if (!win || win.isDestroyed()) return;
    const visibility = visibilityState();
    const bounds = overlayBounds(visibility.display);
    if (String(activeDisplayId) !== String(visibility.display.id)) {
      activeDisplayId = visibility.display.id;
      win.setBounds(bounds, false);
    } else {
      const current = win.getBounds();
      if (current.x !== bounds.x || current.y !== bounds.y || current.width !== bounds.width || current.height !== bounds.height) {
        win.setBounds(bounds, false);
      }
    }
    if (visibility.visible) {
      if (!win.isVisible()) win.showInactive();
    } else if (win.isVisible()) {
      win.hide();
    }
    publishState();
  }

  function openOverlay() {
    if (!config.enabled) return false;
    overlayOpen = true;
    overlayDismissed = false;
    overlayOpenedAt = Date.now();
    updateOverlayVisibility();
    return true;
  }

  function cursorPointInOverlay(cursor) {
    if (!cursor || !overlayWindow || overlayWindow.isDestroyed()) return false;
    let point = { x: Number(cursor.x) || 0, y: Number(cursor.y) || 0 };
    try {
      if (typeof screen.screenToDipPoint === 'function') point = screen.screenToDipPoint(point);
    } catch (_) {}
    const bounds = overlayWindow.getBounds();
    return point.x >= bounds.x && point.x < bounds.x + bounds.width
      && point.y >= bounds.y && point.y < bounds.y + bounds.height;
  }

  function dismissFromOutsideClick(cursor) {
    if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible()) return false;
    if (Date.now() - overlayOpenedAt < 180 || cursorPointInOverlay(cursor)) return false;
    overlayOpen = false;
    overlayDismissed = true;
    updateOverlayVisibility();
    return true;
  }

  function emitCommand(action, detail = {}, source = 'voice') {
    const safeAction = clampText(action, 24);
    if (!ALLOWED_COMMANDS.has(safeAction)) return false;
    const command = { action: safeAction, source: clampText(source, 24) || 'voice', at: Date.now() };
    if (safeAction === 'search') {
      command.query = clampText(detail && detail.query, 120);
      if (!command.query) return false;
    }
    if (source === 'voice') command.wakeMatched = detail && detail.wakeMatched !== false;
    if (safeAction === 'show') openOverlay();
    const owner = mainWindow();
    if (!owner || owner.webContents.isDestroyed()) return false;
    owner.webContents.send(CHANNELS.command, command);
    return true;
  }

  function handleTranscript(text, confidence) {
    if (!config.enabled || !config.voiceWake) return;
    const transcript = clampText(text, 256);
    if (!transcript) return;
    const woke = normalizeSpeech(transcript).includes(normalizeSpeech(config.wakeWord));
    if (woke) {
      voiceArmedUntil = Date.now() + 9000;
      if (voiceArmedTimer) clearTimeout(voiceArmedTimer);
      voiceArmedTimer = setTimeout(() => {
        voiceArmedTimer = null;
        voiceArmedUntil = 0;
        if (recognition.state === 'command') recognition = { ...recognition, state: 'listening' };
        publishState(true);
      }, 9020);
      if (typeof voiceArmedTimer.unref === 'function') voiceArmedTimer.unref();
      openOverlay();
      recognition = { ...recognition, state: 'command', lastEvent: 'recognized', reason: '', lastConfidence: finiteNumber(confidence, 0, 1, 0) };
      publishState(true);
    }
    const owner = mainWindow();
    if (owner && !owner.webContents.isDestroyed()) owner.webContents.send(CHANNELS.command, {
      text: transcript,
      source: 'voice',
      final: true,
      confidence: finiteNumber(confidence, 0, 1, 0),
      wakeMatched: woke,
      at: Date.now(),
    });
  }

  function scheduleForegroundProbeRestart(reason) {
    foregroundState = null;
    activeDisplayId = null;
    updateOverlayVisibility();
    if (!config.enabled || disposed || foregroundRestartTimer || foregroundRestartAttempts >= 4) return;
    const delays = [500, 1500, 4000, 8000];
    const delay = delays[foregroundRestartAttempts] || delays[delays.length - 1];
    foregroundRestartAttempts += 1;
    safeLog(`LF voice foreground probe restart scheduled (${reason || 'unknown'}, attempt ${foregroundRestartAttempts})`);
    foregroundRestartTimer = setTimeout(() => {
      foregroundRestartTimer = null;
      if (config.enabled && !disposed) startForegroundProbe();
    }, delay);
    if (typeof foregroundRestartTimer.unref === 'function') foregroundRestartTimer.unref();
  }

  function failForegroundProbe(child, generation, reason, error) {
    if (generation !== foregroundGeneration || foregroundProbe !== child) return;
    foregroundGeneration += 1;
    foregroundProbe = null;
    foregroundBuffer = '';
    try { child.kill(); } catch (_) {}
    if (error) safeLog(`LF voice foreground probe failed (${reason || 'unknown'})`, error);
    scheduleForegroundProbeRestart(reason);
  }

  function handleForegroundLine(line, child, generation) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.probeError) {
        failForegroundProbe(child, generation, 'probe-error');
        return;
      }
      foregroundRestartAttempts = 0;
      const wasAtTop = !!(foregroundState && foregroundState.cursorAtTop);
      foregroundState = parsed;
      if (config.topEdgeWake && parsed.cursorAtTop && !wasAtTop) openOverlay();
      if (parsed.leftClicked === true && dismissFromOutsideClick(parsed.cursor)) return;
      updateOverlayVisibility();
    } catch (error) {
      failForegroundProbe(child, generation, 'invalid-output', error);
    }
  }

  function handleDisplayChange() {
    activeDisplayId = null;
    if (config.enabled) updateOverlayVisibility();
  }

  function attachDisplayListeners() {
    if (displayListenersAttached) return;
    displayListenersAttached = true;
    screen.on('display-added', handleDisplayChange);
    screen.on('display-removed', handleDisplayChange);
    screen.on('display-metrics-changed', handleDisplayChange);
  }

  function detachDisplayListeners() {
    if (!displayListenersAttached) return;
    displayListenersAttached = false;
    screen.removeListener('display-added', handleDisplayChange);
    screen.removeListener('display-removed', handleDisplayChange);
    screen.removeListener('display-metrics-changed', handleDisplayChange);
  }

  function startForegroundProbe() {
    if (!config.enabled) return;
    attachDisplayListeners();
    if (foregroundProbe || foregroundRestartTimer || process.platform !== 'win32') return;
    const generation = ++foregroundGeneration;
    let overlayHandle = '0';
    try {
      const handle = overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow.getNativeWindowHandle() : null;
      if (handle) overlayHandle = handle.length >= 8 && typeof handle.readBigUInt64LE === 'function'
        ? handle.readBigUInt64LE(0).toString()
        : String(handle.readUInt32LE(0));
    } catch (_) {}
    try {
      const child = spawn('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', encodedPowerShell(foregroundMonitorScript(overlayHandle)),
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      foregroundProbe = child;
      child.stdout.on('data', chunk => {
        if (generation !== foregroundGeneration || foregroundProbe !== child) return;
        foregroundBuffer += chunk.toString('utf8');
        const lines = foregroundBuffer.split(/\r?\n/);
        foregroundBuffer = lines.pop() || '';
        lines.map(value => value.trim()).filter(Boolean).forEach(line => handleForegroundLine(line, child, generation));
      });
      child.stderr.on('data', chunk => {
        const message = chunk.toString('utf8').trim();
        if (message && !/^#< CLIXML\s*$/i.test(message)) failForegroundProbe(child, generation, 'stderr', new Error(message.slice(0, 800)));
      });
      child.once('exit', () => {
        if (generation !== foregroundGeneration || foregroundProbe !== child) return;
        foregroundProbe = null;
        foregroundBuffer = '';
        scheduleForegroundProbeRestart('unexpected-exit');
      });
      child.once('error', error => {
        failForegroundProbe(child, generation, 'process-error', error);
      });
    } catch (error) {
      foregroundProbe = null;
      foregroundBuffer = '';
      safeLog('LF voice foreground probe could not start', error);
      scheduleForegroundProbeRestart('spawn-error');
    }
  }

  function stopForegroundProbe() {
    detachDisplayListeners();
    if (foregroundRestartTimer) clearTimeout(foregroundRestartTimer);
    foregroundRestartTimer = null;
    foregroundRestartAttempts = 0;
    const child = foregroundProbe;
    foregroundGeneration += 1;
    foregroundProbe = null;
    foregroundBuffer = '';
    foregroundState = null;
    if (!child) return;
    try { child.kill(); } catch (_) {}
  }

  function decodeSpeechError(value) {
    try { return Buffer.from(String(value || ''), 'base64').toString('utf8').slice(0, 240); } catch (_) { return 'SPEECH_UNAVAILABLE'; }
  }

  function handleSpeechLine(line) {
    const parts = line.split('\t');
    if (parts[0] === 'READY') {
      speechRestartAttempts = 0;
      recognition = { state: 'listening', available: true, culture: clampText(parts[1], 24), reason: '' };
      publishState(true);
      return;
    }
    if (parts[0] === 'UNAVAILABLE') {
      recognition = { state: 'unavailable', available: false, reason: decodeSpeechError(parts[1]) || clampText(parts[1], 240) };
      publishState(true);
      return;
    }
    if (parts[0] === 'REJECTED') {
      recognition = { ...recognition, state: 'listening', available: true, lastEvent: 'rejected', reason: 'SPEECH_REJECTED' };
      publishState(true);
      return;
    }
    if (parts[0] === 'TEXT' && parts[2]) {
      let transcript = '';
      try { transcript = Buffer.from(parts[2], 'base64').toString('utf8'); } catch (_) {}
      if (transcript) handleTranscript(transcript, Number(parts[1]));
    }
  }

  function scheduleSpeechRestart(reason) {
    if (!config.enabled || !config.voiceWake || disposed || speechRestartTimer || speechRestartAttempts >= 4) return;
    if (recognition.reason === 'NO_ZH_RECOGNIZER' || recognition.reason === 'ZH_GRAMMAR_UNAVAILABLE') return;
    const delays = [500, 1500, 4000, 8000];
    const delay = delays[speechRestartAttempts] || delays[delays.length - 1];
    speechRestartAttempts += 1;
    speechRestartTimer = setTimeout(() => {
      speechRestartTimer = null;
      if (config.enabled && config.voiceWake && !disposed) startSpeechRecognition();
    }, delay);
    if (typeof speechRestartTimer.unref === 'function') speechRestartTimer.unref();
    safeLog(`LF voice recognizer restart scheduled (${reason || 'unknown'}, attempt ${speechRestartAttempts})`);
  }

  function startSpeechRecognition() {
    if (!config.enabled || !config.voiceWake || speechProcess) return;
    if (process.platform !== 'win32') {
      recognition = { state: 'unavailable', available: false, reason: 'WINDOWS_SYSTEM_SPEECH_REQUIRED' };
      publishState(true);
      return;
    }
    recognition = { state: 'starting', available: true, reason: '' };
    publishState(true);
    speechExpectedStop = false;
    const generation = ++speechGeneration;
    try {
      const child = spawn('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', encodedPowerShell(speechRecognitionScript()),
      ], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, LF_VOICE_WAKE_WORD_B64: Buffer.from(config.wakeWord, 'utf8').toString('base64') },
      });
      speechProcess = child;
      child.stdout.on('data', chunk => {
        if (generation !== speechGeneration || speechProcess !== child) return;
        speechBuffer += chunk.toString('utf8');
        const lines = speechBuffer.split(/\r?\n/);
        speechBuffer = lines.pop() || '';
        lines.map(value => value.trim()).filter(Boolean).forEach(handleSpeechLine);
      });
      child.stderr.on('data', chunk => safeLog('LF System.Speech stderr', new Error(chunk.toString('utf8').slice(0, 800))));
      child.once('error', error => {
        if (generation !== speechGeneration || speechProcess !== child) return;
        speechProcess = null;
        speechBuffer = '';
        recognition = { state: 'unavailable', available: false, reason: clampText(error.message, 240) || 'SPEECH_PROCESS_FAILED' };
        publishState(true);
        scheduleSpeechRestart('process-error');
      });
      child.once('exit', () => {
        if (generation !== speechGeneration || speechProcess !== child) return;
        speechProcess = null;
        speechBuffer = '';
        if (!speechExpectedStop && config.enabled && config.voiceWake) {
          if (recognition.state !== 'unavailable') recognition = { state: 'unavailable', available: false, reason: 'SPEECH_PROCESS_EXITED' };
          scheduleSpeechRestart('unexpected-exit');
        } else if (speechExpectedStop) {
          recognition = { state: 'stopped', available: process.platform === 'win32', reason: '' };
        }
        publishState(true);
      });
    } catch (error) {
      speechProcess = null;
      recognition = { state: 'unavailable', available: false, reason: clampText(error.message, 240) || 'SPEECH_PROCESS_FAILED' };
      publishState(true);
      scheduleSpeechRestart('spawn-error');
    }
  }

  function stopSpeechRecognition() {
    const child = speechProcess;
    speechGeneration += 1;
    speechExpectedStop = true;
    if (speechRestartTimer) clearTimeout(speechRestartTimer);
    speechRestartTimer = null;
    speechRestartAttempts = 0;
    speechProcess = null;
    speechBuffer = '';
    voiceArmedUntil = 0;
    if (voiceArmedTimer) clearTimeout(voiceArmedTimer);
    voiceArmedTimer = null;
    recognition = { state: 'stopped', available: process.platform === 'win32', reason: '' };
    if (!child) {
      publishState(true);
      return;
    }
    try { child.stdin.write('STOP\n'); child.stdin.end(); } catch (_) {}
    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) {}
    }, 900);
    if (typeof timer.unref === 'function') timer.unref();
    child.once('exit', () => clearTimeout(timer));
    publishState(true);
  }

  function ensureOverlayWindow() {
    if (!config.enabled || disposed) return null;
    if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;
    const display = targetDisplay();
    overlayWindow = new BrowserWindow({
      ...overlayBounds(display),
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      show: false,
      autoHideMenuBar: true,
      title: 'LumiField Voice Assistant',
      webPreferences: {
        preload: path.join(__dirname, 'lf-voice-overlay-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: true,
        devTools: isTestEnvironment(),
      },
    });
    activeDisplayId = display.id;
    try {
      overlayWindow.setAlwaysOnTop(true, 'floating');
      overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch (_) {}
    overlayWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    overlayWindow.webContents.on('will-navigate', (event, url) => {
      const expected = typeof getOverlayUrl === 'function' ? getOverlayUrl() : '';
      if (url !== expected) event.preventDefault();
    });
    overlayWindow.once('ready-to-show', updateOverlayVisibility);
    overlayWindow.webContents.once('did-finish-load', () => publishState(true));
    overlayWindow.on('closed', () => {
      overlayWindow = null;
      activeDisplayId = null;
    });
    const url = typeof getOverlayUrl === 'function' ? getOverlayUrl() : '';
    overlayWindow.loadURL(url).catch(error => safeLog('LF voice overlay failed to load', error));
    return overlayWindow;
  }

  function destroyOverlayWindow() {
    const win = overlayWindow;
    overlayWindow = null;
    activeDisplayId = null;
    if (win && !win.isDestroyed()) win.destroy();
  }

  function stopRuntime() {
    overlayOpen = false;
    overlayDismissed = false;
    overlayOpenedAt = 0;
    stopForegroundProbe();
    detachDisplayListeners();
    stopSpeechRecognition();
    destroyOverlayWindow();
    lastPublished = '';
  }

  function applyConfig(nextValue) {
    const previous = config;
    config = sanitizeConfig(nextValue, config);
    if (!config.enabled) {
      stopRuntime();
      publishState(true);
      return publicState();
    }
    ensureOverlayWindow();
    startForegroundProbe();
    const restartSpeech = previous.wakeWord !== config.wakeWord && !!speechProcess;
    if (!config.voiceWake) stopSpeechRecognition();
    else if (restartSpeech) {
      stopSpeechRecognition();
      speechRestartTimer = setTimeout(() => {
        speechRestartTimer = null;
        startSpeechRecognition();
      }, 950);
      if (typeof speechRestartTimer.unref === 'function') speechRestartTimer.unref();
    } else startSpeechRecognition();
    if (nextValue && nextValue.show === true) openOverlay();
    updateOverlayVisibility();
    publishState(true);
    return publicState();
  }

  function installPermissionHandlers() {
    if (permissionHandlersInstalled) return;
    const targetSession = session.defaultSession;
    if (!targetSession) return;
    const isSameOriginMainMedia = (webContents, permission, origin, details = {}) => {
      const owner = mainWindow();
      if (!owner || webContents !== owner.webContents || permission !== 'media') return false;
      let expectedOrigin = '';
      try { expectedOrigin = new URL(String(typeof getAppOrigin === 'function' ? getAppOrigin() : '')).origin; } catch (_) {}
      let requestOrigin = '';
      try { requestOrigin = new URL(String(origin || details.requestingUrl || details.securityOrigin || '')).origin; } catch (_) {}
      return !!expectedOrigin && requestOrigin === expectedOrigin;
    };
    const mediaKind = (details = {}) => {
      const mediaTypes = Array.isArray(details.mediaTypes) ? details.mediaTypes.map(String) : [];
      if (mediaTypes.length > 0 && mediaTypes.every(type => type === 'audio')) return 'audio';
      if (mediaTypes.length > 0 && mediaTypes.every(type => type === 'video')) return 'video';
      return '';
    };
    targetSession.setPermissionCheckHandler((webContents, permission, origin, details = {}) => {
      const kind = String(details.mediaType || '');
      return (kind === 'audio' || kind === 'video')
        && permissionGrants[kind] === true
        && isSameOriginMainMedia(webContents, permission, origin, details);
    });
    targetSession.setPermissionRequestHandler((webContents, permission, callback, details = {}) => {
      const origin = details && (details.requestingUrl || details.securityOrigin);
      const kind = mediaKind(details);
      if (!kind || !isSameOriginMainMedia(webContents, permission, origin, details)) {
        callback(false);
        return;
      }
      if (permissionGrants[kind] === true) {
        callback(true);
        return;
      }
      if (kind === 'audio' && process.env.LF_VOICE_TEST_ALLOW_MIC === '1' && isTestEnvironment()) {
        permissionGrants.audio = true;
        callback(true);
        return;
      }
      if (!permissionPromptPromises[kind]) {
        const isAudio = kind === 'audio';
        permissionPromptPromises[kind] = dialog.showMessageBox(mainWindow(), {
          type: 'question',
          title: isAudio ? 'LumiField 麦克风权限' : 'LumiField 摄像头权限',
          message: isAudio ? '是否允许 LumiField 使用麦克风？' : '是否允许 LumiField 使用摄像头？',
          detail: isAudio
            ? '麦克风仅用于本地语音唤醒和 LF 播放命令。'
            : '摄像头仅用于 LF 视觉舞台的手势控制。',
          buttons: ['允许', '取消'],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        }).then(result => {
          const allowed = result.response === 0;
          if (allowed) permissionGrants[kind] = true;
          return allowed;
        }).catch(() => false).finally(() => {
          permissionPromptPromises[kind] = null;
        });
      }
      permissionPromptPromises[kind].then(allowed => callback(!disposed && allowed === true));
    });
    permissionHandlersInstalled = true;
  }

  function registerIpc() {
    ipcMain.handle(CHANNELS.configure, (event, value) => {
      if (!isMainSender(event)) return { ok: false, error: 'INVALID_SENDER' };
      return { ok: true, state: applyConfig(value) };
    });
    ipcMain.handle(CHANNELS.playback, (event, value) => {
      if (!isMainSender(event)) return { ok: false, error: 'INVALID_SENDER' };
      playback = sanitizePlayback(value);
      publishState();
      return { ok: true };
    });
    ipcMain.handle(CHANNELS.show, event => {
      if (!isMainSender(event)) return { ok: false, error: 'INVALID_SENDER' };
      return { ok: openOverlay(), enabled: config.enabled };
    });
    ipcMain.handle(CHANNELS.settings, event => {
      if (!isMainSender(event)) return { ok: false, error: 'INVALID_SENDER' };
      return shell.openExternal('ms-settings:privacy-microphone')
        .then(() => ({ ok: true }))
        .catch(error => ({ ok: false, error: clampText(error && error.message, 240) || 'MICROPHONE_SETTINGS_FAILED' }));
    });
    ipcMain.handle(CHANNELS.overlayAction, (event, action) => {
      if (!isOverlaySender(event)) return { ok: false, error: 'INVALID_SENDER' };
      const safeAction = clampText(action, 24);
      if (!OVERLAY_COMMANDS.has(safeAction)) return { ok: false, error: 'INVALID_ACTION' };
      return { ok: emitCommand(safeAction, {}, 'overlay'), action: safeAction };
    });
    ipcMain.handle(CHANNELS.overlayReady, event => {
      if (!isOverlaySender(event)) return { ok: false, error: 'INVALID_SENDER' };
      publishState(true);
      return { ok: true, state: publicState() };
    });
    ipcMain.handle(CHANNELS.debug, event => {
      if (!isTestEnvironment()) return { ok: false, error: 'TEST_DISABLED' };
      if (!isMainSender(event)) return { ok: false, error: 'INVALID_SENDER' };
      return {
        ok: true,
        config: { ...config },
        playback: { ...playback },
        overlayWindowCount: overlayWindow && !overlayWindow.isDestroyed() ? 1 : 0,
        overlayVisible: !!(overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()),
        foregroundProbeActive: !!foregroundProbe,
        foregroundRestartPending: !!foregroundRestartTimer,
        foregroundRestartAttempts,
        displayListenersAttached,
        speechProcessActive: !!speechProcess,
        speechRestartPending: !!speechRestartTimer,
        speechRestartAttempts,
        recognition: { ...recognition },
        foreground: foregroundState,
        overlayOpen,
        overlayDismissed,
        overlayBounds: overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow.getBounds() : null,
        allowedCommands: Array.from(ALLOWED_COMMANDS),
      };
    });
  }

  installPermissionHandlers();
  registerIpc();

  return {
    applyConfig,
    stopRuntime,
    show: () => openOverlay(),
    getState: publicState,
    dispose() {
      if (disposed) return;
      disposed = true;
      config = { ...config, enabled: false, voiceWake: false };
      stopRuntime();
      if (permissionHandlersInstalled && session.defaultSession) {
        permissionGrants.audio = false;
        permissionGrants.video = false;
        try { session.defaultSession.setPermissionCheckHandler(null); } catch (_) {}
        try { session.defaultSession.setPermissionRequestHandler(null); } catch (_) {}
        permissionHandlersInstalled = false;
      }
      Object.values(CHANNELS).forEach(channel => {
        try { ipcMain.removeHandler(channel); } catch (_) {}
      });
    },
  };
}

module.exports = {
  CHANNELS,
  createVoiceAssistantController,
  sanitizeConfig,
  sanitizePlayback,
};
