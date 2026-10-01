import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  type PythonJobStatus,
  getPythonJobStatus,
  markComposedFlowRan } from
'@/lib/backend/modules/pythonJobs';
import type { ComposedFlow } from '@/lib/scenarioFlow/types';
import { useComposerRunTrace } from '../composer';

export type JobRunState = {
  jobId: string | null;
  status: 'idle' | 'running' | 'done' | 'error';
  error: string | null;
  lastJobStatus: PythonJobStatus | null;
};

export function useComposedFlowJob({ flow }: { flow: ComposedFlow | null }) {
  const [runState, setRunState] = useState<JobRunState>({
    jobId: null,
    status: 'idle',
    error: null,
    lastJobStatus: null
  });

  const runTrace = useComposerRunTrace(runState.lastJobStatus);

  const currentNodeName = useMemo(() => {
    if (!flow || !runTrace.currentNodeId) return null;
    return flow.nodes.find((node) => node.id === runTrace.currentNodeId)?.name ?? null;
  }, [flow, runTrace.currentNodeId]);

  useEffect(() => {
    const jobId = runState.jobId;
    if (!jobId || runState.status !== 'running') return;

    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        if (cancelled) return;
        const status = await getPythonJobStatus(jobId);
        if (!status) return;

        if (status.state === 'succeeded') {
          setRunState({
            jobId: null,
            status: 'done',
            error: null,
            lastJobStatus: status
          });
          if (flow?.id) {
            void markComposedFlowRan(flow.id).catch(() => {});
          }
          toast.success('Composed flow finished');
          return;
        }

        if (
        status.state === 'failed' ||
        status.state === 'cancelled' ||
        status.state === 'timedout')
        {
          setRunState({
            jobId: null,
            status: 'error',
            error: status.error ?? `Job ${status.state}`,
            lastJobStatus: status
          });
          toast.error(status.error ?? `Composed flow failed: ${status.state}`);
          return;
        }

        setRunState((prev) => ({ ...prev, lastJobStatus: status }));
      })();
    }, 1200);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [flow?.id, runState.jobId, runState.status]);

  return { runState, setRunState, runTrace, currentNodeName };
}
