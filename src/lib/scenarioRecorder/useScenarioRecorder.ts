import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  startPythonJob,
  cancelPythonJob,
  type PythonJobStartResponse,
} from '@/lib/tauri/modules/pythonJobs';
import type { ObsEvent } from '@/lib/observability/types';
import type { ScenarioRecordStatus } from './types';

type ScenarioRecorderOptions = {
  alias: string;
  url: string;
  scenarioName: string;
  proxy?: string | null;
  configJson?: string | null;
};

type ScenarioRecorderState = {
  status: ScenarioRecordStatus;
  jobId: string | null;
  correlationId: string;
  stepCount: number;
  lastEvent: string | null;
  scenarioPath: string | null;
  sessionDir: string | null;
  error: string | null;
  events: Array<{ ts: string; message: string; data?: unknown }>;
};

function newCorrelationId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return String(Date.now());
  }
}

export function useScenarioRecorder() {
  const [state, setState] = useState<ScenarioRecorderState>(() => ({
    status: 'idle',
    jobId: null,
    correlationId: newCorrelationId(),
    stepCount: 0,
    lastEvent: null,
    scenarioPath: null,
    sessionDir: null,
    error: null,
    events: [],
  }));

  const optionsRef = useRef<ScenarioRecorderOptions | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const reset = useCallback(() => {
    setState(prev => ({
      ...prev,
      status: 'idle',
      jobId: null,
      correlationId: newCorrelationId(),
      stepCount: 0,
      lastEvent: null,
      scenarioPath: null,
      sessionDir: null,
      error: null,
      events: [],
    }));
  }, []);

  const start = useCallback(async (opts: ScenarioRecorderOptions) => {
    if (!opts.alias || !opts.url || !opts.scenarioName) {
      setState(prev => ({ ...prev, status: 'error', error: 'Missing alias/url/scenarioName' }));
      return;
    }

    optionsRef.current = opts;
    const correlationId = newCorrelationId();
    setState(prev => ({
      ...prev,
      status: 'starting',
      correlationId,
      jobId: null,
      stepCount: 0,
      lastEvent: null,
      scenarioPath: null,
      sessionDir: null,
      error: null,
      events: [],
    }));

    let job: PythonJobStartResponse;
    try {
      const args: string[] = [
        '--alias',
        opts.alias,
        '--url',
        opts.url,
        '--scenario-name',
        opts.scenarioName,
      ];
      if (opts.proxy && opts.proxy.trim()) {
        args.push('--proxy', opts.proxy.trim());
      }
      if (opts.configJson && opts.configJson.trim()) {
        args.push('--config-json', opts.configJson.trim());
      }

      job = await startPythonJob({
        scriptPath: 'python/run_scenario_record.py',
        args,
        correlationId,
        timeoutMs: 3_600_000,
      });
    } catch (e) {
      setState(prev => ({
        ...prev,
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      }));
      return;
    }

    setState(prev => ({ ...prev, jobId: job.jobId, status: 'recording' }));
  }, []);

  const stop = useCallback(async () => {
    const jobId = state.jobId;
    if (!jobId) return;
    setState(prev => ({ ...prev, status: 'stopping' }));
    try {
      await cancelPythonJob(jobId);
    } catch (e) {
      setState(prev => ({
        ...prev,
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  }, [state.jobId]);

  // Subscribe to obs:event and filter to this jobId/correlationId
  useEffect(() => {
    const jobId = state.jobId;
    const correlationId = state.correlationId;
    if (!jobId) return;

    let disposed = false;

    const setup = async () => {
      const unlisten = await listen<ObsEvent>('obs:event', event => {
        if (disposed) return;
        const payload = event.payload;
        if (!payload) return;
        if (payload.source !== 'python') return;
        if (payload.jobId !== jobId && payload.correlationId !== correlationId) return;
        if (payload.subsystem !== 'python_runner') return;
        if (payload.name !== 'python.protocol') return;

        const fields = payload.fields ?? {};
        const runnerType = String((fields as any).runnerType ?? '');
        const msg = String(payload.message ?? '');
        const data = (fields as any).data;

        // Record UI events list
        setState(prev => {
          const nextEvents = [{ ts: payload.ts, message: msg, data }, ...prev.events].slice(0, 50);

          // Our python protocol emits message as event-name for type=event
          let stepCount = prev.stepCount;
          let scenarioPath = prev.scenarioPath;
          let sessionDir = prev.sessionDir;
          let lastEvent = prev.lastEvent;
          let status: ScenarioRecordStatus = prev.status;

          if (runnerType === 'event') {
            lastEvent = msg;
            if (msg === 'scenario.record.step') {
              stepCount = prev.stepCount + 1;
            }
            if (msg === 'scenario.record.location' && data && typeof data === 'object') {
              const anyData = data as any;
              if (typeof anyData.scenarioPath === 'string') scenarioPath = anyData.scenarioPath;
              if (typeof anyData.sessionDir === 'string') sessionDir = anyData.sessionDir;
            }
            if (msg === 'scenario.record.saved' && data && typeof data === 'object') {
              const anyData = data as any;
              if (typeof anyData.path === 'string') scenarioPath = anyData.path;
              status = 'done';
            }
          }

          if (runnerType === 'result') {
            // A result line means the job finished by itself.
            const ok = Boolean((fields as any).ok);
            status = ok ? 'done' : 'error';
          }

          return {
            ...prev,
            events: nextEvents,
            stepCount,
            scenarioPath,
            sessionDir,
            lastEvent,
            status,
          };
        });
      });

      unlistenRef.current = unlisten;
    };

    void setup();
    return () => {
      disposed = true;
      const fn = unlistenRef.current;
      unlistenRef.current = null;
      fn?.();
    };
  }, [state.jobId, state.correlationId]);

  const debugConfig = useMemo(() => {
    const opts = optionsRef.current;
    return {
      jobId: state.jobId,
      correlationId: state.correlationId,
      alias: opts?.alias,
      url: opts?.url,
      scenarioName: opts?.scenarioName,
      proxy: opts?.proxy,
      configJson: opts?.configJson,
    };
  }, [state.jobId, state.correlationId]);

  return {
    state,
    start,
    stop,
    reset,
    debugConfig,
  };
}
