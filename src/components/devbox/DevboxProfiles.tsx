import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, FolderOpen, Info } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { RadioCard } from '@/components/ui/RadioCard';
import { Tooltip } from '@/components/ui/Tooltip';
import { Textarea } from '@/components/ui/Textarea';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { askConfirm } from '@/components/ui/ConfirmDialogHost';
import { appToast } from '@/lib/observability/toast';
import { isDesktopApp } from '@/lib/backend/core/url';
import { pickFolderNative, nativePickerAvailable } from '@/lib/desktop/nativeDialogs';
import { t } from '@/lib/i18n';
import {
  devboxProfileDefaults,
  devboxProfileDetect,
  devboxProfileGet,
  devboxProfilePut,
  devboxStackStart,
  type DevboxAccepted,
  type DevboxProfileDetect,
  type DevboxProfileRow,
  type DevboxVitalCard,
} from '@/lib/backend/modules/devbox';
import { isFolderProfileError, profileErrorTitle } from './profileErrors';
import { serializeProfileWrite } from './profileWriteLock';

interface EditorState {
  name: string;
  json: string;
  // слепок при открытии редактора — перед PUT сверяем с диском,
  // чтобы не затереть правки, сделанные watchdog'ом/CLI/другой вкладкой
  baseJson: string;
  loading: boolean;
  saving: boolean;
  create: boolean;
  lastInvalid: { json: string; errors: string[] } | null;
}

const CREATE_TEMPLATE = JSON.stringify({ project_dir: '', mode: 'standard' }, null, 2);

const DETECT_DEBOUNCE_MS = 400;

