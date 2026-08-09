/**
 * Integration Test — Runs Stitch Toolkit in mock browser
 * Tests runtime behavior, not just syntax.
 * Run: node extension/stitch-toolkit/test-integration.cjs
 */

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const EXT_DIR = path.dirname(__filename);
const errors = [];
const passes = [];

function fail(msg) {
  errors.push(msg);
  console.log('  ✗ ' + msg);
}
function pass(msg) {
  passes.push(msg);
  console.log('  ✓ ' + msg);
}

// ════════════════════════════════════════════════════════════════════════
// SETUP MOCK BROWSER (JSDOM)
// ════════════════════════════════════════════════════════════════════════

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'https://example.com/',
  pretendToBeVisual: true,
});

// Expose ALL browser globals to Node.js global scope so extension scripts can run
const g = global;
g.window = dom.window;
g.document = dom.window.document;
g.navigator = dom.window.navigator;
g.localStorage = dom.window.localStorage;
g.URL = dom.window.URL;
g.Blob = dom.window.Blob;
g.FileReader = dom.window.FileReader;
g.WebSocket = dom.window.WebSocket;
g.Event = dom.window.Event;
g.KeyboardEvent = dom.window.KeyboardEvent;
g.MouseEvent = dom.window.MouseEvent;
g.MutationObserver = dom.window.MutationObserver;
// Keep Node.js timers (don't override — causes JSDOM recursion)
// Extension scripts use window.setTimeout explicitly via global.window

// Mock chrome.runtime
g.chrome = {
  runtime: {
    getURL: function (p) { return 'chrome-extension://test/' + p; },
    sendMessage: function (msg) {
      return Promise.resolve({ ok: true, filledFrames: 1 });
    },
    onMessage: { addListener: function () {} },
  },
};

// Mock history API
g.history = dom.window.history;
// Ensure methods exist even if JSDOM doesn't provide them
dom.window.history.pushState = dom.window.history.pushState || function () {};
dom.window.history.replaceState = dom.window.history.replaceState || function () {};

// Force English locale
Object.defineProperty(dom.window.navigator, 'language', {
  get: function () { return 'en-US'; },
  configurable: true,
});

// Clear any stale locale
try { dom.window.localStorage.removeItem('tk:locale'); } catch(e) {}

// ════════════════════════════════════════════════════════════════════════
// LOAD EXTENSION SCRIPTS (via Node.js eval with global mocks)
// ════════════════════════════════════════════════════════════════════════

function loadScript(file) {
  const code = fs.readFileSync(path.join(EXT_DIR, file), 'utf-8');
  // Use Node.js eval — all browser globals are available via `global` 
  eval(code);
}

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log('  Stitch Toolkit Integration Test');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');

console.log('1. Loading i18n.js');
console.log('   navigator.language:', navigator.language);
try { localStorage.removeItem('tk:locale'); } catch(e) {}
try {
  loadScript('i18n.js');
  if (window.StitchI18n) {
    pass('StitchI18n loaded');
    // Force English for testing (JSDOM navigator.language is system-dependent)
    window.StitchI18n.setLocale('en');
    var locale = window.StitchI18n.getLocale();
    if (locale === 'en') {
      pass('Locale set to English');
    } else {
      fail('Locale NOT English: ' + locale);
    }
  } else {
    fail('StitchI18n not found after loading i18n.js');
  }
} catch (e) {
  fail('i18n.js load error: ' + e.message);
  console.log(e.stack);
}

console.log('');
console.log('2. Loading content.js');
try {
  loadScript('content.js');
  if (window.__stitchToolkitInjected) {
    pass('content.js injected flag set');
  } else {
    fail('content.js injection flag not set');
  }
} catch (e) {
  fail('content.js load error: ' + e.message);
  console.log(e.stack);
}

// Load panel tools in manifest order (they register on window namespace;
// bootstrap picks them up because it is deferred via setTimeout).
['panel/tools/stripe-filler.js', 'panel/tools/recorder-tool.js', 'panel/tools/settings-tool.js'].forEach(function (file) {
  try {
    loadScript(file);
  } catch (e) {
    fail(file + ' load error: ' + e.message);
  }
});
if (window.StripeFillerTool && window.RecorderTool && window.SettingsTool) {
  pass('All panel tools registered');
} else {
  fail('Panel tools missing: ' + [
    window.StripeFillerTool ? null : 'StripeFillerTool',
    window.RecorderTool ? null : 'RecorderTool',
    window.SettingsTool ? null : 'SettingsTool',
  ].filter(Boolean).join(', '));
}

// Trigger DOMContentLoaded for bootstrap
const event = new Event('DOMContentLoaded');
document.dispatchEvent(event);

