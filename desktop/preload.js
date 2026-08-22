const { contextBridge, ipcRenderer, webUtils } = require('electron');

function selectedFilePath(file) {
  try { return file ? webUtils.getPathForFile(file) : ''; } catch (_) { return ''; }
}

function musicPlatformAccountPreferencesPayload(preferences) {
  const source = preferences && typeof preferences === 'object' && !Array.isArray(preferences) ? preferences : {};
  return {
    mode: source.mode,
    activeProvider: source.activeProvider,
    playlistProvider: source.playlistProvider,
    updatedAt: source.updatedAt,
  };
}

function stemStartPayload(file, options) {
  options = options && typeof options === 'object' ? options : {};
  const nested = options.platformStem && typeof options.platformStem === 'object' ? options.platformStem : {};
  const short = value => typeof value === 'string' ? value.slice(0, 16384) : '';
  const decoded = options.decodedWav;
  const decodedWav = decoded instanceof ArrayBuffer
    ? new Uint8Array(decoded)
    : ArrayBuffer.isView(decoded)
      ? new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength)
      : null;
  return {
    inputPath: selectedFilePath(file),
    decodedWav,
    currentAudioUrl: !file ? short(options.currentAudioUrl) : '',
    sourceKey: short(options.sourceKey).slice(0, 512),
    provider: short(options.provider).slice(0, 32),
    quality: options.quality === 'high' ? 'high' : 'fast',
    platformVocalUrl: short(options.platformVocalUrl),
    platformAccompanimentUrl: short(options.platformAccompanimentUrl),
    platformNoVocalsUrl: short(options.platformNoVocalsUrl),
    platformInstrumentalUrl: short(options.platformInstrumentalUrl),
    platformStem: {
      vocalUrl: short(nested.vocalUrl),
      noVocalsUrl: short(nested.noVocalsUrl),
      accompanimentUrl: short(nested.accompanimentUrl),
      instrumentalUrl: short(nested.instrumentalUrl),
      originalUrl: short(nested.originalUrl),
      provider: short(nested.provider).slice(0, 32),
      sourceKey: short(nested.sourceKey).slice(0, 512),
    },
  };
}

function aiAssistantSettingsPatch(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const patch = {};
  if (source.voice && typeof source.voice === 'object' && !Array.isArray(source.voice)) {
    patch.voice = {
      enabled: source.voice.enabled,
      voiceWake: source.voice.voiceWake,
      wakeWord: source.voice.wakeWord,
      songSync: source.voice.songSync,
      topEdgeWake: source.voice.topEdgeWake,
      hotkey: source.voice.hotkey,
    };
  }
  if (source.assistant && typeof source.assistant === 'object' && !Array.isArray(source.assistant)) {
    const providers = {};
    for (const id of ['zhipu', 'groq', 'qwen']) {
      const item = source.assistant.providers && source.assistant.providers[id];
      if (item && typeof item === 'object' && !Array.isArray(item)) providers[id] = {
        model: item.model,
        baseUrl: item.baseUrl,
        freeOnlyAcknowledged: item.freeOnlyAcknowledged,
      };
    }
    patch.assistant = {
      provider: source.assistant.provider,
      responseStyle: source.assistant.responseStyle,
      providers,
    };
  }
  return patch;
}

function aiAssistantQueryPayload(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const context = source.context && typeof source.context === 'object' && !Array.isArray(source.context) ? source.context : {};
  const controls = Array.isArray(context.controls) ? context.controls.slice(0, 160).map(item => {
    const control = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
    return {
      id: String(control.id || '').slice(0, 80),
      kind: String(control.kind || '').slice(0, 12),
      label: String(control.label || '').slice(0, 64),
      inputType: String(control.inputType || '').slice(0, 16),
      value: ['string', 'number', 'boolean'].includes(typeof control.value) ? control.value : '',
      min: Number(control.min),
      max: Number(control.max),
      options: Array.isArray(control.options) ? control.options.slice(0, 16).map(option => ({
        value: String(option && option.value || '').slice(0, 80),
        label: String(option && option.label || '').slice(0, 48),
      })) : [],
    };
  }) : [];
  return {
    text: String(source.text || '').slice(0, 800),
    source: source.source === 'voice' ? 'voice' : 'text',
    explicitUserAction: source.explicitUserAction === true,
    context: {
      playing: context.playing === true,
      title: String(context.title || '').slice(0, 160),
      artist: String(context.artist || '').slice(0, 120),
      position: Number(context.position) || 0,
      duration: Number(context.duration) || 0,
      view: String(context.view || '').slice(0, 32),
      controls,
    },
  };
}

