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

export interface GoogleSheetsIdentityGraph {
  identities: GoogleSheetsIdentityNode[];
  services?: GoogleSheetsServiceAccount[];
  edges?: GoogleSheetsIdentityEdge[];
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
