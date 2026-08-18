import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@/lib/events';
import {
  startPythonJob,
  cancelPythonJob,
  getPythonJobStatus,
  sendPythonJobControl,
  type PythonJobStartResponse,
} from '@/lib/backend/modules/pythonJobs';
import type { ObsEvent } from '@/lib/observability/types';
import type { ScenarioCaptureMode, ScenarioRecordStatus, ScenarioRunnerMode } from './types';
import type { BrowserEngineId } from '@/lib/browser/engines';

type ScenarioRecorderOptions = {
  alias: string;
  url: string;
  scenarioName: string;
  proxy?: string | null;
  configJson?: string | null;
  noOverlay?: boolean;
  runnerMode?: ScenarioRunnerMode;
  engine?: BrowserEngineId;
};

type ScenarioRecorderState = {
  status: ScenarioRecordStatus;
  jobId: string | null;
  correlationId: string;
  stepCount: number;
  /** Native runs only: which engine captures events (extension bridge vs injected script). */
  captureMode: ScenarioCaptureMode | null;
  lastEvent: string | null;
  scenarioPath: string | null;
  sessionDir: string | null;
  commandFilePath: string | null;
  error: string | null;
  events: Array<{ ts: string; message: string; data?: unknown }>;
  runtimeMissing: boolean;
  stderr: Array<{ ts: string; line: string }>;
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
    captureMode: null,
    lastEvent: null,
    scenarioPath: null,
    sessionDir: null,
    commandFilePath: null,
    error: null,
    events: [],
    runtimeMissing: false,
    stderr: [],
  }));

  const stateRef = useRef(state);
  stateRef.current = state;

  const optionsRef = useRef<ScenarioRecorderOptions | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const reset = useCallback(() => {
    setState(prev => ({
      ...prev,
      status: 'idle',
      jobId: null,
      correlationId: newCorrelationId(),
      stepCount: 0,
      captureMode: null,
      lastEvent: null,
      scenarioPath: null,
      sessionDir: null,
      commandFilePath: null,
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
      captureMode: null,
      lastEvent: null,
      scenarioPath: null,
      sessionDir: null,
      commandFilePath: null,
      error: null,
      events: [],
    }));

    let job: PythonJobStartResponse;
    try {
      const runnerMode: ScenarioRunnerMode = opts.runnerMode ?? 'native';
      const args: string[] = [
        '--alias',
        opts.alias,
        '--url',
        opts.url,
        '--scenario-name',
        opts.scenarioName,
      ];

      if (runnerMode === 'native') {
        if (opts.proxy && opts.proxy.trim()) {
          args.push('--proxy', opts.proxy.trim());
        }
        if (opts.configJson && opts.configJson.trim()) {
          args.push('--config-json', opts.configJson.trim());
        }
        if (opts.noOverlay) {
          args.push('--no-overlay');
        }
        if (opts.engine) {
          args.push('--engine', opts.engine);
        }
      }

      job = await startPythonJob({
        scriptPath:
          runnerMode === 'extension'
            ? 'python/run_extension_record.py'
            : 'python/run_scenario_record.py',
        args,
        correlationId,
        timeoutMs: 3_600_000,
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);

      // Backend "Couldn't find callback id" occurs when the frontend reloads
      // or the component unmounts before the Rust side resolves the invoke
      // promise.  The job may actually have started on the Rust side, so
      // rather than treating this as a hard error we move to a transitional
      // state and let the polling effect discover the real job status.
      if (errMsg.includes("Couldn't find callback")) {
        console.warn('[useScenarioRecorder] Backend callback lost during startPythonJob — job may still be running. Polling will recover status.');
        setState(prev => ({
          ...prev,
          // Keep 'starting' so the polling effect continues trying to
          // discover the job.  If the Rust side succeeded, the obs:event
          // listener or the next poll will transition us to 'recording'.
          status: 'starting',
          error: null,
        }));
        return;
      }

      setState(prev => ({
        ...prev,
        status: 'error',
        error: errMsg,
      }));
      return;
    }

    setState(prev => ({
      ...prev,
      jobId: job.jobId,
      status: 'starting',
    }));
  }, []);

  const stop = useCallback(async () => {
    const currentState = stateRef.current;
    const jobId = currentState.jobId;
    if (!jobId) return;
    setState(prev => ({ ...prev, status: 'stopping' }));
    try {
      if (currentState.commandFilePath) {
        await sendPythonJobControl({
          commandFilePath: currentState.commandFilePath,
          command: 'stop',
        });
      } else {
        await cancelPythonJob(jobId);
      }
    } catch (e) {
      setState(prev => ({
        ...prev,
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  }, []);

  // Timeout for 'starting' state: if we're stuck in 'starting' without a
  // jobId for more than 15 seconds, the Backend callback was likely lost and
  // we never received the job ID.  Transition to error so the UI isn't stuck.
  useEffect(() => {
    if (state.status !== 'starting') return;
    if (state.jobId) return; // have jobId — polling effect handles the rest

    const timer = window.setTimeout(() => {
      setState(prev => {
        if (prev.status !== 'starting' || prev.jobId) return prev;
        return {
          ...prev,
          status: 'error' as ScenarioRecordStatus,
          error: 'Failed to start recorder: Backend callback was lost. Try again or restart the app.',
        };
      });
    }, 15_000);

    return () => window.clearTimeout(timer);
  }, [state.status, state.jobId]);

  // Polling fallback: ensures UI sees job failure even if obs stream is silent.
  useEffect(() => {
    const currentJobId = stateRef.current.jobId;
    if (!currentJobId) return;
    const currentStatus = stateRef.current.status;
    if (
      currentStatus !== 'starting' &&
      currentStatus !== 'recording' &&
      currentStatus !== 'stopping'
    ) {
      return;
    }

    let stopped = false;
    const timer = window.setInterval(() => {
      const latestJobId = stateRef.current.jobId;
      if (stopped || !latestJobId) return;
      getPythonJobStatus(latestJobId)
        .then(status => {
          if (stopped || !status) return;
          if (status.state === 'succeeded') {
            setState(prev => ({ ...prev, status: 'done' }));
          }
          if (
            status.state === 'failed' ||
            status.state === 'cancelled' ||
            status.state === 'timedout'
          ) {
            setState(prev => ({
              ...prev,
              status: 'error',
              error: status.error ?? `Job ${status.state}`,
            }));
          }
        })
        .catch(() => {
          // Best effort - ignore polling errors
        });
    }, 1000);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  // Subscribe to obs:event and filter to this jobId/correlationId
  useEffect(() => {
    const jobId = state.jobId;
    const correlationId = state.correlationId;
    if (!jobId) return;

    let disposed = false;

    const setup = async () => {
      const unlisten = await listen<ObsEvent>('obs:event', event => {
        if (disposed) return;
        const current = stateRef.current;
        if (current.jobId !== jobId || current.correlationId !== correlationId) return;
        const payload = event.payload;
        if (!payload) return;
        if (payload.source !== 'python') return;
        if (payload.jobId !== jobId && payload.correlationId !== correlationId) return;
        if (payload.subsystem !== 'python_runner') return;
        if (payload.name !== 'python.protocol') return;

        const fields = payload.fields ?? {};
        const runnerType = String(fields.runnerType ?? '');
        const msg = String(payload.message ?? '');
        const data = fields.data;

        // Record UI events list
        setState(prev => {
          const nextEvents = [{ ts: payload.ts, message: msg, data }, ...prev.events].slice(0, 50);

          // Our python protocol emits message as event-name for type=event
          let stepCount = prev.stepCount;
          let captureMode = prev.captureMode;
          let scenarioPath = prev.scenarioPath;
          let sessionDir = prev.sessionDir;
          let commandFilePath = prev.commandFilePath;
          let lastEvent = prev.lastEvent;
          let status: ScenarioRecordStatus = prev.status;
          let runtimeMissing = prev.runtimeMissing;
          let error = prev.error;

          if (runnerType === 'event') {
            lastEvent = msg;
            if (msg === 'scenario.record.step') {
              stepCount = prev.stepCount + 1;
            }
            if (msg === 'scenario.record.ready') {
              status = 'recording';
            }
            if (msg === 'scenario.record.started') {
              status = 'recording';
            }
            if (msg === 'scenario.record.location' && data && typeof data === 'object' && !Array.isArray(data)) {
              const recordData = data as Record<string, unknown>;
              if (typeof recordData.scenarioPath === 'string') scenarioPath = recordData.scenarioPath;
              if (typeof recordData.sessionDir === 'string') sessionDir = recordData.sessionDir;
              if (typeof recordData.commandFilePath === 'string') {
                commandFilePath = recordData.commandFilePath;
              }
            }
            if (msg === 'scenario.record.saved' && data && typeof data === 'object' && !Array.isArray(data)) {
              const recordData = data as Record<string, unknown>;
              if (typeof recordData.path === 'string') scenarioPath = recordData.path;
              status = 'done';
            }
            if (msg === 'scenario.record.control.stop') {
              status = 'stopping';
            }
            if (msg === 'scenario.record.capture_mode' && data && typeof data === 'object' && !Array.isArray(data)) {
              const recordData = data as Record<string, unknown>;
              captureMode = recordData.mode === 'extension' ? 'extension' : 'injected';
            }
          }

          if (runnerType === 'result') {
            // A result line means the job finished by itself.
            const ok = Boolean(fields.ok);
            status = ok ? 'done' : 'error';

            // Heuristic: if browser runtime is missing, Playwright usually errors with
            // messages suggesting to run "playwright install".
            if (!ok) {
              const fieldErr = fields.error as Record<string, unknown> | undefined;
              const payloadErr = payload.error as Record<string, unknown> | undefined;
              const errMsg = String(
                payloadErr?.message ?? fieldErr?.message ?? payload.message ?? 'Recording failed'
              );
              error = errMsg || 'Recording failed';
              if (errMsg.toLowerCase().includes('playwright install')) {
                runtimeMissing = true;
              }
            }
          }

          return {
            ...prev,
            events: nextEvents,
            stepCount,
            captureMode,
            scenarioPath,
            sessionDir,
            commandFilePath,
            lastEvent,
            status,
            error,
            runtimeMissing,
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

  // Also listen to python.stderr for this jobId.
  useEffect(() => {
    const jobId = state.jobId;
    if (!jobId) return;

    let disposed = false;
    let unlisten: UnlistenFn | null = null;

    const setup = async () => {
      unlisten = await listen<ObsEvent>('obs:event', event => {
        if (disposed) return;
        if (stateRef.current.jobId !== jobId) return;
        const payload = event.payload;
        if (!payload) return;
        if (payload.source !== 'python') return;
        if (payload.subsystem !== 'python_runner') return;
        if (payload.name !== 'python.stderr') return;
        if (payload.jobId !== jobId) return;

        setState(prev => ({
          ...prev,
          stderr: [{ ts: payload.ts, line: payload.message ?? '' }, ...prev.stderr].slice(0, 50),
        }));
      });
    };

    void setup();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [state.jobId]);

  const debugConfig = useMemo(() => {
    const opts = optionsRef.current;
    return {
      jobId: state.jobId,
      correlationId: state.correlationId,
      alias: opts?.alias,
      url: opts?.url,
      scenarioName: opts?.scenarioName,
      runnerMode: opts?.runnerMode ?? 'native',
      captureMode: state.captureMode,
      proxy: opts?.proxy,
      configJson: opts?.configJson,
      commandFilePath: state.commandFilePath,
    };
  }, [state.jobId, state.correlationId, state.commandFilePath, state.captureMode]);

  return {
    state,
    start,
    stop,
    reset,
    debugConfig,
  };
}
