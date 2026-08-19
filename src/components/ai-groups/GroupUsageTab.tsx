import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { toast } from 'sonner';
import {
  GlassCard,
  Badge,
  Button,
  Input,
  KeyValueList,
  EmptyState,
  SkeletonLoader,
} from '@/components/ui';
import { t } from '@/lib/i18n';
import { useGroupsStore } from '@/stores/groups';
import {
  groupsUsageList,
  groupsSetQuota,
  type GroupUsageRow,
} from '@/lib/backend/modules/groups';

interface GroupUsageTabProps {
  groupId: string;
  isOwner: boolean;
}

interface MemberAggregate {
  user_id: number;
  username: string;
  todayRequests: number;
  todayTokens: number;
  weekRequests: number;
  weekTokens: number;
}

/** UTC today as 'YYYY-MM-DD' — matches the backend's `day` format. */
function utcToday(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Aggregate raw rows by user_id into per-member today + 7d totals. */
function aggregateByMember(rows: GroupUsageRow[]): MemberAggregate[] {
  const today = utcToday();
  const map = new Map<number, MemberAggregate>();
  for (const row of rows) {
    let agg = map.get(row.user_id);
    if (!agg) {
      agg = {
        user_id: row.user_id,
        username: row.username,
        todayRequests: 0,
        todayTokens: 0,
        weekRequests: 0,
        weekTokens: 0,
      };
      map.set(row.user_id, agg);
    }
    const isToday = row.day === today;
    if (isToday) {
      agg.todayRequests += row.requests;
      agg.todayTokens += row.tokens;
    }
    agg.weekRequests += row.requests;
    agg.weekTokens += row.tokens;
  }
  return Array.from(map.values()).sort((a, b) => b.weekRequests - a.weekRequests);
}

/**
 * Usage tab. Fetches groups_usage_list on mount. Owners see per-member
 * aggregation cards (today + 7d requests/tokens) plus a quota block
 * (Input bound to group.max_requests_per_member_daily, empty=unlimited).
 * Members see their own rows by day.
 */
export function GroupUsageTab({ groupId, isOwner }: GroupUsageTabProps) {
  const { detail, fetchDetail } = useGroupsStore();
  const [rows, setRows] = useState<GroupUsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quotaDraft, setQuotaDraft] = useState('');
  const [prevQuota, setPrevQuota] = useState<number | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const group = detail?.group;
  const currentQuota = group?.max_requests_per_member_daily;

  // Sync quotaDraft when the store's quota value changes (initial load).
  if (currentQuota !== prevQuota) {
    setPrevQuota(currentQuota);
    setQuotaDraft(currentQuota != null ? String(currentQuota) : '');
  }

  useEffect(() => {
    let cancelled = false;
    groupsUsageList(groupId)
      .then(res => {
        if (!cancelled) {
          setRows(res.rows ?? []);
          setError(null);
        }
      })
      .catch(e => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  const handleSaveQuota = async () => {
    const trimmed = quotaDraft.trim();
    const parsed = trimmed === '' ? null : Math.max(0, Math.floor(Number(trimmed)));
    if (trimmed !== '' && (Number.isNaN(parsed) || (parsed as number) < 1)) {
      toast.error(t('ai.groups.usage.quotaHint'));
      return;
    }
    setSaving(true);
    try {
      await groupsSetQuota({ groupId, maxPerMemberDaily: parsed });
      // Optimistically update local draft since the backend response may
      // not include the quota field in older _group_to_dict serialisation.
      setPrevQuota(parsed);
      setQuotaDraft(parsed != null ? String(parsed) : '');
      await fetchDetail(groupId);
      toast.success(t('ai.groups.usage.saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('ai.groups.detailLoadFailed'));
    } finally {
      setSaving(false);
    }
  };

  const quotaDirty = (() => {
    const trimmed = quotaDraft.trim();
    const currentStr = currentQuota != null ? String(currentQuota) : '';
    return trimmed !== currentStr;
  })();

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <GlassCard className="p-3 md:p-4">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold text-slate-100">
            {t('ai.groups.usage.title')}
          </h3>
        </div>
        <div className="space-y-2">
          <SkeletonLoader variant="rectangle" height="h-14" count={3} />
        </div>
      </GlassCard>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <GlassCard className="p-3 md:p-4">
        <EmptyState
          compact
          icon={Activity}
          title={t('ai.groups.detailLoadFailed')}
          description={error}
        />
      </GlassCard>
    );
  }

  const aggregates = isOwner ? aggregateByMember(rows) : [];
  const ownRows = isOwner ? [] : rows;

  return (
    <GlassCard className="p-3 md:p-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold text-slate-100 truncate">
            {t('ai.groups.usage.title')}
          </h3>
          {rows.length > 0 && (
            <Badge variant="slate" size="sm">
              {isOwner ? aggregates.length : ownRows.length}
            </Badge>
          )}
        </div>
      </div>

      {/* Quota block — owner only */}
      {isOwner && (
        <div className="mb-4 border-b border-white/[0.06] pb-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-end gap-2">
              <div className="flex-1 min-w-0">
                <Input
                  type="number"
                  label={t('ai.groups.usage.quotaLabel')}
                  value={quotaDraft}
                  onChange={e => setQuotaDraft(e.target.value)}
                  placeholder={t('ai.groups.usage.unlimited')}
                  min={1}
                  containerClassName="w-full"
                />
              </div>
              <Button
                size="sm"
                variant="primary"
                onClick={handleSaveQuota}
                isLoading={saving}
                disabled={!quotaDirty}
              >
                {t('common.save')}
              </Button>
            </div>
            <p className="text-[11px] text-slate-500">
              {t('ai.groups.usage.quotaHint')}
            </p>
          </div>
        </div>
      )}

      {/* Body */}
      {rows.length === 0 ? (
        <EmptyState
          compact
          icon={Activity}
          title={t('ai.groups.usage.empty')}
        />
      ) : isOwner ? (
        <div className="divide-y divide-white/[0.06]">
          {aggregates.map(agg => (
            <div key={agg.user_id} className="px-1 py-2.5">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm text-slate-100 truncate">
                  @{agg.username}
                </span>
              </div>
              <KeyValueList
                density="compact"
                rows={[
                  {
                    id: `${agg.user_id}-today-req`,
                    label: `${t('ai.groups.usage.today')} · ${t('ai.groups.usage.requests')}`,
                    value: agg.todayRequests,
                  },
                  {
                    id: `${agg.user_id}-today-tok`,
                    label: `${t('ai.groups.usage.today')} · ${t('ai.groups.usage.tokens')}`,
                    value: agg.todayTokens,
                  },
                  {
                    id: `${agg.user_id}-week-req`,
                    label: `${t('ai.groups.usage.week')} · ${t('ai.groups.usage.requests')}`,
                    value: agg.weekRequests,
                  },
                  {
                    id: `${agg.user_id}-week-tok`,
                    label: `${t('ai.groups.usage.week')} · ${t('ai.groups.usage.tokens')}`,
                    value: agg.weekTokens,
                  },
                ]}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="divide-y divide-white/[0.06]">
          {ownRows.map((row, idx) => (
            <div key={`${row.user_id}-${row.day}-${idx}`} className="px-1 py-2.5">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm text-slate-100 truncate">
                  {row.day}
                </span>
              </div>
              <KeyValueList
                density="compact"
                rows={[
                  {
                    id: `${row.day}-req`,
                    label: t('ai.groups.usage.requests'),
                    value: row.requests,
                  },
                  {
                    id: `${row.day}-tok`,
                    label: t('ai.groups.usage.tokens'),
                    value: row.tokens,
                  },
                ]}
              />
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
