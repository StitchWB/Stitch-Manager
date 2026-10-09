import { useCallback } from 'react';
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
import { EmptyState } from '@/components/ui/EmptyState';
import { t } from '@/lib/i18n';
import { devboxJobCancel, devboxJobsLive, devboxTime } from '@/lib/backend/modules/devbox';
import { DevboxSection } from './DevboxSection';
import { runDevboxAction } from './runAction';
import { useDevboxPoll } from './useDevboxPoll';
import { DEVBOX_REFRESH_MS } from './constants';

export function DevboxJobs() {
  const fetcher = useCallback(() => devboxJobsLive(), []);
  const { data, error, reload } = useDevboxPoll(fetcher, DEVBOX_REFRESH_MS);
  const rows = Array.isArray(data) ? data : [];

  return (
    <DevboxSection
      title={t('devboxPage.sectionJobs')}
      error={error}
      onRetry={reload}
      testId="devbox-jobs"
    >
      {rows.length === 0 && !error ? (
        <EmptyState compact icon={Briefcase} title={t('devboxPage.jobsEmpty')} />
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
                    onConfirm={() => void runDevboxAction(devboxJobCancel(row.id), reload)}
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
