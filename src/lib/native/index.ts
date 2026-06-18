/**
 * Native API layer — pure Web API implementations.
 *
 * Uses standard browser APIs (Clipboard, Notifications) with
 * graceful fallbacks. No Tauri dependencies.
 */

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

/**
 * Copy text to clipboard.
 *
 * Strategy 1: Standard Clipboard API (`navigator.clipboard.writeText`).
 * Strategy 2 (fallback): Hidden textarea + `execCommand('copy')`.
 */
export async function copyToClipboard(text: string): Promise<void> {
  // Strategy 1: Standard Clipboard API
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through
    }
  }

  // Strategy 2: Hidden textarea + execCommand
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}

// ---------------------------------------------------------------------------
// File Dialog
// ---------------------------------------------------------------------------

/**
 * Open a file picker dialog.
 *
 * Browsers cannot open file dialogs that return paths to JS (security).
 * Callers should use `<input type="file">` instead.
 */
export async function openFile(_filters?: unknown[]): Promise<string | null> {
  return null;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/**
 * Show a system notification using the Web Notifications API.
 */
export async function notify(title: string, body: string): Promise<void> {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body });
  }
}
