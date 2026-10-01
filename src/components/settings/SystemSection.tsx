import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Store } from 'lucide-react';
import { toast } from 'sonner';
import { Toggle } from '@/components/ui';
import { getDatabasePath, getSettings } from '@/lib/backend';
import { t } from '@/lib/i18n';
import { useAuthStore, effectiveRole } from '@/stores/auth';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import type { SettingsData } from '@/types/generated';
import { IDEPathsSection } from './IDEPathsSection';
import { DatabaseSection } from './DatabaseSection';
import { TelemetrySection } from './TelemetrySection';
import { saveSettingsSlice, useDebouncedSave } from './shared';

export function SystemSection() {
  const { copy } = useCopyToClipboard();

  const authEnabled = useAuthStore(state => state.enabled);
  const authUser = useAuthStore(state => state.user);
  const enforceLogin = useAuthStore(state => state.enforceLogin);
  const setLoginPolicy = useAuthStore(state => state.setLoginPolicy);
  const [enforceLoginDraft, setEnforceLoginDraft] = useState(enforceLogin);
  const [policyBusy, setPolicyBusy] = useState(false);
  // Adjust the draft during render (not in an effect) to avoid cascading renders (react-hooks/set-state-in-effect).
  const [prevEnforceLogin, setPrevEnforceLogin] = useState(enforceLogin);
  if (enforceLogin !== prevEnforceLogin) {
    setPrevEnforceLogin(enforceLogin);
    setEnforceLoginDraft(enforceLogin);
  }

  const [customIdePaths, setCustomIdePaths] = useState<Record<string, string>>({});
  const [dbPath, setDbPath] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = (await getSettings()) as unknown as SettingsData;
        if (!cancelled) setCustomIdePaths(data.customIdePaths || {});
      } catch (error) {
        console.error('Failed to load settings:', error);
        toast.error(t('settings.loadFailed'), { description: String(error) });
      }
      try {
        const path = await getDatabasePath();
        if (!cancelled) setDbPath(path);
      } catch (e) {
        console.error('Failed to get database path:', e);
        if (!cancelled) setDbPath('./stitch.db'); // Fallback
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveIdePaths = useCallback(async () => {
    await saveSettingsSlice({ customIdePaths }, 'Failed to save settings');
  }, [customIdePaths]);
  const debouncedSave = useDebouncedSave(saveIdePaths);

  return (
    <>
      <IDEPathsSection
        customIdePaths={customIdePaths}
        onCustomIdePathsChange={paths => {
          setCustomIdePaths(paths);
          debouncedSave();
        }}
      />
      <DatabaseSection dbPath={dbPath} onCopy={copy} />
      <TelemetrySection />
      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center shrink-0">
            <Store className="w-4 h-4 text-indigo-300" />
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-medium text-slate-200">
              {t('marketplace.title')}
            </h4>
            <p className="text-xs text-slate-500">
              {t('marketplace.subtitle')}
            </p>
          </div>
        </div>
        <Link
          to="/marketplace"
          className="text-xs font-medium text-indigo-300 hover:text-indigo-200 transition-colors shrink-0"
        >
          {t('marketplace.title')} →
        </Link>
      </div>
      {/* Admin previewing a non-admin role loses this toggle until the preview exits. */}
      {authEnabled && effectiveRole(authUser) === 'admin' && (
        <div
          className="rounded-lg border border-white/10 bg-white/[0.02] p-4 flex items-center justify-between gap-3"
          data-testid="auth-policy-toggle-row"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center shrink-0">
              <Lock className="w-4 h-4 text-indigo-300" />
            </div>
            <div className="min-w-0">
              <h4 className="text-sm font-medium text-slate-200">
                {t('settings.authPolicy.title')}
              </h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                {t('settings.authPolicy.description')}
              </p>
            </div>
          </div>
          <Toggle
            label=""
            checked={enforceLoginDraft}
            disabled={policyBusy}
            onChange={async v => {
              const prev = enforceLoginDraft;
              setEnforceLoginDraft(v);
              setPolicyBusy(true);
              try {
                await setLoginPolicy(v);
                toast.success(t('settings.authPolicy.updated'));
              } catch {
                // Revert the toggle on error.
                setEnforceLoginDraft(prev);
                toast.error(t('settings.authPolicy.updateFailed'));
              } finally {
                setPolicyBusy(false);
              }
            }}
          />
        </div>
      )}
    </>
  );
}
