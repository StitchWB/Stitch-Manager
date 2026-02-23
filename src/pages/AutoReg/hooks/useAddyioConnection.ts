import { useState, useCallback, useEffect } from 'react';
import { useRegistrationStore } from '../../../stores/registration';
import {
  testAddyioConnection,
  getAddyioAccount,
  getAddyioDomains,
} from '../../../lib/tauri';
import { t } from '../../../lib/i18n';

interface UseAddyioConnectionProps {
  addyioApiToken?: string;
  addyioDomain?: string;
  addyioDefaultRecipientId?: string;
  onConfigUpdate: (updates: any) => void;
}

export const useAddyioConnection = ({
  addyioApiToken,
  addyioDomain,
  addyioDefaultRecipientId,
  onConfigUpdate,
}: UseAddyioConnectionProps) => {
  const { addLog } = useRegistrationStore();

  const [addyioDomains, setAddyioDomains] = useState<string[]>([]);
  const [addyioAccountInfo, setAddyioAccountInfo] = useState<any>(null);
  const [isTestingAddyio, setIsTestingAddyio] = useState(false);
  const [addyioConnectionStatus, setAddyioConnectionStatus] = useState<
    'idle' | 'success' | 'error'
  >('idle');
  const [addyioConnectionMessage, setAddyioConnectionMessage] = useState('');

  const handleTestAddyioConnection = useCallback(async () => {
    console.log('[ADDYIO] handleTestAddyioConnection called');
    console.log('[ADDYIO] API token:', addyioApiToken ? '***set***' : 'empty');

    if (!addyioApiToken) {
      console.error('[ADDYIO] No API token configured');
      setAddyioConnectionStatus('error');
      setAddyioConnectionMessage(t('autoReg.addyio.connectionError'));
      return;
    }

    setIsTestingAddyio(true);
    setAddyioConnectionStatus('idle');
    setAddyioConnectionMessage('');

    try {
      console.log('[ADDYIO] Testing token validity...');
      // Test token validity
      const tokenDetails = await testAddyioConnection(addyioApiToken);
      console.log('[ADDYIO] Token valid:', tokenDetails.name);

      console.log('[ADDYIO] Fetching account, domains, recipients...');
      // Fetch account info and domains
      const [account, domains] = await Promise.all([
        getAddyioAccount(addyioApiToken),
        getAddyioDomains(addyioApiToken),
      ]);

      console.log('[ADDYIO] ===== RAW API RESPONSE =====');
      console.log('[ADDYIO] Received domains object:', domains);
      console.log('[ADDYIO] domains.data:', domains.data);
      console.log('[ADDYIO] domains.data type:', typeof domains.data);
      console.log('[ADDYIO] domains.data is array:', Array.isArray(domains.data));
      console.log('[ADDYIO] domains.data length:', domains.data?.length);
      console.log('[ADDYIO] domains.sharedDomains:', domains.sharedDomains);
      console.log('[ADDYIO] domains.defaultAliasDomain:', domains.defaultAliasDomain);
      console.log('[ADDYIO] ===========================');

      console.log('[ADDYIO] Setting state...');

      setAddyioAccountInfo(account);

      const domainsToSet = domains.data || [];
      console.log('[ADDYIO] About to call setAddyioDomains with:', domainsToSet);
      console.log('[ADDYIO] domainsToSet is array:', Array.isArray(domainsToSet));
      console.log('[ADDYIO] domainsToSet length:', domainsToSet.length);

      setAddyioDomains(domainsToSet);

      console.log('[ADDYIO] setAddyioDomains called (state update is async)');

      // Update config with defaults if not set
      const updates: any = {};
      if (!addyioDomain && domains.defaultAliasDomain) {
        updates.addyioDomain = domains.defaultAliasDomain;
      }
      if (!addyioDefaultRecipientId && account.defaultRecipientId) {
        updates.addyioDefaultRecipientId = account.defaultRecipientId;
      }
      if (Object.keys(updates).length > 0) {
        onConfigUpdate(updates);
      }

      setAddyioConnectionStatus('success');
      setAddyioConnectionMessage(
        t('autoReg.addyio.connectionSuccess').replace('{tokenName}', tokenDetails.name)
      );

      addLog({ level: 'success', message: 'Addy.io connection test successful' });
    } catch (error) {
      setAddyioConnectionStatus('error');
      setAddyioConnectionMessage(error instanceof Error ? error.message : 'Connection failed');
      addLog({
        level: 'error',
        message: `Addy.io connection test failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setIsTestingAddyio(false);
    }
  }, [
    addyioApiToken,
    addyioDomain,
    addyioDefaultRecipientId,
    onConfigUpdate,
    addLog,
  ]);

  // Monitor addyioDomains state changes for debugging
  useEffect(() => {
    console.log('[ADDYIO] addyioDomains state changed:', addyioDomains);
    console.log('[ADDYIO] addyioDomains.length:', addyioDomains.length);
    console.log('[ADDYIO] Is array:', Array.isArray(addyioDomains));
  }, [addyioDomains]);

  return {
    addyioDomains,
    addyioAccountInfo,
    isTestingAddyio,
    addyioConnectionStatus,
    addyioConnectionMessage,
    handleTestAddyioConnection,
  };
};
