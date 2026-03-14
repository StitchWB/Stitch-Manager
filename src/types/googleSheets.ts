import type {
  AccountsGraphDataset,
  GoogleSheetsConnectionStatus as RawGoogleSheetsConnectionStatus,
  InvalidRow,
} from './generated';

export type GoogleSheetsServiceStatus =
  | 'active'
  | 'banned'
  | 'limit_hit'
  | 'expired'
  | 'unknown'
  | 'pending'
  | 'inactive'
  | 'suspended'
  | (string & {});

export type GoogleSheetsConnectionStatus = RawGoogleSheetsConnectionStatus;

export interface GoogleSheetsServiceAccount {
  id: string;
  service: string;
  login?: string;
  status?: GoogleSheetsServiceStatus;
  identityId?: string;
  identityLabel?: string;
  linkedIdentities?: string[];
  sheetName?: string;
  metadata?: Record<string, unknown>;
}

export interface GoogleSheetsIdentityNode {
  id: string;
  label: string;
  primaryEmail?: string;
  status?: GoogleSheetsServiceStatus;
  tags?: string[];
  linkedIdentities?: string[];
  services?: GoogleSheetsServiceAccount[];
  metadata?: Record<string, unknown>;
}

export interface GoogleSheetsIdentityEdge {
  id?: string;
  sourceId: string;
  targetId: string;
  relation?: string;
  service?: string;
}

export interface GoogleSheetsAccountLinkEdge {
  id: string;
  fromProvider: string;
  fromLogin: string;
  toProvider: string;
  toLogin: string;
  relation: string;
  status?: string;
  confidence?: string;
  metadata?: Record<string, unknown>;
}

export interface GoogleSheetsProfileLinkEdge {
  id: string;
  profileAlias: string;
  profilePath?: string;
  accountProvider: string;
  accountLogin: string;
  relation: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface GoogleSheetsAuthMethod {
  id: string;
  authType: string;
  provider: string;
  principalProvider?: string;
  principalLogin?: string;
  secretRef?: string;
  keyFingerprint?: string;
  clientName?: string;
  scopes?: string;
  status?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface GoogleSheetsAccountAuthLink {
  id: string;
  accountProvider: string;
  accountLogin: string;
  authMethodId: string;
  channel: string;
  clientName?: string;
  profileAlias?: string;
  isPrimary?: boolean;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface GoogleSheetsIdentityGraph {
  identities: GoogleSheetsIdentityNode[];
  services?: GoogleSheetsServiceAccount[];
  edges?: GoogleSheetsIdentityEdge[];
  accountLinks?: GoogleSheetsAccountLinkEdge[];
  profileLinks?: GoogleSheetsProfileLinkEdge[];
  authMethods?: GoogleSheetsAuthMethod[];
  accountAuthLinks?: GoogleSheetsAccountAuthLink[];
}

export type GoogleSheetsRow = Record<string, unknown> & {
  rowId?: string | number;
  login?: string;
  status?: string;
  primaryIdentity?: string;
  linkedIdentities?: string[] | string;
  service?: string;
};

export interface GoogleSheetsSheet {
  id: string;
  name: string;
  updatedAt?: string;
  rowCount?: number;
  columns?: string[];
  rows: GoogleSheetsRow[];
  metadata?: Record<string, unknown>;
}

export interface GoogleSheetsDataset {
  fetchedAt?: string;
  source?: string;
  connection?: GoogleSheetsConnectionStatus;
  identityGraph?: GoogleSheetsIdentityGraph;
  sheets: GoogleSheetsSheet[];
  invalidRows?: InvalidRow[];
  raw?: AccountsGraphDataset;
  errors?: string[];
}
