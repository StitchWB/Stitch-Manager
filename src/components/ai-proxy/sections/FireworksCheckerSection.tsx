import { useState } from 'react';
import { CheckCircle2, History, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { checkFireworksApiKey } from '@/lib/backend/modules/accounts';
import type { FireworksKeyStatus } from '@/types/generated';
import {
  Button,
  EmptyState,
  GlassCard,
  Input,
  KeyValueList,
  StatusBadge,
} from '@/components/ui';
import type { KeyValueRow } from '@/components/ui';
import { t } from '@/lib/i18n';

type FireworksCheckStatus = 'active' | 'frozen' | 'limit' | 'invalid';

type FireworksHistoryEntry = {
  id: string;
  timestamp: number;
  keyTail: string;
  status: FireworksCheckStatus;
};

const FIREWORKS_HISTORY_LIMIT = 5;

function deriveFireworksStatus(result: FireworksKeyStatus): FireworksCheckStatus {
  if (!result.valid) return 'invalid';
  if (result.isFrozen) return 'frozen';
  if (result.isLimitReached) return 'limit';
  return 'active';
}

function fireworksStatusToBadge(status: FireworksCheckStatus): {
  status: 'active' | 'error' | 'warning';
  label: string;
} {
  switch (status) {
    case 'active':
      return { status: 'active', label: t('aiHub.apiKeys.fireworks.statusActive') };
    case 'frozen':
      return { status: 'warning', label: t('aiHub.apiKeys.fireworks.statusFrozen') };
    case 'limit':
      return { status: 'warning', label: t('aiHub.apiKeys.fireworks.statusLimit') };
    case 'invalid':
    default:
      return { status: 'error', label: t('aiHub.apiKeys.fireworks.statusInvalid') };
  }
}

function formatTimestamp(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleTimeString();
  } catch {
    return '';
  }
}

