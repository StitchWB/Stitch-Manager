import { t } from '@/lib/i18n';
import { CollapsibleGroup, ExpandAllToggle } from '@/components/ui';
import {
  useAutomationTab,
  AutomationHeaderCard,
  ProviderReplenishmentSection,
  RotationRulesSection } from
'./automation';

export function AutomationTab({ disabled }: {disabled?: boolean;}) {
  const {
    regConfig,
    proxySettings,
    replenishmentStatus,
    isLoading,
    activeCounts,
    totalActive,
    totalTarget,
    enabledAiHubAccounts,
    expandedProvider,
    allExpanded,
    toggleAll,
    handleRegUpdate,
    handleProxyUpdate,
    getProviderStatus,
    setExpandedProvider
  } = useAutomationTab();

  if (isLoading)
  return (
    <div className="p-4 text-center text-slate-300 font-mono text-xs animate-pulse">
        {t('common.loading')}
      </div>);


  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <ExpandAllToggle allExpanded={allExpanded} onToggle={toggleAll} />
      </div>

      <AutomationHeaderCard
        autoReplenishEnabled={regConfig.autoReplenishEnabled}
        totalActive={totalActive}
        totalTarget={totalTarget}
        replenishmentStatus={replenishmentStatus}
        onToggle={(val) => handleRegUpdate({ autoReplenishEnabled: val })}
        disabled={disabled} />


      <CollapsibleGroup gap="sm">
        <ProviderReplenishmentSection
          regConfig={regConfig}
          activeCounts={activeCounts}
          expandedProvider={expandedProvider}
          onToggleProvider={(id) => setExpandedProvider(id || null)}
          onUpdateReg={handleRegUpdate}
          getProviderStatus={getProviderStatus}
          disabled={disabled}
          allExpanded={allExpanded} />


        <RotationRulesSection
          proxySettings={proxySettings}
          regConfig={regConfig}
          enabledAiHubAccounts={enabledAiHubAccounts}
          onUpdateProxy={handleProxyUpdate}
          onUpdateReg={handleRegUpdate}
          disabled={disabled}
          allExpanded={allExpanded} />

      </CollapsibleGroup>

      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />{t("autoReg.automation_tab.api")}
            <span className="text-slate-400">{t("autoReg.automation_tab.v304")}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            {t("autoReg.automation_tab.accounts")}{': '}<span className="text-emerald-400">{totalActive}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <div className="w-1.5 h-1.5 rounded-full bg-slate-600" />
          {replenishmentStatus?.isRunning ? t("autoReg.automation_tab.running") : t("autoReg.automation_tab.waiting")}
        </div>
      </div>
    </div>);

}