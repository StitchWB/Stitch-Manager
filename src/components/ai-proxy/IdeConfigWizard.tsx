import { useState, useEffect, useCallback } from 'react';
import { X, Check, AlertCircle, Copy, RefreshCw } from 'lucide-react';

import {
  detectAiProxyIdes,
  configureAiProxyIdeForProvider,
  getAiProxyIdeConfigPreviewForProvider,
  restoreAiProxyIdeConfig,
  getProxyStatus,
  getAvailableModels,
  startAiProxy,
  getProxySettings,
  autoImportAiProxyAuthFiles,
  type AuthImportResult,
} from '../../lib/tauri/modules/aiProxy';
import {
  DEFAULT_PROVIDER_PROFILE_KEY,
  PROVIDER_PROFILES,
  type ProviderKey,
  buildManualEnvPayload,
  getProviderProfile,
} from '../../lib/providering';
import { t } from '@/lib/i18n';
import { Button, ButtonBase, Select } from '@/components/ui';

// Type definition for AI Proxy detected IDE
interface AiProxyDetectedIde {
  name: string;
  displayName: string;
  path: string;
  configPath: string;
  installed: boolean;
  configured: boolean;
}

interface IdeConfigWizardProps {
  isOpen: boolean;
  onClose: () => void;
}

type WizardStep = 'detect' | 'select' | 'preview' | 'apply' | 'complete';

interface ConfigResult {
  ideName: string;
  success: boolean;
  action: 'configured' | 'restored';
  verifiedConfigured?: boolean;
  smokeChecked?: boolean;
  smokePassed?: boolean;
  smokeMessage?: string;
  error?: string;
}

interface SmokeCheckResult {
  ideName: string;
  smokeChecked: boolean;
  smokePassed: boolean;
  smokeMessage: string;
}

const isOpenCodeIde = (ide: AiProxyDetectedIde): boolean => ide.name === 'opencode';

