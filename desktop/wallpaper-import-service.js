'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WE_APP_ID = '431960';
const MAX_PROJECTS = 240;
const MAX_WEB_FILES = 5000;
const MAX_WEB_BYTES = 2 * 1024 * 1024 * 1024;
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.com', '.scr', '.msi', '.msp', '.cmd', '.bat', '.ps1', '.psm1', '.vbs', '.vbe',
  '.jscript', '.hta', '.reg', '.dll', '.sys', '.jar', '.lnk', '.url', '.appx', '.appxbundle',
]);
const WEB_ASSET_EXTENSIONS = new Set([
  '.html', '.htm', '.css', '.js', '.mjs', '.json', '.txt', '.xml', '.svg', '.png', '.jpg',
  '.jpeg', '.webp', '.gif', '.avif', '.ico', '.mp4', '.webm', '.ogg', '.ogv', '.mp3', '.wav',
  '.flac', '.m4a', '.aac', '.woff', '.woff2', '.ttf', '.otf', '.wasm', '.bin', '.dat', '.glsl',
  '.vert', '.frag', '.obj', '.mtl', '.gltf', '.glb',
]);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp']);

function existingDir(value) {
  try { return !!value && fs.statSync(value).isDirectory(); } catch (_) { return false; }
}

function existingFile(value) {
  try { return !!value && fs.statSync(value).isFile(); } catch (_) { return false; }
}

function readJson(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) { return null; }
}

function normalizeRelative(value) {
  const raw = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!raw || raw.includes('\0')) return '';
  const normalized = path.posix.normalize(raw);
  if (normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) return '';
  return normalized;
}

function resolveInside(root, relative) {
  const safe = normalizeRelative(relative);
  if (!safe) return '';
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, safe);
  const prefix = `${resolvedRoot}${path.sep}`.toLowerCase();
  return resolved.toLowerCase().startsWith(prefix) ? resolved : '';
}

function mimeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.mp4': case '.m4v': return 'video/mp4';
    case '.webm': return 'video/webm';
    case '.mov': return 'video/quicktime';
    case '.ogv': return 'video/ogg';
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    case '.avif': return 'image/avif';
    case '.bmp': return 'image/bmp';
    case '.html': case '.htm': return 'text/html';
    default: return 'application/octet-stream';
  }
}

