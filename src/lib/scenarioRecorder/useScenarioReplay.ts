import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  startPythonJob,
  cancelPythonJob,
  sendPythonJobControl,
  type PythonJobStartResponse,
} from '@/lib/tauri/modules/pythonJobs';
import type { ObsEvent } from '@/lib/observability/types';

type ScenarioReplayOptions = {
  alias: string;
  scenarioPath: string;
  startUrl?: string | null;
  proxy?: string | null;
  configJson?: string | null;
  continueOnError?: boolean;
  headless?: boolean;
};

export type ScenarioReplayStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'manual_pause'
  | 'stopping'
  | 'done'
  | 'error';

type StepEvent = {
  ts: string;
  index: number;
  total: number;
  kind: string;
  status: 'start' | 'done' | 'fail';
  selector?: string | null;
  url?: string | null;
  error?: string | null;
};

type ReplayState = {
  status: ScenarioReplayStatus;
  jobId: string | null;
  correlationId: string;
  currentStep: number;
  totalSteps: number;
  lastEvent: string | null;
  error: string | null;
  reportPath: string | null;
  commandFilePath: string | null;
  artifactsDir: string | null;
  tracePath: string | null;
  events: Array<{ ts: string; message: string; data?: unknown }>;
  stepEvents: StepEvent[];
  manualPauseReason: string | null;
};

function newCorrelationId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return String(Date.now());
  }
}

