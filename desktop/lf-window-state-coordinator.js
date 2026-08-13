'use strict';

const MANAGED_MODES = new Set(['immersive', 'player-fullscreen']);
const ALL_MODES = new Set(['immersive', 'player-fullscreen', 'html-fullscreen']);

function cloneBounds(value) {
  if (!value || !Number.isFinite(Number(value.width)) || !Number.isFinite(Number(value.height))) return null;
  return {
    x: Math.round(Number(value.x) || 0),
    y: Math.round(Number(value.y) || 0),
    width: Math.max(1, Math.round(Number(value.width) || 1)),
    height: Math.max(1, Math.round(Number(value.height) || 1)),
  };
}

function cloneSnapshot(value) {
  if (!value) return null;
  return {
    mode: value.mode,
    bounds: cloneBounds(value.bounds),
    normalBounds: cloneBounds(value.normalBounds),
    displayId: value.displayId,
  };
}

class WindowStateCoordinator {
  constructor(options = {}) {
    this.screen = options.screen;
    this.onState = typeof options.onState === 'function' ? options.onState : () => {};
    this.transitionTimeoutMs = Math.max(250, Number(options.transitionTimeoutMs) || 1800);
    this.states = new WeakMap();
  }

  attach(win) {
    if (!win || win.isDestroyed()) return null;
    let state = this.states.get(win);
    if (state) return state;
    state = {
      active: new Set(),
      order: [],
      baseline: null,
      lastStable: null,
      queue: Promise.resolve(),
      transitioning: false,
      expectedNative: null,
      nativeFullscreen: !!win.isFullScreen(),
      lastAction: null,
      generation: 0,
      htmlFullscreen: false,
      disposed: false,
      listeners: [],
    };
    this.states.set(win, state);
    state.lastStable = this.capture(win);
    const remember = () => {
      if (state.disposed || state.transitioning || state.active.size || state.nativeFullscreen || state.htmlFullscreen ||
          win.isDestroyed() || win.isFullScreen()) return;
      state.lastStable = this.capture(win);
    };
    ['move', 'resize', 'maximize', 'unmaximize', 'restore'].forEach(eventName => {
      win.on(eventName, remember);
      state.listeners.push([eventName, remember]);
    });
    return state;
  }

  dispose(win) {
    const state = this.states.get(win);
    if (!state) return;
    state.disposed = true;
    for (const [eventName, listener] of state.listeners) {
      try { win.removeListener(eventName, listener); } catch (_) {}
    }
    state.listeners.length = 0;
    this.states.delete(win);
  }

  capture(win) {
    if (!win || win.isDestroyed()) return null;
    const bounds = cloneBounds(win.getBounds());
    let normalBounds = bounds;
    try { normalBounds = cloneBounds(win.getNormalBounds()) || bounds; } catch (_) {}
    const mode = win.isFullScreen() ? 'fullscreen' : (win.isMaximized() ? 'maximized' : 'normal');
    const displayBounds = mode === 'normal' ? bounds : (normalBounds || bounds);
    let displayId = null;
    try {
      const display = this.screen && this.screen.getDisplayMatching(displayBounds || bounds);
      if (display) displayId = display.id;
    } catch (_) {}
    return { mode, bounds, normalBounds, displayId };
  }

  getState(win) {
    if (!win || win.isDestroyed()) return {
      windowMode: 'normal', bounds: null, normalBounds: null, displayId: null,
      activeModes: [], baselineWindowState: null, transitioning: false, generation: 0,
      isManagedFullScreen: false, nativeFullscreenObserved: false, isHtmlFullScreen: false,
    };
    const state = this.attach(win);
    const current = this.capture(win);
    if (state.nativeFullscreen) current.mode = 'fullscreen';
    return {
      windowMode: current.mode,
      bounds: current.bounds,
      normalBounds: current.normalBounds,
      displayId: current.displayId,
      activeModes: state.order.filter(mode => state.active.has(mode)),
      baselineWindowState: cloneSnapshot(state.baseline),
      transitioning: !!state.transitioning,
      generation: state.generation,
      lastWindowAction: state.lastAction ? { ...state.lastAction } : null,
      isManagedFullScreen: this._hasManaged(state),
      nativeFullscreenObserved: !!state.nativeFullscreen,
      isHtmlFullScreen: !!state.htmlFullscreen,
    };
  }

  setMode(win, mode, enabled) {
    mode = String(mode || '');
    if (!ALL_MODES.has(mode)) return Promise.resolve({ ok: false, error: 'INVALID_WINDOW_MODE' });
    return this._enqueue(win, state => {
      state.lastAction = { kind: 'set-mode', mode, enabled: enabled === true };
      return this._setModeNow(win, state, mode, enabled === true);
    });
  }

