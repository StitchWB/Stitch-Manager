import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  ArrowRight,
  BookOpen,
  Cable,
  KeyRound,
  LayoutDashboard,
  MessageSquare,
  Orbit,
  Route,
  Server,
  Settings2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { AiTopTabs } from '@/components/ai-proxy/AiTopTabs';
import Header from '@/components/layout/Header';
import { Button, GlassCard, PageHeader } from '@/components/ui';
import { useAppStore } from '@/stores/app';
import { cn } from '@/lib/utils';

interface HubAction {
  title: string;
  description: string;
  to: string;
  icon: LucideIcon;
  tone: string;
}

interface HubGroup {
  title: string;
  description: string;
  actions: HubAction[];
}

export default function AiOverview() {
  const navigate = useNavigate();
  const language = useAppStore(state => state.language);
  const isRu = language === 'ru';

  const groups: HubGroup[] = [
    {
      title: isRu ? '1. Подключите источники' : '1. Connect sources',
      description: isRu
        ? 'Добавьте аккаунты и ключи, из которых AI Proxy будет выбирать.'
        : 'Add accounts and keys that AI Proxy can route requests through.',
      actions: [
        {
          title: isRu ? 'Аккаунты провайдеров' : 'Provider accounts',
          description: isRu ? 'OAuth-сессии, квоты и доступность' : 'OAuth sessions, quotas and availability',
          to: '/ai/providers',
          icon: Server,
          tone: 'text-sky-300 bg-sky-500/10',
        },
        {
          title: isRu ? 'API-ключи' : 'API keys',
          description: isRu ? 'Ключи Gemini, OpenAI и других API' : 'Gemini, OpenAI and other API credentials',
          to: '/ai/api-keys',
          icon: KeyRound,
          tone: 'text-violet-300 bg-violet-500/10',
        },
        {
          title: 'Antigravity',
          description: isRu ? 'Google OAuth и локальные credentials' : 'Google OAuth and local credentials',
          to: '/ai/antigravity',
          icon: Orbit,
          tone: 'text-amber-300 bg-amber-500/10',
        },
      ],
    },
    {
      title: isRu ? '2. Настройте обработку' : '2. Configure runtime',
      description: isRu
        ? 'Запустите прокси, задайте правила выбора моделей и подключите клиенты.'
        : 'Start the proxy, define model selection rules and connect clients.',
      actions: [
        {
          title: isRu ? 'Маршрутизация' : 'Routing',
          description: isRu ? 'Прокси, маппинги и ротация' : 'Proxy, mappings and rotation',
          to: '/ai/routing',
          icon: Route,
          tone: 'text-emerald-300 bg-emerald-500/10',
        },
        {
          title: isRu ? 'Интеграции' : 'Integrations',
          description: isRu ? 'Готовые параметры для IDE и CLI' : 'Ready-to-use IDE and CLI settings',
          to: '/ai/integrations',
          icon: Cable,
          tone: 'text-cyan-300 bg-cyan-500/10',
        },
        {
          title: isRu ? 'Мониторинг' : 'Monitoring',
          description: isRu ? 'Состояние, запросы и ошибки' : 'Health, requests and errors',
          to: '/ai/monitor',
          icon: Activity,
          tone: 'text-rose-300 bg-rose-500/10',
        },
      ],
    },
    {
      title: isRu ? '3. Проверьте и используйте' : '3. Test and use',
      description: isRu
        ? 'Проверьте маршрутизацию в чате или настройте OpenCode.'
        : 'Validate routing in chat or configure OpenCode.',
      actions: [
        {
          title: isRu ? 'Тестовый чат' : 'Test chat',
          description: isRu ? 'Проверка моделей и debug-маршрута' : 'Validate models and inspect routing',
          to: '/ai/chat',
          icon: MessageSquare,
          tone: 'text-indigo-300 bg-indigo-500/10',
        },
        {
          title: 'OpenCode',
          description: isRu ? 'Провайдеры, агенты и модели' : 'Providers, agents and models',
          to: '/ai/opencode-config',
          icon: Settings2,
          tone: 'text-fuchsia-300 bg-fuchsia-500/10',
        },
        {
          title: 'NotebookLM',
          description: isRu
            ? 'Ноутбуки, вопросы и аудио-обзоры'
            : 'Notebooks, questions and audio overviews',
          to: '/ai/notebooklm',
          icon: BookOpen,
          tone: 'text-teal-300 bg-teal-500/10',
        },
      ],
    },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-void-base">
      <Header title="AI Hub" icon={<LayoutDashboard size={18} />} />
      <AiTopTabs />
      <PageHeader
        eyebrow="AI Hub"
        title={isRu ? 'Центр управления AI' : 'AI control center'}
        description={
          isRu
            ? 'Настройка от источников доступа до маршрутизации и проверки запросов — по шагам.'
            : 'Move from access sources to routing and request validation in a clear sequence.'
        }
        actions={
          <Button variant="primary" size="sm" onClick={() => navigate('/ai/providers')}>
            {isRu ? 'Открыть провайдеры' : 'Open providers'}
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          {groups.map(group => (
            <section key={group.title}>
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-white">{group.title}</h2>
                <p className="mt-1 text-xs text-slate-500">{group.description}</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {group.actions.map(action => {
                  const Icon = action.icon;
                  return (
                    <GlassCard key={action.to} className="group p-4 transition-colors hover:border-white/15">
                      <div className="flex items-start gap-3">
                        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', action.tone)}>
                          <Icon size={17} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-medium text-slate-100">{action.title}</h3>
                          <p className="mt-1 text-xs leading-5 text-slate-500">{action.description}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => navigate(action.to)}
                          aria-label={action.title}
                        >
                          <ArrowRight size={14} />
                        </Button>
                      </div>
                    </GlassCard>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
