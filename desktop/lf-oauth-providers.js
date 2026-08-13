const OFFICIAL = Object.freeze({
  wechat: Object.freeze({
    authorization: 'https://open.weixin.qq.com/connect/qrconnect',
    token: 'https://api.weixin.qq.com/sns/oauth2/access_token',
    profile: 'https://api.weixin.qq.com/sns/userinfo',
  }),
  qq: Object.freeze({
    authorization: 'https://graph.qq.com/oauth2.0/authorize',
    token: 'https://graph.qq.com/oauth2.0/token',
    openid: 'https://graph.qq.com/oauth2.0/me',
    profile: 'https://graph.qq.com/user/get_user_info',
  }),
});

function value(input) { return String(input == null ? '' : input).trim(); }
function qqSecret(env) { return value(env.LF_QQ_APP_KEY || env.LF_QQ_APP_SECRET); }
function expectedScope(provider) { return provider === 'wechat' ? 'snsapi_login' : 'get_user_info'; }

function validRedirect(input) {
  try {
    const url = new URL(value(input));
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
    return url.protocol === 'https:' || (loopback && url.protocol === 'http:');
  } catch (_) { return false; }
}

async function responseText(fetcher, url, options) {
  const response = await fetcher(url, options);
  const text = await response.text();
  if (!response.ok) throw Object.assign(new Error('OAUTH_PROVIDER_HTTP_ERROR'), { code: `HTTP_${response.status}` });
  return text;
}

function parseJson(text) {
  try { return JSON.parse(String(text || '')); } catch (_) { return null; }
}

class LFOAuthProviders {
  constructor(env = process.env, fetcher = globalThis.fetch) {
    this.env = env;
    this.fetcher = fetcher;
  }

  configuration(provider) {
    if (!['wechat', 'qq'].includes(provider)) return { configured: false, provider, missing: ['provider'] };
    const prefix = provider === 'wechat' ? 'LF_WECHAT' : 'LF_QQ';
    const redirectName = `${prefix}_REDIRECT_URI`;
    const scopeName = `${prefix}_SCOPE`;
    const stateSecretName = `${prefix}_STATE_SECRET`;
    const scope = value(this.env[scopeName]) || expectedScope(provider);
    const redirectUri = value(this.env[redirectName]);
    const missing = [];
    if (!value(this.env[`${prefix}_APP_ID`])) missing.push(`${prefix}_APP_ID`);
    if (!(provider === 'wechat' ? value(this.env.LF_WECHAT_APP_SECRET) : qqSecret(this.env))) missing.push(provider === 'wechat' ? 'LF_WECHAT_APP_SECRET' : 'LF_QQ_APP_KEY');
    if (!redirectUri || !validRedirect(redirectUri)) missing.push(redirectName);
    if (scope !== expectedScope(provider)) missing.push(scopeName);
    if (value(this.env[stateSecretName]).length < 32) missing.push(stateSecretName);
    return { configured: missing.length === 0, provider, missing: [...new Set(missing)], redirectUri, scope };
  }

  createState(provider) {
    const config = this.configuration(provider);
    if (!config.configured) return { ok: false, provider, missing: config.missing, error: 'BLOCKED_EXTERNAL_CONFIG' };
    const nonce = crypto.randomBytes(24).toString('base64url');
    const signature = crypto.createHmac('sha256', value(this.env[provider === 'wechat' ? 'LF_WECHAT_STATE_SECRET' : 'LF_QQ_STATE_SECRET']))
      .update(`${provider}:${nonce}`).digest('base64url');
    return { ok: true, provider, state: `${provider}.${nonce}.${signature}` };
  }

  stateProvider(state) {
    const provider = value(state).split('.')[0];
    return ['wechat', 'qq'].includes(provider) ? provider : '';
  }

  validateState(provider, state) {
    const parts = value(state).split('.');
    if (parts.length !== 3 || parts[0] !== provider || !/^[A-Za-z0-9_-]{20,128}$/.test(parts[1]) || !/^[A-Za-z0-9_-]{40,80}$/.test(parts[2])) return false;
    const secret = value(this.env[provider === 'wechat' ? 'LF_WECHAT_STATE_SECRET' : 'LF_QQ_STATE_SECRET']);
    if (secret.length < 32) return false;
    const expected = crypto.createHmac('sha256', secret).update(`${provider}:${parts[1]}`).digest('base64url');
    const supplied = Buffer.from(parts[2]);
    const wanted = Buffer.from(expected);
    return supplied.length === wanted.length && crypto.timingSafeEqual(supplied, wanted);
  }

