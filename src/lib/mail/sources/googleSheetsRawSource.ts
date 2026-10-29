import type { GoogleSheetsDataset } from '@/types/googleSheets';
import { cellsToRecord, pickFirst } from '@/lib/googleSheets/rowHelpers';
import type { MailboxParseResult, MailboxProfileDraft, MailboxRowIssue } from './types';

function slug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toBoolean(value: string, fallback: boolean): { value: boolean; warning?: string } {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return { value: fallback };
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return { value: true };
  if (['0', 'false', 'no', 'off'].includes(normalized)) return { value: false };
  return {
    value: fallback,
    warning: `Invalid boolean value "${value}", fallback applied`,
  };
}

function detectProvider(record: Record<string, string>): 'imap' | 'mail_tm' | null {
  const rawProvider = pickFirst(record, [
    'inbox_provider',
    'mail_provider',
    'provider',
    'inboxprovider',
  ]).toLowerCase();

  if (['imap'].includes(rawProvider)) return 'imap';
  if (['mail_tm', 'mailtm', 'mail.tm'].includes(rawProvider)) return 'mail_tm';

  if (pickFirst(record, ['inbox_mailtm_address', 'mailtm_address', 'mailtm_email'])) {
    return 'mail_tm';
  }
  if (pickFirst(record, ['imap_host', 'imap_server', 'host', 'server'])) {
    return 'imap';
  }

  return null;
}

function buildIssue(
  issue: Omit<MailboxRowIssue, 'id' | 'rowNumber' | 'sheetName'>,
  index: number,
  rowNumber: number,
  sheetName: string
): MailboxRowIssue {
  return {
    id: `${sheetName}:${rowNumber}:${index}:${issue.code}`,
    rowNumber,
    sheetName,
    ...issue,
  };
}

function parseImapPort(value: string): { port: number; warning?: string; error?: string } {
  if (!value.trim()) {
    return { port: 993 };
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return { port: 993, error: 'Port must be numeric' };
  }
  if (parsed < 1 || parsed > 65535) {
    return { port: 993, error: 'Port must be between 1 and 65535' };
  }

  return { port: parsed };
}

function parseImapRow(
  record: Record<string, string>,
  sheetName: string,
  rowNumber: number,
  spreadsheetId?: string
): { draft?: MailboxProfileDraft; issues: MailboxRowIssue[] } {
  const issues: MailboxRowIssue[] = [];
  const host = pickFirst(record, ['imap_host', 'imap_server', 'host', 'server', 'mail_host']);
  const username = pickFirst(record, ['imap_user', 'username', 'login', 'email']);
  const password = pickFirst(record, ['imap_password', 'password', 'pass']);
  const mailbox = pickFirst(record, ['inbox_mailbox', 'mailbox']) || 'INBOX';
  const accountId =
    pickFirst(record, ['account_id', 'mailbox_id', 'service_account_id', 'id']) ||
    `${sheetName}:${rowNumber}`;

  const portResult = parseImapPort(pickFirst(record, ['imap_port', 'port']));
  if (portResult.error) {
    issues.push(
      buildIssue(
        {
          severity: 'error',
          code: 'INVALID_PORT',
          field: 'imap_port',
          message: portResult.error,
        },
        0,
        rowNumber,
        sheetName
      )
    );
  }

  const tlsResult = toBoolean(pickFirst(record, ['imap_use_tls', 'use_tls', 'tls']), true);
  if (tlsResult.warning) {
    issues.push(
      buildIssue(
        {
          severity: 'warning',
          code: 'INVALID_BOOLEAN',
          field: 'imap_use_tls',
          message: tlsResult.warning,
        },
        1,
        rowNumber,
        sheetName
      )
    );
  }

  if (!host) {
    issues.push(
      buildIssue(
        {
          severity: 'error',
          code: 'MISSING_REQUIRED_FIELD',
          field: 'imap_host',
          message: 'IMAP host is required',
        },
        2,
        rowNumber,
        sheetName
      )
    );
  }

  if (!username) {
    issues.push(
      buildIssue(
        {
          severity: 'error',
          code: 'MISSING_REQUIRED_FIELD',
          field: 'imap_user',
          message: 'IMAP username is required',
        },
        3,
        rowNumber,
        sheetName
      )
    );
  }

  if (!password) {
    issues.push(
      buildIssue(
        {
          severity: 'error',
          code: 'MISSING_REQUIRED_FIELD',
          field: 'imap_password',
          message: 'IMAP password is required',
        },
        4,
        rowNumber,
        sheetName
      )
    );
  }

  if (issues.some(issue => issue.severity === 'error')) {
    return { issues };
  }

  const labelBase =
    pickFirst(record, ['label', 'name', 'display_name', 'email', 'login']) || username;
  const draft: MailboxProfileDraft = {
    id: `gs-imap-${slug(`${accountId}-${host}-${username}-${mailbox}`)}`,
    provider: 'imap',
    accountId,
    mailbox,
    label: `IMAP · ${labelBase}`,
    connectInput: {
      provider: 'imap',
      accountId,
      credentials: {
        type: 'imap',
        value: {
          host,
          port: portResult.port,
          username,
          password,
          useTls: tlsResult.value,
        },
      },
      options: {
        mailbox,
        readOnly: true,
      },
    },
    source: {
      type: 'google_sheets_raw',
      spreadsheetId,
      sheetName,
      rowNumber,
    },
    raw: record,
    warnings: issues.filter(issue => issue.severity === 'warning').map(issue => issue.message),
  };

  return { draft, issues };
}

