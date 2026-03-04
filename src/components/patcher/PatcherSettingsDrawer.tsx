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
} from 'lucide-react';
import { toast } from 'sonner';
import { t } from '../../lib/i18n';
import { Tooltip } from '../ui/Tooltip';
import { LoadingSpinner } from '../ui';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Checkbox } from '../ui/Checkbox';
import { Select } from '../ui/Select';
import { SegmentedControl } from '../ui/SegmentedControl';
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
} from '@/lib/tauri';
import type { KiroPatchConfig } from '../../types/kiro-patch';
import type { Account } from '../../types';
import type { SettingsData } from '../../types/generated';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';

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

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [kiroCfg, globalCfg, accts] = await Promise.all([
        getKiroPatchConfig(),
        getSettings(),
        listAccounts(),
      ]);
      setConfig(kiroCfg as any);
      setGlobalSettings(globalCfg as any);
      setAccounts(accts);
    } catch (error) {
      console.error('Failed to load config:', error);
      toast.error(t('kiroPatch.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
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
      await updateSettings(updates as any);
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
      <button
        type="button"
        aria-label={t('common.cancel')}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[45]"
        onClick={onClose}
      />

      <div className="fixed right-0 top-0 bottom-0 w-[580px] bg-[#0a0a0c] border-l border-white/5 z-[50] flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
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
            onChange={v => setActiveTab(v as any)}
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
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[60] p-4">
          <div className="bg-[#0f1115] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
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
                    <option key={account.id} value={String(account.id)} className="bg-[#0f1115]">
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
              <button
                type="button"
                onClick={async () => {
                  const newId = await generateNewMachineId();
                  setCustomMachineId(newId);
                }}
                className="text-primary text-[10px] font-bold uppercase tracking-widest hover:text-primary/80 transition-colors px-1"
              >
                {t('kiroPatch.bindModalGenerate')}
              </button>
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