  authorizationUrl(provider, state) {
    const config = this.configuration(provider);
    if (!config.configured) return { ok: false, configured: false, provider, missing: config.missing, error: 'BLOCKED_EXTERNAL_CONFIG' };
    const appId = value(this.env[provider === 'wechat' ? 'LF_WECHAT_APP_ID' : 'LF_QQ_APP_ID']);
    const url = new URL(OFFICIAL[provider].authorization);
    if (provider === 'wechat') {
      url.search = new URLSearchParams({ appid: appId, redirect_uri: config.redirectUri, response_type: 'code', scope: config.scope, state }).toString();
      url.hash = 'wechat_redirect';
    } else {
      url.search = new URLSearchParams({ response_type: 'code', client_id: appId, redirect_uri: config.redirectUri, scope: config.scope, state, display: 'pc' }).toString();
    }
    return { ok: true, configured: true, provider, redirectUri: config.redirectUri, authorizationUrl: url.toString() };
  }

  async exchange(provider, code) {
    const config = this.configuration(provider);
    if (!config.configured) return { ok: false, configured: false, provider, missing: config.missing, error: 'BLOCKED_EXTERNAL_CONFIG' };
    if (!/^[A-Za-z0-9._~-]{4,2048}$/.test(value(code))) return { ok: false, error: 'INVALID_OAUTH_CODE' };
    try {
      return provider === 'wechat' ? await this.exchangeWechat(code) : await this.exchangeQQ(code);
    } catch (error) {
      return { ok: false, provider, error: 'OAUTH_PROVIDER_FAILED', providerError: value(error && error.code || error && error.message || 'PROVIDER_FAILED').slice(0, 80) };
    }
  }

  async exchangeWechat(code) {
    const appId = value(this.env.LF_WECHAT_APP_ID);
    const tokenUrl = new URL(OFFICIAL.wechat.token);
    tokenUrl.search = new URLSearchParams({ appid: appId, secret: value(this.env.LF_WECHAT_APP_SECRET), code: value(code), grant_type: 'authorization_code' }).toString();
    const token = parseJson(await responseText(this.fetcher, tokenUrl));
    if (!token || !token.access_token || !token.openid || token.errcode) throw Object.assign(new Error('WECHAT_TOKEN_FAILED'), { code: `WECHAT_${token && token.errcode || 'TOKEN'}` });
    const profileUrl = new URL(OFFICIAL.wechat.profile);
    profileUrl.search = new URLSearchParams({ access_token: token.access_token, openid: token.openid, lang: 'zh_CN' }).toString();
    const profile = parseJson(await responseText(this.fetcher, profileUrl));
    if (!profile || !profile.openid || profile.errcode) throw Object.assign(new Error('WECHAT_PROFILE_FAILED'), { code: `WECHAT_${profile && profile.errcode || 'PROFILE'}` });
    return { ok: true, provider: 'wechat', providerUserId: value(profile.unionid || profile.openid), displayName: value(profile.nickname).slice(0, 60) || '微信用户', avatarUrl: value(profile.headimgurl).slice(0, 800) };
  }

  async exchangeQQ(code) {
    const appId = value(this.env.LF_QQ_APP_ID);
    const tokenUrl = new URL(OFFICIAL.qq.token);
    tokenUrl.search = new URLSearchParams({ grant_type: 'authorization_code', client_id: appId, client_secret: qqSecret(this.env), code: value(code), redirect_uri: value(this.env.LF_QQ_REDIRECT_URI), fmt: 'json' }).toString();
    const tokenText = await responseText(this.fetcher, tokenUrl);
    const tokenJson = parseJson(tokenText);
    const tokenForm = new URLSearchParams(tokenText);
    const accessToken = value(tokenJson && tokenJson.access_token || tokenForm.get('access_token'));
    if (!accessToken) throw Object.assign(new Error('QQ_TOKEN_FAILED'), { code: 'QQ_TOKEN' });
    const openIdUrl = new URL(OFFICIAL.qq.openid);
    openIdUrl.search = new URLSearchParams({ access_token: accessToken, fmt: 'json' }).toString();
    const openIdText = await responseText(this.fetcher, openIdUrl);
    const openId = parseJson(openIdText) || parseJson((openIdText.match(/\{[\s\S]*\}/) || [])[0]);
    if (!openId || !openId.openid) throw Object.assign(new Error('QQ_OPENID_FAILED'), { code: 'QQ_OPENID' });
    const profileUrl = new URL(OFFICIAL.qq.profile);
    profileUrl.search = new URLSearchParams({ access_token: accessToken, oauth_consumer_key: appId, openid: openId.openid, format: 'json' }).toString();
    const profile = parseJson(await responseText(this.fetcher, profileUrl));
    if (!profile || Number(profile.ret || 0) !== 0) throw Object.assign(new Error('QQ_PROFILE_FAILED'), { code: `QQ_${profile && profile.ret || 'PROFILE'}` });
    return { ok: true, provider: 'qq', providerUserId: value(openId.openid), displayName: value(profile.nickname).slice(0, 60) || 'QQ 用户', avatarUrl: value(profile.figureurl_qq_2 || profile.figureurl_qq_1 || profile.figureurl_2 || '').slice(0, 800) };
  }
}

module.exports = { LFOAuthProviders, OFFICIAL, validRedirect };
const crypto = require('crypto');
