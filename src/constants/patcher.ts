export const IDE_CONFIG: Record<string, { gradient: string; label: string; iconType: string }> =
  {
    kiro: { iconType: 'Code2', gradient: 'from-purple-500 to-violet-600', label: 'Kiro' },
    windsurf: { iconType: 'Wind', gradient: 'from-teal-400 to-cyan-500', label: 'Windsurf' },
    trae: {
      iconType: 'Terminal',
      gradient: 'from-orange-500 to-amber-500',
      label: 'Trae',
    },
    vscode: { iconType: 'Code2', gradient: 'from-blue-500 to-blue-600', label: 'VS Code' },
    vscodium: {
      iconType: 'Code2',
      gradient: 'from-green-500 to-emerald-600',
      label: 'VSCodium',
    },
    other: {
      iconType: 'Terminal',
      gradient: 'from-slate-500 to-slate-600',
      label: 'Other',
    },
  };

export const PATCH_VERSIONS: Record<
  string,
  Array<{ id: string; label: string; description: string }>
> = {
  kiro: [
    { id: 'v4', label: 'v4', description: 'TokenType stripping + per-account Machine ID rotation (fixes "Too Many Requests")' },
  ],
  windsurf: [{ id: 'v1', label: 'v1', description: 'Standard patch' }],
  trae: [{ id: 'v1', label: 'v1', description: 'Pro features unlock' }],
};

export const PATCH_OPTIONS: Record<
  string,
  Array<{ id: string; labelKey: string; descKey: string; defaultEnabled: boolean }>
> = {
  kiro: [
    {
      id: 'proxyInjection',
      labelKey: 'patcher.proxyInjection',
      descKey: 'patcher.proxyInjectionDesc',
      defaultEnabled: true,
    },
  ],
  windsurf: [],
  trae: [
    {
      id: 'unlockPro',
      labelKey: 'patcher.unlockPro',
      descKey: 'patcher.unlockProDesc',
      defaultEnabled: true,
    },
    {
      id: 'removeWatermark',
      labelKey: 'patcher.removeWatermark',
      descKey: 'patcher.removeWatermarkDesc',
      defaultEnabled: false,
    },
  ],
};
