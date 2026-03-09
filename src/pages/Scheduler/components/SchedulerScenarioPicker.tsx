import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Select } from '../../../components/ui';
import {
  listRecordedScenarios,
  type ScenarioRecordItem,
} from '../../../lib/tauri/modules/pythonJobs';
import { listFingerprintProfiles } from '../../../lib/tauri/modules/profiles';
import { formatProfileAlias } from '../../../lib/profiles/displayName';

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
      .catch(e => setScenarioError(e instanceof Error ? e.message : 'Failed to load scenarios'))
      .finally(() => setScenariosLoading(false));
  };

  return (
    <div className="rounded-md border border-vsc-border bg-vsc-input/40 p-3 space-y-3">
      <div className="text-sm font-medium text-vsc-text">Scenario target</div>

      <Select
        label="Profile"
        value={profileAlias}
        onChange={e => {
          onProfileAliasChange(e.target.value);
          onScenarioPathChange('');
        }}
      >
        <option value="">Select profile...</option>
        {profiles.map(profile => (
          <option key={profile} value={profile}>
            {formatAliasOption(profile)}
          </option>
        ))}
      </Select>
      {profilesLoading ? (
        <div className="text-xs text-vsc-text-muted">Loading profiles…</div>
      ) : null}

      <Input
        label="Scenario path"
        value={scenarioPath}
        onChange={e => onScenarioPathChange(e.target.value)}
        placeholder="Select a saved scenario or paste a path"
      />

      <div className="rounded-md border border-vsc-border bg-vsc-input/60 p-2">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-vsc-text-muted">Saved scenarios</div>
          <Button
            size="xs"
            variant="secondary"
            disabled={!profileAlias || scenariosLoading}
            onClick={refreshScenarios}
          >
            {scenariosLoading ? 'Loading…' : 'Refresh'}
          </Button>
        </div>

        <Input
          value={scenarioQuery}
          onChange={e => setScenarioQuery(e.target.value)}
          placeholder="Search scenarios"
          className="h-8"
        />

        <div className="mt-2 max-h-40 overflow-auto space-y-1">
          {scenarioError ? (
            <div className="text-xs text-vsc-red">{scenarioError}</div>
          ) : scenariosLoading ? (
            <div className="text-xs text-vsc-text-muted">Loading scenarios…</div>
          ) : filteredScenarios.length === 0 ? (
            <div className="text-xs text-vsc-text-muted">
              {profileAlias ? 'No saved scenarios yet.' : 'Select a profile to load scenarios.'}
            </div>
          ) : (
            filteredScenarios.map(item => (
              <button
                key={item.id}
                type="button"
                className={`w-full text-left px-2 py-1 rounded border text-xs ${
                  scenarioPath === item.scenarioPath
                    ? 'border-vsc-blue/50 bg-vsc-blue/10 text-vsc-text'
                    : 'border-transparent hover:border-vsc-border hover:bg-vsc-input/70 text-vsc-text-muted'
                }`}
                onClick={() => onScenarioPathChange(item.scenarioPath)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{item.name}</span>
                  <span className="text-[10px] text-vsc-text-muted">{item.stepsCount} steps</span>
                </div>
                <div className="text-[10px] text-vsc-text-muted truncate">{item.scenarioPath}</div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
