import { useCallback, useEffect, useMemo, useState } from 'react';
import { Gauge, Trash2, User, Users } from 'lucide-react';
import { appToast } from '@/lib/observability/toast';
import {
  GlassCard,
  Badge,
  Button,
  IconButton,
  Input,
  Select,
  SegmentedControl,
  EmptyState,
  SkeletonLoader,
  ProgressBar,
} from '@/components/ui';
import { t, getLocale } from '@/lib/i18n';
import { useGroupsStore } from '@/stores/groups';
import {
  groupsQuotaRulesList,
  groupsQuotaRuleSet,
  groupsQuotaRuleDelete,
  type GroupQuotaRule,
  type GroupQuotaSubject,
  type GroupQuotaUnit,
  type GroupQuotaPeriod,
} from '@/lib/backend/modules/groups';

interface GroupQuotasTabProps {
  groupId: string;
  isOwner: boolean;
}

function progressVariant(pct: number): 'success' | 'warning' | 'danger' {
  if (pct >= 100) return 'danger';
  if (pct >= 70) return 'warning';
  return 'success';
}

function formatAmount(amount: number): string {
  return amount.toLocaleString(getLocale() === 'ru' ? 'ru-RU' : 'en-US');
}

/**
 * Quotas tab — flexible quota rules (per-member / whole-pool ×
 * requests/tokens × daily/total × per-model).  Owners manage rules;
 * members see the list read-only with current-usage progress bars
 * (``used`` is computed server-side per rule).
 */
