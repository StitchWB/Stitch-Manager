import { useEffect, useMemo, useState } from 'react';
import { listen } from '@/lib/events';
import { Modal, Button, ProgressBar } from '@/components/ui';
import { t } from '@/lib/i18n';
import {
  startPythonJob,
  cancelPythonJob,
  type PythonJobStartResponse } from
'@/lib/backend/modules/pythonJobs';
import type { ObsEvent } from '@/lib/observability/types';

type BrowserRuntimeInstallModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function BrowserRuntimeInstallModal({ isOpen, onClose }: BrowserRuntimeInstallModalProps) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'starting' | 'installing' | 'done' | 'error'>(
    'idle'
  );
  const [browsersPath, setBrowsersPath] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<
    'idle' | 'starting' | 'downloading' | 'extracting' | 'done' | 'error'>(
    'idle');
  const [approxProgress, setApproxProgress] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [installed, setInstalled] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    // reset state on open
    queueMicrotask(() => {
      setJobId(null);
      setStatus('idle');
      setBrowsersPath(null);
      setLogs([]);
      setError(null);
      setStage('idle');
      setApproxProgress(null);
      setElapsedMs(0);
      setInstalled(null);
    });
  }, [isOpen]);

  // On open: run a quick check job to show whether runtime exists.
  useEffect(() => {
    if (!isOpen) return;
    let disposed = false;
    const run = async () => {
      try {
        const checkJob = await startPythonJob({
          scriptPath: 'python/check_browser_runtime.py',
          args: [],
          timeoutMs: 30_000
        });

        const unlisten = await listen<ObsEvent>('obs:event', (event) => {
          if (disposed) return;
          const payload = event.payload;
          if (!payload) return;
          if (payload.source !== 'python') return;
          if (payload.subsystem !== 'python_runner') return;
          if (payload.name !== 'python.protocol') return;
          if (payload.jobId !== checkJob.jobId) return;

          const fields = payload.fields ?? {};
          const runnerType = String(fields.runnerType ?? '');
          const msg = String(payload.message ?? '');
          const data = fields.data;
          if (
          runnerType === 'event' &&
          msg === 'browser.runtime.check' &&
          data &&
          typeof data === 'object' &&
          !Array.isArray(data))
          {
            const recordData = data as Record<string, unknown>;
            if (typeof recordData.installed === 'boolean') {
              setInstalled(recordData.installed);
            }
            if (typeof recordData.browsersPath === 'string') {
              setBrowsersPath(recordData.browsersPath);
            }
          }
        });

        // auto cleanup
        setTimeout(() => {
          if (!disposed) unlisten();
        }, 35_000);
      } catch {

        // ignore
      }};
    void run();
    return () => {
      disposed = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || status !== 'installing') return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - started);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isOpen, status]);

  useEffect(() => {
    if (!isOpen || !jobId) return;

    let disposed = false;
    const unlistenPromise = listen<ObsEvent>('obs:event', (event) => {
      if (disposed) return;
      const payload = event.payload;
      if (!payload) return;
      if (payload.source !== 'python') return;
      if (payload.subsystem !== 'python_runner') return;
      if (payload.name !== 'python.protocol' && payload.name !== 'python.stderr') return;
      if (payload.jobId !== jobId) return;

      const fields = payload.fields ?? {};
      const runnerType = String(fields.runnerType ?? '');
      const msg = String(payload.message ?? '');
      const data = fields.data;

      if (runnerType === 'event') {
        if (msg === 'browser.runtime.install.location' && data && typeof data === 'object' && !Array.isArray(data)) {
          const recordData = data as Record<string, unknown>;
          if (typeof recordData.browsersPath === 'string') setBrowsersPath(recordData.browsersPath);
        }
        if (msg === 'browser.runtime.install.started') setStatus('installing');
        if (msg === 'browser.runtime.install.finished') setStatus('done');
        if (msg === 'browser.runtime.install.failed') setStatus('error');
        if (msg === 'browser.runtime.install.started') setStage('starting');
        if (msg === 'browser.runtime.install.finished') setStage('done');
        if (msg === 'browser.runtime.install.failed') setStage('error');
        if (msg === 'browser.runtime.install.skipped') {
          setStatus('done');
          setStage('done');
        }

        if (msg === 'browser.runtime.install.heartbeat' && data && typeof data === 'object' && !Array.isArray(data)) {
          const recordData = data as Record<string, unknown>;
          const sec =
          typeof recordData.secondsSinceLastOutput === 'number' ?
          recordData.secondsSinceLastOutput :
          null;
          if (sec !== null) {
            setLogs((prev) => [`[heartbeat] no output for ${sec}s`, ...prev].slice(0, 200));
          }
        }
      }

      if (runnerType === 'log') {
        setLogs((prev) => [String(payload.message ?? msg), ...prev].slice(0, 200));

        const text = String(payload.message ?? msg).toLowerCase();
        if (text.includes('downloading')) setStage('downloading');
        if (text.includes('extracting')) setStage('extracting');

        // Optional: try to infer bytes progress if present
        // Patterns vary; keep this best-effort and avoid lying.
        const m = text.match(/(\d+(?:\.\d+)?)\s*(kb|mb|gb)\s*\/\s*(\d+(?:\.\d+)?)\s*(kb|mb|gb)/i);
        if (m) {
          const toBytes = (n: number, unit: string) => {
            const u = unit.toLowerCase();
            if (u === 'kb') return n * 1024;
            if (u === 'mb') return n * 1024 * 1024;
            if (u === 'gb') return n * 1024 * 1024 * 1024;
            return n;
          };
          const cur = toBytes(parseFloat(m[1] ?? '0'), m[2] ?? '');
          const tot = toBytes(parseFloat(m[3] ?? '0'), m[4] ?? '');
          if (tot > 0) setApproxProgress(Math.max(0, Math.min(100, cur / tot * 100)));
        }
      }

      if (runnerType === 'result') {
        const ok = Boolean(fields.ok);
        if (!ok) {
          setStatus('error');
          setStage('error');
          const err = fields.error as Record<string, unknown> | undefined;
          setError(String(err?.message ?? 'Install failed'));
        } else {
          setStatus('done');
          setStage('done');
        }
      }

      if (payload.name === 'python.stderr') {
        const line = String(payload.message ?? '').trim();
        if (line.length > 0) {
          setLogs((prev) => [`[stderr] ${line}`, ...prev].slice(0, 200));
        }
      }
    });

    return () => {
      disposed = true;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [isOpen, jobId]);

  const canStart = useMemo(() => status === 'idle' || status === 'error', [status]);

  const startInstall = async () => {
    setStatus('starting');
    setError(null);
    setStage('starting');
    setApproxProgress(null);
    let job: PythonJobStartResponse;
    try {
      job = await startPythonJob({
        scriptPath: 'python/install_browser_runtime.py',
        args: [],
        timeoutMs: 3_600_000
      });
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
      return;
    }

    setJobId(job.jobId);
    setStatus('installing');
  };

  const cancelInstall = async () => {
    if (!jobId) return;
    try {
      await cancelPythonJob(jobId);
      setStatus('error');
      setStage('error');
      setError('Installation cancelled');
    } catch (e) {
      setStatus('error');
      setStage('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('common.installRuntime') || 'Install browser runtime'}
      size="lg">

      <div className="space-y-3">
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-400">{t("recorder.browser_runtime_install_modal.stage")}</div>
            <div className="text-xs text-slate-200">{stage}</div>
          </div>
          <div className="mt-2">
            <ProgressBar
              value={approxProgress ?? (stage === 'done' ? 100 : stage === 'idle' ? 0 : 50)}
              max={100}
              showLabel={approxProgress !== null || stage === 'done'}
              size="sm"
              variant={stage === 'error' ? 'danger' : stage === 'done' ? 'success' : 'default'}
              label={approxProgress !== null ? 'Download progress (approx.)' : 'Progress'} />

            {approxProgress === null &&
            stage !== 'idle' &&
            stage !== 'done' &&
            stage !== 'error' &&
            <div className="mt-1 text-[11px] text-slate-500">{t("recorder.browser_runtime_install_modal.downloading_exact_progress_not_available")}

            </div>
            }
            {status === 'installing' &&
            <div className="mt-1 text-[11px] text-slate-500">{t("recorder.browser_runtime_install_modal.elapsed")}
              {t('recorder.browser_runtime_install_modal.elapsedSeconds', { seconds: Math.floor(elapsedMs / 1000) })}
              </div>
            }
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-400">{t("recorder.browser_runtime_install_modal.status")}</div>
            <div className="text-xs text-slate-200">{status}</div>
          </div>
          {installed !== null &&
          <div className="mt-2 text-xs">
              <div className="text-slate-400">{t("recorder.browser_runtime_install_modal.runtime")}</div>
              <div className={installed ? 'text-emerald-300' : 'text-amber-300'}>
                {installed ? 'Installed' : 'Not installed'}
              </div>
            </div>
          }
          {browsersPath &&
          <div className="mt-2 text-xs">
              <div className="text-slate-400">{t("recorder.browser_runtime_install_modal.install_path")}</div>
              <div className="text-slate-200 font-mono break-all">{browsersPath}</div>
            </div>
          }
          {error && <div className="mt-2 text-xs text-red-300">{error}</div>}
        </div>

        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="text-xs text-slate-400 mb-2">{t("recorder.browser_runtime_install_modal.logs")}</div>
          <div className="max-h-56 overflow-auto space-y-1">
            {logs.length === 0 ?
            <div className="text-xs text-slate-500">{t("recorder.browser_runtime_install_modal.no_logs_yet")}</div> :

            logs.map((line, idx) =>
            <div
              key={`${idx}-${line.slice(0, 12)}`}
              className="text-[11px] text-slate-200 font-mono">

                  {line}
                </div>
            )
            }
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button
            variant="danger"
            onClick={() => void cancelInstall()}
            disabled={status !== 'installing'}>

            {t('common.cancel')}
          </Button>
          <Button onClick={() => void startInstall()} disabled={!canStart}>
            {t('common.install') || 'Install'}
          </Button>
        </div>
      </div>
    </Modal>);

}