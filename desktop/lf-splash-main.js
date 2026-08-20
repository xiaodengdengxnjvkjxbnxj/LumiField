'use strict';

const path = require('path');

const CHANNELS = Object.freeze({
  stageReady: 'lf-splash-stage-ready',
  enter: 'lf-splash-enter',
  debug: 'lf-splash-debug',
  mainDebug: 'lf-splash-main-debug',
  windowAction: 'lf-splash-window-action',
  windowState: 'lf-splash-window-state',
});

function createSplashController(options) {
  const app = options.app;
  const BrowserWindow = options.BrowserWindow;
  const ipcMain = options.ipcMain;
  const publicDir = options.publicDir;
  const preloadPath = options.preloadPath;
  const log = typeof options.log === 'function' ? options.log : function () {};
  const revealMain = typeof options.revealMain === 'function' ? options.revealMain : function (win) {
    win.show();
    win.focus();
  };
  const testBypass = options.testBypass === true;
  const testMode = options.testMode === true;

  let splashWindow = null;
  let mainWindow = null;
  let mainReady = false;
  let stageReady = false;
  let enterRequested = false;
  let revealed = false;
  let disposed = false;
  let recreateTimer = null;
  let recreateCount = 0;
  let enterCount = 0;
  let enterRequestedAt = 0;
  let revealedAt = 0;
  let revealInFlight = false;
  let transitionStartedAt = 0;
  let surfacePrimedAt = 0;
  let userCloseRequested = false;

  function isTrusted(event) {
    return !!(splashWindow && !splashWindow.isDestroyed() && splashWindow.webContents === event.sender);
  }

  function debugState() {
    return {
      version: 1,
      testBypass,
      mainReady,
      stageReady,
      enterRequested,
      enterCount,
      enterRequestedAt,
      revealedAt,
      revealed,
      revealInFlight,
      transitionStartedAt,
      surfacePrimedAt,
      disposed,
      recreateCount,
      splashExists: !!(splashWindow && !splashWindow.isDestroyed()),
      splashVisible: !!(splashWindow && !splashWindow.isDestroyed() && splashWindow.isVisible()),
      splashBounds: splashWindow && !splashWindow.isDestroyed() ? splashWindow.getBounds() : null,
      mainExists: !!(mainWindow && !mainWindow.isDestroyed()),
      mainVisible: !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
    };
  }

  function splashWindowState(win) {
    return {
      isMaximized: !!(win && !win.isDestroyed() && win.isMaximized()),
      isMinimized: !!(win && !win.isDestroyed() && win.isMinimized()),
    };
  }

  function publishSplashWindowState(win) {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send(CHANNELS.windowState, splashWindowState(win));
  }

  function clearRecreateTimer() {
    if (!recreateTimer) return;
    clearTimeout(recreateTimer);
    recreateTimer = null;
  }

  function maybeReveal() {
    if (disposed || revealed || revealInFlight || !mainReady || !enterRequested || !stageReady) return false;
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    revealInFlight = true;
    transitionStartedAt = Date.now();
    clearRecreateTimer();
    const closing = splashWindow;
    Promise.resolve().then(async () => {
      if (!mainWindow || mainWindow.isDestroyed()) throw new Error('MAIN_WINDOW_LOST');
      try { mainWindow.setOpacity(0); } catch (_) {}
      mainWindow.showInactive();
      const ready = await Promise.race([
        mainWindow.webContents.executeJavaScript(
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {' +
            'const root=document.documentElement,body=document.body;' +
            'resolve(!!(document.readyState==="complete"&&root&&body&&root.scrollWidth>0&&root.scrollHeight>0&&' +
              'getComputedStyle(body).visibility!=="hidden"&&body.classList.contains("empty-home-active")));' +
          '})))',
          true,
        ),
        new Promise(resolve => setTimeout(() => resolve(false), 1800)),
      ]);
      if (!ready) log('Main surface priming reached bounded fallback');
      surfacePrimedAt = Date.now();
      splashWindow = null;
      if (closing && !closing.isDestroyed()) closing.destroy();
      try { mainWindow.setOpacity(1); } catch (_) {}
      revealMain(mainWindow);
      revealed = true;
      revealedAt = Date.now();
    }).catch(error => {
      log('Atomic splash handoff failed', error);
      splashWindow = null;
      if (closing && !closing.isDestroyed()) closing.destroy();
      if (mainWindow && !mainWindow.isDestroyed()) {
        try { mainWindow.setOpacity(1); } catch (_) {}
        revealMain(mainWindow);
        revealed = true;
        revealedAt = Date.now();
      }
    }).finally(() => {
      revealInFlight = false;
    });
    return true;
  }

  function scheduleRecreate(reason) {
    if (disposed || revealed || revealInFlight || userCloseRequested || testBypass || recreateTimer) return;
    log(`Splash renderer recovery scheduled: ${reason}`);
    recreateTimer = setTimeout(() => {
      recreateTimer = null;
      if (disposed || revealed) return;
      recreateCount += 1;
      createWindow().catch(error => {
        log('Splash renderer recovery failed', error);
        scheduleRecreate('retry-failed');
      });
    }, Math.min(1800, 350 + recreateCount * 250));
  }

  async function createWindow() {
    if (disposed || revealed || testBypass) return null;
    if (splashWindow && !splashWindow.isDestroyed()) return splashWindow;

    const win = new BrowserWindow({
      width: 600,
      height: 400,
      minWidth: 480,
      minHeight: 320,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      resizable: true,
      movable: true,
      center: true,
      skipTaskbar: false,
      hasShadow: false,
      autoHideMenuBar: true,
      title: 'LumiField',
      icon: options.iconPath,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        devTools: testMode,
      },
    });
    splashWindow = win;
    const splashFile = path.join(publicDir, 'lf-splash.html');

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => {
      if (String(url).startsWith('file:') && decodeURIComponent(String(url)).replace(/\\/g, '/').endsWith('/public/lf-splash.html')) return;
      event.preventDefault();
    });
    win.once('ready-to-show', () => {
      if (disposed || revealed || win.isDestroyed() || splashWindow !== win) return;
      win.show();
      win.focus();
      publishSplashWindowState(win);
    });
    ['maximize', 'unmaximize', 'minimize', 'restore'].forEach(eventName => {
      win.on(eventName, () => publishSplashWindowState(win));
    });
    win.webContents.on('did-fail-load', (_event, code, description) => {
      if (code === -3) return;
      log(`Splash load failed (${code}): ${description}`);
      if (splashWindow === win) {
        splashWindow = null;
        if (!win.isDestroyed()) win.destroy();
      }
      scheduleRecreate('did-fail-load');
    });
    win.webContents.on('render-process-gone', (_event, details) => {
      log(`Splash renderer stopped: ${details && details.reason || 'unknown'}`);
      if (splashWindow === win) {
        splashWindow = null;
        if (!win.isDestroyed()) win.destroy();
      }
      scheduleRecreate('render-process-gone');
    });
    win.on('closed', () => {
      if (splashWindow === win) splashWindow = null;
      if (userCloseRequested || revealInFlight || revealed || disposed) return;
      scheduleRecreate('closed-before-entry');
    });

    await win.loadFile(splashFile);
    return win;
  }

  function registerIpc() {
    ipcMain.on(CHANNELS.stageReady, event => {
      if (!isTrusted(event) || disposed || revealed) return;
      stageReady = true;
      maybeReveal();
    });
    ipcMain.handle(CHANNELS.enter, event => {
      if (!isTrusted(event) || disposed || revealed) {
        return { ok: false, error: 'SPLASH_NOT_READY' };
      }
      if (!enterRequested) {
        enterCount += 1;
        enterRequestedAt = Date.now();
      }
      enterRequested = true;
      if (typeof options.onEnterRequested === 'function') {
        try { options.onEnterRequested(); } catch (error) { log('Splash entry signal failed', error); }
      }
      // A trusted click is itself proof that the loaded splash stage is ready.
      // Accept it even if the fire-and-forget stageReady IPC is still queued.
      stageReady = true;
      const didReveal = maybeReveal();
      return { ok: true, accepted: true, pending: !didReveal, revealed: didReveal };
    });
    ipcMain.handle(CHANNELS.debug, event => {
      if (!testMode || !isTrusted(event)) return null;
      return debugState();
    });
    ipcMain.handle(CHANNELS.mainDebug, event => {
      if (!testMode || !mainWindow || mainWindow.isDestroyed() || mainWindow.webContents !== event.sender) return null;
      return debugState();
    });
    ipcMain.handle(CHANNELS.windowAction, (event, action) => {
      if (!isTrusted(event) || disposed || revealed) return { ok: false, error: 'SPLASH_NOT_READY' };
      const win = splashWindow;
      if (!win || win.isDestroyed()) return { ok: false, error: 'SPLASH_WINDOW_MISSING' };
      if (action === 'minimize') win.minimize();
      else if (action === 'maximize') {
        if (win.isMaximized()) win.unmaximize();
        else win.maximize();
      } else if (action === 'close') {
        userCloseRequested = true;
        app.quit();
      } else return { ok: false, error: 'INVALID_WINDOW_ACTION' };
      publishSplashWindowState(win);
      return { ok: true, state: splashWindowState(win) };
    });
  }

  function unregisterIpc() {
    ipcMain.removeAllListeners(CHANNELS.stageReady);
    ipcMain.removeHandler(CHANNELS.enter);
    ipcMain.removeHandler(CHANNELS.debug);
    ipcMain.removeHandler(CHANNELS.mainDebug);
    ipcMain.removeHandler(CHANNELS.windowAction);
  }

  registerIpc();

  return Object.freeze({
    start() {
      if (testBypass) return Promise.resolve(null);
      return createWindow();
    },
    setMainReady(win) {
      if (!win || win.isDestroyed() || disposed) return false;
      mainWindow = win;
      mainReady = true;
      if (testBypass) {
        stageReady = true;
        enterRequested = true;
      }
      return maybeReveal();
    },
    focus() {
      if (revealed && mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        return true;
      }
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.show();
        splashWindow.focus();
        return true;
      }
      if (!testBypass) createWindow().catch(error => log('Splash focus recovery failed', error));
      return false;
    },
    isRevealed() { return revealed; },
    getDebug() { return debugState(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearRecreateTimer();
      unregisterIpc();
      const closing = splashWindow;
      splashWindow = null;
      if (closing && !closing.isDestroyed()) closing.destroy();
      mainWindow = null;
    },
  });
}

module.exports = { createSplashController, CHANNELS };
