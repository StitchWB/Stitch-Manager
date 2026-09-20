/**
 * SubmissionsSection — admin moderation queue on the Plugins page.
 *
 * Queue table (status-filtered) → row click opens the detail modal:
 * manifest snapshot, gate_report per-gate pass/fail, declared domains,
 * sha256, package files, attestation status (signed → reviewer/date,
 * pending → offline CLI hint), and Approve / Reject(reason) / Delist
 * actions with optimistic update + rollback + toast (same pattern as the
 * role matrix in Plugins.tsx). Approved submissions also get a badges
 * editor (recommended/works/not_works toggles; 'verified' is rendered as
 * a read-only computed state and is never sent to set_plugin_badges).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Inbox,
  Loader2,
  AlertCircle,
  RefreshCw,
  Check,
  X,
  ShieldCheck,
  FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { Select } from '../ui/Select';
import { Toggle } from '../ui/Toggle';
import { Tooltip } from '../ui/Tooltip';
import { ActionDialog } from '../ui/ActionDialog';
import { ConfirmActionButton } from '../ui/ConfirmActionButton';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui/Table';
import {
  listSubmissions,
  getSubmission,
  approveSubmission,
  rejectSubmission,
  delistSubmission,
  setPluginBadges,
  type PluginSubmissionSummary,
  type PluginSubmissionDetail,
  type ManualPluginBadge,
} from '@/lib/backend/modules/submissions';
import { getMarketplace } from '@/lib/backend/modules/marketplace';

// ── Helpers ──────────────────────────────────────────────────────────────────

type StatusVariant = 'success' | 'warning' | 'danger' | 'slate' | 'default';

const STATUS_MAP: Record<string, { variant: StatusVariant; labelKey: string }> = {
  pending: { variant: 'warning', labelKey: 'admin.plugins.submissions.statusPending' },
  approved: { variant: 'success', labelKey: 'admin.plugins.submissions.statusApproved' },
  rejected: { variant: 'danger', labelKey: 'admin.plugins.submissions.statusRejected' },
  delisted: { variant: 'slate', labelKey: 'admin.plugins.submissions.statusDelisted' },
};

function StatusChip({ status }: { status: string }) {
  const entry = STATUS_MAP[status];
  return (
    <Badge variant={entry?.variant ?? 'default'} size="sm">
      {entry ? t(entry.labelKey) : status}
    </Badge>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

function errText(err: unknown, fallbackKey: string): string {
  return err instanceof Error ? err.message : t(fallbackKey);
}

// ── Badges editor (approved submissions) ─────────────────────────────────────

interface BadgesEditorProps {
  pluginId: string;
  /** Attestation present on the submission → fallback 'verified' source. */
  attested: boolean;
}

