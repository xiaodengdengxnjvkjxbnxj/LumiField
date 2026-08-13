const fs = require('fs');
const path = require('path');

function parseEnv(text) {
  const values = {};
  String(text || '').split(/\r?\n/).forEach((line) => {
    const source = line.trim();
    if (!source || source.startsWith('#')) return;
    const match = source.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) return;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    values[match[1]] = value.replace(/\\n/g, '\n');
  });
  return values;
}

function loadFile(filePath) {
  try {
    if (!filePath || !fs.statSync(filePath).isFile()) return false;
    const values = parseEnv(fs.readFileSync(filePath, 'utf8'));
    Object.keys(values).forEach((key) => {
      if (process.env[key] == null || process.env[key] === '') process.env[key] = values[key];
    });
    return true;
  } catch (_) { return false; }
}

function loadLFEnvironment(options = {}) {
  const candidates = [];
  if (options.packaged && options.exePath) candidates.push(path.join(path.dirname(options.exePath), '.env'));
  if (options.userData) candidates.push(path.join(options.userData, '.env'));
  if (options.appPath) candidates.push(path.join(options.appPath, '.env'));
  candidates.push(path.resolve(process.cwd(), '.env'));
  const loaded = [];
  [...new Set(candidates)].forEach((filePath) => { if (loadFile(filePath)) loaded.push(filePath); });
  return loaded;
}

module.exports = { loadLFEnvironment, parseEnv };
