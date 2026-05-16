import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useRegistrationStore } from '../../../stores/registration';
import { listAccounts, updateAccountNotesTags } from '../../../lib/tauri';
import type { ObsEvent } from '@/lib/observability/types';
import { remapLogLevel } from '../../../lib/logTransform';

interface UseEventListenersProps {
  launchContext?: {
    source?: 'profile';
    profileAlias?: string;
    targetProvider?: string;
  } | null;
}

export const useEventListeners = ({ launchContext }: UseEventListenersProps) => {

  useEffect(() => {
    const { addLog, addResult, loadSettings } = useRegistrationStore.getState();

    const unlistenObs = listen<ObsEvent>('obs:event', event => {
      const payload = event.payload;
      if (payload?.source !== 'python' && payload?.subsystem !== 'jobs') {
        return;
      }

      if (!payload?.message) return;

      const obsLevel =
        payload.level === 'error'
          ? 'error'
          : payload.level === 'warn'
            ? 'warn'
            : payload.level === 'debug'
              ? 'debug'
              : 'info';

      const message = payload.message;
      if (
        message.includes('Python job') &&
        (message.includes('started') || message.includes('succeeded'))
      ) {
        return;
      }

      const effectiveLevel = payload.source === 'python'
        ? (remapLogLevel(obsLevel, message) as 'info' | 'warn' | 'error' | 'debug' | 'success')
        : obsLevel;

      addLog({
        level: effectiveLevel,
        message,
      });
    });

    const unlistenComplete = listen<{ success: boolean }>('REGISTRATION_COMPLETE', event => {
      if (event.payload.success) {
        addLog({ level: 'success', message: 'Registration completed successfully!' });
      }
      // Reset active threads when registration completes
      const { setActiveThreads } = useRegistrationStore.getState();
      setActiveThreads(0);
    });

    const unlistenError = listen<{ error: string }>('REGISTRATION_ERROR', event => {
      addLog({ level: 'error', message: `Registration error: ${event.payload.error}` });
      // Reset active threads on error
      const { setActiveThreads } = useRegistrationStore.getState();
      setActiveThreads(0);
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
    const unlistenSettings = listen<unknown>('SETTINGS_UPDATED', () => {
      console.warn('[AUTOREG] Received SETTINGS_UPDATED event, reloading...');
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

      // Minimal relation auto-tagging for profile-launched OAuth/account creation
      if (launchContext?.source === 'profile' && launchContext.profileAlias) {
        void (async () => {
          try {
            const accounts = await listAccounts();
            const created = accounts.find(
              a => a.email.toLowerCase() === email.toLowerCase() && a.provider === provider
            );
            if (!created) return;

            const parsedTags = (() => {
              if (!created.tags) return [] as string[];
              try {
                const parsed = JSON.parse(created.tags);
                return Array.isArray(parsed) ? parsed : [];
              } catch {
                return [] as string[];
              }
            })();

            const additions = new Set<string>();
            additions.add(`launch-profile:${launchContext.profileAlias}`);
            if (launchContext.targetProvider) {
              additions.add(`registered-for:${launchContext.targetProvider}`);
            }
            if (provider === 'kiro') {
              additions.add('rel:via:aws');
            }

            const nextTags = Array.from(new Set([...parsedTags, ...Array.from(additions)]));
            if (nextTags.length !== parsedTags.length) {
              await updateAccountNotesTags({
                accountId: created.id,
                tags: JSON.stringify(nextTags),
              });
            }
          } catch {
            // Non-blocking enhancement only
          }
        })();
      }
    });

    return () => {
      unlistenObs.then(fn => fn());
      unlistenComplete.then(fn => fn());
      unlistenError.then(fn => fn());
      unlistenProgress.then(fn => fn());
      unlistenSettings.then(fn => fn());
      unlistenAccountAdded.then(fn => fn());
    };
  }, [launchContext]);

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
