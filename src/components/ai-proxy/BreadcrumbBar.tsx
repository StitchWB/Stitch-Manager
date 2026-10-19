import { Link, useLocation, useSearchParams } from 'react-router-dom';

import { currentRailLabel } from '@/components/ai-proxy/AiHubLayout';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface BreadcrumbSegment {
  label: string;
  to?: string;
}

export function BreadcrumbBar() {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const tab = searchParams.get('tab');
  const pageLabel = currentRailLabel(pathname);

  const segments: BreadcrumbSegment[] = tab
    ? [
        { label: t('sidebar.aiHub'), to: '/ai' },
        { label: pageLabel, to: pathname },
        { label: tab },
      ]
    : [{ label: t('sidebar.aiHub'), to: '/ai' }, { label: pageLabel }];

  return (
    <nav
      aria-label={t('sidebar.aiHub')}
      data-testid="ai-hub-breadcrumb"
      className="flex shrink-0 items-center gap-1.5 border-b border-vsc-border-light bg-vsc-panel/60 px-3 py-1.5 text-[11px] md:px-4"
    >
      {segments.map((segment, index) => {
        const last = index === segments.length - 1;
        return (
          <span key={`${segment.label}-${index}`} className="flex items-center gap-1.5">
            {index > 0 ? (
              <span aria-hidden="true" className="text-slate-600">
                /
              </span>
            ) : null}
            {last || !segment.to ? (
              <span aria-current="page" className="font-medium text-slate-200">
                {segment.label}
              </span>
            ) : (
              <Link
                to={segment.to}
                className={cn('truncate text-slate-400 transition-colors hover:text-slate-200')}
              >
                {segment.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
