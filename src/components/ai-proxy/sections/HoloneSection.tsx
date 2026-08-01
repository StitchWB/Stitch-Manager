import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE_URL } from '@/lib/backend/core/invoke';
import { t } from '@/lib/i18n';
import { Eye, Shield, ShieldAlert, Volume2, VolumeX } from 'lucide-react';
import { Button, EmptyState, GlassCard, PageHeader, RangeSlider, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Toggle } from '@/components/ui';
import { cn } from '@/lib/utils';

// ── Types ───────────────────────────────────────────────────────────────────

type Severity = 'LOW' | 'MEDIUM' | 'HIGH';

interface Finding {
  timestamp: number;
  rule_id: string;
  severity: Severity;
  excerpt: string;
}

interface HoloneStatus {
  enabled: boolean;
  mode: 'monitor' | 'block';
  rule_count: number;
}

interface HoloneConfig {
  enabled: boolean;
  mode: 'monitor' | 'block';
}

const SEVERITY_TEXT_COLORS: Record<Severity, string> = {
  LOW: 'text-emerald-400',
  MEDIUM: 'text-amber-400',
  HIGH: 'text-red-400',
};

// ── Bucket helpers ──────────────────────────────────────────────────────────

const BUCKET_COUNT = 12;

function bucketFindings(findings: Finding[]): { label: string; low: number; medium: number; high: number }[] {
  const now = Date.now();
  const buckets: { label: string; low: number; medium: number; high: number }[] = [];
  for (let i = BUCKET_COUNT - 1; i >= 0; i--) {
    const end = now - i * 5 * 60 * 1000;
    const start = end - 5 * 60 * 1000;
    const time = new Date(end);
    const label = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}`;
    const inBucket = findings.filter(f => f.timestamp * 1000 >= start && f.timestamp * 1000 < end);
    buckets.push({
      label,
      low: inBucket.filter(f => f.severity === 'LOW').length,
      medium: inBucket.filter(f => f.severity === 'MEDIUM').length,
      high: inBucket.filter(f => f.severity === 'HIGH').length,
    });
  }
  return buckets;
}

// ── Component ───────────────────────────────────────────────────────────────

export function HoloneSection() {
  const [status, setStatus] = useState<HoloneStatus | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState<'monitor' | 'block'>('monitor');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  const [soundEnabled, setSoundEnabled] = useState(() => {
    return localStorage.getItem('holone_sound_enabled') !== 'false';
  });
  const [soundVolume, setSoundVolume] = useState(() => {
    const saved = localStorage.getItem('holone_sound_volume');
    return saved ? parseFloat(saved) : 0.5;
  });

  const statusTimer = useRef<ReturnType<typeof setInterval>>();
  const findingsTimer = useRef<ReturnType<typeof setInterval>>();
  const lastHighFindingCount = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);

  // ── Sound notification ────────────────────────────────────────────────

  const playSound = useCallback(() => {
    if (!soundEnabled) return;
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }
      const ctx = audioContextRef.current;
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(soundVolume, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.3);
    } catch {
      // ponytail: audio may not be available; silently ignore
    }
  }, [soundEnabled, soundVolume]);

  useEffect(() => {
    localStorage.setItem('holone_sound_enabled', String(soundEnabled));
  }, [soundEnabled]);

  useEffect(() => {
    localStorage.setItem('holone_sound_volume', String(soundVolume));
  }, [soundVolume]);

  // ── Fetch helpers ──────────────────────────────────────────────────────

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/holone/status`);
      if (!res.ok) throw new Error('status fetch failed');
      const data: HoloneStatus = await res.json();
      setStatus(data);
      if (!isLoaded) {
        setEnabled(data.enabled);
        setMode(data.mode);
        setIsLoaded(true);
      }
    } catch {
      // ponytail: backend may not have holone yet; silently ignore
    }
  }, [isLoaded]);

  const fetchFindings = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/holone/findings`);
      if (!res.ok) throw new Error('findings fetch failed');
      const data: { findings: Finding[] } = await res.json();
      setFindings(data.findings);
    } catch {
      // ponytail: backend may not have holone yet; silently ignore
    }
  }, []);

  // ── Polling ────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchStatus();
    fetchFindings();
    statusTimer.current = setInterval(fetchStatus, 5000);
    findingsTimer.current = setInterval(fetchFindings, 10000);
    return () => {
      clearInterval(statusTimer.current);
      clearInterval(findingsTimer.current);
    };
  }, [fetchStatus, fetchFindings]);

  // ── Save settings ──────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const config: HoloneConfig = { enabled, mode };
      const res = await fetch(`${API_BASE_URL}/api/holone/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error('config save failed');
      await fetchStatus();
    } catch {
      // ponytail: silently fail
    } finally {
      setIsSaving(false);
    }
  }, [enabled, mode, fetchStatus]);

  // ── Derived ────────────────────────────────────────────────────────────

  const buckets = useMemo(() => bucketFindings(findings), [findings]);
  const maxCount = useMemo(() => {
    const m = buckets.reduce((acc, b) => Math.max(acc, b.low + b.medium + b.high), 0);
    return m || 1;
  }, [buckets]);

  const recentFindings = useMemo(() => findings.slice(0, 50), [findings]);

  const severityCounts = useMemo(() => {
    let low = 0, medium = 0, high = 0;
    for (const f of findings) {
      if (f.severity === 'LOW') low++;
      else if (f.severity === 'MEDIUM') medium++;
      else high++;
    }
    return { low, medium, high };
  }, [findings]);

  const hasUnsavedChanges = isLoaded && status !== null && (enabled !== status.enabled || mode !== status.mode);

  // ── Sound notification on new HIGH findings ──────────────────────────

  useEffect(() => {
    const highCount = severityCounts.high;
    if (highCount > lastHighFindingCount.current && lastHighFindingCount.current > 0) {
      playSound();
    }
    lastHighFindingCount.current = highCount;
  }, [severityCounts.high, playSound]);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-auto p-3 md:p-4">
      <PageHeader
        eyebrow={t('sidebar.aiHub')}
        title={t('aiHub.sections.holone.title')}
        description={t('aiHub.sections.holone.subtitle')}
      />

      <div className="mx-auto w-full max-w-4xl space-y-3">

        {/* ── Hero Section: Enable/Disable ─────────────────────────────── */}
        <GlassCard className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-white mb-1">
                {t('aiHub.holone.protectionTitle')}
              </h2>
              <p className="text-xs text-slate-400">
                {t('aiHub.holone.protectionDescription')}
              </p>
            </div>
            <Toggle checked={enabled} onChange={setEnabled} label={t('aiHub.holone.enabled')} />
          </div>
        </GlassCard>

        {/* ── Mode Selector ────────────────────────────────────────────── */}
        {enabled && (
          <GlassCard className="p-3">
            <h3 className="text-xs font-medium text-white mb-2">
              {t('aiHub.holone.protectionMode')}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                onClick={() => setMode('monitor')}
                className={cn(
                  '!flex-col !items-start !text-left w-full p-3 h-auto',
                  mode === 'monitor'
                    ? '!border-amber-500 !bg-amber-500/10'
                    : '!border-white/10 !bg-white/[0.02] hover:!border-white/20',
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Eye size={14} className="text-amber-400" />
                  <span className="text-xs font-medium text-white">
                    {t('aiHub.holone.monitorMode')}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 leading-tight">
                  {t('aiHub.holone.monitorModeDescription')}
                </p>
              </Button>
              <Button
                variant="secondary"
                onClick={() => setMode('block')}
                className={cn(
                  '!flex-col !items-start !text-left w-full p-3 h-auto',
                  mode === 'block'
                    ? '!border-red-500 !bg-red-500/10'
                    : '!border-white/10 !bg-white/[0.02] hover:!border-white/20',
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <ShieldAlert size={14} className="text-red-400" />
                  <span className="text-xs font-medium text-white">
                    {t('aiHub.holone.blockMode')}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 leading-tight">
                  {t('aiHub.holone.blockModeDescription')}
                </p>
              </Button>
            </div>
          </GlassCard>
        )}

        {/* ── Stats Overview ───────────────────────────────────────────── */}
        {enabled && (
          <div className="grid grid-cols-3 gap-2">
            <GlassCard className="p-3">
              <div className="text-xl font-bold text-white">{status?.rule_count ?? 0}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">{t('aiHub.holone.activeRules')}</div>
            </GlassCard>
            <GlassCard className="p-3">
              <div className="text-xl font-bold text-white">{severityCounts.low + severityCounts.medium + severityCounts.high}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">{t('aiHub.holone.findingsLastHour')}</div>
            </GlassCard>
            <GlassCard className="p-3">
              <div className="text-xl font-bold text-red-400">{severityCounts.high}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">{t('aiHub.holone.highSeverityBlocked')}</div>
            </GlassCard>
          </div>
        )}

        {/* ── Findings Graph ───────────────────────────────────────────── */}
        {enabled && (
          <GlassCard className="p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-medium text-white">{t('aiHub.holone.findings')}</h3>
              <div className="flex items-center gap-2 text-[10px]">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm bg-emerald-500" />
                  LOW {severityCounts.low}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm bg-amber-500" />
                  MEDIUM {severityCounts.medium}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm bg-red-500" />
                  HIGH {severityCounts.high}
                </span>
              </div>
            </div>
            {buckets.length === 0 ? (
              <EmptyState
                icon={Shield}
                title={t('aiHub.holone.noFindings')}
                description=""
              />
            ) : (
              <div className="flex items-end gap-1 h-32">
                {buckets.map((b, i) => (
                  <div key={i} className="flex-1 flex flex-col justify-end h-full min-w-0">
                    <div className="flex flex-col justify-end h-full gap-px">
                      {b.high > 0 && (
                        <div
                          className="bg-red-500 rounded-t transition-all"
                          style={{ height: `${(b.high / maxCount) * 100}%` }}
                          title={`HIGH: ${b.high}`}
                        />
                      )}
                      {b.medium > 0 && (
                        <div
                          className="bg-amber-500 transition-all"
                          style={{ height: `${(b.medium / maxCount) * 100}%` }}
                          title={`MEDIUM: ${b.medium}`}
                        />
                      )}
                      {b.low > 0 && (
                        <div
                          className="bg-emerald-500 rounded-b transition-all"
                          style={{ height: `${(b.low / maxCount) * 100}%` }}
                          title={`LOW: ${b.low}`}
                        />
                      )}
                    </div>
                    <span className="mt-1 text-[8px] text-slate-500 text-center truncate">{b.label}</span>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        )}

        {/* ── Recent Findings Table ────────────────────────────────────── */}
        {enabled && (
          <GlassCard className="p-3">
            <h3 className="mb-2 text-xs font-medium text-white">{t('aiHub.holone.recentFindings')}</h3>
            {recentFindings.length === 0 ? (
              <p className="text-[10px] text-slate-500">{t('aiHub.holone.noFindings')}</p>
            ) : (
              <Table className="text-[10px]" containerClassName="overflow-x-auto">
                  <TableHeader className="border-b border-white/5">
                    <TableRow className="border-none">
                      <TableHead className="px-0 py-0 pb-1.5 font-medium normal-case tracking-normal">{t('aiHub.holone.timestamp')}</TableHead>
                      <TableHead className="px-0 py-0 pb-1.5 font-medium normal-case tracking-normal">{t('aiHub.holone.rule')}</TableHead>
                      <TableHead className="px-0 py-0 pb-1.5 font-medium normal-case tracking-normal">{t('aiHub.holone.severity')}</TableHead>
                      <TableHead className="px-0 py-0 pb-1.5 font-medium normal-case tracking-normal">{t('aiHub.holone.excerpt')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentFindings.map((f, i) => (
                      <TableRow key={i} className="border-white/[0.02] hover:bg-white/[0.02]">
                        <TableCell className="px-0 py-1 pr-2 text-slate-400 whitespace-nowrap font-mono">
                          {new Date(f.timestamp * 1000).toLocaleTimeString()}
                        </TableCell>
                        <TableCell className="px-0 py-1 pr-2 text-slate-300 font-mono whitespace-nowrap">{f.rule_id}</TableCell>
                        <TableCell className="px-0 py-1 pr-2 whitespace-nowrap">
                          <span className={cn('text-[9px] uppercase tracking-wider font-medium', SEVERITY_TEXT_COLORS[f.severity])}>
                            {f.severity}
                          </span>
                        </TableCell>
                        <TableCell className="px-0 py-1 text-slate-400 max-w-xs truncate">{f.excerpt}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
            )}
          </GlassCard>
        )}

        {/* ── Sound Notifications ──────────────────────────────────────── */}
        {enabled && (
          <GlassCard className="p-3">
            <h3 className="text-xs font-medium text-white mb-2">
              {t('aiHub.holone.soundNotifications')}
            </h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {soundEnabled ? (
                    <Volume2 size={14} className="text-emerald-400" />
                  ) : (
                    <VolumeX size={14} className="text-slate-500" />
                  )}
                  <span className="text-xs text-slate-300">
                    {t('aiHub.holone.soundEnabled')}
                  </span>
                </div>
                <Toggle
                  checked={soundEnabled}
                  onChange={setSoundEnabled}
                  label={t('aiHub.holone.soundEnabled')}
                />
              </div>

              {soundEnabled && (
                <>
                  <RangeSlider
                      label={t('aiHub.holone.volume')}
                      value={soundVolume}
                      onChange={setSoundVolume}
                      min={0}
                      max={1}
                      step={0.05}
                      valueFormatter={(v) => `${Math.round(v * 100)}%`}
                    />

                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={playSound}
                    className="w-full"
                  >
                    {t('aiHub.holone.testSound')}
                  </Button>
                </>
              )}

              <p className="text-[10px] text-slate-500">
                {t('aiHub.holone.soundDescription')}
              </p>
            </div>
          </GlassCard>
        )}

        {/* ── Not Configured State ─────────────────────────────────────── */}
        {isLoaded && !status && (
          <GlassCard className="p-3">
            <p className="text-xs text-slate-400 text-center">{t('aiHub.holone.notConfigured')}</p>
          </GlassCard>
        )}

        {/* ── Save Bar ─────────────────────────────────────────────────── */}
        {hasUnsavedChanges && (
          <div className="sticky bottom-3">
            <GlassCard className="p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-300">
                  {t('aiHub.holone.unsavedChanges')}
                </span>
                <Button variant="primary" size="sm" onClick={handleSave} disabled={isSaving}>
                  {isSaving ? t('aiHub.actions.saving') : t('aiHub.holone.saveChanges')}
                </Button>
              </div>
            </GlassCard>
          </div>
        )}

      </div>
    </div>
  );
}