const MCP_SEED: Record<string, unknown> = {
  exposed_mcps: [{ name: 'context7', mode: 'readonly', tool_allow: [] }],
};

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
  tip,
  onCommit,
}: {
  label: string;
  testId: string;
  value: unknown;
  tip?: string;
  onCommit: (ports: number[]) => void;
}) {
  const [text, setText] = useState(portsToText(value));
  const labelEl = (
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
  return tip ? (
    <Tooltip content={tip} wrapperClassName="min-w-0">
      {labelEl}
    </Tooltip>
  ) : (
    labelEl
  );
}

export interface DevboxProfilesProps {
  profiles: DevboxProfileRow[] | null;
  overviewCards: DevboxVitalCard[] | null;
  error: string | null;
  busy: boolean;
  onAction: (action: Promise<DevboxAccepted>) => void;
  onRetry: () => void;
  onChanged: () => void;
  onStarted?: () => void;
  addSignal?: number;
  seedSignal?: number;
  editSignal?: number;
  editName?: string;
  duplicateSignal?: number;
  duplicateName?: string;
}

export function DevboxProfiles({
  profiles,
  error,
  busy,
  onAction,
  onRetry,
  onChanged,
  onStarted,
  addSignal = 0,
  seedSignal = 0,
  editSignal = 0,
  editName = '',
  duplicateSignal = 0,
  duplicateName = '',
}: DevboxProfilesProps) {
  const rows = Array.isArray(profiles) ? profiles : [];
  const activeRow = rows.find(row => row.active) ?? null;
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const nameTouchedRef = useRef(false);
  const autoFilledRef = useRef<Record<string, unknown>>({});
  const detectSeqRef = useRef(0);
  const [detect, setDetect] = useState<DevboxProfileDetect | null>(null);
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

  const updateModel = useCallback((patch: Record<string, unknown>) => {
    setEditor(prev => {
      if (!prev) return prev;
      const current = parseModel(prev.json);
      // битый JSON не перезаписываем — иначе один клик по структурному полю
      // стирал бы всё содержимое редактора
      if (current === null) return prev;
      const next: ProfileModel = { ...current, ...patch };
      // сиды MCP мерджим по имени, а не заменой — иначе seed затирал бы
      // уже настроенные exposed_mcps
      if (Array.isArray(patch.exposed_mcps) && Array.isArray(current.exposed_mcps)) {
        const incoming = patch.exposed_mcps as Array<{ name?: string }>;
        const incomingNames = new Set(incoming.map(row => row?.name));
        next.exposed_mcps = [
          ...(current.exposed_mcps as Array<{ name?: string }>).filter(
            row => !incomingNames.has(row?.name),
          ),
          ...incoming,
        ];
      }
      return { ...prev, json: JSON.stringify(next, null, 2) };
    });
  }, []);

  const applyDetect = useCallback((result: DevboxProfileDetect) => {
    const suggested = result.suggested;
    const gitName = suggested && typeof suggested.git_name === 'string' ? suggested.git_name : '';
    const gitEmail =
      suggested && typeof suggested.git_email === 'string' ? suggested.git_email : '';
    setGitIdentity(gitName && gitEmail ? `${gitName} <${gitEmail}>` : '');
    setEditor(prev => {
      if (!prev || !prev.create) return prev;
      const current = parseModel(prev.json);
      if (current === null) return prev;
      const next: ProfileModel = { ...current };
      const auto = autoFilledRef.current;
      const assign = (key: string, value: unknown) => {
        if (value === undefined || value === null || value === '') return;
        const prevValue = current[key];
        const wasAuto =
          auto[key] !== undefined && JSON.stringify(prevValue) === JSON.stringify(auto[key]);
        if (prevValue === undefined || prevValue === '' || wasAuto) {
          next[key] = value;
          auto[key] = value;
        }
      };
      const clearIfAuto = (key: string) => {
        const prevValue = current[key];
        const wasAuto =
          auto[key] !== undefined && JSON.stringify(prevValue) === JSON.stringify(auto[key]);
        if (!wasAuto) return;
        delete next[key];
        delete auto[key];
      };
      if (result.path !== '' && current.project_dir !== result.path) {
        next.project_dir = result.path;
      }
      if (suggested) {
        assign('toolchain', suggested.toolchain);
        assign('ui_port', suggested.ui_port);
        assign('allowed_ports', suggested.allowed_ports);
        assign('git_name', suggested.git_name);
        assign('git_email', suggested.git_email);
        if (suggested.toolchain === undefined) clearIfAuto('toolchain');
        if (suggested.ui_port === undefined) {
          clearIfAuto('ui_port');
          clearIfAuto('allowed_ports');
        }
        if (suggested.git_name === undefined) clearIfAuto('git_name');
        if (suggested.git_email === undefined) clearIfAuto('git_email');
      } else {
        for (const key of ['toolchain', 'ui_port', 'allowed_ports', 'git_name', 'git_email']) {
          clearIfAuto(key);
        }
      }
      const name = !nameTouchedRef.current && result.name ? result.name : prev.name;
      if (name === prev.name && JSON.stringify(next) === JSON.stringify(current)) return prev;
      return { ...prev, name, json: JSON.stringify(next, null, 2) };
    });
  }, []);

  const openEditor = useCallback(
    (name: string, seed?: Record<string, unknown>) => {
      setAdvancedOpen(false);
      setJsonOpen(seed !== undefined);
      setNameTouched(true);
      nameTouchedRef.current = true;
      detectSeqRef.current += 1;
      setDetect(null);
      setEditor({ name, json: '', baseJson: '', loading: true, saving: false, create: false, lastInvalid: null });
      devboxProfileGet(name)
        .then(result => {
          setEditor(prev =>
            prev && prev.name === name
              ? {
                  ...prev,
                  json: result.json,
                  baseJson: result.json,
                  loading: false,
                  lastInvalid: result.valid ? null : { json: result.json, errors: result.errors },
                }
              : prev,
          );
          if (seed) updateModel(seed);
        })
        .catch((err: unknown) => {
          appToast.error(err instanceof Error ? err.message : t('pluginUi.actionFailed'));
          setEditor(prev => (prev && prev.name === name ? { ...prev, loading: false } : prev));
        });
    },
    [updateModel],
  );

  const openCreate = useCallback(() => {
    setAdvancedOpen(false);
    setJsonOpen(false);
    setNameTouched(false);
    nameTouchedRef.current = false;
    autoFilledRef.current = {};
    detectSeqRef.current += 1;
    setDetect(null);
    loadCreateExtras();
    setEditor({
      name: '',
      json: CREATE_TEMPLATE,
      baseJson: CREATE_TEMPLATE,
      loading: false,
      saving: false,
      create: true,
      lastInvalid: null,
    });
  }, [loadCreateExtras]);

  useEffect(() => {
    if (addSignal === 0) return;
    const timer = setTimeout(openCreate, 0);
    return () => clearTimeout(timer);
  }, [addSignal, openCreate]);

  useEffect(() => {
    if (editSignal === 0 || editName === '') return;
    const timer = setTimeout(() => openEditor(editName), 0);
    return () => clearTimeout(timer);
  }, [editSignal, editName, openEditor]);

  const seededRef = useRef(0);
  useEffect(() => {
    if (seedSignal === 0) {
      seededRef.current = 0;
      return;
    }
    if (seedSignal === seededRef.current) return;
    const timer = setTimeout(() => {
      seededRef.current = seedSignal;
      if (activeRow) {
        openEditor(activeRow.name, MCP_SEED);
        return;
      }
      openCreate();
      setJsonOpen(true);
      updateModel(MCP_SEED);
    }, 0);
    return () => clearTimeout(timer);
  }, [seedSignal, activeRow, openEditor, openCreate, updateModel]);

  const openCreateFrom = useCallback(
    (name: string) => {
      setAdvancedOpen(false);
      setJsonOpen(false);
      setNameTouched(false);
      nameTouchedRef.current = false;
      autoFilledRef.current = {};
      detectSeqRef.current += 1;
      setDetect(null);
      loadCreateExtras();
      setEditor({
        name: '',
        json: CREATE_TEMPLATE,
        baseJson: CREATE_TEMPLATE,
        loading: true,
        saving: false,
        create: true,
        lastInvalid: null,
      });
      devboxProfileGet(name)
        .then(result =>
          setEditor(prev =>
            prev && prev.create ? { ...prev, json: result.json, baseJson: result.json, loading: false } : prev,
          ),
        )
        .catch((err: unknown) => {
          appToast.error(err instanceof Error ? err.message : t('pluginUi.actionFailed'));
          setEditor(prev => (prev ? { ...prev, loading: false } : prev));
        });
    },
    [loadCreateExtras],
  );

  const dupedRef = useRef(0);
  useEffect(() => {
    if (duplicateSignal === 0) {
      dupedRef.current = 0;
      return;
    }
    if (duplicateSignal === dupedRef.current || duplicateName === '') return;
    const timer = setTimeout(() => {
      dupedRef.current = duplicateSignal;
      openCreateFrom(duplicateName);
    }, 0);
    return () => clearTimeout(timer);
  }, [duplicateSignal, duplicateName, openCreateFrom]);

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
    () => (model ? editorErrors.filter(isFolderProfileError) : []),
    [editorErrors, model],
  );
  const generalErrors = useMemo(
    () => editorErrors.filter(line => !folderErrors.includes(line)),
    [editorErrors, folderErrors],
  );

  const onFolderChange = useCallback(
    (value: string) => {
      updateModel({ project_dir: value });
      if (value.trim() === '') setDetect(null);
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
  const createMode = editor?.create === true;
  const editorLoading = editor?.loading === true;

  useEffect(() => {
    const path = folder.trim();
    if (!createMode || editorLoading || path === '') return;
    const seq = ++detectSeqRef.current;
    const timer = setTimeout(() => {
      devboxProfileDetect(path)
        .then(result => {
          if (seq !== detectSeqRef.current) return;
          setDetect(result);
          applyDetect(result);
        })
        .catch(() => {
          if (seq === detectSeqRef.current) setDetect(null);
        });
    }, DETECT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [createMode, editorLoading, folder, applyDetect]);

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
    // файл могли переписать снаружи (watchdog, devbox.py use, другая вкладка)
    // пока редактор был открыт — слепое перезаписывание теряет чужие правки
    if (!create) {
      try {
        const fresh = await devboxProfileGet(name);
        const freshModel = parseModel(fresh.json);
        const baseModel = parseModel(editor.baseJson);
        const drifted =
          freshModel !== null && baseModel !== null
            ? JSON.stringify(freshModel) !== JSON.stringify(baseModel)
            : fresh.json !== editor.baseJson;
        if (drifted) {
          const overwrite = await askConfirm({
            title: t('devboxPage.profilesDriftTitle'),
            message: t('devboxPage.profilesDriftWarn'),
            confirmText: t('devboxPage.profilesDriftOverwrite'),
            cancelText: t('common.cancel'),
            variant: 'warning',
          });
          if (!overwrite) return;
        }
      } catch {
        // re-GET не удался — продолжаем как раньше, PUT сам покажет ошибку
      }
    }
    setEditor(prev => (prev ? { ...prev, saving: true } : prev));
    try {
      const result = await serializeProfileWrite(() => devboxProfilePut(name, json));
      if (result.valid) {
        appToast.success(t('devboxPage.editorSaved'));
        if (create) writeRecents(folder);
        setEditor(null);
        onChanged();
        if (startAfter) {
          onAction(devboxStackStart(name, false));
          onStarted?.();
        }
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

  const saveWithTip = (node: ReactNode) =>
    saveDisabled ? (
      <Tooltip content={t('devboxPage.tipSaveDisabled')}>{node}</Tooltip>
    ) : (
      node
    );

  return (
    <div className="flex flex-col gap-3" data-testid="devbox-profiles">
      {error !== null && (
        <div
          className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2"
          data-testid="devbox-profiles-error"
        >
          <p className="min-w-0 flex-1 truncate text-2xs text-red-300">{error}</p>
          <Button size="xs" variant="ghost" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        </div>
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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={saveDisabled}
                  isLoading={editor.saving}
                  data-testid="devbox-profile-save"
                  onClick={() => void save(false)}
                >
                  {t('devboxPage.saveWithoutStart')}
                </Button>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditor(null)}>
                    {t('common.close')}
                  </Button>
                  {saveWithTip(
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={saveDisabled}
                      isLoading={editor.saving}
                      data-testid="devbox-profile-save-start"
                      onClick={() => void save(true)}
                    >
                      {t('devboxPage.addAndStart')}
                    </Button>,
                  )}
                </div>
              </div>
            ) : (
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEditor(null)}>
                  {t('common.close')}
                </Button>
                {saveWithTip(
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={saveDisabled}
                    isLoading={editor.saving}
                    data-testid="devbox-profile-save"
                    onClick={() => void save(false)}
                  >
                    {t('common.save')}
                  </Button>,
                )}
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
                      nameTouchedRef.current = true;
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
                        <span className="flex items-center gap-1">
                          {t('devboxPage.formProjectDir')}
                          <Tooltip content={t('devboxPage.tipFieldProjectDir')}>
                            <Info size={11} className="text-slate-500" aria-hidden />
                          </Tooltip>
                        </span>
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
                    {detect && (
                      <div
                        className="flex flex-col gap-1"
                        data-testid="devbox-profile-detect"
                      >
                        <span
                          className={
                            detect.exists
                              ? detect.is_git
                                ? 'text-2xs text-emerald-300'
                                : 'text-2xs text-slate-400'
                              : 'text-2xs text-red-300'
                          }
                          data-testid="devbox-profile-folder-status"
                        >
                          {detect.exists
                            ? detect.is_git
                              ? t('devboxPage.folderExistsGit')
                              : t('devboxPage.folderExistsNoGit')
                            : t('devboxPage.folderMissing')}
                        </span>
                        {detect.stacks.length > 0 && (
                          <div
                            className="flex flex-wrap items-center gap-1"
                            data-testid="devbox-profile-detect-stacks"
                          >
                            <span className="text-2xs text-slate-500">
                              {t('devboxPage.detectStackLabel')}
                            </span>
                            {detect.stacks.map(stack => (
                              <Badge
                                key={`${stack.subdir ?? ''}:${stack.id}`}
                                variant="info"
                                size="sm"
                                className="normal-case tracking-normal"
                              >
                                {stack.subdir ? `${stack.subdir}/${stack.id}` : stack.id}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {detect.provenance.git && (
                          <span className="text-2xs text-slate-500">
                            {detect.provenance.git === 'local'
                              ? t('devboxPage.detectGitLocal')
                              : detect.provenance.git === 'global'
                                ? t('devboxPage.detectGitGlobal')
                                : t('devboxPage.detectGitNone')}
                          </span>
                        )}
                        {detect.warnings.map(warning => {
                          if (warning.code === 'not_absolute') {
                            return (
                              <span
                                key="not_absolute"
                                className="text-2xs text-amber-300"
                                data-testid="devbox-profile-detect-warning"
                              >
                                {t('devboxPage.detectWarnNotAbsolute')}
                              </span>
                            );
                          }
                          if (warning.code === 'monorepo') {
                            return (
                              <span
                                key="monorepo"
                                className="text-2xs text-amber-300"
                                data-testid="devbox-profile-detect-warning"
                              >
                                {t('devboxPage.detectWarnMonorepo', {
                                  stacks: (warning.stacks ?? []).join(', '),
                                })}
                              </span>
                            );
                          }
                          if (warning.code === 'no_stack') {
                            return (
                              <span
                                key="no_stack"
                                className="text-2xs text-slate-400"
                                data-testid="devbox-profile-detect-warning"
                              >
                                {t('devboxPage.detectWarnNoStack')}
                              </span>
                            );
                          }
                          if (warning.code === 'not_git') {
                            return (
                              <span
                                key="not_git"
                                className="text-2xs text-slate-400"
                                data-testid="devbox-profile-detect-warning"
                              >
                                {t('devboxPage.detectWarnNotGit')}
                              </span>
                            );
                          }
                          return null;
                        })}
                        {detect.port_conflicts.map(conflict => (
                          <span
                            key={conflict.port}
                            className="text-2xs text-amber-300"
                            data-testid="devbox-profile-detect-port-conflict"
                          >
                            {t('devboxPage.detectPortInUse', { port: conflict.port })}
                          </span>
                        ))}
                      </div>
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
                        className="text-2xs text-red-300"
                        title={line}
                        data-testid="devbox-profile-error-project_dir"
                      >
                        {profileErrorTitle(line) ?? <span className="font-mono">{line}</span>}
                      </span>
                    ))}
                    <span className="mt-2 flex items-center gap-1 text-2xs uppercase tracking-wider text-slate-400">
                      {t('devboxPage.formMode')}
                      <Tooltip content={t('devboxPage.tipModeGroup')}>
                        <Info size={11} className="text-slate-500" aria-hidden />
                      </Tooltip>
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
                          className={
                            mode.value === 'full' && model.mode === 'full'
                              ? 'border-red-500/40 bg-red-500/[0.06]'
                              : undefined
                          }
                        />
                      ))}
                    </div>
                  </div>
                  {!advancedOpen && (
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
                        <Tooltip content={t('devboxPage.tipFieldToolchain')} wrapperClassName="min-w-0">
                        <label className="flex flex-col gap-1 text-2xs uppercase tracking-wider text-slate-400">
                          <span className="flex items-center gap-1">
                            {t('devboxPage.formToolchain')}
                            <Info size={11} className="text-slate-500" aria-hidden />
                          </span>
                          <Input
                            value={typeof model.toolchain === 'string' ? model.toolchain : ''}
                            spellCheck={false}
                            className="font-mono text-xs normal-case tracking-normal"
                            data-testid="devbox-profile-field-toolchain"
                          onChange={e => updateModel({ toolchain: e.target.value })}
                        />
                        </label>
                        </Tooltip>
                        <Tooltip content={t('devboxPage.tipFieldUiPort')} wrapperClassName="min-w-0">
                        <label className="flex flex-col gap-1 text-2xs uppercase tracking-wider text-slate-400">
                          <span className="flex items-center gap-1">
                            {t('devboxPage.formUiPort')}
                            <Info size={11} className="text-slate-500" aria-hidden />
                          </span>
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
                        </Tooltip>
                        <Tooltip content={t('devboxPage.tipFieldGit')} wrapperClassName="min-w-0">
                        <label className="flex flex-col gap-1 text-2xs uppercase tracking-wider text-slate-400">
                          <span className="flex items-center gap-1">
                            {t('devboxPage.formGitName')}
                            <Info size={11} className="text-slate-500" aria-hidden />
                          </span>
                          <Input
                            value={typeof model.git_name === 'string' ? model.git_name : ''}
                            className="text-xs normal-case tracking-normal"
                            data-testid="devbox-profile-field-git_name"
                            onChange={e => updateModel({ git_name: e.target.value })}
                          />
                        </label>
                        </Tooltip>
                        <Tooltip content={t('devboxPage.tipFieldGit')} wrapperClassName="min-w-0">
                        <label className="flex flex-col gap-1 text-2xs uppercase tracking-wider text-slate-400">
                          <span className="flex items-center gap-1">
                            {t('devboxPage.formGitEmail')}
                            <Info size={11} className="text-slate-500" aria-hidden />
                          </span>
                          <Input
                            value={typeof model.git_email === 'string' ? model.git_email : ''}
                            className="text-xs normal-case tracking-normal"
                            data-testid="devbox-profile-field-git_email"
                            onChange={e => updateModel({ git_email: e.target.value })}
                          />
                        </label>
                        </Tooltip>
                        <Tooltip content={t('devboxPage.tipFieldPreviewOrigin')} wrapperClassName="min-w-0">
                        <label className="flex flex-col gap-1 text-2xs uppercase tracking-wider text-slate-400">
                          <span className="flex items-center gap-1">
                            {t('devboxPage.formPreviewOrigin')}
                            <Info size={11} className="text-slate-500" aria-hidden />
                          </span>
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
                        </Tooltip>
                        <PortsField
                          key={`allowed:${portsToText(model.allowed_ports)}`}
                          label={t('devboxPage.formAllowedPorts')}
                          testId="devbox-profile-field-allowed_ports"
                          value={model.allowed_ports}
                          tip={t('devboxPage.tipFieldPorts')}
                          onCommit={ports => updateModel({ allowed_ports: ports })}
                        />
                        <PortsField
                          key={`deny:${portsToText(model.port_deny)}`}
                          label={t('devboxPage.formPortDeny')}
                          testId="devbox-profile-field-port_deny"
                          value={model.port_deny}
                          tip={t('devboxPage.tipFieldPorts')}
                          onCommit={ports => updateModel({ port_deny: ports })}
                        />
                      </div>
                    </div>
                  )}
                  <div className="flex flex-col gap-1">
                    <Button
                      size="xs"
                      variant="ghost"
                      className="self-start"
                      leftIcon={jsonOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      data-testid="devbox-profile-json-toggle"
                      onClick={() => setJsonOpen(v => !v)}
                    >
                      {jsonOpen ? t('devboxPage.editorJsonHide') : t('devboxPage.editorJsonToggle')}
                    </Button>
                    {jsonOpen && (
                      <>
                        <span className="text-2xs text-slate-500">
                          {t('devboxPage.editorJsonCaption')}
                        </span>
                        <Textarea
                          value={editor.json}
                          rows={4}
                          spellCheck={false}
                          className="max-h-[120px] overflow-y-auto font-mono text-xs"
                          data-testid="devbox-profile-editor"
                          onChange={e =>
                            setEditor(prev => (prev ? { ...prev, json: e.target.value } : prev))
                          }
                        />
                      </>
                    )}
                  </div>
                </>
              )}
              {generalErrors.length > 0 && (
                <div className="flex flex-col gap-1" data-testid="devbox-profile-errors">
                  <span className="text-2xs uppercase tracking-wider text-red-300">
                    {t('devboxPage.editorErrors')}
                  </span>
                  {generalErrors.map((line, i) => (
                    <span key={i} className="text-2xs text-red-300" title={line}>
                      {profileErrorTitle(line) ?? <span className="font-mono">{line}</span>}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
