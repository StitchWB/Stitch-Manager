import { t } from '../i18n';

export type RelationType =
  | 'via'
  | 'linked_to'
  | 'registered_for'
  | 'can_login_to'
  | 'oauth_capable';

export interface AccountRelationEdge {
  type: RelationType;
  sourceProvider: string;
  targetProvider: string;
  explicit: boolean;
  label: string;
}

const parseJsonObject = (value: string | null): Record<string, unknown> | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

export const normalizeProviderLabel = (provider: string): string => {
  if (provider === 'aws_builder_id') return 'AWS Builder ID';
  if (provider === 'aws') return 'AWS';
  return provider.charAt(0).toUpperCase() + provider.slice(1);
};

export const extractRelationHints = (account: {
  provider: string;
  providerSubtype?: string | null;
  registrationMetadata?: string | null;
  providerMetadata?: string | null;
  metadata?: string | null;
  tags?: string | null;
}): string[] => {
  const hints = new Set<string>();
  const edges = extractRelationEdges(account);

  edges.forEach(edge => {
    hints.add(edge.label);
  });

  // Keep relation hints compact
  return Array.from(hints).slice(0, 4);
};

const parseTags = (tags: string | null | undefined): string[] => {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const buildEdgeLabel = (edge: Omit<AccountRelationEdge, 'label'>): string => {
  if (edge.type === 'via') {
    return t('accounts.relationVia', { provider: edge.targetProvider });
  }
  if (edge.type === 'registered_for') {
    return t('accounts.relationRegisteredFor', { provider: edge.targetProvider });
  }
  if (edge.type === 'linked_to') {
    return t('accounts.relationLinkedTo', { provider: edge.targetProvider });
  }
  return t('accounts.relationCanLoginTo', { provider: edge.targetProvider });
};

export const extractRelationEdges = (account: {
  provider: string;
  providerSubtype?: string | null;
  registrationMetadata?: string | null;
  providerMetadata?: string | null;
  metadata?: string | null;
  tags?: string | null;
}): AccountRelationEdge[] => {
  const edges = new Map<string, AccountRelationEdge>();
  const sourceProvider = normalizeProviderLabel(account.provider);

  const tags = parseTags(account.tags);

  const registrationMeta = parseJsonObject(account.registrationMetadata ?? null);
  const providerMeta = parseJsonObject(account.providerMetadata ?? null);
  const metadata = parseJsonObject(account.metadata ?? null);

  const addEdge = (
    type: RelationType,
    targetRaw: string,
    explicit: boolean,
    sourceOverride?: string
  ) => {
    const targetProvider = normalizeProviderLabel(targetRaw);
    const source = sourceOverride ?? sourceProvider;
    const key = `${type}:${source}->${targetProvider}`;
    if (edges.has(key)) return;

    const base: Omit<AccountRelationEdge, 'label'> = {
      type,
      sourceProvider: source,
      targetProvider,
      explicit,
    };

    edges.set(key, {
      ...base,
      label: buildEdgeLabel(base),
    });
  };

  const viaProvider =
    (registrationMeta?.viaProvider as string | undefined) ||
    (registrationMeta?.sourceProvider as string | undefined) ||
    (providerMeta?.viaProvider as string | undefined) ||
    (metadata?.viaProvider as string | undefined);

  if (viaProvider && typeof viaProvider === 'string') {
    addEdge('via', viaProvider, true);
  }

  const linkedKiroId =
    (registrationMeta?.kiroAccountId as string | undefined) ||
    (registrationMeta?.kiro_account_id as string | undefined);
  if (linkedKiroId && account.provider !== 'kiro') {
    addEdge('linked_to', 'kiro', true);
  }

  const linkedAwsId =
    (registrationMeta?.awsAccountId as string | undefined) ||
    (registrationMeta?.aws_account_id as string | undefined);
  if (linkedAwsId && account.provider !== 'aws_builder_id' && account.provider !== 'aws') {
    addEdge('linked_to', 'aws_builder_id', true);
  }

  const canLoginToFromTags = tags
    .filter(tag => tag.startsWith('can-login:'))
    .map(tag => tag.replace('can-login:', ''));
  canLoginToFromTags.forEach(target => {
    addEdge('can_login_to', target, true);
  });

  const registeredForFromTags = tags
    .filter(tag => tag.startsWith('registered-for:'))
    .map(tag => tag.replace('registered-for:', ''));
  registeredForFromTags.forEach(target => {
    addEdge('registered_for', target, true);
  });

  // explicit relation tag format: "rel:<type>:<targetProvider>"
  tags
    .filter(tag => tag.startsWith('rel:'))
    .forEach(tag => {
      const [, rawType, target] = tag.split(':');
      if (!rawType || !target) return;
      const mappedType: RelationType | null =
        rawType === 'via'
          ? 'via'
          : rawType === 'linked'
            ? 'linked_to'
            : rawType === 'registered'
              ? 'registered_for'
              : rawType === 'login'
                ? 'can_login_to'
                : null;
      if (!mappedType) return;
      addEdge(mappedType, target, true);
    });

  if (sourceProvider === 'Github') {
    addEdge('oauth_capable', 'kiro', false);
    addEdge('oauth_capable', 'windsurf', false);
    addEdge('oauth_capable', 'trae', false);
  }

  if (sourceProvider === 'AWS Builder ID') {
    addEdge('oauth_capable', 'kiro', false);
  }

  return Array.from(edges.values());
};

export const hasAnyRelations = (account: {
  provider: string;
  providerSubtype?: string | null;
  registrationMetadata?: string | null;
  providerMetadata?: string | null;
  metadata?: string | null;
  tags?: string | null;
}): boolean => extractRelationEdges(account).length > 0;

export const hasExplicitRelationLinks = (account: { tags?: string | null }): boolean => {
  const tags = parseTags(account.tags);
  return tags.some(
    tag =>
      tag.startsWith('rel:') || tag.startsWith('can-login:') || tag.startsWith('registered-for:')
  );
};

export const isOAuthCapableIdentity = (account: { provider: string }): boolean => {
  const sourceProvider = normalizeProviderLabel(account.provider);
  return sourceProvider === 'Github' || sourceProvider === 'AWS Builder ID';
};
