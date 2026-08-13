const path = require('path');
const { loadLFEnvironment } = require('./lf-env');

loadLFEnvironment({ appPath: path.join(__dirname, '..') });

const { LFBackend } = require('./lf-backend');
const { createLFAPIServer } = require('./lf-api-server');

const dbPath = path.resolve(process.env.LF_DATABASE_PATH || path.join(process.cwd(), 'data', 'lf-backend.sqlite3'));
const backend = new LFBackend({
  dbPath,
  appVersion: process.env.LF_APP_VERSION || require('../package.json').version,
  allowLocalCodes: process.env.NODE_ENV !== 'production' && process.env.LF_ALLOW_LOCAL_CODES === '1',
});
const api = createLFAPIServer(backend, {
  host: process.env.LF_API_HOST || '127.0.0.1',
  port: Number(process.env.LF_API_PORT || 8787),
  allowedOrigins: process.env.LF_API_ALLOWED_ORIGINS || '',
});

api.start().then(status => {
  console.log(`[LF backend] ready on ${status.host}:${status.port}; database=${dbPath}`);
}).catch(error => {
  console.error('[LF backend] startup failed:', error.message);
  backend.close();
  process.exitCode = 1;
});

async function shutdown() {
  await api.close().catch(() => {});
  backend.close();
  process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
