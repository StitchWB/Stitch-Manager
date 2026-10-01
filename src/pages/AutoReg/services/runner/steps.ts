import { startRegistrationV2 } from '../../../../lib/backend';
import type { RegistrationConfig } from '../../../../stores/registration/types';
import type { LogLevel, ProviderJobParams, ProviderJobResult } from './types';
import { REGISTRATION_TIMEOUT_MS, withTimeout } from './recovery';
import {
  runWindsurfJob,
  runTraeJob,
  runGithubJob,
  runBitbucketJob,
  runKiroV2Job,
} from './providerJobs';
import {
  runOpenAIJob,
  runFireworksJob,
  runQoderJob,
  runV0AppJob,
} from './normalizedProviderJobs';
import { runPythonProviderJob } from './pythonProviderJob';

/**
 * Get IMAP credentials based on strategy
 */
export function getIMAPCredentials(config: RegistrationConfig): {
  imapServer: string;
  imapUser: string;
  imapPassword: string;
} {
  const imapServer = config.imap.strategy === 'gmail' ? 'imap.gmail.com' : config.imap.server;

  // For Gmail, ensure gmailBase has @gmail.com suffix
  let imapUser = config.imap.strategy === 'gmail' ? config.imap.gmailBase : config.imap.email;
  if (config.imap.strategy === 'gmail' && imapUser && !imapUser.includes('@')) {
    imapUser = `${imapUser}@gmail.com`;
  }

  const imapPassword =
    config.imap.strategy === 'gmail'
      ? config.imap.gmailAppPassword
      : config.imap.password || '********';

  return { imapServer, imapUser, imapPassword };
}

/**
 * Run Registration V2 (Rust-based flow)
 */
export async function runRegistrationV2(
  index: number,
  totalCount: number,
  onLog: (level: LogLevel, message: string) => void
): Promise<{ success: boolean; email?: string; error?: string }> {
  onLog('info', `[${index + 1}/${totalCount}] Using Registration V2 (Rust-based flow)...`);

  try {
    const result = await withTimeout(
      startRegistrationV2({
        email: null,
        name: null,
        password: null,
      }),
      REGISTRATION_TIMEOUT_MS,
      `Registration timed out after ${REGISTRATION_TIMEOUT_MS / 60000} minutes`
    );

    return result;
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}

/**
 * Run provider-specific registration
 */
export async function runProviderRegistration(
  params: ProviderJobParams
): Promise<ProviderJobResult> {
  const { provider } = params;

  if (provider === 'windsurf') {
    return runWindsurfJob(params);
  }

  if (provider === 'trae') {
    return runTraeJob(params);
  }

  if (provider === 'github') {
    return runGithubJob(params);
  }

  if (provider === 'openai') {
    return runOpenAIJob(params);
  }

  if (provider === 'fireworks') {
    return runFireworksJob(params);
  }

  if (provider === 'qoder') {
    return runQoderJob(params);
  }

  if (provider === 'kiro_v2') {
    return runKiroV2Job(params);
  }

  if (provider === 'v0_app') {
    return runV0AppJob(params);
  }

  if (provider === 'bitbucket') {
    return runBitbucketJob(params);
  }

  return runPythonProviderJob(params);
}
