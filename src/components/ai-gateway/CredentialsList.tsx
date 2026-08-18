import { useEffect, useState } from 'react';
import { Plus, Trash2, Key, CheckCircle2, XCircle, AlertCircle, Zap, RotateCw } from 'lucide-react';
import { useAiGatewayStore } from '@/stores/aiGateway';
import type { Credential, ProviderEndpoint } from '@/lib/backend/modules/aiGateway';
import { testCredentialConnection } from '@/lib/backend/modules/aiGateway';
import { Button, Badge } from '@/components/ui';
import { appToast } from '@/lib/observability/toast';
import { t } from '@/lib/i18n';

interface CredentialsListProps {
  endpoint: ProviderEndpoint;
  onAddCredential: () => void;
  onEditCredential: (credential: Credential) => void;
}

export function CredentialsList({ endpoint, onAddCredential, onEditCredential }: CredentialsListProps) {
  const { credentials, loading, errors, fetchCredentials, deleteCredential } = useAiGatewayStore();
  const [testingId, setTestingId] = useState<string | null>(null);

  useEffect(() => {
    fetchCredentials(endpoint.id);
  }, [endpoint.id, fetchCredentials]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Delete this credential?')) {
      await deleteCredential(id);
    }
  };

  const handleTest = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setTestingId(id);
    try {
      const result = await testCredentialConnection(id);
      if (result.success) {
        appToast.success(
          `Connection OK${result.latency_ms != null ? ` (${Math.round(result.latency_ms)}ms)` : ''}`,
          'ai-gateway'
        );
      } else {
        appToast.error(result.error || t('aiGateway.cred.connectionFailed'), 'ai-gateway');
      }
    } catch (e) {
      appToast.error(e instanceof Error ? e.message : t('aiGateway.cred.testFailed'), 'ai-gateway');
    } finally {
      setTestingId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge variant="success">{t('aiGateway.status.active')}</Badge>;
      case 'cooldown':
        return <Badge variant="warning">{t('aiGateway.status.cooldown')}</Badge>;
      case 'rate_limited':
        return <Badge variant="warning">{t('aiGateway.status.rateLimited')}</Badge>;
      case 'quota_exhausted':
        return <Badge variant="danger">{t('aiGateway.status.quotaExhausted')}</Badge>;
      case 'auth_failed':
        return <Badge variant="danger">{t('aiGateway.status.authFailed')}</Badge>;
      case 'degraded':
        return <Badge variant="warning">{t('aiGateway.status.degraded')}</Badge>;
      case 'disabled':
        return <Badge variant="default">{t('aiGateway.status.disabled')}</Badge>;
      default:
        return <Badge variant="outline">{t('aiGateway.status.unknown')}</Badge>;
    }
  };

  if (loading.credentials) {
    return <div className="p-4 text-center text-slate-400">{t('aiGateway.list.loadingCredentials')}</div>;
  }

  if (errors.credentials) {
    return (
      <div className="p-4 text-center text-red-400">
        <div className="mb-2">{t('aiGateway.list.error')}: {errors.credentials}</div>
        <Button size="sm" variant="outline" onClick={() => fetchCredentials(endpoint.id)}>
          <RotateCw className="h-4 w-4 mr-2" />{t('aiGateway.list.retry')}
        </Button>
      </div>
    );
  }

  if (credentials.length === 0) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-lg p-8 text-center">
        <Key className="mx-auto h-12 w-12 text-slate-400 mb-4" />
        <h3 className="text-lg font-semibold mb-2">{t('aiGateway.list.noCredentials')}</h3>
        <p className="text-slate-400 mb-4">{t('aiGateway.list.noCredentialsDesc')}</p>
        <Button onClick={onAddCredential}><Plus className="h-4 w-4 mr-2" />{t('aiGateway.cred.addTitle')}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">{t('aiGateway.list.credentialsTitle')} ({credentials.length})</h3>
        <Button size="sm" onClick={onAddCredential}><Plus className="h-4 w-4 mr-2" />{t('aiGateway.cred.addTitle')}</Button>
      </div>

      {credentials.map(credential => (
        <div
          key={credential.id}
          className="bg-white/5 border border-white/10 rounded-lg p-4 cursor-pointer hover:bg-white/10 transition-colors"
          onClick={() => onEditCredential(credential)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1">
              <Key className="h-5 w-5 text-slate-400" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="font-medium truncate">
                    {credential.label || credential.fingerprint.slice(0, 16)}
                  </h4>
                  {getStatusBadge(credential.runtimeStatus)}
                  {credential.enabled ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-400" />
                  )}
                </div>
                <div className="text-sm text-slate-400">
                  {credential.authType} • {credential.fingerprint.slice(0, 32)}...
                  {credential.consecutiveFailures > 0 && (
                    <span className="ml-2 text-amber-400">
                      <AlertCircle className="h-3 w-3 inline mr-1" />
                      {t('aiGateway.list.failures', { count: credential.consecutiveFailures })}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                isLoading={testingId === credential.id}
                onClick={e => handleTest(e, credential.id)}
              >
                {testingId !== credential.id && <Zap className="h-4 w-4" />}
                {testingId === credential.id ? 'Testing...' : 'Test'}
              </Button>
              <Button size="sm" variant="ghost" onClick={e => handleDelete(e, credential.id)}>
                <Trash2 className="h-4 w-4 text-red-400" />
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
