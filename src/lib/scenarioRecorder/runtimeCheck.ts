import { getPythonJobStatus, startPythonJob } from '@/lib/tauri/modules/pythonJobs';

export interface BrowserRuntimeCheckResult {
  installed: boolean | null;
  browsersPath: string | null;
  error: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function checkBrowserRuntimeOnce(): Promise<BrowserRuntimeCheckResult> {
  try {
    const started = await startPythonJob({
      scriptPath: 'python/check_browser_runtime.py',
      args: [],
      timeoutMs: 30_000,
    });

    for (let i = 0; i < 120; i += 1) {
      const st = await getPythonJobStatus(started.jobId);
      if (
        st &&
        (st.state === 'succeeded' ||
          st.state === 'failed' ||
          st.state === 'cancelled' ||
          st.state === 'timedout')
      ) {
        if (st.state !== 'succeeded') {
          return {
            installed: null,
            browsersPath: null,
            error: st.error ?? `Runtime check failed (${st.state})`,
          };
        }

        const payload = (st.resultPayload as Record<string, unknown> | null) ?? null;
        const data = (payload?.data as Record<string, unknown> | undefined) ?? undefined;
        const installed = typeof data?.installed === 'boolean' ? data.installed : null;
        const browsersPath = typeof data?.browsersPath === 'string' ? data.browsersPath : null;

        return {
          installed,
          browsersPath,
          error: null,
        };
      }

      await sleep(250);
    }

    return {
      installed: null,
      browsersPath: null,
      error: 'Runtime check timed out',
    };
  } catch (e) {
    return {
      installed: null,
      browsersPath: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