function BadgesEditor({ pluginId, attested }: BadgesEditorProps) {
  const [manual, setManual] = useState<Record<ManualPluginBadge, boolean>>({
    recommended: false,
    works: false,
    not_works: false,
  });
  const [verified, setVerified] = useState(attested);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Seed from the live marketplace feed (the submission detail carries no
  // plugin badges); fall back to the attestation-derived verified state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getMarketplace();
        if (cancelled) return;
        const badges = res.items.find(i => i.id === pluginId)?.badges ?? [];
        if (badges.length > 0) {
          setManual({
            recommended: badges.includes('recommended'),
            works: badges.includes('works'),
            not_works: badges.includes('not_works'),
          });
          setVerified(badges.includes('verified'));
          return;
        }
        setVerified(attested);
      } catch {
        if (!cancelled) setVerified(attested);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pluginId, attested]);

  const toggle = (key: ManualPluginBadge, next: boolean) => {
    setManual(prev => {
      const updated = { ...prev, [key]: next };
      // works / not_works are mutually exclusive (server enforces; so does UI)
      if (next && key === 'works') updated.not_works = false;
      if (next && key === 'not_works') updated.works = false;
      return updated;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    const badges = (Object.keys(manual) as ManualPluginBadge[]).filter(k => manual[k]);
    try {
      const res = await setPluginBadges(pluginId, badges);
      if (res.success) {
        toast.success(t('admin.plugins.submissions.badges.saved'));
      } else {
        toast.error(
          `${t('admin.plugins.submissions.badges.saveFailed')}: ${res.error ?? ''}`,
        );
      }
    } catch (err) {
      toast.error(errText(err, 'admin.plugins.submissions.badges.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-200">
          {t('admin.plugins.submissions.badges.title')}
        </span>
        <Button
          variant="secondary"
          size="xs"
          onClick={() => void handleSave()}
          disabled={saving || loading}
        >
          {t('admin.plugins.submissions.badges.save')}
        </Button>
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed">
        {t('admin.plugins.submissions.badges.hint')}
      </p>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="w-3 h-3 animate-spin" />
          {t('common.loading')}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Toggle
            size="sm"
            label={t('admin.plugins.submissions.badges.recommended')}
            checked={manual.recommended}
            onChange={v => toggle('recommended', v)}
            disabled={saving}
          />
          <Toggle
            size="sm"
            label={t('admin.plugins.submissions.badges.works')}
            checked={manual.works}
            onChange={v => toggle('works', v)}
            disabled={saving}
          />
          <Toggle
            size="sm"
            label={t('admin.plugins.submissions.badges.notWorks')}
            checked={manual.not_works}
            onChange={v => toggle('not_works', v)}
            disabled={saving}
          />
          <Tooltip content={t('admin.plugins.submissions.badges.verifiedComputed')} side="top">
            <div className="opacity-70 cursor-not-allowed">
              <Toggle
                size="sm"
                label={t('admin.plugins.submissions.badges.verified')}
                checked={verified}
                onChange={() => { /* computed server-side — never settable */ }}
                disabled
              />
            </div>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

// ── Detail modal ─────────────────────────────────────────────────────────────

interface SubmissionDetailModalProps {
  detail: PluginSubmissionDetail | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  onClose: () => void;
  onApproveClick: () => void;
  onRejectClick: () => void;
  onDelist: () => void | Promise<void>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
      {children}
    </h4>
  );
}

function SubmissionDetailModal({
  detail, loading, error, busy, onClose, onApproveClick, onRejectClick, onDelist,
}: SubmissionDetailModalProps) {
  const gates = useMemo(
    () => Object.entries(detail?.gate_report ?? {}),
    [detail],
  );

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t('admin.plugins.submissions.detail.title', { id: detail?.id ?? '…' })}
      icon={<FileText size={18} />}
      size="lg"
      isLoading={busy}
      footer={
        detail ? (
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>{t('common.cancel')}</Button>
            {detail.review_status === 'pending' && (
              <>
                <Button variant="danger" size="sm" onClick={onRejectClick} disabled={busy}>
                  {t('admin.plugins.submissions.actions.reject')}
                </Button>
                <Button variant="primary" size="sm" onClick={onApproveClick} disabled={busy}>
                  {t('admin.plugins.submissions.actions.approve')}
                </Button>
              </>
            )}
            {detail.review_status === 'approved' && (
              <Tooltip
                content={t('admin.plugins.submissions.actions.delistMessage', {
                  plugin: detail.plugin_id,
                  version: detail.version,
                })}
                side="top"
              >
                <span>
                  <ConfirmActionButton
                    variant="secondary"
                    size="sm"
                    onConfirm={onDelist}
                    disabled={busy}
                  >
                    {t('admin.plugins.submissions.actions.delist')}
                  </ConfirmActionButton>
                </span>
              </Tooltip>
            )}
          </div>
        ) : undefined
      }
    >
      {loading ? (
        <div className="p-6 flex items-center justify-center gap-2 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t('common.loading')}
        </div>
      ) : error ? (
        <div className="p-6 text-center">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
          <p className="text-sm text-slate-400 break-words">{error}</p>
        </div>
      ) : detail ? (
        <div className="flex flex-col gap-5">
          {/* Meta */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
            <div>
              <span className="text-slate-500">{t('admin.plugins.submissions.colSubmission')}: </span>
              {/* eslint-disable-next-line i18next/no-literal-string -- non-translatable id/version token */}
              <span className="text-slate-200 font-mono">#{detail.id} · {detail.plugin_id}@{detail.version}</span>
            </div>
            <div>
              <span className="text-slate-500">{t('admin.plugins.submissions.colStatus')}: </span>
              <StatusChip status={detail.review_status} />
            </div>
            <div>
              <span className="text-slate-500">{t('admin.plugins.submissions.detail.submittedBy')}: </span>
              <span className="text-slate-200">{detail.submitted_by_name ?? '—'}</span>
            </div>
            <div>
              <span className="text-slate-500">{t('admin.plugins.submissions.detail.createdAt')}: </span>
              <span className="text-slate-200">{formatDate(detail.created_at)}</span>
            </div>
            <div>
              <span className="text-slate-500">{t('admin.plugins.submissions.colSource')}: </span>
              {/* eslint-disable-next-line i18next/no-literal-string -- non-translatable source type token */}
              <span className="text-slate-200 font-mono">{detail.source_type}</span>
            </div>
            {detail.source_url && (
              <div className="col-span-2 min-w-0">
                <span className="text-slate-500">{t('admin.plugins.submissions.detail.sourceUrl')}: </span>
                <span className="text-slate-200 font-mono break-all">{detail.source_url}</span>
              </div>
            )}
            {detail.reviewer && (
              <div>
                <span className="text-slate-500">{t('admin.plugins.submissions.detail.reviewer')}: </span>
                <span className="text-slate-200">{detail.reviewer}</span>
              </div>
            )}
            {detail.reviewed_at && (
              <div>
                <span className="text-slate-500">{t('admin.plugins.submissions.detail.reviewedAt')}: </span>
                <span className="text-slate-200">{formatDate(detail.reviewed_at)}</span>
              </div>
            )}
          </div>

          {detail.rejection_reason && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
              <span className="text-xs font-semibold text-red-300">
                {t('admin.plugins.submissions.detail.rejectionReason')}:
              </span>
              <p className="text-xs text-red-300/90 mt-0.5 leading-relaxed break-words">
                {detail.rejection_reason}
              </p>
            </div>
          )}

          {/* SHA256 */}
          <div>
            <SectionLabel>{t('admin.plugins.submissions.detail.sha256')}</SectionLabel>
            <p className="text-xs text-slate-300 font-mono break-all">
              {detail.sha256 ?? '—'}
            </p>
          </div>

          {/* Declared domains */}
          <div>
            <SectionLabel>{t('admin.plugins.submissions.detail.domains')}</SectionLabel>
            {detail.declared_domains.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {detail.declared_domains.map(d => (
                  <Badge key={d} variant="outline" size="sm" className="normal-case font-mono">
                    {d}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic">
                {t('admin.plugins.submissions.detail.noDomains')}
              </p>
            )}
          </div>

          {/* Gate report */}
          <div>
            <SectionLabel>{t('admin.plugins.submissions.detail.gates')}</SectionLabel>
            {gates.length > 0 ? (
              <ul className="rounded-lg border border-white/[0.06] divide-y divide-white/[0.04] overflow-hidden">
                {gates.map(([name, gate]) => (
                  <li key={name} className="flex items-start gap-2 px-3 py-2 bg-white/[0.02]">
                    {gate?.pass ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <X className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      {/* eslint-disable-next-line i18next/no-literal-string -- gate name is a non-translatable backend token */}
                      <span className={cn('text-xs font-mono', gate?.pass ? 'text-slate-300' : 'text-red-300')}>
                        {name}
                      </span>
                      {gate?.detail && (
                        <p className="text-[11px] text-slate-500 leading-relaxed break-words mt-0.5">
                          {gate.detail}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500 italic">
                {t('admin.plugins.submissions.detail.noGates')}
              </p>
            )}
          </div>

          {/* Manifest snapshot */}
          <div>
            <SectionLabel>{t('admin.plugins.submissions.detail.manifest')}</SectionLabel>
            <pre className="text-[11px] text-slate-400 font-mono whitespace-pre-wrap break-all rounded-lg border border-white/[0.06] bg-black/60 p-3 max-h-56 overflow-y-auto">
              {JSON.stringify(detail.manifest_json ?? {}, null, 2)}
            </pre>
          </div>

          {/* Package files */}
          <div>
            <SectionLabel>{t('admin.plugins.submissions.detail.files')}</SectionLabel>
            {detail.package_files && detail.package_files.length > 0 ? (
              <ul className="rounded-lg border border-white/[0.06] bg-black/40 p-3 max-h-40 overflow-y-auto space-y-0.5">
                {detail.package_files.map(f => (
                  <li key={f} className="text-[11px] text-slate-400 font-mono break-all">{f}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500 italic">
                {t('admin.plugins.submissions.detail.noFiles')}
              </p>
            )}
          </div>

          {/* Attestation */}
          <div>
            <SectionLabel>{t('admin.plugins.submissions.detail.attestation')}</SectionLabel>
            {detail.attestation ? (
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="indigo" size="sm">
                  <ShieldCheck className="w-3 h-3" />
                  {t('marketplace.badgeVerified')}
                </Badge>
                <span className="text-slate-300">
                  {t('admin.plugins.submissions.detail.attestationSigned', {
                    reviewer: detail.attestation.reviewed_by,
                    date: formatDate(detail.attestation.reviewed_at),
                  })}
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-amber-300/80">
                  {t('admin.plugins.submissions.detail.attestationPending')}
                </p>
                <code className="text-[11px] text-slate-400 font-mono bg-black/40 border border-white/[0.06] rounded px-2 py-1.5 break-all">
                  {t('admin.plugins.submissions.detail.attestationCliHint', { id: detail.id })}
                </code>
              </div>
            )}
          </div>

          {/* Badges editor — approved plugins only */}
          {detail.review_status === 'approved' && (
            <BadgesEditor
              pluginId={detail.plugin_id}
              attested={detail.attestation !== null}
            />
          )}
        </div>
      ) : null}
    </Modal>
  );
}

// ── Section ──────────────────────────────────────────────────────────────────

export function SubmissionsSection() {
  const user = useAuthStore(state => state.user);
  const reviewerName = user?.username ?? '';

  const [rows, setRows] = useState<PluginSubmissionSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');

  const [detail, setDetail] = useState<PluginSubmissionDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [approveOpen, setApproveOpen] = useState(false);
  const [reviewer, setReviewer] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listSubmissions(statusFilter ? { status: statusFilter } : {});
      if (res.success) {
        setRows(res.submissions ?? []);
      } else {
        setRows(null);
        setError(res.error ?? t('admin.plugins.submissions.loadFailed'));
      }
    } catch (err) {
      setRows(null);
      setError(errText(err, 'admin.plugins.submissions.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial/filtered fetch on mount; loading flag set synchronously for immediate spinner
  useEffect(() => { void load(); }, [load]);

  const openDetail = useCallback(async (id: number) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    setDetailError(null);
    try {
      const res = await getSubmission(id);
      if (res.success && res.submission) {
        setDetail(res.submission);
      } else {
        setDetailError(res.error ?? t('admin.plugins.submissions.detail.loadFailed'));
      }
    } catch (err) {
      setDetailError(errText(err, 'admin.plugins.submissions.detail.loadFailed'));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const closeDetail = useCallback(() => {
    if (busy) return;
    setDetailOpen(false);
    setDetail(null);
    setDetailError(null);
  }, [busy]);

  /**
   * Optimistic status flip on the queue row + detail, mirroring the role
   * matrix pattern: apply → call → toast, rollback both snapshots on failure.
   * Resolves true only when the backend accepted the action.
   */
  const runAction = useCallback(
    async (
      id: number,
      nextStatus: string,
      action: () => Promise<{ success: boolean; error?: string }>,
      patchDetail?: (d: PluginSubmissionDetail) => PluginSubmissionDetail,
    ): Promise<boolean> => {
      const rowsSnapshot = rows;
      const detailSnapshot = detail;
      setBusy(true);
      setRows(prev => prev?.map(r => (r.id === id ? { ...r, review_status: nextStatus } : r)) ?? prev);
      if (detail && patchDetail) setDetail(patchDetail(detail));
      try {
        const res = await action();
        if (res.success) {
          toast.success(t('admin.plugins.submissions.actions.success'));
          // Re-fetch to reconcile with server truth (approve re-runs gates and
          // may still reject upstream). Optimistic state stays until it lands.
          void load().catch(() => { /* optimistic state remains; toast already shown */ });
          return true;
        }
        setRows(rowsSnapshot);
        setDetail(detailSnapshot);
        toast.error(
          `${t('admin.plugins.submissions.actions.failed')}: ${res.error ?? ''}`,
        );
        return false;
      } catch (err) {
        setRows(rowsSnapshot);
        setDetail(detailSnapshot);
        toast.error(errText(err, 'admin.plugins.submissions.actions.failed'));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [rows, detail, load],
  );

  const handleApprove = useCallback(async () => {
    if (!detail) return;
    const name = reviewer.trim() || reviewerName;
    const ok = await runAction(
      detail.id,
      'approved',
      () => approveSubmission(detail.id, name),
      d => ({ ...d, review_status: 'approved', reviewer: name }),
    );
    if (ok) setApproveOpen(false);
  }, [detail, reviewer, reviewerName, runAction]);

  const handleReject = useCallback(async () => {
    if (!detail) return;
    const reason = rejectReason.trim();
    const ok = await runAction(
      detail.id,
      'rejected',
      () => rejectSubmission(detail.id, reason, reviewerName || undefined),
      d => ({ ...d, review_status: 'rejected', rejection_reason: reason }),
    );
    if (ok) {
      setRejectOpen(false);
      setRejectReason('');
    }
  }, [detail, rejectReason, reviewerName, runAction]);

  const handleDelist = useCallback(async () => {
    if (!detail) return;
    await runAction(detail.id, 'delisted', () => delistSubmission(detail.id), d => ({
      ...d,
      review_status: 'delisted',
    }));
  }, [detail, runAction]);

  const statusOptions = useMemo(
    () => [
      { value: '', label: t('filters.any') },
      { value: 'pending', label: t('admin.plugins.submissions.statusPending') },
      { value: 'approved', label: t('admin.plugins.submissions.statusApproved') },
      { value: 'rejected', label: t('admin.plugins.submissions.statusRejected') },
      { value: 'delisted', label: t('admin.plugins.submissions.statusDelisted') },
    ],
    [],
  );

  return (
    <>
    {/* backdrop-filter creates a containing block for fixed descendants —
        the dialogs below must stay OUTSIDE this div to overlay the viewport */}
    <div className="rounded-xl border border-white/[0.06] bg-black/40 backdrop-blur-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Inbox className="w-4 h-4 text-indigo-400 shrink-0" />
          <h2 className="text-sm font-semibold text-white">
            {t('admin.plugins.submissions.title')}
          </h2>
          <span className="text-xs text-slate-500 truncate">
            {t('admin.plugins.submissions.desc')}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-40">
            <Select
              value={statusFilter}
              onValueChange={setStatusFilter}
              options={statusOptions}
              placeholder={t('admin.plugins.submissions.statusFilter')}
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            leftIcon={<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />}
          >
            {t('admin.plugins.submissions.refresh')}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="p-6 text-center">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
          <p className="text-sm text-slate-400 break-words">{error}</p>
        </div>
      ) : loading && rows === null ? (
        <div className="p-6 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-4 rounded bg-white/[0.04] animate-pulse" />
          ))}
        </div>
      ) : !rows || rows.length === 0 ? (
        <div className="p-10 text-center">
          <Inbox className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-500">{t('admin.plugins.submissions.empty')}</p>
          <p className="text-xs text-slate-600 mt-1">
            {t('admin.plugins.submissions.emptyDesc')}
          </p>
        </div>
      ) : (
        <Table className="w-full text-sm" containerClassName="overflow-x-auto">
          <TableHeader className="bg-transparent">
            <TableRow className="border-b border-white/[0.06] text-left hover:bg-transparent">
              <TableHead className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider">
                {t('admin.plugins.submissions.colSubmission')}
              </TableHead>
              <TableHead className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider">
                {t('admin.plugins.submissions.colSource')}
              </TableHead>
              <TableHead className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider">
                {t('admin.plugins.submissions.colSubmitter')}
              </TableHead>
              <TableHead className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider">
                {t('admin.plugins.submissions.colStatus')}
              </TableHead>
              <TableHead className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider">
                {t('admin.plugins.submissions.colDate')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow
                key={r.id}
                onClick={() => void openDetail(r.id)}
                className={cn(
                  'border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02] transition-colors cursor-pointer',
                  loading && 'opacity-60 pointer-events-none',
                )}
              >
                <TableCell className="px-5 py-3">
                  {/* eslint-disable-next-line i18next/no-literal-string -- non-translatable id/version token */}
                  <span className="text-slate-200 font-mono text-xs">
                    #{r.id} · {r.plugin_id}@{r.version}
                  </span>
                </TableCell>
                <TableCell className="px-5 py-3">
                  {/* eslint-disable-next-line i18next/no-literal-string -- non-translatable source type token */}
                  <span className="text-slate-400 font-mono text-xs">{r.source_type}</span>
                </TableCell>
                <TableCell className="px-5 py-3 text-slate-300 text-xs">
                  {r.submitted_by_name ?? '—'}
                </TableCell>
                <TableCell className="px-5 py-3">
                  <StatusChip status={r.review_status} />
                </TableCell>
                <TableCell className="px-5 py-3 text-slate-500 text-xs tabular-nums">
                  {formatDate(r.created_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>

      {detailOpen && (
        <SubmissionDetailModal
          detail={detail}
          loading={detailLoading}
          error={detailError}
          busy={busy}
          onClose={closeDetail}
          onApproveClick={() => {
            setReviewer(reviewerName);
            setApproveOpen(true);
          }}
          onRejectClick={() => setRejectOpen(true)}
          onDelist={handleDelist}
        />
      )}

      {/* Approve confirm — reviewer prefilled from the current admin */}
      <ActionDialog
        isOpen={approveOpen}
        onClose={() => setApproveOpen(false)}
        onSubmit={handleApprove}
        title={t('admin.plugins.submissions.actions.approveTitle')}
        description={
          detail
            ? t('admin.plugins.submissions.actions.approveMessage', {
                plugin: detail.plugin_id,
                version: detail.version,
              })
            : undefined
        }
        confirmText={t('admin.plugins.submissions.actions.approve')}
        isLoading={busy}
        submitDisabled={!reviewer.trim()}
        mode="edit"
      >
        <Input
          label={t('admin.plugins.submissions.actions.reviewer')}
          value={reviewer}
          onChange={e => setReviewer(e.target.value)}
          disabled={busy}
        />
      </ActionDialog>

      {/* Reject — reason required */}
      <ActionDialog
        isOpen={rejectOpen}
        onClose={() => setRejectOpen(false)}
        onSubmit={handleReject}
        title={t('admin.plugins.submissions.actions.rejectTitle')}
        confirmText={t('admin.plugins.submissions.actions.reject')}
        variant="danger"
        mode="edit"
        isLoading={busy}
        submitDisabled={!rejectReason.trim()}
      >
        <Input
          label={t('admin.plugins.submissions.actions.rejectReason')}
          value={rejectReason}
          onChange={e => setRejectReason(e.target.value)}
          placeholder={t('admin.plugins.submissions.actions.rejectReasonPh')}
          disabled={busy}
        />
      </ActionDialog>

    </>
  );
}
