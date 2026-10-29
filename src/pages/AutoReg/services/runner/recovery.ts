import { stopRegistration, getRegistrationJob } from '../../../../lib/backend';
import type { JobPayload, LogLevel } from './types';

// Timeout for each registration attempt (10 minutes)
export const REGISTRATION_TIMEOUT_MS = 10 * 60 * 1000;

let activePythonJobId: string | null = null;

export function getActivePythonJobId(): string | null {
  return activePythonJobId;
}

export function setActivePythonJobId(jobId: string | null): void {
  activePythonJobId = jobId;
}

export async function cancelActiveRegistrationJob(): Promise<void> {
  if (!activePythonJobId) return;
  const jobId = activePythonJobId;
  activePythonJobId = null;
  // Use stop_registration which routes to the in-process RegistrationService
  await stopRegistration({ jobId }).catch(() => undefined);
}

export async function waitForJobResult<T extends { success: boolean; error?: string | null }>(
  jobId: string,
  timeoutMs: number,
  onCancelled: () => boolean,
  onLog: (level: LogLevel, message: string) => void,
  fallbackResult: T
): Promise<T> {
  activePythonJobId = jobId;
  const deadline = Date.now() + timeoutMs;

  try {
    while (Date.now() < deadline) {
      if (onCancelled()) {
        await stopRegistration({ jobId }).catch(() => undefined);
        throw new Error('Registration cancelled by user');
      }

      // autoreg jobs run in-process: only RegistrationService tracks them, not PythonJobManager
      const job = await getRegistrationJob({ jobId });
      const jobStatus: string = job?.status ?? 'unknown';

      if (jobStatus === 'running' || jobStatus === 'unknown') {
        await delay(800);
        continue;
      }

      if (jobStatus === 'cancelled') {
        throw new Error('Registration cancelled by user');
      }

      // Job is completed or failed — extract result
      const payload = (job as unknown as Record<string, unknown> | undefined)
        ?.resultPayload as JobPayload<T> | undefined;

      if (payload?.data) {
        return payload.data;
      }

      if (jobStatus === 'completed') {
        onLog('warn', 'Job finished without structured result payload');
        return {
          ...fallbackResult,
          success: false,
          error: 'Missing structured result payload from registration job',
        };
      }

      // failed / other terminal state
      return {
        ...fallbackResult,
        success: false,
        error:
          job?.error ||
          payload?.error?.message ||
          payload?.message ||
          fallbackResult.error ||
          'Registration job failed',
      };
    }

    await stopRegistration({ jobId }).catch(() => undefined);
    throw new Error(`Registration timed out after ${timeoutMs / 60000} minutes`);
  } finally {
    if (activePythonJobId === jobId) {
      activePythonJobId = null;
    }
  }
}

/**
 * Wrap promise with timeout
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(errorMessage)), timeoutMs)),
  ]);
}

/**
 * Delay helper
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