function fileKind(filePath, declaredType) {
  const type = String(declaredType || '').toLowerCase();
  const ext = path.extname(filePath || '').toLowerCase();
  if (type === 'scene' || /scene\.json$/i.test(filePath || '')) return 'scene';
  if (type === 'web' || type === 'webpage' || ext === '.html' || ext === '.htm') return 'web';
  if (type === 'video' || VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (type === 'image' || IMAGE_EXTENSIONS.has(ext)) return 'image';
  return 'unknown';
}

function findPreferredMedia(root) {
  let best = null;
  const queue = [{ dir: root, depth: 0 }];
  let visited = 0;
  while (queue.length && visited < 1500) {
    const current = queue.shift();
    let entries = [];
    try { entries = fs.readdirSync(current.dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const entry of entries) {
      if (++visited > 1500) break;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(current.dir, entry.name);
      if (entry.isDirectory() && current.depth < 3) {
        queue.push({ dir: full, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      const priority = VIDEO_EXTENSIONS.has(ext) ? 3 : (IMAGE_EXTENSIONS.has(ext) ? 2 : (/\.html?$/i.test(ext) ? 1 : 0));
      if (!priority) continue;
      let size = 0;
      try { size = fs.statSync(full).size; } catch (_) {}
      if (!best || priority > best.priority || (priority === best.priority && size > best.size)) best = { full, priority, size };
    }
  }
  return best && best.full;
}

function derivePresetEntry(projectRoot, meta) {
  const preset = meta && meta.preset && typeof meta.preset === 'object' ? meta.preset : null;
  if (!preset) return '';
  const candidates = [
    preset.background_videofile,
    preset.background_image,
    preset.video,
    preset.image,
  ];
  for (const candidate of candidates) {
    const full = resolveInside(projectRoot, candidate);
    if (existingFile(full)) return full;
  }
  return '';
}

function projectDescriptor(provider, projectRoot, id) {
  const metaPath = path.join(projectRoot, 'project.json');
  const meta = readJson(metaPath) || {};
  let entry = resolveInside(projectRoot, meta.file);
  if (!existingFile(entry)) entry = derivePresetEntry(projectRoot, meta);
  if (!existingFile(entry)) entry = findPreferredMedia(projectRoot) || '';
  const kind = fileKind(entry, meta.type);
  const preview = resolveInside(projectRoot, meta.preview);
  let updatedAt = 0;
  try { updatedAt = Math.round(fs.statSync(projectRoot).mtimeMs); } catch (_) {}
  return {
    provider,
    id: String(id || path.basename(projectRoot)),
    title: String(meta.title || meta.name || path.basename(projectRoot)).slice(0, 180),
    type: String(meta.type || kind || 'unknown').slice(0, 32),
    kind,
    supported: kind === 'video' || kind === 'image' || kind === 'web',
    limitation: kind === 'scene' ? 'Wallpaper Engine 场景壁纸不能直接嵌入；请在官方客户端导出视频后导入。' : '',
    previewPath: existingFile(preview) ? preview : '',
    entryPath: entry,
    projectRoot,
    updatedAt,
  };
}

function fileDescriptor(provider, filePath, id) {
  const entryPath = path.resolve(filePath);
  const kind = fileKind(entryPath);
  let updatedAt = 0;
  try { updatedAt = Math.round(fs.statSync(entryPath).mtimeMs); } catch (_) {}
  return {
    provider,
    id: String(id),
    title: path.basename(entryPath, path.extname(entryPath)).slice(0, 180),
    type: kind,
    kind,
    supported: kind === 'video' || kind === 'image' || kind === 'web',
    limitation: '',
    previewPath: '',
    entryPath,
    projectRoot: path.dirname(entryPath),
    updatedAt,
  };
}

function uniqueExisting(values) {
  const seen = new Set();
  return values.filter(existingDir).filter((value) => {
    const normalized = path.resolve(value).toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

class WallpaperImportService {
  constructor(options = {}) {
    this.storageDir = path.resolve(options.storageDir || path.join(process.cwd(), '.lumifield-wallpapers'));
    this.steamRoots = uniqueExisting(options.steamRoots || []);
    this.qianqianRoots = uniqueExisting(options.qianqianRoots || []);
    this.projectIndex = new Map();
    fs.mkdirSync(this.storageDir, { recursive: true });
  }

  workshopRoots() {
    return uniqueExisting(this.steamRoots.flatMap(root => [
      path.join(root, 'steamapps', 'workshop', 'content', WE_APP_ID),
      path.join(root, 'workshop', 'content', WE_APP_ID),
    ]));
  }

  scan(provider) {
    const id = String(provider || '');
    let descriptors = [];
    if (id === 'wallpaper_engine') {
      for (const root of this.workshopRoots()) {
        let entries = [];
        try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { continue; }
        for (const entry of entries) {
          if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
          descriptors.push(projectDescriptor(id, path.join(root, entry.name), entry.name));
        }
      }
    } else if (id === 'qianqian') {
      for (const root of this.qianqianRoots) {
        let entries = [];
        try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { continue; }
        for (const entry of entries) {
          if (entry.isSymbolicLink()) continue;
          const full = path.join(root, entry.name);
          const projectId = crypto.createHash('sha256').update(full).digest('hex').slice(0, 20);
          const descriptor = entry.isDirectory()
            ? projectDescriptor(id, full, projectId)
            : (entry.isFile() && (VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) || IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
              ? fileDescriptor(id, full, projectId) : null);
          if (descriptor) descriptors.push(descriptor);
        }
      }
    } else {
      return { ok: false, error: 'UNKNOWN_PROVIDER', projects: [] };
    }

    const unique = new Map();
    descriptors.sort((a, b) => b.updatedAt - a.updatedAt).forEach((item) => {
      const key = `${item.provider}:${item.id}`;
      if (!unique.has(key)) unique.set(key, item);
    });
    descriptors = Array.from(unique.values()).slice(0, MAX_PROJECTS);
    descriptors.forEach(item => this.projectIndex.set(`${item.provider}:${item.id}`, item));
    return {
      ok: true,
      provider: id,
      projects: descriptors.map(item => ({
        provider: item.provider,
        id: item.id,
        title: item.title,
        type: item.type,
        kind: item.kind,
        supported: item.supported,
        limitation: item.limitation,
        updatedAt: item.updatedAt,
      })),
    };
  }

  registerSelection(provider, selectedPath) {
    const full = path.resolve(String(selectedPath || ''));
    if (!existingFile(full) && !existingDir(full)) return { ok: false, error: 'SELECTION_NOT_FOUND' };
    const projectRoot = existingDir(full) ? full : path.dirname(full);
    const id = crypto.createHash('sha256').update(`${provider}:${projectRoot}`).digest('hex').slice(0, 20);
    const descriptor = existingFile(full) && fileKind(full) !== 'unknown'
      ? fileDescriptor(provider, full, id)
      : projectDescriptor(provider, projectRoot, id);
    this.projectIndex.set(`${provider}:${id}`, descriptor);
    return { ok: true, project: {
      provider, id, title: descriptor.title, type: descriptor.type, kind: descriptor.kind,
      supported: descriptor.supported, limitation: descriptor.limitation, updatedAt: descriptor.updatedAt,
    } };
  }

  descriptor(provider, projectId) {
    const key = `${provider}:${projectId}`;
    if (!this.projectIndex.has(key)) this.scan(provider);
    return this.projectIndex.get(key) || null;
  }

  copyWebProject(sourceRoot, destinationRoot) {
    let files = 0;
    let bytes = 0;
    const walk = (from, to) => {
      fs.mkdirSync(to, { recursive: true });
      const entries = fs.readdirSync(from, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const source = path.join(from, entry.name);
        const destination = path.join(to, entry.name);
        if (entry.isDirectory()) {
          walk(source, destination);
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (BLOCKED_EXTENSIONS.has(ext) || !WEB_ASSET_EXTENSIONS.has(ext)) continue;
        const size = fs.statSync(source).size;
        files += 1;
        bytes += size;
        if (files > MAX_WEB_FILES || bytes > MAX_WEB_BYTES) throw new Error('WEB_PROJECT_TOO_LARGE');
        fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
      }
    };
    walk(sourceRoot, destinationRoot);
    return { files, bytes };
  }

  import(provider, projectId) {
    const descriptor = this.descriptor(String(provider || ''), String(projectId || ''));
    if (!descriptor) return { ok: false, error: 'PROJECT_NOT_FOUND' };
    if (!descriptor.supported) return { ok: false, error: descriptor.kind === 'scene' ? 'UNSUPPORTED_SCENE_PROJECT' : 'UNSUPPORTED_PROJECT', limitation: descriptor.limitation };
    if (!existingFile(descriptor.entryPath)) return { ok: false, error: 'PROJECT_ENTRY_NOT_FOUND' };

    const importId = crypto.randomUUID().toLowerCase();
    const destinationRoot = path.join(this.storageDir, importId);
    fs.mkdirSync(destinationRoot, { recursive: false });
    let relativeEntry = path.basename(descriptor.entryPath);
    let copied = { files: 1, bytes: 0 };
    try {
      if (descriptor.kind === 'web') {
        copied = this.copyWebProject(descriptor.projectRoot, destinationRoot);
        relativeEntry = path.relative(descriptor.projectRoot, descriptor.entryPath).replace(/\\/g, '/');
        if (!normalizeRelative(relativeEntry) || !existingFile(path.join(destinationRoot, relativeEntry))) throw new Error('WEB_ENTRY_NOT_COPIED');
      } else {
        const target = path.join(destinationRoot, relativeEntry);
        fs.copyFileSync(descriptor.entryPath, target, fs.constants.COPYFILE_EXCL);
        copied.bytes = fs.statSync(target).size;
      }
      const manifest = {
        id: importId,
        provider: descriptor.provider,
        projectId: descriptor.id,
        title: descriptor.title,
        kind: descriptor.kind,
        mime: mimeFor(descriptor.entryPath),
        entry: relativeEntry,
        importedAt: Date.now(),
        files: copied.files,
        bytes: copied.bytes,
      };
      fs.writeFileSync(path.join(destinationRoot, 'lumifield-wallpaper.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
      return {
        ok: true,
        importId,
        provider: descriptor.provider,
        projectId: descriptor.id,
        title: descriptor.title,
        kind: descriptor.kind,
        mime: manifest.mime,
        url: `/api/local-wallpaper/${importId}/${relativeEntry.split('/').map(encodeURIComponent).join('/')}`,
        files: copied.files,
        bytes: copied.bytes,
      };
    } catch (error) {
      try { fs.rmSync(destinationRoot, { recursive: true, force: true }); } catch (_) {}
      return { ok: false, error: error.message || 'IMPORT_FAILED' };
    }
  }
}

module.exports = {
  WallpaperImportService,
  WE_APP_ID,
  normalizeRelative,
  resolveInside,
  mimeFor,
};
