import { startPythonAutoregJob } from '../../../../lib/backend';
import { createCorrelationId } from '@/lib/observability/client';
import { DEFAULT_IMAP_PORT } from '../../../../constants/registration';
import type { PythonAutoregResult, PythonAutoregConfig } from '../../../../types/generated';
import type { ProviderJobParams } from './types';
import { REGISTRATION_TIMEOUT_MS, waitForJobResult } from './recovery';

// Default: Kiro/AWS (Python autoreg)
export async function runPythonProviderJob(params: ProviderJobParams): Promise<PythonAutoregResult> {
  const {
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
  const provider = params.provider;
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
            : 'static',
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
    targetGroupId: launchContext?.targetGroupId ?? null,
    addyioEnabled: config.imap.addyioEnabled ?? null,
    addyioApiToken: config.imap.addyioApiToken ?? null,
    addyioDomain: config.imap.addyioDomain ?? null,
    addyioAliasFormat: config.imap.addyioAliasFormat ?? null,
    addyioAutoDelete: config.imap.addyioAutoDelete ?? null,
    thirtyThreeMailEnabled: config.imap.thirtyThreeMailEnabled ?? null,
    thirtyThreeMailUsername: config.imap.thirtyThreeMailUsername ?? null,
    thirtyThreeMailDomain: config.imap.thirtyThreeMailDomain ?? null,
    mailtmEnabled: config.imap.mailtmEnabled ?? null,
    inboxProvider: config.imap.mailtmEnabled ? 'mail_tm' : 'imap',
    inboxMailbox: 'INBOX',
    inboxMailtmAddress: config.imap.mailtmEnabled ? imapUser : null,
    inboxMailtmPassword: config.imap.mailtmEnabled ? imapPassword : null,
    inboxMailtmBaseUrl: null,
    correlationId: createCorrelationId(),
  } as PythonAutoregConfig & {
    launchProfileAlias?: string | null;
    launchMode?: string | null;
    awsBootstrapAccountId?: number | null;
    targetGroupId?: string | null;
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
