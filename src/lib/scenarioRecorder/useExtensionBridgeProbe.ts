import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { startPythonJob, getPythonJobStatus } from '@/lib/tauri/modules/pythonJobs';

export type ExtensionBridgeProbeState = {
  checking: boolean;
  connected: boolean | null;
  error: string | null;
  lastCheckedAt: number | null;
  latencyMs: number | null;
};

type UseExtensionBridgeProbeOptions = {
  isOpen: boolean;
  runnerMode: 'native' | 'extension';
};

const POLL_MS = 35_000;

export function useExtensionBridgeProbe({ isOpen, runnerMode }: UseExtensionBridgeProbeOptions) {
  const [state, setState] = useState<ExtensionBridgeProbeState>({
    checking: false,
    connected: null,
    error: null,
    lastCheckedAt: null,
    latencyMs: null,
  });
  const activeCheckRef = useRef(false);

  const runProbe = useCallback(async () => {
    if (activeCheckRef.current) return;
    activeCheckRef.current = true;
    setState(prev => ({ ...prev, checking: true, error: null }));
    const startedAt = Date.now();
    try {
      const started = await startPythonJob({
        scriptPath: 'python/probe_extension_bridge.py',
        args: ['--timeout-ms', '2200', '--port', '18733'],
        timeoutMs: 8000,
        correlationId: `ext_bridge_probe_${Date.now()}`,
      });

      const deadline = Date.now() + 7000;
      let finalStatus: Awaited<ReturnType<typeof getPythonJobStatus>> = null;
      while (Date.now() < deadline) {
        const status = await getPythonJobStatus(started.jobId);
        if (!status) break;
        if (status.state === 'running' || status.state === 'queued') {
          await new Promise(resolve => setTimeout(resolve, 140));
          continue;
        }
        finalStatus = status;
        break;
      }

      const payload = finalStatus?.resultPayload as
        | { ok?: boolean; error?: { message?: string }; data?: { latencyMs?: number } }
        | undefined;
      const ok = Boolean(payload?.ok) && finalStatus?.state === 'succeeded';
      const latencyMs =
        typeof payload?.data?.latencyMs === 'number'
          ? Math.max(0, Math.round(payload.data.latencyMs))
          : Math.max(0, Date.now() - startedAt);
      const errorMessage =
        payload?.error?.message ||
        finalStatus?.error ||
        (ok ? null : 'Extension bridge probe failed');

      setState({
        checking: false,
        connected: ok,
        error: ok ? null : errorMessage,
        lastCheckedAt: Date.now(),
        latencyMs,
      });
    } catch (e) {
      setState({
        checking: false,
        connected: false,
        error: e instanceof Error ? e.message : String(e),
        lastCheckedAt: Date.now(),
        latencyMs: null,
      });
    } finally {
      activeCheckRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!isOpen || runnerMode !== 'extension') return;
    void runProbe();
    const id = window.setInterval(() => {
      void runProbe();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [isOpen, runProbe, runnerMode]);

  useEffect(() => {
    if (!isOpen || runnerMode !== 'extension') {
      setState({
        checking: false,
        connected: null,
        error: null,
        lastCheckedAt: null,
        latencyMs: null,
      });
    }
  }, [isOpen, runnerMode]);

  const statusText = useMemo(() => {
    if (runnerMode !== 'extension') return '';
    if (state.checking && state.connected == null) return 'Bridge: checking…';
    if (state.connected === true) return 'Bridge: connected';
    if (state.connected === false) return 'Bridge: disconnected';
    return 'Bridge: unknown';
  }, [runnerMode, state.checking, state.connected]);

  return {
    state,
    statusText,
    refresh: runProbe,
  };
}
