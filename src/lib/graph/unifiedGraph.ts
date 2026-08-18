import type { Account } from '@/types/generated';
import type {
  GoogleSheetsDataset,
  GoogleSheetsIdentityNode,
  GoogleSheetsServiceAccount,
} from '@/types/googleSheets';

export type UnifiedNodeKind = 'identity' | 'service' | 'account' | 'profile' | 'auth_method';

export type UnifiedGraphNode = {
  id: string;
  kind: UnifiedNodeKind;
  label: string;
  meta?: Record<string, unknown>;
};

export type UnifiedGraphEdgeKind =
  | 'identity_to_service'
  | 'service_to_account'
  | 'account_to_profile'
  | 'account_to_account'
  | 'account_to_auth_method'
  | 'auth_method_to_profile';

export type UnifiedGraphEdge = {
  id: string;
  kind: UnifiedGraphEdgeKind;
  fromId: string;
  toId: string;
  label?: string;
  meta?: Record<string, unknown>;
};

export type UnifiedGraphDiagnostics = {
  identities: number;
  services: number;
  links: number;
  localAccounts: number;
  localProfiles: number;
  matchedServiceToAccount: number;
  matchedAccountToProfile: number;
  reasons: Array<{ code: string; message: string }>;
};

export type UnifiedGraph = {
  nodes: UnifiedGraphNode[];
  edges: UnifiedGraphEdge[];
  diagnostics: UnifiedGraphDiagnostics;
};

const norm = (value: string | null | undefined) => (value ?? '').trim().toLowerCase();

const normalizeProvider = (value: string | null | undefined) => {
  const key = norm(value);
  if (key === 'aws_builder_id' || key === 'aws builder id') return 'aws';
  return key;
};

const serviceFromSheet = (sheetName: string) => {
  const trimmed = sheetName.trim();
  return trimmed.toUpperCase().startsWith('SVC_') ? trimmed.slice(4) : trimmed;
};

const nodeId = {
  identity: (id: string) => `identity:${id}`,
  service: (service: string, serviceAccountId: string) =>
    `service:${normalizeProvider(service)}:${serviceAccountId}`,
  account: (accountId: number) => `account:${accountId}`,
  profile: (alias: string) => `profile:${alias}`,
};

const pickServiceAccountLogin = (service: GoogleSheetsServiceAccount) => norm(service.login) || '';

const pickAccountLogin = (account: Account) => norm(account.email);

