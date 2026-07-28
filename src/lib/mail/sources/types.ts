import type { EmailConnectInput, EmailProviderType } from '@/lib/backend/modules/emailInbox';

export type MailboxSourceType = 'google_sheets_raw';

export interface MailboxRowIssue {
  id: string;
  severity: 'error' | 'warning';
  code:
    | 'UNSUPPORTED_PROVIDER'
    | 'MISSING_PROVIDER'
    | 'MISSING_REQUIRED_FIELD'
    | 'INVALID_PORT'
    | 'INVALID_BOOLEAN';
  message: string;
  sheetName: string;
  rowNumber: number;
  field?: string;
}

export interface MailboxProfileDraft {
  id: string;
  label: string;
  provider: EmailProviderType;
  accountId: string;
  mailbox: string;
  connectInput: EmailConnectInput;
  source: {
    type: MailboxSourceType;
    spreadsheetId?: string;
    sheetName: string;
    rowNumber: number;
  };
  raw: Record<string, string>;
  warnings: string[];
}

export interface MailboxParseResult {
  drafts: MailboxProfileDraft[];
  issues: MailboxRowIssue[];
}
