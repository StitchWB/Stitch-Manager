/**
 * Debounce utility for auto-save functionality
 */

let saveTimeout: ReturnType<typeof setTimeout> | null = null;

export const createDebouncedSave = (
  saveCallback: () => Promise<void>,
  delay: number = 500
) => {
  return (settingsLoaded: boolean) => {
    console.warn('[DEBOUNCE] triggerSave called, settingsLoaded:', settingsLoaded);
    if (!settingsLoaded) {
      console.warn('[DEBOUNCE] settings not loaded yet, skipping');
      return;
    }

    if (saveTimeout) {
      console.warn('[DEBOUNCE] clearing existing timeout');
      clearTimeout(saveTimeout);
    }

    console.warn('[DEBOUNCE] setting timeout for', delay, 'ms');
    saveTimeout = setTimeout(async () => {
      console.warn('[DEBOUNCE] timeout fired, calling saveCallback');
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
