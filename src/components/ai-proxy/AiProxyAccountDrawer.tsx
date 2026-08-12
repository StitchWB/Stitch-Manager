import { t } from "@/lib/i18n";import { useEffect, useMemo, useState } from 'react';
import { X, PlugZap, PenSquare, Trash2, RefreshCw, Clock, AlertTriangle } from 'lucide-react';
import { ButtonBase, ConfirmActionButton, ProviderLogo, StatusBadge, UsageBar } from '@/components/ui';

import type { AiProxyAccount } from '../../types/generated';
import { cn } from '../../lib/utils';
import { useAiProxyStore } from '../../stores/aiProxy';
import { getRequestHistorySafe } from '@/lib/backend/modules/aiProxy';

type ConnectionState = {status: 'idle' | 'loading' | 'ok' | 'error';message?: string;};

interface AiProxyAccountDrawerProps {
  account: AiProxyAccount | null;
  isOpen: boolean;
  onClose: () => void;
  onTestConnection: (account: AiProxyAccount) => void;
  onEdit: (account: AiProxyAccount) => void;
  onDelete: (id: number) => void;
  connection?: ConnectionState;
}

function formatUnixSeconds(ts?: number | null): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString();
}

function formatSecondsLeft(ts?: number | null): string | null {
  if (!ts) return null;
  const msLeft = ts * 1000 - Date.now();
  if (msLeft <= 0) return null;
  const s = Math.floor(msLeft / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function normalizeKey(s: string): string {
  return s.toLowerCase().trim();
}

function extractFileTail(accountName: string): string | null {
  const m = accountName.match(/\(([^)]+\.(?:json|jsonc))\)/i);
  return m?.[1] ?? null;
}

export function AiProxyAccountDrawer({
  account,
  isOpen,
  onClose,
  onTestConnection,
  onEdit,
  onDelete,
  connection
}: AiProxyAccountDrawerProps) {
  const openAiQuotaMap = useAiProxyStore((state) => state.openAiAccountQuotas);
  const [recentRequests, setRecentRequests] = useState<
    Array<{
      id?: number | null;
      accountId?: number | null;
      model: string;
      status: number;
      durationMs?: number | null;
      tokensIn?: number | null;
      tokensOut?: number | null;
      errorMessage?: string | null;
      createdAt: number;
    }>>(
    []);
  const [requestsLoading, setRequestsLoading] = useState(false);

  const meta = (account ?? null) as
  (AiProxyAccount & {
    oauthRefreshError?: string | null;
    oauthRefreshToken?: string | null;
    cooldownUntil?: number | null;
    lastError?: string | null;
  }) |
  null;

  const openAiQuota = useMemo(() => {
    if (!account) return null;
    if (account.provider !== 'openai') return null;
    const fileTail = extractFileTail(account.name);
    const candidates = [
    account.name,
    fileTail ?? '',
    fileTail ? fileTail.replace(/\.(json|jsonc)$/i, '') : ''].

    filter(Boolean).
    map(normalizeKey);
    return candidates.map((k) => openAiQuotaMap[k]).find(Boolean) ?? null;
  }, [account, openAiQuotaMap]);

  const cooldownLeft = formatSecondsLeft(meta?.cooldownUntil);

  // Close on escape
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  // Load recent requests (best-effort)
  useEffect(() => {
    if (!isOpen || !account?.id) return;

    let cancelled = false;
      queueMicrotask(() => {
    setRequestsLoading(true);
      });
    void (async () => {
      try {
        // We only have global history API today; filter client-side.
        const rows = await getRequestHistorySafe(200, 0);
        if (cancelled) return;
        const filtered = rows.filter((r) => r.accountId === account.id).slice(0, 20);
        setRecentRequests(filtered);
      } finally {
        if (!cancelled) setRequestsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, account?.id]);

  if (!account) return null;

  const status: 'active' | 'inactive' | 'warning' | 'error' = !account.enabled ?
  'inactive' :
  connection?.status === 'error' ?
  'error' :
  'active';

  return (
    <>
      <div
        aria-label="Close"
        className={cn(
          'fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity duration-150',
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
        role="presentation"
      />
      

      <div
        className={cn(
          'fixed top-0 right-0 h-full w-[460px] max-w-[95vw] border-l border-white/10 z-50 flex flex-col',
          'transform transition-transform duration-150 ease-out',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
        style={{ background: 'rgba(15, 23, 42, 0.5)' }}
        role="dialog"
        aria-modal="true"
        aria-label="AI Proxy account details">
        
        {/* Header */}
        <div className="flex items-center gap-4 p-5 border-b border-white/10">
          <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center border border-white/10">
            <ProviderLogo provider={account.provider} size={28} colored />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white truncate">{account.name}</div>
            <div className="text-[11px] uppercase tracking-wider text-slate-500">
              {account.provider}
            </div>
          </div>
          <ButtonBase
            onClick={onClose}
            className="p-1.5 rounded-sm text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-colors"
            aria-label="Close">
            
            <X className="w-4 h-4" />
          </ButtonBase>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          {/* Status strip */}
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusBadge status={status} withDot size="sm" />
                {!account.enabled ?
                <span className="text-xs text-slate-500">{t("aiHub.ai_proxy_account_drawer.disabled")}</span> :
                connection?.status === 'ok' ?
                <span className="text-xs text-emerald-300">{t("aiHub.ai_proxy_account_drawer.connected")}</span> :
                connection?.status === 'error' ?
                <span className="text-xs text-red-300">{t("aiHub.ai_proxy_account_drawer.connection_error")}</span> :

                <span className="text-xs text-slate-500">—</span>
                }
              </div>

              {account.id ?
              <div className="text-[11px] text-slate-500 tabular-nums">{t("aiHub.ai_proxy_account_drawer.id")}{account.id}</div> :
              null}
            </div>

            {cooldownLeft ?
            <div className="flex items-center justify-between text-xs border border-amber-500/20 bg-amber-500/10 rounded px-3 py-2">
                <div className="flex items-center gap-2 text-amber-200">
                  <Clock size={14} />
                  <span>{t("aiHub.ai_proxy_account_drawer.cooldown")}</span>
                </div>
                <div className="text-amber-100 tabular-nums">{cooldownLeft}{t("aiHub.ai_proxy_account_drawer.left")}</div>
              </div> :
            null}

            {meta?.oauthRefreshToken && meta?.oauthRefreshError ?
            <div className="flex items-start gap-2 text-xs border border-amber-500/20 bg-amber-500/10 rounded px-3 py-2">
                <AlertTriangle size={14} className="text-amber-200 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-amber-200 font-medium">{t("aiHub.ai_proxy_account_drawer.refresh_error")}</div>
                  <div className="text-amber-100/80 break-words">{meta.oauthRefreshError}</div>
                </div>
              </div> :
            null}

            {connection?.status === 'error' && connection.message ?
            <div className="text-xs border border-red-500/20 bg-red-500/10 rounded px-3 py-2 text-red-200 break-words">
                {connection.message}
              </div> :
            null}
          </div>

          {/* Quota */}
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3">
            <div className="text-xs font-semibold text-white">{t("aiHub.ai_proxy_account_drawer.quota")}</div>
            {account.provider === 'openai' ?
            openAiQuota ?
            openAiQuota.error ?
            <div className="text-xs text-amber-200 border border-amber-500/20 bg-amber-500/10 rounded px-3 py-2">
                    {openAiQuota.error}
                  </div> :

            <div className="space-y-3">
                    <div>
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span>{t("aiHub.ai_proxy_account_drawer.primary")}</span>
                        <span className="tabular-nums text-slate-200">
                          {Math.round(openAiQuota.primary.usedPercent)}%
                        </span>
                      </div>
                      <UsageBar used={Math.round(openAiQuota.primary.usedPercent)} limit={100} />
                      <div className="text-[11px] text-slate-500 mt-1">{t("aiHub.ai_proxy_account_drawer.resets")}
                  {' '}
                        {openAiQuota.primary.resetAt ?
                  new Date(openAiQuota.primary.resetAt * 1000).toLocaleString() :
                  '—'}
                      </div>
                    </div>
                    {openAiQuota.secondary ?
              <div>
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span>{t("aiHub.ai_proxy_account_drawer.weekly")}</span>
                          <span className="tabular-nums text-slate-200">
                            {Math.round(openAiQuota.secondary.usedPercent)}%
                          </span>
                        </div>
                        <UsageBar
                  used={Math.round(openAiQuota.secondary.usedPercent)}
                  limit={100} />
                
                        <div className="text-[11px] text-slate-500 mt-1">{t("aiHub.ai_proxy_account_drawer.resets")}
                  {' '}
                          {openAiQuota.secondary.resetAt ?
                  new Date(openAiQuota.secondary.resetAt * 1000).toLocaleString() :
                  '—'}
                        </div>
                      </div> :
              null}
                  </div> :


            <div className="text-xs text-slate-500">{t("aiHub.ai_proxy_account_drawer.no_quota_fetched_yet")}</div> :


            <div className="text-xs text-slate-500">—</div>
            }
          </div>

          {/* Recent requests */}
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-white">{t("aiHub.ai_proxy_account_drawer.recent_requests")}</div>
              <ButtonBase
                type="button"
                className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1"
                onClick={() => {
                  if (!account.id) return;
                  setRequestsLoading(true);
                  void (async () => {
                    try {
                      const rows = await getRequestHistorySafe(200, 0);
                      setRecentRequests(rows.filter((r) => r.accountId === account.id).slice(0, 20));
                    } finally {
                      setRequestsLoading(false);
                    }
                  })();
                }}>
                
                <RefreshCw size={14} />{t("aiHub.ai_proxy_account_drawer.refresh")}
              </ButtonBase>
            </div>

            {requestsLoading ?
            <div className="text-xs text-slate-500">{t("aiHub.ai_proxy_account_drawer.loading")}</div> :
            recentRequests.length === 0 ?
            <div className="text-xs text-slate-500">{t("aiHub.ai_proxy_account_drawer.no_requests_yet")}</div> :

            <div className="space-y-1">
                {recentRequests.map((r) =>
              <div
                key={String(r.id ?? `${r.createdAt}-${r.model}-${r.status}`)}
                className="flex items-start justify-between gap-3 text-[11px] px-2 py-1 rounded hover:bg-white/[0.03]">
                
                    <div className="min-w-0">
                      <div className="text-slate-200 truncate">
                        {r.model}{' '}
                        <span className={cn(r.status >= 400 ? 'text-red-300' : 'text-emerald-300')}>
                          {r.status}
                        </span>
                      </div>
                      <div className="text-slate-500">
                        {formatUnixSeconds(r.createdAt)}
                        {r.durationMs ? ` · ${Math.round(r.durationMs)}ms` : ''}
                        {r.tokensIn || r.tokensOut ?
                    ` · ${r.tokensIn ?? 0}→${r.tokensOut ?? 0} tok` :
                    ''}
                      </div>
                      {r.errorMessage ?
                  <div className="text-red-300/80 break-words">{r.errorMessage}</div> :
                  null}
                    </div>
                  </div>
              )}
              </div>
            }
          </div>

          {/* Raw metadata */}
          <details className="group rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <summary className="text-xs text-slate-400 cursor-pointer select-none">{t("aiHub.ai_proxy_account_drawer.advanced")}

            </summary>
            <pre className="mt-2 text-[11px] text-slate-300 overflow-auto max-h-64 whitespace-pre-wrap">
              {JSON.stringify(account, null, 2)}
            </pre>
          </details>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 flex items-center gap-2">
          <ButtonBase
            type="button"
            className="flex-1 h-9 rounded-lg bg-white/5 hover:bg-white/10 text-slate-200 text-sm flex items-center justify-center gap-2"
            onClick={() => onTestConnection(account)}
            disabled={!account.id}>
            
            <PlugZap size={16} />{t("aiHub.ai_proxy_account_drawer.test")}

          </ButtonBase>
          <ButtonBase
            type="button"
            className="flex-1 h-9 rounded-lg bg-white/5 hover:bg-white/10 text-slate-200 text-sm flex items-center justify-center gap-2"
            onClick={() => onEdit(account)}>
            
            <PenSquare size={16} />{t("aiHub.ai_proxy_account_drawer.edit")}

          </ButtonBase>
          <ConfirmActionButton
            type="button"
            size="icon"
            variant="danger"
            className="h-9 px-3 w-auto"
            onConfirm={() => {
              if (account.id) onDelete(account.id);
            }}
            disabled={!account.id}
            aria-label="Delete"
            armedLabel={<Trash2 size={16} />}>

            <Trash2 size={16} />
          </ConfirmActionButton>
        </div>
      </div>
    </>);

}