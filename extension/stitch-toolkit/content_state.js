const state = {
  paused: false,
  runId: null,
  scenarioName: null,
  startUrl: null,
  lastUrl: null,
  mode: 'idle',
  hudSuppressed: false,
  recordStepCount: 0,
  overlaySteps: [],   // Step list for overlay rendering
  replayCurrent: 0,
  replayTotal: 0,
  replayStatus: 'idle',
  replayError: null,
};

const _frameContext = (() => {
  try {
    if (window.top === window.self) {
      return { isTop: true };
    }
  } catch {
    return { isTop: false, sameOrigin: false, frameSrc: location.href };
  }
  return { isTop: false, sameOrigin: true, frameSrc: location.href };
})();

let inputTimers = new WeakMap();
const trackedInputElements = [];

const cleanupController = {
  listeners: [],
  pollIntervalId: null,
  scrollTimer: null,
  scrollTarget: null,
  scrollHandler: null,
};

function isRecording() {
  return state.mode === 'record';
}

function isReplay() {
  return state.mode === 'replay';
}

function nowIso() {
  return new Date().toISOString();
}

function addListener(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  cleanupController.listeners.push({ target, type, handler, options });
}

function removeAllListeners() {
  for (const { target, type, handler, options } of cleanupController.listeners) {
    try {
      target.removeEventListener(type, handler, options);
    } catch {}
  }
  cleanupController.listeners = [];
}

function clearAllTimers() {
  for (const el of trackedInputElements) {
    try {
      const timer = inputTimers.get(el);
      if (timer) clearTimeout(timer);
    } catch {}
  }
  trackedInputElements.length = 0;
  inputTimers = new WeakMap();

  if (cleanupController.scrollTimer) {
    clearTimeout(cleanupController.scrollTimer);
    cleanupController.scrollTimer = null;
  }
  cleanupController.scrollTarget = null;
}

function startPollInterval() {
  // Was referenced by content_overlay.js but never defined (latent runner bug
  // that silently broke applyOverlayState for record mode). Periodically
  // re-syncs authoritative session state from the background while recording.
  if (cleanupController.pollIntervalId) return;
  cleanupController.pollIntervalId = setInterval(() => {
    if (!isRecording()) return;
    try { requestOverlaySync(); } catch {}
  }, 1000);
}

function clearPollInterval() {
  if (cleanupController.pollIntervalId) {
    clearInterval(cleanupController.pollIntervalId);
    cleanupController.pollIntervalId = null;
  }
}
