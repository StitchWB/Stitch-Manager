/**
 * Debounce utility for auto-save functionality
 */

let saveTimeout: ReturnType<typeof setTimeout> | null = null;

export const createDebouncedSave = (
  saveCallback: () => Promise<void>,
  delay: number = 500
) => {
  return (settingsLoaded: boolean) => {
    if (import.meta.env.DEV) console.debug('[DEBOUNCE] triggerSave called, settingsLoaded:', settingsLoaded);
    if (!settingsLoaded) {
      if (import.meta.env.DEV) console.debug('[DEBOUNCE] settings not loaded yet, skipping');
      return;
    }

    if (saveTimeout) {
      if (import.meta.env.DEV) console.debug('[DEBOUNCE] clearing existing timeout');
      clearTimeout(saveTimeout);
    }

    if (import.meta.env.DEV) console.debug('[DEBOUNCE] setting timeout for', delay, 'ms');
    saveTimeout = setTimeout(async () => {
      if (import.meta.env.DEV) console.debug('[DEBOUNCE] timeout fired, calling saveCallback');
      await saveCallback();
    }, delay);
  };
};

export const clearSaveTimeout = () => {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
};
