// Performance: Cache for selector generation (issue #42)
const selectorCache = new Map();

// Performance: Pending overlay render (batched via requestAnimationFrame)
let pendingOverlayRender = false;

// Performance: Debounce helper
function debounce(fn, ms) {
  let timer = null;
  return function(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

// Performance: Throttle helper
function throttle(fn, ms) {
  let lastTime = 0;
  let timer = null;
  return function(...args) {
    const now = Date.now();
    const remaining = ms - (now - lastTime);
    if (remaining <= 0) {
      lastTime = now;
      fn.apply(this, args);
    } else {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        lastTime = Date.now();
        fn.apply(this, args);
      }, remaining);
    }
  };
}

// Performance: Cached selector generation
function getCachedSelector(el) {
  if (!el) return null;
  if (selectorCache.has(el)) return selectorCache.get(el);
  const selector = selectorForElement(el);
  selectorCache.set(el, selector);
  return selector;
}

// Clear selector cache when DOM changes significantly
function clearSelectorCache() {
  selectorCache.clear();
}

// Performance: Batched renderOverlay using requestAnimationFrame
function scheduleOverlayRender() {
  if (pendingOverlayRender) return;
  pendingOverlayRender = true;
  requestAnimationFrame(() => {
    renderOverlay();
    pendingOverlayRender = false;
  });
}

function sendRecordEvent(kind, extra = {}) {
  if (!isRecording() || state.paused) return;

  const payload = {
    kind,
    ts: nowIso(),
    url: location.href,
    ...extra,
  };

  if (!_frameContext.isTop) {
    payload.frameSrc = _frameContext.frameSrc || location.href;
  }

  // Store step locally for overlay rendering
  state.overlaySteps = state.overlaySteps || [];
  state.overlaySteps.push({ kind, selector: payload.selector || null });
  // Keep only last 50 steps for overlay performance
  if (state.overlaySteps.length > 50) {
    state.overlaySteps = state.overlaySteps.slice(-50);
  }

  // Performance: Batch overlay renders (issue #38)
  scheduleOverlayRender();

  chrome.runtime.sendMessage({
    type: 'stitch:record-event',
    payload,
  });
}

function setupEventListeners() {
  addListener(
    document,
    'click',
    (e) => {
      if (!isRecording() || state.paused) return;
      if (isOverlayEvent(e)) return;
      const el = e.target;
      sendRecordEvent('click', {
        selector: getCachedSelector(el),
        value: null,
        meta: describeEl(el),
      });
    },
    true
  );

  // Performance: Debounced input handler (issue #39 - 300ms debounce)
  const debouncedInputHandler = debounce((el) => {
    if (!isRecording() || state.paused) return;
    const value = el && Object.prototype.hasOwnProperty.call(el, 'value') ? redactValue(el, el.value) : null;
    sendRecordEvent('input', {
      selector: getCachedSelector(el),
      value,
      meta: describeEl(el),
    });
  }, 300);

  addListener(
    document,
    'input',
    (e) => {
      if (!isRecording() || state.paused) return;
      if (isOverlayEvent(e)) return;
      const el = e.target;
      debouncedInputHandler(el);
    },
    true
  );

  addListener(
    document,
    'change',
    (e) => {
      if (!isRecording() || state.paused) return;
      if (isOverlayEvent(e)) return;
      const el = e.target;
      const value =
        el && Object.prototype.hasOwnProperty.call(el, 'value') ? redactValue(el, el.value) : null;
      sendRecordEvent('change', {
        selector: getCachedSelector(el),
        value,
        meta: describeEl(el),
      });
    },
    true
  );

  addListener(
    document,
    'submit',
    (e) => {
      if (!isRecording() || state.paused) return;
      if (isOverlayEvent(e)) return;
      const el = e.target;
      sendRecordEvent('submit', {
        selector: getCachedSelector(el),
        value: null,
        meta: describeEl(el),
      });
    },
    true
  );

  // Record keydown events for navigation keys (Enter, Tab, Escape)
  addListener(
    document,
    'keydown',
    (e) => {
      if (!isRecording() || state.paused) return;
      if (isOverlayEvent(e)) return;
      const key = String(e.key || '');
      // Only record navigation/action keys — skip printable characters (those come via 'input')
      const navigationKeys = ['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'];
      if (!navigationKeys.includes(key)) return;
      const el = e.target;
      sendRecordEvent('keydown', {
        selector: getCachedSelector(el),
        value: key,
        meta: { ...describeEl(el), key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey },
      });
    },
    true
  );

  // Performance: Throttled scroll events (issue #40 - 100ms throttle)
  const throttledScrollHandler = throttle((el) => {
    if (!isRecording() || state.paused) return;
    const scrollTop = el === document.documentElement ? (document.scrollingElement?.scrollTop || 0) : (el?.scrollTop || 0);
    const scrollLeft = el === document.documentElement ? (document.scrollingElement?.scrollLeft || 0) : (el?.scrollLeft || 0);
    sendRecordEvent('scroll', {
      selector: el === document.documentElement ? null : getCachedSelector(el),
      value: null,
      meta: { scrollTop: Math.round(scrollTop), scrollLeft: Math.round(scrollLeft) },
    });
  }, 100);
  cleanupController.scrollHandler = throttledScrollHandler;

  cleanupController.scrollTarget = null;
  addListener(
    document,
    'scroll',
    (e) => {
      if (!isRecording() || state.paused) return;
      const target = e.target === document ? document.documentElement : e.target;
      cleanupController.scrollTarget = target;
      throttledScrollHandler(target);
    },
    true
  );

  addListener(window, 'hashchange', () => handleUrlChange('hashchange'));
  addListener(window, 'popstate', () => handleUrlChange('popstate'));
  addListener(window, 'pageshow', () => handleUrlChange('pageshow'));
  addListener(document, 'visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      handleUrlChange('visibility');
    }
  });
}

function startUrlObserver() {
  if (cleanupController.urlObserver) return;
  let lastUrl = location.href;
  cleanupController.urlObserver = new MutationObserver(() => {
    if (!isRecording() || state.paused) return;
    const current = location.href;
    if (current === lastUrl) return;
    lastUrl = current;
    handleUrlChange('mutation');
  });
  cleanupController.urlObserver.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', () => handleUrlChange('popstate'));
}

function handleUrlChange(reason) {
  if (!isRecording() || state.paused) return;
  const current = location.href;
  if (current === state.lastUrl) return;
  state.lastUrl = current;
  sendRecordEvent('nav', {
    selector: null,
    value: null,
    meta: { reason: reason || 'url.change' },
  });
}
