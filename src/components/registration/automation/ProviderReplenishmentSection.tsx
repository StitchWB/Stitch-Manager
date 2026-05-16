import { useCallback } from 'react';
import { RefreshCw, Shield, PlayCircle, Cpu } from 'lucide-react';
import { CollapsibleSection, ModuleCard, NumberInput, Select } from '@/components/ui';
import { Tooltip } from '@/components/Tooltip';
import { t } from '@/lib/i18n';
import { ModuleStatus } from '@/components/ui';
import { AutomationConfig, strategyOptions } from './useAutomationTab';

export interface ProviderReplenishmentSectionProps {
  regConfig: AutomationConfig;
  activeCounts: { kiro: number; windsurf: number; trae: number };
  expandedProvider: string | null;
  onToggleProvider: (id: string) => void;
  onUpdateReg: (updates: Partial<AutomationConfig>) => void;
  getProviderStatus: (id: string) => ModuleStatus;
  disabled?: boolean;
  allExpanded: boolean;
}

const providers = [
  {
    id: 'kiro',
    icon: <Shield className="w-5 h-5" />,
    label: 'Kiro',
    strategyKey: 'kiroRegStrategy' as const,
    minKey: 'minActiveKiro' as const,
    currentKey: 'kiro' as const,
  },
  {
    id: 'windsurf',
    icon: <PlayCircle className="w-5 h-5" />,
    label: 'Windsurf',
    strategyKey: 'windsurfRegStrategy' as const,
    minKey: 'minActiveWindsurf' as const,
    currentKey: 'windsurf' as const,
  },
  {
    id: 'trae',
    icon: <Cpu className="w-5 h-5" />,
    label: 'Trae',
    strategyKey: 'traeRegStrategy' as const,
    minKey: 'minActiveTrae' as const,
    currentKey: 'trae' as const,
  },
];

export function ProviderReplenishmentSection({
  regConfig,
  activeCounts,
  expandedProvider,
  onToggleProvider,
  onUpdateReg,
  getProviderStatus,
  disabled,
  allExpanded,
}: ProviderReplenishmentSectionProps) {
  const handleStrategyChange = useCallback(
    (key: keyof AutomationConfig, value: string) => {
      onUpdateReg({ [key]: value });
    },
    [onUpdateReg]
  );

  const handleMinChange = useCallback(
    (key: keyof AutomationConfig, value: number) => {
      onUpdateReg({ [key]: value });
    },
    [onUpdateReg]
  );

  return (
    <CollapsibleSection
      title={t('automation.replenishment')}
      description={t('autoReg.providerReplenishmentSection.description')}
      icon={<RefreshCw className="w-5 h-5 text-cyan-400" />}
      defaultExpanded={allExpanded || true}
      disabled={disabled}
      className="p-3"
    >
      <div className="flex flex-col gap-3">
        {providers.map(p => {
          const current = activeCounts[p.currentKey];
          const minActive = regConfig[p.minKey];
          const strategy = regConfig[p.strategyKey];

          return (
            <ModuleCard
              key={p.id}
              id={p.id}
              title={p.label}
              icon={p.icon}
              status={getProviderStatus(p.id)}
              isExpanded={expandedProvider === p.id}
              onToggle={() => onToggleProvider(expandedProvider === p.id ? '' : p.id)}
              summary={`${current} / ${minActive} ${t('autoReg.providerReplenishmentSection.activeSummary')}`}
              disabled={disabled}
            >
              <div className="flex flex-col gap-2 p-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wide ml-1">
                    {t('autoReg.providerReplenishmentSection.strategyLabel')}
                  </span>
                  <div className="w-36">
                    <Tooltip
                      content={`${t('autoReg.providerReplenishmentSection.strategyTooltip', { label: p.label, current, minActive })}`}
                    >
                      <Select
                        value={strategy}
                        onChange={e => handleStrategyChange(p.strategyKey, e.target.value)}
                        options={strategyOptions}
                        disabled={disabled}
                        className="h-8 text-xs font-bold bg-white/5 border-white/10"
                      />
                    </Tooltip>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wide ml-1">
                    {t('autoReg.providerReplenishmentSection.minReserveLabel')}
                  </span>
                  <div className="w-36">
                    <NumberInput
                      label=""
                      value={minActive}
                      onChange={val => handleMinChange(p.minKey, val)}
                      min={1}
                      max={20}
                      unit={t('autoReg.providerReplenishmentSection.accountUnit')}
                      className="w-full"
                      tooltip={`${t('autoReg.providerReplenishmentSection.minTooltip', { label: p.label })}`}
                    />
                  </div>
                </div>
              </div>
            </ModuleCard>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}