  toggleMode(win, mode) {
    mode = String(mode || 'player-fullscreen');
    if (!ALL_MODES.has(mode)) return Promise.resolve({ ok: false, error: 'INVALID_WINDOW_MODE' });
    return this._enqueue(win, async state => {
      const enabled = !state.active.has(mode);
      state.lastAction = { kind: 'toggle-mode', mode, enabled };
      return this._setModeNow(win, state, mode, enabled);
    });
  }

  exitAll(win) {
    return this._enqueue(win, async state => {
      state.lastAction = { kind: 'exit-all', mode: '', enabled: false };
      state.active.clear();
      state.order.length = 0;
      state.htmlFullscreen = false;
      await this._restoreBaseline(win, state);
      return this._result(win, state, { exitedAll: true });
    });
  }

  noteHtmlFullscreen(win, enabled) {
    return this._enqueue(win, async state => {
      const next = enabled === true;
      if (next) {
        if (!state.baseline && !state.active.size) state.baseline = cloneSnapshot(state.lastStable || this.capture(win));
        state.active.add('html-fullscreen');
        if (!state.order.includes('html-fullscreen')) state.order.push('html-fullscreen');
      } else {
        state.active.delete('html-fullscreen');
        state.order = state.order.filter(mode => mode !== 'html-fullscreen');
      }
      state.htmlFullscreen = next;
      if (!next && !state.active.size) await this._restoreBaseline(win, state);
      return this._result(win, state, { mode: 'html-fullscreen', enabled: next });
    });
  }

  noteNativeFullscreen(win, enabled) {
    const state = this.attach(win);
    if (!state) return;
    state.nativeFullscreen = enabled === true;
    if (!enabled && this._hasManaged(state) && state.expectedNative !== false && !state.transitioning) {
      this._enqueue(win, async current => {
        if (this._hasManaged(current)) await this._setNativeFullscreen(win, current, true);
        return this._result(win, current, { repairedNativeFullscreen: true });
      }).catch(() => {});
    }
    this._emit(win);
  }

  escapeMode(win) {
    const state = this.attach(win);
    if (!state) return '';
    if (state.active.has('immersive')) return 'immersive';
    if (state.active.has('player-fullscreen')) return 'player-fullscreen';
    if (state.active.has('html-fullscreen') || state.htmlFullscreen) return 'html-fullscreen';
    return '';
  }

  async _setMode(win, mode, enabled) {
    const state = this.attach(win);
    return this._setModeNow(win, state, mode, enabled);
  }

  async _setModeNow(win, state, mode, enabled) {
    if (!state || !win || win.isDestroyed()) return { ok: false, error: 'NO_WINDOW' };
    if (mode === 'html-fullscreen') {
      if (enabled) {
        if (!state.baseline && !state.active.size) state.baseline = cloneSnapshot(state.lastStable || this.capture(win));
        state.active.add(mode);
        if (!state.order.includes(mode)) state.order.push(mode);
        state.htmlFullscreen = true;
      } else {
        state.active.delete(mode);
        state.order = state.order.filter(item => item !== mode);
        state.htmlFullscreen = false;
        if (!state.active.size) await this._restoreBaseline(win, state);
      }
      return this._result(win, state, { mode, enabled });
    }
    const already = state.active.has(mode);
    if (enabled === already) return this._result(win, state, { mode, enabled, unchanged: true });
    if (enabled) {
      if (!state.baseline && !this._hasManaged(state)) {
        state.baseline = this.capture(win);
        if (state.nativeFullscreen) state.baseline.mode = 'fullscreen';
      }
      // Preserve Windows' restore placement before a maximized frameless
      // window enters native fullscreen. Entering fullscreen directly from a
      // maximized state overwrites getNormalBounds() with the screen rectangle.
      if (!this._hasManaged(state) && state.baseline && state.baseline.mode === 'maximized') {
        await this._setMaximized(win, false);
        const normalBounds = this._safeBounds(state.baseline.normalBounds || state.baseline.bounds, state.baseline.displayId);
        if (normalBounds) win.setBounds(normalBounds, false);
      }
      state.active.add(mode);
      if (!state.order.includes(mode)) state.order.push(mode);
      await this._setNativeFullscreen(win, state, true);
    } else {
      state.active.delete(mode);
      state.order = state.order.filter(item => item !== mode);
      if (this._hasManaged(state)) await this._setNativeFullscreen(win, state, true);
      else if (!state.htmlFullscreen && !state.active.has('html-fullscreen')) await this._restoreBaseline(win, state);
    }
    return this._result(win, state, { mode, enabled });
  }

  _enqueue(win, task) {
    if (!win || win.isDestroyed()) return Promise.resolve({ ok: false, error: 'NO_WINDOW' });
    const state = this.attach(win);
    const operation = state.queue.catch(() => {}).then(async () => {
      if (state.disposed || win.isDestroyed()) return { ok: false, error: 'NO_WINDOW' };
      state.transitioning = true;
      state.generation += 1;
      this._emit(win);
      try {
        return await task(state);
      } finally {
        state.transitioning = false;
        this._emit(win);
      }
    });
    state.queue = operation.catch(() => {});
    return operation;
  }

