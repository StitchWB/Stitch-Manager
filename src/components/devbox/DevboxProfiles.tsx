import { useCallback, useMemo, useState } from 'react';
import { FolderCog, Pencil } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Textarea';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { appToast } from '@/lib/observability/toast';
import { t } from '@/lib/i18n';
import {
  devboxProfileGet,
  devboxProfilePut,
  type DevboxProfileRow,
} from '@/lib/backend/modules/devbox';
import { DevboxSection } from './DevboxSection';

interface EditorState {
  name: string;
  json: string;
  loading: boolean;
  saving: boolean;
  lastInvalid: { json: string; errors: string[] } | null;
}

const PROFILE_MODES = ['standard', 'readonly', 'full'];

type ProfileModel = Record<string, unknown>;

function parseModel(json: string): ProfileModel | null {
  try {
    const value: unknown = JSON.parse(json);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as ProfileModel)
      : null;
  } catch {
    return null;
  }
}

function portsToText(value: unknown): string {
  return Array.isArray(value) ? value.join(', ') : '';
}

function textToPorts(text: string): number[] {
  return text
    .split(',')
    .map(part => Number(part.trim()))
    .filter(port => Number.isFinite(port) && port !== 0);
}

function PortsField({
  label,
  testId,
  value,
  onCommit,
}: {
  label: string;
  testId: string;
  value: unknown;
  onCommit: (ports: number[]) => void;
}) {
  const [text, setText] = useState(portsToText(value));
  return (
    <label className="flex flex-col gap-1 text-2xs uppercase tracking-wider text-slate-400">
      {label}
      <Input
        value={text}
        spellCheck={false}
        className="font-mono text-xs normal-case tracking-normal"
        data-testid={testId}
        onChange={e => setText(e.target.value)}
        onBlur={() => onCommit(textToPorts(text))}
      />
    </label>
  );
}

export interface DevboxProfilesProps {
  profiles: DevboxProfileRow[] | null;
  error: string | null;
  busy: boolean;
  onRetry: () => void;
  onChanged: () => void;
}

