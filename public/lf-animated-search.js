(function(global){
  'use strict';

  var box = document.getElementById('search-box');
  var input = document.getElementById('search-input');
  var glow = box && box.querySelector('.lf-animated-search-glow');
  var clear = document.getElementById('lf-search-clear');
  if (!box || !input || !glow || !clear || box.dataset.lfAnimatedSearchReady === 'true') return;

  var disposed = false;
  var listeners = [];

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    listeners.push(function(){ target.removeEventListener(type, handler, options); });
  }

  function sync() {
    if (disposed) return;
    var hasValue = !!String(input.value || '');
    box.dataset.hasValue = hasValue ? 'true' : 'false';
    clear.setAttribute('aria-hidden', hasValue ? 'false' : 'true');
    clear.tabIndex = hasValue ? 0 : -1;
  }

  function onClear(event) {
    event.preventDefault();
    event.stopPropagation();
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles:true }));
    input.focus({ preventScroll:true });
    sync();
  }

  function onCompositionStart() {
    box.dataset.composing = 'true';
  }

  function onCompositionEnd() {
    box.dataset.composing = 'false';
    sync();
  }

  box.dataset.lfAnimatedSearch = 'true';
  box.dataset.lfAnimatedSearchReady = 'true';
  box.dataset.composing = 'false';
  listen(input, 'input', sync);
  listen(input, 'focus', sync);
  listen(input, 'blur', sync);
  listen(input, 'compositionstart', onCompositionStart);
  listen(input, 'compositionend', onCompositionEnd);
  listen(clear, 'click', onClear);
  sync();

  function getDebug() {
    var area = document.getElementById('search-area');
    return {
      initialized: !disposed,
      composing: box.dataset.composing === 'true',
      hasValue: !!String(input.value || ''),
      focused: document.activeElement === input,
      mode: area && area.classList.contains('stage-mode') ? 'secondary' : 'main',
      searchBoxCount: document.querySelectorAll('#search-box').length,
      inputCount: document.querySelectorAll('#search-input').length,
      glowCount: document.querySelectorAll('.lf-animated-search-glow').length,
      clearCount: document.querySelectorAll('#lf-search-clear').length,
      ownRafCount: 0,
      ownIntervalCount: 0,
      listenerCount: listeners.length,
      sourceMode: 'LF_INDEPENDENT_IMPLEMENTATION'
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    while (listeners.length) {
      try { listeners.pop()(); } catch (e) {}
    }
    delete box.dataset.lfAnimatedSearchReady;
    box.dataset.composing = 'false';
  }

  global.LumiFieldAnimatedSearch = Object.freeze({
    refresh: sync,
    getDebug: getDebug,
    dispose: dispose
  });
  global.__lumifieldAnimatedSearchDebug = getDebug;
})(window);
