/**
 * Registration Runner Service
 * Handles registration execution logic, progress tracking, and error handling
 */

import {
  startWindsurfAutoregJob,
  startPythonAutoregJob,
  getPythonAutoregJobStatus,
  cancelPythonJob,
  startTraeAutoregJob,
  startGithubAutoregJob,
  startOpenAIAutoregJob,
  startRegistrationV2,
  listAccounts,
  stopRegistration,
} from '../../../lib/tauri';
import { createCorrelationId } from '@/lib/observability/client';
import { generateEmail } from './emailGenerator';
import { DEFAULT_IMAP_PORT } from '../../../constants/registration';
import type { ProviderName } from '../../../types';
import type { RegistrationConfig } from '../../../stores/registration/types';
import type {
  PythonAutoregResult,
  PythonAutoregConfig,
  WindsurfAutoregResult,
  TraeAutoregResult,
  GithubAutoregResult,
} from '../../../types/generated';
import type { OpenAIAutoregResult } from '../../../types';
import { validateAliasConfiguration, type PythonAliasStrategy } from './aliasValidation';

// Timeout for each registration attempt (5 minutes)
const REGISTRATION_TIMEOUT_MS = 5 * 60 * 1000;

export type LogLevel = 'info' | 'error' | 'success' | 'warn' | 'debug';
export type RegistrationStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface RegistrationOptions {
  config: RegistrationConfig;
  emailDomain: string;
  useRegistrationV2: boolean;
  launchContext?: {
    source?: 'profile';
    profileAlias?: string;
    targetProvider?: string;
    awsBootstrapAccountId?: number;
    launchMode?: string;
  };
  onLog: (level: LogLevel, message: string) => void;
  onHistoryEntry: (entry: {
    provider: ProviderName;
    email: string;
    status: RegistrationStatus;
  }) => void;
  onCancelled: () => boolean; // Returns true if cancelled
}

export interface RegistrationSummary {
  successCount: number;
  skipCount: number;
  failCount: number;
}

let activePythonJobId: string | null = null;

export async function cancelActiveRegistrationJob(): Promise<void> {
  if (!activePythonJobId) return;
  const jobId = activePythonJobId;
  activePythonJobId = null;
  await cancelPythonJob(jobId).catch(() => undefined);
}

/**
 * Run registration for multiple accounts
 */
