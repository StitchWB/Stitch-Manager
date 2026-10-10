import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, FolderCog, FolderOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { Button } from '@/components/ui/Button';
import { ConfirmActionButton } from '@/components/ui/ConfirmActionButton';
import { IconButton } from '@/components/ui/IconButton';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { RadioCard } from '@/components/ui/RadioCard';
import { Textarea } from '@/components/ui/Textarea';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { appToast } from '@/lib/observability/toast';
import { isDesktopApp } from '@/lib/backend/core/url';
import { pickFolderNative, nativePickerAvailable } from '@/lib/desktop/nativeDialogs';
import { t } from '@/lib/i18n';
import {
  devboxFolderCheck,
  devboxProfileDefaults,
  devboxProfileDelete,
  devboxProfileGet,
  devboxProfilePut,
  devboxProfileUse,
  devboxStackStart,
  type DevboxAccepted,
  type DevboxProfileRow,
} from '@/lib/backend/modules/devbox';
import { DevboxSection } from './DevboxSection';

interface EditorState {
  name: string;
  json: string;
  loading: boolean;
  saving: boolean;
  create: boolean;
  lastInvalid: { json: string; errors: string[] } | null;
}

const CREATE_TEMPLATE = JSON.stringify({ project_dir: '', mode: 'standard' }, null, 2);

const MODES = [
  {
    value: 'readonly',
    titleKey: 'devboxPage.modeReadonlyTitle',
    descKey: 'devboxPage.modeReadonlyDesc',
  },
  {
    value: 'standard',
    titleKey: 'devboxPage.modeStandardTitle',
    descKey: 'devboxPage.modeStandardDesc',
  },
  {
    value: 'full',
    titleKey: 'devboxPage.modeFullTitle',
    descKey: 'devboxPage.modeFullDesc',
  },
] as const;

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

function basename(value: string): string {
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

const RECENTS_KEY = 'devbox.recentProjectDirs';

function readRecents(): string[] {
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]');
  } catch {
    parsed = [];
  }
  return Array.isArray(parsed)
    ? parsed.filter((value): value is string => typeof value === 'string').slice(0, 5)
    : [];
}

function writeRecents(path: string): void {
  localStorage.setItem(
    RECENTS_KEY,
    JSON.stringify([path, ...readRecents().filter(prev => prev !== path)].slice(0, 5)),
  );
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
  onAction: (action: Promise<DevboxAccepted>) => void;
  onRetry: () => void;
  onChanged: () => void;
}

