import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  getSettings,
  updateSettings,
  testAddyioConnection,
  getAddyioAccount,
  getAddyioDomains,
  getAddyioRecipients,
  getEmailCounter,
  setEmailCounter,
} from '@/lib/backend';
import { t } from '@/lib/i18n';
import { validatePort, validateHostname, validateEmail } from '@/lib/validation';
import { useLogsStore } from '@/stores/logs';
import { loadEmailGenerationDomain } from '@/stores/registration/utils/migration';
import { useUIState } from '@/hooks/useUIState';
import type { SettingsData, AddyIoAccountDetails } from '@/types/generated';
import { saveSettingsSlice, useDebouncedSave, SETTINGS_SECRET_MASK } from './shared';

export function useMailSettings() {
  const addLog = useLogsStore(state => state.addLog);

  const [mailTab, setMailTab] = useUIState<'imap' | 'aliases' | 'icloud'>(
    'settings-mail-tab',
    'imap',
    'session'
  );
  const [showPassword, setShowPassword] = useState(false);

  const [imapServer, setImapServer] = useState('');
  const [imapPort, setImapPort] = useState('993');
  const [imapEmail, setImapEmail] = useState('');
  const [imapPassword, setImapPassword] = useState('');
  const [emailGenerationDomain, setEmailGenerationDomain] = useState('');

  const [addyioEnabled, setAddyioEnabled] = useState(false);
  const [addyioApiToken, setAddyioApiToken] = useState('');
  const [addyioApiTokenDraft, setAddyioApiTokenDraft] = useState('');
  const [addyioAliasFormat, setAddyioAliasFormat] = useState('uuid');
  const [addyioDomain, setAddyioDomain] = useState('');
  const [addyioAutoDelete, setAddyioAutoDelete] = useState(false);
  const [addyioDefaultRecipientId, setAddyioDefaultRecipientId] = useState('');
  const [addyioDescriptionTemplate, setAddyioDescriptionTemplate] = useState('');
  const [addyioFromName, setAddyioFromName] = useState('');

  const [thirtyThreeMailEnabled, setThirtyThreeMailEnabled] = useState(false);
  const [thirtyThreeMailUsername, setThirtyThreeMailUsername] = useState('');
  const [thirtyThreeMailDomain, setThirtyThreeMailDomain] = useState('33mail.com');
  const [thirtyThreeMailTemplate, setThirtyThreeMailTemplate] = useState('{rnd12}');

  const [mailtmEnabled, setMailtmEnabled] = useState(false);

  const [icloudEnabled, setIcloudEnabled] = useState(false);
  const [icloudAppleId, setIcloudAppleId] = useState('');
  const [icloudAppPassword, setIcloudAppPassword] = useState('');

  const [addyioDomains, setAddyioDomains] = useState<string[]>([]);
  const [addyioRecipients, setAddyioRecipients] = useState<
    Array<{ id: string; email: string; emailVerifiedAt: string | null }>
  >([]);
  const [addyioAccountInfo, setAddyioAccountInfo] = useState<AddyIoAccountDetails | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [connectionMessage, setConnectionMessage] = useState('');

  const [emailCounter, setEmailCounterState] = useState<number>(0);
  const [isLoadingCounter, setIsLoadingCounter] = useState(false);

  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = (await getSettings()) as unknown as SettingsData;
        if (cancelled) return;

        setImapServer(data.imapServer || '');
        setImapPort(String(data.imapPort || 993));
        setImapEmail(data.imapEmail || '');
        if (data.imapPassword && data.imapPassword !== SETTINGS_SECRET_MASK) {
          setImapPassword(data.imapPassword);
        }

        setAddyioEnabled(data.addyioEnabled || false);
        setAddyioApiToken(data.addyioApiToken || '');
        setAddyioApiTokenDraft(data.addyioApiToken || '');
        setAddyioAliasFormat(data.addyioAliasFormat || 'uuid');
        setAddyioDomain(data.addyioDomain || '');
        setAddyioAutoDelete(data.addyioAutoDelete || false);
        setAddyioDefaultRecipientId(data.addyioDefaultRecipientId || '');
        setAddyioDescriptionTemplate(data.addyioDescriptionTemplate || '');
        setAddyioFromName(data.addyioFromName || '');

        setThirtyThreeMailEnabled(data.thirtyThreeMailEnabled || false);
        setThirtyThreeMailUsername(data.thirtyThreeMailUsername || '');
        setThirtyThreeMailDomain(data.thirtyThreeMailDomain || '33mail.com');
        setThirtyThreeMailTemplate(data.thirtyThreeMailTemplate || '{rnd12}');

        setMailtmEnabled(data.mailtmEnabled || false);

        setIcloudEnabled(data.icloudEnabled || false);
        setIcloudAppleId(data.icloudAppleId || '');

        setEmailGenerationDomain(loadEmailGenerationDomain());

        try {
          setIsLoadingCounter(true);
          const mailStrategy = data.mailStrategy || 'custom';
          const counterStrategy = mailStrategy === 'gmail' ? 'gmail' : 'custom';
          const counter = await getEmailCounter({
            provider: data.provider || 'kiro',
            strategy: counterStrategy,
          });
          if (!cancelled) setEmailCounterState(counter);
        } catch (e) {
          console.error('Failed to load email counter:', e);
          if (!cancelled) setEmailCounterState(0);
        } finally {
          if (!cancelled) setIsLoadingCounter(false);
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
        toast.error(t('settings.loadFailed'), { description: String(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async () => {
    await saveSettingsSlice(
      {
        imapServer: imapServer,
        imapPort: parseInt(imapPort, 10) || 993,
        imapEmail: imapEmail,
        imapUser: imapEmail,
        imapPassword: imapPassword !== SETTINGS_SECRET_MASK ? imapPassword : '',
        addyioEnabled: addyioEnabled,
        // Do NOT auto-save Addy.io token while typing. Use explicit save.
        addyioApiToken: addyioApiToken,
        addyioAliasFormat: addyioAliasFormat,
        addyioDomain: addyioDomain,
        addyioAutoDelete: addyioAutoDelete,
        addyioDefaultRecipientId: addyioDefaultRecipientId,
        addyioDescriptionTemplate: addyioDescriptionTemplate,
        addyioFromName: addyioFromName,
        thirtyThreeMailEnabled: thirtyThreeMailEnabled,
        thirtyThreeMailUsername: thirtyThreeMailUsername,
        thirtyThreeMailDomain: thirtyThreeMailDomain,
        thirtyThreeMailTemplate: thirtyThreeMailTemplate,
        mailtmEnabled: mailtmEnabled,
        icloudEnabled: icloudEnabled,
        icloudAppleId: icloudAppleId,
        // icloudAppPassword saved explicitly via ICloudEmailSection.onSave (secret field)
      },
      'Failed to save settings'
    );
  }, [
    imapServer,
    imapPort,
    imapEmail,
    imapPassword,
    addyioEnabled,
    addyioApiToken,
    addyioAliasFormat,
    addyioDomain,
    addyioAutoDelete,
    addyioDefaultRecipientId,
    addyioDescriptionTemplate,
    addyioFromName,
    thirtyThreeMailEnabled,
    thirtyThreeMailUsername,
    thirtyThreeMailDomain,
    thirtyThreeMailTemplate,
    mailtmEnabled,
    icloudEnabled,
    icloudAppleId,
  ]);

  const debouncedSave = useDebouncedSave(save);

  const validateField = (field: string, value: string) => {
    let error: string | null = null;

    switch (field) {
      case 'imapServer':
        if (value.trim()) {
          error = validateHostname(value);
        }
        break;
      case 'imapPort':
        if (value.trim()) {
          error = validatePort(value);
        }
        break;
      case 'imapEmail':
        if (value.trim()) {
          error = validateEmail(value);
        }
        break;
    }

    setValidationErrors(prev => {
      const next = { ...prev };
      if (error) {
        next[field] = error;
      } else {
        delete next[field];
      }
      return next;
    });
  };

  const handleTestAddyioConnection = useCallback(async () => {
    const tokenToTest = addyioApiTokenDraft || addyioApiToken;
    if (!tokenToTest) {
      setConnectionStatus('error');
      setConnectionMessage('Please enter an API token');
      return;
    }

    setIsTestingConnection(true);
    setConnectionStatus('idle');
    setConnectionMessage('');

    try {
      const tokenDetails = await testAddyioConnection(tokenToTest);
      const [account, domains, recipients] = await Promise.all([
        getAddyioAccount(tokenToTest),
        getAddyioDomains(tokenToTest),
        getAddyioRecipients(tokenToTest),
      ]);

      setAddyioAccountInfo(account);
      setAddyioDomains(domains.data);
      setAddyioRecipients(recipients);

      if (!addyioDomain && domains.defaultAliasDomain) {
        setAddyioDomain(domains.defaultAliasDomain);
      }

      if (!addyioDefaultRecipientId && account.defaultRecipientId) {
        setAddyioDefaultRecipientId(account.defaultRecipientId);
      }

      setConnectionStatus('success');
      setConnectionMessage(`Connected successfully! Token: ${tokenDetails.name}`);

      addLog({
        level: 'success',
        message: 'Addy.io connection test successful',
        source: 'settings',
      });
    } catch (error) {
      setConnectionStatus('error');
      setConnectionMessage(error instanceof Error ? error.message : 'Connection failed');
      addLog({
        level: 'error',
        message: `Addy.io connection test failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        source: 'settings',
      });
    } finally {
      setIsTestingConnection(false);
    }
  }, [addyioApiTokenDraft, addyioApiToken, addyioDomain, addyioDefaultRecipientId, addLog]);

  const handleSaveAddyioApiToken = useCallback(async () => {
    const ok = await saveSettingsSlice(
      { addyioApiToken: addyioApiTokenDraft },
      'Failed to save Addy.io token'
    );
    if (ok) {
      setAddyioApiToken(addyioApiTokenDraft);
    }
  }, [addyioApiTokenDraft]);

  const handleEmailCounterChange = useCallback(
    async (newCounter: number) => {
      setEmailCounterState(newCounter);
      try {
        const settings = await getSettings();
        const mailStrategy = settings.mailStrategy || 'custom';
        const counterStrategy = mailStrategy === 'gmail' ? 'gmail' : 'custom';

        await setEmailCounter({
          provider: settings.provider || 'kiro',
          strategy: counterStrategy,
          counter: newCounter,
        });
        addLog({
          level: 'success',
          message: `Email counter updated to ${newCounter}`,
          source: 'settings',
        });
      } catch (error) {
        console.error('Failed to update email counter:', error);
        addLog({
          level: 'error',
          message: `Failed to update email counter: ${error instanceof Error ? error.message : 'Unknown error'}`,
          source: 'settings',
        });
      }
    },
    [addLog]
  );

  const handleICloudSave = useCallback(async () => {
    await updateSettings({
      icloudEnabled: true,
      icloudAppleId: icloudAppleId,
      icloudAppPassword: icloudAppPassword,
    });
  }, [icloudAppleId, icloudAppPassword]);

  return {
    mailTab,
    setMailTab,
    showPassword,
    setShowPassword,
    imapServer,
    setImapServer,
    imapPort,
    setImapPort,
    imapEmail,
    setImapEmail,
    imapPassword,
    setImapPassword,
    emailGenerationDomain,
    setEmailGenerationDomain,
    addyioEnabled,
    setAddyioEnabled,
    addyioApiToken,
    addyioApiTokenDraft,
    setAddyioApiTokenDraft,
    addyioAliasFormat,
    setAddyioAliasFormat,
    addyioDomain,
    setAddyioDomain,
    addyioAutoDelete,
    setAddyioAutoDelete,
    addyioDefaultRecipientId,
    setAddyioDefaultRecipientId,
    addyioDescriptionTemplate,
    setAddyioDescriptionTemplate,
    addyioFromName,
    setAddyioFromName,
    thirtyThreeMailEnabled,
    setThirtyThreeMailEnabled,
    thirtyThreeMailUsername,
    setThirtyThreeMailUsername,
    thirtyThreeMailDomain,
    setThirtyThreeMailDomain,
    thirtyThreeMailTemplate,
    setThirtyThreeMailTemplate,
    mailtmEnabled,
    setMailtmEnabled,
    icloudEnabled,
    setIcloudEnabled,
    icloudAppleId,
    setIcloudAppleId,
    icloudAppPassword,
    setIcloudAppPassword,
    addyioDomains,
    addyioRecipients,
    addyioAccountInfo,
    isTestingConnection,
    connectionStatus,
    setConnectionStatus,
    connectionMessage,
    emailCounter,
    isLoadingCounter,
    validationErrors,
    debouncedSave,
    validateField,
    handleTestAddyioConnection,
    handleSaveAddyioApiToken,
    handleEmailCounterChange,
    handleICloudSave,
  };
}
