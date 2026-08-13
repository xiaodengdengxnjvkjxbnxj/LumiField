class LFServiceClient {
  constructor(baseUrl) {
    const normalized = String(baseUrl || '').replace(/\/+$/, '');
    let parsed;
    try { parsed = new URL(normalized); } catch (_) { throw new Error('INVALID_LF_REMOTE_API_URL'); }
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(loopback && parsed.protocol === 'http:')) throw new Error('LF remote API must use HTTPS (HTTP is allowed only for loopback)');
    this.baseUrl = normalized;
  }

  async request(method, pathname, token, payload) {
    const controller = new AbortController();
    const timeout = pathname === '/v1/feedback/upload/finalize' ? 10 * 60 * 1000
      : pathname.startsWith('/v1/feedback/upload/') ? 60000 : 15000;
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(this.baseUrl + pathname, {
        method,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: token ? `Bearer ${token}` : '',
        },
        body: method === 'GET' ? undefined : JSON.stringify(payload || {}),
        signal: controller.signal,
      });
      const text = await response.text();
      let result;
      try { result = text ? JSON.parse(text) : {}; }
      catch (_) { result = { ok: false, error: 'INVALID_REMOTE_RESPONSE' }; }
      if (!response.ok && result.ok !== false) result.ok = false;
      return result;
    } catch (error) {
      return { ok: false, error: error.name === 'AbortError' ? 'REMOTE_TIMEOUT' : 'REMOTE_UNREACHABLE', message: 'LF 远端服务暂时不可用。' };
    } finally { clearTimeout(timer); }
  }

  get(pathname, token) { return this.request('GET', pathname, token); }
  post(pathname, token, payload) { return this.request('POST', pathname, token, payload); }
}

module.exports = { LFServiceClient };