export function FireworksCheckerSection() {
  const [fireworksCheckKey, setFireworksCheckKey] = useState('');
  const [fireworksCheckResult, setFireworksCheckResult] = useState<FireworksKeyStatus | null>(null);
  const [fireworksHistory, setFireworksHistory] = useState<FireworksHistoryEntry[]>([]);
  const [isCheckingFireworks, setIsCheckingFireworks] = useState(false);

  const handleCheckFireworks = async () => {
    const key = fireworksCheckKey.trim();
    if (!key) {
      toast.error(t('aiHub.apiKeys.fireworks.checkKeyRequired'));
      return;
    }
    setIsCheckingFireworks(true);
    try {
      const result = await checkFireworksApiKey({ apiKey: key });
      setFireworksCheckResult(result);

      const status = deriveFireworksStatus(result);
      const tail = key.slice(-4);
      const entry: FireworksHistoryEntry = {
        id: `${Date.now()}-${tail}`,
        timestamp: Date.now(),
        keyTail: tail,
        status,
      };
      setFireworksHistory(prev => [entry, ...prev].slice(0, FIREWORKS_HISTORY_LIMIT));

      if (result.valid) {
        if (result.isFrozen) {
          toast.warning(`Account frozen: ${result.suspendState || 'unknown'}`);
        } else if (result.isLimitReached) {
          toast.warning('Monthly spend limit reached');
        } else {
          toast.success(
            `Monthly remaining: $${result.monthlySpendRemaining?.toFixed(2) || '0.00'}`
          );
        }
      } else {
        toast.error(result.statusMessage || 'Invalid API key');
      }
    } catch (error) {
      console.error('Failed to check Fireworks key:', error);
      toast.error('Failed to check Fireworks key status');
    } finally {
      setIsCheckingFireworks(false);
    }
  };

  const renderFireworksResultRows = (result: FireworksKeyStatus): KeyValueRow[] => {
    const rows: KeyValueRow[] = [];
    if (result.accountName) {
      rows.push({
        id: 'account',
        label: t('aiHub.apiKeys.fireworks.account'),
        value: result.accountName,
      });
    }
    if (result.accountEmail) {
      rows.push({
        id: 'email',
        label: t('aiHub.apiKeys.fireworks.email'),
        value: result.accountEmail,
      });
    }
    if (result.suspendState) {
      rows.push({
        id: 'suspend',
        label: t('aiHub.apiKeys.fireworks.suspendState'),
        value: result.suspendState,
        tone: result.suspendState === 'UNSUSPENDED' ? 'success' : 'danger',
      });
    }
    if (result.tier) {
      rows.push({
        id: 'tier',
        label: t('aiHub.apiKeys.fireworks.tier'),
        value: result.tier,
      });
    }
    if (typeof result.monthlySpendLimit === 'number') {
      rows.push({
        id: 'limit',
        label: t('aiHub.apiKeys.fireworks.monthlySpendLimit'),
        value: `$${result.monthlySpendLimit.toFixed(2)}`,
      });
    }
    if (typeof result.monthlySpendUsed === 'number') {
      rows.push({
        id: 'used',
        label: t('aiHub.apiKeys.fireworks.totalSpent'),
        value: `$${result.monthlySpendUsed.toFixed(2)}`,
      });
    }
    if (typeof result.monthlySpendRemaining === 'number') {
      rows.push({
        id: 'remaining',
        label: t('aiHub.apiKeys.fireworks.monthlyRemaining'),
        value: `$${result.monthlySpendRemaining.toFixed(2)}`,
        tone: result.monthlySpendRemaining > 0 ? 'success' : 'danger',
      });
    }
    return rows;
  };

  const renderFireworksHistoryList = () => {
    if (fireworksHistory.length === 0) {
      return (
        <EmptyState
          compact
          icon={History}
          title={t('aiHub.apiKeys.fireworks.historyEmpty')}
        />
      );
    }
    return (
      <ul className="space-y-1.5">
        {fireworksHistory.map(entry => {
          const badge = fireworksStatusToBadge(entry.status);
          return (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-xs"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-slate-500 tabular-nums shrink-0">
                  {formatTimestamp(entry.timestamp)}
                </span>
                <span className="font-mono text-slate-300 truncate">
                  {t('aiHub.apiKeys.fireworks.keyTail', { tail: entry.keyTail })}
                </span>
              </div>
              <StatusBadge status={badge.status} size="sm" withDot>
                {badge.label}
              </StatusBadge>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <GlassCard className="p-4 md:p-5 space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck size={14} className="text-slate-400" />
        <span className="text-[10px] uppercase tracking-wider text-slate-500">
          {t('aiHub.apiKeys.sections.checkerTitle')}
        </span>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          type="text"
          placeholder={t('aiHub.apiKeys.fireworks.checkPlaceholder')}
          value={fireworksCheckKey}
          onChange={e => setFireworksCheckKey(e.target.value)}
          className="flex-1 font-mono text-xs"
        />
        <Button
          variant="primary"
          size="sm"
          onClick={handleCheckFireworks}
          isLoading={isCheckingFireworks}
          leftIcon={<CheckCircle2 size={14} />}
        >
          {t('aiHub.apiKeys.fireworks.checkKey')}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">
              {t('aiHub.apiKeys.fireworks.result')}
            </span>
            {fireworksCheckResult ? (
              (() => {
                const status = deriveFireworksStatus(fireworksCheckResult);
                const badge = fireworksStatusToBadge(status);
                return (
                  <StatusBadge status={badge.status} size="sm" withDot>
                    {badge.label}
                  </StatusBadge>
                );
              })()
            ) : null}
          </div>
          {fireworksCheckResult ? (
            <>
              <KeyValueList
                rows={renderFireworksResultRows(fireworksCheckResult)}
                density="compact"
              />
              <div className="mt-2 text-[10px] text-slate-500 italic border-t border-white/5 pt-2">
                {t('aiHub.apiKeys.fireworks.prepaidCreditsNote')}
              </div>
              {fireworksCheckResult.statusMessage ? (
                <div
                  className={
                    'mt-2 p-2 rounded border text-[11px] ' +
                    (fireworksCheckResult.isFrozen || !fireworksCheckResult.valid
                      ? 'bg-red-500/10 border-red-500/20 text-red-300'
                      : fireworksCheckResult.isLimitReached
                        ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
                        : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300')
                  }
                >
                  {fireworksCheckResult.statusMessage}
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-slate-500">
              {t('aiHub.apiKeys.fireworks.noResultYet')}
            </p>
          )}
        </div>

        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2">
              <History size={12} className="text-slate-400" />
              <span className="text-[10px] uppercase tracking-wider text-slate-500">
                {t('aiHub.apiKeys.fireworks.historyTitle')}
              </span>
            </div>
            <span className="text-[10px] text-slate-500 tabular-nums">
              {fireworksHistory.length}/{FIREWORKS_HISTORY_LIMIT}
            </span>
          </div>
          {renderFireworksHistoryList()}
        </div>
      </div>
    </GlassCard>
  );
}
