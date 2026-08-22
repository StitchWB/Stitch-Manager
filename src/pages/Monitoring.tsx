/**
 * Monitoring page — admin-only live health of Stitch services.
 *
 * Snapshot from GET /api/dist/monitoring: server/web/external cards,
 * bot card, proxies table. Auto-refreshes every 30s (skips tick if a
 * fetch is in flight). Visual language matches Codes.tsx: Deep Space
 * glassmorphism, Header with icon, Badge/Button, toast on load error.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, RefreshCw, AlertCircle, Server, Globe, Network, Bot, BellOff, BellRing, Plug } from 'lucide-react';
import { toast } from 'sonner';
import Header from '../components/layout/Header';
import { useAppStore } from '../stores/app';
import { t } from '@/lib/i18n';
import {
  getMonitoring,
  ackMonitoringAlerts,
  type MonitoringSnapshot,
  type ServiceStatus,
  type BotStatus,
  type MonitoringAlert,
  type MonitoringAlertKind,
} from '../lib/backend/modules/monitoring';
import { safeInvoke } from '../lib/backend/core/invoke';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';

// ── Service-plugin host health (todo 25) ────────────────────────────────────
// Fetched via the admin command `get_service_plugin_health` on the same 30s
// refresh as the snapshot. `null` = command unavailable (hide the section).

type PluginHostStatus = 'running' | 'stopped' | 'error';

interface PluginHostHealth {
  plugin_id: string;
  status: PluginHostStatus;
  pid: number | null;
  uptimeSeconds: number | null;
  restarts: number;
  stopping: boolean;
  source: string;
  version: string | null;
  last_error: string | null;
  stderr_tail: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function serviceBadgeVariant(status: ServiceStatus): 'success' | 'danger' | 'default' {
  if (status === 'up') return 'success';
  if (status === 'down') return 'danger';
  return 'default';
}

function botBadgeVariant(status: BotStatus): 'success' | 'warning' | 'default' {
  if (status === 'up') return 'success';
  if (status === 'stale') return 'warning';
  return 'default';
}

function pluginBadgeVariant(host: PluginHostHealth): 'success' | 'danger' | 'default' {
  // Danger when the host errored OR restarted at all (crash signal).
  if (host.status === 'error' || host.restarts > 0) return 'danger';
  if (host.status === 'running') return 'success';
  return 'default';
}

function pluginStatusLabel(host: PluginHostHealth): string {
  if (host.status === 'running') return t('monitoring.servicePlugins.statusRunning');
  if (host.status === 'error') return t('monitoring.servicePlugins.statusError');
  return t('monitoring.servicePlugins.statusStopped');
}

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function formatAge(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return t('monitoring.fields.secondsAgo', { count: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t('time.minutesAgo', { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('time.hoursAgo', { count: h });
  return t('time.daysAgo', { count: Math.floor(h / 24) });
}

function formatLatency(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  return `${Math.round(ms)}ms`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function mapErrorToToastKey(err: unknown): string {
  const status = (err as Error & { status?: number })?.status;
  if (status === 403) return 'monitoring.errors.noAccess';
  if (status === 502) {
    const detail = (err as Error & { detail?: unknown })?.detail;
    if (typeof detail === 'string' && detail.toLowerCase().includes('rejected'))
      return 'monitoring.errors.rejected';
    return 'monitoring.errors.unreachable';
  }
  if (status === 503) return 'monitoring.errors.disabled';
  return 'monitoring.errors.loadFailed';
}

// ── Component ───────────────────────────────────────────────────────────────

export default function Monitoring() {
  const language = useAppStore(state => state.language);
  void language;
  const [snapshot, setSnapshot] = useState<MonitoringSnapshot | null>(null);
  const [pluginHosts, setPluginHosts] = useState<PluginHostHealth[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async (showToast: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setLoadError(null);
    try {
      // Plugin host health is fetched alongside the snapshot but must never
      // break the page: a failure (403/404/older backend) hides the section.
      const [snap, hosts] = await Promise.all([
        getMonitoring(),
        safeInvoke<PluginHostHealth[]>('get_service_plugin_health').catch(
          () => null as PluginHostHealth[] | null,
        ),
      ]);
      setSnapshot(snap);
      setPluginHosts(hosts);
    } catch (err) {
      const key = mapErrorToToastKey(err);
      setLoadError(t(key));
      if (showToast) toast.error(t(key));
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, []);

  const handleSilence = useCallback(async () => {
    try {
      await ackMonitoringAlerts({ hours: 1 });
      toast.success(t('monitoring.silence1h'));
      await refresh(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('monitoring.errors.loadFailed'));
    }
  }, [refresh]);

  useEffect(() => {
    void refresh(true);
    const id = window.setInterval(() => void refresh(false), 30000);
    return () => window.clearInterval(id);
  }, [refresh]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title={t('monitoring.title')}
        subtitle={t('monitoring.subtitle')}
        icon={<Activity size={18} />}
        actions={
          <Button variant="ghost" size="sm" onClick={() => void refresh(true)} disabled={loading}
            leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}>
            {t('monitoring.refresh')}
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          {loadError && (
            <div role="alert" className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="leading-relaxed">{loadError}</span>
            </div>
          )}
          {loading && !snapshot ? <LoadingSkeleton /> : snapshot ? (
            <>
              <p className="text-xs text-slate-500">{t('monitoring.generatedAt')}: {formatDate(snapshot.generated_at)}</p>
              <ServiceCards snapshot={snapshot} />
              <BotCard snapshot={snapshot} />
              <ProxiesTable snapshot={snapshot} />
              <ServicePluginsSection hosts={pluginHosts} />
              <AlertsCard snapshot={snapshot} onSilence={handleSilence} loading={loading} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {[0, 1, 2].map(i => (
        <div key={i} className="rounded-xl border border-white/[0.06] bg-black/40 backdrop-blur-sm p-5 animate-pulse">
          <div className="h-4 w-24 bg-white/5 rounded mb-4" />
          <div className="h-8 w-16 bg-white/5 rounded mb-2" />
          <div className="h-3 w-32 bg-white/5 rounded" />
        </div>
      ))}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-white/[0.03] last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-xs text-slate-200 font-mono text-right truncate max-w-[60%]">{value}</span>
    </div>
  );
}

function CardShell({ icon, title, badge, children }: { icon: ReactNode; title: string; badge: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-black/40 backdrop-blur-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
        <span className="text-indigo-400">{icon}</span>
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <span className="ml-auto">{badge}</span>
      </div>
      <div className="px-5 py-3">{children}</div>
    </div>
  );
}

function ServiceCards({ snapshot }: { snapshot: MonitoringSnapshot }) {
  const s = snapshot.server, w = snapshot.web, e = snapshot.external;
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <CardShell icon={<Server className="w-4 h-4" />} title={t('monitoring.sections.server')}
        badge={<Badge variant={serviceBadgeVariant(s.status)} size="sm">{t(`monitoring.statuses.${s.status}`)}</Badge>}>
        <Field label={t('monitoring.fields.uptime')} value={formatDuration(s.uptime_s)} />
        <Field label={t('monitoring.fields.dbOk')} value={s.db_ok ? '✓' : '✗'} />
      </CardShell>
      <CardShell icon={<Globe className="w-4 h-4" />} title={t('monitoring.sections.web')}
        badge={<Badge variant={serviceBadgeVariant(w.status)} size="sm">{t(`monitoring.statuses.${w.status}`)}</Badge>}>
        <Field label={t('monitoring.fields.latency')} value={formatLatency(w.latency_ms)} />
        <Field label={t('monitoring.fields.lastCheck')} value={formatDate(w.last_check)} />
        {w.detail && <Field label={t('monitoring.fields.detail')} value={w.detail} />}
      </CardShell>
      <CardShell icon={<Network className="w-4 h-4" />} title={t('monitoring.sections.external')}
        badge={<Badge variant={serviceBadgeVariant(e.status)} size="sm">{t(`monitoring.statuses.${e.status}`)}</Badge>}>
        <Field label={t('monitoring.fields.url')} value={e.url} />
        <Field label={t('monitoring.fields.latency')} value={formatLatency(e.latency_ms)} />
        <Field label={t('monitoring.fields.lastCheck')} value={formatDate(e.last_check)} />
        {e.detail && <Field label={t('monitoring.fields.detail')} value={e.detail} />}
      </CardShell>
    </div>
  );
}

function BotCard({ snapshot }: { snapshot: MonitoringSnapshot }) {
  const bot = snapshot.bot;
  return (
    <CardShell icon={<Bot className="w-4 h-4" />} title={t('monitoring.sections.bot')}
      badge={<Badge variant={botBadgeVariant(bot.status)} size="sm">{t(`monitoring.statuses.${bot.status}`)}</Badge>}>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6">
        <Field label={t('monitoring.fields.route')} value={bot.route ?? '—'} />
        <Field label={t('monitoring.fields.age')} value={formatAge(bot.age_s)} />
        <Field label={t('monitoring.fields.uptime')} value={formatDuration(bot.uptime_s)} />
        <Field label={t('monitoring.fields.pollingErrors')} value={bot.polling_errors != null ? String(bot.polling_errors) : '—'} />
        <Field label={t('monitoring.fields.lastHeartbeat')} value={formatDate(bot.last_heartbeat)} />
        <Field label={t('monitoring.fields.candidates')} value={bot.candidates.length > 0 ? bot.candidates.join(', ') : '—'} />
      </div>
    </CardShell>
  );
}

function ProxiesTable({ snapshot }: { snapshot: MonitoringSnapshot }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-black/40 backdrop-blur-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-white/[0.06]">
        <h2 className="text-sm font-semibold text-white">{t('monitoring.sections.proxies')}</h2>
      </div>
      {snapshot.proxies.length === 0 ? (
        <div className="p-6 text-center">
          <Network className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <p className="text-sm text-slate-500">{t('monitoring.noProxies')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-left">
                <th className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider">{t('monitoring.fields.url')}</th>
                <th className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider w-28">{t('monitoring.fields.status')}</th>
                <th className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider w-28">{t('monitoring.fields.latency')}</th>
                <th className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider w-32">{t('monitoring.fields.lastCheck')}</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.proxies.map((p, i) => (
                <tr key={`${p.url}-${i}`} className="border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02] transition-colors">
                  <td className="px-5 py-3 text-slate-200 font-mono text-xs truncate max-w-[400px]">{p.url}</td>
                  <td className="px-5 py-3"><Badge variant={serviceBadgeVariant(p.status)} size="sm">{t(`monitoring.statuses.${p.status}`)}</Badge></td>
                  <td className="px-5 py-3 text-slate-400 text-xs font-mono">{formatLatency(p.latency_ms)}</td>
                  <td className="px-5 py-3 text-slate-400 text-xs">{formatDate(p.last_check)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Service plugins (todo 25) ───────────────────────────────────────────────

function ServicePluginsSection({ hosts }: { hosts: PluginHostHealth[] | null }) {
  // null = command unavailable (guest / older backend) → hide the section.
  if (hosts === null) return null;
  return (
    <div className="rounded-xl border border-white/[0.06] bg-black/40 backdrop-blur-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-white/[0.06]">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <span className="text-indigo-400"><Plug className="w-4 h-4" /></span>
          {t('monitoring.servicePlugins.title')}
        </h2>
      </div>
      {hosts.length === 0 ? (
        <div className="p-6 text-center">
          <Plug className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <p className="text-sm text-slate-500">{t('monitoring.servicePlugins.empty')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-left">
                <th className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider">{t('monitoring.servicePlugins.plugin')}</th>
                <th className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider w-28">{t('monitoring.fields.status')}</th>
                <th className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider w-28">{t('monitoring.fields.uptime')}</th>
                <th className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider w-24">{t('monitoring.servicePlugins.restarts')}</th>
                <th className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider w-24">{t('monitoring.servicePlugins.version')}</th>
              </tr>
            </thead>
            <tbody>
              {hosts.map(h => (
                <tr key={h.plugin_id} className="border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02] transition-colors">
                  <td className="px-5 py-3 text-slate-200 font-mono text-xs">
                    {h.plugin_id}
                    {h.last_error && (
                      <p className="text-red-400/80 text-xs mt-0.5 font-sans truncate max-w-[400px]" title={h.last_error}>{h.last_error}</p>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <Badge variant={pluginBadgeVariant(h)} size="sm">{pluginStatusLabel(h)}</Badge>
                  </td>
                  <td className="px-5 py-3 text-slate-400 text-xs font-mono">{formatDuration(h.uptimeSeconds)}</td>
                  <td className="px-5 py-3 text-slate-400 text-xs font-mono">{h.restarts}</td>
                  <td className="px-5 py-3 text-slate-400 text-xs font-mono">{h.version ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Alerts ──────────────────────────────────────────────────────────────────

function alertIcon(kind: MonitoringAlertKind): ReactNode {
  switch (kind) {
    case 'bot_stale':
      return <Bot className="w-4 h-4 text-amber-400" />;
    case 'web_down':
      return <Globe className="w-4 h-4 text-red-400" />;
    case 'proxies_down':
      return <Network className="w-4 h-4 text-red-400" />;
    default:
      return <AlertCircle className="w-4 h-4 text-slate-400" />;
  }
}

function isSilenced(silencedUntil: string | null): boolean {
  if (!silencedUntil) return false;
  const d = new Date(silencedUntil);
  return !Number.isNaN(d.getTime()) && d.getTime() > Date.now();
}

interface AlertsCardProps {
  snapshot: MonitoringSnapshot;
  onSilence: () => Promise<void>;
  loading: boolean;
}

function AlertsCard({ snapshot, onSilence, loading }: AlertsCardProps) {
  const alerts = [...snapshot.alerts].sort((a, b) => b.ts.localeCompare(a.ts));
  const silenced = isSilenced(snapshot.silenced_until);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-black/40 backdrop-blur-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
        <span className="text-indigo-400"><BellRing className="w-4 h-4" /></span>
        <h2 className="text-sm font-semibold text-white">{t('monitoring.alerts')}</h2>
        <span className="ml-auto flex items-center gap-2">
          {silenced && (
            <Badge variant="slate" size="sm" withDot withPulse>
              {t('monitoring.silenced', { time: formatDate(snapshot.silenced_until) })}
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void onSilence()}
            disabled={loading}
            leftIcon={<BellOff className="w-3.5 h-3.5" />}
          >
            {t('monitoring.silence1h')}
          </Button>
        </span>
      </div>
      {alerts.length === 0 ? (
        <div className="p-6 text-center">
          <BellRing className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <p className="text-sm text-slate-500">{t('monitoring.noAlerts')}</p>
        </div>
      ) : (
        <div className="divide-y divide-white/[0.03]">
          {alerts.map((alert: MonitoringAlert) => (
            <div key={alert.id} className="px-5 py-3 flex items-start gap-3">
              <span className="shrink-0 mt-0.5">{alertIcon(alert.kind)}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-200">{alert.message}</p>
                <p className="text-xs text-slate-500 mt-0.5">{formatDate(alert.ts)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
