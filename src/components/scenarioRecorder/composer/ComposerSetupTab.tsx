import { Button, FormGrid, Input, Select, Textarea } from '@/components/ui';
import { useState } from 'react';
import type { ComposedFlow } from '@/lib/scenarioFlow/types';

type ComposerSetupTabProps = {
  flow: ComposedFlow;
  inputDefaultEntries: Array<[string, string]>;
  addInputDefault: () => void;
  updateInputDefault: (oldKey: string, newKey: string, value: string) => void;
  removeInputDefault: (key: string) => void;
  updateFlow: (fn: (prev: ComposedFlow) => ComposedFlow) => void;
  sheetsParams: { spreadsheetId: string; serviceAccountJson: string } | null;
  sheetsError: string | null;
  selectedSheetId: string;
  selectedSheetColumn: string;
  sheetOptions: Array<{ value: string; label: string }>;
  sheetColumnOptions: Array<{ value: string; label: string }>;
  setSelectedSheetId: (value: string) => void;
  setSelectedSheetColumn: (value: string) => void;
  refreshSheets: () => Promise<void>;
  importEmailsFromSheet: () => void;
};

export function ComposerSetupTab({
  flow,
  inputDefaultEntries,
  addInputDefault,
  updateInputDefault,
  removeInputDefault,
  updateFlow,
  sheetsParams,
  sheetsError,
  selectedSheetId,
  selectedSheetColumn,
  sheetOptions,
  sheetColumnOptions,
  setSelectedSheetId,
  setSelectedSheetColumn,
  refreshSheets,
  importEmailsFromSheet,
}: ComposerSetupTabProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <>
      <FormGrid responsive>
        <Input
          label="Default alias"
          value={flow.defaults.alias}
          onChange={e =>
            updateFlow(prev => ({
              ...prev,
              alias: e.target.value,
              defaults: {
                ...prev.defaults,
                alias: e.target.value,
              },
            }))
          }
          className="h-9"
        />
      </FormGrid>

      <div className="rounded-lg border border-white/10 bg-black/20 p-2">
        <Button variant="secondary" size="xs" onClick={() => setAdvancedOpen(prev => !prev)}>
          {advancedOpen ? 'Hide advanced' : 'Show advanced'}
        </Button>
        {advancedOpen ? (
          <div className="space-y-2 mt-2">
            <FormGrid responsive>
              <Input
                label="Default proxy"
                value={flow.defaults.proxy ?? ''}
                onChange={e =>
                  updateFlow(prev => ({
                    ...prev,
                    defaults: {
                      ...prev.defaults,
                      proxy: e.target.value || null,
                    },
                  }))
                }
                className="h-9"
              />
              <Input
                label="Default config JSON"
                value={flow.defaults.configJson ?? ''}
                onChange={e =>
                  updateFlow(prev => ({
                    ...prev,
                    defaults: {
                      ...prev.defaults,
                      configJson: e.target.value || null,
                    },
                  }))
                }
                className="h-9"
              />
            </FormGrid>

            <FormGrid responsive>
              <Input
                label="Default credential login"
                value={flow.defaults.credentials?.login ?? ''}
                onChange={e =>
                  updateFlow(prev => ({
                    ...prev,
                    defaults: {
                      ...prev.defaults,
                      credentials: {
                        ...(prev.defaults.credentials ?? {}),
                        login: e.target.value || null,
                      },
                    },
                  }))
                }
                className="h-9"
              />
              <Input
                label="Default credential password"
                value={flow.defaults.credentials?.password ?? ''}
                onChange={e =>
                  updateFlow(prev => ({
                    ...prev,
                    defaults: {
                      ...prev.defaults,
                      credentials: {
                        ...(prev.defaults.credentials ?? {}),
                        password: e.target.value || null,
                      },
                    },
                  }))
                }
                className="h-9"
              />
            </FormGrid>
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-300">Flow input defaults</div>
          <Button size="xs" variant="secondary" onClick={addInputDefault}>
            Add input
          </Button>
        </div>
        {inputDefaultEntries.length === 0 ? (
          <div className="text-xs text-slate-500">No flow inputs yet.</div>
        ) : (
          <div className="space-y-2">
            {inputDefaultEntries.map(([key, value]) => (
              <FormGrid responsive key={key}>
                <Input
                  label="Input key"
                  value={key}
                  onChange={e => updateInputDefault(key, e.target.value, value)}
                  className="h-9"
                />
                <div className="flex items-end gap-2">
                  <Input
                    label="Default value"
                    value={value}
                    onChange={e => updateInputDefault(key, key, e.target.value)}
                    className="h-9"
                  />
                  <Button size="xs" variant="danger" onClick={() => removeInputDefault(key)}>
                    Remove
                  </Button>
                </div>
              </FormGrid>
            ))}
          </div>
        )}
      </div>

      <Textarea
        label="Email list source (emails_pool, one email per line)"
        value={(flow.dataLists.find(d => d.id === 'emails_pool')?.values ?? []).join('\n')}
        onChange={e => {
          const values = e.target.value
            .split(/\r?\n/g)
            .map(v => v.trim())
            .filter(Boolean);
          updateFlow(prev => {
            const rest = prev.dataLists.filter(d => d.id !== 'emails_pool');
            return {
              ...prev,
              dataLists: [{ id: 'emails_pool', values, strategy: 'next' }, ...rest],
            };
          });
        }}
        className="h-24 min-h-[96px]"
      />

      <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-2">
        <div className="text-xs text-slate-400">Import emails from Google Sheets</div>
        {!sheetsParams ? (
          <div className="text-xs text-amber-300">
            Configure Google Sheets credentials in AutoReg settings first.
          </div>
        ) : (
          <FormGrid columns={3} responsive>
            <Select
              label="Sheet"
              value={selectedSheetId}
              options={sheetOptions}
              onValueChange={value => {
                setSelectedSheetId(value);
                setSelectedSheetColumn('');
              }}
            />
            <Select
              label="Column"
              value={selectedSheetColumn}
              options={sheetColumnOptions}
              onValueChange={setSelectedSheetColumn}
            />
            <div className="flex items-end gap-2">
              <Button variant="secondary" onClick={() => void refreshSheets()}>
                Refresh sheets
              </Button>
                <Button variant="secondary" onClick={importEmailsFromSheet}>
                  Import
                </Button>
              </div>
          </FormGrid>
        )}
        {sheetsError ? <div className="text-xs text-amber-300">{sheetsError}</div> : null}
      </div>
    </>
  );
}
