(function () {
  'use strict';

  var api = window.desktopWindow;
  if (!api || typeof api.lfAuthStatus !== 'function') return;

  var TOKEN_KEY = 'lf-auth-token-v1';
  var REFRESH_KEY = 'lf-auth-refresh-v1';
  var CACHE_KEY = 'lf-auth-offline-cache-v1';
  var feedbackFiles = [];
  var feedbackDraftId = '';
  var feedbackDraftPromise = null;
  var feedbackSubmitting = false;
  var lastUpdate = null;
  var integrityWarningActive = false;
  var integrityWarningAcking = false;
  var profileMenuActiveKey = '';
  var profileMenuListenersBound = false;
  var INTEGRITY_WARNING_TEXT = '您没有权限对此软件进行开发，如若继续您的账户将会被自动拉黑。';
  var INTEGRITY_CONTACT_TEXT = '如执意开发/进行二创，请联系作者：3599284614@qq.com / 15037841583@139.com。';
  var state = { user: null, session: null, token: '', refreshToken: '', appVersion: '1.1.1', resetTicket: '', online: navigator.onLine, backendOffline: false, developmentMode: false, codeTimers: {} };
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); };
  var read = function (key) { try { return localStorage.getItem(key) || ''; } catch (_) { return ''; } };
  var write = function (key, value) { try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch (_) {} };
  var toast = function (message) { if (typeof window.showToast === 'function') window.showToast(message); else setStatus('login', message, false); };
  var formatTime = function (value) { if (!value) return '—'; try { return new Date(Number(value)).toLocaleString('zh-CN'); } catch (_) { return '—'; } };
  var PROFILE_FIELDS = [
    { key:'userId', label:'用户 ID', symbol:'ID' },
    { key:'nickname', label:'昵称', symbol:'名' },
    { key:'account', label:'账号', symbol:'账' },
    { key:'loginMethod', label:'登录方式', symbol:'登' },
    { key:'device', label:'当前设备', symbol:'设' },
    { key:'version', label:'当前版本', symbol:'版' },
    { key:'loginAt', label:'登录时间', symbol:'时' },
    { key:'location', label:'登录地点', symbol:'地' },
  ];

  function realDeviceLabel(session) {
    if (session.deviceName) return String(session.deviceName);
    if (session.deviceType) return String(session.deviceType);
    var platform = navigator.userAgentData && navigator.userAgentData.platform || navigator.platform;
    return platform ? String(platform) : '未记录设备信息';
  }

  function realLocationLabel(session) {
    if (session.location) return String(session.location);
    return session.locationConsent === false ? '未授权记录登录地点' : '未记录登录地点';
  }

  function profileFieldValues(user, session) {
    var version = String(state.appVersion || '').replace(/^v/i, '');
    return {
      userId:String(user.id || user.userId || ''),
      nickname:String(user.nickname || ''),
      account:String(user.account || user.email || ''),
      loginMethod:String(session.loginMethod || user.accountType || '未记录登录方式'),
      device:realDeviceLabel(session),
      version:version ? 'v' + version : '未记录版本信息',
      loginAt:formatTime(session.loginAt),
      location:realLocationLabel(session),
    };
  }

  function setProfileMenuActive(nextKey) {
    var root = $('lf-profile-info');
    if (!root) { profileMenuActiveKey = ''; return false; }
    var requested = String(nextKey || '');
    var current = root.querySelector('[data-lf-profile-field="' + requested + '"]');
    profileMenuActiveKey = current && requested !== profileMenuActiveKey ? requested : '';
    root.querySelectorAll('[data-lf-profile-field]').forEach(function (item) {
      var active = item.dataset.lfProfileField === profileMenuActiveKey;
      item.classList.toggle('is-expanded', active);
      var toggle = item.querySelector('.lf-profile-toggle');
      var value = item.querySelector('.lf-profile-value');
      var copy = item.querySelector('.lf-profile-copy');
      if (toggle) {
        toggle.setAttribute('aria-expanded', String(active));
        toggle.setAttribute('aria-label', (active ? '收起' : '展开') + ' ' + (item.dataset.lfProfileLabel || '资料'));
      }
      if (value) value.setAttribute('aria-hidden', String(!active));
      if (copy) {
        copy.tabIndex = active ? 0 : -1;
        copy.setAttribute('aria-hidden', String(!active));
      }
    });
    return !!profileMenuActiveKey;
  }

  function fallbackCopyText(value) {
    var textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    var copied = false;
    try { copied = document.execCommand('copy'); } catch (_) {}
    textarea.remove();
    return copied;
  }

  async function copyProfileField(item) {
    if (!item) return false;
    var value = String(item.dataset.lfProfileValue || '');
    var label = String(item.dataset.lfProfileLabel || '资料');
    if (!value) return false;
    var copied = false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(value);
        copied = true;
      }
    } catch (_) {}
    if (!copied) copied = fallbackCopyText(value);
    toast(copied ? '已复制' + label : label + '复制失败');
    return copied;
  }

  function handleProfileMenuClick(event) {
    var copy = event.target && event.target.closest && event.target.closest('.lf-profile-copy');
    if (copy) {
      event.preventDefault();
      copyProfileField(copy.closest('[data-lf-profile-field]'));
      return;
    }
    var toggle = event.target && event.target.closest && event.target.closest('.lf-profile-toggle');
    if (toggle) setProfileMenuActive(toggle.closest('[data-lf-profile-field]').dataset.lfProfileField);
  }

  function handleProfileMenuKeydown(event) {
    var toggle = event.target && event.target.closest && event.target.closest('.lf-profile-toggle');
    if (toggle && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) setProfileMenuActive(toggle.closest('[data-lf-profile-field]').dataset.lfProfileField);
      return;
    }
    if (event.key === 'Escape' && profileMenuActiveKey) {
      event.preventDefault();
      var active = $('lf-profile-info').querySelector('[data-lf-profile-field="' + profileMenuActiveKey + '"] .lf-profile-toggle');
      setProfileMenuActive('');
      if (active) active.focus();
    }
  }

  function bindProfileMenuListeners() {
    var root = $('lf-profile-info');
    if (!root || profileMenuListenersBound) return;
    root.addEventListener('click', handleProfileMenuClick);
    root.addEventListener('keydown', handleProfileMenuKeydown);
    profileMenuListenersBound = true;
  }
  function emitAuthUserChange() {
    var userId = String(state.user && (state.user.id || state.user.userId || state.user.email) || '');
    try {
      document.dispatchEvent(new CustomEvent('lumifield-auth-user-change', {
        detail:{ loggedIn:!!userId, userId:userId }
      }));
    } catch (_) {}
  }

  function setStatus(scope, message, ok) {
    var el = $('lf-' + scope + '-status');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('ok', !!ok);
    el.classList.toggle('error', !!message && !ok);
  }

  function authMessage(result, fallback) {
    var messages = {
      INVALID_EMAIL: '邮箱格式错误。', INVALID_ACCOUNT: '邮箱格式错误。',
      EMAIL_SERVICE_UNAVAILABLE: '邮件服务暂时不可用。',
      EMAIL_SEND_FAILED: '验证码发送失败，请稍后重试。', BLOCKED_EXTERNAL_CONFIG: '官方开放平台配置尚未完成。',
      RATE_LIMITED: '请求过于频繁，请稍后重试。', CODE_INVALID: '验证码错误。', CODE_EXPIRED: '验证码已过期。',
      CODE_USED: '验证码已使用。', RESERVED_IDENTITY: '该账号为系统保留账号，无法用于普通用户注册。',
    };
    return result && (messages[result.error] || result.message) || fallback;
  }

  function startCodeCooldown(buttonId, seconds) {
    var button = $(buttonId);
    if (!button) return;
    if (state.codeTimers[buttonId]) clearInterval(state.codeTimers[buttonId]);
    var remaining = Math.max(1, Math.min(3600, Number(seconds) || 60));
    button.disabled = true;
    button.textContent = '已发送（' + remaining + 's）';
    state.codeTimers[buttonId] = setInterval(function () {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(state.codeTimers[buttonId]); delete state.codeTimers[buttonId];
        button.disabled = false; button.textContent = '重新发送'; return;
      }
      button.textContent = '已发送（' + remaining + 's）';
    }, 1000);
  }

  function showDevelopmentCode(result) {
    var banner = $('lf-auth-dev-mode');
    if (!banner) return;
    var enabled = !!(state.developmentMode || result && result.developmentMode);
    banner.hidden = !enabled;
    banner.textContent = result && result.developmentMode && result.localCode
      ? '开发测试模式 · 验证码：' + result.localCode
      : '开发测试模式 · 验证码不会发送到真实邮箱';
  }

  function createAuthUI() {
    if ($('lf-auth-root')) return;
    var root = document.createElement('div');
    root.id = 'lf-auth-root';
    root.innerHTML =
      '<div class="lf-auth-card" role="dialog" aria-modal="true" aria-label="LumiField 用户登录">' +
        '<button id="lf-auth-exit" class="lf-auth-exit" type="button" title="退出 LumiField">×</button>' +
        '<div class="lf-auth-brand"><span class="lf-auth-logo">LF</span><div><b>LumiField</b><small>账号系统 · 与网易云 / QQ 音乐账号相互独立</small></div></div>' +
        '<div id="lf-auth-dev-mode" class="lf-auth-status error" hidden></div>' +
        '<div class="lf-auth-tabs"><button class="active" data-lf-auth-tab="login">登录</button><button data-lf-auth-tab="register">注册</button><button data-lf-auth-tab="qr">扫码登录</button></div>' +
        '<section class="lf-auth-pane active" data-lf-auth-pane="login">' +
          '<label><span>邮箱</span><input id="lf-login-account" type="email" autocomplete="username" placeholder="name@example.com"></label>' +
          '<label><span>密码</span><input id="lf-login-password" type="password" autocomplete="current-password" placeholder="8 位以上字母与数字"></label>' +
          '<label class="lf-auth-check"><input id="lf-login-location-consent" type="checkbox"><span>允许记录我手动填写的登录城市（不调用精准定位）</span></label>' +
          '<label id="lf-login-location-row" class="lf-auth-location"><span>登录城市</span><input id="lf-login-location" maxlength="60" placeholder="可选，如 上海"></label>' +
          '<button id="lf-login-submit" class="lf-auth-primary" type="button">登录 LF</button>' +
          '<div class="lf-auth-inline"><button id="lf-forgot-open" type="button">忘记密码</button><span>新用户请先注册</span></div>' +
          '<div id="lf-login-status" class="lf-auth-status" role="status"></div>' +
        '</section>' +
        '<section class="lf-auth-pane" data-lf-auth-pane="register">' +
          '<label><span>邮箱</span><input id="lf-register-account" type="email" autocomplete="username" placeholder="用于接收验证码"></label>' +
          '<label><span>昵称</span><input id="lf-register-nickname" maxlength="60" placeholder="LF 昵称"></label>' +
          '<label><span>验证码</span><div class="lf-auth-code"><input id="lf-register-code" inputmode="numeric" maxlength="6" placeholder="6 位验证码"><button id="lf-register-send" type="button">发送验证码</button></div></label>' +
          '<label><span>密码</span><input id="lf-register-password" type="password" autocomplete="new-password" placeholder="8–128 位，包含字母和数字"></label>' +
          '<label><span>确认密码</span><input id="lf-register-confirm" type="password" autocomplete="new-password" placeholder="再次输入密码"></label>' +
          '<label class="lf-auth-check"><input id="lf-register-agreement" type="checkbox"><span>我已阅读并同意用户协议与隐私说明</span></label>' +
          '<button id="lf-register-submit" class="lf-auth-primary" type="button">注册 LF 账号</button>' +
          '<div id="lf-register-status" class="lf-auth-status" role="status"></div>' +
        '</section>' +
        '<section class="lf-auth-pane" data-lf-auth-pane="qr">' +
          '<div class="lf-auth-qr"><div id="lf-auth-qr-image" class="lf-auth-qr-image">开发中</div><b>手机端 LF 扫码登录</b><span>当前缺少真实手机端与公网服务，暂停端到端登录开发。</span><code id="lf-auth-qr-content"></code></div>' +
          '<button id="lf-qr-refresh" class="lf-auth-primary" type="button" disabled>开发中</button>' +
          '<div id="lf-qr-status" class="lf-auth-status" role="status"></div>' +
        '</section>' +
        '<section class="lf-auth-pane" data-lf-auth-pane="reset">' +
          '<button id="lf-reset-back" class="lf-auth-back" type="button">← 返回登录</button>' +
          '<h3>找回密码</h3>' +
          '<div id="lf-reset-verify-step">' +
            '<label><span>注册邮箱</span><input id="lf-reset-account" type="email" autocomplete="username"></label>' +
            '<label><span>验证码</span><div class="lf-auth-code"><input id="lf-reset-code" inputmode="numeric" maxlength="6"><button id="lf-reset-send" type="button">发送验证码</button></div></label>' +
            '<button id="lf-reset-verify" class="lf-auth-primary" type="button">验证身份</button>' +
          '</div>' +
          '<div id="lf-reset-password-step" hidden>' +
            '<label><span>新密码</span><input id="lf-reset-password" type="password" autocomplete="new-password"></label>' +
            '<label><span>确认新密码</span><input id="lf-reset-confirm" type="password" autocomplete="new-password"></label>' +
            '<button id="lf-reset-submit" class="lf-auth-primary" type="button">确定更改密码</button>' +
          '</div>' +
          '<div id="lf-reset-status" class="lf-auth-status" role="status"></div>' +
        '</section>' +
        '<div class="lf-auth-privacy"><button id="lf-auth-privacy-open" type="button">隐私说明</button><span>密码只保存安全哈希；不收集音乐平台 Cookie。</span></div>' +
      '</div>';
    document.body.appendChild(root);

    root.addEventListener('click', function (event) {
      var tab = event.target.closest('[data-lf-auth-tab]');
      if (tab) switchAuthPane(tab.getAttribute('data-lf-auth-tab'));
    });
    $('lf-auth-exit').onclick = function () { api.close(); };
    $('lf-login-location-consent').onchange = function () { $('lf-login-location-row').classList.toggle('show', this.checked); };
    $('lf-login-submit').onclick = login;
    $('lf-register-send').onclick = function () { sendCode('register'); };
    $('lf-register-submit').onclick = register;
    $('lf-forgot-open').onclick = function () { switchAuthPane('reset'); };
    $('lf-reset-back').onclick = function () { switchAuthPane('login'); };
    $('lf-reset-send').onclick = function () { sendCode('reset'); };
    $('lf-reset-verify').onclick = verifyReset;
    $('lf-reset-submit').onclick = resetPassword;
    $('lf-auth-privacy-open').onclick = openPrivacy;
  }

  function switchAuthPane(name) {
    document.querySelectorAll('[data-lf-auth-pane]').forEach(function (pane) { pane.classList.toggle('active', pane.getAttribute('data-lf-auth-pane') === name); });
    document.querySelectorAll('[data-lf-auth-tab]').forEach(function (tab) { tab.classList.toggle('active', tab.getAttribute('data-lf-auth-tab') === name); });
    if (name === 'qr') showPausedQr();
  }

  function showGate(message) {
    createAuthUI();
    document.body.classList.add('lf-auth-locked');
    $('lf-auth-root').classList.add('show');
    if (message) setStatus('login', message, false);
  }

  function hideGate() {
    document.body.classList.remove('lf-auth-locked');
    var root = $('lf-auth-root');
    if (root) root.classList.remove('show');
  }

  function persistSession(result) {
    state.token = result.sessionHandle || (result.token ? 'main-process' : state.token);
    state.refreshToken = '';
    state.user = result.user || state.user;
    state.session = result.session || state.session;
    write(TOKEN_KEY, state.token);
    write(REFRESH_KEY, '');
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ user: state.user, session: state.session, cachedAt: Date.now() })); } catch (_) {}
  }

  function clearSession() {
    state.token = ''; state.refreshToken = ''; state.user = null; state.session = null;
    write(TOKEN_KEY, ''); write(REFRESH_KEY, '');
    try { localStorage.removeItem(CACHE_KEY); } catch (_) {}
    emitAuthUserChange();
  }

  function removeIntegrityWarning() {
    integrityWarningActive = false;
    integrityWarningAcking = false;
    var root = $('lf-integrity-warning');
    if (root) root.remove();
  }

  function handleIntegrityLocked(payload) {
    removeIntegrityWarning();
    clearSession();
    showGate(payload && payload.message || '您的账户已被限制使用，请通过应用内反馈联系 LumiField 管理员。');
  }

  function ensureIntegrityWarningStyle() {
    if ($('lf-integrity-warning-style')) return;
    var style = document.createElement('style');
    style.id = 'lf-integrity-warning-style';
    style.textContent =
      '#lf-integrity-warning{position:fixed;inset:0;z-index:2147483600;display:grid;place-items:center;padding:24px;background:rgba(2,4,10,.78);backdrop-filter:blur(18px)}' +
      '#lf-integrity-warning>div{width:min(520px,calc(100vw - 32px));padding:25px;border:1px solid rgba(255,116,116,.34);border-radius:18px;background:rgba(15,18,28,.96);box-shadow:0 28px 90px rgba(0,0,0,.58);color:#fff}' +
      '#lf-integrity-warning h2{margin:0 0 16px;font-size:20px}' +
      '#lf-integrity-warning p{margin:10px 0;color:rgba(255,255,255,.82);font-size:14px;line-height:1.75}' +
      '#lf-integrity-warning button{display:block;margin:20px 0 0 auto;min-width:112px;height:38px;border:1px solid rgba(255,255,255,.18);border-radius:10px;background:rgba(255,255,255,.1);color:#fff;cursor:pointer}' +
      '#lf-integrity-warning button:disabled{opacity:.55;cursor:wait}' +
      '#lf-integrity-warning-status{min-height:18px;margin-top:10px;color:#ff9c9c;font-size:12px}';
    document.head.appendChild(style);
  }

  function showIntegrityWarning() {
    if (integrityWarningActive || typeof api.lfAcknowledgeIntegrityWarning !== 'function') return;
    integrityWarningActive = true;
    ensureIntegrityWarningStyle();
    var root = document.createElement('div');
    root.id = 'lf-integrity-warning';
    root.innerHTML = '<div role="alertdialog" aria-modal="true" aria-labelledby="lf-integrity-warning-title">' +
      '<h2 id="lf-integrity-warning-title">LumiField 安全警告</h2>' +
      '<p id="lf-integrity-warning-message"></p><p id="lf-integrity-warning-contact"></p>' +
      '<div id="lf-integrity-warning-status" role="status" aria-live="polite"></div>' +
      '<button id="lf-integrity-warning-ack" type="button">我已知晓</button></div>';
    document.body.appendChild(root);
    $('lf-integrity-warning-message').textContent = INTEGRITY_WARNING_TEXT;
    $('lf-integrity-warning-contact').textContent = INTEGRITY_CONTACT_TEXT;
    var button = $('lf-integrity-warning-ack');
    button.onclick = async function () {
      if (integrityWarningAcking) return;
      integrityWarningAcking = true;
      button.disabled = true;
      $('lf-integrity-warning-status').textContent = '正在确认警告…';
      try {
        var result = await api.lfAcknowledgeIntegrityWarning();
        if (result && result.ok) {
          removeIntegrityWarning();
          return;
        }
        if (result && (result.error === 'BLACKLISTED' || result.blocked)) {
          handleIntegrityLocked(result);
          return;
        }
        $('lf-integrity-warning-status').textContent = result && (result.message || result.error) || '警告确认失败，请重试。';
      } catch (_) {
        $('lf-integrity-warning-status').textContent = '警告确认失败，请重试。';
      }
      integrityWarningAcking = false;
      button.disabled = false;
    };
    window.setTimeout(function () { if (button && button.isConnected) button.focus(); }, 0);
  }

  async function syncIntegrityStatus() {
    if (typeof api.lfIntegrityStatus !== 'function') return;
    try {
      var result = await api.lfIntegrityStatus();
      if (result && (result.blacklisted || result.state === 'blocked' || result.error === 'BLACKLISTED')) {
        handleIntegrityLocked(result);
        return;
      }
      if (result && result.warning && result.warning.requiresAcknowledgement) showIntegrityWarning();
    } catch (_) {}
  }

  async function login() {
    setStatus('login', '正在登录…', true);
    var consent = $('lf-login-location-consent').checked;
    var result = await api.lfLogin({
      account: $('lf-login-account').value,
      password: $('lf-login-password').value,
      method: 'password',
      deviceType: 'pc',
      locationAuthorized: consent,
      location: consent ? $('lf-login-location').value : '',
    });
    if (!result.ok) {
      return setStatus('login', authMessage(result, '登录失败。'), false);
    }
    persistSession(result);
    setStatus('login', '登录成功', true);
    unlock(result);
  }

  async function sendCode(purpose) {
    var account = purpose === 'register' ? $('lf-register-account').value : $('lf-reset-account').value;
    var scope = purpose === 'register' ? 'register' : 'reset';
    var buttonId = purpose === 'register' ? 'lf-register-send' : 'lf-reset-send';
    var button = $(buttonId);
    if (!button || button.disabled) return;
    button.disabled = true; button.textContent = '正在发送…';
    setStatus(scope, '正在发送验证码…', true);
    try {
      var result = await api.lfSendCode({ account: account, purpose: purpose });
      if (!result.ok) {
        if (result.error === 'RATE_LIMITED' && result.retryAfter) startCodeCooldown(buttonId, result.retryAfter);
        else { button.disabled = false; button.textContent = '发送验证码'; }
        return setStatus(scope, authMessage(result, '验证码发送失败，请稍后重试。'), false);
      }
      startCodeCooldown(buttonId, result.cooldownSeconds || 60);
      showDevelopmentCode(result);
      setStatus(scope, result.developmentMode ? '开发测试验证码已生成。' : '验证码发送成功，请查收。', true);
    } catch (_) {
      button.disabled = false; button.textContent = '发送验证码';
      setStatus(scope, '验证码发送失败，请稍后重试。', false);
    }
  }

  async function register() {
    var password = $('lf-register-password').value;
    if (password !== $('lf-register-confirm').value) return setStatus('register', '两次密码输入不一致。', false);
    if (!$('lf-register-agreement').checked) return setStatus('register', '请先同意用户协议与隐私说明。', false);
    setStatus('register', '正在创建账号…', true);
    var result = await api.lfRegister({ account: $('lf-register-account').value, nickname: $('lf-register-nickname').value, code: $('lf-register-code').value, password: password });
    if (!result.ok) return setStatus('register', authMessage(result, '注册失败。'), false);
    $('lf-login-account').value = $('lf-register-account').value;
    $('lf-login-password').value = '';
    switchAuthPane('login');
    setStatus('login', '注册成功，请使用刚设置的密码登录。', true);
  }

  async function verifyReset() {
    setStatus('reset', '正在验证…', true);
    var result = await api.lfVerifyResetCode({ account: $('lf-reset-account').value, code: $('lf-reset-code').value });
    if (!result.ok) return setStatus('reset', authMessage(result, '验证失败。'), false);
    if (!window.confirm('身份验证成功，是否更改密码？')) return setStatus('reset', '已取消更改密码。', true);
    state.resetTicket = result.ticket;
    $('lf-reset-verify-step').hidden = true;
    $('lf-reset-password-step').hidden = false;
    setStatus('reset', '请输入两次新密码。', true);
  }

  async function resetPassword() {
    var password = $('lf-reset-password').value;
    if (password !== $('lf-reset-confirm').value) return setStatus('reset', '两次密码输入不一致。', false);
    var result = await api.lfResetPassword({ account: $('lf-reset-account').value, ticket: state.resetTicket, password: password });
    if (!result.ok) return setStatus('reset', result.message || result.error || '密码更改失败', false);
    $('lf-reset-verify-step').hidden = false;
    $('lf-reset-password-step').hidden = true;
    state.resetTicket = '';
    switchAuthPane('login');
    $('lf-login-account').value = $('lf-reset-account').value;
    setStatus('login', '密码已更改，请使用新密码登录。', true);
  }

  function showPausedQr() {
    var image = $('lf-auth-qr-image');
    if (!image) return;
    image.textContent = '开发中';
    if ($('lf-auth-qr-content')) $('lf-auth-qr-content').textContent = '';
    if ($('lf-qr-refresh')) { $('lf-qr-refresh').disabled = true; $('lf-qr-refresh').textContent = '开发中'; }
    setStatus('qr', 'PAUSED_DEVELOPMENT · 当前缺少真实手机端与公网服务，不会创建二维码或发起确认事务。', false);
  }

  function createProfileUI() {
    if ($('lf-profile-modal')) return;
    var button = document.createElement('button');
    button.id = 'lf-account-button'; button.type = 'button'; button.textContent = '我的'; button.title = 'LF 我的账号';
    button.onclick = openProfile;
    var top = $('top-right');
    if (top) top.insertBefore(button, $('user-btn'));
    else document.body.appendChild(button);

    var modal = document.createElement('div');
    modal.id = 'lf-profile-modal';
    modal.innerHTML =
      '<div class="lf-profile-dialog" role="dialog" aria-modal="true"><button id="lf-profile-close" class="lf-panel-x">×</button>' +
        '<div class="lf-profile-head"><div id="lf-profile-avatar" class="lf-profile-avatar">LF</div><div><h2>我的</h2><div id="lf-profile-role"></div></div></div>' +
        '<div id="lf-profile-info" class="lf-profile-info"></div>' +
        '<section class="lf-profile-section"><h3>安全设置</h3><div class="lf-feedback-row"><input id="lf-current-password" type="password" autocomplete="current-password" placeholder="当前密码"><input id="lf-new-password" type="password" autocomplete="new-password" placeholder="新密码（字母与数字）"><input id="lf-new-password-confirm" type="password" autocomplete="new-password" placeholder="确认新密码"><button id="lf-change-password" type="button">修改密码</button></div><div id="lf-password-status" class="lf-auth-status"></div></section>' +
        '<section class="lf-profile-section"><h3>反馈问题</h3><textarea id="lf-feedback-content" maxlength="5000" placeholder="请描述问题"></textarea><label class="lf-feedback-contact"><span>联系方式 <em>*</em></span><input id="lf-feedback-contact" maxlength="160" required aria-required="true" placeholder="必填：邮箱或中国大陆手机号"></label><div class="lf-feedback-attachments"><div class="lf-feedback-attachment-head"><span>附件</span><button id="lf-feedback-pick" type="button">选择文件</button></div><input id="lf-feedback-file" type="file" multiple hidden><div id="lf-feedback-files" class="lf-feedback-files"></div></div><button id="lf-feedback-submit" type="button">提交反馈</button><div id="lf-feedback-status" class="lf-auth-status"></div></section>' +
        '<section class="lf-profile-section"><h3>设置</h3><div class="lf-settings-grid"><button id="lf-switch-account">登录其他账号</button><button id="lf-check-update" class="lf-update-button">检查更新<span id="lf-update-dot" class="lf-update-dot" hidden></span></button><button id="lf-update-details">详情</button><button id="lf-privacy-open">隐私说明</button><button id="lf-agreement-open">用户协议</button></div><div id="lf-update-status" class="lf-auth-status"></div></section>' +
      '</div>';
    document.body.appendChild(modal);
    bindProfileMenuListeners();
    $('lf-profile-close').onclick = closeProfile;
    modal.addEventListener('click', function (event) { if (event.target === modal) closeProfile(); });
    $('lf-feedback-submit').onclick = submitFeedback;
    $('lf-change-password').onclick = changePassword;
    $('lf-switch-account').onclick = openAccountManager;
    $('lf-check-update').onclick = checkUpdate;
    $('lf-update-details').onclick = openUpdateDetails;
    $('lf-privacy-open').onclick = openPrivacy;
    $('lf-agreement-open').onclick = openAgreement;
    $('lf-feedback-pick').onclick = function () { $('lf-feedback-file').click(); };
    $('lf-feedback-file').onchange = queueFeedbackFiles;
  }

  function renderProfile() {
    if (!state.user) return;
    var user = state.user, session = state.session || {};
    var values = profileFieldValues(user, session);
    $('lf-profile-avatar').textContent = 'LF';
    $('lf-profile-role').textContent = user.role === 'admin' ? '管理员 · 已拥有开发权限' : (user.developerPermission ? '已授权开发 / 二创' : '普通用户');
    if (!PROFILE_FIELDS.some(function (field) { return field.key === profileMenuActiveKey; })) profileMenuActiveKey = '';
    $('lf-profile-info').innerHTML = PROFILE_FIELDS.map(function (field, index) {
      var value = String(values[field.key] || '—');
      var expanded = field.key === profileMenuActiveKey;
      var valueId = 'lf-profile-value-' + field.key;
      return '<div class="lf-profile-item' + (expanded ? ' is-expanded' : '') + '" data-lf-profile-field="' + field.key + '" data-lf-profile-label="' + esc(field.label) + '" data-lf-profile-value="' + esc(value) + '" data-lf-profile-tone="' + index + '">' +
        '<button class="lf-profile-toggle" type="button" aria-expanded="' + String(expanded) + '" aria-controls="' + valueId + '" aria-label="' + (expanded ? '收起 ' : '展开 ') + esc(field.label) + '" title="' + esc(field.label + '：' + value) + '">' +
          '<span class="lf-profile-symbol" aria-hidden="true">' + esc(field.symbol) + '</span>' +
          '<span class="lf-profile-label">' + esc(field.label) + '</span>' +
          '<span class="lf-profile-hint" aria-hidden="true">点击展开</span>' +
          '<span id="' + valueId + '" class="lf-profile-value" aria-hidden="' + String(!expanded) + '"><b>' + esc(value) + '</b></span>' +
        '</button>' +
        '<button class="lf-profile-copy" type="button" tabindex="' + (expanded ? '0' : '-1') + '" aria-hidden="' + String(!expanded) + '" aria-label="复制完整' + esc(field.label) + '" title="复制完整' + esc(field.label) + '">复制</button>' +
      '</div>';
    }).join('');
    bindProfileMenuListeners();
    var accountButton = $('lf-account-button');
    if (accountButton) accountButton.textContent = user.role === 'admin' ? '我的 · LumiField 管理员' : '我的';
  }

  function openProfile() {
    createProfileUI();
    renderProfile();
    var modal = $('lf-profile-modal');
    modal.classList.add('show');
    if (window.LumiFieldProfileNeuralVortex) window.LumiFieldProfileNeuralVortex.activate(modal);
  }
  function closeProfile() {
    setProfileMenuActive('');
    if (window.LumiFieldProfileNeuralVortex) window.LumiFieldProfileNeuralVortex.deactivate();
    if ($('lf-profile-modal')) $('lf-profile-modal').classList.remove('show');
  }

  function createAccountManagerUI() {
    if ($('lf-account-manager')) return;
    var modal = document.createElement('div');
    modal.id = 'lf-account-manager';
    modal.innerHTML = '<div class="lf-account-manager-dialog"><button id="lf-account-close" class="lf-panel-x">×</button><h2>账号管理器</h2><p class="lf-account-summary">LF 账号仅使用邮箱；与五个音乐平台账号严格隔离。</p><div id="lf-account-current"></div><section><h3>邮箱登录方式</h3><div id="lf-account-identities" class="lf-account-identities"></div></section><section><h3>绑定邮箱</h3><div class="lf-account-email"><input id="lf-bind-email" type="email" placeholder="name@example.com"><input id="lf-bind-email-code" inputmode="numeric" maxlength="6" placeholder="6 位验证码"><button id="lf-bind-email-send">发送验证码</button><input id="lf-bind-email-password" type="password" placeholder="首次绑定邮箱时设置密码"><button id="lf-bind-email-submit">绑定邮箱</button></div></section><div class="lf-account-actions"><button id="lf-account-add">添加或切换账号</button><button id="lf-account-logout" class="danger">明确退出当前账号</button></div><div id="lf-account-status" class="lf-auth-status"></div></div>';
    document.body.appendChild(modal);
    $('lf-account-close').onclick = function () { modal.classList.remove('show'); };
    modal.addEventListener('click', function (event) {
      if (event.target === modal) modal.classList.remove('show');
    });
    $('lf-account-add').onclick = function () { modal.classList.remove('show'); signOut(true); };
    $('lf-account-logout').onclick = function () { modal.classList.remove('show'); signOut(false); };
    $('lf-bind-email-send').onclick = sendBindEmailCode;
    $('lf-bind-email-submit').onclick = bindEmail;
  }

  async function renderAccountManager() {
    createAccountManagerUI();
    var user = state.user || {};
    $('lf-account-current').innerHTML = '<div class="lf-account-current"><span class="lf-auth-logo">LF</span><div><b>' + esc(user.nickname || 'LF 用户') + '</b><small>' + esc(user.id || '') + '</small></div></div>';
    var result = await api.lfIdentities(state.token);
    var identities = result.ok ? (result.identities || []).filter(function (identity) { return identity.type === 'email'; }) : [];
    $('lf-account-identities').innerHTML = identities.map(function (identity) {
      return '<div class="lf-account-identity"><div><b>邮箱</b><span>' + esc(identity.value || identity.displayName || '已绑定') + '</span></div></div>';
    }).join('') || '<div class="lf-account-empty">尚未绑定邮箱。</div>';
  }

  function openAccountManager() {
    closeProfile();
    createAccountManagerUI(); renderAccountManager(); $('lf-account-manager').classList.add('show');
  }

  async function sendBindEmailCode() {
    var email = $('lf-bind-email').value;
    var result = await api.lfSendCode({ account: email, targetType: 'email', purpose: 'bind_email' });
    setStatus('account', result.message || result.error || '', !!result.ok);
    if (result.ok) startCodeCooldown('lf-bind-email-send', result.cooldownSeconds || 60);
  }

  async function bindEmail() {
    var result = await api.lfBindEmail(state.token, { email: $('lf-bind-email').value, code: $('lf-bind-email-code').value, password: $('lf-bind-email-password').value });
    setStatus('account', result.message || result.error || '', !!result.ok);
    if (result.ok) { var profile = await api.lfProfile(state.token); if (profile.ok) { state.user = profile.user; renderProfile(); } renderAccountManager(); }
  }

  function formatBytes(value) {
    var size = Number(value) || 0, units = ['B','KB','MB','GB']; var unit = 0;
    while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
    return (unit ? size.toFixed(size >= 10 ? 1 : 2) : Math.round(size)) + ' ' + units[unit];
  }

  function feedbackStatusText(entry) {
    var labels = {
      selected: 'SELECTED · 已选择',
      queued: 'QUEUED · 排队中',
      uploading: 'UPLOADING · ' + Math.round(Number(entry.progress) || 0) + '%',
      verifying: 'VERIFYING · 正在校验',
      uploaded: 'UPLOADED · 上传完成',
      failed: 'FAILED · ' + (entry.error || '上传失败'),
      cancelled: 'CANCELLED · 已取消'
    };
    return labels[entry.status] || labels.queued;
  }

  function updateFeedbackUploadDetails(entry, result) {
    if (!result) return;
    if (result.uploadId) entry.uploadId = result.uploadId;
    if (result.attachmentId) entry.attachmentId = result.attachmentId;
    if (result.receivedSize != null) entry.receivedSize = Number(result.receivedSize) || 0;
    if (result.nextChunk != null) entry.nextChunk = Number(result.nextChunk) || 0;
    if (result.progress != null) entry.progress = Math.max(0, Math.min(100, Number(result.progress) || 0));
  }

  async function ensureFeedbackDraft() {
    if (feedbackDraftId) return feedbackDraftId;
    if (feedbackDraftPromise) return feedbackDraftPromise;
    feedbackDraftPromise = (async function () {
      if (typeof api.lfCreateFeedbackDraft !== 'function') throw new Error('当前版本缺少附件草稿上传能力。');
      var result = await api.lfCreateFeedbackDraft(state.token);
      if (!result || !result.ok || !(result.id || result.feedbackId)) throw new Error(result && (result.message || result.error) || '反馈草稿创建失败。');
      feedbackDraftId = result.id || result.feedbackId;
      return feedbackDraftId;
    })();
    try { return await feedbackDraftPromise; }
    finally { feedbackDraftPromise = null; }
  }

  function beginFeedbackUpload(entry, resume) {
    entry.cancelled = false;
    entry.error = '';
    entry.status = 'selected';
    renderFeedbackFiles();
    entry.uploadPromise = Promise.resolve().then(async function () {
      if (entry.cancelled) return { ok:false, error:'UPLOAD_CANCELLED' };
      entry.status = 'queued';
      renderFeedbackFiles();
      try {
        var draftId = await ensureFeedbackDraft();
        if (entry.cancelled) return { ok:false, error:'UPLOAD_CANCELLED' };
        entry.status = 'uploading';
        renderFeedbackFiles();
        var resumeState = resume && entry.uploadId ? {
          uploadId: entry.uploadId,
          receivedSize: Number(entry.receivedSize) || 0,
          nextChunk: Number(entry.nextChunk) || 0
        } : null;
        var result = await api.lfUploadFeedbackFile(state.token, draftId, entry.id, entry.file, resumeState);
        updateFeedbackUploadDetails(entry, result);
        if (entry.cancelled || (result && result.error === 'UPLOAD_CANCELLED')) {
          entry.status = 'cancelled';
          return result || { ok:false, error:'UPLOAD_CANCELLED' };
        }
        if (!result || !result.ok) throw new Error(result && (result.message || result.error) || 'UPLOAD_FAILED');
        entry.status = 'uploaded';
        entry.progress = 100;
        entry.error = '';
        return result;
      } catch (error) {
        if (entry.cancelled) {
          entry.status = 'cancelled';
          return { ok:false, error:'UPLOAD_CANCELLED' };
        }
        entry.status = 'failed';
        entry.error = error.message || 'UPLOAD_FAILED';
        return { ok:false, error:entry.error, uploadId:entry.uploadId || '' };
      } finally {
        renderFeedbackFiles();
      }
    });
    return entry.uploadPromise;
  }

  function queueFeedbackFiles(event) {
    var files = Array.from(event.target.files || []); event.target.value = '';
    if (feedbackSubmitting) return setStatus('feedback', '反馈正在提交，请稍候。', false);
    var dangerous = /\.(exe|msi|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|scr|cpl|dll|sys|jar|hta|reg|lnk|url|appx|appxbundle)$/i;
    files.forEach(function (file) {
      if (dangerous.test(file.name || '')) return setStatus('feedback', '已拒绝危险可执行文件：' + file.name, false);
      if (!file.size || file.size > 3 * 1024 * 1024 * 1024) return setStatus('feedback', '单文件不能超过 3 GB：' + file.name, false);
      var entry = { id:'file-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,7), file:file, status:'selected', progress:0, error:'', uploadId:'', attachmentId:'', receivedSize:0, nextChunk:0, cancelled:false, uploadPromise:null };
      feedbackFiles.push(entry);
      beginFeedbackUpload(entry, false);
    });
    renderFeedbackFiles();
  }

  function renderFeedbackFiles() {
    var box = $('lf-feedback-files'); if (!box) return;
    box.innerHTML = feedbackFiles.map(function (entry) {
      var disabled = feedbackSubmitting || entry.removing ? ' disabled' : '';
      var actions = entry.status === 'failed'
        ? '<button data-retry-file="' + entry.id + '"' + disabled + '>重试</button><button data-remove-file="' + entry.id + '"' + disabled + '>删除</button>'
        : entry.status === 'uploaded'
          ? '<button data-remove-file="' + entry.id + '"' + disabled + '>删除</button>'
          : entry.status === 'cancelled'
            ? '<button data-remove-file="' + entry.id + '"' + disabled + '>移除</button>'
            : '<button data-remove-file="' + entry.id + '"' + disabled + '>取消并删除</button>';
      var progress = Math.max(0, Math.min(100, Number(entry.progress) || 0));
      return '<div class="lf-feedback-file-card" data-file-id="' + entry.id + '" data-upload-state="' + esc(entry.status) + '" data-upload-progress="' + progress + '"><div><b>' + esc(entry.file.name) + '</b><span>' + esc(entry.file.type || 'application/octet-stream') + ' · ' + formatBytes(entry.file.size) + '</span></div><div class="lf-feedback-progress"><i style="width:' + progress + '%"></i></div><span class="lf-feedback-file-state">' + esc(feedbackStatusText(entry)) + '</span><div class="lf-feedback-file-actions">' + actions + '</div></div>';
    }).join('');
    box.querySelectorAll('[data-retry-file]').forEach(function (button) { button.onclick = function () {
      var entry = feedbackFiles.find(function (item) { return item.id === button.dataset.retryFile; });
      if (entry && !feedbackSubmitting) beginFeedbackUpload(entry, true);
    }; });
    box.querySelectorAll('[data-remove-file]').forEach(function (button) { button.onclick = function () {
      var entry = feedbackFiles.find(function (item) { return item.id === button.dataset.removeFile; });
      if (entry && !feedbackSubmitting) removeFeedbackFile(entry);
    }; });
  }

  async function removeFeedbackFile(entry) {
    if (entry.removing) return;
    entry.removing = true;
    var previousStatus = entry.status;
    entry.cancelled = true;
    entry.status = 'cancelled';
    renderFeedbackFiles();
    try {
      if (entry.attachmentId) {
        var deleted = await api.lfDeleteFeedbackAttachment(state.token, entry.attachmentId);
        if (!deleted || !deleted.ok) throw new Error(deleted && (deleted.message || deleted.error) || '附件删除失败。');
      } else if (previousStatus !== 'cancelled') {
        var cancelled = await api.lfCancelFeedbackUpload(state.token, entry.id, entry.uploadId || '');
        if (cancelled && cancelled.ok === false && cancelled.error !== 'UPLOAD_NOT_FOUND') throw new Error(cancelled.message || cancelled.error || '附件取消失败。');
      }
      feedbackFiles = feedbackFiles.filter(function (item) { return item !== entry; });
    } catch (error) {
      entry.cancelled = false;
      entry.status = 'failed';
      entry.error = error.message || '附件删除失败。';
    } finally {
      entry.removing = false;
      renderFeedbackFiles();
    }
  }

  function setFeedbackSubmitting(active) {
    feedbackSubmitting = !!active;
    if ($('lf-feedback-submit')) $('lf-feedback-submit').disabled = feedbackSubmitting;
    if ($('lf-feedback-pick')) $('lf-feedback-pick').disabled = feedbackSubmitting;
    if ($('lf-feedback-file')) $('lf-feedback-file').disabled = feedbackSubmitting;
    renderFeedbackFiles();
  }

  async function submitFeedback() {
    var content = $('lf-feedback-content').value.trim();
    var contact = $('lf-feedback-contact').value.trim();
    if (content.length < 5) return setStatus('feedback', '请至少填写 5 个字的问题描述。', false);
    if (!contact) return setStatus('feedback', '联系方式为必填项，请填写有效邮箱或中国大陆手机号。', false);
    if (!(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) || /^1[3-9]\d{9}$/.test(contact))) return setStatus('feedback', '联系方式必须是有效邮箱或中国大陆手机号。', false);
    setFeedbackSubmitting(true);
    try {
      var pending = feedbackFiles.map(function (entry) { return entry.uploadPromise; }).filter(Boolean);
      if (pending.length) {
        setStatus('feedback', '正在等待附件上传并校验完成…', true);
        await Promise.all(pending);
      }
      var incomplete = feedbackFiles.filter(function (entry) { return entry.status !== 'uploaded'; });
      if (incomplete.length) {
        setStatus('feedback', incomplete.length + ' 个附件未上传完成，请重试或删除后再提交。', false);
        return;
      }
      setStatus('feedback', '正在保存反馈…', true);
      var result = await api.lfSubmitFeedback(state.token, { draftId:feedbackDraftId, content:content, contact:contact, clientVersion:state.appVersion, deviceInfo:(state.session && state.session.deviceName) || 'Windows PC', offline:!state.online || state.backendOffline });
      if (!result.ok) return setStatus('feedback', result.message || result.error || '反馈保存失败。', false);
      var savedFeedbackId = result.id || result.feedbackId || feedbackDraftId;
      var delivery = await api.lfFinalizeFeedback(state.token, savedFeedbackId);
      var databaseText = '数据库保存成功';
      var mailText = delivery && delivery.mailDelivered ? '通知邮件发送成功' : '通知邮件已进入重试队列';
      setStatus('feedback', databaseText + '；' + mailText, true);
      $('lf-feedback-content').value = '';
      $('lf-feedback-contact').value = '';
      feedbackFiles = [];
      feedbackDraftId = '';
      feedbackDraftPromise = null;
      renderFeedbackFiles();
    } finally { setFeedbackSubmitting(false); }
  }

  async function changePassword() {
    var currentPassword = $('lf-current-password').value;
    var newPassword = $('lf-new-password').value;
    if (newPassword !== $('lf-new-password-confirm').value) return setStatus('password', '两次新密码输入不一致。', false);
    setStatus('password', '正在安全更新密码…', true);
    var result = await api.lfChangePassword({ currentPassword: currentPassword, newPassword: newPassword });
    setStatus('password', result.message || result.error || '密码修改失败。', !!result.ok);
    if (result.ok) { $('lf-current-password').value = ''; $('lf-new-password').value = ''; $('lf-new-password-confirm').value = ''; if (state.user) state.user.mustChangePassword = false; }
  }

  async function signOut(switching) {
    if (state.token) await api.lfLogout(state.token);
    clearSession(); closeProfile(); showGate(switching ? '请输入要切换到的 LF 账号。' : '已退出 LF 账号。');
  }

  async function checkUpdate() {
    if (!state.online || state.backendOffline) return setStatus('update', '离线模式下不能检查更新。', false);
    var result = await api.lfAvailableUpdate(state.token, state.appVersion);
    if (!result.ok) return setStatus('update', result.message || result.error, false);
    lastUpdate = result.update || null;
    if ($('lf-update-dot')) $('lf-update-dot').hidden = true;
    if (!result.update) return setStatus('update', '当前已是管理员已发布的最新版本。', true);
    setStatus('update', '发现 v' + result.update.version + '，由你决定是否更新。' + (result.update.notes || ''), true);
    if (!window.confirm('发现 v' + result.update.version + '，是否下载并验证更新包？')) return;
    setStatus('update', '正在准备已签名更新包…', true);
    var install = await api.lfInstallUpdate(state.token, state.appVersion);
    setStatus('update', install.message || install.error || '', !!install.ok);
  }

  async function probeUpdate() {
    if (!state.token || !state.online || state.backendOffline) return;
    try {
      var result = await api.lfAvailableUpdate(state.token, state.appVersion);
      lastUpdate = result && result.ok ? result.update || null : null;
      if ($('lf-update-dot')) $('lf-update-dot').hidden = !lastUpdate;
    } catch (_) {}
  }

  function openUpdateDetails() {
    closeProfile();
    createLegalModal();
    $('lf-legal-title').textContent = '版本更新详情';
    var release = lastUpdate;
    if (!release) {
      $('lf-legal-body').innerHTML = '<p>当前没有待读取的新版本。点击“检查更新”可重新查询。</p>';
    } else {
      var detail = {};
      try { detail = JSON.parse(release.notes || '{}'); } catch (_) { detail = { features: release.notes || '未提供' }; }
      function list(value) { var items = Array.isArray(value) ? value : value ? [value] : ['未提供']; return '<ul>' + items.map(function(item){ return '<li>' + esc(item) + '</li>'; }).join('') + '</ul>'; }
      $('lf-legal-body').innerHTML = '<p><b>新版本：</b>v' + esc(release.version) + '</p><p><b>发布时间：</b>' + esc(formatTime(release.decided_at || release.created_at)) + '</p><h3>新增功能</h3>' + list(detail.features) + '<h3>修复 Bug</h3>' + list(detail.fixes) + '<h3>性能优化</h3>' + list(detail.performance) + '<h3>已知问题</h3>' + list(detail.knownIssues) + '<p><b>更新包大小：</b>' + esc(release.package_size ? formatBytes(release.package_size) : '未知') + '</p>';
    }
    if ($('lf-update-dot')) $('lf-update-dot').hidden = true;
    $('lf-legal-modal').classList.add('show');
  }

  function createLegalModal() {
    if ($('lf-legal-modal')) return;
    var modal = document.createElement('div');
    modal.id = 'lf-legal-modal';
    modal.innerHTML = '<div class="lf-legal-dialog" role="dialog" aria-modal="true" aria-labelledby="lf-legal-title"><button id="lf-legal-close" class="lf-panel-x" type="button" aria-label="关闭">×</button><h2 id="lf-legal-title"></h2><div id="lf-legal-body"></div></div>';
    document.body.appendChild(modal);
    $('lf-legal-close').onclick = function () { modal.classList.remove('show'); };
    modal.addEventListener('click', function (event) { if (event.target === modal) modal.classList.remove('show'); });
  }

  function renderLegalDocument(kind, supplied) {
    var library = window.LumiFieldLegalContent || {};
    var fallback = library[kind] || {};
    var source = supplied && Array.isArray(supplied.sections) ? supplied : fallback;
    var sections = Array.isArray(source.sections) ? source.sections : [];
    var version = String(source.version || library.version || state.appVersion || '').replace(/^v/i, '');
    var effectiveDate = source.effectiveDate || library.effectiveDate || '';
    var body = $('lf-legal-body');
    $('lf-legal-title').textContent = source.title || fallback.title || (kind === 'privacy' ? 'LumiField 隐私说明' : 'LumiField 用户协议');
    body.dataset.document = kind;
    body.dataset.version = version;
    body.innerHTML =
      '<p class="lf-legal-meta">适用版本：v' + esc(version || '当前版本') + (effectiveDate ? ' · 生效日期：' + esc(effectiveDate) : '') + '</p>' +
      '<p class="lf-legal-intro">' + esc(source.intro || fallback.intro || '') + '</p>' +
      sections.map(function (section) {
        var paragraphs = (section.paragraphs || []).map(function (text) { return '<p>' + esc(text) + '</p>'; }).join('');
        var items = Array.isArray(section.items) && section.items.length ? '<ul>' + section.items.map(function (text) { return '<li>' + esc(text) + '</li>'; }).join('') + '</ul>' : '';
        return '<section class="lf-legal-section" data-legal-section="' + esc(section.id || '') + '"><h3>' + esc(section.title || '') + '</h3>' + paragraphs + items + '</section>';
      }).join('');
    body.scrollTop = 0;
    var dialog = body.closest('.lf-legal-dialog');
    if (dialog) dialog.scrollTop = 0;
  }

  async function openPrivacy() {
    closeProfile();
    createLegalModal();
    var result = null;
    try { result = await api.lfPrivacyNotice(); } catch (_) {}
    renderLegalDocument('privacy', result && result.ok ? result : null);
    $('lf-legal-modal').classList.add('show');
  }

  function openAgreement() {
    closeProfile();
    createLegalModal();
    renderLegalDocument('agreement', null);
    $('lf-legal-modal').classList.add('show');
  }

  function updateOfflineState() {
    state.online = navigator.onLine;
    var effectiveOnline = state.online && !state.backendOffline;
    var badge = $('lf-offline-badge');
    if (!badge) { badge = document.createElement('div'); badge.id = 'lf-offline-badge'; badge.textContent = '离线模式'; document.body.appendChild(badge); }
    badge.classList.toggle('show', !effectiveOnline);
    var input = $('search-input');
    if (input) {
      if (!input.dataset.lfOnlinePlaceholder) input.dataset.lfOnlinePlaceholder = input.placeholder || '搜索歌曲、歌手...';
      input.readOnly = !effectiveOnline;
      input.placeholder = effectiveOnline ? input.dataset.lfOnlinePlaceholder : '离线模式：在线搜索不可用';
    }
    if (state.token && effectiveOnline) api.lfSetOnline(state.token, !document.hidden).catch(function () {});
  }

  function unlock(result) {
    if (result && (result.sessionHandle || result.token || result.user)) persistSession(result);
    hideGate(); createProfileUI(); renderProfile(); updateOfflineState();
    emitAuthUserChange();
    syncIntegrityStatus();
    probeUpdate();
    if (result && result.adminMessage) toast(result.adminMessage);
    if (result && result.passwordChangeRecommended) window.setTimeout(function () { toast('建议尽快在“我的 / 安全设置”中修改初始密码。'); }, 900);
  }

  async function restore() {
    createAuthUI();
    state.token = read(TOKEN_KEY); state.refreshToken = read(REFRESH_KEY);
    try {
      var backend = await api.lfBackendStatus();
      if (backend && backend.appVersion) state.appVersion = backend.appVersion;
      state.developmentMode = !!(backend && backend.developmentMode);
      showDevelopmentCode();
    } catch (_) {}
    if (!state.token) state.token = 'main-process';
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (_) {}
    if (!navigator.onLine && cached && cached.user && Date.now() - Number(cached.cachedAt || 0) < 7 * 24 * 60 * 60 * 1000) {
      state.user = cached.user; state.session = cached.session || {}; state.backendOffline = true; unlock({ user: state.user, session: state.session }); return;
    }
    var result = await api.lfAuthStatus(state.token, { offline: !navigator.onLine });
    if (!result.ok && navigator.onLine) {
      result = await api.lfRefresh(state.refreshToken || 'main-process');
    }
    if (!result.ok && ['REMOTE_UNREACHABLE','REMOTE_TIMEOUT'].includes(result.error) && cached && cached.user && Date.now() - Number(cached.cachedAt || 0) < 7 * 24 * 60 * 60 * 1000) {
      state.user = cached.user; state.session = cached.session || {}; state.backendOffline = true; unlock({ user: state.user, session: state.session }); return;
    }
    if (!result.ok) { clearSession(); return showGate(result.message || '登录状态已过期，请重新登录。'); }
    state.backendOffline = false;
    unlock(result);
  }

  window.LFAuth = {
    getUser: function () { return state.user; },
    getToken: function () { return state.token; },
    openProfile: openProfile,
    logout: signOut,
    isOnline: function () { return !!(state.online && !state.backendOffline); },
  };
  window.LumiFieldProfileGradientMenu = {
    version:'1.0.0',
    collapse:function () { return setProfileMenuActive(''); },
    refresh:function () { if (!state.user) return false; renderProfile(); return true; },
    getDebug:function () {
      var root = $('lf-profile-info');
      var items = root ? Array.prototype.slice.call(root.querySelectorAll('[data-lf-profile-field]')) : [];
      return {
        initialized:!!root,
        itemCount:items.length,
        expandedCount:items.filter(function (item) { return item.classList.contains('is-expanded'); }).length,
        activeKey:profileMenuActiveKey,
        keys:items.map(function (item) { return item.dataset.lfProfileField; }),
        valueLengths:items.map(function (item) { return String(item.dataset.lfProfileValue || '').length; }),
        listenerCount:profileMenuListenersBound ? 2 : 0,
      };
    },
  };
  window.LFRequestDevAccess = async function (context) {
    var result = await api.lfRequestDeveloperAccess(state.token, { context: context || 'renderer-request' });
    if (!result.ok) window.alert((result.message || '') + '\n\n' + (result.contact || ''));
    else toast(result.message || '已拥有开发权限');
    return result;
  };

  window.addEventListener('online', function () { updateOfflineState(); if (state.token) api.lfAuthStatus(state.token, {}).then(function (r) { if (r.ok) { state.backendOffline = false; persistSession(r); updateOfflineState(); } else if (r.error === 'BLACKLISTED' || r.error === 'INVALID_SESSION') { clearSession(); showGate(r.message || '登录状态已失效，请重新登录。'); } }); });
  window.addEventListener('offline', updateOfflineState);
  document.addEventListener('visibilitychange', updateOfflineState);
  window.addEventListener('beforeunload', function () { if (state.token) api.lfSetOnline(state.token, false); });
  function blockOfflineSearch(event) {
    var target = event.target;
    if (event.type === 'click' && target && target.closest && target.closest('#lf-search-clear')) return;
    if (state.online && !state.backendOffline) return;
    var searchAction = event.type === 'submit' || (event.type === 'keydown' && event.key === 'Enter' && target && target.id === 'search-input') ||
      (event.type === 'click' && target && target.closest && target.closest('#search-box,.search-mode-tabs button,[data-history-query]'));
    if (!searchAction) return;
    event.preventDefault(); event.stopImmediatePropagation(); toast('离线模式下不能进行在线搜索。');
  }
  document.addEventListener('keydown', blockOfflineSearch, true);
  document.addEventListener('click', blockOfflineSearch, true);
  document.addEventListener('submit', blockOfflineSearch, true);
  if (typeof api.onLFIntegrityWarning === 'function') api.onLFIntegrityWarning(showIntegrityWarning);
  if (typeof api.onLFIntegrityLocked === 'function') api.onLFIntegrityLocked(handleIntegrityLocked);
  if (typeof api.onLFDeveloperShortcutBlocked === 'function') api.onLFDeveloperShortcutBlocked(function (result) {
    if (result && result.error === 'BLACKLISTED') {
      handleIntegrityLocked(result);
      return;
    }
    window.alert(INTEGRITY_WARNING_TEXT + '\n\n' + INTEGRITY_CONTACT_TEXT);
  });
  if (typeof api.onLFUpdateProgress === 'function') api.onLFUpdateProgress(function (progress) { setStatus('update', (progress.message || '更新处理中') + (progress.progress != null ? ' · ' + progress.progress + '%' : ''), progress.status !== 'error'); });
  if (typeof api.onLFFeedbackUploadProgress === 'function') api.onLFFeedbackUploadProgress(function (progress) {
    var entry = feedbackFiles.find(function (item) { return item.id === progress.clientId; });
    if (!entry) return;
    updateFeedbackUploadDetails(entry, progress);
    var uploadState = String(progress.status || '').toLowerCase();
    if (entry.cancelled && uploadState !== 'cancelled' && uploadState !== 'canceled') return;
    if (uploadState === 'failed') entry.status = 'failed';
    else if (uploadState === 'cancelled' || uploadState === 'canceled') entry.status = 'cancelled';
    else if (uploadState === 'verifying') entry.status = 'verifying';
    else if (uploadState === 'done' || uploadState === 'uploaded') entry.status = 'uploaded';
    else if (uploadState === 'queued' || uploadState === 'selected') entry.status = uploadState;
    else entry.status = 'uploading';
    entry.error = progress.error || '';
    renderFeedbackFiles();
  });
  setInterval(function () { if (state.token) api.lfAuthStatus(state.token, { offline: !navigator.onLine }).then(function (r) { if (r.ok) { state.user = r.user; state.session = r.session; renderProfile(); } else if (r.error === 'BLACKLISTED' || r.error === 'INVALID_SESSION') { clearSession(); showGate(r.message || '登录状态已失效，请重新登录。'); } }); }, 45000);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', restore, { once: true }); else restore();
})();