  _hasManaged(state) {
    for (const mode of MANAGED_MODES) if (state.active.has(mode)) return true;
    return false;
  }

  async _restoreBaseline(win, state) {
    const baseline = state.baseline;
    if (!baseline) return;
    if (baseline.mode === 'fullscreen') {
      await this._setNativeFullscreen(win, state, true);
    } else if (baseline.mode === 'maximized') {
      await this._setNativeFullscreen(win, state, false);
      // Windows posts the maximized restore placement shortly after Electron's
      // leave-full-screen event. Let that native transition settle before the
      // intentional unmaximize, otherwise Windows can immediately maximize the
      // window again and discard the captured normal rectangle.
      await new Promise(resolve => setTimeout(resolve, 240));
      // Electron/Windows replaces getNormalBounds() with the fullscreen bounds
      // when a maximized frameless window leaves native fullscreen. Restore the
      // captured normal rectangle before maximizing so later unmaximize actions
      // return to the user's real window geometry instead of a borderless screen.
      await this._setMaximized(win, false);
      const normalBounds = this._safeBounds(baseline.normalBounds || baseline.bounds, baseline.displayId);
      if (normalBounds) win.setBounds(normalBounds, false);
      await this._setMaximized(win, true);
    } else {
      await this._setNativeFullscreen(win, state, false);
      await this._setMaximized(win, false);
      const bounds = this._safeBounds(baseline.normalBounds || baseline.bounds, baseline.displayId);
      if (bounds) win.setBounds(bounds, false);
    }
    state.baseline = null;
    if (!win.isFullScreen()) state.lastStable = this.capture(win);
  }

  _safeBounds(savedBounds, displayId) {
    const saved = cloneBounds(savedBounds);
    if (!saved || !this.screen) return saved;
    let displays = [];
    try { displays = this.screen.getAllDisplays() || []; } catch (_) {}
    let display = displays.find(item => String(item.id) === String(displayId));
    if (!display) {
      try { display = this.screen.getDisplayMatching(saved); } catch (_) {}
    }
    if (!display) {
      try { display = this.screen.getPrimaryDisplay(); } catch (_) {}
    }
    const area = cloneBounds(display && (display.workArea || display.bounds));
    if (!area) return saved;
    const width = Math.min(saved.width, area.width);
    const height = Math.min(saved.height, area.height);
    return {
      x: Math.min(Math.max(saved.x, area.x), area.x + area.width - width),
      y: Math.min(Math.max(saved.y, area.y), area.y + area.height - height),
      width,
      height,
    };
  }

  _setNativeFullscreen(win, state, enabled) {
    const target = enabled === true;
    if (state.nativeFullscreen === target) return Promise.resolve();
    return this._waitForWindowEvent(win, target ? 'enter-full-screen' : 'leave-full-screen', () => {
      state.expectedNative = target;
      win.setFullScreen(target);
    }).then(observed => {
      // Some Windows/Electron frameless-window combinations update the real
      // fullscreen bounds and emit the transition event while isFullScreen()
      // remains false. The native event is the authoritative acknowledgement.
      if (!observed && win.isFullScreen() !== target) throw new Error('WINDOW_FULLSCREEN_TRANSITION_TIMEOUT');
      state.nativeFullscreen = target;
    }).finally(() => { state.expectedNative = null; });
  }

  async _setMaximized(win, enabled) {
    const target = enabled === true;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (win.isMaximized() === target) return;
      await this._waitForWindowEvent(win, target ? 'maximize' : 'unmaximize', () => {
        if (target) win.maximize(); else win.unmaximize();
      });
      if (win.isMaximized() === target) return;
      // Leaving native fullscreen may post a late maximize placement. Retry
      // after that message rather than treating the first transient as final.
      await new Promise(resolve => setTimeout(resolve, 160));
    }
    throw new Error('WINDOW_MAXIMIZE_TRANSITION_TIMEOUT');
  }

  _waitForWindowEvent(win, eventName, action) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error, observed = false) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { win.removeListener(eventName, onEvent); } catch (_) {}
        if (error) reject(error); else resolve(observed);
      };
      const onEvent = () => setTimeout(() => finish(null, true), 20);
      const timer = setTimeout(() => finish(null, false), this.transitionTimeoutMs);
      win.once(eventName, onEvent);
      try { action(); } catch (error) { finish(error); }
    });
  }

  _result(win, state, extra = {}) {
    return { ok: true, ...extra, state: this.getState(win) };
  }

  _emit(win) {
    try { this.onState(win); } catch (_) {}
  }
}

function createWindowStateCoordinator(options) {
  return new WindowStateCoordinator(options);
}

module.exports = {
  ALL_MODES,
  MANAGED_MODES,
  WindowStateCoordinator,
  createWindowStateCoordinator,
};
