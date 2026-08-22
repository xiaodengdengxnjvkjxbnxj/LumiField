(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const siteDebug = window.__lfSiteDebug ||= {};
  Object.assign(siteDebug, {
    bootStartedAt: performance.now(),
    interactiveAt: null,
    visualLabRequested: false,
    effectModuleLoaded: false,
    pageErrors: []
  });
  addEventListener("error", (event) => siteDebug.pageErrors.push({ type: "error", message: event.message, source: event.filename, line: event.lineno }));
  addEventListener("unhandledrejection", (event) => siteDebug.pageErrors.push({ type: "unhandledrejection", message: String(event.reason?.message || event.reason) }));
  document.documentElement.classList.add("motion-ready");

  const header = $("[data-header]");
  const syncHeader = () => header?.classList.toggle("is-scrolled", scrollY > 20);
  syncHeader();
  addEventListener("scroll", syncHeader, { passive: true });

  const navToggle = $("[data-nav-toggle]");
  const nav = $("[data-nav]");
  const setNav = (open) => {
    navToggle?.setAttribute("aria-expanded", String(open));
    navToggle?.setAttribute("aria-label", open ? "关闭导航" : "打开导航");
    nav?.classList.toggle("is-open", open);
  };
  navToggle?.addEventListener("click", () => setNav(navToggle.getAttribute("aria-expanded") !== "true"));
  $$("a", nav).forEach((link) => link.addEventListener("click", () => setNav(false)));
  addEventListener("keydown", (event) => { if (event.key === "Escape") setNav(false); });

  const revealItems = $$(".reveal");
  if ("IntersectionObserver" in window && !reducedMotion.matches) {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -35px" });
    revealItems.forEach((item) => {
      if (item.getBoundingClientRect().top < innerHeight * 0.94) item.classList.add("is-visible");
      else revealObserver.observe(item);
    });
  } else {
    revealItems.forEach((item) => item.classList.add("is-visible"));
  }

  const tabs = $$("[data-tab]");
  const panels = $$("[data-panel]");
  const activateTab = (tab, focus = false) => {
    const key = tab.dataset.tab;
    tabs.forEach((item) => {
      const active = item === tab;
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
    });
    panels.forEach((panel) => { panel.hidden = panel.dataset.panel !== key; });
    if (focus) tab.focus();
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activateTab(tab));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      let next = index;
      if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      activateTab(tabs[next], true);
    });
  });

  $$('[data-media] img').forEach((image) => {
    const target = image.closest(".media-frame") || image.parentElement;
    const markMissing = () => target?.classList.add("is-missing");
    if (image.complete && image.naturalWidth === 0) markMissing();
    image.addEventListener("error", markMissing, { once: true });
    image.addEventListener("load", () => target?.classList.remove("is-missing"), { once: true });
  });

  const carousel = $("[data-carousel]");
  const slides = $$("[data-slide]");
  const dots = $$("[data-slide-dot]");
  const currentLabel = $("[data-slide-current]");
  const totalLabel = $("[data-slide-total]");
  let activeSlide = 0;
  if (totalLabel) totalLabel.textContent = String(slides.length).padStart(2, "0");

  const updateSlideState = (index, shouldScroll = true) => {
    activeSlide = (index + slides.length) % slides.length;
    slides.forEach((slide, itemIndex) => slide.classList.toggle("is-current", itemIndex === activeSlide));
    dots.forEach((dot, itemIndex) => {
      const active = itemIndex === activeSlide;
      dot.classList.toggle("is-current", active);
      dot.setAttribute("aria-selected", String(active));
    });
    if (currentLabel) currentLabel.textContent = String(activeSlide + 1).padStart(2, "0");
    if (shouldScroll) slides[activeSlide]?.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "nearest", inline: "start" });
  };
  $("[data-carousel-prev]")?.addEventListener("click", () => updateSlideState(activeSlide - 1));
  $("[data-carousel-next]")?.addEventListener("click", () => updateSlideState(activeSlide + 1));
  dots.forEach((dot) => dot.addEventListener("click", () => updateSlideState(Number(dot.dataset.slideDot))));
  carousel?.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); updateSlideState(activeSlide - 1); }
    if (event.key === "ArrowRight") { event.preventDefault(); updateSlideState(activeSlide + 1); }
  });
  if (carousel && "IntersectionObserver" in window) {
    const slideObserver = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible?.intersectionRatio > 0.55) updateSlideState(slides.indexOf(visible.target), false);
    }, { root: carousel, threshold: [0.55, 0.75] });
    slides.forEach((slide) => slideObserver.observe(slide));
  }

  const tilt = $("[data-tilt]");
  if (tilt && !reducedMotion.matches && matchMedia("(pointer: fine)").matches) {
    tilt.addEventListener("pointermove", (event) => {
      const rect = tilt.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      tilt.style.setProperty("--tilt-x", `${x * 7 - 4}deg`);
      tilt.style.setProperty("--tilt-y", `${y * -6 + 2}deg`);
    });
    tilt.addEventListener("pointerleave", () => {
      tilt.style.setProperty("--tilt-x", "-4deg");
      tilt.style.setProperty("--tilt-y", "2deg");
    });
  }

  const visualLab = $("[data-visual-lab]");
  let visualController = null;
  let visualModulePromise = null;
  const loadVisualLab = () => {
    if (!visualLab) return Promise.resolve(null);
    if (visualModulePromise) return visualModulePromise;
    siteDebug.visualLabRequested = true;
    visualModulePromise = import("./visual-effects.js?v=1144-visual-lab")
      .then(({ mountVisualLab }) => {
        visualController = mountVisualLab(visualLab);
        return visualController;
      })
      .catch((error) => {
        siteDebug.pageErrors.push({ type: "visual-lab", message: String(error?.message || error) });
        const status = $("[data-effect-status]", visualLab);
        const host = $("[data-effect-host]", visualLab);
        if (status) status.textContent = `视觉实验加载失败：${error?.message || error}`;
        if (host) host.innerHTML = '<p class="effect-fallback">视觉模块未能加载。请刷新页面，或确认浏览器允许 JavaScript 模块。</p>';
        return null;
      });
    return visualModulePromise;
  };
  if (visualLab) {
    if ("IntersectionObserver" in window) {
      const loaderObserver = new IntersectionObserver((entries, observer) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        loadVisualLab();
      }, { rootMargin: "360px 0px", threshold: 0.01 });
      loaderObserver.observe(visualLab);
    } else {
      loadVisualLab();
    }
    visualLab.addEventListener("pointerenter", loadVisualLab, { once: true, passive: true });
    visualLab.addEventListener("focusin", loadVisualLab, { once: true });
    visualLab.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-effect]");
      if (!button || visualController) return;
      const controller = await loadVisualLab();
      controller?.activate(button.dataset.effect);
    });
  }

  const toast = $("[data-toast]");
  let toastTimer;
  const showToast = (message) => {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2200);
  };
  $("[data-copy-checksum]")?.addEventListener("click", async () => {
    const checksum = $("[data-checksum]")?.textContent.trim() || "";
    try {
      await navigator.clipboard.writeText(checksum);
      const label = $("[data-copy-label]");
      if (label) label.textContent = "已复制";
      showToast("SHA-256 已复制");
      setTimeout(() => { if (label) label.textContent = "复制 SHA-256"; }, 1800);
    } catch {
      const selection = getSelection();
      const range = document.createRange();
      const code = $("[data-checksum]");
      if (code) { range.selectNodeContents(code); selection?.removeAllRanges(); selection?.addRange(range); }
      showToast("已选中 SHA-256，请按 Ctrl+C 复制");
    }
  });

  const sponsorDialog = $("[data-sponsor-dialog]");
  $$("[data-open-sponsor]").forEach((button) => button.addEventListener("click", () => {
    if (typeof sponsorDialog?.showModal === "function") sponsorDialog.showModal();
  }));
  sponsorDialog?.addEventListener("click", (event) => {
    const rect = sponsorDialog.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    if (outside) sponsorDialog.close();
  });

  const canvas = $("#signal-field");
  const context = canvas?.getContext("2d", { alpha: true });
  let width = 0;
  let height = 0;
  let ratio = 1;
  let animationFrame = 0;
  let lastFieldFrame = 0;
  const fieldFrameInterval = 1000 / 30;
  const pointer = { x: -1000, y: -1000 };
  const points = [];
  const resizeCanvas = () => {
    if (!canvas || !context) return;
    ratio = Math.min(devicePixelRatio || 1, 1.5);
    width = innerWidth;
    height = innerHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    points.length = 0;
    const gap = width < 700 ? 72 : 86;
    for (let y = gap / 2; y < height; y += gap) {
      for (let x = gap / 2; x < width; x += gap) points.push({ x, y, phase: Math.random() * Math.PI * 2 });
    }
  };
  const renderField = (time) => {
    if (!context || reducedMotion.matches || document.hidden) { animationFrame = 0; return; }
    if (time - lastFieldFrame < fieldFrameInterval) {
      animationFrame = requestAnimationFrame(renderField);
      return;
    }
    lastFieldFrame = time;
    context.clearRect(0, 0, width, height);
    for (const point of points) {
      const distance = Math.hypot(pointer.x - point.x, pointer.y - point.y);
      const pointerLight = Math.max(0, 1 - distance / 230);
      const pulse = (Math.sin(time * 0.0007 + point.phase) + 1) * 0.5;
      const alpha = 0.025 + pointerLight * 0.25 + pulse * 0.012;
      const radius = 0.7 + pointerLight * 1.8;
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fillStyle = `rgba(91, 220, 224, ${alpha})`;
      context.fill();
      if (pointerLight > 0.35) {
        context.beginPath();
        context.moveTo(point.x, point.y);
        context.lineTo(pointer.x, pointer.y);
        context.strokeStyle = `rgba(0, 245, 212, ${pointerLight * 0.025})`;
        context.stroke();
      }
    }
    animationFrame = requestAnimationFrame(renderField);
  };
  const startField = () => { if (!animationFrame && !reducedMotion.matches) animationFrame = requestAnimationFrame(renderField); };
  if (canvas && context) {
    resizeCanvas();
    startField();
    addEventListener("resize", resizeCanvas, { passive: true });
    addEventListener("pointermove", (event) => { pointer.x = event.clientX; pointer.y = event.clientY; }, { passive: true });
    addEventListener("pointerleave", () => { pointer.x = -1000; pointer.y = -1000; }, { passive: true });
    document.addEventListener("visibilitychange", startField);
    reducedMotion.addEventListener?.("change", () => { if (reducedMotion.matches && animationFrame) cancelAnimationFrame(animationFrame); animationFrame = 0; startField(); });
  }

  requestAnimationFrame(() => {
    siteDebug.interactiveAt = performance.now();
    document.documentElement.dataset.siteReady = "true";
  });
})();