// Bootstrap is deferred via setTimeout(0) when document is already parsed,
// so UI checks must wait at least one macrotask before asserting.
setTimeout(runUiChecks, 60);

function runUiChecks() {
console.log('');
console.log('3. Checking UI elements');

// Check shadow host
var shadowHost = document.getElementById('tk-shadow-host');
if (shadowHost) {
  pass('Shadow host element exists');
} else {
  fail('Shadow host element NOT found');
}

// Check shadow root
if (shadowHost && shadowHost.shadowRoot) {
  pass('Shadow root attached');
} else {
  fail('Shadow root NOT attached');
}

if (shadowHost && shadowHost.shadowRoot) {
  // Check float button
  var floatBtn = shadowHost.shadowRoot.querySelector('.tk-float-btn');
  if (floatBtn) {
    pass('Float button rendered');
  } else {
    fail('Float button NOT rendered');
  }

  // Check panel
  var panel = shadowHost.shadowRoot.querySelector('.tk-panel');
  if (panel) {
    pass('Panel rendered');
  } else {
    fail('Panel NOT rendered');
  }

  // Check tabs
  var tabs = shadowHost.shadowRoot.querySelectorAll('.tk-tab');
  if (tabs.length >= 3) {
    pass('Tabs rendered (' + tabs.length + ' tabs)');
  } else {
    fail('Tabs NOT rendered (found ' + tabs.length + ')');
  }

  // Check active tab
  var activeTab = shadowHost.shadowRoot.querySelector('.tk-tab.tk-active');
  if (activeTab) {
    pass('Active tab set: ' + activeTab.dataset.id);
  } else {
    fail('No active tab found');
  }

  // Check tool content
  var toolContent = shadowHost.shadowRoot.querySelector('.tk-tool-content');
  if (toolContent && toolContent.innerHTML.length > 50) {
    pass('Tool content populated (' + toolContent.innerHTML.length + ' chars)');
  } else {
    fail('Tool content NOT populated (length=' + (toolContent ? toolContent.innerHTML.length : 'null') + ')');
  }

  // Click float button to toggle panel
  if (floatBtn) {
    floatBtn.click();
    setTimeout(function () {
      if (panel.classList.contains('tk-open')) {
        pass('Panel opens on float button click');
      } else {
        fail('Panel did NOT open on click (classes: ' + panel.className + ')');
      }

      // Click close button
      var closeBtn = shadowHost.shadowRoot.querySelector('.tk-close-btn');
      if (closeBtn) {
        closeBtn.click();
        setTimeout(function () {
          if (!panel.classList.contains('tk-open')) {
            pass('Panel closes on close button click');
          } else {
            fail('Panel did NOT close on click');
          }
        }, 100);
      }
    }, 100);
  }
}

console.log('');
console.log('4. Checking i18n functionality');

if (window.StitchI18n) {
  var enText = window.StitchI18n.t('stripe.fillCard');
  if (enText && enText.indexOf('Fill') !== -1) {
    pass('i18n English works: "' + enText + '"');
  } else {
    fail('i18n English returns: "' + enText + '"');
  }

  window.StitchI18n.setLocale('ru');
  var ruText = window.StitchI18n.t('stripe.fillCard');
  if (ruText && ruText.indexOf('Заполнить') !== -1) {
    pass('i18n Russian works: "' + ruText + '"');
  } else {
    fail('i18n Russian returns: "' + ruText + '"');
  }

  window.StitchI18n.setLocale('en'); // reset
}

console.log('');
console.log('5. Checking StateManager persistence');

setTimeout(function () {
  // Check that togglePanel saved 'expanded' state
  var savedExpanded = localStorage.getItem('tk:expanded');
  if (savedExpanded !== null) {
    pass('StateManager persisted expanded: ' + savedExpanded);
  } else {
    // activeTab may not persist on first boot (bootstrap mounts directly without activate)
    // Check expanded instead — togglePanel saves it
    var expandedVal = localStorage.getItem('tk:expanded');
    if (expandedVal !== null) {
      pass('StateManager persisted expanded: ' + expandedVal);
    } else {
      fail('StateManager did NOT persist any state');
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // RESULTS
  // ════════════════════════════════════════════════════════════════════════
  setTimeout(function () {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  Results: ' + passes.length + ' passed, ' + errors.length + ' failed');
    console.log('═══════════════════════════════════════════════════════════════');

    if (errors.length > 0) {
      console.log('\n❌ FAILURES:');
      errors.forEach(function (e) { console.log('  - ' + e); });
      process.exit(1);
    } else {
      console.log('\n✅ ALL INTEGRATION TESTS PASSED!');
      process.exit(0);
    }
  }, 300);
}, 300);
} // end runUiChecks
