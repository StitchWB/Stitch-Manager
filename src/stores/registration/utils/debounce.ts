import { createLogger } from '../../../lib/observability/logger';
const log = createLogger('Debounce');
/**
 * Debounce utility for auto-save functionality
 */

let saveTimeout: ReturnType<typeof setTimeout> | null = null;

export const createDebouncedSave = (
  saveCallback: () => Promise<void>,
  delay: number = 500
) => {
  return (settingsLoaded: boolean) => {
    log.debug('triggerSave called, settingsLoaded:', settingsLoaded);
    if (!settingsLoaded) {
      log.debug('settings not loaded yet, skipping');
      return;
    }

    if (saveTimeout) {
      log.debug('clearing existing timeout');
      clearTimeout(saveTimeout);
    }

    log.debug('setting timeout for', delay, 'ms');
    saveTimeout = setTimeout(async () => {
      log.debug('timeout fired, calling saveCallback');
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