import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Settings2, Database, Activity, Zap } from 'lucide-react';
import Header from '../components/layout/Header';
import { Button } from '../components/ui';
import { AiTopTabs } from '../components/ai-proxy/AiTopTabs';

interface HubCard {
  title: string;
  description: string;
  to: string;
  icon: React.ReactNode;
  cta: string;
}

export default function AiOverview() {
  const navigate = useNavigate();

  const cards = useMemo<HubCard[]>(
    () => [
      {
        title: 'Providers',
        description: 'Manage AI provider accounts, credentials, and connection status.',
        to: '/ai/providers',
        icon: <Zap size={18} />,
        cta: 'Open Providers',
      },
      {
        title: 'Integrations',
        description: 'Configure IDE/CLI integrations (OpenCode, Cursor, Cline, Continue).',
        to: '/ai/integrations',
        icon: <Settings2 size={18} />,
        cta: 'Open Integrations',
      },
      {
        title: 'Usage & Quotas',
        description: 'Review quota health and recent usage trends.',
        to: '/ai/usage',
        icon: <Database size={18} />,
        cta: 'Open Usage',
      },
      {
        title: 'Diagnostics',
        description: 'Sidecar health, debug chat, and troubleshooting tools.',
        to: '/ai/diagnostics',
        icon: <Activity size={18} />,
        cta: 'Open Diagnostics',
      },
    ],
    []
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#050508]">
      <Header
        title="AI Hub"
        subtitle="Unified navigation for providers, integrations, quotas, and diagnostics"
        icon={<ShieldCheck size={18} />}
      />
      <AiTopTabs />

      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cards.map(card => (
            <div
              key={card.to}
              className="bg-[#111116]/80 border border-white/10 rounded-xl p-5 flex flex-col gap-3"
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
