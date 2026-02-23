import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useRegistrationStore } from '../../../stores/registration';

interface UseEventListenersProps {
  onThreadsChange: (threads: number) => void;
}

export const useEventListeners = ({ onThreadsChange }: UseEventListenersProps) => {
  const onThreadsChangeRef = useRef(onThreadsChange);

  useEffect(() => {
    onThreadsChangeRef.current = onThreadsChange;
  }, [onThreadsChange]);

  useEffect(() => {
    const { addLog, addResult, loadSettings } = useRegistrationStore.getState();

    const unlistenLog = listen<{ level: string; message: string }>('REGISTRATION_LOG', event => {
      let level = event.payload.level;
      let message = event.payload.message;

      // Try parsing nested JSON log
      if (typeof message === 'string' && message.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(message);
          if (parsed.type === 'log' && parsed.message) {
            message = parsed.message;
            if (parsed.level) level = parsed.level;
          }
        } catch (e) {
          // Not valid JSON, keep original message
        }
      }

      addLog({
        level: level as 'info' | 'error' | 'success' | 'warn' | 'debug',
        message: message,
      });
    });

    const unlistenComplete = listen<{ success: boolean }>('REGISTRATION_COMPLETE', event => {
      if (event.payload.success) {
        addLog({ level: 'success', message: 'Registration completed successfully!' });
      }
      // Reset active threads when registration completes
      onThreadsChangeRef.current(0);
    });

    const unlistenError = listen<{ error: string }>('REGISTRATION_ERROR', event => {
      addLog({ level: 'error', message: `Registration error: ${event.payload.error}` });
      // Reset active threads on error
      onThreadsChangeRef.current(0);
    });

    // Listen for Registration V2 progress events
    const unlistenProgress = listen<{ step: string; message: string }>(
      'REGISTRATION_PROGRESS',
      event => {
        addLog({
          level: 'info',
          message: `[V2] ${event.payload.step}: ${event.payload.message}`,
        });
      }
    );

    // Sync settings when they are updated elsewhere (e.g., Settings page)
    const unlistenSettings = listen<any>('SETTINGS_UPDATED', () => {
      console.log('[AUTOREG] Received SETTINGS_UPDATED event, reloading...');
      loadSettings();
    });

    // CRITICAL: Listen for ACCOUNT_ADDED events to update counters in real-time
    const unlistenAccountAdded = listen<{
      id: number;
      email: string;
      provider: string;
      has_token: boolean;
    }>('ACCOUNT_ADDED', event => {
      const { email, provider, has_token } = event.payload;
      addLog({ level: 'success', message: `✓ Account created: ${email} (${provider})` });
      addResult({
        email,
        status: 'success',
        token: has_token ? 'present' : undefined,
      });
    });

    return () => {
      unlistenLog.then(fn => fn());
      unlistenComplete.then(fn => fn());
      unlistenError.then(fn => fn());
      unlistenProgress.then(fn => fn());
      unlistenSettings.then(fn => fn());
      unlistenAccountAdded.then(fn => fn());
    };
  }, []);

  // Listen for stage tracking events
  useEffect(() => {
    const { setCurrentStage, updateStageProgress, completeStage } = useRegistrationStore.getState();

    const unlistenStageChanged = listen<{ stage: string; timestamp: string }>(
      'stage-changed',
      event => {
        setCurrentStage(event.payload.stage);
      }
    );

    const unlistenStageProgress = listen<{
      stage: string;
      current: number;
      total: number;
      message: string;
    }>('stage-progress', event => {
      updateStageProgress(
        event.payload.stage,
        event.payload.current,
        event.payload.total,
        event.payload.message
      );
    });

    const unlistenStageComplete = listen<{ stage: string; status: 'success' | 'error' }>(
      'stage-complete',
      event => {
        completeStage(event.payload.stage, event.payload.status);
      }
    );

    return () => {
      unlistenStageChanged.then(fn => fn());
      unlistenStageProgress.then(fn => fn());
      unlistenStageComplete.then(fn => fn());
    };
  }, []);
};
