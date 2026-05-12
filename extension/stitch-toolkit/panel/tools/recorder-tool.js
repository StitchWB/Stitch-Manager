// Stitch Toolkit — Recorder Tool (IIFE)
// Provides Start/Stop recording, step counter, and scenario export.

(function () {
  'use strict';

  if (window.RecorderTool) return;

  var _recording = false;
  var _paused = false;
  var _listener = null;

  function formatTime(ts) {
    var d = new Date(ts);
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0') + ':' + d.getSeconds().toString().padStart(2, '0');
  }

  function getSelector(el) {
    if (!el || el === document || el === document.documentElement) return null;
    try {
      if (el.id) return '#' + el.id;
      if (el.className && typeof el.className === 'string') {
        var cls = el.className.trim().split(/\s+/).filter(function (c) { return !c.startsWith('tk-'); }).join('.');
        if (cls) return '.' + cls.split('.').join('.');
      }
      return el.tagName.toLowerCase() + (el.name ? '[name="' + el.name + '"]' : '');
    } catch (e) { return null; }
  }

  function startListening() {
    if (_listener) return;
    _listener = function (e) {
      if (_paused || !_recording) return;
      var step = {
        type: e.type === 'click' ? 'click' : e.type === 'input' || e.type === 'change' ? 'input' : 'nav',
        desc: '',
        selector: '',
        value: '',
        ts: Date.now(),
        url: location.href,
      };

      if (e.type === 'click') {
        step.desc = (e.target.textContent || e.target.className || 'click').trim().substring(0, 50);
        step.selector = getSelector(e.target);
      } else if (e.type === 'input' || e.type === 'change') {
        step.desc = (e.target.name || e.target.id || e.target.className || 'input').trim().substring(0, 50);
        step.selector = getSelector(e.target);
        step.value = e.target.value ? '[redacted]' : '';
      }

      var steps = window.StateManager.get('recordingSteps');
      steps.push(step);
      window.StateManager.set('recordingSteps', steps);
      window.EventBus.emit('steps:updated');
    };

    document.addEventListener('click', _listener, true);
    document.addEventListener('input', _listener, true);
    window.addEventListener('popstate', _listener);
  }

  function stopListening() {
    if (_listener) {
      document.removeEventListener('click', _listener, true);
      document.removeEventListener('input', _listener, true);
      window.removeEventListener('popstate', _listener);
      _listener = null;
    }
  }

  function render() {
    var i18n = window.StitchI18n.t;
    var steps = window.StateManager.get('recordingSteps') || [];
    var stepCount = steps.length;
    var lastCard = window.StateManager.get('lastCard') || '';
    var profiles = window.StateManager.get('profiles') || [];

    return (
      '<div class="tk-section-title">' + i18n('recorder.title') + '</div>' +
      '<div class="tk-row">' +
        '<input id="tk-rec-name" class="tk-input" type="text" placeholder="' + i18n('recorder.namePlaceholder') + '" maxlength="120" />' +
      '</div>' +
      '<div class="tk-row" style="display:flex;gap:4px;">' +
        '<button id="tk-rec-start" class="tk-btn tk-accent" style="flex:1;">' + i18n('recorder.start') + '</button>' +
        '<button id="tk-rec-stop" class="tk-btn" style="flex:1;" disabled>' + i18n('recorder.stop') + '</button>' +
      '</div>' +
      '<div class="tk-row">' +
        '<button id="tk-rec-export" class="tk-btn" style="width:100%;" disabled>' + i18n('recorder.export') + '</button>' +
      '</div>' +
      '<div id="tk-rec-status" class="tk-status tk-info">' + i18n('recorder.idle') + '</div>' +
      '<div class="tk-hint">' + i18n('recorder.hint') + '</div>'
    );
  }

  function mount(container) {
    container.innerHTML = render();

    var startBtn = container.querySelector('#tk-rec-start');
    var stopBtn = container.querySelector('#tk-rec-stop');
    var exportBtn = container.querySelector('#tk-rec-export');
    var nameInput = container.querySelector('#tk-rec-name');
    var status = container.querySelector('#tk-rec-status');

    var currentScenario = null;
    var hideStatus = function () { if (status) status.style.display = 'none'; };

    var setStatus = function (text, type) {
      type = type || 'info';
      status.style.display = '';
      status.className = 'tk-status tk-' + type;
      status.textContent = text;
    };

    var refresh = function () {
      chrome.runtime.sendMessage({ type: 'tk:recorder-status' })
        .then(function (resp) {
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
              setStatus(window.StitchI18n.t('recorder.idle'), 'info');
            }
          }
        })
        .catch(function (e) {
          setStatus(e instanceof Error ? e.message : String(e), 'err');
        });
    };

    startBtn.addEventListener('click', function () {
      hideStatus();
      startBtn.disabled = true;
      chrome.tabs.query({ active: true, currentWindow: true })
        .then(function (tabs) {
          return chrome.runtime.sendMessage({
            type: 'tk:recorder-start',
            payload: { tabId: tabs[0].id, name: nameInput.value.trim() || 'Untitled' }
          });
        })
        .then(function (resp) {
          if (resp && resp.ok) {
            _recording = true;
            _paused = false;
            window.StateManager.set('recordingSteps', []);
            window.StateManager.set('currentScenario', { name: nameInput.value.trim() || 'Untitled', steps: [] });
            currentScenario = window.StateManager.get('currentScenario');
            startListening();
            refresh();
          } else {
            startBtn.disabled = false;
            window.NotificationService.error(resp && resp.error ? resp.error : 'Failed to start');
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
          _recording = false;
          stopListening();
          if (resp && resp.ok && resp.scenario) {
            currentScenario = resp.scenario;
            window.StateManager.set('lastScenario', currentScenario);
            window.NotificationService.success(window.StitchI18n.t('recorder.saved', { count: currentScenario.steps ? currentScenario.steps.length : 0 }));
          }
          refresh();
        })
        .catch(function (e) {
          window.NotificationService.error(e instanceof Error ? e.message : String(e));
          refresh();
        });
    });

    exportBtn.addEventListener('click', function () {
      var scenario = window.StateManager.get('lastScenario');
      if (!scenario) return;
      var json = JSON.stringify(scenario, null, 2);
      var blob = new Blob([json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = (scenario.name || 'scenario') + '.json';
      a.click();
      URL.revokeObjectURL(url);
    });

    // Listen for step updates
    window.EventBus.on('steps:updated', refresh);

    // Initial refresh
    refresh();
  }

  // ─────────────────────────────────────────────────────────────────────
  // Public API — called from content.js via window.RecorderTool.*
  // ─────────────────────────────────────────────────────────────────────

  function toggle() {
    if (_recording) {
      // Stop recording
      _recording = false;
      stopListening();
      chrome.runtime.sendMessage({ type: 'tk:recorder-stop' })
        .then(function (resp) {
          if (resp && resp.ok && resp.scenario) {
            window.StateManager.set('lastScenario', resp.scenario);
            window.NotificationService.success(window.StitchI18n.t('recorder.saved', { count: resp.scenario.steps ? resp.scenario.steps.length : 0 }));
          }
          window.EventBus.emit('recorder:stopped');
        })
        .catch(function (e) {
          _recording = false;
          window.NotificationService.error(window.StitchI18n.t('recorder.stopFailed') || 'Stop failed: ' + (e && e.message));
        });
    } else {
      // Start recording
      chrome.tabs.query({ active: true, currentWindow: true })
        .then(function (tabs) {
          return chrome.runtime.sendMessage({
            type: 'tk:recorder-start',
            payload: { tabId: tabs[0].id, name: 'Quick Record' }
          });
        })
        .then(function (resp) {
          if (resp && resp.ok) {
            _recording = true;
            _paused = false;
            window.StateManager.set('recordingSteps', []);
            startListening();
            window.EventBus.emit('recorder:started');
          } else {
            window.NotificationService.error(resp && resp.error ? resp.error : 'Failed to start recording');
          }
        })
        .catch(function (e) {
          window.NotificationService.error(window.StitchI18n.t('recorder.startFailed') + ': ' + (e && e.message));
        });
    }
  }

  function showExportModal(steps) {
    if (!steps || steps.length === 0) return;
    var scenario = window.StateManager.get('lastScenario') || { name: 'Scenario', steps: steps };
    var json = JSON.stringify(scenario, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (scenario.name || 'scenario') + '.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function importScenario(json) {
    try {
      var scenario = typeof json === 'string' ? JSON.parse(json) : json;
      if (!scenario || !scenario.steps) throw new Error('Invalid scenario');
      window.StateManager.set('lastScenario', scenario);
      window.NotificationService.success(window.StitchI18n.t('recorder.imported'));
    } catch (e) {
      window.NotificationService.error(window.StitchI18n.t('recorder.importFailed') + ': ' + (e.message || ''));
    }
  }

  function cleanup() {
    if (_recording) {
      _recording = false;
      stopListening();
      chrome.runtime.sendMessage({ type: 'tk:recorder-stop' }).catch(function() {});
    }
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