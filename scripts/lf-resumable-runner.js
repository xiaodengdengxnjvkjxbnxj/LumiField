'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const repo = path.resolve(__dirname, '..');
const stateRoot = path.join(repo, 'test-results', 'lf-resumable-runner');
const terminalStates = new Set(['COMPLETED', 'FAILED', 'INTERRUPTED']);

function fail(message) {
  process.stderr.write(String(message) + '\n');
  process.exitCode = 1;
}

function safeId(value) {
  const id = String(value || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(id)) throw new Error('Invalid task id');
  return id;
}

function pathsFor(id) {
  return {
    state: path.join(stateRoot, id + '.json'),
    stdout: path.join(stateRoot, id + '.stdout.log'),
    stderr: path.join(stateRoot, id + '.stderr.log'),
  };
}

function readState(id) {
  const file = pathsFor(id).state;
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeState(id, next) {
  fs.mkdirSync(stateRoot, { recursive: true });
  const file = pathsFor(id).state;
  const temp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  fs.renameSync(temp, file);
  return next;
}

function processAlive(pid) {
  if (!(Number(pid) > 0)) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (_) {
    return false;
  }
}

function printable(state) {
  return JSON.stringify(state || { status: 'NOT_FOUND' }, null, 2) + '\n';
}

function windowsCommand(command) {
  if (process.platform !== 'win32') return command;
  const base = String(command || '').toLowerCase();
  if (['npm', 'npx', 'pnpm', 'yarn'].includes(base)) return command + '.cmd';
  return command;
}

async function worker(id, encodedPayload) {
  const files = pathsFor(id);
  let state = readState(id) || {};
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    fs.mkdirSync(stateRoot, { recursive: true });
    const stdout = fs.openSync(files.stdout, 'a');
    const stderr = fs.openSync(files.stderr, 'a');
    state = writeState(id, {
      ...state,
      status: 'RUNNING',
      workerPid: process.pid,
      startedAt: state.startedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      command: payload.command,
      args: payload.args,
      cwd: payload.cwd,
      stdout: files.stdout,
      stderr: files.stderr,
    });
    const child = spawn(windowsCommand(payload.command), payload.args, {
      cwd: payload.cwd,
      env: process.env,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', stdout, stderr],
    });
    writeState(id, { ...state, childPid: child.pid, updatedAt: new Date().toISOString() });
    child.once('error', error => {
      writeState(id, {
        ...readState(id), status: 'FAILED', error: String(error.stack || error),
        exitCode: null, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      process.exitCode = 1;
    });
    child.once('exit', (code, signal) => {
      writeState(id, {
        ...readState(id), status: code === 0 ? 'COMPLETED' : 'FAILED',
        exitCode: code, signal: signal || null,
        completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      fs.closeSync(stdout);
      fs.closeSync(stderr);
      process.exitCode = code === 0 ? 0 : 1;
    });
  } catch (error) {
    writeState(id, {
      ...state, status: 'FAILED', error: String(error.stack || error),
      completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    process.exitCode = 1;
  }
}

function refreshedState(id) {
  const state = readState(id);
  if (!state || terminalStates.has(state.status)) return state;
  if (processAlive(state.launcherPid) || processAlive(state.workerPid) || processAlive(state.childPid)) return state;
  return writeState(id, {
    ...state,
    status: 'INTERRUPTED',
    error: state.error || 'Worker and child process ended without a terminal state',
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function main() {
  const action = String(process.argv[2] || '').toLowerCase();
  const id = safeId(process.argv[3]);
  if (action === 'worker') return worker(id, process.argv[4]);
  if (action === 'status') {
    process.stdout.write(printable(refreshedState(id)));
    return;
  }
  if (action === 'wait') {
    const timeoutMs = Math.min(55000, Math.max(0, Number(process.argv[4]) || 55000));
    const started = Date.now();
    let state = refreshedState(id);
    while (state && !terminalStates.has(state.status) && Date.now() - started < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 500));
      state = refreshedState(id);
    }
    process.stdout.write(printable(state));
    return;
  }
  if (action !== 'start') throw new Error('Usage: start <id> [--restart] <command> [args...] | status <id> | wait <id> [timeoutMs]');

  const restart = process.argv[4] === '--restart';
  const commandIndex = restart ? 5 : 4;
  const command = String(process.argv[commandIndex] || '').trim();
  const args = process.argv.slice(commandIndex + 1);
  if (!command) throw new Error('Missing command');
  const existing = refreshedState(id);
  if (existing && !restart && (existing.status === 'RUNNING' || existing.status === 'STARTING' || existing.status === 'COMPLETED')) {
    process.stdout.write(printable(existing));
    return;
  }
  const payload = Buffer.from(JSON.stringify({ command, args, cwd: repo }), 'utf8').toString('base64url');
  const initial = writeState(id, {
    schema: 'lumifield-resumable-runner-v1', id, status: 'STARTING',
    command, args, cwd: repo, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  const detached = spawn(process.execPath, [__filename, 'worker', id, payload], {
    cwd: repo,
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });
  detached.unref();
  const launched = writeState(id, { ...initial, launcherPid: detached.pid, updatedAt: new Date().toISOString() });
  process.stdout.write(printable(launched));
}

main().catch(error => fail(error.stack || error));
