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
    const command = String(payload.command || '').toLowerCase();
    console.debug(`[Stitch] Received control: ${command}`);
    chrome.runtime.sendMessage({
      type: 'stitch:overlay-control',
      payload: { command },
    });
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
