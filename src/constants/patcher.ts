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
    { id: 'v2', label: 'v2', description: 'Injection-based patch (stable)' },
    { id: 'v3', label: 'v3', description: 'Enhanced spoofing + injection' },
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
      id: 'machineIdSpoofing',
      labelKey: 'patcher.machineIdSpoofing',
      descKey: 'patcher.machineIdSpoofingDesc',
      defaultEnabled: true,
    },
    {
      id: 'telemetryBlocking',
      labelKey: 'patcher.blockTelemetry',
      descKey: 'patcher.blockTelemetryDesc',
      defaultEnabled: true,
    },
    {
      id: 'rateLimitBypass',
      labelKey: 'patcher.bypassRateLimits',
      descKey: 'patcher.bypassRateLimitsDesc',
      defaultEnabled: true,
    },
    {
      id: 'osSpoofing',
      labelKey: 'patcher.osSpoofing',
      descKey: 'patcher.osSpoofingDesc',
      defaultEnabled: true,
    },
    {
      id: 'commandSpoofing',
      labelKey: 'patcher.commandSpoofing',
      descKey: 'patcher.commandSpoofingDesc',
      defaultEnabled: true,
    },
    {
      id: 'constantPatching',
      labelKey: 'patcher.constantPatching',
      descKey: 'patcher.constantPatchingDesc',
      defaultEnabled: true,
    },
    {
      id: 'authWatcher',
      labelKey: 'patcher.authWatcher',
      descKey: 'patcher.authWatcherDesc',
      defaultEnabled: true,
    },
    {
      id: 'customPrompts',
      labelKey: 'patcher.customPrompts',
      descKey: 'patcher.customPromptsDesc',
      defaultEnabled: true,
    },
    {
      id: 'requestSpy',
      labelKey: 'patcher.requestSpy',
      descKey: 'patcher.requestSpyDesc',
      defaultEnabled: false,
    },
    {
      id: 'errorSuppression',
      labelKey: 'patcher.errorSuppression',
      descKey: 'patcher.errorSuppressionDesc',
      defaultEnabled: false,
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
