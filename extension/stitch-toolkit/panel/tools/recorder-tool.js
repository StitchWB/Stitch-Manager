// Stitch Toolkit — Recorder Tool (IIFE)
// Thin UI over the background recording session (sessionManager + content
// recorder stack). Steps are captured by content_recorder.js with rich
// selectors/redaction; this tool only starts/stops/exports/replays.

(function () {
  'use strict';

  if (window.RecorderTool) return;

  var _pollTimer = null;
  var _lastScenario = null;

  var STEP_ICONS = {
    click: '👆', input: '⌨️', change: '✏️', submit: '📤', nav: '🔀',
    keydown: '⏎', scroll: '↕️', manual: '⏸', 'manual-continue': '▶️', unknown: '•'
  };

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatStepTime(ts) {
    try {
      var d = new Date(ts);
      if (isNaN(d.getTime())) return '';
      return d.toTimeString().slice(0, 8);
    } catch (e) { return ''; }
  }

  function renderStepRow(step, index) {
    var kind = String(step && step.kind || 'unknown');
    var icon = STEP_ICONS[kind] || '•';
    var text = (step && (step.selector || (step.meta && step.meta.text) || step.url)) || kind;
    return (
      '<div class="tk-step">' +
        '<span class="tk-step-icon">' + icon + '</span>' +
        '<span class="tk-step-text" title="' + escapeHtml(text) + '">' + (index + 1) + '. ' + escapeHtml(String(text).slice(0, 60)) + '</span>' +
        '<span class="tk-step-time">' + formatStepTime(step && step.ts) + '</span>' +
      '</div>'
    );
  }

  function render() {
    var i18n = window.StitchI18n.t;
    return (
      '<div class="tk-section-title">' + i18n('recorder.title') + '</div>' +
      '<div class="tk-row">' +
        '<input id="tk-rec-name" class="tk-input" type="text" placeholder="' + i18n('recorder.namePlaceholder') + '" maxlength="120" />' +
      '</div>' +
      '<div class="tk-row" style="display:flex;gap:4px;">' +
        '<button id="tk-rec-start" class="tk-btn tk-accent" style="flex:1;">' + i18n('recorder.start') + '</button>' +
        '<button id="tk-rec-stop" class="tk-btn" style="flex:1;" disabled>' + i18n('recorder.stop') + '</button>' +
      '</div>' +
      '<div class="tk-row" style="display:flex;gap:4px;">' +
        '<button id="tk-rec-export" class="tk-btn" style="flex:1;" disabled>' + i18n('recorder.export') + '</button>' +
        '<button id="tk-rec-replay" class="tk-btn" style="flex:1;" disabled>' + i18n('recorder.replay') + '</button>' +
      '</div>' +
      '<div id="tk-rec-progress" style="display:none">' +
        '<div class="tk-section-title" style="margin-top:8px">' + i18n('recorder.replayProgress') + '</div>' +
        '<div class="tk-progress"><div class="tk-progress-fill" id="tk-rec-progress-fill" style="width:0%"></div></div>' +
      '</div>' +
      '<div id="tk-rec-steps-wrap" style="display:none">' +
        '<div class="tk-section-title" style="margin-top:8px">' + i18n('recorder.liveSteps') + '</div>' +
        '<div id="tk-rec-steps" class="tk-step-list"></div>' +
      '</div>' +
      '<div id="tk-rec-status" class="tk-status tk-info">' + i18n('recorder.idle') + '</div>' +
      '<div id="tk-rec-library-wrap" style="display:none">' +
        '<div class="tk-section-title" style="margin-top:10px">' + i18n('recorder.savedScenarios') + '</div>' +
        '<div id="tk-rec-library" class="tk-billing-profiles"></div>' +
      '</div>' +
      '<div class="tk-hint">' + i18n('recorder.hint') + '</div>'
    );
  }

  function renderScenarioRow(sc, index) {
    var i18n = window.StitchI18n.t;
    var name = (sc && sc.name) || ('scenario-' + index);
    var steps = (sc && Array.isArray(sc.steps)) ? sc.steps.length : 0;
    var when = '';
    try {
      if (sc && sc.importedAt) {
        var d = new Date(sc.importedAt);
        if (!isNaN(d.getTime())) when = d.toLocaleDateString() + ' ' + d.toTimeString().slice(0, 5);
      }
    } catch (e) {}
    return (
      '<div class="tk-profile-item tk-scenario-item" data-sc-id="' + escapeHtml(sc && sc.id) + '">' +
        '<span style="font-size:14px">🎬</span>' +
        '<div style="flex:1;min-width:0">' +
          '<div class="tk-profile-name" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(name) + '</div>' +
          '<div class="tk-profile-detail">' + steps + ' steps' + (when ? ' · ' + when : '') + '</div>' +
        '</div>' +
        '<button class="tk-sc-act tk-sc-play" title="' + i18n('recorder.replay') + '">▶</button>' +
        '<button class="tk-sc-act tk-sc-export" title="' + i18n('recorder.export') + '">📤</button>' +
        '<button class="tk-sc-act tk-sc-del" title="' + i18n('recorder.deleteScenario') + '">✕</button>' +
      '</div>'
    );
  }

  function mount(container) {
    container.innerHTML = render();

    var startBtn = container.querySelector('#tk-rec-start');
    var stopBtn = container.querySelector('#tk-rec-stop');
    var exportBtn = container.querySelector('#tk-rec-export');
    var replayBtn = container.querySelector('#tk-rec-replay');
    var nameInput = container.querySelector('#tk-rec-name');
    var status = container.querySelector('#tk-rec-status');
    var progressWrap = container.querySelector('#tk-rec-progress');
    var progressFill = container.querySelector('#tk-rec-progress-fill');
    var stepsWrap = container.querySelector('#tk-rec-steps-wrap');
    var stepsList = container.querySelector('#tk-rec-steps');

    var hideStatus = function () { if (status) status.style.display = 'none'; };

    var setStatus = function (text, type) {
      if (!status) return;
      type = type || 'info';
      status.style.display = '';
      status.className = 'tk-status tk-' + type;
      status.textContent = text;
    };

    var showLiveSteps = function () {
      try {
        chrome.runtime.sendMessage({ type: 'tk:recorder-steps' }).then(function (sr) {
          var steps = sr && sr.ok && Array.isArray(sr.steps) ? sr.steps : [];
          var recent = steps.slice(-30);
          var offset = steps.length - recent.length;
          if (stepsList) {
            stepsList.innerHTML = recent.map(function (step, i) { return renderStepRow(step, offset + i); }).join('');
            stepsList.scrollTop = stepsList.scrollHeight;
          }
        }).catch(function () {});
      } catch (e) {}
    };

    var applyStatus = function (resp) {
      if (!resp || !resp.ok) return;
      var i18n = window.StitchI18n.t;
      if (resp.mode === 'record') {
        var own = resp.origin === 'toolkit' || resp.origin === 'popup';
        startBtn.disabled = true;
        stopBtn.disabled = !own;
        exportBtn.disabled = true;
        replayBtn.disabled = true;
        if (progressWrap) progressWrap.style.display = 'none';
        if (stepsWrap) stepsWrap.style.display = '';
        showLiveSteps();
        var text = 'Recording… steps: ' + (resp.stepCount || 0) + (resp.paused ? ' (paused)' : '');
        setStatus(own ? text : text + ' — ' + i18n('recorder.controlledExternally'), 'ok');
      } else if (resp.mode === 'replay') {
        startBtn.disabled = true;
        stopBtn.disabled = true;
        exportBtn.disabled = true;
        replayBtn.disabled = true;
        if (stepsWrap) stepsWrap.style.display = 'none';
        if (progressWrap) progressWrap.style.display = '';
        var rp = resp.replay || {};
        var pct = rp.total > 0 ? Math.min(100, Math.round(((rp.current || 0) / rp.total) * 100)) : 0;
        if (progressFill) progressFill.style.width = pct + '%';
        setStatus('Replay: step ' + (rp.current || 0) + '/' + (rp.total || 0) + (rp.paused ? ' (paused)' : ''), 'ok');
      } else {
        startBtn.disabled = false;
        stopBtn.disabled = true;
        exportBtn.disabled = !_lastScenario;
        replayBtn.disabled = !_lastScenario || !(_lastScenario.steps && _lastScenario.steps.length);
        if (progressWrap) progressWrap.style.display = 'none';
        if (stepsWrap) stepsWrap.style.display = 'none';
        if (_lastScenario) {
          setStatus('Saved: "' + (_lastScenario.name || 'scenario') + '" — ' + ((_lastScenario.steps || []).length) + ' steps.', 'ok');
        } else {
          setStatus(i18n('recorder.idle'), 'info');
        }
      }
    };

    var refresh = function () {
      chrome.runtime.sendMessage({ type: 'tk:recorder-status' })
        .then(function (resp) {
          // Restore last scenario from storage if we don't have one in this page yet
          if (!_lastScenario) {
            chrome.runtime.sendMessage({ type: 'tk:recorder-save' }).then(function (saved) {
              if (saved && saved.ok && Array.isArray(saved.scenarios) && saved.scenarios.length) {
                _lastScenario = saved.scenarios[saved.scenarios.length - 1];
              }
              applyStatus(resp);
            }).catch(function () { applyStatus(resp); });
          } else {
            applyStatus(resp);
          }
        })
        .catch(function (e) {
          setStatus(e instanceof Error ? e.message : String(e), 'err');
        });
    };

    var startPolling = function () {
      if (_pollTimer) return;
      _pollTimer = setInterval(refresh, 1500);
    };
    var stopPolling = function () {
      if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    };

    startBtn.addEventListener('click', function () {
      hideStatus();
      startBtn.disabled = true;
      chrome.tabs.query({ active: true, currentWindow: true })
        .then(function (tabs) {
          return chrome.runtime.sendMessage({
            type: 'tk:recorder-start',
            payload: {
              tabId: tabs && tabs[0] ? tabs[0].id : undefined,
              scenarioName: nameInput.value.trim() || 'Untitled'
            }
          });
        })
        .then(function (resp) {
          if (resp && resp.ok) {
            window.EventBus.emit('recorder:started');
            startPolling();
            refresh();
          } else {
            startBtn.disabled = false;
            window.NotificationService.error(resp && resp.error ? resp.error : window.StitchI18n.t('recorder.startFailed'));
            refresh();
          }
        })
        .catch(function (e) {
          startBtn.disabled = false;
          window.NotificationService.error(e instanceof Error ? e.message : String(e));
        });
    });

    stopBtn.addEventListener('click', function () {
      hideStatus();
      stopBtn.disabled = true;
      chrome.runtime.sendMessage({ type: 'tk:recorder-stop' })
        .then(function (resp) {
          if (resp && resp.ok && resp.scenario) {
            _lastScenario = resp.scenario;
            window.StateManager.set('lastScenario', resp.scenario);
            window.NotificationService.success(window.StitchI18n.t('recorder.saved', { count: (resp.scenario.steps || []).length }));
            if (typeof loadLibrary === 'function') loadLibrary();
          }
          window.EventBus.emit('recorder:stopped');
          refresh();
        })
        .catch(function (e) {
          window.NotificationService.error(e instanceof Error ? e.message : String(e));
          refresh();
        });
    });

    exportBtn.addEventListener('click', function () {
      var scenario = _lastScenario || window.StateManager.get('lastScenario');
      if (!scenario) { window.NotificationService.warn(window.StitchI18n.t('recorder.noStepsToExport')); return; }
      downloadScenario(scenario);
    });

    replayBtn.addEventListener('click', function () {
      var scenario = _lastScenario || window.StateManager.get('lastScenario');
      if (!scenario || !scenario.steps || !scenario.steps.length) return;
      replayBtn.disabled = true;
      chrome.runtime.sendMessage({
        type: 'tk:replay-start',
        payload: {
          steps: scenario.steps,
          startUrl: scenario.startUrl || scenario.startedUrl || '',
          scenarioName: scenario.name || 'Replay',
          force: false
        }
      })
        .then(function (resp) {
          if (resp && resp.ok) {
            window.NotificationService.success(window.StitchI18n.t('recorder.replayStarted'));
            startPolling();
            refresh();
          } else {
            replayBtn.disabled = false;
            window.NotificationService.error(resp && resp.error ? resp.error : window.StitchI18n.t('recorder.replayFailed'));
          }
        })
        .catch(function (e) {
          replayBtn.disabled = false;
          window.NotificationService.error(e instanceof Error ? e.message : String(e));
        });
    });

    // ── Scenario library (saved scenarios in chrome.storage) ────────────
    var libraryWrap = container.querySelector('#tk-rec-library-wrap');
    var libraryEl = container.querySelector('#tk-rec-library');
    var _scenarios = [];

    var loadLibrary = function () {
      try {
        chrome.runtime.sendMessage({ type: 'tk:recorder-save' }).then(function (saved) {
          _scenarios = saved && saved.ok && Array.isArray(saved.scenarios) ? saved.scenarios : [];
          if (!libraryWrap || !libraryEl) return;
          if (_scenarios.length === 0) {
            libraryWrap.style.display = 'none';
            libraryEl.innerHTML = '';
            return;
          }
          libraryWrap.style.display = '';
          // Newest first
          var rows = _scenarios.slice().reverse();
          libraryEl.innerHTML = rows.map(function (sc, i) { return renderScenarioRow(sc, i); }).join('');
        }).catch(function () {});
      } catch (e) {}
    };

    libraryEl && libraryEl.addEventListener('click', function (e) {
      var item = e.target.closest('.tk-scenario-item');
      if (!item) return;
      var id = item.getAttribute('data-sc-id');
      var sc = _scenarios.find(function (s) { return String(s && s.id) === id; });
      if (!sc) return;

      if (e.target.closest('.tk-sc-play')) {
        if (!sc.steps || !sc.steps.length) { window.NotificationService.warn(window.StitchI18n.t('recorder.noStepsToExport')); return; }
        chrome.runtime.sendMessage({
          type: 'tk:replay-start',
          payload: { steps: sc.steps, startUrl: sc.startUrl || sc.startedUrl || '', scenarioName: sc.name || 'Replay', force: false }
        }).then(function (resp) {
          if (resp && resp.ok) {
            window.NotificationService.success(window.StitchI18n.t('recorder.replayStarted'));
            startPolling();
            refresh();
          } else {
            window.NotificationService.error(resp && resp.error ? resp.error : window.StitchI18n.t('recorder.replayFailed'));
          }
        }).catch(function (err) { window.NotificationService.error(err instanceof Error ? err.message : String(err)); });
        return;
      }

      if (e.target.closest('.tk-sc-export')) {
        downloadScenario(sc);
        return;
      }

      if (e.target.closest('.tk-sc-del')) {
        if (!window.confirm(window.StitchI18n.t('recorder.confirmDelete', { name: sc.name || 'scenario' }))) return;
        chrome.runtime.sendMessage({ type: 'tk:scenario-delete', payload: { id: id } }).then(function (resp) {
          if (resp && resp.ok) {
            window.NotificationService.info(window.StitchI18n.t('recorder.deleted'));
            if (_lastScenario && String(_lastScenario.id) === id) _lastScenario = null;
            loadLibrary();
            refresh();
          } else {
            window.NotificationService.error(resp && resp.error ? resp.error : 'Delete failed');
          }
        }).catch(function (err) { window.NotificationService.error(err instanceof Error ? err.message : String(err)); });
        return;
      }
    });

    // Live step-count updates pushed from background (tk:recorder-progress)
    window.EventBus.on('recorder:progress', refresh);
    window.EventBus.on('panel:closed', stopPolling);

    startPolling();
    refresh();
    loadLibrary();
  }

  function downloadScenario(scenario) {
    var json = JSON.stringify(scenario, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (scenario.name || 'scenario') + '.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Public API — called from content.js via window.RecorderTool.*
  // ─────────────────────────────────────────────────────────────────────

  function toggle() {
    chrome.runtime.sendMessage({ type: 'tk:recorder-status' })
      .then(function (resp) {
        if (resp && resp.ok && resp.mode === 'record') {
          var own = resp.origin === 'toolkit' || resp.origin === 'popup';
          if (!own) {
            window.NotificationService.warn(window.StitchI18n.t('recorder.controlledExternally'));
            return;
          }
          return chrome.runtime.sendMessage({ type: 'tk:recorder-stop' }).then(function (stopResp) {
            if (stopResp && stopResp.ok && stopResp.scenario) {
              _lastScenario = stopResp.scenario;
              window.StateManager.set('lastScenario', stopResp.scenario);
              window.NotificationService.success(window.StitchI18n.t('recorder.saved', { count: (stopResp.scenario.steps || []).length }));
            }
            window.EventBus.emit('recorder:stopped');
          });
        }
        return chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
          return chrome.runtime.sendMessage({
            type: 'tk:recorder-start',
            payload: {
              tabId: tabs && tabs[0] ? tabs[0].id : undefined,
              scenarioName: 'Quick Record'
            }
          });
        }).then(function (startResp) {
          if (startResp && startResp.ok) {
            window.EventBus.emit('recorder:started');
          } else {
            window.NotificationService.error(startResp && startResp.error ? startResp.error : window.StitchI18n.t('recorder.startFailed'));
          }
        });
      })
      .catch(function (e) {
        window.NotificationService.error((e instanceof Error ? e.message : String(e)));
      });
  }

  function showExportModal(steps) {
    if (!steps || steps.length === 0) return;
    var scenario = _lastScenario || window.StateManager.get('lastScenario') || { name: 'Scenario', steps: steps };
    downloadScenario(scenario);
  }

  function importScenario(json) {
    try {
      var scenario = typeof json === 'string' ? JSON.parse(json) : json;
      if (!scenario || !scenario.steps) throw new Error('Invalid scenario');
      _lastScenario = scenario;
      window.StateManager.set('lastScenario', scenario);
      window.NotificationService.success(window.StitchI18n.t('recorder.imported', { count: scenario.steps.length }));
    } catch (e) {
      window.NotificationService.error(window.StitchI18n.t('recorder.importFailed') + ': ' + (e.message || ''));
    }
  }

  function cleanup() {
    // Stop only sessions started from the panel; bridge-driven sessions
    // (origin 'bridge') are owned by the Stitch app and must not be killed
    // when the panel closes.
    chrome.runtime.sendMessage({ type: 'tk:recorder-status' })
      .then(function (resp) {
        if (resp && resp.ok && resp.mode === 'record' && (resp.origin === 'toolkit' || resp.origin === 'popup')) {
          return chrome.runtime.sendMessage({ type: 'tk:recorder-stop' });
        }
        return null;
      })
      .catch(function () {});
  }

  // Export to window namespace
  window.RecorderTool = {
    id: 'recorder',
    name: 'Recorder',
    icon: '📹',
    mount: mount,
    toggle: toggle,
    showExportModal: showExportModal,
    importScenario: importScenario,
    cleanup: cleanup
  };

})();
