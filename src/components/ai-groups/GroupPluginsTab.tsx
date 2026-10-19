import { useCallback, useEffect, useState } from 'react';
import { Puzzle } from 'lucide-react';
import { appToast } from '@/lib/observability/toast';
import {
  GlassCard,
  Badge,
  EmptyState,
  SkeletonLoader,
  Toggle,
} from '@/components/ui';
import { t } from '@/lib/i18n';
import {
  groupPluginList,
  groupPluginToggle,
  type GroupPluginListResponse,
} from '@/lib/backend/modules/groupPlugins';

interface GroupPluginsTabProps {
  groupId: string;
  isOwner: boolean;
}

const LEVEL_VARIANT: Record<string, 'slate' | 'success' | 'danger'> = {
  open: 'slate',
  verified: 'success',
  suspended: 'danger',
};

const AUDIENCE_VARIANT: Record<string, 'slate' | 'indigo' | 'info' | 'warning'> = {
  public: 'slate',
  group: 'indigo',
  tier: 'info',
  private: 'warning',
};

/**
 * Group plugins tab — marketplace plugins with their audience and the
 * group's granted state. Owners toggle grants (optimistic update +
 * rollback + refetch; the backend gates grants by audience, group level
 * and the gated-plugin cap). Members see a read-only list.
 */
export function GroupPluginsTab({ groupId, isOwner }: GroupPluginsTabProps) {
  const [data, setData] = useState<GroupPluginListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const load = useCallback(() => {
    groupPluginList(groupId)
      .then(res => {
        setData(res);
        setError(null);
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleToggle = async (pluginId: string, next: boolean) => {
    setUpdating(pluginId);
    setData(prev =>
      prev && {
        ...prev,
        plugins: prev.plugins.map(p =>
          p.id === pluginId ? { ...p, granted: next } : p,
        ),
      },
    );
    try {
      await groupPluginToggle({ groupId, pluginId, granted: next });
      appToast.success(t('ai.groups.plugins.updated'), 'ai-groups');
      load();
    } catch (e) {
      setData(prev =>
        prev && {
          ...prev,
          plugins: prev.plugins.map(p =>
            p.id === pluginId ? { ...p, granted: !next } : p,
          ),
        },
      );
      appToast.error(
        e instanceof Error ? e.message : t('ai.groups.plugins.toggleFailed'),
        'ai-groups',
      );
    } finally {
      setUpdating(null);
    }
  };

  if (loading) {
    return (
      <GlassCard className="p-3 md:p-4">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold text-slate-100">
            {t('ai.groups.plugins.title')}
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
          icon={Puzzle}
          title={t('ai.groups.detailLoadFailed')}
          description={error}
        />
      </GlassCard>
    );
  }

  const plugins = data?.plugins ?? [];
  const grantedCount = plugins.filter(p => p.granted).length;

  return (
    <GlassCard className="p-3 md:p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold text-slate-100 truncate">
            {t('ai.groups.plugins.title')}
          </h3>
          {data && (
            <Badge variant={LEVEL_VARIANT[data.level] ?? 'slate'} size="sm">
              {t(`ai.groups.plugins.level.${data.level}`)}
            </Badge>
          )}
          {data && plugins.length > 0 && (
            <Badge variant="slate" size="sm">
              {t('ai.groups.plugins.cap', {
                used: grantedCount,
                max: data.maxGatedPlugins,
              })}
            </Badge>
          )}
        </div>
      </div>

      {plugins.length === 0 ? (
        <EmptyState compact icon={Puzzle} title={t('ai.groups.plugins.empty')} />
      ) : (
        <div className="divide-y divide-white/[0.06]">
          {plugins.map(p => (
            <div key={p.id} className="px-1 py-2.5 flex items-center gap-2">
              <Puzzle size={14} className="text-slate-400 shrink-0" />
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-sm text-slate-100 truncate">{p.name}</span>
                {/* eslint-disable-next-line i18next/no-literal-string -- non-translatable plugin id/version token */}
                <span className="text-[10px] text-slate-500 font-mono truncate">{p.id} · v{p.version}</span>
              </div>
              <Badge variant={AUDIENCE_VARIANT[p.audience] ?? 'slate'} size="sm">
                {t(`ai.groups.plugins.audience.${p.audience}`)}
              </Badge>
              {isOwner ? (
                <Toggle
                  size="sm"
                  checked={p.granted}
                  disabled={updating === p.id}
                  onChange={next => void handleToggle(p.id, next)}
                  label={
                    p.granted
                      ? t('ai.groups.plugins.granted')
                      : t('ai.groups.plugins.notGranted')
                  }
                />
              ) : (
                <Badge variant={p.granted ? 'success' : 'slate'} size="sm">
                  {p.granted
                    ? t('ai.groups.plugins.granted')
                    : t('ai.groups.plugins.notGranted')}
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}

      {!isOwner && plugins.length > 0 && (
        <p className="mt-3 text-xs text-slate-500">
          {t('ai.groups.plugins.memberReadonly')}
        </p>
      )}
    </GlassCard>
  );
}
