import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, LayoutGrid, ScrollText, Stethoscope } from 'lucide-react';
import { useUIState } from '@/hooks/useUIState';
import { Button, Checkbox, ConfirmDialog, Modal, SegmentedControl } from '@/components/ui';
import { t } from '@/lib/i18n';
import { getProfileSettings } from '@/lib/backend/modules/profiles';
import { useScenarioReplay } from '@/lib/scenarioRecorder/useScenarioReplay';
import { BrowserRuntimeInstallModal } from './BrowserRuntimeInstallModal';
import {
  listRecordedScenarios,
  markRecordedScenarioPlayed,
  replayPreflight,
  upsertRecordedScenario,
  reindexRecordedScenarios,
  type ReplayPreflightResult,
  type ScenarioRecordItem } from
'@/lib/backend/modules/pythonJobs';
import { copyToClipboard, openInFileManager } from '@/lib/backend/modules/utils';
import { buildRunnerConfigFromProfileSettings } from '@/lib/scenarioRecorder/configBuilder';
import { toast } from 'sonner';
import { formatProfileAlias } from '@/lib/profiles/displayName';
import { ReplayRuntimeBadge } from './replay/ReplayRuntimeBadge';
import { ReplayScenarioListPanel } from './replay/ReplayScenarioListPanel';
import { ReplayOverviewPanel } from './replay/ReplayOverviewPanel';
import { ReplayDiagnosticsPanel } from './replay/ReplayDiagnosticsPanel';
import { ReplayFooterActions } from './replay/ReplayFooterActions';
import { ReplayRunHistoryPanel } from './replay/ReplayRunHistoryPanel';
import { ReplayPresetsPanel } from './replay/ReplayPresetsPanel';
import { ReplayVersionPanel } from './replay/ReplayVersionPanel';
import {
  readReplayListPrefs,
  readReplayListQuery,
  writeReplayListPrefs,
  writeReplayListQuery,
  type ReplayListHealthFilter,
  type ReplayListSort } from
'@/lib/scenarioRecorder/replayListPreferences';
import {
  deriveFriendlyScenarioName,
  useReplayScenarioList } from
'@/lib/scenarioRecorder/useReplayScenarioList';
import {
  useReplayListNavigation,
  useReplayStartHotkey } from
'@/lib/scenarioRecorder/useReplayKeyboardShortcuts';
import { useExtensionBridgeProbe } from '@/lib/scenarioRecorder/useExtensionBridgeProbe';
import { useReplayRuntimeStatus } from '@/lib/scenarioRecorder/useReplayRuntimeStatus';
import { useReplayTimeline } from '@/lib/scenarioRecorder/useReplayTimeline';
import {
  useReplayRecentRuns,
  type ReplayRunStatusFilter } from
'@/lib/scenarioRecorder/useReplayRecentRuns';
import { useReplayPresets, type ReplayRunPreset } from '@/lib/scenarioRecorder/replayPresets';
import { useReplayVersioning } from '@/lib/scenarioRecorder/useReplayVersioning';
import type { ScenarioRunnerMode } from '@/lib/scenarioRecorder/types';

type ScenarioReplayModalProps = {
  alias: string | null;
  isOpen: boolean;
  onClose: () => void;
  defaultUrl?: string;
  defaultScenarioPath?: string;
  quickStart?: boolean;
};

function beep() {
  try {
    const AudioCtx =
    window.AudioContext ||
    (window as unknown as {webkitAudioContext?: typeof AudioContext;}).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.07;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    setTimeout(() => {
      void ctx.close();
    }, 280);
  } catch {

    // noop
  }}

