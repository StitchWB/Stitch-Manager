// Stitch Toolkit — Content Script (classic, no ES modules)
// Contains: panel UI + tool registry + stripe filler + recorder — all in one file.
// Compatible with older Chromium builds that do not support type="module" in content_scripts.

(function () {
  'use strict';

  console.log('[Stitch Toolkit] Content script IIFE entered');

  // ── Prevent double-injection ─────────────────────────────────────────────
  if (window.__stitchToolkitInjected) {
    console.log('[Stitch Toolkit] Already injected, skipping');
    return;
  }
  window.__stitchToolkitInjected = true;
  console.log('[Stitch Toolkit] Flag set, proceeding');

  const PANEL_ID = 'stitch-toolkit-panel';

  // ── Storage helpers (state inside content script scope) ──────────────────
  const _STORAGE_KEYS = {
    collapsed: 'toolkit:collapsed',
    activeTool: 'toolkit:activeTool',
  };

  function _saveState(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }
  function _loadState(key, defaultValue) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return defaultValue;
      return JSON.parse(raw);
    } catch { return defaultValue; }
  }

  // ── Tool: Stripe Filler ────────────────────────────────────────────────
  const StripeFillerTool = {
    id: 'stripe-filler',
    name: 'Stripe Filler',
    icon: '\uD83D\uDCB3',

    mount(container) {
      container.innerHTML = `
        <div class="tk-section-title">Stripe Card Filler</div>
        <div class="tk-hint">Card: number|MM|YYYY|CVC</div>
        <input id="tk-stripe-input" class="tk-input" type="text"
          placeholder="5154620021123771|01|2030|635"
          autocomplete="off" spellcheck="false" />
        <div class="tk-row" style="align-items:center;margin-top:4px;">
          <input id="tk-stripe-billing" type="checkbox" checked
            style="accent-color:#6366f1;width:14px;height:14px;" />
          <label for="tk-stripe-billing" style="font-size:11px;color:#8ea2d6;cursor:pointer;">
            Auto-fill billing fields
          </label>
        </div>
        <div class="tk-row" style="margin-top:8px;">
          <input id="tk-stripe-name" class="tk-input" type="text"
            placeholder="Cardholder name" style="margin-bottom:0;" />
        </div>
        <div class="tk-row" style="margin-top:6px;">
          <input id="tk-stripe-country" class="tk-input" type="text"
            placeholder="Country code (e.g. US)" style="margin-bottom:0;width:40%;" />
          <input id="tk-stripe-address" class="tk-input" type="text"
            placeholder="Address" style="margin-bottom:0;flex:1;" />
        </div>
        <div class="tk-row" style="margin-top:6px;">
          <input id="tk-stripe-postal" class="tk-input" type="text"
            placeholder="Postal code" style="margin-bottom:0;width:50%;" />
        </div>
        <div class="tk-row" style="margin-top:10px;">
          <button id="tk-stripe-fill" class="tk-btn tk-accent">Fill Stripe</button>
          <button id="tk-stripe-detect" class="tk-btn">Detect</button>
        </div>
        <div id="tk-stripe-status" class="tk-status tk-info" style="display:none"></div>
        <div class="tk-hint">
          Uses language-agnostic selectors (id / autocomplete) — works on checkout.stripe.com in any language.
        </div>
      `;

      const input = container.querySelector('#tk-stripe-input');
      const fillBtn = container.querySelector('#tk-stripe-fill');
      const detectBtn = container.querySelector('#tk-stripe-detect');
      const status = container.querySelector('#tk-stripe-status');
      const billingCb = container.querySelector('#tk-stripe-billing');
      const nameIn = container.querySelector('#tk-stripe-name');
      const countryIn = container.querySelector('#tk-stripe-country');
      const addressIn = container.querySelector('#tk-stripe-address');
      const postalIn = container.querySelector('#tk-stripe-postal');

      const showStatus = (text, type) => {
        type = type || 'info';
        status.style.display = '';
        status.className = 'tk-status tk-' + type;
        status.textContent = text;
      };
      const hideStatus = () => { status.style.display = 'none'; };

      const parseCard = (raw) => {
        const text = String(raw || '').trim();
        if (!text) return null;
        const parts = text.split('|');
        if (parts.length >= 4) {
          return {
            number: parts[0].trim(),
            month: parts[1].trim(),
            year: parts[2].trim(),
            cvc: parts[3].trim(),
            expiry: parts[1].trim() + '/' + parts[2].trim().slice(-2),
          };
        }
        const m = text.match(/(\d{13,19})\D+(\d{1,2})\D+(\d{2,4})\D+(\d{3,4})/);
        if (m) {
          return {
            number: m[1],
            month: m[2],
            year: m[3],
            cvc: m[4],
            expiry: m[2] + '/' + m[3].slice(-2),
          };
        }
        return null;
      };

      const gatherCardData = () => {
        const data = parseCard(input.value);
        if (!data) return null;
        if (billingCb.checked) {
          if (nameIn.value.trim()) data.name = nameIn.value.trim();
          if (countryIn.value.trim()) data.country = countryIn.value.trim().toUpperCase();
          if (addressIn.value.trim()) data.address = addressIn.value.trim();
          if (postalIn.value.trim()) data.postalCode = postalIn.value.trim();
        }
        return data;
      };

      fillBtn.addEventListener('click', async () => {
        hideStatus();
        const data = gatherCardData();
        if (!data) {
          showStatus('Invalid card format. Use: number|MM|YYYY|CVC', 'err');
          return;
        }
        fillBtn.disabled = true;
        fillBtn.textContent = 'Filling…';
        try {
          const resp = await chrome.runtime.sendMessage({
            type: 'tk:stripe-fill',
            payload: { cardData: data },
          });
          if (resp && resp.ok) {
            const count = resp.filledFrames != null ? resp.filledFrames : '?';
            showStatus('Filled ' + count + ' frame(s).', 'ok');
          } else {
            showStatus(resp && resp.error ? resp.error : 'Fill failed — no Stripe fields found.', 'err');
          }
        } catch (e) {
          showStatus(e instanceof Error ? e.message : String(e), 'err');
        } finally {
          fillBtn.disabled = false;
          fillBtn.textContent = 'Fill Stripe';
        }
      });

      detectBtn.addEventListener('click', async () => {
        hideStatus();
        detectBtn.disabled = true;
        detectBtn.textContent = 'Detecting…';
        try {
          const resp = await chrome.runtime.sendMessage({
            type: 'tk:stripe-fill',
            payload: {
              cardData: { number: '4111111111111111', month: '12', year: '2030', cvc: '123' },
            },
          });
          if (resp && resp.ok) {
            const count = resp.filledFrames != null ? resp.filledFrames : '?';
            showStatus('Stripe detected in ' + count + ' frame(s).', 'ok');
          } else {
            showStatus('Stripe fields not detected on this page.', 'err');
          }
        } catch (e) {
          showStatus(e instanceof Error ? e.message : String(e), 'err');
        } finally {
          detectBtn.disabled = false;
          detectBtn.textContent = 'Detect';
        }
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') fillBtn.click();
      });
    },
  };

  // ── Tool: Recorder ───────────────────────────────────────────────────────
  const RecorderTool = {
    id: 'recorder',
    name: 'Recorder',
    icon: '\uD83D\uDCF9',

    mount(container) {
      container.innerHTML = `
        <div class="tk-section-title">Scenario Recorder</div>
        <div class="tk-row">
          <input id="tk-rec-name" class="tk-input" type="text"
            placeholder="Scenario name (optional)" maxlength="120" />
        </div>
        <div class="tk-row">
          <button id="tk-rec-start" class="tk-btn tk-accent">Start</button>
          <button id="tk-rec-stop" class="tk-btn" disabled>Stop</button>
        </div>
        <div class="tk-row">
          <button id="tk-rec-export" class="tk-btn" disabled>Export JSON</button>
        </div>
        <div id="tk-rec-status" class="tk-status tk-info">Idle — not recording.</div>
        <div class="tk-hint">Click Start, then interact with the page. Click Stop to save.</div>
      `;

      const startBtn = container.querySelector('#tk-rec-start');
      const stopBtn = container.querySelector('#tk-rec-stop');
      const exportBtn = container.querySelector('#tk-rec-export');
      const nameInput = container.querySelector('#tk-rec-name');
      const status = container.querySelector('#tk-rec-status');

      let currentScenario = null;

      const setStatus = (text, type) => {
        type = type || 'info';
        status.style.display = '';
        status.className = 'tk-status tk-' + type;
        status.textContent = text;
      };

      const refresh = async () => {
        try {
          const resp = await chrome.runtime.sendMessage({ type: 'tk:recorder-status' });
          if (!resp || !resp.ok) return;
          if (resp.mode === 'record') {
            startBtn.disabled = true;
            stopBtn.disabled = false;
            exportBtn.disabled = true;
            setStatus('Recording… steps: ' + (resp.stepCount || 0) + (resp.paused ? ' (paused)' : ''), 'ok');
          } else {
            startBtn.disabled = false;
            stopBtn.disabled = true;
            exportBtn.disabled = !currentScenario;
            if (currentScenario) {
              setStatus('Saved: "' + currentScenario.name + '" — ' + (currentScenario.steps ? currentScenario.steps.length : 0) + ' steps.', 'ok');
            } else {
              setStatus('Idle — not recording.', 'info');
            }
          }
        } catch (e) {
          setStatus(e instanceof Error ? e.message : String(e), 'err');
        }
      };

      startBtn.addEventListener('click', async () => {
        startBtn.disabled = true;
        try {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          const activeUrl = String(tabs && tabs[0] && tabs[0].url ? tabs[0].url : '').trim();
          if (!/^https?:\/\//i.test(activeUrl)) {
            setStatus('Open a regular website tab (http/https) before recording.', 'err');
            startBtn.disabled = false;
            return;
          }
          const resp = await chrome.runtime.sendMessage({
            type: 'tk:recorder-start',
            payload: {
              scenarioName: nameInput.value.trim() || undefined,
              startUrl: activeUrl,
              tabId: tabs[0].id,
            },
          });
          if (resp && resp.ok) {
            setStatus('Recording started. Interact with the page.', 'ok');
            currentScenario = null;
          } else {
            setStatus(resp && resp.error ? resp.error : 'Failed to start recording.', 'err');
            startBtn.disabled = false;
          }
        } catch (e) {
          setStatus(e instanceof Error ? e.message : String(e), 'err');
          startBtn.disabled = false;
        }
        await refresh();
      });

      stopBtn.addEventListener('click', async () => {
        stopBtn.disabled = true;
        try {
          const resp = await chrome.runtime.sendMessage({ type: 'tk:recorder-stop' });
          if (resp && resp.ok && resp.scenario) {
            currentScenario = resp.scenario;
            setStatus('Recording saved: "' + resp.scenario.name + '" — ' + (resp.scenario.steps ? resp.scenario.steps.length : 0) + ' steps.', 'ok');
          } else if (resp && resp.ok) {
            setStatus('Recording stopped (no steps captured).', 'info');
          } else {
            setStatus(resp && resp.error ? resp.error : 'Failed to stop.', 'err');
          }
        } catch (e) {
          setStatus(e instanceof Error ? e.message : String(e), 'err');
        }
        await refresh();
      });

      exportBtn.addEventListener('click', () => {
        if (!currentScenario) return;
        const blob = new Blob([JSON.stringify(currentScenario, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeName = String(currentScenario.name || 'scenario').replace(/[^a-zA-Z0-9_-]/g, '_');
        a.download = safeName + '.json';
        a.click();
        URL.revokeObjectURL(url);
      });

      const timer = setInterval(refresh, 1200);
      container.addEventListener('DOMNodeRemoved', () => clearInterval(timer), { once: true });
      refresh();
    },
  };

  // ── Tool Registry ────────────────────────────────────────────────────────
  function loadTools() {
    return [RecorderTool, StripeFillerTool];
  }
  let _activeTool = null;
  function setActiveTool(id) { _activeTool = id; }

  // ── Panel UI ─────────────────────────────────────────────────────────────
  function initPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'tk-panel';
    panel.innerHTML = `
      <div class="tk-header">
        <div class="tk-brand">
          <div class="tk-logo">\u2699</div>
          <span class="tk-title">Stitch Toolkit</span>
        </div>
        <button class="tk-toggle" id="tk-toggle" title="Collapse/Expand">\u25B6</button>
        <button class="tk-close" id="tk-close" title="Hide panel (reload to restore)">\u2715</button>
      </div>
      <div class="tk-body" id="tk-body">
        <div class="tk-menu" id="tk-menu"></div>
        <div class="tk-tool-area" id="tk-tool-area"></div>
      </div>
    `;
    document.body.appendChild(panel);

    const toggle = panel.querySelector('#tk-toggle');
    const closeBtn = panel.querySelector('#tk-close');
    const body = panel.querySelector('#tk-body');
    const menu = panel.querySelector('#tk-menu');
    const toolArea = panel.querySelector('#tk-tool-area');

    const collapsed = _loadState(_STORAGE_KEYS.collapsed, false);
    if (collapsed) panel.classList.add('tk-collapsed');
    updateToggleIcon(collapsed);

    toggle.addEventListener('click', () => {
      const nowCollapsed = !panel.classList.contains('tk-collapsed');
      panel.classList.toggle('tk-collapsed', nowCollapsed);
      _saveState(_STORAGE_KEYS.collapsed, nowCollapsed);
      updateToggleIcon(nowCollapsed);
    });

    closeBtn.addEventListener('click', () => {
      panel.style.display = 'none';
    });

    function updateToggleIcon(isCollapsed) {
      toggle.textContent = isCollapsed ? '\u25C0' : '\u25B6';
      toggle.title = isCollapsed ? 'Expand' : 'Collapse';
    }

    const tools = loadTools();
    const activeToolId = _loadState(_STORAGE_KEYS.activeTool, tools[0] ? tools[0].id : null);

    menu.innerHTML = '';
    for (let i = 0; i < tools.length; i++) {
      const tool = tools[i];
      const btn = document.createElement('button');
      btn.className = 'tk-tool-btn';
      btn.dataset.id = tool.id;
      btn.innerHTML = '<span>' + tool.icon + '</span> <span>' + tool.name + '</span>';
      btn.addEventListener('click', function () { activateTool(tool.id); });
      menu.appendChild(btn);
    }

    function activateTool(id) {
      const tool = tools.find(function (t) { return t.id === id; });
      if (!tool) return;

      const buttons = menu.querySelectorAll('.tk-tool-btn');
      for (let i = 0; i < buttons.length; i++) {
        buttons[i].classList.toggle('tk-active', buttons[i].dataset.id === id);
      }

      toolArea.innerHTML = '';
      if (typeof tool.mount === 'function') {
        tool.mount(toolArea);
      } else {
        toolArea.innerHTML = '<div class="tk-hint">Tool "' + tool.name + '" has no UI.</div>';
      }
      setActiveTool(id);
      _saveState(_STORAGE_KEYS.activeTool, id);
    }

    if (activeToolId) {
      activateTool(activeToolId);
    } else if (tools.length) {
      activateTool(tools[0].id);
    }
  }

  // ── Inject panel ─────────────────────────────────────────────────────────
  function injectWhenReady() {
    if (document.body || document.documentElement) {
      initPanel();
    } else {
      requestAnimationFrame(injectWhenReady);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectWhenReady);
  } else {
    injectWhenReady();
  }

  // ── Event Recording (for Recorder tool) ────────────────────────────────────
  let _recording = false;

  chrome.runtime.onMessage.addListener(function (msg) {
    const type = String(msg && msg.type ? msg.type : '');
    if (type === 'tk:recorder-state') {
      const payload = msg.payload || {};
      _recording = payload.mode === 'record';
    }
    return false;
  });

  function getSelector(el) {
    if (!el || el === document || el === document.documentElement) return null;
    try {
      if (el.id) return '#' + el.id;
      if (el.className && typeof el.className === 'string') {
        const classes = el.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.');
        if (classes) return el.tagName.toLowerCase() + '.' + classes;
      }
      return el.tagName.toLowerCase();
    } catch { return null; }
  }

  function sendEvent(kind, detail) {
    if (!_recording) return;
    try {
      chrome.runtime.sendMessage({ type: 'tk:record-event', payload: Object.assign({ kind: kind }, detail) });
    } catch {}
  }

  document.addEventListener('click', function (e) {
    if (!_recording) return;
    const el = e.target;
    if (!el) return;
    if (el.closest && el.closest('#' + PANEL_ID)) return;
    const selector = getSelector(el);
    if (!selector) return;
    sendEvent('click', {
      selector: selector,
      url: location.href,
      ts: new Date().toISOString(),
      meta: { tagName: el.tagName, text: String(el.innerText || '').slice(0, 120) },
    });
  }, true);

  document.addEventListener('input', function (e) {
    if (!_recording) return;
    const el = e.target;
    if (!el) return;
    if (el.closest && el.closest('#' + PANEL_ID)) return;
    const selector = getSelector(el);
    if (!selector) return;
    const value = el.type === 'password' ? '***' : String(el.value || '');
    sendEvent('change', {
      selector: selector,
      value: value.slice(0, 500),
      url: location.href,
      ts: new Date().toISOString(),
    });
  }, true);

  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function () {
    const url = arguments[2] || '';
    const result = origPush.apply(this, arguments);
    if (_recording) {
      sendEvent('nav', {
        url: url ? new URL(url, location.href).href : location.href,
        ts: new Date().toISOString(),
      });
    }
    return result;
  };
  history.replaceState = function () {
    const url = arguments[2] || '';
    const result = origReplace.apply(this, arguments);
    if (_recording) {
      sendEvent('nav', {
        url: url ? new URL(url, location.href).href : location.href,
        ts: new Date().toISOString(),
      });
    }
    return result;
  };
  window.addEventListener('popstate', function () {
    if (_recording) sendEvent('nav', { url: location.href, ts: new Date().toISOString() });
  });
})();
