import { useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { useRegistrationStore } from '../../../stores/registration';
import { stopRegistration } from '../../../lib/backend';
import { testInboxConnection } from '../../../lib/backend/modules/registration';
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
    targetGroupId?: string;
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
      'kiro_v2',
      'aws',
      'windsurf',
      'trae',
      'github',
      'openai',
      'fireworks',
      'qoder',
      'bitbucket',
      'v0_app',
    ];
    if (!supportedProviders.includes(config.provider)) {
      const provider = String(config.provider);
      toast.error('Provider not supported', {
        description: `AutoReg is not implemented for provider: ${provider}`,
      });
      addLog({
        level: 'error',
        message: `Unsupported provider selected: ${provider}. Registration aborted.`,
      });
      return;
    }

    if (!canStart) {
      toast.error('Configuration Required', {
        description: 'Please configure IMAP settings',
      });
      return;
    }

    // Additional validation for alias services
    if (config.imap.addyioEnabled && !config.imap.addyioApiToken) {
      toast.error('Addy.io Token Required', {
        description: 'Please enter your Addy.io API token in the Identity tab',
      });
      return;
    }

    if (config.imap.thirtyThreeMailEnabled && !config.imap.thirtyThreeMailUsername) {
      toast.error('33mail Username Required', {
        description: 'Please enter your 33mail username in the Identity tab',
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
      const summaryToast =
        summary.successCount > 0 ? toast.success : summary.failCount > 0 ? toast.error : toast.info;
      summaryToast('Registration Complete', { description: summaryText });
    } catch (error) {
      addLog({ level: 'error', message: `Fatal error: ${String(error)}` });
      toast.error('Error', { description: String(error) });
    } finally {
      handleSetActiveThreads(0);
    }
  }, [
    config,
    emailDomain,
    useRegistrationV2,
    canStart,
    addLog,
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
      toast.success('Inbox OK', { description: 'Connection successful' });
      return true;
    } catch (e) {
      addLog({ level: 'error', message: `IMAP error: ${e}` });
      return false;
    }
  }, [config.imap, addLog]);

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
      toast.info('Stopped', { description: 'Registration process stopped' });
    } catch (e) {
      addLog({ level: 'error', message: `Failed to stop processes: ${e}` });
    } finally {
      handleSetActiveThreads(0);
      setIsStopping(false);
    }
  }, [addLog, handleSetActiveThreads, setIsStopping]);

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
