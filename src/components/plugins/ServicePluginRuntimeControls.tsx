/**
 * Host-level runtime controls for a service-plugin page.
 *
 * `PluginRuntimeStrip` renders the plugin's runtime status (badge, pid,
 * uptime, restarts, error excerpt) and — for admins only — enable/disable
 * toggle + restart button.
 *
 * Semantics that matter (review-verified):
 *  - The mutation's RETURNED result object drives follow-up behavior, not
 *    optimistic assumptions.
 *  - `onChanged` fires ONLY when an enable/restart result reports
 *    `status.status === 'running'` — the backend resolves those commands
 *    only after the full RPC attach handshake, so the caller can remount
 *    the declarative tree immediately without polling.
 *  - `onChanged` NEVER fires on disable: the tree unmounts anyway, and
 *    remounting would fire source-node commands against a dead host
 *    (400 storm).
 *  - `status.status === 'error'` surfaces `status.error` inline in the
 *    strip instead of a silent failure.
 */
import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { t } from '@/lib/i18n';
import { appToast } from '@/lib/observability/toast';
import { Badge, Button, Toggle } from '@/components/ui';
import {
  restartServicePlugin,
  setServicePluginEnabled,
  type ServicePluginInfo,
} from '@/lib/backend/modules/servicePlugins';
import { useEffectiveAdmin } from '@/hooks/useEffectiveAdmin';
import { cn } from '@/lib/utils';

/** Copied locally from PluginAccessPanel — do NOT extract/share, the panel is owned by another surface. */
function formatUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds < 0) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function statusBadge(
  plugin: ServicePluginInfo,
): { variant: 'success' | 'danger' | 'warning'; label: string } {
  // Precedence: the explicit user-disabled flag wins over everything —
  // a stopped-because-disabled host must not read as "dead".
  if (plugin.enabled === false) {
    return { variant: 'warning', label: t('pluginUi.runtime.disabled') };
  }
  const s = plugin.status;
  if (s.stopping) {
    return { variant: 'warning', label: t('admin.plugins.servicePluginRestarting') };
  }
  switch (s.status) {
    case 'running':
      return { variant: 'success', label: t('admin.plugins.servicePluginRunning') };
    case 'stopped':
    case 'error':
      return { variant: 'danger', label: t('admin.plugins.servicePluginDead') };
    default:
      return { variant: 'warning', label: t('admin.plugins.servicePluginRestarting') };
  }
}

export interface PluginRuntimeStripProps {
  plugin: ServicePluginInfo;
  /**
   * Fired after enable/restart when the backend result confirms
   * `status.status === 'running'` — i.e. the host is fully attached and
   * the declarative tree can safely remount. Never fired on disable.
   */
  onChanged?: () => void;
}

export function PluginRuntimeStrip({ plugin, onChanged }: PluginRuntimeStripProps) {
  const isAdmin = useEffectiveAdmin();
  const [pending, setPending] = useState<'toggle' | 'restart' | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const badge = statusBadge(plugin);
  const enabled = plugin.enabled !== false;

  async function handleToggle(next: boolean) {
    setPending('toggle');
    setInlineError(null);
    try {
      const result = await setServicePluginEnabled(plugin.id, next);
      if (result.status.status === 'error' && result.status.error) {
        setInlineError(result.status.error);
      }
      if (next) {
        appToast.success(t('pluginUi.runtime.enabledToast'), 'plugins');
        if (result.status.status === 'running') onChanged?.();
      } else {
        appToast.success(t('pluginUi.runtime.disabledToast'), 'plugins');
        // Deliberately no onChanged: the tree unmounts with the disabled
        // banner — remounting it would fire commands against a dead host.
      }
    } catch {
      appToast.error(t('pluginUi.runtime.actionFailedToast'), 'plugins');
    } finally {
      setPending(null);
    }
  }

  async function handleRestart() {
    setPending('restart');
    setInlineError(null);
    try {
      const result = await restartServicePlugin(plugin.id);
      if (result.status.status === 'error' && result.status.error) {
        setInlineError(result.status.error);
      }
      if (result.status.status === 'running') {
        appToast.success(t('pluginUi.runtime.restartedToast'), 'plugins');
        onChanged?.();
      }
    } catch {
      appToast.error(t('pluginUi.runtime.actionFailedToast'), 'plugins');
    } finally {
      setPending(null);
    }
  }

  return (
    <div
      data-testid="plugin-runtime-strip"
      className="flex items-center justify-between gap-3 border-b border-white/[0.06] bg-white/[0.02] px-4 py-2 sm:px-6 lg:px-8"
    >
      <div className="flex items-center gap-3 min-w-0 flex-wrap text-xs text-slate-500">
        <Badge variant={badge.variant} size="sm">{badge.label}</Badge>
        {plugin.status.pid !== null && plugin.status.pid !== undefined && (
          <span className="font-mono">
            {t('pluginUi.runtime.pid')}: {plugin.status.pid}
          </span>
        )}
        <span>
          {t('pluginUi.runtime.uptime')}: {formatUptime(plugin.status.uptimeSeconds)}
        </span>
        <span>
          {t('pluginUi.runtime.restarts')}: {plugin.status.restarts}
        </span>
        {(inlineError ?? plugin.status.error) && (
          <span className="text-red-400 truncate" data-testid="runtime-strip-error">
            {inlineError ?? plugin.status.error}
          </span>
        )}
      </div>
      {isAdmin && (
        <div className="flex items-center gap-3 shrink-0">
          <Toggle
            label=""
            size="sm"
            checked={enabled}
            disabled={pending !== null}
            ariaLabel={enabled ? t('pluginUi.runtime.disable') : t('pluginUi.runtime.enable')}
            onChange={v => void handleToggle(v)}
          />
          <Button
            variant="ghost"
            size="xs"
            disabled={pending !== null}
            onClick={() => void handleRestart()}
            leftIcon={
              <RotateCcw
                size={12}
                className={cn(pending === 'restart' && 'animate-spin')}
              />
            }
          >
            {t('pluginUi.runtime.restart')}
          </Button>
        </div>
      )}
    </div>
  );
}
