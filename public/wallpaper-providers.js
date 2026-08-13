(function (global) {
  'use strict';

  class WallpaperPersistence {
    constructor(dbName, metaKey) {
      this.dbName = dbName || 'lumifield-wallpaper-picker';
      this.metaKey = metaKey || 'lumifield-wallpaper-picker-meta-v1';
    }
    meta() { try { return JSON.parse(localStorage.getItem(this.metaKey) || '{}'); } catch (_) { return {}; } }
    saveMeta(value) { try { localStorage.setItem(this.metaKey, JSON.stringify(value || {})); } catch (_) {} }
    open() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(this.dbName, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('wallpapers');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    async put(target, blob, meta) {
      const db = await this.open();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction('wallpapers', 'readwrite');
        transaction.objectStore('wallpapers').put({ blob, meta }, target);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      db.close();
      const all = this.meta(); all[target] = meta; this.saveMeta(all);
      return { ok: true, target, meta };
    }
    async get(target) {
      const db = await this.open();
      const result = await new Promise((resolve, reject) => {
        const request = db.transaction('wallpapers', 'readonly').objectStore('wallpapers').get(target);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return result;
    }
  }

  class LocalWallpaperProvider {
    constructor() { this.id = 'local'; this.label = '本地图片 / 视频'; }
    status() { return { ok: true, provider: this.id, label: this.label, installed: true, local: true }; }
    open() { return Promise.resolve({ ok: true, provider: this.id, requiresFile: true }); }
  }

  class ExternalWallpaperProvider {
    constructor(id, label, api) { this.id = id; this.label = label; this.api = api; this._status = null; }
    setStatus(value) { this._status = value || null; }
    status() { return this._status || { ok: true, provider: this.id, label: this.label, installed: false }; }
    async open() {
      if (!this.api || typeof this.api.openWallpaperProvider !== 'function') return { ok: false, provider: this.id, error: 'DESKTOP_API_UNAVAILABLE' };
      return this.api.openWallpaperProvider(this.id);
    }
    async projects() {
      if (!this.api || typeof this.api.getWallpaperProjects !== 'function') return { ok: false, provider: this.id, error: 'DESKTOP_API_UNAVAILABLE', projects: [] };
      return this.api.getWallpaperProjects(this.id);
    }
    async select(folderMode) {
      if (!this.api || typeof this.api.selectWallpaperProviderResource !== 'function') return { ok: false, provider: this.id, error: 'DESKTOP_API_UNAVAILABLE' };
      return this.api.selectWallpaperProviderResource(this.id, !!folderMode);
    }
    async import(projectId) {
      if (!this.api || typeof this.api.importWallpaperProject !== 'function') return { ok: false, provider: this.id, error: 'DESKTOP_API_UNAVAILABLE' };
      return this.api.importWallpaperProject(this.id, projectId);
    }
  }
  class WallpaperEngineProvider extends ExternalWallpaperProvider { constructor(api) { super('wallpaper_engine', 'Wallpaper Engine', api); } }
  class QianQianWallpaperProvider extends ExternalWallpaperProvider { constructor(api) { super('qianqian', '网易千千壁纸', api); } }

  class WallpaperTargetSelector {
    static target(value) { return ['weather', 'stage', 'global'].includes(value) ? value : 'weather'; }
    static fit(value) { return ['cover', 'contain', 'fill', 'center'].includes(value) ? value : 'cover'; }
    static targets() { return [{ id:'weather', label:'天气面板' }, { id:'stage', label:'副界面背景' }, { id:'global', label:'全局背景' }]; }
  }

  class WallpaperPreviewDialog {
    constructor(renderer) { this.renderer = renderer; }
    preview(payload) {
      const normalized = Object.assign({}, payload, { target: WallpaperTargetSelector.target(payload.target), fit: WallpaperTargetSelector.fit(payload.fit) });
      return { ok: !!this.renderer(normalized.target, normalized.url, normalized.mime, normalized.fit), payload: normalized };
    }
  }

  class WallpaperApplyDialog extends WallpaperPreviewDialog {
    constructor(renderer, persistence) { super(renderer); this.persistence = persistence; }
    async confirm(payload) {
      const preview = this.preview(payload);
      if (!preview.ok) return preview;
      await this.persistence.put(preview.payload.target, preview.payload.blob, preview.payload.meta);
      return { ok: true, saved: true, payload: preview.payload };
    }
  }

  class WallpaperProviderManager {
    constructor(api, persistence) {
      this.api = api;
      this.persistence = persistence || new WallpaperPersistence();
      this.providers = new Map();
      [new LocalWallpaperProvider(), new WallpaperEngineProvider(api), new QianQianWallpaperProvider(api)].forEach(provider => this.providers.set(provider.id, provider));
    }
    get(id) { return this.providers.get(id) || null; }
    async statuses() {
      if (this.api && typeof this.api.getWallpaperProviders === 'function') {
        const result = await this.api.getWallpaperProviders();
        (result.providers || []).forEach(value => { const provider = this.get(value.provider); if (provider) provider.setStatus(value); });
      }
      return Array.from(this.providers.values()).filter(provider => provider.id !== 'local').map(provider => provider.status());
    }
    async open(id) {
      const provider = this.get(id);
      return provider ? provider.open() : { ok: false, error: 'UNKNOWN_PROVIDER' };
    }
    async projects(id) {
      const provider = this.get(id);
      return provider && typeof provider.projects === 'function' ? provider.projects() : { ok: false, error: 'UNKNOWN_PROVIDER', projects: [] };
    }
    async select(id, folderMode) {
      const provider = this.get(id);
      return provider && typeof provider.select === 'function' ? provider.select(folderMode) : { ok: false, error: 'UNKNOWN_PROVIDER' };
    }
    async import(id, projectId) {
      const provider = this.get(id);
      return provider && typeof provider.import === 'function' ? provider.import(projectId) : { ok: false, error: 'UNKNOWN_PROVIDER' };
    }
  }

  global.LumiFieldWallpaper = {
    WallpaperProviderManager,
    LocalWallpaperProvider,
    WallpaperEngineProvider,
    QianQianWallpaperProvider,
    WallpaperPreviewDialog,
    WallpaperApplyDialog,
    WallpaperTargetSelector,
    WallpaperPersistence,
    create(api, renderer) {
      const persistence = new WallpaperPersistence();
      const manager = new WallpaperProviderManager(api, persistence);
      return { persistence, manager, previewDialog: renderer ? new WallpaperPreviewDialog(renderer) : null, applyDialog: renderer ? new WallpaperApplyDialog(renderer, persistence) : null };
    },
  };
})(window);