export function GroupQuotasTab({ groupId, isOwner }: GroupQuotasTabProps) {
  const detailMembers = useGroupsStore(s => s.detail?.members);
  const memberName = useMemo(() => {
    const map = new Map<number, string>();
    for (const m of detailMembers ?? []) map.set(m.user_id, m.username);
    return (uid: number | null) => (uid != null ? `@${map.get(uid) ?? uid}` : null);
  }, [detailMembers]);

  const [rules, setRules] = useState<GroupQuotaRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [subject, setSubject] = useState<GroupQuotaSubject>('member');
  const [userId, setUserId] = useState('');
  const [model, setModel] = useState('');
  const [unit, setUnit] = useState<GroupQuotaUnit>('tokens');
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState<GroupQuotaPeriod>('daily');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    groupsQuotaRulesList(groupId)
      .then(res => {
        setRules(res.rules ?? []);
        setError(null);
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async () => {
    const trimmed = amount.trim();
    let parsed: number | null = null;
    if (trimmed !== '') {
      const num = Number(trimmed);
      if (!Number.isInteger(num) || num < 1) {
        appToast.error(t('ai.groups.quotas.invalidAmount'), 'ai-groups');
        return;
      }
      parsed = num;
    }
    setSaving(true);
    try {
      await groupsQuotaRuleSet({
        groupId,
        subject,
        userId: subject === 'member' && userId !== '' ? Number(userId) : null,
        model: model.trim() || null,
        unit,
        amount: parsed,
        period,
      });
      setAmount('');
      setModel('');
      appToast.success(t('ai.groups.quotas.saved'), 'ai-groups');
      load();
    } catch (e) {
      appToast.error(e instanceof Error ? e.message : t('ai.groups.detailLoadFailed'), 'ai-groups');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (ruleId: string) => {
    try {
      await groupsQuotaRuleDelete({ groupId, ruleId });
      appToast.success(t('ai.groups.quotas.deleted'), 'ai-groups');
      setRules(prev => prev.filter(r => r.id !== ruleId));
    } catch (e) {
      appToast.error(e instanceof Error ? e.message : t('ai.groups.detailLoadFailed'), 'ai-groups');
    }
  };

  if (loading) {
    return (
      <GlassCard className="p-3 md:p-4">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold text-slate-100">
            {t('ai.groups.quotas.title')}
          </h3>
        </div>
        <div className="space-y-2">
          <SkeletonLoader variant="rectangle" height="h-14" count={2} />
        </div>
      </GlassCard>
    );
  }

  if (error) {
    return (
      <GlassCard className="p-3 md:p-4">
        <EmptyState
          compact
          icon={Gauge}
          title={t('ai.groups.detailLoadFailed')}
          description={error}
        />
      </GlassCard>
    );
  }

  const ruleSummary = (rule: GroupQuotaRule): string => {
    const who =
      rule.subject === 'pool'
        ? t('ai.groups.quotas.wholePool')
        : memberName(rule.user_id) ?? t('ai.groups.quotas.everyone');
    const what =
      rule.amount == null
        ? t('ai.groups.quotas.unlimited')
        : `${formatAmount(rule.amount)} ${
            rule.unit === 'tokens'
              ? t('ai.groups.quotas.unitTokens').toLowerCase()
              : t('ai.groups.quotas.unitRequests').toLowerCase()
          }`;
    const when =
      rule.period === 'daily'
        ? t('ai.groups.quotas.periodDaily').toLowerCase()
        : t('ai.groups.quotas.periodTotal').toLowerCase();
    const where = rule.model ?? t('ai.groups.quotas.allModels');
    return `${who} · ${where} · ${what} · ${when}`;
  };

  return (
    <GlassCard className="p-3 md:p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold text-slate-100 truncate">
            {t('ai.groups.quotas.title')}
          </h3>
          {rules.length > 0 && (
            <Badge variant="slate" size="sm">
              {rules.length}
            </Badge>
          )}
        </div>
      </div>

      {rules.length === 0 ? (
        <EmptyState
          compact
          icon={Gauge}
          title={t('ai.groups.quotas.empty')}
        />
      ) : (
        <div className="divide-y divide-white/[0.06]">
          {rules.map(rule => {
            const pct =
              rule.amount != null && rule.amount > 0
                ? (rule.used / rule.amount) * 100
                : 0;
            return (
              <div key={rule.id} className="px-1 py-2.5">
                <div className="flex items-center gap-2">
                  {rule.subject === 'pool' ? (
                    <Users size={14} className="text-slate-400 shrink-0" />
                  ) : (
                    <User size={14} className="text-slate-400 shrink-0" />
                  )}
                  <span className="text-sm text-slate-100 truncate flex-1">
                    {ruleSummary(rule)}
                  </span>
                  {isOwner && (
                    <IconButton
                      size="sm"
                      variant="ghost"
                      aria-label={t('ai.groups.quotas.deleteRule')}
                      onClick={() => handleDelete(rule.id)}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  )}
                </div>
                {rule.amount != null && (
                  <div className="flex flex-col gap-1.5 mt-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-400">
                        {rule.period === 'daily'
                          ? t('ai.groups.usage.today')
                          : t('ai.groups.quotas.periodTotal')}
                      </span>
                      <span className="text-xs font-medium text-slate-300">
                        {formatAmount(rule.used)}/{formatAmount(rule.amount)}
                      </span>
                    </div>
                    <ProgressBar
                      value={rule.used}
                      max={rule.amount}
                      variant={progressVariant(pct)}
                      size="sm"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {isOwner && (
        <div className="mt-4 border-t border-white/[0.06] pt-4">
          <div className="flex flex-col gap-2">
            <SegmentedControl
              options={[
                { value: 'member', label: t('ai.groups.quotas.scopeMember') },
                { value: 'pool', label: t('ai.groups.quotas.scopePool') },
              ]}
              value={subject}
              onChange={v => setSubject(v as GroupQuotaSubject)}
            />
            <div className="grid grid-cols-2 gap-2">
              {subject === 'member' && (
                <Select
                  aria-label={t('ai.groups.quotas.scopeMember')}
                  value={userId}
                  onValueChange={setUserId}
                  options={[
                    { value: '', label: t('ai.groups.quotas.everyone') },
                    ...(detailMembers ?? []).map(m => ({
                      value: String(m.user_id),
                      label: `@${m.username}`,
                    })),
                  ]}
                />
              )}
              <Input
                label={t('ai.groups.quotas.modelLabel')}
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder={t('ai.groups.quotas.modelPh')}
              />
              <Select
                aria-label={t('ai.groups.quotas.unitLabel')}
                value={unit}
                onValueChange={v => setUnit(v as GroupQuotaUnit)}
                options={[
                  { value: 'requests', label: t('ai.groups.quotas.unitRequests') },
                  { value: 'tokens', label: t('ai.groups.quotas.unitTokens') },
                ]}
              />
              <Input
                type="number"
                label={t('ai.groups.quotas.amountLabel')}
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder={t('ai.groups.quotas.amountPh')}
                min={1}
              />
              <Select
                aria-label={t('ai.groups.quotas.periodLabel')}
                value={period}
                onValueChange={v => setPeriod(v as GroupQuotaPeriod)}
                options={[
                  { value: 'daily', label: t('ai.groups.quotas.periodDaily') },
                  { value: 'total', label: t('ai.groups.quotas.periodTotal') },
                ]}
              />
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="primary"
                onClick={handleAdd}
                isLoading={saving}
              >
                {t('ai.groups.quotas.addRule')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </GlassCard>
  );
}
