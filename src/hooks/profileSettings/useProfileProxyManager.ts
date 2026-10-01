import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';
import type { ProfileSettingsProxy, ProfileSettingsV1 } from '@/lib/backend/modules/profiles';
import {
  listProxyLibrary,
  createOrGetProxyLibraryEntry,
  parseProxyLibraryInput,
  testProxyLibraryDraft,
  type ProxyLibraryDraft,
  type ProxyLibraryEntry,
} from '@/lib/backend/modules/proxyLibrary';

interface UseProfileProxyManagerParams {
  alias: string | null;
  isOpen: boolean;
  draft: ProfileSettingsV1;
  patchProxy: (patch: Partial<ProfileSettingsProxy>) => void;
}

export function useProfileProxyManager({
  alias,
  isOpen,
  draft,
  patchProxy,
}: UseProfileProxyManagerParams) {
  const [proxyLibrary, setProxyLibrary] = useState<ProxyLibraryEntry[]>([]);
  const [proxyLibraryLoading, setProxyLibraryLoading] = useState(false);
  const [addProxyModalOpen, setAddProxyModalOpen] = useState(false);
  const [addProxyInput, setAddProxyInput] = useState('');
  const [addProxyDraft, setAddProxyDraft] = useState<ProxyLibraryDraft | null>(null);
  const [addProxyParsing, setAddProxyParsing] = useState(false);
  const [addProxyTesting, setAddProxyTesting] = useState(false);
  const [addProxySaving, setAddProxySaving] = useState(false);
  const [addProxyError, setAddProxyError] = useState<string | null>(null);
  const [addProxyTestResult, setAddProxyTestResult] = useState<string | null>(null);
  const [addProxyParsed, setAddProxyParsed] = useState(false);
  const [addProxyLastTestOk, setAddProxyLastTestOk] = useState(false);
  const [requireProxyTestBeforeSave, setRequireProxyTestBeforeSave] = useState(true);
  const [selectedProxyTesting, setSelectedProxyTesting] = useState(false);
  const [selectedProxyTestResult, setSelectedProxyTestResult] = useState<string | null>(null);
  const [selectedProxyTestError, setSelectedProxyTestError] = useState<string | null>(null);

  const proxyLibraryId = draft.network.proxy?.proxyLibraryId?.trim() || '';
  const selectedLibraryProxy = proxyLibrary.find(item => item.id === proxyLibraryId) ?? null;

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    const loadProxyLibrary = async () => {
      setProxyLibraryLoading(true);
      try {
        const items = await listProxyLibrary();
        if (!cancelled) {
          setProxyLibrary(items.filter(item => item.enabled));
        }
      } catch {
        if (!cancelled) {
          setProxyLibrary([]);
        }
      } finally {
        if (!cancelled) setProxyLibraryLoading(false);
      }
    };

    void loadProxyLibrary();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const openAddProxyModal = () => {
    setAddProxyModalOpen(true);
    setAddProxyInput('');
    setAddProxyDraft(null);
    setAddProxyError(null);
    setAddProxyTestResult(null);
    setAddProxyParsed(false);
    setAddProxyLastTestOk(false);
    setRequireProxyTestBeforeSave(true);
  };

  const runSelectedProxyTest = async (options?: {
    persistResult?: boolean;
    setUiState?: boolean;
  }): Promise<{ ok: boolean; message?: string }> => {
    const selectedId = draft.network.proxy?.proxyLibraryId?.trim() ?? '';
    if (!selectedId) {
      const message = t('profileProxy.addProxyTestRequiredMessage');
      if (options?.setUiState) {
        setSelectedProxyTestError(message);
        setSelectedProxyTestResult(null);
      }
      return { ok: false, message };
    }

    const selectedProxy = proxyLibrary.find(item => item.id === selectedId) ?? null;
    if (!selectedProxy) {
      const message = t('profileProxy.addProxyTestRequiredMessage');
      if (options?.setUiState) {
        setSelectedProxyTestError(message);
        setSelectedProxyTestResult(null);
      }
      return { ok: false, message };
    }

    if (options?.setUiState) {
      setSelectedProxyTesting(true);
      setSelectedProxyTestError(null);
      setSelectedProxyTestResult(null);
    }

    try {
      const result = await testProxyLibraryDraft(
        {
          label: selectedProxy.label,
          host: selectedProxy.host,
          port: selectedProxy.port,
          username: selectedProxy.username ?? null,
          password: selectedProxy.password ?? null,
          proxyType: selectedProxy.proxyType,
          enabled: selectedProxy.enabled,
          notes: selectedProxy.notes ?? null,
        },
        {
          proxyLibraryId: selectedId,
          persistResult: options?.persistResult ?? true,
        }
      );

      if (result.success) {
        const message = `${t('profileProxy.testOk')}${
          result.responseTimeMs != null ? ` • ${result.responseTimeMs}ms` : ''
        }${result.ip ? ` • ${result.ip}` : ''}${result.location ? ` • ${result.location}` : ''}`;

        if (options?.setUiState) {
          setSelectedProxyTestResult(message);
          setSelectedProxyTestError(null);
        }

        return { ok: true, message };
      }

      const message = `${t('profileProxy.testFail')}${result.error ? ` • ${result.error}` : ''}`;
      if (options?.setUiState) {
        setSelectedProxyTestResult(message);
        setSelectedProxyTestError(null);
      }
      return { ok: false, message };
    } catch (e) {
      const message = e instanceof Error ? e.message : t('profileProxy.addProxyTestError');
      if (options?.setUiState) {
        setSelectedProxyTestError(message);
        setSelectedProxyTestResult(null);
      }
      return { ok: false, message };
    } finally {
      if (options?.setUiState) {
        setSelectedProxyTesting(false);
      }
    }
  };

  const handleTestSelectedProxy = async () => {
    await runSelectedProxyTest({
      persistResult: true,
      setUiState: true,
    });
  };

  const normalizeProxyDraft = (draftArg: ProxyLibraryDraft): ProxyLibraryDraft => ({
    ...draftArg,
    label: draftArg.label?.trim() || `${alias ?? 'profile'} proxy`,
    host: draftArg.host.trim(),
    port: Number(draftArg.port),
    username: draftArg.username?.trim() || null,
    password: draftArg.password?.trim() || null,
    notes: draftArg.notes?.trim() || null,
  });

  const handleParseAddProxyInput = async () => {
    if (!addProxyInput.trim()) return;
    setAddProxyParsing(true);
    setAddProxyError(null);
    setAddProxyTestResult(null);
    setAddProxyLastTestOk(false);

    try {
      const parsed = await parseProxyLibraryInput({ raw: addProxyInput.trim() });
      if (!parsed.host || !parsed.port) {
        setAddProxyError(t('profileProxy.addProxyParseError'));
        return;
      }
      setAddProxyDraft({
        ...parsed,
        label: parsed.label || `${alias ?? 'profile'} proxy`,
        enabled: true,
      });
      setAddProxyParsed(true);
    } catch (e) {
      setAddProxyError(e instanceof Error ? e.message : t('profileProxy.addProxyParseError'));
    } finally {
      setAddProxyParsing(false);
    }
  };

  const handleTestAddProxyDraft = async () => {
    if (!addProxyDraft) return;
    setAddProxyTesting(true);
    setAddProxyError(null);
    setAddProxyTestResult(null);
    setAddProxyLastTestOk(false);

    try {
      const result = await testProxyLibraryDraft(normalizeProxyDraft(addProxyDraft));
      if (result.success) {
        setAddProxyLastTestOk(true);
        setAddProxyTestResult(
          `${t('profileProxy.testOk')}${result.responseTimeMs != null ? ` • ${result.responseTimeMs}ms` : ''}${
            result.ip ? ` • ${result.ip}` : ''
          }${result.location ? ` • ${result.location}` : ''}`
        );
      } else {
        setAddProxyTestResult(
          `${t('profileProxy.testFail')}${result.error ? ` • ${result.error}` : ''}`
        );
      }
    } catch (e) {
      setAddProxyError(e instanceof Error ? e.message : t('profileProxy.addProxyTestError'));
    } finally {
      setAddProxyTesting(false);
    }
  };

  const handleSaveAndUseAddProxy = async () => {
    if (!addProxyDraft) return;
    if (requireProxyTestBeforeSave && !addProxyLastTestOk) {
      setAddProxyError(t('profileProxy.addProxyTestRequiredMessage'));
      return;
    }

    setAddProxySaving(true);
    setAddProxyError(null);
    try {
      if (addProxyLastTestOk && addProxyDraft) {
        const optimisticDraft = normalizeProxyDraft(addProxyDraft);
        const optimistic = await testProxyLibraryDraft(optimisticDraft);
        if (!optimistic.success) {
          setAddProxyError(t('profileProxy.addProxyTestRequiredMessage'));
          return;
        }
      }

      const entry = await createOrGetProxyLibraryEntry(normalizeProxyDraft(addProxyDraft));

      const testResult = await testProxyLibraryDraft(normalizeProxyDraft(addProxyDraft), {
        proxyLibraryId: entry.id,
        persistResult: true,
      });

      if (requireProxyTestBeforeSave && !testResult.success) {
        setAddProxyError(t('profileProxy.addProxyTestRequiredMessage'));
        return;
      }

      const items = await listProxyLibrary();
      setProxyLibrary(items.filter(item => item.enabled));

      patchProxy({
        enabled: true,
        proxyLibraryId: entry.id,
      });
      setAddProxyModalOpen(false);
      toast.success(t('profileProxy.addProxySuccess'));
    } catch (e) {
      setAddProxyError(e instanceof Error ? e.message : t('profileProxy.addProxySaveError'));
    } finally {
      setAddProxySaving(false);
    }
  };

  return {
    proxyLibrary,
    proxyLibraryLoading,
    addProxyModalOpen,
    addProxyInput,
    addProxyDraft,
    addProxyParsing,
    addProxyTesting,
    addProxySaving,
    addProxyError,
    addProxyTestResult,
    addProxyParsed,
    addProxyLastTestOk,
    requireProxyTestBeforeSave,
    selectedProxyTesting,
    selectedProxyTestResult,
    selectedProxyTestError,
    selectedLibraryProxy,
    setAddProxyModalOpen,
    setAddProxyInput,
    setAddProxyDraft,
    setAddProxyError,
    setAddProxyTestResult,
    setAddProxyParsed,
    setAddProxyLastTestOk,
    setRequireProxyTestBeforeSave,
    openAddProxyModal,
    handleTestSelectedProxy,
    handleParseAddProxyInput,
    handleTestAddProxyDraft,
    handleSaveAndUseAddProxy,
    normalizeProxyDraft,
  };
}
