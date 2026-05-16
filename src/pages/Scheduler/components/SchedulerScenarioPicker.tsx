import { useEffect, useMemo, useState } from 'react';

import {
  listRecordedScenarios,
  type ScenarioRecordItem,
} from '../../../lib/tauri/modules/pythonJobs';
import { listFingerprintProfiles } from '../../../lib/tauri/modules/profiles';
import { formatProfileAlias } from '../../../lib/profiles/displayName';
import { Button, Input, Select } from '@/components/ui';
import { t } from '@/lib/i18n';

interface SchedulerScenarioPickerProps {
  profileAlias: string;
  onProfileAliasChange: (alias: string) => void;
  scenarioPath: string;
  onScenarioPathChange: (path: string) => void;
}

export function SchedulerScenarioPicker({
  profileAlias,
  onProfileAliasChange,
  scenarioPath,
  onScenarioPathChange,
}: SchedulerScenarioPickerProps) {
  const [profiles, setProfiles] = useState<string[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);

  const [scenarios, setScenarios] = useState<ScenarioRecordItem[]>([]);
  const [scenariosLoading, setScenariosLoading] = useState(false);
  const [scenarioQuery, setScenarioQuery] = useState('');
  const [scenarioError, setScenarioError] = useState<string | null>(null);

  const formatAliasOption = (profile: string) => {
    const pretty = formatProfileAlias(profile);
    return pretty === profile ? pretty : `${pretty} (${profile})`;
  };

  useEffect(() => {
    let cancelled = false;
    const loadProfiles = async () => {
      setProfilesLoading(true);
      try {
        const items = await listFingerprintProfiles();
        if (!cancelled) setProfiles(items);
      } catch {
        if (!cancelled) setProfiles([]);
      } finally {
        if (!cancelled) setProfilesLoading(false);
      }
    };

    void loadProfiles();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!profileAlias) {
      setScenarios([]);
      setScenarioError(null);
      return;
    }

    let cancelled = false;
    const loadScenarios = async () => {
      setScenariosLoading(true);
      setScenarioError(null);
      try {
        const items = await listRecordedScenarios({ alias: profileAlias, limit: 50 });
        if (!cancelled) setScenarios(items);
      } catch (e) {
        if (!cancelled) {
          setScenarios([]);
          setScenarioError(e instanceof Error ? e.message : 'Failed to load scenarios');
        }
      } finally {
        if (!cancelled) setScenariosLoading(false);
      }
    };

    void loadScenarios();
    return () => {
      cancelled = true;
    };
  }, [profileAlias]);

  const filteredScenarios = useMemo(() => {
    const q = scenarioQuery.trim().toLowerCase();
    if (!q) return scenarios;
    return scenarios.filter(item => {
      return (
        item.name.toLowerCase().includes(q) ||
        item.scenarioPath.toLowerCase().includes(q) ||
        (item.startedUrl ?? '').toLowerCase().includes(q)
      );
    });
  }, [scenarioQuery, scenarios]);

  const refreshScenarios = () => {
    if (!profileAlias) return;
    setScenariosLoading(true);
    setScenarioError(null);
    listRecordedScenarios({ alias: profileAlias, limit: 50 })
      .then(items => setScenarios(items))
      .catch(e => setScenarioError(e instanceof Error ? e.message : t('scheduler.failedToLoadScenarios')))
      .finally(() => setScenariosLoading(false));
  };

  return (
    <div className="rounded-md border border-vsc-border bg-vsc-input/40 p-3 space-y-3">
      <div className="text-sm font-medium text-vsc-text">{t('scheduler.scenarioTarget')}</div>

      <Select
        label={t('scheduler.profileLabel')}
        value={profileAlias}
        onChange={e => {
          onProfileAliasChange(e.target.value);
          onScenarioPathChange('');
        }}
      >
        <option value="">{t('scheduler.selectProfile')}</option>
        {profiles.map(profile => (
          <option key={profile} value={profile}>
            {formatAliasOption(profile)}
          </option>
        ))}
      </Select>
      {profilesLoading ? (
        <div className="text-xs text-vsc-text-muted">{t('scheduler.loadingProfiles')}</div>
      ) : null}

      <Input
        label={t('scheduler.scenarioPathLabel')}
        value={scenarioPath}
        onChange={e => onScenarioPathChange(e.target.value)}
        placeholder={t('scheduler.scenarioPathPlaceholder')}
      />

      <div className="rounded-md border border-vsc-border bg-vsc-input/60 p-2">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-vsc-text-muted">{t('scheduler.savedScenarios')}</div>
          <Button
            size="xs"
            variant="secondary"
            disabled={!profileAlias || scenariosLoading}
            onClick={refreshScenarios}
          >
            {scenariosLoading ? t('scheduler.loadingShort') : t('scheduler.refresh')}
          </Button>
        </div>

        <Input
          value={scenarioQuery}
          onChange={e => setScenarioQuery(e.target.value)}
          placeholder={t('scheduler.searchScenarios')}
          className="h-8"
        />

        <div className="mt-2 max-h-40 overflow-auto space-y-1">
          {scenarioError ? (
            <div className="text-xs text-vsc-red">{scenarioError}</div>
          ) : scenariosLoading ? (
            <div className="text-xs text-vsc-text-muted">{t('scheduler.loadingScenarios')}</div>
          ) : filteredScenarios.length === 0 ? (
            <div className="text-xs text-vsc-text-muted">
              {profileAlias ? t('scheduler.noSavedScenarios') : t('scheduler.selectProfileToLoad')}
            </div>
          ) : (
            filteredScenarios.map(item => (
              <Button
                key={item.id}
                type="button"
                variant="ghost"
                className={`w-full text-left px-2 py-1 rounded border text-xs h-auto justify-start ${
                  scenarioPath === item.scenarioPath
                    ? 'border-vsc-blue/50 bg-vsc-blue/10 text-vsc-text'
                    : 'border-transparent hover:border-vsc-border hover:bg-vsc-input/70 text-vsc-text-muted'
                }`}
                onClick={() => onScenarioPathChange(item.scenarioPath)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{item.name}</span>
                  <span className="text-[10px] text-vsc-text-muted">{item.stepsCount} {t('scheduler.steps')}</span>
                </div>
                <div className="text-[10px] text-vsc-text-muted truncate">{item.scenarioPath}</div>
              </Button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