async function requestVoiceAssistantMicrophone() {
  let stream = null;
  try {
    const mediaDevices = globalThis.navigator && globalThis.navigator.mediaDevices;
    if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
      return { ok: false, error: 'MEDIA_DEVICES_UNAVAILABLE' };
    }
    stream = await mediaDevices.getUserMedia({ audio: true, video: false });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: String(error && error.name || 'MICROPHONE_PERMISSION_FAILED').slice(0, 80),
      message: String(error && error.message || '').slice(0, 240),
      denied: !!(error && (error.name === 'NotAllowedError' || error.name === 'SecurityError')),
    };
  } finally {
    if (stream && typeof stream.getTracks === 'function') {
      stream.getTracks().forEach(track => {
        try { track.stop(); } catch (_) {}
      });
    }
  }
}

contextBridge.exposeInMainWorld('desktopWindow', {
  isDesktop: true,
  splashMainPrewarm: process.argv.includes('--lf-splash-main-prewarm=1'),
  minimize: () => ipcRenderer.invoke('desktop-window-minimize'),
  toggleMaximize: () => ipcRenderer.invoke('desktop-window-toggle-maximize'),
  toggleFullscreen: () => ipcRenderer.invoke('desktop-window-toggle-fullscreen'),
  setFullscreen: (enabled) => ipcRenderer.invoke('desktop-window-set-fullscreen', !!enabled),
  exitFullscreenWindowed: () => ipcRenderer.invoke('desktop-window-exit-fullscreen-windowed'),
  setWindowMode: (mode, enabled) => ipcRenderer.invoke('desktop-window-set-mode', String(mode || ''), !!enabled),
  toggleWindowMode: (mode) => ipcRenderer.invoke('desktop-window-toggle-mode', String(mode || 'player-fullscreen')),
  exitWindowModes: (source) => ipcRenderer.invoke('desktop-window-exit-modes', String(source || 'renderer')),
  getState: () => ipcRenderer.invoke('desktop-window-get-state'),
  getSplashDebug: () => process.env.LF_MASTER_TEST === '1' ? ipcRenderer.invoke('lf-splash-main-debug') : Promise.resolve(null),
  onSplashMainReveal: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('lf-splash-main-reveal', listener);
    return () => ipcRenderer.removeListener('lf-splash-main-reveal', listener);
  },
  setBackgroundKeep: (enabled) => ipcRenderer.invoke('desktop-window-set-background-keep', !!enabled),
  close: () => ipcRenderer.invoke('desktop-window-close'),
  onPlaybackStateSaveRequest: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('lumifield-playback-save-request', listener);
    return () => ipcRenderer.removeListener('lumifield-playback-save-request', listener);
  },
  completePlaybackStateSave: (requestId, ok) => ipcRenderer.send('lumifield-playback-save-complete', { requestId:String(requestId || ''), ok:ok === true }),
  openNeteaseMusicLogin: () => ipcRenderer.invoke('music-platform-open-login', 'netease'),
  clearNeteaseMusicLogin: () => ipcRenderer.invoke('music-platform-clear-login', 'netease'),
  openQQMusicLogin: () => ipcRenderer.invoke('music-platform-open-login', 'qq'),
  clearQQMusicLogin: () => ipcRenderer.invoke('music-platform-clear-login', 'qq'),
  openMusicPlatformLogin: (provider) => ipcRenderer.invoke('music-platform-open-login', provider),
  importMusicPlatformCookie: (provider, cookieText) => ipcRenderer.invoke('music-platform-import-cookie', provider, cookieText),
  checkNeteaseQrLogin: (key) => ipcRenderer.invoke('music-platform-check-netease-qr', String(key || '')),
  getMusicPlatformLoginStatus: (provider) => ipcRenderer.invoke('music-platform-login-status', provider),
  getMusicPlatformProfile: (provider) => ipcRenderer.invoke('music-platform-profile', provider),
  getMusicPlatformPlaylists: (provider) => ipcRenderer.invoke('music-platform-playlists', provider),
  clearMusicPlatformLogin: (provider) => ipcRenderer.invoke('music-platform-clear-login', provider),
  setMusicPlatformAccountScope: (token) => ipcRenderer.invoke('music-platform-set-account-scope', token || ''),
  getMusicPlatformAccountScopeDebug: () => ipcRenderer.invoke('music-platform-account-scope-debug'),
  setMusicPlatformTestAccountScope: (userId) => ipcRenderer.invoke('music-platform-set-test-account-scope', String(userId || '')),
  getMusicPlatformAccountPreferences: () => ipcRenderer.invoke('music-platform-account-preferences-read'),
  setMusicPlatformAccountPreferences: (preferences, generation) => ipcRenderer.invoke('music-platform-account-preferences-write', {
    generation,
    preferences: musicPlatformAccountPreferencesPayload(preferences),
  }),
  onMusicPlatformLoginState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('music-platform-login-state', listener);
    return () => ipcRenderer.removeListener('music-platform-login-state', listener);
  },
  restartApp: () => ipcRenderer.invoke('lumifield-restart-app'),
  configureGlobalHotkeys: (bindings) => ipcRenderer.invoke('lumifield-hotkeys-configure-global', bindings || []),
  updateTaskbarPlaybackState: (payload) => ipcRenderer.invoke('lumifield-taskbar-playback-state', {
    playing: payload && payload.playing === true,
    canPrevious: payload && payload.canPrevious === true,
    canNext: payload && payload.canNext === true,
  }),
  getTaskbarToolbarState: () => ipcRenderer.invoke('lumifield-taskbar-toolbar-state'),
  testTaskbarToolbarClick: (action) => ipcRenderer.invoke('lumifield-taskbar-test-click', String(action || '')),
  exportJsonFile: (payload) => ipcRenderer.invoke('lumifield-export-json-file', payload || {}),
  importJsonFile: () => ipcRenderer.invoke('lumifield-import-json-file'),
  getWallpaperProviders: () => ipcRenderer.invoke('lumifield-wallpaper-providers'),
  openWallpaperProvider: (provider) => ipcRenderer.invoke('lumifield-wallpaper-open-provider', provider),
  getWallpaperProjects: (provider) => ipcRenderer.invoke('lumifield-wallpaper-projects', provider),
  selectWallpaperProviderResource: (provider, folderMode) => ipcRenderer.invoke('lumifield-wallpaper-select-provider-resource', { provider, folderMode: !!folderMode }),
  importWallpaperProject: (provider, projectId) => ipcRenderer.invoke('lumifield-wallpaper-import-project', { provider, projectId }),
  lfWallpaperVideoStart: (file, options) => ipcRenderer.invoke('lf-wallpaper-video-start', {
    inputPath: selectedFilePath(file),
    target: options && options.target || 'global',
    display: options && options.display || {},
  }),
  lfWallpaperVideoStatus: (taskId) => ipcRenderer.invoke('lf-wallpaper-video-status', String(taskId || '')),
  lfWallpaperVideoWait: (taskId) => ipcRenderer.invoke('lf-wallpaper-video-wait', String(taskId || '')),
  lfWallpaperVideoCancel: (taskId) => ipcRenderer.invoke('lf-wallpaper-video-cancel', String(taskId || '')),
  lfWallpaperVideoPin: (reference, ownerKey) => ipcRenderer.invoke('lf-wallpaper-video-pin', { reference:reference || {}, ownerKey:String(ownerKey || '') }),
  lfWallpaperVideoUnpin: (reference, ownerKey) => ipcRenderer.invoke('lf-wallpaper-video-unpin', { reference:reference || {}, ownerKey:String(ownerKey || '') }),
  onLFWallpaperVideoProgress: (callback) => {
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('lf-wallpaper-video-progress', listener);
    return () => ipcRenderer.removeListener('lf-wallpaper-video-progress', listener);
  },
  lfStemStatus: (taskId) => ipcRenderer.invoke('lf-stem-status', taskId || ''),
  lfStemStart: (file, options) => ipcRenderer.invoke('lf-stem-start', stemStartPayload(file, options)),
  lfStemWait: (taskId) => ipcRenderer.invoke('lf-stem-wait', taskId || ''),
  lfStemCancel: (taskId) => ipcRenderer.invoke('lf-stem-cancel', taskId || ''),
  onLFStemProgress: (callback) => {
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('lf-stem-progress', listener);
    return () => ipcRenderer.removeListener('lf-stem-progress', listener);
  },
  lfSendCode: (payload) => ipcRenderer.invoke('lf-auth-send-code', payload || {}),
  lfRegister: (payload) => ipcRenderer.invoke('lf-auth-register', payload || {}),
  lfLogin: (payload) => ipcRenderer.invoke('lf-auth-login', payload || {}),
  lfAuthStatus: (token, payload) => ipcRenderer.invoke('lf-auth-status', token || '', payload || {}),
  lfRefresh: (refreshToken) => ipcRenderer.invoke('lf-auth-refresh', refreshToken || ''),
  lfLogout: (token) => ipcRenderer.invoke('lf-auth-logout', token || ''),
  lfSetOnline: (token, online) => ipcRenderer.invoke('lf-auth-set-online', token || '', !!online),
  lfResetPassword: (payload) => ipcRenderer.invoke('lf-auth-reset-password', payload || {}),
  lfChangePassword: (payload) => ipcRenderer.invoke('lf-auth-change-password', payload || {}),
  lfVerifyResetCode: (payload) => ipcRenderer.invoke('lf-auth-verify-reset', payload || {}),
  lfCreateQr: () => ipcRenderer.invoke('lf-auth-create-qr'),
  lfPollQr: (token) => ipcRenderer.invoke('lf-auth-poll-qr', token || ''),
  lfConfirmQr: (payload) => ipcRenderer.invoke('lf-auth-confirm-qr', payload || {}),
  lfOAuthStart: (provider, bind, reauth) => ipcRenderer.invoke('lf-auth-oauth-start', {
    provider: provider || '', bind: !!bind,
    currentPassword: reauth && typeof reauth.currentPassword === 'string' ? reauth.currentPassword : '',
    verificationTicket: reauth && typeof reauth.verificationTicket === 'string' ? reauth.verificationTicket : '',
  }),
  lfOAuthPoll: (pollToken) => ipcRenderer.invoke('lf-auth-oauth-poll', pollToken || ''),
  lfProfile: (token) => ipcRenderer.invoke('lf-profile', token || ''),
  lfIdentities: (token) => ipcRenderer.invoke('lf-identities', token || ''),
  lfBindEmail: (token, payload) => ipcRenderer.invoke('lf-bind-email', token || '', payload || {}),
  lfUnbindIdentity: (token, payload) => ipcRenderer.invoke('lf-unbind-identity', token || '', payload || {}),
  lfCreateFeedbackDraft: (token, payload) => ipcRenderer.invoke('lf-feedback-draft', token || '', payload || {}),
  lfSubmitFeedback: (token, payload) => ipcRenderer.invoke('lf-feedback-submit', token || '', payload || {}),
  lfFeedbackUploadStatus: (token, uploadId) => ipcRenderer.invoke('lf-feedback-upload-status', token || '', uploadId || ''),
  lfUploadFeedbackFile: (token, feedbackId, clientId, file, resumeState) => ipcRenderer.invoke('lf-feedback-upload-file', token || '', feedbackId || '', clientId || '', selectedFilePath(file), { name: file && file.name || '', type: file && file.type || '', size: file && file.size || 0, lastModified: file && file.lastModified || 0 }, resumeState || {}),
  lfCancelFeedbackUpload: (token, clientId, uploadId) => ipcRenderer.invoke('lf-feedback-upload-cancel', token || '', clientId || '', uploadId || ''),
  lfDeleteFeedbackAttachment: (token, attachmentId) => ipcRenderer.invoke('lf-feedback-attachment-delete', token || '', attachmentId || ''),
  lfFinalizeFeedback: (token, feedbackId) => ipcRenderer.invoke('lf-feedback-finalize', token || '', feedbackId || ''),
  onLFFeedbackUploadProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('lf-feedback-upload-progress', listener);
    return () => ipcRenderer.removeListener('lf-feedback-upload-progress', listener);
  },
  lfPrivacyNotice: () => ipcRenderer.invoke('lf-privacy-notice'),
  lfBackendStatus: () => ipcRenderer.invoke('lf-backend-status'),
  lfIntegrityStatus: () => ipcRenderer.invoke('lf-integrity-status'),
  lfAcknowledgeIntegrityWarning: () => ipcRenderer.invoke('lf-integrity-warning-ack'),
  onLFIntegrityStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('lf-integrity-status', listener);
    return () => ipcRenderer.removeListener('lf-integrity-status', listener);
  },
  onLFIntegrityWarning: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('lf-integrity-warning', listener);
    return () => ipcRenderer.removeListener('lf-integrity-warning', listener);
  },
  onLFIntegrityLocked: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('lf-integrity-locked', listener);
    return () => ipcRenderer.removeListener('lf-integrity-locked', listener);
  },
  lfPresetShareCreate: (canonical) => ipcRenderer.invoke('lf-preset-share-create', canonical || {}),
  lfPresetShareRedeem: (code) => ipcRenderer.invoke('lf-preset-share-redeem', String(code || '')),
  lfPresetShareMine: () => ipcRenderer.invoke('lf-preset-share-mine'),
  lfPresetShareRevoke: (shareId) => ipcRenderer.invoke('lf-preset-share-revoke', String(shareId || '')),
  lfRequestDeveloperAccess: (token, payload) => ipcRenderer.invoke('lf-dev-access-request', token || '', payload || {}),
  lfAvailableUpdate: (token, currentVersion) => ipcRenderer.invoke('lf-update-available', token || '', currentVersion || ''),
  lfInstallUpdate: (token, currentVersion) => ipcRenderer.invoke('lf-update-install', token || '', currentVersion || ''),
  onLFUpdateProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('lf-update-progress', listener);
    return () => ipcRenderer.removeListener('lf-update-progress', listener);
  },
  onLFDeveloperShortcutBlocked: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('lf-developer-shortcut-blocked', listener);
    return () => ipcRenderer.removeListener('lf-developer-shortcut-blocked', listener);
  },
  onGlobalHotkey: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('lumifield-global-hotkey', listener);
    return () => ipcRenderer.removeListener('lumifield-global-hotkey', listener);
  },
  configureVoiceAssistant: (config) => ipcRenderer.invoke('lumifield-voice-assistant-configure', config || {}),
  syncVoiceAssistantPlayback: (payload) => ipcRenderer.invoke('lumifield-voice-assistant-playback', payload || {}),
  showVoiceAssistant: () => ipcRenderer.invoke('lumifield-voice-assistant-show'),
  requestVoiceAssistantMicrophone,
  openVoiceAssistantMicrophoneSettings: () => ipcRenderer.invoke('lumifield-voice-assistant-open-microphone-settings'),
  getVoiceAssistantDebug: () => ipcRenderer.invoke('lumifield-voice-assistant-debug'),
  getAIAssistantSettings: () => ipcRenderer.invoke('lumifield-ai-assistant-settings-read'),
  setAIAssistantSettings: (patch) => ipcRenderer.invoke('lumifield-ai-assistant-settings-write', aiAssistantSettingsPatch(patch)),
  setAIAssistantApiKey: (provider, apiKey) => ipcRenderer.invoke('lumifield-ai-assistant-key-set', String(provider || ''), String(apiKey || '')),
  clearAIAssistantApiKey: (provider) => ipcRenderer.invoke('lumifield-ai-assistant-key-clear', String(provider || '')),
  testAIAssistantConnection: (provider) => ipcRenderer.invoke('lumifield-ai-assistant-test-connection', String(provider || '')),
  runAIAssistant: (payload) => ipcRenderer.invoke('lumifield-ai-assistant-query', aiAssistantQueryPayload(payload)),
  openAIProviderKeyPage: (provider) => ipcRenderer.invoke('lumifield-ai-assistant-open-key-url', String(provider || '')),
  getAIAssistantDebug: () => ipcRenderer.invoke('lumifield-ai-assistant-debug'),
  onVoiceAssistantCommand: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('lumifield-voice-assistant-command', listener);
    return () => ipcRenderer.removeListener('lumifield-voice-assistant-command', listener);
  },
  onVoiceAssistantStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('lumifield-voice-assistant-status', listener);
    return () => ipcRenderer.removeListener('lumifield-voice-assistant-status', listener);
  },
  setDesktopLyricsEnabled: (enabled, payload) => ipcRenderer.invoke('lumifield-desktop-lyrics-set-enabled', !!enabled, payload || {}),
  updateDesktopLyrics: (payload) => ipcRenderer.invoke('lumifield-desktop-lyrics-update', payload || {}),
  onDesktopLyricsLockState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('lumifield-desktop-lyrics-lock-state', listener);
    return () => ipcRenderer.removeListener('lumifield-desktop-lyrics-lock-state', listener);
  },
  onDesktopLyricsEnabledState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('lumifield-desktop-lyrics-enabled-state', listener);
    return () => ipcRenderer.removeListener('lumifield-desktop-lyrics-enabled-state', listener);
  },
  setWallpaperMode: (enabled, payload) => ipcRenderer.invoke('lumifield-wallpaper-set-enabled', !!enabled, payload || {}),
  updateWallpaperMode: (payload) => ipcRenderer.invoke('lumifield-wallpaper-update', payload || {}),
  onStateChange: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('desktop-window-state', listener);
    return () => ipcRenderer.removeListener('desktop-window-state', listener);
  },
  onWindowModeExitRequest: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('desktop-window-mode-exit-request', listener);
    return () => ipcRenderer.removeListener('desktop-window-mode-exit-request', listener);
  },
});

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('desktop-shell-root');
  document.body.classList.add('desktop-shell');
});