export async function runRegistration(options: RegistrationOptions): Promise<RegistrationSummary> {
  const { config, emailDomain, useRegistrationV2, onLog, onHistoryEntry, onCancelled } = options;

  const totalCount = config.count || 1;
  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;

  // Determine IMAP credentials based on strategy (once, outside loop)
  const { imapServer, imapUser, imapPassword } = getIMAPCredentials(config);

  // Debug log IMAP config (without password)
  onLog(
    'debug',
    `IMAP config: server=${imapServer}, user=${imapUser}, password=${imapPassword ? '***set***' : '***empty***'}`
  );

  try {
    // Loop for multiple account registration
    for (let i = 0; i < totalCount; i++) {
      // Check if cancelled
      if (onCancelled()) {
        onLog('warn', `Registration cancelled by user at account ${i + 1}/${totalCount}`);
        break;
      }

      try {
        // Use Registration V2 for AWS/Kiro if enabled
        if (useRegistrationV2 && config.provider === 'aws') {
          const result = await runRegistrationV2(i, totalCount, onLog);
          if (result.success && result.email) {
            successCount++;
            onLog('success', `[${i + 1}/${totalCount}] Account created: ${result.email}`);
            onHistoryEntry({
              provider: config.provider,
              email: result.email,
              status: 'completed',
            });
          } else {
            failCount++;
            onLog(
              'error',
              `[${i + 1}/${totalCount}] Registration failed: ${result.error || 'Unknown error'}`
            );
          }

          // Delay between registrations
          if (i < totalCount - 1) {
            await delay(config.advanced.delayBetweenAccounts * 1000);
          }
          continue;
        }

        // Generate email
        const emailResult = await generateEmail({
          provider: config.provider,
          imapConfig: config.imap,
          emailPattern: config.patterns.emailPattern,
          emailDomain,
        });

        const { email, strategy, shouldGenerateInPython } = emailResult;

        if (shouldGenerateInPython) {
          const aliasValidationError = validateAliasConfiguration(strategy, config);
          if (aliasValidationError) {
            failCount++;
            onLog('error', `[${i + 1}/${totalCount}] ${aliasValidationError}`);
            continue;
          }
        }

        const profileLaunchMode = options.launchContext?.source === 'profile';

        if (profileLaunchMode) {
          onLog(
            'info',
            `[${i + 1}/${totalCount}] Using standalone profile: ${options.launchContext?.profileAlias}`
          );
        }

        if (shouldGenerateInPython) {
          const serviceName =
            strategy === 'addyio' ? 'addy.io' : strategy === '33mail' ? '33mail' : 'Mail.tm';
          onLog('info', `[${i + 1}/${totalCount}] Using ${serviceName} for email generation...`);
        }

        // Check if account already exists (skip if email will be generated by Python)
        if (email && !profileLaunchMode) {
          const existingAccounts = await listAccounts({ provider: config.provider });
          const accountExists = existingAccounts.some(
            acc => acc.email.toLowerCase() === email.toLowerCase()
          );

          if (accountExists) {
            skipCount++;
            onLog(
              'warn',
              `[${i + 1}/${totalCount}] Account ${email} already exists in database, skipping`
            );
            continue;
          }
        }

        onLog(
          'info',
          `[${i + 1}/${totalCount}] Registering ${email || '(email will be generated)'}...`
        );

        // Run provider-specific registration
        const result = await runProviderRegistration({
          provider: config.provider,
          email,
          aliasStrategy: shouldGenerateInPython ? strategy : null,
          config,
          imapServer,
          imapUser,
          imapPassword,
          onCancelled,
          onLog,
          launchContext: options.launchContext,
        });

        // Process result
        const processResult = await processRegistrationResult({
          result,
          provider: config.provider,
          index: i,
          totalCount,
          onLog,
          onHistoryEntry,
        });

        if (processResult === 'success') {
          successCount++;
        } else if (processResult === 'skip') {
          skipCount++;
        } else {
          failCount++;
        }

        // Delay between registrations
        if (i < totalCount - 1) {
          onLog(
            'debug',
            `Waiting ${config.advanced.delayBetweenAccounts}s before next registration...`
          );
          await delay(config.advanced.delayBetweenAccounts * 1000);
        }
      } catch (error) {
        const errorMsg = String(error);

        if (onCancelled() || /cancelled/i.test(errorMsg)) {
          onLog('warn', `[${i + 1}/${totalCount}] Registration cancelled`);
          break;
        }

        failCount++;

        if (errorMsg.includes('timed out')) {
          onLog(
            'error',
            `[${i + 1}/${totalCount}] ${errorMsg} - attempting to stop process and continue...`
          );
          // Try to stop the hung process
          try {
            await cancelActiveRegistrationJob();
            await stopRegistration();
          } catch {
            // Ignore stop errors
          }
        } else {
          onLog('error', `[${i + 1}/${totalCount}] Error: ${errorMsg}`);
        }
      }

      // Log progress after each iteration
      onLog(
        'debug',
        `Completed ${i + 1}/${totalCount} registrations (success: ${successCount}, skip: ${skipCount}, fail: ${failCount})`
      );
    }
  } catch (error) {
    onLog('error', `Fatal error: ${String(error)}`);
    throw error;
  }

  return { successCount, skipCount, failCount };
}

/**
 * Get IMAP credentials based on strategy
 */
