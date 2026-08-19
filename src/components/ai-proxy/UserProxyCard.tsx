import { useState, useEffect, useCallback } from 'react';
import {
  KeyRound,
  Copy,
  Plus,
  RefreshCw,
  Trash2,
  User,
  Users,
  Globe,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth';
import {
  proxyKeysList,
  proxyKeysCreate,
  proxyKeysRevoke,
  type ProxyKey,
  type ProxyKeyListResponse,
} from '@/lib/backend/modules/aiGateway';
import { GlassCard, Badge, Button, IconButton, Tooltip, Modal } from '@/components/ui';
import { askConfirm } from '@/components/ui/ConfirmDialogHost';
import { appToast } from '@/lib/observability/toast';
import { t } from '@/lib/i18n';

// ── CopyField (mirrors AiProxyControlsSection's pattern) ───────────────────
function CopyField({
  label,
  value,
  onCopy,
  copyLabel,
  requireConfirm,
}: {
  label: string;
  value: string;
  onCopy: (label: string, value: string, requireConfirm?: boolean) => void;
  copyLabel: string;
  requireConfirm?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 bg-black/30 border border-white/10 rounded-lg px-3 py-2 min-w-0">
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
        <div className="text-xs font-mono text-slate-200 truncate">{value}</div>
      </div>
      <Tooltip content={copyLabel}>
        <IconButton
          size="sm"
          variant="ghost"
          onClick={() => onCopy(label, value, requireConfirm)}
          aria-label={copyLabel}
        >
          <Copy size={14} />
        </IconButton>
      </Tooltip>
    </div>
  );
}

export function UserProxyCard() {
  const authEnabled = useAuthStore(s => s.enabled);
  const [data, setData] = useState<ProxyKeyListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rawKeyModal, setRawKeyModal] = useState<{ key: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await proxyKeysList();
      setData(res);
    } catch (e) {
      appToast.error(e instanceof Error ? e.message : String(e), 'ai-proxy');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount (auth enabled only). Inlined as an async IIFE so the
  // setState calls land in a microtask, not synchronously in the effect body.
  useEffect(() => {
    if (!authEnabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await proxyKeysList();
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) {
          appToast.error(e instanceof Error ? e.message : String(e), 'ai-proxy');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authEnabled]);

  const handleCopy = useCallback(
    async (label: string, value: string, requireConfirm = false) => {
      if (!value) {
        appToast.error(t('aiHub.copy.empty'), 'ai-proxy');
        return;
      }
      if (requireConfirm) {
        const ok = await askConfirm({
          title: t('common.copy'),
          message: t('aiHub.warnings.copySensitiveConfirm', { label }),
          confirmText: t('common.copy'),
          cancelText: t('common.cancel'),
          variant: 'warning',
        });
        if (!ok) return;
      }
      try {
        await navigator.clipboard.writeText(value);
        appToast.success(t('aiHub.copy.success', { label }), 'ai-proxy');
      } catch (e) {
        console.error('[UserProxyCard] Copy failed:', e);
        appToast.error(t('aiHub.copy.fail', { label }), 'ai-proxy');
      }
    },
    []
  );

  const handleCreateKey = useCallback(async () => {
    setBusy(true);
    try {
      const created = await proxyKeysCreate({ label: null });
      await refresh();
      // Show the raw key ONCE in a modal with a copy button.
      setRawKeyModal({ key: created.key });
      appToast.success(t('ai.proxy.created'), 'ai-proxy');
    } catch (e) {
      appToast.error(e instanceof Error ? e.message : String(e), 'ai-proxy');
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const handleRegenerateDefault = useCallback(async () => {
    const ok = await askConfirm({
      title: t('ai.proxy.regenerateConfirm.title'),
      message: t('ai.proxy.regenerateConfirm.body'),
      confirmText: t('ai.proxy.regenerateConfirm.confirm'),
      cancelText: t('common.cancel'),
      variant: 'warning',
    });
    if (!ok) return;
    setBusy(true);
    try {
      // Regenerate = revoke the old default + create a new one.
      const current = data?.keys.find(k => k.isDefault);
      if (current) {
        await proxyKeysRevoke(current.id);
      }
      const created = await proxyKeysCreate({ label: 'default' });
      await refresh();
      setRawKeyModal({ key: created.key });
      appToast.success(t('ai.proxy.created'), 'ai-proxy');
    } catch (e) {
      appToast.error(e instanceof Error ? e.message : String(e), 'ai-proxy');
    } finally {
      setBusy(false);
    }
  }, [data, refresh]);

  const handleRevoke = useCallback(async (key: ProxyKey) => {
    const ok = await askConfirm({
      title: t('ai.proxy.revokeConfirm.title', { label: key.label ?? '' }),
      message: t('ai.proxy.revokeConfirm.body'),
      confirmText: t('ai.proxy.revoke'),
      cancelText: t('common.cancel'),
      variant: 'warning',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await proxyKeysRevoke(key.id);
      await refresh();
      appToast.success(t('ai.proxy.revoke'), 'ai-proxy');
    } catch (e) {
      appToast.error(e instanceof Error ? e.message : String(e), 'ai-proxy');
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  // Render nothing when auth is disabled (desktop mode has no per-user proxy).
  if (!authEnabled) return null;

  const defaultKey = data?.keys.find(k => k.isDefault) ?? null;
  const extraKeys = data?.keys.filter(k => !k.isDefault) ?? [];
  const pool = data?.pool;
  const hasEnabledKey = data?.keys.some(k => k.enabled) ?? false;

  return (
    <>
      <GlassCard className="mb-4 p-4 md:p-5" glow="blue">
        <div className="flex flex-col gap-4">
          {/* Header */}
          <div className="flex items-center gap-2 flex-wrap">
            <KeyRound size={16} className="text-indigo-300" />
            <h3 className="text-sm font-semibold text-white">{t('ai.proxy.title')}</h3>
            <Badge variant={hasEnabledKey ? 'success' : 'default'} size="sm" withDot>
              {hasEnabledKey ? t('aiHub.proxy.running') : t('ai.proxy.empty')}
            </Badge>
          </div>

          {loading ? (
            <div className="text-xs text-slate-500 py-2">{t('aiGateway.list.loadingCredentials')}</div>
          ) : data ? (
            <>
              {/* Copy fields: base URL + masked default key */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <CopyField
                  label={t('ai.proxy.baseUrl')}
                  value={data.baseUrl}
                  onCopy={handleCopy}
                  copyLabel={t('aiHub.actions.copy')}
                />
                <CopyField
                  label={t('ai.proxy.defaultKey')}
                  value={defaultKey?.maskedKey ?? t('ai.proxy.empty')}
                  onCopy={handleCopy}
                  copyLabel={t('aiHub.actions.copy')}
                  requireConfirm={Boolean(defaultKey)}
                />
              </div>

              {/* Pool composition chips */}
              {pool && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500">
                    {t('ai.proxy.poolLabel')}
                  </span>
                  <Badge variant="info" size="sm" withDot>
                    <User size={10} /> {t('ai.proxy.pool.personal')} ({pool.personal})
                  </Badge>
                  {pool.groups.map(g => (
                    <Badge key={g.id} variant="indigo" size="sm" withDot>
                      <Users size={10} /> {g.name} ({g.keys})
                    </Badge>
                  ))}
                  <Badge variant="slate" size="sm" withDot>
                    <Globe size={10} /> {t('ai.proxy.pool.legacy')} ({pool.legacy})
                  </Badge>
                </div>
              )}

              {/* Extra keys list */}
              {extraKeys.length > 0 && (
                <div className="space-y-1 border-t border-white/[0.06] pt-3">
                  {extraKeys.map(k => (
                    <div
                      key={k.id}
                      className="flex items-center justify-between gap-2 bg-black/20 border border-white/5 rounded-lg px-3 py-1.5"
                    >
                      <div className="min-w-0">
                        <div className="text-xs text-slate-300 truncate">
                          {k.label ?? t('ai.proxy.empty')}{' '}
                          <span className="font-mono text-slate-500">{k.maskedKey}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Tooltip content={t('aiHub.actions.copy')}>
                          <IconButton
                            size="sm"
                            variant="ghost"
                            onClick={() => void handleCopy(k.label ?? t('ai.proxy.defaultKey'), k.maskedKey)}
                            aria-label={t('aiHub.actions.copy')}
                          >
                            <Copy size={14} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip content={t('ai.proxy.revoke')}>
                          <IconButton
                            size="sm"
                            variant="ghost"
                            onClick={() => void handleRevoke(k)}
                            aria-label={t('ai.proxy.revoke')}
                            disabled={busy}
                          >
                            <Trash2 size={14} className="text-red-400" />
                          </IconButton>
                        </Tooltip>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-white/[0.06]">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleCreateKey()}
                  disabled={busy}
                  leftIcon={<Plus size={14} />}
                >
                  {t('ai.proxy.createKey')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleRegenerateDefault()}
                  disabled={busy || !defaultKey}
                  leftIcon={<RefreshCw size={14} />}
                >
                  {t('ai.proxy.regenerate')}
                </Button>
              </div>
            </>
          ) : (
            <div className="text-xs text-slate-500 py-2">{t('ai.proxy.empty')}</div>
          )}
        </div>
      </GlassCard>

      {/* ── Raw key shown ONCE after create/regenerate ─────────────────────── */}
      <Modal
        isOpen={rawKeyModal !== null}
        onClose={() => setRawKeyModal(null)}
        title={t('ai.proxy.createKey')}
        icon={<KeyRound size={18} />}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="primary" onClick={() => setRawKeyModal(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-amber-300">{t('ai.proxy.rawKeyHint')}</p>
          <div className="flex items-center justify-between gap-2 bg-black/30 border border-white/10 rounded-lg px-3 py-2">
            <div className="text-xs font-mono text-slate-200 truncate flex-1 min-w-0">
              {rawKeyModal?.key ?? ''}
            </div>
            <Tooltip content={t('aiHub.actions.copy')}>
              <IconButton
                size="sm"
                variant="ghost"
                onClick={() => rawKeyModal && void handleCopy(t('ai.proxy.defaultKey'), rawKeyModal.key)}
                aria-label={t('aiHub.actions.copy')}
              >
                <Copy size={14} />
              </IconButton>
            </Tooltip>
          </div>
        </div>
      </Modal>
    </>
  );
}
