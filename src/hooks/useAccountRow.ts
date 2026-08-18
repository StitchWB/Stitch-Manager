import { useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ru as dateFnsRu } from 'date-fns/locale';
import type { Account } from '@/types/generated';
import { formatProfileAlias } from '@/lib/profiles/displayName';
import { getLocale, t } from '@/lib/i18n';
import {
  providerLabelToKey,
  type AccountRelationEdge,
} from '@/lib/accounts/relations';

const providerLabelMap: Record<string, string> = {
  kiro: 'Kiro',
  windsurf: 'Windsurf',
  trae: 'Trae',
  github: 'GitHub',
  fireworks: 'Fireworks AI',
  aws_builder_id: 'AWS Builder',
  aws: 'AWS',
  google: 'Google',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

const statusVariantMap: Record<string, string> = {
  active: 'success',
  banned: 'error',
  limit_hit: 'warning',
  expired: 'warning',
  unknown: 'default',
};

const statusDotColorMap: Record<string, string> = {
  active: 'bg-emerald-500',
  banned: 'bg-red-500',
  limit_hit: 'bg-amber-500',
  expired: 'bg-orange-500',
  unknown: 'bg-slate-500',
};

function parseJsonValue(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseTags(tagsString: string | null): string[] {
  if (!tagsString) return [];
  return tagsString.split(',').map(t => t.trim()).filter(Boolean);
}

function getAlias(account: Account): string {
  const alias = (account as Record<string, unknown>).alias;
  return typeof alias === 'string' && alias ? alias : account.email;
}

function getProfileId(account: Account): string {
  return `account-${account.id}`;
}

function getProxyValue(account: Account): string {
  const metadata = parseJsonValue(account.metadata);
  const providerMeta = parseJsonValue(account.providerMetadata);

  const directProxy =
    metadata.proxy ?? metadata.proxyUrl ?? providerMeta.proxy ?? providerMeta.proxyUrl;
  if (typeof directProxy === 'string' && directProxy.trim()) {
    return directProxy.trim();
  }

  const metadataNetwork = metadata.network;
  if (metadataNetwork && typeof metadataNetwork === 'object') {
    const proxy = (metadataNetwork as Record<string, unknown>).proxy;
    if (proxy && typeof proxy === 'object') {
      const url = (proxy as Record<string, unknown>).url;
      if (typeof url === 'string' && url.trim()) return url.trim();
    }
  }

  return '—';
}

function formatLastLogin(account: Account): string {
  const rawDate = account.lastLoginAt ?? account.lastUsedAt ?? account.updatedAt;
  if (!rawDate) return '—';
  const parsedDate = new Date(rawDate);
  if (Number.isNaN(parsedDate.getTime())) return '—';
  return parsedDate.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatLastLoginRelative(account: Account): string {
  const rawDate = account.lastLoginAt ?? account.lastUsedAt;
  if (!rawDate) return '';
  const parsedDate = new Date(rawDate);
  if (Number.isNaN(parsedDate.getTime())) return '';
  const locale = getLocale() === 'ru' ? dateFnsRu : undefined;
  const result = formatDistanceToNow(parsedDate, { addSuffix: false, locale });
  // Strip "около "/"about " prefix for compactness in dense table
  return result.replace(/^(около|about)\s+/i, '');
}

function formatCreatedDateShort(account: Account): string {
  const rawDate = account.createdAt ?? account.registrationDate;
  if (!rawDate) return '';
  const parsedDate = new Date(rawDate);
  if (Number.isNaN(parsedDate.getTime())) return '';
  return parsedDate.toLocaleDateString(getLocale() === 'ru' ? 'ru-RU' : 'en-US', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

function getRegistrationMethodLabel(method: string | null): string {
  if (!method) return '';
  switch (method) {
    case 'auto':
      return t('accounts.registrationMethodAuto');
    case 'manual':
      return t('accounts.registrationMethodManual');
    case 'import':
      return t('accounts.registrationMethodImport');
    default:
      return method;
  }
}

export interface UseAccountRowData {
  alias: string;
  displayAlias: string;
  profileId: string;
  status: string;
  tags: string[];
  visibleTags: string[];
  remainingTagsCount: number;
  proxyValue: string;
  providerLabel: string;
  accountIdentifier: string;
  profileSessionReady: boolean;
  profileSessionPending: boolean;
  allowProfileAction: boolean;
  relationHintList: string[];
  relationProviderEntries: [string, AccountRelationEdge][];
  lastLoginFormatted: string;
  lastLoginRelative: string;
  hasLastLogin: boolean;
  createdDateShort: string;
  registrationMethodLabel: string;
  hasNotes: boolean;
  statusVariant: string;
  statusDotColor: string;
}

export function useAccountRowData(
  account: Account,
  relationHints?: string[],
  relationEdges?: AccountRelationEdge[]
): UseAccountRowData {
  const alias = getAlias(account);
  const displayAlias = formatProfileAlias(alias);
  const profileId = getProfileId(account);
  const status = account.status;
  const tags = useMemo(() => parseTags(account.tags), [account.tags]);
  const displayTags = useMemo(
    () => tags.filter(tag => !tag.startsWith('profile:')),
    [tags],
  );
  const visibleTags = useMemo(() => displayTags.slice(0, 2), [displayTags]);
  const remainingTagsCount = Math.max(0, displayTags.length - visibleTags.length);
  const proxyValue = useMemo(() => getProxyValue(account), [account]);
  const providerLabel = providerLabelMap[account.provider] ?? account.provider;
  const accountIdentifier = account.email;

  const profileSessionReady = tags.some(tag => tag.startsWith('profile:'));
  const profileSessionPending = tags.includes('profile:pending');
  const allowProfileAction =
    account.provider === 'kiro' ||
    tags.includes('profile:manual') ||
    tags.includes('profile:antidetect');
  const relationHintList = useMemo(() => relationHints ?? [], [relationHints]);
  const relationEdgeList = useMemo(() => relationEdges ?? [], [relationEdges]);

  const relationProviderEntries = useMemo(
    () =>
      Array.from(
        relationEdgeList.reduce((map, edge) => {
          const providerKey = providerLabelToKey(edge.targetProvider);
          if (!providerKey) return map;
          const existing = map.get(providerKey);
          if (!existing || (!existing.explicit && edge.explicit)) {
            map.set(providerKey, edge);
          }
          return map;
        }, new Map<string, AccountRelationEdge>())
      ),
    [relationEdgeList]
  );

  const lastLoginFormatted = useMemo(() => formatLastLogin(account), [account]);
  const lastLoginRelative = useMemo(() => formatLastLoginRelative(account), [account]);
  const hasLastLogin = Boolean(account.lastLoginAt ?? account.lastUsedAt);
  const createdDateShort = useMemo(() => formatCreatedDateShort(account), [account]);
  const registrationMethodLabel = useMemo(
    () => getRegistrationMethodLabel(account.registrationMethod),
    [account.registrationMethod],
  );
  const hasNotes = Boolean(account.notes && account.notes.trim());

  return {
    alias,
    displayAlias,
    profileId,
    status,
    tags,
    visibleTags,
    remainingTagsCount,
    proxyValue,
    providerLabel,
    accountIdentifier,
    profileSessionReady,
    profileSessionPending,
    allowProfileAction,
    relationHintList,
    relationProviderEntries,
    lastLoginFormatted,
    lastLoginRelative,
    hasLastLogin,
    createdDateShort,
    registrationMethodLabel,
    hasNotes,
    statusVariant: statusVariantMap[status] ?? 'default',
    statusDotColor: statusDotColorMap[status] ?? 'bg-slate-500',
  };
}
