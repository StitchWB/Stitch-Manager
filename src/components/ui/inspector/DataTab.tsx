import { useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn, formatDateTime } from '@/lib/utils';
import { t } from '@/lib/i18n';
import type { Account } from '@/types/generated';
import { formatRelativeTime, parseJsonValue } from './helpers';

export function DataTab({ account }: { account: Account }) {
  const registrationMetadata = useMemo(() => parseJsonValue(account.registrationMetadata), [account.registrationMetadata]);
  const patchConfig = useMemo(() => parseJsonValue(account.patchConfig), [account.patchConfig]);
  const providerMetadata = useMemo(() => parseJsonValue(account.providerMetadata), [account.providerMetadata]);

  const hasRegMeta = Object.keys(registrationMetadata).length > 0;
  const hasPatchConfig = Object.keys(patchConfig).length > 0;
  const hasProviderMeta = Object.keys(providerMetadata).length > 0;

  return (
    <>
      {/* Registration info */}
      <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
          {t('accounts.registrationInfo')}
        </h3>
        <div className="divide-y divide-white/[0.04]">
          {account.registrationMethod && (
            <div className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="text-[11px] text-slate-500">{t('accounts.registrationMethod')}</span>
              <span className={cn(
                'px-1.5 py-0.5 rounded text-[10px] font-medium',
                account.registrationMethod === 'auto' && 'bg-indigo-500/20 text-indigo-400',
                account.registrationMethod === 'manual' && 'bg-slate-500/20 text-slate-400',
                account.registrationMethod === 'oauth' && 'bg-emerald-500/20 text-emerald-400',
              )}>
                {account.registrationMethod}
              </span>
            </div>
          )}
          {account.registrationDate && (
            <div className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="text-[11px] text-slate-500">{t('accounts.registeredLabel')}</span>
              <span className="text-xs text-slate-300">{formatDateTime(account.registrationDate)}</span>
            </div>
          )}
          {account.lastLoginAt && (
            <div className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="text-[11px] text-slate-500">{t('accounts.lastLogin')}</span>
              <span className="text-xs text-slate-300">{formatRelativeTime(account.lastLoginAt)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Registration metadata */}
      {hasRegMeta && (
        <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
            {t('accounts.inspector.registrationMetadata')}
          </h3>
          <div className="divide-y divide-white/[0.04]">
            {Object.entries(registrationMetadata).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span className="text-[11px] text-slate-500 truncate">{key}</span>
                <span className="text-xs text-slate-300 truncate max-w-[60%] text-right">
                  {typeof value === 'string' ? value : JSON.stringify(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Patch block */}
      {(account.patchAppliedAt || hasPatchConfig) && (
        <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
            {t('accounts.inspector.patchInfo')}
          </h3>
          <div className="divide-y divide-white/[0.04]">
            {account.patchAppliedAt && (
              <div className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span className="text-[11px] text-slate-500">{t('accounts.inspector.patchAppliedAt')}</span>
                <span className="text-xs text-slate-300">{formatDateTime(account.patchAppliedAt)}</span>
              </div>
            )}
            {hasPatchConfig && (
              <div className="px-3 py-1.5">
                <span className="text-[11px] text-slate-500 block mb-1">{t('accounts.inspector.patchConfig')}</span>
                <pre className="text-[10px] font-mono p-2 bg-black/20 rounded text-slate-400 overflow-auto max-h-32 whitespace-pre-wrap break-all">
                  {JSON.stringify(patchConfig, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Region + provider type/subtype */}
      <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
        <div className="divide-y divide-white/[0.04]">
          {account.accountRegion && (
            <div className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="text-[11px] text-slate-500">{t('accounts.inspector.accountRegion')}</span>
              <span className="text-xs text-slate-300">{account.accountRegion}</span>
            </div>
          )}
          {account.providerType && (
            <div className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="text-[11px] text-slate-500">{t('accounts.inspector.providerType')}</span>
              <span className="text-xs text-slate-300">{account.providerType}</span>
            </div>
          )}
          {account.providerSubtype && (
            <div className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="text-[11px] text-slate-500">{t('accounts.inspector.providerSubtype')}</span>
              <span className="text-xs text-slate-300">{account.providerSubtype}</span>
            </div>
          )}
        </div>
      </div>

      {/* Provider metadata */}
      {hasProviderMeta && (
        <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
            {t('accounts.inspector.providerMetadata')}
          </h3>
          <div className="divide-y divide-white/[0.04]">
            {Object.entries(providerMetadata).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span className="text-[11px] text-slate-500 truncate">{key}</span>
                <span className="text-xs text-slate-300 truncate max-w-[60%] text-right">
                  {typeof value === 'string' ? value : JSON.stringify(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Referral block */}
      {(account.refCode || account.refUsedCount != null || account.refMaxCount != null || account.referredById) && (
        <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
            {t('accounts.inspector.referralBlock')}
          </h3>
          <div className="divide-y divide-white/[0.04]">
            {account.refCode && (
              <div className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span className="text-[11px] text-slate-500">{t('accounts.inspector.refCode')}</span>
                <span className="text-xs text-slate-300 font-mono">{account.refCode}</span>
              </div>
            )}
            {(account.refUsedCount != null || account.refMaxCount != null) && (
              <div className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span className="text-[11px] text-slate-500">{t('accounts.inspector.refUsed')}</span>
                <span className="text-xs text-slate-300 tabular-nums">
                  {account.refUsedCount ?? 0} / {account.refMaxCount ?? '—'}
                </span>
              </div>
            )}
            {account.referredById && (
              <div className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span className="text-[11px] text-slate-500">{t('accounts.inspector.referredBy')}</span>
                <span className="text-xs text-slate-300 font-mono">{account.referredById}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Timestamps */}
      <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
          {t('accounts.inspector.timestamps')}
        </h3>
        <div className="divide-y divide-white/[0.04]">
          <div className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="text-[11px] text-slate-500">{t('accounts.inspector.createdAt')}</span>
              <span className="text-xs text-slate-300">{formatDateTime(account.createdAt)}</span>
            </div>
          {account.updatedAt && (
            <div className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="text-[11px] text-slate-500">{t('accounts.inspector.updatedAt')}</span>
              <span className="text-xs text-slate-300">{formatDateTime(account.updatedAt)}</span>
            </div>
          )}
          {account.lastUsedAt && (
            <div className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="text-[11px] text-slate-500">{t('accounts.inspector.lastUsedAt')}</span>
              <span className="text-xs text-slate-300">{formatDateTime(account.lastUsedAt)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Debug JSON accordion */}
      {account.metadata && (() => {
        try {
          return Object.keys(JSON.parse(account.metadata)).length > 0;
        } catch {
          return false;
        }
      })() && (
        <details className="group">
          <summary className="flex items-center justify-between p-2 cursor-pointer hover:bg-white/5 rounded-lg transition-colors">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">
              {t('accounts.advancedData')}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-500 transition-transform group-open:rotate-180" />
          </summary>
          <pre className="mt-1 p-2 bg-black/20 rounded-lg text-[10px] text-slate-400 overflow-auto max-h-48 font-mono whitespace-pre-wrap break-all">
            {JSON.stringify(account, null, 2)}
          </pre>
        </details>
      )}
    </>
  );
}
