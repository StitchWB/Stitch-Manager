import { FolderCog, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { t } from '@/lib/i18n';
import {
  devboxStackStart,
  type DevboxAccepted,
  type DevboxProfileRow,
} from '@/lib/backend/modules/devbox';
import { devboxModeLabel } from './labels';

export interface DevboxProjectStripProps {
  activeProfile: DevboxProfileRow | null;
  busy: boolean;
  onAction: (action: Promise<DevboxAccepted>) => void;
  onOpenProjects: () => void;
}

export function DevboxProjectStrip({
  activeProfile,
  busy,
  onAction,
  onOpenProjects,
}: DevboxProjectStripProps) {
  return (
    <GlassCard className="px-4 py-2.5">
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-2"
        data-testid="devbox-project-strip"
      >
        {activeProfile ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-xs">
            <span className="text-2xs uppercase tracking-wider text-slate-400">
              {t('devboxPage.stripCurrentProject')}
            </span>
            <span className="font-medium text-white" data-testid="devbox-project-strip-name">
              {activeProfile.name}
            </span>
            <span aria-hidden className="text-slate-600">
              |
            </span>
            <span
              className="truncate font-mono text-2xs text-slate-400"
              title={activeProfile.project_dir}
              data-testid="devbox-project-strip-dir"
            >
              {activeProfile.project_dir}
            </span>
            <span aria-hidden className="text-slate-600">
              |
            </span>
            <span className="text-2xs uppercase tracking-wider text-slate-400">
              {t('devboxPage.stripAccess')}
            </span>
            <span className="text-slate-300" data-testid="devbox-project-strip-mode">
              {devboxModeLabel(activeProfile.mode)}
            </span>
          </div>
        ) : (
          <span
            className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-slate-400"
            data-testid="devbox-project-strip-empty"
          >
            <FolderCog size={14} className="shrink-0" aria-hidden />
            {t('devboxPage.stripNoProject')}
          </span>
        )}
        <div className="flex shrink-0 items-center gap-2">
          {activeProfile && (
            <Button
              size="xs"
              variant="secondary"
              leftIcon={<RotateCw size={12} />}
              disabled={busy}
              data-testid="devbox-project-strip-restart"
              onClick={() => onAction(devboxStackStart(activeProfile.name, false))}
            >
              {t('devboxPage.restart')}
            </Button>
          )}
          <Button
            size="xs"
            variant="secondary"
            data-testid="devbox-project-strip-open"
            onClick={onOpenProjects}
          >
            {t('devboxPage.stripProjects')}
          </Button>
        </div>
      </div>
    </GlassCard>
  );
}