function parseMailTmRow(
  record: Record<string, string>,
  sheetName: string,
  rowNumber: number,
  spreadsheetId?: string
): { draft?: MailboxProfileDraft; issues: MailboxRowIssue[] } {
  const issues: MailboxRowIssue[] = [];
  const address = pickFirst(record, [
    'inbox_mailtm_address',
    'mailtm_address',
    'mailtm_email',
    'email',
    'login',
  ]);
  const password = pickFirst(record, [
    'inbox_mailtm_password',
    'mailtm_password',
    'password',
    'pass',
  ]);
  const baseUrl =
    pickFirst(record, ['inbox_mailtm_base_url', 'mailtm_base_url', 'base_url']) ||
    'https://api.mail.tm';
  const accountId =
    pickFirst(record, ['account_id', 'mailbox_id', 'service_account_id', 'id']) ||
    `${sheetName}:${rowNumber}`;

  if (!address) {
    issues.push(
      buildIssue(
        {
          severity: 'error',
          code: 'MISSING_REQUIRED_FIELD',
          field: 'mailtm_address',
          message: 'Mail.tm address is required',
        },
        0,
        rowNumber,
        sheetName
      )
    );
  }

  if (!password) {
    issues.push(
      buildIssue(
        {
          severity: 'error',
          code: 'MISSING_REQUIRED_FIELD',
          field: 'mailtm_password',
          message: 'Mail.tm password is required',
        },
        1,
        rowNumber,
        sheetName
      )
    );
  }

  if (issues.some(issue => issue.severity === 'error')) {
    return { issues };
  }

  const labelBase =
    pickFirst(record, ['label', 'name', 'display_name', 'email', 'login']) || address;
  const draft: MailboxProfileDraft = {
    id: `gs-mailtm-${slug(`${accountId}-${address}-${baseUrl}`)}`,
    provider: 'mail_tm',
    accountId,
    mailbox: 'INBOX',
    label: `Mail.tm · ${labelBase}`,
    connectInput: {
      provider: 'mail_tm',
      accountId,
      credentials: {
        type: 'mail_tm',
        value: {
          address,
          password,
          baseUrl,
        },
      },
      options: {
        mailbox: null,
        readOnly: true,
      },
    },
    source: {
      type: 'google_sheets_raw',
      spreadsheetId,
      sheetName,
      rowNumber,
    },
    raw: record,
    warnings: [],
  };

  return { draft, issues };
}

export function parseMailboxDraftsFromGoogleSheetsRaw(
  dataset: GoogleSheetsDataset | null
): MailboxParseResult {
  const drafts: MailboxProfileDraft[] = [];
  const issues: MailboxRowIssue[] = [];

  if (!dataset?.raw) {
    return { drafts, issues };
  }

  const spreadsheetId = dataset.raw.spreadsheetId;

  dataset.raw.invalidRows.forEach((invalidRow, index) => {
    issues.push(
      buildIssue(
        {
          severity: 'error',
          code: 'MISSING_REQUIRED_FIELD',
          message: invalidRow.reason,
        },
        index,
        invalidRow.rowNumber,
        invalidRow.sheetName
      )
    );
  });

  dataset.raw.services.forEach(serviceSheet => {
    serviceSheet.rows.forEach((row, rowIdx) => {
      const record = cellsToRecord(row.cells);

      const provider = detectProvider(record);
      if (!provider) {
        issues.push(
          buildIssue(
            {
              severity: 'error',
              code: 'MISSING_PROVIDER',
              message: 'Unable to detect provider (imap/mail_tm) from row',
            },
            rowIdx,
            row.rowNumber,
            serviceSheet.sheetName
          )
        );
        return;
      }

      const parsed =
        provider === 'imap'
          ? parseImapRow(record, serviceSheet.sheetName, row.rowNumber, spreadsheetId)
          : parseMailTmRow(record, serviceSheet.sheetName, row.rowNumber, spreadsheetId);

      issues.push(...parsed.issues);
      if (parsed.draft) {
        drafts.push(parsed.draft);
      }
    });
  });

  return { drafts, issues };
}
