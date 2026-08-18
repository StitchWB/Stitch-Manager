import { useState } from 'react';
import { Clock3, Link2, PlugZap, RefreshCw, Search, SlidersHorizontal } from 'lucide-react';
import { Badge, Button, Checkbox, Input } from '@/components/ui';
import { t } from '@/lib/i18n';
import type { MailQueryFilters } from '@/stores/mail';

interface MailToolbarProps {
  query: MailQueryFilters;
  hasSession: boolean;
  hasActiveProfile: boolean;
  isConnecting: boolean;
  isSyncing: boolean;
  isWaiting: boolean;
  lastSyncAt: number | null;
  onQueryPatch: (patch: Partial<MailQueryFilters>) => void;
  onList: () => Promise<void>;
  onWait: () => Promise<void>;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
}

function formatLastSync(value: number | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleTimeString();
}

export function MailToolbar({
  query,
  hasSession,
  hasActiveProfile,
  isConnecting,
  isSyncing,
  isWaiting,
  lastSyncAt,
  onQueryPatch,
  onList,
  onWait,
  onConnect,
  onDisconnect,
}: MailToolbarProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);

  const disabled = !hasSession || isSyncing || isWaiting;
  const lastSync = formatLastSync(lastSyncAt);

  const filtersActiveCount = [
    query.from.trim(),
    query.to.trim(),
    query.subjectContains.trim(),
    query.bodyContains.trim(),
    query.since.trim(),
    query.unreadOnly ? '1' : '',
  ].filter(Boolean).length;

  return (
    <section className="bg-white/[0.03] border border-white/[0.08] rounded-xl">
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <Input
              placeholder={t('mail.toolbarSearchPlaceholder')}
              value={query.search}
              onChange={event => onQueryPatch({ search: event.target.value })}
              disabled={!hasSession}
              leftIcon={<Search size={14} />}
            />
          </div>

          <Button
            size="sm"
            variant={filtersOpen ? 'secondary' : 'ghost'}
            leftIcon={<SlidersHorizontal size={14} />}
            onClick={() => setFiltersOpen(value => !value)}
            disabled={!hasSession}
          >
            {filtersOpen ? t('mail.toolbarHideFilters') : t('mail.toolbarMoreFilters')}
            {filtersActiveCount > 0 ? (
              <Badge variant="info" size="sm" className="ml-1.5">
                {filtersActiveCount}
              </Badge>
            ) : null}
          </Button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {hasSession ? (
            <>
              <Button
                size="sm"
                onClick={() => {
                  void onList();
                }}
                disabled={disabled}
                leftIcon={<RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />}
              >
                {isSyncing ? t('common.loading') : t('mail.toolbarRefresh')}
              </Button>

              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void onWait();
                }}
                disabled={disabled}
                leftIcon={
                  isWaiting ? <RefreshCw size={14} className="animate-spin" /> : <Clock3 size={14} />
                }
              >
                {isWaiting ? t('mail.waitingAction') : t('mail.waitAction')}
              </Button>

              <div className="ml-auto">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void onDisconnect();
                  }}
                  disabled={isConnecting}
                  leftIcon={<Link2 size={14} />}
                  title={t('mail.disconnect')}
                >
                  {t('mail.disconnect')}
                </Button>
              </div>
            </>
          ) : (
            <Button
              size="sm"
              onClick={() => {
                void onConnect();
              }}
              disabled={isConnecting || !hasActiveProfile}
              leftIcon={
                isConnecting ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <PlugZap size={14} />
                )
              }
            >
              {isConnecting ? t('mail.connecting') : t('mail.connect')}
            </Button>
          )}
        </div>
      </div>

      {filtersOpen ? (
        <div className="border-t border-white/[0.06] p-3 space-y-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">
            {t('mail.advancedFiltersTitle')}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label={t('mail.fromLabel')}
              value={query.from}
              onChange={event => onQueryPatch({ from: event.target.value })}
              disabled={!hasSession}
              placeholder="example@domain.com"
            />
            <Input
              label={t('mail.toLabel')}
              value={query.to}
              onChange={event => onQueryPatch({ to: event.target.value })}
              disabled={!hasSession}
              placeholder="example@domain.com"
            />
            <Input
              label={t('mail.subjectLabel')}
              value={query.subjectContains}
              onChange={event => onQueryPatch({ subjectContains: event.target.value })}
              disabled={!hasSession}
            />
            <Input
              label={t('mail.bodyLabel')}
              value={query.bodyContains}
              onChange={event => onQueryPatch({ bodyContains: event.target.value })}
              disabled={!hasSession}
            />
            <Input
              label={t('mail.sinceLabel')}
              value={query.since}
              onChange={event => onQueryPatch({ since: event.target.value })}
              disabled={!hasSession}
              placeholder="2025-01-01T00:00:00Z"
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-28">
              <Input
                label={t('mail.limitLabel')}
                type="number"
                value={String(query.limit)}
                onChange={event => onQueryPatch({ limit: Number(event.target.value) || 1 })}
                disabled={!hasSession}
              />
            </div>
            <div className="pb-1.5">
              <Checkbox
                checked={query.unreadOnly}
                onChange={event => onQueryPatch({ unreadOnly: event.target.checked })}
                label={t('mail.unreadOnly')}
                disabled={!hasSession}
              />
            </div>
          </div>
        </div>
      ) : null}

      {lastSync ? (
        <div className="border-t border-white/[0.06] px-3 py-1.5">
          <p className="text-[10px] text-slate-500">
            {t('mail.lastSyncedAt', { time: lastSync })}
          </p>
        </div>
      ) : null}

      {!hasSession && hasActiveProfile && isConnecting ? (
        <div className="border-t border-white/[0.06] px-3 py-1.5">
          <p className="text-[10px] text-indigo-300 flex items-center gap-1.5">
            <RefreshCw size={10} className="animate-spin" />
            {t('mail.connecting')}
          </p>
        </div>
      ) : null}
    </section>
  );
}