export function DevboxProfiles({
  profiles,
  error,
  busy,
  onAction,
  onRetry,
  onChanged,
}: DevboxProfilesProps) {
  const rows = Array.isArray(profiles) ? profiles : [];
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const [folderStatus, setFolderStatus] = useState<{ exists: boolean; isGit: boolean } | null>(
    null,
  );
  const [gitIdentity, setGitIdentity] = useState('');
  const [recents, setRecents] = useState<string[]>([]);

  const loadCreateExtras = useCallback(() => {
    setRecents(readRecents());
    devboxProfileDefaults()
      .then(defaults => {
        setGitIdentity(
          defaults.git_name && defaults.git_email
            ? `${defaults.git_name} <${defaults.git_email}>`
            : '',
        );
      })
      .catch(() => {
        setGitIdentity('');
      });
  }, []);

  const openEditor = useCallback((name: string) => {
    setAdvancedOpen(true);
    setNameTouched(true);
    setEditor({ name, json: '', loading: true, saving: false, create: false, lastInvalid: null });
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

  const openCreate = useCallback(() => {
    setAdvancedOpen(false);
    setNameTouched(false);
    setFolderStatus(null);
    loadCreateExtras();
    setEditor({
      name: '',
      json: CREATE_TEMPLATE,
      loading: false,
      saving: false,
      create: true,
      lastInvalid: null,
    });
  }, [loadCreateExtras]);

  const openCreateFrom = useCallback(
    (name: string) => {
      setAdvancedOpen(false);
      setNameTouched(false);
      setFolderStatus(null);
      loadCreateExtras();
      setEditor({
        name: '',
        json: CREATE_TEMPLATE,
        loading: true,
        saving: false,
        create: true,
        lastInvalid: null,
      });
      devboxProfileGet(name)
        .then(result =>
          setEditor(prev =>
            prev && prev.create ? { ...prev, json: result.json, loading: false } : prev,
          ),
        )
        .catch((err: unknown) => {
          appToast.error(err instanceof Error ? err.message : t('pluginUi.actionFailed'));
          setEditor(prev => (prev ? { ...prev, loading: false } : prev));
        });
    },
    [loadCreateExtras],
  );

  const deleteProfile = useCallback(
    async (name: string) => {
      try {
        await devboxProfileDelete(name);
        appToast.success(t('devboxPage.profileDeleted'));
        onChanged();
      } catch (err) {
        appToast.error(err instanceof Error ? err.message : t('pluginUi.actionFailed'));
      }
    },
    [onChanged],
  );

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

  const folderErrors = useMemo(
    () => (model ? editorErrors.filter(line => line.includes('project_dir')) : []),
    [editorErrors, model],
  );
  const generalErrors = useMemo(
    () => editorErrors.filter(line => !folderErrors.includes(line)),
    [editorErrors, folderErrors],
  );

  const updateModel = useCallback((patch: Record<string, unknown>) => {
    setEditor(prev => {
      if (!prev) return prev;
      const current = parseModel(prev.json) ?? {};
      return { ...prev, json: JSON.stringify({ ...current, ...patch }, null, 2) };
    });
  }, []);

  const onFolderChange = useCallback(
    (value: string) => {
      updateModel({ project_dir: value });
      if (!nameTouched) {
        setEditor(prev => (prev && prev.create ? { ...prev, name: basename(value) } : prev));
      }
    },
    [nameTouched, updateModel],
  );

  const pickFolder = useCallback(async () => {
    if (!nativePickerAvailable()) {
      appToast.error(t('devboxPage.folderPickUnavailable'));
      return;
    }
    const path = await pickFolderNative();
    if (path) onFolderChange(path);
  }, [onFolderChange]);

  const folder = typeof model?.project_dir === 'string' ? model.project_dir : '';

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!editor || editor.loading || folder.trim() === '') {
        setFolderStatus(null);
        return;
      }
      devboxFolderCheck(folder)
        .then(result => setFolderStatus({ exists: result.exists, isGit: result.is_git }))
        .catch(() => setFolderStatus(null));
    }, 300);
    return () => clearTimeout(timer);
  }, [editor, folder]);

  const saveDisabled =
    editor === null ||
    editor.loading ||
    editor.saving ||
    busy ||
    !parseOk ||
    (editor.create && (editor.name.trim() === '' || folder.trim() === '')) ||
    (editor.lastInvalid !== null && editor.lastInvalid.json === editor.json);

  const save = async (startAfter: boolean) => {
    if (!editor || saveDisabled) return;
    const { name, json, create } = editor;
    setEditor(prev => (prev ? { ...prev, saving: true } : prev));
    try {
      const result = await devboxProfilePut(name, json);
      if (result.valid) {
        appToast.success(t('devboxPage.editorSaved'));
        if (create) writeRecents(folder);
        if (startAfter) {
          onAction(devboxStackStart(name, false));
        }
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
      caption={t('devboxPage.profilesCaption')}
      error={error}
      onRetry={onRetry}
      testId="devbox-profiles"
      actions={
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<Plus size={14} />}
          disabled={busy}
          data-testid="devbox-profile-add"
          onClick={openCreate}
        >
          {t('devboxPage.addProfile')}
        </Button>
      }
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
                    <span className="text-slate-400">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <ConfirmActionButton
                      size="xs"
                      variant="secondary"
                      disabled={busy}
                      data-testid={`devbox-profile-start-${row.name}`}
                      onConfirm={() => onAction(devboxStackStart(row.name, false))}
                    >
                      {t('devboxPage.controlStart')}
                    </ConfirmActionButton>
                    <Button
                      size="xs"
                      variant="secondary"
                      disabled={busy || row.active}
                      data-testid={`devbox-profile-use-${row.name}`}
                      onClick={() => onAction(devboxProfileUse(row.name))}
                    >
                      {t('devboxPage.controlUse')}
                    </Button>
                    <IconButton
                      size="sm"
                      aria-label={t('devboxPage.duplicateProfile')}
                      data-testid={`devbox-profile-duplicate-${row.name}`}
                      onClick={() => openCreateFrom(row.name)}
                    >
                      <Copy size={14} />
                    </IconButton>
                    <IconButton
                      size="sm"
                      aria-label={t('common.edit')}
                      data-testid={`devbox-profile-edit-${row.name}`}
                      onClick={() => openEditor(row.name)}
                    >
                      <Pencil size={14} />
                    </IconButton>
                    <ConfirmActionButton
                      size="xs"
                      variant="danger"
                      disabled={busy}
                      aria-label={t('devboxPage.deleteProfile')}
                      data-testid={`devbox-profile-delete-${row.name}`}
                      onConfirm={() => void deleteProfile(row.name)}
                    >
                      <Trash2 size={14} />
                    </ConfirmActionButton>
                  </div>
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
          title={
            editor.create
              ? t('devboxPage.editorCreateTitle')
              : t('devboxPage.editorTitle', { name: editor.name })
          }
          size="lg"
          footer={
            editor.create ? (
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEditor(null)}>
                  {t('common.close')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={saveDisabled}
                  isLoading={editor.saving}
                  data-testid="devbox-profile-save"
                  onClick={() => void save(false)}
                >
                  {t('devboxPage.addProfile')}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={saveDisabled}
                  isLoading={editor.saving}
                  data-testid="devbox-profile-save-start"
                  onClick={() => void save(true)}
                >
                  {t('devboxPage.addAndStart')}
                </Button>
              </div>
            ) : (
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
                  onClick={() => void save(false)}
                >
                  {t('common.save')}
                </Button>
              </div>
            )
          }
        >
          {editor.loading ? (
            <div className="flex justify-center py-8">
              <LoadingSpinner />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {editor.create && (
                <p className="text-xs text-slate-300" data-testid="devbox-profile-create-hint">
                  {t('devboxPage.editorCreateHint')}
                </p>
              )}
              {editor.create && (
                <label className="flex flex-col gap-1 text-2xs uppercase tracking-wider text-slate-400">
                  {t('devboxPage.formName')}
                  <Input
                    value={editor.name}
                    spellCheck={false}
                    className="font-mono text-xs normal-case tracking-normal"
                    data-testid="devbox-profile-new-name"
                    onChange={e => {
                      setNameTouched(true);
                      setEditor(prev => (prev ? { ...prev, name: e.target.value } : prev));
                    }}
                  />
                </label>
              )}
              {model && (
                <>
                  <div className="flex flex-col gap-1" data-testid="devbox-profile-form">
                    <div className="flex items-end gap-2">
                      <label className="flex min-w-0 flex-1 flex-col gap-1 text-2xs uppercase tracking-wider text-slate-400">
                        {t('devboxPage.formProjectDir')}
                        <Input
                          value={folder}
                          autoFocus={editor.create}
                          spellCheck={false}
                          className="font-mono text-xs normal-case tracking-normal"
                          data-testid="devbox-profile-field-project_dir"
                          onChange={e => onFolderChange(e.target.value)}
                        />
                      </label>
                      {isDesktopApp() && (
                        <Button
                          size="sm"
                          variant="secondary"
                          leftIcon={<FolderOpen size={14} />}
                          data-testid="devbox-profile-folder-pick"
                          onClick={() => void pickFolder()}
                        >
                          {t('devboxPage.formFolderPick')}
                        </Button>
                      )}
                    </div>
                    {folderStatus && (
                      <span
                        className={
                          folderStatus.exists
                            ? folderStatus.isGit
                              ? 'text-2xs text-emerald-300'
                              : 'text-2xs text-slate-400'
                            : 'text-2xs text-red-300'
                        }
                        data-testid="devbox-profile-folder-status"
                      >
                        {folderStatus.exists
                          ? folderStatus.isGit
                            ? t('devboxPage.folderExistsGit')
                            : t('devboxPage.folderExistsNoGit')
                          : t('devboxPage.folderMissing')}
                      </span>
                    )}
                    {editor.create && recents.length > 0 && (
                      <div className="flex flex-wrap gap-1" data-testid="devbox-profile-recents">
                        {recents.map(path => (
                          <Button
                            key={path}
                            size="xs"
                            variant="ghost"
                            title={path}
                            onClick={() => onFolderChange(path)}
                          >
                            {basename(path)}
                          </Button>
                        ))}
                      </div>
                    )}
                    {folderErrors.map((line, i) => (
                      <span
                        key={i}
                        className="text-2xs font-mono text-red-300"
                        data-testid="devbox-profile-error-project_dir"
                      >
                        {line}
                      </span>
                    ))}
                    <span className="mt-2 text-2xs uppercase tracking-wider text-slate-400">
                      {t('devboxPage.formMode')}
                    </span>
                    <div
                      className="grid grid-cols-3 gap-2"
                      role="radiogroup"
                      aria-label={t('devboxPage.formMode')}
                      data-testid="devbox-profile-field-mode"
                    >
                      {MODES.map(mode => (
                        <RadioCard
                          key={mode.value}
                          selected={model.mode === mode.value}
                          data-testid={`devbox-profile-mode-${mode.value}`}
                          onSelect={() => updateModel({ mode: mode.value })}
                          title={t(mode.titleKey)}
                          description={t(mode.descKey)}
                        />
                      ))}
                    </div>
                  </div>
                  {editor.create && !advancedOpen && (
                    <div
                      className="flex items-center justify-between gap-2 rounded-md border border-white/5 px-3 py-2"
                      data-testid="devbox-profile-defaults-summary"
                    >
                      <span className="text-2xs text-slate-400">
                        {gitIdentity
                          ? t('devboxPage.defaultsSummaryGit', { identity: gitIdentity })
                          : t('devboxPage.defaultsSummary')}
                      </span>
                      <Button
                        size="xs"
                        variant="ghost"
                        data-testid="devbox-profile-advanced-toggle"
                        onClick={() => setAdvancedOpen(true)}
                      >
                        {t('devboxPage.defaultsChange')}
                      </Button>
                    </div>
                  )}
                  {advancedOpen && (
                    <div className="flex flex-col gap-2">
                      <Button
                        size="xs"
                        variant="ghost"
                        className="self-start"
                        data-testid="devbox-profile-advanced-toggle"
                        onClick={() => setAdvancedOpen(false)}
                      >
                        {t('devboxPage.formAdvanced')}
                      </Button>
                      <div className="grid grid-cols-2 gap-2" data-testid="devbox-profile-advanced">
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
                            value={
                              typeof model.preview_origin === 'string' ? model.preview_origin : ''
                            }
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
                      <span className="text-2xs uppercase tracking-wider text-slate-400">
                        {t('devboxPage.editorAdvanced')}
                      </span>
                      <Textarea
                        value={editor.json}
                        rows={10}
                        spellCheck={false}
                        className="font-mono text-xs"
                        data-testid="devbox-profile-editor"
                        onChange={e =>
                          setEditor(prev => (prev ? { ...prev, json: e.target.value } : prev))
                        }
                      />
                    </div>
                  )}
                </>
              )}
              {generalErrors.length > 0 && (
                <div className="flex flex-col gap-1" data-testid="devbox-profile-errors">
                  <span className="text-2xs uppercase tracking-wider text-red-300">
                    {t('devboxPage.editorErrors')}
                  </span>
                  {generalErrors.map((line, i) => (
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