export function ScenarioReplayModal({
  alias,
  isOpen,
  onClose,
  defaultUrl = 'https://google.com',
  defaultScenarioPath = '',
  quickStart = false
}: ScenarioReplayModalProps) {
  const replay = useScenarioReplay();
  const displayAlias = formatProfileAlias(alias);
  const [runtimeModalOpen, setRuntimeModalOpen] = useState(false);
  const [scenarioPath, setScenarioPath] = useState('');
  const scenarioPathTouchedRef = useRef(false);
  const [startUrl, setStartUrl] = useState(defaultUrl);
  const [configJson, setConfigJson] = useState<string>('');
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [continueOnError, setContinueOnError] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflight, setPreflight] = useState<ReplayPreflightResult | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [runnerMode, setRunnerMode] = useState<ScenarioRunnerMode>('native');
  const [runnerModeHydrated, setRunnerModeHydrated] = useState(false);
  const [engine, setEngine] = useState<'cloackbrowser'>('cloackbrowser');
  const [engineHydrated, setEngineHydrated] = useState(false);
  const [recentScenarioPaths, setRecentScenarioPaths] = useState<string[]>([]);
  const [indexedScenarios, setIndexedScenarios] = useState<ScenarioRecordItem[]>([]);
  const [indexedLoading, setIndexedLoading] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [scenarioQuery, setScenarioQuery] = useState<string>(() => readReplayListQuery(alias));
  const [scenarioSort, setScenarioSort] = useState<ReplayListSort>(() => {
    const prefs = readReplayListPrefs();
    return prefs.sort ?? 'recent';
  });
  const [scenarioHealthFilter, setScenarioHealthFilter] = useState<ReplayListHealthFilter>(() => {
    const prefs = readReplayListPrefs();
    return prefs.healthFilter ?? 'all';
  });
  const [scenarioCompactMode, setScenarioCompactMode] = useState<boolean>(() => {
    const prefs = readReplayListPrefs();
    return prefs.compact ?? false;
  });
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [retryFromFailedStep, setRetryFromFailedStep] = useState(false);
  const [explicitRetryStep, setExplicitRetryStep] = useState<number | null>(null);
  const [selectedVersionNo, setSelectedVersionNo] = useState<number | null>(null);
  const [runStatusFilter, setRunStatusFilter] = useState<ReplayRunStatusFilter>('all');
  const [presetToDelete, setPresetToDelete] = useState<ReplayRunPreset | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [activeTab, setActiveTab] = useUIState<'overview' | 'details' | 'diagnostics'>(
    'scenario-replay-active-tab',
    'overview',
    'session'
  );
  const announcedPauseRef = useRef(false);
  const runnerModePrefKey = useMemo(() => `stitch.replay.runnerMode.${alias || 'global'}`, [alias]);
  const enginePrefKey = useMemo(() => `stitch.replay.engine.${alias || 'global'}`, [alias]);
  const isNativeRunner = runnerMode === 'native';
  const extensionBridge = useExtensionBridgeProbe({
    isOpen,
    runnerMode
  });

  const { runtimeInstalled, runtimeCheckError, runtimeChecking, refreshRuntime } =
  useReplayRuntimeStatus({ isOpen });
  const { timelineEntries, timelineLoading } = useReplayTimeline({
    isOpen,
    correlationId: replay.state.correlationId,
    jobId: replay.state.jobId
  });
  const {
    scenarioRuns,
    lastSuccess,
    lastSuccessOverall,
    loading: runsLoading,
    error: runsError
  } = useReplayRecentRuns({
    alias,
    scenarioPath,
    isOpen
  });
  const { presets, savePreset, renamePreset, deletePreset, markPresetUsed } = useReplayPresets({
    alias
  });
  const selectedScenarioItem = useMemo(() => {
    const selected = scenarioPath.trim();
    if (!selected) return null;
    return indexedScenarios.find((item) => item.scenarioPath === selected) ?? null;
  }, [indexedScenarios, scenarioPath]);
  const {
    loading: versionsLoading,
    error: versionsError,
    versions,
    selectVersion,
    rollback,
    rollbackLoading
  } = useReplayVersioning({
    scenario: selectedScenarioItem,
    isOpen
  });

  const deriveScenarioNameFromPath = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return t('recorder.replay.defaultScenarioName');
    const normalized = trimmed.replace(/\\/g, '/');
    const file = normalized.split('/').pop() || 'scenario.json';
    return file.replace(/\.json$/i, '') || t('recorder.replay.defaultScenarioName');
  }, []);

  const refreshIndexedScenarios = useCallback(async () => {
    if (!alias) {
      setIndexedScenarios([]);
      return;
    }

    setIndexedLoading(true);
    setIndexError(null);
    try {
      const indexed = await listRecordedScenarios({ alias, limit: 50 });
      setIndexedScenarios(indexed);
    } catch (e) {
      setIndexedScenarios([]);
      setIndexError(e instanceof Error ? e.message : 'Failed to load saved scenarios');
    } finally {
      setIndexedLoading(false);
    }
  }, [alias]);

  const seedCurrentScenarioIntoIndex = useCallback(async () => {
    if (!alias) return;
    const path = scenarioPath.trim();
    if (!path) return;

    try {
      await upsertRecordedScenario({
        alias,
        name: deriveScenarioNameFromPath(path),
        scenarioPath: path,
        startedUrl: startUrl
      });
      await refreshIndexedScenarios();
      toast.success(t('recorder.replay.currentAdded'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('recorder.replay.seedFailed'));
    }
  }, [alias, deriveScenarioNameFromPath, refreshIndexedScenarios, scenarioPath, startUrl]);

  const runReindex = useCallback(async () => {
    if (!alias) return;
    setReindexing(true);
    try {
      const result = await reindexRecordedScenarios({ alias });
      await refreshIndexedScenarios();
      toast.success(
        t('recorder.replay.reindexSuccess', {
          indexed: result.indexed,
          scanned: result.scannedFiles
        })
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('recorder.replay.reindexFailed'));
    } finally {
      setReindexing(false);
    }
  }, [alias, refreshIndexedScenarios]);

  useEffect(() => {
    if (!isOpen) {
      setAutoStarted(false);
      setPreflight(null);
      setShowAdvanced(false);
      setRecentScenarioPaths([]);
      setRetryFromFailedStep(false);
      setExplicitRetryStep(null);
      setSelectedVersionNo(null);
      setSelectedTags([]);
      setRunStatusFilter('all');
      setPresetToDelete(null);
      setEngineHydrated(false);
      scenarioPathTouchedRef.current = false;
      return;
    }
    setStartUrl(defaultUrl);
    setScenarioPath(defaultScenarioPath?.trim() ?? '');
    scenarioPathTouchedRef.current = Boolean(defaultScenarioPath?.trim());
    setAutoStarted(false);
  }, [defaultScenarioPath, defaultUrl, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    try {
      const raw = localStorage.getItem(runnerModePrefKey);
      setRunnerMode(raw === 'extension' ? 'extension' : 'native');
      setRunnerModeHydrated(true);
    } catch {
      setRunnerMode('native');
      setRunnerModeHydrated(true);
    }
  }, [isOpen, runnerModePrefKey]);

  useEffect(() => {
    if (!isOpen) {
      setRunnerModeHydrated(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    try {
      localStorage.setItem(runnerModePrefKey, runnerMode);
    } catch {

      // best effort only
    }}, [isOpen, runnerMode, runnerModePrefKey]);

  // Engine preference (cloackbrowser only)
  useEffect(() => {
    if (!isOpen) return;
    try {
      setEngine('cloackbrowser');
      setEngineHydrated(true);
    } catch {
      setEngine('cloackbrowser');
      setEngineHydrated(true);
    }
  }, [isOpen, enginePrefKey]);

  useEffect(() => {
    if (!isOpen) {
      setEngineHydrated(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    try {
      localStorage.setItem(enginePrefKey, engine);
    } catch {

      // best effort only
    }}, [isOpen, engine, enginePrefKey]);

  useEffect(() => {
    if (!isOpen || !scenarioPath.trim()) {
      setPreflight(null);
      return;
    }

    let cancelled = false;
    const run = async () => {
      setPreflightLoading(true);
      try {
        const result = await replayPreflight(scenarioPath.trim());
        if (!cancelled) setPreflight(result);
      } catch {
        if (!cancelled) {
          setPreflight({
            valid: false,
            totalSteps: 0,
            droppedSteps: 0,
            issues: [{ index: 0, reason: t('recorder.replay.invalidScenarioFile') }],
            healthScore: 0,
            healthNotes: [t('recorder.replay.cannotParseScenario')]
          });
        }
      } finally {
        if (!cancelled) setPreflightLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [isOpen, scenarioPath]);

  useEffect(() => {
    if (!isOpen || !alias) return;

    let cancelled = false;
    const load = async () => {
      setLoadingSettings(true);
      try {
        const record = await getProfileSettings({ alias });
        if (cancelled) return;

        const built = await buildRunnerConfigFromProfileSettings(record, {
          defaultUrl,
          fallbackUrl: 'https://google.com',
          engine
        });

        setConfigJson(built.configJson);
        setStartUrl(built.startUrl);

        const profileEngine = record?.settings?.engine;
        if (profileEngine === 'cloackbrowser') {
          setEngine(profileEngine);
        }

        if (!scenarioPathTouchedRef.current) {
          const explicit = defaultScenarioPath?.trim() || '';
          const currentScenario = explicit || built.lastScenarioPath || '';
          setScenarioPath(currentScenario);
          scenarioPathTouchedRef.current = Boolean(currentScenario.trim());
        }

        const recent = [
        built.lastScenarioPath,
        defaultScenarioPath?.trim() || null,
        record?.settings?.storage?.lastScenarioPath?.trim() || null].
        filter((value): value is string => Boolean(value && value.trim()));
        setRecentScenarioPaths(Array.from(new Set(recent)));

        await refreshIndexedScenarios();
      } catch {
        if (cancelled) return;
        setConfigJson('');
      } finally {
        if (!cancelled) setLoadingSettings(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [alias, defaultScenarioPath, defaultUrl, engine, isOpen, refreshIndexedScenarios]);

  useEffect(() => {
    if (!isOpen) return;
    setScenarioQuery(readReplayListQuery(alias));
  }, [alias, isOpen]);

  useEffect(() => {
    if (replay.state.status === 'manual_pause') {
      if (!announcedPauseRef.current) {
        beep();
        announcedPauseRef.current = true;
      }
      const timer = window.setInterval(() => beep(), 8000);
      return () => window.clearInterval(timer);
    }
    announcedPauseRef.current = false;
    return;
  }, [replay.state.status]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const payload = {
      sort: scenarioSort,
      compact: scenarioCompactMode,
      healthFilter: scenarioHealthFilter
    };
    writeReplayListPrefs(payload);
  }, [scenarioSort, scenarioCompactMode, scenarioHealthFilter]);

  useEffect(() => {
    writeReplayListQuery(alias, scenarioQuery);
  }, [alias, scenarioQuery]);

  const canStart = useMemo(() => {
    return Boolean(alias) && scenarioPath.trim().length > 0;
  }, [alias, scenarioPath]);

  const canStartByActionState = useMemo(() => {
    return (
      canStart && (
      isNativeRunner ? preflight?.valid !== false : true) && (
      !isNativeRunner || runtimeInstalled !== false) && (
      isNativeRunner || extensionBridge.state.connected === true) &&
      replay.state.status !== 'starting' &&
      replay.state.status !== 'running');

  }, [
  canStart,
  extensionBridge.state.connected,
  isNativeRunner,
  preflight?.valid,
  replay.state.status,
  runtimeInstalled]
  );

  const startBlockedReason = useMemo(() => {
    if (!alias) return t('recorder.replay.reasonMissingProfile');
    if (!scenarioPath.trim()) return t('recorder.replay.reasonMissingScenario');
    if (isNativeRunner && runtimeInstalled === false)
    return t('recorder.replay.reasonRuntimeMissing');
    if (!isNativeRunner && extensionBridge.state.connected === false)
    return `${t('recorder.extensionBridgeStatusLabel')}: ${t('recorder.extensionBridgeDisconnected')}`;
    if (isNativeRunner && preflight?.valid === false)
    return t('recorder.replay.reasonInvalidPreflight');
    if (replay.state.status === 'starting' || replay.state.status === 'running') {
      return t('recorder.replay.reasonAlreadyRunning');
    }
    return null;
  }, [
  alias,
  isNativeRunner,
  scenarioPath,
  runtimeInstalled,
  extensionBridge.state.connected,
  preflight?.valid,
  replay.state.status]
  );

  const startReplayWithValues = useCallback(
    async (values: {
      scenarioPath: string;
      startUrl: string;
      configJson: string;
      continueOnError: boolean;
      fromStep?: number;
    }) => {
      if (!alias) return;

      const nextScenarioPath = values.scenarioPath;
      const nextStartUrl = values.startUrl;
      const nextConfigJson = values.configJson;
      const nextContinueOnError = values.continueOnError;

      await replay.start({
        alias,
        scenarioPath: nextScenarioPath,
        fromStep: values.fromStep,
        startUrl: nextStartUrl,
        configJson: nextConfigJson,
        continueOnError: nextContinueOnError,
        runnerMode,
        engine
      });

      void markRecordedScenarioPlayed({ scenarioPath: nextScenarioPath }).catch(() => {

        // best effort
      });},
    [alias, replay, runnerMode, engine]
  );

  const startReplay = useCallback(async () => {
    const fallbackFailedStep = replay.state.stepEvents.find(
      (entry) => entry.status === 'fail'
    )?.index;
    const explicitStep = explicitRetryStep && explicitRetryStep > 1 ? explicitRetryStep : undefined;
    const fromStep =
    explicitStep ?? (
    retryFromFailedStep && fallbackFailedStep && fallbackFailedStep > 1 ?
    fallbackFailedStep :
    undefined);

    await startReplayWithValues({
      scenarioPath,
      fromStep,
      startUrl,
      configJson,
      continueOnError
    });
  }, [
  configJson,
  continueOnError,
  explicitRetryStep,
  replay.state.stepEvents,
  retryFromFailedStep,
  scenarioPath,
  startReplayWithValues,
  startUrl]
  );

  const selectScenarioPath = useCallback((value: string) => {
    scenarioPathTouchedRef.current = true;
    setScenarioPath(value);
  }, []);

  const runQuickStart = useCallback(async () => {
    const target = lastSuccess ?? lastSuccessOverall;
    if (!target?.scenarioPath || !alias) return;
    scenarioPathTouchedRef.current = true;
    setScenarioPath(target.scenarioPath);

    if (target.startedUrl?.trim()) {
      setStartUrl(target.startedUrl.trim());
    }

    await startReplayWithValues({
      scenarioPath: target.scenarioPath,
      startUrl: target.startedUrl?.trim() || startUrl,
      configJson,
      continueOnError
    });
  }, [
  alias,
  configJson,
  continueOnError,
  lastSuccess,
  lastSuccessOverall,
  startReplayWithValues,
  startUrl]
  );

  const applyPreset = useCallback((preset: ReplayRunPreset) => {
    scenarioPathTouchedRef.current = true;
    setScenarioPath(preset.scenarioPath);
    setStartUrl(preset.startUrl);
    setConfigJson(preset.configJson);
    setContinueOnError(preset.continueOnError);
  }, []);

  const applyAndRunPreset = useCallback(
    async (preset: ReplayRunPreset) => {
      applyPreset(preset);
      markPresetUsed(preset.id);
      await startReplayWithValues({
        scenarioPath: preset.scenarioPath,
        startUrl: preset.startUrl,
        configJson: preset.configJson,
        continueOnError: preset.continueOnError
      });
    },
    [applyPreset, markPresetUsed, startReplayWithValues]
  );

  const saveCurrentAsPreset = useCallback(
    (name: string) => {
      try {
        savePreset(name, {
          scenarioPath,
          startUrl,
          configJson,
          continueOnError
        });
        toast.success(t('recorder.replay.presetSaved'));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('recorder.replay.presetSaveFailed'));
      }
    },
    [configJson, continueOnError, savePreset, scenarioPath, startUrl]
  );

  useEffect(() => {
    if (!quickStart || autoStarted) return;
    if (!isOpen || !alias) return;
    if (!canStart) return;
    if (!runnerModeHydrated) return;
    if (!engineHydrated) return;
    if (isNativeRunner && runtimeInstalled !== true) return;
    if (!isNativeRunner && extensionBridge.state.connected !== true) return;
    if (replay.state.status !== 'idle') return;

    setAutoStarted(true);
    void startReplay();
  }, [
  alias,
  autoStarted,
  canStart,
  isOpen,
  isNativeRunner,
  extensionBridge.state.connected,
  runnerModeHydrated,
  engineHydrated,
  quickStart,
  replay.state.status,
  runtimeInstalled,
  startReplay]
  );

  const progressLabel = useMemo(() => {
    if (!replay.state.totalSteps) return t('recorder.replay.progressEmpty');
    return `${replay.state.currentStep}/${replay.state.totalSteps}`;
  }, [replay.state.currentStep, replay.state.totalSteps]);

  const lastFailedStep = useMemo(() => {
    return replay.state.stepEvents.find((entry) => entry.status === 'fail') ?? null;
  }, [replay.state.stepEvents]);

  const hasDiagnosticsPaths = Boolean(replay.state.reportPath || replay.state.artifactsDir);
  const selectedVersionResolved = useMemo(
    () => selectedVersionNo != null ? selectVersion(selectedVersionNo) : null,
    [selectVersion, selectedVersionNo]
  );

  const { displayItems: displayIndexedScenarios, selectedPinned: selectedScenarioPinned } =
  useReplayScenarioList({
    items: indexedScenarios,
    query: scenarioQuery,
    selectedTags,
    healthFilter: scenarioHealthFilter,
    sortBy: scenarioSort,
    selectedPath: scenarioPath
  });

  useReplayStartHotkey({
    isOpen,
    canStart: canStartByActionState,
    onStart: () => {
      void startReplay();
    }
  });

  useReplayListNavigation({
    isOpen,
    items: displayIndexedScenarios,
    selectedPath: scenarioPath,
    onSelectPath: selectScenarioPath
  });

  const formatScenarioName = useCallback(
    (item: ScenarioRecordItem) =>
    deriveFriendlyScenarioName(item, {
      deriveScenarioNameFromPath,
      defaultScenarioName: t('recorder.replay.defaultScenarioName'),
      scenarioLabel: t('recorder.replay.scenarioLabel')
    }),
    [deriveScenarioNameFromPath]
  );

  const tagOptions = useMemo(() => {
    const set = new Set<string>();
    for (const item of indexedScenarios) {
      for (const tag of item.metadata?.tags ?? []) {
        const normalized = tag.trim().toLowerCase();
        if (normalized) set.add(normalized);
      }
    }
    return Array.from(set).
    sort((a, b) => a.localeCompare(b)).
    map((tag) => ({ value: tag, label: tag }));
  }, [indexedScenarios]);

  const quickRunTarget = lastSuccess ?? lastSuccessOverall;

  const manualPauseHint = useMemo(() => {
    if (replay.state.status !== 'manual_pause') return null;
    return replay.state.manualPauseReason ?
    t('recorder.replay.manualPauseReason', { reason: replay.state.manualPauseReason }) :
    t('recorder.replay.manualPauseNeedsAction');
  }, [replay.state.manualPauseReason, replay.state.status]);

  const statusCopy = useMemo(() => {
    switch (replay.state.status) {
      case 'starting':
        return t('recorder.replay.statusStarting');
      case 'running':
        return t('recorder.replay.statusRunning');
      case 'manual_pause':
        return t('recorder.replay.statusManualPause');
      case 'stopping':
        return t('recorder.replay.statusStopping');
      case 'done':
        return t('recorder.replay.statusDone');
      case 'error':
        return t('recorder.replay.statusError');
      default:
        return t('recorder.replay.statusIdle');
    }
  }, [replay.state.status]);

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={t('common.replay')}
        size="xl"
        stickyFooter
        footer={
        <ReplayFooterActions
          showRuntimeActions={isNativeRunner}
          extensionBridgeConnected={
          isNativeRunner ? true : extensionBridge.state.connected === true
          }
          canStart={canStart}
          preflightInvalid={isNativeRunner && preflight?.valid === false}
          startBlockedReason={startBlockedReason}
          runtimeInstalled={runtimeInstalled}
          status={replay.state.status}
          hasJob={Boolean(replay.state.jobId)}
          quickRunEnabled={
          Boolean(quickRunTarget) && (
          !isNativeRunner || runtimeInstalled !== false) && (
          isNativeRunner || extensionBridge.state.connected === true) &&
          replay.state.status === 'idle'
          }
          quickRunLabel={
          quickRunTarget?.startedAt ?
          new Date(quickRunTarget.startedAt * 1000).toLocaleString() :
          null
          }
          onResume={() => void replay.sendControl('resume')}
          onAbort={() => void replay.sendControl('abort')}
          onStop={() => void replay.stop()}
          onStart={() => void startReplay()}
          onQuickRun={() => void runQuickStart()}
          onInstallRuntime={() => setRuntimeModalOpen(true)}
          onClose={onClose} />

        }>

        <div className="space-y-4">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            {t('recorder.proxySwitchRestartWarningReplay')}
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs text-slate-400">{t('recorder.replay.profile')}</div>
                <div className="text-sm text-slate-200 truncate">{displayAlias}</div>
                {alias && displayAlias !== alias ?
                <div className="text-[11px] text-slate-500 truncate font-mono">{alias}</div> :
                null}
              </div>
              <div className="flex items-center gap-3">
                <ReplayRuntimeBadge runtimeInstalled={runtimeInstalled} mode={runnerMode} />
                <div className="text-xs text-slate-400">
                  {t('recorder.replay.statusLabel')}:{' '}
                  <span className="text-slate-200">{statusCopy}</span>
                </div>
              </div>
            </div>
            {manualPauseHint ?
            <div className="mt-2 text-xs text-amber-300">{manualPauseHint}</div> :
            null}
            {!isNativeRunner ?
            <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs">
                <div className="text-cyan-100">
                  {t('recorder.extensionBridgeStatusLabel')}:&nbsp;
                  {extensionBridge.state.checking && extensionBridge.state.connected == null ?
                t('recorder.extensionBridgeChecking') :
                extensionBridge.state.connected ?
                t('recorder.extensionBridgeConnected') :
                t('recorder.extensionBridgeDisconnected')}
                </div>
                <div className="flex items-center gap-2">
                  {extensionBridge.state.error ?
                <span
                  className="text-[11px] text-red-200 max-w-[360px] truncate"
                  title={extensionBridge.state.error}>

                      {extensionBridge.state.error}
                    </span> :
                null}
                  <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => void extensionBridge.refresh()}
                  disabled={extensionBridge.state.checking}
                  className="text-[11px] rounded border border-white/20 px-2 py-1 text-slate-100 hover:bg-white/10 disabled:opacity-60">

                    {t('recorder.extensionBridgeRefresh')}
                  </Button>
                </div>
              </div> :
            null}
          </div>

          <div className="flex flex-col gap-2">
            <SegmentedControl
              size="sm"
              value={runnerMode}
              onChange={(value) => setRunnerMode(value as ScenarioRunnerMode)}
              options={[
              { label: 'Native runner', value: 'native' },
              { label: 'Extension runner', value: 'extension' }]
              } />

            {runnerMode === 'native' ?
            <div className="text-[11px] text-slate-400 rounded-md border border-white/10 bg-black/20 px-3 py-2">{t("recorder.scenario_replay_modal.engine_cloakbrowser")}

            </div> :
            null}
          </div>
          {runnerMode === 'extension' ?
          <div className="text-[11px] text-cyan-200/90 rounded-md border border-cyan-500/20 bg-cyan-500/10 px-3 py-2">
              {t('recorder.extensionRunnerBridgeHint')}
            </div> :
          null}

          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
            <div className="space-y-4">
              <ReplayScenarioListPanel
                alias={alias}
                items={indexedScenarios}
                loading={indexedLoading}
                error={indexError}
                query={scenarioQuery}
                onQueryChange={setScenarioQuery}
                sortBy={scenarioSort}
                onSortChange={setScenarioSort}
                healthFilter={scenarioHealthFilter}
                onHealthFilterChange={setScenarioHealthFilter}
                compactMode={scenarioCompactMode}
                onCompactModeChange={setScenarioCompactMode}
                tagOptions={tagOptions}
                selectedTags={selectedTags}
                onSelectedTagsChange={setSelectedTags}
                filteredItems={displayIndexedScenarios}
                selectedPath={scenarioPath}
                selectedPinned={selectedScenarioPinned}
                onSelectPath={selectScenarioPath}
                recentScenarioPaths={recentScenarioPaths}
                scenarioPathEmpty={!scenarioPath.trim()}
                onRefresh={() => void refreshIndexedScenarios()}
                onSeedCurrent={() => void seedCurrentScenarioIntoIndex()}
                onReindex={() => void runReindex()}
                reindexing={reindexing}
                formatScenarioName={formatScenarioName} />

            </div>

            <div className="space-y-3">
              <SegmentedControl
                size="sm"
                value={activeTab}
                onChange={(value) => setActiveTab(value as typeof activeTab)}
                options={[
                {
                  label: t('recorder.replay.tabOverview'),
                  value: 'overview',
                  icon: <LayoutGrid size={14} />
                },
                {
                  label: t('recorder.replay.tabDetails'),
                  value: 'details',
                  icon: <ScrollText size={14} />
                },
                {
                  label: t('recorder.replay.tabDiagnostics'),
                  value: 'diagnostics',
                  icon: <Stethoscope size={14} />
                }]
                } />


              {activeTab === 'overview' &&
              <div className="space-y-3">
                  <ReplayOverviewPanel
                  scenarioPath={scenarioPath}
                  onScenarioPathChange={(value) => {
                    scenarioPathTouchedRef.current = true;
                    setScenarioPath(value);
                  }}
                  preflight={preflight}
                  preflightLoading={isNativeRunner ? preflightLoading : false}
                  loadingSettings={loadingSettings}
                  configJson={configJson}
                  onConfigJsonChange={setConfigJson}
                  startUrl={startUrl}
                  onStartUrlChange={setStartUrl}
                  continueOnError={continueOnError}
                  onContinueOnErrorChange={setContinueOnError}
                  runtimeInstalled={isNativeRunner ? runtimeInstalled : true}
                  runtimeCheckError={isNativeRunner ? runtimeCheckError : null}
                  status={replay.state.status}
                  progressLabel={progressLabel}
                  manualPauseReason={replay.state.manualPauseReason}
                  runtimeChecking={isNativeRunner ? runtimeChecking : false}
                  onRefreshRuntime={refreshRuntime}
                  runnerMode={runnerMode} />

                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <Checkbox
                        label={t('recorder.replay.retryFromFailedStep')}
                        checked={retryFromFailedStep}
                        onChange={(e) => setRetryFromFailedStep(e.target.checked)}
                        className="text-xs text-slate-300"
                      />
                      <Button
                      size="xs"
                      variant="ghost"
                      className="text-xs text-indigo-300 hover:text-indigo-200 disabled:text-slate-500"
                      disabled={!lastFailedStep?.index || lastFailedStep.index <= 1}
                      onClick={() => {
                        if (!lastFailedStep?.index || lastFailedStep.index <= 1) return;
                        setExplicitRetryStep(lastFailedStep.index);
                      }}>

                        {lastFailedStep?.index && lastFailedStep.index > 1 ?
                      t('recorder.replay.retryFromStepAction', { step: lastFailedStep.index }) :
                      t('recorder.replay.retryFromStepUnavailable')}
                      </Button>
                    </div>
                    {explicitRetryStep ?
                  <div className="mt-2 text-[11px] text-indigo-300">
                        {t('recorder.replay.retryFromStepSelected', { step: explicitRetryStep })}
                      </div> :
                  null}
                  </div>
                  <ReplayVersionPanel
                  loading={versionsLoading}
                  error={versionsError}
                  versions={versions}
                  selectedVersionNo={selectedVersionNo}
                  onSelectedVersionNoChange={setSelectedVersionNo}
                  rollbackLoading={rollbackLoading}
                  runSelectedLoading={replay.state.status === 'starting'}
                  selectedVersionHasRunnablePath={Boolean(selectedVersionResolved?.scenarioPath)}
                  onRollbackSelected={() => {
                    if (!selectedVersionNo) return;
                    void rollback(selectedVersionNo).
                    then((updated) => {
                      if (!updated) return;
                      scenarioPathTouchedRef.current = true;
                      setScenarioPath(updated.scenarioPath);
                      setSelectedVersionNo(updated.activeVersion ?? selectedVersionNo);
                      toast.success(t('common.saved'));
                    }).
                    catch((e) => {
                      toast.error(e instanceof Error ? e.message : t('common.error'));
                    });
                  }}
                  onRunSelected={() => {
                    if (!selectedVersionResolved?.scenarioPath) return;
                    scenarioPathTouchedRef.current = true;
                    setScenarioPath(selectedVersionResolved.scenarioPath);
                    if (selectedVersionResolved.startedUrl) {
                      setStartUrl(selectedVersionResolved.startedUrl);
                    }
                    void startReplayWithValues({
                      scenarioPath: selectedVersionResolved.scenarioPath,
                      startUrl: selectedVersionResolved.startedUrl || startUrl,
                      configJson,
                      continueOnError
                    });
                  }} />

                  <ReplayPresetsPanel
                  presets={presets}
                  canSavePreset={Boolean(alias) && Boolean(scenarioPath.trim())}
                  onSavePreset={saveCurrentAsPreset}
                  onApplyPreset={(preset) => {
                    markPresetUsed(preset.id);
                    applyPreset(preset);
                  }}
                  onApplyAndRunPreset={(preset) => {
                    void applyAndRunPreset(preset);
                  }}
                  onRenamePreset={(presetId, name) => {
                    try {
                      renamePreset(presetId, name);
                      toast.success(t('common.saved'));
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : t('common.error'));
                    }
                  }}
                  onRequestDeletePreset={(preset) => {
                    setPresetToDelete(preset);
                  }} />

                  <ReplayRunHistoryPanel
                  loading={runsLoading}
                  error={runsError}
                  runs={scenarioRuns}
                  statusFilter={runStatusFilter}
                  onStatusFilterChange={setRunStatusFilter}
                  onOpenRun={(run) => {
                    if (run.scenarioPath) {
                      scenarioPathTouchedRef.current = true;
                      setScenarioPath(run.scenarioPath);
                    }
                    if (run.startedUrl?.trim()) {
                      setStartUrl(run.startedUrl.trim());
                    }
                    if (run.reportPath) {
                      void openInFileManager({ path: run.reportPath }).catch(() => {
                        toast.error(t('recorder.replay.openReportFolderFailed'));
                      });
                    }
                  }} />

                </div>
              }

              {activeTab === 'details' &&
              <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-3">
                  <div>
                    <div className="text-xs text-slate-400">
                      {t('recorder.replay.selectedScenario')}
                    </div>
                    <div className="text-sm text-slate-200">
                      {deriveScenarioNameFromPath(scenarioPath)}
                    </div>
                    {scenarioPath ?
                  <div className="text-[11px] text-slate-500 font-mono break-all">
                        {scenarioPath}
                      </div> :

                  <div className="text-[11px] text-slate-500">
                        {t('recorder.replay.noScenarioLoaded')}
                      </div>
                  }
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-slate-400">{t('recorder.replay.stepsLabel')}</div>
                        <div className="text-slate-200">{preflight?.totalSteps ?? '—'}</div>
                      </div>
                      <div>
                        <div className="text-slate-400">
                          {t('recorder.replay.healthScoreLabel')}
                        </div>
                        <div className="text-slate-200">{preflight?.healthScore ?? '—'}</div>
                      </div>
                      <div>
                        <div className="text-slate-400">{t('recorder.replay.lastEvent')}</div>
                        <div className="text-slate-200 truncate">
                          {replay.state.lastEvent ?? '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400">{t('recorder.replay.progressLabel')}</div>
                        <div className="text-slate-200">{progressLabel}</div>
                      </div>
                    </div>
                  </div>
                </div>
              }

              {activeTab === 'diagnostics' &&
              <ReplayDiagnosticsPanel
                status={replay.state.status}
                progressLabel={progressLabel}
                manualPauseReason={replay.state.manualPauseReason}
                runtimeInstalled={runtimeInstalled}
                runtimeCheckError={runtimeCheckError}
                runtimeChecking={runtimeChecking}
                onRefreshRuntime={refreshRuntime}
                runnerMode={runnerMode}
                configJson={configJson}
                onConfigJsonChange={setConfigJson}
                loadingSettings={loadingSettings}
                stderr={replay.state.stderr}
                lastFailedStep={lastFailedStep}
                error={replay.state.error}
                reportPath={replay.state.reportPath}
                hasDiagnosticsPaths={hasDiagnosticsPaths}
                onCopyReportPath={async () => {
                  try {
                    await copyToClipboard({ text: replay.state.reportPath ?? '' });
                    toast.success(t('recorder.replay.reportPathCopied'));
                  } catch {
                    toast.error(t('recorder.replay.reportPathCopyFailed'));
                  }
                }}
                onOpenReportFolder={async () => {
                  try {
                    await openInFileManager({ path: replay.state.reportPath ?? '' });
                  } catch (e) {
                    toast.error(
                      e instanceof Error ? e.message : t('recorder.replay.openReportFolderFailed')
                    );
                  }
                }}
                timelineEntries={timelineEntries}
                timelineLoading={timelineLoading} />

              }

              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="w-full flex items-center justify-between text-xs text-slate-400 cursor-pointer"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowAdvanced((v) => !v); }}}>

                  <span>{t('recorder.replay.advancedToggle')}</span>
                  {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>

                {showAdvanced &&
                <div className="mt-3 text-xs text-slate-400 space-y-2 border-t border-white/10 pt-3">
                    <div className="flex items-center justify-between">
                      <span>{t('recorder.replay.jobId')}</span>
                      <span className="text-slate-200 font-mono break-all">
                        {replay.state.jobId ?? '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>{t('recorder.replay.correlationId')}</span>
                      <span className="text-slate-200 font-mono break-all">
                        {replay.state.correlationId}
                      </span>
                    </div>
                  </div>
                }
              </div>
            </div>
          </div>

          {isNativeRunner ?
          <BrowserRuntimeInstallModal
            isOpen={runtimeModalOpen}
            onClose={() => setRuntimeModalOpen(false)} /> :

          null}
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(presetToDelete)}
        onClose={() => setPresetToDelete(null)}
        onConfirm={() => {
          if (!presetToDelete) return;
          deletePreset(presetToDelete.id);
          toast.success(t('common.saved'));
          setPresetToDelete(null);
        }}
        title={t('recorder.replay.presetDeleteTitle')}
        message={
        presetToDelete ?
        t('recorder.replay.presetDeleteMessage', { name: presetToDelete.name }) :
        ''
        }
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        variant="danger" />

    </>);

}