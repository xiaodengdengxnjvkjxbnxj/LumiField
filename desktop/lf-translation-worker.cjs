'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const fsPromises = require('fs/promises');

function unpackedPath(file) {
  const unpacked = file.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
  try { return require('fs').existsSync(unpacked) ? unpacked : file; } catch (_) { return file; }
}

const workerPath = unpackedPath(require.resolve('@browsermt/bergamot-translator/worker/translator-worker.js'));
const nativeReadFile = fsPromises.readFile;
fsPromises.readFile = function readFileWindowsFileUrl(file, ...args) {
  if (process.platform === 'win32' && typeof file === 'string' && /^\/[A-Za-z]:\//.test(file)) file = file.slice(1);
  return nativeReadFile.call(this, file, ...args);
};
globalThis.require = require;
globalThis.__filename = workerPath;
globalThis.__dirname = path.dirname(workerPath);
import(pathToFileURL(workerPath).href).catch(error => {
  setImmediate(() => { throw error; });
});
