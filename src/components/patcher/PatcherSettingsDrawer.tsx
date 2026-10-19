import { useState, useEffect, useCallback } from 'react';
import {
  X,
  Shield,
  Monitor,
  Activity,
  Terminal,
  FileText,
  Copy,
  RefreshCw,
  Plus,
  Save,
  HelpCircle,
  Zap,
  Settings as SettingsIcon,
  Search,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';

import PromptEditor from '../PromptEditor';
import { AiProxySettings } from '../settings/AiProxySettings';
import {
  getKiroPatchConfig,
  saveKiroPatchConfig,
  generateNewMachineId,
  bindMachineIdToAccount,
  unbindAccount,
  listAccounts,
  copyDefaultPrompts,
  getSettings,
  updateSettings,
  startKiroProxy,
  stopKiroProxy,
} from '@/lib/backend';
import { usePatcherStore } from '../../stores/patcher';
import type { KiroPatchConfig } from '../../types/kiro-patch';
import { applyPreset } from '../../types/kiro-patch';
import type { Account } from '../../types/generated';
import type { SettingsData } from '../../types/generated';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import {
  Button,
  ButtonBase,
  Checkbox,
  Input,
  LoadingSpinner,
  SegmentedControl,
  Select,
  Tooltip,
} from '@/components/ui';

const isKiroLogLevel = (value: string): value is KiroPatchConfig['logLevel'] => {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error';
};

interface PatcherSettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigChange?: (config: KiroPatchConfig) => void;
}

