import { Settings2, Terminal } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

import { TabButton } from '@/components/ui';
import { useAppStore } from '@/stores/app';

const CONNECTION_ROUTES = [
  { id: 'ide-cli', to: '/ai/integrations', icon: Terminal },
  { id: 'opencode', to: '/ai/opencode-config', icon: Settings2 },
] as const;

export function ConnectionsNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const language = useAppStore(state => state.language);
  const labels =
    language === 'ru'
      ? {
        nav: 'Раздел подключений',
        context: 'Тип клиента',
        'ide-cli': 'IDE и CLI',
        opencode: 'OpenCode',
      }
      : {
        nav: 'Connections workspace',
        context: 'Client type',
        'ide-cli': 'IDE & CLI',
        opencode: 'OpenCode',
      };

  return (
    <nav
      aria-label={labels.nav}
      className="shrink-0 overflow-x-auto border-b border-vsc-border bg-vsc-sidebar/85 px-3 md:px-5 [scrollbar-width:thin]"
    >
      <div className="flex h-11 min-w-max items-center gap-1">
        <span className="mr-1 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">
          {labels.context}
        </span>
        <span aria-hidden="true" className="mr-1 h-4 w-px bg-white/[0.09]" />
        {CONNECTION_ROUTES.map(item => {
          const Icon = item.icon;
          const active = location.pathname.startsWith(item.to);
          return (
            <TabButton
              key={item.id}
              active={active}
              appearance="section"
              size="sm"
              onClick={() => navigate(item.to)}
              aria-current={active ? 'page' : undefined}
              title={labels[item.id]}
              icon={<Icon size={14} />}
              label={labels[item.id]}
            />
          );
        })}
      </div>
    </nav>
  );
}
