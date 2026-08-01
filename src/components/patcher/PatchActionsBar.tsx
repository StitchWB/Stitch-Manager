import { Download, Trash2, Globe } from 'lucide-react';
import { t } from '@/lib/i18n';
import { useState } from 'react';
import { safeInvoke } from '@/lib/backend';
import { cn } from '@/lib/utils';

import PatchVersionSelector from './PatchVersionSelector';
import PatchOptionsPanel from './PatchOptionsPanel';
import { Button } from '@/components/ui';

interface PatchVersion {
  id: string;
  label: string;
  description: string;
}

interface PatchOption {
  id: string;
  labelKey: string;
  descKey: string;
  defaultEnabled: boolean;
}

interface PatchActionsBarProps {
  isPatched: boolean;
  canPatch: boolean;
  isOperating: boolean;
  availableVersions: PatchVersion[];
  availableOptions: PatchOption[];
  selectedVersion: string | undefined;
  currentPatchVersion: string | undefined;
  selectedOptions: Record<string, boolean>;
  onPatch: () => void;
  onUnpatch: () => void;
  onSelectVersion: (versionId: string) => void;
  onToggleOption: (optionId: string) => void;
  onToggleAllOptions: (enable: boolean) => void;
}

export default function PatchActionsBar({
  isPatched,
  canPatch,
  isOperating,
  availableVersions,
  availableOptions,
  selectedVersion,
  currentPatchVersion,
  selectedOptions,
  onPatch,
  onUnpatch,
  onSelectVersion,
  onToggleOption,
  onToggleAllOptions,
}: PatchActionsBarProps) {
  const [proxyRunning, setProxyRunning] = useState(false);
  const [proxyLoading, setProxyLoading] = useState(false);

  const handleToggleProxy = async () => {
    setProxyLoading(true);
    try {
      if (proxyRunning) {
        await safeInvoke('stop_kiro_proxy', {});
        setProxyRunning(false);
      } else {
        await safeInvoke('start_kiro_proxy', {});
        setProxyRunning(true);
      }
    } catch (err) {
      console.error('Failed to toggle proxy:', err);
    } finally {
      setProxyLoading(false);
    }
  };

  return (
    <div className="bg-gradient-to-r from-white/[0.04] to-white/[0.01] rounded-xl p-4 border border-white/5 shadow-sm">
      <div className="flex flex-wrap items-center gap-4">
        {/* Version Selector */}
        <PatchVersionSelector
          versions={availableVersions}
          selectedVersion={selectedVersion}
          currentPatchVersion={currentPatchVersion}
          onSelectVersion={onSelectVersion}
        />

        <div className="flex-1" />

        {/* Proxy Toggle Button */}
        <Button
          onClick={handleToggleProxy}
          disabled={proxyLoading}
          variant={proxyRunning ? 'primary' : 'secondary'}
          size="md"
          leftIcon={<Globe size={16} />}
          className={cn(
            'shadow-lg',
            proxyRunning
              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-200 hover:bg-emerald-500/25 shadow-emerald-500/10 hover:shadow-emerald-500/20'
              : 'shadow-emerald-500/10 hover:shadow-emerald-500/20'
          )}
        >
          {proxyRunning ? t('patcher.proxyRunning') : t('patcher.startProxy')}
        </Button>

        {/* Main Action Button */}
        {isPatched ? (
          <Button
            onClick={onUnpatch}
            disabled={isOperating}
            variant="danger"
            size="md"
            leftIcon={<Trash2 size={16} />}
            className="shadow-lg shadow-red-500/10 hover:shadow-red-500/20"
          >
            {t('patcher.removePatch')}
          </Button>
        ) : (
          <Button
            onClick={onPatch}
            disabled={isOperating || !canPatch}
            variant="primary"
            size="md"
            leftIcon={<Download size={16} />}
            className="shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/40"
          >
            {t('patcher.applyPatch')}
          </Button>
        )}
      </div>

      {/* Patch Options */}
      <PatchOptionsPanel
        options={availableOptions}
        selectedOptions={selectedOptions}
        onToggleOption={onToggleOption}
        onToggleAll={onToggleAllOptions}
      />
    </div>
  );
}
