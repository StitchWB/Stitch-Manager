import { Briefcase } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { ConfirmActionButton } from '@/components/ui/ConfirmActionButton';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { t } from '@/lib/i18n';
import {
  devboxJobCancel,
  devboxTime,
  type DevboxJobRow,
  type DevboxObserved,
} from '@/lib/backend/modules/devbox';
import { DevboxSection } from './DevboxSection';
import { runDevboxAction } from './runAction';

export interface DevboxJobsProps {
  data: DevboxObserved<DevboxJobRow> | null;
  error: string | null;
  onRetry: () => void;
}

export function DevboxJobs({ data, error, onRetry }: DevboxJobsProps) {
  const rows = data?.rows ?? [];
  const degraded = data?.bridge === 'down';

  return (
    <DevboxSection
      title={t('devboxPage.sectionJobs')}
      error={error}
      onRetry={onRetry}
      testId="devbox-jobs"
    >
      {degraded && (
        <div
          className="flex items-center gap-2 mb-2 text-2xs text-slate-300"
          data-testid="devbox-jobs-degraded"
        >
          <span>{t('devboxPage.jobsBridgeDown')}</span>
          <Button size="xs" variant="ghost" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState
          compact
          icon={Briefcase}
          title={t('devboxPage.jobsEmpty')}
          description={t('devboxPage.jobsEmptyDesc')}
        />
      ) : (
        <Table containerClassName="rounded-lg border border-white/5">
          <TableHeader>
            <TableRow>
              <TableHead>{t('common.id')}</TableHead>
              <TableHead>{t('devboxPage.colTool')}</TableHead>
              <TableHead>{t('devboxPage.colStatus')}</TableHead>
              <TableHead>{t('devboxPage.colStarted')}</TableHead>
              <TableHead>{t('devboxPage.colSession')}</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(row => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-2xs">{row.id}</TableCell>
                <TableCell>{row.tool}</TableCell>
                <TableCell>{row.status}</TableCell>
                <TableCell>{devboxTime(row.startedAt)}</TableCell>
                <TableCell className="font-mono text-2xs text-slate-400">
                  {row.sessionId ?? '—'}
                </TableCell>
                <TableCell>
                   <ConfirmActionButton
                     size="xs"
                     variant="danger"
                     data-testid={`devbox-job-cancel-${row.id}`}
                     tooltip={t('devboxPage.tipCancelJob')}
                     onConfirm={() => void runDevboxAction(devboxJobCancel(row.id), onRetry)}
                   >
                    {t('devboxPage.cancelJob')}
                  </ConfirmActionButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </DevboxSection>
  );
}
