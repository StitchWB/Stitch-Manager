import { useCallback } from 'react';
import { ShieldQuestion, FileLock2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { Button } from '@/components/ui/Button';
import { ConfirmActionButton } from '@/components/ui/ConfirmActionButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Tooltip } from '@/components/ui/Tooltip';
import { t } from '@/lib/i18n';
import {
  devboxPermissionReply,
  devboxPermissionsPending,
  devboxTime,
} from '@/lib/backend/modules/devbox';
import { DevboxSection } from './DevboxSection';
import { runDevboxAction } from './runAction';
import { useDevboxPoll } from './useDevboxPoll';
import { DEVBOX_REFRESH_MS, DEVBOX_SECURITY_URL } from './constants';

export function DevboxPermissions() {
  const fetcher = useCallback(() => devboxPermissionsPending(), []);
  const { data, error, reload } = useDevboxPoll(fetcher, DEVBOX_REFRESH_MS);
  const rows = data?.rows ?? [];
  const degraded = error !== null || data?.bridge === 'down';

  return (
    <DevboxSection
      title={t('devboxPage.sectionPermissions')}
      caption={t('devboxPage.observationCaption')}
      testId="devbox-permissions"
    >
      <div className="flex flex-col gap-3">
        {degraded && (
          <div
            className="flex items-center gap-2 text-2xs text-slate-300"
            data-testid="devbox-permissions-degraded"
          >
            <span>{t('devboxPage.permissionsBridgeDown')}</span>
            <Button size="xs" variant="ghost" onClick={reload}>
              {t('common.retry')}
            </Button>
          </div>
        )}
        {rows.length === 0 ? (
          <EmptyState
            compact
            icon={ShieldQuestion}
            title={t('devboxPage.permissionsEmpty')}
            description={t('devboxPage.permissionsEmptyDesc')}
          />
        ) : (
          <Table containerClassName="rounded-lg border border-white/5">
            <TableHeader>
              <TableRow>
                <TableHead>{t('devboxPage.colTool')}</TableHead>
                <TableHead>{t('devboxPage.colSummary')}</TableHead>
                <TableHead>{t('devboxPage.colStarted')}</TableHead>
                <TableHead className="w-44" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(row => (
                <TableRow key={row.id}>
                  <TableCell>{row.tool}</TableCell>
                   <TableCell className="max-w-[24rem] truncate" title={row.summary}>{row.summary}</TableCell>
                  <TableCell>{devboxTime(row.startedAt)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Tooltip content={t('devboxPage.tipApproveOnce')}>
                        <Button
                          size="xs"
                          variant="primary"
                          data-testid={`devbox-permission-approve-${row.id}`}
                          onClick={() =>
                            void runDevboxAction(
                              devboxPermissionReply(row.id, 'once'),
                              reload,
                            )
                          }
                        >
                          {t('devboxPage.approveOnce')}
                        </Button>
                      </Tooltip>
                      <ConfirmActionButton
                        size="xs"
                        variant="danger"
                        data-testid={`devbox-permission-reject-${row.id}`}
                        tooltip={t('devboxPage.tipReject')}
                        onConfirm={() =>
                          void runDevboxAction(
                            devboxPermissionReply(row.id, 'reject'),
                            reload,
                          )
                        }
                      >
                        {t('devboxPage.reject')}
                      </ConfirmActionButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-white/10 bg-white/[0.02] p-3">
          <p className="text-2xs text-slate-400 flex items-start gap-1.5">
            <FileLock2 size={13} className="shrink-0 mt-0.5 text-slate-400" />
            <span data-testid="devbox-security-summary">{t('devboxPage.securitySummary')}</span>
          </p>
          <Button
            size="xs"
            variant="ghost"
            className="self-start"
            data-testid="devbox-security-link"
            onClick={() => window.open(DEVBOX_SECURITY_URL, '_blank', 'noopener,noreferrer')}
          >
            {t('devboxPage.securityLink')}
          </Button>
        </div>
      </div>
    </DevboxSection>
  );
}