function getIMAPCredentials(config: RegistrationConfig): {
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
async function runRegistrationV2(
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
async function runProviderRegistration(params: {
  provider: ProviderName;
  email: string | null;
  aliasStrategy: PythonAliasStrategy | null;
  config: RegistrationConfig;
  imapServer: string;
  imapUser: string;
  imapPassword: string;
  onCancelled: () => boolean;
  onLog: (level: LogLevel, message: string) => void;
  launchContext?: RegistrationOptions['launchContext'];
}): Promise<
  | PythonAutoregResult
  | WindsurfAutoregResult
  | TraeAutoregResult
  | GithubAutoregResult
  | OpenAIAutoregResult
> {
  const {
    provider,
    email,
    aliasStrategy,
    config,
    imapServer,
    imapUser,
    imapPassword,
    onCancelled,
    onLog,
    launchContext,
  } = params;

  if (provider === 'windsurf') {
    const correlationId = createCorrelationId();
    const startResponse = await startWindsurfAutoregJob({
      email,
      password: null,
      name: null,
      headless: false,
      loginOnly: false,
      proxyUrl: config.proxy.enabled ? config.proxy.url : null,
      imapServer,
      imapPort: config.imap.port || DEFAULT_IMAP_PORT,
      imapUser,
      imapPassword,
      emailPattern: config.patterns.emailPattern,
      namePattern: config.patterns.namePattern,
      nameCustomFirst: config.patterns.nameCustomFirst,
      nameCustomLast: config.patterns.nameCustomLast,
      addyioEnabled: config.imap.addyioEnabled ?? null,
      addyioApiToken: config.imap.addyioApiToken ?? null,
      addyioDomain: config.imap.addyioDomain ?? null,
      addyioAliasFormat: config.imap.addyioAliasFormat ?? null,
      addyioAutoDelete: config.imap.addyioAutoDelete ?? null,
      thirtyThreeMailEnabled: config.imap.thirtyThreeMailEnabled ?? null,
      thirtyThreeMailUsername: config.imap.thirtyThreeMailUsername ?? null,
      thirtyThreeMailDomain: config.imap.thirtyThreeMailDomain ?? null,
      mailtmEnabled: config.imap.mailtmEnabled ?? null,
      correlationId,
    });
    return await waitForJobResult<WindsurfAutoregResult>(
      startResponse.jobId,
      REGISTRATION_TIMEOUT_MS,
      onCancelled,
      onLog,
      {
        success: false,
        email,
        password: null,
        name: null,
        apiKey: null,
        installationId: null,
        error: 'Windsurf job failed',
      }
    );
  }

  if (provider === 'trae') {
    const correlationId = createCorrelationId();
    const startResponse = await startTraeAutoregJob({
      email,
      password: null,
      name: null,
      headless: config.advanced.headless,
      proxyUrl: config.proxy.enabled ? config.proxy.url : null,
      imapServer,
      imapPort: config.imap.port || DEFAULT_IMAP_PORT,
      imapUser,
      imapPassword,
      addyioEnabled: config.imap.addyioEnabled ?? null,
      addyioApiToken: config.imap.addyioApiToken ?? null,
      addyioDomain: config.imap.addyioDomain ?? null,
      addyioAliasFormat: config.imap.addyioAliasFormat ?? null,
      addyioAutoDelete: config.imap.addyioAutoDelete ?? null,
      thirtyThreeMailEnabled: config.imap.thirtyThreeMailEnabled ?? null,
      thirtyThreeMailUsername: config.imap.thirtyThreeMailUsername ?? null,
      thirtyThreeMailDomain: config.imap.thirtyThreeMailDomain ?? null,
      mailtmEnabled: config.imap.mailtmEnabled ?? null,
      correlationId,
    });
    return await waitForJobResult<TraeAutoregResult>(
      startResponse.jobId,
      REGISTRATION_TIMEOUT_MS,
      onCancelled,
      onLog,
      {
        success: false,
        email,
        password: null,
        name: null,
        error: 'Trae job failed',
      }
    );
  }

  if (provider === 'github') {
    const correlationId = createCorrelationId();
    const githubPassword = `Gh${Math.random().toString(36).substring(2, 10)}!1`;
    const startResponse = await startGithubAutoregJob({
      email,
      password: githubPassword,
      username: null,
      verificationCode: null,
      headless: config.advanced.headless,
      imapServer,
      imapUser,
      imapPassword,
      correlationId,
    });
    return await waitForJobResult<GithubAutoregResult>(
      startResponse.jobId,
      REGISTRATION_TIMEOUT_MS,
      onCancelled,
      onLog,
      {
        success: false,
        email,
        username: null,
        password: null,
        error: 'GitHub job failed',
        requiresVerification: null,
        verificationUrl: null,
      }
    );
  }

  if (provider === 'openai') {
    const normalizedImapServer = imapServer?.trim() ? imapServer : null;
    const normalizedImapUser = imapUser?.trim() ? imapUser : null;
    const normalizedImapPassword =
      imapPassword?.trim() && imapPassword !== '********' ? imapPassword : null;

    const startResponse = await startOpenAIAutoregJob({
      email,
      password: null,
      name: null,
      headless: config.advanced.headless,
      proxyUrl: config.proxy.enabled ? config.proxy.url : null,
      imapServer: normalizedImapServer,
      imapPort: normalizedImapServer ? config.imap.port || DEFAULT_IMAP_PORT : null,
      imapUser: normalizedImapUser,
      imapPassword: normalizedImapPassword,
      addyioEnabled: config.imap.addyioEnabled ?? null,
      addyioApiToken: config.imap.addyioApiToken ?? null,
      addyioDomain: config.imap.addyioDomain ?? null,
      addyioAliasFormat: config.imap.addyioAliasFormat ?? null,
      addyioAutoDelete: config.imap.addyioAutoDelete ?? null,
      mailtmEnabled: config.imap.mailtmEnabled ?? null,
      thirtyThreeMailEnabled: config.imap.thirtyThreeMailEnabled ?? null,
      thirtyThreeMailUsername: config.imap.thirtyThreeMailUsername ?? null,
      thirtyThreeMailDomain: config.imap.thirtyThreeMailDomain ?? null,
      emailStrategy: config.imap.mailtmEnabled
        ? 'mailtm'
        : config.imap.addyioEnabled
          ? 'addyio'
          : config.imap.thirtyThreeMailEnabled
            ? '33mail'
            : null,
      baseEmail: config.imap.email || imapUser || null,
    });
    return await waitForJobResult<OpenAIAutoregResult>(
      startResponse.jobId,
      REGISTRATION_TIMEOUT_MS,
      onCancelled,
      onLog,
      {
        success: false,
        email,
        password: null,
        name: null,
        error: 'OpenAI job failed',
      }
    );
  }

  // Default: Kiro/AWS (Python autoreg)
  const pythonConfig = {
    email,
    name: null,
    password: null,
    headless: config.advanced.headless,
    deviceFlow: false,
    autoGenerate: false,
    imapServer,
    imapPort: config.imap.port || DEFAULT_IMAP_PORT,
    imapUser,
    imapPassword,
    emailStrategy:
      aliasStrategy === 'mailtm'
        ? 'mailtm'
        : aliasStrategy === 'addyio'
          ? 'addyio'
          : aliasStrategy === '33mail'
            ? '33mail'
            : null,
    proxyUrl: config.proxy.enabled ? config.proxy.url : null,
    speedMultiplier: config.advanced.speedMultiplier,
    verificationCodeTimeout: config.advanced.verificationCodeTimeout,
    oauthCallbackTimeout: config.advanced.oauthCallbackTimeout,
    allowAccessWait: config.advanced.allowAccessWait,
    pageLoadTimeout: config.advanced.pageLoadTimeout,
    elementWaitTimeout: config.advanced.elementWaitTimeout,
    imapPollInterval: config.advanced.imapPollInterval,
    passwordLength: config.advanced.passwordLength,
    realisticTyping: config.advanced.realisticTyping,
    humanDelays: config.advanced.humanDelays,
    screenshotsOnError: config.advanced.screenshotsOnError,
    launchProfileAlias: launchContext?.profileAlias ?? null,
    launchMode:
      launchContext?.launchMode ??
      (launchContext?.source === 'profile' && provider === 'kiro'
        ? 'kiro_oauth_only_existing_session'
        : null),
    awsBootstrapAccountId: launchContext?.awsBootstrapAccountId ?? null,
    addyioEnabled: config.imap.addyioEnabled ?? null,
    addyioApiToken: config.imap.addyioApiToken ?? null,
    addyioDomain: config.imap.addyioDomain ?? null,
    addyioAliasFormat: config.imap.addyioAliasFormat ?? null,
    addyioAutoDelete: config.imap.addyioAutoDelete ?? null,
    thirtyThreeMailEnabled: config.imap.thirtyThreeMailEnabled ?? null,
    thirtyThreeMailUsername: config.imap.thirtyThreeMailUsername ?? null,
    thirtyThreeMailDomain: config.imap.thirtyThreeMailDomain ?? null,
    mailtmEnabled: config.imap.mailtmEnabled ?? null,
    correlationId: createCorrelationId(),
  } as PythonAutoregConfig & {
    launchProfileAlias?: string | null;
    launchMode?: string | null;
    awsBootstrapAccountId?: number | null;
  };

  const startResponse = await startPythonAutoregJob(pythonConfig);
  return await waitForJobResult<PythonAutoregResult>(
    startResponse.jobId,
    REGISTRATION_TIMEOUT_MS,
    onCancelled,
    onLog,
    {
      success: false,
      email,
      password: null,
      tokenFile: null,
      token: null,
      refreshToken: null,
      error: 'Python job failed',
      name: null,
      oauthOnly: null,
    }
  );
}

type JobPayload<T> = {
  ok?: boolean;
  message?: string | null;
  data?: T;
  error?: { message?: string } | null;
};

async function waitForJobResult<T extends { success: boolean; error?: string | null }>(
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
        await cancelPythonJob(jobId).catch(() => undefined);
        throw new Error('Registration cancelled by user');
      }

      const status = await getPythonAutoregJobStatus(jobId);
      if (!status) {
        throw new Error('Python job status not found');
      }

      if (status.state === 'queued' || status.state === 'running') {
        await delay(800);
        continue;
      }

      if (status.state === 'cancelled') {
        throw new Error('Registration cancelled by user');
      }

      if (status.state === 'timedout') {
        throw new Error(`Registration timed out after ${timeoutMs / 60000} minutes`);
      }

      const payload = (status.resultPayload as JobPayload<T> | undefined) ?? undefined;
      if (payload?.data) {
        return payload.data;
      }

      if (status.state === 'succeeded') {
        onLog('warn', 'Python job finished without structured result payload');
        return {
          ...fallbackResult,
          success: false,
          error: 'Missing structured result payload from python job',
        };
      }

      return {
        ...fallbackResult,
        success: false,
        error:
          status.error ||
          payload?.error?.message ||
          payload?.message ||
          fallbackResult.error ||
          'Python job failed',
      };
    }

    await cancelPythonJob(jobId).catch(() => undefined);
    throw new Error(`Registration timed out after ${timeoutMs / 60000} minutes`);
  } finally {
    if (activePythonJobId === jobId) {
      activePythonJobId = null;
    }
  }
}

