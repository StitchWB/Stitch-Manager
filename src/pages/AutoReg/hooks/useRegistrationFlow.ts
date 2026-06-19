import { useCallback, useRef } from 'react';
import { useRegistrationStore } from '../../../stores/registration';
import { useAppStore } from '../../../stores/app';
import { stopRegistration } from '../../../lib/tauri';
import { testInboxConnection } from '../../../lib/tauri/modules/registration';
import { runRegistration, cancelActiveRegistrationJob } from '../services';
import type { ProviderName } from '../../../types/ui';
import type { RegistrationConfig } from '../../../stores/registration/types';
import type { PipelineStepOverride } from '../../../components/registration/PipelineStepConfigPanel';

interface UseRegistrationFlowProps {
  config: RegistrationConfig;
  emailDomain: string;
  useRegistrationV2: boolean;
  canStart: boolean;
  launchContext?: {
    source?: 'profile';
    profileAlias?: string;
    targetProvider?: string;
    awsBootstrapAccountId?: number;
    launchMode?: string;
  };
  pipelineStepOverrides?: PipelineStepOverride[];
}

export const useRegistrationFlow = ({
  config,
  emailDomain,
  useRegistrationV2,
  canStart,
  launchContext,
  pipelineStepOverrides,
}: UseRegistrationFlowProps) => {
  const { addNotification } = useAppStore();
  const { addLog, addHistoryEntry, setActiveThreads, setIsStopping } = useRegistrationStore();
  const cancelledRef = useRef(false);

  // Writes directly to store — survives page navigation
  const handleSetActiveThreads = useCallback(
    (threads: number) => {
      setActiveThreads(threads);
    },
    [setActiveThreads]
  );

  const handleStart = useCallback(async () => {
    // Guard against unsupported providers.
    // The default Python autoreg fallback is Kiro/AWS; if a user selects a provider
    // that doesn't have an implementation, we must fail fast instead of silently
    // registering Kiro.
    const supportedProviders: ProviderName[] = [
      'kiro',
      'kiro_v2',
      'aws',
      'windsurf',
      'trae',
      'github',
      'openai',
      'fireworks',
      'qoder',
      'bitbucket',
    ];
    if (!supportedProviders.includes(config.provider)) {
      const provider = String(config.provider);
      addNotification({
        type: 'error',
        title: 'Provider not supported',
        message: `AutoReg is not implemented for provider: ${provider}`,
      });
      addLog({
        level: 'error',
        message: `Unsupported provider selected: ${provider}. Registration aborted.`,
      });
      return;
    }

    if (!canStart) {
      addNotification({
        type: 'error',
        title: 'Configuration Required',
        message: 'Please configure IMAP settings',
      });
      return;
    }

    // Additional validation for alias services
    if (config.imap.addyioEnabled && !config.imap.addyioApiToken) {
      addNotification({
        type: 'error',
        title: 'Addy.io Token Required',
        message: 'Please enter your Addy.io API token in the Identity tab',
      });
      return;
    }

    if (config.imap.thirtyThreeMailEnabled && !config.imap.thirtyThreeMailUsername) {
      addNotification({
        type: 'error',
        title: '33mail Username Required',
        message: 'Please enter your 33mail username in the Identity tab',
      });
      return;
    }

    // Reset cancellation flag
    cancelledRef.current = false;

    const totalCount = config.count || 1;
    handleSetActiveThreads(1);
    addLog({
      level: 'info',
      message: `Starting ${config.provider} registration (${totalCount} account${totalCount > 1 ? 's' : ''})...`,
    });

    try {
      // Run registration using service module
      const summary = await runRegistration({
        config,
        emailDomain,
        useRegistrationV2,
        launchContext,
        pipelineStepOverrides,
        onLog: (level, message) => addLog({ level, message }),
        onHistoryEntry: addHistoryEntry,
        onCancelled: () => cancelledRef.current,
      });

      // Summary notification
      const summaryText = `✓ ${summary.successCount} created, ⊘ ${summary.skipCount} skipped, ✗ ${summary.failCount} failed`;
      addLog({ level: 'info', message: `Registration complete: ${summaryText}` });
      addNotification({
        type: summary.successCount > 0 ? 'success' : summary.failCount > 0 ? 'error' : 'info',
        title: 'Registration Complete',
        message: summaryText,
      });
    } catch (error) {
      addLog({ level: 'error', message: `Fatal error: ${String(error)}` });
      addNotification({ type: 'error', title: 'Error', message: String(error) });
    } finally {
      handleSetActiveThreads(0);
    }
  }, [
    config,
    emailDomain,
    useRegistrationV2,
    canStart,
    addLog,
    addNotification,
    addHistoryEntry,
    handleSetActiveThreads,
    launchContext,
    pipelineStepOverrides,
  ]);

  const handleTestImap = useCallback(async (): Promise<boolean> => {
    addLog({ level: 'info', message: 'Testing IMAP connection...' });
    try {
      // Determine credentials based on strategy
      const server = config.imap.strategy === 'gmail' ? 'imap.gmail.com' : config.imap.server;
      let user = config.imap.strategy === 'gmail' ? config.imap.gmailBase : config.imap.email;
      // For Gmail, ensure user has @gmail.com suffix
      if (config.imap.strategy === 'gmail' && user && !user.includes('@')) {
        user = `${user}@gmail.com`;
      }
      const password =
        config.imap.strategy === 'gmail'
          ? config.imap.gmailAppPassword
          : config.imap.password || '********';

      addLog({ level: 'debug', message: `Testing: server=${server}, user=${user}` });

      const useMailTm = Boolean(config.imap.mailtmEnabled);
      const result = await testInboxConnection(
        useMailTm
          ? {
              provider: 'mail_tm',
              mailtmAddress: user,
              mailtmPassword: password,
            }
          : {
              provider: 'imap',
              imapServer: server,
              imapPort: config.imap.port,
              imapUser: user,
              imapPassword: password,
              useTls: config.imap.useTLS,
              mailbox: 'INBOX',
            }
      );
      addLog({ level: 'success', message: `Inbox: ${result}` });
      addNotification({ type: 'success', title: 'Inbox OK', message: 'Connection successful' });
      return true;
    } catch (e) {
      addLog({ level: 'error', message: `IMAP error: ${e}` });
      return false;
    }
  }, [config.imap, addLog, addNotification]);

  const handleStop = useCallback(async () => {
    const currentIsStopping = useRegistrationStore.getState().isStopping;
    if (currentIsStopping) return;

    setIsStopping(true);
    addLog({ level: 'warn', message: 'Stop requested - killing active processes...' });

    // Set cancellation flag to stop the JS loop
    cancelledRef.current = true;

    try {
      await cancelActiveRegistrationJob();
      await stopRegistration();
      addLog({ level: 'info', message: 'All registration processes terminated' });
      addNotification({ type: 'info', title: 'Stopped', message: 'Registration process stopped' });
    } catch (e) {
      addLog({ level: 'error', message: `Failed to stop processes: ${e}` });
    } finally {
      handleSetActiveThreads(0);
      setIsStopping(false);
    }
  }, [addLog, addNotification, handleSetActiveThreads, setIsStopping]);

  // Read from store so values survive page navigation
  const activeThreadsFromStore = useRegistrationStore(state => state.activeThreads);
  const isStoppingFromStore = useRegistrationStore(state => state.isStopping);

  return {
    activeThreads: activeThreadsFromStore,
    isStopping: isStoppingFromStore,
    cancelledRef,
    handleStart,
    handleTestImap,
    handleStop,
  };
};
