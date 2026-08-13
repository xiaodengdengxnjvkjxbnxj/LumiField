(() => {
  'use strict';
  const api = window.LumiFieldQishuiLogin;
  const statusNode = document.getElementById('login-status');
  const clientStatus = document.getElementById('client-status');
  const accountStatus = document.getElementById('account-status');
  const syncPlaylists = document.getElementById('sync-playlists');
  const openButton = document.getElementById('open-client');
  const importButton = document.getElementById('import-session');
  const refreshButton = document.getElementById('refresh-status');
  let lastClientState = null;
  let busy = false;

  function setStatus(text, state) {
    statusNode.textContent = text;
    statusNode.className = 'status' + (state ? ' ' + state : '');
  }

  function setBusy(value) {
    busy = !!value;
    openButton.disabled = busy;
    refreshButton.disabled = busy;
    importButton.disabled = busy || !(lastClientState && lastClientState.canImport);
  }

  function importErrorText(code) {
    return ({
      QISHUI_OFFICIAL_PROFILE_NOT_FOUND: '未检测到汽水音乐官方客户端，请先下载安装并登录',
      QISHUI_OFFICIAL_COOKIE_STORE_NOT_FOUND: '尚未生成官方登录数据，请先在汽水音乐客户端完成登录',
      QISHUI_OFFICIAL_SESSION_COOKIE_MISSING: '未检测到有效账号会话，请在官方客户端重新登录',
      QISHUI_OFFICIAL_DEVICE_MISSING: '官方客户端设备信息不完整，请打开客户端完成初始化',
      QISHUI_OFFICIAL_SESSION_INVALID: '官方登录会话已失效，请重新登录后再导入',
      QISHUI_OFFICIAL_CLIENT_RUNNING: '请完全退出汽水音乐官方客户端后再导入',
      QISHUI_OFFICIAL_COOKIE_DECRYPT_FAILED: '无法读取官方登录会话，请完全退出客户端后重试',
    })[String(code || '')] || '导入失败，请完全退出汽水音乐客户端后重试';
  }

  function showImported(payload) {
    const profile = payload.profile || {};
    accountStatus.textContent = (profile.nickname || '已登录') + (profile.userId ? ' · ID ' + profile.userId : '');
    syncPlaylists.textContent = profile.playlistsVerified
      ? ('已同步 ' + Number(profile.playlistCount || 0) + ' 个歌单')
      : '账号已同步，歌单状态待刷新';
    setStatus('汽水音乐账号已成功接入 LumiField', 'success');
    document.title = '汽水音乐登录成功 · LumiField';
  }

  async function refreshStatus(silent) {
    if (!api || busy) return;
    if (!silent) setStatus('正在检测汽水音乐官方客户端…');
    setBusy(true);
    try {
      const state = await api.getOfficialClientStatus();
      if (!state || state.ok === false) throw new Error('STATUS_FAILED');
      lastClientState = state;
      clientStatus.textContent = state.installed ? '已安装' : '未安装';
      accountStatus.textContent = state.profileAvailable ? '检测到本机登录数据' : '等待官方客户端登录';
      openButton.textContent = state.installed ? '打开汽水音乐' : '下载汽水音乐';
      if (!silent) setStatus(state.profileAvailable
        ? '请完全退出官方客户端，然后导入账号'
        : '请在官方客户端完成扫码登录');
    } catch (_) {
      lastClientState = null;
      clientStatus.textContent = '检测失败';
      setStatus('无法检测汽水音乐官方客户端，请重试', 'error');
    } finally {
      setBusy(false);
    }
  }

  openButton.addEventListener('click', async () => {
    if (!api || busy) return;
    setBusy(true);
    try {
      const result = await api.openOfficialClient();
      if (!result || result.ok === false) throw new Error(result && result.error || 'OPEN_FAILED');
      setStatus(result.action === 'download-client'
        ? '已打开官方下载页；安装后请在客户端完成扫码登录'
        : '已打开汽水音乐；完成扫码后请完全退出客户端');
    } catch (_) {
      setStatus('无法打开汽水音乐，请点击重新检测后重试', 'error');
    } finally {
      setBusy(false);
    }
  });

  importButton.addEventListener('click', async () => {
    if (!api || busy) return;
    setBusy(true);
    setStatus('正在验证账号并同步个人资料与歌单…');
    syncPlaylists.textContent = '正在同步…';
    try {
      const result = await api.importOfficialSession();
      if (!result || result.ok === false || !result.loggedIn) throw new Error(result && result.error || 'QISHUI_OFFICIAL_SESSION_INVALID');
      showImported(result);
    } catch (error) {
      syncPlaylists.textContent = '导入失败';
      setStatus(importErrorText(error && error.message), 'error');
    } finally {
      setBusy(false);
    }
  });

  refreshButton.addEventListener('click', () => refreshStatus(false));
  if (!api) {
    setStatus('当前窗口缺少安全导入组件，请重启 LumiField', 'error');
    setBusy(true);
  } else {
    refreshStatus(false);
  }
})();
