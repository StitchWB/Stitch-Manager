/**
 * Debounce utility for auto-save functionality
 */

let saveTimeout: ReturnType<typeof setTimeout> | null = null;

export const createDebouncedSave = (
  saveCallback: () => Promise<void>,
  delay: number = 500
) => {
  return (settingsLoaded: boolean) => {
    console.log('[DEBOUNCE] triggerSave called, settingsLoaded:', settingsLoaded);
    if (!settingsLoaded) {
      console.log('[DEBOUNCE] settings not loaded yet, skipping');
      return;
    }

    if (saveTimeout) {
      console.log('[DEBOUNCE] clearing existing timeout');
      clearTimeout(saveTimeout);
    }

    console.log('[DEBOUNCE] setting timeout for', delay, 'ms');
    saveTimeout = setTimeout(async () => {
      console.log('[DEBOUNCE] timeout fired, calling saveCallback');
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
