import { useCallback, useState } from 'react';
import { Plug, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  devboxMcpCandidates,
  devboxProfileGet,
  devboxProfilePut,
  type DevboxMcpCandidate,
  type DevboxOverviewGateway,
} from '@/lib/backend/modules/devbox';
import { DevboxSection } from './DevboxSection';

type McpMode = 'readonly' | 'full';
type Selection = { mode: McpMode; tools: string };

export interface DevboxMcpSectionProps {
  gateway: DevboxOverviewGateway | null;
  activeProfile: string;
  onConfigure: () => void;
  onSaved: () => void;
}

export function DevboxMcpSection({
  gateway,
  activeProfile,
  onConfigure,
  onSaved,
}: DevboxMcpSectionProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<DevboxMcpCandidate[]>([]);
  const [selected, setSelected] = useState<Record<string, Selection>>({});

  const openPicker = useCallback(async () => {
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const payload = await devboxMcpCandidates(activeProfile);
      if (payload.error !== null) {
        setError(payload.error);
        setCandidates([]);
        return;
      }
      setCandidates(payload.candidates);
      const next: Record<string, Selection> = {};
      for (const mcp of gateway?.exposed_mcps ?? []) {
        next[mcp.name] = { mode: mcp.mode, tools: mcp.tools.join(', ') };
      }
      setSelected(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  }, [activeProfile, gateway]);

  const toggle = (candidate: DevboxMcpCandidate, checked: boolean) => {
    if (!candidate.valid || !candidate.enabled) return;
    setSelected(prev => {
      const next = { ...prev };
      if (checked) next[candidate.name] = { mode: 'readonly', tools: '' };
      else delete next[candidate.name];
      return next;
    });
  };

  const updateSelection = (name: string, patch: Partial<Selection>) => {
    setSelected(prev => (prev[name] ? { ...prev, [name]: { ...prev[name], ...patch } } : prev));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const content = await devboxProfileGet(activeProfile);
      const data = JSON.parse(content.json) as Record<string, unknown>;
      data.exposed_mcps = Object.entries(selected).map(([name, value]) => ({
        name,
        mode: value.mode,
        tool_allow: value.tools
          .split(',')
          .map(tool => tool.trim())
          .filter(Boolean),
      }));
      const result = await devboxProfilePut(activeProfile, JSON.stringify(data, null, 2));
      if (!result.valid) {
        setError(result.errors.join('; '));
        return;
      }
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (gateway === null) return null;
  const rows = gateway.enabled ? gateway.exposed_mcps : [];

  return (
    <>
      <DevboxSection
        title={t('devboxPage.mcpSectionTitle')}
        testId="devbox-mcp-section"
        actions={
          <Button
            size="xs"
            variant="secondary"
            data-testid="devbox-mcp-configure"
            onClick={() => void openPicker()}
          >
            {t('devboxPage.mcpEmptyCta')}
          </Button>
        }
      >
        {rows.length === 0 ? (
          <EmptyState
            compact
            icon={Plug}
            title={t('devboxPage.mcpEmptyTitle')}
            description={t('devboxPage.mcpEmptyDesc')}
          />
        ) : (
          <div className="flex flex-wrap items-stretch gap-2">
            {rows.map(mcp => (
              <div
                key={mcp.name}
                className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5"
                data-testid={`devbox-mcp-row-${mcp.name}`}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-xs font-semibold text-white">{mcp.name}</span>
                  <span
                    className={cn(
                      'truncate text-2xs uppercase tracking-wider',
                      mcp.mode === 'full' ? 'text-amber-300' : 'text-slate-400',
                    )}
                    data-testid={`devbox-mcp-mode-${mcp.name}`}
                  >
                    {mcp.mode === 'full'
                      ? t('devboxPage.mcpModeFull')
                      : t('devboxPage.mcpModeReadonly')}
                  </span>
                </span>
                <span
                  className="ml-auto flex shrink-0 items-center gap-1 text-2xs text-slate-400"
                  title={mcp.tools.join(', ')}
                  data-testid={`devbox-mcp-tools-${mcp.name}`}
                >
                  <Wrench size={12} aria-hidden />
                  {mcp.tools.length}
                </span>
              </div>
            ))}
          </div>
        )}
      </DevboxSection>

      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title={t('devboxPage.mcpPickerTitle')}
        size="lg"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                onConfigure();
              }}
            >
              {t('devboxPage.mcpPickerAdvanced')}
            </Button>
            <Button variant="primary" disabled={saving} onClick={() => void save()}>
              {t('devboxPage.mcpPickerSave')}
            </Button>
          </>
        }
      >
        {loading ? (
          <p className="text-xs text-slate-400">{t('devboxPage.mcpPickerLoading')}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {error !== null && <p className="text-xs text-red-300">{error}</p>}
            {candidates.length === 0 && error === null && (
              <p className="text-xs text-slate-400">{t('devboxPage.mcpPickerEmpty')}</p>
            )}
            {candidates.map(candidate => {
              const selection = selected[candidate.name];
              const disabled = !candidate.valid || !candidate.enabled;
              return (
                <div
                  key={candidate.name}
                  className={cn(
                    'rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5',
                    disabled && 'opacity-60',
                  )}
                >
                  <Checkbox
                    label={candidate.name}
                    description={`${candidate.type} · ${candidate.source}`}
                    checked={selection !== undefined}
                    disabled={disabled}
                    onChange={event => toggle(candidate, event.target.checked)}
                  />
                  {disabled && candidate.error !== null && (
                    <p className="pl-8 text-2xs text-amber-300">{candidate.error}</p>
                  )}
                  {selection !== undefined && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 pl-8">
                      <Select
                        options={[
                          { value: 'readonly', label: t('devboxPage.mcpModeReadonly') },
                          { value: 'full', label: t('devboxPage.mcpModeFull') },
                        ]}
                        value={selection.mode}
                        containerClassName="w-40"
                        onValueChange={value =>
                          updateSelection(candidate.name, {
                            mode: value === 'full' ? 'full' : 'readonly',
                          })
                        }
                      />
                      <Input
                        value={selection.tools}
                        placeholder={t('devboxPage.mcpPickerTools')}
                        containerClassName="min-w-[220px] flex-1"
                        onChange={event =>
                          updateSelection(candidate.name, { tools: event.target.value })
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Modal>
    </>
  );
}