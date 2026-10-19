import {
  startOpenAIAutoregJob,
  startFireworksAutoregJob,
  startQoderAutoregJob,
  startV0AppAutoregJob,
  registrationControl,
} from '../../../../lib/backend';
import { createCorrelationId } from '@/lib/observability/client';
import { DEFAULT_IMAP_PORT } from '../../../../constants/registration';
import type { OpenAIAutoregResult, FireworksAutoregResult, QoderAutoregResult, V0AppAutoregResult } from '../../../../types/ui';
import type { ProviderJobParams } from './types';
import { REGISTRATION_TIMEOUT_MS, setActivePythonJobId, waitForJobResult } from './recovery';

export async function runOpenAIJob(params: ProviderJobParams): Promise<OpenAIAutoregResult> {
  const { email, config, imapServer, imapUser, imapPassword, onCancelled, onLog } = params;
  const normalizedImapServer = imapServer?.trim() ? imapServer : null;
  const normalizedImapUser = imapUser?.trim() ? imapUser : null;
  // NOTE: Don't filter '********' sentinel — Rust resolves it from keyring via resolve_password()
  const normalizedImapPassword =
    imapPassword?.trim() ? imapPassword : null;

  const inboxBridgeFields = {
    inboxProvider: config.imap.mailtmEnabled ? 'mail_tm' : 'imap',
    inboxMailbox: 'INBOX',
    inboxMailtmAddress: config.imap.mailtmEnabled ? normalizedImapUser : null,
    inboxMailtmPassword: config.imap.mailtmEnabled ? normalizedImapPassword : null,
    inboxMailtmBaseUrl: null,
  };

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
          : 'static',
    baseEmail: email || config.imap.email || imapUser || null,
    ...inboxBridgeFields,
  });
  setActivePythonJobId(startResponse.jobId);
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

export async function runFireworksJob(params: ProviderJobParams): Promise<FireworksAutoregResult> {
  const { email, config, imapServer, imapUser, imapPassword, onCancelled, onLog, pipelineStepOverrides } = params;
  const normalizedImapServer = imapServer?.trim() ? imapServer : null;
  const normalizedImapUser = imapUser?.trim() ? imapUser : null;
  // NOTE: Don't filter '********' sentinel — Rust resolves it from keyring via resolve_password()
  const normalizedImapPassword =
    imapPassword?.trim() ? imapPassword : null;

  const inboxBridgeFields = {
    inboxProvider: config.imap.mailtmEnabled ? 'mail_tm' : 'imap',
    inboxMailbox: 'INBOX',
    inboxMailtmAddress: config.imap.mailtmEnabled ? normalizedImapUser : null,
    inboxMailtmPassword: config.imap.mailtmEnabled ? normalizedImapPassword : null,
    inboxMailtmBaseUrl: null,
  };

  const fireworksPassword = `Fw${Math.random().toString(36).substring(2, 10)}!1`;
  const startResponse = await startFireworksAutoregJob({
    email,
    password: fireworksPassword,
    name: null,
    firstName: null,
    lastName: null,
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
          : 'static',
    baseEmail: email || config.imap.email || imapUser || null,
    correlationId: createCorrelationId(),
    cardsFile: null,
    cardsText: config.advanced.cardsText?.trim() || null,
    cardBin: config.advanced.cardBin?.trim() || null,
    captchaTimeout: config.advanced.captchaTimeout,
    captchaSoundEnabled: config.advanced.captchaSoundEnabled,
    debug: config.logVerbosity === 'debug',
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

  return await waitForJobResult<FireworksAutoregResult>(
    startResponse.jobId,
    REGISTRATION_TIMEOUT_MS,
    onCancelled,
    onLog,
    {
      success: false,
      email,
      password: fireworksPassword,
      name: null,
      firstName: null,
      lastName: null,
      plan: null,
      error: 'Fireworks job failed',
    }
  );
}

export async function runQoderJob(params: ProviderJobParams): Promise<QoderAutoregResult> {
  const { email, config, imapServer, imapUser, imapPassword, onCancelled, onLog, pipelineStepOverrides } = params;
  const normalizedImapServer = imapServer?.trim() ? imapServer : null;
  const normalizedImapUser = imapUser?.trim() ? imapUser : null;
  const normalizedImapPassword = imapPassword?.trim() ? imapPassword : null;

  const inboxBridgeFields = {
    inboxProvider: config.imap.mailtmEnabled ? 'mail_tm' : 'imap',
    inboxMailbox: 'INBOX',
    inboxMailtmAddress: config.imap.mailtmEnabled ? normalizedImapUser : null,
    inboxMailtmPassword: config.imap.mailtmEnabled ? normalizedImapPassword : null,
    inboxMailtmBaseUrl: null,
  };

  const qoderPassword = `Qo${Math.random().toString(36).substring(2, 10)}!1`;
  const startResponse = await startQoderAutoregJob({
    email,
    password: qoderPassword,
    name: null,
    firstName: null,
    lastName: null,
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
          : 'static',
    baseEmail: email || config.imap.email || imapUser || null,
    correlationId: createCorrelationId(),
    captchaTimeout: config.advanced.captchaTimeout,
    captchaSoundEnabled: config.advanced.captchaSoundEnabled,
    debug: config.logVerbosity === 'debug',
    ...inboxBridgeFields,
  });
  setActivePythonJobId(startResponse.jobId);

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

  return await waitForJobResult<QoderAutoregResult>(
    startResponse.jobId,
    REGISTRATION_TIMEOUT_MS,
    onCancelled,
    onLog,
    {
      success: false,
      email,
      password: qoderPassword,
      name: null,
      firstName: null,
      lastName: null,
      plan: null,
      error: 'Qoder job failed',
    }
  );
}

export async function runV0AppJob(params: ProviderJobParams): Promise<V0AppAutoregResult> {
  const { email, config, imapServer, imapUser, imapPassword, onCancelled, onLog, pipelineStepOverrides } = params;
  const correlationId = createCorrelationId();
  const normalizedImapServer = imapServer?.trim() ? imapServer : null;
  const normalizedImapUser = imapUser?.trim() ? imapUser : null;
  const normalizedImapPassword = imapPassword?.trim() ? imapPassword : null;

  const inboxBridgeFields = {
    inboxProvider: config.imap.mailtmEnabled ? 'mail_tm' : 'imap',
    inboxMailbox: 'INBOX',
    inboxMailtmAddress: config.imap.mailtmEnabled ? normalizedImapUser : null,
    inboxMailtmPassword: config.imap.mailtmEnabled ? normalizedImapPassword : null,
    inboxMailtmBaseUrl: null,
  };

  const startResponse = await startV0AppAutoregJob({
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
    thirtyThreeMailEnabled: config.imap.thirtyThreeMailEnabled ?? null,
    thirtyThreeMailUsername: config.imap.thirtyThreeMailUsername ?? null,
    thirtyThreeMailDomain: config.imap.thirtyThreeMailDomain ?? null,
    mailtmEnabled: config.imap.mailtmEnabled ?? null,
    correlationId,
    referredById: config.v0ReferredById ?? null,
    signupUrl: config.v0SignupUrl?.trim() ? config.v0SignupUrl.trim() : null,
    ...inboxBridgeFields,
  });
  setActivePythonJobId(startResponse.jobId);

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

  return await waitForJobResult<V0AppAutoregResult>(
    startResponse.jobId,
    REGISTRATION_TIMEOUT_MS,
    onCancelled,
    onLog,
    {
      success: false,
      email,
      password: null,
      name: null,
      token: null,
      error: 'v0 App job failed',
    }
  );
}