export default function PatcherSettingsDrawer({
  isOpen,
  onClose,
  onConfigChange,
}: PatcherSettingsDrawerProps) {
  const [activeTab, setActiveTab] = useState<'kiro' | 'automation'>('kiro');
  const [config, setConfig] = useState<KiroPatchConfig | null>(null);
  const [globalSettings, setGlobalSettings] = useState<Partial<SettingsData>>({});

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<string>('system-prompt');
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [showBindDialog, setShowBindDialog] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [customMachineId, setCustomMachineId] = useState<string>('');

  const { copy } = useCopyToClipboard();
  
  // IDE detection from patcher store
  const { detectedIDEs, scanning, detectIDEs } = usePatcherStore();

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [kiroCfg, globalCfg, accts] = await Promise.all([
        getKiroPatchConfig(),
        getSettings(),
        listAccounts(),
        detectIDEs(), // Detect IDEs on load
      ]);
      setConfig(kiroCfg);
      setGlobalSettings(globalCfg);
      setAccounts(accts);
    } catch (error) {
      console.error('Failed to load config:', error);
      toast.error(t('kiroPatch.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [detectIDEs]);

  useEffect(() => {
    queueMicrotask(() => {
    if (isOpen) {
      loadData();
    }
    });
  }, [isOpen, loadData]);

  const handleSaveKiro = async () => {
    if (!config) return;
    try {
      setIsSaving(true);
      await saveKiroPatchConfig(config);
      toast.success(t('kiroPatch.saveSuccess'));
      onConfigChange?.(config);
    } catch (error) {
      toast.error(t('kiroPatch.saveError'));
      console.error(error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveGlobal = async (updates: Partial<SettingsData>) => {
    try {
      setIsSaving(true);
      const newSettings = { ...globalSettings, ...updates };
      await updateSettings(updates);
      setGlobalSettings(newSettings);
    } catch (error) {
      console.error('Failed to save global settings:', error);
      toast.error(t('settings.failedToSave'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyMachineId = async () => {
    if (!config) return;
    await copy(config.machineId, {
      sensitive: true,
      requireConfirmation: true,
      confirmationMessage:
        'Copy Machine ID to clipboard? This identifier can be sensitive. (Auto-clears in 15s)',
      successMessage: t('kiroPatch.idCopied'),
    });
  };

  const handleGenerateNewMachineId = async () => {
    try {
      const newId = await generateNewMachineId();
      setConfig(prev => (prev ? { ...prev, machineId: newId } : null));
      toast.success(t('kiroPatch.generateSuccess'));
    } catch (error) {
      toast.error(t('common.error'));
      console.error(error);
    }
  };

  const handleBindAccount = async () => {
    if (!selectedAccountId || !customMachineId) {
      toast.error(t('kiroPatch.bindError'));
      return;
    }
    try {
      await bindMachineIdToAccount(selectedAccountId, customMachineId);
      await loadData();
      setShowBindDialog(false);
      setSelectedAccountId('');
      setCustomMachineId('');
      toast.success(t('kiroPatch.bindSuccess'));
    } catch (error) {
      toast.error(t('kiroPatch.bindError'));
      console.error(error);
    }
  };

  const handleUnbindAccount = async (accountId: string) => {
    try {
      await unbindAccount(accountId);
      await loadData();
      toast.success(t('kiroPatch.unbindSuccess'));
    } catch (error) {
      toast.error(t('kiroPatch.unbindError'));
      console.error(error);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <ButtonBase
        type="button"
        aria-label={t('common.cancel')}
        className="fixed inset-0 bg-void-base/60 backdrop-blur-sm z-[45]"
        onClick={onClose}
      />

      <div className="fixed right-0 top-0 bottom-0 w-[580px] bg-vsc-bg border-l border-white/5 z-[50] flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="shrink-0 p-6 flex items-center justify-between bg-white/[0.02] border-b border-white/5">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-[0_0_20px_rgba(99,102,241,0.15)]">
              <SettingsIcon size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">
                {t('patcher.settings')}
              </h2>
              <p className="text-xs text-slate-500 font-medium">{t('patcher.subtitle')}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full h-10 w-10">
            <X size={20} />
          </Button>
        </div>

        {/* Tab Switcher - Unified Design */}
        <div className="px-6 py-4 bg-white/[0.01] border-b border-white/5">
          <SegmentedControl
            options={[
              { label: 'Kiro Config', value: 'kiro', icon: <Monitor size={14} /> },
              {
                label: t('settings.categories.automation'),
                value: 'automation',
                icon: <Zap size={14} />,
              },
            ]}
            value={activeTab}
            onChange={v => setActiveTab(v as 'kiro' | 'automation')}
          />
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <LoadingSpinner size="lg" color="primary" />
              <span className="text-slate-400 text-sm font-medium">{t('common.loading')}</span>
            </div>
          ) : (
            <div className="space-y-6">
              {/* === KIRO CONFIG TAB === */}
              {activeTab === 'kiro' && config && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  {/* Detected IDEs Section */}
                  <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 px-1">
                        <Search className="w-4 h-4 text-green-400" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                          {t('patcher.detectedIdes')}
                        </h3>
                        <Tooltip content={t('patcher.scanDescription')}>
                          <HelpCircle className="w-3.5 h-3.5 text-slate-600 hover:text-slate-400 cursor-help transition-colors" />
                        </Tooltip>
                      </div>
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => detectIDEs()}
                        disabled={scanning}
                      >
                        <RefreshCw size={12} className={scanning ? 'animate-spin' : ''} />
                        {scanning ? t('patcher.scanning') : t('patcher.scanForIdes')}
                      </Button>
                    </div>
                    
                    {detectedIDEs.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 bg-black/20 rounded-xl border border-dashed border-white/10">
                        <Monitor className="w-8 h-8 text-slate-700 mb-2" />
                        <p className="text-[10px] text-slate-600 uppercase font-bold tracking-widest">
                          {t('patcher.noIdesDetected')}
                        </p>
                      </div>
                    ) : (
                      <div className="grid gap-2">
                        {detectedIDEs.map((ide) => (
                          <div
                            key={ide.id}
                            className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/5 group hover:border-white/10 transition-colors"
                          >
                            <div className="flex-1 min-w-0 pr-4">
                              <div className="flex items-center gap-2">
                                <div className="text-xs text-slate-200 font-bold">
                                  {ide.displayName || ide.name}
                                </div>
                                {ide.isPatched ? (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-semibold uppercase">
                                    {t('patcher.patched')}
                                  </span>
                                ) : ide.canPatch ? (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-semibold uppercase">
                                    {t('patcher.canPatch')}
                                  </span>
                                ) : null}
                                {ide.isRunning && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-semibold uppercase">
                                    {t('patcher.running')}
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">
                                {ide.path || ide.installPath}
                              </div>
                              {ide.version && (
                                  <div className="text-[10px] text-slate-600 mt-0.5">
                                    {`v${ide.version}`}
                                  </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              {ide.isPatched ? (
                                <CheckCircle2 size={16} className="text-emerald-400" />
                              ) : ide.canPatch ? (
                                <XCircle size={16} className="text-amber-400" />
                              ) : (
                                <XCircle size={16} className="text-slate-600" />
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Machine ID Section */}
                  <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5 space-y-4">
                    <div className="flex items-center gap-2 px-1">
                      <Monitor className="w-4 h-4 text-blue-400" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                        {t('kiroPatch.machineIdTitle')}
                      </h3>
                      <Tooltip content={t('kiroPatch.machineIdDescription')}>
                        <HelpCircle className="w-3.5 h-3.5 text-slate-600 hover:text-slate-400 cursor-help transition-colors" />
                      </Tooltip>
                    </div>
                    <div className="space-y-3">
                      <Input
                        value={config.machineId}
                        readOnly
                        className="font-mono text-xs"
                        rightElement={
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleCopyMachineId}
                            className="h-7 w-7"
                          >
                            <Copy size={12} />
                          </Button>
                        }
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleGenerateNewMachineId}
                        className="w-full"
                      >
                        <RefreshCw size={14} />
                        {t('kiroPatch.generateNew')}
                      </Button>
                    </div>
                  </div>

                  {/* Proxy Section */}
                  <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 px-1">
                        <Activity className="w-4 h-4 text-cyan-400" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                          {t('kiroPatch.proxyTitle')}
                        </h3>
                        <Tooltip content={t('kiroPatch.proxyDescription')}>
                          <HelpCircle className="w-3.5 h-3.5 text-slate-600 hover:text-slate-400 cursor-help transition-colors" />
                        </Tooltip>
                      </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          {/* eslint-disable-next-line no-restricted-syntax -- custom-styled switch; kit Toggle has a different visual contract */}
                          <input
                            type="checkbox"
                          checked={config.proxyEnabled ?? false}
                          onChange={async (e) => {
                            const enabled = e.target.checked;
                            setConfig(prev =>
                              prev ? { ...prev, proxyEnabled: enabled } : null
                            );
                            
                            // Auto-start/stop proxy when toggled
                            try {
                              if (enabled) {
                                await startKiroProxy();
                                toast.success(t('kiroPatch.proxyStarted'));
                              } else {
                                await stopKiroProxy();
                                toast.success(t('kiroPatch.proxyStopped'));
                              }
                            } catch (error) {
                              toast.error(String(error));
                              // Revert toggle on error
                              setConfig(prev =>
                                prev ? { ...prev, proxyEnabled: !enabled } : null
                              );
                            }
                          }}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-cyan-500/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500"></div>
                      </label>
                    </div>
                    
                    <div className="space-y-3">
                      <Input
                        label={t('kiroPatch.proxyPort')}
                        type="number"
                        min={1024}
                        max={65535}
                        value={config.proxyPort ?? 5580}
                        onChange={e =>
                          setConfig(prev =>
                            prev
                              ? {
                                  ...prev,
                                  proxyPort: parseInt(e.target.value) || 5580,
                                }
                              : null
                          )
                        }
                        className="text-xs font-mono"
                      />
                      <p className="text-[10px] text-slate-500 px-1">
                        {t('kiroPatch.proxyPortHint')}
                      </p>
                    </div>
                    
                    <div className="space-y-3 pt-3 border-t border-white/5">
                      <Input
                        label={t('kiroPatch.outboundProxy')}
                        type="text"
                        placeholder="186.243.169.3:63576:user:pass"
                        value={config.outboundProxy ?? ''}
                        onChange={e =>
                          setConfig(prev =>
                            prev
                              ? {
                                  ...prev,
                                  outboundProxy: e.target.value,
                                }
                              : null
                          )
                        }
                        className="text-xs font-mono"
                      />
                      <p className="text-[10px] text-slate-500 px-1">
                        {t('kiroPatch.outboundProxyHint')}
                      </p>
                    </div>
                  </div>

                  {/* Preset Section */}
                  <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5 space-y-4">
                    <div className="flex items-center gap-2 px-1">
                      <Zap className="w-4 h-4 text-yellow-400" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                        {t('kiroPatch.presetTitle')}
                      </h3>
                      <Tooltip content={t('kiroPatch.presetDescription')}>
                        <HelpCircle className="w-3.5 h-3.5 text-slate-600 hover:text-slate-400 cursor-help transition-colors" />
                      </Tooltip>
                    </div>
                    <SegmentedControl
                      size="sm"
                      options={[
                        { label: 'Standard', value: 'standard' },
                        { label: 'Performance', value: 'performance' },
                        { label: 'Privacy', value: 'privacy' },
                      ]}
                      value={config.preset || 'standard'}
                      onChange={preset => {
                        if (preset === 'standard' || preset === 'performance' || preset === 'privacy') {
                          setConfig(prev => prev ? {
                            ...prev,
                            preset,
                            modules: applyPreset(preset),
                          } : null);
                        }
                      }}
                    />
                    <p className="text-[10px] text-slate-500 px-1">
                      {config.preset === 'standard' && 'Balanced: proxy + telemetry blocking + machine ID spoofing'}
                      {config.preset === 'performance' && 'Fast: rate limit bypass + error suppression'}
                      {config.preset === 'privacy' && 'Private: machine ID + OS spoofing + telemetry blocking'}
                    </p>
                  </div>

                  {/* Account Bindings Section */}
                  <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5 space-y-4">
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-2">
                        <Shield className="w-4 h-4 text-purple-400" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                          {t('kiroPatch.bindingsTitle')}
                        </h3>
                      </div>
                      <Button variant="primary" size="xs" onClick={() => setShowBindDialog(true)}>
                        <Plus size={12} />
                        {t('kiroPatch.bindNewAccount')}
                      </Button>
                    </div>

                    {Object.keys(config.accountBindings).length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 bg-black/20 rounded-xl border border-dashed border-white/10">
                        <Shield className="w-8 h-8 text-slate-700 mb-2" />
                        <p className="text-[10px] text-slate-600 uppercase font-bold tracking-widest">
                          {t('kiroPatch.bindingsEmpty')}
                        </p>
                      </div>
                    ) : (
                      <div className="grid gap-2">
                        {Object.entries(config.accountBindings).map(([accountId, machineId]) => {
                          const account = accounts.find(a => String(a.id) === accountId);
                          return (
                            <div
                              key={accountId}
                              className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/5 group hover:border-white/10 transition-colors"
                            >
                              <div className="flex-1 min-w-0 pr-4">
                                <div className="text-xs text-slate-200 font-bold truncate">
                                  {account?.email || `Account ${accountId}`}
                                </div>
                                <div className="text-[10px] text-slate-500 font-mono mt-0.5 truncate uppercase tracking-tighter">
                                  {machineId}
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleUnbindAccount(accountId)}
                                className="text-red-500/50 hover:text-red-400 hover:bg-red-400/10 h-8 w-8"
                              >
                                <X size={14} />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Log Level & Constants */}
                  <div className="grid gap-6">
                    {/* Log Level - Unified */}
                    <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5 space-y-4">
                      <div className="flex items-center gap-2 px-1">
                        <Terminal className="w-4 h-4 text-emerald-400" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                          {t('kiroPatch.logLevelTitle')}
                        </h3>
                      </div>
                      <SegmentedControl
                        size="sm"
                        options={[
                          { label: 'DEBUG', value: 'debug' },
                          { label: 'INFO', value: 'info' },
                          { label: 'WARN', value: 'warn' },
                          { label: 'ERROR', value: 'error' },
                        ]}
                        value={config.logLevel}
                        onChange={level => {
                          if (!isKiroLogLevel(level)) return;
                          setConfig(prev => (prev ? { ...prev, logLevel: level } : null));
                        }}
                      />
                    </div>

                    {/* Constants - Compact */}
                    <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5 space-y-4">
                      <div className="flex items-center gap-2 px-1">
                        <Activity className="w-4 h-4 text-pink-400" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                          {t('kiroPatch.constantsTitle')}
                        </h3>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-4">
                        <Input
                          label={t('kiroPatch.writeLimit')}
                          value={config.constants?.writeLimit || '500 lines'}
                          onChange={e =>
                            setConfig(prev =>
                              prev
                                ? {
                                    ...prev,
                                    constants: { ...prev.constants, writeLimit: e.target.value },
                                  }
                                : null
                            )
                          }
                          className="text-xs font-mono"
                        />
                        <Input
                          label={t('kiroPatch.maxTokens')}
                          type="number"
                          value={config.constants?.defaultMaxTokens || 4096}
                          onChange={e =>
                            setConfig(prev =>
                              prev
                                ? {
                                    ...prev,
                                    constants: {
                                      ...prev.constants,
                                      defaultMaxTokens: parseInt(e.target.value),
                                    },
                                  }
                                : null
                            )
                          }
                          className="text-xs font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Prompt Editor */}
                  <div className="bg-gradient-to-br from-indigo-500/[0.05] to-purple-500/[0.05] border border-indigo-500/20 rounded-2xl p-5 space-y-4 shadow-xl">
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-indigo-400" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                          {t('kiroPatch.promptEditorTitle')}
                        </h3>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          size="xs"
                          onClick={async () => {
                            try {
                              const message = await copyDefaultPrompts();
                              toast.success(message);
                              await loadData();
                            } catch (error) {
                              toast.error(String(error));
                            }
                          }}
                        >
                          <Copy size={12} />
                          {t('kiroPatch.copyDefaults')}
                        </Button>
                        <Button
                          variant="secondary"
                          size="xs"
                          onClick={() => setShowPromptEditor(!showPromptEditor)}
                        >
                          {showPromptEditor ? t('kiroPatch.collapse') : t('kiroPatch.expand')}
                        </Button>
                      </div>
                    </div>

                    {showPromptEditor && (
                      <div className="space-y-4 pt-2">
                        <SegmentedControl
                          size="sm"
                          options={[
                            { label: 'System', value: 'system-prompt' },
                            { label: 'Context', value: 'context-gatherer' },
                            { label: 'Spec', value: 'spec-task' },
                            { label: 'General', value: 'general-task' },
                          ]}
                          value={selectedPrompt}
                          onChange={setSelectedPrompt}
                        />
                        <div className="bg-black/40 rounded-xl border border-white/5 overflow-hidden">
                          <PromptEditor
                            key={selectedPrompt}
                            promptName={selectedPrompt}
                            title={selectedPrompt.replace('-', ' ')}
                            description={`Edit ${selectedPrompt} prompt`}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* === AUTOMATION TAB === */}
              {activeTab === 'automation' && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="space-y-4">
                    <div className="px-1">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                        {t('settings.patcher.title')}
                      </h3>
                      <p className="text-[10px] text-slate-500 font-medium">
                        {t('settings.patcher.description')}
                      </p>
                    </div>

                    <div className="grid gap-3">
                      <Checkbox
                        label={t('settings.patcher.autoRotate')}
                        description={t('settings.patcher.autoRotateDescription')}
                        checked={globalSettings.autoRotateEnabled ?? true}
                        onChange={e => handleSaveGlobal({ autoRotateEnabled: e.target.checked })}
                        className="bg-white/[0.02] border border-white/5 p-4 rounded-xl"
                      />
                      <Checkbox
                        label={t('settings.patcher.spoofMachineId')}
                        description={t('settings.patcher.spoofMachineIdDescription')}
                        checked={globalSettings.spoofMachineIdEnabled ?? true}
                        onChange={e =>
                          handleSaveGlobal({ spoofMachineIdEnabled: e.target.checked })
                        }
                        className="bg-white/[0.02] border border-white/5 p-4 rounded-xl"
                      />
                    </div>
                  </div>

                  <div className="pt-6 border-t border-white/5">
                    <AiProxySettings />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 p-6 border-t border-white/5 flex items-center justify-end gap-3 bg-white/[0.02]">
          <Button variant="ghost" size="md" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {activeTab === 'kiro' && (
            <Button
              variant="primary"
              size="md"
              onClick={handleSaveKiro}
              isLoading={isSaving}
              disabled={!config}
              leftIcon={<Save size={16} />}
            >
              {t('kiroPatch.saveConfig')}
            </Button>
          )}
        </div>
      </div>

      {/* Bind Account Dialog */}
      {showBindDialog && (
        <div className="fixed inset-0 bg-void-base/80 backdrop-blur-md flex items-center justify-center z-[60] p-4">
          <div className="bg-vsc-panel border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-base font-bold text-white mb-6 tracking-tight">
              {t('kiroPatch.bindModalTitle')}
            </h3>
            <div className="space-y-6">
              <div className="space-y-2">
                <label
                  htmlFor="patcher-bind-account"
                  className="text-[10px] uppercase font-bold text-slate-500 tracking-wider px-1"
                >
                  {t('kiroPatch.bindModalAccountId')}
                </label>
                <Select
                  id="patcher-bind-account"
                  value={selectedAccountId}
                  onChange={e => setSelectedAccountId(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/50"
                  shellClassName="bg-white/[0.03] border-white/10"
                >
                  <option value="">{t('kiroPatch.bindModalAccountIdPlaceholder')}</option>
                  {accounts.map(account => (
                    <option key={account.id} value={String(account.id)} className="bg-vsc-panel">
                      {account.email} ({account.provider})
                    </option>
                  ))}
                </Select>
              </div>
              <Input
                label={t('kiroPatch.bindModalMachineId')}
                value={customMachineId}
                onChange={e => setCustomMachineId(e.target.value)}
                placeholder={t('kiroPatch.bindModalMachineIdPlaceholder')}
                className="font-mono text-xs"
              />
              <ButtonBase
                type="button"
                onClick={async () => {
                  const newId = await generateNewMachineId();
                  setCustomMachineId(newId);
                }}
                className="text-primary text-[10px] font-bold uppercase tracking-widest hover:text-primary/80 transition-colors px-1"
              >
                {t('kiroPatch.bindModalGenerate')}
              </ButtonBase>
            </div>
            <div className="flex items-center justify-end gap-3 mt-8 pt-6 border-t border-white/5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowBindDialog(false);
                  setSelectedAccountId('');
                  setCustomMachineId('');
                }}
              >
                {t('kiroPatch.bindModalCancel')}
              </Button>
              <Button variant="primary" size="sm" onClick={handleBindAccount}>
                {t('kiroPatch.bindModalBind')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
