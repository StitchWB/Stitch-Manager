import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, History } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { IconButton } from '@/components/ui/IconButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { devboxTime, type DevboxRecentAction } from '@/lib/backend/modules/devbox';
import { DevboxSection } from './DevboxSection';

export interface DevboxActionsProps {
  recent: DevboxRecentAction[] | null;
}

export function DevboxActions({ recent }: DevboxActionsProps) {
  const rows = Array.isArray(recent) ? recent : [];
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <DevboxSection title={t('devboxPage.sectionActions')} testId="devbox-actions">
      {rows.length === 0 ? (
        <EmptyState compact icon={History} title={t('devboxPage.actionsEmpty')} />
      ) : (
        <Table containerClassName="rounded-lg border border-white/5">
          <TableHeader>
            <TableRow>
              <TableHead>{t('devboxPage.colCmd')}</TableHead>
              <TableHead>{t('devboxPage.colStatus')}</TableHead>
              <TableHead>{t('devboxPage.colStarted')}</TableHead>
              <TableHead>{t('devboxPage.colFinished')}</TableHead>
              <TableHead>{t('devboxPage.colExit')}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(row => {
              const expanded = expandedId === row.id;
              const hasPayload = Boolean(row.payload && typeof row.payload === 'object');
              return (
                <Fragment key={row.id}>
                  <TableRow>
                    <TableCell className="font-mono text-2xs">{row.cmd}</TableCell>
                    <TableCell
                      className={cn(
                        row.status === 'failed' && 'text-red-300',
                        row.status === 'finished' && 'text-emerald-300',
                      )}
                    >
                      {row.status}
                    </TableCell>
                    <TableCell>{devboxTime(row.startedAt)}</TableCell>
                    <TableCell>{devboxTime(row.finishedAt)}</TableCell>
                    <TableCell>{row.exit ?? '—'}</TableCell>
                    <TableCell>
                      {hasPayload && (
                        <IconButton
                          size="sm"
                          aria-label={expanded ? t('devboxPage.hidePayload') : t('devboxPage.showPayload')}
                          data-testid={`devbox-action-payload-${row.id}`}
                          onClick={() => setExpandedId(expanded ? null : row.id)}
                        >
                          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </IconButton>
                      )}
                    </TableCell>
                  </TableRow>
                  {expanded && hasPayload && (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <pre className="max-h-48 overflow-auto rounded-lg border border-white/5 bg-black/40 p-2 font-mono text-2xs text-slate-300 whitespace-pre-wrap">
                          {JSON.stringify(row.payload, null, 2)}
                        </pre>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}
    </DevboxSection>
  );
}
