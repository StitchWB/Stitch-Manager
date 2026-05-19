import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FolderKanban, RefreshCw } from 'lucide-react';
import Header from '../components/layout/Header';

import { t } from '../lib/i18n';
import { listFingerprintProfiles, getProfileSettings } from '@/lib/tauri/modules/profiles';
import { formatProfileAlias } from '@/lib/profiles/displayName';
import { ScenarioRecordModal } from '@/components/scenarioRecorder/ScenarioRecordModal';
import { ScenarioReplayModal } from '@/components/scenarioRecorder/ScenarioReplayModal';
import { ProfileScenariosPanel } from '@/components/scenarioRecorder/ProfileScenariosPanel';
import { ComposedFlowModal } from '@/components/scenarioRecorder/ComposedFlowModal';
import { Button, EmptyState, Select } from '@/components/ui';
import { useUIState } from '../hooks/useUIState';

const DEFAULT_START_URL = 'https://google.com';

interface ScenariosProps {
  /**
   * When true, the page-level Header is suppressed so the component can be
   * embedded inside another shell (e.g. /automation tab strip). The default
   * `false` preserves the standalone /scenarios behavior.
   */
  embedded?: boolean;
}

export default function Scenarios({ embedded = false }: ScenariosProps = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profileAliases, setProfileAliases] = useState<string[]>([]);
  const [activeRecordAlias, setActiveRecordAlias] = useUIState(
    'scenarios-active-record-alias',
    null as string | null,
    'session'
  );
  const [activeRecordMeta, setActiveRecordMeta] = useUIState(
    'scenarios-active-record-meta',
    null as { alias: string; scenarioName: string; startUrl: string } | null,
    'session'
  );
  const [replayAlias, setReplayAlias] = useUIState(
    'scenarios-replay-alias',
    null as string | null,
    'session'
  );
  const [replayInitialScenarioPath, setReplayInitialScenarioPath] = useUIState(
    'scenarios-replay-path',
    null as string | null,
    'session'
  );
  const [composedFlowAlias, setComposedFlowAlias] = useUIState(
    'scenarios-composed-flow-alias',
    null as string | null,
    'session'
  );

  const queryAlias = useMemo(() => searchParams.get('alias')?.trim() || '', [searchParams]);
  const queryOpenCompose = useMemo(() => searchParams.get('openCompose') === '1', [searchParams]);
  const selectedAlias = queryAlias;

  const loadProfiles = useCallback(async () => {
    setProfilesLoading(true);
    try {
      const aliases = await listFingerprintProfiles();
      setProfileAliases(aliases);
    } catch (error) {
      console.error('[Scenarios] Failed to list fingerprint profiles:', error);
    } finally {
      setProfilesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (!queryOpenCompose) return;
    if (!queryAlias) return;

    setComposedFlowAlias(queryAlias);

    const params = new URLSearchParams(searchParams);
    params.delete('openCompose');
    setSearchParams(params, { replace: true });
  }, [queryOpenCompose, queryAlias, searchParams, setSearchParams, setComposedFlowAlias]);

  const aliasOptions = useMemo(() => {
    const toLabel = (alias: string) => formatProfileAlias(alias);
    const base = profileAliases.map(alias => ({ value: alias, label: toLabel(alias) }));
    const hasSelected = selectedAlias && !profileAliases.includes(selectedAlias);
    const merged = hasSelected
      ? [
          {
            value: selectedAlias,
            label: `${toLabel(selectedAlias)} (${t('scenarios.missingProfile')})`,
          },
          ...base,
        ]
      : base;

    return [
      {
        value: '',
        label: profileAliases.length ? t('scenarios.selectProfile') : t('scenarios.noProfiles'),
        disabled: profileAliases.length === 0,
      },
      ...merged,
    ];
  }, [profileAliases, selectedAlias]);

  const buildScenarioName = useCallback((alias: string) => {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
      now.getHours()
    )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const safeAlias = alias.replace(/[^a-zA-Z0-9._-]+/g, '_');
    return `rec_${safeAlias}_${ts}`;
  }, []);

  const openRecordModal = useCallback(
    (alias: string) => {
      setReplayAlias(null);
      setReplayInitialScenarioPath(null);
      setActiveRecordAlias(alias);
      setActiveRecordMeta({
        alias,
        scenarioName: buildScenarioName(alias),
        startUrl: DEFAULT_START_URL,
      });
    },
    [buildScenarioName, setActiveRecordAlias, setActiveRecordMeta, setReplayAlias, setReplayInitialScenarioPath]
  );

  const openReplayModal = useCallback((alias: string, scenarioPath?: string | null) => {
    setActiveRecordAlias(null);
    setActiveRecordMeta(null);
    setReplayInitialScenarioPath(scenarioPath?.trim() ? scenarioPath.trim() : null);
    setReplayAlias(alias);
  }, [setActiveRecordAlias, setActiveRecordMeta, setReplayInitialScenarioPath, setReplayAlias]);

  const openReplayForAlias = useCallback(
    async (alias: string) => {
      let initialPath: string | null = null;
      try {
        const record = await getProfileSettings({ alias });
        const fromSettings = record?.settings?.storage?.lastScenarioPath?.trim();
        if (fromSettings) {
          initialPath = fromSettings;
        }
      } catch {
        // best effort
      }

      openReplayModal(alias, initialPath);
    },
    [openReplayModal]
  );

  const handleAliasChange = useCallback(
    (nextAlias: string) => {
      const params = new URLSearchParams(searchParams);
      if (nextAlias.trim()) {
        params.set('alias', nextAlias.trim());
      } else {
        params.delete('alias');
      }
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const handleRecord = useCallback(() => {
    if (!selectedAlias) return;
    openRecordModal(selectedAlias);
  }, [openRecordModal, selectedAlias]);

  const handleReplay = useCallback(
    (scenarioPath?: string) => {
      if (!selectedAlias) return;
      if (scenarioPath?.trim()) {
        openReplayModal(selectedAlias, scenarioPath);
        return;
      }
      void openReplayForAlias(selectedAlias);
    },
    [openReplayForAlias, openReplayModal, selectedAlias]
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-vsc-bg">
      {!embedded && (
        <Header
          title={t('scenarios.title')}
          subtitle={t('scenarios.subtitle')}
          icon={<FolderKanban size={18} />}
        />
      )}

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-[1200px] mx-auto space-y-6">
          <div className="rounded-2xl border border-white/10 bg-vsc-panel/70 px-5 py-5 shadow-[0_16px_50px_rgba(0,0,0,0.35)]">
            <div className="flex flex-col lg:flex-row lg:items-end gap-4">
              <div className="flex-1 min-w-0">
                <Select
                  label={t('accounts.profileAlias')}
                  value={selectedAlias}
                  onValueChange={handleAliasChange}
                  options={aliasOptions}
                  containerClassName="min-w-0"
                  shellClassName="h-9"
                  className="h-9 truncate"
                />
                <div className="mt-2 text-xs text-slate-400">{t('scenarios.profileHint')}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2 justify-start lg:justify-end">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void loadProfiles()}
                  leftIcon={<RefreshCw size={14} />}
                  isLoading={profilesLoading}
                >
                  {t('common.refresh')}
                </Button>
              </div>
            </div>
          </div>

          {selectedAlias ? (
            <ProfileScenariosPanel
              alias={selectedAlias}
              isOpen
              onClose={() => handleAliasChange('')}
              onRecord={handleRecord}
              onReplay={handleReplay}
              onComposeFlow={() => setComposedFlowAlias(selectedAlias)}
              variant="panel"
            />
          ) : (
            <div className="rounded-2xl border border-white/10 bg-vsc-panel/70 p-6">
              <EmptyState
                icon={FolderKanban}
                title={t('scenarios.emptyTitle')}
                description={t('scenarios.emptyDescription')}
              />
            </div>
          )}
        </div>
      </div>

      <ScenarioRecordModal
        alias={activeRecordAlias}
        isOpen={Boolean(activeRecordAlias)}
        onClose={() => {
          setActiveRecordAlias(null);
          setActiveRecordMeta(null);
        }}
        defaultUrl={activeRecordMeta?.startUrl}
        defaultScenarioName={activeRecordMeta?.scenarioName}
      />

      <ScenarioReplayModal
        alias={replayAlias}
        isOpen={Boolean(replayAlias)}
        onClose={() => {
          setReplayAlias(null);
          setReplayInitialScenarioPath(null);
        }}
        defaultUrl={DEFAULT_START_URL}
        defaultScenarioPath={replayInitialScenarioPath ?? undefined}
      />

      <ComposedFlowModal
        alias={composedFlowAlias}
        isOpen={Boolean(composedFlowAlias)}
        onClose={() => setComposedFlowAlias(null)}
      />
    </div>
  );
}
