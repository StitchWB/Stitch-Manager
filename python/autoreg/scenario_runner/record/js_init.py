"""Injected recorder script (CloakBrowser injected-capture path)."""

RECORDER_INIT_SCRIPT = r"""
(() => {
  // Record events in top-level document and same-origin iframes.
  // Cross-origin iframes are blocked by browser security.
  let _isTopFrame = true;
  let _frameSrc = null;
  try {
    if (window.top !== window.self) {
      try {
        void window.top.document;
        _isTopFrame = false;
        _frameSrc = location.href;
      } catch {
        return;
      }
    }
  } catch {
    return;
  }

  if (window.__stitchRecorderInstalled) return;
  window.__stitchRecorderInstalled = true;
  if (typeof window.__stitchRecorderStepCount !== 'number') {
    window.__stitchRecorderStepCount = 0;
  }
  if (typeof window.__stitchRecorderPaused !== 'boolean') {
    window.__stitchRecorderPaused = false;
  }

  const safe = (fn) => {
    try { return fn(); } catch { return null; }
  };

  const cssEscape = (value) => {
    const s = (value ?? '').toString();
    try {
      if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
    } catch {}
    // minimal fallback
    return s.replace(/[^a-zA-Z0-9_\-]/g, (c) => `\\${c}`);
  };

  const cssPath = (el) => {
    if (!el || !el.tagName) return null;
    // Prefer stable attributes
    const testid = el.getAttribute && (el.getAttribute('data-testid') || el.getAttribute('data-test-id'));
    if (testid) return `[data-testid="${cssEscape(testid)}"]`;
    const name = el.getAttribute && el.getAttribute('name');
    if (name) return `${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
    const id = el.getAttribute && el.getAttribute('id');
    if (id) return `#${cssEscape(id)}`;
    // Fallback: tag + classes (may be unstable)
    const cls = (el.className && typeof el.className === 'string') ? el.className.trim().split(/\s+/).slice(0,3) : [];
    if (cls && cls.length) return `${el.tagName.toLowerCase()}.${cls.map(c => cssEscape(c)).join('.')}`;
    return el.tagName.toLowerCase();
  };

  const send = (payload) => {
    if (window.__stitchRecorderPaused) return;
    try {
      if (!_isTopFrame && _frameSrc) {
        payload.frameSrc = _frameSrc;
      }
      // Prefer the context-level binding (works on CloakBrowser, which
      // suppresses console CDP notifications); console protocol is the
      // fallback channel. Mirrors sendControl/emitProxySwitch below.
      let delivered = false;
      try {
        if (typeof window.__stitchRecordEvent === 'function') {
          window.__stitchRecordEvent(payload);
          delivered = true;
        }
      } catch {}
      if (!delivered) {
        console.info('__STITCH_REC_STEP__' + JSON.stringify(payload));
      }
      window.__stitchRecorderStepCount = (window.__stitchRecorderStepCount || 0) + 1;
      if (typeof window.__stitchRecorderOverlaySetCount === 'function') {
        window.__stitchRecorderOverlaySetCount(window.__stitchRecorderStepCount);
      }
    } catch (e) {
      // ignore
    }
  };

  const isOverlayEvent = (event, el) => {
    try {
      if (el && el.closest && el.closest('[data-stitch-recorder="1"]')) return true;
    } catch {}
    try {
      if (event && typeof event.composedPath === 'function') {
        const path = event.composedPath();
        if (Array.isArray(path)) {
          for (const node of path) {
            if (node && node.nodeType === 1 && node.getAttribute) {
              if (node.getAttribute('data-stitch-recorder') === '1') return true;
            }
          }
        }
      }
    } catch {}
    return false;
  };

  const describeEl = (el) => {
    if (!el) return {};
    const tag = safe(() => el.tagName?.toLowerCase()) || null;
    const type = safe(() => el.getAttribute?.('type')) || null;
    const aria = safe(() => el.getAttribute?.('aria-label')) || null;
    const placeholder = safe(() => el.getAttribute?.('placeholder')) || null;
    const role = safe(() => el.getAttribute?.('role')) || null;
    const text = safe(() => (el.innerText || '').trim().slice(0, 80)) || null;
    return { tag, type, role, ariaLabel: aria, placeholder, text };
  };

  const looksSensitive = (s) => {
    const value = (s ?? '').toString().trim().toLowerCase();
    if (!value) return false;
    return [
      'password',
      'passcode',
      'otp',
      'one-time',
      'token',
      'secret',
      'cvv',
      'cvc',
      'security code',
      'card',
      'pan',
      'expiry',
      'exp',
      'iban',
      'ssn',
    ].some((part) => value.includes(part));
  };

  const shouldRedact = (el) => {
    const type = (safe(() => el?.getAttribute?.('type')) || '').toString().toLowerCase();
    if (type === 'password') return true;
    const attrs = [
      safe(() => el?.getAttribute?.('name')),
      safe(() => el?.getAttribute?.('id')),
      safe(() => el?.getAttribute?.('autocomplete')),
      safe(() => el?.getAttribute?.('aria-label')),
      safe(() => el?.getAttribute?.('placeholder')),
    ];
    return attrs.some((v) => looksSensitive(v));
  };

  const redactValue = (el, value) => {
    if (shouldRedact(el)) return '***';
    return value;
  };

  const inputTimers = new WeakMap();

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (isOverlayEvent(e, el)) return;

    try {
      const prev = inputTimers.get(el);
      if (prev) clearTimeout(prev);
    } catch {}

    const timer = setTimeout(() => {
      const value = safe(() => el && 'value' in el ? el.value : null);
      send({
        kind: 'input',
        ts: new Date().toISOString(),
        url: location.href,
        selector: cssPath(el),
        value: redactValue(el, value),
        meta: describeEl(el)
      });
      try { inputTimers.delete(el); } catch {}
    }, 220);

    try { inputTimers.set(el, timer); } catch {}
  }, true);

  document.addEventListener('click', (e) => {
    const el = e.target;
    if (isOverlayEvent(e, el)) return;
    send({
      kind: 'click',
      ts: new Date().toISOString(),
      url: location.href,
      selector: cssPath(el),
      value: null,
      meta: { ...describeEl(el), button: e.button }
    });
  }, true);

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (isOverlayEvent(e, el)) return;
    const value = safe(() => el && 'value' in el ? el.value : null);
    send({
      kind: 'change',
      ts: new Date().toISOString(),
      url: location.href,
      selector: cssPath(el),
      value: redactValue(el, value),
      meta: describeEl(el)
    });
  }, true);

  document.addEventListener('submit', (e) => {
    const el = e.target;
    if (isOverlayEvent(e, el)) return;
    send({
      kind: 'submit',
      ts: new Date().toISOString(),
      url: location.href,
      selector: cssPath(el),
      value: null,
      meta: describeEl(el)
    });
  }, true);

  const origPush = history.pushState;
  history.pushState = function(...args) {
    const res = origPush.apply(this, args);
    send({ kind: 'nav', ts: new Date().toISOString(), url: location.href, selector: null, value: null, meta: { type: 'pushState' } });
    return res;
  };
  const origReplace = history.replaceState;
  history.replaceState = function(...args) {
    const res = origReplace.apply(this, args);
    send({ kind: 'nav', ts: new Date().toISOString(), url: location.href, selector: null, value: null, meta: { type: 'replaceState' } });
    return res;
  };
  window.addEventListener('popstate', () => {
    send({ kind: 'nav', ts: new Date().toISOString(), url: location.href, selector: null, value: null, meta: { type: 'popstate' } });
  });

  // Record initial page load URL. Helps when operator navigates via address bar.
  send({ kind: 'nav', ts: new Date().toISOString(), url: location.href, selector: null, value: null, meta: { type: 'load' } });
})();
"""
