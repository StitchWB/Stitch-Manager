import { Plug, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { DevboxOverviewGateway } from '@/lib/backend/modules/devbox';
import { DevboxSection } from './DevboxSection';

export interface DevboxMcpSectionProps {
  gateway: DevboxOverviewGateway | null;
  onConfigure: () => void;
}

export function DevboxMcpSection({ gateway, onConfigure }: DevboxMcpSectionProps) {
  if (gateway === null) return null;
  const rows = gateway.enabled ? gateway.exposed_mcps : [];

  return (
    <DevboxSection title={t('devboxPage.mcpSectionTitle')} testId="devbox-mcp-section">
      {rows.length === 0 ? (
        <EmptyState
          compact
          icon={Plug}
          title={t('devboxPage.mcpEmptyTitle')}
          description={t('devboxPage.mcpEmptyDesc')}
          action={
            <Button
              size="sm"
              variant="secondary"
              data-testid="devbox-mcp-configure"
              onClick={onConfigure}
            >
              {t('devboxPage.mcpEmptyCta')}
            </Button>
          }
        />
      ) : (
        <div className="flex flex-wrap items-stretch gap-2">
          {rows.map(mcp => (
            <div
              key={mcp.name}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5"
              data-testid={`devbox-mcp-row-${mcp.name}`}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-xs font-semibold text-white">{mcp.name}</span>
                <span
                  className={cn(
                    'truncate text-2xs uppercase tracking-wider',
                    mcp.mode === 'full' ? 'text-amber-300' : 'text-slate-400',
                  )}
                  data-testid={`devbox-mcp-mode-${mcp.name}`}
                >
                  {mcp.mode === 'full'
                    ? t('devboxPage.mcpModeFull')
                    : t('devboxPage.mcpModeReadonly')}
                </span>
              </span>
              <span
                className="ml-auto flex shrink-0 items-center gap-1 text-2xs text-slate-400"
                title={mcp.tools.join(', ')}
                data-testid={`devbox-mcp-tools-${mcp.name}`}
              >
                <Wrench size={12} aria-hidden />
                {mcp.tools.length}
              </span>
            </div>
          ))}
        </div>
      )}
    </DevboxSection>
  );
}
