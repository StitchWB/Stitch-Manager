/**
 * Codes page — admin-only activation code management.
 *
 * Lists distribution-server activation codes with status badges, supports
 * filtering (all / unused only), issuing new codes (with a one-time
 * copyable display of the raw codes), and revoking unused codes.
 *
 * Visual language matches Users.tsx: Deep Space glassmorphism, same UI
 * kit components (Button/Input/Select/Badge), Header with icon.
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Ticket as TicketIcon,
  Plus,
  Loader2,
  AlertCircle,
  Ban,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import Header from '../components/layout/Header';
import { useAppStore } from '../stores/app';
import { t } from '@/lib/i18n';
import {
  listDistCodes,
  issueDistCode,
  revokeDistCode,
  type DistCodeInfo,
} from '../lib/backend/modules/dist';
import { askConfirm } from '../components/ui/ConfirmDialogHost';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';

type FilterValue = 'all' | 'unused';
type TtlValue = '60' | '1440' | '10080' | '0';

type CodeStatus = 'unused' | 'used' | 'revoked' | 'expired';

interface IssuedBatch {
  codes: string[];
  entitlements: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry)) return false;
  return expiry < Date.now();
}

function codeStatus(code: DistCodeInfo): CodeStatus {
  if (code.revoked) return 'revoked';
  if (code.used) return 'used';
  if (isExpired(code.expires_at)) return 'expired';
  return 'unused';
}

function statusBadgeVariant(status: CodeStatus): 'info' | 'success' | 'danger' | 'warning' {
  switch (status) {
    case 'unused':
      return 'info';
    case 'used':
      return 'success';
    case 'revoked':
      return 'danger';
    case 'expired':
      return 'warning';
  }
}

function statusLabel(status: CodeStatus): string {
  return t(`codes.statuses.${status}`);
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Short localized format: YYYY-MM-DD HH:mm
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function mapErrorToToastKey(err: unknown): string {
  const status = (err as Error & { status?: number })?.status;
  if (status === 404) return 'codes.toasts.errorUnknown';
  if (status === 409) return 'codes.toasts.errorUsed';
  if (status === 502) {
    const detail = (err as Error & { detail?: unknown })?.detail;
    const detailStr = typeof detail === 'string' ? detail.toLowerCase() : '';
    if (detailStr.includes('rejected')) return 'codes.toasts.errorRejected';
    if (detailStr.includes('unreachable')) return 'codes.toasts.errorUnreachable';
    return 'codes.toasts.errorUnreachable';
  }
  if (status === 503) {
    const detail = (err as Error & { detail?: unknown })?.detail;
    const detailStr = typeof detail === 'string' ? detail.toLowerCase() : '';
    if (detailStr.includes('disabled')) return 'codes.toasts.errorDisabled';
    return 'codes.toasts.errorNoKey';
  }
  return 'codes.toasts.loadFailed';
}

// ── Component ───────────────────────────────────────────────────────────────

export default function Codes() {
  const language = useAppStore(state => state.language);
  void language; // re-render on language change

  const [codes, setCodes] = useState<DistCodeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [filter, setFilter] = useState<FilterValue>('all');

  // Issue form state
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [issueCount, setIssueCount] = useState('1');
  const [issueTtl, setIssueTtl] = useState<TtlValue>('60');
  const [issueLabel, setIssueLabel] = useState('');
  const [issueEntitlements, setIssueEntitlements] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);

  // Issued batch display (one-time)
  const [issuedBatch, setIssuedBatch] = useState<IssuedBatch | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await listDistCodes(filter === 'unused');
      setCodes(list);
    } catch (err) {
      setLoadError(t(mapErrorToToastKey(err)));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ── Stats (computed client-side) ─────────────────────────────────────────

  const stats = useMemo(() => {
    let unused = 0;
    let used = 0;
    let revoked = 0;
    let expired = 0;
    for (const c of codes) {
      const s = codeStatus(c);
      if (s === 'unused') unused++;
      else if (s === 'used') used++;
      else if (s === 'revoked') revoked++;
      else if (s === 'expired') expired++;
    }
    return { total: codes.length, unused, used, revoked, expired };
  }, [codes]);

  // ── Issue ────────────────────────────────────────────────────────────────

  const onIssue = async (e: FormEvent) => {
    e.preventDefault();
    if (issuing) return;
    setIssueError(null);

    const count = parseInt(issueCount, 10);
    if (!Number.isFinite(count) || count < 1 || count > 100) {
      setIssueError('codes.issue.countHint');
      return;
    }

    const ttlValue = issueTtl === '0' ? null : parseInt(issueTtl, 10);
    const entitlements = issueEntitlements.trim()
      ? issueEntitlements.split(',').map(s => s.trim()).filter(Boolean)
      : undefined;

    setIssuing(true);
    try {
      const result = await issueDistCode({
        count,
        ttl_minutes: ttlValue,
        label: issueLabel.trim() || null,
        entitlements,
      });
      setIssuedBatch({ codes: result.codes, entitlements: result.entitlements });
      setCopied(false);
      toast.success(t('codes.toasts.issued'));
      // Reset form
      setIssueCount('1');
      setIssueTtl('60');
      setIssueLabel('');
      setIssueEntitlements('');
      setShowIssueForm(false);
      await refresh();
    } catch (err) {
      const status = (err as Error & { status?: number })?.status;
      const message =
        status === 502 || status === 503
          ? mapErrorToToastKey(err)
          : 'codes.toasts.issueFailed';
      setIssueError(message);
      toast.error(t(message));
    } finally {
      setIssuing(false);
    }
  };

  // ── Revoke ───────────────────────────────────────────────────────────────

  const onRevoke = async (code: DistCodeInfo) => {
    const confirmed = await askConfirm({
      title: t('codes.revoke.title'),
      message: t('codes.revoke.message', { codeId: code.id }),
      confirmText: t('codes.revoke.confirm'),
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      await revokeDistCode(code.id);
      toast.success(t('codes.toasts.revoked'));
      await refresh();
    } catch (err) {
      toast.error(t(mapErrorToToastKey(err)));
    }
  };

  // ── Copy issued codes ────────────────────────────────────────────────────

  const onCopyAll = async () => {
    if (!issuedBatch) return;
    try {
      await navigator.clipboard.writeText(issuedBatch.codes.join('\n'));
      setCopied(true);
      toast.success(t('codes.issued.copied'));
    } catch {
      toast.error(t('codes.issued.copyFailed'));
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title={t('codes.title')}
        subtitle={t('codes.subtitle')}
        icon={<TicketIcon size={18} />}
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          {/* Stats row */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard label={t('codes.stats.total')} value={stats.total} />
            <StatCard label={t('codes.stats.unused')} value={stats.unused} variant="info" />
            <StatCard label={t('codes.stats.used')} value={stats.used} variant="success" />
            <StatCard label={t('codes.stats.revoked')} value={stats.revoked} variant="danger" />
            <StatCard label={t('codes.stats.expired')} value={stats.expired} variant="warning" />
          </div>

          {/* Issued codes one-time display */}
          {issuedBatch && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 backdrop-blur-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-amber-500/20 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-400" />
                  <h2 className="text-sm font-semibold text-white">{t('codes.issued.title')}</h2>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onCopyAll}
                    leftIcon={copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  >
                    {t('codes.issued.copyAll')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIssuedBatch(null)}
                  >
                    {t('codes.issued.close')}
                  </Button>
                </div>
              </div>
              <div className="p-5">
                <p className="text-xs text-amber-300 mb-3 leading-relaxed">
                  {t('codes.issued.warning')}
                </p>
                <div className="rounded-lg bg-black/40 border border-white/[0.06] p-3 max-h-48 overflow-y-auto">
                  <pre className="text-xs font-mono text-emerald-300 whitespace-pre-wrap break-all">
                    {issuedBatch.codes.join('\n')}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* Issue form (collapsible) */}
          <div className="rounded-xl border border-white/[0.06] bg-black/40 backdrop-blur-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setShowIssueForm(v => !v)}
              className="w-full px-5 py-3 border-b border-white/[0.06] flex items-center gap-2 text-left hover:bg-white/[0.02] transition-colors"
              aria-expanded={showIssueForm}
            >
              {showIssueForm
                ? <ChevronDown className="w-4 h-4 text-indigo-400" />
                : <ChevronRight className="w-4 h-4 text-indigo-400" />}
              <Plus className="w-4 h-4 text-indigo-400" />
              <h2 className="text-sm font-semibold text-white">{t('codes.issue.title')}</h2>
            </button>
            {showIssueForm && (
              <form onSubmit={onIssue} className="p-5 flex flex-col gap-4" noValidate>
                <div className="grid grid-cols-1 md:grid-cols-[120px_180px_1fr_1fr_auto] gap-3 items-end">
                  <Input
                    label={t('codes.issue.count')}
                    type="number"
                    min={1}
                    max={100}
                    value={issueCount}
                    onChange={e => {
                      setIssueCount(e.target.value);
                      if (issueError) setIssueError(null);
                    }}
                    hint={t('codes.issue.countHint')}
                    required
                  />
                  <Select
                    label={t('codes.issue.ttl')}
                    value={issueTtl}
                    onValueChange={v => setIssueTtl(v as TtlValue)}
                    options={[
                      { value: '60', label: t('codes.issue.ttl60min') },
                      { value: '1440', label: t('codes.issue.ttl24h') },
                      { value: '10080', label: t('codes.issue.ttl7d') },
                      { value: '0', label: t('codes.issue.ttlNoExpiry') },
                    ]}
                  />
                  <Input
                    label={t('codes.issue.label')}
                    placeholder={t('codes.issue.labelPlaceholder')}
                    value={issueLabel}
                    onChange={e => setIssueLabel(e.target.value)}
                  />
                  <Input
                    label={t('codes.issue.entitlements')}
                    placeholder={t('codes.issue.entitlementsPlaceholder')}
                    value={issueEntitlements}
                    onChange={e => setIssueEntitlements(e.target.value)}
                    hint={t('codes.issue.entitlementsHint')}
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    isLoading={issuing}
                    disabled={issuing}
                    leftIcon={<Plus className="w-4 h-4" />}
                  >
                    {issuing ? t('codes.issue.submitting') : t('codes.issue.submit')}
                  </Button>
                </div>
                {issueError && (
                  <div
                    role="alert"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-xs"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span className="leading-relaxed">{t(issueError)}</span>
                  </div>
                )}
              </form>
            )}
          </div>

          {/* Codes table */}
          <div className="rounded-xl border border-white/[0.06] bg-black/40 backdrop-blur-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-white">{t('codes.title')}</h2>
              <div className="flex items-center gap-2">
                <Select
                  value={filter}
                  onValueChange={v => setFilter(v as FilterValue)}
                  options={[
                    { value: 'all', label: t('codes.filter.all') },
                    { value: 'unused', label: t('codes.filter.unusedOnly') },
                  ]}
                  shellClassName="w-44"
                />
                {loading && <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />}
              </div>
            </div>

            {loadError ? (
              <div className="p-6 text-center">
                <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                <p className="text-sm text-slate-400 mb-3">{loadError}</p>
                <Button variant="ghost" size="sm" onClick={() => void refresh()}>
                  {t('codes.retry')}
                </Button>
              </div>
            ) : loading ? (
              <div className="p-10 text-center">
                <Loader2 className="w-8 h-8 text-slate-600 mx-auto mb-3 animate-spin" />
                <p className="text-sm text-slate-500">{t('codes.loading')}</p>
              </div>
            ) : codes.length === 0 ? (
              <div className="p-10 text-center">
                <TicketIcon className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <p className="text-sm text-slate-500">{t('codes.empty')}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-left">
                      <th className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider w-16">
                        {t('codes.columns.id')}
                      </th>
                      <th className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider">
                        {t('codes.columns.hashPrefix')}
                      </th>
                      <th className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider">
                        {t('codes.columns.entitlements')}
                      </th>
                      <th className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider w-28">
                        {t('codes.columns.status')}
                      </th>
                      <th className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider w-28">
                        {t('codes.columns.tgUser')}
                      </th>
                      <th className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider">
                        {t('codes.columns.label')}
                      </th>
                      <th className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider w-32">
                        {t('codes.columns.createdAt')}
                      </th>
                      <th className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider w-32">
                        {t('codes.columns.expiresAt')}
                      </th>
                      <th className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider w-32">
                        {t('codes.columns.usedAt')}
                      </th>
                      <th className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider w-24 text-right">
                        {t('codes.columns.actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {codes.map(code => {
                      const status = codeStatus(code);
                      const canRevoke = status === 'unused';
                      return (
                        <tr
                          key={String(code.id)}
                          className="border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02] transition-colors"
                        >
                          <td className="px-5 py-3 text-slate-400 font-mono text-xs">
                            {code.id}
                          </td>
                          <td className="px-5 py-3">
                            <span className="text-slate-200 font-mono text-xs">
                              {code.code_hash_prefix}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex flex-wrap gap-1">
                              {code.entitlements.length === 0 ? (
                                <span className="text-slate-600 text-xs">—</span>
                              ) : (
                                code.entitlements.map((ent, i) => (
                                  <span
                                    key={`${ent}-${i}`}
                                    className="px-1.5 py-0.5 rounded bg-white/5 text-slate-300 text-[10px] font-mono"
                                  >
                                    {ent}
                                  </span>
                                ))
                              )}
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            <Badge variant={statusBadgeVariant(status)} size="sm">
                              {statusLabel(status)}
                            </Badge>
                          </td>
                          <td className="px-5 py-3 text-slate-400 text-xs">
                            {code.tg_user_id ?? '—'}
                          </td>
                          <td className="px-5 py-3 text-slate-300 text-xs">
                            {code.label ?? '—'}
                          </td>
                          <td className="px-5 py-3 text-slate-400 text-xs">
                            {formatDate(code.created_at)}
                          </td>
                          <td className="px-5 py-3 text-slate-400 text-xs">
                            {formatDate(code.expires_at)}
                          </td>
                          <td className="px-5 py-3 text-slate-400 text-xs">
                            {formatDate(code.used_at)}
                          </td>
                          <td className="px-5 py-3 text-right">
                            {canRevoke ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void onRevoke(code)}
                                leftIcon={<Ban className="w-3.5 h-3.5" />}
                                className="text-slate-500 hover:text-red-400"
                                aria-label={t('codes.revoke.confirm')}
                              >
                                {t('codes.revoke.confirm')}
                              </Button>
                            ) : (
                              <span className="text-slate-700 text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── StatCard subcomponent ────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: number;
  variant?: 'default' | 'info' | 'success' | 'danger' | 'warning';
}

function StatCard({ label, value, variant = 'default' }: StatCardProps) {
  const accentClasses: Record<NonNullable<StatCardProps['variant']>, string> = {
    default: 'text-slate-300',
    info: 'text-sky-300',
    success: 'text-emerald-300',
    danger: 'text-red-300',
    warning: 'text-amber-300',
  };
  return (
    <div className="rounded-xl border border-white/[0.06] bg-black/40 backdrop-blur-sm px-4 py-3">
      <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className={`text-2xl font-bold ${accentClasses[variant]}`}>
        {value}
      </div>
    </div>
  );
}
