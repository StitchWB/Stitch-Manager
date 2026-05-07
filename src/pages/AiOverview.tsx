import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Settings2, Database, Activity, Zap, Orbit, Key } from 'lucide-react';
import Header from '../components/layout/Header';

import { AiTopTabs } from '../components/ai-proxy/AiTopTabs';
import { t } from '../lib/i18n';
import { Button } from '@/components/ui';

interface HubCard {
  title: string;
  description: string;
  to: string;
  icon: React.ReactNode;
  cta: string;
}

export default function AiOverview() {
  const navigate = useNavigate();

  const cards: HubCard[] = [
    {
      title: t('aiHub.tabs.providers'),
      description: t('aiHub.sections.providers.subtitle'),
      to: '/ai/providers',
      icon: <Zap size={18} />,
      cta: t('aiHub.actions.openProviders'),
    },
    {
      title: t('aiHub.tabs.integrations'),
      description: t('aiHub.sections.integrations.subtitle'),
      to: '/ai/integrations',
      icon: <Settings2 size={18} />,
      cta: t('aiHub.actions.openIntegrations'),
    },
    {
      title: t('aiHub.tabs.usage'),
      description: t('aiHub.sections.usage.subtitle'),
      to: '/ai/usage',
      icon: <Database size={18} />,
      cta: t('aiHub.actions.openUsage'),
    },
    {
      title: t('aiHub.tabs.diagnostics'),
      description: t('aiHub.sections.diagnostics.subtitle'),
      to: '/ai/diagnostics',
      icon: <Activity size={18} />,
      cta: t('aiHub.actions.openDiagnostics'),
    },
    {
      title: t('aiHub.tabs.antigravity'),
      description: t('aiHub.sections.antigravity.subtitle'),
      to: '/ai/antigravity',
      icon: <Orbit size={18} />,
      cta: t('aiHub.actions.openAntigravity'),
    },
    {
      title: t('aiHub.tabs.apiKeys'),
      description: t('aiHub.sections.apiKeys.subtitle'),
      to: '/ai/api-keys',
      icon: <Key size={18} />,
      cta: t('aiHub.actions.openApiKeys'),
    },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden bg-ds-surface-base">
      <Header
        title={t('aiHub.sections.overview.title')}
        subtitle={t('aiHub.sections.overview.subtitle')}
        icon={<ShieldCheck size={18} />}
      />
      <AiTopTabs />

      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cards.map(card => (
            <div
              key={card.to}
              className="bg-ds-surface-overlay/80 border border-white/10 rounded-xl p-5 flex flex-col gap-3"
            >
              <div className="flex items-center gap-2 text-white">
                {card.icon}
                <h3 className="text-base font-semibold">{card.title}</h3>
              </div>
              <p className="text-sm text-slate-400 leading-relaxed">{card.description}</p>
              <div className="pt-1">
                <Button variant="secondary" size="sm" onClick={() => navigate(card.to)}>
                  {card.cta}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
