import { useCallback, useMemo, useState } from 'react';
import { t } from '@/lib/i18n';

import { Button, Input } from '@/components/ui';
import { collectFlowInputKeys, parseFlowObject, parseStringRecord } from './flowUtils';
import type { SchedulerTaskFormState } from './types';

interface FlowVariablesEditorProps {
  composedFlowJson: string;
  flowVariablesJson: string;
  set: (patch: Partial<SchedulerTaskFormState>) => void;
}

export function FlowVariablesEditor({
  composedFlowJson,
  flowVariablesJson,
  set,
}: FlowVariablesEditorProps) {
  const [newVarKey, setNewVarKey] = useState('');
  const [newVarValue, setNewVarValue] = useState('');

  const parsedFlow = useMemo(() => parseFlowObject(composedFlowJson), [composedFlowJson]);

  const flowInputKeys = useMemo(
    () => (parsedFlow ? collectFlowInputKeys(parsedFlow) : []),
    [parsedFlow]
  );

  const flowVariables = useMemo(() => parseStringRecord(flowVariablesJson), [flowVariablesJson]);

  const variableKeys = useMemo(() => {
    const out = new Set<string>(flowInputKeys);
    Object.keys(flowVariables).forEach(key => {
      if (key.trim()) out.add(key.trim());
    });
    return Array.from(out.values());
  }, [flowInputKeys, flowVariables]);

  const setFlowVariables = useCallback(
    (next: Record<string, string>) => {
      set({
        flowVariablesJson: JSON.stringify(next, null, 2),
      });
    },
    [set]
  );

  const updateFlowVariable = useCallback(
    (key: string, value: string) => {
      const next = { ...flowVariables, [key]: value };
      setFlowVariables(next);
    },
    [flowVariables, setFlowVariables]
  );

  const removeFlowVariable = useCallback(
    (key: string) => {
      const next = { ...flowVariables };
      delete next[key];
      setFlowVariables(next);
    },
    [flowVariables, setFlowVariables]
  );

  const addFlowVariable = useCallback(() => {
    const key = newVarKey.trim();
    if (!key) return;
    const next = { ...flowVariables, [key]: newVarValue };
    setFlowVariables(next);
    setNewVarKey('');
    setNewVarValue('');
  }, [flowVariables, newVarKey, newVarValue, setFlowVariables]);

  return (
    <div className="rounded-md border border-vsc-border bg-vsc-input/20 p-3 space-y-2">
      <div className="text-xs text-vsc-text-muted">{t('scheduler.flowInputVariables')}</div>

      {variableKeys.length === 0 ? (
        <div className="text-xs text-vsc-muted">{t('scheduler.noInputKeysDetected')}</div>
      ) : (
        <div className="space-y-2">
          {variableKeys.map(key => {
            const detected = flowInputKeys.includes(key);
            return (
              <div key={key} className="grid grid-cols-1 md:grid-cols-[1fr,2fr,auto] gap-2">
                <Input label="Key" value={key} disabled className="h-9" />
                <Input
                  label="Value"
                  value={flowVariables[key] ?? ''}
                  onChange={e => updateFlowVariable(key, e.target.value)}
                  className="h-9"
                />
                <div className="flex items-end">
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => removeFlowVariable(key)}
                    disabled={detected}
                    title={detected ? t('scheduler.detectedKeysCannotBeRemoved') : t('scheduler.removeVariable')}
                  >
                    {t('scheduler.remove')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[1fr,2fr,auto] gap-2">
        <Input
          label={t('scheduler.newKey')}
          value={newVarKey}
          onChange={e => setNewVarKey(e.target.value)}
          className="h-9"
          placeholder="customKey"
        />
        <Input
          label={t('scheduler.newValue')}
          value={newVarValue}
          onChange={e => setNewVarValue(e.target.value)}
          className="h-9"
          placeholder="value"
        />
        <div className="flex items-end">
          <Button variant="secondary" size="sm" onClick={addFlowVariable}>
            {t('scheduler.add')}
          </Button>
        </div>
      </div>
    </div>
  );
}
