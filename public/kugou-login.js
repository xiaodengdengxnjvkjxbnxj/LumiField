(() => {
  'use strict';
  const requestedProvider = new URLSearchParams(location.search).get('provider');
  const provider = requestedProvider === 'kugou_concept' ? 'kugou_concept' : 'kugou';
  const isConcept = provider === 'kugou_concept';
  const providerName = isConcept ? '酷狗概念版' : '酷狗音乐';
  const apiPrefix = isConcept ? '/api/kugou-concept' : '/api/kugou';
  const qrCard = document.querySelector('.qr-card');
  const qrImage = document.getElementById('qr-image');
  const statusNode = document.getElementById('login-status');
  const refreshButton = document.getElementById('refresh-qr');
  const syncResult = document.getElementById('sync-result');
  const syncProfile = document.getElementById('sync-profile');
  const syncMembership = document.getElementById('sync-membership');
  const syncPlaylists = document.getElementById('sync-playlists');
  let key = '';
  let timer = null;
  let stopped = false;

  function applyProviderCopy() {
    document.body.dataset.provider = provider;
    document.title = providerName + '登录 · LumiField';
    const edition = document.getElementById('login-edition');
    const title = document.getElementById('login-title');
    const intro = document.getElementById('login-intro');
    const notice = document.getElementById('login-notice');
    if (edition) edition.textContent = providerName;
    if (title) title.textContent = '使用酷狗音乐 App 扫码登录' + (isConcept ? '概念版' : '');
    if (intro) intro.textContent = '二维码由' + providerName + '登录服务实时生成。账号凭据仅保存在本机独立' + providerName + '会话中。';
    if (notice) notice.textContent = isConcept
      ? '请仅使用手机端酷狗音乐扫描；酷狗概念版与其他平台会话互不共享。'
      : '请仅使用手机端酷狗音乐扫描；不要向任何第三方发送 Cookie 或 Token。';
    if (qrImage) qrImage.alt = providerName + '登录二维码';
  }

  function setStatus(text, state) {
    statusNode.textContent = text;
    statusNode.className = 'status' + (state ? ' ' + state : '');
  }

  async function getJSON(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.error || 'KUGOU_LOGIN_REQUEST_FAILED');
      if (payload.provider && payload.provider !== provider) throw new Error('KUGOU_LOGIN_PROVIDER_MISMATCH');
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  function showFailure(error) {
    stopped = true;
    if (timer) clearTimeout(timer);
    setStatus(error && /QR_SESSION_EXPIRED/.test(error.message || '') ? '二维码已过期，请重新获取' : providerName + '登录服务暂时不可用：' + (error && error.message || '未知错误'), 'error');
    refreshButton.hidden = false;
  }

  function showSync(payload) {
    const profile = payload.profile || {};
    const sync = payload.sync || {};
    syncResult.hidden = false;
    syncProfile.textContent = sync.profileVerified
      ? ((profile.nickname || '已同步') + (profile.userId ? ' · ID ' + profile.userId : ''))
      : '资料未完整返回';
    syncMembership.textContent = sync.membershipVerified
      ? (profile.membershipLabel || (profile.isVip ? 'VIP' : '普通用户'))
      : '会员状态待酷狗返回（不影响歌单）';
    syncPlaylists.textContent = sync.playlistsVerified
      ? ('已同步 ' + Number(sync.playlistCount || 0) + ' 个歌单')
      : ('歌单同步失败' + (sync.playlistError ? ' · ' + sync.playlistError : ''));
  }

  async function poll() {
    if (stopped || !key) return;
    try {
      const payload = await getJSON(apiPrefix + '/login/qr/check?key=' + encodeURIComponent(key));
      const state = Number(payload.status || 0);
      if (state === 4 && payload.loggedIn) {
        stopped = true;
        showSync(payload);
        setStatus(isConcept
          ? '扫码确认成功，正在写入 LumiField 独立酷狗概念版会话…'
          : '扫码确认成功，正在写入 LumiField 独立酷狗会话…', 'success');
        document.title = providerName + '登录成功 · LumiField';
        return;
      }
      if (state === 2 || state === 3) setStatus('已扫码，请在手机端酷狗音乐确认登录', 'scanned');
      else if (state === 5) throw new Error('KUGOU_QR_SESSION_EXPIRED');
      else setStatus(isConcept ? '请使用手机端酷狗音乐扫描概念版二维码' : '请使用手机端酷狗音乐扫描二维码');
      timer = setTimeout(poll, 1400);
    } catch (error) {
      showFailure(error);
    }
  }

  async function start() {
    stopped = false;
    key = '';
    if (timer) clearTimeout(timer);
    qrCard.classList.remove('ready');
    qrImage.removeAttribute('src');
    refreshButton.hidden = true;
    syncResult.hidden = true;
    setStatus(isConcept ? '正在连接酷狗概念版登录服务…' : '正在连接酷狗登录服务…');
    try {
      const payload = await getJSON(apiPrefix + '/login/qr/key');
      const data = payload.data || {};
      if (!data.key || !/^data:image\/png;base64,/.test(String(data.qrcode_img || ''))) throw new Error('KUGOU_QR_IMAGE_INVALID');
      key = String(data.key);
      qrImage.src = data.qrcode_img;
      qrCard.classList.add('ready');
      setStatus(isConcept ? '请使用手机端酷狗音乐扫描概念版二维码' : '请使用手机端酷狗音乐扫描二维码');
      timer = setTimeout(poll, 500);
    } catch (error) {
      showFailure(error);
    }
  }

  refreshButton.addEventListener('click', start);
  window.addEventListener('beforeunload', () => { stopped = true; if (timer) clearTimeout(timer); });
  applyProviderCopy();
  start();
})();
