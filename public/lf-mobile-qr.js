(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  if (location.search) history.replaceState({}, '', location.pathname);
  ['lf-mobile-login','lf-mobile-confirm','lf-mobile-done','lf-mobile-rejected'].forEach(function (id) { if ($(id)) $(id).hidden = true; });
  var paused = $('lf-mobile-invalid');
  if (paused) {
    paused.hidden = false;
    paused.classList.remove('error');
    var title = paused.querySelector('h2');
    var message = paused.querySelector('p');
    if (title) title.textContent = '开发中';
    if (message) message.textContent = '当前缺少真实手机端与公网服务，LF 手机扫码登录已暂停开发。';
  }
  document.querySelectorAll('button,input').forEach(function (control) { control.disabled = true; });
  if ($('lf-mobile-status')) {
    $('lf-mobile-status').textContent = 'PAUSED_DEVELOPMENT · 不会创建、确认或拒绝任何登录事务。';
    $('lf-mobile-status').classList.remove('error');
  }
  var footer = document.querySelector('footer');
  if (footer) footer.textContent = '手机端 LF 扫码登录 · 开发中';
})();