export function DevboxProfiles({ profiles, error, busy, onRetry, onChanged }: DevboxProfilesProps) {
  const rows = Array.isArray(profiles) ? profiles : [];
  const [editor, setEditor] = useState<EditorState | null>(null);

  const openEditor = useCallback((name: string) => {
    setEditor({ name, json: '', loading: true, saving: false, lastInvalid: null });
    devboxProfileGet(name)
      .then(result => {
        setEditor(prev =>
          prev && prev.name === name
            ? {
                ...prev,
                json: result.json,
                loading: false,
                lastInvalid: result.valid ? null : { json: result.json, errors: result.errors },
              }
            : prev,
        );
      })
      .catch((err: unknown) => {
        appToast.error(err instanceof Error ? err.message : t('pluginUi.actionFailed'));
        setEditor(prev => (prev && prev.name === name ? { ...prev, loading: false } : prev));
      });
  }, []);

  const parseOk = useMemo(() => {
    if (!editor || editor.loading) return false;
    try {
      JSON.parse(editor.json);
      return true;
    } catch {
      return false;
    }
  }, [editor]);

  const editorErrors = useMemo<string[]>(() => {
    if (!editor || editor.loading) return [];
    const serverErrors =
      editor.lastInvalid && editor.lastInvalid.json === editor.json
        ? editor.lastInvalid.errors
        : [];
    if (!parseOk) return [t('devboxPage.editorInvalidJson'), ...serverErrors];
    return serverErrors;
  }, [editor, parseOk]);

  const model = useMemo(
    () => (editor && !editor.loading ? parseModel(editor.json) : null),
    [editor],
  );

  const updateModel = useCallback((patch: Record<string, unknown>) => {
    setEditor(prev => {
      if (!prev) return prev;
      const current = parseModel(prev.json) ?? {};
      return { ...prev, json: JSON.stringify({ ...current, ...patch }, null, 2) };
    });
  }, []);

  const saveDisabled =
    editor === null ||
    editor.loading ||
    editor.saving ||
    busy ||
    !parseOk ||
    (editor.lastInvalid !== null && editor.lastInvalid.json === editor.json);

  const save = async () => {
    if (!editor || saveDisabled) return;
    const { name, json } = editor;
    setEditor(prev => (prev ? { ...prev, saving: true } : prev));
    try {
      const result = await devboxProfilePut(name, json);
      if (result.valid) {
        appToast.success(t('devboxPage.editorSaved'));
        setEditor(null);
        onChanged();
        return;
      }
      setEditor(prev =>
        prev ? { ...prev, saving: false, lastInvalid: { json, errors: result.errors } } : prev,
      );
    } catch (err) {
      appToast.error(err instanceof Error ? err.message : t('pluginUi.actionFailed'));
      setEditor(prev => (prev ? { ...prev, saving: false } : prev));
    }
  };

  return (
    <DevboxSection
      title={t('devboxPage.sectionProfiles')}
      error={error}
      onRetry={onRetry}
      testId="devbox-profiles"
    >
      {rows.length === 0 && !error ? (
        <EmptyState compact icon={FolderCog} title={t('devboxPage.profilesEmpty')} />
      ) : (
        <Table containerClassName="rounded-lg border border-white/5">
          <TableHeader>
            <TableRow>
              <TableHead>{t('devboxPage.colProfile')}</TableHead>
              <TableHead>{t('devboxPage.colMode')}</TableHead>
              <TableHead>{t('devboxPage.colProject')}</TableHead>
              <TableHead>{t('devboxPage.colActive')}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(row => (
              <TableRow key={row.name}>
                <TableCell className="font-medium text-white">{row.name}</TableCell>
                <TableCell>{row.mode}</TableCell>
                <TableCell className="font-mono text-2xs text-slate-400">{row.project_dir}</TableCell>
                <TableCell>
                  {row.active ? (
                    <Badge variant="success" size="sm" withDot>
                      {t('devboxPage.activeBadge')}
                    </Badge>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <IconButton
                    size="sm"
                    aria-label={t('common.edit')}
                    data-testid={`devbox-profile-edit-${row.name}`}
                    onClick={() => openEditor(row.name)}
                  >
                    <Pencil size={14} />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {editor && (
        <Modal
          isOpen
          onClose={() => setEditor(null)}
          title={t('devboxPage.editorTitle', { name: editor.name })}
          size="lg"
          footer={
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setEditor(null)}>
                {t('common.close')}
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={saveDisabled}
                isLoading={editor.saving}
                data-testid="devbox-profile-save"
                onClick={() => void save()}
              >
                {t('common.save')}
              </Button>
            </div>
          }
        >
          {editor.loading ? (
            <div className="flex justify-center py-8">
              <LoadingSpinner />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {model && (
                <div
                  className="grid grid-cols-2 gap-2 pb-2"
                  data-testid="devbox-profile-form"
                >
                  <label className="flex flex-col gap-1 text-2xs uppercase tracking-wider text-slate-400">
                    {t('devboxPage.formProjectDir')}
                    <Input
                      value={typeof model.project_dir === 'string' ? model.project_dir : ''}
                      spellCheck={false}
                      className="font-mono text-xs normal-case tracking-normal"
                      data-testid="devbox-profile-field-project_dir"
                      onChange={e => updateModel({ project_dir: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-2xs uppercase tracking-wider text-slate-400">
                    {t('devboxPage.formMode')}
                    <Select
                      options={PROFILE_MODES.map(mode => ({ value: mode, label: mode }))}
                      value={typeof model.mode === 'string' ? model.mode : 'standard'}
                      data-testid="devbox-profile-field-mode"
                      onValueChange={value => updateModel({ mode: value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-2xs uppercase tracking-wider text-slate-400">
                    {t('devboxPage.formToolchain')}
                    <Input
                      value={typeof model.toolchain === 'string' ? model.toolchain : ''}
                      spellCheck={false}
                      className="font-mono text-xs normal-case tracking-normal"
                      data-testid="devbox-profile-field-toolchain"
                      onChange={e => updateModel({ toolchain: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-2xs uppercase tracking-wider text-slate-400">
                    {t('devboxPage.formUiPort')}
                    <Input
                      value={typeof model.ui_port === 'number' ? String(model.ui_port) : ''}
                      inputMode="numeric"
                      className="font-mono text-xs normal-case tracking-normal"
                      data-testid="devbox-profile-field-ui_port"
                      onChange={e =>
                        updateModel({
                          ui_port: e.target.value === '' ? undefined : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-2xs uppercase tracking-wider text-slate-400">
                    {t('devboxPage.formGitName')}
                    <Input
                      value={typeof model.git_name === 'string' ? model.git_name : ''}
                      className="text-xs normal-case tracking-normal"
                      data-testid="devbox-profile-field-git_name"
                      onChange={e => updateModel({ git_name: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-2xs uppercase tracking-wider text-slate-400">
                    {t('devboxPage.formGitEmail')}
                    <Input
                      value={typeof model.git_email === 'string' ? model.git_email : ''}
                      className="text-xs normal-case tracking-normal"
                      data-testid="devbox-profile-field-git_email"
                      onChange={e => updateModel({ git_email: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-2xs uppercase tracking-wider text-slate-400">
                    {t('devboxPage.formPreviewOrigin')}
                    <Input
                      value={typeof model.preview_origin === 'string' ? model.preview_origin : ''}
                      spellCheck={false}
                      className="font-mono text-xs normal-case tracking-normal"
                      data-testid="devbox-profile-field-preview_origin"
                      onChange={e => updateModel({ preview_origin: e.target.value })}
                    />
                  </label>
                  <PortsField
                    key={`allowed:${portsToText(model.allowed_ports)}`}
                    label={t('devboxPage.formAllowedPorts')}
                    testId="devbox-profile-field-allowed_ports"
                    value={model.allowed_ports}
                    onCommit={ports => updateModel({ allowed_ports: ports })}
                  />
                  <PortsField
                    key={`deny:${portsToText(model.port_deny)}`}
                    label={t('devboxPage.formPortDeny')}
                    testId="devbox-profile-field-port_deny"
                    value={model.port_deny}
                    onCommit={ports => updateModel({ port_deny: ports })}
                  />
                </div>
              )}
              <span className="text-2xs uppercase tracking-wider text-slate-500">
                {t('devboxPage.editorAdvanced')}
              </span>
              <Textarea
                value={editor.json}
                rows={18}
                spellCheck={false}
                className="font-mono text-xs"
                data-testid="devbox-profile-editor"
                onChange={e =>
                  setEditor(prev => (prev ? { ...prev, json: e.target.value } : prev))
                }
              />
              {editorErrors.length > 0 && (
                <div className="flex flex-col gap-1" data-testid="devbox-profile-errors">
                  <span className="text-2xs uppercase tracking-wider text-red-300">
                    {t('devboxPage.editorErrors')}
                  </span>
                  {editorErrors.map((line, i) => (
                    <span key={i} className="text-2xs text-red-300 font-mono">
                      {line}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </DevboxSection>
  );
}