export function buildUnifiedGraph(params: {
  sheets: GoogleSheetsDataset | null;
  localAccounts: Account[];
  localProfiles: string[];
}): UnifiedGraph {
  const { sheets, localAccounts, localProfiles } = params;

  const diagnostics: UnifiedGraphDiagnostics = {
    identities: sheets?.identityGraph?.identities?.length ?? 0,
    services: sheets?.identityGraph?.services?.length ?? 0,
    links: sheets?.raw?.links?.length ?? 0,
    localAccounts: localAccounts.length,
    localProfiles: localProfiles.length,
    matchedServiceToAccount: 0,
    matchedAccountToProfile: 0,
    reasons: [],
  };

  const nodes: UnifiedGraphNode[] = [];
  const edges: UnifiedGraphEdge[] = [];

  const identities: GoogleSheetsIdentityNode[] = sheets?.identityGraph?.identities ?? [];
  const services: GoogleSheetsServiceAccount[] = sheets?.identityGraph?.services ?? [];
  const accountLinks = sheets?.identityGraph?.accountLinks ?? [];
  const profileLinks = sheets?.identityGraph?.profileLinks ?? [];
  const authMethods = sheets?.identityGraph?.authMethods ?? [];
  const accountAuthLinks = sheets?.identityGraph?.accountAuthLinks ?? [];
  const accountNodeIdByProviderLogin = new Map<string, string>();
  const authMethodNodeIdById = new Map<string, string>();

  if (!sheets) {
    diagnostics.reasons.push({
      code: 'sheets_missing',
      message: 'Google Sheets dataset not loaded',
    });
  }

  // Nodes: identities
  identities.forEach(identity => {
    nodes.push({
      id: nodeId.identity(identity.id),
      kind: 'identity',
      label: identity.primaryEmail || identity.label || identity.id,
      meta: { rawId: identity.id },
    });
  });

  // Nodes: service accounts
  services.forEach(service => {
    const id = nodeId.service(
      service.service || serviceFromSheet(service.sheetName || ''),
      service.id
    );
    nodes.push({
      id,
      kind: 'service',
      label: service.login || service.id,
      meta: {
        service: service.service,
        sheetName: service.sheetName,
        serviceAccountId: service.id,
      },
    });
  });

  // Nodes: local accounts
  localAccounts.forEach(account => {
    const providerNorm = normalizeProvider(account.provider);
    const loginNorm = pickAccountLogin(account);
    if (providerNorm && loginNorm) {
      accountNodeIdByProviderLogin.set(`${providerNorm}:${loginNorm}`, nodeId.account(account.id));
    }

    nodes.push({
      id: nodeId.account(account.id),
      kind: 'account',
      label: account.email,
      meta: {
        accountId: account.id,
        provider: account.provider,
        email: account.email,
      },
    });
  });

  // Nodes: local profiles
  localProfiles.forEach(alias => {
    nodes.push({
      id: nodeId.profile(alias),
      kind: 'profile',
      label: alias,
      meta: { alias },
    });
  });

  // Nodes: auth methods
  authMethods.forEach(method => {
    const authNodeId = `auth_method:${method.id}`;
    authMethodNodeIdById.set(method.id, authNodeId);
    nodes.push({
      id: authNodeId,
      kind: 'auth_method',
      label: `${method.authType}:${method.provider}`,
      meta: {
        authMethodId: method.id,
        authType: method.authType,
        provider: method.provider,
        clientName: method.clientName,
        status: method.status,
        keyFingerprint: method.keyFingerprint,
      },
    });
  });

  // Edge: identity -> service (from LINKS)
  const linksRaw = sheets?.raw?.links ?? [];
  linksRaw.forEach(linkRow => {
    const record = linkRow.cells.reduce(
      (acc, kv) => {
        acc[kv.key] = kv.value;
        return acc;
      },
      {} as Record<string, string>
    );
    const fromIdentityId =
      record.from_identity_id || record.identity_id || record.source_identity_id;
    const toSheet = record.to_service_sheet || record.to_service || record.service;
    const toServiceAccountId = record.to_service_account_id || record.target_id || record.to_id;
    if (!fromIdentityId || !toSheet || !toServiceAccountId) return;
    const serviceName = serviceFromSheet(toSheet);
    edges.push({
      id: `edge:identity_to_service:${fromIdentityId}:${serviceName}:${toServiceAccountId}:${linkRow.rowNumber}`,
      kind: 'identity_to_service',
      fromId: nodeId.identity(fromIdentityId),
      toId: nodeId.service(serviceName, toServiceAccountId),
      label: record.link_type || 'link',
      meta: {
        isPrimary: record.is_primary,
        status: record.status,
        toServiceSheet: toSheet,
      },
    });
  });

  // Edge: service -> local account (match by provider+login)
  const accountIndex = new Map<string, Account>();
  localAccounts.forEach(acc => {
    const key = `${normalizeProvider(acc.provider)}:${pickAccountLogin(acc)}`;
    accountIndex.set(key, acc);
  });

  services.forEach(service => {
    const provider = normalizeProvider(
      service.service || serviceFromSheet(service.sheetName || '')
    );
    const login = pickServiceAccountLogin(service);
    if (!provider || !login) return;
    const key = `${provider}:${login}`;
    const account = accountIndex.get(key);
    if (!account) return;
    diagnostics.matchedServiceToAccount += 1;
    edges.push({
      id: `edge:service_to_account:${provider}:${service.id}:${account.id}`,
      kind: 'service_to_account',
      fromId: nodeId.service(provider, service.id),
      toId: nodeId.account(account.id),
      label: 'same login',
      meta: { provider, login },
    });
  });

  // Edge: account -> profile (prefer PROFILE_LINKS sheet, fallback to legacy alias==email heuristic)
  if (profileLinks.length > 0) {
    const profileAliases = new Set(localProfiles.map(alias => norm(alias)));
    profileLinks.forEach(link => {
      const accountId = accountNodeIdByProviderLogin.get(
        `${normalizeProvider(link.accountProvider)}:${norm(link.accountLogin)}`
      );
      if (!accountId) return;

      const alias = link.profileAlias;
      if (!profileAliases.has(norm(alias))) return;

      diagnostics.matchedAccountToProfile += 1;
      edges.push({
        id: `edge:account_to_profile:${link.id}`,
        kind: 'account_to_profile',
        fromId: accountId,
        toId: nodeId.profile(alias),
        label: link.relation || 'profile link',
        meta: {
          profilePath: link.profilePath,
          status: link.status,
          source: 'PROFILE_LINKS',
        },
      });
    });
  } else {
    const profilesByAlias = new Set(localProfiles.map(a => norm(a)));
    localAccounts.forEach(account => {
      const alias = account.email;
      if (!profilesByAlias.has(norm(alias))) return;
      diagnostics.matchedAccountToProfile += 1;
      edges.push({
        id: `edge:account_to_profile:${account.id}:${alias}`,
        kind: 'account_to_profile',
        fromId: nodeId.account(account.id),
        toId: nodeId.profile(alias),
        label: 'profile alias',
      });
    });
  }

  // Edge: account -> account from ACCOUNT_LINKS
  accountLinks.forEach(link => {
    const fromId = accountNodeIdByProviderLogin.get(
      `${normalizeProvider(link.fromProvider)}:${norm(link.fromLogin)}`
    );
    const toId = accountNodeIdByProviderLogin.get(
      `${normalizeProvider(link.toProvider)}:${norm(link.toLogin)}`
    );

    if (!fromId || !toId) return;

    edges.push({
      id: `edge:account_to_account:${link.id}`,
      kind: 'account_to_account',
      fromId,
      toId,
      label: link.relation,
      meta: {
        status: link.status,
        confidence: link.confidence,
        source: 'ACCOUNT_LINKS',
      },
    });
  });

  // Edge: account -> auth method and auth method -> profile
  accountAuthLinks.forEach(link => {
    const accountId = accountNodeIdByProviderLogin.get(
      `${normalizeProvider(link.accountProvider)}:${norm(link.accountLogin)}`
    );
    const authNodeId = authMethodNodeIdById.get(link.authMethodId);

    if (!accountId || !authNodeId) return;

    edges.push({
      id: `edge:account_to_auth_method:${link.id}`,
      kind: 'account_to_auth_method',
      fromId: accountId,
      toId: authNodeId,
      label: link.channel,
      meta: {
        status: link.status,
        clientName: link.clientName,
        source: 'ACCOUNT_AUTH_LINKS',
      },
    });

    if (link.profileAlias && norm(link.channel) === 'browser') {
      edges.push({
        id: `edge:auth_method_to_profile:${link.id}`,
        kind: 'auth_method_to_profile',
        fromId: authNodeId,
        toId: nodeId.profile(link.profileAlias),
        label: 'browser_session',
        meta: {
          status: link.status,
          source: 'ACCOUNT_AUTH_LINKS',
        },
      });
    }
  });

  if (diagnostics.identities === 0) {
    diagnostics.reasons.push({
      code: 'no_identities',
      message: 'No identities loaded from Google Sheets (IDENTITIES empty or not parsed)',
    });
  }
  if (diagnostics.services === 0) {
    diagnostics.reasons.push({
      code: 'no_services',
      message: 'No service sheets loaded (no SVC_* sheets found or empty)',
    });
  }
  if (diagnostics.links === 0) {
    diagnostics.reasons.push({
      code: 'no_links',
      message: 'No links loaded from LINKS sheet',
    });
  }

  return { nodes, edges, diagnostics };
}
