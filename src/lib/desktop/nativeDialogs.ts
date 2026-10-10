interface PyWebViewApi {
  pick_folder: () => Promise<string | null>;
}

declare global {
  interface Window {
    pywebview?: { api?: PyWebViewApi };
  }
}

export function nativePickerAvailable(): boolean {
  return typeof window.pywebview?.api?.pick_folder === 'function';
}

export async function pickFolderNative(): Promise<string | null> {
  const api = window.pywebview?.api;
  if (!api?.pick_folder) return null;
  const result = await api.pick_folder();
  return typeof result === 'string' && result !== '' ? result : null;
}