export function IdeConfigWizard({ isOpen, onClose }: IdeConfigWizardProps) {
  const [step, setStep] = useState<WizardStep>('detect');
  const [ides, setIdes] = useState<AiProxyDetectedIde[]>([]);
  const [selectedIdes, setSelectedIdes] = useState<Set<string>>(new Set());
  const [configPreview, setConfigPreview] = useState<string>('');
  const [results, setResults] = useState<ConfigResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proxyRunning, setProxyRunning] = useState<boolean | null>(null);
  const [autoCheckInProgress, setAutoCheckInProgress] = useState(false);
  const [manualEndpoint, setManualEndpoint] = useState('http://127.0.0.1:8317/v1');
  const [providerKey, setProviderKey] = useState<ProviderKey>(DEFAULT_PROVIDER_PROFILE_KEY);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [autoImportInProgress, setAutoImportInProgress] = useState(false);
  const [autoImportResult, setAutoImportResult] = useState<AuthImportResult | null>(null);

  const detectIDEs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [detected, status, proxySettings] = await Promise.all([
        detectAiProxyIdes(),
        getProxyStatus(),
        getProxySettings(),
      ]);
      setIdes(detected);
      setProxyRunning(status.running);
      setManualEndpoint(`http://127.0.0.1:${proxySettings.proxyPort}/v1`);
      setStep('select');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiHub.wizard.errors.detectFailed'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && step === 'detect') {
      void detectIDEs();
    }
  }, [isOpen, step, detectIDEs]);

  const refreshIdeStates = async () => {
    const [detected, status] = await Promise.all([detectAiProxyIdes(), getProxyStatus()]);
    setIdes(detected);
    setProxyRunning(status.running);
    return detected;
  };

  const evaluateSmokeChecks = async (ideNames: string[]): Promise<SmokeCheckResult[]> => {
    const [status, refreshedIdes, models] = await Promise.all([
      getProxyStatus(),
      detectAiProxyIdes(),
      getAvailableModels(),
    ]);

    setIdes(refreshedIdes);
    setProxyRunning(status.running);

    return ideNames.map(ideName => {
      const ide = refreshedIdes.find(item => item.name === ideName);
      const configured = ide?.configured === true;
      const running = status.running;
      const hasModels = models.length > 0;

      let smokePassed = true;
      let smokeMessage = t('aiHub.wizard.smoke.passed');

      if (!configured) {
        smokePassed = false;
        smokeMessage = t('aiHub.wizard.smoke.notConfigured');
      } else if (!running) {
        smokePassed = false;
        smokeMessage = t('aiHub.wizard.smoke.proxyNotRunning');
      } else if (!hasModels) {
        smokePassed = false;
        smokeMessage = t('aiHub.wizard.smoke.noModels');
      }

      return {
        ideName,
        smokeChecked: true,
        smokePassed,
        smokeMessage,
      };
    });
  };

  const applySmokeResults = (smokeResults: SmokeCheckResult[]) => {
    const smokeMap = new Map(smokeResults.map(result => [result.ideName, result]));
    setResults(prev =>
      prev.map(result => {
        const smoke = smokeMap.get(result.ideName);
        if (!smoke) return result;
        return {
          ...result,
          smokeChecked: smoke.smokeChecked,
          smokePassed: smoke.smokePassed,
          smokeMessage: smoke.smokeMessage,
        };
      })
    );
  };

  const toggleIdeSelection = (ideName: string) => {
    const newSelection = new Set(selectedIdes);
    if (newSelection.has(ideName)) {
      newSelection.delete(ideName);
    } else {
      newSelection.add(ideName);
    }
    setSelectedIdes(newSelection);
  };

  const showPreview = async () => {
    if (selectedIdes.size === 0) return;

    setIsLoading(true);
    setError(null);
    try {
      // Get preview for first selected IDE
      const firstIde = Array.from(selectedIdes)[0];
      const preview = await getAiProxyIdeConfigPreviewForProvider(firstIde, providerKey);
      setConfigPreview(preview);
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiHub.wizard.errors.previewFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const applyConfiguration = async () => {
    setIsLoading(true);
    setError(null);
    setStep('apply');

    const configResults: ConfigResult[] = [];

    for (const ideName of selectedIdes) {
      const ide = ides.find(i => i.name === ideName);
      if (!ide) continue;

      try {
        await configureAiProxyIdeForProvider(ideName, ide.configPath, providerKey);
        configResults.push({ ideName, success: true, action: 'configured' });
      } catch (err) {
        configResults.push({
          ideName,
          success: false,
          action: 'configured',
          error: err instanceof Error ? err.message : t('aiHub.wizard.errors.configurationFailed'),
        });
      }
    }

    const refreshed = await refreshIdeStates();
    const refreshedByName = new Map(refreshed.map(ide => [ide.name, ide]));

    setResults(
      configResults.map(result => ({
        ...result,
        verifiedConfigured: refreshedByName.get(result.ideName)?.configured,
      }))
    );

    setIsLoading(false);
    setStep('complete');

    const successfulIdeNames = configResults
      .filter(result => result.success)
      .map(result => result.ideName);
    if (successfulIdeNames.length > 0) {
      setAutoCheckInProgress(true);
      try {
        const smokeResults = await evaluateSmokeChecks(successfulIdeNames);
        applySmokeResults(smokeResults);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('aiHub.wizard.errors.autoSmokeFailed'));
      } finally {
        setAutoCheckInProgress(false);
      }
    }
  };

  const restoreConfiguration = async (ideName: string) => {
    const ide = ides.find(item => item.name === ideName);
    if (!ide) return;

    setIsLoading(true);
    setError(null);

    try {
      await restoreAiProxyIdeConfig(ide.configPath);

      const refreshed = await refreshIdeStates();
      const refreshedIde = refreshed.find(item => item.name === ideName);

      setResults(prev => {
        const existingIndex = prev.findIndex(result => result.ideName === ideName);
        const nextEntry: ConfigResult = {
          ideName,
          success: true,
          action: 'restored',
          verifiedConfigured: refreshedIde?.configured,
        };

        if (existingIndex >= 0) {
          const next = [...prev];
          next[existingIndex] = nextEntry;
          return next;
        }

        return [...prev, nextEntry];
      });
    } catch (err) {
      setResults(prev => {
        const existingIndex = prev.findIndex(result => result.ideName === ideName);
        const nextEntry: ConfigResult = {
          ideName,
          success: false,
          action: 'restored',
          error: err instanceof Error ? err.message : t('aiHub.wizard.errors.restoreFailed'),
        };

        if (existingIndex >= 0) {
          const next = [...prev];
          next[existingIndex] = nextEntry;
          return next;
        }

        return [...prev, nextEntry];
      });
    } finally {
      setIsLoading(false);
    }
  };

  const runConnectivitySmokeCheck = async (ideName: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const smokeResults = await evaluateSmokeChecks([ideName]);
      applySmokeResults(smokeResults);
    } catch (err) {
      setResults(prev =>
        prev.map(result =>
          result.ideName === ideName
            ? {
                ...result,
                smokeChecked: true,
                smokePassed: false,
                smokeMessage:
                  err instanceof Error ? err.message : t('aiHub.wizard.errors.smokeFailed'),
              }
            : result
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartProxyFromWizard = async () => {
    setIsLoading(true);
    setError(null);

    try {
      await startAiProxy();
      const successfulIdeNames = results
        .filter(result => result.success)
        .map(result => result.ideName);
      if (successfulIdeNames.length > 0) {
        const smokeResults = await evaluateSmokeChecks(successfulIdeNames);
        applySmokeResults(smokeResults);
      } else {
        await refreshIdeStates();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiHub.wizard.errors.startProxyFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(configPreview);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleClose = () => {
    setStep('detect');
    setSelectedIdes(new Set());
    setConfigPreview('');
    setResults([]);
    setError(null);
    setAutoCheckInProgress(false);
    setCopyStatus(null);
    onClose();
  };

  const copyManualSetup = async () => {
    try {
      const provider = getProviderProfile(providerKey);
      const payload = buildManualEnvPayload(manualEndpoint, provider.key);
      await navigator.clipboard.writeText(payload);
      setCopyStatus(t('aiHub.wizard.manual.copied'));
      setTimeout(() => setCopyStatus(null), 2000);
    } catch (err) {
      setCopyStatus(err instanceof Error ? err.message : t('aiHub.wizard.manual.copyFailed'));
      setTimeout(() => setCopyStatus(null), 3000);
    }
  };

  const runAutoImport = async (dryRun: boolean) => {
    setAutoImportInProgress(true);
    setError(null);
    try {
      const result = await autoImportAiProxyAuthFiles(dryRun);
      setAutoImportResult(result);
      if (!dryRun && result.imported > 0) {
        await refreshIdeStates();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiHub.wizard.errors.autoImportFailed'));
    } finally {
      setAutoImportInProgress(false);
    }
  };

  if (!isOpen) return null;

  const installedIdes = ides.filter(ide => ide.installed);
  const canProceed = selectedIdes.size > 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-vsc-sidebar border border-vsc-border rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-vsc-border">
          <h2 className="text-lg font-semibold text-vsc-text">{t('aiHub.wizard.title')}</h2>
          <ButtonBase
            type="button"
            onClick={handleClose}
            className="text-vsc-text-muted hover:text-vsc-text transition-colors"
          >
            <X size={20} />
          </ButtonBase>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-4 p-3 bg-vsc-red/10 border border-vsc-red/30 rounded-lg flex items-start gap-2">
              <AlertCircle size={20} className="text-vsc-red flex-shrink-0 mt-0.5" />
              <p className="text-sm text-vsc-red">{error}</p>
            </div>
          )}

          {/* Step 1: Detecting */}
          {step === 'detect' && (
            <div className="text-center py-8">
              <RefreshCw size={48} className="mx-auto mb-4 text-vsc-blue animate-spin" />
              <p className="text-vsc-text">{t('aiHub.wizard.detecting')}</p>
            </div>
          )}

          {/* Step 2: Select IDEs */}
          {step === 'select' && (
            <div>
              <p className="text-sm text-vsc-text-muted mb-4">
                {t('aiHub.wizard.selectDescription')}
              </p>
              {proxyRunning === false && (
                <div className="mb-4 p-3 bg-vsc-yellow/10 border border-vsc-yellow/30 rounded-lg text-xs text-vsc-yellow">
                  {t('aiHub.wizard.proxyStoppedHint')}
                </div>
              )}

              <div className="mb-4 p-3 bg-vsc-sidebar/50 border border-vsc-border rounded-lg">
                <label
                  htmlFor="provider-profile-select"
                  className="block text-xs text-vsc-text-muted mb-2"
                >
                  {t('aiHub.wizard.providerProfile')}
                </label>
                <Select
                  id="provider-profile-select"
                  value={providerKey}
                  onChange={e => setProviderKey(e.target.value as ProviderKey)}
                  className="w-full px-2 py-1.5 bg-vsc-input border border-vsc-border rounded text-xs text-vsc-text"
                  shellClassName="bg-vsc-input border-vsc-border"
                >
                  {PROVIDER_PROFILES.map(option => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                <p className="text-2xs text-vsc-text-muted mt-1">
                  {getProviderProfile(providerKey).description}
                </p>
              </div>

              {installedIdes.length === 0 ? (
                <div className="text-center py-8">
                  <AlertCircle size={48} className="mx-auto mb-4 text-vsc-yellow" />
                  <p className="text-vsc-text mb-2">{t('aiHub.wizard.noIdesTitle')}</p>
                  <p className="text-sm text-vsc-text-muted">{t('aiHub.wizard.noIdesHint')}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {installedIdes.map(ide => (
                    <ButtonBase
                      type="button"
                      key={ide.name}
                      onClick={() => toggleIdeSelection(ide.name)}
                      className={`p-4 border rounded-lg cursor-pointer transition-colors w-full text-left ${
                        selectedIdes.has(ide.name)
                          ? 'border-vsc-blue bg-vsc-blue/10'
                          : 'border-vsc-border hover:border-vsc-border-light'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-5 h-5 rounded border flex items-center justify-center ${
                              selectedIdes.has(ide.name)
                                ? 'bg-vsc-blue border-vsc-blue'
                                : 'border-vsc-border'
                            }`}
                          >
                            {selectedIdes.has(ide.name) && (
                              <Check size={14} className="text-white" />
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-vsc-text font-medium">{ide.displayName}</p>
                              {isOpenCodeIde(ide) && (
                                <span className="text-2xs px-2 py-0.5 rounded border border-vsc-blue/40 bg-vsc-blue/10 text-vsc-blue">{t('aiHub.wizard.opencodeLabel')}</span>
                              )}
                            </div>
                            <p className="text-xs text-vsc-text-muted">{ide.configPath}</p>
                          </div>
                        </div>
                        {ide.configured && (
                          <span className="text-xs px-2 py-1 bg-vsc-green/10 text-vsc-green rounded">
                            {t('aiHub.wizard.alreadyConfigured')}
                          </span>
                        )}
                      </div>
                    </ButtonBase>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Preview */}
          {step === 'preview' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-vsc-text-muted">{t('aiHub.wizard.previewTitle')}</p>
                <Button variant="ghost" onClick={copyToClipboard}>
                  <Copy size={16} />
                  {t('aiHub.actions.copy')}
                </Button>
              </div>
              <pre className="bg-vsc-terminal border border-vsc-border rounded-lg p-4 text-xs text-vsc-text overflow-x-auto">
                {configPreview}
              </pre>
              <p className="text-xs text-vsc-text-muted mt-4">{t('aiHub.wizard.previewHint')}</p>
            </div>
          )}

          {/* Step 4: Applying */}
          {step === 'apply' && (
            <div className="text-center py-8">
              <RefreshCw size={48} className="mx-auto mb-4 text-vsc-blue animate-spin" />
              <p className="text-vsc-text">{t('aiHub.wizard.applying')}</p>
            </div>
          )}

          {/* Step 5: Complete */}
          {step === 'complete' && (
            <div>
              {autoCheckInProgress && (
                <div className="mb-4 p-3 bg-vsc-blue/10 border border-vsc-blue/30 rounded-lg text-xs text-vsc-blue">
                  {t('aiHub.wizard.runningAutoSmoke')}
                </div>
              )}
              <div className="space-y-2 mb-4">
                {results.map(result => {
                  const ide = ides.find(i => i.name === result.ideName);
                  return (
                    <div
                      key={result.ideName}
                      className={`p-4 border rounded-lg ${
                        result.success
                          ? 'border-vsc-green bg-vsc-green/10'
                          : 'border-vsc-red bg-vsc-red/10'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {result.success ? (
                          <Check size={20} className="text-vsc-green flex-shrink-0 mt-0.5" />
                        ) : (
                          <AlertCircle size={20} className="text-vsc-red flex-shrink-0 mt-0.5" />
                        )}
                        <div className="flex-1">
                          <p
                            className={`font-medium ${result.success ? 'text-vsc-green' : 'text-vsc-red'}`}
                          >
                            {ide?.displayName || result.ideName}
                          </p>
                          {ide?.configPath && (
                            <p className="text-2xs text-vsc-text-muted mt-1">{ide.configPath}</p>
                          )}
                          {result.success ? (
                            <p className="text-sm text-vsc-text-muted mt-1">
                              {result.action === 'configured'
                                ? result.verifiedConfigured
                                  ? t('aiHub.wizard.results.configuredVerified')
                                  : t('aiHub.wizard.results.configuredPending')
                                : result.verifiedConfigured === false
                                  ? t('aiHub.wizard.results.restoredVerified')
                                  : t('aiHub.wizard.results.restored')}
                            </p>
                          ) : (
                            <p className="text-sm text-vsc-red">{result.error}</p>
                          )}
                          {result.smokeChecked && (
                            <p
                              className={`text-xs mt-1 ${
                                result.smokePassed ? 'text-vsc-green' : 'text-vsc-yellow'
                              }`}
                            >
                              {result.smokePassed
                                ? t('aiHub.wizard.results.smokeOk')
                                : t('aiHub.wizard.results.smokeAttention')}
                              {result.smokeMessage ? ` — ${result.smokeMessage}` : ''}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {result.success && (
                            <>
                              <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => runConnectivitySmokeCheck(result.ideName)}
                                disabled={isLoading || autoCheckInProgress}
                              >
                                {t('aiHub.wizard.actions.runSmoke')}
                              </Button>
                              <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => restoreConfiguration(result.ideName)}
                                disabled={isLoading || autoCheckInProgress}
                              >
                                {t('aiHub.wizard.actions.restoreBackup')}
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="p-4 bg-vsc-blue/10 border border-vsc-blue/30 rounded-lg">
                <p className="text-sm text-vsc-text mb-2">
                  <strong>{t('aiHub.wizard.nextSteps.title')}</strong>
                </p>
                <ol className="text-sm text-vsc-text-muted space-y-1 list-decimal list-inside">
                  <li>{t('aiHub.wizard.nextSteps.restartIde')}</li>
                  <li>{t('aiHub.wizard.nextSteps.ensureProxy')}</li>
                  <li>{t('aiHub.wizard.nextSteps.runSmoke')}</li>
                  <li>{t('aiHub.wizard.nextSteps.testRequest')}</li>
                </ol>
              </div>

              <div className="mt-3 p-4 bg-vsc-sidebar/50 border border-vsc-border rounded-lg">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-sm text-vsc-text">
                    <strong>{t('aiHub.wizard.manual.title')}</strong>
                  </p>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={copyManualSetup}
                    disabled={isLoading || autoCheckInProgress}
                  >
                    {t('aiHub.wizard.manual.copyButton')}
                  </Button>
                </div>
                <p className="text-xs text-vsc-text-muted mb-2">{t('aiHub.wizard.manual.hint')}</p>
                <div className="text-xs font-mono text-vsc-text bg-vsc-input border border-vsc-border rounded p-2 space-y-1">
                  <div>{t('aiHub.wizard.manual.openaiBaseUrl')}={manualEndpoint}</div>
                  <div>{t('aiHub.wizard.manual.openaiApiKey')}={getProviderProfile(providerKey).defaultApiKey}</div>
                </div>
                {copyStatus && <p className="text-2xs text-vsc-text-muted mt-2">{copyStatus}</p>}
              </div>

              <div className="mt-3 p-4 bg-vsc-sidebar/50 border border-vsc-border rounded-lg">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <p className="text-sm text-vsc-text">
                    <strong>{t('aiHub.wizard.autoImport.title')}</strong>
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => runAutoImport(true)}
                      disabled={autoImportInProgress || isLoading || autoCheckInProgress}
                    >
                      {t('aiHub.wizard.autoImport.dryRun')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => runAutoImport(false)}
                      disabled={autoImportInProgress || isLoading || autoCheckInProgress}
                    >
                      {autoImportInProgress
                        ? t('aiHub.actions.importing')
                        : t('aiHub.wizard.autoImport.importNow')}
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-vsc-text-muted mb-2">
                  {t('aiHub.wizard.autoImport.hint')}
                </p>
                {autoImportResult && (
                  <div className="text-xs text-vsc-text-muted space-y-1">
                    <div>
                      {t('aiHub.wizard.autoImport.modeLabel')}:{' '}
                      <span className="text-vsc-text">
                        {autoImportResult.dryRun
                          ? t('aiHub.wizard.autoImport.modeDryRun')
                          : t('aiHub.wizard.autoImport.modeWrite')}
                      </span>
                    </div>
                    <div>
                      {t('aiHub.wizard.autoImport.scanned')}:{' '}
                      <span className="text-vsc-text">{autoImportResult.scanned}</span> •{' '}
                      {t('aiHub.wizard.autoImport.imported')}:{' '}
                      <span className="text-vsc-green">{autoImportResult.imported}</span> •{' '}
                      {t('aiHub.wizard.autoImport.skipped')}:{' '}
                      <span className="text-vsc-yellow">{autoImportResult.skipped}</span>
                    </div>
                    <div className="max-h-28 overflow-auto bg-vsc-input border border-vsc-border rounded p-2">
                      {autoImportResult.entries.length === 0 ? (
                        <div>{t('aiHub.wizard.autoImport.noDiscovered')}</div>
                      ) : (
                        autoImportResult.entries.slice(0, 20).map((entry, idx) => (
                          <div
                            key={`${entry.provider}-${entry.accountName}-${idx}`}
                            className="mb-1 last:mb-0"
                          >
                            <span className="capitalize text-vsc-text">{entry.provider}</span> /{' '}
                            {entry.accountName} →{' '}
                            <span className="text-vsc-blue">{entry.action}</span> ({entry.message})
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-vsc-border">
          <div className="text-sm text-vsc-text-muted">
            {step === 'select' && `${selectedIdes.size} IDE(s) selected`}
            {step === 'complete' &&
              `${results.filter(r => r.success).length}/${results.length} configured`}
          </div>
          <div className="flex gap-2">
            {step === 'select' && (
              <>
                <Button variant="ghost" onClick={handleClose}>
                  {t('aiHub.actions.cancel')}
                </Button>
                <Button variant="primary" onClick={showPreview} disabled={!canProceed || isLoading}>
                  {t('aiHub.wizard.actions.next')}
                </Button>
              </>
            )}
            {step === 'preview' && (
              <>
                <Button variant="ghost" onClick={() => setStep('select')}>
                  {t('aiHub.wizard.actions.back')}
                </Button>
                <Button variant="primary" onClick={applyConfiguration} disabled={isLoading}>
                  {t('aiHub.wizard.actions.applyConfiguration')}
                </Button>
              </>
            )}
            {step === 'complete' && (
              <>
                {!proxyRunning && (
                  <Button
                    variant="secondary"
                    onClick={handleStartProxyFromWizard}
                    disabled={isLoading || autoCheckInProgress}
                  >
                    {t('aiHub.actions.startProxy')}
                  </Button>
                )}
                <Button variant="primary" onClick={handleClose} disabled={autoCheckInProgress}>
                  {t('aiHub.wizard.actions.done')}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
