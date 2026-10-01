import {
  startWindsurfAutoregJob,
  startTraeAutoregJob,
  startGithubAutoregJob,
  startBitbucketAutoregJob,
  startKiroV2AutoregJob,
  registrationControl,
} from '../../../../lib/backend';
import { createCorrelationId } from '@/lib/observability/client';
import { DEFAULT_IMAP_PORT } from '../../../../constants/registration';
import type {
  WindsurfAutoregResult,
  TraeAutoregResult,
  GithubAutoregResult,
} from '../../../../types/generated';
import type { BitbucketAutoregResult, KiroV2AutoregResult } from '../../../../types/ui';
import type { ProviderJobParams } from './types';
import { REGISTRATION_TIMEOUT_MS, setActivePythonJobId, waitForJobResult } from './recovery';

export async function runWindsurfJob(params: ProviderJobParams): Promise<WindsurfAutoregResult> {
  const { email, config, imapServer, imapUser, imapPassword, onCancelled, onLog } = params;
  const correlationId = createCorrelationId();
  const inboxBridgeFields = {
    inboxProvider: config.imap.mailtmEnabled ? 'mail_tm' : 'imap',
    inboxMailbox: 'INBOX',
    inboxMailtmAddress: config.imap.mailtmEnabled ? imapUser : null,
    inboxMailtmPassword: config.imap.mailtmEnabled ? imapPassword : null,
    inboxMailtmBaseUrl: null,
  };
  const startResponse = await startWindsurfAutoregJob({
    email,
    password: null,
    name: null,
    headless: config.advanced.headless,
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
    ...inboxBridgeFields,
  });
  setActivePythonJobId(startResponse.jobId);
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

export async function runTraeJob(params: ProviderJobParams): Promise<TraeAutoregResult> {
  const { email, config, imapServer, imapUser, imapPassword, onCancelled, onLog } = params;
  const correlationId = createCorrelationId();
  const inboxBridgeFields = {
    inboxProvider: config.imap.mailtmEnabled ? 'mail_tm' : 'imap',
    inboxMailbox: 'INBOX',
    inboxMailtmAddress: config.imap.mailtmEnabled ? imapUser : null,
    inboxMailtmPassword: config.imap.mailtmEnabled ? imapPassword : null,
    inboxMailtmBaseUrl: null,
  };
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
    ...inboxBridgeFields,
  });
  setActivePythonJobId(startResponse.jobId);
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

export async function runGithubJob(params: ProviderJobParams): Promise<GithubAutoregResult> {
  const { email, config, imapServer, imapUser, imapPassword, onCancelled, onLog } = params;
  const correlationId = createCorrelationId();
  const githubPassword = `Gh${Math.random().toString(36).substring(2, 10)}!1`;
  const inboxBridgeFields = {
    inboxProvider: config.imap.mailtmEnabled ? 'mail_tm' : 'imap',
    inboxMailbox: 'INBOX',
    inboxMailtmAddress: config.imap.mailtmEnabled ? imapUser : null,
    inboxMailtmPassword: config.imap.mailtmEnabled ? imapPassword : null,
    inboxMailtmBaseUrl: null,
  };
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
    ...inboxBridgeFields,
  });
  setActivePythonJobId(startResponse.jobId);
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

export async function runBitbucketJob(params: ProviderJobParams): Promise<BitbucketAutoregResult> {
  const { email, config, imapServer, imapUser, imapPassword, onCancelled, onLog } = params;
  const correlationId = createCorrelationId();
  const inboxBridgeFields = {
    inboxProvider: config.imap.mailtmEnabled ? 'mail_tm' : 'imap',
    inboxMailbox: 'INBOX',
    inboxMailtmAddress: config.imap.mailtmEnabled ? imapUser : null,
    inboxMailtmPassword: config.imap.mailtmEnabled ? imapPassword : null,
    inboxMailtmBaseUrl: null,
  };
  const startResponse = await startBitbucketAutoregJob({
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
    ...inboxBridgeFields,
  });
  setActivePythonJobId(startResponse.jobId);
  return await waitForJobResult<BitbucketAutoregResult>(
    startResponse.jobId,
    REGISTRATION_TIMEOUT_MS,
    onCancelled,
    onLog,
    {
      success: false,
      email,
      password: null,
      name: null,
      error: 'Bitbucket job failed',
    }
  );
}

export async function runKiroV2Job(params: ProviderJobParams): Promise<KiroV2AutoregResult> {
  const { email, config, imapServer, imapUser, imapPassword, onCancelled, onLog, pipelineStepOverrides } = params;
  const correlationId = createCorrelationId();
  const inboxBridgeFields = {
    inboxProvider: config.imap.mailtmEnabled ? 'mail_tm' : 'imap',
    inboxMailbox: 'INBOX',
    inboxMailtmAddress: config.imap.mailtmEnabled ? imapUser : null,
    inboxMailtmPassword: config.imap.mailtmEnabled ? imapPassword : null,
    inboxMailtmBaseUrl: null,
  };
  const startResponse = await startKiroV2AutoregJob({
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
    // Card / billing — use shared cardsText pool (same as Fireworks)
    cardsText: config.advanced.cardsText?.trim() || null,
    cardBin: config.advanced.cardBin?.trim() || null,
    cardNumber: null,
    cardExpiry: null,
    cardCvc: null,
    cardholderName: null,
    billingCountry: null,
    billingAddress: null,
    billingCity: null,
    billingState: null,
    billingZip: null,
    kiroPlan: config.advanced.kiroPlan?.trim() || 'free',
    browserEngine: config.advanced.browserEngine?.trim() || 'cloakbrowser',
    correlationId,
    ...inboxBridgeFields,
  });
  setActivePythonJobId(startResponse.jobId);

  // Send initial step configuration overrides immediately after job starts
  if (pipelineStepOverrides && pipelineStepOverrides.length > 0) {
    for (const step of pipelineStepOverrides) {
      await registrationControl(startResponse.jobId, 'configure', step.id, {
        enabled: step.enabled,
        pause_after: step.pauseAfter,
        skippable: step.skippable,
      }).catch((err: unknown) => {
        onLog('warn', `Failed to configure step ${step.id}: ${String(err)}`);
      });
    }
  }

  return await waitForJobResult<KiroV2AutoregResult>(
    startResponse.jobId,
    REGISTRATION_TIMEOUT_MS,
    onCancelled,
    onLog,
    {
      success: false,
      email,
      password: null,
      name: null,
      billingAttached: null,
      billingError: null,
      error: 'Kiro v2 job failed',
    }
  );
}
