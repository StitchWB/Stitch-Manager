import { useNavigate, useParams } from 'react-router-dom';

import { t } from '@/lib/i18n';
import { TabButton } from '@/components/ui';

export type AutomationTabId = 'schedule' | 'scenarios' | 'replenishment';

interface AutomationTab {
  id: AutomationTabId;
  labelKey: string;
  to: string;
}

const AUTOMATION_TABS: AutomationTab[] = [
  { id: 'schedule', labelKey: 'automation.tabs.schedule', to: '/automation/schedule' },
  { id: 'scenarios', labelKey: 'automation.tabs.scenarios', to: '/automation/scenarios' },
  {
    id: 'replenishment',
    labelKey: 'automation.tabs.replenishment',
    to: '/automation/replenishment',
  },
];

/**
 * Resolve a route param value to a known automation tab id, with fallback
 * to `schedule` for both the `/automation` index and unknown values.
 */
export function resolveAutomationTab(param: string | undefined): AutomationTabId {
  if (param === 'scenarios') return 'scenarios';
  if (param === 'replenishment') return 'replenishment';
  return 'schedule';
}

/**
 * Sticky tab strip for the /automation hub. Renders three tabs that map to
 * the three sub-routes (`/automation/schedule`, `/automation/scenarios`,
 * `/automation/replenishment`). Visual analogue of `AiTopTabs`.
 */
export function AutomationTopTabs() {
  const navigate = useNavigate();
  const { tab } = useParams<{ tab?: string }>();
  const current = resolveAutomationTab(tab);

  return (
    <div className="px-6 py-3 border-b border-white/5 bg-vsc-bg/70 backdrop-blur-xl sticky top-0 z-20">
      <div className="flex flex-wrap items-center gap-2">
        {AUTOMATION_TABS.map(item => (
          <TabButton
            key={item.id}
            onClick={() => navigate(item.to)}
            active={current === item.id}
            label={t(item.labelKey)}
          />
        ))}
      </div>
    </div>
  );
}
