/**
 * SandboxSection — the per-user developer sandbox panel on the Plugins page.
 *
 * Visible only to an authenticated caller (guests get nothing): a sandbox
 * plugin is owned by the logged-in user and runs in their private scope.
 *
 * Contains an install form (git url + optional ref/sha256 + trust) that calls
 * `sandbox_install`, and the list of the caller's sandbox plugins rendered as
 * `SandboxPluginCard`s. A TOFU pin-mismatch refusal surfaces the backend's
 * error (which names both shas) plus a "force install" retry that re-submits
 * with `force: true`.
 */
import { useCallback, useEffect, useState } from 'react';
import { FlaskConical, Loader2, AlertCircle, RefreshCw, Download } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';
import { useAuthStore } from '@/stores/auth';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Toggle } from '../ui/Toggle';
import {
  sandboxInstall,
  sandboxList,
  shortSha,
  type SandboxPluginInfo,
} from '@/lib/backend/modules/sandboxPlugins';
import { SandboxPluginCard } from './SandboxPluginCard';

export function SandboxSection() {
  const user = useAuthStore(state => state.user);

  const [plugins, setPlugins] = useState<SandboxPluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Install form state.
  const [url, setUrl] = useState('');
  const [ref, setRef] = useState('');
  const [sha256, setSha256] = useState('');
  const [trust, setTrust] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [pinMismatch, setPinMismatch] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await sandboxList();
      setPlugins(list);
    } catch {
      setLoadError(t('admin.plugins.sandbox.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) void refresh();
  }, [user, refresh]);

  const resetForm = useCallback(() => {
    setUrl('');
    setRef('');
    setSha256('');
    setTrust(false);
    setInstallError(null);
    setPinMismatch(false);
  }, []);

  const submitInstall = useCallback(
    async (force: boolean) => {
      const trimmedUrl = url.trim();
      if (!trimmedUrl) {
        setInstallError(t('admin.plugins.sandbox.install.urlRequired'));
        return;
      }
      setInstallError(null);
      setPinMismatch(false);
      setInstalling(true);

      const trimmedRef = ref.trim();
      const trimmedSha = sha256.trim();
      // Keep the install in git mode: sha256 without a ref would be inferred
      // as release mode server-side, which is out of scope here — default the
      // ref to "main" when a checksum is supplied without one.
      const effectiveRef = trimmedRef !== '' ? trimmedRef : trimmedSha !== '' ? 'main' : undefined;

      try {
        const result = await sandboxInstall({
          url: trimmedUrl,
          ref: effectiveRef,
          sha256: trimmedSha !== '' ? trimmedSha : undefined,
          trust,
          force: force || undefined,
        });
        if (result.success) {
          toast.success(
            t('admin.plugins.sandbox.install.success', {
              id: result.plugin_id,
              version: result.version,
              sha: shortSha(result.pinned_sha),
            }),
          );
          resetForm();
          await refresh();
        } else {
          setInstallError(result.error);
          if (result.reason === 'pin_mismatch') setPinMismatch(true);
        }
      } catch (err) {
        setInstallError(err instanceof Error ? err.message : String(err));
      } finally {
        setInstalling(false);
      }
    },
    [url, ref, sha256, trust, resetForm, refresh],
  );

  // Guests (and the not-yet-checked state with no user) see nothing.
  if (!user) return null;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-black/40 backdrop-blur-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
        <FlaskConical className="w-4 h-4 text-indigo-400" />
        <h2 className="text-sm font-semibold text-white">{t('admin.plugins.sandbox.title')}</h2>
        <span className="text-xs text-slate-500">{t('admin.plugins.sandbox.subtitle')}</span>
        <div className="ml-auto">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading}
            leftIcon={<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />}
          >
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      {/* Install form */}
      <div className="px-5 py-4 border-b border-white/[0.04] flex flex-col gap-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input
            label={t('admin.plugins.sandbox.install.url')}
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://github.com/user/plugin"
            disabled={installing}
            containerClassName="md:col-span-2"
          />
          <Input
            label={t('admin.plugins.sandbox.install.ref')}
            value={ref}
            onChange={e => setRef(e.target.value)}
            placeholder="main"
            disabled={installing}
          />
          <Input
            label={t('admin.plugins.sandbox.install.sha256')}
            value={sha256}
            onChange={e => setSha256(e.target.value)}
            placeholder="e3b0c44298fc1c14…"
            disabled={installing}
          />
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Toggle
            label={t('admin.plugins.sandbox.install.trust')}
            checked={trust}
            onChange={setTrust}
            disabled={installing}
            size="sm"
          />
          <div className="flex items-center gap-2">
            {pinMismatch && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => void submitInstall(true)}
                disabled={installing}
              >
                {t('admin.plugins.sandbox.install.forceInstall')}
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={() => void submitInstall(false)}
              disabled={installing}
              leftIcon={installing ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            >
              {t('admin.plugins.sandbox.install.submit')}
            </Button>
          </div>
        </div>
        {installError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span className="text-xs text-red-300 break-all">{installError}</span>
          </div>
        )}
      </div>

      {/* Plugin list */}
      {loadError ? (
        <div className="p-6 text-center">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
          <p className="text-sm text-slate-400">{loadError}</p>
        </div>
      ) : loading ? (
        <div className="p-6 space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-12 rounded bg-white/[0.04] animate-pulse" />
          ))}
        </div>
      ) : plugins.length === 0 ? (
        <div className="p-10 text-center">
          <FlaskConical className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-500">{t('admin.plugins.sandbox.empty')}</p>
          <p className="text-xs text-slate-600 mt-1">{t('admin.plugins.sandbox.emptyDesc')}</p>
        </div>
      ) : (
        <div className="divide-y divide-white/[0.04]">
          {plugins.map(plugin => (
            <SandboxPluginCard key={plugin.id} plugin={plugin} onChanged={() => void refresh()} />
          ))}
        </div>
      )}
    </div>
  );
}
