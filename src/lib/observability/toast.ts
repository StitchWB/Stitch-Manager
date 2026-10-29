import { toast } from 'sonner';
import { reportObsEvent } from './client';

function emitToast(level: 'info' | 'success' | 'warn' | 'error', message: string, source: string) {
  const obsLevel = level === 'success' ? 'info' : level;
  reportObsEvent({
    level: obsLevel,
    source: 'frontend',
    subsystem: 'toast',
    name: 'ui.toast',
    message,
    fields: {
      toastLevel: level,
      toastSource: source,
      shown: true,
    },
  });
}

export const appToast = {
  success(message: string, source: string = 'ui') {
    emitToast('success', message, source);
    return toast.success(message);
  },
  error(message: string, source: string = 'ui') {
    emitToast('error', message, source);
    return toast.error(message);
  },
  info(message: string, source: string = 'ui') {
    emitToast('info', message, source);
    return toast.info(message);
  },
  warning(message: string, source: string = 'ui') {
    emitToast('warn', message, source);
    return toast.warning(message);
  },
};