export function useScenarioReplay() {
  const [state, setState] = useState<ReplayState>(() => ({
    status: 'idle',
    jobId: null,
    correlationId: newCorrelationId(),
    currentStep: 0,
    totalSteps: 0,
    lastEvent: null,
    error: null,
    reportPath: null,
    commandFilePath: null,
    artifactsDir: null,
    tracePath: null,
    events: [],
    stepEvents: [],
    manualPauseReason: null,
  }));

  const optionsRef = useRef<ScenarioReplayOptions | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const reset = useCallback(() => {
    setState(prev => ({
      ...prev,
      status: 'idle',
      jobId: null,
      correlationId: newCorrelationId(),
      currentStep: 0,
      totalSteps: 0,
      lastEvent: null,
      error: null,
      reportPath: null,
      commandFilePath: null,
      artifactsDir: null,
      tracePath: null,
      events: [],
      stepEvents: [],
      manualPauseReason: null,
    }));
  }, []);

  const start = useCallback(async (opts: ScenarioReplayOptions) => {
    if (!opts.alias || !opts.scenarioPath) {
      setState(prev => ({ ...prev, status: 'error', error: 'Missing alias/scenarioPath' }));
      return;
    }

    optionsRef.current = opts;
    const correlationId = newCorrelationId();
    setState(prev => ({
      ...prev,
      status: 'starting',
      correlationId,
      jobId: null,
      currentStep: 0,
      totalSteps: 0,
      lastEvent: null,
      error: null,
      reportPath: null,
      commandFilePath: null,
      artifactsDir: null,
      tracePath: null,
      events: [],
      stepEvents: [],
      manualPauseReason: null,
    }));

    let job: PythonJobStartResponse;
    try {
      const args: string[] = ['--alias', opts.alias, '--scenario-path', opts.scenarioPath];
      if (opts.startUrl && opts.startUrl.trim()) {
        args.push('--start-url', opts.startUrl.trim());
      }
      if (opts.proxy && opts.proxy.trim()) {
        args.push('--proxy', opts.proxy.trim());
      }
      if (opts.configJson && opts.configJson.trim()) {
        args.push('--config-json', opts.configJson.trim());
      }
      if (opts.continueOnError) {
        args.push('--continue-on-error');
      }
      if (opts.headless) {
        args.push('--headless');
      }

      job = await startPythonJob({
        scriptPath: 'python/run_scenario_replay.py',
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

    setState(prev => ({ ...prev, status: 'running', jobId: job.jobId }));
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

  const sendControl = useCallback(
    async (command: 'resume' | 'continue' | 'abort' | 'cancel' | 'stop', payload?: unknown) => {
      const commandFilePath = state.commandFilePath;
      if (!commandFilePath) {
        throw new Error('No commandFilePath available yet');
      }
      await sendPythonJobControl({
        commandFilePath,
        command,
        payload,
      });
    },
    [state.commandFilePath]
  );

  // Subscribe to obs:event and filter by jobId/correlationId
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
        if (payload.subsystem !== 'python_runner') return;
        if (payload.name !== 'python.protocol') return;
        if (payload.jobId !== jobId && payload.correlationId !== correlationId) return;

        const fields = payload.fields ?? {};
        const runnerType = String((fields as any).runnerType ?? '');
        const msg = String(payload.message ?? '');
        const data = (fields as any).data;

        setState(prev => {
          const nextEvents = [{ ts: payload.ts, message: msg, data }, ...prev.events].slice(0, 80);
          let status = prev.status;
          let currentStep = prev.currentStep;
          let totalSteps = prev.totalSteps;
          let lastEvent = msg;
          let reportPath = prev.reportPath;
          let commandFilePath = prev.commandFilePath;
          let artifactsDir = prev.artifactsDir;
          let tracePath = prev.tracePath;
          let manualPauseReason = prev.manualPauseReason;
          let stepEvents = prev.stepEvents;

          const d = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;

          if (runnerType === 'event') {
            if (msg === 'scenario.replay.location' && d) {
              if (typeof d.reportPath === 'string') reportPath = d.reportPath;
              if (typeof d.commandFilePath === 'string') commandFilePath = d.commandFilePath;
              if (typeof d.artifactsDir === 'string') artifactsDir = d.artifactsDir;
              if (typeof d.tracePath === 'string') tracePath = d.tracePath;
            }

            if (msg === 'scenario.replay.step.start' && d) {
              const index = typeof d.index === 'number' ? d.index : prev.currentStep;
              const total = typeof d.total === 'number' ? d.total : prev.totalSteps;
              currentStep = index;
              totalSteps = total;
              const entry: StepEvent = {
                ts: payload.ts,
                index,
                total,
                kind: String(d.kind ?? 'unknown'),
                status: 'start',
                selector: typeof d.selector === 'string' ? d.selector : null,
                url: typeof d.url === 'string' ? d.url : null,
              };
              stepEvents = [entry, ...prev.stepEvents].slice(0, 120);
            }

            if (msg === 'scenario.replay.step.done' && d) {
              const index = typeof d.index === 'number' ? d.index : prev.currentStep;
              const total = typeof d.total === 'number' ? d.total : prev.totalSteps;
              currentStep = index;
              totalSteps = total;
              const entry: StepEvent = {
                ts: payload.ts,
                index,
                total,
                kind: String(d.kind ?? 'unknown'),
                status: 'done',
                selector: typeof d.selector === 'string' ? d.selector : null,
                url: typeof d.url === 'string' ? d.url : null,
              };
              stepEvents = [entry, ...prev.stepEvents].slice(0, 120);
            }

            if (msg === 'scenario.replay.step.fail' && d) {
              const index = typeof d.index === 'number' ? d.index : prev.currentStep;
              const total = typeof d.total === 'number' ? d.total : prev.totalSteps;
              currentStep = index;
              totalSteps = total;
              const entry: StepEvent = {
                ts: payload.ts,
                index,
                total,
                kind: String(d.kind ?? 'unknown'),
                status: 'fail',
                selector: typeof d.selector === 'string' ? d.selector : null,
                url: typeof d.url === 'string' ? d.url : null,
                error: typeof d.error === 'string' ? d.error : null,
              };
              stepEvents = [entry, ...prev.stepEvents].slice(0, 120);
            }

            if (msg === 'scenario.replay.manual.pause' && d) {
              status = 'manual_pause';
              manualPauseReason = typeof d.reason === 'string' ? d.reason : 'manual';
            }
            if (msg === 'scenario.replay.manual.resume') {
              status = 'running';
              manualPauseReason = null;
            }
            if (msg === 'scenario.replay.saved' && d) {
              if (typeof d.reportPath === 'string') reportPath = d.reportPath;
            }
            if (msg === 'scenario.replay.finished') {
              status = 'done';
            }
          }

          if (runnerType === 'result') {
            const ok = Boolean((fields as any).ok);
            status = ok ? 'done' : 'error';
          }

          return {
            ...prev,
            events: nextEvents,
            status,
            currentStep,
            totalSteps,
            lastEvent,
            reportPath,
            commandFilePath,
            artifactsDir,
            tracePath,
            manualPauseReason,
            stepEvents,
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
      scenarioPath: opts?.scenarioPath,
      startUrl: opts?.startUrl,
      proxy: opts?.proxy,
    };
  }, [state.jobId, state.correlationId]);

  return {
    state,
    start,
    stop,
    reset,
    sendControl,
    debugConfig,
  };
}
