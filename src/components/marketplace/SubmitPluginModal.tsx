import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, Hash, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { t } from '@/lib/i18n';
import { openFileDialog } from '@/lib/fileDialog';
import { isDesktopApp } from '@/lib/backend/core/url';
import { submitPlugin, previewRelease, type GateReport } from '@/lib/backend/modules/submissions';
import { DomainTagsInput, DOMAIN_RE } from '@/components/marketplace/DomainTagsInput';

type SubmitTab = 'release' | 'upload';

const SHA256_RE = /^[0-9a-fA-F]{64}$/;

interface SubmitPluginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitted: () => void;
}

export function SubmitPluginModal({ isOpen, onClose, onSubmitted }: SubmitPluginModalProps) {
  const [tab, setTab] = useState<SubmitTab>('release');
  const [pluginId, setPluginId] = useState('');
  const [version, setVersion] = useState('');
  const [domains, setDomains] = useState<string[]>([]);
  const [sourceUrl, setSourceUrl] = useState('');
  const [sha256, setSha256] = useState('');
  const [zipPath, setZipPath] = useState('');
  const [zipError, setZipError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fetchingSha, setFetchingSha] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [gateReport, setGateReport] = useState<GateReport | null>(null);

  const desktop = isDesktopApp();

  const reset = useCallback(() => {
    setTab('release');
    setPluginId('');
    setVersion('');
    setDomains([]);
    setSourceUrl('');
    setSha256('');
    setZipPath('');
    setZipError(null);
    setFormError(null);
    setGateReport(null);
  }, []);

  const handleClose = useCallback(() => {
    if (submitting) return;
    reset();
    onClose();
  }, [submitting, reset, onClose]);

  const handlePickZip = useCallback(async () => {
    setZipError(null);
    try {
      const selected = await openFileDialog({
        title: t('marketplace.submit.pickZip'),
        filters: [{ name: 'Zip', extensions: ['zip'] }],
      });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (path) setZipPath(path);
    } catch (err) {
      setZipError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleFetchSha = useCallback(async () => {
    const url = sourceUrl.trim();
    if (!url) {
      setFormError(t('marketplace.submit.requiredRelease'));
      return;
    }
    setFormError(null);
    setFetchingSha(true);
    try {
      const result = await previewRelease(url);
      if (result.success && result.sha256) {
        setSha256(result.sha256);
        const { manifest_id: manifestId, manifest_version: manifestVersion } = result;
        if (manifestId) setPluginId(prev => (prev.trim() ? prev : manifestId));
        if (manifestVersion) setVersion(prev => (prev.trim() ? prev : manifestVersion));
      } else {
        toast.error(t('marketplace.submit.fetchShaFailed'));
      }
    } catch {
      toast.error(t('marketplace.submit.fetchShaFailed'));
    } finally {
      setFetchingSha(false);
    }
  }, [sourceUrl]);

  const handleSubmit = useCallback(async () => {
    setFormError(null);
    setGateReport(null);
    const pid = pluginId.trim();
    const ver = version.trim();
    if (!pid || !ver) {
      setFormError(t('marketplace.submit.requiredFields'));
      return;
    }
    if (tab === 'release') {
      if (!sourceUrl.trim() || !sha256.trim()) {
        setFormError(t('marketplace.submit.requiredRelease'));
        return;
      }
      if (!SHA256_RE.test(sha256.trim())) {
        setFormError(t('marketplace.submit.invalidSha'));
        return;
      }
    } else if (!zipPath) {
      setFormError(t('marketplace.submit.requiredZip'));
      return;
    }
    if (domains.some(d => !DOMAIN_RE.test(d))) {
      setFormError(t('marketplace.submit.domainInvalid'));
      return;
    }

    setSubmitting(true);
    try {
      const result = await submitPlugin({
        source_type: tab,
        plugin_id: pid,
        version: ver,
        declared_domains: domains,
        ...(tab === 'release'
          ? { source_url: sourceUrl.trim(), sha256: sha256.trim() }
          : { zip_path: zipPath }),
      });
      if (result.success) {
        toast.success(
          t('marketplace.submit.success', { id: result.submission_id ?? '—' }),
        );
        reset();
        onClose();
        onSubmitted();
      } else {
        // 5 MB zip cap is enforced by submit_plugin: the picker exposes no file size to JS.
        const errText = result.error ?? '';
        if (tab === 'upload' && /5\s*MB/i.test(errText)) {
          setFormError(t('marketplace.submit.zipTooLarge'));
        } else {
          setFormError(errText || t('marketplace.submit.failed'));
        }
        const gates = result.gate_report?.gates;
        if (gates) setGateReport(gates);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('marketplace.submit.failed'));
    } finally {
      setSubmitting(false);
    }
  }, [pluginId, version, tab, sourceUrl, sha256, zipPath, domains, reset, onClose, onSubmitted]);

  const failedGates = useMemo(
    () => Object.entries(gateReport ?? {}).filter(([, g]) => !g?.pass),
    [gateReport],
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('marketplace.submit.title')}
      icon={<Upload size={18} />}
      size="md"
      isLoading={submitting}
      loadingMessage={t('marketplace.submit.submitting')}
      footer={
        <div className="flex items-center justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={handleClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleSubmit()}
            disabled={submitting}
          >
            {submitting ? t('marketplace.submit.submitting') : t('marketplace.submit.submit')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <SegmentedControl
          options={[
            { label: t('marketplace.submit.tabRelease'), value: 'release' },
            { label: t('marketplace.submit.tabUpload'), value: 'upload' },
          ]}
          value={tab}
          onChange={v => setTab(v as SubmitTab)}
          size="sm"
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t('marketplace.submit.pluginId')}
            value={pluginId}
            onChange={e => setPluginId(e.target.value)}
            placeholder={t('marketplace.submit.pluginIdPh')}
            disabled={submitting}
          />
          <Input
            label={t('marketplace.submit.version')}
            value={version}
            onChange={e => setVersion(e.target.value)}
            placeholder={t('marketplace.submit.versionPh')}
            disabled={submitting}
          />
        </div>

        {tab === 'release' ? (
          <>
            <Input
              label={t('marketplace.submit.releaseUrl')}
              value={sourceUrl}
              onChange={e => setSourceUrl(e.target.value)}
              placeholder={t('marketplace.submit.releaseUrlPh')}
              disabled={submitting}
            />
            <Input
              label={t('marketplace.submit.sha256')}
              value={sha256}
              onChange={e => setSha256(e.target.value)}
              placeholder={t('marketplace.submit.sha256Ph')}
              disabled={submitting}
              className="font-mono"
              rightElement={
                <Button
                  variant="secondary"
                  size="xs"
                  leftIcon={<Hash size={12} />}
                  isLoading={fetchingSha}
                  disabled={submitting}
                  onClick={() => void handleFetchSha()}
                >
                  {fetchingSha
                    ? t('marketplace.submit.fetchingSha')
                    : t('marketplace.submit.fetchSha')}
                </Button>
              }
            />
          </>
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-400">
              {t('marketplace.submit.zip')}
            </span>
            <div className="flex items-center gap-2">
              <Input
                value={zipPath}
                readOnly
                placeholder={desktop ? '' : t('marketplace.submit.zipDesktopOnly')}
                containerClassName="flex-1"
                className="font-mono text-xs"
                disabled={submitting}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handlePickZip()}
                disabled={submitting || !desktop}
              >
                {t('marketplace.submit.pickZip')}
              </Button>
            </div>
            {!desktop && (
              <p className="text-xs text-amber-300/80">
                {t('marketplace.submit.zipDesktopOnly')}
              </p>
            )}
            {zipError && <p className="text-xs text-red-300">{zipError}</p>}
          </div>
        )}

        <div className="flex flex-col w-full">
          <label
            htmlFor="submit-plugin-domains"
            className="text-xs font-semibold text-slate-300 px-0.5 leading-4 mb-1.5"
          >
            {t('marketplace.submit.domains')}
          </label>
          <DomainTagsInput
            id="submit-plugin-domains"
            value={domains}
            onChange={setDomains}
            placeholder={t('marketplace.submit.domainsPlaceholder')}
            disabled={submitting}
          />
          <p className="text-xs text-slate-400 px-0.5 mt-0.5">
            {t('marketplace.submit.domainsHint')}
          </p>
        </div>

        {formError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-300 leading-relaxed break-words">{formError}</p>
          </div>
        )}

        {failedGates.length > 0 && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5">
            <p className="text-xs font-semibold text-red-300 mb-1.5">
              {t('marketplace.submit.gateFailures')}
            </p>
            <ul className="space-y-1">
              {failedGates.map(([name, gate]) => (
                <li key={name} className="text-xs text-red-300/90 leading-relaxed">
                  {/* eslint-disable-next-line i18next/no-literal-string -- non-translatable backend token */}
                  <span className="font-mono text-red-400">{name}</span>: {gate?.detail}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
