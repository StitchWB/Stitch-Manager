// Stitch Toolkit — Recorder Tool
// Provides Start/Stop recording, step counter, and scenario export.

export const RecorderTool = {
  id: 'recorder',
  name: 'Recorder',
  icon: '📹',

  mount(container) {
    container.innerHTML = `
      <div class="tk-section-title">Scenario Recorder</div>
      <div class="tk-row">
        <input id="tk-rec-name" class="tk-input" type="text" placeholder="Scenario name (optional)" maxlength="120" />
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

    const setStatus = (text, type = 'info') => {
      status.style.display = '';
      status.className = `tk-status tk-${type}`;
      status.textContent = text;
    };

    const refresh = async () => {
      try {
        const resp = await chrome.runtime.sendMessage({ type: 'tk:recorder-status' });
        if (!resp?.ok) return;
        if (resp.mode === 'record') {
          startBtn.disabled = true;
          stopBtn.disabled = false;
          exportBtn.disabled = true;
          setStatus(`Recording… steps: ${resp.stepCount || 0}${resp.paused ? ' (paused)' : ''}`, 'ok');
        } else {
          startBtn.disabled = false;
          stopBtn.disabled = true;
          exportBtn.disabled = !currentScenario;
          if (currentScenario) {
            setStatus(`Saved: "${currentScenario.name}" — ${currentScenario.steps?.length || 0} steps.`, 'ok');
          } else {
            setStatus('Idle — not recording.', 'info');
          }
        }
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e), 'err');
      }
    };

    startBtn.addEventListener('click', async () => {
      hideStatus();
      startBtn.disabled = true;
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeUrl = String(tabs?.[0]?.url || '').trim();
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
        if (resp?.ok) {
          setStatus('Recording started. Interact with the page.', 'ok');
          currentScenario = null;
        } else {
          setStatus(resp?.error || 'Failed to start recording.', 'err');
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
        if (resp?.ok && resp.scenario) {
          currentScenario = resp.scenario;
          setStatus(`Recording saved: "${resp.scenario.name}" — ${resp.scenario.steps?.length || 0} steps.`, 'ok');
        } else if (resp?.ok) {
          setStatus('Recording stopped (no steps captured).', 'info');
        } else {
          setStatus(resp?.error || 'Failed to stop.', 'err');
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
      a.download = `${safeName}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    function hideStatus() { status.style.display = 'none'; }

    // Auto-refresh every second while visible
    const timer = setInterval(refresh, 1000);
    // Cleanup on unmount
    container.addEventListener('DOMNodeRemoved', () => clearInterval(timer), { once: true });

    refresh();
  },
};
