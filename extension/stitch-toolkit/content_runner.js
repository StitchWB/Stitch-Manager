ensureOverlay();
renderOverlay();
requestOverlaySync();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = String(message?.type || '');
  const payload = message?.payload && typeof message.payload === 'object' ? message.payload : {};

  if (type === 'stitch:start-record') {
    console.debug('[Stitch] Received start-record command — activating overlay');
    sendResponse?.({ ok: true });
    return true;
  }

  if (type === 'stitch:stop-record') {
    console.debug('[Stitch] Received stop-record command');
    sendResponse?.({ ok: true });
    return true;
  }

  if (type === 'stitch:control') {
    // Authoritative pause/resume state arrives via stitch:overlay-state
    // (applyOverlayState sets state.paused). This message must NOT bounce
    // back as stitch:overlay-control — that re-entered applyRecordControl
    // in the service worker, which re-sent stitch:control, forming an
    // infinite background↔content ping-pong on every pause/resume.
    sendResponse?.({ ok: true });
    return true;
  }

  if (type === 'stitch:overlay-state') {
    applyOverlayState(payload);
    sendResponse?.({ ok: true });
    return true;
  }

  return false;
});