/**
 * Process registration result and save to database
 */
async function processRegistrationResult(params: {
  result: any;
  provider: ProviderName;
  index: number;
  totalCount: number;
  onLog: (level: LogLevel, message: string) => void;
  onHistoryEntry: (entry: {
    provider: ProviderName;
    email: string;
    status: RegistrationStatus;
  }) => void;
}): Promise<'success' | 'skip' | 'fail'> {
  const { result, provider, index, totalCount, onLog, onHistoryEntry } = params;

  // Account persistence is backend-owned (Rust commands emit ACCOUNT_ADDED).
  // Frontend runner only interprets success/failure and records history.
  const hasRequiredData = result?.success && result?.email;
  const windsurfApiKey = provider === 'windsurf' ? (result.apiKey ?? result.api_key) : null;

  if (hasRequiredData) {
    onLog('success', `[${index + 1}/${totalCount}] Registration succeeded: ${result.email}`);
    onHistoryEntry({
      provider,
      email: result.email as string,
      status: 'completed',
    });
    return 'success';
  } else {
    // Registration failed
    const keys = result && typeof result === 'object' ? Object.keys(result).sort() : [];
    const json = (() => {
      try {
        return JSON.stringify(result);
      } catch {
        return null;
      }
    })();
    const jsonShort = json && json.length > 900 ? `${json.slice(0, 900)}...` : json;

    onLog(
      'error',
      `[${index + 1}/${totalCount}] Registration failed: ${result.error || 'Unknown error'}`
    );
    onLog(
      'error',
      `[${index + 1}/${totalCount}] Debug: provider=${provider}, success=${String(
        result?.success
      )}, email=${String(result?.email)}, error=${String(result?.error)}, apiKey=${
        windsurfApiKey ? 'present' : 'missing'
      }, keys=${keys.join(',')}`
    );
    if (jsonShort) {
      onLog('error', `[${index + 1}/${totalCount}] Debug JSON: ${jsonShort}`);
    }
    return 'fail';
  }
}

/**
 * Wrap promise with timeout
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(errorMessage)), timeoutMs)),
  ]);
}

/**
 * Delay helper
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
