const assert = require('assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');

const repo = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(repo, 'server.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(repo, 'public', 'lumifield-enhancements.js'), 'utf8');
const outDir = path.resolve(process.env.LF_PROBLEM17_OUT || path.join(repo, 'test-results', 'lf-problem17', new Date().toISOString().replace(/[:.]/g, '-')));
const checks = {};
const serverLog = [];
let child = null;

fs.mkdirSync(outDir, { recursive: true });

function pass(name, condition, details) {
  assert.ok(condition, `${name}${details == null ? '' : `: ${JSON.stringify(details)}`}`);
  checks[name] = details == null ? true : details;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitFor(fn, timeoutMs = 30000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw lastError || new Error(`Timed out after ${timeoutMs}ms`);
}

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const body = await response.json();
  return { status: response.status, body };
}

async function main() {
  const match = source.match(/function openMeteoWeatherLabel\(code\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'weather label function exists');
  const weatherLabel = vm.runInNewContext(`(${match[0]})`);
  const expected = {
    0: '晴', 1: '晴间多云', 2: '多云', 3: '阴', 5: '霾', 45: '雾', 48: '雾凇',
    51: '小毛毛雨', 53: '中毛毛雨', 55: '大毛毛雨', 56: '小冻毛毛雨', 57: '大冻毛毛雨',
    61: '小雨', 63: '中雨', 65: '大雨', 66: '小冻雨', 67: '大冻雨',
    71: '小雪', 73: '中雪', 75: '大雪', 77: '米雪',
    80: '小阵雨', 81: '中阵雨', 82: '暴雨', 85: '小阵雪', 86: '大阵雪',
    95: '雷雨', 96: '雷阵雨伴小冰雹', 99: '雷阵雨伴大冰雹',
  };
  const actual = Object.fromEntries(Object.keys(expected).map(code => [code, weatherLabel(Number(code))]));
  pass('all supported weather codes have accurate distinct Chinese labels',
    Object.entries(expected).every(([code, label]) => actual[code] === label), actual);
  pass('unknown weather code is explicit', weatherLabel(999) === '未知天气');
  pass('Enter uses the shared submit path with IME protection',
    /event\.isComposing/.test(rendererSource) && /event\.preventDefault\(\)/.test(rendererSource) && /searchCity\(\)/.test(rendererSource));
  pass('weather requests use same-key in-flight reuse and stale-response suppression',
    /weatherRequest && weatherRequest\.key === key/.test(rendererSource) &&
    /serial !== weatherRequestSerial/.test(rendererSource));
  pass('city persistence happens only after successful weather response',
    rendererSource.indexOf('var result = await requestJson') >= 0 &&
    rendererSource.indexOf('var result = await requestJson') < rendererSource.indexOf('save(STORE.city, resolvedCity)'));

  const port = await freePort();
  child = spawn(process.execPath, ['server.js'], {
    cwd: repo,
    windowsHide: true,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => serverLog.push(String(chunk)));
  child.stderr.on('data', chunk => serverLog.push(String(chunk)));
  const origin = `http://127.0.0.1:${port}`;
  await waitFor(async () => {
    const response = await fetch(`${origin}/api/app/version`);
    return response.ok;
  });

  const city = await getJson(`${origin}/api/weather/current?city=${encodeURIComponent('北京')}&force=1`);
  pass('real city weather query succeeds', city.status === 200 && city.body.ok && city.body.weather, city);
  pass('real weather preserves temperature humidity and wind',
    Number.isFinite(city.body.weather.temperature) &&
    Number.isFinite(city.body.weather.humidity) &&
    Number.isFinite(city.body.weather.windSpeed), {
      temperature: city.body.weather.temperature,
      humidity: city.body.weather.humidity,
      windSpeed: city.body.weather.windSpeed,
    });
  pass('real weather label matches returned provider code',
    city.body.weather.label === weatherLabel(city.body.weather.weatherCode), {
      code: city.body.weather.weatherCode,
      label: city.body.weather.label,
    });

  const address = await getJson(`${origin}/api/weather/current?city=${encodeURIComponent('北京市朝阳区三里屯路')}&force=1`);
  pass('Chinese district or address falls back to a real geocoded locality',
    address.status === 200 && address.body.ok && address.body.weather &&
    !address.body.weather.location.fallback &&
    Number.isFinite(address.body.weather.location.latitude) &&
    Number.isFinite(address.body.weather.location.longitude), address);

  const impossible = `此地绝不存在ZXQ${Date.now()}`;
  const missing = await getJson(`${origin}/api/weather/current?city=${encodeURIComponent(impossible)}&force=1`);
  pass('unknown city returns an accurate 404 without Shanghai fallback',
    missing.status === 404 && missing.body.code === 'WEATHER_CITY_NOT_FOUND' && !missing.body.weather, missing);

  const result = {
    ok: true,
    completedAt: new Date().toISOString(),
    checks,
    realWeather: {
      city: city.body.weather.location,
      weatherCode: city.body.weather.weatherCode,
      label: city.body.weather.label,
      temperature: city.body.weather.temperature,
      humidity: city.body.weather.humidity,
      windSpeed: city.body.weather.windSpeed,
    },
  };
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(outDir, 'server.log'), serverLog.join(''));
  console.log(`LF problem 17 smoke PASS: ${path.join(outDir, 'result.json')}`);
}

main().catch(error => {
  fs.writeFileSync(path.join(outDir, 'failure.txt'), String(error && error.stack || error));
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (!child || child.killed) return;
  child.kill();
  await new Promise(resolve => {
    const timer = setTimeout(resolve, 3000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
});
