export function formatProfileAlias(alias: string | null | undefined): string {
  const raw = (alias ?? '').trim();
  if (!raw) return '—';

  // standalone.profile.1771926203823@local.profile -> Profile 1771926203823
  const standaloneMatch = raw.match(/^standalone\.profile\.([\w.-]+)@local\.profile$/i);
  if (standaloneMatch) {
    return `Profile ${standaloneMatch[1]}`;
  }

  // something@local.profile -> something
  if (/@local\.profile$/i.test(raw)) {
    return raw.replace(/@local\.profile$/i, '');
  }

  // provider_timestamp@domain -> provider_timestamp
  if (raw.includes('@')) {
    const [localPart] = raw.split('@');
    if (localPart?.trim()) return localPart.trim();
  }

  // Clean common technical prefixes
  const cleaned = raw
    .replace(/^standalone\./i, '')
    .replace(/^profile\./i, '')
    .replace(/^browser\./i, '')
    .trim();

  return cleaned || raw;
}

export function resolveProfileDisplayName(
  alias: string | null | undefined,
  explicitDisplayName?: string | null
): string {
  const explicit = (explicitDisplayName ?? '').trim();
  if (explicit) return explicit;
  return formatProfileAlias(alias);
}

export function formatProfileAliasOptionLabel(
  alias: string | null | undefined,
  explicitDisplayName?: string | null
): string {
  const raw = (alias ?? '').trim();
  const display = resolveProfileDisplayName(raw, explicitDisplayName);
  if (!raw || display === raw) return display;
  return `${display} (${raw})`;
}
