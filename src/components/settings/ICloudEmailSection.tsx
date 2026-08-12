/**
 * iCloud Hide My Email Pool — Settings UI section.
 */

import { useState } from 'react';
import { t } from '@/lib/i18n';
import { Cloud, Eye, EyeOff, RefreshCw, CheckCircle, AlertCircle, Zap } from 'lucide-react';
import {
  Button,
  Checkbox,
  Input,
  LoadingSpinner,
  SectionHeader,
} from '@/components/ui';
import {
  authenticateICloud,
  configureICloud,
  fillICloudPool,
  getICloudPoolStats,
} from '@/lib/backend';
import type { ICloudPoolStats } from '@/types/generated';
import { ButtonBase } from '@/components/ui/ButtonBase';
import { Select } from '@/components/ui/Select';

interface ICloudEmailSectionProps {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  appleId: string;
  onAppleIdChange: (v: string) => void;
  appPassword: string;
  onAppPasswordChange: (v: string) => void;
  onSave: () => void | Promise<void>;
}

export function ICloudEmailSection({
  enabled,
  onEnabledChange,
  appleId,
  onAppleIdChange,
  appPassword,
  onAppPasswordChange,
  onSave,
}: ICloudEmailSectionProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [authStatus, setAuthStatus] = useState<'idle' | 'configuring' | 'authenticating' | 'needs_2fa' | 'ok' | 'error'>('idle');
  const [authMessage, setAuthMessage] = useState('');
  const [twoFaCode, setTwoFaCode] = useState('');
  const [stats, setStats] = useState<ICloudPoolStats | null>(null);
  const [filling, setFilling] = useState(false);
  const [fillCount, setFillCount] = useState(5);

  const isConfigDirty = appleId.trim() !== '' && appPassword.trim() !== '';

  const handleConfigure = async () => {
    if (!appleId || !appPassword) return;
    setAuthStatus('configuring');
    setAuthMessage('');
    try {
      await configureICloud(appleId, appPassword);
      await onSave();
      setAuthStatus('authenticating');
      const result = await authenticateICloud();
      if (result.status === 'ok') {
        setAuthStatus('ok');
        setAuthMessage(t('settings.icloud.authSuccess'));
        await refreshStats();
      } else {
        setAuthStatus('needs_2fa');
        setAuthMessage(result.message ?? t('settings.icloud.twoFaPrompt'));
      }
    } catch (err) {
      setAuthStatus('error');
      setAuthMessage(err instanceof Error ? err.message : 'Configuration failed.');
    }
  };

  const handleVerify2FA = async () => {
    if (!twoFaCode.trim()) return;
    setAuthStatus('authenticating');
    try {
      const result = await authenticateICloud(twoFaCode.trim());
      if (result.status === 'ok') {
        setAuthStatus('ok');
        setAuthMessage(t('settings.icloud.twoFaVerified'));
        setTwoFaCode('');
        await refreshStats();
      } else {
        setAuthStatus('error');
        setAuthMessage(result.message ?? 'Invalid 2FA code.');
      }
    } catch (err) {
      setAuthStatus('error');
      setAuthMessage(err instanceof Error ? err.message : '2FA verification failed.');
    }
  };

  const refreshStats = async () => {
    try {
      const s = await getICloudPoolStats();
      setStats(s);
    } catch {
      // silently ignore stats refresh failure
    }
  };

  const handleFill = async () => {
    setFilling(true);
    try {
      const result = await fillICloudPool({ count: fillCount, labelPrefix: 'Auto-registration' });
      setAuthMessage(t('settings.icloud.generated', { count: result.created }));
      await refreshStats();
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : 'Pool fill failed.');
    } finally {
      setFilling(false);
    }
  };

  return (
    <SectionHeader
      title={t('settings.icloud.title')}
      description={t('settings.icloud.description')}
      icon={<Cloud className="w-4 h-4 text-sky-400" />}
      className="pt-0"
    >
      <div
        className={`glass-card rounded-lg p-4 border border-white/10 space-y-4 transition-opacity duration-200 ${
          !enabled ? 'opacity-60 hover:opacity-100' : ''
        }`}
      >
        <Checkbox
          checked={enabled}
          onChange={e => {
            onEnabledChange(e.target.checked);
          }}
          className="py-0 px-0 hover:bg-transparent"
          label={
            <span className="text-slate-300 text-sm font-medium">
              {t('settings.icloud.enable')}
            </span>
          }
        />

        {enabled && (
          <div className="space-y-4 pl-7 animate-in fade-in zoom-in-95 duration-200">
            <div className="grid grid-cols-2 gap-4">
              <Input
                type="email"
                label={t('settings.icloud.appleId')}
                value={appleId}
                onChange={e => onAppleIdChange(e.target.value)}
                placeholder="you@icloud.com"
              />
              <Input
                type={showPassword ? 'text' : 'password'}
                label={t('settings.icloud.appPassword')}
                value={appPassword}
                onChange={e => onAppPasswordChange(e.target.value)}
                placeholder="xxxx-xxxx-xxxx-xxxx"
                rightElement={
                  <ButtonBase
                    type="button"
                    onClick={() => setShowPassword(p => !p)}
                    className="p-1.5 text-slate-400 hover:text-white"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </ButtonBase>
                }
              />
            </div>

            <p className="text-[10px] text-slate-500 -mt-2">
              {t('settings.icloud.appPasswordHint')}
            </p>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="primary"
                size="sm"
                disabled={!isConfigDirty || authStatus === 'configuring' || authStatus === 'authenticating'}
                onClick={handleConfigure}
                leftIcon={
                  authStatus === 'configuring' || authStatus === 'authenticating' ? (
                    <LoadingSpinner size="xs" />
                  ) : (
                    <CheckCircle className="w-3 h-3" />
                  )
                }
              >
                {authStatus === 'configuring'
                  ? t('settings.icloud.saving')
                  : authStatus === 'authenticating'
                  ? t('settings.icloud.authenticating')
                  : t('settings.icloud.saveAuthenticate')}
              </Button>

              {(authStatus === 'ok' || stats) && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={refreshStats}
                  leftIcon={<RefreshCw className="w-3 h-3" />}
                >
                  {t('settings.icloud.refreshStats')}
                </Button>
              )}
            </div>

            {authMessage && (
              <div
                className={`text-xs flex items-center gap-1.5 ${
                  authStatus === 'ok' ? 'text-emerald-400' : authStatus === 'needs_2fa' ? 'text-amber-400' : 'text-red-400'
                }`}
              >
                {authStatus === 'ok' ? (
                  <CheckCircle className="w-3 h-3 shrink-0" />
                ) : (
                  <AlertCircle className="w-3 h-3 shrink-0" />
                )}
                {authMessage}
              </div>
            )}

            {authStatus === 'needs_2fa' && (
              <div className="flex items-end gap-2">
                <Input
                  type="text"
                  label={t('settings.icloud.twoFaCode')}
                  value={twoFaCode}
                  onChange={e => setTwoFaCode(e.target.value)}
                  placeholder="123456"
                  className="w-36"
                />
                <Button
                  variant="primary"
                  size="sm"
                  disabled={twoFaCode.length < 4}
                  onClick={handleVerify2FA}
                >
                  {t('settings.icloud.verify2fa')}
                </Button>
              </div>
            )}

            {stats && (
              <div className="glass-card rounded-lg p-3 border border-sky-500/20 bg-sky-500/5">
                <h4 className="text-white font-medium text-xs mb-2 flex items-center gap-2">
                  <Zap className="w-3 h-3 text-sky-400" />
                  {t('settings.icloud.poolStatus')}
                </h4>
                <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                  <div className="text-center">
                    <div className="text-emerald-400 font-semibold text-base leading-none">{stats.available}</div>
                    <div className="text-slate-500 mt-0.5">{t('settings.icloud.available')}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-amber-400 font-semibold text-base leading-none">{stats.reserved}</div>
                    <div className="text-slate-500 mt-0.5">{t('settings.icloud.reserved')}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-slate-300 font-semibold text-base leading-none">{stats.used}</div>
                    <div className="text-slate-500 mt-0.5">{t('settings.icloud.used')}</div>
                  </div>
                </div>
                <div className="text-[10px] text-slate-500">
                  {t('settings.icloud.rateLimit', { remaining: stats.rateRemaining })}
                  {stats.rateSecondsUntilSlot > 0 && (
                    <span className="text-amber-400 ml-1">
                      {t('settings.icloud.nextSlot', { minutes: Math.ceil(stats.rateSecondsUntilSlot / 60) })}
                    </span>
                  )}
                </div>
              </div>
            )}

            {authStatus === 'ok' && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">{t('settings.icloud.generate')}</span>
                    <Select
                      value={String(fillCount)}
                      onChange={e => setFillCount(Number(e.target.value))}
                      className="bg-vsc-input border border-vsc-border rounded px-2 py-1 text-xs text-vsc-text focus:outline-none focus:border-vsc-blue"
                    >
                      {[1, 2, 3, 4, 5].map(n => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </Select>
                  <span className="text-xs text-slate-400">{t('settings.icloud.aliases')}</span>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={filling}
                  onClick={handleFill}
                  leftIcon={filling ? <LoadingSpinner size="xs" /> : <Zap className="w-3 h-3" />}
                >
                  {filling ? t('settings.icloud.generating') : t('settings.icloud.fillPool')}
                </Button>
              </div>
            )}

            <p className="text-[10px] text-slate-500">
              {t('settings.icloud.rateLimitNote')}
            </p>
          </div>
        )}
      </div>
    </SectionHeader>
  );
}