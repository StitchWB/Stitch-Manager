import { describe, expect, it } from '@jest/globals';
import { buildUnifiedGraph } from '../../../lib/graph/unifiedGraph';
import type { Account } from '../../../types/generated';
import type { GoogleSheetsDataset } from '../../../types/googleSheets';

const mkAccount = (id: number, provider: string, email: string): Account => ({
  id,
  provider,
  email,
  token: null,
  refreshToken: null,
  quota: { used: 0, limit: 100, resetAt: null },
  status: 'active',
  expiresAt: null,
  lastUsedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: null,
  metadata: null,
  providerType: null,
  providerSubtype: null,
  providerMetadata: null,
  machineId: null,
  patchConfig: null,
  patchAppliedAt: null,
  registrationPassword: null,
  registrationDate: null,
  registrationMethod: null,
  registrationMetadata: null,
  browserProfilePath: null,
  cookies: null,
  sessionData: null,
  useCount: 0,
  lastError: null,
  errorCount: 0,
  successRate: 0,
  notes: null,
  tags: null,
  lastLoginAt: null,
  loginCount: 0,
  accountRegion: null,
});

describe('buildUnifiedGraph', () => {
  it('uses ACCOUNT_LINKS and PROFILE_LINKS when present', () => {
    const sheets: GoogleSheetsDataset = {
      source: 'google-sheets',
      sheets: [],
      raw: {
        spreadsheetId: 'sheet-1',
        title: 'Graph',
        identities: [],
        links: [],
        accountLinks: [],
        profileLinks: [],
        authMethods: [],
        accountAuthLinks: [],
        services: [],
        invalidRows: [],
        schemaIssues: [],
      },
      identityGraph: {
        identities: [],
        services: [],
        edges: [],
        accountLinks: [
          {
            id: 'al-1',
            fromProvider: 'gmail',
            fromLogin: 'u@gmail.com',
            toProvider: 'openai',
            toLogin: 'u@gmail.com',
            relation: 'signup_email',
          },
        ],
        profileLinks: [
          {
            id: 'pl-1',
            profileAlias: 'profile-main',
            accountProvider: 'openai',
            accountLogin: 'u@gmail.com',
            relation: 'login',
          },
        ],
        authMethods: [
          {
            id: 'am-1',
            authType: 'api_key',
            provider: 'openai',
            clientName: 'codex_cli',
          },
        ],
        accountAuthLinks: [
          {
            id: 'aal-1',
            accountProvider: 'openai',
            accountLogin: 'u@gmail.com',
            authMethodId: 'am-1',
            channel: 'api',
          },
        ],
      },
    };

    const localAccounts = [
      mkAccount(1, 'gmail', 'u@gmail.com'),
      mkAccount(2, 'openai', 'u@gmail.com'),
    ];
    const graph = buildUnifiedGraph({
      sheets,
      localAccounts,
      localProfiles: ['profile-main'],
    });

    expect(
      graph.edges.some(e => e.kind === 'account_to_account' && e.label === 'signup_email')
    ).toBe(true);
    expect(
      graph.edges.some(
        e =>
          e.kind === 'account_to_profile' &&
          e.toId === 'profile:profile-main' &&
          e.label === 'login'
      )
    ).toBe(true);
    expect(
      graph.nodes.some(node => node.kind === 'auth_method' && node.id === 'auth_method:am-1')
    ).toBe(true);
    expect(
      graph.edges.some(
        e =>
          e.kind === 'account_to_auth_method' &&
          e.fromId === 'account:2' &&
          e.toId === 'auth_method:am-1'
      )
    ).toBe(true);
  });
});
